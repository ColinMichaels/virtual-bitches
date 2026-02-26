import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3000);
const API_PREFIX = "/api";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const WS_BASE_URL = process.env.WS_BASE_URL ?? "ws://localhost:3000";
const log = logger.create("Server");

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MULTIPLAYER_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_STORED_GAME_LOGS = 10000;
const MAX_WS_MESSAGE_BYTES = 16 * 1024;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const WS_CLOSE_CODES = {
  normal: 1000,
  badRequest: 4400,
  unauthorized: 4401,
  forbidden: 4403,
  sessionExpired: 4408,
  internalError: 1011,
};

const DEFAULT_STORE = {
  players: {},
  gameLogs: {},
  multiplayerSessions: {},
  refreshTokens: {},
  accessTokens: {},
};

let store = structuredClone(DEFAULT_STORE);

await bootstrap();

const server = createServer((req, res) => {
  void handleRequest(req, res);
});
const wsSessionClients = new Map();
const wsClientMeta = new WeakMap();

server.on("upgrade", (req, socket) => {
  try {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (requestUrl.pathname !== "/") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    cleanupExpiredRecords();
    const auth = authenticateSocketUpgrade(requestUrl);
    if (!auth.ok) {
      rejectUpgrade(socket, auth.status, auth.reason);
      return;
    }

    const upgrade = validateSocketUpgradeHeaders(req);
    if (!upgrade.ok) {
      rejectUpgrade(socket, upgrade.status, upgrade.reason);
      return;
    }

    completeSocketHandshake(socket, upgrade.acceptValue);
    handleSocketConnection(socket, auth);
  } catch (error) {
    log.warn("Failed to process WebSocket upgrade", error);
    rejectUpgrade(socket, 500, "Internal Server Error");
  }
});

server.listen(PORT, () => {
  log.info(`Listening on http://localhost:${PORT}`);
  log.info(`Health endpoint: http://localhost:${PORT}/api/health`);
  log.info(`WebSocket endpoint: ws://localhost:${PORT}/?session=<id>&playerId=<id>&token=<token>`);
});

async function bootstrap() {
  await mkdir(DATA_DIR, { recursive: true });

  if (!existsSync(DATA_FILE)) {
    await writeStore(DEFAULT_STORE);
    store = structuredClone(DEFAULT_STORE);
    return;
  }

  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    store = {
      ...structuredClone(DEFAULT_STORE),
      ...parsed,
      players: parsed.players ?? {},
      gameLogs: parsed.gameLogs ?? {},
      multiplayerSessions: parsed.multiplayerSessions ?? {},
      refreshTokens: parsed.refreshTokens ?? {},
      accessTokens: parsed.accessTokens ?? {},
    };
  } catch (error) {
    log.warn("Failed to load store, using default", error);
    store = structuredClone(DEFAULT_STORE);
  }
}

async function handleRequest(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  if (!pathname.startsWith(API_PREFIX)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  cleanupExpiredRecords();

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        now: Date.now(),
        players: Object.keys(store.players).length,
        sessions: Object.keys(store.multiplayerSessions).length,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/token/refresh") {
      await handleRefreshToken(req, res);
      return;
    }

    if (req.method === "GET" && /^\/api\/players\/[^/]+\/profile$/.test(pathname)) {
      await handleGetProfile(req, res, pathname);
      return;
    }

    if (req.method === "PUT" && /^\/api\/players\/[^/]+\/profile$/.test(pathname)) {
      await handlePutProfile(req, res, pathname);
      return;
    }

    if (req.method === "POST" && pathname === "/api/logs/batch") {
      await handleAppendLogs(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/multiplayer/sessions") {
      await handleCreateSession(req, res);
      return;
    }

    if (req.method === "POST" && /^\/api\/multiplayer\/sessions\/[^/]+\/join$/.test(pathname)) {
      await handleJoinSession(req, res, pathname);
      return;
    }

    if (req.method === "POST" && /^\/api\/multiplayer\/sessions\/[^/]+\/heartbeat$/.test(pathname)) {
      await handleSessionHeartbeat(req, res, pathname);
      return;
    }

    if (req.method === "POST" && /^\/api\/multiplayer\/sessions\/[^/]+\/leave$/.test(pathname)) {
      await handleLeaveSession(req, res, pathname);
      return;
    }

    if (req.method === "POST" && /^\/api\/multiplayer\/sessions\/[^/]+\/auth\/refresh$/.test(pathname)) {
      await handleRefreshSessionAuth(req, res, pathname);
      return;
    }

    sendJson(res, 404, { error: "Unknown endpoint" });
  } catch (error) {
    log.error("Request failed", error);
    sendJson(res, 500, { error: "Internal server error" });
  }
}

async function handleRefreshToken(req, res) {
  const body = await parseJsonBody(req);
  const refreshToken = typeof body?.refreshToken === "string" ? body.refreshToken : "";
  if (!refreshToken) {
    sendJson(res, 400, { error: "refreshToken is required" });
    return;
  }

  const refreshRecord = verifyRefreshToken(refreshToken);
  if (!refreshRecord) {
    sendJson(res, 401, { error: "Invalid or expired refresh token" });
    return;
  }

  delete store.refreshTokens[hashToken(refreshToken)];
  const tokens = issueAuthTokenBundle(refreshRecord.playerId, refreshRecord.sessionId);
  await persistStore();
  sendJson(res, 200, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    tokenType: "Bearer",
  });
}

async function handleGetProfile(req, res, pathname) {
  const playerId = decodeURIComponent(pathname.split("/")[3]);
  const authCheck = authorizeRequest(req, playerId);
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const profile = store.players[playerId];
  if (!profile) {
    // No remote profile yet for first-time players.
    // Return 204 to avoid noisy 404s in clients that probe for existence.
    res.writeHead(204);
    res.end();
    return;
  }

  sendJson(res, 200, profile);
}

async function handlePutProfile(req, res, pathname) {
  const playerId = decodeURIComponent(pathname.split("/")[3]);
  const authCheck = authorizeRequest(req, playerId);
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const body = await parseJsonBody(req);
  if (!body || typeof body !== "object") {
    sendJson(res, 400, { error: "Invalid profile payload" });
    return;
  }

  const now = Date.now();
  const profile = {
    playerId,
    displayName: typeof body.displayName === "string" ? body.displayName : undefined,
    settings: body.settings ?? {},
    upgradeProgression: body.upgradeProgression ?? {},
    updatedAt: typeof body.updatedAt === "number" ? body.updatedAt : now,
  };

  store.players[playerId] = profile;
  await persistStore();
  sendJson(res, 200, profile);
}

async function handleAppendLogs(req, res) {
  const authCheck = authorizeRequest(req);
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const body = await parseJsonBody(req);
  const logs = Array.isArray(body?.logs) ? body.logs : [];
  if (logs.length === 0) {
    sendJson(res, 200, { accepted: 0, failed: 0 });
    return;
  }

  let accepted = 0;
  let failed = 0;
  for (const entry of logs) {
    if (!entry || typeof entry !== "object") {
      failed += 1;
      continue;
    }

    const id = typeof entry.id === "string" ? entry.id : randomUUID();
    const playerId = typeof entry.playerId === "string" ? entry.playerId : "";
    const type = typeof entry.type === "string" ? entry.type : "";
    const timestamp = typeof entry.timestamp === "number" ? entry.timestamp : Date.now();
    if (!playerId || !type) {
      failed += 1;
      continue;
    }

    store.gameLogs[id] = {
      id,
      playerId,
      sessionId: typeof entry.sessionId === "string" ? entry.sessionId : undefined,
      type,
      timestamp,
      payload: entry.payload ?? {},
    };
    accepted += 1;
  }

  compactLogStore();
  await persistStore();
  sendJson(res, 200, { accepted, failed });
}

async function handleCreateSession(req, res) {
  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!playerId) {
    sendJson(res, 400, { error: "playerId is required" });
    return;
  }

  const sessionId = randomUUID();
  const roomCode = normalizeRoomCode(body?.roomCode);
  const now = Date.now();
  const expiresAt = now + MULTIPLAYER_SESSION_TTL_MS;
  const session = {
    sessionId,
    roomCode,
    wsUrl: WS_BASE_URL,
    createdAt: now,
    expiresAt,
    participants: {
      [playerId]: {
        playerId,
        displayName: typeof body?.displayName === "string" ? body.displayName : undefined,
        joinedAt: now,
        lastHeartbeatAt: now,
      },
    },
  };

  store.multiplayerSessions[sessionId] = session;
  const auth = issueAuthTokenBundle(playerId, sessionId);
  const response = buildSessionResponse(session, playerId, auth);
  await persistStore();
  sendJson(res, 200, response);
}

async function handleJoinSession(req, res, pathname) {
  const sessionId = decodeURIComponent(pathname.split("/")[4]);
  const session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    sendJson(res, 410, { error: "Session expired" });
    return;
  }

  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!playerId) {
    sendJson(res, 400, { error: "playerId is required" });
    return;
  }

  session.participants[playerId] = {
    playerId,
    displayName: typeof body?.displayName === "string" ? body.displayName : undefined,
    joinedAt: session.participants[playerId]?.joinedAt ?? Date.now(),
    lastHeartbeatAt: Date.now(),
  };

  const auth = issueAuthTokenBundle(playerId, sessionId);
  const response = buildSessionResponse(session, playerId, auth);
  await persistStore();
  sendJson(res, 200, response);
}

async function handleSessionHeartbeat(req, res, pathname) {
  const sessionId = decodeURIComponent(pathname.split("/")[4]);
  const session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    sendJson(res, 200, { ok: false, reason: "session_expired" });
    return;
  }

  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!playerId || !session.participants[playerId]) {
    sendJson(res, 200, { ok: false, reason: "unknown_player" });
    return;
  }

  const authCheck = authorizeRequest(req, playerId, sessionId);
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  session.participants[playerId].lastHeartbeatAt = Date.now();
  await persistStore();
  sendJson(res, 200, { ok: true });
}

async function handleLeaveSession(req, res, pathname) {
  const sessionId = decodeURIComponent(pathname.split("/")[4]);
  const session = store.multiplayerSessions[sessionId];
  if (!session) {
    sendJson(res, 200, { ok: true });
    return;
  }

  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!playerId) {
    sendJson(res, 400, { error: "playerId is required" });
    return;
  }

  delete session.participants[playerId];
  disconnectPlayerSockets(
    sessionId,
    playerId,
    WS_CLOSE_CODES.normal,
    "left_session"
  );
  if (Object.keys(session.participants).length === 0) {
    expireSession(sessionId, "session_empty");
  }

  await persistStore();
  sendJson(res, 200, { ok: true });
}

async function handleRefreshSessionAuth(req, res, pathname) {
  const sessionId = decodeURIComponent(pathname.split("/")[4]);
  const session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    sendJson(res, 410, { error: "Session expired" });
    return;
  }

  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!playerId || !session.participants[playerId]) {
    sendJson(res, 404, { error: "Player not in session" });
    return;
  }

  const auth = issueAuthTokenBundle(playerId, sessionId);
  const response = buildSessionResponse(session, playerId, auth);
  await persistStore();
  sendJson(res, 200, response);
}

function authorizeRequest(req, expectedPlayerId, expectedSessionId) {
  const header = req.headers.authorization;
  if (!header) {
    return { ok: true };
  }

  const token = extractBearerToken(header);
  if (!token) {
    return { ok: false };
  }

  const record = verifyAccessToken(token);
  if (!record) {
    return { ok: false };
  }

  if (expectedPlayerId && record.playerId !== expectedPlayerId) {
    return { ok: false };
  }
  if (expectedSessionId && record.sessionId !== expectedSessionId) {
    return { ok: false };
  }

  return { ok: true, playerId: record.playerId, sessionId: record.sessionId };
}

function issueAuthTokenBundle(playerId, sessionId) {
  const now = Date.now();
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const accessRecord = {
    playerId,
    sessionId,
    expiresAt: now + ACCESS_TOKEN_TTL_MS,
    issuedAt: now,
  };
  const refreshRecord = {
    playerId,
    sessionId,
    expiresAt: now + REFRESH_TOKEN_TTL_MS,
    issuedAt: now,
  };

  store.accessTokens[hashToken(accessToken)] = accessRecord;
  store.refreshTokens[hashToken(refreshToken)] = refreshRecord;

  return {
    accessToken,
    refreshToken,
    expiresAt: accessRecord.expiresAt,
    tokenType: "Bearer",
  };
}

function verifyAccessToken(token) {
  const record = store.accessTokens[hashToken(token)];
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    delete store.accessTokens[hashToken(token)];
    return null;
  }
  return record;
}

function verifyRefreshToken(token) {
  const record = store.refreshTokens[hashToken(token)];
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    delete store.refreshTokens[hashToken(token)];
    return null;
  }
  return record;
}

function extractBearerToken(header) {
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

function randomToken() {
  return randomBytes(24).toString("base64url");
}

function hashToken(value) {
  return createHash("sha256").update(value).digest("hex");
}

function buildSessionResponse(session, playerId, auth) {
  return {
    sessionId: session.sessionId,
    roomCode: session.roomCode,
    wsUrl: session.wsUrl,
    playerToken: auth.accessToken,
    auth,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  };
}

function normalizeRoomCode(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().toUpperCase().slice(0, 8);
  }
  return randomToken().slice(0, 6).toUpperCase();
}

function compactLogStore() {
  const ids = Object.keys(store.gameLogs);
  if (ids.length <= MAX_STORED_GAME_LOGS) return;

  ids
    .sort((a, b) => {
      const left = store.gameLogs[a]?.timestamp ?? 0;
      const right = store.gameLogs[b]?.timestamp ?? 0;
      return left - right;
    })
    .slice(0, ids.length - MAX_STORED_GAME_LOGS)
    .forEach((id) => {
      delete store.gameLogs[id];
    });
}

function cleanupExpiredRecords() {
  const now = Date.now();

  Object.entries(store.accessTokens).forEach(([hash, record]) => {
    if (!record || record.expiresAt <= now) {
      delete store.accessTokens[hash];
    }
  });
  Object.entries(store.refreshTokens).forEach(([hash, record]) => {
    if (!record || record.expiresAt <= now) {
      delete store.refreshTokens[hash];
    }
  });
  Object.entries(store.multiplayerSessions).forEach(([sessionId, session]) => {
    if (!session || session.expiresAt <= now) {
      expireSession(sessionId, "session_expired");
    }
  });
}

function rejectUpgrade(socket, status, reason) {
  if (socket.destroyed) return;
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
  );
  socket.destroy();
}

function validateSocketUpgradeHeaders(req) {
  if (req.method !== "GET") {
    return { ok: false, status: 405, reason: "Method Not Allowed" };
  }

  const upgrade = String(req.headers.upgrade ?? "").toLowerCase();
  if (upgrade !== "websocket") {
    return { ok: false, status: 400, reason: "Bad Request" };
  }

  const connectionHeader = String(req.headers.connection ?? "").toLowerCase();
  const includesUpgrade = connectionHeader
    .split(",")
    .map((part) => part.trim())
    .includes("upgrade");
  if (!includesUpgrade) {
    return { ok: false, status: 400, reason: "Bad Request" };
  }

  const version = String(req.headers["sec-websocket-version"] ?? "");
  if (version !== "13") {
    return { ok: false, status: 426, reason: "Upgrade Required" };
  }

  const key = String(req.headers["sec-websocket-key"] ?? "").trim();
  if (!key) {
    return { ok: false, status: 400, reason: "Bad Request" };
  }

  let decodedKey;
  try {
    decodedKey = Buffer.from(key, "base64");
  } catch {
    return { ok: false, status: 400, reason: "Bad Request" };
  }
  if (decodedKey.length !== 16) {
    return { ok: false, status: 400, reason: "Bad Request" };
  }

  const acceptValue = createHash("sha1")
    .update(`${key}${WS_GUID}`)
    .digest("base64");

  return { ok: true, acceptValue };
}

function completeSocketHandshake(socket, acceptValue) {
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptValue}`,
      "\r\n",
    ].join("\r\n")
  );
}

function authenticateSocketUpgrade(requestUrl) {
  const sessionId = requestUrl.searchParams.get("session")?.trim() ?? "";
  const playerId = requestUrl.searchParams.get("playerId")?.trim() ?? "";
  const token = requestUrl.searchParams.get("token")?.trim() ?? "";

  if (!sessionId || !playerId || !token) {
    return { ok: false, status: 401, reason: "Unauthorized" };
  }

  const session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    return { ok: false, status: 410, reason: "Gone" };
  }

  if (!session.participants[playerId]) {
    return { ok: false, status: 403, reason: "Forbidden" };
  }

  const accessRecord = verifyAccessToken(token);
  if (!accessRecord) {
    return { ok: false, status: 401, reason: "Unauthorized" };
  }

  if (accessRecord.playerId !== playerId || accessRecord.sessionId !== sessionId) {
    return { ok: false, status: 403, reason: "Forbidden" };
  }

  return {
    ok: true,
    sessionId,
    playerId,
    tokenExpiresAt: accessRecord.expiresAt,
  };
}

function handleSocketConnection(socket, auth) {
  const client = {
    socket,
    sessionId: auth.sessionId,
    playerId: auth.playerId,
    readBuffer: Buffer.alloc(0),
    tokenExpiryTimer: null,
    closed: false,
    registered: false,
  };

  wsClientMeta.set(socket, client);
  registerSocketClient(client, client.sessionId);
  log.info(`WebSocket connected: session=${client.sessionId} player=${client.playerId}`);

  const msUntilExpiry = Math.max(0, auth.tokenExpiresAt - Date.now());
  client.tokenExpiryTimer = setTimeout(() => {
    sendSocketError(client, "session_expired", "access_token_expired");
    safeCloseSocket(client, WS_CLOSE_CODES.unauthorized, "access_token_expired");
  }, msUntilExpiry);

  socket.on("data", (chunk) => {
    if (!Buffer.isBuffer(chunk)) {
      return;
    }
    handleSocketData(client, chunk);
  });

  socket.on("close", () => {
    client.closed = true;
    unregisterSocketClient(client);
  });

  socket.on("end", () => {
    client.closed = true;
    unregisterSocketClient(client);
  });

  socket.on("error", (error) => {
    client.closed = true;
    unregisterSocketClient(client);
    log.warn("WebSocket error", error);
  });
}

function handleSocketData(client, chunk) {
  if (client.closed) return;

  client.readBuffer = Buffer.concat([client.readBuffer, chunk]);
  if (client.readBuffer.length > MAX_WS_MESSAGE_BYTES * 2) {
    sendSocketError(client, "message_too_large", "message_too_large");
    safeCloseSocket(client, WS_CLOSE_CODES.badRequest, "message_too_large");
    return;
  }

  while (true) {
    const frame = parseSocketFrame(client.readBuffer);
    if (!frame) {
      return;
    }

    if (frame.error) {
      sendSocketError(client, "invalid_payload", frame.error);
      safeCloseSocket(client, WS_CLOSE_CODES.badRequest, frame.error);
      return;
    }

    client.readBuffer = client.readBuffer.subarray(frame.bytesConsumed);

    if (frame.opcode === 0x1) {
      const raw = frame.payload.toString("utf8");
      if (raw.length > MAX_WS_MESSAGE_BYTES) {
        sendSocketError(client, "message_too_large", "message_too_large");
        safeCloseSocket(client, WS_CLOSE_CODES.badRequest, "message_too_large");
        return;
      }
      handleSocketMessage(client, raw);
      continue;
    }

    if (frame.opcode === 0x8) {
      safeCloseSocket(client, WS_CLOSE_CODES.normal, "client_closed");
      return;
    }

    if (frame.opcode === 0x9) {
      writeSocketFrame(client.socket, 0xA, frame.payload.subarray(0, 125));
      continue;
    }

    if (frame.opcode === 0xA) {
      continue;
    }

    sendSocketError(client, "unsupported_message_type", "unsupported_opcode");
    safeCloseSocket(client, WS_CLOSE_CODES.badRequest, "unsupported_opcode");
    return;
  }
}

function parseSocketFrame(buffer) {
  if (buffer.length < 2) return null;

  const byte1 = buffer[0];
  const byte2 = buffer[1];
  const fin = (byte1 & 0x80) !== 0;
  const opcode = byte1 & 0x0f;
  const masked = (byte2 & 0x80) !== 0;
  let payloadLength = byte2 & 0x7f;
  let offset = 2;

  if (!fin) {
    return { error: "fragmented_frames_not_supported", bytesConsumed: buffer.length };
  }

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) return null;
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) return null;
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(MAX_WS_MESSAGE_BYTES)) {
      return { error: "message_too_large", bytesConsumed: buffer.length };
    }
    payloadLength = Number(big);
    offset += 8;
  }

  if (payloadLength > MAX_WS_MESSAGE_BYTES) {
    return { error: "message_too_large", bytesConsumed: buffer.length };
  }

  if (!masked) {
    return { error: "client_frame_not_masked", bytesConsumed: buffer.length };
  }

  if (buffer.length < offset + 4 + payloadLength) {
    return null;
  }

  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength));
  for (let i = 0; i < payload.length; i += 1) {
    payload[i] ^= mask[i % 4];
  }

  return {
    opcode,
    payload,
    bytesConsumed: offset + payloadLength,
  };
}

function writeSocketFrame(socket, opcode, payload = Buffer.alloc(0)) {
  const payloadLength = payload.length;
  let header;

  if (payloadLength < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = payloadLength;
  } else if (payloadLength <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

function handleSocketMessage(client, rawMessage) {
  if (!wsClientMeta.get(client.socket)) return;

  let payload;
  try {
    payload = JSON.parse(rawMessage);
  } catch (error) {
    log.warn("Ignoring malformed WebSocket JSON payload", error);
    sendSocketError(client, "invalid_payload", "invalid_json");
    return;
  }

  if (!isSupportedSocketPayload(payload)) {
    sendSocketError(client, "unsupported_message_type", "unsupported_message_type");
    return;
  }

  const session = store.multiplayerSessions[client.sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    sendSocketError(client, "session_expired", "session_expired");
    safeCloseSocket(client, WS_CLOSE_CODES.sessionExpired, "session_expired");
    return;
  }

  if (!session.participants[client.playerId]) {
    sendSocketError(client, "unauthorized", "player_not_in_session");
    safeCloseSocket(client, WS_CLOSE_CODES.forbidden, "player_not_in_session");
    return;
  }

  session.participants[client.playerId].lastHeartbeatAt = Date.now();
  broadcastToSession(client.sessionId, rawMessage, client);
}

function isSupportedSocketPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const messageType = payload.type;
  return messageType === "chaos_attack" || messageType === "particle:emit";
}

function registerSocketClient(client, sessionId) {
  const clients = wsSessionClients.get(sessionId) ?? new Set();
  clients.add(client);
  wsSessionClients.set(sessionId, clients);
  client.registered = true;
}

function unregisterSocketClient(client) {
  if (!client?.registered) return;
  client.registered = false;

  if (client.tokenExpiryTimer) {
    clearTimeout(client.tokenExpiryTimer);
    client.tokenExpiryTimer = null;
  }

  wsClientMeta.delete(client.socket);
  const clients = wsSessionClients.get(client.sessionId);
  if (!clients) return;

  clients.delete(client);
  if (clients.size === 0) {
    wsSessionClients.delete(client.sessionId);
  }
}

function disconnectPlayerSockets(sessionId, playerId, closeCode, reason) {
  const clients = wsSessionClients.get(sessionId);
  if (!clients) return;

  for (const client of clients) {
    if (!client || client.playerId !== playerId) {
      continue;
    }

    safeCloseSocket(client, closeCode, reason);
  }
}

function expireSession(sessionId, reason) {
  if (store.multiplayerSessions[sessionId]) {
    delete store.multiplayerSessions[sessionId];
  }

  const clients = wsSessionClients.get(sessionId);
  if (!clients || clients.size === 0) {
    return;
  }

  for (const client of clients) {
    if (reason === "session_expired") {
      sendSocketError(client, "session_expired", "session_expired");
      safeCloseSocket(client, WS_CLOSE_CODES.sessionExpired, "session_expired");
      continue;
    }

    safeCloseSocket(client, WS_CLOSE_CODES.normal, reason);
  }
}

function broadcastToSession(sessionId, rawMessage, sender) {
  const clients = wsSessionClients.get(sessionId);
  if (!clients || clients.size === 0) return;

  for (const client of clients) {
    if (client === sender || client.closed || client.socket.destroyed) {
      continue;
    }

    try {
      writeSocketFrame(client.socket, 0x1, Buffer.from(rawMessage, "utf8"));
    } catch (error) {
      log.warn("Failed to broadcast WebSocket message", error);
      safeCloseSocket(client, WS_CLOSE_CODES.internalError, "send_failed");
    }
  }
}

function sendSocketError(client, code, message) {
  if (client.closed || client.socket.destroyed) return;
  const payload = JSON.stringify({
    type: "error",
    code,
    message,
  });

  try {
    writeSocketFrame(client.socket, 0x1, Buffer.from(payload, "utf8"));
  } catch (error) {
    log.warn("Failed to send WebSocket error payload", error);
  }
}

function safeCloseSocket(client, closeCode, closeReason) {
  if (!client || client.closed) return;
  client.closed = true;
  unregisterSocketClient(client);

  if (client.socket.destroyed) {
    return;
  }

  const reasonBuffer = Buffer.from(
    String(closeReason ?? "closed").slice(0, 123),
    "utf8"
  );
  const payload = Buffer.alloc(2 + reasonBuffer.length);
  payload.writeUInt16BE(closeCode, 0);
  reasonBuffer.copy(payload, 2);

  try {
    writeSocketFrame(client.socket, 0x8, payload);
    client.socket.end();
  } catch (error) {
    log.warn("Failed to close WebSocket cleanly", error);
    client.socket.destroy();
  }
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1024 * 1024) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function persistStore() {
  await writeStore(store);
}

async function writeStore(nextStore) {
  await writeFile(DATA_FILE, JSON.stringify(nextStore, null, 2), "utf8");
}

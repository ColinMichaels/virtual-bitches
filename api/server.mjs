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

server.listen(PORT, () => {
  log.info(`Listening on http://localhost:${PORT}`);
  log.info(`Health endpoint: http://localhost:${PORT}/api/health`);
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
    sendJson(res, 404, { error: "Profile not found" });
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
  if (Object.keys(session.participants).length === 0) {
    delete store.multiplayerSessions[sessionId];
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
      delete store.multiplayerSessions[sessionId];
    }
  });
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

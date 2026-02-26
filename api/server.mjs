import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.mjs";
import { createStoreAdapter, DEFAULT_STORE } from "./storage/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3000);
const API_PREFIX = "/api";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const WS_BASE_URL = process.env.WS_BASE_URL ?? "ws://localhost:3000";
const STORE_BACKEND = (process.env.API_STORE_BACKEND ?? "file").trim().toLowerCase();
const FIRESTORE_COLLECTION_PREFIX = (process.env.API_FIRESTORE_PREFIX ?? "api_v1").trim();
const FIREBASE_PROJECT_ID =
  (process.env.FIREBASE_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    "").trim();
const FIREBASE_WEB_API_KEY = (process.env.FIREBASE_WEB_API_KEY ?? "").trim();
const FIREBASE_AUTH_MODE = (process.env.FIREBASE_AUTH_MODE ?? "auto").trim().toLowerCase();
const log = logger.create("Server");

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MULTIPLAYER_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_LEADERBOARD_ENTRIES = 200;
const MAX_STORED_GAME_LOGS = 10000;
const MAX_WS_MESSAGE_BYTES = 16 * 1024;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MULTIPLAYER_BOTS = 4;
const BOT_TICK_MIN_MS = 4500;
const BOT_TICK_MAX_MS = 9000;
const BOT_NAMES = ["Byte Bessie", "Lag Larry", "Packet Patty", "Dicebot Dave"];
const BOT_CAMERA_EFFECTS = ["shake"];
const BOT_TURN_ADVANCE_MIN_MS = 1600;
const BOT_TURN_ADVANCE_MAX_MS = 3200;
const MAX_TURN_ROLL_DICE = 64;
const MAX_TURN_SCORE_SELECTION = 64;
const TURN_PHASES = {
  awaitRoll: "await_roll",
  awaitScore: "await_score",
  readyToEnd: "ready_to_end",
};

const WS_CLOSE_CODES = {
  normal: 1000,
  badRequest: 4400,
  unauthorized: 4401,
  forbidden: 4403,
  sessionExpired: 4408,
  internalError: 1011,
};

let store = structuredClone(DEFAULT_STORE);
const firebaseTokenCache = new Map();
let storeAdapter = null;
let firebaseAdminAuthClientPromise = null;

const server = createServer((req, res) => {
  void handleRequest(req, res);
});
const wsSessionClients = new Map();
const wsClientMeta = new WeakMap();
const botSessionLoops = new Map();

await bootstrap();

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
  storeAdapter = await createStoreAdapter({
    backend: STORE_BACKEND,
    dataDir: DATA_DIR,
    dataFile: DATA_FILE,
    firebaseProjectId: FIREBASE_PROJECT_ID,
    firestorePrefix: FIRESTORE_COLLECTION_PREFIX,
    logger: log,
  });
  store = await storeAdapter.load();
  log.info(`Using ${storeAdapter.name} store backend`);
  log.info(`Firebase auth verifier mode: ${FIREBASE_AUTH_MODE}`);
  Object.keys(store.multiplayerSessions).forEach((sessionId) => {
    reconcileBotLoop(sessionId);
  });
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
        leaderboardEntries: Object.keys(store.leaderboardScores).length,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/token/refresh") {
      await handleRefreshToken(req, res);
      return;
    }

    if ((req.method === "GET" || req.method === "PUT") && pathname === "/api/auth/me") {
      await handleAuthMe(req, res);
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

    if (req.method === "POST" && pathname === "/api/leaderboard/scores") {
      await handleSubmitLeaderboardScore(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/leaderboard/global") {
      await handleGetGlobalLeaderboard(res, url);
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

async function handleAuthMe(req, res) {
  if (req.method === "PUT") {
    await handleUpdateAuthMe(req, res);
    return;
  }

  const authCheck = await authorizeIdentityRequest(req, {
    allowSessionToken: false,
    requireNonAnonymous: false,
  });
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized", reason: authCheck.reason ?? "invalid_auth" });
    return;
  }

  upsertFirebasePlayer(authCheck.uid, {
    email: authCheck.email,
    provider: authCheck.provider,
    isAnonymous: authCheck.isAnonymous,
  });

  const playerRecord = store.firebasePlayers[authCheck.uid] ?? null;
  sendJson(res, 200, {
    uid: authCheck.uid,
    displayName: authCheck.displayName,
    leaderboardName: playerRecord?.displayName,
    email: authCheck.email,
    isAnonymous: authCheck.isAnonymous,
    provider: authCheck.provider,
  });
}

async function handleUpdateAuthMe(req, res) {
  const authCheck = await authorizeIdentityRequest(req, {
    allowSessionToken: false,
    requireNonAnonymous: true,
  });
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized", reason: authCheck.reason ?? "invalid_auth" });
    return;
  }

  const body = await parseJsonBody(req);
  const displayName = sanitizeDisplayName(body?.displayName);
  if (!displayName) {
    sendJson(res, 400, {
      error: "Invalid displayName",
      reason: "invalid_display_name",
    });
    return;
  }

  upsertFirebasePlayer(authCheck.uid, {
    displayName,
    email: authCheck.email,
    provider: authCheck.provider,
    isAnonymous: false,
  });
  await persistStore();

  sendJson(res, 200, {
    uid: authCheck.uid,
    displayName: authCheck.displayName,
    leaderboardName: displayName,
    email: authCheck.email,
    isAnonymous: false,
    provider: authCheck.provider,
  });
}

async function handleSubmitLeaderboardScore(req, res) {
  const authCheck = await authorizeIdentityRequest(req, {
    allowSessionToken: false,
    requireNonAnonymous: true,
  });
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized", reason: authCheck.reason ?? "invalid_auth" });
    return;
  }

  const body = await parseJsonBody(req);
  const parsed = parseLeaderboardPayload(body);
  if (!parsed) {
    sendJson(res, 400, { error: "Invalid leaderboard score payload" });
    return;
  }

  const timestamp = parsed.timestamp ?? Date.now();
  const scoreKey = `${authCheck.uid}:${parsed.scoreId}`;
  upsertFirebasePlayer(authCheck.uid, {
    email: authCheck.email,
    provider: authCheck.provider,
    isAnonymous: false,
  });

  const existingRecord = store.firebasePlayers[authCheck.uid] ?? null;
  const effectiveName =
    sanitizeDisplayName(parsed.playerName) ??
    sanitizeDisplayName(existingRecord?.displayName) ??
    sanitizeDisplayName(authCheck.displayName);
  if (!effectiveName) {
    sendJson(res, 400, {
      error: "Missing leaderboard display name",
      reason: "missing_display_name",
    });
    return;
  }

  upsertFirebasePlayer(authCheck.uid, {
    displayName: effectiveName,
    email: authCheck.email,
    provider: authCheck.provider,
    isAnonymous: false,
  });

  const entry = {
    id: scoreKey,
    uid: authCheck.uid,
    displayName: effectiveName,
    score: parsed.score,
    timestamp,
    duration: parsed.duration,
    rollCount: parsed.rollCount,
    seed: parsed.seed,
    mode: parsed.mode,
    isAnonymous: false,
  };

  store.leaderboardScores[scoreKey] = entry;
  trimLeaderboardScores(MAX_LEADERBOARD_ENTRIES);

  await persistStore();
  sendJson(res, 200, entry);
}

async function handleGetGlobalLeaderboard(res, requestUrl) {
  const rawLimit = Number(requestUrl.searchParams.get("limit") ?? MAX_LEADERBOARD_ENTRIES);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_LEADERBOARD_ENTRIES, Math.floor(rawLimit)))
    : MAX_LEADERBOARD_ENTRIES;

  const entries = Object.values(store.leaderboardScores)
    .filter((entry) => Number.isFinite(entry?.score) && !entry?.isAnonymous)
    .sort(compareLeaderboardEntries)
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      uid: entry.uid,
      displayName:
        entry.displayName ??
        store.firebasePlayers[entry.uid]?.displayName ??
        `Player ${entry.uid.slice(0, 8)}`,
      score: entry.score,
      timestamp: entry.timestamp,
      duration: entry.duration,
      rollCount: entry.rollCount,
      mode: entry.mode,
    }));

  sendJson(res, 200, {
    entries,
    total: Object.keys(store.leaderboardScores).length,
    generatedAt: Date.now(),
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
  const botCount = normalizeBotCount(body?.botCount);
  const now = Date.now();
  const expiresAt = now + MULTIPLAYER_SESSION_TTL_MS;
  const participants = {
    [playerId]: {
      playerId,
      displayName: typeof body?.displayName === "string" ? body.displayName : undefined,
      joinedAt: now,
      lastHeartbeatAt: now,
    },
  };

  for (let index = 0; index < botCount; index += 1) {
    const botId = `bot-${sessionId.slice(0, 6)}-${index + 1}`;
    participants[botId] = {
      playerId: botId,
      displayName: BOT_NAMES[index % BOT_NAMES.length],
      joinedAt: now,
      lastHeartbeatAt: now,
      isBot: true,
    };
  }

  const session = {
    sessionId,
    roomCode,
    wsUrl: WS_BASE_URL,
    createdAt: now,
    expiresAt,
    participants,
    turnState: null,
  };

  store.multiplayerSessions[sessionId] = session;
  ensureSessionTurnState(session);
  reconcileBotLoop(sessionId);
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
  ensureSessionTurnState(session);
  reconcileBotLoop(sessionId);

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
  ensureSessionTurnState(session);
  if (getHumanParticipantCount(session) === 0) {
    expireSession(sessionId, "session_empty");
  } else {
    reconcileBotLoop(sessionId);
    const turnStart = buildTurnStartMessage(session, { source: "reassign" });
    if (turnStart) {
      broadcastToSession(sessionId, JSON.stringify(turnStart), null);
    }
    scheduleBotTurnIfNeeded(sessionId);
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

async function authorizeIdentityRequest(req, options = {}) {
  const header = req.headers.authorization;
  if (!header) {
    return { ok: false, reason: "missing_authorization_header" };
  }

  const token = extractBearerToken(header);
  if (!token) {
    return { ok: false, reason: "invalid_bearer_header" };
  }

  if (options.allowSessionToken) {
    const accessRecord = verifyAccessToken(token);
    if (accessRecord) {
      return {
        ok: true,
        uid: `local:${accessRecord.playerId}`,
        displayName: accessRecord.playerId,
        email: undefined,
        isAnonymous: true,
        provider: "session",
      };
    }
  }

  const firebaseVerification = await verifyFirebaseIdToken(token);
  if (!firebaseVerification.ok) {
    return { ok: false, reason: firebaseVerification.reason };
  }
  const firebaseClaims = firebaseVerification.claims;
  if (options.requireNonAnonymous && firebaseClaims.isAnonymous) {
    return {
      ok: false,
      reason: "anonymous_not_allowed",
    };
  }

  return {
    ok: true,
    uid: firebaseClaims.uid,
    displayName: firebaseClaims.name,
    email: firebaseClaims.email,
    isAnonymous: firebaseClaims.isAnonymous,
    provider: "firebase",
  };
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

async function verifyFirebaseIdToken(idToken) {
  const now = Date.now();
  const cached = firebaseTokenCache.get(idToken);
  if (cached && cached.expiresAt > now + 5000) {
    return {
      ok: true,
      claims: cached,
    };
  }

  const adminResult = await verifyFirebaseIdTokenWithAdmin(idToken);
  if (adminResult) {
    if (adminResult.ok) {
      firebaseTokenCache.set(idToken, adminResult.claims);
    }
    return adminResult;
  }

  return verifyFirebaseIdTokenWithLegacyLookup(idToken, now);
}

async function verifyFirebaseIdTokenWithAdmin(idToken) {
  if (FIREBASE_AUTH_MODE === "legacy") {
    return null;
  }

  const authClient = await getFirebaseAdminAuthClient();
  if (!authClient) {
    if (FIREBASE_AUTH_MODE === "admin") {
      return {
        ok: false,
        reason: "firebase_admin_unavailable",
      };
    }
    return null;
  }

  try {
    const decoded = await authClient.verifyIdToken(idToken, true);
    const audience = typeof decoded?.aud === "string" ? decoded.aud : "";
    const issuer = typeof decoded?.iss === "string" ? decoded.iss : "";
    if (FIREBASE_PROJECT_ID && audience && audience !== FIREBASE_PROJECT_ID) {
      return {
        ok: false,
        reason: "firebase_audience_mismatch",
      };
    }
    if (FIREBASE_PROJECT_ID && issuer) {
      const expectedIssuer = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
      if (issuer !== expectedIssuer) {
        return {
          ok: false,
          reason: "firebase_issuer_mismatch",
        };
      }
    }

    const signInProvider =
      typeof decoded?.firebase?.sign_in_provider === "string"
        ? decoded.firebase.sign_in_provider
        : "";
    const claims = {
      uid: typeof decoded?.uid === "string" ? decoded.uid : "",
      email: typeof decoded?.email === "string" ? decoded.email : undefined,
      name: typeof decoded?.name === "string" ? decoded.name : undefined,
      picture: typeof decoded?.picture === "string" ? decoded.picture : undefined,
      signInProvider,
      isAnonymous: signInProvider === "anonymous",
      expiresAt:
        typeof decoded?.exp === "number"
          ? decoded.exp * 1000
          : Date.now() + 5 * 60 * 1000,
    };

    if (!claims.uid) {
      return {
        ok: false,
        reason: "firebase_token_missing_uid",
      };
    }

    return {
      ok: true,
      claims,
    };
  } catch (error) {
    return {
      ok: false,
      reason: normalizeFirebaseAdminReason(error),
    };
  }
}

async function getFirebaseAdminAuthClient() {
  if (firebaseAdminAuthClientPromise) {
    return firebaseAdminAuthClientPromise;
  }

  firebaseAdminAuthClientPromise = (async () => {
    try {
      const [{ getApps, initializeApp, applicationDefault, cert }, { getAuth }] =
        await Promise.all([
          import("firebase-admin/app"),
          import("firebase-admin/auth"),
        ]);

      const existing = getApps()[0];
      const app =
        existing ??
        initializeApp(
          buildFirebaseAdminOptions({
            applicationDefault,
            cert,
          })
        );

      return getAuth(app);
    } catch (error) {
      const logMethod = FIREBASE_AUTH_MODE === "admin" ? "error" : "warn";
      log[logMethod]("Failed to initialize Firebase Admin auth verifier", error);
      return null;
    }
  })();

  return firebaseAdminAuthClientPromise;
}

function buildFirebaseAdminOptions({ applicationDefault, cert }) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!serviceAccountJson) {
    return {
      credential: applicationDefault(),
      projectId: FIREBASE_PROJECT_ID || undefined,
    };
  }

  const parsed = JSON.parse(serviceAccountJson);
  return {
    credential: cert(parsed),
    projectId: FIREBASE_PROJECT_ID || parsed.project_id || undefined,
  };
}

function normalizeFirebaseAdminReason(error) {
  const maybeCode =
    typeof error?.code === "string"
      ? error.code
      : typeof error?.errorInfo?.code === "string"
        ? error.errorInfo.code
        : "verification_failed";
  const normalizedCode = String(maybeCode).replace(/^auth\//, "");
  return `firebase_admin_${normalizeReason(normalizedCode)}`;
}

async function verifyFirebaseIdTokenWithLegacyLookup(idToken, now) {
  if (!FIREBASE_WEB_API_KEY) {
    return {
      ok: false,
      reason: "firebase_api_key_not_configured",
    };
  }

  const decoded = decodeJwtPayload(idToken);
  const audience = typeof decoded?.aud === "string" ? decoded.aud : "";
  const issuer = typeof decoded?.iss === "string" ? decoded.iss : "";
  if (FIREBASE_PROJECT_ID && audience && audience !== FIREBASE_PROJECT_ID) {
    log.warn(
      `Rejected Firebase token with mismatched project audience (expected=${FIREBASE_PROJECT_ID}, actual=${audience})`
    );
    return {
      ok: false,
      reason: "firebase_audience_mismatch",
    };
  }
  if (FIREBASE_PROJECT_ID && issuer) {
    const expectedIssuer = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
    if (issuer !== expectedIssuer) {
      log.warn(
        `Rejected Firebase token with mismatched issuer (expected=${expectedIssuer}, actual=${issuer})`
      );
      return {
        ok: false,
        reason: "firebase_issuer_mismatch",
      };
    }
  }

  const endpoint = new URL("https://identitytoolkit.googleapis.com/v1/accounts:lookup");
  endpoint.searchParams.set("key", FIREBASE_WEB_API_KEY);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idToken,
      }),
    });
  } catch (error) {
    log.warn("Failed to call Firebase accounts:lookup", error);
    return {
      ok: false,
      reason: "firebase_lookup_request_failed",
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    log.warn("Invalid Firebase accounts:lookup JSON response", error);
    return {
      ok: false,
      reason: "firebase_lookup_invalid_json",
    };
  }

  if (!response.ok) {
    const remoteMessage =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : `HTTP_${response.status}`;

    return {
      ok: false,
      reason: `firebase_lookup_${normalizeReason(remoteMessage)}`,
    };
  }

  const users = Array.isArray(payload?.users) ? payload.users : [];
  const user = users[0] ?? null;
  const uid =
    user && typeof user.localId === "string" ? user.localId.trim() : "";
  const exp = Number(decoded?.exp ?? 0);
  const expiresAt = Number.isFinite(exp) ? exp * 1000 : now + 5 * 60 * 1000;

  if (!uid) {
    return {
      ok: false,
      reason: "firebase_token_missing_uid",
    };
  }

  const claims = {
    uid,
    email: user && typeof user.email === "string" ? user.email : undefined,
    name:
      user && typeof user.displayName === "string"
        ? user.displayName
        : undefined,
    picture:
      user && typeof user.photoUrl === "string" ? user.photoUrl : undefined,
    signInProvider:
      typeof decoded?.firebase?.sign_in_provider === "string"
        ? decoded.firebase.sign_in_provider
        : (Array.isArray(user?.providerUserInfo) &&
            typeof user.providerUserInfo[0]?.providerId === "string"
          ? user.providerUserInfo[0].providerId
          : ""),
    isAnonymous:
      (typeof decoded?.firebase?.sign_in_provider === "string" &&
        decoded.firebase.sign_in_provider === "anonymous") ||
      (Array.isArray(user?.providerUserInfo) &&
        user.providerUserInfo.length === 0 &&
        typeof user?.email !== "string"),
    expiresAt,
  };

  firebaseTokenCache.set(idToken, claims);
  return {
    ok: true,
    claims,
  };
}

function decodeJwtPayload(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length < 2) {
    return null;
  }

  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padding = payload.length % 4 === 0 ? "" : "=".repeat(4 - (payload.length % 4));
  const normalized = payload + padding;

  try {
    const raw = Buffer.from(normalized, "base64").toString("utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeReason(message) {
  return String(message)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
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
  const turnState = ensureSessionTurnState(session);
  return {
    sessionId: session.sessionId,
    roomCode: session.roomCode,
    wsUrl: session.wsUrl,
    playerToken: auth.accessToken,
    auth,
    participants: serializeSessionParticipants(session),
    turnState: serializeTurnState(turnState),
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  };
}

function serializeTurnState(turnState) {
  if (!turnState) {
    return null;
  }

  return {
    order: Array.isArray(turnState.order) ? [...turnState.order] : [],
    activeTurnPlayerId:
      typeof turnState.activeTurnPlayerId === "string"
        ? turnState.activeTurnPlayerId
        : null,
    round: Number.isFinite(turnState.round) ? Number(turnState.round) : 1,
    turnNumber: Number.isFinite(turnState.turnNumber)
      ? Number(turnState.turnNumber)
      : 1,
    phase: normalizeTurnPhase(turnState.phase),
    activeRollServerId:
      typeof turnState?.lastRollSnapshot?.serverRollId === "string"
        ? turnState.lastRollSnapshot.serverRollId
        : null,
    updatedAt:
      Number.isFinite(turnState.updatedAt) ? Number(turnState.updatedAt) : Date.now(),
  };
}

function normalizeTurnPhase(value) {
  if (
    value === TURN_PHASES.awaitRoll ||
    value === TURN_PHASES.awaitScore ||
    value === TURN_PHASES.readyToEnd
  ) {
    return value;
  }
  return TURN_PHASES.awaitRoll;
}

function normalizeTurnRollSnapshot(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rollIndex = Number.isFinite(value.rollIndex) ? Math.floor(value.rollIndex) : NaN;
  const rawDice = Array.isArray(value.dice) ? value.dice : null;
  if (!Number.isFinite(rollIndex) || rollIndex <= 0 || !rawDice || rawDice.length === 0) {
    return null;
  }

  const dice = [];
  const seenIds = new Set();
  for (const die of rawDice.slice(0, MAX_TURN_ROLL_DICE)) {
    if (!die || typeof die !== "object") {
      continue;
    }
    const dieId = typeof die.dieId === "string" ? die.dieId.trim() : "";
    const sides = Number.isFinite(die.sides) ? Math.floor(die.sides) : NaN;
    const valueAtFace = Number.isFinite(die.value) ? Math.floor(die.value) : NaN;
    if (!dieId || seenIds.has(dieId)) {
      continue;
    }
    if (!Number.isFinite(sides) || sides < 2 || sides > 1000) {
      continue;
    }
    if (!Number.isFinite(valueAtFace) || valueAtFace < 1 || valueAtFace > sides) {
      continue;
    }
    seenIds.add(dieId);
    dice.push({
      dieId,
      sides,
      value: valueAtFace,
    });
  }

  if (dice.length === 0) {
    return null;
  }

  return {
    rollIndex,
    dice,
    serverRollId:
      typeof value.serverRollId === "string" && value.serverRollId
        ? value.serverRollId
        : randomUUID(),
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
  };
}

function normalizeTurnScoreSummary(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const selectedDiceIds = Array.isArray(value.selectedDiceIds)
    ? value.selectedDiceIds
        .filter((id) => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
        .slice(0, MAX_TURN_SCORE_SELECTION)
    : [];
  const points = Number.isFinite(value.points) ? Math.floor(value.points) : NaN;
  const expectedPoints = Number.isFinite(value.expectedPoints)
    ? Math.floor(value.expectedPoints)
    : NaN;
  if (
    selectedDiceIds.length === 0 ||
    !Number.isFinite(points) ||
    points < 0 ||
    !Number.isFinite(expectedPoints) ||
    expectedPoints < 0
  ) {
    return null;
  }

  const projectedTotalScore = Number.isFinite(value.projectedTotalScore)
    ? Math.floor(value.projectedTotalScore)
    : null;
  const rollServerId =
    typeof value.rollServerId === "string" && value.rollServerId
      ? value.rollServerId
      : "";
  if (!rollServerId) {
    return null;
  }
  return {
    selectedDiceIds,
    points,
    expectedPoints,
    rollServerId,
    projectedTotalScore:
      Number.isFinite(projectedTotalScore) && projectedTotalScore >= 0
        ? projectedTotalScore
        : null,
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
  };
}

function parseTurnRollPayload(payload) {
  const roll = payload?.roll;
  if (!roll || typeof roll !== "object") {
    return { ok: false, reason: "missing_roll_payload" };
  }

  const rollIndex = Number.isFinite(roll.rollIndex) ? Math.floor(roll.rollIndex) : NaN;
  const rawDice = Array.isArray(roll.dice) ? roll.dice : null;
  if (!Number.isFinite(rollIndex) || rollIndex <= 0 || !rawDice || rawDice.length === 0) {
    return { ok: false, reason: "invalid_roll_payload" };
  }
  if (rawDice.length > MAX_TURN_ROLL_DICE) {
    return { ok: false, reason: "roll_payload_too_large" };
  }

  const dice = [];
  const seenIds = new Set();
  for (const die of rawDice) {
    if (!die || typeof die !== "object") {
      return { ok: false, reason: "invalid_roll_die" };
    }
    const dieId = typeof die.dieId === "string" ? die.dieId.trim() : "";
    const sides = Number.isFinite(die.sides) ? Math.floor(die.sides) : NaN;
    const valueAtFace = Number.isFinite(die.value) ? Math.floor(die.value) : NaN;
    if (!dieId || seenIds.has(dieId)) {
      return { ok: false, reason: "invalid_roll_die_id" };
    }
    if (!Number.isFinite(sides) || sides < 2 || sides > 1000) {
      return { ok: false, reason: "invalid_roll_die_sides" };
    }
    if (!Number.isFinite(valueAtFace) || valueAtFace < 1 || valueAtFace > sides) {
      return { ok: false, reason: "invalid_roll_die_value" };
    }
    seenIds.add(dieId);
    dice.push({
      dieId,
      sides,
      value: valueAtFace,
    });
  }

  return {
    ok: true,
    value: {
      rollIndex,
      dice,
      serverRollId: randomUUID(),
      updatedAt: Date.now(),
    },
  };
}

function parseTurnScorePayload(payload, lastRollSnapshot) {
  if (!lastRollSnapshot?.dice || !Array.isArray(lastRollSnapshot.dice)) {
    return { ok: false, reason: "missing_roll_snapshot" };
  }

  const score = payload?.score;
  if (!score || typeof score !== "object") {
    return { ok: false, reason: "missing_score_payload" };
  }

  const rawSelected = Array.isArray(score.selectedDiceIds) ? score.selectedDiceIds : null;
  if (!rawSelected || rawSelected.length === 0) {
    return { ok: false, reason: "missing_selected_dice" };
  }
  if (rawSelected.length > MAX_TURN_SCORE_SELECTION) {
    return { ok: false, reason: "score_payload_too_large" };
  }

  const selectedDiceIds = [];
  const selectedSet = new Set();
  for (const dieIdRaw of rawSelected) {
    const dieId = typeof dieIdRaw === "string" ? dieIdRaw.trim() : "";
    if (!dieId || selectedSet.has(dieId)) {
      return { ok: false, reason: "invalid_selected_dice" };
    }
    selectedSet.add(dieId);
    selectedDiceIds.push(dieId);
  }

  const points = Number.isFinite(score.points) ? Math.floor(score.points) : NaN;
  if (!Number.isFinite(points) || points < 0) {
    return { ok: false, reason: "invalid_score_points" };
  }
  const rollServerId = typeof score.rollServerId === "string" ? score.rollServerId.trim() : "";
  if (!rollServerId) {
    return { ok: false, reason: "missing_score_roll_id" };
  }
  const expectedRollServerId =
    typeof lastRollSnapshot.serverRollId === "string" ? lastRollSnapshot.serverRollId : "";
  if (!expectedRollServerId || rollServerId !== expectedRollServerId) {
    return { ok: false, reason: "score_roll_mismatch" };
  }

  const rollById = new Map();
  lastRollSnapshot.dice.forEach((die) => {
    if (!die || typeof die !== "object") {
      return;
    }
    if (typeof die.dieId !== "string") {
      return;
    }
    const sides = Number.isFinite(die.sides) ? Math.floor(die.sides) : NaN;
    const valueAtFace = Number.isFinite(die.value) ? Math.floor(die.value) : NaN;
    if (!Number.isFinite(sides) || !Number.isFinite(valueAtFace)) {
      return;
    }
    rollById.set(die.dieId, { sides, value: valueAtFace });
  });
  if (rollById.size === 0) {
    return { ok: false, reason: "invalid_roll_snapshot" };
  }

  let expectedPoints = 0;
  for (const dieId of selectedDiceIds) {
    const die = rollById.get(dieId);
    if (!die) {
      return { ok: false, reason: "selected_die_not_in_roll" };
    }
    expectedPoints += die.sides - die.value;
  }

  if (points !== expectedPoints) {
    return { ok: false, reason: "score_points_mismatch", expectedPoints };
  }

  const projectedTotalScore = Number.isFinite(score.projectedTotalScore)
    ? Math.floor(score.projectedTotalScore)
    : null;

  return {
    ok: true,
    value: {
      selectedDiceIds,
      points,
      expectedPoints,
      rollServerId,
      projectedTotalScore:
        Number.isFinite(projectedTotalScore) && projectedTotalScore >= 0
          ? projectedTotalScore
          : null,
      updatedAt: Date.now(),
    },
  };
}

function serializeSessionParticipants(session) {
  const participants = Object.values(session?.participants ?? {})
    .filter((participant) => participant && typeof participant.playerId === "string")
    .map((participant) => ({
      playerId: participant.playerId,
      displayName:
        typeof participant.displayName === "string" ? participant.displayName : undefined,
      joinedAt:
        typeof participant.joinedAt === "number" ? participant.joinedAt : Date.now(),
      lastHeartbeatAt:
        typeof participant.lastHeartbeatAt === "number"
          ? participant.lastHeartbeatAt
          : Date.now(),
      isBot: Boolean(participant.isBot),
    }))
    .sort((left, right) => {
      const joinedDelta = left.joinedAt - right.joinedAt;
      if (joinedDelta !== 0) {
        return joinedDelta;
      }
      return left.playerId.localeCompare(right.playerId);
    });

  return participants;
}

function serializeParticipantsInJoinOrder(session) {
  return Object.values(session?.participants ?? {})
    .filter((participant) => participant && typeof participant.playerId === "string")
    .map((participant) => ({
      playerId: participant.playerId,
      joinedAt:
        typeof participant.joinedAt === "number" && Number.isFinite(participant.joinedAt)
          ? participant.joinedAt
          : 0,
    }))
    .sort((left, right) => {
      const joinedDelta = left.joinedAt - right.joinedAt;
      if (joinedDelta !== 0) {
        return joinedDelta;
      }
      return left.playerId.localeCompare(right.playerId);
    });
}

function ensureSessionTurnState(session) {
  if (!session) {
    return null;
  }

  const orderedParticipants = serializeParticipantsInJoinOrder(session);
  const participantIds = orderedParticipants.map((participant) => participant.playerId);
  const participantIdSet = new Set(participantIds);
  const currentState = session.turnState ?? null;
  const nextOrder = [];

  if (Array.isArray(currentState?.order)) {
    currentState.order.forEach((playerId) => {
      if (participantIdSet.has(playerId) && !nextOrder.includes(playerId)) {
        nextOrder.push(playerId);
      }
    });
  }

  participantIds.forEach((playerId) => {
    if (!nextOrder.includes(playerId)) {
      nextOrder.push(playerId);
    }
  });

  const now = Date.now();
  let activeTurnPlayerId =
    typeof currentState?.activeTurnPlayerId === "string"
      ? currentState.activeTurnPlayerId
      : null;
  let activeTurnRecovered = false;
  if (!activeTurnPlayerId || !nextOrder.includes(activeTurnPlayerId)) {
    activeTurnPlayerId = nextOrder[0] ?? null;
    activeTurnRecovered = true;
  }

  const round =
    typeof currentState?.round === "number" && Number.isFinite(currentState.round) && currentState.round > 0
      ? Math.floor(currentState.round)
      : 1;
  const turnNumber =
    typeof currentState?.turnNumber === "number" &&
    Number.isFinite(currentState.turnNumber) &&
    currentState.turnNumber > 0
      ? Math.floor(currentState.turnNumber)
      : 1;
  let phase = normalizeTurnPhase(currentState?.phase);
  let lastRollSnapshot = normalizeTurnRollSnapshot(currentState?.lastRollSnapshot);
  let lastScoreSummary = normalizeTurnScoreSummary(currentState?.lastScoreSummary);

  if (activeTurnRecovered) {
    phase = TURN_PHASES.awaitRoll;
    lastRollSnapshot = null;
    lastScoreSummary = null;
  } else if (phase === TURN_PHASES.awaitRoll) {
    lastRollSnapshot = null;
    lastScoreSummary = null;
  } else if (phase === TURN_PHASES.awaitScore && !lastRollSnapshot) {
    phase = TURN_PHASES.awaitRoll;
    lastScoreSummary = null;
  } else if (phase === TURN_PHASES.readyToEnd) {
    if (!lastRollSnapshot) {
      phase = TURN_PHASES.awaitRoll;
      lastScoreSummary = null;
    } else if (!lastScoreSummary) {
      phase = TURN_PHASES.awaitScore;
    } else if (lastScoreSummary.rollServerId !== lastRollSnapshot.serverRollId) {
      phase = TURN_PHASES.awaitScore;
      lastScoreSummary = null;
    }
  }

  session.turnState = {
    order: nextOrder,
    activeTurnPlayerId,
    round,
    turnNumber,
    phase,
    lastRollSnapshot,
    lastScoreSummary,
    updatedAt: now,
  };

  if (!session.turnState.activeTurnPlayerId && session.turnState.order.length > 0) {
    session.turnState.activeTurnPlayerId = session.turnState.order[0];
  }

  return session.turnState;
}

function buildTurnStartMessage(session, options = {}) {
  const turnState = ensureSessionTurnState(session);
  if (!turnState?.activeTurnPlayerId) {
    return null;
  }

  return {
    type: "turn_start",
    sessionId: session.sessionId,
    playerId: turnState.activeTurnPlayerId,
    round: turnState.round,
    turnNumber: turnState.turnNumber,
    phase: normalizeTurnPhase(turnState.phase),
    activeRollServerId:
      typeof turnState?.lastRollSnapshot?.serverRollId === "string"
        ? turnState.lastRollSnapshot.serverRollId
        : null,
    timestamp: Date.now(),
    order: [...turnState.order],
    source: options.source ?? "server",
  };
}

function buildTurnEndMessage(session, playerId, options = {}) {
  const turnState = ensureSessionTurnState(session);
  if (!turnState) {
    return null;
  }

  return {
    type: "turn_end",
    sessionId: session.sessionId,
    playerId,
    round: turnState.round,
    turnNumber: turnState.turnNumber,
    timestamp: Date.now(),
    source: options.source ?? "player",
  };
}

function buildTurnActionMessage(session, playerId, action, details = {}, options = {}) {
  const turnState = ensureSessionTurnState(session);
  if (!turnState) {
    return null;
  }

  return {
    type: "turn_action",
    sessionId: session.sessionId,
    playerId,
    action,
    ...(details.roll ? { roll: details.roll } : {}),
    ...(details.score ? { score: details.score } : {}),
    round: turnState.round,
    turnNumber: turnState.turnNumber,
    phase: normalizeTurnPhase(turnState.phase),
    timestamp: Date.now(),
    source: options.source ?? "player",
  };
}

function advanceSessionTurn(session, endedByPlayerId, options = {}) {
  const turnState = ensureSessionTurnState(session);
  if (!turnState || turnState.order.length === 0 || !turnState.activeTurnPlayerId) {
    return null;
  }

  if (turnState.activeTurnPlayerId !== endedByPlayerId) {
    return null;
  }

  const currentIndex = turnState.order.indexOf(endedByPlayerId);
  if (currentIndex < 0) {
    return null;
  }

  const timestamp = Date.now();
  const turnEnd = {
    type: "turn_end",
    sessionId: session.sessionId,
    playerId: endedByPlayerId,
    round: turnState.round,
    turnNumber: turnState.turnNumber,
    timestamp,
    source: options.source ?? "player",
  };

  const nextIndex = (currentIndex + 1) % turnState.order.length;
  const wrapped = nextIndex === 0;
  turnState.activeTurnPlayerId = turnState.order[nextIndex];
  turnState.turnNumber = Math.max(1, Math.floor(turnState.turnNumber) + 1);
  if (wrapped) {
    turnState.round = Math.max(1, Math.floor(turnState.round) + 1);
  }
  turnState.phase = TURN_PHASES.awaitRoll;
  turnState.lastRollSnapshot = null;
  turnState.lastScoreSummary = null;
  turnState.updatedAt = timestamp;

  const turnStart = {
    type: "turn_start",
    sessionId: session.sessionId,
    playerId: turnState.activeTurnPlayerId,
    round: turnState.round,
    turnNumber: turnState.turnNumber,
    phase: normalizeTurnPhase(turnState.phase),
    timestamp,
    order: [...turnState.order],
    source: options.source ?? "player",
  };

  return {
    turnEnd,
    turnStart,
  };
}

function normalizeRoomCode(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().toUpperCase().slice(0, 8);
  }
  return randomToken().slice(0, 6).toUpperCase();
}

function normalizeBotCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(MAX_MULTIPLAYER_BOTS, Math.floor(parsed)));
}

function isBotParticipant(participant) {
  return Boolean(participant?.isBot);
}

function getHumanParticipantCount(session) {
  if (!session?.participants) {
    return 0;
  }
  return Object.values(session.participants).filter((participant) => participant && !isBotParticipant(participant))
    .length;
}

function getBotParticipants(session) {
  if (!session?.participants) {
    return [];
  }
  return Object.values(session.participants).filter((participant) => participant && isBotParticipant(participant));
}

function reconcileBotLoop(sessionId) {
  const session = store.multiplayerSessions[sessionId];
  if (!session) {
    stopBotLoop(sessionId);
    return;
  }

  ensureSessionTurnState(session);

  if (getBotParticipants(session).length === 0) {
    stopBotLoop(sessionId);
    return;
  }

  if (botSessionLoops.has(sessionId)) {
    return;
  }

  botSessionLoops.set(sessionId, {
    timer: null,
    turnTimer: null,
  });
  scheduleNextBotTick(sessionId);
  scheduleBotTurnIfNeeded(sessionId);
}

function stopBotLoop(sessionId) {
  const existing = botSessionLoops.get(sessionId);
  if (!existing) {
    return;
  }
  if (existing.timer) {
    clearTimeout(existing.timer);
  }
  if (existing.turnTimer) {
    clearTimeout(existing.turnTimer);
  }
  botSessionLoops.delete(sessionId);
}

function scheduleNextBotTick(sessionId) {
  const loop = botSessionLoops.get(sessionId);
  if (!loop) {
    return;
  }

  const session = store.multiplayerSessions[sessionId];
  if (!session) {
    stopBotLoop(sessionId);
    return;
  }

  const delay = BOT_TICK_MIN_MS + Math.floor(Math.random() * (BOT_TICK_MAX_MS - BOT_TICK_MIN_MS + 1));
  loop.timer = setTimeout(() => {
    loop.timer = null;
    dispatchBotMessage(sessionId);
    scheduleNextBotTick(sessionId);
  }, delay);
}

function dispatchBotMessage(sessionId) {
  const session = store.multiplayerSessions[sessionId];
  if (!session) {
    stopBotLoop(sessionId);
    return;
  }

  const bots = getBotParticipants(session);
  if (bots.length === 0) {
    stopBotLoop(sessionId);
    return;
  }

  const humans = Object.values(session.participants).filter(
    (participant) => participant && !isBotParticipant(participant)
  );
  if (humans.length === 0) {
    return;
  }

  const connectedHumans = humans.filter((participant) =>
    isSessionParticipantConnected(sessionId, participant.playerId)
  );
  if (connectedHumans.length === 0) {
    return;
  }

  const actor = bots[Math.floor(Math.random() * bots.length)];
  const target = connectedHumans[Math.floor(Math.random() * connectedHumans.length)];
  const payload = buildBotSocketPayload(sessionId, actor, target, connectedHumans.length);
  if (!payload) {
    return;
  }

  broadcastToSession(sessionId, JSON.stringify(payload), null);
}

function scheduleBotTurnIfNeeded(sessionId) {
  const loop = botSessionLoops.get(sessionId);
  const session = store.multiplayerSessions[sessionId];
  if (!loop || !session) {
    return;
  }

  if (loop.turnTimer) {
    clearTimeout(loop.turnTimer);
    loop.turnTimer = null;
  }

  const turnState = ensureSessionTurnState(session);
  const activePlayerId = turnState?.activeTurnPlayerId;
  if (!activePlayerId) {
    return;
  }

  const activeParticipant = session.participants[activePlayerId];
  if (!isBotParticipant(activeParticipant)) {
    return;
  }

  const hasConnectedHuman = Object.values(session.participants).some(
    (participant) =>
      participant &&
      !isBotParticipant(participant) &&
      isSessionParticipantConnected(sessionId, participant.playerId)
  );
  if (!hasConnectedHuman) {
    return;
  }

  const delayMs =
    BOT_TURN_ADVANCE_MIN_MS +
    Math.floor(Math.random() * (BOT_TURN_ADVANCE_MAX_MS - BOT_TURN_ADVANCE_MIN_MS + 1));
  loop.turnTimer = setTimeout(() => {
    loop.turnTimer = null;
    const latestSession = store.multiplayerSessions[sessionId];
    if (!latestSession) {
      return;
    }
    const advanced = advanceSessionTurn(latestSession, activePlayerId, {
      source: "bot_auto",
    });
    if (!advanced) {
      return;
    }

    broadcastToSession(sessionId, JSON.stringify(advanced.turnEnd), null);
    broadcastToSession(sessionId, JSON.stringify(advanced.turnStart), null);
    persistStore().catch((error) => {
      log.warn("Failed to persist session after bot turn advance", error);
    });
    scheduleBotTurnIfNeeded(sessionId);
  }, delayMs);
}

function isSessionParticipantConnected(sessionId, playerId) {
  const clients = wsSessionClients.get(sessionId);
  if (!clients || clients.size === 0) {
    return false;
  }

  for (const client of clients) {
    if (!client || client.playerId !== playerId || client.closed || client.socket.destroyed) {
      continue;
    }
    return true;
  }

  return false;
}

function buildBotSocketPayload(sessionId, actor, target, connectedHumanCount) {
  if (!actor || !target) {
    return null;
  }

  const now = Date.now();
  const actorName = actor.displayName || actor.playerId;
  const roll = Math.random();

  if (roll < 0.74) {
    return {
      type: "player_notification",
      bot: true,
      id: randomUUID(),
      title: actorName,
      message: `${actorName} cheers from the sidelines. ${connectedHumanCount} player${connectedHumanCount === 1 ? "" : "s"} connected.`,
      severity: "info",
      targetPlayerId: target.playerId,
      timestamp: now,
    };
  }

  if (roll < 0.96) {
    return {
      type: "game_update",
      bot: true,
      id: randomUUID(),
      title: `${actorName} update`,
      content: `${actorName} is watching your turn queue. Keep the score low.`,
      date: new Date(now).toISOString(),
      version: "bot",
      updateType: "announcement",
      timestamp: now,
    };
  }

  const effectType = BOT_CAMERA_EFFECTS[Math.floor(Math.random() * BOT_CAMERA_EFFECTS.length)];
  return {
    type: "chaos_attack",
    bot: true,
    id: randomUUID(),
    attackType: "camera_effect",
    gameId: typeof sessionId === "string" && sessionId ? sessionId : "bot-session",
    attackerId: actor.playerId,
    targetId: target.playerId,
    abilityId: "screen_shake",
    effectType,
    intensity: 0.18,
    duration: 500 + Math.floor(Math.random() * 500),
    level: 1,
    chaosPointsCost: 1,
    timestamp: now,
  };
}

function parseLeaderboardPayload(body) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const scoreId = normalizeIdentifier(body.scoreId, `score-${randomUUID()}`);
  const score = Number(body.score);
  const duration = Number(body.duration ?? 0);
  const rollCount = Number(body.rollCount ?? 0);
  if (!Number.isFinite(score) || score < 0) {
    return null;
  }

  const parsed = {
    scoreId,
    score,
    timestamp: Number.isFinite(Number(body.timestamp)) ? Number(body.timestamp) : undefined,
    seed: typeof body.seed === "string" ? body.seed.slice(0, 120) : undefined,
    duration: Number.isFinite(duration) && duration >= 0 ? duration : 0,
    rollCount: Number.isFinite(rollCount) && rollCount >= 0 ? Math.floor(rollCount) : 0,
    playerName: sanitizeDisplayName(body.playerName) ?? undefined,
    mode: sanitizeLeaderboardMode(body.mode),
  };

  return parsed;
}

function sanitizeLeaderboardMode(mode) {
  if (!mode || typeof mode !== "object") {
    return undefined;
  }

  const difficulty = typeof mode.difficulty === "string" ? mode.difficulty.trim() : "";
  const variant = typeof mode.variant === "string" ? mode.variant.trim() : "";

  return {
    difficulty: difficulty || "normal",
    variant: variant || "classic",
  };
}

function normalizeIdentifier(rawValue, fallback) {
  if (typeof rawValue !== "string") {
    return fallback;
  }

  const normalized = rawValue.trim().replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 120);
  return normalized || fallback;
}

function sanitizeDisplayName(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length < 2 || normalized.length > 24) {
    return null;
  }

  return normalized;
}

function upsertFirebasePlayer(uid, patch) {
  if (!uid) return;
  const current = store.firebasePlayers[uid] ?? { uid };

  store.firebasePlayers[uid] = {
    ...current,
    ...patch,
    uid,
    updatedAt: Date.now(),
  };
}

function compareLeaderboardEntries(left, right) {
  const scoreDelta = Number(left.score ?? 0) - Number(right.score ?? 0);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const durationDelta = Number(left.duration ?? 0) - Number(right.duration ?? 0);
  if (durationDelta !== 0) {
    return durationDelta;
  }

  const rollDelta = Number(left.rollCount ?? 0) - Number(right.rollCount ?? 0);
  if (rollDelta !== 0) {
    return rollDelta;
  }

  const timestampDelta = Number(left.timestamp ?? 0) - Number(right.timestamp ?? 0);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  return String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

function trimLeaderboardScores(maxEntries) {
  const ids = Object.keys(store.leaderboardScores);
  if (ids.length <= maxEntries) {
    return;
  }

  const sorted = Object.values(store.leaderboardScores).sort(compareLeaderboardEntries);
  const keep = new Set(sorted.slice(0, maxEntries).map((entry) => entry.id));
  ids.forEach((id) => {
    if (!keep.has(id)) {
      delete store.leaderboardScores[id];
    }
  });
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

  const session = store.multiplayerSessions[client.sessionId];
  if (session) {
    const turnStart = buildTurnStartMessage(session, { source: "sync" });
    if (turnStart) {
      sendSocketPayload(client, turnStart);
    }
    scheduleBotTurnIfNeeded(client.sessionId);
  }

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

  if (payload.type === "turn_end") {
    handleTurnEndMessage(client, session);
    return;
  }

  if (payload.type === "turn_action") {
    handleTurnActionMessage(client, session, payload);
    return;
  }

  session.participants[client.playerId].lastHeartbeatAt = Date.now();
  broadcastToSession(client.sessionId, rawMessage, client);
}

function isSupportedSocketPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const messageType = payload.type;
  if (messageType === "chaos_attack" || messageType === "particle:emit") {
    return true;
  }
  if (messageType === "game_update") {
    return (
      typeof payload.title === "string" &&
      payload.title.trim().length > 0 &&
      typeof payload.content === "string" &&
      payload.content.trim().length > 0
    );
  }
  if (messageType === "player_notification") {
    return (
      typeof payload.message === "string" &&
      payload.message.trim().length > 0
    );
  }
  if (messageType === "turn_end") {
    return true;
  }
  if (messageType === "turn_action") {
    return payload.action === "roll" || payload.action === "score";
  }
  return false;
}

function handleTurnActionMessage(client, session, payload) {
  session.participants[client.playerId].lastHeartbeatAt = Date.now();
  const turnState = ensureSessionTurnState(session);
  if (!turnState?.activeTurnPlayerId) {
    sendSocketError(client, "turn_unavailable", "turn_unavailable");
    return;
  }

  if (turnState.activeTurnPlayerId !== client.playerId) {
    sendSocketError(client, "turn_not_active", "not_your_turn");
    const syncMessage = buildTurnStartMessage(session, { source: "sync" });
    if (syncMessage) {
      sendSocketPayload(client, syncMessage);
    }
    return;
  }

  const action = payload.action === "score" ? "score" : "roll";
  const currentPhase = normalizeTurnPhase(turnState.phase);
  if (action === "roll" && currentPhase !== TURN_PHASES.awaitRoll) {
    sendSocketError(client, "turn_action_invalid_phase", "roll_not_expected");
    const syncMessage = buildTurnStartMessage(session, { source: "sync" });
    if (syncMessage) {
      sendSocketPayload(client, syncMessage);
    }
    return;
  }
  if (action === "score" && currentPhase !== TURN_PHASES.awaitScore) {
    sendSocketError(client, "turn_action_invalid_phase", "score_not_expected");
    const syncMessage = buildTurnStartMessage(session, { source: "sync" });
    if (syncMessage) {
      sendSocketPayload(client, syncMessage);
    }
    return;
  }

  let details = {};
  if (action === "roll") {
    const parsedRoll = parseTurnRollPayload(payload);
    if (!parsedRoll.ok) {
      sendSocketError(client, "turn_action_invalid_payload", parsedRoll.reason);
      const syncMessage = buildTurnStartMessage(session, { source: "sync" });
      if (syncMessage) {
        sendSocketPayload(client, syncMessage);
      }
      return;
    }

    turnState.lastRollSnapshot = parsedRoll.value;
    turnState.lastScoreSummary = null;
    turnState.phase = TURN_PHASES.awaitScore;
    details = { roll: parsedRoll.value };
  } else {
    const parsedScore = parseTurnScorePayload(payload, turnState.lastRollSnapshot);
    if (!parsedScore.ok) {
      const code =
        parsedScore.reason === "score_points_mismatch" ||
        parsedScore.reason === "score_roll_mismatch"
          ? "turn_action_invalid_score"
          : "turn_action_invalid_payload";
      sendSocketError(client, code, parsedScore.reason);
      const syncMessage = buildTurnStartMessage(session, { source: "sync" });
      if (syncMessage) {
        sendSocketPayload(client, syncMessage);
      }
      return;
    }

    turnState.lastScoreSummary = parsedScore.value;
    turnState.phase = TURN_PHASES.readyToEnd;
    details = { score: parsedScore.value };
  }

  turnState.updatedAt = Date.now();
  const message = buildTurnActionMessage(
    session,
    client.playerId,
    action,
    details,
    {
      source: "player",
    }
  );
  if (message) {
    broadcastToSession(client.sessionId, JSON.stringify(message), null);
  }
  persistStore().catch((error) => {
    log.warn("Failed to persist session after turn action", error);
  });
}

function handleTurnEndMessage(client, session) {
  session.participants[client.playerId].lastHeartbeatAt = Date.now();
  const turnState = ensureSessionTurnState(session);
  log.info(
    `Turn end request: session=${client.sessionId} player=${client.playerId} active=${turnState?.activeTurnPlayerId ?? "n/a"} order=${Array.isArray(turnState?.order) ? turnState.order.join(",") : "n/a"}`
  );
  if (!turnState?.activeTurnPlayerId) {
    sendSocketError(client, "turn_unavailable", "turn_unavailable");
    return;
  }

  if (turnState.activeTurnPlayerId !== client.playerId) {
    sendSocketError(client, "turn_not_active", "not_your_turn");
    const syncMessage = buildTurnStartMessage(session, { source: "sync" });
    if (syncMessage) {
      sendSocketPayload(client, syncMessage);
    }
    return;
  }

  if (normalizeTurnPhase(turnState.phase) !== TURN_PHASES.readyToEnd) {
    sendSocketError(client, "turn_action_required", "score_required_before_turn_end");
    const syncMessage = buildTurnStartMessage(session, { source: "sync" });
    if (syncMessage) {
      sendSocketPayload(client, syncMessage);
    }
    return;
  }

  const advanced = advanceSessionTurn(session, client.playerId, { source: "player" });
  if (!advanced) {
    sendSocketError(client, "turn_advance_failed", "turn_advance_failed");
    return;
  }
  log.info(
    `Turn advanced: session=${client.sessionId} endedBy=${advanced.turnEnd.playerId} next=${advanced.turnStart.playerId} round=${advanced.turnStart.round} turn=${advanced.turnStart.turnNumber}`
  );

  broadcastToSession(client.sessionId, JSON.stringify(advanced.turnEnd), null);
  broadcastToSession(client.sessionId, JSON.stringify(advanced.turnStart), null);
  persistStore().catch((error) => {
    log.warn("Failed to persist session after turn advance", error);
  });
  scheduleBotTurnIfNeeded(client.sessionId);
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
  stopBotLoop(sessionId);
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

function sendSocketPayload(client, payload) {
  if (!client || client.closed || client.socket.destroyed) return;
  try {
    const raw = JSON.stringify(payload);
    writeSocketFrame(client.socket, 0x1, Buffer.from(raw, "utf8"));
  } catch (error) {
    log.warn("Failed to send WebSocket payload", error);
  }
}

function sendSocketError(client, code, message) {
  if (client.closed || client.socket.destroyed) return;
  const payload = {
    type: "error",
    code,
    message,
  };
  sendSocketPayload(client, payload);
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
  if (!storeAdapter) {
    return;
  }
  await storeAdapter.save(store);
}

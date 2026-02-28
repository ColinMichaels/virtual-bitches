import { createServer } from "node:http";
import { randomBytes, randomInt, randomUUID, createHash } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.mjs";
import { createStoreAdapter, DEFAULT_STORE } from "./storage/index.mjs";
import { createBotEngine } from "./bot/engine.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3000);
const API_PREFIX = "/api";
const DATA_DIR = resolveDataDir(process.env.API_DATA_DIR);
const DATA_FILE = resolveDataFile(process.env.API_DATA_FILE, DATA_DIR);
const WS_BASE_URL = process.env.WS_BASE_URL ?? "ws://localhost:3000";
const NODE_ENV = (process.env.NODE_ENV ?? "development").trim().toLowerCase();
const STORE_BACKEND = resolveStoreBackend(process.env.API_STORE_BACKEND, NODE_ENV);
const ALLOW_FILE_STORE_IN_PRODUCTION = process.env.API_ALLOW_FILE_STORE_IN_PRODUCTION === "1";
const FIRESTORE_COLLECTION_PREFIX = (process.env.API_FIRESTORE_PREFIX ?? "api_v1").trim();
const FIREBASE_PROJECT_ID =
  (process.env.FIREBASE_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    "").trim();
const FIREBASE_WEB_API_KEY = (process.env.FIREBASE_WEB_API_KEY ?? "").trim();
const FIREBASE_AUTH_MODE = (process.env.FIREBASE_AUTH_MODE ?? "auto").trim().toLowerCase();
const ADMIN_ACCESS_MODE = normalizeAdminAccessMode(process.env.API_ADMIN_ACCESS_MODE);
const ADMIN_TOKEN = (process.env.API_ADMIN_TOKEN ?? "").trim();
const ADMIN_OWNER_UID_ALLOWLIST = parseDelimitedEnvSet(process.env.API_ADMIN_OWNER_UIDS, (value) =>
  value.replace(/\s+/g, "")
);
const ADMIN_OWNER_EMAIL_ALLOWLIST = parseDelimitedEnvSet(process.env.API_ADMIN_OWNER_EMAILS, (value) =>
  value.toLowerCase()
);
const ROOM_CHANNEL_BAD_PLAYER_IDS = parseDelimitedEnvSet(
  process.env.MULTIPLAYER_ROOM_CHANNEL_BAD_PLAYER_IDS,
  (value) => value.replace(/\s+/g, "")
);
const ROOM_CHANNEL_BAD_TERMS = parseDelimitedEnvSet(
  process.env.MULTIPLAYER_ROOM_CHANNEL_BAD_TERMS,
  (value) => value.toLowerCase()
);
const log = logger.create("Server");
const ALLOW_SHORT_SESSION_TTLS = process.env.ALLOW_SHORT_SESSION_TTLS === "1";
const SESSION_IDLE_TTL_MIN_MS = ALLOW_SHORT_SESSION_TTLS ? 2000 : 60 * 1000;

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MULTIPLAYER_SESSION_IDLE_TTL_MS = normalizeSessionIdleTtlValue(
  process.env.MULTIPLAYER_SESSION_IDLE_TTL_MS,
  30 * 60 * 1000
);
const MULTIPLAYER_ROOM_ACTIVE_WINDOW_MS = normalizeSessionIdleTtlValue(
  process.env.MULTIPLAYER_ROOM_ACTIVE_WINDOW_MS,
  45 * 1000
);
const MULTIPLAYER_ROOM_LIST_LIMIT_MAX = 100;
const MULTIPLAYER_ROOM_LIST_LIMIT_DEFAULT = 24;
const ADMIN_ROOM_LIST_LIMIT_MAX = 200;
const ADMIN_ROOM_LIST_LIMIT_DEFAULT = 60;
const ADMIN_AUDIT_LIST_LIMIT_MAX = 250;
const ADMIN_AUDIT_LIST_LIMIT_DEFAULT = 60;
const MAX_MULTIPLAYER_HUMAN_PLAYERS = normalizeHumanPlayerLimitValue(
  process.env.MULTIPLAYER_MAX_HUMAN_PLAYERS,
  8
);
const PUBLIC_ROOM_BASE_COUNT = normalizePublicRoomCountValue(
  process.env.PUBLIC_ROOM_BASE_COUNT,
  2
);
const PUBLIC_ROOM_DIFFICULTY_ORDER = ["normal", "easy", "hard"];
const PUBLIC_ROOM_MIN_PER_DIFFICULTY = normalizePublicRoomCountValue(
  process.env.PUBLIC_ROOM_MIN_PER_DIFFICULTY,
  1
);
const PUBLIC_ROOM_DEFAULT_TARGET_COUNT = Math.max(
  PUBLIC_ROOM_BASE_COUNT,
  PUBLIC_ROOM_MIN_PER_DIFFICULTY * PUBLIC_ROOM_DIFFICULTY_ORDER.length
);
const PUBLIC_ROOM_MIN_JOINABLE = normalizePublicRoomCountValue(
  process.env.PUBLIC_ROOM_MIN_JOINABLE,
  PUBLIC_ROOM_BASE_COUNT
);
const PUBLIC_ROOM_OVERFLOW_EMPTY_TTL_MS = normalizeSessionIdleTtlValue(
  process.env.PUBLIC_ROOM_OVERFLOW_EMPTY_TTL_MS,
  MULTIPLAYER_SESSION_IDLE_TTL_MS
);
const PUBLIC_ROOM_STALE_PARTICIPANT_MS = normalizeSessionIdleTtlValue(
  process.env.PUBLIC_ROOM_STALE_PARTICIPANT_MS,
  2 * 60 * 1000
);
const PUBLIC_ROOM_CODE_PREFIX = normalizePublicRoomCodePrefix(
  process.env.PUBLIC_ROOM_CODE_PREFIX,
  "LBY"
);
const MAX_LEADERBOARD_ENTRIES = 200;
const MAX_PLAYER_SCORE_ENTRIES_PER_PLAYER = 500;
const MAX_PLAYER_SCORE_LIST_LIMIT = 500;
const MAX_STORED_GAME_LOGS = 10000;
const MAX_WS_MESSAGE_BYTES = 16 * 1024;
const IMAGE_PROXY_MAX_BYTES = 6 * 1024 * 1024;
const IMAGE_PROXY_TIMEOUT_MS = 7000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MULTIPLAYER_BOTS = 4;
const BOT_TICK_MIN_MS = 4500;
const BOT_TICK_MAX_MS = 9000;
const BOT_NAMES = ["Byte Bessie", "Lag Larry", "Packet Patty", "Dicebot Dave"];
const BOT_PROFILES = ["cautious", "balanced", "aggressive"];
const GAME_DIFFICULTIES = new Set(["easy", "normal", "hard"]);
const BOT_CAMERA_EFFECTS = ["shake"];
const BOT_TURN_ADVANCE_MIN_MS = 1600;
const BOT_TURN_ADVANCE_MAX_MS = 3200;
const BOT_TURN_ADVANCE_DELAY_BY_PROFILE = {
  cautious: { min: 2300, max: 4200 },
  balanced: { min: 1500, max: 3100 },
  aggressive: { min: 900, max: 2200 },
};
const DEFAULT_PARTICIPANT_DICE_COUNT = 15;
const BOT_ROLL_DICE_SIDES = [8, 12, 10, 6, 6, 6, 20, 6, 4, 6, 6, 6, 10, 6, 6];
const TURN_TIMEOUT_MS = normalizeTurnTimeoutValue(process.env.TURN_TIMEOUT_MS, 45000);
const MULTIPLAYER_PARTICIPANT_STALE_MS = normalizeTurnTimeoutValue(
  process.env.MULTIPLAYER_PARTICIPANT_STALE_MS,
  45000
);
const MULTIPLAYER_CLEANUP_INTERVAL_MS = normalizeTurnTimeoutValue(
  process.env.MULTIPLAYER_CLEANUP_INTERVAL_MS,
  15000
);
const TURN_TIMEOUT_WARNING_MS = normalizeTurnWarningValue(
  process.env.TURN_TIMEOUT_WARNING_MS,
  TURN_TIMEOUT_MS,
  10000
);
const POST_GAME_INACTIVITY_TIMEOUT_MS = normalizeTurnTimeoutValue(
  process.env.MULTIPLAYER_POST_GAME_INACTIVITY_TIMEOUT_MS,
  2 * 60 * 1000
);
const NEXT_GAME_AUTO_START_DELAY_MS = normalizeTurnTimeoutValue(
  process.env.MULTIPLAYER_NEXT_GAME_DELAY_MS,
  60 * 1000
);
const STORE_REHYDRATE_COOLDOWN_MS = normalizeTurnTimeoutValue(
  process.env.STORE_REHYDRATE_COOLDOWN_MS,
  750
);
const WS_SESSION_UPGRADE_GRACE_MS = normalizeTurnTimeoutValue(
  process.env.WS_SESSION_UPGRADE_GRACE_MS,
  30 * 1000
);
const NEXT_GAME_COUNTDOWN_SECONDS = 10;
const MAX_TURN_ROLL_DICE = 64;
const MAX_TURN_SCORE_SELECTION = 64;
const TURN_PHASES = {
  awaitRoll: "await_roll",
  awaitScore: "await_score",
  readyToEnd: "ready_to_end",
};
const ROOM_KINDS = {
  private: "private",
  publicDefault: "public_default",
  publicOverflow: "public_overflow",
};
const ADMIN_ROLES = {
  viewer: "viewer",
  operator: "operator",
  owner: "owner",
};
const ADMIN_ROLE_LEVELS = {
  [ADMIN_ROLES.viewer]: 1,
  [ADMIN_ROLES.operator]: 2,
  [ADMIN_ROLES.owner]: 3,
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
let storeRehydratePromise = null;
let lastStoreRehydrateAt = 0;

const server = createServer((req, res) => {
  void handleRequest(req, res);
});
const wsSessionClients = new Map();
const wsClientMeta = new WeakMap();
const botSessionLoops = new Map();
const sessionTurnTimeoutLoops = new Map();
const sessionPostGameLoops = new Map();
const turnAdvanceMetrics = {
  timeoutAutoAdvanceCount: 0,
  botAutoAdvanceCount: 0,
};
const botEngine = createBotEngine({
  maxTurnRollDice: MAX_TURN_ROLL_DICE,
  defaultParticipantDiceCount: DEFAULT_PARTICIPANT_DICE_COUNT,
  rollDiceSides: BOT_ROLL_DICE_SIDES,
  defaultTurnDelayRange: {
    min: BOT_TURN_ADVANCE_MIN_MS,
    max: BOT_TURN_ADVANCE_MAX_MS,
  },
  turnDelayByProfile: BOT_TURN_ADVANCE_DELAY_BY_PROFILE,
});

await bootstrap();

server.on("upgrade", async (req, socket) => {
  try {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (requestUrl.pathname !== "/") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const auth = await authenticateSocketUpgrade(requestUrl);
    if (!auth.ok) {
      const rejectedSessionId = requestUrl.searchParams.get("session")?.trim() ?? "unknown";
      const rejectedPlayerId = requestUrl.searchParams.get("playerId")?.trim() ?? "unknown";
      log.warn(
        `Rejected WebSocket upgrade (${auth.status} ${auth.reason}) session=${rejectedSessionId} player=${rejectedPlayerId}`
      );
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
  log.info(`Session cleanup sweep: every ${MULTIPLAYER_CLEANUP_INTERVAL_MS}ms`);
});

const cleanupSweepHandle = setInterval(() => {
  cleanupExpiredRecords();
}, MULTIPLAYER_CLEANUP_INTERVAL_MS);
if (typeof cleanupSweepHandle.unref === "function") {
  cleanupSweepHandle.unref();
}

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
  if (storeAdapter.name === "firestore") {
    const prefix = storeAdapter.metadata?.collectionPrefix ?? FIRESTORE_COLLECTION_PREFIX;
    log.info(`Firestore collection prefix: ${prefix}`);
  }
  if (NODE_ENV === "production" && storeAdapter.name !== "firestore") {
    const warning =
      "Production API is not using Firestore persistence. Set API_STORE_BACKEND=firestore for durable cross-instance leaderboard/session storage.";
    if (ALLOW_FILE_STORE_IN_PRODUCTION) {
      log.warn(`${warning} (override: API_ALLOW_FILE_STORE_IN_PRODUCTION=1)`);
    } else {
      log.error(warning);
      throw new Error(warning);
    }
  }
  log.info(`Firebase auth verifier mode: ${FIREBASE_AUTH_MODE}`);
  log.info(`Admin API access mode: ${resolveAdminAccessMode()}`);
  log.info(
    `Admin bootstrap owners: uids=${ADMIN_OWNER_UID_ALLOWLIST.size} emails=${ADMIN_OWNER_EMAIL_ALLOWLIST.size}`
  );
  const publicRoomsChanged = reconcilePublicRoomInventory(Date.now());
  Object.keys(store.multiplayerSessions).forEach((sessionId) => {
    reconcileSessionLoops(sessionId);
  });
  if (publicRoomsChanged) {
    await persistStore();
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
        runtime: {
          service: process.env.K_SERVICE ?? null,
          revision: process.env.K_REVISION ?? null,
          region: process.env.K_REGION ?? null,
          nodeEnv: NODE_ENV,
          wsBaseUrl: WS_BASE_URL,
        },
        players: Object.keys(store.players).length,
        playerScoreEntries: Object.keys(store.playerScores).length,
        sessions: Object.keys(store.multiplayerSessions).length,
        leaderboardEntries: Object.keys(store.leaderboardScores).length,
        storage: buildStoreDiagnostics(),
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/media/image-proxy") {
      await handleImageProxy(req, res, url);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/overview") {
      await handleAdminOverview(req, res, url);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/rooms") {
      await handleAdminRooms(req, res, url);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/metrics") {
      await handleAdminMetrics(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/storage") {
      await handleAdminStorage(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/audit") {
      await handleAdminAudit(req, res, url);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/roles") {
      await handleAdminRoles(req, res, url);
      return;
    }

    if (req.method === "PUT" && /^\/api\/admin\/roles\/[^/]+$/.test(pathname)) {
      await handleAdminRoleUpsert(req, res, pathname);
      return;
    }

    if (req.method === "POST" && /^\/api\/admin\/sessions\/[^/]+\/expire$/.test(pathname)) {
      await handleAdminExpireSession(req, res, pathname);
      return;
    }

    if (
      req.method === "POST" &&
      /^\/api\/admin\/sessions\/[^/]+\/participants\/[^/]+\/remove$/.test(pathname)
    ) {
      await handleAdminRemoveParticipant(req, res, pathname);
      return;
    }

    if (
      req.method === "POST" &&
      /^\/api\/admin\/sessions\/[^/]+\/channel\/messages$/.test(pathname)
    ) {
      await handleAdminSessionChannelMessage(req, res, pathname);
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

    if (req.method === "GET" && /^\/api\/players\/[^/]+\/scores$/.test(pathname)) {
      await handleGetPlayerScores(req, res, pathname, url);
      return;
    }

    if (req.method === "POST" && /^\/api\/players\/[^/]+\/scores\/batch$/.test(pathname)) {
      await handleAppendPlayerScores(req, res, pathname);
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

    if (req.method === "GET" && pathname === "/api/multiplayer/rooms") {
      await handleListRooms(res, url);
      return;
    }

    if (req.method === "POST" && /^\/api\/multiplayer\/rooms\/[^/]+\/join$/.test(pathname)) {
      await handleJoinRoomByCode(req, res, pathname);
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

    if (req.method === "POST" && /^\/api\/multiplayer\/sessions\/[^/]+\/queue-next$/.test(pathname)) {
      await handleQueueParticipantForNextGame(req, res, pathname);
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
    displayName: authCheck.displayName,
    email: authCheck.email,
    photoUrl: authCheck.photoUrl,
    provider: authCheck.provider,
    providerId: authCheck.providerId,
    isAnonymous: authCheck.isAnonymous,
  });

  const playerRecord = store.firebasePlayers[authCheck.uid] ?? null;
  const adminAccess = resolveAdminRoleForIdentity(authCheck.uid, authCheck.email);
  sendJson(res, 200, {
    uid: authCheck.uid,
    displayName: authCheck.displayName,
    leaderboardName: playerRecord?.displayName,
    email: authCheck.email,
    isAnonymous: authCheck.isAnonymous,
    provider: authCheck.provider,
    providerId:
      authCheck.providerId ??
      (typeof playerRecord?.providerId === "string" ? playerRecord.providerId : undefined),
    photoUrl:
      authCheck.photoUrl ??
      (typeof playerRecord?.photoUrl === "string" ? playerRecord.photoUrl : undefined),
    admin: {
      role: adminAccess.role,
      isAdmin: Boolean(adminAccess.role),
      source: adminAccess.source,
    },
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
    photoUrl: authCheck.photoUrl,
    provider: authCheck.provider,
    providerId: authCheck.providerId,
    isAnonymous: false,
  });
  await persistStore();
  const adminAccess = resolveAdminRoleForIdentity(authCheck.uid, authCheck.email);

  sendJson(res, 200, {
    uid: authCheck.uid,
    displayName: authCheck.displayName,
    leaderboardName: displayName,
    email: authCheck.email,
    isAnonymous: false,
    provider: authCheck.provider,
    providerId: authCheck.providerId,
    photoUrl: authCheck.photoUrl,
    admin: {
      role: adminAccess.role,
      isAdmin: Boolean(adminAccess.role),
      source: adminAccess.source,
    },
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
    photoUrl: authCheck.photoUrl,
    provider: authCheck.provider,
    providerId: authCheck.providerId,
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
    photoUrl: authCheck.photoUrl,
    provider: authCheck.provider,
    providerId: authCheck.providerId,
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
  const existingProfile =
    store.players[playerId] && typeof store.players[playerId] === "object"
      ? store.players[playerId]
      : null;
  const incomingBlockedPlayerIds = Object.prototype.hasOwnProperty.call(body, "blockedPlayerIds")
    ? body.blockedPlayerIds
    : undefined;
  const blockedPlayerIds = normalizeBlockedPlayerIds(
    Array.isArray(incomingBlockedPlayerIds)
      ? incomingBlockedPlayerIds
      : existingProfile?.blockedPlayerIds,
    playerId
  );
  const profile = {
    playerId,
    displayName: typeof body.displayName === "string" ? body.displayName : undefined,
    settings: body.settings ?? {},
    upgradeProgression: body.upgradeProgression ?? {},
    ...(blockedPlayerIds.length > 0 ? { blockedPlayerIds } : {}),
    updatedAt: typeof body.updatedAt === "number" ? body.updatedAt : now,
  };

  store.players[playerId] = profile;
  await persistStore();
  sendJson(res, 200, profile);
}

async function handleGetPlayerScores(_req, res, pathname, requestUrl) {
  const playerId = decodeURIComponent(pathname.split("/")[3]);
  // Score history reads are intentionally public so leaderboard/personal-history
  // views keep working even when clients hold stale session tokens.

  const rawLimit = Number(requestUrl.searchParams.get("limit") ?? MAX_PLAYER_SCORE_LIST_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_PLAYER_SCORE_LIST_LIMIT, Math.floor(rawLimit)))
    : MAX_PLAYER_SCORE_LIST_LIMIT;

  const allEntries = collectPlayerScoresByPlayerId(playerId);
  const sortedEntries = allEntries.sort(comparePlayerScoreEntries);
  const entries = sortedEntries.slice(0, limit).map(serializePlayerScoreEntry);
  const stats = buildPlayerScoreStats(allEntries);

  sendJson(res, 200, {
    playerId,
    entries,
    stats,
    total: allEntries.length,
    generatedAt: Date.now(),
  });
}

async function handleAppendPlayerScores(req, res, pathname) {
  const playerId = decodeURIComponent(pathname.split("/")[3]);
  const authCheck = authorizeRequest(req, playerId);
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const body = await parseJsonBody(req);
  const scores = Array.isArray(body?.scores) ? body.scores : [];
  if (scores.length === 0) {
    sendJson(res, 200, { accepted: 0, failed: 0 });
    return;
  }

  let accepted = 0;
  let failed = 0;
  const now = Date.now();

  for (const score of scores) {
    const parsedScore = parsePlayerScorePayload(score);
    if (!parsedScore) {
      failed += 1;
      continue;
    }

    const storeId = `${playerId}:${parsedScore.scoreId}`;
    store.playerScores[storeId] = {
      id: storeId,
      playerId,
      ...parsedScore,
      updatedAt: now,
    };
    accepted += 1;
  }

  if (accepted > 0) {
    trimPlayerScoresByPlayer(playerId, MAX_PLAYER_SCORE_ENTRIES_PER_PLAYER);
    await persistStore();
  }

  sendJson(res, 200, { accepted, failed });
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

async function handleListRooms(res, url) {
  const parsedLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(MULTIPLAYER_ROOM_LIST_LIMIT_MAX, Math.floor(parsedLimit)))
    : MULTIPLAYER_ROOM_LIST_LIMIT_DEFAULT;
  const now = Date.now();
  const roomInventoryChanged = reconcilePublicRoomInventory(now);
  if (roomInventoryChanged) {
    await persistStore();
  }

  const rooms = Object.values(store.multiplayerSessions)
    .map((session) => buildRoomListing(session, now))
    .filter((room) => room !== null && room.isPublic === true && room.sessionComplete !== true)
    .sort((left, right) => {
      const roomTypeDelta = resolveRoomListPriority(left) - resolveRoomListPriority(right);
      if (roomTypeDelta !== 0) {
        return roomTypeDelta;
      }
      const activeDelta = right.activeHumanCount - left.activeHumanCount;
      if (activeDelta !== 0) {
        return activeDelta;
      }
      const humanDelta = right.humanCount - left.humanCount;
      if (humanDelta !== 0) {
        return humanDelta;
      }
      return right.lastActivityAt - left.lastActivityAt;
    })
    .slice(0, limit);

  sendJson(res, 200, {
    rooms,
    timestamp: now,
  });
}

async function handleCreateSession(req, res) {
  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!playerId) {
    sendJson(res, 400, { error: "playerId is required" });
    return;
  }

  const sessionId = randomUUID();
  const botCount = normalizeBotCount(body?.botCount);
  const gameDifficulty = normalizeGameDifficulty(body?.gameDifficulty);
  const now = Date.now();
  const requestedRoomCode = normalizeOptionalRoomCode(body?.roomCode);
  if (requestedRoomCode && isRoomCodeInUse(requestedRoomCode, now)) {
    sendJson(res, 409, {
      error: "Room code unavailable",
      reason: "room_code_taken",
    });
    return;
  }
  const roomCode = requestedRoomCode || generateUniquePrivateRoomCode(now);
  if (!roomCode) {
    sendJson(res, 500, { error: "Failed to allocate room code" });
    return;
  }
  const expiresAt = now + MULTIPLAYER_SESSION_IDLE_TTL_MS;
  const participantBlockedPlayerIds = resolveParticipantBlockedPlayerIds(playerId, {
    candidateBlockedPlayerIds: body?.blockedPlayerIds,
  });
  const participants = {
    [playerId]: {
      playerId,
      displayName: typeof body?.displayName === "string" ? body.displayName : undefined,
      avatarUrl: normalizeAvatarUrl(body?.avatarUrl),
      providerId: normalizeProviderId(body?.providerId),
      ...(participantBlockedPlayerIds.length > 0
        ? { blockedPlayerIds: participantBlockedPlayerIds }
        : {}),
      joinedAt: now,
      lastHeartbeatAt: now,
      isReady: false,
      score: 0,
      remainingDice: DEFAULT_PARTICIPANT_DICE_COUNT,
      queuedForNextGame: false,
      isComplete: false,
      completedAt: null,
    },
  };

  const session = {
    sessionId,
    roomCode,
    gameDifficulty,
    wsUrl: WS_BASE_URL,
    roomKind: ROOM_KINDS.private,
    createdAt: now,
    gameStartedAt: now,
    lastActivityAt: now,
    expiresAt,
    participants,
    turnState: null,
  };
  addBotsToSession(session, botCount, now);

  store.multiplayerSessions[sessionId] = session;
  ensureSessionTurnState(session);
  reconcileSessionLoops(sessionId);
  const auth = issueAuthTokenBundle(playerId, sessionId);
  markSessionActivity(session, playerId, Date.now());
  const response = buildSessionResponse(session, playerId, auth);
  await persistStore();
  sendJson(res, 200, response);
}

async function handleJoinSession(req, res, pathname) {
  const sessionId = decodeURIComponent(pathname.split("/")[4]);
  await handleJoinSessionByTarget(req, res, {
    sessionId,
  });
}

async function handleJoinRoomByCode(req, res, pathname) {
  const roomCode = decodeURIComponent(pathname.split("/")[4]);
  await handleJoinSessionByTarget(req, res, {
    roomCode,
  });
}

async function handleJoinSessionByTarget(req, res, target) {
  const now = Date.now();
  let session = null;
  if (typeof target?.sessionId === "string" && target.sessionId.trim().length > 0) {
    const sessionId = target.sessionId.trim();
    let sessionById = store.multiplayerSessions[sessionId];
    if (!sessionById || sessionById.expiresAt <= now) {
      await rehydrateStoreFromAdapter(`join_session:${sessionId}`, { force: true });
      sessionById = store.multiplayerSessions[sessionId];
    }
    if (!sessionById || sessionById.expiresAt <= now) {
      sendJson(res, 410, { error: "Session expired", reason: "session_expired" });
      return;
    }
    session = sessionById;
  } else if (typeof target?.roomCode === "string" && target.roomCode.trim().length > 0) {
    const normalizedRoomCode = normalizeOptionalRoomCode(target.roomCode);
    if (!normalizedRoomCode) {
      sendJson(res, 404, { error: "Room code not found", reason: "room_not_found" });
      return;
    }
    let sessionByRoomCode = findJoinableSessionByRoomCode(normalizedRoomCode, now);
    if (!sessionByRoomCode) {
      await rehydrateStoreFromAdapter(`join_room_code:${normalizedRoomCode}`, { force: true });
      sessionByRoomCode = findJoinableSessionByRoomCode(normalizedRoomCode, now);
    }
    if (!sessionByRoomCode) {
      sendJson(res, 404, { error: "Room code not found", reason: "room_not_found" });
      return;
    }
    session = sessionByRoomCode;
  } else {
    sendJson(res, 400, { error: "sessionId or roomCode is required" });
    return;
  }

  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!playerId) {
    sendJson(res, 400, { error: "playerId is required" });
    return;
  }
  const requestedBotCount = normalizeBotCount(body?.botCount);
  const hasSessionDifficulty =
    typeof session.gameDifficulty === "string" &&
    GAME_DIFFICULTIES.has(session.gameDifficulty.trim().toLowerCase());
  if (!hasSessionDifficulty) {
    session.gameDifficulty = normalizeGameDifficulty(body?.gameDifficulty);
  }

  const existingParticipant = session.participants[playerId];
  const isReturningParticipant = Boolean(existingParticipant && !isBotParticipant(existingParticipant));
  const shouldQueueForNextGame =
    !isReturningParticipant && shouldQueueParticipantForNextGame(session);
  const queuedForNextGame = isReturningParticipant
    ? normalizeQueuedForNextGame(existingParticipant?.queuedForNextGame)
    : shouldQueueForNextGame;
  const hasActiveTurnBeforeJoin =
    typeof ensureSessionTurnState(session)?.activeTurnPlayerId === "string";
  if (!isReturningParticipant && getHumanParticipantCount(session) >= MAX_MULTIPLAYER_HUMAN_PLAYERS) {
    sendJson(res, 409, { error: "Room is full", reason: "room_full" });
    return;
  }

  const participantBlockedPlayerIds = resolveParticipantBlockedPlayerIds(playerId, {
    candidateBlockedPlayerIds: body?.blockedPlayerIds,
    fallbackBlockedPlayerIds: existingParticipant?.blockedPlayerIds,
  });
  session.participants[playerId] = {
    playerId,
    displayName:
      typeof body?.displayName === "string" ? body.displayName : existingParticipant?.displayName,
    avatarUrl: normalizeAvatarUrl(body?.avatarUrl) ?? normalizeAvatarUrl(existingParticipant?.avatarUrl),
    providerId:
      normalizeProviderId(body?.providerId) ?? normalizeProviderId(existingParticipant?.providerId),
    ...(participantBlockedPlayerIds.length > 0
      ? { blockedPlayerIds: participantBlockedPlayerIds }
      : {}),
    joinedAt: existingParticipant?.joinedAt ?? now,
    lastHeartbeatAt: now,
    isReady: isReturningParticipant
      ? existingParticipant?.isReady === true
      : queuedForNextGame || hasActiveTurnBeforeJoin,
    score: normalizeParticipantScore(existingParticipant?.score),
    remainingDice: normalizeParticipantRemainingDice(existingParticipant?.remainingDice),
    queuedForNextGame,
    isComplete: existingParticipant?.isComplete === true,
    completedAt: normalizeParticipantCompletedAt(existingParticipant?.completedAt),
  };
  addBotsToSession(session, requestedBotCount, now);
  const sessionId = session.sessionId;
  markSessionActivity(session, playerId, now);
  ensureSessionTurnState(session);
  reconcileSessionLoops(sessionId);
  broadcastSessionState(session, "join");
  const roomInventoryChanged = reconcilePublicRoomInventory(now);

  const auth = issueAuthTokenBundle(playerId, sessionId);
  const response = buildSessionResponse(session, playerId, auth);
  if (roomInventoryChanged) {
    await persistStore();
    sendJson(res, 200, response);
    return;
  }
  await persistStore();
  sendJson(res, 200, response);
}

async function handleSessionHeartbeat(req, res, pathname) {
  const sessionId = decodeURIComponent(pathname.split("/")[4]);
  let session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    await rehydrateStoreFromAdapter(`heartbeat_session:${sessionId}`);
    session = store.multiplayerSessions[sessionId];
  }
  if (!session || session.expiresAt <= Date.now()) {
    sendJson(res, 200, { ok: false, reason: "session_expired" });
    return;
  }

  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!playerId || !session.participants[playerId]) {
    await rehydrateStoreFromAdapter(`heartbeat_participant:${sessionId}:${playerId || "unknown"}`);
    session = store.multiplayerSessions[sessionId];
  }
  if (!session || !playerId || !session.participants[playerId]) {
    sendJson(res, 200, { ok: false, reason: "unknown_player" });
    return;
  }

  let authCheck = authorizeRequest(req, playerId, sessionId);
  if (!authCheck.ok) {
    await rehydrateStoreFromAdapter(`heartbeat_auth:${sessionId}:${playerId}`);
    authCheck = authorizeRequest(req, playerId, sessionId);
  }
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const now = Date.now();
  session.participants[playerId].lastHeartbeatAt = now;
  markSessionActivity(session, playerId, now, { countAsPlayerAction: false });
  await persistStore();
  sendJson(res, 200, { ok: true });
}

async function handleQueueParticipantForNextGame(req, res, pathname) {
  const sessionId = decodeURIComponent(pathname.split("/")[4]);
  let session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    await rehydrateStoreFromAdapter(`queue_next_session:${sessionId}`);
    session = store.multiplayerSessions[sessionId];
  }
  if (!session || session.expiresAt <= Date.now()) {
    sendJson(res, 200, {
      ok: false,
      queuedForNextGame: false,
      reason: "session_expired",
    });
    return;
  }

  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  let participant = playerId ? session.participants[playerId] : null;
  if (!playerId || !participant || isBotParticipant(participant)) {
    await rehydrateStoreFromAdapter(`queue_next_participant:${sessionId}:${playerId || "unknown"}`);
    session = store.multiplayerSessions[sessionId];
    participant = playerId && session ? session.participants[playerId] : null;
  }
  if (!session || !playerId || !participant || isBotParticipant(participant)) {
    sendJson(res, 200, {
      ok: false,
      queuedForNextGame: false,
      reason: "unknown_player",
    });
    return;
  }

  let authCheck = authorizeRequest(req, playerId, sessionId);
  if (!authCheck.ok) {
    await rehydrateStoreFromAdapter(`queue_next_auth:${sessionId}:${playerId}`);
    authCheck = authorizeRequest(req, playerId, sessionId);
  }
  if (!authCheck.ok) {
    sendJson(res, 200, {
      ok: false,
      queuedForNextGame: false,
      reason: "unauthorized",
    });
    return;
  }

  if (!areCurrentGameParticipantsComplete(session)) {
    sendJson(res, 200, {
      ok: false,
      queuedForNextGame: false,
      reason: "round_in_progress",
    });
    return;
  }

  const now = Date.now();
  participant.lastHeartbeatAt = now;
  participant.queuedForNextGame = true;
  participant.isReady = true;
  markSessionActivity(session, playerId, now);
  scheduleSessionPostGameLifecycle(session, now);
  ensureSessionTurnState(session);
  broadcastSessionState(session, "queue_next_game");
  reconcileSessionLoops(sessionId);
  await persistStore();

  sendJson(res, 200, {
    ok: true,
    queuedForNextGame: true,
    session: {
      ...buildSessionSnapshot(session),
      serverNow: now,
    },
  });
}

async function handleLeaveSession(req, res, pathname) {
  const sessionId = decodeURIComponent(pathname.split("/")[4]);

  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!playerId) {
    sendJson(res, 400, { error: "playerId is required" });
    return;
  }
  let removal = removeParticipantFromSession(sessionId, playerId, {
    source: "leave",
    socketReason: "left_session",
  });
  if (!removal.ok && (removal.reason === "unknown_session" || removal.reason === "unknown_player")) {
    await rehydrateStoreFromAdapter(`leave_session:${sessionId}:${playerId}`);
    removal = removeParticipantFromSession(sessionId, playerId, {
      source: "leave",
      socketReason: "left_session",
    });
  }
  if (!removal.ok && removal.reason === "unknown_session") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (!removal.ok && removal.reason === "unknown_player") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (!removal.ok) {
    sendJson(res, 404, { error: "Player not found in session", reason: removal.reason });
    return;
  }
  await persistStore();
  sendJson(res, 200, { ok: true });
}

function removeParticipantFromSession(
  sessionId,
  playerId,
  options = { source: "leave", socketReason: "left_session" }
) {
  const session = store.multiplayerSessions[sessionId];
  if (!session) {
    return {
      ok: false,
      reason: "unknown_session",
    };
  }
  if (!session.participants?.[playerId]) {
    return {
      ok: false,
      reason: "unknown_player",
    };
  }

  delete session.participants[playerId];
  disconnectPlayerSockets(
    sessionId,
    playerId,
    WS_CLOSE_CODES.normal,
    options.socketReason ?? "left_session"
  );
  ensureSessionTurnState(session);
  const now = Date.now();

  if (getHumanParticipantCount(session) === 0) {
    const roomKind = getSessionRoomKind(session);
    if (roomKind === ROOM_KINDS.private) {
      expireSession(sessionId, "session_empty");
    } else {
      resetPublicRoomForIdle(session, now);
      reconcileSessionLoops(sessionId);
      broadcastSessionState(session, options.source ?? "leave");
    }
  } else {
    const forfeited = maybeForfeitSessionForSingleHumanRemaining(session, now);
    markSessionActivity(session, undefined, now);
    reconcileSessionLoops(sessionId);
    if (!forfeited) {
      const turnStart = buildTurnStartMessage(session, { source: "reassign" });
      if (turnStart) {
        broadcastToSession(sessionId, JSON.stringify(turnStart), null);
      }
    }
    broadcastSessionState(session, options.source ?? "leave");
  }

  const roomInventoryChanged = reconcilePublicRoomInventory(now);
  return {
    ok: true,
    roomInventoryChanged,
    sessionExpired: !store.multiplayerSessions[sessionId],
  };
}

async function handleRefreshSessionAuth(req, res, pathname) {
  const sessionId = decodeURIComponent(pathname.split("/")[4]);
  let session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    await rehydrateStoreFromAdapter(`refresh_auth_session:${sessionId}`);
    session = store.multiplayerSessions[sessionId];
  }
  if (!session || session.expiresAt <= Date.now()) {
    sendJson(res, 410, { error: "Session expired" });
    return;
  }

  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!playerId || !session.participants[playerId]) {
    await rehydrateStoreFromAdapter(`refresh_auth_participant:${sessionId}:${playerId || "unknown"}`);
    session = store.multiplayerSessions[sessionId];
  }
  if (!session || !playerId || !session.participants[playerId]) {
    sendJson(res, 404, { error: "Player not in session" });
    return;
  }

  const now = Date.now();
  const participant = session.participants[playerId];
  if (participant && typeof participant === "object") {
    participant.lastHeartbeatAt = now;
  }
  // Token refresh is an authenticated presence signal and should keep the participant active.
  markSessionActivity(session, playerId, now, { countAsPlayerAction: false });
  reconcileSessionLoops(sessionId);

  const auth = issueAuthTokenBundle(playerId, sessionId);
  const response = buildSessionResponse(session, playerId, auth);
  await persistStore();
  sendJson(res, 200, response);
}

async function handleAdminOverview(req, res, url) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.viewer });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  const now = Date.now();
  const limit = parseAdminRoomLimit(url.searchParams.get("limit"));
  const rooms = collectAdminRoomDiagnostics(now).slice(0, limit);
  sendJson(res, 200, {
    timestamp: now,
    accessMode: auth.mode,
    principal: buildAdminPrincipal(auth),
    metrics: buildAdminMetricsSnapshot(now),
    rooms,
  });
}

async function handleAdminRooms(req, res, url) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.viewer });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  const now = Date.now();
  const limit = parseAdminRoomLimit(url.searchParams.get("limit"));
  sendJson(res, 200, {
    timestamp: now,
    accessMode: auth.mode,
    principal: buildAdminPrincipal(auth),
    rooms: collectAdminRoomDiagnostics(now).slice(0, limit),
  });
}

async function handleAdminMetrics(req, res) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.viewer });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  const now = Date.now();
  sendJson(res, 200, {
    timestamp: now,
    accessMode: auth.mode,
    principal: buildAdminPrincipal(auth),
    metrics: buildAdminMetricsSnapshot(now),
  });
}

async function handleAdminStorage(req, res) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.viewer });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  sendJson(res, 200, {
    timestamp: Date.now(),
    accessMode: auth.mode,
    principal: buildAdminPrincipal(auth),
    storage: buildStoreDiagnostics(),
    sections: collectStoreSectionSummary(),
  });
}

async function handleAdminAudit(req, res, url) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.viewer });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  const now = Date.now();
  const limit = parseAdminAuditLimit(url.searchParams.get("limit"));
  sendJson(res, 200, {
    timestamp: now,
    accessMode: auth.mode,
    principal: buildAdminPrincipal(auth),
    entries: collectAdminAuditEntries(limit),
  });
}

async function handleAdminRoles(req, res, url) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.owner });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  const parsedLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(500, Math.floor(parsedLimit)))
    : 250;
  const roleRecords = collectAdminRoleRecords()
    .sort((left, right) => {
      const leftLevel = left.role ? ADMIN_ROLE_LEVELS[left.role] : 0;
      const rightLevel = right.role ? ADMIN_ROLE_LEVELS[right.role] : 0;
      if (leftLevel !== rightLevel) {
        return rightLevel - leftLevel;
      }
      const updatedDelta = Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0);
      if (updatedDelta !== 0) {
        return updatedDelta;
      }
      return String(left.uid).localeCompare(String(right.uid));
    })
    .slice(0, limit);

  sendJson(res, 200, {
    timestamp: Date.now(),
    accessMode: auth.mode,
    principal: buildAdminPrincipal(auth),
    roles: roleRecords,
  });
}

async function handleAdminRoleUpsert(req, res, pathname) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.owner });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  const targetUid = decodeURIComponent(pathname.split("/")[4] ?? "").trim();
  if (!targetUid) {
    sendJson(res, 400, {
      error: "Invalid UID",
      reason: "invalid_uid",
    });
    return;
  }

  const body = await parseJsonBody(req);
  const hasRoleField =
    body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "role");
  if (!hasRoleField) {
    sendJson(res, 400, {
      error: "Role is required",
      reason: "missing_admin_role",
    });
    return;
  }
  const requestedRole = normalizeAdminRole(body?.role);
  const rawRole = typeof body?.role === "string" ? body.role.trim() : "";
  if (rawRole && !requestedRole) {
    sendJson(res, 400, {
      error: "Invalid role",
      reason: "invalid_admin_role",
    });
    return;
  }

  if (isBootstrapOwnerUid(targetUid) && requestedRole !== ADMIN_ROLES.owner) {
    sendJson(res, 409, {
      error: "Bootstrap owner role is fixed",
      reason: "bootstrap_owner_locked",
    });
    return;
  }

  const now = Date.now();
  const current = store.firebasePlayers[targetUid] ?? { uid: targetUid };
  const next = {
    ...current,
    uid: targetUid,
    updatedAt: now,
  };
  if (requestedRole) {
    next.adminRole = requestedRole;
  } else {
    delete next.adminRole;
  }
  next.adminRoleUpdatedAt = now;
  next.adminRoleUpdatedBy = auth.uid ?? auth.authType;
  store.firebasePlayers[targetUid] = next;
  recordAdminAuditEvent(auth, "role_upsert", {
    summary: `Set ${targetUid} role to ${requestedRole ?? "none"}`,
    targetUid,
    role: requestedRole,
  });
  await persistStore();

  sendJson(res, 200, {
    ok: true,
    roleRecord: buildAdminRoleRecord(targetUid, next),
    principal: buildAdminPrincipal(auth),
  });
}

async function handleAdminExpireSession(req, res, pathname) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.operator });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  const sessionId = decodeURIComponent(pathname.split("/")[4] ?? "").trim();
  if (!sessionId) {
    sendJson(res, 400, {
      error: "Invalid session ID",
      reason: "invalid_session_id",
    });
    return;
  }
  if (!store.multiplayerSessions[sessionId]) {
    sendJson(res, 404, {
      error: "Session not found",
      reason: "unknown_session",
    });
    return;
  }

  expireSession(sessionId, "admin_expired");
  const roomInventoryChanged = reconcilePublicRoomInventory(Date.now());
  recordAdminAuditEvent(auth, "session_expire", {
    summary: `Expired room ${sessionId}`,
    sessionId,
  });
  await persistStore();

  log.info(
    `Admin expired session ${sessionId} by ${auth.uid ?? auth.authType ?? "unknown"} (${auth.role ?? "n/a"})`
  );
  sendJson(res, 200, {
    ok: true,
    sessionId,
    roomInventoryChanged,
    principal: buildAdminPrincipal(auth),
  });
}

async function handleAdminRemoveParticipant(req, res, pathname) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.operator });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  const segments = pathname.split("/");
  const sessionId = decodeURIComponent(segments[4] ?? "").trim();
  const playerId = decodeURIComponent(segments[6] ?? "").trim();
  if (!sessionId) {
    sendJson(res, 400, {
      error: "Invalid session ID",
      reason: "invalid_session_id",
    });
    return;
  }
  if (!playerId) {
    sendJson(res, 400, {
      error: "Invalid player ID",
      reason: "invalid_player_id",
    });
    return;
  }

  const removal = removeParticipantFromSession(sessionId, playerId, {
    source: "admin_remove",
    socketReason: "removed_by_admin",
  });
  if (!removal.ok) {
    const status = removal.reason === "unknown_session" || removal.reason === "unknown_player" ? 404 : 409;
    sendJson(res, status, {
      error: "Failed to remove participant",
      reason: removal.reason,
    });
    return;
  }

  recordAdminAuditEvent(auth, "participant_remove", {
    summary: `Removed ${playerId} from ${sessionId}`,
    sessionId,
    playerId,
    sessionExpired: removal.sessionExpired === true,
    roomInventoryChanged: removal.roomInventoryChanged === true,
  });
  await persistStore();
  log.info(
    `Admin removed participant ${playerId} from ${sessionId} by ${auth.uid ?? auth.authType ?? "unknown"} (${auth.role ?? "n/a"})`
  );
  sendJson(res, 200, {
    ok: true,
    sessionId,
    playerId,
    sessionExpired: removal.sessionExpired,
    roomInventoryChanged: removal.roomInventoryChanged,
    principal: buildAdminPrincipal(auth),
  });
}

async function handleAdminSessionChannelMessage(req, res, pathname) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.operator });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  const sessionId = decodeURIComponent(pathname.split("/")[4] ?? "").trim();
  if (!sessionId) {
    sendJson(res, 400, {
      error: "Invalid session ID",
      reason: "invalid_session_id",
    });
    return;
  }

  const session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    sendJson(res, 404, {
      error: "Session not found",
      reason: "unknown_session",
    });
    return;
  }

  const body = await parseJsonBody(req);
  const channel = body?.channel === "direct" ? "direct" : "public";
  const rawMessage = typeof body?.message === "string" ? body.message.trim() : "";
  if (!rawMessage) {
    sendJson(res, 400, {
      error: "Message is required",
      reason: "missing_message",
    });
    return;
  }
  const message = rawMessage.slice(0, 320);
  const title =
    typeof body?.title === "string" && body.title.trim().length > 0
      ? body.title.trim().slice(0, 80)
      : channel === "direct"
        ? "Direct"
        : "Room";
  const topic =
    typeof body?.topic === "string" && body.topic.trim().length > 0
      ? body.topic.trim().slice(0, 32).toLowerCase()
      : undefined;
  const severity =
    body?.severity === "success" ||
    body?.severity === "warning" ||
    body?.severity === "error"
      ? body.severity
      : "info";
  const sourceRole =
    body?.sourceRole === "service" || body?.sourceRole === "system"
      ? body.sourceRole
      : "admin";
  const sourcePlayerId =
    typeof body?.sourcePlayerId === "string" && body.sourcePlayerId.trim().length > 0
      ? body.sourcePlayerId.trim()
      : undefined;
  const targetPlayerId =
    typeof body?.targetPlayerId === "string" && body.targetPlayerId.trim().length > 0
      ? body.targetPlayerId.trim()
      : "";

  if (channel === "direct" && !targetPlayerId) {
    sendJson(res, 400, {
      error: "Direct messages require targetPlayerId",
      reason: "missing_target_player",
    });
    return;
  }
  if (targetPlayerId && !session.participants[targetPlayerId]) {
    sendJson(res, 404, {
      error: "Target player not found in session",
      reason: "unknown_player",
    });
    return;
  }

  const payload = {
    type: "room_channel",
    id: randomUUID(),
    channel,
    ...(topic ? { topic } : {}),
    ...(sourcePlayerId ? { playerId: sourcePlayerId, sourcePlayerId } : {}),
    sourceRole,
    title,
    message,
    severity,
    ...(channel === "direct" ? { targetPlayerId } : {}),
    timestamp: Date.now(),
  };

  const rawPayload = JSON.stringify(payload);
  if (channel === "direct") {
    sendToSessionPlayer(sessionId, targetPlayerId, rawPayload, null);
  } else {
    broadcastToSession(sessionId, rawPayload, null);
  }

  recordAdminAuditEvent(auth, "channel_message", {
    summary:
      channel === "direct"
        ? `Sent direct ${topic ?? "message"} to ${targetPlayerId} in ${sessionId}`
        : `Broadcast ${topic ?? "message"} in ${sessionId}`,
    sessionId,
    ...(channel === "direct" ? { playerId: targetPlayerId } : {}),
    channel,
    topic,
    sourceRole,
  });
  await persistStore();

  sendJson(res, 200, {
    ok: true,
    sessionId,
    channel,
    ...(channel === "direct" ? { targetPlayerId } : {}),
    principal: buildAdminPrincipal(auth),
  });
}

function collectAdminRoomDiagnostics(now = Date.now()) {
  return Object.entries(store.multiplayerSessions)
    .map(([sessionId, session]) => buildAdminRoomDiagnostic(sessionId, session, now))
    .filter((room) => room !== null)
    .sort((left, right) => {
      const activeDelta = Number(right.hasConnectedHumans) - Number(left.hasConnectedHumans);
      if (activeDelta !== 0) {
        return activeDelta;
      }
      const readyDelta = right.readyHumanCount - left.readyHumanCount;
      if (readyDelta !== 0) {
        return readyDelta;
      }
      const humanDelta = right.humanCount - left.humanCount;
      if (humanDelta !== 0) {
        return humanDelta;
      }
      return right.lastActivityAt - left.lastActivityAt;
    });
}

function buildAdminRoomDiagnostic(sessionId, session, now = Date.now()) {
  if (!session || typeof session !== "object") {
    return null;
  }
  const room = buildRoomListing(session, now);
  if (!room) {
    return null;
  }

  const participants = serializeSessionParticipants(session);
  const turnState = ensureSessionTurnState(session);
  const connectedPlayerIds = new Set(getConnectedSessionPlayerIds(sessionId));
  const hasConnectedHumans = participants.some(
    (participant) => !participant.isBot && connectedPlayerIds.has(participant.playerId)
  );

  return {
    sessionId: room.sessionId,
    roomCode: room.roomCode,
    roomType: room.roomType,
    isPublic: room.isPublic,
    sessionComplete: room.sessionComplete,
    createdAt: room.createdAt,
    lastActivityAt: room.lastActivityAt,
    expiresAt: room.expiresAt,
    idleMs: Math.max(0, now - room.lastActivityAt),
    humanCount: room.humanCount,
    readyHumanCount: room.readyHumanCount,
    activeHumanCount: room.activeHumanCount,
    botCount: room.botCount,
    participantCount: room.participantCount,
    maxHumanCount: room.maxHumanCount,
    availableHumanSlots: room.availableHumanSlots,
    connectedSocketCount: connectedPlayerIds.size,
    hasConnectedHumans,
    participants: participants.map((participant) => ({
      playerId: participant.playerId,
      displayName: participant.displayName,
      avatarUrl: participant.avatarUrl,
      providerId: participant.providerId,
      isBot: participant.isBot,
      isReady: participant.isReady,
      isComplete: participant.isComplete,
      score: participant.score,
      remainingDice: participant.remainingDice,
      queuedForNextGame: participant.queuedForNextGame === true,
      lastHeartbeatAt: participant.lastHeartbeatAt,
      connected: connectedPlayerIds.has(participant.playerId),
    })),
    turnState: turnState
      ? {
          activeTurnPlayerId: turnState.activeTurnPlayerId,
          round: turnState.round,
          turnNumber: turnState.turnNumber,
          phase: normalizeTurnPhase(turnState.phase),
          orderLength: Array.isArray(turnState.order) ? turnState.order.length : 0,
          turnExpiresAt:
            typeof turnState.turnExpiresAt === "number" && Number.isFinite(turnState.turnExpiresAt)
              ? Math.floor(turnState.turnExpiresAt)
              : null,
          turnTimeoutMs: normalizeTurnTimeoutMs(turnState.turnTimeoutMs),
        }
      : null,
  };
}

function buildAdminMetricsSnapshot(now = Date.now()) {
  const sessions = Object.values(store.multiplayerSessions);
  const activeSessions = sessions.filter(
    (session) =>
      session &&
      typeof session === "object" &&
      Number.isFinite(session.expiresAt) &&
      session.expiresAt > now
  );
  const publicDefaultCount = activeSessions.filter(
    (session) => getSessionRoomKind(session) === ROOM_KINDS.publicDefault
  ).length;
  const publicOverflowCount = activeSessions.filter(
    (session) => getSessionRoomKind(session) === ROOM_KINDS.publicOverflow
  ).length;
  const privateRoomCount = activeSessions.filter(
    (session) => getSessionRoomKind(session) === ROOM_KINDS.private
  ).length;

  let participantCount = 0;
  let humanCount = 0;
  let botCount = 0;
  let readyHumanCount = 0;
  let connectedSocketCount = 0;

  activeSessions.forEach((session) => {
    const participants = serializeSessionParticipants(session);
    participantCount += participants.length;
    participants.forEach((participant) => {
      if (participant.isBot) {
        botCount += 1;
        return;
      }
      humanCount += 1;
      if (participant.isReady) {
        readyHumanCount += 1;
      }
    });
    connectedSocketCount += getConnectedSessionPlayerIds(session.sessionId).length;
  });

  return {
    activeSessionCount: activeSessions.length,
    totalSessionRecords: sessions.length,
    publicDefaultCount,
    publicOverflowCount,
    privateRoomCount,
    participantCount,
    humanCount,
    botCount,
    readyHumanCount,
    connectedSocketCount,
    activeTurnTimeoutLoops: sessionTurnTimeoutLoops.size,
    activeBotLoops: botSessionLoops.size,
    turnTimeoutAutoAdvanceCount: turnAdvanceMetrics.timeoutAutoAdvanceCount,
    botTurnAutoAdvanceCount: turnAdvanceMetrics.botAutoAdvanceCount,
  };
}

function buildStoreDiagnostics() {
  const backend = storeAdapter?.name ?? STORE_BACKEND;
  const metadata = storeAdapter?.metadata && typeof storeAdapter.metadata === "object"
    ? storeAdapter.metadata
    : {};
  const firestorePrefix =
    typeof metadata.collectionPrefix === "string" && metadata.collectionPrefix
      ? metadata.collectionPrefix
      : backend === "firestore"
        ? FIRESTORE_COLLECTION_PREFIX
        : undefined;
  const firestoreCollections = Array.isArray(metadata.collections)
    ? metadata.collections.filter((entry) => typeof entry === "string")
    : undefined;

  return {
    backend,
    firestorePrefix,
    firestoreCollections,
  };
}

function collectStoreSectionSummary() {
  return Object.keys(DEFAULT_STORE).map((section) => ({
    section,
    count: Object.keys(store?.[section] ?? {}).length,
  }));
}

function getConnectedSessionPlayerIds(sessionId) {
  const clients = wsSessionClients.get(sessionId);
  if (!clients || clients.size === 0) {
    return [];
  }

  const ids = new Set();
  for (const client of clients) {
    if (!client || client.closed || client.socket.destroyed) {
      continue;
    }
    if (typeof client.playerId === "string" && client.playerId) {
      ids.add(client.playerId);
    }
  }

  return Array.from(ids.values());
}

function parseAdminRoomLimit(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return ADMIN_ROOM_LIST_LIMIT_DEFAULT;
  }
  return Math.max(1, Math.min(ADMIN_ROOM_LIST_LIMIT_MAX, Math.floor(parsed)));
}

function parseAdminAuditLimit(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return ADMIN_AUDIT_LIST_LIMIT_DEFAULT;
  }
  return Math.max(1, Math.min(ADMIN_AUDIT_LIST_LIMIT_MAX, Math.floor(parsed)));
}

async function authorizeAdminRequest(req, options = {}) {
  const minimumRole = normalizeAdminRole(options.minimumRole) ?? ADMIN_ROLES.viewer;
  const mode = resolveAdminAccessMode();
  if (mode === "disabled") {
    return {
      ok: false,
      status: 403,
      reason: "admin_disabled",
      mode,
    };
  }
  if (mode === "open") {
    return {
      ok: true,
      mode,
      authType: "open",
      role: ADMIN_ROLES.owner,
      roleSource: "open",
    };
  }

  const adminToken = extractAdminTokenFromRequest(req);
  if (mode === "token") {
    if (!adminToken) {
      return {
        ok: false,
        status: 401,
        reason: "missing_admin_token",
        mode,
      };
    }
    if (adminToken !== ADMIN_TOKEN) {
      return {
        ok: false,
        status: 401,
        reason: "invalid_admin_token",
        mode,
      };
    }
    return {
      ok: true,
      mode,
      authType: "token",
      role: ADMIN_ROLES.owner,
      roleSource: "token",
    };
  }

  if (mode === "hybrid" && adminToken && adminToken === ADMIN_TOKEN) {
    return {
      ok: true,
      mode,
      authType: "token",
      role: ADMIN_ROLES.owner,
      roleSource: "token",
    };
  }

  const identity = await authorizeIdentityRequest(req, {
    allowSessionToken: false,
    requireNonAnonymous: true,
  });
  if (!identity.ok) {
    return {
      ok: false,
      status: 401,
      reason: identity.reason ?? "invalid_auth",
      mode,
    };
  }

  upsertFirebasePlayer(identity.uid, {
    displayName: identity.displayName,
    email: identity.email,
    photoUrl: identity.photoUrl,
    provider: identity.provider,
    providerId: identity.providerId,
    isAnonymous: false,
  });

  const roleInfo = resolveAdminRoleForIdentity(identity.uid, identity.email);
  if (!roleInfo.role) {
    return {
      ok: false,
      status: 403,
      reason: "admin_role_required",
      mode,
      uid: identity.uid,
      email: identity.email,
    };
  }
  if (!hasRequiredAdminRole(roleInfo.role, minimumRole)) {
    return {
      ok: false,
      status: 403,
      reason: "admin_role_forbidden",
      mode,
      uid: identity.uid,
      email: identity.email,
      role: roleInfo.role,
      roleSource: roleInfo.source,
    };
  }

  return {
    ok: true,
    mode,
    authType: "role",
    uid: identity.uid,
    email: identity.email,
    role: roleInfo.role,
    roleSource: roleInfo.source,
  };
}

function resolveAdminAccessMode() {
  if (ADMIN_ACCESS_MODE === "disabled") {
    return "disabled";
  }
  if (ADMIN_ACCESS_MODE === "open") {
    return "open";
  }
  if (ADMIN_ACCESS_MODE === "token") {
    return ADMIN_TOKEN ? "token" : "disabled";
  }
  if (ADMIN_ACCESS_MODE === "role") {
    return "role";
  }
  if (ADMIN_ACCESS_MODE === "hybrid") {
    return ADMIN_TOKEN ? "hybrid" : "role";
  }
  if (ADMIN_TOKEN) {
    return "hybrid";
  }
  if (hasBootstrapAdminOwnersConfigured()) {
    return "role";
  }
  return NODE_ENV === "production" ? "role" : "open";
}

function buildAdminPrincipal(authResult) {
  if (!authResult?.ok) {
    return null;
  }
  return {
    authType: authResult.authType ?? "unknown",
    uid: authResult.uid ?? null,
    role: authResult.role ?? null,
    roleSource: authResult.roleSource ?? "none",
  };
}

function collectAdminAuditEntries(limit = ADMIN_AUDIT_LIST_LIMIT_DEFAULT) {
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(ADMIN_AUDIT_LIST_LIMIT_MAX, Math.floor(limit)))
    : ADMIN_AUDIT_LIST_LIMIT_DEFAULT;

  return Object.values(store.gameLogs)
    .filter((entry) => entry && entry.type === "admin_action")
    .sort((left, right) => Number(right?.timestamp ?? 0) - Number(left?.timestamp ?? 0))
    .slice(0, boundedLimit)
    .map((entry) => {
      const payload = entry?.payload && typeof entry.payload === "object" ? entry.payload : {};
      const actor =
        payload?.actor && typeof payload.actor === "object"
          ? payload.actor
          : {};
      const target =
        payload?.target && typeof payload.target === "object"
          ? payload.target
          : {};
      return {
        id: typeof entry?.id === "string" ? entry.id : randomUUID(),
        timestamp: Number.isFinite(entry?.timestamp) ? Math.floor(entry.timestamp) : Date.now(),
        action: typeof payload.action === "string" ? payload.action : "unknown",
        summary: typeof payload.summary === "string" ? payload.summary : undefined,
        actor: {
          uid: typeof actor.uid === "string" ? actor.uid : null,
          email: typeof actor.email === "string" ? actor.email : undefined,
          role: normalizeAdminRole(actor.role),
          authType: typeof actor.authType === "string" ? actor.authType : "unknown",
        },
        target: {
          uid: typeof target.uid === "string" ? target.uid : undefined,
          role: normalizeAdminRole(target.role),
          sessionId: typeof target.sessionId === "string" ? target.sessionId : undefined,
          playerId: typeof target.playerId === "string" ? target.playerId : undefined,
        },
      };
    });
}

function recordAdminAuditEvent(authResult, action, details = {}) {
  const timestamp = Date.now();
  const actorUid = typeof authResult?.uid === "string" ? authResult.uid : null;
  const actorEmail = typeof authResult?.email === "string" ? authResult.email : undefined;
  const actorRole = normalizeAdminRole(authResult?.role);
  const actorAuthType =
    typeof authResult?.authType === "string" && authResult.authType
      ? authResult.authType
      : "unknown";
  const rawDetails = details && typeof details === "object" ? details : {};
  const targetUid =
    typeof rawDetails.targetUid === "string" && rawDetails.targetUid.trim()
      ? rawDetails.targetUid.trim()
      : undefined;
  const targetRole = normalizeAdminRole(rawDetails.role);
  const targetSessionId =
    typeof rawDetails.sessionId === "string" && rawDetails.sessionId.trim()
      ? rawDetails.sessionId.trim()
      : undefined;
  const targetPlayerId =
    typeof rawDetails.playerId === "string" && rawDetails.playerId.trim()
      ? rawDetails.playerId.trim()
      : undefined;
  const summary =
    typeof rawDetails.summary === "string" && rawDetails.summary.trim()
      ? rawDetails.summary.trim()
      : undefined;
  const id = randomUUID();
  const fallbackActorId =
    actorUid ??
    (typeof authResult?.authType === "string" && authResult.authType ? `admin:${authResult.authType}` : "admin:unknown");

  const nextDetails = { ...rawDetails };
  delete nextDetails.targetUid;
  delete nextDetails.role;
  delete nextDetails.sessionId;
  delete nextDetails.playerId;
  delete nextDetails.summary;

  store.gameLogs[id] = {
    id,
    playerId: fallbackActorId,
    sessionId: targetSessionId,
    type: "admin_action",
    timestamp,
    payload: {
      action,
      summary,
      actor: {
        uid: actorUid,
        email: actorEmail,
        role: actorRole,
        authType: actorAuthType,
      },
      target: {
        uid: targetUid,
        role: targetRole,
        sessionId: targetSessionId,
        playerId: targetPlayerId,
      },
      details: nextDetails,
    },
  };
  compactLogStore();
}

function collectAdminRoleRecords() {
  const records = [];
  const seenUids = new Set();

  Object.entries(store.firebasePlayers).forEach(([uid, playerRecord]) => {
    const record = buildAdminRoleRecord(uid, playerRecord);
    if (!record) {
      return;
    }
    records.push(record);
    seenUids.add(uid);
  });

  ADMIN_OWNER_UID_ALLOWLIST.forEach((uid) => {
    if (seenUids.has(uid)) {
      return;
    }
    records.push(
      buildAdminRoleRecord(uid, {
        uid,
      })
    );
  });

  return records;
}

function buildAdminRoleRecord(uid, playerRecord) {
  if (typeof uid !== "string" || !uid.trim()) {
    return null;
  }
  const record = playerRecord && typeof playerRecord === "object" ? playerRecord : {};
  const normalizedUid = uid.trim();
  const roleInfo = resolveAdminRoleForIdentity(normalizedUid, record.email);
  return {
    uid: normalizedUid,
    displayName: typeof record.displayName === "string" ? record.displayName : undefined,
    email: typeof record.email === "string" ? record.email : undefined,
    photoUrl: typeof record.photoUrl === "string" ? record.photoUrl : undefined,
    provider: typeof record.provider === "string" ? record.provider : undefined,
    providerId: typeof record.providerId === "string" ? record.providerId : undefined,
    role: roleInfo.role,
    source: roleInfo.source,
    updatedAt: Number.isFinite(record.updatedAt) ? Math.floor(record.updatedAt) : undefined,
    roleUpdatedAt: Number.isFinite(record.adminRoleUpdatedAt)
      ? Math.floor(record.adminRoleUpdatedAt)
      : undefined,
    roleUpdatedBy:
      typeof record.adminRoleUpdatedBy === "string" ? record.adminRoleUpdatedBy : undefined,
  };
}

function resolveAdminRoleForIdentity(uid, email) {
  const normalizedUid = typeof uid === "string" ? uid.trim() : "";
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (normalizedUid && ADMIN_OWNER_UID_ALLOWLIST.has(normalizedUid)) {
    return {
      role: ADMIN_ROLES.owner,
      source: "bootstrap",
    };
  }
  if (normalizedEmail && ADMIN_OWNER_EMAIL_ALLOWLIST.has(normalizedEmail)) {
    return {
      role: ADMIN_ROLES.owner,
      source: "bootstrap",
    };
  }
  const storedRole = normalizeAdminRole(store.firebasePlayers?.[normalizedUid]?.adminRole);
  if (storedRole) {
    return {
      role: storedRole,
      source: "assigned",
    };
  }
  return {
    role: null,
    source: "none",
  };
}

function normalizeAdminRole(rawValue) {
  const normalized = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
  if (normalized === ADMIN_ROLES.viewer) {
    return ADMIN_ROLES.viewer;
  }
  if (normalized === ADMIN_ROLES.operator) {
    return ADMIN_ROLES.operator;
  }
  if (normalized === ADMIN_ROLES.owner) {
    return ADMIN_ROLES.owner;
  }
  return null;
}

function hasRequiredAdminRole(actualRole, requiredRole) {
  const actual = normalizeAdminRole(actualRole);
  const required = normalizeAdminRole(requiredRole) ?? ADMIN_ROLES.viewer;
  if (!actual) {
    return false;
  }
  return ADMIN_ROLE_LEVELS[actual] >= ADMIN_ROLE_LEVELS[required];
}

function isBootstrapOwnerUid(uid) {
  const normalizedUid = typeof uid === "string" ? uid.trim() : "";
  return Boolean(normalizedUid) && ADMIN_OWNER_UID_ALLOWLIST.has(normalizedUid);
}

function hasBootstrapAdminOwnersConfigured() {
  return ADMIN_OWNER_UID_ALLOWLIST.size > 0 || ADMIN_OWNER_EMAIL_ALLOWLIST.size > 0;
}

function extractAdminTokenFromRequest(req) {
  const headerToken =
    typeof req?.headers?.["x-admin-token"] === "string"
      ? req.headers["x-admin-token"].trim()
      : "";
  if (headerToken) {
    return headerToken;
  }

  const authHeader = typeof req?.headers?.authorization === "string" ? req.headers.authorization : "";
  const bearer = extractBearerToken(authHeader);
  return bearer || "";
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
        photoUrl: undefined,
        isAnonymous: true,
        provider: "session",
        providerId: "session",
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
    photoUrl: normalizeAvatarUrl(firebaseClaims.picture),
    isAnonymous: firebaseClaims.isAnonymous,
    provider: "firebase",
    providerId: normalizeProviderId(firebaseClaims.signInProvider),
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
  const snapshot = buildSessionSnapshot(session);
  const now = Date.now();
  return {
    sessionId: snapshot.sessionId,
    roomCode: snapshot.roomCode,
    gameDifficulty: snapshot.gameDifficulty,
    roomType: snapshot.roomType,
    isPublic: snapshot.isPublic,
    maxHumanCount: snapshot.maxHumanCount,
    availableHumanSlots: snapshot.availableHumanSlots,
    wsUrl: session.wsUrl,
    playerToken: auth.accessToken,
    auth,
    participants: snapshot.participants,
    turnState: snapshot.turnState,
    standings: snapshot.standings,
    sessionComplete: snapshot.sessionComplete,
    completedAt: snapshot.completedAt,
    createdAt: snapshot.createdAt,
    gameStartedAt: snapshot.gameStartedAt,
    nextGameStartsAt: snapshot.nextGameStartsAt,
    nextGameAutoStartDelayMs: snapshot.nextGameAutoStartDelayMs,
    lastActivityAt: snapshot.lastActivityAt,
    expiresAt: snapshot.expiresAt,
    serverNow: now,
  };
}

function buildSessionSnapshot(session) {
  const turnState = ensureSessionTurnState(session);
  const participants = serializeSessionParticipants(session);
  const standings = buildSessionStandings(session);
  const gameStartedAt = resolveSessionGameStartedAt(session);
  const nextGameStartsAt = resolveSessionNextGameStartsAt(session, gameStartedAt);
  const humanCount = participants.filter((participant) => !isBotParticipant(participant)).length;
  const activeGameParticipants = participants.filter(
    (participant) => participant.queuedForNextGame !== true
  );
  const roomKind = getSessionRoomKind(session);
  const sessionComplete =
    activeGameParticipants.length > 0 &&
    activeGameParticipants.every((participant) => participant.isComplete === true);
  return {
    sessionId: session.sessionId,
    roomCode: session.roomCode,
    gameDifficulty: resolveSessionGameDifficulty(session),
    roomType: roomKind,
    isPublic: roomKind === ROOM_KINDS.publicDefault || roomKind === ROOM_KINDS.publicOverflow,
    maxHumanCount: MAX_MULTIPLAYER_HUMAN_PLAYERS,
    availableHumanSlots: Math.max(0, MAX_MULTIPLAYER_HUMAN_PLAYERS - humanCount),
    participants,
    turnState: serializeTurnState(turnState),
    standings,
    sessionComplete,
    completedAt: sessionComplete ? resolveSessionCompletedAt(standings) : null,
    createdAt: session.createdAt,
    gameStartedAt,
    nextGameStartsAt,
    nextGameAutoStartDelayMs: NEXT_GAME_AUTO_START_DELAY_MS,
    lastActivityAt: resolveSessionLastActivityAt(session),
    expiresAt: session.expiresAt,
  };
}

function buildSessionStateMessage(session, options = {}) {
  if (!session) {
    return null;
  }
  const now = Date.now();

  return {
    type: "session_state",
    ...buildSessionSnapshot(session),
    timestamp: now,
    serverNow: now,
    source: options.source ?? "server",
  };
}

function buildRoomListing(session, now = Date.now()) {
  if (!session || typeof session !== "object") {
    return null;
  }
  if (!Number.isFinite(session.expiresAt) || session.expiresAt <= now) {
    return null;
  }

  const participants = serializeSessionParticipants(session);
  const humans = participants.filter((participant) => !isBotParticipant(participant));
  const activeGameHumans = humans.filter((participant) => participant.queuedForNextGame !== true);
  const activeHumanCount = humans.filter((participant) =>
    isRoomParticipantActive(session.sessionId, participant, now)
  ).length;
  const readyHumanCount = humans.filter((participant) => participant?.isReady === true).length;
  const botCount = participants.filter((participant) => isBotParticipant(participant)).length;
  const lastActivityAt = resolveSessionLastActivityAt(session);
  const sessionComplete =
    activeGameHumans.length > 0 &&
    activeGameHumans.every((participant) => participant?.isComplete === true);
  const roomKind = getSessionRoomKind(session);
  const availableHumanSlots = Math.max(0, MAX_MULTIPLAYER_HUMAN_PLAYERS - humans.length);

  return {
    sessionId: session.sessionId,
    roomCode: session.roomCode,
    gameDifficulty: resolveSessionGameDifficulty(session),
    createdAt: Number.isFinite(session.createdAt) ? Math.floor(session.createdAt) : now,
    lastActivityAt,
    expiresAt: Math.max(now, Math.floor(session.expiresAt)),
    participantCount: participants.length,
    humanCount: humans.length,
    activeHumanCount,
    readyHumanCount,
    maxHumanCount: MAX_MULTIPLAYER_HUMAN_PLAYERS,
    availableHumanSlots,
    botCount,
    sessionComplete,
    roomType: roomKind,
    isPublic: roomKind === ROOM_KINDS.publicDefault || roomKind === ROOM_KINDS.publicOverflow,
  };
}

function resolveRoomListPriority(room) {
  const roomType = normalizeRoomKind(room?.roomType);
  if (roomType === ROOM_KINDS.publicDefault) {
    return 0;
  }
  if (roomType === ROOM_KINDS.publicOverflow) {
    return 1;
  }
  return 2;
}

function normalizeRoomKind(value) {
  if (
    value === ROOM_KINDS.private ||
    value === ROOM_KINDS.publicDefault ||
    value === ROOM_KINDS.publicOverflow
  ) {
    return value;
  }
  return ROOM_KINDS.private;
}

function getSessionRoomKind(session) {
  return normalizeRoomKind(session?.roomKind);
}

function normalizePublicRoomSlot(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const slot = Math.floor(parsed);
  if (slot < 0) {
    return null;
  }
  return slot;
}

function buildDefaultPublicRoomCode(slot) {
  return normalizeRoomCode(`${PUBLIC_ROOM_CODE_PREFIX}${slot + 1}`);
}

function resolveDefaultPublicRoomDifficulty(slot) {
  const normalizedSlot = normalizePublicRoomSlot(slot);
  if (normalizedSlot === null) {
    return "normal";
  }
  const difficultyIndex = normalizedSlot % PUBLIC_ROOM_DIFFICULTY_ORDER.length;
  return PUBLIC_ROOM_DIFFICULTY_ORDER[difficultyIndex] ?? "normal";
}

function buildPublicOverflowRoomCode() {
  const existingCodes = new Set(
    Object.values(store.multiplayerSessions)
      .map((session) => (typeof session?.roomCode === "string" ? session.roomCode : ""))
      .filter((code) => code.length > 0)
  );

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = normalizeRoomCode(`${PUBLIC_ROOM_CODE_PREFIX}${randomToken().slice(0, 4).toUpperCase()}`);
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
  }

  return normalizeRoomCode(randomToken().slice(0, 6));
}

function isSessionCompleteForHumans(session) {
  const participants = serializeSessionParticipants(session);
  const humans = participants.filter(
    (participant) => !isBotParticipant(participant) && participant.queuedForNextGame !== true
  );
  return humans.length > 0 && humans.every((participant) => participant?.isComplete === true);
}

function isSessionJoinablePublicRoom(session, now = Date.now()) {
  if (!session || typeof session !== "object") {
    return false;
  }
  const roomKind = getSessionRoomKind(session);
  if (roomKind !== ROOM_KINDS.publicDefault && roomKind !== ROOM_KINDS.publicOverflow) {
    return false;
  }
  if (!Number.isFinite(session.expiresAt) || session.expiresAt <= now) {
    return false;
  }
  if (isSessionCompleteForHumans(session)) {
    return false;
  }
  return getHumanParticipantCount(session) < MAX_MULTIPLAYER_HUMAN_PLAYERS;
}

function createPublicRoom(roomKind, now = Date.now(), slot = null, options = {}) {
  const normalizedKind =
    roomKind === ROOM_KINDS.publicDefault ? ROOM_KINDS.publicDefault : ROOM_KINDS.publicOverflow;
  const normalizedSlot =
    normalizedKind === ROOM_KINDS.publicDefault && Number.isFinite(slot)
      ? Math.max(0, Math.floor(slot))
      : null;
  const sessionId = randomUUID();
  const roomCode =
    normalizedSlot !== null
      ? buildDefaultPublicRoomCode(normalizedSlot)
      : buildPublicOverflowRoomCode();
  const preferredDifficulty = normalizeGameDifficulty(options?.gameDifficulty);
  const sessionDifficulty =
    normalizedSlot !== null
      ? resolveDefaultPublicRoomDifficulty(normalizedSlot)
      : preferredDifficulty;
  const session = {
    sessionId,
    roomCode,
    gameDifficulty: sessionDifficulty,
    wsUrl: WS_BASE_URL,
    roomKind: normalizedKind,
    createdAt: now,
    gameStartedAt: now,
    lastActivityAt: now,
    expiresAt:
      normalizedKind === ROOM_KINDS.publicDefault
        ? now + MULTIPLAYER_SESSION_IDLE_TTL_MS
        : now + PUBLIC_ROOM_OVERFLOW_EMPTY_TTL_MS,
    participants: {},
    turnState: null,
  };
  if (normalizedSlot !== null) {
    session.publicRoomSlot = normalizedSlot;
  }

  store.multiplayerSessions[sessionId] = session;
  ensureSessionTurnState(session);
  reconcileSessionLoops(sessionId);
  return session;
}

function resetPublicRoomForIdle(session, now = Date.now()) {
  if (!session || typeof session !== "object") {
    return;
  }

  const roomKind = getSessionRoomKind(session);
  const normalizedSlot = normalizePublicRoomSlot(session.publicRoomSlot);
  session.participants = {};
  session.turnState = null;
  session.gameDifficulty =
    roomKind === ROOM_KINDS.publicDefault
      ? resolveDefaultPublicRoomDifficulty(normalizedSlot)
      : normalizeGameDifficulty(session.gameDifficulty);
  session.gameStartedAt = now;
  session.lastActivityAt = now;
  session.expiresAt =
    roomKind === ROOM_KINDS.publicDefault
      ? now + MULTIPLAYER_SESSION_IDLE_TTL_MS
      : now + PUBLIC_ROOM_OVERFLOW_EMPTY_TTL_MS;
  ensureSessionTurnState(session);
}

function pruneInactivePublicRoomParticipants(sessionId, session, now = Date.now()) {
  if (!session || typeof session !== "object" || !session.participants) {
    return false;
  }

  let changed = false;
  Object.entries(session.participants).forEach(([playerId, participant]) => {
    if (!participant || typeof participant !== "object") {
      delete session.participants[playerId];
      changed = true;
      return;
    }
    if (isBotParticipant(participant)) {
      return;
    }
    if (isSessionParticipantConnected(sessionId, playerId)) {
      return;
    }

    const lastHeartbeatAt =
      Number.isFinite(participant.lastHeartbeatAt) && participant.lastHeartbeatAt > 0
        ? Math.floor(participant.lastHeartbeatAt)
        : 0;
    if (lastHeartbeatAt > 0 && now - lastHeartbeatAt <= PUBLIC_ROOM_STALE_PARTICIPANT_MS) {
      return;
    }

    delete session.participants[playerId];
    disconnectPlayerSockets(sessionId, playerId, WS_CLOSE_CODES.normal, "stale_public_room_member");
    changed = true;
  });

  if (!changed) {
    return false;
  }

  ensureSessionTurnState(session);
  if (getHumanParticipantCount(session) === 0) {
    resetPublicRoomForIdle(session, now);
  }
  reconcileSessionLoops(sessionId);
  const hasConnectedClients = (wsSessionClients.get(sessionId)?.size ?? 0) > 0;
  if (hasConnectedClients) {
    const turnStart = buildTurnStartMessage(session, { source: "prune" });
    if (turnStart) {
      broadcastToSession(sessionId, JSON.stringify(turnStart), null);
    }
    broadcastSessionState(session, "prune");
  }
  return true;
}

function reconcilePublicRoomInventory(now = Date.now()) {
  let changed = false;
  const defaultSlots = new Map();

  Object.entries(store.multiplayerSessions).forEach(([sessionId, session]) => {
    if (!session || typeof session !== "object") {
      return;
    }

    const normalizedKind = normalizeRoomKind(session.roomKind);
    if (session.roomKind !== normalizedKind) {
      session.roomKind = normalizedKind;
      changed = true;
    }

    if (
      normalizedKind === ROOM_KINDS.publicDefault ||
      normalizedKind === ROOM_KINDS.publicOverflow
    ) {
      if (pruneInactivePublicRoomParticipants(sessionId, session, now)) {
        changed = true;
      }
    }

    if (normalizedKind === ROOM_KINDS.publicOverflow) {
      const humanCount = getHumanParticipantCount(session);
      if (!Number.isFinite(session.expiresAt)) {
        session.expiresAt =
          now +
          (humanCount > 0
            ? MULTIPLAYER_SESSION_IDLE_TTL_MS
            : PUBLIC_ROOM_OVERFLOW_EMPTY_TTL_MS);
        changed = true;
      } else if (humanCount > 0 && session.expiresAt <= now + 5000) {
        session.expiresAt = now + MULTIPLAYER_SESSION_IDLE_TTL_MS;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(session, "publicRoomSlot")) {
        delete session.publicRoomSlot;
        changed = true;
      }
      return;
    }

    if (normalizedKind !== ROOM_KINDS.publicDefault) {
      if (Object.prototype.hasOwnProperty.call(session, "publicRoomSlot")) {
        delete session.publicRoomSlot;
        changed = true;
      }
      return;
    }

    const normalizedSlot = normalizePublicRoomSlot(session.publicRoomSlot);
    if (normalizedSlot === null || normalizedSlot >= PUBLIC_ROOM_DEFAULT_TARGET_COUNT) {
      session.roomKind = ROOM_KINDS.publicOverflow;
      if (Object.prototype.hasOwnProperty.call(session, "publicRoomSlot")) {
        delete session.publicRoomSlot;
      }
      changed = true;
      return;
    }

    if (defaultSlots.has(normalizedSlot)) {
      session.roomKind = ROOM_KINDS.publicOverflow;
      delete session.publicRoomSlot;
      changed = true;
      return;
    }

    defaultSlots.set(normalizedSlot, sessionId);
    if (session.publicRoomSlot !== normalizedSlot) {
      session.publicRoomSlot = normalizedSlot;
      changed = true;
    }

    const expectedCode = buildDefaultPublicRoomCode(normalizedSlot);
    if (session.roomCode !== expectedCode) {
      session.roomCode = expectedCode;
      changed = true;
    }
    const expectedDifficulty = resolveDefaultPublicRoomDifficulty(normalizedSlot);
    if (
      resolveSessionGameDifficulty(session) !== expectedDifficulty &&
      getHumanParticipantCount(session) === 0
    ) {
      session.gameDifficulty = expectedDifficulty;
      changed = true;
    }

    if (!Number.isFinite(session.expiresAt) || session.expiresAt <= now + 5000) {
      session.expiresAt = now + MULTIPLAYER_SESSION_IDLE_TTL_MS;
      changed = true;
    }
  });

  for (let slot = 0; slot < PUBLIC_ROOM_DEFAULT_TARGET_COUNT; slot += 1) {
    if (!defaultSlots.has(slot)) {
      createPublicRoom(ROOM_KINDS.publicDefault, now, slot);
      changed = true;
    }
  }

  const joinablePublicRoomsByDifficulty = new Map(
    PUBLIC_ROOM_DIFFICULTY_ORDER.map((difficulty) => [difficulty, 0])
  );
  let joinablePublicRooms = Object.values(store.multiplayerSessions).filter((session) =>
    isSessionJoinablePublicRoom(session, now)
  ).length;
  Object.values(store.multiplayerSessions).forEach((session) => {
    if (!isSessionJoinablePublicRoom(session, now)) {
      return;
    }
    const difficulty = resolveSessionGameDifficulty(session);
    const currentCount = joinablePublicRoomsByDifficulty.get(difficulty) ?? 0;
    joinablePublicRoomsByDifficulty.set(difficulty, currentCount + 1);
  });

  PUBLIC_ROOM_DIFFICULTY_ORDER.forEach((difficulty) => {
    let availableCount = joinablePublicRoomsByDifficulty.get(difficulty) ?? 0;
    while (availableCount < PUBLIC_ROOM_MIN_PER_DIFFICULTY) {
      createPublicRoom(ROOM_KINDS.publicOverflow, now, null, {
        gameDifficulty: difficulty,
      });
      availableCount += 1;
      joinablePublicRooms += 1;
      joinablePublicRoomsByDifficulty.set(difficulty, availableCount);
      changed = true;
    }
  });

  while (joinablePublicRooms < PUBLIC_ROOM_MIN_JOINABLE) {
    createPublicRoom(ROOM_KINDS.publicOverflow, now);
    joinablePublicRooms += 1;
    changed = true;
  }

  return changed;
}

function resolveSessionGameDifficulty(session) {
  if (!session || typeof session !== "object") {
    return "normal";
  }
  return normalizeGameDifficulty(session.gameDifficulty);
}

function resolveSessionGameStartedAt(session, fallback = Date.now()) {
  if (!session || typeof session !== "object") {
    return Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : Date.now();
  }

  const createdAt =
    Number.isFinite(session.createdAt) && session.createdAt > 0
      ? Math.floor(session.createdAt)
      : Number.isFinite(fallback) && fallback > 0
        ? Math.floor(fallback)
        : Date.now();
  const gameStartedAt =
    Number.isFinite(session.gameStartedAt) && session.gameStartedAt > 0
      ? Math.floor(session.gameStartedAt)
      : createdAt;

  if (session.gameStartedAt !== gameStartedAt) {
    session.gameStartedAt = gameStartedAt;
  }

  return gameStartedAt;
}

function resolveSessionNextGameStartsAt(session, fallback = Date.now()) {
  const gameStartedAt = resolveSessionGameStartedAt(session, fallback);
  const defaultNextGameStartsAt = gameStartedAt + NEXT_GAME_AUTO_START_DELAY_MS;
  const scheduledNextGameStartsAt = normalizePostGameTimestamp(session?.nextGameStartsAt);
  if (scheduledNextGameStartsAt !== null) {
    return scheduledNextGameStartsAt;
  }
  return defaultNextGameStartsAt;
}

function isRoomParticipantActive(sessionId, participant, now = Date.now()) {
  if (!participant || typeof participant.playerId !== "string") {
    return false;
  }
  if (isSessionParticipantConnected(sessionId, participant.playerId)) {
    return true;
  }
  const lastHeartbeatAt = Number.isFinite(participant.lastHeartbeatAt)
    ? Math.floor(participant.lastHeartbeatAt)
    : 0;
  return lastHeartbeatAt > 0 && now - lastHeartbeatAt <= MULTIPLAYER_ROOM_ACTIVE_WINDOW_MS;
}

function resolveSessionLastActivityAt(session) {
  if (!session || typeof session !== "object") {
    return Date.now();
  }
  let lastActivityAt =
    Number.isFinite(session.lastActivityAt) && session.lastActivityAt > 0
      ? Math.floor(session.lastActivityAt)
      : 0;

  if (session.participants && typeof session.participants === "object") {
    Object.values(session.participants).forEach((participant) => {
      if (!participant || typeof participant !== "object") {
        return;
      }
      const joinedAt =
        Number.isFinite(participant.joinedAt) && participant.joinedAt > 0
          ? Math.floor(participant.joinedAt)
          : 0;
      const lastHeartbeatAt =
        Number.isFinite(participant.lastHeartbeatAt) && participant.lastHeartbeatAt > 0
          ? Math.floor(participant.lastHeartbeatAt)
          : 0;
      lastActivityAt = Math.max(lastActivityAt, joinedAt, lastHeartbeatAt);
    });
  }

  if (session.turnState && Number.isFinite(session.turnState.updatedAt) && session.turnState.updatedAt > 0) {
    lastActivityAt = Math.max(lastActivityAt, Math.floor(session.turnState.updatedAt));
  }

  if (Number.isFinite(session.createdAt) && session.createdAt > 0) {
    lastActivityAt = Math.max(lastActivityAt, Math.floor(session.createdAt));
  }

  return lastActivityAt > 0 ? lastActivityAt : Date.now();
}

function markSessionActivity(session, playerId, timestamp = Date.now(), options = {}) {
  if (!session || typeof session !== "object") {
    return;
  }
  if (typeof playerId === "string" && playerId) {
    const participant = session.participants?.[playerId];
    if (participant && isBotParticipant(participant)) {
      return;
    }
  }

  const activityAt = Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : Date.now();
  session.lastActivityAt = activityAt;
  session.expiresAt = activityAt + MULTIPLAYER_SESSION_IDLE_TTL_MS;
  if (options.countAsPlayerAction !== false) {
    markSessionPostGamePlayerAction(session, activityAt);
  }
}

function serializeTurnState(turnState) {
  if (!turnState) {
    return null;
  }

  const activeRoll = serializeTurnRollSnapshot(turnState.lastRollSnapshot);
  const turnTimeoutMs = normalizeTurnTimeoutMs(turnState.turnTimeoutMs);
  const turnExpiresAt =
    typeof turnState.turnExpiresAt === "number" &&
    Number.isFinite(turnState.turnExpiresAt) &&
    turnState.turnExpiresAt > 0
      ? Math.floor(turnState.turnExpiresAt)
      : null;
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
    activeRoll,
    activeRollServerId:
      typeof activeRoll?.serverRollId === "string"
        ? activeRoll.serverRollId
        : null,
    turnExpiresAt,
    turnTimeoutMs,
    updatedAt:
      Number.isFinite(turnState.updatedAt) ? Number(turnState.updatedAt) : Date.now(),
  };
}

function serializeTurnRollSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const rollIndex = Number.isFinite(snapshot.rollIndex) ? Math.floor(snapshot.rollIndex) : NaN;
  const rawDice = Array.isArray(snapshot.dice) ? snapshot.dice : [];
  if (!Number.isFinite(rollIndex) || rollIndex <= 0 || rawDice.length === 0) {
    return null;
  }

  const dice = [];
  for (const die of rawDice.slice(0, MAX_TURN_ROLL_DICE)) {
    if (!die || typeof die !== "object") {
      continue;
    }
    const dieId = typeof die.dieId === "string" ? die.dieId.trim() : "";
    const sides = Number.isFinite(die.sides) ? Math.floor(die.sides) : NaN;
    const value = Number.isFinite(die.value) ? Math.floor(die.value) : NaN;
    if (!dieId || !Number.isFinite(sides) || !Number.isFinite(value)) {
      continue;
    }
    if (sides < 2 || sides > 1000 || value < 1 || value > sides) {
      continue;
    }
    dice.push({
      dieId,
      sides,
      value,
    });
  }

  if (dice.length === 0) {
    return null;
  }

  const serverRollId =
    typeof snapshot.serverRollId === "string" && snapshot.serverRollId.trim()
      ? snapshot.serverRollId.trim()
      : null;

  return {
    rollIndex,
    dice,
    serverRollId,
    updatedAt: Number.isFinite(snapshot.updatedAt) ? Number(snapshot.updatedAt) : Date.now(),
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

  const remainingDice = normalizeParticipantRemainingDice(
    value.remainingDice,
    DEFAULT_PARTICIPANT_DICE_COUNT
  );
  const isComplete = value.isComplete === true || remainingDice === 0;
  return {
    selectedDiceIds,
    points,
    expectedPoints,
    rollServerId,
    projectedTotalScore:
      Number.isFinite(projectedTotalScore) && projectedTotalScore >= 0
        ? projectedTotalScore
        : null,
    remainingDice,
    isComplete,
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
  };
}

function parseDieSidesFromId(dieId) {
  if (typeof dieId !== "string") {
    return null;
  }
  const match = /^d(\d+)(?:-|$)/i.exec(dieId.trim());
  if (!match) {
    return null;
  }
  const sides = Number(match[1]);
  if (!Number.isFinite(sides) || sides < 2) {
    return null;
  }
  return Math.floor(sides);
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
    if (!dieId || seenIds.has(dieId)) {
      return { ok: false, reason: "invalid_roll_die_id" };
    }
    if (!Number.isFinite(sides) || sides < 2 || sides > 1000) {
      return { ok: false, reason: "invalid_roll_die_sides" };
    }
    const expectedSides = parseDieSidesFromId(dieId);
    if (Number.isFinite(expectedSides) && expectedSides !== sides) {
      return { ok: false, reason: "roll_die_sides_mismatch" };
    }
    seenIds.add(dieId);
    dice.push({
      dieId,
      sides,
      value: randomInt(1, sides + 1),
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

function parseTurnSelectionPayload(payload, lastRollSnapshot) {
  if (!lastRollSnapshot?.dice || !Array.isArray(lastRollSnapshot.dice)) {
    return { ok: false, reason: "missing_roll_snapshot" };
  }

  const select = payload?.select;
  if (!select || typeof select !== "object") {
    return { ok: false, reason: "missing_select_payload" };
  }

  const rawSelected = Array.isArray(select.selectedDiceIds) ? select.selectedDiceIds : null;
  if (!rawSelected) {
    return { ok: false, reason: "invalid_select_payload" };
  }
  if (rawSelected.length > MAX_TURN_SCORE_SELECTION) {
    return { ok: false, reason: "select_payload_too_large" };
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

  const rollServerId = typeof select.rollServerId === "string" ? select.rollServerId.trim() : "";
  const expectedRollServerId =
    typeof lastRollSnapshot.serverRollId === "string" ? lastRollSnapshot.serverRollId : "";
  if (rollServerId && expectedRollServerId && rollServerId !== expectedRollServerId) {
    return { ok: false, reason: "select_roll_mismatch" };
  }

  const validRollDiceIds = new Set(
    lastRollSnapshot.dice
      .map((die) => (typeof die?.dieId === "string" ? die.dieId : ""))
      .filter((dieId) => dieId.length > 0)
  );
  for (const dieId of selectedDiceIds) {
    if (!validRollDiceIds.has(dieId)) {
      return { ok: false, reason: "selected_die_not_in_roll" };
    }
  }

  return {
    ok: true,
    value: {
      selectedDiceIds,
      rollServerId: rollServerId || expectedRollServerId || undefined,
      updatedAt: Date.now(),
    },
  };
}

function serializeSessionParticipants(session) {
  const participants = Object.values(session?.participants ?? {})
    .filter((participant) => participant && typeof participant.playerId === "string")
    .map((participant) => {
      const remainingDice = normalizeParticipantRemainingDice(participant.remainingDice);
      const isComplete = participant.isComplete === true || remainingDice === 0;
      const queuedForNextGame = isParticipantQueuedForNextGame(participant);
      return {
        playerId: participant.playerId,
        displayName:
          typeof participant.displayName === "string" ? participant.displayName : undefined,
        avatarUrl: normalizeAvatarUrl(participant.avatarUrl),
        providerId: normalizeProviderId(participant.providerId),
        joinedAt:
          typeof participant.joinedAt === "number" ? participant.joinedAt : Date.now(),
        lastHeartbeatAt:
          typeof participant.lastHeartbeatAt === "number"
            ? participant.lastHeartbeatAt
            : Date.now(),
        isBot: Boolean(participant.isBot),
        botProfile: participant.isBot ? normalizeBotProfile(participant.botProfile) : undefined,
        isReady: participant.isBot ? true : participant.isReady === true,
        score: normalizeParticipantScore(participant.score),
        remainingDice,
        queuedForNextGame,
        isComplete,
        completedAt: isComplete
          ? normalizeParticipantCompletedAt(participant.completedAt)
          : null,
      };
    })
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
      queuedForNextGame: isParticipantQueuedForNextGame(participant),
      isComplete: isParticipantComplete(participant),
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

function buildSessionStandings(session) {
  const serializedParticipants = serializeSessionParticipants(session).filter(
    (participant) => participant.queuedForNextGame !== true
  );
  return [...serializedParticipants]
    .sort((left, right) => {
      const completeDelta = Number(right.isComplete === true) - Number(left.isComplete === true);
      if (completeDelta !== 0) {
        return completeDelta;
      }

      const remainingDelta =
        normalizeParticipantRemainingDice(left.remainingDice) -
        normalizeParticipantRemainingDice(right.remainingDice);
      if (remainingDelta !== 0) {
        return remainingDelta;
      }

      const leftCompletedAt = normalizeParticipantCompletedAt(left.completedAt) ?? Number.MAX_SAFE_INTEGER;
      const rightCompletedAt = normalizeParticipantCompletedAt(right.completedAt) ?? Number.MAX_SAFE_INTEGER;
      if (leftCompletedAt !== rightCompletedAt) {
        return leftCompletedAt - rightCompletedAt;
      }

      const scoreDelta = normalizeParticipantScore(left.score) - normalizeParticipantScore(right.score);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      const joinedDelta = left.joinedAt - right.joinedAt;
      if (joinedDelta !== 0) {
        return joinedDelta;
      }

      return left.playerId.localeCompare(right.playerId);
    })
    .map((participant, index) => ({
      ...participant,
      placement: index + 1,
    }));
}

function resolveSessionCompletedAt(standings) {
  if (!Array.isArray(standings) || standings.length === 0) {
    return null;
  }
  const completedAtValues = standings
    .map((participant) => normalizeParticipantCompletedAt(participant.completedAt))
    .filter((value) => Number.isFinite(value));
  if (completedAtValues.length === 0) {
    return null;
  }
  return Math.max(...completedAtValues);
}

function ensureSessionTurnState(session) {
  if (!session) {
    return null;
  }

  const currentState = session.turnState ?? null;
  const currentActiveTurnPlayerId =
    typeof currentState?.activeTurnPlayerId === "string"
      ? currentState.activeTurnPlayerId
      : null;
  const keepCompletedActivePlayer =
    normalizeTurnPhase(currentState?.phase) === TURN_PHASES.readyToEnd &&
    typeof currentActiveTurnPlayerId === "string" &&
    currentActiveTurnPlayerId.length > 0;

  const orderedParticipants = serializeParticipantsInJoinOrder(session).filter(
    (participant) =>
      participant &&
      !participant.isComplete &&
      participant.queuedForNextGame !== true &&
      (!keepCompletedActivePlayer || participant.playerId !== currentActiveTurnPlayerId)
  );
  if (keepCompletedActivePlayer) {
    const activeParticipant = session.participants?.[currentActiveTurnPlayerId];
    if (activeParticipant) {
      orderedParticipants.push({
        playerId: currentActiveTurnPlayerId,
        isComplete: false,
        joinedAt:
          typeof activeParticipant.joinedAt === "number" && Number.isFinite(activeParticipant.joinedAt)
            ? activeParticipant.joinedAt
            : 0,
      });
      orderedParticipants.sort((left, right) => {
        const joinedDelta = left.joinedAt - right.joinedAt;
        if (joinedDelta !== 0) {
          return joinedDelta;
        }
        return left.playerId.localeCompare(right.playerId);
      });
    }
  }

  const participantIds = orderedParticipants.map((participant) => participant.playerId);
  const participantIdSet = new Set(participantIds);
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

  const allHumansReady = areAllHumansReady(session);
  const now = Date.now();
  let activeTurnPlayerId =
    typeof currentState?.activeTurnPlayerId === "string"
      ? currentState.activeTurnPlayerId
      : null;
  let activeTurnRecovered = false;
  if (!allHumansReady || participantIds.length === 0) {
    activeTurnPlayerId = null;
  } else if (!activeTurnPlayerId || !nextOrder.includes(activeTurnPlayerId)) {
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
  const turnTimeoutMs = normalizeTurnTimeoutMs(currentState?.turnTimeoutMs);
  let phase = normalizeTurnPhase(currentState?.phase);
  let lastRollSnapshot = normalizeTurnRollSnapshot(currentState?.lastRollSnapshot);
  let lastScoreSummary = normalizeTurnScoreSummary(currentState?.lastScoreSummary);
  let turnExpiresAt =
    typeof currentState?.turnExpiresAt === "number" &&
    Number.isFinite(currentState.turnExpiresAt) &&
    currentState.turnExpiresAt > now
      ? Math.floor(currentState.turnExpiresAt)
      : null;

  if (!allHumansReady || nextOrder.length === 0) {
    phase = TURN_PHASES.awaitRoll;
    lastRollSnapshot = null;
    lastScoreSummary = null;
    turnExpiresAt = null;
  } else if (activeTurnRecovered) {
    phase = TURN_PHASES.awaitRoll;
    lastRollSnapshot = null;
    lastScoreSummary = null;
    turnExpiresAt = now + turnTimeoutMs;
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

  if (
    allHumansReady &&
    nextOrder.length > 0 &&
    activeTurnPlayerId &&
    (!turnExpiresAt || turnExpiresAt <= now)
  ) {
    turnExpiresAt = now + turnTimeoutMs;
  } else if (!allHumansReady || !activeTurnPlayerId || nextOrder.length === 0) {
    turnExpiresAt = null;
  }

  session.turnState = {
    order: nextOrder,
    activeTurnPlayerId,
    round,
    turnNumber,
    phase,
    lastRollSnapshot,
    lastScoreSummary,
    turnTimeoutMs,
    turnExpiresAt,
    updatedAt: now,
  };

  if (
    allHumansReady &&
    !session.turnState.activeTurnPlayerId &&
    session.turnState.order.length > 0
  ) {
    session.turnState.activeTurnPlayerId = session.turnState.order[0];
  }

  return session.turnState;
}

function buildTurnStartMessage(session, options = {}) {
  const turnState = ensureSessionTurnState(session);
  if (!turnState?.activeTurnPlayerId) {
    return null;
  }
  const now = Date.now();

  const activeRoll = serializeTurnRollSnapshot(turnState.lastRollSnapshot);
  const turnTimeoutMs = normalizeTurnTimeoutMs(turnState.turnTimeoutMs);
  const turnExpiresAt =
    typeof turnState.turnExpiresAt === "number" &&
    Number.isFinite(turnState.turnExpiresAt) &&
    turnState.turnExpiresAt > 0
      ? Math.floor(turnState.turnExpiresAt)
      : null;

  return {
    type: "turn_start",
    sessionId: session.sessionId,
    playerId: turnState.activeTurnPlayerId,
    round: turnState.round,
    turnNumber: turnState.turnNumber,
    phase: normalizeTurnPhase(turnState.phase),
    activeRoll,
    activeRollServerId:
      typeof activeRoll?.serverRollId === "string"
        ? activeRoll.serverRollId
        : null,
    gameStartedAt: resolveSessionGameStartedAt(session, now),
    turnExpiresAt,
    turnTimeoutMs,
    timestamp: now,
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
    ...(details.select ? { select: details.select } : {}),
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

  const timeoutMs = normalizeTurnTimeoutMs(turnState.turnTimeoutMs);
  const nextOrder = turnState.order.filter((playerId) => {
    const participant = session.participants?.[playerId];
    return Boolean(participant) && !isParticipantComplete(participant);
  });

  let nextActivePlayerId = null;
  let wrapped = false;
  for (let offset = 1; offset <= turnState.order.length; offset += 1) {
    const candidateIndex = (currentIndex + offset) % turnState.order.length;
    const candidatePlayerId = turnState.order[candidateIndex];
    const participant = session.participants?.[candidatePlayerId];
    if (!participant || isParticipantComplete(participant)) {
      continue;
    }
    nextActivePlayerId = candidatePlayerId;
    wrapped = candidateIndex <= currentIndex;
    break;
  }

  turnState.order = nextOrder;
  turnState.activeTurnPlayerId = nextActivePlayerId;
  if (nextActivePlayerId) {
    turnState.turnNumber = Math.max(1, Math.floor(turnState.turnNumber) + 1);
    if (wrapped) {
      turnState.round = Math.max(1, Math.floor(turnState.round) + 1);
    }
  }
  turnState.phase = TURN_PHASES.awaitRoll;
  turnState.lastRollSnapshot = null;
  turnState.lastScoreSummary = null;
  turnState.turnTimeoutMs = timeoutMs;
  turnState.turnExpiresAt = nextActivePlayerId ? timestamp + timeoutMs : null;
  turnState.updatedAt = timestamp;

  if (!nextActivePlayerId) {
    scheduleSessionPostGameLifecycle(session, timestamp);
  }
  const turnStart = nextActivePlayerId
    ? {
        type: "turn_start",
        sessionId: session.sessionId,
        playerId: turnState.activeTurnPlayerId,
        round: turnState.round,
        turnNumber: turnState.turnNumber,
        phase: normalizeTurnPhase(turnState.phase),
        gameStartedAt: resolveSessionGameStartedAt(session, timestamp),
        turnExpiresAt: turnState.turnExpiresAt,
        turnTimeoutMs: timeoutMs,
        timestamp,
        order: [...turnState.order],
        source: options.source ?? "player",
      }
    : null;

  return {
    turnEnd,
    turnStart,
  };
}

function resolveDataDir(rawValue) {
  if (typeof rawValue === "string" && rawValue.trim().length > 0) {
    return path.resolve(rawValue.trim());
  }
  return path.join(__dirname, "data");
}

function resolveDataFile(rawValue, dataDir) {
  if (typeof rawValue === "string" && rawValue.trim().length > 0) {
    return path.resolve(rawValue.trim());
  }
  return path.join(dataDir, "store.json");
}

function normalizeSessionIdleTtlValue(rawValue, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(SESSION_IDLE_TTL_MIN_MS, Math.floor(parsed));
}

function normalizeHumanPlayerLimitValue(rawValue, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(2, Math.min(8, Math.floor(parsed)));
}

function normalizePublicRoomCountValue(rawValue, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return Math.max(1, Math.min(8, Math.floor(fallback)));
  }
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

function normalizePublicRoomCodePrefix(rawValue, fallback = "LBY") {
  const source = typeof rawValue === "string" ? rawValue : fallback;
  const normalized = source.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 4);
}

function resolveStoreBackend(rawValue, nodeEnv) {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  if (normalized === "firestore" || normalized === "file") {
    return normalized;
  }
  return nodeEnv === "production" ? "firestore" : "file";
}

function parseDelimitedEnvSet(rawValue, normalizer = (value) => value) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return new Set();
  }
  const values = rawValue
    .split(/[,\s]+/)
    .map((value) => normalizer(value.trim()))
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  return new Set(values);
}

function normalizeAdminAccessMode(rawValue) {
  const normalized = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "auto";
  if (
    normalized === "open" ||
    normalized === "token" ||
    normalized === "role" ||
    normalized === "hybrid" ||
    normalized === "disabled"
  ) {
    return normalized;
  }
  return "auto";
}

function normalizeTurnTimeoutValue(rawValue, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(5000, Math.floor(parsed));
}

function normalizeTurnWarningValue(rawValue, timeoutMs, fallback) {
  const parsed = Number(rawValue);
  const defaultValue = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  return Math.max(1000, Math.min(timeoutMs - 500, defaultValue));
}

function normalizeTurnTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return TURN_TIMEOUT_MS;
  }
  return Math.max(5000, Math.floor(parsed));
}

function normalizeOptionalRoomCode(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.toUpperCase().slice(0, 8);
}

function normalizeRoomCode(value) {
  const normalized = normalizeOptionalRoomCode(value);
  if (normalized) {
    return normalized;
  }
  return randomToken().slice(0, 6).toUpperCase();
}

function findJoinableSessionByRoomCode(roomCode, now = Date.now()) {
  const normalizedRoomCode = normalizeOptionalRoomCode(roomCode);
  if (!normalizedRoomCode) {
    return null;
  }

  let selectedSession = null;
  let selectedPriority = -1;
  let selectedLastActivityAt = -1;
  let selectedCreatedAt = -1;

  Object.values(store.multiplayerSessions).forEach((session) => {
    if (!session || typeof session !== "object") {
      return;
    }
    if (!Number.isFinite(session.expiresAt) || session.expiresAt <= now) {
      return;
    }
    if (normalizeOptionalRoomCode(session.roomCode) !== normalizedRoomCode) {
      return;
    }

    const roomKind = getSessionRoomKind(session);
    const priority = roomKind === ROOM_KINDS.private ? 2 : 1;
    const lastActivityAt = resolveSessionLastActivityAt(session);
    const createdAt =
      Number.isFinite(session.createdAt) && session.createdAt > 0
        ? Math.floor(session.createdAt)
        : 0;
    if (
      priority > selectedPriority ||
      (priority === selectedPriority && lastActivityAt > selectedLastActivityAt) ||
      (priority === selectedPriority &&
        lastActivityAt === selectedLastActivityAt &&
        createdAt > selectedCreatedAt)
    ) {
      selectedSession = session;
      selectedPriority = priority;
      selectedLastActivityAt = lastActivityAt;
      selectedCreatedAt = createdAt;
    }
  });

  return selectedSession;
}

function isRoomCodeInUse(roomCode, now = Date.now(), options = {}) {
  const normalizedRoomCode = normalizeOptionalRoomCode(roomCode);
  if (!normalizedRoomCode) {
    return false;
  }

  const excludedSessionId =
    typeof options?.excludeSessionId === "string" ? options.excludeSessionId.trim() : "";
  return Object.values(store.multiplayerSessions).some((session) => {
    if (!session || typeof session !== "object") {
      return false;
    }
    if (excludedSessionId && session.sessionId === excludedSessionId) {
      return false;
    }
    if (!Number.isFinite(session.expiresAt) || session.expiresAt <= now) {
      return false;
    }
    return normalizeOptionalRoomCode(session.roomCode) === normalizedRoomCode;
  });
}

function generateUniquePrivateRoomCode(now = Date.now()) {
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const candidate = randomToken().slice(0, 6).toUpperCase();
    if (!isRoomCodeInUse(candidate, now)) {
      return candidate;
    }
  }

  return "";
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

function normalizeQueuedForNextGame(value) {
  return value === true;
}

function isParticipantQueuedForNextGame(participant) {
  if (!participant || typeof participant !== "object") {
    return false;
  }
  if (isBotParticipant(participant)) {
    return false;
  }
  return normalizeQueuedForNextGame(participant.queuedForNextGame);
}

function normalizeBotProfile(value) {
  if (typeof value !== "string") {
    return "balanced";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "cautious" || normalized === "aggressive") {
    return normalized;
  }
  return "balanced";
}

function normalizeGameDifficulty(value) {
  if (typeof value !== "string") {
    return "normal";
  }
  const normalized = value.trim().toLowerCase();
  if (!GAME_DIFFICULTIES.has(normalized)) {
    return "normal";
  }
  return normalized;
}

function normalizeParticipantScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function normalizeParticipantRemainingDice(value, fallback = DEFAULT_PARTICIPANT_DICE_COUNT) {
  const fallbackValue = Number.isFinite(fallback) ? Math.max(0, Math.floor(fallback)) : 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }
  return Math.max(0, Math.floor(parsed));
}

function normalizeParticipantCompletedAt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function isParticipantComplete(participant) {
  if (!participant || typeof participant !== "object") {
    return false;
  }
  if (participant.isComplete === true) {
    return true;
  }
  return normalizeParticipantRemainingDice(participant.remainingDice) === 0;
}

function isSessionGameInProgress(session) {
  if (!session || typeof session !== "object") {
    return false;
  }

  const turnState = session.turnState ?? null;
  const phase = normalizeTurnPhase(turnState?.phase);
  const round =
    Number.isFinite(turnState?.round) && turnState.round > 0
      ? Math.floor(turnState.round)
      : 1;
  const turnNumber =
    Number.isFinite(turnState?.turnNumber) && turnState.turnNumber > 0
      ? Math.floor(turnState.turnNumber)
      : 1;

  if (phase !== TURN_PHASES.awaitRoll) {
    return true;
  }
  if (round > 1 || turnNumber > 1) {
    return true;
  }

  return Object.values(session.participants ?? {}).some((participant) => {
    if (
      !participant ||
      typeof participant !== "object" ||
      isParticipantQueuedForNextGame(participant)
    ) {
      return false;
    }
    return (
      normalizeParticipantScore(participant.score) > 0 ||
      normalizeParticipantRemainingDice(participant.remainingDice) <
        DEFAULT_PARTICIPANT_DICE_COUNT ||
      isParticipantComplete(participant)
    );
  });
}

function shouldQueueParticipantForNextGame(session) {
  return isSessionGameInProgress(session);
}

function hasQueuedParticipantsForNextGame(session) {
  if (!session?.participants) {
    return false;
  }
  return Object.values(session.participants).some((participant) =>
    isParticipantQueuedForNextGame(participant)
  );
}

function areCurrentGameParticipantsComplete(session) {
  if (!session?.participants) {
    return false;
  }

  const activeParticipants = Object.values(session.participants).filter(
    (participant) => participant && !isParticipantQueuedForNextGame(participant)
  );
  if (activeParticipants.length === 0) {
    return hasQueuedParticipantsForNextGame(session);
  }

  return activeParticipants.every((participant) => isParticipantComplete(participant));
}

function normalizePostGameTimestamp(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}

function clearSessionPostGameLifecycleState(session) {
  if (!session || typeof session !== "object") {
    return false;
  }
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(session, "nextGameStartsAt")) {
    delete session.nextGameStartsAt;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(session, "postGameActivityAt")) {
    delete session.postGameActivityAt;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(session, "postGameIdleExpiresAt")) {
    delete session.postGameIdleExpiresAt;
    changed = true;
  }
  return changed;
}

function scheduleSessionPostGameLifecycle(session, timestamp = Date.now()) {
  if (!areCurrentGameParticipantsComplete(session)) {
    return false;
  }

  const completedAt = Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : Date.now();
  const gameStartedAt = resolveSessionGameStartedAt(session, completedAt);
  const nextGameStartsAt = gameStartedAt + NEXT_GAME_AUTO_START_DELAY_MS;
  const currentPostGameActivityAt = normalizePostGameTimestamp(session?.postGameActivityAt);
  const postGameActivityAt =
    currentPostGameActivityAt !== null ? currentPostGameActivityAt : completedAt;
  const currentPostGameIdleExpiresAt = normalizePostGameTimestamp(session?.postGameIdleExpiresAt);
  const postGameIdleExpiresAt =
    currentPostGameIdleExpiresAt !== null
      ? currentPostGameIdleExpiresAt
      : postGameActivityAt + POST_GAME_INACTIVITY_TIMEOUT_MS;

  let changed = false;
  if (normalizePostGameTimestamp(session.nextGameStartsAt) !== nextGameStartsAt) {
    session.nextGameStartsAt = nextGameStartsAt;
    changed = true;
  }
  if (normalizePostGameTimestamp(session.postGameActivityAt) !== postGameActivityAt) {
    session.postGameActivityAt = postGameActivityAt;
    changed = true;
  }
  if (normalizePostGameTimestamp(session.postGameIdleExpiresAt) !== postGameIdleExpiresAt) {
    session.postGameIdleExpiresAt = postGameIdleExpiresAt;
    changed = true;
  }
  return changed;
}

function markSessionPostGamePlayerAction(session, timestamp = Date.now()) {
  if (!areCurrentGameParticipantsComplete(session)) {
    return false;
  }
  const actionAt = Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : Date.now();
  const postGameIdleExpiresAt = actionAt + POST_GAME_INACTIVITY_TIMEOUT_MS;
  let changed = false;
  if (normalizePostGameTimestamp(session.postGameActivityAt) !== actionAt) {
    session.postGameActivityAt = actionAt;
    changed = true;
  }
  if (normalizePostGameTimestamp(session.postGameIdleExpiresAt) !== postGameIdleExpiresAt) {
    session.postGameIdleExpiresAt = postGameIdleExpiresAt;
    changed = true;
  }
  return changed;
}

function resetSessionForNextGame(session, timestamp = Date.now()) {
  if (!session?.participants) {
    return false;
  }

  const now = Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : Date.now();
  let changed = false;

  Object.values(session.participants).forEach((participant) => {
    if (!participant || typeof participant !== "object") {
      return;
    }
    if (isParticipantQueuedForNextGame(participant)) {
      changed = true;
    }
    if (
      normalizeParticipantScore(participant.score) !== 0 ||
      normalizeParticipantRemainingDice(participant.remainingDice) !==
        DEFAULT_PARTICIPANT_DICE_COUNT ||
      participant.isComplete === true ||
      normalizeParticipantCompletedAt(participant.completedAt) !== null
    ) {
      changed = true;
    }

    participant.score = 0;
    participant.remainingDice = DEFAULT_PARTICIPANT_DICE_COUNT;
    participant.queuedForNextGame = false;
    participant.isComplete = false;
    participant.completedAt = null;
    if (isBotParticipant(participant)) {
      participant.isReady = true;
    }
  });

  if (clearSessionPostGameLifecycleState(session)) {
    changed = true;
  }
  if (!changed) {
    return false;
  }

  session.gameStartedAt = now;
  session.turnState = null;
  ensureSessionTurnState(session);
  markSessionActivity(session, "", now);
  return true;
}

function completeSessionRoundWithWinner(session, winnerPlayerId, timestamp = Date.now()) {
  if (!session?.participants || typeof winnerPlayerId !== "string" || !winnerPlayerId) {
    return { ok: false };
  }

  const winner = session.participants[winnerPlayerId];
  if (!winner || isParticipantQueuedForNextGame(winner)) {
    return { ok: false };
  }

  const completedAt =
    Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : Date.now();
  winner.isComplete = true;
  winner.remainingDice = 0;
  winner.completedAt = normalizeParticipantCompletedAt(winner.completedAt) ?? completedAt;

  let completionCursor = completedAt + 1;
  Object.entries(session.participants).forEach(([playerId, participant]) => {
    if (
      playerId === winnerPlayerId ||
      !participant ||
      typeof participant !== "object" ||
      isParticipantQueuedForNextGame(participant)
    ) {
      return;
    }

    if (participant.isComplete !== true) {
      participant.isComplete = true;
    }
    if (normalizeParticipantCompletedAt(participant.completedAt) === null) {
      participant.completedAt = completionCursor;
      completionCursor += 1;
    }
  });

  const turnState = ensureSessionTurnState(session);
  if (turnState) {
    turnState.activeTurnPlayerId = null;
    turnState.order = turnState.order.filter((playerId) => {
      const participant = session.participants?.[playerId];
      return Boolean(participant) && !isParticipantQueuedForNextGame(participant);
    });
    turnState.phase = TURN_PHASES.awaitRoll;
    turnState.lastRollSnapshot = null;
    turnState.lastScoreSummary = null;
    turnState.turnExpiresAt = null;
    turnState.updatedAt = completedAt;
  }

  scheduleSessionPostGameLifecycle(session, completedAt);
  return {
    ok: true,
  };
}

function applyParticipantScoreUpdate(participant, scoreSummary, rollDiceCount) {
  const safeRollDiceCount =
    Number.isFinite(rollDiceCount) && rollDiceCount > 0 ? Math.floor(rollDiceCount) : 0;
  const currentScore = normalizeParticipantScore(participant?.score);
  const points = Number.isFinite(scoreSummary?.points) ? Math.max(0, Math.floor(scoreSummary.points)) : 0;
  const selectedDiceCount = Array.isArray(scoreSummary?.selectedDiceIds)
    ? scoreSummary.selectedDiceIds.length
    : 0;
  const currentRemainingDice = normalizeParticipantRemainingDice(
    participant?.remainingDice,
    safeRollDiceCount || DEFAULT_PARTICIPANT_DICE_COUNT
  );
  const remainingBase = safeRollDiceCount > 0 ? Math.max(currentRemainingDice, safeRollDiceCount) : currentRemainingDice;
  const nextRemainingDice = Math.max(0, remainingBase - selectedDiceCount);
  const didComplete = nextRemainingDice === 0;
  const completedAt = didComplete
    ? normalizeParticipantCompletedAt(participant?.completedAt) ?? Date.now()
    : null;
  const nextScore = currentScore + points;

  if (participant) {
    participant.score = nextScore;
    participant.remainingDice = nextRemainingDice;
    participant.isComplete = didComplete;
    participant.completedAt = completedAt;
  }

  return {
    nextScore,
    nextRemainingDice,
    didComplete,
    completedAt,
  };
}

function getHumanParticipantCount(session) {
  if (!session?.participants) {
    return 0;
  }
  return Object.values(session.participants).filter((participant) => participant && !isBotParticipant(participant))
    .length;
}

function getActiveHumanParticipants(session) {
  if (!session?.participants) {
    return [];
  }

  return Object.values(session.participants).filter(
    (participant) =>
      participant &&
      !isBotParticipant(participant) &&
      !isParticipantQueuedForNextGame(participant)
  );
}

function maybeForfeitSessionForSingleHumanRemaining(session, now = Date.now()) {
  if (!session?.participants) {
    return false;
  }

  const activeHumans = getActiveHumanParticipants(session);
  if (activeHumans.length !== 1) {
    return false;
  }
  if (hasQueuedParticipantsForNextGame(session)) {
    return resetSessionForNextGame(session, now);
  }

  const activeParticipants = Object.values(session.participants).filter(
    (participant) =>
      participant && !isParticipantQueuedForNextGame(participant)
  );
  if (activeParticipants.length === 0) {
    return false;
  }

  const completedAt =
    Number.isFinite(now) && now > 0 ? Math.floor(now) : Date.now();
  let changed = false;
  activeParticipants.forEach((participant) => {
    if (!participant || typeof participant !== "object") {
      return;
    }
    if (participant.isComplete !== true) {
      participant.isComplete = true;
      changed = true;
    }
    const existingCompletedAt = normalizeParticipantCompletedAt(participant.completedAt);
    if (existingCompletedAt === null) {
      participant.completedAt = completedAt;
      changed = true;
    }
  });

  if (!changed) {
    return false;
  }

  session.turnState = null;
  ensureSessionTurnState(session);
  return true;
}

function pruneInactiveSessionParticipants(sessionId, session, now = Date.now()) {
  if (!session || typeof session !== "object" || !session.participants) {
    return { changed: false, removedCount: 0 };
  }

  const stalePlayerIds = [];
  Object.entries(session.participants).forEach(([playerId, participant]) => {
    if (!participant || isBotParticipant(participant)) {
      return;
    }
    if (isSessionParticipantConnected(sessionId, playerId)) {
      return;
    }

    const lastHeartbeatAt =
      Number.isFinite(participant.lastHeartbeatAt) && participant.lastHeartbeatAt > 0
        ? Math.floor(participant.lastHeartbeatAt)
        : 0;
    if (lastHeartbeatAt > 0 && now - lastHeartbeatAt <= MULTIPLAYER_PARTICIPANT_STALE_MS) {
      return;
    }
    stalePlayerIds.push(playerId);
  });

  if (stalePlayerIds.length === 0) {
    return { changed: false, removedCount: 0 };
  }

  let removedCount = 0;
  stalePlayerIds.forEach((playerId) => {
    const removal = removeParticipantFromSession(sessionId, playerId, {
      source: "heartbeat_timeout",
      socketReason: "heartbeat_timeout",
    });
    if (removal.ok) {
      removedCount += 1;
    }
  });

  return {
    changed: removedCount > 0,
    removedCount,
  };
}

function areAllHumansReady(session) {
  if (!session?.participants) {
    return false;
  }

  const humans = getActiveHumanParticipants(session);
  const activeHumans = humans.filter((participant) => !isParticipantComplete(participant));
  if (activeHumans.length <= 1) {
    return true;
  }

  return activeHumans.every((participant) => participant.isReady === true);
}

function getBotParticipants(session) {
  if (!session?.participants) {
    return [];
  }
  return Object.values(session.participants).filter((participant) => participant && isBotParticipant(participant));
}

function hasConnectedHumanParticipant(sessionId, session) {
  if (!session?.participants) {
    return false;
  }
  return Object.values(session.participants).some(
    (participant) =>
      participant &&
      !isBotParticipant(participant) &&
      !isParticipantQueuedForNextGame(participant) &&
      isSessionParticipantConnected(sessionId, participant.playerId)
  );
}

function hasLiveHumanParticipant(sessionId, session, now = Date.now()) {
  if (!session?.participants) {
    return false;
  }
  return Object.values(session.participants).some(
    (participant) =>
      participant &&
      !isBotParticipant(participant) &&
      !isParticipantQueuedForNextGame(participant) &&
      isRoomParticipantActive(sessionId, participant, now)
  );
}

function buildUniqueSessionBotId(session) {
  const sessionPrefix =
    typeof session?.sessionId === "string" && session.sessionId.trim().length > 0
      ? session.sessionId.trim().slice(0, 6)
      : randomToken().slice(0, 6);

  let index = 1;
  while (index <= 2000) {
    const candidate = `bot-${sessionPrefix}-${index}`;
    if (!session.participants?.[candidate]) {
      return candidate;
    }
    index += 1;
  }

  return `bot-${sessionPrefix}-${randomToken().slice(0, 4)}`;
}

function addBotsToSession(session, requestedBotCount, now = Date.now()) {
  if (!session || typeof session !== "object") {
    return 0;
  }
  if (!session.participants || typeof session.participants !== "object") {
    session.participants = {};
  }

  const targetBotCount = Math.max(
    0,
    Math.min(MAX_MULTIPLAYER_BOTS, normalizeBotCount(requestedBotCount))
  );
  if (targetBotCount <= 0) {
    return 0;
  }

  const existingBots = getBotParticipants(session);
  const botsToAdd = Math.max(0, targetBotCount - existingBots.length);
  if (botsToAdd <= 0) {
    return 0;
  }

  const joinedAt = Number.isFinite(now) && now > 0 ? Math.floor(now) : Date.now();
  for (let index = 0; index < botsToAdd; index += 1) {
    const botId = buildUniqueSessionBotId(session);
    const botOffset = existingBots.length + index;
    session.participants[botId] = {
      playerId: botId,
      displayName: BOT_NAMES[botOffset % BOT_NAMES.length],
      avatarUrl: undefined,
      providerId: "bot",
      joinedAt,
      lastHeartbeatAt: joinedAt,
      isBot: true,
      botProfile: BOT_PROFILES[botOffset % BOT_PROFILES.length],
      isReady: true,
      score: 0,
      remainingDice: DEFAULT_PARTICIPANT_DICE_COUNT,
      queuedForNextGame: false,
      isComplete: false,
      completedAt: null,
    };
  }

  return botsToAdd;
}

function pruneSessionBots(sessionId, session, options = {}) {
  if (!session || typeof session !== "object" || !session.participants) {
    return {
      changed: false,
      removedCount: 0,
      removedCompletedCount: 0,
      removedNoLiveHumansCount: 0,
    };
  }

  const now =
    Number.isFinite(options?.now) && options.now > 0 ? Math.floor(options.now) : Date.now();
  const removeAll = options?.removeAll === true;
  const removeCompleted = options?.removeCompleted === true;
  const removeWithoutLiveHumans = options?.removeWithoutLiveHumans === true;
  const hasLiveHumans = removeWithoutLiveHumans
    ? hasLiveHumanParticipant(sessionId, session, now)
    : true;

  let changed = false;
  let removedCount = 0;
  let removedCompletedCount = 0;
  let removedNoLiveHumansCount = 0;

  Object.entries(session.participants).forEach(([playerId, participant]) => {
    if (!participant || !isBotParticipant(participant)) {
      return;
    }

    if (removeAll) {
      delete session.participants[playerId];
      changed = true;
      removedCount += 1;
      return;
    }

    if (removeWithoutLiveHumans && !hasLiveHumans) {
      delete session.participants[playerId];
      changed = true;
      removedCount += 1;
      removedNoLiveHumansCount += 1;
      return;
    }

    if (removeCompleted && isParticipantComplete(participant)) {
      delete session.participants[playerId];
      changed = true;
      removedCount += 1;
      removedCompletedCount += 1;
    }
  });

  return {
    changed,
    removedCount,
    removedCompletedCount,
    removedNoLiveHumansCount,
  };
}

function reconcileSessionLoops(sessionId) {
  reconcileBotLoop(sessionId);
  reconcileTurnTimeoutLoop(sessionId);
  reconcilePostGameLoop(sessionId);
}

function stopSessionLoops(sessionId) {
  stopBotLoop(sessionId);
  stopTurnTimeoutLoop(sessionId);
  stopPostGameLoop(sessionId);
}

function reconcileBotLoop(sessionId) {
  const session = store.multiplayerSessions[sessionId];
  if (!session) {
    stopBotLoop(sessionId);
    return;
  }

  const botPrune = pruneSessionBots(sessionId, session, {
    removeAll: isSessionCompleteForHumans(session),
    removeCompleted: true,
    removeWithoutLiveHumans: true,
    now: Date.now(),
  });
  if (botPrune.changed) {
    ensureSessionTurnState(session);
    persistStore().catch((error) => {
      log.warn("Failed to persist session after bot prune", error);
    });
  } else {
    ensureSessionTurnState(session);
  }

  if (getBotParticipants(session).length === 0) {
    stopBotLoop(sessionId);
    return;
  }

  if (botSessionLoops.has(sessionId)) {
    scheduleBotTurnIfNeeded(sessionId);
    return;
  }

  botSessionLoops.set(sessionId, {
    timer: null,
    turnTimer: null,
    scheduledTurnKey: "",
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

function executeBotTurn(session, activePlayerId) {
  const turnState = ensureSessionTurnState(session);
  if (!turnState || turnState.activeTurnPlayerId !== activePlayerId) {
    return null;
  }

  const participant = session.participants?.[activePlayerId];
  if (!isBotParticipant(participant)) {
    return null;
  }
  const gameDifficulty = resolveSessionGameDifficulty(session);
  participant.lastHeartbeatAt = Date.now();

  if (isParticipantComplete(participant)) {
    participant.isComplete = true;
    participant.completedAt =
      normalizeParticipantCompletedAt(participant.completedAt) ?? Date.now();
    const advanced = advanceSessionTurn(session, activePlayerId, {
      source: "bot_auto",
    });
    return advanced
      ? {
          rollAction: null,
          scoreAction: null,
          turnEnd: advanced.turnEnd,
          turnStart: advanced.turnStart,
        }
      : null;
  }

  if (normalizeTurnPhase(turnState.phase) !== TURN_PHASES.awaitRoll) {
    turnState.phase = TURN_PHASES.awaitRoll;
    turnState.lastRollSnapshot = null;
    turnState.lastScoreSummary = null;
    turnState.updatedAt = Date.now();
  }

  const remainingDice = normalizeParticipantRemainingDice(participant.remainingDice);
  const rollPayload = botEngine.buildTurnRollPayload({
    playerId: activePlayerId,
    turnNumber: turnState.turnNumber,
    remainingDice,
  });
  if (!rollPayload) {
    return null;
  }
  const parsedRoll = parseTurnRollPayload({ roll: rollPayload });
  if (!parsedRoll.ok) {
    return null;
  }

  turnState.lastRollSnapshot = parsedRoll.value;
  turnState.lastScoreSummary = null;
  turnState.phase = TURN_PHASES.awaitScore;
  turnState.updatedAt = Date.now();

  const rollAction = buildTurnActionMessage(
    session,
    activePlayerId,
    "roll",
    { roll: parsedRoll.value },
    { source: "bot_auto" }
  );

  const botScoreSummary = botEngine.buildTurnScoreSummary({
    rollSnapshot: parsedRoll.value,
    remainingDice,
    botProfile: participant.botProfile,
    gameDifficulty,
    turnNumber: turnState.turnNumber,
    sessionParticipants: session.participants,
    playerId: activePlayerId,
  });
  if (!botScoreSummary) {
    return null;
  }

  const scoreUpdate = applyParticipantScoreUpdate(
    participant,
    botScoreSummary,
    parsedRoll.value.dice.length
  );
  const finalizedScoreSummary = {
    ...botScoreSummary,
    projectedTotalScore: scoreUpdate.nextScore,
    remainingDice: scoreUpdate.nextRemainingDice,
    isComplete: scoreUpdate.didComplete,
    updatedAt: Date.now(),
  };
  turnState.lastScoreSummary = finalizedScoreSummary;
  turnState.phase = TURN_PHASES.readyToEnd;
  turnState.updatedAt = Date.now();

  const scoreAction = buildTurnActionMessage(
    session,
    activePlayerId,
    "score",
    { score: finalizedScoreSummary },
    { source: "bot_auto" }
  );

  const advanced = advanceSessionTurn(session, activePlayerId, {
    source: "bot_auto",
  });
  if (!advanced) {
    return null;
  }

  return {
    rollAction,
    scoreAction,
    turnEnd: advanced.turnEnd,
    turnStart: advanced.turnStart,
  };
}

function scheduleBotTurnIfNeeded(sessionId) {
  const loop = botSessionLoops.get(sessionId);
  const session = store.multiplayerSessions[sessionId];
  if (!loop || !session) {
    return;
  }

  const turnState = ensureSessionTurnState(session);
  const activePlayerId = turnState?.activeTurnPlayerId;
  const activeTurnNumber =
    Number.isFinite(turnState?.turnNumber) && turnState.turnNumber > 0
      ? Math.floor(turnState.turnNumber)
      : 0;
  const activeRoundNumber =
    Number.isFinite(turnState?.round) && turnState.round > 0 ? Math.floor(turnState.round) : 0;
  const activeTurnKey = activePlayerId
    ? `${activePlayerId}:${activeRoundNumber}:${activeTurnNumber}`
    : "";

  if (loop.turnTimer) {
    if (activeTurnKey && loop.scheduledTurnKey === activeTurnKey) {
      return;
    }
    clearTimeout(loop.turnTimer);
    loop.turnTimer = null;
    loop.scheduledTurnKey = "";
  }

  if (!activePlayerId) {
    loop.scheduledTurnKey = "";
    return;
  }

  const activeParticipant = session.participants[activePlayerId];
  if (!isBotParticipant(activeParticipant)) {
    loop.scheduledTurnKey = "";
    return;
  }

  const hasConnectedHuman = hasConnectedHumanParticipant(sessionId, session);
  if (!hasConnectedHuman) {
    loop.scheduledTurnKey = "";
    return;
  }

  const delayMs = botEngine.resolveTurnDelayMs({
    botProfile: activeParticipant.botProfile,
    gameDifficulty: resolveSessionGameDifficulty(session),
    remainingDice: activeParticipant.remainingDice,
    turnNumber: turnState.turnNumber,
    sessionParticipants: session.participants,
    playerId: activePlayerId,
  });
  loop.scheduledTurnKey = activeTurnKey;
  loop.turnTimer = setTimeout(() => {
    loop.turnTimer = null;
    loop.scheduledTurnKey = "";
    const latestSession = store.multiplayerSessions[sessionId];
    if (!latestSession) {
      return;
    }
    if (!hasConnectedHumanParticipant(sessionId, latestSession)) {
      const noLiveHumanPrune = pruneSessionBots(sessionId, latestSession, {
        removeWithoutLiveHumans: true,
        now: Date.now(),
      });
      if (noLiveHumanPrune.changed) {
        ensureSessionTurnState(latestSession);
        broadcastSessionState(latestSession, "bot_prune");
        persistStore().catch((error) => {
          log.warn("Failed to persist session after pruning idle bots", error);
        });
      }
      reconcileSessionLoops(sessionId);
      return;
    }

    const botTurn = executeBotTurn(latestSession, activePlayerId);
    if (!botTurn) {
      return;
    }
    turnAdvanceMetrics.botAutoAdvanceCount += 1;

    if (botTurn.rollAction) {
      broadcastToSession(sessionId, JSON.stringify(botTurn.rollAction), null);
    }
    if (botTurn.scoreAction) {
      broadcastToSession(sessionId, JSON.stringify(botTurn.scoreAction), null);
    }
    broadcastToSession(sessionId, JSON.stringify(botTurn.turnEnd), null);
    if (botTurn.turnStart) {
      broadcastToSession(sessionId, JSON.stringify(botTurn.turnStart), null);
    }
    const completedBotPrune = pruneSessionBots(sessionId, latestSession, {
      removeCompleted: true,
      now: Date.now(),
    });
    if (completedBotPrune.changed) {
      ensureSessionTurnState(latestSession);
    }
    markSessionActivity(latestSession, undefined, Date.now());
    broadcastSessionState(latestSession, "bot_auto");
    persistStore().catch((error) => {
      log.warn("Failed to persist session after bot turn advance", error);
    });
    reconcileSessionLoops(sessionId);
  }, delayMs);
}

function reconcileTurnTimeoutLoop(sessionId) {
  const session = store.multiplayerSessions[sessionId];
  if (!session) {
    stopTurnTimeoutLoop(sessionId);
    return;
  }

  const turnState = ensureSessionTurnState(session);
  if (!turnState?.activeTurnPlayerId || turnState.order.length <= 1) {
    stopTurnTimeoutLoop(sessionId);
    return;
  }

  const activeParticipant = session.participants[turnState.activeTurnPlayerId];
  if (!activeParticipant) {
    stopTurnTimeoutLoop(sessionId);
    return;
  }

  const hasConnectedHuman = hasConnectedHumanParticipant(sessionId, session);
  if (!hasConnectedHuman) {
    stopTurnTimeoutLoop(sessionId);
    return;
  }

  const timeoutMs = normalizeTurnTimeoutMs(turnState.turnTimeoutMs);
  turnState.turnTimeoutMs = timeoutMs;
  const now = Date.now();
  const turnKey = `${turnState.activeTurnPlayerId}:${turnState.round}:${turnState.turnNumber}`;
  const hasValidTurnExpiry =
    typeof turnState.turnExpiresAt === "number" &&
    Number.isFinite(turnState.turnExpiresAt) &&
    turnState.turnExpiresAt > 0;
  if (hasValidTurnExpiry && turnState.turnExpiresAt <= now) {
    // When reconciliation sees an already-expired turn, process timeout immediately
    // rather than extending the same turn window.
    setTimeout(() => {
      handleTurnTimeoutExpiry(sessionId, turnKey);
    }, 0);
    return;
  }
  if (!hasValidTurnExpiry) {
    turnState.turnExpiresAt = now + timeoutMs;
  }

  const turnExpiresAt = Math.floor(turnState.turnExpiresAt);
  let loop = sessionTurnTimeoutLoops.get(sessionId);
  if (!loop) {
    loop = {
      warningTimer: null,
      expiryTimer: null,
      turnKey: "",
      turnExpiresAt: 0,
    };
    sessionTurnTimeoutLoops.set(sessionId, loop);
  }

  if (loop.turnKey === turnKey && loop.turnExpiresAt === turnExpiresAt) {
    return;
  }

  if (loop.warningTimer) {
    clearTimeout(loop.warningTimer);
    loop.warningTimer = null;
  }
  if (loop.expiryTimer) {
    clearTimeout(loop.expiryTimer);
    loop.expiryTimer = null;
  }

  loop.turnKey = turnKey;
  loop.turnExpiresAt = turnExpiresAt;

  const warningAt = turnExpiresAt - TURN_TIMEOUT_WARNING_MS;
  if (warningAt > now) {
    loop.warningTimer = setTimeout(() => {
      loop.warningTimer = null;
      dispatchTurnTimeoutWarning(sessionId, turnKey);
    }, warningAt - now);
  }

  loop.expiryTimer = setTimeout(() => {
    loop.expiryTimer = null;
    handleTurnTimeoutExpiry(sessionId, turnKey);
  }, Math.max(0, turnExpiresAt - now));
}

function stopTurnTimeoutLoop(sessionId) {
  const loop = sessionTurnTimeoutLoops.get(sessionId);
  if (!loop) {
    return;
  }
  if (loop.warningTimer) {
    clearTimeout(loop.warningTimer);
  }
  if (loop.expiryTimer) {
    clearTimeout(loop.expiryTimer);
  }
  sessionTurnTimeoutLoops.delete(sessionId);
}

function clearPostGameCountdownTimers(loop) {
  if (!loop || !Array.isArray(loop.countdownTimers) || loop.countdownTimers.length === 0) {
    return;
  }
  loop.countdownTimers.forEach((timer) => {
    clearTimeout(timer);
  });
  loop.countdownTimers = [];
}

function stopPostGameLoop(sessionId) {
  const loop = sessionPostGameLoops.get(sessionId);
  if (!loop) {
    return;
  }
  if (loop.nextGameTimer) {
    clearTimeout(loop.nextGameTimer);
  }
  if (loop.idleTimer) {
    clearTimeout(loop.idleTimer);
  }
  clearPostGameCountdownTimers(loop);
  sessionPostGameLoops.delete(sessionId);
}

function dispatchPostGameCountdownNotice(sessionId, expectedNextGameStartsAt, secondsRemaining) {
  const session = store.multiplayerSessions[sessionId];
  if (!session || !areCurrentGameParticipantsComplete(session)) {
    return;
  }
  const nextGameStartsAt = normalizePostGameTimestamp(session.nextGameStartsAt);
  if (nextGameStartsAt === null || nextGameStartsAt !== expectedNextGameStartsAt) {
    return;
  }
  if (!Number.isFinite(secondsRemaining) || secondsRemaining <= 0) {
    return;
  }

  const safeSeconds = Math.floor(secondsRemaining);
  broadcastSystemRoomChannelMessage(sessionId, {
    topic: "next_game_countdown",
    title: "Next Game",
    message: `Next game starts in ${safeSeconds}s`,
    severity: safeSeconds <= 3 ? "warning" : "info",
  });
}

function schedulePostGameCountdownNotices(sessionId, nextGameStartsAt, now = Date.now()) {
  let loop = sessionPostGameLoops.get(sessionId);
  if (!loop) {
    loop = {
      nextGameTimer: null,
      nextGameStartsAt: 0,
      idleTimer: null,
      idleExpiresAt: 0,
      countdownTimers: [],
      countdownStartsAt: 0,
    };
    sessionPostGameLoops.set(sessionId, loop);
  }

  if (loop.countdownStartsAt === nextGameStartsAt && loop.countdownTimers.length > 0) {
    return;
  }
  clearPostGameCountdownTimers(loop);
  loop.countdownStartsAt = nextGameStartsAt;

  for (let secondsRemaining = NEXT_GAME_COUNTDOWN_SECONDS; secondsRemaining >= 1; secondsRemaining -= 1) {
    const dispatchAt = nextGameStartsAt - secondsRemaining * 1000;
    if (dispatchAt <= now) {
      continue;
    }
    const timer = setTimeout(() => {
      dispatchPostGameCountdownNotice(sessionId, nextGameStartsAt, secondsRemaining);
    }, dispatchAt - now);
    loop.countdownTimers.push(timer);
  }
}

function handlePostGameInactivityExpiry(sessionId, expectedIdleExpiresAt) {
  const session = store.multiplayerSessions[sessionId];
  if (!session || !areCurrentGameParticipantsComplete(session)) {
    reconcileSessionLoops(sessionId);
    return;
  }
  const idleExpiresAt = normalizePostGameTimestamp(session.postGameIdleExpiresAt);
  if (idleExpiresAt === null || idleExpiresAt !== expectedIdleExpiresAt) {
    reconcileSessionLoops(sessionId);
    return;
  }
  if (idleExpiresAt > Date.now()) {
    reconcileSessionLoops(sessionId);
    return;
  }

  expireSession(sessionId, "session_expired");
  persistStore().catch((error) => {
    log.warn("Failed to persist store after post-game inactivity expiry", error);
  });
}

function handlePostGameNextGameStart(sessionId, expectedNextGameStartsAt) {
  const session = store.multiplayerSessions[sessionId];
  if (!session || !areCurrentGameParticipantsComplete(session)) {
    reconcileSessionLoops(sessionId);
    return;
  }
  const nextGameStartsAt = normalizePostGameTimestamp(session.nextGameStartsAt);
  if (nextGameStartsAt === null || nextGameStartsAt !== expectedNextGameStartsAt) {
    reconcileSessionLoops(sessionId);
    return;
  }
  if (nextGameStartsAt > Date.now()) {
    reconcileSessionLoops(sessionId);
    return;
  }

  const restarted = resetSessionForNextGame(session, Date.now());
  if (!restarted) {
    reconcileSessionLoops(sessionId);
    return;
  }

  broadcastSystemRoomChannelMessage(sessionId, {
    topic: "next_game_start",
    title: "Next Game",
    message: "New round started.",
    severity: "success",
  });

  const nextTurnStart = buildTurnStartMessage(session, {
    source: "post_game_restart",
  });
  if (nextTurnStart) {
    broadcastToSession(sessionId, JSON.stringify(nextTurnStart), null);
  }
  broadcastSessionState(session, "post_game_restart");
  persistStore().catch((error) => {
    log.warn("Failed to persist store after post-game restart", error);
  });
  reconcileSessionLoops(sessionId);
}

function reconcilePostGameLoop(sessionId) {
  const session = store.multiplayerSessions[sessionId];
  if (!session) {
    stopPostGameLoop(sessionId);
    return;
  }
  if (!areCurrentGameParticipantsComplete(session)) {
    clearSessionPostGameLifecycleState(session);
    stopPostGameLoop(sessionId);
    return;
  }

  scheduleSessionPostGameLifecycle(session, Date.now());
  const nextGameStartsAt = normalizePostGameTimestamp(session.nextGameStartsAt);
  const postGameIdleExpiresAt = normalizePostGameTimestamp(session.postGameIdleExpiresAt);
  if (nextGameStartsAt === null || postGameIdleExpiresAt === null) {
    stopPostGameLoop(sessionId);
    return;
  }

  const now = Date.now();
  if (postGameIdleExpiresAt <= now) {
    handlePostGameInactivityExpiry(sessionId, postGameIdleExpiresAt);
    return;
  }
  if (nextGameStartsAt <= now) {
    handlePostGameNextGameStart(sessionId, nextGameStartsAt);
    return;
  }

  let loop = sessionPostGameLoops.get(sessionId);
  if (!loop) {
    loop = {
      nextGameTimer: null,
      nextGameStartsAt: 0,
      idleTimer: null,
      idleExpiresAt: 0,
      countdownTimers: [],
      countdownStartsAt: 0,
    };
    sessionPostGameLoops.set(sessionId, loop);
  }

  if (loop.nextGameTimer && loop.nextGameStartsAt !== nextGameStartsAt) {
    clearTimeout(loop.nextGameTimer);
    loop.nextGameTimer = null;
  }
  if (!loop.nextGameTimer) {
    loop.nextGameStartsAt = nextGameStartsAt;
    loop.nextGameTimer = setTimeout(() => {
      loop.nextGameTimer = null;
      handlePostGameNextGameStart(sessionId, nextGameStartsAt);
    }, Math.max(0, nextGameStartsAt - now));
  }

  if (loop.idleTimer && loop.idleExpiresAt !== postGameIdleExpiresAt) {
    clearTimeout(loop.idleTimer);
    loop.idleTimer = null;
  }
  if (!loop.idleTimer) {
    loop.idleExpiresAt = postGameIdleExpiresAt;
    loop.idleTimer = setTimeout(() => {
      loop.idleTimer = null;
      handlePostGameInactivityExpiry(sessionId, postGameIdleExpiresAt);
    }, Math.max(0, postGameIdleExpiresAt - now));
  }

  schedulePostGameCountdownNotices(sessionId, nextGameStartsAt, now);
}

function dispatchTurnTimeoutWarning(sessionId, expectedTurnKey) {
  const session = store.multiplayerSessions[sessionId];
  if (!session) {
    stopTurnTimeoutLoop(sessionId);
    return;
  }

  const turnState = ensureSessionTurnState(session);
  if (!turnState?.activeTurnPlayerId) {
    stopTurnTimeoutLoop(sessionId);
    return;
  }

  const turnKey = `${turnState.activeTurnPlayerId}:${turnState.round}:${turnState.turnNumber}`;
  if (turnKey !== expectedTurnKey) {
    reconcileTurnTimeoutLoop(sessionId);
    return;
  }

  const turnExpiresAt =
    typeof turnState.turnExpiresAt === "number" && Number.isFinite(turnState.turnExpiresAt)
      ? Math.floor(turnState.turnExpiresAt)
      : Date.now() + normalizeTurnTimeoutMs(turnState.turnTimeoutMs);
  const remainingMs = Math.max(0, turnExpiresAt - Date.now());
  if (remainingMs <= 0) {
    return;
  }

  broadcastToSession(
    sessionId,
    JSON.stringify({
      type: "turn_timeout_warning",
      sessionId,
      playerId: turnState.activeTurnPlayerId,
      round: turnState.round,
      turnNumber: turnState.turnNumber,
      turnExpiresAt,
      remainingMs,
      timeoutMs: normalizeTurnTimeoutMs(turnState.turnTimeoutMs),
      timestamp: Date.now(),
      source: "server",
    }),
    null
  );
}

function handleTurnTimeoutExpiry(sessionId, expectedTurnKey) {
  const session = store.multiplayerSessions[sessionId];
  if (!session) {
    stopTurnTimeoutLoop(sessionId);
    return;
  }

  const turnState = ensureSessionTurnState(session);
  if (!turnState?.activeTurnPlayerId) {
    stopTurnTimeoutLoop(sessionId);
    return;
  }

  const turnKey = `${turnState.activeTurnPlayerId}:${turnState.round}:${turnState.turnNumber}`;
  if (turnKey !== expectedTurnKey) {
    reconcileTurnTimeoutLoop(sessionId);
    return;
  }

  const hasConnectedHuman = hasConnectedHumanParticipant(sessionId, session);
  if (!hasConnectedHuman) {
    reconcileTurnTimeoutLoop(sessionId);
    return;
  }

  const expiresAt =
    typeof turnState.turnExpiresAt === "number" && Number.isFinite(turnState.turnExpiresAt)
      ? turnState.turnExpiresAt
      : 0;
  if (expiresAt > Date.now()) {
    reconcileTurnTimeoutLoop(sessionId);
    return;
  }

  const timedOutPlayerId = turnState.activeTurnPlayerId;
  const timedOutParticipant = session.participants?.[timedOutPlayerId];
  if (timedOutParticipant) {
    const timeoutSource = isBotParticipant(timedOutParticipant)
      ? "bot_timeout_forfeit"
      : "turn_timeout_forfeit";
    const removal = removeParticipantFromSession(sessionId, timedOutPlayerId, {
      source: timeoutSource,
      socketReason: timeoutSource,
    });
    if (removal.ok) {
      turnAdvanceMetrics.timeoutAutoAdvanceCount += 1;
      persistStore().catch((error) => {
        log.warn("Failed to persist session after timeout forfeit removal", error);
      });
      return;
    }
  }

  const timeoutMs = normalizeTurnTimeoutMs(turnState.turnTimeoutMs);
  const previousRound = turnState.round;
  const previousTurnNumber = turnState.turnNumber;
  const advanced = advanceSessionTurn(session, timedOutPlayerId, {
    source: "timeout_auto",
  });
  if (!advanced) {
    reconcileTurnTimeoutLoop(sessionId);
    return;
  }
  turnAdvanceMetrics.timeoutAutoAdvanceCount += 1;

  broadcastToSession(
    sessionId,
    JSON.stringify({
      type: "turn_auto_advanced",
      sessionId,
      playerId: timedOutPlayerId,
      round: previousRound,
      turnNumber: previousTurnNumber,
      timeoutMs,
      reason: "turn_timeout",
      timestamp: Date.now(),
      source: "timeout_auto",
    }),
    null
  );
  broadcastToSession(sessionId, JSON.stringify(advanced.turnEnd), null);
  if (advanced.turnStart) {
    broadcastToSession(sessionId, JSON.stringify(advanced.turnStart), null);
  }
  markSessionActivity(session, undefined, Date.now());
  broadcastSessionState(session, "timeout_auto");
  persistStore().catch((error) => {
    log.warn("Failed to persist session after timeout auto-advance", error);
  });
  reconcileSessionLoops(sessionId);
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
      playerId: actor.playerId,
      sourcePlayerId: actor.playerId,
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
      playerId: actor.playerId,
      sourcePlayerId: actor.playerId,
      targetPlayerId: target.playerId,
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

function parsePlayerScorePayload(body) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const scoreId = normalizeIdentifier(body.scoreId, `score-${randomUUID()}`);
  const score = Number(body.score);
  const duration = Number(body.duration ?? 0);
  const rollCount = Number(body.rollCount ?? 0);
  const timestamp = Number(body.timestamp);
  if (!Number.isFinite(score) || score < 0) {
    return null;
  }

  return {
    scoreId,
    score,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : Date.now(),
    seed: typeof body.seed === "string" ? body.seed.slice(0, 120) : undefined,
    duration: Number.isFinite(duration) && duration >= 0 ? duration : 0,
    rollCount: Number.isFinite(rollCount) && rollCount >= 0 ? Math.floor(rollCount) : 0,
    mode: sanitizeLeaderboardMode(body.mode),
  };
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

function normalizeAvatarUrl(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeProviderId(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const safe = normalized.replace(/[^a-z0-9._:-]/g, "").slice(0, 64);
  return safe || undefined;
}

function normalizeBlockedPlayerIds(value, ownerPlayerId = "") {
  if (!Array.isArray(value)) {
    return [];
  }

  const owner =
    typeof ownerPlayerId === "string" && ownerPlayerId.trim().length > 0
      ? ownerPlayerId.trim()
      : "";
  const normalized = [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const candidate = entry.trim();
    if (!candidate || candidate === owner || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    normalized.push(candidate);
    if (normalized.length >= 128) {
      break;
    }
  }
  return normalized;
}

function resolveParticipantBlockedPlayerIds(
  playerId,
  { candidateBlockedPlayerIds, fallbackBlockedPlayerIds } = {}
) {
  const fromCandidate = normalizeBlockedPlayerIds(candidateBlockedPlayerIds, playerId);
  if (fromCandidate.length > 0) {
    return fromCandidate;
  }
  if (Array.isArray(candidateBlockedPlayerIds)) {
    return [];
  }
  const fromFallback = normalizeBlockedPlayerIds(fallbackBlockedPlayerIds, playerId);
  if (fromFallback.length > 0) {
    return fromFallback;
  }
  const profile = store.players[playerId];
  return normalizeBlockedPlayerIds(profile?.blockedPlayerIds, playerId);
}

function getBlockedPlayerIdsForParticipant(session, playerId) {
  if (!session || typeof playerId !== "string" || playerId.trim().length === 0) {
    return [];
  }
  const participant = session.participants?.[playerId];
  if (participant && Array.isArray(participant.blockedPlayerIds)) {
    return normalizeBlockedPlayerIds(participant.blockedPlayerIds, playerId);
  }
  const profile = store.players[playerId];
  return normalizeBlockedPlayerIds(profile?.blockedPlayerIds, playerId);
}

function hasRoomChannelBlockRelationship(session, ownerPlayerId, targetPlayerId) {
  const owner =
    typeof ownerPlayerId === "string" && ownerPlayerId.trim().length > 0
      ? ownerPlayerId.trim()
      : "";
  const target =
    typeof targetPlayerId === "string" && targetPlayerId.trim().length > 0
      ? targetPlayerId.trim()
      : "";
  if (!owner || !target || owner === target) {
    return false;
  }
  const blocked = getBlockedPlayerIdsForParticipant(session, owner);
  return blocked.includes(target);
}

function isRoomChannelSenderRestricted(playerId) {
  if (typeof playerId !== "string" || playerId.trim().length === 0) {
    return false;
  }
  return ROOM_CHANNEL_BAD_PLAYER_IDS.has(playerId.trim());
}

function normalizeRoomChannelMessage(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, " ").slice(0, 320);
}

function normalizeRoomChannelTopic(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, "").slice(0, 32);
  return normalized || undefined;
}

function normalizeRoomChannelTitle(value, channel = "public") {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().replace(/\s+/g, " ").slice(0, 80);
  }
  return channel === "direct" ? "Direct" : "Room";
}

function broadcastSystemRoomChannelMessage(sessionId, options = {}) {
  const normalizedSessionId =
    typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId.trim() : "";
  if (!normalizedSessionId) {
    return;
  }
  const normalizedMessage = normalizeRoomChannelMessage(options.message);
  if (!normalizedMessage) {
    return;
  }
  const normalizedSeverity =
    options.severity === "success" ||
    options.severity === "warning" ||
    options.severity === "error"
      ? options.severity
      : "info";
  const normalizedTopic = normalizeRoomChannelTopic(options.topic);
  const payload = {
    type: "room_channel",
    id: randomUUID(),
    channel: "public",
    ...(normalizedTopic ? { topic: normalizedTopic } : {}),
    sourceRole: "system",
    title: normalizeRoomChannelTitle(options.title, "public"),
    message: normalizedMessage,
    severity: normalizedSeverity,
    timestamp:
      typeof options.timestamp === "number" && Number.isFinite(options.timestamp)
        ? Math.floor(options.timestamp)
        : Date.now(),
  };
  broadcastToSession(normalizedSessionId, JSON.stringify(payload), null);
}

function containsBlockedRoomChannelTerm(message) {
  if (ROOM_CHANNEL_BAD_TERMS.size === 0) {
    return false;
  }
  const normalized = normalizeRoomChannelMessage(message).toLowerCase();
  if (!normalized) {
    return false;
  }
  for (const term of ROOM_CHANNEL_BAD_TERMS) {
    if (term && normalized.includes(term)) {
      return true;
    }
  }
  return false;
}

function upsertFirebasePlayer(uid, patch) {
  if (!uid) return;
  const current = store.firebasePlayers[uid] ?? { uid };

  const next = {
    ...current,
    uid,
    updatedAt: Date.now(),
  };
  if (patch && typeof patch === "object") {
    Object.entries(patch).forEach(([key, value]) => {
      if (value !== undefined) {
        next[key] = value;
      }
    });
  }
  const normalizedPhotoUrl = normalizeAvatarUrl(next.photoUrl);
  if (normalizedPhotoUrl) {
    next.photoUrl = normalizedPhotoUrl;
  } else {
    delete next.photoUrl;
  }
  const normalizedProviderId = normalizeProviderId(next.providerId);
  if (normalizedProviderId) {
    next.providerId = normalizedProviderId;
  } else {
    delete next.providerId;
  }
  store.firebasePlayers[uid] = next;
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

function comparePlayerScoreEntries(left, right) {
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

  return String(left.scoreId ?? "").localeCompare(String(right.scoreId ?? ""));
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

function collectPlayerScoresByPlayerId(playerId) {
  return Object.values(store.playerScores)
    .filter((entry) => entry && entry.playerId === playerId && Number.isFinite(entry.score))
    .map((entry) => ({
      scoreId:
        typeof entry.scoreId === "string" && entry.scoreId
          ? entry.scoreId
          : normalizeIdentifier(entry.id, "score-unknown"),
      score: Number(entry.score ?? 0),
      timestamp: Number.isFinite(entry.timestamp) ? Math.floor(entry.timestamp) : Date.now(),
      seed: typeof entry.seed === "string" ? entry.seed : undefined,
      duration: Number.isFinite(entry.duration) ? Math.max(0, Number(entry.duration)) : 0,
      rollCount: Number.isFinite(entry.rollCount) ? Math.max(0, Math.floor(entry.rollCount)) : 0,
      mode: sanitizeLeaderboardMode(entry.mode),
    }));
}

function serializePlayerScoreEntry(entry) {
  return {
    scoreId: entry.scoreId,
    score: entry.score,
    timestamp: entry.timestamp,
    seed: entry.seed,
    duration: entry.duration,
    rollCount: entry.rollCount,
    mode: entry.mode,
  };
}

function buildPlayerScoreStats(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      totalGames: 0,
      bestScore: 0,
      averageScore: 0,
      totalPlayTime: 0,
    };
  }

  const totalGames = entries.length;
  const bestScore = Math.min(...entries.map((entry) => Number(entry.score ?? 0)));
  const totalPlayTime = entries.reduce(
    (sum, entry) => sum + Math.max(0, Number(entry.duration ?? 0)),
    0
  );
  const averageScore = Math.round(
    entries.reduce((sum, entry) => sum + Number(entry.score ?? 0), 0) / totalGames
  );

  return {
    totalGames,
    bestScore,
    averageScore,
    totalPlayTime,
  };
}

function trimPlayerScoresByPlayer(playerId, maxEntries) {
  const playerEntries = Object.values(store.playerScores)
    .filter((entry) => entry && entry.playerId === playerId)
    .sort(comparePlayerScoreEntries);
  if (playerEntries.length <= maxEntries) {
    return;
  }

  const keepKeys = new Set(
    playerEntries.slice(0, maxEntries).map((entry) => `${playerId}:${entry.scoreId}`)
  );
  Object.keys(store.playerScores).forEach((key) => {
    const entry = store.playerScores[key];
    if (!entry || entry.playerId !== playerId) {
      return;
    }
    if (!keepKeys.has(key)) {
      delete store.playerScores[key];
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
  let sessionsChanged = false;

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
    if (!session) {
      expireSession(sessionId, "session_expired");
      sessionsChanged = true;
      return;
    }

    const stalePrune = pruneInactiveSessionParticipants(sessionId, session, now);
    if (stalePrune.changed) {
      sessionsChanged = true;
    }

    const latestSession = store.multiplayerSessions[sessionId];
    if (!latestSession) {
      sessionsChanged = true;
      return;
    }

    const botPrune = pruneSessionBots(sessionId, latestSession, {
      removeAll: isSessionCompleteForHumans(latestSession),
      removeCompleted: true,
      removeWithoutLiveHumans: true,
      now,
    });
    if (botPrune.changed) {
      ensureSessionTurnState(latestSession);
      reconcileSessionLoops(sessionId);
      sessionsChanged = true;
    }

    const roomKind = getSessionRoomKind(latestSession);
    if (roomKind === ROOM_KINDS.publicDefault) {
      if (!Number.isFinite(latestSession.expiresAt) || latestSession.expiresAt <= now + 5000) {
        latestSession.expiresAt = now + MULTIPLAYER_SESSION_IDLE_TTL_MS;
        sessionsChanged = true;
      }
      return;
    }

    if (!Number.isFinite(latestSession.expiresAt) || latestSession.expiresAt <= now) {
      expireSession(sessionId, "session_expired");
      sessionsChanged = true;
    }
  });
  const roomInventoryChanged = reconcilePublicRoomInventory(now);
  if (roomInventoryChanged || sessionsChanged) {
    persistStore().catch((error) => {
      log.warn("Failed to persist store after cleanup reconciliation", error);
    });
  }
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

async function authenticateSocketUpgrade(requestUrl) {
  const sessionId = requestUrl.searchParams.get("session")?.trim() ?? "";
  const playerId = requestUrl.searchParams.get("playerId")?.trim() ?? "";
  const token = requestUrl.searchParams.get("token")?.trim() ?? "";

  if (!sessionId || !playerId || !token) {
    return { ok: false, status: 401, reason: "Unauthorized" };
  }

  let session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    await rehydrateStoreFromAdapter(`ws_upgrade_session:${sessionId}`, { force: true });
    session = store.multiplayerSessions[sessionId];
  }
  if (!session) {
    return { ok: false, status: 410, reason: "Gone" };
  }

  const now = Date.now();
  const sessionExpiresAt =
    typeof session.expiresAt === "number" && Number.isFinite(session.expiresAt)
      ? Math.floor(session.expiresAt)
      : 0;
  const sessionExpired = sessionExpiresAt <= now;
  const sessionExpiredBeyondGrace =
    sessionExpired &&
    (sessionExpiresAt <= 0 || now - sessionExpiresAt > WS_SESSION_UPGRADE_GRACE_MS);
  if (sessionExpiredBeyondGrace) {
    return { ok: false, status: 410, reason: "Gone" };
  }

  if (!session.participants[playerId]) {
    await rehydrateStoreFromAdapter(`ws_upgrade_participant:${sessionId}:${playerId}`, { force: true });
    session = store.multiplayerSessions[sessionId];
  }
  if (!session || !session.participants[playerId]) {
    return { ok: false, status: 403, reason: "Forbidden" };
  }

  let accessRecord = verifyAccessToken(token);
  if (!accessRecord) {
    await rehydrateStoreFromAdapter(`ws_upgrade_token:${sessionId}:${playerId}`, { force: true });
    accessRecord = verifyAccessToken(token);
  }
  if (!accessRecord) {
    return { ok: false, status: 401, reason: "Unauthorized" };
  }

  if (accessRecord.playerId !== playerId || accessRecord.sessionId !== sessionId) {
    return { ok: false, status: 403, reason: "Forbidden" };
  }

  if (sessionExpired) {
    const participant = session.participants[playerId];
    if (participant && !isBotParticipant(participant)) {
      participant.lastHeartbeatAt = now;
    }
    markSessionActivity(session, playerId, now, { countAsPlayerAction: false });
    persistStore().catch((error) => {
      log.warn("Failed to persist revived session during WebSocket upgrade", error);
    });
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
    const participant = session.participants[client.playerId];
    const now = Date.now();
    let readinessChanged = false;
    if (participant && !isBotParticipant(participant) && participant.isReady !== true) {
      participant.isReady = true;
      participant.lastHeartbeatAt = now;
      ensureSessionTurnState(session);
      readinessChanged = true;
    }
    markSessionActivity(session, client.playerId, now);

    if (readinessChanged) {
      broadcastSessionState(session, "ready", client);
      const turnStart = buildTurnStartMessage(session, { source: "ready" });
      if (turnStart) {
        broadcastToSession(client.sessionId, JSON.stringify(turnStart), client);
      }
      persistStore().catch((error) => {
        log.warn("Failed to persist session after readiness update", error);
      });
    }

    sendTurnSyncPayload(client, session, "sync");
    reconcileSessionLoops(client.sessionId);
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

  const now = Date.now();
  session.participants[client.playerId].lastHeartbeatAt = now;
  markSessionActivity(session, client.playerId, now);

  if (
    payload.type === "game_update" ||
    payload.type === "player_notification" ||
    payload.type === "room_channel"
  ) {
    relayRealtimeSocketMessage(client, session, payload, now);
    reconcileSessionLoops(client.sessionId);
    return;
  }

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
  if (messageType === "room_channel") {
    return (
      (payload.channel === "public" || payload.channel === "direct") &&
      typeof payload.message === "string" &&
      payload.message.trim().length > 0
    );
  }
  if (messageType === "turn_end") {
    return true;
  }
  if (messageType === "turn_action") {
    return payload.action === "roll" || payload.action === "score" || payload.action === "select";
  }
  return false;
}

function relayRealtimeSocketMessage(client, session, payload, now = Date.now()) {
  const targetPlayerId =
    typeof payload.targetPlayerId === "string" ? payload.targetPlayerId.trim() : "";
  const hasTargetPlayer = targetPlayerId.length > 0;
  if (hasTargetPlayer && !session?.participants?.[targetPlayerId]) {
    sendSocketError(client, "invalid_target_player", "target_player_not_in_session");
    return;
  }
  if (payload.type === "room_channel") {
    if (isRoomChannelSenderRestricted(client.playerId)) {
      sendSocketError(client, "room_channel_sender_restricted", "room_channel_sender_restricted");
      return;
    }
    const normalizedMessage = normalizeRoomChannelMessage(payload.message);
    if (!normalizedMessage) {
      sendSocketError(client, "room_channel_invalid_message", "room_channel_invalid_message");
      return;
    }
    if (containsBlockedRoomChannelTerm(normalizedMessage)) {
      sendSocketError(client, "room_channel_message_blocked", "room_channel_message_blocked");
      return;
    }
  }

  const base = {
    ...payload,
    playerId: client.playerId,
    sourcePlayerId: client.playerId,
    timestamp:
      typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
        ? payload.timestamp
        : now,
  };

  const normalizedChannel =
    payload.type === "room_channel"
      ? payload.channel === "direct"
        ? "direct"
        : "public"
      : hasTargetPlayer
        ? "direct"
        : "public";

  if (payload.type === "room_channel") {
    base.channel = normalizedChannel;
    const normalizedTopic = normalizeRoomChannelTopic(payload.topic);
    if (normalizedTopic) {
      base.topic = normalizedTopic;
    } else {
      delete base.topic;
    }
    base.title = normalizeRoomChannelTitle(payload.title, normalizedChannel);
    base.message = normalizeRoomChannelMessage(payload.message);
    base.sourceRole = "player";
  }

  if (normalizedChannel === "direct") {
    const directTargetPlayerId = hasTargetPlayer ? targetPlayerId : "";
    if (!directTargetPlayerId) {
      sendSocketError(client, "invalid_target_player", "target_player_required_for_direct");
      return;
    }
    if (
      hasRoomChannelBlockRelationship(session, client.playerId, directTargetPlayerId) ||
      hasRoomChannelBlockRelationship(session, directTargetPlayerId, client.playerId)
    ) {
      sendSocketError(client, "room_channel_blocked", "room_channel_blocked");
      return;
    }
    base.targetPlayerId = directTargetPlayerId;
    sendToSessionPlayer(
      client.sessionId,
      directTargetPlayerId,
      JSON.stringify(base),
      client
    );
    return;
  }

  delete base.targetPlayerId;
  if (payload.type === "room_channel") {
    broadcastRoomChannelToSession(session, base, client);
    return;
  }
  broadcastToSession(client.sessionId, JSON.stringify(base), client);
}

function handleTurnActionMessage(client, session, payload) {
  const timestamp = Date.now();
  session.participants[client.playerId].lastHeartbeatAt = timestamp;
  markSessionActivity(session, client.playerId, timestamp);
  const turnState = ensureSessionTurnState(session);
  if (!turnState?.activeTurnPlayerId) {
    sendSocketError(client, "turn_unavailable", "turn_unavailable");
    return;
  }

  if (turnState.activeTurnPlayerId !== client.playerId) {
    sendSocketError(client, "turn_not_active", "not_your_turn");
    sendTurnSyncPayload(client, session, "sync");
    return;
  }

  const action =
    payload.action === "score"
      ? "score"
      : payload.action === "select"
        ? "select"
        : "roll";
  const currentPhase = normalizeTurnPhase(turnState.phase);
  if (action === "roll" && currentPhase !== TURN_PHASES.awaitRoll) {
    sendSocketError(client, "turn_action_invalid_phase", "roll_not_expected");
    sendTurnSyncPayload(client, session, "sync");
    return;
  }
  if (
    (action === "score" || action === "select") &&
    currentPhase !== TURN_PHASES.awaitScore
  ) {
    sendSocketError(
      client,
      "turn_action_invalid_phase",
      action === "select" ? "select_not_expected" : "score_not_expected"
    );
    sendTurnSyncPayload(client, session, "sync");
    return;
  }

  let details = {};
  let scoreDidComplete = false;
  if (action === "roll") {
    const parsedRoll = parseTurnRollPayload(payload);
    if (!parsedRoll.ok) {
      sendSocketError(client, "turn_action_invalid_payload", parsedRoll.reason);
      sendTurnSyncPayload(client, session, "sync");
      return;
    }

    turnState.lastRollSnapshot = parsedRoll.value;
    turnState.lastScoreSummary = null;
    turnState.phase = TURN_PHASES.awaitScore;
    details = { roll: parsedRoll.value };
  } else if (action === "select") {
    const parsedSelection = parseTurnSelectionPayload(payload, turnState.lastRollSnapshot);
    if (!parsedSelection.ok) {
      sendSocketError(client, "turn_action_invalid_payload", parsedSelection.reason);
      sendTurnSyncPayload(client, session, "sync");
      return;
    }

    details = { select: parsedSelection.value };
  } else {
    const parsedScore = parseTurnScorePayload(payload, turnState.lastRollSnapshot);
    if (!parsedScore.ok) {
      const code =
        parsedScore.reason === "score_points_mismatch" ||
        parsedScore.reason === "score_roll_mismatch"
          ? "turn_action_invalid_score"
          : "turn_action_invalid_payload";
      sendSocketError(client, code, parsedScore.reason);
      sendTurnSyncPayload(client, session, "sync");
      return;
    }

    const participant = session.participants[client.playerId];
    const rollDiceCount = Array.isArray(turnState.lastRollSnapshot?.dice)
      ? turnState.lastRollSnapshot.dice.length
      : 0;
    const scoreUpdate = applyParticipantScoreUpdate(
      participant,
      parsedScore.value,
      rollDiceCount
    );

    turnState.lastScoreSummary = {
      ...parsedScore.value,
      projectedTotalScore: scoreUpdate.nextScore,
      remainingDice: scoreUpdate.nextRemainingDice,
      isComplete: scoreUpdate.didComplete,
    };
    turnState.phase = TURN_PHASES.readyToEnd;
    scoreDidComplete = scoreUpdate.didComplete;
    details = { score: turnState.lastScoreSummary };
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

  if (action === "score" && scoreDidComplete) {
    const completedRound = completeSessionRoundWithWinner(session, client.playerId, timestamp);
    if (completedRound.ok) {
      const winnerParticipant = session.participants?.[client.playerId];
      const winnerName =
        typeof winnerParticipant?.displayName === "string" &&
        winnerParticipant.displayName.trim().length > 0
          ? winnerParticipant.displayName.trim()
          : client.playerId;
      const winnerScore = normalizeParticipantScore(winnerParticipant?.score);
      broadcastToSession(
        client.sessionId,
        JSON.stringify({
          type: "player_notification",
          playerId: client.playerId,
          sourcePlayerId: client.playerId,
          title: "Round Winner",
          message: `${winnerName} wins the round`,
          severity: "success",
          timestamp,
          source: "winner_complete",
        }),
        null
      );
      broadcastSystemRoomChannelMessage(client.sessionId, {
        topic: "round_result",
        title: "Round Winner",
        message: `${winnerName} wins with ${winnerScore} point${winnerScore === 1 ? "" : "s"}.`,
        severity: "success",
        timestamp,
      });
      const nextGameStartsAt = resolveSessionNextGameStartsAt(session, timestamp);
      const nextGameSecondsRemaining = Math.max(
        1,
        Math.ceil((nextGameStartsAt - timestamp) / 1000)
      );
      broadcastSystemRoomChannelMessage(client.sessionId, {
        topic: "next_game_pending",
        title: "Next Game",
        message: `Next game starts in ${nextGameSecondsRemaining}s.`,
        severity: nextGameSecondsRemaining <= 3 ? "warning" : "info",
        timestamp,
      });

      const winnerTurnEnd = buildTurnEndMessage(session, client.playerId, {
        source: "winner_complete",
      });
      if (winnerTurnEnd) {
        broadcastToSession(client.sessionId, JSON.stringify(winnerTurnEnd), null);
      }
    }
  }

  if (action === "select") {
    reconcileSessionLoops(client.sessionId);
    return;
  }

  broadcastSessionState(session, `turn_${action}`);
  persistStore().catch((error) => {
    log.warn("Failed to persist session after turn action", error);
  });
  reconcileSessionLoops(client.sessionId);
}

function handleTurnEndMessage(client, session) {
  const timestamp = Date.now();
  session.participants[client.playerId].lastHeartbeatAt = timestamp;
  markSessionActivity(session, client.playerId, timestamp);
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
    sendTurnSyncPayload(client, session, "sync");
    return;
  }

  if (normalizeTurnPhase(turnState.phase) !== TURN_PHASES.readyToEnd) {
    sendSocketError(client, "turn_action_required", "score_required_before_turn_end");
    sendTurnSyncPayload(client, session, "sync");
    return;
  }

  const advanced = advanceSessionTurn(session, client.playerId, { source: "player" });
  if (!advanced) {
    sendSocketError(client, "turn_advance_failed", "turn_advance_failed");
    return;
  }
  log.info(
    `Turn advanced: session=${client.sessionId} endedBy=${advanced.turnEnd.playerId} next=${advanced.turnStart?.playerId ?? "none"} round=${advanced.turnStart?.round ?? turnState.round} turn=${advanced.turnStart?.turnNumber ?? turnState.turnNumber}`
  );

  broadcastToSession(client.sessionId, JSON.stringify(advanced.turnEnd), null);
  if (advanced.turnStart) {
    broadcastToSession(client.sessionId, JSON.stringify(advanced.turnStart), null);
  }
  broadcastSessionState(session, "turn_end");
  persistStore().catch((error) => {
    log.warn("Failed to persist session after turn advance", error);
  });
  reconcileSessionLoops(client.sessionId);
}

function broadcastSessionState(session, source = "server", sender = null) {
  const message = buildSessionStateMessage(session, { source });
  if (!message) {
    return;
  }

  broadcastToSession(session.sessionId, JSON.stringify(message), sender);
}

function sendTurnSyncPayload(client, session, source = "sync") {
  const sessionState = buildSessionStateMessage(session, { source });
  if (sessionState) {
    sendSocketPayload(client, sessionState);
  }

  const turnStart = buildTurnStartMessage(session, { source });
  if (turnStart) {
    sendSocketPayload(client, turnStart);
  }
}

function registerSocketClient(client, sessionId) {
  const clients = wsSessionClients.get(sessionId) ?? new Set();
  clients.add(client);
  wsSessionClients.set(sessionId, clients);
  client.registered = true;
  reconcileTurnTimeoutLoop(sessionId);
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
  if (clients) {
    clients.delete(client);
    if (clients.size === 0) {
      wsSessionClients.delete(client.sessionId);
    }
  }

  const session = store.multiplayerSessions[client.sessionId];
  const participant = session?.participants?.[client.playerId];
  if (participant && !isBotParticipant(participant)) {
    // Keep readiness state during short disconnects so browser refresh reconnects do not
    // deadlock turn sync. Stale participants are removed by heartbeat pruning + cleanup sweeps.
    participant.lastHeartbeatAt =
      Number.isFinite(participant.lastHeartbeatAt) && participant.lastHeartbeatAt > 0
        ? participant.lastHeartbeatAt
        : Date.now();
  }

  reconcileSessionLoops(client.sessionId);
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
  stopSessionLoops(sessionId);
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

function sendToSessionPlayer(sessionId, playerId, rawMessage, sender = null) {
  const targetPlayerId = typeof playerId === "string" ? playerId.trim() : "";
  if (!targetPlayerId) {
    return;
  }

  const clients = wsSessionClients.get(sessionId);
  if (!clients || clients.size === 0) {
    return;
  }

  for (const client of clients) {
    if (client === sender || client.closed || client.socket.destroyed) {
      continue;
    }
    if (client.playerId !== targetPlayerId) {
      continue;
    }

    try {
      writeSocketFrame(client.socket, 0x1, Buffer.from(rawMessage, "utf8"));
    } catch (error) {
      log.warn("Failed to send WebSocket direct message", error);
      safeCloseSocket(client, WS_CLOSE_CODES.internalError, "send_failed");
    }
  }
}

function broadcastRoomChannelToSession(session, payload, sender = null) {
  const sessionId = typeof session?.sessionId === "string" ? session.sessionId.trim() : "";
  if (!sessionId) {
    return;
  }
  const sourcePlayerId =
    typeof payload?.sourcePlayerId === "string" ? payload.sourcePlayerId.trim() : "";
  if (!sourcePlayerId) {
    return;
  }

  const clients = wsSessionClients.get(sessionId);
  if (!clients || clients.size === 0) {
    return;
  }

  const rawMessage = JSON.stringify(payload);
  for (const client of clients) {
    if (client === sender || client.closed || client.socket.destroyed) {
      continue;
    }
    const recipientPlayerId = typeof client.playerId === "string" ? client.playerId.trim() : "";
    if (!recipientPlayerId || recipientPlayerId === sourcePlayerId) {
      continue;
    }
    if (
      hasRoomChannelBlockRelationship(session, recipientPlayerId, sourcePlayerId) ||
      hasRoomChannelBlockRelationship(session, sourcePlayerId, recipientPlayerId)
    ) {
      continue;
    }

    try {
      writeSocketFrame(client.socket, 0x1, Buffer.from(rawMessage, "utf8"));
    } catch (error) {
      log.warn("Failed to broadcast room channel WebSocket message", error);
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

async function handleImageProxy(_req, res, url) {
  const target = normalizeImageProxyUrl(url.searchParams.get("url"));
  if (!target) {
    sendJson(res, 400, {
      error: "A valid public image URL is required in the `url` query parameter.",
    });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_PROXY_TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "image/*,*/*;q=0.8",
      },
    });

    if (!upstream.ok) {
      sendJson(res, 502, {
        error: "Failed to fetch upstream image.",
        status: upstream.status,
      });
      return;
    }

    const finalUrl = normalizeImageProxyUrl(upstream.url);
    if (!finalUrl) {
      sendJson(res, 502, {
        error: "Upstream redirect target is not allowed.",
      });
      return;
    }

    const contentType = String(upstream.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      sendJson(res, 415, {
        error: "Upstream resource is not an image.",
      });
      return;
    }

    const contentLengthHeader = upstream.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : NaN;
    if (Number.isFinite(contentLength) && contentLength > IMAGE_PROXY_MAX_BYTES) {
      sendJson(res, 413, {
        error: "Upstream image exceeds maximum allowed size.",
      });
      return;
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length <= 0) {
      sendJson(res, 502, {
        error: "Upstream image response was empty.",
      });
      return;
    }
    if (body.length > IMAGE_PROXY_MAX_BYTES) {
      sendJson(res, 413, {
        error: "Upstream image exceeds maximum allowed size.",
      });
      return;
    }

    const headers = {
      "content-type": contentType,
      "content-length": String(body.length),
      "cache-control":
        normalizeHeaderValue(upstream.headers.get("cache-control")) ?? "public, max-age=3600",
    };
    const etag = normalizeHeaderValue(upstream.headers.get("etag"));
    if (etag) {
      headers.etag = etag;
    }
    const lastModified = normalizeHeaderValue(upstream.headers.get("last-modified"));
    if (lastModified) {
      headers["last-modified"] = lastModified;
    }

    res.writeHead(200, headers);
    res.end(body);
  } catch (error) {
    const aborted =
      typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
    sendJson(res, aborted ? 504 : 502, {
      error: aborted ? "Image fetch timed out." : "Image proxy request failed.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeHeaderValue(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeImageProxyUrl(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) {
    return undefined;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return undefined;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || isBlockedProxyHostname(hostname)) {
    return undefined;
  }

  return parsed.toString();
}

function isBlockedProxyHostname(hostname) {
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "::" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    return true;
  }

  const version = isIP(hostname);
  if (version === 4) {
    return isPrivateOrReservedIpv4(hostname);
  }
  if (version === 6) {
    return isPrivateOrReservedIpv6(hostname);
  }

  return false;
}

function isPrivateOrReservedIpv4(hostname) {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;

  if (a === 0 || a === 10 || a === 127 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;

  return false;
}

function isPrivateOrReservedIpv6(hostname) {
  const normalized = hostname.toLowerCase();
  if (normalized === "::1" || normalized === "::") {
    return true;
  }
  if (normalized.startsWith("fe80:")) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const embeddedIpv4 = normalized.slice("::ffff:".length);
    if (isIP(embeddedIpv4) === 4) {
      return isPrivateOrReservedIpv4(embeddedIpv4);
    }
  }
  return false;
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
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-admin-token");
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

async function rehydrateStoreFromAdapter(reason, options = {}) {
  if (!storeAdapter || typeof storeAdapter.load !== "function") {
    return false;
  }

  if (storeRehydratePromise) {
    return storeRehydratePromise;
  }

  const now = Date.now();
  if (
    options.force !== true &&
    lastStoreRehydrateAt > 0 &&
    now - lastStoreRehydrateAt < STORE_REHYDRATE_COOLDOWN_MS
  ) {
    return false;
  }

  storeRehydratePromise = (async () => {
    try {
      const loaded = await storeAdapter.load();
      if (!loaded || typeof loaded !== "object") {
        return false;
      }
      store = loaded;
      lastStoreRehydrateAt = Date.now();
      log.debug(`Store rehydrated from adapter (${reason})`);
      return true;
    } catch (error) {
      log.warn(`Failed to rehydrate store (${reason})`, error);
      return false;
    }
  })();

  try {
    return await storeRehydratePromise;
  } finally {
    storeRehydratePromise = null;
  }
}

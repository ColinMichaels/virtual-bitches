import { createServer } from "node:http";
import { randomBytes, randomInt, randomUUID, createHash } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.mjs";
import { createStoreAdapter, DEFAULT_STORE } from "./storage/index.mjs";
import { cloneStore } from "./storage/defaultStore.mjs";
import { createBotEngine } from "./bot/engine.mjs";
import { createSessionTurnEngine } from "./engine/sessionTurnEngine.mjs";
import { createSessionLifecycleEngine } from "./engine/sessionLifecycleEngine.mjs";
import { createBotTurnEngine } from "./engine/botTurnEngine.mjs";
import { createTurnTimeoutEngine } from "./engine/turnTimeoutEngine.mjs";
import { createTurnActionEngine } from "./engine/turnActionEngine.mjs";
import { createAddonFilterRegistry } from "./filters/addonRegistry.mjs";
import {
  createRoomChannelChatConductFilter,
  ROOM_CHANNEL_FILTER_SCOPE_INBOUND,
} from "./filters/roomChannelChatConductFilter.mjs";
import {
  createRoomChannelSenderRestrictionFilter,
  ROOM_CHANNEL_FILTER_SCOPE_PREFLIGHT,
} from "./filters/roomChannelSenderRestrictionFilter.mjs";
import {
  createDirectMessageBlockRelationshipFilter,
  REALTIME_FILTER_SCOPE_DIRECT_DELIVERY,
} from "./filters/directMessageBlockRelationshipFilter.mjs";
import { dispatchApiRoute } from "./http/routeDispatcher.mjs";
import { createApiRouteHandlers } from "./http/routeHandlers.mjs";
import {
  completeSocketHandshake,
  DEFAULT_MAX_WS_MESSAGE_BYTES,
  parseSocketFrame,
  validateSocketUpgradeHeaders,
  writeSocketFrame,
} from "./ws/socketProtocol.mjs";
import { createSocketLifecycle } from "./ws/socketLifecycle.mjs";
import { isSupportedSocketPayload } from "./ws/socketPayloadValidation.mjs";
import { createSocketRelay } from "./ws/socketRelay.mjs";
import { createSocketUpgradeAuthenticator } from "./ws/socketUpgradeAuth.mjs";
import {
  buildChatConductWarning,
  createChatConductPolicy,
  createEmptyChatConductState,
  evaluateRoomChannelConduct,
  normalizeChatConductState,
} from "./moderation/chatConduct.mjs";
import { createChatModerationTermService } from "./moderation/termService.mjs";

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
const CHAT_CONDUCT_SEED_TERMS = resolveChatConductTerms(
  process.env.MULTIPLAYER_CHAT_BANNED_TERMS,
  ROOM_CHANNEL_BAD_TERMS
);
const CHAT_CONDUCT_TERM_SERVICE_URL =
  typeof process.env.MULTIPLAYER_CHAT_TERMS_SERVICE_URL === "string"
    ? process.env.MULTIPLAYER_CHAT_TERMS_SERVICE_URL.trim()
    : "";
const CHAT_CONDUCT_TERM_SERVICE_REFRESH_MS = normalizeChatTermsRefreshValue(
  process.env.MULTIPLAYER_CHAT_TERMS_REFRESH_MS,
  CHAT_CONDUCT_TERM_SERVICE_URL ? 60 * 1000 : 0
);
const CHAT_CONDUCT_TERM_SYNC_ON_BOOT = process.env.MULTIPLAYER_CHAT_TERMS_SYNC_ON_BOOT !== "0";
const CHAT_CONDUCT_TERM_SERVICE = createChatModerationTermService({
  seedTerms: CHAT_CONDUCT_SEED_TERMS,
  remoteUrl: CHAT_CONDUCT_TERM_SERVICE_URL,
  remoteApiKey: process.env.MULTIPLAYER_CHAT_TERMS_SERVICE_API_KEY,
  remoteApiKeyHeader: process.env.MULTIPLAYER_CHAT_TERMS_SERVICE_API_KEY_HEADER,
  requestTimeoutMs: process.env.MULTIPLAYER_CHAT_TERMS_FETCH_TIMEOUT_MS,
  maxManagedTerms: process.env.MULTIPLAYER_CHAT_TERMS_MAX_MANAGED,
  maxRemoteTerms: process.env.MULTIPLAYER_CHAT_TERMS_MAX_REMOTE,
});
const CHAT_CONDUCT_BASE_POLICY = createChatConductPolicy({
  enabled: process.env.MULTIPLAYER_CHAT_CONDUCT_ENABLED !== "0",
  publicOnly: process.env.MULTIPLAYER_CHAT_CONDUCT_PUBLIC_ONLY !== "0",
  bannedTerms: CHAT_CONDUCT_SEED_TERMS,
  strikeLimit: process.env.MULTIPLAYER_CHAT_STRIKE_LIMIT,
  strikeWindowMs: process.env.MULTIPLAYER_CHAT_STRIKE_WINDOW_MS,
  muteDurationMs: process.env.MULTIPLAYER_CHAT_MUTE_MS,
  autoBanStrikeLimit: process.env.MULTIPLAYER_CHAT_AUTO_ROOM_BAN_STRIKE_LIMIT,
});
const CHAT_CONDUCT_FILTER_ENABLED =
  process.env.MULTIPLAYER_CHAT_CONDUCT_FILTER_ENABLED === "0"
    ? false
    : CHAT_CONDUCT_BASE_POLICY.enabled;
const CHAT_CONDUCT_FILTER_TIMEOUT_MS = normalizeAddonFilterTimeoutMs(
  process.env.MULTIPLAYER_CHAT_CONDUCT_FILTER_TIMEOUT_MS,
  250
);
const CHAT_CONDUCT_FILTER_ON_ERROR = normalizeAddonFilterOnErrorMode(
  process.env.MULTIPLAYER_CHAT_CONDUCT_FILTER_ON_ERROR,
  "noop"
);
const ROOM_CHANNEL_SENDER_FILTER_ENABLED =
  process.env.MULTIPLAYER_ROOM_CHANNEL_SENDER_FILTER_ENABLED !== "0";
const ROOM_CHANNEL_SENDER_FILTER_TIMEOUT_MS = normalizeAddonFilterTimeoutMs(
  process.env.MULTIPLAYER_ROOM_CHANNEL_SENDER_FILTER_TIMEOUT_MS,
  100
);
const ROOM_CHANNEL_SENDER_FILTER_ON_ERROR = normalizeAddonFilterOnErrorMode(
  process.env.MULTIPLAYER_ROOM_CHANNEL_SENDER_FILTER_ON_ERROR,
  "noop"
);
const DIRECT_MESSAGE_BLOCK_FILTER_ENABLED =
  process.env.MULTIPLAYER_DIRECT_MESSAGE_BLOCK_FILTER_ENABLED !== "0";
const DIRECT_MESSAGE_BLOCK_FILTER_TIMEOUT_MS = normalizeAddonFilterTimeoutMs(
  process.env.MULTIPLAYER_DIRECT_MESSAGE_BLOCK_FILTER_TIMEOUT_MS,
  100
);
const DIRECT_MESSAGE_BLOCK_FILTER_ON_ERROR = normalizeAddonFilterOnErrorMode(
  process.env.MULTIPLAYER_DIRECT_MESSAGE_BLOCK_FILTER_ON_ERROR,
  "noop"
);
const MODERATION_STORE_CHAT_TERMS_KEY = "chatTerms";
const log = logger.create("Server");
const SHORT_SESSION_TTL_REQUESTED = process.env.ALLOW_SHORT_SESSION_TTLS === "1";
const ALLOW_SHORT_SESSION_TTLS = SHORT_SESSION_TTL_REQUESTED && NODE_ENV !== "production";
const SESSION_IDLE_TTL_MIN_MS = ALLOW_SHORT_SESSION_TTLS
  ? 2000
  : NODE_ENV === "production"
    ? 5 * 60 * 1000
    : 60 * 1000;

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
const ADMIN_CONDUCT_LIST_LIMIT_MAX = 500;
const ADMIN_CONDUCT_LIST_LIMIT_DEFAULT = 120;
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
const MAX_WS_MESSAGE_BYTES = DEFAULT_MAX_WS_MESSAGE_BYTES;
const IMAGE_PROXY_MAX_BYTES = 6 * 1024 * 1024;
const IMAGE_PROXY_TIMEOUT_MS = 7000;
const MAX_MULTIPLAYER_BOTS = 4;
const MULTIPLAYER_ALLOW_FAST_PROFILE_IN_PRODUCTION =
  process.env.MULTIPLAYER_ALLOW_FAST_PROFILE_IN_PRODUCTION === "1";
const MULTIPLAYER_SPEED_PROFILE_REQUESTED = normalizeMultiplayerSpeedProfileValue(
  process.env.MULTIPLAYER_SPEED_PROFILE
);
const MULTIPLAYER_SPEED_PROFILE =
  NODE_ENV === "production" &&
  MULTIPLAYER_SPEED_PROFILE_REQUESTED === "fast" &&
  !MULTIPLAYER_ALLOW_FAST_PROFILE_IN_PRODUCTION
    ? "normal"
    : MULTIPLAYER_SPEED_PROFILE_REQUESTED;
const BOT_SPEED_PROFILE_DEFAULTS = Object.freeze({
  normal: Object.freeze({
    tickRangeMs: Object.freeze({ min: 4500, max: 9000 }),
    turnAdvanceRangeMs: Object.freeze({ min: 1600, max: 3200 }),
    turnAdvanceByProfileMs: Object.freeze({
      cautious: Object.freeze({ min: 2300, max: 4200 }),
      balanced: Object.freeze({ min: 1500, max: 3100 }),
      aggressive: Object.freeze({ min: 900, max: 2200 }),
    }),
  }),
  fast: Object.freeze({
    tickRangeMs: Object.freeze({ min: 900, max: 1800 }),
    turnAdvanceRangeMs: Object.freeze({ min: 450, max: 1100 }),
    turnAdvanceByProfileMs: Object.freeze({
      cautious: Object.freeze({ min: 700, max: 1700 }),
      balanced: Object.freeze({ min: 450, max: 1100 }),
      aggressive: Object.freeze({ min: 250, max: 800 }),
    }),
  }),
});
const ACTIVE_BOT_SPEED_DEFAULTS = BOT_SPEED_PROFILE_DEFAULTS[MULTIPLAYER_SPEED_PROFILE];
const BOT_TICK_DELAY_RANGE_MS = normalizeDelayRangeFromEnv(
  process.env.MULTIPLAYER_BOT_TICK_MIN_MS,
  process.env.MULTIPLAYER_BOT_TICK_MAX_MS,
  ACTIVE_BOT_SPEED_DEFAULTS.tickRangeMs,
  { minimum: 200, maximum: 60 * 1000 }
);
const BOT_TICK_MIN_MS = BOT_TICK_DELAY_RANGE_MS.min;
const BOT_TICK_MAX_MS = BOT_TICK_DELAY_RANGE_MS.max;
const BOT_NAMES = ["Byte Bessie", "Lag Larry", "Packet Patty", "Dicebot Dave"];
const BOT_PROFILES = ["cautious", "balanced", "aggressive"];
const GAME_DIFFICULTIES = new Set(["easy", "normal", "hard"]);
const GAME_CREATE_MODES = new Set(["solo", "multiplayer", "demo"]);
const GAME_TIMING_PROFILES = new Set(["standard", "demo_fast", "test_fast"]);
const GAME_AUTOMATION_SPEED_MODES = new Set(["normal", "fast"]);
const UNIFIED_GAME_MODES = GAME_CREATE_MODES;
const UNIFIED_GAME_TIMING_PROFILES = GAME_TIMING_PROFILES;
const UNIFIED_GAME_AUTOMATION_SPEED_MODES = GAME_AUTOMATION_SPEED_MODES;
const UNIFIED_GAME_DEFAULT_CAPABILITIES = Object.freeze({
  solo: Object.freeze({
    chaos: false,
    gifting: false,
    moderation: false,
    banning: false,
    hostControls: true,
    privateChat: false,
  }),
  multiplayer: Object.freeze({
    chaos: false,
    gifting: false,
    moderation: true,
    banning: true,
    hostControls: true,
    privateChat: true,
  }),
  demo: Object.freeze({
    chaos: false,
    gifting: false,
    moderation: true,
    banning: true,
    hostControls: true,
    privateChat: true,
  }),
});
const PARTICIPANT_STATE_ACTIONS = new Set(["sit", "stand", "ready", "unready"]);
const DEMO_CONTROL_ACTIONS = new Set(["pause", "resume", "speed_normal", "speed_fast"]);
const SESSION_MODERATION_ACTIONS = new Set(["kick", "ban"]);
const BOT_CAMERA_EFFECTS = ["shake"];
const MAX_SESSION_ROOM_BANS = 256;
const BOT_TURN_ADVANCE_DELAY_RANGE_MS = normalizeDelayRangeFromEnv(
  process.env.MULTIPLAYER_BOT_TURN_ADVANCE_MIN_MS,
  process.env.MULTIPLAYER_BOT_TURN_ADVANCE_MAX_MS,
  ACTIVE_BOT_SPEED_DEFAULTS.turnAdvanceRangeMs,
  { minimum: 200, maximum: 60 * 1000 }
);
const BOT_TURN_ADVANCE_MIN_MS = BOT_TURN_ADVANCE_DELAY_RANGE_MS.min;
const BOT_TURN_ADVANCE_MAX_MS = BOT_TURN_ADVANCE_DELAY_RANGE_MS.max;
const BOT_TURN_ADVANCE_DELAY_BY_PROFILE = Object.freeze({
  cautious: normalizeDelayRangeFromEnv(
    process.env.MULTIPLAYER_BOT_TURN_ADVANCE_CAUTIOUS_MIN_MS,
    process.env.MULTIPLAYER_BOT_TURN_ADVANCE_CAUTIOUS_MAX_MS,
    ACTIVE_BOT_SPEED_DEFAULTS.turnAdvanceByProfileMs.cautious,
    { minimum: 200, maximum: 60 * 1000 }
  ),
  balanced: normalizeDelayRangeFromEnv(
    process.env.MULTIPLAYER_BOT_TURN_ADVANCE_BALANCED_MIN_MS,
    process.env.MULTIPLAYER_BOT_TURN_ADVANCE_BALANCED_MAX_MS,
    ACTIVE_BOT_SPEED_DEFAULTS.turnAdvanceByProfileMs.balanced,
    { minimum: 200, maximum: 60 * 1000 }
  ),
  aggressive: normalizeDelayRangeFromEnv(
    process.env.MULTIPLAYER_BOT_TURN_ADVANCE_AGGRESSIVE_MIN_MS,
    process.env.MULTIPLAYER_BOT_TURN_ADVANCE_AGGRESSIVE_MAX_MS,
    ACTIVE_BOT_SPEED_DEFAULTS.turnAdvanceByProfileMs.aggressive,
    { minimum: 200, maximum: 60 * 1000 }
  ),
});
const DEFAULT_PARTICIPANT_DICE_COUNT = 15;
const BOT_ROLL_DICE_SIDES = [8, 12, 10, 6, 6, 6, 20, 6, 4, 6, 6, 6, 10, 6, 6];
const DEFAULT_TURN_TIMEOUT_MS = normalizeTurnTimeoutValue(process.env.TURN_TIMEOUT_MS, 30000);
const TURN_TIMEOUT_BY_DIFFICULTY_MS = Object.freeze({
  easy: normalizeTurnTimeoutValue(process.env.MULTIPLAYER_TURN_TIMEOUT_EASY_MS, 40000),
  normal: normalizeTurnTimeoutValue(
    process.env.MULTIPLAYER_TURN_TIMEOUT_NORMAL_MS,
    DEFAULT_TURN_TIMEOUT_MS
  ),
  hard: normalizeTurnTimeoutValue(process.env.MULTIPLAYER_TURN_TIMEOUT_HARD_MS, 15000),
});
const TURN_TIMEOUT_MS = TURN_TIMEOUT_BY_DIFFICULTY_MS.normal;
const MULTIPLAYER_PARTICIPANT_STALE_MS = normalizeTurnTimeoutValue(
  process.env.MULTIPLAYER_PARTICIPANT_STALE_MS,
  2 * 60 * 1000
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
const TURN_TIMEOUT_STAND_STRIKE_LIMIT = normalizeTurnStrikeLimitValue(
  process.env.MULTIPLAYER_TURN_TIMEOUT_STAND_STRIKE_LIMIT,
  2
);
const POST_GAME_INACTIVITY_TIMEOUT_MS = normalizeTurnTimeoutValue(
  process.env.MULTIPLAYER_POST_GAME_INACTIVITY_TIMEOUT_MS,
  2 * 60 * 1000
);
const NEXT_GAME_AUTO_START_DELAY_MS = normalizeTurnTimeoutValue(
  process.env.MULTIPLAYER_NEXT_GAME_DELAY_MS,
  60 * 1000
);
const NO_SEATED_ROOM_TIMEOUT_MS = normalizeTurnTimeoutValue(
  process.env.MULTIPLAYER_NO_SEATED_ROOM_TIMEOUT_MS,
  3 * 60 * 1000
);
const DEMO_FAST_TURN_TIMEOUT_FACTOR = 0.6;
const DEMO_FAST_TURN_TIMEOUT_MIN_MS = 5000;
const BOOTSTRAP_WAIT_TIMEOUT_MS = normalizeTurnTimeoutValue(
  process.env.API_BOOTSTRAP_WAIT_TIMEOUT_MS,
  20000
);
const BOOTSTRAP_RETRY_DELAY_MS = normalizeTurnTimeoutValue(
  process.env.API_BOOTSTRAP_RETRY_DELAY_MS,
  5000
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
let persistStoreQueue = Promise.resolve();
let chatConductTermRefreshHandle = null;
let bootstrapPromise = null;
let bootstrapRetryHandle = null;
let bootstrapReady = false;
let bootstrapStartedAt = 0;
let bootstrapCompletedAt = 0;
let bootstrapLastError = "";
let bootstrapAttemptCount = 0;
let shutdownInProgress = false;
let shutdownForceTimer = null;

const server = createServer((req, res) => {
  void handleRequest(req, res);
});
const wsSessionClients = new Map();
const wsClientMeta = new WeakMap();
const socketRelay = createSocketRelay({
  wsSessionClients,
  writeSocketFrame,
  safeCloseSocket,
  wsCloseCodes: WS_CLOSE_CODES,
  hasRoomChannelBlockRelationship,
  log,
});
const authenticateSocketUpgrade = createSocketUpgradeAuthenticator({
  getSession: (sessionId) => store.multiplayerSessions[sessionId],
  rehydrateStoreFromAdapter,
  verifyAccessToken,
  isPlayerBannedFromSession,
  isBotParticipant,
  markSessionActivity,
  persistStore,
  sessionUpgradeGraceMs: WS_SESSION_UPGRADE_GRACE_MS,
  log,
});
const socketLifecycle = createSocketLifecycle({
  wsSessionClients,
  wsClientMeta,
  maxMessageBytes: MAX_WS_MESSAGE_BYTES,
  wsCloseCodes: WS_CLOSE_CODES,
  parseSocketFrame,
  writeSocketFrame,
  getSession: (sessionId) => store.multiplayerSessions[sessionId],
  isBotParticipant,
  markSessionActivity,
  sendTurnSyncPayload,
  reconcileSessionLoops,
  reconcileTurnTimeoutLoop,
  handleSocketMessage,
  sendSocketError,
  safeCloseSocket,
  log,
});
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
const sessionLifecycleController = createSessionLifecycleEngine({
  turnPhases: TURN_PHASES,
  defaultParticipantDiceCount: DEFAULT_PARTICIPANT_DICE_COUNT,
  nextGameAutoStartDelayMs: NEXT_GAME_AUTO_START_DELAY_MS,
  postGameInactivityTimeoutMs: POST_GAME_INACTIVITY_TIMEOUT_MS,
  normalizeTurnPhase,
  isParticipantActiveForCurrentGame,
  normalizeParticipantScore,
  normalizeParticipantRemainingDice,
  isParticipantComplete,
  isParticipantQueuedForNextGame,
  normalizeParticipantCompletedAt,
  isBotParticipant,
  ensureSessionTurnState,
  markSessionActivity,
  resolveSessionNextGameStartsAt,
});
const sessionTurnController = createSessionTurnEngine({
  turnPhases: TURN_PHASES,
  defaultParticipantDiceCount: DEFAULT_PARTICIPANT_DICE_COUNT,
  normalizeTurnPhase,
  normalizeTurnRollSnapshot,
  normalizeTurnScoreSummary,
  serializeParticipantsInJoinOrder,
  getActiveHumanParticipants,
  areAllHumansReady,
  isBotParticipant,
  isParticipantActiveForCurrentGame,
  isSessionDemoAutoRunEnabled,
  resolveSessionTurnTimeoutMs,
  serializeTurnRollSnapshot,
  resolveSessionGameStartedAt,
  isParticipantComplete,
  scheduleSessionPostGameLifecycle,
  normalizeParticipantScore,
  normalizeParticipantRemainingDice,
  normalizeParticipantCompletedAt,
});
const botTurnController = createBotTurnEngine({
  turnPhases: TURN_PHASES,
  botEngine,
  normalizeTurnPhase,
  ensureSessionTurnState,
  isBotParticipant,
  resolveSessionGameDifficulty,
  isParticipantComplete,
  normalizeParticipantCompletedAt,
  advanceSessionTurn,
  normalizeParticipantRemainingDice,
  parseTurnRollPayload,
  buildTurnActionMessage,
  applyParticipantScoreUpdate,
});
const turnTimeoutController = createTurnTimeoutEngine({
  turnPhases: TURN_PHASES,
  turnTimeoutStandStrikeLimit: TURN_TIMEOUT_STAND_STRIKE_LIMIT,
  normalizeTurnPhase,
  normalizeTurnScoreSummary,
  normalizeTurnRollSnapshot,
  applyParticipantScoreUpdate,
  buildTurnActionMessage,
  completeSessionRoundWithWinner,
  registerParticipantTimeoutStrike,
  standParticipantIntoObserverMode,
  resolveSessionTurnTimeoutMs,
  advanceSessionTurn,
});
const turnActionController = createTurnActionEngine({
  turnPhases: TURN_PHASES,
  defaultParticipantDiceCount: DEFAULT_PARTICIPANT_DICE_COUNT,
  normalizeTurnPhase,
  ensureSessionTurnState,
  parseTurnRollPayload,
  parseTurnSelectionPayload,
  buildTurnScoreSummaryFromSelectedDice,
  normalizeParticipantScore,
  normalizeParticipantRemainingDice,
  isParticipantComplete,
  normalizeParticipantCompletedAt,
  applyParticipantScoreUpdate,
  parseTurnScorePayload,
  clearParticipantTimeoutStrike,
  buildTurnActionMessage,
  completeSessionRoundWithWinner,
});
const roomChannelFilterRegistry = createAddonFilterRegistry({
  now: () => Date.now(),
  warn: (message, error = null) => {
    if (error) {
      log.warn(message, error);
      return;
    }
    log.warn(message);
  },
});
const roomChannelSenderRestrictionFilter = createRoomChannelSenderRestrictionFilter({
  isRoomChannelSenderRestricted,
});
const roomChannelChatConductFilter = createRoomChannelChatConductFilter({
  ensureSessionChatConductState,
  evaluateRoomChannelConduct,
  buildChatConductWarning,
  getChatConductPolicy,
});
const directMessageBlockRelationshipFilter = createDirectMessageBlockRelationshipFilter({
  hasRoomChannelBlockRelationship,
});
roomChannelFilterRegistry.registerFilter({
  id: roomChannelSenderRestrictionFilter.id,
  scope: roomChannelSenderRestrictionFilter.scope,
  run: roomChannelSenderRestrictionFilter.run,
  policy: {
    enabled: ROOM_CHANNEL_SENDER_FILTER_ENABLED,
    timeoutMs: ROOM_CHANNEL_SENDER_FILTER_TIMEOUT_MS,
    onError: ROOM_CHANNEL_SENDER_FILTER_ON_ERROR,
  },
});
roomChannelFilterRegistry.registerFilter({
  id: roomChannelChatConductFilter.id,
  scope: roomChannelChatConductFilter.scope,
  run: roomChannelChatConductFilter.run,
  policy: {
    enabled: CHAT_CONDUCT_FILTER_ENABLED,
    timeoutMs: CHAT_CONDUCT_FILTER_TIMEOUT_MS,
    onError: CHAT_CONDUCT_FILTER_ON_ERROR,
  },
});
roomChannelFilterRegistry.registerFilter({
  id: directMessageBlockRelationshipFilter.id,
  scope: directMessageBlockRelationshipFilter.scope,
  run: directMessageBlockRelationshipFilter.run,
  policy: {
    enabled: DIRECT_MESSAGE_BLOCK_FILTER_ENABLED,
    timeoutMs: DIRECT_MESSAGE_BLOCK_FILTER_TIMEOUT_MS,
    onError: DIRECT_MESSAGE_BLOCK_FILTER_ON_ERROR,
  },
});

void beginBootstrap();

server.on("upgrade", async (req, socket) => {
  try {
    if (shutdownInProgress) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    const ready = await ensureBootstrapReadyForRequest();
    if (!ready) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

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
    socketLifecycle.handleSocketConnection(socket, auth);
  } catch (error) {
    log.warn("Failed to process WebSocket upgrade", error);
    rejectUpgrade(socket, 500, "Internal Server Error");
  }
});

server.listen(PORT, () => {
  log.info(`Listening on http://localhost:${PORT}`);
  log.info(`Health endpoint: http://localhost:${PORT}/api/health`);
  log.info(`WebSocket endpoint: ws://localhost:${PORT}/?session=<id>&playerId=<id>&token=<token>`);
  log.info(`Multiplayer session idle TTL: ${MULTIPLAYER_SESSION_IDLE_TTL_MS}ms`);
  log.info(`Multiplayer participant stale timeout: ${MULTIPLAYER_PARTICIPANT_STALE_MS}ms`);
  log.info(
    `Multiplayer speed profile: ${MULTIPLAYER_SPEED_PROFILE} (requested=${MULTIPLAYER_SPEED_PROFILE_REQUESTED})`
  );
  log.info(`Bot tick interval: ${BOT_TICK_MIN_MS}-${BOT_TICK_MAX_MS}ms`);
  log.info(
    `Bot turn delay interval: ${BOT_TURN_ADVANCE_MIN_MS}-${BOT_TURN_ADVANCE_MAX_MS}ms`
  );
  if (
    NODE_ENV === "production" &&
    MULTIPLAYER_SPEED_PROFILE_REQUESTED === "fast" &&
    !MULTIPLAYER_ALLOW_FAST_PROFILE_IN_PRODUCTION
  ) {
    log.warn(
      "Ignoring MULTIPLAYER_SPEED_PROFILE=fast in production (set MULTIPLAYER_ALLOW_FAST_PROFILE_IN_PRODUCTION=1 to override)."
    );
  }
  if (SHORT_SESSION_TTL_REQUESTED && NODE_ENV === "production") {
    log.warn("Ignoring ALLOW_SHORT_SESSION_TTLS in production");
  }
  log.info(`Session cleanup sweep: every ${MULTIPLAYER_CLEANUP_INTERVAL_MS}ms`);
});

const cleanupSweepHandle = setInterval(() => {
  cleanupExpiredRecords();
}, MULTIPLAYER_CLEANUP_INTERVAL_MS);
if (typeof cleanupSweepHandle.unref === "function") {
  cleanupSweepHandle.unref();
}

process.on("SIGTERM", () => {
  void initiateShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void initiateShutdown("SIGINT");
});

function startChatConductTermRefreshLoop() {
  if (chatConductTermRefreshHandle) {
    return;
  }
  if (CHAT_CONDUCT_TERM_SERVICE_REFRESH_MS <= 0) {
    return;
  }
  if (!CHAT_CONDUCT_TERM_SERVICE_URL) {
    return;
  }

  chatConductTermRefreshHandle = setInterval(() => {
    void refreshChatModerationTermsFromRemote({ source: "interval" });
  }, CHAT_CONDUCT_TERM_SERVICE_REFRESH_MS);
  if (typeof chatConductTermRefreshHandle.unref === "function") {
    chatConductTermRefreshHandle.unref();
  }
  log.info(`Chat moderation term refresh loop: every ${CHAT_CONDUCT_TERM_SERVICE_REFRESH_MS}ms`);
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
  const loadedStore = await storeAdapter.load();
  store = cloneStore(loadedStore);
  const consistencyChanged = normalizeStoreConsistency(Date.now());
  hydrateChatModerationTermsFromStore();
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
  const chatConductPolicy = getChatConductPolicy();
  const chatConductTermsSnapshot = CHAT_CONDUCT_TERM_SERVICE.getSnapshot();
  log.info(
    `Chat conduct filter: enabled=${chatConductPolicy.enabled} publicOnly=${chatConductPolicy.publicOnly} terms=${chatConductPolicy.bannedTerms.size} strikeLimit=${chatConductPolicy.strikeLimit} muteMs=${chatConductPolicy.muteDurationMs} autoBanStrikeLimit=${chatConductPolicy.autoBanStrikeLimit} managedTerms=${chatConductTermsSnapshot.managedTermCount} remoteTerms=${chatConductTermsSnapshot.remoteTermCount} remoteConfigured=${chatConductTermsSnapshot.remoteConfigured}`
  );
  const roomChannelFilterSummary = roomChannelFilterRegistry
    .listFilters()
    .map(
      (filter) =>
        `${filter.id}(enabled=${filter.policy.enabled},timeoutMs=${filter.policy.timeoutMs},onError=${filter.policy.onError})`
    )
    .join(", ");
  log.info(`Room-channel addon filters: ${roomChannelFilterSummary || "none"}`);
  if (CHAT_CONDUCT_TERM_SYNC_ON_BOOT && chatConductTermsSnapshot.remoteConfigured) {
    const bootstrapSync = await refreshChatModerationTermsFromRemote({
      source: "bootstrap",
      persistOnNoChange: true,
    });
    if (!bootstrapSync.ok) {
      log.warn(
        `Chat moderation term bootstrap sync skipped (${bootstrapSync.reason ?? "unknown"})`
      );
    }
  }
  const now = Date.now();
  const publicRoomsChanged = reconcilePublicRoomInventory(now);
  Object.keys(store.multiplayerSessions).forEach((sessionId) => {
    reconcileSessionLoops(sessionId);
  });
  if (publicRoomsChanged || consistencyChanged) {
    await persistStore();
  }
}

function beginBootstrap() {
  if (!bootstrapStartedAt) {
    bootstrapStartedAt = Date.now();
  }
  bootstrapPromise = runBootstrapAttempt("startup");
}

async function runBootstrapAttempt(source = "retry") {
  bootstrapAttemptCount += 1;
  const attemptStartedAt = Date.now();
  try {
    await bootstrap();
    bootstrapReady = true;
    bootstrapCompletedAt = Date.now();
    bootstrapLastError = "";
    log.info(
      `Bootstrap ready (attempt=${bootstrapAttemptCount}, source=${source}, durationMs=${bootstrapCompletedAt - attemptStartedAt})`
    );
    startChatConductTermRefreshLoop();
  } catch (error) {
    bootstrapReady = false;
    bootstrapLastError =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    log.error(
      `Bootstrap failed (attempt=${bootstrapAttemptCount}, source=${source}); retrying in ${BOOTSTRAP_RETRY_DELAY_MS}ms`,
      error
    );
    scheduleBootstrapRetry();
  }
}

function scheduleBootstrapRetry() {
  if (bootstrapRetryHandle || bootstrapReady) {
    return;
  }
  bootstrapRetryHandle = setTimeout(() => {
    bootstrapRetryHandle = null;
    bootstrapPromise = runBootstrapAttempt("retry");
  }, BOOTSTRAP_RETRY_DELAY_MS);
  if (typeof bootstrapRetryHandle.unref === "function") {
    bootstrapRetryHandle.unref();
  }
}

async function ensureBootstrapReadyForRequest() {
  if (bootstrapReady) {
    return true;
  }
  if (!bootstrapPromise) {
    beginBootstrap();
  }
  if (!bootstrapPromise) {
    return false;
  }
  let timeoutHandle = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve(false), BOOTSTRAP_WAIT_TIMEOUT_MS);
  });
  if (typeof timeoutHandle?.unref === "function") {
    timeoutHandle.unref();
  }
  try {
    await Promise.race([bootstrapPromise.then(() => true), timeoutPromise]);
  } catch {
    // Bootstrap errors are tracked via bootstrapLastError and retry scheduling.
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
  return bootstrapReady;
}

const API_ROUTE_HANDLERS = createApiRouteHandlers({
  handleImageProxy,
  handleAdminOverview,
  handleAdminRooms,
  handleAdminMetrics,
  handleAdminStorage,
  handleAdminModerationTermsOverview,
  handleAdminUpsertModerationTerm,
  handleAdminRemoveModerationTerm,
  handleAdminRefreshModerationTerms,
  handleAdminAudit,
  handleAdminRoles,
  handleAdminRoleUpsert,
  handleAdminExpireSession,
  handleAdminRemoveParticipant,
  handleAdminSessionChannelMessage,
  handleAdminSessionConductState,
  handleAdminSessionConductPlayer,
  handleAdminClearSessionConductPlayer,
  handleAdminClearSessionConductState,
  handleRefreshToken,
  handleAuthMe,
  handleGetProfile,
  handlePutProfile,
  handleGetPlayerScores,
  handleAppendPlayerScores,
  handleAppendLogs,
  handleSubmitLeaderboardScore,
  handleGetGlobalLeaderboard,
  handleCreateSession,
  handleListRooms,
  handleJoinRoomByCode,
  handleJoinSession,
  handleSessionHeartbeat,
  handleUpdateParticipantState,
  handleUpdateSessionDemoControls,
  handleModerateSessionParticipant,
  handleQueueParticipantForNextGame,
  handleLeaveSession,
  handleRefreshSessionAuth,
});

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

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        now: Date.now(),
        shutdown: {
          inProgress: shutdownInProgress,
        },
        bootstrap: {
          ready: bootstrapReady,
          attempts: bootstrapAttemptCount,
          startedAt: bootstrapStartedAt || null,
          completedAt: bootstrapCompletedAt || null,
          lastError: bootstrapLastError || null,
          waitTimeoutMs: BOOTSTRAP_WAIT_TIMEOUT_MS,
          retryDelayMs: BOOTSTRAP_RETRY_DELAY_MS,
        },
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
        multiplayer: {
          speedProfile: MULTIPLAYER_SPEED_PROFILE,
          speedProfileRequested: MULTIPLAYER_SPEED_PROFILE_REQUESTED,
          sessionIdleTtlMs: MULTIPLAYER_SESSION_IDLE_TTL_MS,
          sessionIdleTtlMinMs: SESSION_IDLE_TTL_MIN_MS,
          participantStaleMs: MULTIPLAYER_PARTICIPANT_STALE_MS,
          cleanupIntervalMs: MULTIPLAYER_CLEANUP_INTERVAL_MS,
          noSeatedRoomTimeoutMs: NO_SEATED_ROOM_TIMEOUT_MS,
          turnTimeoutMs: TURN_TIMEOUT_MS,
          turnTimeoutByDifficultyMs: TURN_TIMEOUT_BY_DIFFICULTY_MS,
          turnTimeoutStandStrikeLimit: TURN_TIMEOUT_STAND_STRIKE_LIMIT,
          nextGameAutoStartDelayMs: NEXT_GAME_AUTO_START_DELAY_MS,
          botTickRangeMs: BOT_TICK_DELAY_RANGE_MS,
          botTurnAdvanceRangeMs: BOT_TURN_ADVANCE_DELAY_RANGE_MS,
          botTurnAdvanceByProfileMs: BOT_TURN_ADVANCE_DELAY_BY_PROFILE,
          chatConduct: buildAdminChatConductPolicySummary(),
        },
        storage: buildStoreDiagnostics(),
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/ready") {
      const ready = bootstrapReady && !shutdownInProgress;
      sendJson(res, ready ? 200 : 503, {
        ok: ready,
        now: Date.now(),
        reason: shutdownInProgress
          ? "shutdown_in_progress"
          : bootstrapLastError
            ? "bootstrap_failed"
            : "bootstrap_in_progress",
        shutdown: {
          inProgress: shutdownInProgress,
        },
        bootstrap: {
          ready: bootstrapReady,
          attempts: bootstrapAttemptCount,
          startedAt: bootstrapStartedAt || null,
          completedAt: bootstrapCompletedAt || null,
          lastError: bootstrapLastError || null,
          waitTimeoutMs: BOOTSTRAP_WAIT_TIMEOUT_MS,
          retryDelayMs: BOOTSTRAP_RETRY_DELAY_MS,
        },
      });
      return;
    }

    if (shutdownInProgress) {
      sendJson(res, 503, {
        error: "Service shutting down",
        reason: "shutdown_in_progress",
      });
      return;
    }

    const ready = await ensureBootstrapReadyForRequest();
    if (!ready) {
      sendJson(res, 503, {
        error: "Service warming up",
        reason: bootstrapLastError ? "bootstrap_failed" : "bootstrap_in_progress",
        bootstrap: {
          ready: false,
          attempts: bootstrapAttemptCount,
          lastError: bootstrapLastError || null,
          waitTimeoutMs: BOOTSTRAP_WAIT_TIMEOUT_MS,
          retryDelayMs: BOOTSTRAP_RETRY_DELAY_MS,
        },
      });
      return;
    }

    cleanupExpiredRecords();
    const handled = await dispatchApiRoute(
      {
        req,
        res,
        url,
        pathname,
      },
      API_ROUTE_HANDLERS
    );
    if (handled) {
      return;
    }

    sendJson(res, 404, { error: "Unknown endpoint" });
  } catch (error) {
    log.error("Request failed", error);
    sendJson(res, 500, { error: "Internal server error" });
  }
}

async function initiateShutdown(signal = "SIGTERM") {
  if (shutdownInProgress) {
    return;
  }
  shutdownInProgress = true;
  log.info(`Shutdown initiated (${signal})`);

  if (bootstrapRetryHandle) {
    clearTimeout(bootstrapRetryHandle);
    bootstrapRetryHandle = null;
  }
  if (chatConductTermRefreshHandle) {
    clearInterval(chatConductTermRefreshHandle);
    chatConductTermRefreshHandle = null;
  }
  clearInterval(cleanupSweepHandle);

  if (shutdownForceTimer) {
    clearTimeout(shutdownForceTimer);
    shutdownForceTimer = null;
  }
  shutdownForceTimer = setTimeout(() => {
    log.error("Forced shutdown timeout reached; exiting");
    process.exit(1);
  }, 10000);
  if (typeof shutdownForceTimer.unref === "function") {
    shutdownForceTimer.unref();
  }

  for (const sessionId of Object.keys(store.multiplayerSessions)) {
    stopSessionLoops(sessionId);
  }

  for (const clients of wsSessionClients.values()) {
    for (const client of [...clients]) {
      safeCloseSocket(client, WS_CLOSE_CODES.normal, "server_shutdown");
    }
  }

  await new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });

  if (shutdownForceTimer) {
    clearTimeout(shutdownForceTimer);
    shutdownForceTimer = null;
  }
  process.exit(0);
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
  const normalizedDisplayName = normalizeParticipantDisplayName(body.displayName);
  const profile = {
    playerId,
    ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
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
  const resolvedGameSettings = resolveCreateSessionGameSettings(body);
  const botCount = resolvedGameSettings.botCount;
  const gameDifficulty = resolvedGameSettings.gameDifficulty;
  const demoSpeedMode = resolvedGameSettings.demoSpeedMode;
  const demoMode = resolvedGameSettings.demoMode;
  const demoAutoRun = resolvedGameSettings.demoAutoRun;
  const gameConfig = resolvedGameSettings.gameConfig;
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
  const normalizedDisplayName = normalizeParticipantDisplayName(body?.displayName);
  const participants = {
    [playerId]: {
      playerId,
      ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
      avatarUrl: normalizeAvatarUrl(body?.avatarUrl),
      providerId: normalizeProviderId(body?.providerId),
      ...(participantBlockedPlayerIds.length > 0
        ? { blockedPlayerIds: participantBlockedPlayerIds }
        : {}),
      joinedAt: now,
      lastHeartbeatAt: now,
      isSeated: false,
      isReady: false,
      score: 0,
      remainingDice: DEFAULT_PARTICIPANT_DICE_COUNT,
      turnTimeoutRound: null,
      turnTimeoutCount: 0,
      queuedForNextGame: false,
      isComplete: false,
      completedAt: null,
    },
  };

  const session = {
    sessionId,
    roomCode,
    gameDifficulty,
    gameConfig,
    demoMode,
    demoAutoRun,
    demoSpeedMode,
    wsUrl: WS_BASE_URL,
    roomKind: ROOM_KINDS.private,
    ownerPlayerId: playerId,
    roomBans: {},
    chatConductState: createEmptyChatConductState(),
    createdAt: now,
    gameStartedAt: now,
    lastActivityAt: now,
    expiresAt,
    participants,
    turnState: null,
  };
  addBotsToSession(session, botCount, now);
  session.gameConfig = resolveSessionGameConfig(session);

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
      sessionById = await rehydrateSessionWithRetry(sessionId, "join_session", {
        attempts: 6,
        baseDelayMs: 150,
      });
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
  if (isPlayerBannedFromSession(session, playerId)) {
    sendJson(res, 403, { error: "Player banned from room", reason: "room_banned" });
    return;
  }
  const joinGameSettings = resolveJoinRequestGameSettings(body);
  const requestedBotCount = joinGameSettings.requestedBotCount;
  const hasSessionDifficulty =
    typeof session.gameDifficulty === "string" &&
    GAME_DIFFICULTIES.has(session.gameDifficulty.trim().toLowerCase());
  if (!hasSessionDifficulty) {
    session.gameDifficulty = joinGameSettings.requestedDifficulty;
  }

  const existingParticipant = session.participants[playerId];
  const isReturningParticipant = Boolean(existingParticipant && !isBotParticipant(existingParticipant));
  const queuedForNextGame = isReturningParticipant
    ? normalizeQueuedForNextGame(existingParticipant?.queuedForNextGame)
    : false;
  if (!isReturningParticipant && getHumanParticipantCount(session) >= MAX_MULTIPLAYER_HUMAN_PLAYERS) {
    sendJson(res, 409, { error: "Room is full", reason: "room_full" });
    return;
  }

  const participantBlockedPlayerIds = resolveParticipantBlockedPlayerIds(playerId, {
    candidateBlockedPlayerIds: body?.blockedPlayerIds,
    fallbackBlockedPlayerIds: existingParticipant?.blockedPlayerIds,
  });
  const normalizedDisplayName =
    normalizeParticipantDisplayName(body?.displayName) ??
    normalizeParticipantDisplayName(existingParticipant?.displayName);
  session.participants[playerId] = {
    playerId,
    ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
    avatarUrl: normalizeAvatarUrl(body?.avatarUrl) ?? normalizeAvatarUrl(existingParticipant?.avatarUrl),
    providerId:
      normalizeProviderId(body?.providerId) ?? normalizeProviderId(existingParticipant?.providerId),
    ...(participantBlockedPlayerIds.length > 0
      ? { blockedPlayerIds: participantBlockedPlayerIds }
      : {}),
    joinedAt: existingParticipant?.joinedAt ?? now,
    lastHeartbeatAt: now,
    isSeated: isReturningParticipant ? isParticipantSeated(existingParticipant) : false,
    isReady: isReturningParticipant
      ? existingParticipant?.isReady === true && isParticipantSeated(existingParticipant)
      : false,
    score: normalizeParticipantScore(existingParticipant?.score),
    remainingDice: normalizeParticipantRemainingDice(existingParticipant?.remainingDice),
    turnTimeoutRound: normalizeParticipantTimeoutRound(existingParticipant?.turnTimeoutRound),
    turnTimeoutCount: normalizeParticipantTimeoutCount(existingParticipant?.turnTimeoutCount),
    queuedForNextGame,
    isComplete: existingParticipant?.isComplete === true,
    completedAt: normalizeParticipantCompletedAt(existingParticipant?.completedAt),
  };
  if (getSessionRoomKind(session) === ROOM_KINDS.private) {
    ensureSessionOwner(session, playerId);
  }
  addBotsToSession(session, requestedBotCount, now);
  session.gameConfig = resolveSessionGameConfig(session);
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
    session = await rehydrateSessionWithRetry(sessionId, "heartbeat_session", {
      attempts: 6,
      baseDelayMs: 150,
    });
  }
  if (!session || session.expiresAt <= Date.now()) {
    sendJson(res, 200, { ok: false, reason: "session_expired" });
    return;
  }

  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!playerId || !session.participants[playerId]) {
    await rehydrateStoreFromAdapter(`heartbeat_participant:${sessionId}:${playerId || "unknown"}`, {
      force: true,
    });
    session = store.multiplayerSessions[sessionId];
  }
  if (!session || !playerId || !session.participants[playerId]) {
    sendJson(res, 200, { ok: false, reason: "unknown_player" });
    return;
  }

  let authCheck = authorizeSessionActionRequest(req, playerId, sessionId);
  if (!authCheck.ok && shouldRetrySessionAuthFromStore(authCheck.reason)) {
    await rehydrateStoreFromAdapter(`heartbeat_auth:${sessionId}:${playerId}`, { force: true });
    authCheck = authorizeSessionActionRequest(req, playerId, sessionId);
  }
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized", reason: authCheck.reason ?? "unauthorized" });
    return;
  }

  const now = Date.now();
  session.participants[playerId].lastHeartbeatAt = now;
  markSessionActivity(session, playerId, now);
  await persistStore();
  sendJson(res, 200, { ok: true });
}

async function handleUpdateParticipantState(req, res, pathname) {
  const sessionId = decodeURIComponent(pathname.split("/")[4]);
  let session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    await rehydrateStoreFromAdapter(`participant_state_session:${sessionId}`, { force: true });
    session = store.multiplayerSessions[sessionId];
  }
  if (!session || session.expiresAt <= Date.now()) {
    sendJson(res, 200, {
      ok: false,
      reason: "session_expired",
    });
    return;
  }

  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  const action = normalizeParticipantStateAction(body?.action);
  let participant = playerId ? session.participants[playerId] : null;
  if (!playerId || !participant || isBotParticipant(participant)) {
    await rehydrateStoreFromAdapter(`participant_state_participant:${sessionId}:${playerId || "unknown"}`, {
      force: true,
    });
    session = store.multiplayerSessions[sessionId];
    participant = playerId && session ? session.participants[playerId] : null;
  }
  if (!session || !playerId || !participant || isBotParticipant(participant)) {
    sendJson(res, 200, {
      ok: false,
      reason: "unknown_player",
    });
    return;
  }
  if (!action) {
    sendJson(res, 400, {
      error: "action is required",
      reason: "invalid_action",
    });
    return;
  }

  let authCheck = authorizeSessionActionRequest(req, playerId, sessionId);
  if (!authCheck.ok && shouldRetrySessionAuthFromStore(authCheck.reason)) {
    await rehydrateStoreFromAdapter(`participant_state_auth:${sessionId}:${playerId}`, { force: true });
    authCheck = authorizeSessionActionRequest(req, playerId, sessionId);
  }
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized", reason: authCheck.reason ?? "unauthorized" });
    return;
  }

  const now = Date.now();
  let changed = false;
  let reason = "ok";

  if (action === "sit") {
    const shouldQueueForNextGame = shouldQueueParticipantForNextGame(session);
    if (!isParticipantSeated(participant)) {
      participant.isSeated = true;
      changed = true;
    }
    if (participant.isReady === true) {
      participant.isReady = false;
      changed = true;
    }
    const nextQueuedForNextGame = shouldQueueForNextGame ? true : false;
    if (participant.queuedForNextGame !== nextQueuedForNextGame) {
      participant.queuedForNextGame = nextQueuedForNextGame;
      changed = true;
    }
  } else if (action === "stand") {
    if (isParticipantSeated(participant)) {
      participant.isSeated = false;
      changed = true;
    }
    if (participant.isReady === true) {
      participant.isReady = false;
      changed = true;
    }
    if (participant.queuedForNextGame === true) {
      participant.queuedForNextGame = false;
      changed = true;
    }
  } else if (action === "ready") {
    if (!isParticipantSeated(participant)) {
      reason = "not_seated";
    } else {
      const shouldQueueForNextGame = shouldQueueParticipantForNextGame(session);
      const nextQueuedForNextGame = shouldQueueForNextGame ? true : false;
      if (participant.queuedForNextGame !== nextQueuedForNextGame) {
        participant.queuedForNextGame = nextQueuedForNextGame;
        changed = true;
      }
      if (participant.isReady !== true) {
        participant.isReady = true;
        changed = true;
      }
    }
  } else if (action === "unready") {
    if (participant.isReady === true) {
      participant.isReady = false;
      changed = true;
    }
    if (!shouldQueueParticipantForNextGame(session) && participant.queuedForNextGame === true) {
      participant.queuedForNextGame = false;
      changed = true;
    }
  }

  if (!isParticipantSeated(participant) && participant.isReady === true) {
    participant.isReady = false;
    changed = true;
  }
  participant.lastHeartbeatAt = now;
  markSessionActivity(session, playerId, now);

  if (changed) {
    ensureSessionTurnState(session);
    reconcileSessionLoops(sessionId);
    broadcastSessionState(session, `participant_${action}`);
    const actorName = participant.displayName || participant.playerId;
    const actionMessageMap = {
      sit:
        participant.queuedForNextGame === true
          ? `${actorName} sat down and is waiting for the next game.`
          : `${actorName} sat down.`,
      stand: `${actorName} stood up.`,
      ready:
        participant.queuedForNextGame === true
          ? `${actorName} is ready for the next game.`
          : `${actorName} is ready to play.`,
      unready: `${actorName} is no longer ready.`,
    };
    const actionMessage = actionMessageMap[action];
    if (actionMessage) {
      broadcastSystemRoomChannelMessage(sessionId, {
        topic: "seat_state",
        title: actorName,
        message: actionMessage,
        severity: action === "ready" ? "success" : "info",
        timestamp: now,
      });
    }
  }
  await persistStore();

  sendJson(res, 200, {
    ok: reason === "ok",
    reason,
    state: {
      isSeated: isParticipantSeated(participant),
      isReady: participant.isReady === true,
      queuedForNextGame: isParticipantQueuedForNextGame(participant),
    },
    session: {
      ...buildSessionSnapshot(session),
      serverNow: now,
    },
  });
}

async function handleUpdateSessionDemoControls(req, res, pathname) {
  const sessionId = decodeURIComponent(pathname.split("/")[4] ?? "").trim();
  if (!sessionId) {
    sendJson(res, 400, { error: "Invalid session ID", reason: "invalid_session_id" });
    return;
  }

  let session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    await rehydrateStoreFromAdapter(`demo_controls_session:${sessionId}`, { force: true });
    session = store.multiplayerSessions[sessionId];
  }
  if (!session || session.expiresAt <= Date.now()) {
    sendJson(res, 410, { error: "Session expired", reason: "session_expired" });
    return;
  }

  const body = await parseJsonBody(req);
  const requestedPlayerId = typeof body?.playerId === "string" ? body.playerId.trim() : "";
  const action = normalizeDemoControlAction(body?.action);
  if (!action) {
    sendJson(res, 400, { error: "Invalid demo control action", reason: "invalid_action" });
    return;
  }

  let authCheck = authorizeSessionActionRequest(req, undefined, sessionId);
  if (!authCheck.ok && shouldRetrySessionAuthFromStore(authCheck.reason)) {
    await rehydrateStoreFromAdapter(
      `demo_controls_auth:${sessionId}:${requestedPlayerId || "unknown"}`,
      { force: true }
    );
    authCheck = authorizeSessionActionRequest(req, undefined, sessionId);
  }
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized", reason: authCheck.reason ?? "unauthorized" });
    return;
  }
  const authenticatedPlayerId =
    typeof authCheck.playerId === "string" ? authCheck.playerId.trim() : "";
  const playerId =
    authenticatedPlayerId ||
    requestedPlayerId;
  if (!playerId) {
    sendJson(res, 400, { error: "playerId is required", reason: "invalid_player_id" });
    return;
  }
  const participant = session.participants?.[playerId];
  if (!participant || isBotParticipant(participant)) {
    sendJson(res, 404, { error: "Unknown player", reason: "unknown_player" });
    return;
  }

  if (getSessionRoomKind(session) !== ROOM_KINDS.private) {
    sendJson(res, 409, { error: "Demo controls are private-room only", reason: "room_not_private" });
    return;
  }
  const ownerPlayerId = ensureSessionOwner(session);
  if (!ownerPlayerId || ownerPlayerId !== playerId) {
    sendJson(res, 403, { error: "Only room owner can control demo", reason: "not_room_owner" });
    return;
  }
  const now = Date.now();
  let changed = false;
  let didRestartAutoRun = false;
  let seededBotCount = getBotParticipants(session).length;

  if (session.demoMode !== true) {
    session.demoMode = true;
    changed = true;
  }
  if (action === "pause") {
    if (session.demoAutoRun !== false) {
      session.demoAutoRun = false;
      changed = true;
    }
  } else if (action === "resume") {
    if (session.demoAutoRun !== true) {
      session.demoAutoRun = true;
      changed = true;
    }
    if (participant.isSeated === true) {
      participant.isSeated = false;
      changed = true;
    }
    if (participant.isReady === true) {
      participant.isReady = false;
      changed = true;
    }
    if (participant.queuedForNextGame === true) {
      participant.queuedForNextGame = false;
      changed = true;
    }

    const seatedHumanCount = getSeatedHumanParticipantCount(session);
    const availableSeatCount = Math.max(0, MAX_MULTIPLAYER_HUMAN_PLAYERS - seatedHumanCount);
    const targetBotCount =
      availableSeatCount > 0
        ? Math.max(1, Math.min(MAX_MULTIPLAYER_BOTS, availableSeatCount))
        : 0;
    const botPrune = pruneSessionBots(sessionId, session, {
      removeAll: true,
      now,
    });
    if (botPrune.changed) {
      changed = true;
    }
    const addedBotCount = addBotsToSession(session, targetBotCount, now);
    if (addedBotCount > 0) {
      changed = true;
    }

    const restarted = resetSessionForNextGame(session, now);
    if (restarted) {
      changed = true;
    } else {
      session.gameStartedAt = now;
      session.turnState = null;
      ensureSessionTurnState(session);
      changed = true;
    }
    const normalizedBots = normalizeSessionBotsForAutoRun(session, now);
    if (normalizedBots.changed) {
      changed = true;
    }
    seededBotCount = normalizedBots.count;
    didRestartAutoRun = true;
  } else if (action === "speed_fast") {
    if (session.demoSpeedMode !== true) {
      session.demoSpeedMode = true;
      changed = true;
    }
  } else if (action === "speed_normal") {
    if (session.demoSpeedMode !== false) {
      session.demoSpeedMode = false;
      changed = true;
    }
  }

  participant.lastHeartbeatAt = now;
  markSessionActivity(session, playerId, now);
  ensureSessionTurnState(session);

  if (changed) {
    resetSessionBotLoopSchedule(sessionId);
    reconcileSessionLoops(sessionId);
    const isRunning = isSessionDemoAutoRunEnabled(session);
    const speedLabel = isSessionDemoFastMode(session) ? "fast" : "normal";
    broadcastSystemRoomChannelMessage(sessionId, {
      topic: "demo_control",
      title: participant.displayName || participant.playerId,
      message:
        action === "pause"
          ? "Demo paused by host."
          : action === "resume"
            ? `Demo restarted with ${seededBotCount} bot${seededBotCount === 1 ? "" : "s"}.`
            : `Demo speed set to ${speedLabel}.`,
      severity: "info",
      timestamp: now,
    });
    if (didRestartAutoRun && isRunning) {
      const nextTurnStart = buildTurnStartMessage(session, {
        source: "demo_restart",
      });
      if (nextTurnStart) {
        broadcastToSession(sessionId, JSON.stringify(nextTurnStart), null);
      }
    }
    broadcastSessionState(session, "demo_controls");
  }

  await persistStore();
  sendJson(res, 200, {
    ok: true,
    controls: {
      demoMode: isDemoModeSession(session),
      demoAutoRun: isSessionDemoAutoRunEnabled(session),
      demoSpeedMode: isSessionDemoFastMode(session),
    },
    session: {
      ...buildSessionSnapshot(session),
      serverNow: now,
    },
  });
}

async function handleQueueParticipantForNextGame(req, res, pathname) {
  const sessionId = decodeURIComponent(pathname.split("/")[4]);
  let session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    session = await rehydrateSessionWithRetry(sessionId, "queue_next_session", {
      attempts: 6,
      baseDelayMs: 150,
    });
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
    await rehydrateStoreFromAdapter(`queue_next_participant:${sessionId}:${playerId || "unknown"}`, {
      force: true,
    });
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

  let authCheck = authorizeSessionActionRequest(req, playerId, sessionId);
  if (!authCheck.ok && shouldRetrySessionAuthFromStore(authCheck.reason)) {
    await rehydrateStoreFromAdapter(`queue_next_auth:${sessionId}:${playerId}`, { force: true });
    authCheck = authorizeSessionActionRequest(req, playerId, sessionId);
  }
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized", reason: authCheck.reason ?? "unauthorized" });
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

  if (!isParticipantSeated(participant)) {
    sendJson(res, 200, {
      ok: false,
      queuedForNextGame: false,
      reason: "not_seated",
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
    await rehydrateStoreFromAdapter(`leave_session:${sessionId}:${playerId}`, { force: true });
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

async function handleModerateSessionParticipant(req, res, pathname) {
  const sessionId = decodeURIComponent(pathname.split("/")[4] ?? "").trim();
  if (!sessionId) {
    sendJson(res, 400, {
      error: "Invalid session ID",
      reason: "invalid_session_id",
    });
    return;
  }

  let session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    await rehydrateStoreFromAdapter(`moderate_session:${sessionId}`, { force: true });
    session = store.multiplayerSessions[sessionId];
  }
  if (!session || session.expiresAt <= Date.now()) {
    sendJson(res, 410, {
      error: "Session expired",
      reason: "session_expired",
    });
    return;
  }

  const body = await parseJsonBody(req);
  const requesterPlayerId =
    typeof body?.requesterPlayerId === "string" ? body.requesterPlayerId.trim() : "";
  const targetPlayerId =
    typeof body?.targetPlayerId === "string" ? body.targetPlayerId.trim() : "";
  const actionRaw = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  const action = SESSION_MODERATION_ACTIONS.has(actionRaw) ? actionRaw : "";
  if (!requesterPlayerId) {
    sendJson(res, 400, {
      error: "requesterPlayerId is required",
      reason: "invalid_requester_player_id",
    });
    return;
  }
  if (!targetPlayerId) {
    sendJson(res, 400, {
      error: "targetPlayerId is required",
      reason: "invalid_target_player_id",
    });
    return;
  }
  if (!action) {
    sendJson(res, 400, {
      error: "Invalid moderation action",
      reason: "invalid_moderation_action",
    });
    return;
  }
  if (requesterPlayerId === targetPlayerId) {
    sendJson(res, 409, {
      error: "Cannot moderate self",
      reason: "cannot_moderate_self",
    });
    return;
  }

  if (getSessionRoomKind(session) === ROOM_KINDS.private) {
    ensureSessionOwner(session);
  }
  const requesterParticipant = session.participants?.[requesterPlayerId] ?? null;
  const requesterAuth = authorizeSessionActionRequest(req, requesterPlayerId, sessionId);
  const requesterIsOwner =
    requesterAuth.ok &&
    requesterParticipant &&
    !isBotParticipant(requesterParticipant) &&
    getSessionOwnerPlayerId(session) === requesterPlayerId;
  let moderatorRole = requesterIsOwner ? "owner" : null;
  let adminAuth = null;

  if (!moderatorRole) {
    adminAuth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.operator });
    if (adminAuth.ok) {
      moderatorRole = "admin";
    }
  }

  if (!moderatorRole) {
    if (requesterAuth.ok && requesterParticipant && !isBotParticipant(requesterParticipant)) {
      sendJson(res, 403, {
        error: "Only room owner can moderate participants",
        reason: "not_room_owner",
      });
      return;
    }
    sendJson(res, adminAuth?.status ?? 401, {
      error: "Unauthorized",
      reason: adminAuth?.reason ?? "unauthorized",
    });
    return;
  }

  const now = Date.now();
  const targetParticipant = session.participants?.[targetPlayerId] ?? null;
  if (!targetParticipant && action === "kick") {
    sendJson(res, 404, {
      error: "Target player not found in session",
      reason: "unknown_player",
    });
    return;
  }

  const actorName = resolveModerationActorDisplayName({
    requesterPlayerId,
    requesterParticipant,
    moderatorRole,
    adminAuth,
  });
  const targetLabel =
    typeof targetParticipant?.displayName === "string" && targetParticipant.displayName.trim().length > 0
      ? targetParticipant.displayName.trim()
      : targetPlayerId;
  if (action === "ban") {
    upsertSessionRoomBan(session, targetPlayerId, {
      bannedAt: now,
      bannedByPlayerId: requesterPlayerId,
      bannedByRole: moderatorRole,
    });
  }

  let removal = {
    ok: true,
    roomInventoryChanged: false,
    sessionExpired: false,
  };
  if (targetParticipant) {
    removal = removeParticipantFromSession(sessionId, targetPlayerId, {
      source: action === "ban" ? "moderation_ban" : "moderation_kick",
      socketReason: action === "ban" ? "banned_from_room" : "removed_by_moderator",
    });
    if (!removal.ok) {
      const status =
        removal.reason === "unknown_session" || removal.reason === "unknown_player" ? 404 : 409;
      sendJson(res, status, {
        error: "Failed to moderate participant",
        reason: removal.reason,
      });
      return;
    }
  }

  const updatedSession = store.multiplayerSessions[sessionId];
  if (updatedSession) {
    markSessionActivity(updatedSession, requesterPlayerId, now, {
      countAsPlayerAction: false,
    });
    reconcileSessionLoops(sessionId);
    broadcastSystemRoomChannelMessage(sessionId, {
      topic: action === "ban" ? "moderation_ban" : "moderation_kick",
      title: "Room Moderation",
      message:
        action === "ban"
          ? `${targetLabel} was banned from the room by ${actorName}.`
          : `${targetLabel} was removed from the room by ${actorName}.`,
      severity: action === "ban" ? "warning" : "info",
      timestamp: now,
    });
  }

  if (moderatorRole === "admin" && adminAuth?.ok) {
    recordAdminAuditEvent(adminAuth, "participant_remove", {
      summary: `${action} ${targetPlayerId} in ${sessionId}`,
      sessionId,
      playerId: targetPlayerId,
      action,
      roomInventoryChanged: removal.roomInventoryChanged === true,
      sessionExpired: removal.sessionExpired === true,
    });
  }

  await persistStore();

  sendJson(res, 200, {
    ok: true,
    action,
    targetPlayerId,
    moderatedBy: {
      playerId: requesterPlayerId,
      role: moderatorRole,
    },
    roomInventoryChanged: removal.roomInventoryChanged === true,
    sessionExpired: removal.sessionExpired === true,
    session: updatedSession
      ? {
          ...buildSessionSnapshot(updatedSession),
          serverNow: now,
        }
      : null,
  });
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
  if (session.chatConductState?.players && typeof session.chatConductState.players === "object") {
    delete session.chatConductState.players[playerId];
  }
  const removedOwner =
    typeof session.ownerPlayerId === "string" && session.ownerPlayerId.trim() === playerId;
  if (removedOwner) {
    ensureSessionOwner(session);
  }
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
  const body = await parseJsonBody(req);
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!playerId) {
    sendJson(res, 400, { error: "playerId is required" });
    return;
  }

  let session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    session = await rehydrateSessionWithRetry(sessionId, "refresh_auth_session", {
      attempts: 7,
      baseDelayMs: 200,
    });
  }
  if (!session) {
    sendJson(res, 410, { error: "Session expired", reason: "session_expired" });
    return;
  }

  let participant = session.participants[playerId];
  if (!participant) {
    const recovered = await rehydrateSessionParticipantWithRetry(
      sessionId,
      playerId,
      "refresh_auth_participant",
      {
        attempts: 7,
        baseDelayMs: 200,
      }
    );
    session = recovered.session;
    participant = recovered.participant;
  }

  if (!session || !participant) {
    sendJson(res, 404, { error: "Player not in session" });
    return;
  }

  // During high write load with external storage, session expiry can be observed transiently.
  // Allow an authenticated participant refresh to revive liveness instead of hard-expiring.
  const sessionExpired =
    !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now();
  if (sessionExpired) {
    let authCheck = authorizeSessionActionRequest(req, playerId, sessionId);
    if (!authCheck.ok && shouldRetrySessionAuthFromStore(authCheck.reason)) {
      const recovered = await rehydrateSessionParticipantWithRetry(
        sessionId,
        playerId,
        "refresh_auth_expired_retry",
        {
          attempts: 5,
          baseDelayMs: 160,
        }
      );
      session = recovered.session;
      participant = recovered.participant;
      authCheck = authorizeSessionActionRequest(req, playerId, sessionId);
    }
    if (!session || !participant || !authCheck.ok) {
      sendJson(res, 410, { error: "Session expired", reason: "session_expired" });
      return;
    }
  }

  let authCheck = authorizeSessionActionRequest(req, playerId, sessionId);
  if (!authCheck.ok && shouldRetrySessionAuthFromStore(authCheck.reason)) {
    const recovered = await rehydrateSessionParticipantWithRetry(
      sessionId,
      playerId,
      "refresh_auth_authorize",
      {
        attempts: 5,
        baseDelayMs: 160,
      }
    );
    session = recovered.session;
    participant = recovered.participant;
    authCheck = authorizeSessionActionRequest(req, playerId, sessionId);
  }
  if (!session || !participant) {
    sendJson(res, 404, { error: "Player not in session" });
    return;
  }
  if (!authCheck.ok) {
    sendJson(res, 401, { error: "Unauthorized", reason: authCheck.reason ?? "unauthorized" });
    return;
  }

  const now = Date.now();
  if (participant && typeof participant === "object") {
    participant.lastHeartbeatAt = now;
  }
  // Token refresh is an authenticated presence signal and should keep the participant active,
  // including post-game queue windows.
  markSessionActivity(session, playerId, now);
  reconcileSessionLoops(sessionId);

  const auth = issueAuthTokenBundle(playerId, sessionId);
  const response = buildSessionResponse(session, playerId, auth);
  await persistStore();
  sendJson(res, 200, response);
}

async function rehydrateSessionWithRetry(sessionId, reasonPrefix, options = {}) {
  const normalizedSessionId =
    typeof sessionId === "string" ? sessionId.trim() : "";
  if (!normalizedSessionId) {
    return null;
  }
  const attempts = Number.isFinite(options.attempts)
    ? Math.max(1, Math.floor(options.attempts))
    : 3;
  const baseDelayMs = Number.isFinite(options.baseDelayMs)
    ? Math.max(0, Math.floor(options.baseDelayMs))
    : 100;

  let session = store.multiplayerSessions[normalizedSessionId] ?? null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (session) {
      return session;
    }
    if (attempt > 0 && baseDelayMs > 0) {
      await delayMs(baseDelayMs * attempt);
    }
    await rehydrateStoreFromAdapter(`${reasonPrefix}:${normalizedSessionId}:attempt_${attempt + 1}`, {
      force: true,
    });
    session = store.multiplayerSessions[normalizedSessionId] ?? null;
  }
  return session;
}

async function rehydrateSessionParticipantWithRetry(sessionId, playerId, reasonPrefix, options = {}) {
  const normalizedSessionId =
    typeof sessionId === "string" ? sessionId.trim() : "";
  const normalizedPlayerId =
    typeof playerId === "string" ? playerId.trim() : "";
  if (!normalizedSessionId || !normalizedPlayerId) {
    return {
      session: null,
      participant: null,
    };
  }
  const attempts = Number.isFinite(options.attempts)
    ? Math.max(1, Math.floor(options.attempts))
    : 3;
  const baseDelayMs = Number.isFinite(options.baseDelayMs)
    ? Math.max(0, Math.floor(options.baseDelayMs))
    : 100;

  let session = store.multiplayerSessions[normalizedSessionId] ?? null;
  let participant = session?.participants?.[normalizedPlayerId] ?? null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (session && participant) {
      return {
        session,
        participant,
      };
    }
    if (attempt > 0 && baseDelayMs > 0) {
      await delayMs(baseDelayMs * attempt);
    }
    await rehydrateStoreFromAdapter(
      `${reasonPrefix}:${normalizedSessionId}:${normalizedPlayerId}:attempt_${attempt + 1}`,
      { force: true }
    );
    session = store.multiplayerSessions[normalizedSessionId] ?? null;
    participant = session?.participants?.[normalizedPlayerId] ?? null;
  }
  return {
    session,
    participant,
  };
}

async function delayMs(durationMs) {
  const delay = Number.isFinite(durationMs)
    ? Math.max(0, Math.floor(durationMs))
    : 0;
  if (delay <= 0) {
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
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

async function handleAdminModerationTermsOverview(req, res, url) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.operator });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  const now = Date.now();
  const includeTerms = url.searchParams.get("includeTerms") === "1";
  const limit = parseAdminModerationTermLimit(url.searchParams.get("limit"));
  const snapshot = CHAT_CONDUCT_TERM_SERVICE.getSnapshot(now);

  sendJson(res, 200, {
    timestamp: now,
    accessMode: auth.mode,
    principal: buildAdminPrincipal(auth),
    policy: buildAdminChatConductPolicySummary(now),
    terms: {
      remoteConfigured: snapshot.remoteConfigured,
      seedTermCount: snapshot.seedTermCount,
      managedTermCount: snapshot.managedTermCount,
      remoteTermCount: snapshot.remoteTermCount,
      activeTermCount: snapshot.activeTermCount,
      lastRemoteSyncAt: snapshot.lastRemoteSyncAt,
      lastRemoteAttemptAt: snapshot.lastRemoteAttemptAt,
      lastRemoteError: snapshot.lastRemoteError,
      remoteSyncStaleMs: snapshot.remoteSyncStaleMs,
      refreshIntervalMs: CHAT_CONDUCT_TERM_SERVICE_REFRESH_MS,
      policy: snapshot.policy,
      ...(includeTerms
        ? {
            seedTerms: snapshot.seedTerms.slice(0, limit),
            managedTerms: snapshot.managedTerms.slice(0, limit),
            remoteTerms: snapshot.remoteTerms.slice(0, limit),
            activeTerms: snapshot.activeTerms.slice(0, limit),
          }
        : {}),
    },
  });
}

async function handleAdminUpsertModerationTerm(req, res) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.operator });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  const body = await parseJsonBody(req);
  const term = typeof body?.term === "string" ? body.term : "";
  const enabled = body?.enabled !== false;
  const note = typeof body?.note === "string" ? body.note : "";
  const now = Date.now();
  const upsertResult = CHAT_CONDUCT_TERM_SERVICE.upsertManagedTerm(term, {
    enabled,
    note,
    addedBy:
      typeof auth.uid === "string" && auth.uid.trim().length > 0
        ? auth.uid.trim()
        : `admin:${auth.authType ?? "unknown"}`,
    timestamp: now,
  });
  if (!upsertResult.ok) {
    const status = upsertResult.reason === "max_terms_reached" ? 409 : 400;
    sendJson(res, status, {
      error: "Invalid moderation term",
      reason: upsertResult.reason,
    });
    return;
  }

  recordAdminAuditEvent(auth, "moderation_term_upsert", {
    summary: `${upsertResult.created ? "Added" : "Updated"} moderation term ${upsertResult.term}`,
    term: upsertResult.term,
    enabled: upsertResult.record?.enabled !== false,
    created: upsertResult.created === true,
  });
  await persistStore();

  sendJson(res, 200, {
    ok: true,
    term: upsertResult.term,
    created: upsertResult.created === true,
    record: upsertResult.record,
    policy: buildAdminChatConductPolicySummary(now),
    terms: CHAT_CONDUCT_TERM_SERVICE.getSnapshot(now),
    principal: buildAdminPrincipal(auth),
  });
}

async function handleAdminRemoveModerationTerm(req, res) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.operator });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  const body = await parseJsonBody(req);
  const term = typeof body?.term === "string" ? body.term : "";
  const removeResult = CHAT_CONDUCT_TERM_SERVICE.removeManagedTerm(term);
  if (!removeResult.ok) {
    sendJson(res, 400, {
      error: "Invalid moderation term",
      reason: removeResult.reason,
    });
    return;
  }

  const now = Date.now();
  recordAdminAuditEvent(auth, "moderation_term_remove", {
    summary: `Removed moderation term ${removeResult.term}`,
    term: removeResult.term,
    removed: removeResult.removed === true,
  });
  await persistStore();

  sendJson(res, 200, {
    ok: true,
    term: removeResult.term,
    removed: removeResult.removed === true,
    policy: buildAdminChatConductPolicySummary(now),
    terms: CHAT_CONDUCT_TERM_SERVICE.getSnapshot(now),
    principal: buildAdminPrincipal(auth),
  });
}

async function handleAdminRefreshModerationTerms(req, res) {
  const auth = await authorizeAdminRequest(req, { minimumRole: ADMIN_ROLES.operator });
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: "Unauthorized",
      reason: auth.reason,
    });
    return;
  }

  const refresh = await refreshChatModerationTermsFromRemote({
    source: "admin_refresh",
    persistOnChange: false,
    persistOnNoChange: false,
  });
  if (!refresh.ok) {
    const status =
      refresh.reason === "remote_not_configured"
        ? 409
        : refresh.reason === "fetch_unavailable"
          ? 500
          : 502;
    sendJson(res, status, {
      error: "Failed to refresh moderation terms",
      reason: refresh.reason,
      details: refresh,
    });
    return;
  }

  const now = Date.now();
  recordAdminAuditEvent(auth, "moderation_term_refresh", {
    summary: `Refreshed moderation terms (${refresh.remoteTermCount ?? 0} remote terms)`,
    changed: refresh.changed === true,
    remoteTermCount: refresh.remoteTermCount ?? 0,
    activeTermCount: refresh.activeTermCount ?? 0,
  });
  await persistStore();

  sendJson(res, 200, {
    ok: true,
    refresh,
    policy: buildAdminChatConductPolicySummary(now),
    terms: CHAT_CONDUCT_TERM_SERVICE.getSnapshot(now),
    principal: buildAdminPrincipal(auth),
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

async function handleAdminSessionConductState(req, res, pathname, url) {
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

  const now = Date.now();
  const state = ensureSessionChatConductState(session, now);
  const limit = parseAdminConductLimit(url.searchParams.get("limit"));
  const players = Object.entries(state.players)
    .map(([playerId, record]) => buildAdminChatConductPlayerRecord(session, playerId, record, now))
    .filter((entry) => entry !== null)
    .sort((left, right) => Number(right.lastViolationAt ?? 0) - Number(left.lastViolationAt ?? 0))
    .slice(0, limit);

  sendJson(res, 200, {
    timestamp: now,
    sessionId,
    roomCode: session.roomCode,
    policy: buildAdminChatConductPolicySummary(),
    totalPlayerRecords: Object.keys(state.players).length,
    players,
    principal: buildAdminPrincipal(auth),
  });
}

async function handleAdminSessionConductPlayer(req, res, pathname) {
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
  const playerId = decodeURIComponent(segments[7] ?? "").trim();
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

  const session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    sendJson(res, 404, {
      error: "Session not found",
      reason: "unknown_session",
    });
    return;
  }

  const now = Date.now();
  const state = ensureSessionChatConductState(session, now);
  const record = state.players[playerId];
  if (!record) {
    sendJson(res, 404, {
      error: "Conduct player record not found",
      reason: "conduct_player_not_found",
    });
    return;
  }

  const player = buildAdminChatConductPlayerRecord(session, playerId, record, now);
  if (!player) {
    sendJson(res, 404, {
      error: "Conduct player record not found",
      reason: "conduct_player_not_found",
    });
    return;
  }

  sendJson(res, 200, {
    timestamp: now,
    sessionId,
    roomCode: session.roomCode,
    policy: buildAdminChatConductPolicySummary(),
    player,
    principal: buildAdminPrincipal(auth),
  });
}

async function handleAdminClearSessionConductPlayer(req, res, pathname) {
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
  const playerId = decodeURIComponent(segments[7] ?? "").trim();
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

  const session = store.multiplayerSessions[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    sendJson(res, 404, {
      error: "Session not found",
      reason: "unknown_session",
    });
    return;
  }

  const body = await parseJsonBody(req);
  const resetTotalStrikes = body?.resetTotalStrikes === true;
  const now = Date.now();
  const state = ensureSessionChatConductState(session, now);
  const existingRecord = state.players[playerId];
  const hadRecord = Boolean(existingRecord);
  if (existingRecord && typeof existingRecord === "object") {
    existingRecord.strikeEvents = [];
    existingRecord.lastViolationAt = 0;
    existingRecord.mutedUntil = 0;
    if (resetTotalStrikes) {
      existingRecord.totalStrikes = 0;
    }
  }
  session.chatConductState = normalizeChatConductState(state, CHAT_CONDUCT_BASE_POLICY, now);
  const updatedPlayer = buildAdminChatConductPlayerRecord(
    session,
    playerId,
    session.chatConductState?.players?.[playerId],
    now
  );

  recordAdminAuditEvent(auth, "session_conduct_clear_player", {
    summary: `Cleared chat conduct state for ${playerId} in ${sessionId}`,
    sessionId,
    playerId,
    hadRecord,
    resetTotalStrikes,
  });
  await persistStore();

  sendJson(res, 200, {
    ok: true,
    sessionId,
    playerId,
    hadRecord,
    resetTotalStrikes,
    player: updatedPlayer,
    principal: buildAdminPrincipal(auth),
  });
}

async function handleAdminClearSessionConductState(req, res, pathname) {
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

  const now = Date.now();
  const state = ensureSessionChatConductState(session, now);
  const clearedPlayerCount = Object.keys(state.players).length;
  state.players = {};
  session.chatConductState = normalizeChatConductState(state, CHAT_CONDUCT_BASE_POLICY, now);

  recordAdminAuditEvent(auth, "session_conduct_clear_all", {
    summary: `Cleared chat conduct state for ${sessionId}`,
    sessionId,
    clearedPlayerCount,
  });
  await persistStore();

  sendJson(res, 200, {
    ok: true,
    sessionId,
    clearedPlayerCount,
    principal: buildAdminPrincipal(auth),
  });
}

function getChatConductPolicy() {
  return {
    ...CHAT_CONDUCT_BASE_POLICY,
    bannedTerms: CHAT_CONDUCT_TERM_SERVICE.getActiveTerms(),
  };
}

function ensureModerationStoreSection() {
  if (
    !store.moderation ||
    typeof store.moderation !== "object" ||
    Array.isArray(store.moderation)
  ) {
    store.moderation = {};
  }
  return store.moderation;
}

function hydrateChatModerationTermsFromStore() {
  const moderation = ensureModerationStoreSection();
  const persistedState = moderation[MODERATION_STORE_CHAT_TERMS_KEY];
  CHAT_CONDUCT_TERM_SERVICE.hydrateFromStore(persistedState);
}

function exportChatModerationTermsToStore() {
  const moderation = ensureModerationStoreSection();
  moderation[MODERATION_STORE_CHAT_TERMS_KEY] =
    CHAT_CONDUCT_TERM_SERVICE.exportToStoreState();
}

function buildAdminChatConductPolicySummary(now = Date.now()) {
  const policy = getChatConductPolicy();
  const terms = CHAT_CONDUCT_TERM_SERVICE.getSnapshot(now);
  return {
    enabled: policy.enabled,
    filterEnabled: CHAT_CONDUCT_FILTER_ENABLED,
    filterTimeoutMs: CHAT_CONDUCT_FILTER_TIMEOUT_MS,
    filterOnError: CHAT_CONDUCT_FILTER_ON_ERROR,
    senderFilterEnabled: ROOM_CHANNEL_SENDER_FILTER_ENABLED,
    senderFilterTimeoutMs: ROOM_CHANNEL_SENDER_FILTER_TIMEOUT_MS,
    senderFilterOnError: ROOM_CHANNEL_SENDER_FILTER_ON_ERROR,
    directMessageBlockFilterEnabled: DIRECT_MESSAGE_BLOCK_FILTER_ENABLED,
    directMessageBlockFilterTimeoutMs: DIRECT_MESSAGE_BLOCK_FILTER_TIMEOUT_MS,
    directMessageBlockFilterOnError: DIRECT_MESSAGE_BLOCK_FILTER_ON_ERROR,
    publicOnly: policy.publicOnly,
    bannedTermsCount: policy.bannedTerms.size,
    strikeLimit: policy.strikeLimit,
    strikeWindowMs: policy.strikeWindowMs,
    muteDurationMs: policy.muteDurationMs,
    autoBanStrikeLimit: policy.autoBanStrikeLimit,
    managedTermsCount: terms.managedTermCount,
    remoteTermsCount: terms.remoteTermCount,
    remoteConfigured: terms.remoteConfigured,
    lastRemoteSyncAt: terms.lastRemoteSyncAt,
    lastRemoteAttemptAt: terms.lastRemoteAttemptAt,
    lastRemoteError: terms.lastRemoteError,
    termRefreshIntervalMs: CHAT_CONDUCT_TERM_SERVICE_REFRESH_MS,
  };
}

function buildAdminChatConductPlayerRecord(session, playerId, record, now = Date.now()) {
  const normalizedPlayerId = typeof playerId === "string" ? playerId.trim() : "";
  if (!normalizedPlayerId || !record || typeof record !== "object") {
    return null;
  }

  const strikeEvents = Array.isArray(record.strikeEvents)
    ? record.strikeEvents
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value))
        .sort((left, right) => left - right)
    : [];
  const strikeCount = strikeEvents.length;
  const totalStrikesValue = Number(record.totalStrikes);
  const totalStrikes = Number.isFinite(totalStrikesValue)
    ? Math.max(strikeCount, Math.floor(totalStrikesValue))
    : strikeCount;
  const lastViolationAtValue = Number(record.lastViolationAt);
  const lastViolationAt = Number.isFinite(lastViolationAtValue) && lastViolationAtValue > 0
    ? Math.floor(lastViolationAtValue)
    : strikeEvents[strikeEvents.length - 1] ?? null;
  const mutedUntilValue = Number(record.mutedUntil);
  const mutedUntil = Number.isFinite(mutedUntilValue) && mutedUntilValue > 0
    ? Math.floor(mutedUntilValue)
    : null;
  const muteRemainingMs =
    mutedUntil && mutedUntil > now ? Math.max(0, mutedUntil - now) : 0;
  const participant = session?.participants?.[normalizedPlayerId];
  const displayName =
    typeof participant?.displayName === "string" && participant.displayName.trim().length > 0
      ? participant.displayName.trim()
      : null;

  return {
    playerId: normalizedPlayerId,
    displayName,
    participantPresent: Boolean(participant),
    isBot: Boolean(participant && isBotParticipant(participant)),
    strikeCount,
    totalStrikes,
    strikeEvents,
    lastViolationAt,
    mutedUntil,
    isMuted: muteRemainingMs > 0,
    muteRemainingMs,
  };
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
  const conductState = ensureSessionChatConductState(session, now);
  const conductRecords = Object.values(conductState.players ?? {}).filter(
    (record) => record && typeof record === "object"
  );
  const conductMutedPlayerCount = conductRecords.filter((record) => {
    const mutedUntil = Number(record?.mutedUntil);
    return Number.isFinite(mutedUntil) && mutedUntil > now;
  }).length;
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
    conductTrackedPlayerCount: conductRecords.length,
    conductMutedPlayerCount,
    connectedSocketCount: connectedPlayerIds.size,
    hasConnectedHumans,
    participants: participants.map((participant) => ({
      playerId: participant.playerId,
      displayName: participant.displayName,
      avatarUrl: participant.avatarUrl,
      providerId: participant.providerId,
      isBot: participant.isBot,
      isSeated: participant.isSeated === true,
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
          turnTimeoutMs: resolveSessionTurnTimeoutMs(session, turnState.turnTimeoutMs),
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
  let conductTrackedPlayerCount = 0;
  let conductMutedPlayerCount = 0;

  activeSessions.forEach((session) => {
    const participants = serializeSessionParticipants(session);
    const conductState = ensureSessionChatConductState(session, now);
    const conductRecords = Object.values(conductState.players ?? {}).filter(
      (record) => record && typeof record === "object"
    );
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
    conductTrackedPlayerCount += conductRecords.length;
    conductMutedPlayerCount += conductRecords.filter((record) => {
      const mutedUntil = Number(record?.mutedUntil);
      return Number.isFinite(mutedUntil) && mutedUntil > now;
    }).length;
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
    conductTrackedPlayerCount,
    conductMutedPlayerCount,
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

function parseAdminConductLimit(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return ADMIN_CONDUCT_LIST_LIMIT_DEFAULT;
  }
  return Math.max(1, Math.min(ADMIN_CONDUCT_LIST_LIMIT_MAX, Math.floor(parsed)));
}

function parseAdminModerationTermLimit(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return 250;
  }
  return Math.max(1, Math.min(5000, Math.floor(parsed)));
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

function authorizeSessionActionRequest(req, expectedPlayerId, expectedSessionId) {
  const header = req.headers.authorization;
  if (!header) {
    return { ok: false, reason: "missing_authorization_header" };
  }

  const token = extractBearerToken(header);
  if (!token) {
    return { ok: false, reason: "invalid_bearer_header" };
  }

  const record = verifyAccessToken(token);
  if (!record) {
    return { ok: false, reason: "invalid_or_expired_access_token" };
  }

  if (expectedPlayerId && record.playerId !== expectedPlayerId) {
    return { ok: false, reason: "player_mismatch" };
  }
  if (expectedSessionId && record.sessionId !== expectedSessionId) {
    return { ok: false, reason: "session_mismatch" };
  }

  return { ok: true, playerId: record.playerId, sessionId: record.sessionId };
}

function shouldRetrySessionAuthFromStore(reason) {
  return (
    reason === "invalid_or_expired_access_token" ||
    reason === "player_mismatch" ||
    reason === "session_mismatch"
  );
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
    gameConfig: snapshot.gameConfig,
    demoMode: snapshot.demoMode,
    demoAutoRun: snapshot.demoAutoRun,
    demoSpeedMode: snapshot.demoSpeedMode,
    ownerPlayerId: snapshot.ownerPlayerId,
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
  ensureSessionRoomBans(session);
  ensureSessionChatConductState(session);
  const roomKind = getSessionRoomKind(session);
  if (roomKind === ROOM_KINDS.private) {
    ensureSessionOwner(session);
  } else {
    delete session.ownerPlayerId;
  }
  const turnState = ensureSessionTurnState(session);
  const participants = serializeSessionParticipants(session);
  const standings = buildSessionStandings(session);
  const gameStartedAt = resolveSessionGameStartedAt(session);
  const nextGameStartsAt = normalizePostGameTimestamp(session?.nextGameStartsAt);
  const gameConfig = resolveSessionGameConfig(session);
  const humanCount = participants.filter((participant) => !isBotParticipant(participant)).length;
  const activeGameParticipants = participants.filter(
    (participant) => participant.isSeated === true && participant.queuedForNextGame !== true
  );
  const sessionComplete =
    activeGameParticipants.length > 0 &&
    activeGameParticipants.every((participant) => participant.isComplete === true);
  const demoMode = roomKind === ROOM_KINDS.private && session?.demoMode === true;
  const demoAutoRun = demoMode && session?.demoAutoRun !== false;
  const demoSpeedMode = demoMode && session?.demoSpeedMode === true;
  return {
    sessionId: session.sessionId,
    roomCode: session.roomCode,
    gameDifficulty: resolveSessionGameDifficulty(session),
    gameConfig,
    demoMode,
    demoAutoRun,
    demoSpeedMode,
    ownerPlayerId: getSessionOwnerPlayerId(session),
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
  const activeGameHumans = humans.filter(
    (participant) => participant.isSeated === true && participant.queuedForNextGame !== true
  );
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
    (participant) =>
      !isBotParticipant(participant) &&
      participant.isSeated === true &&
      participant.queuedForNextGame !== true
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
    demoMode: false,
    demoAutoRun: false,
    demoSpeedMode: false,
    wsUrl: WS_BASE_URL,
    roomKind: normalizedKind,
    roomBans: {},
    chatConductState: createEmptyChatConductState(),
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
  session.gameConfig = resolveSessionGameConfig(session);
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
  session.roomBans = {};
  session.chatConductState = createEmptyChatConductState();
  delete session.ownerPlayerId;
  session.turnState = null;
  session.demoMode = false;
  session.demoAutoRun = false;
  session.demoSpeedMode = false;
  session.gameDifficulty =
    roomKind === ROOM_KINDS.publicDefault
      ? resolveDefaultPublicRoomDifficulty(normalizedSlot)
      : normalizeGameDifficulty(session.gameDifficulty);
  session.gameConfig = resolveSessionGameConfig(session);
  session.gameStartedAt = now;
  session.lastActivityAt = now;
  session.expiresAt =
    roomKind === ROOM_KINDS.publicDefault
      ? now + MULTIPLAYER_SESSION_IDLE_TTL_MS
      : now + PUBLIC_ROOM_OVERFLOW_EMPTY_TTL_MS;
  ensureSessionTurnState(session);
}

function ensurePublicOverflowRoomCode(sessionId, session, now = Date.now()) {
  if (!session || typeof session !== "object") {
    return false;
  }
  if (getSessionRoomKind(session) !== ROOM_KINDS.publicOverflow) {
    return false;
  }

  const normalizedCode = normalizeOptionalRoomCode(session.roomCode);
  const hasCollision =
    !normalizedCode || isRoomCodeInUse(normalizedCode, now, { excludeSessionId: sessionId });
  if (!hasCollision) {
    return false;
  }

  const reassignedCode = buildPublicOverflowRoomCode();
  if (!reassignedCode || session.roomCode === reassignedCode) {
    return false;
  }
  session.roomCode = reassignedCode;
  return true;
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
      if (ensurePublicOverflowRoomCode(sessionId, session, now)) {
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
      if (ensurePublicOverflowRoomCode(sessionId, session, now)) {
        changed = true;
      }
      changed = true;
      return;
    }

    if (defaultSlots.has(normalizedSlot)) {
      session.roomKind = ROOM_KINDS.publicOverflow;
      delete session.publicRoomSlot;
      if (ensurePublicOverflowRoomCode(sessionId, session, now)) {
        changed = true;
      }
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

function isDemoModeSession(session) {
  if (!session || typeof session !== "object") {
    return false;
  }
  return getSessionRoomKind(session) === ROOM_KINDS.private && session.demoMode === true;
}

function isSessionDemoAutoRunEnabled(session) {
  return isDemoModeSession(session) && session.demoAutoRun !== false;
}

function isSessionDemoFastMode(session) {
  return isDemoModeSession(session) && session.demoSpeedMode === true;
}

function resolveSessionBotTickDelayRange(session) {
  if (isSessionDemoFastMode(session)) {
    return BOT_SPEED_PROFILE_DEFAULTS.fast.tickRangeMs;
  }
  return BOT_TICK_DELAY_RANGE_MS;
}

function resolveSessionBotTickDelayMs(session) {
  const range = resolveSessionBotTickDelayRange(session);
  const min = Math.max(200, Math.floor(range.min));
  const max = Math.max(min, Math.floor(range.max));
  return min + Math.floor(Math.random() * (max - min + 1));
}

function resolveSessionBotTurnDelayMs(session, input = {}) {
  const baseDelay = botEngine.resolveTurnDelayMs(input);
  if (!isSessionDemoFastMode(session)) {
    return baseDelay;
  }
  return Math.max(200, Math.floor(baseDelay * 0.35));
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

function resolveTurnTimeoutMsForDifficulty(difficulty) {
  const normalizedDifficulty = normalizeGameDifficulty(difficulty);
  const configuredTimeoutMs = TURN_TIMEOUT_BY_DIFFICULTY_MS[normalizedDifficulty];
  return normalizeTurnTimeoutMs(configuredTimeoutMs, TURN_TIMEOUT_MS);
}

function resolveSessionTurnTimeoutMs(session, value) {
  const fallbackTimeoutMs = resolveTurnTimeoutMsForDifficulty(resolveSessionGameDifficulty(session));
  const baseTimeoutMs = normalizeTurnTimeoutMs(value, fallbackTimeoutMs);
  if (!isSessionDemoFastMode(session)) {
    return baseTimeoutMs;
  }
  return Math.max(
    DEMO_FAST_TURN_TIMEOUT_MIN_MS,
    Math.floor(baseTimeoutMs * DEMO_FAST_TURN_TIMEOUT_FACTOR)
  );
}

function resolveSessionNextGameStartsAt(session, fallback = Date.now()) {
  const fallbackTimestamp =
    Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : Date.now();
  const scheduledNextGameStartsAt = normalizePostGameTimestamp(session?.nextGameStartsAt);
  if (scheduledNextGameStartsAt !== null) {
    return scheduledNextGameStartsAt;
  }
  return fallbackTimestamp + NEXT_GAME_AUTO_START_DELAY_MS;
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

function buildTurnScoreSummaryFromSelectedDice(lastRollSnapshot, selectedDiceIds, now = Date.now()) {
  const normalizedRoll = normalizeTurnRollSnapshot(lastRollSnapshot);
  if (!normalizedRoll || !Array.isArray(selectedDiceIds) || selectedDiceIds.length === 0) {
    return null;
  }

  const rollById = new Map();
  normalizedRoll.dice.forEach((die) => {
    if (!die || typeof die !== "object" || typeof die.dieId !== "string") {
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
    return null;
  }

  let points = 0;
  const dedupedSelectedDiceIds = [];
  const seen = new Set();
  for (const rawDieId of selectedDiceIds) {
    const dieId = typeof rawDieId === "string" ? rawDieId.trim() : "";
    if (!dieId || seen.has(dieId)) {
      continue;
    }
    const die = rollById.get(dieId);
    if (!die) {
      continue;
    }
    seen.add(dieId);
    dedupedSelectedDiceIds.push(dieId);
    points += die.sides - die.value;
  }
  if (dedupedSelectedDiceIds.length === 0) {
    return null;
  }

  return {
    selectedDiceIds: dedupedSelectedDiceIds,
    points,
    expectedPoints: points,
    rollServerId: normalizedRoll.serverRollId,
    updatedAt: now,
  };
}

function serializeSessionParticipants(session) {
  const sessionCreatedAt = normalizeEpochMs(session?.createdAt, Date.now());
  const participants = Object.values(session?.participants ?? {})
    .filter((participant) => participant && typeof participant.playerId === "string")
    .map((participant) => {
      const joinedAt = normalizeEpochMs(participant.joinedAt, sessionCreatedAt);
      const lastHeartbeatAt = normalizeEpochMs(participant.lastHeartbeatAt, joinedAt);
      const remainingDice = normalizeParticipantRemainingDice(participant.remainingDice);
      const isComplete = participant.isComplete === true || remainingDice === 0;
      const queuedForNextGame = isParticipantQueuedForNextGame(participant);
      const isSeated = isParticipantSeated(participant);
      const isReady = participant.isBot ? true : isSeated && participant.isReady === true;
      return {
        playerId: participant.playerId,
        displayName:
          normalizeParticipantDisplayName(participant.displayName),
        avatarUrl: normalizeAvatarUrl(participant.avatarUrl),
        providerId: normalizeProviderId(participant.providerId),
        joinedAt,
        lastHeartbeatAt,
        isBot: Boolean(participant.isBot),
        botProfile: participant.isBot ? normalizeBotProfile(participant.botProfile) : undefined,
        isSeated,
        isReady,
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
      isSeated: isParticipantSeated(participant),
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
    (participant) => participant.isSeated === true && participant.queuedForNextGame !== true
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
  return sessionTurnController.ensureSessionTurnState(session);
}

function buildTurnStartMessage(session, options = {}) {
  return sessionTurnController.buildTurnStartMessage(session, options);
}

function buildTurnEndMessage(session, playerId, options = {}) {
  return sessionTurnController.buildTurnEndMessage(session, playerId, options);
}

function buildTurnActionMessage(session, playerId, action, details = {}, options = {}) {
  return sessionTurnController.buildTurnActionMessage(
    session,
    playerId,
    action,
    details,
    options
  );
}

function advanceSessionTurn(session, endedByPlayerId, options = {}) {
  return sessionTurnController.advanceSessionTurn(session, endedByPlayerId, options);
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

function normalizeEpochMs(value, fallback = Date.now()) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  const fallbackValue = Number(fallback);
  if (Number.isFinite(fallbackValue) && fallbackValue > 0) {
    return Math.floor(fallbackValue);
  }
  return Date.now();
}

function normalizeParticipantId(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  return normalized.slice(0, 128);
}

function normalizeParticipantDisplayName(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, 48);
}

function normalizeStoreConsistency(now = Date.now()) {
  let changed = false;
  if (!store || typeof store !== "object") {
    store = structuredClone(DEFAULT_STORE);
    return true;
  }
  if (!store.multiplayerSessions || typeof store.multiplayerSessions !== "object") {
    store.multiplayerSessions = {};
    return true;
  }

  const sessionEntries = Object.entries({ ...store.multiplayerSessions });
  for (const [sessionKey, rawSession] of sessionEntries) {
    if (!rawSession || typeof rawSession !== "object") {
      delete store.multiplayerSessions[sessionKey];
      changed = true;
      continue;
    }

    const normalizedSessionId =
      typeof rawSession.sessionId === "string" && rawSession.sessionId.trim().length > 0
        ? rawSession.sessionId.trim()
        : sessionKey;
    if (normalizedSessionId !== sessionKey) {
      store.multiplayerSessions[normalizedSessionId] = rawSession;
      delete store.multiplayerSessions[sessionKey];
      rawSession.sessionId = normalizedSessionId;
      changed = true;
    } else if (rawSession.sessionId !== normalizedSessionId) {
      rawSession.sessionId = normalizedSessionId;
      changed = true;
    }

    const createdAt = normalizeEpochMs(rawSession.createdAt, now);
    if (rawSession.createdAt !== createdAt) {
      rawSession.createdAt = createdAt;
      changed = true;
    }
    const gameStartedAt = normalizeEpochMs(rawSession.gameStartedAt, createdAt);
    if (rawSession.gameStartedAt !== gameStartedAt) {
      rawSession.gameStartedAt = gameStartedAt;
      changed = true;
    }
    const lastActivityAt = normalizeEpochMs(rawSession.lastActivityAt, gameStartedAt);
    if (rawSession.lastActivityAt !== lastActivityAt) {
      rawSession.lastActivityAt = lastActivityAt;
      changed = true;
    }
    const expiresAt = normalizeEpochMs(rawSession.expiresAt, createdAt + MULTIPLAYER_SESSION_IDLE_TTL_MS);
    if (rawSession.expiresAt !== expiresAt) {
      rawSession.expiresAt = expiresAt;
      changed = true;
    }

    const normalizedDifficulty = normalizeGameDifficulty(rawSession.gameDifficulty);
    if (rawSession.gameDifficulty !== normalizedDifficulty) {
      rawSession.gameDifficulty = normalizedDifficulty;
      changed = true;
    }
    const normalizedRoomKind = normalizeRoomKind(rawSession.roomKind);
    if (rawSession.roomKind !== normalizedRoomKind) {
      rawSession.roomKind = normalizedRoomKind;
      changed = true;
    }
    const normalizedDemoMode =
      normalizedRoomKind === ROOM_KINDS.private &&
      (rawSession.demoMode === true || rawSession.demoSpeedMode === true);
    if (rawSession.demoMode !== normalizedDemoMode) {
      rawSession.demoMode = normalizedDemoMode;
      changed = true;
    }
    const normalizedDemoAutoRun = normalizedDemoMode && rawSession.demoAutoRun !== false;
    if (rawSession.demoAutoRun !== normalizedDemoAutoRun) {
      rawSession.demoAutoRun = normalizedDemoAutoRun;
      changed = true;
    }
    const normalizedDemoSpeedMode = normalizedDemoMode && rawSession.demoSpeedMode === true;
    if (rawSession.demoSpeedMode !== normalizedDemoSpeedMode) {
      rawSession.demoSpeedMode = normalizedDemoSpeedMode;
      changed = true;
    }

    const sourceParticipants =
      rawSession.participants && typeof rawSession.participants === "object"
        ? rawSession.participants
        : {};
    if (rawSession.participants !== sourceParticipants) {
      rawSession.participants = sourceParticipants;
      changed = true;
    }

    const normalizedParticipants = {};
    for (const [rawParticipantKey, rawParticipant] of Object.entries(sourceParticipants)) {
      if (!rawParticipant || typeof rawParticipant !== "object") {
        changed = true;
        continue;
      }

      const participantId = normalizeParticipantId(
        typeof rawParticipant.playerId === "string" ? rawParticipant.playerId : rawParticipantKey
      );
      if (!participantId) {
        changed = true;
        continue;
      }

      const participantJoinedAt = normalizeEpochMs(rawParticipant.joinedAt, createdAt);
      const participantLastHeartbeatAt = normalizeEpochMs(rawParticipant.lastHeartbeatAt, participantJoinedAt);
      const isBot = rawParticipant.isBot === true;
      const remainingDice = normalizeParticipantRemainingDice(rawParticipant.remainingDice);
      const normalizedParticipant = {
        ...rawParticipant,
        playerId: participantId,
        joinedAt: participantJoinedAt,
        lastHeartbeatAt: participantLastHeartbeatAt,
        isBot,
        isSeated: isBot ? true : rawParticipant.isSeated !== false,
        isReady: isBot ? true : rawParticipant.isReady === true && rawParticipant.isSeated !== false,
        score: normalizeParticipantScore(rawParticipant.score),
        remainingDice,
        turnTimeoutRound: isBot
          ? null
          : normalizeParticipantTimeoutRound(rawParticipant.turnTimeoutRound),
        turnTimeoutCount: isBot
          ? 0
          : normalizeParticipantTimeoutCount(rawParticipant.turnTimeoutCount),
        queuedForNextGame: isBot ? false : normalizeQueuedForNextGame(rawParticipant.queuedForNextGame),
        isComplete: rawParticipant.isComplete === true || remainingDice === 0,
        completedAt: normalizeParticipantCompletedAt(rawParticipant.completedAt),
      };

      const displayName = normalizeParticipantDisplayName(rawParticipant.displayName);
      if (displayName) {
        normalizedParticipant.displayName = displayName;
      } else {
        delete normalizedParticipant.displayName;
      }
      const avatarUrl = normalizeAvatarUrl(rawParticipant.avatarUrl);
      if (avatarUrl) {
        normalizedParticipant.avatarUrl = avatarUrl;
      } else {
        delete normalizedParticipant.avatarUrl;
      }
      const providerId = normalizeProviderId(rawParticipant.providerId);
      if (providerId) {
        normalizedParticipant.providerId = providerId;
      } else {
        delete normalizedParticipant.providerId;
      }
      const blockedPlayerIds = isBot
        ? []
        : normalizeBlockedPlayerIds(rawParticipant.blockedPlayerIds, participantId);
      if (blockedPlayerIds.length > 0) {
        normalizedParticipant.blockedPlayerIds = blockedPlayerIds;
      } else {
        delete normalizedParticipant.blockedPlayerIds;
      }

      const existing = normalizedParticipants[participantId];
      if (!existing || participantLastHeartbeatAt >= normalizeEpochMs(existing.lastHeartbeatAt, 0)) {
        normalizedParticipants[participantId] = normalizedParticipant;
      } else {
        changed = true;
      }
      if (rawParticipantKey !== participantId) {
        changed = true;
      }
    }

    if (JSON.stringify(sourceParticipants) !== JSON.stringify(normalizedParticipants)) {
      rawSession.participants = normalizedParticipants;
      changed = true;
    }

    const normalizedGameConfig = resolveSessionGameConfig(rawSession);
    if (JSON.stringify(rawSession.gameConfig ?? null) !== JSON.stringify(normalizedGameConfig)) {
      rawSession.gameConfig = normalizedGameConfig;
      changed = true;
    }
  }

  return changed;
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

function normalizeChatTermsRefreshValue(rawValue, fallback) {
  const fallbackValue =
    Number.isFinite(Number(fallback)) && Number(fallback) > 0 ? Math.floor(Number(fallback)) : 0;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.max(5000, Math.min(24 * 60 * 60 * 1000, Math.floor(parsed)));
}

function normalizeAddonFilterTimeoutMs(rawValue, fallback = 0) {
  const fallbackValue =
    Number.isFinite(Number(fallback)) && Number(fallback) > 0 ? Math.floor(Number(fallback)) : 0;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.max(0, Math.min(60 * 1000, Math.floor(parsed)));
}

function normalizeAddonFilterOnErrorMode(rawValue, fallback = "noop") {
  const normalized = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
  if (normalized === "noop" || normalized === "block") {
    return normalized;
  }
  return fallback === "block" ? "block" : "noop";
}

function resolveChatConductTerms(rawValue, fallbackTerms = new Set()) {
  const explicitTerms = parseDelimitedEnvSet(rawValue, (value) => value.toLowerCase());
  if (explicitTerms.size > 0) {
    return explicitTerms;
  }
  return new Set(fallbackTerms);
}

function normalizeMultiplayerSpeedProfileValue(rawValue) {
  const normalized = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
  if (normalized === "fast" || normalized === "demo") {
    return "fast";
  }
  return "normal";
}

function normalizeDelayRangeValue(rawValue, fallback, minimum, maximum) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.max(minimum, Math.min(maximum, Math.floor(fallback)));
  }
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function normalizeDelayRangeFromEnv(rawMinValue, rawMaxValue, fallback, options = {}) {
  const minimum = Number.isFinite(Number(options.minimum))
    ? Math.max(1, Math.floor(Number(options.minimum)))
    : 1;
  const maximum = Number.isFinite(Number(options.maximum))
    ? Math.max(minimum, Math.floor(Number(options.maximum)))
    : 5 * 60 * 1000;
  const fallbackMin = normalizeDelayRangeValue(fallback?.min, minimum, minimum, maximum);
  const fallbackMax = normalizeDelayRangeValue(
    fallback?.max,
    Math.max(fallbackMin, minimum),
    minimum,
    maximum
  );
  const min = normalizeDelayRangeValue(rawMinValue, fallbackMin, minimum, maximum);
  const max = normalizeDelayRangeValue(rawMaxValue, fallbackMax, minimum, maximum);
  return Object.freeze({
    min,
    max: Math.max(min, max),
  });
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

function normalizeTurnStrikeLimitValue(rawValue, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.max(1, Math.floor(fallback));
  }
  return Math.max(1, Math.floor(parsed));
}

function normalizeTurnTimeoutMs(value, fallback = TURN_TIMEOUT_MS) {
  const fallbackParsed = Number(fallback);
  const fallbackMs =
    Number.isFinite(fallbackParsed) && fallbackParsed > 0
      ? Math.max(5000, Math.floor(fallbackParsed))
      : TURN_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
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

function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeGameCreateMode(value, fallback = "multiplayer") {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (GAME_CREATE_MODES.has(normalized)) {
      return normalized;
    }
  }
  return fallback === "demo" || fallback === "solo" ? fallback : "multiplayer";
}

function normalizeGameTimingProfile(value, fallback = "standard") {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (GAME_TIMING_PROFILES.has(normalized)) {
      return normalized;
    }
  }
  return fallback === "demo_fast" || fallback === "test_fast" ? fallback : "standard";
}

function normalizeGameAutomationSpeedMode(value, fallback = "normal") {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (GAME_AUTOMATION_SPEED_MODES.has(normalized)) {
      return normalized;
    }
  }
  return fallback === "fast" ? "fast" : "normal";
}

function resolveDefaultGameCapabilities(mode, roomKind = ROOM_KINDS.private) {
  const hostControls = roomKind === ROOM_KINDS.private;
  if (mode === "solo") {
    return {
      chaos: false,
      gifting: false,
      moderation: false,
      banning: false,
      hostControls: true,
      privateChat: false,
    };
  }
  if (mode === "demo") {
    return {
      chaos: false,
      gifting: false,
      moderation: true,
      banning: true,
      hostControls,
      privateChat: true,
    };
  }
  return {
    chaos: false,
    gifting: false,
    moderation: true,
    banning: true,
    hostControls,
    privateChat: true,
  };
}

function normalizeGameCapabilities(value, mode, roomKind = ROOM_KINDS.private) {
  const defaults = resolveDefaultGameCapabilities(mode, roomKind);
  if (!isObjectRecord(value)) {
    return defaults;
  }
  return {
    chaos: value.chaos === true,
    gifting: value.gifting === true,
    moderation: value.moderation === true,
    banning: value.banning === true,
    hostControls: value.hostControls === true || defaults.hostControls,
    privateChat: value.privateChat === true || defaults.privateChat,
  };
}

function normalizeGameCreateConfig(value, options = {}) {
  const fallbackDifficulty = normalizeGameDifficulty(options?.fallbackDifficulty);
  const fallbackBotCount = normalizeBotCount(options?.fallbackBotCount);
  const fallbackDemoSpeedMode = options?.fallbackDemoSpeedMode === true;
  const fallbackMode = fallbackDemoSpeedMode ? "demo" : normalizeGameCreateMode(options?.fallbackMode);
  const rawConfig = isObjectRecord(value) ? value : {};

  let mode = normalizeGameCreateMode(rawConfig.mode, fallbackMode);
  if (options?.forceMultiplayerMode === true && mode === "solo") {
    mode = "multiplayer";
  }

  const difficulty = normalizeGameDifficulty(
    Object.prototype.hasOwnProperty.call(rawConfig, "difficulty")
      ? rawConfig.difficulty
      : fallbackDifficulty
  );
  const rawAutomation = isObjectRecord(rawConfig.automation) ? rawConfig.automation : {};
  const botCount = Object.prototype.hasOwnProperty.call(rawAutomation, "botCount")
    ? normalizeBotCount(rawAutomation.botCount)
    : fallbackBotCount;
  const speedMode = normalizeGameAutomationSpeedMode(
    Object.prototype.hasOwnProperty.call(rawAutomation, "speedMode")
      ? rawAutomation.speedMode
      : fallbackDemoSpeedMode
        ? "fast"
        : "normal",
    fallbackDemoSpeedMode ? "fast" : "normal"
  );
  const autoRun = Object.prototype.hasOwnProperty.call(rawAutomation, "autoRun")
    ? rawAutomation.autoRun === true
    : mode === "demo";
  const enabled = Object.prototype.hasOwnProperty.call(rawAutomation, "enabled")
    ? rawAutomation.enabled === true
    : mode === "demo" || botCount > 0;
  const timingProfile = normalizeGameTimingProfile(
    rawConfig.timingProfile,
    speedMode === "fast" || mode === "demo" ? "demo_fast" : "standard"
  );
  const capabilities = normalizeGameCapabilities(
    rawConfig.capabilities,
    mode,
    options?.roomKind ?? ROOM_KINDS.private
  );

  return {
    mode,
    difficulty,
    timingProfile,
    capabilities,
    automation: {
      enabled,
      autoRun,
      botCount,
      speedMode,
    },
  };
}

function buildSessionGameConfig(session) {
  const roomKind = getSessionRoomKind(session);
  const mode = isDemoModeSession(session) ? "demo" : "multiplayer";
  const speedMode = isSessionDemoFastMode(session) ? "fast" : "normal";
  const botCount = getBotParticipants(session).length;
  return {
    mode,
    difficulty: resolveSessionGameDifficulty(session),
    timingProfile: speedMode === "fast" ? "demo_fast" : "standard",
    capabilities: resolveDefaultGameCapabilities(mode, roomKind),
    automation: {
      enabled: mode === "demo" || botCount > 0,
      autoRun: isSessionDemoAutoRunEnabled(session),
      botCount,
      speedMode,
    },
  };
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

function normalizeParticipantStateAction(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  return PARTICIPANT_STATE_ACTIONS.has(normalized) ? normalized : "";
}

function normalizeDemoControlAction(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  return DEMO_CONTROL_ACTIONS.has(normalized) ? normalized : "";
}

function isParticipantSeated(participant) {
  if (!participant || typeof participant !== "object") {
    return false;
  }
  if (isBotParticipant(participant)) {
    return true;
  }
  return participant.isSeated !== false;
}

function isParticipantActiveForCurrentGame(participant) {
  return isParticipantSeated(participant) && !isParticipantQueuedForNextGame(participant);
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

function hasOwnProperty(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeUnifiedGameMode(value, fallback = "multiplayer") {
  const fallbackMode = UNIFIED_GAME_MODES.has(fallback) ? fallback : "multiplayer";
  if (typeof value !== "string") {
    return fallbackMode;
  }
  const normalized = value.trim().toLowerCase();
  if (!UNIFIED_GAME_MODES.has(normalized)) {
    return fallbackMode;
  }
  return normalized;
}

function normalizeUnifiedGameTimingProfile(value, fallback = "standard") {
  const fallbackProfile = UNIFIED_GAME_TIMING_PROFILES.has(fallback) ? fallback : "standard";
  if (typeof value !== "string") {
    return fallbackProfile;
  }
  const normalized = value.trim().toLowerCase();
  if (!UNIFIED_GAME_TIMING_PROFILES.has(normalized)) {
    return fallbackProfile;
  }
  return normalized;
}

function normalizeUnifiedAutomationSpeedMode(value, fallback = "normal") {
  const fallbackMode = UNIFIED_GAME_AUTOMATION_SPEED_MODES.has(fallback) ? fallback : "normal";
  if (typeof value !== "string") {
    return fallbackMode;
  }
  const normalized = value.trim().toLowerCase();
  if (!UNIFIED_GAME_AUTOMATION_SPEED_MODES.has(normalized)) {
    return fallbackMode;
  }
  return normalized;
}

function resolveDefaultUnifiedCapabilities(mode) {
  if (mode === "solo") {
    return UNIFIED_GAME_DEFAULT_CAPABILITIES.solo;
  }
  if (mode === "demo") {
    return UNIFIED_GAME_DEFAULT_CAPABILITIES.demo;
  }
  return UNIFIED_GAME_DEFAULT_CAPABILITIES.multiplayer;
}

function normalizeUnifiedCapabilities(value, mode) {
  const defaults = resolveDefaultUnifiedCapabilities(mode);
  if (!isRecord(value)) {
    return {
      chaos: defaults.chaos,
      gifting: defaults.gifting,
      moderation: defaults.moderation,
      banning: defaults.banning,
      hostControls: defaults.hostControls,
      privateChat: defaults.privateChat,
    };
  }

  return {
    chaos: typeof value.chaos === "boolean" ? value.chaos : defaults.chaos,
    gifting: typeof value.gifting === "boolean" ? value.gifting : defaults.gifting,
    moderation: typeof value.moderation === "boolean" ? value.moderation : defaults.moderation,
    banning: typeof value.banning === "boolean" ? value.banning : defaults.banning,
    hostControls:
      typeof value.hostControls === "boolean" ? value.hostControls : defaults.hostControls,
    privateChat: typeof value.privateChat === "boolean" ? value.privateChat : defaults.privateChat,
  };
}

function resolveDefaultUnifiedTimingProfile(mode, speedMode) {
  if (mode === "demo" || speedMode === "fast") {
    return "demo_fast";
  }
  return "standard";
}

function normalizeUnifiedGameConfig(value, options = {}) {
  const rawConfig = isRecord(value) ? value : {};
  const fallbackMode = normalizeUnifiedGameMode(options.fallbackMode, "multiplayer");
  const rawMode = normalizeUnifiedGameMode(rawConfig.mode, fallbackMode);
  const mode = options.allowSoloMode === true || rawMode !== "solo" ? rawMode : "multiplayer";
  const fallbackDifficulty = normalizeGameDifficulty(options.fallbackDifficulty);
  const difficulty = hasOwnProperty(rawConfig, "difficulty")
    ? normalizeGameDifficulty(rawConfig.difficulty)
    : fallbackDifficulty;

  const rawAutomation = isRecord(rawConfig.automation) ? rawConfig.automation : {};
  const fallbackBotCount = normalizeBotCount(options.fallbackBotCount);
  const botCount = hasOwnProperty(rawAutomation, "botCount")
    ? normalizeBotCount(rawAutomation.botCount)
    : fallbackBotCount;
  const fallbackSpeedMode = normalizeUnifiedAutomationSpeedMode(
    options.fallbackSpeedMode,
    mode === "demo" ? "fast" : "normal"
  );
  const speedMode = hasOwnProperty(rawAutomation, "speedMode")
    ? normalizeUnifiedAutomationSpeedMode(rawAutomation.speedMode, fallbackSpeedMode)
    : fallbackSpeedMode;
  const fallbackTimingProfile = normalizeUnifiedGameTimingProfile(
    options.fallbackTimingProfile,
    resolveDefaultUnifiedTimingProfile(mode, speedMode)
  );
  const timingProfile = hasOwnProperty(rawConfig, "timingProfile")
    ? normalizeUnifiedGameTimingProfile(rawConfig.timingProfile, fallbackTimingProfile)
    : fallbackTimingProfile;
  const fallbackAutoRun = options.fallbackAutoRun === true || mode === "demo";
  const autoRun =
    mode === "demo"
      ? true
      : hasOwnProperty(rawAutomation, "autoRun")
        ? rawAutomation.autoRun === true
        : fallbackAutoRun;
  const fallbackEnabled =
    options.fallbackAutomationEnabled === true || mode === "demo" || botCount > 0;
  const enabled = hasOwnProperty(rawAutomation, "enabled")
    ? rawAutomation.enabled === true
    : fallbackEnabled;
  const capabilities = normalizeUnifiedCapabilities(rawConfig.capabilities, mode);

  return {
    mode,
    difficulty,
    timingProfile,
    capabilities,
    automation: {
      enabled,
      autoRun,
      botCount,
      speedMode,
    },
  };
}

function buildUnifiedSessionGameConfig(options = {}) {
  const mode = options.demoMode === true || options.demoSpeedMode === true ? "demo" : "multiplayer";
  const difficulty = normalizeGameDifficulty(options.gameDifficulty);
  const botCount = normalizeBotCount(options.botCount);
  const speedMode = options.demoSpeedMode === true ? "fast" : "normal";
  const normalized = normalizeUnifiedGameConfig(options.gameConfig, {
    fallbackMode: mode,
    fallbackDifficulty: difficulty,
    fallbackBotCount: botCount,
    fallbackSpeedMode: speedMode,
    fallbackTimingProfile:
      options.demoSpeedMode === true ? "demo_fast" : resolveDefaultUnifiedTimingProfile(mode, speedMode),
    fallbackAutoRun: mode === "demo" ? options.demoAutoRun === true : false,
    fallbackAutomationEnabled: mode === "demo" || botCount > 0,
  });
  const resolvedTimingProfile =
    options.demoSpeedMode === true
      ? normalizeUnifiedGameTimingProfile(normalized.timingProfile, "demo_fast")
      : normalizeUnifiedGameTimingProfile(
          normalized.timingProfile,
          resolveDefaultUnifiedTimingProfile(mode, normalized.automation.speedMode)
        );
  const resolvedSpeedMode = normalizeUnifiedAutomationSpeedMode(
    normalized.automation.speedMode,
    options.demoSpeedMode === true ? "fast" : "normal"
  );

  return {
    mode,
    difficulty,
    timingProfile: resolvedTimingProfile,
    capabilities: normalizeUnifiedCapabilities(normalized.capabilities, mode),
    automation: {
      enabled: mode === "demo" || botCount > 0 || normalized.automation.enabled === true,
      autoRun: mode === "demo" ? options.demoAutoRun === true : normalized.automation.autoRun === true,
      botCount,
      speedMode: resolvedSpeedMode,
    },
  };
}

function resolveCreateSessionGameSettings(body) {
  const payload = isRecord(body) ? body : {};
  const requestedConfig = isRecord(payload.gameConfig) ? payload.gameConfig : undefined;
  const requestedConfigNormalized = normalizeUnifiedGameConfig(requestedConfig, {
    fallbackMode: "multiplayer",
    fallbackDifficulty: "normal",
    fallbackBotCount: 0,
    fallbackSpeedMode: "normal",
    fallbackTimingProfile: "standard",
  });
  const resolvedDifficulty = hasOwnProperty(payload, "gameDifficulty")
    ? normalizeGameDifficulty(payload.gameDifficulty)
    : requestedConfigNormalized.difficulty;
  const resolvedBotCount = hasOwnProperty(payload, "botCount")
    ? normalizeBotCount(payload.botCount)
    : requestedConfigNormalized.automation.botCount;
  const resolvedDemoSpeedMode = hasOwnProperty(payload, "demoSpeedMode")
    ? payload.demoSpeedMode === true
    : requestedConfigNormalized.mode === "demo";
  const resolvedDemoMode = resolvedDemoSpeedMode || requestedConfigNormalized.mode === "demo";
  const resolvedDemoAutoRun =
    resolvedDemoMode &&
    (requestedConfigNormalized.automation.autoRun === true ||
      requestedConfigNormalized.mode === "demo");
  const gameConfig = buildUnifiedSessionGameConfig({
    gameDifficulty: resolvedDifficulty,
    botCount: resolvedBotCount,
    demoMode: resolvedDemoMode,
    demoSpeedMode: resolvedDemoSpeedMode,
    demoAutoRun: resolvedDemoAutoRun,
    gameConfig: requestedConfig,
  });

  return {
    gameDifficulty: resolvedDifficulty,
    botCount: resolvedBotCount,
    demoMode: resolvedDemoMode,
    demoAutoRun: resolvedDemoAutoRun,
    demoSpeedMode: resolvedDemoSpeedMode,
    gameConfig,
  };
}

function resolveJoinRequestGameSettings(body) {
  const payload = isRecord(body) ? body : {};
  const requestedConfig = isRecord(payload.gameConfig) ? payload.gameConfig : undefined;
  const requestedConfigNormalized = normalizeUnifiedGameConfig(requestedConfig, {
    fallbackMode: "multiplayer",
    fallbackDifficulty: "normal",
    fallbackBotCount: 0,
    fallbackSpeedMode: "normal",
    fallbackTimingProfile: "standard",
  });
  const requestedDifficulty = hasOwnProperty(payload, "gameDifficulty")
    ? normalizeGameDifficulty(payload.gameDifficulty)
    : requestedConfigNormalized.difficulty;
  const requestedBotCount = hasOwnProperty(payload, "botCount")
    ? normalizeBotCount(payload.botCount)
    : requestedConfigNormalized.automation.botCount;

  return {
    requestedDifficulty,
    requestedBotCount,
  };
}

function countSessionBotParticipants(session) {
  if (!session || typeof session !== "object" || !session.participants || typeof session.participants !== "object") {
    return 0;
  }
  let botCount = 0;
  for (const participant of Object.values(session.participants)) {
    if (isBotParticipant(participant)) {
      botCount += 1;
    }
  }
  return botCount;
}

function resolveSessionGameConfig(session) {
  if (!session || typeof session !== "object") {
    return buildUnifiedSessionGameConfig();
  }
  const roomKind = getSessionRoomKind(session);
  const demoMode = roomKind === ROOM_KINDS.private && session.demoMode === true;
  const demoSpeedMode = demoMode && session.demoSpeedMode === true;
  const demoAutoRun = demoMode && session.demoAutoRun === true;
  return buildUnifiedSessionGameConfig({
    gameDifficulty: resolveSessionGameDifficulty(session),
    botCount: countSessionBotParticipants(session),
    demoMode,
    demoSpeedMode,
    demoAutoRun,
    gameConfig: isRecord(session.gameConfig) ? session.gameConfig : undefined,
  });
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

function normalizeParticipantTimeoutRound(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(parsed));
}

function normalizeParticipantTimeoutCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

function registerParticipantTimeoutStrike(participant, round) {
  if (!participant || typeof participant !== "object" || isBotParticipant(participant)) {
    return 0;
  }
  const normalizedRound = Number.isFinite(round) && round > 0 ? Math.floor(round) : 1;
  const previousRound = normalizeParticipantTimeoutRound(participant.turnTimeoutRound);
  const previousCount = normalizeParticipantTimeoutCount(participant.turnTimeoutCount);
  const nextCount = previousRound === normalizedRound ? previousCount + 1 : 1;
  participant.turnTimeoutRound = normalizedRound;
  participant.turnTimeoutCount = nextCount;
  return nextCount;
}

function clearParticipantTimeoutStrike(participant) {
  if (!participant || typeof participant !== "object" || isBotParticipant(participant)) {
    return;
  }
  participant.turnTimeoutRound = null;
  participant.turnTimeoutCount = 0;
}

function standParticipantIntoObserverMode(participant, timestamp = Date.now()) {
  if (!participant || typeof participant !== "object" || isBotParticipant(participant)) {
    return false;
  }
  const now = Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : Date.now();
  let changed = false;
  if (participant.isSeated !== false) {
    participant.isSeated = false;
    changed = true;
  }
  if (participant.isReady === true) {
    participant.isReady = false;
    changed = true;
  }
  if (participant.queuedForNextGame === true) {
    participant.queuedForNextGame = false;
    changed = true;
  }
  if (participant.isComplete !== true) {
    participant.isComplete = true;
    changed = true;
  }
  if (normalizeParticipantCompletedAt(participant.completedAt) === null) {
    participant.completedAt = now;
    changed = true;
  }
  if (normalizeEpochMs(participant.lastHeartbeatAt, 0) < now) {
    participant.lastHeartbeatAt = now;
    changed = true;
  }
  return changed;
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
  return sessionLifecycleController.isSessionGameInProgress(session);
}

function shouldQueueParticipantForNextGame(session) {
  return sessionLifecycleController.shouldQueueParticipantForNextGame(session);
}

function hasQueuedParticipantsForNextGame(session) {
  return sessionLifecycleController.hasQueuedParticipantsForNextGame(session);
}

function areCurrentGameParticipantsComplete(session) {
  return sessionLifecycleController.areCurrentGameParticipantsComplete(session);
}

function normalizePostGameTimestamp(value) {
  return sessionLifecycleController.normalizePostGameTimestamp(value);
}

function clearSessionPostGameLifecycleState(session) {
  return sessionLifecycleController.clearSessionPostGameLifecycleState(session);
}

function scheduleSessionPostGameLifecycle(session, timestamp = Date.now()) {
  return sessionLifecycleController.scheduleSessionPostGameLifecycle(session, timestamp);
}

function markSessionPostGamePlayerAction(session, timestamp = Date.now()) {
  return sessionLifecycleController.markSessionPostGamePlayerAction(session, timestamp);
}

function resetSessionForNextGame(session, timestamp = Date.now()) {
  return sessionLifecycleController.resetSessionForNextGame(session, timestamp);
}

function completeSessionRoundWithWinner(session, winnerPlayerId, timestamp = Date.now()) {
  return sessionLifecycleController.completeSessionRoundWithWinner(
    session,
    winnerPlayerId,
    timestamp
  );
}

function broadcastRoundWinnerResolved(session, winnerPlayerId, timestamp = Date.now(), source = "winner_complete") {
  if (!session?.participants || typeof winnerPlayerId !== "string" || !winnerPlayerId) {
    return;
  }

  const winnerParticipant = session.participants?.[winnerPlayerId];
  const winnerName =
    typeof winnerParticipant?.displayName === "string" &&
    winnerParticipant.displayName.trim().length > 0
      ? winnerParticipant.displayName.trim()
      : winnerPlayerId;
  const winnerScore = normalizeParticipantScore(winnerParticipant?.score);
  broadcastToSession(
    session.sessionId,
    JSON.stringify({
      type: "player_notification",
      playerId: winnerPlayerId,
      sourcePlayerId: winnerPlayerId,
      title: "Round Winner",
      message: `${winnerName} wins the round`,
      severity: "success",
      timestamp,
      source,
    }),
    null
  );
  broadcastSystemRoomChannelMessage(session.sessionId, {
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
  broadcastSystemRoomChannelMessage(session.sessionId, {
    topic: "next_game_pending",
    title: "Next Game",
    message: `Next game starts in ${nextGameSecondsRemaining}s.`,
    severity: nextGameSecondsRemaining <= 3 ? "warning" : "info",
    timestamp,
  });

  const winnerTurnEnd = buildTurnEndMessage(session, winnerPlayerId, {
    source,
  });
  if (winnerTurnEnd) {
    broadcastToSession(session.sessionId, JSON.stringify(winnerTurnEnd), null);
  }
}

function applyParticipantScoreUpdate(participant, scoreSummary, rollDiceCount) {
  return sessionTurnController.applyParticipantScoreUpdate(
    participant,
    scoreSummary,
    rollDiceCount
  );
}

function processTurnAction(session, playerId, payload) {
  return turnActionController.processTurnAction(session, playerId, payload);
}

function getHumanParticipantCount(session) {
  if (!session?.participants) {
    return 0;
  }
  return Object.values(session.participants).filter((participant) => participant && !isBotParticipant(participant))
    .length;
}

function getSeatedHumanParticipantCount(session) {
  if (!session?.participants) {
    return 0;
  }
  return Object.values(session.participants).filter(
    (participant) =>
      participant &&
      !isBotParticipant(participant) &&
      isParticipantSeated(participant)
  ).length;
}

function getActiveHumanParticipants(session) {
  if (!session?.participants) {
    return [];
  }

  return Object.values(session.participants).filter(
    (participant) =>
      participant &&
      !isBotParticipant(participant) &&
      isParticipantActiveForCurrentGame(participant)
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
    (participant) => participant && isParticipantActiveForCurrentGame(participant)
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

function reconcileSessionNoSeatedTimeoutState(session, now = Date.now()) {
  if (!session || typeof session !== "object") {
    return { changed: false, expired: false };
  }

  if (isDemoModeSession(session)) {
    const sessionId = typeof session.sessionId === "string" ? session.sessionId : "";
    if (sessionId && hasLiveHumanParticipant(sessionId, session, now)) {
      if (Object.prototype.hasOwnProperty.call(session, "noSeatedSince")) {
        delete session.noSeatedSince;
        return { changed: true, expired: false };
      }
      return { changed: false, expired: false };
    }
  }

  const seatedHumans = getSeatedHumanParticipantCount(session);
  if (seatedHumans > 0) {
    if (Object.prototype.hasOwnProperty.call(session, "noSeatedSince")) {
      delete session.noSeatedSince;
      return { changed: true, expired: false };
    }
    return { changed: false, expired: false };
  }

  const normalizedNoSeatedSince = normalizeEpochMs(session.noSeatedSince, now);
  let changed = false;
  if (session.noSeatedSince !== normalizedNoSeatedSince) {
    session.noSeatedSince = normalizedNoSeatedSince;
    changed = true;
  }

  const elapsedMs = Math.max(0, now - normalizedNoSeatedSince);
  return {
    changed,
    expired: elapsedMs >= NO_SEATED_ROOM_TIMEOUT_MS,
  };
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
  const includeObservers = getSessionRoomKind(session) === ROOM_KINDS.private;
  return Object.values(session.participants).some(
    (participant) =>
      participant &&
      !isBotParticipant(participant) &&
      (includeObservers || isParticipantActiveForCurrentGame(participant)) &&
      isSessionParticipantConnected(sessionId, participant.playerId)
  );
}

function hasLiveHumanParticipant(sessionId, session, now = Date.now()) {
  if (!session?.participants) {
    return false;
  }
  const includeObservers = getSessionRoomKind(session) === ROOM_KINDS.private;
  return Object.values(session.participants).some(
    (participant) =>
      participant &&
      !isBotParticipant(participant) &&
      (includeObservers || isParticipantActiveForCurrentGame(participant)) &&
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
      isSeated: true,
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

function normalizeSessionBotsForAutoRun(session, now = Date.now()) {
  if (!session || typeof session !== "object" || !session.participants) {
    return { changed: false, count: 0 };
  }
  const timestamp = Number.isFinite(now) && now > 0 ? Math.floor(now) : Date.now();
  let changed = false;
  let count = 0;

  Object.values(session.participants).forEach((participant) => {
    if (!participant || !isBotParticipant(participant)) {
      return;
    }
    count += 1;

    if (participant.isSeated !== true) {
      participant.isSeated = true;
      changed = true;
    }
    if (participant.isReady !== true) {
      participant.isReady = true;
      changed = true;
    }
    if (participant.queuedForNextGame === true) {
      participant.queuedForNextGame = false;
      changed = true;
    }
    if (participant.isComplete === true) {
      participant.isComplete = false;
      changed = true;
    }
    if (normalizeParticipantCompletedAt(participant.completedAt) !== null) {
      participant.completedAt = null;
      changed = true;
    }
    if (normalizeParticipantScore(participant.score) !== 0) {
      participant.score = 0;
      changed = true;
    }
    if (
      normalizeParticipantRemainingDice(participant.remainingDice, DEFAULT_PARTICIPANT_DICE_COUNT) !==
      DEFAULT_PARTICIPANT_DICE_COUNT
    ) {
      participant.remainingDice = DEFAULT_PARTICIPANT_DICE_COUNT;
      changed = true;
    }
    if (normalizeParticipantTimeoutRound(participant.turnTimeoutRound) !== null) {
      participant.turnTimeoutRound = null;
      changed = true;
    }
    if (normalizeParticipantTimeoutCount(participant.turnTimeoutCount) !== 0) {
      participant.turnTimeoutCount = 0;
      changed = true;
    }
    if (normalizeEpochMs(participant.lastHeartbeatAt, 0) < timestamp) {
      participant.lastHeartbeatAt = timestamp;
      changed = true;
    }
  });

  return {
    changed,
    count,
  };
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

  if (isDemoModeSession(session) && !isSessionDemoAutoRunEnabled(session)) {
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

function resetSessionBotLoopSchedule(sessionId) {
  const loop = botSessionLoops.get(sessionId);
  if (!loop) {
    return;
  }
  if (loop.timer) {
    clearTimeout(loop.timer);
    loop.timer = null;
  }
  if (loop.turnTimer) {
    clearTimeout(loop.turnTimer);
    loop.turnTimer = null;
  }
  loop.scheduledTurnKey = "";
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

  const delay = resolveSessionBotTickDelayMs(session);
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

  const directTargetPlayerId =
    typeof payload.targetPlayerId === "string" ? payload.targetPlayerId.trim() : "";
  if (directTargetPlayerId) {
    if (
      hasRoomChannelBlockRelationship(session, directTargetPlayerId, actor.playerId) ||
      hasRoomChannelBlockRelationship(session, actor.playerId, directTargetPlayerId)
    ) {
      return;
    }
    sendToSessionPlayer(sessionId, directTargetPlayerId, JSON.stringify(payload), null);
    return;
  }

  broadcastRealtimeSocketMessageToSession(session, payload, null);
}

function executeBotTurn(session, activePlayerId) {
  return botTurnController.executeBotTurn(session, activePlayerId);
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
  if (isDemoModeSession(session) && !isSessionDemoAutoRunEnabled(session)) {
    loop.scheduledTurnKey = "";
    return;
  }

  const hasConnectedHuman = hasConnectedHumanParticipant(sessionId, session);
  if (!hasConnectedHuman) {
    loop.scheduledTurnKey = "";
    return;
  }

  const delayMs = resolveSessionBotTurnDelayMs(session, {
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
    if (isDemoModeSession(latestSession) && !isSessionDemoAutoRunEnabled(latestSession)) {
      reconcileSessionLoops(sessionId);
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
  if (isDemoModeSession(session) && !isSessionDemoAutoRunEnabled(session)) {
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

  const timeoutMs = resolveSessionTurnTimeoutMs(session, turnState.turnTimeoutMs);
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

  // If a human participant has been active recently, extend post-game idle instead
  // of hard-expiring the session.
  const now = Date.now();
  const hasRecentlyActiveHuman = Object.values(session.participants ?? {}).some((participant) => {
    if (!participant || isBotParticipant(participant)) {
      return false;
    }
    const lastHeartbeatAt =
      Number.isFinite(participant.lastHeartbeatAt) && participant.lastHeartbeatAt > 0
        ? Math.floor(participant.lastHeartbeatAt)
        : 0;
    return lastHeartbeatAt > 0 && now - lastHeartbeatAt <= MULTIPLAYER_PARTICIPANT_STALE_MS;
  });
  if (hasRecentlyActiveHuman) {
    markSessionPostGamePlayerAction(session, now);
    markSessionActivity(session, "", now, { countAsPlayerAction: false });
    reconcileSessionLoops(sessionId);
    persistStore().catch((error) => {
      log.warn("Failed to persist store after post-game inactivity extension", error);
    });
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
  if (isDemoModeSession(session) && !isSessionDemoAutoRunEnabled(session)) {
    stopPostGameLoop(sessionId);
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
  if (isDemoModeSession(session) && !isSessionDemoAutoRunEnabled(session)) {
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

  const timeoutMs = resolveSessionTurnTimeoutMs(session, turnState.turnTimeoutMs);
  const turnExpiresAt =
    typeof turnState.turnExpiresAt === "number" && Number.isFinite(turnState.turnExpiresAt)
      ? Math.floor(turnState.turnExpiresAt)
      : Date.now() + timeoutMs;
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
      timeoutMs,
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
  if (isDemoModeSession(session) && !isSessionDemoAutoRunEnabled(session)) {
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
  if (!timedOutParticipant) {
    reconcileTurnTimeoutLoop(sessionId);
    return;
  }

  const timeoutNow = Date.now();
  const timeoutRoundScope = resolveSessionGameStartedAt(session, timeoutNow);
  const timeoutTransition = turnTimeoutController.processTurnTimeoutTransition(
    session,
    turnState,
    {
      timedOutPlayerId,
      timeoutNow,
      timeoutRoundScope,
    }
  );
  if (!timeoutTransition.ok) {
    reconcileTurnTimeoutLoop(sessionId);
    return;
  }

  if (timeoutTransition.timeoutScoreAction) {
    broadcastToSession(
      sessionId,
      JSON.stringify(timeoutTransition.timeoutScoreAction),
      null
    );
  }

  if (timeoutTransition.stage === "completed_round") {
    broadcastRoundWinnerResolved(
      session,
      timedOutPlayerId,
      timeoutTransition.timeoutNow,
      "timeout_auto_complete"
    );
    markSessionActivity(session, timedOutPlayerId, timeoutTransition.timeoutNow);
    broadcastSessionState(session, "timeout_auto_complete");
    persistStore().catch((error) => {
      log.warn("Failed to persist session after timeout auto-complete", error);
    });
    reconcileSessionLoops(sessionId);
    return;
  }

  if (timeoutTransition.forcedObserverStand) {
    const timedOutName =
      typeof timedOutParticipant.displayName === "string" && timedOutParticipant.displayName.trim().length > 0
        ? timedOutParticipant.displayName.trim()
        : timedOutPlayerId;
    broadcastSystemRoomChannelMessage(sessionId, {
      topic: "seat_state",
      title: timedOutName,
      message: `${timedOutName} timed out twice and moved to observer lounge.`,
      severity: "warning",
      timestamp: timeoutTransition.timeoutNow,
    });
  }

  turnAdvanceMetrics.timeoutAutoAdvanceCount += 1;

  broadcastToSession(
    sessionId,
    JSON.stringify({
      type: "turn_auto_advanced",
      sessionId,
      playerId: timedOutPlayerId,
      round: timeoutTransition.previousRound,
      turnNumber: timeoutTransition.previousTurnNumber,
      timeoutMs: timeoutTransition.timeoutMs,
      reason: timeoutTransition.timeoutReason,
      timestamp: Date.now(),
      source: "timeout_auto",
    }),
    null
  );
  broadcastToSession(sessionId, JSON.stringify(timeoutTransition.advanced.turnEnd), null);
  if (timeoutTransition.advanced.turnStart) {
    broadcastToSession(sessionId, JSON.stringify(timeoutTransition.advanced.turnStart), null);
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

function getSessionOwnerPlayerId(session) {
  if (!session || typeof session !== "object") {
    return null;
  }
  const ownerPlayerId =
    typeof session.ownerPlayerId === "string" ? session.ownerPlayerId.trim() : "";
  return ownerPlayerId || null;
}

function ensureSessionOwner(session, fallbackPlayerId = "") {
  if (!session || typeof session !== "object") {
    return null;
  }
  if (getSessionRoomKind(session) !== ROOM_KINDS.private) {
    delete session.ownerPlayerId;
    return null;
  }

  const currentOwnerPlayerId = getSessionOwnerPlayerId(session);
  if (currentOwnerPlayerId) {
    const ownerParticipant = session.participants?.[currentOwnerPlayerId];
    if (ownerParticipant && !isBotParticipant(ownerParticipant)) {
      session.ownerPlayerId = currentOwnerPlayerId;
      return currentOwnerPlayerId;
    }
  }

  const orderedParticipants = serializeParticipantsInJoinOrder(session);
  const firstHumanParticipant = orderedParticipants.find((participant) => {
    const entry = session.participants?.[participant.playerId];
    return entry && !isBotParticipant(entry);
  });
  const fallback =
    typeof fallbackPlayerId === "string" && fallbackPlayerId.trim().length > 0
      ? fallbackPlayerId.trim()
      : "";
  const fallbackParticipant = fallback ? session.participants?.[fallback] : null;
  const nextOwnerPlayerId =
    firstHumanParticipant?.playerId ??
    (fallbackParticipant && !isBotParticipant(fallbackParticipant) ? fallback : "");

  if (!nextOwnerPlayerId) {
    delete session.ownerPlayerId;
    return null;
  }

  session.ownerPlayerId = nextOwnerPlayerId;
  return nextOwnerPlayerId;
}

function normalizeSessionRoomBans(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized = {};
  const entries = Object.entries(value)
    .filter(([playerId]) => typeof playerId === "string" && playerId.trim().length > 0)
    .sort((left, right) => {
      const leftValue = left[1];
      const rightValue = right[1];
      const leftAt = Number(leftValue?.bannedAt ?? 0);
      const rightAt = Number(rightValue?.bannedAt ?? 0);
      return rightAt - leftAt;
    })
    .slice(0, MAX_SESSION_ROOM_BANS);

  entries.forEach(([rawPlayerId, rawEntry]) => {
    const playerId = rawPlayerId.trim();
    const bannedAt =
      Number.isFinite(Number(rawEntry?.bannedAt)) && Number(rawEntry?.bannedAt) > 0
        ? Math.floor(Number(rawEntry.bannedAt))
        : Date.now();
    const bannedByPlayerId =
      typeof rawEntry?.bannedByPlayerId === "string" && rawEntry.bannedByPlayerId.trim().length > 0
        ? rawEntry.bannedByPlayerId.trim()
        : undefined;
    const bannedByRole = rawEntry?.bannedByRole === "owner" || rawEntry?.bannedByRole === "admin"
      ? rawEntry.bannedByRole
      : undefined;

    normalized[playerId] = {
      playerId,
      bannedAt,
      ...(bannedByPlayerId ? { bannedByPlayerId } : {}),
      ...(bannedByRole ? { bannedByRole } : {}),
    };
  });

  return normalized;
}

function ensureSessionRoomBans(session) {
  if (!session || typeof session !== "object") {
    return {};
  }
  const normalized = normalizeSessionRoomBans(session.roomBans);
  session.roomBans = normalized;
  return normalized;
}

function ensureSessionChatConductState(session, now = Date.now()) {
  if (!session || typeof session !== "object") {
    return createEmptyChatConductState();
  }
  const normalized = normalizeChatConductState(session.chatConductState, CHAT_CONDUCT_BASE_POLICY, now);
  session.chatConductState = normalized;
  return normalized;
}

function isPlayerBannedFromSession(session, playerId) {
  const normalizedPlayerId =
    typeof playerId === "string" && playerId.trim().length > 0 ? playerId.trim() : "";
  if (!normalizedPlayerId) {
    return false;
  }
  const roomBans = ensureSessionRoomBans(session);
  return Boolean(roomBans[normalizedPlayerId]);
}

function upsertSessionRoomBan(session, targetPlayerId, options = {}) {
  const normalizedTargetPlayerId =
    typeof targetPlayerId === "string" ? targetPlayerId.trim() : "";
  if (!normalizedTargetPlayerId) {
    return null;
  }

  const roomBans = ensureSessionRoomBans(session);
  roomBans[normalizedTargetPlayerId] = {
    playerId: normalizedTargetPlayerId,
    bannedAt:
      Number.isFinite(Number(options.bannedAt)) && Number(options.bannedAt) > 0
        ? Math.floor(Number(options.bannedAt))
        : Date.now(),
    ...(typeof options.bannedByPlayerId === "string" && options.bannedByPlayerId.trim().length > 0
      ? { bannedByPlayerId: options.bannedByPlayerId.trim() }
      : {}),
    ...(options.bannedByRole === "owner" || options.bannedByRole === "admin"
      ? { bannedByRole: options.bannedByRole }
      : {}),
  };
  session.roomBans = normalizeSessionRoomBans(roomBans);
  return session.roomBans[normalizedTargetPlayerId] ?? null;
}

function resolveModerationActorDisplayName({
  requesterPlayerId,
  requesterParticipant,
  moderatorRole,
  adminAuth,
}) {
  const participantName =
    typeof requesterParticipant?.displayName === "string"
      ? requesterParticipant.displayName.trim()
      : "";
  if (participantName) {
    return participantName;
  }
  if (moderatorRole === "admin") {
    if (typeof adminAuth?.uid === "string" && adminAuth.uid.trim().length > 0) {
      return `Admin ${adminAuth.uid.trim().slice(0, 8)}`;
    }
    if (typeof adminAuth?.email === "string" && adminAuth.email.trim().length > 0) {
      return adminAuth.email.trim();
    }
    return "Admin";
  }
  return requesterPlayerId;
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

    const noSeatedState = reconcileSessionNoSeatedTimeoutState(latestSession, now);
    if (noSeatedState.changed) {
      sessionsChanged = true;
    }
    if (noSeatedState.expired) {
      const roomKind = getSessionRoomKind(latestSession);
      if (roomKind === ROOM_KINDS.publicDefault) {
        resetPublicRoomForIdle(latestSession, now);
        if (Object.prototype.hasOwnProperty.call(latestSession, "noSeatedSince")) {
          delete latestSession.noSeatedSince;
        }
        ensureSessionTurnState(latestSession);
        reconcileSessionLoops(sessionId);
      } else {
        expireSession(sessionId, "no_seated_timeout");
      }
      sessionsChanged = true;
      return;
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

function relayRealtimeSocketMessage(client, session, payload, now = Date.now()) {
  const targetPlayerId =
    typeof payload.targetPlayerId === "string" ? payload.targetPlayerId.trim() : "";
  const hasTargetPlayer = targetPlayerId.length > 0;
  let shouldPersistChatConduct = false;
  if (hasTargetPlayer && !session?.participants?.[targetPlayerId]) {
    sendSocketError(client, "invalid_target_player", "target_player_not_in_session");
    return;
  }

  const normalizedChannel =
    payload.type === "room_channel"
      ? payload.channel === "direct"
        ? "direct"
        : "public"
      : hasTargetPlayer
        ? "direct"
        : "public";

  if (payload.type === "room_channel") {
    const preflightDecision = roomChannelFilterRegistry.execute(ROOM_CHANNEL_FILTER_SCOPE_PREFLIGHT, {
      session,
      playerId: client.playerId,
      channel: normalizedChannel,
      payloadType: payload.type,
      now,
    });
    if (!preflightDecision.allowed) {
      const failureCode =
        typeof preflightDecision.code === "string" && preflightDecision.code.length > 0
          ? preflightDecision.code
          : "room_channel_sender_restricted";
      const failureReason =
        typeof preflightDecision.reason === "string" && preflightDecision.reason.length > 0
          ? preflightDecision.reason
          : failureCode;
      sendSocketError(client, failureCode, failureReason);
      return;
    }
    const normalizedMessage = normalizeRoomChannelMessage(payload.message);
    if (!normalizedMessage) {
      sendSocketError(client, "room_channel_invalid_message", "room_channel_invalid_message");
      return;
    }
    const roomChannelFilterDecision = roomChannelFilterRegistry.execute(
      ROOM_CHANNEL_FILTER_SCOPE_INBOUND,
      {
        session,
        playerId: client.playerId,
        channel: normalizedChannel,
        message: normalizedMessage,
        now,
      }
    );
    if (roomChannelFilterDecision.stateChanged) {
      shouldPersistChatConduct = true;
    }
    if (!roomChannelFilterDecision.allowed) {
      const warning = roomChannelFilterDecision.outcome?.warning ?? null;
      if (warning) {
        sendSocketPayload(client, {
          type: "player_notification",
          id: randomUUID(),
          playerId: client.playerId,
          sourcePlayerId: client.playerId,
          sourceRole: "system",
          targetPlayerId: client.playerId,
          title: warning.title,
          message: warning.message,
          detail: warning.detail,
          severity: warning.severity,
          timestamp: now,
        });
      }
      const failureCode =
        typeof roomChannelFilterDecision.code === "string" &&
        roomChannelFilterDecision.code.length > 0
          ? roomChannelFilterDecision.code
          : typeof roomChannelFilterDecision.outcome?.code === "string" &&
              roomChannelFilterDecision.outcome.code.length > 0
            ? roomChannelFilterDecision.outcome.code
          : "room_channel_message_blocked";
      const failureReason =
        typeof roomChannelFilterDecision.reason === "string" &&
        roomChannelFilterDecision.reason.length > 0
          ? roomChannelFilterDecision.reason
          : typeof roomChannelFilterDecision.outcome?.reason === "string" &&
              roomChannelFilterDecision.outcome.reason.length > 0
            ? roomChannelFilterDecision.outcome.reason
          : failureCode;
      sendSocketError(client, failureCode, failureReason);
      if (roomChannelFilterDecision.outcome?.shouldAutoBan === true) {
        const participant = session.participants?.[client.playerId];
        const offenderLabel =
          typeof participant?.displayName === "string" && participant.displayName.trim().length > 0
            ? participant.displayName.trim()
            : client.playerId;
        upsertSessionRoomBan(session, client.playerId, {
          bannedAt: now,
          bannedByPlayerId: "system",
          bannedByRole: "admin",
        });
        removeParticipantFromSession(client.sessionId, client.playerId, {
          source: "conduct_auto_ban",
          socketReason: "banned_for_conduct",
        });
        broadcastSystemRoomChannelMessage(client.sessionId, {
          topic: "moderation_ban",
          title: "Room Moderation",
          message: `${offenderLabel} was banned for repeated chat conduct violations.`,
          severity: "warning",
          timestamp: now,
        });
      }
      if (shouldPersistChatConduct) {
        persistStore().catch((error) => {
          log.warn("Failed to persist session after room-channel conduct update", error);
        });
      }
      return;
    }
    payload.message = normalizedMessage;
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
    const directDeliveryDecision = roomChannelFilterRegistry.execute(
      REALTIME_FILTER_SCOPE_DIRECT_DELIVERY,
      {
        session,
        sourcePlayerId: client.playerId,
        targetPlayerId: directTargetPlayerId,
        payloadType: payload.type,
        now,
      }
    );
    if (!directDeliveryDecision.allowed) {
      const blockErrorCode =
        payload.type === "room_channel" ? "room_channel_blocked" : "interaction_blocked";
      const failureCode =
        typeof directDeliveryDecision.code === "string" &&
        directDeliveryDecision.code.length > 0
          ? directDeliveryDecision.code
          : blockErrorCode;
      const failureReason =
        typeof directDeliveryDecision.reason === "string" &&
        directDeliveryDecision.reason.length > 0
          ? directDeliveryDecision.reason
          : failureCode;
      sendSocketError(client, failureCode, failureReason);
      return;
    }
    base.targetPlayerId = directTargetPlayerId;
    sendToSessionPlayer(
      client.sessionId,
      directTargetPlayerId,
      JSON.stringify(base),
      client
    );
    if (shouldPersistChatConduct) {
      persistStore().catch((error) => {
        log.warn("Failed to persist session after room-channel direct relay", error);
      });
    }
    return;
  }

  delete base.targetPlayerId;
  if (payload.type === "room_channel") {
    broadcastRoomChannelToSession(session, base, client);
    if (shouldPersistChatConduct) {
      persistStore().catch((error) => {
        log.warn("Failed to persist session after room-channel relay", error);
      });
    }
    return;
  }
  broadcastRealtimeSocketMessageToSession(session, base, client);
  if (shouldPersistChatConduct) {
    persistStore().catch((error) => {
      log.warn("Failed to persist session after realtime relay", error);
    });
  }
}

function handleTurnActionMessage(client, session, payload) {
  const timestamp = Date.now();
  session.participants[client.playerId].lastHeartbeatAt = timestamp;
  markSessionActivity(session, client.playerId, timestamp);
  const transition = processTurnAction(session, client.playerId, payload);
  if (!transition.ok) {
    sendSocketError(client, transition.code, transition.reason);
    if (transition.sync) {
      sendTurnSyncPayload(client, session, "sync");
    }
    return;
  }

  if (transition.message) {
    broadcastToSession(client.sessionId, JSON.stringify(transition.message), null);
  }

  if (transition.winnerResolved) {
    broadcastRoundWinnerResolved(
      session,
      client.playerId,
      transition.actionTimestamp,
      "winner_complete"
    );
  }

  if (!transition.shouldBroadcastState) {
    reconcileSessionLoops(client.sessionId);
    return;
  }

  broadcastSessionState(session, `turn_${transition.action}`);
  if (transition.shouldPersist) {
    persistStore().catch((error) => {
      log.warn("Failed to persist session after turn action", error);
    });
  }
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

  clearParticipantTimeoutStrike(session.participants[client.playerId]);
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

function disconnectPlayerSockets(sessionId, playerId, closeCode, reason) {
  socketLifecycle.disconnectPlayerSockets(sessionId, playerId, closeCode, reason);
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
  socketRelay.broadcastToSession(sessionId, rawMessage, sender);
}

function sendToSessionPlayer(sessionId, playerId, rawMessage, sender = null) {
  socketRelay.sendToSessionPlayer(sessionId, playerId, rawMessage, sender);
}

function broadcastRoomChannelToSession(session, payload, sender = null) {
  socketRelay.broadcastRoomChannelToSession(session, payload, sender);
}

function broadcastRealtimeSocketMessageToSession(session, payload, sender = null) {
  socketRelay.broadcastRealtimeSocketMessageToSession(session, payload, sender);
}

function sendSocketPayload(client, payload) {
  socketRelay.sendSocketPayload(client, payload);
}

function sendSocketError(client, code, message) {
  socketRelay.sendSocketError(client, code, message);
}

function safeCloseSocket(client, closeCode, closeReason) {
  if (!client || client.closed) return;
  client.closed = true;
  socketLifecycle.unregisterSocketClient(client);

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
  persistStoreQueue = persistStoreQueue
    .catch(() => {
      // Keep persist operations flowing even if a prior save failed.
    })
    .then(async () => {
      exportChatModerationTermsToStore();
      await storeAdapter.save(store);
    });
  await persistStoreQueue;
}

async function refreshChatModerationTermsFromRemote(options = {}) {
  const source =
    typeof options.source === "string" && options.source.trim().length > 0
      ? options.source.trim()
      : "manual";
  const persistOnChange = options.persistOnChange !== false;
  const persistOnNoChange = options.persistOnNoChange === true;
  const result = await CHAT_CONDUCT_TERM_SERVICE.refreshFromRemote(globalThis.fetch, Date.now());
  if (!result.ok) {
    if (source !== "interval" && result.reason !== "remote_not_configured") {
      log.warn(`Chat moderation term refresh failed (${source}): ${result.reason ?? "unknown"}`);
    } else if (source !== "interval" && result.reason === "remote_not_configured") {
      log.info(`Chat moderation term refresh skipped (${source}): remote_not_configured`);
    }
    return result;
  }

  log.info(
    `Chat moderation term refresh (${source}): changed=${result.changed === true} remoteTerms=${result.remoteTermCount ?? 0} activeTerms=${result.activeTermCount ?? 0}`
  );
  if ((result.changed === true && persistOnChange) || (result.changed !== true && persistOnNoChange)) {
    await persistStore();
  }
  return result;
}

async function rehydrateStoreFromAdapter(reason, options = {}) {
  if (!storeAdapter || typeof storeAdapter.load !== "function") {
    return false;
  }

  // Avoid reading stale remote state while local saves are still being flushed.
  await persistStoreQueue.catch(() => {
    // Rehydrate can still continue and try to recover from adapter state.
  });

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
      store = cloneStore(loaded);
      const consistencyChanged = normalizeStoreConsistency(Date.now());
      hydrateChatModerationTermsFromStore();
      if (consistencyChanged) {
        await persistStore();
      }
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

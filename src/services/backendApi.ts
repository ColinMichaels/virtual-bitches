import { environment } from "@env";
import { logger } from "../utils/logger.js";
import type { Settings } from "./settings.js";
import type { UpgradeProgressionState } from "../chaos/upgrades/types.js";
import { authSessionService, type AuthTokenBundle } from "./authSession.js";

const log = logger.create("BackendApi");

const DEFAULT_TIMEOUT_MS = 8000;
const FIREBASE_SESSION_EXPIRED_EVENT_COOLDOWN_MS = 10000;
type RequestAuthMode = "none" | "session" | "firebase" | "firebaseOptional";
export type MultiplayerGameDifficulty = "easy" | "normal" | "hard";

export interface PlayerProfileRecord {
  playerId: string;
  displayName?: string;
  settings: Settings;
  upgradeProgression: UpgradeProgressionState;
  blockedPlayerIds?: string[];
  updatedAt: number;
}

export interface GameLogRecord {
  id: string;
  playerId: string;
  sessionId?: string;
  type: string;
  timestamp: number;
  payload: unknown;
}

export interface GameLogBatchResponse {
  accepted: number;
  failed: number;
}

export interface MultiplayerHeartbeatResponse {
  ok: boolean;
  reason?: "session_expired" | "unknown_player" | "unknown_session";
}

export interface MultiplayerQueueNextGameResponse {
  ok: boolean;
  queuedForNextGame: boolean;
  reason?:
    | "session_expired"
    | "unknown_player"
    | "round_in_progress"
    | "unauthorized"
    | "unknown_session"
    | "not_seated";
  session?: MultiplayerSessionRecord;
}

export interface MultiplayerSessionAuth extends AuthTokenBundle {}

export type MultiplayerParticipantStateAction = "sit" | "stand" | "ready" | "unready";

export interface MultiplayerParticipantStateResponse {
  ok: boolean;
  reason?:
    | "ok"
    | "invalid_action"
    | "session_expired"
    | "unknown_player"
    | "unauthorized"
    | "not_seated";
  state?: {
    isSeated: boolean;
    isReady: boolean;
    queuedForNextGame: boolean;
  };
  session?: MultiplayerSessionRecord;
}

export interface MultiplayerSessionParticipant {
  playerId: string;
  displayName?: string;
  avatarUrl?: string;
  providerId?: string;
  joinedAt: number;
  lastHeartbeatAt: number;
  isBot?: boolean;
  botProfile?: "cautious" | "balanced" | "aggressive";
  isSeated?: boolean;
  isReady?: boolean;
  score?: number;
  remainingDice?: number;
  queuedForNextGame?: boolean;
  isComplete?: boolean;
  completedAt?: number | null;
}

export interface MultiplayerSessionStanding {
  playerId: string;
  displayName?: string;
  avatarUrl?: string;
  providerId?: string;
  joinedAt: number;
  lastHeartbeatAt: number;
  isBot?: boolean;
  botProfile?: "cautious" | "balanced" | "aggressive";
  isSeated?: boolean;
  isReady?: boolean;
  score?: number;
  remainingDice?: number;
  queuedForNextGame?: boolean;
  isComplete?: boolean;
  completedAt?: number | null;
  placement: number;
}

export interface MultiplayerSessionTurnState {
  activeRoll?: {
    rollIndex: number;
    dice: Array<{
      dieId: string;
      sides: number;
      value: number;
    }>;
    serverRollId?: string;
    updatedAt?: number;
  } | null;
  order: string[];
  activeTurnPlayerId: string | null;
  round: number;
  turnNumber: number;
  phase?: "await_roll" | "await_score" | "ready_to_end";
  activeRollServerId?: string | null;
  turnExpiresAt?: number | null;
  turnTimeoutMs?: number;
  updatedAt: number;
}

export interface MultiplayerSessionRecord {
  sessionId: string;
  roomCode: string;
  gameDifficulty?: MultiplayerGameDifficulty;
  roomType?: "private" | "public_default" | "public_overflow";
  isPublic?: boolean;
  maxHumanCount?: number;
  availableHumanSlots?: number;
  wsUrl?: string;
  playerToken?: string;
  auth?: MultiplayerSessionAuth;
  participants?: MultiplayerSessionParticipant[];
  standings?: MultiplayerSessionStanding[];
  turnState?: MultiplayerSessionTurnState | null;
  sessionComplete?: boolean;
  completedAt?: number | null;
  createdAt: number;
  gameStartedAt?: number;
  nextGameStartsAt?: number;
  nextGameAutoStartDelayMs?: number;
  lastActivityAt?: number;
  expiresAt?: number;
  serverNow?: number;
}

export interface MultiplayerRoomListing {
  sessionId: string;
  roomCode: string;
  gameDifficulty?: MultiplayerGameDifficulty;
  roomType?: "private" | "public_default" | "public_overflow";
  isPublic?: boolean;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
  participantCount: number;
  humanCount: number;
  activeHumanCount: number;
  readyHumanCount: number;
  maxHumanCount?: number;
  availableHumanSlots?: number;
  botCount: number;
  sessionComplete: boolean;
}

export interface CreateMultiplayerSessionRequest {
  playerId: string;
  roomCode?: string;
  displayName?: string;
  avatarUrl?: string;
  providerId?: string;
  blockedPlayerIds?: string[];
  botCount?: number;
  gameDifficulty?: MultiplayerGameDifficulty;
}

export interface JoinMultiplayerSessionRequest {
  playerId: string;
  displayName?: string;
  avatarUrl?: string;
  providerId?: string;
  blockedPlayerIds?: string[];
  botCount?: number;
  gameDifficulty?: MultiplayerGameDifficulty;
}

export type MultiplayerJoinFailureReason =
  | "room_full"
  | "session_expired"
  | "room_not_found"
  | "unknown";

export interface MultiplayerJoinSessionResult {
  session: MultiplayerSessionRecord | null;
  reason?: MultiplayerJoinFailureReason;
  status?: number;
}

export interface LeaderboardScoreSubmission {
  scoreId: string;
  score: number;
  timestamp: number;
  playerName?: string;
  seed?: string;
  duration: number;
  rollCount: number;
  mode?: {
    difficulty?: string;
    variant?: string;
  };
}

export interface PlayerScoreSubmission {
  scoreId: string;
  score: number;
  timestamp: number;
  seed?: string;
  duration: number;
  rollCount: number;
  mode?: {
    difficulty?: string;
    variant?: string;
  };
}

export interface PlayerScoreRecord extends PlayerScoreSubmission {}

export interface PlayerScoreBatchResponse {
  accepted: number;
  failed: number;
}

export interface PlayerScoreListResponse {
  playerId: string;
  entries: PlayerScoreRecord[];
  stats: {
    totalGames: number;
    bestScore: number;
    averageScore: number;
    totalPlayTime: number;
  };
  total: number;
  generatedAt: number;
}

export interface GlobalLeaderboardEntry {
  id: string;
  uid: string;
  displayName: string;
  score: number;
  timestamp: number;
  duration: number;
  rollCount: number;
  mode?: {
    difficulty?: string;
    variant?: string;
  };
}

export interface AuthenticatedUserProfile {
  uid: string;
  displayName?: string;
  leaderboardName?: string;
  email?: string;
  isAnonymous: boolean;
  provider?: string;
  providerId?: string;
  photoUrl?: string;
  admin?: {
    role: "viewer" | "operator" | "owner" | null;
    isAdmin: boolean;
    source?: string;
  };
}

export interface BackendApiOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  firebaseTokenProvider?: () => Promise<string | null> | string | null;
}

export class BackendApiService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private firebaseTokenProvider: () => Promise<string | null> | string | null;
  private lastFirebaseSessionExpiredEventAt = 0;

  constructor(options: BackendApiOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? environment.apiBaseUrl);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const configuredFetch = options.fetchImpl;
    this.fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (configuredFetch) {
        return configuredFetch.call(globalThis, input, init);
      }
      return fetch(input, init);
    }) as typeof fetch;
    this.firebaseTokenProvider = options.firebaseTokenProvider ?? (() => null);
  }

  setFirebaseTokenProvider(provider: () => Promise<string | null> | string | null): void {
    this.firebaseTokenProvider = provider;
  }

  async getPlayerProfile(playerId: string): Promise<PlayerProfileRecord | null> {
    const encoded = encodeURIComponent(playerId);
    return this.request<PlayerProfileRecord>(`/players/${encoded}/profile`, {
      method: "GET",
      authMode: "none",
    });
  }

  async upsertPlayerProfile(profile: PlayerProfileRecord): Promise<PlayerProfileRecord | null> {
    return this.request<PlayerProfileRecord>(`/players/${encodeURIComponent(profile.playerId)}/profile`, {
      method: "PUT",
      body: profile,
      authMode: "none",
    });
  }

  async appendPlayerScores(
    playerId: string,
    scores: PlayerScoreSubmission[]
  ): Promise<PlayerScoreBatchResponse | null> {
    if (scores.length === 0) {
      return { accepted: 0, failed: 0 };
    }

    return this.request<PlayerScoreBatchResponse>(
      `/players/${encodeURIComponent(playerId)}/scores/batch`,
      {
        method: "POST",
        body: {
          scores,
        },
        authMode: "none",
      }
    );
  }

  async getPlayerScores(
    playerId: string,
    limit: number = 200
  ): Promise<PlayerScoreListResponse | null> {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return this.request<PlayerScoreListResponse>(
      `/players/${encodeURIComponent(playerId)}/scores?limit=${boundedLimit}`,
      {
        method: "GET",
        authMode: "none",
      }
    );
  }

  async appendGameLogs(logs: GameLogRecord[]): Promise<GameLogBatchResponse | null> {
    if (logs.length === 0) {
      return { accepted: 0, failed: 0 };
    }

    return this.request<GameLogBatchResponse>("/logs/batch", {
      method: "POST",
      body: { logs },
      authMode: "none",
    });
  }

  async createMultiplayerSession(
    request: CreateMultiplayerSessionRequest
  ): Promise<MultiplayerSessionRecord | null> {
    return this.request<MultiplayerSessionRecord>("/multiplayer/sessions", {
      method: "POST",
      body: request,
    });
  }

  async listMultiplayerRooms(limit: number = 24): Promise<MultiplayerRoomListing[] | null> {
    const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
    const response = await this.request<{ rooms: MultiplayerRoomListing[] }>(
      `/multiplayer/rooms?limit=${bounded}`,
      {
        method: "GET",
        authMode: "none",
      }
    );
    return response?.rooms ?? null;
  }

  async joinMultiplayerSession(
    sessionId: string,
    request: JoinMultiplayerSessionRequest
  ): Promise<MultiplayerJoinSessionResult> {
    const path = `/multiplayer/sessions/${encodeURIComponent(sessionId)}/join`;
    return this.joinMultiplayerByPath(path, request);
  }

  async joinMultiplayerRoomByCode(
    roomCode: string,
    request: JoinMultiplayerSessionRequest
  ): Promise<MultiplayerJoinSessionResult> {
    const normalizedRoomCode = roomCode.trim().toUpperCase();
    if (!normalizedRoomCode) {
      return {
        session: null,
        reason: "room_not_found",
      };
    }
    const path = `/multiplayer/rooms/${encodeURIComponent(normalizedRoomCode)}/join`;
    return this.joinMultiplayerByPath(path, request);
  }

  async heartbeatMultiplayerSession(
    sessionId: string,
    playerId: string
  ): Promise<MultiplayerHeartbeatResponse | null> {
    return this.request<MultiplayerHeartbeatResponse>(
      `/multiplayer/sessions/${encodeURIComponent(sessionId)}/heartbeat`,
      {
        method: "POST",
        body: { playerId },
      }
    );
  }

  async queueMultiplayerForNextGame(
    sessionId: string,
    playerId: string
  ): Promise<MultiplayerQueueNextGameResponse | null> {
    return this.request<MultiplayerQueueNextGameResponse>(
      `/multiplayer/sessions/${encodeURIComponent(sessionId)}/queue-next`,
      {
        method: "POST",
        body: { playerId },
      }
    );
  }

  async updateMultiplayerParticipantState(
    sessionId: string,
    playerId: string,
    action: MultiplayerParticipantStateAction
  ): Promise<MultiplayerParticipantStateResponse | null> {
    return this.request<MultiplayerParticipantStateResponse>(
      `/multiplayer/sessions/${encodeURIComponent(sessionId)}/participant-state`,
      {
        method: "POST",
        body: { playerId, action },
      }
    );
  }

  async leaveMultiplayerSession(
    sessionId: string,
    playerId: string
  ): Promise<{ ok: boolean } | null> {
    return this.request<{ ok: boolean }>(
      `/multiplayer/sessions/${encodeURIComponent(sessionId)}/leave`,
      {
        method: "POST",
        body: { playerId },
      }
    );
  }

  async refreshMultiplayerSessionAuth(
    sessionId: string,
    playerId: string
  ): Promise<MultiplayerSessionRecord | null> {
    return this.request<MultiplayerSessionRecord>(
      `/multiplayer/sessions/${encodeURIComponent(sessionId)}/auth/refresh`,
      {
        method: "POST",
        body: { playerId },
      }
    );
  }

  async submitLeaderboardScore(
    submission: LeaderboardScoreSubmission
  ): Promise<GlobalLeaderboardEntry | null> {
    return this.request<GlobalLeaderboardEntry>("/leaderboard/scores", {
      method: "POST",
      body: submission,
      authMode: "firebase",
    });
  }

  async getGlobalLeaderboard(limit: number = 200): Promise<GlobalLeaderboardEntry[] | null> {
    const bounded = Math.max(1, Math.min(200, Math.floor(limit)));
    const response = await this.request<
      { entries: GlobalLeaderboardEntry[] } | GlobalLeaderboardEntry[]
    >(
      `/leaderboard/global?limit=${bounded}`,
      {
        method: "GET",
        authMode: "none",
      }
    );
    if (Array.isArray(response)) {
      return response;
    }
    if (response && Array.isArray(response.entries)) {
      return response.entries;
    }
    return null;
  }

  async getAuthenticatedUserProfile(): Promise<AuthenticatedUserProfile | null> {
    return this.request<AuthenticatedUserProfile>("/auth/me", {
      method: "GET",
      authMode: "firebase",
      suppressMissingFirebaseTokenWarning: true,
    });
  }

  async updateAuthenticatedUserProfile(
    displayName: string
  ): Promise<AuthenticatedUserProfile | null> {
    return this.request<AuthenticatedUserProfile>("/auth/me", {
      method: "PUT",
      body: { displayName },
      authMode: "firebase",
    });
  }

  private async request<T>(
    path: string,
    options: {
      method: string;
      body?: unknown;
      authMode?: RequestAuthMode;
      suppressMissingFirebaseTokenWarning?: boolean;
    }
  ): Promise<T | null> {
    const authMode = options.authMode ?? "session";
    const firstResponse = await this.executeRequest(path, options, authMode);
    if (!firstResponse) {
      return null;
    }

    if (firstResponse.status === 401 && authMode === "session") {
      const refreshed = await authSessionService.refreshTokens({
        baseUrl: this.baseUrl,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
      });
      if (!refreshed) {
        authSessionService.markSessionExpired("http_401_refresh_failed");
        return null;
      }

      const retryResponse = await this.executeRequest(path, options, authMode);
      if (!retryResponse) {
        return null;
      }

      if (retryResponse.status === 401) {
        authSessionService.markSessionExpired("http_401_after_refresh");
        log.warn(`API request unauthorized after refresh: ${options.method} ${path}`);
        return null;
      }

      return this.parseJsonResponse<T>(retryResponse, options.method, path, authMode);
    }

    return this.parseJsonResponse<T>(firstResponse, options.method, path, authMode);
  }

  private async executeRequest(
    path: string,
    options: {
      method: string;
      body?: unknown;
      authMode?: RequestAuthMode;
      suppressMissingFirebaseTokenWarning?: boolean;
    },
    authMode: RequestAuthMode
  ): Promise<Response | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {};
      if (options.body !== undefined) {
        headers["content-type"] = "application/json";
      }

      if (authMode === "session") {
        const accessToken = authSessionService.getAccessToken();
        if (accessToken) {
          headers.authorization = `Bearer ${accessToken}`;
        }
      } else if (authMode === "firebase" || authMode === "firebaseOptional") {
        const firebaseToken = await this.firebaseTokenProvider();
        if (firebaseToken) {
          headers.authorization = `Bearer ${firebaseToken}`;
        } else if (authMode === "firebase") {
          if (!options.suppressMissingFirebaseTokenWarning) {
            log.warn(`Missing Firebase auth token for ${options.method} ${path}`);
          }
          return null;
        }
      }

      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      log.warn(`API request error: ${options.method} ${path}`, error);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseJsonResponse<T>(
    response: Response,
    method: string,
    path: string,
    authMode: RequestAuthMode
  ): Promise<T | null> {
    if (response.status === 204) {
      return null;
    }

    if (response.status === 404 && isExpectedNotFound(method, path)) {
      return null;
    }

    if (!response.ok) {
      const errorSummary = await readErrorSummary(response);
      const isAuthProfileProbe = method === "GET" && path === "/auth/me";
      if (
        response.status === 401 &&
        (authMode === "firebase" || authMode === "firebaseOptional")
      ) {
        if (isAuthProfileProbe) {
          return null;
        }
        this.dispatchFirebaseSessionExpired(path, errorSummary);
      }
      if (isAuthProfileProbe && response.status === 401) {
        return null;
      }
      if (errorSummary) {
        log.warn(`API request failed: ${method} ${path} (${response.status}) - ${errorSummary}`);
      } else {
        log.warn(`API request failed: ${method} ${path} (${response.status})`);
      }
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }

    const rawBody = (await response.text()).trim();
    if (rawBody) {
      if (looksLikeJson(rawBody)) {
        try {
          return JSON.parse(rawBody) as T;
        } catch {
          // Fall through to warning below for easier diagnosis.
        }
      }
      log.warn(
        `API request returned non-JSON payload: ${method} ${path} (${response.status}) [content-type=${contentType || "none"}] ${normalizeLogSnippet(rawBody)}`
      );
    } else {
      log.warn(
        `API request returned empty payload: ${method} ${path} (${response.status}) [content-type=${contentType || "none"}]`
      );
    }

    return null;
  }

  private async parseJoinSessionResponse(
    response: Response,
    path: string
  ): Promise<MultiplayerJoinSessionResult> {
    if (!response.ok) {
      const errorSummary = await readErrorSummary(response);
      if (errorSummary) {
        log.warn(
          `API request failed: POST ${path} (${response.status}) - ${errorSummary}`
        );
      } else {
        log.warn(`API request failed: POST ${path} (${response.status})`);
      }
      return {
        session: null,
        reason: resolveJoinFailureReason(response.status, errorSummary),
        status: response.status,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return {
        session: null,
        reason: "unknown",
        status: response.status,
      };
    }

    return {
      session: (await response.json()) as MultiplayerSessionRecord,
      status: response.status,
    };
  }

  private async joinMultiplayerByPath(
    path: string,
    request: JoinMultiplayerSessionRequest
  ): Promise<MultiplayerJoinSessionResult> {
    const requestOptions = {
      method: "POST",
      body: request,
    };

    const firstResponse = await this.executeRequest(path, requestOptions, "session");
    if (!firstResponse) {
      return { session: null, reason: "unknown" };
    }

    if (firstResponse.status === 401) {
      const refreshed = await authSessionService.refreshTokens({
        baseUrl: this.baseUrl,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
      });
      if (!refreshed) {
        authSessionService.markSessionExpired("http_401_refresh_failed");
        return { session: null, reason: "session_expired", status: 401 };
      }

      const retryResponse = await this.executeRequest(path, requestOptions, "session");
      if (!retryResponse) {
        return { session: null, reason: "unknown" };
      }
      return this.parseJoinSessionResponse(retryResponse, path);
    }

    return this.parseJoinSessionResponse(firstResponse, path);
  }

  private dispatchFirebaseSessionExpired(path: string, reason?: string): void {
    if (typeof document === "undefined" || typeof CustomEvent === "undefined") {
      return;
    }

    const now = Date.now();
    if (
      this.lastFirebaseSessionExpiredEventAt > 0 &&
      now - this.lastFirebaseSessionExpiredEventAt < FIREBASE_SESSION_EXPIRED_EVENT_COOLDOWN_MS
    ) {
      return;
    }
    this.lastFirebaseSessionExpiredEventAt = now;

    document.dispatchEvent(
      new CustomEvent("auth:firebaseSessionExpired", {
        detail: {
          path,
          reason: reason ?? "http_401",
        },
      })
    );
  }
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function resolveJoinFailureReason(
  status: number,
  errorSummary?: string
): MultiplayerJoinFailureReason {
  const normalized = typeof errorSummary === "string" ? errorSummary.toLowerCase() : "";
  if (status === 409 && normalized.includes("room_full")) {
    return "room_full";
  }
  if (
    status === 410 ||
    normalized.includes("session expired") ||
    normalized.includes("session_expired")
  ) {
    return "session_expired";
  }
  if (
    status === 404 ||
    normalized.includes("room_not_found") ||
    normalized.includes("room code not found")
  ) {
    return "room_not_found";
  }
  return "unknown";
}

async function readErrorSummary(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const parsed = (await response.json()) as
        | { error?: unknown; reason?: unknown; message?: unknown }
        | null;

      const parts: string[] = [];
      if (parsed && typeof parsed.error === "string") {
        parts.push(parsed.error);
      }
      if (parsed && typeof parsed.reason === "string") {
        parts.push(parsed.reason);
      }
      if (parsed && typeof parsed.message === "string") {
        parts.push(parsed.message);
      }
      return parts.join(" | ").slice(0, 220);
    }

    const raw = await response.text();
    return raw.trim().slice(0, 220);
  } catch {
    return "";
  }
}

function isExpectedNotFound(method: string, path: string): boolean {
  return method === "GET" && /^\/players\/[^/]+\/profile$/.test(path);
}

function looksLikeJson(rawBody: string): boolean {
  const first = rawBody.trim().charAt(0);
  return first === "{" || first === "[";
}

function normalizeLogSnippet(rawBody: string): string {
  return rawBody.replace(/\s+/g, " ").slice(0, 220);
}

export const backendApiService = new BackendApiService();

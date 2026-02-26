import { environment } from "@env";
import { logger } from "../utils/logger.js";
import type { Settings } from "./settings.js";
import type { UpgradeProgressionState } from "../chaos/upgrades/types.js";
import { authSessionService, type AuthTokenBundle } from "./authSession.js";

const log = logger.create("BackendApi");

const DEFAULT_TIMEOUT_MS = 8000;

export interface PlayerProfileRecord {
  playerId: string;
  displayName?: string;
  settings: Settings;
  upgradeProgression: UpgradeProgressionState;
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

export interface MultiplayerSessionAuth extends AuthTokenBundle {}

export interface MultiplayerSessionRecord {
  sessionId: string;
  roomCode: string;
  wsUrl?: string;
  playerToken?: string;
  auth?: MultiplayerSessionAuth;
  createdAt: number;
  expiresAt?: number;
}

export interface CreateMultiplayerSessionRequest {
  playerId: string;
  roomCode?: string;
}

export interface JoinMultiplayerSessionRequest {
  playerId: string;
  displayName?: string;
}

export interface BackendApiOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class BackendApiService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

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
  }

  async getPlayerProfile(playerId: string): Promise<PlayerProfileRecord | null> {
    const encoded = encodeURIComponent(playerId);
    return this.request<PlayerProfileRecord>(`/players/${encoded}/profile`, {
      method: "GET",
    });
  }

  async upsertPlayerProfile(profile: PlayerProfileRecord): Promise<PlayerProfileRecord | null> {
    return this.request<PlayerProfileRecord>(`/players/${encodeURIComponent(profile.playerId)}/profile`, {
      method: "PUT",
      body: profile,
    });
  }

  async appendGameLogs(logs: GameLogRecord[]): Promise<GameLogBatchResponse | null> {
    if (logs.length === 0) {
      return { accepted: 0, failed: 0 };
    }

    return this.request<GameLogBatchResponse>("/logs/batch", {
      method: "POST",
      body: { logs },
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

  async joinMultiplayerSession(
    sessionId: string,
    request: JoinMultiplayerSessionRequest
  ): Promise<MultiplayerSessionRecord | null> {
    return this.request<MultiplayerSessionRecord>(
      `/multiplayer/sessions/${encodeURIComponent(sessionId)}/join`,
      {
        method: "POST",
        body: request,
      }
    );
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

  private async request<T>(
    path: string,
    options: { method: string; body?: unknown }
  ): Promise<T | null> {
    const firstResponse = await this.executeRequest(path, options);
    if (!firstResponse) {
      return null;
    }

    if (firstResponse.status === 401) {
      const refreshed = await authSessionService.refreshTokens({
        baseUrl: this.baseUrl,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
      });
      if (!refreshed) {
        authSessionService.markSessionExpired("http_401_refresh_failed");
        return null;
      }

      const retryResponse = await this.executeRequest(path, options);
      if (!retryResponse) {
        return null;
      }

      if (retryResponse.status === 401) {
        authSessionService.markSessionExpired("http_401_after_refresh");
        log.warn(`API request unauthorized after refresh: ${options.method} ${path}`);
        return null;
      }

      return this.parseJsonResponse<T>(retryResponse, options.method, path);
    }

    return this.parseJsonResponse<T>(firstResponse, options.method, path);
  }

  private async executeRequest(
    path: string,
    options: { method: string; body?: unknown }
  ): Promise<Response | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      const accessToken = authSessionService.getAccessToken();
      if (accessToken) {
        headers.authorization = `Bearer ${accessToken}`;
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
    path: string
  ): Promise<T | null> {
    if (response.status === 404 && isExpectedNotFound(method, path)) {
      return null;
    }

    if (!response.ok) {
      log.warn(`API request failed: ${method} ${path} (${response.status})`);
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return null;
    }

    return (await response.json()) as T;
  }
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function isExpectedNotFound(method: string, path: string): boolean {
  return method === "GET" && /^\/players\/[^/]+\/profile$/.test(path);
}

export const backendApiService = new BackendApiService();

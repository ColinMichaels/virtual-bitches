import { environment } from "@env";
import { logger } from "../utils/logger.js";

const log = logger.create("AdminApi");
const REQUEST_TIMEOUT_MS = 6000;
const ADMIN_TOKEN_STORAGE_KEY = `${environment.storage.prefix}-admin-token`;

export type AdminUserRole = "viewer" | "operator" | "owner";
export type AdminRoleSource = "assigned" | "bootstrap" | "none" | "open" | "token";
export type AdminAccessMode = "open" | "token" | "role" | "hybrid" | "disabled";

export interface AdminPrincipal {
  authType?: string;
  uid?: string | null;
  role?: AdminUserRole | null;
  roleSource?: AdminRoleSource | string;
}

export interface AdminMonitorRoomParticipant {
  playerId: string;
  displayName?: string;
  isBot: boolean;
  isReady: boolean;
  isComplete: boolean;
  score: number;
  remainingDice: number;
  lastHeartbeatAt: number;
  connected: boolean;
}

export interface AdminMonitorRoomSummary {
  sessionId: string;
  roomCode: string;
  roomType: "private" | "public_default" | "public_overflow";
  isPublic: boolean;
  sessionComplete: boolean;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
  idleMs: number;
  humanCount: number;
  readyHumanCount: number;
  activeHumanCount: number;
  botCount: number;
  participantCount: number;
  maxHumanCount: number;
  availableHumanSlots: number;
  connectedSocketCount: number;
  hasConnectedHumans: boolean;
  participants: AdminMonitorRoomParticipant[];
  turnState: {
    activeTurnPlayerId: string | null;
    round: number;
    turnNumber: number;
    phase: "await_roll" | "await_score" | "ready_to_end";
    orderLength: number;
    turnExpiresAt: number | null;
    turnTimeoutMs: number;
  } | null;
}

export interface AdminMonitorMetrics {
  activeSessionCount: number;
  totalSessionRecords: number;
  publicDefaultCount: number;
  publicOverflowCount: number;
  privateRoomCount: number;
  participantCount: number;
  humanCount: number;
  botCount: number;
  readyHumanCount: number;
  connectedSocketCount: number;
  activeTurnTimeoutLoops: number;
  activeBotLoops: number;
}

export interface AdminMonitorOverview {
  timestamp: number;
  accessMode: AdminAccessMode;
  principal?: AdminPrincipal | null;
  metrics: AdminMonitorMetrics;
  rooms: AdminMonitorRoomSummary[];
}

export interface AdminRoleRecord {
  uid: string;
  displayName?: string;
  email?: string;
  provider?: string;
  role: AdminUserRole | null;
  source: AdminRoleSource | string;
  updatedAt?: number;
  roleUpdatedAt?: number;
  roleUpdatedBy?: string;
}

export interface AdminMonitorResult {
  overview: AdminMonitorOverview | null;
  status?: number;
  reason?: string;
  principal?: AdminPrincipal | null;
}

export interface AdminRolesResult {
  roles: AdminRoleRecord[] | null;
  status?: number;
  reason?: string;
  principal?: AdminPrincipal | null;
}

export interface AdminRoleUpdateResult {
  roleRecord: AdminRoleRecord | null;
  status?: number;
  reason?: string;
  principal?: AdminPrincipal | null;
}

export interface AdminMutationResult {
  ok: boolean;
  status?: number;
  reason?: string;
  principal?: AdminPrincipal | null;
  sessionId?: string;
  playerId?: string;
  sessionExpired?: boolean;
  roomInventoryChanged?: boolean;
}

export interface AdminRequestAuthOptions {
  firebaseIdToken?: string | null;
  adminToken?: string | null;
}

export class AdminApiService {
  private readonly baseUrl: string;

  constructor(baseUrl: string = environment.apiBaseUrl) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  getAdminToken(): string {
    if (typeof localStorage === "undefined") {
      return "";
    }
    try {
      const value = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? "";
      return value.trim();
    } catch {
      return "";
    }
  }

  setAdminToken(token: string): void {
    if (typeof localStorage === "undefined") {
      return;
    }
    const normalized = token.trim();
    try {
      if (!normalized) {
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
      } else {
        localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, normalized);
      }
    } catch (error) {
      log.warn("Failed to persist admin token", error);
    }
  }

  async getOverview(
    limit: number = 24,
    authOptions: AdminRequestAuthOptions = {}
  ): Promise<AdminMonitorResult> {
    const bounded = Math.max(1, Math.min(200, Math.floor(limit)));
    const result = await this.requestJson(`/admin/overview?limit=${bounded}`, {
      method: "GET",
      authOptions,
    });
    if (!result.ok) {
      return {
        overview: null,
        status: result.status,
        reason: result.reason,
      };
    }
    if (!isAdminMonitorOverview(result.payload)) {
      return {
        overview: null,
        status: result.status,
        reason: "invalid_admin_payload",
      };
    }
    return {
      overview: result.payload,
      status: result.status,
      principal: result.payload.principal ?? null,
    };
  }

  async getRoles(
    limit: number = 250,
    authOptions: AdminRequestAuthOptions = {}
  ): Promise<AdminRolesResult> {
    const bounded = Math.max(1, Math.min(500, Math.floor(limit)));
    const result = await this.requestJson(`/admin/roles?limit=${bounded}`, {
      method: "GET",
      authOptions,
    });
    if (!result.ok) {
      return {
        roles: null,
        status: result.status,
        reason: result.reason,
      };
    }
    if (!isAdminRolesPayload(result.payload)) {
      return {
        roles: null,
        status: result.status,
        reason: "invalid_admin_payload",
      };
    }
    return {
      roles: result.payload.roles,
      status: result.status,
      principal: result.payload.principal ?? null,
    };
  }

  async setRole(
    uid: string,
    role: AdminUserRole | null,
    authOptions: AdminRequestAuthOptions = {}
  ): Promise<AdminRoleUpdateResult> {
    const normalizedUid = uid.trim();
    if (!normalizedUid) {
      return {
        roleRecord: null,
        reason: "invalid_uid",
      };
    }
    const result = await this.requestJson(`/admin/roles/${encodeURIComponent(normalizedUid)}`, {
      method: "PUT",
      body: {
        role,
      },
      authOptions,
    });
    if (!result.ok) {
      return {
        roleRecord: null,
        status: result.status,
        reason: result.reason,
      };
    }
    if (!isAdminRoleUpdatePayload(result.payload)) {
      return {
        roleRecord: null,
        status: result.status,
        reason: "invalid_admin_payload",
      };
    }
    return {
      roleRecord: result.payload.roleRecord,
      status: result.status,
      principal: result.payload.principal ?? null,
    };
  }

  async expireSession(
    sessionId: string,
    authOptions: AdminRequestAuthOptions = {}
  ): Promise<AdminMutationResult> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return {
        ok: false,
        reason: "invalid_session_id",
      };
    }
    const result = await this.requestJson(`/admin/sessions/${encodeURIComponent(normalizedSessionId)}/expire`, {
      method: "POST",
      authOptions,
    });
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        reason: result.reason,
      };
    }
    const okValue = result.payload?.ok === true;
    return {
      ok: okValue,
      status: result.status,
      sessionId:
        typeof result.payload?.sessionId === "string" ? result.payload.sessionId : normalizedSessionId,
      roomInventoryChanged: result.payload?.roomInventoryChanged === true,
      principal: isRecord(result.payload?.principal) ? (result.payload.principal as AdminPrincipal) : null,
    };
  }

  async removeParticipant(
    sessionId: string,
    playerId: string,
    authOptions: AdminRequestAuthOptions = {}
  ): Promise<AdminMutationResult> {
    const normalizedSessionId = sessionId.trim();
    const normalizedPlayerId = playerId.trim();
    if (!normalizedSessionId) {
      return {
        ok: false,
        reason: "invalid_session_id",
      };
    }
    if (!normalizedPlayerId) {
      return {
        ok: false,
        reason: "invalid_player_id",
      };
    }
    const path = `/admin/sessions/${encodeURIComponent(normalizedSessionId)}/participants/${encodeURIComponent(normalizedPlayerId)}/remove`;
    const result = await this.requestJson(path, {
      method: "POST",
      authOptions,
    });
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        reason: result.reason,
      };
    }
    const okValue = result.payload?.ok === true;
    return {
      ok: okValue,
      status: result.status,
      sessionId:
        typeof result.payload?.sessionId === "string" ? result.payload.sessionId : normalizedSessionId,
      playerId:
        typeof result.payload?.playerId === "string" ? result.payload.playerId : normalizedPlayerId,
      sessionExpired: result.payload?.sessionExpired === true,
      roomInventoryChanged: result.payload?.roomInventoryChanged === true,
      principal: isRecord(result.payload?.principal) ? (result.payload.principal as AdminPrincipal) : null,
    };
  }

  private async requestJson(
    path: string,
    options: {
      method: "GET" | "PUT" | "POST";
      body?: unknown;
      authOptions?: AdminRequestAuthOptions;
    }
  ): Promise<{
    ok: boolean;
    status?: number;
    reason?: string;
    payload: Record<string, unknown> | null;
  }> {
    const headers = this.buildHeaders(options.authOptions, options.body !== undefined);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const payload = await parseJson(response);
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          reason: extractFailureReason(payload),
          payload,
        };
      }
      return {
        ok: true,
        status: response.status,
        payload,
      };
    } catch (error) {
      log.warn(`Admin request failed for ${options.method} ${path}`, error);
      return {
        ok: false,
        reason: "network_error",
        payload: null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(
    authOptions: AdminRequestAuthOptions = {},
    includeContentType: boolean
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    if (includeContentType) {
      headers["content-type"] = "application/json";
    }
    const adminToken = (authOptions.adminToken ?? this.getAdminToken()).trim();
    if (adminToken) {
      headers["x-admin-token"] = adminToken;
    }
    const firebaseIdToken = (authOptions.firebaseIdToken ?? "").trim();
    if (firebaseIdToken) {
      headers.authorization = `Bearer ${firebaseIdToken}`;
    }
    return headers;
  }
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function extractFailureReason(payload: Record<string, unknown> | null): string {
  if (typeof payload?.reason === "string" && payload.reason.trim()) {
    return payload.reason.trim();
  }
  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }
  return "admin_request_failed";
}

async function parseJson(response: Response): Promise<Record<string, unknown> | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAdminMonitorOverview(payload: unknown): payload is AdminMonitorOverview {
  if (!isRecord(payload)) {
    return false;
  }
  if (typeof payload.timestamp !== "number" || !Number.isFinite(payload.timestamp)) {
    return false;
  }
  if (
    payload.accessMode !== "open" &&
    payload.accessMode !== "token" &&
    payload.accessMode !== "role" &&
    payload.accessMode !== "hybrid" &&
    payload.accessMode !== "disabled"
  ) {
    return false;
  }
  if (!isRecord(payload.metrics)) {
    return false;
  }
  if (!Array.isArray(payload.rooms)) {
    return false;
  }
  return true;
}

function isAdminRoleRecord(payload: unknown): payload is AdminRoleRecord {
  if (!isRecord(payload)) {
    return false;
  }
  if (typeof payload.uid !== "string" || !payload.uid.trim()) {
    return false;
  }
  if (
    payload.role !== null &&
    payload.role !== "viewer" &&
    payload.role !== "operator" &&
    payload.role !== "owner"
  ) {
    return false;
  }
  return true;
}

function isAdminRolesPayload(
  payload: Record<string, unknown> | null
): payload is { roles: AdminRoleRecord[]; principal?: AdminPrincipal | null } {
  if (!isRecord(payload) || !Array.isArray(payload.roles)) {
    return false;
  }
  return payload.roles.every((entry) => isAdminRoleRecord(entry));
}

function isAdminRoleUpdatePayload(
  payload: Record<string, unknown> | null
): payload is { roleRecord: AdminRoleRecord; principal?: AdminPrincipal | null } {
  if (!isRecord(payload) || !isAdminRoleRecord(payload.roleRecord)) {
    return false;
  }
  return true;
}

export const adminApiService = new AdminApiService();

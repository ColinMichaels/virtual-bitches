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
  avatarUrl?: string;
  providerId?: string;
  isBot: boolean;
  isSeated?: boolean;
  isReady: boolean;
  isComplete: boolean;
  score: number;
  remainingDice: number;
  queuedForNextGame?: boolean;
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
  conductTrackedPlayerCount?: number;
  conductMutedPlayerCount?: number;
  activeTurnTimeoutLoops: number;
  activeBotLoops: number;
  turnTimeoutAutoAdvanceCount: number;
  botTurnAutoAdvanceCount: number;
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

export interface AdminStorageDiagnostics {
  backend: string;
  firestorePrefix?: string;
  firestoreCollections?: string[];
}

export interface AdminStorageSectionSummary {
  section: string;
  count: number;
}

export type AdminAuditAction = "role_upsert" | "session_expire" | "participant_remove" | string;

export interface AdminAuditEntry {
  id: string;
  timestamp: number;
  action: AdminAuditAction;
  summary?: string;
  actor: {
    uid?: string | null;
    email?: string;
    role?: AdminUserRole | null;
    authType?: string;
  };
  target: {
    uid?: string;
    role?: AdminUserRole | null;
    sessionId?: string;
    playerId?: string;
  };
}

export interface AdminSessionConductPolicy {
  enabled?: boolean;
  filterEnabled?: boolean;
  strikeLimit?: number;
  strikeWindowMs?: number;
  muteDurationMs?: number;
  autoBanStrikeLimit?: number;
}

export interface AdminSessionConductPlayerRecord {
  playerId: string;
  displayName?: string | null;
  participantPresent: boolean;
  isBot: boolean;
  strikeCount: number;
  totalStrikes: number;
  strikeEvents: number[];
  lastViolationAt: number | null;
  mutedUntil: number | null;
  isMuted: boolean;
  muteRemainingMs: number;
}

export interface AdminSessionConductState {
  timestamp: number;
  sessionId: string;
  roomCode?: string;
  policy?: AdminSessionConductPolicy;
  totalPlayerRecords: number;
  players: AdminSessionConductPlayerRecord[];
}

export interface AdminSessionConductResult {
  conduct: AdminSessionConductState | null;
  status?: number;
  reason?: string;
  principal?: AdminPrincipal | null;
}

export interface AdminSessionChannelMessageOptions {
  channel?: "public" | "direct";
  title?: string;
  message: string;
  topic?: string;
  severity?: "info" | "success" | "warning" | "error";
  sourceRole?: "admin" | "service" | "system";
  sourcePlayerId?: string;
  targetPlayerId?: string;
}

export type AdminModerationAction = "kick" | "ban";

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

export interface AdminStorageResult {
  storage: AdminStorageDiagnostics | null;
  sections: AdminStorageSectionSummary[] | null;
  status?: number;
  reason?: string;
  principal?: AdminPrincipal | null;
}

export interface AdminAuditResult {
  entries: AdminAuditEntry[] | null;
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

  async getAudit(
    limit: number = 60,
    authOptions: AdminRequestAuthOptions = {}
  ): Promise<AdminAuditResult> {
    const bounded = Math.max(1, Math.min(250, Math.floor(limit)));
    const result = await this.requestJson(`/admin/audit?limit=${bounded}`, {
      method: "GET",
      authOptions,
    });
    if (!result.ok) {
      return {
        entries: null,
        status: result.status,
        reason: result.reason,
      };
    }
    if (!isAdminAuditPayload(result.payload)) {
      return {
        entries: null,
        status: result.status,
        reason: "invalid_admin_payload",
      };
    }
    return {
      entries: result.payload.entries,
      status: result.status,
      principal: result.payload.principal ?? null,
    };
  }

  async getStorage(authOptions: AdminRequestAuthOptions = {}): Promise<AdminStorageResult> {
    const result = await this.requestJson("/admin/storage", {
      method: "GET",
      authOptions,
    });
    if (!result.ok) {
      return {
        storage: null,
        sections: null,
        status: result.status,
        reason: result.reason,
      };
    }
    if (!isAdminStoragePayload(result.payload)) {
      return {
        storage: null,
        sections: null,
        status: result.status,
        reason: "invalid_admin_payload",
      };
    }
    return {
      storage: result.payload.storage,
      sections: result.payload.sections,
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

  async getSessionConductState(
    sessionId: string,
    limit: number = 200,
    authOptions: AdminRequestAuthOptions = {}
  ): Promise<AdminSessionConductResult> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return {
        conduct: null,
        reason: "invalid_session_id",
      };
    }
    const bounded = Math.max(1, Math.min(500, Math.floor(limit)));
    const path = `/admin/sessions/${encodeURIComponent(normalizedSessionId)}/conduct?limit=${bounded}`;
    const result = await this.requestJson(path, {
      method: "GET",
      authOptions,
    });
    if (!result.ok) {
      return {
        conduct: null,
        status: result.status,
        reason: result.reason,
      };
    }
    if (!isAdminSessionConductState(result.payload)) {
      return {
        conduct: null,
        status: result.status,
        reason: "invalid_admin_payload",
      };
    }
    return {
      conduct: result.payload,
      status: result.status,
      principal: isRecord(result.payload?.principal) ? (result.payload.principal as AdminPrincipal) : null,
    };
  }

  async sendSessionChannelMessage(
    sessionId: string,
    payload: AdminSessionChannelMessageOptions,
    authOptions: AdminRequestAuthOptions = {}
  ): Promise<AdminMutationResult> {
    const normalizedSessionId = sessionId.trim();
    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    if (!normalizedSessionId) {
      return {
        ok: false,
        reason: "invalid_session_id",
      };
    }
    if (!message) {
      return {
        ok: false,
        reason: "missing_message",
      };
    }
    if (payload.channel === "direct" && !payload.targetPlayerId?.trim()) {
      return {
        ok: false,
        reason: "missing_target_player",
      };
    }
    const path = `/admin/sessions/${encodeURIComponent(normalizedSessionId)}/channel/messages`;
    const result = await this.requestJson(path, {
      method: "POST",
      body: {
        channel: payload.channel === "direct" ? "direct" : "public",
        title: payload.title,
        message,
        topic: payload.topic,
        severity: payload.severity,
        sourceRole: payload.sourceRole,
        sourcePlayerId: payload.sourcePlayerId,
        targetPlayerId: payload.targetPlayerId,
      },
      authOptions,
    });
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        reason: result.reason,
      };
    }
    return {
      ok: result.payload?.ok === true,
      status: result.status,
      sessionId:
        typeof result.payload?.sessionId === "string" ? result.payload.sessionId : normalizedSessionId,
      playerId:
        typeof result.payload?.targetPlayerId === "string"
          ? result.payload.targetPlayerId
          : payload.targetPlayerId?.trim() || undefined,
      principal: isRecord(result.payload?.principal) ? (result.payload.principal as AdminPrincipal) : null,
    };
  }

  async moderateSessionParticipant(
    sessionId: string,
    requesterPlayerId: string,
    targetPlayerId: string,
    action: AdminModerationAction,
    authOptions: AdminRequestAuthOptions = {}
  ): Promise<AdminMutationResult> {
    const normalizedSessionId = sessionId.trim();
    const normalizedRequesterPlayerId = requesterPlayerId.trim();
    const normalizedTargetPlayerId = targetPlayerId.trim();
    if (!normalizedSessionId) {
      return {
        ok: false,
        reason: "invalid_session_id",
      };
    }
    if (!normalizedRequesterPlayerId) {
      return {
        ok: false,
        reason: "invalid_requester_player_id",
      };
    }
    if (!normalizedTargetPlayerId) {
      return {
        ok: false,
        reason: "invalid_target_player_id",
      };
    }
    if (action !== "kick" && action !== "ban") {
      return {
        ok: false,
        reason: "invalid_moderation_action",
      };
    }

    const path = `/multiplayer/sessions/${encodeURIComponent(normalizedSessionId)}/moderate`;
    const result = await this.requestJson(path, {
      method: "POST",
      body: {
        requesterPlayerId: normalizedRequesterPlayerId,
        targetPlayerId: normalizedTargetPlayerId,
        action,
      },
      authOptions,
    });
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        reason: result.reason,
      };
    }
    return {
      ok: result.payload?.ok === true,
      status: result.status,
      sessionId:
        typeof result.payload?.sessionId === "string" ? result.payload.sessionId : normalizedSessionId,
      playerId:
        typeof result.payload?.targetPlayerId === "string"
          ? result.payload.targetPlayerId
          : normalizedTargetPlayerId,
      sessionExpired: result.payload?.sessionExpired === true,
      roomInventoryChanged: result.payload?.roomInventoryChanged === true,
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

function isAdminAuditEntry(payload: unknown): payload is AdminAuditEntry {
  if (!isRecord(payload)) {
    return false;
  }
  if (typeof payload.id !== "string" || !payload.id.trim()) {
    return false;
  }
  if (typeof payload.timestamp !== "number" || !Number.isFinite(payload.timestamp)) {
    return false;
  }
  if (typeof payload.action !== "string" || !payload.action.trim()) {
    return false;
  }
  if (!isRecord(payload.actor) || !isRecord(payload.target)) {
    return false;
  }
  return true;
}

function isAdminAuditPayload(
  payload: Record<string, unknown> | null
): payload is { entries: AdminAuditEntry[]; principal?: AdminPrincipal | null } {
  if (!isRecord(payload) || !Array.isArray(payload.entries)) {
    return false;
  }
  return payload.entries.every((entry) => isAdminAuditEntry(entry));
}

function isAdminStorageDiagnostics(payload: unknown): payload is AdminStorageDiagnostics {
  if (!isRecord(payload)) {
    return false;
  }
  if (typeof payload.backend !== "string" || !payload.backend.trim()) {
    return false;
  }
  return true;
}

function isAdminStorageSectionSummary(payload: unknown): payload is AdminStorageSectionSummary {
  if (!isRecord(payload)) {
    return false;
  }
  if (typeof payload.section !== "string" || !payload.section.trim()) {
    return false;
  }
  if (typeof payload.count !== "number" || !Number.isFinite(payload.count)) {
    return false;
  }
  return true;
}

function isAdminStoragePayload(
  payload: Record<string, unknown> | null
): payload is {
  storage: AdminStorageDiagnostics;
  sections: AdminStorageSectionSummary[];
  principal?: AdminPrincipal | null;
} {
  if (!isRecord(payload)) {
    return false;
  }
  if (!isAdminStorageDiagnostics(payload.storage)) {
    return false;
  }
  if (!Array.isArray(payload.sections)) {
    return false;
  }
  return payload.sections.every((entry) => isAdminStorageSectionSummary(entry));
}

function isAdminSessionConductPlayerRecord(payload: unknown): payload is AdminSessionConductPlayerRecord {
  if (!isRecord(payload)) {
    return false;
  }
  if (typeof payload.playerId !== "string" || !payload.playerId.trim()) {
    return false;
  }
  if (typeof payload.participantPresent !== "boolean") {
    return false;
  }
  if (typeof payload.isBot !== "boolean") {
    return false;
  }
  if (typeof payload.strikeCount !== "number" || !Number.isFinite(payload.strikeCount)) {
    return false;
  }
  if (typeof payload.totalStrikes !== "number" || !Number.isFinite(payload.totalStrikes)) {
    return false;
  }
  if (!Array.isArray(payload.strikeEvents)) {
    return false;
  }
  return true;
}

function isAdminSessionConductState(payload: unknown): payload is AdminSessionConductState {
  if (!isRecord(payload)) {
    return false;
  }
  if (typeof payload.timestamp !== "number" || !Number.isFinite(payload.timestamp)) {
    return false;
  }
  if (typeof payload.sessionId !== "string" || !payload.sessionId.trim()) {
    return false;
  }
  if (typeof payload.totalPlayerRecords !== "number" || !Number.isFinite(payload.totalPlayerRecords)) {
    return false;
  }
  if (!Array.isArray(payload.players)) {
    return false;
  }
  return payload.players.every((entry) => isAdminSessionConductPlayerRecord(entry));
}

export const adminApiService = new AdminApiService();

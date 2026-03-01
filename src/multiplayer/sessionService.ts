import { logger } from "../utils/logger.js";
import {
  backendApiService,
  type MultiplayerGameDifficulty,
  type MultiplayerJoinFailureReason,
  type MultiplayerModerationAction,
  type MultiplayerModerationResult,
  type MultiplayerParticipantStateAction,
  type MultiplayerSessionRecord,
} from "../services/backendApi.js";
import type { UnifiedGameCreateConfig } from "../gameplay/gameConfig.js";
import { getLocalPlayerId } from "../services/playerIdentity.js";
import { authSessionService } from "../services/authSession.js";

const log = logger.create("MultiplayerSession");

const HEARTBEAT_INTERVAL_MS = 15000;
type JoinSessionOptions = {
  displayName?: string;
  avatarUrl?: string;
  providerId?: string;
  blockedPlayerIds?: string[];
  botCount?: number;
  gameDifficulty?: MultiplayerGameDifficulty;
};

function normalizeMultiplayerDifficulty(value: unknown): MultiplayerGameDifficulty | undefined {
  if (value === "easy" || value === "normal" || value === "hard") {
    return value;
  }
  return undefined;
}

export class MultiplayerSessionService {
  private readonly playerId: string;
  private activeSession: MultiplayerSessionRecord | null = null;
  private heartbeatHandle?: ReturnType<typeof setInterval>;
  private lastJoinFailureReason: MultiplayerJoinFailureReason | null = null;

  constructor(playerId: string = getLocalPlayerId()) {
    this.playerId = playerId;
  }

  getPlayerId(): string {
    return this.playerId;
  }

  getActiveSession(): MultiplayerSessionRecord | null {
    return this.activeSession;
  }

  getLastJoinFailureReason(): MultiplayerJoinFailureReason | null {
    return this.lastJoinFailureReason;
  }

  async createSession(
    options: {
      roomCode?: string;
      displayName?: string;
      avatarUrl?: string;
      providerId?: string;
      blockedPlayerIds?: string[];
      botCount?: number;
      gameDifficulty?: MultiplayerGameDifficulty;
      demoSpeedMode?: boolean;
      gameConfig?: UnifiedGameCreateConfig;
    } = {}
  ): Promise<MultiplayerSessionRecord | null> {
    const created = await backendApiService.createMultiplayerSession({
      playerId: this.playerId,
      roomCode: options.roomCode,
      displayName: options.displayName,
      avatarUrl: options.avatarUrl,
      providerId: options.providerId,
      blockedPlayerIds: options.blockedPlayerIds,
      botCount: options.botCount,
      gameDifficulty: options.gameDifficulty,
      demoSpeedMode: options.demoSpeedMode === true,
      gameConfig: options.gameConfig,
    });
    if (!created) return null;

    this.setActiveSession(created);
    return created;
  }

  async joinSession(
    sessionId: string,
    displayNameOrOptions?: string | JoinSessionOptions
  ): Promise<MultiplayerSessionRecord | null> {
    const joinOptions = this.normalizeJoinSessionOptions(displayNameOrOptions);
    const joinResult = await backendApiService.joinMultiplayerSession(sessionId, {
      playerId: this.playerId,
      displayName: joinOptions.displayName,
      avatarUrl: joinOptions.avatarUrl,
      providerId: joinOptions.providerId,
      blockedPlayerIds: joinOptions.blockedPlayerIds,
      botCount: joinOptions.botCount,
    });
    if (!joinResult.session) {
      this.lastJoinFailureReason = joinResult.reason ?? "unknown";
      return null;
    }

    this.lastJoinFailureReason = null;
    this.setActiveSession(joinResult.session);
    return joinResult.session;
  }

  async joinRoomByCode(
    roomCode: string,
    displayNameOrOptions?: string | JoinSessionOptions
  ): Promise<MultiplayerSessionRecord | null> {
    const joinOptions = this.normalizeJoinSessionOptions(displayNameOrOptions);
    const joinResult = await backendApiService.joinMultiplayerRoomByCode(roomCode, {
      playerId: this.playerId,
      displayName: joinOptions.displayName,
      avatarUrl: joinOptions.avatarUrl,
      providerId: joinOptions.providerId,
      blockedPlayerIds: joinOptions.blockedPlayerIds,
      botCount: joinOptions.botCount,
      gameDifficulty: joinOptions.gameDifficulty,
    });
    if (!joinResult.session) {
      this.lastJoinFailureReason = joinResult.reason ?? "unknown";
      return null;
    }

    this.lastJoinFailureReason = null;
    this.setActiveSession(joinResult.session);
    return joinResult.session;
  }

  async leaveSession(): Promise<void> {
    const current = this.activeSession;
    if (!current) return;

    this.clearHeartbeat();
    await backendApiService.leaveMultiplayerSession(current.sessionId, this.playerId);
    this.activeSession = null;
  }

  async queueForNextGame(): Promise<MultiplayerSessionRecord | null> {
    const current = this.activeSession;
    if (!current) return null;

    const response = await backendApiService.queueMultiplayerForNextGame(
      current.sessionId,
      this.playerId
    );
    if (!response?.ok) {
      if (response?.reason === "session_expired") {
        this.handleSessionExpired("session_expired");
      } else {
        log.warn(
          `Failed to queue for next multiplayer game: ${current.sessionId} (${response?.reason ?? "unknown"})`
        );
      }
      return null;
    }

    if (response.session) {
      const synced = this.syncSessionState({
        sessionId: response.session.sessionId,
        roomCode: response.session.roomCode,
        participants: response.session.participants,
        standings: response.session.standings,
        turnState: response.session.turnState ?? null,
        sessionComplete: response.session.sessionComplete,
        completedAt: response.session.completedAt ?? null,
        gameStartedAt: response.session.gameStartedAt,
        nextGameStartsAt: response.session.nextGameStartsAt,
        nextGameAutoStartDelayMs: response.session.nextGameAutoStartDelayMs,
        expiresAt: response.session.expiresAt,
        serverNow: response.session.serverNow,
        gameDifficulty: response.session.gameDifficulty,
        gameConfig: response.session.gameConfig,
        demoMode: response.session.demoMode,
        demoAutoRun: response.session.demoAutoRun,
        demoSpeedMode: response.session.demoSpeedMode,
        ownerPlayerId: response.session.ownerPlayerId,
      });
      if (synced) {
        return synced;
      }
    }

    return this.activeSession;
  }

  async updateParticipantState(
    action: MultiplayerParticipantStateAction
  ): Promise<MultiplayerSessionRecord | null> {
    const current = this.activeSession;
    if (!current) return null;

    const response = await backendApiService.updateMultiplayerParticipantState(
      current.sessionId,
      this.playerId,
      action
    );
    if (!response?.ok) {
      if (response?.reason === "session_expired") {
        this.handleSessionExpired("session_expired");
      } else {
        log.warn(
          `Failed to update multiplayer participant state: ${current.sessionId} (${response?.reason ?? "unknown"})`
        );
      }
      return null;
    }

    if (response.session) {
      const synced = this.syncSessionState({
        sessionId: response.session.sessionId,
        roomCode: response.session.roomCode,
        participants: response.session.participants,
        standings: response.session.standings,
        turnState: response.session.turnState ?? null,
        sessionComplete: response.session.sessionComplete,
        completedAt: response.session.completedAt ?? null,
        gameStartedAt: response.session.gameStartedAt,
        nextGameStartsAt: response.session.nextGameStartsAt,
        nextGameAutoStartDelayMs: response.session.nextGameAutoStartDelayMs,
        expiresAt: response.session.expiresAt,
        serverNow: response.session.serverNow,
        gameDifficulty: response.session.gameDifficulty,
        gameConfig: response.session.gameConfig,
        demoMode: response.session.demoMode,
        demoAutoRun: response.session.demoAutoRun,
        demoSpeedMode: response.session.demoSpeedMode,
        ownerPlayerId: response.session.ownerPlayerId,
      });
      if (synced) {
        return synced;
      }
    }

    return this.activeSession;
  }

  async moderateParticipant(
    targetPlayerId: string,
    action: MultiplayerModerationAction
  ): Promise<MultiplayerModerationResult> {
    const current = this.activeSession;
    if (!current) {
      return {
        ok: false,
        reason: "unknown_session",
      };
    }

    const result = await backendApiService.moderateMultiplayerParticipant(
      current.sessionId,
      this.playerId,
      targetPlayerId,
      action
    );
    if (!result.ok) {
      if (result.reason === "session_expired") {
        this.handleSessionExpired("session_expired");
      }
      return result;
    }

    if (result.session) {
      const synced = this.syncSessionState({
        sessionId: result.session.sessionId,
        roomCode: result.session.roomCode,
        participants: result.session.participants,
        standings: result.session.standings,
        turnState: result.session.turnState ?? null,
        sessionComplete: result.session.sessionComplete,
        completedAt: result.session.completedAt ?? null,
        gameStartedAt: result.session.gameStartedAt,
        nextGameStartsAt: result.session.nextGameStartsAt,
        nextGameAutoStartDelayMs: result.session.nextGameAutoStartDelayMs,
        expiresAt: result.session.expiresAt,
        serverNow: result.session.serverNow,
        gameDifficulty: result.session.gameDifficulty,
        gameConfig: result.session.gameConfig,
        demoMode: result.session.demoMode,
        demoAutoRun: result.session.demoAutoRun,
        demoSpeedMode: result.session.demoSpeedMode,
        ownerPlayerId: result.session.ownerPlayerId,
      });
      if (synced) {
        result.session = synced;
      }
    }

    return result;
  }

  async updateDemoControls(
    action: "pause" | "resume" | "speed_normal" | "speed_fast"
  ): Promise<MultiplayerSessionRecord | null> {
    const current = this.activeSession;
    if (!current) return null;

    const response = await backendApiService.updateMultiplayerDemoControls(
      current.sessionId,
      this.playerId,
      action
    );
    if (!response?.ok) {
      if (response?.reason === "session_expired") {
        this.handleSessionExpired("session_expired");
      } else {
        log.warn(
          `Failed to update multiplayer demo controls: ${current.sessionId} (${response?.reason ?? "unknown"})`
        );
      }
      return null;
    }

    if (response.session) {
      const synced = this.syncSessionState({
        sessionId: response.session.sessionId,
        roomCode: response.session.roomCode,
        participants: response.session.participants,
        standings: response.session.standings,
        turnState: response.session.turnState ?? null,
        sessionComplete: response.session.sessionComplete,
        completedAt: response.session.completedAt ?? null,
        gameStartedAt: response.session.gameStartedAt,
        nextGameStartsAt: response.session.nextGameStartsAt,
        nextGameAutoStartDelayMs: response.session.nextGameAutoStartDelayMs,
        expiresAt: response.session.expiresAt,
        serverNow: response.session.serverNow,
        gameDifficulty: response.session.gameDifficulty,
        gameConfig: response.session.gameConfig,
        demoMode: response.session.demoMode,
        demoAutoRun: response.session.demoAutoRun,
        demoSpeedMode: response.session.demoSpeedMode,
        ownerPlayerId: response.session.ownerPlayerId,
      });
      if (synced) {
        return synced;
      }
    }

    return this.activeSession;
  }

  async refreshSessionAuth(): Promise<MultiplayerSessionRecord | null> {
    const current = this.activeSession;
    if (!current) return null;

    const refreshed = await backendApiService.refreshMultiplayerSessionAuth(
      current.sessionId,
      this.playerId
    );
    if (!refreshed) {
      log.warn(`Failed to refresh multiplayer session auth: ${current.sessionId}`);
      return null;
    }

    this.setActiveSession(refreshed);
    return refreshed;
  }

  syncSessionState(update: {
    sessionId?: string;
    roomCode?: string;
    participants?: MultiplayerSessionRecord["participants"];
    standings?: MultiplayerSessionRecord["standings"];
    turnState?: MultiplayerSessionRecord["turnState"];
    sessionComplete?: boolean;
    completedAt?: number | null;
    gameStartedAt?: number;
    nextGameStartsAt?: number | null;
    nextGameAutoStartDelayMs?: number;
    expiresAt?: number;
    serverNow?: number;
    gameDifficulty?: MultiplayerGameDifficulty;
    gameConfig?: MultiplayerSessionRecord["gameConfig"];
    demoMode?: boolean;
    demoAutoRun?: boolean;
    demoSpeedMode?: boolean;
    ownerPlayerId?: string;
  }): MultiplayerSessionRecord | null {
    const current = this.activeSession;
    if (!current) return null;

    if (
      typeof update.sessionId === "string" &&
      update.sessionId &&
      update.sessionId !== current.sessionId
    ) {
      return null;
    }

    const nextSession: MultiplayerSessionRecord = {
      ...current,
    };

    if (typeof update.roomCode === "string" && update.roomCode.trim().length > 0) {
      nextSession.roomCode = update.roomCode;
    }
    if (Array.isArray(update.participants)) {
      nextSession.participants = update.participants;
    }
    if (Array.isArray(update.standings)) {
      nextSession.standings = update.standings;
    }
    if (Object.prototype.hasOwnProperty.call(update, "turnState")) {
      nextSession.turnState = update.turnState ?? null;
    }
    if (typeof update.sessionComplete === "boolean") {
      nextSession.sessionComplete = update.sessionComplete;
    }
    if (Object.prototype.hasOwnProperty.call(update, "completedAt")) {
      nextSession.completedAt =
        typeof update.completedAt === "number" && Number.isFinite(update.completedAt)
          ? Math.floor(update.completedAt)
          : null;
    }
    if (typeof update.gameStartedAt === "number" && Number.isFinite(update.gameStartedAt)) {
      nextSession.gameStartedAt = Math.floor(update.gameStartedAt);
    }
    if (Object.prototype.hasOwnProperty.call(update, "nextGameStartsAt")) {
      if (typeof update.nextGameStartsAt === "number" && Number.isFinite(update.nextGameStartsAt)) {
        nextSession.nextGameStartsAt = Math.floor(update.nextGameStartsAt);
      } else if (Object.prototype.hasOwnProperty.call(nextSession, "nextGameStartsAt")) {
        delete nextSession.nextGameStartsAt;
      }
    }
    if (
      typeof update.nextGameAutoStartDelayMs === "number" &&
      Number.isFinite(update.nextGameAutoStartDelayMs)
    ) {
      nextSession.nextGameAutoStartDelayMs = Math.max(
        5000,
        Math.floor(update.nextGameAutoStartDelayMs)
      );
    }
    if (typeof update.expiresAt === "number" && Number.isFinite(update.expiresAt)) {
      nextSession.expiresAt = Math.floor(update.expiresAt);
    }
    if (typeof update.serverNow === "number" && Number.isFinite(update.serverNow)) {
      nextSession.serverNow = Math.floor(update.serverNow);
    }
    if (Object.prototype.hasOwnProperty.call(update, "gameDifficulty")) {
      const normalizedDifficulty = normalizeMultiplayerDifficulty(update.gameDifficulty);
      if (normalizedDifficulty) {
        nextSession.gameDifficulty = normalizedDifficulty;
      }
    }
    if (Object.prototype.hasOwnProperty.call(update, "gameConfig")) {
      if (update.gameConfig && typeof update.gameConfig === "object") {
        nextSession.gameConfig = update.gameConfig;
      } else if (Object.prototype.hasOwnProperty.call(nextSession, "gameConfig")) {
        delete nextSession.gameConfig;
      }
    }
    if (Object.prototype.hasOwnProperty.call(update, "demoMode")) {
      nextSession.demoMode = update.demoMode === true;
    }
    if (Object.prototype.hasOwnProperty.call(update, "demoAutoRun")) {
      nextSession.demoAutoRun = update.demoAutoRun === true;
    }
    if (Object.prototype.hasOwnProperty.call(update, "demoSpeedMode")) {
      nextSession.demoSpeedMode = update.demoSpeedMode === true;
    }
    if (Object.prototype.hasOwnProperty.call(update, "ownerPlayerId")) {
      nextSession.ownerPlayerId =
        typeof update.ownerPlayerId === "string" && update.ownerPlayerId.trim().length > 0
          ? update.ownerPlayerId.trim()
          : undefined;
    }

    this.activeSession = nextSession;
    return nextSession;
  }

  dispose(): void {
    this.clearHeartbeat();
    this.activeSession = null;
  }

  private setActiveSession(session: MultiplayerSessionRecord): void {
    const {
      gameDifficulty: _ignoredDifficulty,
      ownerPlayerId: _ignoredOwnerPlayerId,
      ...sessionWithoutDifficulty
    } = session;
    const normalizedDifficulty = normalizeMultiplayerDifficulty(session.gameDifficulty);
    const normalizedDemoMode = session.demoMode === true || session.demoSpeedMode === true;
    const normalizedDemoAutoRun = normalizedDemoMode && session.demoAutoRun !== false;
    const normalizedDemoSpeedMode = normalizedDemoMode && session.demoSpeedMode === true;
    const normalizedOwnerPlayerId =
      typeof session.ownerPlayerId === "string" && session.ownerPlayerId.trim().length > 0
        ? session.ownerPlayerId.trim()
        : undefined;
    const normalizedSession = normalizedDifficulty
      ? {
          ...sessionWithoutDifficulty,
          gameDifficulty: normalizedDifficulty,
          demoMode: normalizedDemoMode,
          demoAutoRun: normalizedDemoAutoRun,
          demoSpeedMode: normalizedDemoSpeedMode,
          ...(normalizedOwnerPlayerId ? { ownerPlayerId: normalizedOwnerPlayerId } : {}),
        }
      : {
          ...sessionWithoutDifficulty,
          demoMode: normalizedDemoMode,
          demoAutoRun: normalizedDemoAutoRun,
          demoSpeedMode: normalizedDemoSpeedMode,
          ...(normalizedOwnerPlayerId ? { ownerPlayerId: normalizedOwnerPlayerId } : {}),
        };
    this.activeSession = normalizedSession;
    this.lastJoinFailureReason = null;
    if (session.auth?.accessToken) {
      authSessionService.setTokens(session.auth);
    }
    this.clearHeartbeat();
    this.heartbeatHandle = setInterval(() => {
      void this.sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    log.info(`Active multiplayer session: ${session.sessionId}`);
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.activeSession) return;

    const response = await backendApiService.heartbeatMultiplayerSession(
      this.activeSession.sessionId,
      this.playerId
    );
    if (!response?.ok) {
      if (response?.reason === "session_expired") {
        this.handleSessionExpired("session_expired");
        return;
      }
      log.warn(`Session heartbeat failed: ${this.activeSession.sessionId}`);
    }
  }

  private handleSessionExpired(reason: string): void {
    if (!this.activeSession) return;
    const expiredSessionId = this.activeSession.sessionId;
    this.clearHeartbeat();
    this.activeSession = null;
    authSessionService.clear("multiplayer_session_expired");
    this.dispatchEvent("multiplayer:sessionExpired", {
      reason,
      sessionId: expiredSessionId,
    });
    log.warn(`Multiplayer session expired: ${expiredSessionId} (${reason})`);
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatHandle) return;
    clearInterval(this.heartbeatHandle);
    this.heartbeatHandle = undefined;
  }

  private normalizeJoinSessionOptions(
    displayNameOrOptions?: string | JoinSessionOptions
  ): JoinSessionOptions {
    if (typeof displayNameOrOptions === "string") {
      return {
        displayName: displayNameOrOptions,
      };
    }
    const options = displayNameOrOptions ?? {};
    const hasDisplayName =
      typeof options.displayName === "string" && options.displayName.trim().length > 0;
    const hasAvatarUrl =
      typeof options.avatarUrl === "string" && options.avatarUrl.trim().length > 0;
    const hasProviderId =
      typeof options.providerId === "string" && options.providerId.trim().length > 0;
    const hasBlockedPlayerIds = Array.isArray(options.blockedPlayerIds);
    const parsedBotCount =
      typeof options.botCount === "number" && Number.isFinite(options.botCount)
        ? Math.max(0, Math.floor(options.botCount))
        : undefined;
    const blockedPlayerIds = hasBlockedPlayerIds
      ? options.blockedPlayerIds
          ?.filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index)
      : undefined;
    const parsedGameDifficulty = normalizeMultiplayerDifficulty(options.gameDifficulty);
    return {
      displayName: hasDisplayName ? options.displayName : undefined,
      avatarUrl: hasAvatarUrl ? options.avatarUrl : undefined,
      providerId: hasProviderId ? options.providerId : undefined,
      blockedPlayerIds,
      botCount: parsedBotCount,
      gameDifficulty: parsedGameDifficulty,
    };
  }

  private dispatchEvent(type: string, detail: unknown): void {
    if (typeof document === "undefined" || typeof CustomEvent === "undefined") {
      return;
    }
    document.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

import { logger } from "../utils/logger.js";
import { backendApiService, type MultiplayerSessionRecord } from "../services/backendApi.js";
import { getLocalPlayerId } from "../services/playerIdentity.js";
import { authSessionService } from "../services/authSession.js";

const log = logger.create("MultiplayerSession");

const HEARTBEAT_INTERVAL_MS = 15000;

export class MultiplayerSessionService {
  private readonly playerId: string;
  private activeSession: MultiplayerSessionRecord | null = null;
  private heartbeatHandle?: ReturnType<typeof setInterval>;

  constructor(playerId: string = getLocalPlayerId()) {
    this.playerId = playerId;
  }

  getPlayerId(): string {
    return this.playerId;
  }

  getActiveSession(): MultiplayerSessionRecord | null {
    return this.activeSession;
  }

  async createSession(
    options: {
      roomCode?: string;
      botCount?: number;
    } = {}
  ): Promise<MultiplayerSessionRecord | null> {
    const created = await backendApiService.createMultiplayerSession({
      playerId: this.playerId,
      roomCode: options.roomCode,
      botCount: options.botCount,
    });
    if (!created) return null;

    this.setActiveSession(created);
    return created;
  }

  async joinSession(sessionId: string, displayName?: string): Promise<MultiplayerSessionRecord | null> {
    const joined = await backendApiService.joinMultiplayerSession(sessionId, {
      playerId: this.playerId,
      displayName,
    });
    if (!joined) return null;

    this.setActiveSession(joined);
    return joined;
  }

  async leaveSession(): Promise<void> {
    const current = this.activeSession;
    if (!current) return;

    this.clearHeartbeat();
    await backendApiService.leaveMultiplayerSession(current.sessionId, this.playerId);
    this.activeSession = null;
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
    expiresAt?: number;
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
    if (typeof update.expiresAt === "number" && Number.isFinite(update.expiresAt)) {
      nextSession.expiresAt = Math.floor(update.expiresAt);
    }

    this.activeSession = nextSession;
    return nextSession;
  }

  dispose(): void {
    this.clearHeartbeat();
    this.activeSession = null;
  }

  private setActiveSession(session: MultiplayerSessionRecord): void {
    this.activeSession = session;
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

  private dispatchEvent(type: string, detail: unknown): void {
    if (typeof document === "undefined" || typeof CustomEvent === "undefined") {
      return;
    }
    document.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

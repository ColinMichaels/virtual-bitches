import { logger } from "../utils/logger.js";
import { environment } from "@env";
import type { CameraAttackMessage } from "../chaos/types.js";
import type { ParticleNetworkEvent } from "../services/particleService.js";

const log = logger.create("MultiplayerNetwork");

const READY_STATE_CONNECTING = 0;
const READY_STATE_OPEN = 1;
const READY_STATE_CLOSED = 3;
const AUTH_RECOVERY_COOLDOWN_MS = 3000;

export interface WebSocketLike {
  readonly readyState: number;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface MultiplayerNetworkOptions {
  wsUrl?: string;
  eventTarget?: EventTarget;
  autoReconnect?: boolean;
  reconnectDelayMs?: number;
  reconnectMaxDelayMs?: number;
  reconnectBackoffMultiplier?: number;
  webSocketFactory?: (url: string) => WebSocketLike;
  onAuthExpired?: () => Promise<string | undefined> | string | undefined;
}

interface WsErrorMessage {
  type: "error";
  code: string;
  message?: string;
}

export interface MultiplayerGameUpdateMessage {
  type: "game_update";
  id?: string;
  playerId?: string;
  sourcePlayerId?: string;
  targetPlayerId?: string;
  title: string;
  content: string;
  date?: string;
  version?: string;
  updateType?: "feature" | "bugfix" | "announcement" | "alert";
  timestamp?: number;
  bot?: boolean;
}

export interface MultiplayerPlayerNotificationMessage {
  type: "player_notification";
  id?: string;
  playerId?: string;
  sourcePlayerId?: string;
  title?: string;
  message: string;
  severity?: "info" | "success" | "warning" | "error";
  targetPlayerId?: string;
  timestamp?: number;
  bot?: boolean;
}

export type MultiplayerRoomChannelType = "public" | "direct";

export interface MultiplayerRoomChannelMessage {
  type: "room_channel";
  id?: string;
  channel: MultiplayerRoomChannelType;
  topic?: string;
  playerId?: string;
  sourcePlayerId?: string;
  sourceRole?: "player" | "admin" | "service" | "system" | "bot";
  title?: string;
  message: string;
  severity?: "info" | "success" | "warning" | "error";
  targetPlayerId?: string;
  timestamp?: number;
  bot?: boolean;
}

export type MultiplayerTurnPhase = "await_roll" | "await_score" | "ready_to_end";
export type MultiplayerGameDifficulty = "easy" | "normal" | "hard";

export interface MultiplayerTurnStartMessage {
  type: "turn_start";
  sessionId?: string;
  playerId: string;
  round?: number;
  turnNumber?: number;
  phase?: MultiplayerTurnPhase;
  activeRollServerId?: string | null;
  activeRoll?: MultiplayerTurnRollPayload | null;
  gameStartedAt?: number;
  turnExpiresAt?: number | null;
  turnTimeoutMs?: number;
  timestamp?: number;
  order?: string[];
  source?: string;
}

export interface MultiplayerTurnEndMessage {
  type: "turn_end";
  sessionId?: string;
  playerId?: string;
  round?: number;
  turnNumber?: number;
  timestamp?: number;
  source?: string;
}

export interface MultiplayerTurnTimeoutWarningMessage {
  type: "turn_timeout_warning";
  sessionId?: string;
  playerId?: string;
  round?: number;
  turnNumber?: number;
  turnExpiresAt?: number;
  remainingMs?: number;
  timeoutMs?: number;
  timestamp?: number;
  source?: string;
}

export interface MultiplayerTurnAutoAdvancedMessage {
  type: "turn_auto_advanced";
  sessionId?: string;
  playerId?: string;
  round?: number;
  turnNumber?: number;
  timeoutMs?: number;
  reason?: string;
  timestamp?: number;
  source?: string;
}

export type MultiplayerTurnActionType = "roll" | "score" | "select";

export interface MultiplayerTurnRollDieSnapshot {
  dieId: string;
  sides: number;
  value?: number;
}

export interface MultiplayerTurnRollPayload {
  rollIndex: number;
  dice: MultiplayerTurnRollDieSnapshot[];
  serverRollId?: string;
}

export interface MultiplayerTurnScorePayload {
  selectedDiceIds: string[];
  points: number;
  rollServerId: string;
  projectedTotalScore?: number;
}

export interface MultiplayerTurnSelectPayload {
  selectedDiceIds: string[];
  rollServerId?: string;
}

export interface MultiplayerTurnActionMessage {
  type: "turn_action";
  sessionId?: string;
  playerId?: string;
  action: MultiplayerTurnActionType;
  roll?: MultiplayerTurnRollPayload;
  score?: MultiplayerTurnScorePayload;
  select?: MultiplayerTurnSelectPayload;
  round?: number;
  turnNumber?: number;
  timestamp?: number;
  source?: string;
}

export interface MultiplayerSessionStateParticipant {
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

export interface MultiplayerSessionStateStanding {
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

export interface MultiplayerSessionStateTurnSnapshot {
  order: string[];
  activeTurnPlayerId: string | null;
  round: number;
  turnNumber: number;
  phase?: MultiplayerTurnPhase;
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
  activeRollServerId?: string | null;
  turnExpiresAt?: number | null;
  turnTimeoutMs?: number;
  updatedAt: number;
}

export interface MultiplayerSessionStateMessage {
  type: "session_state";
  sessionId: string;
  roomCode: string;
  gameDifficulty?: MultiplayerGameDifficulty;
  ownerPlayerId?: string;
  participants: MultiplayerSessionStateParticipant[];
  standings?: MultiplayerSessionStateStanding[];
  turnState: MultiplayerSessionStateTurnSnapshot | null;
  sessionComplete?: boolean;
  completedAt?: number | null;
  createdAt: number;
  gameStartedAt?: number;
  nextGameStartsAt?: number | null;
  nextGameAutoStartDelayMs?: number;
  expiresAt?: number;
  serverNow?: number;
  timestamp?: number;
  source?: string;
}

function isCameraAttackMessage(value: unknown): value is CameraAttackMessage {
  if (!value || typeof value !== "object") return false;

  const msg = value as Partial<CameraAttackMessage>;
  return (
    msg.type === "chaos_attack" &&
    msg.attackType === "camera_effect" &&
    typeof msg.targetId === "string" &&
    typeof msg.effectType === "string" &&
    typeof msg.duration === "number" &&
    Number.isFinite(msg.duration) &&
    msg.duration > 0 &&
    typeof msg.intensity === "number" &&
    Number.isFinite(msg.intensity)
  );
}

function isParticleNetworkEvent(value: unknown): value is ParticleNetworkEvent {
  if (!value || typeof value !== "object") return false;

  const msg = value as Partial<ParticleNetworkEvent>;
  return (
    msg.type === "particle:emit" &&
    typeof msg.effectId === "string" &&
    !!msg.position &&
    typeof msg.position.x === "number" &&
    typeof msg.position.y === "number" &&
    typeof msg.position.z === "number"
  );
}

function isWsErrorMessage(value: unknown): value is WsErrorMessage {
  if (!value || typeof value !== "object") return false;

  const msg = value as Partial<WsErrorMessage>;
  return msg.type === "error" && typeof msg.code === "string";
}

function isMultiplayerGameUpdateMessage(value: unknown): value is MultiplayerGameUpdateMessage {
  if (!value || typeof value !== "object") return false;

  const msg = value as Partial<MultiplayerGameUpdateMessage>;
  return (
    msg.type === "game_update" &&
    typeof msg.title === "string" &&
    typeof msg.content === "string"
  );
}

function isMultiplayerPlayerNotificationMessage(
  value: unknown
): value is MultiplayerPlayerNotificationMessage {
  if (!value || typeof value !== "object") return false;

  const msg = value as Partial<MultiplayerPlayerNotificationMessage>;
  return msg.type === "player_notification" && typeof msg.message === "string";
}

function isMultiplayerRoomChannelMessage(
  value: unknown
): value is MultiplayerRoomChannelMessage {
  if (!value || typeof value !== "object") return false;

  const msg = value as Partial<MultiplayerRoomChannelMessage>;
  return (
    msg.type === "room_channel" &&
    (msg.channel === "public" || msg.channel === "direct") &&
    typeof msg.message === "string"
  );
}

function isMultiplayerTurnStartMessage(value: unknown): value is MultiplayerTurnStartMessage {
  if (!value || typeof value !== "object") return false;

  const msg = value as Partial<MultiplayerTurnStartMessage>;
  return msg.type === "turn_start" && typeof msg.playerId === "string";
}

function isMultiplayerTurnEndMessage(value: unknown): value is MultiplayerTurnEndMessage {
  if (!value || typeof value !== "object") return false;

  const msg = value as Partial<MultiplayerTurnEndMessage>;
  return msg.type === "turn_end";
}

function isMultiplayerTurnTimeoutWarningMessage(
  value: unknown
): value is MultiplayerTurnTimeoutWarningMessage {
  if (!value || typeof value !== "object") return false;

  const msg = value as Partial<MultiplayerTurnTimeoutWarningMessage>;
  return msg.type === "turn_timeout_warning";
}

function isMultiplayerTurnAutoAdvancedMessage(
  value: unknown
): value is MultiplayerTurnAutoAdvancedMessage {
  if (!value || typeof value !== "object") return false;

  const msg = value as Partial<MultiplayerTurnAutoAdvancedMessage>;
  return msg.type === "turn_auto_advanced";
}

function isMultiplayerTurnActionMessage(value: unknown): value is MultiplayerTurnActionMessage {
  if (!value || typeof value !== "object") return false;

  const msg = value as Partial<MultiplayerTurnActionMessage>;
  return (
    msg.type === "turn_action" &&
    (msg.action === "roll" || msg.action === "score" || msg.action === "select")
  );
}

function isMultiplayerSessionStateMessage(
  value: unknown
): value is MultiplayerSessionStateMessage {
  if (!value || typeof value !== "object") return false;

  const msg = value as Partial<MultiplayerSessionStateMessage>;
  return (
    msg.type === "session_state" &&
    typeof msg.sessionId === "string" &&
    typeof msg.roomCode === "string" &&
    Array.isArray(msg.participants)
  );
}

function isAuthExpiredCloseCode(code: number): boolean {
  return code === 4001 || code === 4003 || code === 4401 || code === 4403 || code === 4408;
}

function createCustomEvent<T>(type: string, detail: T): CustomEvent<T> {
  return new CustomEvent(type, { detail });
}

export class MultiplayerNetworkService {
  private wsUrl?: string;
  private readonly eventTarget: EventTarget;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly reconnectBackoffMultiplier: number;
  private readonly webSocketFactory: (url: string) => WebSocketLike;
  private readonly onAuthExpired?: () => Promise<string | undefined> | string | undefined;

  private socket: WebSocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private nextReconnectDelayMs = 3000;
  private reconnectAttemptCount = 0;
  private manuallyDisconnected = false;
  private bridgeEnabled = false;
  private authRecoveryInFlight = false;
  private socketOpenedSinceConnect = false;
  private lastAuthRecoveryAttemptAt = 0;

  private readonly onSocketOpen = () => {
    this.socketOpenedSinceConnect = true;
    this.resetReconnectBackoff();
    log.info("WebSocket connected");
    this.eventTarget.dispatchEvent(
      createCustomEvent("multiplayer:connected", { wsUrl: this.wsUrl })
    );
  };

  private readonly onSocketMessage = (event: Event) => {
    const messageEvent = event as MessageEvent<string>;
    const rawData = typeof messageEvent.data === "string" ? messageEvent.data : "";
    if (!rawData) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch (error) {
      log.warn("Ignoring invalid JSON network payload", error);
      return;
    }

    if (isCameraAttackMessage(parsed)) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("chaos:cameraAttack:received", {
          message: parsed,
        })
      );
      this.eventTarget.dispatchEvent(createCustomEvent("chaos:cameraAttack", parsed));
      return;
    }

    if (isParticleNetworkEvent(parsed)) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("particle:network:receive", parsed)
      );
      return;
    }

    if (isMultiplayerGameUpdateMessage(parsed)) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:update:received", parsed)
      );
      return;
    }

    if (isMultiplayerPlayerNotificationMessage(parsed)) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:notification:received", parsed)
      );
      return;
    }

    if (isMultiplayerRoomChannelMessage(parsed)) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:channel:received", parsed)
      );
      return;
    }

    if (isMultiplayerTurnStartMessage(parsed)) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:turn:start", parsed)
      );
      return;
    }

    if (isMultiplayerTurnEndMessage(parsed)) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:turn:end", parsed)
      );
      return;
    }

    if (isMultiplayerTurnTimeoutWarningMessage(parsed)) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:turn:timeoutWarning", parsed)
      );
      return;
    }

    if (isMultiplayerTurnAutoAdvancedMessage(parsed)) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:turn:autoAdvanced", parsed)
      );
      return;
    }

    if (isMultiplayerTurnActionMessage(parsed)) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:turn:action", parsed)
      );
      return;
    }

    if (isMultiplayerSessionStateMessage(parsed)) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:session:state", parsed)
      );
      return;
    }

    if (isWsErrorMessage(parsed)) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:error", {
          code: parsed.code,
          message: parsed.message ?? parsed.code,
        })
      );
    }

    if (isWsErrorMessage(parsed) && parsed.code === "session_expired") {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:authExpired", {
          code: parsed.code,
          reason: parsed.message ?? "session_expired",
        })
      );
      if (!this.manuallyDisconnected) {
        void this.recoverFromAuthExpiry();
      }
    }
  };

  private readonly onSocketClose = (event: Event) => {
    const closeEvent = event as CloseEvent;
    const closeCode = typeof closeEvent?.code === "number" ? closeEvent.code : 0;
    const closeReason = closeEvent?.reason ?? "";

    if (this.manuallyDisconnected || closeCode === 1000) {
      log.info("WebSocket disconnected");
    } else if (closeCode === 1006) {
      log.info("WebSocket transport interrupted");
    } else {
      log.warn(`WebSocket disconnected (code=${closeCode}, reason=${closeReason || "n/a"})`);
    }
    this.eventTarget.dispatchEvent(
      createCustomEvent("multiplayer:disconnected", {
        code: closeCode,
        reason: closeReason,
      })
    );

    const shouldRecoverFromAuthExpiry =
      !this.manuallyDisconnected &&
      (isAuthExpiredCloseCode(closeCode) ||
        this.shouldRecoverFromHandshakeAuthFailure(closeCode));

    if (shouldRecoverFromAuthExpiry) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:authExpired", {
          code: closeCode,
          reason:
            closeReason ||
            (isAuthExpiredCloseCode(closeCode) ? "auth_expired" : "auth_handshake_failed"),
        })
      );
      void this.recoverFromAuthExpiry();
      return;
    }

    if (!this.manuallyDisconnected && this.autoReconnect) {
      this.scheduleReconnect();
    }
  };

  private readonly onSocketError = () => {
    if (this.manuallyDisconnected) return;
    log.info("WebSocket error");
  };

  private readonly onParticleEmit = (event: Event) => {
    const custom = event as CustomEvent<ParticleNetworkEvent>;
    if (!custom.detail) return;
    this.sendRaw(custom.detail);
  };

  private readonly onCameraAttackSend = (event: Event) => {
    const custom = event as CustomEvent<CameraAttackMessage>;
    if (!custom.detail) return;
    const sent = this.sendCameraAttack(custom.detail);
    if (sent) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("chaos:cameraAttack:sent", {
          message: custom.detail,
        })
      );
      return;
    }

    this.eventTarget.dispatchEvent(
      createCustomEvent("chaos:cameraAttack:sendFailed", {
        message: custom.detail,
      })
    );
  };

  private readonly onGameUpdateSend = (event: Event) => {
    const custom = event as CustomEvent<MultiplayerGameUpdateMessage>;
    if (!custom.detail) return;
    const sent = this.sendGameUpdate(custom.detail);
    if (sent) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:update:sent", {
          message: custom.detail,
        })
      );
      return;
    }

    this.eventTarget.dispatchEvent(
      createCustomEvent("multiplayer:update:sendFailed", {
        message: custom.detail,
      })
    );
  };

  private readonly onPlayerNotificationSend = (event: Event) => {
    const custom = event as CustomEvent<MultiplayerPlayerNotificationMessage>;
    if (!custom.detail) return;
    const sent = this.sendPlayerNotification(custom.detail);
    if (sent) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:notification:sent", {
          message: custom.detail,
        })
      );
      return;
    }

    this.eventTarget.dispatchEvent(
      createCustomEvent("multiplayer:notification:sendFailed", {
        message: custom.detail,
      })
    );
  };

  private readonly onRoomChannelSend = (event: Event) => {
    const custom = event as CustomEvent<MultiplayerRoomChannelMessage>;
    if (!custom.detail) return;
    const sent = this.sendRoomChannelMessage(custom.detail);
    if (sent) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:channel:sent", {
          message: custom.detail,
        })
      );
      return;
    }

    this.eventTarget.dispatchEvent(
      createCustomEvent("multiplayer:channel:sendFailed", {
        message: custom.detail,
      })
    );
  };

  private readonly onTurnEndSend = (event: Event) => {
    const custom = event as CustomEvent<MultiplayerTurnEndMessage>;
    if (!custom.detail) return;
    const sent = this.sendTurnEnd(custom.detail);
    if (sent) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:turn:end:sent", {
          message: custom.detail,
        })
      );
      return;
    }

    this.eventTarget.dispatchEvent(
      createCustomEvent("multiplayer:turn:end:sendFailed", {
        message: custom.detail,
      })
    );
  };

  private readonly onTurnActionSend = (event: Event) => {
    const custom = event as CustomEvent<MultiplayerTurnActionMessage>;
    if (!custom.detail) return;
    const sent = this.sendTurnAction(custom.detail);
    if (sent) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:turn:action:sent", {
          message: custom.detail,
        })
      );
      return;
    }

    this.eventTarget.dispatchEvent(
      createCustomEvent("multiplayer:turn:action:sendFailed", {
        message: custom.detail,
      })
    );
  };

  constructor(options: MultiplayerNetworkOptions = {}) {
    const hasExplicitWsUrl = Object.prototype.hasOwnProperty.call(options, "wsUrl");
    this.wsUrl = hasExplicitWsUrl
      ? options.wsUrl
      : (environment.features.multiplayer ? environment.wsUrl : undefined);
    this.eventTarget = options.eventTarget ?? document;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelayMs = normalizeReconnectDelay(options.reconnectDelayMs, 3000);
    this.reconnectMaxDelayMs = Math.max(
      this.reconnectDelayMs,
      normalizeReconnectDelay(options.reconnectMaxDelayMs, 30000)
    );
    this.reconnectBackoffMultiplier = normalizeBackoffMultiplier(
      options.reconnectBackoffMultiplier
    );
    this.onAuthExpired = options.onAuthExpired;
    this.webSocketFactory =
      options.webSocketFactory ?? ((url: string) => new WebSocket(url));
    this.nextReconnectDelayMs = this.reconnectDelayMs;
  }

  enableEventBridge(): void {
    if (this.bridgeEnabled) return;
    this.bridgeEnabled = true;

    this.eventTarget.addEventListener("particle:network:emit", this.onParticleEmit);
    this.eventTarget.addEventListener(
      "chaos:cameraAttack:send",
      this.onCameraAttackSend
    );
    this.eventTarget.addEventListener("multiplayer:update:send", this.onGameUpdateSend);
    this.eventTarget.addEventListener(
      "multiplayer:notification:send",
      this.onPlayerNotificationSend
    );
    this.eventTarget.addEventListener(
      "multiplayer:channel:send",
      this.onRoomChannelSend
    );
    this.eventTarget.addEventListener("multiplayer:turn:end:send", this.onTurnEndSend);
    this.eventTarget.addEventListener(
      "multiplayer:turn:action:send",
      this.onTurnActionSend
    );
  }

  disableEventBridge(): void {
    if (!this.bridgeEnabled) return;
    this.bridgeEnabled = false;

    this.eventTarget.removeEventListener("particle:network:emit", this.onParticleEmit);
    this.eventTarget.removeEventListener(
      "chaos:cameraAttack:send",
      this.onCameraAttackSend
    );
    this.eventTarget.removeEventListener("multiplayer:update:send", this.onGameUpdateSend);
    this.eventTarget.removeEventListener(
      "multiplayer:notification:send",
      this.onPlayerNotificationSend
    );
    this.eventTarget.removeEventListener(
      "multiplayer:channel:send",
      this.onRoomChannelSend
    );
    this.eventTarget.removeEventListener("multiplayer:turn:end:send", this.onTurnEndSend);
    this.eventTarget.removeEventListener(
      "multiplayer:turn:action:send",
      this.onTurnActionSend
    );
  }

  connect(): boolean {
    if (!this.wsUrl) {
      log.info("Multiplayer network disabled (no WebSocket URL)");
      return false;
    }

    if (this.socket && this.socket.readyState !== READY_STATE_CLOSED) {
      return true;
    }

    this.manuallyDisconnected = false;
    this.clearReconnectTimer();
    this.socketOpenedSinceConnect = false;

    const socket = this.webSocketFactory(this.wsUrl);
    this.socket = socket;

    socket.addEventListener("open", this.onSocketOpen);
    socket.addEventListener("message", this.onSocketMessage);
    socket.addEventListener("close", this.onSocketClose);
    socket.addEventListener("error", this.onSocketError);

    log.info(`Connecting to WebSocket: ${this.wsUrl}`);
    return true;
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    this.clearReconnectTimer();
    this.resetReconnectBackoff();

    if (!this.socket) return;
    this.socket.close(1000, "client_disconnect");
  }

  isConnected(): boolean {
    return this.socket?.readyState === READY_STATE_OPEN;
  }

  sendCameraAttack(message: CameraAttackMessage): boolean {
    return this.sendRaw(message);
  }

  sendGameUpdate(message: MultiplayerGameUpdateMessage): boolean {
    return this.sendRaw(message);
  }

  sendPlayerNotification(message: MultiplayerPlayerNotificationMessage): boolean {
    return this.sendRaw(message);
  }

  sendRoomChannelMessage(message: MultiplayerRoomChannelMessage): boolean {
    return this.sendRaw(message);
  }

  sendTurnEnd(message: MultiplayerTurnEndMessage): boolean {
    return this.sendRaw(message);
  }

  sendTurnAction(message: MultiplayerTurnActionMessage): boolean {
    return this.sendRaw(message);
  }

  dispose(): void {
    this.disableEventBridge();
    this.disconnect();
  }

  private sendRaw(payload: unknown): boolean {
    if (!this.socket || this.socket.readyState !== READY_STATE_OPEN) {
      return false;
    }

    try {
      this.socket.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      log.error("Failed to send WebSocket payload", error);
      return false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.wsUrl) return;

    const reconnectDelayMs = this.nextReconnectDelayMs;
    this.reconnectAttemptCount += 1;
    log.info(
      `Scheduling reconnect attempt ${this.reconnectAttemptCount} in ${reconnectDelayMs}ms`
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manuallyDisconnected) return;
      this.connect();
    }, reconnectDelayMs);

    this.nextReconnectDelayMs = Math.min(
      this.reconnectMaxDelayMs,
      Math.max(
        this.reconnectDelayMs,
        Math.round(reconnectDelayMs * this.reconnectBackoffMultiplier)
      )
    );
  }

  private async recoverFromAuthExpiry(): Promise<void> {
    if (this.authRecoveryInFlight) {
      return;
    }
    if (!this.onAuthExpired) {
      if (this.autoReconnect) {
        this.scheduleReconnect();
      }
      return;
    }

    const now = Date.now();
    if (
      this.lastAuthRecoveryAttemptAt > 0 &&
      now - this.lastAuthRecoveryAttemptAt < AUTH_RECOVERY_COOLDOWN_MS
    ) {
      if (this.autoReconnect) {
        this.scheduleReconnect();
      }
      return;
    }

    this.authRecoveryInFlight = true;
    this.lastAuthRecoveryAttemptAt = now;
    try {
      const refreshedWsUrl = await this.onAuthExpired();
      if (!refreshedWsUrl) {
        this.eventTarget.dispatchEvent(
          createCustomEvent("multiplayer:sessionExpired", {
            reason: "ws_auth_refresh_failed",
          })
        );
        return;
      }

      this.wsUrl = refreshedWsUrl;
      this.clearReconnectTimer();
      this.connect();
    } catch (error) {
      log.warn("Failed to recover from WS auth expiry", error);
      if (this.autoReconnect) {
        this.scheduleReconnect();
      }
    } finally {
      this.authRecoveryInFlight = false;
    }
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private resetReconnectBackoff(): void {
    this.reconnectAttemptCount = 0;
    this.nextReconnectDelayMs = this.reconnectDelayMs;
  }

  private shouldRecoverFromHandshakeAuthFailure(closeCode: number): boolean {
    if (closeCode !== 1006) {
      return false;
    }
    if (this.socketOpenedSinceConnect) {
      return false;
    }
    if (!this.onAuthExpired) {
      return false;
    }
    if (!this.wsUrl || !this.wsUrl.includes("token=")) {
      return false;
    }
    if (this.authRecoveryInFlight) {
      return false;
    }
    const now = Date.now();
    if (
      this.lastAuthRecoveryAttemptAt > 0 &&
      now - this.lastAuthRecoveryAttemptAt < AUTH_RECOVERY_COOLDOWN_MS
    ) {
      return false;
    }
    return true;
  }
}

function normalizeReconnectDelay(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeBackoffMultiplier(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return 2;
  }
  return value;
}

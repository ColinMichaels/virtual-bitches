import { logger } from "../utils/logger.js";
import { environment } from "@env";
import type { CameraAttackMessage } from "../chaos/types.js";
import type { ParticleNetworkEvent } from "../services/particleService.js";

const log = logger.create("MultiplayerNetwork");

const READY_STATE_CONNECTING = 0;
const READY_STATE_OPEN = 1;
const READY_STATE_CLOSED = 3;

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
  webSocketFactory?: (url: string) => WebSocketLike;
  onAuthExpired?: () => Promise<string | undefined> | string | undefined;
}

interface WsErrorMessage {
  type: "error";
  code: string;
  message?: string;
}

function isCameraAttackMessage(value: unknown): value is CameraAttackMessage {
  if (!value || typeof value !== "object") return false;

  const msg = value as Partial<CameraAttackMessage>;
  return (
    msg.type === "chaos_attack" &&
    msg.attackType === "camera_effect" &&
    typeof msg.targetId === "string" &&
    typeof msg.effectType === "string" &&
    typeof msg.duration === "number"
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
  private readonly webSocketFactory: (url: string) => WebSocketLike;
  private readonly onAuthExpired?: () => Promise<string | undefined> | string | undefined;

  private socket: WebSocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyDisconnected = false;
  private bridgeEnabled = false;
  private authRecoveryInFlight = false;

  private readonly onSocketOpen = () => {
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

    if (!this.manuallyDisconnected && isAuthExpiredCloseCode(closeCode)) {
      this.eventTarget.dispatchEvent(
        createCustomEvent("multiplayer:authExpired", {
          code: closeCode,
          reason: closeReason || "auth_expired",
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

  constructor(options: MultiplayerNetworkOptions = {}) {
    const hasExplicitWsUrl = Object.prototype.hasOwnProperty.call(options, "wsUrl");
    this.wsUrl = hasExplicitWsUrl
      ? options.wsUrl
      : (environment.features.multiplayer ? environment.wsUrl : undefined);
    this.eventTarget = options.eventTarget ?? document;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 3000;
    this.onAuthExpired = options.onAuthExpired;
    this.webSocketFactory =
      options.webSocketFactory ?? ((url: string) => new WebSocket(url));
  }

  enableEventBridge(): void {
    if (this.bridgeEnabled) return;
    this.bridgeEnabled = true;

    this.eventTarget.addEventListener("particle:network:emit", this.onParticleEmit);
    this.eventTarget.addEventListener(
      "chaos:cameraAttack:send",
      this.onCameraAttackSend
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

    if (!this.socket) return;
    this.socket.close(1000, "client_disconnect");
  }

  isConnected(): boolean {
    return this.socket?.readyState === READY_STATE_OPEN;
  }

  sendCameraAttack(message: CameraAttackMessage): boolean {
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

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manuallyDisconnected) return;
      this.connect();
    }, this.reconnectDelayMs);
  }

  private async recoverFromAuthExpiry(): Promise<void> {
    if (this.authRecoveryInFlight || !this.onAuthExpired) {
      if (this.autoReconnect) {
        this.scheduleReconnect();
      }
      return;
    }

    this.authRecoveryInFlight = true;
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
}

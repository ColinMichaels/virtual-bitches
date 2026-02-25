import { MultiplayerNetworkService, type WebSocketLike } from "./networkService.js";
import type { CameraAttackMessage } from "../chaos/types.js";
import type { ParticleNetworkEvent } from "../services/particleService.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (expected: ${expected}, actual: ${actual})`);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

class MockMessageEvent extends Event {
  data: string;

  constructor(data: string) {
    super("message");
    this.data = data;
  }
}

class MockWebSocket extends EventTarget implements WebSocketLike {
  readyState = 1;
  sentPayloads: string[] = [];

  send(data: string): void {
    this.sentPayloads.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }

  emitOpen(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  emitMessage(payload: unknown): void {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.dispatchEvent(new MockMessageEvent(raw));
  }
}

function createAttackMessage(overrides: Partial<CameraAttackMessage> = {}): CameraAttackMessage {
  return {
    type: "chaos_attack",
    attackType: "camera_effect",
    gameId: "game-1",
    attackerId: "attacker-1",
    targetId: "local-player",
    abilityId: "screen_shake",
    level: 1,
    effectType: "shake",
    intensity: 0.5,
    duration: 1200,
    chaosPointsCost: 20,
    timestamp: Date.now(),
    ...overrides,
  };
}

function createParticleEvent(): ParticleNetworkEvent {
  return {
    type: "particle:emit",
    effectId: "attack-shake-impact",
    position: { x: 1, y: 2, z: 3 },
    timestamp: Date.now(),
  };
}

test("bridges outgoing camera attack send event to websocket", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;

  const network = new MultiplayerNetworkService({
    wsUrl: "ws://test.local",
    eventTarget,
    autoReconnect: false,
    webSocketFactory: () => {
      socket = new MockWebSocket();
      return socket;
    },
  });

  network.enableEventBridge();
  network.connect();
  socket!.emitOpen();

  const outgoing = createAttackMessage();
  eventTarget.dispatchEvent(
    new CustomEvent("chaos:cameraAttack:send", { detail: outgoing })
  );

  assertEqual(socket!.sentPayloads.length, 1, "Expected one outbound payload");
  const sent = JSON.parse(socket!.sentPayloads[0]) as CameraAttackMessage;
  assertEqual(sent.abilityId, outgoing.abilityId, "Expected sent payload to match");
});

test("dispatches inbound camera attack to local event bus", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let received: CameraAttackMessage | null = null;

  eventTarget.addEventListener("chaos:cameraAttack", (event: Event) => {
    received = (event as CustomEvent<CameraAttackMessage>).detail;
  });

  const network = new MultiplayerNetworkService({
    wsUrl: "ws://test.local",
    eventTarget,
    autoReconnect: false,
    webSocketFactory: () => {
      socket = new MockWebSocket();
      return socket;
    },
  });

  network.connect();
  socket!.emitOpen();
  socket!.emitMessage(createAttackMessage({ effectType: "drunk" }));

  assert(received !== null, "Expected inbound camera attack event");
  assertEqual(received!.effectType, "drunk", "Expected effect type to match");
});

test("dispatches inbound particle event to local event bus", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let received: ParticleNetworkEvent | null = null;

  eventTarget.addEventListener("particle:network:receive", (event: Event) => {
    received = (event as CustomEvent<ParticleNetworkEvent>).detail;
  });

  const network = new MultiplayerNetworkService({
    wsUrl: "ws://test.local",
    eventTarget,
    autoReconnect: false,
    webSocketFactory: () => {
      socket = new MockWebSocket();
      return socket;
    },
  });

  network.connect();
  socket!.emitOpen();
  socket!.emitMessage(createParticleEvent());

  assert(received !== null, "Expected inbound particle event");
  assertEqual(received!.effectId, "attack-shake-impact", "Expected effect id");
});

console.log("\nMultiplayerNetworkService tests passed! ✓");

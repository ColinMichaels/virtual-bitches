import {
  MultiplayerNetworkService,
  type MultiplayerGameUpdateMessage,
  type MultiplayerPlayerNotificationMessage,
  type MultiplayerRoomChannelMessage,
  type MultiplayerTurnAutoAdvancedMessage,
  type MultiplayerTurnActionMessage,
  type MultiplayerTurnEndMessage,
  type MultiplayerTurnStartMessage,
  type MultiplayerTurnTimeoutWarningMessage,
  type WebSocketLike,
} from "./networkService.js";
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

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✓ ${name}`);
    })
    .catch((error) => {
      console.error(`✗ ${name}`);
      throw error;
    });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number = 250,
  pollIntervalMs: number = 2
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
}

class MockMessageEvent extends Event {
  data: string;

  constructor(data: string) {
    super("message");
    this.data = data;
  }
}

class MockCloseEvent extends Event {
  code: number;
  reason: string;

  constructor(code: number, reason: string = "") {
    super("close");
    this.code = code;
    this.reason = reason;
  }
}

class MockWebSocket extends EventTarget implements WebSocketLike {
  readyState = 1;
  sentPayloads: string[] = [];
  connectedUrls: string[];

  constructor(connectedUrls: string[] = []) {
    super();
    this.connectedUrls = connectedUrls;
  }

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

  emitClose(code: number, reason: string = ""): void {
    this.readyState = 3;
    this.dispatchEvent(new MockCloseEvent(code, reason));
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

function createGameUpdateMessage(): MultiplayerGameUpdateMessage {
  return {
    type: "game_update",
    id: "update-1",
    title: "Live Event",
    content: "Chaos mode now active for this session",
    updateType: "announcement",
    timestamp: Date.now(),
  };
}

function createPlayerNotificationMessage(): MultiplayerPlayerNotificationMessage {
  return {
    type: "player_notification",
    id: "note-1",
    title: "Heads Up",
    message: "You have been targeted by a chaos attack",
    severity: "warning",
    timestamp: Date.now(),
  };
}

function createRoomChannelMessage(): MultiplayerRoomChannelMessage {
  return {
    type: "room_channel",
    id: "channel-1",
    channel: "direct",
    topic: "nudge",
    sourceRole: "player",
    title: "Nudge",
    message: "Your turn is up. Take your turn!",
    severity: "warning",
    targetPlayerId: "player-2",
    timestamp: Date.now(),
  };
}

function createTurnStartMessage(): MultiplayerTurnStartMessage {
  return {
    type: "turn_start",
    sessionId: "session-1",
    playerId: "player-1",
    round: 1,
    turnNumber: 1,
    timestamp: Date.now(),
    order: ["player-1", "player-2"],
  };
}

function createTurnEndMessage(): MultiplayerTurnEndMessage {
  return {
    type: "turn_end",
    sessionId: "session-1",
    playerId: "player-1",
    round: 1,
    turnNumber: 1,
    timestamp: Date.now(),
  };
}

function createTurnTimeoutWarningMessage(): MultiplayerTurnTimeoutWarningMessage {
  return {
    type: "turn_timeout_warning",
    sessionId: "session-1",
    playerId: "player-1",
    round: 1,
    turnNumber: 1,
    remainingMs: 9000,
    turnExpiresAt: Date.now() + 9000,
    timeoutMs: 45000,
    timestamp: Date.now(),
  };
}

function createTurnAutoAdvancedMessage(): MultiplayerTurnAutoAdvancedMessage {
  return {
    type: "turn_auto_advanced",
    sessionId: "session-1",
    playerId: "player-1",
    round: 1,
    turnNumber: 1,
    timeoutMs: 45000,
    reason: "turn_timeout",
    timestamp: Date.now(),
  };
}

function createTurnActionMessage(action: "roll" | "score" = "roll"): MultiplayerTurnActionMessage {
  return {
    type: "turn_action",
    sessionId: "session-1",
    playerId: "player-1",
    action,
    round: 1,
    turnNumber: 1,
    timestamp: Date.now(),
  };
}

await test("bridges outgoing camera attack send event to websocket", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let sentEventCount = 0;
  eventTarget.addEventListener("chaos:cameraAttack:sent", () => {
    sentEventCount += 1;
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
  assertEqual(sentEventCount, 1, "Expected send feedback event");
});

await test("dispatches inbound camera attack to local event bus", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let received: CameraAttackMessage | null = null;
  let receivedEventCount = 0;

  eventTarget.addEventListener("chaos:cameraAttack", (event: Event) => {
    received = (event as CustomEvent<CameraAttackMessage>).detail;
  });
  eventTarget.addEventListener("chaos:cameraAttack:received", () => {
    receivedEventCount += 1;
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
  assertEqual(receivedEventCount, 1, "Expected receive feedback event");
});

await test("dispatches sendFailed feedback when websocket is unavailable", () => {
  const eventTarget = new EventTarget();
  let failedEventCount = 0;
  eventTarget.addEventListener("chaos:cameraAttack:sendFailed", () => {
    failedEventCount += 1;
  });

  const network = new MultiplayerNetworkService({
    wsUrl: "ws://test.local",
    eventTarget,
    autoReconnect: false,
    webSocketFactory: () => new MockWebSocket(),
  });

  network.enableEventBridge();
  eventTarget.dispatchEvent(
    new CustomEvent("chaos:cameraAttack:send", { detail: createAttackMessage() })
  );

  assertEqual(failedEventCount, 1, "Expected sendFailed feedback event");
});

await test("attempts auth recovery on auth-expired close code", async () => {
  const eventTarget = new EventTarget();
  const createdUrls: string[] = [];
  let socket: MockWebSocket | null = null;

  const network = new MultiplayerNetworkService({
    wsUrl: "ws://test.local",
    eventTarget,
    autoReconnect: false,
    onAuthExpired: () => "ws://refreshed.local",
    webSocketFactory: (url) => {
      createdUrls.push(url);
      socket = new MockWebSocket();
      return socket;
    },
  });

  network.connect();
  socket!.emitOpen();
  socket!.emitClose(4401, "token_expired");

  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEqual(createdUrls.length, 2, "Expected reconnect after auth recovery");
  assertEqual(createdUrls[1], "ws://refreshed.local", "Expected refreshed ws url");
});

await test("auto-reconnects after transient websocket close", async () => {
  const eventTarget = new EventTarget();
  const sockets: MockWebSocket[] = [];

  const network = new MultiplayerNetworkService({
    wsUrl: "ws://test.local",
    eventTarget,
    autoReconnect: true,
    reconnectDelayMs: 10,
    webSocketFactory: () => {
      const socket = new MockWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  network.connect();
  assertEqual(sockets.length, 1, "Expected initial websocket connection");
  sockets[0].emitOpen();
  sockets[0].emitClose(1006, "transport_interrupted");

  await waitFor(() => sockets.length === 2, 400);
  network.dispose();
});

await test("applies reconnect backoff and resets after successful reconnect", async () => {
  const eventTarget = new EventTarget();
  const sockets: MockWebSocket[] = [];
  const connectTimes: number[] = [];

  const network = new MultiplayerNetworkService({
    wsUrl: "ws://test.local",
    eventTarget,
    autoReconnect: true,
    reconnectDelayMs: 10,
    reconnectBackoffMultiplier: 2,
    reconnectMaxDelayMs: 40,
    webSocketFactory: () => {
      connectTimes.push(Date.now());
      const socket = new MockWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  network.connect();
  sockets[0].emitOpen();

  sockets[0].emitClose(1006, "drop-1");
  await waitFor(() => sockets.length === 2, 500);
  const firstDelay = connectTimes[1] - connectTimes[0];

  sockets[1].emitClose(1006, "drop-2");
  await waitFor(() => sockets.length === 3, 500);
  const secondDelay = connectTimes[2] - connectTimes[1];

  sockets[2].emitClose(1006, "drop-3");
  await waitFor(() => sockets.length === 4, 500);
  const thirdDelay = connectTimes[3] - connectTimes[2];

  assert(
    secondDelay > firstDelay,
    `Expected second reconnect delay to increase (first=${firstDelay}ms second=${secondDelay}ms)`
  );
  assert(
    thirdDelay >= secondDelay,
    `Expected third reconnect delay to increase/cap (second=${secondDelay}ms third=${thirdDelay}ms)`
  );

  sockets[3].emitOpen();
  sockets[3].emitClose(1006, "drop-after-open");
  await waitFor(() => sockets.length === 5, 500);
  const resetDelay = connectTimes[4] - connectTimes[3];

  assert(
    resetDelay < thirdDelay,
    `Expected reconnect delay reset after open (reset=${resetDelay}ms third=${thirdDelay}ms)`
  );

  network.dispose();
});

await test("dispatches inbound particle event to local event bus", () => {
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

await test("dispatches inbound multiplayer game update event", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let received: MultiplayerGameUpdateMessage | null = null;

  eventTarget.addEventListener("multiplayer:update:received", (event: Event) => {
    received = (event as CustomEvent<MultiplayerGameUpdateMessage>).detail;
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
  socket!.emitMessage(createGameUpdateMessage());

  assert(received !== null, "Expected inbound game update");
  assertEqual(received!.title, "Live Event", "Expected game update title");
});

await test("dispatches inbound multiplayer player notification event", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let received: MultiplayerPlayerNotificationMessage | null = null;

  eventTarget.addEventListener("multiplayer:notification:received", (event: Event) => {
    received = (event as CustomEvent<MultiplayerPlayerNotificationMessage>).detail;
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
  socket!.emitMessage(createPlayerNotificationMessage());

  assert(received !== null, "Expected inbound player notification");
  assertEqual(received!.severity, "warning", "Expected notification severity");
});

await test("dispatches inbound multiplayer room channel event", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let received: MultiplayerRoomChannelMessage | null = null;

  eventTarget.addEventListener("multiplayer:channel:received", (event: Event) => {
    received = (event as CustomEvent<MultiplayerRoomChannelMessage>).detail;
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
  socket!.emitMessage(createRoomChannelMessage());

  assert(received !== null, "Expected inbound room channel message");
  assertEqual(received!.channel, "direct", "Expected room channel routing type");
});

await test("dispatches inbound multiplayer turn start/end events", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let started: MultiplayerTurnStartMessage | null = null;
  let ended: MultiplayerTurnEndMessage | null = null;
  let actioned: MultiplayerTurnActionMessage | null = null;

  eventTarget.addEventListener("multiplayer:turn:start", (event: Event) => {
    started = (event as CustomEvent<MultiplayerTurnStartMessage>).detail;
  });
  eventTarget.addEventListener("multiplayer:turn:end", (event: Event) => {
    ended = (event as CustomEvent<MultiplayerTurnEndMessage>).detail;
  });
  eventTarget.addEventListener("multiplayer:turn:action", (event: Event) => {
    actioned = (event as CustomEvent<MultiplayerTurnActionMessage>).detail;
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
  socket!.emitMessage(createTurnStartMessage());
  socket!.emitMessage(createTurnActionMessage("roll"));
  socket!.emitMessage(createTurnEndMessage());

  assert(started !== null, "Expected inbound turn start");
  assertEqual(started!.playerId, "player-1", "Expected turn start player");
  assert(actioned !== null, "Expected inbound turn action");
  assertEqual(actioned!.action, "roll", "Expected turn action payload");
  assert(ended !== null, "Expected inbound turn end");
  assertEqual(ended!.playerId, "player-1", "Expected turn end player");
});

await test("dispatches inbound multiplayer timeout warning/auto-advance events", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let warning: MultiplayerTurnTimeoutWarningMessage | null = null;
  let autoAdvanced: MultiplayerTurnAutoAdvancedMessage | null = null;

  eventTarget.addEventListener("multiplayer:turn:timeoutWarning", (event: Event) => {
    warning = (event as CustomEvent<MultiplayerTurnTimeoutWarningMessage>).detail;
  });
  eventTarget.addEventListener("multiplayer:turn:autoAdvanced", (event: Event) => {
    autoAdvanced = (event as CustomEvent<MultiplayerTurnAutoAdvancedMessage>).detail;
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
  socket!.emitMessage(createTurnTimeoutWarningMessage());
  socket!.emitMessage(createTurnAutoAdvancedMessage());

  assert(warning !== null, "Expected inbound turn timeout warning");
  assertEqual(warning!.type, "turn_timeout_warning", "Expected timeout warning payload");
  assert(autoAdvanced !== null, "Expected inbound turn auto-advanced");
  assertEqual(autoAdvanced!.type, "turn_auto_advanced", "Expected auto-advanced payload");
});

await test("dispatches inbound ws error event", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let receivedCode: string | null = null;
  let receivedMessage: string | null = null;

  eventTarget.addEventListener("multiplayer:error", (event: Event) => {
    const detail = (event as CustomEvent<{ code: string; message: string }>).detail;
    receivedCode = detail?.code ?? null;
    receivedMessage = detail?.message ?? null;
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
  socket!.emitMessage({ type: "error", code: "turn_not_active", message: "not_your_turn" });

  assertEqual(receivedCode, "turn_not_active", "Expected ws error code");
  assertEqual(receivedMessage, "not_your_turn", "Expected ws error message");
});

await test("bridges outgoing multiplayer game update to websocket", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let sentEventCount = 0;
  eventTarget.addEventListener("multiplayer:update:sent", () => {
    sentEventCount += 1;
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

  network.enableEventBridge();
  network.connect();
  socket!.emitOpen();

  const outgoing = createGameUpdateMessage();
  eventTarget.dispatchEvent(
    new CustomEvent("multiplayer:update:send", { detail: outgoing })
  );

  assertEqual(socket!.sentPayloads.length, 1, "Expected one outbound update payload");
  const sent = JSON.parse(socket!.sentPayloads[0]) as MultiplayerGameUpdateMessage;
  assertEqual(sent.id, outgoing.id, "Expected sent update payload to match");
  assertEqual(sentEventCount, 1, "Expected update sent feedback event");
});

await test("bridges outgoing player notification to websocket", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let sentEventCount = 0;
  eventTarget.addEventListener("multiplayer:notification:sent", () => {
    sentEventCount += 1;
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

  network.enableEventBridge();
  network.connect();
  socket!.emitOpen();

  const outgoing = createPlayerNotificationMessage();
  eventTarget.dispatchEvent(
    new CustomEvent("multiplayer:notification:send", { detail: outgoing })
  );

  assertEqual(socket!.sentPayloads.length, 1, "Expected one outbound notification payload");
  const sent = JSON.parse(socket!.sentPayloads[0]) as MultiplayerPlayerNotificationMessage;
  assertEqual(sent.id, outgoing.id, "Expected sent notification payload to match");
  assertEqual(sentEventCount, 1, "Expected notification sent feedback event");
});

await test("bridges outgoing room channel message to websocket", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let sentEventCount = 0;
  eventTarget.addEventListener("multiplayer:channel:sent", () => {
    sentEventCount += 1;
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

  network.enableEventBridge();
  network.connect();
  socket!.emitOpen();

  const outgoing = createRoomChannelMessage();
  eventTarget.dispatchEvent(
    new CustomEvent("multiplayer:channel:send", { detail: outgoing })
  );

  assertEqual(socket!.sentPayloads.length, 1, "Expected one outbound room channel payload");
  const sent = JSON.parse(socket!.sentPayloads[0]) as MultiplayerRoomChannelMessage;
  assertEqual(sent.id, outgoing.id, "Expected sent room channel payload to match");
  assertEqual(sentEventCount, 1, "Expected room channel sent feedback event");
});

await test("bridges outgoing turn_end to websocket", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let sentEventCount = 0;
  eventTarget.addEventListener("multiplayer:turn:end:sent", () => {
    sentEventCount += 1;
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

  network.enableEventBridge();
  network.connect();
  socket!.emitOpen();

  const outgoing = createTurnEndMessage();
  eventTarget.dispatchEvent(
    new CustomEvent("multiplayer:turn:end:send", { detail: outgoing })
  );

  assertEqual(socket!.sentPayloads.length, 1, "Expected one outbound turn_end payload");
  const sent = JSON.parse(socket!.sentPayloads[0]) as MultiplayerTurnEndMessage;
  assertEqual(sent.type, "turn_end", "Expected turn_end payload type");
  assertEqual(sentEventCount, 1, "Expected turn_end sent feedback event");
});

await test("bridges outgoing turn_action to websocket", () => {
  const eventTarget = new EventTarget();
  let socket: MockWebSocket | null = null;
  let sentEventCount = 0;
  eventTarget.addEventListener("multiplayer:turn:action:sent", () => {
    sentEventCount += 1;
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

  network.enableEventBridge();
  network.connect();
  socket!.emitOpen();

  const outgoing = createTurnActionMessage("score");
  eventTarget.dispatchEvent(
    new CustomEvent("multiplayer:turn:action:send", { detail: outgoing })
  );

  assertEqual(socket!.sentPayloads.length, 1, "Expected one outbound turn_action payload");
  const sent = JSON.parse(socket!.sentPayloads[0]) as MultiplayerTurnActionMessage;
  assertEqual(sent.type, "turn_action", "Expected turn_action payload type");
  assertEqual(sent.action, "score", "Expected turn_action action");
  assertEqual(sentEventCount, 1, "Expected turn_action sent feedback event");
});

console.log("\nMultiplayerNetworkService tests passed! ✓");

import assert from "node:assert/strict";
import { createSocketOrchestration } from "./socketOrchestration.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createMockSocket() {
  return {
    destroyed: false,
    ended: false,
    writes: [],
    write(data) {
      this.writes.push(data);
      return true;
    },
    end() {
      this.ended = true;
    },
    destroy() {
      this.destroyed = true;
    },
  };
}

function createFixture(overrides = {}) {
  const calls = {
    writeSocketFrame: [],
    warns: [],
    relayBroadcasts: [],
    relayPayloads: [],
    lifecycleUnregisters: [],
    lifecycleDisconnects: [],
    routerMessages: [],
    turnActions: [],
    turnEnds: [],
  };

  const orchestration = createSocketOrchestration({
    writeSocketFrame:
      overrides.writeSocketFrame ??
      ((socket, opcode, payload) => {
        calls.writeSocketFrame.push({ socket, opcode, payload });
      }),
    buildSessionStateMessage:
      overrides.buildSessionStateMessage ??
      ((session, options = {}) => ({
        type: "session_state",
        sessionId: session?.sessionId,
        source: options.source,
      })),
    buildTurnStartMessage:
      overrides.buildTurnStartMessage ??
      ((session, options = {}) => ({
        type: "turn_start",
        sessionId: session?.sessionId,
        source: options.source,
      })),
    log: {
      warn: (...args) => calls.warns.push(args),
    },
  });

  const relay =
    overrides.relay ??
    {
      broadcastToSession: (sessionId, rawMessage, sender) => {
        calls.relayBroadcasts.push({ sessionId, rawMessage, sender });
      },
      sendToSessionPlayer: () => {},
      broadcastRoomChannelToSession: () => {},
      broadcastRealtimeSocketMessageToSession: () => {},
      sendSocketPayload: (client, payload) => {
        calls.relayPayloads.push({ client, payload });
      },
      sendSocketError: () => {},
    };

  const lifecycle =
    overrides.lifecycle ??
    {
      unregisterSocketClient: (client) => {
        calls.lifecycleUnregisters.push(client);
      },
      disconnectPlayerSockets: (sessionId, playerId, closeCode, reason) => {
        calls.lifecycleDisconnects.push({ sessionId, playerId, closeCode, reason });
      },
    };

  orchestration.setSocketRelay(relay);
  orchestration.setSocketLifecycle(lifecycle);

  return {
    orchestration,
    calls,
  };
}

test("message and turn handlers are no-ops until routers are registered", () => {
  const fixture = createFixture();
  const client = { socket: createMockSocket() };

  fixture.orchestration.handleSocketMessage(client, "{}");
  fixture.orchestration.handleTurnActionMessage(client, { sessionId: "s1" }, { type: "turn_action" });
  fixture.orchestration.handleTurnEndMessage(client, { sessionId: "s1" });

  assert.equal(fixture.calls.routerMessages.length, 0);
  assert.equal(fixture.calls.turnActions.length, 0);
  assert.equal(fixture.calls.turnEnds.length, 0);

  fixture.orchestration.setSocketMessageRouter({
    handleSocketMessage: (nextClient, rawMessage) => {
      fixture.calls.routerMessages.push({ nextClient, rawMessage });
    },
  });
  fixture.orchestration.setSocketTurnHandlers({
    handleTurnActionMessage: (nextClient, session, payload) => {
      fixture.calls.turnActions.push({ nextClient, session, payload });
    },
    handleTurnEndMessage: (nextClient, session) => {
      fixture.calls.turnEnds.push({ nextClient, session });
    },
  });

  fixture.orchestration.handleSocketMessage(client, '{"type":"ping"}');
  fixture.orchestration.handleTurnActionMessage(client, { sessionId: "s1" }, { type: "turn_action" });
  fixture.orchestration.handleTurnEndMessage(client, { sessionId: "s1" });

  assert.equal(fixture.calls.routerMessages.length, 1);
  assert.equal(fixture.calls.routerMessages[0].rawMessage, '{"type":"ping"}');
  assert.equal(fixture.calls.turnActions.length, 1);
  assert.equal(fixture.calls.turnEnds.length, 1);
});

test("broadcastSessionState serializes and relays state messages", () => {
  const fixture = createFixture();

  fixture.orchestration.broadcastSessionState({ sessionId: "session-1" }, "join");

  assert.equal(fixture.calls.relayBroadcasts.length, 1);
  const relayCall = fixture.calls.relayBroadcasts[0];
  assert.equal(relayCall.sessionId, "session-1");
  const payload = JSON.parse(relayCall.rawMessage);
  assert.equal(payload.type, "session_state");
  assert.equal(payload.source, "join");
});

test("sendTurnSyncPayload emits session state followed by turn start", () => {
  const fixture = createFixture();
  const client = { socket: createMockSocket() };

  fixture.orchestration.sendTurnSyncPayload(client, { sessionId: "session-2" }, "sync");

  assert.equal(fixture.calls.relayPayloads.length, 2);
  assert.equal(fixture.calls.relayPayloads[0].payload.type, "session_state");
  assert.equal(fixture.calls.relayPayloads[1].payload.type, "turn_start");
});

test("safeCloseSocket unregisters the client and sends websocket close frames", () => {
  const fixture = createFixture();
  const socket = createMockSocket();
  const client = {
    closed: false,
    socket,
  };

  fixture.orchestration.safeCloseSocket(client, 4401, "session_expired");

  assert.equal(client.closed, true);
  assert.equal(fixture.calls.lifecycleUnregisters.length, 1);
  assert.equal(fixture.calls.writeSocketFrame.length, 1);
  assert.equal(fixture.calls.writeSocketFrame[0].opcode, 0x8);
  assert.equal(fixture.calls.writeSocketFrame[0].payload.readUInt16BE(0), 4401);
  assert.equal(socket.ended, true);
});

test("safeCloseSocket falls back to socket destroy when close frame write fails", () => {
  const fixture = createFixture({
    writeSocketFrame: () => {
      throw new Error("write failed");
    },
  });
  const socket = createMockSocket();
  const client = {
    closed: false,
    socket,
  };

  fixture.orchestration.safeCloseSocket(client, 1011, "send_failed");

  assert.equal(socket.destroyed, true);
  assert.equal(fixture.calls.warns.length, 1);
});

test("disconnectPlayerSockets delegates to lifecycle helper", () => {
  const fixture = createFixture();

  fixture.orchestration.disconnectPlayerSockets("session-3", "player-3", 4403, "forbidden");

  assert.equal(fixture.calls.lifecycleDisconnects.length, 1);
  assert.deepEqual(fixture.calls.lifecycleDisconnects[0], {
    sessionId: "session-3",
    playerId: "player-3",
    closeCode: 4403,
    reason: "forbidden",
  });
});

async function run() {
  let failures = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${name}`);
      console.error(error);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`All socketOrchestration tests passed (${tests.length}).`);
}

await run();

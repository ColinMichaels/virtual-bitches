import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createSocketLifecycle } from "./socketLifecycle.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

class MockSocket extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
  }

  write(data) {
    this.writes.push(data);
    return true;
  }
}

const WS_CLOSE_CODES = {
  badRequest: 4400,
  normal: 1000,
  unauthorized: 4401,
};

function createLifecycleFixture(overrides = {}) {
  const wsSessionClients = new Map();
  const wsClientMeta = new Map();
  const sessions = new Map();
  const calls = {
    markSessionActivity: [],
    sendTurnSyncPayload: [],
    reconcileSessionLoops: [],
    reconcileTurnTimeoutLoop: [],
    handleSocketMessage: [],
    sendSocketError: [],
    safeCloseSocket: [],
    writeSocketFrame: [],
    logInfo: [],
    logWarn: [],
  };

  const lifecycle = createSocketLifecycle({
    wsSessionClients,
    wsClientMeta,
    maxMessageBytes: overrides.maxMessageBytes ?? 1024,
    wsCloseCodes: WS_CLOSE_CODES,
    parseSocketFrame:
      overrides.parseSocketFrame ??
      (() => null),
    writeSocketFrame:
      overrides.writeSocketFrame ??
      ((socket, opcode, payload) => {
        calls.writeSocketFrame.push({ socket, opcode, payload });
      }),
    getSession:
      overrides.getSession ??
      ((sessionId) => sessions.get(sessionId) ?? null),
    isBotParticipant:
      overrides.isBotParticipant ??
      (() => false),
    markSessionActivity:
      overrides.markSessionActivity ??
      ((session, playerId, now) => {
        calls.markSessionActivity.push({ session, playerId, now });
      }),
    sendTurnSyncPayload:
      overrides.sendTurnSyncPayload ??
      ((client, session, mode) => {
        calls.sendTurnSyncPayload.push({ client, session, mode });
      }),
    reconcileSessionLoops:
      overrides.reconcileSessionLoops ??
      ((sessionId) => {
        calls.reconcileSessionLoops.push(sessionId);
      }),
    reconcileTurnTimeoutLoop:
      overrides.reconcileTurnTimeoutLoop ??
      ((sessionId) => {
        calls.reconcileTurnTimeoutLoop.push(sessionId);
      }),
    handleSocketMessage:
      overrides.handleSocketMessage ??
      ((client, raw) => {
        calls.handleSocketMessage.push({ client, raw });
      }),
    sendSocketError:
      overrides.sendSocketError ??
      ((client, code, reason) => {
        calls.sendSocketError.push({ client, code, reason });
      }),
    safeCloseSocket:
      overrides.safeCloseSocket ??
      ((client, closeCode, reason) => {
        calls.safeCloseSocket.push({ client, closeCode, reason });
      }),
    log:
      overrides.log ??
      {
        info: (...args) => calls.logInfo.push(args),
        warn: (...args) => calls.logWarn.push(args),
      },
  });

  return {
    lifecycle,
    wsSessionClients,
    wsClientMeta,
    sessions,
    calls,
  };
}

function connectClient(lifecycle, auth) {
  const socket = new MockSocket();
  lifecycle.handleSocketConnection(socket, auth);
  return socket;
}

test("handleSocketConnection registers and unregisters clients with session sync", () => {
  const fixture = createLifecycleFixture();
  fixture.sessions.set("session-1", {
    participants: {
      "player-1": { lastHeartbeatAt: 0 },
    },
  });

  const socket = connectClient(fixture.lifecycle, {
    sessionId: "session-1",
    playerId: "player-1",
    tokenExpiresAt: Date.now() + 60000,
  });

  assert(fixture.wsClientMeta.has(socket), "Expected socket metadata registration");
  const sessionClients = fixture.wsSessionClients.get("session-1");
  assert.equal(sessionClients?.size, 1);
  assert.equal(fixture.calls.reconcileTurnTimeoutLoop.length, 1);
  assert.equal(fixture.calls.sendTurnSyncPayload.length, 1);
  assert.equal(fixture.calls.markSessionActivity.length, 1);
  assert(
    fixture.sessions.get("session-1").participants["player-1"].lastHeartbeatAt > 0,
    "Expected participant heartbeat refresh"
  );

  socket.emit("close");
  assert.equal(fixture.wsClientMeta.has(socket), false);
  assert.equal(fixture.wsSessionClients.has("session-1"), false);
});

test("text websocket frames are forwarded to the message handler", () => {
  let parseCount = 0;
  const fixture = createLifecycleFixture({
    parseSocketFrame: () => {
      if (parseCount === 0) {
        parseCount += 1;
        return {
          opcode: 0x1,
          payload: Buffer.from('{"type":"ping"}', "utf8"),
          bytesConsumed: 2,
        };
      }
      return null;
    },
  });
  fixture.sessions.set("session-2", {
    participants: {
      "player-2": { lastHeartbeatAt: Date.now() },
    },
  });

  const socket = connectClient(fixture.lifecycle, {
    sessionId: "session-2",
    playerId: "player-2",
    tokenExpiresAt: Date.now() + 60000,
  });
  socket.emit("data", Buffer.from([0xde, 0xad]));

  assert.equal(fixture.calls.handleSocketMessage.length, 1);
  assert.equal(fixture.calls.handleSocketMessage[0].raw, '{"type":"ping"}');
  socket.emit("close");
});

test("ping frames are replied to with pong frames", () => {
  let parseCount = 0;
  const fixture = createLifecycleFixture({
    parseSocketFrame: () => {
      if (parseCount === 0) {
        parseCount += 1;
        return {
          opcode: 0x9,
          payload: Buffer.from("abc", "utf8"),
          bytesConsumed: 1,
        };
      }
      return null;
    },
  });
  fixture.sessions.set("session-3", {
    participants: {
      "player-3": { lastHeartbeatAt: Date.now() },
    },
  });

  const socket = connectClient(fixture.lifecycle, {
    sessionId: "session-3",
    playerId: "player-3",
    tokenExpiresAt: Date.now() + 60000,
  });
  socket.emit("data", Buffer.from([0x01]));

  assert.equal(fixture.calls.writeSocketFrame.length, 1);
  assert.equal(fixture.calls.writeSocketFrame[0].opcode, 0x0a);
  assert.equal(fixture.calls.writeSocketFrame[0].payload.toString("utf8"), "abc");
  socket.emit("close");
});

test("frame parser errors trigger socket error + close", () => {
  const fixture = createLifecycleFixture({
    parseSocketFrame: () => ({
      error: "invalid_payload_shape",
      bytesConsumed: 1,
    }),
  });
  fixture.sessions.set("session-4", {
    participants: {
      "player-4": { lastHeartbeatAt: Date.now() },
    },
  });

  const socket = connectClient(fixture.lifecycle, {
    sessionId: "session-4",
    playerId: "player-4",
    tokenExpiresAt: Date.now() + 60000,
  });
  socket.emit("data", Buffer.from([0x01]));

  assert.equal(fixture.calls.sendSocketError.length, 1);
  assert.equal(fixture.calls.sendSocketError[0].code, "invalid_payload");
  assert.equal(fixture.calls.sendSocketError[0].reason, "invalid_payload_shape");
  assert.equal(fixture.calls.safeCloseSocket.length, 1);
  assert.equal(fixture.calls.safeCloseSocket[0].closeCode, WS_CLOSE_CODES.badRequest);
  assert.equal(fixture.calls.safeCloseSocket[0].reason, "invalid_payload_shape");
  socket.emit("close");
});

test("oversized read buffers are rejected before frame parsing", () => {
  let parseCalled = false;
  const fixture = createLifecycleFixture({
    maxMessageBytes: 4,
    parseSocketFrame: () => {
      parseCalled = true;
      return null;
    },
  });
  fixture.sessions.set("session-5", {
    participants: {
      "player-5": { lastHeartbeatAt: Date.now() },
    },
  });

  const socket = connectClient(fixture.lifecycle, {
    sessionId: "session-5",
    playerId: "player-5",
    tokenExpiresAt: Date.now() + 60000,
  });
  socket.emit("data", Buffer.alloc(9));

  assert.equal(parseCalled, false);
  assert.equal(fixture.calls.sendSocketError.length, 1);
  assert.equal(fixture.calls.sendSocketError[0].code, "message_too_large");
  assert.equal(fixture.calls.safeCloseSocket.length, 1);
  assert.equal(fixture.calls.safeCloseSocket[0].reason, "message_too_large");
  socket.emit("close");
});

test("disconnectPlayerSockets targets only matching session/player clients", () => {
  const fixture = createLifecycleFixture();
  fixture.sessions.set("session-6", {
    participants: {
      "player-a": { lastHeartbeatAt: Date.now() },
      "player-b": { lastHeartbeatAt: Date.now() },
    },
  });
  fixture.sessions.set("session-7", {
    participants: {
      "player-a": { lastHeartbeatAt: Date.now() },
    },
  });

  const socketA = connectClient(fixture.lifecycle, {
    sessionId: "session-6",
    playerId: "player-a",
    tokenExpiresAt: Date.now() + 60000,
  });
  const socketB = connectClient(fixture.lifecycle, {
    sessionId: "session-6",
    playerId: "player-b",
    tokenExpiresAt: Date.now() + 60000,
  });
  const socketC = connectClient(fixture.lifecycle, {
    sessionId: "session-7",
    playerId: "player-a",
    tokenExpiresAt: Date.now() + 60000,
  });

  fixture.lifecycle.disconnectPlayerSockets("session-6", "player-a", 4005, "player_removed");

  assert.equal(fixture.calls.safeCloseSocket.length, 1);
  assert.equal(fixture.calls.safeCloseSocket[0].client.playerId, "player-a");
  assert.equal(fixture.calls.safeCloseSocket[0].client.sessionId, "session-6");
  assert.equal(fixture.calls.safeCloseSocket[0].closeCode, 4005);
  assert.equal(fixture.calls.safeCloseSocket[0].reason, "player_removed");

  socketA.emit("close");
  socketB.emit("close");
  socketC.emit("close");
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
  console.log(`All socketLifecycle tests passed (${tests.length}).`);
}

await run();

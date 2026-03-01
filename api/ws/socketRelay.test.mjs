import assert from "node:assert/strict";
import { createSocketRelay } from "./socketRelay.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createClient(playerId, options = {}) {
  return {
    playerId,
    closed: Boolean(options.closed),
    socket: {
      destroyed: Boolean(options.destroyed),
      id: options.id ?? playerId,
    },
  };
}

function createFixture(overrides = {}) {
  const wsSessionClients = new Map();
  const calls = {
    writes: [],
    closes: [],
    blocks: [],
    warns: [],
  };
  const blockPairs = new Set(overrides.blockPairs ?? []);

  const relay = createSocketRelay({
    wsSessionClients,
    writeSocketFrame:
      overrides.writeSocketFrame ??
      ((socket, opcode, payload) => {
        calls.writes.push({ socket, opcode, payload });
      }),
    safeCloseSocket:
      overrides.safeCloseSocket ??
      ((client, closeCode, reason) => {
        calls.closes.push({ client, closeCode, reason });
      }),
    wsCloseCodes: {
      internalError: 1011,
    },
    hasRoomChannelBlockRelationship:
      overrides.hasRoomChannelBlockRelationship ??
      ((_session, targetPlayerId, sourcePlayerId) => {
        const key = `${targetPlayerId}:${sourcePlayerId}`;
        calls.blocks.push(key);
        return blockPairs.has(key);
      }),
    log: {
      warn: (...args) => calls.warns.push(args),
    },
  });

  return {
    relay,
    wsSessionClients,
    calls,
  };
}

test("broadcastToSession sends to active peers except sender", () => {
  const fixture = createFixture();
  const sender = createClient("player-a");
  const recipient = createClient("player-b");
  const closed = createClient("player-c", { closed: true });
  const destroyed = createClient("player-d", { destroyed: true });
  fixture.wsSessionClients.set("session-1", new Set([sender, recipient, closed, destroyed]));

  fixture.relay.broadcastToSession("session-1", '{"type":"ping"}', sender);

  assert.equal(fixture.calls.writes.length, 1);
  assert.equal(fixture.calls.writes[0].socket.id, "player-b");
  assert.equal(fixture.calls.writes[0].opcode, 0x1);
  assert.equal(fixture.calls.writes[0].payload.toString("utf8"), '{"type":"ping"}');
});

test("sendToSessionPlayer only targets matching player id", () => {
  const fixture = createFixture();
  const a = createClient("player-a");
  const b = createClient("player-b");
  fixture.wsSessionClients.set("session-2", new Set([a, b]));

  fixture.relay.sendToSessionPlayer("session-2", "player-b", '{"type":"direct"}');

  assert.equal(fixture.calls.writes.length, 1);
  assert.equal(fixture.calls.writes[0].socket.id, "player-b");
});

test("broadcastRoomChannelToSession skips blocked recipients", () => {
  const fixture = createFixture({
    blockPairs: ["player-b:player-a"],
  });
  const source = createClient("player-a");
  const blockedRecipient = createClient("player-b");
  const allowedRecipient = createClient("player-c");
  fixture.wsSessionClients.set("session-3", new Set([source, blockedRecipient, allowedRecipient]));

  fixture.relay.broadcastRoomChannelToSession(
    { sessionId: "session-3" },
    {
      type: "room_channel",
      sourcePlayerId: "player-a",
      content: "hello",
    },
    null
  );

  assert.equal(fixture.calls.writes.length, 1);
  assert.equal(fixture.calls.writes[0].socket.id, "player-c");
});

test("broadcastRealtimeSocketMessageToSession applies block checks for source player", () => {
  const fixture = createFixture({
    blockPairs: ["player-c:player-a"],
  });
  const source = createClient("player-a");
  const allowed = createClient("player-b");
  const blocked = createClient("player-c");
  fixture.wsSessionClients.set("session-4", new Set([source, allowed, blocked]));

  fixture.relay.broadcastRealtimeSocketMessageToSession(
    { sessionId: "session-4" },
    {
      type: "chat_typing",
      sourcePlayerId: "player-a",
    },
    source
  );

  assert.equal(fixture.calls.writes.length, 1);
  assert.equal(fixture.calls.writes[0].socket.id, "player-b");
});

test("sendSocketError emits error payloads as websocket text frames", () => {
  const fixture = createFixture();
  const client = createClient("player-a");

  fixture.relay.sendSocketError(client, "unauthorized", "player_not_in_session");

  assert.equal(fixture.calls.writes.length, 1);
  const payload = JSON.parse(fixture.calls.writes[0].payload.toString("utf8"));
  assert.equal(payload.type, "error");
  assert.equal(payload.code, "unauthorized");
  assert.equal(payload.message, "player_not_in_session");
});

test("broadcast failures close the failing socket with internal error", () => {
  const failingClient = createClient("player-failing");
  const fixture = createFixture({
    writeSocketFrame: (socket) => {
      if (socket.id === "player-failing") {
        throw new Error("send failed");
      }
    },
  });
  fixture.wsSessionClients.set("session-5", new Set([failingClient]));

  fixture.relay.broadcastToSession("session-5", '{"type":"state"}', null);

  assert.equal(fixture.calls.closes.length, 1);
  assert.equal(fixture.calls.closes[0].client.playerId, "player-failing");
  assert.equal(fixture.calls.closes[0].closeCode, 1011);
  assert.equal(fixture.calls.closes[0].reason, "send_failed");
  assert.equal(fixture.calls.warns.length, 1);
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

  console.log(`All socketRelay tests passed (${tests.length}).`);
}

await run();

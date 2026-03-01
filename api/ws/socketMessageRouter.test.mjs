import assert from "node:assert/strict";
import { createSocketMessageRouter } from "./socketMessageRouter.mjs";
import { isSupportedSocketPayload } from "./socketPayloadValidation.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createFixture(overrides = {}) {
  const wsClientMeta = new Map();
  const sessions = new Map(Object.entries(overrides.sessions ?? {}));
  let currentNow = overrides.now ?? 1_700_000_000_000;
  let nextId = 0;
  const calls = {
    sendSocketError: [],
    safeCloseSocket: [],
    markSessionActivity: [],
    reconcileSessionLoops: [],
    sendSocketPayload: [],
    broadcastToSession: [],
    sendToSessionPlayer: [],
    broadcastRoomChannelToSession: [],
    broadcastRealtimeSocketMessageToSession: [],
    handleTurnEndMessage: [],
    handleTurnActionMessage: [],
    roomChannelFilterExecute: [],
    upsertSessionRoomBan: [],
    removeParticipantFromSession: [],
    broadcastSystemRoomChannelMessage: [],
    persistStore: 0,
    warns: [],
  };

  const roomChannelFilterRegistry = {
    execute: (scope, context) => {
      calls.roomChannelFilterExecute.push({ scope, context });
      if (typeof overrides.executeFilter === "function") {
        return overrides.executeFilter(scope, context);
      }
      return {
        allowed: true,
        stateChanged: false,
      };
    },
  };

  const router = createSocketMessageRouter({
    wsClientMeta,
    isSupportedSocketPayload,
    getSession: (sessionId) => sessions.get(sessionId) ?? null,
    wsCloseCodes: {
      sessionExpired: 4408,
      forbidden: 4403,
    },
    markSessionActivity: (session, playerId, timestamp) => {
      calls.markSessionActivity.push({ session, playerId, timestamp });
    },
    reconcileSessionLoops: (sessionId) => {
      calls.reconcileSessionLoops.push(sessionId);
    },
    sendSocketError: (client, code, reason) => {
      calls.sendSocketError.push({ client, code, reason });
    },
    safeCloseSocket: (client, closeCode, reason) => {
      calls.safeCloseSocket.push({ client, closeCode, reason });
    },
    sendSocketPayload: (client, payload) => {
      calls.sendSocketPayload.push({ client, payload });
    },
    broadcastToSession: (sessionId, rawMessage, sender) => {
      calls.broadcastToSession.push({ sessionId, rawMessage, sender });
    },
    sendToSessionPlayer: (sessionId, playerId, rawMessage, sender) => {
      calls.sendToSessionPlayer.push({ sessionId, playerId, rawMessage, sender });
    },
    broadcastRoomChannelToSession: (session, payload, sender) => {
      calls.broadcastRoomChannelToSession.push({ session, payload, sender });
    },
    broadcastRealtimeSocketMessageToSession: (session, payload, sender) => {
      calls.broadcastRealtimeSocketMessageToSession.push({ session, payload, sender });
    },
    handleTurnEndMessage: (client, session) => {
      calls.handleTurnEndMessage.push({ client, session });
    },
    handleTurnActionMessage: (client, session, payload) => {
      calls.handleTurnActionMessage.push({ client, session, payload });
    },
    roomChannelFilterRegistry,
    roomChannelFilterScopePreflight: "preflight",
    roomChannelFilterScopeInbound: "inbound",
    realtimeFilterScopeDirectDelivery: "direct_delivery",
    normalizeRoomChannelMessage:
      overrides.normalizeRoomChannelMessage ??
      ((value) => (typeof value === "string" ? value.trim() : "")),
    normalizeRoomChannelTopic:
      overrides.normalizeRoomChannelTopic ??
      ((value) => (typeof value === "string" ? value.trim().toLowerCase() : "")),
    normalizeRoomChannelTitle:
      overrides.normalizeRoomChannelTitle ??
      ((value) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : "Message")),
    upsertSessionRoomBan: (session, targetPlayerId, options) => {
      calls.upsertSessionRoomBan.push({ session, targetPlayerId, options });
    },
    removeParticipantFromSession: (sessionId, playerId, options) => {
      calls.removeParticipantFromSession.push({ sessionId, playerId, options });
    },
    broadcastSystemRoomChannelMessage: (sessionId, options) => {
      calls.broadcastSystemRoomChannelMessage.push({ sessionId, options });
    },
    persistStore: () => {
      calls.persistStore += 1;
      return Promise.resolve();
    },
    createId: () => `generated-${++nextId}`,
    now: () => currentNow,
    log: {
      warn: (...args) => calls.warns.push(args),
    },
  });

  return {
    router,
    wsClientMeta,
    sessions,
    calls,
    setNow: (nextNow) => {
      currentNow = nextNow;
    },
  };
}

function createClient(overrides = {}) {
  const socket = {};
  return {
    sessionId: overrides.sessionId ?? "session-1",
    playerId: overrides.playerId ?? "player-1",
    socket,
  };
}

test("ignores messages for unknown sockets", () => {
  const fixture = createFixture();
  const client = createClient();
  fixture.router.handleSocketMessage(client, '{"type":"turn_end"}');
  assert.equal(fixture.calls.sendSocketError.length, 0);
  assert.equal(fixture.calls.handleTurnEndMessage.length, 0);
});

test("rejects malformed JSON payloads", () => {
  const fixture = createFixture();
  const client = createClient();
  fixture.wsClientMeta.set(client.socket, { connectedAt: fixture.setNow });
  fixture.router.handleSocketMessage(client, '{"type":');
  assert.equal(fixture.calls.sendSocketError.length, 1);
  assert.equal(fixture.calls.sendSocketError[0].code, "invalid_payload");
});

test("rejects expired sessions and closes sockets", () => {
  const fixture = createFixture({
    sessions: {
      "session-1": {
        sessionId: "session-1",
        expiresAt: 1_699_999_999_000,
        participants: {
          "player-1": { lastHeartbeatAt: 0 },
        },
      },
    },
  });
  const client = createClient();
  fixture.wsClientMeta.set(client.socket, { connectedAt: 1 });

  fixture.router.handleSocketMessage(client, '{"type":"chaos_attack"}');

  assert.equal(fixture.calls.sendSocketError.length, 1);
  assert.equal(fixture.calls.sendSocketError[0].code, "session_expired");
  assert.equal(fixture.calls.safeCloseSocket.length, 1);
  assert.equal(fixture.calls.safeCloseSocket[0].closeCode, 4408);
});

test("routes turn_end payloads to turn-end handler", () => {
  const fixture = createFixture({
    sessions: {
      "session-1": {
        sessionId: "session-1",
        expiresAt: 1_700_000_030_000,
        participants: {
          "player-1": { lastHeartbeatAt: 0 },
        },
      },
    },
  });
  const client = createClient();
  fixture.wsClientMeta.set(client.socket, { connectedAt: 1 });

  fixture.router.handleSocketMessage(client, '{"type":"turn_end"}');

  assert.equal(fixture.calls.handleTurnEndMessage.length, 1);
  assert.equal(fixture.calls.handleTurnActionMessage.length, 0);
});

test("routes game_update payloads through realtime relay and loop reconciliation", () => {
  const fixture = createFixture({
    sessions: {
      "session-1": {
        sessionId: "session-1",
        expiresAt: 1_700_000_030_000,
        participants: {
          "player-1": { lastHeartbeatAt: 0 },
        },
      },
    },
    now: 1_700_000_010_000,
  });
  const client = createClient();
  fixture.wsClientMeta.set(client.socket, { connectedAt: 1 });

  fixture.router.handleSocketMessage(
    client,
    '{"type":"game_update","title":"Round","content":"Started"}'
  );

  assert.equal(fixture.calls.markSessionActivity.length, 1);
  assert.equal(
    fixture.sessions.get("session-1").participants["player-1"].lastHeartbeatAt,
    1_700_000_010_000
  );
  assert.equal(fixture.calls.broadcastRealtimeSocketMessageToSession.length, 1);
  const message = fixture.calls.broadcastRealtimeSocketMessageToSession[0].payload;
  assert.equal(message.sourcePlayerId, "player-1");
  assert.equal(message.playerId, "player-1");
  assert.equal(message.timestamp, 1_700_000_010_000);
  assert.equal(fixture.calls.reconcileSessionLoops.length, 1);
});

test("rejects room-channel preflight failures", () => {
  const fixture = createFixture({
    sessions: {
      "session-1": {
        sessionId: "session-1",
        expiresAt: 1_700_000_030_000,
        participants: {
          "player-1": { lastHeartbeatAt: 0 },
        },
      },
    },
    executeFilter: (scope) => {
      if (scope === "preflight") {
        return {
          allowed: false,
          code: "room_channel_sender_restricted",
          reason: "sender_restricted",
        };
      }
      return { allowed: true, stateChanged: false };
    },
  });
  const client = createClient();
  fixture.wsClientMeta.set(client.socket, { connectedAt: 1 });

  fixture.router.handleSocketMessage(
    client,
    '{"type":"room_channel","channel":"public","message":"Hello"}'
  );

  assert.equal(fixture.calls.sendSocketError.length, 1);
  assert.equal(fixture.calls.sendSocketError[0].code, "room_channel_sender_restricted");
});

test("rejects direct room-channel messages without a target player", () => {
  const fixture = createFixture({
    sessions: {
      "session-1": {
        sessionId: "session-1",
        expiresAt: 1_700_000_030_000,
        participants: {
          "player-1": { lastHeartbeatAt: 0 },
        },
      },
    },
  });
  const client = createClient();
  fixture.wsClientMeta.set(client.socket, { connectedAt: 1 });

  fixture.router.handleSocketMessage(
    client,
    '{"type":"room_channel","channel":"direct","message":"Hello"}'
  );

  assert.equal(fixture.calls.sendSocketError.length, 1);
  assert.equal(fixture.calls.sendSocketError[0].code, "invalid_target_player");
  assert.equal(
    fixture.calls.sendSocketError[0].reason,
    "target_player_required_for_direct"
  );
});

test("applies room-channel moderation auto-ban flow and persists conduct state", async () => {
  const fixture = createFixture({
    sessions: {
      "session-1": {
        sessionId: "session-1",
        expiresAt: 1_700_000_030_000,
        participants: {
          "player-1": { lastHeartbeatAt: 0, displayName: "Alice" },
        },
      },
    },
    executeFilter: (scope) => {
      if (scope === "preflight") {
        return { allowed: true, stateChanged: false };
      }
      if (scope === "inbound") {
        return {
          allowed: false,
          stateChanged: true,
          outcome: {
            code: "moderation_blocked",
            reason: "term_violation",
            shouldAutoBan: true,
            warning: {
              title: "Warning",
              message: "Message blocked",
              detail: "Use different language.",
              severity: "warning",
            },
          },
        };
      }
      return { allowed: true, stateChanged: false };
    },
  });
  const client = createClient();
  fixture.wsClientMeta.set(client.socket, { connectedAt: 1 });

  fixture.router.handleSocketMessage(
    client,
    '{"type":"room_channel","channel":"public","message":"Bad term"}'
  );
  await Promise.resolve();

  assert.equal(fixture.calls.sendSocketPayload.length, 1);
  assert.equal(fixture.calls.sendSocketPayload[0].payload.type, "player_notification");
  assert.equal(fixture.calls.sendSocketError.length, 1);
  assert.equal(fixture.calls.sendSocketError[0].code, "moderation_blocked");
  assert.equal(fixture.calls.upsertSessionRoomBan.length, 1);
  assert.equal(fixture.calls.removeParticipantFromSession.length, 1);
  assert.equal(fixture.calls.broadcastSystemRoomChannelMessage.length, 1);
  assert.equal(fixture.calls.persistStore, 1);
});

test("routes direct targeted non-room messages through sendToSessionPlayer", () => {
  const fixture = createFixture({
    sessions: {
      "session-1": {
        sessionId: "session-1",
        expiresAt: 1_700_000_030_000,
        participants: {
          "player-1": { lastHeartbeatAt: 0 },
          "player-2": { lastHeartbeatAt: 0 },
        },
      },
    },
  });
  const client = createClient();
  fixture.wsClientMeta.set(client.socket, { connectedAt: 1 });

  fixture.router.handleSocketMessage(
    client,
    '{"type":"player_notification","message":"Heads up","targetPlayerId":"player-2"}'
  );

  assert.equal(fixture.calls.sendToSessionPlayer.length, 1);
  assert.equal(fixture.calls.sendToSessionPlayer[0].playerId, "player-2");
  const directPayload = JSON.parse(fixture.calls.sendToSessionPlayer[0].rawMessage);
  assert.equal(directPayload.targetPlayerId, "player-2");
  assert.equal(directPayload.sourcePlayerId, "player-1");
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

  console.log(`All socketMessageRouter tests passed (${tests.length}).`);
}

await run();

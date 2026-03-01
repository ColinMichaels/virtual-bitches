import assert from "node:assert/strict";
import { createSessionMembershipService } from "./sessionMembershipService.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createFixture(options = {}) {
  let nowValue = options.now ?? 10_000;
  const store =
    options.store ?? {
      multiplayerSessions: {},
    };

  const calls = {
    disconnect: [],
    ensureOwner: [],
    ensureTurnState: [],
    expireSession: [],
    resetPublicRoom: [],
    reconcileLoops: [],
    broadcastSessionState: [],
    maybeForfeit: [],
    markSessionActivity: [],
    buildTurnStartMessage: [],
    broadcastToSession: [],
    reconcileInventory: [],
  };

  const service = createSessionMembershipService({
    getStore: () => store,
    roomKinds: {
      private: "private",
      publicDefault: "public_default",
      publicOverflow: "public_overflow",
    },
    wsCloseCodes: {
      normal: 1000,
    },
    disconnectPlayerSockets: (sessionId, playerId, code, reason) => {
      calls.disconnect.push({ sessionId, playerId, code, reason });
    },
    getHumanParticipantCount: (session) => {
      if (typeof options.getHumanParticipantCount === "function") {
        return options.getHumanParticipantCount(session);
      }
      return Object.values(session?.participants ?? {}).filter((participant) => participant?.isBot !== true)
        .length;
    },
    getSessionRoomKind: (session) => session?.roomKind ?? "private",
    ensureSessionOwner: (session) => {
      calls.ensureOwner.push(session?.sessionId);
      const firstHuman = Object.values(session?.participants ?? {}).find(
        (participant) => participant?.isBot !== true
      );
      session.ownerPlayerId = firstHuman?.playerId ?? null;
      return session.ownerPlayerId;
    },
    ensureSessionTurnState: (session) => {
      calls.ensureTurnState.push(session?.sessionId);
      if (!session.turnState) {
        session.turnState = { phase: "active" };
      }
      return session.turnState;
    },
    expireSession: (sessionId, reason) => {
      calls.expireSession.push({ sessionId, reason });
      delete store.multiplayerSessions[sessionId];
    },
    resetPublicRoomForIdle: (session, at) => {
      calls.resetPublicRoom.push({ sessionId: session?.sessionId, at });
    },
    reconcileSessionLoops: (sessionId) => {
      calls.reconcileLoops.push(sessionId);
    },
    broadcastSessionState: (session, source) => {
      calls.broadcastSessionState.push({ sessionId: session?.sessionId, source });
    },
    maybeForfeitSessionForSingleHumanRemaining: (session, at) => {
      calls.maybeForfeit.push({ sessionId: session?.sessionId, at });
      if (typeof options.maybeForfeitSessionForSingleHumanRemaining === "function") {
        return options.maybeForfeitSessionForSingleHumanRemaining(session, at);
      }
      return false;
    },
    markSessionActivity: (session, playerId, at) => {
      calls.markSessionActivity.push({ sessionId: session?.sessionId, playerId, at });
      session.lastActivityAt = at;
    },
    buildTurnStartMessage: (session, payload) => {
      calls.buildTurnStartMessage.push({ sessionId: session?.sessionId, payload });
      if (typeof options.buildTurnStartMessage === "function") {
        return options.buildTurnStartMessage(session, payload);
      }
      return {
        type: "turn_start",
        sessionId: session?.sessionId,
      };
    },
    broadcastToSession: (sessionId, payload, senderId) => {
      calls.broadcastToSession.push({ sessionId, payload, senderId });
    },
    reconcilePublicRoomInventory: (at) => {
      calls.reconcileInventory.push(at);
      if (typeof options.reconcilePublicRoomInventory === "function") {
        return options.reconcilePublicRoomInventory(at);
      }
      return false;
    },
    now: () => nowValue,
  });

  return {
    service,
    store,
    calls,
    setNow: (value) => {
      nowValue = value;
    },
  };
}

function createSession(overrides = {}) {
  return {
    sessionId: overrides.sessionId ?? "session-1",
    roomKind: overrides.roomKind ?? "private",
    ownerPlayerId: overrides.ownerPlayerId ?? "host",
    participants:
      overrides.participants ?? {
        host: {
          playerId: "host",
          isBot: false,
        },
      },
    chatConductState: {
      players: {
        ...(overrides.chatConductPlayers ?? {}),
      },
    },
    turnState: overrides.turnState ?? null,
  };
}

test("removeParticipantFromSession returns unknown_session for missing room", () => {
  const fixture = createFixture();
  const result = fixture.service.removeParticipantFromSession("missing", "player-1");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown_session");
});

test("removeParticipantFromSession returns unknown_player when participant not found", () => {
  const session = createSession();
  const fixture = createFixture({
    store: {
      multiplayerSessions: {
        [session.sessionId]: session,
      },
    },
  });

  const result = fixture.service.removeParticipantFromSession(session.sessionId, "unknown");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown_player");
});

test("removeParticipantFromSession expires private room when last human leaves", () => {
  const session = createSession({
    roomKind: "private",
    participants: {
      host: {
        playerId: "host",
        isBot: false,
      },
    },
    chatConductPlayers: {
      host: { strikes: 1 },
    },
  });
  const fixture = createFixture({
    store: {
      multiplayerSessions: {
        [session.sessionId]: session,
      },
    },
  });

  const result = fixture.service.removeParticipantFromSession(session.sessionId, "host");

  assert.equal(result.ok, true);
  assert.equal(result.sessionExpired, true);
  assert.deepEqual(fixture.calls.expireSession, [{ sessionId: session.sessionId, reason: "session_empty" }]);
  assert.equal(fixture.calls.resetPublicRoom.length, 0);
  assert.equal(fixture.calls.broadcastSessionState.length, 0);
});

test("removeParticipantFromSession resets public room when last human leaves", () => {
  const session = createSession({
    roomKind: "public_default",
    participants: {
      host: {
        playerId: "host",
        isBot: false,
      },
    },
  });
  const fixture = createFixture({
    store: {
      multiplayerSessions: {
        [session.sessionId]: session,
      },
    },
    reconcilePublicRoomInventory: () => true,
  });

  const result = fixture.service.removeParticipantFromSession(session.sessionId, "host", {
    source: "leave",
    socketReason: "left_session",
  });

  assert.equal(result.ok, true);
  assert.equal(result.sessionExpired, false);
  assert.equal(result.roomInventoryChanged, true);
  assert.equal(fixture.calls.resetPublicRoom.length, 1);
  assert.deepEqual(fixture.calls.broadcastSessionState, [{ sessionId: session.sessionId, source: "leave" }]);
  assert.deepEqual(fixture.calls.reconcileLoops, [session.sessionId]);
});

test("removeParticipantFromSession broadcasts turn reassign for active room when not forfeited", () => {
  const session = createSession({
    roomKind: "private",
    participants: {
      host: { playerId: "host", isBot: false },
      guest: { playerId: "guest", isBot: false },
    },
    chatConductPlayers: {
      host: { strikes: 1 },
      guest: { strikes: 2 },
    },
  });
  const fixture = createFixture({
    store: {
      multiplayerSessions: {
        [session.sessionId]: session,
      },
    },
  });

  const result = fixture.service.removeParticipantFromSession(session.sessionId, "host", {
    source: "moderation_kick",
    socketReason: "removed_by_moderator",
  });

  assert.equal(result.ok, true);
  assert.equal(result.sessionExpired, false);
  assert.ok(!session.participants.host);
  assert.ok(!session.chatConductState.players.host);
  assert.equal(fixture.calls.disconnect.length, 1);
  assert.equal(fixture.calls.maybeForfeit.length, 1);
  assert.equal(fixture.calls.markSessionActivity.length, 1);
  assert.equal(fixture.calls.broadcastToSession.length, 1);
  assert.equal(fixture.calls.broadcastSessionState.length, 1);
  assert.equal(fixture.calls.broadcastSessionState[0].source, "moderation_kick");
});

test("removeParticipantFromSession skips turn-start broadcast when forfeited", () => {
  const session = createSession({
    roomKind: "private",
    participants: {
      host: { playerId: "host", isBot: false },
      guest: { playerId: "guest", isBot: false },
    },
  });
  const fixture = createFixture({
    store: {
      multiplayerSessions: {
        [session.sessionId]: session,
      },
    },
    maybeForfeitSessionForSingleHumanRemaining: () => true,
  });

  const result = fixture.service.removeParticipantFromSession(session.sessionId, "host");

  assert.equal(result.ok, true);
  assert.equal(fixture.calls.broadcastToSession.length, 0);
  assert.equal(fixture.calls.broadcastSessionState.length, 1);
});

async function run() {
  let passed = 0;
  for (const entry of tests) {
    await entry.fn();
    passed += 1;
    console.log(`\u2713 ${entry.name}`);
  }
  console.log(`All sessionMembershipService tests passed (${passed}).`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

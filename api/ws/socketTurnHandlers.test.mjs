import assert from "node:assert/strict";
import { createSocketTurnMessageHandlers } from "./socketTurnHandlers.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createFixture(overrides = {}) {
  let currentNow = overrides.now ?? 1_700_000_000_000;
  const calls = {
    markSessionActivity: [],
    processTurnAction: [],
    sendSocketError: [],
    sendTurnSyncPayload: [],
    broadcastToSession: [],
    broadcastRoundWinnerResolved: [],
    broadcastSessionState: [],
    persistStore: 0,
    reconcileSessionLoops: [],
    clearParticipantTimeoutStrike: [],
    advanceSessionTurn: [],
    infos: [],
    warns: [],
  };

  const handlers = createSocketTurnMessageHandlers({
    turnPhases: {
      readyToEnd: "ready_to_end",
    },
    ensureSessionTurnState:
      overrides.ensureSessionTurnState ??
      ((session) => session.turnState ?? null),
    normalizeTurnPhase:
      overrides.normalizeTurnPhase ??
      ((phase) => phase),
    markSessionActivity: (session, playerId, timestamp) => {
      calls.markSessionActivity.push({ session, playerId, timestamp });
    },
    processTurnAction:
      overrides.processTurnAction ??
      ((session, playerId, payload) => {
        calls.processTurnAction.push({ session, playerId, payload });
        return {
          ok: false,
          code: "turn_failed",
          reason: "turn_failed",
          sync: false,
        };
      }),
    sendSocketError: (client, code, reason) => {
      calls.sendSocketError.push({ client, code, reason });
    },
    sendTurnSyncPayload: (client, session, source) => {
      calls.sendTurnSyncPayload.push({ client, session, source });
    },
    broadcastToSession: (sessionId, rawMessage, sender) => {
      calls.broadcastToSession.push({ sessionId, rawMessage, sender });
    },
    broadcastRoundWinnerResolved: (...args) => {
      calls.broadcastRoundWinnerResolved.push(args);
    },
    broadcastSessionState: (session, source) => {
      calls.broadcastSessionState.push({ session, source });
    },
    persistStore: () => {
      calls.persistStore += 1;
      return Promise.resolve();
    },
    reconcileSessionLoops: (sessionId) => {
      calls.reconcileSessionLoops.push(sessionId);
    },
    clearParticipantTimeoutStrike: (participant) => {
      calls.clearParticipantTimeoutStrike.push(participant);
    },
    advanceSessionTurn:
      overrides.advanceSessionTurn ??
      ((session, playerId, options) => {
        calls.advanceSessionTurn.push({ session, playerId, options });
        return null;
      }),
    log: {
      info: (...args) => calls.infos.push(args),
      warn: (...args) => calls.warns.push(args),
    },
    now: () => currentNow,
  });

  return {
    handlers,
    calls,
    setNow: (nextNow) => {
      currentNow = nextNow;
    },
  };
}

function createSession() {
  return {
    sessionId: "session-1",
    participants: {
      "player-1": { lastHeartbeatAt: 0 },
    },
  };
}

function createClient() {
  return {
    sessionId: "session-1",
    playerId: "player-1",
  };
}

test("turn_action failures return error and optional sync", () => {
  const fixture = createFixture({
    processTurnAction: () => ({
      ok: false,
      code: "turn_invalid",
      reason: "turn_invalid",
      sync: true,
    }),
  });
  const session = createSession();
  const client = createClient();

  fixture.handlers.handleTurnActionMessage(client, session, { type: "turn_action" });

  assert.equal(session.participants["player-1"].lastHeartbeatAt, 1_700_000_000_000);
  assert.equal(fixture.calls.markSessionActivity.length, 1);
  assert.equal(fixture.calls.sendSocketError.length, 1);
  assert.equal(fixture.calls.sendSocketError[0].code, "turn_invalid");
  assert.equal(fixture.calls.sendTurnSyncPayload.length, 1);
  assert.equal(fixture.calls.reconcileSessionLoops.length, 0);
});

test("turn_action success broadcasts message, winner, state, and persists", async () => {
  const fixture = createFixture({
    processTurnAction: () => ({
      ok: true,
      action: "score",
      message: { type: "turn_action", action: "score" },
      winnerResolved: true,
      actionTimestamp: 123,
      shouldBroadcastState: true,
      shouldPersist: true,
    }),
  });
  const session = createSession();
  const client = createClient();

  fixture.handlers.handleTurnActionMessage(client, session, { type: "turn_action" });
  await Promise.resolve();

  assert.equal(fixture.calls.broadcastToSession.length, 1);
  assert.equal(
    fixture.calls.broadcastToSession[0].rawMessage,
    JSON.stringify({ type: "turn_action", action: "score" })
  );
  assert.equal(fixture.calls.broadcastRoundWinnerResolved.length, 1);
  assert.equal(fixture.calls.broadcastSessionState.length, 1);
  assert.equal(fixture.calls.broadcastSessionState[0].source, "turn_score");
  assert.equal(fixture.calls.persistStore, 1);
  assert.equal(fixture.calls.reconcileSessionLoops.length, 1);
});

test("turn_action success without state broadcast still reconciles loops", () => {
  const fixture = createFixture({
    processTurnAction: () => ({
      ok: true,
      action: "roll",
      shouldBroadcastState: false,
      shouldPersist: false,
      winnerResolved: false,
      message: null,
    }),
  });
  const session = createSession();
  const client = createClient();

  fixture.handlers.handleTurnActionMessage(client, session, { type: "turn_action" });

  assert.equal(fixture.calls.broadcastSessionState.length, 0);
  assert.equal(fixture.calls.persistStore, 0);
  assert.equal(fixture.calls.reconcileSessionLoops.length, 1);
});

test("turn_end rejects when no active turn", () => {
  const fixture = createFixture({
    ensureSessionTurnState: () => ({ activeTurnPlayerId: "" }),
  });
  const session = createSession();
  const client = createClient();

  fixture.handlers.handleTurnEndMessage(client, session);

  assert.equal(fixture.calls.sendSocketError.length, 1);
  assert.equal(fixture.calls.sendSocketError[0].code, "turn_unavailable");
});

test("turn_end rejects when player is not active", () => {
  const fixture = createFixture({
    ensureSessionTurnState: () => ({
      activeTurnPlayerId: "player-2",
      phase: "ready_to_end",
      round: 1,
      turnNumber: 1,
      order: ["player-2", "player-1"],
    }),
  });
  const session = createSession();
  const client = createClient();

  fixture.handlers.handleTurnEndMessage(client, session);

  assert.equal(fixture.calls.sendSocketError.length, 1);
  assert.equal(fixture.calls.sendSocketError[0].code, "turn_not_active");
  assert.equal(fixture.calls.sendTurnSyncPayload.length, 1);
});

test("turn_end rejects when turn phase is not ready_to_end", () => {
  const fixture = createFixture({
    ensureSessionTurnState: () => ({
      activeTurnPlayerId: "player-1",
      phase: "await_score",
      round: 1,
      turnNumber: 2,
      order: ["player-1", "player-2"],
    }),
  });
  const session = createSession();
  const client = createClient();

  fixture.handlers.handleTurnEndMessage(client, session);

  assert.equal(fixture.calls.sendSocketError.length, 1);
  assert.equal(fixture.calls.sendSocketError[0].code, "turn_action_required");
  assert.equal(fixture.calls.sendTurnSyncPayload.length, 1);
});

test("turn_end rejects when turn advance fails", () => {
  const fixture = createFixture({
    ensureSessionTurnState: () => ({
      activeTurnPlayerId: "player-1",
      phase: "ready_to_end",
      round: 2,
      turnNumber: 4,
      order: ["player-1", "player-2"],
    }),
    advanceSessionTurn: () => null,
  });
  const session = createSession();
  const client = createClient();

  fixture.handlers.handleTurnEndMessage(client, session);

  assert.equal(fixture.calls.clearParticipantTimeoutStrike.length, 1);
  assert.equal(fixture.calls.sendSocketError.length, 1);
  assert.equal(fixture.calls.sendSocketError[0].code, "turn_advance_failed");
});

test("turn_end success broadcasts transition, state, persists, and reconciles loops", async () => {
  const fixture = createFixture({
    ensureSessionTurnState: () => ({
      activeTurnPlayerId: "player-1",
      phase: "ready_to_end",
      round: 3,
      turnNumber: 8,
      order: ["player-1", "player-2"],
    }),
    advanceSessionTurn: () => ({
      turnEnd: { type: "turn_end", playerId: "player-1" },
      turnStart: { type: "turn_start", playerId: "player-2", round: 3, turnNumber: 9 },
    }),
  });
  const session = createSession();
  const client = createClient();

  fixture.handlers.handleTurnEndMessage(client, session);
  await Promise.resolve();

  assert.equal(fixture.calls.broadcastToSession.length, 2);
  assert.equal(
    fixture.calls.broadcastToSession[0].rawMessage,
    JSON.stringify({ type: "turn_end", playerId: "player-1" })
  );
  assert.equal(
    fixture.calls.broadcastToSession[1].rawMessage,
    JSON.stringify({ type: "turn_start", playerId: "player-2", round: 3, turnNumber: 9 })
  );
  assert.equal(fixture.calls.broadcastSessionState.length, 1);
  assert.equal(fixture.calls.broadcastSessionState[0].source, "turn_end");
  assert.equal(fixture.calls.persistStore, 1);
  assert.equal(fixture.calls.reconcileSessionLoops.length, 1);
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

  console.log(`All socketTurnHandlers tests passed (${tests.length}).`);
}

await run();

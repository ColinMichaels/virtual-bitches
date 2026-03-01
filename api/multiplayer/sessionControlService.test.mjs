import assert from "node:assert/strict";
import { createSessionControlService } from "./sessionControlService.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createFixture(options = {}) {
  let nowValue = options.now ?? 10_000;
  const store =
    options.store ??
    {
      multiplayerSessions: {},
    };
  const calls = {
    rehydrateStore: [],
    rehydrateSession: [],
    rehydrateParticipant: [],
    ensureOwner: [],
    addBots: [],
    markSessionActivity: [],
    ensureTurnState: [],
    reconcileLoops: [],
    broadcastSessionState: [],
    reconcileInventory: [],
    issueAuth: [],
    persistStore: 0,
    authorizeSessionActionRequest: [],
    schedulePostGame: [],
  };

  const service = createSessionControlService({
    getStore: () => store,
    gameDifficulties: new Set(["easy", "normal", "hard"]),
    roomKinds: {
      private: "private",
      publicDefault: "public_default",
      publicOverflow: "public_overflow",
    },
    maxMultiplayerHumanPlayers: options.maxMultiplayerHumanPlayers ?? 4,
    rehydrateStoreFromAdapter: async (reason, metadata) => {
      calls.rehydrateStore.push({ reason, metadata });
    },
    rehydrateSessionWithRetry: async (sessionId, reasonPrefix, retryOptions) => {
      calls.rehydrateSession.push({ sessionId, reasonPrefix, retryOptions });
      if (typeof options.rehydrateSessionWithRetry === "function") {
        return options.rehydrateSessionWithRetry({ sessionId, reasonPrefix, retryOptions, store });
      }
      return store.multiplayerSessions[sessionId] ?? null;
    },
    rehydrateSessionParticipantWithRetry: async (sessionId, playerId, reasonPrefix, retryOptions) => {
      calls.rehydrateParticipant.push({ sessionId, playerId, reasonPrefix, retryOptions });
      if (typeof options.rehydrateSessionParticipantWithRetry === "function") {
        return options.rehydrateSessionParticipantWithRetry({
          sessionId,
          playerId,
          reasonPrefix,
          retryOptions,
          store,
        });
      }
      const session = store.multiplayerSessions[sessionId] ?? null;
      return {
        session,
        participant: session?.participants?.[playerId] ?? null,
      };
    },
    findJoinableSessionByRoomCode: (roomCode, at) => {
      if (typeof options.findJoinableSessionByRoomCode === "function") {
        return options.findJoinableSessionByRoomCode(roomCode, at, store);
      }
      return (
        Object.values(store.multiplayerSessions).find((session) => {
          return session?.roomCode === roomCode && Number(session?.expiresAt ?? 0) > at;
        }) ?? null
      );
    },
    normalizeOptionalRoomCode: (value) => {
      const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
      return normalized.length > 0 ? normalized : "";
    },
    isPlayerBannedFromSession: (session, playerId) => {
      if (typeof options.isPlayerBannedFromSession === "function") {
        return options.isPlayerBannedFromSession(session, playerId);
      }
      return false;
    },
    resolveJoinRequestGameSettings: (body) => ({
      requestedBotCount: Number.isFinite(body?.botCount) ? Math.max(0, Math.floor(body.botCount)) : 0,
      requestedDifficulty: "normal",
    }),
    getHumanParticipantCount: (session) => {
      return Object.values(session?.participants ?? {}).filter((participant) => participant?.isBot !== true)
        .length;
    },
    resolveParticipantBlockedPlayerIds: (_playerId, state) => {
      const source = Array.isArray(state?.candidateBlockedPlayerIds)
        ? state.candidateBlockedPlayerIds
        : Array.isArray(state?.fallbackBlockedPlayerIds)
          ? state.fallbackBlockedPlayerIds
          : [];
      return source
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0);
    },
    normalizeParticipantDisplayName: (value) => {
      const normalized = typeof value === "string" ? value.trim() : "";
      return normalized.length > 0 ? normalized : null;
    },
    normalizeAvatarUrl: (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
    normalizeProviderId: (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
    isBotParticipant: (participant) => participant?.isBot === true,
    normalizeQueuedForNextGame: (value) => value === true,
    isParticipantSeated: (participant) => participant?.isSeated === true,
    normalizeParticipantScore: (value) => (Number.isFinite(value) ? Math.floor(value) : 0),
    normalizeParticipantRemainingDice: (value) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 6),
    normalizeParticipantTimeoutRound: (value) =>
      Number.isFinite(value) && value > 0 ? Math.floor(value) : null,
    normalizeParticipantTimeoutCount: (value) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0),
    normalizeParticipantCompletedAt: (value) =>
      Number.isFinite(value) && value > 0 ? Math.floor(value) : null,
    getSessionRoomKind: (session) => session?.roomKind ?? "private",
    ensureSessionOwner: (session, preferredPlayerId) => {
      calls.ensureOwner.push({ sessionId: session?.sessionId, preferredPlayerId });
      if (!session.ownerPlayerId && preferredPlayerId) {
        session.ownerPlayerId = preferredPlayerId;
      }
      return session.ownerPlayerId ?? null;
    },
    addBotsToSession: (session, requestedBotCount, at) => {
      calls.addBots.push({ sessionId: session?.sessionId, requestedBotCount, at });
      if (typeof options.addBotsToSession === "function") {
        return options.addBotsToSession(session, requestedBotCount, at);
      }
      return 0;
    },
    resolveSessionGameConfig: (session) => ({
      difficulty: session?.gameDifficulty ?? "normal",
    }),
    markSessionActivity: (session, playerId, at) => {
      calls.markSessionActivity.push({ sessionId: session?.sessionId, playerId, at });
      session.lastActivityAt = at;
    },
    ensureSessionTurnState: (session) => {
      calls.ensureTurnState.push(session?.sessionId);
      if (!session.turnState) {
        session.turnState = { phase: "active" };
      }
      return session.turnState;
    },
    reconcileSessionLoops: (sessionId) => {
      calls.reconcileLoops.push(sessionId);
    },
    broadcastSessionState: (session, source) => {
      calls.broadcastSessionState.push({ sessionId: session?.sessionId, source });
    },
    reconcilePublicRoomInventory: (at) => {
      calls.reconcileInventory.push(at);
      return false;
    },
    issueAuthTokenBundle: (playerId, sessionId) => {
      calls.issueAuth.push({ playerId, sessionId });
      return {
        accessToken: `access-${playerId}-${sessionId}`,
        refreshToken: `refresh-${playerId}-${sessionId}`,
      };
    },
    buildSessionResponse: (session, playerId, auth) => ({
      sessionId: session?.sessionId ?? null,
      playerId,
      auth,
    }),
    persistStore: async () => {
      calls.persistStore += 1;
    },
    authorizeSessionActionRequest: (req, playerId, sessionId) => {
      calls.authorizeSessionActionRequest.push({ req, playerId, sessionId });
      if (typeof options.authorizeSessionActionRequest === "function") {
        return options.authorizeSessionActionRequest(req, playerId, sessionId);
      }
      return {
        ok: true,
        playerId,
        sessionId,
      };
    },
    shouldRetrySessionAuthFromStore: (reason) => {
      if (typeof options.shouldRetrySessionAuthFromStore === "function") {
        return options.shouldRetrySessionAuthFromStore(reason);
      }
      return reason === "session_token_mismatch" || reason === "token_not_found";
    },
    areCurrentGameParticipantsComplete: (session) => {
      if (typeof options.areCurrentGameParticipantsComplete === "function") {
        return options.areCurrentGameParticipantsComplete(session);
      }
      return true;
    },
    scheduleSessionPostGameLifecycle: (session, at) => {
      calls.schedulePostGame.push({ sessionId: session?.sessionId, at });
    },
    buildSessionSnapshot: (session) => ({
      sessionId: session?.sessionId ?? null,
      participantIds: Object.keys(session?.participants ?? {}),
    }),
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

function createSessionFixture(overrides = {}) {
  return {
    sessionId: overrides.sessionId ?? "session-1",
    roomCode: overrides.roomCode ?? "ABCD",
    roomKind: overrides.roomKind ?? "private",
    ownerPlayerId: overrides.ownerPlayerId ?? "host",
    gameDifficulty: overrides.gameDifficulty ?? "normal",
    expiresAt: overrides.expiresAt ?? 60_000,
    participants:
      overrides.participants ??
      {
        host: {
          playerId: "host",
          isSeated: true,
          isReady: false,
          isBot: false,
          score: 0,
          remainingDice: 6,
        },
      },
    turnState: overrides.turnState ?? null,
  };
}

test("joinSessionByTarget rejects missing target", async () => {
  const fixture = createFixture();
  const result = await fixture.service.joinSessionByTarget({
    target: {},
    body: { playerId: "p1" },
  });

  assert.equal(result.status, 400);
  assert.equal(result.payload.error, "sessionId or roomCode is required");
});

test("joinSessionByTarget rejects room_full when max humans reached", async () => {
  const session = createSessionFixture({
    participants: {
      host: { playerId: "host", isBot: false, isSeated: true },
    },
  });
  const fixture = createFixture({
    maxMultiplayerHumanPlayers: 1,
    store: {
      multiplayerSessions: {
        "session-1": session,
      },
    },
  });

  const result = await fixture.service.joinSessionByTarget({
    target: { sessionId: "session-1" },
    body: { playerId: "guest-1" },
  });

  assert.equal(result.status, 409);
  assert.equal(result.payload.reason, "room_full");
});

test("joinSessionByTarget joins participant and persists response", async () => {
  const session = createSessionFixture();
  const fixture = createFixture({
    store: {
      multiplayerSessions: {
        "session-1": session,
      },
    },
  });

  const result = await fixture.service.joinSessionByTarget({
    target: { sessionId: "session-1" },
    body: { playerId: "guest-1", displayName: "Guest One" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.sessionId, "session-1");
  assert.equal(result.payload.playerId, "guest-1");
  assert.ok(fixture.store.multiplayerSessions["session-1"].participants["guest-1"]);
  assert.equal(fixture.calls.persistStore, 1);
  assert.equal(fixture.calls.broadcastSessionState.length, 1);
  assert.equal(fixture.calls.broadcastSessionState[0].source, "join");
});

test("heartbeat returns session_expired when session cannot be resolved", async () => {
  const fixture = createFixture({
    rehydrateSessionWithRetry: () => null,
  });

  const result = await fixture.service.heartbeat({
    req: {},
    sessionId: "missing",
    body: { playerId: "p1" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.reason, "session_expired");
});

test("heartbeat returns unauthorized when auth check fails", async () => {
  const session = createSessionFixture();
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
    authorizeSessionActionRequest: () => ({ ok: false, reason: "token_not_found" }),
    shouldRetrySessionAuthFromStore: () => false,
  });

  const result = await fixture.service.heartbeat({
    req: {},
    sessionId: "session-1",
    body: { playerId: "host" },
  });

  assert.equal(result.status, 401);
  assert.equal(result.payload.reason, "token_not_found");
});

test("heartbeat updates participant heartbeat and persists on success", async () => {
  const session = createSessionFixture();
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
  });

  const result = await fixture.service.heartbeat({
    req: {},
    sessionId: "session-1",
    body: { playerId: "host" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(fixture.calls.persistStore, 1);
  assert.equal(fixture.store.multiplayerSessions["session-1"].participants.host.lastHeartbeatAt, 10_000);
});

test("queueParticipantForNextGame enforces round completion", async () => {
  const session = createSessionFixture();
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
    areCurrentGameParticipantsComplete: () => false,
  });

  const result = await fixture.service.queueParticipantForNextGame({
    req: {},
    sessionId: "session-1",
    body: { playerId: "host" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.reason, "round_in_progress");
});

test("queueParticipantForNextGame sets ready+queued and persists", async () => {
  const session = createSessionFixture({
    participants: {
      host: {
        playerId: "host",
        isSeated: true,
        isReady: false,
        queuedForNextGame: false,
        isBot: false,
      },
    },
  });
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
  });

  const result = await fixture.service.queueParticipantForNextGame({
    req: {},
    sessionId: "session-1",
    body: { playerId: "host" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.queuedForNextGame, true);
  assert.equal(session.participants.host.isReady, true);
  assert.equal(session.participants.host.queuedForNextGame, true);
  assert.equal(fixture.calls.schedulePostGame.length, 1);
  assert.equal(fixture.calls.persistStore, 1);
});

test("refreshSessionAuth requires playerId", async () => {
  const fixture = createFixture();
  const result = await fixture.service.refreshSessionAuth({
    req: {},
    sessionId: "session-1",
    body: {},
  });

  assert.equal(result.status, 400);
  assert.equal(result.payload.error, "playerId is required");
});

test("refreshSessionAuth returns session_expired when expired auth recovery fails", async () => {
  const session = createSessionFixture({
    expiresAt: 0,
  });
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
    authorizeSessionActionRequest: () => ({ ok: false, reason: "token_not_found" }),
    shouldRetrySessionAuthFromStore: () => false,
  });

  const result = await fixture.service.refreshSessionAuth({
    req: {},
    sessionId: "session-1",
    body: { playerId: "host" },
  });

  assert.equal(result.status, 410);
  assert.equal(result.payload.reason, "session_expired");
});

test("refreshSessionAuth issues new auth bundle and persists", async () => {
  const session = createSessionFixture();
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
  });

  const result = await fixture.service.refreshSessionAuth({
    req: {},
    sessionId: "session-1",
    body: { playerId: "host" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.sessionId, "session-1");
  assert.equal(result.payload.playerId, "host");
  assert.equal(fixture.calls.issueAuth.length, 1);
  assert.equal(fixture.calls.persistStore, 1);
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

  console.log(`All sessionControlService tests passed (${tests.length}).`);
}

await run();

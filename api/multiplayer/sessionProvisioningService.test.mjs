import assert from "node:assert/strict";
import { createSessionProvisioningService } from "./sessionProvisioningService.mjs";

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
    reconcileInventory: [],
    persistStore: 0,
    addBots: [],
    ensureTurnState: [],
    reconcileLoops: [],
    issueAuth: [],
    markSessionActivity: [],
  };

  const service = createSessionProvisioningService({
    getStore: () => store,
    roomKinds: {
      private: "private",
      publicDefault: "public_default",
      publicOverflow: "public_overflow",
    },
    defaultParticipantDiceCount: options.defaultParticipantDiceCount ?? 6,
    multiplayerSessionIdleTtlMs: options.multiplayerSessionIdleTtlMs ?? 30_000,
    wsBaseUrl: options.wsBaseUrl ?? "wss://example.test",
    multiplayerRoomListLimitMax: options.multiplayerRoomListLimitMax ?? 50,
    multiplayerRoomListLimitDefault: options.multiplayerRoomListLimitDefault ?? 24,
    reconcilePublicRoomInventory: (at) => {
      calls.reconcileInventory.push(at);
      if (typeof options.reconcilePublicRoomInventory === "function") {
        return options.reconcilePublicRoomInventory(at);
      }
      return false;
    },
    persistStore: async () => {
      calls.persistStore += 1;
    },
    buildRoomListing: (session, now) => {
      if (typeof options.buildRoomListing === "function") {
        return options.buildRoomListing(session, now);
      }
      return session?.listing ?? null;
    },
    resolveRoomListPriority: (room) => {
      if (typeof options.resolveRoomListPriority === "function") {
        return options.resolveRoomListPriority(room);
      }
      return Number.isFinite(room?.priority) ? room.priority : 99;
    },
    createSessionId: () => (typeof options.createSessionId === "function" ? options.createSessionId() : "session-1"),
    resolveCreateSessionGameSettings: (body) => {
      if (typeof options.resolveCreateSessionGameSettings === "function") {
        return options.resolveCreateSessionGameSettings(body);
      }
      return {
        botCount: Number.isFinite(body?.botCount) ? Math.max(0, Math.floor(body.botCount)) : 0,
        gameDifficulty: "normal",
        demoSpeedMode: false,
        demoMode: body?.demoMode === true,
        demoAutoRun: body?.demoAutoRun === true,
        gameConfig: { difficulty: "normal" },
      };
    },
    normalizeOptionalRoomCode: (value) => {
      const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
      return normalized.length > 0 ? normalized : "";
    },
    isRoomCodeInUse: (roomCode, at) => {
      if (typeof options.isRoomCodeInUse === "function") {
        return options.isRoomCodeInUse(roomCode, at);
      }
      return false;
    },
    generateUniquePrivateRoomCode: (at) => {
      if (typeof options.generateUniquePrivateRoomCode === "function") {
        return options.generateUniquePrivateRoomCode(at);
      }
      return "PRIV";
    },
    resolveParticipantBlockedPlayerIds: (playerId, state) => {
      if (typeof options.resolveParticipantBlockedPlayerIds === "function") {
        return options.resolveParticipantBlockedPlayerIds(playerId, state);
      }
      const source = Array.isArray(state?.candidateBlockedPlayerIds) ? state.candidateBlockedPlayerIds : [];
      return source
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0);
    },
    normalizeParticipantDisplayName: (value) => {
      const normalized = typeof value === "string" ? value.trim() : "";
      return normalized.length > 0 ? normalized : null;
    },
    normalizeAvatarUrl: (value) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null),
    normalizeProviderId: (value) =>
      typeof value === "string" && value.trim().length > 0 ? value.trim() : null,
    createEmptyChatConductState: () => ({ players: {} }),
    addBotsToSession: (session, botCount, at) => {
      calls.addBots.push({ sessionId: session?.sessionId, botCount, at });
      if (typeof options.addBotsToSession === "function") {
        return options.addBotsToSession(session, botCount, at);
      }
      return 0;
    },
    resolveSessionGameConfig: (session) => ({
      difficulty: session?.gameDifficulty ?? "normal",
    }),
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
    issueAuthTokenBundle: (playerId, sessionId) => {
      calls.issueAuth.push({ playerId, sessionId });
      return {
        accessToken: `access-${playerId}-${sessionId}`,
        refreshToken: `refresh-${playerId}-${sessionId}`,
      };
    },
    markSessionActivity: (session, playerId, at) => {
      calls.markSessionActivity.push({ sessionId: session?.sessionId, playerId, at });
      session.lastActivityAt = at;
    },
    buildSessionResponse: (session, playerId, auth) => ({
      sessionId: session?.sessionId,
      roomCode: session?.roomCode,
      playerId,
      auth,
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

test("listRooms filters, sorts, and applies default limit", async () => {
  const fixture = createFixture({
    store: {
      multiplayerSessions: {
        a: {
          listing: {
            sessionId: "a",
            isPublic: true,
            sessionComplete: false,
            activeHumanCount: 1,
            humanCount: 1,
            lastActivityAt: 100,
            priority: 1,
          },
        },
        b: {
          listing: {
            sessionId: "b",
            isPublic: true,
            sessionComplete: false,
            activeHumanCount: 2,
            humanCount: 2,
            lastActivityAt: 80,
            priority: 1,
          },
        },
        c: {
          listing: {
            sessionId: "c",
            isPublic: false,
            sessionComplete: false,
            activeHumanCount: 99,
            humanCount: 99,
            lastActivityAt: 999,
            priority: 0,
          },
        },
        d: {
          listing: {
            sessionId: "d",
            isPublic: true,
            sessionComplete: true,
            activeHumanCount: 99,
            humanCount: 99,
            lastActivityAt: 999,
            priority: 0,
          },
        },
      },
    },
    multiplayerRoomListLimitDefault: 5,
  });

  const result = await fixture.service.listRooms({ rawLimit: undefined });

  assert.equal(result.status, 200);
  assert.equal(result.payload.timestamp, 10_000);
  assert.deepEqual(
    result.payload.rooms.map((room) => room.sessionId),
    ["b", "a"]
  );
  assert.equal(fixture.calls.persistStore, 0);
  assert.deepEqual(fixture.calls.reconcileInventory, [10_000]);
});

test("listRooms clamps limit and persists when inventory changes", async () => {
  const fixture = createFixture({
    multiplayerRoomListLimitMax: 2,
    reconcilePublicRoomInventory: () => true,
    store: {
      multiplayerSessions: {
        a: { listing: { sessionId: "a", isPublic: true, sessionComplete: false, activeHumanCount: 1, humanCount: 1, lastActivityAt: 10, priority: 1 } },
        b: { listing: { sessionId: "b", isPublic: true, sessionComplete: false, activeHumanCount: 1, humanCount: 1, lastActivityAt: 9, priority: 1 } },
        c: { listing: { sessionId: "c", isPublic: true, sessionComplete: false, activeHumanCount: 1, humanCount: 1, lastActivityAt: 8, priority: 1 } },
      },
    },
  });

  const result = await fixture.service.listRooms({ rawLimit: 100 });

  assert.equal(result.status, 200);
  assert.equal(result.payload.rooms.length, 2);
  assert.equal(fixture.calls.persistStore, 1);
});

test("createSession requires playerId", async () => {
  const fixture = createFixture();
  const result = await fixture.service.createSession({ body: {} });

  assert.equal(result.status, 400);
  assert.equal(result.payload.error, "playerId is required");
  assert.equal(fixture.calls.persistStore, 0);
});

test("createSession rejects duplicate requested room code", async () => {
  const fixture = createFixture({
    isRoomCodeInUse: () => true,
  });

  const result = await fixture.service.createSession({
    body: {
      playerId: "host",
      roomCode: "lby1",
    },
  });

  assert.equal(result.status, 409);
  assert.equal(result.payload.reason, "room_code_taken");
  assert.equal(fixture.calls.persistStore, 0);
});

test("createSession returns 500 when room code allocation fails", async () => {
  const fixture = createFixture({
    generateUniquePrivateRoomCode: () => "",
  });

  const result = await fixture.service.createSession({
    body: {
      playerId: "host",
    },
  });

  assert.equal(result.status, 500);
  assert.equal(result.payload.error, "Failed to allocate room code");
  assert.equal(fixture.calls.persistStore, 0);
});

test("createSession persists created session with participant defaults", async () => {
  const fixture = createFixture({
    now: 20_000,
    defaultParticipantDiceCount: 8,
    resolveCreateSessionGameSettings: () => ({
      botCount: 2,
      gameDifficulty: "hard",
      demoSpeedMode: true,
      demoMode: true,
      demoAutoRun: true,
      gameConfig: { difficulty: "hard" },
    }),
  });

  const result = await fixture.service.createSession({
    body: {
      playerId: "host",
      displayName: " Host ",
      avatarUrl: " https://avatar.test/host.png ",
      providerId: " provider:host ",
      blockedPlayerIds: [" rival-1 ", "", null],
      roomCode: " private ",
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.sessionId, "session-1");
  assert.equal(result.payload.roomCode, "PRIVATE");

  const session = fixture.store.multiplayerSessions["session-1"];
  assert.ok(session);
  assert.equal(session.ownerPlayerId, "host");
  assert.equal(session.roomKind, "private");
  assert.equal(session.wsUrl, "wss://example.test");
  assert.deepEqual(session.chatConductState, { players: {} });
  assert.deepEqual(session.gameConfig, { difficulty: "hard" });
  assert.equal(session.demoMode, true);
  assert.equal(session.demoAutoRun, true);
  assert.equal(session.demoSpeedMode, true);

  const participant = session.participants.host;
  assert.equal(participant.displayName, "Host");
  assert.equal(participant.avatarUrl, "https://avatar.test/host.png");
  assert.equal(participant.providerId, "provider:host");
  assert.deepEqual(participant.blockedPlayerIds, ["rival-1"]);
  assert.equal(participant.remainingDice, 8);

  assert.deepEqual(fixture.calls.addBots, [{ sessionId: "session-1", botCount: 2, at: 20_000 }]);
  assert.deepEqual(fixture.calls.ensureTurnState, ["session-1"]);
  assert.deepEqual(fixture.calls.reconcileLoops, ["session-1"]);
  assert.deepEqual(fixture.calls.issueAuth, [{ playerId: "host", sessionId: "session-1" }]);
  assert.equal(fixture.calls.markSessionActivity.length, 1);
  assert.equal(fixture.calls.persistStore, 1);
});

test("createSession uses generated room code when request omits roomCode", async () => {
  const fixture = createFixture({
    generateUniquePrivateRoomCode: () => "ABCD",
  });

  const result = await fixture.service.createSession({
    body: {
      playerId: "host",
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.roomCode, "ABCD");
});

async function run() {
  let passed = 0;
  for (const entry of tests) {
    await entry.fn();
    passed += 1;
    console.log(`\u2713 ${entry.name}`);
  }
  console.log(`All sessionProvisioningService tests passed (${passed}).`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

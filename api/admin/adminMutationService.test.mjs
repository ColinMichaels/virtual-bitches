import assert from "node:assert/strict";
import { createAdminMutationService } from "./adminMutationService.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createFixture(options = {}) {
  let nowValue = options.now ?? 10_000;
  const calls = {
    audit: [],
    persist: 0,
    expireSession: [],
    reconcilePublicRoomInventory: [],
    removeParticipantFromSession: [],
    logInfo: [],
  };
  const store =
    options.store ??
    {
      firebasePlayers: {},
      multiplayerSessions: {},
      gameLogs: {},
    };

  const normalizeAdminRole = (value) => {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "viewer" || normalized === "operator" || normalized === "owner") {
      return normalized;
    }
    return null;
  };

  const service = createAdminMutationService({
    getStore: () => store,
    adminRoles: {
      viewer: "viewer",
      operator: "operator",
      owner: "owner",
    },
    normalizeAdminRole,
    isBootstrapOwnerUid: (uid) => {
      if (Array.isArray(options.bootstrapOwnerUids)) {
        return options.bootstrapOwnerUids.includes(uid);
      }
      return false;
    },
    buildAdminRoleRecord: (uid, record) => ({
      uid,
      role: normalizeAdminRole(record?.adminRole),
      roleUpdatedBy: record?.adminRoleUpdatedBy,
    }),
    recordAdminAuditEvent: (...args) => {
      calls.audit.push(args);
    },
    persistStore: async () => {
      calls.persist += 1;
    },
    expireSession: (sessionId, reason) => {
      calls.expireSession.push({ sessionId, reason });
      delete store.multiplayerSessions[sessionId];
    },
    reconcilePublicRoomInventory: (timestamp) => {
      calls.reconcilePublicRoomInventory.push(timestamp);
      return options.roomInventoryChanged ?? true;
    },
    removeParticipantFromSession: (sessionId, playerId, metadata) => {
      calls.removeParticipantFromSession.push({ sessionId, playerId, metadata });
      if (typeof options.removeParticipantResult === "function") {
        return options.removeParticipantResult({ sessionId, playerId, metadata });
      }
      return options.removeParticipantResult ?? {
        ok: true,
        sessionExpired: false,
        roomInventoryChanged: false,
      };
    },
    ensureSessionChatConductState: (session) => {
      if (!session.chatConductState || typeof session.chatConductState !== "object") {
        session.chatConductState = { players: {} };
      }
      if (!session.chatConductState.players || typeof session.chatConductState.players !== "object") {
        session.chatConductState.players = {};
      }
      return session.chatConductState;
    },
    normalizeChatConductState: (state) => ({
      players: state?.players && typeof state.players === "object" ? { ...state.players } : {},
    }),
    chatConductBasePolicy: {},
    buildAdminChatConductPlayerRecord: (session, playerId, record) => ({
      sessionId: session?.id ?? null,
      playerId,
      strikeCount: Array.isArray(record?.strikeEvents) ? record.strikeEvents.length : 0,
      totalStrikes: Number(record?.totalStrikes ?? 0),
      mutedUntil: Number(record?.mutedUntil ?? 0),
    }),
    log: {
      info: (message) => {
        calls.logInfo.push(message);
      },
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

test("upsertRole writes role record and persists/audits", async () => {
  const fixture = createFixture();
  const auth = { uid: "admin-1", authType: "role" };

  const result = await fixture.service.upsertRole({
    auth,
    targetUid: "player-1",
    body: { role: "operator" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.roleRecord.uid, "player-1");
  assert.equal(result.roleRecord.role, "operator");
  assert.equal(fixture.store.firebasePlayers["player-1"].adminRole, "operator");
  assert.equal(fixture.calls.persist, 1);
  assert.equal(fixture.calls.audit.length, 1);
  assert.equal(fixture.calls.audit[0][1], "role_upsert");
});

test("upsertRole enforces bootstrap owner lock", async () => {
  const fixture = createFixture({
    bootstrapOwnerUids: ["owner-uid"],
  });

  const result = await fixture.service.upsertRole({
    auth: { uid: "admin-1", authType: "role" },
    targetUid: "owner-uid",
    body: { role: "viewer" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.reason, "bootstrap_owner_locked");
  assert.equal(fixture.calls.persist, 0);
});

test("expireSession returns unknown_session when target is missing", async () => {
  const fixture = createFixture();

  const result = await fixture.service.expireSession({
    auth: { uid: "admin-1", authType: "role", role: "operator" },
    sessionId: "missing-session",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.reason, "unknown_session");
});

test("expireSession expires room, reconciles inventory, and persists", async () => {
  const fixture = createFixture({
    store: {
      firebasePlayers: {},
      multiplayerSessions: {
        "session-1": { id: "session-1" },
      },
      gameLogs: {},
    },
  });

  const result = await fixture.service.expireSession({
    auth: { uid: "admin-1", authType: "role", role: "operator" },
    sessionId: "session-1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.sessionId, "session-1");
  assert.equal(result.roomInventoryChanged, true);
  assert.equal(fixture.calls.expireSession.length, 1);
  assert.equal(fixture.calls.reconcilePublicRoomInventory.length, 1);
  assert.equal(fixture.calls.persist, 1);
  assert.equal(fixture.calls.audit[0][1], "session_expire");
});

test("removeParticipant maps unknown_player/session to 404", async () => {
  const fixture = createFixture({
    removeParticipantResult: {
      ok: false,
      reason: "unknown_player",
    },
  });

  const result = await fixture.service.removeParticipant({
    auth: { uid: "admin-1", authType: "role", role: "operator" },
    sessionId: "session-1",
    playerId: "player-1",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.reason, "unknown_player");
});

test("removeParticipant success returns mutation payload and persists", async () => {
  const fixture = createFixture({
    removeParticipantResult: {
      ok: true,
      sessionExpired: true,
      roomInventoryChanged: true,
    },
  });

  const result = await fixture.service.removeParticipant({
    auth: { uid: "admin-1", authType: "role", role: "operator" },
    sessionId: "session-2",
    playerId: "player-2",
  });

  assert.equal(result.ok, true);
  assert.equal(result.sessionId, "session-2");
  assert.equal(result.playerId, "player-2");
  assert.equal(result.sessionExpired, true);
  assert.equal(result.roomInventoryChanged, true);
  assert.equal(fixture.calls.persist, 1);
  assert.equal(fixture.calls.audit[0][1], "participant_remove");
  assert.equal(fixture.calls.logInfo.length, 1);
});

test("clearSessionConductPlayer clears strikes/mute and supports total reset", async () => {
  const fixture = createFixture({
    store: {
      firebasePlayers: {},
      multiplayerSessions: {
        "session-1": {
          id: "session-1",
          expiresAt: 50_000,
          chatConductState: {
            players: {
              "player-1": {
                strikeEvents: [100, 200],
                lastViolationAt: 200,
                mutedUntil: 999_999,
                totalStrikes: 6,
              },
            },
          },
        },
      },
      gameLogs: {},
    },
  });

  const result = await fixture.service.clearSessionConductPlayer({
    auth: { uid: "admin-1", authType: "role", role: "operator" },
    sessionId: "session-1",
    playerId: "player-1",
    resetTotalStrikes: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.hadRecord, true);
  assert.equal(result.resetTotalStrikes, true);
  assert.equal(result.player.strikeCount, 0);
  assert.equal(result.player.totalStrikes, 0);
  assert.equal(result.player.mutedUntil, 0);
  assert.equal(fixture.calls.persist, 1);
  assert.equal(fixture.calls.audit[0][1], "session_conduct_clear_player");
});

test("clearSessionConductState clears all conduct player records", async () => {
  const fixture = createFixture({
    store: {
      firebasePlayers: {},
      multiplayerSessions: {
        "session-9": {
          id: "session-9",
          expiresAt: 50_000,
          chatConductState: {
            players: {
              a: { strikeEvents: [1] },
              b: { strikeEvents: [2, 3] },
            },
          },
        },
      },
      gameLogs: {},
    },
  });

  const result = await fixture.service.clearSessionConductState({
    auth: { uid: "admin-1", authType: "role", role: "operator" },
    sessionId: "session-9",
  });

  assert.equal(result.ok, true);
  assert.equal(result.sessionId, "session-9");
  assert.equal(result.clearedPlayerCount, 2);
  assert.deepEqual(fixture.store.multiplayerSessions["session-9"].chatConductState.players, {});
  assert.equal(fixture.calls.persist, 1);
  assert.equal(fixture.calls.audit[0][1], "session_conduct_clear_all");
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

  console.log(`All adminMutationService tests passed (${tests.length}).`);
}

await run();

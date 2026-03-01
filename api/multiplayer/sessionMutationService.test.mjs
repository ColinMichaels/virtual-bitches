import assert from "node:assert/strict";
import { createSessionMutationService } from "./sessionMutationService.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createSession(overrides = {}) {
  return {
    sessionId: overrides.sessionId ?? "session-1",
    roomKind: overrides.roomKind ?? "private",
    ownerPlayerId: overrides.ownerPlayerId ?? "host",
    expiresAt: overrides.expiresAt ?? 90_000,
    demoMode: overrides.demoMode ?? false,
    demoAutoRun: overrides.demoAutoRun ?? true,
    demoSpeedMode: overrides.demoSpeedMode ?? false,
    participants:
      overrides.participants ??
      {
        host: {
          playerId: "host",
          displayName: "Host",
          isBot: false,
          isSeated: true,
          isReady: false,
          queuedForNextGame: false,
          lastHeartbeatAt: 0,
        },
      },
    turnState: overrides.turnState ?? null,
  };
}

function createFixture(options = {}) {
  let nowValue = options.now ?? 10_000;
  const store =
    options.store ??
    {
      multiplayerSessions: {},
    };
  const calls = {
    rehydrateSession: [],
    rehydrateSessionParticipant: [],
    rehydrateStore: [],
    authorizeSessionActionRequest: [],
    markSessionActivity: [],
    ensureSessionTurnState: [],
    reconcileSessionLoops: [],
    broadcastSessionState: [],
    broadcastSystemRoomChannelMessage: [],
    ensureSessionOwner: [],
    pruneSessionBots: [],
    addBotsToSession: [],
    resetSessionBotLoopSchedule: [],
    broadcastToSession: [],
    removeParticipantFromSession: [],
    authorizeAdminRequest: [],
    roomBanUpserts: [],
    adminAudit: [],
    persistStore: 0,
  };

  const service = createSessionMutationService({
    getStore: () => store,
    roomKinds: {
      private: "private",
      publicDefault: "public_default",
      publicOverflow: "public_overflow",
    },
    adminRoles: {
      viewer: "viewer",
      operator: "operator",
      owner: "owner",
    },
    sessionModerationActions: new Set(["kick", "ban"]),
    maxMultiplayerHumanPlayers: options.maxMultiplayerHumanPlayers ?? 4,
    maxMultiplayerBots: options.maxMultiplayerBots ?? 8,
    rehydrateSessionWithRetry: async (sessionId, reasonPrefix, retryOptions) => {
      calls.rehydrateSession.push({ sessionId, reasonPrefix, retryOptions });
      if (typeof options.rehydrateSessionWithRetry === "function") {
        return options.rehydrateSessionWithRetry({ sessionId, reasonPrefix, retryOptions, store });
      }
      return store.multiplayerSessions[sessionId] ?? null;
    },
    rehydrateSessionParticipantWithRetry: async (sessionId, playerId, reasonPrefix, retryOptions) => {
      calls.rehydrateSessionParticipant.push({ sessionId, playerId, reasonPrefix, retryOptions });
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
    rehydrateStoreFromAdapter: async (reason, metadata) => {
      calls.rehydrateStore.push({ reason, metadata });
      if (typeof options.rehydrateStoreFromAdapter === "function") {
        await options.rehydrateStoreFromAdapter(reason, metadata, store);
      }
    },
    normalizeParticipantStateAction: (value) => {
      const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
      return normalized === "sit" ||
        normalized === "stand" ||
        normalized === "ready" ||
        normalized === "unready"
        ? normalized
        : "";
    },
    normalizeDemoControlAction: (value) => {
      const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
      return normalized === "pause" ||
        normalized === "resume" ||
        normalized === "speed_fast" ||
        normalized === "speed_normal"
        ? normalized
        : "";
    },
    authorizeSessionActionRequest: (req, playerId, sessionId) => {
      calls.authorizeSessionActionRequest.push({ req, playerId, sessionId });
      if (typeof options.authorizeSessionActionRequest === "function") {
        return options.authorizeSessionActionRequest(req, playerId, sessionId);
      }
      return { ok: true, playerId };
    },
    shouldRetrySessionAuthFromStore: (reason) => {
      if (typeof options.shouldRetrySessionAuthFromStore === "function") {
        return options.shouldRetrySessionAuthFromStore(reason);
      }
      return reason === "token_not_found" || reason === "session_token_mismatch";
    },
    isBotParticipant: (participant) => participant?.isBot === true,
    isParticipantSeated: (participant) => participant?.isSeated === true,
    isParticipantQueuedForNextGame: (participant) => participant?.queuedForNextGame === true,
    shouldQueueParticipantForNextGame: (session) => {
      if (typeof options.shouldQueueParticipantForNextGame === "function") {
        return options.shouldQueueParticipantForNextGame(session);
      }
      return false;
    },
    markSessionActivity: (session, playerId, at) => {
      calls.markSessionActivity.push({ sessionId: session?.sessionId, playerId, at });
      session.lastActivityAt = at;
    },
    ensureSessionTurnState: (session) => {
      calls.ensureSessionTurnState.push(session?.sessionId);
      if (!session.turnState) {
        session.turnState = { phase: "active" };
      }
      return session.turnState;
    },
    reconcileSessionLoops: (sessionId) => {
      calls.reconcileSessionLoops.push(sessionId);
    },
    broadcastSessionState: (session, source) => {
      calls.broadcastSessionState.push({ sessionId: session?.sessionId, source });
    },
    broadcastSystemRoomChannelMessage: (sessionId, payload) => {
      calls.broadcastSystemRoomChannelMessage.push({ sessionId, payload });
    },
    buildSessionSnapshot: (session) => ({
      sessionId: session?.sessionId,
      participantIds: Object.keys(session?.participants ?? {}),
    }),
    getSessionRoomKind: (session) => session?.roomKind ?? "private",
    ensureSessionOwner: (session) => {
      calls.ensureSessionOwner.push(session?.sessionId);
      if (!session.ownerPlayerId) {
        const firstHuman = Object.values(session.participants).find((participant) => participant?.isBot !== true);
        session.ownerPlayerId = firstHuman?.playerId ?? null;
      }
      return session.ownerPlayerId ?? null;
    },
    getSessionOwnerPlayerId: (session) =>
      typeof session?.ownerPlayerId === "string" ? session.ownerPlayerId : null,
    getBotParticipants: (session) =>
      Object.values(session?.participants ?? {}).filter((participant) => participant?.isBot === true),
    getSeatedHumanParticipantCount: (session) =>
      Object.values(session?.participants ?? {}).filter(
        (participant) => participant?.isBot !== true && participant?.isSeated === true
      ).length,
    pruneSessionBots: (sessionId, session, pruneOptions) => {
      calls.pruneSessionBots.push({ sessionId, pruneOptions });
      if (pruneOptions?.removeAll === true) {
        let removed = false;
        Object.entries(session.participants).forEach(([playerId, participant]) => {
          if (participant?.isBot === true) {
            delete session.participants[playerId];
            removed = true;
          }
        });
        return { changed: removed };
      }
      return { changed: false };
    },
    addBotsToSession: (session, targetBotCount, at) => {
      calls.addBotsToSession.push({ sessionId: session?.sessionId, targetBotCount, at });
      if (typeof options.addBotsToSession === "function") {
        return options.addBotsToSession(session, targetBotCount, at);
      }
      return 0;
    },
    resetSessionForNextGame: (session) => {
      if (typeof options.resetSessionForNextGame === "function") {
        return options.resetSessionForNextGame(session);
      }
      return false;
    },
    normalizeSessionBotsForAutoRun: (session) => {
      if (typeof options.normalizeSessionBotsForAutoRun === "function") {
        return options.normalizeSessionBotsForAutoRun(session);
      }
      return {
        changed: false,
        count: Object.values(session?.participants ?? {}).filter((participant) => participant?.isBot === true)
          .length,
      };
    },
    resetSessionBotLoopSchedule: (sessionId) => {
      calls.resetSessionBotLoopSchedule.push(sessionId);
    },
    isSessionDemoAutoRunEnabled: (session) => session?.demoMode === true && session?.demoAutoRun !== false,
    isSessionDemoFastMode: (session) => session?.demoMode === true && session?.demoSpeedMode === true,
    isDemoModeSession: (session) => session?.demoMode === true,
    buildTurnStartMessage: (session, messageOptions) => ({
      type: "turn_start",
      sessionId: session?.sessionId,
      source: messageOptions?.source ?? "unknown",
    }),
    broadcastToSession: (sessionId, rawPayload, sender) => {
      calls.broadcastToSession.push({ sessionId, rawPayload, sender });
    },
    removeParticipantFromSession: (sessionId, playerId, metadata) => {
      calls.removeParticipantFromSession.push({ sessionId, playerId, metadata });
      if (typeof options.removeParticipantFromSession === "function") {
        return options.removeParticipantFromSession(sessionId, playerId, metadata, store);
      }
      const session = store.multiplayerSessions[sessionId];
      if (!session) {
        return { ok: false, reason: "unknown_session" };
      }
      if (!session.participants[playerId]) {
        return { ok: false, reason: "unknown_player" };
      }
      delete session.participants[playerId];
      return { ok: true, roomInventoryChanged: false, sessionExpired: false };
    },
    authorizeAdminRequest: async (req, requestOptions) => {
      calls.authorizeAdminRequest.push({ req, requestOptions });
      if (typeof options.authorizeAdminRequest === "function") {
        return options.authorizeAdminRequest(req, requestOptions);
      }
      return { ok: false, status: 401, reason: "unauthorized" };
    },
    resolveModerationActorDisplayName: ({ requesterPlayerId, moderatorRole }) =>
      `${moderatorRole}:${requesterPlayerId}`,
    upsertSessionRoomBan: (session, targetPlayerId, metadata) => {
      calls.roomBanUpserts.push({ sessionId: session?.sessionId, targetPlayerId, metadata });
      session.roomBans = session.roomBans ?? {};
      session.roomBans[targetPlayerId] = { ...metadata };
    },
    recordAdminAuditEvent: (...args) => {
      calls.adminAudit.push(args);
    },
    persistStore: async () => {
      calls.persistStore += 1;
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

test("updateParticipantState returns session_expired when session missing", async () => {
  const fixture = createFixture();
  const result = await fixture.service.updateParticipantState({
    req: {},
    sessionId: "missing",
    body: { playerId: "p1", action: "sit" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.reason, "session_expired");
});

test("updateParticipantState rejects invalid action", async () => {
  const session = createSession();
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
  });
  const result = await fixture.service.updateParticipantState({
    req: {},
    sessionId: "session-1",
    body: { playerId: "host", action: "invalid" },
  });

  assert.equal(result.status, 400);
  assert.equal(result.payload.reason, "invalid_action");
});

test("updateParticipantState marks not_seated on ready action", async () => {
  const session = createSession({
    participants: {
      host: {
        playerId: "host",
        isBot: false,
        isSeated: false,
        isReady: false,
        queuedForNextGame: false,
      },
    },
  });
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
  });
  const result = await fixture.service.updateParticipantState({
    req: {},
    sessionId: "session-1",
    body: { playerId: "host", action: "ready" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "not_seated");
  assert.equal(result.payload.state.isReady, false);
});

test("updateParticipantState sit updates seat state and broadcasts", async () => {
  const session = createSession({
    participants: {
      host: {
        playerId: "host",
        displayName: "Host",
        isBot: false,
        isSeated: false,
        isReady: false,
        queuedForNextGame: false,
      },
    },
  });
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
  });
  const result = await fixture.service.updateParticipantState({
    req: {},
    sessionId: "session-1",
    body: { playerId: "host", action: "sit" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.state.isSeated, true);
  assert.equal(fixture.calls.broadcastSessionState.length, 1);
  assert.equal(fixture.calls.broadcastSystemRoomChannelMessage.length, 1);
  assert.equal(fixture.calls.persistStore, 1);
});

test("updateSessionDemoControls validates session id", async () => {
  const fixture = createFixture();
  const result = await fixture.service.updateSessionDemoControls({
    req: {},
    sessionId: " ",
    body: { playerId: "host", action: "pause" },
  });

  assert.equal(result.status, 400);
  assert.equal(result.payload.reason, "invalid_session_id");
});

test("updateSessionDemoControls enforces owner-only access", async () => {
  const session = createSession({
    participants: {
      host: {
        playerId: "host",
        isBot: false,
        isSeated: true,
        isReady: false,
        queuedForNextGame: false,
      },
      guest: {
        playerId: "guest",
        isBot: false,
        isSeated: true,
        isReady: false,
        queuedForNextGame: false,
      },
    },
  });
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
    authorizeSessionActionRequest: () => ({ ok: true, playerId: "guest" }),
  });
  const result = await fixture.service.updateSessionDemoControls({
    req: {},
    sessionId: "session-1",
    body: { playerId: "guest", action: "pause" },
  });

  assert.equal(result.status, 403);
  assert.equal(result.payload.reason, "not_room_owner");
});

test("updateSessionDemoControls resume path restarts and persists", async () => {
  const session = createSession({
    demoMode: true,
    participants: {
      host: {
        playerId: "host",
        displayName: "Host",
        isBot: false,
        isSeated: true,
        isReady: true,
        queuedForNextGame: true,
      },
      bot1: {
        playerId: "bot1",
        isBot: true,
        isSeated: true,
      },
    },
  });
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
    authorizeSessionActionRequest: () => ({ ok: true, playerId: "host" }),
    addBotsToSession: (targetSession, targetBotCount) => {
      if (targetBotCount > 0) {
        targetSession.participants.bot2 = {
          playerId: "bot2",
          isBot: true,
        };
        return 1;
      }
      return 0;
    },
  });
  const result = await fixture.service.updateSessionDemoControls({
    req: {},
    sessionId: "session-1",
    body: { playerId: "host", action: "resume" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.controls.demoMode, true);
  assert.equal(result.payload.controls.demoAutoRun, true);
  assert.equal(fixture.calls.resetSessionBotLoopSchedule.length, 1);
  assert.equal(fixture.calls.broadcastSessionState.length, 1);
  assert.equal(fixture.calls.persistStore, 1);
});

test("leaveSession returns ok when participant is already absent", async () => {
  const fixture = createFixture({
    removeParticipantFromSession: () => ({ ok: false, reason: "unknown_player" }),
  });
  const result = await fixture.service.leaveSession({
    sessionId: "session-1",
    body: { playerId: "ghost" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
});

test("moderateSessionParticipant rejects self-moderation", async () => {
  const session = createSession();
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
  });
  const result = await fixture.service.moderateSessionParticipant({
    req: {},
    sessionId: "session-1",
    body: {
      requesterPlayerId: "host",
      targetPlayerId: "host",
      action: "kick",
    },
  });

  assert.equal(result.status, 409);
  assert.equal(result.payload.reason, "cannot_moderate_self");
});

test("moderateSessionParticipant requires owner/admin authorization", async () => {
  const session = createSession({
    ownerPlayerId: "owner",
    participants: {
      owner: { playerId: "owner", isBot: false },
      guest1: { playerId: "guest1", isBot: false },
      guest2: { playerId: "guest2", isBot: false },
    },
  });
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
    authorizeSessionActionRequest: () => ({ ok: true }),
    authorizeAdminRequest: async () => ({ ok: false, status: 401, reason: "unauthorized" }),
  });
  const result = await fixture.service.moderateSessionParticipant({
    req: {},
    sessionId: "session-1",
    body: {
      requesterPlayerId: "guest1",
      targetPlayerId: "guest2",
      action: "kick",
    },
  });

  assert.equal(result.status, 403);
  assert.equal(result.payload.reason, "not_room_owner");
});

test("moderateSessionParticipant admin ban path records audit and persists", async () => {
  const session = createSession({
    ownerPlayerId: "owner",
    participants: {
      owner: { playerId: "owner", isBot: false },
      guest: { playerId: "guest", isBot: false, displayName: "Guest" },
    },
  });
  const fixture = createFixture({
    store: { multiplayerSessions: { "session-1": session } },
    authorizeSessionActionRequest: () => ({ ok: false, reason: "unauthorized" }),
    authorizeAdminRequest: async () => ({
      ok: true,
      uid: "admin-uid",
      role: "operator",
      authType: "role",
    }),
  });
  const result = await fixture.service.moderateSessionParticipant({
    req: {},
    sessionId: "session-1",
    body: {
      requesterPlayerId: "moderator",
      targetPlayerId: "guest",
      action: "ban",
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.action, "ban");
  assert.equal(result.payload.moderatedBy.role, "admin");
  assert.equal(fixture.calls.roomBanUpserts.length, 1);
  assert.equal(fixture.calls.adminAudit.length, 1);
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

  console.log(`All sessionMutationService tests passed (${tests.length}).`);
}

await run();

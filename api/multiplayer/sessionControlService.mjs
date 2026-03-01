import { resolveSessionRecoveryRetryOptions } from "./sessionRecoveryRetryProfiles.mjs";

function requireFunction(name, value) {
  if (typeof value !== "function") {
    throw new Error(`Missing multiplayer session control dependency: ${name}`);
  }
  return value;
}

function requireObject(name, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Missing multiplayer session control dependency: ${name}`);
  }
  return value;
}

export function createSessionControlService({
  getStore,
  gameDifficulties,
  roomKinds,
  maxMultiplayerHumanPlayers,
  rehydrateStoreFromAdapter,
  rehydrateSessionWithRetry,
  rehydrateSessionParticipantWithRetry,
  findJoinableSessionByRoomCode,
  normalizeOptionalRoomCode,
  isPlayerBannedFromSession,
  resolveJoinRequestGameSettings,
  getHumanParticipantCount,
  resolveParticipantBlockedPlayerIds,
  normalizeParticipantDisplayName,
  normalizeAvatarUrl,
  normalizeProviderId,
  isBotParticipant,
  normalizeQueuedForNextGame,
  isParticipantSeated,
  normalizeParticipantScore,
  normalizeParticipantRemainingDice,
  normalizeParticipantTimeoutRound,
  normalizeParticipantTimeoutCount,
  normalizeParticipantCompletedAt,
  getSessionRoomKind,
  ensureSessionOwner,
  addBotsToSession,
  resolveSessionGameConfig,
  markSessionActivity,
  ensureSessionTurnState,
  reconcileSessionLoops,
  broadcastSessionState,
  reconcilePublicRoomInventory,
  issueAuthTokenBundle,
  buildSessionResponse,
  persistStore,
  authorizeSessionActionRequest,
  shouldRetrySessionAuthFromStore,
  areCurrentGameParticipantsComplete,
  scheduleSessionPostGameLifecycle,
  buildSessionSnapshot,
  now = () => Date.now(),
}) {
  const getStoreImpl = requireFunction("getStore", getStore);
  const gameDifficultiesImpl = requireObject("gameDifficulties", gameDifficulties);
  const roomKindsImpl = requireObject("roomKinds", roomKinds);
  const rehydrateStoreFromAdapterImpl = requireFunction(
    "rehydrateStoreFromAdapter",
    rehydrateStoreFromAdapter
  );
  const rehydrateSessionWithRetryImpl = requireFunction(
    "rehydrateSessionWithRetry",
    rehydrateSessionWithRetry
  );
  const rehydrateSessionParticipantWithRetryImpl = requireFunction(
    "rehydrateSessionParticipantWithRetry",
    rehydrateSessionParticipantWithRetry
  );
  const findJoinableSessionByRoomCodeImpl = requireFunction(
    "findJoinableSessionByRoomCode",
    findJoinableSessionByRoomCode
  );
  const normalizeOptionalRoomCodeImpl = requireFunction(
    "normalizeOptionalRoomCode",
    normalizeOptionalRoomCode
  );
  const isPlayerBannedFromSessionImpl = requireFunction(
    "isPlayerBannedFromSession",
    isPlayerBannedFromSession
  );
  const resolveJoinRequestGameSettingsImpl = requireFunction(
    "resolveJoinRequestGameSettings",
    resolveJoinRequestGameSettings
  );
  const getHumanParticipantCountImpl = requireFunction(
    "getHumanParticipantCount",
    getHumanParticipantCount
  );
  const resolveParticipantBlockedPlayerIdsImpl = requireFunction(
    "resolveParticipantBlockedPlayerIds",
    resolveParticipantBlockedPlayerIds
  );
  const normalizeParticipantDisplayNameImpl = requireFunction(
    "normalizeParticipantDisplayName",
    normalizeParticipantDisplayName
  );
  const normalizeAvatarUrlImpl = requireFunction("normalizeAvatarUrl", normalizeAvatarUrl);
  const normalizeProviderIdImpl = requireFunction("normalizeProviderId", normalizeProviderId);
  const isBotParticipantImpl = requireFunction("isBotParticipant", isBotParticipant);
  const normalizeQueuedForNextGameImpl = requireFunction(
    "normalizeQueuedForNextGame",
    normalizeQueuedForNextGame
  );
  const isParticipantSeatedImpl = requireFunction("isParticipantSeated", isParticipantSeated);
  const normalizeParticipantScoreImpl = requireFunction(
    "normalizeParticipantScore",
    normalizeParticipantScore
  );
  const normalizeParticipantRemainingDiceImpl = requireFunction(
    "normalizeParticipantRemainingDice",
    normalizeParticipantRemainingDice
  );
  const normalizeParticipantTimeoutRoundImpl = requireFunction(
    "normalizeParticipantTimeoutRound",
    normalizeParticipantTimeoutRound
  );
  const normalizeParticipantTimeoutCountImpl = requireFunction(
    "normalizeParticipantTimeoutCount",
    normalizeParticipantTimeoutCount
  );
  const normalizeParticipantCompletedAtImpl = requireFunction(
    "normalizeParticipantCompletedAt",
    normalizeParticipantCompletedAt
  );
  const getSessionRoomKindImpl = requireFunction("getSessionRoomKind", getSessionRoomKind);
  const ensureSessionOwnerImpl = requireFunction("ensureSessionOwner", ensureSessionOwner);
  const addBotsToSessionImpl = requireFunction("addBotsToSession", addBotsToSession);
  const resolveSessionGameConfigImpl = requireFunction(
    "resolveSessionGameConfig",
    resolveSessionGameConfig
  );
  const markSessionActivityImpl = requireFunction("markSessionActivity", markSessionActivity);
  const ensureSessionTurnStateImpl = requireFunction("ensureSessionTurnState", ensureSessionTurnState);
  const reconcileSessionLoopsImpl = requireFunction("reconcileSessionLoops", reconcileSessionLoops);
  const broadcastSessionStateImpl = requireFunction("broadcastSessionState", broadcastSessionState);
  const reconcilePublicRoomInventoryImpl = requireFunction(
    "reconcilePublicRoomInventory",
    reconcilePublicRoomInventory
  );
  const issueAuthTokenBundleImpl = requireFunction("issueAuthTokenBundle", issueAuthTokenBundle);
  const buildSessionResponseImpl = requireFunction("buildSessionResponse", buildSessionResponse);
  const persistStoreImpl = requireFunction("persistStore", persistStore);
  const authorizeSessionActionRequestImpl = requireFunction(
    "authorizeSessionActionRequest",
    authorizeSessionActionRequest
  );
  const shouldRetrySessionAuthFromStoreImpl = requireFunction(
    "shouldRetrySessionAuthFromStore",
    shouldRetrySessionAuthFromStore
  );
  const areCurrentGameParticipantsCompleteImpl = requireFunction(
    "areCurrentGameParticipantsComplete",
    areCurrentGameParticipantsComplete
  );
  const scheduleSessionPostGameLifecycleImpl = requireFunction(
    "scheduleSessionPostGameLifecycle",
    scheduleSessionPostGameLifecycle
  );
  const buildSessionSnapshotImpl = requireFunction("buildSessionSnapshot", buildSessionSnapshot);
  const nowImpl = requireFunction("now", now);

  function getSessionById(sessionId) {
    const store = getStoreImpl();
    return store?.multiplayerSessions?.[sessionId] ?? null;
  }

  async function joinSessionByTarget({ target, body }) {
    const requestNow = nowImpl();
    let session = null;

    if (typeof target?.sessionId === "string" && target.sessionId.trim().length > 0) {
      const sessionId = target.sessionId.trim();
      let sessionById = getSessionById(sessionId);
      if (!sessionById || sessionById.expiresAt <= requestNow) {
        sessionById = await rehydrateSessionWithRetryImpl(
          sessionId,
          "join_session",
          resolveSessionRecoveryRetryOptions("sessionStandard")
        );
      }
      if (!sessionById || sessionById.expiresAt <= requestNow) {
        return {
          status: 410,
          payload: { error: "Session expired", reason: "session_expired" },
        };
      }
      session = sessionById;
    } else if (typeof target?.roomCode === "string" && target.roomCode.trim().length > 0) {
      const normalizedRoomCode = normalizeOptionalRoomCodeImpl(target.roomCode);
      if (!normalizedRoomCode) {
        return {
          status: 404,
          payload: { error: "Room code not found", reason: "room_not_found" },
        };
      }
      let sessionByRoomCode = findJoinableSessionByRoomCodeImpl(normalizedRoomCode, requestNow);
      if (!sessionByRoomCode) {
        await rehydrateStoreFromAdapterImpl(`join_room_code:${normalizedRoomCode}`, { force: true });
        sessionByRoomCode = findJoinableSessionByRoomCodeImpl(normalizedRoomCode, requestNow);
      }
      if (!sessionByRoomCode) {
        return {
          status: 404,
          payload: { error: "Room code not found", reason: "room_not_found" },
        };
      }
      session = sessionByRoomCode;
    } else {
      return {
        status: 400,
        payload: { error: "sessionId or roomCode is required" },
      };
    }

    const playerId = typeof body?.playerId === "string" ? body.playerId : "";
    if (!playerId) {
      return {
        status: 400,
        payload: { error: "playerId is required" },
      };
    }
    if (isPlayerBannedFromSessionImpl(session, playerId)) {
      return {
        status: 403,
        payload: { error: "Player banned from room", reason: "room_banned" },
      };
    }

    const joinGameSettings = resolveJoinRequestGameSettingsImpl(body);
    const requestedBotCount = joinGameSettings.requestedBotCount;
    const hasSessionDifficulty =
      typeof session.gameDifficulty === "string" &&
      gameDifficultiesImpl.has(session.gameDifficulty.trim().toLowerCase());
    if (!hasSessionDifficulty) {
      session.gameDifficulty = joinGameSettings.requestedDifficulty;
    }

    const existingParticipant = session.participants[playerId];
    const isReturningParticipant = Boolean(
      existingParticipant && !isBotParticipantImpl(existingParticipant)
    );
    const queuedForNextGame = isReturningParticipant
      ? normalizeQueuedForNextGameImpl(existingParticipant?.queuedForNextGame)
      : false;

    if (!isReturningParticipant && getHumanParticipantCountImpl(session) >= maxMultiplayerHumanPlayers) {
      return {
        status: 409,
        payload: { error: "Room is full", reason: "room_full" },
      };
    }

    const participantBlockedPlayerIds = resolveParticipantBlockedPlayerIdsImpl(playerId, {
      candidateBlockedPlayerIds: body?.blockedPlayerIds,
      fallbackBlockedPlayerIds: existingParticipant?.blockedPlayerIds,
    });
    const normalizedDisplayName =
      normalizeParticipantDisplayNameImpl(body?.displayName) ??
      normalizeParticipantDisplayNameImpl(existingParticipant?.displayName);
    const joinTimestamp = nowImpl();
    session.participants[playerId] = {
      playerId,
      ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
      avatarUrl:
        normalizeAvatarUrlImpl(body?.avatarUrl) ?? normalizeAvatarUrlImpl(existingParticipant?.avatarUrl),
      providerId:
        normalizeProviderIdImpl(body?.providerId) ?? normalizeProviderIdImpl(existingParticipant?.providerId),
      ...(participantBlockedPlayerIds.length > 0
        ? { blockedPlayerIds: participantBlockedPlayerIds }
        : {}),
      joinedAt: existingParticipant?.joinedAt ?? joinTimestamp,
      lastHeartbeatAt: joinTimestamp,
      isSeated: isReturningParticipant ? isParticipantSeatedImpl(existingParticipant) : false,
      isReady: isReturningParticipant
        ? existingParticipant?.isReady === true && isParticipantSeatedImpl(existingParticipant)
        : false,
      score: normalizeParticipantScoreImpl(existingParticipant?.score),
      remainingDice: normalizeParticipantRemainingDiceImpl(existingParticipant?.remainingDice),
      turnTimeoutRound: normalizeParticipantTimeoutRoundImpl(existingParticipant?.turnTimeoutRound),
      turnTimeoutCount: normalizeParticipantTimeoutCountImpl(existingParticipant?.turnTimeoutCount),
      queuedForNextGame,
      isComplete: existingParticipant?.isComplete === true,
      completedAt: normalizeParticipantCompletedAtImpl(existingParticipant?.completedAt),
    };

    if (getSessionRoomKindImpl(session) === roomKindsImpl.private) {
      ensureSessionOwnerImpl(session, playerId);
    }

    addBotsToSessionImpl(session, requestedBotCount, joinTimestamp);
    session.gameConfig = resolveSessionGameConfigImpl(session);
    const sessionId = session.sessionId;
    markSessionActivityImpl(session, playerId, joinTimestamp);
    ensureSessionTurnStateImpl(session);
    reconcileSessionLoopsImpl(sessionId);
    broadcastSessionStateImpl(session, "join");
    reconcilePublicRoomInventoryImpl(joinTimestamp);

    const auth = issueAuthTokenBundleImpl(playerId, sessionId);
    const response = buildSessionResponseImpl(session, playerId, auth);
    await persistStoreImpl();

    return {
      status: 200,
      payload: response,
    };
  }

  async function heartbeat({ req, sessionId, body }) {
    let session = getSessionById(sessionId);
    if (!session || session.expiresAt <= nowImpl()) {
      session = await rehydrateSessionWithRetryImpl(
        sessionId,
        "heartbeat_session",
        resolveSessionRecoveryRetryOptions("sessionStandard")
      );
    }
    if (!session || session.expiresAt <= nowImpl()) {
      return {
        status: 200,
        payload: { ok: false, reason: "session_expired" },
      };
    }

    const playerId = typeof body?.playerId === "string" ? body.playerId : "";
    if (!playerId || !session.participants[playerId]) {
      const recovered = await rehydrateSessionParticipantWithRetryImpl(
        sessionId,
        playerId,
        "heartbeat_participant",
        resolveSessionRecoveryRetryOptions("sessionFast")
      );
      session = recovered.session;
    }
    if (!session || !playerId || !session.participants[playerId]) {
      return {
        status: 200,
        payload: { ok: false, reason: "unknown_player" },
      };
    }

    let authCheck = authorizeSessionActionRequestImpl(req, playerId, sessionId);
    if (!authCheck.ok && shouldRetrySessionAuthFromStoreImpl(authCheck.reason)) {
      const recovered = await rehydrateSessionParticipantWithRetryImpl(
        sessionId,
        playerId,
        "heartbeat_auth",
        resolveSessionRecoveryRetryOptions("sessionFast")
      );
      session = recovered.session;
      authCheck = authorizeSessionActionRequestImpl(req, playerId, sessionId);
    }
    if (!authCheck.ok) {
      return {
        status: 401,
        payload: { error: "Unauthorized", reason: authCheck.reason ?? "unauthorized" },
      };
    }

    const heartbeatAt = nowImpl();
    session.participants[playerId].lastHeartbeatAt = heartbeatAt;
    markSessionActivityImpl(session, playerId, heartbeatAt);
    await persistStoreImpl();
    return {
      status: 200,
      payload: { ok: true },
    };
  }

  async function queueParticipantForNextGame({ req, sessionId, body }) {
    let session = getSessionById(sessionId);
    if (!session || session.expiresAt <= nowImpl()) {
      session = await rehydrateSessionWithRetryImpl(
        sessionId,
        "queue_next_session",
        resolveSessionRecoveryRetryOptions("sessionStandard")
      );
    }
    if (!session || session.expiresAt <= nowImpl()) {
      return {
        status: 200,
        payload: {
          ok: false,
          queuedForNextGame: false,
          reason: "session_expired",
        },
      };
    }

    const playerId = typeof body?.playerId === "string" ? body.playerId : "";
    let participant = playerId ? session.participants[playerId] : null;
    if (!playerId || !participant || isBotParticipantImpl(participant)) {
      const recovered = await rehydrateSessionParticipantWithRetryImpl(
        sessionId,
        playerId,
        "queue_next_participant",
        resolveSessionRecoveryRetryOptions("sessionFast")
      );
      session = recovered.session;
      participant = recovered.participant;
    }
    if (!session || !playerId || !participant || isBotParticipantImpl(participant)) {
      return {
        status: 200,
        payload: {
          ok: false,
          queuedForNextGame: false,
          reason: "unknown_player",
        },
      };
    }

    let authCheck = authorizeSessionActionRequestImpl(req, playerId, sessionId);
    if (!authCheck.ok && shouldRetrySessionAuthFromStoreImpl(authCheck.reason)) {
      const recovered = await rehydrateSessionParticipantWithRetryImpl(
        sessionId,
        playerId,
        "queue_next_auth",
        resolveSessionRecoveryRetryOptions("sessionFast")
      );
      session = recovered.session;
      participant = recovered.participant;
      authCheck = authorizeSessionActionRequestImpl(req, playerId, sessionId);
    }
    if (!authCheck.ok) {
      return {
        status: 401,
        payload: { error: "Unauthorized", reason: authCheck.reason ?? "unauthorized" },
      };
    }

    if (!areCurrentGameParticipantsCompleteImpl(session)) {
      return {
        status: 200,
        payload: {
          ok: false,
          queuedForNextGame: false,
          reason: "round_in_progress",
        },
      };
    }
    if (!isParticipantSeatedImpl(participant)) {
      return {
        status: 200,
        payload: {
          ok: false,
          queuedForNextGame: false,
          reason: "not_seated",
        },
      };
    }

    const queuedAt = nowImpl();
    participant.lastHeartbeatAt = queuedAt;
    participant.queuedForNextGame = true;
    participant.isReady = true;
    markSessionActivityImpl(session, playerId, queuedAt);
    scheduleSessionPostGameLifecycleImpl(session, queuedAt);
    ensureSessionTurnStateImpl(session);
    broadcastSessionStateImpl(session, "queue_next_game");
    reconcileSessionLoopsImpl(sessionId);
    await persistStoreImpl();

    return {
      status: 200,
      payload: {
        ok: true,
        queuedForNextGame: true,
        session: {
          ...buildSessionSnapshotImpl(session),
          serverNow: queuedAt,
        },
      },
    };
  }

  async function refreshSessionAuth({ req, sessionId, body }) {
    const playerId = typeof body?.playerId === "string" ? body.playerId : "";
    if (!playerId) {
      return {
        status: 400,
        payload: { error: "playerId is required" },
      };
    }

    let session = getSessionById(sessionId);
    if (!session || session.expiresAt <= nowImpl()) {
      session = await rehydrateSessionWithRetryImpl(
        sessionId,
        "refresh_auth_session",
        resolveSessionRecoveryRetryOptions("sessionRefreshAuth")
      );
    }
    if (!session) {
      return {
        status: 410,
        payload: { error: "Session expired", reason: "session_expired" },
      };
    }

    let participant = session.participants[playerId];
    if (!participant) {
      const recovered = await rehydrateSessionParticipantWithRetryImpl(
        sessionId,
        playerId,
        "refresh_auth_participant",
        resolveSessionRecoveryRetryOptions("sessionRefreshAuth")
      );
      session = recovered.session;
      participant = recovered.participant;
    }
    if (!session || !participant) {
      return {
        status: 404,
        payload: { error: "Player not in session" },
      };
    }

    const sessionExpired = !Number.isFinite(session.expiresAt) || session.expiresAt <= nowImpl();
    if (sessionExpired) {
      let expiredAuthCheck = authorizeSessionActionRequestImpl(req, playerId, sessionId);
      if (!expiredAuthCheck.ok && shouldRetrySessionAuthFromStoreImpl(expiredAuthCheck.reason)) {
        const recovered = await rehydrateSessionParticipantWithRetryImpl(
          sessionId,
          playerId,
          "refresh_auth_expired_retry",
          resolveSessionRecoveryRetryOptions("authRecovery")
        );
        session = recovered.session;
        participant = recovered.participant;
        expiredAuthCheck = authorizeSessionActionRequestImpl(req, playerId, sessionId);
      }
      if (!session || !participant || !expiredAuthCheck.ok) {
        return {
          status: 410,
          payload: { error: "Session expired", reason: "session_expired" },
        };
      }
    }

    let authCheck = authorizeSessionActionRequestImpl(req, playerId, sessionId);
    if (!authCheck.ok && shouldRetrySessionAuthFromStoreImpl(authCheck.reason)) {
      const recovered = await rehydrateSessionParticipantWithRetryImpl(
        sessionId,
        playerId,
        "refresh_auth_authorize",
        resolveSessionRecoveryRetryOptions("authRecovery")
      );
      session = recovered.session;
      participant = recovered.participant;
      authCheck = authorizeSessionActionRequestImpl(req, playerId, sessionId);
    }
    if (!session || !participant) {
      return {
        status: 404,
        payload: { error: "Player not in session" },
      };
    }
    if (!authCheck.ok) {
      return {
        status: 401,
        payload: { error: "Unauthorized", reason: authCheck.reason ?? "unauthorized" },
      };
    }

    const refreshedAt = nowImpl();
    if (participant && typeof participant === "object") {
      participant.lastHeartbeatAt = refreshedAt;
    }
    markSessionActivityImpl(session, playerId, refreshedAt);
    reconcileSessionLoopsImpl(sessionId);

    const auth = issueAuthTokenBundleImpl(playerId, sessionId);
    const response = buildSessionResponseImpl(session, playerId, auth);
    await persistStoreImpl();

    return {
      status: 200,
      payload: response,
    };
  }

  return {
    joinSessionByTarget,
    heartbeat,
    queueParticipantForNextGame,
    refreshSessionAuth,
  };
}

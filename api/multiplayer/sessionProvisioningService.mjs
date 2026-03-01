function requireFunction(name, value) {
  if (typeof value !== "function") {
    throw new Error(`Missing multiplayer session provisioning dependency: ${name}`);
  }
  return value;
}

function requireObject(name, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Missing multiplayer session provisioning dependency: ${name}`);
  }
  return value;
}

export function createSessionProvisioningService({
  getStore,
  roomKinds,
  defaultParticipantDiceCount,
  multiplayerSessionIdleTtlMs,
  wsBaseUrl,
  multiplayerRoomListLimitMax,
  multiplayerRoomListLimitDefault,
  reconcilePublicRoomInventory,
  persistStore,
  buildRoomListing,
  resolveRoomListPriority,
  createSessionId,
  resolveCreateSessionGameSettings,
  normalizeOptionalRoomCode,
  isRoomCodeInUse,
  generateUniquePrivateRoomCode,
  resolveParticipantBlockedPlayerIds,
  normalizeParticipantDisplayName,
  normalizeAvatarUrl,
  normalizeProviderId,
  createEmptyChatConductState,
  addBotsToSession,
  resolveSessionGameConfig,
  ensureSessionTurnState,
  reconcileSessionLoops,
  issueAuthTokenBundle,
  markSessionActivity,
  buildSessionResponse,
  now = () => Date.now(),
}) {
  const getStoreImpl = requireFunction("getStore", getStore);
  const roomKindsImpl = requireObject("roomKinds", roomKinds);
  const reconcilePublicRoomInventoryImpl = requireFunction(
    "reconcilePublicRoomInventory",
    reconcilePublicRoomInventory
  );
  const persistStoreImpl = requireFunction("persistStore", persistStore);
  const buildRoomListingImpl = requireFunction("buildRoomListing", buildRoomListing);
  const resolveRoomListPriorityImpl = requireFunction("resolveRoomListPriority", resolveRoomListPriority);
  const createSessionIdImpl = requireFunction("createSessionId", createSessionId);
  const resolveCreateSessionGameSettingsImpl = requireFunction(
    "resolveCreateSessionGameSettings",
    resolveCreateSessionGameSettings
  );
  const normalizeOptionalRoomCodeImpl = requireFunction(
    "normalizeOptionalRoomCode",
    normalizeOptionalRoomCode
  );
  const isRoomCodeInUseImpl = requireFunction("isRoomCodeInUse", isRoomCodeInUse);
  const generateUniquePrivateRoomCodeImpl = requireFunction(
    "generateUniquePrivateRoomCode",
    generateUniquePrivateRoomCode
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
  const createEmptyChatConductStateImpl = requireFunction(
    "createEmptyChatConductState",
    createEmptyChatConductState
  );
  const addBotsToSessionImpl = requireFunction("addBotsToSession", addBotsToSession);
  const resolveSessionGameConfigImpl = requireFunction("resolveSessionGameConfig", resolveSessionGameConfig);
  const ensureSessionTurnStateImpl = requireFunction("ensureSessionTurnState", ensureSessionTurnState);
  const reconcileSessionLoopsImpl = requireFunction("reconcileSessionLoops", reconcileSessionLoops);
  const issueAuthTokenBundleImpl = requireFunction("issueAuthTokenBundle", issueAuthTokenBundle);
  const markSessionActivityImpl = requireFunction("markSessionActivity", markSessionActivity);
  const buildSessionResponseImpl = requireFunction("buildSessionResponse", buildSessionResponse);
  const nowImpl = requireFunction("now", now);

  const maxRoomListLimit = Number.isFinite(multiplayerRoomListLimitMax)
    ? Math.max(1, Math.floor(multiplayerRoomListLimitMax))
    : 100;
  const defaultRoomListLimit = Number.isFinite(multiplayerRoomListLimitDefault)
    ? Math.max(1, Math.floor(multiplayerRoomListLimitDefault))
    : 24;
  const participantDiceCount = Number.isFinite(defaultParticipantDiceCount)
    ? Math.max(1, Math.floor(defaultParticipantDiceCount))
    : 6;
  const sessionIdleTtlMs = Number.isFinite(multiplayerSessionIdleTtlMs)
    ? Math.max(1, Math.floor(multiplayerSessionIdleTtlMs))
    : 30 * 60 * 1000;
  const wsBaseUrlValue = typeof wsBaseUrl === "string" ? wsBaseUrl : "";

  function getStoreState() {
    return getStoreImpl();
  }

  function resolveRoomListLimit(rawLimit) {
    const parsedLimit = Number(rawLimit);
    if (!Number.isFinite(parsedLimit)) {
      return defaultRoomListLimit;
    }
    return Math.max(1, Math.min(maxRoomListLimit, Math.floor(parsedLimit)));
  }

  async function listRooms({ rawLimit }) {
    const limit = resolveRoomListLimit(rawLimit);
    const listedAt = nowImpl();
    const roomInventoryChanged = reconcilePublicRoomInventoryImpl(listedAt);
    if (roomInventoryChanged) {
      await persistStoreImpl();
    }

    const rooms = Object.values(getStoreState().multiplayerSessions)
      .map((session) => buildRoomListingImpl(session, listedAt))
      .filter((room) => room !== null && room.isPublic === true && room.sessionComplete !== true)
      .sort((left, right) => {
        const roomTypeDelta = resolveRoomListPriorityImpl(left) - resolveRoomListPriorityImpl(right);
        if (roomTypeDelta !== 0) {
          return roomTypeDelta;
        }
        const activeDelta = right.activeHumanCount - left.activeHumanCount;
        if (activeDelta !== 0) {
          return activeDelta;
        }
        const humanDelta = right.humanCount - left.humanCount;
        if (humanDelta !== 0) {
          return humanDelta;
        }
        return right.lastActivityAt - left.lastActivityAt;
      })
      .slice(0, limit);

    return {
      status: 200,
      payload: {
        rooms,
        timestamp: listedAt,
      },
    };
  }

  async function createSession({ body }) {
    const playerId = typeof body?.playerId === "string" ? body.playerId : "";
    if (!playerId) {
      return {
        status: 400,
        payload: { error: "playerId is required" },
      };
    }

    const sessionId = createSessionIdImpl();
    const resolvedGameSettings = resolveCreateSessionGameSettingsImpl(body);
    const botCount = resolvedGameSettings.botCount;
    const gameDifficulty = resolvedGameSettings.gameDifficulty;
    const demoSpeedMode = resolvedGameSettings.demoSpeedMode;
    const demoMode = resolvedGameSettings.demoMode;
    const demoAutoRun = resolvedGameSettings.demoAutoRun;
    const gameConfig = resolvedGameSettings.gameConfig;

    const createdAt = nowImpl();
    const requestedRoomCode = normalizeOptionalRoomCodeImpl(body?.roomCode);
    if (requestedRoomCode && isRoomCodeInUseImpl(requestedRoomCode, createdAt)) {
      return {
        status: 409,
        payload: {
          error: "Room code unavailable",
          reason: "room_code_taken",
        },
      };
    }

    const roomCode = requestedRoomCode || generateUniquePrivateRoomCodeImpl(createdAt);
    if (!roomCode) {
      return {
        status: 500,
        payload: { error: "Failed to allocate room code" },
      };
    }

    const expiresAt = createdAt + sessionIdleTtlMs;
    const participantBlockedPlayerIds = resolveParticipantBlockedPlayerIdsImpl(playerId, {
      candidateBlockedPlayerIds: body?.blockedPlayerIds,
    });
    const normalizedDisplayName = normalizeParticipantDisplayNameImpl(body?.displayName);

    const participants = {
      [playerId]: {
        playerId,
        ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
        avatarUrl: normalizeAvatarUrlImpl(body?.avatarUrl),
        providerId: normalizeProviderIdImpl(body?.providerId),
        ...(participantBlockedPlayerIds.length > 0
          ? { blockedPlayerIds: participantBlockedPlayerIds }
          : {}),
        joinedAt: createdAt,
        lastHeartbeatAt: createdAt,
        isSeated: false,
        isReady: false,
        score: 0,
        remainingDice: participantDiceCount,
        turnTimeoutRound: null,
        turnTimeoutCount: 0,
        queuedForNextGame: false,
        isComplete: false,
        completedAt: null,
      },
    };

    const session = {
      sessionId,
      roomCode,
      gameDifficulty,
      gameConfig,
      demoMode,
      demoAutoRun,
      demoSpeedMode,
      wsUrl: wsBaseUrlValue,
      roomKind: roomKindsImpl.private,
      ownerPlayerId: playerId,
      roomBans: {},
      chatConductState: createEmptyChatConductStateImpl(),
      createdAt,
      gameStartedAt: createdAt,
      lastActivityAt: createdAt,
      expiresAt,
      participants,
      turnState: null,
    };

    addBotsToSessionImpl(session, botCount, createdAt);
    session.gameConfig = resolveSessionGameConfigImpl(session);

    const store = getStoreState();
    store.multiplayerSessions[sessionId] = session;
    ensureSessionTurnStateImpl(session);
    reconcileSessionLoopsImpl(sessionId);
    const auth = issueAuthTokenBundleImpl(playerId, sessionId);
    markSessionActivityImpl(session, playerId, nowImpl());

    const response = buildSessionResponseImpl(session, playerId, auth);
    await persistStoreImpl();

    return {
      status: 200,
      payload: response,
    };
  }

  return {
    listRooms,
    createSession,
  };
}

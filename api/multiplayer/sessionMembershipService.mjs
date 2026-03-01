function requireFunction(name, value) {
  if (typeof value !== "function") {
    throw new Error(`Missing multiplayer session membership dependency: ${name}`);
  }
  return value;
}

function requireObject(name, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Missing multiplayer session membership dependency: ${name}`);
  }
  return value;
}

export function createSessionMembershipService({
  getStore,
  roomKinds,
  wsCloseCodes,
  disconnectPlayerSockets,
  getHumanParticipantCount,
  getSessionRoomKind,
  ensureSessionOwner,
  ensureSessionTurnState,
  expireSession,
  resetPublicRoomForIdle,
  reconcileSessionLoops,
  broadcastSessionState,
  maybeForfeitSessionForSingleHumanRemaining,
  markSessionActivity,
  buildTurnStartMessage,
  broadcastToSession,
  reconcilePublicRoomInventory,
  now = () => Date.now(),
}) {
  const getStoreImpl = requireFunction("getStore", getStore);
  const roomKindsImpl = requireObject("roomKinds", roomKinds);
  const wsCloseCodesImpl = requireObject("wsCloseCodes", wsCloseCodes);
  const disconnectPlayerSocketsImpl = requireFunction("disconnectPlayerSockets", disconnectPlayerSockets);
  const getHumanParticipantCountImpl = requireFunction("getHumanParticipantCount", getHumanParticipantCount);
  const getSessionRoomKindImpl = requireFunction("getSessionRoomKind", getSessionRoomKind);
  const ensureSessionOwnerImpl = requireFunction("ensureSessionOwner", ensureSessionOwner);
  const ensureSessionTurnStateImpl = requireFunction("ensureSessionTurnState", ensureSessionTurnState);
  const expireSessionImpl = requireFunction("expireSession", expireSession);
  const resetPublicRoomForIdleImpl = requireFunction("resetPublicRoomForIdle", resetPublicRoomForIdle);
  const reconcileSessionLoopsImpl = requireFunction("reconcileSessionLoops", reconcileSessionLoops);
  const broadcastSessionStateImpl = requireFunction("broadcastSessionState", broadcastSessionState);
  const maybeForfeitSessionForSingleHumanRemainingImpl = requireFunction(
    "maybeForfeitSessionForSingleHumanRemaining",
    maybeForfeitSessionForSingleHumanRemaining
  );
  const markSessionActivityImpl = requireFunction("markSessionActivity", markSessionActivity);
  const buildTurnStartMessageImpl = requireFunction("buildTurnStartMessage", buildTurnStartMessage);
  const broadcastToSessionImpl = requireFunction("broadcastToSession", broadcastToSession);
  const reconcilePublicRoomInventoryImpl = requireFunction(
    "reconcilePublicRoomInventory",
    reconcilePublicRoomInventory
  );
  const nowImpl = requireFunction("now", now);

  function removeParticipantFromSession(
    sessionId,
    playerId,
    options = { source: "leave", socketReason: "left_session" }
  ) {
    const store = getStoreImpl();
    const session = store.multiplayerSessions[sessionId];
    if (!session) {
      return {
        ok: false,
        reason: "unknown_session",
      };
    }
    if (!session.participants?.[playerId]) {
      return {
        ok: false,
        reason: "unknown_player",
      };
    }

    delete session.participants[playerId];
    if (session.chatConductState?.players && typeof session.chatConductState.players === "object") {
      delete session.chatConductState.players[playerId];
    }
    const removedOwner =
      typeof session.ownerPlayerId === "string" && session.ownerPlayerId.trim() === playerId;
    if (removedOwner) {
      ensureSessionOwnerImpl(session);
    }

    disconnectPlayerSocketsImpl(
      sessionId,
      playerId,
      wsCloseCodesImpl.normal,
      options.socketReason ?? "left_session"
    );

    ensureSessionTurnStateImpl(session);
    const mutationNow = nowImpl();

    if (getHumanParticipantCountImpl(session) === 0) {
      const roomKind = getSessionRoomKindImpl(session);
      if (roomKind === roomKindsImpl.private) {
        expireSessionImpl(sessionId, "session_empty");
      } else {
        resetPublicRoomForIdleImpl(session, mutationNow);
        reconcileSessionLoopsImpl(sessionId);
        broadcastSessionStateImpl(session, options.source ?? "leave");
      }
    } else {
      const forfeited = maybeForfeitSessionForSingleHumanRemainingImpl(session, mutationNow);
      markSessionActivityImpl(session, undefined, mutationNow);
      reconcileSessionLoopsImpl(sessionId);
      if (!forfeited) {
        const turnStart = buildTurnStartMessageImpl(session, { source: "reassign" });
        if (turnStart) {
          broadcastToSessionImpl(sessionId, JSON.stringify(turnStart), null);
        }
      }
      broadcastSessionStateImpl(session, options.source ?? "leave");
    }

    const roomInventoryChanged = reconcilePublicRoomInventoryImpl(mutationNow);
    return {
      ok: true,
      roomInventoryChanged,
      sessionExpired: !getStoreImpl().multiplayerSessions[sessionId],
    };
  }

  return {
    removeParticipantFromSession,
  };
}

import { resolveSessionRecoveryRetryOptions } from "./sessionRecoveryRetryProfiles.mjs";

function requireFunction(name, value) {
  if (typeof value !== "function") {
    throw new Error(`Missing multiplayer session mutation dependency: ${name}`);
  }
  return value;
}

function requireObject(name, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Missing multiplayer session mutation dependency: ${name}`);
  }
  return value;
}

export function createSessionMutationService({
  getStore,
  roomKinds,
  adminRoles,
  sessionModerationActions,
  maxMultiplayerHumanPlayers,
  maxMultiplayerBots,
  rehydrateSessionWithRetry,
  rehydrateSessionParticipantWithRetry,
  normalizeParticipantStateAction,
  normalizeDemoControlAction,
  authorizeSessionActionRequest,
  shouldRetrySessionAuthFromStore,
  isBotParticipant,
  isParticipantSeated,
  isParticipantQueuedForNextGame,
  shouldQueueParticipantForNextGame,
  markSessionActivity,
  ensureSessionTurnState,
  reconcileSessionLoops,
  broadcastSessionState,
  broadcastSystemRoomChannelMessage,
  buildSessionSnapshot,
  getSessionRoomKind,
  ensureSessionOwner,
  getSessionOwnerPlayerId,
  getBotParticipants,
  getSeatedHumanParticipantCount,
  pruneSessionBots,
  addBotsToSession,
  resetSessionForNextGame,
  normalizeSessionBotsForAutoRun,
  resetSessionBotLoopSchedule,
  isSessionDemoAutoRunEnabled,
  isSessionDemoFastMode,
  isDemoModeSession,
  buildTurnStartMessage,
  broadcastToSession,
  removeParticipantFromSession,
  authorizeAdminRequest,
  resolveModerationActorDisplayName,
  upsertSessionRoomBan,
  recordAdminAuditEvent,
  persistStore,
  now = () => Date.now(),
}) {
  const getStoreImpl = requireFunction("getStore", getStore);
  const roomKindsImpl = requireObject("roomKinds", roomKinds);
  const adminRolesImpl = requireObject("adminRoles", adminRoles);
  const sessionModerationActionsImpl = requireObject(
    "sessionModerationActions",
    sessionModerationActions
  );
  const rehydrateSessionWithRetryImpl = requireFunction(
    "rehydrateSessionWithRetry",
    rehydrateSessionWithRetry
  );
  const rehydrateSessionParticipantWithRetryImpl = requireFunction(
    "rehydrateSessionParticipantWithRetry",
    rehydrateSessionParticipantWithRetry
  );
  const normalizeParticipantStateActionImpl = requireFunction(
    "normalizeParticipantStateAction",
    normalizeParticipantStateAction
  );
  const normalizeDemoControlActionImpl = requireFunction(
    "normalizeDemoControlAction",
    normalizeDemoControlAction
  );
  const authorizeSessionActionRequestImpl = requireFunction(
    "authorizeSessionActionRequest",
    authorizeSessionActionRequest
  );
  const shouldRetrySessionAuthFromStoreImpl = requireFunction(
    "shouldRetrySessionAuthFromStore",
    shouldRetrySessionAuthFromStore
  );
  const isBotParticipantImpl = requireFunction("isBotParticipant", isBotParticipant);
  const isParticipantSeatedImpl = requireFunction("isParticipantSeated", isParticipantSeated);
  const isParticipantQueuedForNextGameImpl = requireFunction(
    "isParticipantQueuedForNextGame",
    isParticipantQueuedForNextGame
  );
  const shouldQueueParticipantForNextGameImpl = requireFunction(
    "shouldQueueParticipantForNextGame",
    shouldQueueParticipantForNextGame
  );
  const markSessionActivityImpl = requireFunction("markSessionActivity", markSessionActivity);
  const ensureSessionTurnStateImpl = requireFunction("ensureSessionTurnState", ensureSessionTurnState);
  const reconcileSessionLoopsImpl = requireFunction("reconcileSessionLoops", reconcileSessionLoops);
  const broadcastSessionStateImpl = requireFunction("broadcastSessionState", broadcastSessionState);
  const broadcastSystemRoomChannelMessageImpl = requireFunction(
    "broadcastSystemRoomChannelMessage",
    broadcastSystemRoomChannelMessage
  );
  const buildSessionSnapshotImpl = requireFunction("buildSessionSnapshot", buildSessionSnapshot);
  const getSessionRoomKindImpl = requireFunction("getSessionRoomKind", getSessionRoomKind);
  const ensureSessionOwnerImpl = requireFunction("ensureSessionOwner", ensureSessionOwner);
  const getSessionOwnerPlayerIdImpl = requireFunction("getSessionOwnerPlayerId", getSessionOwnerPlayerId);
  const getBotParticipantsImpl = requireFunction("getBotParticipants", getBotParticipants);
  const getSeatedHumanParticipantCountImpl = requireFunction(
    "getSeatedHumanParticipantCount",
    getSeatedHumanParticipantCount
  );
  const pruneSessionBotsImpl = requireFunction("pruneSessionBots", pruneSessionBots);
  const addBotsToSessionImpl = requireFunction("addBotsToSession", addBotsToSession);
  const resetSessionForNextGameImpl = requireFunction("resetSessionForNextGame", resetSessionForNextGame);
  const normalizeSessionBotsForAutoRunImpl = requireFunction(
    "normalizeSessionBotsForAutoRun",
    normalizeSessionBotsForAutoRun
  );
  const resetSessionBotLoopScheduleImpl = requireFunction(
    "resetSessionBotLoopSchedule",
    resetSessionBotLoopSchedule
  );
  const isSessionDemoAutoRunEnabledImpl = requireFunction(
    "isSessionDemoAutoRunEnabled",
    isSessionDemoAutoRunEnabled
  );
  const isSessionDemoFastModeImpl = requireFunction("isSessionDemoFastMode", isSessionDemoFastMode);
  const isDemoModeSessionImpl = requireFunction("isDemoModeSession", isDemoModeSession);
  const buildTurnStartMessageImpl = requireFunction("buildTurnStartMessage", buildTurnStartMessage);
  const broadcastToSessionImpl = requireFunction("broadcastToSession", broadcastToSession);
  const removeParticipantFromSessionImpl = requireFunction(
    "removeParticipantFromSession",
    removeParticipantFromSession
  );
  const authorizeAdminRequestImpl = requireFunction("authorizeAdminRequest", authorizeAdminRequest);
  const resolveModerationActorDisplayNameImpl = requireFunction(
    "resolveModerationActorDisplayName",
    resolveModerationActorDisplayName
  );
  const upsertSessionRoomBanImpl = requireFunction("upsertSessionRoomBan", upsertSessionRoomBan);
  const recordAdminAuditEventImpl = requireFunction("recordAdminAuditEvent", recordAdminAuditEvent);
  const persistStoreImpl = requireFunction("persistStore", persistStore);
  const nowImpl = requireFunction("now", now);

  function getSession(sessionId) {
    return getStoreImpl().multiplayerSessions[sessionId] ?? null;
  }

  async function updateParticipantState({ req, sessionId, body }) {
    let session = getSession(sessionId);
    if (!session || session.expiresAt <= nowImpl()) {
      session = await rehydrateSessionWithRetryImpl(
        sessionId,
        "participant_state_session",
        resolveSessionRecoveryRetryOptions("sessionFast")
      );
    }
    if (!session || session.expiresAt <= nowImpl()) {
      return {
        status: 200,
        payload: {
          ok: false,
          reason: "session_expired",
        },
      };
    }

    const playerId = typeof body?.playerId === "string" ? body.playerId : "";
    const action = normalizeParticipantStateActionImpl(body?.action);
    let participant = playerId ? session.participants[playerId] : null;
    if (!playerId || !participant || isBotParticipantImpl(participant)) {
      const recovered = await rehydrateSessionParticipantWithRetryImpl(
        sessionId,
        playerId,
        "participant_state_participant",
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
          reason: "unknown_player",
        },
      };
    }
    if (!action) {
      return {
        status: 400,
        payload: {
          error: "action is required",
          reason: "invalid_action",
        },
      };
    }

    let authCheck = authorizeSessionActionRequestImpl(req, playerId, sessionId);
    if (!authCheck.ok && shouldRetrySessionAuthFromStoreImpl(authCheck.reason)) {
      const recovered = await rehydrateSessionParticipantWithRetryImpl(
        sessionId,
        playerId,
        "participant_state_auth",
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

    const actionAt = nowImpl();
    let changed = false;
    let reason = "ok";

    if (action === "sit") {
      const shouldQueueForNextGame = shouldQueueParticipantForNextGameImpl(session);
      if (!isParticipantSeatedImpl(participant)) {
        participant.isSeated = true;
        changed = true;
      }
      if (participant.isReady === true) {
        participant.isReady = false;
        changed = true;
      }
      const nextQueuedForNextGame = shouldQueueForNextGame ? true : false;
      if (participant.queuedForNextGame !== nextQueuedForNextGame) {
        participant.queuedForNextGame = nextQueuedForNextGame;
        changed = true;
      }
    } else if (action === "stand") {
      if (isParticipantSeatedImpl(participant)) {
        participant.isSeated = false;
        changed = true;
      }
      if (participant.isReady === true) {
        participant.isReady = false;
        changed = true;
      }
      if (participant.queuedForNextGame === true) {
        participant.queuedForNextGame = false;
        changed = true;
      }
    } else if (action === "ready") {
      if (!isParticipantSeatedImpl(participant)) {
        reason = "not_seated";
      } else {
        const shouldQueueForNextGame = shouldQueueParticipantForNextGameImpl(session);
        const nextQueuedForNextGame = shouldQueueForNextGame ? true : false;
        if (participant.queuedForNextGame !== nextQueuedForNextGame) {
          participant.queuedForNextGame = nextQueuedForNextGame;
          changed = true;
        }
        if (participant.isReady !== true) {
          participant.isReady = true;
          changed = true;
        }
      }
    } else if (action === "unready") {
      if (participant.isReady === true) {
        participant.isReady = false;
        changed = true;
      }
      if (
        !shouldQueueParticipantForNextGameImpl(session) &&
        participant.queuedForNextGame === true
      ) {
        participant.queuedForNextGame = false;
        changed = true;
      }
    }

    if (!isParticipantSeatedImpl(participant) && participant.isReady === true) {
      participant.isReady = false;
      changed = true;
    }
    participant.lastHeartbeatAt = actionAt;
    markSessionActivityImpl(session, playerId, actionAt);

    if (changed) {
      ensureSessionTurnStateImpl(session);
      reconcileSessionLoopsImpl(sessionId);
      broadcastSessionStateImpl(session, `participant_${action}`);
      const actorName = participant.displayName || participant.playerId;
      const actionMessageMap = {
        sit:
          participant.queuedForNextGame === true
            ? `${actorName} sat down and is waiting for the next game.`
            : `${actorName} sat down.`,
        stand: `${actorName} stood up.`,
        ready:
          participant.queuedForNextGame === true
            ? `${actorName} is ready for the next game.`
            : `${actorName} is ready to play.`,
        unready: `${actorName} is no longer ready.`,
      };
      const actionMessage = actionMessageMap[action];
      if (actionMessage) {
        broadcastSystemRoomChannelMessageImpl(sessionId, {
          topic: "seat_state",
          title: actorName,
          message: actionMessage,
          severity: action === "ready" ? "success" : "info",
          timestamp: actionAt,
        });
      }
    }
    await persistStoreImpl();

    return {
      status: 200,
      payload: {
        ok: reason === "ok",
        reason,
        state: {
          isSeated: isParticipantSeatedImpl(participant),
          isReady: participant.isReady === true,
          queuedForNextGame: isParticipantQueuedForNextGameImpl(participant),
        },
        session: {
          ...buildSessionSnapshotImpl(session),
          serverNow: actionAt,
        },
      },
    };
  }

  async function updateSessionDemoControls({ req, sessionId, body }) {
    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!normalizedSessionId) {
      return {
        status: 400,
        payload: { error: "Invalid session ID", reason: "invalid_session_id" },
      };
    }

    let session = getSession(normalizedSessionId);
    if (!session || session.expiresAt <= nowImpl()) {
      session = await rehydrateSessionWithRetryImpl(
        normalizedSessionId,
        "demo_controls_session",
        resolveSessionRecoveryRetryOptions("sessionFast")
      );
    }
    if (!session || session.expiresAt <= nowImpl()) {
      return {
        status: 410,
        payload: { error: "Session expired", reason: "session_expired" },
      };
    }

    const requestedPlayerId = typeof body?.playerId === "string" ? body.playerId.trim() : "";
    const action = normalizeDemoControlActionImpl(body?.action);
    if (!action) {
      return {
        status: 400,
        payload: { error: "Invalid demo control action", reason: "invalid_action" },
      };
    }

    let authCheck = authorizeSessionActionRequestImpl(req, undefined, normalizedSessionId);
    if (!authCheck.ok && shouldRetrySessionAuthFromStoreImpl(authCheck.reason)) {
      session = await rehydrateSessionWithRetryImpl(
        normalizedSessionId,
        `demo_controls_auth:${requestedPlayerId || "unknown"}`,
        resolveSessionRecoveryRetryOptions("sessionFast")
      );
      authCheck = authorizeSessionActionRequestImpl(req, undefined, normalizedSessionId);
    }
    if (!authCheck.ok) {
      return {
        status: 401,
        payload: { error: "Unauthorized", reason: authCheck.reason ?? "unauthorized" },
      };
    }

    const authenticatedPlayerId =
      typeof authCheck.playerId === "string" ? authCheck.playerId.trim() : "";
    const playerId = authenticatedPlayerId || requestedPlayerId;
    if (!playerId) {
      return {
        status: 400,
        payload: { error: "playerId is required", reason: "invalid_player_id" },
      };
    }

    const participant = session.participants?.[playerId];
    if (!participant || isBotParticipantImpl(participant)) {
      return {
        status: 404,
        payload: { error: "Unknown player", reason: "unknown_player" },
      };
    }

    if (getSessionRoomKindImpl(session) !== roomKindsImpl.private) {
      return {
        status: 409,
        payload: { error: "Demo controls are private-room only", reason: "room_not_private" },
      };
    }
    const ownerPlayerId = ensureSessionOwnerImpl(session);
    if (!ownerPlayerId || ownerPlayerId !== playerId) {
      return {
        status: 403,
        payload: { error: "Only room owner can control demo", reason: "not_room_owner" },
      };
    }

    const controlAt = nowImpl();
    let changed = false;
    let didRestartAutoRun = false;
    let seededBotCount = getBotParticipantsImpl(session).length;

    if (session.demoMode !== true) {
      session.demoMode = true;
      changed = true;
    }
    if (action === "pause") {
      if (session.demoAutoRun !== false) {
        session.demoAutoRun = false;
        changed = true;
      }
    } else if (action === "resume") {
      if (session.demoAutoRun !== true) {
        session.demoAutoRun = true;
        changed = true;
      }
      if (participant.isSeated === true) {
        participant.isSeated = false;
        changed = true;
      }
      if (participant.isReady === true) {
        participant.isReady = false;
        changed = true;
      }
      if (participant.queuedForNextGame === true) {
        participant.queuedForNextGame = false;
        changed = true;
      }

      const seatedHumanCount = getSeatedHumanParticipantCountImpl(session);
      const availableSeatCount = Math.max(0, maxMultiplayerHumanPlayers - seatedHumanCount);
      const targetBotCount =
        availableSeatCount > 0 ? Math.max(1, Math.min(maxMultiplayerBots, availableSeatCount)) : 0;
      const botPrune = pruneSessionBotsImpl(normalizedSessionId, session, {
        removeAll: true,
        now: controlAt,
      });
      if (botPrune.changed) {
        changed = true;
      }
      const addedBotCount = addBotsToSessionImpl(session, targetBotCount, controlAt);
      if (addedBotCount > 0) {
        changed = true;
      }

      const restarted = resetSessionForNextGameImpl(session, controlAt);
      if (restarted) {
        changed = true;
      } else {
        session.gameStartedAt = controlAt;
        session.turnState = null;
        ensureSessionTurnStateImpl(session);
        changed = true;
      }
      const normalizedBots = normalizeSessionBotsForAutoRunImpl(session, controlAt);
      if (normalizedBots.changed) {
        changed = true;
      }
      seededBotCount = normalizedBots.count;
      didRestartAutoRun = true;
    } else if (action === "speed_fast") {
      if (session.demoSpeedMode !== true) {
        session.demoSpeedMode = true;
        changed = true;
      }
    } else if (action === "speed_normal") {
      if (session.demoSpeedMode !== false) {
        session.demoSpeedMode = false;
        changed = true;
      }
    }

    participant.lastHeartbeatAt = controlAt;
    markSessionActivityImpl(session, playerId, controlAt);
    ensureSessionTurnStateImpl(session);

    if (changed) {
      resetSessionBotLoopScheduleImpl(normalizedSessionId);
      reconcileSessionLoopsImpl(normalizedSessionId);
      const isRunning = isSessionDemoAutoRunEnabledImpl(session);
      const speedLabel = isSessionDemoFastModeImpl(session) ? "fast" : "normal";
      broadcastSystemRoomChannelMessageImpl(normalizedSessionId, {
        topic: "demo_control",
        title: participant.displayName || participant.playerId,
        message:
          action === "pause"
            ? "Demo paused by host."
            : action === "resume"
              ? `Demo restarted with ${seededBotCount} bot${seededBotCount === 1 ? "" : "s"}.`
              : `Demo speed set to ${speedLabel}.`,
        severity: "info",
        timestamp: controlAt,
      });
      if (didRestartAutoRun && isRunning) {
        const nextTurnStart = buildTurnStartMessageImpl(session, {
          source: "demo_restart",
        });
        if (nextTurnStart) {
          broadcastToSessionImpl(normalizedSessionId, JSON.stringify(nextTurnStart), null);
        }
      }
      broadcastSessionStateImpl(session, "demo_controls");
    }

    await persistStoreImpl();
    return {
      status: 200,
      payload: {
        ok: true,
        controls: {
          demoMode: isDemoModeSessionImpl(session),
          demoAutoRun: isSessionDemoAutoRunEnabledImpl(session),
          demoSpeedMode: isSessionDemoFastModeImpl(session),
        },
        session: {
          ...buildSessionSnapshotImpl(session),
          serverNow: controlAt,
        },
      },
    };
  }

  async function leaveSession({ sessionId, body }) {
    const playerId = typeof body?.playerId === "string" ? body.playerId : "";
    if (!playerId) {
      return {
        status: 400,
        payload: { error: "playerId is required" },
      };
    }

    let removal = removeParticipantFromSessionImpl(sessionId, playerId, {
      source: "leave",
      socketReason: "left_session",
    });
    if (!removal.ok && removal.reason === "unknown_session") {
      await rehydrateSessionWithRetryImpl(
        sessionId,
        "leave_session",
        resolveSessionRecoveryRetryOptions("sessionLeave")
      );
      removal = removeParticipantFromSessionImpl(sessionId, playerId, {
        source: "leave",
        socketReason: "left_session",
      });
    }
    if (!removal.ok && removal.reason === "unknown_player") {
      await rehydrateSessionParticipantWithRetryImpl(
        sessionId,
        playerId,
        "leave_session_participant",
        resolveSessionRecoveryRetryOptions("sessionLeave")
      );
      removal = removeParticipantFromSessionImpl(sessionId, playerId, {
        source: "leave",
        socketReason: "left_session",
      });
    }
    if (!removal.ok && removal.reason === "unknown_session") {
      return {
        status: 200,
        payload: { ok: true },
      };
    }
    if (!removal.ok && removal.reason === "unknown_player") {
      return {
        status: 200,
        payload: { ok: true },
      };
    }
    if (!removal.ok) {
      return {
        status: 404,
        payload: { error: "Player not found in session", reason: removal.reason },
      };
    }

    await persistStoreImpl();
    return {
      status: 200,
      payload: { ok: true },
    };
  }

  async function moderateSessionParticipant({ req, sessionId, body }) {
    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!normalizedSessionId) {
      return {
        status: 400,
        payload: {
          error: "Invalid session ID",
          reason: "invalid_session_id",
        },
      };
    }

    let session = getSession(normalizedSessionId);
    if (!session || session.expiresAt <= nowImpl()) {
      session = await rehydrateSessionWithRetryImpl(
        normalizedSessionId,
        "moderate_session",
        resolveSessionRecoveryRetryOptions("sessionFast")
      );
    }
    if (!session || session.expiresAt <= nowImpl()) {
      return {
        status: 410,
        payload: {
          error: "Session expired",
          reason: "session_expired",
        },
      };
    }

    const requesterPlayerId =
      typeof body?.requesterPlayerId === "string" ? body.requesterPlayerId.trim() : "";
    const targetPlayerId =
      typeof body?.targetPlayerId === "string" ? body.targetPlayerId.trim() : "";
    const actionRaw = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
    const action = sessionModerationActionsImpl.has(actionRaw) ? actionRaw : "";

    if (!requesterPlayerId) {
      return {
        status: 400,
        payload: {
          error: "requesterPlayerId is required",
          reason: "invalid_requester_player_id",
        },
      };
    }
    if (!targetPlayerId) {
      return {
        status: 400,
        payload: {
          error: "targetPlayerId is required",
          reason: "invalid_target_player_id",
        },
      };
    }
    if (!action) {
      return {
        status: 400,
        payload: {
          error: "Invalid moderation action",
          reason: "invalid_moderation_action",
        },
      };
    }
    if (requesterPlayerId === targetPlayerId) {
      return {
        status: 409,
        payload: {
          error: "Cannot moderate self",
          reason: "cannot_moderate_self",
        },
      };
    }

    if (getSessionRoomKindImpl(session) === roomKindsImpl.private) {
      ensureSessionOwnerImpl(session);
    }
    const requesterParticipant = session.participants?.[requesterPlayerId] ?? null;
    const requesterAuth = authorizeSessionActionRequestImpl(req, requesterPlayerId, normalizedSessionId);
    const requesterIsOwner =
      requesterAuth.ok &&
      requesterParticipant &&
      !isBotParticipantImpl(requesterParticipant) &&
      getSessionOwnerPlayerIdImpl(session) === requesterPlayerId;
    let moderatorRole = requesterIsOwner ? "owner" : null;
    let adminAuth = null;

    if (!moderatorRole) {
      adminAuth = await authorizeAdminRequestImpl(req, { minimumRole: adminRolesImpl.operator });
      if (adminAuth.ok) {
        moderatorRole = "admin";
      }
    }

    if (!moderatorRole) {
      if (requesterAuth.ok && requesterParticipant && !isBotParticipantImpl(requesterParticipant)) {
        return {
          status: 403,
          payload: {
            error: "Only room owner can moderate participants",
            reason: "not_room_owner",
          },
        };
      }
      return {
        status: adminAuth?.status ?? 401,
        payload: {
          error: "Unauthorized",
          reason: adminAuth?.reason ?? "unauthorized",
        },
      };
    }

    const moderatedAt = nowImpl();
    const targetParticipant = session.participants?.[targetPlayerId] ?? null;
    if (!targetParticipant && action === "kick") {
      return {
        status: 404,
        payload: {
          error: "Target player not found in session",
          reason: "unknown_player",
        },
      };
    }

    const actorName = resolveModerationActorDisplayNameImpl({
      requesterPlayerId,
      requesterParticipant,
      moderatorRole,
      adminAuth,
    });
    const targetLabel =
      typeof targetParticipant?.displayName === "string" && targetParticipant.displayName.trim().length > 0
        ? targetParticipant.displayName.trim()
        : targetPlayerId;
    if (action === "ban") {
      upsertSessionRoomBanImpl(session, targetPlayerId, {
        bannedAt: moderatedAt,
        bannedByPlayerId: requesterPlayerId,
        bannedByRole: moderatorRole,
      });
    }

    let removal = {
      ok: true,
      roomInventoryChanged: false,
      sessionExpired: false,
    };
    if (targetParticipant) {
      removal = removeParticipantFromSessionImpl(normalizedSessionId, targetPlayerId, {
        source: action === "ban" ? "moderation_ban" : "moderation_kick",
        socketReason: action === "ban" ? "banned_from_room" : "removed_by_moderator",
      });
      if (!removal.ok) {
        const status =
          removal.reason === "unknown_session" || removal.reason === "unknown_player" ? 404 : 409;
        return {
          status,
          payload: {
            error: "Failed to moderate participant",
            reason: removal.reason,
          },
        };
      }
    }

    const updatedSession = getSession(normalizedSessionId);
    if (updatedSession) {
      markSessionActivityImpl(updatedSession, requesterPlayerId, moderatedAt, {
        countAsPlayerAction: false,
      });
      reconcileSessionLoopsImpl(normalizedSessionId);
      broadcastSystemRoomChannelMessageImpl(normalizedSessionId, {
        topic: action === "ban" ? "moderation_ban" : "moderation_kick",
        title: "Room Moderation",
        message:
          action === "ban"
            ? `${targetLabel} was banned from the room by ${actorName}.`
            : `${targetLabel} was removed from the room by ${actorName}.`,
        severity: action === "ban" ? "warning" : "info",
        timestamp: moderatedAt,
      });
    }

    if (moderatorRole === "admin" && adminAuth?.ok) {
      recordAdminAuditEventImpl(adminAuth, "participant_remove", {
        summary: `${action} ${targetPlayerId} in ${normalizedSessionId}`,
        sessionId: normalizedSessionId,
        playerId: targetPlayerId,
        action,
        roomInventoryChanged: removal.roomInventoryChanged === true,
        sessionExpired: removal.sessionExpired === true,
      });
    }

    await persistStoreImpl();
    return {
      status: 200,
      payload: {
        ok: true,
        action,
        targetPlayerId,
        moderatedBy: {
          playerId: requesterPlayerId,
          role: moderatorRole,
        },
        roomInventoryChanged: removal.roomInventoryChanged === true,
        sessionExpired: removal.sessionExpired === true,
        session: updatedSession
          ? {
              ...buildSessionSnapshotImpl(updatedSession),
              serverNow: moderatedAt,
            }
          : null,
      },
    };
  }

  return {
    updateParticipantState,
    updateSessionDemoControls,
    leaveSession,
    moderateSessionParticipant,
  };
}

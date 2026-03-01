function requireFunction(name, value) {
  if (typeof value !== "function") {
    throw new Error(`Missing admin mutation dependency: ${name}`);
  }
  return value;
}

function requireObject(name, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Missing admin mutation dependency: ${name}`);
  }
  return value;
}

export function createAdminMutationService({
  getStore,
  adminRoles,
  normalizeAdminRole,
  isBootstrapOwnerUid,
  buildAdminRoleRecord,
  recordAdminAuditEvent,
  persistStore,
  expireSession,
  reconcilePublicRoomInventory,
  removeParticipantFromSession,
  ensureSessionChatConductState,
  normalizeChatConductState,
  chatConductBasePolicy,
  buildAdminChatConductPlayerRecord,
  log,
  now = () => Date.now(),
}) {
  const getStoreImpl = requireFunction("getStore", getStore);
  const adminRolesImpl = requireObject("adminRoles", adminRoles);
  const normalizeAdminRoleImpl = requireFunction("normalizeAdminRole", normalizeAdminRole);
  const isBootstrapOwnerUidImpl = requireFunction("isBootstrapOwnerUid", isBootstrapOwnerUid);
  const buildAdminRoleRecordImpl = requireFunction("buildAdminRoleRecord", buildAdminRoleRecord);
  const recordAdminAuditEventImpl = requireFunction("recordAdminAuditEvent", recordAdminAuditEvent);
  const persistStoreImpl = requireFunction("persistStore", persistStore);
  const expireSessionImpl = requireFunction("expireSession", expireSession);
  const reconcilePublicRoomInventoryImpl = requireFunction(
    "reconcilePublicRoomInventory",
    reconcilePublicRoomInventory
  );
  const removeParticipantFromSessionImpl = requireFunction(
    "removeParticipantFromSession",
    removeParticipantFromSession
  );
  const ensureSessionChatConductStateImpl = requireFunction(
    "ensureSessionChatConductState",
    ensureSessionChatConductState
  );
  const normalizeChatConductStateImpl = requireFunction(
    "normalizeChatConductState",
    normalizeChatConductState
  );
  const buildAdminChatConductPlayerRecordImpl = requireFunction(
    "buildAdminChatConductPlayerRecord",
    buildAdminChatConductPlayerRecord
  );
  const logImpl = requireObject("log", log);
  const nowImpl = requireFunction("now", now);

  async function upsertRole({ auth, targetUid, body }) {
    const normalizedTargetUid = typeof targetUid === "string" ? targetUid.trim() : "";
    if (!normalizedTargetUid) {
      return {
        ok: false,
        status: 400,
        error: "Invalid UID",
        reason: "invalid_uid",
      };
    }

    const hasRoleField =
      body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "role");
    if (!hasRoleField) {
      return {
        ok: false,
        status: 400,
        error: "Role is required",
        reason: "missing_admin_role",
      };
    }

    const requestedRole = normalizeAdminRoleImpl(body?.role);
    const rawRole = typeof body?.role === "string" ? body.role.trim() : "";
    if (rawRole && !requestedRole) {
      return {
        ok: false,
        status: 400,
        error: "Invalid role",
        reason: "invalid_admin_role",
      };
    }

    if (isBootstrapOwnerUidImpl(normalizedTargetUid) && requestedRole !== adminRolesImpl.owner) {
      return {
        ok: false,
        status: 409,
        error: "Bootstrap owner role is fixed",
        reason: "bootstrap_owner_locked",
      };
    }

    const timestamp = nowImpl();
    const store = getStoreImpl();
    const current = store.firebasePlayers[normalizedTargetUid] ?? { uid: normalizedTargetUid };
    const next = {
      ...current,
      uid: normalizedTargetUid,
      updatedAt: timestamp,
    };
    if (requestedRole) {
      next.adminRole = requestedRole;
    } else {
      delete next.adminRole;
    }
    next.adminRoleUpdatedAt = timestamp;
    next.adminRoleUpdatedBy = auth?.uid ?? auth?.authType;
    store.firebasePlayers[normalizedTargetUid] = next;

    recordAdminAuditEventImpl(auth, "role_upsert", {
      summary: `Set ${normalizedTargetUid} role to ${requestedRole ?? "none"}`,
      targetUid: normalizedTargetUid,
      role: requestedRole,
    });
    await persistStoreImpl();

    return {
      ok: true,
      roleRecord: buildAdminRoleRecordImpl(normalizedTargetUid, next),
    };
  }

  async function expireSessionByAdmin({ auth, sessionId }) {
    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!normalizedSessionId) {
      return {
        ok: false,
        status: 400,
        error: "Invalid session ID",
        reason: "invalid_session_id",
      };
    }

    const store = getStoreImpl();
    if (!store.multiplayerSessions[normalizedSessionId]) {
      return {
        ok: false,
        status: 404,
        error: "Session not found",
        reason: "unknown_session",
      };
    }

    expireSessionImpl(normalizedSessionId, "admin_expired");
    const roomInventoryChanged = reconcilePublicRoomInventoryImpl(nowImpl());

    recordAdminAuditEventImpl(auth, "session_expire", {
      summary: `Expired room ${normalizedSessionId}`,
      sessionId: normalizedSessionId,
    });
    await persistStoreImpl();

    logImpl.info(
      `Admin expired session ${normalizedSessionId} by ${auth?.uid ?? auth?.authType ?? "unknown"} (${auth?.role ?? "n/a"})`
    );

    return {
      ok: true,
      sessionId: normalizedSessionId,
      roomInventoryChanged,
    };
  }

  async function removeParticipant({ auth, sessionId, playerId }) {
    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    const normalizedPlayerId = typeof playerId === "string" ? playerId.trim() : "";
    if (!normalizedSessionId) {
      return {
        ok: false,
        status: 400,
        error: "Invalid session ID",
        reason: "invalid_session_id",
      };
    }
    if (!normalizedPlayerId) {
      return {
        ok: false,
        status: 400,
        error: "Invalid player ID",
        reason: "invalid_player_id",
      };
    }

    const removal = removeParticipantFromSessionImpl(normalizedSessionId, normalizedPlayerId, {
      source: "admin_remove",
      socketReason: "removed_by_admin",
    });
    if (!removal.ok) {
      const status =
        removal.reason === "unknown_session" || removal.reason === "unknown_player" ? 404 : 409;
      return {
        ok: false,
        status,
        error: "Failed to remove participant",
        reason: removal.reason,
      };
    }

    recordAdminAuditEventImpl(auth, "participant_remove", {
      summary: `Removed ${normalizedPlayerId} from ${normalizedSessionId}`,
      sessionId: normalizedSessionId,
      playerId: normalizedPlayerId,
      sessionExpired: removal.sessionExpired === true,
      roomInventoryChanged: removal.roomInventoryChanged === true,
    });
    await persistStoreImpl();

    logImpl.info(
      `Admin removed participant ${normalizedPlayerId} from ${normalizedSessionId} by ${auth?.uid ?? auth?.authType ?? "unknown"} (${auth?.role ?? "n/a"})`
    );

    return {
      ok: true,
      sessionId: normalizedSessionId,
      playerId: normalizedPlayerId,
      sessionExpired: removal.sessionExpired,
      roomInventoryChanged: removal.roomInventoryChanged,
    };
  }

  async function clearSessionConductPlayer({ auth, sessionId, playerId, resetTotalStrikes }) {
    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    const normalizedPlayerId = typeof playerId === "string" ? playerId.trim() : "";
    if (!normalizedSessionId) {
      return {
        ok: false,
        status: 400,
        error: "Invalid session ID",
        reason: "invalid_session_id",
      };
    }
    if (!normalizedPlayerId) {
      return {
        ok: false,
        status: 400,
        error: "Invalid player ID",
        reason: "invalid_player_id",
      };
    }

    const timestamp = nowImpl();
    const session = getStoreImpl().multiplayerSessions[normalizedSessionId];
    if (!session || session.expiresAt <= timestamp) {
      return {
        ok: false,
        status: 404,
        error: "Session not found",
        reason: "unknown_session",
      };
    }

    const shouldResetTotalStrikes = resetTotalStrikes === true;
    const state = ensureSessionChatConductStateImpl(session, timestamp);
    const existingRecord = state.players[normalizedPlayerId];
    const hadRecord = Boolean(existingRecord);
    if (existingRecord && typeof existingRecord === "object") {
      existingRecord.strikeEvents = [];
      existingRecord.lastViolationAt = 0;
      existingRecord.mutedUntil = 0;
      if (shouldResetTotalStrikes) {
        existingRecord.totalStrikes = 0;
      }
    }

    session.chatConductState = normalizeChatConductStateImpl(
      state,
      chatConductBasePolicy,
      timestamp
    );
    const updatedPlayer = buildAdminChatConductPlayerRecordImpl(
      session,
      normalizedPlayerId,
      session.chatConductState?.players?.[normalizedPlayerId],
      timestamp
    );

    recordAdminAuditEventImpl(auth, "session_conduct_clear_player", {
      summary: `Cleared chat conduct state for ${normalizedPlayerId} in ${normalizedSessionId}`,
      sessionId: normalizedSessionId,
      playerId: normalizedPlayerId,
      hadRecord,
      resetTotalStrikes: shouldResetTotalStrikes,
    });
    await persistStoreImpl();

    return {
      ok: true,
      sessionId: normalizedSessionId,
      playerId: normalizedPlayerId,
      hadRecord,
      resetTotalStrikes: shouldResetTotalStrikes,
      player: updatedPlayer,
    };
  }

  async function clearSessionConductState({ auth, sessionId }) {
    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!normalizedSessionId) {
      return {
        ok: false,
        status: 400,
        error: "Invalid session ID",
        reason: "invalid_session_id",
      };
    }

    const timestamp = nowImpl();
    const session = getStoreImpl().multiplayerSessions[normalizedSessionId];
    if (!session || session.expiresAt <= timestamp) {
      return {
        ok: false,
        status: 404,
        error: "Session not found",
        reason: "unknown_session",
      };
    }

    const state = ensureSessionChatConductStateImpl(session, timestamp);
    const clearedPlayerCount = Object.keys(state.players).length;
    state.players = {};
    session.chatConductState = normalizeChatConductStateImpl(
      state,
      chatConductBasePolicy,
      timestamp
    );

    recordAdminAuditEventImpl(auth, "session_conduct_clear_all", {
      summary: `Cleared chat conduct state for ${normalizedSessionId}`,
      sessionId: normalizedSessionId,
      clearedPlayerCount,
    });
    await persistStoreImpl();

    return {
      ok: true,
      sessionId: normalizedSessionId,
      clearedPlayerCount,
    };
  }

  return {
    upsertRole,
    expireSession: expireSessionByAdmin,
    removeParticipant,
    clearSessionConductPlayer,
    clearSessionConductState,
  };
}

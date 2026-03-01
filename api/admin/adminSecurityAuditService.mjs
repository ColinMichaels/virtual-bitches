export function createAdminSecurityAuditService({
  getStore,
  adminRoles,
  adminRoleLevels,
  ownerUidAllowlist,
  ownerEmailAllowlist,
  adminRoomListLimitDefault,
  adminRoomListLimitMax,
  adminAuditListLimitDefault,
  adminAuditListLimitMax,
  adminConductListLimitDefault,
  adminConductListLimitMax,
  compactLogStore,
  randomUUID,
  now = () => Date.now(),
}) {
  function normalizeAdminRole(rawValue) {
    const normalized = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
    if (normalized === adminRoles.viewer) {
      return adminRoles.viewer;
    }
    if (normalized === adminRoles.operator) {
      return adminRoles.operator;
    }
    if (normalized === adminRoles.owner) {
      return adminRoles.owner;
    }
    return null;
  }

  function hasRequiredAdminRole(actualRole, requiredRole) {
    const actual = normalizeAdminRole(actualRole);
    const required = normalizeAdminRole(requiredRole) ?? adminRoles.viewer;
    if (!actual) {
      return false;
    }
    return adminRoleLevels[actual] >= adminRoleLevels[required];
  }

  function resolveAdminRoleForIdentity(uid, email) {
    const normalizedUid = typeof uid === "string" ? uid.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (normalizedUid && ownerUidAllowlist.has(normalizedUid)) {
      return {
        role: adminRoles.owner,
        source: "bootstrap",
      };
    }
    if (normalizedEmail && ownerEmailAllowlist.has(normalizedEmail)) {
      return {
        role: adminRoles.owner,
        source: "bootstrap",
      };
    }
    const store = getStore();
    const storedRole = normalizeAdminRole(store?.firebasePlayers?.[normalizedUid]?.adminRole);
    if (storedRole) {
      return {
        role: storedRole,
        source: "assigned",
      };
    }
    return {
      role: null,
      source: "none",
    };
  }

  function isBootstrapOwnerUid(uid) {
    const normalizedUid = typeof uid === "string" ? uid.trim() : "";
    return Boolean(normalizedUid) && ownerUidAllowlist.has(normalizedUid);
  }

  function hasBootstrapAdminOwnersConfigured() {
    return ownerUidAllowlist.size > 0 || ownerEmailAllowlist.size > 0;
  }

  function parseAdminRoomLimit(rawValue) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return adminRoomListLimitDefault;
    }
    return Math.max(1, Math.min(adminRoomListLimitMax, Math.floor(parsed)));
  }

  function parseAdminAuditLimit(rawValue) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return adminAuditListLimitDefault;
    }
    return Math.max(1, Math.min(adminAuditListLimitMax, Math.floor(parsed)));
  }

  function parseAdminConductLimit(rawValue) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return adminConductListLimitDefault;
    }
    return Math.max(1, Math.min(adminConductListLimitMax, Math.floor(parsed)));
  }

  function parseAdminModerationTermLimit(rawValue) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return 250;
    }
    return Math.max(1, Math.min(5000, Math.floor(parsed)));
  }

  function buildAdminPrincipal(authResult) {
    if (!authResult?.ok) {
      return null;
    }
    return {
      authType: authResult.authType ?? "unknown",
      uid: authResult.uid ?? null,
      role: authResult.role ?? null,
      roleSource: authResult.roleSource ?? "none",
    };
  }

  function collectAdminAuditEntries(limit = adminAuditListLimitDefault) {
    const boundedLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(adminAuditListLimitMax, Math.floor(limit)))
      : adminAuditListLimitDefault;
    const store = getStore();

    return Object.values(store?.gameLogs ?? {})
      .filter((entry) => entry && entry.type === "admin_action")
      .sort((left, right) => Number(right?.timestamp ?? 0) - Number(left?.timestamp ?? 0))
      .slice(0, boundedLimit)
      .map((entry) => {
        const payload = entry?.payload && typeof entry.payload === "object" ? entry.payload : {};
        const actor = payload?.actor && typeof payload.actor === "object" ? payload.actor : {};
        const target = payload?.target && typeof payload.target === "object" ? payload.target : {};
        return {
          id: typeof entry?.id === "string" ? entry.id : randomUUID(),
          timestamp: Number.isFinite(entry?.timestamp) ? Math.floor(entry.timestamp) : now(),
          action: typeof payload.action === "string" ? payload.action : "unknown",
          summary: typeof payload.summary === "string" ? payload.summary : undefined,
          actor: {
            uid: typeof actor.uid === "string" ? actor.uid : null,
            email: typeof actor.email === "string" ? actor.email : undefined,
            role: normalizeAdminRole(actor.role),
            authType: typeof actor.authType === "string" ? actor.authType : "unknown",
          },
          target: {
            uid: typeof target.uid === "string" ? target.uid : undefined,
            role: normalizeAdminRole(target.role),
            sessionId: typeof target.sessionId === "string" ? target.sessionId : undefined,
            playerId: typeof target.playerId === "string" ? target.playerId : undefined,
          },
        };
      });
  }

  function recordAdminAuditEvent(authResult, action, details = {}) {
    const timestamp = now();
    const actorUid = typeof authResult?.uid === "string" ? authResult.uid : null;
    const actorEmail = typeof authResult?.email === "string" ? authResult.email : undefined;
    const actorRole = normalizeAdminRole(authResult?.role);
    const actorAuthType =
      typeof authResult?.authType === "string" && authResult.authType
        ? authResult.authType
        : "unknown";
    const rawDetails = details && typeof details === "object" ? details : {};
    const targetUid =
      typeof rawDetails.targetUid === "string" && rawDetails.targetUid.trim()
        ? rawDetails.targetUid.trim()
        : undefined;
    const targetRole = normalizeAdminRole(rawDetails.role);
    const targetSessionId =
      typeof rawDetails.sessionId === "string" && rawDetails.sessionId.trim()
        ? rawDetails.sessionId.trim()
        : undefined;
    const targetPlayerId =
      typeof rawDetails.playerId === "string" && rawDetails.playerId.trim()
        ? rawDetails.playerId.trim()
        : undefined;
    const summary =
      typeof rawDetails.summary === "string" && rawDetails.summary.trim()
        ? rawDetails.summary.trim()
        : undefined;
    const id = randomUUID();
    const fallbackActorId =
      actorUid ??
      (typeof authResult?.authType === "string" && authResult.authType
        ? `admin:${authResult.authType}`
        : "admin:unknown");

    const nextDetails = { ...rawDetails };
    delete nextDetails.targetUid;
    delete nextDetails.role;
    delete nextDetails.sessionId;
    delete nextDetails.playerId;
    delete nextDetails.summary;

    const store = getStore();
    store.gameLogs[id] = {
      id,
      playerId: fallbackActorId,
      sessionId: targetSessionId,
      type: "admin_action",
      timestamp,
      payload: {
        action,
        summary,
        actor: {
          uid: actorUid,
          email: actorEmail,
          role: actorRole,
          authType: actorAuthType,
        },
        target: {
          uid: targetUid,
          role: targetRole,
          sessionId: targetSessionId,
          playerId: targetPlayerId,
        },
        details: nextDetails,
      },
    };
    compactLogStore();
  }

  function collectAdminRoleRecords() {
    const records = [];
    const seenUids = new Set();
    const store = getStore();

    Object.entries(store?.firebasePlayers ?? {}).forEach(([uid, playerRecord]) => {
      const record = buildAdminRoleRecord(uid, playerRecord);
      if (!record) {
        return;
      }
      records.push(record);
      seenUids.add(uid);
    });

    ownerUidAllowlist.forEach((uid) => {
      if (seenUids.has(uid)) {
        return;
      }
      records.push(
        buildAdminRoleRecord(uid, {
          uid,
        })
      );
    });

    return records;
  }

  function buildAdminRoleRecord(uid, playerRecord) {
    if (typeof uid !== "string" || !uid.trim()) {
      return null;
    }
    const record = playerRecord && typeof playerRecord === "object" ? playerRecord : {};
    const normalizedUid = uid.trim();
    const roleInfo = resolveAdminRoleForIdentity(normalizedUid, record.email);
    return {
      uid: normalizedUid,
      displayName: typeof record.displayName === "string" ? record.displayName : undefined,
      email: typeof record.email === "string" ? record.email : undefined,
      photoUrl: typeof record.photoUrl === "string" ? record.photoUrl : undefined,
      provider: typeof record.provider === "string" ? record.provider : undefined,
      providerId: typeof record.providerId === "string" ? record.providerId : undefined,
      role: roleInfo.role,
      source: roleInfo.source,
      updatedAt: Number.isFinite(record.updatedAt) ? Math.floor(record.updatedAt) : undefined,
      roleUpdatedAt: Number.isFinite(record.adminRoleUpdatedAt)
        ? Math.floor(record.adminRoleUpdatedAt)
        : undefined,
      roleUpdatedBy:
        typeof record.adminRoleUpdatedBy === "string" ? record.adminRoleUpdatedBy : undefined,
    };
  }

  return {
    normalizeAdminRole,
    hasRequiredAdminRole,
    resolveAdminRoleForIdentity,
    isBootstrapOwnerUid,
    hasBootstrapAdminOwnersConfigured,
    parseAdminRoomLimit,
    parseAdminAuditLimit,
    parseAdminConductLimit,
    parseAdminModerationTermLimit,
    buildAdminPrincipal,
    collectAdminAuditEntries,
    recordAdminAuditEvent,
    collectAdminRoleRecords,
    buildAdminRoleRecord,
  };
}

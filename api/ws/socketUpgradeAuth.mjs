export function createSocketUpgradeAuthenticator({
  getSession,
  rehydrateStoreFromAdapter,
  verifyAccessToken,
  isPlayerBannedFromSession,
  isBotParticipant,
  markSessionActivity,
  persistStore,
  sessionUpgradeGraceMs,
  now = () => Date.now(),
  log = null,
}) {
  return async function authenticateSocketUpgrade(requestUrl) {
    const sessionId = requestUrl.searchParams.get("session")?.trim() ?? "";
    const playerId = requestUrl.searchParams.get("playerId")?.trim() ?? "";
    const token = requestUrl.searchParams.get("token")?.trim() ?? "";

    if (!sessionId || !playerId || !token) {
      return { ok: false, status: 401, reason: "Unauthorized" };
    }

    let session = getSession(sessionId);
    if (!session || session.expiresAt <= now()) {
      await rehydrateStoreFromAdapter(`ws_upgrade_session:${sessionId}`, { force: true });
      session = getSession(sessionId);
    }
    if (!session) {
      return { ok: false, status: 410, reason: "Gone" };
    }

    const currentNow = now();
    const sessionExpiresAt =
      typeof session.expiresAt === "number" && Number.isFinite(session.expiresAt)
        ? Math.floor(session.expiresAt)
        : 0;
    const sessionExpired = sessionExpiresAt <= currentNow;
    const sessionExpiredBeyondGrace =
      sessionExpired &&
      (sessionExpiresAt <= 0 || currentNow - sessionExpiresAt > sessionUpgradeGraceMs);
    if (sessionExpiredBeyondGrace) {
      return { ok: false, status: 410, reason: "Gone" };
    }

    if (isPlayerBannedFromSession(session, playerId)) {
      return { ok: false, status: 403, reason: "Forbidden" };
    }

    if (!session.participants[playerId]) {
      await rehydrateStoreFromAdapter(`ws_upgrade_participant:${sessionId}:${playerId}`, { force: true });
      session = getSession(sessionId);
    }
    if (!session || !session.participants[playerId]) {
      return { ok: false, status: 403, reason: "Forbidden" };
    }

    let accessRecord = verifyAccessToken(token);
    if (!accessRecord) {
      await rehydrateStoreFromAdapter(`ws_upgrade_token:${sessionId}:${playerId}`, { force: true });
      accessRecord = verifyAccessToken(token);
    }
    if (!accessRecord) {
      return { ok: false, status: 401, reason: "Unauthorized" };
    }

    if (accessRecord.playerId !== playerId || accessRecord.sessionId !== sessionId) {
      return { ok: false, status: 403, reason: "Forbidden" };
    }

    if (sessionExpired) {
      const participant = session.participants[playerId];
      if (participant && !isBotParticipant(participant)) {
        participant.lastHeartbeatAt = currentNow;
      }
      markSessionActivity(session, playerId, currentNow, { countAsPlayerAction: false });
      persistStore().catch((error) => {
        log?.warn?.("Failed to persist revived session during WebSocket upgrade", error);
      });
    }

    return {
      ok: true,
      sessionId,
      playerId,
      tokenExpiresAt: accessRecord.expiresAt,
    };
  };
}

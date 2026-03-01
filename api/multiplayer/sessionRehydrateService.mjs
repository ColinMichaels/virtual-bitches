function requireFunction(name, value) {
  if (typeof value !== "function") {
    throw new Error(`Missing multiplayer session rehydrate dependency: ${name}`);
  }
  return value;
}

export function createSessionRehydrateService({
  getStore,
  rehydrateStoreFromAdapter,
  sleep = (durationMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, durationMs);
    }),
}) {
  const getStoreImpl = requireFunction("getStore", getStore);
  const rehydrateStoreFromAdapterImpl = requireFunction(
    "rehydrateStoreFromAdapter",
    rehydrateStoreFromAdapter
  );
  const sleepImpl = requireFunction("sleep", sleep);

  async function delayMs(durationMs) {
    const delay = Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 0;
    if (delay <= 0) {
      return;
    }
    await sleepImpl(delay);
  }

  async function rehydrateSessionWithRetry(sessionId, reasonPrefix, options = {}) {
    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!normalizedSessionId) {
      return null;
    }

    const attempts = Number.isFinite(options.attempts)
      ? Math.max(1, Math.floor(options.attempts))
      : 3;
    const baseDelayMs = Number.isFinite(options.baseDelayMs)
      ? Math.max(0, Math.floor(options.baseDelayMs))
      : 100;

    let session = getStoreImpl().multiplayerSessions[normalizedSessionId] ?? null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (session) {
        return session;
      }
      if (attempt > 0 && baseDelayMs > 0) {
        await delayMs(baseDelayMs * attempt);
      }
      await rehydrateStoreFromAdapterImpl(`${reasonPrefix}:${normalizedSessionId}:attempt_${attempt + 1}`, {
        force: true,
      });
      session = getStoreImpl().multiplayerSessions[normalizedSessionId] ?? null;
    }

    return session;
  }

  async function rehydrateSessionParticipantWithRetry(sessionId, playerId, reasonPrefix, options = {}) {
    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    const normalizedPlayerId = typeof playerId === "string" ? playerId.trim() : "";
    if (!normalizedSessionId || !normalizedPlayerId) {
      return {
        session: null,
        participant: null,
      };
    }

    const attempts = Number.isFinite(options.attempts)
      ? Math.max(1, Math.floor(options.attempts))
      : 3;
    const baseDelayMs = Number.isFinite(options.baseDelayMs)
      ? Math.max(0, Math.floor(options.baseDelayMs))
      : 100;

    let session = getStoreImpl().multiplayerSessions[normalizedSessionId] ?? null;
    let participant = session?.participants?.[normalizedPlayerId] ?? null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (session && participant) {
        return {
          session,
          participant,
        };
      }
      if (attempt > 0 && baseDelayMs > 0) {
        await delayMs(baseDelayMs * attempt);
      }
      await rehydrateStoreFromAdapterImpl(
        `${reasonPrefix}:${normalizedSessionId}:${normalizedPlayerId}:attempt_${attempt + 1}`,
        { force: true }
      );
      session = getStoreImpl().multiplayerSessions[normalizedSessionId] ?? null;
      participant = session?.participants?.[normalizedPlayerId] ?? null;
    }

    return {
      session,
      participant,
    };
  }

  return {
    rehydrateSessionWithRetry,
    rehydrateSessionParticipantWithRetry,
  };
}

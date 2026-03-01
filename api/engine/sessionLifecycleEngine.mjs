const DEFAULT_TURN_PHASES = Object.freeze({
  awaitRoll: "await_roll",
  awaitScore: "await_score",
  readyToEnd: "ready_to_end",
});
const DEFAULT_PARTICIPANT_DICE_COUNT = 15;
const DEFAULT_NEXT_GAME_AUTO_START_DELAY_MS = 60 * 1000;
const DEFAULT_POST_GAME_INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;

function requireDependency(dependencies, key) {
  const value = dependencies?.[key];
  if (typeof value !== "function") {
    throw new Error(`Missing session lifecycle engine dependency: ${key}`);
  }
  return value;
}

function resolveTurnPhases(value) {
  const candidate = value && typeof value === "object" ? value : DEFAULT_TURN_PHASES;
  return Object.freeze({
    awaitRoll:
      typeof candidate.awaitRoll === "string" && candidate.awaitRoll.trim().length > 0
        ? candidate.awaitRoll
        : DEFAULT_TURN_PHASES.awaitRoll,
    awaitScore:
      typeof candidate.awaitScore === "string" && candidate.awaitScore.trim().length > 0
        ? candidate.awaitScore
        : DEFAULT_TURN_PHASES.awaitScore,
    readyToEnd:
      typeof candidate.readyToEnd === "string" && candidate.readyToEnd.trim().length > 0
        ? candidate.readyToEnd
        : DEFAULT_TURN_PHASES.readyToEnd,
  });
}

function resolvePositiveInt(value, fallback, minimum = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(parsed));
}

function resolveNowProvider(value) {
  return typeof value === "function" ? value : () => Date.now();
}

export function createSessionLifecycleEngine(dependencies = {}) {
  const turnPhases = resolveTurnPhases(dependencies.turnPhases);
  const defaultParticipantDiceCount = resolvePositiveInt(
    dependencies.defaultParticipantDiceCount,
    DEFAULT_PARTICIPANT_DICE_COUNT
  );
  const nextGameAutoStartDelayMs = resolvePositiveInt(
    dependencies.nextGameAutoStartDelayMs,
    DEFAULT_NEXT_GAME_AUTO_START_DELAY_MS
  );
  const postGameInactivityTimeoutMs = resolvePositiveInt(
    dependencies.postGameInactivityTimeoutMs,
    DEFAULT_POST_GAME_INACTIVITY_TIMEOUT_MS
  );
  const now = resolveNowProvider(dependencies.now);

  const normalizeTurnPhase = requireDependency(dependencies, "normalizeTurnPhase");
  const isParticipantActiveForCurrentGame = requireDependency(
    dependencies,
    "isParticipantActiveForCurrentGame"
  );
  const normalizeParticipantScore = requireDependency(dependencies, "normalizeParticipantScore");
  const normalizeParticipantRemainingDice = requireDependency(
    dependencies,
    "normalizeParticipantRemainingDice"
  );
  const isParticipantComplete = requireDependency(dependencies, "isParticipantComplete");
  const isParticipantQueuedForNextGame = requireDependency(
    dependencies,
    "isParticipantQueuedForNextGame"
  );
  const normalizeParticipantCompletedAt = requireDependency(
    dependencies,
    "normalizeParticipantCompletedAt"
  );
  const isBotParticipant = requireDependency(dependencies, "isBotParticipant");
  const ensureSessionTurnState = requireDependency(dependencies, "ensureSessionTurnState");
  const markSessionActivity = requireDependency(dependencies, "markSessionActivity");
  const resolveSessionNextGameStartsAt = requireDependency(
    dependencies,
    "resolveSessionNextGameStartsAt"
  );

  function isSessionGameInProgress(session) {
    if (!session || typeof session !== "object") {
      return false;
    }

    const turnState = session.turnState ?? null;
    const phase = normalizeTurnPhase(turnState?.phase);
    const round =
      Number.isFinite(turnState?.round) && turnState.round > 0
        ? Math.floor(turnState.round)
        : 1;
    const turnNumber =
      Number.isFinite(turnState?.turnNumber) && turnState.turnNumber > 0
        ? Math.floor(turnState.turnNumber)
        : 1;

    if (phase !== turnPhases.awaitRoll) {
      return true;
    }
    if (round > 1 || turnNumber > 1) {
      return true;
    }

    return Object.values(session.participants ?? {}).some((participant) => {
      if (
        !participant ||
        typeof participant !== "object" ||
        !isParticipantActiveForCurrentGame(participant)
      ) {
        return false;
      }
      return (
        normalizeParticipantScore(participant.score) > 0 ||
        normalizeParticipantRemainingDice(participant.remainingDice) < defaultParticipantDiceCount ||
        isParticipantComplete(participant)
      );
    });
  }

  function shouldQueueParticipantForNextGame(session) {
    return isSessionGameInProgress(session);
  }

  function hasQueuedParticipantsForNextGame(session) {
    if (!session?.participants) {
      return false;
    }
    return Object.values(session.participants).some((participant) =>
      isParticipantQueuedForNextGame(participant)
    );
  }

  function areCurrentGameParticipantsComplete(session) {
    if (!session?.participants) {
      return false;
    }

    const activeParticipants = Object.values(session.participants).filter(
      (participant) => participant && isParticipantActiveForCurrentGame(participant)
    );
    if (activeParticipants.length === 0) {
      return hasQueuedParticipantsForNextGame(session);
    }

    return activeParticipants.every((participant) => isParticipantComplete(participant));
  }

  function normalizePostGameTimestamp(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    return Math.floor(value);
  }

  function clearSessionPostGameLifecycleState(session) {
    if (!session || typeof session !== "object") {
      return false;
    }
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(session, "nextGameStartsAt")) {
      delete session.nextGameStartsAt;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(session, "postGameActivityAt")) {
      delete session.postGameActivityAt;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(session, "postGameIdleExpiresAt")) {
      delete session.postGameIdleExpiresAt;
      changed = true;
    }
    return changed;
  }

  function scheduleSessionPostGameLifecycle(session, timestamp = now()) {
    if (!areCurrentGameParticipantsComplete(session)) {
      return false;
    }

    const completedAt =
      Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : now();
    const currentNextGameStartsAt = normalizePostGameTimestamp(session?.nextGameStartsAt);
    const nextGameStartsAt =
      currentNextGameStartsAt !== null
        ? currentNextGameStartsAt
        : completedAt + nextGameAutoStartDelayMs;
    const postGameIdleFloor = nextGameStartsAt + 1000;
    const currentPostGameActivityAt = normalizePostGameTimestamp(session?.postGameActivityAt);
    const postGameActivityAt =
      currentPostGameActivityAt !== null ? currentPostGameActivityAt : completedAt;
    const currentPostGameIdleExpiresAt = normalizePostGameTimestamp(session?.postGameIdleExpiresAt);
    const postGameIdleCandidate =
      currentPostGameIdleExpiresAt !== null
        ? currentPostGameIdleExpiresAt
        : postGameActivityAt + postGameInactivityTimeoutMs;
    const postGameIdleExpiresAt = Math.max(postGameIdleCandidate, postGameIdleFloor);

    let changed = false;
    if (normalizePostGameTimestamp(session.nextGameStartsAt) !== nextGameStartsAt) {
      session.nextGameStartsAt = nextGameStartsAt;
      changed = true;
    }
    if (normalizePostGameTimestamp(session.postGameActivityAt) !== postGameActivityAt) {
      session.postGameActivityAt = postGameActivityAt;
      changed = true;
    }
    if (normalizePostGameTimestamp(session.postGameIdleExpiresAt) !== postGameIdleExpiresAt) {
      session.postGameIdleExpiresAt = postGameIdleExpiresAt;
      changed = true;
    }
    return changed;
  }

  function markSessionPostGamePlayerAction(session, timestamp = now()) {
    if (!areCurrentGameParticipantsComplete(session)) {
      return false;
    }
    const actionAt = Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : now();
    const nextGameStartsAt = resolveSessionNextGameStartsAt(session, actionAt);
    const postGameIdleFloor = nextGameStartsAt + 1000;
    const postGameIdleExpiresAt = Math.max(actionAt + postGameInactivityTimeoutMs, postGameIdleFloor);
    let changed = false;
    if (normalizePostGameTimestamp(session.postGameActivityAt) !== actionAt) {
      session.postGameActivityAt = actionAt;
      changed = true;
    }
    if (normalizePostGameTimestamp(session.postGameIdleExpiresAt) !== postGameIdleExpiresAt) {
      session.postGameIdleExpiresAt = postGameIdleExpiresAt;
      changed = true;
    }
    return changed;
  }

  function resetSessionForNextGame(session, timestamp = now()) {
    if (!session?.participants) {
      return false;
    }

    const restartAt = Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : now();
    let changed = false;

    Object.values(session.participants).forEach((participant) => {
      if (!participant || typeof participant !== "object") {
        return;
      }
      if (isParticipantQueuedForNextGame(participant)) {
        changed = true;
      }
      if (
        normalizeParticipantScore(participant.score) !== 0 ||
        normalizeParticipantRemainingDice(participant.remainingDice) !==
          defaultParticipantDiceCount ||
        participant.isComplete === true ||
        normalizeParticipantCompletedAt(participant.completedAt) !== null
      ) {
        changed = true;
      }

      participant.score = 0;
      participant.remainingDice = defaultParticipantDiceCount;
      participant.turnTimeoutRound = null;
      participant.turnTimeoutCount = 0;
      participant.queuedForNextGame = false;
      participant.isComplete = false;
      participant.completedAt = null;
      if (isBotParticipant(participant)) {
        participant.isReady = true;
      }
    });

    if (clearSessionPostGameLifecycleState(session)) {
      changed = true;
    }
    if (!changed) {
      return false;
    }

    session.gameStartedAt = restartAt;
    session.turnState = null;
    ensureSessionTurnState(session);
    markSessionActivity(session, "", restartAt);
    return true;
  }

  function completeSessionRoundWithWinner(session, winnerPlayerId, timestamp = now()) {
    if (!session?.participants || typeof winnerPlayerId !== "string" || !winnerPlayerId) {
      return { ok: false };
    }

    const winner = session.participants[winnerPlayerId];
    if (!winner || !isParticipantActiveForCurrentGame(winner)) {
      return { ok: false };
    }

    const completedAt =
      Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : now();
    winner.isComplete = true;
    winner.remainingDice = 0;
    winner.completedAt = normalizeParticipantCompletedAt(winner.completedAt) ?? completedAt;

    let completionCursor = completedAt + 1;
    Object.entries(session.participants).forEach(([playerId, participant]) => {
      if (
        playerId === winnerPlayerId ||
        !participant ||
        typeof participant !== "object" ||
        !isParticipantActiveForCurrentGame(participant)
      ) {
        return;
      }

      if (participant.isComplete !== true) {
        participant.isComplete = true;
      }
      if (normalizeParticipantCompletedAt(participant.completedAt) === null) {
        participant.completedAt = completionCursor;
        completionCursor += 1;
      }
    });

    const turnState = ensureSessionTurnState(session);
    if (turnState) {
      turnState.activeTurnPlayerId = null;
      turnState.order = turnState.order.filter((playerId) => {
        const participant = session.participants?.[playerId];
        return Boolean(participant) && isParticipantActiveForCurrentGame(participant);
      });
      turnState.phase = turnPhases.awaitRoll;
      turnState.lastRollSnapshot = null;
      turnState.lastScoreSummary = null;
      turnState.turnExpiresAt = null;
      turnState.updatedAt = completedAt;
    }

    scheduleSessionPostGameLifecycle(session, completedAt);
    return {
      ok: true,
    };
  }

  return Object.freeze({
    isSessionGameInProgress,
    shouldQueueParticipantForNextGame,
    hasQueuedParticipantsForNextGame,
    areCurrentGameParticipantsComplete,
    normalizePostGameTimestamp,
    clearSessionPostGameLifecycleState,
    scheduleSessionPostGameLifecycle,
    markSessionPostGamePlayerAction,
    resetSessionForNextGame,
    completeSessionRoundWithWinner,
  });
}

const DEFAULT_TURN_PHASES = Object.freeze({
  awaitRoll: "await_roll",
  awaitScore: "await_score",
  readyToEnd: "ready_to_end",
});
const DEFAULT_PARTICIPANT_DICE_COUNT = 15;

function requireDependency(dependencies, key) {
  const value = dependencies?.[key];
  if (typeof value !== "function") {
    throw new Error(`Missing session turn engine dependency: ${key}`);
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

function resolveDefaultParticipantDiceCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PARTICIPANT_DICE_COUNT;
  }
  return Math.max(1, Math.floor(parsed));
}

function resolveNowProvider(value) {
  return typeof value === "function" ? value : () => Date.now();
}

export function createSessionTurnEngine(dependencies = {}) {
  const turnPhases = resolveTurnPhases(dependencies.turnPhases);
  const defaultParticipantDiceCount = resolveDefaultParticipantDiceCount(
    dependencies.defaultParticipantDiceCount
  );
  const now = resolveNowProvider(dependencies.now);

  const normalizeTurnPhase = requireDependency(dependencies, "normalizeTurnPhase");
  const normalizeTurnRollSnapshot = requireDependency(dependencies, "normalizeTurnRollSnapshot");
  const normalizeTurnScoreSummary = requireDependency(dependencies, "normalizeTurnScoreSummary");
  const serializeParticipantsInJoinOrder = requireDependency(
    dependencies,
    "serializeParticipantsInJoinOrder"
  );
  const getActiveHumanParticipants = requireDependency(dependencies, "getActiveHumanParticipants");
  const areAllHumansReady = requireDependency(dependencies, "areAllHumansReady");
  const isBotParticipant = requireDependency(dependencies, "isBotParticipant");
  const isParticipantActiveForCurrentGame = requireDependency(
    dependencies,
    "isParticipantActiveForCurrentGame"
  );
  const isSessionDemoAutoRunEnabled = requireDependency(
    dependencies,
    "isSessionDemoAutoRunEnabled"
  );
  const resolveSessionTurnTimeoutMs = requireDependency(
    dependencies,
    "resolveSessionTurnTimeoutMs"
  );
  const serializeTurnRollSnapshot = requireDependency(dependencies, "serializeTurnRollSnapshot");
  const resolveSessionGameStartedAt = requireDependency(
    dependencies,
    "resolveSessionGameStartedAt"
  );
  const isParticipantComplete = requireDependency(dependencies, "isParticipantComplete");
  const scheduleSessionPostGameLifecycle = requireDependency(
    dependencies,
    "scheduleSessionPostGameLifecycle"
  );
  const normalizeParticipantScore = requireDependency(dependencies, "normalizeParticipantScore");
  const normalizeParticipantRemainingDice = requireDependency(
    dependencies,
    "normalizeParticipantRemainingDice"
  );
  const normalizeParticipantCompletedAt = requireDependency(
    dependencies,
    "normalizeParticipantCompletedAt"
  );

  function ensureSessionTurnState(session) {
    if (!session) {
      return null;
    }

    const currentState = session.turnState ?? null;
    const currentActiveTurnPlayerId =
      typeof currentState?.activeTurnPlayerId === "string"
        ? currentState.activeTurnPlayerId
        : null;
    const keepCompletedActivePlayer =
      normalizeTurnPhase(currentState?.phase) === turnPhases.readyToEnd &&
      typeof currentActiveTurnPlayerId === "string" &&
      currentActiveTurnPlayerId.length > 0;

    const orderedParticipants = serializeParticipantsInJoinOrder(session).filter(
      (participant) =>
        participant &&
        participant.isSeated === true &&
        !participant.isComplete &&
        participant.queuedForNextGame !== true &&
        (!keepCompletedActivePlayer || participant.playerId !== currentActiveTurnPlayerId)
    );
    if (keepCompletedActivePlayer) {
      const activeParticipant = session.participants?.[currentActiveTurnPlayerId];
      if (activeParticipant && isParticipantActiveForCurrentGame(activeParticipant)) {
        orderedParticipants.push({
          playerId: currentActiveTurnPlayerId,
          isSeated: true,
          isComplete: false,
          joinedAt:
            typeof activeParticipant.joinedAt === "number" &&
            Number.isFinite(activeParticipant.joinedAt)
              ? activeParticipant.joinedAt
              : 0,
        });
        orderedParticipants.sort((left, right) => {
          const joinedDelta = left.joinedAt - right.joinedAt;
          if (joinedDelta !== 0) {
            return joinedDelta;
          }
          return left.playerId.localeCompare(right.playerId);
        });
      }
    }

    const participantIds = orderedParticipants.map((participant) => participant.playerId);
    const participantIdSet = new Set(participantIds);
    const nextOrder = [];

    if (Array.isArray(currentState?.order)) {
      currentState.order.forEach((playerId) => {
        if (participantIdSet.has(playerId) && !nextOrder.includes(playerId)) {
          nextOrder.push(playerId);
        }
      });
    }

    participantIds.forEach((playerId) => {
      if (!nextOrder.includes(playerId)) {
        nextOrder.push(playerId);
      }
    });

    const activeHumanParticipants = getActiveHumanParticipants(session);
    const hasActiveHumanParticipant = activeHumanParticipants.length > 0;
    const allHumansReady = hasActiveHumanParticipant ? areAllHumansReady(session) : false;
    const hasBotParticipant = participantIds.some((playerId) =>
      isBotParticipant(session?.participants?.[playerId])
    );
    const demoBotAutoplayReady =
      isSessionDemoAutoRunEnabled(session) && !hasActiveHumanParticipant && hasBotParticipant;
    const turnFlowReady = demoBotAutoplayReady || (hasActiveHumanParticipant && allHumansReady);
    const timestamp = now();
    let activeTurnPlayerId =
      typeof currentState?.activeTurnPlayerId === "string"
        ? currentState.activeTurnPlayerId
        : null;
    let activeTurnRecovered = false;
    if (!turnFlowReady || participantIds.length === 0) {
      activeTurnPlayerId = null;
    } else if (!activeTurnPlayerId || !nextOrder.includes(activeTurnPlayerId)) {
      activeTurnPlayerId = nextOrder[0] ?? null;
      activeTurnRecovered = true;
    }

    const round =
      typeof currentState?.round === "number" &&
      Number.isFinite(currentState.round) &&
      currentState.round > 0
        ? Math.floor(currentState.round)
        : 1;
    const turnNumber =
      typeof currentState?.turnNumber === "number" &&
      Number.isFinite(currentState.turnNumber) &&
      currentState.turnNumber > 0
        ? Math.floor(currentState.turnNumber)
        : 1;
    const turnTimeoutMs = resolveSessionTurnTimeoutMs(session);
    let phase = normalizeTurnPhase(currentState?.phase);
    let lastRollSnapshot = normalizeTurnRollSnapshot(currentState?.lastRollSnapshot);
    let lastScoreSummary = normalizeTurnScoreSummary(currentState?.lastScoreSummary);
    let turnExpiresAt =
      typeof currentState?.turnExpiresAt === "number" &&
      Number.isFinite(currentState.turnExpiresAt) &&
      currentState.turnExpiresAt > 0
        ? Math.floor(currentState.turnExpiresAt)
        : null;

    if (!turnFlowReady || nextOrder.length === 0) {
      phase = turnPhases.awaitRoll;
      lastRollSnapshot = null;
      lastScoreSummary = null;
      turnExpiresAt = null;
    } else if (activeTurnRecovered) {
      phase = turnPhases.awaitRoll;
      lastRollSnapshot = null;
      lastScoreSummary = null;
      turnExpiresAt = timestamp + turnTimeoutMs;
    } else if (phase === turnPhases.awaitRoll) {
      lastRollSnapshot = null;
      lastScoreSummary = null;
    } else if (phase === turnPhases.awaitScore && !lastRollSnapshot) {
      phase = turnPhases.awaitRoll;
      lastScoreSummary = null;
    } else if (phase === turnPhases.readyToEnd) {
      if (!lastRollSnapshot) {
        phase = turnPhases.awaitRoll;
        lastScoreSummary = null;
      } else if (!lastScoreSummary) {
        phase = turnPhases.awaitScore;
      } else if (lastScoreSummary.rollServerId !== lastRollSnapshot.serverRollId) {
        phase = turnPhases.awaitScore;
        lastScoreSummary = null;
      }
    }

    if (turnFlowReady && nextOrder.length > 0 && activeTurnPlayerId && !turnExpiresAt) {
      turnExpiresAt = timestamp + turnTimeoutMs;
    } else if (!turnFlowReady || !activeTurnPlayerId || nextOrder.length === 0) {
      turnExpiresAt = null;
    }

    session.turnState = {
      order: nextOrder,
      activeTurnPlayerId,
      round,
      turnNumber,
      phase,
      lastRollSnapshot,
      lastScoreSummary,
      turnTimeoutMs,
      turnExpiresAt,
      updatedAt: timestamp,
    };

    if (turnFlowReady && !session.turnState.activeTurnPlayerId && session.turnState.order.length > 0) {
      session.turnState.activeTurnPlayerId = session.turnState.order[0];
    }

    return session.turnState;
  }

  function buildTurnStartMessage(session, options = {}) {
    const turnState = ensureSessionTurnState(session);
    if (!turnState?.activeTurnPlayerId) {
      return null;
    }
    const timestamp = now();

    const activeRoll = serializeTurnRollSnapshot(turnState.lastRollSnapshot);
    const turnTimeoutMs = resolveSessionTurnTimeoutMs(session, turnState.turnTimeoutMs);
    const turnExpiresAt =
      typeof turnState.turnExpiresAt === "number" &&
      Number.isFinite(turnState.turnExpiresAt) &&
      turnState.turnExpiresAt > 0
        ? Math.floor(turnState.turnExpiresAt)
        : null;

    return {
      type: "turn_start",
      sessionId: session.sessionId,
      playerId: turnState.activeTurnPlayerId,
      round: turnState.round,
      turnNumber: turnState.turnNumber,
      phase: normalizeTurnPhase(turnState.phase),
      activeRoll,
      activeRollServerId:
        typeof activeRoll?.serverRollId === "string" ? activeRoll.serverRollId : null,
      gameStartedAt: resolveSessionGameStartedAt(session, timestamp),
      turnExpiresAt,
      turnTimeoutMs,
      timestamp,
      order: [...turnState.order],
      source: options.source ?? "server",
    };
  }

  function buildTurnEndMessage(session, playerId, options = {}) {
    const turnState = ensureSessionTurnState(session);
    if (!turnState) {
      return null;
    }

    return {
      type: "turn_end",
      sessionId: session.sessionId,
      playerId,
      round: turnState.round,
      turnNumber: turnState.turnNumber,
      timestamp: now(),
      source: options.source ?? "player",
    };
  }

  function buildTurnActionMessage(session, playerId, action, details = {}, options = {}) {
    const turnState = ensureSessionTurnState(session);
    if (!turnState) {
      return null;
    }

    return {
      type: "turn_action",
      sessionId: session.sessionId,
      playerId,
      action,
      ...(details.roll ? { roll: details.roll } : {}),
      ...(details.score ? { score: details.score } : {}),
      ...(details.select ? { select: details.select } : {}),
      round: turnState.round,
      turnNumber: turnState.turnNumber,
      phase: normalizeTurnPhase(turnState.phase),
      timestamp: now(),
      source: options.source ?? "player",
    };
  }

  function advanceSessionTurn(session, endedByPlayerId, options = {}) {
    const turnState = ensureSessionTurnState(session);
    if (!turnState || turnState.order.length === 0 || !turnState.activeTurnPlayerId) {
      return null;
    }

    if (turnState.activeTurnPlayerId !== endedByPlayerId) {
      return null;
    }

    const currentIndex = turnState.order.indexOf(endedByPlayerId);
    if (currentIndex < 0) {
      return null;
    }

    const timestamp = now();
    const turnEnd = {
      type: "turn_end",
      sessionId: session.sessionId,
      playerId: endedByPlayerId,
      round: turnState.round,
      turnNumber: turnState.turnNumber,
      timestamp,
      source: options.source ?? "player",
    };

    const timeoutMs = resolveSessionTurnTimeoutMs(session, turnState.turnTimeoutMs);
    const nextOrder = turnState.order.filter((playerId) => {
      const participant = session.participants?.[playerId];
      return Boolean(participant) && !isParticipantComplete(participant);
    });

    let nextActivePlayerId = null;
    let wrapped = false;
    for (let offset = 1; offset <= turnState.order.length; offset += 1) {
      const candidateIndex = (currentIndex + offset) % turnState.order.length;
      const candidatePlayerId = turnState.order[candidateIndex];
      const participant = session.participants?.[candidatePlayerId];
      if (!participant || isParticipantComplete(participant)) {
        continue;
      }
      nextActivePlayerId = candidatePlayerId;
      wrapped = candidateIndex <= currentIndex;
      break;
    }

    turnState.order = nextOrder;
    turnState.activeTurnPlayerId = nextActivePlayerId;
    if (nextActivePlayerId) {
      turnState.turnNumber = Math.max(1, Math.floor(turnState.turnNumber) + 1);
      if (wrapped) {
        turnState.round = Math.max(1, Math.floor(turnState.round) + 1);
      }
    }
    turnState.phase = turnPhases.awaitRoll;
    turnState.lastRollSnapshot = null;
    turnState.lastScoreSummary = null;
    turnState.turnTimeoutMs = timeoutMs;
    turnState.turnExpiresAt = nextActivePlayerId ? timestamp + timeoutMs : null;
    turnState.updatedAt = timestamp;

    if (!nextActivePlayerId) {
      scheduleSessionPostGameLifecycle(session, timestamp);
    }
    const turnStart = nextActivePlayerId
      ? {
          type: "turn_start",
          sessionId: session.sessionId,
          playerId: turnState.activeTurnPlayerId,
          round: turnState.round,
          turnNumber: turnState.turnNumber,
          phase: normalizeTurnPhase(turnState.phase),
          gameStartedAt: resolveSessionGameStartedAt(session, timestamp),
          turnExpiresAt: turnState.turnExpiresAt,
          turnTimeoutMs: timeoutMs,
          timestamp,
          order: [...turnState.order],
          source: options.source ?? "player",
        }
      : null;

    return {
      turnEnd,
      turnStart,
    };
  }

  function applyParticipantScoreUpdate(participant, scoreSummary, rollDiceCount) {
    const safeRollDiceCount =
      Number.isFinite(rollDiceCount) && rollDiceCount > 0 ? Math.floor(rollDiceCount) : 0;
    const currentScore = normalizeParticipantScore(participant?.score);
    const points = Number.isFinite(scoreSummary?.points)
      ? Math.max(0, Math.floor(scoreSummary.points))
      : 0;
    const selectedDiceCount = Array.isArray(scoreSummary?.selectedDiceIds)
      ? scoreSummary.selectedDiceIds.length
      : 0;
    const currentRemainingDice = normalizeParticipantRemainingDice(
      participant?.remainingDice,
      safeRollDiceCount || defaultParticipantDiceCount
    );
    const remainingBase =
      safeRollDiceCount > 0 ? Math.max(currentRemainingDice, safeRollDiceCount) : currentRemainingDice;
    const nextRemainingDice = Math.max(0, remainingBase - selectedDiceCount);
    const didComplete = nextRemainingDice === 0;
    const completedAt = didComplete ? normalizeParticipantCompletedAt(participant?.completedAt) ?? now() : null;
    const nextScore = currentScore + points;

    if (participant) {
      participant.score = nextScore;
      participant.remainingDice = nextRemainingDice;
      participant.isComplete = didComplete;
      participant.completedAt = completedAt;
    }

    return {
      nextScore,
      nextRemainingDice,
      didComplete,
      completedAt,
    };
  }

  return Object.freeze({
    ensureSessionTurnState,
    buildTurnStartMessage,
    buildTurnEndMessage,
    buildTurnActionMessage,
    advanceSessionTurn,
    applyParticipantScoreUpdate,
  });
}

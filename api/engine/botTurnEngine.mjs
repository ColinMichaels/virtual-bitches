const DEFAULT_TURN_PHASES = Object.freeze({
  awaitRoll: "await_roll",
  awaitScore: "await_score",
  readyToEnd: "ready_to_end",
});

function requireFunction(dependencies, key) {
  const value = dependencies?.[key];
  if (typeof value !== "function") {
    throw new Error(`Missing bot turn engine dependency: ${key}`);
  }
  return value;
}

function requireBotEngine(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.buildTurnRollPayload !== "function" ||
    typeof value.buildTurnScoreSummary !== "function"
  ) {
    throw new Error(
      "Missing bot turn engine dependency: botEngine with buildTurnRollPayload/buildTurnScoreSummary"
    );
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

function resolveNowProvider(value) {
  return typeof value === "function" ? value : () => Date.now();
}

export function createBotTurnEngine(dependencies = {}) {
  const turnPhases = resolveTurnPhases(dependencies.turnPhases);
  const botEngine = requireBotEngine(dependencies.botEngine);
  const now = resolveNowProvider(dependencies.now);

  const normalizeTurnPhase = requireFunction(dependencies, "normalizeTurnPhase");
  const ensureSessionTurnState = requireFunction(dependencies, "ensureSessionTurnState");
  const isBotParticipant = requireFunction(dependencies, "isBotParticipant");
  const resolveSessionGameDifficulty = requireFunction(
    dependencies,
    "resolveSessionGameDifficulty"
  );
  const isParticipantComplete = requireFunction(dependencies, "isParticipantComplete");
  const normalizeParticipantCompletedAt = requireFunction(
    dependencies,
    "normalizeParticipantCompletedAt"
  );
  const advanceSessionTurn = requireFunction(dependencies, "advanceSessionTurn");
  const normalizeParticipantRemainingDice = requireFunction(
    dependencies,
    "normalizeParticipantRemainingDice"
  );
  const parseTurnRollPayload = requireFunction(dependencies, "parseTurnRollPayload");
  const buildTurnActionMessage = requireFunction(dependencies, "buildTurnActionMessage");
  const applyParticipantScoreUpdate = requireFunction(
    dependencies,
    "applyParticipantScoreUpdate"
  );

  function executeBotTurn(session, activePlayerId) {
    const turnState = ensureSessionTurnState(session);
    if (!turnState || turnState.activeTurnPlayerId !== activePlayerId) {
      return null;
    }

    const participant = session.participants?.[activePlayerId];
    if (!isBotParticipant(participant)) {
      return null;
    }
    const gameDifficulty = resolveSessionGameDifficulty(session);
    participant.lastHeartbeatAt = now();

    if (isParticipantComplete(participant)) {
      participant.isComplete = true;
      participant.completedAt = normalizeParticipantCompletedAt(participant.completedAt) ?? now();
      const advanced = advanceSessionTurn(session, activePlayerId, {
        source: "bot_auto",
      });
      return advanced
        ? {
            rollAction: null,
            scoreAction: null,
            turnEnd: advanced.turnEnd,
            turnStart: advanced.turnStart,
          }
        : null;
    }

    if (normalizeTurnPhase(turnState.phase) !== turnPhases.awaitRoll) {
      turnState.phase = turnPhases.awaitRoll;
      turnState.lastRollSnapshot = null;
      turnState.lastScoreSummary = null;
      turnState.updatedAt = now();
    }

    const remainingDice = normalizeParticipantRemainingDice(participant.remainingDice);
    const rollPayload = botEngine.buildTurnRollPayload({
      playerId: activePlayerId,
      turnNumber: turnState.turnNumber,
      remainingDice,
    });
    if (!rollPayload) {
      return null;
    }
    const parsedRoll = parseTurnRollPayload({ roll: rollPayload });
    if (!parsedRoll.ok) {
      return null;
    }

    turnState.lastRollSnapshot = parsedRoll.value;
    turnState.lastScoreSummary = null;
    turnState.phase = turnPhases.awaitScore;
    turnState.updatedAt = now();

    const rollAction = buildTurnActionMessage(
      session,
      activePlayerId,
      "roll",
      { roll: parsedRoll.value },
      { source: "bot_auto" }
    );

    const botScoreSummary = botEngine.buildTurnScoreSummary({
      rollSnapshot: parsedRoll.value,
      remainingDice,
      botProfile: participant.botProfile,
      gameDifficulty,
      turnNumber: turnState.turnNumber,
      sessionParticipants: session.participants,
      playerId: activePlayerId,
    });
    if (!botScoreSummary) {
      return null;
    }

    const scoreUpdate = applyParticipantScoreUpdate(
      participant,
      botScoreSummary,
      parsedRoll.value.dice.length
    );
    const finalizedScoreSummary = {
      ...botScoreSummary,
      projectedTotalScore: scoreUpdate.nextScore,
      remainingDice: scoreUpdate.nextRemainingDice,
      isComplete: scoreUpdate.didComplete,
      updatedAt: now(),
    };
    turnState.lastScoreSummary = finalizedScoreSummary;
    turnState.phase = turnPhases.readyToEnd;
    turnState.updatedAt = now();

    const scoreAction = buildTurnActionMessage(
      session,
      activePlayerId,
      "score",
      { score: finalizedScoreSummary },
      { source: "bot_auto" }
    );

    const advanced = advanceSessionTurn(session, activePlayerId, {
      source: "bot_auto",
    });
    if (!advanced) {
      return null;
    }

    return {
      rollAction,
      scoreAction,
      turnEnd: advanced.turnEnd,
      turnStart: advanced.turnStart,
    };
  }

  return Object.freeze({
    executeBotTurn,
  });
}

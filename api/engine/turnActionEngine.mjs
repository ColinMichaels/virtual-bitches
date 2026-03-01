const DEFAULT_TURN_PHASES = Object.freeze({
  awaitRoll: "await_roll",
  awaitScore: "await_score",
  readyToEnd: "ready_to_end",
});
const DEFAULT_PARTICIPANT_DICE_COUNT = 15;

function requireFunction(dependencies, key) {
  const value = dependencies?.[key];
  if (typeof value !== "function") {
    throw new Error(`Missing turn action engine dependency: ${key}`);
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

function normalizeTurnAction(value) {
  if (value === "score") {
    return "score";
  }
  if (value === "select") {
    return "select";
  }
  return "roll";
}

export function createTurnActionEngine(dependencies = {}) {
  const turnPhases = resolveTurnPhases(dependencies.turnPhases);
  const defaultParticipantDiceCount = resolveDefaultParticipantDiceCount(
    dependencies.defaultParticipantDiceCount
  );
  const now = resolveNowProvider(dependencies.now);

  const normalizeTurnPhase = requireFunction(dependencies, "normalizeTurnPhase");
  const ensureSessionTurnState = requireFunction(dependencies, "ensureSessionTurnState");
  const parseTurnRollPayload = requireFunction(dependencies, "parseTurnRollPayload");
  const parseTurnSelectionPayload = requireFunction(dependencies, "parseTurnSelectionPayload");
  const buildTurnScoreSummaryFromSelectedDice = requireFunction(
    dependencies,
    "buildTurnScoreSummaryFromSelectedDice"
  );
  const normalizeParticipantScore = requireFunction(dependencies, "normalizeParticipantScore");
  const normalizeParticipantRemainingDice = requireFunction(
    dependencies,
    "normalizeParticipantRemainingDice"
  );
  const isParticipantComplete = requireFunction(dependencies, "isParticipantComplete");
  const normalizeParticipantCompletedAt = requireFunction(
    dependencies,
    "normalizeParticipantCompletedAt"
  );
  const applyParticipantScoreUpdate = requireFunction(
    dependencies,
    "applyParticipantScoreUpdate"
  );
  const parseTurnScorePayload = requireFunction(dependencies, "parseTurnScorePayload");
  const clearParticipantTimeoutStrike = requireFunction(
    dependencies,
    "clearParticipantTimeoutStrike"
  );
  const buildTurnActionMessage = requireFunction(dependencies, "buildTurnActionMessage");
  const completeSessionRoundWithWinner = requireFunction(
    dependencies,
    "completeSessionRoundWithWinner"
  );

  function buildTurnActionError(code, reason, sync = true) {
    return {
      ok: false,
      code,
      reason,
      sync,
    };
  }

  function processTurnAction(session, playerId, payload) {
    const turnState = ensureSessionTurnState(session);
    if (!turnState?.activeTurnPlayerId) {
      return buildTurnActionError("turn_unavailable", "turn_unavailable", false);
    }
    if (turnState.activeTurnPlayerId !== playerId) {
      return buildTurnActionError("turn_not_active", "not_your_turn");
    }

    const action = normalizeTurnAction(payload?.action);
    const currentPhase = normalizeTurnPhase(turnState.phase);
    if (action === "roll" && currentPhase !== turnPhases.awaitRoll) {
      return buildTurnActionError("turn_action_invalid_phase", "roll_not_expected");
    }
    if (
      (action === "score" || action === "select") &&
      currentPhase !== turnPhases.awaitScore
    ) {
      return buildTurnActionError(
        "turn_action_invalid_phase",
        action === "select" ? "select_not_expected" : "score_not_expected"
      );
    }

    const actionTimestamp = now();
    let details = {};
    let scoreDidComplete = false;
    if (action === "roll") {
      const parsedRoll = parseTurnRollPayload(payload);
      if (!parsedRoll.ok) {
        return buildTurnActionError("turn_action_invalid_payload", parsedRoll.reason);
      }

      turnState.lastRollSnapshot = parsedRoll.value;
      turnState.lastScoreSummary = null;
      turnState.phase = turnPhases.awaitScore;
      details = { roll: parsedRoll.value };
    } else if (action === "select") {
      const parsedSelection = parseTurnSelectionPayload(payload, turnState.lastRollSnapshot);
      if (!parsedSelection.ok) {
        return buildTurnActionError("turn_action_invalid_payload", parsedSelection.reason);
      }

      const previewScoreSummary = buildTurnScoreSummaryFromSelectedDice(
        turnState.lastRollSnapshot,
        parsedSelection.value.selectedDiceIds,
        actionTimestamp
      );
      if (previewScoreSummary) {
        const participant = session.participants?.[playerId];
        const rollDiceCount = Array.isArray(turnState.lastRollSnapshot?.dice)
          ? turnState.lastRollSnapshot.dice.length
          : 0;
        const participantPreview = participant
          ? {
              ...participant,
              score: normalizeParticipantScore(participant.score),
              remainingDice: normalizeParticipantRemainingDice(participant.remainingDice),
              isComplete: isParticipantComplete(participant),
              completedAt: normalizeParticipantCompletedAt(participant.completedAt),
            }
          : null;
        const previewUpdate = participantPreview
          ? applyParticipantScoreUpdate(participantPreview, previewScoreSummary, rollDiceCount)
          : null;
        turnState.lastScoreSummary = {
          ...previewScoreSummary,
          projectedTotalScore: previewUpdate?.nextScore ?? null,
          remainingDice: previewUpdate?.nextRemainingDice ?? defaultParticipantDiceCount,
          isComplete: previewUpdate?.didComplete === true,
        };
      } else {
        turnState.lastScoreSummary = null;
      }
      details = { select: parsedSelection.value };
    } else {
      const parsedScore = parseTurnScorePayload(payload, turnState.lastRollSnapshot);
      if (!parsedScore.ok) {
        const code =
          parsedScore.reason === "score_points_mismatch" ||
          parsedScore.reason === "score_roll_mismatch"
            ? "turn_action_invalid_score"
            : "turn_action_invalid_payload";
        return buildTurnActionError(code, parsedScore.reason);
      }

      const participant = session.participants?.[playerId];
      const rollDiceCount = Array.isArray(turnState.lastRollSnapshot?.dice)
        ? turnState.lastRollSnapshot.dice.length
        : 0;
      const scoreUpdate = applyParticipantScoreUpdate(participant, parsedScore.value, rollDiceCount);

      turnState.lastScoreSummary = {
        ...parsedScore.value,
        projectedTotalScore: scoreUpdate.nextScore,
        remainingDice: scoreUpdate.nextRemainingDice,
        isComplete: scoreUpdate.didComplete,
      };
      turnState.phase = turnPhases.readyToEnd;
      scoreDidComplete = scoreUpdate.didComplete;
      details = { score: turnState.lastScoreSummary };
    }

    turnState.updatedAt = now();
    if (action === "roll" || action === "score") {
      clearParticipantTimeoutStrike(session.participants?.[playerId]);
    }

    const message = buildTurnActionMessage(session, playerId, action, details, {
      source: "player",
    });
    let winnerResolved = false;
    if (action === "score" && scoreDidComplete) {
      const completedRound = completeSessionRoundWithWinner(session, playerId, actionTimestamp);
      winnerResolved = completedRound.ok;
    }

    return {
      ok: true,
      action,
      actionTimestamp,
      message,
      winnerResolved,
      shouldBroadcastState: action !== "select",
      shouldPersist: action !== "select",
    };
  }

  return Object.freeze({
    processTurnAction,
  });
}

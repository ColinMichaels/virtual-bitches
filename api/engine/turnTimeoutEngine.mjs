const DEFAULT_TURN_PHASES = Object.freeze({
  awaitRoll: "await_roll",
  awaitScore: "await_score",
  readyToEnd: "ready_to_end",
});
const DEFAULT_TIMEOUT_STAND_STRIKE_LIMIT = 2;

function requireFunction(dependencies, key) {
  const value = dependencies?.[key];
  if (typeof value !== "function") {
    throw new Error(`Missing turn timeout engine dependency: ${key}`);
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

function resolveStrikeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_STAND_STRIKE_LIMIT;
  }
  return Math.max(1, Math.floor(parsed));
}

function resolveNowProvider(value) {
  return typeof value === "function" ? value : () => Date.now();
}

export function createTurnTimeoutEngine(dependencies = {}) {
  const turnPhases = resolveTurnPhases(dependencies.turnPhases);
  const timeoutStandStrikeLimit = resolveStrikeLimit(
    dependencies.turnTimeoutStandStrikeLimit
  );
  const now = resolveNowProvider(dependencies.now);

  const normalizeTurnPhase = requireFunction(dependencies, "normalizeTurnPhase");
  const normalizeTurnScoreSummary = requireFunction(
    dependencies,
    "normalizeTurnScoreSummary"
  );
  const normalizeTurnRollSnapshot = requireFunction(
    dependencies,
    "normalizeTurnRollSnapshot"
  );
  const applyParticipantScoreUpdate = requireFunction(
    dependencies,
    "applyParticipantScoreUpdate"
  );
  const buildTurnActionMessage = requireFunction(dependencies, "buildTurnActionMessage");
  const completeSessionRoundWithWinner = requireFunction(
    dependencies,
    "completeSessionRoundWithWinner"
  );
  const registerParticipantTimeoutStrike = requireFunction(
    dependencies,
    "registerParticipantTimeoutStrike"
  );
  const standParticipantIntoObserverMode = requireFunction(
    dependencies,
    "standParticipantIntoObserverMode"
  );
  const resolveSessionTurnTimeoutMs = requireFunction(
    dependencies,
    "resolveSessionTurnTimeoutMs"
  );
  const advanceSessionTurn = requireFunction(dependencies, "advanceSessionTurn");

  function processTurnTimeoutTransition(session, turnState, options = {}) {
    const timedOutPlayerId =
      typeof options.timedOutPlayerId === "string" && options.timedOutPlayerId.trim().length > 0
        ? options.timedOutPlayerId.trim()
        : "";
    if (!session || !turnState || !timedOutPlayerId) {
      return {
        ok: false,
      };
    }

    const timedOutParticipant = session.participants?.[timedOutPlayerId];
    if (!timedOutParticipant) {
      return {
        ok: false,
      };
    }

    const timeoutNow =
      Number.isFinite(options.timeoutNow) && options.timeoutNow > 0
        ? Math.floor(options.timeoutNow)
        : now();
    const timeoutRoundScope =
      Number.isFinite(options.timeoutRoundScope) && options.timeoutRoundScope > 0
        ? Math.floor(options.timeoutRoundScope)
        : timeoutNow;

    let timeoutReason = "turn_timeout";
    let timeoutScoreAction = null;
    const timeoutPhase = normalizeTurnPhase(turnState.phase);
    if (timeoutPhase === turnPhases.awaitScore) {
      const pendingScoreSummary = normalizeTurnScoreSummary(turnState.lastScoreSummary);
      const normalizedRollSnapshot = normalizeTurnRollSnapshot(turnState.lastRollSnapshot);
      const canAutoScore =
        pendingScoreSummary &&
        normalizedRollSnapshot &&
        pendingScoreSummary.rollServerId === normalizedRollSnapshot.serverRollId;
      if (canAutoScore) {
        const rollDiceCount = Array.isArray(normalizedRollSnapshot.dice)
          ? normalizedRollSnapshot.dice.length
          : 0;
        const scoreUpdate = applyParticipantScoreUpdate(
          timedOutParticipant,
          pendingScoreSummary,
          rollDiceCount
        );
        const finalizedScoreSummary = {
          ...pendingScoreSummary,
          projectedTotalScore: scoreUpdate.nextScore,
          remainingDice: scoreUpdate.nextRemainingDice,
          isComplete: scoreUpdate.didComplete,
          updatedAt: timeoutNow,
        };
        turnState.lastRollSnapshot = normalizedRollSnapshot;
        turnState.lastScoreSummary = finalizedScoreSummary;
        turnState.phase = turnPhases.readyToEnd;
        turnState.updatedAt = timeoutNow;
        timeoutReason = "turn_timeout_auto_score";

        timeoutScoreAction = buildTurnActionMessage(
          session,
          timedOutPlayerId,
          "score",
          { score: finalizedScoreSummary },
          { source: "timeout_auto" }
        );

        if (scoreUpdate.didComplete) {
          const completedRound = completeSessionRoundWithWinner(
            session,
            timedOutPlayerId,
            timeoutNow
          );
          if (completedRound.ok) {
            return {
              ok: true,
              stage: "completed_round",
              timedOutPlayerId,
              timeoutNow,
              timeoutReason,
              timeoutScoreAction,
            };
          }
        }
      }
    }

    const timeoutStrikeCount = registerParticipantTimeoutStrike(
      timedOutParticipant,
      timeoutRoundScope
    );
    let forcedObserverStand = false;
    if (timeoutStrikeCount >= timeoutStandStrikeLimit) {
      forcedObserverStand = standParticipantIntoObserverMode(
        timedOutParticipant,
        timeoutNow
      );
      timeoutReason =
        timeoutReason === "turn_timeout_auto_score"
          ? "turn_timeout_auto_score_stand"
          : "turn_timeout_stand";
    }

    if (normalizeTurnPhase(turnState.phase) !== turnPhases.readyToEnd) {
      turnState.phase = turnPhases.readyToEnd;
      turnState.lastRollSnapshot = null;
      turnState.lastScoreSummary = null;
      turnState.updatedAt = timeoutNow;
    }

    const timeoutMs = resolveSessionTurnTimeoutMs(session, turnState.turnTimeoutMs);
    const previousRound = turnState.round;
    const previousTurnNumber = turnState.turnNumber;
    const advanced = advanceSessionTurn(session, timedOutPlayerId, {
      source: "timeout_auto",
    });
    if (!advanced) {
      return {
        ok: false,
      };
    }

    return {
      ok: true,
      stage: "advanced_turn",
      timedOutPlayerId,
      timeoutNow,
      timeoutReason,
      timeoutMs,
      previousRound,
      previousTurnNumber,
      advanced,
      timeoutScoreAction,
      forcedObserverStand,
    };
  }

  return Object.freeze({
    processTurnTimeoutTransition,
  });
}

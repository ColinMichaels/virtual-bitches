const DEFAULT_BOT_ROLL_DICE_SIDES = [8, 12, 10, 6, 6, 6, 20, 6, 4, 6, 6, 6, 10, 6, 6];
const DEFAULT_PARTICIPANT_DICE_COUNT = 15;
const DEFAULT_MAX_TURN_ROLL_DICE = 64;
const DEFAULT_TURN_DELAY_RANGE = {
  min: 1600,
  max: 3200,
};
const DEFAULT_TURN_DELAY_BY_PROFILE = {
  cautious: { min: 2300, max: 4200 },
  balanced: { min: 1500, max: 3100 },
  aggressive: { min: 900, max: 2200 },
};

export function createBotEngine(options = {}) {
  const maxTurnRollDice = normalizePositiveInt(
    options.maxTurnRollDice,
    DEFAULT_MAX_TURN_ROLL_DICE,
    1,
    1024
  );
  const defaultParticipantDiceCount = normalizePositiveInt(
    options.defaultParticipantDiceCount,
    DEFAULT_PARTICIPANT_DICE_COUNT,
    1,
    1024
  );
  const rollDiceSides = normalizeRollDiceSides(options.rollDiceSides, DEFAULT_BOT_ROLL_DICE_SIDES);
  const defaultTurnDelayRange = normalizeDelayRange(
    options.defaultTurnDelayRange,
    DEFAULT_TURN_DELAY_RANGE
  );
  const turnDelayByProfile = {
    cautious: normalizeDelayRange(
      options.turnDelayByProfile?.cautious,
      DEFAULT_TURN_DELAY_BY_PROFILE.cautious
    ),
    balanced: normalizeDelayRange(
      options.turnDelayByProfile?.balanced,
      DEFAULT_TURN_DELAY_BY_PROFILE.balanced
    ),
    aggressive: normalizeDelayRange(
      options.turnDelayByProfile?.aggressive,
      DEFAULT_TURN_DELAY_BY_PROFILE.aggressive
    ),
  };

  return {
    buildTurnRollPayload(input = {}) {
      const playerId = typeof input.playerId === "string" ? input.playerId.trim() : "";
      if (!playerId) {
        return null;
      }

      const safeTurnNumber = normalizeTurnNumber(input.turnNumber);
      const remainingDice = normalizeParticipantRemainingDice(
        input.remainingDice,
        defaultParticipantDiceCount
      );
      const diceCount = Math.max(1, Math.min(maxTurnRollDice, remainingDice));
      const dice = [];

      for (let index = 0; index < diceCount; index += 1) {
        const sides = rollDiceSides[index % rollDiceSides.length] ?? 6;
        dice.push({
          dieId: `${playerId}-t${safeTurnNumber}-d${index + 1}-s${sides}`,
          sides,
        });
      }

      return {
        rollIndex: safeTurnNumber,
        dice,
      };
    },

    buildTurnScoreSummary(input = {}) {
      const rollSnapshot = input.rollSnapshot;
      if (!rollSnapshot || !Array.isArray(rollSnapshot.dice) || rollSnapshot.dice.length === 0) {
        return null;
      }

      const rollServerId =
        typeof rollSnapshot.serverRollId === "string" && rollSnapshot.serverRollId
          ? rollSnapshot.serverRollId
          : "";
      if (!rollServerId) {
        return null;
      }

      const scoredCandidates = rollSnapshot.dice
        .map((die) => {
          const dieId = typeof die?.dieId === "string" ? die.dieId : "";
          const sides = Number.isFinite(die?.sides) ? Math.floor(die.sides) : NaN;
          const value = Number.isFinite(die?.value) ? Math.floor(die.value) : NaN;
          if (!dieId || !Number.isFinite(sides) || !Number.isFinite(value)) {
            return null;
          }
          return {
            dieId,
            points: Math.max(0, sides - value),
            value,
          };
        })
        .filter((entry) => entry !== null);

      if (scoredCandidates.length === 0) {
        return null;
      }

      scoredCandidates.sort((left, right) => {
        const pointsDelta = left.points - right.points;
        if (pointsDelta !== 0) {
          return pointsDelta;
        }
        const valueDelta = right.value - left.value;
        if (valueDelta !== 0) {
          return valueDelta;
        }
        return left.dieId.localeCompare(right.dieId);
      });

      const remainingDice = normalizeParticipantRemainingDice(
        input.remainingDice,
        defaultParticipantDiceCount
      );
      const gameDifficulty = normalizeGameDifficulty(input.gameDifficulty);
      const strategyContext = buildBotTurnContext(input.sessionParticipants, input.playerId);
      const selectionTarget = resolveBotSelectionCount(
        input.botProfile,
        remainingDice,
        scoredCandidates.length,
        input.turnNumber,
        strategyContext,
        gameDifficulty
      );
      const pointTolerance = resolveBotPointTolerance(
        input.botProfile,
        input.turnNumber,
        remainingDice,
        strategyContext,
        gameDifficulty
      );

      let safeDiceCount = 0;
      for (const candidate of scoredCandidates) {
        if (candidate.points > pointTolerance) {
          break;
        }
        safeDiceCount += 1;
      }

      const safeTurnNumber = normalizeTurnNumber(input.turnNumber);
      const shouldSprintFinish =
        remainingDice <= 2 ||
        (strategyContext.isTrailing === true && remainingDice <= 4 && safeTurnNumber >= 7);

      let selectionCount = shouldSprintFinish
        ? selectionTarget
        : Math.min(selectionTarget, Math.max(1, safeDiceCount));

      if (
        !shouldSprintFinish &&
        safeDiceCount === 0 &&
        normalizeBotProfile(input.botProfile) === "aggressive"
      ) {
        selectionCount = Math.min(selectionTarget, scoredCandidates.length, Math.min(2, remainingDice));
      }

      const prioritizedCandidates = prioritizeScoredCandidatesForDifficulty(
        scoredCandidates,
        input.botProfile,
        gameDifficulty,
        safeTurnNumber,
        remainingDice,
        strategyContext
      );
      const selectedDice = prioritizedCandidates.slice(0, selectionCount);
      const points = selectedDice.reduce((sum, die) => sum + die.points, 0);

      return {
        selectedDiceIds: selectedDice.map((die) => die.dieId),
        points,
        expectedPoints: points,
        rollServerId,
        updatedAt: Date.now(),
      };
    },

    resolveTurnDelayMs(input = {}) {
      const strategyContext = buildBotTurnContext(input.sessionParticipants, input.playerId);
      const remainingDice = normalizeParticipantRemainingDice(
        input.remainingDice,
        defaultParticipantDiceCount
      );
      const gameDifficulty = normalizeGameDifficulty(input.gameDifficulty);

      return resolveBotTurnDelayMs(
        input.botProfile,
        remainingDice,
        input.turnNumber,
        strategyContext,
        {
          defaultRange: defaultTurnDelayRange,
          byProfile: turnDelayByProfile,
        },
        gameDifficulty
      );
    },
  };
}

function prioritizeScoredCandidatesForDifficulty(
  scoredCandidates,
  botProfile,
  gameDifficulty,
  turnNumber,
  remainingDice,
  context = {}
) {
  const difficulty = normalizeGameDifficulty(gameDifficulty);
  if (difficulty !== "easy" || scoredCandidates.length <= 1) {
    return scoredCandidates;
  }

  const mistakeCount = resolveEasyDifficultyMistakeCount(
    botProfile,
    turnNumber,
    remainingDice,
    context,
    scoredCandidates.length
  );
  if (mistakeCount <= 0) {
    return scoredCandidates;
  }

  const bestPoints = scoredCandidates[0]?.points ?? 0;
  const riskyCandidates = [...scoredCandidates]
    .sort((left, right) => {
      const pointsDelta = right.points - left.points;
      if (pointsDelta !== 0) {
        return pointsDelta;
      }
      const valueDelta = left.value - right.value;
      if (valueDelta !== 0) {
        return valueDelta;
      }
      return left.dieId.localeCompare(right.dieId);
    })
    .filter((candidate) => candidate.points > bestPoints)
    .slice(0, mistakeCount);

  if (riskyCandidates.length === 0) {
    return scoredCandidates;
  }

  const riskyIds = new Set(riskyCandidates.map((candidate) => candidate.dieId));
  return [
    ...riskyCandidates,
    ...scoredCandidates.filter((candidate) => !riskyIds.has(candidate.dieId)),
  ];
}

function resolveEasyDifficultyMistakeCount(
  botProfile,
  turnNumber,
  remainingDice,
  context = {},
  availableDice = 0
) {
  const safeTurnNumber = normalizeTurnNumber(turnNumber);
  const remaining = Math.max(1, normalizeParticipantRemainingDice(remainingDice));
  const available = Math.max(0, Math.floor(availableDice));
  if (available <= 1 || safeTurnNumber <= 2) {
    return 0;
  }

  const profile = normalizeBotProfile(botProfile);
  let mistakeCount = profile === "aggressive" ? 2 : 1;

  if (safeTurnNumber >= 6) {
    mistakeCount += 1;
  }
  if (context.isLeading === true) {
    mistakeCount += 1;
  }
  if (context.isTrailing === true) {
    mistakeCount -= 1;
  }
  if (remaining <= 4) {
    mistakeCount -= 1;
  }

  return Math.max(0, Math.min(3, available - 1, mistakeCount));
}

function buildActiveRaceStandings(sessionParticipants) {
  return getParticipantsArray(sessionParticipants)
    .filter((participant) => participant && !isParticipantComplete(participant))
    .map((participant) => ({
      playerId: participant.playerId,
      score: normalizeParticipantScore(participant.score),
      remainingDice: normalizeParticipantRemainingDice(participant.remainingDice),
      joinedAt:
        typeof participant.joinedAt === "number" && Number.isFinite(participant.joinedAt)
          ? Math.floor(participant.joinedAt)
          : 0,
    }))
    .sort((left, right) => {
      const scoreDelta = left.score - right.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      const remainingDelta = left.remainingDice - right.remainingDice;
      if (remainingDelta !== 0) {
        return remainingDelta;
      }
      const joinedDelta = left.joinedAt - right.joinedAt;
      if (joinedDelta !== 0) {
        return joinedDelta;
      }
      return left.playerId.localeCompare(right.playerId);
    })
    .map((participant, index) => ({
      ...participant,
      placement: index + 1,
    }));
}

function buildBotTurnContext(sessionParticipants, playerId) {
  const raceStandings = buildActiveRaceStandings(sessionParticipants);
  const activeCount = raceStandings.length;
  const safePlayerId = typeof playerId === "string" ? playerId.trim() : "";
  const current = raceStandings.find((entry) => entry.playerId === safePlayerId);
  if (!current) {
    return {
      placement: 1,
      activeCount: Math.max(1, activeCount),
      gapToLeader: 0,
      isLeading: true,
      isTrailing: false,
    };
  }

  const leaderScore = normalizeParticipantScore(raceStandings[0]?.score);
  const gapToLeader = Math.max(0, normalizeParticipantScore(current.score) - leaderScore);
  return {
    placement: current.placement,
    activeCount: Math.max(1, activeCount),
    gapToLeader,
    isLeading: current.placement === 1,
    isTrailing: current.placement === activeCount && activeCount > 1,
  };
}

function resolveBotSelectionCount(
  botProfile,
  remainingDice,
  availableDice,
  turnNumber,
  context = {},
  gameDifficulty = "normal"
) {
  const remaining = Math.max(1, normalizeParticipantRemainingDice(remainingDice, availableDice));
  const available = Math.max(1, Math.min(availableDice, remaining));
  const safeTurnNumber = normalizeTurnNumber(turnNumber);
  const profile = normalizeBotProfile(botProfile);
  const difficulty = normalizeGameDifficulty(gameDifficulty);

  if (remaining <= 2) {
    return Math.min(remaining, available);
  }

  let selectionCount = profile === "cautious" ? 1 : profile === "aggressive" ? 3 : 2;
  if (remaining <= 4) {
    selectionCount += 1;
  }
  if (safeTurnNumber >= 8) {
    selectionCount += profile === "aggressive" ? 2 : 1;
  } else if (safeTurnNumber >= 5 && profile === "aggressive") {
    selectionCount += 1;
  }

  const activeCount =
    Number.isFinite(context.activeCount) && context.activeCount > 0
      ? Math.floor(context.activeCount)
      : 1;
  const placement =
    Number.isFinite(context.placement) && context.placement > 0 ? Math.floor(context.placement) : 1;
  const gapToLeader = Number.isFinite(context.gapToLeader) ? Math.max(0, Math.floor(context.gapToLeader)) : 0;

  if (activeCount > 1 && (context.isTrailing === true || placement === activeCount)) {
    selectionCount += 1;
  }
  if (gapToLeader >= 12) {
    selectionCount += 1;
  }
  if (gapToLeader >= 22) {
    selectionCount += 1;
  }
  if (context.isLeading === true && remaining > 2) {
    selectionCount -= 1;
  }

  if (difficulty === "easy") {
    selectionCount += 1;
    if (safeTurnNumber >= 4) {
      selectionCount += 1;
    }
    if (context.isLeading === true) {
      selectionCount += 1;
    }
  } else if (difficulty === "hard") {
    selectionCount -= 1;
    if (context.isLeading === true) {
      selectionCount -= 1;
    }
    if (context.isTrailing === true && safeTurnNumber >= 6) {
      selectionCount += 1;
    }
  }

  let profileMax = profile === "cautious" ? 3 : profile === "aggressive" ? 7 : 5;
  if (difficulty === "easy") {
    profileMax += 1;
  } else if (difficulty === "hard") {
    profileMax = Math.max(2, profileMax - 1);
  }
  if (remaining <= 3) {
    selectionCount = remaining;
  }

  return Math.max(1, Math.min(selectionCount, profileMax, available, remaining));
}

function resolveBotPointTolerance(
  botProfile,
  turnNumber,
  remainingDice,
  context = {},
  gameDifficulty = "normal"
) {
  const profile = normalizeBotProfile(botProfile);
  const remaining = Math.max(1, normalizeParticipantRemainingDice(remainingDice));
  const safeTurnNumber = normalizeTurnNumber(turnNumber);
  const difficulty = normalizeGameDifficulty(gameDifficulty);

  let tolerance = profile === "cautious" ? 2 : profile === "aggressive" ? 6 : 4;
  if (safeTurnNumber >= 8) {
    tolerance += 1;
  }

  if (context.isTrailing === true) {
    tolerance += 2;
  }
  if (Number.isFinite(context.gapToLeader) && context.gapToLeader >= 12) {
    tolerance += 1;
  }
  if (context.isLeading === true) {
    tolerance -= 1;
  }
  if (remaining <= 3) {
    tolerance += 3;
  }

  if (difficulty === "easy") {
    tolerance += 3;
    if (context.isLeading === true) {
      tolerance += 1;
    }
  } else if (difficulty === "hard") {
    tolerance -= 2;
    if (context.isTrailing === true) {
      tolerance += 1;
    }
  }

  return Math.max(0, Math.min(20, tolerance));
}

function resolveBotTurnDelayMs(
  botProfile,
  remainingDice,
  turnNumber,
  context = {},
  timingConfig,
  gameDifficulty = "normal"
) {
  const profile = normalizeBotProfile(botProfile);
  const range = timingConfig.byProfile[profile] ?? timingConfig.defaultRange;
  let minDelay = range.min;
  let maxDelay = range.max;
  const difficulty = normalizeGameDifficulty(gameDifficulty);

  const safeRemainingDice = Math.max(1, normalizeParticipantRemainingDice(remainingDice));
  const safeTurnNumber = normalizeTurnNumber(turnNumber);

  if (safeTurnNumber >= 10 || safeRemainingDice <= 3) {
    minDelay = Math.max(300, minDelay - 300);
    maxDelay = Math.max(minDelay, maxDelay - 550);
  }
  if (context.isTrailing === true) {
    minDelay = Math.max(300, minDelay - 200);
    maxDelay = Math.max(minDelay, maxDelay - 350);
  }
  if (context.isLeading === true && profile === "cautious") {
    minDelay += 250;
    maxDelay += 350;
  }

  if (difficulty === "easy") {
    minDelay += 350;
    maxDelay += 700;
  } else if (difficulty === "hard") {
    minDelay = Math.max(250, minDelay - 250);
    maxDelay = Math.max(minDelay, maxDelay - 450);
  }

  return randomDelayInRange(minDelay, maxDelay);
}

function normalizeGameDifficulty(value) {
  if (typeof value !== "string") {
    return "normal";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "easy" || normalized === "hard") {
    return normalized;
  }
  return "normal";
}

function normalizeBotProfile(value) {
  if (typeof value !== "string") {
    return "balanced";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "cautious" || normalized === "aggressive") {
    return normalized;
  }
  return "balanced";
}

function normalizeParticipantScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function normalizeParticipantRemainingDice(value, fallback = DEFAULT_PARTICIPANT_DICE_COUNT) {
  const fallbackValue = Number.isFinite(fallback) ? Math.max(0, Math.floor(fallback)) : 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }
  return Math.max(0, Math.floor(parsed));
}

function isParticipantComplete(participant) {
  if (!participant || typeof participant !== "object") {
    return false;
  }
  if (participant.isComplete === true) {
    return true;
  }
  return normalizeParticipantRemainingDice(participant.remainingDice) === 0;
}

function getParticipantsArray(sessionParticipants) {
  if (Array.isArray(sessionParticipants)) {
    return sessionParticipants;
  }
  if (sessionParticipants && typeof sessionParticipants === "object") {
    return Object.values(sessionParticipants);
  }
  return [];
}

function randomDelayInRange(minDelayMs, maxDelayMs) {
  const min = Number.isFinite(minDelayMs) ? Math.max(0, Math.floor(minDelayMs)) : 0;
  const max = Number.isFinite(maxDelayMs) ? Math.max(min, Math.floor(maxDelayMs)) : min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function normalizePositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeTurnNumber(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function normalizeDelayRange(value, fallback) {
  const fallbackMin = Math.max(0, Math.floor(fallback.min));
  const fallbackMax = Math.max(fallbackMin, Math.floor(fallback.max));

  const min = Number.isFinite(value?.min) ? Math.max(0, Math.floor(value.min)) : fallbackMin;
  const max = Number.isFinite(value?.max) ? Math.max(min, Math.floor(value.max)) : fallbackMax;

  return { min, max };
}

function normalizeRollDiceSides(value, fallback) {
  if (!Array.isArray(value) || value.length === 0) {
    return [...fallback];
  }

  const parsed = value
    .map((entry) => (Number.isFinite(entry) ? Math.floor(entry) : NaN))
    .filter((entry) => Number.isFinite(entry) && entry >= 2 && entry <= 1000);

  if (parsed.length === 0) {
    return [...fallback];
  }

  return parsed;
}

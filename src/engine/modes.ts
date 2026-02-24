import { GameMode, GameDifficulty, GameVariant } from "./types.js";

/**
 * Default game mode (Normal difficulty, Classic variant)
 */
export const DEFAULT_MODE: GameMode = {
  difficulty: "normal",
  variant: "classic",
};

/**
 * Easy mode preset - Shows hints and allows more forgiving gameplay
 */
export const EASY_MODE: GameMode = {
  difficulty: "easy",
  variant: "classic",
};

/**
 * Hard mode preset - No hints, strict rules
 */
export const HARD_MODE: GameMode = {
  difficulty: "hard",
  variant: "classic",
};

/**
 * Time Attack mode preset - Race against the clock
 */
export const TIME_ATTACK_MODE: GameMode = {
  difficulty: "normal",
  variant: "timeAttack",
};

/**
 * D4 Challenge mode preset - All dice are d4s
 */
export const D4_CHALLENGE_MODE: GameMode = {
  difficulty: "normal",
  variant: "d4Mode",
};

/**
 * Get display name for a game mode
 */
export function getModeName(mode: GameMode): string {
  const difficultyName = getDifficultyName(mode.difficulty);
  const variantName = getVariantName(mode.variant);

  if (mode.variant === "classic") {
    return difficultyName;
  }

  return `${variantName} (${difficultyName})`;
}

/**
 * Get display name for difficulty
 */
export function getDifficultyName(difficulty: GameDifficulty): string {
  switch (difficulty) {
    case "easy":
      return "Easy";
    case "normal":
      return "Normal";
    case "hard":
      return "Hard";
  }
}

/**
 * Get display name for variant
 */
export function getVariantName(variant: GameVariant): string {
  switch (variant) {
    case "classic":
      return "Classic";
    case "timeAttack":
      return "Time Attack";
    case "d4Mode":
      return "D4 Challenge";
  }
}

/**
 * Check if hints should be shown for this mode
 */
export function shouldShowHints(mode: GameMode): boolean {
  return mode.difficulty === "easy";
}

/**
 * Check if undo is allowed for this mode
 */
export function isUndoAllowed(mode: GameMode): boolean {
  return mode.difficulty === "easy";
}

/**
 * Get all available game modes
 */
export function getAllModes(): GameMode[] {
  return [
    DEFAULT_MODE,
    EASY_MODE,
    HARD_MODE,
    TIME_ATTACK_MODE,
    D4_CHALLENGE_MODE,
  ];
}

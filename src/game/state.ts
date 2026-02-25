import { SeededRNG } from "../engine/rng.js";
import {
  buildDicePool,
  initializeDice,
  isValidSelection,
  calculateSelectionPoints,
  isGameComplete,
  scoreDie,
} from "../engine/rules.js";
import { GameState, Action, GameConfig, DieState, GameMode } from "../engine/types.js";
import { DEFAULT_MODE } from "../engine/modes.js";

/**
 * Create initial game state
 *
 * @param seed - Random seed for deterministic gameplay (used for replay/sharing)
 * @param config - Optional game configuration (add d20, d4, etc.)
 * @param mode - Game mode (difficulty + variant), defaults to Normal/Classic
 * @returns New game state in READY status
 *
 * @example
 * ```ts
 * const game = createGame("my-seed-123");
 * const gameWithD20 = createGame("my-seed-123", { addD20: true });
 * const easyGame = createGame("my-seed-123", {}, EASY_MODE);
 * ```
 */
export function createGame(seed: string, config: GameConfig = {}, mode: GameMode = DEFAULT_MODE): GameState {
  const pool = buildDicePool(config);
  const dice = initializeDice(pool);

  return {
    dice,
    rollIndex: 0,
    score: 0,
    status: "READY",
    selected: new Set(),
    seed,
    actionLog: [],
    mode,
  };
}

/**
 * Game reducer - pure state transitions
 *
 * Applies an action to the current state and returns a new state.
 * This is a pure function - it never mutates the input state.
 * All actions are logged in actionLog for replay functionality.
 *
 * @param state - Current game state
 * @param action - Action to apply (ROLL, TOGGLE_SELECT, SCORE_SELECTED)
 * @returns New game state after applying action
 *
 * @example
 * ```ts
 * let state = createGame("seed");
 * state = reduce(state, { t: "ROLL" });
 * state = reduce(state, { t: "TOGGLE_SELECT", dieId: "d6-0" });
 * state = reduce(state, { t: "SCORE_SELECTED" });
 * ```
 */
export function reduce(state: GameState, action: Action): GameState {
  const newState = { ...state, actionLog: [...state.actionLog, action] };

  switch (action.t) {
    case "ROLL": {
      if (state.status !== "READY") return state;

      // Roll all dice still in play
      const rng = new SeededRNG(`${state.seed}-${state.rollIndex}`);
      const dice = state.dice.map((d) => {
        if (!d.inPlay || d.scored) return d;
        return { ...d, value: rng.rollDie(d.def.sides) };
      });

      return {
        ...newState,
        dice,
        rollIndex: state.rollIndex + 1,
        status: "ROLLED",
        selected: new Set(),
      };
    }

    case "TOGGLE_SELECT": {
      if (state.status !== "ROLLED") return state;

      const die = state.dice.find((d) => d.id === action.dieId);
      if (!die || !die.inPlay || die.scored) return state;

      const selected = new Set(state.selected);
      if (selected.has(action.dieId)) {
        selected.delete(action.dieId);
      } else {
        selected.add(action.dieId);
      }

      return { ...newState, selected };
    }

    case "SCORE_SELECTED": {
      if (state.status !== "ROLLED") return state;
      if (!isValidSelection(state.selected)) return state;

      // Score and remove selected dice
      const points = calculateSelectionPoints(state.dice, state.selected);
      const dice = state.dice.map((d) =>
        state.selected.has(d.id)
          ? { ...d, scored: true, inPlay: false }
          : d
      );

      const complete = isGameComplete(dice);

      return {
        ...newState,
        dice,
        score: state.score + points,
        selected: new Set(),
        status: complete ? "COMPLETE" : "READY",
      };
    }

    default:
      return state;
  }
}

/**
 * Check if undo is available
 *
 * @param state - Current game state
 * @returns True if the last scoring action can be undone
 */
export function canUndo(state: GameState): boolean {
  if (state.actionLog.length === 0) return false;

  // Find the last SCORE_SELECTED action
  for (let i = state.actionLog.length - 1; i >= 0; i--) {
    const action = state.actionLog[i];
    if (action.t === "SCORE_SELECTED") {
      return true;
    }
    // Stop if we hit a ROLL action (can't undo across rolls)
    if (action.t === "ROLL") {
      return false;
    }
  }

  return false;
}

/**
 * Undo the last scoring action
 *
 * Replays the game from the start up to (but not including) the last SCORE_SELECTED action.
 * This allows players to undo their scoring decision and reselect different dice.
 * Cannot undo across rolls - only the most recent scoring within current roll.
 *
 * @param state - Current game state
 * @param config - Game configuration (must match original game)
 * @returns New game state with last score undone, or original state if undo not possible
 *
 * @example
 * ```ts
 * state = reduce(state, { t: "SCORE_SELECTED" });
 * state = undo(state, config); // Undoes the scoring, returns to ROLLED state
 * ```
 */
export function undo(state: GameState, config: GameConfig = {}): GameState {
  if (!canUndo(state)) return state;

  // Find the last SCORE_SELECTED action and remove it plus any TOGGLE_SELECT after it
  const actionLog = [...state.actionLog];
  let lastScoreIndex = -1;

  for (let i = actionLog.length - 1; i >= 0; i--) {
    if (actionLog[i].t === "SCORE_SELECTED") {
      lastScoreIndex = i;
      break;
    }
  }

  if (lastScoreIndex === -1) return state;

  // Replay without the last SCORE_SELECTED action
  const actionsWithoutLastScore = actionLog.slice(0, lastScoreIndex);
  return replay(state.seed, actionsWithoutLastScore, config, state.mode);
}

/**
 * Replay a game from seed + action log
 *
 * Deterministically replays all actions from a game to reconstruct its final state.
 * Used for sharing games and verifying replay URLs.
 *
 * @param seed - Random seed from the original game
 * @param actions - Array of actions to replay
 * @param config - Game configuration (must match original game)
 * @param mode - Game mode (must match original game)
 * @returns Final game state after replaying all actions
 *
 * @example
 * ```ts
 * const actions = [
 *   { t: "ROLL" },
 *   { t: "TOGGLE_SELECT", dieId: "d6-0" },
 *   { t: "SCORE_SELECTED" }
 * ];
 * const finalState = replay("seed-123", actions);
 * ```
 */
export function replay(
  seed: string,
  actions: Action[],
  config: GameConfig = {},
  mode: GameMode = DEFAULT_MODE
): GameState {
  let state = createGame(seed, config, mode);
  for (const action of actions) {
    state = reduce(state, action);
  }
  return state;
}

/**
 * Serialize action log for sharing
 *
 * Encodes actions as a base64 URL-safe string for sharing via query parameters.
 *
 * @param actions - Array of actions to serialize
 * @returns Base64-encoded action log
 */
export function serializeActions(actions: Action[]): string {
  return btoa(JSON.stringify(actions));
}

/**
 * Deserialize action log from shared URL
 *
 * Decodes a base64 action log back into Action array.
 * Returns empty array if decoding fails.
 *
 * @param encoded - Base64-encoded action log
 * @returns Array of actions, or empty array on error
 */
export function deserializeActions(encoded: string): Action[] {
  try {
    return JSON.parse(atob(encoded));
  } catch {
    return [];
  }
}

/**
 * Generate shareable URL for current game
 *
 * Creates a URL containing seed + action log that can be shared
 * to allow others to replay this exact game.
 *
 * @param state - Current game state
 * @returns Full URL with seed and log query parameters
 *
 * @example
 * ```ts
 * const url = generateShareURL(gameState);
 * // => "https://example.com?seed=123&log=W3sidCI6IlJPTEwifV0="
 * ```
 */
export function generateShareURL(state: GameState): string {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", state.seed);
  url.searchParams.set("log", serializeActions(state.actionLog));
  return url.toString();
}

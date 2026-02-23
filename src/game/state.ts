import { SeededRNG } from "../engine/rng.js";
import {
  buildDicePool,
  initializeDice,
  isValidSelection,
  calculateSelectionPoints,
  isGameComplete,
  scoreDie,
} from "../engine/rules.js";
import { GameState, Action, GameConfig, DieState } from "../engine/types.js";

/**
 * Create initial game state
 */
export function createGame(seed: string, config: GameConfig = {}): GameState {
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
  };
}

/**
 * Game reducer - pure state transitions
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
 * Replay a game from seed + action log
 */
export function replay(
  seed: string,
  actions: Action[],
  config: GameConfig = {}
): GameState {
  let state = createGame(seed, config);
  for (const action of actions) {
    state = reduce(state, action);
  }
  return state;
}

/**
 * Serialize action log for sharing
 */
export function serializeActions(actions: Action[]): string {
  return btoa(JSON.stringify(actions));
}

export function deserializeActions(encoded: string): Action[] {
  try {
    return JSON.parse(atob(encoded));
  } catch {
    return [];
  }
}

/**
 * Generate shareable URL
 */
export function generateShareURL(state: GameState): string {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", state.seed);
  url.searchParams.set("log", serializeActions(state.actionLog));
  return url.toString();
}

/**
 * Supported die types in BISCUITS
 */
export type DieKind = "d4" | "d6" | "d8" | "d10" | "d12" | "d20";

/**
 * Die definition - immutable properties of a die type
 */
export type DieDef = {
  /** The type of die (d4, d6, d8, d10, d12, d20) */
  kind: DieKind;
  /** Number of faces on this die */
  sides: number;
  /** For d100 mode: whether this die represents tens or ones place */
  role?: "tens" | "ones";
};

/**
 * Die state - current state of a single die during gameplay
 */
export type DieState = {
  /** Unique identifier for this die instance */
  id: string;
  /** Die definition (kind, sides, role) */
  def: DieDef;
  /** Current rolled value (0 = not rolled yet) */
  value: number;
  /** Whether this die is still active in current round */
  inPlay: boolean;
  /** Whether this die has been scored and moved to scored pile */
  scored: boolean;
};

/**
 * Game difficulty levels
 * - easy: Shows hints, allows undo, more forgiving
 * - normal: Standard gameplay
 * - hard: No hints, no undo, strict rules
 */
export type GameDifficulty = "easy" | "normal" | "hard";

/**
 * Game variants
 * - classic: Standard 3-roll BISCUITS
 * - timeAttack: Race against the clock
 * - d4Mode: All dice replaced with d4s
 */
export type GameVariant = "classic" | "timeAttack" | "d4Mode";

/**
 * Complete game mode definition
 */
export type GameMode = {
  /** Difficulty level */
  difficulty: GameDifficulty;
  /** Game variant */
  variant: GameVariant;
};

/**
 * Game status values
 * - READY: waiting for player to roll
 * - ROLLED: dice have been rolled, waiting for player to score
 * - COMPLETE: game is over
 */
export type GameStatus = "READY" | "ROLLED" | "COMPLETE";

/**
 * Complete game state
 * All state changes go through the reducer function in state.ts
 */
export type GameState = {
  /** All dice in the game (active and scored) */
  dice: DieState[];
  /** Number of times dice have been rolled (3 max per game) */
  rollIndex: number;
  /** Total accumulated score */
  score: number;
  /** Current game status */
  status: GameStatus;
  /** Set of die IDs that are currently selected */
  selected: Set<string>;
  /** Random seed used for this game (for replay/sharing) */
  seed: string;
  /** Complete log of all actions (for replay/sharing) */
  actionLog: Action[];
  /** Game mode (difficulty + variant) */
  mode: GameMode;
};

/**
 * Game actions - all possible state transitions
 * Actions are recorded in actionLog for replay functionality
 */
export type Action =
  | { t: "ROLL" }
  | { t: "TOGGLE_SELECT"; dieId: string }
  | { t: "SCORE_SELECTED" };

/**
 * Game configuration options
 * Used to create custom game variants with different dice pools
 */
export type GameConfig = {
  /** Add a d20 to the dice pool */
  addD20?: boolean;
  /** Add a d4 to the dice pool */
  addD4?: boolean;
  /** Add a second d10 to the dice pool */
  add2ndD10?: boolean;
  /** Use d100 mode (two d10s as percentile dice) */
  d100Mode?: boolean;
};

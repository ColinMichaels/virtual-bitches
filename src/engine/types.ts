export type DieKind = "d4" | "d6" | "d8" | "d10" | "d12" | "d20";

export type DieDef = {
  kind: DieKind;
  sides: number;
  role?: "tens" | "ones"; // for d100 mode
};

export type DieState = {
  id: string;
  def: DieDef;
  value: number; // rolled face (0 = not rolled yet)
  inPlay: boolean;
  scored: boolean;
};

export type GameStatus = "READY" | "ROLLED" | "COMPLETE";

export type GameState = {
  dice: DieState[];
  rollIndex: number;
  score: number;
  status: GameStatus;
  selected: Set<string>;
  seed: string;
  actionLog: Action[];
};

export type Action =
  | { t: "ROLL" }
  | { t: "TOGGLE_SELECT"; dieId: string }
  | { t: "SCORE_SELECTED" };

export type GameConfig = {
  addD20?: boolean;
  addD4?: boolean;
  add2ndD10?: boolean;
  d100Mode?: boolean;
};

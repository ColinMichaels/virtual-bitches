import { DieKind, DieDef, DieState, GameConfig } from "./types.js";

/**
 * Core scoring rule: points = max - value
 */
export function scoreDie(die: DieState): number {
  return die.def.sides - die.value;
}

/**
 * Build initial dice pool (15 total)
 */
export function buildDicePool(config: GameConfig = {}): DieDef[] {
  const pool: DieDef[] = [];

  // Base: 12 d6
  let d6Count = 12;

  // Base special dice
  pool.push({ kind: "d8", sides: 8 });
  pool.push({ kind: "d10", sides: 10 });
  pool.push({ kind: "d12", sides: 12 });

  // Optional expansions (each removes 1 d6)
  if (config.addD20) {
    pool.push({ kind: "d20", sides: 20 });
    d6Count--;
  }

  if (config.addD4) {
    pool.push({ kind: "d4", sides: 4 });
    d6Count--;
  }

  if (config.add2ndD10) {
    if (config.d100Mode) {
      // Designate tens and ones
      pool.push({ kind: "d10", sides: 10, role: "tens" });
      pool.push({ kind: "d10", sides: 10, role: "ones" });
    } else {
      pool.push({ kind: "d10", sides: 10 });
    }
    d6Count--;
  }

  // Add remaining d6s
  for (let i = 0; i < d6Count; i++) {
    pool.push({ kind: "d6", sides: 6 });
  }

  return pool;
}

/**
 * Initialize dice states with unique IDs
 */
export function initializeDice(defs: DieDef[]): DieState[] {
  return defs.map((def, i) => ({
    id: `${def.kind}-${def.role || ""}-${i}`,
    def,
    value: 0,
    inPlay: true,
    scored: false,
  }));
}

/**
 * Check if selection is valid (at least one die)
 */
export function isValidSelection(selected: Set<string>): boolean {
  return selected.size >= 1;
}

/**
 * Calculate total points for selected dice
 */
export function calculateSelectionPoints(
  dice: DieState[],
  selected: Set<string>
): number {
  return dice
    .filter((d) => selected.has(d.id))
    .reduce((sum, d) => sum + scoreDie(d), 0);
}

/**
 * Check if game is complete (all dice scored)
 */
export function isGameComplete(dice: DieState[]): boolean {
  return dice.every((d) => d.scored);
}

/**
 * Get dice counts by type
 */
export function getDiceCounts(dice: DieState[]): Map<DieKind, number> {
  const counts = new Map<DieKind, number>();
  dice
    .filter((d) => d.inPlay && !d.scored)
    .forEach((d) => {
      counts.set(d.def.kind, (counts.get(d.def.kind) || 0) + 1);
    });
  return counts;
}

/**
 * D100 mode: combine two d10s into a d100 roll
 * Convention: "00" = 100 (scores 0 points)
 */
export function combineD100(tens: number, ones: number): number {
  // tens die shows 0-9 (treating 0 as "00")
  // ones die shows 0-9
  if (tens === 10 && ones === 10) return 100; // 00 + 0 = 100
  if (tens === 10) return ones; // 00 + N = N
  if (ones === 10) return tens * 10; // N0 + 0 = N0
  return tens * 10 + ones;
}

export function scoreD100(value: number): number {
  return 100 - value;
}

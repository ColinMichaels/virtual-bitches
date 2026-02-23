import { scoreDie, buildDicePool, initializeDice } from "./rules.js";
import { DieState } from "./types.js";

// Simple test helpers
function assertEqual(actual: any, expected: any, message?: string) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${expected}, got ${actual}`
    );
  }
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

// Tests
test("scoreDie: d6 showing 6 = 0 points", () => {
  const die: DieState = {
    id: "test",
    def: { kind: "d6", sides: 6 },
    value: 6,
    inPlay: true,
    scored: false,
  };
  assertEqual(scoreDie(die), 0);
});

test("scoreDie: d12 showing 10 = 2 points", () => {
  const die: DieState = {
    id: "test",
    def: { kind: "d12", sides: 12 },
    value: 10,
    inPlay: true,
    scored: false,
  };
  assertEqual(scoreDie(die), 2);
});

test("scoreDie: d8 showing 1 = 7 points", () => {
  const die: DieState = {
    id: "test",
    def: { kind: "d8", sides: 8 },
    value: 1,
    inPlay: true,
    scored: false,
  };
  assertEqual(scoreDie(die), 7);
});

test("buildDicePool: base pool has 15 dice", () => {
  const pool = buildDicePool();
  assertEqual(pool.length, 15);
});

test("buildDicePool: base pool has correct distribution", () => {
  const pool = buildDicePool();
  const d6s = pool.filter((d) => d.kind === "d6");
  const d8s = pool.filter((d) => d.kind === "d8");
  const d10s = pool.filter((d) => d.kind === "d10");
  const d12s = pool.filter((d) => d.kind === "d12");

  assertEqual(d6s.length, 12);
  assertEqual(d8s.length, 1);
  assertEqual(d10s.length, 1);
  assertEqual(d12s.length, 1);
});

test("buildDicePool: with d20 removes 1 d6", () => {
  const pool = buildDicePool({ addD20: true });
  const d6s = pool.filter((d) => d.kind === "d6");
  const d20s = pool.filter((d) => d.kind === "d20");

  assertEqual(pool.length, 15);
  assertEqual(d6s.length, 11);
  assertEqual(d20s.length, 1);
});

test("initializeDice: creates unique IDs", () => {
  const defs = buildDicePool();
  const dice = initializeDice(defs);
  const ids = new Set(dice.map((d) => d.id));

  assertEqual(ids.size, dice.length);
});

console.log("\nAll tests passed! ✓");

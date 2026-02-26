import assert from "node:assert/strict";
import { createBotEngine } from "./engine.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function withMockRandom(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

test("exposes bot engine contract methods", () => {
  const engine = createBotEngine();
  assert.equal(typeof engine.buildTurnRollPayload, "function");
  assert.equal(typeof engine.buildTurnScoreSummary, "function");
  assert.equal(typeof engine.resolveTurnDelayMs, "function");
});

test("buildTurnRollPayload returns null without a valid player id", () => {
  const engine = createBotEngine();
  const payload = engine.buildTurnRollPayload({
    playerId: "   ",
    turnNumber: 1,
    remainingDice: 5,
  });
  assert.equal(payload, null);
});

test("buildTurnRollPayload respects max roll dice and die-side id contract", () => {
  const engine = createBotEngine({
    maxTurnRollDice: 4,
    rollDiceSides: [6, 8],
  });

  const payload = engine.buildTurnRollPayload({
    playerId: "bot-alpha",
    turnNumber: 3,
    remainingDice: 99,
  });

  assert(payload, "Expected roll payload");
  assert.equal(payload.rollIndex, 3);
  assert.equal(payload.dice.length, 4);
  assert.deepEqual(
    payload.dice.map((die) => die.sides),
    [6, 8, 6, 8]
  );
  payload.dice.forEach((die) => {
    assert.match(die.dieId, /-s\d+$/);
    assert.match(die.dieId, new RegExp(`-s${die.sides}$`));
  });
});

test("buildTurnScoreSummary returns null for invalid roll snapshots", () => {
  const engine = createBotEngine();
  assert.equal(
    engine.buildTurnScoreSummary({
      rollSnapshot: null,
      playerId: "bot-alpha",
      remainingDice: 5,
      turnNumber: 1,
      botProfile: "balanced",
      sessionParticipants: [],
    }),
    null
  );
  assert.equal(
    engine.buildTurnScoreSummary({
      rollSnapshot: {
        dice: [{ dieId: "d6-a", sides: 6, value: 1 }],
      },
      playerId: "bot-alpha",
      remainingDice: 5,
      turnNumber: 1,
      botProfile: "balanced",
      sessionParticipants: [],
    }),
    null
  );
});

test("aggressive profile usually keeps more dice than cautious on same roll", () => {
  const engine = createBotEngine();
  const rollSnapshot = {
    serverRollId: "roll-1",
    dice: [
      { dieId: "d6-a", sides: 6, value: 6 }, // 0
      { dieId: "d12-b", sides: 12, value: 12 }, // 0
      { dieId: "d6-c", sides: 6, value: 1 }, // 5
      { dieId: "d20-d", sides: 20, value: 2 }, // 18
    ],
  };
  const sessionParticipants = [
    { playerId: "bot-alpha", score: 4, remainingDice: 10, joinedAt: 2 },
    { playerId: "human-1", score: 4, remainingDice: 10, joinedAt: 1 },
  ];

  const cautious = engine.buildTurnScoreSummary({
    rollSnapshot,
    playerId: "bot-alpha",
    remainingDice: 10,
    turnNumber: 3,
    botProfile: "cautious",
    sessionParticipants,
  });
  const aggressive = engine.buildTurnScoreSummary({
    rollSnapshot,
    playerId: "bot-alpha",
    remainingDice: 10,
    turnNumber: 3,
    botProfile: "aggressive",
    sessionParticipants,
  });

  assert(cautious, "Expected cautious score summary");
  assert(aggressive, "Expected aggressive score summary");
  assert(aggressive.selectedDiceIds.length >= cautious.selectedDiceIds.length);
  assert(aggressive.points >= cautious.points);
});

test("resolveTurnDelayMs honors per-profile timing contract", () => {
  const engine = createBotEngine({
    defaultTurnDelayRange: { min: 1000, max: 1000 },
    turnDelayByProfile: {
      cautious: { min: 2000, max: 2000 },
      balanced: { min: 1500, max: 1500 },
      aggressive: { min: 800, max: 800 },
    },
  });

  const sessionParticipants = [
    { playerId: "leader", score: 1, remainingDice: 15, joinedAt: 1 },
    { playerId: "bot-alpha", score: 12, remainingDice: 15, joinedAt: 2 },
  ];

  const cautious = withMockRandom(0.5, () =>
    engine.resolveTurnDelayMs({
      playerId: "bot-alpha",
      botProfile: "cautious",
      remainingDice: 15,
      turnNumber: 2,
      sessionParticipants,
    })
  );
  const aggressive = withMockRandom(0.5, () =>
    engine.resolveTurnDelayMs({
      playerId: "bot-alpha",
      botProfile: "aggressive",
      remainingDice: 15,
      turnNumber: 2,
      sessionParticipants,
    })
  );

  assert.equal(cautious, 1800);
  assert.equal(aggressive, 600);
  assert(cautious > aggressive);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`✗ ${name}\n`);
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  }
}

if (failed > 0) {
  process.stderr.write(`\n${failed} test(s) failed.\n`);
  process.exit(1);
}

process.stdout.write(`\n${tests.length} bot engine contract test(s) passed.\n`);

import assert from "node:assert/strict";
import {
  applyCasePattern,
  rewriteBrandTokens,
} from "./brand-tools.mjs";

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    process.stderr.write(`✗ ${name}\n`);
    throw error;
  }
}

test("applyCasePattern maps uppercase source tokens", () => {
  assert.equal(applyCasePattern("BISCUITS", "Dice Party"), "DICE PARTY");
});

test("applyCasePattern maps lowercase source tokens", () => {
  assert.equal(applyCasePattern("bitches", "Dice Party"), "dice party");
});

test("applyCasePattern maps title-case source tokens", () => {
  assert.equal(applyCasePattern("Biscuits", "dice party"), "Dice Party");
});

test("applyCasePattern leaves mixed-case source tokens as-is", () => {
  assert.equal(applyCasePattern("BiScUiTs", "Dice Party"), "Dice Party");
});

test("rewriteBrandTokens replaces multiple tokens and preserves case style", () => {
  const input = "BISCUITS biscuits Biscuits bitches";
  const result = rewriteBrandTokens(input, "Dice Party");
  assert.equal(result.replacementCount, 4);
  assert.equal(result.output, "DICE PARTY dice party Dice Party dice party");
});

test("rewriteBrandTokens respects word boundaries", () => {
  const input = "Biscuits_logo should stay, but Biscuits should change.";
  const result = rewriteBrandTokens(input, "Dice Party");
  assert.equal(result.replacementCount, 1);
  assert.equal(result.output, "Biscuits_logo should stay, but Dice Party should change.");
});

process.stdout.write("\nbrand-rewrite tests passed.\n");

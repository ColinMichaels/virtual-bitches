import assert from "node:assert/strict";
import { isSupportedSocketPayload } from "./socketPayloadValidation.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("rejects non-object payloads", () => {
  assert.equal(isSupportedSocketPayload(null), false);
  assert.equal(isSupportedSocketPayload(undefined), false);
  assert.equal(isSupportedSocketPayload("raw"), false);
});

test("accepts fire-and-forget effect payload types", () => {
  assert.equal(isSupportedSocketPayload({ type: "chaos_attack" }), true);
  assert.equal(isSupportedSocketPayload({ type: "particle:emit" }), true);
});

test("validates game_update payload fields", () => {
  assert.equal(
    isSupportedSocketPayload({
      type: "game_update",
      title: "Round Update",
      content: "Round started",
    }),
    true
  );
  assert.equal(
    isSupportedSocketPayload({
      type: "game_update",
      title: " ",
      content: "Round started",
    }),
    false
  );
});

test("validates player_notification payload fields", () => {
  assert.equal(
    isSupportedSocketPayload({
      type: "player_notification",
      message: "Heads up",
    }),
    true
  );
  assert.equal(
    isSupportedSocketPayload({
      type: "player_notification",
      message: "",
    }),
    false
  );
});

test("validates room_channel payload fields", () => {
  assert.equal(
    isSupportedSocketPayload({
      type: "room_channel",
      channel: "public",
      message: "hello",
    }),
    true
  );
  assert.equal(
    isSupportedSocketPayload({
      type: "room_channel",
      channel: "private",
      message: "hello",
    }),
    false
  );
});

test("supports turn messages", () => {
  assert.equal(isSupportedSocketPayload({ type: "turn_end" }), true);
  assert.equal(
    isSupportedSocketPayload({
      type: "turn_action",
      action: "roll",
    }),
    true
  );
  assert.equal(
    isSupportedSocketPayload({
      type: "turn_action",
      action: "unknown",
    }),
    false
  );
});

async function run() {
  let failures = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${name}`);
      console.error(error);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`All socketPayloadValidation tests passed (${tests.length}).`);
}

await run();

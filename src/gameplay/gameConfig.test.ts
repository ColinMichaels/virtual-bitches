import { buildUnifiedGameConfig } from "./gameConfig.js";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (expected: ${String(expected)}, actual: ${String(actual)})`);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test("builds demo config with fast profile and autorun", () => {
  const config = buildUnifiedGameConfig({
    mode: "demo",
    difficulty: "hard",
    botCount: 4,
    demoSpeedMode: true,
    autoRun: true,
  });
  assertEqual(config.mode, "demo", "Expected demo mode");
  assertEqual(config.difficulty, "hard", "Expected hard difficulty");
  assertEqual(config.timingProfile, "demo_fast", "Expected demo-fast timing profile");
  assertEqual(config.automation.speedMode, "fast", "Expected fast automation speed");
  assertEqual(config.automation.autoRun, true, "Expected auto-run true");
  assertEqual(config.automation.botCount, 4, "Expected bot count");
});

test("builds solo config with safe defaults", () => {
  const config = buildUnifiedGameConfig({
    mode: "solo",
    difficulty: "easy",
  });
  assertEqual(config.mode, "solo", "Expected solo mode");
  assertEqual(config.automation.enabled, false, "Expected no automation enabled by default");
  assertEqual(config.capabilities.hostControls, true, "Expected host controls enabled in solo");
  assertEqual(config.capabilities.privateChat, false, "Expected private chat disabled in solo");
});

test("normalizes invalid values safely", () => {
  const config = buildUnifiedGameConfig({
    mode: "multiplayer",
    // Intentionally invalid values to validate normalization
    difficulty: "hard",
    botCount: 99,
    demoSpeedMode: false,
  });
  assertEqual(config.automation.botCount, 4, "Expected botCount clamp to 4");
  assertEqual(config.timingProfile, "standard", "Expected standard timing profile");
  assert(config.capabilities.hostControls, "Expected host controls enabled by default");
});

console.log("\nUnified gameConfig tests passed! ✓");

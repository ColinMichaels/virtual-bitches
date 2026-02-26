import { ControlInversionService } from "./controlInversion.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (expected: ${expected}, actual: ${actual})`);
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

test("remaps nothing when inversion inactive", () => {
  const service = new ControlInversionService();
  assertEqual(service.remapKeyCode("ArrowLeft"), "ArrowLeft", "Expected no remap when inactive");
});

test("full inversion swaps directional keys", () => {
  const service = new ControlInversionService();
  service.activate("full", 1000);

  assertEqual(service.remapKeyCode("ArrowLeft"), "ArrowRight", "Expected left to invert");
  assertEqual(service.remapKeyCode("ArrowUp"), "ArrowDown", "Expected up to invert");
});

test("random inversion can be forced to always invert", () => {
  const service = new ControlInversionService();
  service.activate("random", 1000, { randomChance: 1 });

  assertEqual(service.remapKeyCode("KeyA"), "KeyD", "Expected A to invert when random chance is 1");
});

test("does not activate when disabled by accessibility callback", () => {
  const service = new ControlInversionService({
    isEnabled: () => false,
  });
  const id = service.activate("full", 1000);

  assertEqual(id, null, "Expected activation to be blocked");
  assert(!service.isActive(), "Expected no active inversion state");
});

console.log("\nControl inversion tests passed! ✓");

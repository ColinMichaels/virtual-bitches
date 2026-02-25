import { UpgradeProgressionService } from "./progressionService.js";

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

function createMockStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      Object.keys(store).forEach((key) => delete store[key]);
    },
    getItem(key: string) {
      return store[key] ?? null;
    },
    key(index: number) {
      const keys = Object.keys(store);
      return keys[index] ?? null;
    },
    removeItem(key: string) {
      delete store[key];
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
  };
}

test("starts with level 1 unlocked for all camera attack families", () => {
  const service = new UpgradeProgressionService({ storage: createMockStorage() });
  assertEqual(service.getCurrentLevel("screen_shake"), 1, "screen_shake should start at level 1");
  assertEqual(service.getCurrentLevel("drunk_vision"), 1, "drunk_vision should start at level 1");
  assertEqual(service.getCurrentLevel("camera_spin"), 1, "camera_spin should start at level 1");
});

test("awards XP for ability usage and successful disruptions", () => {
  const service = new UpgradeProgressionService({ storage: createMockStorage() });
  service.onAbilityUsed("screen_shake");
  service.onSuccessfulDisruption("screen_shake");

  const progress = service.getAbilityProgress("screen_shake");
  assertEqual(progress.xp, 35, "Expected 10 XP for use + 25 XP for successful disruption");
  assertEqual(progress.timesUsed, 1, "Expected timesUsed to increment");
  assertEqual(progress.successfulDisruptions, 1, "Expected successfulDisruptions to increment");
});

test("prevents unlocking levels when requirements are not met", () => {
  const service = new UpgradeProgressionService({ storage: createMockStorage() });
  const validation = service.canUnlockLevel("screen_shake", 2);
  assertEqual(validation.allowed, false, "Level 2 should not be unlockable without XP");
  assertEqual(validation.reason, "insufficient_xp", "Expected insufficient_xp reason");
});

test("unlocks level 2 when XP requirement is met", () => {
  const service = new UpgradeProgressionService({ storage: createMockStorage() });
  service.earnAbilityXP("screen_shake", 100);

  const validation = service.unlockLevel("screen_shake", 2);
  assertEqual(validation.allowed, true, "Unlock should succeed at 100 XP");
  assertEqual(service.getCurrentLevel("screen_shake"), 2, "Current level should update to 2");
});

test("requires achievement for level 4 and currency for level 5", () => {
  const service = new UpgradeProgressionService({ storage: createMockStorage() });
  service.earnAbilityXP("screen_shake", 700);
  assertEqual(service.unlockLevel("screen_shake", 2).allowed, true, "Should unlock level 2");
  assertEqual(service.unlockLevel("screen_shake", 3).allowed, true, "Should unlock level 3");

  const missingAchievement = service.unlockLevel("screen_shake", 4);
  assertEqual(missingAchievement.allowed, false, "Level 4 should require achievement");
  assertEqual(missingAchievement.reason, "missing_achievement", "Expected missing_achievement");

  service.grantAchievement("shake_master");
  assertEqual(service.unlockLevel("screen_shake", 4).allowed, true, "Should unlock level 4");

  service.awardTokens(100);
  const insufficientTokens = service.unlockLevel("screen_shake", 5);
  assertEqual(insufficientTokens.allowed, false, "Level 5 should require enough tokens");
  assertEqual(insufficientTokens.reason, "insufficient_tokens", "Expected insufficient_tokens");

  service.awardTokens(60);
  const unlockedFive = service.unlockLevel("screen_shake", 5);
  assertEqual(unlockedFive.allowed, true, "Level 5 should unlock after enough tokens");
  assertEqual(service.getTokenBalance(), 10, "Level 5 unlock should spend 150 chaos tokens");
});

test("prevents skipping levels in progression chain", () => {
  const service = new UpgradeProgressionService({ storage: createMockStorage() });
  service.earnAbilityXP("camera_spin", 1000);
  const validation = service.canUnlockLevel("camera_spin", 3);

  assertEqual(validation.allowed, false, "Should not unlock level 3 before level 2");
  assertEqual(validation.reason, "previous_level_locked", "Expected previous_level_locked");
});

test("persists progression state across service instances", () => {
  const storage = createMockStorage();
  const serviceA = new UpgradeProgressionService({ storage });
  serviceA.earnAbilityXP("drunk_vision", 100);
  serviceA.unlockLevel("drunk_vision", 2);
  serviceA.awardTokens(42);
  serviceA.grantAchievement("bartender");

  const serviceB = new UpgradeProgressionService({ storage });
  assertEqual(serviceB.getCurrentLevel("drunk_vision"), 2, "Expected unlocked level to persist");
  assertEqual(serviceB.getTokenBalance(), 42, "Expected token balance to persist");
  assert(serviceB.hasAchievement("bartender"), "Expected achievement to persist");
});

console.log("\nUpgradeProgressionService tests passed! ✓");

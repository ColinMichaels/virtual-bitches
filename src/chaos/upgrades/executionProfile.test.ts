import {
  buildCameraAttackMessageFromProgression,
  resolveExecutionFromAttackMessage,
  resolveExecutionProfile,
} from "./executionProfile.js";
import { UpgradeProgressionService } from "./progressionService.js";
import type { CameraAttackMessage } from "../types.js";

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
  const map = new Map<string, string>();

  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string): string | null {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    key(index: number): string | null {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    setItem(key: string, value: string): void {
      map.set(key, value);
    },
  };
}

function createMessage(overrides: Partial<CameraAttackMessage> = {}): CameraAttackMessage {
  return {
    type: "chaos_attack",
    attackType: "camera_effect",
    gameId: "game-1",
    attackerId: "attacker-1",
    targetId: "local-player",
    abilityId: "screen_shake",
    level: 1,
    effectType: "shake",
    intensity: 0.8,
    duration: 2000,
    chaosPointsCost: 20,
    timestamp: Date.now(),
    ...overrides,
  };
}

test("resolves screen shake level profile values", () => {
  const profile = resolveExecutionProfile("screen_shake", 2);

  assertEqual(profile.effectType, "shake", "Expected shake effect");
  assertEqual(profile.level, 2, "Expected level 2 profile");
  assertEqual(profile.intensity, 0.5, "Expected intensity from level 2 definition");
  assertEqual(profile.duration, 3000, "Expected duration from level 2 definition");
  assertEqual(profile.metadata?.aftershock, true, "Expected aftershock metadata from level features");
});

test("builds attack message from progression unlocked level", () => {
  const progression = new UpgradeProgressionService({ storage: createMockStorage() });
  progression.earnAbilityXP("camera_spin", 500);
  progression.unlockLevel("camera_spin", 2);
  progression.unlockLevel("camera_spin", 3);

  const message = buildCameraAttackMessageFromProgression("camera_spin", {
    progression,
    gameId: "game-local",
    attackerId: "local-player",
    targetId: "opponent-1",
  });

  assertEqual(message.level, 3, "Expected current unlocked level");
  assertEqual(message.effectType, "spin", "Expected spin effect type");
  assertEqual(message.duration, 6000, "Expected duration from level 3 definition");
  assertEqual(message.metadata?.rotations, 5, "Expected level rotations metadata");
});

test("fills metadata from upgrade profile when effect type matches", () => {
  const execution = resolveExecutionFromAttackMessage(
    createMessage({
      abilityId: "camera_spin",
      level: 4,
      effectType: "spin",
      metadata: undefined,
    })
  );

  assertEqual(execution.effectType, "spin", "Expected profile effect type");
  assertEqual(execution.metadata?.rotations, 8, "Expected level 4 rotations");
  assertEqual(execution.metadata?.zoomDistance, -6, "Expected level 4 zoom metadata");
});

test("preserves legacy effect mapping when ability/effect mismatch is sent", () => {
  const execution = resolveExecutionFromAttackMessage(
    createMessage({
      abilityId: "screen_shake",
      effectType: "drunk",
      intensity: 1.4,
    })
  );

  assertEqual(execution.effectType, "drunk", "Expected message effect type to be preserved");
  assertEqual(execution.intensity, 1.4, "Expected intensity passthrough");
  assert(execution.metadata === undefined, "Expected no profile metadata for mismatched effect");
});

console.log("\nExecution profile tests passed! ✓");

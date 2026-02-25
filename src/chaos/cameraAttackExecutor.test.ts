import { CameraAttackExecutor } from "./cameraAttackExecutor.js";
import type { CameraAttackMessage } from "./types.js";
import type { CameraEffect, CameraEffectType, ICameraEffectsService } from "../services/cameraEffects.js";
import type { IControlInversionService } from "../services/controlInversion.js";
import type { DrunkSeverity } from "./types.js";

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

class MockCameraEffectsService implements ICameraEffectsService {
  public calls: string[] = [];
  public lastDrunkSeverity?: DrunkSeverity;
  public lastShakeIntensity?: number;
  public lastSpinRotations?: number;
  public lastDuration?: number;
  public lastTargetId?: string;

  shake(intensity: number, duration: number, targetPlayerId?: string): string {
    this.calls.push("shake");
    this.lastShakeIntensity = intensity;
    this.lastDuration = duration;
    this.lastTargetId = targetPlayerId;
    return "shake-id";
  }

  spin(rotations: number, duration: number, targetPlayerId?: string): string {
    this.calls.push("spin");
    this.lastSpinRotations = rotations;
    this.lastDuration = duration;
    this.lastTargetId = targetPlayerId;
    return "spin-id";
  }

  zoom(): string {
    this.calls.push("zoom");
    return "zoom-id";
  }

  drunk(severity: DrunkSeverity, duration: number, targetPlayerId?: string): string {
    this.calls.push("drunk");
    this.lastDrunkSeverity = severity;
    this.lastDuration = duration;
    this.lastTargetId = targetPlayerId;
    return "drunk-id";
  }

  stopEffect(): boolean {
    return true;
  }

  clearAllEffects(): void {}

  getActiveEffects(): CameraEffect[] {
    return [];
  }

  isEffectActive(_effectType: CameraEffectType): boolean {
    return false;
  }
}

class MockControlInversionService implements IControlInversionService {
  public calls = 0;
  public lastMode?: "random" | "full";
  public lastDuration?: number;
  public lastChance?: number;

  activate(
    mode: "random" | "full",
    durationMs: number,
    options: { randomChance?: number } = {}
  ): string {
    this.calls += 1;
    this.lastMode = mode;
    this.lastDuration = durationMs;
    this.lastChance = options.randomChance;
    return "inversion-id";
  }

  remapKeyCode(code: string): string {
    return code;
  }

  clearAll(): void {}

  isActive(): boolean {
    return this.calls > 0;
  }

  getMode(): "none" | "random" | "full" {
    return this.lastMode ?? "none";
  }
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

test("executes shake attack for local player", () => {
  const cameraEffects = new MockCameraEffectsService();
  const executor = new CameraAttackExecutor(cameraEffects, () => "local-player");

  const effectId = executor.execute(createMessage({ effectType: "shake", intensity: 0.4 }));

  assertEqual(effectId, "shake-id", "Should return effect id");
  assertEqual(cameraEffects.calls.length, 1, "Should call one effect");
  assertEqual(cameraEffects.calls[0], "shake", "Should call shake");
  assertEqual(cameraEffects.lastShakeIntensity, 0.4, "Should pass intensity through");
});

test("ignores attacks targeting another player", () => {
  const cameraEffects = new MockCameraEffectsService();
  const executor = new CameraAttackExecutor(cameraEffects, () => "local-player");

  const effectId = executor.execute(createMessage({ targetId: "other-player" }));

  assertEqual(effectId, null, "Should return null for non-local target");
  assertEqual(cameraEffects.calls.length, 0, "Should not execute effects");
});

test("resolves broadcast target to local player id", () => {
  const cameraEffects = new MockCameraEffectsService();
  const executor = new CameraAttackExecutor(cameraEffects, () => "player-local");

  executor.execute(createMessage({ effectType: "shake", targetId: "all" }));

  assertEqual(cameraEffects.lastTargetId, "player-local", "Should map broadcast target to local player id");
});

test("maps drunk intensity to severity by default", () => {
  const cameraEffects = new MockCameraEffectsService();
  const executor = new CameraAttackExecutor(cameraEffects, () => "local-player");

  executor.execute(createMessage({ effectType: "drunk", intensity: 1.3 }));

  assertEqual(cameraEffects.calls[0], "drunk", "Should execute drunk effect");
  assertEqual(cameraEffects.lastDrunkSeverity, "blackout", "Should map high intensity to blackout");
});

test("uses explicit drunk severity metadata when provided", () => {
  const cameraEffects = new MockCameraEffectsService();
  const executor = new CameraAttackExecutor(cameraEffects, () => "local-player");

  executor.execute(
    createMessage({
      effectType: "drunk",
      intensity: 0.2,
      metadata: { severity: "medium" },
    })
  );

  assert(cameraEffects.lastDrunkSeverity === "medium", "Should honor metadata severity override");
});

test("applies level profile metadata for spin rotations", () => {
  const cameraEffects = new MockCameraEffectsService();
  const executor = new CameraAttackExecutor(cameraEffects, () => "local-player");

  executor.execute(
    createMessage({
      abilityId: "camera_spin",
      level: 4,
      effectType: "spin",
      metadata: undefined,
    })
  );

  assertEqual(cameraEffects.calls[0], "spin", "Should execute spin");
  assertEqual(cameraEffects.lastSpinRotations, 8, "Should use level 4 rotation count from profile");
});

test("activates full inversion for blackout drunk effects", () => {
  const cameraEffects = new MockCameraEffectsService();
  const inversion = new MockControlInversionService();
  const executor = new CameraAttackExecutor(cameraEffects, () => "local-player", {
    controlInversion: inversion,
  });

  executor.execute(
    createMessage({
      abilityId: "drunk_vision",
      level: 4,
      effectType: "drunk",
      duration: 1800,
    })
  );

  assertEqual(inversion.calls, 1, "Should activate inversion");
  assertEqual(inversion.lastMode, "full", "Expected blackout inversion mode");
  assertEqual(inversion.lastDuration, 1800, "Expected inversion duration to match effect duration");
});

test("reduces drunk severity when accessibility reduction is enabled", () => {
  const cameraEffects = new MockCameraEffectsService();
  const executor = new CameraAttackExecutor(cameraEffects, () => "local-player", {
    getAccessibilitySettings: () => ({ reduceCameraEffects: true }),
  });

  executor.execute(
    createMessage({
      abilityId: "drunk_vision",
      level: 4,
      effectType: "drunk",
      duration: 2000,
    })
  );

  assertEqual(cameraEffects.lastDrunkSeverity, "medium", "Expected blackout to downgrade to medium");
  assertEqual(cameraEffects.lastDuration, 1500, "Expected duration reduction safeguard");
});

console.log("\nCameraAttackExecutor tests passed! ✓");

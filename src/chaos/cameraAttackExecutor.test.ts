import { CameraAttackExecutor } from "./cameraAttackExecutor.js";
import type { CameraAttackMessage } from "./types.js";
import type { CameraEffect, CameraEffectType, ICameraEffectsService } from "../services/cameraEffects.js";
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
  public lastTargetId?: string;

  shake(intensity: number, _duration: number, targetPlayerId?: string): string {
    this.calls.push("shake");
    this.lastShakeIntensity = intensity;
    this.lastTargetId = targetPlayerId;
    return "shake-id";
  }

  spin(_rotations: number, _duration: number, targetPlayerId?: string): string {
    this.calls.push("spin");
    this.lastTargetId = targetPlayerId;
    return "spin-id";
  }

  zoom(): string {
    this.calls.push("zoom");
    return "zoom-id";
  }

  drunk(severity: DrunkSeverity, _duration: number, targetPlayerId?: string): string {
    this.calls.push("drunk");
    this.lastDrunkSeverity = severity;
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

console.log("\nCameraAttackExecutor tests passed! ✓");

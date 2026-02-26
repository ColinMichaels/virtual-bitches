import { CameraEffectsService } from "./cameraEffects.js";
import type { DrunkVisionSettings } from "../chaos/effects/postProcessingPipeline.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (expected: ${expected}, actual: ${actual})`);
  }
}

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MockDrunkPostProcessing {
  applyCalls: DrunkVisionSettings[] = [];
  blackoutCalls = 0;
  clearAllCalls = 0;

  apply(settings: DrunkVisionSettings): void {
    this.applyCalls.push(settings);
  }

  triggerBlackout(): void {
    this.blackoutCalls += 1;
  }

  clearAll(): void {
    this.clearAllCalls += 1;
  }
}

function createService() {
  const camera = {
    alpha: 0,
    beta: 1,
    radius: 38,
    lowerBetaLimit: 0.1,
    upperBetaLimit: Math.PI / 2.2,
    lowerRadiusLimit: 25,
    upperRadiusLimit: 60,
  };
  const postProcessing = new MockDrunkPostProcessing();
  const scene = { camera, scene: {} };
  const service = new CameraEffectsService(scene as any, {
    drunkPostProcessing: postProcessing,
    emitParticles: false,
  });

  return { service, postProcessing };
}

await test("queues conflicting spin effects and drains after completion", async () => {
  const { service } = createService();
  const first = service.spin(1.2, 160);
  const second = service.spin(0.6, 160);

  assert(service.getActiveEffects().some((effect) => effect.id === first), "First spin should be active");
  assert(!service.getActiveEffects().some((effect) => effect.id === second), "Second spin should be queued");

  await sleep(220);
  assert(service.getActiveEffects().some((effect) => effect.id === second), "Queued spin should start next");

  await sleep(220);
  assert(!service.isEffectActive("spin"), "Spin effects should be fully drained");
});

await test("stopEffect removes queued effects", async () => {
  const { service } = createService();
  service.zoom(-4, 180);
  const queuedZoom = service.zoom(-2, 180);

  assertEqual(service.stopEffect(queuedZoom), true, "Queued effect should be removable");

  await sleep(240);
  assert(!service.getActiveEffects().some((effect) => effect.id === queuedZoom), "Stopped queued effect should not run");
});

await test("drunk blackout applies post-processing and blackout pulse", async () => {
  const { service, postProcessing } = createService();
  const effectId = service.drunk("blackout", 260);

  assertEqual(postProcessing.applyCalls.length, 1, "Drunk effect should apply post-processing");
  assert(postProcessing.applyCalls[0].vignetteWeight >= 0.7, "Blackout should use heavy vignette");
  assert(postProcessing.blackoutCalls >= 1, "Blackout should trigger at least one fade pulse");

  await sleep(340);
  assert(!service.getActiveEffects().some((effect) => effect.id === effectId), "Blackout effect should expire");
  assert(postProcessing.clearAllCalls >= 1, "Post-processing should clear after effect ends");
});

await test("drunk child effects get reserved stacking lane", async () => {
  const { service } = createService();
  service.spin(1, 260);
  service.drunk("medium", 260);

  const spinCount = service.getActiveEffects().filter((effect) => effect.type === "spin").length;
  assertEqual(spinCount, 2, "Expected external + drunk-child spin to coexist");

  const queuedExternalSpin = service.spin(0.3, 200);
  assert(
    !service.getActiveEffects().some((effect) => effect.id === queuedExternalSpin),
    "Additional external spin should queue while stacked spins are active"
  );

  service.clearAllEffects();
});

console.log("\nCameraEffectsService tests passed! ✓");

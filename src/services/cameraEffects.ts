import type { GameScene } from "../render/scene.js";
import type { DrunkSeverity } from "../chaos/types.js";
import {
  DrunkVisionPostProcessingPipeline,
  type DrunkVisionSettings,
} from "../chaos/effects/postProcessingPipeline.js";
import { logger } from "../utils/logger.js";
import {
  clearDrunkAttack,
  emitDrunkAttack,
  emitShakeAttack,
  emitSpinAttack,
} from "../particles/presets/chaosEffects.js";

const log = logger.create("CameraEffects");

const MIN_EFFECT_DURATION_MS = 100;
const DEFAULT_TARGET_PLAYER_ID = "local-player";
const MAX_QUEUED_EFFECTS = 20;
const BLACKOUT_PULSE_INTERVAL_MS = 3000;
const BLACKOUT_FADE_IN_MS = 180;
const BLACKOUT_HOLD_MS = 420;
const BLACKOUT_FADE_OUT_MS = 260;

const MAX_ACTIVE_BY_TYPE: Record<CameraEffectType, number> = {
  shake: 1,
  spin: 1,
  zoom: 1,
  drunk: 1,
};

const DRUNK_VISION_SETTINGS: Record<DrunkSeverity, DrunkVisionSettings> = {
  light: {
    blurKernel: 4,
    doubleVisionOffsetPx: 3,
    doubleVisionStrength: 0.12,
    doubleVisionWobblePx: 1.5,
    vignetteWeight: 0.2,
    chromaticAberration: 12,
  },
  medium: {
    blurKernel: 9,
    doubleVisionOffsetPx: 10,
    doubleVisionStrength: 0.24,
    doubleVisionWobblePx: 4,
    vignetteWeight: 0.42,
    chromaticAberration: 28,
  },
  blackout: {
    blurKernel: 14,
    doubleVisionOffsetPx: 22,
    doubleVisionStrength: 0.38,
    doubleVisionWobblePx: 8,
    vignetteWeight: 0.72,
    chromaticAberration: 48,
  },
};

type EffectSource = "external" | "drunk-child";

export type CameraEffectType = "shake" | "spin" | "zoom" | "drunk";

export interface CameraEffect {
  id: string;
  type: CameraEffectType;
  intensity: number;
  duration: number;
  startTime: number;
}

export interface ICameraEffectsService {
  shake(intensity: number, duration: number, targetPlayerId?: string): string;
  spin(rotations: number, duration: number, targetPlayerId?: string): string;
  zoom(distance: number, duration: number): string;
  drunk(severity: DrunkSeverity, duration: number, targetPlayerId?: string): string;
  stopEffect(effectId: string): boolean;
  clearAllEffects(): void;
  getActiveEffects(): CameraEffect[];
  isEffectActive(effectType: CameraEffectType): boolean;
}

interface IPostProcessingPipeline {
  apply(settings: DrunkVisionSettings): void;
  triggerBlackout(fadeInMs?: number, holdMs?: number, fadeOutMs?: number): void;
  clearAll(): void;
}

interface CameraEffectsServiceOptions {
  drunkPostProcessing?: IPostProcessingPipeline;
  emitParticles?: boolean;
}

interface ActiveCameraEffect {
  effect: CameraEffect;
  source: EffectSource;
  frameHandle?: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  intervalHandles: Array<ReturnType<typeof setInterval>>;
  childEffectIds: string[];
  particleInstanceId?: string;
  lastAlphaOffset: number;
  lastBetaOffset: number;
  lastRadiusOffset: number;
}

interface EffectOptions {
  emitParticles?: boolean;
}

interface InternalEffectOptions extends EffectOptions {
  source?: EffectSource;
}

interface QueuedEffectRequest {
  effect: CameraEffect;
  source: EffectSource;
  start: (runtime: ActiveCameraEffect) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export class CameraEffectsService implements ICameraEffectsService {
  private readonly scene: GameScene;
  private readonly activeEffects = new Map<string, ActiveCameraEffect>();
  private readonly queuedEffects: QueuedEffectRequest[] = [];
  private readonly drunkPostProcessing: IPostProcessingPipeline;
  private readonly shouldEmitParticles: boolean;

  constructor(scene: GameScene, options: CameraEffectsServiceOptions = {}) {
    this.scene = scene;
    this.shouldEmitParticles = options.emitParticles ?? true;
    this.drunkPostProcessing =
      options.drunkPostProcessing ??
      new DrunkVisionPostProcessingPipeline(this.scene.scene, this.scene.camera);
  }

  shake(
    intensity: number,
    duration: number,
    targetPlayerId: string = DEFAULT_TARGET_PLAYER_ID,
    options: InternalEffectOptions = {}
  ): string {
    const safeIntensity = clamp(intensity, 0.1, 2.0);
    const source = options.source ?? "external";

    return this.startOrQueueEffect(
      "shake",
      safeIntensity,
      duration,
      source,
      (runtime) => {
        const start = this.now();

        if (this.shouldEmitParticles && options.emitParticles !== false) {
          emitShakeAttack(targetPlayerId, safeIntensity);
        }

        const tick = (timestamp: number) => {
          if (!this.activeEffects.has(runtime.effect.id)) return;

          const elapsed = timestamp - start;
          const progress = clamp(elapsed / runtime.effect.duration, 0, 1);
          const dampening = 1 - progress * 0.5;

          const alphaOffset = (Math.random() - 0.5) * safeIntensity * 0.12 * dampening;
          const betaOffset = (Math.random() - 0.5) * safeIntensity * 0.08 * dampening;

          this.applyAlphaOffset(runtime, alphaOffset);
          this.applyBetaOffset(runtime, betaOffset);

          if (progress >= 1) {
            this.removeEffect(runtime.effect.id, true);
            return;
          }

          runtime.frameHandle = this.scheduleFrame(tick);
        };

        runtime.frameHandle = this.scheduleFrame(tick);
      }
    );
  }

  spin(
    rotations: number,
    duration: number,
    targetPlayerId: string = DEFAULT_TARGET_PLAYER_ID,
    options: InternalEffectOptions = {}
  ): string {
    const safeRotations = clamp(rotations, -8, 8);
    const source = options.source ?? "external";

    return this.startOrQueueEffect("spin", Math.abs(safeRotations), duration, source, (runtime) => {
      const start = this.now();
      const totalRotation = safeRotations * Math.PI * 2;

      if (this.shouldEmitParticles && options.emitParticles !== false) {
        emitSpinAttack(targetPlayerId, Math.abs(safeRotations));
      }

      const tick = (timestamp: number) => {
        if (!this.activeEffects.has(runtime.effect.id)) return;

        const elapsed = timestamp - start;
        const progress = clamp(elapsed / runtime.effect.duration, 0, 1);
        const offset = totalRotation * easeInOutCubic(progress);

        this.applyAlphaOffset(runtime, offset);

        if (progress >= 1) {
          this.removeEffect(runtime.effect.id, true);
          return;
        }

        runtime.frameHandle = this.scheduleFrame(tick);
      };

      runtime.frameHandle = this.scheduleFrame(tick);
    });
  }

  zoom(distance: number, duration: number, options: InternalEffectOptions = {}): string {
    const safeDistance = clamp(distance, -20, 20);
    const source = options.source ?? "external";

    return this.startOrQueueEffect("zoom", Math.abs(safeDistance), duration, source, (runtime) => {
      const start = this.now();

      const tick = (timestamp: number) => {
        if (!this.activeEffects.has(runtime.effect.id)) return;

        const elapsed = timestamp - start;
        const progress = clamp(elapsed / runtime.effect.duration, 0, 1);

        let offset: number;
        if (progress <= 0.5) {
          offset = safeDistance * easeOutCubic(progress * 2);
        } else {
          const returnPhase = (progress - 0.5) * 2;
          offset = safeDistance * (1 - easeInOutCubic(returnPhase));
        }

        this.applyRadiusOffset(runtime, offset);

        if (progress >= 1) {
          this.removeEffect(runtime.effect.id, true);
          return;
        }

        runtime.frameHandle = this.scheduleFrame(tick);
      };

      runtime.frameHandle = this.scheduleFrame(tick);
    });
  }

  drunk(
    severity: DrunkSeverity,
    duration: number,
    targetPlayerId: string = DEFAULT_TARGET_PLAYER_ID
  ): string {
    const intensityBySeverity: Record<DrunkSeverity, number> = {
      light: 0.35,
      medium: 0.7,
      blackout: 1.2,
    };

    return this.startOrQueueEffect(
      "drunk",
      intensityBySeverity[severity],
      duration,
      "external",
      (runtime) => {
        runtime.particleInstanceId = this.shouldEmitParticles
          ? emitDrunkAttack(targetPlayerId, severity, runtime.effect.duration)
          : undefined;
        this.drunkPostProcessing.apply(DRUNK_VISION_SETTINGS[severity]);

        if (severity === "blackout") {
          this.drunkPostProcessing.triggerBlackout(
            BLACKOUT_FADE_IN_MS,
            BLACKOUT_HOLD_MS,
            BLACKOUT_FADE_OUT_MS
          );

          const blackoutInterval = setInterval(() => {
            if (!this.activeEffects.has(runtime.effect.id)) {
              clearInterval(blackoutInterval);
              return;
            }
            this.drunkPostProcessing.triggerBlackout(
              BLACKOUT_FADE_IN_MS,
              BLACKOUT_HOLD_MS,
              BLACKOUT_FADE_OUT_MS
            );
          }, BLACKOUT_PULSE_INTERVAL_MS);

          runtime.intervalHandles.push(blackoutInterval);
        }

        switch (severity) {
          case "light":
            runtime.childEffectIds.push(
              this.shake(0.2, runtime.effect.duration, targetPlayerId, {
                emitParticles: false,
                source: "drunk-child",
              }),
              this.zoom(-2, runtime.effect.duration, { source: "drunk-child" })
            );
            break;
          case "medium":
            runtime.childEffectIds.push(
              this.shake(0.35, runtime.effect.duration, targetPlayerId, {
                emitParticles: false,
                source: "drunk-child",
              }),
              this.spin(0.8, runtime.effect.duration, targetPlayerId, {
                emitParticles: false,
                source: "drunk-child",
              }),
              this.zoom(-3, runtime.effect.duration, { source: "drunk-child" })
            );
            break;
          case "blackout":
            runtime.childEffectIds.push(
              this.shake(0.8, runtime.effect.duration, targetPlayerId, {
                emitParticles: false,
                source: "drunk-child",
              }),
              this.spin(2, runtime.effect.duration, targetPlayerId, {
                emitParticles: false,
                source: "drunk-child",
              }),
              this.zoom(-5, runtime.effect.duration, { source: "drunk-child" })
            );
            break;
        }

        runtime.timeoutHandle = setTimeout(() => {
          this.removeEffect(runtime.effect.id, true);
        }, runtime.effect.duration);
      }
    );
  }

  stopEffect(effectId: string): boolean {
    return this.stopEffectInternal(effectId, true);
  }

  clearAllEffects(): void {
    this.queuedEffects.length = 0;
    Array.from(this.activeEffects.keys()).forEach((effectId) => this.removeEffect(effectId, false));
    this.drunkPostProcessing.clearAll();
  }

  getActiveEffects(): CameraEffect[] {
    return Array.from(this.activeEffects.values()).map((runtime) => runtime.effect);
  }

  isEffectActive(effectType: CameraEffectType): boolean {
    return Array.from(this.activeEffects.values()).some(
      (runtime) => runtime.effect.type === effectType
    );
  }

  private startOrQueueEffect(
    type: CameraEffectType,
    intensity: number,
    duration: number,
    source: EffectSource,
    start: (runtime: ActiveCameraEffect) => void
  ): string {
    const effect = this.createEffect(type, intensity, duration);
    const request: QueuedEffectRequest = { effect, source, start };

    if (this.canStartEffect(type, source)) {
      this.startEffectRequest(request);
      return effect.id;
    }

    this.enqueueEffect(request);
    return effect.id;
  }

  private createEffect(type: CameraEffectType, intensity: number, duration: number): CameraEffect {
    return {
      id: this.generateId(),
      type,
      intensity,
      duration: Math.max(MIN_EFFECT_DURATION_MS, Math.round(duration)),
      startTime: Date.now(),
    };
  }

  private createRuntime(effect: CameraEffect, source: EffectSource): ActiveCameraEffect {
    return {
      effect,
      source,
      intervalHandles: [],
      childEffectIds: [],
      lastAlphaOffset: 0,
      lastBetaOffset: 0,
      lastRadiusOffset: 0,
    };
  }

  private startEffectRequest(request: QueuedEffectRequest): void {
    request.effect.startTime = Date.now();
    const runtime = this.createRuntime(request.effect, request.source);
    this.activeEffects.set(runtime.effect.id, runtime);
    log.debug(`Started camera effect: ${runtime.effect.type} (${runtime.effect.id})`);
    request.start(runtime);
  }

  private enqueueEffect(request: QueuedEffectRequest): void {
    if (this.queuedEffects.length >= MAX_QUEUED_EFFECTS) {
      const dropped = this.queuedEffects.shift();
      if (dropped) {
        log.warn(`Dropped queued effect due to queue limit: ${dropped.effect.type} (${dropped.effect.id})`);
      }
    }

    this.queuedEffects.push(request);
    log.debug(`Queued camera effect: ${request.effect.type} (${request.effect.id})`);
  }

  private drainEffectQueue(): void {
    if (this.queuedEffects.length === 0) return;

    for (let i = 0; i < this.queuedEffects.length; ) {
      const request = this.queuedEffects[i];
      if (!this.canStartEffect(request.effect.type, request.source)) {
        i += 1;
        continue;
      }

      this.queuedEffects.splice(i, 1);
      this.startEffectRequest(request);
    }
  }

  private canStartEffect(type: CameraEffectType, source: EffectSource): boolean {
    return this.countActiveEffects(type) < this.getTypeLimit(type, source);
  }

  private countActiveEffects(type: CameraEffectType): number {
    let count = 0;
    for (const runtime of this.activeEffects.values()) {
      if (runtime.effect.type === type) {
        count += 1;
      }
    }
    return count;
  }

  private getTypeLimit(type: CameraEffectType, source: EffectSource): number {
    const baseLimit = MAX_ACTIVE_BY_TYPE[type];
    if (source === "drunk-child" && type !== "drunk") {
      return baseLimit + 1;
    }
    return baseLimit;
  }

  private stopEffectInternal(effectId: string, drainQueue: boolean): boolean {
    if (this.removeEffect(effectId, drainQueue)) {
      return true;
    }
    return this.removeQueuedEffect(effectId);
  }

  private removeQueuedEffect(effectId: string): boolean {
    const index = this.queuedEffects.findIndex((request) => request.effect.id === effectId);
    if (index === -1) return false;

    const [removed] = this.queuedEffects.splice(index, 1);
    log.debug(`Removed queued camera effect: ${removed.effect.type} (${effectId})`);
    return true;
  }

  private removeEffect(effectId: string, drainQueue: boolean): boolean {
    const runtime = this.activeEffects.get(effectId);
    if (!runtime) return false;

    if (runtime.frameHandle !== undefined) {
      this.cancelFrame(runtime.frameHandle);
      runtime.frameHandle = undefined;
    }
    if (runtime.timeoutHandle) {
      clearTimeout(runtime.timeoutHandle);
      runtime.timeoutHandle = undefined;
    }
    runtime.intervalHandles.forEach((intervalHandle) => clearInterval(intervalHandle));
    runtime.intervalHandles = [];

    this.clearCameraOffsets(runtime);

    if (runtime.particleInstanceId) {
      clearDrunkAttack(runtime.particleInstanceId);
      runtime.particleInstanceId = undefined;
    }

    runtime.childEffectIds.forEach((childId) => this.stopEffectInternal(childId, false));
    runtime.childEffectIds = [];

    if (runtime.effect.type === "drunk") {
      this.drunkPostProcessing.clearAll();
    }

    this.activeEffects.delete(effectId);
    log.debug(`Stopped camera effect: ${runtime.effect.type} (${effectId})`);

    if (drainQueue) {
      this.drainEffectQueue();
    }

    return true;
  }

  private applyAlphaOffset(runtime: ActiveCameraEffect, offset: number): void {
    if (runtime.lastAlphaOffset !== 0) {
      this.scene.camera.alpha -= runtime.lastAlphaOffset;
    }
    this.scene.camera.alpha += offset;
    runtime.lastAlphaOffset = offset;
  }

  private applyBetaOffset(runtime: ActiveCameraEffect, offset: number): void {
    if (runtime.lastBetaOffset !== 0) {
      this.scene.camera.beta -= runtime.lastBetaOffset;
    }

    const betaBefore = this.scene.camera.beta;
    const lowerLimit = this.scene.camera.lowerBetaLimit ?? -Infinity;
    const upperLimit = this.scene.camera.upperBetaLimit ?? Infinity;
    const betaAfter = clamp(betaBefore + offset, lowerLimit, upperLimit);

    this.scene.camera.beta = betaAfter;
    runtime.lastBetaOffset = betaAfter - betaBefore;
  }

  private applyRadiusOffset(runtime: ActiveCameraEffect, offset: number): void {
    if (runtime.lastRadiusOffset !== 0) {
      this.scene.camera.radius -= runtime.lastRadiusOffset;
    }

    const radiusBefore = this.scene.camera.radius;
    const lowerLimit = this.scene.camera.lowerRadiusLimit ?? -Infinity;
    const upperLimit = this.scene.camera.upperRadiusLimit ?? Infinity;
    const radiusAfter = clamp(radiusBefore + offset, lowerLimit, upperLimit);

    this.scene.camera.radius = radiusAfter;
    runtime.lastRadiusOffset = radiusAfter - radiusBefore;
  }

  private clearCameraOffsets(runtime: ActiveCameraEffect): void {
    if (runtime.lastAlphaOffset !== 0) {
      this.scene.camera.alpha -= runtime.lastAlphaOffset;
      runtime.lastAlphaOffset = 0;
    }
    if (runtime.lastBetaOffset !== 0) {
      this.scene.camera.beta -= runtime.lastBetaOffset;
      runtime.lastBetaOffset = 0;
    }
    if (runtime.lastRadiusOffset !== 0) {
      this.scene.camera.radius -= runtime.lastRadiusOffset;
      runtime.lastRadiusOffset = 0;
    }
  }

  private scheduleFrame(callback: (timestamp: number) => void): number {
    if (typeof requestAnimationFrame === "function") {
      return requestAnimationFrame(callback);
    }
    return setTimeout(() => callback(this.now()), 16) as unknown as number;
  }

  private cancelFrame(frameHandle: number): void {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameHandle);
      return;
    }
    clearTimeout(frameHandle as unknown as ReturnType<typeof setTimeout>);
  }

  private now(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  private generateId(): string {
    return `camera-effect-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

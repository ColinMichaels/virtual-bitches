import type {
  CameraAttackMessage,
  CameraAttackMetadata,
  ControlInversionMode,
  DrunkSeverity,
} from "./types.js";
import type { ICameraEffectsService } from "../services/cameraEffects.js";
import type { IControlInversionService } from "../services/controlInversion.js";
import {
  resolveExecutionFromAttackMessage,
  type ResolvedCameraAttackExecution,
} from "./upgrades/executionProfile.js";
import { logger } from "../utils/logger.js";

const log = logger.create("CameraAttackExecutor");

interface CameraAttackExecutorAccessibilitySettings {
  reduceCameraEffects: boolean;
}

interface CameraAttackExecutorOptions {
  controlInversion?: IControlInversionService;
  getAccessibilitySettings?: () => CameraAttackExecutorAccessibilitySettings;
}

export class CameraAttackExecutor {
  private readonly cameraEffects: ICameraEffectsService;
  private readonly getLocalPlayerId: () => string;
  private readonly controlInversion?: IControlInversionService;
  private readonly getAccessibilitySettings: () => CameraAttackExecutorAccessibilitySettings;

  constructor(
    cameraEffects: ICameraEffectsService,
    getLocalPlayerId: () => string,
    options: CameraAttackExecutorOptions = {}
  ) {
    this.cameraEffects = cameraEffects;
    this.getLocalPlayerId = getLocalPlayerId;
    this.controlInversion = options.controlInversion;
    this.getAccessibilitySettings =
      options.getAccessibilitySettings ??
      (() => ({
        reduceCameraEffects: false,
      }));
  }

  execute(message: CameraAttackMessage): string | null {
    if (message.type !== "chaos_attack" || message.attackType !== "camera_effect") {
      return null;
    }

    if (!this.isLocalTarget(message.targetId)) {
      return null;
    }

    const resolvedTargetId = this.resolveTargetId(message.targetId);
    const resolvedExecution = this.applyAccessibilityAdjustments(
      resolveExecutionFromAttackMessage(message)
    );
    const effectMetadata = resolvedExecution.metadata ?? {};

    switch (resolvedExecution.effectType) {
      case "shake":
        return this.executeShake(resolvedExecution, resolvedTargetId, effectMetadata);
      case "spin":
        return this.cameraEffects.spin(
          this.resolveSpinRotations(resolvedExecution),
          resolvedExecution.duration,
          resolvedTargetId
        );
      case "zoom":
        return this.cameraEffects.zoom(
          effectMetadata.zoomDistance ?? this.normalizeIntensity(resolvedExecution.intensity, -12, 12),
          resolvedExecution.duration
        );
      case "drunk":
        return this.executeDrunk(resolvedExecution, resolvedTargetId, effectMetadata);
      case "tilt":
        log.warn("Tilt effect requested but not implemented yet");
        return null;
      default:
        return null;
    }
  }

  private executeShake(
    execution: ResolvedCameraAttackExecution,
    targetId: string,
    metadata: CameraAttackMetadata
  ): string {
    const effectId = this.cameraEffects.shake(
      this.normalizeIntensity(execution.intensity, 0.1, 2.0),
      execution.duration,
      targetId
    );

    if (metadata.aftershock) {
      const delayMs = Math.max(100, Math.round(metadata.aftershockDelayMs ?? 1200));
      setTimeout(() => {
        this.cameraEffects.shake(
          this.normalizeIntensity(execution.intensity * 0.65, 0.1, 2.0),
          Math.max(100, Math.round(execution.duration * 0.45)),
          targetId
        );
      }, delayMs);
    }

    return effectId;
  }

  private executeDrunk(
    execution: ResolvedCameraAttackExecution,
    targetId: string,
    metadata: CameraAttackMetadata
  ): string {
    const severity = metadata.severity ?? this.intensityToDrunkSeverity(execution.intensity);
    const effectId = this.cameraEffects.drunk(
      severity,
      execution.duration,
      targetId
    );

    this.applyControlInversion(metadata, severity, execution.duration);
    return effectId;
  }

  private resolveSpinRotations(execution: ResolvedCameraAttackExecution): number {
    if (typeof execution.metadata?.rotations === "number") {
      return execution.metadata.rotations;
    }
    return this.normalizeIntensity(execution.intensity, -3, 3);
  }

  private applyAccessibilityAdjustments(
    execution: ResolvedCameraAttackExecution
  ): ResolvedCameraAttackExecution {
    const settings = this.getAccessibilitySettings();
    if (!settings.reduceCameraEffects) return execution;

    const metadata: CameraAttackMetadata = { ...(execution.metadata ?? {}) };
    if (metadata.severity === "blackout") {
      metadata.severity = "medium";
    } else if (metadata.severity === "medium") {
      metadata.severity = "light";
    }

    if (metadata.controlInversion === "full") {
      metadata.controlInversion = "random";
      metadata.controlInversionChance = Math.min(
        metadata.controlInversionChance ?? 0.2,
        0.2
      );
    }

    const adjustedDuration = Math.max(100, Math.round(execution.duration * 0.75));
    const adjustedIntensity =
      execution.effectType === "drunk"
        ? this.severityToIntensity(
            metadata.severity ?? this.intensityToDrunkSeverity(execution.intensity)
          )
        : execution.intensity * 0.6;

    return {
      ...execution,
      intensity: adjustedIntensity,
      duration: adjustedDuration,
      metadata,
    };
  }

  private applyControlInversion(
    metadata: CameraAttackMetadata,
    severity: DrunkSeverity,
    duration: number
  ): void {
    if (!this.controlInversion) return;

    const mode: ControlInversionMode =
      metadata.controlInversion ??
      (severity === "blackout" ? "full" : severity === "medium" ? "random" : "none");
    if (mode === "none") return;

    const inversionDuration = Math.min(metadata.controlInversionDurationMs ?? duration, duration);
    this.controlInversion.activate(mode, inversionDuration, {
      randomChance: metadata.controlInversionChance,
    });
  }

  private severityToIntensity(severity: DrunkSeverity): number {
    switch (severity) {
      case "blackout":
        return 1.2;
      case "medium":
        return 0.7;
      case "light":
      default:
        return 0.35;
    }
  }

  private isLocalTarget(targetId: string): boolean {
    const localPlayerId = this.getLocalPlayerId();
    return (
      targetId === localPlayerId ||
      targetId === "all" ||
      targetId === "*" ||
      targetId === "local-player"
    );
  }

  private intensityToDrunkSeverity(intensity: number): DrunkSeverity {
    if (intensity >= 1.2) return "blackout";
    if (intensity >= 0.6) return "medium";
    return "light";
  }

  private resolveTargetId(targetId: string): string {
    if (targetId === "all" || targetId === "*" || targetId === "local-player") {
      return this.getLocalPlayerId();
    }
    return targetId;
  }

  private normalizeIntensity(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}

import type { CameraAttackMessage, DrunkSeverity } from "./types.js";
import type { ICameraEffectsService } from "../services/cameraEffects.js";
import { logger } from "../utils/logger.js";

const log = logger.create("CameraAttackExecutor");

export class CameraAttackExecutor {
  private readonly cameraEffects: ICameraEffectsService;
  private readonly getLocalPlayerId: () => string;

  constructor(cameraEffects: ICameraEffectsService, getLocalPlayerId: () => string) {
    this.cameraEffects = cameraEffects;
    this.getLocalPlayerId = getLocalPlayerId;
  }

  execute(message: CameraAttackMessage): string | null {
    if (message.type !== "chaos_attack" || message.attackType !== "camera_effect") {
      return null;
    }

    if (!this.isLocalTarget(message.targetId)) {
      return null;
    }

    const resolvedTargetId = this.resolveTargetId(message.targetId);

    switch (message.effectType) {
      case "shake":
        return this.cameraEffects.shake(
          this.normalizeIntensity(message.intensity, 0.1, 2.0),
          message.duration,
          resolvedTargetId
        );
      case "spin":
        return this.cameraEffects.spin(
          message.metadata?.rotations ?? this.normalizeIntensity(message.intensity, -3, 3),
          message.duration,
          resolvedTargetId
        );
      case "zoom":
        return this.cameraEffects.zoom(
          message.metadata?.zoomDistance ?? this.normalizeIntensity(message.intensity, -12, 12),
          message.duration
        );
      case "drunk":
        return this.cameraEffects.drunk(
          message.metadata?.severity ?? this.intensityToDrunkSeverity(message.intensity),
          message.duration,
          resolvedTargetId
        );
      case "tilt":
        log.warn("Tilt effect requested but not implemented yet");
        return null;
      default:
        return null;
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

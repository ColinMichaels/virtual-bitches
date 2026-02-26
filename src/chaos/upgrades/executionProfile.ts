import type {
  CameraAttackEffectType,
  CameraAttackMessage,
  CameraAttackMetadata,
  DrunkSeverity,
} from "../types.js";
import { CAMERA_ABILITY_UPGRADE_TREES } from "./definitions.js";
import { upgradeProgressionService, type UpgradeProgressionService } from "./progressionService.js";
import type { CameraAbilityId, CameraAbilityLevelDefinition } from "./types.js";

const ABILITY_EFFECT_TYPE: Record<CameraAbilityId, CameraAttackEffectType> = {
  screen_shake: "shake",
  drunk_vision: "drunk",
  camera_spin: "spin",
};

const DRUNK_INTENSITY_BY_SEVERITY: Record<DrunkSeverity, number> = {
  light: 0.35,
  medium: 0.7,
  blackout: 1.2,
};

const DEFAULT_AFTERSHOCK_DELAY_MS = 1200;
const CONTROL_BLOCK_DURATION_MS = 5000;

const UPGRADE_TREES_BY_ABILITY = CAMERA_ABILITY_UPGRADE_TREES.reduce(
  (acc, tree) => {
    acc[tree.abilityId] = tree;
    return acc;
  },
  {} as Record<CameraAbilityId, (typeof CAMERA_ABILITY_UPGRADE_TREES)[number]>
);

export interface CameraAttackExecutionProfile {
  abilityId: CameraAbilityId;
  effectType: CameraAttackEffectType;
  level: number;
  intensity: number;
  duration: number;
  chaosPointsCost: number;
  metadata?: CameraAttackMetadata;
}

export interface BuildAttackMessageOptions {
  gameId: string;
  attackerId: string;
  targetId: string;
  level?: number;
  timestamp?: number;
  progression?: UpgradeProgressionService;
  metadata?: CameraAttackMetadata;
}

export interface ResolvedCameraAttackExecution {
  effectType: CameraAttackEffectType;
  intensity: number;
  duration: number;
  chaosPointsCost: number;
  metadata?: CameraAttackMetadata;
  abilityId: string;
  level: number;
}

export function isCameraAbilityId(abilityId: string): abilityId is CameraAbilityId {
  return abilityId === "screen_shake" || abilityId === "drunk_vision" || abilityId === "camera_spin";
}

export function resolveExecutionProfile(
  abilityId: CameraAbilityId,
  requestedLevel: number
): CameraAttackExecutionProfile {
  const definition = resolveLevelDefinition(abilityId, requestedLevel);
  const stats = definition.stats;
  const features = stats.features ?? [];

  const metadata: CameraAttackMetadata = {};
  if (features.length > 0) {
    metadata.features = [...features];
  }

  switch (abilityId) {
    case "screen_shake": {
      if (features.includes("aftershock")) {
        metadata.aftershock = true;
        metadata.aftershockDelayMs = DEFAULT_AFTERSHOCK_DELAY_MS;
      }

      return {
        abilityId,
        level: definition.level,
        effectType: ABILITY_EFFECT_TYPE[abilityId],
        intensity: stats.intensity ?? 0.3,
        duration: stats.durationMs,
        chaosPointsCost: stats.chaosPointsCost,
        metadata: hasMetadata(metadata) ? metadata : undefined,
      };
    }
    case "drunk_vision": {
      const severity = stats.severity ?? "light";
      metadata.severity = severity;

      if (severity === "medium") {
        metadata.controlInversion = "random";
        metadata.controlInversionChance = 0.3;
      } else if (severity === "blackout") {
        metadata.controlInversion = "full";
        metadata.controlInversionDurationMs = stats.durationMs;
      }

      if (features.includes("control_block_5s")) {
        metadata.controlInversion = "full";
        metadata.controlInversionDurationMs = CONTROL_BLOCK_DURATION_MS;
      }

      return {
        abilityId,
        level: definition.level,
        effectType: ABILITY_EFFECT_TYPE[abilityId],
        intensity: DRUNK_INTENSITY_BY_SEVERITY[severity],
        duration: stats.durationMs,
        chaosPointsCost: stats.chaosPointsCost,
        metadata,
      };
    }
    case "camera_spin": {
      metadata.rotations = stats.rotations ?? 1;
      if (typeof stats.zoomDistance === "number") {
        metadata.zoomDistance = stats.zoomDistance;
      }

      return {
        abilityId,
        level: definition.level,
        effectType: ABILITY_EFFECT_TYPE[abilityId],
        intensity: stats.rotations ?? 1,
        duration: stats.durationMs,
        chaosPointsCost: stats.chaosPointsCost,
        metadata,
      };
    }
  }
}

export function buildCameraAttackMessageFromProgression(
  abilityId: CameraAbilityId,
  options: BuildAttackMessageOptions
): CameraAttackMessage {
  const progression = options.progression ?? upgradeProgressionService;
  const progressionLevel = progression.getCurrentLevel(abilityId);
  const profile = resolveExecutionProfile(abilityId, options.level ?? progressionLevel);

  return {
    type: "chaos_attack",
    attackType: "camera_effect",
    gameId: options.gameId,
    attackerId: options.attackerId,
    targetId: options.targetId,
    abilityId,
    level: profile.level,
    effectType: profile.effectType,
    intensity: profile.intensity,
    duration: profile.duration,
    chaosPointsCost: profile.chaosPointsCost,
    timestamp: options.timestamp ?? Date.now(),
    metadata: {
      ...(profile.metadata ?? {}),
      ...(options.metadata ?? {}),
    },
  };
}

export function resolveExecutionFromAttackMessage(
  message: CameraAttackMessage
): ResolvedCameraAttackExecution {
  if (!isCameraAbilityId(message.abilityId)) {
    return {
      abilityId: message.abilityId,
      level: message.level,
      effectType: message.effectType,
      intensity: message.intensity,
      duration: message.duration,
      chaosPointsCost: message.chaosPointsCost,
      metadata: message.metadata,
    };
  }

  const profile = resolveExecutionProfile(message.abilityId, message.level);
  const shouldUseProfile = message.effectType === profile.effectType;
  const hasExplicitIntensity = Number.isFinite(message.intensity);
  const hasExplicitDuration = Number.isFinite(message.duration) && message.duration > 0;

  return {
    abilityId: message.abilityId,
    level: shouldUseProfile ? profile.level : message.level,
    effectType: shouldUseProfile ? profile.effectType : message.effectType,
    intensity:
      hasExplicitIntensity
        ? message.intensity
        : shouldUseProfile
          ? profile.intensity
          : message.intensity,
    duration:
      hasExplicitDuration
        ? message.duration
        : shouldUseProfile
          ? profile.duration
          : message.duration,
    chaosPointsCost:
      Number.isFinite(message.chaosPointsCost) && message.chaosPointsCost > 0
        ? message.chaosPointsCost
        : shouldUseProfile
          ? profile.chaosPointsCost
          : message.chaosPointsCost,
    metadata: shouldUseProfile
      ? {
          ...(profile.metadata ?? {}),
          ...(message.metadata ?? {}),
        }
      : message.metadata,
  };
}

function resolveLevelDefinition(
  abilityId: CameraAbilityId,
  requestedLevel: number
): CameraAbilityLevelDefinition {
  const tree = UPGRADE_TREES_BY_ABILITY[abilityId];
  const maxLevel = tree.levels.length;
  const safeLevel = Math.min(maxLevel, Math.max(1, Math.round(requestedLevel)));
  return tree.levels[safeLevel - 1];
}

function hasMetadata(metadata: CameraAttackMetadata): boolean {
  return Object.keys(metadata).length > 0;
}

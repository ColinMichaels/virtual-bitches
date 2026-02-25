import type { DrunkSeverity } from "../types.js";

export type CameraAbilityId = "screen_shake" | "drunk_vision" | "camera_spin";

export const CAMERA_ABILITY_IDS: CameraAbilityId[] = [
  "screen_shake",
  "drunk_vision",
  "camera_spin",
];

export type UnlockRequirement =
  | { type: "default" }
  | { type: "xp"; amount: number }
  | { type: "currency"; amount: number; currency: "chaos_tokens" }
  | { type: "achievement"; achievementId: string; description?: string };

export interface CameraAbilityLevelStats {
  intensity?: number;
  durationMs: number;
  chaosPointsCost: number;
  cooldownMs: number;
  severity?: DrunkSeverity;
  rotations?: number;
  zoomDistance?: number;
  features?: string[];
}

export interface CameraAbilityLevelDefinition {
  level: number;
  name: string;
  description: string;
  unlockRequirement: UnlockRequirement;
  stats: CameraAbilityLevelStats;
}

export interface CameraAbilityUpgradeTree {
  abilityId: CameraAbilityId;
  displayName: string;
  levels: CameraAbilityLevelDefinition[];
}

export interface AbilityProgressState {
  abilityId: CameraAbilityId;
  xp: number;
  unlockedLevel: number;
  timesUsed: number;
  successfulDisruptions: number;
  updatedAt: number;
}

export interface UpgradeProgressionState {
  version: 1;
  chaosTokens: number;
  achievements: string[];
  abilities: Record<CameraAbilityId, AbilityProgressState>;
  updatedAt: number;
}

export type UnlockFailureReason =
  | "invalid_level"
  | "already_unlocked"
  | "previous_level_locked"
  | "insufficient_xp"
  | "insufficient_tokens"
  | "missing_achievement";

export interface UnlockValidationResult {
  allowed: boolean;
  reason?: UnlockFailureReason;
  requirement?: UnlockRequirement;
}

export interface UnlockContext {
  achievements?: string[];
}

export interface AbilityUnlockPreview {
  abilityId: CameraAbilityId;
  level: number;
  definition: CameraAbilityLevelDefinition;
  validation: UnlockValidationResult;
}

export type CameraAttackEffectType = "shake" | "spin" | "zoom" | "tilt" | "drunk";
export type DrunkSeverity = "light" | "medium" | "blackout";
export type ControlInversionMode = "none" | "random" | "full";

export interface CameraAttackMetadata {
  severity?: DrunkSeverity;
  rotations?: number;
  zoomDistance?: number;
  aftershock?: boolean;
  aftershockDelayMs?: number;
  controlInversion?: ControlInversionMode;
  controlInversionChance?: number;
  controlInversionDurationMs?: number;
  features?: string[];
}

export interface CameraAttackMessage {
  type: "chaos_attack";
  attackType: "camera_effect";
  gameId: string;
  attackerId: string;
  targetId: string;
  abilityId: string;
  level: number;
  effectType: CameraAttackEffectType;
  intensity: number;
  duration: number;
  chaosPointsCost: number;
  timestamp: number;
  metadata?: CameraAttackMetadata;
}

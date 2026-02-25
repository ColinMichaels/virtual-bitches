export type CameraAttackEffectType = "shake" | "spin" | "zoom" | "tilt" | "drunk";
export type DrunkSeverity = "light" | "medium" | "blackout";

export interface CameraAttackMetadata {
  severity?: DrunkSeverity;
  rotations?: number;
  zoomDistance?: number;
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

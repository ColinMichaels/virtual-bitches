/**
 * Chaos attack particle effect presets
 * Particle effects for multiplayer chaos attacks
 */

import { Vector3 } from "@babylonjs/core";
import { particleService } from "../../services/particleService.js";
import { attackEffects } from "../effects/attackEffects.js";

/**
 * Register all chaos attack particle effects
 */
export function registerChaosEffects(): void {
  attackEffects.forEach((effect) => particleService.registerEffect(effect));
  console.log("[ChaosEffects] Registered all chaos attack effects");
}

/**
 * Screen shake attack particles
 */
export function emitShakeAttack(
  targetPlayerId: string,
  intensity: number = 1.0
): void {
  // Impact particles at target
  particleService.createAttackImpact("shake", targetPlayerId, intensity);

  // Screen-space debris overlay (local only)
  particleService.createScreenOverlayParticles(
    "shake-debris",
    Math.floor(3000 + intensity * 2000)
  );
}

/**
 * Drunk vision attack particles
 */
export function emitDrunkAttack(
  targetPlayerId: string,
  severity: "light" | "medium" | "blackout",
  duration: number
): string {
  // Impact splash
  particleService.createAttackImpact("drunk", targetPlayerId, 1.0);

  // Camera-attached drunk sparkles (local only)
  const sparklesId = particleService.attachToCamera(
    "drunk-sparkles",
    new Vector3(0, 0, 2)
  );

  // Continuous drunk aura around player
  particleService.createContinuousEffect(
    "attack-drunk-aura",
    duration,
    targetPlayerId
  );

  // Return sparkles ID for cleanup
  return sparklesId;
}

/**
 * Clear drunk vision particles
 */
export function clearDrunkAttack(sparklesInstanceId: string): void {
  particleService.stop(sparklesInstanceId);
}

/**
 * Camera spin attack particles
 */
export function emitSpinAttack(
  targetPlayerId: string,
  intensity: number = 1.0
): void {
  // Impact swirl
  particleService.createAttackImpact("spin", targetPlayerId, intensity);

  // Screen-space spin trail (local only)
  particleService.createScreenOverlayParticles(
    "spin-trail",
    Math.floor(3000 + intensity * 2000)
  );
}

/**
 * Blind spell particles
 */
export function emitBlindSpell(targetPlayerId: string): void {
  // Impact - blinding white flash
  particleService.createAttackImpact("blind", targetPlayerId, 1.0);

  // Screen overlay flash (local only)
  particleService.createScreenOverlayParticles("attack-blind-flash", 2000);
}

/**
 * Confusion hex particles
 */
export function emitConfusionHex(
  targetPlayerId: string,
  duration: number
): void {
  // Impact - confusion swirl around player
  particleService.createAttackImpact("confusion", targetPlayerId, 1.0);

  // Continuous confusion effect
  particleService.createContinuousEffect(
    "attack-confusion-swirl",
    duration,
    targetPlayerId
  );
}

/**
 * Generic chaos attack impact
 */
export function emitGenericAttackImpact(
  targetPlayerId: string,
  position: Vector3,
  intensity: number = 1.0
): void {
  particleService.emit({
    effectId: "attack-impact",
    position: position,
    options: {
      scale: intensity,
      playerId: targetPlayerId,
      networkSync: true,
    },
  });
}

/**
 * Chaos Points collected particles (future feature)
 */
export function emitChaosPointsCollected(
  position: Vector3,
  amount: number
): void {
  const scale = Math.min(amount / 10, 3.0); // Scale based on amount

  particleService.emit({
    effectId: "burst-explosion",
    position: position,
    options: {
      scale: scale,
      duration: 1500,
      networkSync: true,
    },
  });
}

/**
 * Chaos ability activated particles (future feature)
 */
export function emitChaosAbilityActivated(
  playerId: string,
  position: Vector3,
  abilityType: string
): void {
  // Use color based on ability type
  let effectId = "ambient-aura";

  if (abilityType === "defensive") {
    effectId = "ambient-aura"; // Blue aura
  } else if (abilityType === "offensive") {
    effectId = "ambient-embers"; // Orange/red
  }

  particleService.emit({
    effectId: effectId,
    position: position.add(new Vector3(0, 2, 0)),
    options: {
      duration: 3000,
      scale: 1.5,
      playerId: playerId,
      networkSync: true,
    },
  });
}

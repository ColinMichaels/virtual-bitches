/**
 * Player-specific particle effect presets
 * Particle effects for player actions and indicators
 */

import { Vector3 } from "@babylonjs/core";
import { particleService } from "../../services/particleService.js";

/**
 * Show active player indicator particles
 */
export function showPlayerActiveIndicator(
  playerId: string,
  position: Vector3
): string {
  return particleService.emit({
    effectId: "ambient-sparkles",
    position: position.add(new Vector3(0, 3, 0)),
    options: {
      playerId: playerId,
      networkSync: false, // Local indicator only
    },
  });
}

/**
 * Hide player active indicator
 */
export function hidePlayerActiveIndicator(instanceId: string): void {
  particleService.stop(instanceId);
}

/**
 * Player celebration particles
 */
export function emitPlayerCelebration(
  playerId: string,
  position: Vector3,
  celebrationType: "small" | "medium" | "large" = "medium"
): void {
  const scaleMap = {
    small: 1.0,
    medium: 1.5,
    large: 2.0,
  };

  const scale = scaleMap[celebrationType];

  // Confetti burst at player position
  particleService.emit({
    effectId: "burst-confetti",
    position: position.add(new Vector3(0, 2, 0)),
    options: {
      scale: scale,
      duration: 2000,
      playerId: playerId,
      networkSync: true,
    },
  });

  // Add sparkles for large celebrations
  if (celebrationType === "large") {
    setTimeout(() => {
      particleService.emit({
        effectId: "ambient-sparkles",
        position: position.add(new Vector3(0, 1, 0)),
        options: {
          duration: 3000,
          scale: scale,
          playerId: playerId,
          networkSync: true,
        },
      });
    }, 300);
  }
}

/**
 * Player power-up aura
 */
export function emitPlayerPowerUpAura(
  playerId: string,
  position: Vector3,
  duration: number = 5000
): string {
  return particleService.emit({
    effectId: "ambient-aura",
    position: position.add(new Vector3(0, 1, 0)),
    options: {
      duration: duration,
      playerId: playerId,
      networkSync: true,
    },
  });
}

/**
 * Player hit particles (for attacks)
 */
export function emitPlayerHitParticles(
  playerId: string,
  position: Vector3,
  attackType: string = "generic"
): void {
  // Use attack-specific effect or generic impact
  const effectId =
    attackType === "generic" ? "attack-impact" : `attack-${attackType}-impact`;

  particleService.emit({
    effectId: effectId,
    position: position.add(new Vector3(0, 2, 0)),
    options: {
      scale: 1.2,
      playerId: playerId,
      networkSync: true,
    },
  });
}

/**
 * Player score area particles (show where dice will go)
 */
export function emitPlayerScoreAreaIndicator(
  playerId: string,
  position: Vector3
): string {
  return particleService.emit({
    effectId: "ambient-embers",
    position: position,
    options: {
      scale: 0.8,
      playerId: playerId,
      networkSync: false, // Local UI element
    },
  });
}

/**
 * Player turn start particles
 */
export function emitPlayerTurnStart(
  playerId: string,
  position: Vector3
): void {
  particleService.emit({
    effectId: "burst-white",
    position: position.add(new Vector3(0, 2, 0)),
    options: {
      scale: 1.0,
      duration: 1000,
      playerId: playerId,
      networkSync: true,
    },
  });
}

/**
 * Player turn end particles
 */
export function emitPlayerTurnEnd(
  playerId: string,
  position: Vector3
): void {
  particleService.emit({
    effectId: "ambient-smoke",
    position: position.add(new Vector3(0, 1, 0)),
    options: {
      scale: 0.7,
      duration: 1500,
      playerId: playerId,
      networkSync: true,
    },
  });
}

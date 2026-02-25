/**
 * Game event particle effect presets
 * Registers particle effects and provides helpers for game events
 */

import { particleService } from "../../services/particleService.js";
import { burstEffects } from "../effects/burstEffects.js";
import { trailEffects } from "../effects/trailEffects.js";
import { ambientEffects } from "../effects/ambientEffects.js";

/**
 * Register all game-related particle effects
 */
export function registerGameEffects(): void {
  // Register burst effects
  burstEffects.forEach((effect) => particleService.registerEffect(effect));

  // Register trail effects
  trailEffects.forEach((effect) => particleService.registerEffect(effect));

  // Register ambient effects
  ambientEffects.forEach((effect) => particleService.registerEffect(effect));

  console.log("[GameEffects] Registered all game particle effects");
}

/**
 * Emit particles for scoring event
 */
export function emitScoreParticles(
  position: { x: number; y: number; z: number },
  diceValue: number,
  playerId: string
): void {
  const { Vector3 } = require("@babylonjs/core");

  // Determine effect based on dice value
  let effectId = "burst-gold";
  let scale = 1.0;

  if (diceValue >= 5) {
    scale = 1.5; // Bigger burst for high values
  }

  particleService.emit({
    effectId: effectId,
    position: new Vector3(position.x, position.y, position.z),
    options: {
      scale: scale,
      playerId: playerId,
      networkSync: true,
    },
  });
}

/**
 * Emit particles for bust event
 */
export function emitBustParticles(
  position: { x: number; y: number; z: number },
  playerId: string
): void {
  const { Vector3 } = require("@babylonjs/core");

  particleService.emit({
    effectId: "burst-red",
    position: new Vector3(position.x, position.y, position.z),
    options: {
      scale: 1.2,
      playerId: playerId,
      networkSync: true,
    },
  });
}

/**
 * Emit particles for perfect roll event
 */
export function emitPerfectRollParticles(
  position: { x: number; y: number; z: number },
  playerId: string
): void {
  const { Vector3 } = require("@babylonjs/core");

  // White burst + confetti
  particleService.emit({
    effectId: "burst-white",
    position: new Vector3(position.x, position.y, position.z),
    options: {
      scale: 2.0,
      playerId: playerId,
      networkSync: true,
    },
  });

  // Add confetti after slight delay
  setTimeout(() => {
    particleService.emit({
      effectId: "burst-confetti",
      position: new Vector3(position.x, position.y + 1, position.z),
      options: {
        scale: 1.5,
        playerId: playerId,
        networkSync: true,
      },
    });
  }, 200);
}

/**
 * Emit particles for achievement unlocked
 */
export function emitAchievementParticles(
  position: { x: number; y: number; z: number },
  playerId: string
): void {
  const { Vector3 } = require("@babylonjs/core");

  // Ambient sparkles
  particleService.emit({
    effectId: "ambient-sparkles",
    position: new Vector3(position.x, position.y, position.z),
    options: {
      duration: 3000,
      scale: 1.5,
      playerId: playerId,
      networkSync: true,
    },
  });
}

/**
 * Emit particles for dice roll
 */
export function emitDiceRollParticles(
  position: { x: number; y: number; z: number }
): void {
  const { Vector3 } = require("@babylonjs/core");

  // Dice trail (attached to dice mesh in actual implementation)
  particleService.emit({
    effectId: "trail-dice",
    position: new Vector3(position.x, position.y, position.z),
    options: {
      duration: 2000,
      networkSync: false, // Local visual only
    },
  });
}

/**
 * Emit celebration particles (generic)
 */
export function emitCelebrationParticles(
  position: { x: number; y: number; z: number },
  playerId: string,
  intensity: number = 1.0
): void {
  const { Vector3 } = require("@babylonjs/core");

  // Confetti burst
  particleService.emit({
    effectId: "burst-confetti",
    position: new Vector3(position.x, position.y, position.z),
    options: {
      scale: intensity,
      duration: 2000,
      playerId: playerId,
      networkSync: true,
    },
  });
}

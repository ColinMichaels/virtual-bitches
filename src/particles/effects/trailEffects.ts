/**
 * Trail particle effects - follow-behind motion trails
 */

import { Vector3, Color4, ParticleSystem } from "@babylonjs/core";
import type { ParticleEffect } from "../../services/particleService.js";

/**
 * Dice motion trail
 */
export const trailDice: ParticleEffect = {
  id: "trail-dice",
  type: "trail",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 0.5,
  maxEmitPower: 1,
  minLifeTime: 0.3,
  maxLifeTime: 0.6,
  emitRate: 50,
  maxParticles: 30,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(1, 1, 1, 0.8),
  color2: new Color4(1, 1, 1, 0.4),
  colorDead: new Color4(1, 1, 1, 0),
  minSize: 0.2,
  maxSize: 0.4,
  gravity: new Vector3(0, 0, 0), // No gravity for trails
  direction1: new Vector3(0, 0, 0),
  direction2: new Vector3(0, 0, 0),
  minAngularSpeed: 0,
  maxAngularSpeed: 0,
};

/**
 * Magic spell trail
 */
export const trailMagic: ParticleEffect = {
  id: "trail-magic",
  type: "trail",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 0.3,
  maxEmitPower: 0.8,
  minLifeTime: 0.5,
  maxLifeTime: 1.0,
  emitRate: 40,
  maxParticles: 40,
  blendMode: ParticleSystem.BLENDMODE_ONEONE,
  color1: new Color4(0.5, 0.2, 1, 1), // Purple
  color2: new Color4(0.3, 0.1, 0.8, 0.6),
  colorDead: new Color4(0.2, 0, 0.5, 0),
  minSize: 0.15,
  maxSize: 0.35,
  gravity: new Vector3(0, 0.5, 0), // Slight upward drift
  direction1: new Vector3(-0.2, -0.2, -0.2),
  direction2: new Vector3(0.2, 0.2, 0.2),
  minAngularSpeed: -Math.PI / 2,
  maxAngularSpeed: Math.PI / 2,
};

/**
 * Fire trail (for hot dice)
 */
export const trailFire: ParticleEffect = {
  id: "trail-fire",
  type: "trail",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 0.4,
  maxEmitPower: 1.2,
  minLifeTime: 0.2,
  maxLifeTime: 0.5,
  emitRate: 60,
  maxParticles: 35,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(1, 0.8, 0, 1), // Yellow
  color2: new Color4(1, 0.3, 0, 0.8), // Orange
  colorDead: new Color4(0.5, 0, 0, 0), // Red fade
  minSize: 0.2,
  maxSize: 0.5,
  gravity: new Vector3(0, 1, 0), // Upward (fire rises)
  direction1: new Vector3(-0.1, -0.1, -0.1),
  direction2: new Vector3(0.1, 0.3, 0.1),
  minAngularSpeed: 0,
  maxAngularSpeed: Math.PI,
};

/**
 * Ice trail (for frozen dice)
 */
export const trailIce: ParticleEffect = {
  id: "trail-ice",
  type: "trail",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 0.3,
  maxEmitPower: 0.7,
  minLifeTime: 0.4,
  maxLifeTime: 0.8,
  emitRate: 45,
  maxParticles: 30,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(0.5, 0.8, 1, 1), // Light blue
  color2: new Color4(0.3, 0.6, 1, 0.6), // Darker blue
  colorDead: new Color4(0.2, 0.4, 0.8, 0),
  minSize: 0.15,
  maxSize: 0.35,
  gravity: new Vector3(0, -0.5, 0), // Slight downward (crystals)
  direction1: new Vector3(-0.1, -0.1, -0.1),
  direction2: new Vector3(0.1, 0.1, 0.1),
  minAngularSpeed: -Math.PI,
  maxAngularSpeed: Math.PI,
};

/**
 * Rainbow trail (for special effects)
 */
export const trailRainbow: ParticleEffect = {
  id: "trail-rainbow",
  type: "trail",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 0.5,
  maxEmitPower: 1.0,
  minLifeTime: 0.5,
  maxLifeTime: 1.0,
  emitRate: 50,
  maxParticles: 50,
  blendMode: ParticleSystem.BLENDMODE_ONEONE,
  color1: new Color4(1, 0, 0, 1), // Red
  color2: new Color4(0, 0, 1, 1), // Blue (gradient via shader)
  colorDead: new Color4(0.5, 0, 1, 0), // Purple fade
  minSize: 0.2,
  maxSize: 0.4,
  gravity: new Vector3(0, 0, 0),
  direction1: new Vector3(-0.2, -0.2, -0.2),
  direction2: new Vector3(0.2, 0.2, 0.2),
  minAngularSpeed: -Math.PI,
  maxAngularSpeed: Math.PI,
};

/**
 * All trail effects
 */
export const trailEffects: ParticleEffect[] = [
  trailDice,
  trailMagic,
  trailFire,
  trailIce,
  trailRainbow,
];

/**
 * Burst particle effects - instant explosions of particles
 */

import { Vector3, Color4, ParticleSystem } from "@babylonjs/core";
import type { ParticleEffect } from "../../services/particleService.js";

// Temporary texture URL (TODO: Replace with custom textures)
const PARTICLE_TEXTURE = "https://assets.babylonjs.com/textures/flare.png";

/**
 * Gold coin burst for scoring
 */
export const burstGold: ParticleEffect = {
  id: "burst-gold",
  type: "burst",
  particleTexture: PARTICLE_TEXTURE,
  minEmitPower: 5,
  maxEmitPower: 10,
  minLifeTime: 0.5,
  maxLifeTime: 1.5,
  emitRate: 100,
  maxParticles: 50,
  blendMode: ParticleSystem.BLENDMODE_ONEONE,
  color1: new Color4(1, 0.84, 0, 1), // Gold
  color2: new Color4(1, 0.65, 0, 1), // Darker gold
  colorDead: new Color4(1, 0.4, 0, 0), // Fade to transparent
  minSize: 0.3,
  maxSize: 0.8,
  gravity: new Vector3(0, -9.81, 0),
  direction1: new Vector3(-1, 1, -1),
  direction2: new Vector3(1, 3, 1),
  minAngularSpeed: 0,
  maxAngularSpeed: Math.PI,
  duration: 1000,
};

/**
 * White flash burst for perfect rolls
 */
export const burstWhite: ParticleEffect = {
  id: "burst-white",
  type: "burst",
  particleTexture: PARTICLE_TEXTURE,
  minEmitPower: 8,
  maxEmitPower: 15,
  minLifeTime: 0.3,
  maxLifeTime: 1.0,
  emitRate: 150,
  maxParticles: 80,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(1, 1, 1, 1), // Pure white
  color2: new Color4(1, 1, 0.8, 0.8), // Warm white
  colorDead: new Color4(1, 1, 1, 0),
  minSize: 0.4,
  maxSize: 1.2,
  gravity: new Vector3(0, -5, 0),
  direction1: new Vector3(-1, 1, -1),
  direction2: new Vector3(1, 3, 1),
  minAngularSpeed: -Math.PI,
  maxAngularSpeed: Math.PI,
  duration: 800,
};

/**
 * Red burst for bust/attacks
 */
export const burstRed: ParticleEffect = {
  id: "burst-red",
  type: "burst",
  particleTexture: PARTICLE_TEXTURE,
  minEmitPower: 4,
  maxEmitPower: 8,
  minLifeTime: 0.4,
  maxLifeTime: 1.2,
  emitRate: 80,
  maxParticles: 40,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(1, 0, 0, 1), // Red
  color2: new Color4(0.8, 0, 0, 0.8), // Dark red
  colorDead: new Color4(0.5, 0, 0, 0),
  minSize: 0.3,
  maxSize: 0.7,
  gravity: new Vector3(0, -9.81, 0),
  direction1: new Vector3(-1, 0.5, -1),
  direction2: new Vector3(1, 2, 1),
  minAngularSpeed: 0,
  maxAngularSpeed: Math.PI / 2,
  duration: 1000,
};

/**
 * Confetti burst for celebrations
 */
export const burstConfetti: ParticleEffect = {
  id: "burst-confetti",
  type: "confetti",
  particleTexture: PARTICLE_TEXTURE,
  minEmitPower: 6,
  maxEmitPower: 12,
  minLifeTime: 1.0,
  maxLifeTime: 2.5,
  emitRate: 120,
  maxParticles: 100,
  blendMode: ParticleSystem.BLENDMODE_STANDARD,
  color1: new Color4(1, 0.2, 0.5, 1), // Pink
  color2: new Color4(0.2, 0.5, 1, 1), // Blue
  colorDead: new Color4(0.5, 0.5, 0.5, 0),
  minSize: 0.2,
  maxSize: 0.5,
  gravity: new Vector3(0, -9.81, 0),
  direction1: new Vector3(-1, 2, -1),
  direction2: new Vector3(1, 4, 1),
  minAngularSpeed: -Math.PI * 2,
  maxAngularSpeed: Math.PI * 2,
  duration: 2000,
};

/**
 * Explosion burst for dramatic effects
 */
export const burstExplosion: ParticleEffect = {
  id: "burst-explosion",
  type: "explosion",
  particleTexture: PARTICLE_TEXTURE,
  minEmitPower: 10,
  maxEmitPower: 20,
  minLifeTime: 0.5,
  maxLifeTime: 1.5,
  emitRate: 200,
  maxParticles: 150,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(1, 0.5, 0, 1), // Orange
  color2: new Color4(1, 0, 0, 0.8), // Red
  colorDead: new Color4(0.3, 0.3, 0.3, 0), // Gray smoke
  minSize: 0.5,
  maxSize: 1.5,
  gravity: new Vector3(0, -3, 0),
  direction1: new Vector3(-1, 0, -1),
  direction2: new Vector3(1, 2, 1),
  minAngularSpeed: -Math.PI,
  maxAngularSpeed: Math.PI,
  duration: 1200,
};

/**
 * All burst effects
 */
export const burstEffects: ParticleEffect[] = [
  burstGold,
  burstWhite,
  burstRed,
  burstConfetti,
  burstExplosion,
];

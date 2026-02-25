/**
 * Ambient particle effects - continuous atmospheric particles
 */

import { Vector3, Color4, ParticleSystem } from "@babylonjs/core";
import type { ParticleEffect } from "../../services/particleService.js";

/**
 * Floating sparkles for achievements/special moments
 */
export const ambientSparkles: ParticleEffect = {
  id: "ambient-sparkles",
  type: "sparkles",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 0.5,
  maxEmitPower: 1.5,
  minLifeTime: 1.5,
  maxLifeTime: 3.0,
  emitRate: 25,
  maxParticles: 60,
  blendMode: ParticleSystem.BLENDMODE_ONEONE,
  color1: new Color4(1, 1, 0.5, 1), // Yellow
  color2: new Color4(1, 0.8, 0.2, 0.8), // Gold
  colorDead: new Color4(1, 0.5, 0, 0),
  minSize: 0.15,
  maxSize: 0.35,
  gravity: new Vector3(0, 0.5, 0), // Gentle upward float
  direction1: new Vector3(-0.5, 0.5, -0.5),
  direction2: new Vector3(0.5, 1.5, 0.5),
  minAngularSpeed: -Math.PI / 2,
  maxAngularSpeed: Math.PI / 2,
};

/**
 * Smoke wisps for mystery/drama
 */
export const ambientSmoke: ParticleEffect = {
  id: "ambient-smoke",
  type: "smoke",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 0.3,
  maxEmitPower: 0.8,
  minLifeTime: 2.0,
  maxLifeTime: 4.0,
  emitRate: 15,
  maxParticles: 40,
  blendMode: ParticleSystem.BLENDMODE_STANDARD,
  color1: new Color4(0.8, 0.8, 0.8, 0.3), // Light gray
  color2: new Color4(0.5, 0.5, 0.5, 0.2), // Darker gray
  colorDead: new Color4(0.3, 0.3, 0.3, 0),
  minSize: 0.5,
  maxSize: 1.5,
  gravity: new Vector3(0, 0.3, 0), // Slow rise
  direction1: new Vector3(-0.3, 0.5, -0.3),
  direction2: new Vector3(0.3, 1.0, 0.3),
  minAngularSpeed: -Math.PI / 4,
  maxAngularSpeed: Math.PI / 4,
};

/**
 * Glowing embers (for warmth/energy)
 */
export const ambientEmbers: ParticleEffect = {
  id: "ambient-embers",
  type: "ambient",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 0.2,
  maxEmitPower: 0.6,
  minLifeTime: 1.0,
  maxLifeTime: 2.5,
  emitRate: 20,
  maxParticles: 35,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(1, 0.6, 0, 1), // Orange
  color2: new Color4(1, 0.3, 0, 0.7), // Red-orange
  colorDead: new Color4(0.5, 0, 0, 0),
  minSize: 0.1,
  maxSize: 0.25,
  gravity: new Vector3(0, 0.8, 0), // Float upward
  direction1: new Vector3(-0.2, 0.5, -0.2),
  direction2: new Vector3(0.2, 1.2, 0.2),
  minAngularSpeed: 0,
  maxAngularSpeed: Math.PI,
};

/**
 * Mystical fog/mist
 */
export const ambientFog: ParticleEffect = {
  id: "ambient-fog",
  type: "ambient",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 0.1,
  maxEmitPower: 0.4,
  minLifeTime: 3.0,
  maxLifeTime: 6.0,
  emitRate: 10,
  maxParticles: 30,
  blendMode: ParticleSystem.BLENDMODE_STANDARD,
  color1: new Color4(0.7, 0.7, 0.9, 0.2), // Bluish white
  color2: new Color4(0.5, 0.5, 0.7, 0.15),
  colorDead: new Color4(0.4, 0.4, 0.6, 0),
  minSize: 1.0,
  maxSize: 2.5,
  gravity: new Vector3(0, 0.1, 0), // Very slow rise
  direction1: new Vector3(-0.5, 0, -0.5),
  direction2: new Vector3(0.5, 0.3, 0.5),
  minAngularSpeed: -Math.PI / 8,
  maxAngularSpeed: Math.PI / 8,
};

/**
 * Drunk vision sparkles (camera-attached)
 */
export const drunkSparkles: ParticleEffect = {
  id: "drunk-sparkles",
  type: "ambient",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 0.2,
  maxEmitPower: 0.5,
  minLifeTime: 1.0,
  maxLifeTime: 2.0,
  emitRate: 20,
  maxParticles: 40,
  blendMode: ParticleSystem.BLENDMODE_ONEONE,
  color1: new Color4(1, 1, 0.5, 0.6), // Yellow (hazy)
  color2: new Color4(1, 0.8, 0.3, 0.4), // Gold (faded)
  colorDead: new Color4(1, 0.6, 0, 0),
  minSize: 0.1,
  maxSize: 0.3,
  gravity: new Vector3(0, 0.5, 0), // Float up slightly
  direction1: new Vector3(-0.5, -0.5, -0.5),
  direction2: new Vector3(0.5, 0.5, 0.5),
  minAngularSpeed: 0,
  maxAngularSpeed: Math.PI * 2,
};

/**
 * Magical aura (for power-ups)
 */
export const ambientAura: ParticleEffect = {
  id: "ambient-aura",
  type: "ambient",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 0.3,
  maxEmitPower: 0.7,
  minLifeTime: 1.2,
  maxLifeTime: 2.0,
  emitRate: 30,
  maxParticles: 50,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(0.3, 0.5, 1, 0.5), // Blue
  color2: new Color4(0.5, 0.3, 1, 0.3), // Purple
  colorDead: new Color4(0.2, 0.2, 0.8, 0),
  minSize: 0.2,
  maxSize: 0.5,
  gravity: new Vector3(0, 0.3, 0),
  direction1: new Vector3(-0.3, 0, -0.3),
  direction2: new Vector3(0.3, 0.5, 0.3),
  minAngularSpeed: -Math.PI / 2,
  maxAngularSpeed: Math.PI / 2,
};

/**
 * All ambient effects
 */
export const ambientEffects: ParticleEffect[] = [
  ambientSparkles,
  ambientSmoke,
  ambientEmbers,
  ambientFog,
  drunkSparkles,
  ambientAura,
];

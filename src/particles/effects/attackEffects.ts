/**
 * Attack particle effects - visual feedback for chaos attacks
 */

import { Vector3, Color4, ParticleSystem } from "@babylonjs/core";
import type { ParticleEffect } from "../../services/particleService.js";

/**
 * Screen shake impact debris
 */
export const attackShakeImpact: ParticleEffect = {
  id: "attack-shake-impact",
  type: "burst",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 3,
  maxEmitPower: 8,
  minLifeTime: 0.5,
  maxLifeTime: 1.5,
  emitRate: 80,
  maxParticles: 60,
  blendMode: ParticleSystem.BLENDMODE_STANDARD,
  color1: new Color4(0.6, 0.6, 0.6, 1), // Gray debris
  color2: new Color4(0.4, 0.4, 0.4, 0.8),
  colorDead: new Color4(0.3, 0.3, 0.3, 0),
  minSize: 0.2,
  maxSize: 0.5,
  gravity: new Vector3(0, -9.81, 0),
  direction1: new Vector3(-1, 0, -1),
  direction2: new Vector3(1, 2, 1),
  minAngularSpeed: -Math.PI,
  maxAngularSpeed: Math.PI,
  duration: 1000,
};

/**
 * Drunk vision impact splash
 */
export const attackDrunkImpact: ParticleEffect = {
  id: "attack-drunk-impact",
  type: "burst",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 4,
  maxEmitPower: 9,
  minLifeTime: 0.6,
  maxLifeTime: 1.5,
  emitRate: 100,
  maxParticles: 70,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(1, 1, 0, 0.8), // Yellow (drunk haze)
  color2: new Color4(1, 0.8, 0.2, 0.6),
  colorDead: new Color4(1, 0.6, 0, 0),
  minSize: 0.3,
  maxSize: 0.8,
  gravity: new Vector3(0, -2, 0), // Slow fall
  direction1: new Vector3(-1, 1, -1),
  direction2: new Vector3(1, 2, 1),
  minAngularSpeed: -Math.PI / 2,
  maxAngularSpeed: Math.PI / 2,
  duration: 1200,
};

/**
 * Drunk vision continuous aura
 */
export const attackDrunkAura: ParticleEffect = {
  id: "attack-drunk-aura",
  type: "ambient",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 0.5,
  maxEmitPower: 1,
  minLifeTime: 0.8,
  maxLifeTime: 1.5,
  emitRate: 30,
  maxParticles: 60,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(0.8, 0.4, 0.8, 0.5), // Purple haze
  color2: new Color4(0.6, 0.3, 0.6, 0.3),
  colorDead: new Color4(0.4, 0.2, 0.4, 0),
  minSize: 0.5,
  maxSize: 1.2,
  gravity: new Vector3(0, 0.2, 0),
  direction1: new Vector3(-0.3, -0.3, -0.3),
  direction2: new Vector3(0.3, 0.3, 0.3),
  minAngularSpeed: -Math.PI / 2,
  maxAngularSpeed: Math.PI / 2,
};

/**
 * Camera spin impact swirl
 */
export const attackSpinImpact: ParticleEffect = {
  id: "attack-spin-impact",
  type: "burst",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 5,
  maxEmitPower: 10,
  minLifeTime: 0.4,
  maxLifeTime: 1.0,
  emitRate: 120,
  maxParticles: 80,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(0.2, 0.8, 1, 1), // Cyan
  color2: new Color4(0.1, 0.5, 0.8, 0.7),
  colorDead: new Color4(0, 0.3, 0.6, 0),
  minSize: 0.3,
  maxSize: 0.7,
  gravity: new Vector3(0, 0, 0), // No gravity (spin effect)
  direction1: new Vector3(-1, -1, -1),
  direction2: new Vector3(1, 1, 1),
  minAngularSpeed: Math.PI,
  maxAngularSpeed: Math.PI * 2,
  duration: 800,
};

/**
 * Spin trail particles
 */
export const spinTrail: ParticleEffect = {
  id: "spin-trail",
  type: "trail",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 0.3,
  maxEmitPower: 0.7,
  minLifeTime: 0.5,
  maxLifeTime: 1.0,
  emitRate: 50,
  maxParticles: 50,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(0.3, 0.9, 1, 0.8), // Bright cyan
  color2: new Color4(0.2, 0.6, 0.9, 0.5),
  colorDead: new Color4(0.1, 0.4, 0.7, 0),
  minSize: 0.2,
  maxSize: 0.5,
  gravity: new Vector3(0, 0, 0),
  direction1: new Vector3(-0.2, -0.2, -0.2),
  direction2: new Vector3(0.2, 0.2, 0.2),
  minAngularSpeed: Math.PI / 2,
  maxAngularSpeed: Math.PI,
};

/**
 * Blind spell white flash
 */
export const attackBlindFlash: ParticleEffect = {
  id: "attack-blind-flash",
  type: "burst",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 10,
  maxEmitPower: 20,
  minLifeTime: 0.2,
  maxLifeTime: 0.8,
  emitRate: 200,
  maxParticles: 150,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(1, 1, 1, 1), // Pure white
  color2: new Color4(1, 1, 1, 0.9),
  colorDead: new Color4(1, 1, 1, 0),
  minSize: 1.0,
  maxSize: 3.0,
  gravity: new Vector3(0, 0, 0),
  direction1: new Vector3(-1, -1, -1),
  direction2: new Vector3(1, 1, 1),
  minAngularSpeed: 0,
  maxAngularSpeed: 0,
  duration: 500,
};

/**
 * Confusion hex swirl
 */
export const attackConfusionSwirl: ParticleEffect = {
  id: "attack-confusion-swirl",
  type: "ambient",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 1,
  maxEmitPower: 2,
  minLifeTime: 1.0,
  maxLifeTime: 2.0,
  emitRate: 40,
  maxParticles: 70,
  blendMode: ParticleSystem.BLENDMODE_ONEONE,
  color1: new Color4(1, 0, 1, 0.8), // Magenta
  color2: new Color4(0.7, 0, 0.7, 0.5),
  colorDead: new Color4(0.4, 0, 0.4, 0),
  minSize: 0.2,
  maxSize: 0.5,
  gravity: new Vector3(0, 0.5, 0),
  direction1: new Vector3(-0.5, 0, -0.5),
  direction2: new Vector3(0.5, 1, 0.5),
  minAngularSpeed: -Math.PI * 2,
  maxAngularSpeed: Math.PI * 2,
};

/**
 * Screen shake debris (overlay)
 */
export const shakeDebris: ParticleEffect = {
  id: "shake-debris",
  type: "burst",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 2,
  maxEmitPower: 6,
  minLifeTime: 0.8,
  maxLifeTime: 2.0,
  emitRate: 60,
  maxParticles: 50,
  blendMode: ParticleSystem.BLENDMODE_STANDARD,
  color1: new Color4(0.7, 0.7, 0.7, 0.6),
  color2: new Color4(0.5, 0.5, 0.5, 0.4),
  colorDead: new Color4(0.3, 0.3, 0.3, 0),
  minSize: 0.15,
  maxSize: 0.4,
  gravity: new Vector3(0, -9.81, 0),
  direction1: new Vector3(-0.5, 0, -0.5),
  direction2: new Vector3(0.5, 1.5, 0.5),
  minAngularSpeed: -Math.PI,
  maxAngularSpeed: Math.PI,
};

/**
 * Generic attack impact (for custom attacks)
 */
export const attackImpact: ParticleEffect = {
  id: "attack-impact",
  type: "burst",
  particleTexture: "https://assets.babylonjs.com/textures/flare.png",
  minEmitPower: 5,
  maxEmitPower: 12,
  minLifeTime: 0.4,
  maxLifeTime: 1.2,
  emitRate: 100,
  maxParticles: 70,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(1, 0.5, 0, 1), // Orange
  color2: new Color4(1, 0.2, 0, 0.8), // Red-orange
  colorDead: new Color4(0.5, 0, 0, 0),
  minSize: 0.3,
  maxSize: 0.8,
  gravity: new Vector3(0, -5, 0),
  direction1: new Vector3(-1, 0.5, -1),
  direction2: new Vector3(1, 2, 1),
  minAngularSpeed: -Math.PI,
  maxAngularSpeed: Math.PI,
  duration: 1000,
};

/**
 * All attack effects
 */
export const attackEffects: ParticleEffect[] = [
  attackShakeImpact,
  attackDrunkImpact,
  attackDrunkAura,
  attackSpinImpact,
  spinTrail,
  attackBlindFlash,
  attackConfusionSwirl,
  shakeDebris,
  attackImpact,
];

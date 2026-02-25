/**
 * Particle Service - Centralized particle effect management
 * Provides event-driven particle emission with pooling and network sync
 */

import {
  ParticleSystem,
  Vector3,
  Color4,
  Scene,
  AbstractMesh,
  Texture,
} from "@babylonjs/core";

/**
 * Particle effect types
 */
export type ParticleEffectType =
  | "burst"
  | "trail"
  | "fountain"
  | "explosion"
  | "confetti"
  | "smoke"
  | "sparkles"
  | "ambient";

/**
 * Quality tiers for adaptive performance
 */
export type ParticleQuality = "low" | "medium" | "high" | "ultra";

/**
 * Particle effect definition
 */
export interface ParticleEffect {
  id: string;
  type: ParticleEffectType;
  particleTexture: string;
  minEmitPower: number;
  maxEmitPower: number;
  minLifeTime: number;
  maxLifeTime: number;
  emitRate: number;
  maxParticles: number;
  blendMode: number;
  color1: Color4;
  color2: Color4;
  colorDead: Color4;
  minSize: number;
  maxSize: number;
  gravity: Vector3;
  direction1: Vector3;
  direction2: Vector3;
  minAngularSpeed: number;
  maxAngularSpeed: number;
  duration?: number; // Auto-stop after duration (ms)
}

/**
 * Options for particle emission
 */
export interface ParticleOptions {
  duration?: number; // Override effect duration
  scale?: number; // Scale particle size/count
  playerId?: string; // Attach to player
  cameraAttached?: boolean; // Attach to camera
  networkSync?: boolean; // Broadcast to multiplayer
}

/**
 * Particle event for emission
 */
export interface ParticleEvent {
  effectId: string;
  position: Vector3;
  options?: ParticleOptions;
}

/**
 * Active particle instance data
 */
interface ParticleInstance {
  id: string;
  system: ParticleSystem;
  effectId: string;
  startTime: number;
  duration?: number;
  playerId?: string;
  cameraAttached?: boolean;
}

/**
 * Network event for multiplayer synchronization
 */
export interface ParticleNetworkEvent {
  type: "particle:emit";
  effectId: string;
  position: { x: number; y: number; z: number };
  options?: ParticleOptions;
  timestamp: number;
}

/**
 * ParticleService - Manages all particle effects in the game
 */
export class ParticleService {
  private scene: Scene;
  private effectRegistry: Map<string, ParticleEffect> = new Map();
  private particlePool: ParticleSystem[] = [];
  private activeParticles: Map<string, ParticleInstance> = new Map();
  private quality: ParticleQuality = "medium";
  private maxActiveParticles = 20;
  private maxParticlesPerEffect = 200;
  private networkSyncEnabled = false;
  private instanceCounter = 0;

  // Quality multipliers
  private qualityMultipliers = {
    low: { particles: 0.5, emitRate: 0.5 },
    medium: { particles: 0.75, emitRate: 0.75 },
    high: { particles: 1.0, emitRate: 1.0 },
    ultra: { particles: 1.5, emitRate: 1.25 },
  };

  constructor(scene: Scene) {
    this.scene = scene;
    this.setupRenderLoop();
  }

  /**
   * Setup render loop for particle lifecycle management
   */
  private setupRenderLoop(): void {
    this.scene.onBeforeRenderObservable.add(() => {
      this.updateParticles();
    });
  }

  /**
   * Update active particles (auto-stop, LOD, etc.)
   */
  private updateParticles(): void {
    const now = Date.now();
    const camera = this.scene.activeCamera;

    this.activeParticles.forEach((instance, id) => {
      // Check duration
      if (
        instance.duration &&
        now - instance.startTime >= instance.duration
      ) {
        this.stop(id);
        return;
      }

      // Update LOD based on camera distance
      if (camera) {
        const emitter = instance.system.emitter as Vector3;
        const distance = Vector3.Distance(camera.position, emitter);

        if (distance > 50) {
          instance.system.updateSpeed = 0; // Disable very far particles
        } else if (distance > 30) {
          instance.system.updateSpeed = 0.25; // 25% update rate
        } else if (distance > 15) {
          instance.system.updateSpeed = 0.5; // 50% update rate
        } else {
          instance.system.updateSpeed = 1.0; // Full speed
        }
      }

      // Update camera-attached particles
      if (instance.cameraAttached && camera) {
        const offset = new Vector3(0, 0, 2); // Default offset
        instance.system.emitter = camera.position.add(offset);
      }
    });
  }

  /**
   * Register a particle effect definition
   */
  registerEffect(effect: ParticleEffect): void {
    this.effectRegistry.set(effect.id, effect);
    console.log(`[ParticleService] Registered effect: ${effect.id}`);
  }

  /**
   * Get effect definition by ID
   */
  getEffect(id: string): ParticleEffect | null {
    return this.effectRegistry.get(id) || null;
  }

  /**
   * Unregister effect
   */
  unregisterEffect(id: string): void {
    this.effectRegistry.delete(id);
  }

  /**
   * Emit particles based on ParticleEvent
   */
  emit(event: ParticleEvent): string {
    if (!this.canEmit()) {
      console.warn("[ParticleService] Cannot emit - max particles reached");
      return "";
    }

    const effect = this.getEffect(event.effectId);
    if (!effect) {
      console.error(`[ParticleService] Effect not found: ${event.effectId}`);
      return "";
    }

    // Apply quality settings
    const adjustedEffect = this.applyQuality(effect);

    // Apply scale option
    if (event.options?.scale) {
      adjustedEffect.minSize *= event.options.scale;
      adjustedEffect.maxSize *= event.options.scale;
      adjustedEffect.maxParticles = Math.floor(
        adjustedEffect.maxParticles * event.options.scale
      );
    }

    // Create particle system
    const system = this.createParticleSystem(adjustedEffect);
    system.emitter = event.position;

    // Start emission
    system.start();

    // Generate instance ID
    const instanceId = `particle-${this.instanceCounter++}`;

    // Store active instance
    this.activeParticles.set(instanceId, {
      id: instanceId,
      system: system,
      effectId: event.effectId,
      startTime: Date.now(),
      duration: event.options?.duration || effect.duration,
      playerId: event.options?.playerId,
      cameraAttached: event.options?.cameraAttached,
    });

    // Network sync
    if (event.options?.networkSync && this.networkSyncEnabled) {
      this.broadcastParticleEvent(event);
    }

    console.log(
      `[ParticleService] Emitted ${event.effectId} (${instanceId})`
    );

    return instanceId;
  }

  /**
   * Emit particles for a game event type
   */
  emitForEvent(
    eventType: string,
    position: Vector3,
    options?: ParticleOptions
  ): string {
    // Map event types to effect IDs
    const eventEffectMap: Record<string, string> = {
      score: "burst-gold",
      bust: "burst-red",
      perfect: "burst-white",
      achievement: "ambient-sparkles",
      attack: "attack-impact",
      roll: "trail-dice",
    };

    const effectId = eventEffectMap[eventType];
    if (!effectId) {
      console.warn(
        `[ParticleService] No effect mapped for event: ${eventType}`
      );
      return "";
    }

    return this.emit({
      effectId: effectId,
      position: position,
      options: options,
    });
  }

  /**
   * Emit particles at a player's position
   */
  emitAtPlayer(
    playerId: string,
    effectId: string,
    offset?: Vector3
  ): string {
    // TODO: Get player position from PlayerManager
    // For now, use placeholder position
    const playerPosition = new Vector3(0, 0, 0);
    const position = offset
      ? playerPosition.add(offset)
      : playerPosition;

    return this.emit({
      effectId: effectId,
      position: position,
      options: {
        playerId: playerId,
        networkSync: true,
      },
    });
  }

  /**
   * Attach particles to camera
   */
  attachToCamera(effectId: string, offset?: Vector3): string {
    const camera = this.scene.activeCamera;
    if (!camera) {
      console.error("[ParticleService] No active camera");
      return "";
    }

    const position = offset
      ? camera.position.add(offset)
      : camera.position.clone();

    return this.emit({
      effectId: effectId,
      position: position,
      options: {
        cameraAttached: true,
        networkSync: false, // Camera-attached particles are local only
      },
    });
  }

  /**
   * Create screen overlay particles
   */
  createScreenOverlayParticles(effectId: string, duration: number): string {
    // Screen overlay particles are attached to camera with no offset
    return this.emit({
      effectId: effectId,
      position: this.scene.activeCamera!.position.clone(),
      options: {
        cameraAttached: true,
        duration: duration,
        networkSync: false,
      },
    });
  }

  /**
   * Create attack impact particles
   */
  createAttackImpact(
    attackType: string,
    targetPlayerId: string,
    intensity: number
  ): string {
    // Map attack types to effect IDs
    const attackEffectMap: Record<string, string> = {
      shake: "attack-shake-impact",
      drunk: "attack-drunk-impact",
      spin: "attack-spin-impact",
      blind: "attack-blind-flash",
      confusion: "attack-confusion-swirl",
    };

    const effectId = attackEffectMap[attackType];
    if (!effectId) {
      console.warn(
        `[ParticleService] No effect for attack type: ${attackType}`
      );
      return "";
    }

    return this.emitAtPlayer(targetPlayerId, effectId, new Vector3(0, 2, 0));
  }

  /**
   * Create continuous effect (e.g., drunk aura)
   */
  createContinuousEffect(
    effectId: string,
    duration: number,
    playerId?: string
  ): string {
    if (playerId) {
      return this.emitAtPlayer(playerId, effectId, new Vector3(0, 1, 0));
    } else {
      const position = this.scene.activeCamera!.position.clone();
      return this.emit({
        effectId: effectId,
        position: position,
        options: {
          duration: duration,
          networkSync: false,
        },
      });
    }
  }

  /**
   * Stop a running particle effect
   */
  stop(instanceId: string): void {
    const instance = this.activeParticles.get(instanceId);
    if (!instance) return;

    instance.system.stop();

    // Return to pool after particles fade
    setTimeout(() => {
      this.returnToPool(instance.system);
      this.activeParticles.delete(instanceId);
    }, instance.system.maxLifeTime * 1000);

    console.log(`[ParticleService] Stopped ${instanceId}`);
  }

  /**
   * Stop all active particles
   */
  stopAll(): void {
    this.activeParticles.forEach((_, id) => {
      this.stop(id);
    });
  }

  /**
   * Create particle system from effect definition
   */
  private createParticleSystem(effect: ParticleEffect): ParticleSystem {
    // Try to get from pool
    let system = this.getFromPool();

    // Configure system
    system.name = effect.id;
    system.particleTexture = new Texture(effect.particleTexture, this.scene);
    system.minEmitPower = effect.minEmitPower;
    system.maxEmitPower = effect.maxEmitPower;
    system.minLifeTime = effect.minLifeTime;
    system.maxLifeTime = effect.maxLifeTime;
    system.emitRate = effect.emitRate;
    system.maxParticles = effect.maxParticles;
    system.blendMode = effect.blendMode;
    system.color1 = effect.color1;
    system.color2 = effect.color2;
    system.colorDead = effect.colorDead;
    system.minSize = effect.minSize;
    system.maxSize = effect.maxSize;
    system.gravity = effect.gravity;
    system.direction1 = effect.direction1;
    system.direction2 = effect.direction2;
    system.minAngularSpeed = effect.minAngularSpeed;
    system.maxAngularSpeed = effect.maxAngularSpeed;

    return system;
  }

  /**
   * Get particle system from pool or create new
   */
  private getFromPool(): ParticleSystem {
    if (this.particlePool.length > 0) {
      const system = this.particlePool.pop()!;
      system.reset();
      return system;
    }

    return new ParticleSystem("pooled", 100, this.scene);
  }

  /**
   * Return particle system to pool
   */
  private returnToPool(system: ParticleSystem): void {
    system.stop();
    system.reset();

    // Only pool if not at capacity
    if (this.particlePool.length < 50) {
      this.particlePool.push(system);
    } else {
      system.dispose();
    }
  }

  /**
   * Apply quality settings to effect
   */
  private applyQuality(effect: ParticleEffect): ParticleEffect {
    const multiplier = this.qualityMultipliers[this.quality];

    return {
      ...effect,
      maxParticles: Math.floor(effect.maxParticles * multiplier.particles),
      emitRate: Math.floor(effect.emitRate * multiplier.emitRate),
    };
  }

  /**
   * Check if we can emit more particles
   */
  private canEmit(): boolean {
    return this.activeParticles.size < this.maxActiveParticles;
  }

  /**
   * Broadcast particle event to network
   */
  private broadcastParticleEvent(event: ParticleEvent): void {
    const networkEvent: ParticleNetworkEvent = {
      type: "particle:emit",
      effectId: event.effectId,
      position: {
        x: event.position.x,
        y: event.position.y,
        z: event.position.z,
      },
      options: event.options,
      timestamp: Date.now(),
    };

    // Dispatch custom event for network layer to handle
    document.dispatchEvent(
      new CustomEvent("particle:network:emit", {
        detail: networkEvent,
      })
    );
  }

  /**
   * Handle incoming network particle event
   */
  handleNetworkEvent(event: ParticleNetworkEvent): void {
    // Calculate latency compensation
    const latency = Date.now() - event.timestamp;
    const adjustedDuration = event.options?.duration
      ? Math.max(0, event.options.duration - latency)
      : undefined;

    // Emit particles
    this.emit({
      effectId: event.effectId,
      position: new Vector3(
        event.position.x,
        event.position.y,
        event.position.z
      ),
      options: {
        ...event.options,
        duration: adjustedDuration,
        networkSync: false, // Prevent echo
      },
    });
  }

  /**
   * Set particle quality tier
   */
  setQuality(quality: ParticleQuality): void {
    this.quality = quality;
    console.log(`[ParticleService] Quality set to: ${quality}`);
  }

  /**
   * Set max active particles (performance budget)
   */
  setMaxActiveParticles(max: number): void {
    this.maxActiveParticles = max;
  }

  /**
   * Enable/disable network synchronization
   */
  enableNetworkSync(enabled: boolean): void {
    this.networkSyncEnabled = enabled;
    console.log(
      `[ParticleService] Network sync ${enabled ? "enabled" : "disabled"}`
    );
  }

  /**
   * Get current statistics
   */
  getStats(): {
    activeParticles: number;
    pooledParticles: number;
    registeredEffects: number;
  } {
    return {
      activeParticles: this.activeParticles.size,
      pooledParticles: this.particlePool.length,
      registeredEffects: this.effectRegistry.size,
    };
  }

  /**
   * Cleanup on dispose
   */
  dispose(): void {
    this.stopAll();
    this.particlePool.forEach((system) => system.dispose());
    this.particlePool = [];
    this.effectRegistry.clear();
    console.log("[ParticleService] Disposed");
  }
}

/**
 * Singleton instance (initialized in main.ts)
 */
export let particleService: ParticleService;

/**
 * Initialize particle service
 */
export function initParticleService(scene: Scene): void {
  particleService = new ParticleService(scene);
  console.log("[ParticleService] Initialized");
}

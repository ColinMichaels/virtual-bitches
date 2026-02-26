# Particle System Documentation

**Status**: In Development
**Version**: 1.0.0
**Last Updated**: 2026-02-24

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Concepts](#core-concepts)
4. [API Reference](#api-reference)
5. [Effect Definitions](#effect-definitions)
6. [Integration Examples](#integration-examples)
7. [Performance Optimization](#performance-optimization)
8. [Network Synchronization](#network-synchronization)
9. [Implementation Roadmap](#implementation-roadmap)

---

## Overview

The **Particle System** is a centralized, event-driven service for managing all visual particle effects in BISCUITS. It provides:

- **Centralized Management**: Single source of truth for all particle effects
- **Event-Driven Architecture**: Automatic emission based on game events
- **Particle Pooling**: Reuse particle systems for optimal performance
- **Multiplayer Sync**: Network protocol for synchronized visual effects
- **Quality Settings**: Adaptive particle density based on device capability
- **Integration Points**: Clean APIs for Camera, Player, and Chaos systems

### Design Goals

1. **Performance**: Particle pooling and LOD system for 60 FPS on all devices
2. **Flexibility**: Effect registry allows for easy creation of new effects
3. **Multiplayer Ready**: Built-in network synchronization
4. **Developer Experience**: Simple API for common use cases
5. **Visual Quality**: Rich, expressive particle effects that enhance gameplay

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        ParticleService                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Effect     │  │   Particle   │  │    Event     │         │
│  │   Registry   │  │     Pool     │  │ Subscription │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
           │                    │                    │
           ▼                    ▼                    ▼
    ┌────────────┐      ┌────────────┐      ┌────────────┐
    │   Preset   │      │  BabylonJS │      │   Game     │
    │  Effects   │      │  Particle  │      │   Events   │
    │            │      │   System   │      │            │
    └────────────┘      └────────────┘      └────────────┘
           │                                        │
           ▼                                        ▼
    ┌────────────────────────────────────────────────────┐
    │              Integration Points                    │
    │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
    │  │  Camera  │  │  Player  │  │  Chaos   │       │
    │  │  System  │  │  System  │  │  System  │       │
    │  └──────────┘  └──────────┘  └──────────┘       │
    └────────────────────────────────────────────────────┘
```

### Data Flow

1. **Effect Registration**: Presets register effect definitions on initialization
2. **Event Emission**: Game events trigger particle emission via document.dispatchEvent
3. **Particle Creation**: ParticleService retrieves from pool or creates new ParticleSystem
4. **Effect Lifecycle**: Particles play, auto-dispose, return to pool
5. **Network Sync**: Multiplayer events broadcast to all clients for synchronized visuals

---

## Core Concepts

### Particle Effect

A **Particle Effect** is a reusable definition describing how particles should behave:

```typescript
interface ParticleEffect {
  id: string;                          // Unique identifier (e.g., "burst-gold")
  type: ParticleEffectType;            // Effect category
  particleTexture: string;             // Texture URL
  minEmitPower: number;                // Minimum particle velocity
  maxEmitPower: number;                // Maximum particle velocity
  minLifeTime: number;                 // Particle lifespan (seconds)
  maxLifeTime: number;
  emitRate: number;                    // Particles per second
  maxParticles: number;                // Total particle count
  blendMode: number;                   // BabylonJS blend mode
  color1: Color4;                      // Start color
  color2: Color4;                      // End color
  colorDead: Color4;                   // Color when particle dies
  minSize: number;                     // Starting size
  maxSize: number;                     // Ending size
  gravity: Vector3;                    // Gravity effect
  direction1: Vector3;                 // Emission cone min
  direction2: Vector3;                 // Emission cone max
  minAngularSpeed: number;             // Rotation speed
  maxAngularSpeed: number;
  duration?: number;                   // Auto-stop after duration (ms)
}
```

### Particle Event

A **Particle Event** is a request to emit particles:

```typescript
interface ParticleEvent {
  effectId: string;                    // ID from effect registry
  position: Vector3;                   // World position
  options?: {
    duration?: number;                 // Override effect duration
    scale?: number;                    // Scale effect size (0.5 = half)
    playerId?: string;                 // Attach to player
    cameraAttached?: boolean;          // Attach to camera
    networkSync?: boolean;             // Broadcast to multiplayer clients
  };
}
```

### Quality Tiers

Particle density adapts to device capability:

| Quality | Particle Count | Emit Rate | Use Case |
|---------|---------------|-----------|----------|
| **Low** | 50% | 50% | Mobile devices, low-end PCs |
| **Medium** | 75% | 75% | Mid-range devices (default) |
| **High** | 100% | 100% | High-end PCs, dedicated GPUs |
| **Ultra** | 150% | 125% | Enthusiast hardware |

### Intensity Levels

Particle intensity controls celebration and achievement particles based on player preference:

| Intensity | Scale Multiplier | Celebrations | Use Case |
|-----------|-----------------|--------------|----------|
| **Off** | 0% (disabled) | None | Players who prefer clean gameplay |
| **Minimal** | 30% | None | Subtle feedback only (scoring dice) |
| **Normal** | 60% | 2-3 bursts | Balanced feel (default) |
| **Enthusiastic** | 100% | 4 bursts | Full celebration mode for streamers |

**Intensity affects**:
- Scale of all particle emissions
- Number of celebration bursts (perfect roll, game complete)
- Dice roll landing particles reduced to subtle feedback
- Scoring particles remain visible at all non-off levels

**Note**: Intensity multiplies the base scale, so a particle with scale 1.0 at "normal" intensity becomes scale 0.6 (1.0 × 0.6).

---

## API Reference

### ParticleService

#### Core Methods

##### `emit(event: ParticleEvent): string`

Emit particles based on a ParticleEvent.

**Returns**: Unique instance ID for controlling the emitted particles.

```typescript
const instanceId = particleService.emit({
  effectId: 'burst-gold',
  position: new Vector3(0, 2, 0),
  options: {
    scale: 1.5,
    networkSync: true
  }
});
```

---

##### `emitForEvent(eventType: string, position: Vector3, options?: ParticleOptions): string`

Convenience method for emitting particles based on game event type.

**Supported Event Types**:
- `'score'` - Player scored dice
- `'bust'` - Player busted
- `'perfect'` - Perfect roll
- `'achievement'` - Achievement unlocked
- `'attack'` - Chaos attack hit
- `'roll'` - Dice rolled

```typescript
particleService.emitForEvent('score', new Vector3(5, 1, 5), {
  playerId: 'player-123',
  networkSync: true
});
```

---

##### `emitAtPlayer(playerId: string, effectId: string, offset?: Vector3): string`

Emit particles at a player's position.

**Parameters**:
- `playerId` - Target player ID
- `effectId` - Effect to emit
- `offset` - Optional offset from player position

```typescript
particleService.emitAtPlayer('player-123', 'celebration-confetti', new Vector3(0, 2, 0));
```

---

##### `stop(instanceId: string): void`

Stop a running particle effect.

```typescript
particleService.stop(instanceId);
```

---

##### `stopAll(): void`

Stop all active particle effects.

```typescript
particleService.stopAll();
```

---

#### Camera Integration Methods

##### `attachToCamera(effectId: string, offset?: Vector3): string`

Attach particles to the camera (e.g., for drunk vision sparkles).

```typescript
const drunkSparkles = particleService.attachToCamera('drunk-sparkles', new Vector3(0, 0, 2));
```

---

##### `createScreenOverlayParticles(effectId: string, duration: number): string`

Create screen-space particles (e.g., screen shake debris).

**Parameters**:
- `effectId` - Effect to display
- `duration` - Effect duration in milliseconds

```typescript
particleService.createScreenOverlayParticles('shake-debris', 5000);
```

---

#### Chaos Attack Integration Methods

##### `createAttackImpact(attackType: string, targetPlayerId: string, intensity: number): string`

Create visual feedback for chaos attack impact.

**Attack Types**:
- `'shake'` - Screen shake attack
- `'drunk'` - Drunk vision attack
- `'spin'` - Camera spin attack
- `'blind'` - Blind spell
- `'confusion'` - Confusion hex

```typescript
particleService.createAttackImpact('drunk', 'player-123', 0.8);
```

---

##### `createContinuousEffect(effectId: string, duration: number, playerId?: string): string`

Create long-running particle effect (e.g., drunk aura).

```typescript
const auraId = particleService.createContinuousEffect('drunk-aura', 12000, 'player-123');
```

---

#### Effect Registry Methods

##### `registerEffect(effect: ParticleEffect): void`

Register a new particle effect definition.

```typescript
particleService.registerEffect({
  id: 'custom-burst',
  type: 'burst',
  particleTexture: '/textures/particle.png',
  // ... properties
});
```

---

##### `getEffect(id: string): ParticleEffect | null`

Retrieve effect definition by ID.

```typescript
const effect = particleService.getEffect('burst-gold');
```

---

##### `unregisterEffect(id: string): void`

Remove effect from registry.

```typescript
particleService.unregisterEffect('custom-burst');
```

---

#### Configuration Methods

##### `setQuality(quality: 'low' | 'medium' | 'high' | 'ultra'): void`

Set particle quality tier.

```typescript
particleService.setQuality('high');
```

---

##### `setIntensity(intensity: 'off' | 'minimal' | 'normal' | 'enthusiastic'): void`

Set particle intensity level for celebrations and achievements.

```typescript
// Read from settings
const settings = settingsService.getSettings();
particleService.setIntensity(settings.display.particleIntensity);
```

---

##### `getIntensity(): ParticleIntensity`

Get current particle intensity level.

```typescript
const currentIntensity = particleService.getIntensity();
```

---

##### `setMaxActiveParticles(max: number): void`

Limit total active particle systems (performance safeguard).

```typescript
particleService.setMaxActiveParticles(20);
```

---

##### `enableNetworkSync(enabled: boolean): void`

Enable/disable network synchronization for multiplayer.

```typescript
particleService.enableNetworkSync(true);
```

---

## Effect Definitions

### Built-in Effect Types

#### Burst Effects

**Purpose**: Instant explosion of particles in all directions.

**Use Cases**: Score celebrations, dice hits, attack impacts.

**Example Effects**:
- `burst-gold` - Gold coin burst for scoring
- `burst-white` - White flash for perfect rolls
- `burst-red` - Red impact for attacks

```typescript
{
  id: 'burst-gold',
  type: 'burst',
  particleTexture: '/textures/particle-coin.png',
  minEmitPower: 5,
  maxEmitPower: 10,
  minLifeTime: 0.5,
  maxLifeTime: 1.5,
  emitRate: 100,
  maxParticles: 50,
  blendMode: ParticleSystem.BLENDMODE_ONEONE,
  color1: new Color4(1, 0.84, 0, 1),
  color2: new Color4(1, 0.65, 0, 1),
  colorDead: new Color4(1, 0.4, 0, 0),
  minSize: 0.3,
  maxSize: 0.8,
  gravity: new Vector3(0, -9.81, 0),
  direction1: new Vector3(-1, 1, -1),
  direction2: new Vector3(1, 3, 1),
  minAngularSpeed: 0,
  maxAngularSpeed: Math.PI,
  duration: 1000
}
```

---

#### Trail Effects

**Purpose**: Follow-behind particle trails.

**Use Cases**: Dice motion trails, magic spell streaks.

**Example Effects**:
- `trail-dice` - Motion trail for rolling dice
- `trail-magic` - Magical streak for spell attacks

```typescript
{
  id: 'trail-dice',
  type: 'trail',
  particleTexture: '/textures/particle-glow.png',
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
  gravity: new Vector3(0, 0, 0),
  direction1: new Vector3(0, 0, 0),
  direction2: new Vector3(0, 0, 0),
  minAngularSpeed: 0,
  maxAngularSpeed: 0
}
```

---

#### Ambient Effects

**Purpose**: Continuous atmospheric particles.

**Use Cases**: Sparkles, smoke, fog, drunk vision effects.

**Example Effects**:
- `ambient-sparkles` - Floating sparkles for achievements
- `ambient-smoke` - Smoke wisps for mystery effects
- `drunk-sparkles` - Camera-attached drunk vision sparkles

```typescript
{
  id: 'drunk-sparkles',
  type: 'ambient',
  particleTexture: '/textures/particle-star.png',
  minEmitPower: 0.2,
  maxEmitPower: 0.5,
  minLifeTime: 1,
  maxLifeTime: 2,
  emitRate: 20,
  maxParticles: 40,
  blendMode: ParticleSystem.BLENDMODE_ONEONE,
  color1: new Color4(1, 1, 0.5, 0.6),
  color2: new Color4(1, 0.8, 0.3, 0.4),
  colorDead: new Color4(1, 0.6, 0, 0),
  minSize: 0.1,
  maxSize: 0.3,
  gravity: new Vector3(0, 0.5, 0),
  direction1: new Vector3(-0.5, -0.5, -0.5),
  direction2: new Vector3(0.5, 0.5, 0.5),
  minAngularSpeed: 0,
  maxAngularSpeed: Math.PI * 2
}
```

---

#### Attack Effects

**Purpose**: Visual feedback for chaos attacks.

**Use Cases**: Attack impacts, continuous attack auras.

**Example Effects**:
- `attack-shake-impact` - Debris burst for screen shake hit
- `attack-drunk-aura` - Glowing aura for drunk vision effect
- `attack-blind-flash` - Blinding white flash

```typescript
{
  id: 'attack-drunk-aura',
  type: 'ambient',
  particleTexture: '/textures/particle-glow.png',
  minEmitPower: 0.5,
  maxEmitPower: 1,
  minLifeTime: 0.8,
  maxLifeTime: 1.5,
  emitRate: 30,
  maxParticles: 60,
  blendMode: ParticleSystem.BLENDMODE_ADD,
  color1: new Color4(0.8, 0.4, 0.8, 0.5),
  color2: new Color4(0.6, 0.3, 0.6, 0.3),
  colorDead: new Color4(0.4, 0.2, 0.4, 0),
  minSize: 0.5,
  maxSize: 1.2,
  gravity: new Vector3(0, 0.2, 0),
  direction1: new Vector3(-0.3, -0.3, -0.3),
  direction2: new Vector3(0.3, 0.3, 0.3),
  minAngularSpeed: -Math.PI / 2,
  maxAngularSpeed: Math.PI / 2
}
```

---

## Integration Examples

### Game Event Integration

Automatic particle emission based on game events:

```typescript
// In main.ts or game controller

// Score event
document.addEventListener('game:score', ((e: CustomEvent) => {
  const { playerId, diceValue, position } = e.detail;

  particleService.emitForEvent('score', position, {
    playerId: playerId,
    scale: diceValue >= 5 ? 1.5 : 1.0, // Bigger burst for high values
    networkSync: true
  });
}) as EventListener);

// Bust event
document.addEventListener('game:bust', ((e: CustomEvent) => {
  const { playerId, position } = e.detail;

  particleService.emitForEvent('bust', position, {
    playerId: playerId,
    networkSync: true
  });
}) as EventListener);

// Perfect roll event
document.addEventListener('game:perfect', ((e: CustomEvent) => {
  const { playerId, position } = e.detail;

  particleService.emitForEvent('perfect', position, {
    playerId: playerId,
    scale: 2.0, // Extra large for perfect rolls
    networkSync: true
  });
}) as EventListener);

// Achievement unlocked
document.addEventListener('game:achievement', ((e: CustomEvent) => {
  const { playerId, position } = e.detail;

  particleService.emitForEvent('achievement', position, {
    playerId: playerId,
    duration: 3000,
    networkSync: true
  });
}) as EventListener);
```

---

### Player System Integration

Emit particles at player positions:

```typescript
// In Player.ts or PlayerController.ts

export class Player {
  // ... existing code ...

  /**
   * Celebrate scoring with particle effect
   */
  celebrate(diceValue: number): void {
    const scorePosition = this.getScoreAreaPosition();

    // Emit celebration particles
    particleService.emitAtPlayer(this.id, 'celebration-confetti', new Vector3(0, 2, 0));

    // Emit score-specific particles
    if (diceValue >= 5) {
      particleService.emit({
        effectId: 'burst-gold',
        position: scorePosition,
        options: {
          scale: 1.5,
          networkSync: true
        }
      });
    } else {
      particleService.emit({
        effectId: 'burst-white',
        position: scorePosition,
        options: {
          scale: 1.0,
          networkSync: true
        }
      });
    }
  }

  /**
   * Show particle indicator for active player
   */
  showActiveIndicator(): void {
    this.activeIndicatorId = particleService.emitAtPlayer(
      this.id,
      'ambient-sparkles',
      new Vector3(0, 3, 0)
    );
  }

  /**
   * Hide particle indicator
   */
  hideActiveIndicator(): void {
    if (this.activeIndicatorId) {
      particleService.stop(this.activeIndicatorId);
      this.activeIndicatorId = undefined;
    }
  }
}
```

---

### Camera System Integration

Attach particles to camera for screen effects:

```typescript
// In CameraEffectsAPI (from CAMERA-ATTACKS-INTEGRATION.md)

export class CameraEffectsAPI {
  private activeEffects: Map<string, { particle?: string; timer?: number }> = new Map();

  /**
   * Apply drunk vision with particle effects
   */
  applyDrunkVision(severity: 'light' | 'medium' | 'blackout', duration: number): void {
    const effectId = `drunk-${severity}`;

    // Apply camera distortion (existing code)
    // ...

    // Add drunk sparkles attached to camera
    const particleId = particleService.attachToCamera('drunk-sparkles', new Vector3(0, 0, 2));

    // Store for cleanup
    this.activeEffects.set(effectId, {
      particle: particleId,
      timer: window.setTimeout(() => {
        this.clearDrunkVision();
      }, duration)
    });
  }

  /**
   * Clear drunk vision and particles
   */
  clearDrunkVision(): void {
    const effect = this.activeEffects.get('drunk-light')
                || this.activeEffects.get('drunk-medium')
                || this.activeEffects.get('drunk-blackout');

    if (effect?.particle) {
      particleService.stop(effect.particle);
    }

    // Clear camera distortion (existing code)
    // ...
  }

  /**
   * Apply screen shake with debris particles
   */
  applyShake(intensity: number, duration: number): void {
    // Apply camera shake (existing code)
    // ...

    // Add screen shake debris overlay
    particleService.createScreenOverlayParticles('shake-debris', duration);
  }
}
```

---

### Chaos Attack Integration

Visual feedback for chaos attacks:

```typescript
// In ChaosAttackSystem or multiplayer attack handler

export class ChaosAttackSystem {
  /**
   * Execute chaos attack with visual feedback
   */
  executeAttack(
    attackType: string,
    attackerId: string,
    targetId: string,
    intensity: number
  ): void {
    // Get target player position
    const targetPlayer = this.playerManager.getPlayer(targetId);
    if (!targetPlayer) return;

    // Create attack impact particles
    particleService.createAttackImpact(attackType, targetId, intensity);

    // Apply attack effect based on type
    switch (attackType) {
      case 'shake':
        cameraEffectsAPI.applyShake(intensity, 5000);
        break;

      case 'drunk':
        // Determine severity based on intensity
        let severity: 'light' | 'medium' | 'blackout' = 'light';
        if (intensity >= 0.8) severity = 'blackout';
        else if (intensity >= 0.5) severity = 'medium';

        cameraEffectsAPI.applyDrunkVision(severity, 8000 + intensity * 7000);

        // Add continuous drunk aura
        particleService.createContinuousEffect('attack-drunk-aura', 8000 + intensity * 7000, targetId);
        break;

      case 'spin':
        cameraEffectsAPI.applySpin(intensity * 360, 5000);

        // Add spinning particle trail
        particleService.createScreenOverlayParticles('spin-trail', 5000);
        break;

      case 'blind':
        // Blinding white flash
        particleService.createScreenOverlayParticles('attack-blind-flash', 2000);
        break;

      case 'confusion':
        // Confusion particles around player
        particleService.emitAtPlayer(targetId, 'confusion-swirl', new Vector3(0, 2, 0));
        break;
    }

    // Broadcast to multiplayer clients
    if (this.networkSync) {
      this.broadcastAttack(attackType, attackerId, targetId, intensity);
    }
  }
}
```

---

## Performance Optimization

### Particle Pooling

ParticleService uses object pooling to avoid create/destroy overhead:

```typescript
class ParticleService {
  private particlePool: ParticleSystem[] = [];
  private activeParticles: Map<string, ParticleSystem> = new Map();

  /**
   * Get particle system from pool or create new
   */
  private getFromPool(): ParticleSystem {
    if (this.particlePool.length > 0) {
      return this.particlePool.pop()!;
    }
    return new ParticleSystem('pooled', 100, this.scene);
  }

  /**
   * Return particle system to pool
   */
  private returnToPool(system: ParticleSystem): void {
    system.stop();
    system.reset();
    this.particlePool.push(system);
  }
}
```

**Benefits**:
- Reduces GC pressure
- Faster emission (no allocation overhead)
- Consistent frame times

---

### Quality Settings

Adaptive particle density based on device capability:

```typescript
class ParticleService {
  private qualityMultipliers = {
    low: { particles: 0.5, emitRate: 0.5 },
    medium: { particles: 0.75, emitRate: 0.75 },
    high: { particles: 1.0, emitRate: 1.0 },
    ultra: { particles: 1.5, emitRate: 1.25 }
  };

  /**
   * Apply quality multipliers to effect
   */
  private applyQuality(effect: ParticleEffect): ParticleEffect {
    const multiplier = this.qualityMultipliers[this.quality];

    return {
      ...effect,
      maxParticles: Math.floor(effect.maxParticles * multiplier.particles),
      emitRate: Math.floor(effect.emitRate * multiplier.emitRate)
    };
  }
}
```

**Auto-Detection**:
```typescript
// In initialization
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const isLowEnd = navigator.hardwareConcurrency <= 4;

if (isMobile || isLowEnd) {
  particleService.setQuality('low');
} else if (navigator.hardwareConcurrency >= 8) {
  particleService.setQuality('high');
} else {
  particleService.setQuality('medium');
}
```

---

### LOD (Level of Detail)

Distance-based particle culling:

```typescript
class ParticleService {
  /**
   * Update LOD based on camera distance
   */
  private updateLOD(): void {
    const cameraPos = this.scene.activeCamera!.position;

    this.activeParticles.forEach((system, id) => {
      const distance = Vector3.Distance(cameraPos, system.emitter as Vector3);

      if (distance > 50) {
        // Very far: disable
        system.stop();
      } else if (distance > 30) {
        // Far: reduce to 25%
        system.updateSpeed = 0.25;
      } else if (distance > 15) {
        // Medium: reduce to 50%
        system.updateSpeed = 0.5;
      } else {
        // Near: full speed
        system.updateSpeed = 1.0;
      }
    });
  }
}
```

---

### Performance Budget

Hard limits to prevent particle overload:

```typescript
class ParticleService {
  private maxActiveParticles = 20;
  private maxParticlesPerEffect = 200;

  /**
   * Check if we can emit more particles
   */
  private canEmit(): boolean {
    if (this.activeParticles.size >= this.maxActiveParticles) {
      console.warn('[ParticleService] Max active particles reached');
      return false;
    }
    return true;
  }
}
```

---

## Network Synchronization

### Multiplayer Protocol

Particle events are synchronized across clients for consistent visuals:

```typescript
// Client sends particle event
interface ParticleNetworkEvent {
  type: 'particle:emit';
  effectId: string;
  position: { x: number; y: number; z: number };
  options: {
    duration?: number;
    scale?: number;
    playerId?: string;
  };
  timestamp: number;
}

// Broadcast to all clients
socket.emit('particle:emit', {
  effectId: 'burst-gold',
  position: { x: 5, y: 1, z: 5 },
  options: {
    scale: 1.5,
    playerId: 'player-123'
  },
  timestamp: Date.now()
});
```

---

### Client-Side Handling

Receive and replay particle events:

```typescript
// Listen for particle events from server
socket.on('particle:emit', (data: ParticleNetworkEvent) => {
  // Calculate latency compensation
  const latency = Date.now() - data.timestamp;
  const adjustedDuration = data.options.duration ? data.options.duration - latency : undefined;

  // Emit particles
  particleService.emit({
    effectId: data.effectId,
    position: new Vector3(data.position.x, data.position.y, data.position.z),
    options: {
      ...data.options,
      duration: adjustedDuration,
      networkSync: false // Prevent echo
    }
  });
});
```

---

### Predictive Emission

Reduce perceived latency by predicting particle events:

```typescript
class ParticleService {
  /**
   * Emit with network sync (predictive)
   */
  emitWithSync(event: ParticleEvent): string {
    // Emit immediately (optimistic)
    const instanceId = this.emit(event);

    // Broadcast to network
    if (event.options?.networkSync) {
      socket.emit('particle:emit', {
        effectId: event.effectId,
        position: event.position,
        options: event.options,
        timestamp: Date.now()
      });
    }

    return instanceId;
  }
}
```

**Benefits**:
- Zero perceived latency for local player
- Smooth experience despite network delays
- Consistent visuals across all clients

---

## Implementation Roadmap

### Phase 1: Core Service (Week 1-2)
**Status**: In Progress

**Tasks**:
- ✅ Documentation complete
- ⏳ Implement ParticleService class
- ⏳ Create effect registry system
- ⏳ Implement particle pooling
- ⏳ Create basic effect definitions (burst, trail, ambient)
- ⏳ Refactor existing scene.ts particle usage

**Deliverables**:
- `src/services/particleService.ts` (800+ lines)
- `src/particles/effects/burstEffects.ts`
- `src/particles/effects/trailEffects.ts`
- `src/particles/effects/ambientEffects.ts`

---

### Phase 2: Game Integration (Week 3)
**Status**: Planned

**Tasks**:
- Integrate with game event system
- Add player celebration particles
- Create score/bust/perfect particle effects
- Add achievement unlock particles

**Deliverables**:
- `src/particles/presets/gameEffects.ts`
- Updated `src/main.ts` with event listeners
- Updated `src/multiplayer/Player.ts` with particle methods

---

### Phase 3: Camera & Chaos Integration (Week 4)
**Status**: Planned

**Tasks**:
- Create attack impact particles
- Add drunk vision particle effects
- Implement screen overlay particles
- Create camera-attached particle support

**Deliverables**:
- `src/particles/effects/attackEffects.ts`
- `src/particles/presets/chaosEffects.ts`
- Updated `docs/CAMERA-ATTACKS-INTEGRATION.md`

---

### Phase 4: Multiplayer Sync (Week 5)
**Status**: Planned

**Tasks**:
- Implement network synchronization
- Add latency compensation
- Create predictive emission system
- Test with multiple clients

**Deliverables**:
- Updated `src/services/particleService.ts` with network methods
- WebSocket protocol documentation
- Multiplayer test suite

---

### Phase 5: Optimization & Polish (Week 6)
**Status**: Planned

**Tasks**:
- Implement LOD system
- Add quality auto-detection
- Performance profiling and tuning
- Create custom particle textures

**Deliverables**:
- Optimized ParticleService
- Custom particle texture assets
- Performance benchmark report

---

## Future Enhancements

### Post-Launch Features

1. **Custom Particle Editor**
   - In-game particle effect creator
   - Real-time preview
   - Export/import particle definitions

2. **Premium Particle Packs**
   - Seasonal effects (Halloween, Christmas, etc.)
   - Themed packs (Cyberpunk, Fantasy, etc.)
   - Monetization opportunity

3. **Particle Trails for Dice**
   - Persistent motion trails during roll
   - Customizable trail colors
   - Unlockable via achievements

4. **Environmental Particles**
   - Table-wide ambient effects
   - Dynamic lighting interactions
   - Weather effects (rain, snow, etc.)

5. **Advanced Effects**
   - Mesh-based particles
   - Animated sprite sheets
   - GPU particle compute shaders

---

## Conclusion

The Particle System provides a solid foundation for rich, performant visual effects in BISCUITS. Its event-driven architecture ensures loose coupling with game systems, while particle pooling and quality settings maintain 60 FPS across all devices.

**Next Steps**:
1. Complete Phase 1 implementation (ParticleService core)
2. Create effect definitions and presets
3. Integrate with game events
4. Test multiplayer synchronization

For questions or suggestions, please refer to the main project documentation or contact the development team.

---

**Version History**:
- v1.0.0 (2026-02-24) - Initial documentation

# Camera Attack Integration & Upgrade System 🎥💥

**Document Version**: 1.1
**Last Updated**: 2026-02-25
**Status**: Phase 3 Scaffolding In Progress (Runtime + HUD + Upgrade Progression Foundation)
**Complexity**: Very High
**Dependencies**: Camera System (Phase 1+), Chaos Gameplay Mechanics, Multiplayer Infrastructure

> "Turn the camera from a passive recording tool into an active weapon of psychological warfare. Shake their world, blur their vision, spin them dizzy, and make them question reality itself." 🌀🍺

---

## Table of Contents

1. [Overview](#overview)
2. [Integration Architecture](#integration-architecture)
3. [Camera Effects API](#camera-effects-api)
4. [Drunk Vision System](#drunk-vision-system)
5. [Upgrade System](#upgrade-system)
6. [Attack Abilities](#attack-abilities)
7. [Technical Implementation](#technical-implementation)
8. [Balancing & Safeguards](#balancing--safeguards)
9. [Monetization](#monetization)
10. [Development Roadmap](#development-roadmap)

---

## Overview

### What is Camera Attack Integration?

Camera Attack Integration merges the **Camera System** with **Chaos Gameplay Mechanics**, enabling players to weaponize camera manipulation against opponents. This creates immersive visual disruption that goes beyond simple on-screen effects—it directly manipulates the player's perspective, creating disorientation, confusion, and "drunk vision" effects.

### Why Camera Attacks?

Traditional game attacks show visual effects ON the screen (overlays, particles, flashes). Camera attacks manipulate the screen ITSELF by moving the virtual camera, creating a more visceral and disorienting experience that:

- **Feels more impactful**: The entire game world moves, not just overlays
- **Harder to ignore**: Can't just "look past" a shaking camera
- **Creates unique gameplay**: Muscle memory breaks when view angles change
- **Enables "drunk" mechanics**: Perfect for alcohol-themed disruption

### Current State

✅ **Existing Systems**:
- Camera System (Phase 1): Save/load positions, basic controls
- Chaos Gameplay Mechanics (Documented): Attack framework, Chaos Points economy
- Screen Shake attack specified in CHAOS-GAMEPLAY-MECHANICS.md

✅ **Particle System**: Event-driven particle effects for visual feedback (see PARTICLE-SYSTEM.md)

✅ **New Foundation (2026-02-25)**:
- `CameraEffectsService` implemented with shake/spin/zoom/drunk runtime effects
- `CameraAttackExecutor` implemented for typed camera-attack message mapping
- Event bridge added in `main.ts` (`chaos:cameraAttack` dispatch integration)
- WebSocket multiplayer bridge implemented (`src/multiplayer/networkService.ts`)
- Drunk vision post-processing pipeline implemented (`src/chaos/effects/postProcessingPipeline.ts`)
- Effect conflict queue/stacking policy implemented in `CameraEffectsService` (typed caps + queued drain + child stacking lane)
- Active camera effect HUD implemented (`src/ui/effectHUD.ts`) with timers/intensity/queue visibility
- Upgrade progression scaffolding implemented (`src/chaos/upgrades/*`) with definitions, XP/tokens, unlock validation, and persistence
- `ChaosUpgradeMenu` UI scaffold implemented (`src/ui/chaosUpgradeMenu.ts`) and wired to desktop/mobile input controls
- Progression-to-execution profile resolver implemented (`src/chaos/upgrades/executionProfile.ts`) and wired into `CameraAttackExecutor`
- Local progression execution trigger added in upgrade UI (cast current unlocked level via `chaos:cameraAttack`)
- Control inversion runtime implemented (`src/services/controlInversion.ts`) and wired into input/executor flow
- Accessibility safeguards wired into settings + executor (`reduceChaosCameraEffects`, `allowChaosControlInversion`)
- Unit-style executor tests added (`src/chaos/cameraAttackExecutor.test.ts`)
- Unit-style network bridge tests added (`src/multiplayer/networkService.test.ts`)
- Camera effects queue/stacking + post-processing tests added (`src/services/cameraEffects.test.ts`)
- Upgrade progression tests added (`src/chaos/upgrades/progressionService.test.ts`)
- Upgrade execution-profile tests added (`src/chaos/upgrades/executionProfile.test.ts`)
- Control inversion tests added (`src/services/controlInversion.test.ts`)

❌ **Missing Components**:
- Backend profile sync for progression/token state
- Backend API + DB integration for player settings/profile and match logs
- Service worker/off-main-thread task offloading for heavy background processing
- Production multiplayer backend/session integration (auth, rooms, server validation)

---

## Integration Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                  CAMERA ATTACK SYSTEM                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐         ┌──────────────┐            │
│  │ CameraService│         │ChaosMechanics│            │
│  │ (Existing)   │         │  (Existing)  │            │
│  └──────┬───────┘         └──────┬───────┘            │
│         │                        │                     │
│         │  ┌─────────────────────┘                     │
│         │  │                                           │
│         ▼  ▼                                           │
│  ┌──────────────────┐                                 │
│  │ CameraEffectsAPI │ ◄─────────┐                     │
│  │   (NEW LAYER)    │            │                     │
│  └────────┬─────────┘            │                     │
│           │                      │                     │
│           ├──► Shake Effects     │                     │
│           ├──► Spin Effects   ┌──┴────────────┐       │
│           ├──► Zoom Effects   │ UpgradeSystem │       │
│           ├──► Tilt Effects   │     (NEW)     │       │
│           └──► Drunk Vision   └───────────────┘       │
│                    │                                   │
│                    ▼                                   │
│           ┌────────────────┐                          │
│           │  GameScene     │                          │
│           │  Camera Manip  │                          │
│           └────────────────┘                          │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Data Flow

```
Player A uses "Get 'Em Drunk" attack on Player B
        │
        ▼
Chaos System validates (CP cost, cooldown, target)
        │
        ▼
CameraEffectsAPI.drunk(severity, duration, targetPlayer)
        │
        ▼
WebSocket broadcasts attack to Player B's client
        │
        ▼
Player B's GameScene.camera receives effect commands
        │
        ▼
BabylonJS Animation + Post-Processing applied
        │
        ▼
Player B experiences drunk vision for duration
        │
        ▼
Effect expires → Camera returns to normal
```

---

## Camera Effects API

### Core Interface

```typescript
// src/services/cameraEffects.ts

export interface CameraEffect {
  id: string;
  type: 'shake' | 'spin' | 'zoom' | 'tilt' | 'drunk' | 'blur' | 'vortex';
  intensity: number;     // 0.0 - 2.0
  duration: number;      // milliseconds
  startTime: number;     // timestamp
  target?: Vector3;      // Optional focus point
}

export class CameraEffectsService {
  private scene: GameScene;
  private activeEffects: Map<string, CameraEffect> = new Map();
  private effectQueue: CameraEffect[] = [];

  constructor(scene: GameScene) {
    this.scene = scene;
  }

  // ========================================
  // Basic Effects
  // ========================================

  /**
   * Shake camera with varying intensity
   * @param intensity 0.1 (gentle) to 2.0 (violent earthquake)
   * @param duration Milliseconds
   */
  shake(intensity: number, duration: number): string {
    const effectId = this.generateId();
    const effect: CameraEffect = {
      id: effectId,
      type: 'shake',
      intensity: Math.max(0.1, Math.min(2.0, intensity)),
      duration,
      startTime: Date.now(),
    };

    this.startEffect(effect);
    return effectId;
  }

  /**
   * Spin camera around target
   * @param rotations Number of full rotations (negative = reverse)
   * @param duration Milliseconds
   */
  spin(rotations: number, duration: number): string {
    const effectId = this.generateId();
    const effect: CameraEffect = {
      id: effectId,
      type: 'spin',
      intensity: rotations,
      duration,
      startTime: Date.now(),
    };

    this.startEffect(effect);
    return effectId;
  }

  /**
   * Zoom camera in/out
   * @param distance Positive = zoom out, Negative = zoom in
   * @param duration Milliseconds
   */
  zoom(distance: number, duration: number): string {
    const effectId = this.generateId();
    const originalRadius = this.scene.camera.radius;

    // Animate camera radius
    this.animateProperty(
      this.scene.camera,
      'radius',
      originalRadius + distance,
      duration
    );

    return effectId;
  }

  /**
   * Tilt camera (Dutch angle)
   * @param angle Degrees of tilt
   * @param duration Milliseconds
   */
  tilt(angle: number, duration: number): string {
    // Note: ArcRotateCamera doesn't natively support roll
    // Would need to implement via custom rotation matrix
    // OR switch to UniversalCamera for this effect
    return this.generateId();
  }

  // ========================================
  // Complex Effects
  // ========================================

  /**
   * Drunk vision effect (multi-layered)
   * @param severity light|medium|blackout
   * @param duration Milliseconds
   */
  drunk(severity: 'light' | 'medium' | 'blackout', duration: number): string {
    const effectId = this.generateId();

    switch (severity) {
      case 'light':
        this.startDrunkLight(effectId, duration);
        break;
      case 'medium':
        this.startDrunkMedium(effectId, duration);
        break;
      case 'blackout':
        this.startDrunkBlackout(effectId, duration);
        break;
    }

    // Add particle effects for visual feedback
    // See: PARTICLE-SYSTEM.md - Chaos Attack Integration
    import { emitDrunkAttack } from '../particles/presets/chaosEffects.js';
    const sparklesId = emitDrunkAttack(this.targetPlayerId, severity, duration);

    // Store sparkles ID for cleanup
    this.activeParticleEffects.set(effectId, sparklesId);

    return effectId;
  }

  /**
   * Blur effect via post-processing
   * @param amount 0.0 (none) to 1.0 (maximum blur)
   * @param duration Milliseconds
   */
  blur(amount: number, duration: number): string {
    const effectId = this.generateId();

    // Use BabylonJS BlurPostProcess
    const blurEffect = new BlurPostProcess(
      'drunk-blur',
      new Vector2(1.0, 1.0),
      amount * 10, // Kernel size
      1.0,
      this.scene.camera
    );

    setTimeout(() => {
      blurEffect.dispose();
      this.removeEffect(effectId);
    }, duration);

    return effectId;
  }

  /**
   * Double vision (overlapping offset view)
   * @param offset Pixel offset
   * @param duration Milliseconds
   */
  doubleVision(offset: number, duration: number): string {
    // Implement via custom post-processing shader
    // that renders scene twice with slight offset
    return this.generateId();
  }

  /**
   * Vortex effect (spiral into center)
   * @param rotationSpeed Revolutions per second
   * @param duration Milliseconds
   */
  vortex(rotationSpeed: number, duration: number): string {
    const effectId = this.generateId();

    // Combine zoom + spin for vortex
    this.zoom(-10, duration);
    this.spin(rotationSpeed * (duration / 1000), duration);

    return effectId;
  }

  /**
   * Invert camera (upside down)
   * @param duration Milliseconds
   */
  invert(duration: number): string {
    const effectId = this.generateId();

    // Rotate camera beta by π (180°)
    const originalBeta = this.scene.camera.beta;

    this.animateProperty(
      this.scene.camera,
      'beta',
      Math.PI - originalBeta,
      500 // Quick flip
    );

    setTimeout(() => {
      // Restore original
      this.animateProperty(
        this.scene.camera,
        'beta',
        originalBeta,
        500
      );
      this.removeEffect(effectId);
    }, duration);

    return effectId;
  }

  // ========================================
  // Effect Management
  // ========================================

  /**
   * Check if specific effect type is active
   */
  isEffectActive(effectType: string): boolean {
    return Array.from(this.activeEffects.values()).some(
      effect => effect.type === effectType
    );
  }

  /**
   * Get all active effects
   */
  getActiveEffects(): CameraEffect[] {
    return Array.from(this.activeEffects.values());
  }

  /**
   * Stop specific effect
   */
  stopEffect(effectId: string): void {
    this.removeEffect(effectId);
  }

  /**
   * Clear all active effects (emergency stop)
   */
  clearAllEffects(): void {
    this.activeEffects.clear();
    this.effectQueue = [];
    // TODO: Restore camera to saved "safe" position
  }

  // ========================================
  // Private Implementation
  // ========================================

  private startEffect(effect: CameraEffect): void {
    this.activeEffects.set(effect.id, effect);

    switch (effect.type) {
      case 'shake':
        this.executeShake(effect);
        break;
      case 'spin':
        this.executeSpin(effect);
        break;
      // ... other effects
    }

    // Auto-remove after duration
    setTimeout(() => {
      this.removeEffect(effect.id);
    }, effect.duration);
  }

  private executeShake(effect: CameraEffect): void {
    const interval = 16; // 60fps
    const shakeTimer = setInterval(() => {
      if (!this.activeEffects.has(effect.id)) {
        clearInterval(shakeTimer);
        return;
      }

      // Random offset based on intensity
      const offsetAlpha = (Math.random() - 0.5) * effect.intensity * 0.1;
      const offsetBeta = (Math.random() - 0.5) * effect.intensity * 0.05;

      this.scene.camera.alpha += offsetAlpha;
      this.scene.camera.beta += offsetBeta;
    }, interval);
  }

  private executeSpin(effect: CameraEffect): void {
    const fullRotation = Math.PI * 2 * effect.intensity;
    const startAlpha = this.scene.camera.alpha;

    this.animateProperty(
      this.scene.camera,
      'alpha',
      startAlpha + fullRotation,
      effect.duration
    );
  }

  private startDrunkLight(effectId: string, duration: number): void {
    // Light drunk: Slight sway + minimal blur
    const swayInterval = setInterval(() => {
      if (!this.activeEffects.has(effectId)) {
        clearInterval(swayInterval);
        return;
      }

      const sway = Math.sin(Date.now() / 1000) * 0.02;
      this.scene.camera.beta += sway;
    }, 16);

    this.blur(0.1, duration);
  }

  private startDrunkMedium(effectId: string, duration: number): void {
    // Medium drunk: Wobble + blur + double vision
    this.shake(0.3, duration);
    this.blur(0.3, duration);
    this.doubleVision(10, duration);
  }

  private startDrunkBlackout(effectId: string, duration: number): void {
    // Blackout drunk: Everything + screen fades
    this.shake(0.8, duration);
    this.blur(0.6, duration);
    this.doubleVision(20, duration);
    this.spin(2, duration);

    // Periodic blackouts
    const blackoutInterval = setInterval(() => {
      if (!this.activeEffects.has(effectId)) {
        clearInterval(blackoutInterval);
        return;
      }

      // Fade to black for 1 second every 4 seconds
      this.fadeToBlack(1000);
    }, 4000);
  }

  private fadeToBlack(duration: number): void {
    // Use BabylonJS FadeInOutBehavior or custom shader
    // Animate scene alpha to 0 then back to 1
  }

  private animateProperty(
    target: any,
    property: string,
    targetValue: number,
    duration: number
  ): void {
    const startValue = target[property];
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1.0);

      // Easing function (ease-in-out)
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      target[property] = startValue + (targetValue - startValue) * eased;

      if (progress < 1.0) {
        requestAnimationFrame(animate);
      }
    };

    animate();
  }

  private removeEffect(effectId: string): void {
    this.activeEffects.delete(effectId);
  }

  private generateId(): string {
    return `effect_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

---

## Drunk Vision System

### Severity Levels

#### 1. Light Drunk (Tipsy) 🍺

**Visual Effects**:
- Slight camera sway (±2° beta oscillation, sine wave)
- Minimal blur (5% screen blur)
- Slowed camera response (sensitivity * 0.8)

**Gameplay Impact**:
- Minor distraction
- Still playable, just annoying

**Stats**:
- Duration: 8 seconds
- Cost: 25 Chaos Points
- Cooldown: 45 seconds

---

#### 2. Medium Drunk (Hammered) 🍻🍻

**Visual Effects**:
- Moderate camera wobble (±8° alpha/beta oscillation)
- Medium blur (20% screen blur + chromatic aberration)
- Double vision (ghost overlay offset 10px)
- Random hiccup jolts (sudden small shakes)

**Gameplay Impact**:
- Difficult to aim clicks
- Reading dice values harder
- Inverted controls 30% of time (random)

**Stats**:
- Duration: 12 seconds
- Cost: 50 Chaos Points
- Cooldown: 60 seconds

---

#### 3. Blackout Drunk (Wasted) 🍻🍻🍻💀

**Visual Effects**:
- Extreme camera spin (360° random rotations)
- Heavy blur (40% screen blur + vignette tunnel vision)
- Screen fades to black every 3 seconds (1s blackout)
- Random zoom in/out
- Double vision with large offset (30px)
- Film grain + noise overlay

**Gameplay Impact**:
- Nearly impossible to play effectively
- Controls completely inverted
- Can't see dice clearly during blackouts
- May trigger panic mistakes

**Stats**:
- Duration: 15 seconds
- Cost: 100 Chaos Points
- Cooldown: 120 seconds

**Special Rule**: Victim earns "Hangover Recovery" buff after effect ends:
- Immune to drunk attacks for 30 seconds
- Gain 25 CP (revenge resource)

---

### Technical Implementation

```typescript
// src/chaos/effects/DrunkVision.ts

export class DrunkVisionEffect {
  private scene: GameScene;
  private cameraEffects: CameraEffectsService;
  private postProcessing: PostProcessingPipeline;

  applyDrunkEffect(severity: 'light' | 'medium' | 'blackout', duration: number): void {
    switch (severity) {
      case 'light':
        this.applyTipsy(duration);
        break;
      case 'medium':
        this.applyHammered(duration);
        break;
      case 'blackout':
        this.applyWasted(duration);
        break;
    }
  }

  private applyTipsy(duration: number): void {
    // Sine wave camera sway
    const swayFrequency = 0.5; // Hz
    const swayAmplitude = 0.02; // radians

    const startTime = Date.now();
    const swayInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed >= duration / 1000) {
        clearInterval(swayInterval);
        return;
      }

      const sway = Math.sin(elapsed * swayFrequency * Math.PI * 2) * swayAmplitude;
      this.scene.camera.beta += sway;
    }, 16);

    // Light blur
    this.postProcessing.enableBlur(0.1);
    setTimeout(() => this.postProcessing.disableBlur(), duration);
  }

  private applyHammered(duration: number): void {
    // Multi-layered effects
    this.cameraEffects.shake(0.3, duration);
    this.postProcessing.enableBlur(0.3);
    this.postProcessing.enableChromaticAberration(0.002);
    this.postProcessing.enableDoubleVision(10);

    // Random control inversion
    this.enableRandomControlInversion(0.3, duration);

    setTimeout(() => {
      this.postProcessing.disableBlur();
      this.postProcessing.disableChromaticAberration();
      this.postProcessing.disableDoubleVision();
    }, duration);
  }

  private applyWasted(duration: number): void {
    // EVERYTHING
    this.cameraEffects.shake(0.8, duration);
    this.cameraEffects.spin(2, duration);
    this.postProcessing.enableBlur(0.6);
    this.postProcessing.enableVignette(0.8);
    this.postProcessing.enableDoubleVision(30);
    this.postProcessing.enableFilmGrain(0.4);

    // Periodic blackouts
    const blackoutInterval = 3000;
    const blackoutDuration = 1000;
    let elapsed = 0;

    const blackoutTimer = setInterval(() => {
      elapsed += blackoutInterval;
      if (elapsed >= duration) {
        clearInterval(blackoutTimer);
        return;
      }

      this.postProcessing.fadeToBlack(blackoutDuration);
    }, blackoutInterval);

    // Fully inverted controls
    this.enableControlInversion(duration);

    // Cleanup
    setTimeout(() => {
      this.postProcessing.disableAll();
      this.disableControlInversion();
    }, duration);
  }

  private enableRandomControlInversion(probability: number, duration: number): void {
    // Every input has 'probability' chance to be inverted
    // Implementation would hook into input controller
  }

  private enableControlInversion(duration: number): void {
    // All inputs inverted (up=down, left=right, etc.)
  }

  private disableControlInversion(): void {
    // Restore normal controls
  }
}
```

---

## Upgrade System

### Progression Tree Structure

Each camera attack ability has 5 levels:
- **Level 1**: Base ability (unlocked by default or cheap)
- **Level 2-3**: Enhanced versions (earned through XP or currency)
- **Level 4**: Power spike (requires achievement or premium)
- **Level 5**: Ultimate (expensive, game-changing)

### Upgrade Example: Screen Shake

```typescript
// src/chaos/upgrades/screenShakeUpgrades.ts

export const SCREEN_SHAKE_UPGRADES: UpgradeTree = {
  abilityId: 'screen_shake',
  name: 'Screen Shake',
  icon: '🌀',

  levels: [
    {
      level: 1,
      name: 'Basic Shake',
      description: 'Shake opponent\'s camera',
      stats: {
        intensity: 0.3,
        duration: 2000, // ms
        cost: 20, // Chaos Points
        cooldown: 30000, // ms
      },
      unlockRequirement: 'default', // Always unlocked
    },
    {
      level: 2,
      name: 'Aftershock',
      description: 'Second shake 2s after first',
      stats: {
        intensity: 0.5,
        duration: 3000,
        cost: 20,
        cooldown: 30000,
        aftershock: true,
        aftershockDelay: 2000,
      },
      unlockRequirement: {
        type: 'xp',
        amount: 100,
      },
    },
    {
      level: 3,
      name: 'Earthquake',
      description: 'Affects 2 adjacent players (splash damage)',
      stats: {
        intensity: 0.8,
        duration: 4000,
        cost: 25,
        cooldown: 40000,
        splashTargets: 2,
      },
      unlockRequirement: {
        type: 'xp',
        amount: 300,
      },
    },
    {
      level: 4,
      name: 'Tremor',
      description: 'Adds camera tilt during shake',
      stats: {
        intensity: 1.0,
        duration: 5000,
        cost: 30,
        cooldown: 45000,
        tiltEnabled: true,
        maxTilt: 15, // degrees
      },
      unlockRequirement: {
        type: 'achievement',
        achievementId: 'shake_master',
        description: 'Use Screen Shake 100 times',
      },
    },
    {
      level: 5,
      name: 'Catastrophe (ULTIMATE)',
      description: 'Affects ALL opponents + spin effect',
      stats: {
        intensity: 1.5,
        duration: 6000,
        cost: 50,
        cooldown: 90000,
        targetAll: true,
        spinEffect: true,
        zoomEffect: true,
      },
      unlockRequirement: {
        type: 'currency',
        amount: 150, // Chaos Tokens
      },
    },
  ],
};
```

### Upgrade Acquisition Methods

#### 1. XP-Based Progression

```typescript
interface AbilityXP {
  abilityId: string;
  currentXP: number;
  currentLevel: number;
}

class UpgradeProgressionService {
  earnXP(abilityId: string, amount: number): void {
    // XP requirements per level:
    // Level 1→2: 100 XP
    // Level 2→3: 200 XP
    // Level 3→4: 400 XP
    // Level 4→5: 800 XP

    const xpThresholds = [0, 100, 300, 700, 1500];

    // Award XP and check for level up
  }

  onAbilityUsed(abilityId: string): void {
    this.earnXP(abilityId, 10); // Using ability = 10 XP
  }

  onSuccessfulDisruption(abilityId: string): void {
    this.earnXP(abilityId, 25); // Successful attack = 25 XP
  }
}
```

#### 2. Chaos Tokens (Currency)

```typescript
interface ChaosTokens {
  balance: number;
  earnedLifetime: number;
}

// Earn tokens
- Win game: +5 tokens
- Top 3 finish: +3 tokens
- Deal 500+ chaos damage in one game: +2 tokens
- First blood (first attack of game): +1 token

// Spend tokens
- Level 2 upgrade: 20 tokens
- Level 3 upgrade: 40 tokens
- Level 4 upgrade: 80 tokens
- Level 5 upgrade: 150 tokens
```

#### 3. Achievement Unlocks

```typescript
const CAMERA_ATTACK_ACHIEVEMENTS = [
  {
    id: 'shake_master',
    name: 'Shake Master',
    description: 'Use Screen Shake 100 times',
    reward: 'Unlock Screen Shake Level 4',
  },
  {
    id: 'bartender',
    name: 'Bartender',
    description: 'Successfully drunk-blind 50 players',
    reward: 'Unlock Drunk Vision Level 4',
  },
  {
    id: 'spin_doctor',
    name: 'Spin Doctor',
    description: 'Make opponents spin 500 full rotations (cumulative)',
    reward: 'Unlock Camera Spin Level 4',
  },
  {
    id: 'chaos_god',
    name: 'Chaos God',
    description: 'Deal 10,000 total chaos damage',
    reward: 'Unlock all Level 5 ultimates',
  },
];
```

#### 4. Premium IAP (Optional Shortcut)

```typescript
// In-App Purchase packages
const PREMIUM_UPGRADES = [
  {
    id: 'chaos_starter',
    price: 4.99,
    contents: [
      'All Level 2 upgrades unlocked',
      '100 Chaos Tokens',
      'Exclusive "Chaos Starter" badge',
    ],
  },
  {
    id: 'chaos_pro',
    price: 9.99,
    contents: [
      'All Level 3 upgrades unlocked',
      '300 Chaos Tokens',
      '2x XP gain permanently',
      'Exclusive "Pro Chaos" badge',
    ],
  },
  {
    id: 'ultimate_chaos',
    price: 19.99,
    contents: [
      'All Level 5 ultimate abilities',
      '1000 Chaos Tokens',
      'Unlimited camera attacks per game',
      'Exclusive legendary effect skins',
      'Priority matchmaking',
    ],
  },
];
```

---

## Attack Abilities

### Complete Ability Roster

#### Camera Shake Family

| Level | Name | Intensity | Duration | Cost | Cooldown | Special |
|-------|------|-----------|----------|------|----------|---------|
| 1 | Basic Shake | 0.3 | 2s | 20 CP | 30s | - |
| 2 | Aftershock | 0.5 | 3s | 20 CP | 30s | Second shake |
| 3 | Earthquake | 0.8 | 4s | 25 CP | 40s | Splash (2 targets) |
| 4 | Tremor | 1.0 | 5s | 30 CP | 45s | + Camera tilt |
| 5 | Catastrophe | 1.5 | 6s | 50 CP | 90s | All enemies + spin |

#### Drunk Vision Family

| Level | Name | Severity | Duration | Cost | Cooldown | Special |
|-------|------|----------|----------|------|----------|---------|
| 1 | Tipsy Shot | Light | 8s | 25 CP | 45s | Sway + blur |
| 2 | Double Shot | Medium | 10s | 40 CP | 60s | + Double vision |
| 3 | Long Island | Medium | 15s | 60 CP | 75s | + Random jolts |
| 4 | Keg Stand | Heavy | 18s | 80 CP | 90s | + Blackouts |
| 5 | Alcohol Poisoning | Blackout | 25s | 120 CP | 120s | + Control block (5s) |

#### Camera Spin Family

| Level | Name | Rotations | Duration | Cost | Cooldown | Special |
|-------|------|-----------|----------|------|----------|---------|
| 1 | Dizzy Spell | 1x | 3s | 30 CP | 40s | - |
| 2 | Vertigo | 2x | 4s | 45 CP | 50s | + Nausea filter |
| 3 | Washing Machine | 5x | 6s | 65 CP | 60s | Alternating direction |
| 4 | Blender Mode | 8x + zoom | 8s | 90 CP | 75s | Random zoom |
| 5 | Inception | 3-axis spin | 10s | 150 CP | 120s | Fish-eye lens |

---

### Fun Gag Effects (Bonus Abilities)

#### Party Mode Pack (Premium DLC - $4.99)

```typescript
const PARTY_MODE_EFFECTS = [
  {
    name: 'Strobe Light ⚡',
    description: 'Rapid light/dark flashing',
    duration: 5000,
    cost: 40,
    cooldown: 60000,
    warning: '⚠️ EPILEPSY WARNING',
  },
  {
    name: 'Mirror Maze 🪞',
    description: 'Split screen into 4 mirrored views',
    duration: 8000,
    cost: 60,
    cooldown: 75000,
  },
  {
    name: 'Kaleidoscope 🌈',
    description: 'Fractal psychedelic pattern',
    duration: 10000,
    cost: 80,
    cooldown: 90000,
  },
  {
    name: 'Tiny World 🌍',
    description: 'Extreme zoom out with fish-eye',
    duration: 6000,
    cost: 50,
    cooldown: 60000,
  },
];
```

#### Spell Pack (Premium DLC - $4.99)

```typescript
const SPELL_EFFECTS = [
  {
    name: 'Blind Spell ⚡',
    description: 'Screen fades to white, then slowly recovers',
    duration: 5000, // 2s blind + 3s recovery
    cost: 70,
    cooldown: 90000,
  },
  {
    name: 'Confusion Hex 🔮',
    description: 'Camera snaps to random angles every 0.5s',
    duration: 10000,
    cost: 55,
    cooldown: 75000,
  },
  {
    name: 'Gravity Well 🌀',
    description: 'Camera spirals inward toward center',
    duration: 8000,
    cost: 65,
    cooldown: 80000,
  },
  {
    name: 'Nightmare Vision 👻',
    description: 'Inverted colors + grain + static + whispers',
    duration: 12000,
    cost: 90,
    cooldown: 120000,
  },
];
```

---

## Technical Implementation

### File Structure

```
src/
├── services/
│   ├── cameraEffects.ts          (NEW - 400 lines)
│   │   ├── CameraEffectsService
│   │   ├── Effect management
│   │   └── Animation helpers
│   │
│   └── cameraService.ts           (EXISTING)
│
├── chaos/
│   ├── abilities.ts               (EXTEND - +200 lines)
│   │   └── Camera ability definitions
│   │
│   ├── cameraAbilities.ts         (NEW - 300 lines)
│   │   ├── Screen Shake abilities
│   │   ├── Drunk Vision abilities
│   │   ├── Camera Spin abilities
│   │   └── Gag effects
│   │
│   ├── upgradeSystem.ts           (NEW - 500 lines)
│   │   ├── UpgradeProgressionService
│   │   ├── XP tracking
│   │   ├── Token economy
│   │   ├── Achievement integration
│   │   └── Unlock validation
│   │
│   └── effects/
│       ├── ScreenEffects.ts       (NEW - 250 lines)
│       │   └── Shake, spin, tilt implementations
│       │
│       ├── PostProcessing.ts      (NEW - 400 lines)
│       │   ├── Blur pipeline
│       │   ├── Chromatic aberration
│       │   ├── Vignette
│       │   ├── Film grain
│       │   └── Double vision shader
│       │
│       └── DrunkVision.ts         (NEW - 300 lines)
│           ├── Tipsy mode
│           ├── Hammered mode
│           ├── Blackout mode
│           └── Control inversion
│
├── particles/                      (EXISTING)
│   ├── presets/
│   │   └── chaosEffects.ts         (EXISTING - EXTENDED)
│   │       ├── emitShakeAttack()
│   │       ├── emitDrunkAttack()
│   │       ├── emitSpinAttack()
│   │       ├── emitBlindSpell()
│   │       └── emitConfusionHex()
│   │
│   └── effects/
│       └── attackEffects.ts        (EXISTING)
│           ├── attack-shake-impact
│           ├── attack-drunk-aura
│           ├── attack-spin-impact
│           └── attack-blind-flash
│
├── ui/
│   ├── chaosUpgradeMenu.ts        (NEW - 600 lines)
│   │   ├── Upgrade tree UI
│   │   ├── XP progress bars
│   │   ├── Token balance display
│   │   ├── Unlock requirements
│   │   └── Purchase buttons
│   │
│   └── effectHUD.ts               (NEW - 200 lines)
│       ├── Active effect icons
│       ├── Duration timers
│       └── Effect stacking display
│
└── render/
    └── scene.ts                   (EXTEND - +150 lines)
        ├── Camera animation methods
        ├── Effect application hooks
        └── State restoration

```

### Key Dependencies

```json
// package.json additions
{
  "dependencies": {
    "@babylonjs/core": "^6.x.x",           // Already exists
    "@babylonjs/post-processes": "^6.x.x", // NEW - For blur/effects
    "@babylonjs/animations": "^6.x.x"      // Already included in core
  }
}
```

### Network Protocol Extension

```typescript
// WebSocket message for camera attack
interface CameraAttackMessage {
  type: 'chaos_attack';
  attackType: 'camera_effect';
  gameId: string;
  attackerId: string;
  targetId: string;
  abilityId: string;           // e.g., 'screen_shake'
  level: number;               // 1-5
  effectType: string;          // e.g., 'shake', 'drunk', 'spin'
  intensity: number;
  duration: number;            // milliseconds
  chaosPointsCost: number;
  timestamp: number;
  metadata?: {                 // Effect-specific data
    severity?: 'light' | 'medium' | 'blackout';
    splashTargets?: string[];  // For AOE abilities
    aftershock?: boolean;
  };
}

// Server validation
function validateCameraAttack(msg: CameraAttackMessage, player: Player): boolean {
  // Check player has enough CP
  if (player.chaosPoints < msg.chaosPointsCost) return false;

  // Check ability cooldown
  const ability = player.abilities.find(a => a.id === msg.abilityId);
  if (ability.onCooldown) return false;

  // Check upgrade level unlocked
  if (msg.level > ability.unlockedLevel) return false;

  // Validate target is in same game
  const target = getPlayer(msg.targetId);
  if (target.gameId !== msg.gameId) return false;

  return true;
}
```

---

## Balancing & Safeguards

### Anti-Frustration Mechanics

#### 1. Diminishing Returns

```typescript
class DiminishingReturns {
  private attackHistory: Map<string, Attack[]> = new Map();

  calculateDuration(
    baseWidemouth: number,
    attackerId: string,
    victimId: string,
    attackType: string
  ): number {
    const key = `${attackerId}_${victimId}_${attackType}`;
    const history = this.attackHistory.get(key) || [];

    // Filter to last 60 seconds
    const recentAttacks = history.filter(
      a => Date.now() - a.timestamp < 60000
    );

    // Apply diminishing returns
    const multiplier = Math.pow(0.5, recentAttacks.length);

    return baseDuration * multiplier;
  }
}

// Example:
// 1st attack: 10s duration (100%)
// 2nd attack: 5s duration (50%)
// 3rd attack: 2.5s duration (25%)
// 4th attack: 1.25s duration (12.5%)
```

#### 2. Immunity Periods

```typescript
class ImmunitySystem {
  private immunities: Map<string, Set<string>> = new Map();

  grantImmunity(playerId: string, attackType: string, duration: number): void {
    // After being attacked, player immune to SAME attack type
    const playerImmunities = this.immunities.get(playerId) || new Set();
    playerImmunities.add(attackType);
    this.immunities.set(playerId, playerImmunities);

    setTimeout(() => {
      playerImmunities.delete(attackType);
    }, duration);
  }

  isImmune(playerId: string, attackType: string): boolean {
    const playerImmunities = this.immunities.get(playerId);
    return playerImmunities ? playerImmunities.has(attackType) : false;
  }
}

// Example: Player hit by Screen Shake
// → Immune to Screen Shake for 10s
// → Can still be hit by Drunk Vision, Spin, etc.
```

#### 3. Rage Quit Protection

```typescript
class RageQuitProtection {
  private attackCounts: Map<string, number[]> = new Map();

  checkOverload(playerId: string): boolean {
    const timestamps = this.attackCounts.get(playerId) || [];

    // Filter to last 30 seconds
    const recentAttacks = timestamps.filter(
      t => Date.now() - t < 30000
    );

    // If more than 5 attacks in 30s, offer Safe Mode
    if (recentAttacks.length >= 5) {
      this.offerSafeMode(playerId);
      return true;
    }

    return false;
  }

  offerSafeMode(playerId: string): void {
    // Show modal: "You're being targeted heavily. Enable Safe Mode?"
    // Safe Mode = Visual effects reduced by 75% + text notifications only
  }
}
```

#### 4. Accessibility Options

```typescript
interface AccessibilitySettings {
  reduceCameraEffects: boolean;     // 50% intensity reduction
  disableDrunkVision: boolean;      // Replace with static overlay
  disableFlashing: boolean;         // Remove strobe/disco effects
  showTextNotifications: boolean;   // "You were hit by Screen Shake"
  epilepsyMode: boolean;            // Disable ALL flashing effects
}

class CameraEffectsService {
  applyAccessibilityFilter(effect: CameraEffect): CameraEffect {
    const settings = this.getAccessibilitySettings();

    if (settings.reduceCameraEffects) {
      effect.intensity *= 0.5;
      effect.duration *= 0.75;
    }

    if (settings.disableDrunkVision && effect.type === 'drunk') {
      // Replace with simple blur overlay (no movement)
      effect.type = 'blur';
      effect.intensity = 0.2;
    }

    if (settings.epilepsyMode) {
      // Block strobe, disco, flashbang
      const blockedEffects = ['strobe', 'disco', 'flashbang'];
      if (blockedEffects.includes(effect.type)) {
        return null; // Cancel effect
      }
    }

    return effect;
  }
}
```

---

## Monetization

### Revenue Streams

#### 1. Chaos Pass Subscription

```
Chaos Pass - $4.99/month or $29.99/year

Benefits:
- All Level 3 upgrades unlocked immediately
- 2x XP gain rate for all abilities
- Unlimited camera attacks per game (no 3-attack limit)
- Exclusive "Party Mode" effects
- Priority matchmaking (faster queue times)
- Monthly bonus: 50 Chaos Tokens

Monthly Revenue Projection (10% conversion):
- 10,000 active players × 10% × $4.99 = $4,990/month
- Annual: ~$60,000
```

#### 2. One-Time IAP Packs

```
Chaos Starter Pack - $4.99
- All Level 2 upgrades unlocked
- 100 Chaos Tokens
- Exclusive badge

Chaos Pro Pack - $9.99
- All Level 3 upgrades unlocked
- 300 Chaos Tokens
- 2x XP gain (permanent)
- Exclusive "Pro" badge

Ultimate Chaos - $19.99
- All Level 5 ultimate abilities
- 1000 Chaos Tokens
- Unlimited attacks
- Legendary effect skins
- Priority matchmaking

Revenue Projection (5% buy starter, 2% buy pro, 0.5% buy ultimate):
- Starter: 10,000 × 5% × $4.99 = $2,495
- Pro: 10,000 × 2% × $9.99 = $1,998
- Ultimate: 10,000 × 0.5% × $19.99 = $999
- Total: ~$5,500 one-time (first month)
```

#### 3. Premium DLC Packs

```
Party Mode Pack - $4.99
- Strobe Light, Mirror Maze, Kaleidoscope, Tiny World

Spell Pack - $4.99
- Blind Spell, Confusion Hex, Gravity Well, Nightmare Vision

Combo Pack (Both) - $7.99 (save $1.99)

Revenue Projection (3% buy DLC):
- 10,000 × 3% × $4.99 × 2 packs = $2,994
```

#### 4. Battle Pass (Seasonal)

```
Season Pass - $9.99 per season (3 months)

100 Tiers of Rewards:
- Tier 10: Drunk Vision Level 2
- Tier 25: 100 Chaos Tokens
- Tier 40: Screen Shake Level 3
- Tier 60: Exclusive "Toxic" skin
- Tier 75: 250 Chaos Tokens
- Tier 100: Random Level 5 ultimate unlock

Revenue Projection (15% buy pass):
- 10,000 × 15% × $9.99 = $14,985 per season
- 4 seasons/year = ~$60,000
```

### Total Annual Revenue Projection

```
Chaos Pass subscriptions:       $60,000
One-time IAP (recurring):        $33,000 (assuming 50% of year 1 each following year)
Premium DLC:                     $18,000
Battle Passes (4 seasons):       $60,000
─────────────────────────────────────
TOTAL:                          ~$171,000/year

(Based on 10,000 active players with conservative conversion rates)
```

### F2P Balance

**Free Players Can**:
- Unlock Level 1-3 upgrades through XP grinding
- Earn Chaos Tokens from gameplay (5 per win)
- Use 3 camera attacks per game
- Access all base abilities

**Free Players Cannot**:
- Access Level 4-5 upgrades without months of grinding
- Use unlimited attacks
- Access premium DLC effects
- Get 2x XP boost

**Key Balance**: Free players can compete, but premium unlocks make attacks more effective and less grindy. NOT pay-to-win, but pay-to-progress-faster.

---

## Development Roadmap

### Phase 1: Foundation (Weeks 1-2)
**Goal**: Camera Effects API + Basic shake/spin

**Tasks**:
- [x] Create `CameraEffectsService` class
- [x] Implement `shake()` method with intensity scaling
- [x] Implement `spin()` method with rotation animation
- [x] Extend `GameScene` with camera animation helpers
- [x] Add easing functions (ease-in/out via runtime animation helpers)
- [x] Create effect queue system (prevent conflicts)
- [x] Unit tests for effect timing and cleanup
- [x] Add attack message executor (`CameraAttackExecutor`) + mapping tests

**Deliverables**:
- Working Screen Shake Level 1
- Working Camera Spin Level 1
- Effect management system

---

### Phase 2: Drunk Vision (Weeks 3-4)
**Goal**: Multi-layered drunk effects with post-processing

**Tasks**:
- [x] Integrate BabylonJS post-process classes
- [x] Create `DrunkVisionPostProcessingPipeline` class
- [x] Implement blur effect (BlurPostProcess)
- [x] Implement vignette (tunnel vision)
- [x] Implement chromatic aberration (color split)
- [x] Create custom double vision shader
- [x] Integrate drunk severity profiles (tipsy/hammered/blackout) in `CameraEffectsService`
- [x] Add control inversion system
- [ ] Test on various hardware (performance check)

**Deliverables**:
- Working Drunk Vision Levels 1-3
- Post-processing pipeline
- Performance optimizations for mobile

---

### Phase 3: Upgrade System (Weeks 5-7)
**Goal**: Progression trees, XP tracking, token economy

**Tasks**:
- [x] Design upgrade database schema (client-side scaffold)
- [x] Create `UpgradeProgressionService`
- [x] Implement XP earning system
  - [x] Award XP on ability use
  - [x] Award XP on successful disruption
  - [x] Track XP per ability
- [x] Implement Chaos Token economy (client-side scaffold)
  - [x] Earn tokens from progression service API
  - [x] Spend tokens on upgrades
  - [ ] Store balance in player profile (backend pending)
- [x] Create upgrade definitions
  - [x] Screen Shake Levels 2-5
  - [x] Drunk Vision Levels 2-5
  - [x] Camera Spin Levels 2-5
- [x] Implement unlock validation
- [ ] Achievement integration
  - [ ] "Shake Master", "Bartender", etc.
  - [x] Link achievements to upgrade unlock checks (service hook)
- [x] Create `ChaosUpgradeMenu` UI (client-side scaffold)
  - [x] Upgrade tree visualization
  - [x] XP progress bars
  - [x] Unlock requirements display
  - [x] Purchase/unlock buttons
- [ ] Persistence (save upgrade progress to backend)

**Deliverables**:
- Full upgrade trees for 3 ability families (scaffold complete)
- XP/Token economy working (client-side scaffold complete)
- Upgrade menu UI complete
- Achievement system integrated

---

### Phase 4: Integration (Week 8)
**Goal**: Connect Camera Effects to Chaos Attack system

**Tasks**:
- [ ] Extend `ChaosAbilityExecutor` class
- [x] Map chaos abilities to camera effects
  - [x] `screen_shake` → `CameraEffectsService.shake()`
  - [x] `drunk_vision` → `CameraEffectsService.drunk()`
  - [x] `camera_spin` → `CameraEffectsService.spin()`
- [ ] Implement network protocol
  - [ ] `CameraAttackMessage` interface
  - [ ] Server-side validation
  - [ ] WebSocket broadcast to victim
- [x] Client-side attack rendering
  - [x] Receive attack message
  - [x] Apply effect locally
  - [x] Display effect HUD (active effects UI)
- [ ] Add attack feedback
  - [ ] Attacker sees "Hit!" notification
  - [ ] Victim sees effect name + duration
- [ ] Test multiplayer synchronization
- [ ] Implement diminishing returns
- [ ] Implement immunity system
- [ ] Add rage quit protection

**Deliverables**:
- Camera attacks working in multiplayer
- Network synchronization stable
- Anti-frustration systems active
- Effect HUD showing active camera effects

---

### Phase 5: Polish & Gag Effects (Weeks 9-10)
**Goal**: Fun bonus effects, balancing, final polish

**Tasks**:
- [ ] Implement Party Mode effects
  - [ ] Strobe Light (with epilepsy warning)
  - [ ] Mirror Maze
  - [ ] Kaleidoscope
  - [ ] Tiny World
- [ ] Implement Spell effects
  - [ ] Blind Spell
  - [ ] Confusion Hex
  - [ ] Gravity Well
  - [ ] Nightmare Vision
- [ ] Add accessibility options
  - [ ] Reduce camera effects (50% intensity)
  - [ ] Disable drunk vision
  - [ ] Epilepsy mode
  - [ ] Text-only notifications
- [ ] Balancing pass
  - [ ] Adjust cooldowns based on playtesting
  - [ ] Tweak intensity values
  - [ ] Test diminishing returns thresholds
- [ ] Performance optimization
  - [ ] Profile post-processing on low-end devices
  - [ ] Optimize effect stacking
  - [ ] Reduce memory usage
- [ ] Final QA
  - [ ] Cross-browser testing
  - [ ] Mobile device testing
  - [ ] Stress test with 8 players spamming attacks
- [ ] Documentation
  - [ ] Update CHAOS-GAMEPLAY-MECHANICS.md
  - [ ] Update CAMERA-SYSTEM.md
  - [ ] Create player guide ("How to unlock upgrades")

**Deliverables**:
- 8 gag effects complete
- Accessibility options working
- Performance optimized
- All documentation updated
- System ready for launch

---

### Timeline Summary

| Phase | Duration | Focus | Status |
|-------|----------|-------|--------|
| Phase 1 | Weeks 1-2 | Camera Effects API | ✅ Core Complete |
| Phase 2 | Weeks 3-4 | Drunk Vision | 🟡 In Progress |
| Phase 3 | Weeks 5-7 | Upgrade System | 🟡 Scaffolding In Progress |
| Phase 4 | Week 8 | Integration | 📋 Planned |
| Phase 5 | Weeks 9-10 | Polish & Gag Effects | 📋 Planned |

**Total Estimated Effort**: ~10 weeks (assuming 1 full-time developer)

---

## Success Metrics

### Engagement Metrics
- **Attack Usage Rate**: % of players who use camera attacks
  - Target: >60% of players use at least one camera attack per game
- **Upgrade Progression**: Avg. ability level reached
  - Target: 50% of active players reach Level 3+ on at least one ability
- **Session Length**: Time spent in games with camera attacks vs. without
  - Target: +15% longer sessions with camera attacks enabled

### Retention Metrics
- **Return Rate**: Do attacked players return next day?
  - Target: <5% drop in retention after being attacked heavily
- **Quit Rate**: % of players who leave mid-game after attack
  - Target: <10% rage quit rate (with anti-frustration safeguards)

### Monetization Metrics
- **Chaos Pass Conversion**: % of players who subscribe
  - Target: 10% conversion rate
- **IAP Purchase Rate**: % of players who buy any IAP
  - Target: 15% make at least one purchase
- **ARPU** (Average Revenue Per User): Total revenue / active players
  - Target: $5-10 ARPU per month

### Balance Metrics
- **Attack Distribution**: Are some attacks dominant?
  - Target: No single attack >40% usage share
- **Upgrade Distribution**: Are certain upgrades always chosen?
  - Target: Level 5 ultimates <5% usage (should be rare/special)
- **Fair Play**: Win rate correlation with premium upgrades
  - Target: Premium users win <55% (not pay-to-win)

### Toxicity Metrics
- **Player Reports**: Camera attack-related reports
  - Target: <2% of games result in toxicity reports
- **Safe Mode Usage**: % of players enabling Safe Mode
  - Target: <5% of players feel need for Safe Mode
- **Block Rate**: % of players blocking opponents after camera attacks
  - Target: <8% block rate

---

## Conclusion

The Camera Attack Integration system transforms BISCUITS' camera from a passive viewer into an **active psychological weapon**. By combining:

1. ✅ **Immersive disruption**: Camera effects feel more impactful than overlays
2. ✅ **Deep progression**: 5-level upgrade trees encourage repeated play
3. ✅ **Creative chaos**: Drunk vision, spin effects, and gag spells provide variety
4. ✅ **Balanced monetization**: Premium tiers without pay-to-win
5. ✅ **Player protection**: Anti-frustration safeguards prevent toxicity

We create a system that delivers on the "psychosocial torture" vision while keeping it **fun for both attacker and victim**. Players will experience film-quality disruption mechanics that test not just their dice rolling skills, but their **ability to keep composure under pressure**.

**The ultimate question**: Can you score under a shaking screen, blurred vision, and constant psychological warfare? That's what makes BISCUITS more than just a dice game—it's a **competitive chaos simulator**! 🎲😵💀🍺

---

**Document Status**: Active implementation in progress (Phases 1-3 core client systems + Phase 4 client execution mapping in place).

**Next Steps**: Wire backend profile/API storage (settings/progression/logs), start service-worker offloading, and continue multiplayer backend/session implementation.

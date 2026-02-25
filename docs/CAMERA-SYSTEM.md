# BISCUITS Camera System & Machinima Tools

**Document Version**: 1.0
**Last Updated**: 2026-02-24
**Status**: Phase 1 (Basic Functionality) - In Development

---

## Table of Contents

1. [Overview](#overview)
2. [Current Implementation (Phase 1)](#current-implementation-phase-1)
3. [Future Features (Phases 2-4)](#future-features-phases-2-4)
4. [Technical Architecture](#technical-architecture)
5. [Unlock Progression System](#unlock-progression-system)
6. [Monetization Strategy](#monetization-strategy)
7. [Use Cases](#use-cases)
8. [Implementation Roadmap](#implementation-roadmap)

---

## Overview

The BISCUITS Camera System provides players with powerful tools to control, save, and replay camera positions for gameplay recording, competition streaming, and machinima creation. The system uses a **progressive unlock model** where basic features are free, advanced features are earned through gameplay, and professional tools require premium access.

### Design Philosophy

- **Accessible**: Basic camera controls available to all players
- **Rewarding**: Enhanced features unlock through achievements and progression
- **Professional**: Premium machinima tools for content creators and streamers
- **Social**: Easy sharing of camera positions and cinematic replays

### Feature Tiers

| Tier | Features | Access Method |
|------|----------|---------------|
| **Free** | 3 saved positions, preset views, basic controls | Always available |
| **Unlocked** | 10 saved positions, smooth transitions, replay | Complete 10 games or achievement |
| **Flying Mode** | Free camera, WASD controls, no-clip | Achievement, items, or unlock |
| **Pro/Premium** | Machinima tools, camera paths, unlimited saves | Premium purchase or high-level unlock |

---

## Current Implementation (Phase 1)

### Basic Features (v1.0)

#### 1. Camera Position Management

**CameraService** (`src/services/cameraService.ts`)
- Save current camera position (alpha, beta, radius, target)
- Load saved positions with instant transition
- Name and manage up to 3 favorite positions (Free tier)
- Persist to localStorage
- Import/export position JSON for sharing

**Camera Position Format**:
```typescript
interface CameraPosition {
  id: string;              // UUID
  name: string;            // User-defined name
  alpha: number;           // Horizontal rotation (radians)
  beta: number;            // Vertical rotation (radians)
  radius: number;          // Distance from target
  target: {                // Camera focus point
    x: number;
    y: number;
    z: number;
  };
  createdAt: number;       // Timestamp
  isFavorite: boolean;     // Quick access flag
}
```

#### 2. Preset Camera Views

Existing presets (via `GameScene.setCameraView()`):
- **Default**: Standard gameplay view (α=-π/2, β=π/3, r=38)
- **Top**: Bird's eye view (α=-π/2, β=0.1, r=20)
- **Side**: Side-on perspective (α=0, β=π/2.5, r=25)
- **Front**: Front-facing view (α=-π/2, β=π/2.5, r=25)
- **Debug**: Wide development view (α=-π/2, β=π/4, r=35)

Keyboard shortcuts (1-5 keys) for instant preset access.

#### 3. Camera Controls UI

**New Panel** (accessible via camera icon button in HUD):
- **Saved Positions Dropdown**: Quick load from favorites
- **Save Current Button**: Capture current camera state
- **Reset to Default Button**: Return to standard gameplay view
- **Position Info**: Display current α/β/radius values
- **🔒 Teaser Section**: "Advanced Features Coming Soon"
  - Flying Mode (locked icon)
  - Machinima Tools (locked icon)
  - Smooth Transitions (locked icon)

#### 4. Camera Settings Integration

Extended `SettingsService`:
```typescript
interface CameraSettings {
  sensitivity: number;           // 0.5-2.0 (existing)
  smoothTransitions: boolean;    // Animate position changes
  transitionDuration: number;    // Seconds (0.5-3.0)
  savedPositionSlots: number;    // 3 (Free), 10 (Unlocked), ∞ (Premium)
  flyingModeEnabled: boolean;    // Unlock flag
  machinimaModeEnabled: boolean; // Premium flag
}
```

---

## Future Features (Phases 2-4)

### Phase 2: Enhanced Camera System (Medium Complexity)

**Unlock Requirement**: Complete 10 games OR earn "Cinematographer" achievement

#### Features:
1. **10 Saved Position Slots** (up from 3)
2. **Smooth Camera Transitions**
   - Bezier curve interpolation between positions
   - Configurable duration (0.5s - 5s)
   - Easing functions (ease-in, ease-out, elastic, etc.)
3. **Per-Player Seat Positions** (Multiplayer)
   - Save camera angle for each of 8 player seats
   - Auto-switch to seat camera when turn starts
4. **Replay Timeline System**
   - Scrub through saved camera positions
   - Export position sequence as JSON
5. **Community Sharing**
   - Export camera preset packs
   - Import community-created positions
   - Rate and favorite shared presets

#### Technical Implementation:
```typescript
class CameraInterpolator {
  interpolate(from: CameraPosition, to: CameraPosition, duration: number, easing: EasingFunction): void;
  stop(): void;
  onComplete(callback: () => void): void;
}

class CameraReplaySystem {
  recordSession(): void;
  playback(speed: number): void;
  scrubToTime(seconds: number): void;
  exportTimeline(): CameraTimeline;
}
```

---

### Phase 3: Flying Camera Mode (High Complexity)

**Unlock Requirement**: Achievement "Sky Walker" OR item unlock OR premium purchase

#### Features:
1. **Free Camera Control** (switch from ArcRotateCamera → UniversalCamera)
2. **WASD Movement**
   - W/S: Forward/Backward
   - A/D: Strafe Left/Right
   - Q/E: Up/Down (vertical movement)
   - Shift: Sprint mode (3x speed)
   - Ctrl: Slow mode (0.3x speed)
3. **Mouse Look**
   - Full 360° rotation
   - Configurable sensitivity
   - Invert Y-axis option
4. **No-Clip Mode**
   - Pass through table geometry
   - Explore "behind the scenes"
5. **FOV Adjustment** (60° - 120°)
6. **Gamepad Support** (optional)
   - Left stick: Movement
   - Right stick: Look
   - Triggers: Up/Down

#### UI Additions:
- **Flying Mode Toggle** (F key or UI button)
- **Speed Indicator** HUD element
- **Coordinate Display** (X/Y/Z position)
- **Return to Standard Mode** button

#### Technical Implementation:
```typescript
class FlyingCameraController {
  private camera: UniversalCamera;
  private moveSpeed: number = 0.5;
  private lookSensitivity: number = 0.002;
  private noClipEnabled: boolean = true;

  enable(): void;              // Switch to flying mode
  disable(): void;             // Return to ArcRotate
  setSpeed(multiplier: number): void;
  updateMovement(delta: number): void;
  handleInput(keys: KeyState, mouse: MouseState): void;
}
```

---

### Phase 4: Machinima & Cinematic Tools (Very High Complexity)

**Unlock Requirement**: Premium Feature (In-App Purchase) OR Level 50+ player

#### Features Overview:

##### 4.1 Camera Path System
- **Keyframe Editor**: Set camera positions along timeline
- **Bezier Curve Paths**: Smooth motion between keyframes
- **Path Visualization**: Show camera path in 3D space
- **Timing Control**: Adjust speed at each keyframe

##### 4.2 Timeline Editor
- **Visual Timeline UI**: Scrubbing, playback controls
- **Multiple Camera Tracks**: Switch between angles
- **Markers & Labels**: Annotate important moments
- **Export to Video**: Render camera path with gameplay replay

##### 4.3 Automated Camera Movements
- **Orbit**: Rotate around target at constant radius
- **Dolly**: Move toward/away from target
- **Crane**: Vertical movement while maintaining framing
- **Shake**: Camera shake effects (intensity, frequency)
- **Follow**: Track moving object (dice, player)
- **Dutch Angle**: Tilted framing for dramatic effect

##### 4.4 Cinematic Effects
- **Depth of Field**: Focus blur with adjustable f-stop
- **Vignette**: Edge darkening effect
- **Letterbox**: Cinematic aspect ratios (2.39:1, 16:9, etc.)
- **Color Grading**: LUT-based color correction
- **Motion Blur**: Simulated camera motion blur
- **Film Grain**: Vintage film texture overlay

##### 4.5 Live Director Mode (Streaming)
- **Multi-Camera Setup**: 8+ preset angles
- **Instant Switching**: Hotkeys for camera cuts
- **Picture-in-Picture**: Show multiple angles simultaneously
- **Lower Thirds**: Custom text overlays for player names
- **Replay System**: Instant replay with slow-motion
- **OBS Integration**: Virtual camera output

##### 4.6 Recording & Export
- **Gameplay Replay Recording**: Capture full game state
- **Camera Path Export**: JSON format for sharing
- **Video Rendering**: Export to MP4/WebM (client-side)
- **GIF Creation**: Short highlights for social media
- **Screenshot Gallery**: Capture high-res stills
- **Sequence Export**: Frame-by-frame image sequence

#### Technical Implementation:

```typescript
// Camera Path System
interface CameraKeyframe {
  time: number;              // Seconds from start
  position: CameraPosition;  // Camera state
  easing: EasingFunction;    // Transition curve
  fov?: number;              // Field of view override
  effects?: CinematicEffects;
}

class CameraPathSystem {
  private keyframes: CameraKeyframe[] = [];

  addKeyframe(time: number, position: CameraPosition): void;
  removeKeyframe(index: number): void;
  interpolatePath(resolution: number): CameraPosition[];
  playPath(onUpdate: (position: CameraPosition) => void): void;
  exportPath(): string; // JSON
  importPath(json: string): void;
}

// Cinematic Effects
interface CinematicEffects {
  depthOfField?: {
    focalLength: number;
    fStop: number;
    focusDistance: number;
  };
  vignette?: {
    intensity: number;
    size: number;
  };
  colorGrade?: {
    lutTexture: string;
    intensity: number;
  };
  letterbox?: {
    aspectRatio: number; // 2.39, 1.85, 16/9, etc.
  };
}

class CinematicEffectsPipeline {
  applyEffects(effects: CinematicEffects): void;
  removeEffects(): void;
  updateEffect(effect: keyof CinematicEffects, params: any): void;
}

// Director Mode
class DirectorController {
  private cameras: Map<string, CameraPosition> = new Map();

  registerCamera(name: string, position: CameraPosition): void;
  switchToCamera(name: string, transition?: number): void;
  enablePiP(cameras: string[]): void; // Picture-in-Picture
  addLowerThird(text: string, duration: number): void;
  instantReplay(duration: number, speed: number): void;
}
```

---

## Technical Architecture

### Service Layer

```typescript
// src/services/cameraService.ts
export class CameraService {
  private positions: CameraPosition[] = [];
  private currentTier: 'free' | 'unlocked' | 'premium' = 'free';
  private maxSlots: number = 3;

  // Core functionality
  savePosition(name: string, position: CameraPosition): string;
  loadPosition(id: string): CameraPosition | null;
  deletePosition(id: string): void;
  listPositions(): CameraPosition[];

  // Import/Export
  exportPosition(id: string): string; // JSON
  importPosition(json: string): string; // Returns new ID
  exportAll(): string;
  importAll(json: string): void;

  // Tier management
  setTier(tier: 'free' | 'unlocked' | 'premium'): void;
  canSaveMore(): boolean;
  getRemainingSlots(): number;

  // Observers
  onPositionAdded(callback: (position: CameraPosition) => void): () => void;
  onPositionDeleted(callback: (id: string) => void): () => void;
}
```

### Scene Integration

```typescript
// src/render/scene.ts
export class GameScene {
  private cameraService: CameraService;

  // Enhanced camera control
  setCameraPosition(position: CameraPosition, animate: boolean = false): void;
  getCurrentCameraPosition(): CameraPosition;
  saveCameraPosition(name: string): string;
  loadCameraPosition(id: string): void;

  // Flying mode (Phase 3)
  enableFlyingMode(): void;
  disableFlyingMode(): void;
  isFlyingMode(): boolean;
}
```

### UI Components

```typescript
// src/ui/cameraControls.ts
export class CameraControlsPanel {
  private container: HTMLElement;
  private cameraService: CameraService;

  show(): void;
  hide(): void;
  toggle(): void;
  refreshPositions(): void;

  // Event handlers
  private onSaveClick(): void;
  private onLoadClick(id: string): void;
  private onDeleteClick(id: string): void;
  private onExportClick(): void;
  private onImportClick(file: File): void;
}
```

---

## Unlock Progression System

### Free Tier (Default)
- ✅ 3 saved camera positions
- ✅ 5 preset views (default, top, side, front, debug)
- ✅ Manual camera control (drag to rotate)
- ✅ Import/export camera positions

### Unlocked Tier
**Unlock via**:
- Complete 10 games (tracked in game state)
- OR earn "Cinematographer" achievement
- OR reach Player Level 5

**Features**:
- 🔓 10 saved camera positions
- 🔓 Smooth camera transitions (animated)
- 🔓 Camera replay timeline
- 🔓 Per-player seat positions

### Flying Mode
**Unlock via**:
- Earn "Sky Walker" achievement (1000 dice rolls)
- OR find "Flying Camera" item (rare drop)
- OR purchase "Camera Pro" pack ($4.99)

**Features**:
- 🔓 Free-flying camera (WASD controls)
- 🔓 No-clip mode
- 🔓 FOV adjustment (60-120°)
- 🔓 Speed controls (slow/normal/fast)

### Premium/Pro Tier
**Unlock via**:
- Purchase "Machinima Pro" pack ($14.99 one-time OR $2.99/month)
- OR reach Player Level 50
- OR earn "Master Cinematographer" achievement

**Features**:
- 🔓 Unlimited saved positions
- 🔓 Camera path keyframe editor
- 🔓 Automated camera movements
- 🔓 Cinematic effects (DoF, vignette, color grading)
- 🔓 Director mode (multi-camera live switching)
- 🔓 Video export and rendering
- 🔓 Screenshot gallery
- 🔓 OBS virtual camera integration

### Achievement List

| Achievement | Requirement | Reward |
|-------------|-------------|--------|
| **First Shot** | Save your first camera position | Tutorial completion |
| **Cinematographer** | Save 10 different positions | Unlock Enhanced Camera (Tier 2) |
| **Sky Walker** | Roll dice 1000 times | Unlock Flying Mode |
| **Director's Cut** | Create 5 camera paths | Unlock Director Mode |
| **Master Cinematographer** | Complete all camera challenges | Unlock Pro Tier (permanent) |

---

## Monetization Strategy

### Free-to-Play Funnel
1. **Hook**: Players experience basic camera controls
2. **Engagement**: Unlock enhanced features through gameplay (10 games)
3. **Conversion**: Premium features showcase value (flying mode, machinima tools)

### Pricing Tiers

#### Camera Pro Pack - $4.99 (One-time)
- Flying camera mode
- 20 saved positions
- FOV adjustment
- No-clip mode

#### Machinima Pro Pack - $14.99 (One-time) OR $2.99/month
- Everything in Camera Pro
- Unlimited saved positions
- Camera path editor
- Cinematic effects
- Director mode
- Video export

### Alternative Unlock Paths
Players can unlock premium features **without payment** via:
- **Grinding**: Complete achievements (1000+ dice rolls, etc.)
- **Items**: Rare item drops enable features temporarily
- **Level Up**: Reach high player levels (50+) for permanent unlocks

### Bundle Opportunities
- **Streamer Bundle**: Machinima Pro + Premium Themes + VIP Badge ($24.99)
- **Creator Bundle**: Machinima Pro + Custom Table Textures + Logo Upload ($29.99)

---

## Use Cases

### 1. Casual Player
**Scenario**: Player wants a better view of dice during crucial rolls

**Features Used**:
- Save favorite overhead angle
- Quick switch between saved positions
- Reset to default when done

**Tier**: Free

---

### 2. Competitive Player (Tournament)
**Scenario**: Player competing in tournament wants consistent camera angles

**Features Used**:
- Save optimal tournament view
- Export camera position
- Share with other competitors (standardized view)
- Per-seat camera positions for multiplayer

**Tier**: Unlocked

---

### 3. Content Creator (YouTube/TikTok)
**Scenario**: YouTuber creating dice game tutorial videos

**Features Used**:
- Flying camera for dynamic shots
- Record camera path around table
- Add cinematic effects (depth of field)
- Export as MP4 video
- Create GIFs for social media

**Tier**: Premium

---

### 4. Esports Broadcaster
**Scenario**: Casting live 8-player tournament with professional production

**Features Used**:
- Director mode with 8+ camera angles
- Live camera switching (hotkeys)
- Picture-in-picture for replay
- Lower thirds with player names
- OBS integration for streaming
- Instant replay with slow-motion

**Tier**: Premium

---

### 5. Machinima Creator
**Scenario**: Artist creating short film using BISCUITS game engine

**Features Used**:
- Complex camera paths with keyframes
- Automated camera movements (orbit, dolly)
- Cinematic effects (letterbox, color grading)
- Frame-by-frame rendering
- Scene composition tools

**Tier**: Premium

---

## Implementation Roadmap

### Phase 1: Core Service (Current - Week 1)
**Status**: 🟡 In Development

- [x] Create `CAMERA-SYSTEM.md` documentation
- [ ] Implement `CameraService` class
- [ ] Add camera controls UI panel
- [ ] Integrate with `GameScene`
- [ ] Add localStorage persistence
- [ ] Update settings service
- [ ] Add teaser UI for locked features
- [ ] Update TODO.md and FUTURE-FEATURES.md

**Deliverables**:
- Working camera save/load (3 slots)
- Basic UI panel
- Import/export JSON
- Documentation complete

---

### Phase 2: Enhanced System (Post-TODO - Week 4-6)
**Status**: 📋 Planned

**Prerequisites**:
- Phase 1 complete
- Achievement system implemented
- Player progression system active

**Tasks**:
- Implement camera interpolation system
- Add smooth transitions with easing
- Create replay timeline UI
- Implement per-player seat positions
- Add community sharing features
- Achievement unlock integration

**Deliverables**:
- 10 saved positions for unlocked players
- Smooth animated transitions
- Replay system working

---

### Phase 3: Flying Mode (Post-Multiplayer - Week 12+)
**Status**: 🔒 Future

**Prerequisites**:
- Phase 2 complete
- Multiplayer system live
- Achievement system mature

**Tasks**:
- Implement UniversalCamera controller
- Add WASD + mouse look input
- Create no-clip collision system
- Build flying mode UI/HUD
- Add FOV adjustment
- Gamepad support (optional)
- Achievement/unlock integration

**Deliverables**:
- Full free-flying camera mode
- WASD controls working
- Smooth transitions between modes

---

### Phase 4: Machinima Pro (Premium Feature - Week 20+)
**Status**: 🔒 Premium

**Prerequisites**:
- Phase 3 complete
- Monetization infrastructure ready
- Payment processing integrated

**Tasks**:
- Keyframe editor UI
- Camera path interpolation system
- Automated movement patterns
- Cinematic effects pipeline (DoF, vignette, etc.)
- Director mode multi-camera system
- Video rendering system (client-side)
- OBS virtual camera plugin
- Comprehensive testing with creators

**Deliverables**:
- Full machinima toolkit
- Professional-grade camera tools
- Video export working
- Creator documentation

---

## Technical Specifications

### BabylonJS Camera Types

#### ArcRotateCamera (Current)
```typescript
// Orbits around target point
camera = new ArcRotateCamera(
  "camera",
  alpha,    // Horizontal rotation (radians)
  beta,     // Vertical rotation (radians)
  radius,   // Distance from target
  target,   // Vector3 focus point
  scene
);
```

**Pros**: Intuitive for gameplay, constrained view
**Cons**: Cannot freely position or move through geometry

#### UniversalCamera (Flying Mode)
```typescript
// First-person free movement
camera = new UniversalCamera(
  "flyingCamera",
  position,  // Vector3 world position
  scene
);

// WASD controls
camera.keysUp = [87];    // W
camera.keysDown = [83];  // S
camera.keysLeft = [65];  // A
camera.keysRight = [68]; // D
```

**Pros**: Full freedom, FPS-style controls
**Cons**: Requires careful UI design, can be disorienting

### Camera Transitions

#### Lerp (Linear Interpolation)
```typescript
// Simple linear transition
const t = (currentTime - startTime) / duration;
camera.alpha = lerp(startAlpha, endAlpha, t);
camera.beta = lerp(startBeta, endBeta, t);
camera.radius = lerp(startRadius, endRadius, t);
```

#### Bezier Curves (Smooth Paths)
```typescript
// Cubic Bezier interpolation
function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}
```

### Performance Considerations

- **Camera transitions**: Use `requestAnimationFrame` for smooth 60fps
- **Flying mode**: Limit update rate on low-end devices
- **Replay system**: Store delta-compressed position data
- **Video export**: Offload rendering to Web Worker when possible

---

## Future Expansion Ideas

### VR/AR Camera Modes
- Stereoscopic camera rendering
- VR headset support (WebXR)
- AR table overlay (mobile camera)

### AI Director
- Automatic camera angle selection
- Machine learning for "cinematic" shots
- Auto-highlight detection

### Collaborative Camera Control
- Multiplayer: Players vote on camera angle
- Co-op director mode (2 directors)
- Spectator camera suggestion system

### Advanced Effects
- Particle overlays (confetti, smoke)
- Dynamic lighting control
- Green screen / chroma key for compositing

---

## References

### BabylonJS Documentation
- [ArcRotateCamera](https://doc.babylonjs.com/features/featuresDeepDive/cameras/camera_introduction#arc-rotate-camera)
- [UniversalCamera](https://doc.babylonjs.com/features/featuresDeepDive/cameras/camera_introduction#universal-camera)
- [Animation System](https://doc.babylonjs.com/features/featuresDeepDive/animation/animation_introduction)

### Inspiration
- **OBS Studio**: Multi-camera director mode
- **Tony Hawk's Pro Skater**: Replay camera system
- **Unreal Engine**: Sequencer timeline editor
- **Adobe Premiere**: Keyframe animation

---

## Conclusion

The BISCUITS Camera System provides a **progressive unlock experience** that rewards engagement while offering professional-grade tools for content creators. By starting with accessible basic features and gradually introducing advanced capabilities, we create a compelling monetization funnel that respects both casual players and professional streamers.

**Key Success Metrics**:
- % of players who save their first position (engagement)
- Avg. positions saved per user (feature utilization)
- Unlock rate for Enhanced Camera (progression effectiveness)
- Premium conversion rate (monetization)
- Content created and shared (virality)

---

**Document Status**: Phase 1 specification complete, ready for implementation.

# BISCUITS - TODO List

**Project Status**: Active Development • v0.1.0-alpha • Last Updated: 2026-02-25 (Alpha Release Ready - Music Muted)

This document tracks all pending work, active bugs, technical debt, and backlog items for the BISCUITS project.

---

## 🔴 High Priority

### Camera System & Machinima Tools (Phase 1 COMPLETE, Phase 2 PARTIAL) 📷
- **Status**: ✅ Phase 1 COMPLETE (2026-02-24) • 🟡 Phase 2 PARTIAL (2026-02-25 foundation work)
- **Complexity**: Medium (Phase 1), Very High (Full System)
- **Description**: Camera position management system with progressive unlocks and machinima tools
- **Documentation**:
  - Complete specification in `docs/CAMERA-SYSTEM.md` (800+ lines)
  - **NEW**: Camera Attack Integration in `docs/CAMERA-ATTACKS-INTEGRATION.md` (1000+ lines)
- **Phase 1 Implementation**:
  - ✅ CameraService with save/load/import/export (3 slots free tier)
  - ✅ Camera Controls Panel UI with teaser for locked features
  - ✅ Integration with GameScene (save/load positions)
  - ✅ Keyboard shortcut (C key) and button access
  - ✅ localStorage persistence
  - ✅ Tier-based access control (free/unlocked/premium)
- **Phase 2 Foundation Implemented**:
  - ✅ Smooth camera transition plumbing in `GameScene.setCameraPosition(..., animate)` (settings-gated)
  - ✅ Babylon animation/easing integration for alpha, beta, radius, and target interpolation
  - ✅ `SettingsService` camera schema defaults (`smoothTransitions`, `transitionDuration`, unlock flags)
  - ✅ `CameraService` testability improvements (injectable storage, state validation, explicit `off()` listener removal)
  - ✅ Camera service test suite scaffold (`src/services/cameraService.test.ts`)
  - ✅ Non-browser/runtime-safe storage fallback for `cameraService` singleton
- **Future Phases**:
  - 🟡 Phase 2: Enhanced Camera (in progress - smooth transitions core done; 10 slots/replay/per-seat still pending)
  - 🔒 Phase 3: Flying Mode (WASD controls, no-clip - Post-Multiplayer)
  - 🔒 Phase 4: Machinima Pro (paths, director mode, export - Premium Feature)
- **Files Created**:
  - `src/services/cameraService.ts` - Core service (500+ lines)
  - `src/ui/cameraControls.ts` - UI panel (430 lines)
  - `docs/CAMERA-SYSTEM.md` - Complete specification (800+ lines)
  - CSS styles added to `src/styles.css` (400+ lines)
- **Files Modified**:
  - `src/render/scene.ts` - Added settings-gated smooth transition animation support
  - `src/services/settings.ts` - Added/merged camera settings defaults
  - `src/services/cameraService.ts` - Added storage injection, validation, and listener unsubscribe helper
  - `src/main.ts` - Integrated camera panel
  - `src/controllers/InputController.ts` - Added C key and button handler
  - `index.html` - Added camera positions button
  - `package.json` - Added `test:camera` script
- **New Files in 2026-02-25 Update**:
  - `src/services/cameraService.test.ts` - Camera service unit-style test script
- **Result**: Players can save up to 3 camera positions now, and smooth camera transitions are partially implemented at engine/settings level
- **Immediate Next Work**:
  - 🔲 Expose camera smooth-transition controls in UI with proper unlock gating
  - 🔲 Complete remaining Phase 2 features (10 slots, replay timeline, per-player seat positions)

### Active Bugs

#### Color Material Transparency Issue
- **Status**: ✅ RESOLVED with custom shader material
- **Solution**: Implemented custom ShaderMaterial with GLSL shaders
- **Files Created**:
  - `src/render/colorMaterial.ts` - Custom material factory and shader definitions
  - `src/render/shaders.ts` - Shader registration with BabylonJS
- **How it Works**:
  - Custom vertex shader handles standard transformations
  - Custom fragment shader blends base color with texture based on alpha:
    - `alpha = 0` (transparent) → shows base die color
    - `alpha = 1` (opaque) → shows texture RGB (pips/numbers)
  - Includes proper lighting (Lambertian diffuse + Blinn-Phong specular)
  - Supports normal maps, specular maps, and all standard features
- **Result**: All 3 color material themes now work perfectly!
  - ✅ `default` - Solid colored dice with pip overlays
  - ✅ `smooth-pip` - Smooth dice with raised pip textures
  - ✅ `gemstone` - Translucent gem-like dice
- **Total Working Themes**: 8/8 (all themes functional)

#### Smooth-Pip d6 Texture Mapping
- **Status**: ✅ RESOLVED with per-die texture overrides
- **Root Cause**: d6 mesh UV coordinates only use 45% × 30% of texture space (U: 0.006-0.456, V: 0.002-0.304)
- **Solution**: Implemented per-die texture override system
- **Implementation**:
  - Added `perDieOverrides` field to theme.config.json for per-die texture scale/offset
  - d6 now uses scale 2.22×3.31 with offset -0.01×-0.01 (calculated from UV analysis)
  - Updated `DiceRenderer.createDie()` to clone materials and apply per-die overrides
  - Works with both StandardMaterial and ShaderMaterial (via texture cache)
- **Files Modified**:
  - `public/assets/themes/smooth-pip/theme.config.json` - Added perDieOverrides.d6
  - `src/render/dice.ts` - Implemented per-die texture override logic in createDie()
- **Result**: d6 pips now display correctly with proper UV scaling!

---

## 🟡 Medium Priority

### Visual Settings & Dice Visibility Enhancement (COMPLETE) 🎨
- **Status**: ✅ Phase 1 COMPLETE (2026-02-25)
- **Complexity**: Medium
- **Description**: User-configurable table contrast settings for improved dice readability
- **Documentation**: Complete specification in `docs/VISUAL-SETTINGS.md` (500+ lines)
- **Phase 1 Implementation** (Table Contrast System):
  - ✅ Added VisualSettings interface with tableContrast property
  - ✅ Four contrast levels: low (brighter), normal, high (darker), maximum (darkest)
  - ✅ Dramatic diffuse color changes (0.7x to 1.2x multipliers)
  - ✅ Real-time material updates without scene reload
  - ✅ User notification feedback on setting changes
  - ✅ localStorage persistence with backwards compatibility
  - ✅ Enhanced dice materials (ambient + emissive colors)
  - ✅ Brightened dice color palette (~30% increase)
  - ✅ Added dedicated dice spotlights for improved visibility
  - ✅ Enhanced shadow properties (2048 resolution, sharper edges)
- **Files Created**:
  - `docs/VISUAL-SETTINGS.md` - Complete documentation with architecture
- **Files Modified**:
  - `src/services/settings.ts` - Added VisualSettings interface and updateVisual()
  - `src/render/scene.ts` - Added updateTableContrast() with diffuse color control
  - `src/ui/settings.ts` - Added Visual Settings section with notification feedback
  - `src/main.ts` - Apply contrast on startup and real-time onChange updates
  - `src/render/dice.ts` - Enhanced dice materials and brightened color palette
- **Future Work** (TODO):
  - 🔲 Fine-tune diffuse multiplier range if too extreme (consider 0.85-1.15)
  - 🔲 Add additional visual settings (dice brightness, lighting intensity, shadow strength)
  - 🔲 Implement color blind mode presets
  - 🔲 User testing and feedback collection on contrast effectiveness
  - 🔲 Consider ambient color adjustments for softer contrast changes
- **Result**: Users can now dramatically adjust table brightness with instant visual feedback!

### Particle System (Phase 1 & 2 - COMPLETE) ✨
- **Status**: ✅ Phases 1 & 2 COMPLETE (2026-02-24)
- **Complexity**: High
- **Description**: Centralized, event-driven particle system integrated with gameplay
- **Documentation**:
  - Complete specification in `docs/PARTICLE-SYSTEM.md` (2000+ lines)
  - Integration docs updated in `docs/CAMERA-ATTACKS-INTEGRATION.md`
- **Phase 1 Implementation** (Core System):
  - ✅ ParticleService with effect registry and pooling
  - ✅ Event-driven architecture with custom events
  - ✅ Quality settings (low/medium/high/ultra) with auto-detection
  - ✅ Network synchronization hooks for multiplayer
  - ✅ Integration with Camera, Player, and Chaos systems
  - ✅ Particle effect definitions (burst, trail, ambient, attack)
  - ✅ Preset helpers for game events, player actions, and chaos attacks
  - ✅ Refactored existing scene.ts particle usage
- **Phase 2 Implementation** (Gameplay Integration):
  - ✅ Dice score particles - gold burst when dice land in score area
  - ✅ Dice roll landing particles - white burst when dice hit table
  - ✅ Perfect roll celebration - confetti burst (already working)
  - ✅ Game completion celebration - confetti burst (already working)
- **Phase 2.5 Implementation** (Intensity Controls):
  - ✅ Added `particleIntensity` setting ("off" | "minimal" | "normal" | "enthusiastic")
  - ✅ Intensity multipliers in ParticleService (0%, 30%, 60%, 100%)
  - ✅ Reduced baseline particle scales: roll 0.25 (was 0.4), score 0.6 (was 1.0)
  - ✅ Reduced celebration scales: perfect 1.2 (was 2.0), complete 1.0 (was 1.6)
  - ✅ Adaptive burst counts: minimal=0, normal=2-3, enthusiastic=4
  - ✅ Default "normal" intensity = 60% of previous particle amount
- **Files Created**:
  - `src/services/particleService.ts` - Core service (800+ lines)
  - `src/particles/effects/burstEffects.ts` - Burst particle definitions
  - `src/particles/effects/trailEffects.ts` - Trail particle definitions
  - `src/particles/effects/ambientEffects.ts` - Ambient particle definitions
  - `src/particles/effects/attackEffects.ts` - Attack particle definitions
  - `src/particles/presets/gameEffects.ts` - Game event helpers
  - `src/particles/presets/playerEffects.ts` - Player action helpers
  - `src/particles/presets/chaosEffects.ts` - Chaos attack helpers
  - `docs/PARTICLE-SYSTEM.md` - Complete documentation with intensity section
- **Files Modified**:
  - `src/main.ts` - Initialize ParticleService, register effects, apply intensity
  - `src/render/scene.ts` - Refactored particles, added intensity-aware celebrations
  - `src/render/dice.ts` - Added particles with reduced baseline scales
  - `src/services/settings.ts` - Added particleIntensity to DisplaySettings
  - `src/services/particleService.ts` - Added intensity system with multipliers
  - `docs/CAMERA-ATTACKS-INTEGRATION.md` - Added particle integration details
- **Future Phases**:
  - 🔒 Phase 3: Advanced effects (custom shaders, animated sprites, mesh particles)
  - 🔒 Phase 4: Particle editor for custom effects
  - 🔒 Phase 5: Settings UI dropdown for particle intensity control
- **Result**: Balanced, configurable particle system with 60% less visual noise by default! 🎉

### Recently Completed (Session 2026-02-24)

#### Code Refactoring - Controllers Pattern
- **Status**: ✅ COMPLETE
- **Objective**: Extract main.ts into focused controllers to reduce complexity
- **Results**:
  - Reduced main.ts from **954 lines to 570 lines** (40% reduction)
  - Extracted 3 new controllers totaling ~600 lines
  - Improved separation of concerns and testability
- **New Files Created**:
  - `src/controllers/InputController.ts` (~326 lines)
    - Handles all user input: buttons, keyboard, mobile menu
    - Uses callback interface pattern for loose coupling
  - `src/controllers/GameFlowController.ts` (~130 lines)
    - Manages game lifecycle: initialization, new games, mode switching
    - Static utility methods (stateless design)
  - `src/controllers/GameOverController.ts` (~143 lines)
    - Handles end-game flow: score display, ranking, seed sharing
    - Instance-based for DOM element management
  - `src/utils/urlUtils.ts` (~24 lines)
    - URL parsing and seed generation utilities
- **Files Modified**:
  - `src/main.ts` - Refactored to use controllers, implements GameCallbacks interface
  - `docs/ARCHITECTURE.md` - Added Controllers Layer section
  - `README.md` - Updated architecture diagram
- **Design Patterns Applied**:
  - Callback Interface Pattern (InputController)
  - Static Utility Pattern (GameFlowController)
  - Instance-based Controller (GameOverController)
- **Build Status**: ✅ All TypeScript compilation passes
- **Documentation**: ✅ Architecture docs updated

#### Build System & GitHub Pages Deployment
- **Status**: ✅ COMPLETE
- **Implemented**:
  - **Angular-style Build Process**:
    - Added `vite-plugin-static-copy` for build-time file copying
    - Created `copy:assets` script that runs before all dev/build commands
    - Source files stay in `src/content/`, generated copies in `public/` (dev) and `dist/` (build)
    - Added `public/rules.md` to `.gitignore` (generated file)
  - **GitHub Pages Path Fixes**:
    - Changed all asset paths from absolute (`/`) to use `import.meta.env.BASE_URL`
    - Works correctly for both root (`/`) and subdirectory (`/virtual-bitches/`) deployment
    - Fixed paths in: geometryLoader, rules UI, themeManager, dice renderer, splash dice
  - **TypeScript Configuration**:
    - Added `"types": ["vite/client"]` for `import.meta.env` typings
  - **Documentation**:
    - Created `src/assets/README.md` explaining asset management system
- **Files Modified**:
  - `vite.config.ts` - Added static copy plugin
  - `package.json` - Added `copy:assets` script to all build commands
  - `tsconfig.json` - Added Vite client types
  - `.gitignore` - Added generated files
  - `src/render/geometryLoader.ts` - BASE_URL for smoothDice.json
  - `src/ui/rules.ts` - BASE_URL for rules.md
  - `src/services/themeManager.ts` - BASE_URL for theme paths
  - `src/render/dice.ts` - BASE_URL for material loading
  - `src/render/splashDice.ts` - BASE_URL for splash materials
- **Files Created**:
  - `src/assets/README.md` - Asset management documentation
- **Result**: Clean build system with no file duplication, works on GitHub Pages subdirectories

#### UI Cleanup - Keyboard Shortcuts
- **Status**: ✅ COMPLETE
- **Changes**:
  - Removed "New Game" and "Debug View" buttons from UI
  - Added keyboard shortcuts: **N** for New Game, **D** for Debug View
  - Changed deselect shortcut from **D** to **X** to avoid conflict
  - Updated all documentation and tutorials with new shortcuts
- **Result**: Cleaner UI with keyboard-first control scheme
- **Files Modified**:
  - `index.html` - Removed button elements
  - `src/main.ts` - Added keyboard handlers, removed button listeners
  - `src/ui/tutorial.ts` - Updated controls documentation

#### Mobile/Touch UX Enhancements
- **Status**: ✅ COMPLETE
- **Implemented Features**:
  - **Touch Target Sizes**: All interactive elements now meet 44px minimum (Apple/Android guidelines)
    - Settings/Leaderboard buttons: 36-40px → 44px
    - Camera controls: 32-38px → 44px
    - Dice touch targets: 42-48px → 46-50px
    - Increased spacing between elements (5-8px gaps)
  - **Touch Visual Feedback**: Added `:active` states with scale transforms
    - Buttons, dice, camera controls all have touch feedback
    - `-webkit-tap-highlight-color: transparent` to prevent default highlight
  - **Passive Event Listeners**: Touch events marked as `passive: true` for better scroll performance
  - **iOS Safe Area Support**:
    - Added `viewport-fit=cover` to meta tag
    - Implemented `env(safe-area-inset-*)` for all edges
    - All UI elements respect iPhone notches and home indicators
  - **Haptic Feedback**:
    - Created `src/services/haptics.ts` with Vibration API
    - Patterns: light, medium, heavy, selection, success, warning, error
    - Integrated throughout game (rolls, selections, scores, buttons)
    - Settings toggle (auto-hides on unsupported devices)
  - **PWA Support**:
    - Created `public/manifest.json` with app metadata
    - Created `public/sw.js` with service worker for offline caching
    - Implemented `src/services/pwa.ts` for install prompts and updates
    - Install banner with 7-day dismissal cooldown
    - App shortcuts (New Game, Leaderboard)
    - Offline play capability
- **Files Created**:
  - `src/services/haptics.ts`
  - `src/services/pwa.ts`
  - `public/manifest.json`
  - `public/sw.js`
- **Files Modified**:
  - `src/styles.css` (touch targets, active states, PWA UI, safe area support)
  - `src/main.ts` (haptic integration)
  - `src/ui/settings.ts` (haptics toggle)
  - `src/services/settings.ts` (haptics setting)
  - `index.html` (PWA meta tags, manifest link)
- **Result**: Native-like mobile experience with haptics, offline support, and touch-optimized UI

### In-Progress Work

#### Theme System Polish
- **Status**: 8/8 themes working perfectly ✅
- **Working Standard Material Themes**: diceOfRolling, wooden, smooth, rust, blueGreenMetal
- **Working Color Material Themes**: default, smooth-pip, gemstone
- **Tasks**:
  - [x] Added baseline UV coordinates to all themes
  - [x] Implemented custom shader for color materials
  - [x] All 8 themes now functional and enabled
  - [ ] Fine-tune UV coordinates using DebugView (Alt+D)
  - [ ] Test all themes across different dice types (d4, d6, d8, d10, d12, d20)
  - [ ] Verify lighting/shadow consistency across themes

#### Documentation Completion
- **Status**: 4/4 complete ✅
- **Completed**:
  - ✅ ARCHITECTURE.md (comprehensive system overview with logging system docs)
  - ✅ TODO.md (this file - active task tracking)
  - ✅ FUTURE-FEATURES.md (roadmap with AI prompts)
  - ✅ THEME-SYSTEM.md (complete theme development guide)

---

## 🟢 Low Priority / Backlog

### Future Features (See FUTURE-FEATURES.md)

#### Camera Attack Integration System 💥📷
- **Status**: 🟡 PHASE 2 IN PROGRESS (2026-02-25)
- **Complexity**: Very High
- **Description**: Weaponized camera manipulation for multiplayer psychological warfare
- **Documentation**: Complete specification in `docs/CAMERA-ATTACKS-INTEGRATION.md` (1000+ lines)
- **Implemented Foundation**:
  - ✅ `CameraEffectsService` runtime (`src/services/cameraEffects.ts`) with shake/spin/zoom/drunk effects
  - ✅ Drunk vision post-processing pipeline (`src/chaos/effects/postProcessingPipeline.ts`) with blur/double-vision/vignette/blackout hooks
  - ✅ Effect conflict queue/stacking policy (per-type caps, queued drain, drunk-child reserved stacking lane)
  - ✅ Effect lifecycle controls (active list, stop, clear) + timing/cleanup handling
  - ✅ Particle integration hooks for shake/spin/drunk effects
  - ✅ `CameraAttackExecutor` (`src/chaos/cameraAttackExecutor.ts`) for typed message → camera effect mapping
  - ✅ Main-thread event bridge (`chaos:cameraAttack`) wired in `src/main.ts`
  - ✅ Multiplayer WebSocket bridge (`src/multiplayer/networkService.ts`) for camera attack + particle delivery
  - ✅ Unit-style tests for attack mapping (`src/chaos/cameraAttackExecutor.test.ts`)
  - ✅ Unit-style tests for network bridge routing (`src/multiplayer/networkService.test.ts`)
  - ✅ Unit-style tests for camera effect queue/post-processing behavior (`src/services/cameraEffects.test.ts`)
- **Key Features**:
  - Camera Effects API (shake, spin, zoom, tilt, drunk vision)
  - Drunk Vision system (3 severity levels: Tipsy, Hammered, Blackout)
  - 5-level upgrade trees for each attack family
  - XP progression + Chaos Token economy
  - Premium "Party Mode" & "Spell Pack" DLC effects
  - Anti-frustration safeguards (diminishing returns, immunity, rage quit protection)
- **Attack Families**:
  - Screen Shake (5 levels: Basic → Aftershock → Earthquake → Tremor → Catastrophe)
  - Drunk Vision (5 levels: Tipsy → Double Shot → Long Island → Keg Stand → Alcohol Poisoning)
  - Camera Spin (5 levels: Dizzy Spell → Vertigo → Washing Machine → Blender → Inception)
- **Dependencies**:
  - Requires Camera System (Phase 1 ✅ complete)
  - Requires Chaos Gameplay Mechanics infrastructure
  - Requires Multiplayer system for networked attacks
  - Requires WebSocket server for cross-client attack delivery
  - BabylonJS Post-Processing pipeline (implemented client-side; tuning pending)
- **Implementation Timeline**: ~10 weeks (5 phases)
- **Monetization**: Chaos Pass ($4.99/mo), IAP packs, Battle Pass
- **Implementation Priority**: Next up is upgrade progression + active effect HUD + control inversion/accessibility safeguards

#### Chaos Gameplay Mechanics System
- **Status**: DOCUMENTED (not yet implemented)
- **Complexity**: Very High
- **Description**: Multiplayer "psychosocial warfare" system with player attacks, distractions, and time pressure
- **Documentation**: Complete specification in `docs/CHAOS-GAMEPLAY-MECHANICS.md` (700+ lines)
- **Key Features**:
  - 50+ attack abilities (Visual, Audio, UI, Dice, Time manipulation)
  - Time Attack game mode variants (7 different formats)
  - Insult & Taunt System (300+ taunts, AI generation, emotes)
  - Chaos Points economy with ability progression
  - 7 game modes including Team Chaos and Survival
  - Comprehensive anti-toxicity systems
- **Dependencies**:
  - Requires 8-player multiplayer mode complete
  - Backend WebSocket infrastructure
  - User authentication and profiles
  - Time attack game mode implementation
- **Implementation Priority**: Post-multiplayer (Phase 4+)
- **AI Prompt**:
  ```
  Implement Chaos Gameplay Mechanics per docs/CHAOS-GAMEPLAY-MECHANICS.md. Start with ability system (src/chaos/abilities.ts), Chaos Points economy (src/chaos/economy.ts), and ability bar UI (src/chaos/ui/AbilityBar.ts). Follow the technical implementation section for file structure and type definitions. Ensure all anti-toxicity safeguards are implemented.
  ```

### Performance Optimizations

#### Reduce Bundle Size
- **Current**: ~2.5MB production bundle
- **BabylonJS Core**: ~1.8MB (largest dependency)
- **Target**: <2MB total
- **Options**:
  - Tree-shake unused BabylonJS modules
  - Consider ES6 module imports instead of full core
  - Lazy-load theme assets
  - Optimize texture sizes (current: 1024x1024, consider 512x512)
- **AI Prompt**:
  ```
  Optimize the BISCUITS bundle size currently at ~2.5MB. Analyze vite.config.ts and package.json to reduce BabylonJS core imports, implement tree-shaking, and consider lazy-loading theme assets. Target <2MB production bundle.
  ```

#### Improve Frame Rate
- **Current**: 60fps on desktop, ~40fps on mobile
- **Target**: Stable 60fps across all devices
- **Options**:
  - Reduce shadow map resolution
  - Implement LOD for dice meshes
  - Optimize physics calculations
  - Consider worker thread for engine updates
- **AI Prompt**:
  ```
  Profile and optimize BISCUITS rendering performance. Focus on mobile devices where frame rate drops to ~40fps. Consider shadow optimization, LOD systems, and physics calculation improvements in src/render/diceRenderer.ts.
  ```

### Music Player System 🎵
- **Status**: ⚠️ MUTED BY DEFAULT (functionality preserved, disabled until proper system developed)
- **Complexity**: Medium
- **Description**: Develop full music player system with track selection and controls
- **Current State** (2026-02-25):
  - ✅ Music generation system complete (procedural ambient drone)
  - ✅ Audio API functional (playMusic/stopMusic)
  - ✅ Settings UI present (volume slider + enable checkbox)
  - ⚠️ Music DISABLED by default (musicEnabled: false, musicVolume: 0)
  - All functionality preserved for future development
- **Future Features**:
  - [ ] Multiple music tracks
  - [ ] Track selection UI
  - [ ] Play/pause controls in HUD
  - [ ] Playlist management
  - [ ] Volume fade in/out
  - [ ] Context-aware music (menu vs gameplay vs game over)
  - [ ] User-uploaded music support
  - [ ] Spotify/streaming integration (premium feature?)
- **Files Involved**:
  - `src/services/audio.ts` - Music generation and playback
  - `src/services/settings.ts` - Music settings (line 57-59: defaults set to 0/false)
  - `src/ui/settings.ts` - Music controls UI
- **Implementation Priority**: Post-alpha (after core gameplay polish)
- **AI Prompt**:
  ```
  Implement a music player system for BISCUITS. Create multiple ambient music tracks, add UI controls for track selection and playback, and integrate with the existing audio service in src/services/audio.ts. Consider context-aware music that changes based on game state.
  ```

### Additional Themes

#### Import Community Themes
- **Source**: dice-box library has 20+ themes
- **Status**: 8 themes ported, 12+ available
- **Priority Themes**:
  - Gemstone (needs color material fix first)
  - Metal
  - Glass
  - Neon
- **Tasks**:
  - [ ] Port remaining dice-box themes
  - [ ] Create theme preview gallery
  - [ ] Add theme search/filter UI
- **AI Prompt**:
  ```
  Port additional themes from the dice-box library to BISCUITS. Focus on metal, glass, and neon themes. Each theme requires copying assets to src/assets/textures/{theme-name}/ and creating a theme.config.json following the existing pattern.
  ```

#### Create Original Themes
- **Ideas**:
  - Candy (colorful translucent)
  - Paper (origami style)
  - Ice (frosted transparent)
  - Circuit Board (tech aesthetic)
  - Galaxy (nebula textures)
- **AI Prompt**:
  ```
  Design and implement an original "Galaxy" theme for BISCUITS dice. Create or source nebula/star textures, configure theme.config.json with appropriate material properties, and test across all die types. Follow the theme system architecture in docs/THEME-SYSTEM.md.
  ```

### Mobile Experience

#### Touch Controls
- **Status**: Basic tap/swipe working
- **Improvements Needed**:
  - [ ] Add haptic feedback for rolls/selections
  - [ ] Improve touch target sizes (min 44x44px)
  - [ ] Add multi-touch gesture support
  - [ ] Better visual feedback for touch events
- **AI Prompt**:
  ```
  Enhance mobile touch controls for BISCUITS. Add haptic feedback, increase touch target sizes for die selection, and improve visual feedback. Update src/render/components/DiceRenderer.ts pointer event handlers.
  ```

#### Responsive UI
- **Status**: Layouts adapt but need polish
- **Issues**:
  - Score panel too small on mobile
  - Theme selector cramped
  - Tutorial text hard to read
- **AI Prompt**:
  ```
  Improve responsive design for BISCUITS mobile layout. Focus on score panel visibility, theme selector usability, and tutorial text readability on small screens. Update CSS in src/render/components/*.ts files.
  ```

### Code Quality

#### Test Coverage
- **Current**: 0% (no tests)
- **Target**: >80% coverage
- **Priority**:
  - [ ] Unit tests for engine layer (pure functions)
  - [ ] Integration tests for state management
  - [ ] Visual regression tests for themes
- **AI Prompt**:
  ```
  Set up testing infrastructure for BISCUITS. Create unit tests for src/engine/*.ts pure functions, integration tests for state management, and consider Playwright for visual regression testing of themes.
  ```

#### TypeScript Strictness
- **Current**: `strict: true` in tsconfig.json ✅
- **Improvements**:
  - [ ] Add JSDoc comments to all public APIs
  - [ ] Eliminate remaining `any` types
  - [ ] Add runtime type validation for config files
- **AI Prompt**:
  ```
  Improve TypeScript type safety in BISCUITS. Add JSDoc comments to all public APIs, eliminate any remaining 'any' types, and implement runtime validation for theme.config.json files using Zod or similar.
  ```

#### Refactoring Opportunities

**DiceRenderer.ts**
- **Issue**: 500+ lines, multiple responsibilities
- **Solution**: Extract theme application, animation, and face detection into separate modules
- **Priority**: Low (works well, just large)

**themeManager.ts**
- **Issue**: Texture loading logic could be more robust
- **Solution**: Add error handling, retry logic, and loading state management
- **Priority**: Medium (affects UX when themes fail to load)

**state.ts**
- **Issue**: Action log grows unbounded
- **Solution**: Implement circular buffer or periodic trimming
- **Priority**: Low (only matters for very long sessions)

---

## 📋 Technical Debt

### Cleanup Tasks

- [x] Remove unused imports across codebase
- [ ] Consolidate duplicate color utility functions
- [ ] Standardize error handling patterns
- [x] Add consistent logging with log levels
- [x] Document all magic numbers with constants

### Build System

- [x] Add development/production environment configs
- [ ] Set up automated deployment pipeline (GitHub Actions)
- [x] Add bundle size monitoring
- [x] Configure source maps for production debugging
- [ ] Add pre-commit hooks (lint, format, type-check)

### Dependencies

- [ ] Audit and update all dependencies to latest stable
- [x] Remove unused dependencies (audit package.json)
- [ ] Add dependency vulnerability scanning
- [ ] Document version constraints and upgrade paths

---

## ✅ Recently Completed

### Octagon Table Texture & Asset Loading Infrastructure (2026-02-24 Late Evening)
- ✅ **Custom octagon table texture implementation**
  - Applied user-provided 1024×1024 square felt texture to octagon play area
  - Perfect radial UV mapping (1:1 scale, no distortion or stretching)
  - Automatic procedural fallback if texture fails to load
  - Error handling with console logging for debugging
- ✅ **Splash screen gradient background**
  - Added atmospheric gradient matching game scene (blue-gray to dark)
  - Visual consistency across splash → loading → game screens
- ✅ **Loading screen component system**
  - Created `src/ui/loadingScreen.ts` with progress tracking
  - Task-based and manual progress modes
  - Animated dice spinner with gradient background
  - Ready for integration with asset loading
- ✅ **Service worker & asset loading strategy documentation**
  - Created `docs/SERVICE-WORKER-STRATEGY.md` (450+ lines)
  - Comprehensive PWA optimization roadmap
  - PRPL pattern implementation guide
  - Multiplayer preparation with Web Workers strategy
  - Phase-based implementation timeline
- ✅ **Texture optimization documentation**
  - Created `docs/TEXTURE-OPTIMIZATION.md`
  - WebP conversion guidelines (2.2 MB → 300 KB)
  - Power-of-2 dimension recommendations
  - KTX2/Basis Universal for future scaling
  - Tool recommendations and comparison tables
- **Files Created**:
  - `src/ui/loadingScreen.ts` - Progress tracking loading screen
  - `docs/SERVICE-WORKER-STRATEGY.md` - Comprehensive asset loading strategy
  - `docs/TEXTURE-OPTIMIZATION.md` - Texture optimization guide
  - `public/assets/textures/table-felt.png` - Custom 1024×1024 table texture
- **Files Modified**:
  - `src/ui/splash.ts` - Added gradient background
  - `src/render/scene.ts` - Custom texture loading with fallback
  - `src/styles.css` - Loading screen styles
- **Result**: Production-ready custom branding on game table, infrastructure for future loading optimization

### Fallback Theme System & Debug Enhancements (2026-02-24 Evening)
- ✅ **Implemented fallback theme system**
  - Themes can specify `fallbackTheme` and `useFallbackFor` in config
  - Per-die material selection based on fallback rules
  - smooth-pip theme: d6 uses pip texture, all others fallback to smooth with numbers
- ✅ **Material cache for fallback themes**
  - DiceRenderer and SplashDiceRenderer cache both primary and fallback materials
  - Proper material selection based on die type at render time
- ✅ **Unified splash screen rendering**
  - Splash screen now uses same theme system as main game
  - Applies texture scale/offset from theme configs
  - Respects fallback theme configuration
  - Matches main game rendering logic exactly
- ✅ **Enhanced debug view**
  - Added material variant switcher (light/dark) for color materials
  - Material variant control auto-hides for standard material themes
  - Per-die texture updates (only updates current die's material)
  - Shows theme info including fallback status
  - Enhanced console logging for texture update debugging
- ✅ **WeakMap texture cache**
  - Changed from string-based lookup to instance-based WeakMap
  - More reliable texture reference tracking for ShaderMaterials
  - Proper cleanup and garbage collection
- ✅ **Theme configuration updates**
  - smooth-pip: Configured for d6 only (fallback to smooth for d4/d8/d10/d12/d20)
  - Added texture scale 2.0×2.0 for smooth-pip d6
  - Documented theme-specific requirements

### Custom Shader & Theme System (2026-02-24 Morning)
- ✅ **Implemented custom shader material for color themes** (MAJOR FEATURE)
  - Created `src/render/colorMaterial.ts` with custom GLSL shaders
  - Vertex shader: Standard transformations with UV/normal passthrough
  - Fragment shader: Blends solid base color with RGBA texture alpha
  - Proper Lambertian diffuse + Blinn-Phong specular lighting
  - Supports normal maps and specular maps
- ✅ **Fixed color material transparency issue**
  - All 3 color material themes now render correctly
  - Solid die bodies with transparent texture overlays working
  - `default`, `smooth-pip`, `gemstone` themes fully functional
- ✅ **Re-enabled all 8 themes** (8/8 working)
  - 5 standard material themes (diceOfRolling, wooden, blueGreenMetal, rust, smooth)
  - 3 color material themes (default, smooth-pip, gemstone)
  - Theme system now complete and production-ready

### Code Quality & Documentation (2026-02-24)
- ✅ Implemented centralized logging system with environment-aware levels
- ✅ Migrated 79+ console statements to logger utility across 10 files
- ✅ Extracted magic numbers to named constants in dice.ts
- ✅ Added comprehensive JSDoc documentation to engine and game layers
- ✅ Removed unused @babylonjs/materials package
- ✅ Cleaned up backup files (.bak)
- ✅ Enhanced themeManager with retry logic and validation
- ✅ Configured production source maps (hidden) for debugging
- ✅ Completed all project documentation (4/4 docs complete)
  - ARCHITECTURE.md updated with logging system
  - TODO.md updated with all completed work
  - FUTURE-FEATURES.md (comprehensive roadmap)
  - THEME-SYSTEM.md (complete theme dev guide)
- ✅ Added baseline UV coordinates to all color material themes
  - default, gemstone themes now have textureScale/textureOffset properties
  - Consistent 1.9/1.9 scale and 0.05/0.05 offset across color themes
  - Ready for fine-tuning once transparency bug is fixed
- ✅ Disabled problematic color material themes temporarily
  - default, smooth-pip, gemstone themes disabled in themeManager.ts
  - 5 working standard material themes remain available
  - Documented workaround and custom shader solution needed
  - Users have stable, working themes while custom shader is implemented

### Build/Deployment Fixes (2026-02-23)
- ✅ Fixed theme asset paths (changed `/src/assets/textures/` → `/assets/themes/`)
- ✅ Resolved TypeScript build errors (null checks, texture types)
- ✅ Fixed game over crash (added null check for share link element)
- ✅ Copied all 8 theme folders to public/assets/themes/
- ✅ Updated Vite config for proper asset handling

### Theme System Implementation (2026-02-22)
- ✅ Implemented theme hot-swapping with ThemeManager
- ✅ Added 8 working themes (5 standard, 3 color material)
- ✅ Created DebugView for texture adjustment (Alt+D)
- ✅ Added observer pattern for theme change notifications
- ✅ Implemented theme persistence to localStorage

### Documentation (2026-02-24)
- ✅ Created comprehensive ARCHITECTURE.md
- ✅ Created TODO.md (this file)

---

## 🎯 Next Sprint Goals

1. **Fix color material transparency** (HIGH - blocks 3 themes)
2. **Complete documentation** (TODO.md ✅, FUTURE-FEATURES.md, THEME-SYSTEM.md)
3. **Fine-tune all theme UV coordinates** (MEDIUM)
4. **Add 2-3 new themes** (LOW)
5. **Improve mobile touch controls** (MEDIUM)

---

## Notes

- Keep this file updated as work progresses
- Mark items as ✅ when completed, move to "Recently Completed" section
- Add AI prompts for all new features/bugs for easy context restoration
- Link to relevant files/line numbers where possible
- Update "Last Updated" date at top when making changes

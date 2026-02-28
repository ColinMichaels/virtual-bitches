# BISCUITS Architecture

**A 3D browser-based push-your-luck dice game built with TypeScript, BabylonJS, and Vite**

> Version 1.0 • ~5,800 lines of TypeScript • 19 components

---

## Design Philosophy

1. **Separation of Concerns**: Pure game logic separated from rendering
2. **Deterministic**: Seeded RNG enables replays and fair competition
3. **Performance First**: Efficient 3D rendering with BabylonJS
4. **Theme-able**: Modular dice theme system with hot-swapping
5. **Stateless UI**: React-like patterns without framework overhead

---

## System Layers

```
┌─────────────────────────────────────────┐
│            UI Components                │  User interaction
│  (HUD, DiceRow, Modals, Debug View)    │
├─────────────────────────────────────────┤
│          Controllers Layer              │  Orchestration
│  (Input, GameFlow, GameOver)           │
├─────────────────────────────────────────┤
│         Rendering Layer                 │  3D visualization
│  (Scene, DiceRenderer, SplashDice)     │
├─────────────────────────────────────────┤
│          Services Layer                 │  Cross-cutting concerns
│  (ThemeManager, Audio, Settings, etc)  │
├─────────────────────────────────────────┤
│         Game State Layer                │  State management
│  (State transitions, Action log)       │
├─────────────────────────────────────────┤
│          Game Engine                    │  Pure logic
│  (RNG, Rules, Types, Scoring)          │
└─────────────────────────────────────────┘
```

Admin Surface Note:
- A separate `/admin` Angular portal is planned and documented in `docs/ADMIN-PORTAL-ANGULAR-PLAN.md`.
- It is intentionally decoupled from the gameplay frontend architecture described in this document.
- Beta deployment/security readiness review is tracked in `docs/BETA-DEPLOYMENT-ARCHITECTURE-REVIEW.md`.

---

## Core Architecture

### 1. Engine Layer (`src/engine/`)

**Pure game logic with zero dependencies on rendering or UI**

- **`types.ts`**: Core data structures
  - `DieState`, `GameState`, `Action`, `GameConfig`
  - Type-safe game primitives

- **`rng.ts`**: Deterministic Random Number Generator
  - Seeded PRNG using mulberry32 algorithm
  - Enables replays and verification
  - Per-roll seeding: `seed-rollIndex`

- **`rules.ts`**: Game rules and validation
  - `scoreDie(die)`: Calculate points (max - value)
  - `isValidSelection()`: Validate player choices
  - `buildDicePool()`: Generate initial dice
  - `isGameComplete()`: Check win condition

- **`rules.test.ts`**: Unit tests for game logic

**Key Design**: Engine has no knowledge of 3D, UI, or browser APIs

---

### 2. Game State Layer (`src/game/`)

**Immutable state management with action log**

- **`state.ts`**: Redux-style state management
  - `createGame(seed)`: Initialize game state
  - `reduce(state, action)`: Pure state transitions
  - `replay(seed, actions)`: Deterministic replay
  - `generateShareURL()`: Create shareable game links

**Action Types**:
```typescript
type Action =
  | { t: "ROLL" }
  | { t: "TOGGLE_SELECT"; dieId: string }
  | { t: "SCORE_SELECTED" }
```

**State Flow**:
```
User Input → Action → Reducer → New State → UI Update
                ↓
          Action Log (for replay)
```

---

### 3. Controllers Layer (`src/controllers/`)

**Orchestration layer between UI and game logic** (Added 2025-02-24 in refactoring)

- **`InputController.ts`**: Handles all user input (~326 lines)
  - Button event listeners (action, deselect, undo, new game)
  - Keyboard shortcuts (Space, ESC, Arrow keys, Enter, X, N, D)
  - Mobile menu toggle and interactions
  - Camera control buttons
  - Uses callback interface pattern to communicate with Game class

- **`GameFlowController.ts`**: Manages game lifecycle (~130 lines)
  - `initializeGameState()`: Parse URL parameters or create new game
  - `createNewGame()`: Create fresh game with current settings
  - `handleModeChange()`: Handle difficulty changes with confirmation
  - `updateHintMode()`: Update hint display based on game mode
  - `resetForNewGame()`: Clear renderer for new game
  - `isGameInProgress()`: Check if game is in progress
  - `initializeAudio()`: Initialize audio on first interaction
  - All static methods (utility pattern)

- **`GameOverController.ts`**: Handles end-game flow (~143 lines)
  - `showGameOver()`: Display game over screen with score, rank, stats
  - `displayRank()`: Show player rank and personal best status
  - `setupSeedActions()`: Setup copy/download buttons for seed sharing
  - `hide()`: Hide game over modal
  - Instance-based controller managing DOM elements

**Design Pattern**:
- InputController uses callback interface for loose coupling
- GameFlowController uses static methods as it's stateless
- GameOverController is instance-based for DOM management
- Reduced main.ts from 954 lines to 570 lines (40% reduction)

---

### 4. Rendering Layer (`src/render/`)

**3D visualization using BabylonJS 7.x**

- **`scene.ts`**: BabylonJS scene setup
  - Camera configuration (ArcRotateCamera)
  - Lighting (HemisphericLight + DirectionalLight)
  - Shadow generation
  - Camera presets (default, debug, splash)

- **`dice.ts`**: Main dice renderer (1,091 lines)
  - Theme-aware material loading
  - Mesh instancing from dice-box geometry
  - Roll animations with physics-style motion
  - Rotation caching for face detection (d10/d12)
  - Selection highlighting
  - Debug dice rendering

- **`splashDice.ts`**: Simplified renderer for splash screen
  - Subset of dice.ts functionality
  - Lighter weight for background

- **`materials.ts`**: Material utilities (legacy, mostly unused)

- **`geometryLoader.ts`**: Geometry loading utilities (legacy)

**Rendering Pipeline**:
```
ThemeManager → Load Geometry/Textures → Create Materials →
  Clone Meshes → Apply Transforms → Animate → Detect Face Value
```

---

### 5. UI Layer (`src/ui/`)

**User interface components with vanilla TypeScript**

- **`hud.ts`**: Game HUD overlay
  - Score display
  - Dice pool status
  - Turn counter

- **`diceRow.ts`**: 2D top-down dice view
  - Shows active dice with values
  - Click to select
  - Theme texture backgrounds
  - Point preview

- **`splash.ts`**: Landing screen
  - Animated 3D dice background
  - Start game / Settings / Rules / Leaderboard

- **`settings.ts`**: Settings modal
  - Audio volume controls
  - Theme switcher
  - Future: gameplay options

- **`themeSwitcher.ts`**: Theme selection dropdown
  - Lists available themes
  - Triggers theme changes

- **`debugView.ts`**: Developer debug panel
  - Test dice rotations
  - Live texture mapping controls
  - Theme switching for debugging

- **`leaderboard.ts`**: Score history display
  - Local storage-based leaderboard
  - Daily/all-time filtering

- **`rules.ts`**: Rules modal
  - Game instructions
  - Markdown rendering

- **`tutorial.ts`**: First-time tutorial
  - Interactive guide
  - One-time display

- **`notifications.ts`**: Toast notification system
  - Floating game messages
  - Auto-dismiss

**UI Pattern**: No framework, direct DOM manipulation with TypeScript

---

### 6. Services Layer (`src/services/`)

**Singleton services for cross-cutting concerns**

- **`themeManager.ts`**: Theme management (170 lines)
  - Load theme configs from `/assets/themes/`
  - Observer pattern for theme changes
  - Support for 8+ themes
  - Material types: `standard` (baked) vs `color` (overlay)

- **`audio.ts`**: Sound effect management
  - Background music
  - SFX (roll, score, click, etc.)
  - Volume controls

- **`settings.ts`**: User preferences
  - LocalStorage persistence
  - Audio settings
  - Theme selection

- **`score-history.ts`**: Score tracking
  - Save game results
  - Daily challenges
  - Rank calculation

- **`social/friends/friendsService.ts`**: Friends scaffold (planning stage)
  - Placeholder service and shared contracts for future friends/presence/invite features
  - Intentionally disabled until multiplayer mechanics stabilization gate is complete

**Service Pattern**: Singleton instances exported as `service` (e.g., `themeManager`)

---

### 6. Utilities Layer (`src/utils/`)

**Cross-cutting utility functions**

- **`logger.ts`**: Centralized logging system (90 lines)
  - Environment-aware log levels (DEBUG, INFO, WARN, ERROR)
  - Module-specific loggers with prefixes
  - Production mode suppresses debug logs
  - Used across 10+ modules for consistent logging

**Usage Pattern**:
```typescript
import { logger } from "../utils/logger.js";
const log = logger.create('ModuleName');

log.debug("Detailed debugging info");  // Only in dev
log.info("General information");       // Always shown
log.warn("Warning message");           // Always shown
log.error("Error occurred:", error);   // Always shown
```

**Log Levels**:
- `DEBUG` (0): Detailed diagnostics (dev only)
- `INFO` (1): General information
- `WARN` (2): Warnings and potential issues
- `ERROR` (3): Critical errors

**Environment Control**:
- Development: All logs shown (DEBUG, INFO, WARN, ERROR)
- Production: Only INFO, WARN, ERROR shown (DEBUG suppressed)

---

## Data Flow

### Game Loop
```
1. User clicks "Roll" button
2. main.ts dispatches { t: "ROLL" }
3. state.ts reducer:
   - Creates new RNG: SeededRNG(`${seed}-${rollIndex}`)
   - Rolls all in-play dice
   - Returns new state
4. main.ts updates UI:
   - diceRenderer.rollDice(dice)
   - hud.update(state)
   - diceRow.update(state)
5. Animations play
6. User selects dice → repeat
```

### Theme Switching
```
1. User selects theme in dropdown
2. themeSwitcher.ts calls themeManager.setTheme(name)
3. themeManager notifies all listeners
4. diceRenderer.onThemeChange():
   - Dispose old materials
   - Load new theme config + textures
   - Recreate materials for all dice
5. UI updates immediately
```

---

## Key Technologies

### BabylonJS 7.x
- **Scene Management**: Cameras, lights, shadows
- **Mesh Rendering**: Dice geometry from dice-box
- **Materials**: StandardMaterial for themes
- **Animations**: Keyframe animations for dice rolls
- **Input**: Pointer events for selection

### Vite
- **Dev Server**: Fast HMR with ES modules
- **Build**: TypeScript compilation + bundling
- **Assets**: Static files from `/public` copied to `/dist`

### TypeScript 5.x
- **Strict Mode**: Full type safety
- **ES2022 Target**: Modern JavaScript features
- **Path Aliases**: `@env` for environment configs

---

## File Structure

```
biscuits-game/
├── src/
│   ├── engine/          # Pure game logic (no deps)
│   │   ├── rng.ts           # Seeded RNG
│   │   ├── types.ts         # Core types
│   │   ├── rules.ts         # Game rules
│   │   └── rules.test.ts    # Unit tests
│   │
│   ├── game/            # State management
│   │   └── state.ts         # Reducer + replay
│   │
│   ├── render/          # 3D rendering (BabylonJS)
│   │   ├── scene.ts         # Scene setup
│   │   ├── dice.ts          # Main dice renderer
│   │   ├── splashDice.ts    # Splash screen dice
│   │   ├── materials.ts     # Material utils (legacy)
│   │   └── geometryLoader.ts # Geometry utils (legacy)
│   │
│   ├── ui/              # UI components (vanilla TS)
│   │   ├── hud.ts           # Game HUD
│   │   ├── diceRow.ts       # 2D dice display
│   │   ├── splash.ts        # Landing screen
│   │   ├── settings.ts      # Settings modal
│   │   ├── themeSwitcher.ts # Theme dropdown
│   │   ├── debugView.ts     # Debug tools
│   │   ├── leaderboard.ts   # Score history
│   │   ├── rules.ts         # Rules modal
│   │   ├── tutorial.ts      # Tutorial overlay
│   │   └── notifications.ts # Toast messages
│   │
│   ├── services/        # Singleton services
│   │   ├── themeManager.ts  # Theme system
│   │   ├── audio.ts         # Sound effects
│   │   ├── settings.ts      # User preferences
│   │   └── score-history.ts # Score tracking
│   │
│   ├── utils/           # Utility functions
│   │   └── logger.ts        # Centralized logging
│   │
│   ├── environments/    # Environment configs
│   │   ├── types.ts         # Environment interface
│   │   ├── environment.ts   # Default
│   │   ├── environment.dev.ts   # Development
│   │   └── environment.prod.ts  # Production
│   │
│   ├── main.ts          # App entry point (Game class)
│   ├── styles.css       # Global styles
│   └── index.html       # HTML entry
│
├── public/              # Static assets (copied to dist/)
│   └── assets/
│       ├── themes/          # Dice themes (8 themes)
│       ├── dice-box/        # Shared dice-box assets
│       └── ammo/            # Physics (unused currently)
│
├── docs/                # Documentation
│   ├── ARCHITECTURE.md      # This file
│   ├── TODO.md             # Active tasks
│   ├── FUTURE-FEATURES.md  # Feature roadmap
│   └── THEME-SYSTEM.md     # Theme development guide
│
├── dist/                # Build output (generated)
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
├── vite.config.ts       # Vite config
└── vercel.json          # Deployment config
```

---

## Component Responsibilities

### Main Game Loop (`main.ts`)
- **Initialization**: Create scene, renderer, UI components
- **Event Handling**: Mouse clicks, keyboard, buttons
- **State Management**: Dispatch actions, update state
- **Animation Coordination**: Trigger dice rolls, wait for completion
- **Game Over**: Save scores, show results

### DiceRenderer (`render/dice.ts`)
- **Theme Loading**: Load geometry + materials from theme config
- **Mesh Management**: Clone template meshes for each die
- **Material Application**: Apply theme textures + colors
- **Animation**: Roll dice with physics-style motion
- **Face Detection**: Raycast to determine top face (d10/d12)
- **Selection**: Highlight selected dice
- **Debug Mode**: Render test dice in grid

### ThemeManager (`services/themeManager.ts`)
- **Theme Discovery**: Load all themes from `/assets/themes/`
- **Theme Switching**: Hot-swap themes without reload
- **Observer Pattern**: Notify renderers of theme changes
- **Configuration**: Parse theme.config.json files
- **Persistence**: Save theme preference to localStorage

---

## Key Design Decisions

### 1. Deterministic RNG
**Why**: Enables fair competition, replays, and verification
**How**: Seeded PRNG with per-roll seeds (`seed-rollIndex`)
**Trade-off**: No true randomness, but game fairness is paramount

### 2. Action Log Replay
**Why**: Share games, verify scores, reproduce bugs
**How**: Serialize action log to base64 in URL
**Trade-off**: URL size grows with game length

### 3. No Physics Engine
**Why**: Physics is overkill, animations are simpler
**How**: Keyframe animations with easing functions
**Trade-off**: Less realistic, but faster and more controllable

### 4. Vanilla UI (No Framework)
**Why**: Keep bundle size small, avoid framework overhead
**How**: Direct DOM manipulation with TypeScript
**Trade-off**: More boilerplate, but full control

### 5. BabylonJS for 3D
**Why**: Full-featured, performant, TypeScript-first
**How**: Scene-based rendering with materials/meshes
**Trade-off**: Large bundle (~1.2MB gzipped), but worth it for 3D quality

### 6. Theme System Architecture
**Why**: Support multiple visual styles without code changes
**How**: JSON configs + texture atlases, observer pattern
**Trade-off**: Complexity in material loading, but great UX

---

## Performance Considerations

### Rendering Optimizations
- **Mesh Instancing**: Clone from templates, not re-parsing
- **Material Sharing**: Single material per theme (cloned per die for colors)
- **Frozen Normals**: Disable normal recalculation on static meshes
- **Shadow Optimization**: Only main dice cast shadows
- **Lazy Loading**: Themes loaded on-demand

### Bundle Size
- **Current**: ~1.2MB gzipped (mostly BabylonJS)
- **Optimization Opportunities**:
  - Code splitting for modals
  - Lazy load theme assets
  - Tree-shake unused BabylonJS features

### Memory Management
- **Dispose Pattern**: Explicit cleanup of meshes/materials/textures
- **Scene Cleanup**: Clear debug dice after use
- **Texture Reuse**: Share textures between materials

---

## Testing Strategy

### Unit Tests
- **Engine Layer**: `rules.test.ts` covers scoring logic
- **Future**: Add tests for state reducer, RNG

### Manual Testing
- **Debug View**: Test dice rotations, texture mapping
- **Replay**: Verify deterministic behavior
- **Theme Switching**: Test all 8 themes

### Quality Assurance
- **TypeScript**: Strict mode catches type errors
- **Build**: CI/CD verifies build success
- **Deployment**: Vercel preview deployments

---

## Development Workflow

### Local Development
```bash
npm install
npm run dev        # Start dev server (port 5173)
npm run test       # Run unit tests
```

### Building
```bash
npm run build      # Production build to dist/
npm run preview    # Preview build locally
```

### Deployment
```bash
npm run deploy     # Build + deploy to GitHub Pages
```

### Adding Features
1. Update engine logic if needed (pure functions)
2. Update state reducer if needed
3. Update renderer for visuals
4. Update UI components
5. Add tests
6. Update documentation

---

## External Dependencies

### Runtime
- `@babylonjs/core` (7.x): 3D rendering engine
- `@babylonjs/loaders` (7.x): .babylon JSON loader
- `@babylonjs/materials` (7.x): CustomMaterial support
- `marked` (17.x): Markdown parsing for rules

### Development
- `typescript` (5.3): Type checking
- `vite` (5.x): Build tool + dev server
- `tsx` (4.x): TypeScript test runner
- `gh-pages` (6.x): GitHub Pages deployment

---

## Environment Configuration

### Development (`environment.dev.ts`)
- `debug: true` - Enable console logs
- Dev server on `localhost:5173`

### Production (`environment.prod.ts`)
- `debug: false` - Disable logs
- Deployed to GitHub Pages

### Path Alias
- `@env` resolves to correct environment file via Vite

---

## Debugging Tools

### Debug View (Press `D`)
- **Dice Testing**: Cycle through dice types
- **Face Verification**: Check each face displays correctly
- **Texture Controls**: Live adjust scale/offset with sliders
- **Theme Switching**: Test themes rapidly

### Browser DevTools
- Console logs with emoji prefixes (`🎲`, `🎨`, `✅`, `❌`)
- Network tab for theme loading
- Performance tab for rendering analysis

### URL Parameters
- `?seed=12345` - Start with specific seed
- `?seed=12345&log=base64...` - Replay game

---

## Contributing Guidelines

### Code Style
- **TypeScript**: Strict mode, explicit types
- **Naming**: camelCase for variables, PascalCase for types
- **Imports**: `.js` extension for imports (required)
- **Comments**: Document complex logic, not obvious code

### File Organization
- Keep files focused (single responsibility)
- Group related functionality
- Avoid circular dependencies

### Pull Requests
- Test locally with `npm run build`
- Update docs if architecture changes
- Add unit tests for engine changes

---

## Known Limitations

### 1. Color Material Transparency
**Issue**: Color material themes (default, smooth-pip) show transparent dice bodies
**Cause**: StandardMaterial doesn't support mixing base color with texture alpha
**Solution**: Needs CustomMaterial with shader code (see dice-box implementation)
**Status**: Known issue, documented in TODO.md

### 2. Theme Texture Mapping
**Issue**: Some themes have slight texture offset issues
**Cause**: UV coordinates vary between geometry files
**Solution**: Use debug view to fine-tune textureScale/textureOffset per theme
**Status**: In progress, most themes work well

### 3. Bundle Size
**Issue**: 1.2MB gzipped is large for a dice game
**Cause**: Full BabylonJS core included
**Solution**: Code splitting, tree shaking, lazy loading
**Status**: Low priority, performance is good

### 4. Mobile Performance
**Issue**: Some devices lag with shadows enabled
**Cause**: Shadow rendering is expensive
**Solution**: Auto-detect low-end devices, disable shadows
**Status**: Future enhancement

---

## Future Architecture Improvements

### 1. Physics Engine Integration
Add real physics with `@babylonjs/core/Physics/ammo` for more realistic rolls

### 2. WebWorker for RNG
Move heavy RNG calculations to background thread

### 3. State Persistence
Save game state to IndexedDB for resume

### 4. Multiplayer Architecture
WebSocket or WebRTC for real-time multiplayer

### 5. Component Refactoring
Split large files (dice.ts is 1,091 lines)

---

## Resources

- **BabylonJS Docs**: https://doc.babylonjs.com/
- **dice-box Library**: https://github.com/3d-dice/dice-box
- **dice-themes Repository**: https://github.com/3d-dice/dice-themes
- **Vite Docs**: https://vitejs.dev/
- **TypeScript Handbook**: https://www.typescriptlang.org/docs/

---

## Glossary

- **Action**: User input represented as data (ROLL, TOGGLE_SELECT, SCORE_SELECTED)
- **Die Definition**: Static properties of a die type (kind, sides)
- **Die State**: Current state of a die instance (value, inPlay, scored)
- **Face Detection**: Raycast-based algorithm to determine which face is pointing up
- **Material Type**:
  - `standard`: Baked texture atlas (e.g., diceOfRolling, wooden)
  - `color`: Base color + transparent overlay (e.g., default, smooth-pip)
- **Reducer**: Pure function that takes (state, action) → new state
- **Replay**: Deterministic re-execution of a game from seed + action log
- **Seed**: String that initializes the RNG for deterministic behavior
- **Template Mesh**: Disabled mesh used for cloning (dice-box pattern)
- **Theme Config**: JSON file defining theme assets and material properties
- **UV Coordinates**: Texture mapping coordinates on 3D mesh

---

*Last Updated: 2024-02-24*
*Total Lines of Code: ~5,810*
*Components: 19*
*Themes: 8*

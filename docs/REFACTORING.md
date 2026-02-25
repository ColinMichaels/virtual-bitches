# Refactoring Guide - Controllers Pattern

**Date**: 2026-02-24
**Objective**: Extract main.ts into focused controllers to reduce complexity and improve maintainability

---

## Problem Statement

The `main.ts` file had grown to **954 lines** with too many responsibilities:
- User input handling (buttons, keyboard, mobile menu)
- Game lifecycle management (initialization, new games, mode switching)
- End-game flow (score display, leaderboard, seed sharing)
- 3D scene management
- UI coordination
- State management

This violated the Single Responsibility Principle and made the code difficult to:
- Test (tight coupling to DOM and BabylonJS)
- Understand (too many concerns in one file)
- Modify (risk of breaking unrelated functionality)
- Reuse (functionality locked inside Game class)

---

## Solution: Controllers Pattern

We introduced a **Controllers Layer** between UI and Game Logic to orchestrate interactions without tight coupling.

### Design Principles

1. **Separation of Concerns**: Each controller has one clear responsibility
2. **Loose Coupling**: Controllers communicate via interfaces, not direct dependencies
3. **Pattern Matching**: Choose the right pattern for each controller's needs
4. **Progressive Enhancement**: Existing functionality preserved, just reorganized

---

## Implementation

### 1. InputController (Callback Interface Pattern)

**File**: `src/controllers/InputController.ts` (~326 lines)

**Responsibilities**:
- All button event listeners
- Keyboard shortcuts (Space, ESC, Arrow keys, Enter, X, N, D)
- Mobile menu toggle and interactions
- Camera control buttons

**Design**: Uses callback interface pattern for loose coupling

```typescript
export interface GameCallbacks {
  handleAction: () => void;
  handleDeselectAll: () => void;
  handleUndo: () => void;
  handleNewGame: () => void;
  startNewGame: () => void;
  togglePause: () => void;
  handleDieClick: (dieId: string) => void;
  highlightFocusedDie: (dieId: string) => void;
  getGameState: () => GameState;
  isAnimating: () => boolean;
  isPaused: () => boolean;
  getSelectedDieIndex: () => number;
  setSelectedDieIndex: (index: number) => void;
}
```

**Usage**:
```typescript
this.inputController = new InputController(
  this,  // Game class implements GameCallbacks
  this.scene,
  this.leaderboardModal,
  rulesModal,
  this.debugView
);
this.inputController.initialize();
```

**Benefits**:
- Game class doesn't know about input implementation details
- Easy to unit test by mocking the callbacks
- Can swap input implementations (e.g., gamepad support)

---

### 2. GameFlowController (Static Utility Pattern)

**File**: `src/controllers/GameFlowController.ts` (~130 lines)

**Responsibilities**:
- Initialize game state from URL or create new game
- Create fresh games with current settings
- Handle difficulty mode changes with confirmation
- Update hint mode based on game state
- Reset renderer for new games
- Check if game is in progress
- Initialize audio on first interaction

**Design**: All static methods (stateless utility functions)

```typescript
export class GameFlowController {
  static initializeGameState(): GameState { ... }
  static createNewGame(): GameState { ... }
  static handleModeChange(
    currentState: GameState,
    newDifficulty: GameDifficulty,
    isGameInProgress: boolean
  ): GameState | null { ... }
  static updateHintMode(state: GameState, diceRow: DiceRow): void { ... }
  static resetForNewGame(diceRenderer: DiceRenderer): void { ... }
  static isGameInProgress(state: GameState): boolean { ... }
  static async initializeAudio(): Promise<void> { ... }
}
```

**Usage**:
```typescript
// In constructor
this.state = GameFlowController.initializeGameState();

// When starting new game
this.state = GameFlowController.createNewGame();
GameFlowController.updateHintMode(this.state, this.diceRow);
GameFlowController.resetForNewGame(this.diceRenderer);
```

**Benefits**:
- Pure functions - easy to test
- No state management overhead
- Clear entry points for game lifecycle
- Can be used by any part of the codebase

---

### 3. GameOverController (Instance-based Pattern)

**File**: `src/controllers/GameOverController.ts` (~143 lines)

**Responsibilities**:
- Show game over screen with score, rank, and stats
- Display player rank and personal best status
- Setup copy/download buttons for seed sharing
- Hide game over modal

**Design**: Instance-based controller managing DOM elements

```typescript
export class GameOverController {
  private gameOverEl: HTMLElement;
  private finalScoreEl: HTMLElement;
  private shareLinkEl: HTMLElement;
  private scene: GameScene;

  constructor(scene: GameScene) { ... }

  showGameOver(state: GameState, gameStartTime: number): void { ... }
  private displayRank(...): void { ... }
  private setupSeedActions(...): void { ... }
  hide(): void { ... }
}
```

**Usage**:
```typescript
// In constructor
this.gameOverController = new GameOverController(this.scene);

// When game completes
this.gameOverController.showGameOver(this.state, this.gameStartTime);

// When starting new game
this.gameOverController.hide();
```

**Benefits**:
- Encapsulates DOM element references
- Manages end-game UI lifecycle
- Can maintain internal state (e.g., animation timers)

---

### 4. URL Utilities

**File**: `src/utils/urlUtils.ts` (~24 lines)

**Extracted utilities**:
- `generateSeed()`: Create unique game seeds
- `parseGameURL()`: Parse seed and replay parameters from URL

---

## Results

### Metrics

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| main.ts lines | 954 | 570 | -40% |
| Files created | - | 4 | +4 |
| Controllers LOC | 0 | ~600 | +600 |
| Test coverage | Hard | Easier | ✓ |
| Separation of concerns | Low | High | ✓ |

### Code Quality Improvements

1. **Single Responsibility**: Each controller has one clear purpose
2. **Testability**: Controllers can be tested independently
3. **Maintainability**: Changes to input handling don't affect game flow
4. **Reusability**: GameFlowController utilities can be used anywhere
5. **Readability**: main.ts is now focused on orchestration, not implementation

### Build Status

✅ All TypeScript compilation passes
✅ No runtime errors
✅ All functionality preserved

---

## Migration Guide

### For New Features

**Adding a new input method** (e.g., gamepad support):
- Extend or create new InputController
- Implement GameCallbacks interface
- No changes needed to Game class internals

**Adding a new game mode**:
- Add mode logic to GameFlowController
- Update createNewGame() and initializeGameState()
- Game class calls remain the same

**Changing game over screen**:
- Modify GameOverController only
- No changes to Game class needed

### Best Practices

1. **Keep controllers focused**: One responsibility per controller
2. **Use appropriate patterns**:
   - Callback interface for bidirectional communication
   - Static methods for stateless utilities
   - Instance-based for DOM/state management
3. **Avoid tight coupling**: Controllers should not depend on each other
4. **Test at controller level**: Write unit tests for each controller

---

## Future Refactoring Opportunities

### Potential Improvements

1. **DiceRenderer Refactoring** (~1,091 lines)
   - Could be split into:
     - DiceFactory (mesh creation)
     - AnimationController (roll/score animations)
     - MaterialManager (theme materials)

2. **State Management Refactoring**
   - Consider introducing a proper state manager class
   - Add state subscriptions for UI updates
   - Implement undo/redo stack as service

3. **UI Component Refactoring**
   - Extract common modal patterns
   - Create reusable UI component base classes
   - Add component lifecycle methods

### File Size Guidelines

Based on this refactoring:
- **Target**: < 500 lines per file
- **Maximum**: 800 lines before considering extraction
- **Controllers**: 100-300 lines is ideal

---

## Lessons Learned

1. **Start early**: Don't wait for files to hit 1000+ lines
2. **Pattern matters**: Choose the right pattern for each use case
3. **Preserve functionality**: Refactoring should not change behavior
4. **Update docs**: Keep architecture documentation in sync
5. **Test thoroughly**: Build + manual testing after refactoring

---

## References

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Full system architecture
- [TODO.md](./TODO.md) - Refactoring completion notes
- Main refactoring PR: Controllers Pattern Implementation (2026-02-24)

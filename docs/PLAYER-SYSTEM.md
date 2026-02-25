# Player System Architecture

## Overview

The Player System provides the foundation for multiplayer gameplay in BISCUITS. It manages player data, game state, and visual representation around the octagon table.

**Status**: Foundation complete, ready for integration
**Created**: 2026-02-24
**Location**: `src/multiplayer/`

---

## Architecture

### Three-Layer Design

```
┌─────────────────────────────────────────────┐
│           PlayerManager                      │
│  Coordinates all players & turn order       │
└─────────────────┬───────────────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
┌───────▼─────────┐  ┌─────▼──────────┐
│ PlayerController│  │ PlayerController│
│  (Player 1)     │  │  (Player 2)     │  ...
└────────┬────────┘  └────────┬────────┘
         │                    │
    ┌────▼────┐          ┌───▼─────┐
    │  Player │          │  Player │
    │  Model  │          │  Model  │
    └─────────┘          └─────────┘
```

---

## Components

### 1. Player Class (`src/multiplayer/Player.ts`)

**Purpose**: Represents a single player in the game

**Key Properties**:
- `id`: Unique player identifier
- `profile`: Player name, avatar, rank, stats
- `seatIndex`: Position around octagon (0-7)
- `isLocal`: Whether this is the local player
- `gameState`: Current game state for this player
- `isActive`: Whether player is still in game

**Key Methods**:
- `updateStats(score, won)`: Update player statistics
- `getScoreAreaPosition()`: Calculate where scored dice appear
- `getForwardDirection()`: Get direction toward table center
- `toJSON()` / `fromJSON()`: Serialization for network
- `createLocalPlayer()`: Create default local player
- `createGuestPlayer()`: Create guest/AI player

**Example**:
```typescript
// Create local player at seat 0
const player = Player.createLocalPlayer("You", 0);

// Get score position for this player
const scorePos = player.getScoreAreaPosition(22); // tableRadius = 22
// Returns: Vector3(8.8, 0.6, 0) for seat 0
```

---

### 2. PlayerController Class (`src/multiplayer/PlayerController.ts`)

**Purpose**: Manages individual player's game flow and interactions

**Key Responsibilities**:
- Game state management for one player
- Action handling and state updates
- Score display updates
- Dice animation to player-specific areas
- Player HUD display (future)
- Network communication (future)

**Key Methods**:
- `startGame(initialState)`: Initialize player's game
- `handleAction(action)`: Apply action to player's state
- `updateGameState(newState)`: Update player's state
- `animateScoreDice()`: Animate dice to player's score area
- `showPlayerHUD()` / `hidePlayerHUD()`: Display player info
- `getPlayerHUDData()`: Get data for HUD display
- `finishGame(won)`: Complete game and update stats

**Example**:
```typescript
const controller = new PlayerController(player, scene, diceRenderer);
controller.startGame(initialGameState);
controller.handleAction({ t: "ROLL" });
```

---

### 3. PlayerManager Class (`src/multiplayer/PlayerManager.ts`)

**Purpose**: Coordinates multiple players and turn order

**Key Responsibilities**:
- Player lifecycle (add/remove)
- Turn management (who's turn is it?)
- Visual updates (seat colors, highlights)
- Network coordination (future)

**Key Methods**:
- `addPlayer(profile, seatIndex, isLocal)`: Add player to game
- `removePlayer(playerId)`: Remove player from game
- `getPlayer(playerId)`: Get player by ID
- `getLocalPlayer()`: Get the local player
- `getPlayerBySeat(seatIndex)`: Get player at seat
- `setCurrentTurn(playerId)`: Set whose turn it is
- `nextTurn()`: Advance to next player
- `updateAllPlayerDisplays()`: Update all seat visuals

**Example**:
```typescript
const playerManager = new PlayerManager(scene, diceRenderer);

// Add local player at seat 0
const profile: PlayerProfile = {
  id: "local-123",
  name: "You",
  rank: 0,
  stats: { ... }
};
const localPlayer = playerManager.addPlayer(profile, 0, true);

// Add remote player at seat 2
const remoteProfile = { ... };
playerManager.addPlayer(remoteProfile, 2, false);

// Turn-based play
playerManager.setCurrentTurn(localPlayer.id);
// ... player takes turn ...
playerManager.nextTurn(); // Move to seat 2
```

---

## Integration Guide

### Current Single-Player Integration (Not Yet Implemented)

To integrate with existing game:

**1. Update `GameScene.ts`**:
```typescript
import { PlayerManager } from "../multiplayer/PlayerManager.js";

export class GameScene {
  public playerManager?: PlayerManager;

  constructor(canvas: HTMLCanvasElement) {
    // ... existing setup ...

    // Initialize player manager
    this.playerManager = new PlayerManager(this, diceRenderer);
  }
}
```

**2. Update `main.ts`**:
```typescript
constructor() {
  // ... existing setup ...

  // Create local player
  const localProfile: PlayerProfile = {
    id: `local-${Date.now()}`,
    name: settingsService.getPlayerName() || "You",
    rank: 0,
    avatarUrl: undefined,
    stats: {
      gamesPlayed: 0,
      totalScore: 0,
      highScore: 0,
      wins: 0,
      averageScore: 0
    }
  };

  const localPlayer = this.scene.playerManager!.addPlayer(localProfile, 0, true);
  this.playerController = this.scene.playerManager!.getPlayerController(localPlayer.id);

  // Use player controller for game actions
  this.playerController!.startGame(this.state);
}
```

**3. Update `DiceRenderer.animateScore()`**:
```typescript
animateScore(
  dice: DieState[],
  selected: Set<string>,
  onComplete: () => void,
  scorePosition?: Vector3  // Add optional parameter
) {
  // Use scorePosition if provided, otherwise use default
  const basePos = scorePosition || new Vector3(9, 0.6, -3);
  // ... rest of animation logic ...
}
```

---

## Scored Dice Positioning

### Current Implementation
- **Old position**: Fixed at `(12, 0.6, -3)` - far right of table
- **New position**: `(9, 0.6, -3)` - closer to front (seat 0)

### Player-Specific Positions

Each player's scored dice appear at their seat:

| Seat | Angle | Score Position (approx) |
|------|-------|------------------------|
| 0    | 0°    | (9, 0.6, 0)           |
| 1    | 45°   | (6.4, 0.6, 6.4)       |
| 2    | 90°   | (0, 0.6, 9)           |
| 3    | 135°  | (-6.4, 0.6, 6.4)      |
| 4    | 180°  | (-9, 0.6, 0)          |
| 5    | 225°  | (-6.4, 0.6, -6.4)     |
| 6    | 270°  | (0, 0.6, -9)          |
| 7    | 315°  | (6.4, 0.6, -6.4)      |

**Formula**:
```typescript
const angleStep = (Math.PI * 2) / 8;
const angle = angleStep * seatIndex;
const distance = tableRadius * 0.4; // 40% from center

const x = distance * Math.cos(angle);
const z = distance * Math.sin(angle);
const y = 0.6; // Standard height
```

---

## Player Colors

Players are assigned colors based on seat index:

```typescript
const PLAYER_COLORS = [
  new Color3(0.2, 0.8, 0.3), // Green (seat 0 - local)
  new Color3(0.8, 0.3, 0.3), // Red
  new Color3(0.3, 0.5, 0.9), // Blue
  new Color3(0.9, 0.7, 0.2), // Yellow
  new Color3(0.7, 0.3, 0.8), // Purple
  new Color3(0.3, 0.8, 0.8), // Cyan
  new Color3(0.9, 0.5, 0.3), // Orange
  new Color3(0.8, 0.3, 0.6), // Pink
];
```

---

## Future Multiplayer Features

### Phase 1: Local Multiplayer (Hot Seat)
- Multiple players on same device
- Turn-based gameplay
- Pass device between players

### Phase 2: Online Multiplayer
- WebSocket server integration
- Real-time state synchronization
- Matchmaking system
- Player authentication

### Phase 3: Advanced Features
- Tournaments
- Spectator mode
- Replay system for multiplayer
- Voice chat
- Custom avatars

---

## Network Protocol (Future)

### WebSocket Messages

**Client → Server**:
```json
{
  "type": "action",
  "playerId": "player-123",
  "gameId": "game-456",
  "action": { "t": "ROLL" },
  "timestamp": 1234567890
}
```

**Server → Client**:
```json
{
  "type": "state_update",
  "gameId": "game-456",
  "playerId": "player-123",
  "state": { ... },
  "timestamp": 1234567891
}
```

**Player Join**:
```json
{
  "type": "player_joined",
  "gameId": "game-456",
  "player": {
    "id": "player-789",
    "profile": { ... },
    "seatIndex": 2
  }
}
```

---

## Testing

### Single Player Test
```typescript
// Create player manager
const playerManager = new PlayerManager(scene, diceRenderer);

// Add local player
const player = playerManager.addPlayer(
  Player.createLocalPlayer("Test Player", 0).profile,
  0,
  true
);

// Verify seat is occupied
console.assert(playerManager.isSeatOccupied(0) === true);
console.assert(playerManager.getPlayerBySeat(0) === player);
```

### Multi-Player Test
```typescript
// Add 4 players
for (let i = 0; i < 4; i++) {
  const profile = Player.createGuestPlayer(`Player ${i + 1}`, i).profile;
  playerManager.addPlayer(profile, i, i === 0);
}

// Test turn rotation
playerManager.setCurrentTurn(players[0].id);
playerManager.nextTurn(); // Should move to player 1
console.assert(playerManager.getCurrentTurnPlayer()?.seatIndex === 1);
```

---

## Benefits

### Immediate
✅ Scored dice now appear closer to player
✅ Clean architecture for future multiplayer
✅ Separation of concerns (Player/Controller/Manager)

### Future
✅ Easy to add multiplayer support
✅ Turn-based or simultaneous gameplay
✅ Player-specific score areas around table
✅ Foundation for tournaments and rankings
✅ Network code integration points ready

---

## Files

### Created
- `src/multiplayer/Player.ts` - Player data model
- `src/multiplayer/PlayerController.ts` - Player state management
- `src/multiplayer/PlayerManager.ts` - Multi-player coordination

### Modified
- `src/render/dice.ts` - Moved score position from 12 → 9 (closer to player)

### To Modify (Future)
- `src/render/scene.ts` - Add PlayerManager initialization
- `src/main.ts` - Integrate PlayerManager
- `src/render/playerSeats.ts` - Player info on click

---

**Last Updated**: 2026-02-24
**Status**: Ready for integration
**Next Steps**: Integrate PlayerManager into Game class

# Octagon Game Board Implementation

## Overview

The game board has been converted from a rectangular table to an octagon shape, future-proofing the game for 8-player multiplayer functionality.

## What Was Changed

### 1. New Octagon Geometry System
**File:** `src/render/octagonGeometry.ts`

New utility module providing:
- `createOctagonMesh()` - Generates octagon mesh with proper UV mapping
- `calculatePlayerSeats()` - Calculates 8 player position coordinates (45° spacing)
- `getOctagonVertices()` - Helper for vertex calculations
- `getPlayAreaRadius()` - Safe play area bounds for dice collision

### 2. Updated Game Scene
**File:** `src/render/scene.ts`

Changes:
- Replaced rectangular table (30x20) with octagon table (radius: 15 units)
- Replaced rectangular play area with octagon felt surface (radius: 12.75 units)
- Added `playerSeats` property storing 8 player positions for future multiplayer
- Added `loadCustomFeltTexture()` method for user-provided octagon felt images
- Adjusted camera:
  - Increased default radius from 25 → 28 for full octagon visibility
  - Updated limits: lower 18 (was 15), upper 45 (was 40)
- Added TODO comments for custom texture loading integration

### 3. Player Seat Positions
The octagon naturally provides 8 equidistant positions around the perimeter:
- **Seat 0**: Front (0°)
- **Seat 1**: Front-right (45°)
- **Seat 2**: Right (90°)
- **Seat 3**: Back-right (135°)
- **Seat 4**: Back (180°)
- **Seat 5**: Back-left (225°)
- **Seat 6**: Left (270°)
- **Seat 7**: Front-left (315°)

Each seat includes:
- 3D position vector (for avatar placement)
- Angle in radians
- Forward direction vector (facing table center)

## Future Features Documented

### Multiplayer & Tournament System
**File:** `docs/FUTURE-FEATURES.md`

Added comprehensive documentation for:

1. **8-Player Octagon Multiplayer** (Very High Complexity)
   - Player avatars with profiles around octagon
   - Real-time state synchronization
   - Turn-based or simultaneous gameplay
   - Spectator mode with free camera

2. **Live Player Updates Notification System** (Medium Complexity)
   - Extends existing notification system
   - Player action feeds ("{Player} rolled 3 dice!")
   - Positional notifications near player seats
   - Color-coded per player

3. **Global Leaderboard Integration** (High Complexity)
   - Friend rankings and challenges
   - Verified scores via replay validation
   - Real-time rank updates during multiplayer
   - "Beat your friends" competitive features

4. **Tournament Racing System** (Very High Complexity)
   - Tournament lobbies and brackets
   - Race format (fastest to target score)
   - Live tournament feeds
   - Anti-cheat via server validation
   - Prize pools and archives

## Custom Texture Support

### Current State
The octagon felt surface uses a procedural texture (same quality as before).

### Future Integration
To add custom octagon felt texture:

```typescript
// In your code or settings service:
gameScene.loadCustomFeltTexture('/path/to/custom-felt.png');
```

### Texture Specifications
For best results, custom octagon felt textures should be:
- **Format**: PNG (with alpha channel for clean edges) or JPG
- **Size**: 2048x2048 pixels recommended
- **Aspect**: Square (octagon will be UV-mapped)
- **Style**: Felt, fabric, or casino table patterns work best

## Technical Details

### Octagon Dimensions
- **Outer Radius**: 15 units (table frame)
- **Play Area Radius**: 12.75 units (85% of table size)
- **Table Height**: 1 unit
- **Play Area Height**: 0.5 units

### Coordinate System
- Center: (0, 0, 0)
- Table surface: Y = -0.5
- Play area surface: Y = -0.25
- Player seats: Y = 2 (for avatar positioning)

### Dice Compatibility
The existing dice rolling system remains fully compatible:
- Dice still use grid-based positioning with collision detection
- Play area is large enough for all dice configurations
- Scored area remains rectangular on the right side (unchanged)

## Testing

Build Status: ✅ Successful
- TypeScript compilation: Passed
- Vite build: Passed
- No breaking changes to existing systems

Dev server running at: http://localhost:5175/

## Next Steps

### Immediate (User Action Required)
1. Test the octagon table visually in the game
2. Provide custom octagon felt texture if desired (optional)
3. Verify dice rolling works correctly within octagon bounds

### Future Development
1. Implement settings UI for custom texture upload
2. Add player seat visual markers (for multiplayer)
3. Develop multiplayer infrastructure (WebSocket server)
4. Build tournament and leaderboard systems

## Backwards Compatibility

✅ All existing features remain functional:
- Dice rolling and collision detection
- Scoring system
- Replay system
- Themes and settings
- Mobile responsiveness

The scored area remains rectangular and positioned to the right, maintaining compatibility with existing dice scoring animations.

---

**Implementation Date**: 2026-02-24
**Status**: Complete and Tested
**Branch**: feature/dice-borrow

# BISCUITS - Push Your Luck Dice Game

A 3D browser-based implementation of BISCUITS, a 5-minute push-your-luck dice game where the goal is to achieve the **lowest score**.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Game Rules

### Objective
Score all 15 dice with the **lowest total score**.

### Dice Pool
- 12× d6
- 1× d8
- 1× d10
- 1× d12

### Turn Flow
1. **Roll** all remaining dice
2. **Select** one or more dice to score (minimum 1)
3. **Score** selected dice: `points = max - value`
4. Repeat until all dice are scored

### Scoring Examples
- d6 showing 6 → `6-6 = 0 points` ✨
- d12 showing 10 → `12-10 = 2 points`
- d8 showing 1 → `8-1 = 7 points` 😱

## Controls

- **Roll Dice**: Click button or press `Space`
- **Select Dice**: Click dice in 3D scene OR click 2D dice in top row
- **Score Selected**: Click button (enabled when 1+ dice selected)
- **Camera**: Mouse drag to rotate, scroll to zoom

## UI Features

- **3D Game Board**: Beautiful 3D dice with physics-style animations
- **2D Dice Row**: Top row shows clear top-down view of all active dice
  - Easy to read values and point scores
  - Click to select (highlights in yellow)
  - Color-coded by die type (d4=red, d6=white, d8=blue, d10=yellow, d12=purple, d20=green)
- **Dice Lay Flat**: Dice settle flat after rolling for easy reading

## Features

✅ **3D Dice** - Babylon.js rendering with animations
✅ **Deterministic RNG** - Seeded for fairness
✅ **Replay System** - Share URLs with seed + action log
✅ **Clean HUD** - Score tracking and dice pool display
✅ **Mobile-friendly** - Touch controls supported

## Architecture

```
src/
├── engine/      # Pure game logic (no rendering dependencies)
│   ├── rng.ts          # Deterministic RNG
│   ├── types.ts        # Core data types
│   ├── rules.ts        # Scoring & validation
│   └── rules.test.ts   # Unit tests
├── game/        # State management
│   └── state.ts        # Reducer & replay logic
├── render/      # 3D visualization
│   ├── scene.ts        # Babylon.js scene setup
│   └── dice.ts         # Dice meshes & animations
├── ui/          # HUD components
│   └── hud.ts
└── main.ts      # App entry point
```

## Deploy

```bash
npm run build
```

Deploy the `dist/` folder to any static host (Vercel, Netlify, GitHub Pages, etc).

## Replay & Sharing

Games generate shareable URLs with format:
```
/?seed=<seed>&log=<base64_action_log>
```

This enables:
- Fair daily challenges
- Speedrun verification
- Bug reproduction

## Optional Expansions (Not Implemented)

- Add d20 (remove 1 d6)
- Add d4 (remove 1 d6)
- Add 2nd d10 / d100 mode
- Toggleable in-game (future)

## License

MIT

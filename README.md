# BISCUITS (AKA BITCHES)

A push-your-luck dice game where low score wins, friendships are tested, and your "safe" roll usually is not.

## Play Now

- Firebase (production): https://biscuits-488600.web.app
- Firebase (dev/staging): https://biscuits-488600.web.app
- GitHub Pages (fallback): https://colinmichaels.github.io/virtual-bitches/
- Feedback form: https://biscuits-488600.web.app/feedback

[![Alpha Warning - We Need Testers](https://storage.googleapis.com/biscuits-488600.firebasestorage.app/assets/ads/betahelp_ad.png)](https://biscuits-488600.web.app)

## Alpha Call For Testers

We want testers for gameplay feel, multiplayer sync, and mobile UX hardening.

- Break things: room joins, reconnects, turn rotation, session expiry flow.
- Stress things: theme switching, audio/settings, long multiplayer sessions.
- Drop quick feedback (no bug template needed): https://biscuits-488600.web.app/feedback
- Report bugs and weird behavior in GitHub Issues with steps/screenshots:
  https://github.com/colinmichaels/virtual-bitches/issues

If it gets weird, that is useful data.

## Quick Start (Dev)

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Rules (Short Version)

- Objective: score all 15 dice with the lowest total.
- Dice pool: `12x d6`, `1x d8`, `1x d10`, `1x d12`.
- Turn loop:
1. Roll remaining dice.
2. Select one or more dice to score.
3. Score selected dice using `points = maxFace - value`.
4. Repeat until all dice are scored.

Examples:

- `d6` rolled `6` -> `0` points (beautiful)
- `d12` rolled `10` -> `2` points (acceptable)
- `d8` rolled `1` -> `7` points (rough)

## Controls

- Roll: button or `Space`
- Select: click dice in 3D scene or in 2D dice row
- Score: button enabled when 1+ dice are selected
- Camera: drag to rotate, scroll/pinch to zoom

## Core Features

- 3D dice rendering + animation (Babylon.js)
- Deterministic RNG for fairness/replayability
- Replay/share flow via seed + action log
- Multiplayer room system with bot support
- Mobile-responsive HUD and settings/tutor flows
- CDN-ready runtime asset loading

## Project Layout

```text
src/
  engine/       # Pure rules + RNG + tests
  game/         # State and action flow
  multiplayer/  # Rooms, sync, turn flow
  render/       # Babylon scene + dice
  ui/           # HUD, modals, tutorial, notifications
  services/     # Audio, theme, settings, backend clients
```

## Build

```bash
npm run build
```

Deploy `dist/` to static hosting.

## Replay URL Format

```text
/?seed=<seed>&log=<base64_action_log>
```

## License

MIT

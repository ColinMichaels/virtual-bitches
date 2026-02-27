# Join The BISCUITS Dev Chaos

Welcome to **BISCUITS** (yes, also known as *that other name your grandmother would not approve of*).  
It is a browser-based, 3D, push-your-luck dice game where the **lowest score wins** and multiplayer can get delightfully unhinged.

## App Overview (Short + Useful)

- Built with **TypeScript + Vite + BabylonJS**
- Core game rules are deterministic (seeded RNG + replayable actions)
- Supports solo and multiplayer rooms, with ongoing chaos-mechanics expansion
- Frontend app plus a backend API/WebSocket server for multiplayer/session behavior

## Gameplay In 30 Seconds

1. Roll remaining dice.
2. Select one or more dice to bank.
3. Score them with `points = max face - rolled value`.
4. Repeat until all dice are scored.

High rolls are good. Low rolls are pain. Lowest total score wins.

## Where To Jump In

- Game shell/start flow: [src/main.ts](https://github.com/colinmichaels/virtual-bitches/blob/dev/src/main.ts)
- Runtime/game orchestration: [src/gameRuntime.ts](https://github.com/colinmichaels/virtual-bitches/blob/dev/src/gameRuntime.ts)
- Pure game rules/scoring: [src/engine/rules.ts](https://github.com/colinmichaels/virtual-bitches/blob/dev/src/engine/rules.ts)
- State + replay model: [src/game/state.ts](https://github.com/colinmichaels/virtual-bitches/blob/dev/src/game/state.ts)
- Multiplayer sync + sessions: [src/multiplayer/](https://github.com/colinmichaels/virtual-bitches/tree/dev/src/multiplayer)
- API server + bot engine: [api/](https://github.com/colinmichaels/virtual-bitches/tree/dev/api)
- 3D rendering pipeline: [src/render/](https://github.com/colinmichaels/virtual-bitches/tree/dev/src/render)
- UI/HUD/modals: [src/ui/](https://github.com/colinmichaels/virtual-bitches/tree/dev/src/ui)
- Chaos effects system (because peace is overrated): [src/chaos/](https://github.com/colinmichaels/virtual-bitches/tree/dev/src/chaos)

## Quick Start

- Setup + run instructions: [README.md](https://github.com/colinmichaels/virtual-bitches/blob/dev/README.md)
- Open issues to tackle: [GitHub Issues](https://github.com/colinmichaels/virtual-bitches/issues)

If you like game logic, networking edge cases, or making dice feel dramatic in 3D, you are in the right place.

# Unified Game Config (Solo + Multiplayer + Demo)

## Goal

Keep one gameplay contract for all modes, so solo, multiplayer, and demo can reuse the same game actions/animation flow and only vary by config.

## Current Scope

Phase 1 (implemented):

- Added `gameConfig` as an optional create-session payload contract.
- Kept legacy payload fields (`botCount`, `gameDifficulty`, `demoSpeedMode`) fully supported.
- Server normalizes `gameConfig` and maps it to existing runtime session controls.
- Session snapshots now include a derived `gameConfig` block for observability and debugging.

Not yet in this phase:

- Dedicated solo endpoint using `gameConfig`.
- Full capability-gating pipeline for chaos/gifting/moderation in one shared policy service.

## Config Shape

```json
{
  "mode": "multiplayer",
  "difficulty": "normal",
  "timingProfile": "standard",
  "capabilities": {
    "chaos": false,
    "gifting": false,
    "moderation": true,
    "banning": true,
    "hostControls": true,
    "privateChat": true
  },
  "automation": {
    "enabled": false,
    "autoRun": false,
    "botCount": 0,
    "speedMode": "normal"
  }
}
```

## Debug Checklist (Temporary)

1. Create a private multiplayer room with legacy fields only.
2. Create a private room with `gameConfig` only.
3. Create a private room with both legacy + `gameConfig` and confirm fallback behavior.
4. Verify `/api/health` and session snapshots are consistent with expected difficulty/bot/demo state.
5. Run:
   - `npm run test:backend-api`
   - `npm run test:session-service`
   - `npm run test:game-config`
   - `node --check api/server.mjs`
6. Run smoke in target env and confirm no regression in room lifecycle and winner queue lifecycle.

## Cleanup Plan (When Stable)

1. Remove temporary checklist items from this file and fold stable parts into permanent runbooks.
2. Deprecate direct legacy create fields once all clients send `gameConfig`.
3. Remove compatibility adapters and keep one normalized create-config input path.

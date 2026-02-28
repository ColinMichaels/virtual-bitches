# TODO Archive - 2026-02

This archive holds completed milestones retired from `docs/TODO.md` so the active backlog stays focused.

## 2026-02-28 - Multiplayer Room Channel Messaging Baseline

Moved from: `docs/TODO.md` -> `Multiplayer Room Channel Messaging (2026-02-27)`.

Completed:
- Added websocket `room_channel` messaging contract for `public` and `direct` channels.
- Routed turn nudge actions through direct room-channel delivery.
- Added player send shortcuts:
  - `M` for public room messages
  - `W` for direct whispers
- Added server-side moderation/privacy checks:
  - deny-list senders via `MULTIPLAYER_ROOM_CHANNEL_BAD_PLAYER_IDS`
  - deny-list content via `MULTIPLAYER_ROOM_CHANNEL_BAD_TERMS`
  - enforce per-player block-list rules on both direct and public message delivery
- Added `blockedPlayerIds` support to player profile/session ingestion paths.

## 2026-02-28 - Multiplayer Player Interaction Scaffold

Moved from: `docs/TODO.md` -> `Multiplayer Player Interaction Menu Scaffold (2026-02-28)`.

Completed:
- Added multiplayer player chips adjacent to dice-row as a quick interaction rail.
- Routed remote avatar/seat clicks to the same interaction menu used by chips.
- Added interaction actions:
  - Whisper
  - View profile/stats
  - Cause chaos (camera attack send flow)
  - Nudge turn
- Scaffolded out-of-scope actions as disabled with tooltip:
  - Send Gift (`Coming soon`)
  - Add Friend (`Coming soon`)
- Extracted player interaction rail/modal into dedicated UI module:
  - `src/ui/playerInteractions.ts`

## 2026-02-28 - Multiplayer Post-Round Queue Lifecycle Baseline

Moved from: `docs/TODO.md` -> `Multiplayer Post-Round Queue + Lifecycle (2026-02-27)`.

Completed:
- Winner-only end-game action added: `Wait for Next Game` (winner can re-seat and queue from modal).
- Added queue intent endpoint: `POST /api/multiplayer/sessions/:sessionId/queue-next`.
- Added post-round lifecycle server timers:
  - auto-start next game after 60s (configurable)
  - room expiry after 2m post-round inactivity (configurable)
- Added room-wide broadcasts for:
  - round winner + score
  - next-game pending message
  - 10-second next-game countdown
  - next-game started
- Added client-side countdown notification + short beep/click cue handling.
- Added queue-next client/service test coverage (`backendApi` + `sessionService`).
- Added local API e2e smoke coverage for winner queue lifecycle (`queue-next` -> auto-restart round).

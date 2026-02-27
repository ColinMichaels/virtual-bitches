# BISCUITS - Session Summary
**Date:** February 27, 2026  
**Focus:** Camera-assist UX, release-note linkability, multiplayer room/channel reliability, and lobby UX hardening

---

## Delivered

### Multiplayer Lobby Overlay + Room Browser Refresh
- Converted splash multiplayer options into an overlay panel so controls remain centered and visible across viewport sizes.
- Kept `Join Game` fixed in modal footer (desktop + mobile), with disabled state until room/code selection is valid.
- Reworked available rooms into card-grid layout with clearer hierarchy and stronger text treatment.
- Added room-card difficulty badges and palette mapping:
  - easy -> success/green
  - normal -> warning/yellow
  - hard -> error/red
- Added room filters and pagination (search, type, difficulty, minimum players) with conditional pagination visibility.
- Added loading/no-results placeholders so filter changes do not collapse layout or cause jumpy modal height.
- Added create-room separation with private-room toggle and conditional room-name/player-limit inputs.
- Moved join-bot seeding controls to lower advanced section to reduce top-of-panel clutter.
- Updated multiplayer modal controls:
  - close uses standard modal `X`
  - refresh uses compact shared icon button

### Multiplayer Difficulty + Lifecycle Reliability
- Extended multiplayer room/session difficulty handling to support `easy`, `normal`, and `hard` room-level play.
- Enforced room-selected difficulty when joining existing multiplayer rooms.
- Updated queue seeding/replenishment to maintain baseline public room availability across difficulty tiers.
- Removed redundant clock label copy and ensured multiplayer timer display resets from each new game start.
- Tightened stale session/player cleanup paths and bot timeout auto-disconnect behavior.

### Camera and Turn-Focus UX
- Added explicit `+`/`=` forward and `-` backward cycling for gameplay focus.
- Added waiting-turn seat focus cycling for multiplayer lock states.
- Extended camera range/angle limits for better visibility of other seats.
- Added smooth camera return-to-overview after scoring when camera assist is active.
- Added Easy-mode-only camera assist toggle (disabled outside Easy mode).

### Updates / Release Notes Pipeline
- Extended git-derived update payload entries with commit link metadata.
- Added PR metadata extraction (when detectable from commit subject/body).
- Rendered clickable commit/PR links in the in-game `Game Updates` panel.

### Documentation + Tracking Cleanup
- Refreshed `docs/TODO.md` project status line to current version context.
- Added a concise finish-up shortlist for next iteration planning.
- Marked commit-link release-note tasks as complete.
- Added explicit lobby/difficulty pass documentation and follow-up testing tasks.
- Refined splash onboarding UX:
  - removed persistent splash `Replay Tutorial` button
  - kept tutorial replay entry at top of `How To Play` modal
  - added splash language switcher with confirm-before-switch + reload behavior
  - applied flagged/branded language selector styling for improved readability (splash + settings)

### Notification UX
- Updated floating notifications to support wrapped content instead of clipping.
- Added optional secondary/detail line rendering with smaller typography for contextual follow-up info.
- Updated notification stacking to use measured toast height so multiline notifications do not overlap.

### Multiplayer Messaging + Moderation Foundation
- Added player room-channel messaging flow (`public` + `direct`) over multiplayer websocket transport.
- Added player-facing keyboard shortcuts for quick compose:
  - `M` = public room message
  - `W` = direct whisper
- Unified nudge delivery onto room-channel direct messages so targeted delivery is explicit.
- Added server moderation and privacy enforcement for room-channel messages:
  - sender deny list support (`MULTIPLAYER_ROOM_CHANNEL_BAD_PLAYER_IDS`)
  - blocked-term filter support (`MULTIPLAYER_ROOM_CHANNEL_BAD_TERMS`)
  - per-player block-list checks for both direct whispers and public room broadcasts
- Extended profile/session plumbing for persisted `blockedPlayerIds` and documented the new contract.

### Multiplayer Round Lifecycle + Winner Queue Flow
- Added winner-only end-game action: `Wait for Next Game`.
  - Winning player can explicitly re-seat and queue for the next round from the end-game modal.
  - Local UI now hides `New Game` and shows `Wait for Next Game` for eligible winner state only.
- Added queue-next multiplayer API contract:
  - `POST /api/multiplayer/sessions/:sessionId/queue-next`
  - Auth-validated per-player queue intent, with structured reasons (`session_expired`, `round_in_progress`, etc.).
- Added post-round room lifecycle timers on server:
  - auto-start next game after 60 seconds (`MULTIPLAYER_NEXT_GAME_DELAY_MS`)
  - expire room after 2 minutes of no post-game player activity (`MULTIPLAYER_POST_GAME_INACTIVITY_TIMEOUT_MS`)
- Added room-channel system broadcasts for round flow:
  - winner announcement with score
  - next-game pending notice
  - 10-second countdown notices (`next_game_countdown`)
  - next-game start notice when new round begins
- Added client countdown feedback:
  - short notification cadence for countdown messages
  - per-second countdown click/beep cue during the final 10 seconds.
- Added/extended regression coverage:
  - `backendApi` queue-next endpoint request coverage
  - `MultiplayerSessionService` queue-next sync + session-expired behavior coverage.
  - Local API e2e smoke coverage for winner queue lifecycle (`queue-next` and auto-restart validation).

---

## Review Snapshot

### Build Health
- `npm run build` passes after camera-assist and updates-link changes.

### Known Remaining Risk Areas
- Splash theme parity still needs mesh reload logic when theme `meshFile` changes.
- Splash material load path still needs timeout/fallback hardening.
- Release-note generator still needs graceful no-git fallback mode.
- Themeability audit remains incomplete for some UI elements/states.

---

## Next Finish-Up Priorities
1. Splash dice theme parity + texture fallback hardening.
2. Release-note generator no-git fallback and commit filtering options.
3. CSS/token standardization pass for remaining controls and surfaces.
4. Regression tests for new camera/focus behaviors.
5. Device QA pass (mobile/tablet focus, updates link UX, camera flows).

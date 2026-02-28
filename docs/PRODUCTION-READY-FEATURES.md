# Production-Ready Features

This document tracks features that are considered stable defaults in production.
These are no longer active TODO items unless regression or redesign is requested.

## Multiplayer Interaction Panel (Stable)

Scope:
- Player chips adjacent to dice-row.
- Unified player interaction modal for chip clicks and avatar/seat clicks.
- Action set:
  - Whisper
  - View profile/stats
  - Cause chaos
  - Nudge turn
- Out-of-scope scaffold actions (disabled with tooltip):
  - Send Gift
  - Add Friend

Implementation:
- `src/ui/playerInteractions.ts`
- Runtime integration in `src/gameRuntime.ts`

## Multiplayer Room Lifecycle Baseline (Stable)

Scope:
- Winner queue flow for next round (`queue-next`).
- Auto-start next game cycle after delay.
- Room expiry lifecycle after inactivity.
- Room countdown/next-game notifications.

Primary references:
- `docs/TODO-ARCHIVE-2026-02.md`
- `api/e2e/smoke.mjs`

## Auto Seat/Ready Baseline (Stable Default)

Default behavior:
- Multiplayer join defaults to auto-sit + auto-ready enabled.

Testing/ops variable:
- `VITE_MULTIPLAYER_AUTO_SEAT_READY_ENABLED` can disable globally for rollback/testing.

Reference:
- `docs/ENVIRONMENT-REFERENCE.md`

## Turn Sync Watchdog Baseline (Stable Default)

Runtime defaults:
- stale detection and resync cooldowns are stable for production under current architecture.

These remain tunable in code for future tests/experiments:
- `TURN_SYNC_WATCHDOG_INTERVAL_MS`
- `TURN_SYNC_STALE_MS`
- `TURN_SYNC_REQUEST_COOLDOWN_MS`
- `TURN_SYNC_STALE_RECOVERY_MS`

Reference:
- `src/gameRuntime.ts`

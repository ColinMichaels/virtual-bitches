# Multiplayer Chat Conduct Service Plan

## Scope

This document defines the moderation contract for multiplayer chat conduct.
Current implementation is an in-process bootstrap, intentionally isolated so it can be extracted into a standalone API service later.

## Current Bootstrap (In Process)

- Module: `api/moderation/chatConduct.mjs`
- Integration point: `relayRealtimeSocketMessage(...)` in `api/server.mjs`
- First-pass enforcement:
  - public room-channel profanity filter (default)
  - warning payload to offending player
  - strike tracking in session state
  - temporary chat mute when strike threshold is reached
  - optional auto-room-ban escalation after total-strike threshold
- Admin moderation scaffolds:
  - `GET /api/admin/sessions/:sessionId/conduct`
  - `GET /api/admin/sessions/:sessionId/conduct/players/:playerId`
  - `POST /api/admin/sessions/:sessionId/conduct/players/:playerId/clear`
  - `POST /api/admin/sessions/:sessionId/conduct/clear`

## Session State Contract

Session object carries:

```json
{
  "chatConductState": {
    "version": 1,
    "players": {
      "<playerId>": {
        "strikeEvents": [1700000000000],
        "totalStrikes": 1,
        "lastViolationAt": 1700000000000,
        "mutedUntil": 0
      }
    }
  }
}
```

## Evaluation Contract (Service-Oriented Shape)

Target request/response shape for future extraction:

```json
{
  "request": {
    "sessionId": "<sessionId>",
    "playerId": "<playerId>",
    "channel": "public",
    "message": "string",
    "now": 1700000000000
  },
  "response": {
    "allowed": false,
    "code": "room_channel_message_blocked",
    "reason": "conduct_violation",
    "strikeCount": 2,
    "strikeLimit": 3,
    "totalStrikes": 4,
    "mutedUntil": 1700000300000,
    "shouldAutoBan": false
  }
}
```

## Environment Knobs

- `MULTIPLAYER_CHAT_CONDUCT_ENABLED` (`1` default, `0` disables)
- `MULTIPLAYER_CHAT_CONDUCT_PUBLIC_ONLY` (`1` default, `0` applies to direct too)
- `MULTIPLAYER_CHAT_BANNED_TERMS` (comma/space-delimited list)
- `MULTIPLAYER_CHAT_STRIKE_LIMIT` (default `3`)
- `MULTIPLAYER_CHAT_STRIKE_WINDOW_MS` (default `900000`)
- `MULTIPLAYER_CHAT_MUTE_MS` (default `300000`)
- `MULTIPLAYER_CHAT_AUTO_ROOM_BAN_STRIKE_LIMIT` (default `0`, disabled)

If `MULTIPLAYER_CHAT_BANNED_TERMS` is unset, server falls back to `MULTIPLAYER_ROOM_CHANNEL_BAD_TERMS`.

## Next Steps

1. Add richer term severity categories and per-room policy overrides.
2. Add mute-expiry and auto-ban edge-case integration coverage for CI.
3. Move evaluation and policy state to a dedicated moderation service with API auth, audit logs, and rate limiting.

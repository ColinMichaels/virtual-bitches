# Multiplayer Chat Conduct Service Plan

## Scope

This document defines the moderation contract for multiplayer chat conduct.
Current implementation is an in-process service bootstrap, intentionally isolated so it can be extracted into a standalone API service later.

## Current Bootstrap (In Process)

- Modules:
  - `api/moderation/chatConduct.mjs` (strike/mute evaluation)
  - `api/moderation/termService.mjs` (seed + managed + remote term aggregation)
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
  - `GET /api/admin/moderation/terms`
  - `POST /api/admin/moderation/terms/upsert`
  - `POST /api/admin/moderation/terms/remove`
  - `POST /api/admin/moderation/terms/refresh`
- E2E coverage:
  - `E2E_ASSERT_ADMIN_MODERATION_TERMS=1` validates moderation term overview/upsert/remove/refresh contract.

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
- `MULTIPLAYER_CHAT_TERMS_SERVICE_URL` (optional remote term feed URL)
- `MULTIPLAYER_CHAT_TERMS_SERVICE_API_KEY` (optional remote auth token)
- `MULTIPLAYER_CHAT_TERMS_SERVICE_API_KEY_HEADER` (optional auth header name, default `x-api-key`)
- `MULTIPLAYER_CHAT_TERMS_REFRESH_MS` (remote poll interval in ms; default `60000` when URL set)
- `MULTIPLAYER_CHAT_TERMS_FETCH_TIMEOUT_MS` (remote fetch timeout in ms, default `6000`)
- `MULTIPLAYER_CHAT_TERMS_SYNC_ON_BOOT` (`1` default; `0` disables bootstrap sync)
- `MULTIPLAYER_CHAT_TERMS_MAX_MANAGED` (max managed terms, default `2048`)
- `MULTIPLAYER_CHAT_TERMS_MAX_REMOTE` (max remote terms, default `4096`)

If `MULTIPLAYER_CHAT_BANNED_TERMS` is unset, server falls back to `MULTIPLAYER_ROOM_CHANNEL_BAD_TERMS`.

## Next Steps

1. Add richer term severity categories and per-room policy overrides.
2. Add dedicated role-based (no admin-token) moderation-term smoke variant.
3. Move in-process term + strike state to an external moderation service with API auth, audit logs, and rate limiting.

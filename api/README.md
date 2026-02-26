# BISCUITS Backend Skeleton

This folder contains a minimal backend scaffold for local development and contract iteration.

## Run

```bash
npm run api:dev
```

Environment variables:

- `PORT` (default: `3000`)
- `WS_BASE_URL` (default: `ws://localhost:3000`)

## Storage

- Runtime store file: `api/data/store.json`
- SQL schema reference: `api/db/schema.sql`
- First migration scaffold: `api/db/migrations/001_init.sql`

The running server uses JSON-file persistence for now. SQL files define the intended production schema.

## Endpoints

- `GET /api/health`
- `POST /api/auth/token/refresh`
- `GET /api/players/:playerId/profile`
- `PUT /api/players/:playerId/profile`
- `POST /api/logs/batch`
- `POST /api/multiplayer/sessions`
- `POST /api/multiplayer/sessions/:sessionId/join`
- `POST /api/multiplayer/sessions/:sessionId/heartbeat`
- `POST /api/multiplayer/sessions/:sessionId/leave`
- `POST /api/multiplayer/sessions/:sessionId/auth/refresh`

## Notes

- Auth contract is bearer token based with refresh token rotation.
- Session creation/join returns:
  - `playerToken` for WS query auth
  - `auth` bundle (`accessToken`, `refreshToken`, `expiresAt`, `tokenType`)
- WS server is not implemented in this folder yet; this scaffold provides the HTTP/session contracts only.

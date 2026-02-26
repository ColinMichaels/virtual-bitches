# BISCUITS Backend Skeleton

This folder contains a minimal backend scaffold for local development and contract iteration.

## Run

```bash
npm run api:dev
```

Environment variables:

- `PORT` (default: `3000`)
- `WS_BASE_URL` (default: `ws://localhost:3000`)
- `FIREBASE_PROJECT_ID` (recommended for Firebase ID token audience validation)
- `FIREBASE_WEB_API_KEY` (required for Firebase `accounts:lookup` ID token validation)

## Storage

- Runtime store file: `api/data/store.json`
- SQL schema reference: `api/db/schema.sql`
- First migration scaffold: `api/db/migrations/001_init.sql`

The running server uses JSON-file persistence for now. SQL files define the intended production schema.

## Endpoints

- `GET /api/health`
- `POST /api/auth/token/refresh`
- `GET /api/auth/me`
- `GET /api/players/:playerId/profile`
- `PUT /api/players/:playerId/profile`
- `POST /api/logs/batch`
- `POST /api/leaderboard/scores`
- `GET /api/leaderboard/global`
- `POST /api/multiplayer/sessions`
- `POST /api/multiplayer/sessions/:sessionId/join`
- `POST /api/multiplayer/sessions/:sessionId/heartbeat`
- `POST /api/multiplayer/sessions/:sessionId/leave`
- `POST /api/multiplayer/sessions/:sessionId/auth/refresh`

## Notes

- Auth contract is bearer token based with refresh token rotation.
- Global leaderboard score submissions require non-anonymous Firebase-authenticated users.
- `/api/auth/me` supports:
  - `GET` to inspect authenticated account profile
  - `PUT` with `{ "displayName": "<name>" }` to set leaderboard name
- Session creation/join returns:
  - `playerToken` for WS query auth
  - `auth` bundle (`accessToken`, `refreshToken`, `expiresAt`, `tokenType`)
- `GET /api/players/:playerId/profile` returns `204 No Content` when profile does not exist yet.
- WS endpoint is available at `/` and expects query params:
  - `session=<sessionId>`
  - `playerId=<playerId>`
  - `token=<playerToken or auth.accessToken>`
- Supported WS message types for relay:
  - `chaos_attack`
  - `particle:emit`
- Leaderboard ordering is deterministic:
  1. Lower score first
  2. Lower duration first
  3. Fewer rolls first
  4. Earlier timestamp first
  5. Lexicographic score id tie-breaker
- Backend retains top `200` leaderboard entries.

## E2E Smoke Tests

Local end-to-end smoke test (starts API server automatically):

```bash
npm run test:e2e:api:local
```

Smoke test against deployed API/Cloud Run:

```bash
E2E_API_BASE_URL="https://<your-cloud-run-host>" npm run test:e2e:api
```

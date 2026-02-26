# BISCUITS Backend Skeleton

This folder contains a minimal backend scaffold for local development and contract iteration.

## Run

```bash
npm run api:dev
```

Environment variables:

- `PORT` (default: `3000`)
- `WS_BASE_URL` (default: `ws://localhost:3000`)
- `API_STORE_BACKEND` (`file` or `firestore`, default: `file`)
- `API_FIRESTORE_PREFIX` (Firestore collection prefix, default: `api_v1`)
- `FIREBASE_PROJECT_ID` (recommended for Firebase token audience validation)
- `FIREBASE_AUTH_MODE` (`auto`, `admin`, or `legacy`, default: `auto`)
- `FIREBASE_SERVICE_ACCOUNT_JSON` (optional inline service account JSON for Admin SDK init)
- `FIREBASE_WEB_API_KEY` (required only for legacy lookup fallback mode)

## Storage

- Runtime store file: `api/data/store.json`
- SQL schema reference: `api/db/schema.sql`
- First migration scaffold: `api/db/migrations/001_init.sql`

Storage backends:

- `file` backend (`API_STORE_BACKEND=file`): JSON file persistence at `api/data/store.json`
- `firestore` backend (`API_STORE_BACKEND=firestore`): Firestore collections with prefix `API_FIRESTORE_PREFIX`

SQL files define the intended longer-term relational schema.

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
- Firebase token verification now supports Admin SDK mode (`FIREBASE_AUTH_MODE=admin`) with strict audience/issuer checks.
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
  - `game_update` (`title` + `content` required)
  - `player_notification` (`message` required, optional `targetPlayerId`)
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

## File Store -> Firestore Migration (Sprint 1.5)

Install API dependencies (required for `firebase-admin`):

```bash
npm --prefix api install
```

Run migration in safe `merge` mode (default):

```bash
npm run api:migrate:firestore
```

Verification-only run:

```bash
npm run api:migrate:firestore:verify
```

Useful flags:

```bash
node api/scripts/migrate-file-store-to-firestore.mjs --mode replace --prefix api_v1 --project <project-id>
```

Notes:
- `merge` mode keeps existing Firestore records and overlays source file values.
- `replace` mode makes Firestore match the source store snapshot exactly.
- Expired access/refresh tokens and sessions are pruned by default during migration.

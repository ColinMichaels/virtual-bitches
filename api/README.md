# BISCUITS Backend Skeleton

This folder contains a minimal backend scaffold for local development and contract iteration.

## Run

```bash
npm run api:dev
```

Environment variables:

- `PORT` (default: `3000`)
- `WS_BASE_URL` (default: `ws://localhost:3000`)
- `API_STORE_BACKEND` (`file` or `firestore`, default: `firestore` in production, `file` otherwise)
- `API_ALLOW_FILE_STORE_IN_PRODUCTION` (`1` to override safety check; default: disabled)
- `API_FIRESTORE_PREFIX` (Firestore collection prefix, default: `api_v1`)
- `API_BOOTSTRAP_WAIT_TIMEOUT_MS` (request wait window while startup bootstrap is still running, default: `20000`)
- `API_BOOTSTRAP_RETRY_DELAY_MS` (retry delay after bootstrap failure, default: `5000`)
- `API_DEPLOY_PRESERVE_DB` (deploy helper flag, default: `1`; keeps Firestore backend pinned during deploy)
- `TURN_TIMEOUT_MS` (active turn timeout window, default: `45000`)
- `TURN_TIMEOUT_WARNING_MS` (pre-timeout warning lead, default: `10000`)
- `MULTIPLAYER_PARTICIPANT_STALE_MS` (disconnect grace window before stale player pruning, default: `45000`)
- `MULTIPLAYER_CLEANUP_INTERVAL_MS` (background sweep interval for stale players/sessions, default: `15000`)
- `PUBLIC_ROOM_MIN_PER_DIFFICULTY` (minimum joinable public rooms per difficulty lane, default: `1`)
- `FIREBASE_PROJECT_ID` (recommended for Firebase token audience validation)
- `FIREBASE_AUTH_MODE` (`auto`, `admin`, or `legacy`, default: `auto`)
- `FIREBASE_SERVICE_ACCOUNT_JSON` (optional inline service account JSON for Admin SDK init)
- `FIREBASE_WEB_API_KEY` (required only for legacy lookup fallback mode)
- `API_ADMIN_ACCESS_MODE` (`auto`, `open`, `token`, `role`, `hybrid`, or `disabled`; default: `auto`)
- `API_ADMIN_TOKEN` (required when `API_ADMIN_ACCESS_MODE=token`; optional in `auto`)
- `API_ADMIN_OWNER_UIDS` (comma/space-delimited Firebase UID allowlist bootstrapped as `owner`)
- `API_ADMIN_OWNER_EMAILS` (comma/space-delimited email allowlist bootstrapped as `owner`)
- `MULTIPLAYER_ROOM_CHANNEL_BAD_PLAYER_IDS` (legacy denylist of room-channel senders)
- `MULTIPLAYER_ROOM_CHANNEL_BAD_TERMS` (legacy blocked term list; used as fallback for chat conduct terms)
- `MULTIPLAYER_CHAT_CONDUCT_ENABLED` (`1` default; `0` disables chat conduct checks)
- `MULTIPLAYER_CHAT_CONDUCT_PUBLIC_ONLY` (`1` default; `0` applies checks to direct channel too)
- `MULTIPLAYER_CHAT_BANNED_TERMS` (comma/space-delimited blocked term list)
- `MULTIPLAYER_CHAT_STRIKE_LIMIT` (strike threshold before temporary mute, default: `3`)
- `MULTIPLAYER_CHAT_STRIKE_WINDOW_MS` (rolling strike window, default: `900000`)
- `MULTIPLAYER_CHAT_MUTE_MS` (temporary mute duration, default: `300000`)
- `MULTIPLAYER_CHAT_AUTO_ROOM_BAN_STRIKE_LIMIT` (optional auto-ban threshold; default: `0` disabled)
- `MULTIPLAYER_CHAT_TERMS_SERVICE_URL` (optional remote moderation-term endpoint returning JSON list)
- `MULTIPLAYER_CHAT_TERMS_SERVICE_API_KEY` (optional API key for remote moderation-term endpoint)
- `MULTIPLAYER_CHAT_TERMS_SERVICE_API_KEY_HEADER` (optional API key header name, default: `x-api-key`)
- `MULTIPLAYER_CHAT_TERMS_REFRESH_MS` (remote refresh interval in ms, default: `60000` when service URL is set)
- `MULTIPLAYER_CHAT_TERMS_FETCH_TIMEOUT_MS` (remote fetch timeout in ms, default: `6000`)
- `MULTIPLAYER_CHAT_TERMS_SYNC_ON_BOOT` (`1` default; `0` skips bootstrap remote sync)
- `MULTIPLAYER_CHAT_TERMS_MAX_MANAGED` (max managed terms stored by API, default: `2048`)
- `MULTIPLAYER_CHAT_TERMS_MAX_REMOTE` (max remote terms ingested per refresh, default: `4096`)

## Storage

- Runtime store file: `api/data/store.json`
- SQL schema reference: `api/db/schema.sql`
- First migration scaffold: `api/db/migrations/001_init.sql`

Storage backends:

- `file` backend (`API_STORE_BACKEND=file`): JSON file persistence at `api/data/store.json` (not recommended for production)
- `firestore` backend (`API_STORE_BACKEND=firestore`): Firestore collections with prefix `API_FIRESTORE_PREFIX`

SQL files define the intended longer-term relational schema.

## Cloud Run Deploy Safety

Use the root deploy helper:

```bash
npm run cloudrun:deploy:api
```

Defaults:

- `API_DEPLOY_PRESERVE_DB=1` (default) sets `API_STORE_BACKEND=firestore` so redeploys do not reset API data.
- `API_FIRESTORE_PREFIX=api_v1` (override if needed to keep your existing collection namespace).

If you intentionally want non-persistent file storage in production (not recommended), explicitly disable preservation and opt in:

```bash
API_DEPLOY_PRESERVE_DB=0 API_STORE_BACKEND=file API_ALLOW_FILE_STORE_IN_PRODUCTION=1 npm run cloudrun:deploy:api
```

## Endpoints

- `GET /api/health`
- `GET /api/ready` (returns `200` only when bootstrap is ready and shutdown is not in progress; `503` otherwise)
- `POST /api/auth/token/refresh`
- `GET /api/auth/me`
- `GET /api/players/:playerId/profile`
- `PUT /api/players/:playerId/profile`
- `GET /api/players/:playerId/scores`
- `POST /api/players/:playerId/scores/batch`
- `POST /api/logs/batch`
- `POST /api/leaderboard/scores`
- `GET /api/leaderboard/global`
- `GET /api/admin/overview`
- `GET /api/admin/rooms`
- `GET /api/admin/metrics`
- `GET /api/admin/storage`
- `GET /api/admin/moderation/terms`
- `POST /api/admin/moderation/terms/upsert`
- `POST /api/admin/moderation/terms/remove`
- `POST /api/admin/moderation/terms/refresh`
- `GET /api/admin/audit`
- `GET /api/admin/roles`
- `PUT /api/admin/roles/:uid`
- `POST /api/admin/sessions/:sessionId/expire`
- `POST /api/admin/sessions/:sessionId/participants/:playerId/remove`
- `POST /api/admin/sessions/:sessionId/channel/messages`
- `GET /api/admin/sessions/:sessionId/conduct`
- `GET /api/admin/sessions/:sessionId/conduct/players/:playerId`
- `POST /api/admin/sessions/:sessionId/conduct/players/:playerId/clear`
- `POST /api/admin/sessions/:sessionId/conduct/clear`
- `POST /api/multiplayer/sessions`
- `POST /api/multiplayer/sessions/:sessionId/join`
- `POST /api/multiplayer/rooms/:roomCode/join`
- `POST /api/multiplayer/sessions/:sessionId/heartbeat`
- `POST /api/multiplayer/sessions/:sessionId/moderate`
- `POST /api/multiplayer/sessions/:sessionId/leave`
- `POST /api/multiplayer/sessions/:sessionId/auth/refresh`

Planned (not implemented yet):

- `GET /api/social/friends`
- `POST /api/social/friends/requests`
- `POST /api/social/presence/heartbeat`
- `POST /api/social/invites/room`

## Notes

- Auth contract is bearer token based with refresh token rotation.
- Firebase token verification now supports Admin SDK mode (`FIREBASE_AUTH_MODE=admin`) with strict audience/issuer checks.
- Global leaderboard score submissions require non-anonymous Firebase-authenticated users.
- `/api/auth/me` supports:
  - `GET` to inspect authenticated account profile
  - `PUT` with `{ "displayName": "<name>" }` to set leaderboard name
  - profile payload includes provider details (`provider`, `providerId`) and optional `photoUrl` from social auth
- `/api/players/:playerId/profile` accepts optional `blockedPlayerIds: string[]` to persist multiplayer chat block preferences.
- Session creation/join returns:
  - `playerToken` for WS query auth
  - `auth` bundle (`accessToken`, `refreshToken`, `expiresAt`, `tokenType`)
  - `ownerPlayerId` for private room moderation ownership
  - `participants[]` snapshot (`playerId`, `displayName`, optional `avatarUrl`, optional `providerId`, `isBot`, `joinedAt`, `lastHeartbeatAt`)
  - `turnState` snapshot (`order[]`, `activeTurnPlayerId`, `round`, `turnNumber`, `phase`, `activeRollServerId`, optional `activeRoll`, `updatedAt`)
- `POST /api/multiplayer/sessions` accepts optional `displayName`, `avatarUrl`, `providerId`, and `botCount` (`0..4`) to seed the local participant profile and bot seats.
- `POST /api/multiplayer/sessions/:sessionId/join` and `POST /api/multiplayer/rooms/:roomCode/join` accept optional `displayName`, `avatarUrl`, `providerId`, and `botCount` (`0..4`) to update joining participant profile data and seed bots into an existing room.
- Join can return `room_banned` when the player has been room-banned by the room owner/admin.
- Multiplayer mutation endpoints now require a valid session bearer token:
  - `POST /api/multiplayer/sessions/:sessionId/heartbeat`
  - `POST /api/multiplayer/sessions/:sessionId/participant-state`
  - `POST /api/multiplayer/sessions/:sessionId/queue-next`
  - `POST /api/multiplayer/sessions/:sessionId/auth/refresh`
  - owner path for `POST /api/multiplayer/sessions/:sessionId/moderate`
- `POST /api/multiplayer/sessions/:sessionId/moderate` accepts:
  - `{ requesterPlayerId, targetPlayerId, action }`
  - `action`: `kick` or `ban`
  - allowed for private-room owner; admins/operators can also moderate via existing admin auth paths
  - `ban` removes the player (if present) and blocks rejoin for that room session
- Join payloads also accept optional `gameDifficulty` (`easy` | `normal` | `hard`) and apply it only when a legacy room snapshot is missing a valid stored difficulty.
- Bot turn strategy is isolated in [`api/bot/engine.mjs`](./bot/engine.mjs) behind `createBotEngine()` so implementations can be swapped without rewriting websocket/session orchestration.
- Admin endpoints include monitoring plus role management scaffolds:
  - In `auto` mode:
    - when `API_ADMIN_TOKEN` is set: `hybrid` (token or role)
    - otherwise: role-based in production, and role-based in non-production when bootstrap owners are configured (fallback `open`)
  - Role mode requires Firebase-authenticated users with assigned roles (`viewer`, `operator`, `owner`).
  - `owner` role can assign/revoke roles via `PUT /api/admin/roles/:uid`.
  - `operator` and `owner` may run room control mutations:
    - expire room session
    - remove participant from room
    - send room channel messages (`public` broadcast or `direct` to `targetPlayerId`)
    - review/clear room chat-conduct state:
      - `GET /api/admin/sessions/:sessionId/conduct`
      - `GET /api/admin/sessions/:sessionId/conduct/players/:playerId`
      - `POST /api/admin/sessions/:sessionId/conduct/players/:playerId/clear`
      - `POST /api/admin/sessions/:sessionId/conduct/clear`
    - manage chat moderation term service:
      - `GET /api/admin/moderation/terms` (`includeTerms=1` to include full term lists)
      - `POST /api/admin/moderation/terms/upsert`
      - `POST /api/admin/moderation/terms/remove`
      - `POST /api/admin/moderation/terms/refresh`
  - `GET /api/admin/storage` exposes active persistence backend + section counts for audit checks.
  - Admin metrics now include cumulative turn auto-advance counters for timeout advances and bot advances.
  - Mutation actions are written to admin audit logs and exposed via `GET /api/admin/audit`.
  - Pass `x-admin-token: <token>` (or bearer token) when token mode is enabled.
- Current multiplayer orchestration is server-process authoritative (in-memory + persisted snapshots). Keep Cloud Run API single-instance until distributed room coordination is introduced.
- Friends/presence architecture plan lives in `docs/FRIENDS-SYSTEM-PLAN.md`; endpoints above are intentionally deferred until multiplayer stability gate completion.
- `GET /api/players/:playerId/profile` returns `204 No Content` when profile does not exist yet.
- `GET /api/players/:playerId/scores` returns server-synced personal score history with aggregate stats.
  - This read endpoint is public (no auth required) so leaderboard/personal history views remain available for guests and stale session clients.
- `POST /api/players/:playerId/scores/batch` upserts score records for the specified player and trims to the best `500` entries per player.
- WS endpoint is available at `/` and expects query params:
  - `session=<sessionId>`
  - `playerId=<playerId>`
  - `token=<playerToken or auth.accessToken>`
  - Supported WS message types for relay:
  - `chaos_attack`
  - `particle:emit`
  - `game_update` (`title` + `content` required)
  - `player_notification` (`message` required, optional `targetPlayerId`)
  - `room_channel` (`channel: "public" | "direct"`, `message` required, `targetPlayerId` required for `direct`)
    - server enforces block lists for sender/recipient visibility
    - server applies chat conduct middleware (`api/moderation/chatConduct.mjs`) with warning/strike/mute flow
    - blocked terms are resolved from `api/moderation/termService.mjs` (seed + managed + optional remote feed)
    - server can reject sender/message via moderation lists:
      - `MULTIPLAYER_ROOM_CHANNEL_BAD_PLAYER_IDS` (legacy sender denylist)
      - `MULTIPLAYER_CHAT_BANNED_TERMS` (or fallback `MULTIPLAYER_ROOM_CHANNEL_BAD_TERMS`)
    - room-channel rejection codes include:
      - `room_channel_message_blocked` (conduct violation)
      - `room_channel_sender_muted` (temporary mute active)
  - direct/broadcast realtime payloads (`player_notification`, `game_update`, `room_channel`) are filtered by block relationships
- Turn flow messages:
  - client -> server: `turn_action` (`roll` | `score`), `turn_end`
  - server -> clients: `turn_action`, `turn_end`, `turn_start`, `turn_timeout_warning`, `turn_auto_advanced`
  - validation: only the current `activeTurnPlayerId` may send turn actions
  - order enforcement: `await_roll` -> `await_score` -> `ready_to_end`; `turn_end` is rejected until score is recorded
  - roll payload shape: `turn_action.action=roll` with `roll.rollIndex` and `roll.dice[]` (`dieId`, `sides`); server generates canonical `value`
  - server-issued roll id: accepted roll actions are stamped with `roll.serverRollId` and mirrored in `turn_start.activeRollServerId`
  - turn recovery sync: `turn_start` can include `phase` + `activeRoll` snapshot (`rollIndex`, `dice[]`, `serverRollId`) so reconnecting clients can resume `await_score` safely
  - timeout metadata: `turn_start`/session `turnState` include `turnExpiresAt` and `turnTimeoutMs`; server emits `turn_timeout_warning` before `turn_auto_advanced` when a turn expires
  - score payload shape: `turn_action.action=score` with `score.selectedDiceIds[]`, `score.points`, and `score.rollServerId` (must match the server-issued id from the latest accepted roll)
- Bot participants can emit periodic `player_notification`, `game_update`, and `chaos_attack` messages to connected humans.
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

Optional bot traffic assertion in smoke tests:

```bash
E2E_ASSERT_BOTS=1 npm run test:e2e:api:local
```

Moderation assertion segment (enabled by default) covers:
- `kick` / `ban` moderation endpoint
- `room_banned` join rejection
- `interaction_blocked` realtime rejection
- missing-auth rejection for multiplayer participant-state mutation

Disable that segment when isolating other failures:

```bash
E2E_ASSERT_MULTIPLAYER_MODERATION=0 npm run test:e2e:api
```

Optional chat-conduct strike/mute assertion segment:

```bash
E2E_ASSERT_CHAT_CONDUCT=1 E2E_CHAT_CONDUCT_TEST_TERM=e2e-term-blocked npm run test:e2e:api
```

Notes:
- `E2E_ASSERT_CHAT_CONDUCT` is opt-in for deployed smoke.
- local harness (`npm run test:e2e:api:local`) enables it by default with a deterministic test term.
- local harness defaults `E2E_ASSERT_ROOM_EXPIRY=1` only when short TTL mode is enabled (`E2E_SHORT_TTLS!=0`); otherwise it defaults to `0` to match long-lived production TTLs.

Baseline smoke also validates:
- player score batch write + read-back sync (`/players/:playerId/scores/batch` + `/players/:playerId/scores`)
- `GET /auth/me` authorized and unauthorized behavior when `E2E_FIREBASE_ID_TOKEN` is provided

Optional admin monitor assertion segment:

```bash
E2E_ASSERT_ADMIN_MONITOR=1 npm run test:e2e:api
```

Notes:
- validates `/api/admin/overview`, `/rooms`, `/metrics`, `/audit`, `/roles` and mutation audit probes.
- requires admin auth (`E2E_ADMIN_TOKEN` or `E2E_FIREBASE_ID_TOKEN` with sufficient role).

Optional admin moderation-term assertion segment:

```bash
E2E_ASSERT_ADMIN_MODERATION_TERMS=1 npm run test:e2e:api
```

Notes:
- validates `GET/POST /api/admin/moderation/terms*` contract (overview/upsert/remove/refresh).
- requires admin auth (`E2E_ADMIN_TOKEN` or `E2E_FIREBASE_ID_TOKEN` with sufficient role).

Bot engine contract tests (strategy interface and invariants):

```bash
npm run test:bot-engine
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
API_MIGRATION_ALLOW_REPLACE=1 node api/scripts/migrate-file-store-to-firestore.mjs --mode replace --allow-replace --prefix api_v1 --project <project-id>
```

Notes:
- `merge` mode keeps existing Firestore records and overlays source file values.
- `replace` mode makes Firestore match the source store snapshot exactly, and now requires explicit opt-in (`API_MIGRATION_ALLOW_REPLACE=1` or `--allow-replace`).
- Expired access/refresh tokens and sessions are pruned by default during migration.

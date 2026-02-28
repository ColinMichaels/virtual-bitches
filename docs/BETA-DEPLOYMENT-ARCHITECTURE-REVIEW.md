# Beta Deployment Architecture Review (2026-02-28)

## Objective

Prepare BISCUITS for beta-user onboarding with a secure, observable, and rollback-safe deployment model across:
- auth login/logout
- single-player score persistence
- multiplayer room/session reliability
- leaderboard synchronization and durability
- future admin portal separation

## Current Architecture Snapshot

- Frontend gameplay app:
  - Vite SPA deployed to Firebase Hosting (`/`)
  - `/api/**` rewritten to Cloud Run `biscuits-api`
- Backend API:
  - Node runtime on Cloud Run
  - WebSocket + HTTP endpoints in same service
  - Firestore-backed storage (`API_STORE_BACKEND=firestore` target)
- Admin controls:
  - API endpoints live under `/api/admin/*`
  - admin UI planned as separate Angular app (`/admin`) but not yet built
- CI/CD:
  - primary workflow: `.github/workflows/firebase-deploy.yml`
  - e2e smoke: `api/e2e/smoke.mjs` (room lifecycle, queue lifecycle, multiplayer moderation/chat-conduct)

## Key Risks Before Beta

1. Auth boundary risk:
   - token mode and role mode must be clearly scoped per environment.
   - admin auth paths must not be accidentally exposed through weak secrets or stale role grants.
2. Multiplayer session lifecycle risk:
   - stale sessions, token refresh edge-cases, and reconnect handling are still sensitive under load.
3. Data integrity risk:
   - leaderboard and player score writes must remain deterministic under reconnect/retry conditions.
4. Operational visibility gap:
   - some failure modes are only visible in raw logs and not yet surfaced in explicit SLO checks.
5. Deployment blast radius:
   - gameplay and future admin surface still share parts of deploy infra; separation is only partially implemented.

## Target Deployment Topology (Beta)

### Lane A: Player Experience (existing)

- Firebase project: gameplay project
- Hosting: public app (`/`)
- API rewrite: `/api/**` -> Cloud Run `biscuits-api`
- Strict env pinning:
  - `API_STORE_BACKEND=firestore`
  - `API_ALLOW_FILE_STORE_IN_PRODUCTION=0`
  - explicit Firebase auth/project IDs

### Lane B: Admin Surface (new deployment lane)

- Separate Firebase project/environment (`admin-dev` / `admin-prod`).
- Separate workflow: `.github/workflows/admin-deploy.yml`.
- Separate service-account secret recommended:
  - `ADMIN_GCP_SA_KEY` or `ADMIN_GCP_SA_KEY_B64`
- Independent deploy/release cadence from gameplay.

## Security Controls (Prioritized)

### P0 (must-have before beta invitation)

1. Enforce admin access posture by environment:
   - dev: token/hybrid acceptable
   - prod beta: prefer role/hybrid with audited owner list
2. Rotate and validate admin tokens:
   - ensure `API_ADMIN_TOKEN` rotation process exists and is documented.
3. Keep Cloud Run single-instance policy explicit for current multiplayer model:
   - avoid accidental scale-out without distributed coordination.
4. Lock deploy secrets by environment:
   - no cross-project service account reuse between gameplay and admin lanes unless intentional and documented.
5. Confirm Firestore durability checks on every deploy smoke:
   - backend and prefix assertions remain enabled.

### P1 (first beta hardening wave)

1. Add structured security-event logging for:
   - admin auth failures
   - repeated session_expired/auth refresh failures
   - moderation escalations (kick/ban/auto-ban)
2. Add rate-limit and abuse thresholds for chat/channel write paths.
3. Add stricter e2e auth-mode matrix (token mode vs role mode).

## Reliability/Correctness Validation Matrix

### Auth and identity

- verify login -> profile read/write -> logout -> relogin behavior.
- verify Firebase UID mapping and non-anonymous score write restrictions.

### Single-player scoring

- verify score batch upsert and leaderboard write ordering.
- verify persistence survives redeploy (Firestore cutover assertions).

### Multiplayer gameplay

- verify create/join/sit/ready flow, reconnect flow, and queue-next auto-round.
- verify websocket reconnect + token refresh do not prematurely expire healthy sessions.

### Moderation and chat conduct

- verify kick/ban + room_banned + interaction_blocked.
- verify strike/mute + admin clear + dynamic term management endpoints.

## Smoke Coverage Status

### Implemented

- admin monitor smoke segment (`E2E_ASSERT_ADMIN_MONITOR`)
- admin moderation-term smoke segment (`E2E_ASSERT_ADMIN_MODERATION_TERMS`)
- multiplayer moderation and chat-conduct smoke segments

### Next additions

1. explicit auth logout/relogin smoke probe
2. leaderboard write/read consistency probe with deterministic expected ordering
3. role-based admin smoke variant (no token path)

## Deployment Pipeline Plan

### Gameplay pipeline (existing)

- continue using `.github/workflows/firebase-deploy.yml`
- ensure admin smoke toggles are set intentionally:
  - `E2E_ASSERT_ADMIN_MONITOR`
  - `E2E_ASSERT_ADMIN_MODERATION_TERMS`

### Admin pipeline (new)

- use `.github/workflows/admin-deploy.yml`
- expected workspace path: `admin/`
- expected config defaults:
  - Firebase config: `admin/firebase.json`
  - build output: `admin/dist` (override via `ADMIN_DIST_DIR`)

## Recommended Beta Gate

Do not open beta invites until all P0 items are complete and these pass on `dev` and `main`:

1. Cloud Run smoke (including admin monitor + moderation-term smoke)
2. Firestore backend/prefix checks
3. room lifecycle + queue lifecycle + websocket connection checks
4. basic login/profile/score path verification

## Related Files

- `api/e2e/smoke.mjs`
- `api/e2e/run-local.mjs`
- `.github/workflows/firebase-deploy.yml`
- `.github/workflows/admin-deploy.yml`
- `docs/ADMIN-PORTAL-ANGULAR-PLAN.md`

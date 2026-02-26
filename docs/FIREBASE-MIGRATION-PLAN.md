# Firebase Migration Plan (From GitHub Pages + Local API)

**Last Updated**: 2026-02-25  
**Status**: Planning / Ready for execution

## Goal

Move from:
- Frontend: GitHub Pages (`gh-pages`)
- Backend: local `/api` Node scaffold

To:
- Frontend: Firebase Hosting
- Backend API: Cloud Run
- Auth: Firebase Auth (+ existing session token model for multiplayer)
- Database: Firestore (phase 1), with option to move hot analytics/logs to BigQuery or relational storage later

---

## Decision Summary

1. **Do not run API on GitHub Pages**
   - GitHub Pages is static hosting only and does not support server-side runtimes.
2. **Use Firebase Hosting + Cloud Run together**
   - Hosting serves static assets globally and can route API paths to Cloud Run.
3. **Do not proxy long-lived WebSockets through Firebase Hosting**
   - Hosting has a 60-second request timeout.
   - Cloud Run WebSockets can run longer (up to service timeout, currently 60 minutes).
   - Use a direct Cloud Run (or custom domain mapped to Cloud Run) endpoint for WS traffic.

---

## Recommended Architecture

### HTTP
- `https://<app-domain>/` -> Firebase Hosting (static app)
- `https://<app-domain>/api/**` -> Hosting rewrite to Cloud Run API service

### WebSocket
- `wss://<ws-domain-or-run-url>/socket` -> Cloud Run directly (not through Hosting rewrite)

### Auth
- Firebase Auth handles player identity.
- Frontend sends Firebase ID token (`Authorization: Bearer <idToken>`) to API.
- API verifies ID token with Firebase Admin SDK.
- Multiplayer service issues short-lived WS/session token (existing pattern in project still applies).

### Data
- Firestore collections for:
  - player profile/settings/progression
  - multiplayer sessions and participants
  - game log metadata and pointers

---

## Why this approach

- Minimal rewrite from current architecture (your `/api` service already exists).
- Supports current camera/chaos/multiplayer plan with managed infra.
- Allows staged migration: you can keep GitHub Pages live until Firebase Hosting is ready.

---

## Migration Phases

## Phase 0: Keep shipping locally (now)

1. Continue local development:
   - Frontend: `npm run dev`
   - API: `npm run api:dev`
2. Keep existing environment contract shape:
   - `apiBaseUrl`
   - `wsUrl`
3. Add Firebase project config placeholders in env once project is created.

Exit criteria:
- Local API + frontend stable with auth/session refresh paths.

## Phase 1: Firebase project bootstrap

1. Create Firebase project.
2. Upgrade to Blaze plan (required for Cloud Run usage in Firebase project flow).
3. Enable products/APIs:
   - Hosting
   - Authentication
   - Firestore
   - Cloud Run API
   - Artifact Registry
   - Cloud Build
4. Install/initialize CLI in repo:
   - `firebase init hosting`
   - add Hosting config for SPA + rewrites

Exit criteria:
- Firebase project exists with Hosting + Auth + Firestore enabled.

## Phase 2: Deploy `/api` to Cloud Run

1. Add containerization for `/api` (Dockerfile).
2. Deploy to Cloud Run.
3. Configure Hosting rewrite:
   - `/api/**` -> Cloud Run service (`run.serviceId`, `region`, optional `pinTag`)
4. Keep WS endpoint direct to Cloud Run URL/domain.

Exit criteria:
- App on Hosting can call production API via `/api/**`.
- WS connects directly to Cloud Run endpoint.

## Phase 3: Auth migration to Firebase Auth

1. Frontend signs in (anonymous or provider-based) with Firebase Auth.
2. Frontend attaches Firebase ID token to API requests.
3. Backend verifies ID token using Admin SDK.
4. Map UID <-> `playerId` (or make UID the canonical `playerId`).
5. Keep refresh/session-expiry UX already added in client.

Exit criteria:
- Unauthorized requests fail correctly.
- Token refresh and session-expiry paths are tested end-to-end.

## Phase 4: Firestore data migration

1. Define collection schema:
   - `players/{uid}` (profile/settings/progression)
   - `sessions/{sessionId}` (+ participants subcollection)
   - `logs/{logId}` (or sharded per day/game)
2. Add Firestore security rules.
3. Add indexes for leaderboard/session queries.
4. Backfill from local/JSON store where needed.

Exit criteria:
- Production writes/reads use Firestore.
- API store abstraction no longer depends on local JSON file.

## Phase 5: CI/CD and release flow

1. Add Firebase Hosting GitHub integration for PR preview channels.
2. Add production deploy workflow:
   - build frontend
   - deploy Hosting
   - deploy Cloud Run API
3. Add rollback runbook (Hosting release rollback + Cloud Run revision rollback).

Exit criteria:
- PR previews and production deploys are repeatable.

---

## Implementation Checklist (Repo-specific)

- [x] Add `firebase.json` and `.firebaserc`.
- [x] Add Hosting rewrites for `/api/**`.
- [x] Add Dockerfile + `api/package.json` for Cloud Run deploy.
- [x] Add Firebase + Cloud Run deploy scripts in `package.json`.
- [ ] Add Firebase Admin verification middleware in API.
- [x] Add Firebase client SDK bootstrap in frontend.
- [x] Update environment files for Firebase/Cloud Run endpoints.
- [ ] Add Firestore adapter for profile/log/session persistence.
- [ ] Add WS reconnection/backoff tests for Cloud Run timeout behavior.
- [x] Add GitHub Actions deploy pipeline for branch-based `master`/`dev` Firebase + Cloud Run deploy.

---

## Risks and Mitigations

1. **WebSocket disconnects over time (Cloud Run timeout)**
   - Mitigation: reconnect logic, heartbeat, session resume, idempotent join flows.
2. **Hosting timeout on rewritten requests**
   - Mitigation: keep long-lived/streaming traffic on direct Cloud Run endpoint.
3. **Cost growth from logs and session churn**
   - Mitigation: TTL/retention strategy, capped writes, budgets + alerts.
4. **Schema drift during migration**
   - Mitigation: versioned API contracts and migration scripts per phase.

---

## Cost/Operations Baseline

1. Start with small Cloud Run instance limits and Firestore quotas/alerts.
2. Add budget alerts at project start (before enabling production traffic).
3. Keep one staging project and one production project.

---

## Source References (official docs)

- GitHub Pages is static hosting and does not support server-side languages:  
  https://docs.github.com/en/enterprise-cloud%40latest/pages/getting-started-with-github-pages/creating-a-github-pages-site  
  https://docs.github.com/articles/user-organization-and-project-pages/

- Firebase Hosting overview and dynamic pairing with Cloud Run/Functions:  
  https://firebase.google.com/docs/hosting

- Hosting rewrites to Cloud Run (`run` rewrites, `pinTag`, methods):  
  https://firebase.google.com/docs/hosting/full-config  
  https://firebase.google.com/docs/hosting/cloud-run

- Important Hosting timeout note (60s for Hosting requests):  
  https://firebase.google.com/docs/hosting/cloud-run

- Cloud Run WebSocket guidance and timeout/reconnect behavior:  
  https://cloud.google.com/run/docs/triggering/websockets  
  https://docs.cloud.google.com/run/docs/configuring/request-timeout

- Firebase pricing plans (Blaze / billing linkage):  
  https://firebase.google.com/docs/projects/billing/firebase-pricing-plans

- Firestore pricing and free quota details:  
  https://firebase.google.com/docs/firestore/pricing

- Firebase Hosting GitHub integration (preview channels on PRs):  
  https://firebase.google.com/docs/hosting/github-integration

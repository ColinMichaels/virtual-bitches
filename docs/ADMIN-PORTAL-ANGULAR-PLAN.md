# Admin Portal Plan (`/admin` with Angular + Angular Material)

## Goal

Build a professional, extensible admin portal as a separate frontend surface under `/admin`, without constraining the main gameplay bundle.

## Why Separate App

- Admin UX has different priorities than gameplay UX:
  - richer data grids, filters, audit tooling
  - role-based controls and guard rails
  - larger dependency footprint is acceptable
- Keeps player-facing app lean while allowing enterprise-style admin tooling.

## Proposed Repo Layout

```text
/src                     # Existing gameplay app
/api                     # Existing API
/admin                   # New Angular workspace/app (standalone build pipeline)
  /src/app
  /src/environments
  angular.json
  package.json
```

## Stack

- Angular (latest stable)
- Angular Material + CDK
- RxJS + HTTP interceptors
- Strict TypeScript + route guards

## Authentication + Authorization

- Reuse Firebase auth session in admin app.
- Send bearer token to existing admin API endpoints.
- Route guards enforce role minimums:
  - `viewer`: read dashboards/metrics
  - `operator`: moderation and room controls
  - `owner`: role management and high-risk operations
- Display effective role and source (`token` vs `firebase role`) in header.

## Initial Feature Modules

1. `dashboard`:
   - `/api/admin/overview`
   - `/api/admin/metrics`
2. `rooms`:
   - `/api/admin/rooms`
   - expire/remove/channel message actions
3. `conduct`:
   - `/api/admin/sessions/:sessionId/conduct`
   - player clear + session clear actions
4. `audit`:
   - `/api/admin/audit`
5. `roles`:
   - `/api/admin/roles`
   - role upsert (owner-only)

## UX Guidelines

- Material `mat-table` + server-side pagination/filtering.
- Confirmation dialogs for destructive actions.
- Action history drawer for recent mutations.
- Explicit status chips (`active`, `muted`, `expired`, `public`, `private`).
- Error surfaces include API `reason` codes.

## Deployment Model

Two viable options:

1. Same Hosting site under `/admin`:
   - deploy admin build to `/admin/*`
   - keep gameplay app at `/`
2. Separate Hosting target/subdomain (recommended long-term):
   - `admin.<domain>` or separate Firebase hosting target
   - fully independent rollback cadence
   - separate Firebase project credentials and deploy workflow

Current scaffolded deploy path:
- workflow: `.github/workflows/admin-deploy.yml`
- intended environment lanes:
  - `admin-dev`
  - `admin-prod`
- expected defaults (override with vars):
  - Firebase config: `admin/firebase.json`
  - build output: `admin/dist`

## CI/CD Strategy

Keep current pipeline focused on API + gameplay.

Admin workflow scaffold has been added and should be hardened as `/admin` is implemented:
- install/build/deploy only `/admin`
- deploy only when admin paths change (or manual dispatch)
- optional smoke probe against `ADMIN_APP_BASE_URL`
- environment protections recommended for `admin-prod`

## Phased Delivery

1. Phase 0:
   - scaffold `/admin` Angular app
   - auth bootstrap + role guard shell
2. Phase 1:
   - dashboard + rooms read-only
3. Phase 2:
   - moderation actions (kick/ban/remove/expire)
   - conduct review/clear tools
4. Phase 3:
   - role management + audit exports
   - advanced policy screens (chat conduct config)

## Out of Scope (for this pipeline)

- Full Angular admin implementation
- Visual polish pass
- Multi-tenant admin segmentation

This document is the blueprint so we can start `/admin` cleanly when ready, without overloading the current deploy pipeline.

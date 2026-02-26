# Firebase Setup (Phase 1 Bootstrap)

This project now includes base Firebase config files:

- `firebase.json`
- `.firebaserc`
- `firestore.rules`
- `firestore.indexes.json`
- `.env.firebase.example`

## 1) Copy environment values

Create `.env.local` from `.env.firebase.example` and fill values:

```bash
cp .env.firebase.example .env.local
```

Required keys:
- `VITE_API_BASE_URL`
- `VITE_WS_URL`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID` (optional but recommended)
- `VITE_ENABLE_ADMIN_UI` (optional, default `0` in production; set `1` to expose in-app admin monitor UI)

## 2) Authenticate Firebase CLI

```bash
npm run firebase:login
```

## 3) Select project alias

```bash
npm run firebase:use:prod
```

Current aliases are in `.firebaserc`:
- `default` -> `biscuits-488600`
- `prod` -> `biscuits-488600`
- `dev` -> `biscuits-488600`

## 4) Local emulator run (optional)

```bash
npm run firebase:emulators
```

Defaults:
- Hosting emulator: `http://localhost:5000`
- Firestore emulator: `localhost:8080`
- Emulator UI: `http://localhost:4000`

## 5) Deploy Hosting + Firestore config

```bash
npm run firebase:deploy
```

Hosting rewrite setup is already configured:
- `/api/**` -> Cloud Run service `biscuits-api` in `us-central1`

## 6) Deploy API to Cloud Run

```bash
npm run cloudrun:deploy:api
```

Notes:
- This command requires Google Cloud SDK (`gcloud`) auth and project selection.
- WebSocket traffic should connect directly to Cloud Run/domain (`VITE_WS_URL`), not through Hosting rewrites.
- Set `FIREBASE_PROJECT_ID` on Cloud Run so API-side Firebase ID token validation can enforce token audience.
- For Firestore-backed API persistence, set `API_STORE_BACKEND=firestore` (optional `API_FIRESTORE_PREFIX`, default `api_v1`).
- For hardened Firebase token verification, set `FIREBASE_AUTH_MODE=admin` in Cloud Run.

Optional smoke test against deployed API + WebSocket:

```bash
E2E_API_BASE_URL="https://<cloud-run-service-url>" npm run test:e2e:api
```

### 6.5) Migrate existing JSON store data to Firestore (Sprint 1.5)

```bash
npm --prefix api install
API_FIRESTORE_PREFIX=api_v1 FIREBASE_PROJECT_ID=<project-id> npm run api:migrate:firestore
```

Verification-only:

```bash
API_FIRESTORE_PREFIX=api_v1 FIREBASE_PROJECT_ID=<project-id> npm run api:migrate:firestore:verify
```

Cutover recommendation:
- Run migration once in `merge` mode (default).
- Verify counts/digests from migration output.
- Then deploy Cloud Run with `API_STORE_BACKEND=firestore` and `FIREBASE_AUTH_MODE=admin`.

## 7) GitHub Actions auto-deploy (master/dev)

Workflow file:
- `.github/workflows/firebase-deploy.yml`

Trigger:
- push to `master` (production deploy)
- push to `dev` (staging/dev deploy)

Known-good project values:
- Project ID: `biscuits-488600`
- Hosting site: `biscuits-488600` (or explicit `biscuit-dice` if intentionally targeting that site)
- `VITE_API_BASE_URL`: `/api` (recommended with Hosting rewrite)
- `VITE_WS_URL`: `wss://biscuits-api-njhi4kclea-uc.a.run.app`

Required GitHub secrets:

Shared:
- `GCP_SA_KEY` (raw JSON service account key with Firebase Hosting/Firestore + Cloud Run deploy permissions)
  - optional fallback: `GCP_SA_KEY_B64` (base64-encoded JSON key)
- optional: `FIREBASE_HOSTING_SITE` (explicit Hosting site ID; defaults to `FIREBASE_PROJECT_ID` if omitted)

Recommended setup (GitHub Environments):
- Create two GitHub Environments: `prod` and `dev`.
- `master`/`main` deploy job uses `prod`; `dev` deploy job uses `dev`.
- Add these keys inside each environment (same names in both):
  - `FIREBASE_PROJECT_ID` (or fallback `VITE_FIREBASE_PROJECT_ID`)
  - `VITE_API_BASE_URL`
  - `VITE_WS_URL`
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN`
  - `VITE_FIREBASE_PROJECT_ID`
  - `VITE_FIREBASE_STORAGE_BUCKET`
  - `VITE_FIREBASE_MESSAGING_SENDER_ID`
  - `VITE_FIREBASE_APP_ID`
  - `VITE_FIREBASE_MEASUREMENT_ID` (optional)
  - `VITE_ENABLE_ADMIN_UI` (optional)

Alternate setup (repo-level branch-suffixed keys):
- `FIREBASE_PROJECT_ID_PROD`
- `FIREBASE_PROJECT_ID_DEV`

Fallback behavior:
- If `FIREBASE_PROJECT_ID_PROD` or `FIREBASE_PROJECT_ID_DEV` is not set, workflow falls back to:
  - `VITE_FIREBASE_PROJECT_ID_PROD`
  - `VITE_FIREBASE_PROJECT_ID_DEV`

Environment keys are also supported:
- `FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_PROJECT_ID`

Branch-specific frontend env secrets:
- `VITE_API_BASE_URL_PROD`
- `VITE_API_BASE_URL_DEV`
- `VITE_WS_URL_PROD`
- `VITE_WS_URL_DEV`
- `VITE_FIREBASE_API_KEY_PROD`
- `VITE_FIREBASE_API_KEY_DEV`
- `VITE_FIREBASE_AUTH_DOMAIN_PROD`
- `VITE_FIREBASE_AUTH_DOMAIN_DEV`
- `VITE_FIREBASE_PROJECT_ID_PROD`
- `VITE_FIREBASE_PROJECT_ID_DEV`
- `VITE_FIREBASE_STORAGE_BUCKET_PROD`
- `VITE_FIREBASE_STORAGE_BUCKET_DEV`
- `VITE_FIREBASE_MESSAGING_SENDER_ID_PROD`
- `VITE_FIREBASE_MESSAGING_SENDER_ID_DEV`
- `VITE_FIREBASE_APP_ID_PROD`
- `VITE_FIREBASE_APP_ID_DEV`
- `VITE_FIREBASE_MEASUREMENT_ID_PROD` (optional)
- `VITE_FIREBASE_MEASUREMENT_ID_DEV` (optional)

The workflow builds a `.env.production` file at runtime from these secrets; no keys are committed in source.

Required APIs in target project:
- `run.googleapis.com`
- `cloudbuild.googleapis.com`
- `artifactregistry.googleapis.com`
- `firestore.googleapis.com`
- `firebaserules.googleapis.com`
- `firebasehosting.googleapis.com`
- `storage.googleapis.com`

Required IAM roles for deploy service account (`biscuits-sa@<project>.iam.gserviceaccount.com`):
- `roles/run.admin`
- `roles/iam.serviceAccountUser` (on runtime service account, typically `<project-number>-compute@developer.gserviceaccount.com`)
- `roles/cloudbuild.builds.editor`
- `roles/artifactregistry.writer`
- `roles/storage.admin`
- `roles/serviceusage.serviceUsageConsumer`
- `roles/firebaserules.admin`
- `roles/datastore.indexAdmin`
- `roles/firebasehosting.admin`

### Troubleshooting

If workflow fails with `Missing required secret/output: PROJECT_ID`:
1. Ensure branch is `master`, `main`, or `dev`.
2. If using GitHub Environments, ensure environment name matches exactly:
   - `dev` for `dev` branch
   - `prod` for `main`/`master` branch
3. Set either:
   - `FIREBASE_PROJECT_ID_<ENV>` (recommended), or
   - `VITE_FIREBASE_PROJECT_ID_<ENV>` (fallback), or
   - environment key `FIREBASE_PROJECT_ID` / `VITE_FIREBASE_PROJECT_ID`.
4. Re-run workflow.

If workflow fails with `failed to parse service account key JSON credentials`:
1. Ensure `GCP_SA_KEY` contains raw JSON (starts with `{`), not a file path and not encrypted/binary content.
2. If you only have base64 text, store it in `GCP_SA_KEY_B64` instead.
3. Re-run workflow; the pipeline now validates and decodes base64 keys automatically.

If workflow fails with Firebase Hosting `404 Requested entity was not found` on `/sites/.../versions`:
1. The hosting site ID being targeted does not exist in that Firebase project.
2. Set `FIREBASE_HOSTING_SITE` to the correct site ID (or let it default to project ID if your site matches project ID).
3. If needed, create the site once:
   - `npx firebase-tools hosting:sites:create <site-id> --project <project-id>`

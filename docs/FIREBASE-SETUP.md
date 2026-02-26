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

## 2) Authenticate Firebase CLI

```bash
npm run firebase:login
```

## 3) Select project alias

```bash
npm run firebase:use:prod
```

Current aliases are in `.firebaserc`:
- `prod` -> `biscuits-b427f`
- `staging` -> `biscuits-b427f-staging` (placeholder until created)

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

## 7) GitHub Actions auto-deploy (master/dev)

Workflow file:
- `.github/workflows/firebase-deploy.yml`

Trigger:
- push to `master` (production deploy)
- push to `dev` (staging/dev deploy)

Required GitHub secrets:

Shared:
- `GCP_SA_KEY` (raw JSON service account key with Firebase Hosting/Firestore + Cloud Run deploy permissions)
  - optional fallback: `GCP_SA_KEY_B64` (base64-encoded JSON key)

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

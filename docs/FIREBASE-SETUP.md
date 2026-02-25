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
- `GCP_SA_KEY` (JSON service account key with Firebase Hosting/Firestore + Cloud Run deploy permissions)

Branch-specific project:
- `FIREBASE_PROJECT_ID_PROD`
- `FIREBASE_PROJECT_ID_DEV`

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

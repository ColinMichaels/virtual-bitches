# CDN Asset Migration (Firebase Storage / GCS)

This app now supports loading most runtime assets from a CDN origin via environment config.

## What Is CDN-ready Now

- Dice theme configs + textures (`assets/themes/**`)
- Table/game textures (`assets/game-textures/**`)
- Branding logo (`assets/logos/Biscuits_logo.png`)
- Background music (`assets/music/game music.mp3`)
- Rules markdown (`rules.md`)
- Updates feed (`updates.json`)

## 1) Prepare local asset tree

```bash
npm run copy:assets:sync
```

This syncs source files into `public/**` so you can upload from one place.

## 2) Upload to Firebase Storage bucket

Use your Firebase Storage bucket name from `VITE_FIREBASE_STORAGE_BUCKET`.

Quick path (scripted):

```bash
FIREBASE_STORAGE_BUCKET=<your-bucket> npm run cdn:upload:firebase
```

Optimize images first (recommended for deploys):

```bash
npm run copy:assets:sync
npm run assets:optimize
node scripts/upload-assets-to-firebase-storage.mjs --bucket <your-bucket> \
  --asset-cache-control "public,max-age=86400" \
  --content-cache-control "public,max-age=300,must-revalidate"
```

Disable cache-control metadata updates (optional):

```bash
node scripts/upload-assets-to-firebase-storage.mjs --bucket <your-bucket> --no-cache-control
```

Dry-run:

```bash
FIREBASE_STORAGE_BUCKET=<your-bucket> npm run cdn:upload:firebase -- --dry-run
```

Manual commands:

```bash
export BUCKET="<your-bucket>"
gcloud storage rsync --recursive public/assets gs://$BUCKET/assets
gcloud storage cp public/rules.md gs://$BUCKET/rules.md
gcloud storage cp public/updates.json gs://$BUCKET/updates.json
```

## 3) Configure app env

Set these in `.env.local` / GitHub environment vars:

```bash
VITE_ASSET_BASE_URL=https://storage.googleapis.com/<your-bucket>/
VITE_BRAND_LOGO_URL=https://storage.googleapis.com/<your-bucket>/assets/logos/Biscuits_logo.png
VITE_GAME_MUSIC_URL=https://storage.googleapis.com/<your-bucket>/assets/music/game%20music.mp3
VITE_RULES_URL=https://storage.googleapis.com/<your-bucket>/rules.md
VITE_UPDATES_URL=https://storage.googleapis.com/<your-bucket>/updates.json
```

`VITE_ASSET_BASE_URL` is the main switch. The other URLs are optional overrides.

## 4) Optional: Add Cloud CDN in front of bucket (recommended)

Firebase Storage is backed by Google Cloud Storage. For better global caching and lower latency,
front the bucket with Cloud CDN and set `VITE_ASSET_BASE_URL` to that CDN origin.

## 5) CI/CD Integration

The GitHub Actions pipeline now includes a dedicated `deploy-assets` job in
`.github/workflows/firebase-deploy.yml` that:

- syncs `public/assets/**`
- optimizes image assets with ImageMagick
- uploads optimized assets to Firebase Storage

It runs after the main deploy job and uses the resolved `VITE_FIREBASE_STORAGE_BUCKET` value.

Optional GitHub Environment variables for cache behavior:

- `CDN_ASSET_CACHE_CONTROL` (default: `public,max-age=86400`)
- `CDN_CONTENT_CACHE_CONTROL` (default: `public,max-age=300,must-revalidate`)

Optional GitHub Environment variables for CDN smoke checks:

- `CDN_VERIFY_RETRIES` (default: `3`)
- `CDN_VERIFY_DELAY_MS` (default: `2000`)
- `CDN_VERIFY_TIMEOUT_MS` (default: `15000`)

Manual verification command:

```bash
npm run cdn:verify -- \
  --url "https://storage.googleapis.com/<your-bucket>/assets/themes/default/theme.config.json" \
  --url "https://storage.googleapis.com/<your-bucket>/assets/logos/Biscuits_logo.png" \
  --url "https://storage.googleapis.com/<your-bucket>/assets/music/game%20music.mp3" \
  --url "https://storage.googleapis.com/<your-bucket>/rules.md" \
  --url "https://storage.googleapis.com/<your-bucket>/updates.json"
```

## Notes

- Keep local fallback paths for development by leaving `VITE_ASSET_BASE_URL` empty.
- If you lock down bucket access, ensure your CDN/origin strategy still supports public reads for game assets.

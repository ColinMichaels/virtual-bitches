# Environment And Secrets Reference

This is the operational reference for frontend `VITE_*` values and GitHub deploy secrets/variables used by `.github/workflows/firebase-deploy.yml`.

Important:
- Any `VITE_*` value is bundled into client code and is public.
- Do not place private keys, server tokens, or admin secrets in `VITE_*`.

## 1) Frontend `VITE_*` Variables

Use these in `.env.local` for local dev and GitHub deploy environment values for CI builds.

### 1.1 Required App Connectivity + Firebase

| Key | Example shape | Where to obtain |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `https://<project>.web.app/api` or `https://<cloud-run-host>/api` | Hosting URL + `/api` rewrite, or Cloud Run API URL |
| `VITE_WS_URL` | `wss://<cloud-run-host>` | Cloud Run service URL (use `wss://`) |
| `VITE_FIREBASE_API_KEY` | `AIza...` | Firebase Console -> Project settings -> General -> Web app config |
| `VITE_FIREBASE_AUTH_DOMAIN` | `<project-id>.firebaseapp.com` | Firebase Console -> Web app config |
| `VITE_FIREBASE_PROJECT_ID` | `<project-id>` | Firebase Console -> Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | `<project-id>.firebasestorage.app` | Firebase Console -> Storage |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | numeric string like `123456789012` | Firebase Console -> Web app config |
| `VITE_FIREBASE_APP_ID` | `1:<number>:web:<hash>` | Firebase Console -> Web app config |

### 1.2 Common Optional Frontend Values

| Key | Example shape | Where to obtain |
| --- | --- | --- |
| `VITE_FIREBASE_MEASUREMENT_ID` | `G-XXXXXXXXXX` | Firebase Console -> Analytics (if enabled) |
| `VITE_ASSET_BASE_URL` | `https://storage.googleapis.com/<bucket>/` | Firebase Storage bucket public URL (or leave empty for Hosting-local paths) |
| `VITE_FEEDBACK_FORM_URL` | `https://docs.google.com/forms/...` | Team feedback form URL |
| `VITE_ENABLE_ADMIN_UI` | `0` or `1` | Team-controlled feature flag |
| `VITE_MULTIPLAYER_AUTO_SEAT_READY_ENABLED` | `0` or `1` | Team-controlled kill switch for auto-seat/auto-ready |
| `VITE_OG_IMAGE_URL` | `https://.../assets/ads/betahelp_ad.png` | CDN/Storage image URL for share metadata |
| `VITE_FACEBOOK_APP_ID` | numeric string | Facebook Developer app settings |

### 1.3 Optional Asset Override Values

| Key | Example shape | Where to obtain |
| --- | --- | --- |
| `VITE_BRAND_LOGO_URL` | `https://.../assets/logos/Biscuits_logo.png` | CDN/Storage asset URL |
| `VITE_GAME_MUSIC_URL` | `https://.../assets/music/game%20music.mp3` | CDN/Storage asset URL |
| `VITE_RULES_URL` | `https://.../rules.md` | CDN/Storage or Hosting URL |
| `VITE_UPDATES_URL` | `https://.../updates.json` | CDN/Storage or Hosting URL |
| `VITE_GIT_UPDATES_URL` | `https://.../updates.git.json` | Optional alternate updates feed |

### 1.4 Optional Brand Override Values

| Key | Example shape | Where to obtain |
| --- | --- | --- |
| `VITE_BRAND_PRODUCT_NAME` | `Virtual Biscuits` | Team branding decision |
| `VITE_BRAND_OG_TITLE` | `BISCUITS - Dice` | Team branding decision |
| `VITE_BRAND_OG_DESCRIPTION` | short text | Team branding decision |
| `VITE_BRAND_AGE_GATE_REQUIRED` | `0` or `1` | Team policy flag |
| `VITE_BRAND_CONTENT_RATING_NOTES` | comma-separated text | Team policy text |

### 1.5 Optional Bot Meme Service Values

| Key | Example shape | Where to obtain |
| --- | --- | --- |
| `VITE_BOT_MEME_AVATARS_ENABLED` | `0` or `1` | Team feature flag |
| `VITE_BOT_MEME_API_URL` | `https://api.humorapi.com/memes/random` | Meme API provider docs |
| `VITE_BOT_MEME_API_KEY` | provider key string | Meme API provider console |
| `VITE_BOT_MEME_API_KEY_HEADER` | `x-api-key` | Meme API provider docs |
| `VITE_BOT_MEME_IMAGE_PROXY_ENABLED` | `0` or `1` | Team feature flag |
| `VITE_BOT_MEME_ROTATION_MS` | integer ms like `38000` | Team tuning |
| `VITE_BOT_MEME_FETCH_TIMEOUT_MS` | integer ms like `5000` | Team tuning |

## 2) GitHub Secrets + Variables (CI/CD)

Recommended setup:
- Create GitHub Environments named `dev` and `prod`.
- Store environment-specific values there.
- Workflow picks `dev` on `dev` branch, `prod` on `main`/`master`.

### 2.1 Required GitHub Secrets

| Key | Example shape | Where to obtain |
| --- | --- | --- |
| `GCP_SA_KEY` | raw service account JSON | Google Cloud Console -> IAM & Admin -> Service Accounts -> Keys |
| `GCP_SA_KEY_B64` | base64 of same JSON | Optional alternative to `GCP_SA_KEY` |

Use one of `GCP_SA_KEY` or `GCP_SA_KEY_B64`.

### 2.2 Required Deploy Config Keys (set as env secrets or env vars)

| Key | Example shape | Where to obtain |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | `biscuits-488600` | Firebase project ID |
| `VITE_API_BASE_URL` | `https://<project>.web.app/api` | Hosting + API rewrite URL |
| `VITE_WS_URL` | `wss://<cloud-run-host>` | Cloud Run URL for websocket endpoint |
| `VITE_FIREBASE_API_KEY` | `AIza...` | Firebase web app config |
| `VITE_FIREBASE_AUTH_DOMAIN` | `<project-id>.firebaseapp.com` | Firebase web app config |
| `VITE_FIREBASE_PROJECT_ID` | `<project-id>` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | `<project-id>.firebasestorage.app` | Firebase Storage |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | numeric string | Firebase web app config |
| `VITE_FIREBASE_APP_ID` | `1:<number>:web:<hash>` | Firebase web app config |

Optional but recommended:
- `VITE_FIREBASE_MEASUREMENT_ID`

### 2.3 Optional GitHub Secrets

| Key | Example shape | Where to obtain |
| --- | --- | --- |
| `API_ADMIN_TOKEN` | long random token (32+ chars) | Team-generated secret for admin endpoints/smoke checks |
| `MULTIPLAYER_CHAT_TERMS_SERVICE_API_KEY` | opaque token string | Optional auth token for remote moderation-term service |
| `E2E_FIREBASE_ID_TOKEN` | Firebase ID token string | Generated from a test user sign-in flow |
| `FEEDBACK_FORM_URL` | `https://docs.google.com/forms/...` | Team feedback form |
| `VITE_FEEDBACK_FORM_URL` | same as above | Legacy-compatible fallback |
| `FIREBASE_HOSTING_SITE` | hosting site ID | Firebase Hosting console (if different from project ID) |

### 2.4 Common GitHub Variables

| Key | Example shape | Where to obtain |
| --- | --- | --- |
| `VITE_ENABLE_ADMIN_UI` | `0` or `1` | Team feature flag |
| `VITE_MULTIPLAYER_AUTO_SEAT_READY_ENABLED` | `0` or `1` | Global deploy kill switch for join auto-seat/auto-ready |
| `VITE_OG_IMAGE_URL` | `https://...` | CDN/Storage image URL |
| `VITE_FACEBOOK_APP_ID` | numeric string | Facebook Developer app |
| `API_FIRESTORE_PREFIX` | `api_v1` | Team-chosen Firestore namespace |
| `FIREBASE_AUTH_MODE` | `auto`, `admin`, `legacy` | API auth mode decision |
| `API_ADMIN_ACCESS_MODE` | `hybrid`, `token`, `role`, etc. | API admin auth policy |
| `API_MIN_INSTANCES` | `1` | Cloud Run capacity target |
| `API_MAX_INSTANCES` | `1` | Keep `1` for current single-instance multiplayer architecture |
| `MULTIPLAYER_SESSION_IDLE_TTL_MS` | integer ms like `1800000` | Session expiry policy |
| `MULTIPLAYER_CHAT_CONDUCT_ENABLED` | `0` or `1` | Enable/disable chat conduct middleware |
| `MULTIPLAYER_CHAT_CONDUCT_PUBLIC_ONLY` | `0` or `1` | Enforce profanity checks only on public channel (`1` default) |
| `MULTIPLAYER_CHAT_BANNED_TERMS` | comma/space delimited terms | Team-owned initial profanity/blocked term list |
| `MULTIPLAYER_CHAT_STRIKE_LIMIT` | integer like `3` | Number of violations before temporary mute |
| `MULTIPLAYER_CHAT_STRIKE_WINDOW_MS` | integer ms like `900000` | Rolling strike window |
| `MULTIPLAYER_CHAT_MUTE_MS` | integer ms like `300000` | Temporary mute duration when strike limit is reached |
| `MULTIPLAYER_CHAT_AUTO_ROOM_BAN_STRIKE_LIMIT` | integer like `0` or `8` | Optional auto-room-ban threshold (`0` disables) |
| `MULTIPLAYER_CHAT_TERMS_SERVICE_URL` | `https://moderation-service.example.com/terms` | Optional remote source for adaptive moderation terms |
| `MULTIPLAYER_CHAT_TERMS_SERVICE_API_KEY` | opaque token | Optional remote auth token for term service |
| `MULTIPLAYER_CHAT_TERMS_SERVICE_API_KEY_HEADER` | header name like `x-api-key` | Override auth header name for term service |
| `MULTIPLAYER_CHAT_TERMS_REFRESH_MS` | integer ms like `60000` | Poll interval for remote moderation terms (`0` disables interval poll) |
| `MULTIPLAYER_CHAT_TERMS_FETCH_TIMEOUT_MS` | integer ms like `6000` | Timeout for remote term fetch requests |
| `MULTIPLAYER_CHAT_TERMS_SYNC_ON_BOOT` | `0` or `1` | Run an initial remote moderation-term sync at API bootstrap |
| `MULTIPLAYER_CHAT_TERMS_MAX_MANAGED` | integer like `2048` | Max in-API managed moderation terms |
| `MULTIPLAYER_CHAT_TERMS_MAX_REMOTE` | integer like `4096` | Max remote moderation terms per refresh |
| `E2E_QUEUE_LIFECYCLE_WAIT_MS` | integer ms like `90000` | CI smoke tolerance |
| `E2E_ASSERT_ADMIN_MONITOR` | `0` or `1` | Toggle admin monitor smoke segment (overview/rooms/metrics/audit/roles + admin mutations) |
| `E2E_ASSERT_ADMIN_MODERATION_TERMS` | `0` or `1` | Toggle admin moderation-term smoke segment (`/api/admin/moderation/terms*`) |
| `E2E_ASSERT_MULTIPLAYER_MODERATION` | `0` or `1` | Toggle moderation smoke segment (`kick/ban`, `room_banned`, `interaction_blocked`) |
| `E2E_ASSERT_CHAT_CONDUCT` | `0` or `1` | Toggle chat conduct smoke segment (strikes + mute + admin clear) |
| `E2E_CHAT_CONDUCT_TEST_TERM` | token like `e2e-term-blocked` | Deterministic banned term used by smoke payloads |
| `E2E_EXPECT_STORAGE_SECTION_MIN_COUNTS` | `players:1,sessions:1` | Optional CI assertions |
| `CDN_REQUIRE_PUBLIC_READ` | `0` or `1` | CDN/public bucket strategy |
| `CDN_AUTOCONFIGURE_PUBLIC_READ` | `0` or `1` | CI IAM automation toggle |
| `CDN_AUTOCONFIGURE_CORS` | `0` or `1` | CI CORS automation toggle |
| `CDN_ASSET_CACHE_CONTROL` | `public,max-age=86400` | Asset cache policy |
| `CDN_CONTENT_CACHE_CONTROL` | `public,max-age=300,must-revalidate` | Content cache policy |
| `CDN_VERIFY_RETRIES` | integer like `8` | CI CDN smoke setting |
| `CDN_VERIFY_DELAY_MS` | integer ms like `3000` | CI CDN smoke setting |
| `CDN_VERIFY_TIMEOUT_MS` | integer ms like `15000` | CI CDN smoke setting |

### 2.5 Branch-Suffixed Fallback Keys

Workflow also supports repo-level fallback keys:
- `FIREBASE_PROJECT_ID_PROD`, `FIREBASE_PROJECT_ID_DEV`
- `VITE_API_BASE_URL_PROD`, `VITE_API_BASE_URL_DEV`
- `VITE_WS_URL_PROD`, `VITE_WS_URL_DEV`
- `VITE_FIREBASE_API_KEY_PROD`, `VITE_FIREBASE_API_KEY_DEV`
- `VITE_FIREBASE_AUTH_DOMAIN_PROD`, `VITE_FIREBASE_AUTH_DOMAIN_DEV`
- `VITE_FIREBASE_PROJECT_ID_PROD`, `VITE_FIREBASE_PROJECT_ID_DEV`
- `VITE_FIREBASE_STORAGE_BUCKET_PROD`, `VITE_FIREBASE_STORAGE_BUCKET_DEV`
- `VITE_FIREBASE_MESSAGING_SENDER_ID_PROD`, `VITE_FIREBASE_MESSAGING_SENDER_ID_DEV`
- `VITE_FIREBASE_APP_ID_PROD`, `VITE_FIREBASE_APP_ID_DEV`
- `VITE_FIREBASE_MEASUREMENT_ID_PROD`, `VITE_FIREBASE_MEASUREMENT_ID_DEV`

Use these only if you cannot use environment-scoped keys.

### 2.6 Admin Deployment Workflow Keys (`admin-deploy.yml`)

Secrets:
- `ADMIN_GCP_SA_KEY` or `ADMIN_GCP_SA_KEY_B64`:
  - recommended dedicated service account for admin Firebase project
  - if absent, workflow falls back to `GCP_SA_KEY`/`GCP_SA_KEY_B64`
- `ADMIN_FIREBASE_PROJECT_ID` (or branch-specific):
  - `ADMIN_FIREBASE_PROJECT_ID_DEV`
  - `ADMIN_FIREBASE_PROJECT_ID_PROD`

Variables:
- `ADMIN_FIREBASE_CONFIG_PATH` (default: `admin/firebase.json`)
- `ADMIN_DIST_DIR` (default: `admin/dist`)
- `ADMIN_HOSTING_TARGET` (optional; deploy alias when using multi-site target mapping)
- `ADMIN_APP_BASE_URL` (optional smoke URL for manual dispatch)
- branch-specific optional smoke URLs:
  - `ADMIN_APP_BASE_URL_DEV`
  - `ADMIN_APP_BASE_URL_PROD`

## 3) Quick Secret Generation Tips

Generate an admin token:

```bash
openssl rand -base64 48
```

Set this value as `API_ADMIN_TOKEN` secret.

## 4) Related Docs

- [`docs/FIREBASE-SETUP.md`](./FIREBASE-SETUP.md)
- [`docs/CDN-ASSET-MIGRATION.md`](./CDN-ASSET-MIGRATION.md)
- [`api/README.md`](../api/README.md)

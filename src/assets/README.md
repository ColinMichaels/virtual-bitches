# Assets Directory

This directory contains source assets that are copied to `public/` during the build process.

## Directory Structure

- `textures/` - Dice theme source files (textures, geometry, configurations)
  - Source bundle for theme files that can be copied into the public runtime tree
  - Missing files are automatically filled into `public/assets/themes/` by `npm run copy:assets`
- `game-textures/` - Table and board textures (`public/assets/game-textures/`)
- `logos/` - Branding images (`public/assets/logos/`)
- `music/` - Background tracks (`public/assets/music/`)
- `ads/` - Promotional images (`public/assets/ads/`)

## Build Process

### Content Assets
The following content files are automatically copied during build:

- `src/content/rules.md` → `public/rules.md` (dev) → `dist/rules.md` (build)

Run `npm run copy:assets` to sync content and fill any missing theme files into `public/`.
Run `npm run copy:assets:sync` when you want to fully refresh `public/assets/themes/` from
`src/assets/textures/`.

### Static Assets (Textures/Themes)
Static assets are synced by `scripts/copy-assets.mjs`:

- `src/assets/textures/**` -> `public/assets/themes/**`
- `src/assets/game-textures/**` -> `public/assets/game-textures/**`
- `src/assets/logos/**` -> `public/assets/logos/**`
- `src/assets/music/**` -> `public/assets/music/**`
- `src/assets/ads/**` -> `public/assets/ads/**`

Vite then copies `public/**` into `dist/**` during build.

### CDN Offload
To offload runtime assets to Firebase Storage (or any CDN), configure:

- `VITE_ASSET_BASE_URL` (global base for `assets/**`, `rules.md`, `updates.json`)
- Optional direct overrides:
  - `VITE_BRAND_LOGO_URL`
  - `VITE_GAME_MUSIC_URL`
  - `VITE_RULES_URL`
  - `VITE_UPDATES_URL`

When `VITE_ASSET_BASE_URL` is set, theme textures, game textures, logo, music, rules, and updates
can be served from CDN while keeping local fallback paths for development.

For upload-size optimization before publishing assets:

- `npm run copy:assets:sync`
- `npm run assets:optimize`
- `FIREBASE_STORAGE_BUCKET=<bucket> node scripts/upload-assets-to-firebase-storage.mjs --bucket <bucket>`
- Optional cache policy flags:
  - `--asset-cache-control "public,max-age=86400"`
  - `--content-cache-control "public,max-age=300,must-revalidate"`
- Verify published CDN paths:
  - `npm run cdn:verify -- --url "<asset-url>"`

## Adding New Content

1. Add markdown/text content to `src/content/`
2. Ensure `scripts/copy-assets.mjs` copies/validates the new file path
3. Update `vite.config.ts` static copy plugin if needed for build output

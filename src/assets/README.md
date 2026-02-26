# Assets Directory

This directory contains source assets that are copied to `public/` during the build process.

## Directory Structure

- `textures/` - Dice theme source files (textures, geometry, configurations)
  - Source bundle for theme files that can be copied into the public runtime tree
  - Missing files are automatically filled into `public/assets/themes/` by `npm run copy:assets`

## Build Process

### Content Assets
The following content files are automatically copied during build:

- `src/content/rules.md` → `public/rules.md` (dev) → `dist/rules.md` (build)

Run `npm run copy:assets` to sync content and fill any missing theme files into `public/`.
Run `npm run copy:assets:sync` when you want to fully refresh `public/assets/themes/` from
`src/assets/textures/`.

### Static Assets (Textures/Themes)
Theme files are synced from `src/assets/textures/` to `public/assets/themes/` by
`scripts/copy-assets.mjs`. Vite then copies `public/assets/themes/` to
`dist/assets/themes/` during build.

## Adding New Content

1. Add markdown/text content to `src/content/`
2. Ensure `scripts/copy-assets.mjs` copies/validates the new file path
3. Update `vite.config.ts` static copy plugin if needed for build output

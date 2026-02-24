# Assets Directory

This directory contains source assets that are copied to `public/` during the build process.

## Directory Structure

- `textures/` - Dice theme source files (textures, geometry, configurations)
  - Source of truth for all dice themes
  - These should be manually synced to `public/assets/themes/` when updated

## Build Process

### Content Assets
The following content files are automatically copied during build:

- `src/content/rules.md` → `public/rules.md` (dev) → `dist/rules.md` (build)

Run `npm run copy:assets` to manually copy content files.

### Static Assets (Textures/Themes)
Currently, dice themes are stored directly in `public/assets/themes/` and copied by Vite to `dist/assets/themes/` during build.

**TODO**: Set up automatic copying of theme files from `src/assets/textures/` to `public/assets/themes/` during build to avoid manual syncing.

## Adding New Content

1. Add markdown/text content to `src/content/`
2. Update `package.json` `copy:assets` script to include the new file
3. Update `vite.config.ts` static copy plugin if needed for build output

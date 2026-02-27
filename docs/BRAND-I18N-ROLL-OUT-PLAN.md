# Brand + I18N Rollout Plan

**Date:** 2026-02-27  
**Scope:** Frontend game branding centralization, safe brand string migration, and multilingual UI foundation.

## Current Execution Status (2026-02-27)
1. Phases 0-4 are functionally complete, including Wave A shell/menu/modal localization.
2. Wave A validation completed with:
   - `npx tsc --noEmit`
   - `npm run -s test:i18n`
   - `npm run -s build:dev`
3. Phase 5 (Wave B gameplay runtime notifications/messages) is intentionally paused until the active deployment error is diagnosed and fixed.

## Goals
1. Create a single typed source of truth for game brand metadata and UI-facing brand text.
2. Replace hardcoded `BISCUITS` / `bitches` mentions in safe scopes with configurable values.
3. Add multilingual support for in-game/menu/modal/button text in phases without breaking gameplay flow.
4. Protect backend routing/deployment identifiers from accidental replacement.

## Proposed Brand Config Contract
```ts
// src/config/game-brand.config.ts
export type GameBrandConfig = {
  productName: string;
  logoUrl: string;
  ogTitle: string;
  ogDescription: string;
  ageGateRequired: boolean;
  contentRatingNotes: string[];
};
```

## Audit Snapshot (Current Codebase)
1. Branding term hits (`biscuits|bitches|virtual-bitches`) in app-facing areas (`src`, `public`, `index.html`): `67`.
2. Branding term hits in infra/deploy-sensitive files (`api`, `scripts`, `firebase.json`, `package.json`, `vite.config.ts`): `10`.
3. No existing localization framework (`i18n`, `t()`, `data-i18n`) currently in use.
4. High-volume hardcoded user messaging:
   - `notificationService.show(...)` calls: `135` total.
   - `src/gameRuntime.ts` alone: `107`.
5. Template-heavy UI modules that will need localization passes:
   - `src/ui/settings.ts`, `src/ui/leaderboard.ts`, `src/ui/profile.ts`, `src/ui/updates.ts`, `src/ui/tutorial.ts`.

## Non-Negotiable Guardrails
1. Do not rewrite backend/deploy routing identifiers:
   - API/WS hostnames
   - Firebase project IDs/site IDs/service IDs
   - Cloud Run service IDs
   - package names used by deploy/runtime tooling
2. Do not mass-rewrite generated artifacts:
   - `public/updates.git.json`
3. Do not silently change localStorage key namespaces in-place:
   - existing `biscuits-*` keys should remain compatible until explicit migration logic is added.
4. Require dry-run report before any global replacement write.

## Phase Plan

### Phase 0: Foundation + Safety Tooling
**Deliverables**
1. Add `src/config/game-brand.config.ts` with strict validation helper.
2. Add `scripts/brand-audit.mjs` to report unsafe/safe occurrences.
3. Add `scripts/brand-rewrite.mjs` with:
   - `--dry-run`
   - explicit allowlist paths
   - explicit denylist paths
   - case-preserving replacement mode.

**Tests**
1. Unit tests for replacement casing behavior.
2. Script smoke test over fixture files (safe + blocked paths).

**Exit Criteria**
1. Dry-run output clearly separates "will replace" vs "blocked/protected" occurrences.

### Phase 1: Brand Config Integration (No Broad Rewrite Yet)
**Deliverables**
1. Introduce `brandService` (`src/config/brand.ts`) as runtime accessor.
2. Migrate immediate high-impact brand surfaces to config:
   - splash title/logo
   - loading title
   - social share defaults
   - page title + description + apple app title
   - manifest name/short_name/description
3. Keep existing backend/deploy URLs untouched.

**Implementation Notes**
1. Use Vite `transformIndexHtml` and static template injection for metadata that must exist before app bootstrap.
2. Keep `environment.gameTitle` temporarily for compatibility, then deprecate.

**Tests**
1. Build-time snapshot test for generated `<title>`/meta tags.
2. Runtime check that logo URL resolves from brand config.

**Exit Criteria**
1. Changing `productName`, `logoUrl`, `ogTitle`, `ogDescription` updates shell branding without manual string edits.

### Phase 2: Controlled Brand Text Migration
**Deliverables**
1. Run replacement tool in safe app scopes only:
   - `src/**` user-facing text
   - `index.html`
   - `public/manifest.json`
   - `src/content/rules.md` / `public/rules.md` where appropriate
2. Exclude protected infra/deploy files by default.
3. Add lint/check script to fail on new hardcoded `BISCUITS|BITCHES` in protected frontend scopes.

**Case Handling Rules**
1. `BISCUITS` -> `PRODUCTNAME` (uppercase)
2. `biscuits` -> `productname` (lowercase)
3. `Biscuits` -> `Productname` / title-cased words
4. Fallback -> raw configured `productName`

**Tests**
1. Regression test for case-preserving replacement function.
2. CI check for blocked replacements in infra files.

**Exit Criteria**
1. No stray brand literals in safe frontend scopes except approved exceptions.

### Phase 3: I18N Core Infrastructure
**Deliverables**
1. Add `src/i18n` with typed dictionaries:
   - `en-US` baseline
   - optional second language scaffold (for validation)
2. Add typed translator:
   - `t(key, params?)`
   - fallback locale behavior
   - missing-key logger in dev mode
3. Add locale setting in settings service and persistence.

**Tests**
1. Key parity test: all locales must match base key set.
2. Placeholder interpolation test coverage.

**Exit Criteria**
1. New UI text can be added only via translation keys in migrated modules.

### Phase 4: I18N Migration Wave A (Shell + Menus + Modals)
**Deliverables**
1. Migrate:
   - splash UI
   - loading screen
   - rules modal static labels
   - game-over modal labels
   - PWA prompt/update text
   - top-level button labels in `index.html`
2. Move menu/button/modal strings to dictionaries.

**Tests**
1. Locale switch updates all Wave A surfaces without reload issues.
2. Manual QA on desktop + mobile layout after language expansion.

**Exit Criteria**
1. Primary shell UX has no hardcoded English literals in migrated modules.

### Phase 5: I18N Migration Wave B (Gameplay Messaging + Settings)
**Deliverables**
1. Migrate `notificationService.show(...)` literals in:
   - `src/gameRuntime.ts`
   - `src/ui/settings.ts`
   - `src/main.ts`
2. Normalize server-driven user notifications where possible to message codes + localized rendering.

**Tests**
1. Notification snapshot tests by locale for key gameplay flows.
2. Multiplayer smoke tests to ensure sync messages still render correctly.

**Exit Criteria**
1. High-volume gameplay/status messaging is localized via keys.

### Phase 6: Hardening + Governance
**Deliverables**
1. CI checks:
   - brand literal guard
   - locale key parity
   - brand config shape validation
2. Developer docs for adding new brand fields/translations.
3. Cleanup/deprecation of temporary compatibility fields.

**Exit Criteria**
1. Branding/i18n are default workflows, not one-off edits.

## Recommended Execution Order
1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6

## Risk Notes
1. Changing storage prefixes/keys can orphan local user preferences and cached progress.
2. Replacing deploy identifiers can break API routing and hosting.
3. Large text migration in `gameRuntime.ts` is high-churn; keep it as a dedicated wave.
4. Server-originated free-text messages are harder to localize than typed message codes.

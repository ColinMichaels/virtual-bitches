# BISCUITS - TODO List

**Project Status**: Active Development • v1.0.0 • Last Updated: 2026-02-28 (player interactions refactor extracted + backlog archive cleanup)

This document tracks all pending work, active bugs, technical debt, and backlog items for the BISCUITS project.

Reference docs:
- Production-ready baseline features: `docs/PRODUCTION-READY-FEATURES.md`
- Archived completed TODO milestones: `docs/TODO-ARCHIVE-2026-02.md`

---

## 🔴 High Priority

### Branding + I18N Overhaul (2026-02-27)
- **Status**: 🟡 In Progress
- **Plan Doc**: `docs/BRAND-I18N-ROLL-OUT-PLAN.md`
- **Summary**:
  - Centralize game branding into typed config (`productName`, logo/meta fields, age gate metadata)
  - Add safe, case-preserving brand replacement tooling with protected infra/deploy allowlists
  - Implement typed localization system and migrate UI text in waves (shell first, gameplay messaging second)
- **Immediate Next Step**:
  - [x] Execute Phase 0 (safety tooling + dry-run audit) before any mass replacement writes
  - [x] Continue Phase 1 integration (brand config wiring for remaining shell/meta/splash surfaces)
  - [x] Start Phase 3 i18n scaffold (typed locale dictionaries + translator service)
  - [x] Add Wave A i18n coverage for rules modal, alpha warning modal, and game-over modal messaging/buttons
  - [x] Add locale key parity guard test (`src/i18n/i18n.test.ts`)
  - [x] Add Wave A i18n coverage for settings shell + tutorial shell with a new in-settings language selector
  - [x] Complete Wave A i18n migration for remaining shell/menu/modal surfaces (index HUD labels/buttons, account/admin status copy)
  - [x] Complete Wave A splash multiplayer localization key coverage and validation (`npx tsc --noEmit`, `test:i18n`, `build:dev`)
  - [x] Refactor splash actions for space + clarity:
    - remove splash `Replay Tutorial` button
    - keep replay entry in `How To Play` modal
    - add splash language switch with confirm + reload safety
    - add flagged/branded language selector treatment for splash/settings readability
  - [x] Diagnose active deployment error first (blocking next feature wave); capture build/deploy logs and root cause.
  - [ ] Begin Wave B i18n migration for gameplay runtime status/notification messaging (`gameRuntime.ts`, turn banners, scoring/action prompts) after deployment issue is resolved.

### Deployment Error Diagnostics (2026-02-27)
- **Status**: 🟡 Mitigation Applied, Pending CI Verification
- **Context**: Prioritize deployment stability before continuing Wave B gameplay messaging migration.
- **Progress (2026-02-27)**:
  - Winner-queue smoke failure reproduced from CI logs: `queue lifecycle did not auto-start a fresh round within expected wait window`.
  - Root cause identified: smoke timeout window (`12s`) was shorter than production post-round auto-start delay (`60s`).
  - Root cause extension identified: queue smoke polling used `/auth/refresh`, but that endpoint did not refresh participant liveness, allowing 45s stale-heartbeat pruning to expire the room before 60s auto-restart.
  - Mitigation applied:
    - increased queue lifecycle wait budget in `api/e2e/smoke.mjs` and set workflow env override in `.github/workflows/firebase-deploy.yml`
    - updated `/auth/refresh` to refresh participant liveness and session activity
    - added periodic heartbeat pings during queue lifecycle smoke polling
- **Tasks**:
  - [x] Capture exact failing step and error output (build, asset copy, hosting rewrite/proxy, or backend endpoint mismatch).
  - [x] Identify whether failure is frontend artifact, server runtime, environment variable, or dependency/version mismatch.
  - [x] Implement fix for observed queue-lifecycle wait-window mismatch.
  - [ ] Re-run GitHub Actions deploy smoke to confirm mitigation in CI.
  - [ ] Document root cause + mitigation in `docs/AUDIT-2026-02-25.md` follow-up section or a new deployment incident note.

### Beta Deployment + Security Readiness (2026-02-28)
- **Status**: 🟡 In Progress
- **Review Doc**: `docs/BETA-DEPLOYMENT-ARCHITECTURE-REVIEW.md`
- **Completed Foundations**:
  - [x] Added admin moderation-term smoke segment (`E2E_ASSERT_ADMIN_MODERATION_TERMS`) in `api/e2e/smoke.mjs`.
  - [x] Wired smoke toggles for admin monitor + admin moderation terms in `.github/workflows/firebase-deploy.yml`.
  - [x] Added separate admin deploy workflow scaffold (`.github/workflows/admin-deploy.yml`) for independent Firebase project lane.
- **P0 Before Beta Invite**:
  - [ ] Configure dedicated admin Firebase project credentials/secrets (`ADMIN_FIREBASE_PROJECT_ID_*`, `ADMIN_GCP_SA_KEY*`) and run first manual admin deploy.
  - [ ] Confirm prod admin access policy (`API_ADMIN_ACCESS_MODE`) and bootstrap owner allowlists match intended operator model.
  - [ ] Add explicit login/logout + profile-write smoke assertions to cover auth session lifecycle regressions.
  - [ ] Add deterministic leaderboard sync/read-back smoke assertion for single-player score persistence path.
  - [ ] Define and document token rotation procedure for `API_ADMIN_TOKEN` and emergency revocation runbook.
- **P1 Hardening**:
  - [ ] Add role-only admin smoke variant (no admin token path) for Firebase-role authorization validation.
  - [ ] Add structured Cloud Run log filters/alerts for websocket auth failures and moderation abuse spikes.

### Camera System & Machinima Tools (Phase 1 COMPLETE, Phase 2 PARTIAL) 📷
- **Status**: ✅ Phase 1 COMPLETE (2026-02-24) • 🟡 Phase 2 PARTIAL (2026-02-25 foundation work)
- **Complexity**: Medium (Phase 1), Very High (Full System)
- **Description**: Camera position management system with progressive unlocks and machinima tools
- **Documentation**:
  - Complete specification in `docs/CAMERA-SYSTEM.md` (800+ lines)
  - **NEW**: Camera Attack Integration in `docs/CAMERA-ATTACKS-INTEGRATION.md` (1000+ lines)
- **Phase 1 Implementation**:
  - ✅ CameraService with save/load/import/export (3 slots free tier)
  - ✅ Camera Controls Panel UI with teaser for locked features
  - ✅ Integration with GameScene (save/load positions)
  - ✅ Keyboard shortcut (C key) and button access
  - ✅ localStorage persistence
  - ✅ Tier-based access control (free/unlocked/premium)
- **Phase 2 Foundation Implemented**:
  - ✅ Smooth camera transition plumbing in `GameScene.setCameraPosition(..., animate)` (settings-gated)
  - ✅ Babylon animation/easing integration for alpha, beta, radius, and target interpolation
  - ✅ `SettingsService` camera schema defaults (`smoothTransitions`, `transitionDuration`, unlock flags)
  - ✅ `CameraService` testability improvements (injectable storage, state validation, explicit `off()` listener removal)
  - ✅ Camera service test suite scaffold (`src/services/cameraService.test.ts`)
  - ✅ Non-browser/runtime-safe storage fallback for `cameraService` singleton
- **Future Phases**:
  - 🟡 Phase 2: Enhanced Camera (in progress - smooth transitions core done; 10 slots/replay/per-seat still pending)
  - 🔒 Phase 3: Flying Mode (WASD controls, no-clip - Post-Multiplayer)
  - 🔒 Phase 4: Machinima Pro (paths, director mode, export - Premium Feature)
- **Files Created**:
  - `src/services/cameraService.ts` - Core service (500+ lines)
  - `src/ui/cameraControls.ts` - UI panel (430 lines)
  - `docs/CAMERA-SYSTEM.md` - Complete specification (800+ lines)
  - CSS styles added to `src/styles.css` (400+ lines)
- **Files Modified**:
  - `src/render/scene.ts` - Added settings-gated smooth transition animation support
  - `src/services/settings.ts` - Added/merged camera settings defaults
  - `src/services/cameraService.ts` - Added storage injection, validation, and listener unsubscribe helper
  - `src/main.ts` - Integrated camera panel
  - `src/controllers/InputController.ts` - Added C key and button handler
  - `index.html` - Added camera positions button
  - `package.json` - Added `test:camera` script
- **New Files in 2026-02-25 Update**:
  - `src/services/cameraService.test.ts` - Camera service unit-style test script
- **Result**: Players can save up to 3 camera positions now, and smooth camera transitions are partially implemented at engine/settings level
- **Immediate Next Work**:
  - 🔲 Expose camera smooth-transition controls in UI with proper unlock gating
  - 🔲 Complete remaining Phase 2 features (10 slots, replay timeline, per-player seat positions)

### Active Bugs

#### Color Material Transparency Issue
- **Status**: ✅ RESOLVED with custom shader material
- **Solution**: Implemented custom ShaderMaterial with GLSL shaders
- **Files Created**:
  - `src/render/colorMaterial.ts` - Custom material factory and shader definitions
  - `src/render/shaders.ts` - Shader registration with BabylonJS
- **How it Works**:
  - Custom vertex shader handles standard transformations
  - Custom fragment shader blends base color with texture based on alpha:
    - `alpha = 0` (transparent) → shows base die color
    - `alpha = 1` (opaque) → shows texture RGB (pips/numbers)
  - Includes proper lighting (Lambertian diffuse + Blinn-Phong specular)
  - Supports normal maps, specular maps, and all standard features
- **Result**: All 3 color material themes now work perfectly!
  - ✅ `default` - Solid colored dice with pip overlays
  - ✅ `smooth-pip` - Smooth dice with raised pip textures
  - ✅ `gemstone` - Translucent gem-like dice
- **Total Working Themes**: 8/8 (all themes functional)

#### Smooth-Pip d6 Texture Mapping
- **Status**: ✅ RESOLVED with per-die texture overrides
- **Root Cause**: d6 mesh UV coordinates only use 45% × 30% of texture space (U: 0.006-0.456, V: 0.002-0.304)
- **Solution**: Implemented per-die texture override system
- **Implementation**:
  - Added `perDieOverrides` field to theme.config.json for per-die texture scale/offset
  - d6 now uses scale 2.22×3.31 with offset -0.01×-0.01 (calculated from UV analysis)
  - Updated `DiceRenderer.createDie()` to clone materials and apply per-die overrides
  - Works with both StandardMaterial and ShaderMaterial (via texture cache)
- **Files Modified**:
  - `public/assets/themes/smooth-pip/theme.config.json` - Added perDieOverrides.d6
  - `src/render/dice.ts` - Implemented per-die texture override logic in createDie()
- **Result**: d6 pips now display correctly with proper UV scaling!

#### Review Follow-up Queue (2026-02-27)
- **Status**: 🟡 New
- **Scope**: Splash-theme consistency + updates/release-note pipeline hardening.
- **Tasks**:
  - [x] Release notes: include commit links in generated git updates and render clickable links in `Game Updates` panel (`scripts/generate-updates-from-git.mjs`, `src/ui/updates.ts`).
  - [x] Release notes: expose PR link metadata when PR number is detectable from commit subject/body.
  - [ ] Splash dice: reload geometry templates when theme changes if `meshFile` differs from currently loaded mesh source (`src/render/splashDice.ts`).
  - [ ] Splash dice: add texture load timeout/error fallback so failed texture fetch does not leave `createMaterial()` waiting indefinitely (`src/render/splashDice.ts`).
  - [ ] Release-notes generator: gracefully handle environments without `.git` history (fallback to empty updates file and warning) so `build/dev` do not hard fail (`scripts/generate-updates-from-git.mjs`).
  - [ ] Release-notes quality: optional commit message filtering/grouping for tester-facing notes (exclude chore-only/internal infra commits by default).
  - [ ] Cleanup: refresh stale inline comment in splash theme-change path ("fresh random cross-theme assignment") to match current behavior (`src/render/splashDice.ts`).

#### Finish-Up Shortlist (Review Break • 2026-02-27)
- **Status**: 🟡 Active
- **Goal**: Close high-value polish/stability items before next feature wave.
- **Top items**:
  - [ ] Complete CSS ecosystem audit for full themeability pass (buttons, inputs, sliders, badges, panel surfaces, state colors) and remove remaining hard-coded one-off colors.
    - Progress (2026-02-27): tokenized major UI surfaces including buttons/controls, settings tabs/account, dice focus + hint states, leaderboard accents, updates labels/links, debug sliders, and key rules/alpha/camera text accents.
    - Remaining: sweep modal overlays/panel edge cases, mobile menu action accents, and legacy one-off color/shadow values in less-used UI paths.
  - [ ] Finalize splash theme parity behavior so selected theme reliably controls splash dice mesh/material set.
  - [ ] Add explicit release-notes fallback behavior for non-git environments and test it in CI/local zip deployment flows.
  - [ ] Add regression tests for recent control/camera changes (`+/-` cycling, waiting-turn seat focus, easy-only camera assist behavior).
  - [ ] Create first-pass Player Emote System TODO spec (replace temporary seat text usage with structured emote/vo line system).
  - [ ] Run focused device QA pass (iPhone + Android + iPad) for settings, updates panel links, and camera focus flows.

#### Multiplayer Room Channel Messaging (2026-02-27)
- **Status**: 🟡 Baseline complete; follow-up UX + conduct system hardening pending
- **Archive**: Completed baseline milestones moved to `docs/TODO-ARCHIVE-2026-02.md`
- **Follow-up**:
  - [ ] Replace temporary `window.prompt(...)` compose flow with in-game chat/whisper modal UI.
  - [ ] Add block/unblock controls in Profile/Settings and sync with `blockedPlayerIds`.
  - [x] Add focused API/WebSocket smoke coverage for moderation rejection flows:
    - `kick` / `ban` moderation endpoint (`POST /api/multiplayer/sessions/:sessionId/moderate`)
    - `room_banned` join rejection
    - `interaction_blocked` realtime rejection
  - [x] Add chat-conduct smoke segment for strike accumulation + temporary mute (+ admin clear recovery path).
  - [x] Add admin tooling endpoints for reviewing/clearing chat strikes/mutes.
  - [x] Replace static banned-term config wiring with adaptive in-process term service (seed + managed + optional remote sync/poll + admin term management endpoints).
  - [ ] Expand chat conduct test matrix for mute-expiry timing and auto-ban threshold edge cases.
  - [ ] Extract in-process chat conduct enforcement into a standalone moderation service (contract stub documented in `docs/CHAT-CONDUCT-SERVICE-PLAN.md`).

#### Admin Portal (`/admin`) Angular Track (2026-02-28)
- **Status**: 🔵 Planned (documented, not started in pipeline)
- **Plan Doc**: `docs/ADMIN-PORTAL-ANGULAR-PLAN.md`
- **Intent**:
  - Build a separate Angular + Angular Material admin surface under `/admin`
  - Keep gameplay bundle lean and keep admin dependencies isolated
- **Next steps**:
  - [ ] Scaffold `/admin` Angular workspace with strict TS + Material baseline.
  - [ ] Implement auth bootstrap + role guards (`viewer`/`operator`/`owner`).
  - [ ] Build dashboard/rooms/conduct modules against current admin API.
  - [x] Add dedicated admin CI workflow scaffold separate from gameplay pipeline (`.github/workflows/admin-deploy.yml`).
  - [ ] Harden admin workflow with admin-app tests/smoke once `/admin` workspace lands.

#### Multiplayer Player Interaction Menu Scaffold (2026-02-28)
- **Status**: 🟡 Baseline complete and extracted into `src/ui/playerInteractions.ts`
- **Archive**: Completed scaffold milestones moved to `docs/TODO-ARCHIVE-2026-02.md`
- **Follow-up**:
  - [ ] Replace prompt-based whisper + chaos choice with dedicated in-modal composers.
  - [ ] Integrate gifting economy service/API and enable `Send Gift`.
  - [ ] Integrate friends service/API and enable `Add Friend`.
  - [x] Add moderation/block-list guards to interaction-menu actions (same rules as room-channel messaging).

#### Multiplayer Post-Round Queue + Lifecycle (2026-02-27)
- **Status**: 🟡 Baseline complete; UX polish/testing follow-up pending
- **Archive**: Completed baseline milestones moved to `docs/TODO-ARCHIVE-2026-02.md`
- **Follow-up**:
  - [ ] Add dedicated audio SFX asset for countdown (replace temporary click fallback).
  - [ ] Add focused regression for inactivity-expiry timer edge cases (already covered for restart path in e2e smoke).
  - [ ] Add HUD countdown timer UI (not only notifications) for next-game start clarity.

### Multiplayer Room Lifecycle, Recovery UX, and Tutorial Quality Pass (2026-02-26)
- **Status**: ✅ Foundation COMPLETE, follow-up polish tasks queued
- **Scope**: Reliability and usability upgrades for multiplayer sessions, fallback behavior, and onboarding flow
- **Completed**:
  - ✅ Room browser on splash with create/join flow and active-room refresh
  - ✅ Added private-room join-by-code flow (`/api/multiplayer/rooms/:roomCode/join`) with splash invite-code input, one-tap `Join Code` quick action, inline validation + backend failure/success feedback, and invite links carrying both `session` and `room` params
  - ✅ Room inactivity expiry lifecycle with server-side cleanup and room list integration
  - ✅ Session-expired in-game modal with two clear recovery actions:
    - Return to Lobby
    - Continue Solo
  - ✅ Solo fallback path prevents hard-lock when multiplayer session/auth expires
  - ✅ Reconnect-first multiplayer expiry flow (attempt rejoin before showing expiry modal)
  - ✅ Replaced browser `confirm(...)` usage in gameplay-critical flows with in-game modals
  - ✅ Added reusable `ConfirmModal` and dedicated `SessionExpiryModal`
  - ✅ Tutorial completion now auto-undoes guided score step so players can optimize selection
  - ✅ Tutorial rollback visual highlight pulse added to restored dice
  - ✅ How To Play modal now includes `Replay Tutorial` action
  - ✅ Rules content refreshed with current controls/multiplayer/session-recovery behavior
  - ✅ Extracted bot decision logic to dedicated API bot engine module (`api/bot/engine.mjs`)
  - ✅ Added bot engine contract tests (`api/bot/engine.test.mjs`)
  - ✅ Added multiplayer session service reliability tests for heartbeat expiry dispatch + auth/session clearing semantics (`src/multiplayer/sessionService.test.ts`)
  - ✅ Added client-side multiplayer turn-sync watchdog to auto-refresh stale turn state before hard lock
  - ✅ Added multiplayer HUD sync-status indicator (`Sync Live`/`Resyncing`/`Stale`/`Failed`) for live turn-sync debugging
  - ✅ Added admin metrics counters for timeout auto-advances and bot auto-advances
  - ✅ Added optional bot seeding on room join (`sessionId`/`roomCode`) and bot pruning when no live humans remain
  - ✅ Added explicit splash controls to separate create-room bots from join-room bot seeding
- **Files Added**:
  - `src/ui/confirmModal.ts`
  - `src/ui/sessionExpiryModal.ts`
- **Follow-up TODO (Next Iteration)**:
  - ✅ Added integration tests for session-expired choice flow (`recovered` vs `lobby` vs `continue solo`) via `src/multiplayer/sessionExpiryFlow.test.ts`
  - ✅ Continued bot intelligence tuning with game-level difficulty integration:
    - Easy mode now intentionally injects higher-risk scoring mistakes
    - Normal mode remains baseline/balanced behavior
    - Hard mode keeps tighter conservative scoring + faster decision tempo
  - [ ] Next bot pass: add dynamic playstyle shifts by match phase (opening/midgame/endgame) and player trend adaptation
  - ✅ Added optional replay-tutorial entry point from splash screen (pre-game)
  - [ ] Add regression test ensuring no browser `confirm(...)` remains in gameplay paths and migrate temporary chat `prompt(...)` compose flow to in-game modal UI

### Multiplayer Lobby Overlay + Room Browser/Difficulty Pass (2026-02-27)
- **Status**: ✅ Core implementation complete; focused QA/test follow-up pending
- **Scope**: Keep multiplayer controls stable in-view across devices, improve room discovery UX, and enforce room difficulty end-to-end.
- **Completed**:
  - ✅ Converted splash multiplayer options into overlay panel flow so controls stay centered/visible while options scroll.
  - ✅ Locked `Join Game` action to fixed modal footer placement (desktop + mobile), with disabled state until a valid room selection/code exists.
  - ✅ Updated multiplayer CTA behavior:
    - splash primary action label now switches to `Join Game` in multiplayer mode
    - join action remains disabled until a room is selected or a valid private code is present
  - ✅ Reworked room browser into card grid with stronger typography and clearer metadata hierarchy.
  - ✅ Added room difficulty levels (`easy` | `normal` | `hard`) to multiplayer room model and cards.
  - ✅ Added room-card difficulty badges using status palette:
    - easy -> success/green
    - normal -> warning/yellow
    - hard -> error/red
  - ✅ Added room filtering controls (name search, room type, difficulty, minimum players) and pagination controls.
  - ✅ Hid pagination controls automatically when filtered results fit the current page size.
  - ✅ Added no-result and loading placeholders to keep room-grid height stable and prevent layout jumping.
  - ✅ Added create-room section differentiation and private-room toggle flow with conditional room-name/player-limit inputs.
  - ✅ Moved join-seed bot controls into dedicated lower settings section and removed earlier duplicate placement.
  - ✅ Standardized modal controls to match app patterns:
    - close action uses modal-style `X`
    - refresh action uses compact icon button
  - ✅ Updated refresh icon implementation to shared SVG renderer (`src/ui/icons.ts`) for consistent use across surfaces.
  - ✅ Removed redundant `Clock` label text in multiplayer modal while keeping active timer value visible.
  - ✅ Updated multiplayer timer behavior so displayed time resets with each new game/round start.
  - ✅ Tightened stale-session cleanup:
    - room/player expiry checks reinforced
    - bot timeout disconnect/pruning behavior hardened
  - ✅ Added/confirmed backend + typing support for room difficulty persistence and join behavior.
  - ✅ Enforced room-selected difficulty for joiners so gameplay mechanics match room configuration.
  - ✅ Updated room queueing behavior to keep public difficulty availability balanced (at least one baseline room each for easy/normal/hard, with overflow as needed).
- **Follow-up TODO**:
  - [ ] Add targeted integration tests for difficulty inheritance/enforcement on room join and restart flows.
  - [ ] Add targeted API/service tests for queue replenishment guarantees per difficulty tier.
  - [ ] Run focused mobile-device QA for long room lists and extreme filter/no-result combinations.

### Mobile Menu + iOS Responsive + Admin Console UX Pass (2026-02-26)
- **Status**: ✅ Complete
- **Scope**: Mobile menu information hierarchy, camera quick-access ergonomics, iOS safe-area behavior, and admin tooling separation.
- **Completed**:
  - ✅ Reworked mobile burger menu into grouped sections (`Game`, `Social`, `Extras`) for cleaner scanability.
  - ✅ Added mobile `Return To Lobby` action directly in the burger menu.
  - ✅ Added mobile camera quick slots based on player pinned/saved camera positions (top 4), with preset fallback when no saved positions exist.
  - ✅ Updated mobile camera quick-slot selection ordering to prioritize pinned favorites first.
  - ✅ Hardened mobile menu behavior across viewport/orientation changes (auto-close + slot refresh).
  - ✅ Added iOS Safari viewport-safe handling (`100dvh` + `-webkit-fill-available`) and improved safe-area spacing behavior for control clusters.
  - ✅ Added short-height iPhone landscape-specific menu compaction to avoid clipping.
  - ✅ Added iPad touch breakpoint tuning for control density and modal safe-zone fit.
  - ✅ Moved admin monitor/debug controls out of Account tab body into a dedicated `Admin Console` modal launched from `Settings > Account`.
  - ✅ Standardized Settings footer action buttons to equalized heights and cleaner responsive layout.
- **Follow-up TODO**:
  - [ ] Device QA sweep on physical iPhone/iPad targets (SE, Plus/Max, iPad Mini, iPad Pro) with screenshot diff checklist.
  - [ ] Consider adding optional compact-label mode for burger-menu actions on ultra-short landscape devices.

### Theme Asset Copying and Deployment Robustness (2026-02-26)
- **Status**: ✅ COMPLETE
- **Completed**:
  - ✅ Theme asset copying/validation path tightened for dev/build/deploy parity
  - ✅ Prevented shader load failures caused by unresolved theme asset paths returning HTML
  - ✅ Build now validates theme assets during copy phase (`copy:assets`)
- **Follow-up TODO**:
  - [ ] Add CI smoke check that all configured theme asset URLs return non-HTML responses
  - [ ] Add explicit error UI for missing theme assets (instead of only console diagnostics)

### Multiplayer Variant Concept: Round-Based Full Turn Mode (Planned)
- **Status**: 🟡 Planned design note
- **Proposed Ruleset**:
  - Active player completes their full scoring run before turn passes (instead of per-roll handoff).
  - Round ends when all players have completed their dice for that round.
  - Room creation includes a configurable match target (number of rounds to win / play).
  - Match winner is determined from round wins across the configured match length.
- **Implementation Notes (Future)**:
  - Add multiplayer room config field: `turnMode` (`roll_by_roll` | `full_turn_round`).
  - Add room config field for round/match target.
  - Extend server turn state machine with explicit round-complete and match-complete transitions.
  - Keep current roll-by-roll mode as default for backward compatibility and gradual rollout.
- **Open Design Questions**:
  - Tie handling and round winner criteria (lowest score vs highest gain vs custom).
  - Timeout behavior for a full-turn player (partial progress rules).
  - Mid-round reconnect semantics and spectator/support handling.

### Friends System Foundation (Scaffold + Deferred Execution) (2026-02-26)
- **Status**: 🟡 Planned and scaffolded, implementation intentionally deferred
- **Rationale**: Friends/presence is strategic for multiplayer retention, but adding full social complexity now risks slowing room/turn stability work.
- **Completed in this pass**:
  - ✅ Added technical plan: `docs/FRIENDS-SYSTEM-PLAN.md`
  - ✅ Added client social contracts scaffold:
    - `src/social/friends/types.ts`
    - `src/social/friends/friendsService.ts`
  - ✅ Captured rollout gates so implementation starts only after multiplayer core mechanics are stable
- **Deferred TODO (post-stability gate)**:
  - [ ] Implement backend friends graph + request endpoints (send/accept/decline/remove/block)
  - [ ] Add presence heartbeat + batched presence lookup endpoints
  - [ ] Add friend-to-private-room invite flow (tokenized/secure)
  - [ ] Add lobby online-friends polling panel
  - [ ] Add privacy/abuse controls (rate limits, block-first semantics, invite/request expiry)

---

## 🟡 Medium Priority

### Live Ops / Admin Dashboard Foundation
- **Status**: 🟡 Foundation partial (2026-02-26) - monitoring scaffold shipped, privileged ops deferred
- **Description**: Internal tooling for monitoring active rooms/sessions and executing moderation/ops actions safely.
- **Completed**:
  - ✅ Added read-only monitoring endpoints:
    - `GET /api/admin/overview`
    - `GET /api/admin/rooms`
    - `GET /api/admin/metrics`
    - `GET /api/admin/storage`
  - ✅ Added configurable admin access modes (`auto` | `open` | `token` | `role` | `hybrid` | `disabled`)
  - ✅ Added role-protected admin access (Firebase-authenticated `viewer`/`operator`/`owner`)
  - ✅ Added owner role assignment API (`GET /api/admin/roles`, `PUT /api/admin/roles/:uid`) with bootstrap owner allowlists
  - ✅ Added dev-facing in-app monitor tooling launched from `Settings > Account` into dedicated `Admin Console` modal with:
    - room/participant/turn snapshots
    - aggregate room metrics
    - refresh control + persisted admin-token input
    - owner-only role management controls
  - ✅ Added admin audit trail endpoint (`GET /api/admin/audit`) and mutation audit logging for:
    - role updates
    - room expiry
    - participant removal
  - ✅ Added frontend admin UI feature flag (`VITE_ENABLE_ADMIN_UI`) so production can expose admin tooling intentionally without `debug=true`
- **Next Steps**:
  - [ ] Define retention policy and export strategy for admin audit history
  - ✅ Added first controlled admin mutations:
    - expire room
    - remove participant
  - [ ] Add additional controlled admin mutations (room visibility toggle, turn recovery helpers)
  - [ ] Add dedicated internal web dashboard for live operations and historical trend views

### Visual Settings & Dice Visibility Enhancement (COMPLETE) 🎨
- **Status**: ✅ Phase 1 COMPLETE (2026-02-25)
- **Complexity**: Medium
- **Description**: User-configurable table contrast settings for improved dice readability
- **Documentation**: Complete specification in `docs/VISUAL-SETTINGS.md` (500+ lines)
- **Phase 1 Implementation** (Table Contrast System):
  - ✅ Added VisualSettings interface with tableContrast property
  - ✅ Four contrast levels: low (brighter), normal, high (darker), maximum (darkest)
  - ✅ Dramatic diffuse color changes (0.7x to 1.2x multipliers)
  - ✅ Real-time material updates without scene reload
  - ✅ User notification feedback on setting changes
  - ✅ localStorage persistence with backwards compatibility
  - ✅ Enhanced dice materials (ambient + emissive colors)
  - ✅ Brightened dice color palette (~30% increase)
  - ✅ Added dedicated dice spotlights for improved visibility
  - ✅ Enhanced shadow properties (2048 resolution, sharper edges)
- **Files Created**:
  - `docs/VISUAL-SETTINGS.md` - Complete documentation with architecture
- **Files Modified**:
  - `src/services/settings.ts` - Added VisualSettings interface and updateVisual()
  - `src/render/scene.ts` - Added updateTableContrast() with diffuse color control
  - `src/ui/settings.ts` - Added Visual Settings section with notification feedback
  - `src/main.ts` - Apply contrast on startup and real-time onChange updates
  - `src/render/dice.ts` - Enhanced dice materials and brightened color palette
- **Future Work** (TODO):
  - 🔲 Fine-tune diffuse multiplier range if too extreme (consider 0.85-1.15)
  - 🔲 Add additional visual settings (dice brightness, lighting intensity, shadow strength)
  - 🔲 Implement color blind mode presets
  - 🔲 User testing and feedback collection on contrast effectiveness
  - 🔲 Consider ambient color adjustments for softer contrast changes
- **Result**: Users can now dramatically adjust table brightness with instant visual feedback!

### Particle System (Phase 1 & 2 - COMPLETE) ✨
- **Status**: ✅ Phases 1 & 2 COMPLETE (2026-02-24)
- **Complexity**: High
- **Description**: Centralized, event-driven particle system integrated with gameplay
- **Documentation**:
  - Complete specification in `docs/PARTICLE-SYSTEM.md` (2000+ lines)
  - Integration docs updated in `docs/CAMERA-ATTACKS-INTEGRATION.md`
- **Phase 1 Implementation** (Core System):
  - ✅ ParticleService with effect registry and pooling
  - ✅ Event-driven architecture with custom events
  - ✅ Quality settings (low/medium/high/ultra) with auto-detection
  - ✅ Network synchronization hooks for multiplayer
  - ✅ Integration with Camera, Player, and Chaos systems
  - ✅ Particle effect definitions (burst, trail, ambient, attack)
  - ✅ Preset helpers for game events, player actions, and chaos attacks
  - ✅ Refactored existing scene.ts particle usage
- **Phase 2 Implementation** (Gameplay Integration):
  - ✅ Dice score particles - gold burst when dice land in score area
  - ✅ Dice roll landing particles - white burst when dice hit table
  - ✅ Perfect roll celebration - confetti burst (already working)
  - ✅ Game completion celebration - confetti burst (already working)
- **Phase 2.5 Implementation** (Intensity Controls):
  - ✅ Added `particleIntensity` setting ("off" | "minimal" | "normal" | "enthusiastic")
  - ✅ Intensity multipliers in ParticleService (0%, 30%, 60%, 100%)
  - ✅ Reduced baseline particle scales: roll 0.25 (was 0.4), score 0.6 (was 1.0)
  - ✅ Reduced celebration scales: perfect 1.2 (was 2.0), complete 1.0 (was 1.6)
  - ✅ Adaptive burst counts: minimal=0, normal=2-3, enthusiastic=4
  - ✅ Default "normal" intensity = 60% of previous particle amount
- **Files Created**:
  - `src/services/particleService.ts` - Core service (800+ lines)
  - `src/particles/effects/burstEffects.ts` - Burst particle definitions
  - `src/particles/effects/trailEffects.ts` - Trail particle definitions
  - `src/particles/effects/ambientEffects.ts` - Ambient particle definitions
  - `src/particles/effects/attackEffects.ts` - Attack particle definitions
  - `src/particles/presets/gameEffects.ts` - Game event helpers
  - `src/particles/presets/playerEffects.ts` - Player action helpers
  - `src/particles/presets/chaosEffects.ts` - Chaos attack helpers
  - `docs/PARTICLE-SYSTEM.md` - Complete documentation with intensity section
- **Files Modified**:
  - `src/main.ts` - Initialize ParticleService, register effects, apply intensity
  - `src/render/scene.ts` - Refactored particles, added intensity-aware celebrations
  - `src/render/dice.ts` - Added particles with reduced baseline scales
  - `src/services/settings.ts` - Added particleIntensity to DisplaySettings
  - `src/services/particleService.ts` - Added intensity system with multipliers
  - `docs/CAMERA-ATTACKS-INTEGRATION.md` - Added particle integration details
- **Future Phases**:
  - 🔒 Phase 3: Advanced effects (custom shaders, animated sprites, mesh particles)
  - 🔒 Phase 4: Particle editor for custom effects
  - 🔒 Phase 5: Settings UI dropdown for particle intensity control
- **Stability Policy (2026-02-26)**:
  - ✅ Reduced ParticleService runtime log noise (throttled repeated warnings/errors, removed per-instance emit/stop logs)
  - ✅ Resolved `emitAtPlayer(...)` placeholder by wiring playerId -> multiplayer seat world-position resolver from game runtime
  - ✅ Particle polish/fx expansion is now intentionally deferred until multiplayer and core gameplay mechanics are stabilized
  - ✅ Upgrade particle anchors from seat score-zone center to avatar/head mesh anchors for multiplayer participant callouts/effects
  - [ ] Re-open particle flair work only after multiplayer sync/gameplay mechanics stabilization milestone is marked complete
- **Result**: Balanced, configurable particle system with 60% less visual noise by default! 🎉

### Recently Completed (Session 2026-02-24)

#### Code Refactoring - Controllers Pattern
- **Status**: ✅ COMPLETE
- **Objective**: Extract main.ts into focused controllers to reduce complexity
- **Results**:
  - Reduced main.ts from **954 lines to 570 lines** (40% reduction)
  - Extracted 3 new controllers totaling ~600 lines
  - Improved separation of concerns and testability
- **New Files Created**:
  - `src/controllers/InputController.ts` (~326 lines)
    - Handles all user input: buttons, keyboard, mobile menu
    - Uses callback interface pattern for loose coupling
  - `src/controllers/GameFlowController.ts` (~130 lines)
    - Manages game lifecycle: initialization, new games, mode switching
    - Static utility methods (stateless design)
  - `src/controllers/GameOverController.ts` (~143 lines)
    - Handles end-game flow: score display, ranking, seed sharing
    - Instance-based for DOM element management
  - `src/utils/urlUtils.ts` (~24 lines)
    - URL parsing and seed generation utilities
- **Files Modified**:
  - `src/main.ts` - Refactored to use controllers, implements GameCallbacks interface
  - `docs/ARCHITECTURE.md` - Added Controllers Layer section
  - `README.md` - Updated architecture diagram
- **Design Patterns Applied**:
  - Callback Interface Pattern (InputController)
  - Static Utility Pattern (GameFlowController)
  - Instance-based Controller (GameOverController)
- **Build Status**: ✅ All TypeScript compilation passes
- **Documentation**: ✅ Architecture docs updated

#### Build System & GitHub Pages Deployment
- **Status**: ✅ COMPLETE
- **Implemented**:
  - **Angular-style Build Process**:
    - Added `vite-plugin-static-copy` for build-time file copying
    - Created `copy:assets` script that runs before all dev/build commands
    - Source files stay in `src/content/`, generated copies in `public/` (dev) and `dist/` (build)
    - Added `public/rules.md` to `.gitignore` (generated file)
  - **GitHub Pages Path Fixes**:
    - Changed all asset paths from absolute (`/`) to use `import.meta.env.BASE_URL`
    - Works correctly for both root (`/`) and subdirectory (`/virtual-bitches/`) deployment
    - Fixed paths in: geometryLoader, rules UI, themeManager, dice renderer, splash dice
  - **TypeScript Configuration**:
    - Added `"types": ["vite/client"]` for `import.meta.env` typings
  - **Documentation**:
    - Created `src/assets/README.md` explaining asset management system
- **Files Modified**:
  - `vite.config.ts` - Added static copy plugin
  - `package.json` - Added `copy:assets` script to all build commands
  - `tsconfig.json` - Added Vite client types
  - `.gitignore` - Added generated files
  - `src/render/geometryLoader.ts` - BASE_URL for smoothDice.json
  - `src/ui/rules.ts` - BASE_URL for rules.md
  - `src/services/themeManager.ts` - BASE_URL for theme paths
  - `src/render/dice.ts` - BASE_URL for material loading
  - `src/render/splashDice.ts` - BASE_URL for splash materials
- **Files Created**:
  - `src/assets/README.md` - Asset management documentation
- **Result**: Clean build system with no file duplication, works on GitHub Pages subdirectories

#### UI Cleanup - Keyboard Shortcuts
- **Status**: ✅ COMPLETE
- **Changes**:
  - Removed "New Game" and "Debug View" buttons from UI
  - Added keyboard shortcuts: **N** for New Game, **D** for Debug View
  - Changed deselect shortcut from **D** to **X** to avoid conflict
  - Updated all documentation and tutorials with new shortcuts
- **Result**: Cleaner UI with keyboard-first control scheme
- **Files Modified**:
  - `index.html` - Removed button elements
  - `src/main.ts` - Added keyboard handlers, removed button listeners
  - `src/ui/tutorial.ts` - Updated controls documentation

#### Mobile/Touch UX Enhancements
- **Status**: ✅ COMPLETE
- **Implemented Features**:
  - **Touch Target Sizes**: All interactive elements now meet 44px minimum (Apple/Android guidelines)
    - Settings/Leaderboard buttons: 36-40px → 44px
    - Camera controls: 32-38px → 44px
    - Dice touch targets: 42-48px → 46-50px
    - Increased spacing between elements (5-8px gaps)
  - **Touch Visual Feedback**: Added `:active` states with scale transforms
    - Buttons, dice, camera controls all have touch feedback
    - `-webkit-tap-highlight-color: transparent` to prevent default highlight
  - **Passive Event Listeners**: Touch events marked as `passive: true` for better scroll performance
  - **iOS Safe Area Support**:
    - Added `viewport-fit=cover` to meta tag
    - Implemented `env(safe-area-inset-*)` for all edges
    - All UI elements respect iPhone notches and home indicators
  - **Haptic Feedback**:
    - Created `src/services/haptics.ts` with Vibration API
    - Patterns: light, medium, heavy, selection, success, warning, error
    - Integrated throughout game (rolls, selections, scores, buttons)
    - Settings toggle (auto-hides on unsupported devices)
  - **PWA Support**:
    - Created `public/manifest.json` with app metadata
    - Created `public/sw.js` with service worker for offline caching
    - Implemented `src/services/pwa.ts` for install prompts and updates
    - Install banner with 7-day dismissal cooldown
    - App shortcuts (New Game, Leaderboard)
    - Offline play capability
- **Files Created**:
  - `src/services/haptics.ts`
  - `src/services/pwa.ts`
  - `public/manifest.json`
  - `public/sw.js`
- **Files Modified**:
  - `src/styles.css` (touch targets, active states, PWA UI, safe area support)
  - `src/main.ts` (haptic integration)
  - `src/ui/settings.ts` (haptics toggle)
  - `src/services/settings.ts` (haptics setting)
  - `index.html` (PWA meta tags, manifest link)
- **Result**: Native-like mobile experience with haptics, offline support, and touch-optimized UI

### In-Progress Work

#### Theme System Polish
- **Status**: 8/8 themes working perfectly ✅
- **Working Standard Material Themes**: diceOfRolling, wooden, smooth, rust, blueGreenMetal
- **Working Color Material Themes**: default, smooth-pip, gemstone
- **Tasks**:
  - [x] Added baseline UV coordinates to all themes
  - [x] Implemented custom shader for color materials
  - [x] All 8 themes now functional and enabled
  - [ ] Fine-tune UV coordinates using DebugView (Alt+D)
  - [ ] Test all themes across different dice types (d4, d6, d8, d10, d12, d20)
  - [ ] Verify lighting/shadow consistency across themes

#### Documentation Completion
- **Status**: 4/4 complete ✅
- **Completed**:
  - ✅ ARCHITECTURE.md (comprehensive system overview with logging system docs)
  - ✅ TODO.md (this file - active task tracking)
  - ✅ FUTURE-FEATURES.md (roadmap with AI prompts)
  - ✅ THEME-SYSTEM.md (complete theme development guide)

---

## 🟢 Low Priority / Backlog

### Future Features (See FUTURE-FEATURES.md)

#### Player Emote System (Avatar Reactions)
- **Status**: 🔵 Planned
- **Context**: Seat chat currently uses simple text-above-head overlays; replace with a custom emote/reaction system.
- **Tasks**:
  - [ ] Design custom emote visuals for player avatars (non-chat-bubble style)
  - [ ] Add emote trigger pipeline for local + multiplayer events
  - [ ] Add settings controls to mute/disable emotes

#### Social Share Metadata Completion
- **Status**: 🟡 In progress
- **Completed**:
  - ✅ Facebook/Open Graph/Twitter share template now points at BISCUITS production URL + CDN ad image
  - ✅ Runtime social share defaults aligned with production URLs
- **Next Steps**:
  - [ ] Create Facebook App and set `VITE_FACEBOOK_APP_ID` in GitHub Environment vars (`dev` + `prod`)
  - [ ] Validate final OG previews with Facebook Sharing Debugger and X/Twitter Card Validator
  - [ ] Reconfirm canonical URL if/when custom domain replaces `biscuits-488600.web.app`

#### Camera Attack Integration System 💥📷
- **Status**: 🟡 PHASE 4 CLIENT INTEGRATION IN PROGRESS (2026-02-25)
- **Complexity**: Very High
- **Description**: Weaponized camera manipulation for multiplayer psychological warfare
- **Documentation**: Complete specification in `docs/CAMERA-ATTACKS-INTEGRATION.md` (1000+ lines)
- **Implemented Foundation**:
  - ✅ `CameraEffectsService` runtime (`src/services/cameraEffects.ts`) with shake/spin/zoom/drunk effects
  - ✅ Drunk vision post-processing pipeline (`src/chaos/effects/postProcessingPipeline.ts`) with blur/double-vision/vignette/blackout hooks
  - ✅ Effect conflict queue/stacking policy (per-type caps, queued drain, drunk-child reserved stacking lane)
  - ✅ Active camera effect HUD (`src/ui/effectHUD.ts`) with live timers/intensity/queue indicators
  - ✅ Effect lifecycle controls (active list, stop, clear) + timing/cleanup handling
  - ✅ Particle integration hooks for shake/spin/drunk effects
  - ✅ `CameraAttackExecutor` (`src/chaos/cameraAttackExecutor.ts`) for typed message → camera effect mapping
  - ✅ Main-thread event bridge (`chaos:cameraAttack`) wired in `src/main.ts`
  - ✅ Multiplayer WebSocket bridge (`src/multiplayer/networkService.ts`) for camera attack + particle delivery
  - ✅ Unit-style tests for attack mapping (`src/chaos/cameraAttackExecutor.test.ts`)
  - ✅ Unit-style tests for network bridge routing (`src/multiplayer/networkService.test.ts`)
  - ✅ Unit-style tests for camera effect queue/post-processing behavior (`src/services/cameraEffects.test.ts`)
  - ✅ Upgrade progression scaffolding (`src/chaos/upgrades/progressionService.ts`) with XP/tokens/unlock validation + persistence
  - ✅ Upgrade definitions for three attack families (`src/chaos/upgrades/definitions.ts`)
  - ✅ Unit-style tests for progression scaffolding (`src/chaos/upgrades/progressionService.test.ts`)
  - ✅ `ChaosUpgradeMenu` UI scaffold (`src/ui/chaosUpgradeMenu.ts`) wired to desktop/mobile controls + `U` hotkey
  - ✅ Progression-to-execution profile mapping + message builder (`src/chaos/upgrades/executionProfile.ts`)
  - ✅ Upgrade menu local cast bridge (`chaos:cameraAttack`) using unlocked level stats
  - ✅ Control inversion runtime (`src/services/controlInversion.ts`) wired into input and drunk attacks
  - ✅ Accessibility safeguards in settings + executor (`reduceChaosCameraEffects`, `allowChaosControlInversion`)
  - ✅ Unit-style tests for execution profile mapping (`src/chaos/upgrades/executionProfile.test.ts`)
  - ✅ Unit-style tests for control inversion behavior (`src/services/controlInversion.test.ts`)
  - ✅ Typed backend API client scaffold (`src/services/backendApi.ts`) for profile/log/session routes
  - ✅ Player data sync scaffold (`src/services/playerDataSync.ts`) for settings/progression/log queue sync
  - ✅ Sync reliability foundation in `PlayerDataSyncService` (dirty-profile sync + retry backoff/jitter + queue compaction/dedupe + deterministic score log IDs)
  - ✅ Service worker log upload bridge (`src/services/pwa.ts` + `public/sw.js`)
  - ✅ Multiplayer session API scaffold (`src/multiplayer/sessionService.ts`) with join/create/heartbeat/leave hooks
  - ✅ Session-aware multiplayer socket rebinding in `main.ts` (API session `wsUrl`/`playerToken` now updates live network connection)
  - ✅ Auth session service + 401 recovery (`src/services/authSession.ts`, `src/services/backendApi.ts`) with token refresh and session-expired handling
  - ✅ WebSocket auth-expiry recovery path (`src/multiplayer/networkService.ts`) with session auth refresh callback
  - ✅ Multiplayer attack feedback loop (`sent`/`sendFailed`/`received`/`applied`) wired to HUD notifications in `src/main.ts`
  - ✅ Backend skeleton started in `/api` (HTTP server scaffold + SQL schema/migrations + profile/log/session/auth endpoints)
  - ✅ Firebase migration strategy documented (`docs/FIREBASE-MIGRATION-PLAN.md`) for moving from GitHub Pages to Firebase Hosting + Cloud Run
  - ✅ Firebase Phase 1 bootstrap files added (`firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `.env.firebase.example`, `docs/FIREBASE-SETUP.md`)
  - ✅ GitHub Actions deploy workflow added (`.github/workflows/firebase-deploy.yml`) for auto-deploy on `master`/`dev` using GitHub Secrets
  - ✅ Unit-style tests for backend API request handling (`src/services/backendApi.test.ts`)
- **Key Features**:
  - Camera Effects API (shake, spin, zoom, tilt, drunk vision)
  - Drunk Vision system (3 severity levels: Tipsy, Hammered, Blackout)
  - 5-level upgrade trees for each attack family
  - XP progression + Chaos Token economy
  - Premium "Party Mode" & "Spell Pack" DLC effects
  - Anti-frustration safeguards (diminishing returns, immunity, rage quit protection)
- **Attack Families**:
  - Screen Shake (5 levels: Basic → Aftershock → Earthquake → Tremor → Catastrophe)
  - Drunk Vision (5 levels: Tipsy → Double Shot → Long Island → Keg Stand → Alcohol Poisoning)
  - Camera Spin (5 levels: Dizzy Spell → Vertigo → Washing Machine → Blender → Inception)
- **Dependencies**:
  - Requires Camera System (Phase 1 ✅ complete)
  - Requires Chaos Gameplay Mechanics infrastructure
  - Requires Multiplayer system for networked attacks
  - Requires WebSocket server for cross-client attack delivery
  - BabylonJS Post-Processing pipeline (implemented client-side; tuning pending)
- **Implementation Timeline**: ~10 weeks (5 phases)
- **Monetization**: Chaos Pass ($4.99/mo), IAP packs, Battle Pass
- **Implementation Priority**: Next up is production backend/API+DB implementation (profiles/settings/logs), authenticated sync/conflict semantics, and multiplayer backend/session rollout

#### Chaos Gameplay Mechanics System
- **Status**: DOCUMENTED (not yet implemented)
- **Complexity**: Very High
- **Description**: Multiplayer "psychosocial warfare" system with player attacks, distractions, and time pressure
- **Documentation**: Complete specification in `docs/CHAOS-GAMEPLAY-MECHANICS.md` (700+ lines)
- **Key Features**:
  - 50+ attack abilities (Visual, Audio, UI, Dice, Time manipulation)
  - Time Attack game mode variants (7 different formats)
  - Insult & Taunt System (300+ taunts, AI generation, emotes)
  - Chaos Points economy with ability progression
  - 7 game modes including Team Chaos and Survival
  - Comprehensive anti-toxicity systems
- **Dependencies**:
  - Requires 8-player multiplayer mode complete
  - Backend WebSocket infrastructure
  - User authentication and profiles
  - Time attack game mode implementation
- **Implementation Priority**: Post-multiplayer (Phase 4+)
- **AI Prompt**:
  ```
  Implement Chaos Gameplay Mechanics per docs/CHAOS-GAMEPLAY-MECHANICS.md. Start with ability system (src/chaos/abilities.ts), Chaos Points economy (src/chaos/economy.ts), and ability bar UI (src/chaos/ui/AbilityBar.ts). Follow the technical implementation section for file structure and type definitions. Ensure all anti-toxicity safeguards are implemented.
  ```

### Performance Optimizations

#### Reduce Bundle Size
- **Current**: ~2.5MB production bundle
- **BabylonJS Core**: ~1.8MB (largest dependency)
- **Target**: <2MB total
- **Options**:
  - Tree-shake unused BabylonJS modules
  - Consider ES6 module imports instead of full core
  - Lazy-load theme assets
  - Optimize texture sizes (current: 1024x1024, consider 512x512)
- **AI Prompt**:
  ```
  Optimize the BISCUITS bundle size currently at ~2.5MB. Analyze vite.config.ts and package.json to reduce BabylonJS core imports, implement tree-shaking, and consider lazy-loading theme assets. Target <2MB production bundle.
  ```

#### Improve Frame Rate
- **Current**: 60fps on desktop, ~40fps on mobile
- **Target**: Stable 60fps across all devices
- **Options**:
  - Reduce shadow map resolution
  - Implement LOD for dice meshes
  - Optimize physics calculations
  - Consider worker thread for engine updates
- **AI Prompt**:
  ```
  Profile and optimize BISCUITS rendering performance. Focus on mobile devices where frame rate drops to ~40fps. Consider shadow optimization, LOD systems, and physics calculation improvements in src/render/diceRenderer.ts.
  ```

### Music Player System 🎵
- **Status**: ⚠️ MUTED BY DEFAULT (functionality preserved, disabled until proper system developed)
- **Complexity**: Medium
- **Description**: Develop full music player system with track selection and controls
- **Current State** (2026-02-25):
  - ✅ Music generation system complete (procedural ambient drone)
  - ✅ Audio API functional (playMusic/stopMusic)
  - ✅ Settings UI present (volume slider + enable checkbox)
  - ⚠️ Music DISABLED by default (musicEnabled: false, musicVolume: 0)
  - All functionality preserved for future development
- **Future Features**:
  - [ ] Multiple music tracks
  - [ ] Track selection UI
  - [ ] Play/pause controls in HUD
  - [ ] Playlist management
  - [ ] Volume fade in/out
  - [ ] Context-aware music (menu vs gameplay vs game over)
  - [ ] User-uploaded music support
  - [ ] Spotify/streaming integration (premium feature?)
- **Files Involved**:
  - `src/services/audio.ts` - Music generation and playback
  - `src/services/settings.ts` - Music settings (line 57-59: defaults set to 0/false)
  - `src/ui/settings.ts` - Music controls UI
- **Implementation Priority**: Post-alpha (after core gameplay polish)
- **AI Prompt**:
  ```
  Implement a music player system for BISCUITS. Create multiple ambient music tracks, add UI controls for track selection and playback, and integrate with the existing audio service in src/services/audio.ts. Consider context-aware music that changes based on game state.
  ```

### Additional Themes

#### Import Community Themes
- **Source**: dice-box library has 20+ themes
- **Status**: 8 themes ported, 12+ available
- **Priority Themes**:
  - Gemstone (needs color material fix first)
  - Metal
  - Glass
  - Neon
- **Tasks**:
  - [ ] Port remaining dice-box themes
  - [ ] Create theme preview gallery
  - [ ] Add theme search/filter UI
- **AI Prompt**:
  ```
  Port additional themes from the dice-box library to BISCUITS. Focus on metal, glass, and neon themes. Each theme requires copying assets to src/assets/textures/{theme-name}/ and creating a theme.config.json following the existing pattern.
  ```

#### Create Original Themes
- **Ideas**:
  - Candy (colorful translucent)
  - Paper (origami style)
  - Ice (frosted transparent)
  - Circuit Board (tech aesthetic)
  - Galaxy (nebula textures)
- **AI Prompt**:
  ```
  Design and implement an original "Galaxy" theme for BISCUITS dice. Create or source nebula/star textures, configure theme.config.json with appropriate material properties, and test across all die types. Follow the theme system architecture in docs/THEME-SYSTEM.md.
  ```

### Mobile Experience

#### Touch Controls
- **Status**: Core touch UX complete; advanced gestures pending
- **Improvements Needed**:
  - [x] Add haptic feedback for rolls/selections
  - [x] Improve touch target sizes (min 44x44px)
  - [ ] Add multi-touch gesture support
  - [x] Better visual feedback for touch events
- **AI Prompt**:
  ```
  Enhance mobile touch controls for BISCUITS. Add haptic feedback, increase touch target sizes for die selection, and improve visual feedback. Update src/render/components/DiceRenderer.ts pointer event handlers.
  ```

#### Responsive UI
- **Status**: 🟡 Significant iOS/mobile polish complete; targeted refinements remain
- **Current State**:
  - ✅ Mobile burger menu grouped/restructured for readability
  - ✅ iPhone/iPad safe-area spacing hardened for control clusters and menus
  - ✅ Tutorial/settings modal fit behavior improved for mobile safe zones
- **Remaining Issues**:
  - [ ] Score panel clarity on very small phones
  - [ ] Theme selector density on narrow-width layouts
- **AI Prompt**:
  ```
  Improve responsive design for BISCUITS mobile layout. Focus on score panel visibility, theme selector usability, and tutorial text readability on small screens. Update CSS in src/render/components/*.ts files.
  ```

### Code Quality

#### Test Coverage
- **Current**: Unit-style and e2e smoke tests exist, but no unified coverage metric yet
- **Target**: >80% coverage
- **Priority**:
  - [ ] Unit tests for engine layer (pure functions)
  - [ ] Integration tests for state management
  - [ ] Visual regression tests for themes
- **AI Prompt**:
  ```
  Set up testing infrastructure for BISCUITS. Create unit tests for src/engine/*.ts pure functions, integration tests for state management, and consider Playwright for visual regression testing of themes.
  ```

#### TypeScript Strictness
- **Current**: `strict: true` in tsconfig.json ✅
- **Improvements**:
  - [ ] Add JSDoc comments to all public APIs
  - [ ] Eliminate remaining `any` types
  - [ ] Add runtime type validation for config files
- **AI Prompt**:
  ```
  Improve TypeScript type safety in BISCUITS. Add JSDoc comments to all public APIs, eliminate any remaining 'any' types, and implement runtime validation for theme.config.json files using Zod or similar.
  ```

#### Refactoring Opportunities

**DiceRenderer.ts**
- **Issue**: 500+ lines, multiple responsibilities
- **Solution**: Extract theme application, animation, and face detection into separate modules
- **Priority**: Low (works well, just large)

**themeManager.ts**
- **Issue**: Texture loading logic could be more robust
- **Solution**: Add error handling, retry logic, and loading state management
- **Priority**: Medium (affects UX when themes fail to load)

**state.ts**
- **Issue**: Action log grows unbounded
- **Solution**: Implement circular buffer or periodic trimming
- **Priority**: Low (only matters for very long sessions)

---

## 📋 Technical Debt

### Cleanup Tasks

- [x] Remove unused imports across codebase
- [ ] Consolidate duplicate color utility functions
- [ ] Standardize error handling patterns
- [x] Add consistent logging with log levels
- [x] Document all magic numbers with constants

### Build System

- [x] Add development/production environment configs
- [x] Set up automated deployment pipeline (GitHub Actions)
- [x] Add bundle size monitoring
- [x] Configure source maps for production debugging
- [ ] Add pre-commit hooks (lint, format, type-check)

### Dependencies

- [ ] Audit and update all dependencies to latest stable
- [x] Remove unused dependencies (audit package.json)
- [ ] Add dependency vulnerability scanning
- [ ] Document version constraints and upgrade paths

---

## ✅ Recently Completed

### Octagon Table Texture & Asset Loading Infrastructure (2026-02-24 Late Evening)
- ✅ **Custom octagon table texture implementation**
  - Applied user-provided 1024×1024 square felt texture to octagon play area
  - Perfect radial UV mapping (1:1 scale, no distortion or stretching)
  - Automatic procedural fallback if texture fails to load
  - Error handling with console logging for debugging
- ✅ **Splash screen gradient background**
  - Added atmospheric gradient matching game scene (blue-gray to dark)
  - Visual consistency across splash → loading → game screens
- ✅ **Loading screen component system**
  - Created `src/ui/loadingScreen.ts` with progress tracking
  - Task-based and manual progress modes
  - Animated dice spinner with gradient background
  - Ready for integration with asset loading
- ✅ **Service worker & asset loading strategy documentation**
  - Created `docs/SERVICE-WORKER-STRATEGY.md` (450+ lines)
  - Comprehensive PWA optimization roadmap
  - PRPL pattern implementation guide
  - Multiplayer preparation with Web Workers strategy
  - Phase-based implementation timeline
- ✅ **Texture optimization documentation**
  - Created `docs/TEXTURE-OPTIMIZATION.md`
  - WebP conversion guidelines (2.2 MB → 300 KB)
  - Power-of-2 dimension recommendations
  - KTX2/Basis Universal for future scaling
  - Tool recommendations and comparison tables
- **Files Created**:
  - `src/ui/loadingScreen.ts` - Progress tracking loading screen
  - `docs/SERVICE-WORKER-STRATEGY.md` - Comprehensive asset loading strategy
  - `docs/TEXTURE-OPTIMIZATION.md` - Texture optimization guide
  - `public/assets/textures/table-felt.png` - Custom 1024×1024 table texture
- **Files Modified**:
  - `src/ui/splash.ts` - Added gradient background
  - `src/render/scene.ts` - Custom texture loading with fallback
  - `src/styles.css` - Loading screen styles
- **Result**: Production-ready custom branding on game table, infrastructure for future loading optimization

### Fallback Theme System & Debug Enhancements (2026-02-24 Evening)
- ✅ **Implemented fallback theme system**
  - Themes can specify `fallbackTheme` and `useFallbackFor` in config
  - Per-die material selection based on fallback rules
  - smooth-pip theme: d6 uses pip texture, all others fallback to smooth with numbers
- ✅ **Material cache for fallback themes**
  - DiceRenderer and SplashDiceRenderer cache both primary and fallback materials
  - Proper material selection based on die type at render time
- ✅ **Unified splash screen rendering**
  - Splash screen now uses same theme system as main game
  - Applies texture scale/offset from theme configs
  - Respects fallback theme configuration
  - Matches main game rendering logic exactly
- ✅ **Enhanced debug view**
  - Added material variant switcher (light/dark) for color materials
  - Material variant control auto-hides for standard material themes
  - Per-die texture updates (only updates current die's material)
  - Shows theme info including fallback status
  - Enhanced console logging for texture update debugging
- ✅ **WeakMap texture cache**
  - Changed from string-based lookup to instance-based WeakMap
  - More reliable texture reference tracking for ShaderMaterials
  - Proper cleanup and garbage collection
- ✅ **Theme configuration updates**
  - smooth-pip: Configured for d6 only (fallback to smooth for d4/d8/d10/d12/d20)
  - Added texture scale 2.0×2.0 for smooth-pip d6
  - Documented theme-specific requirements

### Custom Shader & Theme System (2026-02-24 Morning)
- ✅ **Implemented custom shader material for color themes** (MAJOR FEATURE)
  - Created `src/render/colorMaterial.ts` with custom GLSL shaders
  - Vertex shader: Standard transformations with UV/normal passthrough
  - Fragment shader: Blends solid base color with RGBA texture alpha
  - Proper Lambertian diffuse + Blinn-Phong specular lighting
  - Supports normal maps and specular maps
- ✅ **Fixed color material transparency issue**
  - All 3 color material themes now render correctly
  - Solid die bodies with transparent texture overlays working
  - `default`, `smooth-pip`, `gemstone` themes fully functional
- ✅ **Re-enabled all 8 themes** (8/8 working)
  - 5 standard material themes (diceOfRolling, wooden, blueGreenMetal, rust, smooth)
  - 3 color material themes (default, smooth-pip, gemstone)
  - Theme system now complete and production-ready

### Code Quality & Documentation (2026-02-24)
- ✅ Implemented centralized logging system with environment-aware levels
- ✅ Migrated 79+ console statements to logger utility across 10 files
- ✅ Extracted magic numbers to named constants in dice.ts
- ✅ Added comprehensive JSDoc documentation to engine and game layers
- ✅ Removed unused @babylonjs/materials package
- ✅ Cleaned up backup files (.bak)
- ✅ Enhanced themeManager with retry logic and validation
- ✅ Configured production source maps (hidden) for debugging
- ✅ Completed all project documentation (4/4 docs complete)
  - ARCHITECTURE.md updated with logging system
  - TODO.md updated with all completed work
  - FUTURE-FEATURES.md (comprehensive roadmap)
  - THEME-SYSTEM.md (complete theme dev guide)
- ✅ Added baseline UV coordinates to all color material themes
  - default, gemstone themes now have textureScale/textureOffset properties
  - Consistent 1.9/1.9 scale and 0.05/0.05 offset across color themes
  - Ready for fine-tuning once transparency bug is fixed
- ✅ Disabled problematic color material themes temporarily
  - default, smooth-pip, gemstone themes disabled in themeManager.ts
  - 5 working standard material themes remain available
  - Documented workaround and custom shader solution needed
  - Users have stable, working themes while custom shader is implemented

### Build/Deployment Fixes (2026-02-23)
- ✅ Fixed theme asset paths (changed `/src/assets/textures/` → `/assets/themes/`)
- ✅ Resolved TypeScript build errors (null checks, texture types)
- ✅ Fixed game over crash (added null check for share link element)
- ✅ Copied all 8 theme folders to public/assets/themes/
- ✅ Updated Vite config for proper asset handling

### Theme System Implementation (2026-02-22)
- ✅ Implemented theme hot-swapping with ThemeManager
- ✅ Added 8 working themes (5 standard, 3 color material)
- ✅ Created DebugView for texture adjustment (Alt+D)
- ✅ Added observer pattern for theme change notifications
- ✅ Implemented theme persistence to localStorage

### Documentation (2026-02-24)
- ✅ Created comprehensive ARCHITECTURE.md
- ✅ Created TODO.md (this file)

### Firebase + Cloud Run Stabilization (2026-02-26)
- ✅ Fixed Cloud Run API startup/deploy path and required IAM/API wiring
- ✅ Implemented authenticated WebSocket upgrade/runtime path in API
- ✅ Added API+WebSocket smoke tests (local + deployed Cloud Run)
- ✅ Added Cloud Run smoke test step to GitHub Actions deploy workflow
- ✅ Fixed stale PWA cache behavior causing old bundles/runtime errors
- ✅ Reduced noisy expected runtime warnings (profile 404, transient WS close/info)
- ✅ Added Firebase auth bootstrap service (anonymous default + Google sign-in upgrade path)
- ✅ Added backend identity endpoint + leaderboard submit/query API scaffolding
- ✅ Wired game-over score submission + global leaderboard UI rendering path
- ✅ Added profile access in HUD/mobile menu + dedicated Player Profile modal (stats + account actions)
- ✅ Reorganized settings into dedicated tabs (`Game`, `Graphics`, `Audio`, `Account`) for cleaner UX scaling
- ✅ Added pluggable API store backend (`file` / `firestore`) with Firestore sync adapter (`API_STORE_BACKEND`)
- ✅ Added Firebase Admin token verification path in API (`FIREBASE_AUTH_MODE=admin|auto|legacy`)
- ✅ Added Sprint 1.5 migration utility (`api/scripts/migrate-file-store-to-firestore.mjs`) with merge/replace + digest verification
- ✅ Added deploy-time Cloud Run env controls in GitHub Actions (`API_STORE_BACKEND`, `API_FIRESTORE_PREFIX`, `FIREBASE_AUTH_MODE`)
- ✅ Added WebSocket reconnect backoff behavior + tests for Cloud Run disconnect scenarios
- ✅ Added identity-aware settings/profile sync with local-first offline fallback + remote conflict handling
- ✅ Added continuous leaderboard auto-sync and cached global leaderboard fallback for offline reads
- ✅ Added subtle sync health indicators in Settings/Leaderboard (live online/sync/pending/offline/error state)
- ✅ Added splash start-mode selector (`Solo` vs `Multiplayer`) with multiplayer session auto-create flow
- ✅ Added optional multiplayer bot participants (`botCount`) for websocket session testing (`player_notification`, `game_update`, `chaos_attack`)
- ✅ Added optional bot-traffic assertion mode for API smoke tests (`E2E_ASSERT_BOTS=1`)
- ✅ Added multiplayer seat population from session participants (humans + bots shown around table)
- ✅ Added connectivity-driven lobby ready-state tracking (`participants.isReady`) with turn gating until all humans are ready
- ✅ Added clockwise turn-order planning scaffold from seat assignments (foundation for per-turn roll flow)
- ✅ Added server-validated turn action protocol (`turn_action` roll/score -> `turn_end`) with active-turn enforcement and invalid-order rejection
- ✅ Added roll/score payload validation against canonical turn roll snapshots (score points must match selected dice from accepted roll)
- ✅ Added server-issued roll ids (`roll.serverRollId`) required by score actions to prevent cross-roll/replay submissions
- ✅ Made multiplayer roll outcomes server-authoritative (client sends roll intent, server returns canonical die values)
- ✅ Added turn-state recovery snapshots (`turn_start.activeRoll` / `turnState.activeRoll`) for reconnect/mid-turn resync
- ✅ Added canonical `session_state` sync messaging (participants + turnState) on join/leave/turn transitions + reconnect sync
- ✅ Added server-enforced multiplayer turn timeout with warning + auto-advance events
- ✅ Added top-bar game clock with live turn countdown indicator for multiplayer/timed-trial readiness
- ✅ Added in-game `Main Menu` action in Settings to leave multiplayer sessions and return to lobby
- ✅ Added single-human multiplayer fallback (no turn-sync lock) so solo/one-human sessions can always play through
- ✅ Added authoritative per-participant score sync in multiplayer `session_state` + seat label score/readiness display
- ✅ Tuned bot chaos traffic down (lower chaos frequency, shake-only, shorter/safer intensity) to avoid disruptive camera failures

---

## 🎯 Next Sprint Goals

1. **Firestore Deploy Cutover Verification**: ✅ Added CI storage cutover assertions (`E2E_ASSERT_STORAGE_CUTOVER`) to verify backend/prefix + section count schema (and optional minimums) via `GET /api/admin/storage`.
2. **Auth Hardening Finalization**: Run production with `FIREBASE_AUTH_MODE=admin` and remove legacy lookup fallback after cutover validation.
3. **Multiplayer Consistency Guardrail**: Keep Cloud Run `API_MAX_INSTANCES=1` until shared-state coordination is implemented for multi-instance websocket rooms.
4. **Multiplayer Rollout (Server Authoritative)**: ✅ Room/lobby lifecycle, ready states, and canonical game-state messaging shipped (turn-sync hardening and expiry recovery included).
5. **Leaderboard UX**: Add filters (mode/difficulty), pagination, and player history views.
6. **Theme Polish Follow-up**: Finish remaining UV/lighting consistency checks across all die types.
7. **iOS Device QA Pass**: Execute physical-device validation for new mobile menu and safe-area responsive behavior.

### Multiplayer Sit/Stand Model (`isSeated` + `isReady`) — Post-Deployment Plan
- **Status**: 🟡 Phase 1 foundation merged (2026-02-27), lobby UX follow-up pending
- **Goal**: A player can be in a room without being auto-queued into active multiplayer gameplay.
- **State model**:
  - `isSeated=false, isReady=false`: in room/lobby observer only (not in turn order, can still view chat/room events)
  - `isSeated=true, isReady=false`: seated but not ready (visible at table, excluded from round start if start requires ready)
  - `isSeated=true, isReady=true`: seated and ready for multiplayer round participation
  - `isSeated=false, isReady=true`: invalid state (server normalizes back to `isReady=false`)
- **Server/API next steps**:
  - [x] Add participant field `isSeated` to session participant record + serialization.
  - [x] Add participant action endpoint to toggle `sit`, `stand`, and `ready` (`POST /api/multiplayer/sessions/:sessionId/participant-state`).
  - [x] Build turn order from seated/ready participants only; observers stay connected but out of turn flow.
  - [x] Emit room-channel system notifications for seat/ready transitions (sit, stand, ready, unready).
  - [ ] Add explicit observer join room-channel message when a player enters but remains unseated.
  - Preserve backward compatibility by defaulting missing `isSeated` based on current participation behavior during rollout.
- **Client/UI next steps**:
  - [x] Add in-game controls: local seat tap toggles `Sit/Ready/Stand`, and action button switches to `Ready Up` when seated but not ready.
  - [x] Show room status feed notifications when another player sits/stands/gets ready.
  - [ ] Add explicit splash/lobby controls for `Sit Down` / `Stand Up` / `Ready` (not only in-game controls).
  - [ ] Disable splash `Join Game`/multiplayer start until local player is seated (and ready if required by rule).
  - [x] Keep solo-style practice available for standing/lone players without forcing multiplayer turn state.
- **Acceptance criteria**:
  - Lone player can enter room and practice without auto-starting a multiplayer round.
  - New joiners are explicitly notified when another player sits and is ready.
  - Turn order and win/lifecycle logic never include unseated observers.
  - Existing room/session flows remain stable during mixed-version rollout.

---

## Notes

- Keep this file updated as work progresses
- Mark items as ✅ when completed, move to "Recently Completed" section
- Add AI prompts for all new features/bugs for easy context restoration
- Link to relevant files/line numbers where possible
- Update "Last Updated" date at top when making changes

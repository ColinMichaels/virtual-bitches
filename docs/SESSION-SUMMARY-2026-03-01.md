# BISCUITS - Session Summary
**Date:** March 1, 2026  
**Focus:** Unified game config follow-through plus iterative Phase 01-06 server refactor checkpoints (routing, engine boundaries, filter registry, websocket transport extraction, storage/auth adapters, admin service boundaries)

---

## Delivered

### Unified `gameConfig` Server Contract Completion
- Added server-side normalization and reconciliation for unified game config payloads.
- Added explicit precedence handling:
  - legacy create fields (`botCount`, `gameDifficulty`, `demoSpeedMode`) win when explicitly present
  - otherwise compatible values fall back from `gameConfig`
- Added session-derived `gameConfig` snapshot emission in API session responses/state snapshots.
- Added store consistency normalization for persisted session `gameConfig` blocks.

### Unified `gameConfig` Client Bootstrap Wiring
- Extended splash start payload to include a unified `gameConfig` payload for solo and multiplayer starts.
- Passed `gameConfig` from shell bootstrapping into runtime bootstrap options.
- Updated runtime bootstrap/create-session flow to:
  - consume startup `gameConfig` when present
  - propagate a normalized unified `gameConfig` on multiplayer session creation

### API Documentation Alignment
- Updated backend API docs to reflect actual legacy-vs-config precedence.
- Documented that session create/join responses now include derived `gameConfig` snapshots.

### Phase 01 - Routing Extraction (Incremental Refactor)
- Extracted API route matching/dispatch out of `api/server.mjs` into:
  - `api/http/routeDispatcher.mjs`
- Replaced the long in-function endpoint if/else chain with:
  - a centralized immutable route handler map in `server.mjs`
  - a single dispatch call to the extracted route module
- Preserved existing handler contracts and request/response behavior.
- Extracted route handler-map construction into:
  - `api/http/routeHandlers.mjs`
  - server now composes handler dependencies instead of owning the full map literal

### Phase 02 - Engine Boundaries (Incremental Refactor)
- Extracted turn/session progression logic from `api/server.mjs` into:
  - `api/engine/sessionTurnEngine.mjs`
- Extracted post-game/session lifecycle state transition logic from `api/server.mjs` into:
  - `api/engine/sessionLifecycleEngine.mjs`
- Extracted bot turn execution transition logic from `api/server.mjs` into:
  - `api/engine/botTurnEngine.mjs`
- Extracted turn-timeout transition logic from `api/server.mjs` into:
  - `api/engine/turnTimeoutEngine.mjs`
- Extracted player turn-action transition logic from `api/server.mjs` into:
  - `api/engine/turnActionEngine.mjs`
- Added dependency-injected engine composition in `server.mjs` so core turn transitions run behind explicit interfaces.
- Kept transport and orchestration call sites stable via wrapper delegation:
  - `ensureSessionTurnState`
  - `buildTurnStartMessage`
  - `buildTurnEndMessage`
  - `buildTurnActionMessage`
  - `advanceSessionTurn`
  - `applyParticipantScoreUpdate`
- Added stable wrapper delegation for lifecycle transition operations:
  - `isSessionGameInProgress`
  - `shouldQueueParticipantForNextGame`
  - `hasQueuedParticipantsForNextGame`
  - `areCurrentGameParticipantsComplete`
  - `scheduleSessionPostGameLifecycle`
  - `markSessionPostGamePlayerAction`
  - `resetSessionForNextGame`
  - `completeSessionRoundWithWinner`
- Added stable wrapper delegation for bot progression operations:
  - `executeBotTurn`
- Added stable wrapper delegation for timeout progression operations:
  - `handleTurnTimeoutExpiry` transition path via `turnTimeoutController.processTurnTimeoutTransition(...)`
- Added stable wrapper delegation for player turn-action operations:
  - `processTurnAction` transition path via `turnActionController.processTurnAction(...)`
- Preserved API/WebSocket behavior while isolating core game transition logic from the server composition root.

### Phase 03 - Filter/Addon Registry (Incremental Refactor)
- Added generic addon/filter registry module with policy controls:
  - `api/filters/addonRegistry.mjs`
  - supports `enabled`, `timeoutMs`, and `onError: noop | block`
- Added chat-conduct room-channel filter adapter:
  - `api/filters/roomChannelChatConductFilter.mjs`
- Added sender/direct-policy room filters:
  - `api/filters/roomChannelSenderRestrictionFilter.mjs`
  - `api/filters/directMessageBlockRelationshipFilter.mjs`
- Refactored room-channel moderation gate in `api/server.mjs` to run through registry-managed filter execution.
- Refactored sender restriction and direct-message block relationship checks in `api/server.mjs` to run through registry-managed filter execution.
- Preserved current chat-conduct behavior while moving moderation policy enforcement out of the WebSocket relay control flow.
- Added deploy/runtime env wiring for filter policy controls:
  - `MULTIPLAYER_CHAT_CONDUCT_FILTER_TIMEOUT_MS`
  - `MULTIPLAYER_CHAT_CONDUCT_FILTER_ON_ERROR`
  - `MULTIPLAYER_ROOM_CHANNEL_SENDER_FILTER_TIMEOUT_MS`
  - `MULTIPLAYER_ROOM_CHANNEL_SENDER_FILTER_ON_ERROR`
  - `MULTIPLAYER_DIRECT_MESSAGE_BLOCK_FILTER_TIMEOUT_MS`
  - `MULTIPLAYER_DIRECT_MESSAGE_BLOCK_FILTER_ON_ERROR`

### Phase 04 - Transport + WS Decoupling (Incremental Refactor)
- Extracted websocket protocol/frame handling into:
  - `api/ws/socketProtocol.mjs`
- Extracted websocket connection lifecycle handling into:
  - `api/ws/socketLifecycle.mjs`
- Refactored `api/server.mjs` to delegate protocol-only websocket concerns:
  - upgrade header validation
  - handshake response composition
  - frame parsing
  - frame writing
- Refactored `api/server.mjs` to delegate websocket lifecycle concerns:
  - connection bootstrap
  - frame ingestion loop + control frame handling
  - session client register/unregister/disconnect paths
- Preserved existing websocket/domain message handling flow while reducing transport implementation surface in the composition root.

### Phase 05 - Storage/Auth Adapter Hardening (Follow-through)
- Extracted request/session auth checks from `api/server.mjs` into:
  - `api/auth/requestAuthorizer.mjs`
- Extracted admin access mode + token/identity/role authorization from `api/server.mjs` into:
  - `api/auth/adminAccessAuthorizer.mjs`
- Preserved auth contracts while moving bearer/session/admin authorization paths out of the composition root.
- Added focused auth adapter tests:
  - `api/auth/requestAuthorizer.test.mjs`
  - `api/auth/adminAccessAuthorizer.test.mjs`

### Phase 06 - Admin Service Boundaries (Follow-through)
- Extracted admin security/audit/role support logic from `api/server.mjs` into:
  - `api/admin/adminSecurityAuditService.mjs`
- Delegated role normalization + hierarchy checks, bootstrap owner allowlist role resolution, admin limit parsing, admin principal shaping, admin audit write/read normalization, and admin role record shaping to the extracted admin service.
- Added isolated service coverage:
  - `api/admin/adminSecurityAuditService.test.mjs`
- Extracted admin mutation route use-case orchestration from `api/server.mjs` into:
  - `api/admin/adminMutationService.mjs`
- Delegated admin mutation flows to the extracted service while preserving HTTP contracts:
  - role upsert
  - session expire
  - participant remove
  - session conduct clear (per-player + full-session)
- Added focused regression coverage for extracted mutation flows:
  - `api/admin/adminMutationService.test.mjs`

---

## Validation Snapshot

### Confirmed
- `npm run test:game-config` passes.
- `npm run test:backend-api` passes.
- `node --check api/engine/botTurnEngine.mjs` passes.
- `node --check api/engine/turnTimeoutEngine.mjs` passes.
- `node --check api/engine/sessionLifecycleEngine.mjs` passes.
- `node --check api/engine/sessionTurnEngine.mjs` passes.
- `node --check api/server.mjs` passes.
- `node --check api/filters/addonRegistry.mjs` passes.
- `node --check api/filters/roomChannelChatConductFilter.mjs` passes.
- `node --check api/filters/roomChannelSenderRestrictionFilter.mjs` passes.
- `node --check api/filters/directMessageBlockRelationshipFilter.mjs` passes.
- `node --check api/http/routeDispatcher.mjs` passes.
- `node --check api/http/routeHandlers.mjs` passes.
- `node --check api/ws/socketProtocol.mjs` passes.
- `node --check api/ws/socketLifecycle.mjs` passes.
- `cd api && npm run test:auth-admin-access` passes.
- `cd api && npm run test:auth-request-authorizer` passes.
- `cd api && npm run test:admin-security-audit` passes.
- `cd api && npm run test:admin-mutations` passes.
- `cd api && npm run test:admin-services` passes.
- `cd api && npm run test:storage-auth-adapters` passes.
- `cd api && npm run test:ws-transport` passes.
- `npm run build` passes.
- `npm run test:e2e:api:local` passes.

### Notes
- `public/updates.git.json` regenerated during build (`updates:generate`).

---

## Branching + Refactor Preparation

- Created incremental phase branch for this checkpoint:
  - `feature/server-phase-00-game-config-baseline`
- Created Phase 01 branch for routing extraction:
  - `feature/server-phase-01-routing-extraction`
- Created Phase 02 branch for engine boundary extraction:
  - `feature/server-phase-02-engine-boundaries`
- Created Phase 03 branch for filter/addon registry extraction:
  - `feature/server-phase-03-filter-addon-registry`
- Created Phase 04 branch for websocket transport decoupling:
  - `feature/server-phase-04-transport-ws-decoupling`
- Phase 05/06 follow-through checkpoints (auth/storage adapters + admin service boundaries) were landed incrementally in the active refactor stream.
- Added dedicated phase plan in:
  - `docs/SERVER-REFACTOR-PHASE-PLAN.md`

---

## Next Phase Candidate

1. Evaluate Phase 07 candidate: isolate multiplayer session control endpoints (join/heartbeat/refresh/queue) into application service modules while preserving existing HTTP/WS contracts.
2. Add a lightweight deploy-gate checklist section to incremental phase session summaries (`node --check api/server.mjs`, `npm run test:storage-auth-adapters`, `npm run test:ws-transport`, phase-specific service tests).
3. Add targeted integration-level admin route tests once phase-07 extraction stabilizes to keep CI runtime bounded.

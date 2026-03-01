# Server Refactor Phase Plan

## Goal

Refactor `api/server.mjs` into a modular structure where:

- the game server core remains deterministic and always operable
- optional subsystems (filters/addons/integrations) can fail without taking down core gameplay
- features are removable/adaptable plugins, not core control points

## Branching Convention

Use one branch per incremental phase:

- `feature/server-phase-00-game-config-baseline`
- `feature/server-phase-01-routing-extraction`
- `feature/server-phase-02-engine-boundaries`
- `feature/server-phase-03-filter-addon-registry`
- `feature/server-phase-04-transport-ws-decoupling`
- `feature/server-phase-05-storage-auth-adapters`
- `feature/server-phase-06-admin-service-boundaries`

If a phase splits, suffix with `-a`, `-b` (example: `feature/server-phase-03a-filter-registry-core`).

## Architecture Targets

1. **Composition Root**
   - bootstrapping, env parsing, lifecycle hooks only
2. **Transport Layer**
   - HTTP/WS routing and protocol translation only
3. **Application Services**
   - orchestrate use-cases and call domain + adapters
4. **Domain/Core Engine**
   - game/session transitions and invariants
5. **Plugin/Filter Layer**
   - optional policies/mechanics with fail-open defaults
6. **Infra Adapters**
   - storage, firebase, external moderation term feeds

## Failure Policy

1. Core gameplay transitions must not depend on optional subsystems.
2. Addon/filter failures must degrade to noop unless explicitly marked hard-blocking.
3. Every addon/filter execution should support timeout, error capture, and diagnostics.

## Phase Breakdown

## Phase 00 - Baseline Checkpoint
- Land unified `gameConfig` contract wiring across server/client/runtime.
- Confirm no API contract breakage.
- Preserve deploy/smoke baseline.
- Status: ✅ Complete (`feature/server-phase-00-game-config-baseline`)

## Phase 01 - Routing Extraction
- Move route matching/dispatch out of `server.mjs` into route modules.
- Keep request/response contracts unchanged.
- Maintain same auth/guard behavior.
- Status: ✅ In progress checkpoint landed (`feature/server-phase-01-routing-extraction`)
- Delivered in branch:
  - `api/http/routeDispatcher.mjs`
  - `api/server.mjs` dispatch-chain replacement using centralized handler map
  - `api/http/routeHandlers.mjs` handler-registry extraction to keep server focused on composition

## Phase 02 - Engine Boundaries
- Extract session/turn progression logic into core engine modules.
- Keep side-effects behind interfaces (broadcast, persistence, timers).
- Status: ✅ In progress checkpoint landed (`feature/server-phase-02-engine-boundaries`)
- Delivered in branch:
  - `api/engine/sessionTurnEngine.mjs`
  - `api/engine/sessionLifecycleEngine.mjs`
  - `api/engine/botTurnEngine.mjs`
  - `api/engine/turnTimeoutEngine.mjs`
  - `api/engine/turnActionEngine.mjs`
  - `api/server.mjs` delegates turn-state/progression/scoring transitions to composed engine module
  - `api/server.mjs` delegates post-game lifecycle transitions (queue/completion/restart timing state) to composed engine module
  - `api/server.mjs` delegates bot turn execution transitions to composed engine module
  - `api/server.mjs` delegates turn-timeout transition handling to composed engine module
  - `api/server.mjs` delegates player turn-action transition handling (roll/select/score validation + mutation) to composed engine module
  - dependency-injected side-effect boundary for post-game lifecycle scheduling/reset/completion logic

## Phase 03 - Filter/Addon Registry
- Introduce registry + policy model:
  - `enabled`
  - `timeoutMs`
  - `onError: noop | block`
- Migrate chat conduct as first decoupled filter chain.
- Status: ✅ In progress checkpoint landed (`feature/server-phase-03-filter-addon-registry`)
- Delivered in branch:
  - `api/filters/addonRegistry.mjs`
  - `api/filters/roomChannelChatConductFilter.mjs`
  - `api/filters/roomChannelSenderRestrictionFilter.mjs`
  - `api/filters/directMessageBlockRelationshipFilter.mjs`
  - `api/server.mjs` delegates room-channel chat-conduct gating through a registry-managed filter chain
  - `api/server.mjs` delegates room-channel sender restriction and direct-message block-relationship policy checks through registry-managed filters
  - fail-open default policy for addon/filter execution errors (`onError: noop`)
  - policy wiring for filter execution controls:
    - `MULTIPLAYER_CHAT_CONDUCT_FILTER_TIMEOUT_MS`
    - `MULTIPLAYER_CHAT_CONDUCT_FILTER_ON_ERROR`
    - `MULTIPLAYER_ROOM_CHANNEL_SENDER_FILTER_TIMEOUT_MS`
    - `MULTIPLAYER_ROOM_CHANNEL_SENDER_FILTER_ON_ERROR`
    - `MULTIPLAYER_DIRECT_MESSAGE_BLOCK_FILTER_TIMEOUT_MS`
    - `MULTIPLAYER_DIRECT_MESSAGE_BLOCK_FILTER_ON_ERROR`

## Phase 04 - Transport + WS Decoupling
- Separate websocket frame/protocol handling from domain operations.
- Keep turn messages/events stable.
- Status: ✅ In progress checkpoint landed (`feature/server-phase-04-transport-ws-decoupling`)
- Delivered in branch:
  - `api/ws/socketProtocol.mjs`
  - `api/server.mjs` delegates websocket protocol concerns (upgrade header validation, handshake response, frame parse/write) to extracted transport module
  - `api/ws/socketLifecycle.mjs`
  - `api/server.mjs` delegates websocket connection lifecycle concerns (connection bootstrap, frame ingestion, client register/unregister/disconnect) to extracted lifecycle module
  - `api/ws/socketOrchestration.mjs`
  - `api/server.mjs` delegates websocket orchestration helpers (router/turn delegation, relay delegation, close-frame safety, session sync payload emission) to extracted orchestration bridge
  - `api/ws/socketOrchestration.test.mjs`
  - `api/package.json` now includes `test:ws-orchestration` in `test:ws-transport`

## Phase 05 - Storage/Auth Adapter Hardening
- Formalize repositories/adapters for storage and auth providers.
- Keep core engine adapter-agnostic.
- Add focused resilience tests for external provider failure paths.
- Status: ✅ In progress checkpoint landed (`feature/server-phase-05-storage-auth-adapters`)
- Delivered in branch:
  - `api/auth/tokenAuthAdapter.mjs`
  - `api/server.mjs` delegates access/refresh token issue+verify+revoke and bearer parsing to extracted auth adapter
  - `api/auth/tokenAuthAdapter.test.mjs`
  - `api/auth/adminAccessAuthorizer.mjs`
  - `api/server.mjs` delegates admin access mode resolution + token/identity/role authorization flow to extracted admin access authorizer adapter
  - `api/auth/adminAccessAuthorizer.test.mjs`
  - `api/auth/requestAuthorizer.mjs`
  - `api/server.mjs` delegates identity/session/request authorization checks to extracted request authorizer adapter
  - `api/auth/requestAuthorizer.test.mjs`
  - `api/auth/firebaseIdentityVerifier.mjs`
  - `api/server.mjs` delegates Firebase ID token verification (admin SDK + legacy lookup fallback + claim cache) to extracted identity verifier adapter
  - `api/auth/firebaseIdentityVerifier.test.mjs`
  - `api/storage/fileStore.test.mjs`
  - `api/storage/storeSyncController.mjs`
  - `api/server.mjs` delegates persist queue + rehydrate/cooldown coordination to extracted store sync controller
  - `api/storage/storeSyncController.test.mjs`
  - `api/package.json` includes `test:storage-auth-adapters` with admin access + request auth + storage sync coverage

## Phase 06 - Admin Service Boundaries
- Extract admin policy/audit/role support logic from `server.mjs` into dedicated admin services.
- Keep admin route contracts stable while shrinking composition-root responsibilities.
- Status: ✅ Follow-through checkpoint landed
- Delivered in branch:
  - `api/admin/adminSecurityAuditService.mjs`
  - `api/server.mjs` delegates admin role normalization/hierarchy checks, owner allowlist role resolution, admin limit parsing, admin principal shaping, admin audit event write/read normalization, and admin role record shaping to extracted admin security/audit service
  - `api/admin/adminSecurityAuditService.test.mjs`
  - `api/admin/adminMutationService.mjs`
  - `api/server.mjs` delegates admin mutation route orchestration (role upsert, session expire, participant remove, and conduct clear operations) to extracted admin mutation service
  - `api/admin/adminMutationService.test.mjs`
  - `api/package.json` includes `test:admin-services` (`test:admin-security-audit` + `test:admin-mutations`) for isolated admin service validation

## Phase 07 - Multiplayer Session Control Boundaries
- Isolate multiplayer session-control endpoint orchestration from `server.mjs` into dedicated service modules.
- Keep HTTP route contracts stable for session join/heartbeat/refresh/queue lifecycle flows.
- Status: ✅ Follow-through checkpoint landed
- Delivered in branch:
  - `api/multiplayer/sessionControlService.mjs`
  - `api/server.mjs` delegates multiplayer session-control route orchestration (`join`, `heartbeat`, `auth/refresh`, `queue-next`) to extracted session control service
  - `api/multiplayer/sessionControlService.test.mjs`
  - `api/package.json` includes `test:multiplayer-session-control` for isolated session-control service validation
  - `api/multiplayer/sessionMutationService.mjs`
  - `api/server.mjs` delegates multiplayer session mutation route orchestration (`participant-state`, demo controls, `leave`, moderation) to extracted session mutation service
  - `api/multiplayer/sessionMutationService.test.mjs`
  - `api/multiplayer/sessionProvisioningService.mjs`
  - `api/server.mjs` delegates multiplayer room provisioning/listing route orchestration (`create-session`, `list-rooms`) to extracted session provisioning service
  - `api/multiplayer/sessionProvisioningService.test.mjs`
  - `api/multiplayer/sessionMembershipService.mjs`
  - `api/server.mjs` delegates shared participant-removal membership orchestration (`removeParticipantFromSession`) to extracted session membership service used by admin/session/socket flows
  - `api/multiplayer/sessionMembershipService.test.mjs`
  - `api/package.json` includes `test:multiplayer-services` (`session-control` + `session-membership` + `session-mutations` + `session-provisioning`) for multiplayer service boundary validation

## Phase 08 - Multiplayer Rehydrate/Retry Resilience Boundaries
- Extract session rehydrate/retry helper orchestration from `server.mjs` into dedicated multiplayer resilience service modules.
- Keep auth/session recovery behavior stable for distributed Cloud Run flows.
- Candidate extraction targets:
  - `rehydrateSessionWithRetry`
  - `rehydrateSessionParticipantWithRetry`
  - shared delay/backoff policy helpers
- Validation target:
  - focused resilience service unit tests + existing `test:multiplayer-services` regression coverage

## Guardrails

- No big-bang rewrite.
- Each phase must ship with:
  - behavior parity checks
  - smoke/test validation notes
  - rollback-friendly commit boundary

## Checkpoint Validation Gate

Before merging/deploying a server refactor checkpoint, run:

1. `node --check api/server.mjs`
2. `cd api && npm run test:storage-auth-adapters`
3. `cd api && npm run test:ws-transport`
4. Any phase-specific module tests introduced in that checkpoint (example: `cd api && npm run test:admin-security-audit`)

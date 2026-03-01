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

## Phase 05 - Storage/Auth Adapter Hardening
- Formalize repositories/adapters for storage and auth providers.
- Keep core engine adapter-agnostic.
- Add focused resilience tests for external provider failure paths.

## Guardrails

- No big-bang rewrite.
- Each phase must ship with:
  - behavior parity checks
  - smoke/test validation notes
  - rollback-friendly commit boundary

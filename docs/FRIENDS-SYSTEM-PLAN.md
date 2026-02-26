# BISCUITS Friends System Plan (Scaffold)

**Status**: Planning + scaffolding only (no runtime integration yet)  
**Date**: 2026-02-26  
**Goal**: Capture a stable design now so multiplayer can adopt social features later without rework.

---

## Why This Exists

Friends/presence will be central to healthy multiplayer retention, but adding full social complexity now would slow core turn-sync and room reliability work.

This plan locks:

- data model shape
- API contract direction
- rollout gates
- non-goals for the current milestone

so we can finish multiplayer mechanics first, then plug friends in cleanly.

---

## Current Scope (Scaffold Only)

Implemented now:

- Client type contracts in `src/social/friends/types.ts`
- Client placeholder service in `src/social/friends/friendsService.ts`
- Documentation + TODO tracking updates

Not implemented now:

- No backend endpoints
- No Firestore collections/indexes
- No UI wiring
- No invite flow dependency on friend graph

---

## Product Requirements

Core outcomes:

1. Players can search/add/remove/block friends safely.
2. Players can see coarse online presence (`offline`, `menu`, `in_room`, `in_match`).
3. Players can invite friends into private rooms quickly.
4. Privacy and anti-abuse controls are first-class (not an afterthought).

Non-goals for first friends release:

- Guilds/clans
- Rich chat history
- Voice/video
- Cross-game social graph federation

---

## Data Model (Target)

### `friends` edge (directional)

Each user owns directional edges for cheap reads:

- `ownerUid`
- `targetUid`
- `status`: `outgoing_request | incoming_request | accepted | blocked | removed`
- `createdAt`
- `updatedAt`
- `source` (optional): `search | invite | recent_player`

### `presence` snapshot (ephemeral-ish)

Per-user lightweight state:

- `uid`
- `state`: `offline | menu | in_room | in_match`
- `sessionId` (optional)
- `roomCode` (optional, private-safe handling required)
- `lastHeartbeatAt`
- `platform` (optional: `web`, later `mobile`)

### `friendInvites` (optional first-class records)

- `inviteId`
- `fromUid`
- `toUid`
- `sessionId`
- `roomCode` (or opaque room reference)
- `status`: `pending | accepted | declined | expired | revoked`
- `createdAt`
- `expiresAt`

---

## API Contract Direction (Planned)

Prefix: `/api/social`

Friends:

- `GET /friends`
- `POST /friends/requests` (`targetUid`)
- `POST /friends/requests/:requestId/accept`
- `POST /friends/requests/:requestId/decline`
- `POST /friends/:targetUid/remove`
- `POST /friends/:targetUid/block`
- `POST /friends/:targetUid/unblock`

Presence:

- `POST /presence/heartbeat`
- `GET /presence?uids=...` (batched)

Invites:

- `POST /invites/room` (`toUid`, `sessionId`)
- `GET /invites/pending`
- `POST /invites/:inviteId/accept`
- `POST /invites/:inviteId/decline`

All routes should require authenticated non-anonymous identity for full social features.

---

## Security + Abuse Constraints

Must-have controls:

- Block list always overrides invite/friend operations
- Rate limiting for friend requests and invites
- Request/invite expiry windows
- Idempotent accept/decline operations
- Private-room metadata never leaked to non-target users

Recommended:

- Basic report signal integration for invite spam
- Server-side audit entries for social mutations

---

## Rollout Plan (Gated)

### Phase 0 (Now) - Design + Scaffold

- Completed in this pass.

### Phase 1 - Backend Graph + Requests

- Storage model + endpoints
- Request/accept/block flows
- No presence yet

### Phase 2 - Presence

- Heartbeat + presence query
- Lobby surface: "online friends"
- Presence privacy controls

### Phase 3 - Friend Room Invites

- Invite records
- Join-from-invite flow to private rooms
- In-game acceptance handling

### Phase 4 - UX/Retention Polish

- Recent players -> add friend
- Friend-first room recommendations
- Notifications tuning

---

## Multiplayer Stability Gate (Before Phase 1)

Begin friends feature implementation only after these are stable:

1. Turn rotation lockups resolved across bots/humans.
2. Room lifecycle behavior validated in production-like traffic.
3. Session expiry/recovery UX has low support churn.
4. Multiplayer e2e suite is green and reliable.

---

## Open Decisions

1. Should friend graph be mirrored in Firebase user documents, or kept API-owned only?
2. Should presence be pull-only initially (polling), then upgraded to push via websocket events?
3. Should private room invites expose room code directly, or use short-lived invite token indirection?
4. Should anonymous users be fully excluded, or allowed one-way "follow/invite by code" behavior?


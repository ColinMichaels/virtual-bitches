export type FriendRelationshipStatus =
  | "none"
  | "incoming_request"
  | "outgoing_request"
  | "accepted"
  | "blocked";

export type FriendPresenceState = "offline" | "menu" | "in_room" | "in_match";

export interface FriendIdentitySnapshot {
  uid: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface FriendRelationshipRecord {
  ownerUid: string;
  targetUid: string;
  status: FriendRelationshipStatus;
  createdAt: number;
  updatedAt: number;
}

export interface FriendPresenceSnapshot {
  uid: string;
  state: FriendPresenceState;
  online: boolean;
  lastHeartbeatAt: number;
  sessionId?: string;
  roomCode?: string;
}

export interface FriendRoomInvite {
  inviteId: string;
  fromUid: string;
  toUid: string;
  sessionId: string;
  roomCode?: string;
  status: "pending" | "accepted" | "declined" | "expired" | "revoked";
  createdAt: number;
  expiresAt: number;
}

export interface FriendsSnapshot {
  friends: FriendIdentitySnapshot[];
  incoming: FriendIdentitySnapshot[];
  outgoing: FriendIdentitySnapshot[];
  blocked: FriendIdentitySnapshot[];
  generatedAt: number;
}

export interface FriendsCapabilities {
  readonly enabled: boolean;
  readonly presenceEnabled: boolean;
  readonly roomInviteEnabled: boolean;
}

export interface FriendMutationResult {
  ok: boolean;
  reason?:
    | "feature_disabled"
    | "not_authenticated"
    | "already_exists"
    | "not_found"
    | "blocked"
    | "rate_limited"
    | "unknown";
}


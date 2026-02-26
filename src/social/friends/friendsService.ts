import {
  type FriendIdentitySnapshot,
  type FriendMutationResult,
  type FriendPresenceSnapshot,
  type FriendsCapabilities,
  type FriendsSnapshot,
} from "./types.js";

// Scaffold-only social service. Intentionally not wired into runtime flow yet.
// This keeps contracts stable while multiplayer core mechanics are finalized.
class FriendsService {
  getCapabilities(): FriendsCapabilities {
    return {
      enabled: false,
      presenceEnabled: false,
      roomInviteEnabled: false,
    };
  }

  async listFriends(): Promise<FriendsSnapshot> {
    const now = Date.now();
    return {
      friends: [],
      incoming: [],
      outgoing: [],
      blocked: [],
      generatedAt: now,
    };
  }

  async getPresence(_uids: string[]): Promise<Record<string, FriendPresenceSnapshot | null>> {
    return {};
  }

  async sendFriendRequest(_targetUid: string): Promise<FriendMutationResult> {
    return { ok: false, reason: "feature_disabled" };
  }

  async acceptFriendRequest(_fromUid: string): Promise<FriendMutationResult> {
    return { ok: false, reason: "feature_disabled" };
  }

  async declineFriendRequest(_fromUid: string): Promise<FriendMutationResult> {
    return { ok: false, reason: "feature_disabled" };
  }

  async removeFriend(_targetUid: string): Promise<FriendMutationResult> {
    return { ok: false, reason: "feature_disabled" };
  }

  async blockPlayer(_targetUid: string): Promise<FriendMutationResult> {
    return { ok: false, reason: "feature_disabled" };
  }

  async unblockPlayer(_targetUid: string): Promise<FriendMutationResult> {
    return { ok: false, reason: "feature_disabled" };
  }

  async sendRoomInvite(_target: FriendIdentitySnapshot, _sessionId: string): Promise<FriendMutationResult> {
    return { ok: false, reason: "feature_disabled" };
  }
}

export const friendsService = new FriendsService();


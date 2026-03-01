export const ROOM_CHANNEL_FILTER_SCOPE_PREFLIGHT = "room_channel_preflight";
export const ROOM_CHANNEL_SENDER_RESTRICTION_FILTER_ID = "room_channel_sender_restriction";

function requireFunction(dependencies, key) {
  const value = dependencies?.[key];
  if (typeof value !== "function") {
    throw new Error(`Missing room channel sender-restriction filter dependency: ${key}`);
  }
  return value;
}

function normalizePlayerId(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createRoomChannelSenderRestrictionFilter(dependencies = {}) {
  const isRoomChannelSenderRestricted = requireFunction(
    dependencies,
    "isRoomChannelSenderRestricted"
  );

  function run(context = {}) {
    const playerId = normalizePlayerId(context.playerId);
    if (!playerId) {
      return {
        allowed: true,
        stateChanged: false,
      };
    }

    if (!isRoomChannelSenderRestricted(playerId)) {
      return {
        allowed: true,
        stateChanged: false,
      };
    }

    return {
      allowed: false,
      code: "room_channel_sender_restricted",
      reason: "room_channel_sender_restricted",
      stateChanged: false,
    };
  }

  return Object.freeze({
    id: ROOM_CHANNEL_SENDER_RESTRICTION_FILTER_ID,
    scope: ROOM_CHANNEL_FILTER_SCOPE_PREFLIGHT,
    run,
  });
}

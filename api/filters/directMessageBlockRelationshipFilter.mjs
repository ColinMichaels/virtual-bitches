export const REALTIME_FILTER_SCOPE_DIRECT_DELIVERY = "realtime_direct_delivery";
export const DIRECT_MESSAGE_BLOCK_RELATIONSHIP_FILTER_ID = "direct_block_relationship";

function requireFunction(dependencies, key) {
  const value = dependencies?.[key];
  if (typeof value !== "function") {
    throw new Error(`Missing direct-message block filter dependency: ${key}`);
  }
  return value;
}

function normalizePlayerId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePayloadType(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createDirectMessageBlockRelationshipFilter(dependencies = {}) {
  const hasRoomChannelBlockRelationship = requireFunction(
    dependencies,
    "hasRoomChannelBlockRelationship"
  );

  function run(context = {}) {
    const session = context.session;
    const sourcePlayerId = normalizePlayerId(context.sourcePlayerId);
    const targetPlayerId = normalizePlayerId(context.targetPlayerId);
    const payloadType = normalizePayloadType(context.payloadType);
    if (!session || !sourcePlayerId || !targetPlayerId) {
      return {
        allowed: true,
        stateChanged: false,
      };
    }

    const blocked =
      hasRoomChannelBlockRelationship(session, sourcePlayerId, targetPlayerId) ||
      hasRoomChannelBlockRelationship(session, targetPlayerId, sourcePlayerId);
    if (!blocked) {
      return {
        allowed: true,
        stateChanged: false,
      };
    }

    const errorCode =
      payloadType === "room_channel" ? "room_channel_blocked" : "interaction_blocked";
    return {
      allowed: false,
      code: errorCode,
      reason: errorCode,
      stateChanged: false,
    };
  }

  return Object.freeze({
    id: DIRECT_MESSAGE_BLOCK_RELATIONSHIP_FILTER_ID,
    scope: REALTIME_FILTER_SCOPE_DIRECT_DELIVERY,
    run,
  });
}

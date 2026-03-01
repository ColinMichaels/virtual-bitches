export function isSupportedSocketPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const messageType = payload.type;
  if (messageType === "chaos_attack" || messageType === "particle:emit") {
    return true;
  }

  if (messageType === "game_update") {
    return (
      typeof payload.title === "string" &&
      payload.title.trim().length > 0 &&
      typeof payload.content === "string" &&
      payload.content.trim().length > 0
    );
  }

  if (messageType === "player_notification") {
    return typeof payload.message === "string" && payload.message.trim().length > 0;
  }

  if (messageType === "room_channel") {
    return (
      (payload.channel === "public" || payload.channel === "direct") &&
      typeof payload.message === "string" &&
      payload.message.trim().length > 0
    );
  }

  if (messageType === "turn_end") {
    return true;
  }

  if (messageType === "turn_action") {
    return payload.action === "roll" || payload.action === "score" || payload.action === "select";
  }

  return false;
}

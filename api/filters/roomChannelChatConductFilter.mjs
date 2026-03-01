export const ROOM_CHANNEL_FILTER_SCOPE_INBOUND = "room_channel_inbound";
export const ROOM_CHANNEL_CHAT_CONDUCT_FILTER_ID = "chat_conduct";

function requireFunction(dependencies, key) {
  const value = dependencies?.[key];
  if (typeof value !== "function") {
    throw new Error(`Missing room channel chat-conduct filter dependency: ${key}`);
  }
  return value;
}

function normalizePlayerId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeChannel(value) {
  return value === "direct" ? "direct" : "public";
}

function normalizeNow(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Date.now();
  }
  return Math.floor(parsed);
}

export function createRoomChannelChatConductFilter(dependencies = {}) {
  const ensureSessionChatConductState = requireFunction(
    dependencies,
    "ensureSessionChatConductState"
  );
  const evaluateRoomChannelConduct = requireFunction(dependencies, "evaluateRoomChannelConduct");
  const buildChatConductWarning = requireFunction(dependencies, "buildChatConductWarning");
  const getChatConductPolicy = requireFunction(dependencies, "getChatConductPolicy");

  function run(context = {}) {
    const session = context.session;
    const playerId = normalizePlayerId(context.playerId);
    const message = typeof context.message === "string" ? context.message : "";
    const channel = normalizeChannel(context.channel);
    const now = normalizeNow(context.now);
    if (!session || !playerId || !message) {
      return {
        allowed: true,
        stateChanged: false,
      };
    }

    const chatConductState = ensureSessionChatConductState(session, now);
    const conductEvaluation = evaluateRoomChannelConduct({
      policy: getChatConductPolicy(),
      state: chatConductState,
      playerId,
      channel,
      message,
      now,
    });
    const stateChanged = conductEvaluation?.stateChanged === true;
    if (conductEvaluation?.allowed !== false) {
      return {
        allowed: true,
        stateChanged,
        conductEvaluation,
      };
    }

    const failureCode =
      typeof conductEvaluation.code === "string" && conductEvaluation.code.length > 0
        ? conductEvaluation.code
        : "room_channel_message_blocked";
    const failureReason =
      typeof conductEvaluation.reason === "string" && conductEvaluation.reason.length > 0
        ? conductEvaluation.reason
        : failureCode;

    return {
      allowed: false,
      code: failureCode,
      reason: failureReason,
      stateChanged,
      shouldAutoBan: conductEvaluation.shouldAutoBan === true,
      warning: buildChatConductWarning(conductEvaluation, now),
      conductEvaluation,
    };
  }

  return Object.freeze({
    id: ROOM_CHANNEL_CHAT_CONDUCT_FILTER_ID,
    scope: ROOM_CHANNEL_FILTER_SCOPE_INBOUND,
    run,
  });
}

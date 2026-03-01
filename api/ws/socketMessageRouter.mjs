export function createSocketMessageRouter({
  wsClientMeta,
  isSupportedSocketPayload,
  getSession,
  wsCloseCodes,
  markSessionActivity,
  reconcileSessionLoops,
  sendSocketError,
  safeCloseSocket,
  sendSocketPayload,
  broadcastToSession,
  sendToSessionPlayer,
  broadcastRoomChannelToSession,
  broadcastRealtimeSocketMessageToSession,
  handleTurnEndMessage,
  handleTurnActionMessage,
  roomChannelFilterRegistry,
  roomChannelFilterScopePreflight,
  roomChannelFilterScopeInbound,
  realtimeFilterScopeDirectDelivery,
  normalizeRoomChannelMessage,
  normalizeRoomChannelTopic,
  normalizeRoomChannelTitle,
  upsertSessionRoomBan,
  removeParticipantFromSession,
  broadcastSystemRoomChannelMessage,
  persistStore,
  createId,
  now = () => Date.now(),
  log,
}) {
  function persistWithWarning(message) {
    persistStore().catch((error) => {
      log.warn(message, error);
    });
  }

  function relayRealtimeSocketMessage(client, session, payload, messageNow = now()) {
    const targetPlayerId =
      typeof payload.targetPlayerId === "string" ? payload.targetPlayerId.trim() : "";
    const hasTargetPlayer = targetPlayerId.length > 0;
    let shouldPersistChatConduct = false;
    if (hasTargetPlayer && !session?.participants?.[targetPlayerId]) {
      sendSocketError(client, "invalid_target_player", "target_player_not_in_session");
      return;
    }

    const normalizedChannel =
      payload.type === "room_channel"
        ? payload.channel === "direct"
          ? "direct"
          : "public"
        : hasTargetPlayer
          ? "direct"
          : "public";

    if (payload.type === "room_channel") {
      const preflightDecision = roomChannelFilterRegistry.execute(
        roomChannelFilterScopePreflight,
        {
          session,
          playerId: client.playerId,
          channel: normalizedChannel,
          payloadType: payload.type,
          now: messageNow,
        }
      );
      if (!preflightDecision.allowed) {
        const failureCode =
          typeof preflightDecision.code === "string" && preflightDecision.code.length > 0
            ? preflightDecision.code
            : "room_channel_sender_restricted";
        const failureReason =
          typeof preflightDecision.reason === "string" && preflightDecision.reason.length > 0
            ? preflightDecision.reason
            : failureCode;
        sendSocketError(client, failureCode, failureReason);
        return;
      }
      const normalizedMessage = normalizeRoomChannelMessage(payload.message);
      if (!normalizedMessage) {
        sendSocketError(client, "room_channel_invalid_message", "room_channel_invalid_message");
        return;
      }
      const roomChannelFilterDecision = roomChannelFilterRegistry.execute(
        roomChannelFilterScopeInbound,
        {
          session,
          playerId: client.playerId,
          channel: normalizedChannel,
          message: normalizedMessage,
          now: messageNow,
        }
      );
      if (roomChannelFilterDecision.stateChanged) {
        shouldPersistChatConduct = true;
      }
      if (!roomChannelFilterDecision.allowed) {
        const warning = roomChannelFilterDecision.outcome?.warning ?? null;
        if (warning) {
          sendSocketPayload(client, {
            type: "player_notification",
            id: createId(),
            playerId: client.playerId,
            sourcePlayerId: client.playerId,
            sourceRole: "system",
            targetPlayerId: client.playerId,
            title: warning.title,
            message: warning.message,
            detail: warning.detail,
            severity: warning.severity,
            timestamp: messageNow,
          });
        }
        const failureCode =
          typeof roomChannelFilterDecision.code === "string" &&
          roomChannelFilterDecision.code.length > 0
            ? roomChannelFilterDecision.code
            : typeof roomChannelFilterDecision.outcome?.code === "string" &&
                roomChannelFilterDecision.outcome.code.length > 0
              ? roomChannelFilterDecision.outcome.code
              : "room_channel_message_blocked";
        const failureReason =
          typeof roomChannelFilterDecision.reason === "string" &&
          roomChannelFilterDecision.reason.length > 0
            ? roomChannelFilterDecision.reason
            : typeof roomChannelFilterDecision.outcome?.reason === "string" &&
                roomChannelFilterDecision.outcome.reason.length > 0
              ? roomChannelFilterDecision.outcome.reason
              : failureCode;
        sendSocketError(client, failureCode, failureReason);
        if (roomChannelFilterDecision.outcome?.shouldAutoBan === true) {
          const participant = session.participants?.[client.playerId];
          const offenderLabel =
            typeof participant?.displayName === "string" && participant.displayName.trim().length > 0
              ? participant.displayName.trim()
              : client.playerId;
          upsertSessionRoomBan(session, client.playerId, {
            bannedAt: messageNow,
            bannedByPlayerId: "system",
            bannedByRole: "admin",
          });
          removeParticipantFromSession(client.sessionId, client.playerId, {
            source: "conduct_auto_ban",
            socketReason: "banned_for_conduct",
          });
          broadcastSystemRoomChannelMessage(client.sessionId, {
            topic: "moderation_ban",
            title: "Room Moderation",
            message: `${offenderLabel} was banned for repeated chat conduct violations.`,
            severity: "warning",
            timestamp: messageNow,
          });
        }
        if (shouldPersistChatConduct) {
          persistWithWarning("Failed to persist session after room-channel conduct update");
        }
        return;
      }
      payload.message = normalizedMessage;
    }

    const base = {
      ...payload,
      playerId: client.playerId,
      sourcePlayerId: client.playerId,
      timestamp:
        typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
          ? payload.timestamp
          : messageNow,
    };

    if (payload.type === "room_channel") {
      base.channel = normalizedChannel;
      const normalizedTopic = normalizeRoomChannelTopic(payload.topic);
      if (normalizedTopic) {
        base.topic = normalizedTopic;
      } else {
        delete base.topic;
      }
      base.title = normalizeRoomChannelTitle(payload.title, normalizedChannel);
      base.message = normalizeRoomChannelMessage(payload.message);
      base.sourceRole = "player";
    }

    if (normalizedChannel === "direct") {
      const directTargetPlayerId = hasTargetPlayer ? targetPlayerId : "";
      if (!directTargetPlayerId) {
        sendSocketError(client, "invalid_target_player", "target_player_required_for_direct");
        return;
      }
      const directDeliveryDecision = roomChannelFilterRegistry.execute(
        realtimeFilterScopeDirectDelivery,
        {
          session,
          sourcePlayerId: client.playerId,
          targetPlayerId: directTargetPlayerId,
          payloadType: payload.type,
          now: messageNow,
        }
      );
      if (!directDeliveryDecision.allowed) {
        const blockErrorCode =
          payload.type === "room_channel" ? "room_channel_blocked" : "interaction_blocked";
        const failureCode =
          typeof directDeliveryDecision.code === "string" && directDeliveryDecision.code.length > 0
            ? directDeliveryDecision.code
            : blockErrorCode;
        const failureReason =
          typeof directDeliveryDecision.reason === "string" &&
          directDeliveryDecision.reason.length > 0
            ? directDeliveryDecision.reason
            : failureCode;
        sendSocketError(client, failureCode, failureReason);
        return;
      }
      base.targetPlayerId = directTargetPlayerId;
      sendToSessionPlayer(client.sessionId, directTargetPlayerId, JSON.stringify(base), client);
      if (shouldPersistChatConduct) {
        persistWithWarning("Failed to persist session after room-channel direct relay");
      }
      return;
    }

    delete base.targetPlayerId;
    if (payload.type === "room_channel") {
      broadcastRoomChannelToSession(session, base, client);
      if (shouldPersistChatConduct) {
        persistWithWarning("Failed to persist session after room-channel relay");
      }
      return;
    }
    broadcastRealtimeSocketMessageToSession(session, base, client);
    if (shouldPersistChatConduct) {
      persistWithWarning("Failed to persist session after realtime relay");
    }
  }

  function handleSocketMessage(client, rawMessage) {
    if (!wsClientMeta.get(client.socket)) {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawMessage);
    } catch (error) {
      log.warn("Ignoring malformed WebSocket JSON payload", error);
      sendSocketError(client, "invalid_payload", "invalid_json");
      return;
    }

    if (!isSupportedSocketPayload(payload)) {
      sendSocketError(client, "unsupported_message_type", "unsupported_message_type");
      return;
    }

    const session = getSession(client.sessionId);
    if (!session || session.expiresAt <= now()) {
      sendSocketError(client, "session_expired", "session_expired");
      safeCloseSocket(client, wsCloseCodes.sessionExpired, "session_expired");
      return;
    }

    if (!session.participants[client.playerId]) {
      sendSocketError(client, "unauthorized", "player_not_in_session");
      safeCloseSocket(client, wsCloseCodes.forbidden, "player_not_in_session");
      return;
    }

    if (payload.type === "turn_end") {
      handleTurnEndMessage(client, session);
      return;
    }

    if (payload.type === "turn_action") {
      handleTurnActionMessage(client, session, payload);
      return;
    }

    const messageNow = now();
    session.participants[client.playerId].lastHeartbeatAt = messageNow;
    markSessionActivity(session, client.playerId, messageNow);

    if (
      payload.type === "game_update" ||
      payload.type === "player_notification" ||
      payload.type === "room_channel"
    ) {
      relayRealtimeSocketMessage(client, session, payload, messageNow);
      reconcileSessionLoops(client.sessionId);
      return;
    }

    broadcastToSession(client.sessionId, rawMessage, client);
  }

  return {
    handleSocketMessage,
    relayRealtimeSocketMessage,
  };
}

export function createSocketRelay({
  wsSessionClients,
  writeSocketFrame,
  safeCloseSocket,
  wsCloseCodes,
  hasRoomChannelBlockRelationship,
  log,
}) {
  function broadcastToSession(sessionId, rawMessage, sender) {
    const clients = wsSessionClients.get(sessionId);
    if (!clients || clients.size === 0) return;

    for (const client of clients) {
      if (client === sender || client.closed || client.socket.destroyed) {
        continue;
      }

      try {
        writeSocketFrame(client.socket, 0x1, Buffer.from(rawMessage, "utf8"));
      } catch (error) {
        log.warn("Failed to broadcast WebSocket message", error);
        safeCloseSocket(client, wsCloseCodes.internalError, "send_failed");
      }
    }
  }

  function sendToSessionPlayer(sessionId, playerId, rawMessage, sender = null) {
    const targetPlayerId = typeof playerId === "string" ? playerId.trim() : "";
    if (!targetPlayerId) {
      return;
    }

    const clients = wsSessionClients.get(sessionId);
    if (!clients || clients.size === 0) {
      return;
    }

    for (const client of clients) {
      if (client === sender || client.closed || client.socket.destroyed) {
        continue;
      }
      if (client.playerId !== targetPlayerId) {
        continue;
      }

      try {
        writeSocketFrame(client.socket, 0x1, Buffer.from(rawMessage, "utf8"));
      } catch (error) {
        log.warn("Failed to send WebSocket direct message", error);
        safeCloseSocket(client, wsCloseCodes.internalError, "send_failed");
      }
    }
  }

  function broadcastRoomChannelToSession(session, payload, sender = null) {
    const sessionId = typeof session?.sessionId === "string" ? session.sessionId.trim() : "";
    if (!sessionId) {
      return;
    }
    const sourcePlayerId =
      typeof payload?.sourcePlayerId === "string" ? payload.sourcePlayerId.trim() : "";
    if (!sourcePlayerId) {
      return;
    }

    const clients = wsSessionClients.get(sessionId);
    if (!clients || clients.size === 0) {
      return;
    }

    const rawMessage = JSON.stringify(payload);
    for (const client of clients) {
      if (client === sender || client.closed || client.socket.destroyed) {
        continue;
      }
      const recipientPlayerId = typeof client.playerId === "string" ? client.playerId.trim() : "";
      if (!recipientPlayerId || recipientPlayerId === sourcePlayerId) {
        continue;
      }
      if (
        hasRoomChannelBlockRelationship(session, recipientPlayerId, sourcePlayerId) ||
        hasRoomChannelBlockRelationship(session, sourcePlayerId, recipientPlayerId)
      ) {
        continue;
      }

      try {
        writeSocketFrame(client.socket, 0x1, Buffer.from(rawMessage, "utf8"));
      } catch (error) {
        log.warn("Failed to broadcast room channel WebSocket message", error);
        safeCloseSocket(client, wsCloseCodes.internalError, "send_failed");
      }
    }
  }

  function broadcastRealtimeSocketMessageToSession(session, payload, sender = null) {
    const sessionId = typeof session?.sessionId === "string" ? session.sessionId.trim() : "";
    if (!sessionId) {
      return;
    }

    const clients = wsSessionClients.get(sessionId);
    if (!clients || clients.size === 0) {
      return;
    }

    const sourcePlayerId =
      typeof payload?.sourcePlayerId === "string" ? payload.sourcePlayerId.trim() : "";
    const rawMessage = JSON.stringify(payload);
    for (const client of clients) {
      if (client === sender || client.closed || client.socket.destroyed) {
        continue;
      }
      const recipientPlayerId = typeof client.playerId === "string" ? client.playerId.trim() : "";
      if (
        sourcePlayerId &&
        recipientPlayerId &&
        recipientPlayerId !== sourcePlayerId &&
        (hasRoomChannelBlockRelationship(session, recipientPlayerId, sourcePlayerId) ||
          hasRoomChannelBlockRelationship(session, sourcePlayerId, recipientPlayerId))
      ) {
        continue;
      }

      try {
        writeSocketFrame(client.socket, 0x1, Buffer.from(rawMessage, "utf8"));
      } catch (error) {
        log.warn("Failed to broadcast realtime WebSocket message", error);
        safeCloseSocket(client, wsCloseCodes.internalError, "send_failed");
      }
    }
  }

  function sendSocketPayload(client, payload) {
    if (!client || client.closed || client.socket.destroyed) return;
    try {
      const raw = JSON.stringify(payload);
      writeSocketFrame(client.socket, 0x1, Buffer.from(raw, "utf8"));
    } catch (error) {
      log.warn("Failed to send WebSocket payload", error);
    }
  }

  function sendSocketError(client, code, message) {
    if (!client || client.closed || client.socket.destroyed) return;
    const payload = {
      type: "error",
      code,
      message,
    };
    sendSocketPayload(client, payload);
  }

  return {
    broadcastToSession,
    sendToSessionPlayer,
    broadcastRoomChannelToSession,
    broadcastRealtimeSocketMessageToSession,
    sendSocketPayload,
    sendSocketError,
  };
}

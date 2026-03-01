export function createSocketLifecycle({
  wsSessionClients,
  wsClientMeta,
  maxMessageBytes,
  wsCloseCodes,
  parseSocketFrame,
  writeSocketFrame,
  getSession,
  isBotParticipant,
  markSessionActivity,
  sendTurnSyncPayload,
  reconcileSessionLoops,
  reconcileTurnTimeoutLoop,
  handleSocketMessage,
  sendSocketError,
  safeCloseSocket,
  log,
}) {
  function registerSocketClient(client, sessionId) {
    const clients = wsSessionClients.get(sessionId) ?? new Set();
    clients.add(client);
    wsSessionClients.set(sessionId, clients);
    client.registered = true;
    reconcileTurnTimeoutLoop(sessionId);
  }

  function unregisterSocketClient(client) {
    if (!client?.registered) return;
    client.registered = false;

    if (client.tokenExpiryTimer) {
      clearTimeout(client.tokenExpiryTimer);
      client.tokenExpiryTimer = null;
    }

    wsClientMeta.delete(client.socket);
    const clients = wsSessionClients.get(client.sessionId);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) {
        wsSessionClients.delete(client.sessionId);
      }
    }

    const session = getSession(client.sessionId);
    const participant = session?.participants?.[client.playerId];
    if (participant && !isBotParticipant(participant)) {
      // Keep readiness state during short disconnects so browser refresh reconnects do not
      // deadlock turn sync. Stale participants are removed by heartbeat pruning + cleanup sweeps.
      participant.lastHeartbeatAt =
        Number.isFinite(participant.lastHeartbeatAt) && participant.lastHeartbeatAt > 0
          ? participant.lastHeartbeatAt
          : Date.now();
    }

    reconcileSessionLoops(client.sessionId);
  }

  function handleSocketData(client, chunk) {
    if (client.closed) return;

    client.readBuffer = Buffer.concat([client.readBuffer, chunk]);
    if (client.readBuffer.length > maxMessageBytes * 2) {
      sendSocketError(client, "message_too_large", "message_too_large");
      safeCloseSocket(client, wsCloseCodes.badRequest, "message_too_large");
      return;
    }

    while (true) {
      const frame = parseSocketFrame(client.readBuffer, maxMessageBytes);
      if (!frame) {
        return;
      }

      if (frame.error) {
        sendSocketError(client, "invalid_payload", frame.error);
        safeCloseSocket(client, wsCloseCodes.badRequest, frame.error);
        return;
      }

      client.readBuffer = client.readBuffer.subarray(frame.bytesConsumed);

      if (frame.opcode === 0x1) {
        const raw = frame.payload.toString("utf8");
        if (raw.length > maxMessageBytes) {
          sendSocketError(client, "message_too_large", "message_too_large");
          safeCloseSocket(client, wsCloseCodes.badRequest, "message_too_large");
          return;
        }
        handleSocketMessage(client, raw);
        continue;
      }

      if (frame.opcode === 0x8) {
        safeCloseSocket(client, wsCloseCodes.normal, "client_closed");
        return;
      }

      if (frame.opcode === 0x9) {
        writeSocketFrame(client.socket, 0xA, frame.payload.subarray(0, 125));
        continue;
      }

      if (frame.opcode === 0xA) {
        continue;
      }

      sendSocketError(client, "unsupported_message_type", "unsupported_opcode");
      safeCloseSocket(client, wsCloseCodes.badRequest, "unsupported_opcode");
      return;
    }
  }

  function handleSocketConnection(socket, auth) {
    const client = {
      socket,
      sessionId: auth.sessionId,
      playerId: auth.playerId,
      readBuffer: Buffer.alloc(0),
      tokenExpiryTimer: null,
      closed: false,
      registered: false,
    };

    wsClientMeta.set(socket, client);
    registerSocketClient(client, client.sessionId);
    log.info(`WebSocket connected: session=${client.sessionId} player=${client.playerId}`);

    const session = getSession(client.sessionId);
    if (session) {
      const participant = session.participants[client.playerId];
      const now = Date.now();
      if (participant) {
        participant.lastHeartbeatAt = now;
      }
      markSessionActivity(session, client.playerId, now);

      sendTurnSyncPayload(client, session, "sync");
      reconcileSessionLoops(client.sessionId);
    }

    const msUntilExpiry = Math.max(0, auth.tokenExpiresAt - Date.now());
    client.tokenExpiryTimer = setTimeout(() => {
      sendSocketError(client, "session_expired", "access_token_expired");
      safeCloseSocket(client, wsCloseCodes.unauthorized, "access_token_expired");
    }, msUntilExpiry);

    socket.on("data", (dataChunk) => {
      if (!Buffer.isBuffer(dataChunk)) {
        return;
      }
      handleSocketData(client, dataChunk);
    });

    socket.on("close", () => {
      client.closed = true;
      unregisterSocketClient(client);
    });

    socket.on("end", () => {
      client.closed = true;
      unregisterSocketClient(client);
    });

    socket.on("error", (error) => {
      client.closed = true;
      unregisterSocketClient(client);
      log.warn("WebSocket error", error);
    });
  }

  function disconnectPlayerSockets(sessionId, playerId, closeCode, reason) {
    const clients = wsSessionClients.get(sessionId);
    if (!clients) return;

    for (const client of clients) {
      if (!client || client.playerId !== playerId) {
        continue;
      }

      safeCloseSocket(client, closeCode, reason);
    }
  }

  return {
    handleSocketConnection,
    unregisterSocketClient,
    disconnectPlayerSockets,
  };
}

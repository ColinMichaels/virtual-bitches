export function createSocketOrchestration({
  writeSocketFrame,
  buildSessionStateMessage,
  buildTurnStartMessage,
  log,
}) {
  let socketRelay = null;
  let socketLifecycle = null;
  let socketMessageRouter = null;
  let socketTurnHandlers = null;

  function setSocketRelay(nextSocketRelay) {
    socketRelay = nextSocketRelay;
  }

  function setSocketLifecycle(nextSocketLifecycle) {
    socketLifecycle = nextSocketLifecycle;
  }

  function setSocketMessageRouter(nextSocketMessageRouter) {
    socketMessageRouter = nextSocketMessageRouter;
  }

  function setSocketTurnHandlers(nextSocketTurnHandlers) {
    socketTurnHandlers = nextSocketTurnHandlers;
  }

  function rejectUpgrade(socket, status, reason) {
    if (!socket || socket.destroyed) {
      return;
    }

    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  function handleSocketMessage(client, rawMessage) {
    socketMessageRouter?.handleSocketMessage(client, rawMessage);
  }

  function handleTurnActionMessage(client, session, payload) {
    socketTurnHandlers?.handleTurnActionMessage(client, session, payload);
  }

  function handleTurnEndMessage(client, session) {
    socketTurnHandlers?.handleTurnEndMessage(client, session);
  }

  function broadcastToSession(sessionId, rawMessage, sender) {
    socketRelay?.broadcastToSession(sessionId, rawMessage, sender);
  }

  function sendToSessionPlayer(sessionId, playerId, rawMessage, sender = null) {
    socketRelay?.sendToSessionPlayer(sessionId, playerId, rawMessage, sender);
  }

  function broadcastRoomChannelToSession(session, payload, sender = null) {
    socketRelay?.broadcastRoomChannelToSession(session, payload, sender);
  }

  function broadcastRealtimeSocketMessageToSession(session, payload, sender = null) {
    socketRelay?.broadcastRealtimeSocketMessageToSession(session, payload, sender);
  }

  function sendSocketPayload(client, payload) {
    socketRelay?.sendSocketPayload(client, payload);
  }

  function sendSocketError(client, code, message) {
    socketRelay?.sendSocketError(client, code, message);
  }

  function broadcastSessionState(session, source = "server", sender = null) {
    const message = buildSessionStateMessage(session, { source });
    if (!message) {
      return;
    }

    broadcastToSession(session.sessionId, JSON.stringify(message), sender);
  }

  function sendTurnSyncPayload(client, session, source = "sync") {
    const sessionState = buildSessionStateMessage(session, { source });
    if (sessionState) {
      sendSocketPayload(client, sessionState);
    }

    const turnStart = buildTurnStartMessage(session, { source });
    if (turnStart) {
      sendSocketPayload(client, turnStart);
    }
  }

  function disconnectPlayerSockets(sessionId, playerId, closeCode, reason) {
    socketLifecycle?.disconnectPlayerSockets(sessionId, playerId, closeCode, reason);
  }

  function safeCloseSocket(client, closeCode, closeReason) {
    if (!client || client.closed) {
      return;
    }

    client.closed = true;
    socketLifecycle?.unregisterSocketClient(client);

    if (!client.socket || client.socket.destroyed) {
      return;
    }

    const reasonBuffer = Buffer.from(String(closeReason ?? "closed").slice(0, 123), "utf8");
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(closeCode, 0);
    reasonBuffer.copy(payload, 2);

    try {
      writeSocketFrame(client.socket, 0x8, payload);
      client.socket.end();
    } catch (error) {
      log.warn("Failed to close WebSocket cleanly", error);
      client.socket.destroy();
    }
  }

  return {
    setSocketRelay,
    setSocketLifecycle,
    setSocketMessageRouter,
    setSocketTurnHandlers,
    rejectUpgrade,
    handleSocketMessage,
    handleTurnActionMessage,
    handleTurnEndMessage,
    broadcastSessionState,
    sendTurnSyncPayload,
    disconnectPlayerSockets,
    broadcastToSession,
    sendToSessionPlayer,
    broadcastRoomChannelToSession,
    broadcastRealtimeSocketMessageToSession,
    sendSocketPayload,
    sendSocketError,
    safeCloseSocket,
  };
}

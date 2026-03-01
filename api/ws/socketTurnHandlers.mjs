export function createSocketTurnMessageHandlers({
  turnPhases,
  ensureSessionTurnState,
  normalizeTurnPhase,
  markSessionActivity,
  processTurnAction,
  sendSocketError,
  sendTurnSyncPayload,
  broadcastToSession,
  broadcastRoundWinnerResolved,
  broadcastSessionState,
  persistStore,
  reconcileSessionLoops,
  clearParticipantTimeoutStrike,
  advanceSessionTurn,
  log,
  now = () => Date.now(),
}) {
  function persistWithWarning(message) {
    persistStore().catch((error) => {
      log.warn(message, error);
    });
  }

  function handleTurnActionMessage(client, session, payload) {
    const timestamp = now();
    session.participants[client.playerId].lastHeartbeatAt = timestamp;
    markSessionActivity(session, client.playerId, timestamp);
    const transition = processTurnAction(session, client.playerId, payload);
    if (!transition.ok) {
      sendSocketError(client, transition.code, transition.reason);
      if (transition.sync) {
        sendTurnSyncPayload(client, session, "sync");
      }
      return;
    }

    if (transition.message) {
      broadcastToSession(client.sessionId, JSON.stringify(transition.message), null);
    }

    if (transition.winnerResolved) {
      broadcastRoundWinnerResolved(
        session,
        client.playerId,
        transition.actionTimestamp,
        "winner_complete"
      );
    }

    if (!transition.shouldBroadcastState) {
      reconcileSessionLoops(client.sessionId);
      return;
    }

    broadcastSessionState(session, `turn_${transition.action}`);
    if (transition.shouldPersist) {
      persistWithWarning("Failed to persist session after turn action");
    }
    reconcileSessionLoops(client.sessionId);
  }

  function handleTurnEndMessage(client, session) {
    const timestamp = now();
    session.participants[client.playerId].lastHeartbeatAt = timestamp;
    markSessionActivity(session, client.playerId, timestamp);
    const turnState = ensureSessionTurnState(session);
    log.info(
      `Turn end request: session=${client.sessionId} player=${client.playerId} active=${turnState?.activeTurnPlayerId ?? "n/a"} order=${Array.isArray(turnState?.order) ? turnState.order.join(",") : "n/a"}`
    );
    if (!turnState?.activeTurnPlayerId) {
      sendSocketError(client, "turn_unavailable", "turn_unavailable");
      return;
    }

    if (turnState.activeTurnPlayerId !== client.playerId) {
      sendSocketError(client, "turn_not_active", "not_your_turn");
      sendTurnSyncPayload(client, session, "sync");
      return;
    }

    if (normalizeTurnPhase(turnState.phase) !== turnPhases.readyToEnd) {
      sendSocketError(client, "turn_action_required", "score_required_before_turn_end");
      sendTurnSyncPayload(client, session, "sync");
      return;
    }

    clearParticipantTimeoutStrike(session.participants[client.playerId]);
    const advanced = advanceSessionTurn(session, client.playerId, { source: "player" });
    if (!advanced) {
      sendSocketError(client, "turn_advance_failed", "turn_advance_failed");
      return;
    }
    log.info(
      `Turn advanced: session=${client.sessionId} endedBy=${advanced.turnEnd.playerId} next=${advanced.turnStart?.playerId ?? "none"} round=${advanced.turnStart?.round ?? turnState.round} turn=${advanced.turnStart?.turnNumber ?? turnState.turnNumber}`
    );

    broadcastToSession(client.sessionId, JSON.stringify(advanced.turnEnd), null);
    if (advanced.turnStart) {
      broadcastToSession(client.sessionId, JSON.stringify(advanced.turnStart), null);
    }
    broadcastSessionState(session, "turn_end");
    persistWithWarning("Failed to persist session after turn advance");
    reconcileSessionLoops(client.sessionId);
  }

  return {
    handleTurnActionMessage,
    handleTurnEndMessage,
  };
}

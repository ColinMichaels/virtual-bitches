import { randomUUID } from "node:crypto";
import { getStoreSections } from "../storage/defaultStore.mjs";

const REQUEST_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 10000);
const WS_TIMEOUT_MS = Number(process.env.E2E_WS_TIMEOUT_MS ?? 10000);
const firebaseIdToken = process.env.E2E_FIREBASE_ID_TOKEN?.trim() ?? "";
const assertBotTraffic = process.env.E2E_ASSERT_BOTS === "1";
const assertRoomExpiry = process.env.E2E_ASSERT_ROOM_EXPIRY === "1";
const assertChatConductFlow = process.env.E2E_ASSERT_CHAT_CONDUCT === "1";
const chatConductTestTerm = normalizeOptionalString(process.env.E2E_CHAT_CONDUCT_TEST_TERM).toLowerCase();
const assertModerationFlow = process.env.E2E_ASSERT_MULTIPLAYER_MODERATION !== "0";
const assertAdminMonitor = process.env.E2E_ASSERT_ADMIN_MONITOR === "1";
const assertAdminModerationTerms = process.env.E2E_ASSERT_ADMIN_MODERATION_TERMS === "1";
const assertStorageCutover = process.env.E2E_ASSERT_STORAGE_CUTOVER === "1";
const assertTimeoutStrikeObserver = process.env.E2E_ASSERT_TIMEOUT_STRIKE_OBSERVER !== "0";
const assertEightPlayerBotTimeout = process.env.E2E_ASSERT_EIGHT_PLAYER_BOT_TIMEOUT !== "0";
const adminToken = process.env.E2E_ADMIN_TOKEN?.trim() ?? "";
const roomExpiryWaitMs = Number(process.env.E2E_ROOM_EXPIRY_WAIT_MS ?? 9000);
const roomOverflowWaitMs = Number(process.env.E2E_ROOM_OVERFLOW_WAIT_MS ?? 8000);
const roomOverflowPollIntervalMs = Number(process.env.E2E_ROOM_OVERFLOW_POLL_INTERVAL_MS ?? 250);
const timeoutStrikeWaitBufferMs = Number(process.env.E2E_TIMEOUT_STRIKE_WAIT_BUFFER_MS ?? 7000);
const timeoutStrikePollIntervalMs = Number(process.env.E2E_TIMEOUT_STRIKE_POLL_INTERVAL_MS ?? 250);
const timeoutStrikeHeartbeatIntervalMs = Number(
  process.env.E2E_TIMEOUT_STRIKE_HEARTBEAT_INTERVAL_MS ?? 5000
);
// Production defaults to a 60s post-round auto-start window; keep smoke timeout above that.
const queueLifecycleWaitMs = Number(process.env.E2E_QUEUE_LIFECYCLE_WAIT_MS ?? 75000);
const expectedStorageBackend = normalizeOptionalString(process.env.E2E_EXPECT_STORAGE_BACKEND).toLowerCase();
const expectedFirestorePrefix = normalizeOptionalString(process.env.E2E_EXPECT_FIRESTORE_PREFIX);
const expectedStoreSections = getStoreSections();
const expectedStorageSectionMinCounts = parseStorageSectionMinCountSpec(
  process.env.E2E_EXPECT_STORAGE_SECTION_MIN_COUNTS
);
const failOnTransientQueueSessionExpired =
  process.env.E2E_FAIL_ON_TRANSIENT_QUEUE_SESSION_EXPIRED === "1";
const failOnTransientTimeoutStrikeSessionExpired =
  process.env.E2E_FAIL_ON_TRANSIENT_TIMEOUT_STRIKE_SESSION_EXPIRED === "1";
const failOnTransientEightPlayerBotSessionExpired =
  process.env.E2E_FAIL_ON_TRANSIENT_EIGHT_PLAYER_BOT_SESSION_EXPIRED === "1";

const baseInput = (process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3000").trim();
const wsOverride = process.env.E2E_WS_URL?.trim();
let targets;

let activeSessionId = "";
let hostPlayerId = "";
let guestPlayerId = "";
let hostSocket;
let guestSocket;
let hostMessageBuffer;
let guestMessageBuffer;

async function run() {
  targets = resolveTargets(baseInput, wsOverride);
  log(`API base URL: ${targets.apiBaseUrl}`);
  log(`WS base URL:  ${targets.wsBaseUrl}`);

  const health = await apiRequest("/health", { method: "GET" });
  if (expectedStorageBackend) {
    const reportedBackend =
      typeof health?.storage?.backend === "string"
        ? health.storage.backend.trim().toLowerCase()
        : "";
    assert(
      reportedBackend === expectedStorageBackend,
      `unexpected storage backend from /health (expected=${expectedStorageBackend}, actual=${reportedBackend || "unknown"})`
    );
  }

  const shouldRunAdminStorageChecks = assertStorageCutover || assertAdminMonitor;
  let storageSnapshot = null;
  if (shouldRunAdminStorageChecks) {
    assert(
      adminToken || firebaseIdToken,
      "admin storage checks require E2E_ADMIN_TOKEN or E2E_FIREBASE_ID_TOKEN"
    );
    storageSnapshot = await runStorageCutoverChecks();
  } else {
    log("Skipping storage cutover checks (set E2E_ASSERT_STORAGE_CUTOVER=1 to enable).");
  }

  if (assertAdminMonitor) {
    await runAdminMonitorChecks(storageSnapshot);
  } else {
    log("Skipping admin monitor checks (set E2E_ASSERT_ADMIN_MONITOR=1 to enable).");
  }

  if (assertAdminModerationTerms) {
    await runAdminModerationTermChecks();
  } else {
    log("Skipping admin moderation-term checks (set E2E_ASSERT_ADMIN_MODERATION_TERMS=1 to enable).");
  }

  const runSuffix = randomUUID().slice(0, 8);
  await runRoomLifecycleChecks(runSuffix);
  try {
    await runWinnerQueueLifecycleChecks(runSuffix);
  } catch (error) {
    if (!isTransientWinnerQueueLifecycleFailure(error)) {
      throw error;
    }
    const firstAttemptMessage = error instanceof Error ? error.message : String(error);
    log(
      `Winner queue lifecycle encountered transient failure; retrying once with a fresh session (${firstAttemptMessage}).`
    );
    await runWinnerQueueLifecycleChecks(`${runSuffix}-retry`);
  }
  if (assertTimeoutStrikeObserver) {
    try {
      await runTimeoutStrikeObserverSuite(runSuffix);
    } catch (error) {
      if (!isTransientTimeoutStrikeObserverFailure(error)) {
        throw error;
      }
      const firstAttemptMessage = error instanceof Error ? error.message : String(error);
      log(
        `Timeout strike observer checks encountered transient failure; retrying once with a fresh session (${firstAttemptMessage}).`
      );
      try {
        await runTimeoutStrikeObserverSuite(`${runSuffix}-retry`);
      } catch (retryError) {
        if (
          isTransientTimeoutStrikeSessionExpiredFailure(retryError) &&
          !failOnTransientTimeoutStrikeSessionExpired
        ) {
          log(
            "Timeout strike observer checks marked inconclusive due repeated transient session_expired in Cloud Run distributed flow; continuing (set E2E_FAIL_ON_TRANSIENT_TIMEOUT_STRIKE_SESSION_EXPIRED=1 to fail hard)."
          );
        } else {
          throw retryError;
        }
      }
    }
  } else {
    log("Skipping timeout strike observer checks (set E2E_ASSERT_TIMEOUT_STRIKE_OBSERVER=1 to enable).");
  }
  if (assertEightPlayerBotTimeout) {
    try {
      await runEightPlayerBotTimeoutChecks(runSuffix);
    } catch (error) {
      if (!isTransientEightPlayerBotTimeoutFailure(error)) {
        throw error;
      }
      const firstAttemptMessage = error instanceof Error ? error.message : String(error);
      log(
        `Eight-player bot timeout checks encountered transient failure; retrying once with a fresh session (${firstAttemptMessage}).`
      );
      try {
        await runEightPlayerBotTimeoutChecks(`${runSuffix}-retry`);
      } catch (retryError) {
        if (
          isTransientEightPlayerBotSessionExpiredFailure(retryError) &&
          !failOnTransientEightPlayerBotSessionExpired
        ) {
          log(
            "Eight-player bot timeout checks marked inconclusive due repeated transient session_expired in Cloud Run distributed flow; continuing (set E2E_FAIL_ON_TRANSIENT_EIGHT_PLAYER_BOT_SESSION_EXPIRED=1 to fail hard)."
          );
        } else {
          throw retryError;
        }
      }
    }
  } else {
    log("Skipping eight-player bot timeout checks (set E2E_ASSERT_EIGHT_PLAYER_BOT_TIMEOUT=1 to enable).");
  }
  hostPlayerId = `e2e-host-${runSuffix}`;
  guestPlayerId = `e2e-guest-${runSuffix}`;

  const created = await apiRequest("/multiplayer/sessions", {
    method: "POST",
    body: {
      playerId: hostPlayerId,
      displayName: "E2E Host",
      botCount: assertBotTraffic ? 1 : 0,
    },
  });
  assert(typeof created?.sessionId === "string", "create session returned no sessionId");
  assert(created?.auth?.accessToken, "create session returned no access token");
  activeSessionId = created.sessionId;
  let hostAccessToken = created.auth.accessToken;

  const joinedAttempt = await joinSessionByIdWithTransientRetry(
    activeSessionId,
    {
      playerId: guestPlayerId,
      displayName: "E2E Guest",
    },
    {
      maxAttempts: 6,
      initialDelayMs: 180,
    }
  );
  if (!joinedAttempt?.ok) {
    throw new Error(
      `request failed (POST /multiplayer/sessions/${activeSessionId}/join) status=${joinedAttempt?.status ?? "unknown"} body=${JSON.stringify(joinedAttempt?.body ?? null)}`
    );
  }
  const joined = joinedAttempt.body;
  assert(joined?.auth?.accessToken, "join session returned no access token");
  assert(Array.isArray(joined?.participants), "join session missing participants array");
  assert(
    joined.participants.some((participant) => participant?.playerId === guestPlayerId),
    "join session response missing guest participant"
  );
  assert(Array.isArray(joined?.turnState?.order), "join session missing turnState.order");
  let guestAccessToken = joined.auth.accessToken;
  const activeRoomCode = typeof created?.roomCode === "string" ? created.roomCode : "";

  hostSocket = await openSocket(
    "host",
    buildSocketUrl(activeSessionId, hostPlayerId, hostAccessToken)
  );
  hostMessageBuffer = createSocketMessageBuffer(hostSocket);
  guestSocket = await openSocket(
    "guest",
    buildSocketUrl(activeSessionId, guestPlayerId, guestAccessToken)
  );
  guestMessageBuffer = createSocketMessageBuffer(guestSocket);

  const setParticipantStateWithTransientRecovery = async ({
    sessionId,
    playerId,
    displayName,
    action,
    accessToken,
    label,
    maxAttempts = 6,
    initialDelayMs = 180,
  }) => {
    let token = accessToken;
    let lastFailure = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await apiRequestWithStatus(
        `/multiplayer/sessions/${encodeURIComponent(sessionId)}/participant-state`,
        {
          method: "POST",
          accessToken: token,
          body: {
            playerId,
            action,
          },
        }
      );
      if (response.ok && response.body?.ok === true) {
        return {
          body: response.body,
          accessToken: token,
        };
      }

      lastFailure = response;
      const failureReason = String(response?.body?.reason ?? "unknown");
      const transientSessionExpired =
        failureReason === "session_expired" ||
        (response.status === 410 && response.body?.reason === "session_expired");
      if (!transientSessionExpired && !isTransientQueueRefreshFailure(response)) {
        return {
          body: response.body,
          accessToken: token,
        };
      }

      if (attempt >= maxAttempts - 1) {
        break;
      }

      try {
        const recovered = await refreshSessionAuthWithRecovery({
          sessionId,
          playerId,
          displayName,
          accessToken: token,
          maxAttempts: 4,
          initialDelayMs: Math.max(120, initialDelayMs),
        });
        token = recovered.accessToken;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "");
        if (!message.toLowerCase().includes("session_expired")) {
          throw error;
        }
      }

      await waitMs(Math.max(50, initialDelayMs * (attempt + 1)));
    }

    if (lastFailure?.body) {
      return {
        body: lastFailure.body,
        accessToken: token,
      };
    }
    throw new Error(
      `${label} failed after ${maxAttempts} attempt(s) (status=${lastFailure?.status ?? "unknown"} body=${JSON.stringify(lastFailure?.body ?? null)})`
    );
  };

  const unauthorizedParticipantState = await apiRequestWithStatus(
    `/multiplayer/sessions/${encodeURIComponent(activeSessionId)}/participant-state`,
    {
      method: "POST",
      body: {
        playerId: hostPlayerId,
        action: "sit",
      },
    }
  );
  assertEqual(
    unauthorizedParticipantState.status,
    401,
    "participant-state should reject missing session auth token"
  );

  const hostSitOutcome = await setParticipantStateWithTransientRecovery({
    sessionId: activeSessionId,
    playerId: hostPlayerId,
    displayName: "E2E Host",
    action: "sit",
    accessToken: hostAccessToken,
    label: "host sit participant-state",
  });
  hostAccessToken = hostSitOutcome.accessToken;
  const hostSit = hostSitOutcome.body;
  assert(
    hostSit?.ok === true,
    `host sit participant-state did not return ok=true (reason=${String(hostSit?.reason ?? "unknown")})`
  );

  const guestSitOutcome = await setParticipantStateWithTransientRecovery({
    sessionId: activeSessionId,
    playerId: guestPlayerId,
    displayName: "E2E Guest",
    action: "sit",
    accessToken: guestAccessToken,
    label: "guest sit participant-state",
  });
  guestAccessToken = guestSitOutcome.accessToken;
  const guestSit = guestSitOutcome.body;
  assert(
    guestSit?.ok === true,
    `guest sit participant-state did not return ok=true (reason=${String(guestSit?.reason ?? "unknown")})`
  );

  const hostReadyOutcome = await setParticipantStateWithTransientRecovery({
    sessionId: activeSessionId,
    playerId: hostPlayerId,
    displayName: "E2E Host",
    action: "ready",
    accessToken: hostAccessToken,
    label: "host ready participant-state",
  });
  hostAccessToken = hostReadyOutcome.accessToken;
  const hostReady = hostReadyOutcome.body;
  assert(
    hostReady?.ok === true,
    `host ready participant-state did not return ok=true (reason=${String(hostReady?.reason ?? "unknown")})`
  );

  const guestReadyOutcome = await setParticipantStateWithTransientRecovery({
    sessionId: activeSessionId,
    playerId: guestPlayerId,
    displayName: "E2E Guest",
    action: "ready",
    accessToken: guestAccessToken,
    label: "guest ready participant-state",
  });
  guestAccessToken = guestReadyOutcome.accessToken;
  const guestReady = guestReadyOutcome.body;
  assert(
    guestReady?.ok === true,
    `guest ready participant-state did not return ok=true (reason=${String(guestReady?.reason ?? "unknown")})`
  );

  const guestReadyState = await waitForBufferedMessage(
    guestMessageBuffer,
    (payload) =>
      payload?.type === "session_state" &&
      payload?.sessionId === activeSessionId &&
      Array.isArray(payload?.turnState?.order) &&
      payload.turnState.order.includes(hostPlayerId) &&
      payload.turnState.order.includes(guestPlayerId) &&
      Array.isArray(payload?.participants) &&
      payload.participants
        .filter((participant) => participant && !participant.isBot)
        .every((participant) => participant?.isReady === true),
    "guest ready session_state"
  );
  assert(
    guestReadyState.participants
      .filter((participant) => participant && !participant.isBot)
      .every((participant) => participant?.isReady === true),
    "expected all human participants to be ready after socket connect"
  );
  assert(
    Array.isArray(guestReadyState?.turnState?.order) &&
      guestReadyState.turnState.order.includes(hostPlayerId),
    "ready session_state turnState.order missing host player"
  );
  assert(
    Array.isArray(guestReadyState?.turnState?.order) &&
      guestReadyState.turnState.order.includes(guestPlayerId),
    "ready session_state turnState.order missing guest player"
  );

  const expectedFirstTurnPlayerId =
    typeof guestReadyState?.turnState?.activeTurnPlayerId === "string"
      ? guestReadyState.turnState.activeTurnPlayerId
      : hostPlayerId;
  assertEqual(expectedFirstTurnPlayerId, hostPlayerId, "expected host first turn");

  guestSocket.send(JSON.stringify({ type: "turn_end" }));
  const guestTurnError = await waitForBufferedMessage(
    guestMessageBuffer,
    (payload) => payload?.type === "error" && payload?.code === "turn_not_active",
    "guest invalid turn_end rejection"
  );
  assertEqual(guestTurnError.code, "turn_not_active", "expected turn_not_active rejection");
  const guestTurnSync = await waitForBufferedMessage(
    guestMessageBuffer,
    (payload) =>
      payload?.type === "turn_start" && payload?.playerId === expectedFirstTurnPlayerId,
    "guest turn sync receive"
  );
  assertEqual(
    guestTurnSync.playerId,
    expectedFirstTurnPlayerId,
    "guest turn sync active player mismatch"
  );
  assert(
    typeof guestTurnSync.turnExpiresAt === "number" &&
      Number.isFinite(guestTurnSync.turnExpiresAt),
    "turn sync missing turn deadline"
  );
  assert(
    typeof guestTurnSync.turnTimeoutMs === "number" &&
      Number.isFinite(guestTurnSync.turnTimeoutMs),
    "turn sync missing turn timeout"
  );

  const expectedSecondTurnPlayerId =
    Array.isArray(guestReadyState?.turnState?.order) &&
    guestReadyState.turnState.order.length > 1
      ? guestReadyState.turnState.order[1]
      : (guestReadyState?.turnState?.order?.[0] ?? guestPlayerId);
  hostSocket.send(JSON.stringify({ type: "turn_end" }));
  const prematureTurnEndError = await waitForBufferedMessage(
    hostMessageBuffer,
    (payload) => payload?.type === "error" && payload?.code === "turn_action_required",
    "host premature turn_end rejection"
  );
  assertEqual(
    prematureTurnEndError.code,
    "turn_action_required",
    "expected turn_action_required rejection"
  );

  const guestTurnRollPromise = waitForBufferedMessage(
    guestMessageBuffer,
    (payload) =>
      payload?.type === "turn_action" &&
      payload?.playerId === hostPlayerId &&
      payload?.action === "roll",
    "guest turn roll receive"
  );
  const turnRollPayload = {
    rollIndex: 1,
    dice: [
      { dieId: "d6-a", sides: 6 },
      { dieId: "d8-a", sides: 8 },
    ],
  };
  hostSocket.send(
    JSON.stringify({ type: "turn_action", action: "roll", roll: turnRollPayload })
  );
  const guestTurnRolled = await guestTurnRollPromise;
  assertEqual(guestTurnRolled.action, "roll", "turn_action roll mismatch");
  const rollServerId = guestTurnRolled?.roll?.serverRollId;
  assert(
    typeof rollServerId === "string" && rollServerId.length > 0,
    "missing server-issued roll id"
  );
  const rolledD6 = Array.isArray(guestTurnRolled?.roll?.dice)
    ? guestTurnRolled.roll.dice.find((die) => die?.dieId === "d6-a")
    : null;
  const expectedScorePoints =
    rolledD6 && Number.isFinite(rolledD6.sides) && Number.isFinite(rolledD6.value)
      ? Math.floor(rolledD6.sides) - Math.floor(rolledD6.value)
      : NaN;
  const expectedRemainingAfterScore = 14;
  assert(
    Number.isFinite(expectedScorePoints) && expectedScorePoints >= 0,
    "expected score points not derivable from server roll"
  );
  const guestSessionAfterRoll = await waitForBufferedMessage(
    guestMessageBuffer,
    (payload) =>
      payload?.type === "session_state" &&
      payload?.sessionId === activeSessionId &&
      payload?.turnState?.phase === "await_score",
    "guest session_state after roll"
  );
  assertEqual(
    guestSessionAfterRoll?.turnState?.activeRollServerId,
    rollServerId,
    "session_state activeRollServerId mismatch after roll"
  );

  hostSocket.send(
    JSON.stringify({
      type: "turn_action",
      action: "score",
      score: {
        selectedDiceIds: ["d6-a"],
        points: expectedScorePoints + 1,
        rollServerId: rollServerId,
        projectedTotalScore: expectedScorePoints + 1,
      },
    })
  );
  const invalidScoreError = await waitForBufferedMessage(
    hostMessageBuffer,
    (payload) => payload?.type === "error" && payload?.code === "turn_action_invalid_score",
    "host invalid score rejection"
  );
  assertEqual(
    invalidScoreError.code,
    "turn_action_invalid_score",
    "expected invalid score rejection"
  );
  const hostTurnSyncAfterInvalidScore = await waitForBufferedMessage(
    hostMessageBuffer,
    (payload) =>
      payload?.type === "turn_start" &&
      payload?.playerId === hostPlayerId &&
      payload?.activeRollServerId === rollServerId,
    "host turn sync after invalid score"
  );
  assertEqual(
    hostTurnSyncAfterInvalidScore.activeRollServerId,
    rollServerId,
    "turn sync activeRollServerId mismatch"
  );
  assert(
    Array.isArray(hostTurnSyncAfterInvalidScore?.activeRoll?.dice) &&
      hostTurnSyncAfterInvalidScore.activeRoll.dice.length > 0,
    "turn sync missing active roll snapshot"
  );

  const guestTurnScorePromise = waitForBufferedMessage(
    guestMessageBuffer,
    (payload) =>
      payload?.type === "turn_action" &&
      payload?.playerId === hostPlayerId &&
      payload?.action === "score",
    "guest turn score receive"
  );
  hostSocket.send(
    JSON.stringify({
      type: "turn_action",
      action: "score",
      score: {
        selectedDiceIds: ["d6-a"],
        points: expectedScorePoints,
        rollServerId: rollServerId,
        projectedTotalScore: expectedScorePoints,
      },
    })
  );
  const guestTurnScored = await guestTurnScorePromise;
  assertEqual(guestTurnScored.action, "score", "turn_action score mismatch");
  const guestSessionAfterScore = await waitForBufferedMessage(
    guestMessageBuffer,
    (payload) =>
      payload?.type === "session_state" &&
      payload?.sessionId === activeSessionId &&
      payload?.turnState?.phase === "ready_to_end" &&
      Array.isArray(payload?.participants) &&
      payload.participants.some(
        (participant) =>
          participant?.playerId === hostPlayerId && participant?.score === expectedScorePoints
      ),
    "guest session_state after score"
  );
  const hostParticipantAfterScore = guestSessionAfterScore.participants.find(
    (participant) => participant?.playerId === hostPlayerId
  );
  assertEqual(
    hostParticipantAfterScore?.score,
    expectedScorePoints,
    "expected host participant score update after validated score action"
  );
  assert(
    Number.isFinite(hostParticipantAfterScore?.remainingDice) &&
      hostParticipantAfterScore.remainingDice === expectedRemainingAfterScore,
    "expected host remainingDice to decrement after score action"
  );

  const guestTurnEndedPromise = waitForBufferedMessage(
    guestMessageBuffer,
    (payload) => payload?.type === "turn_end" && payload?.playerId === hostPlayerId,
    "guest turn_end receive"
  );
  const guestTurnStartedPromise = waitForBufferedMessage(
    guestMessageBuffer,
    (payload) =>
      payload?.type === "turn_start" && payload?.playerId === expectedSecondTurnPlayerId,
    "guest next turn_start receive"
  );
  hostSocket.send(JSON.stringify({ type: "turn_end", playerId: hostPlayerId }));
  const guestTurnEnded = await guestTurnEndedPromise;
  assertEqual(guestTurnEnded.playerId, hostPlayerId, "turn_end player mismatch");
  const guestTurnStarted = await guestTurnStartedPromise;
  assertEqual(
    guestTurnStarted.playerId,
    expectedSecondTurnPlayerId,
    "turn_start next player mismatch"
  );
  const guestSessionAfterTurnAdvance = await waitForBufferedMessage(
    guestMessageBuffer,
    (payload) =>
      payload?.type === "session_state" &&
      payload?.sessionId === activeSessionId &&
      payload?.turnState?.activeTurnPlayerId === expectedSecondTurnPlayerId,
    "guest session_state after turn advance"
  );
  assertEqual(
    guestSessionAfterTurnAdvance?.turnState?.activeTurnPlayerId,
    expectedSecondTurnPlayerId,
    "session_state active turn mismatch after turn advance"
  );

  const chaosAttack = createChaosAttack(runSuffix);
  hostSocket.send(JSON.stringify(chaosAttack));
  const guestChaosMessage = await waitForMessage(
    guestSocket,
    (payload) =>
      payload?.type === "chaos_attack" && payload?.abilityId === chaosAttack.abilityId,
    "guest chaos attack receive"
  );
  assert(
    guestChaosMessage.targetId === chaosAttack.targetId,
    "chaos attack targetId mismatch on guest receive"
  );

  const particleEmit = createParticleEmit(runSuffix);
  guestSocket.send(JSON.stringify(particleEmit));
  const hostParticleMessage = await waitForMessage(
    hostSocket,
    (payload) =>
      payload?.type === "particle:emit" && payload?.effectId === particleEmit.effectId,
    "host particle receive"
  );
  assert(
    hostParticleMessage.effectId === particleEmit.effectId,
    "particle effectId mismatch on host receive"
  );

  const gameUpdate = createGameUpdate(runSuffix);
  hostSocket.send(JSON.stringify(gameUpdate));
  const guestGameUpdate = await waitForMessage(
    guestSocket,
    (payload) => payload?.type === "game_update" && payload?.id === gameUpdate.id,
    "guest game update receive"
  );
  assert(
    guestGameUpdate.title === gameUpdate.title,
    "game update title mismatch on guest receive"
  );

  const playerNotification = createPlayerNotification(runSuffix);
  guestSocket.send(JSON.stringify(playerNotification));
  const hostPlayerNotification = await waitForMessage(
    hostSocket,
    (payload) =>
      payload?.type === "player_notification" && payload?.id === playerNotification.id,
    "host player notification receive"
  );
  assert(
    hostPlayerNotification.message === playerNotification.message,
    "player notification message mismatch on host receive"
  );

  const publicRoomChannel = createRoomChannelMessage(runSuffix, {
    channel: "public",
    topic: "chat",
    title: "E2E Public Chat",
    message: "Public room channel relay test",
  });
  hostSocket.send(JSON.stringify(publicRoomChannel));
  const guestRoomChannel = await waitForMessage(
    guestSocket,
    (payload) =>
      payload?.type === "room_channel" && payload?.id === publicRoomChannel.id,
    "guest room channel public receive"
  );
  assertEqual(
    guestRoomChannel.channel,
    "public",
    "room channel public routing mismatch on guest receive"
  );
  assert(
    guestRoomChannel.message === publicRoomChannel.message,
    "room channel public message mismatch on guest receive"
  );

  const directRoomChannel = createRoomChannelMessage(runSuffix, {
    channel: "direct",
    topic: "whisper",
    title: "E2E Whisper",
    message: "Direct room channel relay test",
    targetPlayerId: hostPlayerId,
  });
  guestSocket.send(JSON.stringify(directRoomChannel));
  const hostRoomChannel = await waitForMessage(
    hostSocket,
    (payload) =>
      payload?.type === "room_channel" && payload?.id === directRoomChannel.id,
    "host room channel direct receive"
  );
  assertEqual(
    hostRoomChannel.channel,
    "direct",
    "room channel direct routing mismatch on host receive"
  );
  assertEqual(
    hostRoomChannel.targetPlayerId,
    hostPlayerId,
    "room channel direct target mismatch on host receive"
  );
  assert(
    hostRoomChannel.message === directRoomChannel.message,
    "room channel direct message mismatch on host receive"
  );

  if (assertChatConductFlow) {
    log("Running multiplayer chat-conduct strike/mute checks...");
    assert(chatConductTestTerm.length > 0, "chat-conduct smoke requires E2E_CHAT_CONDUCT_TEST_TERM");
    const chatConductHealth = health?.multiplayer?.chatConduct;
    assert(chatConductHealth?.enabled === true, "chat-conduct smoke requires multiplayer.chatConduct.enabled=true");
    const bannedTermsCount = Number(chatConductHealth?.bannedTermsCount ?? 0);
    assert(
      Number.isFinite(bannedTermsCount) && bannedTermsCount > 0,
      "chat-conduct smoke requires at least one configured banned term"
    );
    const strikeLimitRaw = Number(chatConductHealth?.strikeLimit ?? 3);
    const strikeLimit =
      Number.isFinite(strikeLimitRaw) && strikeLimitRaw > 0 ? Math.floor(strikeLimitRaw) : 3;

    for (let index = 0; index < strikeLimit; index += 1) {
      const blockedRoomChannel = createRoomChannelMessage(runSuffix, {
        channel: "public",
        topic: "chat",
        title: "E2E Conduct Strike",
        message: `Filtered term test ${chatConductTestTerm} #${index + 1}`,
      });
      hostSocket.send(JSON.stringify(blockedRoomChannel));
      const blockedError = await waitForBufferedMessage(
        hostMessageBuffer,
        (payload) => payload?.type === "error" && payload?.code === "room_channel_message_blocked",
        `host room_channel_message_blocked strike ${index + 1}`
      );
      assertEqual(
        blockedError?.code,
        "room_channel_message_blocked",
        "expected room_channel_message_blocked conduct rejection"
      );
      await assertNoBufferedMessage(
        guestMessageBuffer,
        (payload) =>
          payload?.type === "room_channel" && payload?.id === blockedRoomChannel.id,
        400,
        "guest blocked room channel relay"
      );
    }

    const mutedProbe = createRoomChannelMessage(runSuffix, {
      channel: "public",
      topic: "chat",
      title: "E2E Conduct Mute Probe",
      message: "Safe chat message should be muted after strikes",
    });
    hostSocket.send(JSON.stringify(mutedProbe));
    const mutedError = await waitForBufferedMessage(
      hostMessageBuffer,
      (payload) => payload?.type === "error" && payload?.code === "room_channel_sender_muted",
      "host room_channel_sender_muted rejection"
    );
    assertEqual(
      mutedError?.code,
      "room_channel_sender_muted",
      "expected room_channel_sender_muted after strike limit"
    );
    await assertNoBufferedMessage(
      guestMessageBuffer,
      (payload) => payload?.type === "room_channel" && payload?.id === mutedProbe.id,
      400,
      "guest muted room channel relay"
    );

    const adminAuthOptions = buildAdminAuthRequestOptions();
    if (
      adminAuthOptions.accessToken ||
      (adminAuthOptions.headers &&
        typeof adminAuthOptions.headers === "object" &&
        typeof adminAuthOptions.headers["x-admin-token"] === "string" &&
        adminAuthOptions.headers["x-admin-token"].length > 0)
    ) {
      const conductBeforeClear = await apiRequest(
        `/admin/sessions/${encodeURIComponent(activeSessionId)}/conduct/players/${encodeURIComponent(hostPlayerId)}`,
        {
          method: "GET",
          ...adminAuthOptions,
        }
      );
      assert(
        conductBeforeClear?.player?.isMuted === true,
        "expected host conduct player record to report isMuted=true before clear"
      );

      const clearConduct = await apiRequest(
        `/admin/sessions/${encodeURIComponent(activeSessionId)}/conduct/players/${encodeURIComponent(hostPlayerId)}/clear`,
        {
          method: "POST",
          ...adminAuthOptions,
          body: {
            resetTotalStrikes: true,
          },
        }
      );
      assert(clearConduct?.ok === true, "admin conduct player clear did not report success");

      const unmutedMessage = createRoomChannelMessage(runSuffix, {
        channel: "public",
        topic: "chat",
        title: "E2E Conduct Unmute Probe",
        message: "Chat should relay again after admin clear",
      });
      hostSocket.send(JSON.stringify(unmutedMessage));
      const guestUnmutedMessage = await waitForBufferedMessage(
        guestMessageBuffer,
        (payload) => payload?.type === "room_channel" && payload?.id === unmutedMessage.id,
        "guest room channel receive after admin conduct clear"
      );
      assertEqual(
        guestUnmutedMessage?.id,
        unmutedMessage.id,
        "expected room channel relay after admin conduct clear"
      );
    } else {
      log("Skipping chat-conduct admin clear verification (no admin auth configured).");
    }

    log("Multiplayer chat-conduct strike/mute checks passed.");
  } else {
    log("Skipping multiplayer chat-conduct checks (set E2E_ASSERT_CHAT_CONDUCT=1 to enable).");
  }

  if (assertModerationFlow) {
    log("Running multiplayer moderation + interaction-block checks...");
    const profileUpdate = await apiRequest(`/players/${encodeURIComponent(guestPlayerId)}/profile`, {
      method: "PUT",
      accessToken: guestAccessToken,
      body: {
        playerId: guestPlayerId,
        displayName: "E2E Guest",
        blockedPlayerIds: [hostPlayerId],
        updatedAt: Date.now(),
      },
    });
    assert(Array.isArray(profileUpdate?.blockedPlayerIds), "blocked profile update missing blockedPlayerIds");
    assert(
      profileUpdate.blockedPlayerIds.includes(hostPlayerId),
      "blocked profile update missing host in blockedPlayerIds"
    );

    const blockedInteraction = {
      ...createPlayerNotification(runSuffix),
      id: `e2e-blocked-interaction-${runSuffix}`,
      targetPlayerId: guestPlayerId,
      message: "This direct interaction should be blocked",
    };
    hostSocket.send(JSON.stringify(blockedInteraction));
    const interactionBlockedError = await waitForBufferedMessage(
      hostMessageBuffer,
      (payload) => payload?.type === "error" && payload?.code === "interaction_blocked",
      "host interaction_blocked rejection"
    );
    assertEqual(
      interactionBlockedError?.code,
      "interaction_blocked",
      "expected interaction_blocked rejection for blocked direct interaction"
    );
    await assertNoBufferedMessage(
      guestMessageBuffer,
      (payload) =>
        payload?.type === "player_notification" && payload?.id === blockedInteraction.id,
      400,
      "guest blocked interaction relay"
    );

    const kickResult = await apiRequest(
      `/multiplayer/sessions/${encodeURIComponent(activeSessionId)}/moderate`,
      {
        method: "POST",
        accessToken: hostAccessToken,
        body: {
          requesterPlayerId: hostPlayerId,
          targetPlayerId: guestPlayerId,
          action: "kick",
        },
      }
    );
    assert(kickResult?.ok === true, "kick moderation did not return ok=true");
    assertEqual(kickResult?.action, "kick", "kick moderation returned unexpected action");

    const rejoinAfterKick = await apiRequest(
      `/multiplayer/sessions/${encodeURIComponent(activeSessionId)}/join`,
      {
        method: "POST",
        body: {
          playerId: guestPlayerId,
          displayName: "E2E Guest",
        },
      }
    );
    assert(
      typeof rejoinAfterKick?.auth?.accessToken === "string" && rejoinAfterKick.auth.accessToken.length > 0,
      "guest rejoin after kick returned no access token"
    );
    guestAccessToken = rejoinAfterKick.auth.accessToken;
    await safeCloseSocket(guestSocket);
    guestSocket = await openSocket(
      "guest_rejoin_after_kick",
      buildSocketUrl(activeSessionId, guestPlayerId, guestAccessToken)
    );
    guestMessageBuffer = createSocketMessageBuffer(guestSocket);

    const banResult = await apiRequest(
      `/multiplayer/sessions/${encodeURIComponent(activeSessionId)}/moderate`,
      {
        method: "POST",
        accessToken: hostAccessToken,
        body: {
          requesterPlayerId: hostPlayerId,
          targetPlayerId: guestPlayerId,
          action: "ban",
        },
      }
    );
    assert(banResult?.ok === true, "ban moderation did not return ok=true");
    assertEqual(banResult?.action, "ban", "ban moderation returned unexpected action");

    const bannedJoinBySessionId = await apiRequestWithStatus(
      `/multiplayer/sessions/${encodeURIComponent(activeSessionId)}/join`,
      {
        method: "POST",
        body: {
          playerId: guestPlayerId,
          displayName: "E2E Guest",
        },
      }
    );
    assertEqual(
      bannedJoinBySessionId.status,
      403,
      "expected room_banned 403 when banned player rejoins by session id"
    );
    assertEqual(
      bannedJoinBySessionId.body?.reason,
      "room_banned",
      "expected room_banned reason when banned player rejoins by session id"
    );
    if (activeRoomCode) {
      const bannedJoinByRoomCode = await apiRequestWithStatus(
        `/multiplayer/rooms/${encodeURIComponent(activeRoomCode)}/join`,
        {
          method: "POST",
          body: {
            playerId: guestPlayerId,
            displayName: "E2E Guest",
          },
        }
      );
      assertEqual(
        bannedJoinByRoomCode.status,
        403,
        "expected room_banned 403 when banned player rejoins by room code"
      );
      assertEqual(
        bannedJoinByRoomCode.body?.reason,
        "room_banned",
        "expected room_banned reason when banned player rejoins by room code"
      );
    }
    log("Multiplayer moderation + interaction-block checks passed.");
  } else {
    log("Skipping multiplayer moderation checks (set E2E_ASSERT_MULTIPLAYER_MODERATION=1 to enable).");
  }

  if (assertBotTraffic) {
    await waitForMessage(hostSocket, isBotPayload, "host bot websocket traffic receive");
  }

  const heartbeat = await apiRequest(
    `/multiplayer/sessions/${encodeURIComponent(activeSessionId)}/heartbeat`,
    {
      method: "POST",
      accessToken: hostAccessToken,
      body: { playerId: hostPlayerId },
    }
  );
  assert(heartbeat?.ok === true, "heartbeat response was not ok=true");

  const playerScoreA = `e2e-score-sync-${runSuffix}-a`;
  const playerScoreB = `e2e-score-sync-${runSuffix}-b`;
  const scoreBatchWrite = await apiRequest(
    `/players/${encodeURIComponent(hostPlayerId)}/scores/batch`,
    {
      method: "POST",
      accessToken: hostAccessToken,
      body: {
        scores: [
          {
            scoreId: playerScoreA,
            score: 118,
            timestamp: Date.now(),
            duration: 185000,
            rollCount: 16,
            mode: { difficulty: "normal", variant: "classic" },
          },
          {
            scoreId: playerScoreB,
            score: 104,
            timestamp: Date.now(),
            duration: 162000,
            rollCount: 14,
            mode: { difficulty: "normal", variant: "classic" },
          },
        ],
      },
    }
  );
  assertEqual(scoreBatchWrite?.accepted, 2, "player score batch write accepted count mismatch");
  assertEqual(scoreBatchWrite?.failed, 0, "player score batch write failed count mismatch");

  const scoreHistory = await apiRequest(
    `/players/${encodeURIComponent(hostPlayerId)}/scores?limit=30`,
    {
      method: "GET",
    }
  );
  assert(Array.isArray(scoreHistory?.entries), "player score history missing entries[]");
  const entryIds = scoreHistory.entries.map((entry) => String(entry?.scoreId ?? ""));
  assert(
    entryIds.includes(playerScoreA) && entryIds.includes(playerScoreB),
    "player score history missing recently written score entries"
  );
  if (scoreHistory?.stats && scoreHistory.stats.played !== undefined) {
    assert(
      Number.isFinite(Number(scoreHistory.stats.played)) && Number(scoreHistory.stats.played) >= 0,
      "player score history stats.played should be a non-negative number when provided"
    );
  }

  if (firebaseIdToken) {
    const authMe = await apiRequest("/auth/me", {
      method: "GET",
      accessToken: firebaseIdToken,
    });
    assert(
      typeof authMe?.uid === "string" && authMe.uid.length > 0,
      "auth/me expected a non-empty uid"
    );
    const unauthorizedAuthMe = await apiRequestWithStatus("/auth/me", {
      method: "GET",
    });
    assertEqual(
      unauthorizedAuthMe.status,
      401,
      "auth/me should reject requests without auth header"
    );

    const scoreSubmission = await apiRequest("/leaderboard/scores", {
      method: "POST",
      accessToken: firebaseIdToken,
      body: {
        scoreId: `e2e-score-${runSuffix}`,
        score: 42,
        timestamp: Date.now(),
        duration: 180000,
        rollCount: 7,
        playerName: "E2E Host",
        mode: {
          difficulty: "normal",
          variant: "classic",
        },
      },
    });
    assert(scoreSubmission?.score === 42, "leaderboard score submission failed");

    const leaderboard = await apiRequest("/leaderboard/global?limit=5", {
      method: "GET",
    });
    assert(Array.isArray(leaderboard?.entries), "global leaderboard did not return entries[]");
    assert(
      leaderboard.entries.some((entry) => entry?.id === scoreSubmission.id),
      "submitted score was not present in global leaderboard response"
    );
  } else {
    log("Skipping leaderboard write verification (set E2E_FIREBASE_ID_TOKEN to enable).");
  }

  log("Smoke test passed.");
}

async function runRoomLifecycleChecks(runSuffix) {
  log("Running room lifecycle checks...");

  const initialListing = await apiRequest("/multiplayer/rooms?limit=100", { method: "GET" });
  assert(Array.isArray(initialListing?.rooms), "room listing missing rooms[]");
  const initialRooms = initialListing.rooms;
  const defaultRooms = initialRooms.filter((room) => room?.roomType === "public_default");
  assert(defaultRooms.length >= 2, "expected at least two default public lobby rooms");
  const defaultDifficulties = new Set(
    defaultRooms
      .map((room) =>
        typeof room?.gameDifficulty === "string" ? room.gameDifficulty.trim().toLowerCase() : ""
      )
      .filter((difficulty) => difficulty.length > 0)
  );
  ["easy", "normal", "hard"].forEach((difficulty) => {
    assert(
      defaultDifficulties.has(difficulty),
      `expected at least one default ${difficulty} public lobby room`
    );
  });

  const joinablePublicRooms = initialRooms.filter((room) => {
    return isJoinablePublicRoom(room);
  });
  assert(joinablePublicRooms.length > 0, "expected at least one joinable public room");

  const targetRoom = joinablePublicRooms[0];
  let targetRoomId = String(targetRoom.sessionId ?? "");
  let targetRoomCode = String(targetRoom.roomCode ?? "");
  assert(targetRoomId.length > 0, "target public room missing sessionId");
  assert(targetRoomCode.length > 0, "target public room missing roomCode");

  const maxHumans = Number.isFinite(targetRoom.maxHumanCount)
    ? Math.max(2, Math.floor(targetRoom.maxHumanCount))
    : 8;
  const joinedPlayers = [];
  let roomFullObserved = false;
  let fillOrdinal = 1;
  const maxRoomFillAttempts = Math.max(maxHumans * 4, maxHumans + 8);
  for (let attempt = 1; attempt <= maxRoomFillAttempts; attempt += 1) {
    const playerId = `e2e-roomfill-${runSuffix}-${fillOrdinal}`;
    fillOrdinal += 1;
    let joinAttempt = await apiRequestWithStatus(
      `/multiplayer/sessions/${encodeURIComponent(targetRoomId)}/join`,
      {
        method: "POST",
        body: {
          playerId,
          displayName: `E2E Fill ${attempt}`,
        },
      }
    );
    if (!joinAttempt.ok && isTransientRoomLookupFailure(joinAttempt)) {
      joinAttempt = await joinSessionByIdWithTransientRetry(
        targetRoomId,
        {
          playerId,
          displayName: `E2E Fill ${attempt}`,
        },
        {
          maxAttempts: 5,
          initialDelayMs: 120,
        }
      );
    }
    if (!joinAttempt.ok && isTransientRoomLookupFailure(joinAttempt)) {
      const roomJoinAttempt = await joinRoomByCodeWithTransientRetry(
        targetRoomCode,
        {
          playerId,
          displayName: `E2E Fill ${attempt}`,
        },
        {
          maxAttempts: 5,
          initialDelayMs: 150,
        }
      );
      if (
        roomJoinAttempt.ok &&
        typeof roomJoinAttempt.body?.roomCode === "string" &&
        roomJoinAttempt.body.roomCode.length > 0
      ) {
        targetRoomCode = String(roomJoinAttempt.body.roomCode);
      }
      joinAttempt = roomJoinAttempt;
    }
    assert(joinAttempt, "missing room fill join attempt result");
    if (isRoomFullJoinFailure(joinAttempt)) {
      roomFullObserved = true;
      break;
    }
    if (joinAttempt.ok) {
      const joinedSessionId = String(joinAttempt.body?.sessionId ?? targetRoomId);
      if (joinedSessionId.length > 0) {
        if (joinedSessionId !== targetRoomId) {
          log(
            `Room lifecycle fill target session moved from ${targetRoomId} to ${joinedSessionId}; continuing with resolved session.`
          );
        }
        targetRoomId = joinedSessionId;
      }
      if (
        typeof joinAttempt.body?.roomCode === "string" &&
        joinAttempt.body.roomCode.length > 0
      ) {
        targetRoomCode = String(joinAttempt.body.roomCode);
      }
      joinedPlayers.push({
        playerId,
        sessionId: joinedSessionId,
      });
      continue;
    }
    throw new Error(
      `unexpected room fill join result status=${joinAttempt.status} body=${JSON.stringify(joinAttempt.body)}`
    );
  }
  assert(
    roomFullObserved,
    `expected room_full while filling target public room (targetSession=${targetRoomId}, roomCode=${targetRoomCode})`
  );

  const privateCreatorId = `e2e-private-${runSuffix}`;
  const privateCreated = await apiRequest("/multiplayer/sessions", {
    method: "POST",
    body: {
      playerId: privateCreatorId,
      displayName: "E2E Private Creator",
    },
  });
  assert(
    typeof privateCreated?.sessionId === "string" && privateCreated.sessionId.length > 0,
    "expected private room creation to remain available when public rooms are saturated"
  );
  assert(
    privateCreated?.roomType === "private" || privateCreated?.isPublic === false,
    "expected explicit create-session flow to produce a private room"
  );
  const privateVisibilityListing = await apiRequest("/multiplayer/rooms?limit=100", { method: "GET" });
  assert(Array.isArray(privateVisibilityListing?.rooms), "private visibility room listing missing rooms[]");
  const privateRoomListed = privateVisibilityListing.rooms.some(
    (room) => room?.sessionId === privateCreated.sessionId
  );
  assert(!privateRoomListed, "expected private room to be excluded from public room listing");
  const privateJoinerId = `e2e-private-join-${runSuffix}`;
  let expectedPrivateSessionId = privateCreated.sessionId;
  let expectedPrivateCreatorId = privateCreatorId;
  let expectedPrivateJoinerId = privateJoinerId;
  let privateJoinAttempt = await joinRoomByCodeWithTransientRetry(
    privateCreated.roomCode,
    {
      playerId: privateJoinerId,
      displayName: "E2E Private Joiner",
    },
    {
      maxAttempts: 8,
      initialDelayMs: 200,
    }
  );
  if (!privateJoinAttempt.ok && isTransientRoomLookupFailure(privateJoinAttempt)) {
    privateJoinAttempt = await joinSessionByIdWithTransientRetry(
      privateCreated.sessionId,
      {
        playerId: privateJoinerId,
        displayName: "E2E Private Joiner",
      }
    );
    if (privateJoinAttempt.ok) {
      log("Private room join-by-code fallback resolved via sessionId join.");
    } else if (isTransientRoomLookupFailure(privateJoinAttempt)) {
      log(
        `Private room join remained transient after sessionId retries (status=${privateJoinAttempt.status} reason=${String(privateJoinAttempt.body?.reason ?? "unknown")}); retrying with fresh private room.`
      );
      await safeLeave(privateCreated.sessionId, privateCreatorId);
      const privateRetryCreatorId = `${privateCreatorId}-retry`;
      const privateRetryJoinerId = `${privateJoinerId}-retry`;
      const privateRetryCreated = await apiRequest("/multiplayer/sessions", {
        method: "POST",
        body: {
          playerId: privateRetryCreatorId,
          displayName: "E2E Private Creator Retry",
        },
      });
      expectedPrivateSessionId = privateRetryCreated.sessionId;
      expectedPrivateCreatorId = privateRetryCreatorId;
      expectedPrivateJoinerId = privateRetryJoinerId;
      privateJoinAttempt = await joinRoomByCodeWithTransientRetry(
        privateRetryCreated.roomCode,
        {
          playerId: privateRetryJoinerId,
          displayName: "E2E Private Joiner Retry",
        },
        {
          maxAttempts: 8,
          initialDelayMs: 200,
        }
      );
      if (!privateJoinAttempt.ok && isTransientRoomLookupFailure(privateJoinAttempt)) {
        privateJoinAttempt = await joinSessionByIdWithTransientRetry(
          privateRetryCreated.sessionId,
          {
            playerId: privateRetryJoinerId,
            displayName: "E2E Private Joiner Retry",
          },
          {
            maxAttempts: 6,
            initialDelayMs: 180,
          }
        );
      }
    }
  }
  assert(privateJoinAttempt, "missing private room join attempt result");
  assert(
    privateJoinAttempt.ok,
    `expected private room join to succeed (status=${privateJoinAttempt.status} body=${JSON.stringify(privateJoinAttempt.body)})`
  );
  const privateJoinedByCode = privateJoinAttempt.body;
  assertEqual(
    privateJoinedByCode?.sessionId,
    expectedPrivateSessionId,
    "expected join-by-room-code to resolve private room session"
  );
  await safeLeave(expectedPrivateSessionId, expectedPrivateJoinerId);
  await safeLeave(expectedPrivateSessionId, expectedPrivateCreatorId);
  if (
    expectedPrivateSessionId !== privateCreated.sessionId ||
    expectedPrivateCreatorId !== privateCreatorId ||
    expectedPrivateJoinerId !== privateJoinerId
  ) {
    await safeLeave(privateCreated.sessionId, privateJoinerId);
    await safeLeave(privateCreated.sessionId, privateCreatorId);
  }

  let fullSessionJoinProbe = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const fullSessionJoinProbePlayerId = `e2e-roomfill-extra-session-${runSuffix}-${attempt}`;
    let probeAttempt = await apiRequestWithStatus(
      `/multiplayer/sessions/${encodeURIComponent(targetRoomId)}/join`,
      {
        method: "POST",
        body: {
          playerId: fullSessionJoinProbePlayerId,
          displayName: "E2E Overflow Session Probe",
        },
      }
    );
    if (!probeAttempt.ok && isTransientRoomLookupFailure(probeAttempt)) {
      const recoveredByCode = await joinRoomByCodeWithTransientRetry(
        targetRoomCode,
        {
          playerId: fullSessionJoinProbePlayerId,
          displayName: "E2E Overflow Session Probe",
        },
        {
          maxAttempts: 4,
          initialDelayMs: 120,
        }
      );
      probeAttempt = recoveredByCode;
    }
    if (isRoomFullJoinFailure(probeAttempt)) {
      fullSessionJoinProbe = probeAttempt;
      break;
    }
    if (probeAttempt.ok) {
      const joinedSessionId = String(probeAttempt.body?.sessionId ?? targetRoomId);
      if (joinedSessionId && joinedSessionId !== targetRoomId) {
        log(
          `Full-session probe target moved from ${targetRoomId} to ${joinedSessionId}; continuing probe on resolved session.`
        );
        targetRoomId = joinedSessionId;
      }
      if (
        typeof probeAttempt.body?.roomCode === "string" &&
        probeAttempt.body.roomCode.length > 0
      ) {
        targetRoomCode = String(probeAttempt.body.roomCode);
      }
      joinedPlayers.push({
        playerId: fullSessionJoinProbePlayerId,
        sessionId: joinedSessionId || targetRoomId,
      });
      if (attempt < 6) {
        await waitMs(120 * attempt);
      }
      continue;
    }
    throw new Error(
      `expected room_full 409 once target room session is at capacity, got status=${probeAttempt.status} body=${JSON.stringify(probeAttempt.body)}`
    );
  }
  assert(
    fullSessionJoinProbe && fullSessionJoinProbe.body?.reason === "room_full",
    `expected room_full reason in full-session join rejection (targetSession=${targetRoomId}, roomCode=${targetRoomCode})`
  );

  const fullJoinProbePlayerIdPrefix = `e2e-roomfill-extra-code-${runSuffix}`;
  let roomCodeProbeSatisfied = false;
  let sameSessionProbeSuccesses = 0;
  let lastRoomCodeProbe = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const fullJoinProbePlayerId = `${fullJoinProbePlayerIdPrefix}-${attempt}`;
    const fullJoinProbe = await joinRoomByCodeWithTransientRetry(
      targetRoomCode,
      {
        playerId: fullJoinProbePlayerId,
        displayName: "E2E Overflow Code Probe",
      },
      {
        maxAttempts: 5,
        initialDelayMs: 150,
      }
    );
    lastRoomCodeProbe = fullJoinProbe;
    if (fullJoinProbe.status === 409 && fullJoinProbe.body?.reason === "room_full") {
      roomCodeProbeSatisfied = true;
      break;
    }
    if (!fullJoinProbe.ok) {
      throw new Error(
        `expected room_full from room-code probe, got status=${fullJoinProbe.status} body=${JSON.stringify(fullJoinProbe.body)}`
      );
    }

    const resolvedSessionId = String(fullJoinProbe.body?.sessionId ?? "");
    if (!resolvedSessionId) {
      throw new Error(
        `expected room-code probe to include sessionId, got status=${fullJoinProbe.status} body=${JSON.stringify(fullJoinProbe.body)}`
      );
    }
    if (resolvedSessionId !== targetRoomId) {
      log(
        `Room-code probe resolved to a different session (${resolvedSessionId}) while target session ${targetRoomId} is full.`
      );
      await safeLeave(resolvedSessionId, fullJoinProbePlayerId);
      roomCodeProbeSatisfied = true;
      break;
    }

    sameSessionProbeSuccesses += 1;
    await safeLeave(resolvedSessionId, fullJoinProbePlayerId);
    if (attempt < 4) {
      log(
        `Room-code probe attempt ${attempt} resolved to target session ${targetRoomId} after prior room_full check; retrying for consistency.`
      );
      await waitMs(120 * attempt);
    }
  }
  if (!roomCodeProbeSatisfied && sameSessionProbeSuccesses > 0) {
    log(
      `Room-code probe repeatedly resolved to target session after prior room_full check (${sameSessionProbeSuccesses} attempts); treating as transient distributed-state drift.`
    );
    roomCodeProbeSatisfied = true;
  }
  assert(
    roomCodeProbeSatisfied,
    `expected room_full or different-session resolution from room-code probe, got status=${lastRoomCodeProbe?.status ?? "unknown"} body=${JSON.stringify(lastRoomCodeProbe?.body ?? null)}`
  );

  let postFillRooms = [];
  let joinableOverflowRoom = null;
  const overflowWaitDeadlineMs = Date.now() + Math.max(0, roomOverflowWaitMs);
  let overflowPollAttempt = 0;
  while (Date.now() <= overflowWaitDeadlineMs) {
    overflowPollAttempt += 1;
    const postFillListing = await apiRequest("/multiplayer/rooms?limit=100", { method: "GET" });
    assert(Array.isArray(postFillListing?.rooms), "post-fill room listing missing rooms[]");
    postFillRooms = postFillListing.rooms;
    joinableOverflowRoom = postFillRooms.find((room) => isJoinableOverflowRoom(room));
    if (joinableOverflowRoom) {
      break;
    }
    if (Date.now() >= overflowWaitDeadlineMs) {
      break;
    }
    if (overflowPollAttempt === 1 || overflowPollAttempt % 5 === 0) {
      log(`Waiting for joinable overflow room inventory after fill (attempt ${overflowPollAttempt}).`);
    }
    await waitMs(Math.max(50, roomOverflowPollIntervalMs));
  }

  const joinablePublicRoomsAfterFill = postFillRooms.filter((room) => isJoinablePublicRoom(room));
  assert(
    joinablePublicRoomsAfterFill.length > 0,
    "expected at least one joinable public room after filling a public room"
  );
  if (!joinableOverflowRoom) {
    log(
      `No joinable overflow room observed after fill; continuing with ${joinablePublicRoomsAfterFill.length} joinable public rooms.`
    );
  }
  const overflowRoomId = joinableOverflowRoom ? String(joinableOverflowRoom.sessionId ?? "") : "";
  if (joinableOverflowRoom) {
    assert(overflowRoomId.length > 0, "overflow room missing sessionId");
  }

  for (const joined of joinedPlayers) {
    await safeLeave(joined.sessionId || targetRoomId, joined.playerId);
  }

  const resetListing = await apiRequest("/multiplayer/rooms?limit=100", { method: "GET" });
  assert(Array.isArray(resetListing?.rooms), "reset room listing missing rooms[]");
  const resetRoom = resetListing.rooms.find((room) => room?.roomCode === targetRoomCode);
  assert(resetRoom, "expected filled public room to remain listed after players leave");
  const resetSlots = getAvailableHumanSlots(resetRoom);
  assert(resetSlots > 0, "expected emptied public room to be joinable again");

  if (assertRoomExpiry) {
    if (!overflowRoomId) {
      log("Skipping room expiry assertion because no overflow room was provisioned in this run.");
    } else {
      await waitMs(Math.max(1000, roomExpiryWaitMs));
      const expiryListing = await apiRequest("/multiplayer/rooms?limit=100", { method: "GET" });
      assert(Array.isArray(expiryListing?.rooms), "expiry room listing missing rooms[]");
      const overflowStillPresent = expiryListing.rooms.some((room) => room?.sessionId === overflowRoomId);
      assert(
        !overflowStillPresent,
        `expected overflow room ${overflowRoomId} to expire and disappear from room list`
      );
    }
  } else {
    log("Skipping room expiry assertion (set E2E_ASSERT_ROOM_EXPIRY=1 to enable).");
  }

  log("Room lifecycle checks passed.");
}

async function runWinnerQueueLifecycleChecks(runSuffix) {
  log("Running winner queue lifecycle checks...");

  const queueHostPlayerId = `e2e-queue-host-${runSuffix}`;
  const queueGuestPlayerId = `e2e-queue-guest-${runSuffix}`;
  const created = await apiRequest("/multiplayer/sessions", {
    method: "POST",
    body: {
      playerId: queueHostPlayerId,
      displayName: "E2E Queue Host",
      botCount: 0,
    },
  });
  assert(typeof created?.sessionId === "string", "queue lifecycle create session returned no sessionId");
  assert(created?.auth?.accessToken, "queue lifecycle create session returned no access token");

  const queueSessionId = created.sessionId;
  let hostAccessToken = created.auth.accessToken;
  let queueHostSocket = null;
  let queueHostMessageBuffer = null;
  let queueHostSocketUnexpectedCloseCount = 0;
  const queueLifecycleEvents = [];

  try {
    queueHostSocket = await openSocket(
      "queue-host",
      buildSocketUrl(queueSessionId, queueHostPlayerId, hostAccessToken)
    );
    queueHostMessageBuffer = createSocketMessageBuffer(queueHostSocket);
    queueHostSocket.addEventListener("close", (event) => {
      if (event.code !== 1000) {
        queueHostSocketUnexpectedCloseCount += 1;
      }
    });
  } catch (error) {
    log(`Queue lifecycle host socket unavailable; falling back to HTTP-only polling (${String(error)}).`);
  }

  try {
    const joinedAttempt = await joinSessionByIdWithTransientRetry(
      queueSessionId,
      {
        playerId: queueGuestPlayerId,
        displayName: "E2E Queue Guest",
      },
      {
        maxAttempts: 8,
        initialDelayMs: 220,
      }
    );
    if (!joinedAttempt?.ok) {
      throw new Error(
        `request failed (POST /multiplayer/sessions/${queueSessionId}/join) status=${joinedAttempt?.status ?? "unknown"} body=${JSON.stringify(joinedAttempt?.body ?? null)}`
      );
    }
    const joined = joinedAttempt.body;
    assert(Array.isArray(joined?.participants), "queue lifecycle join missing participants[]");
    const guestAccessToken =
      typeof joined?.auth?.accessToken === "string" ? joined.auth.accessToken : "";
    assert(guestAccessToken, "queue lifecycle join returned no guest access token");

    const hostSat = await apiRequest(
      `/multiplayer/sessions/${encodeURIComponent(queueSessionId)}/participant-state`,
      {
        method: "POST",
        accessToken: hostAccessToken,
        body: {
          playerId: queueHostPlayerId,
          action: "sit",
        },
      }
    );
    assert(
      hostSat?.ok === true,
      `queue lifecycle host sit did not return ok=true (reason=${String(hostSat?.reason ?? "unknown")})`
    );

    const guestSat = await apiRequest(
      `/multiplayer/sessions/${encodeURIComponent(queueSessionId)}/participant-state`,
      {
        method: "POST",
        accessToken: guestAccessToken,
        body: {
          playerId: queueGuestPlayerId,
          action: "sit",
        },
      }
    );
    assert(
      guestSat?.ok === true,
      `queue lifecycle guest sit did not return ok=true (reason=${String(guestSat?.reason ?? "unknown")})`
    );

    await apiRequest(`/multiplayer/sessions/${encodeURIComponent(queueSessionId)}/leave`, {
      method: "POST",
      body: { playerId: queueGuestPlayerId },
    });

    const queued = await apiRequest(
      `/multiplayer/sessions/${encodeURIComponent(queueSessionId)}/queue-next`,
      {
        method: "POST",
        accessToken: hostAccessToken,
        body: { playerId: queueHostPlayerId },
      }
    );
    assert(queued?.ok === true, "queue lifecycle queue-next did not return ok=true");
    assert(
      queued?.queuedForNextGame === true,
      "queue lifecycle queue-next did not mark queuedForNextGame=true"
    );
    const queuedHost = Array.isArray(queued?.session?.participants)
      ? queued.session.participants.find(
          (participant) => participant?.playerId === queueHostPlayerId
        )
      : null;
    assert(queuedHost, "queue lifecycle response missing host participant snapshot");
    assert(
      queuedHost?.queuedForNextGame === true,
      "queue lifecycle host participant missing queuedForNextGame=true after queue-next"
    );
    if (queueHostMessageBuffer) {
      queueHostMessageBuffer.length = 0;
    }

    const deadline = Date.now() + Math.max(5000, queueLifecycleWaitMs);
    let restarted = null;
    let lastHeartbeatPingAt = 0;
    let lastRefreshAttemptAt = 0;
    let lastRefreshFailure = null;
    while (Date.now() < deadline) {
      const now = Date.now();
      const wsRestarted =
        queueHostMessageBuffer &&
        consumeQueueLifecycleRestartFromBuffer(
          queueHostMessageBuffer,
          queueSessionId,
          queueHostPlayerId
        );
      if (wsRestarted) {
        queueLifecycleEvents.push(
          `[${now}] ws_restart_detected session=${queueSessionId} player=${queueHostPlayerId}`
        );
        restarted = wsRestarted;
        lastRefreshFailure = null;
        break;
      }

      if (now - lastHeartbeatPingAt >= 10000) {
        const heartbeat = await apiRequestWithStatus(
          `/multiplayer/sessions/${encodeURIComponent(queueSessionId)}/heartbeat`,
          {
            method: "POST",
            accessToken: hostAccessToken,
            body: { playerId: queueHostPlayerId },
          }
        );
        if (heartbeat?.ok) {
          queueLifecycleEvents.push(`[${now}] heartbeat_ok`);
          lastHeartbeatPingAt = now;
        } else if (isTransientQueueRefreshFailure(heartbeat)) {
          // In production Cloud Run + external store flows, heartbeat can transiently
          // observe stale session/auth state while refresh/rejoin recovery converges.
          lastRefreshFailure = heartbeat;
          lastHeartbeatPingAt = now;
          queueLifecycleEvents.push(
            `[${now}] heartbeat_transient status=${heartbeat.status} reason=${String(heartbeat.body?.reason ?? "unknown")}`
          );
          log(
            `Queue lifecycle heartbeat transient failure status=${heartbeat.status} reason=${String(heartbeat.body?.reason ?? "unknown")}; attempting auth refresh recovery.`
          );
        } else {
          throw new Error(
            `queue lifecycle heartbeat failed status=${heartbeat?.status ?? "unknown"} body=${JSON.stringify(heartbeat?.body ?? null)}`
          );
        }
      }

      if (now - lastRefreshAttemptAt < 3000) {
        await waitMs(250);
        continue;
      }
      lastRefreshAttemptAt = now;

      const requestAuthRefresh = () =>
        apiRequestWithStatus(`/multiplayer/sessions/${encodeURIComponent(queueSessionId)}/auth/refresh`, {
          method: "POST",
          accessToken: hostAccessToken,
          body: { playerId: queueHostPlayerId },
        });

      let refreshedAttempt = await requestAuthRefresh();
      if (refreshedAttempt.ok !== true && isTransientQueueRefreshFailure(refreshedAttempt)) {
        for (let recoveryAttempt = 1; recoveryAttempt <= 3; recoveryAttempt += 1) {
          const rejoinAttempt = await apiRequestWithStatus(
            `/multiplayer/sessions/${encodeURIComponent(queueSessionId)}/join`,
            {
              method: "POST",
              body: {
                playerId: queueHostPlayerId,
                displayName: "E2E Queue Host",
              },
            }
          );
          if (rejoinAttempt.ok === true) {
            refreshedAttempt = rejoinAttempt;
            log(
              `Queue lifecycle auth refresh recovered via session rejoin fallback (attempt ${recoveryAttempt}).`
            );
            break;
          }
          if (!isTransientQueueRefreshFailure(rejoinAttempt)) {
            refreshedAttempt = rejoinAttempt;
            throw new Error(
              `request failed (POST /multiplayer/sessions/${queueSessionId}/join) status=${rejoinAttempt.status} body=${JSON.stringify(rejoinAttempt.body)}`
            );
          }
          if (recoveryAttempt >= 3) {
            refreshedAttempt = rejoinAttempt;
            break;
          }

          lastRefreshFailure = rejoinAttempt;
          await waitMs(150 * recoveryAttempt);
          refreshedAttempt = await requestAuthRefresh();
          if (!isTransientQueueRefreshFailure(refreshedAttempt)) {
            break;
          }
        }
      }
      if (!refreshedAttempt.ok) {
        if (isTransientQueueRefreshFailure(refreshedAttempt)) {
          lastRefreshFailure = refreshedAttempt;
          queueLifecycleEvents.push(
            `[${now}] refresh_transient status=${refreshedAttempt.status} reason=${String(refreshedAttempt.body?.reason ?? "unknown")}`
          );
          await waitMs(250);
          continue;
        }
        throw new Error(
          `request failed (POST /multiplayer/sessions/${queueSessionId}/auth/refresh) status=${refreshedAttempt.status} body=${JSON.stringify(refreshedAttempt.body)}`
        );
      }
      const refreshed = refreshedAttempt.body;
      lastRefreshFailure = null;
      if (typeof refreshed?.auth?.accessToken === "string" && refreshed.auth.accessToken.length > 0) {
        hostAccessToken = refreshed.auth.accessToken;
      }
      queueLifecycleEvents.push(`[${now}] refresh_ok`);

      const refreshedHost = Array.isArray(refreshed?.participants)
        ? refreshed.participants.find((participant) => participant?.playerId === queueHostPlayerId)
        : null;
      const hostReadyForFreshRound =
        refreshedHost &&
        refreshedHost.queuedForNextGame !== true &&
        refreshedHost.isComplete !== true &&
        Number(refreshedHost.score ?? 0) === 0 &&
        Number(refreshedHost.remainingDice ?? -1) === 15;
      if (hostReadyForFreshRound && refreshed?.sessionComplete !== true) {
        queueLifecycleEvents.push(`[${now}] refresh_detected_restart`);
        restarted = refreshed;
        break;
      }

      await waitMs(250);
    }

    const refreshFailureDetails = lastRefreshFailure
      ? ` (last transient refresh failure status=${lastRefreshFailure.status} body=${JSON.stringify(lastRefreshFailure.body)})`
      : "";
    if (!restarted) {
      const healthSnapshot = await apiRequestWithStatus("/health", { method: "GET" });
      const diagnostics = {
        sessionId: queueSessionId,
        queueHostSocketConnected: Boolean(queueHostSocket),
        queueHostSocketUnexpectedCloseCount,
        lastRefreshFailure,
        deadlineMs: Math.max(5000, queueLifecycleWaitMs),
        recentEvents: queueLifecycleEvents.slice(-14),
        healthStatus: healthSnapshot?.status ?? null,
        healthRuntime: healthSnapshot?.body?.runtime ?? null,
      };
      log(`Queue lifecycle diagnostics: ${JSON.stringify(diagnostics)}`);
      const transientSessionExpiredFailure =
        lastRefreshFailure?.status === 410 &&
        lastRefreshFailure?.body?.reason === "session_expired";
      if (transientSessionExpiredFailure && !failOnTransientQueueSessionExpired) {
        log(
          "Queue lifecycle marked inconclusive due repeated transient session_expired in Cloud Run distributed flow; continuing (set E2E_FAIL_ON_TRANSIENT_QUEUE_SESSION_EXPIRED=1 to fail hard)."
        );
        return;
      }
    }
    assert(
      restarted,
      `queue lifecycle did not auto-start a fresh round within expected wait window${refreshFailureDetails}`
    );
    log("Winner queue lifecycle checks passed.");
  } finally {
    await safeCloseSocket(queueHostSocket);
    await safeLeave(queueSessionId, queueGuestPlayerId);
    await safeLeave(queueSessionId, queueHostPlayerId);
  }
}

async function runTimeoutStrikeObserverChecks(runSuffix) {
  log("Running timeout strike observer checks...");

  const timeoutHostPlayerId = `e2e-timeout-host-${runSuffix}`;
  const timeoutGuestAPlayerId = `e2e-timeout-guest-a-${runSuffix}`;
  const timeoutGuestBPlayerId = `e2e-timeout-guest-b-${runSuffix}`;
  const timeoutHostDisplayName = "E2E Timeout Host";
  const timeoutGuestADisplayName = "E2E Timeout Guest A";
  const timeoutGuestBDisplayName = "E2E Timeout Guest B";

  const created = await apiRequest("/multiplayer/sessions", {
    method: "POST",
    body: {
      playerId: timeoutHostPlayerId,
      displayName: timeoutHostDisplayName,
      botCount: 0,
      gameDifficulty: "hard",
    },
  });
  assert(typeof created?.sessionId === "string", "timeout strike create session returned no sessionId");
  assert(created?.auth?.accessToken, "timeout strike create session returned no host access token");

  const timeoutSessionId = created.sessionId;
  let hostAccessToken = created.auth.accessToken;
  let guestAAccessToken = "";
  let guestBAccessToken = "";
  let timeoutHostSocket = null;
  let timeoutHostMessageBuffer = null;

  try {
    try {
      timeoutHostSocket = await openSocket(
        "timeout-strike-host",
        buildSocketUrl(timeoutSessionId, timeoutHostPlayerId, hostAccessToken)
      );
      timeoutHostMessageBuffer = createSocketMessageBuffer(timeoutHostSocket);
    } catch (error) {
      log(`Timeout strike host socket unavailable; falling back to HTTP-only polling (${String(error)}).`);
    }

    const joinGuestAAttempt = await joinSessionByIdWithTransientRetry(
      timeoutSessionId,
      {
        playerId: timeoutGuestAPlayerId,
        displayName: timeoutGuestADisplayName,
      },
      {
        maxAttempts: 8,
        initialDelayMs: 220,
      }
    );
    if (!joinGuestAAttempt?.ok) {
      throw new Error(
        `request failed (POST /multiplayer/sessions/${timeoutSessionId}/join) status=${joinGuestAAttempt?.status ?? "unknown"} body=${JSON.stringify(joinGuestAAttempt?.body ?? null)}`
      );
    }
    const joinGuestA = joinGuestAAttempt.body;
    guestAAccessToken = typeof joinGuestA?.auth?.accessToken === "string" ? joinGuestA.auth.accessToken : "";
    assert(guestAAccessToken, "timeout strike guest A join returned no access token");

    const joinGuestBAttempt = await joinSessionByIdWithTransientRetry(
      timeoutSessionId,
      {
        playerId: timeoutGuestBPlayerId,
        displayName: timeoutGuestBDisplayName,
      },
      {
        maxAttempts: 8,
        initialDelayMs: 220,
      }
    );
    if (!joinGuestBAttempt?.ok) {
      throw new Error(
        `request failed (POST /multiplayer/sessions/${timeoutSessionId}/join) status=${joinGuestBAttempt?.status ?? "unknown"} body=${JSON.stringify(joinGuestBAttempt?.body ?? null)}`
      );
    }
    const joinGuestB = joinGuestBAttempt.body;
    guestBAccessToken = typeof joinGuestB?.auth?.accessToken === "string" ? joinGuestB.auth.accessToken : "";
    assert(guestBAccessToken, "timeout strike guest B join returned no access token");

    const setParticipantState = async (playerId, accessToken, action, label) => {
      const response = await apiRequest(
        `/multiplayer/sessions/${encodeURIComponent(timeoutSessionId)}/participant-state`,
        {
          method: "POST",
          accessToken,
          body: {
            playerId,
            action,
          },
        }
      );
      assert(
        response?.ok === true,
        `${label} did not return ok=true (reason=${String(response?.reason ?? "unknown")})`
      );
      return response;
    };

    await setParticipantState(timeoutHostPlayerId, hostAccessToken, "sit", "timeout strike host sit");
    await setParticipantState(timeoutGuestAPlayerId, guestAAccessToken, "sit", "timeout strike guest A sit");
    await setParticipantState(timeoutGuestBPlayerId, guestBAccessToken, "sit", "timeout strike guest B sit");
    await setParticipantState(timeoutHostPlayerId, hostAccessToken, "ready", "timeout strike host ready");
    await setParticipantState(timeoutGuestAPlayerId, guestAAccessToken, "ready", "timeout strike guest A ready");
    await setParticipantState(timeoutGuestBPlayerId, guestBAccessToken, "ready", "timeout strike guest B ready");

    const initialRefresh = await refreshSessionAuthWithRecovery({
      sessionId: timeoutSessionId,
      playerId: timeoutHostPlayerId,
      displayName: timeoutHostDisplayName,
      accessToken: hostAccessToken,
    });
    hostAccessToken = initialRefresh.accessToken;
    const initialSnapshot = initialRefresh.snapshot;
    const initialTurnState = initialSnapshot?.turnState ?? null;
    const initialActivePlayerId =
      typeof initialTurnState?.activeTurnPlayerId === "string" ? initialTurnState.activeTurnPlayerId : "";
    assert(
      initialActivePlayerId === timeoutHostPlayerId,
      `timeout strike expected host to receive first active turn (active=${initialActivePlayerId || "none"})`
    );

    const initialRound = normalizeE2ERoundNumber(initialTurnState?.round);
    const timeoutMs = normalizeE2ETurnTimeoutMs(initialTurnState?.turnTimeoutMs);
    const firstTimeoutWaitMs = computeTurnAutoAdvanceWaitMs(initialTurnState, timeoutMs);

    if (timeoutHostMessageBuffer) {
      timeoutHostMessageBuffer.length = 0;
    }
    const firstTimeout = await waitForTurnAutoAdvanceForPlayer({
      sessionId: timeoutSessionId,
      playerId: timeoutHostPlayerId,
      expectedRound: initialRound,
      hostPlayerId: timeoutHostPlayerId,
      hostDisplayName: timeoutHostDisplayName,
      accessToken: hostAccessToken,
      messageBuffer: timeoutHostMessageBuffer,
      waitTimeoutMs: firstTimeoutWaitMs,
    });
    hostAccessToken = firstTimeout.accessToken;
    const firstSnapshot = firstTimeout.snapshot;
    const firstTurnState = firstSnapshot?.turnState ?? null;
    const firstRound = normalizeE2ERoundNumber(firstTurnState?.round);
    assert(
      firstRound === initialRound,
      `timeout strike expected first host timeout to remain in same round (expected=${initialRound}, actual=${firstRound})`
    );

    const activeAfterFirstTimeout =
      typeof firstTurnState?.activeTurnPlayerId === "string" ? firstTurnState.activeTurnPlayerId : "";
    assert(
      activeAfterFirstTimeout &&
        activeAfterFirstTimeout !== timeoutHostPlayerId &&
        (activeAfterFirstTimeout === timeoutGuestAPlayerId ||
          activeAfterFirstTimeout === timeoutGuestBPlayerId),
      `timeout strike expected a guest active turn after first host timeout (active=${activeAfterFirstTimeout || "none"})`
    );

    const activeGuestToken =
      activeAfterFirstTimeout === timeoutGuestAPlayerId ? guestAAccessToken : guestBAccessToken;
    assert(activeGuestToken, `timeout strike missing access token for active guest ${activeAfterFirstTimeout}`);
    await setParticipantState(
      activeAfterFirstTimeout,
      activeGuestToken,
      "stand",
      "timeout strike active guest stand"
    );

    if (timeoutHostMessageBuffer) {
      timeoutHostMessageBuffer.length = 0;
    }
    const recoveredHost = await waitForActiveTurnPlayer({
      sessionId: timeoutSessionId,
      targetPlayerId: timeoutHostPlayerId,
      expectedRound: firstRound,
      hostPlayerId: timeoutHostPlayerId,
      hostDisplayName: timeoutHostDisplayName,
      accessToken: hostAccessToken,
      waitTimeoutMs: Math.max(5000, timeoutMs),
    });
    hostAccessToken = recoveredHost.accessToken;
    const recoveredSnapshot = recoveredHost.snapshot;
    const recoveredTurnState = recoveredSnapshot?.turnState ?? null;
    const recoveredRound = normalizeE2ERoundNumber(recoveredTurnState?.round);
    assert(
      recoveredRound === firstRound,
      `timeout strike expected host recovery to keep same round (expected=${firstRound}, actual=${recoveredRound})`
    );
    const seatedOpponents = Array.isArray(recoveredSnapshot?.participants)
      ? recoveredSnapshot.participants.filter(
          (participant) =>
            participant &&
            participant.playerId !== timeoutHostPlayerId &&
            participant.isSeated === true &&
            participant.queuedForNextGame !== true
        )
      : [];
    assert(
      seatedOpponents.length >= 1,
      "timeout strike expected at least one seated opponent before second host timeout"
    );

    const secondTimeoutWaitMs = computeTurnAutoAdvanceWaitMs(
      recoveredTurnState,
      normalizeE2ETurnTimeoutMs(recoveredTurnState?.turnTimeoutMs, timeoutMs)
    );
    const secondTimeout = await waitForTurnAutoAdvanceForPlayer({
      sessionId: timeoutSessionId,
      playerId: timeoutHostPlayerId,
      expectedRound: firstRound,
      hostPlayerId: timeoutHostPlayerId,
      hostDisplayName: timeoutHostDisplayName,
      accessToken: hostAccessToken,
      messageBuffer: timeoutHostMessageBuffer,
      waitTimeoutMs: secondTimeoutWaitMs,
    });
    hostAccessToken = secondTimeout.accessToken;
    const secondSnapshot = secondTimeout.snapshot;
    const secondTurnState = secondSnapshot?.turnState ?? null;
    const secondRound = normalizeE2ERoundNumber(secondTurnState?.round);
    assert(
      secondRound === firstRound,
      `timeout strike expected second host timeout to remain in same round (expected=${firstRound}, actual=${secondRound})`
    );
    const hostAfterSecondTimeout = findSnapshotParticipant(secondSnapshot, timeoutHostPlayerId);
    assert(hostAfterSecondTimeout, "timeout strike snapshot missing host participant after second timeout");
    assert(
      hostAfterSecondTimeout?.isSeated === false,
      "timeout strike expected host to be moved to observer lounge (isSeated=false) after second timeout"
    );
    assert(
      hostAfterSecondTimeout?.isReady !== true,
      "timeout strike expected host to be unready after observer/lounge move"
    );
    assert(
      hostAfterSecondTimeout?.queuedForNextGame !== true,
      "timeout strike expected host queuedForNextGame=false after observer/lounge move"
    );
    assert(
      hostAfterSecondTimeout?.isComplete === true,
      "timeout strike expected host marked complete after observer/lounge move"
    );
    if (typeof secondTimeout.reason === "string" && secondTimeout.reason.length > 0) {
      assert(
        secondTimeout.reason.includes("turn_timeout_stand") ||
          secondTimeout.reason.includes("turn_timeout_auto_score_stand"),
        `timeout strike expected stand timeout reason on second timeout (actual=${secondTimeout.reason})`
      );
    }

    log("Timeout strike observer checks passed.");
  } finally {
    await safeCloseSocket(timeoutHostSocket);
    await safeLeave(timeoutSessionId, timeoutGuestAPlayerId);
    await safeLeave(timeoutSessionId, timeoutGuestBPlayerId);
    await safeLeave(timeoutSessionId, timeoutHostPlayerId);
  }
}

async function runTimeoutStrikeObserverSuite(runSuffix) {
  await runTimeoutStrikeObserverChecks(runSuffix);
  await runTimeoutStrikeObserverTwoPlayerWrapChecks(`${runSuffix}-2p`);
}

async function runTimeoutStrikeObserverTwoPlayerWrapChecks(runSuffix) {
  log("Running timeout strike observer two-player wrap checks...");

  const timeoutHostPlayerId = `e2e-timeout-2p-host-${runSuffix}`;
  const timeoutGuestPlayerId = `e2e-timeout-2p-guest-${runSuffix}`;
  const timeoutHostDisplayName = "E2E Timeout 2P Host";
  const timeoutGuestDisplayName = "E2E Timeout 2P Guest";

  const created = await apiRequest("/multiplayer/sessions", {
    method: "POST",
    body: {
      playerId: timeoutHostPlayerId,
      displayName: timeoutHostDisplayName,
      botCount: 0,
      gameDifficulty: "hard",
    },
  });
  assert(typeof created?.sessionId === "string", "timeout strike 2p create session returned no sessionId");
  assert(created?.auth?.accessToken, "timeout strike 2p create session returned no host access token");

  const timeoutSessionId = created.sessionId;
  let hostAccessToken = created.auth.accessToken;
  let guestAccessToken = "";
  let timeoutHostSocket = null;
  let timeoutHostMessageBuffer = null;

  try {
    try {
      timeoutHostSocket = await openSocket(
        "timeout-strike-2p-host",
        buildSocketUrl(timeoutSessionId, timeoutHostPlayerId, hostAccessToken)
      );
      timeoutHostMessageBuffer = createSocketMessageBuffer(timeoutHostSocket);
    } catch (error) {
      log(
        `Timeout strike 2p host socket unavailable; falling back to HTTP-only polling (${String(error)}).`
      );
    }

    const joinGuestAttempt = await joinSessionByIdWithTransientRetry(
      timeoutSessionId,
      {
        playerId: timeoutGuestPlayerId,
        displayName: timeoutGuestDisplayName,
      },
      {
        maxAttempts: 8,
        initialDelayMs: 220,
      }
    );
    if (!joinGuestAttempt?.ok) {
      throw new Error(
        `request failed (POST /multiplayer/sessions/${timeoutSessionId}/join) status=${joinGuestAttempt?.status ?? "unknown"} body=${JSON.stringify(joinGuestAttempt?.body ?? null)}`
      );
    }
    guestAccessToken =
      typeof joinGuestAttempt.body?.auth?.accessToken === "string"
        ? joinGuestAttempt.body.auth.accessToken
        : "";
    assert(guestAccessToken, "timeout strike 2p guest join returned no access token");

    const setParticipantState = async (playerId, accessToken, action, label) => {
      const response = await apiRequest(
        `/multiplayer/sessions/${encodeURIComponent(timeoutSessionId)}/participant-state`,
        {
          method: "POST",
          accessToken,
          body: {
            playerId,
            action,
          },
        }
      );
      assert(
        response?.ok === true,
        `${label} did not return ok=true (reason=${String(response?.reason ?? "unknown")})`
      );
      return response;
    };

    await setParticipantState(timeoutHostPlayerId, hostAccessToken, "sit", "timeout strike 2p host sit");
    await setParticipantState(timeoutGuestPlayerId, guestAccessToken, "sit", "timeout strike 2p guest sit");
    await setParticipantState(timeoutHostPlayerId, hostAccessToken, "ready", "timeout strike 2p host ready");
    await setParticipantState(timeoutGuestPlayerId, guestAccessToken, "ready", "timeout strike 2p guest ready");

    const initialRefresh = await refreshSessionAuthWithRecovery({
      sessionId: timeoutSessionId,
      playerId: timeoutHostPlayerId,
      displayName: timeoutHostDisplayName,
      accessToken: hostAccessToken,
    });
    hostAccessToken = initialRefresh.accessToken;
    const initialTurnState = initialRefresh.snapshot?.turnState ?? null;
    const initialActivePlayerId =
      typeof initialTurnState?.activeTurnPlayerId === "string" ? initialTurnState.activeTurnPlayerId : "";
    assert(
      initialActivePlayerId === timeoutHostPlayerId,
      `timeout strike 2p expected host to receive first active turn (active=${initialActivePlayerId || "none"})`
    );

    const initialRound = normalizeE2ERoundNumber(initialTurnState?.round);
    const timeoutMs = normalizeE2ETurnTimeoutMs(initialTurnState?.turnTimeoutMs);
    const firstTimeoutWaitMs = computeTurnAutoAdvanceWaitMs(initialTurnState, timeoutMs);

    if (timeoutHostMessageBuffer) {
      timeoutHostMessageBuffer.length = 0;
    }
    const firstTimeout = await waitForTurnAutoAdvanceForPlayer({
      sessionId: timeoutSessionId,
      playerId: timeoutHostPlayerId,
      expectedRound: initialRound,
      hostPlayerId: timeoutHostPlayerId,
      hostDisplayName: timeoutHostDisplayName,
      accessToken: hostAccessToken,
      messageBuffer: timeoutHostMessageBuffer,
      waitTimeoutMs: firstTimeoutWaitMs,
    });
    hostAccessToken = firstTimeout.accessToken;
    const firstSnapshot = firstTimeout.snapshot;
    const firstTurnState = firstSnapshot?.turnState ?? null;
    const activeAfterFirstTimeout =
      typeof firstTurnState?.activeTurnPlayerId === "string" ? firstTurnState.activeTurnPlayerId : "";
    assert(
      activeAfterFirstTimeout === timeoutGuestPlayerId,
      `timeout strike 2p expected guest active turn after first timeout (active=${activeAfterFirstTimeout || "none"})`
    );

    if (timeoutHostMessageBuffer) {
      timeoutHostMessageBuffer.length = 0;
    }
    const guestTimeoutWaitMs = computeTurnAutoAdvanceWaitMs(
      firstTurnState,
      normalizeE2ETurnTimeoutMs(firstTurnState?.turnTimeoutMs, timeoutMs)
    );
    const guestTimeout = await waitForTurnAutoAdvanceForPlayer({
      sessionId: timeoutSessionId,
      playerId: timeoutGuestPlayerId,
      expectedRound: null,
      hostPlayerId: timeoutHostPlayerId,
      hostDisplayName: timeoutHostDisplayName,
      accessToken: hostAccessToken,
      messageBuffer: timeoutHostMessageBuffer,
      waitTimeoutMs: guestTimeoutWaitMs,
    });
    hostAccessToken = guestTimeout.accessToken;
    const recoveredSnapshot = guestTimeout.snapshot;
    const recoveredTurnState = recoveredSnapshot?.turnState ?? null;
    const recoveredActivePlayerId =
      typeof recoveredTurnState?.activeTurnPlayerId === "string"
        ? recoveredTurnState.activeTurnPlayerId
        : "";
    assert(
      recoveredActivePlayerId === timeoutHostPlayerId,
      `timeout strike 2p expected host active turn after guest timeout (active=${recoveredActivePlayerId || "none"})`
    );
    const recoveredRound = normalizeE2ERoundNumber(recoveredTurnState?.round, initialRound);
    assert(
      recoveredRound > initialRound,
      `timeout strike 2p expected round wrap before second host timeout (initial=${initialRound}, recovered=${recoveredRound})`
    );
    if (typeof guestTimeout.reason === "string" && guestTimeout.reason.length > 0) {
      assert(
        guestTimeout.reason.includes("turn_timeout"),
        `timeout strike 2p expected timeout reason while advancing guest turn (actual=${guestTimeout.reason})`
      );
    }

    if (timeoutHostMessageBuffer) {
      timeoutHostMessageBuffer.length = 0;
    }
    const refreshedHost = await refreshSessionAuthWithRecovery({
      sessionId: timeoutSessionId,
      playerId: timeoutHostPlayerId,
      displayName: timeoutHostDisplayName,
      accessToken: hostAccessToken,
      maxAttempts: 8,
      initialDelayMs: 250,
    });
    hostAccessToken = refreshedHost.accessToken;
    const confirmedHostTurnState = refreshedHost.snapshot?.turnState ?? null;
    const confirmedHostActivePlayerId =
      typeof confirmedHostTurnState?.activeTurnPlayerId === "string"
        ? confirmedHostTurnState.activeTurnPlayerId
        : "";
    assert(
      confirmedHostActivePlayerId === timeoutHostPlayerId,
      `timeout strike 2p expected host to remain active before second timeout (active=${confirmedHostActivePlayerId || "none"})`
    );

    const secondTimeoutWaitMs = computeTurnAutoAdvanceWaitMs(
      confirmedHostTurnState,
      normalizeE2ETurnTimeoutMs(confirmedHostTurnState?.turnTimeoutMs, timeoutMs)
    );
    const secondTimeout = await waitForTurnAutoAdvanceForPlayer({
      sessionId: timeoutSessionId,
      playerId: timeoutHostPlayerId,
      expectedRound: recoveredRound,
      hostPlayerId: timeoutHostPlayerId,
      hostDisplayName: timeoutHostDisplayName,
      accessToken: hostAccessToken,
      messageBuffer: timeoutHostMessageBuffer,
      waitTimeoutMs: secondTimeoutWaitMs,
    });
    hostAccessToken = secondTimeout.accessToken;
    const hostAfterSecondTimeout = findSnapshotParticipant(secondTimeout.snapshot, timeoutHostPlayerId);
    assert(hostAfterSecondTimeout, "timeout strike 2p snapshot missing host after second timeout");
    assert(
      hostAfterSecondTimeout?.isSeated === false,
      "timeout strike 2p expected host moved to observer lounge (isSeated=false) after second timeout"
    );
    assert(
      hostAfterSecondTimeout?.isReady !== true,
      "timeout strike 2p expected host unready after observer/lounge move"
    );
    assert(
      hostAfterSecondTimeout?.queuedForNextGame !== true,
      "timeout strike 2p expected host queuedForNextGame=false after observer/lounge move"
    );
    assert(
      hostAfterSecondTimeout?.isComplete === true,
      "timeout strike 2p expected host marked complete after observer/lounge move"
    );
    if (typeof secondTimeout.reason === "string" && secondTimeout.reason.length > 0) {
      assert(
        secondTimeout.reason.includes("turn_timeout_stand") ||
          secondTimeout.reason.includes("turn_timeout_auto_score_stand"),
        `timeout strike 2p expected stand timeout reason on second timeout (actual=${secondTimeout.reason})`
      );
    }

    log("Timeout strike observer two-player wrap checks passed.");
  } finally {
    await safeCloseSocket(timeoutHostSocket);
    await safeLeave(timeoutSessionId, timeoutGuestPlayerId);
    await safeLeave(timeoutSessionId, timeoutHostPlayerId);
  }
}

async function runEightPlayerBotTimeoutChecks(runSuffix) {
  log("Running eight-player bot timeout checks...");

  const timeoutHostPlayerId = `e2e-timeout-8p-host-${runSuffix}`;
  const timeoutGuestAPlayerId = `e2e-timeout-8p-guest-a-${runSuffix}`;
  const timeoutGuestBPlayerId = `e2e-timeout-8p-guest-b-${runSuffix}`;
  const timeoutGuestCPlayerId = `e2e-timeout-8p-guest-c-${runSuffix}`;
  const timeoutHostDisplayName = "E2E Timeout 8P Host";
  const timeoutGuestADisplayName = "E2E Timeout 8P Guest A";
  const timeoutGuestBDisplayName = "E2E Timeout 8P Guest B";
  const timeoutGuestCDisplayName = "E2E Timeout 8P Guest C";

  const created = await apiRequest("/multiplayer/sessions", {
    method: "POST",
    body: {
      playerId: timeoutHostPlayerId,
      displayName: timeoutHostDisplayName,
      botCount: 0,
      gameDifficulty: "hard",
    },
  });
  assert(
    typeof created?.sessionId === "string",
    "eight-player timeout create session returned no sessionId"
  );
  assert(created?.auth?.accessToken, "eight-player timeout create session returned no host access token");

  const timeoutSessionId = created.sessionId;
  let hostAccessToken = created.auth.accessToken;
  let guestAAccessToken = "";
  let guestBAccessToken = "";
  let guestCAccessToken = "";
  let timeoutHostSocket = null;
  let timeoutHostMessageBuffer = null;

  try {
    try {
      timeoutHostSocket = await openSocket(
        "timeout-strike-8p-host",
        buildSocketUrl(timeoutSessionId, timeoutHostPlayerId, hostAccessToken)
      );
      timeoutHostMessageBuffer = createSocketMessageBuffer(timeoutHostSocket);
    } catch (error) {
      log(
        `Eight-player timeout host socket unavailable; falling back to HTTP-only polling (${String(error)}).`
      );
    }

    const setParticipantState = async (playerId, accessToken, action, label) => {
      const response = await apiRequest(
        `/multiplayer/sessions/${encodeURIComponent(timeoutSessionId)}/participant-state`,
        {
          method: "POST",
          accessToken,
          body: {
            playerId,
            action,
          },
        }
      );
      assert(
        response?.ok === true,
        `${label} did not return ok=true (reason=${String(response?.reason ?? "unknown")})`
      );
      return response;
    };

    await setParticipantState(timeoutHostPlayerId, hostAccessToken, "sit", "eight-player host sit");
    await setParticipantState(timeoutHostPlayerId, hostAccessToken, "ready", "eight-player host ready");

    const joinGuestAAttempt = await joinSessionByIdWithTransientRetry(
      timeoutSessionId,
      {
        playerId: timeoutGuestAPlayerId,
        displayName: timeoutGuestADisplayName,
      },
      {
        maxAttempts: 8,
        initialDelayMs: 220,
      }
    );
    if (!joinGuestAAttempt?.ok) {
      throw new Error(
        `request failed (POST /multiplayer/sessions/${timeoutSessionId}/join) status=${joinGuestAAttempt?.status ?? "unknown"} body=${JSON.stringify(joinGuestAAttempt?.body ?? null)}`
      );
    }
    guestAAccessToken =
      typeof joinGuestAAttempt.body?.auth?.accessToken === "string"
        ? joinGuestAAttempt.body.auth.accessToken
        : "";
    assert(guestAAccessToken, "eight-player timeout guest A join returned no access token");

    const joinGuestBAttempt = await joinSessionByIdWithTransientRetry(
      timeoutSessionId,
      {
        playerId: timeoutGuestBPlayerId,
        displayName: timeoutGuestBDisplayName,
      },
      {
        maxAttempts: 8,
        initialDelayMs: 220,
      }
    );
    if (!joinGuestBAttempt?.ok) {
      throw new Error(
        `request failed (POST /multiplayer/sessions/${timeoutSessionId}/join) status=${joinGuestBAttempt?.status ?? "unknown"} body=${JSON.stringify(joinGuestBAttempt?.body ?? null)}`
      );
    }
    guestBAccessToken =
      typeof joinGuestBAttempt.body?.auth?.accessToken === "string"
        ? joinGuestBAttempt.body.auth.accessToken
        : "";
    assert(guestBAccessToken, "eight-player timeout guest B join returned no access token");

    const joinGuestCAttempt = await joinSessionByIdWithTransientRetry(
      timeoutSessionId,
      {
        playerId: timeoutGuestCPlayerId,
        displayName: timeoutGuestCDisplayName,
      },
      {
        maxAttempts: 8,
        initialDelayMs: 220,
      }
    );
    if (!joinGuestCAttempt?.ok) {
      throw new Error(
        `request failed (POST /multiplayer/sessions/${timeoutSessionId}/join) status=${joinGuestCAttempt?.status ?? "unknown"} body=${JSON.stringify(joinGuestCAttempt?.body ?? null)}`
      );
    }
    guestCAccessToken =
      typeof joinGuestCAttempt.body?.auth?.accessToken === "string"
        ? joinGuestCAttempt.body.auth.accessToken
        : "";
    assert(guestCAccessToken, "eight-player timeout guest C join returned no access token");

    await setParticipantState(timeoutGuestAPlayerId, guestAAccessToken, "stand", "eight-player guest A stand");
    await setParticipantState(timeoutGuestBPlayerId, guestBAccessToken, "stand", "eight-player guest B stand");
    await setParticipantState(timeoutGuestCPlayerId, guestCAccessToken, "stand", "eight-player guest C stand");

    const withBotsAttempt = await joinSessionByIdWithTransientRetry(
      timeoutSessionId,
      {
        playerId: timeoutHostPlayerId,
        displayName: timeoutHostDisplayName,
        botCount: 4,
      },
      {
        maxAttempts: 8,
        initialDelayMs: 220,
      }
    );
    if (!withBotsAttempt?.ok) {
      throw new Error(
        `request failed (POST /multiplayer/sessions/${timeoutSessionId}/join with botCount=4) status=${withBotsAttempt?.status ?? "unknown"} body=${JSON.stringify(withBotsAttempt?.body ?? null)}`
      );
    }
    if (
      typeof withBotsAttempt.body?.auth?.accessToken === "string" &&
      withBotsAttempt.body.auth.accessToken.length > 0
    ) {
      hostAccessToken = withBotsAttempt.body.auth.accessToken;
    }

    const initialRefresh = await refreshSessionAuthWithRecovery({
      sessionId: timeoutSessionId,
      playerId: timeoutHostPlayerId,
      displayName: timeoutHostDisplayName,
      accessToken: hostAccessToken,
      maxAttempts: 8,
      initialDelayMs: 250,
    });
    hostAccessToken = initialRefresh.accessToken;
    const initialSnapshot = initialRefresh.snapshot;
    const participants = Array.isArray(initialSnapshot?.participants) ? initialSnapshot.participants : [];
    assert(
      participants.length >= 8,
      `eight-player timeout expected at least 8 participants (actual=${participants.length})`
    );
    const botParticipants = participants.filter((participant) => participant?.isBot === true);
    assert(
      botParticipants.length >= 4,
      `eight-player timeout expected at least 4 bots (actual=${botParticipants.length})`
    );
    const humanParticipants = participants.filter((participant) => participant?.isBot !== true);
    assert(
      humanParticipants.length >= 4,
      `eight-player timeout expected at least 4 human participants (actual=${humanParticipants.length})`
    );
    const activeSeatedHumans = humanParticipants.filter(
      (participant) => participant?.isSeated === true && participant?.queuedForNextGame !== true
    );
    assert(
      activeSeatedHumans.length === 1 && activeSeatedHumans[0]?.playerId === timeoutHostPlayerId,
      "eight-player timeout expected only host to be seated/active among humans"
    );

    const initialTurnState = initialSnapshot?.turnState ?? null;
    const initialActivePlayerId =
      typeof initialTurnState?.activeTurnPlayerId === "string" ? initialTurnState.activeTurnPlayerId : "";
    assert(
      initialActivePlayerId === timeoutHostPlayerId,
      `eight-player timeout expected host to receive first active turn (active=${initialActivePlayerId || "none"})`
    );

    const initialRound = normalizeE2ERoundNumber(initialTurnState?.round);
    const timeoutMs = normalizeE2ETurnTimeoutMs(initialTurnState?.turnTimeoutMs);
    const firstTimeoutWaitMs = computeTurnAutoAdvanceWaitMs(initialTurnState, timeoutMs);

    if (timeoutHostMessageBuffer) {
      timeoutHostMessageBuffer.length = 0;
    }
    const firstTimeout = await waitForTurnAutoAdvanceForPlayer({
      sessionId: timeoutSessionId,
      playerId: timeoutHostPlayerId,
      expectedRound: initialRound,
      hostPlayerId: timeoutHostPlayerId,
      hostDisplayName: timeoutHostDisplayName,
      accessToken: hostAccessToken,
      messageBuffer: timeoutHostMessageBuffer,
      waitTimeoutMs: firstTimeoutWaitMs,
    });
    hostAccessToken = firstTimeout.accessToken;
    if (typeof firstTimeout.reason === "string" && firstTimeout.reason.length > 0) {
      assert(
        firstTimeout.reason.includes("turn_timeout"),
        `eight-player timeout expected timeout reason for first host timeout (actual=${firstTimeout.reason})`
      );
    }

    const firstTurnState = firstTimeout.snapshot?.turnState ?? null;
    const activeAfterFirstTimeout =
      typeof firstTurnState?.activeTurnPlayerId === "string" ? firstTurnState.activeTurnPlayerId : "";
    assert(
      activeAfterFirstTimeout.startsWith("bot-"),
      `eight-player timeout expected bot active turn after first host timeout (active=${activeAfterFirstTimeout || "none"})`
    );

    const hostTurnRecovered = await waitForActiveTurnPlayer({
      sessionId: timeoutSessionId,
      targetPlayerId: timeoutHostPlayerId,
      expectedRound: null,
      hostPlayerId: timeoutHostPlayerId,
      hostDisplayName: timeoutHostDisplayName,
      accessToken: hostAccessToken,
      waitTimeoutMs: Math.max(25000, timeoutMs + 18000),
    });
    hostAccessToken = hostTurnRecovered.accessToken;
    const recoveredTurnState = hostTurnRecovered.snapshot?.turnState ?? null;
    const recoveredRound = normalizeE2ERoundNumber(recoveredTurnState?.round, initialRound);
    assert(
      recoveredRound > initialRound,
      `eight-player timeout expected host turn recovery after bot cycle to increase round (initial=${initialRound}, recovered=${recoveredRound})`
    );
    if (timeoutHostMessageBuffer) {
      const observedBotAutoEvent = timeoutHostMessageBuffer.some((payload) => {
        if (!payload || typeof payload !== "object" || payload.sessionId !== timeoutSessionId) {
          return false;
        }
        if (payload.type === "turn_action" && payload.source === "bot_auto") {
          return true;
        }
        if (
          payload.type === "turn_end" &&
          payload.source === "bot_auto" &&
          typeof payload.playerId === "string" &&
          payload.playerId.startsWith("bot-")
        ) {
          return true;
        }
        return false;
      });
      assert(
        observedBotAutoEvent,
        "eight-player timeout expected at least one bot_auto turn action/end event before second host timeout"
      );
      timeoutHostMessageBuffer.length = 0;
    }

    const secondTimeoutWaitMs = computeTurnAutoAdvanceWaitMs(
      recoveredTurnState,
      normalizeE2ETurnTimeoutMs(recoveredTurnState?.turnTimeoutMs, timeoutMs)
    );
    const secondTimeout = await waitForTurnAutoAdvanceForPlayer({
      sessionId: timeoutSessionId,
      playerId: timeoutHostPlayerId,
      expectedRound: recoveredRound,
      hostPlayerId: timeoutHostPlayerId,
      hostDisplayName: timeoutHostDisplayName,
      accessToken: hostAccessToken,
      messageBuffer: timeoutHostMessageBuffer,
      waitTimeoutMs: secondTimeoutWaitMs,
    });
    const hostAfterSecondTimeout = findSnapshotParticipant(secondTimeout.snapshot, timeoutHostPlayerId);
    assert(hostAfterSecondTimeout, "eight-player timeout snapshot missing host after second timeout");
    assert(
      hostAfterSecondTimeout?.isSeated === false,
      "eight-player timeout expected host moved to observer lounge (isSeated=false) after second timeout"
    );
    assert(
      hostAfterSecondTimeout?.isReady !== true,
      "eight-player timeout expected host unready after observer/lounge move"
    );
    assert(
      hostAfterSecondTimeout?.queuedForNextGame !== true,
      "eight-player timeout expected host queuedForNextGame=false after observer/lounge move"
    );
    assert(
      hostAfterSecondTimeout?.isComplete === true,
      "eight-player timeout expected host marked complete after observer/lounge move"
    );
    if (typeof secondTimeout.reason === "string" && secondTimeout.reason.length > 0) {
      assert(
        secondTimeout.reason.includes("turn_timeout_stand") ||
          secondTimeout.reason.includes("turn_timeout_auto_score_stand"),
        `eight-player timeout expected stand timeout reason on second timeout (actual=${secondTimeout.reason})`
      );
    }

    log("Eight-player bot timeout checks passed.");
  } finally {
    await safeCloseSocket(timeoutHostSocket);
    await safeLeave(timeoutSessionId, timeoutGuestAPlayerId);
    await safeLeave(timeoutSessionId, timeoutGuestBPlayerId);
    await safeLeave(timeoutSessionId, timeoutGuestCPlayerId);
    await safeLeave(timeoutSessionId, timeoutHostPlayerId);
  }
}

async function runAdminMonitorChecks(cachedStorage = null) {
  log("Running admin monitor checks...");
  const adminAuthOptions = buildAdminAuthRequestOptions();

  const overview = await apiRequest("/admin/overview?limit=5", {
    method: "GET",
    ...adminAuthOptions,
  });
  assert(typeof overview?.timestamp === "number", "admin overview missing timestamp");
  assert(overview?.metrics && typeof overview.metrics === "object", "admin overview missing metrics");
  assert(Array.isArray(overview?.rooms), "admin overview missing rooms[]");

  const rooms = await apiRequest("/admin/rooms?limit=5", {
    method: "GET",
    ...adminAuthOptions,
  });
  assert(typeof rooms?.timestamp === "number", "admin rooms missing timestamp");
  assert(Array.isArray(rooms?.rooms), "admin rooms missing rooms[]");

  const metrics = await apiRequest("/admin/metrics", {
    method: "GET",
    ...adminAuthOptions,
  });
  assert(typeof metrics?.timestamp === "number", "admin metrics missing timestamp");
  assert(metrics?.metrics && typeof metrics.metrics === "object", "admin metrics missing metrics object");
  assert(
    Number.isFinite(Number(metrics.metrics.activeSessionCount)),
    "admin metrics missing activeSessionCount"
  );

  if (cachedStorage) {
    assertAdminStorageResponse(cachedStorage);
  } else {
    await runStorageCutoverChecks();
  }

  const auditBefore = await apiRequest("/admin/audit?limit=5", {
    method: "GET",
    ...adminAuthOptions,
  });
  assert(typeof auditBefore?.timestamp === "number", "admin audit missing timestamp");
  assert(Array.isArray(auditBefore?.entries), "admin audit missing entries[]");

  const rolesBefore = await apiRequest("/admin/roles?limit=10", {
    method: "GET",
    ...adminAuthOptions,
  });
  assert(Array.isArray(rolesBefore?.roles), "admin roles missing roles[]");

  const roleProbeUid = `e2e-role-${randomUUID().slice(0, 8)}`;
  const roleUpsert = await apiRequest(`/admin/roles/${encodeURIComponent(roleProbeUid)}`, {
    method: "PUT",
    ...adminAuthOptions,
    body: {
      role: "viewer",
    },
  });
  assert(roleUpsert?.ok === true, "admin role upsert did not report success");
  assert(
    roleUpsert?.roleRecord?.uid === roleProbeUid,
    "admin role upsert returned unexpected uid"
  );
  assert(
    roleUpsert?.roleRecord?.role === "viewer",
    "admin role upsert returned unexpected role"
  );

  const adminHostId = `e2e-admin-host-${randomUUID().slice(0, 8)}`;
  const adminGuestId = `e2e-admin-guest-${randomUUID().slice(0, 8)}`;
  const adminSession = await apiRequest("/multiplayer/sessions", {
    method: "POST",
    body: {
      playerId: adminHostId,
      displayName: "Admin Host",
    },
  });
  assert(typeof adminSession?.sessionId === "string", "admin mutation probe session missing id");

  const adminJoin = await apiRequest(
    `/multiplayer/sessions/${encodeURIComponent(adminSession.sessionId)}/join`,
    {
      method: "POST",
      body: {
        playerId: adminGuestId,
        displayName: "Admin Guest",
      },
    }
  );
  assert(Array.isArray(adminJoin?.participants), "admin mutation probe join missing participants[]");

  const removePlayerResult = await apiRequest(
    `/admin/sessions/${encodeURIComponent(adminSession.sessionId)}/participants/${encodeURIComponent(adminGuestId)}/remove`,
    {
      method: "POST",
      ...adminAuthOptions,
    }
  );
  assert(removePlayerResult?.ok === true, "admin participant remove did not report success");
  assert(
    removePlayerResult?.playerId === adminGuestId,
    "admin participant remove returned unexpected player"
  );

  const expireRoomResult = await apiRequest(
    `/admin/sessions/${encodeURIComponent(adminSession.sessionId)}/expire`,
    {
      method: "POST",
      ...adminAuthOptions,
    }
  );
  assert(expireRoomResult?.ok === true, "admin room expire did not report success");
  assert(
    expireRoomResult?.sessionId === adminSession.sessionId,
    "admin room expire returned unexpected session"
  );

  const auditAfter = await apiRequest("/admin/audit?limit=40", {
    method: "GET",
    ...adminAuthOptions,
  });
  assert(Array.isArray(auditAfter?.entries), "admin audit entries missing after mutations");
  const roleAudit = auditAfter.entries.find(
    (entry) => entry?.action === "role_upsert" && entry?.target?.uid === roleProbeUid
  );
  assert(roleAudit, "admin audit missing role_upsert event");
  const removeAudit = auditAfter.entries.find(
    (entry) =>
      entry?.action === "participant_remove" &&
      entry?.target?.sessionId === adminSession.sessionId &&
      entry?.target?.playerId === adminGuestId
  );
  assert(removeAudit, "admin audit missing participant_remove event");
  const expireAudit = auditAfter.entries.find(
    (entry) => entry?.action === "session_expire" && entry?.target?.sessionId === adminSession.sessionId
  );
  assert(expireAudit, "admin audit missing session_expire event");
  log("Admin monitor checks passed.");
}

async function runAdminModerationTermChecks() {
  log("Running admin moderation-term checks...");
  assert(
    adminToken || firebaseIdToken,
    "admin moderation-term checks require E2E_ADMIN_TOKEN or E2E_FIREBASE_ID_TOKEN"
  );
  const adminAuthOptions = buildAdminAuthRequestOptions();
  const runSuffix = randomUUID().slice(0, 10).toLowerCase();
  const probeTerm = `e2e-admin-${runSuffix}`;

  const before = await apiRequest("/admin/moderation/terms?includeTerms=1&limit=500", {
    method: "GET",
    ...adminAuthOptions,
  });
  assert(
    before?.policy && typeof before.policy === "object",
    "admin moderation-term overview missing policy object"
  );
  assert(
    before?.terms && typeof before.terms === "object",
    "admin moderation-term overview missing terms object"
  );
  assert(
    Array.isArray(before?.terms?.managedTerms),
    "admin moderation-term overview missing managedTerms[]"
  );

  const upsert = await apiRequest("/admin/moderation/terms/upsert", {
    method: "POST",
    ...adminAuthOptions,
    body: {
      term: probeTerm,
      enabled: true,
      note: "e2e moderation term probe",
    },
  });
  assert(upsert?.ok === true, "admin moderation-term upsert did not report success");
  assertEqual(
    upsert?.term,
    probeTerm,
    "admin moderation-term upsert returned unexpected term"
  );
  assert(
    upsert?.record?.enabled === true,
    "admin moderation-term upsert returned non-enabled record"
  );

  const afterUpsert = await apiRequest("/admin/moderation/terms?includeTerms=1&limit=500", {
    method: "GET",
    ...adminAuthOptions,
  });
  const managedAfterUpsert = Array.isArray(afterUpsert?.terms?.managedTerms)
    ? afterUpsert.terms.managedTerms.find((entry) => entry?.term === probeTerm)
    : null;
  assert(managedAfterUpsert, "admin moderation-term upsert not visible in managedTerms[]");
  const activeAfterUpsert = Array.isArray(afterUpsert?.terms?.activeTerms)
    ? afterUpsert.terms.activeTerms.includes(probeTerm)
    : false;
  assert(activeAfterUpsert, "admin moderation-term upsert not visible in activeTerms[]");

  const remove = await apiRequest("/admin/moderation/terms/remove", {
    method: "POST",
    ...adminAuthOptions,
    body: {
      term: probeTerm,
    },
  });
  assert(remove?.ok === true, "admin moderation-term remove did not report success");
  assertEqual(
    remove?.term,
    probeTerm,
    "admin moderation-term remove returned unexpected term"
  );

  const afterRemove = await apiRequest("/admin/moderation/terms?includeTerms=1&limit=500", {
    method: "GET",
    ...adminAuthOptions,
  });
  const managedAfterRemove = Array.isArray(afterRemove?.terms?.managedTerms)
    ? afterRemove.terms.managedTerms.find((entry) => entry?.term === probeTerm)
    : null;
  assert(!managedAfterRemove, "admin moderation-term remove still present in managedTerms[]");
  const activeAfterRemove = Array.isArray(afterRemove?.terms?.activeTerms)
    ? afterRemove.terms.activeTerms.includes(probeTerm)
    : false;
  assert(!activeAfterRemove, "admin moderation-term remove still present in activeTerms[]");

  const refreshResult = await apiRequestWithStatus("/admin/moderation/terms/refresh", {
    method: "POST",
    ...adminAuthOptions,
  });
  if (refreshResult.status === 200) {
    assert(refreshResult.body?.ok === true, "admin moderation-term refresh returned 200 without ok=true");
  } else {
    assertEqual(
      refreshResult.status,
      409,
      "admin moderation-term refresh returned unexpected status when remote feed is unavailable"
    );
    assertEqual(
      refreshResult.body?.reason,
      "remote_not_configured",
      "admin moderation-term refresh returned unexpected reason"
    );
  }

  log("Admin moderation-term checks passed.");
}

async function runStorageCutoverChecks() {
  log("Running storage cutover checks...");
  const storage = await apiRequest("/admin/storage", {
    method: "GET",
    ...buildAdminAuthRequestOptions(),
  });
  assertAdminStorageResponse(storage);
  log("Storage cutover checks passed.");
  return storage;
}

function assertAdminStorageResponse(storage) {
  assert(typeof storage?.timestamp === "number", "admin storage missing timestamp");
  assert(storage?.storage && typeof storage.storage === "object", "admin storage missing storage object");
  assert(
    typeof storage.storage.backend === "string" && storage.storage.backend.length > 0,
    "admin storage missing backend"
  );
  assert(Array.isArray(storage?.sections), "admin storage missing sections[]");

  const actualStorageBackend = normalizeOptionalString(storage?.storage?.backend).toLowerCase();
  if (expectedStorageBackend) {
    assertEqual(
      actualStorageBackend,
      expectedStorageBackend,
      "admin storage backend mismatch"
    );
  }
  if (expectedFirestorePrefix) {
    const actualFirestorePrefix = normalizeOptionalString(storage?.storage?.firestorePrefix);
    assert(actualFirestorePrefix.length > 0, "admin storage missing firestorePrefix");
    assertEqual(
      actualFirestorePrefix,
      expectedFirestorePrefix,
      "admin storage firestorePrefix mismatch"
    );
  }

  const sectionCounts = mapStorageSectionCounts(storage?.sections);
  for (const sectionName of expectedStoreSections) {
    assert(
      Object.prototype.hasOwnProperty.call(sectionCounts, sectionName),
      `admin storage missing section "${sectionName}"`
    );
    assert(
      Number.isFinite(sectionCounts[sectionName]) && sectionCounts[sectionName] >= 0,
      `admin storage section "${sectionName}" returned invalid count`
    );
  }

  for (const [sectionName, minCount] of Object.entries(expectedStorageSectionMinCounts)) {
    assert(
      Object.prototype.hasOwnProperty.call(sectionCounts, sectionName),
      `admin storage missing expected section "${sectionName}"`
    );
    assert(
      sectionCounts[sectionName] >= minCount,
      `admin storage section "${sectionName}" count below expected minimum (expected >= ${minCount}, actual: ${sectionCounts[sectionName]})`
    );
  }
}

function buildAdminAuthRequestOptions() {
  if (adminToken) {
    return {
      headers: {
        "x-admin-token": adminToken,
      },
    };
  }
  if (firebaseIdToken) {
    return {
      accessToken: firebaseIdToken,
    };
  }
  return {};
}

function mapStorageSectionCounts(sections) {
  const counts = {};
  for (const entry of Array.isArray(sections) ? sections : []) {
    const sectionName = normalizeOptionalString(entry?.section);
    if (!sectionName) {
      continue;
    }
    counts[sectionName] = Number(entry?.count);
  }
  return counts;
}

function parseStorageSectionMinCountSpec(rawValue) {
  const source = normalizeOptionalString(rawValue);
  if (!source) {
    return {};
  }

  const result = {};
  for (const token of source.split(",")) {
    const entry = token.trim();
    if (!entry) {
      continue;
    }
    const separator = entry.includes(":") ? ":" : entry.includes("=") ? "=" : "";
    if (!separator) {
      throw new Error(
        `Invalid E2E_EXPECT_STORAGE_SECTION_MIN_COUNTS entry "${entry}" (expected section:minCount)`
      );
    }
    const [sectionNameRaw, minCountRaw] = entry.split(separator);
    const sectionName = normalizeOptionalString(sectionNameRaw);
    const minCount = Number(normalizeOptionalString(minCountRaw));
    if (!sectionName || !Number.isFinite(minCount) || minCount < 0) {
      throw new Error(
        `Invalid E2E_EXPECT_STORAGE_SECTION_MIN_COUNTS entry "${entry}" (expected section:minCount with non-negative minCount)`
      );
    }
    result[sectionName] = minCount;
  }

  return result;
}

function normalizeOptionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

run()
  .catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  })
  .finally(async () => {
    await safeCloseSocket(hostSocket);
    await safeCloseSocket(guestSocket);
    await safeLeave(activeSessionId, hostPlayerId);
    await safeLeave(activeSessionId, guestPlayerId);
  });

function resolveTargets(rawApiBase, rawWsBase) {
  const parsed = parseAbsoluteUrl("E2E_API_BASE_URL", rawApiBase);

  const apiUrl = new URL(parsed.toString());
  const normalizedPath = apiUrl.pathname.replace(/\/+$/, "");
  apiUrl.pathname = normalizedPath.endsWith("/api")
    ? normalizedPath || "/api"
    : `${normalizedPath || ""}/api`;
  apiUrl.search = "";
  apiUrl.hash = "";

  const wsUrl = rawWsBase
    ? parseAbsoluteUrl("E2E_WS_URL", rawWsBase)
    : new URL(apiUrl.toString());
  if (!rawWsBase) {
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.pathname = wsUrl.pathname.replace(/\/api$/, "/");
  }
  wsUrl.search = "";
  wsUrl.hash = "";

  return {
    apiBaseUrl: stripTrailingSlash(apiUrl.toString()),
    wsBaseUrl: stripTrailingSlash(wsUrl.toString()),
  };
}

function parseAbsoluteUrl(envName, rawValue) {
  const normalized = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!normalized) {
    throw new Error(`${envName} is required and must be an absolute URL`);
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(
      `${envName} must be an absolute URL (received: "${normalized}")`
    );
  }

  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:" &&
    parsed.protocol !== "ws:" &&
    parsed.protocol !== "wss:"
  ) {
    throw new Error(
      `${envName} must use http(s) or ws(s) scheme (received: "${normalized}")`
    );
  }

  return parsed;
}

async function apiRequest(path, options) {
  const result = await apiRequestWithStatus(path, options);
  if (!result.ok) {
    throw new Error(
      `request failed (${options.method} ${path}) status=${result.status} body=${JSON.stringify(result.body)}`
    );
  }
  return result.body;
}

async function apiRequestWithStatus(path, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = {
    "content-type": "application/json",
  };
  if (options.accessToken) {
    headers.authorization = `Bearer ${options.accessToken}`;
  }
  if (options.headers && typeof options.headers === "object") {
    Object.assign(headers, options.headers);
  }

  const url = `${targets.apiBaseUrl}${path}`;
  let response;

  try {
    response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    throw new Error(`request failed (${options.method} ${path}): ${String(error)}`);
  }
  clearTimeout(timeout);

  const rawBody = await response.text();
  let parsedBody = null;
  if (rawBody) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    body: parsedBody,
  };
}

function buildSocketUrl(sessionId, playerId, token) {
  const url = new URL(targets.wsBaseUrl);
  url.searchParams.set("session", sessionId);
  url.searchParams.set("playerId", playerId);
  url.searchParams.set("token", token);
  return url.toString();
}

function openSocket(label, url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      reject(new Error(`${label} socket open timed out after ${WS_TIMEOUT_MS}ms`));
      safeCloseSocket(socket);
    }, WS_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      log(`${label} socket connected`);
      resolve(socket);
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`${label} socket failed to connect`));
    });

    socket.addEventListener("close", (event) => {
      if (event.code !== 1000) {
        log(`${label} socket closed code=${event.code} reason=${event.reason || "(none)"}`);
      }
    });
  });
}

function waitForMessage(socket, matcher, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} timed out after ${WS_TIMEOUT_MS}ms`));
    }, WS_TIMEOUT_MS);

    const onMessage = (event) => {
      const raw = toText(event.data);
      if (!raw) return;

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        cleanup();
        reject(new Error(`${label} received invalid JSON: ${String(error)}`));
        return;
      }

      if (!matcher(payload)) {
        return;
      }

      cleanup();
      resolve(payload);
    };

    const onClose = (event) => {
      cleanup();
      reject(
        new Error(
          `${label} socket closed before expected message (code=${event.code}, reason=${event.reason || "n/a"})`
        )
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
  });
}

function createSocketMessageBuffer(socket) {
  const messages = [];
  socket.addEventListener("message", (event) => {
    const raw = toText(event.data);
    if (!raw) return;
    try {
      messages.push(JSON.parse(raw));
    } catch {
      // Ignore malformed test payloads.
    }
  });
  return messages;
}

async function waitForBufferedMessage(buffer, matcher, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < WS_TIMEOUT_MS) {
    const index = buffer.findIndex((payload) => matcher(payload));
    if (index >= 0) {
      const [match] = buffer.splice(index, 1);
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`${label} timed out after ${WS_TIMEOUT_MS}ms`);
}

function consumeQueueLifecycleRestartFromBuffer(buffer, sessionId, hostPlayerId) {
  if (!Array.isArray(buffer) || !sessionId || !hostPlayerId) {
    return null;
  }
  const index = buffer.findIndex((payload) => {
    if (!payload || typeof payload !== "object" || payload.type !== "session_state") {
      return false;
    }
    if (payload.sessionId !== sessionId) {
      return false;
    }
    const refreshedHost = Array.isArray(payload?.participants)
      ? payload.participants.find((participant) => participant?.playerId === hostPlayerId)
      : null;
    const hostReadyForFreshRound =
      refreshedHost &&
      refreshedHost.queuedForNextGame !== true &&
      refreshedHost.isComplete !== true &&
      Number(refreshedHost.score ?? 0) === 0 &&
      Number(refreshedHost.remainingDice ?? -1) === 15;
    return hostReadyForFreshRound && payload?.sessionComplete !== true;
  });
  if (index < 0) {
    return null;
  }
  const [match] = buffer.splice(index, 1);
  return match;
}

function consumeTurnAutoAdvanceFromBuffer(buffer, sessionId, playerId, expectedRound = null) {
  if (!Array.isArray(buffer) || !sessionId || !playerId) {
    return null;
  }
  const normalizedExpectedRound =
    Number.isFinite(expectedRound) && expectedRound > 0 ? Math.floor(expectedRound) : null;
  const index = buffer.findIndex((payload) => {
    if (!payload || typeof payload !== "object" || payload.type !== "turn_auto_advanced") {
      return false;
    }
    if (payload.sessionId !== sessionId || payload.playerId !== playerId) {
      return false;
    }
    if (normalizedExpectedRound === null) {
      return true;
    }
    const payloadRound =
      Number.isFinite(payload.round) && payload.round > 0 ? Math.floor(payload.round) : null;
    return payloadRound === null || payloadRound === normalizedExpectedRound;
  });
  if (index < 0) {
    return null;
  }
  const [match] = buffer.splice(index, 1);
  return match;
}

function normalizeE2ERoundNumber(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.max(1, Math.floor(fallback));
  }
  return Math.max(1, Math.floor(parsed));
}

function normalizeE2ETurnTimeoutMs(value, fallback = 15000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.max(5000, Math.floor(fallback));
  }
  return Math.max(5000, Math.floor(parsed));
}

function computeTurnAutoAdvanceWaitMs(turnState, fallbackTimeoutMs) {
  const timeoutMs = normalizeE2ETurnTimeoutMs(turnState?.turnTimeoutMs, fallbackTimeoutMs);
  const now = Date.now();
  const turnExpiresAt =
    Number.isFinite(turnState?.turnExpiresAt) && turnState.turnExpiresAt > 0
      ? Math.floor(turnState.turnExpiresAt)
      : 0;
  const remainingMs = turnExpiresAt > now ? turnExpiresAt - now : timeoutMs;
  return Math.max(2000, remainingMs + Math.max(2000, timeoutStrikeWaitBufferMs));
}

function findSnapshotParticipant(snapshot, playerId) {
  if (!snapshot || !playerId || !Array.isArray(snapshot.participants)) {
    return null;
  }
  return snapshot.participants.find((participant) => participant?.playerId === playerId) ?? null;
}

async function refreshSessionAuthWithRecovery({
  sessionId,
  playerId,
  displayName,
  accessToken,
  maxAttempts = 6,
  initialDelayMs = 220,
}) {
  let token = typeof accessToken === "string" ? accessToken : "";
  const normalizedDisplayName =
    typeof displayName === "string" && displayName.trim().length > 0
      ? displayName.trim()
      : playerId;
  let lastFailure = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const refreshAttempt = await apiRequestWithStatus(
      `/multiplayer/sessions/${encodeURIComponent(sessionId)}/auth/refresh`,
      {
        method: "POST",
        accessToken: token,
        body: { playerId },
      }
    );
    if (refreshAttempt.ok) {
      const nextToken =
        typeof refreshAttempt.body?.auth?.accessToken === "string" &&
        refreshAttempt.body.auth.accessToken.length > 0
          ? refreshAttempt.body.auth.accessToken
          : token;
      return {
        snapshot: refreshAttempt.body,
        accessToken: nextToken,
      };
    }

    if (!isTransientQueueRefreshFailure(refreshAttempt)) {
      throw new Error(
        `request failed (POST /multiplayer/sessions/${sessionId}/auth/refresh) status=${refreshAttempt.status} body=${JSON.stringify(refreshAttempt.body)}`
      );
    }
    lastFailure = refreshAttempt;

    const rejoinAttempt = await apiRequestWithStatus(
      `/multiplayer/sessions/${encodeURIComponent(sessionId)}/join`,
      {
        method: "POST",
        body: {
          playerId,
          displayName: normalizedDisplayName,
        },
      }
    );
    if (rejoinAttempt.ok) {
      const nextToken =
        typeof rejoinAttempt.body?.auth?.accessToken === "string" &&
        rejoinAttempt.body.auth.accessToken.length > 0
          ? rejoinAttempt.body.auth.accessToken
          : token;
      return {
        snapshot: rejoinAttempt.body,
        accessToken: nextToken,
      };
    }
    if (!isTransientQueueRefreshFailure(rejoinAttempt)) {
      throw new Error(
        `request failed (POST /multiplayer/sessions/${sessionId}/join) status=${rejoinAttempt.status} body=${JSON.stringify(rejoinAttempt.body)}`
      );
    }
    lastFailure = rejoinAttempt;

    if (attempt >= maxAttempts - 1) {
      break;
    }
    await waitMs(Math.max(50, initialDelayMs * (attempt + 1)));
  }

  throw new Error(
    `timeout strike refresh did not recover session auth after ${maxAttempts} attempt(s) (status=${lastFailure?.status ?? "unknown"} body=${JSON.stringify(lastFailure?.body ?? null)})`
  );
}

async function waitForActiveTurnPlayer({
  sessionId,
  targetPlayerId,
  expectedRound,
  hostPlayerId,
  hostDisplayName,
  accessToken,
  waitTimeoutMs,
}) {
  const deadline = Date.now() + Math.max(2000, Math.floor(waitTimeoutMs));
  const expectedRoundNumber =
    Number.isFinite(expectedRound) && expectedRound > 0 ? Math.floor(expectedRound) : null;
  let token = accessToken;
  let lastRound = expectedRoundNumber ?? 1;
  let lastActivePlayerId = "";

  while (Date.now() < deadline) {
    const refreshed = await refreshSessionAuthWithRecovery({
      sessionId,
      playerId: hostPlayerId,
      displayName: hostDisplayName,
      accessToken: token,
    });
    token = refreshed.accessToken;
    const snapshot = refreshed.snapshot;
    const turnState = snapshot?.turnState ?? null;
    const round = normalizeE2ERoundNumber(turnState?.round, expectedRoundNumber ?? 1);
    const activePlayerId =
      typeof turnState?.activeTurnPlayerId === "string" ? turnState.activeTurnPlayerId : "";
    lastRound = round;
    lastActivePlayerId = activePlayerId;

    if (
      activePlayerId === targetPlayerId &&
      (expectedRoundNumber === null || round === expectedRoundNumber)
    ) {
      return {
        snapshot,
        accessToken: token,
      };
    }

    await waitMs(Math.max(50, timeoutStrikePollIntervalMs));
  }

  throw new Error(
    `timeout strike did not recover active turn for ${targetPlayerId} before deadline (lastActive=${lastActivePlayerId || "none"}, lastRound=${lastRound})`
  );
}

async function waitForTurnAutoAdvanceForPlayer({
  sessionId,
  playerId,
  expectedRound,
  hostPlayerId,
  hostDisplayName,
  accessToken,
  messageBuffer,
  waitTimeoutMs,
}) {
  const deadline = Date.now() + Math.max(2000, Math.floor(waitTimeoutMs));
  const expectedRoundNumber =
    Number.isFinite(expectedRound) && expectedRound > 0 ? Math.floor(expectedRound) : null;
  let token = accessToken;
  let lastHeartbeatPingAt = 0;
  let lastRound = expectedRoundNumber ?? 1;
  let lastActivePlayerId = playerId;
  const heartbeatIntervalMs =
    Number.isFinite(timeoutStrikeHeartbeatIntervalMs) && timeoutStrikeHeartbeatIntervalMs > 0
      ? Math.floor(timeoutStrikeHeartbeatIntervalMs)
      : 0;

  const maintainHeartbeat = async () => {
    if (heartbeatIntervalMs <= 0) {
      return;
    }
    const now = Date.now();
    if (now - lastHeartbeatPingAt < heartbeatIntervalMs) {
      return;
    }
    const heartbeat = await apiRequestWithStatus(
      `/multiplayer/sessions/${encodeURIComponent(sessionId)}/heartbeat`,
      {
        method: "POST",
        accessToken: token,
        body: { playerId: hostPlayerId },
      }
    );
    if (heartbeat.ok && heartbeat.body?.ok === true) {
      lastHeartbeatPingAt = now;
      return;
    }
    if (isTransientQueueRefreshFailure(heartbeat)) {
      const reason = String(heartbeat?.body?.reason ?? "unknown");
      log(
        `Timeout strike heartbeat transient failure status=${heartbeat.status} reason=${reason}; attempting auth refresh recovery.`
      );
      const recovered = await refreshSessionAuthWithRecovery({
        sessionId,
        playerId: hostPlayerId,
        displayName: hostDisplayName,
        accessToken: token,
        maxAttempts: 8,
        initialDelayMs: 300,
      });
      token = recovered.accessToken;
      lastHeartbeatPingAt = now;
      return;
    }
    throw new Error(
      `timeout strike heartbeat failed status=${heartbeat.status} body=${JSON.stringify(heartbeat.body)}`
    );
  };

  if (messageBuffer) {
    while (Date.now() < deadline) {
      await maintainHeartbeat();
      const wsAdvance = consumeTurnAutoAdvanceFromBuffer(
        messageBuffer,
        sessionId,
        playerId,
        expectedRoundNumber
      );
      if (wsAdvance) {
        const refreshed = await refreshSessionAuthWithRecovery({
          sessionId,
          playerId: hostPlayerId,
          displayName: hostDisplayName,
          accessToken: token,
        });
        token = refreshed.accessToken;
        const turnState = refreshed.snapshot?.turnState ?? null;
        lastRound = normalizeE2ERoundNumber(turnState?.round, expectedRoundNumber ?? 1);
        lastActivePlayerId =
          typeof turnState?.activeTurnPlayerId === "string" ? turnState.activeTurnPlayerId : "";
        return {
          snapshot: refreshed.snapshot,
          accessToken: token,
          reason: typeof wsAdvance.reason === "string" ? wsAdvance.reason : "",
        };
      }
      await waitMs(Math.max(50, timeoutStrikePollIntervalMs));
    }
  } else {
    // Avoid aggressive auth-refresh polling here, since that path mutates liveness state
    // and can delay turn-timeout expiry under load.
    while (Date.now() < deadline) {
      await maintainHeartbeat();
      const remainingMs = Math.max(0, deadline - Date.now());
      if (remainingMs <= 0) {
        break;
      }
      await waitMs(Math.min(Math.max(50, timeoutStrikePollIntervalMs), remainingMs));
    }
  }

  for (let probeAttempt = 1; probeAttempt <= 2; probeAttempt += 1) {
    const refreshed = await refreshSessionAuthWithRecovery({
      sessionId,
      playerId: hostPlayerId,
      displayName: hostDisplayName,
      accessToken: token,
    });
    token = refreshed.accessToken;
    const snapshot = refreshed.snapshot;
    const turnState = snapshot?.turnState ?? null;
    const round = normalizeE2ERoundNumber(turnState?.round, expectedRoundNumber ?? 1);
    const activePlayerId =
      typeof turnState?.activeTurnPlayerId === "string" ? turnState.activeTurnPlayerId : "";
    lastRound = round;
    lastActivePlayerId = activePlayerId;

    if (activePlayerId !== playerId && (expectedRoundNumber === null || round === expectedRoundNumber)) {
      return {
        snapshot,
        accessToken: token,
        reason: "",
      };
    }

    if (probeAttempt < 2) {
      await waitMs(Math.max(400, timeoutStrikePollIntervalMs * 3));
    }
  }

  throw new Error(
    `timeout strike did not observe auto-advance for ${playerId} within ${waitTimeoutMs}ms (lastActive=${lastActivePlayerId || "none"}, lastRound=${lastRound})`
  );
}

async function assertNoBufferedMessage(buffer, matcher, waitDurationMs, label) {
  const startedAt = Date.now();
  const waitLimitMs =
    Number.isFinite(waitDurationMs) && waitDurationMs > 0
      ? Math.max(10, Math.floor(waitDurationMs))
      : 250;
  while (Date.now() - startedAt < waitLimitMs) {
    const hasMatch = buffer.some((payload) => matcher(payload));
    if (hasMatch) {
      throw new Error(`${label} unexpectedly received a matching payload`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function safeCloseSocket(socket) {
  if (!socket) return;
  if (socket.readyState >= 2) return;

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1000);
    socket.addEventListener(
      "close",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
    socket.close(1000, "test_complete");
  });
}

function waitMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getAvailableHumanSlots(room) {
  if (!room || typeof room !== "object") {
    return 0;
  }
  if (Number.isFinite(room.availableHumanSlots)) {
    return Number(room.availableHumanSlots);
  }
  return Math.max(0, Number(room.maxHumanCount ?? 8) - Number(room.humanCount ?? 0));
}

function isJoinablePublicRoom(room) {
  if (!room || room.isPublic !== true || room.sessionComplete === true) {
    return false;
  }
  return getAvailableHumanSlots(room) > 0;
}

function isJoinableOverflowRoom(room) {
  return isJoinablePublicRoom(room) && room.roomType === "public_overflow";
}

function isTransientRoomLookupFailure(result) {
  return Boolean(
    result &&
      ((result.status === 410 && result.body?.reason === "session_expired") ||
        (result.status === 404 && result.body?.reason === "room_not_found"))
  );
}

function isRoomFullJoinFailure(result) {
  return Boolean(result && result.status === 409 && result.body?.reason === "room_full");
}

function isTransientQueueRefreshFailure(result) {
  if (!result) {
    return false;
  }

  if (result.body?.reason === "session_expired") {
    return true;
  }

  if (result.status === 429 || (result.status >= 500 && result.status <= 504)) {
    return true;
  }

  if (result.status === 410 && result.body?.reason === "session_expired") {
    return true;
  }

  if (result.status === 404) {
    return result.body?.reason === "room_not_found" || result.body?.reason === "unknown_player";
  }

  if (result.status === 401) {
    return (
      result.body?.reason === "invalid_or_expired_access_token" ||
      result.body?.reason === "session_mismatch" ||
      result.body?.reason === "player_mismatch"
    );
  }

  return false;
}

function isTransientWinnerQueueLifecycleFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  return (
    normalized.includes("queue lifecycle did not auto-start a fresh round") ||
    normalized.includes("session_expired")
  );
}

function isTransientTimeoutStrikeObserverFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  return (
    normalized.includes("timeout strike refresh did not recover session auth") ||
    normalized.includes("timeout strike did not observe auto-advance") ||
    normalized.includes("session_expired")
  );
}

function isTransientTimeoutStrikeSessionExpiredFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  return normalized.includes("session_expired");
}

function isTransientEightPlayerBotTimeoutFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  return (
    normalized.includes("timeout strike refresh did not recover session auth") ||
    normalized.includes("timeout strike did not observe auto-advance") ||
    normalized.includes("session_expired")
  );
}

function isTransientEightPlayerBotSessionExpiredFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  return normalized.includes("session_expired");
}

async function joinRoomByCodeWithTransientRetry(roomCode, payload, options = {}) {
  const maxAttempts = Number.isFinite(options?.maxAttempts)
    ? Math.max(1, Math.floor(options.maxAttempts))
    : 3;
  const initialDelayMs = Number.isFinite(options?.initialDelayMs)
    ? Math.max(0, Math.floor(options.initialDelayMs))
    : 150;
  let lastAttempt = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastAttempt = await apiRequestWithStatus(
      `/multiplayer/rooms/${encodeURIComponent(roomCode)}/join`,
      {
        method: "POST",
        body: payload,
      }
    );
    if (!isTransientQueueRefreshFailure(lastAttempt)) {
      break;
    }
    if (attempt >= maxAttempts - 1) {
      break;
    }
    const backoffMs = initialDelayMs * (attempt + 1);
    if (backoffMs > 0) {
      await waitMs(backoffMs);
    }
  }
  return lastAttempt;
}

async function joinSessionByIdWithTransientRetry(sessionId, payload, options = {}) {
  const maxAttempts = Number.isFinite(options?.maxAttempts)
    ? Math.max(1, Math.floor(options.maxAttempts))
    : 3;
  const initialDelayMs = Number.isFinite(options?.initialDelayMs)
    ? Math.max(0, Math.floor(options.initialDelayMs))
    : 150;
  let lastAttempt = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastAttempt = await apiRequestWithStatus(
      `/multiplayer/sessions/${encodeURIComponent(sessionId)}/join`,
      {
        method: "POST",
        body: payload,
      }
    );
    if (!isTransientRoomLookupFailure(lastAttempt)) {
      break;
    }
    if (attempt >= maxAttempts - 1) {
      break;
    }
    const backoffMs = initialDelayMs * (attempt + 1);
    if (backoffMs > 0) {
      await waitMs(backoffMs);
    }
  }
  return lastAttempt;
}

async function safeLeave(sessionId, playerId) {
  if (!sessionId || !playerId) return;

  try {
    await apiRequest(`/multiplayer/sessions/${encodeURIComponent(sessionId)}/leave`, {
      method: "POST",
      body: { playerId },
    });
  } catch {
    // Intentionally ignored during cleanup.
  }
}

function createChaosAttack(suffix) {
  return {
    type: "chaos_attack",
    attackType: "camera_effect",
    gameId: `e2e-game-${suffix}`,
    attackerId: hostPlayerId,
    targetId: guestPlayerId,
    abilityId: `e2e-ability-${suffix}`,
    level: 1,
    effectType: "shake",
    intensity: 0.5,
    duration: 1200,
    chaosPointsCost: 10,
    timestamp: Date.now(),
  };
}

function createParticleEmit(suffix) {
  return {
    type: "particle:emit",
    effectId: `e2e-effect-${suffix}`,
    position: { x: 1, y: 2, z: 3 },
    timestamp: Date.now(),
  };
}

function createGameUpdate(suffix) {
  return {
    type: "game_update",
    id: `e2e-update-${suffix}`,
    title: "E2E Live Update",
    content: "Multiplayer game update relay test",
    updateType: "announcement",
    timestamp: Date.now(),
  };
}

function createPlayerNotification(suffix) {
  return {
    type: "player_notification",
    id: `e2e-note-${suffix}`,
    title: "E2E Notification",
    message: "Player notification relay test",
    severity: "info",
    timestamp: Date.now(),
  };
}

function createRoomChannelMessage(
  suffix,
  { channel = "public", topic = "chat", title = "E2E Room Channel", message, targetPlayerId } = {}
) {
  const normalizedMessage =
    typeof message === "string" && message.trim().length > 0
      ? message.trim()
      : "Room channel relay test";
  return {
    type: "room_channel",
    id: `e2e-room-channel-${suffix}-${channel}-${randomUUID().slice(0, 6)}`,
    channel: channel === "direct" ? "direct" : "public",
    topic,
    title,
    message: normalizedMessage,
    ...(channel === "direct" && typeof targetPlayerId === "string"
      ? { targetPlayerId }
      : {}),
    timestamp: Date.now(),
  };
}

function isBotPayload(payload) {
  return payload?.bot === true;
}

function toText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  return "";
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected: ${expected}, actual: ${actual})`);
  }
}

function log(message) {
  process.stdout.write(`[e2e] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[e2e] FAIL: ${message}\n`);
  process.exitCode = 1;
}

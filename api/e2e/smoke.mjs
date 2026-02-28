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
const assertStorageCutover = process.env.E2E_ASSERT_STORAGE_CUTOVER === "1";
const adminToken = process.env.E2E_ADMIN_TOKEN?.trim() ?? "";
const roomExpiryWaitMs = Number(process.env.E2E_ROOM_EXPIRY_WAIT_MS ?? 9000);
// Production defaults to a 60s post-round auto-start window; keep smoke timeout above that.
const queueLifecycleWaitMs = Number(process.env.E2E_QUEUE_LIFECYCLE_WAIT_MS ?? 75000);
const expectedStorageBackend = normalizeOptionalString(process.env.E2E_EXPECT_STORAGE_BACKEND).toLowerCase();
const expectedFirestorePrefix = normalizeOptionalString(process.env.E2E_EXPECT_FIRESTORE_PREFIX);
const expectedStoreSections = getStoreSections();
const expectedStorageSectionMinCounts = parseStorageSectionMinCountSpec(
  process.env.E2E_EXPECT_STORAGE_SECTION_MIN_COUNTS
);

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

  const runSuffix = randomUUID().slice(0, 8);
  await runRoomLifecycleChecks(runSuffix);
  await runWinnerQueueLifecycleChecks(runSuffix);
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
  const hostAccessToken = created.auth.accessToken;

  const joined = await apiRequest(
    `/multiplayer/sessions/${encodeURIComponent(activeSessionId)}/join`,
    {
      method: "POST",
      body: {
        playerId: guestPlayerId,
        displayName: "E2E Guest",
      },
    }
  );
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

  const hostSit = await apiRequest(
    `/multiplayer/sessions/${encodeURIComponent(activeSessionId)}/participant-state`,
    {
      method: "POST",
      accessToken: hostAccessToken,
      body: {
        playerId: hostPlayerId,
        action: "sit",
      },
    }
  );
  assert(
    hostSit?.ok === true,
    `host sit participant-state did not return ok=true (reason=${String(hostSit?.reason ?? "unknown")})`
  );

  const guestSit = await apiRequest(
    `/multiplayer/sessions/${encodeURIComponent(activeSessionId)}/participant-state`,
    {
      method: "POST",
      accessToken: guestAccessToken,
      body: {
        playerId: guestPlayerId,
        action: "sit",
      },
    }
  );
  assert(
    guestSit?.ok === true,
    `guest sit participant-state did not return ok=true (reason=${String(guestSit?.reason ?? "unknown")})`
  );

  const hostReady = await apiRequest(
    `/multiplayer/sessions/${encodeURIComponent(activeSessionId)}/participant-state`,
    {
      method: "POST",
      accessToken: hostAccessToken,
      body: {
        playerId: hostPlayerId,
        action: "ready",
      },
    }
  );
  assert(
    hostReady?.ok === true,
    `host ready participant-state did not return ok=true (reason=${String(hostReady?.reason ?? "unknown")})`
  );

  const guestReady = await apiRequest(
    `/multiplayer/sessions/${encodeURIComponent(activeSessionId)}/participant-state`,
    {
      method: "POST",
      accessToken: guestAccessToken,
      body: {
        playerId: guestPlayerId,
        action: "ready",
      },
    }
  );
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

  if (firebaseIdToken) {
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
    if (!room || room.isPublic !== true || room.sessionComplete === true) {
      return false;
    }
    const slots = Number.isFinite(room.availableHumanSlots)
      ? Number(room.availableHumanSlots)
      : Math.max(0, Number(room.maxHumanCount ?? 8) - Number(room.humanCount ?? 0));
    return slots > 0;
  });
  assert(joinablePublicRooms.length > 0, "expected at least one joinable public room");

  const targetRoom = joinablePublicRooms[0];
  let targetRoomId = String(targetRoom.sessionId ?? "");
  const targetRoomCode = String(targetRoom.roomCode ?? "");
  assert(targetRoomId.length > 0, "target public room missing sessionId");
  assert(targetRoomCode.length > 0, "target public room missing roomCode");

  const maxHumans = Number.isFinite(targetRoom.maxHumanCount)
    ? Math.max(2, Math.floor(targetRoom.maxHumanCount))
    : 8;
  const joinedPlayers = [];
  let roomFullObserved = false;
  for (let index = 0; index < maxHumans + 2; index += 1) {
    const playerId = `e2e-roomfill-${runSuffix}-${index + 1}`;
    let joinAttempt = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      joinAttempt = await apiRequestWithStatus(
        `/multiplayer/rooms/${encodeURIComponent(targetRoomCode)}/join`,
        {
          method: "POST",
          body: {
            playerId,
            displayName: `E2E Fill ${index + 1}`,
          },
        }
      );

      const transientRoomLookupFailure =
        (joinAttempt.status === 410 && joinAttempt.body?.reason === "session_expired") ||
        (joinAttempt.status === 404 && joinAttempt.body?.reason === "room_not_found");
      if (!transientRoomLookupFailure) {
        break;
      }
      await waitMs(150);
    }
    assert(joinAttempt, "missing room fill join attempt result");
    if (joinAttempt.ok) {
      const joinedSessionId = String(joinAttempt.body?.sessionId ?? targetRoomId);
      if (joinedSessionId.length > 0) {
        targetRoomId = joinedSessionId;
      }
      joinedPlayers.push({
        playerId,
        sessionId: joinedSessionId,
      });
      continue;
    }
    if (joinAttempt.status === 409 && joinAttempt.body?.reason === "room_full") {
      roomFullObserved = true;
      break;
    }
    throw new Error(
      `unexpected room fill join result status=${joinAttempt.status} body=${JSON.stringify(joinAttempt.body)}`
    );
  }
  assert(roomFullObserved, "expected room_full while filling target public room");

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
  const privateJoinedByCode = await apiRequest(
    `/multiplayer/rooms/${encodeURIComponent(privateCreated.roomCode)}/join`,
    {
      method: "POST",
      body: {
        playerId: privateJoinerId,
        displayName: "E2E Private Joiner",
      },
    }
  );
  assertEqual(
    privateJoinedByCode?.sessionId,
    privateCreated.sessionId,
    "expected join-by-room-code to resolve private room session"
  );
  await safeLeave(privateCreated.sessionId, privateJoinerId);
  await safeLeave(privateCreated.sessionId, privateCreatorId);

  const fullJoinProbe = await apiRequestWithStatus(
    `/multiplayer/rooms/${encodeURIComponent(targetRoomCode)}/join`,
    {
      method: "POST",
      body: {
        playerId: `e2e-roomfill-extra-${runSuffix}`,
        displayName: "E2E Overflow Probe",
      },
    }
  );
  assertEqual(fullJoinProbe.status, 409, "expected room_full 409 once room is at capacity");
  assertEqual(
    fullJoinProbe.body?.reason,
    "room_full",
    "expected room_full reason in full-room join rejection"
  );

  const postFillListing = await apiRequest("/multiplayer/rooms?limit=100", { method: "GET" });
  assert(Array.isArray(postFillListing?.rooms), "post-fill room listing missing rooms[]");
  const postFillRooms = postFillListing.rooms;
  const joinableOverflowRoom = postFillRooms.find((room) => {
    if (!room || room.roomType !== "public_overflow" || room.sessionComplete === true) {
      return false;
    }
    const slots = Number.isFinite(room.availableHumanSlots)
      ? Number(room.availableHumanSlots)
      : Math.max(0, Number(room.maxHumanCount ?? 8) - Number(room.humanCount ?? 0));
    return slots > 0;
  });
  assert(joinableOverflowRoom, "expected at least one joinable overflow room after filling a public room");
  const overflowRoomId = String(joinableOverflowRoom.sessionId ?? "");
  assert(overflowRoomId.length > 0, "overflow room missing sessionId");

  for (const joined of joinedPlayers) {
    await safeLeave(joined.sessionId || targetRoomId, joined.playerId);
  }

  const resetListing = await apiRequest("/multiplayer/rooms?limit=100", { method: "GET" });
  assert(Array.isArray(resetListing?.rooms), "reset room listing missing rooms[]");
  const resetRoom = resetListing.rooms.find((room) => room?.roomCode === targetRoomCode);
  assert(resetRoom, "expected filled public room to remain listed after players leave");
  const resetSlots = Number.isFinite(resetRoom.availableHumanSlots)
    ? Number(resetRoom.availableHumanSlots)
    : Math.max(0, Number(resetRoom.maxHumanCount ?? 8) - Number(resetRoom.humanCount ?? 0));
  assert(resetSlots > 0, "expected emptied public room to be joinable again");

  if (assertRoomExpiry) {
    await waitMs(Math.max(1000, roomExpiryWaitMs));
    const expiryListing = await apiRequest("/multiplayer/rooms?limit=100", { method: "GET" });
    assert(Array.isArray(expiryListing?.rooms), "expiry room listing missing rooms[]");
    const overflowStillPresent = expiryListing.rooms.some((room) => room?.sessionId === overflowRoomId);
    assert(
      !overflowStillPresent,
      `expected overflow room ${overflowRoomId} to expire and disappear from room list`
    );
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

  try {
    const joined = await apiRequest(
      `/multiplayer/sessions/${encodeURIComponent(queueSessionId)}/join`,
      {
        method: "POST",
        body: {
          playerId: queueGuestPlayerId,
          displayName: "E2E Queue Guest",
        },
      }
    );
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

    const deadline = Date.now() + Math.max(5000, queueLifecycleWaitMs);
    let restarted = null;
    let lastHeartbeatPingAt = 0;
    while (Date.now() < deadline) {
      const now = Date.now();
      if (now - lastHeartbeatPingAt >= 5000) {
        const heartbeat = await apiRequest(
          `/multiplayer/sessions/${encodeURIComponent(queueSessionId)}/heartbeat`,
          {
            method: "POST",
            accessToken: hostAccessToken,
            body: { playerId: queueHostPlayerId },
          }
        );
        assert(
          heartbeat?.ok === true,
          `queue lifecycle heartbeat did not return ok=true (reason=${String(heartbeat?.reason ?? "unknown")})`
        );
        lastHeartbeatPingAt = now;
      }

      const refreshed = await apiRequest(
        `/multiplayer/sessions/${encodeURIComponent(queueSessionId)}/auth/refresh`,
        {
          method: "POST",
          accessToken: hostAccessToken,
          body: { playerId: queueHostPlayerId },
        }
      );
      if (typeof refreshed?.auth?.accessToken === "string" && refreshed.auth.accessToken.length > 0) {
        hostAccessToken = refreshed.auth.accessToken;
      }

      const refreshedHost = Array.isArray(refreshed?.participants)
        ? refreshed.participants.find((participant) => participant?.playerId === queueHostPlayerId)
        : null;
      const hostReadyForFreshRound =
        refreshedHost &&
        refreshedHost.queuedForNextGame !== true &&
        refreshedHost.isComplete !== true &&
        Number(refreshedHost.score ?? 0) === 0 &&
        Number(refreshedHost.remainingDice ?? -1) === 15;
      const turnReady =
        refreshed?.sessionComplete !== true &&
        typeof refreshed?.turnState?.activeTurnPlayerId === "string" &&
        refreshed.turnState.activeTurnPlayerId === queueHostPlayerId;
      if (hostReadyForFreshRound && turnReady) {
        restarted = refreshed;
        break;
      }

      await waitMs(250);
    }

    assert(restarted, "queue lifecycle did not auto-start a fresh round within expected wait window");
    log("Winner queue lifecycle checks passed.");
  } finally {
    await safeLeave(queueSessionId, queueGuestPlayerId);
    await safeLeave(queueSessionId, queueHostPlayerId);
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

import { randomUUID } from "node:crypto";

const REQUEST_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 10000);
const WS_TIMEOUT_MS = Number(process.env.E2E_WS_TIMEOUT_MS ?? 10000);
const firebaseIdToken = process.env.E2E_FIREBASE_ID_TOKEN?.trim() ?? "";
const assertBotTraffic = process.env.E2E_ASSERT_BOTS === "1";

const baseInput = (process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3000").trim();
const wsOverride = process.env.E2E_WS_URL?.trim();
const targets = resolveTargets(baseInput, wsOverride);

let activeSessionId = "";
let hostPlayerId = "";
let guestPlayerId = "";
let hostSocket;
let guestSocket;
let hostMessageBuffer;
let guestMessageBuffer;

async function run() {
  log(`API base URL: ${targets.apiBaseUrl}`);
  log(`WS base URL:  ${targets.wsBaseUrl}`);

  await apiRequest("/health", { method: "GET" });

  const runSuffix = randomUUID().slice(0, 8);
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
  assert(
    joined.turnState.order.includes(hostPlayerId),
    "turnState.order missing host player"
  );
  assert(
    joined.turnState.order.includes(guestPlayerId),
    "turnState.order missing guest player"
  );

  hostSocket = await openSocket(
    "host",
    buildSocketUrl(activeSessionId, hostPlayerId, created.auth.accessToken)
  );
  hostMessageBuffer = createSocketMessageBuffer(hostSocket);
  guestSocket = await openSocket(
    "guest",
    buildSocketUrl(activeSessionId, guestPlayerId, joined.auth.accessToken)
  );
  guestMessageBuffer = createSocketMessageBuffer(guestSocket);

  const expectedFirstTurnPlayerId =
    typeof joined?.turnState?.activeTurnPlayerId === "string"
      ? joined.turnState.activeTurnPlayerId
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
    Array.isArray(joined?.turnState?.order) && joined.turnState.order.length > 1
      ? joined.turnState.order[1]
      : (joined?.turnState?.order?.[0] ?? guestPlayerId);
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
  assert(
    Number.isFinite(expectedScorePoints) && expectedScorePoints >= 0,
    "expected score points not derivable from server roll"
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

  if (assertBotTraffic) {
    await waitForMessage(hostSocket, isBotPayload, "host bot websocket traffic receive");
  }

  const heartbeat = await apiRequest(
    `/multiplayer/sessions/${encodeURIComponent(activeSessionId)}/heartbeat`,
    {
      method: "POST",
      accessToken: created.auth.accessToken,
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
  const parsed = new URL(rawApiBase);

  const apiUrl = new URL(parsed.toString());
  const normalizedPath = apiUrl.pathname.replace(/\/+$/, "");
  apiUrl.pathname = normalizedPath.endsWith("/api")
    ? normalizedPath || "/api"
    : `${normalizedPath || ""}/api`;
  apiUrl.search = "";
  apiUrl.hash = "";

  const wsUrl = rawWsBase ? new URL(rawWsBase) : new URL(apiUrl.toString());
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

async function apiRequest(path, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = {
    "content-type": "application/json",
  };
  if (options.accessToken) {
    headers.authorization = `Bearer ${options.accessToken}`;
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

  if (!response.ok) {
    throw new Error(
      `request failed (${options.method} ${path}) status=${response.status} body=${JSON.stringify(parsedBody)}`
    );
  }

  return parsedBody;
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

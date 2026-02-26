import { randomUUID } from "node:crypto";

const REQUEST_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 10000);
const WS_TIMEOUT_MS = Number(process.env.E2E_WS_TIMEOUT_MS ?? 10000);

const baseInput = (process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3000").trim();
const wsOverride = process.env.E2E_WS_URL?.trim();
const targets = resolveTargets(baseInput, wsOverride);

let activeSessionId = "";
let hostPlayerId = "";
let guestPlayerId = "";
let hostSocket;
let guestSocket;

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

  hostSocket = await openSocket(
    "host",
    buildSocketUrl(activeSessionId, hostPlayerId, created.auth.accessToken)
  );
  guestSocket = await openSocket(
    "guest",
    buildSocketUrl(activeSessionId, guestPlayerId, joined.auth.accessToken)
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

  const heartbeat = await apiRequest(
    `/multiplayer/sessions/${encodeURIComponent(activeSessionId)}/heartbeat`,
    {
      method: "POST",
      accessToken: created.auth.accessToken,
      body: { playerId: hostPlayerId },
    }
  );
  assert(heartbeat?.ok === true, "heartbeat response was not ok=true");

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

function log(message) {
  process.stdout.write(`[e2e] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[e2e] FAIL: ${message}\n`);
  process.exitCode = 1;
}

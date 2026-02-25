import { BackendApiService, type GameLogRecord } from "./backendApi.js";
import { authSessionService } from "./authSession.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (expected: ${expected}, actual: ${actual})`);
  }
}

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✓ ${name}`);
    })
    .catch((error) => {
      console.error(`✗ ${name}`);
      throw error;
    });
}

function jsonResponse(payload: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

const fetchCalls: FetchCall[] = [];
let fetchResponder: (url: string, init?: RequestInit) => Response = () => jsonResponse({});

const mockFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  fetchCalls.push({ url, init });
  return fetchResponder(url, init);
};

await test("requests player profile with encoded id", async () => {
  authSessionService.clear();
  fetchCalls.length = 0;
  fetchResponder = () =>
    jsonResponse({
      playerId: "player-1",
      settings: {},
      upgradeProgression: {},
      updatedAt: Date.now(),
    });

  const api = new BackendApiService({
    baseUrl: "https://api.example.com/api",
    fetchImpl: mockFetch,
  });

  await api.getPlayerProfile("player/1");

  assertEqual(fetchCalls.length, 1, "Expected one fetch call");
  assertEqual(
    fetchCalls[0].url,
    "https://api.example.com/api/players/player%2F1/profile",
    "Expected encoded player profile endpoint"
  );
});

await test("posts log batch payload", async () => {
  authSessionService.clear();
  fetchCalls.length = 0;
  fetchResponder = () => jsonResponse({ accepted: 2, failed: 0 });

  const api = new BackendApiService({
    baseUrl: "https://api.example.com/api",
    fetchImpl: mockFetch,
  });

  const logs: GameLogRecord[] = [
    {
      id: "log-1",
      playerId: "player-1",
      type: "event",
      timestamp: Date.now(),
      payload: { ok: true },
    },
    {
      id: "log-2",
      playerId: "player-1",
      type: "event",
      timestamp: Date.now(),
      payload: { ok: true },
    },
  ];
  const result = await api.appendGameLogs(logs);

  assertEqual(result?.accepted, 2, "Expected accepted count");
  assertEqual(fetchCalls.length, 1, "Expected one fetch call");
  assertEqual(fetchCalls[0].url, "https://api.example.com/api/logs/batch", "Expected logs endpoint");
  assert(typeof fetchCalls[0].init?.body === "string", "Expected JSON request body");
});

await test("returns null on non-ok responses", async () => {
  authSessionService.clear();
  fetchCalls.length = 0;
  fetchResponder = () => jsonResponse({ error: "bad request" }, 400);

  const api = new BackendApiService({
    baseUrl: "https://api.example.com/api",
    fetchImpl: mockFetch,
  });
  const result = await api.createMultiplayerSession({
    playerId: "player-1",
  });

  assertEqual(result, null, "Expected null result for non-ok status");
  assertEqual(fetchCalls.length, 1, "Expected one fetch call");
});

await test("retries once on 401 after token refresh", async () => {
  authSessionService.clear();
  authSessionService.setTokens({
    accessToken: "old-access-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 60_000,
  });

  fetchCalls.length = 0;
  fetchResponder = (url) => {
    if (url.endsWith("/players/player-1/profile") && fetchCalls.length === 1) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    if (url.endsWith("/auth/token/refresh")) {
      return jsonResponse({
        accessToken: "new-access-token",
        refreshToken: "refresh-token",
        expiresAt: Date.now() + 60_000,
      });
    }
    return jsonResponse({
      playerId: "player-1",
      settings: {},
      upgradeProgression: {},
      updatedAt: Date.now(),
    });
  };

  const api = new BackendApiService({
    baseUrl: "https://api.example.com/api",
    fetchImpl: mockFetch,
  });
  const result = await api.getPlayerProfile("player-1");

  assert(result !== null, "Expected successful response after refresh");
  assertEqual(fetchCalls.length, 3, "Expected request + refresh + retry");
  const firstHeaders = (fetchCalls[0].init?.headers ?? {}) as Record<string, string>;
  assertEqual(
    firstHeaders.authorization,
    "Bearer old-access-token",
    "Expected first request to include old access token"
  );
  const retryHeaders = (fetchCalls[2].init?.headers ?? {}) as Record<string, string>;
  assertEqual(
    retryHeaders.authorization,
    "Bearer new-access-token",
    "Expected retry request to include refreshed access token"
  );
});

console.log("\nBackendApiService tests passed! ✓");

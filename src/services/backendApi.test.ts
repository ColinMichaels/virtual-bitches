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

await test("passes botCount and difficulty in multiplayer session create payload", async () => {
  authSessionService.clear();
  fetchCalls.length = 0;
  fetchResponder = () =>
    jsonResponse({
      sessionId: "session-1",
      roomCode: "ROOM42",
      wsUrl: "ws://localhost:3000",
      createdAt: Date.now(),
    });

  const api = new BackendApiService({
    baseUrl: "https://api.example.com/api",
    fetchImpl: mockFetch,
  });

  const result = await api.createMultiplayerSession({
    playerId: "player-1",
    botCount: 2,
    gameDifficulty: "hard",
  });

  assert(result !== null, "Expected create session response");
  assertEqual(fetchCalls.length, 1, "Expected one fetch call");
  const rawBody = String(fetchCalls[0].init?.body ?? "");
  const parsedBody = JSON.parse(rawBody) as { botCount?: number; gameDifficulty?: string };
  assertEqual(parsedBody.botCount, 2, "Expected botCount in request payload");
  assertEqual(parsedBody.gameDifficulty, "hard", "Expected gameDifficulty in request payload");
});

await test("lists multiplayer rooms with bounded limit", async () => {
  authSessionService.clear();
  fetchCalls.length = 0;
  fetchResponder = () =>
    jsonResponse({
      rooms: [
        {
          sessionId: "session-1",
          roomCode: "ROOM42",
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
          expiresAt: Date.now() + 60000,
          participantCount: 2,
          humanCount: 1,
          activeHumanCount: 1,
          readyHumanCount: 1,
          botCount: 1,
          sessionComplete: false,
        },
      ],
    });

  const api = new BackendApiService({
    baseUrl: "https://api.example.com/api",
    fetchImpl: mockFetch,
  });

  const result = await api.listMultiplayerRooms(999);
  assert(Array.isArray(result), "Expected rooms array result");
  assertEqual(fetchCalls.length, 1, "Expected one fetch call");
  assertEqual(
    fetchCalls[0].url,
    "https://api.example.com/api/multiplayer/rooms?limit=100",
    "Expected bounded room listing endpoint"
  );
});

await test("returns typed room_full reason when multiplayer join is rejected", async () => {
  authSessionService.clear();
  fetchCalls.length = 0;
  fetchResponder = () => jsonResponse({ error: "Room is full", reason: "room_full" }, 409);

  const api = new BackendApiService({
    baseUrl: "https://api.example.com/api",
    fetchImpl: mockFetch,
  });

  const result = await api.joinMultiplayerSession("session-1", {
    playerId: "player-1",
  });
  assertEqual(result.session, null, "Expected null session on room_full");
  assertEqual(result.reason, "room_full", "Expected room_full join failure reason");
  assertEqual(result.status, 409, "Expected 409 status");
});

await test("returns joined session payload on successful multiplayer join", async () => {
  authSessionService.clear();
  fetchCalls.length = 0;
  fetchResponder = () =>
    jsonResponse({
      sessionId: "session-2",
      roomCode: "ROOM2",
      createdAt: Date.now(),
    });

  const api = new BackendApiService({
    baseUrl: "https://api.example.com/api",
    fetchImpl: mockFetch,
  });

  const result = await api.joinMultiplayerSession("session-2", {
    playerId: "player-1",
    botCount: 3,
  });
  assert(result.session !== null, "Expected joined session in result");
  assertEqual(result.session?.sessionId, "session-2", "Expected joined session id");
  assertEqual(result.reason, undefined, "Expected no join failure reason");
  assert(typeof fetchCalls[0].init?.body === "string", "Expected join request body");
  const parsedBody = JSON.parse(String(fetchCalls[0].init?.body ?? "{}")) as {
    botCount?: number;
  };
  assertEqual(parsedBody.botCount, 3, "Expected botCount in join request payload");
});

await test("joins multiplayer room by room code endpoint", async () => {
  authSessionService.clear();
  fetchCalls.length = 0;
  fetchResponder = () =>
    jsonResponse({
      sessionId: "session-by-code",
      roomCode: "AB12CD",
      createdAt: Date.now(),
    });

  const api = new BackendApiService({
    baseUrl: "https://api.example.com/api",
    fetchImpl: mockFetch,
  });

  const result = await api.joinMultiplayerRoomByCode("ab12cd", {
    playerId: "player-1",
  });
  assert(result.session !== null, "Expected joined session from room code");
  assertEqual(fetchCalls.length, 1, "Expected one fetch call");
  assertEqual(
    fetchCalls[0].url,
    "https://api.example.com/api/multiplayer/rooms/AB12CD/join",
    "Expected room-code join endpoint"
  );
});

await test("returns typed room_not_found reason when room code join is rejected", async () => {
  authSessionService.clear();
  fetchCalls.length = 0;
  fetchResponder = () => jsonResponse({ error: "Room code not found", reason: "room_not_found" }, 404);

  const api = new BackendApiService({
    baseUrl: "https://api.example.com/api",
    fetchImpl: mockFetch,
  });

  const result = await api.joinMultiplayerRoomByCode("missing", {
    playerId: "player-1",
  });
  assertEqual(result.session, null, "Expected null session when room code is missing");
  assertEqual(result.reason, "room_not_found", "Expected room_not_found reason");
  assertEqual(result.status, 404, "Expected 404 status");
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

await test("uses firebase token provider for leaderboard submission", async () => {
  authSessionService.clear();
  fetchCalls.length = 0;
  fetchResponder = () =>
    jsonResponse({
      id: "uid-1:score-1",
      uid: "uid-1",
      displayName: "Player",
      score: 12,
      timestamp: Date.now(),
      duration: 1000,
      rollCount: 3,
    });

  const api = new BackendApiService({
    baseUrl: "https://api.example.com/api",
    fetchImpl: mockFetch,
    firebaseTokenProvider: () => "firebase-id-token",
  });

  const result = await api.submitLeaderboardScore({
    scoreId: "score-1",
    score: 12,
    timestamp: Date.now(),
    duration: 1000,
    rollCount: 3,
  });

  assert(result !== null, "Expected leaderboard submission response");
  assertEqual(fetchCalls.length, 1, "Expected one fetch call");
  const headers = (fetchCalls[0].init?.headers ?? {}) as Record<string, string>;
  assertEqual(
    headers.authorization,
    "Bearer firebase-id-token",
    "Expected Firebase token on leaderboard request"
  );
});

await test("does not attempt session refresh for firebase-auth request", async () => {
  authSessionService.clear();
  fetchCalls.length = 0;
  fetchResponder = () => jsonResponse({ error: "unauthorized" }, 401);

  const api = new BackendApiService({
    baseUrl: "https://api.example.com/api",
    fetchImpl: mockFetch,
    firebaseTokenProvider: () => "firebase-id-token",
  });

  const result = await api.submitLeaderboardScore({
    scoreId: "score-2",
    score: 10,
    timestamp: Date.now(),
    duration: 900,
    rollCount: 2,
  });

  assertEqual(result, null, "Expected null result on unauthorized leaderboard request");
  assertEqual(fetchCalls.length, 1, "Expected only one request without refresh retry");
  assert(
    !fetchCalls[0].url.endsWith("/auth/token/refresh"),
    "Did not expect refresh token endpoint for firebase request"
  );
});

await test("dispatches firebase session-expired event on firebase 401", async () => {
  authSessionService.clear();
  fetchCalls.length = 0;
  fetchResponder = () => jsonResponse({ error: "Unauthorized", reason: "firebase_token_expired" }, 401);

  const originalDocument = (globalThis as { document?: Document }).document;
  const dispatched: Array<{ path?: string; reason?: string }> = [];
  const mockDocument = {
    dispatchEvent(event: Event) {
      if (event.type === "auth:firebaseSessionExpired") {
        const detail = (event as CustomEvent<{ path?: string; reason?: string }>).detail;
        dispatched.push(detail ?? {});
      }
      return true;
    },
  } as Document;
  (globalThis as { document?: Document }).document = mockDocument;

  try {
    const api = new BackendApiService({
      baseUrl: "https://api.example.com/api",
      fetchImpl: mockFetch,
      firebaseTokenProvider: () => "firebase-id-token",
    });

    const result = await api.submitLeaderboardScore({
      scoreId: "score-auth-expired",
      score: 11,
      timestamp: Date.now(),
      duration: 1200,
      rollCount: 3,
    });

    assertEqual(result, null, "Expected null result on unauthorized firebase request");
    assertEqual(dispatched.length, 1, "Expected one firebase session-expired event");
    assertEqual(
      dispatched[0].path,
      "/leaderboard/scores",
      "Expected firebase session-expired event path"
    );
  } finally {
    if (typeof originalDocument === "undefined") {
      delete (globalThis as { document?: Document }).document;
    } else {
      (globalThis as { document?: Document }).document = originalDocument;
    }
  }
});

await test("updates authenticated profile with firebase token", async () => {
  authSessionService.clear();
  fetchCalls.length = 0;
  fetchResponder = () =>
    jsonResponse({
      uid: "uid-1",
      displayName: "Google User",
      leaderboardName: "DiceMaster",
      email: "user@example.com",
      isAnonymous: false,
      provider: "firebase",
    });

  const api = new BackendApiService({
    baseUrl: "https://api.example.com/api",
    fetchImpl: mockFetch,
    firebaseTokenProvider: () => "firebase-id-token",
  });

  const result = await api.updateAuthenticatedUserProfile("DiceMaster");
  assert(result !== null, "Expected profile update response");
  assertEqual(fetchCalls.length, 1, "Expected one profile update request");
  assertEqual(fetchCalls[0].url, "https://api.example.com/api/auth/me", "Expected auth profile endpoint");
  assertEqual(fetchCalls[0].init?.method, "PUT", "Expected PUT method");
});

console.log("\nBackendApiService tests passed! ✓");

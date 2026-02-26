import { MultiplayerSessionService } from "./sessionService.js";
import { backendApiService, type MultiplayerSessionRecord } from "../services/backendApi.js";
import { authSessionService } from "../services/authSession.js";

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

function createSession(partial: Partial<MultiplayerSessionRecord> = {}): MultiplayerSessionRecord {
  return {
    sessionId: "session-1",
    roomCode: "ROOM1",
    createdAt: Date.now(),
    ...partial,
  };
}

function installDocumentShim(): {
  target: EventTarget;
  restore: () => void;
} {
  const originalDocument = (globalThis as { document?: unknown }).document;
  const target = new EventTarget();
  (globalThis as { document?: unknown }).document = target;

  const customEventExists = typeof CustomEvent !== "undefined";
  const originalCustomEvent = customEventExists ? CustomEvent : undefined;
  if (!customEventExists) {
    class CustomEventShim<T = unknown> extends Event {
      detail: T;

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type);
        this.detail = (init?.detail ?? undefined) as T;
      }
    }
    (globalThis as { CustomEvent?: unknown }).CustomEvent = CustomEventShim;
  }

  return {
    target,
    restore: () => {
      if (typeof originalDocument === "undefined") {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = originalDocument;
      }
      if (!customEventExists) {
        if (typeof originalCustomEvent === "undefined") {
          delete (globalThis as { CustomEvent?: unknown }).CustomEvent;
        } else {
          (globalThis as { CustomEvent?: unknown }).CustomEvent = originalCustomEvent;
        }
      }
    },
  };
}

async function invokePrivateSendHeartbeat(service: MultiplayerSessionService): Promise<void> {
  const privateApi = service as unknown as { sendHeartbeat: () => Promise<void> };
  await privateApi.sendHeartbeat();
}

await test("dispatches sessionExpired with session id and clears auth on expired heartbeat", async () => {
  const documentShim = installDocumentShim();
  const service = new MultiplayerSessionService("player-alpha");

  const originalJoin = backendApiService.joinMultiplayerSession.bind(backendApiService);
  const originalHeartbeat = backendApiService.heartbeatMultiplayerSession.bind(backendApiService);
  const originalAuthClear = authSessionService.clear.bind(authSessionService);

  const capturedEvents: Array<{ reason?: string; sessionId?: string }> = [];
  const clearedReasons: string[] = [];
  documentShim.target.addEventListener("multiplayer:sessionExpired", (event: Event) => {
    const detail = (event as CustomEvent<{ reason?: string; sessionId?: string }>).detail;
    capturedEvents.push(detail ?? {});
  });

  (backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession })
    .joinMultiplayerSession = async () => createSession({ sessionId: "session-expired-case" });
  (backendApiService as { heartbeatMultiplayerSession: typeof backendApiService.heartbeatMultiplayerSession })
    .heartbeatMultiplayerSession = async () => ({ ok: false, reason: "session_expired" });
  (authSessionService as { clear: typeof authSessionService.clear }).clear = (reason?: string) => {
    clearedReasons.push(reason ?? "");
  };

  try {
    const joined = await service.joinSession("session-expired-case");
    assert(joined !== null, "Expected joined session before heartbeat");

    await invokePrivateSendHeartbeat(service);

    assertEqual(capturedEvents.length, 1, "Expected one multiplayer:sessionExpired dispatch");
    assertEqual(capturedEvents[0].reason, "session_expired", "Expected expiry reason");
    assertEqual(capturedEvents[0].sessionId, "session-expired-case", "Expected expired session id");
    assertEqual(clearedReasons.length, 1, "Expected auth clear call");
    assertEqual(clearedReasons[0], "multiplayer_session_expired", "Expected auth clear reason");
    assertEqual(service.getActiveSession(), null, "Expected active session cleared");
  } finally {
    service.dispose();
    (
      backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession }
    ).joinMultiplayerSession = originalJoin;
    (
      backendApiService as {
        heartbeatMultiplayerSession: typeof backendApiService.heartbeatMultiplayerSession;
      }
    ).heartbeatMultiplayerSession = originalHeartbeat;
    (authSessionService as { clear: typeof authSessionService.clear }).clear = originalAuthClear;
    documentShim.restore();
  }
});

await test("does not expire session when heartbeat fails for non-expiry reason", async () => {
  const documentShim = installDocumentShim();
  const service = new MultiplayerSessionService("player-alpha");

  const originalJoin = backendApiService.joinMultiplayerSession.bind(backendApiService);
  const originalHeartbeat = backendApiService.heartbeatMultiplayerSession.bind(backendApiService);
  const originalAuthClear = authSessionService.clear.bind(authSessionService);

  let expiredEventCount = 0;
  let authClearCount = 0;
  documentShim.target.addEventListener("multiplayer:sessionExpired", () => {
    expiredEventCount += 1;
  });

  (backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession })
    .joinMultiplayerSession = async () => createSession({ sessionId: "session-non-expiry" });
  (backendApiService as { heartbeatMultiplayerSession: typeof backendApiService.heartbeatMultiplayerSession })
    .heartbeatMultiplayerSession = async () => ({ ok: false, reason: "unknown_player" });
  (authSessionService as { clear: typeof authSessionService.clear }).clear = () => {
    authClearCount += 1;
  };

  try {
    const joined = await service.joinSession("session-non-expiry");
    assert(joined !== null, "Expected joined session before heartbeat");

    await invokePrivateSendHeartbeat(service);

    assertEqual(expiredEventCount, 0, "Expected no expiry dispatch for non-expiry heartbeat failure");
    assertEqual(authClearCount, 0, "Expected no auth clear for non-expiry heartbeat failure");
    assert(service.getActiveSession() !== null, "Expected active session to remain");
  } finally {
    service.dispose();
    (
      backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession }
    ).joinMultiplayerSession = originalJoin;
    (
      backendApiService as {
        heartbeatMultiplayerSession: typeof backendApiService.heartbeatMultiplayerSession;
      }
    ).heartbeatMultiplayerSession = originalHeartbeat;
    (authSessionService as { clear: typeof authSessionService.clear }).clear = originalAuthClear;
    documentShim.restore();
  }
});

await test("refreshSessionAuth updates active session record", async () => {
  const service = new MultiplayerSessionService("player-alpha");

  const originalJoin = backendApiService.joinMultiplayerSession.bind(backendApiService);
  const originalRefresh = backendApiService.refreshMultiplayerSessionAuth.bind(backendApiService);

  (backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession })
    .joinMultiplayerSession = async () =>
      createSession({
        sessionId: "session-refresh",
        roomCode: "ROOM1",
      });
  (backendApiService as {
    refreshMultiplayerSessionAuth: typeof backendApiService.refreshMultiplayerSessionAuth;
  }).refreshMultiplayerSessionAuth = async () =>
    createSession({
      sessionId: "session-refresh",
      roomCode: "ROOM2",
      auth: {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: Date.now() + 60_000,
      },
    });

  try {
    const joined = await service.joinSession("session-refresh");
    assert(joined !== null, "Expected joined session before auth refresh");

    const refreshed = await service.refreshSessionAuth();
    assert(refreshed !== null, "Expected refreshed session");
    assertEqual(refreshed?.roomCode, "ROOM2", "Expected refreshed room code");
    assertEqual(service.getActiveSession()?.roomCode, "ROOM2", "Expected active session replacement");
  } finally {
    service.dispose();
    (
      backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession }
    ).joinMultiplayerSession = originalJoin;
    (
      backendApiService as {
        refreshMultiplayerSessionAuth: typeof backendApiService.refreshMultiplayerSessionAuth;
      }
    ).refreshMultiplayerSessionAuth = originalRefresh;
  }
});

console.log("\nMultiplayerSessionService tests passed! ✓");

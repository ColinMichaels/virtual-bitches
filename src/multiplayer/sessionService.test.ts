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
    .joinMultiplayerSession = async () => ({
      session: createSession({ sessionId: "session-expired-case" }),
    });
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
    .joinMultiplayerSession = async () => ({
      session: createSession({ sessionId: "session-non-expiry" }),
    });
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
      ({
        session: createSession({
          sessionId: "session-refresh",
          roomCode: "ROOM1",
        }),
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

await test("tracks room_full join failure reason", async () => {
  const service = new MultiplayerSessionService("player-alpha");
  const originalJoin = backendApiService.joinMultiplayerSession.bind(backendApiService);

  (backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession })
    .joinMultiplayerSession = async () => ({
      session: null,
      reason: "room_full",
      status: 409,
    });

  try {
    const joined = await service.joinSession("session-room-full");
    assertEqual(joined, null, "Expected join failure for full room");
    assertEqual(
      service.getLastJoinFailureReason(),
      "room_full",
      "Expected room_full join failure reason"
    );
  } finally {
    service.dispose();
    (
      backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession }
    ).joinMultiplayerSession = originalJoin;
  }
});

await test("passes unified gameConfig through create-session options", async () => {
  const service = new MultiplayerSessionService("player-alpha");
  const originalCreate = backendApiService.createMultiplayerSession.bind(backendApiService);
  const capturedRequests: Array<{
    playerId: string;
    gameConfig?: {
      mode?: string;
      automation?: {
        autoRun?: boolean;
      };
    };
  }> = [];

  (
    backendApiService as {
      createMultiplayerSession: typeof backendApiService.createMultiplayerSession;
    }
  ).createMultiplayerSession = async (request) => {
    capturedRequests.push({
      playerId: request.playerId,
      gameConfig: request.gameConfig,
    });
    return createSession({
      sessionId: "session-create-config",
      roomCode: "CFG001",
    });
  };

  try {
    const created = await service.createSession({
      gameDifficulty: "hard",
      botCount: 3,
      gameConfig: {
        mode: "demo",
        difficulty: "hard",
        timingProfile: "demo_fast",
        capabilities: {
          chaos: false,
          gifting: false,
          moderation: true,
          banning: true,
          hostControls: true,
          privateChat: true,
        },
        automation: {
          enabled: true,
          autoRun: true,
          botCount: 3,
          speedMode: "fast",
        },
      },
    });
    assert(created !== null, "Expected create-session success");
    assertEqual(capturedRequests.length, 1, "Expected one create-session request");
    assertEqual(capturedRequests[0]?.playerId, "player-alpha", "Expected player id passthrough");
    assertEqual(capturedRequests[0]?.gameConfig?.mode, "demo", "Expected gameConfig mode passthrough");
    assertEqual(
      capturedRequests[0]?.gameConfig?.automation?.autoRun,
      true,
      "Expected gameConfig automation.autoRun passthrough"
    );
  } finally {
    service.dispose();
    (
      backendApiService as {
        createMultiplayerSession: typeof backendApiService.createMultiplayerSession;
      }
    ).createMultiplayerSession = originalCreate;
  }
});

await test("passes botCount through join options for bot seeding", async () => {
  const service = new MultiplayerSessionService("player-alpha");
  const originalJoin = backendApiService.joinMultiplayerSession.bind(backendApiService);
  const capturedRequests: Array<{ playerId: string; botCount?: number }> = [];

  (backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession })
    .joinMultiplayerSession = async (_sessionId, request) => {
      capturedRequests.push({
        playerId: request.playerId,
        botCount: request.botCount,
      });
      return {
        session: createSession({
          sessionId: "session-bot-seed",
          roomCode: "BOTSEED",
        }),
      };
    };

  try {
    const joined = await service.joinSession("session-bot-seed", { botCount: 2 });
    assert(joined !== null, "Expected join success");
    assertEqual(capturedRequests.length, 1, "Expected one join call");
    assertEqual(capturedRequests[0].playerId, "player-alpha", "Expected player id passthrough");
    assertEqual(capturedRequests[0].botCount, 2, "Expected botCount passthrough");
  } finally {
    service.dispose();
    (
      backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession }
    ).joinMultiplayerSession = originalJoin;
  }
});

await test("joins by room code and tracks room_not_found failures", async () => {
  const service = new MultiplayerSessionService("player-alpha");
  const originalJoinByCode = backendApiService.joinMultiplayerRoomByCode.bind(backendApiService);
  const capturedRequests: Array<{ playerId: string; gameDifficulty?: string }> = [];

  let callCount = 0;
  (
    backendApiService as {
      joinMultiplayerRoomByCode: typeof backendApiService.joinMultiplayerRoomByCode;
    }
  ).joinMultiplayerRoomByCode = async (_roomCode, request) => {
    capturedRequests.push({
      playerId: request.playerId,
      gameDifficulty: request.gameDifficulty,
    });
    callCount += 1;
    if (callCount === 1) {
      return {
        session: createSession({
          sessionId: "session-by-code",
          roomCode: "AB12CD",
        }),
      };
    }
    return {
      session: null,
      reason: "room_not_found",
      status: 404,
    };
  };

  try {
    const joined = await service.joinRoomByCode("ab12cd", { gameDifficulty: "hard" });
    assert(joined !== null, "Expected room-code join success");
    assertEqual(joined?.sessionId, "session-by-code", "Expected joined room-code session");
    assertEqual(service.getLastJoinFailureReason(), null, "Expected no join failure after success");
    assertEqual(capturedRequests[0]?.playerId, "player-alpha", "Expected room-code join player id");
    assertEqual(capturedRequests[0]?.gameDifficulty, "hard", "Expected room-code gameDifficulty passthrough");

    const missing = await service.joinRoomByCode("missing");
    assertEqual(missing, null, "Expected room-code join failure");
    assertEqual(
      service.getLastJoinFailureReason(),
      "room_not_found",
      "Expected room_not_found join failure reason"
    );
  } finally {
    service.dispose();
    (
      backendApiService as {
        joinMultiplayerRoomByCode: typeof backendApiService.joinMultiplayerRoomByCode;
      }
    ).joinMultiplayerRoomByCode = originalJoinByCode;
  }
});

await test("queueForNextGame syncs updated session state", async () => {
  const service = new MultiplayerSessionService("player-alpha");
  const originalJoin = backendApiService.joinMultiplayerSession.bind(backendApiService);
  const originalQueue = backendApiService.queueMultiplayerForNextGame.bind(backendApiService);
  const expectedNextGameStartsAt = Date.now() + 60000;

  (backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession })
    .joinMultiplayerSession = async () => ({
      session: createSession({
        sessionId: "session-queue",
        roomCode: "ROOM1",
        participants: [
          {
            playerId: "player-alpha",
            displayName: "Alpha",
            score: 0,
            remainingDice: 6,
            isComplete: false,
            isReady: true,
            queuedForNextGame: false,
            joinedAt: Date.now(),
            lastHeartbeatAt: Date.now(),
          },
        ],
        standings: [],
        sessionComplete: true,
      }),
    });
  (
    backendApiService as {
      queueMultiplayerForNextGame: typeof backendApiService.queueMultiplayerForNextGame;
    }
  ).queueMultiplayerForNextGame = async () => {
    return {
      ok: true,
      queuedForNextGame: true,
      session: {
        sessionId: "session-queue",
        roomCode: "ROOM2",
        createdAt: Date.now(),
        participants: [
          {
            playerId: "player-alpha",
            displayName: "Alpha",
            score: 0,
            remainingDice: 6,
            isComplete: false,
            isReady: true,
            queuedForNextGame: true,
            joinedAt: Date.now(),
            lastHeartbeatAt: Date.now(),
          },
        ],
        standings: [],
        sessionComplete: true,
        completedAt: Date.now(),
        gameStartedAt: Date.now(),
        nextGameStartsAt: expectedNextGameStartsAt,
        nextGameAutoStartDelayMs: 60000,
        expiresAt: Date.now() + 120000,
        serverNow: Date.now(),
      },
    };
  };

  try {
    const joined = await service.joinSession("session-queue");
    assert(joined !== null, "Expected joined session before queue-for-next");

    const queued = await service.queueForNextGame();
    assert(queued !== null, "Expected queued session");
    assertEqual(queued?.roomCode, "ROOM2", "Expected queued state room code update");
    assertEqual(
      queued?.participants?.[0]?.queuedForNextGame,
      true,
      "Expected local participant queued-for-next flag"
    );
    assertEqual(
      queued?.nextGameStartsAt,
      expectedNextGameStartsAt,
      "Expected queued state next-game start timestamp sync"
    );
    assertEqual(
      queued?.nextGameAutoStartDelayMs,
      60000,
      "Expected queued state next-game delay sync"
    );
  } finally {
    service.dispose();
    (
      backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession }
    ).joinMultiplayerSession = originalJoin;
    (
      backendApiService as {
        queueMultiplayerForNextGame: typeof backendApiService.queueMultiplayerForNextGame;
      }
    ).queueMultiplayerForNextGame = originalQueue;
  }
});

await test("updateParticipantState syncs sit/ready state changes", async () => {
  const service = new MultiplayerSessionService("player-alpha");
  const originalJoin = backendApiService.joinMultiplayerSession.bind(backendApiService);
  const originalUpdate = backendApiService.updateMultiplayerParticipantState.bind(backendApiService);

  (backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession })
    .joinMultiplayerSession = async () => ({
      session: createSession({
        sessionId: "session-seat-state",
        roomCode: "ROOMS1",
        participants: [
          {
            playerId: "player-alpha",
            displayName: "Alpha",
            isSeated: false,
            isReady: false,
            queuedForNextGame: false,
            joinedAt: Date.now(),
            lastHeartbeatAt: Date.now(),
          },
        ],
      }),
    });
  (
    backendApiService as {
      updateMultiplayerParticipantState: typeof backendApiService.updateMultiplayerParticipantState;
    }
  ).updateMultiplayerParticipantState = async () => ({
    ok: true,
    reason: "ok",
    state: {
      isSeated: true,
      isReady: true,
      queuedForNextGame: false,
    },
    session: {
      sessionId: "session-seat-state",
      roomCode: "ROOMS1",
      createdAt: Date.now(),
      participants: [
        {
          playerId: "player-alpha",
          displayName: "Alpha",
          isSeated: true,
          isReady: true,
          queuedForNextGame: false,
          joinedAt: Date.now(),
          lastHeartbeatAt: Date.now(),
        },
      ],
    },
  });

  try {
    const joined = await service.joinSession("session-seat-state");
    assert(joined !== null, "Expected joined session before participant-state update");

    const updated = await service.updateParticipantState("ready");
    assert(updated !== null, "Expected updated session response");
    assertEqual(updated?.participants?.[0]?.isSeated, true, "Expected updated seated state");
    assertEqual(updated?.participants?.[0]?.isReady, true, "Expected updated ready state");
  } finally {
    service.dispose();
    (
      backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession }
    ).joinMultiplayerSession = originalJoin;
    (
      backendApiService as {
        updateMultiplayerParticipantState: typeof backendApiService.updateMultiplayerParticipantState;
      }
    ).updateMultiplayerParticipantState = originalUpdate;
  }
});

await test("queueForNextGame expires active session when API reports session_expired", async () => {
  const documentShim = installDocumentShim();
  const service = new MultiplayerSessionService("player-alpha");
  const originalJoin = backendApiService.joinMultiplayerSession.bind(backendApiService);
  const originalQueue = backendApiService.queueMultiplayerForNextGame.bind(backendApiService);
  const originalAuthClear = authSessionService.clear.bind(authSessionService);

  const capturedEvents: Array<{ reason?: string; sessionId?: string }> = [];
  const clearedReasons: string[] = [];
  documentShim.target.addEventListener("multiplayer:sessionExpired", (event: Event) => {
    const detail = (event as CustomEvent<{ reason?: string; sessionId?: string }>).detail;
    capturedEvents.push(detail ?? {});
  });
  (authSessionService as { clear: typeof authSessionService.clear }).clear = (reason?: string) => {
    clearedReasons.push(reason ?? "");
  };

  (backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession })
    .joinMultiplayerSession = async () => ({
      session: createSession({
        sessionId: "session-queue-expired",
        roomCode: "ROOMX",
      }),
    });
  (
    backendApiService as {
      queueMultiplayerForNextGame: typeof backendApiService.queueMultiplayerForNextGame;
    }
  ).queueMultiplayerForNextGame = async () => ({
    ok: false,
    queuedForNextGame: false,
    reason: "session_expired",
  });

  try {
    const joined = await service.joinSession("session-queue-expired");
    assert(joined !== null, "Expected joined session before queue-for-next");

    const queued = await service.queueForNextGame();
    assertEqual(queued, null, "Expected null queue result on session expiry");
    assertEqual(capturedEvents.length, 1, "Expected one expiry dispatch");
    assertEqual(capturedEvents[0].reason, "session_expired", "Expected session_expired reason");
    assertEqual(capturedEvents[0].sessionId, "session-queue-expired", "Expected expired session id");
    assertEqual(clearedReasons[0], "multiplayer_session_expired", "Expected auth clear reason");
    assertEqual(service.getActiveSession(), null, "Expected active session cleared");
  } finally {
    service.dispose();
    (
      backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession }
    ).joinMultiplayerSession = originalJoin;
    (
      backendApiService as {
        queueMultiplayerForNextGame: typeof backendApiService.queueMultiplayerForNextGame;
      }
    ).queueMultiplayerForNextGame = originalQueue;
    (authSessionService as { clear: typeof authSessionService.clear }).clear = originalAuthClear;
    documentShim.restore();
  }
});

await test("updateDemoControls syncs host demo session flags", async () => {
  const service = new MultiplayerSessionService("player-alpha");
  const originalJoin = backendApiService.joinMultiplayerSession.bind(backendApiService);
  const originalDemoControls =
    backendApiService.updateMultiplayerDemoControls.bind(backendApiService);

  (backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession })
    .joinMultiplayerSession = async () => ({
      session: createSession({
        sessionId: "session-demo-controls",
        roomCode: "DEMO42",
        demoMode: true,
        demoAutoRun: true,
        demoSpeedMode: true,
        ownerPlayerId: "player-alpha",
      }),
    });
  (
    backendApiService as {
      updateMultiplayerDemoControls: typeof backendApiService.updateMultiplayerDemoControls;
    }
  ).updateMultiplayerDemoControls = async () => ({
    ok: true,
    controls: {
      demoMode: true,
      demoAutoRun: false,
      demoSpeedMode: false,
    },
    session: createSession({
      sessionId: "session-demo-controls",
      roomCode: "DEMO42",
      demoMode: true,
      demoAutoRun: false,
      demoSpeedMode: false,
      ownerPlayerId: "player-alpha",
    }),
  });

  try {
    const joined = await service.joinSession("session-demo-controls");
    assert(joined !== null, "Expected joined demo session");

    const updated = await service.updateDemoControls("pause");
    assert(updated !== null, "Expected updated demo session");
    assertEqual(updated?.demoMode, true, "Expected demoMode=true");
    assertEqual(updated?.demoAutoRun, false, "Expected demoAutoRun=false after pause");
    assertEqual(updated?.demoSpeedMode, false, "Expected demoSpeedMode=false after response sync");
  } finally {
    service.dispose();
    (
      backendApiService as { joinMultiplayerSession: typeof backendApiService.joinMultiplayerSession }
    ).joinMultiplayerSession = originalJoin;
    (
      backendApiService as {
        updateMultiplayerDemoControls: typeof backendApiService.updateMultiplayerDemoControls;
      }
    ).updateMultiplayerDemoControls = originalDemoControls;
  }
});

console.log("\nMultiplayerSessionService tests passed! ✓");

import assert from "node:assert/strict";
import { createSessionRehydrateService } from "./sessionRehydrateService.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createFixture(options = {}) {
  const store =
    options.store ?? {
      multiplayerSessions: {},
    };
  const calls = {
    rehydrateStore: [],
    sleep: [],
  };

  const service = createSessionRehydrateService({
    getStore: () => store,
    rehydrateStoreFromAdapter: async (reason, metadata) => {
      calls.rehydrateStore.push({ reason, metadata });
      if (typeof options.rehydrateStoreFromAdapter === "function") {
        await options.rehydrateStoreFromAdapter({ reason, metadata, store, calls });
      }
    },
    sleep: async (durationMs) => {
      calls.sleep.push(durationMs);
      if (typeof options.sleep === "function") {
        await options.sleep(durationMs);
      }
    },
  });

  return {
    service,
    store,
    calls,
  };
}

test("rehydrateSessionWithRetry returns null for invalid session id", async () => {
  const fixture = createFixture();
  const result = await fixture.service.rehydrateSessionWithRetry("", "test");

  assert.equal(result, null);
  assert.equal(fixture.calls.rehydrateStore.length, 0);
});

test("rehydrateSessionWithRetry returns existing session without rehydrate", async () => {
  const fixture = createFixture({
    store: {
      multiplayerSessions: {
        "session-1": { sessionId: "session-1" },
      },
    },
  });

  const result = await fixture.service.rehydrateSessionWithRetry("session-1", "existing");

  assert.deepEqual(result, { sessionId: "session-1" });
  assert.equal(fixture.calls.rehydrateStore.length, 0);
});

test("rehydrateSessionWithRetry retries with backoff and returns recovered session", async () => {
  const fixture = createFixture({
    rehydrateStoreFromAdapter: async ({ reason, store }) => {
      if (reason.endsWith("attempt_2")) {
        store.multiplayerSessions["session-2"] = { sessionId: "session-2", restored: true };
      }
    },
  });

  const result = await fixture.service.rehydrateSessionWithRetry("session-2", "join", {
    attempts: 4,
    baseDelayMs: 50,
  });

  assert.deepEqual(result, { sessionId: "session-2", restored: true });
  assert.deepEqual(
    fixture.calls.rehydrateStore.map((entry) => entry.reason),
    ["join:session-2:attempt_1", "join:session-2:attempt_2"]
  );
  assert.deepEqual(fixture.calls.sleep, [50]);
});

test("rehydrateSessionParticipantWithRetry returns null payload for invalid identifiers", async () => {
  const fixture = createFixture();

  const result = await fixture.service.rehydrateSessionParticipantWithRetry("session-1", "", "reason");

  assert.deepEqual(result, {
    session: null,
    participant: null,
  });
  assert.equal(fixture.calls.rehydrateStore.length, 0);
});

test("rehydrateSessionParticipantWithRetry returns existing participant immediately", async () => {
  const fixture = createFixture({
    store: {
      multiplayerSessions: {
        "session-1": {
          sessionId: "session-1",
          participants: {
            "player-1": { playerId: "player-1" },
          },
        },
      },
    },
  });

  const result = await fixture.service.rehydrateSessionParticipantWithRetry(
    "session-1",
    "player-1",
    "heartbeat"
  );

  assert.equal(result.session?.sessionId, "session-1");
  assert.equal(result.participant?.playerId, "player-1");
  assert.equal(fixture.calls.rehydrateStore.length, 0);
});

test("rehydrateSessionParticipantWithRetry retries and recovers participant", async () => {
  const fixture = createFixture({
    rehydrateStoreFromAdapter: async ({ reason, store }) => {
      if (reason.endsWith("attempt_3")) {
        store.multiplayerSessions["session-3"] = {
          sessionId: "session-3",
          participants: {
            "player-3": { playerId: "player-3", restored: true },
          },
        };
      }
    },
  });

  const result = await fixture.service.rehydrateSessionParticipantWithRetry(
    "session-3",
    "player-3",
    "refresh",
    {
      attempts: 4,
      baseDelayMs: 40,
    }
  );

  assert.equal(result.session?.sessionId, "session-3");
  assert.equal(result.participant?.playerId, "player-3");
  assert.equal(result.participant?.restored, true);
  assert.deepEqual(
    fixture.calls.rehydrateStore.map((entry) => entry.reason),
    [
      "refresh:session-3:player-3:attempt_1",
      "refresh:session-3:player-3:attempt_2",
      "refresh:session-3:player-3:attempt_3",
    ]
  );
  assert.deepEqual(fixture.calls.sleep, [40, 80]);
});

test("rehydrateSessionParticipantWithRetry returns unresolved participant after retries", async () => {
  const fixture = createFixture({
    store: {
      multiplayerSessions: {
        "session-4": {
          sessionId: "session-4",
          participants: {},
        },
      },
    },
  });

  const result = await fixture.service.rehydrateSessionParticipantWithRetry(
    "session-4",
    "player-4",
    "refresh",
    {
      attempts: 2,
      baseDelayMs: 25,
    }
  );

  assert.equal(result.session?.sessionId, "session-4");
  assert.equal(result.participant, null);
  assert.deepEqual(
    fixture.calls.rehydrateStore.map((entry) => entry.reason),
    ["refresh:session-4:player-4:attempt_1", "refresh:session-4:player-4:attempt_2"]
  );
  assert.deepEqual(fixture.calls.sleep, [25]);
});

async function run() {
  let passed = 0;
  for (const entry of tests) {
    await entry.fn();
    passed += 1;
    console.log(`\u2713 ${entry.name}`);
  }
  console.log(`All sessionRehydrateService tests passed (${passed}).`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

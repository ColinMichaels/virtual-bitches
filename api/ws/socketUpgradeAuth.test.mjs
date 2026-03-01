import assert from "node:assert/strict";
import { createSocketUpgradeAuthenticator } from "./socketUpgradeAuth.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createRequestUrl({ sessionId, playerId, token }) {
  const url = new URL("http://localhost/");
  if (sessionId !== undefined) {
    url.searchParams.set("session", sessionId);
  }
  if (playerId !== undefined) {
    url.searchParams.set("playerId", playerId);
  }
  if (token !== undefined) {
    url.searchParams.set("token", token);
  }
  return url;
}

function createFixture(overrides = {}) {
  const sessions = new Map(Object.entries(overrides.sessions ?? {}));
  const tokens = new Map(Object.entries(overrides.tokens ?? {}));
  let currentNow = overrides.now ?? 1_700_000_000_000;

  const calls = {
    rehydrate: [],
    markSessionActivity: [],
    persistStore: 0,
    warns: [],
  };

  const authenticateSocketUpgrade = createSocketUpgradeAuthenticator({
    getSession: (sessionId) => sessions.get(sessionId) ?? null,
    rehydrateStoreFromAdapter: async (reason, options) => {
      calls.rehydrate.push({ reason, options });
      if (typeof overrides.onRehydrate === "function") {
        await overrides.onRehydrate({ reason, options, sessions, tokens });
      }
    },
    verifyAccessToken: (token) => tokens.get(token) ?? null,
    isPlayerBannedFromSession:
      overrides.isPlayerBannedFromSession ??
      (() => false),
    isBotParticipant:
      overrides.isBotParticipant ??
      ((participant) => participant?.type === "bot"),
    markSessionActivity: (...args) => {
      calls.markSessionActivity.push(args);
    },
    persistStore: () => {
      calls.persistStore += 1;
      return Promise.resolve();
    },
    sessionUpgradeGraceMs: overrides.sessionUpgradeGraceMs ?? 15_000,
    now: () => currentNow,
    log: {
      warn: (...args) => calls.warns.push(args),
    },
  });

  return {
    sessions,
    tokens,
    calls,
    authenticateSocketUpgrade,
    setNow: (nextNow) => {
      currentNow = nextNow;
    },
  };
}

test("rejects upgrades missing required auth fields", async () => {
  const fixture = createFixture();
  const result = await fixture.authenticateSocketUpgrade(
    createRequestUrl({ sessionId: "session-1", playerId: "player-1" })
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("rejects missing sessions after forced rehydrate", async () => {
  const fixture = createFixture();
  const result = await fixture.authenticateSocketUpgrade(
    createRequestUrl({ sessionId: "session-404", playerId: "player-1", token: "token-1" })
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 410);
  assert.equal(fixture.calls.rehydrate.length, 1);
  assert.equal(fixture.calls.rehydrate[0].reason, "ws_upgrade_session:session-404");
});

test("rejects banned players", async () => {
  const fixture = createFixture({
    sessions: {
      "session-1": {
        sessionId: "session-1",
        expiresAt: 1_700_000_010_000,
        participants: {
          "player-1": { type: "human", lastHeartbeatAt: 0 },
        },
      },
    },
    isPlayerBannedFromSession: () => true,
  });
  const result = await fixture.authenticateSocketUpgrade(
    createRequestUrl({ sessionId: "session-1", playerId: "player-1", token: "token-1" })
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test("rehydrates participant and token records before accepting", async () => {
  const fixture = createFixture({
    sessions: {
      "session-1": {
        sessionId: "session-1",
        expiresAt: 1_700_000_010_000,
        participants: {},
      },
    },
    onRehydrate: async ({ reason, sessions, tokens }) => {
      if (reason === "ws_upgrade_participant:session-1:player-1") {
        const session = sessions.get("session-1");
        session.participants["player-1"] = { type: "human", lastHeartbeatAt: 0 };
      }
      if (reason === "ws_upgrade_token:session-1:player-1") {
        tokens.set("token-1", {
          sessionId: "session-1",
          playerId: "player-1",
          expiresAt: 1_700_000_050_000,
        });
      }
    },
  });

  const result = await fixture.authenticateSocketUpgrade(
    createRequestUrl({ sessionId: "session-1", playerId: "player-1", token: "token-1" })
  );
  assert.equal(result.ok, true);
  assert.equal(result.playerId, "player-1");
  assert.equal(result.sessionId, "session-1");
});

test("rejects session/token mismatches", async () => {
  const fixture = createFixture({
    sessions: {
      "session-1": {
        sessionId: "session-1",
        expiresAt: 1_700_000_010_000,
        participants: {
          "player-1": { type: "human", lastHeartbeatAt: 0 },
        },
      },
    },
    tokens: {
      "token-1": {
        sessionId: "session-2",
        playerId: "player-1",
        expiresAt: 1_700_000_050_000,
      },
    },
  });
  const result = await fixture.authenticateSocketUpgrade(
    createRequestUrl({ sessionId: "session-1", playerId: "player-1", token: "token-1" })
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test("rejects expired sessions beyond grace and revives within grace", async () => {
  const fixture = createFixture({
    now: 1_700_000_010_000,
    sessionUpgradeGraceMs: 10_000,
    sessions: {
      "session-expired": {
        sessionId: "session-expired",
        expiresAt: 1_699_999_999_000,
        participants: {
          "player-1": { type: "human", lastHeartbeatAt: 0 },
        },
      },
      "session-grace": {
        sessionId: "session-grace",
        expiresAt: 1_700_000_009_500,
        participants: {
          "player-1": { type: "human", lastHeartbeatAt: 0 },
        },
      },
    },
    tokens: {
      "token-expired": {
        sessionId: "session-expired",
        playerId: "player-1",
        expiresAt: 1_700_000_050_000,
      },
      "token-grace": {
        sessionId: "session-grace",
        playerId: "player-1",
        expiresAt: 1_700_000_050_000,
      },
    },
  });

  const expiredResult = await fixture.authenticateSocketUpgrade(
    createRequestUrl({
      sessionId: "session-expired",
      playerId: "player-1",
      token: "token-expired",
    })
  );
  assert.equal(expiredResult.ok, false);
  assert.equal(expiredResult.status, 410);

  const graceResult = await fixture.authenticateSocketUpgrade(
    createRequestUrl({
      sessionId: "session-grace",
      playerId: "player-1",
      token: "token-grace",
    })
  );
  assert.equal(graceResult.ok, true);
  assert.equal(fixture.calls.markSessionActivity.length, 1);
  assert.equal(fixture.calls.persistStore, 1);
  assert.equal(
    fixture.sessions.get("session-grace").participants["player-1"].lastHeartbeatAt,
    1_700_000_010_000
  );
});

async function run() {
  let failures = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${name}`);
      console.error(error);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`All socketUpgradeAuth tests passed (${tests.length}).`);
}

await run();

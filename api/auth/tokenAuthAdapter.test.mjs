import assert from "node:assert/strict";
import { createTokenAuthAdapter } from "./tokenAuthAdapter.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createFixture(options = {}) {
  let nowValue = options.now ?? 1_000;
  const store =
    options.store ?? {
      accessTokens: {},
      refreshTokens: {},
    };

  const tokenQueue = [...(options.tokenQueue ?? ["access-token", "refresh-token", "token-3"])] ;

  const adapter = createTokenAuthAdapter({
    getStore: () => store,
    accessTokenTtlMs: options.accessTokenTtlMs ?? 100,
    refreshTokenTtlMs: options.refreshTokenTtlMs ?? 500,
    now: () => nowValue,
    generateToken: () => {
      if (tokenQueue.length === 0) {
        return `token-${Math.random()}`;
      }
      return tokenQueue.shift();
    },
  });

  return {
    adapter,
    store,
    setNow: (value) => {
      nowValue = value;
    },
  };
}

test("issueAuthTokenBundle stores hashed access+refresh records", () => {
  const fixture = createFixture();

  const bundle = fixture.adapter.issueAuthTokenBundle("player-1", "session-1");

  assert.equal(bundle.accessToken, "access-token");
  assert.equal(bundle.refreshToken, "refresh-token");
  assert.equal(bundle.expiresAt, 1_100);
  assert.equal(bundle.tokenType, "Bearer");
  assert.equal(Object.keys(fixture.store.accessTokens).length, 1);
  assert.equal(Object.keys(fixture.store.refreshTokens).length, 1);
});

test("verifyAccessToken returns record and evicts expired entries", () => {
  const fixture = createFixture();
  const bundle = fixture.adapter.issueAuthTokenBundle("player-2", "session-2");

  const active = fixture.adapter.verifyAccessToken(bundle.accessToken);
  assert(active, "expected access token record");
  assert.equal(active.playerId, "player-2");

  fixture.setNow(2_000);
  const expired = fixture.adapter.verifyAccessToken(bundle.accessToken);
  assert.equal(expired, null);
  assert.equal(Object.keys(fixture.store.accessTokens).length, 0);
});

test("verifyRefreshToken returns null for missing token", () => {
  const fixture = createFixture();

  const result = fixture.adapter.verifyRefreshToken("missing");

  assert.equal(result, null);
});

test("revokeRefreshToken removes valid token hash", () => {
  const fixture = createFixture();
  const bundle = fixture.adapter.issueAuthTokenBundle("player-3", "session-3");

  const revoked = fixture.adapter.revokeRefreshToken(bundle.refreshToken);

  assert.equal(revoked, true);
  assert.equal(Object.keys(fixture.store.refreshTokens).length, 0);
});

test("extractBearerToken handles case-insensitive bearer prefix", () => {
  const fixture = createFixture();

  assert.equal(fixture.adapter.extractBearerToken("Bearer abc"), "abc");
  assert.equal(fixture.adapter.extractBearerToken("bearer   xyz  "), "xyz");
  assert.equal(fixture.adapter.extractBearerToken("Basic nope"), "");
  assert.equal(fixture.adapter.extractBearerToken(undefined), "");
});

test("adapter repairs malformed token maps in store", () => {
  const fixture = createFixture({
    store: {
      accessTokens: null,
      refreshTokens: "bad",
    },
  });

  const bundle = fixture.adapter.issueAuthTokenBundle("player-4", "session-4");
  const verified = fixture.adapter.verifyAccessToken(bundle.accessToken);

  assert(verified, "expected verification from repaired token map");
  assert.equal(typeof fixture.store.accessTokens, "object");
  assert.equal(typeof fixture.store.refreshTokens, "object");
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

  console.log(`All tokenAuthAdapter tests passed (${tests.length}).`);
}

await run();

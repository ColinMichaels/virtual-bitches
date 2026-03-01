import assert from "node:assert/strict";
import { createRequestAuthorizer } from "./requestAuthorizer.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createFixture(options = {}) {
  const calls = {
    verifyAccessToken: [],
    verifyFirebaseIdToken: [],
    normalizeAvatarUrl: [],
    normalizeProviderId: [],
  };
  const accessTokenRecords = options.accessTokenRecords ?? {};
  const firebaseResult =
    options.firebaseResult ??
    {
      ok: true,
      claims: {
        uid: "uid-1",
        name: "Player One",
        email: "player@example.com",
        picture: "https://avatar.example.com/u/1.png",
        isAnonymous: false,
        signInProvider: "password",
      },
    };

  const requestAuthorizer = createRequestAuthorizer({
    extractBearerToken: (header) => {
      const source = typeof header === "string" ? header : "";
      const match = source.match(/^Bearer\s+(.+)$/i);
      return match ? match[1].trim() : "";
    },
    verifyAccessToken: (token) => {
      calls.verifyAccessToken.push(token);
      return accessTokenRecords[token] ?? null;
    },
    verifyFirebaseIdToken: async (token) => {
      calls.verifyFirebaseIdToken.push(token);
      return firebaseResult;
    },
    normalizeAvatarUrl: (value) => {
      calls.normalizeAvatarUrl.push(value);
      return typeof value === "string" ? value.trim() : value;
    },
    normalizeProviderId: (value) => {
      calls.normalizeProviderId.push(value);
      return typeof value === "string" ? value.trim().toLowerCase() : value;
    },
  });

  return {
    requestAuthorizer,
    calls,
  };
}

test("authorizeIdentityRequest rejects missing authorization header", async () => {
  const fixture = createFixture();

  const result = await fixture.requestAuthorizer.authorizeIdentityRequest({ headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_authorization_header");
});

test("authorizeIdentityRequest rejects invalid bearer header", async () => {
  const fixture = createFixture();

  const result = await fixture.requestAuthorizer.authorizeIdentityRequest({
    headers: { authorization: "Basic abc123" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_bearer_header");
});

test("authorizeIdentityRequest accepts session token when allowed", async () => {
  const fixture = createFixture({
    accessTokenRecords: {
      "session-token": {
        playerId: "player-1",
        sessionId: "session-1",
      },
    },
  });

  const result = await fixture.requestAuthorizer.authorizeIdentityRequest(
    { headers: { authorization: "Bearer session-token" } },
    { allowSessionToken: true }
  );

  assert.equal(result.ok, true);
  assert.equal(result.uid, "local:player-1");
  assert.equal(result.provider, "session");
  assert.equal(fixture.calls.verifyFirebaseIdToken.length, 0);
});

test("authorizeIdentityRequest falls back to firebase verification", async () => {
  const fixture = createFixture();

  const result = await fixture.requestAuthorizer.authorizeIdentityRequest(
    { headers: { authorization: "Bearer firebase-token" } },
    { allowSessionToken: true }
  );

  assert.equal(result.ok, true);
  assert.equal(result.uid, "uid-1");
  assert.equal(result.provider, "firebase");
  assert.equal(result.providerId, "password");
  assert.equal(result.photoUrl, "https://avatar.example.com/u/1.png");
  assert.equal(fixture.calls.verifyFirebaseIdToken.length, 1);
  assert.equal(fixture.calls.normalizeAvatarUrl.length, 1);
  assert.equal(fixture.calls.normalizeProviderId.length, 1);
});

test("authorizeIdentityRequest blocks anonymous identities when required", async () => {
  const fixture = createFixture({
    firebaseResult: {
      ok: true,
      claims: {
        uid: "anon-1",
        name: "Anonymous",
        email: undefined,
        picture: undefined,
        isAnonymous: true,
        signInProvider: "anonymous",
      },
    },
  });

  const result = await fixture.requestAuthorizer.authorizeIdentityRequest(
    { headers: { authorization: "Bearer anon-token" } },
    { requireNonAnonymous: true }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "anonymous_not_allowed");
});

test("authorizeRequest allows missing authorization header and validates match checks", () => {
  const fixture = createFixture({
    accessTokenRecords: {
      "access-1": {
        playerId: "player-1",
        sessionId: "session-1",
      },
    },
  });

  const missing = fixture.requestAuthorizer.authorizeRequest({ headers: {} });
  const mismatchPlayer = fixture.requestAuthorizer.authorizeRequest(
    { headers: { authorization: "Bearer access-1" } },
    "player-2",
    "session-1"
  );
  const mismatchSession = fixture.requestAuthorizer.authorizeRequest(
    { headers: { authorization: "Bearer access-1" } },
    "player-1",
    "session-9"
  );
  const ok = fixture.requestAuthorizer.authorizeRequest(
    { headers: { authorization: "Bearer access-1" } },
    "player-1",
    "session-1"
  );

  assert.equal(missing.ok, true);
  assert.equal(mismatchPlayer.ok, false);
  assert.equal(mismatchSession.ok, false);
  assert.equal(ok.ok, true);
  assert.equal(ok.playerId, "player-1");
  assert.equal(ok.sessionId, "session-1");
});

test("authorizeSessionActionRequest returns explicit failure reasons", () => {
  const fixture = createFixture({
    accessTokenRecords: {
      "access-2": {
        playerId: "player-2",
        sessionId: "session-2",
      },
    },
  });

  const missing = fixture.requestAuthorizer.authorizeSessionActionRequest({ headers: {} });
  const badHeader = fixture.requestAuthorizer.authorizeSessionActionRequest({
    headers: { authorization: "Token access-2" },
  });
  const invalidToken = fixture.requestAuthorizer.authorizeSessionActionRequest({
    headers: { authorization: "Bearer access-missing" },
  });
  const playerMismatch = fixture.requestAuthorizer.authorizeSessionActionRequest(
    { headers: { authorization: "Bearer access-2" } },
    "player-9",
    "session-2"
  );
  const sessionMismatch = fixture.requestAuthorizer.authorizeSessionActionRequest(
    { headers: { authorization: "Bearer access-2" } },
    "player-2",
    "session-9"
  );
  const ok = fixture.requestAuthorizer.authorizeSessionActionRequest(
    { headers: { authorization: "Bearer access-2" } },
    "player-2",
    "session-2"
  );

  assert.equal(missing.reason, "missing_authorization_header");
  assert.equal(badHeader.reason, "invalid_bearer_header");
  assert.equal(invalidToken.reason, "invalid_or_expired_access_token");
  assert.equal(playerMismatch.reason, "player_mismatch");
  assert.equal(sessionMismatch.reason, "session_mismatch");
  assert.equal(ok.ok, true);
});

test("shouldRetrySessionAuthFromStore only retries token/session mismatch reasons", () => {
  const fixture = createFixture();

  assert.equal(
    fixture.requestAuthorizer.shouldRetrySessionAuthFromStore("invalid_or_expired_access_token"),
    true
  );
  assert.equal(fixture.requestAuthorizer.shouldRetrySessionAuthFromStore("player_mismatch"), true);
  assert.equal(fixture.requestAuthorizer.shouldRetrySessionAuthFromStore("session_mismatch"), true);
  assert.equal(
    fixture.requestAuthorizer.shouldRetrySessionAuthFromStore("missing_authorization_header"),
    false
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

  console.log(`All requestAuthorizer tests passed (${tests.length}).`);
}

await run();

import assert from "node:assert/strict";
import { createFirebaseIdentityVerifier } from "./firebaseIdentityVerifier.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

function createFixture(options = {}) {
  let nowValue = options.now ?? 1_000;
  const calls = {
    adminVerify: 0,
    adminResolve: 0,
    fetch: 0,
    warn: [],
    error: [],
  };

  const adminClient =
    options.adminClient ??
    {
      verifyIdToken: async () => {
        calls.adminVerify += 1;
        return {
          uid: "uid-admin",
          email: "admin@example.com",
          firebase: { sign_in_provider: "password" },
          exp: 2_000,
        };
      },
    };

  const verifier = createFirebaseIdentityVerifier({
    firebaseAuthMode: options.firebaseAuthMode ?? "auto",
    firebaseProjectId: options.firebaseProjectId ?? "",
    firebaseWebApiKey: options.firebaseWebApiKey ?? "api-key",
    serviceAccountJson: options.serviceAccountJson ?? "",
    fetchImpl:
      options.fetchImpl ??
      (async () => {
        calls.fetch += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              users: [
                {
                  localId: "uid-legacy",
                  email: "legacy@example.com",
                  displayName: "Legacy",
                  photoUrl: "https://img",
                  providerUserInfo: [{ providerId: "password" }],
                },
              ],
            };
          },
        };
      }),
    now: () => nowValue,
    normalizeReason: options.normalizeReason,
    log: {
      warn: (...args) => calls.warn.push(args),
      error: (...args) => calls.error.push(args),
    },
    importFirebaseAdminApp:
      options.importFirebaseAdminApp ??
      (async () => ({
        getApps: () => [
          {
            name: "existing",
          },
        ],
        initializeApp: () => ({ name: "new" }),
        applicationDefault: () => ({ type: "app-default" }),
        cert: (value) => value,
      })),
    importFirebaseAdminAuth:
      options.importFirebaseAdminAuth ??
      (async () => ({
        getAuth: () => {
          calls.adminResolve += 1;
          return adminClient;
        },
      })),
  });

  return {
    verifier,
    calls,
    setNow: (nextNow) => {
      nowValue = nextNow;
    },
  };
}

test("admin verification succeeds and subsequent calls reuse cache", async () => {
  const fixture = createFixture({
    firebaseAuthMode: "auto",
    firebaseWebApiKey: "",
  });

  const first = await fixture.verifier.verifyFirebaseIdToken("id-token-1");
  const second = await fixture.verifier.verifyFirebaseIdToken("id-token-1");

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.claims.uid, "uid-admin");
  assert.equal(fixture.calls.adminVerify, 1);
  assert.equal(fixture.calls.fetch, 0);
});

test("admin mode returns firebase_admin_unavailable when admin client cannot initialize", async () => {
  const fixture = createFixture({
    firebaseAuthMode: "admin",
    importFirebaseAdminApp: async () => {
      throw new Error("boom");
    },
  });

  const result = await fixture.verifier.verifyFirebaseIdToken("id-token-2");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "firebase_admin_unavailable");
  assert.equal(fixture.calls.error.length, 1);
});

test("auto mode falls back to legacy lookup when admin client unavailable", async () => {
  const fixture = createFixture({
    firebaseAuthMode: "auto",
    importFirebaseAdminApp: async () => {
      throw new Error("no admin sdk");
    },
  });

  const token = createJwt({
    aud: "",
    iss: "",
    exp: 5,
    firebase: { sign_in_provider: "password" },
  });
  const result = await fixture.verifier.verifyFirebaseIdToken(token);

  assert.equal(result.ok, true);
  assert.equal(result.claims.uid, "uid-legacy");
  assert.equal(fixture.calls.fetch, 1);
});

test("legacy mode normalizes lookup errors", async () => {
  const fixture = createFixture({
    firebaseAuthMode: "legacy",
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      async json() {
        return {
          error: {
            message: "INVALID_ID_TOKEN",
          },
        };
      },
    }),
  });

  const token = createJwt({ exp: 10 });
  const result = await fixture.verifier.verifyFirebaseIdToken(token);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "firebase_lookup_invalid_id_token");
});

test("legacy mode rejects audience mismatch before network call", async () => {
  const fixture = createFixture({
    firebaseAuthMode: "legacy",
    firebaseProjectId: "project-123",
  });

  const token = createJwt({
    aud: "different-project",
    iss: "https://securetoken.google.com/project-123",
    exp: 10,
  });
  const result = await fixture.verifier.verifyFirebaseIdToken(token);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "firebase_audience_mismatch");
  assert.equal(fixture.calls.fetch, 0);
});

test("admin verification failure normalizes auth error code", async () => {
  const fixture = createFixture({
    adminClient: {
      async verifyIdToken() {
        throw {
          code: "auth/id-token-expired",
        };
      },
    },
    firebaseWebApiKey: "",
  });

  const result = await fixture.verifier.verifyFirebaseIdToken("id-token-3");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "firebase_admin_id_token_expired");
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

  console.log(`All firebaseIdentityVerifier tests passed (${tests.length}).`);
}

await run();

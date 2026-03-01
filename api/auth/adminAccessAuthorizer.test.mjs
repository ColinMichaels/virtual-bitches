import assert from "node:assert/strict";
import { createAdminAccessAuthorizer } from "./adminAccessAuthorizer.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createFixture(options = {}) {
  const roles = {
    viewer: "viewer",
    operator: "operator",
    owner: "owner",
  };
  const roleLevels = {
    [roles.viewer]: 1,
    [roles.operator]: 2,
    [roles.owner]: 3,
  };
  const calls = {
    authorizeIdentityRequest: [],
    upsertFirebasePlayer: [],
    resolveAdminRoleForIdentity: [],
  };
  const authorizer = createAdminAccessAuthorizer({
    adminAccessMode: options.adminAccessMode ?? "hybrid",
    adminToken: options.adminToken ?? "admin-secret",
    nodeEnv: options.nodeEnv ?? "development",
    adminRoles: roles,
    normalizeAdminRole: (value) => {
      const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
      return normalized in roleLevels ? normalized : null;
    },
    hasRequiredAdminRole: (actualRole, requiredRole) => {
      const actual = typeof actualRole === "string" ? actualRole.trim().toLowerCase() : "";
      const required = typeof requiredRole === "string" ? requiredRole.trim().toLowerCase() : "";
      return (roleLevels[actual] ?? 0) >= (roleLevels[required] ?? 0);
    },
    hasBootstrapAdminOwnersConfigured: () => options.hasBootstrapOwners === true,
    extractBearerToken: (header) => {
      const source = typeof header === "string" ? header : "";
      const match = source.match(/^Bearer\s+(.+)$/i);
      return match ? match[1].trim() : "";
    },
    authorizeIdentityRequest: async (req, authorizeOptions) => {
      calls.authorizeIdentityRequest.push({ req, authorizeOptions });
      return (
        options.identityResult ?? {
          ok: true,
          uid: "uid-1",
          email: "admin@example.com",
          displayName: "Admin User",
          photoUrl: "https://avatar.example.com/admin.png",
          provider: "firebase",
          providerId: "password",
        }
      );
    },
    upsertFirebasePlayer: (uid, payload) => {
      calls.upsertFirebasePlayer.push({ uid, payload });
    },
    resolveAdminRoleForIdentity: (uid, email) => {
      calls.resolveAdminRoleForIdentity.push({ uid, email });
      return options.roleInfo ?? { role: roles.operator, source: "assigned" };
    },
  });

  return {
    authorizer,
    calls,
  };
}

test("resolveAdminAccessMode honors explicit mode and token availability", () => {
  const disabledTokenMode = createFixture({
    adminAccessMode: "token",
    adminToken: "",
  });
  const productionFallbackRole = createFixture({
    adminAccessMode: "unexpected",
    adminToken: "",
    nodeEnv: "production",
  });
  const developmentFallbackOpen = createFixture({
    adminAccessMode: "unexpected",
    adminToken: "",
    nodeEnv: "development",
    hasBootstrapOwners: false,
  });

  assert.equal(disabledTokenMode.authorizer.resolveAdminAccessMode(), "disabled");
  assert.equal(productionFallbackRole.authorizer.resolveAdminAccessMode(), "role");
  assert.equal(developmentFallbackOpen.authorizer.resolveAdminAccessMode(), "open");
});

test("open mode always allows owner access", async () => {
  const fixture = createFixture({
    adminAccessMode: "open",
    adminToken: "",
  });

  const result = await fixture.authorizer.authorizeAdminRequest({ headers: {} });

  assert.equal(result.ok, true);
  assert.equal(result.authType, "open");
  assert.equal(result.role, "owner");
  assert.equal(fixture.calls.authorizeIdentityRequest.length, 0);
});

test("token mode requires matching admin token", async () => {
  const fixture = createFixture({
    adminAccessMode: "token",
    adminToken: "root-token",
  });

  const missing = await fixture.authorizer.authorizeAdminRequest({ headers: {} });
  const invalid = await fixture.authorizer.authorizeAdminRequest({
    headers: { "x-admin-token": "wrong-token" },
  });
  const valid = await fixture.authorizer.authorizeAdminRequest({
    headers: { "x-admin-token": "root-token" },
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing_admin_token");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "invalid_admin_token");
  assert.equal(valid.ok, true);
  assert.equal(valid.authType, "token");
  assert.equal(fixture.calls.authorizeIdentityRequest.length, 0);
});

test("hybrid mode accepts bearer admin token shortcut", async () => {
  const fixture = createFixture({
    adminAccessMode: "hybrid",
    adminToken: "root-token",
  });

  const result = await fixture.authorizer.authorizeAdminRequest({
    headers: { authorization: "Bearer root-token" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.authType, "token");
  assert.equal(fixture.calls.authorizeIdentityRequest.length, 0);
});

test("role mode returns identity auth failure details", async () => {
  const fixture = createFixture({
    adminAccessMode: "role",
    adminToken: "",
    identityResult: {
      ok: false,
      reason: "firebase_lookup_invalid_id_token",
    },
  });

  const result = await fixture.authorizer.authorizeAdminRequest({ headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.reason, "firebase_lookup_invalid_id_token");
});

test("role mode enforces assigned role presence and minimum role", async () => {
  const noRoleFixture = createFixture({
    adminAccessMode: "role",
    adminToken: "",
    roleInfo: { role: null, source: "none" },
  });
  const forbiddenFixture = createFixture({
    adminAccessMode: "role",
    adminToken: "",
    roleInfo: { role: "viewer", source: "assigned" },
  });

  const noRole = await noRoleFixture.authorizer.authorizeAdminRequest({ headers: {} });
  const forbidden = await forbiddenFixture.authorizer.authorizeAdminRequest(
    { headers: {} },
    { minimumRole: "operator" }
  );

  assert.equal(noRole.ok, false);
  assert.equal(noRole.reason, "admin_role_required");
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.reason, "admin_role_forbidden");
});

test("role mode success upserts identity and returns resolved role details", async () => {
  const fixture = createFixture({
    adminAccessMode: "role",
    adminToken: "",
    roleInfo: { role: "operator", source: "assigned" },
  });

  const result = await fixture.authorizer.authorizeAdminRequest(
    { headers: {} },
    { minimumRole: "viewer" }
  );

  assert.equal(result.ok, true);
  assert.equal(result.authType, "role");
  assert.equal(result.role, "operator");
  assert.equal(result.roleSource, "assigned");
  assert.equal(fixture.calls.upsertFirebasePlayer.length, 1);
  assert.equal(fixture.calls.resolveAdminRoleForIdentity.length, 1);
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

  console.log(`All adminAccessAuthorizer tests passed (${tests.length}).`);
}

await run();

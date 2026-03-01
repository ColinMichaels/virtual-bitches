import assert from "node:assert/strict";
import { createAdminSecurityAuditService } from "./adminSecurityAuditService.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createFixture(options = {}) {
  let nowValue = options.now ?? 1_000;
  const calls = {
    compactLogStore: 0,
  };
  const store =
    options.store ??
    {
      gameLogs: {},
      firebasePlayers: {},
    };

  const service = createAdminSecurityAuditService({
    getStore: () => store,
    adminRoles: {
      viewer: "viewer",
      operator: "operator",
      owner: "owner",
    },
    adminRoleLevels: {
      viewer: 1,
      operator: 2,
      owner: 3,
    },
    ownerUidAllowlist: new Set(options.ownerUids ?? []),
    ownerEmailAllowlist: new Set(options.ownerEmails ?? []),
    adminRoomListLimitDefault: 60,
    adminRoomListLimitMax: 200,
    adminAuditListLimitDefault: 60,
    adminAuditListLimitMax: 250,
    adminConductListLimitDefault: 120,
    adminConductListLimitMax: 500,
    compactLogStore: () => {
      calls.compactLogStore += 1;
    },
    randomUUID: options.randomUUID ?? (() => "uuid-1"),
    now: () => nowValue,
  });

  return {
    service,
    store,
    calls,
    setNow: (value) => {
      nowValue = value;
    },
  };
}

test("normalizeAdminRole and hasRequiredAdminRole enforce role hierarchy", () => {
  const fixture = createFixture();

  assert.equal(fixture.service.normalizeAdminRole(" OWNER "), "owner");
  assert.equal(fixture.service.normalizeAdminRole("invalid"), null);
  assert.equal(fixture.service.hasRequiredAdminRole("owner", "operator"), true);
  assert.equal(fixture.service.hasRequiredAdminRole("viewer", "operator"), false);
});

test("resolveAdminRoleForIdentity prefers bootstrap allowlists", () => {
  const fixture = createFixture({
    ownerUids: ["owner-uid"],
    ownerEmails: ["owner@example.com"],
    store: {
      gameLogs: {},
      firebasePlayers: {
        "assigned-uid": {
          adminRole: "operator",
        },
      },
    },
  });

  const byUid = fixture.service.resolveAdminRoleForIdentity("owner-uid", "ignored@example.com");
  const byEmail = fixture.service.resolveAdminRoleForIdentity("other", "owner@example.com");
  const assigned = fixture.service.resolveAdminRoleForIdentity("assigned-uid", "user@example.com");
  const none = fixture.service.resolveAdminRoleForIdentity("none", "none@example.com");

  assert.deepEqual(byUid, { role: "owner", source: "bootstrap" });
  assert.deepEqual(byEmail, { role: "owner", source: "bootstrap" });
  assert.deepEqual(assigned, { role: "operator", source: "assigned" });
  assert.deepEqual(none, { role: null, source: "none" });
});

test("recordAdminAuditEvent writes normalized admin audit log entries", () => {
  const fixture = createFixture({
    randomUUID: () => "audit-id-1",
  });

  fixture.service.recordAdminAuditEvent(
    {
      ok: true,
      uid: "admin-uid",
      email: "admin@example.com",
      role: "owner",
      authType: "role",
    },
    "session_expire",
    {
      summary: "Expired session abc",
      sessionId: "session-1",
      playerId: "player-1",
      targetUid: "target-uid",
      role: "viewer",
      extra: "value",
    }
  );

  const entry = fixture.store.gameLogs["audit-id-1"];
  assert(entry, "expected audit entry");
  assert.equal(entry.type, "admin_action");
  assert.equal(entry.payload.action, "session_expire");
  assert.equal(entry.payload.target.sessionId, "session-1");
  assert.equal(entry.payload.details.extra, "value");
  assert.equal(fixture.calls.compactLogStore, 1);
});

test("collectAdminAuditEntries enforces bounds and normalizes payload fields", () => {
  const fixture = createFixture({
    randomUUID: () => "fallback-id",
    store: {
      gameLogs: {
        a: {
          id: "a",
          type: "admin_action",
          timestamp: 120,
          payload: {
            action: "role_upsert",
            summary: "updated role",
            actor: {
              uid: "admin-a",
              email: "admin-a@example.com",
              role: "owner",
              authType: "role",
            },
            target: {
              uid: "user-a",
              role: "viewer",
              sessionId: "session-a",
              playerId: "player-a",
            },
          },
        },
        b: {
          id: "b",
          type: "admin_action",
          timestamp: 100,
          payload: {
            action: "session_expire",
          },
        },
      },
      firebasePlayers: {},
    },
  });

  const entries = fixture.service.collectAdminAuditEntries(1);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "a");
  assert.equal(entries[0].actor.role, "owner");
});

test("collectAdminRoleRecords includes assigned and bootstrap records", () => {
  const fixture = createFixture({
    ownerUids: ["bootstrap-owner"],
    store: {
      gameLogs: {},
      firebasePlayers: {
        "assigned-user": {
          displayName: "Assigned User",
          email: "assigned@example.com",
          adminRole: "operator",
          adminRoleUpdatedAt: 123,
        },
      },
    },
  });

  const records = fixture.service.collectAdminRoleRecords();
  const assigned = records.find((record) => record.uid === "assigned-user");
  const bootstrap = records.find((record) => record.uid === "bootstrap-owner");

  assert(assigned, "expected assigned admin record");
  assert.equal(assigned.role, "operator");
  assert(bootstrap, "expected bootstrap owner record");
  assert.equal(bootstrap.role, "owner");
});

test("admin limit parsers clamp and fallback correctly", () => {
  const fixture = createFixture();

  assert.equal(fixture.service.parseAdminRoomLimit(undefined), 60);
  assert.equal(fixture.service.parseAdminRoomLimit("9999"), 200);
  assert.equal(fixture.service.parseAdminAuditLimit("0"), 1);
  assert.equal(fixture.service.parseAdminConductLimit("1000"), 500);
  assert.equal(fixture.service.parseAdminModerationTermLimit("bad"), 250);
  assert.equal(fixture.service.parseAdminModerationTermLimit("99999"), 5000);
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

  console.log(`All adminSecurityAuditService tests passed (${tests.length}).`);
}

await run();

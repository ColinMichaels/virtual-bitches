import assert from "node:assert/strict";
import { createStoreSyncController } from "./storeSyncController.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFixture(options = {}) {
  let nowValue = options.now ?? 1_000;
  let store = options.store ?? {
    players: {},
    multiplayerSessions: {},
    accessTokens: {},
    refreshTokens: {},
    moderation: {},
  };
  const calls = {
    beforePersist: 0,
    afterRehydrate: 0,
    saves: [],
    loads: 0,
    warns: [],
    debugs: [],
  };

  const controller = createStoreSyncController({
    getStore: () => store,
    setStore: (nextStore) => {
      store = nextStore;
    },
    cloneStore: (raw) => structuredClone(raw),
    rehydrateCooldownMs: options.rehydrateCooldownMs ?? 100,
    beforePersist: () => {
      calls.beforePersist += 1;
    },
    afterRehydrate: (context) => {
      calls.afterRehydrate += 1;
      if (typeof options.afterRehydrate === "function") {
        return options.afterRehydrate(context);
      }
      return options.afterRehydrateResult ?? { persist: false };
    },
    now: () => nowValue,
    log: {
      warn: (...args) => calls.warns.push(args),
      debug: (...args) => calls.debugs.push(args),
    },
  });

  return {
    controller,
    getStore: () => store,
    setNow: (value) => {
      nowValue = value;
    },
    calls,
  };
}

test("persistStore is a no-op when adapter is unset", async () => {
  const fixture = createFixture();

  await fixture.controller.persistStore();

  assert.equal(fixture.calls.beforePersist, 0);
  assert.equal(fixture.calls.saves.length, 0);
});

test("persistStore executes beforePersist and save in sequence", async () => {
  const fixture = createFixture();
  const saves = fixture.calls.saves;
  fixture.controller.setAdapter({
    async save(snapshot) {
      saves.push(structuredClone(snapshot));
    },
  });

  await fixture.controller.persistStore();

  assert.equal(fixture.calls.beforePersist, 1);
  assert.equal(saves.length, 1);
});

test("persistStore continues after prior save rejection", async () => {
  const fixture = createFixture();
  let saveAttempt = 0;
  fixture.controller.setAdapter({
    async save() {
      saveAttempt += 1;
      if (saveAttempt === 1) {
        throw new Error("first failure");
      }
      fixture.calls.saves.push({ ok: true });
    },
  });

  await assert.rejects(() => fixture.controller.persistStore());
  await fixture.controller.persistStore();

  assert.equal(saveAttempt, 2);
  assert.equal(fixture.calls.saves.length, 1);
});

test("rehydrateStore skips cooldown unless forced", async () => {
  const fixture = createFixture({ rehydrateCooldownMs: 1_000 });
  let loadCount = 0;
  fixture.controller.setAdapter({
    async load() {
      loadCount += 1;
      return {
        players: { "player-1": { id: "player-1" } },
      };
    },
    async save() {},
  });

  const first = await fixture.controller.rehydrateStore("first", { force: true });
  const second = await fixture.controller.rehydrateStore("second");
  const forced = await fixture.controller.rehydrateStore("third", { force: true });

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(forced, true);
  assert.equal(loadCount, 2);
});

test("rehydrateStore coalesces concurrent requests", async () => {
  const fixture = createFixture();
  const deferred = createDeferred();
  let loadCount = 0;
  fixture.controller.setAdapter({
    async load() {
      loadCount += 1;
      return deferred.promise;
    },
    async save() {},
  });

  const p1 = fixture.controller.rehydrateStore("a", { force: true });
  const p2 = fixture.controller.rehydrateStore("b", { force: true });
  deferred.resolve({ players: { p: { id: "p" } } });

  const [r1, r2] = await Promise.all([p1, p2]);

  assert.equal(r1, true);
  assert.equal(r2, true);
  assert.equal(loadCount, 1);
  assert.equal(fixture.calls.afterRehydrate, 1);
});

test("rehydrateStore can request persistence via afterRehydrate", async () => {
  const fixture = createFixture({
    afterRehydrateResult: { persist: true },
  });
  fixture.controller.setAdapter({
    async load() {
      fixture.calls.loads += 1;
      return {
        players: { "player-2": { id: "player-2" } },
      };
    },
    async save(snapshot) {
      fixture.calls.saves.push(structuredClone(snapshot));
    },
  });

  const ok = await fixture.controller.rehydrateStore("with-persist", { force: true });

  assert.equal(ok, true);
  assert.equal(fixture.calls.loads, 1);
  assert.equal(fixture.calls.beforePersist, 1);
  assert.equal(fixture.calls.saves.length, 1);
  assert.equal(fixture.calls.saves[0].players["player-2"].id, "player-2");
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

  console.log(`All storeSyncController tests passed (${tests.length}).`);
}

await run();

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFileStoreAdapter } from "./fileStore.mjs";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "biscuits-file-store-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("createFileStoreAdapter requires dataDir and dataFile", async () => {
  await assert.rejects(() => createFileStoreAdapter({ dataDir: "", dataFile: "" }));
});

test("load initializes missing store file with defaults", async () => {
  await withTempDir(async (tempDir) => {
    const dataFile = path.join(tempDir, "store.json");
    const adapter = await createFileStoreAdapter({ dataDir: tempDir, dataFile });

    const loaded = await adapter.load();

    assert.equal(typeof loaded, "object");
    assert.equal(Object.keys(loaded.accessTokens).length, 0);
    const raw = await readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(typeof parsed.multiplayerSessions, "object");
  });
});

test("load falls back to defaults when file JSON is invalid", async () => {
  await withTempDir(async (tempDir) => {
    const dataFile = path.join(tempDir, "store.json");
    await writeFile(dataFile, "{not-valid-json", "utf8");
    const warns = [];
    const adapter = await createFileStoreAdapter({
      dataDir: tempDir,
      dataFile,
      logger: {
        warn: (...args) => warns.push(args),
      },
    });

    const loaded = await adapter.load();

    assert.equal(typeof loaded.players, "object");
    assert.equal(warns.length, 1);
  });
});

test("save writes next store snapshot and can be reloaded", async () => {
  await withTempDir(async (tempDir) => {
    const dataFile = path.join(tempDir, "store.json");
    const adapter = await createFileStoreAdapter({ dataDir: tempDir, dataFile });

    const nextStore = {
      players: {
        "player-1": {
          playerId: "player-1",
        },
      },
      playerScores: {},
      gameLogs: {},
      multiplayerSessions: {},
      refreshTokens: {},
      accessTokens: {},
      leaderboardScores: {},
      firebasePlayers: {},
      moderation: {},
    };

    await adapter.save(nextStore);
    const loaded = await adapter.load();

    assert.equal(loaded.players["player-1"].playerId, "player-1");
  });
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

  console.log(`All fileStore tests passed (${tests.length}).`);
}

await run();

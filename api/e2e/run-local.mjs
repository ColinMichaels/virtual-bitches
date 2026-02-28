import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.E2E_LOCAL_PORT ?? 3310);
const apiBaseUrl = `http://127.0.0.1:${PORT}`;
const shortTtlModeEnabled = process.env.E2E_SHORT_TTLS !== "0";
const configuredServerSpeedProfileRaw =
  typeof process.env.MULTIPLAYER_SPEED_PROFILE === "string"
    ? process.env.MULTIPLAYER_SPEED_PROFILE
    : "";
const requestedE2ESpeedProfileRaw =
  typeof process.env.E2E_MULTIPLAYER_SPEED_PROFILE === "string"
    ? process.env.E2E_MULTIPLAYER_SPEED_PROFILE
    : "";
const multiplayerSpeedProfile = normalizeSpeedProfile(
  configuredServerSpeedProfileRaw ||
    requestedE2ESpeedProfileRaw ||
    (shortTtlModeEnabled ? "fast" : "normal")
);
const fastSpeedProfileEnabled = multiplayerSpeedProfile === "fast";
const adminToken = process.env.E2E_ADMIN_TOKEN ?? "local-admin-token";
const chatConductTestTerm = (process.env.E2E_CHAT_CONDUCT_TEST_TERM ?? "e2e-term-blocked").trim().toLowerCase();
const e2eDataDir = await mkdtemp(path.join(tmpdir(), "biscuits-api-e2e-"));
const e2eDataFile = path.join(e2eDataDir, "store.json");

const serverProcess = spawn("node", ["api/server.mjs"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    WS_BASE_URL: `ws://127.0.0.1:${PORT}`,
    API_DATA_DIR: e2eDataDir,
    API_DATA_FILE: e2eDataFile,
    MULTIPLAYER_SPEED_PROFILE: multiplayerSpeedProfile,
    ALLOW_SHORT_SESSION_TTLS: shortTtlModeEnabled ? "1" : process.env.ALLOW_SHORT_SESSION_TTLS,
    MULTIPLAYER_SESSION_IDLE_TTL_MS:
      process.env.MULTIPLAYER_SESSION_IDLE_TTL_MS ??
      (shortTtlModeEnabled ? "12000" : undefined),
    MULTIPLAYER_NEXT_GAME_DELAY_MS:
      process.env.MULTIPLAYER_NEXT_GAME_DELAY_MS ??
      (shortTtlModeEnabled ? "5000" : undefined),
    MULTIPLAYER_POST_GAME_INACTIVITY_TIMEOUT_MS:
      process.env.MULTIPLAYER_POST_GAME_INACTIVITY_TIMEOUT_MS ??
      (shortTtlModeEnabled ? "15000" : undefined),
    PUBLIC_ROOM_OVERFLOW_EMPTY_TTL_MS:
      process.env.PUBLIC_ROOM_OVERFLOW_EMPTY_TTL_MS ??
      (shortTtlModeEnabled ? "5000" : undefined),
    PUBLIC_ROOM_STALE_PARTICIPANT_MS:
      process.env.PUBLIC_ROOM_STALE_PARTICIPANT_MS ??
      (shortTtlModeEnabled ? "4000" : undefined),
    TURN_TIMEOUT_MS:
      process.env.TURN_TIMEOUT_MS ??
      (shortTtlModeEnabled && fastSpeedProfileEnabled ? "8000" : undefined),
    MULTIPLAYER_TURN_TIMEOUT_EASY_MS:
      process.env.MULTIPLAYER_TURN_TIMEOUT_EASY_MS ??
      (shortTtlModeEnabled && fastSpeedProfileEnabled ? "10000" : undefined),
    MULTIPLAYER_TURN_TIMEOUT_NORMAL_MS:
      process.env.MULTIPLAYER_TURN_TIMEOUT_NORMAL_MS ??
      (shortTtlModeEnabled && fastSpeedProfileEnabled ? "8000" : undefined),
    MULTIPLAYER_TURN_TIMEOUT_HARD_MS:
      process.env.MULTIPLAYER_TURN_TIMEOUT_HARD_MS ??
      (shortTtlModeEnabled && fastSpeedProfileEnabled ? "5000" : undefined),
    MULTIPLAYER_CHAT_CONDUCT_ENABLED: process.env.MULTIPLAYER_CHAT_CONDUCT_ENABLED ?? "1",
    MULTIPLAYER_CHAT_BANNED_TERMS:
      process.env.MULTIPLAYER_CHAT_BANNED_TERMS ?? chatConductTestTerm,
    API_ADMIN_ACCESS_MODE: process.env.API_ADMIN_ACCESS_MODE ?? "token",
    API_ADMIN_TOKEN: process.env.API_ADMIN_TOKEN ?? adminToken,
  },
  stdio: "inherit",
});

let serverExited = false;
serverProcess.on("exit", (code, signal) => {
  serverExited = true;
  if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGKILL") {
    process.stderr.write(
      `[e2e] API server exited unexpectedly (code=${code ?? "n/a"}, signal=${signal ?? "n/a"})\n`
    );
  }
});

try {
  process.stdout.write(
    `[e2e] Local smoke profile: speed=${multiplayerSpeedProfile}, shortTtls=${shortTtlModeEnabled ? "1" : "0"}\n`
  );
  await waitForHealth(apiBaseUrl);
  const testExitCode = await runSmoke(apiBaseUrl);
  process.exitCode = testExitCode;
} catch (error) {
  process.stderr.write(`[e2e] FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (!serverExited) {
    serverProcess.kill("SIGTERM");
    await delay(300);
    if (!serverExited) {
      serverProcess.kill("SIGKILL");
    }
  }
  await rm(e2eDataDir, { recursive: true, force: true });
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (serverExited) {
      throw new Error("API server exited before health check completed");
    }

    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        process.stdout.write(`[e2e] API ready at ${baseUrl}\n`);
        return;
      }
    } catch {
      // Retry until deadline.
    }

    await delay(250);
  }

  throw new Error("Timed out waiting for local API health check");
}

function runSmoke(baseUrl) {
  return new Promise((resolve) => {
    const child = spawn("node", ["api/e2e/smoke.mjs"], {
      env: {
        ...process.env,
        E2E_API_BASE_URL: baseUrl,
        E2E_ASSERT_ROOM_EXPIRY:
          process.env.E2E_ASSERT_ROOM_EXPIRY ?? (shortTtlModeEnabled ? "1" : "0"),
        E2E_ROOM_EXPIRY_WAIT_MS: process.env.E2E_ROOM_EXPIRY_WAIT_MS ?? "9000",
        E2E_QUEUE_LIFECYCLE_WAIT_MS:
          process.env.E2E_QUEUE_LIFECYCLE_WAIT_MS ?? (shortTtlModeEnabled ? "12000" : "90000"),
        E2E_EXPECT_SPEED_PROFILE:
          process.env.E2E_EXPECT_SPEED_PROFILE ?? multiplayerSpeedProfile,
        E2E_ADMIN_TOKEN: adminToken,
        E2E_ASSERT_ADMIN_MONITOR: process.env.E2E_ASSERT_ADMIN_MONITOR ?? "1",
        E2E_ASSERT_ADMIN_MODERATION_TERMS:
          process.env.E2E_ASSERT_ADMIN_MODERATION_TERMS ?? "1",
        E2E_ASSERT_CHAT_CONDUCT: process.env.E2E_ASSERT_CHAT_CONDUCT ?? "1",
        E2E_CHAT_CONDUCT_TEST_TERM: chatConductTestTerm,
      },
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

function normalizeSpeedProfile(rawValue) {
  const normalized = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
  if (normalized === "fast" || normalized === "demo") {
    return "fast";
  }
  return "normal";
}

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = Number(process.env.E2E_LOCAL_PORT ?? 3310);
const apiBaseUrl = `http://127.0.0.1:${PORT}`;

const serverProcess = spawn("node", ["api/server.mjs"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    WS_BASE_URL: `ws://127.0.0.1:${PORT}`,
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
      },
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

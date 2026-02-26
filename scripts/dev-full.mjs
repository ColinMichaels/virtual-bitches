import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const showHelp = args.has("--help") || args.has("-h");

if (showHelp) {
  printHelp();
  process.exit(0);
}

const envFromFiles = loadEnvFromFiles([path.join(cwd, ".env.local"), path.join(cwd, ".env")]);
const getEnv = (...keys) => {
  for (const key of keys) {
    const fromProcess = process.env[key];
    if (typeof fromProcess === "string" && fromProcess.trim().length > 0) {
      return fromProcess.trim();
    }

    const fromFile = envFromFiles[key];
    if (typeof fromFile === "string" && fromFile.trim().length > 0) {
      return fromFile.trim();
    }
  }
  return "";
};

const resolvedPort = Number(getEnv("FULL_DEV_API_PORT", "API_PORT", "PORT") || "3000");
if (!Number.isFinite(resolvedPort) || resolvedPort <= 0) {
  process.stderr.write("[dev:full] Invalid API port. Set FULL_DEV_API_PORT, API_PORT, or PORT.\n");
  process.exit(1);
}
const apiPort = Math.floor(resolvedPort);
const localWsBase = `ws://127.0.0.1:${apiPort}`;
const localApiBase = `http://127.0.0.1:${apiPort}/api`;
const keepViteEndpoints = getEnv("FULL_DEV_KEEP_VITE_ENDPOINTS") === "1";

const firebaseProjectId = getEnv("FIREBASE_PROJECT_ID", "VITE_FIREBASE_PROJECT_ID");
const firebaseWebApiKey = getEnv("FIREBASE_WEB_API_KEY", "VITE_FIREBASE_API_KEY");

const apiEnv = {
  ...process.env,
  PORT: String(apiPort),
  WS_BASE_URL: localWsBase,
};
if (firebaseProjectId) {
  apiEnv.FIREBASE_PROJECT_ID = firebaseProjectId;
}
if (firebaseWebApiKey) {
  apiEnv.FIREBASE_WEB_API_KEY = firebaseWebApiKey;
}

const viteEnv = {
  ...process.env,
};
if (!keepViteEndpoints) {
  viteEnv.VITE_API_BASE_URL = localApiBase;
  viteEnv.VITE_WS_URL = localWsBase;
}

if (dryRun) {
  process.stdout.write("[dev:full] Dry run configuration\n");
  process.stdout.write(`  apiPort: ${apiPort}\n`);
  process.stdout.write(`  apiBaseUrl: ${localApiBase}\n`);
  process.stdout.write(`  wsBaseUrl: ${localWsBase}\n`);
  process.stdout.write(`  keepViteEndpoints: ${keepViteEndpoints}\n`);
  process.stdout.write(
    `  firebaseProjectId: ${firebaseProjectId || "(not set)"}\n`
  );
  process.stdout.write(
    `  firebaseWebApiKey: ${firebaseWebApiKey ? "(set)" : "(not set)"}\n`
  );
  process.exit(0);
}

process.stdout.write(`[dev:full] Starting API on :${apiPort}\n`);
process.stdout.write(
  `[dev:full] Frontend VITE_API_BASE_URL=${viteEnv.VITE_API_BASE_URL ?? "(from .env)"}\n`
);
process.stdout.write(
  `[dev:full] Frontend VITE_WS_URL=${viteEnv.VITE_WS_URL ?? "(from .env)"}\n`
);
if (!firebaseWebApiKey) {
  process.stdout.write(
    "[dev:full] WARNING: FIREBASE_WEB_API_KEY not set. Backend Firebase token verification will fail.\n"
  );
}

const apiProc = spawn(process.execPath, ["api/server.mjs"], {
  cwd,
  env: apiEnv,
  stdio: "inherit",
});
const frontendProc = spawn(getNpmCommand(), ["run", "dev"], {
  cwd,
  env: viteEnv,
  stdio: "inherit",
});

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (!apiProc.killed) {
    apiProc.kill("SIGTERM");
  }
  if (!frontendProc.killed) {
    frontendProc.kill("SIGTERM");
  }

  setTimeout(() => {
    if (!apiProc.killed) {
      apiProc.kill("SIGKILL");
    }
    if (!frontendProc.killed) {
      frontendProc.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 400);
}

apiProc.on("exit", (code, signal) => {
  if (shuttingDown) return;
  const normalized = code ?? (signal ? 1 : 0);
  process.stderr.write(
    `[dev:full] API exited (code=${code ?? "n/a"}, signal=${signal ?? "n/a"}).\n`
  );
  shutdown(normalized === 0 ? 0 : 1);
});

frontendProc.on("exit", (code, signal) => {
  if (shuttingDown) return;
  const normalized = code ?? (signal ? 1 : 0);
  process.stderr.write(
    `[dev:full] Frontend exited (code=${code ?? "n/a"}, signal=${signal ?? "n/a"}).\n`
  );
  shutdown(normalized === 0 ? 0 : 1);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function loadEnvFromFiles(files) {
  const merged = {};
  for (const filePath of files) {
    if (!existsSync(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (key.length > 0 && value.length > 0 && !(key in merged)) {
        merged[key] = value;
      } else if (key.length > 0 && !(key in merged)) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

function printHelp() {
  process.stdout.write("Usage: npm run dev:full [-- --dry-run]\n");
  process.stdout.write("\n");
  process.stdout.write("Starts local API + frontend together for end-to-end dev testing.\n");
  process.stdout.write("\n");
  process.stdout.write("Environment options:\n");
  process.stdout.write("  FULL_DEV_API_PORT          Local API port (default: 3000)\n");
  process.stdout.write(
    "  FULL_DEV_KEEP_VITE_ENDPOINTS=1  Keep existing VITE_API_BASE_URL/VITE_WS_URL from env files\n"
  );
  process.stdout.write(
    "  FIREBASE_PROJECT_ID or VITE_FIREBASE_PROJECT_ID  Project ID used by local API auth verification\n"
  );
  process.stdout.write(
    "  FIREBASE_WEB_API_KEY or VITE_FIREBASE_API_KEY    API key used by local API token lookup\n"
  );
}

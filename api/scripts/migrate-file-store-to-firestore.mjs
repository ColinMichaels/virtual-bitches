import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createStoreAdapter } from "../storage/index.mjs";
import { cloneStore, getStoreSections } from "../storage/defaultStore.mjs";
import { logger } from "../logger.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const defaultSourcePath = path.resolve(repoRoot, "api/data/store.json");
const log = logger.create("FirestoreMigration");

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const sourcePath = path.resolve(repoRoot, options.sourcePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Source store file not found: ${sourcePath}`);
  }

  const sourceStoreRaw = await readJson(sourcePath);
  const sourceStore = cloneStore(sourceStoreRaw);

  if (options.pruneExpired) {
    pruneExpiredRecords(sourceStore, options.nowMs);
  }

  const firestoreAdapter = await createStoreAdapter({
    backend: "firestore",
    firebaseProjectId: options.firebaseProjectId,
    firestorePrefix: options.firestorePrefix,
    logger: log,
  });

  const existingFirestoreStore = await firestoreAdapter.load();
  const targetStore =
    options.mode === "replace"
      ? cloneStore(sourceStore)
      : mergeStores(existingFirestoreStore, sourceStore);

  printSectionSummary("source", sourceStore);
  printSectionSummary("firestore_before", existingFirestoreStore);
  printSectionSummary("target", targetStore);

  if (!options.verifyOnly) {
    await firestoreAdapter.save(targetStore);
    log.info(`Firestore write complete (mode=${options.mode})`);
  } else {
    log.info("Verify-only mode: skipping Firestore write");
  }

  const afterStore = await firestoreAdapter.load();
  printSectionSummary("firestore_after", afterStore);

  const comparison = compareStores(targetStore, afterStore);
  if (!comparison.ok) {
    log.error("Migration verification failed");
    for (const line of comparison.details) {
      log.error(line);
    }
    process.exitCode = 1;
    return;
  }

  log.info("Migration verification passed");
}

function parseArgs(args) {
  const options = {
    sourcePath: defaultSourcePath,
    firestorePrefix: process.env.API_FIRESTORE_PREFIX ?? "api_v1",
    firebaseProjectId:
      process.env.FIREBASE_PROJECT_ID ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.GCLOUD_PROJECT ??
      "",
    mode: "merge",
    pruneExpired: true,
    verifyOnly: false,
    help: false,
    nowMs: Date.now(),
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--verify-only") {
      options.verifyOnly = true;
      continue;
    }
    if (arg === "--no-prune-expired") {
      options.pruneExpired = false;
      continue;
    }
    if (arg.startsWith("--source=")) {
      options.sourcePath = arg.slice("--source=".length);
      continue;
    }
    if (arg === "--source") {
      options.sourcePath = args[++i];
      continue;
    }
    if (arg.startsWith("--mode=")) {
      options.mode = normalizeMode(arg.slice("--mode=".length));
      continue;
    }
    if (arg === "--mode") {
      options.mode = normalizeMode(args[++i]);
      continue;
    }
    if (arg.startsWith("--project=")) {
      options.firebaseProjectId = arg.slice("--project=".length);
      continue;
    }
    if (arg === "--project") {
      options.firebaseProjectId = args[++i];
      continue;
    }
    if (arg.startsWith("--prefix=")) {
      options.firestorePrefix = arg.slice("--prefix=".length);
      continue;
    }
    if (arg === "--prefix") {
      options.firestorePrefix = args[++i];
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function normalizeMode(raw) {
  const mode = String(raw ?? "").trim().toLowerCase();
  if (mode === "replace") return "replace";
  if (mode === "merge") return "merge";
  throw new Error(`Invalid mode: ${raw} (use merge or replace)`);
}

function mergeStores(baseStoreRaw, incomingStoreRaw) {
  const baseStore = cloneStore(baseStoreRaw);
  const incomingStore = cloneStore(incomingStoreRaw);
  const merged = cloneStore(baseStore);

  for (const section of getStoreSections()) {
    const nextSection = {
      ...(baseStore[section] ?? {}),
      ...(incomingStore[section] ?? {}),
    };
    merged[section] = nextSection;
  }

  return merged;
}

function pruneExpiredRecords(store, nowMs) {
  pruneMapByExpiry(store.accessTokens, nowMs);
  pruneMapByExpiry(store.refreshTokens, nowMs);
  pruneMapByExpiry(store.multiplayerSessions, nowMs);
}

function pruneMapByExpiry(map, nowMs) {
  if (!map || typeof map !== "object") return;
  for (const [key, value] of Object.entries(map)) {
    if (!value || typeof value !== "object") continue;
    if (typeof value.expiresAt !== "number") continue;
    if (value.expiresAt <= nowMs) {
      delete map[key];
    }
  }
}

function printSectionSummary(label, storeRaw) {
  const store = cloneStore(storeRaw);
  const sections = getStoreSections();
  const metrics = sections.map((section) => {
    const sectionMap = store[section] ?? {};
    return {
      section,
      count: Object.keys(sectionMap).length,
      digest: hashJson(sectionMap).slice(0, 12),
    };
  });

  log.info(`Store summary (${label}):`);
  for (const entry of metrics) {
    log.info(
      `  ${entry.section.padEnd(20)} count=${String(entry.count).padStart(6)} digest=${entry.digest}`
    );
  }
}

function compareStores(expectedRaw, actualRaw) {
  const expected = cloneStore(expectedRaw);
  const actual = cloneStore(actualRaw);
  const details = [];
  let ok = true;

  for (const section of getStoreSections()) {
    const expectedSection = expected[section] ?? {};
    const actualSection = actual[section] ?? {};
    const expectedCount = Object.keys(expectedSection).length;
    const actualCount = Object.keys(actualSection).length;
    const expectedDigest = hashJson(expectedSection);
    const actualDigest = hashJson(actualSection);

    if (expectedCount !== actualCount) {
      ok = false;
      details.push(
        `[${section}] count mismatch expected=${expectedCount} actual=${actualCount}`
      );
    }

    if (expectedDigest !== actualDigest) {
      ok = false;
      details.push(
        `[${section}] digest mismatch expected=${expectedDigest.slice(0, 16)} actual=${actualDigest.slice(0, 16)}`
      );
    }
  }

  return { ok, details };
}

function hashJson(value) {
  const json = stableStringify(value);
  return createHash("sha256").update(json).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function printUsage() {
  process.stdout.write(`
Usage:
  node api/scripts/migrate-file-store-to-firestore.mjs [options]

Options:
  --source <path>          Source JSON store file (default: api/data/store.json)
  --mode <merge|replace>   merge (safe default) or replace Firestore state
  --project <id>           Firebase project id (defaults from env)
  --prefix <value>         Firestore collection prefix (default: api_v1)
  --no-prune-expired       Keep expired tokens/sessions from source file
  --verify-only            Skip writes, compare expected vs current Firestore
  -h, --help               Show this help

Required credentials:
  - ADC (gcloud auth application-default login) OR
  - FIREBASE_SERVICE_ACCOUNT_JSON
`.trimStart());
}

void main().catch((error) => {
  log.error("Migration failed", error);
  process.exitCode = 1;
});

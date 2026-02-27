import { spawnSync } from "node:child_process";

const serviceId = getEnv("CLOUDRUN_API_SERVICE_ID", "biscuits-api");
const region = getEnv("CLOUDRUN_API_REGION", "us-central1");
const sourceDir = getEnv("CLOUDRUN_API_SOURCE", "api");
const allowUnauthenticated = getEnv("CLOUDRUN_ALLOW_UNAUTHENTICATED", "1") !== "0";
const preserveDb = getEnv("API_DEPLOY_PRESERVE_DB", "1") !== "0";
const firestorePrefix = getEnv("API_FIRESTORE_PREFIX", "api_v1");
const requestedBackend = normalizeBackend(process.env.API_STORE_BACKEND);
const backend = preserveDb ? "firestore" : requestedBackend ?? "firestore";
const allowFileStoreInProd = preserveDb ? false : process.env.API_ALLOW_FILE_STORE_IN_PRODUCTION === "1";

if (preserveDb && backend !== "firestore") {
  process.stderr.write(
    "[cloudrun:deploy:api] API_DEPLOY_PRESERVE_DB=1 requires API_STORE_BACKEND=firestore.\n"
  );
  process.exit(1);
}

const envVars = [
  `API_STORE_BACKEND=${backend}`,
  `API_FIRESTORE_PREFIX=${firestorePrefix}`,
];
if (!preserveDb && backend === "file") {
  envVars.push(`API_ALLOW_FILE_STORE_IN_PRODUCTION=${allowFileStoreInProd ? "1" : "0"}`);
}

const args = [
  "run",
  "deploy",
  serviceId,
  "--source",
  sourceDir,
  "--region",
  region,
  "--set-env-vars",
  envVars.join(","),
];

if (allowUnauthenticated) {
  args.push("--allow-unauthenticated");
}

process.stdout.write(
  `[cloudrun:deploy:api] Deploying ${serviceId} (${region}) with backend=${backend}, prefix=${firestorePrefix}, preserveDb=${preserveDb}\n`
);
const result = spawnSync("gcloud", args, {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  process.stderr.write(`[cloudrun:deploy:api] Failed to execute gcloud: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);

function getEnv(name, fallback = "") {
  const value = process.env[name];
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeBackend(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "firestore" || normalized === "file") {
    return normalized;
  }
  return null;
}

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const parsedArgs = parseArgs(args);
const bucket = resolveBucketName(parsedArgs.bucket);

if (!bucket) {
  console.error(
    "[cdn:upload] Missing bucket. Use --bucket <bucket> or set FIREBASE_STORAGE_BUCKET / VITE_FIREBASE_STORAGE_BUCKET."
  );
  process.exit(1);
}

const dryRun = parsedArgs.dryRun;
const bucketUri = `gs://${bucket.replace(/^gs:\/\//, "").replace(/\/+$/, "")}`;

const commands = [
  [
    "gcloud",
    [
      "storage",
      "rsync",
      "--recursive",
      ...(dryRun ? ["--dry-run"] : []),
      path.join(projectRoot, "public", "assets"),
      `${bucketUri}/assets`,
    ],
  ],
  [
    "gcloud",
    [
      "storage",
      "cp",
      ...(dryRun ? ["--dry-run"] : []),
      path.join(projectRoot, "public", "rules.md"),
      `${bucketUri}/rules.md`,
    ],
  ],
  [
    "gcloud",
    [
      "storage",
      "cp",
      ...(dryRun ? ["--dry-run"] : []),
      path.join(projectRoot, "public", "updates.json"),
      `${bucketUri}/updates.json`,
    ],
  ],
];

console.log(
  `[cdn:upload] Uploading runtime assets to ${bucketUri}${dryRun ? " (dry-run)" : ""}`
);

for (const [command, commandArgs] of commands) {
  await runCommand(command, commandArgs);
}

console.log("[cdn:upload] Upload completed.");

function parseArgs(rawArgs) {
  const parsed = {
    bucket: "",
    dryRun: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const value = rawArgs[index];
    if (value === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (value === "--bucket") {
      parsed.bucket = rawArgs[index + 1] ?? "";
      index += 1;
    }
  }

  return parsed;
}

function resolveBucketName(argBucket) {
  const candidates = [
    argBucket,
    process.env.FIREBASE_STORAGE_BUCKET,
    process.env.VITE_FIREBASE_STORAGE_BUCKET,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function runCommand(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const printable = [command, ...commandArgs].join(" ");
    console.log(`[cdn:upload] ${printable}`);
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${code}): ${printable}`));
    });
  });
}

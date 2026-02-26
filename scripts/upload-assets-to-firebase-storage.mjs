import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

run().catch((error) => {
  console.error(`[cdn:upload] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function run() {
  const args = process.argv.slice(2);
  const parsedArgs = parseArgs(args);
  const rawBucket = resolveBucketName(parsedArgs.bucket);
  const projectId = resolveProjectId();

  if (!rawBucket && !projectId) {
    throw new Error(
      "Missing bucket. Use --bucket <bucket>, set FIREBASE_STORAGE_BUCKET / VITE_FIREBASE_STORAGE_BUCKET, or provide FIREBASE_PROJECT_ID."
    );
  }

  const dryRun = parsedArgs.dryRun;
  const shouldApplyCacheControl = !parsedArgs.disableCacheControl;
  const assetCacheControl = resolveAssetCacheControl(parsedArgs.assetCacheControl);
  const contentCacheControl = resolveContentCacheControl(parsedArgs.contentCacheControl);

  await ensureCommandAvailable("gcloud", ["version"]);
  const bucketCandidates = buildBucketCandidates(rawBucket, projectId);
  const resolvedBucket = await resolveExistingBucket(bucketCandidates);
  const bucketUri = `gs://${resolvedBucket}`;

  const commands = [
    [
      "gcloud",
      [
        "storage",
        "rsync",
        "--recursive",
        ...(shouldApplyCacheControl ? [`--cache-control=${assetCacheControl}`] : []),
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
        ...(shouldApplyCacheControl ? [`--cache-control=${contentCacheControl}`] : []),
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
        ...(shouldApplyCacheControl ? [`--cache-control=${contentCacheControl}`] : []),
        ...(dryRun ? ["--dry-run"] : []),
        path.join(projectRoot, "public", "updates.json"),
        `${bucketUri}/updates.json`,
      ],
    ],
  ];

  console.log(
    `[cdn:upload] Uploading runtime assets to ${bucketUri}${dryRun ? " (dry-run)" : ""}`
  );
  if (rawBucket && normalizeBucketName(rawBucket) !== resolvedBucket) {
    console.log(
      `[cdn:upload] Bucket fallback applied: requested="${normalizeBucketName(rawBucket)}" resolved="${resolvedBucket}"`
    );
  }
  if (shouldApplyCacheControl) {
    console.log(
      `[cdn:upload] cache-control assets="${assetCacheControl}" content="${contentCacheControl}"`
    );
  }

  for (const [command, commandArgs] of commands) {
    await runCommand(command, commandArgs);
  }

  console.log("[cdn:upload] Upload completed.");
}

function parseArgs(rawArgs) {
  const parsed = {
    bucket: "",
    dryRun: false,
    disableCacheControl: false,
    assetCacheControl: "",
    contentCacheControl: "",
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
      continue;
    }
    if (value === "--no-cache-control") {
      parsed.disableCacheControl = true;
      continue;
    }
    if (value === "--asset-cache-control") {
      parsed.assetCacheControl = rawArgs[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--content-cache-control") {
      parsed.contentCacheControl = rawArgs[index + 1] ?? "";
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

function resolveProjectId() {
  const candidates = [
    process.env.FIREBASE_PROJECT_ID,
    process.env.VITE_FIREBASE_PROJECT_ID,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function buildBucketCandidates(rawBucket, projectId) {
  const unique = new Set();
  const add = (value) => {
    const normalized = normalizeBucketName(value);
    if (normalized) {
      unique.add(normalized);
    }
  };

  add(rawBucket);
  if (rawBucket.includes(".firebasestorage.app")) {
    add(rawBucket.replace(/\.firebasestorage\.app$/i, ".appspot.com"));
  }
  if (rawBucket.includes(".appspot.com")) {
    add(rawBucket.replace(/\.appspot\.com$/i, ".firebasestorage.app"));
  }

  if (projectId) {
    add(`${projectId}.firebasestorage.app`);
    add(`${projectId}.appspot.com`);
  }

  return [...unique];
}

function normalizeBucketName(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    return "";
  }

  let normalized = value.replace(/^gs:\/\//i, "").replace(/\/+$/, "");
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      const host = parsed.hostname.toLowerCase();
      const pathParts = parsed.pathname.split("/").filter(Boolean);

      if (host === "storage.googleapis.com" && pathParts.length > 0) {
        normalized = pathParts[0];
      } else if (host.endsWith("firebasestorage.googleapis.com")) {
        const bucketIndex = pathParts.indexOf("b");
        if (bucketIndex >= 0 && pathParts[bucketIndex + 1]) {
          normalized = pathParts[bucketIndex + 1];
        }
      } else if (host.endsWith(".storage.googleapis.com")) {
        normalized = host.replace(/\.storage\.googleapis\.com$/, "");
      } else {
        normalized = host;
      }
    } catch {
      // Keep best-effort fallback from original value.
    }
  }

  normalized = normalized.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized;
}

async function resolveExistingBucket(candidates) {
  if (candidates.length === 0) {
    throw new Error(
      "No valid storage bucket candidates found. Check FIREBASE_STORAGE_BUCKET / FIREBASE_PROJECT_ID values."
    );
  }

  const failed = [];
  for (const candidate of candidates) {
    const bucketRef = `gs://${candidate}`;
    const result = await runCommandCapture("gcloud", [
      "storage",
      "buckets",
      "describe",
      bucketRef,
      "--format=value(name)",
    ]);
    if (result.code === 0) {
      return candidate;
    }

    const details = `${result.stdout}\n${result.stderr}`.trim();
    failed.push(`${bucketRef}: ${details || `exit ${result.code}`}`);

    const lower = details.toLowerCase();
    if (lower.includes("permission") || lower.includes("forbidden") || lower.includes("403")) {
      throw new Error(
        `Permission error while checking ${bucketRef}. Ensure the deploy service account has Storage admin access.`
      );
    }
  }

  const candidateList = candidates.map((candidate) => `gs://${candidate}`).join(", ");
  throw new Error(
    `No accessible storage bucket found. Tried: ${candidateList}\nHints:\n- Enable Firebase Storage in this project.\n- Set VITE_FIREBASE_STORAGE_BUCKET to the existing bucket name.\n- For older projects, bucket may be <project-id>.appspot.com.\nDetails:\n${failed.map((entry) => `  - ${entry}`).join("\n")}`
  );
}

function resolveAssetCacheControl(argValue) {
  const candidates = [argValue, process.env.ASSET_CACHE_CONTROL, "public,max-age=86400"];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "public,max-age=86400";
}

function resolveContentCacheControl(argValue) {
  const candidates = [
    argValue,
    process.env.CONTENT_CACHE_CONTROL,
    "public,max-age=300,must-revalidate",
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "public,max-age=300,must-revalidate";
}

function ensureCommandAvailable(command, commandArgs = ["--version"]) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      stdio: "ignore",
      shell: false,
    });

    child.on("error", (error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        reject(
          new Error(
            `Missing required CLI: ${command}. Install Google Cloud SDK and ensure \`${command}\` is in PATH.`
          )
        );
        return;
      }
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Unable to run '${command} ${commandArgs.join(" ")}'.`));
    });
  });
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

function runCommandCapture(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      stderr += error instanceof Error ? error.message : String(error);
      resolve({ code: 1, stdout, stderr });
    });
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

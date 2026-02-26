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
  const bucket = resolveBucketName(parsedArgs.bucket);

  if (!bucket) {
    throw new Error(
      "Missing bucket. Use --bucket <bucket> or set FIREBASE_STORAGE_BUCKET / VITE_FIREBASE_STORAGE_BUCKET."
    );
  }

  const dryRun = parsedArgs.dryRun;
  const shouldApplyCacheControl = !parsedArgs.disableCacheControl;
  const assetCacheControl = resolveAssetCacheControl(parsedArgs.assetCacheControl);
  const contentCacheControl = resolveContentCacheControl(parsedArgs.contentCacheControl);
  const bucketUri = `gs://${bucket.replace(/^gs:\/\//, "").replace(/\/+$/, "")}`;

  await ensureCommandAvailable("gcloud", ["version"]);

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

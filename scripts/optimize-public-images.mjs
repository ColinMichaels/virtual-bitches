import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const args = parseArgs(process.argv.slice(2));
const rootDirectory = path.resolve(projectRoot, args.rootDirectory);

const supportedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const stats = {
  processed: 0,
  optimized: 0,
  skipped: 0,
  bytesBefore: 0,
  bytesAfter: 0,
};

const imageMagickCommand = await resolveImageMagickCommand(args.requireTool);
if (!imageMagickCommand) {
  console.warn(
    "[assets:optimize] Skipping optimization: ImageMagick not installed (expected `magick` or `convert`)."
  );
  process.exit(0);
}
const imageFiles = await collectImageFiles(rootDirectory);

if (imageFiles.length === 0) {
  console.log(`[assets:optimize] No supported image files found under ${rootDirectory}`);
  process.exit(0);
}

for (const imageFile of imageFiles) {
  const extension = path.extname(imageFile).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    continue;
  }

  const beforeStat = await fs.stat(imageFile);
  const beforeBytes = beforeStat.size;
  stats.processed += 1;
  stats.bytesBefore += beforeBytes;

  const temporaryPath = `${imageFile}.optimized`;
  const commandArgs = buildOptimizeArgs(extension, imageFile, temporaryPath, args);

  try {
    await runCommand(imageMagickCommand, commandArgs);
    const afterStat = await fs.stat(temporaryPath);
    const afterBytes = afterStat.size;

    if (afterBytes < beforeBytes) {
      await fs.rename(temporaryPath, imageFile);
      stats.optimized += 1;
      stats.bytesAfter += afterBytes;
    } else {
      await fs.rm(temporaryPath, { force: true });
      stats.skipped += 1;
      stats.bytesAfter += beforeBytes;
    }
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw new Error(
      `[assets:optimize] Failed optimizing ${path.relative(projectRoot, imageFile)}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

const bytesSaved = Math.max(0, stats.bytesBefore - stats.bytesAfter);
const percentSaved =
  stats.bytesBefore > 0 ? ((bytesSaved / stats.bytesBefore) * 100).toFixed(2) : "0.00";

console.log(
  `[assets:optimize] processed=${stats.processed} optimized=${stats.optimized} skipped=${stats.skipped} ` +
    `saved=${formatBytes(bytesSaved)} (${percentSaved}%)`
);

function parseArgs(rawArgs) {
  const parsed = {
    rootDirectory: "public/assets",
    jpegQuality: 86,
    webpQuality: 82,
    requireTool: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];

    if (argument === "--root" && rawArgs[index + 1]) {
      parsed.rootDirectory = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--jpeg-quality" && rawArgs[index + 1]) {
      parsed.jpegQuality = clampQuality(rawArgs[index + 1], parsed.jpegQuality);
      index += 1;
      continue;
    }

    if (argument === "--webp-quality" && rawArgs[index + 1]) {
      parsed.webpQuality = clampQuality(rawArgs[index + 1], parsed.webpQuality);
      index += 1;
      continue;
    }

    if (argument === "--require-tool") {
      parsed.requireTool = true;
    }
  }

  return parsed;
}

function clampQuality(rawValue, fallback) {
  const numeric = Number.parseInt(String(rawValue), 10);
  if (Number.isNaN(numeric)) {
    return fallback;
  }
  return Math.max(1, Math.min(100, numeric));
}

function buildOptimizeArgs(extension, inputFile, outputFile, options) {
  if (extension === ".png") {
    return [
      inputFile,
      "-strip",
      "-define",
      "png:compression-level=9",
      "-define",
      "png:compression-filter=5",
      "-define",
      "png:compression-strategy=1",
      outputFile,
    ];
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return [
      inputFile,
      "-strip",
      "-interlace",
      "Plane",
      "-sampling-factor",
      "4:2:0",
      "-quality",
      String(options.jpegQuality),
      outputFile,
    ];
  }

  if (extension === ".webp") {
    return [
      inputFile,
      "-strip",
      "-define",
      "webp:method=6",
      "-quality",
      String(options.webpQuality),
      outputFile,
    ];
  }

  return [inputFile, outputFile];
}

async function resolveImageMagickCommand(requireTool) {
  for (const candidate of ["magick", "convert"]) {
    try {
      await runCommand(candidate, ["-version"]);
      return candidate;
    } catch {
      // Try next command.
    }
  }

  if (requireTool) {
    throw new Error(
      "[assets:optimize] ImageMagick command not found (expected `magick` or `convert`)."
    );
  }

  return "";
}

async function collectImageFiles(directory) {
  const directoryExists = await pathExists(directory);
  if (!directoryExists) {
    throw new Error(`[assets:optimize] Directory does not exist: ${directory}`);
  }

  const found = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectImageFiles(absolutePath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (supportedExtensions.has(extension)) {
      found.push(absolutePath);
    }
  }

  return found;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      shell: false,
      stdio: "pipe",
    });

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const details = stderr.trim();
      reject(new Error(details || `Command failed (${command} ${commandArgs.join(" ")})`));
    });
  });
}

function formatBytes(value) {
  if (value < 1024) {
    return `${value}B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)}KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(2)}MB`;
}

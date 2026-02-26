import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const CONTENT_SOURCE = path.join(projectRoot, "src", "content", "rules.md");
const CONTENT_DESTINATION = path.join(projectRoot, "public", "rules.md");

const THEME_SOURCE_ROOT = path.join(projectRoot, "src", "assets", "textures");
const THEME_DESTINATION_ROOT = path.join(projectRoot, "public", "assets", "themes");
const STATIC_ASSET_DIRECTORIES = [
  {
    source: path.join(projectRoot, "src", "assets", "ads"),
    destination: path.join(projectRoot, "public", "assets", "ads"),
  },
  {
    source: path.join(projectRoot, "src", "assets", "game-textures"),
    destination: path.join(projectRoot, "public", "assets", "game-textures"),
  },
  {
    source: path.join(projectRoot, "src", "assets", "logos"),
    destination: path.join(projectRoot, "public", "assets", "logos"),
  },
  {
    source: path.join(projectRoot, "src", "assets", "music"),
    destination: path.join(projectRoot, "public", "assets", "music"),
  },
];

const IGNORED_FILENAMES = new Set([".DS_Store"]);
const TIMESTAMP_EPSILON_MS = 1;
const args = new Set(process.argv.slice(2));
const shouldSyncThemes = args.has("--sync-themes");

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyFileIfNewer(sourcePath, destinationPath) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });

  const sourceStats = await fs.stat(sourcePath);
  const destinationExists = await pathExists(destinationPath);
  if (!destinationExists) {
    await fs.copyFile(sourcePath, destinationPath);
    return true;
  }

  const destinationStats = await fs.stat(destinationPath);
  const sourceIsNewer =
    sourceStats.mtimeMs > destinationStats.mtimeMs + TIMESTAMP_EPSILON_MS;

  if (sourceIsNewer) {
    await fs.copyFile(sourcePath, destinationPath);
    return true;
  }

  return false;
}

async function copyFileIfMissing(sourcePath, destinationPath) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  const destinationExists = await pathExists(destinationPath);
  if (destinationExists) {
    return false;
  }
  await fs.copyFile(sourcePath, destinationPath);
  return true;
}

async function copyFileAlways(sourcePath, destinationPath) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
  return true;
}

async function syncDirectory(sourceDir, destinationDir, copyStrategy) {
  let copiedCount = 0;
  const sourceExists = await pathExists(sourceDir);
  if (!sourceExists) {
    return copiedCount;
  }
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED_FILENAMES.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      copiedCount += await syncDirectory(sourcePath, destinationPath, copyStrategy);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const copied = await copyStrategy(sourcePath, destinationPath);
    if (copied) {
      copiedCount += 1;
    }
  }

  return copiedCount;
}

function collectThemeAssetReferences(themeConfig) {
  const refs = [];
  if (typeof themeConfig?.meshFile === "string" && themeConfig.meshFile) {
    refs.push(themeConfig.meshFile);
  }

  const material = themeConfig?.material;
  if (!material || typeof material !== "object") {
    return refs;
  }

  const diffuse = material.diffuseTexture;
  if (typeof diffuse === "string" && diffuse) {
    refs.push(diffuse);
  } else if (diffuse && typeof diffuse === "object") {
    if (typeof diffuse.light === "string" && diffuse.light) {
      refs.push(diffuse.light);
    }
    if (typeof diffuse.dark === "string" && diffuse.dark) {
      refs.push(diffuse.dark);
    }
  }

  if (typeof material.bumpTexture === "string" && material.bumpTexture) {
    refs.push(material.bumpTexture);
  }
  if (typeof material.specularTexture === "string" && material.specularTexture) {
    refs.push(material.specularTexture);
  }

  return refs;
}

async function validatePublicThemeAssets(themeRoot) {
  const errors = [];
  const entries = await fs.readdir(themeRoot, { withFileTypes: true });
  const availableThemes = new Set(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  );

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const themeName = entry.name;
    const themeDir = path.join(themeRoot, themeName);
    const configPath = path.join(themeDir, "theme.config.json");

    if (!(await pathExists(configPath))) {
      errors.push(`${themeName}: missing theme.config.json`);
      continue;
    }

    let config;
    try {
      const raw = await fs.readFile(configPath, "utf8");
      config = JSON.parse(raw);
    } catch (error) {
      errors.push(`${themeName}: invalid theme.config.json (${error.message})`);
      continue;
    }

    const fallbackTheme = config?.fallbackTheme;
    if (
      typeof fallbackTheme === "string" &&
      fallbackTheme &&
      !availableThemes.has(fallbackTheme)
    ) {
      errors.push(`${themeName}: missing fallback theme "${fallbackTheme}"`);
    }

    const refs = collectThemeAssetReferences(config);
    for (const ref of refs) {
      const resolved = path.join(themeDir, ref);
      if (!(await pathExists(resolved))) {
        errors.push(`${themeName}: missing "${ref}"`);
      }
    }
  }

  if (errors.length > 0) {
    const details = errors.map((error) => `- ${error}`).join("\n");
    throw new Error(`Theme asset validation failed:\n${details}`);
  }
}

async function run() {
  const copiedContent = await copyFileIfNewer(CONTENT_SOURCE, CONTENT_DESTINATION);
  const themeCopyStrategy = shouldSyncThemes ? copyFileAlways : copyFileIfMissing;
  const staticCopyStrategy = shouldSyncThemes ? copyFileAlways : copyFileIfNewer;
  const copiedThemeFiles = await syncDirectory(
    THEME_SOURCE_ROOT,
    THEME_DESTINATION_ROOT,
    themeCopyStrategy
  );
  let copiedStaticFiles = 0;
  for (const assetDirectory of STATIC_ASSET_DIRECTORIES) {
    copiedStaticFiles += await syncDirectory(
      assetDirectory.source,
      assetDirectory.destination,
      staticCopyStrategy
    );
  }
  await validatePublicThemeAssets(THEME_DESTINATION_ROOT);

  const contentStatus = copiedContent ? "updated" : "unchanged";
  const themeMode = shouldSyncThemes ? "full-sync" : "fill-missing";
  console.log(
    `[copy-assets] rules.md ${contentStatus}; mode=${themeMode}; synced ${copiedThemeFiles} theme file(s) + ${copiedStaticFiles} static asset file(s); theme assets validated`
  );
}

run().catch((error) => {
  console.error("[copy-assets] failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const BRAND_TOKEN_PATTERN = /\b(biscuits|bitches)\b/gi;

export const DEFAULT_REWRITE_INCLUDE_PATHS = [
  "src/",
  "index.html",
  "public/manifest.json",
  "public/rules.md",
];

export const PROTECTED_PATH_PREFIXES = [
  "api/",
  "scripts/",
  ".github/",
];

export const PROTECTED_PATHS = new Set([
  "firebase.json",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "public/updates.git.json",
  "public/updates.json",
]);

const WALK_SKIP_PREFIXES = [
  ".git/",
  "node_modules/",
  "dist/",
  "coverage/",
  "tmp/",
];

export function normalizeRelativePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function normalizeMatcherPath(matcher) {
  const normalized = normalizeRelativePath(String(matcher || "").trim());
  if (!normalized) {
    return "";
  }
  if (normalized.endsWith("/")) {
    return normalized;
  }
  return normalized;
}

export function isProtectedPath(filePath) {
  const normalized = normalizeRelativePath(filePath);
  if (PROTECTED_PATHS.has(normalized)) {
    return true;
  }
  return PROTECTED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function matchesIncludePath(filePath, includePaths = DEFAULT_REWRITE_INCLUDE_PATHS) {
  const normalized = normalizeRelativePath(filePath);
  for (const rawMatcher of includePaths) {
    const matcher = normalizeMatcherPath(rawMatcher);
    if (!matcher) {
      continue;
    }
    if (matcher.endsWith("/") && normalized.startsWith(matcher)) {
      return true;
    }
    if (normalized === matcher) {
      return true;
    }
  }
  return false;
}

export function classifyPath(filePath, includePaths = DEFAULT_REWRITE_INCLUDE_PATHS) {
  if (isProtectedPath(filePath)) {
    return "protected";
  }
  if (matchesIncludePath(filePath, includePaths)) {
    return "replaceable";
  }
  return "out_of_scope";
}

export function listProjectFiles(rootDir) {
  const tracked = tryListGitTrackedFiles(rootDir);
  if (tracked) {
    return tracked;
  }
  return walkFiles(rootDir, "");
}

function tryListGitTrackedFiles(rootDir) {
  try {
    const stdout = execFileSync("git", ["ls-files", "-z"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return stdout
      .split("\u0000")
      .map((entry) => normalizeRelativePath(entry))
      .filter(Boolean)
      .filter((entry) => !isWalkSkipped(entry));
  } catch {
    return null;
  }
}

function walkFiles(rootDir, relativeDir) {
  const absoluteDir = path.join(rootDir, relativeDir);
  const entries = readdirSync(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = normalizeRelativePath(path.join(relativeDir, entry.name));
    if (isWalkSkipped(relativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...walkFiles(rootDir, relativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function isWalkSkipped(relativePath) {
  return WALK_SKIP_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

export function readTextFileSafe(absolutePath) {
  try {
    const value = readFileSync(absolutePath, "utf8");
    if (value.includes("\u0000")) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function findBrandMatches(content) {
  const matches = [];
  const lines = content.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const regex = new RegExp(BRAND_TOKEN_PATTERN.source, BRAND_TOKEN_PATTERN.flags);
    let match = regex.exec(line);
    while (match) {
      matches.push({
        token: match[0],
        line: lineIndex + 1,
        column: match.index + 1,
      });
      match = regex.exec(line);
    }
  }

  return matches;
}

export function applyCasePattern(sourceToken, replacement) {
  if (!sourceToken) {
    return replacement;
  }
  if (sourceToken === sourceToken.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (sourceToken === sourceToken.toLowerCase()) {
    return replacement.toLowerCase();
  }
  if (isTitleCaseToken(sourceToken)) {
    return toTitleCase(replacement);
  }
  return replacement;
}

function isTitleCaseToken(value) {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  const first = normalized.charAt(0);
  const rest = normalized.slice(1);
  return first === first.toUpperCase() && rest === rest.toLowerCase();
}

function toTitleCase(value) {
  return value
    .split(/(\s+|-|_)/)
    .map((part) => {
      if (!part || /^\s+$/.test(part) || part === "-" || part === "_") {
        return part;
      }
      const lower = part.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

export function rewriteBrandTokens(content, replacement) {
  const regex = new RegExp(BRAND_TOKEN_PATTERN.source, BRAND_TOKEN_PATTERN.flags);
  let replacementCount = 0;
  const output = content.replace(regex, (token) => {
    replacementCount += 1;
    return applyCasePattern(token, replacement);
  });
  return {
    output,
    replacementCount,
  };
}

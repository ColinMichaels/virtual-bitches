import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const RECORD_SEPARATOR = "\u001e";
const FIELD_SEPARATOR = "\u001f";
const DEFAULT_MAX_COMMITS = 40;
const DEFAULT_OUTPUT_RELATIVE_PATH = "public/updates.git.json";

run().catch((error) => {
  console.error(
    `[updates:generate] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const maxCommits = Number.isFinite(options.maxCommits)
    ? Math.max(1, Math.floor(options.maxCommits))
    : DEFAULT_MAX_COMMITS;
  const outputPath = path.resolve(projectRoot, options.outputPath || DEFAULT_OUTPUT_RELATIVE_PATH);

  const version = await resolveVersion(options.version);
  const repositoryWebBaseUrl = resolveRepositoryWebBaseUrl();
  const commits = loadCommits(maxCommits);
  const updates = commits.map((commit) =>
    mapCommitToUpdate(commit, version, repositoryWebBaseUrl)
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "git",
    version,
    updates,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log(
    `[updates:generate] wrote ${updates.length} commit update(s) to ${path.relative(
      projectRoot,
      outputPath
    )}`
  );
}

function parseArgs(args) {
  const parsed = {
    maxCommits: DEFAULT_MAX_COMMITS,
    outputPath: DEFAULT_OUTPUT_RELATIVE_PATH,
    version: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--max") {
      const next = Number(args[index + 1]);
      if (Number.isFinite(next) && next > 0) {
        parsed.maxCommits = next;
      }
      index += 1;
      continue;
    }
    if (value === "--output") {
      const next = args[index + 1];
      if (typeof next === "string" && next.trim()) {
        parsed.outputPath = next.trim();
      }
      index += 1;
      continue;
    }
    if (value === "--version") {
      const next = args[index + 1];
      if (typeof next === "string" && next.trim()) {
        parsed.version = next.trim();
      }
      index += 1;
    }
  }

  return parsed;
}

async function resolveVersion(cliVersion) {
  if (typeof cliVersion === "string" && cliVersion.trim()) {
    return cliVersion.trim();
  }

  try {
    const packageJsonPath = path.join(projectRoot, "package.json");
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch {
    // Fallback below.
  }

  return "dev";
}

function loadCommits(maxCommits) {
  const prettyFormat = `%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`;
  const gitOutput = execFileSync(
    "git",
    ["log", `-n`, String(maxCommits), `--date=iso-strict`, `--pretty=format:${prettyFormat}`],
    {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  return gitOutput
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = "", shortHash = "", authoredAt = "", subject = "", body = ""] =
        record.split(FIELD_SEPARATOR);
      return {
        hash: hash.trim(),
        shortHash: shortHash.trim(),
        authoredAt: authoredAt.trim(),
        subject: subject.trim(),
        body: body.trim(),
      };
    })
    .filter((record) => {
      if (!record.hash || !record.shortHash || !record.subject) {
        return false;
      }
      const lowered = record.subject.toLowerCase();
      return !(lowered.startsWith("merge ") || lowered.startsWith("revert \"merge"));
    });
}

function mapCommitToUpdate(commit, version, repositoryWebBaseUrl) {
  const normalizedTitle = stripCommitPrefix(commit.subject);
  const type = inferUpdateType(commit.subject, commit.body);
  const bodySummary = summarizeBody(commit.body);
  const pullRequestNumber = extractPullRequestNumber(commit.subject, commit.body);
  const commitUrl =
    repositoryWebBaseUrl && commit.hash
      ? `${repositoryWebBaseUrl}/commit/${encodeURIComponent(commit.hash)}`
      : undefined;
  const pullRequestUrl =
    repositoryWebBaseUrl && Number.isFinite(pullRequestNumber)
      ? `${repositoryWebBaseUrl}/pull/${pullRequestNumber}`
      : undefined;

  const contentParts = [
    `<p>${escapeHtml(normalizedTitle)}</p>`,
    `<p><strong>Commit:</strong> <code>${escapeHtml(commit.shortHash)}</code></p>`,
  ];

  if (bodySummary) {
    contentParts.push(`<p>${escapeHtml(bodySummary)}</p>`);
  }

  return {
    id: `git-${commit.shortHash}`,
    date: normalizeDate(commit.authoredAt),
    title: normalizedTitle,
    content: contentParts.join(""),
    version,
    type,
    source: "commit",
    commit: {
      hash: commit.hash,
      shortHash: commit.shortHash,
      ...(commitUrl ? { url: commitUrl } : {}),
      ...(Number.isFinite(pullRequestNumber)
        ? {
            pullRequestNumber,
            ...(pullRequestUrl ? { pullRequestUrl } : {}),
          }
        : {}),
    },
  };
}

function resolveRepositoryWebBaseUrl() {
  try {
    const remoteUrl = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return normalizeRepositoryWebBaseUrl(remoteUrl);
  } catch {
    return undefined;
  }
}

function normalizeRepositoryWebBaseUrl(remoteUrl) {
  if (!remoteUrl || typeof remoteUrl !== "string") {
    return undefined;
  }

  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return undefined;
  }

  // git@github.com:owner/repo(.git)
  const scpStyleMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/i);
  if (scpStyleMatch) {
    return `https://${scpStyleMatch[1]}/${scpStyleMatch[2]}`.replace(/\/+$/, "");
  }

  // https://github.com/owner/repo(.git) or ssh://git@github.com/owner/repo(.git)
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname;
    const pathname = parsed.pathname.replace(/^\/+/, "").replace(/\.git$/i, "");
    if (!host || !pathname) {
      return undefined;
    }
    return `https://${host}/${pathname}`.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function extractPullRequestNumber(subject, body) {
  const haystack = `${subject || ""}\n${body || ""}`;
  const patterns = [
    /\(#(\d+)\)\s*$/m,
    /\bpull request\b[\s:#-]*(\d+)\b/i,
    /\bpr[\s:#-]+(\d+)\b/i,
    /\/pull\/(\d+)\b/i,
  ];

  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (!match) {
      continue;
    }
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return undefined;
}

function normalizeDate(rawDate) {
  const parsed = Date.parse(rawDate);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function stripCommitPrefix(subject) {
  const cleaned = subject.replace(/^[a-z]+(\([^)]+\))?!?:\s*/i, "").trim();
  return cleaned || subject.trim();
}

function summarizeBody(body) {
  if (!body) {
    return "";
  }

  const firstLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine || "";
}

function inferUpdateType(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();

  if (/\b(security|critical|cve|vulnerability|incident|outage)\b/.test(text)) {
    return "alert";
  }
  if (/\b(fix|bug|patch|hotfix|regression|resolve|resolved)\b/.test(text)) {
    return "bugfix";
  }
  if (/\b(feat|feature|add|added|new|introduce|support|enhance|improve|upgrade)\b/.test(text)) {
    return "feature";
  }
  return "announcement";
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

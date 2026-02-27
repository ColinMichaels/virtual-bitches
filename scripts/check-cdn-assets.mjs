const DEFAULT_RETRIES = 3;
const DEFAULT_DELAY_MS = 2000;
const DEFAULT_TIMEOUT_MS = 15000;

run().catch((error) => {
  console.error(`[cdn:verify] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.urls.length === 0) {
    throw new Error("No URLs provided. Use one or more --url <value> arguments.");
  }

  let successCount = 0;
  const failures = [];

  for (const rawUrl of options.urls) {
    const url = normalizeUrl(rawUrl);
    try {
      const result = await verifyUrl(url, options);
      successCount += 1;
      console.log(
        `[cdn:verify] ok ${url} status=${result.status} type="${result.contentType}" bytes=${result.bytes}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${url} -> ${message}`);
      console.error(`[cdn:verify] fail ${url}: ${message}`);
    }
  }

  if (failures.length > 0) {
    const details = failures.map((entry) => `- ${entry}`).join("\n");
    throw new Error(
      `Asset verification failed (${failures.length}/${options.urls.length}):\n${details}`
    );
  }

  console.log(`[cdn:verify] All assets verified (${successCount}/${options.urls.length}).`);
}

function parseArgs(rawArgs) {
  const options = {
    urls: [],
    retries: DEFAULT_RETRIES,
    delayMs: DEFAULT_DELAY_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const value = rawArgs[index];
    if (value === "--url" && rawArgs[index + 1]) {
      options.urls.push(rawArgs[index + 1]);
      index += 1;
      continue;
    }

    if (value === "--retries" && rawArgs[index + 1]) {
      options.retries = parsePositiveInteger(rawArgs[index + 1], DEFAULT_RETRIES);
      index += 1;
      continue;
    }

    if (value === "--delay-ms" && rawArgs[index + 1]) {
      options.delayMs = parsePositiveInteger(rawArgs[index + 1], DEFAULT_DELAY_MS);
      index += 1;
      continue;
    }

    if (value === "--timeout-ms" && rawArgs[index + 1]) {
      options.timeoutMs = parsePositiveInteger(rawArgs[index + 1], DEFAULT_TIMEOUT_MS);
      index += 1;
    }
  }

  return options;
}

function parsePositiveInteger(rawValue, fallback) {
  const parsed = Number.parseInt(String(rawValue), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function normalizeUrl(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) {
    throw new Error("Encountered empty URL argument.");
  }
  const parsed = new URL(value);
  return parsed.toString();
}

async function verifyUrl(url, options) {
  const attempts = Math.max(1, options.retries + 1);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            `HTTP ${response.status} (object not publicly readable at this URL; verify bucket IAM/storage rules for public CDN access)`
          );
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.includes("text/html")) {
        throw new Error(`unexpected content-type ${contentType || "(empty)"}`);
      }

      const data = await response.arrayBuffer();
      if (data.byteLength <= 0) {
        throw new Error("empty response body");
      }

      return {
        status: response.status,
        contentType: contentType || "(missing)",
        bytes: data.byteLength,
      };
    } catch (error) {
      const isLastAttempt = attempt >= attempts;
      if (isLastAttempt) {
        throw new Error(formatError(error));
      }
      await sleep(options.delayMs);
    }
  }

  throw new Error("unreachable verification state");
}

function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function formatError(error) {
  if (error instanceof Error) {
    const cause = error.cause;
    if (cause && typeof cause === "object") {
      const causeCode = "code" in cause ? String(cause.code) : "";
      const causeMessage = "message" in cause ? String(cause.message) : "";
      if (causeCode || causeMessage) {
        return `${error.message}${causeCode || causeMessage ? ` (${causeCode}${causeCode && causeMessage ? ": " : ""}${causeMessage})` : ""}`;
      }
    }
    return error.message;
  }
  return String(error);
}

const DEFAULT_ON_ERROR = "noop";

function normalizeId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeScope(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function normalizeTimeoutMs(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const fallbackParsed = Number(fallback);
    if (!Number.isFinite(fallbackParsed) || fallbackParsed <= 0) {
      return 0;
    }
    return Math.max(0, Math.floor(fallbackParsed));
  }
  return Math.max(0, Math.floor(parsed));
}

function normalizeOnError(value, fallback = DEFAULT_ON_ERROR) {
  if (value === "block" || value === "noop") {
    return value;
  }
  if (fallback === "block" || fallback === "noop") {
    return fallback;
  }
  return DEFAULT_ON_ERROR;
}

function normalizePolicy(value, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: normalizeBoolean(source.enabled, normalizeBoolean(fallback.enabled, true)),
    timeoutMs: normalizeTimeoutMs(source.timeoutMs, fallback.timeoutMs),
    onError: normalizeOnError(source.onError, fallback.onError),
  };
}

function resolveNowProvider(value) {
  return typeof value === "function" ? value : () => Date.now();
}

function resolveWarnLogger(value) {
  if (typeof value === "function") {
    return value;
  }
  return () => {};
}

function normalizeFilterOutcome(value) {
  if (!value || typeof value !== "object") {
    return {
      allowed: true,
      stateChanged: false,
    };
  }
  const allowed = value.allowed !== false;
  return {
    ...value,
    allowed,
    stateChanged: value.stateChanged === true,
    code:
      !allowed && typeof value.code === "string" && value.code.trim().length > 0
        ? value.code.trim()
        : "filter_blocked",
    reason:
      !allowed && typeof value.reason === "string" && value.reason.trim().length > 0
        ? value.reason.trim()
        : "filter_blocked",
  };
}

function createExecutionErrorCode(filterId, suffix) {
  return `filter_${filterId}_${suffix}`.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
}

export function createAddonFilterRegistry(dependencies = {}) {
  const now = resolveNowProvider(dependencies.now);
  const warn = resolveWarnLogger(dependencies.warn);
  const entries = [];
  const entryIndexById = new Map();

  function listFilters() {
    return entries.map((entry) => ({
      id: entry.id,
      scope: entry.scope,
      policy: { ...entry.policy },
    }));
  }

  function registerFilter(definition = {}) {
    const id = normalizeId(definition.id);
    if (!id) {
      throw new Error("Cannot register filter without id");
    }

    const scope = normalizeScope(definition.scope);
    if (!scope) {
      throw new Error(`Cannot register filter "${id}" without scope`);
    }

    const run = typeof definition.run === "function" ? definition.run : null;
    if (!run) {
      throw new Error(`Cannot register filter "${id}" without run(context)`);
    }

    const normalized = {
      id,
      scope,
      run,
      policy: normalizePolicy(definition.policy),
    };
    const existingIndex = entryIndexById.get(id);
    if (typeof existingIndex === "number") {
      entries[existingIndex] = normalized;
    } else {
      entries.push(normalized);
      entryIndexById.set(id, entries.length - 1);
    }

    return {
      id,
      scope,
      policy: { ...normalized.policy },
    };
  }

  function unregisterFilter(id) {
    const normalizedId = normalizeId(id);
    if (!normalizedId) {
      return false;
    }
    const index = entryIndexById.get(normalizedId);
    if (typeof index !== "number") {
      return false;
    }
    entries.splice(index, 1);
    entryIndexById.clear();
    entries.forEach((entry, entryIndex) => {
      entryIndexById.set(entry.id, entryIndex);
    });
    return true;
  }

  function setFilterPolicy(id, policy) {
    const normalizedId = normalizeId(id);
    if (!normalizedId) {
      return null;
    }
    const index = entryIndexById.get(normalizedId);
    if (typeof index !== "number") {
      return null;
    }
    const entry = entries[index];
    entry.policy = normalizePolicy(policy, entry.policy);
    return {
      id: entry.id,
      scope: entry.scope,
      policy: { ...entry.policy },
    };
  }

  function execute(scope, context = {}) {
    const normalizedScope = normalizeScope(scope);
    if (!normalizedScope) {
      return {
        allowed: true,
        stateChanged: false,
        diagnostics: [],
        outcome: null,
      };
    }

    const diagnostics = [];
    let stateChanged = false;
    for (const entry of entries) {
      if (entry.scope !== normalizedScope) {
        continue;
      }

      const policy = normalizePolicy(entry.policy);
      if (!policy.enabled) {
        diagnostics.push({
          id: entry.id,
          status: "disabled",
          durationMs: 0,
          timeoutMs: policy.timeoutMs,
          onError: policy.onError,
        });
        continue;
      }

      const startedAt = now();
      let rawOutcome = null;
      let durationMs = 0;
      try {
        rawOutcome = entry.run(context);
        if (rawOutcome && typeof rawOutcome.then === "function") {
          throw new Error(
            `Filter "${entry.id}" returned a Promise. Async filter execution is not supported in this path.`
          );
        }
        durationMs = Math.max(0, now() - startedAt);
      } catch (error) {
        durationMs = Math.max(0, now() - startedAt);
        const errorMessage = error instanceof Error ? error.message : String(error);
        diagnostics.push({
          id: entry.id,
          status: "error",
          durationMs,
          timeoutMs: policy.timeoutMs,
          onError: policy.onError,
          error: errorMessage,
        });
        warn(`Filter "${entry.id}" failed for scope "${normalizedScope}"`, error);

        if (policy.onError === "block") {
          return {
            allowed: false,
            blockedBy: entry.id,
            code: createExecutionErrorCode(entry.id, "error"),
            reason: "filter_error",
            stateChanged,
            diagnostics,
            outcome: null,
          };
        }
        continue;
      }

      const timedOut = policy.timeoutMs > 0 && durationMs > policy.timeoutMs;
      if (timedOut) {
        diagnostics.push({
          id: entry.id,
          status: "timeout",
          durationMs,
          timeoutMs: policy.timeoutMs,
          onError: policy.onError,
        });
        warn(
          `Filter "${entry.id}" exceeded timeout for scope "${normalizedScope}" (${durationMs}ms > ${policy.timeoutMs}ms)`
        );
        if (policy.onError === "block") {
          return {
            allowed: false,
            blockedBy: entry.id,
            code: createExecutionErrorCode(entry.id, "timeout"),
            reason: "filter_timeout",
            stateChanged,
            diagnostics,
            outcome: null,
          };
        }
        continue;
      }

      const outcome = normalizeFilterOutcome(rawOutcome);
      if (outcome.stateChanged) {
        stateChanged = true;
      }
      diagnostics.push({
        id: entry.id,
        status: outcome.allowed ? "passed" : "blocked",
        durationMs,
        timeoutMs: policy.timeoutMs,
        onError: policy.onError,
      });
      if (!outcome.allowed) {
        return {
          allowed: false,
          blockedBy: entry.id,
          code: outcome.code,
          reason: outcome.reason,
          stateChanged,
          diagnostics,
          outcome,
        };
      }
    }

    return {
      allowed: true,
      stateChanged,
      diagnostics,
      outcome: null,
    };
  }

  return Object.freeze({
    registerFilter,
    unregisterFilter,
    setFilterPolicy,
    listFilters,
    execute,
  });
}

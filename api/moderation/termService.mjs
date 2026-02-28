const CHAT_TERM_STATE_VERSION = 1;
const DEFAULT_MAX_MANAGED_TERMS = 2048;
const DEFAULT_MAX_REMOTE_TERMS = 4096;

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeTerm(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s'_-]/gu, "")
    .slice(0, 80);
}

function normalizeTermSet(rawTerms, maxCount) {
  const terms = new Set();
  if (rawTerms instanceof Set) {
    for (const term of rawTerms.values()) {
      const normalized = normalizeTerm(term);
      if (!normalized) {
        continue;
      }
      terms.add(normalized);
      if (terms.size >= maxCount) {
        break;
      }
    }
    return terms;
  }
  for (const term of Array.isArray(rawTerms) ? rawTerms : []) {
    const normalized = normalizeTerm(term);
    if (!normalized) {
      continue;
    }
    terms.add(normalized);
    if (terms.size >= maxCount) {
      break;
    }
  }
  return terms;
}

function normalizeManagedTermRecord(term, value, now) {
  const enabled = value?.enabled !== false;
  const addedAt = Number(value?.addedAt);
  const updatedAt = Number(value?.updatedAt);
  const note = typeof value?.note === "string" ? value.note.trim().slice(0, 160) : "";
  const addedBy = typeof value?.addedBy === "string" ? value.addedBy.trim().slice(0, 80) : "";
  return {
    term,
    enabled,
    addedAt: Number.isFinite(addedAt) && addedAt > 0 ? Math.floor(addedAt) : now,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : now,
    ...(note ? { note } : {}),
    ...(addedBy ? { addedBy } : {}),
  };
}

function normalizeRemoteTermRecord(term, value, now) {
  const updatedAt = Number(value?.updatedAt);
  return {
    term,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : now,
  };
}

function parseRemoteTermsPayload(payload, maxRemoteTerms) {
  const terms = new Set();
  const sourceList = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.terms)
      ? payload.terms
      : [];
  for (const entry of sourceList) {
    const candidate = typeof entry === "string" ? entry : entry?.term;
    const normalized = normalizeTerm(candidate);
    if (!normalized) {
      continue;
    }
    terms.add(normalized);
    if (terms.size >= maxRemoteTerms) {
      break;
    }
  }
  return terms;
}

export function createChatModerationTermService(options = {}) {
  const maxManagedTerms = normalizeInteger(
    options.maxManagedTerms,
    DEFAULT_MAX_MANAGED_TERMS,
    64,
    20000
  );
  const maxRemoteTerms = normalizeInteger(
    options.maxRemoteTerms,
    DEFAULT_MAX_REMOTE_TERMS,
    64,
    40000
  );
  const requestTimeoutMs = normalizeInteger(options.requestTimeoutMs, 6000, 1000, 30000);
  const remoteUrl =
    typeof options.remoteUrl === "string" && options.remoteUrl.trim().length > 0
      ? options.remoteUrl.trim()
      : "";
  const remoteApiKey =
    typeof options.remoteApiKey === "string" && options.remoteApiKey.trim().length > 0
      ? options.remoteApiKey.trim()
      : "";
  const remoteApiKeyHeader =
    typeof options.remoteApiKeyHeader === "string" && options.remoteApiKeyHeader.trim().length > 0
      ? options.remoteApiKeyHeader.trim()
      : "x-api-key";

  const seedTerms = normalizeTermSet(options.seedTerms, maxManagedTerms);
  const managedTerms = new Map();
  const remoteTerms = new Map();
  const meta = {
    version: CHAT_TERM_STATE_VERSION,
    lastRemoteSyncAt: 0,
    lastRemoteAttemptAt: 0,
    lastRemoteError: "",
  };

  function getActiveTerms() {
    const active = new Set(seedTerms);
    for (const record of managedTerms.values()) {
      if (record?.enabled !== false) {
        active.add(record.term);
      }
    }
    for (const record of remoteTerms.values()) {
      active.add(record.term);
    }
    return active;
  }

  function hydrateFromStore(rawState, now = Date.now()) {
    const source = rawState && typeof rawState === "object" ? rawState : {};
    managedTerms.clear();
    remoteTerms.clear();

    const rawManaged = source.managedTerms && typeof source.managedTerms === "object"
      ? source.managedTerms
      : {};
    const rawRemote = source.remoteTerms && typeof source.remoteTerms === "object"
      ? source.remoteTerms
      : {};

    const managedEntries = Object.entries(rawManaged)
      .map(([rawTerm, value]) => {
        const term = normalizeTerm(rawTerm);
        if (!term) {
          return null;
        }
        return normalizeManagedTermRecord(term, value, now);
      })
      .filter((entry) => entry !== null)
      .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt))
      .slice(0, maxManagedTerms);
    for (const record of managedEntries) {
      managedTerms.set(record.term, record);
    }

    const remoteEntries = Object.entries(rawRemote)
      .map(([rawTerm, value]) => {
        const term = normalizeTerm(rawTerm);
        if (!term) {
          return null;
        }
        return normalizeRemoteTermRecord(term, value, now);
      })
      .filter((entry) => entry !== null)
      .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt))
      .slice(0, maxRemoteTerms);
    for (const record of remoteEntries) {
      remoteTerms.set(record.term, record);
    }

    const lastRemoteSyncAt = Number(source?.meta?.lastRemoteSyncAt);
    const lastRemoteAttemptAt = Number(source?.meta?.lastRemoteAttemptAt);
    meta.lastRemoteSyncAt =
      Number.isFinite(lastRemoteSyncAt) && lastRemoteSyncAt > 0
        ? Math.floor(lastRemoteSyncAt)
        : 0;
    meta.lastRemoteAttemptAt =
      Number.isFinite(lastRemoteAttemptAt) && lastRemoteAttemptAt > 0
        ? Math.floor(lastRemoteAttemptAt)
        : 0;
    meta.lastRemoteError =
      typeof source?.meta?.lastRemoteError === "string"
        ? source.meta.lastRemoteError.trim().slice(0, 280)
        : "";
  }

  function exportToStoreState() {
    const nextManaged = {};
    for (const [term, record] of managedTerms.entries()) {
      nextManaged[term] = {
        enabled: record.enabled !== false,
        addedAt: record.addedAt,
        updatedAt: record.updatedAt,
        ...(record.note ? { note: record.note } : {}),
        ...(record.addedBy ? { addedBy: record.addedBy } : {}),
      };
    }

    const nextRemote = {};
    for (const [term, record] of remoteTerms.entries()) {
      nextRemote[term] = {
        updatedAt: record.updatedAt,
      };
    }

    return {
      version: CHAT_TERM_STATE_VERSION,
      managedTerms: nextManaged,
      remoteTerms: nextRemote,
      meta: {
        lastRemoteSyncAt: meta.lastRemoteSyncAt,
        lastRemoteAttemptAt: meta.lastRemoteAttemptAt,
        lastRemoteError: meta.lastRemoteError,
      },
    };
  }

  function getSnapshot(now = Date.now()) {
    const activeTerms = getActiveTerms();
    return {
      remoteConfigured: remoteUrl.length > 0,
      seedTermCount: seedTerms.size,
      managedTermCount: managedTerms.size,
      remoteTermCount: remoteTerms.size,
      activeTermCount: activeTerms.size,
      lastRemoteSyncAt: meta.lastRemoteSyncAt || null,
      lastRemoteAttemptAt: meta.lastRemoteAttemptAt || null,
      lastRemoteError: meta.lastRemoteError || null,
      remoteSyncStaleMs:
        meta.lastRemoteSyncAt > 0 ? Math.max(0, now - meta.lastRemoteSyncAt) : null,
      policy: {
        maxManagedTerms,
        maxRemoteTerms,
      },
      seedTerms: Array.from(seedTerms.values()).sort((left, right) => left.localeCompare(right)),
      managedTerms: Array.from(managedTerms.values())
        .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt)),
      remoteTerms: Array.from(remoteTerms.values())
        .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt)),
      activeTerms: Array.from(activeTerms.values()).sort((left, right) => left.localeCompare(right)),
    };
  }

  function upsertManagedTerm(rawTerm, options = {}) {
    const term = normalizeTerm(rawTerm);
    if (!term) {
      return { ok: false, reason: "invalid_term" };
    }
    if (!managedTerms.has(term) && managedTerms.size >= maxManagedTerms) {
      return { ok: false, reason: "max_terms_reached" };
    }

    const now =
      Number.isFinite(Number(options.timestamp)) && Number(options.timestamp) > 0
        ? Math.floor(Number(options.timestamp))
        : Date.now();
    const previous = managedTerms.get(term);
    const record = normalizeManagedTermRecord(
      term,
      {
        ...previous,
        ...options,
        addedAt: previous?.addedAt ?? options?.addedAt ?? now,
        updatedAt: now,
      },
      now
    );
    managedTerms.set(term, record);
    return {
      ok: true,
      term,
      record,
      created: !previous,
    };
  }

  function removeManagedTerm(rawTerm) {
    const term = normalizeTerm(rawTerm);
    if (!term) {
      return { ok: false, reason: "invalid_term" };
    }
    const existed = managedTerms.delete(term);
    return {
      ok: true,
      term,
      removed: existed,
    };
  }

  async function refreshFromRemote(fetchImpl = globalThis.fetch, now = Date.now()) {
    if (!remoteUrl) {
      return {
        ok: false,
        reason: "remote_not_configured",
        changed: false,
      };
    }
    if (typeof fetchImpl !== "function") {
      return {
        ok: false,
        reason: "fetch_unavailable",
        changed: false,
      };
    }

    meta.lastRemoteAttemptAt = now;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, requestTimeoutMs);

    let response;
    try {
      const headers = {};
      if (remoteApiKey) {
        headers[remoteApiKeyHeader] = remoteApiKey;
      }
      response = await fetchImpl(remoteUrl, {
        method: "GET",
        headers,
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutHandle);
      meta.lastRemoteError = String(error).slice(0, 280);
      return {
        ok: false,
        reason: "remote_fetch_failed",
        changed: false,
        error: meta.lastRemoteError,
      };
    }
    clearTimeout(timeoutHandle);

    if (!response.ok) {
      meta.lastRemoteError = `status_${response.status}`;
      return {
        ok: false,
        reason: "remote_http_error",
        status: response.status,
        changed: false,
      };
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      meta.lastRemoteError = "invalid_json";
      return {
        ok: false,
        reason: "invalid_json",
        changed: false,
      };
    }

    const parsedTerms = parseRemoteTermsPayload(payload, maxRemoteTerms);
    const nextRemote = new Map();
    const syncAt = Date.now();
    for (const term of parsedTerms.values()) {
      nextRemote.set(term, { term, updatedAt: syncAt });
    }

    const previousTerms = Array.from(remoteTerms.keys()).sort((left, right) =>
      left.localeCompare(right)
    );
    const nextTerms = Array.from(nextRemote.keys()).sort((left, right) =>
      left.localeCompare(right)
    );
    const changed =
      previousTerms.length !== nextTerms.length ||
      previousTerms.some((term, index) => term !== nextTerms[index]);

    remoteTerms.clear();
    for (const [term, record] of nextRemote.entries()) {
      remoteTerms.set(term, record);
    }
    meta.lastRemoteSyncAt = syncAt;
    meta.lastRemoteError = "";

    return {
      ok: true,
      changed,
      remoteTermCount: remoteTerms.size,
      activeTermCount: getActiveTerms().size,
      syncedAt: syncAt,
    };
  }

  return {
    hydrateFromStore,
    exportToStoreState,
    getActiveTerms,
    getSnapshot,
    upsertManagedTerm,
    removeManagedTerm,
    refreshFromRemote,
  };
}

const CHAT_CONDUCT_STATE_VERSION = 1;
const DEFAULT_MAX_PLAYER_RECORDS = 512;
const DEFAULT_MAX_STRIKE_EVENTS_PER_PLAYER = 32;

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeMessageForTermScan(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeTermSet(rawTerms, maxTerms = 512) {
  const terms = new Set();
  if (rawTerms instanceof Set) {
    for (const term of rawTerms.values()) {
      const normalized = typeof term === "string" ? normalizeMessageForTermScan(term) : "";
      if (!normalized) {
        continue;
      }
      terms.add(normalized);
      if (terms.size >= maxTerms) {
        break;
      }
    }
    return terms;
  }

  if (Array.isArray(rawTerms)) {
    for (const term of rawTerms) {
      const normalized = typeof term === "string" ? normalizeMessageForTermScan(term) : "";
      if (!normalized) {
        continue;
      }
      terms.add(normalized);
      if (terms.size >= maxTerms) {
        break;
      }
    }
  }
  return terms;
}

function normalizeStrikeEvents(rawEvents, now, strikeWindowMs, maxStrikeEventsPerPlayer) {
  if (!Array.isArray(rawEvents)) {
    return [];
  }

  const minimumTimestamp = now - strikeWindowMs;
  return rawEvents
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > minimumTimestamp && value <= now)
    .map((value) => Math.floor(value))
    .sort((left, right) => left - right)
    .slice(-maxStrikeEventsPerPlayer);
}

function normalizeChatConductPlayerRecord(
  value,
  now,
  strikeWindowMs,
  maxStrikeEventsPerPlayer
) {
  const strikeEvents = normalizeStrikeEvents(
    value?.strikeEvents,
    now,
    strikeWindowMs,
    maxStrikeEventsPerPlayer
  );
  const totalStrikes = normalizeInteger(
    value?.totalStrikes,
    strikeEvents.length,
    0,
    1000000
  );
  const lastViolationAt = normalizeInteger(
    value?.lastViolationAt,
    strikeEvents[strikeEvents.length - 1] ?? 0,
    0,
    Number.MAX_SAFE_INTEGER
  );
  const mutedUntilRaw = Number(value?.mutedUntil);
  const mutedUntil =
    Number.isFinite(mutedUntilRaw) && mutedUntilRaw > now
      ? Math.floor(mutedUntilRaw)
      : 0;

  return {
    strikeEvents,
    totalStrikes,
    lastViolationAt,
    mutedUntil,
  };
}

function getOrCreatePlayerRecord(
  state,
  playerId,
  now,
  strikeWindowMs,
  maxStrikeEventsPerPlayer
) {
  const existing = state.players[playerId];
  const normalized = normalizeChatConductPlayerRecord(
    existing,
    now,
    strikeWindowMs,
    maxStrikeEventsPerPlayer
  );
  state.players[playerId] = normalized;
  return normalized;
}

export function createEmptyChatConductState() {
  return {
    version: CHAT_CONDUCT_STATE_VERSION,
    players: {},
  };
}

export function createChatConductPolicy(options = {}) {
  const bannedTerms = normalizeTermSet(options.bannedTerms);
  const strikeLimit = normalizeInteger(options.strikeLimit, 3, 1, 25);
  const strikeWindowMs = normalizeInteger(options.strikeWindowMs, 15 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000);
  const muteDurationMs = normalizeInteger(options.muteDurationMs, 5 * 60 * 1000, 0, 24 * 60 * 60 * 1000);
  const autoBanStrikeLimit = normalizeInteger(options.autoBanStrikeLimit, 0, 0, 1000);
  const maxPlayerRecords = normalizeInteger(
    options.maxPlayerRecords,
    DEFAULT_MAX_PLAYER_RECORDS,
    8,
    4096
  );
  const maxStrikeEventsPerPlayer = normalizeInteger(
    options.maxStrikeEventsPerPlayer,
    DEFAULT_MAX_STRIKE_EVENTS_PER_PLAYER,
    4,
    128
  );

  return {
    enabled: options.enabled !== false,
    publicOnly: options.publicOnly !== false,
    bannedTerms,
    strikeLimit,
    strikeWindowMs,
    muteDurationMs,
    autoBanStrikeLimit,
    maxPlayerRecords,
    maxStrikeEventsPerPlayer,
  };
}

export function normalizeChatConductState(value, policy = {}, now = Date.now()) {
  const base = createEmptyChatConductState();
  if (!value || typeof value !== "object") {
    return base;
  }

  const maxPlayerRecords = normalizeInteger(
    policy.maxPlayerRecords,
    DEFAULT_MAX_PLAYER_RECORDS,
    8,
    4096
  );
  const strikeWindowMs = normalizeInteger(
    policy.strikeWindowMs,
    15 * 60 * 1000,
    60 * 1000,
    24 * 60 * 60 * 1000
  );
  const maxStrikeEventsPerPlayer = normalizeInteger(
    policy.maxStrikeEventsPerPlayer,
    DEFAULT_MAX_STRIKE_EVENTS_PER_PLAYER,
    4,
    128
  );

  const entries = Object.entries(value.players ?? {})
    .map(([rawPlayerId, rawRecord]) => {
      const playerId = typeof rawPlayerId === "string" ? rawPlayerId.trim() : "";
      if (!playerId) {
        return null;
      }
      const record = normalizeChatConductPlayerRecord(
        rawRecord,
        now,
        strikeWindowMs,
        maxStrikeEventsPerPlayer
      );
      return {
        playerId,
        record,
      };
    })
    .filter((entry) => entry !== null)
    .sort((left, right) => right.record.lastViolationAt - left.record.lastViolationAt)
    .slice(0, maxPlayerRecords);

  for (const entry of entries) {
    base.players[entry.playerId] = entry.record;
  }
  return base;
}

export function evaluateRoomChannelConduct({
  policy,
  state,
  playerId,
  channel,
  message,
  now = Date.now(),
}) {
  const normalizedPlayerId = typeof playerId === "string" ? playerId.trim() : "";
  if (!normalizedPlayerId) {
    return { allowed: true, stateChanged: false };
  }
  if (!policy?.enabled) {
    return { allowed: true, stateChanged: false };
  }
  if (!(policy.bannedTerms instanceof Set) || policy.bannedTerms.size === 0) {
    return { allowed: true, stateChanged: false };
  }
  if (policy.publicOnly && channel !== "public") {
    return { allowed: true, stateChanged: false };
  }

  if (!state || typeof state !== "object") {
    return { allowed: true, stateChanged: false };
  }
  if (!state.players || typeof state.players !== "object") {
    state.players = {};
  }
  const hadExistingRecord = Object.prototype.hasOwnProperty.call(
    state.players,
    normalizedPlayerId
  );

  const record = getOrCreatePlayerRecord(
    state,
    normalizedPlayerId,
    now,
    policy.strikeWindowMs,
    policy.maxStrikeEventsPerPlayer
  );
  let stateChanged = !hadExistingRecord;

  if (record.mutedUntil > now) {
    return {
      allowed: false,
      code: "room_channel_sender_muted",
      reason: "room_channel_sender_muted",
      mutedUntil: record.mutedUntil,
      strikeCount: record.strikeEvents.length,
      strikeLimit: policy.strikeLimit,
      totalStrikes: record.totalStrikes,
      stateChanged,
    };
  }

  if (record.mutedUntil > 0) {
    record.mutedUntil = 0;
    stateChanged = true;
  }

  const normalizedMessage = normalizeMessageForTermScan(message);
  if (!normalizedMessage) {
    return { allowed: true, stateChanged };
  }

  let blockedTerm = "";
  for (const term of policy.bannedTerms) {
    if (!term) {
      continue;
    }
    if (normalizedMessage.includes(term)) {
      blockedTerm = term;
      break;
    }
  }

  if (!blockedTerm) {
    return { allowed: true, stateChanged };
  }

  record.strikeEvents.push(now);
  if (record.strikeEvents.length > policy.maxStrikeEventsPerPlayer) {
    record.strikeEvents.splice(0, record.strikeEvents.length - policy.maxStrikeEventsPerPlayer);
  }
  record.totalStrikes = Math.max(record.totalStrikes, 0) + 1;
  record.lastViolationAt = now;

  const strikeCount = record.strikeEvents.length;
  const reachedStrikeLimit = strikeCount >= policy.strikeLimit;
  if (reachedStrikeLimit && policy.muteDurationMs > 0) {
    record.mutedUntil = now + policy.muteDurationMs;
  }

  const shouldAutoBan =
    policy.autoBanStrikeLimit > 0 && record.totalStrikes >= policy.autoBanStrikeLimit;
  return {
    allowed: false,
    code: "room_channel_message_blocked",
    reason: "conduct_violation",
    blockedTerm,
    strikeCount,
    strikeLimit: policy.strikeLimit,
    totalStrikes: record.totalStrikes,
    mutedUntil: record.mutedUntil,
    shouldAutoBan,
    stateChanged: true,
  };
}

function formatDurationLabel(ms) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds >= 60) {
    const minutes = Math.ceil(totalSeconds / 60);
    return `${minutes}m`;
  }
  return `${totalSeconds}s`;
}

export function buildChatConductWarning(evaluation, now = Date.now()) {
  if (!evaluation || typeof evaluation !== "object") {
    return null;
  }
  if (evaluation.code === "room_channel_sender_muted") {
    const mutedUntil = Number(evaluation.mutedUntil);
    const remainingMs =
      Number.isFinite(mutedUntil) && mutedUntil > now ? mutedUntil - now : 0;
    return {
      title: "Chat muted",
      message:
        remainingMs > 0
          ? `Chat is temporarily muted for ${formatDurationLabel(remainingMs)}.`
          : "Chat is temporarily muted.",
      detail: `Strike ${Math.max(0, Number(evaluation.strikeCount) || 0)}/${Math.max(1, Number(evaluation.strikeLimit) || 1)}.`,
      severity: "warning",
    };
  }

  const strikeCount = Math.max(1, Number(evaluation.strikeCount) || 1);
  const strikeLimit = Math.max(1, Number(evaluation.strikeLimit) || 1);
  const mutedUntil = Number(evaluation.mutedUntil);
  const mutedActive = Number.isFinite(mutedUntil) && mutedUntil > now;
  return {
    title: "Chat warning",
    message: mutedActive
      ? `Message blocked by language filter. Chat muted for ${formatDurationLabel(mutedUntil - now)}.`
      : "Message blocked by language filter.",
    detail: `Strike ${strikeCount}/${strikeLimit}.`,
    severity: "warning",
  };
}

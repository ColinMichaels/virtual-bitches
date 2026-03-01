import { createHash, randomBytes } from "node:crypto";

export function createTokenAuthAdapter({
  getStore,
  accessTokenTtlMs,
  refreshTokenTtlMs,
  now = () => Date.now(),
  generateToken = () => randomBytes(24).toString("base64url"),
}) {
  if (typeof getStore !== "function") {
    throw new Error("Token auth adapter requires getStore()");
  }
  if (!Number.isFinite(accessTokenTtlMs) || accessTokenTtlMs <= 0) {
    throw new Error("Token auth adapter requires a positive accessTokenTtlMs");
  }
  if (!Number.isFinite(refreshTokenTtlMs) || refreshTokenTtlMs <= 0) {
    throw new Error("Token auth adapter requires a positive refreshTokenTtlMs");
  }

  function resolveTokenBuckets() {
    const store = getStore();
    if (!store || typeof store !== "object") {
      throw new Error("Token auth adapter store is unavailable");
    }

    if (!store.accessTokens || typeof store.accessTokens !== "object") {
      store.accessTokens = {};
    }
    if (!store.refreshTokens || typeof store.refreshTokens !== "object") {
      store.refreshTokens = {};
    }

    return {
      accessTokens: store.accessTokens,
      refreshTokens: store.refreshTokens,
    };
  }

  function issueAuthTokenBundle(playerId, sessionId) {
    const timestamp = now();
    const accessToken = generateToken();
    const refreshToken = generateToken();
    const accessRecord = {
      playerId,
      sessionId,
      expiresAt: timestamp + accessTokenTtlMs,
      issuedAt: timestamp,
    };
    const refreshRecord = {
      playerId,
      sessionId,
      expiresAt: timestamp + refreshTokenTtlMs,
      issuedAt: timestamp,
    };

    const { accessTokens, refreshTokens } = resolveTokenBuckets();
    accessTokens[hashToken(accessToken)] = accessRecord;
    refreshTokens[hashToken(refreshToken)] = refreshRecord;

    return {
      accessToken,
      refreshToken,
      expiresAt: accessRecord.expiresAt,
      tokenType: "Bearer",
    };
  }

  function verifyAccessToken(token) {
    const normalizedToken = normalizeToken(token);
    if (!normalizedToken) {
      return null;
    }

    const { accessTokens } = resolveTokenBuckets();
    const tokenHash = hashToken(normalizedToken);
    const record = accessTokens[tokenHash];
    if (!record) {
      return null;
    }

    if (!Number.isFinite(record.expiresAt) || record.expiresAt <= now()) {
      delete accessTokens[tokenHash];
      return null;
    }

    return record;
  }

  function verifyRefreshToken(token) {
    const normalizedToken = normalizeToken(token);
    if (!normalizedToken) {
      return null;
    }

    const { refreshTokens } = resolveTokenBuckets();
    const tokenHash = hashToken(normalizedToken);
    const record = refreshTokens[tokenHash];
    if (!record) {
      return null;
    }

    if (!Number.isFinite(record.expiresAt) || record.expiresAt <= now()) {
      delete refreshTokens[tokenHash];
      return null;
    }

    return record;
  }

  function revokeRefreshToken(token) {
    const normalizedToken = normalizeToken(token);
    if (!normalizedToken) {
      return false;
    }

    const { refreshTokens } = resolveTokenBuckets();
    const tokenHash = hashToken(normalizedToken);
    if (!Object.prototype.hasOwnProperty.call(refreshTokens, tokenHash)) {
      return false;
    }

    delete refreshTokens[tokenHash];
    return true;
  }

  function extractBearerToken(header) {
    if (typeof header !== "string") {
      return "";
    }
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match ? match[1].trim() : "";
  }

  return {
    issueAuthTokenBundle,
    verifyAccessToken,
    verifyRefreshToken,
    revokeRefreshToken,
    extractBearerToken,
  };
}

function normalizeToken(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function hashToken(value) {
  return createHash("sha256").update(value).digest("hex");
}

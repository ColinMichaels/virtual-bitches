export function createRequestAuthorizer({
  extractBearerToken,
  verifyAccessToken,
  verifyFirebaseIdToken,
  normalizeAvatarUrl,
  normalizeProviderId,
}) {
  const parseBearerToken =
    typeof extractBearerToken === "function" ? extractBearerToken : () => "";
  const parseAccessToken = typeof verifyAccessToken === "function" ? verifyAccessToken : () => null;
  const verifyIdentityToken =
    typeof verifyFirebaseIdToken === "function"
      ? verifyFirebaseIdToken
      : async () => ({ ok: false, reason: "identity_verifier_unavailable" });
  const normalizeAvatar =
    typeof normalizeAvatarUrl === "function" ? normalizeAvatarUrl : (value) => value;
  const normalizeProvider =
    typeof normalizeProviderId === "function" ? normalizeProviderId : (value) => value;

  async function authorizeIdentityRequest(req, options = {}) {
    const header =
      typeof req?.headers?.authorization === "string" ? req.headers.authorization : "";
    if (!header) {
      return { ok: false, reason: "missing_authorization_header" };
    }

    const token = parseBearerToken(header);
    if (!token) {
      return { ok: false, reason: "invalid_bearer_header" };
    }

    if (options.allowSessionToken) {
      const accessRecord = parseAccessToken(token);
      if (accessRecord) {
        return {
          ok: true,
          uid: `local:${accessRecord.playerId}`,
          displayName: accessRecord.playerId,
          email: undefined,
          photoUrl: undefined,
          isAnonymous: true,
          provider: "session",
          providerId: "session",
        };
      }
    }

    const firebaseVerification = await verifyIdentityToken(token);
    if (!firebaseVerification?.ok) {
      return { ok: false, reason: firebaseVerification?.reason };
    }

    const firebaseClaims =
      firebaseVerification.claims && typeof firebaseVerification.claims === "object"
        ? firebaseVerification.claims
        : {};
    if (options.requireNonAnonymous && firebaseClaims.isAnonymous) {
      return {
        ok: false,
        reason: "anonymous_not_allowed",
      };
    }

    return {
      ok: true,
      uid: firebaseClaims.uid,
      displayName: firebaseClaims.name,
      email: firebaseClaims.email,
      photoUrl: normalizeAvatar(firebaseClaims.picture),
      isAnonymous: Boolean(firebaseClaims.isAnonymous),
      provider: "firebase",
      providerId: normalizeProvider(firebaseClaims.signInProvider),
    };
  }

  function authorizeRequest(req, expectedPlayerId, expectedSessionId) {
    const header =
      typeof req?.headers?.authorization === "string" ? req.headers.authorization : "";
    if (!header) {
      return { ok: true };
    }

    const token = parseBearerToken(header);
    if (!token) {
      return { ok: false };
    }

    const record = parseAccessToken(token);
    if (!record) {
      return { ok: false };
    }

    if (expectedPlayerId && record.playerId !== expectedPlayerId) {
      return { ok: false };
    }
    if (expectedSessionId && record.sessionId !== expectedSessionId) {
      return { ok: false };
    }

    return { ok: true, playerId: record.playerId, sessionId: record.sessionId };
  }

  function authorizeSessionActionRequest(req, expectedPlayerId, expectedSessionId) {
    const header =
      typeof req?.headers?.authorization === "string" ? req.headers.authorization : "";
    if (!header) {
      return { ok: false, reason: "missing_authorization_header" };
    }

    const token = parseBearerToken(header);
    if (!token) {
      return { ok: false, reason: "invalid_bearer_header" };
    }

    const record = parseAccessToken(token);
    if (!record) {
      return { ok: false, reason: "invalid_or_expired_access_token" };
    }

    if (expectedPlayerId && record.playerId !== expectedPlayerId) {
      return { ok: false, reason: "player_mismatch" };
    }
    if (expectedSessionId && record.sessionId !== expectedSessionId) {
      return { ok: false, reason: "session_mismatch" };
    }

    return { ok: true, playerId: record.playerId, sessionId: record.sessionId };
  }

  function shouldRetrySessionAuthFromStore(reason) {
    return (
      reason === "invalid_or_expired_access_token" ||
      reason === "player_mismatch" ||
      reason === "session_mismatch"
    );
  }

  return {
    authorizeIdentityRequest,
    authorizeRequest,
    authorizeSessionActionRequest,
    shouldRetrySessionAuthFromStore,
  };
}

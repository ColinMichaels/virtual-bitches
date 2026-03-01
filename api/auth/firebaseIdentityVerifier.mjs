export function createFirebaseIdentityVerifier({
  firebaseAuthMode,
  firebaseProjectId,
  firebaseWebApiKey,
  serviceAccountJson,
  fetchImpl,
  now = () => Date.now(),
  normalizeReason = defaultNormalizeReason,
  importFirebaseAdminApp = () => import("firebase-admin/app"),
  importFirebaseAdminAuth = () => import("firebase-admin/auth"),
  log,
}) {
  const authMode = normalizeFirebaseAuthMode(firebaseAuthMode);
  const projectId = normalizeOptionalString(firebaseProjectId);
  const webApiKey = normalizeOptionalString(firebaseWebApiKey);
  const normalizedServiceAccountJson = normalizeOptionalString(serviceAccountJson);

  const firebaseTokenCache = new Map();
  const resolveAdminAuthClient = createFirebaseAdminAuthClientResolver({
    authMode,
    projectId,
    serviceAccountJson: normalizedServiceAccountJson,
    importFirebaseAdminApp,
    importFirebaseAdminAuth,
    log,
  });

  async function verifyFirebaseIdToken(idToken) {
    const token = typeof idToken === "string" ? idToken : "";
    const nowMs = now();
    const cached = firebaseTokenCache.get(token);
    if (cached && cached.expiresAt > nowMs + 5000) {
      return {
        ok: true,
        claims: cached,
      };
    }

    const adminResult = await verifyFirebaseIdTokenWithAdmin(token);
    if (adminResult) {
      if (adminResult.ok) {
        firebaseTokenCache.set(token, adminResult.claims);
      }
      return adminResult;
    }

    return verifyFirebaseIdTokenWithLegacyLookup(token, nowMs);
  }

  async function verifyFirebaseIdTokenWithAdmin(token) {
    if (authMode === "legacy") {
      return null;
    }

    const authClient = await resolveAdminAuthClient();
    if (!authClient) {
      if (authMode === "admin") {
        return {
          ok: false,
          reason: "firebase_admin_unavailable",
        };
      }
      return null;
    }

    try {
      const decoded = await authClient.verifyIdToken(token, true);
      const audience = typeof decoded?.aud === "string" ? decoded.aud : "";
      const issuer = typeof decoded?.iss === "string" ? decoded.iss : "";
      if (projectId && audience && audience !== projectId) {
        return {
          ok: false,
          reason: "firebase_audience_mismatch",
        };
      }
      if (projectId && issuer) {
        const expectedIssuer = `https://securetoken.google.com/${projectId}`;
        if (issuer !== expectedIssuer) {
          return {
            ok: false,
            reason: "firebase_issuer_mismatch",
          };
        }
      }

      const signInProvider =
        typeof decoded?.firebase?.sign_in_provider === "string"
          ? decoded.firebase.sign_in_provider
          : "";
      const claims = {
        uid: typeof decoded?.uid === "string" ? decoded.uid : "",
        email: typeof decoded?.email === "string" ? decoded.email : undefined,
        name: typeof decoded?.name === "string" ? decoded.name : undefined,
        picture: typeof decoded?.picture === "string" ? decoded.picture : undefined,
        signInProvider,
        isAnonymous: signInProvider === "anonymous",
        expiresAt:
          typeof decoded?.exp === "number"
            ? decoded.exp * 1000
            : now() + 5 * 60 * 1000,
      };

      if (!claims.uid) {
        return {
          ok: false,
          reason: "firebase_token_missing_uid",
        };
      }

      return {
        ok: true,
        claims,
      };
    } catch (error) {
      return {
        ok: false,
        reason: normalizeFirebaseAdminReason(error, normalizeReason),
      };
    }
  }

  async function verifyFirebaseIdTokenWithLegacyLookup(token, nowMs) {
    if (!webApiKey) {
      return {
        ok: false,
        reason: "firebase_api_key_not_configured",
      };
    }

    const decoded = decodeJwtPayload(token);
    const audience = typeof decoded?.aud === "string" ? decoded.aud : "";
    const issuer = typeof decoded?.iss === "string" ? decoded.iss : "";
    if (projectId && audience && audience !== projectId) {
      log?.warn?.(
        `Rejected Firebase token with mismatched project audience (expected=${projectId}, actual=${audience})`
      );
      return {
        ok: false,
        reason: "firebase_audience_mismatch",
      };
    }
    if (projectId && issuer) {
      const expectedIssuer = `https://securetoken.google.com/${projectId}`;
      if (issuer !== expectedIssuer) {
        log?.warn?.(
          `Rejected Firebase token with mismatched issuer (expected=${expectedIssuer}, actual=${issuer})`
        );
        return {
          ok: false,
          reason: "firebase_issuer_mismatch",
        };
      }
    }

    const endpoint = new URL("https://identitytoolkit.googleapis.com/v1/accounts:lookup");
    endpoint.searchParams.set("key", webApiKey);

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          idToken: token,
        }),
      });
    } catch (error) {
      log?.warn?.("Failed to call Firebase accounts:lookup", error);
      return {
        ok: false,
        reason: "firebase_lookup_request_failed",
      };
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      log?.warn?.("Invalid Firebase accounts:lookup JSON response", error);
      return {
        ok: false,
        reason: "firebase_lookup_invalid_json",
      };
    }

    if (!response.ok) {
      const remoteMessage =
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : `HTTP_${response.status}`;

      return {
        ok: false,
        reason: `firebase_lookup_${normalizeReason(remoteMessage)}`,
      };
    }

    const users = Array.isArray(payload?.users) ? payload.users : [];
    const user = users[0] ?? null;
    const uid = user && typeof user.localId === "string" ? user.localId.trim() : "";
    const exp = Number(decoded?.exp ?? 0);
    const expiresAt = Number.isFinite(exp) ? exp * 1000 : nowMs + 5 * 60 * 1000;

    if (!uid) {
      return {
        ok: false,
        reason: "firebase_token_missing_uid",
      };
    }

    const claims = {
      uid,
      email: user && typeof user.email === "string" ? user.email : undefined,
      name: user && typeof user.displayName === "string" ? user.displayName : undefined,
      picture: user && typeof user.photoUrl === "string" ? user.photoUrl : undefined,
      signInProvider:
        typeof decoded?.firebase?.sign_in_provider === "string"
          ? decoded.firebase.sign_in_provider
          : Array.isArray(user?.providerUserInfo) &&
              typeof user.providerUserInfo[0]?.providerId === "string"
            ? user.providerUserInfo[0].providerId
            : "",
      isAnonymous:
        (typeof decoded?.firebase?.sign_in_provider === "string" &&
          decoded.firebase.sign_in_provider === "anonymous") ||
        (Array.isArray(user?.providerUserInfo) &&
          user.providerUserInfo.length === 0 &&
          typeof user?.email !== "string"),
      expiresAt,
    };

    firebaseTokenCache.set(token, claims);
    return {
      ok: true,
      claims,
    };
  }

  return {
    verifyFirebaseIdToken,
  };
}

function createFirebaseAdminAuthClientResolver({
  authMode,
  projectId,
  serviceAccountJson,
  importFirebaseAdminApp,
  importFirebaseAdminAuth,
  log,
}) {
  let firebaseAdminAuthClientPromise = null;

  return async function resolveAdminAuthClient() {
    if (firebaseAdminAuthClientPromise) {
      return firebaseAdminAuthClientPromise;
    }

    firebaseAdminAuthClientPromise = (async () => {
      try {
        const [{ getApps, initializeApp, applicationDefault, cert }, { getAuth }] =
          await Promise.all([importFirebaseAdminApp(), importFirebaseAdminAuth()]);

        const existing = getApps()[0];
        const app =
          existing ??
          initializeApp(
            buildFirebaseAdminOptions({
              applicationDefault,
              cert,
              projectId,
              serviceAccountJson,
            })
          );

        return getAuth(app);
      } catch (error) {
        const logMethod = authMode === "admin" ? "error" : "warn";
        log?.[logMethod]?.("Failed to initialize Firebase Admin auth verifier", error);
        return null;
      }
    })();

    return firebaseAdminAuthClientPromise;
  };
}

function buildFirebaseAdminOptions({ applicationDefault, cert, projectId, serviceAccountJson }) {
  if (!serviceAccountJson) {
    return {
      credential: applicationDefault(),
      projectId: projectId || undefined,
    };
  }

  const parsed = JSON.parse(serviceAccountJson);
  return {
    credential: cert(parsed),
    projectId: projectId || parsed.project_id || undefined,
  };
}

function normalizeFirebaseAdminReason(error, normalizeReason) {
  const maybeCode =
    typeof error?.code === "string"
      ? error.code
      : typeof error?.errorInfo?.code === "string"
        ? error.errorInfo.code
        : "verification_failed";
  const normalizedCode = String(maybeCode).replace(/^auth\//, "");
  return `firebase_admin_${normalizeReason(normalizedCode)}`;
}

function decodeJwtPayload(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length < 2) {
    return null;
  }

  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padding = payload.length % 4 === 0 ? "" : "=".repeat(4 - (payload.length % 4));
  const normalized = payload + padding;

  try {
    const raw = Buffer.from(normalized, "base64").toString("utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeFirebaseAuthMode(value) {
  const normalized = normalizeOptionalString(value).toLowerCase();
  if (normalized === "admin" || normalized === "legacy") {
    return normalized;
  }
  return "auto";
}

function defaultNormalizeReason(message) {
  return String(message)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

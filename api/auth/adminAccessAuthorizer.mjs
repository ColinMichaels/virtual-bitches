export function createAdminAccessAuthorizer({
  adminAccessMode,
  adminToken,
  nodeEnv,
  adminRoles,
  normalizeAdminRole,
  hasRequiredAdminRole,
  hasBootstrapAdminOwnersConfigured,
  extractBearerToken,
  authorizeIdentityRequest,
  upsertFirebasePlayer,
  resolveAdminRoleForIdentity,
}) {
  const roles = adminRoles ?? {
    viewer: "viewer",
    operator: "operator",
    owner: "owner",
  };
  const normalizeRole =
    typeof normalizeAdminRole === "function" ? normalizeAdminRole : (value) => value ?? null;
  const hasRequiredRole =
    typeof hasRequiredAdminRole === "function" ? hasRequiredAdminRole : () => false;
  const hasBootstrapOwners =
    typeof hasBootstrapAdminOwnersConfigured === "function"
      ? hasBootstrapAdminOwnersConfigured
      : () => false;
  const parseBearerToken =
    typeof extractBearerToken === "function" ? extractBearerToken : () => "";
  const authorizeIdentity =
    typeof authorizeIdentityRequest === "function"
      ? authorizeIdentityRequest
      : async () => ({ ok: false, reason: "invalid_auth" });
  const upsertPlayer = typeof upsertFirebasePlayer === "function" ? upsertFirebasePlayer : () => {};
  const resolveRoleForIdentity =
    typeof resolveAdminRoleForIdentity === "function"
      ? resolveAdminRoleForIdentity
      : () => ({ role: null, source: "none" });
  const normalizedNodeEnv =
    typeof nodeEnv === "string" && nodeEnv.trim() ? nodeEnv.trim().toLowerCase() : "development";
  const configuredAdminToken =
    typeof adminToken === "string" ? adminToken.trim() : "";
  const configuredAccessMode =
    typeof adminAccessMode === "string" ? adminAccessMode.trim().toLowerCase() : "";

  function extractAdminTokenFromRequest(req) {
    const headerToken =
      typeof req?.headers?.["x-admin-token"] === "string"
        ? req.headers["x-admin-token"].trim()
        : "";
    if (headerToken) {
      return headerToken;
    }

    const authHeader =
      typeof req?.headers?.authorization === "string" ? req.headers.authorization : "";
    const bearer = parseBearerToken(authHeader);
    return bearer || "";
  }

  function resolveAdminAccessMode() {
    if (configuredAccessMode === "disabled") {
      return "disabled";
    }
    if (configuredAccessMode === "open") {
      return "open";
    }
    if (configuredAccessMode === "token") {
      return configuredAdminToken ? "token" : "disabled";
    }
    if (configuredAccessMode === "role") {
      return "role";
    }
    if (configuredAccessMode === "hybrid") {
      return configuredAdminToken ? "hybrid" : "role";
    }
    if (configuredAdminToken) {
      return "hybrid";
    }
    if (hasBootstrapOwners()) {
      return "role";
    }
    return normalizedNodeEnv === "production" ? "role" : "open";
  }

  async function authorizeAdminRequest(req, options = {}) {
    const minimumRole = normalizeRole(options.minimumRole) ?? roles.viewer;
    const mode = resolveAdminAccessMode();
    if (mode === "disabled") {
      return {
        ok: false,
        status: 403,
        reason: "admin_disabled",
        mode,
      };
    }
    if (mode === "open") {
      return {
        ok: true,
        mode,
        authType: "open",
        role: roles.owner,
        roleSource: "open",
      };
    }

    const requestAdminToken = extractAdminTokenFromRequest(req);
    if (mode === "token") {
      if (!requestAdminToken) {
        return {
          ok: false,
          status: 401,
          reason: "missing_admin_token",
          mode,
        };
      }
      if (requestAdminToken !== configuredAdminToken) {
        return {
          ok: false,
          status: 401,
          reason: "invalid_admin_token",
          mode,
        };
      }
      return {
        ok: true,
        mode,
        authType: "token",
        role: roles.owner,
        roleSource: "token",
      };
    }

    if (mode === "hybrid" && requestAdminToken && requestAdminToken === configuredAdminToken) {
      return {
        ok: true,
        mode,
        authType: "token",
        role: roles.owner,
        roleSource: "token",
      };
    }

    const identity = await authorizeIdentity(req, {
      allowSessionToken: false,
      requireNonAnonymous: true,
    });
    if (!identity.ok) {
      return {
        ok: false,
        status: 401,
        reason: identity.reason ?? "invalid_auth",
        mode,
      };
    }

    upsertPlayer(identity.uid, {
      displayName: identity.displayName,
      email: identity.email,
      photoUrl: identity.photoUrl,
      provider: identity.provider,
      providerId: identity.providerId,
      isAnonymous: false,
    });

    const roleInfo = resolveRoleForIdentity(identity.uid, identity.email);
    if (!roleInfo.role) {
      return {
        ok: false,
        status: 403,
        reason: "admin_role_required",
        mode,
        uid: identity.uid,
        email: identity.email,
      };
    }
    if (!hasRequiredRole(roleInfo.role, minimumRole)) {
      return {
        ok: false,
        status: 403,
        reason: "admin_role_forbidden",
        mode,
        uid: identity.uid,
        email: identity.email,
        role: roleInfo.role,
        roleSource: roleInfo.source,
      };
    }

    return {
      ok: true,
      mode,
      authType: "role",
      uid: identity.uid,
      email: identity.email,
      role: roleInfo.role,
      roleSource: roleInfo.source,
    };
  }

  return {
    resolveAdminAccessMode,
    authorizeAdminRequest,
  };
}

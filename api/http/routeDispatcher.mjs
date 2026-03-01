const API_ROUTE_DEFINITIONS = Object.freeze([
  Object.freeze({
    method: "GET",
    path: "/api/media/image-proxy",
    handlerKey: "imageProxy",
    args: Object.freeze(["req", "res", "url"]),
  }),
  Object.freeze({
    method: "GET",
    path: "/api/admin/overview",
    handlerKey: "adminOverview",
    args: Object.freeze(["req", "res", "url"]),
  }),
  Object.freeze({
    method: "GET",
    path: "/api/admin/rooms",
    handlerKey: "adminRooms",
    args: Object.freeze(["req", "res", "url"]),
  }),
  Object.freeze({
    method: "GET",
    path: "/api/admin/metrics",
    handlerKey: "adminMetrics",
    args: Object.freeze(["req", "res"]),
  }),
  Object.freeze({
    method: "GET",
    path: "/api/admin/storage",
    handlerKey: "adminStorage",
    args: Object.freeze(["req", "res"]),
  }),
  Object.freeze({
    method: "GET",
    path: "/api/admin/moderation/terms",
    handlerKey: "adminModerationTermsOverview",
    args: Object.freeze(["req", "res", "url"]),
  }),
  Object.freeze({
    method: "POST",
    path: "/api/admin/moderation/terms/upsert",
    handlerKey: "adminUpsertModerationTerm",
    args: Object.freeze(["req", "res"]),
  }),
  Object.freeze({
    method: "POST",
    path: "/api/admin/moderation/terms/remove",
    handlerKey: "adminRemoveModerationTerm",
    args: Object.freeze(["req", "res"]),
  }),
  Object.freeze({
    method: "POST",
    path: "/api/admin/moderation/terms/refresh",
    handlerKey: "adminRefreshModerationTerms",
    args: Object.freeze(["req", "res"]),
  }),
  Object.freeze({
    method: "GET",
    path: "/api/admin/audit",
    handlerKey: "adminAudit",
    args: Object.freeze(["req", "res", "url"]),
  }),
  Object.freeze({
    method: "GET",
    path: "/api/admin/roles",
    handlerKey: "adminRoles",
    args: Object.freeze(["req", "res", "url"]),
  }),
  Object.freeze({
    method: "PUT",
    pattern: /^\/api\/admin\/roles\/[^/]+$/,
    handlerKey: "adminRoleUpsert",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/admin\/sessions\/[^/]+\/expire$/,
    handlerKey: "adminExpireSession",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/admin\/sessions\/[^/]+\/participants\/[^/]+\/remove$/,
    handlerKey: "adminRemoveParticipant",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/admin\/sessions\/[^/]+\/channel\/messages$/,
    handlerKey: "adminSessionChannelMessage",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "GET",
    pattern: /^\/api\/admin\/sessions\/[^/]+\/conduct$/,
    handlerKey: "adminSessionConductState",
    args: Object.freeze(["req", "res", "pathname", "url"]),
  }),
  Object.freeze({
    method: "GET",
    pattern: /^\/api\/admin\/sessions\/[^/]+\/conduct\/players\/[^/]+$/,
    handlerKey: "adminSessionConductPlayer",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/admin\/sessions\/[^/]+\/conduct\/players\/[^/]+\/clear$/,
    handlerKey: "adminClearSessionConductPlayer",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/admin\/sessions\/[^/]+\/conduct\/clear$/,
    handlerKey: "adminClearSessionConductState",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    path: "/api/auth/token/refresh",
    handlerKey: "refreshToken",
    args: Object.freeze(["req", "res"]),
  }),
  Object.freeze({
    method: "GET",
    path: "/api/auth/me",
    handlerKey: "authMe",
    args: Object.freeze(["req", "res"]),
  }),
  Object.freeze({
    method: "PUT",
    path: "/api/auth/me",
    handlerKey: "authMe",
    args: Object.freeze(["req", "res"]),
  }),
  Object.freeze({
    method: "GET",
    pattern: /^\/api\/players\/[^/]+\/profile$/,
    handlerKey: "getProfile",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "PUT",
    pattern: /^\/api\/players\/[^/]+\/profile$/,
    handlerKey: "putProfile",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "GET",
    pattern: /^\/api\/players\/[^/]+\/scores$/,
    handlerKey: "getPlayerScores",
    args: Object.freeze(["req", "res", "pathname", "url"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/players\/[^/]+\/scores\/batch$/,
    handlerKey: "appendPlayerScores",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    path: "/api/logs/batch",
    handlerKey: "appendLogs",
    args: Object.freeze(["req", "res"]),
  }),
  Object.freeze({
    method: "POST",
    path: "/api/leaderboard/scores",
    handlerKey: "submitLeaderboardScore",
    args: Object.freeze(["req", "res"]),
  }),
  Object.freeze({
    method: "GET",
    path: "/api/leaderboard/global",
    handlerKey: "getGlobalLeaderboard",
    args: Object.freeze(["res", "url"]),
  }),
  Object.freeze({
    method: "POST",
    path: "/api/multiplayer/sessions",
    handlerKey: "createSession",
    args: Object.freeze(["req", "res"]),
  }),
  Object.freeze({
    method: "GET",
    path: "/api/multiplayer/rooms",
    handlerKey: "listRooms",
    args: Object.freeze(["res", "url"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/multiplayer\/rooms\/[^/]+\/join$/,
    handlerKey: "joinRoomByCode",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/multiplayer\/sessions\/[^/]+\/join$/,
    handlerKey: "joinSession",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/multiplayer\/sessions\/[^/]+\/heartbeat$/,
    handlerKey: "sessionHeartbeat",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/multiplayer\/sessions\/[^/]+\/participant-state$/,
    handlerKey: "updateParticipantState",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/multiplayer\/sessions\/[^/]+\/moderate$/,
    handlerKey: "moderateSessionParticipant",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/multiplayer\/sessions\/[^/]+\/queue-next$/,
    handlerKey: "queueParticipantForNextGame",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/multiplayer\/sessions\/[^/]+\/leave$/,
    handlerKey: "leaveSession",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
  Object.freeze({
    method: "POST",
    pattern: /^\/api\/multiplayer\/sessions\/[^/]+\/auth\/refresh$/,
    handlerKey: "refreshSessionAuth",
    args: Object.freeze(["req", "res", "pathname"]),
  }),
]);

function routeMatches(route, method, pathname) {
  if (route.method !== method) {
    return false;
  }
  if (typeof route.path === "string") {
    return route.path === pathname;
  }
  return route.pattern.test(pathname);
}

function resolveRouteArgs(route, context) {
  return route.args.map((key) => context[key]);
}

export async function dispatchApiRoute(context, handlers) {
  const method = typeof context?.req?.method === "string" ? context.req.method : "";
  const pathname = typeof context?.pathname === "string" ? context.pathname : "";

  for (const route of API_ROUTE_DEFINITIONS) {
    if (!routeMatches(route, method, pathname)) {
      continue;
    }
    const handler = handlers?.[route.handlerKey];
    if (typeof handler !== "function") {
      throw new Error(`Missing API route handler: ${route.handlerKey}`);
    }
    const args = resolveRouteArgs(route, context);
    await handler(...args);
    return true;
  }

  return false;
}

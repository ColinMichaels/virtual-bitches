function requireHandler(handlers, key) {
  const value = handlers?.[key];
  if (typeof value !== "function") {
    throw new Error(`Missing API route handler dependency: ${key}`);
  }
  return value;
}

export function createApiRouteHandlers(handlers) {
  return Object.freeze({
    imageProxy: requireHandler(handlers, "handleImageProxy"),
    adminOverview: requireHandler(handlers, "handleAdminOverview"),
    adminRooms: requireHandler(handlers, "handleAdminRooms"),
    adminMetrics: requireHandler(handlers, "handleAdminMetrics"),
    adminStorage: requireHandler(handlers, "handleAdminStorage"),
    adminModerationTermsOverview: requireHandler(handlers, "handleAdminModerationTermsOverview"),
    adminUpsertModerationTerm: requireHandler(handlers, "handleAdminUpsertModerationTerm"),
    adminRemoveModerationTerm: requireHandler(handlers, "handleAdminRemoveModerationTerm"),
    adminRefreshModerationTerms: requireHandler(handlers, "handleAdminRefreshModerationTerms"),
    adminAudit: requireHandler(handlers, "handleAdminAudit"),
    adminRoles: requireHandler(handlers, "handleAdminRoles"),
    adminRoleUpsert: requireHandler(handlers, "handleAdminRoleUpsert"),
    adminExpireSession: requireHandler(handlers, "handleAdminExpireSession"),
    adminRemoveParticipant: requireHandler(handlers, "handleAdminRemoveParticipant"),
    adminSessionChannelMessage: requireHandler(handlers, "handleAdminSessionChannelMessage"),
    adminSessionConductState: requireHandler(handlers, "handleAdminSessionConductState"),
    adminSessionConductPlayer: requireHandler(handlers, "handleAdminSessionConductPlayer"),
    adminClearSessionConductPlayer: requireHandler(handlers, "handleAdminClearSessionConductPlayer"),
    adminClearSessionConductState: requireHandler(handlers, "handleAdminClearSessionConductState"),
    refreshToken: requireHandler(handlers, "handleRefreshToken"),
    authMe: requireHandler(handlers, "handleAuthMe"),
    getProfile: requireHandler(handlers, "handleGetProfile"),
    putProfile: requireHandler(handlers, "handlePutProfile"),
    getPlayerScores: requireHandler(handlers, "handleGetPlayerScores"),
    appendPlayerScores: requireHandler(handlers, "handleAppendPlayerScores"),
    appendLogs: requireHandler(handlers, "handleAppendLogs"),
    submitLeaderboardScore: requireHandler(handlers, "handleSubmitLeaderboardScore"),
    getGlobalLeaderboard: requireHandler(handlers, "handleGetGlobalLeaderboard"),
    createSession: requireHandler(handlers, "handleCreateSession"),
    listRooms: requireHandler(handlers, "handleListRooms"),
    joinRoomByCode: requireHandler(handlers, "handleJoinRoomByCode"),
    joinSession: requireHandler(handlers, "handleJoinSession"),
    sessionHeartbeat: requireHandler(handlers, "handleSessionHeartbeat"),
    updateParticipantState: requireHandler(handlers, "handleUpdateParticipantState"),
    updateSessionDemoControls: requireHandler(handlers, "handleUpdateSessionDemoControls"),
    moderateSessionParticipant: requireHandler(handlers, "handleModerateSessionParticipant"),
    queueParticipantForNextGame: requireHandler(handlers, "handleQueueParticipantForNextGame"),
    leaveSession: requireHandler(handlers, "handleLeaveSession"),
    refreshSessionAuth: requireHandler(handlers, "handleRefreshSessionAuth"),
  });
}

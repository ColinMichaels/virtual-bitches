export const DEFAULT_STORE = {
  players: {},
  playerScores: {},
  gameLogs: {},
  multiplayerSessions: {},
  refreshTokens: {},
  accessTokens: {},
  leaderboardScores: {},
  firebasePlayers: {},
  moderation: {},
};

const STORE_SECTIONS = Object.keys(DEFAULT_STORE);

export function cloneStore(raw = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const next = {
    ...structuredClone(DEFAULT_STORE),
    ...source,
  };

  for (const section of STORE_SECTIONS) {
    const sectionValue = next[section];
    next[section] =
      sectionValue && typeof sectionValue === "object" ? sectionValue : {};
  }

  return next;
}

export function deepEqualJson(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function getStoreSections() {
  return [...STORE_SECTIONS];
}

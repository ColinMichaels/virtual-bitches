/**
 * Production Environment Configuration
 */

import { Environment } from "./types.js";

export const environment: Environment = {
  production: true,
  apiBaseUrl: "https://api.biscuits-game.com/api",
  gameTitle: "Virtual Bitches",
  wsUrl: "wss://ws.biscuits-game.com",
  features: {
    leaderboard: true,
    multiplayer: true,
    analytics: true,
  },
  storage: {
    prefix: "biscuits",
  },
  debug: false,
};

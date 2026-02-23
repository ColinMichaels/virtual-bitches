/**
 * Development Environment Configuration
 */

import { Environment } from "./types.js";

export const environment: Environment = {
  production: false,
  apiBaseUrl: "https://api-dev.biscuits-game.com/api",
  wsUrl: "wss://ws-dev.biscuits-game.com",
  gameTitle: "Virtual Bitches",
  features: {
    leaderboard: true,
    multiplayer: true,
    analytics: true,
  },
  storage: {
    prefix: "biscuits-dev",
  },
  debug: true,
};

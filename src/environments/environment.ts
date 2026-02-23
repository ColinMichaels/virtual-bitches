/**
 * Local/Development Environment Configuration
 */

import { Environment } from "./types.js";

export const environment: Environment = {
  production: false,
  apiBaseUrl: "http://localhost:3000/api",
  gameTitle: "Virtual Bitches",
  wsUrl: "ws://localhost:3000",
  features: {
    leaderboard: true,
    multiplayer: true,
    analytics: false,
  },
  storage: {
    prefix: "biscuits-local",
  },
  debug: true,
};

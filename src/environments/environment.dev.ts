/**
 * Development Environment Configuration
 */

import { Environment } from "./types.js";

const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};

export const environment: Environment = {
  production: false,
  apiBaseUrl: env.VITE_API_BASE_URL ?? "https://api-dev.biscuits-game.com/api",
  wsUrl: env.VITE_WS_URL ?? "wss://ws-dev.biscuits-game.com",
  gameTitle: "Virtual Bitches",
  features: {
    leaderboard: true,
    multiplayer: true,
    analytics: true,
  },
  storage: {
    prefix: "biscuits-dev",
  },
  firebaseConfig: {
    apiKey: env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: env.VITE_FIREBASE_APP_ID ?? "",
    measurementId: env.VITE_FIREBASE_MEASUREMENT_ID ?? "",
  },
  debug: true,
};

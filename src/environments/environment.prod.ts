/**
 * Production Environment Configuration
 */

import { Environment } from "./types.js";

export const environment: Environment = {
  production: true,
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "https://api.biscuits-game.com/api",
  gameTitle: "Virtual Bitches",
  wsUrl: import.meta.env.VITE_WS_URL ?? "wss://ws.biscuits-game.com",
  features: {
    leaderboard: true,
    multiplayer: true,
    analytics: true,
  },
  storage: {
    prefix: "biscuits",
  },
  firebaseConfig: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? "",
  },
  debug: false,
};

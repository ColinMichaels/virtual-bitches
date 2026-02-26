/**
 * Local/Development Environment Configuration
 */

import { Environment } from "./types.js";

export const environment: Environment = {
  production: false,
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api",
  gameTitle: "Virtual Bitches",
  wsUrl: import.meta.env.VITE_WS_URL ?? "ws://localhost:3000",
  features: {
    leaderboard: true,
    multiplayer: true,
    analytics: false,
  },
  storage: {
    prefix: "biscuits-local",
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
  debug: true,
};

/**
 * Production Environment Configuration
 */

import { Environment } from "./types.js";

const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
const parseBooleanFlag = (rawValue: string | undefined, fallback: boolean): boolean => {
  if (typeof rawValue !== "string") {
    return fallback;
  }
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

export const environment: Environment = {
  production: true,
  apiBaseUrl: env.VITE_API_BASE_URL ?? "https://api.biscuits-game.com/api",
  assetBaseUrl: env.VITE_ASSET_BASE_URL ?? "",
  feedbackFormUrl: env.VITE_FEEDBACK_FORM_URL ?? "/feedback",
  gameTitle: "Virtual Biscuits",
  wsUrl: env.VITE_WS_URL ?? "wss://ws.biscuits-game.com",
  adminUiEnabled: parseBooleanFlag(env.VITE_ENABLE_ADMIN_UI, false),
  features: {
    leaderboard: true,
    multiplayer: true,
    analytics: true,
    multiplayerAutoSeatReady: parseBooleanFlag(
      env.VITE_MULTIPLAYER_AUTO_SEAT_READY_ENABLED,
      true
    ),
  },
  storage: {
    prefix: "biscuits",
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
  debug: false,
};

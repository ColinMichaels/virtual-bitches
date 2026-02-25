/**
 * Development Environment Configuration
 */

import { Environment } from "./types.js";

export const environment: Environment = {
  production: false,
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "https://api-dev.biscuits-game.com/api",
  wsUrl: import.meta.env.VITE_WS_URL ?? "wss://ws-dev.biscuits-game.com",
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
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyBg5kHN7DdxOIrFO5IfWsy104gjpC_4Y7I",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "biscuits-b427f.firebaseapp.com",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "biscuits-b427f",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "biscuits-b427f.firebasestorage.app",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "445134570147",
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:445134570147:web:65ecc2e93e1d4390cf7516",
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? "G-NSKBTK0TXD",
  },
  debug: true,
};

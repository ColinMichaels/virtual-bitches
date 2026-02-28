/**
 * Environment Configuration Types
 */

export interface Environment {
  production: boolean;
  apiBaseUrl: string;
  assetBaseUrl: string;
  feedbackFormUrl: string;
  gameTitle: string;
  wsUrl?: string; // WebSocket URL for real-time multiplayer
  adminUiEnabled: boolean;
  features: {
    leaderboard: boolean;
    multiplayer: boolean;
    analytics: boolean;
    multiplayerAutoSeatReady: boolean;
    multiplayerDemoSpeedMode: boolean;
    multiplayerDemoSpeedLabel: string;
  };
  storage: {
    prefix: string; // localStorage key prefix
  };
  firebaseConfig: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId?: string;
  };
  debug: boolean;
}

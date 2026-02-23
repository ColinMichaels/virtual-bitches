/**
 * Environment Configuration Types
 */

export interface Environment {
  production: boolean;
  apiBaseUrl: string;
  gameTitle: string;
  wsUrl?: string; // WebSocket URL for real-time multiplayer
  features: {
    leaderboard: boolean;
    multiplayer: boolean;
    analytics: boolean;
  };
  storage: {
    prefix: string; // localStorage key prefix
  };
  debug: boolean;
}

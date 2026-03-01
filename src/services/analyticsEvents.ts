export const ANALYTICS_EVENTS = Object.freeze({
  APP_SHELL_BOOTED: "app_shell_booted",
  ANALYTICS_CONSENT_ENABLED: "analytics_consent_enabled",
  GAME_START: "game_start",
  GAME_START_FAILED: "game_start_failed",
  MULTIPLAYER_SESSION_CREATE_FAILED: "multiplayer_session_create_failed",
  MULTIPLAYER_SESSION_CREATED: "multiplayer_session_created",
  MULTIPLAYER_SESSION_JOIN_FAILED: "multiplayer_session_join_failed",
  MULTIPLAYER_SESSION_JOINED: "multiplayer_session_joined",
  GAME_COMPLETE: "game_complete",
} as const);

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

export interface AnalyticsEventParamsMap {
  [ANALYTICS_EVENTS.APP_SHELL_BOOTED]: {
    build_mode: "production" | "development";
  };
  [ANALYTICS_EVENTS.ANALYTICS_CONSENT_ENABLED]: Record<string, never>;
  [ANALYTICS_EVENTS.GAME_START]: {
    play_mode: "solo" | "multiplayer";
    from_invite: boolean;
    bot_count: number;
    tutorial_forced: boolean;
  };
  [ANALYTICS_EVENTS.GAME_START_FAILED]: {
    play_mode: "solo" | "multiplayer";
    stage: string;
  };
  [ANALYTICS_EVENTS.MULTIPLAYER_SESSION_CREATE_FAILED]: {
    difficulty: string;
    requested_bot_count: number;
  };
  [ANALYTICS_EVENTS.MULTIPLAYER_SESSION_CREATED]: {
    difficulty: string;
    room_type: string;
    bot_count: number;
    demo_mode: boolean;
    demo_speed_mode: boolean;
  };
  [ANALYTICS_EVENTS.MULTIPLAYER_SESSION_JOIN_FAILED]: {
    join_method: "session_id" | "room_code";
    reason: string;
  };
  [ANALYTICS_EVENTS.MULTIPLAYER_SESSION_JOINED]: {
    join_method: "session_id" | "room_code";
    from_invite_link: boolean;
    room_type: string;
    difficulty: string;
    demo_mode: boolean;
  };
  [ANALYTICS_EVENTS.GAME_COMPLETE]: {
    play_mode: "solo" | "multiplayer";
    difficulty: string;
    score: number;
    roll_count: number;
    duration_ms: number;
  };
}

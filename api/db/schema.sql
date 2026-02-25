-- BISCUITS backend schema (skeleton)
-- Target dialect: PostgreSQL (compatible with many SQL engines with minor edits)

CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY,
  display_name TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_profiles (
  player_id TEXT PRIMARY KEY REFERENCES players(player_id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL,
  upgrade_progression_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_logs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  session_id TEXT,
  type TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_logs_player_timestamp
  ON game_logs(player_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS multiplayer_sessions (
  session_id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  ws_url TEXT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_multiplayer_sessions_room_code
  ON multiplayer_sessions(room_code);

CREATE TABLE IF NOT EXISTS multiplayer_session_members (
  session_id TEXT NOT NULL REFERENCES multiplayer_sessions(session_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  display_name TEXT,
  joined_at BIGINT NOT NULL,
  last_heartbeat_at BIGINT NOT NULL,
  PRIMARY KEY (session_id, player_id)
);

CREATE TABLE IF NOT EXISTS auth_access_tokens (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  session_id TEXT REFERENCES multiplayer_sessions(session_id) ON DELETE CASCADE,
  issued_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_access_tokens_player
  ON auth_access_tokens(player_id);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  session_id TEXT REFERENCES multiplayer_sessions(session_id) ON DELETE CASCADE,
  issued_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_player
  ON auth_refresh_tokens(player_id);

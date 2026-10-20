CREATE TABLE IF NOT EXISTS agent_events (
  seq BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created TEXT NOT NULL,
  previous TEXT NOT NULL,
  digest TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('birth','step')),
  day DATE NOT NULL,
  amount BIGINT NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending','complete')),
  result JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS single_agent_birth
  ON agent_operations(kind) WHERE kind = 'birth';
CREATE UNIQUE INDEX IF NOT EXISTS single_pending_episode
  ON agent_operations(status) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS agent_assets (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  bytes BYTEA NOT NULL CHECK (octet_length(bytes) <= 3500000)
);

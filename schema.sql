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
DROP INDEX IF EXISTS single_pending_episode;
CREATE UNIQUE INDEX IF NOT EXISTS single_pending_lane
  ON agent_operations ((CASE WHEN id LIKE 'x-publish-%' THEN 'x' ELSE 'agent' END)) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS agent_assets (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  bytes BYTEA NOT NULL CHECK (octet_length(bytes) <= 3500000)
);

CREATE TABLE IF NOT EXISTS agent_oauth_states (state TEXT PRIMARY KEY, browser TEXT NOT NULL, secret TEXT NOT NULL, expires TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS agent_oauth_tokens (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, secret TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('connected','reconnect_required')));

CREATE TABLE IF NOT EXISTS agent_inbox (
 id TEXT PRIMARY KEY, platform TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL,
 created TIMESTAMPTZ NOT NULL DEFAULT now(), status TEXT NOT NULL DEFAULT 'pending',
 response TEXT, reply_url TEXT, metadata JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS agent_optouts (author TEXT PRIMARY KEY, created TIMESTAMPTZ DEFAULT now());

ALTER TABLE agent_oauth_tokens DROP CONSTRAINT IF EXISTS agent_oauth_tokens_status_check;
ALTER TABLE agent_oauth_tokens ADD CONSTRAINT agent_oauth_tokens_status_check CHECK (status IN ('connected','reconnect_required','disconnected'));

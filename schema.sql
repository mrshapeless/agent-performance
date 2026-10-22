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
DROP INDEX IF EXISTS single_pending_lane;
CREATE UNIQUE INDEX IF NOT EXISTS single_pending_lane
  ON agent_operations ((CASE WHEN id LIKE 'x-publish-%' THEN 'x' WHEN id LIKE 'media-%' THEN 'media' ELSE 'agent' END)) WHERE status = 'pending';
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

ALTER TABLE agent_assets ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE agent_assets ALTER COLUMN bytes DROP NOT NULL;
ALTER TABLE agent_assets DROP CONSTRAINT IF EXISTS agent_assets_mime_check;
ALTER TABLE agent_assets ADD CONSTRAINT agent_assets_mime_check CHECK(mime IN ('image/jpeg','image/png','image/webp','video/mp4'));
ALTER TABLE agent_assets DROP CONSTRAINT IF EXISTS asset_storage_check;
ALTER TABLE agent_assets ADD CONSTRAINT asset_storage_check CHECK ((bytes IS NOT NULL AND url IS NULL) OR (bytes IS NULL AND url LIKE 'https://%.public.blob.vercel-storage.com/%'));
CREATE TABLE IF NOT EXISTS agent_media_jobs (
 id TEXT PRIMARY KEY,plan_id TEXT NOT NULL UNIQUE,plan JSONB NOT NULL,
 state TEXT NOT NULL,data JSONB NOT NULL DEFAULT '{}',
 created TIMESTAMPTZ NOT NULL DEFAULT now(),updated TIMESTAMPTZ NOT NULL DEFAULT now(),
 lease_until TIMESTAMPTZ,lease_token TEXT
);

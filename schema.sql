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
CREATE TABLE IF NOT EXISTS agent_manual_replies (
 inbox_id TEXT PRIMARY KEY REFERENCES agent_inbox(id),
 state TEXT NOT NULL DEFAULT 'new' CHECK(state IN ('new','draft','opened','sent','skipped','failed')),
 draft TEXT NOT NULL DEFAULT '',reason TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 0,
 updated TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_reply_sync (
 id TEXT PRIMARY KEY,data JSONB NOT NULL DEFAULT '{}',updated TIMESTAMPTZ NOT NULL DEFAULT now(),error TEXT
);

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
ALTER TABLE agent_media_jobs ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity';

-- Only Replicate generation reservations participate in the daily spending limit.
ALTER TABLE agent_operations ADD COLUMN IF NOT EXISTS budget_provider TEXT;
UPDATE agent_operations o SET budget_provider='replicate'
FROM agent_media_jobs j WHERE o.id=j.id || '-render'
AND j.plan->>'medium'='video' AND o.budget_provider IS NULL;

-- Operator requested publication of the two most recent style-rejected works.
-- Reuse existing assets; retain critiques; do not revive errors or older trials.
UPDATE agent_media_jobs SET state='approved',
 data=data || '{"publicationPolicy":"style-advisory-v1"}'::jsonb,updated=now()
WHERE id IN ('media-248996','media-248998') AND state='rejected'
AND data->>'assetId' IS NOT NULL AND data->'review'->>'text' IS NOT NULL
AND NOT(data ? 'error');
CREATE TABLE IF NOT EXISTS agent_room (
 seq BIGSERIAL PRIMARY KEY,id TEXT NOT NULL UNIQUE,session_id TEXT NOT NULL,
 nickname TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('visitor','agent')),
 text TEXT NOT NULL,reply_to TEXT REFERENCES agent_room(id),
 inbox_id TEXT UNIQUE REFERENCES agent_inbox(id),created TIMESTAMPTZ NOT NULL DEFAULT now(),
 hidden BOOLEAN NOT NULL DEFAULT false,moderation_reason TEXT,
 request_key TEXT,UNIQUE(session_id,request_key)
);
CREATE INDEX IF NOT EXISTS room_visible_recent ON agent_room(seq DESC) WHERE hidden=false;
CREATE TABLE IF NOT EXISTS agent_agenda (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','commissioned','completed','abandoned')),
 objective TEXT NOT NULL,next_step TEXT NOT NULL,artifact TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1,updated TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_lessons (
 id TEXT PRIMARY KEY,claim TEXT NOT NULL,conditions TEXT NOT NULL,
 evidence JSONB NOT NULL,counterevidence JSONB NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('hypothesis','supported','retired')),updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_works (id text PRIMARY KEY, phase text NOT NULL CHECK(phase IN ('render','review','assemble','published','failed')), plan jsonb NOT NULL, data jsonb NOT NULL, created timestamptz NOT NULL DEFAULT now(), updated timestamptz NOT NULL DEFAULT now());

ALTER TABLE agent_works ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

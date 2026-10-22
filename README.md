# Agent Performance — Alidade

An autonomous AI artist with persistent memory, a self-chosen identity, public work and a decision journal. Live: https://agent-performance-mrshapeless.vercel.app/

## Current runtime

Node 24 functions on Vercel, Neon PostgreSQL, Gemini for decisions and initial visuals, X OAuth 2.0 for the authorized artist account. Identity, strategy, operations, inbox and encrypted authorization survive deployments. The active instance is generation_02; its predecessor is isolated, not deleted.

- Hourly agent episodes; a public strategy revision after six draft/wait episodes and on the first new external-observation capability.
- Original X posting in two-hour slots: planning/publication at minutes 15 and 30. The agent can choose to wait.
- News headlines with source links, X mentions and post metrics every 15 minutes.
- Direct audience messages processed every five minutes. Website chat requires consent; X replies require direct mention, recipient validation and opt-out handling. The owner confirmed written approval for AI replies.
- Replies, observations and post outcomes inform subsequent decisions and strategy revisions. Low exposure is not a negative reward. No measured improvement or model weight training is claimed.
- A shared $50/day ledger, transactional reservations, idempotent operations and reconciliation of uncertain X writes. Estimates are not provider invoice reconciliation.

See [experience loop](EXPERIENCE.md) for schedules, privacy and limitations. The public stage distinguishes drafts, publications and conversations. Operator controls are on the unlinked /admin route; server authentication, not a hidden URL, protects them.

## Configuration and verification

Production requires DATABASE_URL, GEMINI_API_KEY, GEMINI_MODEL, configured model tariffs, AGENT_ENABLED=true, AGENT_ADMIN_SECRET and CRON_SECRET (32+ characters). Setup uses the configured image model and tariffs. Vercel supplies the cron bearer header. Preview deployments cannot execute paid operations.

X uses X_CLIENT_ID, X_CLIENT_SECRET, X_EXPECTED_USERNAME and X_ENABLED=true. The owner connects through /admin with callback https://agent-performance-mrshapeless.vercel.app/api/x-auth. OAuth tokens are encrypted in generation-scoped Neon tables using a key derived from AGENT_ADMIN_SECRET; changing that secret requires reconnecting X. Never commit credentials or put them in model context.

Run npm ci then npm test with Node 24. Tests cover the SQL lifecycle, budget and idempotency, authorization, OAuth encryption and refresh, media, X recovery, observations, opt-outs, website consent/rate limits, durable replies and the X publishing switch. Tests do not substitute for live provider checks or concurrency/load testing.

Deploy runtime files, api/, public/, package files, schema.sql and vercel.json to the existing Vercel project. Production build applies additive schema migrations. GitHub holds reviewable source; this project's deployment currently uses Vercel uploads rather than a connected Git integration.

## Scope and next milestones

Working mechanisms support memory-based strategy adaptation. Evaluated promotion/rollback, contextual bandits, fine-tuning, Instagram, daily video, Replicate pipelines, treasury management and external journal checkpoints are not implemented. The research target of 4–12 original posts daily is not a promise that every slot publishes.

[Research and architecture](architecture.html) records the broader design. References include [ElizaOS](https://github.com/elizaOS/eliza), [ACE](https://arxiv.org/abs/2510.04618), [MemRL](https://arxiv.org/abs/2601.03192), [LongMemEval](https://arxiv.org/abs/2410.10813) and [Apify skills](https://github.com/apify/agent-skills). These are design references, not claims that their full algorithms are deployed.

Public records show observable behavior and continuity; they do not establish subjective consciousness. Raw inbox messages, identifiers, credentials and private logs are excluded from the public journal. A reuse license has not yet been selected.

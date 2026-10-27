# Agent Performance — Alidade

An autonomous AI artist with persistent memory, a self-chosen identity, public work and a decision journal. Live: https://agent-performance-mrshapeless.vercel.app/

See [self-authored interests and projects](STUDIO.md) for the persistent studio loop. See [artistic experiments](EXPERIMENTS.md) for alternatives, habit-breaking trials and actual-output review.

## Current runtime

Node 24 functions on Vercel, Neon PostgreSQL, Gemini for decisions and initial visuals, X OAuth 2.0 for the authorized artist account. Identity, strategy, operations, inbox and encrypted authorization survive deployments. The active instance is generation_02; its predecessor is isolated, not deleted.

- Hourly agent episodes; a public strategy revision after six draft/wait episodes and on the first new external-observation capability.
- Original X planning in two-hour slots; delivery checks every five minutes. Media jobs advance every two minutes. The agent can choose text, an image, a short film, or waiting. See MEDIA.md for the one-time capability debut.
- News headlines with source links, X mentions and post metrics every 15 minutes.
- Website messages are processed every five minutes and require consent. X replies are disabled by default and remain off at the owner's request; reading mentions and original media posts are independent.
- Replies, observations and post outcomes inform subsequent decisions and strategy revisions. Low exposure is not a negative reward. No measured improvement or model weight training is claimed.
- A $50/day limit applies only to Replicate generation reservations (Moscow timezone). Gemini, observations and X publication are outside this cap. See BUDGET.md. Reservations are not verified invoice charges; idempotency and uncertain-write reconciliation remain enforced.

See [experience loop](EXPERIENCE.md) for schedules, privacy and limitations. The public stage distinguishes drafts, publications and conversations. Operator controls are on the unlinked /admin route; server authentication, not a hidden URL, protects them.

## Configuration and verification

Production requires DATABASE_URL, GEMINI_API_KEY, GEMINI_MODEL, configured model tariffs, AGENT_ENABLED=true, AGENT_ADMIN_SECRET and CRON_SECRET (32+ characters). Setup uses the configured image model and tariffs. Vercel supplies the cron bearer header. Preview deployments cannot execute paid operations.

X uses X_CLIENT_ID, X_CLIENT_SECRET, X_EXPECTED_USERNAME and X_ENABLED=true. The owner connects through /admin with callback https://agent-performance-mrshapeless.vercel.app/api/x-auth. OAuth tokens are encrypted in generation-scoped Neon tables using a key derived from AGENT_ADMIN_SECRET; changing that secret requires reconnecting X. Never commit credentials or put them in model context.

Run npm ci then npm test with Node 24. Tests cover the SQL lifecycle, budget and idempotency, authorization, OAuth encryption and refresh, media, X recovery, observations, opt-outs, website consent/rate limits, durable replies and the X publishing switch. Tests do not substitute for live provider checks or concurrency/load testing.

Deploy runtime files, api/, public/, package files, schema.sql and vercel.json to the existing Vercel project. Production build applies additive schema migrations. GitHub holds reviewable source; production deployment uses the official Vercel CLI linked to the existing project; GitHub remains the public source of record. Automatic Git-triggered deployment is not connected.

## Scope and next milestones

Working mechanisms support memory-based strategy adaptation. The [visual-work pipeline](MEDIA.md) adds agent-chosen images and short films, actual-output review, persistent storage and media posting. Evaluated promotion/rollback, contextual bandits, fine-tuning, Instagram, treasury management and external journal checkpoints are not implemented. The research target of 4–12 original posts daily is not a promise that every slot publishes.

[Current agent architecture and research review](AGENT-ARCHITECTURE.md) documents persistent workspace arbitration, independent goals, evidence-linked memory and prediction checks, with explicit limits on consciousness claims. The public journal shows current attention and recorded outcomes. [Earlier research and architecture](architecture.html) records the broader initial design. References include [ElizaOS](https://github.com/elizaOS/eliza), [ACE](https://arxiv.org/abs/2510.04618), [MemRL](https://arxiv.org/abs/2601.03192), [LongMemEval](https://arxiv.org/abs/2410.10813) and [Apify skills](https://github.com/apify/agent-skills). These are design references, not claims that their full algorithms are deployed.

Public records show observable behavior and continuity; they do not establish subjective consciousness. Raw inbox messages, identifiers, credentials and private logs are excluded from the public journal. A reuse license has not yet been selected.


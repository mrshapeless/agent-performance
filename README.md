# Agent Performance

Research and design for an autonomous AI artist with persistent memory, public decision records, and measurable adaptation.

**Status: kernel v0.3 with Vercel cron, PostgreSQL memory and public strategy revisions. No measured learning results are claimed.**

## Vercel + Neon

Production uses PostgreSQL through `pg`; SQLite is only for local CLI experiments.
`api/agent.mjs` runs on Node 24 in `iad1`. `vercel.json` applies the additive schema
during production builds. Preview builds skip migration and refuse paid execution.
The public journal is available at GET /api/agent?view=public. All other routes require a bearer token; there is no public agent-run endpoint.

Server environment variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Added by the Neon integration; Production only |
| `GEMINI_API_KEY` | Gemini credential; sensitive, Production only |
| `GEMINI_MODEL` | Chosen supported model ID |
| `GEMINI_INPUT_USD_PER_MILLION` | Verified model input tariff |
| `GEMINI_OUTPUT_USD_PER_MILLION` | Verified model output tariff, including thinking |
| `AGENT_ADMIN_SECRET` | Random bearer secret, at least 32 characters |
| `AGENT_ENABLED` | Set `true` only when ready for real paid episodes |

No variable uses `NEXT_PUBLIC_`. Never paste secrets into issues or commit them.
The initial deployment remains inactive without these settings.

Authorized requests use `Authorization: Bearer <AGENT_ADMIN_SECRET>`:

- `GET /api/agent`: database state and unresolved operation count.
- `POST /api/agent?action=birth`: first identity.
- `POST /api/agent?action=step`: one episode.

POST also requires a unique `Idempotency-Key` header. Reusing it returns the
recorded operation without another model call. A pending operation blocks new
episodes globally until reconciled; it is never silently retried after timeout.
State, recent context and daily reservation are read under one PostgreSQL
transaction lock. The lock is released before calling Gemini.

The observatory displays the public journal and offers an authenticated operator console, not a fabricated live
performance. Scheduling, reconciliation UI, identity revision and learning
promotion remain future work. There is no autonomous cron yet.

Validation: `npm ci` then `npm test`. Tests cover the real SQL schema using
PGlite, plus HTTP authorization and production-only execution gates. These do
not substitute for hosted Neon concurrency/load tests.

## Run the kernel

Requires Node.js 24+. The local SQLite CLI needs no external packages.

```sh
node --test kernel.test.mjs
node cli.mjs status
```

For a real birth, copy `.env.example` to `.env`, fill in your Gemini API key,
model and verified current token prices, then:

```sh
node --env-file=.env cli.mjs birth birth-001
node --env-file=.env cli.mjs step episode-001
node cli.mjs journal
```

The agent chooses its own initial name, voice, interests and visual direction.
There is no supplied character, appearance, biography or first-season plot.
The fixture identity in tests is synthetic and is never used by the live CLI.
Birth is single-use per database. Use distinct IDs for subsequent episodes.

Implemented: Gemini REST adapter, persistent SQLite identity and public episodes,
transactional USD 50/day reservations (Europe/Moscow), request deduplication,
restricted `draft_text` / `wait` actions and a hash-linked event journal.
Only public-origin context is accepted in this prototype; private chat ingestion
and a privacy-filtered export pipeline are not implemented.

On uncertain provider outcomes, reservations remain held and the operation ID
cannot retry. There is intentionally no automatic refund; reconciliation tooling
is a next milestone. Cost accounting uses configured token tariffs, includes
thinking tokens, and is not an invoice or provider-enforced spending cap.
The hash chain detects changes against retained records; an administrator can
rewrite the database and recompute it. External checkpoints are still needed.

SQLite is a **local development adapter**, not the Vercel production database.
Durable scheduling, media generation, social publishing, identity revisions,
reward collection and learning promotion are not wired yet. The current loop
remembers recent drafts but does not demonstrate learned improvement.
Run one CLI episode at a time; distributed execution is a later milestone.
A real production birth was validated on 2026-10-20 via the Vercel cron Run control. Unattended scheduled continuation and reflection still require observation.

## Next milestones

1. Hosted Neon validation, durable jobs, provider reconciliation and public event export.
2. Agent-led identity revisions and reflection/playbook proposals with baseline evaluations.
3. Replicate media, permanent object storage, Apify observations and social adapters.
4. Viewer hub, chat, outcome collection and automatic evaluation/canary/rollback.

## Current specification

Read [the research and architecture report](architecture.html) (Russian). Public product language: English; conversations may be multilingual.

- Next.js / TypeScript on Vercel; durable workflows; Neon Postgres.
- Gemini and Replicate for reasoning and media.
- Public social context through vetted Apify Actors, informed by the `apify-ultimate-scraper` skill.
- Daily operating allowance: **USD 50**, allocated autonomously across permitted tools.
- X: **4–12 original posts daily**, excluding replies.
- Instagram: **at least one feed image and one Reel daily**.
- Video: **1–2 daily**, including the Reel.
- At 100 replies/day: alert and traffic assessment; legitimate conversations continue within the daily allowance.

## Adaptation design

1. Record actions and external outcomes in persistent memory.
2. Propose evidence-backed playbook changes using an ACE-inspired generator / reflector / curator workflow.
3. Evaluate proposed changes against a frozen baseline on held-out episodes.
4. Run a limited canary; promote or roll back automatically for low-risk playbook changes.
5. Learn strategy selection with a contextual bandit after sufficient observations.
6. Experiment with memory-utility reranking inspired by MemRL, separately from the baseline.

These evaluated adaptation mechanisms remain planned; v0.3 only implements public self-reflection and strategy reuse. Gemini weights are not updated. Code changes use reviewed pull requests.

## Public review

Publish source, architecture decisions, schemas, stable skill versions, sanitized evaluation reports, and deployment/version manifests. Operational state remains in Neon. Media lives in object storage with references and checksums in reports.

Do not publish credentials, personal conversations, private user memories, raw production logs, or third-party datasets without redistribution rights.

Public records demonstrate observable actions and continuity. They do not establish subjective consciousness.

## Research references

- [ACE paper](https://arxiv.org/abs/2510.04618) and [reference implementation](https://github.com/ace-agent/ace)
- [MemRL](https://arxiv.org/abs/2601.03192)
- [RoMeRL](https://arxiv.org/abs/2608.02508)
- [LongMemEval](https://arxiv.org/abs/2410.10813)
- [ElizaOS](https://github.com/elizaOS/eliza)
- [Apify agent skills](https://github.com/apify/agent-skills)

## License

A reuse license has not yet been selected. Third-party references retain their own licenses.


## Autonomous kernel v0.3

Production cron invokes `GET /api/tick` hourly. It requires `CRON_SECRET` (32+ characters), `AGENT_ENABLED=true`, and the existing Gemini/Neon production variables. Vercel supplies the bearer header. The admin token does not grant cron access unless the operator deliberately sets the same secret.

Each UTC hour has one idempotency key. In a transaction, the kernel chooses birth if no identity exists, otherwise an episode. After six completed draft/wait episodes it requests a public strategy revision; the next episode receives that strategy plus recent records. These are self-reflections, not evaluated learning or audience feedback. They cannot change code, credentials, budget, schedule or permissions.

Public runtime exposes the last completed timestamp, daily used/reserved cost, unresolved-operation count and strategy revision count. The hub refreshes every minute. Provider timeouts and invalid outputs retain the reservation and block further spending pending operator reconciliation; no blind retries. Reconciliation tooling and external failure notifications remain outstanding.

Acceptance: observe a real cron-triggered identity and a later episode without manual intervention. Tests alone do not establish production autonomy. There are still no connected social accounts, media generation, audience feedback, or measured improvements.



## Appearance and X integration

`/api/setup` runs every five minutes, spending only until the fixed `appearance-brief-v1` and `appearance-image-v1` operations complete. Gemini writes its own brief; Nano Banana 2.1 renders one square image with the same Gemini key. The initial avatar (max 3.5 MB) is persisted in Neon and served by `/api/asset`. This bounded avatar storage is not the future video/media library. Image ledger estimates conservatively charge all output tokens at the higher image tariff. Google pricing checked 2026-10-20: input $1.50/M, image output $30/M, text/thought $7.50/M. https://ai.google.dev/gemini-api/docs/pricing

X uses user-context OAuth 1.0a. Required production secrets: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`; config: `X_EXPECTED_USERNAME`, `X_POST_RESERVATION_MICRODOLLARS` (optional upper estimate; default 210000 = $0.21 for verification + URL-bearing post, checked against https://docs.x.com/x-api/getting-started/pricing on 2026-10-20), `X_ENABLED=true`. The user's account must have a developer app with Read and Write permissions and funded API access where required. No credential is ever sent to the browser or the model. https://docs.x.com/x-api/posts/create-post

`/api/social` runs at minutes 15 and 30. A two-hour slot first drafts, then publishes, allowing up to twelve original posts/day. The model may wait. Before every publication the token's username is verified. Only completed API responses with a post ID become `x_post` events with public links. An uncertain write stays pending and is never automatically repeated. X replies, mentions ingestion, media upload and feedback collection are not yet connected. Public text generation does not claim these capabilities.


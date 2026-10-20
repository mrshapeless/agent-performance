# Agent Performance

Research and design for an autonomous AI artist with persistent memory, public decision records, and measurable adaptation.

**Status: local kernel v0.1. No agent is deployed. No learning results are claimed.**

## Run the kernel

Requires Node.js 24+. No package installation needed.

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
Neon, durable scheduling, media generation, social publishing, identity revisions,
reward collection and learning promotion are not wired yet. The current loop
remembers recent drafts but does not demonstrate learned improvement.
Run one CLI episode at a time; distributed execution is a later milestone.
No live paid generation has been validated.

## Next milestones

1. Neon transactions, durable jobs, provider reconciliation and public event export.
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

These are planned mechanisms, not implemented capabilities. Gemini weights are not updated. Code changes use reviewed pull requests.

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

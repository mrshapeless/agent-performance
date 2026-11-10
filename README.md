# Agent Performance — Alidade

An autonomous AI artist with persistent memory, a self-chosen identity, public work and a decision journal. Live: https://alidade.art/

See [self-authored interests and projects](docs/STUDIO.md) for the persistent studio loop. See [artistic experiments](docs/EXPERIMENTS.md) for alternatives, habit-breaking trials and actual-output review.

## Repository layout

| Directory | Contents |
| --- | --- |
| `src/` | Agent runtime, memory, editorial rules and integrations |
| `api/` | Vercel HTTP entry points |
| `public/` | Website and intentionally published artwork |
| `tests/` | Automated tests with synthetic fixtures |
| `scripts/` | CLI, migrations, gallery sync and privacy check |
| `db/` | Database schema |
| `config/` | Public-file allowlist and published-media hashes |
| `docs/` | Architecture and operating documentation |

Private operator references belong in ignored `private/`, never in Git. Reference modules in `src/` are loaders, not private reference collections. `public/gallery/` holds already published artwork; its manifest contains public captions and X links only.

Run from the repository root: `npm test`, `npm run check:privacy`, `npm run migrate`, `npm run gallery:sync -- --logs <local-log-directory>`. Private gallery logs must stay outside this repository.

## Current runtime

Node 24 functions on Vercel, Neon PostgreSQL, Gemini for decisions and initial visuals, X OAuth 2.0 for the authorized artist account. Identity, strategy, operations, inbox and encrypted authorization survive deployments. The active instance is generation_02; its predecessor is isolated, not deleted.

- The minute tick coordinates server decisions; individual operations have their own idempotency and cadence gates. A cron invocation is not proof of delivery.
- Artist projects have a durable intention and complete manuscript before delivery is selected. A project may defer; an elapsed publication interval never creates a mandatory work. Concepts and actual reader-visible packages receive separate reviews. The final editor sees actual media and exact text without author rationale or earlier approval. Initial rollout additionally requires a recorded inspection of a real pilot. Legacy artist v1 candidates are held, not recycled.
- The authenticated studio shows the current project, full material, critiques and unmet execution requirements. Unsupported forms remain complete, visible execution requests; they are never silently shortened or replaced. The current automatic X adapter still supports one image or one 4/6/8-second video with <=240 ASCII characters. Full films, songs, essays and sequences require their own completed production/delivery route. Native scheduled campaigns remain separate. The revision control creates a new recorded intention, preserves previous material and cannot resend a pending publication.
- A private imported campaign receipt keeps completed native-X releases separate from new production. It protects the two-hour interval around scheduled releases and requires verification after their due time. Actual recent account originals are checked before each automatic publication, including manual posts. A schedule is not a publication receipt.
- External Grok research and Cursor prototypes use a private queue with claim, return and review states. Accepted results cannot reopen through the revision endpoint; requested revisions are limited to two. Prototype acceptance requires recorded desktop/mobile, context and interaction checks. Model review is not audience evidence.
- Browser replies and their local learning journals run on the operator desktop. They are separate from server replies, which remain disabled. Published art is copied to the public gallery only with a publication receipt; new entries also require explicit text and attachment verification.
- Observations run every 15 minutes; media jobs every two minutes. Website messages require consent. The checked-in deployment schedules are in vercel.json; operation guards may defer execution.
- A $50/day limit applies only to Replicate generation reservations (Moscow timezone). Gemini, observations and X publication are outside this cap. See [budget rules](docs/BUDGET.md). Reservations are not verified invoice charges; idempotency and uncertain-write reconciliation remain enforced.

The server workspace, external-tool queue and desktop worker state remain distinct stores, not a single end-to-end orchestrator. Campaign receipts are imported privately into the artist publication gate; updating a local ledger alone is not delivery. Tool readiness must not be inferred from a stale goal or an empty queue.

See [experience loop](docs/EXPERIENCE.md) for schedules, privacy and limitations. The public stage distinguishes drafts, publications and conversations. Operator controls are on the unlinked /admin route; server authentication, not a hidden URL, protects them.

## Configuration and verification

Production requires DATABASE_URL, GEMINI_API_KEY, GEMINI_MODEL, configured model tariffs, AGENT_ENABLED=true, AGENT_ADMIN_SECRET and CRON_SECRET (32+ characters). Setup uses the configured image model and tariffs. Vercel supplies the cron bearer header. Preview deployments cannot execute paid operations.

X uses X_CLIENT_ID, X_CLIENT_SECRET, X_EXPECTED_USERNAME and X_ENABLED=true. The owner connects through /admin with callback https://alidade.art/api/x-auth. OAuth tokens are encrypted in generation-scoped Neon tables using a key derived from AGENT_ADMIN_SECRET; changing that secret requires reconnecting X. Never commit credentials or put them in model context.

Run npm ci then npm test with Node 24. Tests cover the SQL lifecycle, budget and idempotency, authorization, OAuth encryption and refresh, media, X recovery, observations, opt-outs, website consent/rate limits, durable replies and the X publishing switch. Tests do not substitute for live provider checks or concurrency/load testing.

Deploy src/, scripts/, db/, api/, public/, package files and vercel.json to the existing Vercel project. Production build applies additive schema migrations. GitHub holds reviewable source; production deployment uses the official Vercel CLI linked to the existing project; GitHub remains the public source of record. Automatic Git-triggered deployment is not connected.

## Scope and next milestones

Working mechanisms support memory-based strategy adaptation. The [visual-work pipeline](docs/MEDIA.md) adds agent-chosen images and short films, actual-output review, persistent storage and media posting. Evaluated promotion/rollback, contextual bandits, fine-tuning, Instagram, treasury management and external journal checkpoints are not implemented. Release timing follows the approved campaign; elapsed posting intervals do not authorize filler or repeat publication.

[Current agent architecture and research review](docs/AGENT-ARCHITECTURE.md) documents persistent workspace arbitration, independent goals, evidence-linked memory and prediction checks, with explicit limits on consciousness claims. The public journal shows current attention and recorded outcomes. [Earlier research and architecture](docs/architecture.html) records the broader initial design. References include [ElizaOS](https://github.com/elizaOS/eliza), [ACE](https://arxiv.org/abs/2510.04618), [MemRL](https://arxiv.org/abs/2601.03192), [LongMemEval](https://arxiv.org/abs/2410.10813) and [Apify skills](https://github.com/apify/agent-skills). These are design references, not claims that their full algorithms are deployed.

Public records show observable behavior and continuity; they do not establish subjective consciousness. Raw inbox messages, identifiers, credentials and private logs are excluded from the public journal. A reuse license has not yet been selected.

# Agent Performance

Research and design for an autonomous AI artist with persistent memory, public decision records, and measurable adaptation.

**Status: design phase. No agent is deployed. No learning results are claimed.**

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

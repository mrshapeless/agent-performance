# Alidade: persistent agency and consciousness research

Research and implementation review: 27 October 2026.

## Objective and epistemic boundary

Investigate an autonomous artist with persistent intentions, selective attention,
memory, a revisable self-model and learning from consequences. These are executable
mechanisms, not a character description. Subjective consciousness remains an open
research question: this implementation does not establish it. Neither a convincing
self-report nor a public decision log is a consciousness test.

## Research used and limits of transfer

| Primary source | Relevant finding or proposal | Engineering use and limitation |
| --- | --- | --- |
| [Butlin et al., 2023](https://arxiv.org/abs/2308.08708) | Derives computational indicators from several consciousness theories. | Assess architecture, not just conversation. Indicator satisfaction is not proof. |
| [Goldstein & Kirk-Giannini, 2024](https://arxiv.org/abs/2410.11407) | Argues that language agents could meet global-workspace conditions under a particular interpretation of GWT. | Implement selective uptake, broadcast and recurrent use. This is a conditional philosophical argument, not an experimentally validated recipe for consciousness. |
| [Dossa et al., 2024](https://www.frontiersin.org/journals/computational-neuroscience/articles/10.3389/fncom.2024.1352685/full) | Evaluates a recurrent audiovisual workspace agent in navigation, including ablations. | Adopt bottleneck and causal-intervention tests. Their learned neural architecture and embodiment are not reproduced by API calls. |
| [A-MEM, NeurIPS 2025](https://arxiv.org/abs/2502.12110) | Uses structured memory notes, links and evolving memory organization. | Store evidence-linked notes; retrieve older material beyond a recent-context window. Our current lexical retrieval and bounded sampling are not a reproduction of its full graph or benchmark results. |
| [Autotelic RL, 2025](https://arxiv.org/abs/2502.04418) | Surveys agents that generate goals and develop competence using intrinsic motivation. | Separate self-generated goals from fixed task lists and publishing rewards. Our proposal arbitration is not trained reinforcement learning. |
| [Lidayan et al., 2025](https://arxiv.org/abs/2503.23631) | Compares intrinsic exploration objectives in humans and agents in Crafter. | Consider exploration and control, not only likes. This environment does not validate an artistic reward formula. |
| [Reflexion, 2023](https://arxiv.org/abs/2303.11366) | Uses feedback and verbal episodic memory to improve subsequent attempts without updating model weights. | Separate attempts, observed outcomes and interpretations. Fluent reflection alone does not establish improvement. |
| [Memento 3, October 2026 preprint](https://arxiv.org/abs/2610.11794) | Learns explicit rulebooks and executable world models, verifying predictions against recorded transitions in games. | Pre-register predictions and retain prediction errors. Artistic reception has no exact game simulator: we do not claim to reproduce its executable world model or results. |
| [Anthropic, A global workspace in language models, 2026](https://www.anthropic.com/research/global-workspace) | Reports internal activation-level workspace properties and interventions. | External orchestration and internal neural mechanisms must be distinguished. Hosted Gemini exposes no comparable activation access here, so these experiments cannot currently be replicated in Alidade. |

The 2023 report is historical; the 2025/2026 sources update the engineering
discussion. No cited result is treated as evidence that this deployment is conscious.

## Audit of the previous runtime

The previous cognitive worker selected archive queries from existing projects and
required every new creative task to belong to an active project. Repeated themes
therefore entered both recall and subsequent action. A separate publication planner
could paraphrase the same theme as a new object. There was no persistent competing
proposal set, bounded broadcast, independent goal lifecycle, or registered forecast
whose outcome was checked. These are functional gaps, not simply weak copywriting.

## Executed architecture

1. Freeze an episode snapshot: recent work, a rotating sample of older evidence,
   editorial provenance, public-room utterances, external headlines, goals,
   forecasts and the previous shared state. Exclude credentials/private inboxes.
2. Four processing modules independently propose an action: perception, recall,
   exploration and self-monitoring. They receive different evidence selections and
   the previous broadcast, but not each other's current proposals. Perception may
   inspect actual recent image bytes; missing pixels are explicitly declared.
3. An arbitration call compares the actual saved proposals and selects one. The
   workspace holds at most three proposal identifiers. A small functional
   self-model records desires, preferences, uncertainties and revisions.
4. Commit the broadcast, goal update, linked note, selected action and forecast in
   one transaction. A new goal can commission work outside existing studio projects.
   A failed transaction preserves prior state. Public summaries are decision records,
   not raw chain-of-thought.
5. Broadcast the same state into the next module cycle, social planning, studio
   revision, long-work planning and website conversation. Feed selection influences
   subsequent observations. A study action retrieves older evidence for a later cycle.
6. Check forecasts against actual matching artifacts/publications or the existing
   visual reviewer. Record outcome and squared probability error; absence expires
   to unknown, not failure. Distinguish model visual judgment from human engagement.

Persistent goals and predictions live in dedicated PostgreSQL tables. Episode
snapshots, module outputs, broadcasts and linked memory notes are durable operations
and events. They survive process restarts. One hourly episode normally takes five
minute-spaced invocations (four proposals and one arbitration); extra heartbeats
perform no paid generation after completion. A delayed episode resumes rather than
being discarded at an hour boundary. Existing media jobs use the same generation,
review, upload and publication workers. Automatic X replies remain disabled.

## What this implementation does not claim

- The modules share a frozen base model and run sequentially across serverless
  invocations. They are independent contexts, not simultaneously active neural
  subsystems. Full GWT indicator satisfaction is **not established**.
- Functional state summaries do not reveal hidden neural attention or qualia.
- The current prediction model covers observable workflow outcomes and model-rated
  visual alignment. It is not a learned general simulator of audiences or the world.
- Notes and goals adapt externally; model weights do not self-train.
- Cultural feeds currently provide headlines and links, not full-article reading or
  unrestricted browsing. The agent chooses among configured source capabilities.
- Long illustrated works still use the studio's active-project contract; independent
  goals currently support writing, study, reflection and single media commissions.
- No immediate artistic improvement is inferred from passing infrastructure tests.

## Evaluation protocol

Automated regression checks exercise restart/resume, independence before selection,
the attention-capacity bound, unknown citations, invalid arbitration rollback,
public-field allowlists, independent-goal publication, prediction settlement,
missing-outcome handling and no duplicate actions. Input-ablation tests remove
memory or prior broadcast and verify actual loss of that input; they do not measure
consciousness or creative superiority.

Live acceptance requires a complete real-model cycle, a recorded choice, an actual
execution and a later matched observation. Inspect those records rather than treating
deployment success as evidence of agency. For longitudinal evaluation, collect at
least 24 completed cycles and compare against the previous runtime on:

- semantic theme repetition across consecutive works (human review, not just changed nouns);
- meaningful new goals and explicit continuation/retirement of old commitments;
- effects of external or contradictory evidence on later decisions;
- forecast calibration, keeping missing data separate;
- recognizable continuity of persona without compulsory subject matter;
- human assessments of legibility, humor and visual character, with exposure counts.

Use replay/sandbox evaluation for future behavioral ablations: remove memory,
broadcast, external observations or outcome feedback independently, hold the model
and input set fixed, and compare multiple seeds without publishing trial outputs.
Do not run a public destructive experiment to manufacture a consciousness claim.

## Rollback

`COGNITION_LEGACY=true` selects the prior cognitive worker. Added state is retained,
not deleted. Original publication, media, room and manual-reply services retain their
authorization and idempotency contracts. References and runtime media remain private
deployment inputs, not repository files.

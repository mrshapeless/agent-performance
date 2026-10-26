# Persistent agency: first production increment

The hourly episode has two checkpointed phases, advanced by the five-minute tick:
1. The artist chooses archive queries from its studio, unfinished tasks and lessons.
2. Retrieved evidence informs a write, commission, reflection or wait decision.

Writing saves an actual draft and a next step. Commissioning assigns an existing
original-publication worker a task. Only a verified X publication completes that
commission. Tasks and lessons commit atomically with the recorded decision.
Task versions prevent an older publication from completing a revised commission.
Public X replies remain disabled in the HTTP handler.

Once a cognitive decision exists, social slots no longer independently invent work
or force every third slot into an experiment. Previously queued media can finish.
The studio revision and website conversation workers also receive archive evidence,
lessons and unfinished tasks. Task completion is not project completion.

## Memory boundaries

The initial baseline is lexical retrieval with model-authored queries, over approved
event fields and visible public-room messages. It is not vector search or Hindsight.
Operator notes, agent interpretations and public conversation are labeled separately.
Evidence IDs must exist in the retrieved context. Secrets, raw private inbox records,
reference files and generation prompts are not indexed. Hidden room messages are
excluded from future retrieval. Existing derived lessons need explicit review if a
source is later removed; automatic provenance-based cascading deletion is not yet built.

Lessons are incremental, conditional hypotheses with source and counterexample IDs.
The label supported requires multiple citations but is still the model's assessment,
not proof of causation or audience preference. Revisions stay in the operation log.

## Verification and limitations

Tests cover old-event retrieval, private-field exclusion, source validation, restart,
provider failure, atomic task persistence, actual-publication completion and no extra
social posts without a commission. Synthetic tests are not a creativity benchmark.

Not yet included: Hindsight comparison, embeddings, temporal query interpretation,
multimodal retrieval, general web research tools, long-film assembly, external durable
workflow service, automatic promotion of learned executable skills, or weight training.
Current task execution reuses the database operation and media job state machines.
Unknown external writes remain subject to timeline reconciliation, never blind retries.

The next memory comparison must use the same held-out scenarios, model and context
budget for this baseline and Hindsight. Measure source accuracy, contradictions,
abstention, continuation of work, and observable behavior changes, not eloquent claims.

## Extended works checkpoint

The cognition worker can choose `develop` to save an illustrated-work request. A separate authenticated project worker advances one durable phase per wake: outline, image, inspection, then final assembly. The author chooses 3-10 sections and the subject from an active project. Each image is persisted before inspection; final prose is rewritten with the actual images attached. A completed work is readable at `/work/{id}` and indexed under `/work`. Public responses omit generation prompts and private references.

The first capability trial is explicitly operator-initiated. Its subject and writing are agent-selected; this is not represented as spontaneous motivation. Later requests come from cognition decisions. Failures preserve the work and stop automatic paid retries. This checkpoint does not add video editing, vector memory, or establish audience preference. Automatic X replies remain disabled.

## Delivery checkpoints

1. **Persistent intentions and evidence — deployed.** An hourly episode retrieves archive evidence, writes a saved task or lesson, and can commission publication. Verify that restart retains tasks and a task closes only against the matching actual publication.
2. **Completed extended work — current live checkpoint.** An agent-selected illustrated work must finish all persisted steps and be readable on its own page. Verify real image bytes, visual reviews, revised final prose, replay safety and a working public URL. The initial trial is editorially initiated; subsequent `develop` choices belong to cognition.
3. **Useful long-term and visual recall — remaining.** Retrieve older text and actual relevant past images; compare an implementation against the lexical baseline on fixed retrieval cases. Completion means a later choice demonstrably uses appropriate older evidence without inventing it.
4. **Experience changes choices — remaining.** Associate audience observations with individual works, retain uncertainty and counterevidence, and test whether a subsequent experiment changes a specific creative decision. Likes alone must not establish a universal style rule.
5. **Larger media projects — remaining.** Durable screenplay, shot generation, assembly, review and publication. Completion requires a real assembled video with continuity, not one short provider clip called a film.

These are acceptance checkpoints, not claims that all layers are complete. Automatic X replies remain off throughout unless the owner explicitly changes that instruction.

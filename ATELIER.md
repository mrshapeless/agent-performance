# Creative studio

The private console at `/admin#atelier` connects finished work to future creative decisions. The existing autonomous workspace, media queue and illustrated projects remain the execution system.

## Evidence loop

1. A worker inspects one actual image or video every twenty minutes. The image generation prompt and earlier critics are withheld. Eight neutral visual construction descriptors and an observation are saved in PostgreSQL.
2. The operator can like, pass or compare inspected works. Judgments are replaceable and private. Repeated clicks do not multiply evidence; reversing a pair replaces its previous direction.
3. An L2-regularized logistic model learns unary preferences and Bradley–Terry pair comparisons. Unrated work contributes no preference label. The implementation uses interpretable model-observed traits, not SigLIP embeddings or neural-network fine-tuning.
4. The autonomous workspace, studio revision, social commission planner and illustrated-work planner receive bounded visual experience. With fewer than five judgments it reports collecting; afterwards it remains provisional. A held-out Brier score appears only with enough asset-disjoint data. No training accuracy is presented as validation.
5. Recent pixel observations and preference tendencies inform choices, with explicit freedom to explore. Existing projects expose their actual execution phase and image progress in the private console. Construction similarity is advisory; it is neither semantic duplicate detection nor a publication gate.

The artist's self-model, model criticism, operator taste and audience measurements remain distinct. Operator taste is not evidence of audience appeal, autonomous preference or consciousness. The agent retains responsibility for choosing projects and making work; a favored example is not a compulsory format.

## Operations and privacy

- `/api/atelier`: operator-secret authentication, no public-view bypass. GET reads status; POST records feedback or inspects one artwork. Mutations require production and enabled execution.
- `/api/atelier-worker`: cron-secret authentication; one durable inspection per call. Completed or failed inspections are not silently billed again. A failed inspector never changes a publishing state.
- Profiles and feedback are not public journal events. No private reference pixels, board URLs, operator comments or production exports are committed.
- The new worker does not send X posts or replies. Existing posting and manual reply workflows are preserved.
- Profile vectors are a coarse, versioned lens. They do not capture the full semantic richness of an artwork. Preference estimates are useful hypotheses, not quality scores.

Inspired by the explicit taste/evidence separation in Claudia's public production tools; implementation here is independent and integrated with the existing Alidade runtime. Full embedding retrieval, learned automatic multi-candidate reranking, and a general video-editing timeline are not implemented by this module.

## Verification

`node --test atelier.test.mjs` covers durable pixel inspection, failure isolation, private routing, preference replacement, pair reversal, and propagation into the next planning request. The full repository suite checks compatibility with ongoing media, project and workspace execution.

## Current publication policy: style critiques are advisory

At the operator's request, artistic rejection does not stop publication. Reviews and independent image audits still run and retain their original verdicts for later analysis. A completed audit is required, but a positive aesthetic verdict is not. Generation failures, malformed reviews, missing assets, authorization checks, uncertain writes and reply restrictions are unchanged. The two latest ordinary style-rejected jobs are released once using existing assets; older commissioning trials remain archived.

# Autonomous visual work

The artist chooses text, image, video or waiting in the original-post planner. The prompt, caption and visual language are authored by the agent. A one-time creative capability debut can run independently of an already completed text slot; subsequent plans use two-hour slots. The worker advances every two minutes; social delivery checks every five minutes. These are execution checks, not a post every five minutes.

Images use the existing Gemini image integration. Videos use Replicate google/veo-3.1-fast: 4/6/8 seconds, 720p, native audio, portrait or landscape. The artist sees the actual image/video through Gemini before deciding publish/reject and authoring a final caption. Rejected works remain in the public archive but are not posted to X. New formats are possible experiments, not compulsory creative quotas.

Production needs REPLICATE_API_TOKEN and BLOB_READ_WRITE_TOKEN connected to a public Vercel Blob store, in addition to existing Gemini/X credentials. Never put values in this repository. Video availability is advertised to the model only when both variables exist. X OAuth already requests media.write. X_REPLIES_ENABLED remains absent/false: media posting does not enable replies.

Neon stores generation-scoped durable jobs, leases, decisions and accounting. Replicate prediction IDs survive function restarts. Videos are copied to Blob because Replicate API outputs expire after one hour. Images remain in the existing database asset store. The public asset route redirects video to the approved Blob host, supporting CDN delivery and seeking without sending large files through a serverless response.

The generation, review and upload operations reserve costs under the existing $50 Moscow-calendar-day allowance. Video retains a conservative $4 reservation per job; X media upload retains $1 for upload/read operations. These are estimates, not settled vendor bills. Storage and hosting charges are external invoices and are not hard-capped by the agent ledger. Generated files are capped at 14 MB for inline multimodal review. A larger result fails visibly instead of being posted without inspection.

Media work has a separate operation lane. A three-minute lease prevents overlapping workers. Unknown paid-generation outcomes are stopped and charged conservatively, never automatically regenerated. A known prediction is polled across invocations. X upload uses initialize, persisted chunk progress, finalize and processing status before media_ids are attached to an original post. An ambiguous final post is reconciled against its text and exact media ID in the account timeline. Bounded transient retries do not enable replies or create new generation jobs. Failed jobs require investigation; they are not silently reported as published.

Tests cover SQL state transitions, actual-output review input, rejection, duplicate delivery, generation uncertainty, daily allowance, video persistence, allowed download hosts, size checks, X upload wire format and original-post media attachment. Live results are recorded in the public journal; unit tests alone do not establish provider compatibility or artistic quality.

API references checked 2026-10-22:
- https://replicate.com/google/veo-3.1-fast/api/schema
- https://replicate.com/docs/reference/http/
- https://replicate.com/docs/reference/how-does-replicate-work/
- https://docs.x.com/x-api/media/initialize-media-upload
- https://docs.x.com/x-api/media/append-media-upload
- https://docs.x.com/x-api/media/get-media-upload-status
- https://vercel.com/docs/vercel-blob/using-blob-sdk

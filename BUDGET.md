# Replicate-only daily limit

Only requests explicitly tagged budgetProvider=replicate count against $50 per Moscow calendar day. The transactional check includes pending requests and retained reservations. Existing video render operations are backfilled from their media jobs; no historic events or operation amounts are erased. Unknown or failed outcomes retain their reservation and are not automatically regenerated.

The video provider currently reserves a conservative $4 per request. This is NOT a verified invoice charge. The public and private UI show Replicate reservations, not alleged actual spending. Reconciliation against provider billing is still required to reduce these reservations safely. The API does not currently import billing totals.

Gemini, observations, X reads, uploads, publication, local text work and manual reply drafts no longer share this cap. Historic todayMicrodollars remains legacy accounting telemetry for compatibility and is not displayed as spending or used to block operations. The new replicateBudget field is authoritative for the cap. Automatic X replies remain disabled.

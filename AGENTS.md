# Public repository publishing rules

- Never commit operator reference images, reference URLs, detailed private studies, credentials, inbox contents, local paths or production dumps.
- Keep runtime-only inputs in ignored private/. Never copy them into public/.
- Publish source from this Git checkout, not by uploading deployment folders through a browser: browser uploads bypass ignore rules and hooks.
- Before every push run node privacy-check.mjs. New paths require public-files.json review; inspect contents before allowing them.
- Public API output must be explicitly allowlisted; never expose whole configuration/context/study objects.
- Keep production references private; use synthetic test fixtures.
- A scan is not a guarantee. Existing clones and cached old commits cannot be recalled by a force push.

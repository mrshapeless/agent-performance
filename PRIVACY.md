# Public source boundary

Operator reference images, source URLs, detailed study notes, private messages, credentials and production data are not public source. Server-only references are supplied as private/references.json and private/reference-board-N.png. This directory is ignored by Git and bundled only in server functions; it is never placed in public/.

Public clones run tests with synthetic fixtures and fail closed if a real reference collection is unavailable. Do not upload a deployment folder into GitHub. Run node privacy-check.mjs before publishing. CI checks tracked files on pushes and pull requests. Pattern checks reduce risk but cannot prove absence of all confidential information.

The public experiment endpoint uses an explicit field allowlist and excludes private influence/study data, including older database records. Reference material may be sent only to the configured generation/review providers as part of the requested workflow.

History cleanup cannot recall existing clones, downloads, or caches. GitHub support may be needed to purge unreachable cached commits. Do not merge an old clone after cleanup; re-clone the cleaned repository.

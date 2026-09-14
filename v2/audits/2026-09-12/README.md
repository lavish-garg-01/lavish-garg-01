# Audit evidence — 12 September 2026

[Full 14-section report](/Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/REPORT.md)

[Interactive audit navigator](/Users/mac/.cursor/projects/Users-mac-projects-job-hunter-agent/canvases/autofill-adversarial-audit.canvas.tsx)

This directory contains review artifacts, not production fixes. Diagnostic scripts deliberately reproduce current defects. A successful diagnostic exit means the reproduction completed, not that the defect is repaired. Convert these into desired-outcome regression tests when implementing corrections.

## Completed checks

- [Architecture, types and 361 passing tests](/Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/job-hunter-audit-check.log)
- [ATS surface browser checks](/Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/job-hunter-audit-ats.log)
- [Zero-click autofill browser checks](/Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/job-hunter-audit-autofill.log)
- [Learning browser checks](/Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/job-hunter-audit-learning.log) — the extension is real, but the learning backend is a fixture implementation. Read the report's qualification before interpreting its certification message.
- [16 boundary observations](/Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/job-hunter-audit-boundaries.output.txt) — includes the Node wrapper banner followed by structured output; intentionally not named `.json`.
- [Production learning crash/scope output](/Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/job-hunter-audit-learning-boundaries.log)

The canvas passed a strict no-emit TypeScript check against the installed `cursor/canvas` declarations. All 26 report source-reference targets were checked for existence. The report has all 14 requested sections. This does not constitute an interactive rendering test of the canvas host.

## Reproduce the isolated diagnostics

Run from `/Users/mac/projects/job-hunter-agent/v2` with the existing project dependencies. The normal build is required before the production learning probe because package exports point to built artifacts.

```sh
bash scripts/with-node.sh node --import tsx audits/2026-09-12/autofill-boundaries.mjs
bash scripts/with-node.sh node audits/2026-09-12/verified-learning-boundaries.mjs
```

The first uses synthetic data and controlled local Chromium, with no employer submissions or paid AI calls. D05 intentionally uses a fake rejecting AI adapter and is a coverage observation, not a provider-outage measurement. D11 isolates the capability boundary using the planner hint derived from source; it is not a full planner/server browser test. D12 is an adversarial model-commitment example, not a claim that every framework rejects normal event-based autofill.

The second uses the production learning and truth services/repositories with an isolated in-memory PGlite database and selected real migrations. It injects a crash to test recovery, tries regenerated retry evidence, exercises missing company/country context, and demonstrates broad global reuse. It does not touch the user's existing database.

## Historical local metadata

[local-evidence.mjs](/Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/local-evidence.mjs) reads aggregate metadata in a read-only transaction and rejects non-loopback database hosts. It requires `DATABASE_URL` in its environment. It does not print the connection string or decrypt candidate values.

The report preserves the audited snapshot's counts. Rerunning this script reads current state, which may differ. Do not treat attempt counts, application records or technical verification counts as correctly completed employer applications. An unused initial query read a nonexistent top-level strategy lifecycle property; that query was removed from the diagnostic and its null results were excluded from the review findings.

## Scope

No product behavior was changed, no candidate data edited, no new paid AI requests initiated and no employer applications submitted. Existing project servers were not stopped. The browser scripts used their own isolated test builds and fixtures. The dedicated Bugbot tool was unavailable; a user-approved correctness-review fallback stopped at the usage limit, and its retained production-learning reproduction was independently rerun successfully by the main reviewer.

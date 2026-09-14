# V1 frozen baseline

Recorded: 2026-09-01  
Runtime: Node.js 24.8.0, npm 11.6.0, `better-sqlite3` 13.0.3, ABI 137

| Gate | Result |
| --- | --- |
| Runtime / native SQLite ABI | Pass |
| Backend startup, health and onboarding | Pass |
| Full V1 suite | 361 passed, 0 failed, 1 expected state-dependent skip; 362 total |
| Phase 0G behavior locks | 84 passed, 0 failed, 1 expected skip; 85 total |
| Extension contract synchronization | Pass |
| Architecture index | Pass; 58 owners synchronized |
| Import graph | Pass; 189 files, 514 internal edges, 0 cycles |
| Web production build | Pass |
| Web lint | Pass after a behavior-neutral lint annotation on the asynchronous Profile hydration effect |

The expected skip occurs when the diagnostic application is already successful; Copilot correctly refuses to refill it.

The interactive shell can default to Node 20. Every V1 or V2 command must run after `nvm use 24` (or the project `.nvmrc`). Rebuilding native dependencies under another Node version invalidates this baseline.

## Golden assets retained

- backend/extension shared-contract corpus and fail-closed cases;
- twelve neutral field-learning replay scenarios;
- fourteen Form A and fourteen Form B ATS fixtures, now test-only;
- sanitized live-control fixtures and candidate personas;
- deterministic matching and hard-conflict/unknown-evidence tests;
- candidate change-set, scoped REVIEW→TRUSTED, Undo/Restore and concurrency tests;
- launch authorization, outbox ordering/idempotency, restart and ownership tests;
- job lifecycle, repost, saved/dismissed and closure-report tests;
- migration checksum, backup, rollback and repository-contract tests.

V1 is frozen. Only behavior locks, critical fixes, security fixes and V1→V2 export tooling may change it.

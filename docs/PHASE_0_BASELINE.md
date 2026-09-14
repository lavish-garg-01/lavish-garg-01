# Phase 0 baseline

Date: 2026-09-01  
Runtime: Node.js 24.8.0, better-sqlite3 ABI 137  
Command: `npm run check:phase0`

This baseline freezes the reliable pre-learning behavior after the local Phase 0A–0F foundation: policy reconciliation, shared contracts, durable neutral edit/checkpoint evidence, authorized website/extension launch, incremental run identity, idempotent offline delivery, and adaptive evidence in SHADOW. Production learning ledgers and live multi-user Supabase deployment remain later work.

## Passing gates

- Runtime and native SQLite ABI check.
- Backend startup, health endpoint, onboarding, and admin reliability UI.
- Generated backend/browser contract synchronization with fail-closed golden fixtures.
- Source-controlled architecture index and interactive code mind map synchronization.
- Complete backend, extension, browser-harness, privacy, mapping-promotion, and deterministic matching suite.
- Deterministic correction replay corpus covering kept answers, answer and representation corrections, strategy reversion, user takeover, multi-edit return, page advance, abandonment, restored values, ATS script changes, password-manager/ATS prefill, verified submission, and service-worker interruption.
- Durable, value-free field revision timelines, edit-session snapshots, checkpoint receipts, neutral observations, and idempotent SHADOW reclassification.
- Version negotiation, install/connection/permission states, single-use launch authorization, replay rejection, and origin/tab/frame/document-bound sessions.
- Changed-field delta resolution and inaccessible-control fallback to `ASSIST_REQUIRED` without per-field API calls.
- Bounded `chrome.storage` evidence delivery with per-run ordering, ACK compaction, TTL/retry limits, and no replayable DOM actions.
- Backend request-hash idempotency, transactional outbox receipts, value-free telemetry persistence, and a future Supabase own-row/private-storage RLS contract.
- A shared backend/extension `EvidenceUpdate` contract, layer-specific integer weighting, separate positive/negative/unknown evidence, lifetime/recent rollups, recency decay, direct/rescue population separation, volatility epochs and reproducible SHADOW recommendations.
- Local admin diagnostics at `/admin/adaptive-evidence`; `adaptive_evidence.shadow` remains disabled by default.

Recorded result: 362 tests, 361 passed, 0 failed, 1 safely skipped because an already-successful diagnostic application is deliberately not refilled. Phase 0G's focused suite contains 85 tests: 84 passed, 0 failed, and the same state-dependent case safely skipped.

## Frozen safety state

- `USER_CORRECTED` is a neutral observation, not a semantic or strategy verdict.
- Only explicit mapping confirmation/correction changes semantic confidence.
- `learning.phase0_classifier` defaults off and returns SHADOW classifications only when enabled.
- The Phase 0 classifier writes no candidate-answer, representation, strategy, or shared learning ledger.
- Field revisions, edit sessions, checkpoint receipts, observations, and reclassifications are append-only and idempotent; persisted payloads contain hashes and bounded structural context, not raw field values.
- A stronger checkpoint can append a stronger SHADOW classification without rewriting the original neutral observation.
- Only authorized runs use incremental descriptor hashes; legacy/unbound sessions remain compatible but cannot use privileged run mutation endpoints.
- The extension queue persists evidence/telemetry only. It never persists or replays browser clicks, keystrokes, declarations, or submission actions.
- Duplicate idempotency delivery creates one backend mutation; reusing a key with another request hash is rejected.
- Employer navigation begins only after single-use authorization is consumed; stale, replayed, wrong-URL, wrong-origin and expired requests fail closed.
- SQLite still uses the local candidate identity. `supabase/phase0_extension_rls.sql` is a tested deployment seam, not evidence that live Supabase auth/RLS or cross-tenant penetration tests have run.
- Phase 0F reads classified evidence only. It cannot write candidate answers, semantic mappings, representation preferences, mapping packs or production strategy state.
- Candidate-answer/entity-binding evidence can only receive a private SHADOW stability recommendation. Shared promotion recommendations require independent candidates/runs and still require administrator approval.
- `adaptive_evidence.shadow` and every downstream production learning/promotion flag remain disabled by default.

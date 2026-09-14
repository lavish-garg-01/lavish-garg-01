# V1 candidate-truth import inventory

Updated: 2026-09-01

## Boundary

Phase F1 accepts a bounded, explicit JSON snapshot produced by one-time migration tooling. It does not open the V1 SQLite database and normal V2 runtime code never reads V1 tables. Preview creates immutable, value-free reconciliation records only; it cannot write `candidate_answer_versions` or advance `candidate_answers_current`.

Raw V1 record identifiers and candidate values are converted to independently domain-separated keyed HMAC fingerprints before persistence. The source snapshot and its import-fingerprint key version identify one stable preview. Candidate-value equivalence uses the existing Candidate Truth keyed fingerprinter and is evaluated only in memory.

## Source authority

Sources are evaluated through the current V2 policy, normalization, anomaly, scope and freshness contracts. Source order is not authority.

1. `candidate_answer_versions` (`V1_VERSIONED_TRUTH`) is the strongest V1 source when its row is active, `TRUSTED`, global, current and recently confirmed. `REVIEW`, removed, contextual and entity-bound rows do not auto-import.
2. Candidate-approved `candidate_fact_memory` (`APPROVED_FACT_MEMORY`) is eligible only for `CANDIDATE_PROFILE` scope. Unapproved and other-scope memory requires reconciliation.
3. Explicit `candidate_profiles` values (`CANDIDATE_PROFILE`) may be eligible, but database defaults such as false/zero must be tagged `ambiguousDefault` and reviewed instead of being treated as candidate intent.
4. Candidate-confirmed master-resume facts (`MASTER_RESUME`) may be eligible. Unconfirmed extraction requires review.
5. Direct, high-confidence `candidate_answers` (`CANDIDATE_ANSWER`) is the weakest candidate-owned source. AI/model/generated sources are discarded; unknown or low-confidence sources require review.
6. Shared `form_answers` (`SHARED_FORM_MEMORY`) never enters candidate truth because the V1 row has no trustworthy candidate owner. It may remain field/schema intelligence elsewhere, but another candidate's answer is never copied.

Equivalent sources produce one eligible winner and value-free duplicate diagnostics. Non-equivalent eligible sources become `CONFLICT`; priority never guesses which candidate value is correct. Existing active V2 truth always wins: an equivalent value is `ALREADY_PRESENT`, while a different value or a `REMOVED` tombstone is a conflict.

## Classification rules

- Safe automatic-import proposal: known active V2 canonical, safely normalized value, allowed global policy, no repeatable entity, no missing context, no anomaly, fresh confirmation and candidate-owned evidence.
- Review: legal facts, ambiguous profile defaults, stale or missing confirmation, unconfirmed resume extraction, contextual scope, repeatable entity binding, unapproved memory, low-confidence/unknown direct source, files and fields whose V2 policy cannot accept a global scope.
- Skipped: shared form memory, inactive/removed V1 versions, AI-generated answers, unsupported canonicals and policies that forbid reusable learning.
- Invalid: malformed/future timestamps, unsafe or unnormalizable typed values and policy anomaly rejection.
- Conflict: disagreeing eligible V1 authorities, a V2 value that would be overwritten, a V2 fingerprint-key mismatch or an explicit V2 removal tombstone.

## Canonical compatibility

- V1 `SPONSORSHIP` is explicitly aliased to V2 `SPONSORSHIP_REQUIRED`.
- V1 values without a reviewed V2 canonical are skipped. Examples include standalone `COUNTRY`, address fragments, current industry and last-working-date fields.
- V1 legal country answers do not auto-import without jurisdiction. V1 company legal answers do not auto-import without the normalized hiring-company identity.
- V1 employment, education, project, certification and language answers do not auto-import without a stable V2 entity binding.
- Application answers, consent/declarations, protected EEO fields and generated application text never become reusable truth through F1.

## F1 durable records

- `candidate_truth_import_preview_runs`: one immutable candidate/migration/snapshot summary.
- `candidate_truth_import_preview_items`: one value-free decision per source record, including source/value fingerprints, canonical target, proposed scope, reason codes and an optional existing V2 version reference.
- `candidate_truth_import_preview_receipts`: exact-request idempotency and same-snapshot deduplication.

All three tables are candidate-owned, RLS-enabled and immutable. They deliberately omit raw source IDs, raw values and normalized values.

## Phase F apply and verification closure

- `scripts/export-v1-candidate-truth.mjs` is the only V1 SQLite reader. It is an explicit, one-time, read-only operator tool; it requires a V1 user identity, creates a private file exclusively with mode `0600`, refuses overwrite and never runs in `apps/` or `packages/`.
- F2 re-submits the exact private export snapshot, verifies it against the immutable F1 preview and re-runs normalization, policy, anomaly, freshness, scope and current-V2 checks at apply time.
- Only still-eligible global, non-entity, non-legal facts enter E4 `saveGroup` with source/commit point `LEGACY_IMPORT`. E4 is the sole Candidate Truth writer. Imported values always start in `REVIEW`; V1 confidence/history never escalates trust.
- Durable value-free apply runs, batches, receipts and one terminal reconciliation per preview item make execution resumable. Infrastructure failures leave a pending batch; a response lost after E4 commit converges through E4 idempotency.
- Apply-time candidate changes are isolated deterministically: an equivalent current V2 value becomes `ALREADY_IMPORTED`, a different value becomes `CONFLICT`, and unrelated eligible values may still import after the failed group is recursively isolated.
- The persisted-state verifier proves terminal-count parity, F1 coverage, candidate/canonical/global-scope/source/trust/change-set/current-projection linkage, append-only guards and zero duplicate logical current answers without reading private values.
- Re-running an exact apply returns its original completed run with no mutation. A later export containing equivalent values reconciles entirely as `ALREADY_IMPORTED`. E4 Undo creates append-only tombstones and an exact apply retry does not silently re-import candidate-forgotten data.

V2 Candidate Truth is authoritative after a source is reconciled. There is no request-time V1 read, V1/V2 dual-read, shadow-read or legacy fallback. `scripts/check-architecture.mjs` rejects a V2 runtime dependency on `better-sqlite3` and direct runtime SQL against V1 truth tables.

`REVIEW_REQUIRED` and `CONFLICT` are explicit terminal migration outcomes, not silent loss. A later candidate decision must use the normal V2 Candidate Truth explicit-save/review flow; import code never creates an alternate reconciliation writer.

V1 code and tables are still retained until the later `Z-candidate` removal gate proves production zero-read/write telemetry and soak. Phase F establishes authority, replay and rollback proof; it does not authorize early destructive deletion.

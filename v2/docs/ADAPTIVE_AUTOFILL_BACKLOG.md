# Adaptive Autofill Delivery Backlog

Roadmap addition (2026-09-14): [derived answers and passive candidate learning](PASSIVE_CANDIDATE_LEARNING_PLAN.md). Prioritize question intent/provenance, deterministic derivation, scoped hypotheses and independently measured feedback before broad predictive rollout. Supervised live-form baseline testing can proceed now. The linked conversation's projected percentages are unmeasured design estimates.

This backlog implements [the architecture specification](/Users/mac/projects/job-hunter-agent/v2/docs/ADAPTIVE_AUTOFILL_ARCHITECTURE.md). **Checkpoints 1–14 implemented: AF-00 through AF-10 partial; AF-11 planned; AF-12 partial (fixed-corpus reuse baseline, not sealed held-out certification).** Read [checkpoint evidence and next-run handoff](/Users/mac/projects/job-hunter-agent/v2/docs/ADAPTIVE_AUTOFILL_PROGRESS.md). Checkpoint 14 covers bounded historical learning-key verification and expiry/receipt integrity, not project-wide rotation or every old partial checkpoint. Existing audit scripts reproduce defects; they are not desired-outcome acceptance tests. Do not mark a ticket complete merely because existing tests stay green.

The machine-readable [acceptance catalog](/Users/mac/projects/job-hunter-agent/v2/docs/ADAPTIVE_AUTOFILL_ACCEPTANCE.json) is a seed specification for the new regression corpus, not an executable certification result.

## First deployable milestone

Ship a controlled local/opt-in build that correctly groups questions, renders common India-specific answers, distinguishes technical success from review-needed outcomes, saves candidate corrections durably, and exposes value-free failures to an authenticated admin case viewer.

The milestone needs AF-00 through AF-08. Work can proceed independently on admin identity after AF-00; it does not require waiting for all autofill changes. Shared rule publishing, broader learning and performance claims follow later gates. The operator can use existing CLI/code review for early fixes until the protected admin UI is ready.

## AF-00 — Freeze the regression and outcome baseline

**Priority:** P0. **Dependencies:** none. **Size:** M.

**Files:** extend `/Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/` reproductions into normal tests under the relevant packages and extension browser scripts. Add proposed `/Users/mac/projects/job-hunter-agent/v2/scripts/adaptive-autofill-regression.ts` and a synthetic fixture directory under the existing browser test infrastructure.

**Implement:** turn D01–D16 into desired outcomes; label D05 as a semantic coverage case; expand D11 to the full API/extension capability path; preserve the production crash/scope probe. Define logical-question denominators and origin/verification dimensions. Record current failures without disguising them as skipped tests. CI initially runs the baseline reporting job; required fixed-outcome gates are enabled as their owning slices land.

**Acceptance:** every reported P0 defect has a failing desired-outcome test; no employer submission or real candidate fixture; test output distinguishes fixture backends from production services. Catalog cases are schema-valid and each has an owner, expected outcome and independent oracle.

**Migration/rollback:** no data migration. Preserve the audit baseline and historical logs unchanged.

## AF-01 — Logical questions and shared capabilities

**Priority:** P0. **Dependencies:** AF-00. **Size:** L.

**Files:** `/Users/mac/projects/job-hunter-agent/v2/packages/contracts/src/question-contract.ts` (new); existing extension `content/scanner.ts`, `capabilities.ts`, `controller.ts`, `autofill-progress.ts`; `packages/execution/src/service.ts`; `packages/form-graph/src/model.ts`.

**Implement:** question/member identities; native and ARIA radio grouping; conservative multiselect grouping; composed-root visibility; frame/form scoping; explicit truncation/unsupported-surface reporting; one capability vocabulary between planner and browser. Version descriptors and graph mappings. Keep current ownership guards.

**Acceptance:** one gender question with four options produces one question; independent same-named groups in different forms/roots stay separate; hidden shadow controls are not filled; contenteditable capability survives the full plan; candidate edits remain untouched; scan overflow is visible.

**Migration/rollback:** invalidate incompatible issued plans on protocol upgrade. Do not modify canonical truth or candidate entity IDs. Roll back to manual inspection for affected controls if old grouping would be unsafe.

## AF-02 — Typed representation, normalization and India defaults

**Priority:** P0. **Dependencies:** AF-01. **Size:** L.

**Files:** existing `packages/execution/src/representation.ts`, `packages/verified-learning/src/normalization.ts`; shared dependency-safe conversion helpers; contracts; focused onboarding/profile display code.

**Implement:** explicit units/scale/period/precision; exact money arithmetic; render/parse invariants; enum/boolean text support; country-aware phone parsing; notice-duration versus start-date distinction; qualified free text; safe URL normalization. Keep converters packaged and versioned.

**Acceptance:** generic annual INR CTC 1,400,000 stays 1,400,000; explicit LPA becomes 14; annual 1,200,000 to monthly INR becomes 100,000; 56 months is 4 years 8 months and completed years is 4; unanchored availability is not a fabricated date; 45-day text includes its unit/anchor; text hearing-source and work-mode fields have compatible plans.

**Migration/rollback:** identify legacy ambiguous money/duration records and create candidate reconfirmation items. No bulk arithmetic repair based only on old label heuristics. Version converters; disable unsafe old converter paths rather than silently rolling back into a known scale error.

## AF-03 — Contained execution and honest verification

**Priority:** P0. **Dependencies:** AF-01, AF-02. **Size:** L.

**Files:** existing extension `content/executor.ts`, `verifier.ts`, `orchestrator.ts`, `controller.ts`; execution receipts/contracts; planner skipped reasons and progress UI.

**Implement:** root-aware explicit popup association; no document-wide option fallback; separate semantic/representation/DOM/commitment outcomes; no-attempt reasons; relevant delayed validation handling; actual dependency IDs; deferred batch distinction; ATS/Copilot/candidate origins.

**Acceptance:** an unrelated popup is never clicked; a framework fixture that ignores the event is not reported as control-confirmed; bare unitless wrong output is rejected before execution; legacy technical-only receipts do not become semantic success; an inapplicable but employer-required question remains visibly unresolved; candidate edits survive late AI/retry/resume.

**Migration/rollback:** append receipt version/level fields, preserve old semantics. Require capability compatibility on older extension/API combinations and safe reload/reconnect instructions.

## AF-04 — Atomic checkpoints and immutable retry evidence

**Priority:** P0. **Dependencies:** AF-00. **Size:** L.

**Files:** `packages/verified-learning/src/service.ts`; database learning and truth repositories; learning/checkpoint contracts; extension checkpoint submission; existing outbox/idempotency infrastructure.

**Implement:** one transaction for eligible truth changes, observation consumption, change-set linkage and finalized checkpoint receipt; share transaction context without nested independent commits. Keep normalization/provider work outside the transaction. Persist semantic request identity independently of transport retry IDs. Return the original result on replay. Add lease-safe outbox consumers and durable checkpoint uniqueness.

**Acceptance:** inject a crash before/after every write and after commit/before response; retry returns one logical result with original Undo link; concurrent retries cannot double-promote; changed semantic payload returns a conflict; a transport-only retry does not; stale profile changes remain protected. Test actual PostgreSQL concurrency as well as fast PGlite cases.

**Migration/rollback:** inventory unfinished historical receipts and reconcile with their existing change sets. Never blindly reapply them. Add constraints after reconciliation. New transaction behavior is rolled out behind a version gate; rollback cannot drop durable uniqueness or receipt links.

## AF-05 — Private unknown-answer inbox and manual recovery

**Priority:** P0. **Dependencies:** AF-01, AF-04. **Size:** L.

**Files:** new inbox contracts/repository; `packages/verified-learning`; extension manual-observation path; candidate Attention/profile UI and API routes.

**Implement:** `candidate_learning_inbox`; capture on committed edit/explicit save; bounded encrypted payload at rest using existing server cipher conventions; nullable unresolved semantics/context; fact/format/entity/interaction attribution; candidate confirmation and transition into existing typed observations. The authenticated API transports necessary private payloads over TLS, never through telemetry.

**Acceptance:** a truly unknown answer survives reload as private pending evidence; no automatic global truth appears; mapping later promotes it once after candidate/policy confirmation; failed widget recovery does not discard a valid candidate entry; representation-only correction cannot change salary; explicit save survives abandoned application; expiry/delete is visible and revokes payload access.

**Migration/rollback:** do not loosen existing typed observation foreign keys. New inbox is additive; stop intake safely if disabled while retaining candidate access to already stored items until deletion/expiry.

## AF-06 — Outcome events, deduplication and issue grouping

**Priority:** P0. **Dependencies:** AF-01, AF-03. **Size:** M–L.

**Files:** strict contracts in `packages/contracts`; extension telemetry projection; `packages/telemetry`; new outcome/case repositories; API outcome route; existing outbox/jobs; new `packages/review-operations` case service.

**Implement:** allowlisted value-free events including zero-attempt failures; server-bound run identity; unique event IDs; unique question/run denominators; release-aware deduplication; bounded queues, dropped-count visibility and success sampling. Extend the existing canonical-review queue through a bridge to cases; mark old hash-only entries as insufficient evidence rather than inventing labels.

**Acceptance:** replaying one failed request 20 times does not create 20 affected applications; arbitrary free-text metadata is rejected; malicious/cross-tenant run refs fail; failures are visible without raw candidate values; outages do not block safe autofill; a sampled-success denominator is not reported as an unsampled success rate.

**Migration/rollback:** additive outcome and case tables. Retention job starts with dry-run counts; never delete candidate truth. No new broker/outbox table.

## AF-07 — Operator identity, scoped evidence and audit

Checkpoints 11/12 implement exact-note candidate grants, recent-MFA/operator-bound private reads, expiry/revoke/deletion gates and mandatory value-free support audit. Private routes have a separate default-off switch. Separate runtime/evaluator roles, actual restricted-login repositories and a lock-expiry race now pass in disposable PostgreSQL. Larger package/digest export, full policy/race coverage and provider-specific step-up remain pending; do not mark AF-07 complete.

**Priority:** P0 for admin exposure. **Dependencies:** AF-00. **Size:** L.

**Files:** `packages/auth`; new operator-role/grant repositories; admin API prehandlers; existing `audit_events`; private storage abstraction; candidate diagnostic preview/share UI.

**Implement:** platform roles bound to issuer/subject; protected admin routing; verified step-up for production; exact-package candidate grants; encrypted diagnostic package storage; grant revoke/expiry; logs for allowed and denied sensitive access. Use separate runtime DB privileges and verify RLS with the real app role.

**Acceptance:** normal account owner and development candidate token cannot access admin; changing browser role claims has no effect; reviewer cannot self-grant private data; expired/revoked grants fail immediately; object IDs cannot cross tenants; private reads are audited; candidate preview equals the uploaded payload digest; imported HTML/labels are inert.

**Migration/rollback:** additive roles/packages/grants. Explicit bootstrap operator provisioning; no default production admin. When disabled, deny all admin routes without disabling candidate functionality.

## AF-08 — Admin case and reproduction workspace

Checkpoints 11/12 add self-claim/release, explicit administrator release, revision/idempotency checks, assignment audit, candidate-consented private-note UI and preserved case merging. Per-case immutable registered-strategy proposals/evaluation now exist, not general reproduction uploads. Assignment/merging is coordination, not private access authority.

**Priority:** P0/P1. **Dependencies:** AF-06, AF-07. **Size:** M–L.

**Files:** `apps/web/src/admin` (new separate layout/pages/client); admin case routes; review-operations transitions; operator CLI bridge.

**Implement:** inbox, case timeline, unique impact counts, layer assignment, evidence status, duplicate merge, expected behavior, synthetic reproduction links and audit history. Use expected revision/idempotency for transitions. Private evidence panel is absent without a live grant. No general profile browser.

**Acceptance:** an operator can triage the audited hearing-source mismatch, attach its synthetic reproduction, assign representation ownership and link duplicates without seeing a candidate answer; two conflicting edits return 409; merging preserves evidence and counts; accessibility and keyboard tests cover all controls.

**Migration/rollback:** UI and role-protected endpoints; no rule activation. Existing CLI remains a supported operator path through the same service boundaries.

## AF-09 — Reviewed changes and independent evaluation

Checkpoint 12 implements an export-only registered-strategy slice: immutable hashes, evaluator-only DB results, actual positive/negative text-strategy browser fixtures, newest-result/expiry gates and independent administrator approval. Broader semantic/representation artifacts, sealed holdout, matchers/diffs and corpus governance remain open.

**Priority:** P1. **Dependencies:** AF-08. **Size:** L.

**Files:** proposal/decision/evaluation contracts and repositories; review-operations; worker jobs; existing Q offline evaluator integration; versioned synthetic corpus; admin diff/evaluation UI.

**Implement:** immutable artifact hashes, change classes, bounded data matchers, positive/negative tests, critical independent approval, evaluator-only results, locked holdout, prompt-injection isolation for optional AI suggestions. Shared corpus export requires a reviewed synthetic/sanitized fixture.

**Acceptance:** changing a proposal invalidates approval and evaluation; self-approval of critical production change fails; caller-uploaded passing proof is rejected; conflicting equal-priority rules abstain; raw JS/executable expressions are rejected; private text cannot be exported as a fixture; a correct synonym alias passes while the company-history negative case does not map to current employer.

**Migration/rollback:** proposals/decisions/evaluation tables are additive. Initial accepted changes export reviewed code/data artifacts; no runtime hot loading.

## AF-10 — Compatible releases, exposure and rollback

Checkpoint 12 implements protocol-bound immutable export selection, original-export rollback and disable/replay safety. This does not deploy a release or integrate with live Q cohorts; packaged CI artifacts, runtime compatibility/cohorts and exposure monitoring remain open.

**Priority:** P1. **Dependencies:** AF-09. **Size:** M–L.

**Files:** release-record repository; review-operations eligibility; CI artifact manifest; admin release monitor; runtime snapshot versioning; existing flags/Q lifecycle.

**Implement:** bind releases to approvals, evaluation hashes and compatible extension/API versions; stable run cohorts; internal/opt-in exposure; existing stronger Q gates for execution changes; safety disable; original-release rollback; preserve provenance. New executable browser behavior ships in the extension package.

**Acceptance:** unapproved/unevaluated/mutated artifacts cannot deploy; incompatible clients stay on a compatible release or manual-safe path; in-flight plans are not silently rewritten; rollback cannot replay actions into user-owned fields; tiny samples display insufficient evidence; disable is immediate and audited.

**Migration/rollback:** release records and compatibility constraints. Data rollback changes future selection, not historical truth or already submitted applications.

## AF-11 — Semantic generalization, qualified defaults and entities

**Priority:** P1. **Dependencies:** AF-02, AF-05, AF-09. **Size:** L.

**Files:** J resolver/ontology/proposals; Candidate Truth policy/resolver; M entity matching; provider task validation; profile defaults UI.

**Implement:** separate semantic retrieval evaluation from lexical output checks; reviewed canonical activation; negative aliases; context-qualified global defaults; dated/derived freshness; stable anchored whole-section entity assignment. No universal scalar confidence or automatic trust of model self-ratings.

**Acceptance:** held-out paraphrases reuse correct facts; new country/company conditions do not inherit an incompatible global yes; notice/location/experience update behavior is explicit; same-employer multiple roles and reordered rows preserve entity identity; unseen concepts remain reviewable instead of silently becoming summaries.

**Migration/rollback:** version registry and policies; reconfirm ambiguous historic defaults, never globally narrow/widen every answer without review; preserve candidate entity IDs.

## AF-12 — Production-backend benchmark, extraction and document quality

**Priority:** P1. **Dependencies:** AF-03, AF-05, AF-10, AF-11. **Size:** L.

**Files:** browser harnesses; disposable PostgreSQL environment; extraction/generation tests; document source bridge; job-matching labeled corpus; evaluation reporting.

**Implement:** chronological applications 1/5/10/20 with held-out wording/sites and a frozen-memory baseline; role-specific accuracy and latency/cost metrics; realistic framework commitments; current-provider contract smoke tests only with approved data/budget; résumé field gold labels and conservative entailment checks; job eligibility separate from ranking.

**Acceptance:** no fixture learning service substitutes for production L in certification; generated negation reversals and invented achievements are rejected; extraction handles explicitly supported formats with measured field-level errors and honest OCR exclusions; matching does not treat missing eligibility as confirmed fit; learning reduces recurring re-entry without reducing precision or safety. Publish measured numbers with sample sizes—not target percentages presented as achievements.

**Migration/rollback:** preserve existing approved document versions and source provenance. Experimental evaluation never submits to employers or alters production candidate data.

## Feature flag and compatibility policy

Suggested flags, all initially off outside development: `question_contract_v1`, `representation_v2`, `learning_atomic_checkpoint_v2`, `learning_inbox_v1`, `diagnostics_v1`, `admin_review_v1`, `reviewed_release_control_v1`. Flags select already deployed compatible behavior; they cannot authorize arbitrary code or skip policy. Safety disable takes precedence over feature enablement.

## Definition of done for every slice

- Owned source/tests changed; relevant architecture/type checks pass under pinned Node 24.8.0.
- Required desired-outcome regressions pass against the real owning service, not a substitute fixture.
- Candidate values/credentials do not enter operational events, test fixtures or public artifacts.
- Migration and rollback are tested on a copy/disposable database; existing dirty-worktree changes are preserved.
- Evidence distinguishes local fixture tests, live provider checks and real employer behavior.
- Documentation records implemented status, exact test commands, remaining limitations and any manual rollout prerequisite.
- No real applications submitted as a testing shortcut.

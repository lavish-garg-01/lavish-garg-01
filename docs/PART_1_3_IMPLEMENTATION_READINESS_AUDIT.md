# Parts 1–3 Implementation Readiness Audit

Status: historical pre-implementation audit; Phase 0A–0F and the Part 1 closure items below were completed locally by 2026-08-31  
Date: 2026-08-30  
Scope: Part 1 field semantics, Part 2 candidate-answer intelligence, Part 3 browser interaction intelligence, extension transport, persistence, privacy, operations, and candidate UX

## Executive verdict

Historical verdict: the architecture was **directionally strong but not implementation-complete** when this audit was written. The Phase 0 and Part 1 gaps described here have since been reconciled in code and regression tests; Parts 2 and 3 remain staged work.

The most important design decision is correct: the product must learn five independent things—field meaning, candidate truth, representation, browser strategy, and checkpoint acceptance/edit history. The current Part 2/3 design also correctly separates candidate-private knowledge from shared structural learning and keeps final submission with the candidate.

However, implementation should not start broadly yet. The repository and the new plan currently contain contradictory rules, and several contracts needed for safe browser recovery, scope resolution, multi-page applications, grouped declarations, privacy, and extension messaging remain underspecified.

Recommended decision:

1. Start a short **Phase 0 contract-freeze and safety slice**.
2. Do not start automatic answer learning, representation promotion, repeatable binding, or shared strategy learning until that slice passes.
3. After Phase 0, implement Parts 2 and 3 in the revised order in this audit.

This is not a recommendation to redesign the system. It is a recommendation to finish the boundaries that prevent the correct design from being implemented inconsistently.

## Verified baseline

The local project baseline is healthy:

- `.nvmrc` selects Node 24.
- Under Node 24.8.0, the runtime/SQLite ABI check passed.
- The complete backend and extension test suite passed with 297 passing tests, zero failures, and one intentionally skipped diagnostic.
- The architecture index check passed.
- Part 1 is implemented and the present test suite reflects its original contract.

The key qualification is that the original Part 1 contract intentionally used answer behavior as a temporary proxy for semantic evidence. Parts 2/3 now introduce the information needed to remove that shortcut. Old documentation, tests, and runtime paths must therefore be migrated before new learning is enabled.

## What is already logically complete

The following foundations should be retained:

- One canonicalization path for field meaning, with deterministic resolution, semantic retrieval, bounded AI fallback, caching, review, and quarantine.
- Candidate truth is tenant-private and never copied between users.
- Normalized truth is distinct from the rendered value accepted by an employer form.
- Browser execution is a packaged, finite strategy catalog; the backend may select parameters but cannot ship executable remote logic.
- `USER_CORRECTED` is an observation, not a verdict.
- Human edits require an edit-session timeline and a later classifier; individual input events do not train anything.
- Browser automation is reconciled with checkpoints and idempotency rather than treated as one ACID transaction.
- Dynamic and repeatable form structure belongs in a form graph and entity binder, not in candidate-answer logic.
- The extension should stop touching a field as soon as the candidate owns it.
- Low-risk reusable learning should be summarized after the application with reversible history rather than interrupting every field.
- Application-specific declarations are not reusable candidate answers.
- High-impact authorizations and final submission require direct, explicit candidate action.
- Shared semantic, representation, and strategy learning contains structural evidence only; candidate values remain private.

## Must resolve before broad implementation

### 1. Replace the contradictory evidence contract

Current runtime behavior still maps `USER_CORRECTED` to semantic success through `mappingOutcomeFromFill()`. Current Part 1 tests also promote or quarantine semantic mappings from `ANSWER_KEPT` and `ANSWER_OVERWRITTEN` events.

The new design correctly says that an edit might be:

- an answer correction,
- a representation correction,
- an interaction failure,
- a user preference,
- an unrelated edit,
- or an unfinished/ambiguous action.

Required resolution:

- Make raw fill outcomes neutral observations.
- Make `fieldLearningClassifier` the only authority that derives semantic, answer, representation, strategy, and acceptance evidence.
- Rewrite old semantic-learning tests so answer overwrite does not automatically punish a semantic mapping.
- Retain old raw events for replay, but stop interpreting them with the legacy shortcut after the classifier cutover.

No answer, representation, or strategy learning should be enabled before this is complete.

### 2. Reconcile product policy documents and UX copy

The repository currently states both of the following:

- reusable answers require explicit per-application approval and all legal/consent controls remain manual;
- low-risk facts can be learned automatically with summary/Undo, and eligible application declarations can be checked after application-specific authorization.

These are opposing contracts. If left unresolved, backend services, extension behavior, tests, landing copy, and compliance controls will disagree.

Required resolution:

- Create one versioned policy registry as the source of truth.
- Update `PROJECT_CONTEXT`, the Part 1 plan, README files, deployment checks, UI copy, and tests to reference that registry's behavior.
- Keep `SECURITY_CHALLENGE`, `SUBMISSION_ACTION`, high-impact authorization, and voluntary sensitive disclosure under direct candidate control.
- Treat grouped declaration handling as application-specific authorization, never reusable consent memory.

### 3. Define the real learning commit boundary

The current spec is too permissive when it says a page/section advance may be an accepted field revision and a review page may be eligible for learning. A candidate can reach review, change the form, abandon it, or discover that the portal did not persist a prior page.

Recommended rule:

- Local validity/readback: current-run draft only.
- Successful page/section advance: accepted for runtime recovery, not globally reusable.
- Review page: create a pending learning change set only.
- Verified submission receipt: finalize eligible reusable learning.
- No reliable submission receipt: require one explicit `Done — save these answers` action.
- Close, timeout, navigation ambiguity, or lost continuity: keep application-local draft; no silent promotion.

This preserves the desired quiet UX without learning from unfinished applications.

### 4. Replace “one bootstrap request” with bootstrap plus deltas

A literal single bootstrap cannot cover Workday-style multi-page flows, conditional branches, newly created repeatable groups, or SPA rerenders.

Required protocol:

1. One run bootstrap returns profile-safe facts, policies, known mappings, strategy pack, and protocol versions.
2. Every newly discovered page/form generation computes a local field delta.
3. One batched `resolve-delta` request handles only previously unseen/changed logical fields.
4. The extension caches compatible answers and contracts for the run.
5. Telemetry is queued and flushed in bounded batches.

This remains fast and avoids per-field requests while supporting real applications.

### 5. Define deterministic scope precedence and conflict behavior

`scope_specificity` as a simple count is unsafe. A company override and role-family override can have equal counts but different policy meaning. Sorting equal candidates by recency silently selects an answer even when the plan says equally specific conflicts should be reviewed.

Required resolution:

- Each canonical policy defines an ordered scope-rank vector, not just a count.
- The query returns every compatible answer at the best rank.
- If multiple non-equivalent active answers remain at the best rank, return `NEEDS_USER` rather than use recency as truth.
- Application-local scope never widens automatically.
- Scope qualifiers use normalized IDs for country, employer entity/group, role family, location, and employment type.

### 6. Make policies and normalized values truly versioned

Answer versions record the policy version that governed them, but the proposed policy table overwrites one row per canonical. That makes historic decisions impossible to reproduce.

Required resolution:

- Store policies append-only with `(canonical_key, policy_version)` uniqueness.
- Keep one explicit active-policy pointer/view.
- Preserve the policy version in answer, representation, classification, and authorization receipts.
- Add missing normalized value families before writing migrations: number/decimal, duration, URL, address, multi-enum, entity reference, date range, and file/document reference.
- Store money as an exact decimal or minor-unit integer plus currency and period. Never use JavaScript floating point as the source of truth for CTC conversions.

### 7. Define normalized company, jurisdiction, and role identities

Entity-scoped and legal facts depend on normalized context, but the service that produces that context is not yet defined.

Required resolution:

- Add versioned registries for employer legal entity/parent group, country/jurisdiction, role family, and location.
- Store the normalization source, confidence, and version.
- Use `UNKNOWN` or ask the candidate when entity identity is ambiguous.
- Never reuse a legal/entity-scoped answer from fuzzy company-name similarity alone.

### 8. Make checkpoints a first-class contract

Clicks, blur, DOM readback, and URL changes are not durable acceptance.

Add a versioned `CheckpointReceipt` containing:

- run, tab, frame, document, page/form generation;
- checkpoint type and adapter;
- evidence source and bounded structural fingerprint;
- validation state before/after;
- whether the relevant page/section generation advanced;
- whether a review or success/receipt state was detected;
- confidence/reason code;
- timestamp and protocol version.

Every adapter must return `VERIFIED`, `REJECTED`, or `UNKNOWN`. No verifier may default an unknown state to success.

### 9. Define application-content revision and authorization invalidation

An accuracy certification authorizes a particular revision of the application, not merely a checkbox ID.

Required resolution:

- Compute `applicationContentRevision` from canonical final answer-version IDs, relevant rendered receipts, and attachment/document version IDs.
- Bind a declaration receipt to the exact statement revision and the content revision it depends on.
- If any dependent answer/document changes, the receipt becomes stale.
- If Copilot owns a reversible checkbox and it is safe to do so, uncheck it; otherwise block ready-to-submit state and require review.
- Never toggle a user-owned or employer-prechecked declaration.
- Keep optional marketing/talent-pool choices out of mandatory declaration batches and present consequences neutrally.

### 10. Add a versioned website–extension launch protocol

The previous handshake design is necessary but is not yet integrated into Parts 1–3.

The protocol must support:

- `not installed`, `installed but disconnected`, `connected`, `permission required`, `version incompatible`, and `launch ready` states;
- explicit allow-listed dashboard origins;
- a short-lived nonce/launch token bound to user, job, target URL/origin, tab/run, protocol version, and expiry;
- replay protection and single-use launch authorization;
- strict message-schema validation;
- sender origin, tab, frame, document, and lifecycle validation;
- a clear extension-install and site-permission UX.

Chrome treats content scripts as less trustworthy than the extension service worker, so privileged actions must not be authorized by message type alone.

### 11. Include frame and document lifecycle in logical identity

`frameId` alone is not stable across document navigation, and DOM IDs are not logical field identity.

Minimum identity should include:

```text
runId
+ tabId
+ frameId
+ documentId
+ page/form generation
+ logical group ID
+ logical field fingerprint
+ field instance generation
```

SPA navigation, BFCache/prerender lifecycle, same-origin and cross-origin child frames, iframe recreation, and shadow-root boundaries need explicit outcomes. Closed shadow roots or inaccessible frames should result in a clear assist/handoff state, not a retry loop or an unsupported reliability promise.

### 12. Define durable extension event delivery

Manifest V3 service workers are ephemeral. In-memory queues and flags cannot be authoritative.

Required event envelope:

- event ID and per-run monotonically increasing sequence;
- operation ID and idempotency key;
- payload schema/protocol version;
- candidate/run/tab/frame/document ownership;
- creation/expiry time;
- last acknowledged sequence;
- retry count and terminal/dead-letter reason.

Use `chrome.storage` as the durable local source of truth for pending events, checkpoint state, and launch state. ACK by watermark, compact acknowledged entries, cap the queue, and degrade to safe local operation when offline. Never replay a stale DOM mutation after a rescan; reconcile desired state instead.

### 13. Correct the candidate-private/shared telemetry boundary

The proposed shared representation observation includes raw run/logical-field identity. Even without values, that can link a candidate's application activity across the shared plane.

Required resolution:

- Keep raw run, field, edit, and value hashes only in the tenant-private plane.
- Produce shared observations through a redacting outbox worker.
- Use keyed rotating pseudonyms or aggregate counters for independence checks; do not expose raw user/run IDs.
- Do not store free text, candidate values, resume text, declaration text, URLs containing tokens, access tokens, or DOM snippets in shared telemetry.
- Rate-limit and anomaly-check evidence so malicious clients cannot poison broad strategy promotion.

### 14. Decide encryption, retention, and deletion before adding sensitive columns

The design mentions ciphertext for temporary values and declaration snapshots but does not define keys, rotation, recovery, or retention.

Recommended MVP:

- Do not store keystrokes or intermediate values.
- Keep final normalized value hashes in event timelines.
- Promote the final candidate value transactionally into the private answer store only at the approved commit boundary.
- Store declaration text only if it is required for audit and a real envelope-encryption/key-rotation design exists.
- Otherwise store the statement hash, employer URL/origin, revision, and user-visible label with short retention.
- Define deletion propagation across private events, pending queues, backups, storage objects, and pseudonymized shared aggregates.

Do not create columns named `ciphertext` before the key-management and rotation contract exists.

### 15. Turn illustrative DDL into enforced DDL

The present table sketches need:

- explicit foreign keys and delete behavior;
- `CHECK` constraints for states, policy values, and version ranges;
- tenant/user ownership on every candidate-private row;
- UTC timestamp rules and a single server-authoritative time source;
- partial uniqueness for one active answer/binding;
- optimistic version columns;
- controlled scope columns or validated typed JSON with generated indexes;
- retention classification;
- grants and RLS for select, insert, update, delete, functions, views, and storage objects;
- tests proving one candidate cannot read or mutate another candidate's rows.

Supabase service-role credentials must stay server-side and must never be embedded in the extension.

### 16. Define migration rollout and rollback

Migrations `0007` onward should use an explicit expand/backfill/verify/cutover/cleanup sequence:

1. Add new tables/columns without changing readers.
2. Backfill stable candidate entity IDs and policy versions idempotently.
3. Dual-read only behind a feature flag and compare outputs.
4. Keep old writes authoritative until parity gates pass.
5. Cut one module at a time to the new write path.
6. Retain an emergency kill switch and deterministic downgrade path.
7. Remove legacy interpretation only after replay/backfill verification.

Avoid indefinite dual-write because it creates two sources of truth.

### 17. Freeze measurable acceptance gates

Promotion thresholds such as four or five successful observations are useful test defaults, not production truth.

Before implementation, define metrics and release gates for:

- semantic precision/abstention by field risk;
- wrong candidate-answer fill rate;
- representation rejection and correction rate;
- field ownership violations;
- false checkpoint success;
- stale declaration authorization;
- repeatable binding ambiguity/wrong binding;
- resume/recovery continuity;
- dropped/duplicated event rate;
- p50/p95 bootstrap, delta-resolution, and local fill latency;
- per-application Attention burden and user overwrite rate.

For the first beta, shared representation/strategy promotion should require fixture success plus admin approval. Autonomous widening beyond exact fingerprint/form family should be disabled.

## Important improvements that can follow Phase 0

### Repeatable binding

- Give every profile education/experience/project entity a persistent UUID once. Never derive identity from array index or mutable display text.
- Define `bindingScopeKey` in addition to a controlled binding role so legitimate duplicate usage is explicit.
- Use maximum-weight one-to-one assignment behind a small interface; typical group counts are tiny, so correctness is more important than algorithm micro-optimization.
- Treat the proposed weights and thresholds as fixture-tuned configuration.
- If identical blank groups cannot be reacquired after a rerender, ask once instead of guessing.
- A deleted employer form group removes only the application binding, never the candidate profile entity.

### Representation learning

- Keep transforms pure, deterministic, packaged, versioned, and explainable.
- First release should use only curated rules and candidate-private preferences.
- Shared promotion remains admin-approved and scope-first: exact fingerprint, then form family, then ATS only with independent evidence.
- Never automatically widen one correction across portals.
- Distinguish employer-invalid representation from two employer-valid values where the user simply prefers one.

### Human-observed interaction learning

- Defer automatic recovery proposals until edit attribution, cleanup, checkpointing, and telemetry are stable.
- Do not record raw click/keystroke streams. Convert ephemeral observations into a bounded structural signature, then discard raw values.
- Keep `prepare -> execute -> verify -> cleanup` for every strategy.
- Record direct and rescue performance separately because rescue traffic is a harder, selected population.
- A human succeeding is discovery evidence, not automatic proof that a packaged strategy will succeed.

### Candidate UX

- Add one per-application `Do not learn from this application` control in addition to the global learning preference.
- Persist completion summaries in the extension side panel and dashboard Answer History; do not depend on a snackbar in a tab the user may close.
- Use `REVIEW_TO_SAVE` by default for compensation, work authorization, sponsorship, government affiliation, non-compete restrictions, and suspicious changes.
- Make `Undo all` transactional only while all affected versions are still current. On conflict, offer explicit item-by-item restore and never overwrite newer device/tab changes.
- Show plain explanations: `Used 4 completed years from 56 months`, not strategy names or internal scores.
- Preserve focus, keyboard navigation, IME composition, accessibility announcements, and user ownership.

### Security and operations

- Add feature flags and kill switches per learning layer, extension protocol version, adapter, canonical risk tier, and strategy scope.
- Add admin RBAC and immutable audit records for policy changes, promotions, quarantines, and rollbacks.
- Reject telemetry from unsupported/tampered extension versions.
- Add poison/anomaly detection and rate limits before any shared evidence can affect another user.
- Log classifier reason codes and protocol/checkpoint failures, not candidate values.

## Complexity to remove or defer

Do not build these in the first production slice:

- autonomous cross-user strategy promotion;
- AI inside the live fill loop;
- AI-generated executable interaction plans;
- a general remote action DSL;
- full human-demonstration strategy synthesis;
- Redis, Kafka, Kubernetes, or a cloud browser fleet;
- automatic final submission;
- bandit/off-policy strategy ranking;
- cross-ATS representation widening;
- a simultaneous full TypeScript rewrite.

The current ESM JavaScript codebase can implement the new modules safely with Zod boundary validation, JSDoc/type checking, and generated versioned JSON contracts. Introduce a TypeScript build only as a separate deliberate migration, not while changing the learning model.

## Optimized pre-implementation sequence

### Phase 0A — Contract and policy reconciliation

- Lock the learning commit boundary.
- Lock candidate memory defaults and the per-application opt-out.
- Lock declaration categories and authorization behavior.
- Create one append-only policy registry.
- Update conflicting docs, UI copy, deployment checks, and tests.

Exit gate: one policy answer exists for every field category; no test asserts the obsolete behavior.

### Phase 0B — Shared contracts

Freeze and validate these browser-safe contracts:

1. `FieldSemanticResult`
2. `CanonicalAnswerPolicy` and `ScopeRank`
3. `NormalizedValue`
4. `FieldAnswerContract`
5. `LogicalFieldIdentity`
6. `FieldRevision`, `EditSession`, and `CheckpointReceipt`
7. `ApplicationAuthorizationReceipt` and `ApplicationContentRevision`
8. `ExtensionProtocolEnvelope` and `TelemetryEnvelope`

Exit gate: backend and extension validate the same versioned fixtures and reject unknown/incompatible versions safely.

### Phase 0C — Correction-safety runtime

- Remove `USER_CORRECTED -> mapping success`.
- Add neutral append-only events and operation/edit ownership.
- Implement the first versioned correction classifier.
- Add replay tests for semantic correction, answer correction, representation correction, strategy failure, user preference, user return/edit, abandonment, and unknown.

Exit gate: one candidate edit cannot train any learning layer without a checkpoint and an explicit classifier result.

### Phase 0D — Persistence and transport foundation

- Finalize constrained migrations, RLS/grants, retention labels, outbox, idempotency, ACK watermark, and optimistic versions.
- Add launch protocol, document/frame identity, bootstrap plus delta resolution, and offline queue reconciliation.
- Add kill switches and audit logging.

Exit gate: crash/retry/offline/concurrent-tab tests produce no duplicate mutation, cross-tenant access, stale replay, or false success.

### Then implement product modules

1. Part 2A: policy registry and normalized values.
2. Part 2B: versioned candidate answers, deterministic scope resolver, change sets, and Undo.
3. Part 3A: full edit-session/checkpoint classifier integration.
4. Part 2C: low-risk automatic learning and completion-summary UX.
5. Part 2D: curated representation resolution; shared promotion disabled initially.
6. Parts 2E/3C: stable repeatable binding and incremental form graph.
7. Part 2F: application-specific declaration authorization.
8. Part 3B: durable orchestration/ownership hardening.
9. Part 3D: packaged strategy registry and staged rollout.
10. Part 3E: human-observed recovery after sufficient production evidence.

## Recommended defaults to approve

Unless product/legal review changes them, use these defaults:

1. Reusable learning finalizes only at verified submission or explicit `Done — save these answers`.
2. Low-risk stable facts may auto-version and appear in a reversible summary.
3. Compensation, legal facts, entity-scoped facts, suspicious deltas, and ambiguous scope are `REVIEW_TO_SAVE`.
4. Every application has an easy `Do not learn from this application` control.
5. Eligible ordinary declarations are itemized and authorized once per application batch; high-impact authorization remains per item; optional choices stay separate; final submit remains user-only.
6. Shared representation/strategy promotion is admin-only during beta.
7. No candidate value, raw run ID, free text, resume text, or declaration statement enters shared telemetry.
8. Use packaged JavaScript strategies and current ESM modules; do not combine this work with a language rewrite.
9. Treat inaccessible frames/closed shadow roots and uncertain checkpoints as assisted/manual outcomes, never as silent success.
10. Prefer abstention and a concise inline question over a high-confidence wrong fill.

## Research validation

The recommended corrections align with current platform guidance:

- Chrome Manifest V3 service workers are loaded on demand and can be unloaded when dormant; durable state belongs in `chrome.storage`, not only global variables: <https://developer.chrome.com/docs/extensions/develop/concepts/service-workers> and <https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers>.
- Chrome's runtime sender exposes origin, tab, frame, `documentId`, and document lifecycle, and Chrome explicitly warns that messages from content scripts must be treated as untrusted input: <https://developer.chrome.com/docs/extensions/reference/api/runtime/> and <https://developer.chrome.com/docs/extensions/develop/concepts/messaging>.
- Chrome recommends optional host permissions and runtime permission requests to reduce privilege and make access understandable to users: <https://developer.chrome.com/docs/extensions/reference/api/permissions>.
- Supabase requires both grants and RLS policies for exposed objects and states that service-role credentials bypass RLS and must stay server-side: <https://supabase.com/docs/guides/database/postgres/row-level-security> and <https://supabase.com/docs/guides/database/secure-data>.
- UI Events defines `beforeinput`, `input`, composition, and focus sequences, which supports the edit-session design and shows why an `input` or `blur` event alone is not a commit receipt: <https://www.w3.org/TR/uievents/>.
- India's DPDP Act requires clear, informed, purpose-specific consent and supports withdrawal; application-specific affirmative authorization is safer than treating consent controls as reusable booleans: <https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf>. Production wording and retention still require counsel review.

## Final readiness decision

Parts 1–3 are ready to enter **Phase 0**, not ready for broad implementation as currently written.

Once the Phase 0A–0D exit gates pass, the architecture can proceed without a fundamental redesign. The remaining uncertainty will be normal adapter/fixture tuning rather than foundational ambiguity about what was learned, whose truth it represents, whether the employer accepted it, or whether the candidate authorized it.

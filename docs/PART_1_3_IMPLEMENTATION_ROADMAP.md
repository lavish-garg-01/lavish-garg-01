# Parts 1–3 Step-by-Step Implementation Roadmap

Status: implementation-ready roadmap  
Date: 2026-08-30  
Source documents:

- `docs/part-1-field-semantic-learning-plan.md`
- `docs/PART_2_3_CANDIDATE_ANSWER_AND_INTERACTION_INTELLIGENCE.md`
- `docs/PART_1_3_IMPLEMENTATION_READINESS_AUDIT.md`

Scope: field-semantic intelligence, candidate-answer intelligence, representation, browser interaction, revision/checkpoint attribution, reversible learning, repeatable forms, application authorization, packaged strategies, adaptive evidence, and the future seams for more autonomous capabilities.

Runtime decision: keep Node 24 and the current ESM JavaScript codebase. Use Zod contracts, JSDoc typing, fixtures, and runtime validation. Do not combine this roadmap with a TypeScript rewrite.

Product invariant: Copilot discovers, resolves, fills, verifies, learns, and prepares application actions. The candidate reviews and submits.

Implementation progress (2026-08-31): Phase 0.0 through 0F, Part 1, Part 2A and the Part 2C capture/review slice are complete as a local, single-candidate foundation. Part 2B has page-sized `FieldAnswerContract` resolution, one-transaction safe legacy truth migration, value-redacted staged resolver parity, immutable application learning change sets, exact-scope `REVIEW → TRUSTED` contextual reuse, and conflict-safe append-only Undo/Restore. Low-risk facts commit directly; configured contextual preferences begin in REVIEW and promote only after unchanged verified reuse in the exact same context. Google/Amazon overrides remain independent. Reversal operations restore only still-current items and preserve every newer answer. Migration `0020` stages candidate-private runtime proposals server-side; the extension outbox remains value-free. Only a verified submission or explicit candidate save can finalize a proposal. The extension now renders a compact “Updated for next time” summary with Undo, while the Profile groups held consequential changes into Save/Keep application-only actions. The browser emits value-free edit revisions, durable edit-session snapshots and checkpoint receipts; neutral observations are persisted before classification. Website/extension launch uses a single-use, exact-origin run protocol and a bounded offline outbox. Phase 0F keeps layer-specific evidence in SHADOW. Future Supabase RLS contracts are checked in but do not claim a live multi-user deployment. Part 2B still owns eventual primary cutover; Part 2D representation and interaction production-promotion ledgers remain disabled.

## 1. Roadmap objective

Build one trustworthy closed loop:

```text
field discovered
  -> meaning resolved
  -> candidate truth selected in exact scope
  -> truth represented for this control
  -> packaged strategy executes safely
  -> UI/employer acceptance is verified
  -> user edits are attributed to the correct layer
  -> eligible private learning commits reversibly
  -> sanitized shared evidence improves future operation
```

The roadmap has three maturity levels:

1. **Reliable intelligence** — build now. The system can explain what happened and fails safely.
2. **Self-improving intelligence** — build after the reliable loop passes production gates. The system aggregates evidence, detects volatility, proposes improvements, and degrades failures quickly; administrators still control production promotion.
3. **Autonomous platform** — architect seams now, execute much later. AI-generated strategies, constrained remote delivery, automatic global promotion, distributed streaming, and any higher submission autonomy require separate approval and evidence.

## 2. Global delivery rules

Every phase follows the same delivery pattern:

1. Add or update the versioned contract.
2. Add an expand-only migration when persistence changes.
3. Add repository and service ownership; routes remain thin.
4. Add backend/extension contract fixtures.
5. Run in `OFF` or `SHADOW` mode first.
6. Compare new decisions with current behavior.
7. Enable for owned fixtures and local development.
8. Enable a narrow canary by adapter/risk tier.
9. Promote only after the phase exit gate passes.
10. Retain a kill switch and rollback path.

No phase may:

- introduce a second competing application runtime;
- make browser events directly update a learning ledger;
- store candidate values in the shared plane;
- treat `UNKNOWN` as success or failure;
- execute backend-supplied JavaScript or an open-ended command language;
- submit an application for the candidate;
- widen scope or production rollout from a raw score alone.

### 2.1 One production runtime; form variants are certification fixtures

Parts 1–3 use one production path:

```text
scanner
  -> field meaning
  -> scoped candidate truth
  -> representation
  -> packaged interaction strategy
  -> verifier
  -> neutral timeline/evidence
```

`Form A`, `Form B`, and named live-miss forms are test/certification artifacts. They may prove that an adapter pack, upload selector, repeatable group, conditional reveal, or control strategy is safe. They must not select a separate resolver, candidate-memory path, or fill runtime in production. `formAGate` remains a control-plane promotion check over owned fixtures; employer pages never execute a `FORM_A`/`FORM_B` branch.

Part ownership is therefore fixed:

- Part 1 consumes normalized scanner descriptors and never knows a fixture name.
- Part 2 resolves candidate truth and representation independently of a fixture variant.
- Part 3 operates on logical fields, control fingerprints, form graphs, and packaged strategies.
- Certification fixtures exercise the same production modules; they do not contain alternate product logic.

## 3. Feature-flag hierarchy

Create or extend flags before feature code is enabled:

```text
learning.phase0_classifier
learning.candidate_answers
learning.automatic_memory
learning.representation
learning.repeatable_binding
learning.application_authorization
learning.strategy_evidence
learning.shared_promotion

extension.protocol_v2
extension.durable_queue
extension.incremental_form_graph
extension.packaged_strategy_registry

adaptive_evidence.shadow
adaptive_evidence.degradation
adaptive_evidence.promotion_recommendations
adaptive_evidence.automatic_promotion
```

Defaults:

- all new learning flags `OFF`;
- classifier and adaptive framework begin `SHADOW`;
- degradation can eventually become automatic for low-risk strategies;
- promotion recommendations may be automatic;
- shared production promotion remains administrator-approved during beta;
- `adaptive_evidence.automatic_promotion` remains `OFF` until a later Level 2 decision.

## 4. Phase 0 — Reliability foundation

Broad Parts 2/3 implementation must wait until Phase 0 passes. Phase 0 produces infrastructure and contracts, not user-visible automation.

### Phase 0.0 — Freeze and verify the current baseline

Relative effort: XS  
Dependencies: none

Tasks:

1. Use Node 24 from `.nvmrc` for every command.
2. Record the current runtime, startup, architecture, backend, extension, privacy, and browser-fixture results.
3. Add a single script that runs the Phase 0 acceptance suite under Node 24.
4. Save representative replay fixtures for:
   - correct autofill kept;
   - answer corrected;
   - representation corrected;
   - fill strategy rejected/reverted;
   - user takeover;
   - multi-edit return;
   - page advance;
   - review reached then abandoned;
   - verified submission;
   - service-worker interruption.
5. Keep the new features off.

Expected changes:

- `package.json` acceptance script only if one does not already exist;
- test fixtures and a baseline report;
- no runtime behavior change.

Exit gate:

- Node/SQLite ABI passes.
- Existing suite remains green.
- Every later classifier case has a deterministic replay fixture.

### Phase 0A — Reconcile product policy and documentation

Relative effort: S  
Dependencies: Phase 0.0

Goal: remove opposing definitions of learning and application authorization.

Decisions to encode:

1. A raw `USER_CORRECTED` event is neutral.
2. Local field validity and page advance support runtime recovery only.
3. Review creates a pending learning change set.
4. Verified submission finalizes eligible reusable learning.
5. If no reliable receipt exists, the user gets `Done — save these answers`.
6. Low-risk stable facts may auto-version with summary and Undo.
7. Compensation, legal facts, entity-scoped facts, suspicious deltas, and ambiguous scope are `REVIEW_TO_SAVE`.
8. Add `Do not learn from this application`.
9. Ordinary compatible declarations may use one itemized per-application gesture.
10. High-impact actions remain per-item/direct; optional choices remain separate and neutral.
11. Final submission remains user-only.

Tasks:

1. Add a versioned policy ADR/document describing the above decisions.
2. Update `PROJECT_CONTEXT`, README files, Part 1 plan, deployment checklist, onboarding/reliability copy, Jobs preflight copy, and extension copy.
3. Replace tests that assert per-application reusable-answer approval for every fact.
4. Keep existing protected-control behavior until Phase 2F implements the new authorization path.
5. Mark any future automatic-submission text as out of current scope.

Exit gate:

- No product document or test describes answer correction as semantic evidence.
- No product document promises both “all declarations manual” and “Copilot checks declarations” without the application-authorization distinction.
- One approved policy answer exists for every current canonical category.

### Phase 0B — Freeze eight shared contracts

Relative effort: M  
Dependencies: Phase 0A

Create browser-safe Zod contracts under `src/contracts/` and mirrored/generated JSON-safe validators for the extension:

1. `FieldSemanticResult`
2. `CanonicalAnswerPolicy` and `ScopeRank`
3. `NormalizedValue`
4. `FieldAnswerContract`
5. `LogicalFieldIdentity`
6. `FieldRevision`, `EditSession`, and `CheckpointReceipt`
7. `ApplicationContentRevision` and `ApplicationAuthorizationReceipt`
8. `ExtensionProtocolEnvelope` and `TelemetryEnvelope`

Required normalized values:

```text
STRING
BOOLEAN
INTEGER
DECIMAL
DATE
DATE_RANGE
DURATION
MONEY(amount exact, currency, period)
PHONE(country code, national number)
URL
ADDRESS
ENUM
MULTI_ENUM
ENTITY_REF
FILE_REF
RICH_TEXT
DECLINE_TO_ANSWER
UNKNOWN
```

Protocol rules:

- every contract has `schemaVersion`;
- readers accept only explicitly supported versions;
- unknown versions fail closed with a reason code;
- values and telemetry have size limits;
- protected values cannot pass through shared contracts;
- hashing/canonical serialization is defined once;
- money uses exact decimal strings or minor units, never floating point truth.

Tests:

- backend/extension golden fixtures;
- round-trip normalization and stable-hash tests;
- oversized/unknown-field/version rejection;
- no-value leakage in semantic/shared telemetry schemas;
- property tests for normalized money, duration, dates, phones, and multi-enum.

Exit gate:

- backend and extension accept/reject the same fixture corpus;
- the eight contract owners are registered in `ARCHITECTURE_INDEX`;
- no route defines a competing payload shape inline.

### Phase 0C — Neutral events and correction-safety classifier

Relative effort: M  
Dependencies: Phase 0B

Goal: make `USER_CORRECTED` safe before any new learning is possible.

Primary files:

- `src/adapters/fillOutcomes.js`
- `src/routes/extension.js`
- `src/services/fieldLearningClassifier.js` (new)
- `src/services/fieldRevisionService.js` (new skeleton)
- `extension/content.js`
- `extension/interaction/` primitives introduced incrementally

Tasks:

1. Remove `USER_CORRECTED -> mapping success` from `mappingOutcomeFromFill()`.
2. Capture stable operation ID, logical identity, before-value hash, intended canonical/answer/representation/strategy versions, immediate readback, stable readback, validation, and ownership source.
3. Add append-only neutral raw events.
4. Implement classifier outputs independently:

```text
semanticOutcome
answerOutcome
representationOutcome
strategyOutcome
acceptanceOutcome
```

5. Supported results include `CONFIRMED`, `CORRECTED`, `FAILED`, `REJECTED`, `PREFERENCE`, `AMBIGUOUS`, `ABANDONED`, `UNKNOWN`, and `NO_EVIDENCE` as applicable to each layer.
6. Do not update any ledger while the classifier is in shadow mode.
7. Replay existing raw events and compare classifications in a local/admin diagnostic.
8. Rewrite Part 1 semantic evidence tests so only explicit semantic evidence affects mapping confidence.

Classifier minimum cases:

- same answer, strategy failed then user succeeded;
- different answer, strategy succeeded;
- same normalized truth through another representation;
- both representations employer-valid, therefore user preference;
- intended value never stuck;
- user begins edit, moves away, returns and finishes;
- user restores original value;
- page/dependency script changes the value;
- password manager/ATS prefill;
- edit interrupted by close/navigation/service-worker suspension.

Exit gate:

- no UI event directly rewards/punishes semantics, candidate truth, representation, or strategy;
- every replay produces one explicit five-layer result or neutral `UNKNOWN`;
- new learning flags remain off.

### Phase 0D — Logical identity, launch handshake, and incremental protocol

Relative effort: M  
Dependencies: Phase 0B; may run beside Phase 0C

Goal: make website-to-extension launch and multi-page identity deterministic.

Logical identity:

```text
runId
tabId
frameId
documentId
documentLifecycle
pageGeneration
formGeneration
formGroupId
logicalFieldFingerprint
fieldInstanceGeneration
```

Website-extension states:

```text
NOT_INSTALLED
DISCONNECTED
CONNECTED
PERMISSION_REQUIRED
VERSION_INCOMPATIBLE
READY_TO_LAUNCH
```

Tasks:

1. Add protocol version negotiation and extension availability detection.
2. Add install/connection/permission UX rather than opening the employer page silently.
3. Issue a single-use launch token bound to user, job, target origin/URL, run, protocol version, nonce, and expiry.
4. Validate origin, tab, frame, document, lifecycle, message schema, and token for privileged messages.
5. Add replay protection.
6. Request optional host permission from a user gesture for the exact employer origin.
7. Replace a literal one-request model with:
   - one application bootstrap;
   - local form scan/cache;
   - one batched `resolve-delta` for new/changed logical fields per page/form generation;
   - batched telemetry.
8. Define inaccessible cross-origin iframe/closed-shadow-root outcomes as `ASSIST_REQUIRED`.

Suggested endpoints/messages:

```text
POST /api/extension/runs/bootstrap
POST /api/extension/runs/:runId/resolve-delta
POST /api/extension/runs/:runId/telemetry

JOB_HUNTER_PING
JOB_HUNTER_READY
JOB_HUNTER_LAUNCH_REQUEST
JOB_HUNTER_LAUNCH_ACCEPTED
JOB_HUNTER_PROTOCOL_ERROR
```

Exit gate:

- not-installed and permission-required users receive a useful flow;
- replayed/stale/wrong-origin messages cannot launch or mutate a run;
- new pages/branches resolve without per-field API calls;
- frame/document changes cannot collide with old logical fields.

### Phase 0E — Durable delivery, idempotency, outbox, and security

Relative effort: L  
Dependencies: Phase 0B and 0D

Goal: tolerate worker suspension, offline use, retries, concurrency, and future Supabase migration.

Extension durable envelope:

```text
eventId
runId
sequence
operationId
idempotencyKey
schemaVersion
tab/frame/document ownership
createdAt
expiresAt
retryCount
payload
```

Tasks:

1. Use `chrome.storage` for pending events, last ACK watermark, launch state, resumable checkpoint metadata, and bounded queue status.
2. ACK by per-run sequence watermark; compact acknowledged records.
3. Cap queue size and retry count; store terminal reason codes.
4. On resume, rescan/reconcile desired state; never replay a stale DOM click.
5. Add backend idempotency request storage and transactional outbox.
6. Reject a reused idempotency key with a different request hash.
7. Add optimistic versions to mutable application/run state.
8. Define candidate-private versus shared-redacted event routing.
9. Define retention classes and deletion propagation.
10. Keep service-role/database secrets out of the extension.
11. Add RLS/grants tests for select, insert, update, delete, functions, views, and storage in the future Supabase schema.
12. Add feature-flag, policy-change, promotion, quarantine, and rollback audit events.

Migration strategy:

- continue using append-only numbered migrations;
- never modify an applied migration;
- use expand, idempotent backfill, verify, flagged dual-read, cutover, then cleanup;
- avoid indefinite dual-write.

Exit gate:

- duplicate delivery creates one mutation;
- service-worker stop/restart loses no acknowledged state and replays no stale DOM action;
- offline queue degrades safely;
- concurrent tabs produce version conflicts rather than silent overwrite;
- tenant isolation tests deny cross-user access.

### Phase 0F — Adaptive evidence kernel in shadow mode

Relative effort: M  
Dependencies: Phase 0C classifier and 0E event/outbox foundation

Goal: create one shared evidence-update mechanism without one unsafe global learning rate.

New modules:

```text
src/services/evidenceRouter.js
src/services/adaptiveEvidencePolicy.js
src/services/evidenceAccumulator.js
src/services/volatilityDetector.js
src/services/promotionPolicy.js
src/repositories/evidenceRollupRepository.js
```

Core rule:

```text
classified layer-specific evidence
  -> EvidenceRouter
  -> layer policy
  -> effective evidence weight
  -> lifetime + recent rollups
  -> volatility/change-point result
  -> recommendation/state transition
```

Effective weight inputs:

```text
base weight
source reliability
checkpoint strength
attribution confidence
sample quality
recency
scope similarity
completion strength
risk multiplier
extension/adapter trust
```

Do not use one universal EMA or one scalar learning rate.

Layer profiles:

- semantic mapping: conservative; only semantic evidence;
- candidate answer: version authority, policy, checkpoint, scope, and provenance decide reuse; evidence score is diagnostic;
- representation: medium, exact-scope first;
- interaction strategy: faster degradation, slower promotion;
- form schema: medium with freshness/volatility;
- entity binding: conservative and candidate/application-private;
- legal/application policy: no autonomous learning.

Store both:

```text
lifetime positive/negative effective evidence
recent-window positive/negative effective evidence
effective sample size
independent user/run/form counts where allowed
state
volatility epoch
last decision reasons
```

Asymmetric policy:

```text
fail safe quickly
trust slowly
```

Examples:

- one historical failure after 500 successes: remain trusted;
- clustered recent failures after a DOM fingerprint change: degrade/quarantine rapidly;
- weak page advance: low/zero learning weight;
- verified submission plus precise classification: strong private-answer evidence;
- ambiguous correction: zero until classified;
- legal-policy behavior: zero autonomous update.

Initial state effects:

- framework runs in shadow mode;
- it may recommend degradation/promotion to admin diagnostics;
- it cannot change production strategy selection;
- later, safe automatic degradation may be enabled before promotion.

Exit gate:

- identical evidence replays deterministically;
- per-layer policies never leak evidence between layers;
- recent regressions are detected without erasing lifetime history;
- no score alone promotes candidate truth, consent, or legal behavior;
- shadow recommendations include reason codes and reproducible inputs.

### Phase 0G — Consolidate the extension production path

Implementation status (2026-08-31): complete locally and behavior-locked. Content-script state is owned by scanner, ownership, executor, verifier, telemetry, and orchestrator modules loaded before `content.js`. Background API, session, durable-outbox transport, and message-envelope routing are separate modules loaded before `background.js`. The unpacked-extension launch lock caught and fixed a service-worker initialization-order regression: the eager outbox flush now runs only after transport initialization. The expanded `npm run check:phase0g` gate passes 84 tests with one state-dependent diagnostic skip; the complete `npm test` gate passes 361 tests with the same one skip under Node 24.8.0. The web production build, extension-contract synchronization, architecture index, and import-cycle audit also pass. No legacy answer authority was deleted in this behavior-preserving phase; removal gates are in `docs/LEGACY_RETIREMENT_PLAN.md`.

Relative effort: M  
Dependencies: Phase 0A–0F and the completed Phase 2C local loop

Goal: extract the current extension behavior into strict modules before adding representation or interaction-strategy behavior. This is a behavior-preserving refactor, not a second runtime.

Current evidence: `extension/content.js` and `extension/background.js` contain 5,033 lines combined. Scanner, ownership, execution, verification, telemetry, messaging, session, and transport concerns still have high change coupling.

Target modules:

```text
extension/runtime/scanner.js
extension/runtime/ownership.js
extension/runtime/executor.js
extension/runtime/verifier.js
extension/runtime/telemetry.js
extension/runtime/orchestrator.js

extension/runtime/background/messageRouter.js
extension/runtime/background/sessionStore.js
extension/runtime/background/apiClient.js
extension/runtime/background/outboxTransport.js
```

`extension/content.js` becomes a DOM/bootstrap entry point. `extension/background.js` becomes a service-worker/bootstrap entry point. Existing adapters and `extension/durable-outbox.js` remain the production implementations behind the extracted interfaces until explicitly migrated.

Extraction order:

1. Freeze current behavior with existing Form A/Form B, live-miss, protocol, privacy, and learning-loop tests.
2. Extract pure scanner descriptor construction; it must not choose answers or mutate controls.
3. Put `userEditedFieldIds`, `userActiveFieldIds`, operation ownership, IME state, and cancellation behind one ownership facade.
4. Extract executor and verifier separately; execution cannot declare its own success.
5. Extract value-free telemetry as an observer with no control-flow authority.
6. Reduce the content orchestrator to sequencing and lifecycle coordination.
7. Extract background message routing, candidate-private session state, API calls, and durable outbox transport without changing protocol payloads.
8. Run the same fixture corpus after each extraction; do not combine this phase with new strategies or UI behavior.

Required boundaries:

- scanner reads DOM only;
- ownership can veto/cancel automation but cannot resolve answers;
- executor mutates only while holding current operation ownership;
- verifier returns structured `VERIFIED`, `REJECTED`, or `UNKNOWN` and never fills;
- telemetry observes accepted facts and remains value-free on the durable/shared path;
- orchestrator coordinates but does not reimplement module rules;
- background transport never persists or replays DOM actions.

Exit gate:

- no production `FORM_A`/`FORM_B` runtime branch exists;
- existing adapter/candidate-learning behavior is unchanged across the complete fixture suite;
- trusted candidate input cancels pending automation through one ownership API;
- executor success always requires an independent verifier result;
- content/background entry files delegate the extracted concerns and no second runtime exists;
- architecture/import-cycle/privacy/protocol checks pass under Node 24.

## 5. Level 1 — Reliable intelligence product phases

### Phase 2A — Versioned canonical answer policy and context registry

Implementation status (2026-08-31): complete locally. Migration `0013_candidate_answer_intelligence` is immutable; exact employer aliases, safe migration, parity, change sets, feature gating and scoped Undo/Restore use forward migrations `0014`–`0019`. All active canonicals have a policy, required entity/jurisdiction context fails closed, scope selection is ordered and ambiguity-safe, dependencies invalidate deterministically, and operator/API surfaces are connected. Part 2B still has primary cutover and eventual compatibility removal pending; Part 2C owns extension capture/completion UX and grouped held-answer review. See `docs/part-2a-candidate-answer-policy.md` and `docs/part-2b-field-answer-contract.md`.

Relative effort: M  
Dependencies: Phase 0A–0F

Goal: one explainable policy answer for every canonical.

Migration: begin `0013_candidate_answer_intelligence`.

Tables/configuration:

- append-only `canonical_answer_policies` keyed by canonical and policy version;
- one active-policy pointer/view;
- freshness and anomaly profiles;
- normalized employer legal entities/parent groups;
- country/jurisdiction, location, role-family, and employment-type registries.

Services:

```text
answerPolicyRegistry
contextNormalizationService
scopeRankPolicy
freshnessPolicy
anomalyPolicy
```

Tasks:

1. Seed every current canonical.
2. Replace broad regex behavior only after parity tests.
3. Define ordered scope-rank vectors per policy; do not use a count alone.
4. Return every candidate at the best compatible rank.
5. Equal-rank non-equivalent answers return `NEEDS_USER`.
6. Unknown entity/jurisdiction fails closed.
7. Add deterministic dependency invalidation.

Exit gate:

- every resolver result explains answer kind, allowed scope, freshness, reuse, learning, authorization, and presentation;
- ambiguous scope never silently resolves by recency;
- fuzzy company similarity cannot authorize legal/entity-scoped reuse.

### Phase 2B — Versioned candidate truth, change sets, and Undo

Relative effort: L  
Dependencies: Phase 2A and Phase 0E

Migration: complete the candidate-private portion of `0013_candidate_answer_intelligence`.

Tables:

```text
candidate_answer_versions
candidate_answer_change_sets
candidate_answer_change_set_items
candidate_answer_dependency_events
```

Tasks:

1. Add append-only answer versions with exact normalized value, scope, provenance, policy version, confirmed/valid timestamps, and status.
2. Enforce one active version per candidate/canonical/scope.
3. Use expected-version optimistic concurrency.
4. Implement deterministic resolution: explicit profile, best compatible answer, safe derivation, grounded paid generation, then ask.
5. Migrate only unambiguous safe existing facts.
6. Keep legacy reads behind one compatibility adapter during parity. **Implemented:** value-redacted runtime receipts plus `LEGACY_ONLY -> SHADOW_COMPARE -> CANARY -> VERSIONED_PRIMARY` routing; current default is SHADOW and primary remains release-blocked pending verified browser outcomes.
7. Add immutable learning change sets. **Implemented:** direct candidate observations + strong checkpoints + exact policy/scope/version binding commit answer versions, dependency invalidation, immutable items, idempotency receipt and outbox in one transaction.
8. Implement conflict-safe change-set Undo. **Implemented:** each still-current item restores/forgets independently in one ACID operation; newer versions are skipped and reported.
9. Add explicit historical Restore; never clobber a newer answer. **Implemented:** expected-version checks append a trusted compensating version and preserve immutable history.
10. Add per-application no-learning flag.

Exit gate:

- history is never destroyed;
- cross-tab/device conflicts are explicit;
- scope/freshness/provenance are reproducible;
- Undo affects future Copilot memory only, never an already submitted employer form.

### Phase 3A — Full field revision, edit-session, and checkpoint timeline

Relative effort: L  
Dependencies: Phase 0C–0E and Phase 2B contracts

Migration: `0016_application_interaction_timeline`.

Extension modules:

```text
extension/interaction/ownershipManager.js
extension/interaction/operationRunner.js
extension/interaction/verifier.js
extension/interaction/mutationJournal.js
extension/interaction/checkpointStore.js
extension/interaction/editSessionTracker.js
```

Backend modules:

```text
fieldRevisionService
checkpointService
fieldLearningClassifier
applicationContentRevisionService
```

Tasks:

1. Track sources: Copilot, user, ATS/browser prefill, page/dependency script, unknown.
2. Handle IME composition, paste, browser autofill, focus changes, and framework rerenders.
3. Group transitions into an edit session; intermediate keystrokes never become corrections.
4. Capture local commit separately from application checkpoint.
5. Add `CheckpointReceipt` with `VERIFIED`, `REJECTED`, or `UNKNOWN`.
6. Implement checkpoint strengths: local/page advance and review may preserve runtime evidence or a pending proposal, but only verified `SUBMISSION` or candidate `EXPLICIT_SAVE` may commit reusable candidate truth.
7. Persist bounded resumable metadata; never persist raw keystrokes.
8. Reconcile after service-worker restart or page generation change.
9. Feed only checkpoint-classified outcomes to the evidence router.

Exit gate:

- edit-return-edit, restore-original, partial-close, dependency mutation, reload, and resume produce one correct accepted outcome or neutral `UNKNOWN`;
- no click, blur, URL change, or readback alone becomes durable learning.

### Phase 2C — Manual answer capture and reversible automatic-learning UX

Implementation status (2026-08-31): the capture/review slice is complete locally. Raw candidate values travel only on the existing candidate-private manual-input request and are staged in `candidate_answer_runtime_proposals`; they never enter the value-free durable outbox. Runtime normalization is deterministic and fail-closed. Server-staged proposals remain application-local until a verified `SUBMISSION` or candidate `EXPLICIT_SAVE` checkpoint. Low-risk eligible facts commit through the immutable Part 2B change-set transaction. Consequential values become grouped Profile review items. The side panel stores only a bounded value-free completion summary and exposes conflict-safe Undo. Starting another application clears that transient summary; immutable history remains in Profile. Abandoned or merely reviewed forms do not learn. The local feature flag is enabled as `LOCAL_CANARY` and can still be disabled by the operator. Grouped declaration authorization remains Phase 2F, not candidate-truth learning.

Relative effort: M  
Dependencies: Phase 2A, 2B, and 3A

Goal: make the next application better without repeated remember prompts.

The user-facing loop is now explicit:

```text
Copilot does not know
  -> candidate supplies the final value
  -> candidate owns the field
  -> server stages one candidate-private proposal
  -> verified submission or explicit Save
  -> policy/scope/anomaly checks
  -> append-only answer version or grouped review
  -> "Updated for next time"
  -> conflict-safe Undo
```

Intermediate edits remain timeline evidence. The final user-owned revision is the only proposal candidate. Closing the tab, merely advancing a page, or reaching review cannot make it reusable truth.

Tasks:

1. Known answer/fill failure:
   - keep candidate truth;
   - classify strategy from its own evidence;
   - do not create duplicate answer memory.
2. Known semantic/unknown answer:
   - use candidate input in current application;
   - create pending change according to policy;
   - finalize only at verified submission or explicit Done—save.
3. Enable `AUTO_VERSION` for low-risk stable facts.
4. Enable `REVIEW_TO_SAVE` for consequential/ambiguous changes.
5. Add deterministic anomaly checks for shape, range, dates, option membership, dependency contradiction, large delta, and edit flip-flops.
6. Show persistent summary in side panel and dashboard Answer History:

```text
Updated 3 details for next time   Review   Undo
```

7. Separate final review into:
   - Application answers;
   - Declarations;
   - Saved for next time.
8. Store compact writing-style signals only; do not retain compared narratives for learning.
9. Enable `+1 kept / -2 corrected` only as diagnostic evidence on the final accepted revision in exact scope.

Exit gate:

- unfinished/ambiguous edits never enter reusable memory;
- low-risk facts improve the next form without per-field prompts;
- every learned change is visible, scoped, explainable, and reversible.

### Phase 2D — Representation resolution and learning

Relative effort: L  
Dependencies: Phase 0G, Phase 2B, 3A, and adaptive-evidence shadow

Migration: use the next forward migration after `0020`; do not reuse the already-applied `0014` identifier.

New modules:

```text
representationRegistry
representationResolver
representationPromotionPolicy
representationRepository
```

Tasks:

1. Implement pure packaged transforms for:
   - completed/decimal years and months;
   - annual/monthly/hourly compensation and LPA;
   - exact decimals and currency;
   - date parts and ranges;
   - phone components;
   - addresses;
   - enum/multi-enum option matching;
   - boolean/tri-state/decline options.
2. Discover live control options before representation selection.
3. Match only enabled employer options.
4. Return `NO_SAFE_REPRESENTATION` for ambiguity.
5. Distinguish:
   - rejected representation;
   - candidate preference between valid values;
   - changed candidate truth;
   - interaction failure.
6. Keep candidate representation preferences private.
7. Collect redacted shared evidence through outbox.
8. Keep all shared promotion admin-approved in beta.
9. Add exact-fingerprint, form-family, then ATS scope tiers; never jump tiers.

Tests:

- property tests for transforms;
- Indian CTC/LPA fixtures;
- boundary rounding;
- option localization/disabled options;
- candidate preference versus employer rejection;
- no semantic/candidate-truth mutation from representation evidence.

Exit gate:

- every rendered value is reproducible from normalized truth plus a packaged rule/version;
- corrections reach the representation ledger only when equivalence and rejection are proven.

### Phase 2E + 3C — Stable repeatable entity binding and incremental form graph

Relative effort: XL  
Dependencies: Phase 2B, 2D, and 3A

Migration: `0015_repeatable_entity_binding`.

Tasks:

1. Assign persistent UUIDs to education, experience, project, certification, and other repeatable candidate entities.
2. Backfill UUIDs idempotently; never derive them from array position or mutable text.
3. Model page -> section -> conditional branch -> repeatable group -> logical field.
4. Add controlled `bindingRole` plus `bindingScopeKey`.
5. Reuse compatible persisted bindings first.
6. Apply maximum-weight one-to-one assignment with configurable anchors and confidence margin.
7. Do not let a weak DOM position or label cross the auto-bind threshold.
8. Implement `ensure count = N` one group at a time with mutation settling.
9. Handle hidden reveals, checkbox/radio dependencies, add/remove/reorder, drag, rerender, SPA generation, and employer-prepopulated order.
10. Freeze binding while the candidate edits; re-evaluate at checkpoint.
11. Ask one compact entity-choice question when ambiguous.
12. Deleting an employer group never deletes a candidate profile entity.
13. User-created groups become application-local entity proposals and follow normal learning policy.

Initial adapter acceptance:

- at least two structurally independent form families;
- duplicate employer/title with different dates;
- blank identical groups;
- reordering and deletion;
- hidden conditional experience;
- restart/resume.

Exit gate:

- wrong automatic entity binding is zero in the acceptance corpus;
- ambiguous binding asks rather than guesses;
- bindings survive rerender/reorder/resume without relying on DOM index.

### Phase 2F — Application-specific declarations and authorization

Relative effort: L  
Dependencies: Phase 3A content revision and Phase 2C UX

Migration: `0017_application_authorization_actions`.

Action kinds:

```text
ORDINARY_ACKNOWLEDGEMENT
ACCURACY_CERTIFICATION
APPLICATION_DATA_PROCESSING
OPTIONAL_CHOICE
HIGH_IMPACT_AUTHORIZATION
E_SIGNATURE
SUBMISSION_ACTION
SECURITY_CHALLENGE
```

Tasks:

1. Discover action, exact statement hash/revision, linked document identity, required/optional status, and dependencies.
2. Leave controls untouched until candidate authorization.
3. Group only compatible mandatory low/medium-risk actions.
4. Keep optional marketing/talent-pool choices neutral and separate.
5. Keep background check, arbitration/waiver, biometrics, medical/genetic disclosure, e-signature, and similar high-impact actions direct/per-item.
6. Bind authorization to exact item revisions and `applicationContentRevision`.
7. Include answer-version IDs and resume/document receipt versions in the content revision.
8. Invalidate authorization when a dependency changes.
9. If Copilot owns an eligible reversible control, safely uncheck on invalidation; otherwise block ready state.
10. Never toggle user-owned or ATS-prechecked controls.
11. Uncheck by the candidate means revoked; never repair automatically.
12. If a linked document cannot be accessed/fingerprinted, route high-impact items to direct review.
13. Candidate performs final submission.

Privacy:

- prefer statement hash + bounded label + origin/revision;
- store exact statement only if required, short-lived, candidate-private, and protected by a real key-management design;
- no reusable consent answer.

Exit gate:

- no protected action is checked without a fresh revision-bound receipt;
- no application action enters reusable candidate truth;
- optional choices are never disguised as mandatory progress.

### Phase 3B — Durable orchestration and ownership

Relative effort: L  
Dependencies: Phase 0D/0E, Phase 0G, and Phase 3A

Tasks:

1. Consolidate run/page/form/control state machines.
2. Add ownership leases and cancellation tokens.
3. Candidate trusted interaction immediately marks the field `USER_OWNED` and cancels pending work.
4. Copilot regains control only through `Let Copilot handle this field` or a new logical generation.
5. Every command means `ensure desired state`, not `repeat click`.
6. Add operation journal for cleanup during the live operation; do not replay it after crash.
7. Require `CLEAN` or `RESTORED` before another strategy or human observation is considered comparable.
8. Continue independent fields when one field fails.
9. Add duplicate, stale, reload, multi-tab, navigation, offline, takeover, and resume tests.

Exit gate:

- automation never fights the candidate;
- stale retries and cleanup cannot alter a user-owned/new-generation field;
- one field failure does not stop safe independent progress.

### Phase 3D — Packaged strategy catalog and staged rollout

Relative effort: L  
Dependencies: Phase 3B and representation contract

Migration: first half of `0020_strategy_registry_and_observation`.

Interfaces to freeze now:

```text
StrategySource
StrategyExecutor
StrategyVerifier
StrategyCleanup
PromotionPolicy
```

First implementations:

```text
PackagedStrategySource
ConservativePromotionPolicy
```

Tasks:

1. Refactor existing adapter strategies behind:

```text
prepare -> execute -> verify -> cleanup
```

2. Create a finite extension capability catalog and strict parameter schemas.
3. Backend returns strategy IDs/versions and bounded parameters only.
4. Support zero to three meaningful strategies; never pad with weak backups.
5. Keep direct, rescue, and provisional-direct evidence populations separate.
6. Add pack cache, version compatibility, adapter/risk flags, canary, quarantine, rollback, and kill switch.
7. Unknown strategy/version fails closed.
8. Production interprets no remote code/open-ended DSL.

Exit gate:

- a bulk pack is fetched and field actions run locally;
- dirty cleanup hands off safely;
- strategy selection and rollback are observable and reversible;
- installed extension capabilities bound server selection.

## 6. Level 2 — Self-improving intelligence

### Phase 3E — Human-observed recovery and shared evidence

Relative effort: XL  
Dependencies: every Level 1 phase; especially 3A, 3B, and 3D

Migration: complete `0020_strategy_registry_and_observation`.

Tasks:

1. Observe only after known safe strategies fail and ownership is handed to the candidate.
2. Capture input events ephemerally, respecting IME and protected values.
3. Normalize into bounded value-free structural signatures; discard raw keystrokes/values.
4. Classify demonstration:

```text
INTERACTION_ONLY
ANSWER_CORRECTION
MIXED
PREFILL_OR_UNKNOWN
INELIGIBLE
```

5. Only clean `INTERACTION_ONLY` evidence with equivalent final representation can nominate a packaged backup.
6. Match known packaged strategies deterministically first.
7. If none match, create an incident/proposal for admin research; AI may advise offline but not execute in the live loop.
8. Aggregate direct, rescue, and provisional-direct evidence separately.
9. Redact through outbox and use pseudonymous/aggregate independence counters.
10. Add poison/anomaly detection, rate limits, trusted-extension checks, replay fixtures, admin evidence views, and rollback.
11. Promotion remains administrator-approved.

Exit gate:

- concurrent alternative strategies aggregate into one incident cluster;
- failed/answer-correction demonstrations cannot contaminate shared strategy evidence;
- no candidate value or raw candidate/run identity reaches shared telemetry;
- production behavior changes only through an audited approval/rollout.

### Phase 3F — Adaptive degradation, recommendations, and measured optimization

Relative effort: M–L  
Dependencies: sufficient trustworthy Phase 3E traffic

Tasks:

1. Enable automatic degradation/quarantine for narrowly scoped low-risk strategies when:
   - recent weighted failure crosses a configured bound;
   - a fingerprint/version epoch changes;
   - cleanup safety fails;
   - evidence comes from enough independent compatible runs.
2. Keep automatic production promotion off initially.
3. Generate promotion recommendations with:
   - lifetime and recent evidence;
   - effective sample size;
   - direct evidence requirement;
   - form/ATS/browser diversity;
   - lower-confidence bound;
   - no safety failures;
   - scope-first widening.
4. Promote a rescue strategy to `PROVISIONAL_DIRECT` before it can become primary.
5. Collect direct performance before trusting it as primary.
6. Add conservative ranking only among already-safe strategies.
7. Measure database/outbox/cache contention before adding Redis.

Exit gate:

- clustered regressions fail safe quickly;
- one old failure does not erase strong history;
- a rescue strategy cannot be compared directly with primary traffic until provisional-direct evidence exists;
- every state transition is reproducible and reversible.

## 7. Level 3 — Architect now, execute later

These are not discarded. Preserve interfaces and data needed for them, but do not implement production autonomy in the current roadmap.

### AI-generated interaction strategies

Now:

- `StrategySource` interface;
- sanitized incidents and replay fixtures;
- optional offline AI proposal for administrator research;
- reviewed extension release for new behavior.

Later gate:

- packaged strategy executor, cleanup, verification, replay corpus, and admin release pipeline have proven reliable;
- AI produces proposals/tests, never immediate arbitrary browser execution.

### Autonomous cross-user promotion

Now:

- adaptive evidence, volatility, provisional-direct state, promotion recommendation, audit and rollback data.

Later gate:

- months of trustworthy attributed telemetry;
- narrow low-risk strategy classes;
- formal reliability thresholds and automatic rollback;
- product approval.

### Constrained remote strategy DSL

Now:

- strict packaged strategy interface and finite operations.

Later gate:

- signed packages, capability/version compatibility, allowed operations/targets, domain limits, time/resource limits, replay protection, audit and rollback;
- Chrome Web Store/platform policy review;
- never arbitrary JavaScript.

### Redis/Kafka

Now:

- `EventPublisher`, repository/cache interfaces, Postgres/SQLite outbox implementation.

Later gate:

- measured DB contention, high event volume, multiple independent consumers, replay requirements, or cross-instance coordination that the outbox cannot meet.

### Automatic submission

Now:

- keep `SUBMISSION_ACTION = USER_DIRECT` and final candidate review.

Later gate:

- separate product/legal/security decision;
- exceptionally low consequential correction rate;
- highly reliable declaration/content revision and completion detection;
- explicit candidate authority model.

It may remain out of scope permanently while the product still delivers substantial value.

### TypeScript

Now:

- Zod contracts, JSDoc, strict lint/checking, small modules.

Later:

- migrate module-by-module after contracts stabilize; never block Parts 1–3 on a repository-wide rewrite.

## 8. Database migration map

Phase 0 occupies immutable migrations `0007`–`0012`. Keep the next six feature migrations and strengthen them rather than inventing parallel tables:

```text
0013_candidate_answer_intelligence
  append-only policies, context registries, answer versions,
  change sets, dependencies, active uniqueness, idempotency hooks

0014_representation_intelligence
  packaged rules, candidate preferences, private observations,
  redacted rollups and promotion/quarantine state

0015_repeatable_entity_binding
  candidate entity UUIDs, form groups, binding versions,
  assignment evidence and application-local proposals

0016_application_interaction_timeline
  logical fields, operations, revisions, edit sessions,
  checkpoints, classifier receipts and content revisions

0017_application_authorization_actions
  statement/document revisions, authorization batches/items,
  dependency status, revocation and retention metadata

0020_strategy_registry_and_observation
  packaged strategy metadata, sparse plans, incidents,
  direct/rescue/provisional evidence, adaptive rollups,
  promotion recommendations, quarantine and rollback
```

Every migration requires:

- SQLite fresh-install test;
- SQLite upgrade test from the current schema;
- checksum/immutability test;
- foreign-key and partial-unique checks;
- idempotent backfill test;
- PostgreSQL/Supabase-compatible DDL review;
- candidate ownership/RLS test plan;
- rollback/feature-disable procedure.

## 9. API delivery order

Build APIs only when their owning service/repository exists:

1. Protocol/install detection and secure launch.
2. Run bootstrap.
3. Page/form field delta resolution.
4. Idempotent telemetry batch and ACK watermark.
5. Checkpoint acceptance/classification.
6. Candidate answer selection/history.
7. Pending learning change set and finalize.
8. Learning-summary Undo/restore.
9. Representation plan resolution.
10. Repeatable binding reconciliation.
11. Application authorization prepare/confirm/revoke.
12. Strategy-pack selection.
13. Admin evidence/incident/promotion/quarantine endpoints.

Routes validate identity, schema, entitlement, run ownership, and idempotency, then call services. Routes never contain policy/scoring/learning decisions.

## 10. Test program

### Contract tests

- backend-extension golden payloads;
- schema/version mismatch;
- hash stability;
- protected-value rejection;
- locale/value properties.

### Classifier/replay tests

- semantic, answer, representation, interaction, preference, mixed, abandoned, and unknown;
- multiple edit sessions and return-to-original;
- dependency/page-script mutation;
- ATS/password-manager prefill;
- close/reload/service-worker interruption.

### Transaction tests

- active-answer uniqueness;
- idempotency hash conflict;
- concurrent update;
- change-set commit;
- Undo-all and item restore conflict;
- outbox atomicity;
- authorization revision conflict.

### Extension integration tests

- launch/install/version/permission states;
- main/child frame identity;
- SPA generation and BFCache-like lifecycle;
- ownership takeover;
- duplicate/stale messages;
- offline queue/ACK/restart;
- prepare/execute/verify/cleanup;
- inaccessible frame/manual assist.

### Form fixtures

- native inputs and selects;
- React/ARIA comboboxes;
- date/phone/money multipart controls;
- multi-page Workday-like flow;
- Greenhouse/Ashby-like pages;
- conditional sections;
- repeatable education/experience/project;
- declarations, optional marketing, high-impact authorization;
- employer validation rejection;
- review and submission receipts.

### Security/privacy tests

- cross-tenant denial;
- service-role absence in extension bundles;
- launch-token replay/wrong origin;
- untrusted content-script payload validation;
- no candidate value in shared telemetry/logs;
- retention/deletion propagation;
- rate/poison controls.

## 11. Release milestones

### Milestone A — Safe foundation

Contains: Phase 0.0–0F.  
User-visible change: better install/connection/permission diagnostics; no new automatic learning.  
Release gate: neutral correction handling, secure protocol, durable queue, idempotency, shadow adaptive evidence.

### Milestone B — Private candidate memory beta

Contains: 2A, 2B, 3A, 2C.  
User-visible change: known manual answers improve later applications with summary, history and Undo.  
Release gate: zero learning from unfinished fixtures; deterministic scope/conflicts; conflict-safe Undo.

### Milestone C — Reliable representation and dynamic forms

Contains: 2D, 2E/3C.  
User-visible change: better options, dates, compensation, repeatable education/experience, and conditional sections.  
Release gate: no wrong repeatable binding in corpus; property-tested representation; ambiguity asks.

### Milestone D — Application authorization and durable Copilot

Contains: 2F, 3B, 3D.  
User-visible change: itemized declaration review, resilient ownership/recovery, consistent packaged strategy behavior.  
Release gate: no unauthorized protected control, stale retry, or user-ownership violation.

### Milestone E — Self-improving operations beta

Contains: 3E and safe portions of 3F.  
User-visible change: fewer recurring portal failures over time.  
Release gate: value-free shared evidence, admin-controlled promotion, automatic safe degradation, proven rollback.

## 12. Metrics and promotion gates

Track metrics per adapter, extension version, browser version, field/control family, canonical risk tier, strategy version, and evidence stage.

Required metrics:

- semantic precision and abstention;
- wrong candidate-answer fill rate;
- user overwrite rate by reason;
- representation rejection/correction/preference;
- strategy direct/rescue/provisional success;
- dirty cleanup;
- user-ownership violations;
- false checkpoint success;
- abandoned/unknown rate;
- wrong/ambiguous repeatable binding;
- stale authorization;
- duplicate/dropped event rate;
- resume/recovery success;
- bootstrap/delta/local-fill p50 and p95;
- Attention questions per application;
- Undo and restore-conflict rate.

Initial safety policy:

- zero tolerated ownership violations in fixtures;
- zero unauthorized protected-control changes;
- zero automatic learning from abandoned/unknown fixtures;
- zero cross-tenant access;
- zero raw candidate values in shared telemetry;
- all shared promotion administrator-approved;
- unknown/inaccessible states fail closed.

Production numeric thresholds should be established from owned fixtures and beta traffic, not invented before evidence exists.

## 13. Next executable implementation slice

Phase 0A–0G, Part 1, Part 2A, the implemented Part 2B slices, and the Part 2C local capture/review loop pass locally. The next coding task is **Phase 2D representation resolution and learning**. Legacy candidate-answer authority remains in SHADOW compatibility until Phase 3B adds the verified browser-outcome release gate and SHADOW → CANARY → VERSIONED_PRIMARY passes; see `docs/LEGACY_RETIREMENT_PLAN.md`.

Exact next slice:

1. Expand the field-answer representation contract without changing normalized candidate truth.
2. Add pure packaged transforms for duration, money/CTC, dates, phone, and finite options.
3. Fail closed on unsupported or ambiguous representation and show a concise review reason.
4. Persist representation evidence separately from answer and interaction evidence.
5. Add Indian-locale/property fixtures, then run the full Node 24 suite and Phase 0G behavior locks.

After Phase 2D, proceed to Phase 2E + 3C repeatable binding/form graph, Phase 2F declarations, Phase 3B durable orchestration/browser-outcome gate, and Phase 3D packaged strategy rollout. Legacy deletion begins only after staged primary cutover.

## 14. Definition of complete

Parts 1–3 Level 1 are complete when:

- the system consistently separates field meaning, candidate truth, representation, interaction, and acceptance;
- every candidate edit is classified or remains neutral;
- candidate memory is scoped, versioned, private, explainable, and reversible;
- multi-page/conditional/repeatable forms reconcile safely;
- application declarations are revision-bound and candidate-authorized;
- browser work is idempotent, durable, user-owned when touched, and fail-closed;
- only packaged strategies execute;
- shared evidence contains no candidate answers;
- adaptive evidence can detect regressions without autonomously changing legal/policy behavior or candidate truth;
- final submission remains with the candidate;
- all phase exit gates and release metrics pass.

Level 2 is complete only after shared learning operates with trustworthy attribution, administrator-controlled promotion, safe automatic degradation, and audited rollback.

Level 3 is a separate future product/program, not a prerequisite for launching a valuable Job Hunter Copilot.

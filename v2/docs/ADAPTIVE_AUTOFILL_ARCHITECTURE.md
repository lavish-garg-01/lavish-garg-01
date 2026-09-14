# Adaptive Autofill Implementation Architecture

## 1. Architecture decision

Adopt **deterministic-first autofill with private candidate learning and an administrator-governed improvement pipeline**. Keep V2's TypeScript modular monolith, PostgreSQL/Kysely, extension, existing worker/outbox infrastructure, Candidate Truth authority, safe execution primitives and central AI gateway. Add one review-operations module and a protected admin workspace; do not introduce microservices, a second answer store, a message broker or model fine-tuning as prerequisites.

This is an implementation specification, not a claim that its proposed components already exist. The companion [delivery backlog](/Users/mac/projects/job-hunter-agent/v2/docs/ADAPTIVE_AUTOFILL_BACKLOG.md) defines build slices and acceptance gates. The [adversarial audit](/Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/REPORT.md) remains the evidence baseline.

**Yes: failure evidence and critical human review can improve deterministic output.** The effective unit of improvement is a tested, versioned rule or implementation change—not an unstructured log entry, an administrator's unchecked opinion, or an AI-generated patch deployed automatically. Candidate answer learning must remain independent of the shared-rule review queue.

### Binding decisions

1. Candidate Truth remains the only authority for reusable personal facts. Administrator membership confers no right to manufacture or approve a candidate's salary, authorization, preferences or consent.
2. Count and plan **logical questions**, not individual radio options or incidental HTML controls.
3. Every answer must satisfy a **Question Contract**: meaning, requested representation, scope, entity, freshness, applicability and supported control.
4. Separate semantic validation, representation validity, DOM readback, control commitment and submission confirmation. Do not compress them into one success bit.
5. Ordinary diagnostic events are value-free and schema-allowlisted. Private support evidence is a separate encrypted, consented, short-lived product capability.
6. Known safe answers fill progressively. Unknown questions and admin review do not hold the entire application hostage.
7. Capture manual recovery before its meaning is fully known, but quarantine it privately until eligible for promotion. Never weaken learning safeguards to make counts rise.
8. Shared fixes require reproducible examples, negative cases, independent evaluation and a rollback path. Approval is bound to the exact immutable artifact hash.
9. Initially publish shared rules through reviewed code/data releases. The admin interface cannot upload executable browser code or alter live canonical policies directly.
10. “Review and submit” remains the intended candidate experience. Authentication, novel personal decisions, declarations and genuinely unsupported controls remain explicit boundaries.

## 2. Evidence and research basis

The existing audit passed 361 tests and controlled browser suites while reproducing ordinary representation, logical-grouping, verification and checkpoint-recovery failures. Historical records contained 27 unsupported work-mode/hearing-source operations and only two finalized learning checkpoints. Those observations motivate the implementation priorities; they are not a representative accuracy estimate.

The repository already contains `canonical_review_queue`, an authenticated candidate proposal-list route, an operator-only strategy CLI, typed strategy lifecycle operations, `outbox_events`, `worker_jobs`, `idempotency_records` and `audit_events`. The candidate proposal route explicitly advertises `REVIEWED_CODE_RELEASE_ONLY`. Extend these boundaries rather than bypassing them. [Existing queue](/Users/mac/projects/job-hunter-agent/v2/packages/database/src/canonical-review-repository.ts), [proposal route](/Users/mac/projects/job-hunter-agent/v2/apps/api/src/field-intelligence-routes.ts), [operator CLI](/Users/mac/projects/job-hunter-agent/v2/scripts/strategy-admin.ts), [foundation schema](/Users/mac/projects/job-hunter-agent/v2/database/migrations/0001_initial_v2_schema.sql).

The external research supports the following constraints:

- W3C treats related controls as groups and defines a combobox through its relationship to an associated popup. This supports question/member-control identity and explicit popup containment, not document-wide option searching. Real websites can violate these conventions, so standards are evidence rather than a universal DOM guarantee. [W3C grouping](https://www.w3.org/WAI/tutorials/forms/grouping/), [W3C combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).[^1][^2]
- OpenTelemetry and OWASP emphasize intentional collection, minimization, protected access and sensitive-data handling. A regex that bans metadata keys named “email” does not prevent an email appearing under a different key. Hashing predictable identifiers also does not automatically anonymize them. [OpenTelemetry sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/), [OWASP logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).[^3][^4]
- A transactional outbox addresses committed-state/event dual writes, but delivery can repeat. Stable request identity, idempotent consumers and recoverable receipts remain necessary. The outbox cannot repair two separate truth/checkpoint commits after the fact. [AWS outbox guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html), [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests).[^5][^6]
- Admin access must be denied by default and checked on every request. PostgreSQL table owners and `BYPASSRLS` roles can bypass row policies; simply enabling RLS is not proof that application connections enforce tenant isolation. [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [PostgreSQL row security](https://www.postgresql.org/docs/18/ddl-rowsecurity.html).[^7][^8]
- Chrome Manifest V3 requires packaged executable code. Keep remotely supplied material to validated data and selection of existing packaged capabilities; do not create a remote-code interpreter disguised as JSON configuration. Store approval still requires assessing the actual extension implementation. [Chrome remote-code guidance](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code).[^9]
- Metrics and a dependable pipeline should precede more sophisticated learning. Conversely, deterministic-first must not grow into an unmaintainable forest of overlapping heuristics: learned semantic retrieval is appropriate once there is an evaluated corpus. [Google Rules of ML](https://developers.google.com/machine-learning/guides/rules-of-ml).[^10]
- Canary decisions require representative traffic and attributable metrics; a handful of successful applications is insufficient. Tests should check observable outcomes in isolated environments. [Google SRE canarying](https://sre.google/workbook/canarying-releases/), [Playwright best practices](https://playwright.dev/docs/best-practices).[^11][^12]
- Model confidence is not automatically calibrated correctness. Calibration research motivates held-out reliability measurement, not blindly applying a particular neural-network calibration technique to this rule/LLM pipeline. [Guo et al., 2017](https://proceedings.mlr.press/v70/guo17a.html).[^13]
- Employer page text, failure packages and proposed rules are untrusted input. Keep analysis separate from tool authority; approval and output checks remain necessary even when AI assists a reviewer. [OWASP prompt-injection guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).[^14]

The architecture and thresholds below are engineering decisions for this product, not prescriptions from those sources or a claim of legal compliance. Research references were checked across 12–13 September 2026. Mutable platform guidance must be rechecked before distribution.

## 3. Components and ownership

### Candidate runtime

The extension owns live page discovery, permitted frame/root traversal, logical grouping, user ownership, field focus, packaged execution and observed control state. It holds live labels and control values only where necessary for the active task. The API owns candidate authentication, durable truth resolution, policy, versioned planning and learning commits. The existing P gateway remains the sole provider boundary.

The runtime sequence is:

`journey → logical question → contract → meaning/entity → eligible truth → representation proof → guarded action → observable verification → candidate progress`

Each failed step emits its own bounded outcome. Later steps do not relabel an upstream failure as an execution failure.

### Private candidate learning

`candidate edit → private inbox → attribution/normalization → explicit save or eligible checkpoint → atomic truth change + receipt → future compatible reuse`

This path can complete without admin involvement for known concepts. Unknown concepts remain available to the candidate in a review inbox while a separate structural issue may be considered for shared improvement.

### Review and release workflow

`bounded diagnostic → deduplicated case → sanitized reproduction → proposed change → reviewer decision → independent evaluation → release → observed outcome / rollback`

Implement `packages/review-operations` as the only new package. It owns case transitions, approval invariants and release eligibility, not browser actions or Candidate Truth writes. Repositories stay in `packages/database`; API routes stay in `apps/api`; admin pages live under `apps/web/src/admin`. The operator CLI calls the same services as the admin endpoints.

### Deployment decision

Use the current API/web/worker deployment shape and pinned Node 24.8.0 launchers. Keep candidate and operator authorization namespaces separate even if hosted in one API process. Use a separate admin layout and route boundary; do not add operator controls to the extension or activate Copilot on admin pages.

PostgreSQL is sufficient for the initial issue store, worker leasing and analytics. Reuse the existing outbox/job machinery with typed jobs and unique deduplication keys. Add an external event system only after measured database pressure justifies it.

## 4. Question Contract and runtime protocol

### Logical identity

A logical question has one `questionRuntimeId` and one or more `memberControlIds`. Runtime identity is scoped to application run, page instance, frame/root and form instance. It is not a global canonical ID and not a DOM array index.

Group native radios using form/root ownership plus a nonempty shared name and supporting group/label evidence. Group ARIA radio sets through an explicit radiogroup. Treat checkbox sets as one multiselect question only when shared-question evidence supports it; acknowledgements remain individually policy-controlled. Do not merge unrelated checkboxes merely because they are nearby.

Retain the distinction between an answer option and a repeated entity row. Preserve hidden-host and frame visibility through the composed ancestor chain. Mark unsupported closed roots, inaccessible frames and scan truncation explicitly. Never count an unscanned remainder as a completed form.

### Proposed shared contract

Add strict, versioned schemas in `packages/contracts/src/question-contract.ts`. All strings have explicit bounds; enums reject unknown members. Values below are design names to implement, not existing exports.

```ts
type QuestionContractV1 = {
  version: 1;
  questionRuntimeId: string;
  pageInstanceId: string;
  frameRef: string;
  rootRef: string;
  formInstanceId: string;
  memberControlIds: string[];
  descriptorVersion: number;
  canonical: { key: string | null; registryVersion: string; decision: "KNOWN" | "AMBIGUOUS" | "UNKNOWN" };
  answerShape: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SINGLE_OPTION" | "MULTI_OPTION" | "FILE";
  requested: {
    currency: string | null;
    monetaryPeriod: "MONTH" | "YEAR" | null;
    monetaryScale: "BASE" | "LAKH" | null;
    durationUnit: "DAYS" | "MONTHS" | "YEARS" | null;
    precision: "EXACT" | "COMPLETED_YEARS" | "OPTION_RANGE" | null;
    temporalAnchor: "KNOWN_DATE" | "OFFER_ACCEPTANCE" | "UNKNOWN" | null;
  };
  entityBindingRef: string | null;
  contextRef: string;
  applicability: "APPLIES" | "INAPPLICABLE" | "UNKNOWN";
  requiredByPage: boolean;
  capabilityIds: string[];
  ownership: "UNTOUCHED" | "COPILOT" | "ATS" | "CANDIDATE" | "UNKNOWN";
  evidenceRefs: string[];
};
```

Full evidence references are candidate-private. Operational telemetry receives an allowlisted projection, not this object. `requested` is a discriminated validation structure in the actual schema: a DATE question cannot silently retain monetary units, and contradictory evidence produces `CONTRACT_AMBIGUOUS`. Constraints on option ranges, numeric min/max/step, maximum length, upload format/size and date format belong in typed extensions to this contract, not arbitrary metadata.

The runtime also carries `sourceConfidence`, `method` and `evidenceQuality` separately for semantic identification, entity binding and representation assumptions. A high semantic score does not waive a missing-unit or scope requirement.

### Ready-first protocol

Introduce proposed `/v1/autofill/resolve` with `mode: "READY_ONLY"`. Return deterministic results, unresolved question IDs and a snapshot token immediately after bounded local/DB work; enqueue unresolved enrichment separately. A follow-up `/v1/autofill/enrichment/:id` returns `PENDING`, `READY`, `REJECTED` or `EXPIRED`. Start with polling from the existing background request layer; do not require SSE or a permanent service worker connection for correctness.

Use one snapshot across resolution and planning. It binds question contracts, graph revision, truth versions, entity bindings, policy and rule-release version. AI-enriched results create a new version; they never mutate an issued plan in place. Stale results cannot overwrite candidate-owned fields. Invalidate only affected questions after a change.

The plan API returns one disposition for every logical question, including `PLANNED`, `ALREADY_POPULATED_REVIEW`, `CANDIDATE_OWNED`, `NEEDS_ANSWER`, `NEEDS_CONFIRMATION`, `CONTRACT_AMBIGUOUS`, `INAPPLICABLE`, `POLICY_MANUAL`, `ENTITY_AMBIGUOUS`, `UNSUPPORTED_CONTROL`, `DEPENDENCY_BLOCKED`, `DEFERRED_BATCH` and `STALE_SNAPSHOT`. A dependency disposition includes actual prerequisite IDs. File-upload outcomes remain separate from simple text completion.

## 5. Deterministic representation and truth rules

Create a shared representation specification within `packages/execution`, with parsing/normalization helpers in a dependency-safe shared module consumed by execution and verified learning. Do not let the browser and server invent competing capability vocabularies. Both must use the same versioned capability definitions.

Each representation result contains `converterId`, `converterVersion`, `sourceAnswerVersionId`, `questionContractHash`, `assumptions`, `inverseValidation` and a private rendered value. The private value must never appear in the outcome log. Converters are packaged implementations, not admin-supplied expressions.

### Launch rules

- **CTC:** a canonical amount of INR 1,400,000/year renders as `1400000` when the contract is base annual INR, and `14` only when lakh scaling is explicit. Free text can use “INR 14,00,000 per year” where the contract allows descriptive text. Do not infer lakh scale from the letters CTC alone.
- **Monthly compensation:** INR 1,200,000/year becomes INR 100,000/month only through explicit same-currency period conversion. Use exact decimal arithmetic; reject precision that the target cannot represent. Do not infer exchange rates.
- **Experience:** 44 months becomes “3 years 8 months” in descriptive text; an explicitly numeric year field follows its accepted precision; completed years uses floor. Relevant experience requires a relevant-experience fact or derivation, not total tenure renamed. Option ranges must be parsed with inclusive/exclusive bounds; overlapping boundaries require a known rule or review.
- **Availability:** preserve notice duration separately from available start date. A verified 45-day notice can produce “45 days after offer acceptance” only when that anchor is appropriate. A date picker requires an actual known/confirmed anchor. Never add 45 to today's date simply because it is convenient.
- **Conditional last working day:** a non-immediate joining plan can make the question semantically inapplicable. If the employer still marks it required, display “Employer requires a response” and offer a candidate-reviewed N/A response where text is permitted; do not claim the requirement is satisfied by hiding it internally.
- **Boolean/enum in text controls:** use packaged text converters, with qualified phrases where appropriate. “Yes” must derive from an eligible candidate answer, not from an admin mapping of the question.
- **Phone:** use numbering-plan-aware parsing and preserve country code/national number. A valid combined string is insufficient proof that its stored structured parts are valid.
- **URL:** normalize a missing scheme only through a documented safe URL rule; preserve the actual destination and reject unsupported schemes.

Conversion must either preserve meaning under an explicit inverse contract or return `NEEDS_CONFIRMATION`. A regex that recognizes a word is not enough to supply an omitted unit.

### Global defaults and freshness

Select the most specific compatible answer, then a compatible global default. Preserve the requested global-first onboarding experience, but make compatibility explicit: country, city, work arrangement, role family, employer, temporal anchor and conditional commitments are not discarded.

When a candidate first verifies a fact from profile/resume/manual entry, offer it as their default subject to the field's policy. New contradictory evidence creates a proposed update, not a silent overwrite. Candidate edits to profile defaults take precedence. Repeated identical entries may strengthen eligible evidence but cannot erase contradictory qualifiers.

Compute experience from verified dated history with overlap handling and an as-of date. Re-evaluate derived facts when source versions or time boundaries change. Keep explicit freshness policies for compensation, notice and location. A general remote/hybrid preference does not establish acceptance of a specific relocation package.

## 6. Verification, ownership and honest progress

Persist independent outcome dimensions:

1. `meaningStatus`: `VALIDATED | AMBIGUOUS | NOT_CHECKED`.
2. `truthStatus`: `ELIGIBLE | MISSING | STALE | CONFLICT | CONTEXT_MISSING`.
3. `representationStatus`: `VALIDATED | INVALID | ASSUMPTION_REQUIRES_REVIEW`.
4. `interactionStatus`: `NOT_ATTEMPTED | WRITTEN | FAILED | ABORTED`.
5. `readbackStatus`: `MATCHED | MISMATCHED | UNOBSERVABLE`.
6. `commitmentStatus`: `CONTROL_CONFIRMED | DOM_ONLY | REJECTED | UNOBSERVABLE`.
7. `submissionStatus`: maintained at application level, never inferred from field success.

“Control confirmed” means evidence specific to that supported widget—such as committed selection state and stable value after a relevant render/blur. It does **not** mean the employer backend accepted the application. Do not introspect private framework internals as a universal shortcut. When commitment is not observable, say so and require review.

Use associated popup identity, root-aware targets and bounded stability checks. Never search all document options merely because `aria-controls` is absent. A reviewed structural association may support nonconforming sites; otherwise stop at `POPUP_ASSOCIATION_UNPROVEN`.

Candidate interaction transfers ownership immediately. Candidate-owned fields are not overwritten by retries, late AI, rule updates or ATS-resume parsing. Store ATS/Copilot/candidate origin separately. Progress counts logical questions and separates filled, already present, needs review, inapplicable and blocked. “Ready to submit” requires all applicable required questions resolved and no known site validation blockers; acknowledgement and final submission remain candidate actions.

## 7. Two learning paths

### Fast private path

The existing `candidate_learning_observations` requires canonical, scope and proposal IDs, so it is unsuitable as the first capture point for genuinely unknown questions. Add `candidate_learning_inbox` rather than relaxing all of those existing integrity constraints.

Capture a bounded encrypted observation after a committed candidate edit or explicit save, not every keystroke. The inbox permits unresolved canonical/scope/entity references and stores raw typed input only in a candidate-private encrypted payload. It preserves label/context evidence necessary to revisit the interpretation.

States are `CAPTURED → NEEDS_MAPPING | NEEDS_CONTEXT | NEEDS_CONFIRMATION | ELIGIBLE → PROMOTED`, with `REJECTED`, `EXPIRED` and `DELETED` terminal alternatives. Mapping a question does not itself approve the personal answer. Eligible items are converted into the existing typed observation pipeline and committed through Candidate Truth. A unique `promotedObservationId` prevents double promotion.

Attribution distinguishes personal-fact correction, representation correction, entity correction and manual widget recovery. The same interaction can create separate typed evidence in more than one stream, but only a validated personal-fact change mutates truth. Abandoning a form does not erase an explicit profile save. Submission supports eligible learning but never implicitly approves consent or every contextual answer.

### Shared improvement path

Failure events create structural cases without personal answer values. If richer evidence is necessary, the candidate can preview and share a narrow diagnostic package. Shared-learning eligibility follows an explicit contribution setting; essential operational diagnostics must not silently authorize cross-candidate training or publication.

An admin triages the responsible layer, creates a synthetic reproduction and proposes one of:

- reviewed alias for an existing concept;
- new canonical concept with type/scope/freshness/sensitivity requirements;
- representation rule selecting a packaged converter;
- logical grouping/capability implementation fix;
- supported widget recipe or correction to a bundled strategy;
- applicability policy clarification;
- document/extraction evaluation case;
- no change, candidate-context request, duplicate or unsupported boundary.

The first four categories cannot be collapsed into “add an alias.” A text/option execution mismatch does not justify changing semantic confidence. A wrong salary scale does not justify changing the candidate's salary.

## 8. Failure evidence contract and retention

### Three evidence tiers

**Tier A — operational outcomes:** strict enums, bounded counts/timings, component versions, correlation IDs, safe capability/converter IDs, origin category, failure stage/reason and graph-change category. No answer values, free-text labels, option labels, page HTML, screenshots, URL queries/fragments, cookies, credentials, résumé content or prompt/response bodies. Pseudonymous IDs remain access-controlled data, not anonymous public data.

**Tier B — private diagnostic package:** candidate-selected encrypted question text, minimized nearby structure, relevant typed value only if explicitly included, and local event timeline. Default excludes screenshots, full DOM, network bodies and full résumés. Show the exact preview before sharing. Access requires a case-bound, purpose-bound, expiring support grant and is audited. Packages are never automatically sent to an AI provider.

**Tier C — reviewed regression fixture:** synthetic values and sanitized structure with expected outcomes. A privacy reviewer confirms it no longer carries candidate data or identifying page artifacts before it is included in shared evaluation or a repository. Retain source-case lineage privately without exposing the candidate in the fixture.

### Proposed operational event

```json
{
  "schemaVersion": 1,
  "eventId": "uuid",
  "runRef": "opaque-server-bound-reference",
  "questionRef": "run-scoped-reference",
  "operationRef": null,
  "stage": "REPRESENTATION",
  "reason": "REPRESENTATION_CONTROL_MISMATCH",
  "capability": "NATIVE_TEXTAREA",
  "sourceKind": "ENUM",
  "converterId": "ENUM_EXACT_OPTION@1",
  "contractVersion": 1,
  "ruleReleaseId": "release-id",
  "extensionVersion": "version",
  "apiBuildId": "build-id",
  "durationMs": 12,
  "userModified": false,
  "evidenceTier": "OPERATIONAL"
}
```

This example is a contract illustration with placeholders, not captured production data. The server derives account/candidate identity from authentication; it does not trust body-supplied tenancy. Validate that run, question, operation and issued snapshot belong together. Bound payload size, allowed identifiers, clock skew and event rate. Treat client receipts as reported evidence, not cryptographic proof that an employer committed a value.

Emit an outcome for unplanned questions too. Preserve the stage where a failure first arose. Server recomputation validates deterministic eligibility where possible. Use `eventId` for deduplication and aggregate by unique question/run, not API retries. A dropped-diagnostics counter reveals collection gaps without failing ordinary autofill.

### Sampling and defaults

Record value-free safety violations and failure counts exhaustively within documented rate limits; deduplicate repeats and retain overflow counters. Keep per-run aggregate counts for denominator integrity. Sample successful structural diagnostics by a stable cohort, recording selection probability; do not estimate success rates from failures alone. Inspect a small success sample for silent errors.

Proposed initial retention: operational raw events 30 days; rollups 90 days; private diagnostic packages 7 days after upload unless the candidate explicitly renews; support grants 30 minutes; unconfirmed inbox items 30 days with expiry visible to the candidate; admin release decisions 365 days with no private payload. Approved synthetic tests follow repository retention. These are configurable product defaults, not statutory retention claims. Existing confirmed truth/Undo retention is governed separately; do not purge active provenance accidentally.

Deletion removes payload access immediately, revokes grants and prevents future training/export. Backup expiry and audit metadata retention must be disclosed accurately; do not promise instant erasure from every backup. No provider fine-tuning on private packages is part of this design.

## 9. Admin workspace and critical reviews

### Identity and permissions

Add platform operator roles bound to verified identity issuer/subject. A candidate account owner is not automatically a platform admin. Do not grant admin because an email matches a frontend constant. Use explicit operator provisioning, server-side permission checks, production MFA/step-up verification and revocation.

- `TRIAGER`: read sanitized cases, assign/merge, request candidate evidence and prepare reproduction tasks.
- `RULE_REVIEWER`: review semantic/representation/grouping proposals and label regression cases.
- `PRIVACY_REVIEWER`: inspect proposed shared fixture sanitization; cannot grant themselves candidate access.
- `RELEASE_MANAGER`: promote an approved, evaluated immutable release, disable it and roll back.
- `SUPPORT_READER`: access only the exact private package covered by a live candidate grant; no general profile browsing.

Roles can overlap operationally, but production high-risk changes require an independent approver distinct from the author. A single developer can test locally with a clearly labeled development-only operator mode. That mode must be rejected by production configuration, cannot use the static candidate development token as an admin credential, and cannot waive production review requirements.

No admin endpoint writes candidate facts or accepts application declarations. If a support review suggests a personal-data correction, return it to the candidate as an explicit proposed edit.

### Screens

1. **Failure inbox:** grouped cases, responsible layer, severity, unique affected runs, eligible opportunities, recurrence by version and evidence quality. Filters include ATS family, capability, release and regression status. Show zero-attempt failures, not only failed strategy attempts.
2. **Case workspace:** expected versus observed behavior; timeline from discovery through learning; stage ownership; privacy status; evidence references; candidate-context status; reproducibility; linked duplicates. Default view contains no personal values.
3. **Reproduction/evaluation:** sanitized fixture preview, expected result entered by a reviewer, failing current behavior, proposed change diff, positive/negative cases and held-out results. Imported content is rendered inert; no remote scripts or employer-page HTML execution.
4. **Rule/catalog review:** candidate aliases, required qualifiers, converter/strategy compatibility, exclusions, conflict checks, canonical policy impact and exact artifact hash.
5. **Release monitor:** versions, approvals, offline evaluation, cohort, safety counters, precision/coverage limits, latency and rollback/disable actions. Display “insufficient evidence” when appropriate rather than a green badge from tiny samples.
6. **Access/audit:** candidate grants, expiry, accesses, denials, exports, reviewer decisions and revocations. All sensitive read attempts are audited, not only writes.

Keep the candidate workspace's V1-inspired layout separate. Candidate attention says “Save this answer,” “Confirm the format,” or “Report a problem,” not “Wait for admin approval” for ordinary known facts.

### Case state machine

`OPEN → TRIAGED → NEEDS_EVIDENCE | REPRODUCED → CHANGE_PROPOSED → IN_REVIEW → APPROVED → VALIDATED → RELEASE_PENDING → MONITORING → RESOLVED`

Alternative terminal states: `DUPLICATE`, `NO_CHANGE`, `UNSUPPORTED`, `REJECTED`. A resolved case can reopen on a new release regression. `APPROVED` is a human decision; `VALIDATED` requires CI-produced evidence; neither implies deployment. State transitions use expected revision and idempotency key. Every transition records actor, reason, artifact hash and previous/new revision.

Review priority is severity first, then unique affected runs and reproducibility, then age. A single potential consent/ownership/cross-tenant incident outranks frequent cosmetic failures. Repeated events from one test account cannot raise cross-user confidence. Missing reproduction is explicit; admins can accept “cannot determine,” not invent ground truth.

### Reviews that must be critical

Require independent human review and executable tests for new canonical types, scope/freshness changes, monetary/time conversion, sensitive/declaration classification, cross-root or new widget strategies and any privacy boundary change. Ordinary duplicate triage does not need two people. Emergency disable is allowed to a release manager and immediately audited; it cannot simultaneously publish an untested replacement.

## 10. Turning reviewed evidence into deterministic behavior

### Rule classes and release artifacts

Use four initial change classes: `SEMANTIC_ALIAS`, `REPRESENTATION_SELECTION`, `APPLICABILITY_RULE` and `IMPLEMENTATION_FIX`. Existing Q strategies retain their own lifecycle and safe execution constraints. A grouping or popup bug usually needs a code fix; do not force it into a data rule.

A rule proposal contains: stable rule ID; version; owner; scope; positive matcher predicates; negative exclusions; expected canonical/contract result; required evidence; selected packaged converter/strategy IDs; privacy/risk tier; positive and negative fixture IDs; corpus version; evaluator version; proposed rollback target; and content hash. No JavaScript, arbitrary expressions, executable templates, network destinations or unbounded regex input is accepted through the admin UI.

Initial matchers use a small bounded vocabulary: normalized exact phrase, canonical ID, control capability, supported unit token, country/context qualifier and finite option-shape predicates. New parsing algorithms go through ordinary code review. If rule count or overlap becomes difficult to maintain, evaluate learned retrieval/classification; do not keep layering exceptions indefinitely.

### Conflict and precedence policy

Safety and ownership exclusions win. Then apply explicit site/form-specific contract rules with validated scope, followed by ATS-family rules, then generic rules. Equal-precedence conflicting matches return `RULE_CONFLICT`; they do not use the newest rule or highest self-reported AI score. An alias never overrides a contradictory output contract. Pin the chosen release to the active plan; a release update invalidates future planning, not a candidate's existing field contents.

### Example: the CTC failure

1. Operational event reports a money scale/round-trip problem without the amount.
2. Reviewer reproduces the case with synthetic INR 1,400,000/year and both “CTC” and “CTC in LPA” labels.
3. Proposed fix removes “CTC implies lakhs”; explicit unit evidence chooses the converter.
4. Negative fixtures cover monthly salary, different currency, ranges and missing unit context.
5. CI verifies numeric equivalence and browser text behavior. Admin approves the exact evaluated change.
6. A code/data release ships it. Existing ambiguous candidate records are flagged for confirmation; they are not bulk multiplied by 100,000.
7. Monitor corrected coverage, silent-format errors and abstentions; retain rollback to the previous compatible release.

### Example: a new question

“Organization with which you are presently engaged” should first be considered an alias for current employer, not a new canonical field. “Have you previously worked for this organization?” is a negative example because it asks a company-scoped historical fact. A truly novel concept requires type, scope, freshness, sensitivity, representation and migration decisions before activation.

AI may suggest a root cause, cluster description, candidate alias or draft tests using approved sanitized evidence. It cannot approve its own output, alter expected labels on the locked holdout, publish a release or read private candidate context merely because it is helping an admin.

## 11. Persistence and API specification

All additions below are proposed. Assign migration sequence numbers only when implementing against the then-current migration head. Maintain explicit account/candidate filtering and composite foreign keys for private rows; use least-privilege runtime database roles and test RLS with the actual application role.

### Existing storage to reuse

Reuse Candidate Truth/version/change-set tables, execution evidence, application events, learning observations/checkpoint receipts, canonical catalog/policies, Q strategy versions, `idempotency_records`, `outbox_events`, `worker_jobs`, `feature_flags` and `audit_events`. Do not introduce a second broker/outbox or a second reusable personal-answer table.

### New relational records

- `platform_operator_roles`: `issuer`, `subject`, `role`, `status`, `granted_by`, `created_at`, `revoked_at`; unique active identity/role; provisioning cannot be called by candidate bootstrap.
- `candidate_learning_inbox`: `id`, `account_id`, `candidate_id`, `run_id`, `question_ref`, `payload_ciphertext`, `key_version`, `state`, nullable `canonical_id`, nullable `entity_id`, `context_reference`, `promoted_observation_id`, `idempotency_key`, `request_hash`, `created_at`, `expires_at`; unique candidate/idempotency; composite private ownership constraints; no state can claim promotion without its linked typed observation.
- `autofill_outcome_events`: `id`, private tenancy/run references, `question_ref`, nullable `operation_id`, `stage`, `reason`, version IDs, typed bounded `structural_metadata`, `occurred_at`, `received_at`; unique candidate/event ID; indexes on release/stage/reason/time and run/question. No generic free-text payload column.
- `review_cases`: `id`, approved structural `cluster_key`, `layer`, `severity`, `state`, `revision`, `assignee_subject`, safe summary code, count references, `first_seen_at`, `last_seen_at`, nullable `duplicate_of`; unique open-cluster policy, no candidate payload. Private contributor mappings stay outside the global case row.
- `private_diagnostic_packages`: `id`, account/candidate owner, case reference, encrypted payload/object reference, key version, preview digest, purpose, contribution permission, `created_at`, `expires_at`, `deleted_at`. Storage accepts bounded content only; no arbitrary externally supplied fetch URL.
- `support_access_grants`: `id`, candidate owner, exact package ID, operator identity, purpose, issued/expiry/revocation times; read authorization checks all dimensions at access time. No wildcards or all-candidate grants.
- `review_change_proposals`: `id`, case, change class, structured definition, content hash, revision, author, risk tier, corpus version, state, creation time; approved versions immutable; candidate answer values forbidden.
- `review_decisions`: `id`, proposal/hash/revision, reviewer identity/role, decision, bounded reason code/note, timestamp; append-only audit with constraints against author self-approval on critical changes. Notes are escaped and excluded from general telemetry.
- `review_evaluation_runs`: `id`, proposal hash, corpus/evaluator/build versions, status, counts by outcome, safety failures, report artifact reference, worker lease/job reference, timestamps. Only the evaluator identity can finalize results; the admin cannot upload a “passed” proof.
- `review_release_records`: `id`, approved artifact hash, compatible API/extension versions, cohort/config revision, lifecycle state, rollback target, decision/evaluation references, timestamps; state changes audited and optimistic-concurrency guarded.

Synthetic fixture bodies remain in a versioned evaluation corpus; large private packages use the existing private storage abstraction. Shared artifacts reference immutable hashes. Keep encryption and purpose boundaries explicit rather than mixing private values and public examples in one generic artifact blob.

### Atomic learning commit

Refactor existing truth and learning repositories to accept one transaction context. Prepare expensive normalization before entering the transaction; revalidate versions and context while locked. Lock the receipt/observations in deterministic order, then:

1. Check the stable logical checkpoint key and semantic request digest.
2. If finalized, return the existing receipt and original change-set/Undo link.
3. Validate eligible observations against current versions; apply truth mutations and build the change set.
4. Consume observations, link the change set and finalize the receipt within the same transaction.
5. Append value-free outbox events in that transaction; commit once.

No provider call or browser wait occurs inside the database transaction. Return conflicts explicitly. A changed intended checkpoint payload uses a new logical key; an HTTP retry preserves the same immutable evidence. Transport request IDs and retry timestamps are not semantic checkpoint identity. Keep a uniqueness tombstone for the durable checkpoint lifetime, not only a short generic HTTP idempotency cache. A rejected/expired operation cannot be replayed later into a second truth update.

Workers process at least once, use idempotent handlers, and condition completion on a fresh per-claim lease token. Duplicate outbox delivery must not increment review counts twice. The outbox extends durability to side effects; it is not a replacement for the atomic truth/receipt boundary.

### Proposed endpoints

Candidate authentication:

- `POST /v1/autofill/resolve`: ready-only snapshot plus optional enrichment handle.
- `GET /v1/autofill/enrichment/:id`: candidate-bound enrichment status/result.
- `POST /v1/autofill/outcomes`: bounded event batch; returns accepted/duplicate/rejected counts without echoing private payloads.
- `POST /v1/learning/inbox`: encrypted private staging after candidate edit/save.
- `GET /v1/learning/inbox`: paginated own-candidate review items.
- `POST /v1/learning/inbox/:id/confirm`: explicit candidate-confirmed interpretation/default scope; existing truth save authority still applies.
- `POST /v1/diagnostics/packages`: upload the exact preview-approved package.
- `POST /v1/diagnostics/packages/:id/grants` and `DELETE /v1/diagnostics/grants/:id`: candidate-controlled scoped support access.
- `DELETE /v1/diagnostics/packages/:id`: revoke access and schedule physical purge.

Operator authentication:

- `GET /v1/admin/review-cases` and `GET /v1/admin/review-cases/:id`: sanitized case list/detail.
- `POST /v1/admin/review-cases/:id/transitions`: assign/triage/merge/request evidence, with expected revision.
- `POST /v1/admin/review-cases/:id/proposals`: draft a bounded change proposal.
- `POST /v1/admin/proposals/:id/decisions`: approve/reject the exact hash/revision.
- `POST /v1/admin/proposals/:id/evaluations`: enqueue independent replay, returning HTTP 202 plus run ID.
- `GET /v1/admin/evaluations/:id`: immutable evaluator results.
- `POST /v1/admin/releases`: request promotion of approved compatible artifacts, never arbitrary definitions.
- `POST /v1/admin/releases/:id/disable` and `/rollback`: audited release controls.
- `GET /v1/admin/diagnostics/packages/:id`: only with a current exact-package grant; no list-all-private-data endpoint.

Mutating review endpoints require idempotency and expected revision, return 409 on stale changes, and never infer tenancy/actor from request JSON. Return 403 for insufficient role and a non-enumerating 404 where appropriate for inaccessible private objects. Enforce CSRF protection if using cookie-based sessions; bearer APIs still require issuer/audience/expiry validation and restrictive admin origin policy. Admin UI hiding is not authorization.

## 12. Evaluation, rollout and measurable acceptance

### Required corpus

Start with all audit D01–D16 counterexamples and production checkpoint probes. Add cross-form/cross-root radio groups, unrelated popup options, delayed framework rejection, wrong entity anchors, currency/period/scale variants, temporal anchors, context conflict, unknown-question capture, consent exclusion, private-data leakage, support-grant expiry and role escalation.

Every rule needs positive examples and deliberately similar negative examples. Keep a reviewer-labeled holdout that the proposal-generating model/author cannot rewrite to make the proposal pass. Synthetic fixtures support deterministic regression; consented real-surface observations support representativeness. Never treat twenty copies of one form as twenty independent cases.

Use the real API, learning services, repositories and disposable PostgreSQL for end-to-end certification. Keep PGlite tests for fast boundaries, but include actual PostgreSQL roles, RLS, concurrency and lease recovery. Use a controlled fixture backend to verify actual submitted field values in tests; do not send test submissions to employers.

### Release gates

- Zero failures on the curated consent, ownership, cross-tenant, popup-containment, number-inflation and crash/Undo safety cases.
- Exact round-trip invariants for supported money/duration/date conversions; unresolved ambiguity must abstain.
- One progress item per logical question; complete dispositions for skipped/deferred/unsupported questions.
- Replaying the same checkpoint under connection loss and crash injection returns the same committed result and original Undo link, with no duplicate truth updates.
- Operators cannot self-grant candidate data access, submit candidate answers, approve their own critical production changes or forge evaluation proofs.
- Candidate-learning benchmark at applications 1, 5, 10 and 20 demonstrates held-out recurring-answer reuse against a frozen baseline, without lower independently assessed precision.
- Measure p50/p95 time to first correct fill and completion. Initial engineering target: known-answer local-fixture first fill within 2 seconds at p95 with warm services; label it a target and tune against measured baselines. AI/provider latency is not allowed to block the ready-only path.

Canaries use stable run-level assignment to avoid mixing incompatible behavior within a form. Start with internal/synthetic evaluation, then opt-in limited exposure. Keep Q's stronger existing gates for executable strategy changes. A low-traffic product cannot manufacture statistical confidence: use explicit limited-beta status and manual assessment until sufficient representative evidence accumulates. Safety events trigger immediate disable; performance and precision thresholds are versioned evaluation policy, not admin-adjustable excuses after a failure.

Report correct logical-answer coverage, precision, recurring-question re-entry, justified abstention, commitment-observation level, failure recurrence by release, time/cost per correct application, privacy violations, unresolved queue age and rollback frequency. DOM success, HTTP 200 and provider acceptance remain diagnostic metrics—not primary product quality.

## 13. Build sequence and migration boundaries

**First slice:** lock the regression corpus, implement Question Contract/logical grouping, shared representation and accurate outcome reasons. Correct salary, experience, enum/boolean text support and target containment before making an elaborate admin dashboard.

**Second slice:** repair atomic learning/retries and add the private inbox. Preserve old typed observations; do not replay historical failed/ambiguous values automatically. Mark legacy technical receipts as technical-only.

**Third slice:** add value-free outcome collection and case grouping. Seed cases from the audit and existing pending descriptors, marking insufficient historical evidence honestly. The existing 70 hashed descriptors cannot be reconstructed into full question text retroactively; request a new observation when necessary.

**Fourth slice:** implement operator authentication, admin case/reproduction screens, grants and audit controls. Then add reviewed proposals and independently generated evaluation reports. A usable case viewer ships before automated rule suggestion.

**Fifth slice:** connect reviewed release artifacts, compatibility checks, limited exposure and rollback. Add semantic activation, qualified defaults, entity improvements and provider/schema evaluation under these same gates.

**Sixth slice:** expand cold-start résumé extraction, document entailment and job-matching evaluation. Admin review improves generic extraction/matching logic; candidate confirmation remains necessary for personal résumé facts and generated document approval.

Do not schedule billing or broad feature expansion ahead of the first two reliability slices. Do not require all ten new tables to exist before fixing the proven deterministic bugs; migrations and endpoints are introduced by the bounded slices in the backlog.

## 14. Risks, limitations and final recommendation

Admin review is a quality mechanism, not infallible ground truth. Reviewers need visible evidence, negative cases, conflict escalation and independent checks for critical changes. AI summaries should not be the only thing a reviewer sees. Human review must not become a synchronous dependency of routine filling.

Logging can worsen privacy, create a prompt-injection surface, overwhelm operators or bias evaluation toward failures. The tiered evidence model, explicit contribution permissions, deduplication, success sampling and inert fixtures address those risks; they do not eliminate the need for operational monitoring and privacy review.

Some websites will still resist reliable automation. Closed/inaccessible controls, authentication, CAPTCHA, ambiguous questions, missing candidate facts, employer-specific decisions and invisible backend state require honest boundaries. The system must say what is known, what was filled, what was observed and what the candidate must decide.

The implementation goal is not “AI learns everything from logs.” It is **candidate effort becomes durable private knowledge, while reviewed failures become safer shared deterministic behavior**. This design is concrete enough to start with the first backlog slice immediately, without replacing the architecture or pretending that shared-rule review grants authority over personal answers.

## Sources

[^1]: W3C WAI. [Grouping Controls](https://www.w3.org/WAI/tutorials/forms/grouping/). Updated 27 March 2026. Grouping evidence, fieldset/legend and related controls.
[^2]: W3C WAI Authoring Practices Guide. [Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/). Living documentation, accessed September 2026. Popup association and observable selection semantics.
[^3]: OpenTelemetry. [Handling sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/). Page last modified 14 January 2026. Minimization, allowlists and limitations of hashing.
[^4]: OWASP Cheat Sheet Series. [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html). Living guidance, accessed September 2026. Purpose separation, sensitive fields and untrusted event sources.
[^5]: AWS Prescriptive Guidance. [Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html). Living guidance, accessed September 2026. Atomic event/state writes and duplicate delivery.
[^6]: Stripe API documentation. [Idempotent requests](https://docs.stripe.com/api/idempotent_requests). Accessed September 2026. Stable keys/parameters and replay behavior; product design here does not adopt Stripe's specific retention period.
[^7]: OWASP Cheat Sheet Series. [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). Living guidance, accessed September 2026. Least privilege, deny by default and per-request checks.
[^8]: PostgreSQL 18 documentation. [Row Security Policies](https://www.postgresql.org/docs/18/ddl-rowsecurity.html). Accessed September 2026. Owner/BYPASSRLS behavior; verify the deployed database version and roles during implementation.
[^9]: Chrome for Developers. [Deal with remote hosted code violations](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code). Accessed September 2026. Manifest V3 packaged-code boundary.
[^10]: Google for Developers. [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml). Accessed September 2026. Metrics/pipeline-first design and avoiding excessively complex heuristics.
[^11]: Google. [Canarying Releases](https://sre.google/workbook/canarying-releases/), The Site Reliability Workbook, 2018; web edition accessed September 2026. Representative and attributable release evaluation.
[^12]: Playwright. [Best Practices](https://playwright.dev/docs/best-practices). Living documentation, accessed September 2026. Observable behavior, isolation and web-first assertions.
[^13]: Guo, Chuan; Pleiss, Geoff; Sun, Yu; Weinberger, Kilian Q. [On Calibration of Modern Neural Networks](https://proceedings.mlr.press/v70/guo17a.html). ICML/PMLR 70, 2017, pp. 1321–1330. Calibration concept; not an evaluation of this product or current LLM providers.
[^14]: OWASP Cheat Sheet Series. [LLM Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). Living guidance, accessed September 2026. Untrusted input, least privilege and human approval boundaries.

# Candidate Answer and Interaction Intelligence

Status: implementation design, revision 3 (correction attribution, representation learning, stable repeatables, edit timelines, reversible learning, and grouped authorization)  
Scope: Part 2 candidate-answer intelligence, the field-answer contract, and Part 3 browser interaction intelligence  
Runtime: Node 24, current local SQLite architecture, future Supabase/PostgreSQL  
Product invariant: Copilot reviews and fills; the candidate always submits

## 1. Executive decision

The system must learn five different things independently:

1. **Semantic meaning** — what a field means. This is Part 1 and is already implemented.
2. **Candidate answer** — what the correct answer is for this candidate, in this application context.
3. **Representation** — how normalized truth must be expressed for this field, for example `56 months -> 4 completed years`.
4. **Interaction strategy** — how to operate this particular control.
5. **Acceptance and revision history** — what the UI accepted, what the candidate later changed, and whether that edit reached a durable form checkpoint.

Between Parts 2 and 3 is a mandatory **Field Answer Contract**. It converts a normalized answer into the exact representation required by one logical field instance. Keeping these boundaries separate prevents dangerous learning:

- A correct answer that React removed is an interaction failure, not a bad candidate fact.
- A field that accepted a value which the user later corrected is an answer correction, not necessarily a selector failure.
- A value that appears in the DOM but fails employer validation is not a verified success.
- A user closing a tab is an unknown outcome, not evidence that the strategy failed.
- A user changing `5` to `4` may be a representation correction, an answer correction, or merely a preference; it does not automatically change `TOTAL_EXPERIENCE = 56 months`.
- A user editing a field twice and ending at the original value confirms the final answer; intermediate keystrokes are not two corrections.

The central invariant is:

```text
USER_CORRECTED is an observation, never a success/failure verdict.
```

A correction classifier must derive independent semantic, answer, representation, strategy and acceptance outcomes from the complete operation/edit timeline. No evidence service may map `USER_CORRECTED` directly to semantic success or interaction failure.

The optimized runtime is:

```text
DOM field
  -> Part 1: semantic canonical
  -> Part 2: scoped candidate truth
  -> Field Answer Contract: exact representation
  -> Part 3: bundled browser strategy
  -> readback + employer validation
  -> field revision/edit-session timeline
  -> application checkpoint + user review
  -> classified, compact, attributed evidence
```

The fast path is fully local after one application bootstrap request. Database writes are idempotent and batched. No Redis is required.

## 2. What already exists

The current project has a strong Part 1 and several useful Part 2/3 foundations:

- `src/services/fieldOntology.js` and the semantic-learning migrations implement canonical field meaning.
- `src/services/questionResolver.js` already resolves some answers from profile, resume, job context, past form answers, and an AI allow-list.
- `src/services/applicationPlanner.js` provides deterministic field policy and a review-first plan.
- `extension/content.js` detects native and ARIA controls, scans dynamic pages, tracks manual edits, fills verified values, reads them back, and limits repair attempts.
- Application/page/field snapshots and append-only operation/evidence events already exist.
- Mapping packs already support staged rollout and a kill switch.
- SmartRecruiters repeatable experience and education handling proves the form-planner pattern is feasible.

The present weaknesses are structural rather than a need to rebuild:

- Answer policy is scattered across hard-coded regexes and services.
- Existing candidate answer storage has no precise scope, version history, or single-active-answer invariant.
- Past-form answer storage retains exact text even though the product decision is to retain compact learned context instead.
- Field constraints and answer representation are shallow and not versioned.
- Interaction results do not consistently distinguish failure from unknown/user takeover.
- `src/adapters/fillOutcomes.js` currently treats `USER_CORRECTED` as mapping success; this must be removed before answer or representation learning is enabled.
- Dynamic rescanning exists, but there is no general incremental form graph.
- Repeatable profile records do not yet have a cross-rerender binding contract that keeps one experience/education entity attached to the correct form group.
- There is no durable edit-session timeline that can distinguish an unfinished edit from a checkpoint-accepted correction.
- Strategy rollout data can tune selectors/configuration, but there is no explicit strategy evidence registry.
- Application and operation mutations need stronger idempotency and optimistic concurrency.

The implementation should extend the existing evidence, attempt, snapshot, mapping-pack, and admin foundations. It should not introduce a second application runtime beside them.

## 3. Non-negotiable boundaries

### 3.1 Candidate data is never shared

The shared layer may learn:

```text
"Present organization" -> CURRENT_COMPANY
ARIA combobox fingerprint X -> bundled strategy ARIA_COMBO_KEYBOARD_V1
```

It must never learn or expose:

```text
User A answered "Razorpay" -> fill "Razorpay" for User B
```

Candidate answers, evidence, preferences, and writing-style signals are tenant-private and protected by row-level authorization.

### 3.2 Production extension logic must be packaged

Manifest V3 permits remotely supplied data and configuration, but Chrome Web Store policy prohibits fetching a complex command language and interpreting it as new program logic. Therefore:

- The extension contains a finite, versioned catalog of strategy implementations.
- The backend can enable, rank, parameterize within a strict schema, canary, or disable bundled strategies.
- The backend cannot send executable JavaScript or an open-ended action DSL to production.
- An AI or recovery worker can propose a new strategy for an admin/test harness, but shipping genuinely new behavior requires a reviewed extension release.

This changes the earlier idea of a remotely generated strategy interpreter. The self-healing control plane remains valuable, but production selects among capabilities already packaged in the installed extension.

### 3.3 Database ACID does not make the browser ACID

PostgreSQL/SQLite transactions protect persistent mutations. The browser workflow spans a changing page, network redirects, React state, and human actions, so it must use:

- idempotent commands,
- checkpoints,
- optimistic versions,
- cancellation tokens,
- readback,
- reconciliation on resume,
- and explicit `UNKNOWN` outcomes.

Every browser command must mean “ensure the desired state,” never “repeat this click blindly.”

### 3.4 No automatic submit

Copilot may discover, fill, explain, pause, repair, and prepare application-specific declarations. After the candidate performs an application-specific confirmation gesture, Copilot may check eligible declaration controls and must show what it checked. High-impact authorizations may require their own gesture. Final submission always remains a distinct user action.

### 3.5 Learning occurs only at an accepted checkpoint

`input`, `change`, `blur`, a short debounce, and a successful DOM readback are useful runtime signals, but none alone makes a candidate fact reusable. The learning boundary is a form/application checkpoint:

```text
local field validity             -> current-run draft only
successful page/section advance  -> accepted field revision
review page reached              -> eligible learning commit
application submitted            -> strongest commit receipt
tab close/navigation uncertainty -> ABANDONED or UNKNOWN; no promotion
```

If the form never exposes a reliable review or submission receipt, Copilot may keep the answer as an application-local draft and offer an explicit “Save for next time” action. It must not silently promote an uncertain edit.

## 4. High-level architecture

```text
Extension content runtime
  - DOM scanner and incremental form graph
  - logical field + repeatable entity binder
  - field contract extractor
  - user ownership/takeover guard
  - bundled strategy executor
  - readback and employer validation
  - append-only field revisions + edit sessions
              |
              | one bootstrap + batched telemetry
              v
Extension API / application session service
  - authorization and idempotency
  - application/run/page state
  - Part 1 semantic resolution
  - Part 2 answer engine
  - representation planner
  - correction classifier
  - strategy-pack selector
              |
       +------+------+
       |             |
       v             v
Candidate plane   Shared control plane
  private facts     canonical policies
  scoped answers    packaged strategy catalog
  answer changes    representation/strategy evidence
  entity bindings   sanitized incidents + rollups
  learned context   proposals/rollback controls
  application state incidents/rescue/rollback
       |             |
       +------+------+
              v
SQLite now / PostgreSQL + Supabase later
```

The candidate data plane is latency- and privacy-sensitive. The shared control plane is evidence-heavy and may run asynchronously. Neither performs a database request per field.

## 5. Part 2 — Candidate Answer Intelligence

### 5.1 Module 2A — Policy axes instead of one overloaded legal category

Every canonical has a policy, but a single class is not sufficient. “Legal” can mean a reusable factual answer, an application-specific consent, an attestation over the final contents, or a prohibited security challenge. Model these as orthogonal policy axes.

Primary answer kinds:

- `STABLE_FACT`: name, email, phone, portfolio URL. Usually globally reusable.
- `MUTABLE_FACT`: current company, current title, notice period, current compensation. Reusable while fresh and invalidated by relevant life events.
- `PREFERENCE`: expected compensation, relocation, travel, shift and work-mode choices. Global defaults with controlled context overrides.
- `ENTITY_SCOPED_FACT`: previously employed by, relative at, or conflict with a specific employer/entity group.
- `CONTEXTUAL_ANSWER`: “Why this role?”, project examples, role-specific narratives. Regenerate or ask in each application.
- `LEGAL_FACT`: work authorization, sponsorship need, age threshold or another factual legal screening answer. Reuse only when its jurisdiction, qualifiers, source and freshness match.
- `APPLICATION_ACTION`: consent, certification, disclosure acknowledgement or authorization that applies to the exact application text/revision. Never stored as a reusable candidate answer.
- `SUBMISSION_ACTION`: always performed directly by the candidate.
- `SECURITY_CHALLENGE`: password, OTP, CAPTCHA, identity verification and similar controls. Never stored or filled.

Independent axes control:

```text
answer kind
+ scope dimensions
+ mutability/freshness
+ sensitivity/risk tier
+ learning mode
+ autofill mode
+ application-authorization mode
= allowed behavior
```

This prevents both crude rules such as `legal => never fill` and dangerous rules such as `checkbox => reuse yes`. The canonical definition describes meaning; the policy describes authority.

### 5.2 Module 2A — Answer policy contract

```ts
type CanonicalAnswerPolicy = {
  canonicalKey: string;
  answerKind:
    | "STABLE_FACT"
    | "MUTABLE_FACT"
    | "PREFERENCE"
    | "ENTITY_SCOPED_FACT"
    | "CONTEXTUAL_ANSWER"
    | "LEGAL_FACT"
    | "APPLICATION_ACTION"
    | "SUBMISSION_ACTION"
    | "SECURITY_CHALLENGE";
  valueType: "STRING" | "BOOLEAN" | "DATE" | "MONEY" | "PHONE" | "ENUM" | "RICH_TEXT";
  questionFamily: string;
  scopePolicy: "GLOBAL" | "GLOBAL_WITH_OVERRIDES" | "APPLICATION";
  scopeDimensions: Array<"COUNTRY" | "COMPANY_GROUP" | "LOCATION" | "ROLE_FAMILY" | "EMPLOYMENT_TYPE">;
  reusePolicy: "AUTO" | "AUTO_IF_FRESH" | "CONTEXTUAL" | "GENERATE" | "ASK" | "NEVER";
  learningMode: "AUTO_VERSION" | "SCORE_IN_SCOPE" | "EXPLICIT_CONFIRM" | "NEVER";
  learningPresentation: "QUIET_SUMMARY" | "PROMINENT_SUMMARY" | "REVIEW_TO_SAVE" | "HIDDEN";
  anomalyProfile: string | null;
  autofillMode: "AUTO" | "PREPARE_FOR_REVIEW" | "USER_ONLY" | "NEVER";
  authorizationMode: "NONE" | "PER_APPLICATION_BATCH" | "PER_ITEM" | "USER_DIRECT";
  freshnessProfile: "STABLE" | "COMPENSATION" | "NOTICE" | "DATE_SENSITIVE" | null;
  dependencyKeys: string[];
  derivationPolicy: "DETERMINISTIC_ONLY" | "GROUNDED_GENERATION" | "NEVER_INFER";
  sensitivity: "NORMAL" | "PERSONAL" | "SENSITIVE" | "LEGAL";
  riskTier: "LOW" | "MEDIUM" | "HIGH" | "PROHIBITED";
  version: number;
};
```

Policy records are small, global, reviewed configuration. The extension/API caches them by version.

### 5.3 Module 2B — Resolution hierarchy and versioned truth

For each known canonical, resolve in this order:

1. Explicit candidate profile fact.
2. Active confirmed candidate answer in the most specific compatible scope.
3. Safe deterministic derivation from verified evidence.
4. Paid-only grounded generation from verified candidate evidence plus job context.
5. Ask the candidate inline or add an Attention item.

Scope precedence is:

```text
APPLICATION > COMPANY > ROLE_FAMILY > GLOBAL
```

A more specific answer never silently overwrites a global fact. A one-off application answer never becomes global merely because the form was submitted.

Freshness expiry means “reconfirm,” not “delete.” The old value remains auditable and can be displayed as a suggested previous value. Event-driven invalidation is stronger than a timer: changing current employer invalidates current title/compensation assumptions; a visa expiry invalidates authorization; changing home location may invalidate relocation/location preferences.

Scope keys must use controlled dimensions, not arbitrary JSON context. Otherwise every application creates a unique override and the resolver becomes both slow and unpredictable.

### 5.4 Module 2C — Manual-input capture and attribution

#### Case A — Copilot knew the answer but failed to fill the control

Example: `CURRENT_COMPANY = "Razorpay"` was resolved, but a changed React combobox rejected the operation. The user manually types `Razorpay`.

Record:

- Candidate-answer outcome: `CONFIRMED_UNCHANGED`.
- Representation outcome: successful if the final normalized value is compatible.
- Strategy outcome: `FAILURE` only if the original strategy reached a clearly failed verification stage; otherwise `UNKNOWN`.
- Learned answer: no new candidate fact is necessary because the fact was already known.
- Shared learning: the failed strategy/fingerprint receives evidence; the user's value is never shared.

On the next compatible form, Copilot should still resolve `Razorpay` immediately, but it should use a better bundled strategy if one has been validated for that control fingerprint.

If the user types a different value, split the incident:

- Create an answer-correction candidate for the appropriate scope.
- Do not count the different text itself as proof of strategy failure.
- Replace a reusable fact automatically only when its policy is `AUTO_VERSION`, the canonical/scope is unambiguous, and the user-entered value reaches a form commit boundary. Otherwise create a scoped version or an Attention item.
- Classify the demonstration as `ANSWER_CORRECTION` or `MIXED`; do not use it for automatic interaction-strategy learning.

#### Case B — Copilot understood the field but did not know the candidate's answer

Example: the field maps to `NOTICE_PERIOD_DAYS`, but no current value exists. The user enters `30`.

Record:

- Application-scoped draft immediately after local validation.
- A reusable candidate answer at the next reliable commit boundary when policy permits it. Low-risk stable facts can auto-version without another prompt; mutable facts use freshness; preferences and entity/legal facts use their controlled scope dimensions.
- A direct manual entry counts as candidate-provided evidence. An ATS-prefilled value, browser/password-manager autofill, or merely untouched Copilot value does not.
- `confirmed_at`, source/provenance, policy version, normalized value, evidence score and exact scope qualifiers.
- No shared answer value.

On the next form:

- Autofill automatically for a stable fact with `AUTO` policy.
- Autofill a mutable fact while fresh; ask once only when stale, contradicted or dependency-invalidated.
- Resolve preferences using the most-specific compatible override, otherwise the global default.
- Autofill a legal fact only when jurisdiction, qualifiers, source and freshness are compatible.
- Regenerate/ask for contextual answers.
- Prepare application actions for review; never reuse one employer's consent as another employer's answer.

This provides the behavior the product needs without a “remember this?” interruption after every field and without treating every keystroke as permanent profile truth. The UI should show a quiet post-application learning summary with Undo, reserving blocking prompts for ambiguity or high-impact facts.

The simple evidence score remains useful but cannot decide authority by itself. It is computed once from the final checkpoint-accepted revision, never from every `input` event:

```text
kept through a reliable form commit -> +1
overwritten by the candidate         -> -2
ATS/browser prefill left untouched   ->  0
unfinished/abandoned/ambiguous edit  ->  0
```

Score is attached to an answer version inside its exact scope. It never widens scope, defeats freshness, converts consent into a fact, or overrides a sensitivity rule. Semantic mappings, representation rules and browser strategies maintain separate evidence ledgers.

### 5.5 Module 2C — Automatic learning, change sets and Undo

Do not ask “Remember this?” after each manually answered field. That would interrupt the user at the exact moment Copilot is supposed to save time. Use a three-stage lifecycle:

```text
OBSERVED
  -> ACCEPTED_AT_CHECKPOINT
  -> LEARNED_CHANGE_SET

Alternative exits:
ABANDONED | AMBIGUOUS | POLICY_BLOCKED | REVIEW_TO_SAVE
```

Learning presentation is independent from storage/reuse policy:

- `AUTO_QUIET`: low-risk, unambiguous fact; version after a strong checkpoint and show in the completion summary.
- `AUTO_PROMINENT`: safe to version, but show the change prominently because it is unusually large, freshens an important fact, or changes multiple downstream answers.
- `REVIEW_TO_SAVE`: legal facts, sensitive facts, ambiguous scope, suspicious deltas, or conflicting versions; use in the current application but require one post-application confirmation before future reuse.
- `NEVER`: application actions, submissions, security challenges, voluntary disclosures that policy forbids retaining, and unfinished edits.

Deterministic anomaly gates run before auto-learning. Initial checks include value type/shape, canonical range, dependency consistency, extreme numeric delta, impossible date sequence, option membership, repeated flip-flops in one edit session, and source certainty. For example, `12 LPA -> 1.2 crore` is not silently learned just because the page accepted it.

At review/submission, show one quiet summary rather than many prompts:

```text
Copilot updated 3 details for next time.   Review   Undo

Current company     Vidyakul -> Acme       Everywhere
Notice period       30 -> 60 days          Review in 90 days
Relocation          Yes                    For Bengaluru roles
```

The candidate sees plain behavior, scope and freshness—not internal confidence scores. A changed high-impact item appears in a separate “Review before saving” block. Undo changes future Copilot memory only; it never attempts to alter an employer application that was already submitted.

Each learning commit creates one `candidate_answer_change_set` and immutable item records. Immediate **Undo all** is atomic only if every learned version is still the active version. If a later tab/device has already created a newer version, return a conflict and let the candidate restore individual items; never clobber newer data. Undo of a replacement creates a new `USER_UNDO_RESTORE` version referencing both the learned and restored versions. Undo of a first-time fact withdraws that version and leaves no active answer. Old rows are never reactivated or deleted.

Keep the completion snackbar available for roughly 30 seconds and keep the same reversible history in Profile → Answer history. The permanent history is the real recovery mechanism; the snackbar is merely the fast path.

### 5.6 Module 2D — Representation Resolution & Learning

Candidate truth and rendered form value are different objects:

```text
canonical             TOTAL_EXPERIENCE
normalized truth      { value: 56, unit: MONTH }
representation rule   FLOOR_COMPLETED_YEARS_V1
rendered value         4
browser strategy       NATIVE_TEXT_INPUT_V1
```

Changing the rendered value must not automatically mutate the truth. The representation resolver selects only from a packaged, versioned registry of pure deterministic transforms:

```text
IDENTITY
FLOOR_COMPLETED_YEARS
CEIL_YEARS
ROUND_NEAREST_YEARS
MONTHS_TO_DECIMAL_YEARS
ANNUAL_TO_MONTHLY_MONEY
MONTHLY_TO_ANNUAL_MONEY
ISO_DATE / DATE_PARTS / MONTH_YEAR
PHONE_E164 / COUNTRY_CODE_PLUS_NATIONAL
ENUM_OPTION_BY_CANONICAL_VALUE
```

Selection precedence is exact and scope-first:

```text
FIELD_FINGERPRINT
  > FORM_FAMILY
  > ATS + CANONICAL + CONTROL_KIND
  > CANONICAL + CONTROL_KIND
  > canonical default
```

The chosen rule, version, parameters, scope and candidate-answer version are embedded in `FieldAnswerContract`. The backend may rank or parameterize packaged transforms through a strict schema, but cannot send arbitrary executable transformation code.

Correction classification is conservative:

1. If the strategy never produced the intended rendered value, this is an interaction failure/unknown—not representation evidence.
2. If the intended representation was rejected by browser/employer validation and the candidate's final value is generated by another packaged rule from the **same normalized truth**, record representation correction evidence against the old rule and for the alternative.
3. If both values were accepted and the candidate merely preferred another valid display, store at most a candidate-scoped `REPRESENTATION_PREFERENCE`; do not claim the website requires it.
4. If the final value implies different normalized truth, route to candidate-answer correction.
5. If more than one explanation remains plausible, all learning outcomes are `UNKNOWN`.

This distinction prevents `56 months -> 5 -> user enters 4` from globally teaching `FLOOR()` when the user may simply prefer completed years. Shared learning requires evidence that the original representation was invalid/rejected or that the control's options/constraints made only the alternative valid.

Starting promotion gates are configuration, not hard-coded business logic:

- One eligible correction creates `OBSERVED` evidence at exact field-fingerprint scope only; it never changes production selection.
- `PROVISIONAL_EXACT`: two independent compatible applications/candidates, or one eligible correction plus a passing sanitized replay fixture and admin approval; no safety failure.
- `VERIFIED_EXACT`: at least five automatic direct successes in six eligible attempts across at least three independent candidates/runs.
- Widen to form-family scope only after at least 15 successes in 17 eligible direct attempts across at least five candidates and three distinct forms/jobs.
- Widen to ATS/canonical scope only after at least 30 successes in 34 attempts across at least ten candidates and five distinct sites/forms, plus replay coverage.
- Wrong unit, materially wrong amount/date, validation corruption, or a protected-field mutation quarantines the rule/scope immediately.

Use `+1 kept / -2 corrected` for representation evidence only after the classifier proves the candidate truth stayed equivalent. It is not the promotion decision by itself; independence, scope, minimum samples and safety gates remain mandatory.

### 5.7 Module 2E — Stable Repeatable Entity Binding

Education, experience, project and certification rows need durable entity identity. DOM order is not identity.

Maintain three IDs:

```text
candidateEntityId   durable profile record, e.g. experience UUID
formGroupId         logical group inside this application run
controlGeneration   ephemeral DOM incarnation after each rerender
```

A logical repeated field is therefore:

```text
EMPLOYMENT_COMPANY + candidateEntityId=exp_01 + formGroupId=group_03
```

not `EMPLOYMENT_COMPANY[2]`. Existing profile/resume records receive a UUID once during migration and that UUID is written back beside the record (or mapped through an immutable source-record ID); it is never regenerated from mutable contents, a content hash, or array position.

Binding algorithm:

1. Reuse an existing binding when its logical group can be reacquired and strong anchors remain compatible.
2. Snapshot rendered groups using value-free structural identity plus candidate-private anchor values such as normalized employer/institution, title/degree and date range.
3. Build a candidate-entity × form-group compatibility matrix.
4. Compute a maximum-weight one-to-one assignment, rather than greedily letting two groups choose the same experience.
5. Auto-bind only when score is at least `0.85` and the margin over the runner-up is at least `0.20`. Scores `0.65–0.85`, duplicate employers, or a small margin require one compact user choice. Lower scores remain unbound.
6. Use ordinal order only as a final deterministic tiebreaker for completely blank newly-created groups.

Suggested initial weights (configurable and tested per entity type): exact employer/institution `0.35`, title/degree `0.20`, date overlap `0.25`, location `0.10`, other strong anchor/completeness `0.10`. A single weak label or DOM index can never cross the auto-bind threshold.

For `ensure count = N`, create only one group at a time, wait for a relevant mutation, assign a new `formGroupId`, bind it to the next unbound candidate entity, and then fill it. Deleting a form group marks the binding `REMOVED_BY_USER`; it never deletes the candidate's profile entity. Reordering keeps bindings by identity. Rerender increments generation but retains the logical group. A group the user creates manually becomes an application-local entity proposal and is learned only through the normal checkpoint/policy flow.

If a user turns one bound group into another entity mid-form, freeze the old binding during the edit. Re-evaluate at the next checkpoint; automatically rebind only with strong unambiguous anchors, otherwise ask “Which experience is this?” once. Abandoned half-created groups create no reusable entity.

### 5.8 Module 2F — Application authorization rather than reusable consent answers

The following are different objects:

```text
WORK_AUTHORIZATION_INDIA = AUTHORIZED
  -> candidate legal fact
  -> country-scoped, reusable when fresh and qualified

"I agree to Acme's privacy policy revision X"
  -> application authorization action
  -> exact employer text/revision, never reusable as an answer
```

Classify each action before deciding the interaction:

- `BATCH_ELIGIBLE_DECLARATION`: ordinary accuracy certification, acknowledgement of a clearly displayed applicant notice, or closely related mandatory processing items with compatible purpose/risk.
- `SEPARATE_AUTHORIZATION`: background check, arbitration/waiver, biometric, medical/genetic, electronic signature, or any item with materially distinct consequences.
- `OPTIONAL_CHOICE`: marketing, talent-pool retention, future-job contact, optional data sharing and similar choices. Preserve a neutral choice and never bundle them into the required path.
- `USER_DIRECT`: CAPTCHA/security/identity proof, signature drawing, or a document/action Copilot cannot reliably snapshot and bind.
- `UNKNOWN`: fail closed and ask the candidate.

The low-friction application flow is:

1. Detect application actions and leave them pending.
2. Show a dedicated “Declarations & consent” review group with every item visibly listed, the exact short label, employer, destination link when present, whether it is required, and its risk category. Details must not be hidden behind the primary button.
3. Allow one explicit, clearly labelled affirmative gesture to authorize only a compatible batch of eligible mandatory items. Optional choices remain separate and neutral.
4. Require separate authorization for background checks, arbitration/waivers, biometrics, medical/genetic disclosures, electronic signatures, marketing or other materially different/high-impact actions.
5. After authorization, check with a trusted packaged strategy and show `Authorized and checked by Copilot`.
6. Bind the receipt to candidate, application, action IDs, normalized statement fingerprint, an encrypted candidate-private statement snapshot, linked-document identity when available, form revision, application-content revision, extension version, review-surface version and gesture time.
7. If the statement text, linked-document identity, dependent application data or form revision materially changes, invalidate the authorization and return it to review. An accuracy certification depends on the application-content revision; a notice acknowledgement depends on the notice/document revision, not every unrelated field.
8. If the candidate manually checks an item, mark it `USER_OWNED`, remove it from the Copilot batch and never toggle it. If the employer prechecks it, record `ATS_PREFILLED`, surface it for review, and do not infer candidate authorization.
9. If the candidate unchecks an item, mark it revoked and never repair it automatically.
10. The candidate submits directly.

This is better than pre-checking and merely disclosing afterward. India's DPDP Act requires consent to be specific, informed, unambiguous and expressed through a clear affirmative action. US background checks may require a clear disclosure and written permission, and other jurisdictions may reject preselected consent. The product should use the stricter application-specific interaction model rather than guessing jurisdiction at runtime.

Some multi-page forms will block navigation until a declaration is checked. In that case, present the same grouped review inline at that page instead of waiting until the final side-panel review. If Copilot cannot access or fingerprint a linked document, do not pretend it can prove what the user saw; route high-impact items to direct user interaction.

### 5.9 Legal and screening canonical examples

Avoid apparently convenient global booleans that discard the employer's qualifiers:

- `WORK_AUTHORIZATION`: `LEGAL_FACT`, scoped by job country and authorization status/type/expiry. “Authorized in India” says nothing about the United States.
- `SPONSORSHIP_REQUIRED`: split “now” and “in the future,” and resolve against the job country. A single global sponsorship boolean is ambiguous.
- `AGE_AT_LEAST`: store the threshold result and confirmation time; do not retain date of birth merely to answer an age gate. A previous `AGE_OVER_18 = false` can naturally become true.
- `PREVIOUSLY_EMPLOYED_BY_ENTITY`: `ENTITY_SCOPED_FACT` keyed to a normalized employer legal-entity/parent group, with dates when wording requires them.
- `RELATIVE_AT_ENTITY`: entity-group scoped and freshness-sensitive; definitions of relative may differ, so ambiguous wording is reviewed.
- `GOVERNMENT_AFFILIATION`: store structured qualifiers such as candidate-versus-relative, role/type, country and requested time window. Do not reuse a broad global yes/no across different definitions.
- `NON_COMPETE_OR_RESTRICTION`: structured current agreement facts plus employer/geography/role/time qualifiers. Never infer legal enforceability.
- Voluntary demographic/self-identification: application/jurisdiction scoped, never inferred, and preserve `DECLINE_TO_ANSWER` as a real option when available.

The `+1/-2` evidence score applies only after canonical qualifiers have matched. It cannot make a poorly defined global boolean safe.

### 5.10 Compact writing-style learning

Do not store the generated draft or the user's edited narrative for learning. Compare them ephemerally at review/submit and persist only controlled signals:

- `PREFER_CONCISE`
- `PREFER_METRICS`
- `PREFER_STAR`
- `PREFER_ROLE_SPECIFIC`
- `AVOID_GENERIC_LANGUAGE`
- `PREFER_TECHNICAL_DETAIL`
- `PREFER_PLAIN_LANGUAGE`

MVP scoring remains deliberately simple:

```text
candidate keeps draft      -> +1
candidate overwrites draft -> -2
```

Recommended activation rule:

- Clamp a signal score to `[-8, 8]`.
- Require at least three observations and score `>= 2` before using it.
- Stop applying it when score returns to `<= 0`.
- Keep global and `question_family` signals separate.
- Never use style context as factual evidence.

Deterministic comparison should run first: length ratio, metric presence, structural rewrite, and tone-safe features. Use an AI edit classifier only for ambiguous cases, batch it after review/submit, require schema-constrained output, and never retain the compared text in learning tables.

### 5.11 Candidate-facing UX contract

The intelligence should feel calm and predictable, not like a debugging console:

```text
Applying to Acme
42 of 45 fields ready

Needs you (2)          answer inline, at the employer field when possible
Declarations (1 group) review once, visibly itemized
Filled (42)            collapsed by default; corrections stay user-owned
```

- Never show internal strategy names, scores, fingerprints or “AI confidence.” Show `Filled`, `Needs your answer`, `Please review`, or `Could not safely fill`.
- Do not steal focus or reopen a field after the candidate starts interacting. “Let Copilot handle this field” is the only way to return ownership.
- Ask ambiguity questions at the point of work: “Which Amazon experience is this?” with two concise date/title choices, not a generic error in the side panel.
- Keep safe progress moving when one independent field fails. One problem should not stop the whole application.
- Surface representation changes in human terms: `Used 4 completed years from 56 months`, with a compact reason on review.
- At the final review, separate `Application answers`, `Declarations`, and `Saved for next time`. This makes application-specific action visibly different from candidate memory.
- Announce status changes accessibly, preserve keyboard focus, use labelled groups, and provide review/correction before consequential actions.
- If resume/recovery cannot prove continuity, say `Please review this field` rather than silently replaying an operation.

## 6. Field Answer Contract — the boundary between Parts 2 and 3

Part 2 returns semantic truth. Part 3 needs an exact control-compatible value. The contract makes the transformation explicit.

```ts
type FieldAnswerContract = {
  logicalFieldId: string;
  fieldInstanceId: string;
  candidateEntityId?: string;
  formGroupId?: string;
  canonicalKey: string;
  semanticValue: unknown;
  control: {
    kind: "TEXT" | "TEXTAREA" | "SELECT" | "RADIO" | "CHECKBOX" | "COMBOBOX" | "FILE";
    required: boolean;
    multiple: boolean;
    inputMode?: string;
  };
  constraints: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    step?: number;
    pattern?: string;
  };
  options?: Array<{ key: string; label: string; disabled: boolean }>;
  format?: {
    dateParts?: Array<"DAY" | "MONTH" | "YEAR">;
    phoneParts?: Array<"COUNTRY_CODE" | "NATIONAL_NUMBER">;
    moneyUnit?: "ANNUAL" | "MONTHLY" | "HOURLY";
    currency?: string;
  };
  representation:
    | { kind: "TEXT"; value: string; ruleKey: string; ruleVersion: number; scope: string }
    | { kind: "OPTION"; optionKey: string; visibleLabel: string; ruleKey: string; ruleVersion: number; scope: string }
    | { kind: "PARTS"; values: Record<string, string>; ruleKey: string; ruleVersion: number; scope: string }
    | { kind: "NO_SAFE_REPRESENTATION"; reason: string };
  provenance: {
    answerVersionId?: string;
    policyVersion: number;
    derivation?: string;
    contractVersion: number;
  };
  contractHash: string;
};
```

Rules:

- Preserve normalized truth: dates as ISO/parts, phone as country code plus national number, money as amount/currency/period.
- Discover dynamic options before matching.
- Match only to an actual enabled option. Never invent a dropdown value.
- Validate length, pattern, numeric bounds, `required`, control semantics, and browser validity before operating the DOM.
- Re-extract the contract when the control fingerprint or form revision changes.
- Treat ambiguous representations as `NO_SAFE_REPRESENTATION` and ask the user.

## 7. Part 3 — Reliable browser interaction

### 7.1 Module 3A — Field Revision & Edit-Session Timeline

Part 3 must persist a logical timeline, not infer learning from the latest DOM value. The hierarchy is:

```text
ApplicationRun
  -> PageRevision / FormRevision
     -> FormGroupBinding
        -> LogicalField
           -> FillOperation
           -> FieldRevision[]
           -> EditSession[]
              -> LearningClassification
```

Every Copilot operation captures `beforeValueHash`, intended semantic/representation IDs, strategy/version, page/form/control generation, immediate readback, stable readback, employer validation and cleanup. Every value transition becomes an append-only private `FieldRevision` with source:

```text
COPILOT | USER | ATS_PREFILL | BROWSER_AUTOFILL |
DEPENDENCY_SCRIPT | PAGE_SCRIPT | UNKNOWN
```

Source attribution uses a bundle of signals: active operation ownership, expected value/hash, trusted pointer/focus/input sequence, event timing/order, composition state, control generation and framework rerender. `Event.isTrusted` is evidence, not proof. A value present before Copilot attaches, an unexplained scripted mutation, or a browser/password-manager fill is neutral `UNKNOWN/ATS_PREFILL/BROWSER_AUTOFILL` and cannot train candidate memory.

An edit session groups a candidate's full revision sequence:

```text
USER_EDIT_STARTED
  -> USER_EDIT_ACTIVITY*
  -> LOCAL_COMMIT (blur/inactivity; still not learnable)
  -> USER_EDIT_RESUMED* (candidate may return later)
  -> CHECKPOINT_ACCEPTED | ABANDONED | UNKNOWN
```

IME/composition is one edit after `compositionend`; paste, speech and accessibility-tool input may be user-directed but are classified by the same ownership/checkpoint logic. Individual characters are never evidence rows.

At a successful page/section/review checkpoint, compare the field's **starting accepted revision** with its **final accepted revision**:

- Same normalized value after any number of intermediate changes: answer `KEPT (+1)`.
- Different final normalized truth: possible candidate-answer correction `(-2 to the old version)`, subject to policy/scope/anomaly checks.
- Same normalized truth through a different packaged transform: possible representation correction/preference.
- Copilot intended value never reached stable readback: strategy failure/unknown.
- User takeover before verification, dependency-driven mutation, navigation race, close, or incomplete edit: `UNKNOWN`, zero evidence.

The classifier emits independent results:

```ts
type FieldLearningClassification = {
  semantic: "CONFIRMED" | "REJECTED" | "UNKNOWN";
  answer: "KEPT" | "CORRECTED" | "UNKNOWN";
  representation:
    | "SUCCESS"
    | "CORRECTED"
    | "USER_PREFERENCE"
    | "REJECTED_BY_VALIDATION"
    | "UNKNOWN";
  strategy: "SUCCESS" | "FAILURE" | "UNKNOWN";
  acceptance: "FIELD_VALID" | "CHECKPOINT_ACCEPTED" | "REJECTED" | "UNKNOWN";
  reasonCodes: string[];
};
```

Semantic `REJECTED` requires explicit evidence that the question meaning was wrong—such as a deterministic type/qualifier contradiction, direct user/admin correction of the mapping, or repeated validated remapping evidence. A different candidate answer alone never penalizes the canonical mapping. When genuine semantic evidence degrades a mapping, use the existing Part 1 suspect/quarantine/re-resolution pipeline; do not immediately call AI or flip the global mapping after one `-2`.

Recommended local timings are implementation defaults, not commit rules: coalesce typing activity after roughly 750 ms, mark a local blur commit after roughly 1.5 s, and use strategy-specific stable verification (often 100–500 ms after the framework settles). A checkpoint—not a timer—decides learning. Persist open edit-session metadata immediately enough to survive service-worker suspension; on resume, rescan and reconcile by run/logical field/generation. If continuity cannot be proven, close `UNKNOWN`.

Implementation events:

```text
FIELD_DISCOVERED | FILL_PLANNED | FILL_STARTED |
FILL_IMMEDIATE_VERIFIED | FILL_STABLE_VERIFIED | FILL_FAILED |
USER_EDIT_STARTED | USER_EDIT_ACTIVITY | USER_EDIT_LOCAL_COMMIT |
USER_EDIT_RESUMED | FIELD_VALUE_EXTERNAL_CHANGE |
FIELD_INVALIDATED_BY_DEPENDENCY | FIELD_RERENDERED |
FIELD_CHECKPOINT_ACCEPTED | USER_TAKEOVER | NAVIGATION_OCCURRED |
APPLICATION_ABANDONED | APPLICATION_REVIEW_REACHED | APPLICATION_SUBMITTED
```

Until this classifier exists, the backend may retain raw normalized outcome categories for later replay, but it must not enable `+1/-2`, representation promotion, or strategy learning from `USER_CORRECTED`.

### 7.2 Module 3D — Bundled strategy catalog

Initial packaged implementations should include:

```text
NATIVE_TEXT_INPUT_V1
NATIVE_VALUE_SETTER_EVENTS_V1
KEYSTROKE_TEXT_INPUT_V1
NATIVE_SELECT_V1
RADIO_OR_CHECKBOX_CLICK_V1
ARIA_COMBO_CLICK_OPTION_V1
ARIA_COMBO_KEYBOARD_V1
LISTBOX_ACTIVEDESCENDANT_V1
DATE_PARTS_V1
FILE_INPUT_DATATRANSFER_V1
REPEATABLE_ENSURE_COUNT_V1
CONDITIONAL_REVEAL_VERIFY_V1
```

Each implementation exposes a fixed interface:

```ts
type BundledStrategy = {
  key: string;
  version: number;
  supports(contract: FieldAnswerContract, fingerprint: ControlFingerprint): boolean;
  prepare(context: StrategyContext): Promise<PreparedAttempt>;
  execute(context: StrategyContext, prepared: PreparedAttempt): Promise<ExecutionResult>;
  verify(context: StrategyContext, executed: ExecutionResult): Promise<VerificationResult>;
  cleanup(context: StrategyContext, prepared: PreparedAttempt): Promise<CleanupResult>;
};
```

`prepare` captures a bounded baseline and starts an operation-owned mutation journal. `cleanup` may reverse only effects proven to belong to that operation. It never restores an arbitrary old DOM snapshot and never runs after the candidate has taken ownership.

Cleanup outcomes are:

```text
CLEAN_NO_EFFECTS
RESTORED
DIRTY
UNKNOWN
```

The next strategy may run only after `CLEAN_NO_EFFECTS` or `RESTORED`, the control was reacquired, and its generation/contract still matches. `DIRTY` or `UNKNOWN` hands the field to the candidate. This prevents one failed strategy from poisoning every later strategy or the human demonstration.

Some controls have irreversible or remote side effects: submit, consent/authorization, file upload, add/remove records, verification, or controls that autosave to the employer. These use at most one sufficiently trusted strategy and never enter automated fallback exploration unless an explicit control-specific compensation has been proven.

The server returns only packaged keys plus validated, non-executable parameters such as bounded timeouts, known selector hints, and rollout assignment. The runtime rejects unknown keys, unsupported versions, extra parameters, and strategy/control mismatches.

### 7.3 Actionability checks

Before an operation, re-locate by stable identity and confirm:

- attached to the active document,
- visible,
- stable long enough for the operation,
- enabled,
- editable when applicable,
- not covered by another element for pointer actions,
- exact fingerprint compatible with the selected strategy,
- not owned by the user,
- current `runId`, `pageGeneration`, and `formRevision` still active.

Re-locate before each action. Do not retain stale element handles through DOM rerenders.

### 7.4 Module 3C — Incremental form graph

Dynamic pages require a graph, not a one-time list of fields:

```text
page
  -> section
      -> repeatable group instance
          -> field/control
  -> reveal action
      -> newly discovered section/field
```

The Form Planner owns these structural actions:

- section discovery,
- hidden-section activation,
- repeatable group count,
- pagination/next-page detection,
- option discovery,
- conditional branch reconciliation.

For repeatable education/experience, execute `ensure count = N`:

1. Reacquire visible logical group instances and restore compatible persisted bindings.
2. Match remaining groups to verified candidate entities with the Module 2E one-to-one assignment and confidence margin.
3. Add exactly one group only when an unbound candidate entity remains.
4. Wait for a relevant DOM mutation.
5. Rescan only the affected container and assign a durable session `formGroupId`.
6. Bind the new group to exactly one unbound `candidateEntityId`; confirm count and identity uniqueness.
7. Repeat until the desired bound entity set is represented, budget exhausts, ambiguity requires the candidate, or user takeover occurs.

For conditional fields, fill the controlling answer, wait for mutation, increment `formRevision`, cancel stale work, and plan only the newly revealed branch.

### 7.5 Module 3B — Ownership and concurrent human input

The candidate is authoritative. A trusted pointer/key/input/focus sequence marks the field `USER_OWNED` for the current application. Copilot cancels pending work and will not repair or overwrite that field unless the candidate explicitly chooses “Let Copilot handle this field.”

Precedence is:

```text
live user input > current DOM > confirmed candidate memory > generated suggestion
```

Programmatic events must be tagged internally. `Event.isTrusted` is useful evidence but should not be the only signal because browser behavior and accessibility tooling can differ.

User observation is bound to one explicit handoff session and one interaction unit. It begins only after Copilot releases ownership and the field is clean. It ends on verified commit, generation change, timeout, navigation or cancellation. It does not install a global key logger.

Normalize locally:

```text
pointer/focus/click/characters/options/mutations
  -> OPEN / SEARCH / SELECT / COMMIT
```

Transmit structural attributes such as pointer-versus-keyboard selection, portaled popup, virtualized options and length bucket. Never transmit typed characters, selected labels, clipboard text or raw surrounding DOM. Ignore password/OTP/CAPTCHA, files, contenteditable narratives, security challenges and authorization actions. Handle composition/IME sessions as one semantic edit after `compositionend`; individual key events are not a reliable demonstration.

### 7.6 State machines

Application run states:

```text
CREATED
  -> DISCOVERING
  -> FILLING
  -> REVIEW_REQUIRED
  -> READY_FOR_REVIEW
  -> SUBMITTED

Interruptions:
PAUSED | USER_TAKEOVER | BLOCKED | ABANDONED | FAILED
```

Field states:

```text
DISCOVERED
  -> RESOLVED
  -> ANSWER_READY
  -> FILL_ATTEMPTED
  -> READBACK_VERIFIED
  -> EMPLOYER_ACCEPTED

Alternatives:
USER_MODIFIED | INVALID | BLOCKED | STALE
```

`USER_MODIFIED` is a runtime ownership state, not a learning outcome. Learning waits for the linked edit session to become `CHECKPOINT_ACCEPTED`; it becomes `ABANDONED/UNKNOWN` if the candidate closes, navigates unpredictably, or leaves an incomplete revision.

Interaction result is always one of:

- `SUCCESS`: the required evidence stage was observed.
- `FAILURE`: a specific contradiction was observed, such as value did not stick or employer validation rejected it.
- `UNKNOWN`: navigation, tab close, timeout, user takeover, worker suspension, or missing receipt prevents a conclusion.

Only success/failure enters strategy rate calculations. Unknown remains visible operationally but cannot lower or promote a strategy.

### 7.7 Evidence stages

```text
ATTEMPTED
  -> EXECUTED
  -> READBACK_VERIFIED
  -> EMPLOYER_ACCEPTED
```

For a native text input, readback may be sufficient for a provisional success. For an ARIA combobox or masked control, require selected option/state plus the absence of relevant employer validation errors. For upload, require the project’s existing attachment receipt. Submission is never required to learn that an individual field was accepted.

### 7.8 Module 3E — Recovery and rollout

Normal field recovery budget:

1. Execute the sparse strategy plan: zero, one, two or three packaged strategies. Three is a maximum, not a target to fill with weak alternatives.
2. Between strategies, require successful operation-owned cleanup and re-planning.
3. When the plan is exhausted or dirty, stop and hand the one field to the candidate while Copilot may continue safe independent fields.
4. Observe the candidate's structural interaction only when the privacy/eligibility rules permit.
5. Compare the normalized demonstration deterministically with packaged strategy signatures.
6. If a low-risk exact-context demonstration strongly matches a packaged strategy, make it a `PROVISIONAL_BACKUP` for later rescue traffic when a slot is available. Ambiguous matches require independent demonstrations or admin review.
7. If no packaged strategy matches, create an admin proposal containing sanitized evidence, a proposed implementation plan and required fixtures. AI may assist this offline process; new executable behavior ships only in a reviewed extension release.

All clients that report the same:

```text
ATS + site scope + control fingerprint + normalized failure + failed strategy version
```

join one recovery incident. Independent candidates can contribute strategy evidence without sharing answers.

Lifecycle:

```text
HUMAN_MATCHED
  -> PROVISIONAL_BACKUP
  -> VERIFIED_BACKUP
  -> PROVISIONAL_MAIN
  -> MAIN

Any stage -> COOLDOWN | DEGRADED | QUARANTINED | DEPRECATED
```

MVP random canary traffic is off. A provisional backup is tried only after earlier planned strategies fail, where the alternative is already human handoff. This is rescue validation, not a random experiment on an otherwise healthy application.

Direct and rescue outcomes are different populations and must never be compared as raw success percentages:

```text
MAIN runs directly on ordinary compatible controls.
BACKUP runs only on harder controls after an earlier failure.
```

Store `DIRECT`, `RESCUE` and `PROVISIONAL_DIRECT` evidence separately. A backup proven in rescue traffic becomes `PROVISIONAL_MAIN`, then must gather direct evidence before becoming `MAIN`.

Recommended starting gates, implemented as pure deterministic policy and kept configurable:

- Strong human match: deterministic signature score at least `0.90`, same pre-interaction behavior fingerprint, equivalent final representation, compatible packaged strategy and low-risk reversible control.
- Ambiguous match: at least two independent compatible demonstrations before it can enter a plan.
- `VERIFIED_BACKUP`: at least three automatic rescue successes across at least two independent runs and at least 80% eligible rescue outcomes.
- Main degraded: three consecutive confirmed direct failures across at least two runs, or at least five confirmed direct failures in the latest ten eligible direct outcomes.
- `PROVISIONAL_MAIN`: main is degraded and backup has at least five successes in at most six rescue attempts across at least three runs.
- `MAIN`: provisional strategy has at least four successes in its first five direct attempts.
- Roll back provisional main after at least two confirmed direct failures in its first five.
- Immediate quarantine: wrong field, wrong option, destructive action, consent/legal mutation, or a security/privacy violation.
- Unknown, takeover, dirty cleanup and navigation outcomes never count as confirmed failures.

Human similarity is discovery evidence, not automated success evidence. A user succeeding does not prove that the matched strategy will succeed. Use deterministic thresholds first. Logged direct and rescue traffic has selection bias, so advanced off-policy estimators may be evaluated later but cannot replace direct evidence. No AI runs inside the live fill loop.

## 8. Database design

### 8.1 Migration strategy

Add six ordered migrations without rewriting current records in place:

- `0013_candidate_answer_intelligence`
- `0014_representation_intelligence`
- `0015_repeatable_entity_binding`
- `0016_application_interaction_timeline`
- `0017_application_authorization_actions`
- `0018_strategy_registry_and_observation`

SQLite remains the local implementation. Represent JSON as validated text and partial uniqueness with supported indexes/triggers. The Supabase target uses `jsonb`, row-level security, server-side functions, and partial indexes. Repository interfaces should hide those storage differences.

### 8.2 Answer policy and versioned answers

```sql
create table canonical_answer_policies (
  canonical_key text primary key,
  answer_kind text not null,
  value_type text not null,
  question_family text not null,
  scope_policy text not null,
  scope_dimensions_json jsonb not null default '[]'::jsonb,
  reuse_policy text not null,
  learning_mode text not null,
  learning_presentation text not null,
  anomaly_profile text,
  autofill_mode text not null,
  authorization_mode text not null,
  freshness_profile text,
  dependency_keys_json jsonb not null default '[]'::jsonb,
  derivation_policy text not null,
  sensitivity text not null,
  risk_tier text not null,
  policy_version integer not null,
  updated_at timestamptz not null default now()
);

create table candidate_answer_versions (
  id uuid primary key,
  user_id uuid not null,
  canonical_key text not null,
  scope_kind text not null,
  scope_qualifiers_json jsonb not null default '{}'::jsonb,
  scope_hash text not null,
  scope_specificity integer not null default 0,
  value_json jsonb not null,
  normalized_hash text not null,
  source text not null,
  status text not null,
  evidence_score integer not null default 0,
  evidence_observations integer not null default 0,
  policy_version integer not null,
  confirmed_at timestamptz,
  valid_until timestamptz,
  supersedes_id uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now()
);

create unique index candidate_answer_one_active
  on candidate_answer_versions(user_id, canonical_key, scope_hash)
  where status = 'ACTIVE';

create index candidate_answer_bootstrap
  on candidate_answer_versions(user_id, status, canonical_key, scope_specificity desc);

create index candidate_answer_active_lookup
  on candidate_answer_versions(
    user_id, canonical_key, scope_hash, created_at desc
  )
  where status = 'ACTIVE';

create index candidate_answer_scope_qualifiers
  on candidate_answer_versions using gin(scope_qualifiers_json)
  where status = 'ACTIVE';
```

Do not overwrite the active row. In one transaction:

1. Lock or compare the current active row version.
2. Reject an idempotency key previously used with different parameters.
3. Mark the current row `SUPERSEDED`.
4. Insert the new active version with `supersedes_id`.
5. Write the application evidence/outbox event.
6. Commit.

This preserves history without storing unnecessary drafts or keystrokes.

### 8.3 Candidate answer change sets and reversible history

```sql
create table candidate_answer_change_sets (
  id uuid primary key,
  user_id uuid not null,
  application_id uuid,
  run_id uuid,
  checkpoint_kind text not null,
  checkpoint_revision integer not null,
  status text not null,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);

create table candidate_answer_change_items (
  id uuid primary key,
  change_set_id uuid not null,
  canonical_key text not null,
  scope_hash text not null,
  previous_version_id uuid,
  learned_version_id uuid not null,
  undo_version_id uuid,
  presentation_mode text not null,
  reason_codes_json jsonb not null default '[]'::jsonb,
  status text not null,
  created_at timestamptz not null default now(),
  unique(change_set_id, learned_version_id)
);
```

The learn transaction inserts/supersedes answer versions, change-set items and an outbox receipt atomically. Undo locks all active rows in deterministic canonical/scope order, verifies that every `learned_version_id` is still active, then creates restore/withdrawal events and versions. A conflict aborts `Undo all`; the UI can subsequently request explicit per-item restoration.

### 8.4 Representation rules and evidence

```sql
create table representation_rules (
  id uuid primary key,
  rule_key text not null,
  rule_version integer not null,
  canonical_key text not null,
  control_kind text not null,
  scope_kind text not null,
  scope_key text not null,
  transformer_key text not null,
  parameters_json jsonb not null default '{}'::jsonb,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(rule_key, rule_version, scope_kind, scope_key)
);

create index representation_rule_lookup
  on representation_rules(
    canonical_key, control_kind, scope_kind, scope_key, status
  );

create table representation_observations (
  id uuid primary key,
  rule_id uuid not null,
  run_id uuid not null,
  logical_field_id uuid not null,
  field_fingerprint text not null,
  form_family text,
  ats text,
  outcome text not null,
  alternative_rule_key text,
  truth_equivalent boolean,
  evidence_stage text not null,
  reason_codes_json jsonb not null default '[]'::jsonb,
  occurred_at timestamptz not null,
  unique(run_id, logical_field_id, rule_id, evidence_stage)
);
```

The shared observation contains rule IDs, scopes and outcome categories—not candidate values. Candidate-scoped representation preferences remain private learned context. A rollup keyed by `(rule_id, scope, evidence_stage)` tracks independent candidates/runs/forms and safety failures; promotion never scans raw observations in the fill path.

### 8.5 Repeatable entities, logical groups and bindings

```sql
create table candidate_entity_refs (
  id uuid primary key,
  user_id uuid not null,
  entity_type text not null,
  source_kind text not null,
  source_record_key text not null,
  status text not null,
  created_at timestamptz not null default now(),
  unique(user_id, entity_type, source_kind, source_record_key)
);

create table application_form_groups (
  id uuid primary key,
  run_id uuid not null,
  section_kind text not null,
  logical_group_key text not null,
  group_fingerprint text not null,
  current_generation integer not null,
  state text not null,
  created_at timestamptz not null default now(),
  unique(run_id, logical_group_key)
);

create table application_entity_bindings (
  id uuid primary key,
  run_id uuid not null,
  form_group_id uuid not null,
  candidate_entity_id uuid not null,
  binding_role text not null,
  binding_method text not null,
  binding_score numeric,
  runner_up_score numeric,
  binding_status text not null,
  binding_version integer not null,
  created_at timestamptz not null default now(),
  unique(run_id, form_group_id, binding_version)
);

create unique index application_entity_one_active_group
  on application_entity_bindings(run_id, form_group_id)
  where binding_status = 'ACTIVE';

create unique index application_entity_one_active_entity_per_section
  on application_entity_bindings(run_id, candidate_entity_id, binding_role)
  where binding_status = 'ACTIVE';
```

`binding_role` is a controlled value such as `EMPLOYMENT_HISTORY` or `RELEVANT_EXPERIENCE`. It allows the same entity in two legitimately different employer sections without permitting duplicate assignment inside one role. Never weaken uniqueness with arbitrary JSON. Bindings are candidate-private. Only value-free group/control fingerprints may contribute to shared interaction learning.

### 8.6 Compact learned context

```sql
create table candidate_learned_context (
  user_id uuid not null,
  context_type text not null,
  context_key text not null,
  scope_type text not null,
  scope_key text not null,
  score integer not null,
  observations integer not null,
  last_signal text not null,
  updated_at timestamptz not null,
  primary key (user_id, context_type, context_key, scope_type, scope_key)
);
```

Update with one atomic upsert and clamp in SQL. Do not store narrative values here.

### 8.7 Application authorization actions

Consent/attestation is not stored in `candidate_answer_versions`:

```sql
create table application_authorization_actions (
  id uuid primary key,
  user_id uuid not null,
  application_id uuid not null,
  run_id uuid not null,
  field_instance_id text not null,
  canonical_key text not null,
  action_kind text not null,
  required_state text not null,
  risk_tier text not null,
  statement_text_hash text not null,
  statement_snapshot_ciphertext text,
  linked_document_url text,
  linked_document_hash text,
  dependency_kind text not null,
  dependency_revision integer not null,
  application_content_revision integer not null,
  form_revision integer not null,
  status text not null,
  authorization_group_id uuid,
  gesture_receipt_json jsonb,
  authorized_at timestamptz,
  checked_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index application_authorization_field_revision
  on application_authorization_actions(
    application_id, field_instance_id, form_revision, statement_text_hash
  );
```

States:

```text
DISCOVERED -> QUEUED_FOR_REVIEW -> AUTHORIZED -> CHECKED -> READBACK_VERIFIED
                                     |              |
                                     +-> REVOKED    +-> STALE_AUTHORIZATION
```

The authorization command includes the exact item IDs and revisions displayed to the candidate. The backend/extension rejects a batch if any item changed. Candidate-private statement snapshots make the receipt auditable; they require encryption and a short, explicit retention policy and never enter shared telemetry. A global preference such as `PREPARE_STANDARD_DECLARATIONS = true` controls presentation only; it never grants consent to a future employer statement.

### 8.8 Durable browser state, logical fields and edit timelines

Extend or normalize the existing attempts/evidence tables with:

```text
application_runs
  id, user_id, application_id, state, state_version,
  active_page_generation, active_form_revision,
  extension_version, last_checkpoint_at, created_at, updated_at

application_field_states
  run_id, logical_field_id, field_instance_id, candidate_entity_id,
  form_group_id, control_fingerprint, control_generation,
  canonical_key, semantic_resolution_version,
  answer_version_id, contract_hash,
  owner, state, state_version, last_operation_id, updated_at

application_fill_operations
  id, run_id, logical_field_id, operation_id,
  answer_version_id, representation_rule_id,
  strategy_key, strategy_version,
  before_value_hash, intended_value_hash,
  immediate_readback_hash, stable_readback_hash,
  employer_validation, cleanup_outcome,
  page_generation, form_revision, control_generation,
  state, created_at, completed_at

application_field_revisions
  id, run_id, logical_field_id, revision_sequence,
  operation_id, edit_session_id, source, source_confidence,
  normalized_value_hash, private_value_payload_ciphertext,
  validity_state, page_generation, form_revision,
  control_generation, occurred_at

application_field_edit_sessions
  id, run_id, logical_field_id, session_sequence,
  starting_revision_id, final_revision_id,
  state, local_commit_at, checkpoint_kind,
  checkpoint_revision, started_at, completed_at

application_field_learning_classifications
  id, run_id, logical_field_id, edit_session_id,
  classifier_version, semantic_outcome, answer_outcome,
  representation_outcome, strategy_outcome,
  acceptance_outcome, reason_codes_json, created_at

application_operation_events
  event_id, run_id, field_instance_id, operation_id,
  strategy_key, strategy_version, evidence_stage,
  execution_context, outcome, normalized_error, cleanup_outcome,
  structural_evidence_json,
  page_generation, form_revision, occurred_at
```

Add unique indexes:

```text
(run_id, operation_id)
(run_id, field_instance_id, state_version)
(run_id, logical_field_id, revision_sequence)
(run_id, logical_field_id, session_sequence)
(run_id, edit_session_id, classifier_version)
```

Field revisions are candidate-private and retention-limited. Most audit rows need only a normalized hash; a temporary encrypted value payload is allowed only when policy requires it to complete a pending answer promotion. Never retain keystrokes or intermediate narrative text. Never store raw candidate values, free text, resume text, access tokens, or sensitive DOM snippets in shared operation telemetry. Retain only normalized categories, hashes, bounded lengths, control roles, and redacted structural evidence. Operation mutation journals remain local and ephemeral; after a crash, rescan/reconcile instead of replaying an old cleanup journal.

### 8.9 Packaged strategy registry and human observation

```sql
create table extension_strategy_catalog (
  strategy_key text not null,
  strategy_version integer not null,
  min_extension_version text not null,
  max_extension_version text,
  control_kinds jsonb not null,
  parameter_schema jsonb not null,
  status text not null,
  primary key (strategy_key, strategy_version)
);

create table automation_strategy_variants (
  id uuid primary key,
  strategy_key text not null,
  strategy_version integer not null,
  ats text not null,
  site_scope text not null,
  control_fingerprint text not null,
  applicability_json jsonb not null,
  parameters_json jsonb not null,
  status text not null,
  rollout_percentage integer not null default 0,
  registry_version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index strategy_pack_lookup
  on automation_strategy_variants(
    ats, site_scope, control_fingerprint, status, registry_version
  );
```

`parameters_json` must validate against the packaged catalog schema. It cannot contain code, arbitrary commands, or open-ended selectors outside approved forms.

Strategy plans are sparse and versioned:

```text
field_strategy_plan_versions
  id, behavior_profile_id, plan_version, status,
  created_reason, created_at

field_strategy_plan_entries
  plan_id, slot, variant_id, plan_role,
  evidence_snapshot_json

unique(plan_id, slot)
unique(plan_id, variant_id)
check(slot between 1 and 3)
```

Zero entries is valid and means immediate handoff. Never insert weak entries simply to fill all three slots.

Human demonstrations are compact, scoped and value-free:

```text
human_interaction_demonstrations
  id, run_id, field_instance_id, behavior_profile_id,
  pre_behavior_fingerprint, post_behavior_fingerprint,
  field_generation, demonstration_type,
  normalized_trace_json, final_equivalence,
  employer_acceptance, privacy_eligibility,
  extension_version, created_at

strategy_trace_matches
  demonstration_id, strategy_key, strategy_version,
  deterministic_score, ai_assist_used,
  match_status, reason_codes_json, created_at
```

`demonstration_type` is `INTERACTION_ONLY`, `ANSWER_CORRECTION`, `MIXED`, `PREFILL_OR_UNKNOWN` or `INELIGIBLE`. Only `INTERACTION_ONLY` with equivalent final representation, clean handoff and compatible fingerprints can create a provisional backup.

Evidence tables:

```text
strategy_observations
  id, variant_id, run_id, application_hash, site_hash,
  field_fingerprint, execution_context, evidence_stage, outcome,
  normalized_error, cleanup_outcome, extension_version, occurred_at

strategy_rollups
  variant_id, applicability_bucket, execution_context, eligible_attempts,
  successes, failures, unknowns, independent_applications,
  independent_users, independent_sites, lower_confidence_bound,
  last_success_at, last_failure_at, updated_at

recovery_incidents
  incident_key, ats, site_scope, control_fingerprint,
  failed_strategy_key, failure_signature, status,
  first_seen_at, last_seen_at, affected_runs

strategy_proposals
  id, incident_key, proposed_packaged_key_or_test_recipe,
  evidence_summary_json, status, admin_notes, created_at
```

`strategy_proposals` is a control-plane/admin object. A test recipe never reaches production unless it becomes packaged code in a released extension.

### 8.10 Idempotency and outbox

```text
idempotency_requests
  actor_id, operation_type, idempotency_key,
  request_hash, response_json, created_at, expires_at

outbox_events
  id, aggregate_type, aggregate_id, event_type,
  payload_json, status, attempt_count, available_at, created_at
```

The idempotency record and business mutation commit in the same transaction. A reused key with a different request hash is rejected. Workers claim outbox rows with `FOR UPDATE SKIP LOCKED` in PostgreSQL; SQLite uses a short transaction and a claimed status.

## 9. API and query design

### 9.1 One application bootstrap

```http
POST /api/extension/v2/applications/:applicationId/bootstrap
```

Input:

```json
{
  "runId": "...",
  "pageUrl": "...",
  "pageGeneration": 2,
  "formRevision": 7,
  "extensionVersion": "...",
  "fields": [
    {
      "fieldInstanceId": "...",
      "semanticFingerprint": "...",
      "controlFingerprint": "...",
      "contractSummary": {}
    }
  ]
}
```

Return in one response:

- job/application context,
- canonical resolutions and answer-policy versions,
- active candidate answers selected by scope,
- relevant compact learned context,
- field representations or `needsUser`,
- representation rule/version and logical field/entity/group bindings,
- sparse packaged strategy plans,
- pending application actions and their authorization modes,
- policy and registry versions,
- prior durable field/edit-session states for reconciliation.

The server should execute a handful of indexed queries or one controlled RPC, not one query per field. Candidate answer selection can use a `VALUES` list of requested canonicals and a scope-rank expression, returning the first active compatible row per canonical.

### 9.2 Checkpoint acceptance and correction classification

```http
POST /api/extension/v2/runs/:runId/checkpoints
Idempotency-Key: <runId>:<checkpointKind>:<formRevision>
```

The request contains the page/form revision, checkpoint kind/receipt, and final logical-field revision IDs—not raw event streams. In one candidate-private transaction, the server:

1. Rejects stale run/form generations.
2. Marks eligible edit sessions `CHECKPOINT_ACCEPTED`.
3. Runs the versioned correction classifier against operations, revisions, representation rules and employer validation.
4. Creates candidate-answer/representation/strategy evidence in their separate ledgers.
5. Applies only policy-eligible answer changes, grouped in one answer change set.
6. Emits the post-application summary through the response/outbox.

Classification is deterministic in MVP. An AI may later review ambiguous **semantic** cases asynchronously, but ambiguity never blocks the current form and never changes candidate truth or live strategy automatically.

### 9.3 Answer promotion command

```http
POST /api/extension/v2/candidate-answers/confirm
Idempotency-Key: <runId>:<fieldId>:<revision>
```

The command includes the expected active answer version and an accepted edit-session/classification receipt, or an explicit candidate profile action. The server validates policy, scope, normalized value, source, checkpoint, anomaly gates and version inside one transaction. A stale version returns a conflict with the current safe value; the UI asks the candidate to choose.

### 9.4 Learning-summary Undo

```http
POST /api/extension/v2/candidate-answer-change-sets/:changeSetId/undo
Idempotency-Key: <userId>:<changeSetId>:undo
```

The default request is all-or-nothing. It succeeds only when every learned version remains active, creates restoration/withdrawal history, and returns the new answer versions. `409 ANSWER_UNDO_CONFLICT` returns the conflicting items for explicit per-item review. It never calls the extension or mutates the employer form.

### 9.5 Telemetry batch

```http
POST /api/extension/v2/runs/:runId/events:batch
```

Batch 20–100 compact events, or flush after approximately two seconds, page transition, review, or tab close. Each event carries a stable event ID so retries are deduplicated. Telemetry is non-blocking; failure to upload cannot trigger a second DOM action.

An eligible human handoff contributes one `HANDOFF_DEMONSTRATION` event after local normalization. The server revalidates eligibility, extension/catalog versions, trace schema, fingerprint continuity and final equivalence before inserting a demonstration. Raw key/input data is rejected rather than merely ignored.

### 9.6 Strategy-pack selection

Filter server-side by:

```text
extension version
ATS and site scope
exact/control-family fingerprint
control kind
strategy status
kill switch
deterministic rollout bucket
```

Return the current sparse plan: zero to three packaged strategy entries. There is no random MVP canary and no requirement to return three entries. Cache the pack by `(registryVersion, extensionVersion, ATS, siteScope)` in extension storage, then apply exact fingerprint lookup locally.

### 9.7 Application authorization command

```http
POST /api/extension/v2/applications/:applicationId/authorizations/confirm
Idempotency-Key: <runId>:<authorizationGroupId>:<contentRevision>
```

The request contains the exact action IDs, statement/document hashes, required/optional states, risk tiers, dependency kinds/revisions, application content revision, form revisions, review-surface version and candidate gesture receipt displayed to the candidate. The server atomically authorizes the compatible eligible set or rejects the entire stale batch. It returns short-lived authorization tokens bound to those fields/revisions; the interaction engine must present a token before a protected strategy may check a control.

High-impact `PER_ITEM`, optional-choice and unknown actions cannot be included in a normal batch. Submission and security challenges never receive authorization tokens. An `ATS_PREFILLED` or `USER_OWNED` control receives no Copilot check token; its review receipt is tracked separately.

### 9.8 Candidate answer selection query

For a bootstrap containing tens of canonicals, one indexed query can select the most-specific compatible active answer:

```sql
select distinct on (a.canonical_key)
  a.id,
  a.canonical_key,
  a.scope_kind,
  a.scope_qualifiers_json,
  a.value_json,
  a.confirmed_at,
  a.valid_until,
  a.row_version
from candidate_answer_versions a
where a.user_id = $1
  and a.status = 'ACTIVE'
  and a.canonical_key = any($2::text[])
  and a.scope_qualifiers_json <@ $3::jsonb
order by
  a.canonical_key,
  a.scope_specificity desc,
  a.created_at desc;
```

`$3` is a validated application context containing only policy-approved dimensions such as application, company group, role family, location, country and employment type. Each stored qualifier must be contained in the current context. `scope_specificity` is derived server-side from the controlled qualifier set, never accepted from the client. Join policy rows for only `$2`, then apply freshness/reuse rules in the answer engine. Do not hide expiry inside SQL; returning `valid_until` keeps the decision explainable and testable.

### 9.9 Atomic answer replacement

The Supabase/PostgreSQL target should expose a security-definer function callable only through the authenticated API. Its logical transaction is:

```sql
begin;

select id, row_version
from candidate_answer_versions
where user_id = $1
  and canonical_key = $2
  and scope_hash = $3
  and status = 'ACTIVE'
for update;

-- Reject when the expected row/version does not match.

update candidate_answer_versions
set status = 'SUPERSEDED'
where user_id = $1
  and canonical_key = $2
  and scope_hash = $3
  and status = 'ACTIVE';

insert into candidate_answer_versions (...)
values (...);

insert into outbox_events (...)
values (...);

commit;
```

At `READ COMMITTED`, the row lock plus partial unique index protects the common case. The function must translate a unique conflict or stale expected version into a deterministic `409 ANSWER_VERSION_CONFLICT`; clients do not retry it as if it were a network failure.

### 9.10 Strategy-pack query

```sql
select
  v.id,
  v.strategy_key,
  v.strategy_version,
  v.control_fingerprint,
  v.applicability_json,
  v.parameters_json,
  v.status,
  v.rollout_percentage
from automation_strategy_variants v
join extension_strategy_catalog c
  on c.strategy_key = v.strategy_key
 and c.strategy_version = v.strategy_version
where v.ats = $1
  and v.site_scope in ($2, '*')
  and v.control_fingerprint = any($3::text[])
  and v.status in ('MAIN', 'PROVISIONAL_MAIN', 'VERIFIED_BACKUP', 'PROVISIONAL_BACKUP')
  and c.status = 'ACTIVE'
  and c.min_extension_version <= $4
  and (c.max_extension_version is null or c.max_extension_version >= $4)
order by
  case when v.site_scope = $2 then 0 else 1 end,
  case v.status
    when 'MAIN' then 0
    when 'PROVISIONAL_MAIN' then 1
    when 'VERIFIED_BACKUP' then 2
    else 3
  end,
  v.updated_at desc;
```

Use a proper comparable extension build/version column in production rather than relying on lexical semantic-version comparison. Deterministic cohort assignment is computed as a stable hash of `(user_id, variant_id, rollout_epoch)`; it is not `random()` on each request.

### 9.11 Idempotent telemetry ingestion and rollup

Insert a batch with `on conflict (run_id, operation_id) do nothing`. The API first validates that each event belongs to the authenticated candidate/run, then derives a redacted shared observation. Candidate-private events and shared strategy observations are separate writes in the same transaction or through an outbox event.

A rollup worker claims bounded outbox work:

```sql
select id
from outbox_events
where status = 'PENDING'
  and available_at <= now()
order by created_at
for update skip locked
limit 200;
```

It upserts counters by `(variant_id, applicability_bucket, execution_context)`. Promotion reads these small rollup rows and independent-user/application/site counts; it never scans all raw observations in the user request path.

### 9.12 Supabase row-level policies

Candidate tables require RLS and user ownership:

```sql
alter table candidate_answer_versions enable row level security;

create policy candidate_reads_own_answer_versions
on candidate_answer_versions
for select
using ((select auth.uid()) = user_id);
```

Candidate mutations should still go through constrained functions/API validation rather than granting arbitrary client insert/update. Shared registry tables may expose a read-only view/RPC containing only the strategy pack; extension telemetry writes through the backend, never directly with a service-role token.

## 10. Runtime performance and storage

Recommended budgets, measured before being treated as guarantees:

- Initial local scan of a normal page: target under 50 ms of main-thread work, chunked when larger.
- Bootstrap API: target p95 under 250 ms in the chosen region.
- Cached answer/strategy lookup after bootstrap: synchronous in-memory/session lookup.
- Native field operation: usually 50–300 ms including actionability/readback.
- Dynamic combobox or section reveal: allow 300 ms–2 s with mutation-driven completion, not fixed sleeps.
- Telemetry: never blocks filling.

Optimization rules:

- Build one in-memory application session context after bootstrap.
- Cache policy/catalog versions using `chrome.storage`; never rely on service-worker globals surviving. Keep active tab/run/edit-session checkpoints in `chrome.storage.session`, and persist resumable summaries to `chrome.storage.local`/backend only at bounded checkpoints.
- Use a MutationObserver to invalidate only affected graph regions, then debounce and batch scans.
- Coalesce noisy input/activity events locally; persist revision boundaries and hashes, not each character. Flush immediately on page transition, accepted checkpoint, authorization gesture and tab lifecycle signals when available.
- Compute repeatable-group assignment in memory; typical `N` is small. The one-to-one assignment prevents duplicate bindings without a database query per group.
- Keep active-answer and strategy-pack indexes narrow and selective.
- Store hashes and bounded structural summaries instead of raw DOM.
- Precompute strategy rollups asynchronously; never aggregate all observations when a user opens a form.
- Partition/retain append-only telemetry by time in PostgreSQL when volume warrants it.
- Do not add Redis until concurrent workers or cross-instance coordination prove it necessary. Redis must remain an optimization, never a correctness dependency.

## 11. Edge-case policy

The implementation and fixtures must cover at least these cases:

### Page and lifecycle

- SPA route changes without navigation.
- Full navigation while an operation is awaiting a popup.
- Back/forward restoring an older DOM.
- Browser service worker suspension and restart.
- Tab close during fill, after readback, or before telemetry flush.
- Duplicate bootstrap or event delivery.
- Multiple application tabs for the same job.
- Same logical field is edited in two tabs/devices before either learning summary is committed.
- Candidate changes a field, moves elsewhere, returns and changes it again before the checkpoint.
- Candidate starts changing a field, blurs it, then closes the application before completing the value.
- Service worker suspends between local edit commit and backend checkpoint receipt.
- Stale extension version receiving a registry entry it cannot execute.
- Application content changes after the candidate authorized an accuracy certification.
- A multi-page form requires a declaration before it will reveal the next page.

### DOM and controls

- React/Vue controlled inputs that revert direct value assignment.
- Shadow roots, same-origin iframes, and inaccessible cross-origin iframes.
- Virtualized listboxes where options are not all mounted.
- Editable and select-only ARIA comboboxes.
- Portaled popups outside the field container.
- Masks that display one value but submit another.
- Locale-specific dates, decimal separators, currency periods, and Indian phone/currency formats.
- Duplicate labels, hidden template fields, and repeated groups with reordered indices.
- Two experience entities share the same employer/title but have different dates; binding margin is too small.
- Employer prepopulates repeatable groups in a different order from the candidate profile.
- Candidate deletes, re-adds or drags a repeatable group while Copilot is active.
- Blank repeatable group rerenders with new DOM IDs after every keystroke.
- Candidate changes a bound experience group into a different profile entity.
- Disabled/read-only controls that become enabled conditionally.
- CAPTCHA, OTP, assessments, camera/microphone, and signature controls: block and ask the user.
- File upload widgets with hidden inputs, receipts, size/type errors, and duplicate uploads.
- Failed strategy opens a popup, partially types or triggers autosave; cleanup cannot prove a clean baseline.
- Password-manager/browser/ATS prefill appears without a trustworthy manual event sequence.
- Paste, voice input, accessibility tooling and mobile/touch input differ from keyboard traces.
- IME composition emits multiple intermediate input events; learn only after composition commit.
- One popup/listbox is shared by multiple controls and focus changes during selection.
- Rich text/contenteditable editors mutate internal DOM without a stable submitted value.

### Candidate truth and policy

- Two devices update the same global answer concurrently.
- Candidate edits a field while Copilot is waiting for options.
- Same canonical has a global value and a company-specific exception.
- Mutated fact has expired but is still the best known suggestion.
- Job asks current CTC in monthly form while truth is annual.
- Job asks completed years while truth is stored in months; user preference must not be mistaken for employer-required rounding.
- Original and corrected representations are both employer-valid, so only candidate preference—not shared representation evidence—is learned.
- Representation rule converts currency/period incorrectly but the control accepts the number; semantic validation must still quarantine it.
- Answer does not fit an available option.
- A sensitive field resembles an ordinary yes/no question.
- The candidate changes a generated narrative but not its factual content.
- The candidate submits after manually clearing an auto-filled value.
- Work authorization differs by country, visa/status type, expiry and “now versus future” sponsorship wording.
- `PREVIOUSLY_EMPLOYED_BY_COMPANY` or `RELATIVE_AT_COMPANY` must match the employer's normalized legal entity/parent group.
- “Government employee” includes different time windows, relatives and definitions across employers.
- Non-compete/conflict questions depend on employer, geography, dates and exact wording; a global yes/no is insufficient.
- Age-threshold facts may change once and should not require retaining date of birth when the threshold answer is enough.
- Optional demographic/self-identification answers remain voluntary and jurisdiction-specific.
- Two equally specific context overrides conflict; the resolver must ask rather than choose by recency alone.
- Consent statement or linked policy changes after it was displayed but before Copilot checks it.
- Candidate revokes/unchecks a declaration; Copilot must not repair it.
- Employer prechecks an ordinary or high-impact declaration; this is not candidate authorization.
- Accuracy certification is confirmed and then another application field changes, invalidating only certifications dependent on application content.
- Linked policy URL remains the same but content changes; inaccessible document identity forces direct/review handling.
- Mandatory and optional declarations appear visually in one group; optional items must remain a neutral separate choice.
- Background check, arbitration, biometric or marketing consent is accidentally grouped with ordinary acknowledgements.

### Learning and rollout

- Three candidates independently discover two working bundled strategies and one failed variant.
- One tenant-specific form regresses while the ATS-wide strategy remains healthy.
- A provisional rescue succeeds in DOM readback but employer validation later rejects it.
- User takeover or navigation arrives between action and verification.
- Telemetry is malicious, duplicated, reordered, or from an unsupported extension version.
- Low-volume forms never reach promotion thresholds.
- A form changes back to a previous fingerprint.
- Human succeeds with a different answer, so the trace is an answer correction rather than interaction evidence.
- Human succeeds only because the failed strategy left the control dirty.
- `USER_CORRECTED` arrives without a pre-edit revision or stable operation receipt; classification remains unknown.
- Candidate edits and ultimately restores the Copilot value; answer evidence is one kept signal, not multiple corrections.
- Dependency logic clears a field after another answer changes; do not blame the candidate or strategy.
- A learning-summary Undo races with a newer answer version from another tab.
- A demonstrated strategy matches structurally but is unavailable in the installed extension version.
- Rescue performance looks lower than direct performance because it receives only difficult cases.
- Repeated traces come from the same candidate/run or a hostile site attempts to poison shared learning.

## 12. Security, privacy, and compliance design

- Enable Supabase row-level security on every exposed candidate/application table.
- Candidate policy is `auth.uid() = user_id`; shared control-plane writes go only through the authenticated backend/service role.
- The extension never receives another candidate's answer or evidence.
- Logs and telemetry exclude raw values, free text, resume content, tokens, passwords, OTPs, government identifiers, health/demographic answers, and complete DOM snippets.
- Human observation is disclosed as a user-facing feature, opt-out is available, and observation is limited to the handed-off control; Chrome classifies page/form/browsing content as user data even when processed locally.
- Do not collect or persist application traces from incognito sessions.
- Treat all DOM labels, URLs, and telemetry as untrusted input. Bound length, validate enums, strip markup, and rate-limit.
- Treat DOM text as prompt-injection data. AI can classify a bounded structural schema or produce an offline admin proposal, never decide live execution from raw employer instructions.
- Use keyed, rotating hashes for application/site correlation; plain hashes of predictable URLs are reversible by dictionary attack.
- Require independent authenticated runs/users and scope-first promotion before shared strategy evidence affects more users.
- Encrypt sensitive stored values at the application layer where required; do not rely on RLS alone.
- Define retention separately for candidate answers, application audit, raw snapshots, and shared aggregates.
- Provide correction, export, withdrawal, and deletion paths before cloud launch.
- Clearly disclose policy-based answer learning and provide per-answer history/undo. Application authorization remains separate from permission to learn reusable answers.
- Capture plain-language, itemized, application-specific affirmative authorization for declarations. Withdrawal must be as easy as granting it.

India's DPDP Act and staged 2025 Rules make privacy-by-design the safe engineering choice now even though different provisions have different commencement dates. This document is an engineering plan, not legal advice; production notices and retention policy should be reviewed by Indian privacy counsel.

## 13. Current-code integration and rollout plan

Do not build a parallel runtime. Extend these current seams:

`Form A`, `Form B`, and named live-miss pages are certification/regression fixtures only. They exercise the same scanner -> semantics -> candidate truth -> representation -> strategy -> verifier path as a real employer form. Production code must never choose a resolver or fill engine from a fixture/form-variant label. `formAGate` is allowed only as an offline/control-plane promotion gate over owned fixtures.

- `src/services/fieldCanonicalizer.js` and `src/repositories/fieldSemanticRepository.js` remain Part 1.
- `src/services/questionResolver.js` becomes a thin facade over a new `answerPolicyRegistry`, `candidateAnswerService`, and representation service. Remove hard-coded volatility/review decisions only after policy parity tests pass.
- `src/repositories/candidateFactRepository.js` currently supports a handful of hard-coded facts and overwrites by upsert. Keep a compatibility adapter while moving writes to append-only `candidate_answer_versions`.
- `src/services/reviewReleasePolicy.js` currently classifies by broad regex. Retain regex as a fail-closed fallback, but prefer the resolved canonical policy. Add `APPLICATION_ACTION` and authorization-token decisions.
- `src/services/applicationAnswerer.js` and `src/services/sidePanelAssistant.js` must continue refusing AI for legal facts/actions. Legal factual reuse is deterministic candidate memory, not AI inference.
- `extension/content.js` currently spreads ownership across `userEditedFieldIds`, `userActiveFieldIds`, and `programmaticChangeElements`. Move their behavior behind `extension/interaction/ownership.js` without changing external behavior first.
- `src/adapters/fillOutcomes.js` currently maps `USER_CORRECTED` to mapping success. Remove that mapping in the first implementation slice. It should emit a neutral observation/event; `fieldLearningClassifier` alone derives semantic, answer, representation and strategy outcomes after a checkpoint.
- `extension/adapters/runtime.js` remains the adapter/config boundary. Wrap it with a packaged `strategyRegistry` and `InteractionEngine`; do not replace portal packs.
- Adapter `neverFill` lists currently include legal/consent. Keep the hard deny by default. A protected application action may bypass it only with a matching canonical policy, fresh application-authorization token and trusted one-shot strategy.
- `extension/adapters/common/repeatables.js` is the first implementation to migrate behind the common Form Planner and stable entity binder. ATS-specific discovery stays in adapters; entity assignment and logical group identity are shared primitives.
- `src/routes/extension.js` remains the authenticated API boundary but delegates bootstrap, answer versioning, authorization, evidence and plan selection to separate services.
- Existing `application_operation_events`, `application_field_evidence`, `mapping_packs`, `mapping_proposals` and `adapter_incidents` are extended. Interaction strategy proposals stay separate from semantic mapping proposals.
- `src/services/learnProposer.js` continues semantic/selector proposal work. Add an interaction proposal service that can select packaged strategies or generate an offline code/test plan for admin review.
- `extension/sidepanel.js` separates “allow reusable answer learning” from “confirm these application declarations”; the current generic consent wording cannot represent both.

Before Phase 2D or additional Part 3 behavior, perform a behavior-preserving extension decomposition. Move DOM descriptor construction, ownership, execution, verification, telemetry, and orchestration behind `extension/runtime/` modules; move background routing, session state, API transport, and outbox transport behind `extension/runtime/background/`. Keep `content.js` and `background.js` as bootstrap/lifecycle entry points. Extraction must not introduce new strategies, protocol shapes, or learning rules.

Recommended module additions:

```text
src/contracts/fieldAnswerContract.js
src/services/answerPolicyRegistry.js
src/services/candidateAnswerService.js
src/services/candidateAnswerChangeSetService.js
src/services/representationRegistry.js
src/services/representationResolver.js
src/services/representationPromotionPolicy.js
src/services/repeatableEntityBindingService.js
src/services/fieldLearningClassifier.js
src/services/applicationAuthorizationService.js
src/services/interactionPlanService.js
src/services/interactionTraceMatcher.js
src/services/interactionPromotionPolicy.js
src/repositories/candidateAnswerRepository.js
src/repositories/representationRepository.js
src/repositories/applicationTimelineRepository.js
src/repositories/interactionRepository.js
src/workers/interactionLearningWorker.js

extension/interaction/engine.js
extension/interaction/logicalFieldRegistry.js
extension/interaction/editSessionTracker.js
extension/interaction/revisionRecorder.js
extension/interaction/repeatableBinder.js
extension/interaction/strategyRegistry.js
extension/interaction/ownership.js
extension/interaction/verifier.js
extension/interaction/mutationJournal.js
extension/interaction/humanObserver.js
extension/interaction/traceNormalizer.js
extension/interaction/checkpointStore.js
```

### Phase 0 — Correction-safety foundation (must ship first)

- Remove the direct `USER_CORRECTED -> mapping success` conversion.
- Add stable operation IDs, logical field IDs, pre-operation value hashes, immediate/stable readbacks, employer-validation receipts and source attribution.
- Add append-only revision/edit-session events and the versioned classifier contract with every learning feature flag off.
- Treat missing baseline, takeover, dependency mutation, navigation and interrupted sessions as `UNKNOWN`.
- Add replay tests for the four-layer failure matrix before producing any `+1/-2` evidence.

Exit gate: one candidate edit can no longer train semantic, answer, representation or strategy evidence without an accepted checkpoint and explicit classifier result.

### Phase 2A — Canonical answer policy registry

- Centralize answer kind, controlled scopes, dependencies, freshness, risk, learning, reuse, authorization and presentation mode.
- Seed policy rows for the currently supported canonicals and keep broad regexes as fail-closed fallback.
- Add exhaustive policy-matrix tests.

Exit gate: the resolver can explain why an answer is auto, prominent, review-to-save, application-only, direct, or never.

### Phase 2B — Versioned candidate truth and reversible change sets

- Add append-only scoped answer versions, the single-active invariant, expected-version conflicts and dependency invalidation.
- Add application learning change sets and atomic Undo/restore history.
- Migrate only safe existing facts; keep old tables behind a read compatibility adapter.
- Add concurrency, idempotency and Undo-conflict tests in SQLite and PostgreSQL-compatible SQL.

Exit gate: source, scope, freshness, version history and reversal are deterministic; no update destroys the previous truth.

### Phase 3A — Field revision and edit-session timeline

- Complete the Phase 0 event skeleton with edit-session grouping, local commit, resume, checkpoint and abandon states.
- Implement source attribution for Copilot, user, ATS/browser prefill, dependency/page script and unknown.
- Implement the independent semantic/answer/representation/strategy/acceptance classifier.
- Persist bounded resumable session metadata in extension storage; reconcile after service-worker restart.

Exit gate: change → leave → return → change, and partial edit → close, produce the correct single checkpoint outcome or neutral unknown.

### Phase 2C — Policy-based automatic learning and UX

- Enable checkpoint-driven candidate-answer promotion only for eligible policy/classifier combinations.
- Build the post-application “updated for next time” summary, prominent anomaly block, Review, Undo and persistent answer history.
- Add deterministic anomaly gates and replace exact narrative retention with compact style signals.
- Enable the simple `+1 kept / -2 corrected` score only on final accepted revisions.
- A page advance or review checkpoint may retain a candidate-private proposal and strengthen runtime acceptance evidence, but cannot commit reusable candidate truth. Only verified submission or candidate explicit Save may finalize learning.

Exit gate: low-risk known facts improve the next application without per-field prompts; unfinished/ambiguous edits never enter reusable memory and every automatic change is understandable/reversible.

### Phase 0G — Extension production-path consolidation

- Freeze the current behavior with Form A/Form B, live-miss, protocol, privacy, ownership and Part 2C learning-loop fixtures.
- Extract scanner, ownership, executor, verifier, telemetry and a small orchestrator without behavior changes.
- Extract background message routing, session storage, API transport and durable outbox transport without changing envelopes.
- Keep adapters behind the extracted interfaces and prove that all fixtures traverse the same production runtime.
- Do not start representation or recovery-strategy behavior until this extraction passes the complete Node 24 acceptance gate.

Exit gate: user takeover has one owner, execution cannot verify itself, telemetry cannot control the form, entry files are bootstraps, and no Form A/Form B runtime decision exists.

### Phase 2D — Representation Resolution & Learning

- Expand `FieldAnswerContract` with packaged rule/version/scope and normalized truth provenance.
- Add pure packaged phone/date/money/duration/option transforms and field-level validation.
- Add the representation evidence/rollup registry, candidate preference distinction, scope-first promotion and quarantine gates.
- Add property tests and Indian locale fixtures, including months/years and annual/monthly LPA conversions.

Exit gate: the system can explain whether a correction changed truth, formatting, preference or browser operation; no representation correction silently rewrites candidate truth.

### Phase 2E + Phase 3C — Stable repeatable binding and general form graph

- Assign stable UUIDs to candidate experience/education/project/certification entities.
- Add logical form groups, maximum-weight one-to-one binding, confidence margins and compact ambiguity review.
- Generalize current SmartRecruiters repeatables into shared `ensure count`, conditional reveal, add/remove/reorder and rerender reconciliation.
- Preserve ATS-specific discovery in adapters and shared identity/orchestration in common primitives.

Exit gate: repeated entities remain correctly bound across add, reorder, rerender, user edit and resume in at least two independent DOM families.

### Phase 2F — Grouped declaration and authorization UX

- Add action categories, required/optional status, exact statement/document receipts and dependency-specific invalidation.
- Build grouped eligible review plus inline review for navigation-blocking forms.
- Keep optional choices neutral, high-impact items separate/direct, prefilled/manual items user-owned and submit user-controlled.
- Add revocation and inaccessible-document behavior.

Exit gate: no application action becomes reusable candidate truth and no protected control is checked without a fresh, exact, affirmative authorization receipt.

### Phase 3B — Durable orchestration, ownership and idempotency

- Consolidate run/page/form/control generations, ownership leases, cancellation tokens and checkpoint reconciliation around the 3A timeline.
- Make all commands/events idempotent and prevent stale retries or cleanup after takeover.
- Add duplicate delivery, reload, multi-tab and offline/resume tests.

Exit gate: tab close, reload, duplicate delivery and manual typing cannot repeat a destructive action or overwrite the candidate.

### Phase 3D — Packaged strategy registry

- Define the extension catalog and strict parameter schemas.
- Add sparse versioned plans, pack selection, cache, version checks and kill switches.
- Normalize actionability, readback, validation and `prepare -> execute -> verify -> cleanup` across existing strategies.
- Ensure production cannot interpret remote code or an open-ended DSL.

Exit gate: one bulk pack is fetched, field actions run locally, dirty cleanup hands off, and unknown strategy keys fail closed.

### Phase 3E — Human-observed recovery and evidence

- Batch sanitized operation evidence and add bounded, opt-in handoff observation.
- Deterministically match value-free traces to packaged strategies; AI remains an optional offline selector/advisor.
- Add incident clustering, replay fixtures, asynchronous rollups, admin views and scope-first promotion/rollback.
- Keep direct, rescue and provisional-direct populations separate.

Exit gate: two successful alternatives and one failed alternative aggregate correctly without contaminating candidate answers, representation evidence or global rollout.

### Phase 3F — Optional measured optimization

- Add conservative ranking within already-safe strategies and change-point detection for UI regressions.
- Add Redis only when measured contention or cross-instance coordination justifies it.
- Evaluate richer edit-signal classification only after privacy and product evidence justify it.

## 14. Required test suites

- Policy matrix tests for answer kind, reuse, composite scope, freshness, dependencies, learning, authorization and risk combinations.
- Transaction tests for active answer uniqueness, idempotency, stale versions, and concurrent updates.
- Answer change-set tests for atomic Undo, first-value withdrawal, restore version creation and newer-version conflicts.
- Authorization tests for grouping, per-item exclusions, stale text/content revisions, revocation and navigation-blocking declarations.
- Field-contract property tests for dates, phone, money, length, pattern, options, and locale.
- Representation classifier tests separating truth correction, invalid representation, valid user preference, strategy failure and unknown.
- Representation promotion tests for exact/form-family/ATS widening, independence counts and immediate quarantine.
- Browser fixture tests for every packaged strategy and failure code.
- Prepare/execute/verify/cleanup tests proving a dirty or unknown cleanup prevents the next strategy.
- Mutation-race tests for rerender, page generation, form revision, and detached controls.
- User-takeover tests at every evidence stage.
- Edit-timeline tests for multiple visits, final restoration, incomplete blur, dependency mutation, IME, page checkpoint, close and service-worker restart.
- Semantic-evidence tests proving answer correction never degrades Part 1 without independent semantic rejection evidence.
- Human-observer tests for IME, paste, accessibility events, ATS/browser prefill, equivalent/different answers and value-free trace output.
- Dynamic section graph tests for add/remove/reorder and conditional branches.
- Repeatable-binding assignment tests for duplicate employers, ambiguous margins, reordered prefill, deletion, rerender and user-created entities.
- Replay tests from sanitized structural snapshots.
- Rescue/provisional-main simulation and rollback tests with direct/rescue and success/failure/unknown separation.
- Privacy snapshot tests proving values/free text never appear in shared telemetry.
- Manifest V3 build audit proving no remote executable logic or remote interpreter path exists.

## 15. Research basis

This design uses the following primary or authoritative sources:

- Chrome extension service-worker lifecycle and persistence: <https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle>
- Chrome extension storage behavior, quotas and access boundaries: <https://developer.chrome.com/docs/extensions/reference/api/storage>
- Chrome content-script isolation: <https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts>
- Chrome Manifest V3 remote-hosted-code policy: <https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code> and <https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements>
- Chrome Web Store user-data disclosure and limited-use policy: <https://developer.chrome.com/docs/webstore/user_data> and <https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements>
- W3C ARIA combobox/listbox interaction patterns: <https://www.w3.org/WAI/ARIA/apg/patterns/combobox/> and <https://www.w3.org/WAI/ARIA/apg/patterns/listbox/>
- W3C UI/input event and composition semantics: <https://www.w3.org/TR/uievents/> and <https://www.w3.org/TR/input-events-2/>
- WHATWG HTML form validation model: <https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#client-side-form-validation>
- W3C accessible-name/label/group semantics for stable user-facing field identity: <https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/>
- W3C form and legal/data error-prevention guidance: <https://www.w3.org/WAI/tutorials/forms/> and <https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html>
- Playwright actionability and locator guidance: <https://playwright.dev/docs/actionability> and <https://playwright.dev/docs/locators>
- SQLite atomic commit/isolation for the local runtime: <https://www.sqlite.org/atomiccommit.html> and <https://www.sqlite.org/isolation.html>
- PostgreSQL transaction isolation, locks, constraints, partial indexes and atomic conflict handling: <https://www.postgresql.org/docs/current/transaction-iso.html>, <https://www.postgresql.org/docs/current/explicit-locking.html>, <https://www.postgresql.org/docs/current/ddl-constraints.html>, <https://www.postgresql.org/docs/current/indexes-partial.html>, and <https://www.postgresql.org/docs/current/sql-insert.html>
- Supabase row-level security and database functions: <https://supabase.com/docs/guides/database/postgres/row-level-security> and <https://supabase.com/docs/guides/database/functions>
- AWS idempotent API design: <https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/>
- DAgger for learning from states a sequential policy actually encounters: <https://proceedings.mlr.press/v15/ross11a>
- Conservative contextual bandits for preserving a baseline while exploring: <https://arxiv.org/abs/1611.06426>
- Off-policy evaluation research explaining why outcomes collected under different routing policies are not directly comparable: <https://proceedings.mlr.press/v130/kuzborskij21a.html> and <https://proceedings.mlr.press/v37/swaminathan15.html>
- EAGL research on composite/stability-based web locators: <https://doi.org/10.1145/3818665>
- Kuhn's original assignment-method paper, used as the basis for one-to-one repeatable entity/group matching: <https://doi.org/10.1002/nav.3800020109>
- Nielsen Norman Group user-control/Undo guidance for reversible automatic learning: <https://www.nngroup.com/articles/user-control-and-freedom/>
- OWASP logging guidance: <https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>
- India's Digital Personal Data Protection Act and Rules: <https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf> and <https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf>
- US FTC employment background-check disclosure/authorization guidance: <https://www.ftc.gov/business-guidance/resources/background-checks-what-employers-need-know>
- Court of Justice of the European Union Planet49 consent judgment record: <https://infocuria.curia.europa.eu/tabs/redirect/juris/liste.jsf?num=C-673%2F17>
- US FTC dark-pattern report on prechecked boxes and obstructed privacy choices: <https://www.ftc.gov/system/files/ftc_gov/pdf/P214800%20Dark%20Patterns%20Report%209.14.2022%20-%20FINAL.pdf>

## 16. Recommended product defaults awaiting confirmation

The plan assumes these defaults unless the product owner changes them:

1. Low-risk stable manual facts auto-version after a reliable commit and appear in a quiet learning summary with Undo; fresh mutable facts autofill; preferences/entity/legal facts remain constrained by precise context and policy. There is no repeated “remember this?” prompt.
2. A correction is classified only at a strong checkpoint. Incomplete edits, close/navigation races and unexplained value changes are neutral. `USER_CORRECTED` never directly changes semantic or strategy confidence.
3. Representation rules are packaged and scope-first. One correction cannot affect other candidates; use the explicit exact/form-family/ATS promotion gates above.
4. Repeatable entities bind by stable UUID and one-to-one anchor matching. Auto-bind at `>= 0.85` with `>= 0.20` margin; otherwise ask one compact disambiguation question.
5. Copilot prepares declarations, then one per-application affirmative gesture authorizes a visibly itemized eligible group. Optional choices remain neutral; background checks, arbitration/waivers, biometrics, medical/genetic disclosures, electronic signatures and marketing require separate handling. Submit remains direct.
6. Random 5% canary traffic is off for MVP. Strategy plans contain zero to three meaningful packaged strategies. After exhaustion, the human takes over; an eligible value-free trace may nominate a packaged provisional backup for future rescue traffic.
7. Structural handoff observation is enabled only after prominent onboarding disclosure/affirmative permission, is restricted to the handed-off low-risk control, and can be disabled. Sensitive/action/security fields are never observed for learning.

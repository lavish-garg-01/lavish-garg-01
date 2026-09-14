# Job Hunter V2 — adversarial autofill and learning review

Audit completed 12 September 2026. This is a diagnosis and corrective design, not an implementation completion claim.

**Verdict: YES WITH CHANGES.** The architecture can learn recurring candidate information, but the current product cannot reliably promise “after 10–20 applications, mostly review and submit.” Several ordinary answers fail before execution; some incorrect representations pass verification; the manual-answer learning loop is incomplete. These are concrete integration and modeling defects, not a reason to replace the entire system or add AI everywhere.

## Evidence and limits

The review covered the existing checkpoint/context, active V2 source, tests, API bridges, learning repositories and migrations, controlled browser behavior, and read-only aggregate history from the local database. Product source was not changed. No employer applications were submitted, candidate records changed, or new paid AI requests initiated by this audit.

Evidence labels below distinguish **reproduced** boundary failures, **observed** historical local records, **source** findings, and **recommended** behavior. Local development history is not a representative performance benchmark. An accepted provider attempt is not a correctly answered field; a verified DOM write is not a correct application answer.

Verification completed:

- `npm run check`: architecture checks, type checking and **361 tests passed**, zero failed or skipped.
- `npm run test:ats-surface:browser`: **11 controlled application-journey surfaces**, plus shadow/label/radio-evidence/mini-panel checks passed.
- `npm run test:autofill:browser`: actual unpacked extension passed zero-click filling, dynamic fields, ownership preservation, pause/resume/retry, progress/focus, manual privacy and unrelated-page exclusion checks. This command exercises the autofill-specific branch; it does not certify every execution-browser scenario.
- `npm run test:learning:browser`: actual extension passed the scripted learning journey. **Its learning backend is a fixture implementation using maps, not the production VerifiedLearningService and repositories.** Its “unknown answers” mostly mean known canonical questions with missing candidate values, not arbitrary unknown semantics. The success message is broader than what this test proves.
- [Autofill boundary probes][boundary-probe]: 16 diagnostic observations, including confirmed counterexamples against current source and controlled Chromium. D05 is a coverage observation using a deliberately rejecting fake AI adapter, not a measured provider failure.
- [Production learning boundary probes][learning-probe]: real learning/truth services, repositories and migrations in an isolated in-memory PGlite database reproduced crash/retry and scope problems.
- [Local evidence probe][local-probe]: loopback-only, read-only transaction; aggregated metadata, without decrypting candidate answers. Historical records include different development builds/model configurations.

Browser tests initially encountered sandbox restrictions and were rerun successfully with the required local process permissions. Existing project servers were left running. The requested Bugbot pass used a read-only correctness-review fallback because a dedicated Bugbot tool was unavailable; that agent stopped at its usage limit. Its saved production-learning reproduction was independently rerun successfully by the main reviewer. Findings below do not rely on an unfinished specialist verdict.

### What the actual history says

The local snapshot contains **104 ordinary-field execution receipts**: 64 technically verified, 36 failed and 4 aborted. This excludes other document/declaration paths, unplanned questions and skipped fields, so **64/104 is not autofill accuracy or coverage**.

- **14** `WORK_MODE_REQUIREMENT` failures used `BOOLEAN_YES_NO_OPTION@1`; **13** `HEARING_SOURCE` failures used `ENUM_EXACT_OPTION@1`. Both were `STRATEGY_UNSUPPORTED`. The matching text-input/textarea incompatibilities are reproduced below.
- **12** experience writes were technically verified as `DURATION_MONTHS@1`; **4** notice-period writes as `INTEGER_TEXT@1`; **2** current-CTC writes as `INR_YEAR_TO_LPA@1`. These counts corroborate the paths behind the screenshot, but do not establish that the displayed answers were semantically correct.
- **9** staged manual observations exist: 4 consumed, 1 skipped, 4 still recorded. Only **2 finalized verified checkpoints** are present, reporting 3 saved updates, 1 ask-again and 1 skipped update. This is not evidence of a completed 10–20-application learning cycle.
- **70 pending semantic-review descriptors** exist: 48 new-canonical reviews and 22 alias reviews. A queue exists; automatic productive semantic learning from that queue is not established.
- **80 strategy evidence rows** exist: 76 technical and 4 feedback, including 3 overwritten and 1 kept. These are not 80 independently assessed applications.
- There are 41 application/run records and 3 submit-attempt records. Those are database entities, **not proof of 41 or even 3 successful employer submissions**.

AI history for 11–12 September contains **132 canonicalization provider-attempt rows**: 26 accepted, 91 rejected for insufficient confidence, 7 invalid output schemas, 4 provider schema rejections, 3 rate limits and 1 timeout. Attempts include fallbacks; the ledger does not represent all fields, cache hits or preflight skips. One timeout row records 154,126 ms elapsed; this does not establish a 154-second configured timeout or a representative latency percentile. The history also contains two failed extraction attempts, one accepted résumé-tailoring attempt and three rejected tailoring attempts. There is no cover-letter attempt in this snapshot. Therefore: **AI is connected and sometimes succeeds, but “all AI features and extractions work accurately” is not verified.**

## 1. Executive diagnosis — the ten highest-impact causes

### 1. Representation is not a contract with the question

**Reproduced D01–D03, D08–D09.** Canonical money, durations, booleans and enums are converted using coarse type/label rules, not a validated combination of meaning, unit, period and control capability.

- ₹1,400,000/year becomes bare `14` when the label contains CTC, even when it does not specify lakhs. The learning normalizer reads the same bare `14` with that label as ₹14/year: a **100,000× round-trip disagreement**.
- 44 months of experience becomes bare `44` for the actual “work experience in a similar role/capacity” wording.
- ₹1,200,000/year becomes `1200000` in an explicitly monthly salary field, instead of `100000`.
- A hearing-source enum is rendered as an option selection even in a textarea. A work-mode boolean is rendered as an option selection even in a text input. There are no compatible strategies for those representations.

This directly explains why repeating the form or changing the model does not repair those fields. The correct truth can already exist and still never reach the form. [Representation][representation], [normalization][normalization], [strategy selection][executor].

**D06 adds a normalization defect:** a valid synthetic +91 phone number is split using an erroneous four-digit country prefix. Recombining the parts can preserve the original full string, so this is not proof that every combined phone field is wrong; it breaks the structured country-code/national-number contract needed by split phone controls and future reuse.

### 2. Technical verification is being mistaken for answer correctness

**Reproduced D10, D12.** Bare `45` is written and independently marked `VERIFIED`; the verifier checks the planned representation, not whether it answers the joining question. In a synthetic application that ignores untrusted events, the DOM contains the planned text while the application's internal model remains empty, yet verification passes.

The latter is a boundary counterexample, not a claim that every React form fails. It proves that “DOM readback passed” cannot certify framework commitment, unit correctness or employer acceptance. [Verifier][verifier].

### 3. Learning has a blind spot exactly where the product needs help

**Source plus production reproduction.** The content observer requires a high-confidence canonical mapping before accepting a manual answer. Truly unknown/ambiguous questions are not retained as reviewable private answer evidence through this path. Corrections following unsupported/failed execution can be classified as interaction-suspect and excluded before they become reusable truth. That prevents poisoning, but it also loses recoverable evidence.

Submission does not magically fix missing semantics, missing scope or an incompatible representation. Repeatedly typing the answer is insufficient unless the observation is captured, normalized, scoped, checkpointed and promoted. [Controller][controller], [learning service][learning-service].

### 4. AI fallback is constrained by the lexical system it should help

**Reproduced D04, D14; observed 91 confidence rejections.** The exact joining phrase is a high-confidence notice-period alias, so AI is not called. For ambiguous fields, AI ranks a bounded candidate set produced upstream. A semantically valid supplied `CURRENT_COMPANY` choice for “Organization with which you are presently engaged” is reduced to zero confidence by the output validator's lexical-overlap check.

This is not a recommendation to trust model self-confidence. It is evidence that the current validator can reject the very synonym reasoning requested from the model. No current AI task repairs arbitrary answer representations or composes contextual application answers. [J resolver][semantic-resolver], [ontology][ontology], [P validation][ai-registry].

### 5. The scanner models DOM controls, not consistently logical questions

**Reproduced D07.** One question containing three radio options becomes three fields. Shared question evidence exists, but grouping is not completed at the identity/progress/planning level. Checking one radio can make each member appear completed because completion checks the group. This inflates the denominator and explains option-like “Question 14 / Question 15” entries.

Long labels can also lose their discriminating tail through truncation. Counting HTML controls is not counting candidate questions. [Scanner][scanner].

### 6. Capability agreement and target boundaries are incomplete

**Reproduced D11, D13, D16.** Contenteditable is scanned as textarea, then server hints can exclude the existing contenteditable strategy. A combobox without a verified popup association searches the whole document and can click an unrelated listbox option; subsequent failed verification does not undo that wrong click. An input under a hidden open-shadow host is incorrectly considered visible.

These require capability/ownership and containment fixes, not another semantic model. [Planner hints][execution-service], [browser capabilities][capabilities], [executor][executor], [scanner][scanner].

### 7. Checkpoint recovery can sever learning from its Undo receipt

**Reproduced using production services and repositories.** Injecting a crash after the truth change set commits but before the checkpoint finalizes leaves a learned answer and an unfinalized checkpoint. Exact replay returns `NO_REUSABLE_UPDATES`, marks the observation skipped and leaves `consumed_change_set_id` null. The response no longer carries the original change-set link for normal Undo.

Separately, reconstructing a retry with the same idempotency key but new request/time evidence produces an idempotency conflict. This is a crash-consistency defect, not proof that all ordinary checkpoints fail. [Learning service][learning-service], [reproduction][learning-probe].

### 8. Global fallback exists, but conditions and freshness are too coarse

**Reproduced and source.** Repeated compatible answers can become trusted globally, matching your requested global-default policy. However, two affirmative work-mode observations can promote a global reusable “yes” that is then eligible for an unrelated company's job in another country. A boolean alone does not preserve “Hyderabad, five office days, given relocation conditions.”

Do not remove global defaults. Make compatibility conditions explicit. Also, total experience and current location are currently in no-expiry policy categories; a stored experience total can freeze as time passes. [Candidate policy][truth-policy], [scope selection][learning-service].

### 9. Strategy learning cannot repair upstream failures or learn arbitrary manual workflows

**Source.** Technical strategy evidence is projected from actual attempt entries. A plan/representation failure with no attempt produces no per-strategy technical evidence in that bridge. Captured manual patterns do not become arbitrary reproduced procedures: the current synthesis path for native text proposes a fixed safe primitive sequence. Global experiments additionally require multi-user evidence and substantial canary samples.

That is a reasonable global safety boundary, but it cannot deliver a single candidate's rapid improvement after a few forms. Candidate reuse and widget execution learning must remain separate. [Receipt bridge][strategy-bridge], [Q service][strategy-service].

### 10. The tests certify controlled paths, not the advertised outcome

**Observed test implementations and results.** There are serious tests, not merely basic examples: ownership, consent isolation, stale graphs, transactions and controlled extension journeys are covered. But the learning-browser certification substitutes the backend under audit; scanner tests can pass while each radio remains a field; verifier tests can pass while unit semantics are wrong. There is no demonstrated chronological, held-out same-candidate learning curve or real-world correct-answer coverage benchmark.

Passing 361 tests is compatible with all the reproduced bugs above. The missing artifact is an independently labeled outcome corpus, not just more green component tests. [Browser learning harness][learning-harness], [boundary probes][boundary-probe].

## 2. Architecture scorecard

Ratings are qualitative judgments from the evidence, not numeric quality measurements. The companion navigator presents these as a comparison table.

- **Scanner — IMPROVE.** Purpose: discover visible controls and structural evidence. Useful open-shadow traversal, label evidence and application-surface handling; inadequate logical grouping, hidden-host visibility, capability fidelity and bounded-scan observability. Direct impact: wrong field counts, missed controls and spurious work. D07/D11/D16; [scanner][scanner].
- **J Field Intelligence — IMPROVE.** Purpose: identify canonical meaning without inventing candidate facts. Good typed evidence and deterministic-first design. High-confidence aliases can be confidently wrong; bounded lexical retrieval plus lexical validation weakens AI assistance. Contextual narrative concepts remain partial. Direct impact: wrong meaning or repeated unknown questions. D04/D05/D14; [resolver][semantic-resolver].
- **Candidate Truth — KEEP core; IMPROVE policy.** Purpose: authoritative typed, versioned, scoped candidate data. Immutable provenance, conflict handling and Undo are valuable. Missing qualifiers, computed freshness and obvious promotion feedback reduce reuse quality. Direct impact: accurate facts may be stale or misapplied. [Policy][truth-policy], [learning probe][learning-probe].
- **Representation — REDESIGN its contract, not the truth store.** Purpose: render a fact for a particular question/control. Current rules are too heuristic and not inverses of manual normalization. Direct impact: ordinary salary, duration and free-text answers fail or mislead. D01–D03/D08–D10; [representation][representation].
- **M entities — IMPROVE.** Purpose: bind repeated employment/education sections to stable candidate entities. Stable IDs and refusal on ambiguity are good. Evidence is often recency/coverage rather than actual existing field anchors; whole-form one-to-one assignment is missing. A sole entity can be eligible for multiple repeated slots. Direct impact: extra manual work or misbinding on complex histories. [M service][entities].
- **N Form Graph — KEEP guards; SIMPLIFY uncertain causality.** Purpose: track readiness, ownership, dependencies and dynamic changes. Stale/cycle guards and bounded frontiers are good. Observed nearby changes can be assigned to the last source with very high confidence without a demonstrated causal predicate. Direct impact: unnecessary blocking and misleading dependency reasons. [Graph][graph].
- **K Executor — KEEP safe primitives; IMPROVE capability/containment.** Purpose: bounded, reversible-where-possible browser actions under guards. No arbitrary generated executable code; user ownership and limited retries are strong. Capability drift and unassociated popup targeting are real gaps. Direct impact: zero compatible strategies or unintended control interactions. D08–D13; [executor][executor].
- **Verifier — REDESIGN into distinct verification levels.** Purpose: independently confirm execution. Current readback is useful but not semantic or framework-commit validation. Direct impact: false assurance, contaminated success statistics and unsafe learning attribution. D10/D12; [verifier][verifier].
- **L learning — REDESIGN capture/recovery seams; KEEP truth authority.** Purpose: stage private evidence and promote verified candidate updates. Good isolation and controlled promotion. Unknown-question loss, unsupported-control observations, and non-atomic checkpoint finalization break the loop. Direct impact: repeated typing does not reliably improve next time. [L service][learning-service], [production probe][learning-probe].
- **O policy — KEEP safety boundary; IMPROVE applicability UX.** Purpose: separate declarations, sensitive decisions and consent from ordinary facts. Preserve explicit-user control. Conditional inapplicability is not equivalent to satisfying an employer's required field; show the remaining site constraint. Direct impact: safe stopping must be distinguishable from an autofill bug. [Planner][execution-service], [controller][controller].
- **P orchestrator — KEEP centralization; IMPROVE task contracts/evaluation.** Purpose: typed provider calls, budgets, validation and diagnostics. Real accepted calls and centralized adapters exist. Schema failures, overrestrictive semantic validation and imperfect generation grounding remain. Direct impact: fallback rejects useful answers or cannot address the relevant layer. [P registry][ai-registry], [local evidence][local-probe].
- **Q Strategy Intelligence — KEEP bounded rollout; SIMPLIFY its role in the immediate roadmap.** Purpose: improve execution strategies safely using attributed evidence and experiments. Good controls for a multi-user system. Narrow manual-pattern synthesis, sparse feedback and upstream blind spots prevent the broad self-learning expectation. Direct impact: cannot substitute for fixing meaning/representation/candidate memory. [Q][strategy-service], [metrics][strategy-metrics].

## 3. Self-learning assessment

**YES WITH CHANGES** for most *recurring, sufficiently evidenced candidate-specific questions on supported executable controls*. **Not yet proven today**, and not a promise for all fields after a fixed number of applications.

The durable answer store and promotion machinery are real. The production probe shows an observation can progress from review-only to trusted reuse. But reliable reuse currently depends on several prerequisites that manual completion alone does not guarantee: a high-confidence semantic mapping, captured supported-control events, valid normalization, sufficient company/country context, a successful durable checkpoint, promotion policy, a compatible rendering and a working executor.

Your screenshot's “8 of 13” is not evidence that only eight facts are known. It combines ATS/already-populated controls, Copilot writes, remaining fields and inapplicability. Hearing source and work mode can be known yet unfillable through their selected representations. CTC can be absent, review-only, stale or incorrectly normalized. A missing GitHub answer should not be described as “waiting for another field” unless an actual dependency exists.

Submission establishes that a journey advanced; it does not prove every value is factually correct or globally reusable. A candidate who fixes a dropdown execution error has not necessarily changed their underlying answer. Someone changing “14 LPA” to “1400000” may be correcting units, not compensation. Learning must preserve those distinctions.

## 4. Missing concepts, in priority order

1. **Logical Question Contract:** one question, its member controls, canonical meaning, requested unit/period/shape, entity, qualifiers, applicability and evidence provenance.
2. **Bidirectional representation contract:** render plus parse-back with explicit conversion assumptions; distinguish monetary amount from scale, duration from date, full-time experience from role-specific experience, and a preference from a commitment.
3. **Layered outcome:** semantic correctness, truth eligibility, representation validity, DOM write, control commitment and final application confirmation are different facts.
4. **Recoverable private unknown-answer inbox:** preserve candidate-supplied evidence while meaning is unresolved; never silently make it global truth.
5. **Atomic/recoverable learning transaction:** stable checkpoint identity, observation consumption, change-set link and replay/Undo receipt must survive crashes together.
6. **Conditional global defaults:** reuse general preferences by default, but retain place, country, time, work arrangement and employer-specific qualifiers when relevant.
7. **Freshness/dependency model:** recompute derived facts and expire or reconfirm mutable facts based on source changes, not only a static TTL.
8. **Entity assignment across the whole repeated section:** stable candidate identity plus anchors and one-to-one constraints; distinguish missing rows from uncertain bindings.
9. **Candidate-specific behavioral preferences:** approved presentation, units, phrasing and answer style, separate from factual truth and executable strategy.
10. **Outcome-labeled failure corpus and learning curve:** sanitized structure plus independently assessed expected behavior, including abstentions and recovery.

## 5. Wrong or over-engineered concepts

### Simplify the boundaries, not just the number of packages

- **Remove duplicated capability authority.** Server `capabilityHints` and browser detection must share a versioned vocabulary and compatibility contract. Existing contenteditable support is useless when a different layer filters it out.
- **Replace independent ad-hoc representation/normalization rules.** Keep canonical truth normalized; centralize conversions and test round trips. Do not copy renderer logic into UI/profile/import paths.
- **Stop calling a queue self-learning.** A pending hashed descriptor is not an active semantic alias. The proposal path needs a reviewable, privacy-aware lifecycle and an actual activation mechanism.
- **Stop treating a single confidence number as evidence.** Current scores are heuristics, not calibrated probabilities. Multiplying or reusing lexical agreement at multiple layers does not add independent evidence.
- **Stop routing every overwrite through one reward interpretation.** Candidate corrections, formatting edits, employment changes, wrong entity bindings and failed interactions have different owners.
- **Defer broad global strategy experimentation until the common paths work.** Multi-user rollout machinery has value, but adding more canary sophistication will not fix enum-to-text rendering or lost manual answers.
- **Reduce repeated work on the request path.** Resolve and plan against a versioned snapshot; invalidate only the fields/entities affected by changes rather than repeatedly asking every layer the same questions.

### The current +1 / −2 logic

The arithmetic exists: kept = +1, overwritten = −2 in strategy metrics. In the inspected production paths, `feedbackScore` is computed but is not itself the general strategy-admission/ranking rule. Other correction-rate safety checks do affect rollout. Also, leaving a filled field unchanged does not reliably emit a positive signal; most observed feedback comes from edits. The local snapshot contains just four feedback rows. [Metrics][strategy-metrics], [controller][controller].

Do not use this score as candidate-truth confidence or proof that the model is improving. Keep it, if useful, as a descriptive attributed metric. Record separate outcomes: correct fact kept, fact corrected, formatting preference changed, field moved, failed commit, wrong entity, and explicit candidate rejection. An unchanged field is at most weak implicit feedback, not independently verified truth.

### Dead/duplicated logic conclusion

The inspection did not find a second active provider gateway that justified replacing P or reviving V1's shared form memory. Architecture checks passed. The consequential duplication found is at capability and representation boundaries, not proof that every legacy file is dead. A whole-repository reachability/deletion audit was not performed; do not delete legacy code based solely on this review.

## 6. Learning model redesign

### Keep nine kinds of learning distinct

**Semantics:** Learn that paraphrases refer to the same concept, qualified by section, options and requested output. Use deterministic aliases for genuinely equivalent meanings, semantic retrieval for candidates, and an evaluated AI fallback when evidence is insufficient. Store an accepted alias with source, confidence basis, version and negative examples. Novel concepts go to review; AI must not mutate the production canonical registry directly.

**Candidate Truth:** Learn only candidate facts/preferences under stable identity and provenance. Keep normalized values and immutable changes. A verified submission can support confidence, but must not overwrite stronger current profile evidence or convert an execution failure into a changed fact.

**Scope:** Use the most specific compatible answer, falling back to a compatible global default as requested. Add qualifiers rather than making everything application-only. “Willing to relocate” is not identical to “will work onsite in this city five days per week.” Country-dependent authorization and company-history answers need validated context. Directly opened employer pages must acquire that context or visibly request it.

**Freshness:** Stable identity facts remain until changed. Compensation, notice, location and work authorization get field-specific review triggers. Experience is preferably derived from verified dated employment with overlap handling and an as-of date; relevant experience needs role/skill evidence, not merely total tenure. Future start dates depend on an explicitly understood anchor, not an invented offer date. Show when a default is stale and why.

**Representation:** Store preferences such as rupees versus explicit LPA, textual duration versus exact date, rounding policy and URL formatting separately from facts. Bind any reusable representation rule to a question/control contract. Require `parse(render(truth, contract), contract)` to preserve meaning within declared precision. Never infer exchange rates or silently round experience upward.

**Preference:** Distinguish general work preferences, contextual decisions, and stylistic choices. A learned concise writing style may guide a draft; it cannot invent willingness, salary or an achievement. Provide one visible place to view/change defaults and their scope.

**Entity:** Learn stable employment/education identities, not field numbers. Match existing values via privacy-preserving anchors, dates, employer/school identity and section context. Perform constrained assignment across all rows. Confirm an uncertain assignment once, then reuse that identity within the journey; never infer a new employment record solely from DOM index.

**Execution:** Retain bounded strategies and independent readback. Learn safe widget recipes from attributed, committed interactions, including waiting for associated option lists and selecting a proven option. Promote only recipes built from approved primitives with containment and ownership guards. No arbitrary generated JavaScript.

**Global versus private learning:** Candidate answers, résumé content, compensation, work authorization and private preferences remain tenant/candidate scoped. Shared knowledge may include reviewed question semantics, option shapes, accessibility structures and safe widget strategies—not raw candidate answers. Structural metadata still needs privacy review; a hash is not automatically anonymous.

### Evidence flow

Recommended sequence: candidate edit → ownership guard → private staged observation → classify fact/format/entity/interaction/semantic issue → validate context and normalization → explicit save or verified checkpoint → atomic change set and reusable receipt → scope/freshness-qualified truth → future retrieval → representation validation → independent execution verification.

If meaning is unknown, branch to a private review inbox before truth promotion. Preserve the answer so the candidate need not type it again. After the concept is reviewed, replay the staged observation through the same normalization/scope rules. If the correction is only representation or interaction, update that evidence stream without changing Candidate Truth.

### Unknown canonical lifecycle

Current proposal records contain hashes and known structural identifiers; the bounded pending queue has no demonstrated end-to-end review-to-production activation loop. Proposed lifecycle: deduplicate → retain a minimal sanitized descriptor plus encrypted private answer reference → search existing canonical concepts → propose alias versus truly new concept → human/policy review of value type, scope, freshness, sensitivity and representation → registry version/migration/tests → staged rollout → reprocess eligible private observations → allow rollback. The queue must not require storing an entire employer page or distributing personal answers. [Proposals][proposals].

## 7. Candidate learning lifecycle: application 1 → 5 → 10 → 20

These are desired behaviors and checkpoints, not measured percentages or a guarantee tied to application count.

**Application 1:** Import the résumé into a reviewable profile with provenance. Ask only high-value missing defaults: current location, notice/joining availability, currency/period-qualified compensation, work preferences and authorization context. Use employer résumé autofill when available, then label ATS-populated versus Copilot-populated values separately. Capture unknown/manual answers privately; explain what was saved and what still needs confirmation.

**By application 5:** Reuse confirmed common facts across paraphrases and control types. The candidate should not repeatedly enter name, phone, links, location and the same fresh notice period. Review the unresolved-answer inbox in groups. Reuse formatting choices without changing factual amounts. New company questions remain contextual; declarations remain manual.

**By application 10:** Demonstrate reuse on held-out wording and a different supported ATS. Confirm employment/education identities across repeated sections. Show measurable reduction in recurring factual questions requiring re-entry. If it is not improving, identify the actual layer: unknown meaning, missing capture, untrusted answer, stale scope, wrong representation or unsupported control.

**By application 20:** Most recurring *eligible* questions should resolve without asking again, if the relevant facts have been observed and confirmed. Novel narratives, new employer conditions, changed circumstances, unsupported widgets and explicit acknowledgements still need attention. Show a learning history and allow revocation/Undo. A candidate doing twenty identical forms is not proof of generalization; an evaluation must include unfamiliar wording and sites.

## 8. Recommended autofill runtime architecture

1. **Recognize the journey and current state.** Job detail, application form, modal, résumé-first flow, login, review and one-click action are different states. Detection alone must never click an irreversible apply/submit action.
2. **Discover logical questions.** Group radios/multiselect options; traverse accessible open-shadow roots and permitted frames; respect hidden hosts; identify real labels, constraints and member controls. Report unsupported/closed boundaries rather than pretending they are empty forms.
3. **Build a local question contract.** Separate semantic concept from desired representation, entity, conditions and control capabilities. A unitless or conflicting field remains uncertain even if its canonical alias is known.
4. **Apply consent and applicability policy.** Exclude declarations/acknowledgements and unsafe actions. Mark “last working day if available immediately” inapplicable only with justified notice context. If the employer still requires it, surface that site constraint rather than falsely marking the application ready.
5. **Resolve meaning and entity.** Fast deterministic path first; semantic fallback only where it adds evidence. Bind repeated entities with stable IDs and whole-section constraints.
6. **Retrieve candidate truth.** Specific compatible answer → compatible global default → reviewed private answer candidate → ask. Check freshness and provenance. Never use strategy feedback as a source of personal facts.
7. **Render and validate meaning.** Enforce unit/period/format rules and round-trip invariants. `14` is appropriate only for an explicitly lakh-scaled salary field; a generic annual INR field should receive `1400000` or an unambiguous labeled equivalent where text is allowed.
8. **Execute under live guards.** Revalidate page/field identity, user ownership, graph revision, popup association and capabilities. Fill ready known fields without waiting for unrelated AI questions.
9. **Verify at separate levels.** Confirm semantic/representation validity before action, then DOM readback, control commitment and absence of relevant validation errors. Do not claim final employer acceptance from these checks; only a verified submission result can support that status.
10. **Rescan affected dependencies and explain residual work.** Preserve user edits. A changed field invalidates only dependent plans and facts, not all prior progress.
11. **Fallback visibly and capture recovery.** Retry only a supported safe alternative; otherwise focus the field, show the expected format and let the candidate type. Retain that correction in the right evidence stream. Explicit save/checkpoint returns a durable receipt with Undo.

### The joining-date ambiguity

“If you are offered, by when can you join?” is not necessarily an exact calendar date: it can mean availability relative to an offer. The screenshot shows a text input, not a mandatory date picker. The definite bug is bare `45` and an overconfident alias, not that every such field must contain a date. Use “45 days after offer acceptance” if that is the verified fact; compute an exact date only when the requested anchor and date semantics are known or confirmed. [D04/D10][boundary-probe].

### Latency, cost and local-first behavior

The J path caps AI candidates and concurrency with a bounded request budget, which is worth preserving. However, a request still waits for unresolved AI work before returning the complete batch; binding work and sequential truth retrieval can add latency outside that stage. Planning resolves intelligence again, and controller rescans repeat parts of the pipeline. The verifier's default polling adds roughly 410 ms of scheduled waiting per completed sequence; serialized fields accumulate that cost. These are source-derived latency contributors, not measured p95s. [J service][intelligence-service], [verifier][verifier].

Return deterministic ready results progressively, batch unique truth reads, cache by question/schema/registry/truth/entity versions, and cancel stale work. Keep candidate values out of global caches. A candidate-local encrypted cache can improve responsiveness only with expiry, revocation and ownership semantics; do not turn stale browser memory into a second truth authority. Measure time-to-first-correct-fill, total completion time, AI attempts per unresolved question and cost per correctly completed application, not just model latency.

## 9. Failure attribution matrix

Each row below specifies ownership and the appropriate learning destination. “No automatic promotion” means preserve reviewable evidence where permitted, not discard it. The companion navigator presents a compact matrix.

- **Discovery/grouping/visibility error** — owner: scanner/question model; evidence: D07/D16. Candidate learning: no factual update. Global learning: reviewed structural pattern. Strategy learning: not a strategy failure until a correct target exists.
- **Wrong canonical meaning or unknown question** — owner: J/ontology; evidence: D04/D05/D14. Candidate learning: private staged answer pending mapping. Global learning: reviewed semantic alias/new concept. Strategy learning: no penalty for executing the wrong upstream plan.
- **Missing/stale/incompatible truth** — owner: Candidate Truth/context policy; evidence: no-expiry derived facts and missing-context production probes. Candidate learning: confirmed scoped update. Global learning: no personal values. Strategy learning: none.
- **Wrong amount, period, duration or text/option representation** — owner: representation; evidence: D01–D03/D08–D10 and 27 historical unsupported receipts. Candidate learning: do not change truth merely because the user reformats it. Global learning: reviewed representation contract. Strategy learning: no reward/penalty for an incompatible representation with no attempt.
- **Wrong repeated entity** — owner: M/identity; evidence: source-level recency/coverage heuristics and missing whole-form assignment. Candidate learning: bind the correct stable entity after confirmation. Global learning: structural binding rule only. Strategy learning: not a widget execution issue.
- **Dynamic dependency or stale graph** — owner: N/controller; evidence: graph guards and historical stale aborts. Candidate learning: generally no truth update. Global learning: reviewed transition evidence. Strategy learning: classify as site/graph change, not universal strategy failure.
- **Unsupported widget or missed model commitment** — owner: capabilities/K/verifier; evidence: D11–D13. Candidate learning: retain the manually supplied answer if independently eligible, separately from interaction evidence. Global learning: safe widget capability/recipe. Strategy learning: yes, attributed technical evidence; never raw candidate values.
- **User edits a correctly filled fact** — owner: L/Truth or preference model; evidence: existing staged correction paths. Candidate learning: candidate correction, scope or style update depending on classification. Global learning: no answer sharing. Strategy learning: only if evidence shows an actual interaction failure.
- **Checkpoint crash/retry conflict** — owner: L/repository transaction boundary; evidence: production crash probe. Candidate learning: recover the original update and its receipt exactly once. Global learning: engineering regression case, not answer/semantic learning. Strategy learning: none.
- **Declaration/privacy/acknowledgement** — owner: O/user decision; evidence: policy and browser no-submission tests. Candidate learning: no implicit consent promotion. Global learning: reviewed declaration detection. Strategy learning: no automatic consent action.
- **Provider/schema/budget rejection** — owner: P/task contract; evidence: historical attempt rows. Candidate learning: no inferred answer. Global learning: adapter/evaluation improvement, with protected inputs. Strategy learning: none.
- **Unsupported document claim** — owner: document grounding/source selection; evidence: D15 and generation bridge. Candidate learning: never make generated prose new truth. Global learning: grounded-generation regression patterns. Strategy learning: none.

The current UI flattens important distinctions: progress handling can turn different operation failures into “fill verification failed”; planner fallback reasons can describe a blocked or deferred node as dependency-blocked without naming an actual dependency. Preserve precise reason codes, expose a useful explanation and link attention to the field. “Ready to review” should not conceal remaining required blockers. [Progress/controller][controller], [planning][execution-service].

## 10. Improvements ranked by impact

### P0 — before normal roadmap work

**P0.1 — Question/representation contract.** Problem: correct truth becomes wrong or unexecutable output. Solution: explicit units, currency, period, output shape and capability compatibility; boolean/enum-to-text renderers; shared render/parse invariants. Expected effect: directly removes the common work-mode/hearing-source failures and salary/duration errors. Complexity: medium–high. Modules: contracts, J evidence, execution representation, L normalization, onboarding display. Migration risk: high for existing ambiguous money/duration records; flag and reconfirm uncertain records rather than bulk multiplying values.

**P0.2 — Logical grouping and target containment.** Problem: options counted independently, capability drift, hidden shadow controls, cross-popup clicks. Solution: logical question IDs with member control IDs, shared capabilities, root-aware visibility, verified popup association and fail-closed targeting. Expected effect: credible progress counts, correct planning and safer widget actions. Complexity: medium–high. Modules: scanner, contracts, graph, executor, capabilities, progress UI. Migration risk: medium; version descriptor/graph identities and invalidate old plans without deleting candidate truth.

**P0.3 — Honest layered verification.** Problem: technical success masquerades as answer correctness. Solution: pre-execution meaning/representation validation, capability-specific commitment checks, scoped validation observation and distinct status levels. Expected effect: catches bare/unit-wrong values and uncommitted controls; makes metrics and learning trustworthy. Complexity: high. Modules: K verifier/orchestrator, receipts, learning attribution, UI. Migration risk: medium; legacy receipts must remain explicitly technical-only, not retroactively upgraded.

**P0.4 — Durable manual recovery and checkpoints.** Problem: unknown/failed fields are forgotten; crashes/retries lose receipt linkage. Solution: encrypted private unresolved inbox, separated recovery attribution, stable retry evidence, atomic or recoverably journaled truth/change-set/checkpoint/consumption linkage. Expected effect: candidate manual effort improves the next form and survives interruption with Undo. Complexity: high. Modules: controller, L, database repositories/migrations, candidate truth, attention UI. Migration risk: high; reconcile orphaned historical state carefully with backups and idempotent migrations, never replay into new truth blindly.

**P0.5 — Failure explanations and release-blocking regressions.** Problem: misleading readiness, generic reasons and test false assurance. Solution: structured per-layer outcomes, actual dependency IDs, batch-deferred/missing-answer distinctions, accurate ATS/Copilot/user counts, and fixed-outcome regressions for this audit's counterexamples. Expected effect: users can recover and developers can fix the right layer. Complexity: medium. Modules: planner, controller, progress, telemetry, tests. Migration risk: low–medium; add versioned reasons and retain old receipt semantics.

### P1 — major reliability and competitive improvements

**P1.1 — Semantic fallback and canonical activation.** Problem: lexical gates reject useful paraphrase reasoning; pending proposals do not close the loop. Solution: evaluate retrieval and fallback independently, add validated question contracts/negative aliases, and implement privacy-aware review-to-registry activation. Expected effect: fewer repeatedly unknown questions without unsafe automatic registry mutation. Complexity: high. Modules: J, P, canonical review storage/admin, contract registry. Migration risk: medium–high; version aliases, re-evaluate affected mappings and support rollback.

**P1.2 — Qualified global defaults and freshness.** Problem: contextual yes/no answers overgeneralize; derived facts freeze. Solution: compatible global fallback with explicit qualifiers, dated sources and recomputation dependencies; clear promotion/reconfirmation UI. Expected effect: more useful reuse without wrong-company/country/time assumptions. Complexity: medium–high. Modules: Candidate Truth policy/resolver, L, context bridges, profile. Migration risk: high; narrow or review ambiguous historic context instead of assuming every old global answer is safe.

**P1.3 — Entity binding and non-native controls.** Problem: insufficient anchors for repeated records; custom controls are not uniformly observed/committed. Solution: constrained entity assignment, safe candidate confirmation, root-aware associated option handling and supported event observation. Expected effect: better employment/education and complex ATS coverage. Complexity: high. Modules: M, scanner, K, L. Migration risk: medium; preserve stable candidate entity IDs, invalidate stale bindings only.

**P1.4 — Résumé extraction and document grounding evaluation.** Problem: provenance checks are not entailment; source selection is overbroad; extraction success is unmeasured. Solution: reviewed extraction corpus, contradiction/number/entity checks, purpose/scope/freshness allowlists, conservative grounded drafting with useful rejection explanations. Expected effect: safer documents and a more reliable cold-start profile. Complexity: high. Modules: onboarding/extraction/generation, document bridge, P, test fixtures. Migration risk: medium; existing generated documents retain their original versions and approval status until deliberately reviewed.

**P1.5 — Real backend learning-curve benchmark and progressive runtime.** Problem: fixture certification overstates production behavior and synchronous work delays all fields. Solution: production-backend disposable-database journeys, held-out chronological candidate tests, incremental results and versioned cache invalidation. Expected effect: measurable recurring-answer improvement and earlier first useful fill. Complexity: high. Modules: browser test infrastructure, J/planner API, controller, instrumentation. Migration risk: medium; preserve privacy and stale-plan guards while changing response delivery.

### P2 — refinement and scale

**P2.1 — Broader safe strategy learning.** Problem: fixed native-text synthesis and scarce attributed signals. Solution: expand a reviewed primitive grammar only for demonstrated widget gaps, local candidate recovery first, global canaries only after adequate independent evidence. Expected effect: resilience to site changes, not a substitute for candidate knowledge. Complexity: high. Modules: Q/K/L evidence bridge. Migration risk: medium; new strategies require fresh proof and rollback.

**P2.2 — Privacy operations and offline responsiveness.** Problem: structural metadata can still be sensitive; local caching can become stale authority. Solution: data classification, retention/deletion tests, scrubbed failure corpus, consent-aware collection and candidate-local encrypted caches with revocation. Expected effect: scalable diagnostics and responsiveness without answer leakage. Complexity: medium–high. Modules: telemetry, storage, P gateways, extension cache, operations. Migration risk: medium; retention changes must not remove provenance needed for active Undo without an explicit policy.

## 11. Corrective implementation sequence

1. **Lock the outcome definitions and regressions first.** Turn D01–D16 and checkpoint crash cases into tests of desired behavior, not tests that merely assert today's bug. Define logical-question coverage and technical versus semantic success.
2. **Repair the question → representation → capability path.** Group controls, share capabilities, implement explicit units/text fallbacks and enforce target containment. This unlocks common fields before adding broader AI behavior.
3. **Make verification and attention truthful.** Check representation before action; distinguish DOM and committed success. Preserve real reasons and accurate required-field readiness.
4. **Repair durable capture and checkpoint recovery.** Close the unknown/manual-recovery loop and prove exactly-once receipt linkage plus Undo with crash injection.
5. **Qualify global reuse and derived freshness.** Then migrate ambiguous historical records safely. Do not “learn faster” by broadly trusting uncertain old data.
6. **Improve semantic generalization and entity assignment.** Add reviewed canonical activation, retrieval evaluation and stable repeated-section matching, with safe non-native widget support.
7. **Evaluate cold-start extraction, documents and chronological learning end to end.** Use the production backend and held-out applications. Optimize progressive filling against measured latency and cost.
8. **Only then expand global strategy experiments and the normal feature roadmap.** Require attribution quality and adequate independent traffic.

Steps 1–5 should precede more UI polish, more canonical aliases by guesswork, more provider switching or new roadmap phases. A better interface cannot compensate for an answer that is wrong, forgotten or only apparently committed.

## 12. Tests and benchmarks required to prove improvement

### What the existing tests really represent

They cover meaningful engineered cases: real extension messaging, zero-click start, SPA/dynamic fields, open-shadow discovery, ownership, policy, stale guards, retries and synthetic submissions. They are **not just basic stuff**. However, controlled ATS-shaped pages do not reproduce the full employer application, backend validation, real React state lifecycle, timing variance or changing custom widgets. The fixture learning backend especially limits the production claim. [Harness][learning-harness].

### Corpus design

Build a versioned, consented corpus with sanitized structures and synthetic candidate data:

- Logical radio and checkbox groups, repeated names across forms, long labels, required/optional and hidden controls; gender/disability disclosures remain separate policy cases.
- Plain inputs, textareas, native selects, grouped ranges, contenteditable, ARIA radio/checkbox/toggle controls, portal dropdowns, delayed/virtualized options, shadow roots and frames with explicit access limits.
- Ashby-, Lever-, SmartRecruiters-, Workday- and Greenhouse-shaped journeys, plus custom pages, modals, résumé-first flows, login, review and irreversible one-click states. Test both supported detection and honest abstention.
- React/Vue-style controlled rerenders, delayed resets, validation errors, stale references, duplicate labels, debounce, navigation, network outage, model timeout, rate limit and cancellation.
- Currency/scale/period variants: annual INR, monthly INR, explicit LPA, commas, decimals, zero/unknown, different currencies, compensation ranges and salary expectations versus current compensation.
- Experience and availability: months versus years, completed years versus precise duration, overlapping employment, relevant versus total experience, notice days versus a dated start, offer-relative availability and conditional last working day.
- Multi-role employment, concurrent jobs, promotions, same employer twice, old/current education, missing dates, added/removed/reordered rows and uncertain entity matching.
- Manual save, abandoned application, failed submission, verified submission, retry, crash after every database boundary, stale profile writes, partial Undo, missing company/country and changed qualifiers.
- Unknown semantics and held-out paraphrases that are absent from aliases; conceptually similar questions requiring different answers.
- Documents: negation, ownership of achievements, numeric inflation, omitted qualifiers, dates, Unicode names, multicolumn/scanned résumés and exact source-to-field reconciliation.

Include all 16 audit probes and production checkpoint probes. D05 should become an explicit contextual-question evaluation, not a fake-provider failure counted as a product outage. D11 should include the full server planner and browser handshake, not only the isolated compatibility boundary. D12 needs realistic framework cases in addition to the adversarial synthetic-event boundary.

### Metrics and denominators

- **Correct autofill coverage:** independently correct, durably committed logical answers divided by eligible logical questions. Exclude declarations from this automation denominator but report them separately in overall required completion.
- **Required completion:** correctly completed required questions divided by applicable required questions; distinguish hidden future steps and employer-required-but-inapplicable fields.
- **Autofill precision:** correct automated answers divided by attempted automated answers. Track wrong fact, wrong unit, wrong context, wrong entity and failed commit separately.
- **Attribution:** ATS populated, Copilot populated, already present and user supplied are distinct origins, not a single “autofilled” number.
- **Abstention quality:** justified abstentions versus fillable questions unnecessarily deferred; never improve coverage by guessing sensitive or ambiguous answers.
- **Learning gain:** reduction in re-entry of recurring questions and increase in held-out correct coverage for the same candidate, relative to a frozen baseline using the same available facts.
- **Capture/recovery:** eligible manual observations retained; checkpoint replay exactly-once; change sets recoverable with Undo; pending/ask-again states understandable to the user.
- **Performance:** time to first correct fill, time to stable completion, p50/p95, AI attempts and cost per correctly completed eligible application. Separate cold/warm cache and provider failure conditions.
- **Safety:** unintended control interactions, overwritten user edits, cross-candidate leakage, unapproved declarations/submissions, cross-scope reuse and provenance loss.
- **Confidence:** reliability/error bins on held-out labeled cases. Do not label uncalibrated heuristic values as probability of correctness.

### Chronological learning experiment

Freeze a synthetic candidate's source facts and a set of reviewed updates. Evaluate at applications 1, 5, 10 and 20. Train only on earlier permitted observations; hold out later wording, layout and some ATS families. Pair the learning-enabled system with a frozen-memory baseline using equivalent job/question mixes. Include a second sequence with a salary/notice/location change so stale reuse is penalized. Report sample counts and uncertainty; do not select only successfully mapped questions.

An important numerical correction: **56 months is 4 years 8 months; flooring 56/12 gives 4, not 5.** A “completed years” field should not become 5. A range option or a documented rounding convention may have different rules, which must be explicitly tested.

### Release gates

Immediate gates: all curated safety counterexamples must pass with **zero** unintended submissions/acknowledgements, user-edit overwrites, cross-popup clicks, unauthorized cross-scope reuse or inflated numeric claims in that corpus. Require exact render/parse invariants for supported units, no orphaned checkpoint receipt under injected crashes, and one logical field per grouped question. These are **proposed test gates**, not claims of current universal zero risk.

For broader quality, first establish a labeled baseline; then require improvement in held-out correct coverage and repeated-question re-entry without reduced precision or worse safety. Set latency/cost limits from that measured baseline and an agreed product budget. A statistically unsupported “95% accurate” claim would be less useful than a clear, reproducible smaller benchmark.

### Résumé extraction, matching and generated documents

The supplied résumé/profile history is not enough to claim best-in-world extraction or matching. The extraction path can use AI to supplement missing deterministic fields, but that does not guarantee it corrects a confidently wrong deterministic value. Text extraction also needs a separate evaluated scanned-document/OCR path; AI structured output alone cannot recover text that was never extracted. Job matching needs independently labeled required experience, seniority, mandatory skills, location/work-mode constraints and explicit disqualifiers—not just an attractive aggregate score.

The document error is not safely solved by weakening the grounding validator. **D15 reproduces acceptance of a contradiction:** source “I supported Kubernetes migrations, but did not lead teams” permits generated “I lead Kubernetes teams.” Bag-of-words support loses negation and attribution. It can also reject useful legitimate paraphrases. The generation bridge selects trusted claims with an exclusion list but no explicit job-scope/freshness/purpose allowlist at that point; compensation/notice-like details can be unnecessarily included in the generation context. No actual outward leak was demonstrated in this audit. [Generation validator][generation], [document bridge][document-bridge].

Use explicit claim-to-source relationships, number/entity/negation checks, conservative templates where appropriate, and purpose-scoped inputs. Explain rejected claims to the candidate without turning generated prose into profile truth. Keep résumé extraction accuracy, document factuality, ATS readability and job-ranking quality as separate evaluations.

## 13. What NOT to change

- Keep the typed Candidate Truth authority, provenance, immutable history, optimistic concurrency and reversible change sets. Repair the transaction seam rather than replacing the database model.
- Keep candidate isolation and encrypted private staging. Do not resurrect shared answer memory containing personal values.
- Keep explicit declaration/consent boundaries and user-controlled submission. A one-click application can be irreversible even when no form appears.
- Keep ownership/staleness guards and bounded safe execution primitives. Do not use AI-generated arbitrary DOM programs to bypass missing capabilities.
- Keep separate semantic, candidate, representation, entity and execution responsibilities—but give them shared contracts and distinct outcomes.
- Keep centralized provider routing, budgets, schema validation and diagnostic failure codes. Improve validation, not by accepting any well-formed model response.
- Keep immutable approved document versions and application document linkage.
- Keep Q's controlled promotion/rollback for shared execution changes. It is a later-stage safety mechanism, not an answer-memory engine.
- Keep useful existing tests. Add outcome-level tests against real services instead of discarding the suite because it missed these boundaries.

## 14. Final verdict and competitive reality

**The target “application → autofill → review → submit” is achievable for a substantial, explicitly supported set of journeys. It is not currently demonstrated as a generally reliable outcome.** Most immediate failures arise from incomplete contracts and evidence flow between existing layers, not an inherently unsuitable architecture.

After the corrective work, fundamental limits remain: unavailable candidate facts; new employer-specific decisions; ambiguous questions; unsupported/closed controls and frame boundaries; authentication/CAPTCHA and platform restrictions; one-click irreversible actions; network/provider failure; inaccessible employer-side state; changing sites; and genuine declarations requiring a person. An adaptive product should identify and recover from those boundaries, not hide them behind “ready.”

Simplify's own current help describes supported-site autofill, profile-based filling, a manual fallback on unsupported sites and user submission. Its essay-question help describes profile/résumé/job-context drafting and exact-question answer reuse, with different wording potentially requiring a different response. These are useful comparison dimensions, not independent proof of their field-level accuracy. Their advertised website support percentage must not be compared with your per-field completion count. [Simplify autofill guide](https://help.simplify.jobs/articles/2415391-using-copilot-to-autofill-applications), [Simplify essay-answer guide](https://help.simplify.jobs/en/help/articles/7306766-answering-essay-questions-with-copilot).

Your defensible competitive opportunity is **correct India-specific representations, qualified reuse across paraphrases, stable entity handling, visible learning receipts/Undo and honest failure recovery**. Claiming superiority requires a consented head-to-head test on the same jobs, candidates, missing facts, control types and timing—not more phase-completion labels.

**Bottom line:** keep the strong safety and truth foundations. Fix representation, logical questions, verification and durable manual learning before expanding the roadmap. Then prove improvement with a production-backend chronological benchmark. Until then, neither “excellent extraction accuracy,” “world-class matching” nor “learns nearly everything after 20 forms” is supported by the available evidence.

## Source and reproduction index

The diagnostic scripts intentionally demonstrate present boundaries. Their successful exit means the stated reproduction completed, **not that the bugs are fixed**. Re-running the local metadata probe requires a configured local database and does not decrypt answers. Browser probes require local Chromium process permissions.

Preserved test output and reproduction commands are indexed in [the audit evidence guide](/Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/README.md). The historical metadata counts are preserved in this report; they are a snapshot, not a continuously updated dashboard.

[boundary-probe]: /Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/autofill-boundaries.mjs
[learning-probe]: /Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/verified-learning-boundaries.mjs
[local-probe]: /Users/mac/projects/job-hunter-agent/v2/audits/2026-09-12/local-evidence.mjs
[scanner]: /Users/mac/projects/job-hunter-agent/v2/apps/extension/src/content/scanner.ts:342
[capabilities]: /Users/mac/projects/job-hunter-agent/v2/apps/extension/src/content/capabilities.ts
[controller]: /Users/mac/projects/job-hunter-agent/v2/apps/extension/src/content/controller.ts:620
[executor]: /Users/mac/projects/job-hunter-agent/v2/apps/extension/src/content/executor.ts:150
[verifier]: /Users/mac/projects/job-hunter-agent/v2/apps/extension/src/content/verifier.ts
[execution-service]: /Users/mac/projects/job-hunter-agent/v2/packages/execution/src/service.ts:34
[representation]: /Users/mac/projects/job-hunter-agent/v2/packages/execution/src/representation.ts:89
[normalization]: /Users/mac/projects/job-hunter-agent/v2/packages/verified-learning/src/normalization.ts
[learning-service]: /Users/mac/projects/job-hunter-agent/v2/packages/verified-learning/src/service.ts:178
[truth-policy]: /Users/mac/projects/job-hunter-agent/v2/packages/candidate-truth/src/policy.ts
[ontology]: /Users/mac/projects/job-hunter-agent/v2/packages/field-intelligence/src/ontology.ts
[semantic-resolver]: /Users/mac/projects/job-hunter-agent/v2/packages/field-intelligence/src/semantic-resolver.ts
[intelligence-service]: /Users/mac/projects/job-hunter-agent/v2/packages/field-intelligence/src/service.ts
[proposals]: /Users/mac/projects/job-hunter-agent/v2/packages/field-intelligence/src/proposals.ts
[entities]: /Users/mac/projects/job-hunter-agent/v2/packages/repeatable-entities/src/service.ts:155
[graph]: /Users/mac/projects/job-hunter-agent/v2/packages/form-graph/src/model.ts:339
[ai-registry]: /Users/mac/projects/job-hunter-agent/v2/packages/ai/src/registry.ts
[strategy-service]: /Users/mac/projects/job-hunter-agent/v2/packages/strategy-intelligence/src/service.ts:102
[strategy-metrics]: /Users/mac/projects/job-hunter-agent/v2/packages/strategy-intelligence/src/metrics.ts:31
[strategy-bridge]: /Users/mac/projects/job-hunter-agent/v2/apps/api/src/strategy-bridges.ts:45
[generation]: /Users/mac/projects/job-hunter-agent/v2/packages/onboarding/src/generation.ts:104
[document-bridge]: /Users/mac/projects/job-hunter-agent/v2/apps/api/src/document-generation-bridges.ts:76
[learning-harness]: /Users/mac/projects/job-hunter-agent/v2/scripts/phase-l-browser-smoke.ts

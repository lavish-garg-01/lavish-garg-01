# Declaration and consent policy

Phase O adds one authorization boundary for declaration-like application controls. Technical support in K is never sufficient authority to act.

## Ownership and flow

The authoritative path is:

`I scan -> J semantic evidence -> O policy decision -> N current graph guard -> K execution/readback -> O application evidence`

- J identifies meaning and emits a separate declaration hint. It does not authorize interaction.
- O classifies the declaration and owns every automatic, prepare-for-review, manual, blocked, or unresolved decision.
- N determines whether the field is currently reachable. Requiredness and reachability never grant consent authority.
- Candidate Truth resolves ordinary reusable facts only. Declaration-like fields return `NOT_APPLICABLE` without a Candidate Truth lookup.
- K executes an O-authorized declaration with its existing checkbox mechanism and verifier. It rejects missing or stale authorization.
- L continues to learn verified candidate answers. Declaration receipts use the separate O evidence route and never become candidate answers.

## Taxonomy and version

Policy version `O1-2026-09` recognizes:

- accuracy certification;
- privacy acknowledgement;
- terms acknowledgement;
- background-check consent;
- data-processing consent;
- applicant certification;
- EEO or voluntary-disclosure acknowledgement;
- application-specific acknowledgement;
- unknown declaration.

Every classification carries bounded structured evidence, semantic confidence, text-evidence availability, materiality, requiredness, review requirements and reuse policy. Every declaration is currently `reusePolicy = NEVER`.

## Current policy matrix

- Accuracy certification: high-confidence, fully inspectable, current controls may be prepared only when final review is guaranteed. Candidate review remains required.
- Privacy acknowledgement: same prepare-for-review rule as accuracy certification.
- Terms acknowledgement: explicit candidate action.
- Background-check consent: explicit candidate action.
- Data-processing consent: explicit candidate action.
- Applicant certification: explicit candidate action.
- EEO acknowledgement: explicit candidate action; it is not demographic Candidate Truth.
- Application-specific acknowledgement: explicit candidate action.
- Unknown or ambiguous declaration language: unresolved and never executed.
- Missing material wording: candidate action required.
- Missing application identity, hidden/disabled/not-current controls, or stale graph context: blocked.
- Candidate-owned control: explicit candidate action; Copilot does not restore its earlier choice.
- Radio, select, combobox and other declarations requiring an option choice: explicit candidate action. O1 prepares only boolean checkbox/switch acknowledgements because no policy-authorized option-selection contract exists yet.

No category is silently `AUTO_ALLOWED` in the current policy. The contract retains that outcome for a future reviewed policy version, but O1 does not issue it.

Required and optional controls follow the same category policy. Requiredness is recorded for review and operations, not used as an authorization branch.

## Execution authorization

A checkbox/switch declaration operation must contain an O authorization bound to:

- policy decision and declaration canonical/type;
- application run, page, form, field and control fingerprint;
- J semantic descriptor fingerprint;
- exact N graph revision and fingerprint;
- the single permitted interaction, `SET_TRUE`;
- final-review requirement.

The operation contains no Candidate Truth answer version or scope. K rechecks all bound runtime identity immediately before the DOM mutation. A declaration can be attempted once. Generic checkbox plans without O authorization are contract-invalid.

## Candidate review UX

The side panel exposes a separate `Declarations & acknowledgements` area with:

- Prepared by Copilot;
- Needs your action;
- Review before submitting.

The panel uses candidate-facing category names and required/optional context. It does not render policy versions, canonical IDs, field runtime IDs, fingerprints, or internal risk/failure enum names. It reminds the candidate that these choices are application-only and must be reviewed before submission.

Phase O does not change the final-submit boundary. No automatic final submission is introduced.

## Application evidence

`application_declaration_evidence` is append-only and account-RLS protected. It stores only application/run/page/form/control/descriptor/graph identity plus category, confidence, historical policy version and outcome, action origin, execution/readback status, candidate modification, review/checkpoint state and timestamps.

The schema intentionally has no raw declaration body, field value, normalized value, Candidate Truth answer ID, or answer version. Update and delete triggers reject mutation. Every non-decision event must match the exact prior application-scoped `POLICY_DECIDED` authority. Duplicate event keys replay idempotently; a changed replay fails.

Recorded transitions include policy decision, prepared/automatic interaction, candidate action, candidate modification, execution/readback failure, review presentation and verified submission. A candidate override appends a new event; it does not rewrite the earlier prepared event.

Historical rows keep the original policy version and decision. Aggregate and attention indexes support future Phase T operational reporting by category, policy outcome, event and failure without building an admin panel in Phase O.

## Failures and privacy

O failures remain distinct from ordinary K failures: unresolved, policy blocked, candidate action required, text unavailable, ambiguous policy, authorization missing, execution failure, verification failure, candidate modified, stale, and context changed.

Generic telemetry contains no declaration wording or checkbox value. Side-panel/runtime storage carries bounded value-free review metadata only. Policy decisions are deterministic and reuse J's stable semantic cache; application authorization is never cached globally.

Linked legal documents are not crawled or legally analyzed. Incomplete wording cannot become automatic authority. AI may later assist J classification behind the existing abstraction, but it cannot grant O authorization.

## Legacy and future boundaries

The content controller's hardcoded declaration canonical exclusion was removed. Typed J declaration metadata is now the sole switch away from L. No second executor or label-keyword click path exists. Existing Candidate Truth declaration compatibility definitions remain temporarily because the shared registry predates O, but Field Intelligence prevents resolution/persistence and O is the only interaction authority.

Deferred work belongs to later phases:

- provider/model routing for ambiguous semantics: Phase P;
- technical strategy performance learning without policy authority: Phase Q;
- admin policy UI: Phase T;
- broad real-ATS certification: Phase U;
- removal of legacy compatibility definitions/tables only after Phase Z zero-read/write proof.

# Derived answers and passive candidate learning

Status: accepted roadmap addition, 2026-09-14. Source: user-linked conversation “Explain Remaining Work” (6aa7860c-19f4-83ee-9e2c-4441b42564bb). This plan follows checkpoint 14 and can proceed alongside supervised real-form testing.

The conversation's 320-case results and projected coverage percentages are design estimates. There is no executed 320-case corpus supplied with that conversation. They are not current product measurements or acceptance evidence.

## Implementation order

1. **Question semantics and provenance.** Extend the question contract with answer intent, qualifiers (skill, destination, company, work schedule), comparator/threshold, units, temporal anchor and required representation. Add DIRECT, DERIVED, LEARNED, PREDICTED and GENERATED origins with source version IDs, rule/model version, scope, expiry and review status. Preserve explicit candidate overrides before selecting derived or predicted alternatives.
2. **Deterministic answer derivation.** Introduce a versioned answer-derivation package for duration/experience comparisons, skill thresholds, salary conversion, location matching and availability calculations. Reuse existing converters. Missing prerequisites or ambiguous compound questions abstain. Experience in a skill requires skill-specific evidence; total tenure cannot stand in for it. Overlapping employment periods must not be double counted.
3. **Candidate hypotheses and prediction feedback.** Store candidate-owned hypotheses separately from Candidate Truth. Record prediction, actual final value, source, application/company context, observed manual edits and verified submission evidence. Repeated independent manual answers/corrections can support scoped preferences. An unchanged autofilled submission is weak evidence and cannot alone promote a prediction to trusted truth; duplicate submissions and repeated self-generated predictions must not inflate confidence. Support contradiction, decay, expiry, undo and deletion.
4. **Scoped resolver integration.** Resolve explicit applicable truth first, then valid deterministic derivations, applicable learned preferences, reviewable predictions, grounded generation and abstention. Resolve compound location/schedule/relocation commitments separately. Support existing scope policies; any new COMPANY_ROLE scope needs a deliberate schema/policy migration. Never silently generalize application commitments across employers.
5. **Evaluation and rollout.** Build at least 320 independently labelled question cases across direct facts, units/dates, joining, skill experience, work mode/relocation, application history, sensitive/declaration and narrative questions. Add chronological 1/3/5/10/20-application sequences, separate holdouts and a frozen baseline. Measure correctness, wrong answers, abstention, scope/provenance mistakes and correction rates. First run predictions in shadow mode; enable reviewable fills only after evidence supports the relevant family. Shared cross-candidate rules continue through independent evaluation, operator approval and governed release.

## Joining-date behavior

30 days after 14 September 2026 is 14 October 2026 **if 14 September is the applicable notice-start anchor**. An application date alone does not establish when notice begins. If the anchor is assumed, the result is an estimate rather than a committed earliest date.

With an evidenced or chosen month-start preference, a suggested date may be 1 November 2026. Store the preference, date basis and rounding rule separately. Do not assume everyone prefers the first. Define exact-first behavior, maximum rounding delay, weekends/holidays, timezone, leap years, notice already served, offer-relative starts and employer deadline conflicts. Predicted availability cannot establish a legal or contractual commitment merely through arithmetic.

## Learning controls

Use informed opt-in for passive candidate learning with clear pause/clear/undo controls. Do not infer consent, attestations, demographics or legal facts from other users or from unanswered fields. Source/referral history must remain truthful for the actual application. Explicit manual corrections carry stronger evidence than unchanged automation. Refresh or invalidate predictions when source facts, scope, time or question qualifiers change. Keep candidate values out of structural telemetry and operator aggregates.

## Test now, implement next

Supervised live testing can start with the existing direct-answer, representation and confirmed-reuse pipeline. Log unanswered reasoning questions as input to this plan. Do not delay that baseline until predictions exist. No passive prediction or automatic trust-promotion feature is activated by this document.

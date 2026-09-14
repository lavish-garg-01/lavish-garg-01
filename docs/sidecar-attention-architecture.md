# Sidecar and Attention Architecture

The product objective is to bring applications safely to **Ready for Review**, not to maximize typing speed.

## Implemented foundation

- Native Chrome Side Panel backed by the same persisted application state as the web app.
- Scan-first `PLAN_READY` flow; page mutation requires an explicit **Fill safe fields** action.
- Provenance labels instead of exposing numeric AI confidence.
- Persisted, value-free application plan summaries.
- Persisted Attention Items for facts, preferences, conflicts, sensitive/legal steps, uploads, and draft review.
- Global Attention Center at `/attention` plus an extension badge count.
- Existing portal values are never overwritten silently; conflicts require a user choice.
- Focused/user-edited fields are skipped, and current-run autofill can be undone.
- Stop and Pause persist in extension state.
- User corrections do not silently replace an existing profile fact; an explicit Update action is required.
- Sanitized learning events record signal type, scope, and approval without raw candidate values.
- Review-only submission and verified-success requirements remain mandatory.

## Architectural boundaries

1. Candidate learning stores confirmed facts and preferences.
2. Application learning stores per-application answers, outcomes, and corrections.
3. Portal learning stores structural selectors, mappings, and sanitized failures only.
4. Webpage text is untrusted input. It may influence question interpretation, never policy, permissions, tools, or data access.
5. Content scripts receive only the exact answer required for the current detected field. Quick Copy and aggregate state remain in trusted extension pages.

## Next implementation order

1. Replace broad host access with an `activeTab` plus optional per-portal permission flow without breaking cross-domain ATS redirects.
2. Add explicit compensation and availability data models with freshness/conflict rules.
3. Add risk-grouped AI draft review and separate writing-style memory.
4. Add conditional-field rescanning and verified resume-parser reconciliation.
5. Build the deliberately difficult multi-page mock ATS fixture and acceptance metrics.
6. Add cross-application batch attention resolution and category-specific autofill policies.

No later feature may weaken these invariants: no invented facts, no sensitive inference, no legal auto-acceptance, no silent overwrite, no duplicate submission, and no unverified success.

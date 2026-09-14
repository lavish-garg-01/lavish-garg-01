# Part 2A — candidate-answer policy and persistent truth foundation

Implemented locally on 2026-08-31. This increment adds the policy/context authority for every active canonical and the requested append-only candidate-truth substrate. It does not enable automatic learning from browser corrections, change-set Undo, or automatic submission.

## Runtime ownership

- `src/services/answerPolicyRegistry.js`: immutable policy versions and one active pointer for every canonical.
- `src/services/answerContextNormalization.js`: controlled country, employer group, role family, location and employment-type context. Legal/entity reuse never relies on fuzzy employer similarity.
- `src/services/scopeRankPolicy.js`: ordered scope vectors, compatibility and stable scope hashes.
- `src/services/candidateAnswerFreshness.js`: policy-specific expiry and reconfirmation decisions.
- `src/services/candidateAnswerAnomaly.js`: deterministic shape, range, compensation delta and unit-change review signals.
- `src/repositories/candidateAnswerVersionRepository.js`: candidate-private append-only versions, exact-value hashing, expected-version concurrency, idempotent write receipts, best-scope resolution and atomic dependency invalidation.
- `src/services/candidateAnswerPolicyParity.js`: optional diagnostic comparison with the legacy policy. It is SHADOW-only and cannot mutate production behavior.

## Persistence

`0013_candidate_answer_intelligence` is applied and immutable. It adds policy profiles, policy versions, active pointers, exact context registries, candidate answer versions, write receipts and dependency events. `0014_employer_entity_exact_aliases` is the forward-only follow-up that allows multiple exact source company IDs to map to the same controlled employer group.

Candidate truth has one active row per candidate, canonical and scope hash. Replacing a value supersedes the old row; history is never overwritten. The replacement, idempotency receipt and all dependent-answer invalidations commit in one SQLite transaction.

## API

- `GET /api/v1/candidate-truth/policies?keys=EMAIL,NOTICE_PERIOD`
- `POST /api/v1/candidate-truth/resolve`
- `POST /api/v1/candidate-truth/field-answer-contracts` returns Part 2B candidate-private contracts in SHADOW; it never changes the production answer.
- `GET /api/v1/candidate-truth/history?canonicalKey=EMAIL`
- `POST /api/v1/candidate-truth/:canonicalKey/versions` with an `Idempotency-Key` header and the active version observed by the client.
- `GET /api/v1/admin/candidate-answer-policies` exposes policy/context/count diagnostics only; candidate values are intentionally absent.
- `PUT /api/v1/admin/candidate-answer-policies/parity` toggles diagnostic comparison only.

The local write API requires an explicit candidate action, a typed `NormalizedValue`, an exact controlled scope where required, optimistic concurrency, and an idempotency key. Legal and employer-scoped facts reject derived sources.

## Safety and rollout

- Unknown required country/employer/application context returns `NEEDS_USER`.
- Equal-rank, non-equivalent values return `NEEDS_USER`; recency never breaks the tie.
- Stale mutable facts suggest reconfirmation instead of autofill.
- Protected/voluntary EEO values cannot enter reusable truth.
- Candidate answer values never enter semantic mappings, adaptive shared evidence, admin diagnostics or the context registry.
- `supabase/phase2_candidate_truth_rls.sql` is a checked future contract: candidate rows are own-row readable and all mutations remain server/service-only. It is not a claim that Supabase is deployed.
- The production question resolver remains on its compatibility path by default. Part 2B now provides the `FieldAnswerContract`, safe legacy migration, value-redacted staged resolver parity and immutable checkpoint-qualified learning change sets. Append-only Undo, grouped review UX and final primary cutover remain pending.

Verification: `npm run check:part2a`.

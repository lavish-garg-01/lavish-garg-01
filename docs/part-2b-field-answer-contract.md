# Part 2B — Field Answer Contract, scoped learning, change sets and safe reversal

Implemented locally on 2026-08-31. This slice connects Part 1 field meaning to Part 2A candidate truth through the frozen `FieldAnswerContract`. The installation defaults to `SHADOW_COMPARE`: the established `questionResolver` still supplies the production autofill answer while the versioned result is compared through a value-redacted ledger.

## Runtime flow

```text
trusted FieldSemanticResult
  -> active canonical policy
  -> normalized controlled context
  -> best compatible active candidate truth
  -> policy-version + value-hash + freshness checks
  -> narrow deterministic representation
  -> validated FieldAnswerContract
```

`src/services/fieldAnswerContractService.js` owns the boundary. `buildFieldAnswerContracts` accepts up to 100 fields and uses the repository batch resolver so one page does not perform a candidate-answer query for every control.

## Policy-aware legacy migration

`src/services/candidateAnswerLegacyMigrationService.js` is the one-way compatibility bridge from raw local profile, verified master resume, candidate-approved fact memory and explicitly candidate-entered legacy answers into `candidate_answer_versions`. Migration `0015_candidate_answer_legacy_migration` adds candidate-private run/item audit tables. A run is one ACID transaction and is idempotent by candidate, migration version and a deterministic source snapshot fingerprint.

It migrates only values that are all of the following:

- governed by an active `STABLE_FACT`, `MUTABLE_FACT`, or `PREFERENCE` policy;
- safely convertible to the policy's normalized value type;
- unambiguous across every available legacy source;
- not already contradicted by an active candidate-truth version;
- independent of missing application, jurisdiction, employer or repeatable-entity context.

Salary values are explicitly converted from the product's legacy LPA unit to exact annual INR. A profile's default relocation `false` is not treated as candidate intent. Legal facts, entity-scoped facts, repeatable education/experience values, files, generated text, low-confidence answers, application-scoped memory and source conflicts remain untouched with a reason code.

Startup applies this safe bridge once per source snapshot. The admin policy page can preview or replay it, but receives only counts and reason codes. `candidate_answer_migration_runs` and `candidate_answer_migration_items` retain hashes and provenance identifiers—not raw candidate values. Supabase's future RLS contract makes these audit rows own-row readable and service-write-only.

The extension's existing `/api/extension/jobs/:id/resolve-fields` response now includes each field's `fieldAnswerResolution` plus:

```json
{
  "candidateTruthContracts": {
    "mode": "SHADOW",
    "resolver": {
      "mode": "SHADOW_COMPARE",
      "canaryPercent": 0,
      "gatePassed": false
    },
    "productionApplied": false
  }
}
```

The candidate-private frontend API is:

```text
POST /api/v1/candidate-truth/field-answer-contracts
```

Its input contains a frozen `FieldSemanticResult`, bounded control metadata and application context. The output contains `READY`, `REVIEW_REQUIRED`, or `NEEDS_USER`, reason codes, the shared policy summary, and a contract only when all safety checks pass.

## Baseline representation policy

This slice supports only transformations that can be proven without inference:

- text, rich text and URL identity;
- exact integers and decimals;
- exact enabled option matching for string, integer and enum values;
- unambiguous Yes/No option matching and checkbox booleans;
- full ISO dates for date controls and year-month values for month controls.

It intentionally refuses money, duration, phone-part, date-range, address, multi-enum, entity, file and unknown representations. It also refuses ambiguous/disabled options and untrusted employer regex patterns. Those require the packaged representation registry and browser validity receipts in Part 2D.

## Safety invariants

- Only `RESOLVED` semantic contracts can reach candidate truth.
- Protected, ambiguous, unknown or malformed semantics return no answer contract.
- Unknown required jurisdiction/employer context, stale truth and scope mismatch return no answer contract.
- The active policy version must match the answer's policy version.
- The persisted normalized value hash is recomputed before use.
- Contract IDs are stable across identical semantic, truth, policy and representation versions.
- Review policy remains explicit; legal facts are prepared for review rather than silently marked ready.
- A SHADOW comparison or ledger error cannot interrupt the established extension resolver.
- Runtime parity stores only SHA-256 comparison digests, decisions, versions, scope-free identifiers and reason codes; it never stores a candidate value.
- The same page/result creates one idempotent parity receipt.
- A page commits up to 100 parity receipts in one short transaction; there is no database round-trip/autocommit per field.
- Option-like controls compare case-insensitively; free text remains exact so capitalization changes are not silently treated as equivalent.
- `LEGACY_ONLY` and `SHADOW_COMPARE` can never select a versioned production answer.
- `CANARY` requires at least 100 recent comparisons, 98% decision agreement, zero value mismatches and zero unsafe selections. It is deterministic, capped at 10%, low-risk only and requires an exact parity match.
- Application drafts, review-required contracts, legal/sensitive classifications and non-low-risk policies can never enter canary.
- `VERSIONED_PRIMARY` remains blocked until verified browser outcomes and correction attribution are implemented.
- Resolver-mode flag update and append-only mode-history receipt commit in one ACID transaction.
- SHADOW resolution remains read-only; candidate truth changes only through the explicit version writer, verified learning change sets, or candidate-triggered Undo/Restore services.

## Staged resolver operations

`src/services/candidateAnswerResolver.js` is the single authority-selection boundary:

```text
LEGACY_ONLY
  -> legacy production, no comparison

SHADOW_COMPARE (default)
  -> legacy production + value-redacted comparison receipt

CANARY
  -> versioned only for a release-gated deterministic low-risk parity-match bucket
  -> legacy fallback for every other field

VERSIONED_PRIMARY
  -> implemented as a mode but deliberately release-blocked pending browser outcome evidence
```

Migration `0016_candidate_answer_resolution_parity` adds `candidate_answer_resolution_parity_events` and `candidate_answer_resolver_mode_history`. Admin diagnostics expose aggregate outcomes and gate failures, never hashes or values. Future Supabase parity rows are own-row readable and service-write-only; global mode history remains admin/service-only.

## Immutable application learning change sets

Migration `0017_candidate_answer_change_sets` adds candidate-private, append-only change sets, items and idempotency receipts. `candidateAnswerChangeSetService` accepts only proposals tied to:

- the same candidate, application and active run;
- a persisted `SUBMISSION` or `EXPLICIT_SAVE` checkpoint with `VERIFIED` status;
- a non-protected, direct candidate observation;
- a checkpoint-reclassified candidate-answer outcome marked eligible;
- the same logical field, canonical key and final-value digest;
- a normalized value whose deterministic rendered form matches that final digest;
- the active policy, exact controlled scope and expected active answer version.

At verified submission, `AUTO_VERSION` policies with `LOW` risk commit directly as `TRUSTED`. Three explicitly configured contextual preferences (`EXPECTED_CTC`, `RELOCATION`, and `PREFERRED_LOCATIONS`) use a smaller deterministic state machine: direct candidate input in a complete policy-defined scope creates `REVIEW`; the exact same scope may trial-reuse it; one unchanged verified submission appends a `TRUSTED` version. Legal, protected, incomplete-scope and other consequential values remain held. An `EXPLICIT_SAVE` candidate gesture may commit permitted non-contextual policies after scope, source and anomaly checks pass.

One transaction contains every learned answer version, supersession, dependency invalidation, immutable change-set row/item, idempotency receipt and value-free completion-summary outbox event. A single failure rolls the entire set back. Dependencies being updated in the same set are excluded from intermediate invalidation so a current-company + current-role update cannot invalidate its own new values.

The change-set tables and outbox store IDs, hashes, canonical keys, policy presentation, transitions and reason codes—not raw values. Exact normalized values remain only in the candidate-private answer-version store. Database triggers reject update/delete attempts on committed sets and items.

The Part 2C local canary now stages candidate-private proposals on the server and commits them only from a verified submission or explicit-save checkpoint. The extension cannot attach proposal values to `CheckpointReceipt`; that contract and its durable outbox remain strictly value-free. The operator flag can disable the canary without affecting application completion.

## Scoped REVIEW → TRUSTED learning

`src/services/scopedCandidateAnswerLearning.js` defines one preferred override scope for each enabled contextual canonical. Learning never invents or broadens a scope. Expected compensation and relocation require exact employer-group + role-family + country context; preferred locations require role-family + country. A missing dimension remains application-only/review-required.

`candidate_answer_versions.learning_state` has only `REVIEW`, `TRUSTED`, and the inactive audit state `REMOVED`. No numerical confidence or historical scan is involved:

```text
candidate correction/manual entry in exact scope
  -> REVIEW
  -> exact-context trial reuse
  -> unchanged verified submission
  -> TRUSTED
```

A correction to either `REVIEW` or `TRUSTED` appends a new `REVIEW`. Repeated unchanged use of a trusted answer creates no candidate-truth write. Google/Backend/India and Amazon/Backend/India therefore remain independent scopes. If a correction returns to the global fallback, the contextual override is superseded by an inactive `REMOVED` audit version so resolution falls back globally without storing a duplicate active override.

## Append-only Undo and Restore

Migration `0019_candidate_answer_scoped_learning_undo` adds learning state/provenance and immutable `candidate_answer_reversal_*` records. `candidateAnswerReversalService` provides:

- change-set Undo that restores each still-current previous scoped answer;
- safe forgetting when the original change created a new scope;
- item-level `SKIPPED_NEWER_VERSION` outcomes instead of overwriting later edits;
- explicit historical Restore as a new trusted version;
- one ACID transaction, idempotency receipt and value-free outbox event per operation.

Undo/Restore never updates or deletes the original change-set audit. It appends a compensating answer version (or an inactive removal version when no prior answer existed). The Profile page shows recent learned changes, quiet Undo, older answer Restore, and an honest message when a newer answer was kept.

## Still pending after Part 2C capture

1. Verified browser-outcome gate and controlled production-primary cutover.
2. Compatibility fallback removal after sustained production evidence.
3. Part 2D representation learning, including accepted equivalent formats.
4. Phase 2F revision-bound grouped declarations and high-impact authorization.

Verification: `npm run check:part2b-contract`, `npm run check:part2b-migration`, `npm run check:part2b-parity`, `npm run check:part2b-change-sets`, `npm run check:part2b-undo` and `npm run check:part2c` under Node 24.

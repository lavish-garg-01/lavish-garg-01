# Phase L — Verified Learning Loop

Phase L is complete. It adds one evidence-driven path from a candidate's committed application answer to reusable Candidate Truth. It does not create a second learned-answer store and it never treats a DOM change, execution success or page navigation as permanent learning on its own.

## Authoritative lifecycle

```text
website launch
  -> authenticated database application/run
  -> J resolves a high-confidence canonical and stable entity context
  -> Candidate Truth is missing, REVIEW, or returns a reusable version
  -> K records value-free execution/readback evidence when it acts
  -> candidate commits a manual answer or correction
  -> private value is normalized, fingerprinted and encrypted for seven days
  -> value-free observation references that private proposal
  -> candidate performs a trusted submit action
  -> success URL and visible success marker jointly verify submission
  -> exact earlier same-run observations are consumed
  -> one grouped Candidate Truth change set commits atomically
  -> side panel shows a candidate-facing result
  -> E4 Undo reverses only versions still current
```

Future reuse remains the existing authority chain:

```text
J canonical/entity resolution
  -> CandidateTruthResolver policy, scope, trust and freshness checks
  -> K representation
  -> K execution
  -> independent K readback
```

There is no `last form value -> next form` shortcut.

## Contracts and API boundary

`packages/contracts/src/learning.ts` owns strict versioned contracts for:

- starting a database-backed application run;
- persisting value-free K execution evidence;
- candidate-private manual/correction/confirmation observations;
- trusted submit attempts;
- verified submission signals;
- grouped learning results; and
- grouped Undo results.

The protected API routes are:

- `POST /v1/learning/runs`
- `POST /v1/learning/execution-evidence`
- `POST /v1/learning/observations`
- `POST /v1/learning/submit-attempts`
- `POST /v1/learning/checkpoints/submission`
- `POST /v1/learning/change-sets/:changeSetId/undo`

Every route derives account and candidate ownership from the bearer session. Caller-supplied candidate identity is not accepted. Stable idempotency keys bind launch, observation, submit, checkpoint and Undo retries.

K execution operations and receipts now include the exact Candidate Truth answer-scope fingerprint. This prevents a correction from being attached to a different answer version or scope.

## Persistence and transaction model

Migration `0015_verified_learning_loop.sql` adds:

- `candidate_learning_run_receipts` — replay-safe launch authority;
- `application_execution_evidence` — value-free K operation/readback evidence;
- `candidate_learning_observations` — immutable, value-free links to private proposals;
- `candidate_learning_submit_attempts` — exact trusted-submit evidence; and
- `candidate_learning_checkpoint_receipts` — replay-safe verified/finalized results.

All five tables are candidate-owned, RLS-enabled and constrained to the authoritative application/run records. Observations can move only from `RECORDED` to `CONSUMED`, `SKIPPED` or `EXPIRED`; a database trigger prevents other mutation.

Candidate values are stored only in the existing encrypted `candidate_answer_runtime_proposals` boundary. They expire after seven days if no verified checkpoint consumes them. Generic application events and outbox payloads contain identifiers, canonical metadata and outcomes, never raw answers.

A verified checkpoint:

1. takes a candidate/idempotency advisory transaction lock;
2. requires an exact recent submit-attempt timestamp for the same active run;
3. marks the application submitted and run completed;
4. creates one verified submission checkpoint and receipt;
5. loads only earlier, unexpired same-run observations;
6. decrypts and fingerprint-checks inside the private service boundary;
7. deduplicates multiple revisions of the same canonical/entity/scope to the latest;
8. commits one grouped Candidate Truth change set with expected-current OCC; and
9. finalizes observation/proposal and checkpoint result state in a replay-safe transaction.

Candidate Truth group commit and evidence finalization are separate bounded transactions. If the process stops between them, the checkpoint's stable Candidate Truth idempotency key replays the already-committed group and then completes finalization; it does not create a second version or change set.

Concurrent delivery of the same checkpoint returns the one finalized result. A stale application encountering newer Candidate Truth becomes a visible safe conflict; it cannot overwrite the newer answer.

## Observation and attribution rules

Content observes committed candidate `change` events with a bounded debounce. Pending committed observations are flushed before the trusted submit attempt. No network request is made for every keystroke.

Learning requires:

- an authenticated database application/run;
- `RESOLVED_HIGH` semantics with confidence at least `0.88`;
- a policy that permits `VERIFIED_SUBMISSION` learning;
- an exact valid scope;
- stable candidate entity identity for entity canonicals; and
- candidate origin or a verified K trial confirmation.

It fails closed for unresolved/ambiguous semantics, passwords, CAPTCHA, payment/authentication inputs, file controls, protected EEO fields, declarations/consents, unsupported controls, hidden/debug fields, unstable entity binding and foreign/stale runtime identity.

Corrections remain typed:

- K `VERIFIED` readback plus candidate overwrite -> candidate-answer correction;
- representation failure -> `REPRESENTATION_SUSPECT`;
- execution/verifier failure -> `INTERACTION_SUSPECT`;
- uncertain origin/cause -> `AMBIGUOUS`.

Only candidate-answer entry/correction/confirmation reaches Candidate Truth. Representation, interaction and ambiguous evidence cannot reward or punish semantic mappings and cannot mutate candidate truth.

## Candidate Truth transitions

`CandidateTruthService.saveVerifiedLearningGroup` is the sole permanent mutation authority.

- First stable `AUTO_VERSION` manual fact -> append `TRUSTED`.
- First `REVIEW_TO_SAVE` value -> append `REVIEW`; future exact context may trial-reuse it.
- Exact current `REVIEW` reused unchanged at verified submission -> append `TRUSTED` with `PROMOTE_TRUSTED`.
- Candidate correction of current `REVIEW` -> append a new scoped `REVIEW` with `CORRECT_REVIEW`.
- Candidate correction of existing truth -> append according to the canonical policy; history is never rewritten.
- Same current, no-expiry `TRUSTED` value -> skip duplicate version creation.
- Multiple fields from one application -> one ACID grouped change set.

Existing policy remains authoritative for application/search/company/job/global scope, legal jurisdiction, contextual overrides, sensitivity, trust, freshness and stable repeatable entity identity. Phase L never widens an answer automatically.

## Candidate UX and Undo

The side panel displays only committed outcomes:

- `Updated for next time`
- `We'll check this next time`
- `Some updates were saved`
- `Couldn't save this update`
- `No reusable answers changed`

The panel refreshes visible local runtime status once per second, so a verified post-submission result appears without reopening it. This polling reads extension-local value-free status; it does not poll the backend.

One application change set has one Undo action. Undo calls the E4 reversal service and can return full reversal, partial reversal, no-op or idempotent replay. A newer profile/application answer is always kept. The side panel translates that result to `Updates undone`, `Some updates undone`, or `Nothing needed changing`.

Restore remains the existing append-only Candidate Truth history operation; Phase L does not add a browser-local rollback stack.

## Browser certification

`scripts/phase-l-browser-smoke.ts` runs an unpacked MV3 Chromium flow covering:

- two unknown manual answers committed as one grouped update;
- different wording on a later application and verified K reuse;
- candidate correction after K readback and future corrected reuse;
- abandoned application with no permanent learning;
- trusted submit without sufficient success evidence;
- failed K interaction followed by a human value, with no Candidate Truth poisoning;
- stable repeatable employment entity learning and reuse;
- partial-safe grouped Undo that keeps a newer answer;
- automatically refreshed candidate-facing side-panel feedback;
- clean page/service-worker consoles; and
- no candidate values in extension session/local storage.

The database integration suite additionally behavior-locks missing-submit rejection, duplicate message replay, concurrent checkpoint delivery, one logical version/change set, same stable-answer deduplication, stale-current conflict, grouped Candidate Truth mutation and value-free events.

## Genuine limitations and deferred owners

- Phase L consumes committed candidate `change` outcomes. If a nonstandard form removes a field before the browser emits a committed change, the value is skipped rather than inferred. Dynamic form orchestration belongs to Phase N.
- Ordinal-only repeatable bindings are not learnable. Phase M supplies an exact `BOUND_HIGH` candidate entity UUID/version/revision, and L transactionally revalidates it before recording or committing learning.
- Representation and interaction failures are typed but do not autonomously update strategies or mappings. Phase Q owns evidence weighting, promotion and canaries.
- Declarations/consents remain outside reusable Candidate Truth. A dedicated grouped candidate-authorization UX is still required before those controls can be automated.
- Closed shadow roots, inaccessible cross-origin frames, document upload and unrecognized widgets retain the prior I/J/K limitations.
- The frozen external V1 code is not imported or executed by V2. Its files, dependencies and tables remain until the Phase Z cutover proves zero reads/writes, rollback and soak; database tables are removed last.

## Verification result

Node `24.8.0` final gate:

- architecture check, lint and typecheck: pass;
- complete automated suite: **203 pass, 0 fail, 0 skip**;
- Phase I, J, K and L unpacked-Chromium suites: pass;
- production web and default localhost extension build: pass.

No Git commit, push, remote, deployment, hosting or release operation was performed.

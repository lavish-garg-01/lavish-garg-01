# Strategy Intelligence — Phase Q

Status: Q1–Q8 COMPLETE. Policy: Q1-2026-09. The authoritative verification record is [IMPLEMENTATION_CHECKPOINT.md](IMPLEMENTATION_CHECKPOINT.md).

## Ownership and activation

Q evolves compatible preference around K. J owns meaning, M entities, N reachability, O declarations, Candidate Truth facts, K execution/verification, L learning and P provider routing. Q cannot override these owners, submit an application, mutate source code or execute arbitrary generated JavaScript.

Run `npm run db:migrate` through migrations0019/0020 before API startup. Q composition and its worker are enabled by default with database/HMAC configuration. Explicit `STRATEGY_INTELLIGENCE_ENABLED=false` restores pre-Q K selection. This operational opt-out is NOT an emergency strategy control: bypassing Q also bypasses its learned exclusions. No candidate receives real-user exposure without reviewer validation and a separate CANARY command. Existing stable implementations remain the initial preference.

## Q1 — Registry and immutable versions

Shared contracts/strategy-policy.ts centralizes ten existing K identities: NATIVE_VALUE_SETTER, DIRECT_PROPERTY_EVENTS_FALLBACK, CONTENTEDITABLE_TEXT, NATIVE_SELECT_EXACT, NATIVE_MULTISELECT_EXACT, NATIVE_CHECKED_SETTER, NATIVE_RADIO_EXACT_LABEL, ARIA_COMBOBOX_EXACT_OPTION, ARIA_RADIO_EXACT_LABEL and ARIA_TOGGLE, all @1. Compatibility yields variable-length lists, including zero when nothing is safe. No manufactured backups.

packages/strategy-intelligence owns definitions and pattern-scoped STABLE/CANDIDATE/CANARY/DEGRADED/DISABLED/REJECTED/RETIRED state. Candidate identity hashes cluster and immutable plan; changed behavior creates a distinct versioned identity. Definitions reuse strategy_versions. Migration0019 adds policy snapshots, append-only transitions, operation bindings and evidence.

Clusters include capability, representation version/kind, ATS family and a hash of host plus structural control/layout characteristics, never labels, answers or raw DOM. Structural changes isolate evidence. Behavior changes with unchanged structure require new runtime evidence; no script-version detector is claimed.

## Q2/Q3 — Evidence, attribution and opportunities

The authorized K planner supplies Q preference only after normal authority checks. Declarations bypass experiments. Definitions are fetched once, clusters memoized per batch, and bindings inserted atomically (bounded batch) against account/candidate, active run, operation/page/field, representation and policy revision. L receipt persistence atomically schedules Q ingestion. The worker checks receipt context and ordered attempts against that binding; changed replays/foreign assignments fail closed.

Technical success requires execution AND independent verification with no attributed failure. Separate attribution includes execution, verifier, representation, semantics, truth, entity, graph, runtime, site change, policy, user and unknown. A readback mismatch is a verifier failure, not automatic proof that a new DOM strategy is needed. User overwrite never changes technical success or independently creates an execution opportunity.

Version/cluster-specific metrics include attempts, verified successes, verifier/execution failures, retry successes, latency, fallback, distinct users and separate correction signals. Recent means seven days. The helper's lifetime field summarizes its supplied observation window, NOT an unlimited historical total: operator inspection fetches at most10,000 events over30 days, retaining severe events first. Full historical evidence remains append-only in PostgreSQL.

L observations carry a bounded Q projection: up to12 structural event enums plus committed/keep/overwrite flags, never typed text or character keys. Runtime collects trusted focus/type/ArrowDown/Enter patterns; not every declared enum is emitted. Feedback requires the persisted same-run/page/field observation and prior operation. It is not another technical attempt. Shared preference excludes non-contributing accounts.

Opportunities require >=5 unique execution-failure operations across >=3 candidate/account units within7 days. Semantic, representation, truth, graph and policy corrections cannot trigger discovery.

## Q4 — Deterministic and P-assisted proposals

Known compatible alternatives precede a safe native-text template when successful manual structure accompanies actual failed operations. Only unresolved opportunities invoke P: GENERATE_STRATEGY_CANDIDATE selects supplied approved text/textarea plans; ANALYZE_EXECUTION_FAILURE provides bounded analysis for other controls. P and Q both validate output. Source evidence IDs and origin remain on the proposal. Provider failure preserves deterministic operation.

Plans are builtin references or bounded TARGET_TEXT sequences: FOCUS, SET_NATIVE_VALUE/SET_DIRECT_VALUE, INPUT, CHANGE, BLUR. Compatibility/order are validated. No selectors, arbitrary code, loops, navigation, submission or network primitives. New mechanisms remain developer/release work. Discovery never approves or starts experiments. The worker limits each cluster to one open proposal/experiment and suppresses already-reviewed evidence sets.

## Q5 — Independent offline validation

scripts/strategy-offline.ts bundles actual K executor/orchestrator/verifier into isolated Chromium with synthetic content and blocked external network. Current certifiable generated class: native text/textarea with TEXT representation. Other mechanisms require an expanded developer-owned fixture suite before canary; their existing K implementations continue normally.

Sixteen scenarios: normal text, textarea, React-style setter interception, rerender, delayed reversion, disabled target, prior ownership, mid-action intervention, graph change, page transition, unrelated-control side effect, dynamic fields, declaration refusal, duplicate execution, failed-candidate→verified-stable fallback, expired selection. Assertions verify isolation, events, independent readback, bounded execution, no consent/submit mutation and empty browser errors. A deliberately incompatible direct setter fails the framework fixture. Safety effects stop fallback.

Proof binds definition hash, suite version, all checks, timestamp and reviewer UUID to server HMAC. VALIDATE executes tests rather than importing an uploaded green proof. Approval rejects unsigned/altered/future/>7-day-old proofs and reviewer mismatch. A reviewer may renew a still-running canary's proof, but cannot reactivate a disabled/rejected version this way. This is independent synthetic validation, not live ATS certification or AI self-assessment.

## Q6/Q7 — Canary, promotion and recovery

HMAC deterministically assigns account/candidate/run/cluster/experiment to control/treatment. Assignment is stable within a stage; wider stages may move units into treatment. Stages:5%,20%,50%. Stable remains fallback when safe. Revision-bound server selections expire after30 seconds; extension refuses expired plans rather than restoring excluded strategies.

Each advance requires >=200 additional eligible samples per arm, >=20 candidate/account units per arm, at most10 samples per unit/arm and non-overlapping95% Wilson intervals. First attempts compare arms; fallback is separately measured. Treatment latency <=max(50ms,1.25×control), fallback/user rate <=control+2 percentage points, and fresh proof. One success or the same reused sample set cannot promote.

Any candidate safety violation halts/disables it, regardless of volume. Unsafe control evidence disables control and halts exposure. At >=30 treatment attempts, >15% failures halt; with >=30 control samples, a >10-point intervention increase or latency >max(100ms,2×control) also halts. Stable primary degrades at >=30 attempts across >=3 units with <80% verified success, or disables on a severe event. Only its cluster changes. A remaining compatible stable backup becomes preferred; no safe fallback means no execution.

Promotion prepends the new stable and retains former primary/history. Rollback restores safe former primary and degrades the promoted strategy. Retirement refuses primary/prior-primary/active-control dependencies and requires another stable fallback. DISABLE/REJECT stop exposure through internal controls; there is no public strategy-mutating endpoint.

SQL transactions, row locks, expected revision, unique idempotency keys and canonical action/payload fingerprints protect transitions. Evaluation retry replays the committed result after promotion/restart/later rollback without changing newer state. Concurrent promotions commit once. Unchanged evaluations are read-only; subsequent evidence needs a fresh command/current revision. Definitions/evidence/history remain immutable.

## Durable worker and operator review

Migration0020 adds a coalesced pending evaluation key/index to existing worker_jobs. INGEST/FEEDBACK schedule atomically with L; Q append atomically schedules EVALUATE. Claims use SKIP LOCKED, two-minute leases and exact owner tokens. Expired leases recover, retries wait10 seconds, eight failures become DEAD with sanitized codes. New evidence during processing schedules a successor. API lifecycle owns/awaits the loop; no detached AI on fill, no Redis.

Run `npm run strategy:admin -- /absolute/path/command.json` with OS/database access and server HMAC. Command shape (replace placeholders; no private answers):

```json
{
  "action": "INSPECT",
  "cluster": "<64-character cluster hash>",
  "command": {
    "expectedRevision": 0,
    "idempotencyKey": "<unique command ID>",
    "actorId": "<reviewer UUID>",
    "reason": "EVIDENCE_EVALUATION"
  }
}
```

Actions: INSPECT, DISCOVER (also accountId/candidateId for P accounting), VALIDATE (runs Chromium/records proof), CANARY, EVALUATE, DISABLE, REJECT, ROLLBACK, RETIRE. All except INSPECT/DISCOVER/EVALUATE need key. Refresh revision after mutations; reuse a command only for identical retry. Reasons include OFFLINE_APPROVED, EMERGENCY_DISABLE, REVIEW_REJECTED, ROLLBACK and COVERED_OBSOLETE. Reviewer UUIDs are operator-supplied audit identities, not a new operator-auth system; full T UI/auth remains future work.

Inspect Q worker_jobs status, attempt_count, lease_expires_at and last_error_code for recovery. Do not expose payloads publicly. DEAD work needs investigation; never truncate evidence or rewrite policy history to recover.

## Explicit boundaries

- Authenticated client receipts are linked to server authority, not cryptographic browser attestation. Diversity caps are not complete Sybil protection. Production hardening/ATS certification belongs to V/U.
- Automatic stop begins after durable ingestion. Already-issued plans can remain valid up to30 seconds; in-flight page effects cannot be remotely undone. Unrelated-native-control checks conservatively flag legitimate framework side effects too. Navigation detection covers observable page transitions, not all-browser monitoring.
- Readback observes a bounded window, not indefinite stability. Duplicate receipt cache covers1,000 recent operations per content runtime, not cross-navigation persistence.
- No new keys, live-provider certification or real-user experiments are needed for deterministic testing. No V1 runtime path was imported/deleted. R/S/T/U/V, deployment and real employer submission remain outside this phase.

## Verification

Use Node24.8.0: `npm run check`, `npm run test:strategy:offline`, `npm run test:strategy:browser`, `npm run test:declaration-policy:browser`, `npm run test:learning:browser`, then `npm run build` to restore normal extension origins. Exact observed results and next boundary are recorded in the checkpoint.

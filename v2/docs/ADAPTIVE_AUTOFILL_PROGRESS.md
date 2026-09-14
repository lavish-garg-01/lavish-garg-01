# Adaptive Autofill Implementation Checkpoints

## Checkpoint 14 — rotation-aware learning recovery and expiry integrity (2026-09-14)

**Current checkpoint.** AF-04/05 recovery extended; all broader tickets retain their prior partial/planned status. No live migration, key rotation, profile mutation, employer submission or installed-extension changes. [Activation, guarantees and precise limitations](LEARNING_KEY_ROTATION.md).

- Bounded historical HMAC verification is wired through API configuration, note capture/confirmation replay, observation retry and pending verified checkpoints. All new fingerprints use the active key. Four historical keys maximum; duplicate/future/invalid versions or secrets reject. New note/receipt rows store key version; legacy NULL versions remain unguessed and verify only against the configured key set. Exact retries preserve original receipts, including after evidence deletion; changed/foreign or unverifiable requests reject.
- Missing historical observation keys now interrupt checkpoint processing before finalization, allowing restoration and retry without silently consuming the observation. Production transaction/crash tests verify no partial answer, checkpoint or consumed state. With the old key retained, pending observations become new active-key truth and remain undoable. Incorrect hashes never authorize truth.
- Real wall-clock note availability is checked after acquiring the note lock and again after truth writes. Expiry during a database wait or write rolls back truth and receipt. Migration **0033_learning_fingerprint_versions** additionally protects note identity, prevents retention extension/payload resurrection and makes confirmation receipts append-only. Normal evidence deletion/expiry cleanup preserves tombstones and receipts.
- Candidate note decoding validates the private payload and suppresses parser excerpts. New read-only `npm run learning:keys:check` reports aggregate known/missing/unversioned key coverage without selecting private payloads or printing fingerprints/identities/secrets. It cannot certify that a configured secret is the right historical key.

Verification: final full suite **485 passed, zero failed/skipped**. Typecheck/lint/architecture and explicit script TypeScript checks passed. Disposable PostgreSQL verified old/new-key note replay, real lock-expiry and delayed-truth-write rollback, tombstone/receipt protection and the existing restricted review-role + positive/negative Chromium evaluator chain. The twenty-application reuse benchmark remained 57 correct, zero wrong and 23 abstentions. Test container removed; no project DB or persistent volume used.

### Remaining work — updated handoff

1. Full semantic/framework-commitment/origin receipts, durable QuestionContract binding and broader grouped-widget coverage; general entity/context recovery.
2. Historical partial checkpoints created by older code, already skipped observations, and project-wide cryptographic lifecycle. This batch does **not** cover direct profile/onboarding/import replay, ciphertext-key rotation, AI cache fingerprints or strategy signing. The shared secret must not be rotated indiscriminately.
3. Broader semantic/canonical/representation artifacts and sealed independent holdouts; registered text strategies remain the only reviewed-export class.
4. Packaged CI release integration, Q exposure/cohorts and monitored runtime disable/rollback. Prepared export remains distinct from deployed behavior.
5. Provider-specific MFA step-up, complete correlated failure audit, retention/alerts, explicit maintenance scheduling and installed-extension/live-form certification. Independent extraction, document-entailment and matching gold-label benchmarks remain outstanding.

## Checkpoint 13 — scoped recovery, shared controls and chronological reuse (2026-09-14)

**Current checkpoint.** Supersedes all earlier current/next-step labels. The interrupted code batch is completed; the whole architecture is not. AF-00–10 and AF-12 remain partial; AF-11 remains planned. No live migrations, credential changes, employer submissions or installed-extension replacement.

- Candidate Attention supports sixteen existing canonical mappings. Joining date, work-mode commitment and hearing source can now be explicitly confirmed for the original application; last working day offers global or application scope. Other existing global defaults retain their behavior. The server derives the application from the owned note, previews that exact scope's current value/version, and atomically checks the version during confirmation. No note-derived caller application ID, automatic global commitment or notice-to-date guess. Scope/value edits invalidate review. Exact retries, stale-version rejection, independent global fallback and cross-application isolation are covered. See [recovery](LEARNING_RECOVERY.md).
- The planner and live browser now share one pure capability classifier. Unsupported input types no longer inherit guessed text strategies. The scanner supplies versioned, value-free question/member/page/form/tree identities with explicit membership completeness. Oversized groups are bounded; inconsistent/incomplete descriptors produce QUESTION_CONTRACT_INVALID. Native/ARIA grouping and candidate-edit protection remain. This is an optional transitional structural contract, not complete semantic/commitment receipts or arbitrary widget coverage. See [question contract](QUESTION_CONTRACT.md).
- A repeatable twenty-application benchmark uses the actual Candidate Truth, learning recovery, field semantics and representation services. After three explicit global confirmations on application 1, nineteen subsequent applications reuse those facts across twelve fixed wordings. Measured: **57 correct representations, zero wrong, 23 abstentions / 80 questions**, versus zero answers for a frozen empty-profile control. Application-specific joining dates do not leak. This tests saved-answer reuse, not model training, DOM/employer completion or sealed holdout accuracy. Both fresh PGlite and disposable real PostgreSQL ran the corpus.
- Additive migration **0032_scoped_note_recovery** is registered in the complete chain. Apply migrations and update API/web together, then rebuild/reload the extension and application tabs. Old field descriptors remain accepted; an old strict API may reject new descriptors, so update API first. Review/export flags remain off by default. No live activation occurred.

Verification: **481 full-suite tests passed, zero failed or skipped.** Thirty-one synthetic Chromium regression cases and both production-component recovery UI workflows passed. Typecheck, lint, architecture checks and separate script TypeScript checks passed. Isolated web and extension builds passed without replacing installed assets. Disposable PostgreSQL also passed restricted login/RLS, consent/read/revoke, immutable audit, real lock/expiry, and real positive/negative Chromium evaluator → independent approval → export/disable checks; its labelled tmpfs container was removed. Final benchmark instrumentation additionally asserts zero actual AI requests and passed in PGlite. Export is still **prepared, not deployed**.

### Remaining work — not silently closed

1. Complete QuestionContract propagation, durable member/context binding, arbitrary grouped widgets and distinct field-origin/semantic/framework-commitment receipts. Current optional structural membership is only a slice.
2. General entity/context-qualified candidate recovery, historical HMAC-key/checkpoint reconciliation and remaining transactional crash/race points. Current recovery intentionally supports bounded existing fields, not arbitrary learned canonicals.
3. Broader semantic/canonical/representation artifacts, negative aliases and independent sealed holdouts. Current reviewed exports support registered text strategies only.
4. Bind reviewed exports to packaged CI releases, Q exposure/cohort gates and monitored runtime rollback. Current export disable does not recall an installed extension or already exported file.
5. Provider-specific MFA step-up, correlated failure audits/retention/alerts and explicitly provisioned idle-user maintenance. Existing restricted review service roles and consent are not replacements for deployment configuration.
6. Installed-extension/live-form certification and independently labelled extraction, document-entailment, job-match and chronological learning benchmarks. The fixed corpus above is not evidence of best-in-world accuracy or outperforming Simplify.

## Checkpoint 12 — preserved case merges, reviewed exports and separate database roles (2026-09-13)

**Current checkpoint.** Supersedes older next-step labels. AF-00–AF-10 remain partial; AF-11/12 remain planned. This completes the previously unfinished checkpoint-12 code and validation batch, not every architecture ticket. No live migrations, secrets, operator provisioning, employer submissions or installed-extension changes. All tested accounts/notes/operators were synthetic and disposable. Setup: [reviewed exports and DB roles](REVIEWED_EXPORTS.md).

- Explicit case merge now checks both revisions, root topology, open target and a 100-group bound. It flattens members, preserves original audit/grant/artifact IDs and deduplicates affected application runs. Historical cases remain readable, not mutable roots. Root views include original members' artifacts and the requester's grants; assignment/merging never grants private access. Self/cycle/stale/conflicting requests reject, exact retries return original receipts. There is no automatic unmerge.
- Immutable registered-strategy proposals bind exact definition/artifact hashes and API/extension protocol 1. A separately invoked trusted evaluator runs actual synthetic browser executor/verifier scenarios; unsupported/failed/thrown evaluations fail closed. Source, built package and corpus hashes are checked before/after. Results expire in seven days. No caller proof upload, executable-body input or AI self-rating can authorize export.
- A different active ADMIN approves the exact latest passing evaluation. Prepare/manifest/rollback recheck hash, result, expiry, active approval authority and protocol compatibility. A new failed result supersedes old approval. Explicit export disable and original-ID rollback are audited and revision-safe; replay of an old prepare cannot re-enable a disabled export. The UI explicitly says **prepared, not deployed**. This does not bypass Q or modify live autofill.
- Explicit DBA provisioning file creates separate NOLOGIN runtime/evaluator permission groups. The API now requires a dedicated `OPERATOR_DATABASE_URL` when review is enabled; the worker requires `REVIEW_EVALUATOR_DATABASE_URL`, with no owner fallback or live signing key. Startup guards reject owner/super/bypass/unsafe role combinations. Runtime cannot insert evaluations; evaluator cannot approve/export/read private notes; neither has profile-value or document access. Support locks can read encrypted note/ownership columns while actual candidate-data updates reject. These are service-role boundaries; per-person consent/MFA remains in the repository, and the broader candidate API still has its existing trusted connection.
- Additive migrations **0030_case_merge** and **0031_reviewed_exports** are registered in the ordered migration chain. Role provisioning is deliberately separate from automatic migration/startup. Three flags remain off by default: operator review, private review and reviewed exports.

Verification: **478 full-suite tests passed, 0 failed, 0 skipped.** Typecheck, lint, architecture checks, separate TypeScript checks of the three new scripts and an isolated production web build passed. Three production-component synthetic browser workflows passed: merge/export, operator editing/assignment and scoped private consent. Real disposable PostgreSQL 17 ran the full schema and actual support/review repositories under separate non-owner login roles, forged-tenant-setting denial, prohibited grants, owner/cross-role startup rejection, immutable audit and a two-connection note-lock/expiry race. The real worker then passed a native-setter strategy and rejected a direct-setter strategy through Chromium, recorded results with the evaluator login, and exercised independent approval/export/disable using the runtime login. The labelled tmpfs container was removed; no project DB or persistent volume was used.

### Remaining work, in dependency order

1. Candidate completeness: full versioned QuestionContract and capability migration; field-origin/semantic-versus-commitment receipts; richer entity/context-qualified note mapping; historical checkpoint/HMAC-rotation reconciliation and remaining real-PG crash/race points. Checkpoints 9/10 already cover typed global mapping, pagination, bounded cleanup and session retry—do not repeat those as missing.
2. Governed generalization: semantic/canonical/representation artifact classes, negative aliases and qualified defaults, sealed independent holdouts, broader widget evaluator coverage, review diffs and larger consented diagnostic-package digests. Current export supports registered text strategies only.
3. Runtime release integration: bind reviewed export eligibility to packaged CI release artifacts and stronger Q exposure gates, stable cohorts and rollout monitoring. Current disable/rollback controls only future export selection, not a deployed extension or an already exported file. Preserve in-flight/candidate-owned state.
4. Operational and measured quality: provider-specific in-app MFA step-up, detailed correlated failure audit, retention/monitoring, idle-user maintenance scheduling and installed-extension certification. Chronological held-out learning, extraction, document entailment and job-matching gold-label benchmarks remain outstanding; no accuracy or Simplify-comparison percentage is claimed.

These remaining items require real implementation/evidence, not renaming this checkpoint complete. Live activation requires migration and authorized DBA/identity provisioning; none was performed implicitly.

## Checkpoint 11 — scoped private support and case assignment (2026-09-13)

AF-07/08 extended, not closed. This supersedes the operator-grant/assignment next-step notes below. No live migration, operator provisioning, candidate changes, employer submissions or installed-extension replacement. Full setup/limits: [support consent](SUPPORT_REVIEW.md), [operator workspace](OPERATOR_REVIEW.md).

- Operator requests are purpose-allowlisted, exact caller/request-ID replay-safe and expire after 24 hours. Candidate chooses one existing encrypted note, reviews exact operator identity/case/purpose and explicitly approves 15/60 minutes. Note ownership and a same-run failure matching the case are mandatory; there is no general candidate/profile/document browser or automatic access from case assignment.
- Approval binds one candidate/account/note/requesting operator, is bounded by note expiry and never extends on replay. Every private read rechecks recent MFA, active DB operator, exact grantee, candidate/account activity, note availability, expiry and revocation; locks coordinate role changes, deletion and grant revocation. Wall-clock rechecks prevent transaction-start time extending access. PGlite verification is not real multi-connection PostgreSQL certification.
- Separate append-only support audit contains no question/answer payload. Every successful private read must audit before returning; failed repository work records a separate value-free denial. Ciphertext/JSON failure details are replaced with a constant error so parser excerpts cannot enter request logs. JWT/schema failures and DB outages remain explicit audit-coverage limitations.
- Candidate Attention includes optional per-note request preview/consent, existing-grant listing and revoke controls. Operator cases include explicit consent request/read controls; metadata refresh never reads private payloads. Text is inert, no-store and cleared after 30 seconds/expiry, focus loss, close, context change or failed access; stale replies after hiding are ignored. Revocation cannot recall already viewed/copied data.
- Twenty live requests per operator/case and twenty live grants per note; bounded metadata lists prioritize live access. No background messaging or automatic grant approval. Sharing or reading a note never promotes an answer, trains AI, publishes a rule or submits an application.
- Revision-safe self-claim/release and explicit active-admin release coordinate case ownership. Competing claims, stale revisions, other-reviewer release and cross-action replay conflicts reject. New assignment audit uses existing immutable receipts. Assignment does not restrict ordinary authorized triage or grant private access.
- Migration **0029_support_review** adds grants, append-only audit, assignment fields and constraints; registered and tested in the ordered migration chain. New **ENABLE_OPERATOR_PRIVATE_REVIEW=false** is independent of the existing operator flag. Both flags plus OIDC/session/encryption configuration are required for private routes. No live settings were changed.

Verification: final complete suite **468 passed, 0 failed**, including new repository subcases and strict API tests. Production repositories are exercised with isolated PGlite, actual note encryption and synthetic owners/operators: matching-case consent, active foreign-owner rejection, wrong grantee, expiry/deletion/revoke, replay, competing approvals/claims, limits, malformed-payload privacy and mandatory immutable audit. Three synthetic browser scripts passed: support consent/private display/timed clearing, operator triage/edit/claim/release, and existing candidate recovery. Typecheck/lint/architecture and separate migration/browser-script typechecks passed. Temporary web production build passed. These are not live employer, installed extension, full real OIDC provider or real restricted-role PostgreSQL results.

Activation: apply migrations through 0029 and rebuild/restart API/web before opting in. No extension changes in this checkpoint. Keep both flags false until provisioning and deployment security are ready. The additive schema can remain when disabling the feature; do not delete immutable audits. See support doc for disable/re-enable and consent-expiry behavior.

Next broad batch: finish case merge with preserved evidence/counts and replay safety, plus real restricted-runtime DB role/RLS verification before exposing private support. Then implement independent proposal/evaluation/hash-bound approval/release and rollback gates (AF-09–12), without treating case RESOLVED as a release gate. General private diagnostic-package/digest exports, detailed HTTP failure correlation, step-up UX and audit retention/alerts remain open. Earlier candidate gaps remain: full QuestionContract propagation, entity/context confirmation, historical HMAC/checkpoint reconciliation, comprehensive telemetry and live application benchmarks. AF-00–08 remain partial; AF-09–12 remain planned.

## Checkpoint 10 — bounded delivery recovery and honest acknowledgement (2026-09-13)

AF-05/06 extension delivery slice implemented. No live candidate changes, employer submissions, installed-extension replacement or database migration. Full behavior/limits: [extension delivery recovery](EXTENSION_DELIVERY.md).

- Existing RESOLVE/PLAN diagnostics now enqueue validated value-free events into local extension storage, preserving event IDs across outage/restart. Explicit private-note saves can enqueue in TRUSTED_CONTEXTS session memory only, after the new retention/retry consent prompt and `allowSessionRetry: true` transport flag. Old requests without that consent remain immediate-delivery-only. No candidate answer is written to local disk storage by this queue.
- Notes survive page/worker recreation within one Chrome session and same application run. Semantic dedup excludes page/transport IDs while preserving question/answer/run/source and original server item ID. Delivered repeat saves recheck server deletion/expiry tombstones. Browser close/extension reload loses private session notes by design; diagnostics survive reconnection within their TTL.
- Queue owner binds verified server candidate identity and API origin; no email/admin inference or decoded-token authority. Serialized auth writes reject late old-token binding. Flush revalidates session, pins sends to the exact credential and stops on account/token change. Changing owner/API clears old queue state when accessed instead of delivering across identities. Server run/application authorization remains mandatory.
- Persist-before-send attempts, exact-ID replay after crash, six-attempt exponential backoff, 24-hour TTL, 200 retained entries/store and at most five sends/flush. HTTP 408/429/5xx retry; permanent failures reject. One-minute Chrome alarms plus enqueue/reconnect/startup recovery are wired; Chrome timing remains best-effort. Expiry runs even while disconnected on the next wake. Payloads erase on acknowledgement/rejection/discard/expiry.
- Fixed a real false-success bug: the save method previously ignored ERROR_RESPONSE. It now distinguishes confirmed server acknowledgement from queued/unconfirmed/error responses. Side panel displays pending notes/diagnostics, acknowledged/rejected and expired/dropped counts; discard requires confirmation and cannot undo already-sent requests. Counters cover retained history, not complete event coverage or accuracy.

Verification: final full suite **455 passed, 0 failed**. Eight queue tests cover worker/browser restart distinctions, semantic retry, capacity/backoff/expiry, owner/token races, strict telemetry, discard/rejection/exhaustion, original-ID recovery after server ACK/local-storage failure and transient HTTP limits. Router tests prove stale-page protection and explicit offline-storage consent. Production private-save browser fixture covers cancel/error/queued/saved/password exclusion; production sidebar fixture covers counts, discard confirmation and disconnected clearing. Final typecheck/lint/architecture passed; separate temporary extension build passed with new alarms permission. Browser scripts separately typechecked. Not installed MV3 alarm/suspension or live employer certification.

Activation: rebuild/reload extension, accept new alarms permission if prompted, reload application tabs and reconnect from Job Hunter to establish verified candidate binding. Existing API migrations through 0028 still required from prior checkpoints. No new migration or user-installed deployment in this turn.

Next broad batch: operator completeness—explicit expiring candidate-approved private-evidence grants, scoped access/failure auditing, assignment/merge and real restricted-role PostgreSQL verification—then independent evaluation/release gates. Candidate leftovers remain entity/context-aware note mapping, historical checkpoint/HMAC-rotation reconciliation, full QuestionContract migration, precise field-event coverage and measured installed-extension journeys. Disk-persistent private retry needs a separate consent/key lifecycle design; do not claim the session queue solves browser-shutdown recovery. AF-00–08 remain partial; AF-09–12 planned.

## Checkpoint 9 — typed candidate review, pagination and retention (2026-09-13)

AF-02/05 candidate recovery extended; this does not close the entire candidate-side backlog. No live migration, profile mutation, employer interaction or maintenance scheduling. See [recovery setup and precise limits](LEARNING_RECOVERY.md).

- Candidate Attention maps 13 existing canonical fields. Added current/expected compensation with explicit currency/scale/period, notice days, total experience months, confirmed last working day and professional URLs. Exact conversion maps 14 INR lakh/year to 1400000 INR/year; 44 months previews 3 years 8 months. Missing units, ranges, invalid calendar dates and unsafe URLs reject. Notice never silently becomes a joining date. No consent, entity history, work-mode commitment or joining-date mapping through this path.
- New authenticated, no-store preview endpoint uses the same server converter as confirmation. The candidate reviews the current default, normalized replacement and global scope. Unit/value edits invalidate preview. Existing expected-version conflict checks, atomic truth/receipt transaction, original replay result and Profile undo remain in force. Notes do not automatically become truth.
- Owner-scoped keyset pagination returns up to 100 notes/page (default 50), preserving database timestamp precision and deleted-cursor continuity. Attention loads older pages and deduplicates IDs; load/access errors clear private data. Confirmed notes no longer consume the 200 pending-note allowance.
- List/capture activity removes expired ciphertext for that owner. Bounded maintenance function/Node-pinned `npm run learning:cleanup` covers inactive users, up to 10 × 1000 rows per invocation with skip-locked row selection. It preserves retry tombstones, confirmation receipts and saved profile answers. No live cleanup or schedule was created; metadata/backups are not purged by this command.
- Additive migration **0028_learning_inbox_lifecycle** expands the confirmation allowlist and indexes pagination/expiry; registered and tested in the normal ordered chain. Not applied to live data. API/web coordinated rebuild required; extension protocol unchanged.

Verification: **447 full-suite tests passed, 0 failed**. Seven focused API/repository/unit tests passed, with expanded integration assertions for preview-without-write, ownership, six typed confirmations and next-time resolver reuse, deletion without undoing truth, more than 100 notes with tied timestamps/deleted cursors, invalid pages and expiry cleanup/non-resurrection. Synthetic browser review passed: explicit salary units, server-preview display, invalidation on unit change, exact confirmed request, pagination, inert text, deletion and access-denial clearing. Typecheck/lint/architecture passed; migration, cleanup and browser scripts separately typechecked. Final repository changes after verification were comment/indentation only. PGlite/synthetic browser evidence is not real multi-connection PostgreSQL or employer-form certification.

Next broad batch: durable extension diagnostic retry/drop accounting and reload-safe private-note capture, with authoritative tenant binding, explicit retention/consent and visible delivery state; historical checkpoint/HMAC-rotation reconciliation remains open. Then finish operator private grants/assignment/merge/real-role certification and independent evaluation/release gates. Entity/context-aware mapping and full QuestionContract migration still need dedicated work. AF-00–08 remain partial; AF-09–12 remain planned. Do not repeat already delivered typed global mapping, pagination or cleanup as unimplemented.

## Checkpoint 8 — audited operator workflow and structured case review (2026-09-13)

AF-07/08 extended, not closed. This checkpoint supersedes the operator workflow next-step notes below. Feature remains disabled; no live migration, operator provisioning, candidate data modification or employer interaction.

- Active ADMIN plus recent MFA can provision/change/revoke a different operator through an authenticated route and Node-24.8-pinned `npm run operator:provision -- command.json`. REVIEWER and self-targeted commands reject. The first administrator still requires explicit audited DB bootstrap; there is no self-promotion path or default administrator.
- Role writes, append-only audit and immutable receipts commit together. Authorization is checked before replay; a replay never re-applies an old grant after revocation. Shared request-ID locking rejects conflicts across case status changes, review edits and provisioning.
- Cases have revision-safe responsible-layer, expected-behavior and allowlisted synthetic-suite references. `#operator` now includes review editing and recent case history. This is a packaged reference, not an uploaded reproduction, execution result or release approval. Arbitrary URLs/scripts and candidate evidence are rejected.
- Failed repository actions persist a separate ACTION_FAILED audit row after rollback; error payloads are not stored. The current failure record is actor/time only, not case-correlated or a complete HTTP failure log. Invalid JWTs/malformed input remain outside this repository audit; DB outages can prevent persistence.
- Migration **0027_operator_workflow** adds review metadata, audit action/detail support and immutable action receipts, with server-only RLS enabled. Registered in the ordered migration chain; not applied to the user's database. See [operator setup and limits](OPERATOR_REVIEW.md).

Verification: final stable full suite **444 passed, 0 failed**. Expanded existing API/repository tests cover authority injection, reviewer/self-target rejection, grant replay/conflicts, cross-action request reuse, revocation, immutable receipts, stale edits, timeline and allowlisted references. Synthetic browser review-edit/status/refresh/access-denial flow passed. Typecheck, lint and architecture checks passed; CLI, migration and browser scripts separately typechecked. Database behavior uses isolated PGlite, not real multi-connection/restricted-role PostgreSQL certification. Test count is unchanged because existing integration tests gained assertions.

### Remaining broad batches (not silently considered complete)

1. Candidate-side completeness: broader typed note confirmation for money/date/entities/context; durable retry/drop accounting; pagination, expired ciphertext cleanup and historical checkpoint reconciliation. Full QuestionContract/protocol migration and installed-extension employer certification remain open.
2. Operator completeness: provider-specific MFA step-up UX, real restricted-role PostgreSQL/separate DB privilege certification, explicit expiring private-evidence grants, detailed failure correlation, assignment/merge and per-case synthetic artifacts. Current references do not establish reproducibility.
3. Governed improvements and measurement: independently produced/hashed evaluations, separate approval, immutable release/rollback gates; chronological held-out learning and extraction/document-grounding benchmarks. No rule publishing or best-in-world accuracy claim is authorized by triage status.

Activation: apply normal migrations through 0027, rebuild API/web, bootstrap through authorized DB tooling, then deliberately enable operator review with working OIDC/MFA. None of these live deployment actions was performed in this checkpoint.

## Checkpoint 7 — protected value-free operator triage (2026-09-13)

AF-07/08 foundation implemented, not full tickets. Dedicated OIDC verifier requires signed issuer/audience/expiry plus recent MFA; candidate membership and development tokens grant no operator authority. Database-provisioned active issuer/subject role is checked on every read/write, including replay. Feature disabled by default; no roles provisioned.

Migration 0026 adds operator roles, grouped failure cases and append-only access/transition audit. Operator list groups release/stage/code and distinct affected runs without private candidate values or identifiers. Status changes use expected revision and request UUID; stale edits and conflicting replay reject. Revocation immediately blocks subsequent requests. Status is triage only, never rule activation.

Web `#operator` provides refresh, grouped cases and status controls; access errors clear the list on refresh. Existing sign-in token must satisfy dedicated MFA checks. No private support data routes. See [operator setup and limits](OPERATOR_REVIEW.md).

Verification: **444 tests passed**, including signed-token MFA/expiry/audience tests, disabled/default route checks, role denial/revocation, immutable audit, revision conflict and replay tests using isolated PGlite repositories. Final typecheck/lint/architecture passed. Synthetic browser triage/refresh/access-denial clearing passed after running the fixture on an intercepted secure origin for UUID generation. No live operator provisioning, real restricted-role PostgreSQL certification, migration or installed deployment.

Next: audited operator provisioning workflow; provider-specific step-up UX; real RLS-role tests and separate runtime DB privileges; failed-action audit channel; richer critical cases with timeline, synthetic reproduction links and revision-safe assignment/merge. Private evidence grants remain absent, not implicitly authorized. AF-09/10 proposal/evaluation/release gates still pending. Activation requires migrations through 0026 and coordinated rebuild; feature remains off.

## Checkpoint 6 — reviewed note-to-profile confirmation (2026-09-13)

Implemented an end-to-end confirmation slice: candidate Attention → current-default review → explicit global confirmation → authenticated API → Candidate Truth saveGroup + immutable confirmation receipt in the same transaction. Allowed fields are FIRST_NAME, LAST_NAME, FULL_NAME, EMAIL and CURRENT_LOCATION only. This does not implement generic money/date/entity/consent mapping or new canonical activation.

- Candidate-selected mapping and edited answer are explicitly confirmed as a global default. Existing application overrides retain precedence. UI loads the current profile version for optimistic concurrency; newer truth cannot be silently overwritten.
- Replay is bound to note identity and request fingerprint; original change-set link is returned. Different repeat confirmation conflicts. Expired/deleted/unowned notes cannot create a first confirmation. Deleting the original note after confirmation does not undo profile truth; Profile history remains the reversal authority.
- New additive migration 0025 stores value-free confirmation receipts and is registered in the ordered migration chain. Not applied to the user's database. API/web must be rebuilt after migrations 0024/0025 before activation.
- Confirmed notes are labelled in Attention after reload instead of showing another mapping form. Raw notes remain encrypted until their existing expiry/delete lifecycle; no automatic corpus export or admin exposure.

Verification: 22 database/migration tests passed; final API boundary tests passed (2 tests with auth, strict mapping, confirmation and ownership assertions). Synthetic browser review/confirmation/delete flow passed after fixing the select's accessible label. Final typecheck/lint/architecture passed. Full suite **442 passed** before the final API assertions and accessible-label adjustment, which were separately verified. No live employer, user-data migration or real multi-connection PostgreSQL certification.

Remaining broad work: richer typed field mapping (units, dates, entities and scope), durable retry buffering and retention, protected AF-07 operator identities/grants, AF-08 review workspace, then proposal/evaluation/release gates. Five-field confirmation is not completion of AF-05 or the full backlog.

## Checkpoint 5 — explicit unknown text capture (2026-09-13)

**AF-05 extension intake slice implemented; confirmation/mapping and admin remain pending.** No automatic private capture or truth promotion. No live API/database activation or employer interaction.

- Unknown questions in the mini Copilot field list offer **Save answer as private note**. A confirmation preview displays the current question/answer; empty, stale, changed, password/file/selection controls and known declaration semantics are excluded. This first intake supports native text-like controls/textarea, not all widgets. Explicit candidate consent is required even when semantics are unavailable.
- `CONTENT_INBOX_CAPTURE` is strictly CANDIDATE_PRIVATE. Background checks the current application/run/page, then uses the existing authenticated encrypted-inbox API. Candidate values never enter progress messages/telemetry.
- Same snapshot retains one item ID for retries during the controller lifetime (bounded 200 entries). Changed answer/context gets another ID. This is not cross-reload durable retry buffering.
- Server acknowledgement is required on each transport retry: inbox messages bypass the old pre-dispatch message-claim ACK shortcut, avoiding false success after failed persistence. Deleted/expired replays cannot be reported as newly saved; expired replay now returns EXPIRED.
- Save/cancel/failure feedback stays in the mini card across renders. Notes appear in candidate Attention using checkpoint 4's viewer/deletion path. There is still **no mapping/confirm-to-profile action**, no canonical activation and no automatic reuse of these notes.

Verification: targeted private transport/retry/background/database tests **7 passed**; full suite **442 passed** before the final status-map pruning change. `scripts/private-note-browser.ts` passed production capture method tests for cancellation, outage/retry identity, private classification and password exclusion with synthetic dependencies. Final typecheck/lint/architecture checks passed. Not installed-extension/live employer certification.

Next: candidate-reviewed canonical mapping through existing Candidate Truth validation (including scope, units, entity identity and OCC), durable private retry storage with explicit retention/consent, and AF-07/08 protected operator review. Migration 0024 and coordinated rebuild/reload from checkpoint 4 are still required; not performed here.

## Checkpoint 4 — atomic learning and private recovery foundations (2026-09-13)

**AF-04/05/06 implemented partially; AF-07/08 admin remains pending.** No real candidate profile changes, employer submissions, provider calls or live database migration. Supersedes the next-batch notes below.

### Delivered

- Production API supplies a database unit of work spanning submission verification, Candidate Truth grouped changes, observation consumption and final receipt. Repository nesting uses savepoints, not independent commits; handled SQL conflicts roll back locally. Core service remains dependency-injected for tests.
- New checkpoint:v2 semantic identity ignores transport request IDs/idempotency headers while binding run/page/submit time and conflicting changed signal evidence. Finalized replays return the original change-set/count summary without re-reading or re-consuming observations. Authenticated account ownership is checked before replay. Unfinished receipts encountered on replay fail closed; older transport-key receipts are not automatically reconciled or re-applied.
- Additive migration **0024_learning_recovery**: candidate-private encrypted inbox and separately stored, strictly allowlisted value-free outcome events. Migration registered and tested, **not applied to the user's database**.
- Inbox capture/list/delete APIs derive account/candidate from authentication; run ownership is server checked. Pending cap 200, combined payload limit, encrypted at rest, 30-day access expiry, deletion clears ciphertext, replay cannot resurrect deletion. Evidence is never promoted to truth by these endpoints. Expired ciphertext cleanup and a complete paginated lifecycle remain pending; list returns newest 100 entries.
- Outcome intake rejects free-form metadata, deduplicates stable event IDs, caps 1000 events/run and groups distinct affected runs/questions. Counts explicitly describe reported failures, not an unsampled success rate. Extension reports resolution/plan failures and zero-operation plans best-effort with at most three concurrent requests; durable offline retry/drop-count visibility and field-level event coverage remain pending.
- Candidate Attention shows pending private notes, expiry/deletion, and their own failure groups. HTML-like candidate text is rendered inert. No cross-user admin routes or profile browser exposed.

### Verification

- Database tests inject failure after truth mutation/before finalization and after finalization/before commit: checkpoint receipt, truth change set and consumed state roll back together. Parallel/repeated replay preserves original Undo link; changed evidence conflicts; foreign account replay is denied.
- Recovery tests cover ciphertext, no truth promotion, retry identity, deletion/non-resurrection, expired access, foreign ownership, 20-repeat event deduplication, unique-run grouping and free-text telemetry rejection.
- API tests cover authentication, authority injection, no-store private responses and generic rejected-payload errors. Ordered migration chain through 0024 is idempotent. Final focused API/database/migration run: **24 passed**.
- `bash scripts/with-node.sh node --import tsx scripts/learning-recovery-browser.ts` passed: real React recovery component against synthetic API, inert text and delete cancellation/confirmation. Not a production API browser journey.
- Full suite: **438 passed**, before adding the final standalone savepoint test. Initial restricted run had 437 passes and one sandbox-blocked loopback OIDC test; rerun with loopback permission passed all 438. TypeScript, lint and architecture checks passed. PostgreSQL engine behavior is exercised through PGlite; real multi-connection PostgreSQL crash/concurrency/RLS-role certification is still pending.
- Additional standalone savepoint test passed after correcting its double-close cleanup: nested SQL failure rolls back local writes while outer writes commit; outer failure rolls back successfully released nested writes too.

### Next broad batch — finish intake, then protected review

1. Wire explicit/committed unknown-field capture from extension into this inbox, with private transport classification, candidate-visible success/failure and no telemetry values. Add mapping/confirmation into existing typed learning observations; do not invent canonicals or silently trust these notes. Add pagination, retention and rotation-aware immutable replay evidence.
2. Finish durable outcome buffering/drop accounting and historical checkpoint reconciliation. Current best-effort diagnostic events can be lost during outage; they must not be represented as complete coverage.
3. Build AF-07 server-verified operator roles/step-up and audit first, then AF-08 critical case viewer with revision-safe decisions and synthetic reproductions. No hard-coded email admin, candidate-owner escalation or private evidence access without grant. AF-09/10 release gates remain separately pending.

Activation: run the normal migration command for 0024, rebuild server/shared packages and extension, then reload Chrome extension. Those activation steps were not performed here. Retain the previous checkpoint limitations (Question Contract, model-level verification, custom widgets, document evaluation). This is not completion of every architecture ticket.

## Checkpoint 3 — capabilities, execution safety and honest outcomes (2026-09-13)

**AF-01/02/03 broader source slice implemented; tickets remain partial.** Supersedes older next-step notes. No live employer interaction, provider calls, candidate-data changes or deployment. Rebuild API/shared packages and extension together and reload: older strict contracts reject the new optional descriptor/receipt fields. Negotiated protocol migration remains pending.

### Delivered

- Explicit contenteditable evidence reaches planner capability selection; unsupported textarea-like controls no longer falsely imply native support. ARIA radio/checkbox capabilities aligned.
- Combobox selection requires explicitly associated same-root popups (`aria-controls`/`aria-owns`), with no document-wide option fallback. Missing association/options, disabled options, ambiguity and shadow-root ID collisions are handled conservatively.
- Execution rechecks connectedness, visibility and read-only/disabled/inert state before strategy execution, preserving hidden native file-input support. This is not universal custom-widget or mid-strategy race protection.
- Delayed native/associated validation errors reject matching text. Receipts label successful readback DOM_READBACK. Legacy technical VERIFIED does not establish framework-model commitment or employer acceptance; model-level confirmation and learning evidence gates remain pending.
- Paused/deferred batches report PARTIAL; stale-plan unattempted operations count as skipped. Progress retains deferred questions.
- Scanner exposes control/field/form caps and inaccessible-frame limitations. DOM traversal itself is not yet fully resource bounded.
- Allowlisted representation rejection codes reach field progress. Readiness wording requests review, flags required unresolved questions and warns about incomplete scans.

### Verification

- Full suite: **436 passed**, before the final planner-capability test and last guard refinements. Final targeted planner/graph/progress tests: **15 passed**, including paused/stale no-attempt cases.
- Synthetic Chromium: **29 passed** after read-only guards, covering prior 17 cases plus popup isolation, rich text, delayed validation, DOM/model disagreement, scan overflow and late read-only/disabled controls. Production modules on synthetic fixtures, not full API or employer E2E.
- Final TypeScript, lint and architecture checks passed. Historical defect probes remain unchanged. Installed extension not rebuilt/reloaded.

### Next broad batches

1. **AF-04/05/06 durability and failure evidence:** atomic checkpoint/original receipt replay, semantic retry identity, private unknown-answer inbox, typed value-free failure events; production-persistence crash/retry/isolation tests. DOM readback alone must not promote unknown answers.
2. **AF-07/08 operator workflow, then gated AF-09/10:** platform-admin authorization separate from candidate ownership, critical-case queue, audited decisions, scoped support access and immutable evaluation/approval/release linkage. Ship a protected viewer before enabling rule promotion.

These are broad batches, not a guarantee the complete backlog fits two runs. Question Contract/protocol migration, phone/URL normalization, custom widgets, group rollback, model-level verification, context qualifiers and document evaluation still require acceptance evidence.

## Checkpoint 2 — representation and learning normalization (2026-09-13)

**Broader AF-02 slice implemented; AF-02 remains partial.** No database migrations, profile rewrites, live employer applications, provider calls or admin changes. Existing ambiguous profile values are not silently repaired. Restart the API if it has not picked up rebuilt server packages; the installed extension from checkpoint 1 still requires rebuild/reload.

### Delivered

- Shared pure unit rules in `packages/domain/src/answer-units.ts`. Execution now explicitly depends on this lower-level package; dependency manifest, lockfile, TypeScript reference and architecture allowlist updated together. No execution-to-learning dependency.
- Exact decimal arithmetic with BigInt: no floating-point salary multiplication, magnitude-based guessing or silent rounding. Base CTC stays base annual currency; lakhs/crores require explicit scale; annual/monthly conversion is exact. Non-terminating decimal results require review. Other period amounts can be preserved, but annualization without working-hours/day assumptions is refused.
- Explicit ISO currency takes precedence over country default. Currency conflicts, unsupported scales, mixed periods, negative/malformed amounts, scientific notation and invalid comma grouping fail closed. Country defaults are deliberately limited to IN/US; no default USD for every non-Indian candidate.
- Unspecified salary period is qualified with currency/period in text; unqualified number boxes require review. Money rendering and learning normalize to equivalent amounts across base/LPA/monthly representations. No Candidate Truth mutation happens in conversion helpers.
- Experience text preserves years AND months; completed years alone may be floored. Numeric year values must be exactly representable. Radio/select buckets are matched only when unique; overlapping boundaries abstain. Ranges, completed-year buckets and rounded fractional months cannot become exact learned tenure.
- Notice days render as `45 days' notice` for unqualified joining text. Explicit day/week controls use their requested units; calendar-month conversions and unknown dates abstain. An offer-relative phrase is supported only when a caller supplies a verified anchor; the production planner currently supplies canonical meaning, not an invented temporal anchor. A notice period alone is not a confirmed start date.
- Enum and boolean values produce TEXT for textareas/text controls and option representations for selection controls, fixing the hearing-source/work-mode representation incompatibility without changing candidate policy.
- Date rendering cannot increase known precision from year to month or month to day. Full custom date-widget/locale-format support remains pending.

### Verification

- New `tests/unit/adaptive-representation.test.ts`: 74 named tests covering success, rejection, cross-layer normalization, precision, nonmutation and boundary cases; runs automatically under `npm test`.
- Focused representation, execution-service and learning-service suites: **94 passed** after the final salary-period guard.
- Full suite: **434 passed**, before the final extra salary-period qualification test/guard. Do not relabel that run as a 435-test result.
- `npm run test:adaptive-autofill`: **17 synthetic browser scenarios passed**, using production renderer, normalizer, scanner, executor, verifier and ownership code. Six added scenarios exercise CTC/LPA/monthly DOM fills, enum/boolean text controls, notice/date separation and experience radio selection.
- Lint, TypeScript and architecture checks passed. This evidence is not live employer acceptance, a complete real-API application journey or production learning durability certification.

### Remaining and next broad checkpoint

Finish shared capability/descriptor boundaries and AF-03 execution safety together: contenteditable capability alignment, scoped combobox popup targeting, explicit no-attempt/dependency reasons, scan-limit visibility, and honest DOM-versus-application-model verification. Add adversarial browser cases for each, not just unit stubs. Then tackle AF-04 atomic checkpoints/replay and AF-05 private unknown-answer capture as the next combined durability checkpoint.

Remaining AF-02 work includes phone/URL normalization, profile-side reconfirmation UX for historical ambiguous values, full Question Contract propagation, locale/precision/rounding policies, option-sample completeness, and surfacing granular unit rejection codes through API/UI (currently the resolver has specific codes but planner skips remain broadly REPRESENTATION_INVALID/UNSUPPORTED). Admin evidence/review/release modules remain planned. Historical audit scripts intentionally assert old bugs and are not current acceptance gates.

## Checkpoint 1 — logical radio questions (2026-09-13)

**Completed source-code slice; AF-00 and AF-01 remain partial.** No migrations, employer submissions, AI calls, admin implementation or candidate-data changes. Installed extension not rebuilt/reloaded.

### Delivered

- Shared radio membership across scanner, executor, verifier and candidate-answer observation: native name + actual form owner + tree root; nearest explicit ARIA radiogroup; nameless/orphan radios independent.
- One descriptor and graph FIELD per question, with group label/options, required status and selected-member completion.
- Ownership bindings for every option; trusted clicks on non-first options and nested children protect the entire question across rescans.
- Candidate learning reads the selected member rather than only the first representative radio. This is capture correctness, not proof of durable promotion.
- Hidden shadow hosts no longer expose fillable fields. External `form=` association and separate form/shadow-root isolation are covered. Acknowledgement checkboxes stay independent.

### Verification

- `npm run test:adaptive-autofill` (from `v2`): baseline 1 passed / 9 failed; final 11 passed / 0 failed, including added nested-child ownership coverage.
- Existing ATS-surface browser smoke passed, including 11 application journey surfaces. Changed its previous assertion expecting two fields for one radio question.
- Existing unit/integration suite: 361 passed. Run before the final nested-child ownership enhancement; targeted ownership tests and new browser suite validate that final change.
- Lint, typecheck and architecture checks passed; final targeted checks rerun after handoff updates.
- Tests use synthetic Chromium with production browser modules, not live employers/full API learning. Historical audit probes remain unchanged: they intentionally assert the old buggy baseline.

### Still pending

- AF-00: convert remaining D01–D16 and production crash probes into desired-outcome gates.
- AF-01: shared wire Question Contract/member identities, stability across DOM replacement/reordering, truncation reporting, unified contenteditable capabilities, conservative multiselect handling and protocol migration. Membership in this slice is internal; one existing field ID represents the group.
- Hidden native radios behind custom visible labels may still need widget support. No universal radio-widget claim.
- Money/duration representation, combobox containment, application-model verification, atomic learning and admin review are not fixed by this checkpoint.

### Next run: AF-02A — exact money representation

Add failing D01/D03 desired-outcome tests, then align rendering and learning normalization: annual base INR 1,400,000 → `1400000`; explicit LPA → `14`; annual INR 1,200,000 requested monthly → `100000`. Use exact arithmetic and reject ambiguous units; test that formatting cannot silently change truth. Inspect current representation/normalization first. This bounded converter slice can precede the full Question Contract; AF-02 as a whole remains dependent on it.

Keep future runs checkpoint-sized and update this handoff. No need to repeat historical research. Do not mark full backlog tickets complete on partial evidence.

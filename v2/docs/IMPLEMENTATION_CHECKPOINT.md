# V2 implementation checkpoint

Updated: 2026-09-11  
Runtime: Node 24.8.0  
Completed boundary: **Phase R — Resume & Document Intelligence**  
Next boundary: **Phase S — Billing**

## Live application remediation — 2026-09-11: CODE COMPLETE; LIVE FILL CERTIFICATION PENDING

- Fixed the Plane side-panel failure path: rejected API plan requests now retain the original structured failure instead of being collapsed into `INTERNAL_FAILURE · API_UNAVAILABLE`. API-unavailable diagnostics include only safe origin/status metadata. The local API must still be running on port 3100.
- Local launch is deterministic: Vite now requires port 3000 instead of silently falling back to 3001, and the default extension allowlist contains only the two port-3000 loopback spellings. Browser fixture builds use isolated `.local-data/extension-test/*` output directories and can no longer overwrite the installed development extension with test ports.
- Grounded résumé/cover-letter generation no longer strands the candidate when a provider returns unsupported prose. Provider output is validated at the bridge and safely falls back to the deterministic grounded generator before the service performs its independent validation.
- Resume repeatable-entity reconciliation now supports presentation-insensitive multi-anchor comparison in addition to exact private fingerprints. It matches case/diacritic/punctuation variants and conservative company/title/institution aliases while retaining the existing requirement for two independent anchors. It rejects weak one-anchor/company-token collisions and does not retroactively mutate saved Candidate Truth.
- Job experience inference now covers explicit ranges, `N+`, `minimum`, `yrs`, repeated units and possessive `years' exp` forms without interpreting dates or unrelated numbers as requirements. Workday fetches are paginated in batches of 20 instead of sending oversized requests; a live dry run fetched 20 Visa jobs successfully.
- Candidate discovery now collapses exact presentation duplicates when an ATS issues several requisition IDs with the same normalized company, title, location and full description. Catalog records, source provenance and lifecycle remain separate; materially different descriptions remain visible. A live dashboard refresh reduced four identical Bosch `Sr.Data Engineer` cards to one while retaining two similarly titled Embedded roles whose descriptions differ.
- Actual master-résumé audit: the one-page, tagged PDF produced 4,368 characters/51 lines through the production PDF.js path. The strengthened deterministic extractor emits 31 grounded proposals: all four roles with company/title/date/full accomplishment block, one complete education entity, contact/summary/current role, 36 explicit global skills, two evidence-backed role skill sets and the correct 44-month non-overlapping duration. All proposal evidence is an exact document substring. Skills come only from an explicit skills/competencies section; role mentions stay entity-scoped. Headings cannot become a name.
- Resume AI enrichment now allows one contiguous role block up to the persistence evidence ceiling, rejects duplicate logical canonicals, binds same-company roles only after two independent anchors, and only fills fields the deterministic extractor did not already recover. This prevents the prior Vidyakul multi-title duplicate/import failure without weakening candidate review or grounding.
- Ranking policy `H2-DETERMINISTIC-2026-09` adds fail-safe ceilings: out-of-family roles, excessive seniority gaps and jobs more than two years above confirmed experience remain `LOW_MATCH` even when ATS metadata is sparse. Live Chrome verification moved the 10–12 year Staff backend role, Network role and other unsuitable roles to 49 or below while preserving the aligned backend/full-stack/DevOps ordering.
- Profile loading now treats history/documents as degradable secondary calls, while the essential editor derives untouched inputs from current Candidate Truth instead of preserving stale local empties. The live required email input is valid and the API returns the current global email; the browser automation surface redacts the value itself.
- Permitted child frames inherit the launched job/application run. Side-panel status, Scan, Fill, declaration review and learning Undo select the frame with actual answer/field coverage instead of always targeting frame 0. Cross-origin embedded origins still need an explicit Chrome host permission before their content runtime can exist.
- Verification under Node 24.8.0: architecture, lint, typecheck and **341/341 tests** pass; production web/extension builds pass; Phase I browser smoke passes after the frame-routing change. The earlier 8-batch Greenhouse/Lever/Workday semantic corpus and 47-plan K/N/R execution suite remain green. The standard extension build remains configured for web port 3000 and API port 3100.
- Honest remaining boundary: no new employer application was submitted and no successful post-fix Plane fill/readback has been observed. Live Gemini/OpenAI résumé extraction was not invoked because the execution environment required new destination-specific consent for sending the private document. Closed shadow DOM, unpermitted cross-origin frames, CAPTCHA/OTP/login, assessments and unsupported custom widgets remain manual.

## Historical live application audit — 2026-09-11

- User authorized actual applications and submission, excluding acknowledgements/privacy declarations. Current Chrome profile is approved by the user. Plane is the first submission target; user-provided application answers remain in conversation/private candidate data, not this checkpoint.
- Browser Profile failed with a generic error. Local diagnostic requests proved `/v1/profile` and readiness returned 200, but `/v1/documents` returned 500. Migration0021 was absent.
- Applying0021 exposed a populated-database upgrade bug: provenance backfill hit the existing review-only proposal trigger. Fixed by transactionally dropping/recreating the same trigger around the provenance-only backfill under the migration's table lock. Pending/reviewed values and decisions remain unchanged. Migration0021 successfully applied locally; document endpoint returned200 and the actual browser Profile opened afterward.
- Added migration regression with pending and accepted legacy proposals, preserved encrypted payload/review timestamps, idempotency, forbidden mutation and valid review-transition checks. Three selected0021 migration tests passed; TypeScript passed. The later remediation removed the unused browser helper and completed the full green gate documented above.
- Browser findings still requiring fixes/investigation: editable email is blank while verified Contact email exists; saved total experience is56 months versus the supplied resume's3+ years and listed dates; document-history failure blocks the entire Profile via Promise.all; dashboard continues to offer a Visa job whose Workday page says already applied. The selected Postman role asks for5+ years, so suitability must be checked before submission.
- Baseline aggregate database counts before new application execution: AI usage0, AI reservations0, execution evidence19, learning observations5, learning checkpoints1, strategy evidence17. Environment has all three providers and document flags configured, but no new live inference or learning success has been proved.
- Actual pages inspected: dashboard/profile, Plane Ashby application, Postman Greenhouse application, Visa Workday already-applied state. Lever inspection timed out. Existing-tab debugger attachment later failed; opening a fresh dashboard tab recovered browser control.
- Latest stopping point: opened Replace master resume and attempted the supplied PDF via browser file chooser. Chrome refused setFiles with Not allowed; browser-control extension requires Allow access to file URLs. No new resume upload, autofill run, acknowledgement or application submission occurred in this audit.
- Resume from the fresh Job Hunter tab (1227045741 if still available), enable file upload through the user handoff, upload/reconcile the supplied resume, verify actual provider outcomes, test Plane autofill and manual correction/learning, then submit only accurate/authorized answers. Skip the already-applied Visa role and avoid claiming broad ATS coverage until remaining cases are exercised.

## Phase R — Resume & Document Intelligence: COMPLETE

Directive: `/Users/mac/.codex/attachments/a3c85e52-fbca-4f1f-956d-0fd9430d1d14/pasted-text.txt`.

### Authority and lifecycle

- Phase R evolves Phase G's existing document authority; V1 remains frozen import/reference code. There is still one Candidate Truth authority, one document authority and one execution path.
- Migration `0021_document_intelligence` adds immutable candidate/purpose versions, source lineage, job/application scope, generation runs, application-run pins, append-only lifecycle history and value-free upload evidence. All new private tables are account-RLS protected and mutation guarded.
- PDF master uploads are validated, privately stored and candidate-scoped deduplicated. They move through `UPLOADED` → `EXTRACTING` → `RECONCILING`; extraction failure is explicit `FAILED`. Only confirmation switches the prior `READY` master to `SUPERSEDED`. Rejecting a replacement archives the staged version and never damages the current master.
- Document history and authorized download APIs expose immutable metadata and usage without storage keys or public URLs. Retrieval revalidates stored byte length and SHA-256, uses `private, no-store`, and fails closed for corruption or cross-candidate access.

### Extraction and Candidate Truth reconciliation

- Extraction schema v2 records source section, a value-free item locator and evidence digest. Exact source text is transient. Typed private `EXTRACT_RESUME` calls through P cover contact, links, skills, employment, education, projects, certifications and awards; provider failure retains grounded deterministic extraction.
- P rejects ungrounded quotes or list items, duplicate identities, malformed contacts/links, impossible dates and inconsistent current ranges before R can persist proposals.
- Global facts reconcile as NEW/MATCH/CONFLICT. Repeatable entities reconcile by stable source identity and grounded multi-anchor fingerprints as NEW/MATCH/CONFLICT/AMBIGUOUS, never by array position. Ambiguity keeps saved truth by default.
- Confirmation uses append-only Candidate Truth writes and expected-version concurrency. A candidate edit after extraction makes a stale review fail instead of overwriting newer truth. Reprocessing the same document/extractor version and replaying confirmation remain idempotent.

### Grounded generation and explicit approval

- Tailored resumes and cover letters are built from the current `READY` master, TRUSTED Candidate Truth and normalized Phase H job data. Candidate declarations, file values, decline values and document references are excluded from prompt claims.
- R invokes only P's typed `TAILOR_RESUME` and `GENERATE_COVER_LETTER` private-data tasks. Provider caching is disabled. An explicit `AI_DOCUMENT_GENERATION_ENABLED` flag governs provider generation; the deterministic grounded fallback preserves the workflow when it is off or unavailable.
- Generated drafts are immutable, job-scoped versions in `RECONCILING`. Strict validation rejects uncited factual prose, unsupported skills, unsupported numbers and incorrect claim references. Failed runs clean partial objects and become retryable failures.
- Candidate preview is private and integrity checked. Approval is explicit and idempotent, moves only that version to `READY`, and records a receipt. Regeneration creates a new version without changing an older approved artifact. A cover letter never becomes Candidate Truth.

### Application document selection and upload

- R selects the approved job-specific tailored resume first and otherwise the current master. It selects only an approved cover letter for `COVER_LETTER`; a resume is never substituted. Every application run pins the exact immutable document version, so later regeneration or master replacement cannot change an in-flight or historical selection.
- R authorizes and integrity-checks private bytes, then returns a transient file payload directly to K. Object keys, URLs and raw content do not enter plans, receipts, logs or telemetry.
- J's `RESUME`/`COVER_LETTER` semantics request the matching R authority. Missing or unapproved artifacts return `DOCUMENT_NOT_READY`. K validates accepted MIME type, byte size and hash, then uses `NATIVE_FILE_DATATRANSFER@1` to populate native or visibly-associated hidden file inputs and dispatches input/change events. It verifies observed file count/name/size/type and visible error state without navigating or submitting.
- Upload evidence is idempotent by application run and operation. It stores only document/version authority and value-free observations. Q ignores document operations and receipts; uploader strategy ownership remains with Q while document choice remains with R.

### Security, privacy and ownership locks

- Account and candidate identity are session-derived. Private filesystem objects use restricted permissions and traversal-safe opaque keys. A content hash is an integrity/deduplication signal, never authorization.
- Raw resumes, generated prose, extracted values, transient base64 and storage locations are absent from checkpoints, generic telemetry and application receipts. Cross-candidate generation, retrieval, selection and evidence writes fail closed.
- R owns versioning, provenance, approval and document selection; J owns semantic recognition; K owns file-input execution and verification; P owns provider routing; Q owns strategy learning. Unsupported document types remain candidate-owned manual work.

### Verification evidence

- The supported Node 24.8.0 gate is green: architecture, lint, typecheck and **329/329 tests** with zero failures or skips. The production web and extension builds also pass.
- Database locks cover lifecycle monotonicity, one current master, deduplication, extraction replay, failed replacement safety, supersession, stable repeatables, concurrency rejection, private retrieval, immutable generation/approval, exact run pinning, later master/regeneration isolation, value-free evidence and cross-candidate denial.
- Controlled Chromium browser checks pass for Phase J field intelligence, Phase P AI privacy/failure behavior, Phase Q strategy isolation and the Phase K/N/R execution suite with **47 transient plans** and zero browser errors.
- Phase R browser scenarios directly exercise native resume upload, correct cover-letter selection, a visibly-associated hidden custom uploader and rejected MIME acceptance. Representative Greenhouse, Lever, Workday, ambiguous, dynamic and SPA fixtures remain covered. No application was submitted and no declaration was accepted.
- Upload/extraction/review/history/generation/approval/restart guarantees are locked at service, API and database layers rather than by a separate state-mutating candidate-UI click-through. The earlier Phase G web journey remains the UI regression baseline.

### Genuine limitations

- The current supported upload/generation format is PDF; DOCX support is not claimed. Local private filesystem storage remains the development adapter.
- Live provider generation requires the explicit flag and approved private provider configuration. Production object-storage integration and live employer-site certification remain deployment/Phase U work.
- Browser fixtures prove the execution contract safely; they do not claim certification against every third-party uploader. No real employer form was submitted.

Exact next boundary: **Phase S — Billing**. Do not reopen Phase R unless a behavior lock fails or Phase S exposes a concrete regression.

## Post-Q live autofill hardening — COMPLETE; final live ATS readback pending

A real-user Chrome audit found that Plane generated Q bindings but no execution receipt, while the background ignored a rejected content command and returned success to the panel. The extension now validates strict command acknowledgements, persists bounded value-free failures, renders them durably, excludes ordinary Job Hunter dashboard pages from employer scanning, clears stale page-scoped state across application steps, and reconnects the website session after extension restart. Version2.0.1 also binds each page runtime to its loaded content version and rejects a mixed old-page/new-background bundle with `EXTENSION_UPDATE_REQUIRED` before sending Scan/Fill.

The missing `.nvmrc` now pins Node24.8.0; the unsupported Node20 shell reproduces native PDF/PGlite failures. Final automated gate: architecture/lint/typecheck green, **310/310 tests**, Phase I browser smoke and Phase K/N/Q42-plan browser smoke. The real Chrome dashboard showed `Waiting for this page` with no form counts, confirming dashboard exclusion. Final Plane and cross-ATS fill/readback testing still requires the Mac to be unlocked and the unpacked extension plus employer pages to be manually reloaded. No form was submitted, resume uploaded or declaration accepted.

## Phase Q — Strategy Intelligence: COMPLETE

Directive: `/Users/mac/.codex/attachments/bb93f5ed-6284-4b8c-a927-a50a146312dd/pasted-text.txt`.
Detailed policy, commands and limitations: [STRATEGY_INTELLIGENCE.md](STRATEGY_INTELLIGENCE.md).

### Audit — COMPLETE; do not repeat

K owns ten healthy versioned strategies and independent verification. L owns authenticated evidence/observations; N graph state and O declarations remain authoritative. P is the only provider entry point. V1 remains frozen reference/import material; no V1 runtime path was added or removed. Q wraps compatible preference around K, not a rewrite of healthy mechanisms. Earlier partial checkpoints (293 tests, feature off, missing worker/proof) are superseded by this resumed implementation.

### Q1/Q2 — COMPLETE

- One shared builtin registry in contracts/strategy-policy.ts; versioned immutable definitions reuse strategy_versions. Scope-specific lifecycle: STABLE, CANDIDATE, CANARY, DEGRADED, DISABLED, REJECTED, RETIRED. Candidate behavior has content-addressed identity; definitions never mutate under an existing version. Variable-length compatible lists retain safe stable fallback.
- Authoritative PostgreSQL cluster state/history, policy revision/OCC, per-operation binding and value-private version-specific evidence. Batch planning performs one definition lookup, memoized cluster lookup and atomic bounded bindings. No browser authority store or Redis dependency.
- L receipt persistence and observation persistence atomically schedule Q work in existing worker_jobs. Bound receipt attempts and separate feedback project into Q; replay and cross-tenant/context/strategy assignment mismatches reject. Non-contributing accounts cannot influence shared preference.
- Metrics separate technical verified success, execution/verifier failures, latency, retry/fallback, samples/users and user feedback. Recent window7 days; operator historical summary30 days capped10,000 events, severe first. The helper's lifetime label means supplied window, not exact all-time totals; durable underlying history is retained.

### Q3/Q4 — COMPLETE

- Causal categories separate execution, verifier, representation, semantics, truth, entities, graph, runtime/site change, policy, user and unknown. Only executed+independently verified counts as technical success. Overwrite alone is not execution failure; readback mismatch is not proof of a new strategy gap.
- Discovery needs >=5 unique execution-failure operations across >=3 candidate/account units within7 days. Trusted structural manual patterns are projected without values, tied to persisted same-field/run observations and failed operations. Disabled/rejected evidence sets do not repeatedly generate the same review task.
- Deterministic compatible alternatives/manual templates precede P. P GENERATE_STRATEGY_CANDIDATE selects supplied approved text/textarea plans; P ANALYZE_EXECUTION_FAILURE provides bounded analysis otherwise. Q validates again; source IDs/origin remain inspectable. AI failure/unsafe code cannot introduce production behavior.
- DSL: builtin references or bounded target-only text focus/set/input/change/blur. No arbitrary JS, selectors, network, submit or navigation primitives. Mechanisms beyond approved primitives remain developer/release tasks.

### Q5 — COMPLETE

- Independent Playwright pipeline runs actual K executor/orchestrator/verifier against16 synthetic scenarios: normal, textarea, framework interception, rerender, delayed reversion, disabled, prior ownership, mid-action intervention, graph change, page transition, unrelated-control side effect, dynamic fields, declaration refusal, duplicate execution, failed-candidate→verified-stable fallback, expired selection.
- Signed proof binds immutable definition, required checks, suite, reviewer and time. Unsigned/tampered/stale/future/wrong-reviewer proof rejects. VALIDATE runs the suite; no caller-supplied green object is accepted. Deliberately incompatible direct setter fails framework validation.
- Reviewer renewal may refresh a still-running CANARY proof; rejected/disabled versions cannot regain exposure through validation. Current certifiable generated class is native text/textarea TEXT. Other control types require extending the independent suite, not arbitrary AI code.

### Q6 — COMPLETE

- HMAC assignment scoped by account/candidate/run/cluster/experiment; deterministic within stage. Rollout5→20→50%. Each advance needs >=200 additional eligible samples/arm, >=20 users/arm, cap10 samples/user/arm, non-overlapping95% Wilson bounds, acceptable latency/fallback/user rates and fresh proof.
- Only first attempts compare arms; stable fallback remains when safe. Tiny samples or reused observations cannot promote. Current server selections expire after30 seconds; stale bindings fail revision authority.
- Severe candidate/control evidence stops exposure; verifier/failure, latency and independent user-signal spikes halt canary. Operator starts canary only after offline review, never automatic discovery approval.

### Q7 — COMPLETE

- Sufficient evidence promotes new primary with former stable retained. Scoped stable degradation selects a remaining compatible backup; no safe strategy means no execution. Explicit disable/reject/rollback/retire are audited and do not erase historical evidence. Rollback target must be current primary; retirement protects primary/prior-primary/control fallback dependencies.
- SQL row locks, OCC, canonical intent fingerprints and unique history keys guarantee one concurrent promotion. Evaluation retry after restart/promotion/later rollback returns original committed result without modifying newer state. No-op evaluations are read-only; subsequent evidence uses fresh command/current revision.
- Durable queue: atomic INGEST/FEEDBACK/EVALUATE, coalesced pending evaluations, exclusive SKIP LOCKED leases, crash recovery, bounded retries/DEAD diagnostics, sanitized errors and successor evaluation for new evidence. Server owns/awaits worker start/shutdown; no detached per-field AI promises.

### Q8 — COMPLETE

- Operator CLI: scripts/strategy-admin.ts via npm run strategy:admin -- command.json. INSPECT/DISCOVER/VALIDATE/CANARY/EVALUATE/DISABLE/REJECT/ROLLBACK/RETIRE. Requires trusted OS/database access; audit actor UUID is supplied by operator. Future T authentication/UI not implemented.
- Local migrations0019_strategy_intelligence and0020_strategy_operations applied successfully. Q now composes by default with existing database/HMAC; explicit false opts out. Candidates remain review-gated. No secrets or actual environment values changed.
- Actual local API/worker startup on isolated port passed health, produced no stderr and shut down cleanly (exit0). Temporary server was stopped. No real applications or provider requests initiated.
- Final full gate (including reviewer-renewal, rollback-target and durable-worker-only integration): **304/304 tests passed, 0 failures, 0 skips**. Architecture, lint and TypeScript checks passed under Node24.8.0.
- Browser gates passed: independent Q16; restricted Q/K/N42 transient plans (conditional/nested/option/repeatable/requiredness/validation/multistep/user/rerender/recovery/cycle); O9 context-bound plans; L/M verified learning/corrections/reuse/group identity/partial Undo/privacy; P/J8 semantic batches across Greenhouse/Lever/Workday/ambiguous/dynamic/SPA and malformed-provider graceful fallback.
- Page/content/service-worker error collectors passed in controlled suites. Final production web/extension builds passed and restored normal origins. Browser-bundle scan found no provider endpoints or server key-variable identifiers. Standard PDF test retains its pre-existing standardFontDataUrl warning but passes.
- Database tests use PostgreSQL semantics through PGlite: actual SQL persistence/locking/history with synthetic population for promotion; separate full L→durable worker→Q integration tests real bindings/observations. Queue tests cover duplicate/exclusive/recovered leases, successor/coalescing, wrong owner, retries and DEAD. No claim of production multi-host load testing.

### Safety fixes proven during Q

K independent verifier now observes its full bounded readback window (detects delayed reversion); operation replay is bounded/idempotent; target-only primitives check live graph/user ownership between actions; unsafe side effects stop fallback; native text restoration before fallback was repaired. Unauthorized declaration receipts report pre-execution refusal without inventing truth metadata. These fixes preserve O authorization and candidate-owned final Submit.

### Changed owners and recovery map

- Shared contracts: strategy-policy.ts, execution.ts, learning.ts; P tasks/model validation.
- packages/strategy-intelligence: model, metrics, lifecycle/discovery service, behavior tests.
- packages/database: strategy-repository/queue and tests, verified-learning-repository atomic jobs; migrations0019/0020 and ordered runner/schema exports.
- apps/api: strategy-bridges, strategy-worker, integration tests, server composition.
- apps/extension: executor/orchestrator/verifier, ownership/controller signals, independent testing fixture.
- scripts: strategy-offline, strategy-admin, phase-q-browser-smoke, phase-k-browser-smoke Q mode; package scripts/dependencies/architecture wiring.
- docs: this checkpoint, STRATEGY_INTELLIGENCE, CONTEXT_INDEX and README.

### Genuine limitations / frozen boundaries

Authenticated client receipts are not cryptographic browser attestation; influence caps are not complete anti-Sybil protection. Generated certification is deliberately native-text-only. Safety stop follows durable evidence and issued plans can live30 seconds; already-running page effects cannot be undone remotely. Structural fingerprints do not detect unchanged-layout script behavior changes. Native-control side-effect detection is conservative; readback is bounded; dedup cache covers1,000 recent operations per content runtime. Operator identity relies on existing OS/database authority. Historical metrics are bounded-window summaries, not an all-time counter service. Full production hardening, broad ATS certification, T UI/auth and load testing remain future phases.

No provider keys were required/created; requested account preference remains lavishgarg.tech@gmail.com if future setup needs keys. No private answers/resumes/credentials recorded here. No V1 deletion, commit, push, deploy, hosting, real employer submission or R implementation occurred. Older CORS3001 configuration incident is separate, not resolved by Q.

Exact next boundary: **Phase R — Resume & Document Intelligence**. Await the R directive; no R implementation was started. Q1–Q8 are complete for the supported restricted-plan scope. Do not re-audit K/P/V1 or reopen verified Q unless a behavior lock fails. Local migrations are current through0020; use the operator workflow for any subsequent candidate review/experiment, never bypass its evidence gates.


## Phase P — AI Orchestrator: COMPLETE

Directive: `/Users/mac/.codex/attachments/d22a0475-02c2-4818-a4cd-ece9c6994e97/pasted-text.txt`.

### Initial P audit — COMPLETE

- V2 has no direct provider SDK/HTTP calls. J exposes FieldCanonicalizationAiPort with compact/rich payloads, schema/allowed-ID checks and deterministic cache; production constructs it without an adapter. M exposes EntityBindingAiPort, also unconfigured in production.
- G uses PdfJsResumeTextExtractor and DeterministicResumeCandidateExtractor; extraction proposals are encrypted and reviewed before Candidate Truth. H and O are deterministic and need no new AI call.
- Frozen V1 calls live in src/services/openai.js (scoring, tailoring, embeddings, canonicalization), applicationAnswerer.js and sidePanelAssistant.js; callers and aiTelemetry.js own legacy retries/costs. These remain frozen reference-only, never imported by V2.
- Add one server-side packages/ai owner with typed capability registry, provider REST adapters, normalized errors, validated evidence-based confidence, routing, budgets, privacy and bounded resilience. API composition bridges J/M/G ports to P; no generic public prompt endpoint.
- Intended routes: compact tasks Groq, documents Gemini, permitted fallback OpenAI. Model IDs and conservative token tariffs must be server-configured together; no guessed free quota or unpriced request is allowed.
- Keys use the requested account only if needed. Standard verification uses fakes; no credential changes or private live provider transmission has occurred.
- Next: implement P1/P2 contracts/adapters, then central P3–P7 controls and migrate composition.

### P1/P2 — contracts and adapters: COMPLETE

- Added packages/ai with strict requests for CANONICALIZE_FIELD, DISAMBIGUATE_ENTITY, EXTRACT_RESUME and ANALYZE_EXECUTION_FAILURE. Scope, privacy, correlation, limits and fallback permission are explicit; normal callers cannot send a provider, model or arbitrary prompt.
- REST adapters centralize Groq/OpenAI chat-completion structured outputs and Gemini generateContent JSON schema, headers, usage and sanitized errors. Partial/refused/invalid responses fail closed. Model IDs, context limits and conservative tariffs require server configuration.
- Focused core verification: 11/11 tests pass, including all three wire formats, unconfigured/auth/rate errors, invented identifiers and route separation. No live credentials required.

### P3/P4 — routing and confidence: COMPLETE

- Version P1-2026-09 task registry selects Groq for compact tasks, Gemini for document tasks, OpenAI as the only bounded fallback. No all-provider waterfall; at most two attempts; privacy/safety rejection never triggers a bypass.
- Confidence is bounded by deterministic evidence: canonical vocabulary separation, unique entity coverage, exact document source quotes and failure/diagnosis consistency. Model confidence alone cannot admit output.
- Domain bridges are being integrated. J retains deterministic first and domain confidence; M outage returns ambiguity; G retains its parser and encrypted reviewed proposal workflow.
- Next: finish durable accounting/operational foundation, integration behavior locks and browser regression.

### P5 — cost/quota controls: COMPLETE

- Per-request ceilings plus global/candidate/application daily USD-micro reservations precede each dispatch. Fallback cannot exceed the request ceiling. Reservations retain conservative full cost after timeout/invalid output because remote work may still be billed.
- Migration 0018 adds append-only ai_request_reservations and extends existing ai_usage_events. PostgreSQL advisory locking serializes global cap admission; candidate/application ownership and duplicate/fingerprint checks prevent cross-tenant or restarted replay. No second billing system.
- Configured live adapters require both explicit tariffs/context limits and the durable ledger. Local in-memory controls additionally bound candidate request rate, provider minute rate and concurrency.

### P6 — privacy/resilience: COMPLETE

- Private routes require provider approval; resume AI additionally requires AI_RESUME_ENABLED. Private result caching is disabled. Semantic cache/coalescing keys include account/candidate/application, policy/task version, provider/model and request limits.
- Stable server HMAC fingerprints protect durable reservation identities. Cache keys contain no raw values. Ambiguous previous dispatch is not replayed. Timeouts abort transport and bound caller wait; safety refusal stops fallback.
- J now partitions its semantic cache by trusted scope and avoids caching unavailable/schema-failed AI. M catches optional AI outage and remains ambiguous instead of breaking the runtime.

### P7 — observability/admin foundation: COMPLETE

- Typed task/version/route/schema/provider/model/attempt/usage/reserved-cost/confidence/cache/failure events contain no prompts/responses. Append-only usage rows and a bounded process health snapshot support later T; no admin UI.
- Current focused gate: 17/17 policy/adapter/integration/PostgreSQL tests pass; typecheck, lint and architecture pass. P8 browser and full regression verification remain pending.

### P8 — integration migration, hardening and closure: COMPLETE

- One production composition root constructs P with the durable PostgreSQL ledger. J canonicalization, M entity disambiguation and optional G contact extraction use typed API bridges. H and O remain deterministic; O policy and Candidate Truth authority are unchanged. No public arbitrary-prompt/model endpoint was added.
- Final Node 24.8.0 gate: `npm run check` passed architecture, lint, typecheck and **285/285 tests**, zero failures/skips. `npm run build` passed web and extension builds and restored default extension origins after isolated browser tests.
- Browser checks passed: P/J invalid primary/fallback rejection and deterministic/auth/SPA/privacy degradation; O's nine guarded declaration plans; L/M verified learning, repeatable identity, correction, abandonment and partial-safe Undo. These are controlled unpacked-Chromium fixtures, not live employer certification or paid-provider tests.
- Local database target was verified as loopback. `npm run db:migrate` applied previously pending 0017 declaration policy and 0018 AI orchestration; 0001–0016 were already current. Full-chain and ledger tests cover migration idempotence, durable budgets, tenant ownership and append-only usage/reservations.
- Final source scan found provider HTTP endpoints only in `packages/ai/src/providers.ts`. No provider SDK imports remain in V2 business layers. Final browser/extension JavaScript scan found no provider key variable names, provider endpoints or OpenAI project-key markers. Frozen V1 provider code is intentionally untouched.
- Operational details and task registry: [AI_ORCHESTRATOR.md](AI_ORCHESTRATOR.md). Configured model IDs/context limits/tariffs and provider-private permission are mandatory; no key was created or changed and no live model/quota/price compatibility is certified. Fake tests require no paid credentials.
- Genuine limits: minute-rate/circuit/coalescing state is process-local; durable daily ceilings and dispatch identities are shared. Costs are conservative reservations, not verified invoices. Diagnostic writes are best effort; pre-dispatch/cache events are process-local. G's AI augmentation is limited to grounded reviewed contact proposals; binary PDF/OCR and richer document work remain R. No Q/R/S/T/U feature expansion, commit, push, hosting or production deployment occurred.
- Next exact boundary: **Phase Q — Strategy Intelligence**. Do not reinterpret older phase next-action notes as current work.

Context retrieval: [CONTEXT_INDEX.md](CONTEXT_INDEX.md). The [Phase P brief](directives/PHASE_P_AI_ORCHESTRATOR.md) is preserved and P1–P8 are complete. The index retains the credential-account preference and the independently diagnosed, unresolved 3001/CORS incident; Phase P did not change local origin configuration.

## Phase O — Declaration & Consent Policy: COMPLETE

Authoritative directive: `/Users/mac/.codex/attachments/504b4d04-a913-42d9-baa3-5f5ef25f0582/pasted-text.txt`.

### Initial O architecture/policy audit — complete

- J is the only semantic authority. Its deterministic ontology already recognizes four application declarations (`CERTIFY_INFORMATION_ACCURATE`, `PRIVACY_ACKNOWLEDGEMENT`, `BACKGROUND_CHECK_AUTHORIZATION`, `TERMS_ACKNOWLEDGEMENT`), but it has no declaration-like hint for unresolved controls such as a bare “I agree,” and it does not yet cover data-processing consent, broader applicant certification or application-specific acknowledgement.
- Candidate Truth still carries declaration canonical definitions because J's current canonical registry is shared with it. Its fail-closed consent policies are application-scoped, `reuseMode = NEVER`, `learningMode = APPLICATION_AUTHORIZATION`, and have no permanent commit point. Phase O will preserve the registry compatibility while preventing declaration fields from invoking Candidate Truth resolution at all.
- K owns checkbox/radio/select mechanics. Its planner currently skips known consent canonicals through Candidate Truth's `APPLICATION_GESTURE` autofill mode; the content executor itself has no O authorization contract, so a forged or future declaration operation could reach the generic checkbox strategy. This is the authoritative bypass to close.
- N owns reachability, requiredness, conditional reveal, graph revisions and stale-control guards. N does not currently authorize declarations and will remain unchanged except that O decisions must bind to its page/graph/control context.
- L already rejects consent canonicals because they are not normal learnable candidate answers, and the content controller maintains a hardcoded declaration exclusion set. That scattered list will be replaced with typed declaration metadata. Declaration interactions and candidate overrides need a separate application-scoped append-only evidence path.
- The side panel shows field/fill/learning counts only. There is no dedicated `Declarations & acknowledgements` review surface and no candidate-friendly split between prepared, needs-action and review-before-submit items.
- No second V2 declaration executor, hidden terms crawler, globally remembered consent value, or unconditional `required checkbox -> checked` path was found. The generic checkbox strategy is technically capable of setting any boolean and therefore must be guarded by O both in the planner and immediately before DOM execution.
- Existing browser fixtures prove known privacy consent remains unchecked, conditional graph behavior, stale revisions and user ownership, but they do not provide the complete Phase-O declaration matrix or dedicated evidence/review assertions.
- Baseline on Node 24.8.0: architecture, lint and typecheck passed; 240/241 tests passed. The sole failure was the OIDC verifier fixture being denied a loopback listener by the filesystem/process sandbox (`listen EPERM 127.0.0.1`), not an application assertion. Re-run that gate outside the restricted sandbox at closure.
- The prior live-Ashby retest recorded in `Real product audit — ACTIVE CHECKPOINT 1` cannot be performed through the available Codex in-app browser because no extension-capable Chrome connection is present. Phase O will use the repository's unpacked-Chromium controlled harness and the in-app browser for local candidate-facing review verification. No real application will be submitted.

### Frozen Phase O implementation decisions

- Add one `@job-hunter-v2/declaration-policy` package. It consumes J's structured semantic evidence plus N/K runtime context; it does not inspect the DOM, resolve Candidate Truth, execute controls or learn candidate answers.
- Add versioned, strict contracts for declaration taxonomy, policy decisions, K-bound authorization, review summaries, failure classes and value-private application evidence. Current policy will expose `AUTO_ALLOWED` but authorize no silent automatic declaration acceptance; low-enough-risk acknowledgements may be prepared only when high-confidence inspectable wording and guaranteed review are present.
- Add a dedicated append-only declaration evidence store and API. It records only category/policy/action/verification/runtime metadata; no candidate value and no raw declaration body.
- K will require a context-bound O authorization for every declaration-like operation and revalidate it immediately before DOM interaction. Requiredness, technical capability, prior acceptance and similar wording never grant authorization.
- Candidate changes transfer ownership permanently for the live field, append a `CANDIDATE_MODIFIED` declaration event and are never sent through L's Candidate Truth observation path.
- The side panel will always show declaration outcomes separately in candidate language. Final submit remains candidate-owned.

### O1/O2 — taxonomy and centralized policy engine: COMPLETE

- `packages/contracts/src/declaration-policy.ts` defines the strict typed taxonomy, semantic snapshot, runtime context, five policy outcomes, failure classes, context-bound authorization, candidate review item and value-private evidence contracts. Current policy version is `O1-2026-09`.
- Taxonomy: `ACCURACY_CERTIFICATION`, `PRIVACY_ACKNOWLEDGEMENT`, `TERMS_ACKNOWLEDGEMENT`, `BACKGROUND_CHECK_CONSENT`, `DATA_PROCESSING_CONSENT`, `APPLICANT_CERTIFICATION`, `EEO_ACKNOWLEDGEMENT`, `APPLICATION_SPECIFIC_ACKNOWLEDGEMENT`, and `UNKNOWN_DECLARATION`.
- `@job-hunter-v2/declaration-policy` is the single policy owner. It binds decisions to application/run/page/form/field/control/semantic descriptor and N graph guard. Every declaration is `reusePolicy = NEVER`; company/application scope is inspectable metadata, never reusable authorization.
- Current automatic/manual/review rules: no declaration category is `AUTO_ALLOWED`; high-confidence, fully inspectable accuracy and privacy acknowledgements can be `PREPARE_FOR_REVIEW` only with an application identity, live/current control and guaranteed final review; terms, background checks, data processing, applicant certifications, EEO acknowledgements and application-specific acknowledgements require explicit candidate action. Unknown/ambiguous wording is `UNRESOLVED`; unavailable wording, missing application authority, stale/hidden/disabled controls and candidate ownership fail closed.
- Requiredness is recorded but is not an authorization branch. Required and optional declarations receive the same category policy.
- J now emits a value-private `declarationHint` separately from its canonical result, including declaration-like ambiguous wording. It recognizes the added declaration categories without adding them as reusable Candidate Truth definitions. Field Intelligence returns `NOT_APPLICABLE` and does not call Candidate Truth for any declaration-like field.
- Focused O1/O2 verification: contracts/typecheck green; declaration policy + Field Intelligence suites **57/57 pass**. Locks cover taxonomy, no silent auto-consent, requiredness non-escalation, ambiguous/unavailable text, candidate ownership, application context, policy versioning and value-private decision evidence.

### O3/O4 — K/J/N integration and candidate review UX: COMPLETE

- K now asks the centralized O service to evaluate every J declaration hint against the active application/run/page/form/field/control, semantic descriptor, ownership state and exact N graph guard. J remains semantic authority, N remains graph authority and K remains the only DOM execution mechanism.
- Declaration operations carry no Candidate Truth answer/version/scope. They require a strict O authorization, may only set a boolean true, and are limited to one attempt. The content preflight independently rechecks canonical, run/page/form/field/control, semantic descriptor and N graph guard before touching the DOM.
- Requiredness never changes authorization. Accuracy/privacy acknowledgements can be prepared for final review; terms, background checks, data processing, applicant/EEO/application-specific declarations and ambiguous “I agree” wording remain candidate actions. Ordinary non-declaration checkboxes still use the normal Candidate Truth path.
- Candidate interaction permanently transfers live-field ownership. Declaration changes are removed from L's learning path via typed J declaration metadata, not a duplicated hardcoded canonical list, and a subsequent Fill cannot recheck the candidate-owned control.
- The side panel has a dedicated `Declarations & acknowledgements` surface with candidate-friendly `Prepared by Copilot`, `Needs your action`, and `Review before submitting` states. It never presents internal field IDs, raw policy codes, risk scores or policy versions as user-facing labels. Declaration-only pages can open the review/fill flow even when no ordinary answer is available.
- Focused K/O behavior locks pass for allowed preparation, requiredness non-escalation, sensitive/unknown refusal, local-only declaration canonicals, generic-strategy bypass rejection, stale semantic preflight and ordinary checkbox preservation.

### O5/O6 — application evidence and non-reuse: COMPLETE

- Migration `0017_declaration_consent_policy.sql` adds one append-only, tenant-RLS-protected `application_declaration_evidence` ledger. It contains application/run/page/form/control/descriptor/graph identity plus typed declaration, policy, action, verification, failure and review metadata; it has no raw wording, field value, normalized value, candidate-answer or Candidate Truth version column.
- `KyselyDeclarationEvidenceRepository` verifies account/candidate/application/active-run authority, requires every non-decision event to match an exact prior `POLICY_DECIDED` row, serializes duplicate keys, detects changed replays and never updates/deletes evidence. Aggregate/attention indexes provide the future admin/reporting foundation without exposing candidate values.
- Authenticated `/v1/declarations/evidence` and the extension runtime record policy decisions, prepared/failed verification, explicit candidate actions, candidate modifications, review presentation and verified submission. Declaration receipts no longer enter L's ordinary execution-evidence route.
- Every taxonomy item remains `reusePolicy = NEVER`. No declaration interaction writes Candidate Truth, no prior application acceptance enters policy input, and decision fingerprints bind application identity. Reused wording or a second application therefore produces a new decision and cannot inherit consent authority.
- Focused migration/repository/API/policy checks are green (**30/30** in the combined persistence/API run), including append-only rejection, idempotent replay, foreign/stale authority rejection and strict rejection of raw declaration text.

### O7 — safety, privacy, failures and administration foundation: COMPLETE

- O has a separate typed failure boundary for unresolved/ambiguous meaning, policy block, explicit candidate action, unavailable material wording, missing authorization, execution/readback failure, candidate modification, stale runtime and changed context. K/J/N failures retain their own owners.
- Policy decisions fail closed when application identity is missing, the control is hidden/disabled/off-step, semantics are not high-confidence, wording is incomplete, the graph or descriptor changed, or the candidate owns the live control. Requiredness and technical capability never elevate authority.
- O1 prepares only boolean checkbox/switch accuracy and privacy acknowledgements. Radio, select, combobox and other declarations requiring an option choice remain explicit candidate actions until a future policy-authorized option contract exists.
- Candidate changes win immediately. Runtime ownership prevents a later Fill from restoring a Copilot-prepared declaration; append-only `CANDIDATE_MODIFIED` evidence preserves both events without storing the choice value.
- Raw wording, checked values, normalized answers, Candidate Truth IDs/versions and private candidate data are excluded from O contracts, database columns, generic telemetry and runtime persistence. J's stable semantic cache avoids repeated classification work, while authorization fingerprints remain application/run/page/form/control/graph specific and are never globally cached.
- Historical policy rows retain `O1-2026-09`. Category/outcome/event/failure indexes form a value-private Phase-T administration/reporting foundation; Phase O intentionally adds no admin policy editor.
- `docs/DECLARATION_CONSENT_POLICY.md` records the architecture, taxonomy, policy matrix, authorization binding, UX, evidence lifecycle, privacy rules, failure ownership, legacy cleanup and future boundaries.

### O8 — browser validation, regression hardening and closure: COMPLETE

- The Phase-O unpacked-Chromium fixture demonstrated all 10 required scenarios: an ordinary `AGE_OVER_18` checkbox stayed on Candidate Truth/K; required accuracy and optional privacy were prepared only for review; terms, background check, data processing, applicant/EEO/application-specific declarations and ambiguous “I agree” remained unchecked; a conditional privacy declaration flowed through N -> J -> O -> K; candidate override survived later Fill; a second application received an independent decision; the review surface was visible; and a materially rerendered control rejected its stale authorization.
- The run produced **9 context-bound declaration plans**. Each prepared operation ID was unique; policy/evidence requests were application scoped; Candidate Truth was called only for the ordinary checkbox; declaration receipts never entered L; raw declaration wording was absent from evidence; page and service-worker console error collectors were empty.
- Predecessor controlled-browser suites pass after O: Phase I extension discovery/SPA/multi-step/dynamic/iframe/auth/recovery, Phase J Greenhouse/Lever/Workday/ambiguous/dynamic/SPA semantics, Phase K/N guarded execution and dynamic graph convergence, and Phase L/M verified learning, Undo and repeatable-entity behavior.
- Final Node 24.8.0 gate: architecture, lint and typecheck pass; **264 tests pass, 0 fail, 0 skip**; web and default-localhost extension production builds pass. The default extension build was restored after the isolated Phase-O browser configuration.
- Browser validation used the repository's controlled unpacked-Chromium harness. The available Codex in-app browser has no extension-capable Chrome connection, so a live employer-site extension retest was not possible here. No real application was submitted.

### Phase O implementation surface

- Added `packages/declaration-policy` and the shared `packages/contracts/src/declaration-policy.ts` contracts; extended J, K, extension runtime/orchestrator/review UI and API composition to use the single O authority.
- Added `database/migrations/0017_declaration_consent_policy.sql`, `packages/database/src/declaration-evidence-repository.ts` and authenticated `apps/api/src/declaration-routes.ts`; updated the ordered migration runner, package references and architecture dependency checks.
- Added focused policy/repository/API/execution/graph-safety tests plus `scripts/phase-o-browser-smoke.ts`. No second executor, Candidate Truth store or declaration-learning path was added.
- Removed the content controller's hardcoded declaration-canonical exclusion in favor of J's typed declaration hint. Existing Candidate Truth declaration registry definitions remain compatibility metadata only and are never queried for declaration-like controls; remove them only with Phase-Z zero-read/write proof.
- Genuine unsupported scope: incomplete/linked-only legal wording is not crawled or legally interpreted; unknown/ambiguous declarations remain unresolved; non-checkbox declarations requiring a material option choice remain candidate-owned; provider AI routing is Phase P; strategy promotion is Phase Q; admin UI is Phase T; broad live ATS certification is Phase U; final submit remains candidate-owned.

### Phase O status and exact next boundary

- O1/O2: complete.
- O3/O4: complete.
- O5/O6: complete.
- O7: complete.
- O8: complete.
- Exact next boundary: **Phase P — AI Orchestrator.** Do not reopen O or earlier phases without a concrete failing behavior lock. No external application submission is authorized.

This is the authoritative recovery checkpoint. Phases F–O are complete and green. Do not re-audit or rebuild them without a concrete failing behavior lock. The prior live-Chrome prerequisite below was explicitly superseded by the later Phase-O implementation directive; it remains a genuine product-audit limitation, not a blocker to the completed controlled Phase-O implementation and proof.

## Real product audit — ACTIVE CHECKPOINT 1

- Scope: candidate-facing demo cleanup, real synced application launch/detection, local master-resume replacement, extraction/Candidate Truth reconciliation, persistence, two-tab isolation and diagnostics. No external application submission is authorized.
- Supplied PDF is private manual test data only. Its contents, values and raw bytes must not enter repository fixtures, logs, telemetry or this checkpoint.
- Browser reproduction confirmed the candidate Jobs page mixed controlled H0 audit fixtures with live records. The fixture records are tagged `ats = AUDIT_FIXTURE`; they are database-backed automated-test evidence, not candidate data. There is no second hardcoded V2 Applications/dashboard path in the current web shell.
- Fixed the authoritative candidate catalog boundary in `packages/database/src/job-catalog-repository.ts`: discover/detail/related paths now exclude `AUDIT_FIXTURE` while preserving the rows for automated testing and operator inspection. A repository regression proves fixtures cannot enter discovery or direct detail.
- **2026-09-03 dashboard re-check:** authenticated `http://127.0.0.1:3000/` Jobs page now lists the 19 live India engineering roles (Plane, Visa, Postman, Bosch, Meesho). No `AUDIT_FIXTURE` / “Backend Fixture” cards. Plane Backend Node.js **Apply with Copilot** carries `data-jh-copilot-launch`, a real job UUID, and `https://jobs.ashbyhq.com/plane/188f905e-3f6f-4569-9a32-d8ec48dfe656/application`. Cursor’s embedded browser cannot load the unpacked Chrome extension, so dashboard→side-panel launch was **not** proven here.
- Starting extension evidence: a real Ashby application form was open and the extension side panel was authenticated/connected but reported `No application detected`.
- Detection trace found two coupled optional-permission recovery defects. When permission was already granted after/on an open employer tab, no content runtime was injected into that existing document; and status discarded the active origin when no runtime record existed, hiding the correct `Allow Copilot on this site` recovery action.
- Fixed `apps/extension/src/background/site-access.ts`, `message-router.ts`, `runtime-registry.ts` and `content/entry.ts`: status preserves the active employer origin, a granted site can self-heal an already-open tab, registration/injection is idempotent per frame, and granting access injects the active matching tab immediately.
- Tightened page identity so a button or ordinary search form is not enough to create an application run. Real forms and application-route standalone controls remain supported.
- **Ashby SPA detection (same audit, later lock):** the tightened identity still required a `<form>` or already-rendered standalone controls. Ashby’s first HTML is a JS shell (`/{company}/{uuid}/application`) with no `<form>`, so an empty scan went `UNSUPPORTED` / no content runtime, which the side panel shows as “No application detected”. `detectApplicationSurface()` now marks known ATS application routes (Ashby UUID `/application`, Greenhouse/Lever/Workday/SmartRecruiters `/apply|application`, generic `/application` paths) even at 0 fields. Empty scans with an `applicationKey` stay `APPLICATION_DETECTED`. Ordinary pages, search-only forms, and Ashby job postings **without** `/application` still get no key. No Ashby field-selector map was added.
- **Dashboard → Copilot launch (same audit, later lock):** V1 opened the side panel from a content-script `chrome.runtime.sendMessage` in the same user-gesture turn. V2 React `await connect()` then `launch()` dropped the gesture; `WEB_LAUNCH_REQUEST` also aborted `tabs.create` when optional host access was missing. V2 now: (1) capture-phase click on `[data-jh-copilot-launch]` sends `WEB_LAUNCH_REQUEST` immediately; (2) `consumeLaunchGesture()` calls `chrome.sidePanel.open` synchronously in `service-worker.ts` `onMessage` before any `await`; (3) launch still creates the employer tab and returns `PERMISSION_REQUIRED` **with `tabId`** so Allow can happen in the panel. V1 files were not imported; V1 was gesture-timing reference only.
- Extension behavior locks now cover optional access recovery, missing-runtime origin status, two simultaneous application tabs, ordinary-page rejection, SPA, multi-step continuity, dynamic forms, iframes/reload, service-worker recovery, Ashby URL-without-form detection, empty-scan `APPLICATION_DETECTED`, and dashboard launch-gesture timing. Focused audit tests **20/20 pass**. Unpacked Chromium suite from Phase N remains the prior green baseline; it was not re-run in this session.
- Local services: V2 web on `127.0.0.1:3000`; V2 API on `127.0.0.1:3100`. Default unpacked build output: `apps/extension/dist` (localhost origins include `http://127.0.0.1:3000`).
- Existing live test catalog remains 19 real India engineering jobs across Greenhouse, Lever, Ashby, SmartRecruiters and Workday.
- Baseline before this audit: architecture/lint/typecheck green and 225 automated tests passing. Focused post-fix tests are green; full gate remains for audit closure.
- Browser routes tested so far: authenticated Jobs page (fixture leak reproduced, then cleaned list re-checked); Plane job detail Apply attributes verified; controlled unpacked-extension static/ordinary/two-tab/SPA/multi-step/dynamic/iframe/reload/worker-recovery routes from earlier in this audit. Live Ashby scan/fill HAR captured 2026-09-04. No application was submitted.
- Plan alignment for this session: catalog exclusion stays at the repository (not a frontend hide). Detection was widened only for known application routes, with ordinary-page locks kept. Launch restores Chrome’s user-gesture requirement without a competing answer store, scanner/Field Intelligence collapse, or Phase O/R work.
- **2026-09-04 Ashby fill HAR (same audit):** CORS is gone (`OPTIONS`/`POST` 200 with extension ACAO). Scan resolved Name/Email/LinkedIn/Experience as `AVAILABLE_REUSABLE` but `RESOLVED_MEDIUM` (~0.72–0.86). Planner still requires `RESOLVED_HIGH`, so `planned: 0` and those fields were `GRAPH_NEEDS_USER`. Root cause: Field Intelligence concatenated decorative placeholders (`Type here...`, `hello@example.com...`) into the alias signal, so exact labels such as `Name`/`Email` never hit high. Resume was the only HIGH field and is correctly skipped as `FILE_REQUIRES_DOCUMENT_FLOW`. Location/CTC were `MISSING` in Candidate Truth (not a fill bug). Relocate/join questions were policy-blocked or ambiguous. Fix: score label/aria independently of placeholder; ignore decorative placeholders in scanner labels; exact `name` alias for `FULL_NAME` with first/last/company negatives; multi-word contained aliases score 0.90. Executor HIGH-only rule unchanged. Field Intelligence tests **46/46 pass**.
- **2026-09-04 second Ashby fill HAR — why the confidence fix appeared to do nothing:** the rebuilt extension was live (scanner labels arrived clean as `["Name"]`, no `Type here...`), but `/v1/field-intelligence/resolve` returned byte-identical confidences (`0.7208`/`0.7458`/`0.865`) with `resolver: CACHE`. Root cause was **build topology, not scoring**: every workspace package is consumed through `package.json` `main → ./dist/index.js` (there are no tsconfig `paths`), and `dist` for `field-intelligence`, `contracts`, `execution`, `form-graph`, `repeatable-entities`, `verified-learning` and `database` was last emitted **2026-09-02 19:53**, before the scoring edits. `dev:api` ran `tsx` straight at `apps/api/src/server.ts` and `build:extension` ran esbuild only, so **neither script ever compiled its workspace dependencies**. The API had been serving two-day-old compiled Field Intelligence the entire time. Fixes: `tsc -b` now fronts both `dev:api` (root `package.json`) and `@job-hunter-v2/extension` `build`, matching what `@job-hunter-v2/web` already did. `apps/extension/tsconfig.json` is `noEmit` into `dist-types`, so this cannot clobber the esbuild bundle. Two latent type errors that esbuild had been silently bundling past were fixed at the same time (`content/messaging.ts` deferred-generic `createRequest` call, `content/scanner.ts` `string | null` reaching `isDecorativeFieldHint`).
- **Confidence fix verified against the recorded HAR evidence** after rebuild: `FULL_NAME` `0.7208 → 0.965` (margin `0.31` over `FIRST_NAME`), `EMAIL` `0.7458 → 0.99`, `LINKEDIN_URL` `0.865 → 0.925`, `TOTAL_EXPERIENCE` `0.865 → 0.925` — all now `RESOLVED_HIGH`. `RESUME` stays `0.99`. `CURRENT_LOCATION`/`CURRENT_CTC` also reached HIGH but remain `MISSING` in Candidate Truth. The three free-text questions stay `AMBIGUOUS` by design.
- **Second independent blocker found in that HAR (by design, not a defect):** `Name` and `Email` arrived as `ownership: USER_OWNED` while all other fields were `UNKNOWN`. `packages/execution/src/service.ts` sets `ownershipAllowed: field.ownership !== "USER_OWNED"`, so those two fields would have been held at `GRAPH_NEEDS_USER` **even at `RESOLVED_HIGH`**. `FieldOwnershipTracker` claims `USER_OWNED` on trusted `pointerdown`/`click`/`keydown`/`beforeinput`/`input`/`change`/`paste`, so a bare click into a field permanently yields it for that page instance. This matches the documented and behavior-locked rule in `docs/EXECUTOR_VERIFIER.md` ("Trusted pointer, keyboard, input, change, click and paste activity transfers ownership to the candidate") and checkpoint K5–K7. **It was left unchanged.** Consequence for verification: the retest must not click into any field before pressing Fill.
- **Test-run correctness note:** `npm run check` reported 2 failures (`tests/v1-candidate-truth-export.test.ts` `SIGSEGV`, onboarding PDF extraction) only because the shell defaulted to Node **v20.19.5**. Under the required Node **24.8.0** the same gate is architecture/lint/typecheck green with **241/241 tests passing**. Node 24 is mandatory for this repo (`engines.node: 24.x`); Node 20 produces a native crash in the pglite/PDF paths.
- Files changed so far: `package.json`, `apps/extension/package.json`, `packages/database/src/job-catalog-repository.ts`, `packages/database/src/job-intelligence.test.ts`, `packages/field-intelligence/src/semantic-resolver.ts`, `packages/field-intelligence/src/ontology.ts`, `packages/field-intelligence/src/field-intelligence.test.ts`, `docs/FIELD_INTELLIGENCE.md`, `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/api/src/config.ts`, `apps/extension/src/shared/identity.ts`, `apps/extension/src/shared/identity.test.ts`, `apps/extension/src/shared/contracts.test.ts`, `apps/extension/src/shared/runtime-state.ts`, `apps/extension/src/shared/runtime-state.test.ts`, `apps/extension/src/content/entry.ts`, `apps/extension/src/content/controller.ts`, `apps/extension/src/content/messaging.ts`, `apps/extension/src/content/scanner.ts`, `apps/extension/src/content/observer.ts`, `apps/extension/src/content/website-bridge.ts`, `apps/extension/src/background/site-access.ts`, `apps/extension/src/background/message-router.ts`, `apps/extension/src/background/runtime-registry.ts`, `apps/extension/src/background/service-worker.ts`, `apps/extension/src/background/side-panel-gesture.ts`, `apps/extension/src/background/side-panel-gesture.test.ts`, `apps/extension/src/background/site-access.test.ts`, `apps/extension/src/background/runtime-foundation.test.ts`, `apps/extension/src/sidepanel/main.ts`, `apps/extension/scripts/browser-smoke.ts`, `apps/web/src/App.tsx`, `apps/web/src/extension-client.ts`, and this checkpoint.

### Exact next action

Use Node **24.8.0** for every command below.

1. Packages are already rebuilt and the API auto-restarted on the re-emitted `dist` (fresh process, empty Field Intelligence cache). If the API is not running, `npm run dev:api` from `v2` now compiles dependencies first.
2. Reload unpacked `v2/apps/extension/dist` in Chrome.
3. Hard-refresh the Ashby application. **Do not click into any form field** — a trusted click claims `USER_OWNED` and will correctly hold that field at `GRAPH_NEEDS_USER`. Scan, then **Fill safe fields**. Do not submit.
4. Expect Name, Email, LinkedIn and total experience to type (`planned: 4`). Resume stays `FILE_REQUIRES_DOCUMENT_FLOW`. Location/CTC stay empty (`MISSING` in Candidate Truth). The three free-text questions stay with the user.
5. Confirm `/v1/field-intelligence/resolve` shows `RESOLVED_HIGH` for Name/Email and `/v1/execution/plan` has `planned > 0`.
6. Resume replacement still waits on that green fill. Do not start Phase O.

## Live ATS test catalog — COMPLETE

- Added replay-safe local command `npm run jobs:sync-live -- --limit=4` in `scripts/sync-live-jobs.ts`.
- It fetches current India engineering listings from the public Greenhouse/Postman, Lever/Meesho, Ashby/Plane, SmartRecruiters/Bosch and Workday/Visa feeds, then uses the existing H ingestion and lifecycle services. It never writes directly to catalog tables.
- The feed is deliberately capped and records scans as incomplete, so a listing omitted by the test cap can never be inferred closed or stale.
- Public source payloads are preserved under `.local-data/job-evidence`; the directory is ignored. The parser deterministically extracts plain descriptions, India location, work mode, employment type, bounded skills and conservative experience ranges without AI.
- Current local catalog: **19 live jobs** (Greenhouse 3, Lever 4, Ashby 4, SmartRecruiters 4, Workday 4), all ACTIVE/India, with 19 immutable snapshots, 19 receipts, no missing application URL and no empty description.
- Exact same-hour rerun replays all 19 operations without duplicate jobs, snapshots or receipts.
- Authenticated `/v1/jobs` returns the records and the V2 Jobs UI renders search, ranking, detail evidence and the application action. Search `Software Engineer, Backend` to surface live Plane/Postman/Meesho examples above controlled audit fixtures.
- Application URL probes returned 200 for Greenhouse, Lever, Ashby and Workday. SmartRecruiters returned bot-protection 403 to the scripted probe; the URLs are the authoritative `applyUrl` returned by its live detail API and should be exercised interactively in Chrome.
- Post-sync Node 24 gate: architecture, lint and typecheck pass; **225 tests pass, 0 fail, 0 skip**. No Git commit/push, deployment, hosting or external form submission was performed.

## Phase N — Form Graph: COMPLETE

Authoritative directive: `/Users/mac/.codex/attachments/7c26ff3f-8342-4833-87a2-3adc89fcd302/pasted-text.txt`.

### Initial N architecture audit — complete

- Phase I is the one DOM discovery authority. Its observer already coalesces relevant mutations and filters extension-owned UI, but the scanner currently returns only visible controls and form IDs; it has no typed sections, actions, steps, validation gates or dependency evidence.
- The existing content controller still implements `scan -> plan every resolved field -> execute`, then permits only one recursive continuation after a coarse structural count changes. Its scan signature ignores requiredness, enabled state and option-universe changes. This is the authoritative static-form assumption Phase N must replace.
- Phase K plans fields in scanner order and its orchestrator continues queued operations after an earlier operation changes structure. A page-instance guard exists, but there is no graph revision/fingerprint guard. K must stop at the first structural transition and replan from a fresh graph.
- K's verifier correctly owns control readback and page staleness. J remains the only semantic authority, M remains the only repeat-entity authority, Candidate Truth remains the only answer authority, and L learns only from verified results. N will consume their outputs without duplicating them.
- Phase M provides stable `formRepeatGroupId` and value-private entity binding. N may model repeat creation/removal but must never select a candidate entity.
- Runtime recovery deliberately persists only value-free summary state. A restarted content runtime must rescan and reconstruct the live graph; uncertain pending DOM actions will not be replayed.
- No V2 Form A/Form B runtime branch or separate dynamic-form authority was found. The V1 tree remains frozen and unused.

### Frozen Phase N implementation decisions

- Add `@job-hunter-v2/form-graph`, a deterministic pure graph/reconciliation/planning package. It consumes structured scanner observations and never reads the DOM.
- Add versioned shared contracts for `FIELD`, `FIELD_GROUP`, `REPEAT_GROUP`, `SECTION`, `ACTION`, `STEP` and `VALIDATION_GATE`; typed edges; explicit node states; material deltas; evidence categories; structured predicates; transition receipts; and graph-specific failures.
- Runtime graph identity is page/application scoped and derived from bounded structural evidence, not raw selectors or DOM object identity. Material fingerprints exclude candidate values and cosmetic text. Revision increments only for material node/edge/state changes.
- The extension scanner will emit graph observations in the same authoritative pass used for fields. It may observe hidden conditional structure, but technical hidden/password controls remain excluded from executable field nodes.
- K requests/responses/operations will carry a graph revision and fingerprint. The backend recomputes the safe field frontier. Content rejects stale plans before and during execution, and the orchestrator stops after the first structural change.
- Dynamic execution becomes a bounded convergence loop with repeated-state and iteration protection. Every meaningful transition is rescanned/reconciled before J/M/Candidate Truth/K continue.
- Runtime graph state is transient. Background storage records only value-free graph summary/revision for diagnostics and restart detection; reconnect always re-observes the page.

### N1/N2 — domain contracts, discovery, revisions and deltas: COMPLETE

- `packages/contracts/src/form-graph.ts` freezes graph node/action/state/edge/evidence/failure/predicate contracts, value-private observations/snapshots/deltas, graph guards, transition receipts and safe-frontier inputs/results.
- `@job-hunter-v2/form-graph` is a pure deterministic package. It owns stable graph IDs, material fingerprints, topology validation, typed delta generation, revision reconciliation, dependency-cycle detection and the structural safe-frontier algorithm. It has no DOM, database, Candidate Truth or AI dependency.
- The one Phase-I scanner now emits graph evidence in its existing pass. It models the current step, form sections, fields, actions, repeat groups and active validation gates; correlates `aria-controls`/`aria-owns`/explicit dependency attributes; distinguishes hidden, disabled and reachable nodes; fingerprints option universes and requiredness; and excludes hidden/password technical controls from executable field discovery.
- Graph IDs use page-scoped bounded structural evidence. Raw selectors, DOM nodes, labels, option values and candidate answers are not stored in graph contracts or background summaries.
- Reconciliation preserves graph revision across cosmetic/repeated observations. Node add/remove, option, requiredness, visibility, enabledness, step and edge changes increment revision and produce explicit value-private deltas.
- Background recovery persists only graph revision/fingerprint/count/stability metadata. Content reconnection still rescans and reconstructs the live graph rather than replaying pending DOM work.
- Focused form-graph tests pass (4/4): cosmetic revision stability, typed structural deltas, dependency-aware frontier and cycle fail-closed. Architecture, contracts/form-graph/extension typecheck and extension production build pass.
- Existing Phase-I unpacked-Chromium suite passes unchanged after scanner integration: static, SPA, multi-step, dynamic insertion, iframe/reload, auth, malformed message, worker recovery and cold extension reload.

### N3–N5 — dependencies, reachability, actions and reconciliation: COMPLETE

- Deterministic declared relationships (`aria-controls`, `aria-owns`, explicit controller attributes), repeat creation, option dependencies and verified before/after transitions now produce typed runtime edges. Observed causality is correlated to a known Copilot/candidate action within a bounded window and stores no answer values; AI-only evidence cannot authorize execution.
- The backend recomputes a graph-aware safe frontier from N structure + J semantics + M bindings/capacity + Candidate Truth policy. Reveal dependencies propagate through containing sections, completed controls do not become false `Needs your answer` blockers, and unresolved required fields fail closed.
- K contracts now carry graph guards on plans, field operations and structural actions. Content rejects stale revisions before execution; the field orchestrator stops after the first structural change; every transition triggers `I -> N reconcile -> J/M/Truth -> K` replanning.
- Only `ADD_REPEAT` and `EXPAND` may be graph-authorized as narrowly scoped automatic actions. Add Another requires explicit M remaining capacity. Next/Continue/Save remain user-gesture actions and Submit is excluded from graph automation.
- Dynamic execution uses a maximum of 12 verified iterations, graph fingerprints, repeated-state detection and no-op/expected-transition checks. Unchanged or unstable forms stop with typed failures rather than looping.
- Focused graph/planner tests now cover inherited reveal prerequisites, M-gated Add Another, observed runtime causality, malformed references, AI-only execution rejection and repeated-state protection.

### N6 — multi-step runtime and recovery foundation: COMPLETE

- Step identity combines normalized route, review/input state, heading, progress/active-panel structural evidence. Application identity normalizes route and form-action step/review suffixes, so one `applicationRunId` survives SPA step changes while page/step/graph identity changes.
- Background recovery keeps a bounded, value-free step visit history plus the last verified transition receipt. Back/forward/revisit increments visit evidence without persisting live DOM or candidate values. Reconnect still rescans and never replays uncertain structural actions.
- Review pages are distinguished from editable steps; visible validation evidence creates explicit gates; a failed navigation cannot be reported as a step transition without a resulting graph change.

### N7 — evidence, failures, privacy and recovery: COMPLETE

- Evidence categories and scope are explicit. Declared/observed runtime evidence may authorize only conservative current-runtime dependencies; `AI_SUGGESTED` alone is contractually non-executable and one candidate's observation is never promoted to reusable site/global truth.
- Graph failures remain separate from I/J/M/Candidate Truth/K/L attribution. Stale nodes/revisions, dependency uncertainty, missing/unexpected transitions, validation blocks, dynamic options, cycles, repeated states, malformed evidence and non-convergence fail closed.
- Background persistence contains only value-free graph summaries, bounded step visits and the last transition. Service-worker recovery rescans and reconstructs; no uncertain DOM action or candidate value is persisted/replayed.
- Anti-loop behavior is locked by graph guards, stop-after-structure, operation correlation, material fingerprints, no-op/repeated-state checks and a 12-iteration cap.

### N8 — integration, browser proof and closure: COMPLETE

- Controlled Chromium demonstrated all mandatory behaviors: sponsorship reveal and hide; nested A -> B -> C; dependent option loading; automatic Add Another through N -> M -> J -> Candidate Truth -> K; remove/reorder/recreate with stable M binding; dynamic requiredness; validation failure without false step success; multi-step SPA continuity; trusted manual branch; equivalent rerender; worker termination/recovery; and cycle fail-closed.
- The Phase-N browser run produced 39 transient guarded plans. Page and service-worker console error collectors were empty; extension storage, receipts and telemetry were checked value-private; no infinite scan/execution loop occurred.
- Browser validation exposed and fixed two real Phase-N defects: hidden descendants were initially treated as visible, and an already-materialized observed reveal was incorrectly retained as an unmet prerequisite. Both are now behavior-locked.
- Phase I static/SPA/multi-step/frame/auth/recovery, Phase J Greenhouse/Lever/Workday/dynamic/SPA, Phase K static execution, Phase L verified learning and Phase M repeatable entity behavior all pass after N. Action buttons were removed from J field counts and the earlier Phase-I/J fixtures were updated to assert the correct N-action/J-field separation.
- Final Node 24.8.0 gate: architecture, lint, typecheck, web/extension production builds pass; **225 tests pass, 0 fail, 0 skip**. The default localhost extension configuration was rebuilt after isolated browser configurations.
- No database migration was required. No Git commit, push, remote, deployment, hosting or release operation was performed.

### Phase N architecture closure

- Domain, node/edge types, identity/revisions, observations/deltas, dependency rules, reachability/frontier, action policy, reconciliation, multi-step/validation, confidence/evidence, failure taxonomy, recovery, J/M/K/L integration, performance, privacy, legacy status and genuine limitations are documented in `docs/FORM_GRAPH.md`.
- No V2 Form A/Form B runtime branch, hardcoded question order or duplicate graph executor remains. The frozen V1 tree is still unused but intentionally retained until Phase Z zero-read/write, rollback and soak proof; database tables remain last to delete.
- Deferred by design: provider AI routing (P), adaptive strategy/template promotion (Q), document intelligence (R), ATS certification (U) and final automatic submission.

### Exact next boundary

**Phase O — Declaration & Consent Policy.** Do not reopen N or earlier phases without a failing behavior lock.

## Phase M — Repeatable Entity Intelligence: COMPLETE

Authoritative directive: `/Users/mac/.codex/attachments/948effe7-bbca-4bdd-a906-9def2d77091f/pasted-text.txt`.

### Initial architecture audit — complete

- Candidate Truth is already the one reusable-answer authority. `candidate_entities` owns stable candidate UUIDs, `candidate_entity_versions` preserves append-only entity provenance, `candidate_entity_source_keys` makes onboarding/profile creation idempotent, and answer/current/history rows already carry `entity_id` independently from scope.
- Phase G profile saves preserve an existing entity UUID and create new UUIDs from stable client/source keys. Reordering does not rewrite answer identity. Entity removal/restoration needs an explicit lifecycle authority in M; ordinary answer Undo is already E4/L behavior and must not be repurposed as entity deletion.
- Phase I currently detects a repeat container and reports `DOM_STABLE_KEY` or `ORDINAL_HINT`. A synthetic page-owned `data-candidate-entity-id` can produce `CANDIDATE_ENTITY`, but a real ATS cannot know a Candidate Truth UUID. DOM keys are application/runtime identifiers only; ordinals are hints and must never become authoritative identity.
- Phase J correctly determines canonical meaning separately from entity identity. It currently calls Candidate Truth with an entity UUID only when one was already present in scanner evidence, so real repeated employment/education forms safely return `ENTITY_CONTEXT_REQUIRED` instead of cross-filling.
- Phase K consumes J/Candidate Truth output and does not choose entities. Phase L records and commits the exact J binding but blocks DOM-only/ordinal repeatables. These boundaries are correct and will be extended in place.
- No second candidate entity store, flat repeated-value store, Form A/Form B runtime branch, or V1 runtime dependency was found. Candidate profile order and DOM order still appear as weak presentation evidence only.
- Required M insertion point is `I group detection -> J canonical resolution -> M entity binding -> Candidate Truth entity-scoped resolution -> K -> L`. M must return only value-private binding metadata; private candidate values stay inside the repository/service boundary.

### M implementation decisions

- Add versioned repeat-group and entity-binding contracts to the shared contracts package; candidate entity IDs and form repeat-group IDs remain different types/fields.
- Add one deterministic M service and one database repository over the existing Candidate Truth tables. The repository will build private candidate descriptors from active entity-scoped current answers without exposing their values in API responses or generic telemetry.
- Strengthen the extension scanner to create application-scoped repeat-group identity from stable structural evidence. Stable DOM keys may preserve a group across rerenders; an ordinal is never sufficient for a high-confidence binding.
- Binding states will be `BOUND_HIGH`, `BOUND_MEDIUM`, `AMBIGUOUS`, `UNBOUND`, and `UNSUPPORTED`. Wrong/removed/stale/version-conflicting identities fail closed with M-specific error codes instead of being attributed to J, K, or Candidate Truth.
- Deterministic evidence is authoritative first. A provider-neutral, schema-constrained AI port may choose only supplied candidate entity IDs and remains unbound in production. No Phase-P router/provider is introduced.
- Persist only scoped, value-free binding receipts needed for idempotency, rerender stability, stale detection, and verified learning correlation. Candidate values, company/institution names, titles, and dates are forbidden in binding receipts, telemetry, and this checkpoint.

### M1–M2 — contracts and stable candidate entity identity: COMPLETE

- `packages/contracts/src/repeatable-entities.ts` freezes candidate entity families, form repeat-group identity, binding states/evidence/failures, value-free receipts and the compact schema-constrained AI boundary.
- Candidate entity IDs and `formRepeatGroupId` are distinct contracts. A bound receipt also carries the exact entity version and value-free revision token used for OCC/staleness checks.
- Migration `0016_repeatable_entity_intelligence.sql` extends the existing `candidate_entities` aggregate with lifecycle version/order/status timestamps; no second candidate entity store was created.
- `@job-hunter-v2/repeatable-entities` owns deterministic binding and lifecycle orchestration. `KyselyRepeatableEntityRepository` reads active entity projections from Candidate Truth and exposes values only as private server-side fingerprints; public receipts contain no candidate values.
- Remove/restore and reorder operations are transactional, candidate-owned, idempotent and OCC guarded. Reordering increments aggregate versions but never replaces UUID identity. Removal invalidates form bindings without deleting historical Candidate Truth.
- Behavior locks pass for unique-entity binding, ordinal-only refusal with multiple candidates, profile-array-order independence, constrained AI IDs and prior stable binding reuse. The ordered migration chain reaches `0016` idempotently and confirms binding tables contain no private value columns.

### M3–M5 — group detection, deterministic binding and ambiguity: COMPLETE

- Phase I emits a separate `formRepeatGroupId`, structural fingerprint, stable identity category and semantic role. It no longer trusts a page-owned `data-candidate-entity-id` as Candidate Truth authority.
- Stable repeat keys include bounded DOM/application keys; current/previous employment is recognized without requiring a helper CSS class. Ordinal-only repeated groups cannot bind multiple entities.
- `RepeatableEntityIntelligenceService` batch-loads candidate entity projections once per J request, scores prior verified binding/unique type/semantic role/stable group evidence and requires high threshold plus candidate margin.
- Display order and semantic recency are separate. A profile reorder therefore cannot change current/previous binding identity.
- Ambiguity, no candidate, stale group/entity and unsupported type fail closed with M-specific codes. Optional AI is provider-neutral, receives no values, may choose only supplied UUIDs and is not configured in production.
- Persisted value-free bindings are superseded on material change instead of replaying an obsolete row. Saving a bound receipt re-checks its entity revision.

### M6 — J / Candidate Truth / K / L integration: COMPLETE

- J resolves canonical meaning first, then attaches M's independent binding receipt. Only `BOUND_HIGH` becomes a Candidate Truth `CANDIDATE_ENTITY` context.
- Candidate Truth continues to resolve by `canonical + scope + entity UUID`; K receives an already-bound transient answer and never selects an entity.
- L carries the same entity UUID/version/revision. Its database transaction recomputes the current revision before accepting an observation, so an older open application cannot teach over a profile edit/removal.
- Phase L Chromium now learns an unknown entity field, reuses it on different wording, corrects one of two employment entities and Undo restores that entity without modifying the other.

### M7 — lifecycle, operations and concurrency: COMPLETE

- Candidate-owned list/remove/restore/reorder APIs use session authority. Mutations are transactional, idempotent, OCC guarded and recorded through immutable receipts.
- Removal preserves historical Candidate Truth, makes the entity ineligible and invalidates active form bindings. Restore keeps the UUID. Reorder changes display order but not UUID or semantic recency.
- Migration `0016` safely backfills lifecycle time for pre-existing removed entities and binding rows reference real application runs.
- Dynamic form deletion and Add Another remain runtime group operations; they do not delete/recreate the profile entity. Phase N owns the dependency graph.

### M8 — closure validation: COMPLETE

- Architecture, typecheck, lint, migration, repository, API, service and J/K/L integration tests pass. Final Node 24.8.0 gate: **213 tests pass, 0 fail, 0 skip**; web and extension production builds pass.
- Phase J Chromium passes Greenhouse/Lever/Workday/dynamic/SPA field intelligence.
- Phase K Chromium passes reversed current/previous employment, same employer twice with distinct titles, education, delete, dynamic Add Another, rerender and no cross-fill.
- Phase L Chromium passes entity-specific manual correction, verified learning and partial-safe Undo; extension storage and telemetry remain value-private.
- Phase I/J/K/L unpacked-Chromium suites pass after M integration; page/service-worker checks are clean. The default localhost extension configuration was rebuilt after isolated fixture configurations.
- The real local PostgreSQL chain is current through `0016_repeatable_entity_intelligence` with no checksum drift.
- No Git commit, push, remote, deployment, hosting or release action was performed.
- Exact next boundary: **Phase N — Form Graph**. Model conditional visibility, branching and nested/dynamic section dependencies without moving entity identity back into K or duplicating M.
- Detailed handoff: `docs/REPEATABLE_ENTITY_INTELLIGENCE.md`.

## Phase L — Verified Learning Loop: COMPLETE

Authoritative directive: `/Users/mac/.codex/attachments/de14ed90-d034-4a36-be75-78a443d9e6ec/pasted-text.txt`.
Detailed handoff: `docs/VERIFIED_LEARNING_LOOP.md`.

### L1/L2 — contracts, evidence and observation

- `packages/contracts/src/learning.ts` freezes database-run launch, value-free K execution evidence, candidate-private observations, submit attempts, verified submission results and Undo contracts. K operations/receipts carry the exact answer-scope fingerprint.
- Migration `0015_verified_learning_loop.sql` adds tenant-RLS run, execution, observation, submit and checkpoint receipts. Candidate values use the existing AES-GCM encrypted seven-day runtime-proposal boundary; generic evidence remains value-free.
- Only high-confidence policy-authorized canonicals with exact scope and stable entity identity can stage. Protected/consent/file/ambiguous/unsupported fields fail before private staging.
- Candidate corrections after K `VERIFIED` readback are answer evidence. Representation, execution and ambiguous failures remain typed non-answer evidence and cannot mutate Candidate Truth or semantic confidence.

### L3/L4 — verified checkpoint and Candidate Truth mutation

- A verified submission requires the exact recent trusted submit attempt plus both a bounded success URL token and visible success marker. Navigation or execution success alone is insufficient.
- The checkpoint consumes only earlier, unexpired observations from the same authenticated application/run; encrypted values are decrypted and HMAC-verified only inside the private learning service.
- One application commits one grouped Candidate Truth change set with expected-current OCC. `AUTO_VERSION` manual facts become `TRUSTED`; `REVIEW_TO_SAVE` becomes `REVIEW`; exact unchanged REVIEW trial becomes `TRUSTED`; corrections append policy-scoped versions.
- Same stable current TRUSTED values create no duplicate version. Concurrent/replayed checkpoints resolve to one final receipt. A stale application becomes a safe conflict and cannot overwrite a newer profile/application answer.

### L5/L6 — reuse, feedback and Undo

- All future answers go through `CandidateTruthResolver`; no last-form-value shortcut exists. Existing trust, freshness, sensitivity, legal scope, contextual scope and entity rules remain authoritative.
- The side panel shows only committed candidate language: `Updated for next time`, `We'll check this next time`, partial success, failure or no reusable change. Visible local status refreshes automatically without polling the backend.
- Grouped Undo calls the E4 reversal authority. Full, partial, no-op and replay outcomes preserve append-only history and never overwrite a newer answer. Restore remains the existing E4 history operation.

### L7/L8 — safeguards and certification

- All routes derive candidate ownership from the bearer session. Observation, submit, checkpoint and Undo are idempotent under content, service-worker, network and backend replay.
- Phase L rejects unresolved/ambiguous semantic evidence, unverified submissions, stale/foreign runtimes, unstable repeatables, failed verifier attribution, framework-only changes, protected/consent fields and expired proposals.
- Chromium certification covers grouped unknown learning, future reuse on different wording, candidate correction, abandoned and unverifiable submissions, failed-K attribution, stable repeatable entity identity, partial-safe Undo, automatic side-panel feedback and value-private extension storage.
- Final Node 24.8.0 gate: architecture, lint, typecheck and production builds pass; **203 tests pass, 0 fail, 0 skip**; Phase I/J/K/L unpacked-Chromium suites pass; default localhost extension configuration is restored.
- The external V1 tree is still frozen and unused by V2. Removal remains Phase Z after zero-read/write, rollback and soak proof; database tables are last.

### Genuine Phase-L limitations

- Learning consumes committed candidate `change` outcomes. A nonstandard form that removes a control before a committed change is safely skipped rather than inferred.
- Ordinal-only repeatable identity remains blocked; Phase M now supplies high-confidence cross-form entity binding where sufficient stable evidence exists.
- Strategy/mapping/representation promotion remains Phase Q; dynamic form orchestration remains Phase N; declarations require a dedicated authorization UX.

### Historical handoff

This Phase-L handoff to Phase M is complete. The active next boundary is Phase N at the top and bottom of this checkpoint.

## Phase K — Executor & Verifier: COMPLETE

Authoritative directive: `/Users/mac/.codex/attachments/afad0cc3-a939-40cc-8219-072a82b0290c/pasted-text.txt`.

### Initial K architecture audit — complete

- Phase I has intentionally inert `PhaseOneExecutor`/`PhaseOneVerifier` ports, a live `FieldRegistry`, trusted-event ownership tracking, tab/frame/page/form/application-run identity, strict message routing and value-free telemetry. These seams will be replaced in place; no second V2 execution path will remain.
- Phase J returns canonical meaning and value-free Candidate Truth answer references. Its public API correctly does not return answer values. K therefore requires a separate authenticated, transient private planning boundary; it must re-run the authoritative J resolution server-side and may not accept a caller-supplied canonical, selector or answer.
- Candidate Truth already provides scoped, fresh normalized values internally through `CandidateTruthResolver`. K will adapt those transiently and immediately discard them after an operation; no answer value will enter session/local storage, telemetry, receipts or this checkpoint.
- The frozen V1 tree contains useful behavior references for native property setters, exact option matching, ownership yield and independent readback. Its monolithic content/background runtime, broad ATS branching, legacy answer transport, retry loops and upload machinery will not be imported or wrapped.
- K's authoritative runtime will be: side-panel user gesture -> background runtime authorization -> content rescan -> authenticated server execution plan -> live capability detection -> deterministic strategy registry -> ownership-guarded execution -> independent bounded verifier -> value-free receipt/telemetry.
- Representation is a versioned backend policy over Candidate Truth normalized values plus field evidence. DOM strategy code receives a representation and must never rewrite Candidate Truth or hide a conversion.
- Declaration/application-gesture and protected fields fail closed in the generic “fill safe fields” action. File references remain a typed unsupported/document-flow result until the dedicated authorized document boundary; local paths will never be transported.
- Duplicate operations will be blocked per field; runtime/page/application IDs are checked both in background and content; user ownership always wins; structural mutation triggers rescan/J before any newly created field can execute.
- Initial known unsupported scope: closed shadow roots, inaccessible cross-origin frames, file upload, ambiguous fuzzy option selection, unrecognized custom widgets, and complete conditional/repeatable form graphs. These remain explicit failures rather than unsafe fallback.

### K1–K4 — contracts, planning, strategies and representation

- `packages/contracts/src/execution.ts` freezes capability, representation, private plan, attempt/field/batch receipt, verification and failure contracts. The browser plan request contains only current scanner evidence and runtime identity; strict parsing rejects caller canonicals, selectors and values.
- `@job-hunter-v2/execution` is the authenticated transient planning boundary. It reuses the one authoritative private J/Candidate Truth path, plans only high-confidence currently valid answers, and never persists the private response.
- Representation policy is explicit/versioned and covers text, option, boolean, date, duration, money/LPA, phone, address, enum/multi-enum, entity and decline representations. It does not mutate Candidate Truth.
- The single V2 strategy registry covers native framework-compatible text/textarea/number/date/month, exact select/multiselect, checkbox/radio, contenteditable, ARIA combobox/searchable listbox, ARIA radio and toggle, plus one deterministic lower-priority text fallback. Ambiguous option matches stop safely.

### K5–K7 — verifier, retries, ownership and dynamic sequencing

- Independent bounded readback verifies actual live control state and survives a framework rerender only by rebinding the same runtime identity/fingerprint. Executor claims are never accepted as proof.
- Retries are capped at two, reason-aware and value-private. Failed-attempt local state is restored before fallback. Failure attribution remains separated across representation, strategy, DOM acceptance, verification, user and runtime/page layers.
- Side-panel **Fill safe fields** is the explicit entry gesture. Background/content validate auth, site permission, application run, page instance, frame and field fingerprint; duplicate same-field work is locked.
- Trusted pointer/key/input/change/click/paste transfers ownership to the candidate. A Chromium-discovered defect where trusted takeover was suppressed during an async programmatic marker was fixed and behavior-locked by the user-interruption fixture.
- Structural changes run one bounded `I rescan → J resolve → K continue` pass. SPA navigation aborts the prior operation before the new page can be mutated.
- Generic safe fill skips file inputs, declarations requiring an application gesture and protected fields. No local path or declaration authorization is inferred.

### K8 — browser hardening and closure

- Phase-K Chromium certification covers native controls, React-like controlled rerender, exact multi-select, autocomplete/custom listbox, dynamic dependent insertion and continuation, duplicate-option ambiguity, policy/file skips, user takeover and SPA stale-operation rejection.
- Extension session/local storage and telemetry were inspected and contain no candidate answer values. The page and service-worker consoles are clean; execution plans remain transient.
- Phase-I extension browser recovery/cross-frame/SPA suite and Phase-J Greenhouse/Lever/Workday/dynamic/SPA semantic suite pass unchanged after K integration.
- Final gate on Node 24.8.0: architecture, lint, typecheck and full production build pass; **192 tests pass, 0 fail, 0 skip**; Phase I, Phase J and Phase K unpacked-Chromium suites all pass; the default localhost extension build was restored afterward.
- The Phase-I no-op executor/verifier was removed. The external V1 extension is still frozen and not a runtime dependency; Phase Z owns deletion after parity and zero-read/write proof.
- Detailed handoff: `docs/EXECUTOR_VERIFIER.md`.

### Exact next boundary

Begin **Phase L — Verified Learning Loop**. Capture neutral verified/manual/correction observations, classify them by semantic/answer/representation/interaction layer, and commit reusable Candidate Truth only at approved checkpoints with Undo. Do not reinterpret a K execution failure or overwrite as semantic evidence.

## Phase J — Field Intelligence: COMPLETE

Authoritative directive: `/Users/mac/.codex/attachments/f3c74715-0672-4866-bffd-abb6c8f5af60/pasted-text.txt`.

### J architecture audit and ownership decisions

- Phase-I `FieldCandidate` output, runtime identity, ownership, typed messaging, Candidate Truth registry/policies/resolver, V1 semantic references and browser fixtures were audited once. Do not repeat that audit unless a behavior lock fails.
- There is one V2 semantic authority: `@job-hunter-v2/field-intelligence`. V1 semantic/runtime files are not imported, queried or run in shadow. No second semantic database/table was created.
- The frozen responsibility chain is scanner discovery -> J semantic understanding -> Candidate Truth answer resolution -> K representation/execution/readback -> later verified learning. Phase J contains no DOM mutation or representation conversion.

### J1/J2 — evidence and deterministic understanding

- `packages/contracts/src/field-intelligence.ts` defines strict versioned `FieldEvidenceInput`, page context, repeatable evidence, request/response, semantic resolution, Candidate Truth answer-reference and AI payload/output contracts.
- Evidence is bounded and value-free: runtime/form/control identity, control type, label/section/neighbors, semantic/form context, safe attributes, options, accessible description, ATS/page context and repeatable evidence. No field value or candidate answer enters the semantic request.
- Normalization removes common email, URL, phone and long-identifier patterns before fingerprints or AI payloads. Stable SHA-256 descriptor fingerprints key a bounded in-process semantic cache.
- The deterministic engine uses reviewed aliases, negative patterns, semantic attributes, field-type compatibility, section/neighbor evidence and stable repeatable context. It returns inspectable component evidence without exposing internal reasoning to candidate UI.
- The accuracy corpus covers 35 common canonicals plus noisy/negative controls. Explicit-country work authorization resolves to `WORK_AUTHORIZATION` with an `IN` context hint; generic authorization remains ambiguous. This preserves the authoritative country-scoped Candidate Truth canonical instead of creating a duplicate `WORK_AUTHORIZATION_INDIA` truth key.

### J3/J4 — candidates and optional AI

- Candidate generation is policy/type checked, registry bounded and limited to eight plausible canonicals with concise definitions. An AI result cannot invent or select a canonical outside that set.
- `FieldCanonicalizationAiPort` is provider-neutral. No Gemini/Groq/OpenAI dependency or full Phase-P router was introduced.
- Deterministic high confidence bypasses AI. Lower-confidence candidates use the compact payload: label/type, section, previous/next labels and candidate descriptions. Only an inconclusive result receives bounded rich attributes/options/page/ATS context.
- AI output is strict-schema validated. Malformed, out-of-set and unavailable responses fail safely to explicit ambiguity/error states. At most eight AI calls are allowed per batch. No production provider is currently bound, so ambiguous runtime fields stay explicit rather than making a hidden model call.

### J5/J6 — confidence and Candidate Truth boundary

- Confidence policy `J1-2026-09` is centralized: high `>= 0.88` with margin `>= 0.10`; medium `>= 0.72` with margin `>= 0.07`; candidate floor `0.24`.
- States are `RESOLVED_HIGH`, `RESOLVED_MEDIUM`, `AMBIGUOUS`, `UNRESOLVED` and `UNSUPPORTED`. Error codes distinguish no candidate, ambiguity, insufficient context, incompatibility, AI invalid/unavailable, policy rejection, stale runtime and unsupported controls.
- `FieldIntelligenceService` calls the existing Candidate Truth resolver only after semantic resolution. The response exposes version/status/trust/review/expiry references, never normalized values. Resolution is deduplicated per canonical/entity/context within a batch.
- Candidate ownership is derived exclusively from the authenticated API session. The protected endpoint is `POST /v1/field-intelligence/resolve`; malformed scanner evidence is rejected before processing.

### J7 — contextual and repeatable foundation

- Repeatable employment/education fields retain semantic canonical plus entity evidence. Stable candidate entity UUID is strongest, stable DOM key next and ordinal position is only a hint.
- Ordinary sections such as “Current employment” are no longer misclassified as repeatable entities. Entity Candidate Truth resolution fails closed without stable identity.
- Candidate Truth, representation and DOM strategy remain separate. Declarations/consents are recognized but Candidate Truth policy blocks ordinary reusable resolution and Phase J never executes them.

### J8 — integration, browser hardening and closure

- The extension batches scans into the protected semantic endpoint after READY authentication, stores only value-free responses in `chrome.storage.session`, invalidates stale results on rescan/navigation/removal/recovery and shows summary readiness in the side panel.
- A native MV3-worker fetch receiver defect was found and fixed: field-intelligence fetch is invoked as an unbound function, matching the behavior-locked session path.
- Runtime/result correlation was strengthened in the Chromium certification so a SPA or dynamic rescan cannot satisfy an assertion with a prior page's cached semantic response.
- Chromium semantic certification passes eight value-free batches across Greenhouse, Lever, Workday, ambiguous, delayed-dynamic and SPA fixtures. It covers repeatable employment/education, radio, checkbox, declaration, date, numeric, phone and textarea semantics; page and worker consoles are clean; network/storage contain no Candidate Truth value; fields remain unmodified.
- The pre-existing extension browser suite remains responsible for plain forms, multi-step continuity, frame behavior, auth, malformed messages and worker recovery. Phase-J certification supplements it with semantic assertions.
- Node 24.8 on arm64 reproduced its known native V8/Wasm cleanup crash when PGlite files ended concurrently. The test launcher now runs test files serially while repository-level concurrency tests remain intact; the full suite is stable at **185 pass, 0 fail, 0 skip**.
- Architecture, lint and typecheck pass. Production web and MV3 builds pass. Extension foundation and Phase-J browser suites pass. No commit, push, remote, deployment, hosting or release was performed.
- Detailed handoff: `docs/FIELD_INTELLIGENCE.md`.

### Phase-J files and schemas

- Contracts: `packages/contracts/src/field-intelligence.ts`, exported from the contracts index.
- Package: `packages/field-intelligence/src/{evidence,ontology,semantic-resolver,service}.ts` plus accuracy/integration tests.
- API: `apps/api/src/field-intelligence-routes.ts` and composition in `app.ts`/`server.ts`.
- Extension: enriched scanner/contracts; background API/message/runtime persistence; side-panel semantic summary; focused unit and browser tests.
- Workspace: package/project references, dependency graph, lockfile, `scripts/phase-j-browser-smoke.ts` and root browser-test command.
- Database: no Phase-J migration or semantic-answer table. Candidate Truth remains the only candidate-answer store; semantic cache is bounded and process-local.

### Genuine limitations and deferred owners

- Unknown custom vocabulary without a strong bounded candidate stays unresolved; a production AI adapter and budgets belong to Phase P.
- Closed shadow DOM and inaccessible cross-origin frames remain structurally reported but cannot be semantically scanned.
- Advanced cross-site repeatable entity binding belongs to Phase M; conditional/repeatable form orchestration belongs to Phase N.
- Representation, strategy selection, DOM execution, cleanup and readback verification are the next boundary in Phase K. Verified correction/manual-answer learning remains later work and must preserve separate semantic/answer/representation/interaction evidence.
- External V1 code, dependencies and tables remain frozen until Phase Z zero-read/write, rollback and soak proof. Do not delete execution behavior needed as K certification reference; database tables are removed last.

## Phase I — Extension V2 Foundation: COMPLETE

Authoritative directive: `/Users/mac/.codex/attachments/e396cd98-fd81-4840-8b5d-91289a5f325a/pasted-text.txt`.

### Initial Phase I architecture audit — complete

- At Phase I entry, `apps/extension` contained only a README placeholder; V2 had no extension manifest, runtime, build, tests or backend/website handshake to preserve.
- The V1 reference extension remains outside V2 at `/Users/mac/projects/job-hunter-agent/extension`. Its behavior is covered by legacy fixtures, but its production files are heavily coupled: approximately 3,057 lines in `content.js`, 1,826 lines in `background.js`, global-script modules, legacy API/session state and broader permissions than Phase I needs.
- V1 Phase-0G seams for scanner, ownership, executor, verifier, telemetry, orchestration, background API/session/message routing and a value-free outbox are useful behavior references only. They are not imported or executed by V2.
- At Phase I entry, the V2 web application opened `applicationUrl` directly and had no extension detection, authentication bridge or install/connection state. Phase I replaced that path without changing Job Intelligence authority.
- Phase G already owns browser authentication and session-derived candidate ownership. The extension will carry only a short-lived bearer session in `chrome.storage.session`, validate it through `/v1/auth/session`, and never create candidate/profile identity from ATS page data.
- Candidate Truth and Job Discovery remain authoritative backend boundaries. The extension will not store semantic candidate truth or call persistence directly.

### Frozen Phase I implementation decisions

- Create one self-contained `@job-hunter-v2/extension` Manifest V3 workspace with an esbuild pipeline and generated public `config.json`; no secret is bundled.
- Minimal required permissions: `storage`, `scripting`, `activeTab`, `sidePanel`; exact V2 web/API origins are required host permissions, while employer HTTP(S) access remains optional and per-origin.
- Content architecture is scanner → ownership → Phase-I executor/verifier ports → observer/controller → typed messaging. Scanner never writes fields; executor never classifies canonicals; verifier is independent.
- All extension messages use a strict Zod discriminated union with protocol version, message/correlation IDs, sender and value-class metadata. Unknown/malformed messages fail closed.
- Runtime identity separates tab session, frame, page instance, form instance and application run. State transitions use one explicit state machine rather than boolean flags.
- Service-worker recovery uses only minimal value-free metadata in `chrome.storage.session`; access tokens also use session storage, never durable local storage. Content reconnects and re-registers after worker restart.
- The website handshake uses a narrow `window.postMessage` bridge available only on configured Job Hunter web origins. It advertises version/readiness and can offer the existing web auth session to the worker. It never exposes Candidate Truth values.
- SPA observation coalesces meaningful structural changes and distinguishes trusted user events from future Copilot-owned mutations. It does not implement Phase J semantics, Phase K representation or full execution, Phase L learning, or automatic submission.
- Extension telemetry is structural/value-private, bounded and batched. Candidate answer values, page field values and raw DOM snapshots are forbidden.

### Legacy cleanup decision

- No V1 runtime is copied into V2 and there will be no shadow execution.
- Do not delete the external V1 extension yet: field semantics/execution behavior still belongs to later J/K/L, so deletion is owned by the Z-extension cutover after parity and zero-read/write proof.
- Remove only V2-local dead/duplicate scaffolding encountered during Phase I. V1 code remains a frozen reference, not a runtime dependency.

### Phase I completion state

- Completed I1/I2: one authoritative `@job-hunter-v2/extension` MV3 workspace, generated manifest/config, esbuild pipeline, minimal required permissions, per-origin optional employer access, modular scanner/ownership/executor/verifier/observer/controller/message boundaries and a functional side panel.
- Completed I3/I4: strict versioned Zod message families, source/origin validation, idempotent message receipts, synchronous MV3 listener registration, explicit tab/frame/page/form/application-run identity, durable value-free runtime records and guarded state transitions.
- Completed I5: website detection/session/launch bridge, existing Phase G bearer-session validation through `/v1/auth/session`, session-only token storage, explicit auth states, install/reconnect/update/site-permission UX and direct non-Copilot fallback. Expired sessions erase the token.
- Completed I6: open-shadow scanning, accessible-frame registration, debounced meaningful mutations, SPA/history/online observation, late dynamic application detection, trusted user ownership, duplicate scan suppression, stale-page rejection and worker/tab recovery seams.
- Completed I7: structured failure categories, bounded value-private telemetry, forbidden private metadata keys, no raw DOM/value snapshots, no console logging of candidate values, and fail-closed malformed-message behavior.
- Completed I8: unpacked MV3 Chromium certification covers static form discovery, SPA route/rerender identity, multi-step application continuity, delayed dynamic insertion, same-origin child frames and iframe reload, graceful inaccessible cross-origin frames, website probe/session handshake, READY/expired/unavailable auth outcomes, malformed messages, side-panel loading, tab refresh, service-worker termination/restart recovery and a cold extension/browser-context reload.
- Real V2 website validation at `http://localhost:3000` confirmed returning development auth, Job Discovery, details, Apply with Copilot, the no-extension install/fallback dialog and Profile navigation. Final website console contained no warning/error.
- Browser certification found and fixed two Chrome-only defects: page-owned `pushState` is invisible to an isolated-world monkeypatch, so a coalesced URL watcher now updates SPA identity; and a native worker `fetch` cannot be invoked with the API client as its receiver, so it is now called as a standalone function. Both paths are behavior-locked.
- Privacy verification confirmed bearer tokens and candidate email never enter durable `chrome.storage.local`; telemetry records are value-private and cross-origin iframe failure is structural only.
- Phase-I final gate: architecture, lint, typecheck and both production builds pass; **137 tests pass, 0 fail, 0 skip**; extension browser smoke passes. The default local extension build was restored after isolated fixture configuration.
- Architecture handoff: `docs/EXTENSION_V2_FOUNDATION.md` records runtime boundaries, identity, permissions, messaging, privacy, recovery and legacy retirement ownership.
- Exact next action: begin Phase J with one bounded audit of existing Part 1 canonicalization contracts and the new `FieldCandidate` boundary, then implement `FieldDescriptor`, `FieldAnswerContract`, canonical/entity/candidate-answer resolution without moving representation or DOM execution forward from Phase K/L.

## Phase H — Job Intelligence and H0 audit: complete

### H0 final audit ledger

Authoritative directive: `/Users/mac/.codex/attachments/0074447b-1f61-45a9-8820-370d12c24b5d/pasted-text.txt`.

Runtime established on 2026-09-01:

- web: `http://localhost:3000` through `npm run dev:web`;
- API: `http://127.0.0.1:3100` through `npm run dev:api`;
- database: project-owned PostgreSQL 17 Docker container `job-hunter-v2-postgres`, persistent volume `job-hunter-v2-postgres-data`;
- local setup/migrations: `npm run dev:setup`;
- auth: loopback-only development bearer flow; no token or secret is recorded here;
- resume storage: `.data/private-resumes` through the existing private filesystem storage adapter.

Completed real-product walkthroughs and consistency checks:

- Candidate A completed local authentication, bootstrap, PDF upload, extraction, proposal review, correction, confirmation, profile completion, grouped edits, Undo, history Restore, reload, navigation, sign-out and returning sign-in through the real browser UI.
- Candidate B completed the manual no-resume path in an isolated local session. Returning bootstrap reused the same candidate instead of recreating onboarding.
- Repeatable employment records were rendered and edited by stable entity identity. An existing role was edited and a third role was added through the UI; both persisted after a full reload without flattening or cross-editing another role.
- Candidate Truth was checked at UI → API → application service → repository → PostgreSQL → projection boundaries. New values, corrections, grouped change sets, append-only history, partial-safe Undo after a newer edit, Restore, removal/re-entry, stable repeatable identities and contextual scope resolution are covered by real boundary tests and browser-visible behavior where exposed.
- Two controlled candidates remained isolated. Caller-supplied candidate IDs did not change session-derived ownership; cross-candidate profile, document extraction, review and Restore requests failed with not-found/denied behavior at the server boundary.
- A valid resume, manual onboarding, partial resume, conflicting re-upload, corrupt PDF, oversized input and extraction failure/retry were exercised across browser and integration boundaries. A partial re-upload with three conflicts defaulted to keeping saved truth; the staged document was discarded and PostgreSQL retained exactly one READY master resume matching the current `RESUME` Candidate Truth value.
- Refreshes at important checkpoints proved that profile, resume, history, search preferences and onboarding completion were persisted rather than held only in React state.
- Final browser consoles for both controlled candidates contained no application warnings/errors. The primary job flow also had no CORS, authentication, render, unhandled-promise or retry-loop failure.
- At a 1280×720 browser viewport the application had no horizontal overflow. Responsive breakpoints for onboarding, profile, repeatable experience, job discovery and detail remain production-built at 820px and 520px.

Defects reproduced and repaired during H0:

- fixed localhost/127.0.0.1 CORS parity and actionable database-unavailable handling;
- fixed the 0001→0014 migration collision for `jobs.role_family`;
- fixed PDF.js extraction of persisted Node `Buffer` bytes and preserved line boundaries, with a regression test;
- fixed the Essentials editor’s stale draft/busy state after authoritative reload, with pure projection behavior locks;
- fixed nullable compensation fields being coerced into invalid search-preference values by request validation;
- fixed empty/malformed Fastify request parsing so client errors remain stable 4xx responses rather than 500;
- fixed master-resume replacement so a staged upload cannot retire the current READY resume before review; Skip now deletes only the staged document, while accepting `RESUME` atomically promotes the staged document and retires the previous one;
- added the visible Replace master resume action to the profile;
- added a Candidate Truth-backed repeatable Experience editor rather than exposing flattened, non-editable history.

Regression coverage added for those repairs includes PDF Buffer extraction, editor projection resynchronization, nullable search preferences, parser errors, staged resume Skip/Accept/idempotent replay and stable repeatable employment grouping.

Architecture and Phase F sanity:

- `scripts/check-architecture.mjs` passes and still rejects V1 SQLite/table access, V1 runtime imports, Form A/Form B production branching, direct AI-provider imports and undeclared package edges.
- Candidate Truth remains the only reusable profile authority; there is no frontend persistence access, mutable answer-history update, profile blob, V1 shadow read or permanent V1/V2 dual read.
- Existing F1/F2/F4 integration locks passed for deterministic preview, safe apply, replay/idempotency, reconciliation, candidate isolation, no duplicate projection/version and no accidental TRUSTED escalation. No Phase F defect was found, so the migration subsystem was not rewritten.

Phase H browser validation:

- controlled source-neutral fixtures cover strong, weak, lower-seniority, slightly higher, excessive-seniority, unknown, excluded-company, sponsorship, remote-geography, mandatory-relocation, night-shift, heavy-travel and employment-bond cases;
- hard-hidden jobs remained absent from discovery, filtered search, pagination and related/detail authority; direct hidden detail returned not-found;
- deterministic ranking produced evidence-backed scores and templates. The detail drawer separates “Why it fits” from “Worth checking” and does not label the result as AI confidence;
- search, role/work-mode filters, pagination, preference persistence and refresh were exercised through the browser. A PostgreSQL + Backend + Hybrid query returned the strong 100/100 fixture and no excluded fixture.

Legitimately deferred capabilities remain unchanged: browser-extension autofill (I/J/K), verified application learning (L), advanced repeatable inference (M), dynamic form graph (N), provider routing (P), strategy experimentation (Q), and production storage/retention/penetration work (W). These were not smuggled into H0.

H1–H8 are implemented end-to-end. Do not reopen or redesign Phase H without a concrete failing behavior lock. The authoritative runtime is:

`source adapter → JobIngestionService → normalized catalog/provenance → hard eligibility → deterministic matching/ranking → JobDiscoveryService → protected API/web UI`

### H1–H3 — ingestion, normalization and derived intelligence

- `@job-hunter-v2/job-intelligence` owns strict Zod source contracts, normalized job contracts, source-neutral ports, deterministic normalization and ingestion orchestration.
- `RawJobPostingSchema` rejects malformed, unsafe or contradictory source data. `NormalizedJobSchema` revalidates every normalizer output before persistence, including future AI-produced structured output. `AI_DERIVED` facts require named/versioned provenance.
- `JobIngestionService` and `KyselyJobIngestionRepository` are candidate-independent, transactionally idempotent and concurrency-safe. Idempotency and source-identity advisory locks serialize response-loss retries; immutable receipts replay the original result.
- Unchanged observations update verification state without another canonical job or snapshot. Changed raw evidence appends a source snapshot; changed material advances `material_version`, replaces current facets/skills and appends versioned fact provenance.
- Large raw content stays behind `JobRawEvidenceStore`; the filesystem adapter writes content-addressed, private, atomic files. PostgreSQL keeps hashes, object keys and bounded debugging metadata, never the large source body.
- Deterministic normalization covers company/title, application/source URLs, role family, seniority, canonical skill aliases, location/countries/remote restrictions, work mode, employment type, experience, compensation, authorization/sponsorship, education, ATS and deal-breaker facts.
- Fact origins are frozen as `EXPLICIT_SOURCE_FACT`, `DETERMINISTIC_DERIVATION`, or `AI_DERIVED`. Derived data never masquerades as an explicit requirement.

### H4–H6 — eligibility, matching, ranking and explanations

- `candidate_search_profile_versions` is append-only; `candidate_search_profiles` is its OCC current projection; immutable receipts provide idempotency. These tables store only search preferences/deal-breakers. Candidate Truth remains authoritative for candidate facts.
- `candidateJobFactsFromTruth` is the explicit read adapter for skills, experience, work authorization, sponsorship requirement, location, expected compensation and relocation.
- Hard eligibility executes before ranking and returns `ELIGIBLE`, `INELIGIBLE` or `UNKNOWN`. Explicit excluded companies, remote-geography conflicts, sponsorship incompatibility, mandatory relocation, night shift, heavy travel and employment bond can hide a job. Missing evidence stays unknown and visible.
- Matching evaluates role family, required/preferred skills, experience, seniority, location, work mode, compensation and preferences independently. Title equality is not required. Lower/slightly higher seniority remains visible; excessive gaps rank down.
- Ranking policy `H1-DETERMINISTIC-2026-09` uses integer dimension weights and a bounded freshness adjustment. `INELIGIBLE` produces no score/rank and cannot be rescued downstream.
- Candidate explanations are reason/gap/unknown templates over the exact evaluation evidence. The Free path makes no candidate-specific AI call and exposes no opaque “AI confidence.”

### H7 — deduplication, freshness and lifecycle

- Source identity uses source type + source identifier + external job ID when present, otherwise normalized source/application identity.
- Cross-source merge requires a strong canonical-company + requisition key or canonical application URL. Similar titles alone never merge different requisitions; conflicting strong keys fail closed for operator review.
- Complete scan receipts are immutable/idempotent. Incomplete scans never age jobs. A source identity becomes stale only after at least three complete misses and seven days without observation.
- Canonical lifecycle is `ACTIVE`, `STALE`, `CLOSED`, `EXPIRED`, `REMOVED`. Explicit expiry/closure/removal is honored; new active evidence reactivates. Any healthy source can keep a deduped job active.
- Every lifecycle transition appends a reason-coded event. Temporary crawler absence never deletes catalog truth.

### H8 — discovery, detail, API and candidate UI

- `JobDiscoveryService` is the single candidate query authority for discovery, filtered search, pagination, detail and related jobs. It evaluates eligibility before pagination. Hard-hidden jobs return not-found from detail and never leak through related or changed-filter cursors.
- Cursors bind offset to query filters and the candidate-profile fingerprint, preventing reuse after profile/filter changes.
- Protected API routes are `GET /v1/jobs`, `GET /v1/jobs/:jobId`, `GET /v1/jobs/:jobId/related`, `GET /v1/job-search/profile` and `PUT /v1/job-search/profile`. Account/candidate ownership is derived only from the verified bearer session.
- The React candidate surface now opens completed candidates on Jobs, includes Jobs/Profile navigation, search and filters, versioned search-signal editing, match cards, evidence-based details, gaps/unknowns, freshness, compensation and employer application actions.
- Mobile/responsive styling and pure presentation behavior locks cover deterministic labels, compensation and unknown-first fallback copy.

### Phase H schema and main implementation files

- Migration: `database/migrations/0014_job_intelligence.sql`.
- Catalog/evidence tables: strengthened `companies`, `job_sources`, `jobs`, `job_source_snapshots`, `job_facets`, `skills`, `job_skills`; new `job_source_job_states`, `job_dedupe_keys`, `job_fact_provenance`, `job_lifecycle_events`, `job_ingestion_receipts`, `job_source_scan_receipts`.
- Candidate search tables: `candidate_search_profile_versions`, `candidate_search_profiles`, `candidate_search_profile_receipts`; account RLS enabled.
- Package: `packages/job-intelligence/src/{contracts,normalization,ingestion,search-profile,matching,lifecycle,discovery}.ts`.
- Persistence: `packages/database/src/{job-intelligence-repository,candidate-search-profile-repository,job-lifecycle-repository,job-catalog-repository}.ts`.
- Integration: `apps/api/src/job-routes.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/web/src/{api,App,job-ux,styles.css}`.
- Architecture graph, project references, workspace manifests/lockfile, migration ownership documentation and Phase H behavior tests were updated.

### Genuine limitations and deliberately deferred work

- Phase H provides source-neutral ingestion contracts and deterministic normalization, not production ATS credentials/crawlers for every provider. Operational source adapters/schedules belong to their later operations boundaries.
- PostgreSQL is the Phase H discovery engine. The initial catalog read is deliberately bounded and returns `catalogTruncated`; measure before adding OpenSearch/Redis or a materialized-feed layer.
- Skill/role/location normalization uses a reviewed deterministic baseline. No geocoder, currency conversion or catalog-wide semantic/AI reranker is present; ambiguous data remains unknown.
- `AI_DERIVED` output is schema/provenance-ready, but no provider call is made. Full model routing/budgets remain Phase P.
- The filesystem raw-evidence adapter is for local composition. Production object storage, retention/deletion jobs and live penetration testing remain Phase W.
- Saved/dismissed/application tracking and Copilot extension behavior are not Phase H and were not smuggled into this phase.

Historical H handoff completed: Phase I was built without replacing Job Intelligence or Candidate Truth authority.

## Last verified state

From `/Users/mac/projects/job-hunter-agent/v2`:

```text
npm run check
architecture  PASS
lint          PASS
typecheck     PASS
tests         185 pass, 0 fail, 0 skip

npm run build
TypeScript    PASS
Vite web      PASS
MV3 extension PASS

npm run test:extension:browser
Chromium MV3  PASS

npm run test:field-intelligence:browser
Chromium J8   PASS, 8 value-free semantic batches
```

All final commands ran with Node 24.8.0. The production web build is in `apps/web/dist`; the default local extension build was restored after fixture-origin certification. The Node 24 arm64 V8/Wasm cleanup defect was reproduced under parallel PGlite file teardown, so the test launcher now serializes files; the repository's deliberate concurrency tests still pass. A real-browser localhost walkthrough verified returning login, Jobs, Profile, job detail and the no-extension install/fallback dialog with no console warning/error. No Git commit, push, remote, deployment, hosting or release operation was performed. This workspace is intentionally not a Git repository.

## Completed phases

- A: V1 audit and freeze.
- B: clean Node 24 TypeScript V2 skeleton and architecture guards.
- C: PostgreSQL foundation, ownership, RLS, migrations, outbox and workers.
- D: provider-neutral identity foundation and centralized entitlements.
- E1–E4: Candidate Truth ontology, scoped/versioned writes and reads, verified REVIEW promotion, grouped mutations, Undo and Restore.
- F1–F4: value-private one-time V1 import preview/apply/reconciliation/verification. V1 is not a V2 runtime dependency.
- G1–G8: production onboarding and Candidate Truth-backed profile.
- H1–H8: authoritative Job Intelligence ingestion, normalization, eligibility, matching, ranking, lifecycle, discovery and candidate UI.
- I1–I8: Manifest V3 extension foundation, typed protocol, runtime identity/state, website/auth handshake, SPA/ownership/recovery, value-private telemetry and browser certification.
- J1–J8: value-free field evidence, deterministic/AI-bounded canonicalization, confidence/ambiguity, Candidate Truth answer references, repeatable context and semantic browser certification.

## Phase G status

### G1 — authentication and candidate bootstrap: complete

- `IdentityTokenVerifier` is provider-neutral. `OidcJwksIdentityTokenVerifier` verifies signature, issuer, audience, allowed algorithm, expiry and subject through `jose`; a static verifier exists only for tests/local composition.
- `CandidateSessionService` provisions a verified identity through the existing Identity authority, bootstraps the Candidate Truth candidate, and creates or resumes exactly one account-owned onboarding state.
- Caller-provided account or candidate IDs never authorize. Every protected API derives both IDs from the verified bearer session.
- New and returning candidates converge on the same account/candidate/state. Suspended users and invalid bearer headers fail closed.
- The React client uses a replaceable `BrowserAuthClient`; production supports Supabase Google OAuth, email magic links, session restoration and sign-out. Local development can explicitly select `DevelopmentBrowserAuthClient` only when Vite is in DEV mode and `VITE_ENABLE_DEV_AUTH=true`.
- The matching API bypass is separately gated by `ENABLE_DEV_AUTH=true`, `NODE_ENV=development`, a loopback `HOST` and an exact local token. It still requires PostgreSQL and Candidate Truth encryption/fingerprint secrets; production configuration fails closed.
- Development CORS accepts the configured loopback origin and its `localhost`/`127.0.0.1` alias on the same port. Unrelated origins receive no allow header; production remains restricted to its explicitly configured origin.
- Local PostgreSQL setup is repeatable through `npm run dev:setup`: it starts the project-owned Docker container, keeps data in a named volume and applies all 15 checksum-guarded migrations. The full 0001→0015 migration chain has a regression test; Phase H upgrades the Phase E `jobs.role_family` column instead of attempting to recreate it.
- Database connection failures now return an actionable `503 DATABASE_UNAVAILABLE` response. The verified local browser flow reaches `WELCOME` through `POST /v1/auth/bootstrap` with HTTP 200.

### G2 — resume upload, storage and extraction: complete

- Current product boundary is one master resume PDF, maximum 10 MB. Validation covers MIME, safe filename, PDF signature and complete trailer. Oversized multipart requests return HTTP 413 with a stable error.
- PDF bytes stay outside PostgreSQL behind `ObjectStoragePort`. The local adapter uses private filesystem storage and atomic rename; production storage can replace the adapter without changing onboarding logic.
- Candidate/account ownership is enforced in repository queries and foreign-key constraints.
- Upload, replacement and extraction use immutable idempotency receipts. A reused upload key with different bytes fails without deleting or overwriting the accepted object. A successful replacement retires metadata transactionally and best-effort deletes the retired object only after the new registration succeeds.
- Extraction uses `ResumeTextExtractor` and `ResumeCandidateExtractor` ports. The baseline uses PDF.js plus a conservative deterministic zero-AI extractor. Provider/model-specific structured extraction can replace that port later.
- Failed extraction is explicit and retryable with a new attempt. Partial extraction retains valid proposals and rejects unsafe/invalid items. Latest review selection is deterministic by extraction attempt, even when timestamps tie.

### G3 — Candidate Truth proposals: complete

- Resume extraction creates encrypted, candidate-private proposals; it never mutates Candidate Truth.
- AES-256-GCM protects proposal payloads at rest. Keyed fingerprints classify `NEW`, exact `MATCH` and `CONFLICT` against current global Candidate Truth.
- Provenance links document → extraction → proposed canonical without copying candidate values into receipts, outbox or telemetry.
- Canonical registry, normalized-value schema and active Candidate Truth policies validate every proposal. Legal, consent, protected, unsupported and policy-mismatched inferred items fail closed.
- Resume attachment itself is proposed as the `RESUME` FILE_REF canonical.

### G4 — confirmation and correction: complete

- Candidate can accept, correct, remove or skip every proposal and can add manual answers without a resume.
- All accepted/corrected/manual values pass through `CandidateConfirmationService` and the existing E4 `CandidateTruthService.saveGroup` authority.
- One review action creates one grouped change set. No direct Candidate Truth SQL or parallel profile blob exists.
- Exact matches create no redundant answer version. Conflicts use the reviewed existing version as OCC authority, so a stale review cannot overwrite newer truth.
- Repeatable resume groups use durable entity UUIDs and idempotent source keys rather than array position.
- Confirmation is response-loss safe through deterministic E4 idempotency and immutable, value-free confirmation receipts.

### G5 — profile and history: complete

- `CandidateProfileService` is a read/edit application boundary over Candidate Truth current projections and history.
- Profile sections include personal, contact, work, experience, education, skills, projects, certifications, links, documents and preferences as supported by the ontology.
- Multi-field profile saves use E4 grouped `EXPLICIT_SAVE`, expected-current-version OCC and idempotency.
- Repeatable entries preserve stable entity UUID identity. Editing one employment/education record cannot address another through array order.
- History is bounded and returns append-only versions plus the current marker; profile state is never a mutable independent blob.

### G6 — readiness and completion: complete

- Readiness is deterministic and testable; no arbitrary percentage is shown.
- Blocking requirements are candidate name, email and phone. Skills, career history and master resume are useful but optional. Outstanding resume conflicts block completion; missing unrelated optional fields do not.
- UI distinguishes known information, review/stale states, conflicts, missing required items and optional improvements without exposing canonical IDs, fingerprints or internal version terminology.
- Completion uses OCC against onboarding version plus an immutable idempotency receipt. An exact response-loss replay succeeds before re-evaluating already-completed state.

### G7 — Undo and Restore: complete

- Profile save feedback exposes “Updated for next time” and an Undo action.
- Undo calls the E4 append-only, partial-safe reversal authority; the frontend never rewrites old values locally.
- History exposes Restore using E4 expected-current-version protection.
- Fully reversed, partially reversed and skipped-newer-version outcomes remain represented by authoritative reversal results/history.

### G8 — end-to-end hardening: complete

Behavior locks now cover:

- one continuous new-candidate journey from verified bootstrap through resume upload/extraction, proposal confirmation, Candidate Truth readiness/completion and returning login without duplicate account/candidate state;
- new and returning bootstrap;
- manual no-resume onboarding;
- PDF validation and upload replay;
- conflicting idempotency payload safety;
- resume replacement without confirmed-truth overwrite;
- encrypted proposals and value-free outbox/receipts;
- partial extraction and failed-extraction recovery;
- accept/correct/skip and exact confirmation replay;
- grouped profile edits and stable repeatable entity identity;
- deterministic readiness and completion replay;
- stale concurrent edit rejection;
- partial Undo, Restore and reversal history;
- cross-account denial and session-derived API ownership;
- migration replay, RLS and immutable audit artifacts;
- frontend value presentation/correction behavior;
- responsive web production build.

## Current candidate journey

```text
Sign in with Google or email link
  → verified session and candidate bootstrap
  → upload a PDF resume OR continue manually
  → upload progress
  → extraction / retry state
  → review NEW, MATCH and CONFLICT proposals
  → accept, correct, remove or skip
  → grouped Candidate Truth save
  → profile sections and stable history records
  → deterministic readiness review
  → complete onboarding
  → later edit → “Updated for next time” → Undo
  → history → Restore with concurrency protection
```

The responsive candidate UI implements loading, empty, progress, extraction, error, retry, review, edit, success, Undo, history and restore states.

## Phase G schema and migrations

- `0010_candidate_onboarding_bootstrap.sql`: `candidate_onboarding_states`.
- `0011_candidate_resume_intelligence.sql`: candidate-owned document metadata, upload receipts, extraction runs and encrypted proposals.
- `0012_candidate_onboarding_confirmation.sql`: stable entity source keys and confirmation receipts.
- `0013_candidate_profile_completion.sql`: completion receipts.

All four migrations are checksummed/idempotent. Candidate-owned tables enable RLS. Resume proposal values are encrypted; audit/receipt tables are value-free and guarded where immutable.

## Phase G APIs

```text
POST /v1/auth/bootstrap
GET  /v1/auth/session
POST /v1/auth/logout
GET  /v1/onboarding

POST /v1/onboarding/resume
POST /v1/onboarding/resume/:documentId/extract
GET  /v1/onboarding/resume/review
POST /v1/onboarding/review/confirm

GET  /v1/profile
PUT  /v1/profile
GET  /v1/profile/history
GET  /v1/onboarding/readiness
POST /v1/onboarding/complete
POST /v1/profile/changes/:changeSetId/undo
POST /v1/profile/versions/:versionId/restore
GET  /v1/profile/reversals
```

The API supports configured browser CORS, one-file multipart limits and stable error responses.

## Main Phase G files

Domain/application:

- `packages/onboarding/src/confirmation.ts`
- `packages/onboarding/src/profile.ts`
- `packages/onboarding/src/resume.ts`
- `packages/onboarding/src/index.ts`

Persistence:

- `packages/database/src/index.ts` (`KyselyCandidateBootstrapRepository` and migration loaders)
- `packages/database/src/onboarding-resume-repository.ts`
- `packages/database/src/onboarding-confirmation-repository.ts`
- `packages/database/src/candidate-profile-repository.ts`
- `database/migrations/0010_candidate_onboarding_bootstrap.sql`
- `database/migrations/0011_candidate_resume_intelligence.sql`
- `database/migrations/0012_candidate_onboarding_confirmation.sql`
- `database/migrations/0013_candidate_profile_completion.sql`

API/web:

- `apps/api/src/onboarding-routes.ts`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `apps/web/src/auth.ts`
- `apps/web/src/api.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/profile-ux.ts`
- `apps/web/src/styles.css`
- `apps/web/src/main.tsx`

Primary tests:

- `packages/onboarding/src/onboarding.test.ts`
- `packages/database/src/onboarding-bootstrap.test.ts`
- `packages/database/src/onboarding-resume.test.ts`
- `packages/database/src/onboarding-e2e.test.ts`
- `packages/database/src/candidate-profile.test.ts`
- `packages/database/src/migration.test.ts`
- `apps/api/src/app.test.ts`
- `apps/web/src/profile-ux.test.ts`

## Frozen invariants

- `UI → API/application service → Candidate Truth/domain → repository`.
- Candidate Truth is the only reusable candidate-information authority.
- Resume extraction is untrusted proposal evidence, never automatic truth.
- Account/candidate ownership comes from a verified session, never request IDs.
- Multi-field saves use E4 grouped change sets; Undo/Restore use E4 reversal services.
- History is append-only; current truth is a maintained projection.
- Candidate-private values never enter telemetry, logs or outbox payloads where prohibited.
- No V1 runtime reads, profile fallback, Form A/Form B runtime branch, remote code strategy, Git operation or deployment.

## Genuine limitations and intentional deferrals

- Real local use requires a configured PostgreSQL/Supabase database, a 32-byte proposal encryption key and Candidate Truth HMAC key. Authentication may use either backend OIDC/JWKS plus public Supabase web variables or the explicitly gated loopback-only development bypass documented in `README.md`.
- The filesystem object-storage adapter is suitable for local/single-host work. Production should bind the existing port to durable private object storage.
- The baseline extractor handles text-based PDFs conservatively. OCR for scanned/image-only PDFs and provider AI extraction are adapter-level future enhancements, not Phase G correctness requirements.
- Phase M now binds supported repeated application groups to the stable entity IDs that Phase G preserves within reviewed source groups and profile edits.
- Full production grants/restricted database roles and live two-tenant PostgreSQL/Supabase penetration testing remain part of production hardening before release.
- V1 code, dependencies, migrations and tables must not be removed yet. Removal occurs only at the matching Z cutover after zero-read/write proof, rollback proof and production soak; database tables are last.

## What must not be redone

- Do not recreate Candidate Truth, profile storage, resume proposal storage, auth bootstrap, Undo or Restore.
- Do not add a second mutable profile table/blob.
- Do not let frontend or extraction code write Candidate Truth directly.
- Do not reopen Phase F import work unless a behavior lock fails.
- Do not delete V1 yet.
- Do not commit, push, deploy or host unless the user explicitly changes that instruction.

## Historical recovery boundary — Phase O (superseded; complete above)

Begin only from a Phase-O directive. Preserve the completed N graph boundary: declarations may be structurally discovered by N and semantically classified by J, but authorization policy must decide whether/how candidate confirmation is obtained before K acts. Final Submit remains candidate-owned.

Resume commands:

```bash
cd /Users/mac/projects/job-hunter-agent/v2
source /Users/mac/.nvm/nvm.sh
nvm use 24
npm run check
npm run test:extension:browser
npm run test:field-intelligence:browser
npm run test:execution:browser
npm run test:form-graph:browser
npm run test:learning:browser
npm run build
```

Expected baseline: **225 passing tests, 0 fail, 0 skip**, green Phase-I/Phase-J/Phase-K+N/Phase-L Chromium suites, and green web/extension production builds.

## Sources of truth

- Master specification: `/Users/mac/.codex/attachments/0b7f5566-5fd3-490a-8dcb-2ad483384fff/pasted-text.txt`
- Phase G directive: `/Users/mac/.codex/attachments/706cff1d-2a3f-4eee-817a-23448b56ca5d/pasted-text.txt`
- Phase G hardening directive: `/Users/mac/.codex/attachments/530bcaaf-bf6b-4d01-8a6f-ae1bf2a8e058/pasted-text.txt`
- Phase H + H0 audit directive: `/Users/mac/.codex/attachments/0074447b-1f61-45a9-8820-370d12c24b5d/pasted-text.txt`
- Phase I directive: `/Users/mac/.codex/attachments/e396cd98-fd81-4840-8b5d-91289a5f325a/pasted-text.txt`
- Phase J directive: `/Users/mac/.codex/attachments/f3c74715-0672-4866-bffd-abb6c8f5af60/pasted-text.txt`
- Phase K directive: `/Users/mac/.codex/attachments/afad0cc3-a939-40cc-8219-072a82b0290c/pasted-text.txt`
- Phase L directive: `/Users/mac/.codex/attachments/de14ed90-d034-4a36-be75-78a443d9e6ec/pasted-text.txt`
- Phase M directive: `/Users/mac/.codex/attachments/948effe7-bbca-4bdd-a906-9def2d77091f/pasted-text.txt`
- Phase N directive: `/Users/mac/.codex/attachments/7c26ff3f-8342-4833-87a2-3adc89fcd302/pasted-text.txt`
- Phase O directive: `/Users/mac/.codex/attachments/504b4d04-a913-42d9-baa3-5f5ef25f0582/pasted-text.txt`
- Phase I architecture: `docs/EXTENSION_V2_FOUNDATION.md`
- Phase J architecture: `docs/FIELD_INTELLIGENCE.md`
- Phase K architecture: `docs/EXECUTOR_VERIFIER.md`
- Phase L architecture: `docs/VERIFIED_LEARNING_LOOP.md`
- Phase M architecture: `docs/REPEATABLE_ENTITY_INTELLIGENCE.md`
- Phase N architecture: `docs/FORM_GRAPH.md`
- Reconciliation ledger: `docs/V2_PLAN_RECONCILIATION.md`
- V1 classification: `docs/V1_COMPONENT_CLASSIFICATION.md`
- Database ownership: `docs/DATABASE_OWNERSHIP.md`

# Job Hunter architecture index

This index describes V1. For the active V2 rebuild, use [the V2 context index](../v2/docs/CONTEXT_INDEX.md) and its owner documents.

This is the source-controlled companion to `canvases/job-hunter-code-mind-map.canvas.tsx`. Update both whenever a core owner, database family, adapter boundary, or end-to-end data flow changes. Run `npm run check:architecture` before deployment.

## Runtime path

1. `src/services/ingestion.js` collects sources concurrently, indexes canonical URLs, fingerprints material job changes, and passes only fresh/new candidates to the source allocator. `src/services/ingestionScheduler.js` owns stratified Bayesian-smoothed opportunity allocation and daily-volume telemetry.
2. `src/routes/dashboard.js` prepares an application, selects a compact `resume_variants` delta, renders documents on demand, and asks the extension to open the job.
3. `extension/background.js` bootstraps the Chrome application session. `extension/runtime/background/message-router.js`, `api-client.js`, `session-store.js`, and `outbox-transport.js` own message envelopes, API transport, Chrome-local session state, and durable delivery respectively; the entry point retains tab/group/navigation coordination.
4. `extension/adapters/registry.js` maps the current hostname/DOM to one portal kind. `extension/adapters/runtime.js` loads one JSON pack from `src/adapters/packs/`; generic behavior remains the fallback.
5. `extension/content.js` bootstraps the page runtime. `extension/runtime/scanner.js`, `ownership.js`, `executor.js`, `verifier.js`, `telemetry.js`, and `orchestrator.js` own stable binding/identity, user-takeover vetoes, mutation, independent readback, value-free observation, and serialized sequencing. Existing portal adapters remain behind these stateful seams.
6. `src/services/jobRequirementModel.js` turns job text into weighted required/preferred/context/alternative skill evidence. `src/services/heuristicMatcher.js` combines that model with BM25F, career family, preference, location, compensation, and hard experience eligibility; AI sees only uncertain middle-band cases.
7. `src/services/candidateProfileBuilder.js` owns evidence-bearing resume section parsing and verified-master fallback provenance. `src/services/fieldOntology.js` supplies finite definitions and rules; `src/services/fieldCanonicalizer.js` is the single field-meaning resolver and `src/repositories/fieldSemanticRepository.js` owns value-free mappings, examples, concepts and review state. `src/services/semanticMappingEvidenceService.js` converts explicit mapping confirmation/correction into neutral observations plus adaptive SHADOW evidence without changing live mapping status. `src/services/questionResolver.js` is the canonical answer-source layer: profile, selected resume, job source, approved reusable memory, or an explicit AI writing allow-list.
8. `src/services/answerLearningPolicy.js` is the versioned Phase 0A owner for low-risk auto-versioning, review-to-save, application-only answers, declaration authorization and never-learn categories. The global profile preference combines with a non-blocking per-application opt-out in `src/repositories/learningRepository.js`.
9. `src/contracts/sharedContracts.js` is the Phase 0B registry for eight strict contract families: field semantics, answer policy/scope, normalized values, field answers, logical identity, revision/checkpoint timelines, application authorization, and extension protocol/telemetry. The family owners are `src/contracts/fieldSemanticResult.js`, `src/contracts/canonicalAnswerPolicy.js`, `src/contracts/normalizedValue.js`, `src/contracts/fieldAnswerContract.js`, `src/contracts/logicalFieldIdentity.js`, `src/contracts/fieldRevisionContracts.js`, `src/contracts/applicationAuthorizationContracts.js`, and `src/contracts/extensionProtocolContracts.js`. `src/contracts/contractPrimitives.js` owns canonical JSON, hashing, version failure and size limits. The extension mirror is generated from `src/contracts/browserValidatorTemplate.js`.
10. `src/contracts/fieldInteractionObservation.js` converts a browser field event into one versioned, value-free private observation. `src/services/fieldLearningClassifier.js` attributes that neutral observation independently across semantic, candidate-answer, representation, interaction-strategy, and acceptance layers. The Phase 0 classifier is SHADOW-only and cannot write a learning ledger.
11. `src/services/fieldRevisionService.js` is the durable Phase 0C owner for append-only field revisions, edit-session snapshots, checkpoint receipts, neutral observations, and checkpoint-triggered SHADOW reclassification. Ordered migrations `src/database/migrations/0007_field_revision_timeline.js` and `src/database/migrations/0008_checkpoint_reclassification.js` preserve history and idempotency.
12. `src/services/extensionLaunchProtocol.js` owns Phase 0D negotiation, single-use launch authorization, run/session binding, origin/tab/document ownership, replay prevention and page/form delta state. Migrations `src/database/migrations/0009_extension_launch_protocol.js` add only token hashes; raw launch/session tokens remain extension-private.
13. `extension/durable-outbox.js` and `src/services/extensionDeliveryService.js` own durable value-free delivery, per-run sequencing/ACKs, retry bounds, backend idempotency, telemetry receipts and the transactional backend outbox. Migrations `src/database/migrations/0010_extension_durable_delivery.js` and `src/database/migrations/0011_extension_field_cache_status.js` are candidate-scoped/additive. `supabase/phase0_extension_rls.sql` is the future authenticated RLS/storage contract; it is not a claim that the current SQLite build uses Supabase.
14. `src/contracts/evidenceUpdate.js` freezes value-free Phase 0F input. `src/services/evidenceRouter.js` keeps semantic, answer, representation, strategy and acceptance evidence separate; `src/services/adaptiveEvidencePolicy.js`, `src/services/evidenceAccumulator.js`, `src/services/volatilityDetector.js` and `src/services/promotionPolicy.js` own deterministic integer weighting, lifetime/recent rollups, regression detection and SHADOW-only recommendations. `src/repositories/evidenceRollupRepository.js` persists them through `src/database/migrations/0012_adaptive_evidence_shadow.js`.
15. `src/services/answerPolicyRegistry.js` owns one immutable, active policy version per canonical. `src/services/answerContextNormalization.js`, `src/services/scopeRankPolicy.js`, `src/services/candidateAnswerFreshness.js` and `src/services/candidateAnswerAnomaly.js` own exact controlled contexts, ordered scope selection, expiry and deterministic anomaly gates. `src/repositories/candidateAnswerVersionRepository.js` owns append-only candidate-private truth, optimistic concurrency, idempotent receipts and same-transaction dependency invalidation through `src/database/migrations/0013_candidate_answer_intelligence.js` and forward-only `src/database/migrations/0014_employer_entity_exact_aliases.js`. `src/services/candidateAnswerLegacyMigrationService.js` is the Part 2B compatibility bridge. `src/services/fieldAnswerContractService.js` is the SHADOW read boundary. `src/services/candidateAnswerChangeSetService.js` owns verified multi-answer ACID learning commits. `src/services/scopedCandidateAnswerLearning.js` owns the small exact-context `REVIEW → TRUSTED` policy with no numeric confidence or historical scan. `src/services/candidateAnswerReversalService.js` and `src/repositories/candidateAnswerReversalRepository.js` own append-only Undo/Restore, item-level newer-version protection, idempotency and value-free history through `src/database/migrations/0019_candidate_answer_scoped_learning_undo.js`. `supabase/phase2_candidate_truth_rls.sql` freezes the future own-row, service-only mutation boundary.
16. `extension/adapters/common/` operates common widgets. Uploads, dates, repeatable sections, shadow DOM, identity fields and navigation hops belong here—not in company-specific code.
17. `src/routes/extension.js` connects browser plans, application attempts, evidence, sidecar state, and Attention Center. New route payloads must parse a named contract from `sharedContracts.js`; routes may not invent competing learning/protocol shapes.
18. The candidate reviews the employer form and submits. COPILOT never clicks final submit.
19. `src/services/reliabilityScope.js` and `src/services/reliabilityReport.js` measure current-build evidence separately from historical evidence. Automatic success rates exclude `NOT_ATTEMPTED`; upload reliability is based on final operation receipts; safety checks remain all-history.

## Ownership map

| Change | Primary owner | Required lock |
|---|---|---|
| Field maps to the wrong meaning | `src/services/fieldCanonicalizer.js`, `src/repositories/fieldSemanticRepository.js`, `src/services/semanticMappingEvidenceService.js` plus adapter DOM context | Sanitized portal fixture, explicit semantic-evidence isolation, adaptive SHADOW recommendation and admin approval test |
| Known fact resolves to the wrong value | `src/services/questionResolver.js` plus candidate profile | Resolver test and exact-option fixture |
| Candidate corrects an autofilled field | `src/contracts/fieldInteractionObservation.js` and `src/services/fieldLearningClassifier.js` | Five-layer replay matrix; raw browser events cannot write learning evidence |
| Answer-learning scope or declaration policy changes | `src/services/answerLearningPolicy.js`, ADR 0001, `src/repositories/learningRepository.js` | Category coverage, current-copy reconciliation, verified checkpoint, and per-application opt-out tests |
| Shared answer, identity, revision, authorization, protocol or telemetry shape changes | `src/contracts/sharedContracts.js` plus its named family owner | Backend/extension golden corpus, property cases, generator synchronization, version/size/privacy rejection |
| Field edit, interruption, checkpoint, or SHADOW reclassification changes | `src/services/fieldRevisionService.js` plus `extension/content.js` | Durable timeline replay, idempotent retry, no raw value, no learning-ledger mutation |
| Website/extension connection, launch, origin or run identity changes | `src/services/extensionLaunchProtocol.js`, `extension/background.js`, website launch bridge | Not-installed/version/permission UX, single-use/replay/wrong-origin tests, inert tab before authorization |
| Offline retry, idempotency, telemetry or delivery isolation changes | `extension/durable-outbox.js`, `src/services/extensionDeliveryService.js` | Worker restart/retry/order/ACK tests, key-hash conflict test, tenant and RLS contract tests |
| Adaptive weighting, decay, volatility or recommendation changes | `src/contracts/evidenceUpdate.js`, `src/services/evidenceRouter.js`, `src/services/adaptiveEvidencePolicy.js`, `src/services/evidenceAccumulator.js`, `src/services/volatilityDetector.js`, `src/services/promotionPolicy.js` | Backend/browser contract parity, deterministic replay, recent regression, layer isolation, idempotency and zero production-ledger mutation |
| Canonical answer class, scope, freshness, reuse or authorization changes | `src/services/answerPolicyRegistry.js`, `src/services/answerContextNormalization.js`, `src/services/scopeRankPolicy.js` | All-canonical coverage, exact jurisdiction/entity matching, equal-rank ambiguity, freshness and policy-parity tests |
| Candidate truth version or dependency behavior changes | `src/repositories/candidateAnswerVersionRepository.js`, `src/services/candidateAnswerFreshness.js`, `src/services/candidateAnswerAnomaly.js` | Append-only history, expected-version conflict, idempotency, ACID invalidation, provenance and own-row RLS tests |
| Scoped REVIEW/TRUSTED learning or Undo/Restore changes | `src/services/scopedCandidateAnswerLearning.js`, `src/services/candidateAnswerChangeSetService.js`, `src/services/candidateAnswerReversalService.js` | Exact-context isolation, direct-origin promotion, no-op trusted reuse, partial newer-version skip, append-only restore, idempotency, value-free audit and RLS tests |
| Legacy candidate-truth migration changes | `src/services/candidateAnswerLegacyMigrationService.js`, `src/database/migrations/0015_candidate_answer_legacy_migration.js` | Source-conflict, legal/entity skip, exact unit conversion, no overwrite, idempotent replay, redacted audit and own-row RLS tests |
| Field-answer contract selection or baseline representation changes | `src/services/fieldAnswerContractService.js`, `src/contracts/fieldAnswerContract.js` | Batch-resolution, scope/freshness, exact-option ambiguity, hash/provenance, backend/browser contract and SHADOW-no-cutover tests |
| Unsupported control behavior | `extension/adapters/common/` plus portal pack | Browser fixture for the widget kind |
| Portal recognition or selectors | `extension/adapters/registry.js`, `src/adapters/packs/*.json` | Form A and Form B |
| SPA rerender clears a value | `extension/content.js` verification/fingerprint | React-controlled fixture preserving user edits |
| Tab group or side-panel behavior | `extension/background.js`, `extension/sidepanel.js` | Persistent unpacked-extension test |
| New candidate fact | schema, connection migration, `copilotRepository.js`, onboarding, resolver | Persistence, validation and privacy tests |
| Learning/promotion policy | `learnProposer.js`, `formAGate.js`, mapping repositories | SHADOW/CANARY and full corpus gate |
| Release reliability or acceptance math | `reliabilityScope.js`, `reliabilityReport.js`, `phase1Acceptance.js` | Current-build fixtures plus historical safety audit |

## State boundaries

- Chrome-local session state: `activeJob`, `activeTabId`, `activeApplication`, side-panel visibility and document-preview context.
- Page-local state: detected fields, stable element map, active/user-edited fields, last programmatic fills, attachment retry ledger and dynamic-page fingerprint.
- Candidate truth: `candidate_profiles` remains the product-profile compatibility source; `candidate_answer_versions` is the append-only, scoped Part 2 authority for normalized candidate-approved truth. One active version is allowed per candidate/canonical/scope, and it is distinct from inferred mappings, rendering rules and DOM strategies.
- Application mechanics: attempts, field timeline, operations, page snapshots, plans and Attention items.
- Correction attribution: browser events first become neutral, value-free observations; only the versioned classifier may produce separate semantic, answer, representation, strategy and acceptance decisions. Phase 0 decisions remain SHADOW-only.
- Edit durability: `field_revision_events` and `field_edit_session_snapshots` are append-only. `application_checkpoint_receipts` adds evidence strength without rewriting browser history; `field_learning_shadow_classifications` may append a stronger classification for the same observation without making it production learning.
- Launch authority: website availability is negotiated before launch. A one-use authorization is bound to candidate, job, application, run, exact URL/origin, website origin, nonce, protocol and expiry; consumption binds the run session to the Chrome tab/document. Only hashes reach SQLite.
- Delivery durability: only structural/value-free edit, checkpoint and telemetry payloads enter the Chrome outbox. It has per-run sequence watermarks, bounded retries/size/TTL and never persists stale DOM actions. Backend idempotency rejects the same key with another request hash.
- Adaptive evidence: `adaptive_evidence.shadow` consumes classified observations only. It preserves immutable events plus lifetime/recent rollups, keeps direct/rescue populations separate, and emits reason-coded SHADOW recommendations. It has no write path to candidate truth, semantic mappings, representations or production strategy state.
- Candidate-answer authority: policy and controlled context are global configuration; answer versions, write receipts, dependency events, runtime parity receipts, immutable application change sets and reversal sets are candidate-private. Unknown required contexts, stale answers and equal-rank non-equivalent results return `NEEDS_USER`. `candidateAnswerResolver` is the only read-authority switch. `candidateAnswerChangeSetService` is the only multi-answer learning-commit boundary. Low-risk facts may become trusted directly; configured contextual preferences become exact-scope REVIEW and promote only after proven unchanged reuse. `candidateAnswerReversalService` appends compensating versions and skips any item whose learned version is no longer current.
- Candidate-answer migration: profile/resume/fact/answer compatibility sources are read without invoking profile backfill side effects. Only unambiguous policy-safe values are copied into SHADOW truth. Legal/entity/application/repeatable values, implicit defaults, unsafe provenance and conflicts are reason-coded skips; a migration never overwrites active truth or changes the production resolver.
- Field-answer boundary: `fieldAnswerContractService` performs one page-sized truth batch and returns a contract only when semantics, policy version, value hash, scope, freshness and a packaged baseline representation all agree. Unsupported duration/money/phone/multi-value/file transformations fail closed. The extension exposes these results for SHADOW parity but the legacy answer remains authoritative.
- Tenant seam: all new protocol/delivery rows carry `candidate_id`; local services fail closed to `local-user`. The checked-in Supabase RLS contract uses `auth.uid()` and exact private storage paths for the later auth migration.
- Shared transport boundary: every Phase 0B contract is version 1, strict, size-bounded and fail-closed. Semantic and telemetry contracts are value-free; normalized candidate values cannot represent protected data; exact money is a decimal string rather than a floating-point number.
- Outcomes: submitted, recruiter response, interview, rejected, offer and withdrawn events are separate from fill mechanics.
- Learning: portal patterns, mappings, proposals, versions and promotion stages. Learning consumes minimized metadata, not raw protected answers.
- Release evidence: a non-destructive current-build baseline, extension/adapter versions, final operation receipts and per-portal rates. Old attempts remain auditable but cannot contaminate the active release denominator.

## Database families

- Discovery: `companies`, `jobs`, `outreach`, `ingestion_*`, `job_score_events`, `career_test_*`.
- Candidate: `candidate_profiles`, legacy `candidate_answers` / `candidate_fact_*`, `candidate_answer_versions`, `candidate_answer_write_receipts`, `candidate_answer_dependency_events`, `candidate_answer_migration_runs`, `candidate_answer_migration_items`, `candidate_answer_resolution_parity_events`, `candidate_answer_change_sets`, `candidate_answer_change_set_items`, `candidate_answer_change_set_receipts`, `candidate_answer_reversal_sets`, `candidate_answer_reversal_items`, `candidate_answer_reversal_receipts`, `writing_style_profiles`.
- Documents: `resume_versions`, `resume_variants`.
- Application: `applications`, `application_events`, `application_attempts`, `application_outcome_events`, `application_plans`, `agent_*`.
- Evidence: `application_field_evidence`, `application_operation_events`, `application_*_snapshots`, `application_field_timeline`, `field_revision_events`, `field_edit_session_snapshots`, `application_checkpoint_receipts`, `field_interaction_observations`, `field_learning_shadow_classifications`, `adaptive_evidence_shadow_events`, `adaptive_evidence_shadow_rollups`, `adaptive_evidence_shadow_recommendations`, `field_resolutions`, `application_questions`, `adapter_runs`.
- Extension protocol/delivery: `extension_launch_authorizations`, `extension_run_bindings`, `extension_protocol_replays`, `extension_run_field_cache`, `extension_idempotency_requests`, `extension_telemetry_events`, `extension_backend_outbox`, `extension_protocol_audit_events`.
- Recovery: `attention_items`.
- Learning: `field_mappings`, `portal_field_patterns`, `learning_events`, `mapping_*`, `adapter_incidents`.
- Policy/operations: `canonical_answer_policies`, `canonical_answer_policy_active`, `canonical_answer_freshness_profiles`, `canonical_answer_anomaly_profiles`, `answer_context_registry`, `employer_entity_groups`, `employer_entities`, `settings`, `auto_apply_settings`, `autofill_category_policies`, `feature_flags`, `usage_events`, `ai_call_metrics`.

## Changeability audit

Strong foundations:

- Versioned adapter registry and data packs prevent per-company JavaScript.
- Stable semantic keys and section-scoped structured resume fields prevent dynamic-ID contamination.
- Review-only submission and protected-field policies are explicit.
- Resume variants store compact deltas instead of permanent PDF copies.
- Append-only timeline/operation evidence supports diagnosis without overwriting the only record.
- Neutral correction observations prevent an answer edit from rewarding or punishing field meaning or browser strategy by accident.
- Form A/B, SHADOW and CANARY promotion stop a Form B fix from breaking Form A.

Priority debt:

1. Phase 0G moved extension stateful ownership behind strict modules, but `extension/content.js` still contains compatibility helpers and DOM recipes. Move pure descriptor/recipe bodies behind the existing module APIs as bounded mechanical extractions; do not introduce a second runtime or combine extraction with new strategies.
2. `extension/background.js`, `src/routes/extension.js`, and `src/routes/dashboard.js` remain large orchestration hubs even though background transport/session/message envelopes are extracted. Continue moving domain decisions into services while keeping event listeners thin.
3. Field semantics and option normalization have browser/server duplication. Generate a shared browser-safe contract from one source so typo, unit and alias behavior cannot drift.
4. `src/database/schema.sql` and the compatibility migrations in `src/database/connection.js` duplicate schema evolution. Introduce ordered migrations and a recorded schema version before multi-user/cloud storage.
5. The browser corpus is broad but concentrated in one test file. Split tests by portal while retaining one full promote-gate command.
6. A live failure still cannot safely teach new widget code automatically. The correct loop is: minimized incident → sanitized fixture → scoped code/data proposal → corpus → SHADOW/CANARY. Automatic global runtime rewrites remain prohibited.

## PhonePe Greenhouse Form A (v1.15.7)

The repeated PhonePe experience and education controls were previously outside Greenhouse section context, so labels like `Company name*`, `Title*`, split month/year dates and `Degree` were treated as unrelated generic questions. Upload verification also anchored itself to an input Greenhouse replaces after accepting a file. A React rerender could clear a value without changing the old structural fingerprint.

The lock now covers:

- `.employment-form` / `.education--form` and Greenhouse repeated IDs;
- month/year extraction and degree canonicalization;
- typo-tolerant `Years of Expereince` and job-source choices;
- current career stage, current industry and precise city facts;
- upload receipts after the original file input is detached;
- empty/non-empty SPA fingerprint repair without persisting values;
- trusted-event filtering so synthetic ATS events are not learned as candidate edits.
- finite React Select controls are resolved from their actual listbox options, require an unambiguous confidence of at least 0.8, and are verified from the committed `.select__single-value` after the search input clears;
- search-backed comboboxes are queried incrementally, score only returned suggestions, and restore the original value when no option can be verified;
- operation evidence records widget mode, candidate/query counts, match class/confidence and survival verification without storing the candidate's raw answer.

Fixture: `test/fixtures/live-greenhouse-phonepe.html`. Browser contract: `test/extensionBrowserHarness.test.js`.

## Maintenance checklist

- Update this index and the interactive canvas for owner/table/flow changes.
- Add or update the smallest sanitized fixture for every live ATS miss.
- Keep adapters portal-scoped; tenant wording belongs in data overlays.
- Run focused tests, `npm test`, `npm run check:start`, syntax checks and the applicable real-browser prepare-only flow.
- Reload the unpacked extension after a manifest or content/background script change.
- Never use a historical polluted attempt to measure current accuracy without filtering by extension/adapter version and recent attempt.

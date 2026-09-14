import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listCandidateAnswerPolicies } from "@job-hunter-v2/candidate-truth";
import { Kysely, PGliteDialect } from "kysely";
import {
  applyMigration,
  KyselyEntitlementRepository,
  KyselyCanonicalReviewRepository,
  migrateCandidateReviewOutcomeProofs,
  migrateCandidateAnswerReversals,
  migrateCandidateOnboardingBootstrap,
  migrateCandidateOnboardingConfirmation,
  migrateCandidateProfileCompletion,
  migrateCandidateResumeIntelligence,
  migrateCandidateTruthImportPreviews,
  migrateCandidateTruthImportApply,
  migrateCandidateTruthOntology,
  migrateCandidateTruthMutationGuards,
  migrateCandidateScopePolicyVectors,
  migrateCoreEntitlements,
  migrateJobIntelligence,
  migrateVerifiedLearningLoop,
  migrateRepeatableEntityIntelligence,
  migrateDeclarationConsentPolicy,
  migrateAiOrchestration,
  migrateStrategyIntelligence,
  migrateStrategyOperations,
  migrateDocumentIntelligence,
  migrateGlobalAnswerDefaults,
  migrateCanonicalReviewQueue,
  migrateLearningRecovery,
  migrateLearningNoteConfirmation,
  migrateOperatorReview,
  migrateOperatorWorkflow,
  migrateLearningInboxLifecycle,
  migrateSupportReview,
  migrateCaseMerge,
  migrateReviewedExports,
  migrateScopedNoteRecovery,
  migrateLearningFingerprintVersions,
  migrateAdminWorkspace,
  loadInitialMigration,
  migrateInitialSchema,
  type SqlClient,
  type V2Database
} from "./index.js";

function client(database: PGlite): SqlClient {
  const executor = (target: Pick<PGlite, "query" | "exec">) => ({
    query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
      const result = await target.query<Row>(text, values ? [...values] : undefined);
      return { rows: result.rows };
    },
    executeScript: async (text: string) => {
      await target.exec(text);
    }
  });
  return {
    ...executor(database),
    withTransaction: async (work) => database.transaction((transaction) => work(executor(transaction)))
  };
}

test("0001 migrates an empty PostgreSQL database and is idempotent", async () => {
  const database = new PGlite();
  const sql = client(database);

  const first = await migrateInitialSchema(sql);
  const second = await migrateInitialSchema(sql);
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(first.checksumSha256, second.checksumSha256);

  const required = await database.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'accounts', 'plans', 'features', 'plan_entitlements', 'subscriptions',
        'candidates', 'candidate_answer_versions', 'candidate_answers_current',
        'jobs', 'applications', 'strategy_versions', 'outbox_events', 'worker_jobs'
      )
  `);
  assert.equal(required.rows.length, 13);

  const legacy = await database.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('candidate_answers', 'candidate_fact_memory', 'form_answers')
  `);
  assert.equal(legacy.rows.length, 0);

  await database.close();
});

test("a modified applied migration fails closed", async () => {
  const database = new PGlite();
  const sql = client(database);
  const migration = await loadInitialMigration();
  await applyMigration(sql, migration);

  await assert.rejects(
    applyMigration(sql, { ...migration, sql: `${migration.sql}\n-- mutation` }),
    /checksum mismatch/
  );
  await database.close();
});

test("0014 installs the idempotent Job Intelligence catalog, immutable evidence and candidate RLS boundary", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  assert.equal((await migrateJobIntelligence(sql)).applied, true);
  assert.equal((await migrateJobIntelligence(sql)).applied, false);

  const tables = await database.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'job_source_job_states', 'job_dedupe_keys', 'job_fact_provenance',
        'job_lifecycle_events', 'job_ingestion_receipts', 'job_source_scan_receipts',
        'candidate_search_profile_versions', 'candidate_search_profiles',
        'candidate_search_profile_receipts'
      )
    ORDER BY table_name
  `);
  assert.equal(tables.rows.length, 9);

  const immutableTriggers = await database.query<{ count: string }>(`
    SELECT count(DISTINCT trigger_name)::text AS count
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND trigger_name IN (
        'job_source_snapshots_no_update', 'job_fact_provenance_no_update',
        'job_lifecycle_events_no_update', 'job_ingestion_receipts_no_update',
        'job_source_scan_receipts_no_update', 'candidate_search_profile_versions_no_update',
        'candidate_search_profile_receipts_no_update'
      )
  `);
  assert.equal(immutableTriggers.rows[0]?.count, "7");

  const rls = await database.query<{ relname: string; relrowsecurity: boolean }>(`
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'candidate_search_profile_versions',
        'candidate_search_profiles',
        'candidate_search_profile_receipts'
      )
    ORDER BY c.relname
  `);
  assert.equal(rls.rows.length, 3);
  assert.equal(rls.rows.every((row) => row.relrowsecurity), true);
  await database.close();
});

test("0015 installs value-private verified-learning staging and replay-safe evidence tables", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  assert.equal((await migrateVerifiedLearningLoop(sql)).applied, true);
  assert.equal((await migrateVerifiedLearningLoop(sql)).applied, false);
  const tables = await database.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN (
      'candidate_learning_run_receipts', 'application_execution_evidence',
      'candidate_learning_observations', 'candidate_learning_checkpoint_receipts',
      'candidate_learning_submit_attempts'
    ) ORDER BY table_name
  `);
  assert.equal(tables.rows.length, 5);
  const rls = await database.query<{ relname: string; relrowsecurity: boolean }>(`
    SELECT relname, relrowsecurity FROM pg_class
    WHERE relname IN ('candidate_learning_run_receipts', 'application_execution_evidence', 'candidate_learning_observations', 'candidate_learning_checkpoint_receipts', 'candidate_learning_submit_attempts')
  `);
  assert.equal(rls.rows.every((row) => row.relrowsecurity), true);
  await database.close();
});

test("the complete ordered migration chain reaches 0034 without duplicate schema ownership", async () => {
  const database = new PGlite();
  const sql = client(database);
  const migrations = [
    migrateInitialSchema,
    migrateCoreEntitlements,
    migrateCandidateTruthOntology,
    migrateCandidateTruthMutationGuards,
    migrateCandidateScopePolicyVectors,
    migrateCandidateReviewOutcomeProofs,
    migrateCandidateAnswerReversals,
    migrateCandidateTruthImportPreviews,
    migrateCandidateTruthImportApply,
    migrateCandidateOnboardingBootstrap,
    migrateCandidateResumeIntelligence,
    migrateCandidateOnboardingConfirmation,
    migrateCandidateProfileCompletion,
    migrateJobIntelligence,
    migrateVerifiedLearningLoop,
    migrateRepeatableEntityIntelligence,
    migrateDeclarationConsentPolicy,
    migrateAiOrchestration,
    migrateStrategyIntelligence,
    migrateStrategyOperations,
    migrateDocumentIntelligence,
    migrateGlobalAnswerDefaults,
    migrateCanonicalReviewQueue,
    migrateLearningRecovery,
    migrateLearningNoteConfirmation,
    migrateOperatorReview,
    migrateOperatorWorkflow,
    migrateLearningInboxLifecycle,
    migrateSupportReview,
    migrateCaseMerge,
    migrateReviewedExports,
    migrateScopedNoteRecovery,
    migrateLearningFingerprintVersions,
    migrateAdminWorkspace
  ] as const;

  for (const migrate of migrations) assert.equal((await migrate(sql)).applied, true);
  for (const migrate of migrations) assert.equal((await migrate(sql)).applied, false);

  const roleFamily = await database.query<{ is_nullable: string; column_default: string }>(`
    SELECT is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'role_family'
  `);
  assert.equal(roleFamily.rows[0]?.is_nullable, "NO");
  assert.match(roleFamily.rows[0]?.column_default ?? "", /OTHER/);
  const repeatable = await database.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN (
      'application_entity_bindings', 'candidate_entity_operation_receipts'
    ) ORDER BY table_name
  `);
  assert.deepEqual(repeatable.rows, [
    { table_name: "application_entity_bindings" },
    { table_name: "candidate_entity_operation_receipts" }
  ]);
  const valueColumns = await database.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM information_schema.columns
    WHERE table_name = 'application_entity_bindings'
      AND column_name IN ('company_name', 'institution_name', 'title', 'date_value', 'normalized_value', 'text_value')
  `);
  assert.equal(valueColumns.rows[0]?.count, "0");
  const owner = "10000000-0000-4000-8000-000000000081";
  const candidate = "20000000-0000-4000-8000-000000000081";
  const foreign = "10000000-0000-4000-8000-000000000082";
  await database.exec(`INSERT INTO accounts(id, account_type) VALUES ('${owner}', 'NORMAL'), ('${foreign}', 'NORMAL'); INSERT INTO candidates(id, account_id) VALUES ('${candidate}', '${owner}');`);
  const queue = new KyselyCanonicalReviewRepository(new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) }));
  const proposal = { descriptorFingerprint: "a".repeat(64), reason: "NEW_CANONICAL_REVIEW", candidateKeys: [] };
  await queue.record(owner, candidate, [proposal, proposal]);
  assert.equal((await queue.list(owner, candidate)).length, 1, "repeated scans deduplicate");
  await queue.record(foreign, candidate, [{ ...proposal, descriptorFingerprint: "b".repeat(64) }]);
  assert.deepEqual(await queue.list(foreign, candidate), [], "another account cannot read or enqueue a candidate's proposals");
  assert.equal((await queue.list(owner, candidate)).length, 1);
  await database.close();
});

test("0017 installs append-only, RLS-protected, value-free declaration evidence", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  assert.equal((await migrateDeclarationConsentPolicy(sql)).applied, true);
  assert.equal((await migrateDeclarationConsentPolicy(sql)).applied, false);
  const table = await database.query<{ relrowsecurity: boolean }>(`
    SELECT relrowsecurity FROM pg_class WHERE relname = 'application_declaration_evidence'
  `);
  assert.equal(table.rows[0]?.relrowsecurity, true);
  const immutable = await database.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM information_schema.triggers
    WHERE trigger_name = 'application_declaration_evidence_no_update'
  `);
  assert.equal(immutable.rows[0]?.count, "2");
  const unsafeColumns = await database.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM information_schema.columns
    WHERE table_name = 'application_declaration_evidence'
      AND column_name IN ('raw_text', 'declaration_text', 'field_value', 'normalized_value', 'candidate_answer_id', 'answer_version_id')
  `);
  assert.equal(unsafeColumns.rows[0]?.count, "0");
  await database.close();
});

test("0021 upgrades existing pending and reviewed proposals while preserving review guards", async () => {
  const database = new PGlite();
  const migration = client(database);
  try {
    for (const migrate of [migrateInitialSchema, migrateCandidateTruthOntology,
      migrateCandidateScopePolicyVectors, migrateCandidateOnboardingBootstrap,
      migrateCandidateResumeIntelligence, migrateCandidateOnboardingConfirmation]) await migrate(migration);
    await database.exec(`
      INSERT INTO accounts (id, account_type) VALUES ('10000000-0000-4000-8000-000000000001', 'NORMAL');
      INSERT INTO candidates (id, account_id, status) VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'ACTIVE');
      INSERT INTO documents (id, account_id, candidate_id, object_key, original_file_name, content_sha256, byte_size, mime_type, purpose, status)
      VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'fixture/private.pdf', 'resume.pdf', repeat('a',64), 32, 'application/pdf', 'MASTER_RESUME', 'READY');
      INSERT INTO resume_extraction_runs (id, account_id, candidate_id, document_id, status, attempt, extractor, extractor_version, idempotency_key, request_fingerprint, started_at, completed_at)
      VALUES ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'COMPLETED', 1, 'FIXTURE', '1', 'fixture-extract', repeat('b',64), now(), now());
      INSERT INTO resume_candidate_proposals (id, account_id, candidate_id, document_id, extraction_id, item_key, canonical_id, confidence, comparison, decision, value_fingerprint, fingerprint_key_version, payload_key_version, payload_iv, payload_auth_tag, encrypted_payload, created_at, reviewed_at)
      SELECT gen_random_uuid(), '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', decision, id, 1, 'NEW', decision, repeat('c',64), 1, 1, decode(repeat('00',12),'hex'), decode(repeat('00',16),'hex'), decode('01','hex'), now(), CASE WHEN decision = 'ACCEPTED' THEN now() ELSE NULL END
      FROM canonical_fields CROSS JOIN (VALUES ('PENDING'), ('ACCEPTED')) AS decisions(decision) WHERE canonical_key = 'FULL_NAME';
    `);
    const before = (await database.query("SELECT id, decision, encrypted_payload, reviewed_at FROM resume_candidate_proposals ORDER BY id")).rows;
    assert.equal(before.length, 2);
    assert.equal((await migrateDocumentIntelligence(migration)).applied, true);
    assert.equal((await migrateDocumentIntelligence(migration)).applied, false);
    assert.deepEqual((await database.query("SELECT id, decision, encrypted_payload, reviewed_at FROM resume_candidate_proposals ORDER BY id")).rows, before);
    assert.equal((await database.query("SELECT id FROM resume_candidate_proposals WHERE evidence_sha256 = value_fingerprint")).rows.length, 2);
    await assert.rejects(database.exec("UPDATE resume_candidate_proposals SET confidence = 0.5"), /resume proposal mutation/);
    await database.exec("UPDATE resume_candidate_proposals SET decision = 'ACCEPTED', reviewed_at = now() WHERE decision = 'PENDING'");
    await assert.rejects(database.exec("UPDATE resume_candidate_proposals SET decision = 'REMOVED', reviewed_at = now()"), /resume proposal mutation/);
  } finally { await database.close(); }
});

test("0021 installs versioned private documents, lifecycle history, generation state and run pins", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  await migrateCandidateTruthOntology(sql);
  await migrateCandidateScopePolicyVectors(sql);
  await migrateCandidateOnboardingBootstrap(sql);
  await migrateCandidateResumeIntelligence(sql);
  await migrateCandidateOnboardingConfirmation(sql);
  assert.equal((await migrateDocumentIntelligence(sql)).applied, true);
  assert.equal((await migrateDocumentIntelligence(sql)).applied, false);

  const tables = await database.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN (
      'document_lifecycle_events', 'document_generation_runs',
      'document_approval_receipts', 'application_document_selections',
      'application_document_upload_evidence'
    ) ORDER BY table_name
  `);
  assert.equal(tables.rows.length, 5);
  const rls = await database.query<{ relrowsecurity: boolean }>(`
    SELECT relrowsecurity FROM pg_class WHERE relname IN (
      'document_lifecycle_events', 'document_generation_runs',
      'document_approval_receipts', 'application_document_selections',
      'application_document_upload_evidence'
    )
  `);
  assert.equal(rls.rows.length, 5);
  assert.equal(rls.rows.every((row) => row.relrowsecurity), true);
  const documentColumns = await database.query<{ column_name: string }>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name IN (
      'document_version', 'source_document_id', 'job_id', 'application_id',
      'generation_policy_version', 'failure_code', 'updated_at', 'ready_at'
    )
  `);
  assert.equal(documentColumns.rows.length, 8);
  await database.close();
});

test("0016 safely backfills lifecycle time for pre-existing removed candidate entities", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  await migrateVerifiedLearningLoop(sql);
  await database.exec(`
    INSERT INTO accounts (id, account_type) VALUES ('c1000000-0000-4000-8000-000000000001', 'NORMAL');
    INSERT INTO candidates (id, account_id) VALUES ('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001');
    INSERT INTO candidate_entities (id, candidate_id, entity_type, status, created_at)
    VALUES ('c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000002', 'EMPLOYMENT', 'REMOVED', '2026-01-01T00:00:00Z');
  `);
  assert.equal((await migrateRepeatableEntityIntelligence(sql)).applied, true);
  const entity = await database.query<{ removed_at: Date | null }>(`
    SELECT removed_at FROM candidate_entities WHERE id = 'c1000000-0000-4000-8000-000000000003'
  `);
  assert.ok(entity.rows[0]?.removed_at);
  await database.close();
});

test("core seed keeps candidate-specific AI disabled on FREE while preserving learning", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  const firstSeed = await migrateCoreEntitlements(sql);
  const secondSeed = await migrateCoreEntitlements(sql);
  assert.equal(firstSeed.applied, true);
  assert.equal(secondSeed.applied, false);

  const result = await database.query<{ feature_key: string; enabled: boolean }>(`
    SELECT f.feature_key, pe.enabled
    FROM plan_entitlements pe
    JOIN plans p ON p.id = pe.plan_id
    JOIN features f ON f.id = pe.feature_id
    WHERE p.code = 'FREE'
      AND f.feature_key IN (
        'candidate.learning',
        'candidate.ai_match_explanations',
        'candidate.ai_application_answers'
      )
    ORDER BY f.feature_key
  `);

  assert.deepEqual(result.rows, [
    { feature_key: "candidate.ai_application_answers", enabled: false },
    { feature_key: "candidate.ai_match_explanations", enabled: false },
    { feature_key: "candidate.learning", enabled: true }
  ]);
  await database.close();
});

test("candidate truth ontology and scoped active policies are versioned, complete and fail closed", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  const first = await migrateCandidateTruthOntology(sql);
  const second = await migrateCandidateTruthOntology(sql);
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  await migrateCandidateTruthMutationGuards(sql);
  const firstVectors = await migrateCandidateScopePolicyVectors(sql);
  const secondVectors = await migrateCandidateScopePolicyVectors(sql);
  assert.equal(firstVectors.applied, true);
  assert.equal(secondVectors.applied, false);
  assert.equal((await migrateGlobalAnswerDefaults(sql)).applied, true);
  assert.equal((await migrateGlobalAnswerDefaults(sql)).applied, false);

  const counts = await database.query<{ canonicals: string; policies: string }>(`
    SELECT
      (SELECT count(*)::text FROM canonical_fields WHERE status = 'ACTIVE') AS canonicals,
      (SELECT count(*)::text FROM canonical_answer_policies WHERE active) AS policies
  `);
  assert.equal(counts.rows[0]?.canonicals, String(listCandidateAnswerPolicies().length));
  assert.equal(counts.rows[0]?.policies, String(listCandidateAnswerPolicies().length));

  const sponsorship = await database.query<{ canonical_key: string }>(`
    SELECT canonical_key
    FROM canonical_fields
    WHERE canonical_key IN ('SPONSORSHIP', 'SPONSORSHIP_REQUIRED')
  `);
  assert.deepEqual(sponsorship.rows, [{ canonical_key: "SPONSORSHIP_REQUIRED" }]);

  const protectedPolicy = await database.query<{
    answer_class: string;
    reuse_mode: string;
    autofill_mode: string;
    learning_mode: string;
  }>(`
    SELECT p.answer_class, p.reuse_mode, p.autofill_mode, p.learning_mode
    FROM canonical_answer_policies p
    JOIN canonical_fields c ON c.id = p.canonical_id
    WHERE c.canonical_key = 'EEO_DISABILITY' AND p.active
  `);
  assert.deepEqual(protectedPolicy.rows[0], {
    answer_class: "PROTECTED",
    reuse_mode: "NEVER",
    autofill_mode: "FORBIDDEN",
    learning_mode: "NEVER_LEARN"
  });

  const persistedPolicies = await database.query<{
    canonical_key: string;
    answer_class: string;
    reuse_mode: string;
    allowed_scope_types: string[];
    scope_context_dimensions: string[];
    required_context_dimensions: string[];
    freshness_days: number | null;
    risk_tier: string;
    autofill_mode: string;
    learning_mode: string;
    permanent_commit_points: string[];
    review_reuse: string;
    derivation_policy: string;
    sensitivity: string;
    reason_code: string;
  }>(`
    SELECT
      c.canonical_key,
      p.answer_class,
      p.reuse_mode,
      p.allowed_scope_types,
      p.scope_context_dimensions,
      p.required_context_dimensions,
      CASE WHEN p.freshness_interval IS NULL THEN null
           ELSE extract(epoch FROM p.freshness_interval)::integer / 86400 END AS freshness_days,
      p.risk_tier,
      p.autofill_mode,
      p.learning_mode,
      p.permanent_commit_points,
      p.review_reuse,
      p.derivation_policy,
      p.sensitivity,
      p.reason_code
    FROM canonical_answer_policies p
    JOIN canonical_fields c ON c.id = p.canonical_id
    WHERE p.active
    ORDER BY c.canonical_key
  `);
  const persistedKeys = new Set(persistedPolicies.rows.map((row) => row.canonical_key));
  const expectedPolicies = [...listCandidateAnswerPolicies()]
    .filter((policy) => persistedKeys.has(policy.canonicalKey))
    .sort((left, right) => left.canonicalKey.localeCompare(right.canonicalKey));
  assert.equal(persistedPolicies.rows.length, expectedPolicies.length);
  for (const [index, expected] of expectedPolicies.entries()) {
    const actual = persistedPolicies.rows[index];
    assert.deepEqual(actual, {
      canonical_key: expected.canonicalKey,
      answer_class: expected.answerClass,
      reuse_mode: expected.reuseMode,
      allowed_scope_types: expected.allowedScopeTypes,
      scope_context_dimensions: expected.scopeContextDimensions,
      required_context_dimensions: expected.requiredContextDimensions,
      freshness_days: expected.freshnessDays,
      risk_tier: expected.riskTier,
      autofill_mode: expected.autofillMode,
      learning_mode: expected.learningMode,
      permanent_commit_points: expected.permanentCommitPoints,
      review_reuse: expected.reviewReuse,
      derivation_policy: expected.derivationPolicy,
      sensitivity: expected.sensitivity,
      reason_code: expected.reasonCode
    });
  }
  await database.close();
});

test("candidate truth mutation guards require idempotency fingerprints and trusted confirmation", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  await migrateCandidateTruthOntology(sql);
  const first = await migrateCandidateTruthMutationGuards(sql);
  const second = await migrateCandidateTruthMutationGuards(sql);
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);

  const columns = await database.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'candidate_answer_change_sets' AND column_name = 'request_fingerprint')
        OR (table_name = 'candidate_answer_versions' AND column_name = 'date_precision')
      )
    ORDER BY column_name
  `);
  assert.deepEqual(columns.rows, [
    { column_name: "date_precision" },
    { column_name: "request_fingerprint" }
  ]);
  await database.close();
});

test("candidate REVIEW outcome receipts are value-free, immutable, transition-aware and idempotently migrated", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  await migrateCandidateTruthOntology(sql);
  await migrateCandidateTruthMutationGuards(sql);
  await migrateCandidateScopePolicyVectors(sql);
  const first = await migrateCandidateReviewOutcomeProofs(sql);
  const second = await migrateCandidateReviewOutcomeProofs(sql);
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);

  const artifacts = await database.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE (table_name = 'candidate_answer_usage_proofs' AND column_name IN ('final_value_fingerprint', 'operation_id'))
       OR (table_name = 'candidate_answer_change_set_items' AND column_name = 'transition_kind')
    ORDER BY table_name, column_name
  `);
  assert.deepEqual(artifacts.rows, [
    { table_name: "candidate_answer_change_set_items", column_name: "transition_kind" },
    { table_name: "candidate_answer_usage_proofs", column_name: "final_value_fingerprint" },
    { table_name: "candidate_answer_usage_proofs", column_name: "operation_id" }
  ]);
  const forbiddenValueColumns = await database.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM information_schema.columns
    WHERE table_name = 'candidate_answer_usage_proofs'
      AND column_name IN (
        'value_json', 'normalized_value', 'text_value', 'integer_value',
        'decimal_value', 'boolean_value', 'structured_value'
      )
  `);
  assert.equal(forbiddenValueColumns.rows[0]?.count, "0");
  const guards = await database.query<{ relrowsecurity: boolean; trigger_count: string }>(`
    SELECT
      class.relrowsecurity,
      (
        SELECT count(*)::text
        FROM pg_trigger trigger
        WHERE trigger.tgrelid = class.oid AND NOT trigger.tgisinternal
      ) AS trigger_count
    FROM pg_class class
    WHERE class.relname = 'candidate_answer_usage_proofs'
  `);
  assert.deepEqual(guards.rows[0], { relrowsecurity: true, trigger_count: "2" });
  await database.close();
});

test("candidate reversal receipts are immutable, value-free, RLS-protected and idempotently migrated", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  await migrateCandidateTruthOntology(sql);
  await migrateCandidateTruthMutationGuards(sql);
  await migrateCandidateScopePolicyVectors(sql);
  await migrateCandidateReviewOutcomeProofs(sql);
  const first = await migrateCandidateAnswerReversals(sql);
  const second = await migrateCandidateAnswerReversals(sql);
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);

  const artifacts = await database.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE (table_name = 'candidate_answer_versions' AND column_name = 'restores_version_id')
       OR (table_name = 'candidate_answer_change_set_items' AND column_name = 'item_key')
       OR (table_name IN (
          'candidate_answer_reversal_sets',
          'candidate_answer_reversal_items',
          'candidate_answer_reversal_receipts'
       ) AND column_name IN ('operation_type', 'outcome', 'request_fingerprint'))
    ORDER BY table_name, column_name
  `);
  assert.deepEqual(artifacts.rows, [
    { table_name: "candidate_answer_change_set_items", column_name: "item_key" },
    { table_name: "candidate_answer_reversal_items", column_name: "outcome" },
    { table_name: "candidate_answer_reversal_receipts", column_name: "request_fingerprint" },
    { table_name: "candidate_answer_reversal_sets", column_name: "operation_type" },
    { table_name: "candidate_answer_versions", column_name: "restores_version_id" }
  ]);
  const forbidden = await database.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM information_schema.columns
    WHERE table_name IN (
      'candidate_answer_reversal_sets',
      'candidate_answer_reversal_items',
      'candidate_answer_reversal_receipts'
    )
      AND column_name IN (
        'value_json', 'normalized_value', 'value_fingerprint', 'scope_fingerprint',
        'text_value', 'integer_value', 'decimal_value', 'boolean_value', 'structured_value'
      )
  `);
  assert.equal(forbidden.rows[0]?.count, "0");
  const guards = await database.query<{ relname: string; relrowsecurity: boolean; trigger_count: string }>(`
    SELECT
      class.relname,
      class.relrowsecurity,
      (
        SELECT count(*)::text
        FROM pg_trigger trigger
        WHERE trigger.tgrelid = class.oid AND NOT trigger.tgisinternal
      ) AS trigger_count
    FROM pg_class class
    WHERE class.relname IN (
      'candidate_answer_reversal_sets',
      'candidate_answer_reversal_items',
      'candidate_answer_reversal_receipts'
    )
    ORDER BY class.relname
  `);
  assert.deepEqual(guards.rows, [
    { relname: "candidate_answer_reversal_items", relrowsecurity: true, trigger_count: "1" },
    { relname: "candidate_answer_reversal_receipts", relrowsecurity: true, trigger_count: "1" },
    { relname: "candidate_answer_reversal_sets", relrowsecurity: true, trigger_count: "1" }
  ]);
  await database.close();
});

test("candidate-truth import previews are immutable, value-free, RLS-protected and idempotently migrated", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  await migrateCandidateTruthOntology(sql);
  await migrateCandidateTruthMutationGuards(sql);
  await migrateCandidateScopePolicyVectors(sql);
  await migrateCandidateReviewOutcomeProofs(sql);
  await migrateCandidateAnswerReversals(sql);
  const first = await migrateCandidateTruthImportPreviews(sql);
  const second = await migrateCandidateTruthImportPreviews(sql);
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);

  const artifacts = await database.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_name IN (
      'candidate_truth_import_preview_runs',
      'candidate_truth_import_preview_items',
      'candidate_truth_import_preview_receipts'
    )
      AND column_name IN (
        'snapshot_fingerprint', 'decision', 'reason_codes',
        'request_fingerprint', 'already_previewed'
      )
    ORDER BY table_name, column_name
  `);
  assert.deepEqual(artifacts.rows, [
    { table_name: "candidate_truth_import_preview_items", column_name: "decision" },
    { table_name: "candidate_truth_import_preview_items", column_name: "reason_codes" },
    { table_name: "candidate_truth_import_preview_receipts", column_name: "already_previewed" },
    { table_name: "candidate_truth_import_preview_receipts", column_name: "request_fingerprint" },
    { table_name: "candidate_truth_import_preview_runs", column_name: "snapshot_fingerprint" }
  ]);
  const forbidden = await database.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM information_schema.columns
    WHERE table_name IN (
      'candidate_truth_import_preview_runs',
      'candidate_truth_import_preview_items',
      'candidate_truth_import_preview_receipts'
    )
      AND column_name IN (
        'raw_value', 'value_json', 'normalized_value', 'text_value',
        'integer_value', 'decimal_value', 'boolean_value', 'structured_value',
        'source_record_id'
      )
  `);
  assert.equal(forbidden.rows[0]?.count, "0");
  const guards = await database.query<{
    relname: string;
    relrowsecurity: boolean;
    trigger_count: string;
  }>(`
    SELECT
      class.relname,
      class.relrowsecurity,
      (
        SELECT count(*)::text
        FROM pg_trigger trigger
        WHERE trigger.tgrelid = class.oid AND NOT trigger.tgisinternal
      ) AS trigger_count
    FROM pg_class class
    WHERE class.relname IN (
      'candidate_truth_import_preview_runs',
      'candidate_truth_import_preview_items',
      'candidate_truth_import_preview_receipts'
    )
    ORDER BY class.relname
  `);
  assert.deepEqual(guards.rows, [
    { relname: "candidate_truth_import_preview_items", relrowsecurity: true, trigger_count: "1" },
    { relname: "candidate_truth_import_preview_receipts", relrowsecurity: true, trigger_count: "1" },
    { relname: "candidate_truth_import_preview_runs", relrowsecurity: true, trigger_count: "1" }
  ]);
  await database.close();
});

test("candidate-truth import apply state is resumable, value-free, RLS-protected and idempotently migrated", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  await migrateCandidateTruthOntology(sql);
  await migrateCandidateTruthMutationGuards(sql);
  await migrateCandidateScopePolicyVectors(sql);
  await migrateCandidateReviewOutcomeProofs(sql);
  await migrateCandidateAnswerReversals(sql);
  await migrateCandidateTruthImportPreviews(sql);
  const first = await migrateCandidateTruthImportApply(sql);
  const second = await migrateCandidateTruthImportApply(sql);
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);

  const tables = await database.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'candidate_truth_import_apply_runs',
        'candidate_truth_import_apply_batches',
        'candidate_truth_import_apply_batch_items',
        'candidate_truth_import_reconciliations',
        'candidate_truth_import_apply_receipts'
      )
    ORDER BY table_name
  `);
  assert.equal(tables.rows.length, 5);
  const forbidden = await database.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM information_schema.columns
    WHERE table_name IN (
      'candidate_truth_import_apply_runs',
      'candidate_truth_import_apply_batches',
      'candidate_truth_import_apply_batch_items',
      'candidate_truth_import_reconciliations',
      'candidate_truth_import_apply_receipts'
    )
      AND column_name IN (
        'raw_value', 'value_json', 'normalized_value', 'text_value',
        'integer_value', 'decimal_value', 'boolean_value', 'structured_value',
        'source_record_id', 'source_value'
      )
  `);
  assert.equal(forbidden.rows[0]?.count, "0");
  const guards = await database.query<{
    relname: string;
    relrowsecurity: boolean;
    trigger_count: string;
  }>(`
    SELECT
      class.relname,
      class.relrowsecurity,
      (
        SELECT count(*)::text FROM pg_trigger trigger
        WHERE trigger.tgrelid = class.oid AND NOT trigger.tgisinternal
      ) AS trigger_count
    FROM pg_class class
    WHERE class.relname IN (
      'candidate_truth_import_apply_runs',
      'candidate_truth_import_apply_batches',
      'candidate_truth_import_apply_batch_items',
      'candidate_truth_import_reconciliations',
      'candidate_truth_import_apply_receipts'
    )
    ORDER BY class.relname
  `);
  assert.equal(guards.rows.length, 5);
  assert.ok(guards.rows.every((row) => row.relrowsecurity && row.trigger_count === "1"));
  await database.close();
});

test("Phase G onboarding migrations are idempotent, tenant-isolated and keep resume values encrypted", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  await migrateCandidateTruthOntology(sql);
  await migrateCandidateTruthMutationGuards(sql);
  await migrateCandidateScopePolicyVectors(sql);
  await migrateCandidateReviewOutcomeProofs(sql);
  await migrateCandidateAnswerReversals(sql);

  for (const migrate of [
    migrateCandidateOnboardingBootstrap,
    migrateCandidateResumeIntelligence,
    migrateCandidateOnboardingConfirmation,
    migrateCandidateProfileCompletion
  ]) {
    assert.equal((await migrate(sql)).applied, true);
    assert.equal((await migrate(sql)).applied, false);
  }

  const tables = await database.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'candidate_onboarding_states',
        'resume_upload_receipts',
        'resume_extraction_runs',
        'resume_candidate_proposals',
        'candidate_entity_source_keys',
        'candidate_onboarding_confirmation_receipts',
        'candidate_onboarding_completion_receipts'
      )
    ORDER BY table_name
  `);
  assert.equal(tables.rows.length, 7);

  const encryptedProposalColumns = await database.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'resume_candidate_proposals'
      AND column_name IN (
        'encrypted_payload', 'payload_iv', 'payload_auth_tag', 'payload_key_version'
      )
    ORDER BY column_name
  `);
  assert.deepEqual(encryptedProposalColumns.rows, [
    { column_name: "encrypted_payload" },
    { column_name: "payload_auth_tag" },
    { column_name: "payload_iv" },
    { column_name: "payload_key_version" }
  ]);
  const forbiddenValueColumns = await database.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM information_schema.columns
    WHERE table_name IN (
      'resume_upload_receipts',
      'resume_extraction_runs',
      'candidate_onboarding_confirmation_receipts',
      'candidate_onboarding_completion_receipts'
    )
      AND column_name IN (
        'raw_value', 'value_json', 'normalized_value', 'text_value',
        'integer_value', 'decimal_value', 'boolean_value', 'structured_value'
      )
  `);
  assert.equal(forbiddenValueColumns.rows[0]?.count, "0");

  const guards = await database.query<{
    relname: string;
    relrowsecurity: boolean;
    trigger_count: string;
  }>(`
    SELECT
      class.relname,
      class.relrowsecurity,
      (
        SELECT count(*)::text FROM pg_trigger trigger
        WHERE trigger.tgrelid = class.oid AND NOT trigger.tgisinternal
      ) AS trigger_count
    FROM pg_class class
    WHERE class.relname IN (
      'candidate_onboarding_states',
      'resume_upload_receipts',
      'resume_extraction_runs',
      'resume_candidate_proposals',
      'candidate_entity_source_keys',
      'candidate_onboarding_confirmation_receipts',
      'candidate_onboarding_completion_receipts'
    )
    ORDER BY class.relname
  `);
  assert.deepEqual(guards.rows, [
    { relname: "candidate_entity_source_keys", relrowsecurity: true, trigger_count: "1" },
    { relname: "candidate_onboarding_completion_receipts", relrowsecurity: true, trigger_count: "1" },
    { relname: "candidate_onboarding_confirmation_receipts", relrowsecurity: true, trigger_count: "1" },
    { relname: "candidate_onboarding_states", relrowsecurity: true, trigger_count: "0" },
    { relname: "resume_candidate_proposals", relrowsecurity: true, trigger_count: "2" },
    { relname: "resume_extraction_runs", relrowsecurity: true, trigger_count: "0" },
    { relname: "resume_upload_receipts", relrowsecurity: true, trigger_count: "1" }
  ]);
  await database.close();
});

test("FREE subscriptions are account-specific and TEST accounts cannot train globally by default", async () => {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  await migrateCoreEntitlements(sql);

  await database.exec(`
    INSERT INTO accounts (id, account_type, contributes_to_global_learning) VALUES
      ('00000000-0000-4000-8000-000000000001', 'NORMAL', true),
      ('00000000-0000-4000-8000-000000000002', 'NORMAL', true),
      ('00000000-0000-4000-8000-000000000003', 'TEST', false);

    INSERT INTO subscriptions (id, account_id, plan_id, status, starts_at)
    SELECT '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', id, 'FREE', now()
    FROM plans WHERE code = 'FREE';

    INSERT INTO subscriptions (id, account_id, plan_id, status, starts_at)
    SELECT '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000002', id, 'FREE', now()
    FROM plans WHERE code = 'FREE';
  `);

  const count = await database.query<{ count: string }>("SELECT count(*)::text AS count FROM subscriptions");
  assert.equal(count.rows[0]?.count, "2");
  await assert.rejects(
    database.query(`
      INSERT INTO accounts (id, account_type)
      VALUES ('00000000-0000-4000-8000-000000000004', 'TEST')
    `),
    /check constraint/
  );
  await database.close();
});

test("account-owned roots and nested candidate/application state enable RLS", async () => {
  const database = new PGlite();
  await migrateInitialSchema(client(database));
  const result = await database.query<{ relname: string }>(`
    SELECT relname
    FROM pg_class
    WHERE relrowsecurity
      AND relname IN (
        'accounts', 'candidates', 'candidate_answer_versions', 'candidate_answers_current',
        'applications', 'application_runs', 'application_events', 'documents', 'ai_usage_events'
      )
  `);
  assert.equal(result.rows.length, 9);
  await database.close();
});

test("entitlement usage reservation atomically enforces a period limit", async () => {
  const database = new PGlite();
  await migrateInitialSchema(client(database));
  await migrateCoreEntitlements(client(database));
  await database.exec(`
    INSERT INTO accounts (id, account_type, contributes_to_global_learning)
    VALUES ('00000000-0000-4000-8000-000000000101', 'NORMAL', true);

    INSERT INTO subscriptions (id, account_id, plan_id, status, starts_at)
    SELECT
      '00000000-0000-4000-8000-000000000111',
      '00000000-0000-4000-8000-000000000101',
      id,
      'FREE',
      '2026-09-01T00:00:00.000Z'
    FROM plans
    WHERE code = 'FREE';
  `);

  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  const repository = new KyselyEntitlementRepository(kysely);
  const context = await repository.getContext({
    accountId: "00000000-0000-4000-8000-000000000101",
    featureKey: "applications.autofill",
    evaluatedAt: new Date("2026-09-15T12:00:00.000Z"),
    simulatedPlanCode: null
  });
  assert.equal(context.period, "MONTH");

  const reservation = {
    accountId: "00000000-0000-4000-8000-000000000101",
    featureKey: "applications.autofill",
    periodStart: new Date("2026-09-01T00:00:00.000Z"),
    periodEnd: new Date("2026-10-01T00:00:00.000Z"),
    limit: 2
  } as const;
  const first = await repository.consumeUsage({ ...reservation, quantity: 2 });
  const overLimit = await repository.consumeUsage({ ...reservation, quantity: 1 });

  assert.deepEqual(first, { consumed: true, used: 2 });
  assert.deepEqual(overLimit, { consumed: false, used: 2 });
  const counter = await database.query<{ quantity: string }>(`
    SELECT quantity::text AS quantity
    FROM usage_counters
    WHERE account_id = '00000000-0000-4000-8000-000000000101'
  `);
  assert.equal(counter.rows[0]?.quantity, "2");
  await kysely.destroy();
});

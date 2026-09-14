import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  CandidateTruthService,
  HmacCandidateValueFingerprinter,
  HmacLegacyImportFingerprinter,
  LegacyCandidateTruthImportApplyService,
  LegacyCandidateTruthImportPreviewService,
  LegacyImportReconciliationVerifier,
  type LegacyCandidateTruthSource,
  type LegacyImportCandidateTruthWriter
} from "@job-hunter-v2/candidate-truth";
import { Kysely, PGliteDialect } from "kysely";
import {
  KyselyCandidateTruthImportPreviewRepository,
  KyselyCandidateTruthRepository,
  KyselyLegacyImportApplyRepository,
  migrateCandidateAnswerReversals,
  migrateCandidateReviewOutcomeProofs,
  migrateCandidateScopePolicyVectors,
  migrateCandidateTruthImportApply,
  migrateCandidateTruthImportPreviews,
  migrateCandidateTruthMutationGuards,
  migrateCandidateTruthOntology,
  migrateInitialSchema,
  type SqlClient,
  type V2Database
} from "./index.js";

const accountId = "11000000-0000-4000-8000-000000000001";
const candidateId = "21000000-0000-4000-8000-000000000001";
const secondAccountId = "11000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-01T10:00:00.000Z");

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

async function setup() {
  const database = new PGlite();
  const migrationClient = client(database);
  await migrateInitialSchema(migrationClient);
  await migrateCandidateTruthOntology(migrationClient);
  await migrateCandidateTruthMutationGuards(migrationClient);
  await migrateCandidateScopePolicyVectors(migrationClient);
  await migrateCandidateReviewOutcomeProofs(migrationClient);
  await migrateCandidateAnswerReversals(migrationClient);
  await migrateCandidateTruthImportPreviews(migrationClient);
  await migrateCandidateTruthImportApply(migrationClient);
  await migrateGlobalAnswerDefaults(migrationClient);
  await database.exec(`
    INSERT INTO accounts (id, account_type, contributes_to_global_learning) VALUES
      ('${accountId}', 'NORMAL', true),
      ('${secondAccountId}', 'NORMAL', true);
    INSERT INTO candidates (id, account_id, status, created_at, updated_at)
    VALUES ('${candidateId}', '${accountId}', 'ACTIVE', '${now.toISOString()}', '${now.toISOString()}');
  `);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  const valueFingerprinter = new HmacCandidateValueFingerprinter(
    "candidate-value-test-secret-that-is-at-least-32-bytes",
    1
  );
  const importFingerprinter = new HmacLegacyImportFingerprinter(
    "legacy-import-test-secret-that-is-at-least-32-bytes",
    1
  );
  const truth = new CandidateTruthService(
    new KyselyCandidateTruthRepository(kysely),
    valueFingerprinter,
    { now: () => now }
  );
  const preview = new LegacyCandidateTruthImportPreviewService(
    new KyselyCandidateTruthImportPreviewRepository(kysely),
    valueFingerprinter,
    importFingerprinter,
    { now: () => now }
  );
  const applyRepository = new KyselyLegacyImportApplyRepository(kysely);
  const apply = new LegacyCandidateTruthImportApplyService(
    applyRepository,
    truth,
    valueFingerprinter,
    importFingerprinter,
    { now: () => now }
  );
  return {
    database,
    kysely,
    truth,
    preview,
    apply,
    applyRepository,
    valueFingerprinter,
    importFingerprinter
  };
}

function source(
  sourceKind: LegacyCandidateTruthSource["sourceKind"],
  sourceRecordId: string,
  canonicalKey: string,
  rawValue: unknown,
  options: Pick<LegacyCandidateTruthSource, "confirmedAt" | "metadata"> = {}
): LegacyCandidateTruthSource {
  return { sourceKind, sourceRecordId, canonicalKey, rawValue, ...options };
}

function eligibleSources(): LegacyCandidateTruthSource[] {
  return [
    source("CANDIDATE_PROFILE", "profile-full-name", "FULL_NAME", "Asha Sharma", {
      confirmedAt: now
    }),
    source("CANDIDATE_PROFILE", "profile-email", "EMAIL", "asha@example.com", {
      confirmedAt: now
    }),
    source("APPROVED_FACT_MEMORY", "memory-phone", "PHONE", "9876543210", {
      confirmedAt: now,
      metadata: { candidateApproved: true, factScope: "CANDIDATE_PROFILE", countryCode: "IN" }
    })
  ];
}

test("F2 imports only eligible values as REVIEW and explicitly reconciles every preview record", async () => {
  const { database, kysely, preview, apply, applyRepository } = await setup();
  const sources: LegacyCandidateTruthSource[] = [
    ...eligibleSources(),
    source("CANDIDATE_PROFILE", "profile-country", "COUNTRY", "India", { confirmedAt: now }),
    source("CANDIDATE_PROFILE", "profile-relocation-default", "RELOCATION", false, {
      confirmedAt: now,
      metadata: { ambiguousDefault: true }
    }),
    source("CANDIDATE_PROFILE", "profile-invalid-email", "EMAIL", "bad-email", {
      confirmedAt: now
    }),
    source("SHARED_FORM_MEMORY", "shared-form", "FULL_NAME", "Another Candidate"),
    source("CANDIDATE_PROFILE", "profile-sponsorship", "SPONSORSHIP", false, {
      confirmedAt: now
    }),
    source("CANDIDATE_PROFILE", "profile-stale-notice", "NOTICE_PERIOD", 30, {
      confirmedAt: "2025-01-01T00:00:00.000Z"
    })
  ];
  const previewResult = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f2-mixed-preview",
    sources
  });
  const result = await apply.apply({
    accountId,
    candidateId,
    previewRunId: previewResult.previewRunId,
    idempotencyKey: "f2-mixed-apply",
    sources
  });

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.examinedCount, 9);
  assert.deepEqual(result.counts, {
    IMPORTED: 3,
    ALREADY_IMPORTED: 0,
    SKIPPED: 1,
    REVIEW_REQUIRED: 3,
    CONFLICT: 0,
    INVALID: 1,
    UNMAPPABLE: 1
  });
  assert.equal(
    Object.values(result.counts).reduce((sum, count) => sum + count, 0),
    result.examinedCount
  );
  assert.equal(result.reconciliations.length, result.examinedCount);
  const verification = await new LegacyImportReconciliationVerifier(
    applyRepository,
    { now: () => now }
  ).verify({ accountId, candidateId, applyRunId: result.applyRunId });
  assert.deepEqual(verification, {
    candidateId,
    previewRunId: previewResult.previewRunId,
    applyRunId: result.applyRunId,
    verified: true,
    examinedCount: 9,
    terminalCount: 9,
    counts: result.counts,
    importedVersionCount: 3,
    importedChangeSetCount: 1,
    duplicateCurrentAnswerCount: 0,
    violationCodes: [],
    verifiedAt: now
  });

  const versions = await database.query<{
    canonical_key: string;
    source: string;
    trust_state: string;
  }>(`
    SELECT canonical.canonical_key, version.source, version.trust_state
    FROM candidate_answer_versions version
    JOIN canonical_fields canonical ON canonical.id = version.canonical_id
    ORDER BY canonical.canonical_key
  `);
  assert.deepEqual(versions.rows, [
    { canonical_key: "EMAIL", source: "LEGACY_IMPORT", trust_state: "REVIEW" },
    { canonical_key: "FULL_NAME", source: "LEGACY_IMPORT", trust_state: "REVIEW" },
    { canonical_key: "PHONE", source: "LEGACY_IMPORT", trust_state: "REVIEW" }
  ]);
  const projections = await database.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM candidate_answers_current"
  );
  assert.equal(projections.rows[0]?.count, "3");
  const changeSets = await database.query<{ source: string; count: string }>(`
    SELECT source, count(*)::text AS count
    FROM candidate_answer_change_sets GROUP BY source
  `);
  assert.deepEqual(changeSets.rows, [{ source: "LEGACY_IMPORT", count: "1" }]);
  const outbox = await database.query<{ event_type: string; payload_reference: unknown }>(`
    SELECT event_type, payload_reference FROM outbox_events
  `);
  assert.equal(outbox.rows[0]?.event_type, "candidate.answers.legacy_imported");
  const durableAudit = await database.query<{ record: string }>(`
    SELECT row_to_json(run)::text AS record FROM candidate_truth_import_apply_runs run
    UNION ALL SELECT row_to_json(batch)::text FROM candidate_truth_import_apply_batches batch
    UNION ALL SELECT row_to_json(item)::text FROM candidate_truth_import_apply_batch_items item
    UNION ALL SELECT row_to_json(reconciliation)::text FROM candidate_truth_import_reconciliations reconciliation
    UNION ALL SELECT row_to_json(receipt)::text FROM candidate_truth_import_apply_receipts receipt
    UNION ALL SELECT row_to_json(outbox)::text FROM outbox_events outbox
  `);
  const auditText = durableAudit.rows.map((row) => row.record).join("\n");
  for (const privateText of [
    "Asha Sharma",
    "asha@example.com",
    "9876543210",
    "Another Candidate",
    "profile-full-name"
  ]) {
    assert.equal(auditText.includes(privateText), false);
  }
  await kysely.destroy();
});

test("F2 exact replay and same-preview concurrency create no duplicate versions or projections", async () => {
  const { database, kysely, preview, apply } = await setup();
  const sources = eligibleSources();
  const previewResult = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f2-replay-preview",
    sources
  });
  const [first, concurrent] = await Promise.all([
    apply.apply({
      accountId,
      candidateId,
      previewRunId: previewResult.previewRunId,
      idempotencyKey: "f2-concurrent-apply-a",
      sources
    }),
    apply.apply({
      accountId,
      candidateId,
      previewRunId: previewResult.previewRunId,
      idempotencyKey: "f2-concurrent-apply-b",
      sources: [...sources].reverse()
    })
  ]);
  assert.equal(first.applyRunId, concurrent.applyRunId);
  assert.equal(first.status, "COMPLETED");
  assert.equal(concurrent.status, "COMPLETED");
  const replay = await apply.apply({
    accountId,
    candidateId,
    previewRunId: previewResult.previewRunId,
    idempotencyKey: "f2-concurrent-apply-a",
    sources
  });
  assert.equal(replay.applyRunId, first.applyRunId);
  assert.equal(replay.idempotentReplay, true);
  const counts = await database.query<{ versions: string; projections: string; sets: string }>(`
    SELECT
      (SELECT count(*)::text FROM candidate_answer_versions) AS versions,
      (SELECT count(*)::text FROM candidate_answers_current) AS projections,
      (SELECT count(*)::text FROM candidate_answer_change_sets WHERE source = 'LEGACY_IMPORT') AS sets
  `);
  assert.deepEqual(counts.rows[0], { versions: "3", projections: "3", sets: "1" });
  await kysely.destroy();
});

test("F2 resumes after Candidate Truth committed but batch finalization was interrupted", async () => {
  const setupResult = await setup();
  const {
    database,
    kysely,
    preview,
    truth,
    applyRepository,
    valueFingerprinter,
    importFingerprinter
  } = setupResult;
  const sources = eligibleSources();
  const previewResult = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f2-crash-preview",
    sources
  });
  let throwAfterCommit = true;
  const uncertainWriter: LegacyImportCandidateTruthWriter = {
    saveGroup: async (input) => {
      const result = await truth.saveGroup(input);
      if (throwAfterCommit) {
        throwAfterCommit = false;
        throw new Error("SIMULATED_RESPONSE_LOSS_AFTER_COMMIT");
      }
      return result;
    }
  };
  const interrupted = new LegacyCandidateTruthImportApplyService(
    applyRepository,
    uncertainWriter,
    valueFingerprinter,
    importFingerprinter,
    { now: () => now }
  );
  await assert.rejects(
    interrupted.apply({
      accountId,
      candidateId,
      previewRunId: previewResult.previewRunId,
      idempotencyKey: "f2-crash-apply",
      sources
    }),
    /SIMULATED_RESPONSE_LOSS_AFTER_COMMIT/
  );
  const pending = await database.query<{ status: string; versions: string }>(`
    SELECT
      (SELECT status FROM candidate_truth_import_apply_runs LIMIT 1) AS status,
      (SELECT count(*)::text FROM candidate_answer_versions) AS versions
  `);
  assert.deepEqual(pending.rows[0], { status: "PENDING", versions: "3" });
  const pendingVerification = await new LegacyImportReconciliationVerifier(
    applyRepository,
    { now: () => now }
  ).verify({ accountId, candidateId, applyRunId: (await database.query<{ id: string }>(
    "SELECT id FROM candidate_truth_import_apply_runs LIMIT 1"
  )).rows[0]?.id as string });
  assert.equal(pendingVerification.verified, false);
  assert.ok(pendingVerification.violationCodes.includes("APPLY_RUN_NOT_COMPLETED"));

  const recovered = new LegacyCandidateTruthImportApplyService(
    applyRepository,
    truth,
    valueFingerprinter,
    importFingerprinter,
    { now: () => now }
  );
  const result = await recovered.apply({
    accountId,
    candidateId,
    previewRunId: previewResult.previewRunId,
    idempotencyKey: "f2-crash-apply",
    sources
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.counts.IMPORTED, 3);
  const after = await database.query<{ versions: string; projections: string; sets: string }>(`
    SELECT
      (SELECT count(*)::text FROM candidate_answer_versions) AS versions,
      (SELECT count(*)::text FROM candidate_answers_current) AS projections,
      (SELECT count(*)::text FROM candidate_answer_change_sets WHERE source = 'LEGACY_IMPORT') AS sets
  `);
  assert.deepEqual(after.rows[0], { versions: "3", projections: "3", sets: "1" });
  await kysely.destroy();
});

test("F2 fails closed on snapshot drift, cross-tenant access and unsafe legacy trust escalation", async () => {
  const { database, kysely, truth, preview, apply } = await setup();
  const sources = eligibleSources();
  const previewResult = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f2-fail-closed-preview",
    sources
  });
  await assert.rejects(
    apply.apply({
      accountId,
      candidateId,
      previewRunId: previewResult.previewRunId,
      idempotencyKey: "f2-drifted-apply",
      sources: [
        ...sources.slice(0, 1),
        source("CANDIDATE_PROFILE", "profile-email", "EMAIL", "changed@example.com", {
          confirmedAt: now
        }),
        ...sources.slice(2)
      ]
    }),
    /snapshot no longer matches/
  );
  await assert.rejects(
    apply.apply({
      accountId: secondAccountId,
      candidateId,
      previewRunId: previewResult.previewRunId,
      idempotencyKey: "f2-cross-tenant-apply",
      sources
    }),
    /Active candidate was not found/
  );
  await assert.rejects(
    truth.saveGroup({
      accountId,
      candidateId,
      commitPoint: "LEGACY_IMPORT",
      idempotencyKey: "legacy-legal-forbidden",
      items: [{
        itemKey: "legal",
        canonicalKey: "SPONSORSHIP_REQUIRED",
        normalizedValue: {
          schemaVersion: 1,
          dataClass: "CANDIDATE_PRIVATE",
          kind: "BOOLEAN",
          value: false
        },
        scopeType: "GLOBAL",
        source: "LEGACY_IMPORT",
        expectedCurrentVersionId: null
      }]
    }),
    /not safe for automatic legacy import/
  );
  const noApply = await database.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM candidate_truth_import_apply_runs"
  );
  assert.equal(noApply.rows[0]?.count, "0");
  await kysely.destroy();
});

test("F4 isolates a newer V2 conflict while importing unrelated legacy values", async () => {
  const { database, kysely, truth, preview, apply, applyRepository } = await setup();
  const sources = eligibleSources();
  const previewResult = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f4-race-preview",
    sources
  });
  const newer = await truth.save({
    accountId,
    candidateId,
    canonicalKey: "FULL_NAME",
    normalizedValue: {
      schemaVersion: 1,
      dataClass: "CANDIDATE_PRIVATE",
      kind: "STRING",
      value: "Candidate chose a newer name"
    },
    scopeType: "GLOBAL",
    source: "USER_MANUAL",
    commitPoint: "EXPLICIT_SAVE",
    expectedCurrentVersionId: null,
    idempotencyKey: "f4-newer-v2-name"
  });

  const result = await apply.apply({
    accountId,
    candidateId,
    previewRunId: previewResult.previewRunId,
    idempotencyKey: "f4-race-apply",
    sources
  });
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(result.counts, {
    IMPORTED: 2,
    ALREADY_IMPORTED: 0,
    SKIPPED: 0,
    REVIEW_REQUIRED: 0,
    CONFLICT: 1,
    INVALID: 0,
    UNMAPPABLE: 0
  });
  const conflict = result.reconciliations.find((item) => item.outcome === "CONFLICT");
  assert.ok(conflict?.reasonCodes.includes("V2_TRUTH_CHANGED_DURING_APPLY"));
  const state = await database.query<{
    canonical_key: string;
    source: string;
    trust_state: string;
  }>(`
    SELECT canonical.canonical_key, version.source, version.trust_state
    FROM candidate_answers_current current_answer
    JOIN candidate_answer_versions version ON version.id = current_answer.answer_version_id
    JOIN canonical_fields canonical ON canonical.id = current_answer.canonical_id
    WHERE current_answer.candidate_id = '${candidateId}'
    ORDER BY canonical.canonical_key
  `);
  assert.deepEqual(state.rows, [
    {
      canonical_key: "EMAIL",
      source: "LEGACY_IMPORT",
      trust_state: "REVIEW"
    },
    {
      canonical_key: "FULL_NAME",
      source: "USER_MANUAL",
      trust_state: "TRUSTED"
    },
    {
      canonical_key: "PHONE",
      source: "LEGACY_IMPORT",
      trust_state: "REVIEW"
    }
  ]);
  assert.equal(
    state.rows.find((row) => row.canonical_key === "FULL_NAME")?.source,
    "USER_MANUAL"
  );
  assert.ok(newer.answerVersionId);
  const verification = await new LegacyImportReconciliationVerifier(
    applyRepository,
    { now: () => now }
  ).verify({ accountId, candidateId, applyRunId: result.applyRunId });
  assert.equal(verification.verified, true);
  assert.equal(verification.importedVersionCount, 2);
  await kysely.destroy();
});

test("F4 recovers a durable pending run after failure before Candidate Truth mutation", async () => {
  const setupResult = await setup();
  const {
    database,
    kysely,
    truth,
    preview,
    applyRepository,
    valueFingerprinter,
    importFingerprinter
  } = setupResult;
  const sources = eligibleSources();
  const previewResult = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f4-precommit-preview",
    sources
  });
  const unavailableWriter: LegacyImportCandidateTruthWriter = {
    saveGroup: async () => {
      throw new Error("SIMULATED_INFRASTRUCTURE_FAILURE_BEFORE_COMMIT");
    }
  };
  const interrupted = new LegacyCandidateTruthImportApplyService(
    applyRepository,
    unavailableWriter,
    valueFingerprinter,
    importFingerprinter,
    { now: () => now }
  );
  await assert.rejects(
    interrupted.apply({
      accountId,
      candidateId,
      previewRunId: previewResult.previewRunId,
      idempotencyKey: "f4-precommit-apply",
      sources
    }),
    /SIMULATED_INFRASTRUCTURE_FAILURE_BEFORE_COMMIT/
  );
  const interruptedState = await database.query<{ runs: string; versions: string; reconciliations: string }>(`
    SELECT
      (SELECT count(*)::text FROM candidate_truth_import_apply_runs WHERE status = 'PENDING') AS runs,
      (SELECT count(*)::text FROM candidate_answer_versions) AS versions,
      (SELECT count(*)::text FROM candidate_truth_import_reconciliations) AS reconciliations
  `);
  assert.deepEqual(interruptedState.rows[0], {
    runs: "1",
    versions: "0",
    reconciliations: "0"
  });

  const recovered = await new LegacyCandidateTruthImportApplyService(
    applyRepository,
    truth,
    valueFingerprinter,
    importFingerprinter,
    { now: () => now }
  ).apply({
    accountId,
    candidateId,
    previewRunId: previewResult.previewRunId,
    idempotencyKey: "f4-precommit-apply",
    sources
  });
  assert.equal(recovered.status, "COMPLETED");
  assert.equal(recovered.counts.IMPORTED, 3);
  const finalState = await database.query<{ versions: string; projections: string; pending: string }>(`
    SELECT
      (SELECT count(*)::text FROM candidate_answer_versions) AS versions,
      (SELECT count(*)::text FROM candidate_answers_current) AS projections,
      (SELECT count(*)::text FROM candidate_truth_import_apply_runs WHERE status = 'PENDING') AS pending
  `);
  assert.deepEqual(finalState.rows[0], { versions: "3", projections: "3", pending: "0" });
  await kysely.destroy();
});

test("F4 recognizes equivalent truth on a later export and creates no duplicate Candidate Truth", async () => {
  const { database, kysely, preview, apply } = await setup();
  const sources = eligibleSources();
  const firstPreview = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f4-first-preview",
    sources
  });
  const first = await apply.apply({
    accountId,
    candidateId,
    previewRunId: firstPreview.previewRunId,
    idempotencyKey: "f4-first-apply",
    sources
  });
  assert.equal(first.counts.IMPORTED, 3);

  const laterSources = sources.map((item) => ({
    ...item,
    confirmedAt: new Date(now.getTime() - 1_000)
  }));
  const laterPreview = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f4-later-preview",
    sources: laterSources
  });
  assert.notEqual(laterPreview.previewRunId, firstPreview.previewRunId);
  assert.equal(laterPreview.counts.ALREADY_PRESENT, 3);
  const later = await apply.apply({
    accountId,
    candidateId,
    previewRunId: laterPreview.previewRunId,
    idempotencyKey: "f4-later-apply",
    sources: laterSources
  });
  assert.deepEqual(later.counts, {
    IMPORTED: 0,
    ALREADY_IMPORTED: 3,
    SKIPPED: 0,
    REVIEW_REQUIRED: 0,
    CONFLICT: 0,
    INVALID: 0,
    UNMAPPABLE: 0
  });
  const counts = await database.query<{ versions: string; projections: string; legacy_sets: string }>(`
    SELECT
      (SELECT count(*)::text FROM candidate_answer_versions) AS versions,
      (SELECT count(*)::text FROM candidate_answers_current) AS projections,
      (SELECT count(*)::text FROM candidate_answer_change_sets WHERE source = 'LEGACY_IMPORT') AS legacy_sets
  `);
  assert.deepEqual(counts.rows[0], { versions: "3", projections: "3", legacy_sets: "1" });
  await kysely.destroy();
});

test("F4 legacy import rolls back through E4 Undo and import audit remains immutable", async () => {
  const { database, kysely, truth, preview, apply, applyRepository } = await setup();
  const sources = eligibleSources();
  const previewResult = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f4-undo-preview",
    sources
  });
  const imported = await apply.apply({
    accountId,
    candidateId,
    previewRunId: previewResult.previewRunId,
    idempotencyKey: "f4-undo-apply",
    sources
  });
  const changeSetIds = new Set(
    imported.reconciliations
      .map((item) => item.candidateChangeSetId)
      .filter((id): id is string => Boolean(id))
  );
  assert.equal(changeSetIds.size, 1);
  const [targetChangeSetId] = changeSetIds;
  assert.ok(targetChangeSetId);
  const undone = await truth.undoChangeSet({
    accountId,
    candidateId,
    targetChangeSetId,
    idempotencyKey: "f4-undo-imported-group"
  });
  assert.deepEqual(undone.summary, { restored: 0, forgotten: 3, skippedNewerVersion: 0 });

  const replay = await apply.apply({
    accountId,
    candidateId,
    previewRunId: previewResult.previewRunId,
    idempotencyKey: "f4-undo-apply",
    sources
  });
  assert.equal(replay.applyRunId, imported.applyRunId);
  assert.equal(replay.idempotentReplay, true);
  const state = await database.query<{ versions: string; removed: string; legacy_sets: string }>(`
    SELECT
      (SELECT count(*)::text FROM candidate_answer_versions) AS versions,
      (SELECT count(*)::text
       FROM candidate_answers_current current_answer
       JOIN candidate_answer_versions version ON version.id = current_answer.answer_version_id
       WHERE version.trust_state = 'REMOVED') AS removed,
      (SELECT count(*)::text FROM candidate_answer_change_sets WHERE source = 'LEGACY_IMPORT') AS legacy_sets
  `);
  assert.deepEqual(state.rows[0], { versions: "6", removed: "3", legacy_sets: "1" });
  const afterUndoVerification = await new LegacyImportReconciliationVerifier(
    applyRepository,
    { now: () => now }
  ).verify({ accountId, candidateId, applyRunId: imported.applyRunId });
  assert.equal(afterUndoVerification.verified, false);
  assert.ok(afterUndoVerification.violationCodes.includes("IMPORTED_CANDIDATE_TRUTH_INTEGRITY_INVALID"));

  const reconciliationId = imported.reconciliations[0]?.reconciliationId as string;
  await assert.rejects(
    database.exec(`UPDATE candidate_truth_import_reconciliations SET reason_codes = ARRAY['TAMPERED'] WHERE id = '${reconciliationId}'`),
    /candidate truth import previews are immutable/i
  );
  await assert.rejects(
    database.exec(`DELETE FROM candidate_truth_import_apply_receipts WHERE apply_run_id = '${imported.applyRunId}'`),
    /candidate truth import previews are immutable/i
  );
  await assert.rejects(
    database.exec(`DELETE FROM candidate_truth_import_apply_runs WHERE id = '${imported.applyRunId}'`),
    /candidate truth import apply runs cannot be deleted/i
  );
  await kysely.destroy();
});

test("F4 malformed non-JSON legacy values fail before creating preview or apply audit", async () => {
  const { database, kysely, preview } = await setup();
  await assert.rejects(
    preview.preview({
      accountId,
      candidateId,
      idempotencyKey: "f4-malformed-preview",
      sources: [source("CANDIDATE_PROFILE", "malformed", "FULL_NAME", new Date())]
    }),
    /bounded JSON-compatible data/i
  );
  const counts = await database.query<{ previews: string; applies: string }>(`
    SELECT
      (SELECT count(*)::text FROM candidate_truth_import_preview_runs) AS previews,
      (SELECT count(*)::text FROM candidate_truth_import_apply_runs) AS applies
  `);
  assert.deepEqual(counts.rows[0], { previews: "0", applies: "0" });
  await kysely.destroy();
});
import { migrateGlobalAnswerDefaults } from "./index.js";

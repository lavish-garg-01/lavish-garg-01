import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  CandidateTruthService,
  HmacCandidateValueFingerprinter,
  HmacLegacyImportFingerprinter,
  LegacyCandidateTruthImportPreviewService,
  type LegacyCandidateTruthSource
} from "@job-hunter-v2/candidate-truth";
import { Kysely, PGliteDialect } from "kysely";
import {
  KyselyCandidateTruthImportPreviewRepository,
  KyselyCandidateTruthRepository,
  migrateCandidateAnswerReversals,
  migrateCandidateReviewOutcomeProofs,
  migrateCandidateScopePolicyVectors,
  migrateCandidateTruthImportPreviews,
  migrateCandidateTruthMutationGuards,
  migrateCandidateTruthOntology,
  migrateInitialSchema,
  type SqlClient,
  type V2Database
} from "./index.js";

const accountId = "10000000-0000-4000-8000-000000000001";
const candidateId = "20000000-0000-4000-8000-000000000001";
const secondAccountId = "10000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-01T10:00:00.000Z");
const privateValue = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };

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
  const repository = new KyselyCandidateTruthImportPreviewRepository(kysely);
  const preview = new LegacyCandidateTruthImportPreviewService(
    repository,
    valueFingerprinter,
    new HmacLegacyImportFingerprinter("legacy-import-test-secret-that-is-at-least-32-bytes", 1),
    { now: () => now }
  );
  const truth = new CandidateTruthService(
    new KyselyCandidateTruthRepository(kysely),
    valueFingerprinter,
    { now: () => now }
  );
  return { database, kysely, preview, truth };
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

test("F1 classifies V1 sources fail-closed and persists a value-free preview only", async () => {
  const { database, kysely, preview } = await setup();
  const sources: LegacyCandidateTruthSource[] = [
    source("CANDIDATE_PROFILE", "profile-name-private-id", "FULL_NAME", "Asha Sharma", {
      confirmedAt: now
    }),
    source("APPROVED_FACT_MEMORY", "memory-email-private-id", "EMAIL", "asha@example.com", {
      confirmedAt: now,
      metadata: { candidateApproved: true, factScope: "CANDIDATE_PROFILE" }
    }),
    source("CANDIDATE_PROFILE", "profile-invalid-email", "EMAIL", "not-an-email", {
      confirmedAt: now
    }),
    source("CANDIDATE_PROFILE", "profile-relocation-default", "RELOCATION", false, {
      confirmedAt: now,
      metadata: { ambiguousDefault: true }
    }),
    source("CANDIDATE_ANSWER", "answer-ai-summary", "PERSONAL_SUMMARY", "generated private summary", {
      confirmedAt: now,
      metadata: { answerSource: "AI_GENERATED", confidence: 0.99 }
    }),
    source("SHARED_FORM_MEMORY", "shared-form-answer", "FULL_NAME", "another candidate"),
    source("CANDIDATE_PROFILE", "profile-country", "COUNTRY", "India", { confirmedAt: now }),
    source("MASTER_RESUME", "resume-title", "CURRENT_JOB_TITLE", "Staff Engineer", {
      confirmedAt: now,
      metadata: { resumeCandidateConfirmed: false }
    }),
    source("V1_VERSIONED_TRUTH", "version-context", "CURRENT_COMPANY", "Private Co", {
      confirmedAt: now,
      metadata: { versionStatus: "ACTIVE", trustState: "TRUSTED", scopeKind: "CONTEXTUAL" }
    }),
    source("V1_VERSIONED_TRUTH", "version-entity", "EMPLOYMENT_COMPANY", "Private Employer", {
      confirmedAt: now,
      metadata: { versionStatus: "ACTIVE", trustState: "TRUSTED", scopeKind: "ENTITY" }
    }),
    source("CANDIDATE_PROFILE", "profile-sponsorship", "SPONSORSHIP", false, {
      confirmedAt: now
    }),
    source("CANDIDATE_PROFILE", "profile-stale-notice", "NOTICE_PERIOD", 30, {
      confirmedAt: "2025-01-01T00:00:00.000Z"
    }),
    source("APPROVED_FACT_MEMORY", "memory-phone", "PHONE", "9876543210", {
      confirmedAt: now,
      metadata: {
        candidateApproved: false,
        factScope: "CANDIDATE_PROFILE",
        countryCode: "IN"
      }
    }),
    source("CANDIDATE_PROFILE", "profile-start-date", "START_DATE", "2026-10-01", {
      confirmedAt: now
    })
  ];

  const result = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f1-preview-comprehensive",
    sources
  });
  assert.equal(result.sourceCount, 14);
  assert.deepEqual(result.counts, {
    ELIGIBLE: 3,
    REVIEW_REQUIRED: 7,
    SKIPPED: 3,
    CONFLICT: 0,
    INVALID: 1,
    ALREADY_PRESENT: 0
  });
  assert.equal(result.candidateTruthMutated, false);
  assert.equal(result.migrated, 0);
  assert.equal(result.productionCutover, false);
  assert.equal(
    result.items.find((item) => item.sourceCanonicalKey === "SPONSORSHIP")?.targetCanonicalKey,
    "SPONSORSHIP_REQUIRED"
  );

  const answerCount = await database.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM candidate_answer_versions"
  );
  assert.equal(answerCount.rows[0]?.count, "0");
  const persisted = await database.query<Record<string, unknown>>(`
    SELECT row_to_json(run)::text AS record FROM candidate_truth_import_preview_runs run
    UNION ALL
    SELECT row_to_json(item)::text AS record FROM candidate_truth_import_preview_items item
    UNION ALL
    SELECT row_to_json(receipt)::text AS record FROM candidate_truth_import_preview_receipts receipt
  `);
  const auditText = persisted.rows.map((row) => row.record).join("\n");
  for (const secret of [
    "Asha Sharma",
    "asha@example.com",
    "generated private summary",
    "Private Co",
    "profile-name-private-id"
  ]) {
    assert.equal(auditText.includes(secret), false);
  }
  await kysely.destroy();
});

test("F1 reconciles equivalent, conflicting and existing V2 truth without priority guessing", async () => {
  const { kysely, preview, truth } = await setup();
  const equivalent = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f1-equivalent-sources",
    sources: [
      source("CANDIDATE_PROFILE", "profile-same-name", "FULL_NAME", "Asha Sharma", {
        confirmedAt: now
      }),
      source("MASTER_RESUME", "resume-same-name", "FULL_NAME", "Asha Sharma", {
        confirmedAt: now,
        metadata: { resumeCandidateConfirmed: true }
      })
    ]
  });
  assert.equal(equivalent.counts.ELIGIBLE, 1);
  assert.equal(equivalent.counts.SKIPPED, 1);
  assert.equal(
    equivalent.items.find((item) => item.decision === "ELIGIBLE")?.sourceKind,
    "CANDIDATE_PROFILE"
  );

  const conflict = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f1-conflicting-sources",
    sources: [
      source("V1_VERSIONED_TRUTH", "v1-name-a", "FULL_NAME", "Asha Sharma", {
        confirmedAt: now,
        metadata: { versionStatus: "ACTIVE", trustState: "TRUSTED", scopeKind: "GLOBAL" }
      }),
      source("CANDIDATE_PROFILE", "profile-name-b", "FULL_NAME", "Asha Singh", {
        confirmedAt: now
      })
    ]
  });
  assert.equal(conflict.counts.CONFLICT, 2);
  assert.ok(conflict.items.every((item) => item.reasonCodes.includes("NON_EQUIVALENT_LEGACY_SOURCES")));

  const saved = await truth.save({
    accountId,
    candidateId,
    canonicalKey: "FULL_NAME",
    normalizedValue: { ...privateValue, kind: "STRING", value: "Asha Sharma" },
    scopeType: "GLOBAL",
    source: "USER_MANUAL",
    commitPoint: "EXPLICIT_SAVE",
    expectedCurrentVersionId: null,
    idempotencyKey: "explicit-v2-name"
  });
  const alreadyPresent = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f1-existing-equivalent",
    sources: [
      source("CANDIDATE_PROFILE", "profile-existing-name", "FULL_NAME", "Asha Sharma", {
        confirmedAt: now
      })
    ]
  });
  assert.equal(alreadyPresent.counts.ALREADY_PRESENT, 1);
  assert.equal(alreadyPresent.items[0]?.existingAnswerVersionId, saved.answerVersionId);

  const wouldOverwrite = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f1-existing-different",
    sources: [
      source("CANDIDATE_PROFILE", "profile-new-name", "FULL_NAME", "Asha Singh", {
        confirmedAt: now
      })
    ]
  });
  assert.equal(wouldOverwrite.counts.CONFLICT, 1);
  assert.deepEqual(wouldOverwrite.items[0]?.reasonCodes, ["ACTIVE_V2_TRUTH_WOULD_BE_OVERWRITTEN"]);
  await kysely.destroy();
});

test("F1 preview is order-independent, snapshot-idempotent and tenant-isolated", async () => {
  const { database, kysely, preview } = await setup();
  const sources = [
    source("CANDIDATE_PROFILE", "source-a", "FULL_NAME", "Asha Sharma", { confirmedAt: now }),
    source("CANDIDATE_PROFILE", "source-b", "EMAIL", "asha@example.com", { confirmedAt: now })
  ];
  const first = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f1-idempotent-preview",
    sources
  });
  const replay = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f1-idempotent-preview",
    sources: [...sources].reverse()
  });
  assert.equal(replay.previewRunId, first.previewRunId);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.alreadyPreviewed, false);

  const alias = await preview.preview({
    accountId,
    candidateId,
    idempotencyKey: "f1-same-snapshot-new-key",
    sources
  });
  assert.equal(alias.previewRunId, first.previewRunId);
  assert.equal(alias.idempotentReplay, false);
  assert.equal(alias.alreadyPreviewed, true);

  await assert.rejects(
    preview.preview({
      accountId,
      candidateId,
      idempotencyKey: "f1-idempotent-preview",
      sources: [source("CANDIDATE_PROFILE", "source-a", "FULL_NAME", "Different Person", { confirmedAt: now })]
    }),
    /idempotency key was reused with different input/
  );
  await assert.rejects(
    preview.preview({
      accountId: secondAccountId,
      candidateId,
      idempotencyKey: "f1-cross-tenant",
      sources: []
    }),
    /Active candidate was not found/
  );

  await assert.rejects(
    database.exec(`UPDATE candidate_truth_import_preview_runs SET status = 'PREVIEWED' WHERE id = '${first.previewRunId}'`),
    /candidate truth import previews are immutable/
  );
  await assert.rejects(
    database.exec(`DELETE FROM candidate_truth_import_preview_items WHERE preview_run_id = '${first.previewRunId}'`),
    /candidate truth import previews are immutable/
  );
  await kysely.destroy();
});

test("F1 rejects duplicate source identities before any audit write", async () => {
  const { database, kysely, preview } = await setup();
  await assert.rejects(
    preview.preview({
      accountId,
      candidateId,
      idempotencyKey: "f1-duplicate-identities",
      sources: [
        source("CANDIDATE_PROFILE", "duplicate-id", "FULL_NAME", "Asha Sharma", { confirmedAt: now }),
        source("CANDIDATE_PROFILE", "duplicate-id", "EMAIL", "asha@example.com", { confirmedAt: now })
      ]
    }),
    /source identities must be unique/
  );
  const count = await database.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM candidate_truth_import_preview_runs"
  );
  assert.equal(count.rows[0]?.count, "0");
  await kysely.destroy();
});
import { migrateGlobalAnswerDefaults } from "./index.js";

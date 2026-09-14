import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  CandidateTruthService,
  CandidateTruthResolver,
  HmacCandidateValueFingerprinter,
  canonicalNormalizedValueJson
} from "@job-hunter-v2/candidate-truth";
import { Kysely, PGliteDialect } from "kysely";
import {
  KyselyCandidateTruthRepository,
  migrateCandidateAnswerReversals,
  migrateCandidateReviewOutcomeProofs,
  migrateCandidateScopePolicyVectors,
  migrateCandidateTruthMutationGuards,
  migrateCandidateTruthOntology,
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

const accountId = "20000000-0000-4000-8000-000000000001";
const candidateId = "20000000-0000-4000-8000-000000000002";
const secondAccountId = "20000000-0000-4000-8000-000000000003";
const secondCandidateId = "20000000-0000-4000-8000-000000000004";
const now = new Date("2026-09-01T12:00:00.000Z");
const applicationId = "20000000-0000-4000-8000-000000000010";
const runId = "20000000-0000-4000-8000-000000000011";
const checkpointId = "20000000-0000-4000-8000-000000000012";
const privateValue = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };

function money(amountExact: string) {
  return {
    ...privateValue,
    kind: "MONEY" as const,
    amountExact,
    currency: "INR",
    period: "YEAR" as const
  };
}

function testUuid(serial: number): string {
  return `20000000-0000-4000-8000-${serial.toString(16).padStart(12, "0")}`;
}

async function startApplicationRun(database: PGlite, serial: number, jobId: string | null = null) {
  const active = {
    applicationId: testUuid(serial),
    runId: testUuid(serial + 1)
  };
  await database.exec(`
    INSERT INTO applications (id, account_id, candidate_id, job_id, target_url, status)
    VALUES (
      '${active.applicationId}', '${accountId}', '${candidateId}',
      ${jobId ? `'${jobId}'` : "NULL"},
      'https://example.test/application/${serial}', 'IN_PROGRESS'
    );
    INSERT INTO application_runs (
      id, application_id, protocol_version, extension_version, status, last_sequence
    ) VALUES (
      '${active.runId}', '${active.applicationId}', 1, 'test', 'ACTIVE', 0
    );
  `);
  return active;
}

async function createJobContext(
  database: PGlite,
  serial: number,
  input: { countryCode?: string; roleFamily?: string } = {}
) {
  const companyId = testUuid(serial);
  const jobId = testUuid(serial + 1);
  const countryCode = input.countryCode ?? "IN";
  const roleFamily = input.roleFamily ?? "BACKEND";
  await database.exec(`
    INSERT INTO companies (id, canonical_name, normalized_name, website_domain)
    VALUES ('${companyId}', 'Company ${serial}', 'company-${serial}', 'company-${serial}.test');
    INSERT INTO jobs (
      id, company_id, canonical_title, normalized_title, country_code, role_family,
      status, material_fingerprint, first_seen_at, last_seen_at
    ) VALUES (
      '${jobId}', '${companyId}', 'Software Engineer', 'software engineer',
      '${countryCode}', '${roleFamily}', 'ACTIVE', '${createHash("sha256").update(jobId).digest("hex")}',
      '${now.toISOString()}', '${now.toISOString()}'
    );
  `);
  return { companyId, jobId, countryCode, roleFamily };
}

async function addRunCheckpoint(
  database: PGlite,
  active: { applicationId: string; runId: string },
  serial: number,
  input: {
    checkpointType?: "REVIEW_REACHED" | "SUBMISSION";
    checkpointStatus?: "OBSERVED" | "VERIFIED" | "REJECTED";
  } = {}
) {
  const checkpointId = testUuid(serial);
  const checkpointType = input.checkpointType ?? "SUBMISSION";
  const checkpointStatus = input.checkpointStatus ?? "VERIFIED";
  const evidenceHash = createHash("sha256")
    .update(JSON.stringify({ active, serial, checkpointType, checkpointStatus }))
    .digest("hex");
  await database.exec(`
    INSERT INTO application_checkpoints (
      id, application_id, run_id, checkpoint_type, status, evidence_hash, observed_at
    ) VALUES (
      '${checkpointId}', '${active.applicationId}', '${active.runId}',
      '${checkpointType}', '${checkpointStatus}', '${evidenceHash}', '${now.toISOString()}'
    );
  `);
  return checkpointId;
}

async function completeApplicationRun(
  database: PGlite,
  active: { applicationId: string; runId: string },
  checkpointSerial: number,
  checkpoint: Parameters<typeof addRunCheckpoint>[3] = {}
) {
  await database.exec(`
    UPDATE applications
    SET status = 'SUBMITTED', submitted_at = '${now.toISOString()}', updated_at = '${now.toISOString()}'
    WHERE id = '${active.applicationId}';
    UPDATE application_runs
    SET status = 'COMPLETED', ended_at = '${now.toISOString()}'
    WHERE id = '${active.runId}';
  `);
  return {
    ...active,
    checkpointId: await addRunCheckpoint(database, active, checkpointSerial, checkpoint)
  };
}

async function setup() {
  const database = new PGlite();
  const sql = client(database);
  await migrateInitialSchema(sql);
  await migrateCandidateTruthOntology(sql);
  await migrateCandidateTruthMutationGuards(sql);
  await migrateCandidateScopePolicyVectors(sql);
  await migrateCandidateReviewOutcomeProofs(sql);
  await migrateCandidateAnswerReversals(sql);
  await migrateGlobalAnswerDefaults(sql);
  await database.exec(`
    INSERT INTO accounts (id, account_type, contributes_to_global_learning) VALUES
      ('${accountId}', 'NORMAL', true),
      ('${secondAccountId}', 'NORMAL', true);
  `);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  const repository = new KyselyCandidateTruthRepository(kysely);
  const service = new CandidateTruthService(
    repository,
    new HmacCandidateValueFingerprinter("test-secret-key-that-is-at-least-32-bytes", 1),
    { now: () => now }
  );
  await service.ensureCandidate({ accountId, candidateId });
  await service.ensureCandidate({ accountId: secondAccountId, candidateId: secondCandidateId });
  await database.exec(`
    INSERT INTO applications (id, account_id, candidate_id, target_url, status, submitted_at)
    VALUES (
      '${applicationId}', '${accountId}', '${candidateId}',
      'https://example.test/application', 'SUBMITTED', '${now.toISOString()}'
    );
    INSERT INTO application_runs (
      id, application_id, protocol_version, extension_version, status, ended_at
    ) VALUES (
      '${runId}', '${applicationId}', 1, 'test', 'COMPLETED', '${now.toISOString()}'
    );
    INSERT INTO application_checkpoints (
      id, application_id, run_id, checkpoint_type, status, evidence_hash, observed_at
    ) VALUES (
      '${checkpointId}', '${applicationId}', '${runId}', 'SUBMISSION', 'VERIFIED',
      '${"a".repeat(64)}', '${now.toISOString()}'
    );
  `);
  return {
    database,
    kysely,
    repository,
    service,
    verifiedSubmission: { applicationId, runId, checkpointId }
  };
}

async function createExpectedCtcReview(
  service: CandidateTruthService,
  receipt: { applicationId: string; checkpointId: string },
  input: {
    amountExact?: string;
    source?: "USER_MANUAL" | "USER_CORRECTION" | "PROFILE";
    expectedCurrentVersionId?: string | null;
    idempotencyKey: string;
  }
) {
  return service.save({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    normalizedValue: money(input.amountExact ?? "2400000"),
    scopeType: "GLOBAL",
    source: input.source ?? "USER_CORRECTION",
    commitPoint: "VERIFIED_SUBMISSION",
    applicationId: receipt.applicationId,
    checkpointId: receipt.checkpointId,
    expectedCurrentVersionId: input.expectedCurrentVersionId ?? null,
    idempotencyKey: input.idempotencyKey
  });
}

test("candidate answer mutation is append-only, current-projected, idempotent and value-safe", async () => {
  const { database, kysely, repository, service, verifiedSubmission } = await setup();
  const firstInput = {
    accountId,
    candidateId,
    canonicalKey: "EMAIL",
    normalizedValue: { ...privateValue, kind: "STRING" as const, value: "asha@example.com" },
    scopeType: "GLOBAL" as const,
    source: "USER_MANUAL" as const,
    commitPoint: "VERIFIED_SUBMISSION" as const,
    applicationId: verifiedSubmission.applicationId,
    checkpointId: verifiedSubmission.checkpointId,
    expectedCurrentVersionId: null,
    idempotencyKey: "candidate-email-create-v1"
  };
  const first = await service.save(firstInput);
  assert.equal(first.trustState, "TRUSTED");
  assert.equal(first.idempotentReplay, false);

  const replay = await service.save(firstInput);
  assert.equal(replay.answerVersionId, first.answerVersionId);
  assert.equal(replay.changeSetId, first.changeSetId);
  assert.equal(replay.idempotentReplay, true);

  await assert.rejects(
    service.save({
      ...firstInput,
      normalizedValue: { ...privateValue, kind: "STRING", value: "different@example.com" }
    }),
    (error: unknown) =>
      error instanceof Error && error.name === "AppError" && "code" in error && error.code === "IDEMPOTENCY_CONFLICT"
  );

  const second = await service.save({
    ...firstInput,
    normalizedValue: { ...privateValue, kind: "STRING", value: "asha.new@example.com" },
    expectedCurrentVersionId: first.answerVersionId,
    idempotencyKey: "candidate-email-replace-v2"
  });
  assert.notEqual(second.answerVersionId, first.answerVersionId);

  await assert.rejects(
    service.save({
      ...firstInput,
      normalizedValue: { ...privateValue, kind: "STRING", value: "stale@example.com" },
      expectedCurrentVersionId: first.answerVersionId,
      idempotencyKey: "candidate-email-stale-v3"
    }),
    (error: unknown) =>
      error instanceof Error && error.name === "AppError" && "code" in error && error.code === "CONFLICT"
  );

  const current = await repository.findCurrent({
    accountId,
    candidateId,
    canonicalKey: "EMAIL",
    entityId: null,
    scopeFingerprint: createHash("sha256").update("scope=GLOBAL").digest("hex")
  });
  assert.equal(current?.answerVersionId, second.answerVersionId);
  assert.equal(current?.normalizedValue.kind, "STRING");
  assert.equal(current?.normalizedValue.kind === "STRING" ? current.normalizedValue.value : null, "asha.new@example.com");

  const counts = await database.query<{ versions: string; current_answers: string; change_sets: string }>(`
    SELECT
      (SELECT count(*)::text FROM candidate_answer_versions WHERE candidate_id = '${candidateId}') AS versions,
      (SELECT count(*)::text FROM candidate_answers_current WHERE candidate_id = '${candidateId}') AS current_answers,
      (SELECT count(*)::text FROM candidate_answer_change_sets WHERE candidate_id = '${candidateId}') AS change_sets
  `);
  assert.deepEqual(counts.rows[0], { versions: "2", current_answers: "1", change_sets: "2" });

  const persisted = await database.query<{
    value_fingerprint: string;
    payload_reference: Record<string, unknown>;
    request_fingerprint: string;
  }>(`
    SELECT version.value_fingerprint, outbox.payload_reference, change_set.request_fingerprint
    FROM candidate_answer_versions version
    JOIN candidate_answer_change_sets change_set ON change_set.id = version.change_set_id
    JOIN outbox_events outbox
      ON outbox.payload_reference->>'answerVersionId' = version.id::text
    WHERE version.id = '${second.answerVersionId}'
  `);
  const plainHash = createHash("sha256")
    .update(
      canonicalNormalizedValueJson({
        ...privateValue,
        kind: "STRING",
        value: "asha.new@example.com"
      })
    )
    .digest("hex");
  assert.notEqual(persisted.rows[0]?.value_fingerprint, plainHash);
  assert.equal(persisted.rows[0]?.value_fingerprint.length, 64);
  assert.equal(persisted.rows[0]?.request_fingerprint.length, 64);
  assert.doesNotMatch(JSON.stringify(persisted.rows[0]?.payload_reference), /asha|example\.com/i);
  await kysely.destroy();
});

test("candidate answer scopes are immutable and cannot be tampered after persistence", async () => {
  const { database, kysely, repository, service } = await setup();
  await service.save({
    accountId,
    candidateId,
    canonicalKey: "EMAIL",
    normalizedValue: { ...privateValue, kind: "STRING", value: "scope@example.com" },
    scopeType: "GLOBAL",
    source: "USER_MANUAL",
    commitPoint: "EXPLICIT_SAVE",
    expectedCurrentVersionId: null,
    idempotencyKey: "tampered-scope-email"
  });
  await assert.rejects(
    database.exec(`
      UPDATE candidate_answer_scopes
      SET scope_fingerprint = '${"0".repeat(64)}'
      WHERE candidate_id = '${candidateId}' AND scope_type = 'GLOBAL'
    `),
    /scopes are immutable/i
  );
  const candidates = await repository.listCurrentCandidates({
    accountId,
    candidateId,
    canonicalKey: "EMAIL",
    entityId: null,
    context: {}
  });
  assert.equal(candidates.length, 1);
  await kysely.destroy();
});

test("candidate truth rejects cross-account mutation, application-only learning and inferred legal facts", async () => {
  const { kysely, service } = await setup();
  await assert.rejects(
    service.save({
      accountId: secondAccountId,
      candidateId,
      canonicalKey: "EMAIL",
      normalizedValue: { ...privateValue, kind: "STRING", value: "private@example.com" },
      scopeType: "GLOBAL",
      source: "USER_MANUAL",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: null,
      idempotencyKey: "cross-account-email-create"
    }),
    (error: unknown) =>
      error instanceof Error && error.name === "AppError" && "code" in error && error.code === "NOT_FOUND"
  );

  await assert.rejects(
    service.save({
      accountId,
      candidateId,
      canonicalKey: "COVER_LETTER",
      normalizedValue: { ...privateValue, kind: "RICH_TEXT", value: "Application-specific draft" },
      scopeType: "APPLICATION",
      context: { applicationId: "20000000-0000-4000-8000-000000000010" },
      applicationId: "20000000-0000-4000-8000-000000000010",
      source: "USER_MANUAL",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: null,
      idempotencyKey: "application-only-cover-letter"
    }),
    /application-only/i
  );

  await assert.rejects(
    service.save({
      accountId,
      candidateId,
      canonicalKey: "WORK_AUTHORIZATION",
      normalizedValue: { ...privateValue, kind: "BOOLEAN", value: true },
      scopeType: "SEARCH",
      context: { countryCode: "IN" },
      source: "DERIVED",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: null,
      idempotencyKey: "derived-work-authorization"
    }),
    /direct candidate source/i
  );
  await kysely.destroy();
});

test("verified contextual preference starts in REVIEW and explicit save is TRUSTED", async () => {
  const { kysely, service, verifiedSubmission } = await setup();
  const reviewed = await service.save({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    normalizedValue: {
      ...privateValue,
      kind: "MONEY",
      amountExact: "2400000",
      currency: "INR",
      period: "YEAR"
    },
    scopeType: "GLOBAL",
    source: "USER_CORRECTION",
    commitPoint: "VERIFIED_SUBMISSION",
    applicationId: verifiedSubmission.applicationId,
    checkpointId: verifiedSubmission.checkpointId,
    expectedCurrentVersionId: null,
    idempotencyKey: "expected-ctc-verified-review"
  });
  assert.equal(reviewed.trustState, "REVIEW");

  const trusted = await service.save({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    normalizedValue: {
      ...privateValue,
      kind: "MONEY",
      amountExact: "2600000",
      currency: "INR",
      period: "YEAR"
    },
    scopeType: "GLOBAL",
    source: "USER_CORRECTION",
    commitPoint: "EXPLICIT_SAVE",
    expectedCurrentVersionId: reviewed.answerVersionId,
    idempotencyKey: "expected-ctc-explicit-trusted"
  });
  assert.equal(trusted.trustState, "TRUSTED");
  await kysely.destroy();
});

test("scoped resolution reads one compatible current projection and never scans superseded truth", async () => {
  const { database, kysely, repository, service } = await setup();
  const saveExpectedCtc = (input: {
    amountExact: string;
    scopeType: "GLOBAL" | "SEARCH";
    countryCode?: string;
    idempotencyKey: string;
  }) =>
    service.save({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      normalizedValue: {
        ...privateValue,
        kind: "MONEY",
        amountExact: input.amountExact,
        currency: "INR",
        period: "YEAR"
      },
      scopeType: input.scopeType,
      ...(input.countryCode ? { context: { countryCode: input.countryCode } } : {}),
      source: "USER_CORRECTION",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: null,
      idempotencyKey: input.idempotencyKey
    });
  await saveExpectedCtc({
    amountExact: "2400000",
    scopeType: "GLOBAL",
    idempotencyKey: "resolver-global-ctc"
  });
  const india = await saveExpectedCtc({
    amountExact: "2800000",
    scopeType: "SEARCH",
    countryCode: "IN",
    idempotencyKey: "resolver-india-ctc"
  });
  await saveExpectedCtc({
    amountExact: "3500000",
    scopeType: "SEARCH",
    countryCode: "US",
    idempotencyKey: "resolver-us-ctc"
  });
  const indiaReplacement = await service.save({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    normalizedValue: {
      ...privateValue,
      kind: "MONEY",
      amountExact: "2900000",
      currency: "INR",
      period: "YEAR"
    },
    scopeType: "SEARCH",
    context: { countryCode: "IN" },
    source: "USER_CORRECTION",
    commitPoint: "EXPLICIT_SAVE",
    expectedCurrentVersionId: india.answerVersionId,
    idempotencyKey: "resolver-india-ctc-replacement"
  });

  const compatible = await repository.listCurrentCandidates({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    entityId: null,
    context: { countryCode: "IN" }
  });
  assert.equal(compatible.length, 2, "global and India truth are compatible; US truth is excluded in SQL");
  assert.equal(
    compatible.some((candidate) => candidate.answerVersionId === india.answerVersionId),
    false,
    "the superseded India version remains history and is absent from the current projection"
  );
  const persistedCounts = await database.query<{ history: string; current_rows: string }>(`
    SELECT
      (SELECT count(*)::text
       FROM candidate_answer_versions version
       JOIN canonical_fields canonical ON canonical.id = version.canonical_id
       WHERE version.candidate_id = '${candidateId}' AND canonical.canonical_key = 'EXPECTED_CTC') AS history,
      (SELECT count(*)::text
       FROM candidate_answers_current current_answer
       JOIN canonical_fields canonical ON canonical.id = current_answer.canonical_id
       WHERE current_answer.candidate_id = '${candidateId}' AND canonical.canonical_key = 'EXPECTED_CTC') AS current_rows
  `);
  assert.deepEqual(persistedCounts.rows[0], { history: "4", current_rows: "3" });

  const resolver = new CandidateTruthResolver(repository, { now: () => now });
  const resolved = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: { countryCode: "IN" }
  });
  assert.equal(resolved.status, "RESOLVED");
  assert.equal(
    resolved.status === "RESOLVED" ? resolved.answerVersionId : null,
    indiaReplacement.answerVersionId
  );

  const projectionCounts = await repository.listCurrentCandidates({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    entityId: null,
    context: {}
  });
  assert.equal(projectionCounts.length, 1, "only the global scope is compatible without search context");

  const crossAccount = await resolver.resolve({
    accountId: secondAccountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: { countryCode: "IN" }
  });
  assert.equal(crossAccount.status, "MISSING");
  assert.doesNotMatch(JSON.stringify(crossAccount), /2400000|2800000|3500000/);
  await kysely.destroy();
});

test("stable entity identity separates repeatable employment answers and rejects foreign or removed entities", async () => {
  const { database, kysely, repository, service, verifiedSubmission } = await setup();
  const firstEntityId = "20000000-0000-4000-8000-000000000021";
  const secondEntityId = "20000000-0000-4000-8000-000000000022";
  const foreignEntityId = "20000000-0000-4000-8000-000000000023";
  await database.exec(`
    INSERT INTO candidate_entities (id, candidate_id, entity_type, status) VALUES
      ('${firstEntityId}', '${candidateId}', 'EMPLOYMENT', 'ACTIVE'),
      ('${secondEntityId}', '${candidateId}', 'EMPLOYMENT', 'ACTIVE'),
      ('${foreignEntityId}', '${secondCandidateId}', 'EMPLOYMENT', 'ACTIVE');
  `);
  const saveEmployment = (entityId: string, value: string, idempotencyKey: string) =>
    service.save({
      accountId,
      candidateId,
      canonicalKey: "EMPLOYMENT_COMPANY",
      normalizedValue: { ...privateValue, kind: "STRING", value },
      scopeType: "GLOBAL",
      entityId,
      source: "USER_MANUAL",
      commitPoint: "VERIFIED_SUBMISSION",
      applicationId: verifiedSubmission.applicationId,
      checkpointId: verifiedSubmission.checkpointId,
      expectedCurrentVersionId: null,
      idempotencyKey
    });
  await saveEmployment(firstEntityId, "Company One", "employment-company-one");
  await saveEmployment(secondEntityId, "Company Two", "employment-company-two");
  const currentCount = await database.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM candidate_answers_current current_answer
    JOIN canonical_fields canonical ON canonical.id = current_answer.canonical_id
    WHERE current_answer.candidate_id = '${candidateId}'
      AND canonical.canonical_key = 'EMPLOYMENT_COMPANY'
  `);
  assert.equal(currentCount.rows[0]?.count, "2");

  const activeEntityTruth = await repository.listCurrentCandidates({
    accountId,
    candidateId,
    canonicalKey: "EMPLOYMENT_COMPANY",
    entityId: firstEntityId,
    context: {}
  });
  assert.equal(activeEntityTruth.length, 1);
  await database.exec(`UPDATE candidate_entities SET status = 'REMOVED' WHERE id = '${firstEntityId}'`);
  const removedEntityTruth = await repository.listCurrentCandidates({
    accountId,
    candidateId,
    canonicalKey: "EMPLOYMENT_COMPANY",
    entityId: firstEntityId,
    context: {}
  });
  assert.equal(removedEntityTruth.length, 0);

  await assert.rejects(
    saveEmployment(foreignEntityId, "Foreign Company", "employment-company-foreign"),
    /does not match the canonical policy/i
  );
  await kysely.destroy();
});

test("verified unchanged REVIEW trial appends TRUSTED truth and replays idempotently", async () => {
  const { database, kysely, repository, service, verifiedSubmission } = await setup();
  const review = await createExpectedCtcReview(service, verifiedSubmission, {
    idempotencyKey: "review-promotion-origin"
  });
  assert.equal(review.trustState, "REVIEW");
  assert.equal(review.transitionKind, "CREATE_REVIEW");

  const resolver = new CandidateTruthResolver(repository, { now: () => now });
  const trial = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: {}
  });
  assert.equal(trial.status, "RESOLVED");
  assert.equal(trial.status === "RESOLVED" && trial.trialReuse, true);
  if (trial.status !== "RESOLVED") throw new Error("Expected a REVIEW trial resolution.");

  const active = await startApplicationRun(database, 0x100);
  const outcomeReceipt = await service.recordTrialOutcome({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    scopeType: "GLOBAL",
    context: {},
    applicationId: active.applicationId,
    runId: active.runId,
    operationId: testUuid(0x103),
    sequence: 1,
    usedAnswerVersionId: trial.answerVersionId,
    usedScopeFingerprint: trial.scope.scopeFingerprint,
    outcome: "CONFIRMED_UNCHANGED",
    finalActor: "COPILOT",
    finalNormalizedValue: money("2400000.00"),
    idempotencyKey: "record-review-trial-unchanged"
  });
  const receipt = await completeApplicationRun(database, active, 0x104);
  const command = {
    accountId,
    candidateId,
    usageProofId: outcomeReceipt.usageProofId,
    canonicalKey: "EXPECTED_CTC",
    applicationId: receipt.applicationId,
    runId: receipt.runId,
    checkpointId: receipt.checkpointId,
    usedAnswerVersionId: trial.answerVersionId,
    usedScopeFingerprint: trial.scope.scopeFingerprint,
    outcome: "CONFIRMED_UNCHANGED" as const,
    finalNormalizedValue: money("2400000.00"),
    idempotencyKey: "promote-review-after-submission"
  };
  const promoted = await service.applyVerifiedTrialOutcome(command);
  assert.equal(promoted.trustState, "TRUSTED");
  assert.equal(promoted.transitionKind, "PROMOTE_TRUSTED");
  assert.equal(promoted.idempotentReplay, false);

  const replay = await service.applyVerifiedTrialOutcome(command);
  assert.equal(replay.answerVersionId, promoted.answerVersionId);
  assert.equal(replay.changeSetId, promoted.changeSetId);
  assert.equal(replay.idempotentReplay, true);

  const persisted = await database.query<{
    trust_state: string;
    source: string;
    supersedes_version_id: string;
    application_id: string;
    checkpoint_id: string;
    transition_kind: string;
    proof_status: string;
    proof_answer_version_id: string;
  }>(`
    SELECT
      version.trust_state,
      version.source,
      version.supersedes_version_id,
      change_set.application_id,
      change_set.checkpoint_id,
      item.transition_kind,
      proof.status AS proof_status,
      proof.answer_version_id AS proof_answer_version_id
    FROM candidate_answer_versions version
    JOIN candidate_answer_change_sets change_set ON change_set.id = version.change_set_id
    JOIN candidate_answer_change_set_items item ON item.new_version_id = version.id
    JOIN candidate_answer_usage_proofs proof ON proof.consumed_change_set_id = change_set.id
    WHERE version.id = '${promoted.answerVersionId}'
  `);
  assert.deepEqual(persisted.rows[0], {
    trust_state: "TRUSTED",
    source: "USER_ACCEPTED_REUSE",
    supersedes_version_id: review.answerVersionId,
    application_id: receipt.applicationId,
    checkpoint_id: receipt.checkpointId,
    transition_kind: "PROMOTE_TRUSTED",
    proof_status: "CONSUMED",
    proof_answer_version_id: review.answerVersionId
  });
  await assert.rejects(
    database.exec(`
      UPDATE candidate_answer_usage_proofs
      SET outcome = 'USER_CORRECTED', final_actor = 'USER'
      WHERE id = '${outcomeReceipt.usageProofId}'
    `),
    /immutable outside verified consumption/i
  );
  const resolved = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: {}
  });
  assert.equal(resolved.status, "RESOLVED");
  assert.equal(resolved.status === "RESOLVED" && resolved.answerVersionId, promoted.answerVersionId);
  assert.equal(resolved.status === "RESOLVED" && resolved.trialReuse, false);

  const valueFree = await database.query<{ payload_reference: Record<string, unknown> }>(`
    SELECT payload_reference
    FROM outbox_events
    WHERE payload_reference->>'answerVersionId' = '${promoted.answerVersionId}'
  `);
  assert.doesNotMatch(JSON.stringify(valueFree.rows), /2400000|amountExact|currency/i);

  await assert.rejects(
    service.applyVerifiedTrialOutcome({
      ...command,
      outcome: "USER_CORRECTED",
      finalNormalizedValue: money("2800000")
    }),
    (error: unknown) =>
      error instanceof Error && error.name === "AppError" && "code" in error && error.code === "IDEMPOTENCY_CONFLICT"
  );
  await kysely.destroy();
});

test("verified candidate correction appends a new same-scope REVIEW without rewriting history", async () => {
  const { database, kysely, repository, service, verifiedSubmission } = await setup();
  const review = await createExpectedCtcReview(service, verifiedSubmission, {
    idempotencyKey: "review-correction-origin"
  });
  const resolver = new CandidateTruthResolver(repository, { now: () => now });
  const trial = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: {}
  });
  if (trial.status !== "RESOLVED") throw new Error("Expected a REVIEW trial resolution.");
  const active = await startApplicationRun(database, 0x110);
  const outcomeReceipt = await service.recordTrialOutcome({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    scopeType: "GLOBAL",
    context: {},
    applicationId: active.applicationId,
    runId: active.runId,
    operationId: testUuid(0x113),
    sequence: 1,
    usedAnswerVersionId: trial.answerVersionId,
    usedScopeFingerprint: trial.scope.scopeFingerprint,
    outcome: "USER_CORRECTED",
    finalActor: "USER",
    finalNormalizedValue: money("2800000"),
    idempotencyKey: "record-review-trial-correction"
  });
  const receipt = await completeApplicationRun(database, active, 0x114);
  const corrected = await service.applyVerifiedTrialOutcome({
    accountId,
    candidateId,
    usageProofId: outcomeReceipt.usageProofId,
    canonicalKey: "EXPECTED_CTC",
    applicationId: receipt.applicationId,
    runId: receipt.runId,
    checkpointId: receipt.checkpointId,
    usedAnswerVersionId: trial.answerVersionId,
    usedScopeFingerprint: trial.scope.scopeFingerprint,
    outcome: "USER_CORRECTED",
    finalNormalizedValue: money("2800000"),
    idempotencyKey: "correct-review-after-submission"
  });
  assert.equal(corrected.trustState, "REVIEW");
  assert.equal(corrected.transitionKind, "CORRECT_REVIEW");

  const rows = await database.query<{
    id: string;
    source: string;
    trust_state: string;
    supersedes_version_id: string | null;
    scope_id: string;
    amount: string;
  }>(`
    SELECT
      version.id,
      version.source,
      version.trust_state,
      version.supersedes_version_id,
      version.scope_id,
      version.structured_value->>'amountExact' AS amount
    FROM candidate_answer_versions version
    JOIN canonical_fields canonical ON canonical.id = version.canonical_id
    WHERE version.candidate_id = '${candidateId}'
      AND canonical.canonical_key = 'EXPECTED_CTC'
    ORDER BY version.created_at, version.id
  `);
  assert.equal(rows.rows.length, 2);
  const original = rows.rows.find((row) => row.id === review.answerVersionId);
  const replacement = rows.rows.find((row) => row.id === corrected.answerVersionId);
  assert.equal(original?.amount, "2400000");
  assert.equal(replacement?.amount, "2800000");
  assert.equal(replacement?.source, "USER_CORRECTION");
  assert.equal(replacement?.trust_state, "REVIEW");
  assert.equal(replacement?.supersedes_version_id, review.answerVersionId);
  assert.equal(replacement?.scope_id, original?.scope_id);

  const current = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: {}
  });
  assert.equal(current.status, "RESOLVED");
  assert.equal(current.status === "RESOLVED" && current.answerVersionId, corrected.answerVersionId);
  assert.equal(current.status === "RESOLVED" && current.trialReuse, true);
  await kysely.destroy();
});

test("trial outcome receipts bind contextual truth to the application's actual job", async () => {
  const { database, kysely, repository, service } = await setup();
  const expectedJob = await createJobContext(database, 0x200);
  const originRun = await startApplicationRun(database, 0x210, expectedJob.jobId);
  const originReceipt = await completeApplicationRun(database, originRun, 0x212);
  const review = await service.save({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    normalizedValue: money("3000000"),
    scopeType: "COMPANY",
    context: { companyId: expectedJob.companyId },
    source: "USER_CORRECTION",
    commitPoint: "VERIFIED_SUBMISSION",
    applicationId: originReceipt.applicationId,
    checkpointId: originReceipt.checkpointId,
    expectedCurrentVersionId: null,
    idempotencyKey: "company-review-origin"
  });
  const resolver = new CandidateTruthResolver(repository, { now: () => now });
  const trial = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: { companyId: expectedJob.companyId }
  });
  if (trial.status !== "RESOLVED") throw new Error("Expected exact company REVIEW trial.");
  assert.equal(trial.answerVersionId, review.answerVersionId);

  const unrelatedJob = await createJobContext(database, 0x220);
  const unrelatedRun = await startApplicationRun(database, 0x230, unrelatedJob.jobId);
  await assert.rejects(
    service.recordTrialOutcome({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      scopeType: "COMPANY",
      context: { companyId: expectedJob.companyId },
      applicationId: unrelatedRun.applicationId,
      runId: unrelatedRun.runId,
      operationId: testUuid(0x232),
      sequence: 1,
      usedAnswerVersionId: trial.answerVersionId,
      usedScopeFingerprint: trial.scope.scopeFingerprint,
      outcome: "CONFIRMED_UNCHANGED",
      finalActor: "COPILOT",
      finalNormalizedValue: money("3000000"),
      idempotencyKey: "unrelated-job-cannot-promote-company-review"
    }),
    /active-run authority/i
  );

  const matchingRun = await startApplicationRun(database, 0x240, expectedJob.jobId);
  const accepted = await service.recordTrialOutcome({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    scopeType: "COMPANY",
    context: { companyId: expectedJob.companyId },
    applicationId: matchingRun.applicationId,
    runId: matchingRun.runId,
    operationId: testUuid(0x242),
    sequence: 1,
    usedAnswerVersionId: trial.answerVersionId,
    usedScopeFingerprint: trial.scope.scopeFingerprint,
    outcome: "CONFIRMED_UNCHANGED",
    finalActor: "COPILOT",
    finalNormalizedValue: money("3000000"),
    idempotencyKey: "matching-job-records-company-review"
  });
  assert.equal(accepted.idempotentReplay, false);
  await kysely.destroy();
});

test("REVIEW outcome promotion fails closed on authority, scope, source and value drift", async () => {
  const { database, kysely, repository, service, verifiedSubmission } = await setup();
  const review = await createExpectedCtcReview(service, verifiedSubmission, {
    idempotencyKey: "review-fail-closed-origin"
  });
  const resolver = new CandidateTruthResolver(repository, { now: () => now });
  const trial = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: {}
  });
  if (trial.status !== "RESOLVED") throw new Error("Expected a REVIEW trial resolution.");
  const active = await startApplicationRun(database, 0x120);
  const recordBase = {
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    scopeType: "GLOBAL" as const,
    context: {},
    applicationId: active.applicationId,
    runId: active.runId,
    operationId: testUuid(0x123),
    sequence: 1,
    usedAnswerVersionId: trial.answerVersionId,
    usedScopeFingerprint: trial.scope.scopeFingerprint,
    outcome: "CONFIRMED_UNCHANGED" as const,
    finalActor: "COPILOT" as const,
    finalNormalizedValue: money("2400000")
  };

  await assert.rejects(
    service.recordTrialOutcome({
      ...recordBase,
      finalNormalizedValue: money("2800000"),
      idempotencyKey: "unchanged-proof-value-drift"
    }),
    /does not match the final candidate value/i
  );
  await assert.rejects(
    service.recordTrialOutcome({
      ...recordBase,
      outcome: "USER_CORRECTED",
      finalActor: "USER",
      idempotencyKey: "correction-proof-no-change"
    }),
    /semantically different/i
  );
  await assert.rejects(
    service.recordTrialOutcome({
      ...recordBase,
      usedScopeFingerprint: "0".repeat(64),
      idempotencyKey: "wrong-review-scope-proof"
    }),
    /exact current REVIEW trial/i
  );
  await assert.rejects(
    service.recordTrialOutcome({
      ...recordBase,
      usedAnswerVersionId: testUuid(0x777),
      idempotencyKey: "stale-review-version-proof"
    }),
    /exact current REVIEW trial/i
  );
  await assert.rejects(
    service.recordTrialOutcome({
      ...recordBase,
      outcome: "USER_CORRECTED",
      finalActor: "COPILOT",
      finalNormalizedValue: money("2800000"),
      idempotencyKey: "correction-without-user-actor"
    }),
    /direct candidate action/i
  );

  const outcomeReceipt = await service.recordTrialOutcome({
    ...recordBase,
    idempotencyKey: "valid-pre-submit-outcome-receipt"
  });
  const applyBase = {
    accountId,
    candidateId,
    usageProofId: outcomeReceipt.usageProofId,
    applicationId: active.applicationId,
    runId: active.runId,
    canonicalKey: "EXPECTED_CTC",
    usedAnswerVersionId: trial.answerVersionId,
    usedScopeFingerprint: trial.scope.scopeFingerprint,
    outcome: "CONFIRMED_UNCHANGED" as const,
    finalNormalizedValue: money("2400000")
  };

  const prematureCheckpointId = await addRunCheckpoint(database, active, 0x124);
  await assert.rejects(
    service.applyVerifiedTrialOutcome({
      ...applyBase,
      checkpointId: prematureCheckpointId,
      idempotencyKey: "unfinished-application-run"
    }),
    /authoritative|stale/i
  );
  const observedReceipt = await completeApplicationRun(database, active, 0x125, {
    checkpointStatus: "OBSERVED"
  });
  await assert.rejects(
    service.applyVerifiedTrialOutcome({
      ...applyBase,
      checkpointId: observedReceipt.checkpointId,
      idempotencyKey: "observed-submission-checkpoint"
    }),
    /authoritative|stale/i
  );
  const reviewCheckpointId = await addRunCheckpoint(database, active, 0x126, {
    checkpointType: "REVIEW_REACHED"
  });
  await assert.rejects(
    service.applyVerifiedTrialOutcome({
      ...applyBase,
      checkpointId: reviewCheckpointId,
      idempotencyKey: "review-page-not-submission"
    }),
    /authoritative|stale/i
  );
  const validCheckpointId = await addRunCheckpoint(database, active, 0x127);

  const newerReview = await createExpectedCtcReview(service, verifiedSubmission, {
    amountExact: "2500000",
    expectedCurrentVersionId: review.answerVersionId,
    idempotencyKey: "newer-review-makes-receipt-stale"
  });
  await assert.rejects(
    service.applyVerifiedTrialOutcome({
      ...applyBase,
      checkpointId: validCheckpointId,
      idempotencyKey: "stale-current-review-receipt"
    }),
    /authoritative|stale/i
  );

  const profileReview = await createExpectedCtcReview(service, verifiedSubmission, {
    amountExact: "2600000",
    source: "PROFILE",
    expectedCurrentVersionId: newerReview.answerVersionId,
    idempotencyKey: "profile-review-not-promotable"
  });
  const nonPromotable = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: {}
  });
  assert.equal(nonPromotable.status, "NEEDS_USER");
  const profileRun = await startApplicationRun(database, 0x130);
  await assert.rejects(
    service.recordTrialOutcome({
      ...recordBase,
      applicationId: profileRun.applicationId,
      runId: profileRun.runId,
      operationId: testUuid(0x133),
      usedAnswerVersionId: profileReview.answerVersionId,
      finalNormalizedValue: money("2600000"),
      idempotencyKey: "profile-review-promotion-rejected"
    }),
    /exact current REVIEW trial/i
  );
  const proofCount = await database.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM candidate_answer_usage_proofs
    WHERE candidate_id = '${candidateId}'
  `);
  assert.equal(proofCount.rows[0]?.count, "1", "only the valid in-run outcome receipt is persisted");
  await kysely.destroy();
});

test("two stale concurrent candidate-answer writes cannot both win", async () => {
  const { kysely, service, verifiedSubmission } = await setup();
  const common = {
    accountId,
    candidateId,
    canonicalKey: "EMAIL",
    scopeType: "GLOBAL" as const,
    source: "USER_MANUAL" as const,
    commitPoint: "VERIFIED_SUBMISSION" as const,
    applicationId: verifiedSubmission.applicationId,
    checkpointId: verifiedSubmission.checkpointId,
    expectedCurrentVersionId: null
  };
  const outcomes = await Promise.allSettled([
    service.save({
      ...common,
      normalizedValue: { ...privateValue, kind: "STRING", value: "race.one@example.com" },
      idempotencyKey: "candidate-email-race-one"
    }),
    service.save({
      ...common,
      normalizedValue: { ...privateValue, kind: "STRING", value: "race.two@example.com" },
      idempotencyKey: "candidate-email-race-two"
    })
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.equal(rejected?.status === "rejected" && rejected.reason.code, "CONFLICT");
  await kysely.destroy();
});

test("redundant contextual overrides become append-only tombstones while broader truth and children survive", async () => {
  const { database, kysely, repository, service } = await setup();
  const job = await createJobContext(database, 0x200);
  const save = (input: {
    amountExact: string;
    scopeType: "GLOBAL" | "SEARCH" | "COMPANY" | "JOB";
    context?: typeof job;
    idempotencyKey: string;
  }) =>
    service.save({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      normalizedValue: money(input.amountExact),
      scopeType: input.scopeType,
      ...(input.context ? { context: input.context } : {}),
      source: "USER_CORRECTION",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: null,
      idempotencyKey: input.idempotencyKey
    });
  const global = await save({
    amountExact: "2500000.00",
    scopeType: "GLOBAL",
    idempotencyKey: "override-global-origin"
  });
  const search = await save({
    amountExact: "2500000",
    scopeType: "SEARCH",
    context: job,
    idempotencyKey: "override-search-origin"
  });
  const company = await save({
    amountExact: "2500000",
    scopeType: "COMPANY",
    context: job,
    idempotencyKey: "override-company-origin"
  });
  const childJob = await save({
    amountExact: "3000000",
    scopeType: "JOB",
    context: job,
    idempotencyKey: "override-job-child"
  });
  const before = await repository.listCurrentCandidates({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    entityId: null,
    context: job
  });
  const scopeOf = (answerVersionId: string) => {
    const candidate = before.find((item) => item.answerVersionId === answerVersionId);
    if (!candidate) throw new Error("Expected current candidate-answer scope.");
    return candidate.scope.scopeFingerprint;
  };

  const removeCompany = {
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: job,
    overrideAnswerVersionId: company.answerVersionId,
    overrideScopeFingerprint: scopeOf(company.answerVersionId),
    inheritedAnswerVersionId: search.answerVersionId,
    inheritedScopeFingerprint: scopeOf(search.answerVersionId),
    idempotencyKey: "remove-redundant-company-override"
  };
  const removedCompany = await service.removeRedundantOverride(removeCompany);
  assert.equal(removedCompany.trustState, "REMOVED");
  assert.equal(removedCompany.transitionKind, "REMOVE_OVERRIDE");
  assert.equal(removedCompany.idempotentReplay, false);

  const replay = await service.removeRedundantOverride(removeCompany);
  assert.equal(replay.answerVersionId, removedCompany.answerVersionId);
  assert.equal(replay.changeSetId, removedCompany.changeSetId);
  assert.equal(replay.idempotentReplay, true);
  await assert.rejects(
    service.removeRedundantOverride({
      ...removeCompany,
      inheritedAnswerVersionId: childJob.answerVersionId,
      inheritedScopeFingerprint: scopeOf(childJob.answerVersionId)
    }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "IDEMPOTENCY_CONFLICT"
  );

  const resolver = new CandidateTruthResolver(repository, { now: () => now });
  const fullContext = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: job
  });
  assert.equal(fullContext.status, "RESOLVED");
  assert.equal(
    fullContext.status === "RESOLVED" ? fullContext.answerVersionId : null,
    childJob.answerVersionId,
    "the more-specific child is not changed when its parent override is removed"
  );
  const withoutJob = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: {
      companyId: job.companyId,
      countryCode: job.countryCode,
      roleFamily: job.roleFamily
    }
  });
  assert.equal(withoutJob.status, "RESOLVED");
  assert.equal(withoutJob.status === "RESOLVED" ? withoutJob.answerVersionId : null, search.answerVersionId);

  const afterCompany = await repository.listCurrentCandidates({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    entityId: null,
    context: job
  });
  const currentSearch = afterCompany.find((item) => item.answerVersionId === search.answerVersionId);
  const currentGlobal = afterCompany.find((item) => item.answerVersionId === global.answerVersionId);
  assert.ok(currentSearch && currentGlobal);
  const removedSearch = await service.removeRedundantOverride({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: job,
    overrideAnswerVersionId: search.answerVersionId,
    overrideScopeFingerprint: currentSearch.scope.scopeFingerprint,
    inheritedAnswerVersionId: global.answerVersionId,
    inheritedScopeFingerprint: currentGlobal.scope.scopeFingerprint,
    idempotencyKey: "remove-redundant-search-override"
  });
  assert.equal(removedSearch.trustState, "REMOVED");

  const inherited = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: {
      companyId: job.companyId,
      countryCode: job.countryCode,
      roleFamily: job.roleFamily
    }
  });
  assert.equal(inherited.status, "RESOLVED");
  assert.equal(inherited.status === "RESOLVED" ? inherited.answerVersionId : null, global.answerVersionId);

  const audit = await database.query<{
    removed_versions: string;
    removal_items: string;
    job_current: string;
    payload_reference: Record<string, unknown>;
  }>(`
    SELECT
      (SELECT count(*)::text FROM candidate_answer_versions WHERE candidate_id = '${candidateId}' AND trust_state = 'REMOVED') AS removed_versions,
      (SELECT count(*)::text FROM candidate_answer_change_set_items WHERE candidate_id = '${candidateId}' AND transition_kind = 'REMOVE_OVERRIDE') AS removal_items,
      (SELECT answer_version_id::text FROM candidate_answers_current WHERE answer_version_id = '${childJob.answerVersionId}') AS job_current,
      (SELECT payload_reference FROM outbox_events WHERE payload_reference->>'answerVersionId' = '${removedSearch.answerVersionId}') AS payload_reference
  `);
  assert.equal(audit.rows[0]?.removed_versions, "2");
  assert.equal(audit.rows[0]?.removal_items, "2");
  assert.equal(audit.rows[0]?.job_current, childJob.answerVersionId);
  assert.doesNotMatch(JSON.stringify(audit.rows[0]?.payload_reference), /2500000|amountExact|currency/i);
  await kysely.destroy();
});

test("override removal fails closed when broader truth is stale or equally ranked truth conflicts", async () => {
  const staleSetup = await setup();
  const oldService = new CandidateTruthService(
    staleSetup.repository,
    new HmacCandidateValueFingerprinter("test-secret-key-that-is-at-least-32-bytes", 1),
    { now: () => new Date("2026-01-01T12:00:00.000Z") }
  );
  const staleGlobal = await oldService.save({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    normalizedValue: money("2500000"),
    scopeType: "GLOBAL",
    source: "USER_CORRECTION",
    commitPoint: "EXPLICIT_SAVE",
    expectedCurrentVersionId: null,
    idempotencyKey: "stale-broader-global"
  });
  const search = await staleSetup.service.save({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    normalizedValue: money("2500000"),
    scopeType: "SEARCH",
    context: { countryCode: "IN" },
    source: "USER_CORRECTION",
    commitPoint: "EXPLICIT_SAVE",
    expectedCurrentVersionId: null,
    idempotencyKey: "stale-broader-search"
  });
  const staleCandidates = await staleSetup.repository.listCurrentCandidates({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    entityId: null,
    context: { countryCode: "IN" }
  });
  const staleScope = staleCandidates.find((item) => item.answerVersionId === staleGlobal.answerVersionId)?.scope;
  const searchScope = staleCandidates.find((item) => item.answerVersionId === search.answerVersionId)?.scope;
  assert.ok(staleScope && searchScope);
  await assert.rejects(
    staleSetup.service.removeRedundantOverride({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      context: { countryCode: "IN" },
      overrideAnswerVersionId: search.answerVersionId,
      overrideScopeFingerprint: searchScope.scopeFingerprint,
      inheritedAnswerVersionId: staleGlobal.answerVersionId,
      inheritedScopeFingerprint: staleScope.scopeFingerprint,
      idempotencyKey: "reject-stale-broader-removal"
    }),
    /stale|safely inherit/i
  );
  await staleSetup.kysely.destroy();

  const conflictSetup = await setup();
  const job = await createJobContext(conflictSetup.database, 0x220);
  const saveScoped = (input: {
    amount: string;
    scopeType: "SEARCH" | "COMPANY";
    context: { countryCode?: string; roleFamily?: string; companyId?: string };
    key: string;
  }) =>
    conflictSetup.service.save({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      normalizedValue: money(input.amount),
      scopeType: input.scopeType,
      context: input.context,
      source: "USER_CORRECTION",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: null,
      idempotencyKey: input.key
    });
  const country = await saveScoped({
    amount: "2500000",
    scopeType: "SEARCH",
    context: { countryCode: job.countryCode },
    key: "conflicting-country-search"
  });
  await saveScoped({
    amount: "2600000",
    scopeType: "SEARCH",
    context: { roleFamily: job.roleFamily },
    key: "conflicting-role-search"
  });
  const company = await saveScoped({
    amount: "2500000",
    scopeType: "COMPANY",
    context: {
      companyId: job.companyId,
      countryCode: job.countryCode,
      roleFamily: job.roleFamily
    },
    key: "conflicting-company-override"
  });
  const conflictCandidates = await conflictSetup.repository.listCurrentCandidates({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    entityId: null,
    context: job
  });
  const countryScope = conflictCandidates.find((item) => item.answerVersionId === country.answerVersionId)?.scope;
  const companyScope = conflictCandidates.find((item) => item.answerVersionId === company.answerVersionId)?.scope;
  assert.ok(countryScope && companyScope);
  await assert.rejects(
    conflictSetup.service.removeRedundantOverride({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      context: job,
      overrideAnswerVersionId: company.answerVersionId,
      overrideScopeFingerprint: companyScope.scopeFingerprint,
      inheritedAnswerVersionId: country.answerVersionId,
      inheritedScopeFingerprint: countryScope.scopeFingerprint,
      idempotencyKey: "reject-conflicting-broader-removal"
    }),
    /safely inherit/i
  );
  await conflictSetup.kysely.destroy();
});

test("concurrent override removal and replacement cannot both commit", async () => {
  const { kysely, repository, service } = await setup();
  const global = await service.save({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    normalizedValue: money("2500000"),
    scopeType: "GLOBAL",
    source: "USER_CORRECTION",
    commitPoint: "EXPLICIT_SAVE",
    expectedCurrentVersionId: null,
    idempotencyKey: "removal-race-global"
  });
  const search = await service.save({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    normalizedValue: money("2500000"),
    scopeType: "SEARCH",
    context: { countryCode: "IN" },
    source: "USER_CORRECTION",
    commitPoint: "EXPLICIT_SAVE",
    expectedCurrentVersionId: null,
    idempotencyKey: "removal-race-search"
  });
  const candidates = await repository.listCurrentCandidates({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    entityId: null,
    context: { countryCode: "IN" }
  });
  const globalScope = candidates.find((item) => item.answerVersionId === global.answerVersionId)?.scope;
  const searchScope = candidates.find((item) => item.answerVersionId === search.answerVersionId)?.scope;
  assert.ok(globalScope && searchScope);

  const outcomes = await Promise.allSettled([
    service.removeRedundantOverride({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      context: { countryCode: "IN" },
      overrideAnswerVersionId: search.answerVersionId,
      overrideScopeFingerprint: searchScope.scopeFingerprint,
      inheritedAnswerVersionId: global.answerVersionId,
      inheritedScopeFingerprint: globalScope.scopeFingerprint,
      idempotencyKey: "removal-race-remove"
    }),
    service.save({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      normalizedValue: money("2700000"),
      scopeType: "SEARCH",
      context: { countryCode: "IN" },
      source: "USER_CORRECTION",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: search.answerVersionId,
      idempotencyKey: "removal-race-replace"
    })
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.equal(rejected.status === "rejected" && rejected.reason.code, "CONFLICT");
  await kysely.destroy();
});

test("a fresh candidate answer safely replaces an invisible REMOVED tombstone", async () => {
  const { kysely, repository, service } = await setup();
  const context = { countryCode: "IN", roleFamily: "BACKEND" };
  const global = await service.save({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    normalizedValue: money("2500000"),
    scopeType: "GLOBAL",
    source: "USER_CORRECTION",
    commitPoint: "EXPLICIT_SAVE",
    expectedCurrentVersionId: null,
    idempotencyKey: "tombstone-global-origin"
  });
  const search = await service.save({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    normalizedValue: money("2500000"),
    scopeType: "SEARCH",
    context,
    source: "USER_CORRECTION",
    commitPoint: "EXPLICIT_SAVE",
    expectedCurrentVersionId: null,
    idempotencyKey: "tombstone-search-origin"
  });
  const current = await repository.listCurrentCandidates({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    entityId: null,
    context
  });
  const globalScope = current.find((answer) => answer.answerVersionId === global.answerVersionId)?.scope;
  const searchScope = current.find((answer) => answer.answerVersionId === search.answerVersionId)?.scope;
  assert.ok(globalScope && searchScope);
  const removed = await service.removeRedundantOverride({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context,
    overrideAnswerVersionId: search.answerVersionId,
    overrideScopeFingerprint: searchScope.scopeFingerprint,
    inheritedAnswerVersionId: global.answerVersionId,
    inheritedScopeFingerprint: globalScope.scopeFingerprint,
    idempotencyKey: "tombstone-search-remove"
  });
  assert.equal(removed.trustState, "REMOVED");

  const recreatedInput = {
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    normalizedValue: money("2800000"),
    scopeType: "SEARCH" as const,
    context,
    source: "USER_CORRECTION" as const,
    commitPoint: "EXPLICIT_SAVE" as const,
    expectedCurrentVersionId: null,
    idempotencyKey: "tombstone-search-recreate"
  };
  const recreated = await service.save(recreatedInput);
  assert.equal(recreated.transitionKind, "CREATE_TRUSTED");
  assert.notEqual(recreated.answerVersionId, removed.answerVersionId);
  const replay = await service.save(recreatedInput);
  assert.equal(replay.answerVersionId, recreated.answerVersionId);
  assert.equal(replay.idempotentReplay, true);

  const resolved = await new CandidateTruthResolver(repository, { now: () => now }).resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context
  });
  assert.equal(resolved.status, "RESOLVED");
  assert.equal(
    resolved.status === "RESOLVED" ? resolved.answerVersionId : null,
    recreated.answerVersionId
  );
  await kysely.destroy();
});
import { migrateGlobalAnswerDefaults } from "./index.js";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  CandidateTruthResolver,
  CandidateTruthService,
  HmacCandidateValueFingerprinter
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

const accountId = "41000000-0000-4000-8000-000000000001";
const candidateId = "41000000-0000-4000-8000-000000000002";
const otherAccountId = "41000000-0000-4000-8000-000000000003";
const otherCandidateId = "41000000-0000-4000-8000-000000000004";
const now = new Date("2026-09-01T12:00:00.000Z");
const privateValue = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };

function uuid(serial: number): string {
  return `41000000-0000-4000-8000-${serial.toString(16).padStart(12, "0")}`;
}

function globalFingerprint(): string {
  return createHash("sha256").update("scope=GLOBAL").digest("hex");
}

function money(amountExact: string) {
  return {
    ...privateValue,
    kind: "MONEY" as const,
    amountExact,
    currency: "INR",
    period: "YEAR" as const
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
      ('${otherAccountId}', 'NORMAL', true);
  `);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  const repository = new KyselyCandidateTruthRepository(kysely);
  const service = new CandidateTruthService(
    repository,
    new HmacCandidateValueFingerprinter("e4-test-secret-key-that-is-at-least-32-bytes", 1),
    { now: () => now }
  );
  await service.ensureCandidate({ accountId, candidateId });
  await service.ensureCandidate({ accountId: otherAccountId, candidateId: otherCandidateId });
  return { database, kysely, repository, service };
}

async function applicationRun(database: PGlite, serial: number, status: "ACTIVE" | "COMPLETED") {
  const applicationId = uuid(serial);
  const runId = uuid(serial + 1);
  await database.exec(`
    INSERT INTO applications (
      id, account_id, candidate_id, target_url, status, submitted_at
    ) VALUES (
      '${applicationId}', '${accountId}', '${candidateId}',
      'https://example.test/e4/${serial}', '${status === "COMPLETED" ? "SUBMITTED" : "IN_PROGRESS"}',
      ${status === "COMPLETED" ? `'${now.toISOString()}'` : "NULL"}
    );
    INSERT INTO application_runs (
      id, application_id, protocol_version, extension_version, status, ended_at
    ) VALUES (
      '${runId}', '${applicationId}', 1, 'e4-test', '${status}',
      ${status === "COMPLETED" ? `'${now.toISOString()}'` : "NULL"}
    );
  `);
  return { applicationId, runId };
}

async function completeRun(
  database: PGlite,
  active: { applicationId: string; runId: string },
  checkpointSerial: number
) {
  const checkpointId = uuid(checkpointSerial);
  const evidenceHash = createHash("sha256").update(checkpointId).digest("hex");
  await database.exec(`
    UPDATE applications
    SET status = 'SUBMITTED', submitted_at = '${now.toISOString()}', updated_at = '${now.toISOString()}'
    WHERE id = '${active.applicationId}';
    UPDATE application_runs
    SET status = 'COMPLETED', ended_at = '${now.toISOString()}'
    WHERE id = '${active.runId}';
    INSERT INTO application_checkpoints (
      id, application_id, run_id, checkpoint_type, status, evidence_hash, observed_at
    ) VALUES (
      '${checkpointId}', '${active.applicationId}', '${active.runId}',
      'SUBMISSION', 'VERIFIED', '${evidenceHash}', '${now.toISOString()}'
    );
  `);
  return { ...active, checkpointId };
}

const fullName = (value: string) => ({ ...privateValue, kind: "STRING" as const, value });
const email = (value: string) => ({ ...privateValue, kind: "STRING" as const, value });

test("grouped writes commit atomically, replay exactly, and fully Undo into append-only tombstones", async () => {
  const { database, kysely, service } = await setup();
  try {
    const input = {
      accountId,
      candidateId,
      commitPoint: "EXPLICIT_SAVE" as const,
      idempotencyKey: "e4-group-create",
      items: [
        {
          itemKey: "full-name",
          canonicalKey: "FULL_NAME",
          normalizedValue: fullName("Asha Sharma"),
          scopeType: "GLOBAL" as const,
          source: "USER_MANUAL" as const,
          expectedCurrentVersionId: null
        },
        {
          itemKey: "email",
          canonicalKey: "EMAIL",
          normalizedValue: email("asha.e4@example.com"),
          scopeType: "GLOBAL" as const,
          source: "USER_MANUAL" as const,
          expectedCurrentVersionId: null
        }
      ]
    };
    const grouped = await service.saveGroup(input);
    assert.equal(grouped.items.length, 2);
    assert.equal(grouped.idempotentReplay, false);

    const replay = await service.saveGroup({ ...input, items: [...input.items].reverse() });
    assert.equal(replay.changeSetId, grouped.changeSetId);
    assert.equal(replay.idempotentReplay, true);
    assert.deepEqual(
      replay.items.map((item) => item.itemKey),
      ["email", "full-name"],
      "group result order is stable even when retry input order changes"
    );
    assert.deepEqual(
      new Map(replay.items.map((item) => [item.itemKey, item.answerVersionId])),
      new Map(grouped.items.map((item) => [item.itemKey, item.answerVersionId]))
    );
    await assert.rejects(
      service.saveGroup({
        ...input,
        items: input.items.map((item) =>
          item.itemKey === "email"
            ? { ...item, normalizedValue: email("changed@example.com") }
            : item
        )
      }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "IDEMPOTENCY_CONFLICT"
    );
    await assert.rejects(
      service.saveGroup({
        ...input,
        idempotencyKey: "e4-group-duplicate-item-key",
        items: input.items.map((item) => ({ ...item, itemKey: "duplicate" }))
      }),
      /item keys must be unique/i
    );
    await assert.rejects(
      service.saveGroup({
        ...input,
        idempotencyKey: "e4-group-duplicate-logical-answer",
        items: [
          input.items[0]!,
          { ...input.items[0]!, itemKey: "same-answer-different-key" }
        ]
      }),
      /cannot mutate one logical answer twice/i
    );

    const beforeFailedGroup = await database.query<{ versions: string; sets: string }>(`
      SELECT
        (SELECT count(*)::text FROM candidate_answer_versions WHERE candidate_id = '${candidateId}') AS versions,
        (SELECT count(*)::text FROM candidate_answer_change_sets WHERE candidate_id = '${candidateId}') AS sets
    `);
    await assert.rejects(
      service.saveGroup({
        ...input,
        idempotencyKey: "e4-group-stale-rollback",
        items: input.items.map((item, index) => ({
          ...item,
          normalizedValue: index ? email("stale@example.com") : fullName("Asha New"),
          expectedCurrentVersionId:
            index === 0 ? grouped.items.find((candidate) => candidate.itemKey === item.itemKey)?.answerVersionId ?? null : uuid(999)
        }))
      }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CONFLICT"
    );
    const afterFailedGroup = await database.query<{ versions: string; sets: string }>(`
      SELECT
        (SELECT count(*)::text FROM candidate_answer_versions WHERE candidate_id = '${candidateId}') AS versions,
        (SELECT count(*)::text FROM candidate_answer_change_sets WHERE candidate_id = '${candidateId}') AS sets
    `);
    assert.deepEqual(afterFailedGroup.rows[0], beforeFailedGroup.rows[0], "one stale item rolls back the whole group");

    const undone = await service.undoChangeSet({
      accountId,
      candidateId,
      targetChangeSetId: grouped.changeSetId,
      idempotencyKey: "e4-undo-full-group"
    });
    assert.deepEqual(undone.summary, { restored: 0, forgotten: 2, skippedNewerVersion: 0 });
    assert.equal(undone.items.every((item) => item.outcome === "FORGOTTEN"), true);
    assert.ok(undone.compensatingChangeSetId);

    const undoReplay = await service.undoChangeSet({
      accountId,
      candidateId,
      targetChangeSetId: grouped.changeSetId,
      idempotencyKey: "e4-undo-full-group"
    });
    assert.equal(undoReplay.reversalSetId, undone.reversalSetId);
    assert.equal(undoReplay.idempotentReplay, true);
    const alreadyUndone = await service.undoChangeSet({
      accountId,
      candidateId,
      targetChangeSetId: grouped.changeSetId,
      idempotencyKey: "e4-undo-full-group-second-command"
    });
    assert.equal(alreadyUndone.reversalSetId, undone.reversalSetId);
    assert.equal(alreadyUndone.alreadyReversed, true);
    assert.equal(alreadyUndone.idempotentReplay, false);
    const alreadyUndoneReplay = await service.undoChangeSet({
      accountId,
      candidateId,
      targetChangeSetId: grouped.changeSetId,
      idempotencyKey: "e4-undo-full-group-second-command"
    });
    assert.equal(alreadyUndoneReplay.reversalSetId, undone.reversalSetId);
    assert.equal(alreadyUndoneReplay.alreadyReversed, true);
    assert.equal(alreadyUndoneReplay.idempotentReplay, true);

    await assert.rejects(
      service.undoChangeSet({
        accountId,
        candidateId,
        targetChangeSetId: undone.compensatingChangeSetId as string,
        idempotencyKey: "e4-reject-recursive-undo"
      }),
      /cannot be recursively undone/i
    );
    await assert.rejects(
      service.restoreVersion({
        accountId,
        candidateId,
        targetVersionId: undone.items[0]?.compensatingVersionId as string,
        expectedCurrentVersionId: undone.items[0]?.compensatingVersionId as string,
        idempotencyKey: "e4-reject-restore-tombstone"
      }),
      /tombstones cannot be explicitly restored/i
    );

    const state = await database.query<{
      status: string;
      removed_current: string;
      reversal_count: string;
      receipt_count: string;
    }>(`
      SELECT
        (SELECT status FROM candidate_answer_change_sets WHERE id = '${grouped.changeSetId}') AS status,
        (SELECT count(*)::text
         FROM candidate_answers_current current_answer
         JOIN candidate_answer_versions version ON version.id = current_answer.answer_version_id
         WHERE current_answer.candidate_id = '${candidateId}' AND version.trust_state = 'REMOVED') AS removed_current,
        (SELECT count(*)::text FROM candidate_answer_reversal_sets WHERE candidate_id = '${candidateId}') AS reversal_count,
        (SELECT count(*)::text FROM candidate_answer_reversal_receipts WHERE candidate_id = '${candidateId}') AS receipt_count
    `);
    assert.deepEqual(state.rows[0], {
      status: "REVERSED",
      removed_current: "2",
      reversal_count: "1",
      receipt_count: "2"
    });

    await assert.rejects(
      service.undoChangeSet({
        accountId: otherAccountId,
        candidateId: otherCandidateId,
        targetChangeSetId: grouped.changeSetId,
        idempotencyKey: "e4-cross-candidate-undo"
      }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "NOT_FOUND"
    );

    const privateAudit = await database.query<Record<string, unknown>>(`
      SELECT reversal.*, item.*, receipt.*, outbox.payload_reference
      FROM candidate_answer_reversal_sets reversal
      JOIN candidate_answer_reversal_items item ON item.reversal_set_id = reversal.id
      JOIN candidate_answer_reversal_receipts receipt ON receipt.reversal_set_id = reversal.id
      JOIN outbox_events outbox
        ON outbox.payload_reference->>'reversalSetId' = reversal.id::text
      WHERE reversal.id = '${undone.reversalSetId}'
    `);
    assert.doesNotMatch(JSON.stringify(privateAudit.rows), /Asha|example\.com|amountExact/i);
    await assert.rejects(
      database.exec(`UPDATE candidate_answer_reversal_sets SET restored_count = 1 WHERE id = '${undone.reversalSetId}'`),
      /reversal records are immutable/i
    );
    await assert.rejects(
      database.exec(`DELETE FROM candidate_answer_reversal_items WHERE reversal_set_id = '${undone.reversalSetId}'`),
      /reversal records are immutable/i
    );
    await assert.rejects(
      database.exec(`DELETE FROM candidate_answer_reversal_receipts WHERE reversal_set_id = '${undone.reversalSetId}'`),
      /reversal records are immutable/i
    );
    await assert.rejects(
      database.exec(`UPDATE candidate_answer_versions SET source = 'USER_UNDO' WHERE id = '${grouped.items[0]?.answerVersionId}'`),
      /history is append-only/i
    );
    await assert.rejects(
      database.exec(`UPDATE candidate_answer_change_set_items SET item_key = 'tampered' WHERE change_set_id = '${grouped.changeSetId}'`),
      /history is append-only/i
    );
    await assert.rejects(
      database.exec(`DELETE FROM candidate_answer_change_sets WHERE id = '${grouped.changeSetId}'`),
      /history is append-only/i
    );
  } finally {
    await kysely.destroy();
  }
});

test("Undo is partial-safe after a newer write and concurrent duplicate Undo creates one reversal", async () => {
  const { database, kysely, service } = await setup();
  try {
    const grouped = await service.saveGroup({
      accountId,
      candidateId,
      commitPoint: "EXPLICIT_SAVE",
      idempotencyKey: "e4-partial-origin",
      items: [
        {
          itemKey: "full-name",
          canonicalKey: "FULL_NAME",
          normalizedValue: fullName("Before Undo"),
          scopeType: "GLOBAL",
          source: "USER_MANUAL",
          expectedCurrentVersionId: null
        },
        {
          itemKey: "email",
          canonicalKey: "EMAIL",
          normalizedValue: email("before@example.com"),
          scopeType: "GLOBAL",
          source: "USER_MANUAL",
          expectedCurrentVersionId: null
        }
      ]
    });
    const learnedEmail = grouped.items.find((item) => item.itemKey === "email");
    assert.ok(learnedEmail);
    const newer = await service.save({
      accountId,
      candidateId,
      canonicalKey: "EMAIL",
      normalizedValue: email("newer@example.com"),
      scopeType: "GLOBAL",
      source: "USER_MANUAL",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: learnedEmail.answerVersionId,
      idempotencyKey: "e4-newer-email"
    });

    const partial = await service.undoChangeSet({
      accountId,
      candidateId,
      targetChangeSetId: grouped.changeSetId,
      idempotencyKey: "e4-partial-undo"
    });
    assert.deepEqual(partial.summary, { restored: 0, forgotten: 1, skippedNewerVersion: 1 });
    assert.equal(partial.items.find((item) => item.canonicalKey === "EMAIL")?.outcome, "SKIPPED_NEWER_VERSION");
    assert.equal(partial.items.find((item) => item.canonicalKey === "FULL_NAME")?.outcome, "FORGOTTEN");
    const status = await database.query<{ status: string; current_email: string }>(`
      SELECT
        (SELECT status FROM candidate_answer_change_sets WHERE id = '${grouped.changeSetId}') AS status,
        (SELECT current_answer.answer_version_id::text
         FROM candidate_answers_current current_answer
         JOIN canonical_fields canonical ON canonical.id = current_answer.canonical_id
         WHERE current_answer.candidate_id = '${candidateId}' AND canonical.canonical_key = 'EMAIL') AS current_email
    `);
    assert.deepEqual(status.rows[0], { status: "PARTIALLY_REVERSED", current_email: newer.answerVersionId });

    const concurrentOrigin = await service.saveGroup({
      accountId,
      candidateId,
      commitPoint: "EXPLICIT_SAVE",
      idempotencyKey: "e4-concurrent-origin",
      items: [
        {
          itemKey: "phone",
          canonicalKey: "PHONE",
          normalizedValue: {
            ...privateValue,
            kind: "PHONE",
            countryCode: "+91",
            nationalNumber: "9876543210",
            extension: null
          },
          scopeType: "GLOBAL",
          source: "USER_MANUAL",
          expectedCurrentVersionId: null
        }
      ]
    });
    const concurrent = await Promise.all([
      service.undoChangeSet({
        accountId,
        candidateId,
        targetChangeSetId: concurrentOrigin.changeSetId,
        idempotencyKey: "e4-concurrent-undo-a"
      }),
      service.undoChangeSet({
        accountId,
        candidateId,
        targetChangeSetId: concurrentOrigin.changeSetId,
        idempotencyKey: "e4-concurrent-undo-b"
      })
    ]);
    assert.equal(new Set(concurrent.map((result) => result.reversalSetId)).size, 1);
    assert.equal(concurrent.filter((result) => result.alreadyReversed).length, 1);
    const concurrentCounts = await database.query<{ reversals: string; receipts: string }>(`
      SELECT
        (SELECT count(*)::text FROM candidate_answer_reversal_sets
         WHERE target_change_set_id = '${concurrentOrigin.changeSetId}') AS reversals,
        (SELECT count(*)::text FROM candidate_answer_reversal_receipts receipt
         JOIN candidate_answer_reversal_sets reversal ON reversal.id = receipt.reversal_set_id
         WHERE reversal.target_change_set_id = '${concurrentOrigin.changeSetId}') AS receipts
    `);
    assert.deepEqual(concurrentCounts.rows[0], { reversals: "1", receipts: "2" });

    const firstPage = await service.reversalHistory({ accountId, candidateId, limit: 1 });
    assert.equal(firstPage.length, 1);
    const firstEntry = firstPage[0];
    assert.ok(firstEntry);
    const secondPage = await service.reversalHistory({
      accountId,
      candidateId,
      limit: 10,
      before: {
        createdAt: firstEntry.createdAt,
        reversalSetId: firstEntry.reversalSetId
      }
    });
    assert.equal(secondPage.length >= 1, true);
    assert.equal(
      secondPage.some((entry) => entry.reversalSetId === firstEntry.reversalSetId),
      false,
      "tuple cursor pagination must not duplicate same-timestamp reversals"
    );
  } finally {
    await kysely.destroy();
  }
});

test("an all-skipped Undo records partial history without a compensating change set", async () => {
  const { database, kysely, service } = await setup();
  try {
    const origin = await service.saveGroup({
      accountId,
      candidateId,
      commitPoint: "EXPLICIT_SAVE",
      idempotencyKey: "e4-all-skipped-origin",
      items: [
        {
          itemKey: "name",
          canonicalKey: "FULL_NAME",
          normalizedValue: fullName("Original Name"),
          scopeType: "GLOBAL",
          source: "USER_MANUAL",
          expectedCurrentVersionId: null
        },
        {
          itemKey: "email",
          canonicalKey: "EMAIL",
          normalizedValue: email("original@example.com"),
          scopeType: "GLOBAL",
          source: "USER_MANUAL",
          expectedCurrentVersionId: null
        }
      ]
    });
    const originalName = origin.items.find((item) => item.itemKey === "name");
    const originalEmail = origin.items.find((item) => item.itemKey === "email");
    assert.ok(originalName && originalEmail);
    const newerName = await service.save({
      accountId,
      candidateId,
      canonicalKey: "FULL_NAME",
      normalizedValue: fullName("Newer Name"),
      scopeType: "GLOBAL",
      source: "USER_CORRECTION",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: originalName.answerVersionId,
      idempotencyKey: "e4-all-skipped-newer-name"
    });
    const newerEmail = await service.save({
      accountId,
      candidateId,
      canonicalKey: "EMAIL",
      normalizedValue: email("newer@example.com"),
      scopeType: "GLOBAL",
      source: "USER_CORRECTION",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: originalEmail.answerVersionId,
      idempotencyKey: "e4-all-skipped-newer-email"
    });

    const undone = await service.undoChangeSet({
      accountId,
      candidateId,
      targetChangeSetId: origin.changeSetId,
      idempotencyKey: "e4-all-skipped-undo"
    });
    assert.deepEqual(undone.summary, { restored: 0, forgotten: 0, skippedNewerVersion: 2 });
    assert.equal(undone.compensatingChangeSetId, null);
    assert.equal(undone.items.every((item) => item.outcome === "SKIPPED_NEWER_VERSION"), true);
    const audit = await database.query<{
      status: string;
      current_name: string;
      current_email: string;
      undo_change_sets: string;
    }>(`
      SELECT
        (SELECT status FROM candidate_answer_change_sets WHERE id = '${origin.changeSetId}') AS status,
        (SELECT current_answer.answer_version_id::text
         FROM candidate_answers_current current_answer
         JOIN canonical_fields canonical ON canonical.id = current_answer.canonical_id
         WHERE current_answer.candidate_id = '${candidateId}' AND canonical.canonical_key = 'FULL_NAME') AS current_name,
        (SELECT current_answer.answer_version_id::text
         FROM candidate_answers_current current_answer
         JOIN canonical_fields canonical ON canonical.id = current_answer.canonical_id
         WHERE current_answer.candidate_id = '${candidateId}' AND canonical.canonical_key = 'EMAIL') AS current_email,
        (SELECT count(*)::text FROM candidate_answer_change_sets
         WHERE candidate_id = '${candidateId}' AND source = 'USER_UNDO') AS undo_change_sets
    `);
    assert.deepEqual(audit.rows[0], {
      status: "PARTIALLY_REVERSED",
      current_name: newerName.answerVersionId,
      current_email: newerEmail.answerVersionId,
      undo_change_sets: "0"
    });
  } finally {
    await kysely.destroy();
  }
});

test("Undo and a newer write serialize without ever clobbering newer candidate intent", async () => {
  const { database, kysely, service } = await setup();
  try {
    const origin = await service.save({
      accountId,
      candidateId,
      canonicalKey: "EMAIL",
      normalizedValue: email("race-origin@example.com"),
      scopeType: "GLOBAL",
      source: "USER_MANUAL",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: null,
      idempotencyKey: "e4-undo-write-race-origin"
    });
    const [writeOutcome, undoOutcome] = await Promise.allSettled([
      service.save({
        accountId,
        candidateId,
        canonicalKey: "EMAIL",
        normalizedValue: email("race-newer@example.com"),
        scopeType: "GLOBAL",
        source: "USER_CORRECTION",
        commitPoint: "EXPLICIT_SAVE",
        expectedCurrentVersionId: origin.answerVersionId,
        idempotencyKey: "e4-undo-write-race-newer"
      }),
      service.undoChangeSet({
        accountId,
        candidateId,
        targetChangeSetId: origin.changeSetId,
        idempotencyKey: "e4-undo-write-race-undo"
      })
    ]);
    assert.equal(undoOutcome.status, "fulfilled");
    const current = await database.query<{ id: string; value: string; trust_state: string }>(`
      SELECT version.id, version.text_value AS value, version.trust_state
      FROM candidate_answers_current current_answer
      JOIN candidate_answer_versions version ON version.id = current_answer.answer_version_id
      JOIN canonical_fields canonical ON canonical.id = current_answer.canonical_id
      WHERE current_answer.candidate_id = '${candidateId}' AND canonical.canonical_key = 'EMAIL'
    `);
    if (writeOutcome.status === "fulfilled") {
      assert.equal(current.rows[0]?.id, writeOutcome.value.answerVersionId);
      assert.equal(current.rows[0]?.value, "race-newer@example.com");
      assert.equal(
        undoOutcome.status === "fulfilled"
          ? undoOutcome.value.summary.skippedNewerVersion
          : 0,
        1
      );
    } else {
      assert.equal("code" in writeOutcome.reason && writeOutcome.reason.code, "CONFLICT");
      assert.equal(current.rows[0]?.trust_state, "REMOVED");
    }
  } finally {
    await kysely.destroy();
  }
});

test("Undo restores both a promoted REVIEW and a removed contextual override", async () => {
  const { database, kysely, repository, service } = await setup();
  try {
    const originRun = await applicationRun(database, 0x100, "COMPLETED");
    const originCheckpoint = await completeRun(database, originRun, 0x102);
    const review = await service.save({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      normalizedValue: money("2400000"),
      scopeType: "GLOBAL",
      source: "USER_CORRECTION",
      commitPoint: "VERIFIED_SUBMISSION",
      applicationId: originCheckpoint.applicationId,
      checkpointId: originCheckpoint.checkpointId,
      expectedCurrentVersionId: null,
      idempotencyKey: "e4-review-origin"
    });
    assert.equal(review.trustState, "REVIEW");
    const resolver = new CandidateTruthResolver(repository, { now: () => now });
    const trial = await resolver.resolve({ accountId, candidateId, canonicalKey: "EXPECTED_CTC", context: {} });
    if (trial.status !== "RESOLVED") throw new Error("Expected REVIEW trial resolution.");
    const trialRun = await applicationRun(database, 0x110, "ACTIVE");
    const proof = await service.recordTrialOutcome({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      scopeType: "GLOBAL",
      context: {},
      applicationId: trialRun.applicationId,
      runId: trialRun.runId,
      operationId: uuid(0x112),
      sequence: 1,
      usedAnswerVersionId: trial.answerVersionId,
      usedScopeFingerprint: trial.scope.scopeFingerprint,
      outcome: "CONFIRMED_UNCHANGED",
      finalActor: "COPILOT",
      finalNormalizedValue: money("2400000.00"),
      idempotencyKey: "e4-review-proof"
    });
    const trialCheckpoint = await completeRun(database, trialRun, 0x113);
    const promoted = await service.applyVerifiedTrialOutcome({
      accountId,
      candidateId,
      usageProofId: proof.usageProofId,
      canonicalKey: "EXPECTED_CTC",
      applicationId: trialCheckpoint.applicationId,
      runId: trialCheckpoint.runId,
      checkpointId: trialCheckpoint.checkpointId,
      usedAnswerVersionId: trial.answerVersionId,
      usedScopeFingerprint: trial.scope.scopeFingerprint,
      outcome: "CONFIRMED_UNCHANGED",
      finalNormalizedValue: money("2400000.00"),
      idempotencyKey: "e4-review-promotion"
    });
    const undoPromotion = await service.undoChangeSet({
      accountId,
      candidateId,
      targetChangeSetId: promoted.changeSetId,
      idempotencyKey: "e4-undo-promotion"
    });
    assert.deepEqual(undoPromotion.summary, { restored: 1, forgotten: 0, skippedNewerVersion: 0 });
    const reviewAgain = await repository.findCurrent({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      entityId: null,
      scopeFingerprint: globalFingerprint()
    });
    assert.equal(reviewAgain?.trustState, "REVIEW");
    assert.equal(reviewAgain?.normalizedValue.kind === "MONEY" && reviewAgain.normalizedValue.amountExact, "2400000");
    const promotionLineage = await database.query<{
      source: string;
      trust_state: string;
      confirmed_at: Date | string;
      restores_version_id: string;
      policy_matches: boolean;
    }>(`
      SELECT
        restored.source,
        restored.trust_state,
        restored.confirmed_at,
        restored.restores_version_id,
        restored.policy_id = original.policy_id AS policy_matches
      FROM candidate_answer_versions restored
      JOIN candidate_answer_versions original ON original.id = '${review.answerVersionId}'
      WHERE restored.id = '${reviewAgain?.answerVersionId}'
    `);
    assert.deepEqual(
      {
        source: promotionLineage.rows[0]?.source,
        trustState: promotionLineage.rows[0]?.trust_state,
        confirmedAt: new Date(promotionLineage.rows[0]?.confirmed_at as Date | string).toISOString(),
        restoresVersionId: promotionLineage.rows[0]?.restores_version_id,
        policyMatches: promotionLineage.rows[0]?.policy_matches
      },
      {
        source: "USER_CORRECTION",
        trustState: "REVIEW",
        confirmedAt: now.toISOString(),
        restoresVersionId: review.answerVersionId,
        policyMatches: true
      },
      "Undo restores the prior answer's provenance, trust, confirmation time, and policy"
    );

    const global = await service.save({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      normalizedValue: money("2500000"),
      scopeType: "GLOBAL",
      source: "USER_CORRECTION",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: reviewAgain?.answerVersionId ?? null,
      idempotencyKey: "e4-removal-global"
    });
    const search = await service.save({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      normalizedValue: money("2500000.00"),
      scopeType: "SEARCH",
      context: { countryCode: "IN" },
      source: "USER_CORRECTION",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: null,
      idempotencyKey: "e4-removal-search"
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
    const removal = await service.removeRedundantOverride({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      context: { countryCode: "IN" },
      overrideAnswerVersionId: search.answerVersionId,
      overrideScopeFingerprint: searchScope.scopeFingerprint,
      inheritedAnswerVersionId: global.answerVersionId,
      inheritedScopeFingerprint: globalScope.scopeFingerprint,
      idempotencyKey: "e4-remove-search"
    });
    const undoRemoval = await service.undoChangeSet({
      accountId,
      candidateId,
      targetChangeSetId: removal.changeSetId,
      idempotencyKey: "e4-undo-removal"
    });
    assert.deepEqual(undoRemoval.summary, { restored: 1, forgotten: 0, skippedNewerVersion: 0 });
    const restoredSearch = await repository.findCurrent({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      entityId: null,
      scopeFingerprint: searchScope.scopeFingerprint
    });
    assert.equal(restoredSearch?.trustState, "TRUSTED");
    assert.equal(
      restoredSearch?.normalizedValue.kind === "MONEY" && restoredSearch.normalizedValue.amountExact,
      "2500000"
    );
  } finally {
    await kysely.destroy();
  }
});

test("historical Restore appends trusted truth, refreshes confirmation, and rejects stale or foreign commands", async () => {
  const { database, kysely, repository, service } = await setup();
  try {
    const first = await service.save({
      accountId,
      candidateId,
      canonicalKey: "EMAIL",
      normalizedValue: email("history.one@example.com"),
      scopeType: "GLOBAL",
      source: "USER_MANUAL",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: null,
      idempotencyKey: "e4-restore-v1"
    });
    const second = await service.save({
      accountId,
      candidateId,
      canonicalKey: "EMAIL",
      normalizedValue: email("history.two@example.com"),
      scopeType: "GLOBAL",
      source: "USER_MANUAL",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: first.answerVersionId,
      idempotencyKey: "e4-restore-v2"
    });
    await assert.rejects(
      service.restoreVersion({
        accountId,
        candidateId,
        targetVersionId: second.answerVersionId,
        expectedCurrentVersionId: second.answerVersionId,
        idempotencyKey: "e4-reject-already-current-restore"
      }),
      /already current/i
    );
    const restoredAt = new Date("2026-09-02T12:00:00.000Z");
    const restoreService = new CandidateTruthService(
      repository,
      new HmacCandidateValueFingerprinter("e4-test-secret-key-that-is-at-least-32-bytes", 1),
      { now: () => restoredAt }
    );
    const command = {
      accountId,
      candidateId,
      targetVersionId: first.answerVersionId,
      expectedCurrentVersionId: second.answerVersionId,
      idempotencyKey: "e4-restore-history"
    };
    const restored = await restoreService.restoreVersion(command);
    assert.deepEqual(restored.summary, { restored: 1, forgotten: 0, skippedNewerVersion: 0 });
    assert.notEqual(restored.items[0]?.compensatingVersionId, first.answerVersionId);
    assert.equal(restored.targetVersionId, first.answerVersionId);

    const replay = await restoreService.restoreVersion(command);
    assert.equal(replay.reversalSetId, restored.reversalSetId);
    assert.equal(replay.idempotentReplay, true);
    await assert.rejects(
      restoreService.restoreVersion({ ...command, expectedCurrentVersionId: null }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "IDEMPOTENCY_CONFLICT"
    );
    await assert.rejects(
      restoreService.restoreVersion({
        ...command,
        idempotencyKey: "e4-restore-stale-current"
      }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CONFLICT"
    );
    await assert.rejects(
      restoreService.restoreVersion({
        accountId: otherAccountId,
        candidateId: otherCandidateId,
        targetVersionId: first.answerVersionId,
        expectedCurrentVersionId: null,
        idempotencyKey: "e4-restore-foreign-version"
      }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "NOT_FOUND"
    );

    const persisted = await database.query<{
      source: string;
      trust_state: string;
      restores_version_id: string;
      supersedes_version_id: string;
      value: string;
      confirmed_at: Date | string;
      outbox: Record<string, unknown>;
    }>(`
      SELECT
        version.source,
        version.trust_state,
        version.restores_version_id,
        version.supersedes_version_id,
        version.text_value AS value,
        version.confirmed_at,
        outbox.payload_reference AS outbox
      FROM candidate_answer_versions version
      JOIN outbox_events outbox
        ON outbox.payload_reference->>'restoredVersionId' = version.id::text
      WHERE version.id = '${restored.items[0]?.compensatingVersionId}'
    `);
    assert.deepEqual(
      {
        source: persisted.rows[0]?.source,
        trustState: persisted.rows[0]?.trust_state,
        restoresVersionId: persisted.rows[0]?.restores_version_id,
        supersedesVersionId: persisted.rows[0]?.supersedes_version_id,
        value: persisted.rows[0]?.value
      },
      {
        source: "USER_RESTORE",
        trustState: "TRUSTED",
        restoresVersionId: first.answerVersionId,
        supersedesVersionId: second.answerVersionId,
        value: "history.one@example.com"
      }
    );
    assert.equal(new Date(persisted.rows[0]?.confirmed_at as Date | string).toISOString(), restoredAt.toISOString());
    assert.doesNotMatch(JSON.stringify(persisted.rows[0]?.outbox), /history|example\.com/i);

    const history = await service.reversalHistory({ accountId, candidateId, limit: 10 });
    assert.equal(history.some((entry) => entry.reversalSetId === restored.reversalSetId), true);
    const foreignHistory = await service.reversalHistory({
      accountId: otherAccountId,
      candidateId: otherCandidateId,
      limit: 10
    });
    assert.equal(foreignHistory.length, 0);
  } finally {
    await kysely.destroy();
  }
});

test("Restore fails closed when repeatable identity is inactive or canonical policy drifted", async () => {
  const entitySetup = await setup();
  try {
    const entityId = uuid(0x300);
    await entitySetup.database.exec(`
      INSERT INTO candidate_entities (id, candidate_id, entity_type, status)
      VALUES ('${entityId}', '${candidateId}', 'EMPLOYMENT', 'ACTIVE')
    `);
    const first = await entitySetup.service.save({
      accountId,
      candidateId,
      canonicalKey: "EMPLOYMENT_COMPANY",
      normalizedValue: fullName("First Employer"),
      scopeType: "GLOBAL",
      entityId,
      source: "USER_MANUAL",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: null,
      idempotencyKey: "e4-restore-entity-v1"
    });
    const second = await entitySetup.service.save({
      accountId,
      candidateId,
      canonicalKey: "EMPLOYMENT_COMPANY",
      normalizedValue: fullName("Second Employer"),
      scopeType: "GLOBAL",
      entityId,
      source: "USER_CORRECTION",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: first.answerVersionId,
      idempotencyKey: "e4-restore-entity-v2"
    });
    await entitySetup.database.exec(`UPDATE candidate_entities SET status = 'REMOVED' WHERE id = '${entityId}'`);
    await assert.rejects(
      entitySetup.service.restoreVersion({
        accountId,
        candidateId,
        targetVersionId: first.answerVersionId,
        expectedCurrentVersionId: second.answerVersionId,
        idempotencyKey: "e4-reject-inactive-entity-restore"
      }),
      /entity is no longer active|entity.*compatible/i
    );
  } finally {
    await entitySetup.kysely.destroy();
  }

  const policySetup = await setup();
  try {
    const first = await policySetup.service.save({
      accountId,
      candidateId,
      canonicalKey: "EMAIL",
      normalizedValue: email("policy-first@example.com"),
      scopeType: "GLOBAL",
      source: "USER_MANUAL",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: null,
      idempotencyKey: "e4-restore-policy-v1"
    });
    const second = await policySetup.service.save({
      accountId,
      candidateId,
      canonicalKey: "EMAIL",
      normalizedValue: email("policy-second@example.com"),
      scopeType: "GLOBAL",
      source: "USER_CORRECTION",
      commitPoint: "EXPLICIT_SAVE",
      expectedCurrentVersionId: first.answerVersionId,
      idempotencyKey: "e4-restore-policy-v2"
    });
    await policySetup.database.exec(`UPDATE canonical_fields SET status = 'DEPRECATED' WHERE canonical_key = 'EMAIL'`);
    await assert.rejects(
      policySetup.service.restoreVersion({
        accountId,
        candidateId,
        targetVersionId: first.answerVersionId,
        expectedCurrentVersionId: second.answerVersionId,
        idempotencyKey: "e4-reject-policy-drift-restore"
      }),
      /policy changed|policy drift|incompatible/i
    );
  } finally {
    await policySetup.kysely.destroy();
  }
});
import { migrateGlobalAnswerDefaults } from "./index.js";

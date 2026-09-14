import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { HmacCandidateValueFingerprinter, CandidateTruthService } from "@job-hunter-v2/candidate-truth";
import { AesGcmCandidatePayloadCipher } from "@job-hunter-v2/onboarding";
import { VerifiedLearningService } from "@job-hunter-v2/verified-learning";
import { ExecutionReceiptSchema } from "@job-hunter-v2/contracts";
import { StrategyIntelligenceService, digest, metrics } from "@job-hunter-v2/strategy-intelligence";
import { KyselyCandidateTruthRepository, KyselyVerifiedLearningRepository, KyselyStrategyRepository, StrategyJobQueue,
  migrateInitialSchema, migrateCandidateTruthOntology, migrateCandidateTruthMutationGuards, migrateCandidateScopePolicyVectors,
  migrateCandidateReviewOutcomeProofs, migrateCandidateAnswerReversals, migrateJobIntelligence, migrateVerifiedLearningLoop,
  migrateRepeatableEntityIntelligence, migrateStrategyIntelligence, migrateStrategyOperations, type V2Database, type SqlClient
} from "@job-hunter-v2/database";
import { StrategyReceiptBridge } from "./strategy-bridges.js";
import { StrategyWorker } from "./strategy-worker.js";

test("Q real L receipt → atomic job → binding/attribution → evaluation is private, replay-safe and tenant-authorized", async () => {
  const pg = new PGlite();
  const executor = (target: Pick<PGlite, "query" | "exec">) => ({
    query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => ({ rows: (await target.query<Row>(text, values ? [...values] : undefined)).rows }),
    executeScript: async (text: string) => target.exec(text).then(() => undefined)
  });
  const client: SqlClient = { ...executor(pg), withTransaction: (work) => pg.transaction((tx) => work(executor(tx))) };
  for (const migrate of [migrateInitialSchema, migrateCandidateTruthOntology, migrateCandidateTruthMutationGuards, migrateCandidateScopePolicyVectors,
    migrateCandidateReviewOutcomeProofs, migrateCandidateAnswerReversals, migrateJobIntelligence, migrateVerifiedLearningLoop,
    migrateRepeatableEntityIntelligence, migrateStrategyIntelligence, migrateStrategyOperations, migrateGlobalAnswerDefaults]) await migrate(client);
  const db = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: pg }) });
  try {
    const accountId = crypto.randomUUID(), candidateId = crypto.randomUUID(), pageInstanceId = crypto.randomUUID();
    await pg.query("INSERT INTO accounts(id,account_type,contributes_to_global_learning) VALUES($1,'NORMAL',true)", [accountId]);
    const fingerprinter = new HmacCandidateValueFingerprinter("integration-fixture-secret".repeat(2), 1);
    const truth = new CandidateTruthService(new KyselyCandidateTruthRepository(db), fingerprinter);
    await truth.ensureCandidate({ accountId, candidateId });
    const answer = await truth.save({ accountId, candidateId, canonicalKey: "EMAIL", scopeType: "GLOBAL", source: "PROFILE",
      commitPoint: "EXPLICIT_SAVE", expectedCurrentVersionId: null, idempotencyKey: crypto.randomUUID(),
      normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: "synthetic-private@example.test" } });
    const saved = await pg.query<{ scope_fingerprint: string }>("SELECT s.scope_fingerprint FROM candidate_answer_versions v JOIN candidate_answer_scopes s ON s.id=v.scope_id WHERE v.id=$1", [answer.answerVersionId]);
    const learning = new VerifiedLearningService(new KyselyVerifiedLearningRepository(db, undefined, true), fingerprinter,
      new AesGcmCandidatePayloadCipher(new Uint8Array(32).fill(5), 1));
    const run = await learning.startRun({ accountId, candidateId, idempotencyKey: crypto.randomUUID(), request: {
      schemaVersion: 1, requestId: crypto.randomUUID(), jobId: null, targetUrl: "https://fixture.test/apply", extensionVersion: "2.0.0", protocolVersion: 1 } });
    const repository = new KyselyStrategyRepository(db), q = new StrategyIntelligenceService(repository, "q-test-secret".repeat(4));
    await q.initialize();
    const selection = await q.select({ capability: "NATIVE_TEXT", representationKind: "TEXT", representationId: "TEXT@1",
      structuralFingerprint: "c".repeat(64), siteFamily: "OTHER" }, { accountId, candidateId }, run.applicationRunId);
    const operationId = crypto.randomUUID();
    const binding = { accountId, candidateId, operationId, applicationRunId: run.applicationRunId, pageInstanceId,
      fieldRuntimeId: "field:integration", representationId: "TEXT@1", selection, recordedAt: new Date().toISOString() };
    await repository.bindMany([binding]); await repository.bindMany([binding]);
    assert.equal(await repository.binding({ accountId: crypto.randomUUID(), candidateId }, operationId), null);
    await assert.rejects(repository.bind({ ...binding, operationId: crypto.randomUUID(), candidateId: crypto.randomUUID() }), /AUTHORITY/);
    await assert.rejects(repository.bind({ ...binding, representationId: "OTHER@1" }), /REPLAY/);
    const receipt = ExecutionReceiptSchema.parse({ schemaVersion: 1, operationId, applicationRunId: run.applicationRunId, pageInstanceId,
      fieldRuntimeId: binding.fieldRuntimeId, graphNodeId: "graph:field:12345678", graphGuard: { pageInstanceId, graphRevision: 1, graphFingerprint: "d".repeat(64) },
      canonicalKey: "EMAIL", answerVersionId: answer.answerVersionId, answerScopeFingerprint: saved.rows[0]!.scope_fingerprint, trialReuse: false,
      representationId: "TEXT@1", representationPolicyVersion: 1, status: "VERIFIED", verificationStatus: "VERIFIED", failureClass: null,
      selectedStrategyId: "NATIVE_VALUE_SETTER@1", attempts: [{ attempt: 1, strategyId: "NATIVE_VALUE_SETTER@1", capability: "NATIVE_TEXT",
        executionStatus: "EXECUTED", verificationStatus: "VERIFIED", failureClass: null, durationMs: 10, retryable: false, structuralChange: false }],
      retryable: false, requiresUserReview: false, structuralChange: false, durationMs: 10, valuePrivate: true, containsCandidateValue: false });
    const input = { accountId, candidateId, request: { schemaVersion: 1 as const, requestId: crypto.randomUUID(), applicationId: run.applicationId, applicationRunId: run.applicationRunId, receipt } };
    const outcomes = await Promise.all([learning.recordExecutionEvidence(input), learning.recordExecutionEvidence(input)]);
    assert.equal(outcomes.filter((r) => !r.idempotentReplay).length, 1);
    assert.equal((await pg.query("SELECT id FROM worker_jobs")).rows.length, 1);
    const queue = new StrategyJobQueue(db), bridge = new StrategyReceiptBridge(repository);
    const worker = new StrategyWorker(queue, bridge, q, repository);
    // Process only through durable leases: no synchronous receipt hook can mask a broken worker.
    assert.equal(await worker.runOne(), true); assert.equal(await worker.runOne(), true);
    let evidence = await repository.evidence(selection.cluster, "2020-01-01T00:00:00Z");
    assert.equal(evidence.length, 1); assert.equal(evidence[0]!.verified, true);
    await bridge.record({ accountId, candidateId }, receipt);
    assert.equal((await repository.evidence(selection.cluster, "2020-01-01T00:00:00Z")).length, 1);
    await assert.rejects(bridge.record({ accountId, candidateId }, { ...receipt, attempts: [{ ...receipt.attempts[0]!, strategyId: "INVENTED@1" }] }), /UNASSIGNED/);
    await assert.rejects(bridge.record({ accountId, candidateId }, { ...receipt, fieldRuntimeId: "field:unrelated" }), /CONTEXT/);
    await assert.rejects(repository.append({ ...evidence[0]!, eventId: digest("foreign"), arm: "TREATMENT" }), /ASSIGNMENT/);
    await assert.rejects(repository.append({ ...evidence[0]!, durationMs: 99 }), /REPLAY/);
    await assert.rejects(pg.exec("DELETE FROM strategy_performance_evidence"), /append-only/);
    const observationId = crypto.randomUUID();
    await learning.recordObservation({ accountId, candidateId, idempotencyKey: observationId, request: {
      schemaVersion: 1, requestId: crypto.randomUUID(), observationId, applicationId: run.applicationId, applicationRunId: run.applicationRunId,
      pageInstanceId, formInstanceId: "form:integration", fieldRuntimeId: binding.fieldRuntimeId, controlFingerprint: "control:integration",
      controlType: "EMAIL", labelEvidence: ["Email"], canonicalKey: "EMAIL", descriptorFingerprint: "b".repeat(64), semanticState: "RESOLVED_HIGH",
      semanticConfidence: 0.99, semanticResolver: "EXACT_ALIAS",
      entityBinding: { entityType: null, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel: null },
      answerVersionId: answer.answerVersionId, answerScopeFingerprint: saved.rows[0]!.scope_fingerprint, priorOperationId: operationId,
      priorVerificationStatus: "VERIFIED", priorFailureClass: null, origin: "USER_CORRECTED", observationType: "COPILOT_CORRECTION",
      strategyFeedback: { pattern: ["FOCUS", "TYPE", "ENTER"], committed: true, feedback: "OVERWRITTEN" },
      value: { kind: "TEXT", value: "new-private@example.test" }, occurredAt: new Date().toISOString() } });
    assert.equal(await worker.runOne(), true); assert.equal(await worker.runOne(), true);
    evidence = await repository.evidence(selection.cluster, "2020-01-01T00:00:00Z");
    const m = metrics(evidence, "NATIVE_VALUE_SETTER@1").recent;
    assert.equal(m.attempts, 1); assert.equal(m.verifiedSuccesses, 1); assert.equal(m.overwrites, 1);
    const safe = JSON.stringify((await pg.query("SELECT payload_reference FROM worker_jobs")).rows) + JSON.stringify(evidence);
    assert.equal(safe.includes("synthetic-private"), false); assert.equal(safe.includes("new-private"), false);
    await pg.query("UPDATE accounts SET contributes_to_global_learning=false WHERE id=$1", [accountId]);
    assert.equal((await repository.evidence(selection.cluster, "2020-01-01T00:00:00Z")).length, 0);
  } finally { await db.destroy(); }
});
import { migrateGlobalAnswerDefaults } from "@job-hunter-v2/database";

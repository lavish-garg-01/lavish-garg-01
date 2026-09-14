import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CandidateTruthResolver, HmacCandidateValueFingerprinter, CandidateTruthService } from "@job-hunter-v2/candidate-truth";
import { AesGcmCandidatePayloadCipher } from "@job-hunter-v2/onboarding";
import { VerifiedLearningService } from "@job-hunter-v2/verified-learning";
import { Kysely, PGliteDialect } from "kysely";
import type { ConfirmLearningNote } from "@job-hunter-v2/contracts";
import {
  KyselyCandidateTruthRepository,
  KyselyVerifiedLearningRepository,
  learningCheckpointUnitOfWork,
  KyselyLearningRecovery,
  migrateLearningRecovery,
  migrateLearningNoteConfirmation,
  migrateLearningFingerprintVersions,
  migrateLearningInboxLifecycle,
  purgeExpiredLearningInbox,
  migrateOperatorReview,
  migrateOperatorWorkflow,
  migrateSupportReview,
  migrateCaseMerge,
  OperatorReviewRepository,
  migrateCandidateScopePolicyVectors,
  migrateCandidateReviewOutcomeProofs,
  migrateCandidateAnswerReversals,
  migrateCandidateTruthMutationGuards,
  migrateCandidateTruthOntology,
  migrateInitialSchema,
  migrateJobIntelligence,
  migrateVerifiedLearningLoop,
  migrateRepeatableEntityIntelligence,
  type SqlClient,
  type V2Database
} from "./index.js";

function client(database: PGlite): SqlClient {
  const executor = (target: Pick<PGlite, "query" | "exec">) => ({
    query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => ({ rows: (await target.query<Row>(text, values ? [...values] : undefined)).rows }),
    executeScript: async (text: string) => { await target.exec(text); }
  });
  return { ...executor(database), withTransaction: async (work) => database.transaction((transaction) => work(executor(transaction))) };
}

test("unknown manual answer is encrypted, value-free in evidence and idempotent while its run is active", async () => {
  const database = new PGlite();
  const migration = client(database);
  await migrateInitialSchema(migration);
  await migrateCandidateTruthOntology(migration);
  await migrateCandidateTruthMutationGuards(migration);
  await migrateCandidateScopePolicyVectors(migration);
  await migrateCandidateReviewOutcomeProofs(migration);
  await migrateCandidateAnswerReversals(migration);
  await migrateJobIntelligence(migration);
  await migrateVerifiedLearningLoop(migration);
  await migrateRepeatableEntityIntelligence(migration);
  await migrateGlobalAnswerDefaults(migration);
  const accountId = "a0000000-0000-4000-8000-000000000001";
  const candidateId = "a0000000-0000-4000-8000-000000000002";
  await database.exec(`INSERT INTO accounts (id, account_type, contributes_to_global_learning) VALUES ('${accountId}', 'NORMAL', true)`);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  const fingerprinter = new HmacCandidateValueFingerprinter("verified-learning-test-secret-at-least-32-bytes", 1);
  const truth = new CandidateTruthService(new KyselyCandidateTruthRepository(kysely), fingerprinter);
  await truth.ensureCandidate({ accountId, candidateId });
  const service = new VerifiedLearningService(
    new KyselyVerifiedLearningRepository(kysely),
    fingerprinter,
    new AesGcmCandidatePayloadCipher(new Uint8Array(32).fill(7), 1)
  );
  const run = await service.startRun({ accountId, candidateId, idempotencyKey: "launch:manual-answer", request: {
    schemaVersion: 1, requestId: crypto.randomUUID(), jobId: null,
    targetUrl: "https://apply.example.test/job", extensionVersion: "0.1.0", protocolVersion: 1
  } });
  const observationId = crypto.randomUUID();
  await migrateLearningRecovery(migration);
  await migrateLearningNoteConfirmation(migration);
  await migrateLearningInboxLifecycle(migration);
  await migrateLearningFingerprintVersions(migration);
  const recovery = new KyselyLearningRecovery(kysely, new AesGcmCandidatePayloadCipher(new Uint8Array(32).fill(7), 1), fingerprinter);
  const owner = { accountId, candidateId };
  const item = { schemaVersion: 1 as const, itemId: crypto.randomUUID(), applicationId: run.applicationId, applicationRunId: run.applicationRunId, question: "Unmapped question", answer: "Private synthetic answer", source: "EXPLICIT_SAVE" as const };
  await recovery.capture(owner, item);
  assert.equal((await recovery.capture(owner, item)).idempotentReplay, true);
  await assert.rejects(recovery.capture(owner, { ...item, answer: "Changed" }), /cannot be verified/);
  assert.equal((await recovery.list(owner))[0]?.evidence?.answer, item.answer);
  const ciphertext = await database.query("SELECT payload FROM candidate_learning_inbox");
  assert.equal(JSON.stringify(ciphertext.rows).includes(item.answer), false);
  assert.equal((await recovery.list({ ...owner, candidateId: crypto.randomUUID() })).length, 0);
  await assert.rejects(recovery.capture({ ...owner, candidateId: crypto.randomUUID() }, { ...item, itemId: crypto.randomUUID() }), /not found/);
  assert.equal((await database.query<{ count: number }>("SELECT count(*)::int AS count FROM candidate_answer_change_sets")).rows[0]?.count, 0);
  await recovery.remove(owner, item.itemId);
  assert.equal((await recovery.list(owner))[0]?.evidence, null);
  assert.equal((await recovery.capture(owner, item)).status, "DELETED");
  assert.equal((await database.query<{ payload: unknown }>("SELECT payload FROM candidate_learning_inbox")).rows[0]?.payload, null);
  const expired = { ...item, itemId: crypto.randomUUID() };
  await recovery.capture(owner, expired);
  await database.query("UPDATE candidate_learning_inbox SET expires_at = now() - interval '1 day' WHERE id = $1", [expired.itemId]);
  assert.equal((await recovery.list(owner)).find((row) => row.itemId === expired.itemId)?.status, "EXPIRED");
  assert.equal((await recovery.capture(owner, expired)).status, "EXPIRED", "expired replay must never pretend the note is pending");
  assert.equal((await recovery.list(owner)).find((row) => row.itemId === expired.itemId)?.evidence, null);
  const confirmedNote = { ...item, itemId: crypto.randomUUID(), answer: "Confirmed" };
  await recovery.capture(owner, confirmedNote);
  const confirmation = { canonicalKey: "FIRST_NAME" as const, answer: "Confirmed", expectedCurrentVersionId: null, confirmedGlobalDefault: true as const };
  await assert.rejects(recovery.confirm(owner, expired.itemId, confirmation), /expired/);
  await assert.rejects(recovery.confirm({ ...owner, candidateId: crypto.randomUUID() }, confirmedNote.itemId, confirmation), /not found/);
  await assert.rejects(recovery.confirm(owner, confirmedNote.itemId, { ...confirmation, canonicalKey: "CURRENT_CTC" } as never));
  const confirmed = await recovery.confirm(owner, confirmedNote.itemId, confirmation);
  assert.ok(confirmed.changeSetId);
  assert.deepEqual(await recovery.confirm(owner, confirmedNote.itemId, confirmation), { ...confirmed, idempotentReplay: true });
  await assert.rejects(recovery.confirm(owner, confirmedNote.itemId, { ...confirmation, answer: "Changed" }), /cannot be verified/);
  const staleNote = { ...confirmedNote, itemId: crypto.randomUUID() };
  await recovery.capture(owner, staleNote);
  await assert.rejects(recovery.confirm(owner, staleNote.itemId, { ...confirmation, answer: "Overwrite" }), /changed|current|version|conflict/i);
  const typedAnswers: ConfirmLearningNote[] = [
    { ...confirmation, canonicalKey: "CURRENT_CTC", answer: "14", currency: "INR", scale: "LAKH", period: "YEAR" },
    { ...confirmation, canonicalKey: "EXPECTED_CTC", answer: "20", currency: "INR", scale: "LAKH", period: "YEAR" },
    { ...confirmation, canonicalKey: "NOTICE_PERIOD", answer: "45", unit: "DAYS" },
    { ...confirmation, canonicalKey: "TOTAL_EXPERIENCE", answer: "44", unit: "MONTHS" },
    { ...confirmation, canonicalKey: "LAST_WORKING_DAY", answer: "2024-02-29" },
    { ...confirmation, canonicalKey: "GITHUB_URL", answer: "https://github.com/synthetic" }
  ];
  const noteResolver = new CandidateTruthResolver(new KyselyCandidateTruthRepository(kysely));
  for (const input of typedAnswers) {
    const typedNote = { ...item, itemId: crypto.randomUUID(), answer: input.answer };
    await recovery.capture(owner, typedNote);
    const before = await database.query("SELECT id FROM candidate_answer_change_sets");
    const preview = await recovery.preview(owner, typedNote.itemId, input);
    assert.equal((await database.query("SELECT id FROM candidate_answer_change_sets")).rows.length, before.rows.length, "preview cannot write truth");
    await assert.rejects(recovery.preview({ ...owner, candidateId: crypto.randomUUID() }, typedNote.itemId, input), /not found/);
    const saved = await recovery.confirm(owner, typedNote.itemId, input);
    assert.ok(saved.changeSetId);
    assert.equal((await recovery.confirm(owner, typedNote.itemId, input)).idempotentReplay, true);
    const reused = await noteResolver.resolve({ ...owner, canonicalKey: input.canonicalKey, context: {} });
    assert.equal(reused.status, "RESOLVED");
    if (reused.status === "RESOLVED") assert.deepEqual(reused.normalizedValue, preview.normalizedValue);
    await recovery.remove(owner, typedNote.itemId);
    assert.equal((await noteResolver.resolve({ ...owner, canonicalKey: input.canonicalKey, context: {} })).status, "RESOLVED", "deleting evidence cannot undo the profile");
    assert.equal((await recovery.confirm(owner, typedNote.itemId, input)).changeSetId, saved.changeSetId);
  }
  // Stable keyset pagination includes identical timestamps and survives a deleted cursor.
  await kysely.transaction().execute(async transaction=>{
    const batch=new KyselyLearningRecovery(transaction,new AesGcmCandidatePayloadCipher(new Uint8Array(32).fill(7),1),fingerprinter);
    for (let n = 0; n < 105; n++) await batch.capture(owner, { ...item, itemId: crypto.randomUUID() });
  });
  const allIds = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await recovery.listPage(owner, { cursor, limit: 7 });
    for (const entry of page.items) { assert.equal(allIds.has(entry.itemId), false); allIds.add(entry.itemId); }
    cursor = page.nextCursor ?? undefined;
    if (cursor) await recovery.remove(owner, cursor);
  } while (cursor);
  assert.equal(allIds.size, (await database.query<{ count: number }>("SELECT count(*)::int AS count FROM candidate_learning_inbox")).rows[0]!.count);
  assert.ok(allIds.size > 100);
  await assert.rejects(recovery.listPage({ ...owner, candidateId: crypto.randomUUID() }, { cursor: item.itemId }), /not found/);
  await assert.rejects(recovery.listPage(owner, { limit: 101 }));
  const cleanupNote = { ...item, itemId: crypto.randomUUID() };
  await recovery.capture(owner, cleanupNote);
  await database.query("UPDATE candidate_learning_inbox SET expires_at = now() - interval '1 day' WHERE id = $1", [cleanupNote.itemId]);
  await assert.rejects(recovery.preview(owner, cleanupNote.itemId, confirmation), /not found/);
  assert.equal((await purgeExpiredLearningInbox(kysely, 1)).purged, 1);
  assert.equal((await purgeExpiredLearningInbox(kysely, 1)).purged, 0);
  assert.equal((await recovery.capture(owner, cleanupNote)).status, "EXPIRED", "cleanup never resurrects evidence");
  assert.equal((await database.query<{ payload: unknown }>("SELECT payload FROM candidate_learning_inbox WHERE id=$1", [cleanupNote.itemId])).rows[0]!.payload, null);
  await assert.rejects(purgeExpiredLearningInbox(kysely, 1001));
  const event = { schemaVersion: 1 as const, eventId: crypto.randomUUID(), applicationId: run.applicationId, applicationRunId: run.applicationRunId, questionId: null, stage: "RESOLVE" as const, code: "API_TIMEOUT" as const, release: "ADAPTIVE_CHECKPOINT_4" as const, containsCandidateValue: false as const };
  for (let retry = 0; retry < 20; retry++) await recovery.recordOutcome(owner, event);
  await recovery.recordOutcome(owner, { ...event, eventId: crypto.randomUUID() });
  const grouped = await recovery.outcomes(owner);
  assert.equal(grouped.groups[0]?.events, 2);
  assert.equal(grouped.groups[0]?.affected_runs, 1);
  assert.equal(grouped.denominator, "REPORTED_FAILURES_ONLY");
  await migrateOperatorReview(migration);
  await migrateOperatorWorkflow(migration);
  await migrateSupportReview(migration);
  await migrateCaseMerge(migration);
  const operator = { issuer: "https://operator.example.test", subject: "reviewer" };
  const review = new OperatorReviewRepository(kysely);
  await assert.rejects(review.list(operator), /Platform operator/);
  assert.equal((await database.query<{ count: number }>("SELECT count(*)::int AS count FROM operator_review_audit WHERE action = 'ACCESS_DENIED'")).rows[0]?.count, 1);
  await assert.rejects(database.query("DELETE FROM operator_review_audit"), /append-only/);
  await database.query("INSERT INTO platform_operators(issuer,subject,role,active) VALUES($1,$2,'REVIEWER',true)", [operator.issuer,operator.subject]);
  const caseList = await review.list(operator);
  assert.equal(caseList.cases.length, 1);
  assert.equal(caseList.cases[0]?.affectedRuns, 1);
  assert.equal(JSON.stringify(caseList).includes(item.answer), false);
  const action = { caseId: caseList.cases[0]!.id, requestId: crypto.randomUUID(), expectedRevision: 1, status: "INVESTIGATING" as const };
  assert.equal((await review.transition(operator, action)).revision, 2);
  assert.equal((await review.transition(operator, action)).replay, true);
  await assert.rejects(review.transition(operator, { ...action, status: "RESOLVED" }), /reused/);
  await assert.rejects(review.transition(operator, { ...action, requestId: crypto.randomUUID() }), /changed/);
  assert.ok((await database.query<{count:number}>("SELECT count(*)::int AS count FROM operator_review_audit WHERE action = 'ACTION_FAILED'")).rows[0]!.count >= 2);
  const edit = {requestId:crypto.randomUUID(),expectedRevision:2,layer:"REPRESENTATION" as const,reproduction:"ADAPTIVE_AUTOFILL" as const,expectedBehavior:"FILL_VERIFIED_VALUE" as const};
  assert.equal((await review.edit(operator,action.caseId,edit)).revision,3);
  assert.equal((await review.edit(operator,action.caseId,edit)).revision,3);
  await assert.rejects(review.edit(operator,action.caseId,{...edit,requestId:action.requestId}),/reused/);
  await assert.rejects(review.transition(operator,{...action,requestId:edit.requestId,expectedRevision:3}),/reused/);
  await assert.rejects(review.edit(operator,action.caseId,{...edit,layer:"SCAN"}),/reused/);
  await assert.rejects(review.edit(operator,action.caseId,{...edit,requestId:crypto.randomUUID()}),/changed/);
  const details = await review.detail(operator,action.caseId);
  assert.equal(details.layer,"REPRESENTATION"); assert.equal(details.timeline.length,2);
  await assert.rejects(review.edit(operator,action.caseId,{...edit,reproduction:"https://evil.example"} as never));
  const provision={requestId:crypto.randomUUID(),issuer:operator.issuer,subject:"peer",role:"REVIEWER" as const,active:true};
  await assert.rejects(review.provision(operator,provision),/administrator/);
  await database.query("UPDATE platform_operators SET role = 'ADMIN' WHERE issuer = $1 AND subject = $2",[operator.issuer,operator.subject]);
  await assert.rejects(review.provision(operator,{...provision,subject:operator.subject}),/different target/);
  assert.equal((await review.provision(operator,provision)).updated,true);
  assert.equal((await review.provision(operator,provision)).updated,true);
  await assert.rejects(review.provision(operator,{...provision,requestId:action.requestId}),/reused/);
  await assert.rejects(review.provision(operator,{...provision,requestId:edit.requestId}),/reused/);
  await assert.rejects(review.provision(operator,{...provision,active:false}),/reused/);
  await assert.rejects(database.query("DELETE FROM operator_action_receipts"), /append-only/);
  assert.equal((await review.list({issuer:operator.issuer,subject:"peer"})).cases.length,1);
  await review.provision(operator,{...provision,requestId:crypto.randomUUID(),active:false});
  await assert.rejects(review.list({issuer:operator.issuer,subject:"peer"}),/Platform operator/);
  await database.query("UPDATE platform_operators SET active = false WHERE issuer = $1 AND subject = $2", [operator.issuer,operator.subject]);
  await assert.rejects(review.transition(operator, action), /Platform operator/);
  await assert.rejects(review.list(operator), /Platform operator/);
  await assert.rejects(recovery.recordOutcome(owner, { ...event, metadata: { harmless: item.answer } } as never));
  await assert.rejects(recovery.recordOutcome(owner, { ...event, code: "CHECKPOINT_FAILED" }), /different evidence/);
  await assert.rejects(recovery.recordOutcome({ ...owner, candidateId: crypto.randomUUID() }, event), /not found/);
  const request = {
    schemaVersion: 1 as const, requestId: crypto.randomUUID(), observationId,
    applicationId: run.applicationId, applicationRunId: run.applicationRunId,
    pageInstanceId: crypto.randomUUID(), formInstanceId: "form:12345678", fieldRuntimeId: "field:12345678",
    controlFingerprint: "control:12345678", controlType: "EMAIL" as const, labelEvidence: ["Email"], canonicalKey: "EMAIL",
    descriptorFingerprint: "a".repeat(64), semanticState: "RESOLVED_HIGH" as const, semanticConfidence: 0.99,
    semanticResolver: "EXACT_ALIAS" as const,
    entityBinding: { entityType: null, bindingKind: "NONE" as const, instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel: null },
    answerVersionId: null, answerScopeFingerprint: null, priorOperationId: null, priorVerificationStatus: null, priorFailureClass: null,
    origin: "USER_ENTERED" as const, observationType: "MANUAL_ANSWER" as const,
    value: { kind: "TEXT" as const, value: "candidate@example.com" }, occurredAt: new Date().toISOString()
  };
  const first = await service.recordObservation({ accountId, candidateId, request, idempotencyKey: `observation:${observationId}` });
  const replay = await service.recordObservation({ accountId, candidateId, request, idempotencyKey: `observation:${observationId}` });
  assert.equal(first.status, "RECORDED");
  assert.equal(replay.status, "DUPLICATE");
  const rotatedPrinter=new HmacCandidateValueFingerprinter("new-observation-fixture-secret-32-bytes",2,[{keyVersion:1,secret:"verified-learning-test-secret-at-least-32-bytes"}]);
  const rotatedService=new VerifiedLearningService(new KyselyVerifiedLearningRepository(kysely),rotatedPrinter,new AesGcmCandidatePayloadCipher(new Uint8Array(32).fill(7),1));
  assert.equal((await rotatedService.recordObservation({accountId,candidateId,request,idempotencyKey:`observation:${observationId}`})).status,"DUPLICATE");
  await assert.rejects(rotatedService.recordObservation({accountId,candidateId,request:{...request,value:{kind:"TEXT",value:"changed@example.test"}},idempotencyKey:`observation:${observationId}`}),/different input/);
  const stored = await database.query<{ structural_metadata: unknown; normalized_value_encrypted: Uint8Array }>(`
    SELECT event.structural_metadata, proposal.normalized_value_encrypted
    FROM candidate_learning_observations observation
    JOIN candidate_answer_runtime_proposals proposal ON proposal.id = observation.proposal_id
    JOIN application_events event ON event.application_id = observation.application_id AND event.reason_code = observation.attribution
    WHERE observation.id = '${observationId}'
  `);
  assert.equal(stored.rows.length, 1);
  assert.equal(JSON.stringify(stored.rows[0]?.structural_metadata).includes("candidate@example.com"), false);
  assert.equal(Buffer.from(stored.rows[0]?.normalized_value_encrypted ?? []).includes(Buffer.from("candidate@example.com")), false);
  await kysely.destroy();
});

for(const rotate of [false,true])test(`verified submission atomically learns, reuses and undoes a grouped answer set (key rotation: ${rotate})`, async () => {
  const database = new PGlite();
  const migration = client(database);
  await migrateInitialSchema(migration);
  await migrateCandidateTruthOntology(migration);
  await migrateCandidateTruthMutationGuards(migration);
  await migrateCandidateScopePolicyVectors(migration);
  await migrateCandidateReviewOutcomeProofs(migration);
  await migrateCandidateAnswerReversals(migration);
  await migrateJobIntelligence(migration);
  await migrateVerifiedLearningLoop(migration);
  await migrateRepeatableEntityIntelligence(migration);
  const accountId = "a1000000-0000-4000-8000-000000000001";
  await migrateGlobalAnswerDefaults(migration);
  const candidateId = "a1000000-0000-4000-8000-000000000002";
  await database.exec(`INSERT INTO accounts (id, account_type, contributes_to_global_learning) VALUES ('${accountId}', 'NORMAL', true)`);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  const fingerprinter = new HmacCandidateValueFingerprinter("verified-learning-e2e-secret-at-least-32-bytes", 1);
  const activePrinter=rotate?new HmacCandidateValueFingerprinter("new-verified-checkpoint-key-at-least-32-bytes",2,[{keyVersion:1,secret:"verified-learning-e2e-secret-at-least-32-bytes"}]):fingerprinter;
  const recorder=new VerifiedLearningService(new KyselyVerifiedLearningRepository(kysely),fingerprinter,new AesGcmCandidatePayloadCipher(new Uint8Array(32).fill(9),1));
  const repository = new KyselyCandidateTruthRepository(kysely);
  let crash: "BEFORE_FINALIZE" | "AFTER_FINALIZE" | null = null;
  const truth = new CandidateTruthService(repository, activePrinter);
  await truth.ensureCandidate({ accountId, candidateId });
  const service = new VerifiedLearningService(
    new KyselyVerifiedLearningRepository(kysely),
    activePrinter,
    new AesGcmCandidatePayloadCipher(new Uint8Array(32).fill(9), 1),
    undefined,
    undefined,
    truth,
    (work) => learningCheckpointUnitOfWork(kysely, activePrinter)(async (scoped, scopedTruth) => {
      const finalize = scoped.finalizeCheckpoint.bind(scoped);
      scoped.finalizeCheckpoint = async (input) => {
        if (crash === "BEFORE_FINALIZE") throw new Error("INJECTED_CRASH");
        const result = await finalize(input);
        if (crash === "AFTER_FINALIZE") throw new Error("INJECTED_CRASH");
        return result;
      };
      return work(scoped, scopedTruth);
    })
  );
  const run = await service.startRun({ accountId, candidateId, idempotencyKey: "launch:verified-e2e", request: {
    schemaVersion: 1, requestId: crypto.randomUUID(), jobId: null,
    targetUrl: "https://apply.example.test/job", extensionVersion: "0.1.0", protocolVersion: 1
  } });
  const pageInstanceId = crypto.randomUUID();
  const observationId = crypto.randomUUID();
  await recorder.recordObservation({ accountId, candidateId, idempotencyKey: `observation:${observationId}`, request: {
    schemaVersion: 1, requestId: crypto.randomUUID(), observationId,
    applicationId: run.applicationId, applicationRunId: run.applicationRunId,
    pageInstanceId, formInstanceId: "form:verified-e2e", fieldRuntimeId: "field:verified-email",
    controlFingerprint: "control:verified-email", controlType: "EMAIL", labelEvidence: ["Email"], canonicalKey: "EMAIL",
    descriptorFingerprint: "b".repeat(64), semanticState: "RESOLVED_HIGH", semanticConfidence: 0.99,
    semanticResolver: "EXACT_ALIAS", entityBinding: { entityType: null, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel: null },
    answerVersionId: null, answerScopeFingerprint: null, priorOperationId: null, priorVerificationStatus: null, priorFailureClass: null,
    origin: "USER_ENTERED", observationType: "MANUAL_ANSWER", value: { kind: "TEXT", value: "learned@example.com" }, occurredAt: new Date().toISOString()
  } });
  const firstNameObservationId = crypto.randomUUID();
  await recorder.recordObservation({ accountId, candidateId, idempotencyKey: `observation:${firstNameObservationId}`, request: {
    schemaVersion: 1, requestId: crypto.randomUUID(), observationId: firstNameObservationId,
    applicationId: run.applicationId, applicationRunId: run.applicationRunId,
    pageInstanceId, formInstanceId: "form:verified-e2e", fieldRuntimeId: "field:verified-first-name",
    controlFingerprint: "control:verified-first-name", controlType: "TEXT", labelEvidence: ["First name"], canonicalKey: "FIRST_NAME",
    descriptorFingerprint: "1".repeat(64), semanticState: "RESOLVED_HIGH", semanticConfidence: 0.99,
    semanticResolver: "EXACT_ALIAS", entityBinding: { entityType: null, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel: null },
    answerVersionId: null, answerScopeFingerprint: null, priorOperationId: null, priorVerificationStatus: null, priorFailureClass: null,
    origin: "USER_ENTERED", observationType: "MANUAL_ANSWER", value: { kind: "TEXT", value: "Lavish" }, occurredAt: new Date().toISOString()
  } });
  const submittedAt = new Date().toISOString();
  const checkpointRequest = {
    schemaVersion: 1 as const, requestId: crypto.randomUUID(), applicationId: run.applicationId,
    applicationRunId: run.applicationRunId, signal: {
      signalType: "SUCCESS_URL_AND_MARKER" as const, pageInstanceId,
      successUrlHash: "c".repeat(64), successMarkerHash: "d".repeat(64),
      trustedSubmitObservedAt: submittedAt, verifiedAt: new Date().toISOString()
    }
  };
  await assert.rejects(
    service.verifyCheckpoint({
      accountId,
      candidateId,
      idempotencyKey: "checkpoint:without-submit-attempt",
      request: checkpointRequest
    }),
    /trusted submit attempt/i
  );
  await service.recordSubmitAttempt({ accountId, candidateId, idempotencyKey: "submit:verified-e2e", request: {
    schemaVersion: 1, requestId: crypto.randomUUID(), applicationId: run.applicationId,
    applicationRunId: run.applicationRunId, pageInstanceId, formInstanceId: "form:verified-e2e", occurredAt: submittedAt
  } });
  for (const crashPoint of ["BEFORE_FINALIZE", "AFTER_FINALIZE"] as const) {
    crash = crashPoint;
    await assert.rejects(service.verifyCheckpoint({ accountId, candidateId, idempotencyKey: "checkpoint:crash", request: checkpointRequest }), /INJECTED_CRASH/);
    assert.equal((await database.query<{ count: number }>("SELECT count(*)::int AS count FROM candidate_learning_checkpoint_receipts")).rows[0]?.count, 0);
    assert.equal((await database.query<{ count: number }>("SELECT count(*)::int AS count FROM candidate_answer_change_sets")).rows[0]?.count, 0);
    assert.equal((await database.query<{ count: number }>("SELECT count(*)::int AS count FROM candidate_learning_observations WHERE status = 'RECORDED'")).rows[0]?.count, 2);
  }
  if(rotate){
    const missingPrinter=new HmacCandidateValueFingerprinter("new-verified-checkpoint-key-at-least-32-bytes",2);
    const missingService=new VerifiedLearningService(new KyselyVerifiedLearningRepository(kysely),missingPrinter,new AesGcmCandidatePayloadCipher(new Uint8Array(32).fill(9),1),undefined,undefined,truth,learningCheckpointUnitOfWork(kysely,missingPrinter));
    await assert.rejects(missingService.verifyCheckpoint({accountId,candidateId,idempotencyKey:"checkpoint:missing-key",request:checkpointRequest}),/historical fingerprint key is unavailable/);
    assert.equal((await database.query<{count:number}>("SELECT count(*)::int AS count FROM candidate_learning_checkpoint_receipts")).rows[0]?.count,0);
    assert.equal((await database.query<{count:number}>("SELECT count(*)::int AS count FROM candidate_learning_observations WHERE status='RECORDED'")).rows[0]?.count,2);
  }
  crash = null;
  const [learned, concurrentReplay] = await Promise.all([
    service.verifyCheckpoint({ accountId, candidateId, idempotencyKey: "checkpoint:verified-e2e", request: checkpointRequest }),
    service.verifyCheckpoint({ accountId, candidateId, idempotencyKey: "checkpoint:verified-e2e", request: checkpointRequest })
  ]);
  assert.equal(learned.result.saved, 2);
  assert.equal((await database.query<{fingerprint_key_version:number}>("SELECT fingerprint_key_version FROM candidate_answer_versions LIMIT 1")).rows[0]?.fingerprint_key_version,rotate?2:1);
  assert.equal(learned.result.message, "UPDATED_FOR_NEXT_TIME");
  assert.ok(learned.result.changeSetId);
  assert.equal(concurrentReplay.result.changeSetId, learned.result.changeSetId);
  const resolver = new CandidateTruthResolver(repository);
  const reused = await resolver.resolve({ accountId, candidateId, canonicalKey: "EMAIL", context: {} });
  assert.equal(reused.status, "RESOLVED");
  assert.equal(reused.status === "RESOLVED" && reused.normalizedValue.kind === "STRING" ? reused.normalizedValue.value : null, "learned@example.com");
  const reusedFirstName = await resolver.resolve({ accountId, candidateId, canonicalKey: "FIRST_NAME", context: {} });
  assert.equal(reusedFirstName.status, "RESOLVED");
  assert.equal(reusedFirstName.status === "RESOLVED" && reusedFirstName.normalizedValue.kind === "STRING" ? reusedFirstName.normalizedValue.value : null, "Lavish");
  const replay = await service.verifyCheckpoint({ accountId, candidateId, idempotencyKey: "checkpoint:verified-e2e", request: checkpointRequest });
  const transportReplay = await service.verifyCheckpoint({ accountId, candidateId, idempotencyKey: "checkpoint:new-transport", request: { ...checkpointRequest, requestId: crypto.randomUUID() } });
  assert.deepEqual(transportReplay.result, learned.result);
  assert.equal(transportReplay.checkpointId, learned.checkpointId);
  assert.equal(transportReplay.idempotentReplay, true);
  await assert.rejects(service.verifyCheckpoint({ accountId: crypto.randomUUID(), candidateId, idempotencyKey: "checkpoint:foreign-account", request: checkpointRequest }), /not found/);
  await assert.rejects(service.verifyCheckpoint({ accountId, candidateId, idempotencyKey: "checkpoint:changed", request: { ...checkpointRequest, signal: { ...checkpointRequest.signal, successMarkerHash: "e".repeat(64) } } }), /different submission evidence/);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.result.changeSetId, learned.result.changeSetId);

  const confirmationRun = await service.startRun({ accountId, candidateId, idempotencyKey: "launch:stable-confirmation", request: {
    schemaVersion: 1, requestId: crypto.randomUUID(), jobId: null,
    targetUrl: "https://apply.example.test/second", extensionVersion: "0.1.0", protocolVersion: 1
  } });
  const confirmationPage = crypto.randomUUID();
  const confirmationObservation = crypto.randomUUID();
  await service.recordObservation({ accountId, candidateId, idempotencyKey: `observation:${confirmationObservation}`, request: {
    schemaVersion: 1, requestId: crypto.randomUUID(), observationId: confirmationObservation,
    applicationId: confirmationRun.applicationId, applicationRunId: confirmationRun.applicationRunId,
    pageInstanceId: confirmationPage, formInstanceId: "form:stable-confirm", fieldRuntimeId: "field:stable-confirm",
    controlFingerprint: "control:stable-confirm", controlType: "EMAIL", labelEvidence: ["Contact email"], canonicalKey: "EMAIL",
    descriptorFingerprint: "e".repeat(64), semanticState: "RESOLVED_HIGH", semanticConfidence: 0.99,
    semanticResolver: "EXACT_ALIAS", entityBinding: { entityType: null, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel: null },
    answerVersionId: null, answerScopeFingerprint: null, priorOperationId: null, priorVerificationStatus: null, priorFailureClass: null,
    origin: "USER_ENTERED", observationType: "MANUAL_ANSWER", value: { kind: "TEXT", value: "learned@example.com" }, occurredAt: new Date().toISOString()
  } });
  const confirmationSubmitAt = new Date().toISOString();
  await service.recordSubmitAttempt({ accountId, candidateId, idempotencyKey: "submit:stable-confirm", request: {
    schemaVersion: 1, requestId: crypto.randomUUID(), applicationId: confirmationRun.applicationId,
    applicationRunId: confirmationRun.applicationRunId, pageInstanceId: confirmationPage,
    formInstanceId: "form:stable-confirm", occurredAt: confirmationSubmitAt
  } });
  const stableConfirmation = await service.verifyCheckpoint({ accountId, candidateId, idempotencyKey: "checkpoint:stable-confirm", request: {
    schemaVersion: 1, requestId: crypto.randomUUID(), applicationId: confirmationRun.applicationId,
    applicationRunId: confirmationRun.applicationRunId, signal: {
      signalType: "SUCCESS_URL_AND_MARKER", pageInstanceId: confirmationPage,
      successUrlHash: "f".repeat(64), successMarkerHash: "0".repeat(64),
      trustedSubmitObservedAt: confirmationSubmitAt, verifiedAt: new Date().toISOString()
    }
  } });
  assert.equal(stableConfirmation.result.saved, 0);
  assert.equal(stableConfirmation.result.skipped, 1);
  assert.equal(stableConfirmation.result.changeSetId, null, "stable no-expiry truth must not create a duplicate version");
  const stableVersionCount = await database.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM candidate_answer_versions version
    JOIN canonical_fields canonical ON canonical.id = version.canonical_id
    WHERE version.candidate_id = '${candidateId}' AND canonical.canonical_key = 'EMAIL'
  `);
  assert.equal(stableVersionCount.rows[0]?.count, "1");

  const undone = await service.undoLearningChangeSet({ accountId, candidateId, changeSetId: learned.result.changeSetId as string, idempotencyKey: "undo:verified-e2e" });
  assert.equal(undone.message, "UPDATES_UNDONE");
  const afterUndo = await resolver.resolve({ accountId, candidateId, canonicalKey: "EMAIL", context: {} });
  assert.equal(afterUndo.status, "MISSING");
  const firstNameAfterUndo = await resolver.resolve({ accountId, candidateId, canonicalKey: "FIRST_NAME", context: {} });
  assert.equal(firstNameAfterUndo.status, "MISSING");
  const evidence = await database.query<{ structural_metadata: unknown }>(`
    SELECT structural_metadata FROM application_events WHERE application_id = '${run.applicationId}' ORDER BY sequence
  `);
  assert.doesNotMatch(JSON.stringify(evidence.rows), /learned@example\.com/i);
  await kysely.destroy();
});
import { migrateGlobalAnswerDefaults } from "./index.js";

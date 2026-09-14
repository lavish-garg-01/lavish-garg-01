// Diagnostic only. Uses production services/repositories against isolated in-memory
// PGlite and synthetic candidate data. No network, existing database, or submissions.
// Run from v2 after the normal build: node audits/2026-09-12/verified-learning-boundaries.mjs
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import * as db from "@job-hunter-v2/database";
import { CandidateTruthService, CandidateTruthResolver, HmacCandidateValueFingerprinter } from "@job-hunter-v2/candidate-truth";
import { VerifiedLearningService } from "@job-hunter-v2/verified-learning";
import { AesGcmCandidatePayloadCipher } from "@job-hunter-v2/onboarding";

const database = new PGlite();
const executor = (target) => ({
  query: async (text, values) => ({ rows: (await target.query(text, values)).rows }),
  executeScript: async (text) => { await target.exec(text); }
});
const migration = {
  ...executor(database),
  withTransaction: async (work) => database.transaction((transaction) => work(executor(transaction)))
};
for (const name of [
  "migrateInitialSchema", "migrateCandidateTruthOntology", "migrateCandidateTruthMutationGuards",
  "migrateCandidateScopePolicyVectors", "migrateCandidateReviewOutcomeProofs", "migrateCandidateAnswerReversals",
  "migrateJobIntelligence", "migrateVerifiedLearningLoop", "migrateRepeatableEntityIntelligence", "migrateGlobalAnswerDefaults"
]) await db[name](migration);

const accountId = crypto.randomUUID(), candidateId = crypto.randomUUID();
await database.query("INSERT INTO accounts (id, account_type, contributes_to_global_learning) VALUES ($1, 'NORMAL', true)", [accountId]);
const kysely = new Kysely({ dialect: new PGliteDialect({ pglite: database }) });
const fingerprinter = new HmacCandidateValueFingerprinter("synthetic-audit-only-key-at-least-32-bytes", 1);
const truthRepository = new db.KyselyCandidateTruthRepository(kysely);
const truth = new CandidateTruthService(truthRepository, fingerprinter);
const resolver = new CandidateTruthResolver(truthRepository);
await truth.ensureCandidate({ accountId, candidateId });
const repository = new db.KyselyVerifiedLearningRepository(kysely);
const service = new VerifiedLearningService(repository, fingerprinter, new AesGcmCandidatePayloadCipher(new Uint8Array(32).fill(9), 1), undefined, undefined, truth);

async function start(label) {
  return service.startRun({ accountId, candidateId, idempotencyKey: `audit:launch:${label}`, request: {
    schemaVersion: 1, requestId: crypto.randomUUID(), jobId: null,
    targetUrl: `https://example.test/audit/${label}`, extensionVersion: "0.1.0", protocolVersion: 1
  } });
}

function observation(run, canonicalKey, value, overrides = {}) {
  return {
    schemaVersion: 1, requestId: crypto.randomUUID(), observationId: crypto.randomUUID(),
    applicationId: run.applicationId, applicationRunId: run.applicationRunId, pageInstanceId: crypto.randomUUID(),
    formInstanceId: "form:audit-example", fieldRuntimeId: `field:audit-${canonicalKey}`, controlFingerprint: `control:audit-${canonicalKey}`,
    controlType: "TEXT", labelEvidence: [canonicalKey], canonicalKey,
    descriptorFingerprint: "a".repeat(64), semanticState: "RESOLVED_HIGH", semanticConfidence: 0.99, semanticResolver: "EXACT_ALIAS",
    entityBinding: { entityType: null, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel: null },
    answerVersionId: null, answerScopeFingerprint: null, priorOperationId: null, priorVerificationStatus: null, priorFailureClass: null,
    origin: "USER_ENTERED", observationType: "MANUAL_ANSWER", value, occurredAt: new Date().toISOString(), ...overrides
  };
}

async function stage(request) {
  return service.recordObservation({ accountId, candidateId, request, idempotencyKey: `audit:observation:${request.observationId}` });
}

async function checkpointInput(run, observed) {
  const submittedAt = new Date().toISOString();
  await service.recordSubmitAttempt({ accountId, candidateId, idempotencyKey: `audit:submit:${run.applicationRunId}`, request: {
    schemaVersion: 1, requestId: crypto.randomUUID(), applicationId: run.applicationId, applicationRunId: run.applicationRunId,
    pageInstanceId: observed.pageInstanceId, formInstanceId: observed.formInstanceId, occurredAt: submittedAt
  } });
  return { accountId, candidateId, idempotencyKey: `audit:checkpoint:${run.applicationRunId}`, request: {
    schemaVersion: 1, requestId: crypto.randomUUID(), applicationId: run.applicationId, applicationRunId: run.applicationRunId,
    signal: { signalType: "SUCCESS_URL_AND_MARKER", pageInstanceId: observed.pageInstanceId,
      successUrlHash: "b".repeat(64), successMarkerHash: "c".repeat(64), trustedSubmitObservedAt: submittedAt, verifiedAt: new Date().toISOString() }
  } };
}

try {
  const run = await start("crash");
  const observed = observation(run, "EMAIL", { kind: "TEXT", value: "synthetic@example.test" });
  await stage(observed);
  const input = await checkpointInput(run, observed);
  const realFinalize = repository.finalizeCheckpoint.bind(repository);
  let failOnce = true;
  repository.finalizeCheckpoint = async (finalization) => {
    if (failOnce) { failOnce = false; throw new Error("INJECTED_CRASH_AFTER_TRUTH_COMMIT"); }
    return realFinalize(finalization);
  };
  await assert.rejects(service.verifyCheckpoint(input), /INJECTED_CRASH_AFTER_TRUTH_COMMIT/);
  const afterCrash = (await database.query(`SELECT
    (SELECT count(*) FROM candidate_answer_change_sets) AS change_sets,
    (SELECT count(*) FROM candidate_learning_checkpoint_receipts WHERE finalized_at IS NULL) AS unfinalized,
    (SELECT count(*) FROM candidate_answers_current) AS learned_answers`)).rows;
  console.log("AFTER_INJECTED_CRASH", JSON.stringify(afterCrash));
  const retry = await service.verifyCheckpoint(input);
  assert.equal(retry.result.changeSetId, null);
  assert.equal(retry.result.saved, 0);
  assert.equal(retry.result.skipped, 1);
  console.log("EXACT_CHECKPOINT_REPLAY", JSON.stringify(retry.result));
  console.log("OBSERVATION_AFTER_REPLAY", JSON.stringify((await database.query("SELECT status, consumed_change_set_id FROM candidate_learning_observations")).rows));
  const freshBrowserRetry = { ...input, request: { ...input.request, requestId: crypto.randomUUID(),
    signal: { ...input.request.signal, verifiedAt: new Date().toISOString() } } };
  await assert.rejects(service.verifyCheckpoint(freshBrowserRetry), (error) => {
    console.log("REGENERATED_BROWSER_RETRY", error.constructor.name, error.message);
    return /Checkpoint key was reused/.test(error.message);
  });

  // A directly visited application has no catalog job context. Country/company
  // legal questions cannot be staged even when the candidate supplied an answer.
  const contextlessRun = await start("direct-visit");
  for (const key of ["WORK_AUTHORIZATION", "PREVIOUSLY_EMPLOYED_BY_COMPANY"]) {
    await assert.rejects(stage(observation(contextlessRun, key, { kind: "BOOLEAN", value: true })), (error) => {
      console.log("CONTEXTLESS_LEGAL_ANSWER", key, error.constructor.name, error.message, JSON.stringify(error.details ?? {}));
      return /missing required context/.test(error.message);
    });
  }

  // Newly learned contextual responses are assigned GLOBAL, then same-value
  // manual entry in another application promotes them without a job-specific scope.
  for (const label of ["onsite-job-a", "onsite-job-b"]) {
    const contextualRun = await start(label);
    const answer = observation(contextualRun, "WORK_MODE_REQUIREMENT", { kind: "BOOLEAN", value: true },
      { controlType: "CHECKBOX", labelEvidence: ["Are you willing to work onsite five days per week in this job location?"] });
    await stage(answer);
    const learned = await service.verifyCheckpoint(await checkpointInput(contextualRun, answer));
    const foreignContext = { applicationId: crypto.randomUUID(), jobId: crypto.randomUUID(), companyId: crypto.randomUUID(), countryCode: "GB" };
    const resolved = await resolver.resolve({ accountId, candidateId, canonicalKey: "WORK_MODE_REQUIREMENT", context: foreignContext });
    console.log("CONTEXTUAL_GLOBAL_REUSE", label, JSON.stringify({ saved: learned.result.saved, askAgain: learned.result.askAgain,
      resolution: resolved.status, trustState: resolved.trustState ?? null, scopeType: resolved.scope?.scopeType ?? null,
      autofillMode: resolved.autofillMode ?? null, reasons: resolved.reasonCodes }));
    if (label === "onsite-job-b") {
      assert.equal(resolved.status, "RESOLVED");
      assert.equal(resolved.scope.scopeType, "GLOBAL");
      assert.equal(resolved.trustState, "TRUSTED");
      assert.equal(resolved.autofillMode, "AUTO");
    }
  }
} finally {
  await kysely.destroy();
}

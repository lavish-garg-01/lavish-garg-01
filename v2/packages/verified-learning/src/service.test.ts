import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { resolveCandidateAnswerScope, candidateAnswerPolicy, type CandidateCurrentAnswer } from "@job-hunter-v2/candidate-truth";
import type { RecordLearningObservationRequest } from "@job-hunter-v2/contracts";
import { ConflictError } from "@job-hunter-v2/domain";
import {
  VerifiedLearningService,
  type FinalizeLearningCheckpointInput,
  type PendingLearningObservation,
  type RecordLearningObservationCommand,
  type VerifiedLearningRepository
} from "./service.js";

const accountId = "10000000-0000-4000-8000-000000000001";
const candidateId = "10000000-0000-4000-8000-000000000002";
const applicationId = "10000000-0000-4000-8000-000000000003";
const runId = "10000000-0000-4000-8000-000000000004";
const pageInstanceId = "10000000-0000-4000-8000-000000000005";
const answerVersionId = "10000000-0000-4000-8000-000000000006";
const operationId = "10000000-0000-4000-8000-000000000007";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

class FakeRepository implements VerifiedLearningRepository {
  observations: RecordLearningObservationCommand[] = [];
  pending: PendingLearningObservation[] = [];
  finalization: FinalizeLearningCheckpointInput | null = null;
  current: CandidateCurrentAnswer | null = null;
  scope = resolveCandidateAnswerScope({ policy: candidateAnswerPolicy("EMAIL"), scopeType: "GLOBAL", context: {} });

  async startRun() { return { applicationId, runId, idempotentReplay: false }; }
  async runContext() { return { applicationId, runId, jobId: null, companyId: null, countryCode: "IN", roleFamily: null, status: "ACTIVE" as const }; }
  async answerAuthority() {
    if (!this.scope.ok) return null;
    return { answerVersionId, canonicalKey: "EMAIL", entityId: null, scope: this.scope.scope, current: true };
  }
  async findCurrent() { return this.current; }
  async recordExecutionEvidence() { return { evidenceId: operationId, idempotentReplay: false }; }
  async recordObservation(command: RecordLearningObservationCommand) {
    this.observations.push(command);
    return { observationId: command.request.observationId, idempotentReplay: false };
  }
  async recordSubmitAttempt() { return { submitAttemptId: operationId, idempotentReplay: false }; }
  async verifySubmissionCheckpoint() {
    return { checkpointId: operationId, checkpointStatus: "VERIFIED" as const, changeSetId: null, saved: 0, askAgain: 0, skipped: 0, conflicts: 0, idempotentReplay: false };
  }
  async listPendingObservations() { return this.pending; }
  async finalizeCheckpoint(input: FinalizeLearningCheckpointInput) {
    this.finalization = input;
    return {
      checkpointId: input.checkpointId,
      checkpointStatus: "VERIFIED" as const,
      changeSetId: input.changeSetId,
      saved: input.saved,
      askAgain: input.askAgain,
      skipped: input.skippedObservationIds.length,
      conflicts: input.conflicts,
      idempotentReplay: false
    };
  }
}

const fingerprinter = { fingerprint: (value: unknown) => ({ digest: digest(value), keyVersion: 1 }) };
const cipher = {
  encrypt: () => ({ keyVersion: 1, initializationVector: new Uint8Array(12), authenticationTag: new Uint8Array(16), ciphertext: new Uint8Array([1, 2, 3]) }),
  decrypt: () => { throw new Error("not used"); }
};

function observation(overrides: Partial<RecordLearningObservationRequest> = {}): RecordLearningObservationRequest {
  return {
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    observationId: crypto.randomUUID(),
    applicationId,
    applicationRunId: runId,
    pageInstanceId,
    formInstanceId: "form:12345678",
    fieldRuntimeId: "field:12345678",
    controlFingerprint: "control:12345678",
    controlType: "EMAIL",
    labelEvidence: ["Email"],
    canonicalKey: "EMAIL",
    descriptorFingerprint: "a".repeat(64),
    semanticState: "RESOLVED_HIGH",
    semanticConfidence: 0.99,
    semanticResolver: "EXACT_ALIAS",
    entityBinding: { entityType: null, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel: null },
    answerVersionId: null,
    answerScopeFingerprint: null,
    priorOperationId: null,
    priorVerificationStatus: null,
    priorFailureClass: null,
    origin: "USER_ENTERED",
    observationType: "MANUAL_ANSWER",
    value: { kind: "TEXT", value: "candidate@example.com" },
    occurredAt: new Date().toISOString(),
    ...overrides
  };
}

test("manual answer is normalized, encrypted and persisted as value-free evidence pending verification", async () => {
  const repository = new FakeRepository();
  const service = new VerifiedLearningService(repository, fingerprinter, cipher);
  const response = await service.recordObservation({ accountId, candidateId, request: observation(), idempotencyKey: "observation:manual-email" });
  assert.equal(response.status, "RECORDED");
  assert.equal(response.attribution, "CANDIDATE_ANSWER_ENTRY");
  assert.equal(response.needsVerifiedCheckpoint, true);
  assert.equal(repository.observations.length, 1);
  const command = repository.observations[0];
  assert.ok(command);
  assert.equal(command.normalizedValue.kind, "STRING");
  assert.equal("value" in command.request, false, "durable observation metadata must be value-free");
  assert.equal(command.scope.scopeType, "GLOBAL");
});

test("protected and consent answers fail before candidate-private staging", async () => {
  const repository = new FakeRepository();
  const service = new VerifiedLearningService(repository, fingerprinter, cipher);
  const response = await service.recordObservation({
    accountId,
    candidateId,
    request: observation({ canonicalKey: "EEO_GENDER", controlType: "SELECT", value: { kind: "SINGLE_OPTION", key: "female", label: "Female" } }),
    idempotencyKey: "observation:protected"
  });
  assert.equal(response.status, "POLICY_BLOCKED");
  assert.equal(repository.observations.length, 0);
});

test("a correction is candidate-answer evidence only after a verified K readback", async () => {
  const repository = new FakeRepository();
  const service = new VerifiedLearningService(repository, fingerprinter, cipher);
  const scope = repository.scope;
  assert.equal(scope.ok, true);
  if (!scope.ok) return;
  const response = await service.recordObservation({
    accountId,
    candidateId,
    request: observation({
      answerVersionId,
      answerScopeFingerprint: scope.scope.scopeFingerprint,
      priorOperationId: operationId,
      priorVerificationStatus: "VERIFIED",
      origin: "USER_CORRECTED",
      observationType: "COPILOT_CORRECTION",
      value: { kind: "TEXT", value: "new@example.com" }
    }),
    idempotencyKey: "observation:verified-correction"
  });
  assert.equal(response.attribution, "CANDIDATE_ANSWER_CORRECTION");
  assert.equal(response.status, "RECORDED");
});

test("a correction after a representation failure remains typed evidence and cannot mutate truth", async () => {
  const repository = new FakeRepository();
  const service = new VerifiedLearningService(repository, fingerprinter, cipher);
  const scope = repository.scope;
  assert.equal(scope.ok, true);
  if (!scope.ok) return;
  const response = await service.recordObservation({
    accountId,
    candidateId,
    request: observation({
      answerVersionId,
      answerScopeFingerprint: scope.scope.scopeFingerprint,
      priorOperationId: operationId,
      priorVerificationStatus: "FAILED",
      priorFailureClass: "REPRESENTATION_INVALID",
      origin: "USER_CORRECTED",
      observationType: "COPILOT_CORRECTION"
    }),
    idempotencyKey: "observation:representation"
  });
  assert.equal(response.status, "ATTRIBUTION_BLOCKED");
  assert.equal(response.attribution, "REPRESENTATION_SUSPECT");
  assert.equal(repository.observations.length, 0);
});

test("a stale Candidate Truth write becomes a safe conflict and never overwrites newer truth", async () => {
  const repository = new FakeRepository();
  const scope = repository.scope;
  assert.equal(scope.ok, true);
  if (!scope.ok) return;
  const normalizedValue = {
    schemaVersion: 1 as const,
    dataClass: "CANDIDATE_PRIVATE" as const,
    kind: "STRING" as const,
    value: "candidate@example.com"
  };
  const encryptedPayload = {
    keyVersion: 1,
    initializationVector: new Uint8Array(12),
    authenticationTag: new Uint8Array(16),
    ciphertext: new Uint8Array([1, 2, 3])
  };
  repository.pending = [{
    observationId: crypto.randomUUID(),
    canonicalKey: "EMAIL",
    entityId: null,
    scope: scope.scope,
    attribution: "CANDIDATE_ANSWER_ENTRY",
    expectedCurrentVersionId: answerVersionId,
    finalValueFingerprint: digest(normalizedValue),
    fingerprintKeyVersion: 1,
    encryptedPayload,
    recordedAt: new Date()
  }];
  const staleTruthPort = {
    saveVerifiedLearningGroup: async () => {
      throw new ConflictError("A newer candidate answer already exists.");
    },
    undoChangeSet: async () => {
      throw new Error("not used");
    }
  };
  const service = new VerifiedLearningService(
    repository,
    fingerprinter,
    {
      encrypt: cipher.encrypt,
      decrypt: () => normalizedValue
    },
    undefined,
    undefined,
    staleTruthPort
  );
  const verifiedAt = new Date().toISOString();
  const response = await service.verifyCheckpoint({
    accountId,
    candidateId,
    idempotencyKey: "checkpoint:stale-candidate-truth",
    request: {
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      applicationId,
      applicationRunId: runId,
      signal: {
        signalType: "SUCCESS_URL_AND_MARKER",
        pageInstanceId,
        successUrlHash: "a".repeat(64),
        successMarkerHash: "b".repeat(64),
        trustedSubmitObservedAt: verifiedAt,
        verifiedAt
      }
    }
  });
  assert.equal(response.result.saved, 0);
  assert.equal(response.result.conflicts, 1);
  assert.equal(response.result.message, "COULD_NOT_SAVE_UPDATE");
  assert.equal(response.result.changeSetId, null);
  assert.deepEqual(repository.finalization?.consumedObservationIds, []);
  assert.deepEqual(repository.finalization?.skippedObservationIds, [repository.pending[0]?.observationId]);
});

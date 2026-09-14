import { createHash, randomUUID } from "node:crypto";
import {
  candidateAnswerPolicy,
  candidateFingerprintMatches,
  normalizedValuesEqual,
  resolveCandidateAnswerScope,
  type CandidateAnswerReversalResult,
  type CandidateAnswerScope,
  type CandidateCurrentAnswer,
  type CandidateScopeContext,
  type CandidateTruthService,
  type CandidateValueFingerprinter,
  type PersistableNormalizedValue,
  type SaveCandidateAnswerGroupResult,
  type ScopeType
} from "@job-hunter-v2/candidate-truth";
import {
  LearningUndoResponseSchema,
  RecordSubmitAttemptRequestSchema,
  RecordSubmitAttemptResponseSchema,
  RecordExecutionEvidenceRequestSchema,
  RecordLearningObservationRequestSchema,
  RecordLearningObservationResponseSchema,
  StartLearningRunRequestSchema,
  StartLearningRunResponseSchema,
  VerifyLearningCheckpointRequestSchema,
  VerifyLearningCheckpointResponseSchema,
  type LearningAttribution,
  type RecordExecutionEvidenceRequest,
  type RecordLearningObservationRequest,
  type RecordLearningObservationResponse,
  type RecordSubmitAttemptRequest,
  type StartLearningRunRequest,
  type StartLearningRunResponse,
  type VerifyLearningCheckpointRequest,
  type VerifyLearningCheckpointResponse
} from "@job-hunter-v2/contracts";
import { ConflictError, ValidationError, type Clock, systemClock } from "@job-hunter-v2/domain";
import { normalizeObservedFieldValue } from "./normalization.js";

export interface EncryptedLearningPayload {
  keyVersion: number;
  initializationVector: Uint8Array;
  authenticationTag: Uint8Array;
  ciphertext: Uint8Array;
}

export interface LearningPayloadCipher {
  encrypt(value: PersistableNormalizedValue): EncryptedLearningPayload;
  decrypt(payload: EncryptedLearningPayload): PersistableNormalizedValue;
}

export interface LearningRunContext {
  applicationId: string;
  runId: string;
  jobId: string | null;
  companyId: string | null;
  countryCode: string | null;
  roleFamily: string | null;
  status: "ACTIVE" | "COMPLETED" | "ABORTED" | "EXPIRED";
}

export interface LearningAnswerAuthority {
  answerVersionId: string;
  canonicalKey: string;
  entityId: string | null;
  scope: CandidateAnswerScope;
  current: boolean;
}

export interface RecordLearningObservationCommand {
  accountId: string;
  candidateId: string;
  request: Omit<RecordLearningObservationRequest, "value">;
  normalizedValue: PersistableNormalizedValue;
  encryptedPayload: EncryptedLearningPayload;
  valueFingerprint: string;
  fingerprintKeyVersion: number;
  scope: CandidateAnswerScope;
  entityId: string | null;
  expectedCurrentVersionId: string | null;
  attribution: LearningAttribution;
  idempotencyKey: string;
  requestFingerprint: string;
  recordedAt: Date;
  expiresAt: Date;
  verificationRequestFingerprints?: readonly string[];
}

export interface PendingLearningObservation {
  observationId: string;
  canonicalKey: string;
  entityId: string | null;
  scope: CandidateAnswerScope;
  attribution: LearningAttribution;
  expectedCurrentVersionId: string | null;
  finalValueFingerprint: string;
  fingerprintKeyVersion: number;
  encryptedPayload: EncryptedLearningPayload;
  recordedAt: Date;
}

export interface LearningCheckpointAuthority {
  finalized?: boolean;
  checkpointId: string;
  checkpointStatus: "VERIFIED" | "REJECTED";
  changeSetId: string | null;
  saved: number;
  askAgain: number;
  skipped: number;
  conflicts: number;
  idempotentReplay: boolean;
}

export interface FinalizeLearningCheckpointInput {
  accountId: string;
  candidateId: string;
  applicationId: string;
  runId: string;
  checkpointId: string;
  changeSetId: string | null;
  consumedObservationIds: readonly string[];
  skippedObservationIds: readonly string[];
  saved: number;
  askAgain: number;
  conflicts: number;
  finalizedAt: Date;
}

export interface VerifiedLearningRepository {
  startRun(input: {
    accountId: string;
    candidateId: string;
    request: StartLearningRunRequest;
    idempotencyKey: string;
    requestFingerprint: string;
    applicationId: string;
    runId: string;
    startedAt: Date;
  }): Promise<{ applicationId: string; runId: string; idempotentReplay: boolean }>;
  runContext(input: { accountId: string; candidateId: string; applicationId: string; runId: string }): Promise<LearningRunContext>;
  answerAuthority(input: { accountId: string; candidateId: string; answerVersionId: string }): Promise<LearningAnswerAuthority | null>;
  findCurrent(input: { accountId: string; candidateId: string; canonicalKey: string; entityId: string | null; scopeFingerprint: string }): Promise<CandidateCurrentAnswer | null>;
  recordExecutionEvidence(input: { accountId: string; candidateId: string; request: RecordExecutionEvidenceRequest; requestFingerprint: string; recordedAt: Date }): Promise<{ evidenceId: string; idempotentReplay: boolean }>;
  recordObservation(command: RecordLearningObservationCommand): Promise<{ observationId: string; idempotentReplay: boolean }>;
  recordSubmitAttempt(input: {
    accountId: string;
    candidateId: string;
    request: RecordSubmitAttemptRequest;
    idempotencyKey: string;
    requestFingerprint: string;
    submitAttemptId: string;
    recordedAt: Date;
  }): Promise<{ submitAttemptId: string; idempotentReplay: boolean }>;
  verifySubmissionCheckpoint(input: {
    accountId: string;
    candidateId: string;
    request: VerifyLearningCheckpointRequest;
    idempotencyKey: string;
    requestFingerprint: string;
    checkpointId: string;
    verifiedAt: Date;
  }): Promise<LearningCheckpointAuthority>;
  listPendingObservations(input: {
    accountId: string;
    candidateId: string;
    applicationId: string;
    runId: string;
    checkpointId: string;
    checkpointAt: Date;
  }): Promise<readonly PendingLearningObservation[]>;
  finalizeCheckpoint(input: FinalizeLearningCheckpointInput): Promise<LearningCheckpointAuthority>;
}

export type VerifiedLearningTruthPort = Pick<CandidateTruthService, "saveVerifiedLearningGroup" | "undoChangeSet">;
export type LearningCheckpointUnitOfWork = (work: (repository: VerifiedLearningRepository, truth: VerifiedLearningTruthPort) => Promise<VerifyLearningCheckpointResponse>) => Promise<VerifyLearningCheckpointResponse>;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function selectNewScope(policy: ReturnType<typeof candidateAnswerPolicy>, context: CandidateScopeContext): ScopeType {
  if (policy.entityType || policy.allowedScopeTypes.length === 1) return policy.allowedScopeTypes[0] as ScopeType;
  // First verified facts become profile defaults. Corrections retain the
  // explicitly selected scope through the existing observation path.
  void context;
  return policy.allowedScopeTypes.includes("GLOBAL") ? "GLOBAL" : policy.allowedScopeTypes[0] as ScopeType;
}

function classify(input: RecordLearningObservationRequest): LearningAttribution {
  if (input.observationType === "MANUAL_ANSWER") return "CANDIDATE_ANSWER_ENTRY";
  if (input.observationType === "ANSWER_CONFIRMATION") return "CANDIDATE_ANSWER_CONFIRMATION";
  if (input.priorVerificationStatus === "VERIFIED" && !input.priorFailureClass) return "CANDIDATE_ANSWER_CORRECTION";
  if (input.priorFailureClass === "REPRESENTATION_INVALID") return "REPRESENTATION_SUSPECT";
  if (input.priorFailureClass || input.priorVerificationStatus === "FAILED" || input.priorVerificationStatus === "UNVERIFIABLE") return "INTERACTION_SUSPECT";
  return "AMBIGUOUS";
}

export class VerifiedLearningService {
  constructor(
    private readonly repository: VerifiedLearningRepository,
    private readonly fingerprinter: CandidateValueFingerprinter,
    private readonly cipher: LearningPayloadCipher,
    private readonly clock: Clock = systemClock,
    private readonly newId: () => string = randomUUID,
    private readonly truth: VerifiedLearningTruthPort | null = null,
    private readonly checkpointUnitOfWork?: LearningCheckpointUnitOfWork
  ) {}

  async startRun(input: { accountId: string; candidateId: string; request: StartLearningRunRequest; idempotencyKey: string }): Promise<StartLearningRunResponse> {
    const request = StartLearningRunRequestSchema.parse(input.request);
    const requestFingerprint = fingerprint({ candidateId: input.candidateId, request });
    const result = await this.repository.startRun({
      accountId: input.accountId,
      candidateId: input.candidateId,
      request,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      applicationId: this.newId(),
      runId: this.newId(),
      startedAt: this.clock.now()
    });
    return StartLearningRunResponseSchema.parse({
      schemaVersion: 1,
      requestId: request.requestId,
      applicationId: result.applicationId,
      applicationRunId: result.runId,
      status: "ACTIVE",
      idempotentReplay: result.idempotentReplay,
      containsCandidateValue: false
    });
  }

  async recordExecutionEvidence(input: { accountId: string; candidateId: string; request: RecordExecutionEvidenceRequest }) {
    const request = RecordExecutionEvidenceRequestSchema.parse(input.request);
    return this.repository.recordExecutionEvidence({
      accountId: input.accountId,
      candidateId: input.candidateId,
      request,
      requestFingerprint: fingerprint({ candidateId: input.candidateId, request }),
      recordedAt: this.clock.now()
    });
  }

  async recordObservation(input: { accountId: string; candidateId: string; request: RecordLearningObservationRequest; idempotencyKey: string }): Promise<RecordLearningObservationResponse> {
    const request = RecordLearningObservationRequestSchema.parse(input.request);
    const run = await this.repository.runContext({ accountId: input.accountId, candidateId: input.candidateId, applicationId: request.applicationId, runId: request.applicationRunId });
    if (run.status !== "ACTIVE") throw new ConflictError("This application run is no longer active.");
    const policy = candidateAnswerPolicy(request.canonicalKey);
    if (request.semanticState !== "RESOLVED_HIGH" || request.semanticConfidence < 0.88) {
      return RecordLearningObservationResponseSchema.parse({ schemaVersion: 1, requestId: request.requestId, observationId: request.observationId, status: "POLICY_BLOCKED", attribution: "SEMANTIC_MAPPING_SUSPECT", needsVerifiedCheckpoint: false, expiresAt: null, reasonCode: "SEMANTIC_AUTHORITY_INSUFFICIENT", idempotentReplay: false, valuePrivate: true, containsCandidateValue: false });
    }
    if (!["AUTO_VERSION", "REVIEW_TO_SAVE"].includes(policy.learningMode) || !policy.permanentCommitPoints.includes("VERIFIED_SUBMISSION")) {
      return RecordLearningObservationResponseSchema.parse({ schemaVersion: 1, requestId: request.requestId, observationId: request.observationId, status: "POLICY_BLOCKED", attribution: "NO_LEARNING", needsVerifiedCheckpoint: false, expiresAt: null, reasonCode: policy.reasonCode, idempotentReplay: false, valuePrivate: true, containsCandidateValue: false });
    }
    const entityId = request.entityBinding.bindingKind === "CANDIDATE_ENTITY" ? request.entityBinding.candidateEntityId : null;
    if (policy.entityType && !entityId) {
      return RecordLearningObservationResponseSchema.parse({ schemaVersion: 1, requestId: request.requestId, observationId: request.observationId, status: "POLICY_BLOCKED", attribution: "NO_LEARNING", needsVerifiedCheckpoint: false, expiresAt: null, reasonCode: "STABLE_ENTITY_BINDING_REQUIRED", idempotentReplay: false, valuePrivate: true, containsCandidateValue: false });
    }
    if (policy.entityType && (
      request.entityIntelligence?.state !== "BOUND_HIGH" ||
      request.entityIntelligence.candidateEntityId !== entityId ||
      request.entityIntelligence.entityType !== policy.entityType
    )) {
      return RecordLearningObservationResponseSchema.parse({ schemaVersion: 1, requestId: request.requestId, observationId: request.observationId, status: "POLICY_BLOCKED", attribution: "NO_LEARNING", needsVerifiedCheckpoint: false, expiresAt: null, reasonCode: "VERIFIED_ENTITY_BINDING_REQUIRED", idempotentReplay: false, valuePrivate: true, containsCandidateValue: false });
    }
    const context: CandidateScopeContext = {
      applicationId: run.applicationId,
      ...(run.jobId ? { jobId: run.jobId } : {}),
      ...(run.companyId ? { companyId: run.companyId } : {}),
      ...(run.countryCode ? { countryCode: run.countryCode } : {}),
      ...(run.roleFamily ? { roleFamily: run.roleFamily } : {})
    };
    let scope: CandidateAnswerScope;
    if (request.answerVersionId) {
      const authority = await this.repository.answerAuthority({ accountId: input.accountId, candidateId: input.candidateId, answerVersionId: request.answerVersionId });
      if (!authority || authority.canonicalKey !== request.canonicalKey || authority.entityId !== entityId || request.answerScopeFingerprint !== authority.scope.scopeFingerprint) {
        throw new ValidationError("The observed answer does not match its Candidate Truth authority.", { reasonCode: "ANSWER_VERSION_SCOPE_MISMATCH" });
      }
      scope = authority.scope;
    } else {
      const resolved = resolveCandidateAnswerScope({ policy, scopeType: selectNewScope(policy, context), context });
      if (!resolved.ok) throw new ValidationError("The manual answer is missing required context.", { reasonCode: resolved.reason, dimension: resolved.dimension });
      scope = resolved.scope;
    }
    const attribution = classify(request);
    if (["REPRESENTATION_SUSPECT", "INTERACTION_SUSPECT", "AMBIGUOUS"].includes(attribution)) {
      return RecordLearningObservationResponseSchema.parse({ schemaVersion: 1, requestId: request.requestId, observationId: request.observationId, status: "ATTRIBUTION_BLOCKED", attribution, needsVerifiedCheckpoint: false, expiresAt: null, reasonCode: "CORRECTION_CAUSE_NOT_PROVEN", idempotentReplay: false, valuePrivate: true, containsCandidateValue: false });
    }
    const normalizedValue = normalizeObservedFieldValue({ canonicalKey: request.canonicalKey, value: request.value, labelEvidence: request.labelEvidence, countryCode: run.countryCode });
    const valueFingerprint = this.fingerprinter.fingerprint(normalizedValue);
    const encryptedPayload = this.cipher.encrypt(normalizedValue);
    const current = await this.repository.findCurrent({ accountId: input.accountId, candidateId: input.candidateId, canonicalKey: request.canonicalKey, entityId, scopeFingerprint: scope.scopeFingerprint });
    const recordedAt = this.clock.now();
    const expiresAt = new Date(recordedAt.getTime() + 7 * 24 * 60 * 60 * 1_000);
    const valueFreeCopy: Partial<RecordLearningObservationRequest> = { ...request };
    delete valueFreeCopy.value;
    const valueFreeRequest = valueFreeCopy as Omit<RecordLearningObservationRequest, "value">;
    const result = await this.repository.recordObservation({
      accountId: input.accountId,
      candidateId: input.candidateId,
      request: valueFreeRequest,
      normalizedValue,
      encryptedPayload,
      valueFingerprint: valueFingerprint.digest,
      fingerprintKeyVersion: valueFingerprint.keyVersion,
      scope,
      entityId,
      expectedCurrentVersionId: current?.answerVersionId ?? null,
      attribution,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint({ candidateId: input.candidateId, request: valueFreeRequest, valueFingerprint, scopeFingerprint: scope.scopeFingerprint, attribution }),
      verificationRequestFingerprints: (this.fingerprinter.verificationFingerprints?.(normalizedValue)??[valueFingerprint]).map(valueFingerprint=>fingerprint({candidateId:input.candidateId,request:valueFreeRequest,valueFingerprint,scopeFingerprint:scope.scopeFingerprint,attribution})),
      recordedAt,
      expiresAt
    });
    return RecordLearningObservationResponseSchema.parse({ schemaVersion: 1, requestId: request.requestId, observationId: result.observationId, status: result.idempotentReplay ? "DUPLICATE" : "RECORDED", attribution, needsVerifiedCheckpoint: true, expiresAt: expiresAt.toISOString(), reasonCode: "AWAITING_VERIFIED_SUBMISSION", idempotentReplay: result.idempotentReplay, valuePrivate: true, containsCandidateValue: false });
  }

  async recordSubmitAttempt(input: {
    accountId: string;
    candidateId: string;
    request: RecordSubmitAttemptRequest;
    idempotencyKey: string;
  }) {
    const request = RecordSubmitAttemptRequestSchema.parse(input.request);
    const result = await this.repository.recordSubmitAttempt({
      accountId: input.accountId,
      candidateId: input.candidateId,
      request,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint({ candidateId: input.candidateId, request }),
      submitAttemptId: this.newId(),
      recordedAt: this.clock.now()
    });
    return RecordSubmitAttemptResponseSchema.parse({
      schemaVersion: 1,
      requestId: request.requestId,
      ...result,
      containsCandidateValue: false
    });
  }

  async verifyCheckpoint(input: {
    accountId: string;
    candidateId: string;
    request: VerifyLearningCheckpointRequest;
    idempotencyKey: string;
  }): Promise<VerifyLearningCheckpointResponse> {
    if (this.checkpointUnitOfWork) {
      return this.checkpointUnitOfWork((repository, truth) => new VerifiedLearningService(repository, this.fingerprinter, this.cipher, this.clock, this.newId, truth).verifyCheckpoint(input));
    }
    if (!this.truth) throw new Error("Verified learning requires the Candidate Truth mutation authority.");
    const request = VerifyLearningCheckpointRequestSchema.parse(input.request);
    const semanticRequest = { schemaVersion: request.schemaVersion, applicationId: request.applicationId, applicationRunId: request.applicationRunId, signal: request.signal };
    // One logical submit signal, independent of transport retry IDs and headers.
    const checkpointKey = `checkpoint:v2:${fingerprint({ run: request.applicationRunId, page: request.signal.pageInstanceId, submit: request.signal.trustedSubmitObservedAt })}`;
    const verifiedAt = this.clock.now();
    const authority = await this.repository.verifySubmissionCheckpoint({
      accountId: input.accountId,
      candidateId: input.candidateId,
      request,
      idempotencyKey: checkpointKey,
      requestFingerprint: fingerprint({ candidateId: input.candidateId, request: semanticRequest }),
      checkpointId: this.newId(),
      verifiedAt
    });
    if (authority.idempotentReplay && authority.finalized === false) throw new ConflictError("Historical unfinished checkpoint requires reconciliation; it will not be reapplied.");
    if (authority.finalized) return VerifyLearningCheckpointResponseSchema.parse({
      schemaVersion: 1, requestId: request.requestId, checkpointId: authority.checkpointId, checkpointStatus: authority.checkpointStatus,
      result: { changeSetId: authority.changeSetId, saved: authority.saved, askAgain: authority.askAgain, skipped: authority.skipped, conflicts: authority.conflicts, message: summaryMessage(authority.saved, authority.askAgain, authority.skipped, authority.conflicts) },
      idempotentReplay: true, containsCandidateValue: false
    });
    const pending = await this.repository.listPendingObservations({
      accountId: input.accountId,
      candidateId: input.candidateId,
      applicationId: request.applicationId,
      runId: request.applicationRunId,
      checkpointId: authority.checkpointId,
      checkpointAt: verifiedAt
    });
    if (pending.length === 0) {
      const finalized = await this.repository.finalizeCheckpoint({
        accountId: input.accountId,
        candidateId: input.candidateId,
        applicationId: request.applicationId,
        runId: request.applicationRunId,
        checkpointId: authority.checkpointId,
        changeSetId: authority.changeSetId,
        consumedObservationIds: [],
        skippedObservationIds: [],
        saved: authority.saved,
        askAgain: authority.askAgain,
        conflicts: authority.conflicts,
        finalizedAt: this.clock.now()
      });
      return VerifyLearningCheckpointResponseSchema.parse({
        schemaVersion: 1,
        requestId: request.requestId,
        checkpointId: finalized.checkpointId,
        checkpointStatus: finalized.checkpointStatus,
        result: {
          changeSetId: finalized.changeSetId,
          saved: finalized.saved,
          askAgain: finalized.askAgain,
          skipped: finalized.skipped,
          conflicts: finalized.conflicts,
          message: summaryMessage(finalized.saved, finalized.askAgain, finalized.skipped, finalized.conflicts)
        },
        idempotentReplay: authority.idempotentReplay || finalized.idempotentReplay,
        containsCandidateValue: false
      });
    }

    const latestByLogicalAnswer = new Map<string, PendingLearningObservation>();
    const skippedObservationIds: string[] = [];
    for (const observation of pending) {
      const key = [
        observation.canonicalKey,
        observation.entityId ?? "NONE",
        observation.scope.scopeFingerprint
      ].join(":");
      const prior = latestByLogicalAnswer.get(key);
      if (prior) skippedObservationIds.push(prior.observationId);
      latestByLogicalAnswer.set(key, observation);
    }

    const prepared: Array<{
      observation: PendingLearningObservation;
      normalizedValue: PersistableNormalizedValue;
    }> = [];
    for (const observation of latestByLogicalAnswer.values()) {
      const normalizedValue = this.cipher.decrypt(observation.encryptedPayload);
      const available=this.fingerprinter.verificationFingerprints?.(normalizedValue)??[this.fingerprinter.fingerprint(normalizedValue)];
      if(!available.some(key=>key.keyVersion===observation.fingerprintKeyVersion))throw new ConflictError("Required historical fingerprint key is unavailable; restore it before retrying this checkpoint.");
      if (!candidateFingerprintMatches(this.fingerprinter,normalizedValue,{digest:observation.finalValueFingerprint,keyVersion:observation.fingerprintKeyVersion})) {
        skippedObservationIds.push(observation.observationId);
        continue;
      }
      const current = await this.repository.findCurrent({
        accountId: input.accountId,
        candidateId: input.candidateId,
        canonicalKey: observation.canonicalKey,
        entityId: observation.entityId,
        scopeFingerprint: observation.scope.scopeFingerprint
      });
      const policy = candidateAnswerPolicy(observation.canonicalKey);
      if (
        current?.trustState === "TRUSTED" &&
        policy.freshnessDays === null &&
        normalizedValuesEqual(current.normalizedValue, normalizedValue)
      ) {
        skippedObservationIds.push(observation.observationId);
        continue;
      }
      prepared.push({ observation, normalizedValue });
    }

    let mutation: SaveCandidateAnswerGroupResult | null = null;
    let conflicts = 0;
    if (prepared.length > 0) {
      try {
        mutation = await this.truth.saveVerifiedLearningGroup({
          accountId: input.accountId,
          candidateId: input.candidateId,
          applicationId: request.applicationId,
          checkpointId: authority.checkpointId,
          idempotencyKey: `learning:${authority.checkpointId}`,
          items: prepared.map(({ observation, normalizedValue }) => ({
            observationId: observation.observationId,
            canonicalKey: observation.canonicalKey,
            normalizedValue,
            scopeType: observation.scope.scopeType,
            requestedScope: scopeContext(observation.scope),
            context: scopeContext(observation.scope),
            entityId: observation.entityId,
            expectedCurrentVersionId: observation.expectedCurrentVersionId,
            intent:
              observation.attribution === "CANDIDATE_ANSWER_CONFIRMATION"
                ? "REVIEW_CONFIRMED"
                : observation.attribution === "CANDIDATE_ANSWER_CORRECTION"
                  ? "CORRECTION"
                  : "MANUAL_ENTRY"
          }))
        });
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        conflicts = prepared.length;
        skippedObservationIds.push(...prepared.map(({ observation }) => observation.observationId));
      }
    }
    const consumedObservationIds = mutation ? mutation.items.map((item) => item.itemKey) : [];
    const saved = mutation?.items.filter((item) => item.trustState === "TRUSTED").length ?? 0;
    const askAgain = mutation?.items.filter((item) => item.trustState === "REVIEW").length ?? 0;
    const finalized = await this.repository.finalizeCheckpoint({
      accountId: input.accountId,
      candidateId: input.candidateId,
      applicationId: request.applicationId,
      runId: request.applicationRunId,
      checkpointId: authority.checkpointId,
      changeSetId: mutation?.changeSetId ?? null,
      consumedObservationIds,
      skippedObservationIds: [...new Set(skippedObservationIds)],
      saved,
      askAgain,
      conflicts,
      finalizedAt: this.clock.now()
    });
    return VerifyLearningCheckpointResponseSchema.parse({
      schemaVersion: 1,
      requestId: request.requestId,
      checkpointId: finalized.checkpointId,
      checkpointStatus: finalized.checkpointStatus,
      result: {
        changeSetId: finalized.changeSetId,
        saved: finalized.saved,
        askAgain: finalized.askAgain,
        skipped: finalized.skipped,
        conflicts: finalized.conflicts,
        message: summaryMessage(finalized.saved, finalized.askAgain, finalized.skipped, finalized.conflicts)
      },
      idempotentReplay: authority.idempotentReplay,
      containsCandidateValue: false
    });
  }

  async undoLearningChangeSet(input: {
    accountId: string;
    candidateId: string;
    changeSetId: string;
    idempotencyKey: string;
  }) {
    if (!this.truth) throw new Error("Verified learning requires the Candidate Truth mutation authority.");
    const reversal: CandidateAnswerReversalResult = await this.truth.undoChangeSet({
      accountId: input.accountId,
      candidateId: input.candidateId,
      targetChangeSetId: input.changeSetId,
      idempotencyKey: input.idempotencyKey
    });
    const { restored, forgotten, skippedNewerVersion } = reversal.summary;
    return LearningUndoResponseSchema.parse({
      schemaVersion: 1,
      changeSetId: input.changeSetId,
      restored,
      forgotten,
      keptNewer: skippedNewerVersion,
      message:
        restored + forgotten === 0
          ? "NOTHING_TO_UNDO"
          : skippedNewerVersion > 0
            ? "UPDATES_PARTIALLY_UNDONE"
            : "UPDATES_UNDONE",
      idempotentReplay: reversal.idempotentReplay,
      containsCandidateValue: false
    });
  }
}

function scopeContext(scope: CandidateAnswerScope): CandidateScopeContext {
  return {
    ...(scope.companyId ? { companyId: scope.companyId } : {}),
    ...(scope.jobId ? { jobId: scope.jobId } : {}),
    ...(scope.applicationId ? { applicationId: scope.applicationId } : {}),
    ...(scope.countryCode ? { countryCode: scope.countryCode } : {}),
    ...(scope.roleFamily ? { roleFamily: scope.roleFamily } : {})
  };
}

function summaryMessage(saved: number, askAgain: number, skipped: number, conflicts: number) {
  if (conflicts > 0 && saved + askAgain === 0) return "COULD_NOT_SAVE_UPDATE" as const;
  if (saved > 0 && (askAgain > 0 || skipped > 0 || conflicts > 0)) return "SOME_UPDATES_SAVED" as const;
  if (saved > 0) return "UPDATED_FOR_NEXT_TIME" as const;
  if (askAgain > 0) return "ASK_AGAIN_NEXT_TIME" as const;
  return "NO_REUSABLE_UPDATES" as const;
}

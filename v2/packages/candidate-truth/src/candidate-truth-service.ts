import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { UuidSchema } from "@job-hunter-v2/contracts";
import { type Clock, ValidationError, systemClock } from "@job-hunter-v2/domain";
import { z } from "zod";
import { evaluateCandidateAnswerAnomaly, type CandidateAnswerAnomaly } from "./anomaly.js";
import {
  PersistableNormalizedValueSchema,
  canonicalNormalizedValueJson,
  normalizedValuesEqual,
  type PersistableNormalizedValue
} from "./normalized-value.js";
import { candidateAnswerPolicy } from "./policy.js";
import {
  parseCandidateScopeContext,
  resolveCandidateAnswerScope,
  type CandidateAnswerScope,
  type CandidateScopeContext
} from "./scope.js";
import { CandidateTruthResolver } from "./resolver.js";

export const CANDIDATE_ANSWER_SOURCES = [
  "USER_MANUAL",
  "USER_CORRECTION",
  "PROFILE",
  "VERIFIED_RESUME",
  "DERIVED",
  "LEGACY_IMPORT",
  "USER_ACCEPTED_REUSE",
  "USER_UNDO",
  "USER_RESTORE"
] as const;
export type CandidateAnswerSource = (typeof CANDIDATE_ANSWER_SOURCES)[number];
export const CANDIDATE_ANSWER_INPUT_SOURCES = [
  "USER_MANUAL",
  "USER_CORRECTION",
  "PROFILE",
  "VERIFIED_RESUME",
  "DERIVED",
  "LEGACY_IMPORT"
] as const;
export type CandidateAnswerInputSource = (typeof CANDIDATE_ANSWER_INPUT_SOURCES)[number];
export type CandidateAnswerTrustState = "REVIEW" | "TRUSTED" | "REMOVED";

export const CANDIDATE_ANSWER_TRANSITIONS = [
  "CREATE_TRUSTED",
  "CREATE_REVIEW",
  "REPLACE_TRUSTED",
  "REPLACE_REVIEW",
  "PROMOTE_TRUSTED",
  "CORRECT_REVIEW",
  "REMOVE_OVERRIDE",
  "UNDO_FORGET",
  "UNDO_RESTORE",
  "RESTORE",
  "LEGACY_MUTATION"
] as const;
export type CandidateAnswerTransitionKind = (typeof CANDIDATE_ANSWER_TRANSITIONS)[number];

export interface CandidateCurrentAnswer {
  answerVersionId: string;
  normalizedValue: PersistableNormalizedValue;
  trustState: CandidateAnswerTrustState;
  source: CandidateAnswerSource;
  confirmedAt: Date | null;
}

/**
 * One reusable-answer candidate read from the current projection. Resolution
 * intentionally never scans append-only answer history.
 */
export interface CandidateResolutionCandidate extends CandidateCurrentAnswer {
  scope: CandidateAnswerScope;
  createdAt: Date;
}

export interface PersistCandidateAnswerCommand {
  accountId: string;
  candidateId: string;
  canonicalKey: string;
  policyVersion: number;
  entityId: string | null;
  scope: CandidateAnswerScope;
  normalizedValue: PersistableNormalizedValue;
  valueFingerprint: string;
  fingerprintKeyVersion: number;
  source: CandidateAnswerSource;
  trustState: Exclude<CandidateAnswerTrustState, "REMOVED">;
  transitionKind: CandidateAnswerTransitionKind;
  commitPoint: SaveCandidateAnswerInput["commitPoint"];
  confirmedAt: Date;
  expectedCurrentVersionId: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  applicationId: string | null;
  checkpointId: string | null;
}

export interface CandidateAnswerMutationResult {
  candidateId: string;
  canonicalKey: string;
  scopeId: string;
  changeSetId: string;
  answerVersionId: string;
  trustState: CandidateAnswerTrustState;
  transitionKind: CandidateAnswerTransitionKind;
  idempotentReplay: boolean;
}

export interface PersistCandidateAnswerGroupItemCommand {
  itemKey: string;
  canonicalKey: string;
  policyVersion: number;
  entityId: string | null;
  scope: CandidateAnswerScope;
  normalizedValue: PersistableNormalizedValue;
  valueFingerprint: string;
  fingerprintKeyVersion: number;
  source: CandidateAnswerSource;
  trustState: Exclude<CandidateAnswerTrustState, "REMOVED">;
  transitionKind: CandidateAnswerTransitionKind;
  expectedCurrentVersionId: string | null;
}

export interface PersistCandidateAnswerGroupCommand {
  accountId: string;
  candidateId: string;
  commitPoint: SaveCandidateAnswerInput["commitPoint"];
  applicationId: string | null;
  checkpointId: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  committedAt: Date;
  items: readonly PersistCandidateAnswerGroupItemCommand[];
}

export interface CandidateAnswerGroupItemMutationResult {
  itemKey: string;
  canonicalKey: string;
  scopeId: string;
  answerVersionId: string;
  trustState: Exclude<CandidateAnswerTrustState, "REMOVED">;
  transitionKind: CandidateAnswerTransitionKind;
}

export interface CandidateAnswerGroupMutationResult {
  candidateId: string;
  changeSetId: string;
  items: readonly CandidateAnswerGroupItemMutationResult[];
  idempotentReplay: boolean;
}

export type CandidateAnswerReversalOperation = "UNDO_CHANGE_SET" | "RESTORE_VERSION";
export type CandidateAnswerReversalOutcome =
  | "RESTORED"
  | "FORGOTTEN"
  | "SKIPPED_NEWER_VERSION";

export interface CandidateAnswerReversalItemResult {
  reversalItemId: string;
  sourceChangeSetItemId: string | null;
  canonicalKey: string;
  scopeId: string;
  expectedVersionId: string | null;
  observedCurrentVersionId: string | null;
  previousVersionId: string | null;
  compensatingVersionId: string | null;
  outcome: CandidateAnswerReversalOutcome;
  reasonCode:
    | "PREVIOUS_SCOPED_ANSWER_RESTORED"
    | "NEW_SCOPED_ANSWER_REMOVED"
    | "NEWER_CANDIDATE_ANSWER_KEPT"
    | "HISTORICAL_ANSWER_EXPLICITLY_RESTORED";
}

export interface CandidateAnswerReversalResult {
  candidateId: string;
  reversalSetId: string;
  operationType: CandidateAnswerReversalOperation;
  targetChangeSetId: string | null;
  targetVersionId: string | null;
  compensatingChangeSetId: string | null;
  summary: {
    restored: number;
    forgotten: number;
    skippedNewerVersion: number;
  };
  items: readonly CandidateAnswerReversalItemResult[];
  createdAt: Date;
  idempotentReplay: boolean;
  alreadyReversed: boolean;
}

export interface UndoCandidateAnswerChangeSetCommand {
  accountId: string;
  candidateId: string;
  targetChangeSetId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  reversedAt: Date;
}

export interface RestoreCandidateAnswerVersionCommand {
  accountId: string;
  candidateId: string;
  targetVersionId: string;
  expectedCurrentVersionId: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  restoredAt: Date;
}

export interface ListCandidateAnswerReversalsInput {
  accountId: string;
  candidateId: string;
  limit: number;
  before: {
    createdAt: Date;
    reversalSetId: string;
  } | null;
}

export interface RecordTrialOutcomeReceiptCommand {
  accountId: string;
  candidateId: string;
  applicationId: string;
  runId: string;
  operationId: string;
  sequence: number;
  usedAnswerVersionId: string;
  expectedScopeFingerprint: string;
  outcome: "CONFIRMED_UNCHANGED" | "USER_CORRECTED";
  finalActor: "COPILOT" | "USER";
  finalValueFingerprint: string;
  fingerprintKeyVersion: number;
  idempotencyKey: string;
  requestFingerprint: string;
  recordedAt: Date;
}

export interface CandidateAnswerUsageProofResult {
  usageProofId: string;
  outcome: RecordTrialOutcomeReceiptCommand["outcome"];
  finalValueFingerprint: string;
  fingerprintKeyVersion: number;
  idempotentReplay: boolean;
}

export interface ApplyVerifiedReviewOutcomeCommand {
  accountId: string;
  candidateId: string;
  usageProofId: string;
  applicationId: string;
  runId: string;
  checkpointId: string;
  canonicalKey: string;
  usedAnswerVersionId: string;
  expectedScopeFingerprint: string;
  outcome: RecordTrialOutcomeReceiptCommand["outcome"];
  finalNormalizedValue: PersistableNormalizedValue;
  finalValueFingerprint: string;
  fingerprintKeyVersion: number;
  idempotencyKey: string;
  requestFingerprint: string;
  committedAt: Date;
}

export interface RemoveRedundantOverrideCommand {
  accountId: string;
  candidateId: string;
  canonicalKey: string;
  policyVersion: number;
  entityId: string | null;
  context: CandidateScopeContext;
  overrideAnswerVersionId: string;
  overrideScopeFingerprint: string;
  inheritedAnswerVersionId: string;
  inheritedScopeFingerprint: string;
  idempotencyKey: string;
  requestFingerprint: string;
  removedAt: Date;
}

export interface CandidateTruthRepository {
  ensureCandidate(input: { accountId: string; candidateId: string; createdAt: Date }): Promise<string>;
  findCurrent(input: {
    accountId: string;
    candidateId: string;
    canonicalKey: string;
    entityId: string | null;
    scopeFingerprint: string;
  }): Promise<CandidateCurrentAnswer | null>;
  listCurrentCandidates(input: {
    accountId: string;
    candidateId: string;
    canonicalKey: string;
    entityId: string | null;
    context: CandidateScopeContext;
  }): Promise<readonly CandidateResolutionCandidate[]>;
  recordTrialOutcomeReceipt(
    command: RecordTrialOutcomeReceiptCommand
  ): Promise<CandidateAnswerUsageProofResult>;
  applyVerifiedReviewOutcome(
    command: ApplyVerifiedReviewOutcomeCommand
  ): Promise<CandidateAnswerMutationResult>;
  removeRedundantOverride(
    command: RemoveRedundantOverrideCommand
  ): Promise<CandidateAnswerMutationResult>;
  commitAnswerGroup(
    command: PersistCandidateAnswerGroupCommand
  ): Promise<CandidateAnswerGroupMutationResult>;
  undoChangeSet(command: UndoCandidateAnswerChangeSetCommand): Promise<CandidateAnswerReversalResult>;
  restoreVersion(command: RestoreCandidateAnswerVersionCommand): Promise<CandidateAnswerReversalResult>;
  listReversals(
    input: ListCandidateAnswerReversalsInput
  ): Promise<readonly CandidateAnswerReversalResult[]>;
  commitAnswerVersion(command: PersistCandidateAnswerCommand): Promise<CandidateAnswerMutationResult>;
}

export interface CandidateValueFingerprint {
  digest: string;
  keyVersion: number;
}

export interface CandidateValueFingerprinter {
  fingerprint(value: PersistableNormalizedValue): CandidateValueFingerprint;
  /** Verification only. New writes must always call fingerprint(). */
  verificationFingerprints?(value: PersistableNormalizedValue): readonly CandidateValueFingerprint[];
}

export function candidateFingerprintMatches(printer: CandidateValueFingerprinter, value: PersistableNormalizedValue, stored: {digest:string;keyVersion:number|null}):boolean {
  if(!/^[a-f0-9]{64}$/.test(stored.digest))return false;
  const candidates=printer.verificationFingerprints?.(value)??[printer.fingerprint(value)];
  return candidates.some(candidate=>(stored.keyVersion===null||candidate.keyVersion===stored.keyVersion)&&/^[a-f0-9]{64}$/.test(candidate.digest)&&timingSafeEqual(Buffer.from(candidate.digest,"hex"),Buffer.from(stored.digest,"hex")));
}

export class HmacCandidateValueFingerprinter implements CandidateValueFingerprinter {
  private readonly secret: Buffer;
  private readonly historical: readonly {keyVersion:number;secret:Buffer}[];

  constructor(secret: string | Uint8Array, private readonly keyVersion: number, historical:readonly {keyVersion:number;secret:string|Uint8Array}[] = []) {
    this.secret = Buffer.from(secret);
    if (this.secret.byteLength < 32) {
      throw new Error("Candidate value fingerprint key must contain at least 32 bytes.");
    }
    if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) {
      throw new Error("Candidate value fingerprint key version must be a positive safe integer.");
    }
    if(historical.length>4)throw new Error("At most four historical fingerprint keys are supported.");
    const versions=new Set([keyVersion]);
    this.historical=historical.map(entry=>{
      const bytes=Buffer.from(entry.secret);
      if(!Number.isSafeInteger(entry.keyVersion)||entry.keyVersion<=0||entry.keyVersion>=keyVersion||versions.has(entry.keyVersion)||bytes.byteLength<32)throw new Error("Invalid historical fingerprint key configuration.");
      if(bytes.equals(this.secret))throw new Error("Fingerprint key versions must use distinct secrets.");
      versions.add(entry.keyVersion);return {keyVersion:entry.keyVersion,secret:bytes};
    });
    if(new Set(this.historical.map(entry=>entry.secret.toString("hex"))).size!==this.historical.length)throw new Error("Fingerprint key versions must use distinct secrets.");
  }

  fingerprint(value: PersistableNormalizedValue): CandidateValueFingerprint {
    return {
      digest: createHmac("sha256", this.secret).update(canonicalNormalizedValueJson(value)).digest("hex"),
      keyVersion: this.keyVersion
    };
  }

  verificationFingerprints(value:PersistableNormalizedValue):readonly CandidateValueFingerprint[]{
    const serialized=canonicalNormalizedValueJson(value);
    return [this.fingerprint(value),...this.historical.map(entry=>({digest:createHmac("sha256",entry.secret).update(serialized).digest("hex"),keyVersion:entry.keyVersion}))];
  }
}

export interface SaveCandidateAnswerInput {
  accountId: string;
  candidateId: string;
  canonicalKey: string;
  normalizedValue: PersistableNormalizedValue;
  scopeType: CandidateAnswerScope["scopeType"];
  requestedScope?: CandidateScopeContext;
  context?: CandidateScopeContext;
  entityId?: string | null;
  source: CandidateAnswerInputSource;
  commitPoint: "VERIFIED_SUBMISSION" | "EXPLICIT_SAVE" | "LEGACY_IMPORT";
  expectedCurrentVersionId: string | null;
  idempotencyKey: string;
  applicationId?: string | null;
  checkpointId?: string | null;
}

export interface SaveCandidateAnswerResult extends CandidateAnswerMutationResult {
  anomaly: CandidateAnswerAnomaly;
}

export interface SaveCandidateAnswerGroupItemInput {
  itemKey: string;
  canonicalKey: string;
  normalizedValue: PersistableNormalizedValue;
  scopeType: CandidateAnswerScope["scopeType"];
  requestedScope?: CandidateScopeContext;
  context?: CandidateScopeContext;
  entityId?: string | null;
  source: CandidateAnswerInputSource;
  expectedCurrentVersionId: string | null;
}

export interface SaveCandidateAnswerGroupInput {
  accountId: string;
  candidateId: string;
  commitPoint: SaveCandidateAnswerInput["commitPoint"];
  applicationId?: string | null;
  checkpointId?: string | null;
  idempotencyKey: string;
  items: readonly SaveCandidateAnswerGroupItemInput[];
}

export interface SaveCandidateAnswerGroupItemResult extends CandidateAnswerGroupItemMutationResult {
  anomaly: CandidateAnswerAnomaly;
}

export interface SaveCandidateAnswerGroupResult
  extends Omit<CandidateAnswerGroupMutationResult, "items"> {
  items: readonly SaveCandidateAnswerGroupItemResult[];
}

const IdempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/);

function mutationRequestFingerprint(input: {
  canonicalKey: string;
  entityId: string | null;
  scopeFingerprint: string;
  valueFingerprint: CandidateValueFingerprint;
  source: CandidateAnswerSource;
  commitPoint: SaveCandidateAnswerInput["commitPoint"];
  expectedCurrentVersionId: string | null;
  applicationId: string | null;
  checkpointId: string | null;
  transitionKind: CandidateAnswerTransitionKind;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        applicationId: input.applicationId,
        checkpointId: input.checkpointId,
        canonicalKey: input.canonicalKey,
        commitPoint: input.commitPoint,
        entityId: input.entityId,
        expectedCurrentVersionId: input.expectedCurrentVersionId,
        valueFingerprint: input.valueFingerprint,
        scopeFingerprint: input.scopeFingerprint,
        source: input.source,
        transitionKind: input.transitionKind,
      })
    )
    .digest("hex");
}

function usageProofRequestFingerprint(input: {
  accountId: string;
  candidateId: string;
  applicationId: string;
  runId: string;
  operationId: string;
  sequence: number;
  usedAnswerVersionId: string;
  usedScopeFingerprint: string;
  outcome: "CONFIRMED_UNCHANGED" | "USER_CORRECTED";
  finalActor: "COPILOT" | "USER";
  finalValueFingerprint: CandidateValueFingerprint;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

function reviewOutcomeRequestFingerprint(input: {
  accountId: string;
  candidateId: string;
  usageProofId: string;
  applicationId: string;
  runId: string;
  checkpointId: string;
  canonicalKey: string;
  usedAnswerVersionId: string;
  usedScopeFingerprint: string;
  outcome: "CONFIRMED_UNCHANGED" | "USER_CORRECTED";
  finalValueFingerprint: CandidateValueFingerprint;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

function overrideRemovalRequestFingerprint(input: {
  accountId: string;
  candidateId: string;
  canonicalKey: string;
  policyVersion: number;
  entityId: string | null;
  context: CandidateScopeContext;
  overrideAnswerVersionId: string;
  overrideScopeFingerprint: string;
  inheritedAnswerVersionId: string;
  inheritedScopeFingerprint: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function groupMutationRequestFingerprint(input: {
  accountId: string;
  candidateId: string;
  commitPoint: SaveCandidateAnswerInput["commitPoint"];
  applicationId: string | null;
  checkpointId: string | null;
  items: readonly (Omit<
    PersistCandidateAnswerGroupItemCommand,
    "normalizedValue" | "valueFingerprint" | "fingerprintKeyVersion" | "scope"
  > & {
    scopeFingerprint: string;
    valueFingerprint: CandidateValueFingerprint;
  })[];
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function reversalRequestFingerprint(input: {
  operationType: CandidateAnswerReversalOperation;
  accountId: string;
  candidateId: string;
  targetId: string;
  expectedCurrentVersionId?: string | null;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

interface PreparedCandidateAnswer {
  command: Omit<PersistCandidateAnswerCommand, "idempotencyKey" | "requestFingerprint">;
  anomaly: CandidateAnswerAnomaly;
  valueFingerprint: CandidateValueFingerprint;
  requestExpectedCurrentVersionId: string | null;
  current: CandidateCurrentAnswer | null;
}

export type VerifiedLearningIntent = "MANUAL_ENTRY" | "CORRECTION" | "REVIEW_CONFIRMED";

export interface SaveVerifiedLearningGroupItemInput
  extends Omit<SaveCandidateAnswerGroupItemInput, "itemKey" | "source"> {
  observationId: string;
  intent: VerifiedLearningIntent;
}

export interface SaveVerifiedLearningGroupInput extends Omit<SaveCandidateAnswerGroupInput, "items" | "commitPoint"> {
  applicationId: string;
  checkpointId: string;
  items: readonly SaveVerifiedLearningGroupItemInput[];
}

export class CandidateTruthService {
  constructor(
    private readonly repository: CandidateTruthRepository,
    private readonly fingerprinter: CandidateValueFingerprinter,
    private readonly clock: Clock = systemClock
  ) {}

  async ensureCandidate(input: { accountId: string; candidateId: string }): Promise<string> {
    return this.repository.ensureCandidate({
      accountId: UuidSchema.parse(input.accountId),
      candidateId: UuidSchema.parse(input.candidateId),
      createdAt: this.clock.now()
    });
  }

  private async prepareCandidateAnswer(
    input: SaveCandidateAnswerInput,
    confirmedAt: Date
  ): Promise<PreparedCandidateAnswer> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const canonicalKey = input.canonicalKey.trim().toUpperCase();
    const policy = candidateAnswerPolicy(canonicalKey);
    const normalizedValue = PersistableNormalizedValueSchema.parse(input.normalizedValue);
    const entityId = input.entityId ? UuidSchema.parse(input.entityId) : null;
    const applicationId = input.applicationId ? UuidSchema.parse(input.applicationId) : null;
    const checkpointId = input.checkpointId ? UuidSchema.parse(input.checkpointId) : null;
    const requestExpectedCurrentVersionId = input.expectedCurrentVersionId
      ? UuidSchema.parse(input.expectedCurrentVersionId)
      : null;
    const source = z.enum(CANDIDATE_ANSWER_INPUT_SOURCES).parse(input.source);
    IdempotencyKeySchema.parse(input.idempotencyKey);

    if (input.commitPoint === "VERIFIED_SUBMISSION" && (!applicationId || !checkpointId)) {
      throw new ValidationError("Verified submission learning requires its application and checkpoint receipt.", {
        canonicalKey,
        reasonCode: "VERIFIED_SUBMISSION_CHECKPOINT_REQUIRED"
      });
    }
    if (input.commitPoint === "EXPLICIT_SAVE" && checkpointId && !applicationId) {
      throw new ValidationError("An explicit-save checkpoint requires its application.", { canonicalKey });
    }
    if (input.commitPoint === "LEGACY_IMPORT" && (applicationId || checkpointId)) {
      throw new ValidationError("Legacy import cannot borrow application checkpoint authority.", {
        canonicalKey,
        reasonCode: "LEGACY_IMPORT_APPLICATION_AUTHORITY_FORBIDDEN"
      });
    }
    if ((input.commitPoint === "LEGACY_IMPORT") !== (source === "LEGACY_IMPORT")) {
      throw new ValidationError("Legacy import source and commit boundary must be used together.", {
        canonicalKey,
        reasonCode: "LEGACY_IMPORT_BOUNDARY_MISMATCH"
      });
    }

    if (policy.learningMode !== "AUTO_VERSION" && policy.learningMode !== "REVIEW_TO_SAVE") {
      throw new ValidationError("This field is application-only and cannot become reusable candidate truth.", {
        canonicalKey,
        reasonCode: policy.reasonCode
      });
    }
    if (input.commitPoint !== "LEGACY_IMPORT" && !policy.permanentCommitPoints.includes(input.commitPoint)) {
      throw new ValidationError("The requested checkpoint cannot permanently learn this answer.", {
        canonicalKey,
        commitPoint: input.commitPoint
      });
    }
    if (normalizedValue.kind !== policy.valueType) {
      throw new ValidationError("The normalized value type does not match the canonical policy.", {
        canonicalKey,
        expected: policy.valueType,
        received: normalizedValue.kind
      });
    }
    if (policy.entityType && !entityId) {
      throw new ValidationError("This canonical requires a stable candidate entity.", {
        canonicalKey,
        entityType: policy.entityType
      });
    }
    if (!policy.entityType && entityId) {
      throw new ValidationError("This canonical does not accept a candidate entity.", { canonicalKey });
    }
    if (
      input.commitPoint === "LEGACY_IMPORT" &&
      (policy.answerClass === "LEGAL_FACT" ||
        policy.answerClass === "CONSENT" ||
        policy.answerClass === "PROTECTED" ||
        policy.answerClass === "CONTEXTUAL" ||
        Boolean(policy.entityType) ||
        policy.requiredContextDimensions.length > 0 ||
        !policy.allowedScopeTypes.includes("GLOBAL") ||
        input.scopeType !== "GLOBAL")
    ) {
      throw new ValidationError("This canonical is not safe for automatic legacy import.", {
        canonicalKey,
        reasonCode: "LEGACY_IMPORT_POLICY_REQUIRES_RECONCILIATION"
      });
    }
    if (policy.answerClass === "LEGAL_FACT" && !["USER_MANUAL", "USER_CORRECTION"].includes(source)) {
      throw new ValidationError("Legal candidate facts require a direct candidate source.", { canonicalKey });
    }
    if (source === "DERIVED" && policy.derivationPolicy !== "DETERMINISTIC_ONLY") {
      throw new ValidationError("This canonical cannot be inferred or derived.", { canonicalKey });
    }

    const scope = resolveCandidateAnswerScope({
      policy,
      scopeType: input.scopeType,
      ...(input.requestedScope ? { requested: input.requestedScope } : {}),
      ...(input.context ? { context: input.context } : {})
    });
    if (!scope.ok) {
      throw new ValidationError("Candidate answer scope is not valid for this policy and context.", {
        canonicalKey,
        reason: scope.reason,
        ...(scope.dimension ? { dimension: scope.dimension } : {})
      });
    }
    if (scope.scope.scopeType === "APPLICATION" && scope.scope.applicationId !== applicationId) {
      throw new ValidationError("Application scope must match the mutation application.", { canonicalKey });
    }

    const current = await this.repository.findCurrent({
      accountId,
      candidateId,
      canonicalKey,
      entityId,
      scopeFingerprint: scope.scope.scopeFingerprint
    });
    const anomaly = evaluateCandidateAnswerAnomaly({
      policy,
      proposedValue: normalizedValue,
      ...(current && current.trustState !== "REMOVED"
        ? { previousValue: current.normalizedValue }
        : {})
    });
    if (!anomaly.allowed) {
      throw new ValidationError("Candidate answer failed deterministic policy validation.", {
        canonicalKey,
        reasonCodes: anomaly.reasonCodes
      });
    }

    const valueFingerprint = this.fingerprinter.fingerprint(normalizedValue);
    const trustState =
      input.commitPoint === "LEGACY_IMPORT"
        ? "REVIEW"
        : input.commitPoint === "EXPLICIT_SAVE" || policy.learningMode === "AUTO_VERSION"
        ? "TRUSTED"
        : "REVIEW";
    // Model the caller's mutation intent, not the projection observed during
    // this attempt. On an idempotent retry the first write is already current;
    // deriving this from `current` would turn CREATE_* into REPLACE_* and make
    // an otherwise identical request fail its idempotency fingerprint check.
    const transitionKind: CandidateAnswerTransitionKind = requestExpectedCurrentVersionId
      ? trustState === "TRUSTED"
        ? "REPLACE_TRUSTED"
        : "REPLACE_REVIEW"
      : trustState === "TRUSTED"
        ? "CREATE_TRUSTED"
        : "CREATE_REVIEW";
    // A REMOVED version is a projection tombstone, not an answer visible to
    // the caller. Treat a caller's null expectation as a create intent while
    // still using the tombstone id for storage-level OCC so a new answer can
    // safely replace the tombstone without weakening concurrent-write guards.
    const expectedCurrentVersionId =
      requestExpectedCurrentVersionId ??
      (current?.trustState === "REMOVED" ? current.answerVersionId : null);
    return {
      command: {
        accountId,
        candidateId,
        canonicalKey,
        policyVersion: policy.policyVersion,
        entityId,
        scope: scope.scope,
        normalizedValue,
        valueFingerprint: valueFingerprint.digest,
        fingerprintKeyVersion: valueFingerprint.keyVersion,
        source,
        trustState,
        transitionKind,
        commitPoint: input.commitPoint,
        confirmedAt,
        expectedCurrentVersionId,
        applicationId,
        checkpointId
      },
      anomaly,
      valueFingerprint,
      requestExpectedCurrentVersionId,
      current
    };
  }

  async save(input: SaveCandidateAnswerInput): Promise<SaveCandidateAnswerResult> {
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    const prepared = await this.prepareCandidateAnswer(input, this.clock.now());
    const requestFingerprint = mutationRequestFingerprint({
      applicationId: prepared.command.applicationId,
      checkpointId: prepared.command.checkpointId,
      canonicalKey: prepared.command.canonicalKey,
      commitPoint: prepared.command.commitPoint,
      entityId: prepared.command.entityId,
      expectedCurrentVersionId: prepared.requestExpectedCurrentVersionId,
      valueFingerprint: prepared.valueFingerprint,
      scopeFingerprint: prepared.command.scope.scopeFingerprint,
      source: prepared.command.source,
      transitionKind: prepared.command.transitionKind
    });
    const result = await this.repository.commitAnswerVersion({
      ...prepared.command,
      idempotencyKey,
      requestFingerprint
    });
    return { ...result, anomaly: prepared.anomaly };
  }

  async saveGroup(input: SaveCandidateAnswerGroupInput): Promise<SaveCandidateAnswerGroupResult> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    if (input.items.length < 1 || input.items.length > 50) {
      throw new ValidationError("Candidate-answer groups must contain between 1 and 50 items.", {
        reasonCode: "CANDIDATE_ANSWER_GROUP_SIZE_INVALID"
      });
    }
    const itemKeySchema = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/);
    const itemKeys = input.items.map((item) => itemKeySchema.parse(item.itemKey));
    if (new Set(itemKeys).size !== itemKeys.length) {
      throw new ValidationError("Candidate-answer group item keys must be unique.", {
        reasonCode: "DUPLICATE_GROUP_ITEM_KEY"
      });
    }
    const committedAt = this.clock.now();
    const prepared = await Promise.all(
      input.items.map((item) =>
        this.prepareCandidateAnswer(
          {
            accountId,
            candidateId,
            canonicalKey: item.canonicalKey,
            normalizedValue: item.normalizedValue,
            scopeType: item.scopeType,
            ...(item.requestedScope ? { requestedScope: item.requestedScope } : {}),
            ...(item.context ? { context: item.context } : {}),
            entityId: item.entityId ?? null,
            source: item.source,
            commitPoint: input.commitPoint,
            expectedCurrentVersionId: item.expectedCurrentVersionId,
            idempotencyKey,
            applicationId: input.applicationId ?? null,
            checkpointId: input.checkpointId ?? null
          },
          committedAt
        )
      )
    );
    const commands: PersistCandidateAnswerGroupItemCommand[] = prepared.map((item, index) => ({
      itemKey: itemKeys[index] as string,
      canonicalKey: item.command.canonicalKey,
      policyVersion: item.command.policyVersion,
      entityId: item.command.entityId,
      scope: item.command.scope,
      normalizedValue: item.command.normalizedValue,
      valueFingerprint: item.command.valueFingerprint,
      fingerprintKeyVersion: item.command.fingerprintKeyVersion,
      source: item.command.source,
      trustState: item.command.trustState,
      transitionKind: item.command.transitionKind,
      expectedCurrentVersionId: item.command.expectedCurrentVersionId
    }));
    const logicalKeys = commands.map((item) =>
      [item.canonicalKey, item.entityId ?? "NONE", item.scope.scopeFingerprint].join(":")
    );
    if (new Set(logicalKeys).size !== logicalKeys.length) {
      throw new ValidationError("A candidate-answer group cannot mutate one logical answer twice.", {
        reasonCode: "DUPLICATE_GROUP_LOGICAL_ANSWER"
      });
    }
    const applicationId = prepared[0]?.command.applicationId ?? null;
    const checkpointId = prepared[0]?.command.checkpointId ?? null;
    const requestFingerprint = groupMutationRequestFingerprint({
      accountId,
      candidateId,
      commitPoint: input.commitPoint,
      applicationId,
      checkpointId,
      items: [...commands]
        .map((item, index) => ({ item, requestExpectedCurrentVersionId: prepared[index]?.requestExpectedCurrentVersionId ?? null }))
        .sort((left, right) => left.item.itemKey.localeCompare(right.item.itemKey))
        .map(({ item, requestExpectedCurrentVersionId }) => ({
        itemKey: item.itemKey,
        canonicalKey: item.canonicalKey,
        policyVersion: item.policyVersion,
        entityId: item.entityId,
        source: item.source,
        trustState: item.trustState,
        transitionKind: item.transitionKind,
        expectedCurrentVersionId: requestExpectedCurrentVersionId,
        scopeFingerprint: item.scope.scopeFingerprint,
        valueFingerprint: {
          digest: item.valueFingerprint,
          keyVersion: item.fingerprintKeyVersion
        }
        }))
    });
    const result = await this.repository.commitAnswerGroup({
      accountId,
      candidateId,
      commitPoint: input.commitPoint,
      applicationId,
      checkpointId,
      idempotencyKey,
      requestFingerprint,
      committedAt,
      items: commands
    });
    const anomalyByItemKey = new Map(
      prepared.map((item, index) => [itemKeys[index] as string, item.anomaly])
    );
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        anomaly: anomalyByItemKey.get(item.itemKey) as CandidateAnswerAnomaly
      }))
    };
  }

  async saveVerifiedLearningGroup(input: SaveVerifiedLearningGroupInput): Promise<SaveCandidateAnswerGroupResult> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const applicationId = UuidSchema.parse(input.applicationId);
    const checkpointId = UuidSchema.parse(input.checkpointId);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    if (input.items.length < 1 || input.items.length > 50) throw new ValidationError("Verified learning groups must contain between 1 and 50 items.");
    const committedAt = this.clock.now();
    const prepared = await Promise.all(input.items.map((item) => this.prepareCandidateAnswer({
      accountId,
      candidateId,
      canonicalKey: item.canonicalKey,
      normalizedValue: item.normalizedValue,
      scopeType: item.scopeType,
      ...(item.requestedScope ? { requestedScope: item.requestedScope } : {}),
      ...(item.context ? { context: item.context } : {}),
      entityId: item.entityId ?? null,
      source: item.intent === "CORRECTION" ? "USER_CORRECTION" : "USER_MANUAL",
      commitPoint: "VERIFIED_SUBMISSION",
      expectedCurrentVersionId: item.expectedCurrentVersionId,
      idempotencyKey,
      applicationId,
      checkpointId
    }, committedAt)));
    const commands: PersistCandidateAnswerGroupItemCommand[] = prepared.map((item, index) => {
      const sourceItem = input.items[index];
      if (!sourceItem) throw new Error("Verified learning item disappeared during preparation.");
      const sameCurrent = Boolean(item.current && item.current.trustState !== "REMOVED" && normalizedValuesEqual(item.current.normalizedValue, item.command.normalizedValue));
      let trustState = item.command.trustState;
      let source: CandidateAnswerSource = item.command.source;
      let transitionKind = item.command.transitionKind;
      if (sourceItem.intent === "REVIEW_CONFIRMED" || (sameCurrent && item.current?.trustState === "REVIEW")) {
        if (!item.current || item.current.trustState !== "REVIEW" || !sameCurrent) {
          throw new ValidationError("REVIEW confirmation requires the exact current REVIEW answer.", { reasonCode: "EXACT_REVIEW_CONFIRMATION_REQUIRED" });
        }
        trustState = "TRUSTED";
        source = "USER_ACCEPTED_REUSE";
        transitionKind = "PROMOTE_TRUSTED";
      } else if (sourceItem.intent === "CORRECTION" && item.current?.trustState === "REVIEW") {
        transitionKind = "CORRECT_REVIEW";
      }
      return {
        itemKey: sourceItem.observationId,
        canonicalKey: item.command.canonicalKey,
        policyVersion: item.command.policyVersion,
        entityId: item.command.entityId,
        scope: item.command.scope,
        normalizedValue: item.command.normalizedValue,
        valueFingerprint: item.command.valueFingerprint,
        fingerprintKeyVersion: item.command.fingerprintKeyVersion,
        source,
        trustState,
        transitionKind,
        expectedCurrentVersionId: item.command.expectedCurrentVersionId
      };
    });
    const logicalKeys = commands.map((item) => [item.canonicalKey, item.entityId ?? "NONE", item.scope.scopeFingerprint].join(":"));
    if (new Set(logicalKeys).size !== logicalKeys.length) throw new ValidationError("One verified application cannot mutate the same logical answer twice.");
    const requestFingerprint = groupMutationRequestFingerprint({
      accountId,
      candidateId,
      commitPoint: "VERIFIED_SUBMISSION",
      applicationId,
      checkpointId,
      items: commands
        .map((item) => ({
          itemKey: item.itemKey,
          canonicalKey: item.canonicalKey,
          policyVersion: item.policyVersion,
          entityId: item.entityId,
          source: item.source,
          trustState: item.trustState,
          transitionKind: item.transitionKind,
          expectedCurrentVersionId:
            input.items.find((candidate) => candidate.observationId === item.itemKey)
              ?.expectedCurrentVersionId ?? null,
          scopeFingerprint: item.scope.scopeFingerprint,
          valueFingerprint: {
            digest: item.valueFingerprint,
            keyVersion: item.fingerprintKeyVersion
          }
        }))
        .sort((left, right) => left.itemKey.localeCompare(right.itemKey))
    });
    const result = await this.repository.commitAnswerGroup({
      accountId, candidateId, commitPoint: "VERIFIED_SUBMISSION", applicationId, checkpointId,
      idempotencyKey, requestFingerprint, committedAt, items: commands
    });
    const anomalyByItem = new Map(prepared.map((item, index) => [input.items[index]?.observationId, item.anomaly]));
    return { ...result, items: result.items.map((item) => ({ ...item, anomaly: anomalyByItem.get(item.itemKey) as CandidateAnswerAnomaly })) };
  }

  async removeRedundantOverride(
    input: RemoveRedundantOverrideInput
  ): Promise<CandidateAnswerMutationResult> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const canonicalKey = input.canonicalKey.trim().toUpperCase();
    const policy = candidateAnswerPolicy(canonicalKey);
    const entityId = input.entityId ? UuidSchema.parse(input.entityId) : null;
    const context = parseCandidateScopeContext(input.context);
    const overrideAnswerVersionId = UuidSchema.parse(input.overrideAnswerVersionId);
    const inheritedAnswerVersionId = UuidSchema.parse(input.inheritedAnswerVersionId);
    const overrideScopeFingerprint = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(input.overrideScopeFingerprint);
    const inheritedScopeFingerprint = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(input.inheritedScopeFingerprint);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);

    if (policy.entityType && !entityId) {
      throw new ValidationError("This canonical requires a stable candidate entity.", {
        canonicalKey,
        entityType: policy.entityType
      });
    }
    if (!policy.entityType && entityId) {
      throw new ValidationError("This canonical does not accept a candidate entity.", { canonicalKey });
    }
    if (
      !["AUTO", "REVIEW"].includes(policy.reuseMode) ||
      !["AUTO_VERSION", "REVIEW_TO_SAVE"].includes(policy.learningMode) ||
      policy.allowedScopeTypes.length < 2
    ) {
      throw new ValidationError("This candidate-answer policy does not permit contextual inheritance.", {
        canonicalKey,
        reasonCode: "POLICY_DOES_NOT_PERMIT_INHERITANCE"
      });
    }

    return this.repository.removeRedundantOverride({
      accountId,
      candidateId,
      canonicalKey,
      policyVersion: policy.policyVersion,
      entityId,
      context,
      overrideAnswerVersionId,
      overrideScopeFingerprint,
      inheritedAnswerVersionId,
      inheritedScopeFingerprint,
      idempotencyKey,
      requestFingerprint: overrideRemovalRequestFingerprint({
        accountId,
        candidateId,
        canonicalKey,
        policyVersion: policy.policyVersion,
        entityId,
        context,
        overrideAnswerVersionId,
        overrideScopeFingerprint,
        inheritedAnswerVersionId,
        inheritedScopeFingerprint
      }),
      removedAt: this.clock.now()
    });
  }

  async recordTrialOutcome(input: RecordTrialOutcomeInput): Promise<RecordTrialOutcomeResult> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const canonicalKey = input.canonicalKey.trim().toUpperCase();
    const applicationId = UuidSchema.parse(input.applicationId);
    const runId = UuidSchema.parse(input.runId);
    const operationId = UuidSchema.parse(input.operationId);
    const sequence = z.number().int().positive().safe().parse(input.sequence);
    const usedAnswerVersionId = UuidSchema.parse(input.usedAnswerVersionId);
    const usedScopeFingerprint = z.string().regex(/^[a-f0-9]{64}$/).parse(input.usedScopeFingerprint);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    const outcome = z.enum(["CONFIRMED_UNCHANGED", "USER_CORRECTED"]).parse(input.outcome);
    const finalActor = z.enum(["COPILOT", "USER"]).parse(input.finalActor);
    if (outcome === "USER_CORRECTED" && finalActor !== "USER") {
      throw new ValidationError("A correction receipt requires direct candidate action.", {
        canonicalKey,
        reasonCode: "CORRECTION_REQUIRES_USER_ACTOR"
      });
    }
    const finalNormalizedValue = PersistableNormalizedValueSchema.parse(input.finalNormalizedValue);
    const entityId = input.entityId ? UuidSchema.parse(input.entityId) : null;
    const policy = candidateAnswerPolicy(canonicalKey);
    if (finalNormalizedValue.kind !== policy.valueType) {
      throw new ValidationError("The final normalized value type does not match the canonical policy.", {
        canonicalKey,
        expected: policy.valueType,
        received: finalNormalizedValue.kind
      });
    }
    if (input.context?.applicationId && input.context.applicationId !== applicationId) {
      throw new ValidationError("Outcome context belongs to another application.", { canonicalKey });
    }
    const resolution = await new CandidateTruthResolver(this.repository, this.clock).resolve({
      accountId,
      candidateId,
      canonicalKey,
      entityId,
      ...(input.context ? { context: input.context } : {})
    });
    if (
      resolution.status !== "RESOLVED" ||
      !resolution.trialReuse ||
      resolution.answerVersionId !== usedAnswerVersionId ||
      resolution.scope.scopeType !== input.scopeType ||
      resolution.scope.scopeFingerprint !== usedScopeFingerprint
    ) {
      throw new ValidationError("The exact current REVIEW trial could not be proven for this context.", {
        canonicalKey,
        reasonCode: "EXACT_REVIEW_TRIAL_PROOF_REQUIRED",
        resolutionStatus: resolution.status
      });
    }
    const unchanged = normalizedValuesEqual(resolution.normalizedValue, finalNormalizedValue);
    if (outcome === "CONFIRMED_UNCHANGED" && !unchanged) {
      throw new ValidationError("Unchanged outcome receipt does not match the final candidate value.", {
        canonicalKey,
        reasonCode: "UNCHANGED_VALUE_PROOF_MISMATCH"
      });
    }
    if (outcome === "USER_CORRECTED" && unchanged) {
      throw new ValidationError("Correction outcome must contain a semantically different value.", {
        canonicalKey,
        reasonCode: "CORRECTION_VALUE_UNCHANGED"
      });
    }
    const anomaly = evaluateCandidateAnswerAnomaly({
      policy,
      proposedValue: finalNormalizedValue,
      previousValue: resolution.normalizedValue
    });
    if (!anomaly.allowed) {
      throw new ValidationError("Candidate answer failed deterministic policy validation.", {
        canonicalKey,
        reasonCodes: anomaly.reasonCodes
      });
    }
    const valueFingerprint = this.fingerprinter.fingerprint(finalNormalizedValue);
    const requestFingerprint = usageProofRequestFingerprint({
      accountId,
      candidateId,
      applicationId,
      runId,
      operationId,
      sequence,
      usedAnswerVersionId,
      usedScopeFingerprint,
      outcome,
      finalActor,
      finalValueFingerprint: valueFingerprint
    });
    const receipt = await this.repository.recordTrialOutcomeReceipt({
      accountId,
      candidateId,
      applicationId,
      runId,
      operationId,
      sequence,
      usedAnswerVersionId,
      expectedScopeFingerprint: usedScopeFingerprint,
      outcome,
      finalActor,
      finalValueFingerprint: valueFingerprint.digest,
      fingerprintKeyVersion: valueFingerprint.keyVersion,
      idempotencyKey,
      requestFingerprint,
      recordedAt: this.clock.now()
    });
    return { ...receipt, anomaly };
  }

  async applyVerifiedTrialOutcome(
    input: ApplyVerifiedTrialOutcomeInput
  ): Promise<ApplyVerifiedTrialOutcomeResult> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const usageProofId = UuidSchema.parse(input.usageProofId);
    const applicationId = UuidSchema.parse(input.applicationId);
    const runId = UuidSchema.parse(input.runId);
    const checkpointId = UuidSchema.parse(input.checkpointId);
    const canonicalKey = input.canonicalKey.trim().toUpperCase();
    const usedAnswerVersionId = UuidSchema.parse(input.usedAnswerVersionId);
    const usedScopeFingerprint = z.string().regex(/^[a-f0-9]{64}$/).parse(input.usedScopeFingerprint);
    const outcome = z.enum(["CONFIRMED_UNCHANGED", "USER_CORRECTED"]).parse(input.outcome);
    const finalNormalizedValue = PersistableNormalizedValueSchema.parse(input.finalNormalizedValue);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    const policy = candidateAnswerPolicy(canonicalKey);
    if (finalNormalizedValue.kind !== policy.valueType) {
      throw new ValidationError("The final normalized value type does not match the canonical policy.", {
        canonicalKey,
        expected: policy.valueType,
        received: finalNormalizedValue.kind
      });
    }
    const anomaly = evaluateCandidateAnswerAnomaly({ policy, proposedValue: finalNormalizedValue });
    if (!anomaly.allowed) {
      throw new ValidationError("Candidate answer failed deterministic policy validation.", {
        canonicalKey,
        reasonCodes: anomaly.reasonCodes
      });
    }
    const valueFingerprint = this.fingerprinter.fingerprint(finalNormalizedValue);
    const requestFingerprint = reviewOutcomeRequestFingerprint({
      accountId,
      candidateId,
      usageProofId,
      applicationId,
      runId,
      checkpointId,
      canonicalKey,
      usedAnswerVersionId,
      usedScopeFingerprint,
      outcome,
      finalValueFingerprint: valueFingerprint
    });
    const result = await this.repository.applyVerifiedReviewOutcome({
      accountId,
      candidateId,
      usageProofId,
      applicationId,
      runId,
      checkpointId,
      canonicalKey,
      usedAnswerVersionId,
      expectedScopeFingerprint: usedScopeFingerprint,
      outcome,
      finalNormalizedValue,
      finalValueFingerprint: valueFingerprint.digest,
      fingerprintKeyVersion: valueFingerprint.keyVersion,
      idempotencyKey,
      requestFingerprint,
      committedAt: this.clock.now()
    });
    return { ...result, outcome, anomaly };
  }

  async undoChangeSet(input: UndoCandidateAnswerChangeSetInput): Promise<CandidateAnswerReversalResult> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const targetChangeSetId = UuidSchema.parse(input.targetChangeSetId);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    return this.repository.undoChangeSet({
      accountId,
      candidateId,
      targetChangeSetId,
      idempotencyKey,
      requestFingerprint: reversalRequestFingerprint({
        operationType: "UNDO_CHANGE_SET",
        accountId,
        candidateId,
        targetId: targetChangeSetId
      }),
      reversedAt: this.clock.now()
    });
  }

  async restoreVersion(
    input: RestoreCandidateAnswerVersionInput
  ): Promise<CandidateAnswerReversalResult> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const targetVersionId = UuidSchema.parse(input.targetVersionId);
    const expectedCurrentVersionId = input.expectedCurrentVersionId
      ? UuidSchema.parse(input.expectedCurrentVersionId)
      : null;
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    return this.repository.restoreVersion({
      accountId,
      candidateId,
      targetVersionId,
      expectedCurrentVersionId,
      idempotencyKey,
      requestFingerprint: reversalRequestFingerprint({
        operationType: "RESTORE_VERSION",
        accountId,
        candidateId,
        targetId: targetVersionId,
        expectedCurrentVersionId
      }),
      restoredAt: this.clock.now()
    });
  }

  async reversalHistory(
    input: CandidateAnswerReversalHistoryInput
  ): Promise<readonly CandidateAnswerReversalResult[]> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const limit = z.number().int().min(1).max(50).parse(input.limit ?? 20);
    const before = input.before
      ? {
          createdAt: new Date(input.before.createdAt),
          reversalSetId: UuidSchema.parse(input.before.reversalSetId)
        }
      : null;
    if (before && Number.isNaN(before.createdAt.getTime())) {
      throw new ValidationError("Candidate-answer reversal history cursor is invalid.");
    }
    return this.repository.listReversals({ accountId, candidateId, limit, before });
  }
}

export interface RemoveRedundantOverrideInput {
  accountId: string;
  candidateId: string;
  canonicalKey: string;
  entityId?: string | null;
  context?: CandidateScopeContext;
  overrideAnswerVersionId: string;
  overrideScopeFingerprint: string;
  inheritedAnswerVersionId: string;
  inheritedScopeFingerprint: string;
  idempotencyKey: string;
}

export interface UndoCandidateAnswerChangeSetInput {
  accountId: string;
  candidateId: string;
  targetChangeSetId: string;
  idempotencyKey: string;
}

export interface RestoreCandidateAnswerVersionInput {
  accountId: string;
  candidateId: string;
  targetVersionId: string;
  expectedCurrentVersionId: string | null;
  idempotencyKey: string;
}

export interface CandidateAnswerReversalHistoryInput {
  accountId: string;
  candidateId: string;
  limit?: number;
  before?: {
    createdAt: Date | string;
    reversalSetId: string;
  } | null;
}

export interface RecordTrialOutcomeInput {
  accountId: string;
  candidateId: string;
  canonicalKey: string;
  entityId?: string | null;
  scopeType: CandidateAnswerScope["scopeType"];
  context?: CandidateScopeContext;
  applicationId: string;
  runId: string;
  operationId: string;
  sequence: number;
  usedAnswerVersionId: string;
  usedScopeFingerprint: string;
  outcome: "CONFIRMED_UNCHANGED" | "USER_CORRECTED";
  finalActor: "COPILOT" | "USER";
  finalNormalizedValue: PersistableNormalizedValue;
  idempotencyKey: string;
}

export interface RecordTrialOutcomeResult extends CandidateAnswerUsageProofResult {
  anomaly: CandidateAnswerAnomaly;
}

export interface ApplyVerifiedTrialOutcomeInput {
  accountId: string;
  candidateId: string;
  usageProofId: string;
  applicationId: string;
  runId: string;
  checkpointId: string;
  canonicalKey: string;
  usedAnswerVersionId: string;
  usedScopeFingerprint: string;
  outcome: "CONFIRMED_UNCHANGED" | "USER_CORRECTED";
  finalNormalizedValue: PersistableNormalizedValue;
  idempotencyKey: string;
}

export interface ApplyVerifiedTrialOutcomeResult extends CandidateAnswerMutationResult {
  outcome: ApplyVerifiedTrialOutcomeInput["outcome"];
  anomaly: CandidateAnswerAnomaly;
}

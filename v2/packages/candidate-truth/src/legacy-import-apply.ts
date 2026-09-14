import { createHash } from "node:crypto";
import { UuidSchema } from "@job-hunter-v2/contracts";
import {
  ConflictError,
  type Clock,
  ValidationError,
  systemClock
} from "@job-hunter-v2/domain";
import { z } from "zod";
import type {
  CandidateAnswerGroupMutationResult,
  CandidateValueFingerprinter,
  SaveCandidateAnswerGroupInput
} from "./candidate-truth-service.js";
import {
  fingerprintLegacyCandidateTruthSnapshot,
  fingerprintLegacyCandidateTruthSource,
  revalidateEligibleLegacyCandidateTruthSource,
  type CandidateTruthImportPreviewRepository,
  type LegacyCandidateTruthImportDecision,
  type LegacyCandidateTruthImportPreviewResult,
  type LegacyCandidateTruthSource,
  type LegacyImportFingerprinter
} from "./legacy-import.js";
import { candidateAnswerPolicy } from "./policy.js";
import { resolveCandidateAnswerScope } from "./scope.js";

export const LEGACY_IMPORT_RECONCILIATION_OUTCOMES = [
  "IMPORTED",
  "ALREADY_IMPORTED",
  "SKIPPED",
  "REVIEW_REQUIRED",
  "CONFLICT",
  "INVALID",
  "UNMAPPABLE"
] as const;
export type LegacyImportReconciliationOutcome =
  (typeof LEGACY_IMPORT_RECONCILIATION_OUTCOMES)[number];

export interface LegacyImportReconciliationItem {
  reconciliationId: string;
  previewItemId: string;
  outcome: LegacyImportReconciliationOutcome;
  reasonCodes: readonly string[];
  answerVersionId: string | null;
  candidateChangeSetId: string | null;
}

export interface LegacyImportApplyBatchState {
  applyBatchId: string;
  batchIndex: number;
  batchFingerprint: string;
  previewItemIds: readonly string[];
  status: "PENDING" | "COMPLETED";
}

export interface LegacyImportApplyResult {
  candidateId: string;
  previewRunId: string;
  applyRunId: string;
  status: "PENDING" | "COMPLETED";
  examinedCount: number;
  counts: Record<LegacyImportReconciliationOutcome, number>;
  reconciliations: readonly LegacyImportReconciliationItem[];
  batches: readonly LegacyImportApplyBatchState[];
  idempotentReplay: boolean;
  startedAt: Date;
  completedAt: Date | null;
}

export interface LegacyImportVerificationReport {
  candidateId: string;
  previewRunId: string;
  applyRunId: string;
  verified: boolean;
  examinedCount: number;
  terminalCount: number;
  counts: Record<LegacyImportReconciliationOutcome, number>;
  importedVersionCount: number;
  importedChangeSetCount: number;
  duplicateCurrentAnswerCount: number;
  violationCodes: readonly string[];
  verifiedAt: Date;
}

export interface BeginLegacyImportApplyCommand {
  accountId: string;
  candidateId: string;
  previewRunId: string;
  sourceSnapshotFingerprint: string;
  fingerprintKeyVersion: number;
  applyPlanFingerprint: string;
  idempotencyKey: string;
  requestFingerprint: string;
  startedAt: Date;
  examinedCount: number;
  terminalItems: readonly {
    previewItemId: string;
    outcome: Exclude<LegacyImportReconciliationOutcome, "IMPORTED">;
    reasonCodes: readonly string[];
  }[];
  batches: readonly {
    batchIndex: number;
    batchFingerprint: string;
    previewItemIds: readonly string[];
  }[];
}

export interface CompleteLegacyImportBatchCommand {
  accountId: string;
  candidateId: string;
  applyRunId: string;
  applyBatchId: string;
  batchFingerprint: string;
  completedAt: Date;
  items: readonly {
    previewItemId: string;
    outcome: "IMPORTED" | "ALREADY_IMPORTED" | "CONFLICT" | "INVALID";
    reasonCodes: readonly string[];
    answerVersionId: string | null;
    candidateChangeSetId: string | null;
  }[];
}

export interface LegacyImportApplyRepository
  extends Pick<CandidateTruthImportPreviewRepository, "listCurrentAnswers"> {
  loadPreview(input: {
    accountId: string;
    candidateId: string;
    previewRunId: string;
  }): Promise<LegacyCandidateTruthImportPreviewResult>;
  beginOrResumeApply(command: BeginLegacyImportApplyCommand): Promise<LegacyImportApplyResult>;
  completeBatch(command: CompleteLegacyImportBatchCommand): Promise<LegacyImportApplyResult>;
  completeApply(input: {
    accountId: string;
    candidateId: string;
    applyRunId: string;
    completedAt: Date;
  }): Promise<LegacyImportApplyResult>;
  verifyCompletedApply(input: {
    accountId: string;
    candidateId: string;
    applyRunId: string;
    verifiedAt: Date;
  }): Promise<LegacyImportVerificationReport>;
}

export interface LegacyImportCandidateTruthWriter {
  saveGroup(input: SaveCandidateAnswerGroupInput): Promise<{
    candidateId: string;
    changeSetId: string;
    items: readonly (CandidateAnswerGroupMutationResult["items"][number] & {
      anomaly: { allowed: boolean; requiresReview: boolean; reasonCodes: readonly string[] };
    })[];
    idempotentReplay: boolean;
  }>;
}

interface ImportableItem {
  previewItemId: string;
  sourceOrdinal: number;
  targetCanonicalKey: string;
  normalizedValue: SaveCandidateAnswerGroupInput["items"][number]["normalizedValue"];
  valueFingerprint: string;
  valueFingerprintKeyVersion: number;
}

const IdempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/);

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function globalScopeFingerprint(): string {
  const resolution = resolveCandidateAnswerScope({
    policy: candidateAnswerPolicy("EMAIL"),
    scopeType: "GLOBAL"
  });
  if (!resolution.ok) throw new Error("Global scope contract is unavailable.");
  return resolution.scope.scopeFingerprint;
}

function previewOutcome(
  decision: Exclude<LegacyCandidateTruthImportDecision, "ELIGIBLE">,
  reasonCodes: readonly string[]
): Exclude<LegacyImportReconciliationOutcome, "IMPORTED"> {
  if (decision === "ALREADY_PRESENT") return "ALREADY_IMPORTED";
  if (decision === "REVIEW_REQUIRED") return "REVIEW_REQUIRED";
  if (decision === "CONFLICT") return "CONFLICT";
  if (decision === "INVALID") return "INVALID";
  if (reasonCodes.includes("CANONICAL_NOT_SUPPORTED_IN_V2")) return "UNMAPPABLE";
  return "SKIPPED";
}

function revalidationOutcome(
  decision: Exclude<LegacyCandidateTruthImportDecision, "ELIGIBLE" | "ALREADY_PRESENT">,
  reasonCodes: readonly string[]
): Exclude<LegacyImportReconciliationOutcome, "IMPORTED"> {
  if (decision === "REVIEW_REQUIRED") return "REVIEW_REQUIRED";
  if (decision === "CONFLICT") return "CONFLICT";
  if (decision === "INVALID") return "INVALID";
  if (reasonCodes.includes("CANONICAL_NOT_SUPPORTED_IN_V2")) return "UNMAPPABLE";
  return "SKIPPED";
}

function chunks<Value>(values: readonly Value[], size: number): Value[][] {
  const result: Value[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export class LegacyCandidateTruthImportApplyService {
  constructor(
    private readonly repository: LegacyImportApplyRepository,
    private readonly writer: LegacyImportCandidateTruthWriter,
    private readonly valueFingerprinter: CandidateValueFingerprinter,
    private readonly importFingerprinter: LegacyImportFingerprinter,
    private readonly clock: Clock = systemClock
  ) {}

  async apply(input: {
    accountId: string;
    candidateId: string;
    previewRunId: string;
    idempotencyKey: string;
    sources: readonly LegacyCandidateTruthSource[];
  }): Promise<LegacyImportApplyResult> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const previewRunId = UuidSchema.parse(input.previewRunId);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    const evaluatedAt = this.clock.now();
    const preview = await this.repository.loadPreview({ accountId, candidateId, previewRunId });
    const snapshot = fingerprintLegacyCandidateTruthSnapshot(input.sources, this.importFingerprinter);
    if (
      snapshot.digest !== preview.snapshotFingerprint ||
      snapshot.keyVersion !== preview.fingerprintKeyVersion
    ) {
      throw new ConflictError("Legacy source snapshot no longer matches the immutable preview.", {
        reasonCode: "LEGACY_IMPORT_SOURCE_SNAPSHOT_DRIFT"
      });
    }

    const sourceByFingerprint = new Map(
      input.sources.map((source) => [
        fingerprintLegacyCandidateTruthSource(source, this.importFingerprinter)
          .sourceRecordFingerprint.digest,
        source
      ])
    );
    if (sourceByFingerprint.size !== input.sources.length) {
      throw new ValidationError("Legacy import source identities must be unique.", {
        reasonCode: "DUPLICATE_LEGACY_SOURCE_IDENTITY"
      });
    }

    const terminalItems: BeginLegacyImportApplyCommand["terminalItems"][number][] = [];
    const importable: ImportableItem[] = [];
    for (const item of preview.items) {
      const source = sourceByFingerprint.get(item.sourceRecordFingerprint);
      if (!source) {
        throw new ConflictError("A preview source record is missing from the apply snapshot.", {
          reasonCode: "LEGACY_IMPORT_SOURCE_RECORD_MISSING"
        });
      }
      const sourceIdentity = fingerprintLegacyCandidateTruthSource(source, this.importFingerprinter);
      if (
        sourceIdentity.sourceValueFingerprint.digest !== item.sourceValueFingerprint ||
        sourceIdentity.sourceValueFingerprint.keyVersion !== item.fingerprintKeyVersion
      ) {
        throw new ConflictError("A legacy source value changed after preview.", {
          reasonCode: "LEGACY_IMPORT_SOURCE_VALUE_DRIFT"
        });
      }
      if (item.decision !== "ELIGIBLE") {
        terminalItems.push({
          previewItemId: item.previewItemId,
          outcome: previewOutcome(item.decision, item.reasonCodes),
          reasonCodes: item.reasonCodes
        });
        continue;
      }
      const revalidated = revalidateEligibleLegacyCandidateTruthSource({
        source,
        evaluatedAt,
        valueFingerprinter: this.valueFingerprinter,
        importFingerprinter: this.importFingerprinter
      });
      if (!revalidated.ok) {
        terminalItems.push({
          previewItemId: item.previewItemId,
          outcome: revalidationOutcome(revalidated.decision, revalidated.reasonCodes),
          reasonCodes: ["ELIGIBILITY_CHANGED_AFTER_PREVIEW", ...revalidated.reasonCodes]
        });
        continue;
      }
      if (
        revalidated.targetCanonicalKey !== item.targetCanonicalKey ||
        item.proposedScopeType !== "GLOBAL"
      ) {
        terminalItems.push({
          previewItemId: item.previewItemId,
          outcome: "CONFLICT",
          reasonCodes: ["LEGACY_IMPORT_CANONICAL_OR_SCOPE_DRIFT"]
        });
        continue;
      }
      importable.push({
        previewItemId: item.previewItemId,
        sourceOrdinal: item.sourceOrdinal,
        targetCanonicalKey: revalidated.targetCanonicalKey,
        normalizedValue: revalidated.normalizedValue,
        valueFingerprint: revalidated.normalizedValueFingerprint.digest,
        valueFingerprintKeyVersion: revalidated.normalizedValueFingerprint.keyVersion
      });
    }
    if (sourceByFingerprint.size !== preview.sourceCount) {
      throw new ConflictError("The apply snapshot contains records outside the immutable preview.", {
        reasonCode: "LEGACY_IMPORT_SOURCE_SET_DRIFT"
      });
    }

    importable.sort(
      (left, right) =>
        left.sourceOrdinal - right.sourceOrdinal ||
        left.previewItemId.localeCompare(right.previewItemId)
    );
    const batchItems = chunks(importable, 50);
    const batches = batchItems.map((items, batchIndex) => ({
      batchIndex,
      batchFingerprint: stableHash(
        items.map((item) => ({
          previewItemId: item.previewItemId,
          canonicalKey: item.targetCanonicalKey,
          valueFingerprint: item.valueFingerprint,
          keyVersion: item.valueFingerprintKeyVersion
        }))
      ),
      previewItemIds: items.map((item) => item.previewItemId)
    }));
    const applyPlanFingerprint = stableHash({
      previewRunId,
      snapshotFingerprint: snapshot.digest,
      terminalItems: [...terminalItems].sort((left, right) =>
        left.previewItemId.localeCompare(right.previewItemId)
      ),
      batches
    });
    const requestFingerprint = stableHash({
      accountId,
      candidateId,
      previewRunId,
      snapshotFingerprint: snapshot.digest,
      fingerprintKeyVersion: snapshot.keyVersion,
      applyPlanFingerprint
    });
    let state = await this.repository.beginOrResumeApply({
      accountId,
      candidateId,
      previewRunId,
      sourceSnapshotFingerprint: snapshot.digest,
      fingerprintKeyVersion: snapshot.keyVersion,
      applyPlanFingerprint,
      idempotencyKey,
      requestFingerprint,
      startedAt: evaluatedAt,
      examinedCount: preview.sourceCount,
      terminalItems,
      batches
    });
    if (state.status === "COMPLETED") return state;

    const importsById = new Map(importable.map((item) => [item.previewItemId, item]));
    for (const batch of state.batches) {
      if (batch.status === "COMPLETED") continue;
      const items = batch.previewItemIds.map((id) => {
        const item = importsById.get(id);
        if (!item) throw new Error("Persisted import batch contains an unknown preview item.");
        return item;
      });
      const reconciliations = await this.applySubset({
        accountId,
        candidateId,
        applyRunId: state.applyRunId,
        batchIndex: batch.batchIndex,
        path: "root",
        items
      });
      state = await this.repository.completeBatch({
        accountId,
        candidateId,
        applyRunId: state.applyRunId,
        applyBatchId: batch.applyBatchId,
        batchFingerprint: batch.batchFingerprint,
        completedAt: this.clock.now(),
        items: reconciliations
      });
    }
    return this.repository.completeApply({
      accountId,
      candidateId,
      applyRunId: state.applyRunId,
      completedAt: this.clock.now()
    });
  }

  private async applySubset(input: {
    accountId: string;
    candidateId: string;
    applyRunId: string;
    batchIndex: number;
    path: string;
    items: readonly ImportableItem[];
  }): Promise<CompleteLegacyImportBatchCommand["items"][number][]> {
    try {
      const result = await this.writer.saveGroup({
        accountId: input.accountId,
        candidateId: input.candidateId,
        commitPoint: "LEGACY_IMPORT",
        idempotencyKey: `legacy:${input.applyRunId}:${input.batchIndex}:${input.path}`,
        items: input.items.map((item) => ({
          itemKey: `legacy:${item.sourceOrdinal}:${item.previewItemId.slice(0, 24)}`,
          canonicalKey: item.targetCanonicalKey,
          normalizedValue: item.normalizedValue,
          scopeType: "GLOBAL",
          source: "LEGACY_IMPORT",
          expectedCurrentVersionId: null
        }))
      });
      const resultByKey = new Map(result.items.map((item) => [item.itemKey, item]));
      return input.items.map((item) => {
        const persisted = resultByKey.get(`legacy:${item.sourceOrdinal}:${item.previewItemId.slice(0, 24)}`);
        if (!persisted || persisted.trustState !== "REVIEW") {
          throw new Error("Legacy import writer did not return the required REVIEW result.");
        }
        return {
          previewItemId: item.previewItemId,
          outcome: "IMPORTED" as const,
          reasonCodes: ["LEGACY_VALUE_IMPORTED_AS_REVIEW"],
          answerVersionId: persisted.answerVersionId,
          candidateChangeSetId: result.changeSetId
        };
      });
    } catch (error) {
      if (!(error instanceof ConflictError) && !(error instanceof ValidationError)) throw error;
      if (input.items.length > 1) {
        const middle = Math.ceil(input.items.length / 2);
        const [left, right] = await Promise.all([
          this.applySubset({ ...input, path: `${input.path}.l`, items: input.items.slice(0, middle) }),
          this.applySubset({ ...input, path: `${input.path}.r`, items: input.items.slice(middle) })
        ]);
        return [...left, ...right];
      }
      const [item] = input.items;
      if (!item) throw error;
      const current = await this.repository.listCurrentAnswers({
        accountId: input.accountId,
        candidateId: input.candidateId,
        canonicalKeys: [item.targetCanonicalKey]
      });
      const existing = current.find(
        (answer) =>
          answer.canonicalKey === item.targetCanonicalKey &&
          answer.scopeFingerprint === globalScopeFingerprint()
      );
      if (
        existing &&
        existing.fingerprintKeyVersion === item.valueFingerprintKeyVersion &&
        existing.valueFingerprint === item.valueFingerprint &&
        existing.trustState !== "REMOVED"
      ) {
        return [{
          previewItemId: item.previewItemId,
          outcome: "ALREADY_IMPORTED",
          reasonCodes: ["EQUIVALENT_V2_TRUTH_EXISTS_DURING_APPLY"],
          answerVersionId: null,
          candidateChangeSetId: null
        }];
      }
      return [{
        previewItemId: item.previewItemId,
        outcome: error instanceof ValidationError ? "INVALID" : "CONFLICT",
        reasonCodes: [
          error instanceof ValidationError
            ? "ACTIVE_POLICY_CHANGED_DURING_APPLY"
            : existing
              ? "V2_TRUTH_CHANGED_DURING_APPLY"
              : "LEGACY_IMPORT_COMMIT_CONFLICT"
        ],
        answerVersionId: null,
        candidateChangeSetId: null
      }];
    }
  }
}

export class LegacyImportReconciliationVerifier {
  constructor(
    private readonly repository: Pick<LegacyImportApplyRepository, "verifyCompletedApply">,
    private readonly clock: Clock = systemClock
  ) {}

  async verify(input: {
    accountId: string;
    candidateId: string;
    applyRunId: string;
  }): Promise<LegacyImportVerificationReport> {
    return this.repository.verifyCompletedApply({
      accountId: UuidSchema.parse(input.accountId),
      candidateId: UuidSchema.parse(input.candidateId),
      applyRunId: UuidSchema.parse(input.applyRunId),
      verifiedAt: this.clock.now()
    });
  }
}

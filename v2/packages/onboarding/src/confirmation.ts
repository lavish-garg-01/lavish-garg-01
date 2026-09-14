import { createHash, randomUUID } from "node:crypto";
import {
  PersistableNormalizedValueSchema,
  candidateAnswerPolicy,
  type CandidateAnswerInputSource,
  type CandidateScopeContext,
  type CandidateTruthService,
  type CandidateValueFingerprinter,
  type EntityType,
  type PersistableNormalizedValue,
  type ScopeType
} from "@job-hunter-v2/candidate-truth";
import { UuidSchema } from "@job-hunter-v2/contracts";
import { ValidationError, type Clock, systemClock } from "@job-hunter-v2/domain";
import { z } from "zod";
import type { ResumeOnboardingService, ResumeProposal } from "./resume.js";

export type ProposalAction = "ACCEPT" | "CORRECT" | "REMOVE" | "SKIP";

export interface ProposalReviewDecision {
  proposalId: string;
  action: ProposalAction;
  correctedValue?: PersistableNormalizedValue;
}

export interface ManualCandidateAnswer {
  itemKey: string;
  canonicalKey: string;
  normalizedValue: PersistableNormalizedValue;
  entityType?: EntityType | null;
  entityClientKey?: string | null;
  scopeType?: ScopeType;
  requestedScope?: CandidateScopeContext;
  context?: CandidateScopeContext;
  expectedCurrentVersionId: string | null;
}

export interface CandidateConfirmationResult {
  receiptId: string;
  candidateId: string;
  extractionId: string | null;
  changeSetId: string | null;
  accepted: number;
  corrected: number;
  removed: number;
  skipped: number;
  unchangedMatches: number;
  idempotentReplay: boolean;
  createdAt: Date;
}

export interface CandidateConfirmationRepository {
  findConfirmation(input: {
    accountId: string;
    candidateId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<CandidateConfirmationResult | null>;
  ensureEntity(input: {
    accountId: string;
    candidateId: string;
    entityId: string;
    entityType: EntityType;
    sourceKey: string;
    preferredEntityId?: string | null;
    createdAt: Date;
  }): Promise<string>;
  completeConfirmation(input: {
    receiptId: string;
    accountId: string;
    candidateId: string;
    extractionId: string | null;
    changeSetId: string | null;
    idempotencyKey: string;
    requestFingerprint: string;
    proposalDecisions: readonly { proposalId: string; decision: ResumeProposal["decision"] }[];
    accepted: number;
    corrected: number;
    removed: number;
    skipped: number;
    unchangedMatches: number;
    completedAt: Date;
  }): Promise<CandidateConfirmationResult>;
}

const IdempotencyKeySchema = z.string().trim().min(8).max(170).regex(/^[A-Za-z0-9._:-]+$/);
const ItemKeySchema = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/);

function decisionFingerprint(input: {
  candidateId: string;
  extractionId: string | null;
  decisions: readonly { proposalId: string; action: ProposalAction; valueFingerprint: string | null }[];
  manual: readonly { itemKey: string; canonicalKey: string; valueFingerprint: string; expected: string | null }[];
}): string {
  return createHash("sha256").update(JSON.stringify({
    candidateId: input.candidateId,
    extractionId: input.extractionId,
    decisions: [...input.decisions].sort((a, b) => a.proposalId.localeCompare(b.proposalId)),
    manual: [...input.manual].sort((a, b) => a.itemKey.localeCompare(b.itemKey))
  })).digest("hex");
}

export class CandidateConfirmationService {
  constructor(
    private readonly resumes: Pick<ResumeOnboardingService, "getReview">,
    private readonly truth: Pick<CandidateTruthService, "saveGroup">,
    private readonly repository: CandidateConfirmationRepository,
    private readonly fingerprinter: CandidateValueFingerprinter,
    private readonly clock: Clock = systemClock,
    private readonly newId: () => string = randomUUID
  ) {}

  async confirm(input: {
    accountId: string;
    candidateId: string;
    documentId?: string;
    decisions: readonly ProposalReviewDecision[];
    manualAnswers?: readonly ManualCandidateAnswer[];
    idempotencyKey: string;
  }): Promise<CandidateConfirmationResult> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    const manualAnswers = input.manualAnswers ?? [];
    if (input.decisions.length + manualAnswers.length > 50) {
      throw new ValidationError("Review saves can contain at most 50 answers.");
    }
    const review = input.documentId
      ? await this.resumes.getReview({ accountId, candidateId, documentId: UuidSchema.parse(input.documentId) })
      : null;
    const proposals = review?.proposals ?? [];
    const proposalById = new Map(proposals.map((proposal) => [proposal.proposalId, proposal]));
    if (new Set(input.decisions.map((decision) => decision.proposalId)).size !== input.decisions.length) {
      throw new ValidationError("A review proposal can only be decided once.");
    }
    if (review && (
      input.decisions.length !== proposals.length ||
      input.decisions.some((decision) => !proposalById.has(decision.proposalId))
    )) {
      throw new ValidationError("Review every extracted item before continuing.", {
        reasonCode: "RESUME_REVIEW_INCOMPLETE"
      });
    }
    if (!review && input.decisions.length) throw new ValidationError("Resume decisions require a resume review.");
    if (!review && !manualAnswers.length) throw new ValidationError("Add at least one profile answer to continue without a resume.");

    const parsedDecisions = input.decisions.map((decision) => {
      const proposal = proposalById.get(UuidSchema.parse(decision.proposalId));
      if (!proposal) throw new ValidationError("Resume proposal does not belong to this review.");
      const action = z.enum(["ACCEPT", "CORRECT", "REMOVE", "SKIP"]).parse(decision.action);
      if (action === "CORRECT" && !decision.correctedValue) {
        throw new ValidationError("A corrected value is required.");
      }
      if (action !== "CORRECT" && decision.correctedValue) {
        throw new ValidationError("Only a correction can provide a replacement value.");
      }
      const value = action === "CORRECT"
        ? PersistableNormalizedValueSchema.parse(decision.correctedValue)
        : action === "ACCEPT" ? proposal.normalizedValue : null;
      if (value && candidateAnswerPolicy(proposal.canonicalKey).valueType !== value.kind) {
        throw new ValidationError("The corrected value does not match this field.");
      }
      return { proposal, action, value };
    });

    const parsedManual = manualAnswers.map((answer) => {
      const canonicalKey = answer.canonicalKey.trim().toUpperCase();
      const policy = candidateAnswerPolicy(canonicalKey);
      const value = PersistableNormalizedValueSchema.parse(answer.normalizedValue);
      if (policy.valueType !== value.kind) throw new ValidationError("The profile value does not match this field.");
      if (policy.entityType !== (answer.entityType ?? null)) {
        throw new ValidationError("The profile field has an invalid history type.");
      }
      return {
        ...answer,
        itemKey: ItemKeySchema.parse(answer.itemKey),
        canonicalKey,
        normalizedValue: value,
        entityType: answer.entityType ?? null,
        entityClientKey: answer.entityClientKey ?? null,
        scopeType: answer.scopeType ?? "GLOBAL"
      };
    });

    const fingerprint = decisionFingerprint({
      candidateId,
      extractionId: review?.extraction?.extractionId ?? null,
      decisions: parsedDecisions.map(({ proposal, action, value }) => ({
        proposalId: proposal.proposalId,
        action,
        valueFingerprint: value ? this.fingerprinter.fingerprint(value).digest : null
      })),
      manual: parsedManual.map((answer) => ({
        itemKey: answer.itemKey,
        canonicalKey: answer.canonicalKey,
        valueFingerprint: this.fingerprinter.fingerprint(answer.normalizedValue).digest,
        expected: answer.expectedCurrentVersionId
      }))
    });
    const replay = await this.repository.findConfirmation({ accountId, candidateId, idempotencyKey, requestFingerprint: fingerprint });
    if (replay) return { ...replay, idempotentReplay: true };

    const entityIds = new Map<string, string>();
    const entityRequests = new Map<string, { entityType: EntityType; preferredEntityId: string | null }>();
    for (const { proposal, action } of parsedDecisions) {
      if (["ACCEPT", "CORRECT"].includes(action) && proposal.entityType && proposal.entityGroupKey) {
        entityRequests.set(`resume:${proposal.entityGroupKey}`, {
          entityType: proposal.entityType,
          preferredEntityId: proposal.matchedEntityId
        });
      }
    }
    for (const answer of parsedManual) {
      if (answer.entityType && answer.entityClientKey) {
        entityRequests.set(`manual:${answer.entityClientKey}`, { entityType: answer.entityType, preferredEntityId: null });
      }
    }
    for (const [sourceKey, request] of entityRequests) {
      entityIds.set(sourceKey, await this.repository.ensureEntity({
        accountId, candidateId, entityId: this.newId(), entityType: request.entityType,
        sourceKey, preferredEntityId: request.preferredEntityId, createdAt: this.clock.now()
      }));
    }

    const saveItems: {
      itemKey: string;
      canonicalKey: string;
      normalizedValue: PersistableNormalizedValue;
      scopeType: ScopeType;
      requestedScope?: CandidateScopeContext;
      context?: CandidateScopeContext;
      entityId: string | null;
      source: CandidateAnswerInputSource;
      expectedCurrentVersionId: string | null;
    }[] = [];
    for (const { proposal, action, value } of parsedDecisions) {
      if (!value || (action === "ACCEPT" && ["MATCH", "REPEATABLE_ENTITY_MATCH"].includes(proposal.comparison)
        && proposal.existingAnswerVersionId)) continue;
      const entityId = proposal.entityType && proposal.entityGroupKey
        ? entityIds.get(`resume:${proposal.entityGroupKey}`) ?? null
        : null;
      saveItems.push({
        itemKey: `proposal:${proposal.proposalId}`,
        canonicalKey: proposal.canonicalKey,
        normalizedValue: value,
        scopeType: "GLOBAL",
        entityId,
        source: action === "CORRECT" ? "USER_CORRECTION" : "VERIFIED_RESUME",
        expectedCurrentVersionId: proposal.existingAnswerVersionId
      });
    }
    for (const answer of parsedManual) {
      const entityId = answer.entityType && answer.entityClientKey
        ? entityIds.get(`manual:${answer.entityClientKey}`) ?? null
        : null;
      saveItems.push({
        itemKey: `manual:${answer.itemKey}`,
        canonicalKey: answer.canonicalKey,
        normalizedValue: answer.normalizedValue,
        scopeType: answer.scopeType,
        ...(answer.requestedScope ? { requestedScope: answer.requestedScope } : {}),
        ...(answer.context ? { context: answer.context } : {}),
        entityId,
        source: "USER_MANUAL",
        expectedCurrentVersionId: answer.expectedCurrentVersionId
      });
    }
    if (new Set(saveItems.map((item) => item.itemKey)).size !== saveItems.length) {
      throw new ValidationError("Profile item keys must be unique.");
    }
    const saved = saveItems.length
      ? await this.truth.saveGroup({
          accountId, candidateId, commitPoint: "EXPLICIT_SAVE",
          idempotencyKey: `confirm:${idempotencyKey}`,
          items: saveItems
        })
      : null;
    const accepted = parsedDecisions.filter((item) => item.action === "ACCEPT").length;
    const corrected = parsedDecisions.filter((item) => item.action === "CORRECT").length;
    const removed = parsedDecisions.filter((item) => item.action === "REMOVE").length;
    const skipped = parsedDecisions.filter((item) => item.action === "SKIP").length;
    const unchangedMatches = parsedDecisions.filter(
      (item) => item.action === "ACCEPT" && ["MATCH", "REPEATABLE_ENTITY_MATCH"].includes(item.proposal.comparison)
        && Boolean(item.proposal.existingAnswerVersionId)
    ).length;
    return this.repository.completeConfirmation({
      receiptId: this.newId(), accountId, candidateId,
      extractionId: review?.extraction?.extractionId ?? null,
      changeSetId: saved?.changeSetId ?? null, idempotencyKey,
      requestFingerprint: fingerprint,
      proposalDecisions: parsedDecisions.map(({ proposal, action }) => ({
        proposalId: proposal.proposalId,
        decision: action === "ACCEPT" ? "ACCEPTED" : action === "CORRECT" ? "CORRECTED" : action === "REMOVE" ? "REMOVED" : "SKIPPED"
      })),
      accepted, corrected, removed, skipped, unchangedMatches,
      completedAt: this.clock.now()
    });
  }
}

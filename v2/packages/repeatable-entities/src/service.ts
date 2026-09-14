import { createHash, randomUUID } from "node:crypto";
import {
  CompactEntityBindingAiPayloadSchema,
  EntityBindingAiOutputSchema,
  EntityBindingReceiptSchema,
  FormRepeatGroupEvidenceSchema,
  type CandidateEntityType,
  type CompactEntityBindingAiPayload,
  type EntityBindingReceipt,
  type EntityBindingState,
  type FieldSemanticResolution,
  type FormRepeatGroupEvidence
} from "@job-hunter-v2/contracts";
import { ConflictError, IdempotencyConflictError, NotFoundError, ValidationError, type Clock, systemClock } from "@job-hunter-v2/domain";
import { z } from "zod";

export interface CandidateEntityDescriptor {
  candidateEntityId: string;
  entityType: CandidateEntityType;
  entityVersion: number;
  entityRevision: string;
  status: "ACTIVE" | "REMOVED";
  displayOrder: number | null;
  recencyRank: number | null;
  canonicalCoverage: readonly string[];
  privateValueFingerprints: readonly string[];
}

export interface StoredEntityBinding {
  receipt: EntityBindingReceipt;
  structuralFingerprint: string;
}

export interface RepeatableEntityRepository {
  invalidateBindingsExcept(input: {
    accountId: string;
    candidateId: string;
    applicationRunId: string;
    pageInstanceId: string;
    activeFormRepeatGroupIds: readonly string[];
    invalidatedAt: Date;
  }): Promise<void>;
  listCandidateEntities(input: {
    accountId: string;
    candidateId: string;
    entityTypes: readonly CandidateEntityType[];
  }): Promise<readonly CandidateEntityDescriptor[]>;
  findBinding(input: {
    accountId: string;
    candidateId: string;
    applicationRunId: string;
    pageInstanceId: string;
    formRepeatGroupId: string;
  }): Promise<StoredEntityBinding | null>;
  saveBinding(input: {
    bindingId: string;
    accountId: string;
    candidateId: string;
    applicationRunId: string;
    pageInstanceId: string;
    formInstanceId: string;
    group: FormRepeatGroupEvidence;
    receipt: EntityBindingReceipt;
    createdAt: Date;
  }): Promise<EntityBindingReceipt>;
  mutateEntity(input: {
    receiptId: string;
    accountId: string;
    candidateId: string;
    candidateEntityId: string;
    action: "REMOVE" | "RESTORE";
    expectedEntityVersion: number;
    idempotencyKey: string;
    requestFingerprint: string;
    occurredAt: Date;
  }): Promise<CandidateEntityLifecycleResult>;
  reorderEntities(input: {
    receiptId: string;
    accountId: string;
    candidateId: string;
    entityType: CandidateEntityType;
    orderedEntityIds: readonly string[];
    expectedEntityVersions: Readonly<Record<string, number>>;
    idempotencyKey: string;
    requestFingerprint: string;
    occurredAt: Date;
  }): Promise<CandidateEntityReorderResult>;
}

export interface CandidateEntityLifecycleResult {
  candidateEntityId: string;
  status: "ACTIVE" | "REMOVED";
  entityVersion: number;
  idempotentReplay: boolean;
}

export interface CandidateEntityReorderResult {
  entityType: CandidateEntityType;
  orderedEntityIds: readonly string[];
  entityVersions: Readonly<Record<string, number>>;
  idempotentReplay: boolean;
}

export interface EntityBindingAiPort {
  resolve(payload: CompactEntityBindingAiPayload, context?: { accountId: string; candidateId: string; applicationRunId: string | null }): Promise<unknown>;
}

export interface RepeatableBindingField {
  fieldRuntimeId: string;
  formInstanceId: string;
  group: FormRepeatGroupEvidence;
  semantic: FieldSemanticResolution;
}

export interface BindRepeatableEntitiesInput {
  accountId: string;
  candidateId: string;
  applicationRunId: string | null;
  pageInstanceId: string;
  fields: readonly RepeatableBindingField[];
}

export interface RepeatableEntityBindingResult {
  byFieldRuntimeId: ReadonlyMap<string, EntityBindingReceipt>;
  capacityByEntityType: ReadonlyMap<CandidateEntityType, { activeCount: number; boundCount: number; remainingCount: number }>;
  aiRequests: number;
}

const highThreshold = 0.88;
const mediumThreshold = 0.72;
const highMargin = 0.12;

function digest(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function confidenceBucket(confidence: number): "HIGH" | "MEDIUM" | "LOW" | "NONE" {
  if (confidence >= highThreshold) return "HIGH";
  if (confidence >= mediumThreshold) return "MEDIUM";
  if (confidence > 0) return "LOW";
  return "NONE";
}

function unbound(group: FormRepeatGroupEvidence, state: EntityBindingState, error: EntityBindingReceipt["errorCodes"][number], reason: string): EntityBindingReceipt {
  return EntityBindingReceiptSchema.parse({
    schemaVersion: 1, formRepeatGroupId: group.formRepeatGroupId, entityType: group.entityType,
    state, candidateEntityId: null, candidateEntityVersion: null, candidateEntityRevision: null,
    bindingVersion: 1, confidence: 0, confidenceBucket: "NONE", evidenceCategories: [],
    reasonCodes: [reason], errorCodes: [error], valuePrivate: true, containsCandidateValue: false
  });
}

interface ScoredCandidate { candidate: CandidateEntityDescriptor; score: number; evidence: EntityBindingReceipt["evidenceCategories"]; }

function scoreCandidates(group: FormRepeatGroupEvidence, candidates: readonly CandidateEntityDescriptor[], prior: StoredEntityBinding | null): ScoredCandidate[] {
  return candidates.map((candidate) => {
    let score = 0;
    const evidence: EntityBindingReceipt["evidenceCategories"] = [];
    if (prior?.receipt.candidateEntityId === candidate.candidateEntityId && prior.receipt.candidateEntityRevision === candidate.entityRevision) {
      score += 0.96;
      evidence.push("PRIOR_VERIFIED_BINDING");
    }
    if (candidates.length === 1) {
      score += 0.9;
      evidence.push("UNIQUE_ENTITY_OF_TYPE");
    }
    if (group.identityKind === "STABLE_DOM") {
      score += 0.04;
      evidence.push("STABLE_FORM_GROUP");
    }
    if ((group.semanticRole === "CURRENT" || group.semanticRole === "MOST_RECENT") && candidate.recencyRank === 0) {
      score += 0.88;
      evidence.push("SEMANTIC_ROLE");
    } else if (group.semanticRole === "PREVIOUS" && candidate.recencyRank === 1) {
      score += 0.84;
      evidence.push("SEMANTIC_ROLE");
    }
    return { candidate, score: Math.min(1, score), evidence: [...new Set(evidence)] };
  }).sort((left, right) => right.score - left.score || left.candidate.candidateEntityId.localeCompare(right.candidate.candidateEntityId));
}

function boundReceipt(group: FormRepeatGroupEvidence, scored: ScoredCandidate, state: "BOUND_HIGH" | "BOUND_MEDIUM", ai = false): EntityBindingReceipt {
  return EntityBindingReceiptSchema.parse({
    schemaVersion: 1, formRepeatGroupId: group.formRepeatGroupId, entityType: group.entityType,
    state, candidateEntityId: scored.candidate.candidateEntityId,
    candidateEntityVersion: scored.candidate.entityVersion,
    candidateEntityRevision: scored.candidate.entityRevision,
    bindingVersion: 1, confidence: scored.score, confidenceBucket: confidenceBucket(scored.score),
    evidenceCategories: ai ? [...scored.evidence, "AI_SELECTION"] : scored.evidence,
    reasonCodes: [state === "BOUND_HIGH" ? "ENTITY_BINDING_DETERMINISTIC_HIGH" : "ENTITY_BINDING_REQUIRES_REVIEW"],
    errorCodes: [], valuePrivate: true, containsCandidateValue: false
  });
}

export class RepeatableEntityIntelligenceService {
  constructor(
    private readonly repository: RepeatableEntityRepository,
    private readonly ai: EntityBindingAiPort | null = null,
    private readonly clock: Clock = systemClock,
    private readonly newId: () => string = randomUUID
  ) {}

  async bind(input: BindRepeatableEntitiesInput): Promise<RepeatableEntityBindingResult> {
    const grouped = new Map<string, RepeatableBindingField[]>();
    for (const field of input.fields) {
      const group = FormRepeatGroupEvidenceSchema.parse(field.group);
      const existing = grouped.get(group.formRepeatGroupId) ?? [];
      existing.push({ ...field, group });
      grouped.set(group.formRepeatGroupId, existing);
    }
    if (input.applicationRunId) {
      await this.repository.invalidateBindingsExcept({
        accountId: input.accountId,
        candidateId: input.candidateId,
        applicationRunId: input.applicationRunId,
        pageInstanceId: input.pageInstanceId,
        activeFormRepeatGroupIds: [...grouped.keys()],
        invalidatedAt: this.clock.now()
      });
    }
    const entityTypes = [...new Set([...grouped.values()].map((fields) => fields[0]?.group.entityType).filter((value): value is CandidateEntityType => Boolean(value)))];
    const entities = entityTypes.length ? await this.repository.listCandidateEntities({
      accountId: input.accountId, candidateId: input.candidateId, entityTypes
    }) : [];
    const byFieldRuntimeId = new Map<string, EntityBindingReceipt>();
    let aiRequests = 0;
    for (const fields of grouped.values()) {
      const first = fields[0];
      if (!first) continue;
      const group = first.group;
      let receipt: EntityBindingReceipt;
      if (!group.entityType) {
        receipt = unbound(group, "UNSUPPORTED", "ENTITY_TYPE_UNKNOWN", "ENTITY_TYPE_UNKNOWN");
      } else {
        const candidates = entities.filter((entity) => entity.entityType === group.entityType && entity.status === "ACTIVE");
        if (!candidates.length) {
          receipt = unbound(group, "UNBOUND", "NO_ENTITY_CANDIDATE", "NO_ACTIVE_ENTITY_OF_TYPE");
        } else {
          const prior = input.applicationRunId ? await this.repository.findBinding({
            accountId: input.accountId, candidateId: input.candidateId, applicationRunId: input.applicationRunId,
            pageInstanceId: input.pageInstanceId, formRepeatGroupId: group.formRepeatGroupId
          }) : null;
          if (prior && prior.structuralFingerprint !== group.structuralFingerprint) {
            receipt = unbound(group, "UNBOUND", "FORM_GROUP_STALE", "FORM_GROUP_STRUCTURE_CHANGED");
          } else if (prior?.receipt.candidateEntityId && !candidates.some((candidate) =>
            candidate.candidateEntityId === prior.receipt.candidateEntityId &&
            candidate.entityRevision === prior.receipt.candidateEntityRevision
          )) {
            receipt = unbound(group, "UNBOUND", "ENTITY_BINDING_STALE", "CANDIDATE_ENTITY_CHANGED_AFTER_BINDING");
          } else {
            const scored = scoreCandidates(group, candidates, prior);
            const best = scored[0];
            const next = scored[1];
            const margin = best ? best.score - (next?.score ?? 0) : 0;
            if (best && best.score >= highThreshold && margin >= highMargin && (group.identityKind !== "ORDINAL_ONLY" || candidates.length === 1)) {
              receipt = boundReceipt(group, best, "BOUND_HIGH");
            } else if (best && this.ai && group.identityKind !== "ORDINAL_ONLY") {
              aiRequests += 1;
              const payload = CompactEntityBindingAiPayloadSchema.parse({
                entityType: group.entityType,
                group: {
                  semanticRole: group.semanticRole, identityKind: group.identityKind,
                  canonicalKeys: [...new Set(fields.map((field) => field.semantic.canonicalKey).filter((key): key is string => Boolean(key)))]
                },
                candidates: candidates.map((candidate) => ({
                  candidateEntityId: candidate.candidateEntityId, recencyRank: candidate.recencyRank,
                  canonicalCoverage: [...candidate.canonicalCoverage]
                })),
                containsCandidateValue: false
              });
              const parsed = EntityBindingAiOutputSchema.safeParse(await this.ai.resolve(payload, {
                accountId: input.accountId, candidateId: input.candidateId, applicationRunId: input.applicationRunId
              }).catch(() => null));
              const selected = parsed.success && parsed.data.selectedCandidateEntityId
                ? scored.find((item) => item.candidate.candidateEntityId === parsed.data.selectedCandidateEntityId)
                : null;
              if (parsed.success && !parsed.data.ambiguous && selected && parsed.data.confidence >= highThreshold) {
                receipt = boundReceipt(group, { ...selected, score: parsed.data.confidence }, "BOUND_HIGH", true);
              } else {
                receipt = unbound(group, "AMBIGUOUS", parsed.success ? "ENTITY_BINDING_AMBIGUOUS" : "AI_SCHEMA_INVALID", "ENTITY_BINDING_AMBIGUOUS");
              }
            } else if (best && best.score >= mediumThreshold && margin >= highMargin && group.identityKind !== "ORDINAL_ONLY") {
              receipt = boundReceipt(group, best, "BOUND_MEDIUM");
            } else {
              receipt = unbound(group, "AMBIGUOUS", group.identityKind === "ORDINAL_ONLY" ? "ORDINAL_ONLY_NOT_AUTHORITATIVE" : "ENTITY_BINDING_AMBIGUOUS", "ENTITY_BINDING_AMBIGUOUS");
            }
          }
        }
      }
      if (input.applicationRunId) {
        receipt = await this.repository.saveBinding({
          bindingId: this.newId(), accountId: input.accountId, candidateId: input.candidateId,
          applicationRunId: input.applicationRunId, pageInstanceId: input.pageInstanceId,
          formInstanceId: first.formInstanceId, group, receipt, createdAt: this.clock.now()
        });
      }
      for (const field of fields) byFieldRuntimeId.set(field.fieldRuntimeId, receipt);
    }
    const boundIdsByType = new Map<CandidateEntityType, Set<string>>();
    for (const receipt of byFieldRuntimeId.values()) {
      if (receipt.state !== "BOUND_HIGH" || !receipt.candidateEntityId || !receipt.entityType) continue;
      const ids = boundIdsByType.get(receipt.entityType) ?? new Set<string>();
      ids.add(receipt.candidateEntityId);
      boundIdsByType.set(receipt.entityType, ids);
    }
    const capacityByEntityType = new Map<CandidateEntityType, { activeCount: number; boundCount: number; remainingCount: number }>();
    for (const entityType of entityTypes) {
      const activeCount = entities.filter((entity) => entity.entityType === entityType && entity.status === "ACTIVE").length;
      const boundCount = boundIdsByType.get(entityType)?.size ?? 0;
      capacityByEntityType.set(entityType, { activeCount, boundCount, remainingCount: Math.max(0, activeCount - boundCount) });
    }
    return { byFieldRuntimeId, capacityByEntityType, aiRequests };
  }

  async listEntities(input: { accountId: string; candidateId: string }) {
    const entities = await this.repository.listCandidateEntities({
      accountId: z.uuid().parse(input.accountId), candidateId: z.uuid().parse(input.candidateId),
      entityTypes: ["EMPLOYMENT", "EDUCATION", "PROJECT", "CERTIFICATION", "LANGUAGE"]
    });
    return entities.map((entity) => ({
      candidateEntityId: entity.candidateEntityId, entityType: entity.entityType,
      entityVersion: entity.entityVersion, status: entity.status, displayOrder: entity.displayOrder
    }));
  }

  removeEntity(input: { accountId: string; candidateId: string; candidateEntityId: string; expectedEntityVersion: number; idempotencyKey: string }) {
    return this.mutate(input, "REMOVE");
  }

  restoreEntity(input: { accountId: string; candidateId: string; candidateEntityId: string; expectedEntityVersion: number; idempotencyKey: string }) {
    return this.mutate(input, "RESTORE");
  }

  private mutate(input: { accountId: string; candidateId: string; candidateEntityId: string; expectedEntityVersion: number; idempotencyKey: string }, action: "REMOVE" | "RESTORE") {
    const parsed = {
      accountId: z.uuid().parse(input.accountId), candidateId: z.uuid().parse(input.candidateId),
      candidateEntityId: z.uuid().parse(input.candidateEntityId),
      expectedEntityVersion: z.number().int().positive().parse(input.expectedEntityVersion),
      idempotencyKey: z.string().trim().min(8).max(170).parse(input.idempotencyKey)
    };
    return this.repository.mutateEntity({
      receiptId: this.newId(), ...parsed, action,
      requestFingerprint: digest({ action, entityId: parsed.candidateEntityId, expected: parsed.expectedEntityVersion }),
      occurredAt: this.clock.now()
    });
  }

  reorderEntities(input: { accountId: string; candidateId: string; entityType: CandidateEntityType; orderedEntityIds: readonly string[]; expectedEntityVersions: Readonly<Record<string, number>>; idempotencyKey: string }) {
    const entityType = z.enum(["EMPLOYMENT", "EDUCATION", "PROJECT", "CERTIFICATION", "LANGUAGE"]).parse(input.entityType);
    const orderedEntityIds = z.array(z.uuid()).min(1).max(100).parse(input.orderedEntityIds);
    if (new Set(orderedEntityIds).size !== orderedEntityIds.length) throw new ValidationError("Entity reorder contains duplicates.");
    const expectedEntityVersions = Object.fromEntries(orderedEntityIds.map((id) => [id, z.number().int().positive().parse(input.expectedEntityVersions[id])]));
    const idempotencyKey = z.string().trim().min(8).max(170).parse(input.idempotencyKey);
    return this.repository.reorderEntities({
      receiptId: this.newId(), accountId: z.uuid().parse(input.accountId), candidateId: z.uuid().parse(input.candidateId),
      entityType, orderedEntityIds, expectedEntityVersions, idempotencyKey,
      requestFingerprint: digest({ entityType, orderedEntityIds, expectedEntityVersions }), occurredAt: this.clock.now()
    });
  }
}

export { ConflictError, IdempotencyConflictError, NotFoundError };

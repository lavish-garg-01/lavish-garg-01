import { z } from "zod";

export const REPEATABLE_ENTITY_INTELLIGENCE_VERSION = 1 as const;

export const CandidateEntityTypeSchema = z.enum([
  "EMPLOYMENT", "EDUCATION", "PROJECT", "CERTIFICATION", "LANGUAGE"
]);
export type CandidateEntityType = z.infer<typeof CandidateEntityTypeSchema>;

export const FormRepeatGroupIdentityKindSchema = z.enum([
  "STABLE_DOM", "SESSION_ELEMENT", "ORDINAL_ONLY"
]);
export type FormRepeatGroupIdentityKind = z.infer<typeof FormRepeatGroupIdentityKindSchema>;

export const FormRepeatSemanticRoleSchema = z.enum([
  "CURRENT", "MOST_RECENT", "PREVIOUS", "OTHER", "UNKNOWN"
]);

export const EntityBindingStateSchema = z.enum([
  "BOUND_HIGH", "BOUND_MEDIUM", "AMBIGUOUS", "UNBOUND", "UNSUPPORTED"
]);
export type EntityBindingState = z.infer<typeof EntityBindingStateSchema>;

export const EntityBindingEvidenceCategorySchema = z.enum([
  "PRIOR_VERIFIED_BINDING",
  "EXPLICIT_CANDIDATE_ENTITY",
  "UNIQUE_ENTITY_OF_TYPE",
  "SEMANTIC_ROLE",
  "CANONICAL_COVERAGE",
  "STABLE_FORM_GROUP",
  "PRIVATE_VALUE_FINGERPRINT",
  "POSITIONAL_ASSIGNMENT",
  "AI_SELECTION"
]);

export const EntityBindingFailureCodeSchema = z.enum([
  "ENTITY_TYPE_UNKNOWN",
  "NO_ENTITY_CANDIDATE",
  "ENTITY_BINDING_AMBIGUOUS",
  "ENTITY_BINDING_STALE",
  "FORM_GROUP_STALE",
  "ENTITY_REMOVED",
  "ENTITY_VERSION_CONFLICT",
  "ENTITY_POLICY_REJECTED",
  "ORDINAL_ONLY_NOT_AUTHORITATIVE",
  "AI_SCHEMA_INVALID",
  "AI_UNAVAILABLE"
]);
export type EntityBindingFailureCode = z.infer<typeof EntityBindingFailureCodeSchema>;

export const FormRepeatGroupEvidenceSchema = z.object({
  schemaVersion: z.literal(REPEATABLE_ENTITY_INTELLIGENCE_VERSION),
  formRepeatGroupId: z.string().min(8).max(120),
  identityKind: FormRepeatGroupIdentityKindSchema,
  stableGroupKey: z.string().min(1).max(160).nullable(),
  structuralFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  entityType: CandidateEntityTypeSchema.nullable(),
  semanticRole: FormRepeatSemanticRoleSchema,
  ordinalHint: z.number().int().nonnegative().max(100).nullable(),
  groupLabel: z.string().max(180).nullable()
}).strict();
export type FormRepeatGroupEvidence = z.infer<typeof FormRepeatGroupEvidenceSchema>;

export const EntityBindingReceiptSchema = z.object({
  schemaVersion: z.literal(REPEATABLE_ENTITY_INTELLIGENCE_VERSION),
  formRepeatGroupId: z.string().min(8).max(120),
  entityType: CandidateEntityTypeSchema.nullable(),
  state: EntityBindingStateSchema,
  candidateEntityId: z.uuid().nullable(),
  candidateEntityVersion: z.number().int().positive().nullable(),
  candidateEntityRevision: z.string().length(64).regex(/^[a-f0-9]+$/).nullable(),
  bindingVersion: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
  confidenceBucket: z.enum(["HIGH", "MEDIUM", "LOW", "NONE"]),
  evidenceCategories: z.array(EntityBindingEvidenceCategorySchema).max(12),
  reasonCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(100)).max(16),
  errorCodes: z.array(EntityBindingFailureCodeSchema).max(8),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict().superRefine((value, context) => {
  const bound = value.state === "BOUND_HIGH" || value.state === "BOUND_MEDIUM";
  if (bound && (!value.candidateEntityId || !value.candidateEntityVersion || !value.candidateEntityRevision)) {
    context.addIssue({ code: "custom", message: "BOUND_ENTITY_REQUIRES_STABLE_IDENTITY" });
  }
  if (!bound && value.candidateEntityId) {
    context.addIssue({ code: "custom", message: "UNBOUND_ENTITY_CANNOT_EXPOSE_IDENTITY" });
  }
  if (value.state === "BOUND_HIGH" && value.confidenceBucket !== "HIGH") {
    context.addIssue({ code: "custom", message: "HIGH_BINDING_REQUIRES_HIGH_CONFIDENCE" });
  }
});
export type EntityBindingReceipt = z.infer<typeof EntityBindingReceiptSchema>;

export const CompactEntityBindingAiPayloadSchema = z.object({
  entityType: CandidateEntityTypeSchema,
  group: z.object({
    semanticRole: FormRepeatSemanticRoleSchema,
    identityKind: FormRepeatGroupIdentityKindSchema,
    canonicalKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140)).max(30)
  }).strict(),
  candidates: z.array(z.object({
    candidateEntityId: z.uuid(),
    recencyRank: z.number().int().nonnegative().nullable(),
    canonicalCoverage: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140)).max(30)
  }).strict()).min(1).max(20),
  containsCandidateValue: z.literal(false)
}).strict();
export type CompactEntityBindingAiPayload = z.infer<typeof CompactEntityBindingAiPayloadSchema>;

export const EntityBindingAiOutputSchema = z.object({
  selectedCandidateEntityId: z.uuid().nullable(),
  confidence: z.number().min(0).max(1),
  ambiguous: z.boolean(),
  reasonCategory: z.enum(["ROLE_MATCH", "COVERAGE_MATCH", "PRIOR_STRUCTURE", "INSUFFICIENT_EVIDENCE"])
}).strict();
export type EntityBindingAiOutput = z.infer<typeof EntityBindingAiOutputSchema>;

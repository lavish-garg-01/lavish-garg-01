import { z } from "zod";
import { QuestionContractSchema } from "./question-contract.js";
import { EntityBindingReceiptSchema, FormRepeatGroupEvidenceSchema } from "./repeatable-entities.js";

export const FIELD_EVIDENCE_VERSION = 1 as const;
export const FIELD_INTELLIGENCE_VERSION = 1 as const;

export const SemanticControlTypeSchema = z.enum([
  "TEXT", "EMAIL", "TEL", "NUMBER", "DATE", "FILE", "SELECT", "CHECKBOX", "RADIO",
  "TEXTAREA", "BUTTON", "COMBOBOX", "MULTISELECT", "UNKNOWN"
]);
export type SemanticControlType = z.infer<typeof SemanticControlTypeSchema>;

export const RepeatableEntityTypeSchema = z.enum([
  "EMPLOYMENT", "EDUCATION", "PROJECT", "CERTIFICATION", "LANGUAGE", "REFERENCE", "ADDRESS"
]);

export const RepeatableEvidenceSchema = z.object({
  entityType: RepeatableEntityTypeSchema.nullable(),
  bindingKind: z.enum(["NONE", "DOM_STABLE_KEY", "CANDIDATE_ENTITY", "ORDINAL_HINT"]),
  instanceKey: z.string().min(1).max(160).nullable(),
  candidateEntityId: z.uuid().nullable(),
  ordinalHint: z.number().int().nonnegative().max(100).nullable(),
  groupLabel: z.string().max(180).nullable(),
  formGroup: FormRepeatGroupEvidenceSchema.nullable().optional()
}).strict().superRefine((value, context) => {
  if (value.bindingKind === "CANDIDATE_ENTITY" && !value.candidateEntityId) {
    context.addIssue({ code: "custom", message: "CANDIDATE_ENTITY_BINDING_REQUIRES_ID" });
  }
  if (value.bindingKind !== "CANDIDATE_ENTITY" && value.candidateEntityId) {
    context.addIssue({ code: "custom", message: "CANDIDATE_ENTITY_ID_WITHOUT_BINDING" });
  }
});

export const FieldEvidenceInputSchema = z.object({
  question:QuestionContractSchema.optional(),
  evidenceVersion: z.literal(FIELD_EVIDENCE_VERSION),
  fieldRuntimeId: z.string().min(8).max(100),
  pageInstanceId: z.uuid(),
  formInstanceId: z.string().min(8).max(100),
  sectionFingerprint: z.string().min(8).max(80),
  controlFingerprint: z.string().min(8).max(80),
  controlType: SemanticControlTypeSchema,
  labelEvidence: z.array(z.string().min(1).max(180)).max(6),
  contextEvidence: z.object({
    section: z.string().max(180).nullable(),
    previousLabel: z.string().max(180).nullable(),
    nextLabel: z.string().max(180).nullable(),
    semanticGroup: z.string().max(100).nullable(),
    pageHeading: z.string().max(180).nullable(),
    formHeading: z.string().max(180).nullable(),
    nearbyDescription: z.string().max(300).nullable()
  }).strict(),
  locatorEvidence: z.object({
    contentEditable: z.boolean().optional(),
    ariaAutocomplete:z.boolean().optional(),
    tagName: z.string().min(1).max(30),
    type: z.string().max(40).nullable(),
    name: z.string().max(160).nullable(),
    id: z.string().max(160).nullable(),
    autocomplete: z.string().max(100).nullable(),
    ariaLabel: z.string().max(180).nullable(),
    placeholder: z.string().max(180).nullable(),
    role: z.string().max(80).nullable(),
    accessibleDescription: z.string().max(300).nullable(),
    occurrence: z.number().int().nonnegative().max(10_000)
  }).strict(),
  optionEvidence: z.object({
    count: z.number().int().nonnegative().max(10_000),
    samples: z.array(z.string().min(1).max(120)).max(12)
  }).strict(),
  repeatableEvidence: RepeatableEvidenceSchema,
  required: z.boolean(),
  disabled: z.boolean(),
  ownership: z.enum(["UNKNOWN", "SHARED", "COPILOT_OWNED", "USER_OWNED"])
}).strict();
export type FieldEvidenceInput = z.infer<typeof FieldEvidenceInputSchema>;

export const FieldIntelligencePageContextSchema = z.object({
  host: z.string().min(1).max(255),
  ats: z.string().min(1).max(80).default("GENERIC"),
  pageHeading: z.string().max(180).nullable().default(null),
  jobId: z.uuid().nullable().default(null),
  applicationId: z.uuid().nullable().default(null),
  countryCode: z.string().regex(/^[A-Z]{2}$/).nullable().default(null),
  roleFamily: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(100).nullable().default(null),
  companyId: z.uuid().nullable().default(null)
}).strict();
export type FieldIntelligencePageContext = z.infer<typeof FieldIntelligencePageContextSchema>;

export const ResolveFieldIntelligenceRequestSchema = z.object({
  schemaVersion: z.literal(FIELD_INTELLIGENCE_VERSION),
  requestId: z.uuid(),
  applicationRunId: z.uuid().nullable(),
  pageContext: FieldIntelligencePageContextSchema,
  fields: z.array(FieldEvidenceInputSchema).max(500)
}).strict();
export type ResolveFieldIntelligenceRequest = z.infer<typeof ResolveFieldIntelligenceRequestSchema>;

export const SemanticResolutionStateSchema = z.enum([
  "RESOLVED_HIGH", "RESOLVED_MEDIUM", "AMBIGUOUS", "UNRESOLVED", "UNSUPPORTED"
]);
export const SemanticResolverSchema = z.enum([
  "EXACT_ALIAS", "DETERMINISTIC", "AI_ASSISTED", "CACHE", "NONE"
]);
export const SemanticErrorCodeSchema = z.enum([
  "NO_CANONICAL_CANDIDATE", "AMBIGUOUS_CANONICAL", "FIELD_CONTEXT_INSUFFICIENT",
  "FIELD_TYPE_INCOMPATIBLE", "AI_SCHEMA_INVALID", "AI_UNAVAILABLE",
  "AI_TASK_UNSUPPORTED", "AI_ROUTE_UNAVAILABLE", "AI_BUDGET_EXCEEDED", "AI_QUOTA_EXHAUSTED",
  "AI_PROVIDER_UNAVAILABLE", "AI_RATE_LIMITED", "AI_TIMEOUT", "AI_CONFIDENCE_INSUFFICIENT",
  "AI_PRIVACY_POLICY_BLOCKED", "AI_CONTEXT_TOO_LARGE", "AI_FALLBACK_EXHAUSTED",
  "AI_AUTH_CONFIGURATION_ERROR", "AI_SAFETY_REJECTED", "AI_IDEMPOTENCY_CONFLICT",
  "AI_OUTPUT_TRUNCATED", "AI_PROVIDER_SCHEMA_REJECTED", "AI_MODEL_UNAVAILABLE",
  "CANONICAL_POLICY_REJECTED", "STALE_FIELD_RUNTIME", "UNSUPPORTED_CONTROL"
]);

export const DeclarationSemanticHintStateSchema = z.enum([
  "NOT_DECLARATION",
  "KNOWN_DECLARATION",
  "DECLARATION_LIKE"
]);
export type DeclarationSemanticHintState = z.infer<typeof DeclarationSemanticHintStateSchema>;

export const DeclarationTextEvidenceSchema = z.enum(["FULL", "PARTIAL", "UNAVAILABLE"]);
export type DeclarationTextEvidence = z.infer<typeof DeclarationTextEvidenceSchema>;

export const DeclarationSemanticEvidenceSourceSchema = z.enum([
  "CANONICAL_MATCH",
  "LABEL",
  "ARIA_LABEL",
  "ACCESSIBLE_DESCRIPTION",
  "SECTION_CONTEXT",
  "NEARBY_DESCRIPTION"
]);

export const DeclarationSemanticHintSchema = z.object({
  state: DeclarationSemanticHintStateSchema,
  confidence: z.number().min(0).max(1),
  textEvidence: DeclarationTextEvidenceSchema,
  sourceEvidence: z.array(DeclarationSemanticEvidenceSourceSchema).max(6),
  reasonCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(120)).max(8),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type DeclarationSemanticHint = z.infer<typeof DeclarationSemanticHintSchema>;

export const CanonicalCandidateSchema = z.object({
  canonicalKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140),
  description: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  source: z.enum(["EXACT_ALIAS", "ATTRIBUTE", "LEXICAL", "SECTION", "NEIGHBOR", "AI_PROPOSAL"]),
  reasonCodes: z.array(z.string().min(1).max(100)).max(12)
}).strict();
export type CanonicalCandidate = z.infer<typeof CanonicalCandidateSchema>;

export const FieldSemanticResolutionSchema = z.object({
  fieldRuntimeId: z.string().min(8).max(100),
  descriptorFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  state: SemanticResolutionStateSchema,
  canonicalKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140).nullable(),
  confidence: z.number().min(0).max(1),
  resolver: SemanticResolverSchema,
  candidates: z.array(CanonicalCandidateSchema).max(8),
  reasonCodes: z.array(z.string().min(1).max(100)).max(16),
  errorCodes: z.array(SemanticErrorCodeSchema).max(8),
  evidence: z.object({
    alias: z.number().min(0).max(1),
    fieldType: z.number().min(-1).max(1),
    section: z.number().min(0).max(1),
    neighbor: z.number().min(0).max(1),
    attribute: z.number().min(0).max(1),
    candidateMargin: z.number().min(0).max(1)
  }).strict(),
  contextHints: z.object({ countryCode: z.string().regex(/^[A-Z]{2}$/).nullable() }).strict(),
  declarationHint: DeclarationSemanticHintSchema,
  entityBinding: RepeatableEvidenceSchema,
  entityIntelligence: EntityBindingReceiptSchema.nullable().optional(),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict().superRefine((value, context) => {
  if (value.state.startsWith("RESOLVED") && !value.canonicalKey) {
    context.addIssue({ code: "custom", message: "RESOLVED_FIELD_REQUIRES_CANONICAL" });
  }
  if (!value.state.startsWith("RESOLVED") && value.canonicalKey) {
    context.addIssue({ code: "custom", message: "UNSAFE_CANONICAL_ON_UNRESOLVED_FIELD" });
  }
});
export type FieldSemanticResolution = z.infer<typeof FieldSemanticResolutionSchema>;

export const CandidateAnswerReferenceSchema = z.object({
  status: z.enum([
    "AVAILABLE_REUSABLE", "AVAILABLE_REVIEW", "MISSING", "STALE", "CONFLICT",
    "CONTEXT_REQUIRED", "POLICY_BLOCKED", "SEMANTIC_UNRESOLVED", "NOT_APPLICABLE"
  ]),
  answerVersionId: z.uuid().nullable(),
  trustState: z.enum(["REVIEW", "TRUSTED"]).nullable(),
  trialReuse: z.boolean(),
  requiresUserReview: z.boolean(),
  autofillMode: z.enum(["AUTO", "REVIEW", "APPLICATION_GESTURE", "FORBIDDEN"]).nullable(),
  expiresAt: z.iso.datetime().nullable(),
  reasonCodes: z.array(z.string().min(1).max(120)).max(16),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type CandidateAnswerReference = z.infer<typeof CandidateAnswerReferenceSchema>;

export const ResolvedFieldSchema = z.object({
  semantic: FieldSemanticResolutionSchema,
  answer: CandidateAnswerReferenceSchema
}).strict();
export type ResolvedField = z.infer<typeof ResolvedFieldSchema>;

export const ResolveFieldIntelligenceResponseSchema = z.object({
  schemaVersion: z.literal(FIELD_INTELLIGENCE_VERSION),
  requestId: z.uuid(),
  items: z.array(ResolvedFieldSchema).max(500),
  summary: z.object({
    resolvedHigh: z.number().int().nonnegative(),
    resolvedMedium: z.number().int().nonnegative(),
    ambiguous: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    answerAvailable: z.number().int().nonnegative(),
    aiRequests: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative().max(300_000)
  }).strict(),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type ResolveFieldIntelligenceResponse = z.infer<typeof ResolveFieldIntelligenceResponseSchema>;

export const CompactCanonicalizationPayloadSchema = z.object({
  field: z.object({ label: z.string().max(180), type: SemanticControlTypeSchema }).strict(),
  context: z.object({
    section: z.string().max(180).nullable(),
    previousLabel: z.string().max(180).nullable(),
    nextLabel: z.string().max(180).nullable()
  }).strict(),
  candidateCanonicals: z.array(z.object({
    canonicalKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140),
    description: z.string().min(1).max(500)
  }).strict()).min(1).max(8),
  containsCandidateValue: z.literal(false)
}).strict();
export type CompactCanonicalizationPayload = z.infer<typeof CompactCanonicalizationPayloadSchema>;

export const RichCanonicalizationPayloadSchema = CompactCanonicalizationPayloadSchema.extend({
  richerContext: z.object({
    ariaLabel: z.string().max(180).nullable(),
    placeholder: z.string().max(180).nullable(),
    name: z.string().max(160).nullable(),
    role: z.string().max(80).nullable(),
    optionSamples: z.array(z.string().max(120)).max(12),
    nearbyDescription: z.string().max(300).nullable(),
    pageHeading: z.string().max(180).nullable(),
    ats: z.string().max(80)
  }).strict()
}).strict();
export type RichCanonicalizationPayload = z.infer<typeof RichCanonicalizationPayloadSchema>;

export const AiCanonicalizationOutputSchema = z.object({
  selectedCanonical: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140).nullable(),
  confidence: z.number().min(0).max(1),
  ambiguous: z.boolean(),
  ranking: z.array(z.object({
    canonicalKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140),
    confidence: z.number().min(0).max(1)
  }).strict()).max(8),
  reasonCategory: z.enum(["LABEL_CONTEXT", "SECTION_CONTEXT", "NEIGHBOR_CONTEXT", "OPTION_SHAPE", "INSUFFICIENT_EVIDENCE"])
}).strict();
export type AiCanonicalizationOutput = z.infer<typeof AiCanonicalizationOutputSchema>;

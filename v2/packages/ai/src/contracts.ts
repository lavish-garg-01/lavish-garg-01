import { z } from "zod";
import { CompactCanonicalizationPayloadSchema, RichCanonicalizationPayloadSchema, CompactEntityBindingAiPayloadSchema, StrategyPlanSchema } from "@job-hunter-v2/contracts";

export const AI_POLICY_VERSION = "P1-2026-09";
export const PrivacySchema = z.enum(["FIELD_METADATA_ONLY", "PUBLIC_JOB_DATA", "CANDIDATE_PRIVATE_DATA", "DOCUMENT_PRIVATE_DATA", "SENSITIVE_APPLICATION_DATA"]);
export type Privacy = z.infer<typeof PrivacySchema>;
export const ProviderSchema = z.enum(["GROQ", "GEMINI", "OPENAI"]);
export type Provider = z.infer<typeof ProviderSchema>;
export const AiScopeSchema = z.object({
  accountId: z.uuid(), candidateId: z.uuid(), applicationId: z.uuid().nullable()
}).strict();
export type AiScope = z.infer<typeof AiScopeSchema>;
const metadata = {
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  idempotencyKey: z.string().min(8).max(160),
  scope: AiScopeSchema,
  privacy: PrivacySchema,
  latencyPriority: z.enum(["INTERACTIVE", "BACKGROUND"]),
  costPriority: z.enum(["ECONOMY", "QUALITY"]),
  maxCostMicros: z.number().int().min(0).max(10_000_000),
  maxOutputTokens: z.number().int().min(1).max(16_384),
  minimumConfidence: z.number().min(0).max(1),
  allowFallback: z.boolean()
};
export const ResumeExtractableCanonicalSchema = z.enum([
  "FULL_NAME", "EMAIL", "PHONE", "CURRENT_LOCATION", "LINKEDIN_URL", "GITHUB_URL", "PORTFOLIO_URL",
  "SKILLS", "EMPLOYMENT_COMPANY", "EMPLOYMENT_TITLE", "EMPLOYMENT_DATE_RANGE", "EMPLOYMENT_LOCATION",
  "EMPLOYMENT_DESCRIPTION", "EMPLOYMENT_SKILLS", "EDUCATION_INSTITUTION", "EDUCATION_DEGREE",
  "EDUCATION_FIELD_OF_STUDY", "EDUCATION_DATE_RANGE", "EDUCATION_GRADE", "EDUCATION_LOCATION",
  "PROJECT_NAME", "PROJECT_DESCRIPTION", "PROJECT_TECHNOLOGIES", "PROJECT_DATE_RANGE", "PROJECT_URL",
  "CERTIFICATION_NAME", "CERTIFICATION_ISSUER", "CERTIFICATION_DATE", "CERTIFICATION_URL", "CERTIFICATION_KIND"
]);
export const ResumeSourceSectionSchema = z.enum([
  "HEADER", "SUMMARY", "SKILLS", "EXPERIENCE", "EDUCATION", "PROJECTS",
  "CERTIFICATIONS", "AWARDS", "OTHER"
]);
const ResumeIsoDateSchema = z.string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
    return date.getUTCFullYear() === year && date.getUTCMonth() === (month ?? 1) - 1 && date.getUTCDate() === day;
  }, "INVALID_CALENDAR_DATE");
export const ResumeAiValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEXT"), value: z.string().trim().min(1).max(8_000) }).strict(),
  z.object({ kind: z.literal("LIST"), values: z.array(z.string().trim().min(1).max(240)).min(1).max(100) }).strict(),
  z.object({ kind: z.literal("DATE"), value: ResumeIsoDateSchema, precision: z.enum(["DAY", "MONTH", "YEAR"]) }).strict(),
  z.object({
    kind: z.literal("DATE_RANGE"),
    start: ResumeIsoDateSchema.refine((value) => value.endsWith("-01"), "RANGE_DATE_REQUIRES_MONTH_OR_YEAR_PRECISION").nullable(),
    end: ResumeIsoDateSchema.refine((value) => value.endsWith("-01"), "RANGE_DATE_REQUIRES_MONTH_OR_YEAR_PRECISION").nullable(),
    precision: z.enum(["MONTH", "YEAR"]), current: z.boolean()
  }).strict()
]);
export const ResumeAiFieldSchema = z.object({
  itemKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/),
  canonicalKey: ResumeExtractableCanonicalSchema,
  entityType: z.enum(["EMPLOYMENT", "EDUCATION", "PROJECT", "CERTIFICATION"]).nullable(),
  entityGroupKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/).nullable(),
  value: ResumeAiValueSchema,
  sourceSection: ResumeSourceSectionSchema,
  // A complete role description can span several wrapped bullets. This limit
  // matches the onboarding evidence ceiling so the model can return one
  // contiguous, reviewable block instead of duplicate partial fields.
  sourceQuote: z.string().trim().min(1).max(4_000)
}).strict().superRefine((field, context) => {
  if ((field.entityType === null) !== (field.entityGroupKey === null)) {
    context.addIssue({ code: "custom", message: "RESUME_ENTITY_SHAPE_INVALID" });
  }
});
export const ResumeAiPayloadSchema = z.object({
  text: z.string().min(1).max(200_000),
  allowedFields: z.array(ResumeExtractableCanonicalSchema).min(1).max(40)
}).strict();
export const FailureAiPayloadSchema = z.object({
  failureCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(100),
  strategyIds: z.array(z.string().regex(/^[A-Z0-9_@.-]+$/).max(100)).min(1).max(20),
  evidence: z.array(z.enum(["READBACK_MISMATCH", "CONTROL_REMOVED", "OPTIONS_CHANGED", "USER_MODIFIED", "TIMEOUT"])).min(1).max(10)
}).strict();
export const GenerationSourceClaimSchema = z.object({
  sourceId: z.string().regex(/^(?:truth:[0-9a-f-]{36}|job:[a-z0-9-]{2,80})$/),
  sourceType: z.enum(["CANDIDATE_TRUTH", "JOB_INTELLIGENCE"]),
  canonicalKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140),
  text: z.string().trim().min(1).max(8_000)
}).strict();
export const DocumentGenerationPayloadSchema = z.object({
  sourceDocumentId: z.uuid(),
  jobId: z.uuid(),
  applicationId: z.uuid().nullable(),
  strength: z.enum(["LIGHT", "FOCUSED"]),
  candidateClaims: z.array(GenerationSourceClaimSchema.extend({ sourceType: z.literal("CANDIDATE_TRUTH") })).min(1).max(200),
  jobClaims: z.array(GenerationSourceClaimSchema.extend({ sourceType: z.literal("JOB_INTELLIGENCE") })).min(2).max(100)
}).strict();
export const GeneratedDocumentOutputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  titleSourceClaimIds: z.array(z.string().min(1).max(120)).min(1).max(10),
  blocks: z.array(z.object({
    kind: z.enum(["HEADING", "PARAGRAPH", "BULLET"]),
    text: z.string().trim().min(1).max(2_000),
    sourceClaimIds: z.array(z.string().min(1).max(120)).min(1).max(20)
  }).strict()).min(1).max(200)
}).strict();
export const AiRequestSchema = z.discriminatedUnion("taskType", [
  z.object({ ...metadata, taskType: z.literal("GENERATE_STRATEGY_CANDIDATE"), payload: z.object({
    allowedPlans: z.array(StrategyPlanSchema).min(1).max(4),
    failureCount: z.number().int().min(5).max(10000), userCount: z.number().int().min(3).max(10000),
    failureClass: z.literal("EXECUTION"), capability: z.enum(["NATIVE_TEXT", "NATIVE_TEXTAREA"])
  }).strict() }).strict(),
  z.object({ ...metadata, taskType: z.literal("CANONICALIZE_FIELD"), payload: z.union([RichCanonicalizationPayloadSchema, CompactCanonicalizationPayloadSchema]) }).strict(),
  z.object({ ...metadata, taskType: z.literal("DISAMBIGUATE_ENTITY"), payload: CompactEntityBindingAiPayloadSchema }).strict(),
  z.object({ ...metadata, taskType: z.literal("EXTRACT_RESUME"), payload: ResumeAiPayloadSchema }).strict(),
  z.object({ ...metadata, taskType: z.literal("TAILOR_RESUME"), payload: DocumentGenerationPayloadSchema }).strict(),
  z.object({ ...metadata, taskType: z.literal("GENERATE_COVER_LETTER"), payload: DocumentGenerationPayloadSchema }).strict(),
  z.object({ ...metadata, taskType: z.literal("ANALYZE_EXECUTION_FAILURE"), payload: FailureAiPayloadSchema }).strict()
]);
export type AiRequest = z.infer<typeof AiRequestSchema>;
export type Task = AiRequest["taskType"];
export type AiFailure = "AI_TASK_UNSUPPORTED" | "AI_ROUTE_UNAVAILABLE" | "AI_BUDGET_EXCEEDED" | "AI_QUOTA_EXHAUSTED"
  | "AI_PROVIDER_UNAVAILABLE" | "AI_RATE_LIMITED" | "AI_TIMEOUT" | "AI_SCHEMA_INVALID"
  | "AI_CONFIDENCE_INSUFFICIENT" | "AI_PRIVACY_POLICY_BLOCKED" | "AI_CONTEXT_TOO_LARGE"
  | "AI_FALLBACK_EXHAUSTED" | "AI_AUTH_CONFIGURATION_ERROR" | "AI_SAFETY_REJECTED" | "AI_IDEMPOTENCY_CONFLICT"
  | "AI_OUTPUT_TRUNCATED" | "AI_PROVIDER_SCHEMA_REJECTED" | "AI_MODEL_UNAVAILABLE";
export class AiError extends Error {
  constructor(readonly code: AiFailure) { super(code); this.name = "AiError"; }
}
export const ResumeAiOutputSchema = z.object({ fields: z.array(ResumeAiFieldSchema).max(100) }).strict();
export const FailureAiOutputSchema = z.object({
  strategyId: z.string().max(100).nullable(),
  diagnosis: z.enum(["CONTROL_CHANGED", "SELECTION_NOT_COMMITTED", "CANDIDATE_OVERRIDE", "INSUFFICIENT_EVIDENCE"]),
  evidence: FailureAiPayloadSchema.shape.evidence
}).strict();
export const StrategyProposalOutputSchema = z.object({
  plan: StrategyPlanSchema, reason: z.enum(["EVENT_SEQUENCE", "SETTER_COMPATIBILITY", "INSUFFICIENT_EVIDENCE"])
}).strict();
export interface Usage { inputTokens: number; outputTokens: number }
export interface Attempt {
  provider: Provider; model: string; latencyMs: number; usage: Usage | null;
  chargedMicros: number; usageEstimated: boolean; failure: AiFailure | null;
}
export interface AiMetadata {
  taskType: Task; requestId: string; policyVersion: string; taskVersion: number;
  schemaVersion: number; confidence: number; cache: "MISS" | "HIT" | "COALESCED";
  attempts: Attempt[]; totalCostMicros: number; fallbackCount: number;
}
export type AiResult<T = unknown> =
  | { ok: true; value: T; metadata: AiMetadata }
  | { ok: false; error: AiFailure; metadata: AiMetadata };
export interface AiPort { execute(request: AiRequest): Promise<AiResult> }

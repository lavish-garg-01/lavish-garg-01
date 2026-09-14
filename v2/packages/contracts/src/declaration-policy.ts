import { z } from "zod";
import {
  DeclarationSemanticHintSchema,
  SemanticControlTypeSchema,
  SemanticResolutionStateSchema
} from "./field-intelligence.js";
import { FormGraphGuardSchema } from "./form-graph.js";

export const DECLARATION_POLICY_CONTRACT_VERSION = 1 as const;
export const DECLARATION_POLICY_VERSION = "O1-2026-09" as const;

export const DECLARATION_CANONICAL_KEYS = [
  "CERTIFY_INFORMATION_ACCURATE",
  "PRIVACY_ACKNOWLEDGEMENT",
  "TERMS_ACKNOWLEDGEMENT",
  "BACKGROUND_CHECK_AUTHORIZATION",
  "DATA_PROCESSING_CONSENT",
  "APPLICANT_CERTIFICATION",
  "EEO_ACKNOWLEDGEMENT",
  "APPLICATION_SPECIFIC_ACKNOWLEDGEMENT"
] as const;
export const DeclarationCanonicalKeySchema = z.enum(DECLARATION_CANONICAL_KEYS);
export type DeclarationCanonicalKey = z.infer<typeof DeclarationCanonicalKeySchema>;

export const DeclarationTypeSchema = z.enum([
  "ACCURACY_CERTIFICATION",
  "PRIVACY_ACKNOWLEDGEMENT",
  "TERMS_ACKNOWLEDGEMENT",
  "BACKGROUND_CHECK_CONSENT",
  "DATA_PROCESSING_CONSENT",
  "APPLICANT_CERTIFICATION",
  "EEO_ACKNOWLEDGEMENT",
  "APPLICATION_SPECIFIC_ACKNOWLEDGEMENT",
  "UNKNOWN_DECLARATION"
]);
export type DeclarationType = z.infer<typeof DeclarationTypeSchema>;

export const DeclarationPolicyOutcomeSchema = z.enum([
  "AUTO_ALLOWED",
  "PREPARE_FOR_REVIEW",
  "REQUIRES_EXPLICIT_USER_ACTION",
  "BLOCKED",
  "UNRESOLVED"
]);
export type DeclarationPolicyOutcome = z.infer<typeof DeclarationPolicyOutcomeSchema>;

export const DeclarationMaterialitySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const DeclarationReuseScopeSchema = z.enum([
  "APPLICATION_SPECIFIC",
  "COMPANY_APPLICATION_SPECIFIC",
  "POTENTIALLY_REUSABLE"
]);
export const DeclarationReusePolicySchema = z.literal("NEVER");

export const DeclarationFailureCodeSchema = z.enum([
  "DECLARATION_UNRESOLVED",
  "DECLARATION_POLICY_BLOCKED",
  "DECLARATION_USER_ACTION_REQUIRED",
  "DECLARATION_TEXT_UNAVAILABLE",
  "DECLARATION_POLICY_AMBIGUOUS",
  "DECLARATION_EXECUTION_FAILED",
  "DECLARATION_VERIFICATION_FAILED",
  "DECLARATION_MODIFIED_BY_USER",
  "DECLARATION_STALE",
  "DECLARATION_CONTEXT_CHANGED",
  "POLICY_AUTHORIZATION_REQUIRED"
]);
export type DeclarationFailureCode = z.infer<typeof DeclarationFailureCodeSchema>;

export const DeclarationSemanticSnapshotSchema = z.object({
  state: SemanticResolutionStateSchema,
  canonicalKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140).nullable(),
  confidence: z.number().min(0).max(1),
  descriptorFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  declarationHint: DeclarationSemanticHintSchema
}).strict();
export type DeclarationSemanticSnapshot = z.infer<typeof DeclarationSemanticSnapshotSchema>;

export const DeclarationContextSchema = z.object({
  schemaVersion: z.literal(DECLARATION_POLICY_CONTRACT_VERSION),
  applicationId: z.uuid().nullable(),
  applicationRunId: z.uuid(),
  pageInstanceId: z.uuid(),
  formInstanceId: z.string().min(8).max(100),
  fieldRuntimeId: z.string().min(8).max(100),
  controlFingerprint: z.string().min(8).max(80),
  graphGuard: FormGraphGuardSchema,
  semantic: DeclarationSemanticSnapshotSchema,
  controlType: SemanticControlTypeSchema,
  required: z.boolean(),
  disabled: z.boolean(),
  visible: z.boolean(),
  enabled: z.boolean(),
  currentStep: z.boolean(),
  ownership: z.enum(["UNKNOWN", "SHARED", "COPILOT_OWNED", "USER_OWNED"]),
  materialTermsInspectable: z.boolean(),
  finalReviewGuaranteed: z.boolean(),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type DeclarationContext = z.infer<typeof DeclarationContextSchema>;

export const DeclarationClassificationSchema = z.object({
  schemaVersion: z.literal(DECLARATION_POLICY_CONTRACT_VERSION),
  fieldRuntimeId: z.string().min(8).max(100),
  descriptorFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  declarationType: DeclarationTypeSchema,
  semanticConfidence: z.number().min(0).max(1),
  sourceEvidence: DeclarationSemanticHintSchema.shape.sourceEvidence,
  textEvidence: DeclarationSemanticHintSchema.shape.textEvidence,
  reuseScope: DeclarationReuseScopeSchema,
  reusePolicy: DeclarationReusePolicySchema,
  materiality: DeclarationMaterialitySchema,
  required: z.boolean(),
  candidateReviewRequired: z.boolean(),
  automaticInteractionAllowed: z.boolean(),
  prepareForReviewAllowed: z.boolean(),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type DeclarationClassification = z.infer<typeof DeclarationClassificationSchema>;

export const DeclarationAuthorizationSchema = z.object({
  schemaVersion: z.literal(DECLARATION_POLICY_CONTRACT_VERSION),
  authorizationId: z.uuid(),
  decisionFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  canonicalKey: DeclarationCanonicalKeySchema,
  declarationType: DeclarationTypeSchema.exclude(["UNKNOWN_DECLARATION"]),
  policyVersion: z.literal(DECLARATION_POLICY_VERSION),
  policyDecision: z.enum(["AUTO_ALLOWED", "PREPARE_FOR_REVIEW"]),
  applicationRunId: z.uuid(),
  pageInstanceId: z.uuid(),
  formInstanceId: z.string().min(8).max(100),
  fieldRuntimeId: z.string().min(8).max(100),
  controlFingerprint: z.string().min(8).max(80),
  descriptorFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  graphGuard: FormGraphGuardSchema,
  authorizedInteraction: z.literal("SET_TRUE"),
  reviewRequirement: z.enum(["FINAL_REVIEW", "NONE"]),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type DeclarationAuthorization = z.infer<typeof DeclarationAuthorizationSchema>;

export const DeclarationPolicyDecisionSchema = z.object({
  schemaVersion: z.literal(DECLARATION_POLICY_CONTRACT_VERSION),
  policyVersion: z.literal(DECLARATION_POLICY_VERSION),
  decisionFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  evaluatedAt: z.iso.datetime(),
  outcome: DeclarationPolicyOutcomeSchema,
  failureCode: DeclarationFailureCodeSchema.nullable(),
  reasonCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(120)).min(1).max(12),
  classification: DeclarationClassificationSchema,
  authorization: DeclarationAuthorizationSchema.nullable(),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict().superRefine((value, context) => {
  const executable = value.outcome === "AUTO_ALLOWED" || value.outcome === "PREPARE_FOR_REVIEW";
  if (executable !== Boolean(value.authorization)) {
    context.addIssue({ code: "custom", message: "DECLARATION_AUTHORIZATION_OUTCOME_MISMATCH" });
  }
  if (value.outcome === "AUTO_ALLOWED" && !value.classification.automaticInteractionAllowed) {
    context.addIssue({ code: "custom", message: "DECLARATION_AUTO_POLICY_MISMATCH" });
  }
  if (value.outcome === "PREPARE_FOR_REVIEW" && !value.classification.prepareForReviewAllowed) {
    context.addIssue({ code: "custom", message: "DECLARATION_PREPARE_POLICY_MISMATCH" });
  }
});
export type DeclarationPolicyDecision = z.infer<typeof DeclarationPolicyDecisionSchema>;

export const DeclarationReviewStatusSchema = z.enum([
  "PREPARED_BY_COPILOT",
  "NEEDS_CANDIDATE_ACTION",
  "REVIEW_BEFORE_SUBMIT",
  "BLOCKED",
  "UNRESOLVED",
  "CANDIDATE_MODIFIED"
]);
export type DeclarationReviewStatus = z.infer<typeof DeclarationReviewStatusSchema>;

export const DeclarationReviewItemSchema = z.object({
  schemaVersion: z.literal(DECLARATION_POLICY_CONTRACT_VERSION),
  decisionFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  policyVersion: z.literal(DECLARATION_POLICY_VERSION),
  declarationType: DeclarationTypeSchema,
  policyDecision: DeclarationPolicyOutcomeSchema,
  status: DeclarationReviewStatusSchema,
  required: z.boolean(),
  reviewRequired: z.boolean(),
  applicationRunId: z.uuid(),
  pageInstanceId: z.uuid(),
  formInstanceId: z.string().min(8).max(100),
  fieldRuntimeId: z.string().min(8).max(100),
  controlFingerprint: z.string().min(8).max(80),
  descriptorFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  graphGuard: FormGraphGuardSchema,
  semanticConfidence: z.number().min(0).max(1),
  failureCode: DeclarationFailureCodeSchema.nullable(),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type DeclarationReviewItem = z.infer<typeof DeclarationReviewItemSchema>;

export const DeclarationEvidenceEventTypeSchema = z.enum([
  "POLICY_DECIDED",
  "AUTO_INTERACTED",
  "PREPARED",
  "CANDIDATE_ACTION_OBSERVED",
  "CANDIDATE_MODIFIED",
  "EXECUTION_FAILED",
  "VERIFICATION_FAILED",
  "REVIEW_PRESENTED",
  "SUBMISSION_VERIFIED"
]);
export const DeclarationActionOriginSchema = z.enum(["POLICY_ENGINE", "COPILOT", "CANDIDATE", "SYSTEM"]);
export const DeclarationFinalReviewStateSchema = z.enum(["NOT_PRESENTED", "PRESENTED", "SUBMISSION_VERIFIED"]);

export const RecordDeclarationEvidenceRequestSchema = z.object({
  schemaVersion: z.literal(DECLARATION_POLICY_CONTRACT_VERSION),
  requestId: z.uuid(),
  evidenceEventId: z.uuid(),
  applicationId: z.uuid(),
  applicationRunId: z.uuid(),
  pageInstanceId: z.uuid(),
  formInstanceId: z.string().min(8).max(100),
  fieldRuntimeId: z.string().min(8).max(100),
  controlFingerprint: z.string().min(8).max(80),
  descriptorFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  graphGuard: FormGraphGuardSchema,
  declarationType: DeclarationTypeSchema,
  semanticConfidence: z.number().min(0).max(1),
  policyVersion: z.literal(DECLARATION_POLICY_VERSION),
  policyDecision: DeclarationPolicyOutcomeSchema,
  decisionFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  eventType: DeclarationEvidenceEventTypeSchema,
  actionOrigin: DeclarationActionOriginSchema,
  operationId: z.uuid().nullable(),
  executionStatus: z.enum(["VERIFIED", "FAILED", "SKIPPED", "ABORTED"]).nullable(),
  verificationStatus: z.enum([
    "VERIFIED", "FAILED", "AMBIGUOUS", "STALE_FIELD", "PAGE_TRANSITIONED",
    "USER_MODIFIED", "UNVERIFIABLE"
  ]).nullable(),
  failureCode: DeclarationFailureCodeSchema.nullable(),
  required: z.boolean(),
  candidateModified: z.boolean(),
  finalReviewState: DeclarationFinalReviewStateSchema,
  checkpointId: z.uuid().nullable(),
  occurredAt: z.iso.datetime(),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (value.eventType === "POLICY_DECIDED" && (
    value.actionOrigin !== "POLICY_ENGINE" || value.operationId || value.executionStatus || value.verificationStatus
    || value.candidateModified || value.finalReviewState !== "NOT_PRESENTED"
  )) issue("DECLARATION_POLICY_EVENT_SHAPE_INVALID");
  if (["AUTO_INTERACTED", "PREPARED"].includes(value.eventType) && (
    value.actionOrigin !== "COPILOT" || !value.operationId || value.executionStatus !== "VERIFIED"
    || value.verificationStatus !== "VERIFIED" || value.failureCode
  )) issue("DECLARATION_EXECUTION_EVENT_SHAPE_INVALID");
  if (value.eventType === "CANDIDATE_ACTION_OBSERVED" && value.actionOrigin !== "CANDIDATE") {
    issue("DECLARATION_CANDIDATE_EVENT_ORIGIN_INVALID");
  }
  if (value.eventType === "CANDIDATE_MODIFIED" && (
    value.actionOrigin !== "CANDIDATE" || !value.candidateModified || value.failureCode !== "DECLARATION_MODIFIED_BY_USER"
  )) issue("DECLARATION_MODIFICATION_EVENT_SHAPE_INVALID");
  if (value.eventType === "REVIEW_PRESENTED" && (
    value.actionOrigin !== "SYSTEM" || value.finalReviewState !== "PRESENTED" || value.checkpointId
  )) issue("DECLARATION_REVIEW_EVENT_SHAPE_INVALID");
  if (value.eventType === "SUBMISSION_VERIFIED" && (
    value.actionOrigin !== "SYSTEM" || value.finalReviewState !== "SUBMISSION_VERIFIED" || !value.checkpointId
  )) issue("DECLARATION_SUBMISSION_EVENT_SHAPE_INVALID");
});
export type RecordDeclarationEvidenceRequest = z.infer<typeof RecordDeclarationEvidenceRequestSchema>;

export const RecordDeclarationEvidenceResponseSchema = z.object({
  schemaVersion: z.literal(DECLARATION_POLICY_CONTRACT_VERSION),
  requestId: z.uuid(),
  evidenceId: z.uuid(),
  idempotentReplay: z.boolean(),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type RecordDeclarationEvidenceResponse = z.infer<typeof RecordDeclarationEvidenceResponseSchema>;

import { z } from "zod";
import { StrategySelectionSchema } from "./strategy-policy.js";
import { ResolveFieldIntelligenceRequestSchema, SemanticControlTypeSchema } from "./field-intelligence.js";
import { FormGraphActionKindSchema, FormGraphFailureCodeSchema, FormGraphFrontierSchema, FormGraphGuardSchema, FormGraphSnapshotSchema } from "./form-graph.js";
import {
  DeclarationAuthorizationSchema,
  DeclarationCanonicalKeySchema,
  DeclarationReviewItemSchema,
  DeclarationTypeSchema
} from "./declaration-policy.js";

export const EXECUTION_CONTRACT_VERSION = 1 as const;
export const REPRESENTATION_POLICY_VERSION = 1 as const;

import { FieldCapabilitySchema } from "./question-contract.js";
export { FieldCapabilitySchema,type FieldCapability } from "./question-contract.js";

export const RepresentationOptionSchema = z.object({
  key: z.string().max(160).nullable(),
  label: z.string().min(1).max(500),
  aliases: z.array(z.string().min(1).max(500)).max(12)
}).strict();
export type RepresentationOption = z.infer<typeof RepresentationOptionSchema>;

const representationBase = {
  representationId: z.string().regex(/^[A-Z0-9_]+@\d+$/).max(120),
  policyVersion: z.literal(REPRESENTATION_POLICY_VERSION),
  sourceKind: z.enum([
    "STRING", "BOOLEAN", "INTEGER", "DECIMAL", "DATE", "DATE_RANGE", "DURATION",
    "MONEY", "PHONE", "URL", "ADDRESS", "ENUM", "MULTI_ENUM", "ENTITY_REF",
    "RICH_TEXT", "DECLINE_TO_ANSWER", "FILE_REF"
  ]),
  containsCandidateValue: z.literal(true)
};

const TextRepresentationSchema = z.object({
  ...representationBase,
  kind: z.literal("TEXT"),
  text: z.string().max(30_000)
}).strict();
const BooleanRepresentationSchema = z.object({
  ...representationBase,
  kind: z.literal("BOOLEAN"),
  checked: z.boolean()
}).strict();
const SingleOptionRepresentationSchema = z.object({
  ...representationBase,
  kind: z.literal("SINGLE_OPTION"),
  option: RepresentationOptionSchema
}).strict();
const MultiOptionRepresentationSchema = z.object({
  ...representationBase,
  kind: z.literal("MULTI_OPTION"),
  options: z.array(RepresentationOptionSchema).max(100)
}).strict();
const DateRepresentationSchema = z.object({
  ...representationBase,
  kind: z.literal("DATE"),
  isoDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  precision: z.enum(["DAY", "MONTH", "YEAR"]),
  rendered: z.string().min(4).max(40)
}).strict();
const FileRepresentationSchema = z.object({
  ...representationBase,
  sourceKind: z.literal("FILE_REF"),
  kind: z.literal("FILE"),
  selectionId: z.uuid(),
  documentId: z.uuid(),
  documentKind: z.enum(["RESUME", "COVER_LETTER"]),
  fileName: z.string().trim().min(1).max(240).refine((value) => !/[\\/\r\n]/.test(value), "UNSAFE_FILE_NAME"),
  mimeType: z.enum(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  byteSize: z.number().int().positive().max(10 * 1024 * 1024),
  contentSha256: z.string().length(64).regex(/^[a-f0-9]+$/),
  bytesBase64: z.string().min(4).max(14_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/)
}).strict();

export const FieldRepresentationSchema = z.discriminatedUnion("kind", [
  TextRepresentationSchema,
  BooleanRepresentationSchema,
  SingleOptionRepresentationSchema,
  MultiOptionRepresentationSchema,
  DateRepresentationSchema,
  FileRepresentationSchema
]);
export type FieldRepresentation = z.infer<typeof FieldRepresentationSchema>;

export const DocumentExecutionAuthoritySchema = z.object({
  selectionId: z.uuid(),
  documentId: z.uuid(),
  documentKind: z.enum(["RESUME", "COVER_LETTER"]),
  contentSha256: z.string().length(64).regex(/^[a-f0-9]+$/)
}).strict();
export type DocumentExecutionAuthority = z.infer<typeof DocumentExecutionAuthoritySchema>;
export const DocumentExecutionReceiptAuthoritySchema = DocumentExecutionAuthoritySchema.extend({
  observedFileCount: z.number().int().nonnegative().max(20).nullable()
}).strict();

export const ExecutionAuthorizationSchema = z.enum(["AUTO", "REVIEW_REQUIRED"]);

export const ExecutionRequestSchema = z.object({
  schemaVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  operationId: z.uuid(),
  applicationRunId: z.uuid(),
  pageInstanceId: z.uuid(),
  formInstanceId: z.string().min(8).max(100),
  fieldRuntimeId: z.string().min(8).max(100),
  graphNodeId: z.string().regex(/^graph:field:[a-f0-9]{8,64}$/).max(100),
  graphGuard: FormGraphGuardSchema,
  controlFingerprint: z.string().min(8).max(80),
  canonicalKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140),
  answerVersionId: z.uuid().nullable(),
  answerScopeFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/).nullable(),
  trialReuse: z.boolean(),
  semanticControlType: SemanticControlTypeSchema,
  capabilityHints: z.array(FieldCapabilitySchema).min(1).max(8),
  representation: FieldRepresentationSchema,
  documentAuthority: DocumentExecutionAuthoritySchema.nullable().default(null),
  authorization: ExecutionAuthorizationSchema,
  declarationAuthorization: DeclarationAuthorizationSchema.nullable().default(null),
  maximumAttempts: z.number().int().min(1).max(3),
  strategySelection: StrategySelectionSchema.optional()
}).strict().superRefine((value, context) => {
  const declarationCanonical = DeclarationCanonicalKeySchema.safeParse(value.canonicalKey).success;
  if (value.representation.kind === "FILE") {
    if (value.declarationAuthorization || value.answerVersionId || value.answerScopeFingerprint || value.trialReuse) {
      context.addIssue({ code: "custom", message: "DOCUMENT_MUST_NOT_REFERENCE_CANDIDATE_TRUTH_OR_DECLARATION" });
    }
    if (!value.documentAuthority
      || value.documentAuthority.selectionId !== value.representation.selectionId
      || value.documentAuthority.documentId !== value.representation.documentId
      || value.documentAuthority.documentKind !== value.representation.documentKind
      || value.documentAuthority.contentSha256 !== value.representation.contentSha256
      || (value.canonicalKey === "RESUME" ? "RESUME" : value.canonicalKey === "COVER_LETTER" ? "COVER_LETTER" : null) !== value.representation.documentKind) {
      context.addIssue({ code: "custom", message: "DOCUMENT_SELECTION_AUTHORITY_REQUIRED" });
    }
    return;
  }
  if (value.documentAuthority) context.addIssue({ code: "custom", message: "DOCUMENT_AUTHORITY_ON_ORDINARY_FIELD" });
  if (declarationCanonical && !value.declarationAuthorization) {
    context.addIssue({ code: "custom", message: "POLICY_AUTHORIZATION_REQUIRED" });
  }
  if (!declarationCanonical && value.declarationAuthorization) {
    context.addIssue({ code: "custom", message: "DECLARATION_AUTHORIZATION_ON_ORDINARY_FIELD" });
  }
  const authorization = value.declarationAuthorization;
  if (!authorization) {
    if (!value.answerVersionId || !value.answerScopeFingerprint) {
      context.addIssue({ code: "custom", message: "CANDIDATE_TRUTH_AUTHORITY_REQUIRED" });
    }
    return;
  }
  if (value.answerVersionId || value.answerScopeFingerprint || value.trialReuse) {
    context.addIssue({ code: "custom", message: "DECLARATION_MUST_NOT_REFERENCE_CANDIDATE_TRUTH" });
  }
  if (
    authorization.canonicalKey !== value.canonicalKey
    || authorization.applicationRunId !== value.applicationRunId
    || authorization.pageInstanceId !== value.pageInstanceId
    || authorization.formInstanceId !== value.formInstanceId
    || authorization.fieldRuntimeId !== value.fieldRuntimeId
    || authorization.controlFingerprint !== value.controlFingerprint
    || authorization.graphGuard.pageInstanceId !== value.graphGuard.pageInstanceId
    || authorization.graphGuard.graphRevision !== value.graphGuard.graphRevision
    || authorization.graphGuard.graphFingerprint !== value.graphGuard.graphFingerprint
  ) {
    context.addIssue({ code: "custom", message: "DECLARATION_AUTHORIZATION_CONTEXT_MISMATCH" });
  }
  if (value.representation.kind !== "BOOLEAN" || !value.representation.checked) {
    context.addIssue({ code: "custom", message: "DECLARATION_AUTHORIZATION_ONLY_PERMITS_SET_TRUE" });
  }
  if (
    (authorization.policyDecision === "PREPARE_FOR_REVIEW" && value.authorization !== "REVIEW_REQUIRED")
    || (authorization.policyDecision === "AUTO_ALLOWED" && value.authorization !== "AUTO")
  ) {
    context.addIssue({ code: "custom", message: "DECLARATION_REVIEW_AUTHORIZATION_MISMATCH" });
  }
});
export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;

export const GraphActionExecutionRequestSchema = z.object({
  schemaVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  operationId: z.uuid(),
  applicationRunId: z.uuid(),
  pageInstanceId: z.uuid(),
  formInstanceId: z.string().min(8).max(100),
  graphNodeId: z.string().regex(/^graph:action:[a-f0-9]{8,64}$/).max(100),
  graphGuard: FormGraphGuardSchema,
  actionKind: FormGraphActionKindSchema,
  authorization: z.enum(["AUTO_SAFE", "USER_GESTURE_REQUIRED"]),
  expectedEffect: z.enum(["REPEAT_GROUP_ADDED", "SECTION_REVEALED", "STEP_TRANSITION", "FORM_SAVED"])
}).strict().superRefine((value, context) => {
  if (value.actionKind === "SUBMIT") context.addIssue({ code: "custom", message: "SUBMIT_IS_NOT_A_GRAPH_ACTION" });
  if (value.authorization === "AUTO_SAFE" && !["ADD_REPEAT", "EXPAND"].includes(value.actionKind)) {
    context.addIssue({ code: "custom", message: "ACTION_REQUIRES_USER_GESTURE" });
  }
});
export type GraphActionExecutionRequest = z.infer<typeof GraphActionExecutionRequestSchema>;

export const GraphActionExecutionReceiptSchema = z.object({
  schemaVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  operationId: z.uuid(),
  applicationRunId: z.uuid(),
  pageInstanceId: z.uuid(),
  graphNodeId: z.string().regex(/^graph:action:[a-f0-9]{8,64}$/).max(100),
  graphGuard: FormGraphGuardSchema,
  actionKind: FormGraphActionKindSchema,
  status: z.enum(["EXECUTED_AWAITING_GRAPH", "VERIFIED_TRANSITION", "FAILED", "ABORTED"]),
  failureCode: FormGraphFailureCodeSchema.nullable(),
  durationMs: z.number().int().nonnegative().max(300_000),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type GraphActionExecutionReceipt = z.infer<typeof GraphActionExecutionReceiptSchema>;

export const ExecutionPlanSkipReasonSchema = z.enum([
  "SEMANTIC_NOT_HIGH_CONFIDENCE", "ANSWER_NOT_AVAILABLE", "ANSWER_REVIEW_EXPIRED",
  "ANSWER_CONFLICT", "ANSWER_CONTEXT_REQUIRED", "POLICY_FORBIDS_EXECUTION",
  "DECLARATION_REQUIRES_GESTURE", "FILE_REQUIRES_DOCUMENT_FLOW",
  "POLICY_AUTHORIZATION_REQUIRED", "DECLARATION_UNRESOLVED", "DECLARATION_POLICY_BLOCKED",
  "DECLARATION_USER_ACTION_REQUIRED", "DECLARATION_TEXT_UNAVAILABLE", "DECLARATION_POLICY_AMBIGUOUS",
  "REPRESENTATION_UNSUPPORTED", "REPRESENTATION_INVALID", "UNSUPPORTED_CONTROL",
  "DOCUMENT_NOT_READY", "GRAPH_NODE_BLOCKED", "GRAPH_NEEDS_USER", "GRAPH_NODE_STALE", "GRAPH_CYCLE_DETECTED", "QUESTION_CONTRACT_INVALID",
  "ALREADY_COMPLETED", "DEPENDENCY_BLOCKED", "USER_OWNED", "HIDDEN_OR_DISABLED", "NOT_APPLICABLE"
]);
export const ExecutionPlanSkippedFieldSchema = z.object({
  diagnosticCode: z.enum(["DATE_REQUIRES_CONFIRMED_ANCHOR", "DATE_PRECISION_INSUFFICIENT", "NOTICE_UNIT_AMBIGUOUS", "CALENDAR_MONTH_NOTICE_AMBIGUOUS", "NOTICE_OPTION_AMBIGUOUS", "DURATION_UNIT_AMBIGUOUS", "DURATION_OPTION_AMBIGUOUS", "CURRENCY_CONVERSION_NOT_AUTHORIZED", "CURRENCY_AMBIGUOUS", "CURRENCY_CONFLICT", "MONEY_PERIOD_AMBIGUOUS", "MONEY_PERIOD_CONFLICT", "MONEY_PERIOD_UNSUPPORTED", "MONEY_SCALE_CONFLICT", "MONEY_SCALE_CURRENCY_CONFLICT", "MONEY_UNIT_UNSUPPORTED", "MONEY_OPTION_REQUIRES_EXACT_MAPPING", "NON_TERMINATING_CONVERSION", "NUMBER_INVALID"]).optional(),
  fieldRuntimeId: z.string().min(8).max(100),
  canonicalKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140).nullable(),
  reason: ExecutionPlanSkipReasonSchema,
  containsCandidateValue: z.literal(false)
}).strict();

export const ExecutionPlanRequestSchema = z.object({
  schemaVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  requestId: z.uuid(),
  pageInstanceId: z.uuid(),
  graph: FormGraphSnapshotSchema,
  intelligence: ResolveFieldIntelligenceRequestSchema.extend({ applicationRunId: z.uuid() }).strict()
}).strict().superRefine((value, context) => {
  if (value.intelligence.fields.some((field) => field.pageInstanceId !== value.pageInstanceId)) {
    context.addIssue({ code: "custom", message: "EXECUTION_PLAN_PAGE_INSTANCE_MISMATCH" });
  }
  if (value.graph.pageInstanceId !== value.pageInstanceId || value.graph.applicationRunId !== value.intelligence.applicationRunId) {
    context.addIssue({ code: "custom", message: "EXECUTION_PLAN_GRAPH_RUNTIME_MISMATCH" });
  }
});
export type ExecutionPlanRequest = z.infer<typeof ExecutionPlanRequestSchema>;

export const ExecutionPlanResponseSchema = z.object({
  schemaVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  requestId: z.uuid(),
  applicationRunId: z.uuid(),
  pageInstanceId: z.uuid(),
  graphGuard: FormGraphGuardSchema,
  frontier: FormGraphFrontierSchema,
  operations: z.array(ExecutionRequestSchema).max(500),
  actions: z.array(GraphActionExecutionRequestSchema).max(20),
  declarations: z.array(DeclarationReviewItemSchema).max(500).default([]),
  skipped: z.array(ExecutionPlanSkippedFieldSchema).max(500),
  summary: z.object({
    planned: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    reviewRequired: z.number().int().nonnegative(),
    plannedActions: z.number().int().nonnegative(),
    declarationPrepared: z.number().int().nonnegative().default(0),
    declarationNeedsAction: z.number().int().nonnegative().default(0),
    declarationBlocked: z.number().int().nonnegative().default(0)
  }).strict(),
  dataClass: z.literal("CANDIDATE_PRIVATE"),
  containsCandidateValue: z.literal(true)
}).strict();
export type ExecutionPlanResponse = z.infer<typeof ExecutionPlanResponseSchema>;

export const ExecutionFailureClassSchema = z.enum([
  "POPUP_ASSOCIATION_UNPROVEN", "CONTROL_VALIDATION_FAILED",
  "FIELD_STALE", "FIELD_DETACHED", "STRATEGY_UNSUPPORTED", "INTERACTION_REJECTED",
  "OPTION_NOT_FOUND", "OPTION_AMBIGUOUS", "REPRESENTATION_INVALID", "VERIFICATION_FAILED",
  "USER_OWNERSHIP", "PAGE_TRANSITIONED", "TIMEOUT", "FRAME_INACCESSIBLE",
  "RUNTIME_INVALIDATED", "DOM_REJECTED", "GRAPH_NODE_STALE", "GRAPH_REVISION_STALE",
  "DEPENDENCY_UNRESOLVED", "GRAPH_NOT_CONVERGED", "GRAPH_CYCLE_DETECTED", "VALIDATION_GATE_BLOCKED",
  "POLICY_AUTHORIZATION_REQUIRED", "DECLARATION_UNRESOLVED", "DECLARATION_POLICY_BLOCKED",
  "DECLARATION_USER_ACTION_REQUIRED", "DECLARATION_TEXT_UNAVAILABLE", "DECLARATION_POLICY_AMBIGUOUS",
  "DECLARATION_EXECUTION_FAILED", "DECLARATION_VERIFICATION_FAILED", "DECLARATION_MODIFIED_BY_USER",
  "DECLARATION_STALE", "DECLARATION_CONTEXT_CHANGED",
  "DOCUMENT_UPLOAD_TO_ATS_FAILED", "DOCUMENT_UPLOAD_VERIFICATION_FAILED",
  "UNKNOWN_EXECUTION_FAILURE"
]);
export type ExecutionFailureClass = z.infer<typeof ExecutionFailureClassSchema>;

export const VerificationStatusSchema = z.enum([
  "VERIFIED", "FAILED", "AMBIGUOUS", "STALE_FIELD", "PAGE_TRANSITIONED",
  "USER_MODIFIED", "UNVERIFIABLE"
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const ExecutionAttemptReceiptSchema = z.object({
  safetyViolation: z.enum(["OUTSIDE_TARGET", "NAVIGATION", "POLICY_VIOLATION"]).nullable().optional(),
  attempt: z.number().int().min(1).max(3),
  strategyId: z.string().min(1).max(120),
  capability: FieldCapabilitySchema,
  executionStatus: z.enum(["EXECUTED", "FAILED", "ABORTED"]),
  verificationStatus: VerificationStatusSchema,
  failureClass: ExecutionFailureClassSchema.nullable(),
  durationMs: z.number().int().nonnegative().max(300_000),
  retryable: z.boolean(),
  structuralChange: z.boolean()
}).strict();
export type ExecutionAttemptReceipt = z.infer<typeof ExecutionAttemptReceiptSchema>;

export const ExecutionReceiptSchema = z.object({
  verificationEvidence: z.enum(["DOM_READBACK", "NONE"]).optional(),
  schemaVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  operationId: z.uuid(),
  applicationRunId: z.uuid(),
  pageInstanceId: z.uuid(),
  fieldRuntimeId: z.string().min(8).max(100),
  graphNodeId: z.string().regex(/^graph:field:[a-f0-9]{8,64}$/).max(100),
  graphGuard: FormGraphGuardSchema,
  canonicalKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140),
  answerVersionId: z.uuid().nullable(),
  answerScopeFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/).nullable(),
  trialReuse: z.boolean(),
  representationId: z.string().regex(/^[A-Z0-9_]+@\d+$/).max(120),
  representationPolicyVersion: z.number().int().positive(),
  status: z.enum(["VERIFIED", "FAILED", "SKIPPED", "ABORTED"]),
  verificationStatus: VerificationStatusSchema,
  failureClass: ExecutionFailureClassSchema.nullable(),
  selectedStrategyId: z.string().min(1).max(120).nullable(),
  attempts: z.array(ExecutionAttemptReceiptSchema).max(3),
  retryable: z.boolean(),
  requiresUserReview: z.boolean(),
  declaration: z.object({
    canonicalKey: DeclarationCanonicalKeySchema,
    declarationType: DeclarationTypeSchema.exclude(["UNKNOWN_DECLARATION"]),
    policyVersion: z.string().regex(/^O[0-9]+-[0-9]{4}-[0-9]{2}$/).max(40),
    policyDecision: z.enum(["AUTO_ALLOWED", "PREPARE_FOR_REVIEW"]),
    decisionFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
    descriptorFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
    reviewRequirement: z.enum(["FINAL_REVIEW", "NONE"])
  }).strict().nullable().default(null),
  document: DocumentExecutionReceiptAuthoritySchema.nullable().default(null),
  structuralChange: z.boolean(),
  durationMs: z.number().int().nonnegative().max(300_000),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict().superRefine((value, context) => {
  const declarationCanonical = DeclarationCanonicalKeySchema.safeParse(value.canonicalKey).success;
  if (value.document) {
    if (value.declaration || value.answerVersionId || value.answerScopeFingerprint || value.trialReuse
      || value.representationId !== "DOCUMENT_FILE@1"
      || value.document.documentKind !== (value.canonicalKey === "RESUME" ? "RESUME" : value.canonicalKey === "COVER_LETTER" ? "COVER_LETTER" : null)) {
      context.addIssue({ code: "custom", message: "DOCUMENT_RECEIPT_AUTHORITY_MISMATCH" });
    }
    return;
  }
  const refusedBeforeExecution = declarationCanonical && !value.declaration && value.status === "ABORTED"
    && value.failureClass === "POLICY_AUTHORIZATION_REQUIRED" && value.attempts.length === 0
    && !value.answerVersionId && !value.answerScopeFingerprint && !value.trialReuse;
  if (declarationCanonical !== Boolean(value.declaration) && !refusedBeforeExecution) {
    context.addIssue({ code: "custom", message: "DECLARATION_RECEIPT_AUTHORITY_MISMATCH" });
  }
  if (value.declaration && (value.answerVersionId || value.answerScopeFingerprint || value.trialReuse)) {
    context.addIssue({ code: "custom", message: "DECLARATION_RECEIPT_MUST_NOT_REFERENCE_CANDIDATE_TRUTH" });
  }
});
export type ExecutionReceipt = z.infer<typeof ExecutionReceiptSchema>;

export const ExecutionBatchReceiptSchema = z.object({
  schemaVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  batchId: z.uuid(),
  planRequestId: z.uuid(),
  applicationRunId: z.uuid(),
  pageInstanceId: z.uuid(),
  status: z.enum(["COMPLETED", "PARTIAL", "ABORTED", "FAILED"]),
  receipts: z.array(ExecutionReceiptSchema).max(500),
  actionReceipts: z.array(GraphActionExecutionReceiptSchema).max(20).default([]),
  skippedCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().max(300_000),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type ExecutionBatchReceipt = z.infer<typeof ExecutionBatchReceiptSchema>;

export const DocumentUploadEvidenceRequestSchema = z.object({
  schemaVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  requestId: z.uuid(),
  applicationId: z.uuid(),
  applicationRunId: z.uuid(),
  operationId: z.uuid(),
  selectionId: z.uuid(),
  documentId: z.uuid(),
  fieldKey: z.string().min(1).max(240),
  outcome: z.enum(["VERIFIED", "FAILED", "SKIPPED"]),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,119}$/),
  observedFileCount: z.number().int().nonnegative().max(20).nullable(),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type DocumentUploadEvidenceRequest = z.infer<typeof DocumentUploadEvidenceRequestSchema>;
export const DocumentUploadEvidenceResponseSchema = z.object({
  evidenceId: z.uuid(),
  replay: z.boolean()
}).strict();

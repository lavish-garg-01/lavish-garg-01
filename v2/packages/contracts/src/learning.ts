import { z } from "zod";
import { StrategyFeedbackSchema } from "./strategy-policy.js";
import { EntityBindingReceiptSchema } from "./repeatable-entities.js";
import {
  ExecutionFailureClassSchema,
  ExecutionReceiptSchema,
  VerificationStatusSchema
} from "./execution.js";
import { RepeatableEvidenceSchema, SemanticControlTypeSchema } from "./field-intelligence.js";

export const LEARNING_CONTRACT_VERSION = 1 as const;

export const LearningObservationOriginSchema = z.enum([
  "COPILOT_EXECUTED",
  "USER_ENTERED",
  "USER_CORRECTED",
  "USER_CONFIRMED",
  "PAGE_CHANGED",
  "UNKNOWN_ORIGIN"
]);
export type LearningObservationOrigin = z.infer<typeof LearningObservationOriginSchema>;

export const LearningObservationTypeSchema = z.enum([
  "MANUAL_ANSWER",
  "COPILOT_CORRECTION",
  "ANSWER_CONFIRMATION"
]);

export const LearningAttributionSchema = z.enum([
  "CANDIDATE_ANSWER_ENTRY",
  "CANDIDATE_ANSWER_CORRECTION",
  "CANDIDATE_ANSWER_CONFIRMATION",
  "SEMANTIC_MAPPING_SUSPECT",
  "REPRESENTATION_SUSPECT",
  "INTERACTION_SUSPECT",
  "AMBIGUOUS",
  "NO_LEARNING"
]);
export type LearningAttribution = z.infer<typeof LearningAttributionSchema>;

const BoundedObservedTextSchema = z.string().max(30_000);
export const ObservedFieldValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEXT"), value: BoundedObservedTextSchema }).strict(),
  z.object({ kind: z.literal("BOOLEAN"), value: z.boolean() }).strict(),
  z.object({
    kind: z.literal("SINGLE_OPTION"),
    key: z.string().max(160).nullable(),
    label: z.string().min(1).max(500)
  }).strict(),
  z.object({
    kind: z.literal("MULTI_OPTION"),
    values: z.array(z.object({
      key: z.string().max(160).nullable(),
      label: z.string().min(1).max(500)
    }).strict()).max(100)
  }).strict(),
  z.object({
    kind: z.literal("DATE"),
    isoDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    precision: z.enum(["DAY", "MONTH", "YEAR"])
  }).strict()
]);
export type ObservedFieldValue = z.infer<typeof ObservedFieldValueSchema>;

export const StartLearningRunRequestSchema = z.object({
  schemaVersion: z.literal(LEARNING_CONTRACT_VERSION),
  requestId: z.uuid(),
  jobId: z.uuid().nullable(),
  targetUrl: z.url().max(2_000),
  extensionVersion: z.string().min(1).max(30),
  protocolVersion: z.number().int().positive().max(100)
}).strict();
export type StartLearningRunRequest = z.infer<typeof StartLearningRunRequestSchema>;

export const StartLearningRunResponseSchema = z.object({
  schemaVersion: z.literal(LEARNING_CONTRACT_VERSION),
  requestId: z.uuid(),
  applicationId: z.uuid(),
  applicationRunId: z.uuid(),
  status: z.literal("ACTIVE"),
  idempotentReplay: z.boolean(),
  containsCandidateValue: z.literal(false)
}).strict();
export type StartLearningRunResponse = z.infer<typeof StartLearningRunResponseSchema>;

export const RecordExecutionEvidenceRequestSchema = z.object({
  schemaVersion: z.literal(LEARNING_CONTRACT_VERSION),
  requestId: z.uuid(),
  applicationId: z.uuid(),
  applicationRunId: z.uuid(),
  receipt: ExecutionReceiptSchema
}).strict().superRefine((value, context) => {
  if (value.receipt.applicationRunId !== value.applicationRunId) {
    context.addIssue({ code: "custom", message: "EXECUTION_EVIDENCE_RUN_MISMATCH" });
  }
});
export type RecordExecutionEvidenceRequest = z.infer<typeof RecordExecutionEvidenceRequestSchema>;

export const RecordExecutionEvidenceResponseSchema = z.object({
  schemaVersion: z.literal(LEARNING_CONTRACT_VERSION),
  requestId: z.uuid(),
  evidenceId: z.uuid(),
  idempotentReplay: z.boolean(),
  containsCandidateValue: z.literal(false)
}).strict();

export const RecordLearningObservationRequestSchema = z.object({
  schemaVersion: z.literal(LEARNING_CONTRACT_VERSION),
  requestId: z.uuid(),
  observationId: z.uuid(),
  applicationId: z.uuid(),
  applicationRunId: z.uuid(),
  pageInstanceId: z.uuid(),
  formInstanceId: z.string().min(8).max(100),
  fieldRuntimeId: z.string().min(8).max(100),
  controlFingerprint: z.string().min(8).max(80),
  controlType: SemanticControlTypeSchema,
  labelEvidence: z.array(z.string().min(1).max(180)).max(6),
  canonicalKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140),
  descriptorFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  semanticState: z.enum(["RESOLVED_HIGH", "RESOLVED_MEDIUM"]),
  semanticConfidence: z.number().min(0).max(1),
  semanticResolver: z.enum(["EXACT_ALIAS", "DETERMINISTIC", "AI_ASSISTED", "CACHE"]),
  entityBinding: RepeatableEvidenceSchema,
  entityIntelligence: EntityBindingReceiptSchema.nullable().optional(),
  answerVersionId: z.uuid().nullable(),
  answerScopeFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/).nullable(),
  priorOperationId: z.uuid().nullable(),
  priorVerificationStatus: VerificationStatusSchema.nullable(),
  priorFailureClass: ExecutionFailureClassSchema.nullable(),
  strategyFeedback: StrategyFeedbackSchema.optional(),
  origin: LearningObservationOriginSchema,
  observationType: LearningObservationTypeSchema,
  value: ObservedFieldValueSchema,
  occurredAt: z.iso.datetime()
}).strict().superRefine((value, context) => {
  if (value.origin === "USER_CORRECTED" && value.observationType !== "COPILOT_CORRECTION") {
    context.addIssue({ code: "custom", message: "CORRECTION_ORIGIN_TYPE_MISMATCH" });
  }
  if (value.observationType === "COPILOT_CORRECTION" && !value.answerVersionId) {
    context.addIssue({ code: "custom", message: "CORRECTION_REQUIRES_ANSWER_VERSION" });
  }
  if (value.observationType === "COPILOT_CORRECTION" && !value.priorOperationId) {
    context.addIssue({ code: "custom", message: "CORRECTION_REQUIRES_OPERATION" });
  }
});
export type RecordLearningObservationRequest = z.infer<typeof RecordLearningObservationRequestSchema>;

export const RecordLearningObservationResponseSchema = z.object({
  schemaVersion: z.literal(LEARNING_CONTRACT_VERSION),
  requestId: z.uuid(),
  observationId: z.uuid(),
  status: z.enum(["RECORDED", "POLICY_BLOCKED", "ATTRIBUTION_BLOCKED", "DUPLICATE"]),
  attribution: LearningAttributionSchema,
  needsVerifiedCheckpoint: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(160),
  idempotentReplay: z.boolean(),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type RecordLearningObservationResponse = z.infer<typeof RecordLearningObservationResponseSchema>;

export const SubmissionSignalSchema = z.object({
  signalType: z.enum(["SUCCESS_URL_AND_MARKER", "ATS_CONFIRMATION", "MANUAL_RECOVERY"]),
  pageInstanceId: z.uuid(),
  successUrlHash: z.string().length(64).regex(/^[a-f0-9]+$/),
  successMarkerHash: z.string().length(64).regex(/^[a-f0-9]+$/),
  trustedSubmitObservedAt: z.iso.datetime(),
  verifiedAt: z.iso.datetime()
}).strict();

export const RecordSubmitAttemptRequestSchema = z.object({
  schemaVersion: z.literal(LEARNING_CONTRACT_VERSION),
  requestId: z.uuid(),
  applicationId: z.uuid(),
  applicationRunId: z.uuid(),
  pageInstanceId: z.uuid(),
  formInstanceId: z.string().min(8).max(100),
  occurredAt: z.iso.datetime()
}).strict();
export type RecordSubmitAttemptRequest = z.infer<typeof RecordSubmitAttemptRequestSchema>;

export const RecordSubmitAttemptResponseSchema = z.object({
  schemaVersion: z.literal(LEARNING_CONTRACT_VERSION),
  requestId: z.uuid(),
  submitAttemptId: z.uuid(),
  idempotentReplay: z.boolean(),
  containsCandidateValue: z.literal(false)
}).strict();

export const VerifyLearningCheckpointRequestSchema = z.object({
  schemaVersion: z.literal(LEARNING_CONTRACT_VERSION),
  requestId: z.uuid(),
  applicationId: z.uuid(),
  applicationRunId: z.uuid(),
  signal: SubmissionSignalSchema
}).strict();
export type VerifyLearningCheckpointRequest = z.infer<typeof VerifyLearningCheckpointRequestSchema>;

export const LearningChangeSummarySchema = z.object({
  changeSetId: z.uuid().nullable(),
  saved: z.number().int().nonnegative(),
  askAgain: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  message: z.enum([
    "UPDATED_FOR_NEXT_TIME",
    "SOME_UPDATES_SAVED",
    "ASK_AGAIN_NEXT_TIME",
    "NO_REUSABLE_UPDATES",
    "COULD_NOT_SAVE_UPDATE"
  ])
}).strict();

export const VerifyLearningCheckpointResponseSchema = z.object({
  schemaVersion: z.literal(LEARNING_CONTRACT_VERSION),
  requestId: z.uuid(),
  checkpointId: z.uuid(),
  checkpointStatus: z.enum(["VERIFIED", "REJECTED"]),
  result: LearningChangeSummarySchema,
  idempotentReplay: z.boolean(),
  containsCandidateValue: z.literal(false)
}).strict();
export type VerifyLearningCheckpointResponse = z.infer<typeof VerifyLearningCheckpointResponseSchema>;

export const LearningUndoResponseSchema = z.object({
  schemaVersion: z.literal(LEARNING_CONTRACT_VERSION),
  changeSetId: z.uuid(),
  restored: z.number().int().nonnegative(),
  forgotten: z.number().int().nonnegative(),
  keptNewer: z.number().int().nonnegative(),
  message: z.enum(["UPDATES_UNDONE", "UPDATES_PARTIALLY_UNDONE", "NOTHING_TO_UNDO"]),
  idempotentReplay: z.boolean(),
  containsCandidateValue: z.literal(false)
}).strict();

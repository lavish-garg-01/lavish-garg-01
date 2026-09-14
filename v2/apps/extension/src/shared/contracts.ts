import { z } from "zod";
import { JourneyEvidenceSchema, JourneySessionSchema } from "./application-journey.js";
import {
  ExecutionBatchReceiptSchema,
  DeclarationReviewItemSchema,
  ExecutionPlanRequestSchema,
  ExecutionPlanResponseSchema,
  ExecutionReceiptSchema,
  FieldEvidenceInputSchema,
  FormGraphDeltaSchema,
  FormGraphSnapshotSchema,
  FormGraphTransitionReceiptSchema,
  type ExecutionBatchReceipt,
  type ExecutionPlanRequest,
  type ExecutionPlanResponse,
  type ExecutionReceipt,
  type ExecutionRequest
} from "@job-hunter-v2/contracts";
import {
  RecordSubmitAttemptRequestSchema,
  LearningInboxCaptureSchema,
  RecordLearningObservationRequestSchema,
  RecordDeclarationEvidenceRequestSchema,
  ResolveFieldIntelligenceResponseSchema,
  VerifyLearningCheckpointRequestSchema
} from "@job-hunter-v2/contracts";
import { ExtensionFailureSchema } from "./errors.js";
import { RuntimeIdentitySchema, RuntimeStateSchema } from "./runtime-contracts.js";
import { TelemetryEventSchema } from "./telemetry.js";

export const EXTENSION_PROTOCOL_VERSION = 1;

export const AutofillProgressSchema = z.object({
  scanIncomplete: z.boolean().optional(),
  pageInstanceId: z.uuid(), phase: z.enum(["DETECTING", "RESOLVING", "FILLING", "REVIEW", "PAUSED", "FAILED"]),
  fields: z.array(z.object({ fieldRuntimeId: z.string().min(1).max(100), canonicalKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(100).nullable(), required: z.boolean(),
    state: z.enum(["PENDING", "FILLING", "COMPLETED", "ATS_AUTOFILLED", "USER_OWNED", "ATTENTION", "SKIPPED"]),
    reason: z.string().regex(/^[A-Z0-9_]+$/).max(100).nullable()
  }).strict()).max(500), containsCandidateValue: z.literal(false)
}).strict();
export type AutofillProgress = z.infer<typeof AutofillProgressSchema>;

export const FieldOwnershipSchema = z.enum(["UNKNOWN", "SHARED", "COPILOT_OWNED", "USER_OWNED"]);
export type FieldOwnership = z.infer<typeof FieldOwnershipSchema>;

export const FieldCandidateSchema = FieldEvidenceInputSchema.extend({
  schemaVersion: z.literal(2),
  ownership: FieldOwnershipSchema
}).strict();
export type FieldCandidate = z.infer<typeof FieldCandidateSchema>;

export const ScanResultSchema = z.object({
  schemaVersion: z.literal(2),
  reason: z.enum(["INITIAL", "MANUAL", "SPA_NAVIGATION", "STRUCTURAL_MUTATION", "RECOVERY"]),
  pageInstanceId: z.uuid(),
  formInstanceIds: z.array(z.string().min(8).max(100)).max(100),
  pageContext: z.object({
    host: z.string().min(1).max(255),
    ats: z.string().min(1).max(80),
    pageHeading: z.string().max(180).nullable()
  }).strict(),
  fields: z.array(FieldCandidateSchema).max(500),
  graph: FormGraphSnapshotSchema,
  graphDelta: FormGraphDeltaSchema,
  stepTransition: FormGraphTransitionReceiptSchema.nullable().default(null),
  inaccessibleFrameCount: z.number().int().nonnegative().max(100),
  scanLimits: z.object({ controlLimitReached: z.boolean(), fieldLimitReached: z.boolean(), formLimitReached: z.boolean() }).strict().optional(),
  durationMs: z.number().int().nonnegative().max(300_000)
}).strict();
export type ScanResult = z.infer<typeof ScanResultSchema>;

export { ExecutionBatchReceiptSchema, ExecutionPlanRequestSchema, ExecutionPlanResponseSchema, ExecutionReceiptSchema };
export type { ExecutionBatchReceipt, ExecutionPlanRequest, ExecutionPlanResponse, ExecutionReceipt, ExecutionRequest };

export const AuthRuntimeStateSchema = z.enum([
  "NOT_AUTHENTICATED",
  "AUTHENTICATED_NO_CANDIDATE",
  "READY",
  "SESSION_EXPIRED",
  "BACKEND_UNAVAILABLE",
  "EXTENSION_UPDATE_REQUIRED"
]);
export type AuthRuntimeState = z.infer<typeof AuthRuntimeStateSchema>;

const base = {
  protocolVersion: z.literal(EXTENSION_PROTOCOL_VERSION),
  messageId: z.uuid(),
  correlationId: z.uuid().nullable(),
  sentAt: z.iso.datetime()
};

const ContentHelloSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("CONTENT_HELLO"), dataClass: z.literal("STRUCTURAL"),
  payload: z.object({
    pageInstanceId: z.uuid(), applicationKey: z.string().min(8).max(128).nullable(),
    origin: z.string().url().max(300), pathHash: z.string().length(8), hasForms: z.boolean(),
    frameKind: z.enum(["TOP", "CHILD"]), extensionVersion: z.string().min(1).max(30)
  }).strict()
}).strict();

const PageChangedSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("CONTENT_PAGE_CHANGED"), dataClass: z.literal("STRUCTURAL"),
  payload: ContentHelloSchema.shape.payload.extend({ reason: z.enum(["SPA_NAVIGATION", "APPLICATION_DETECTED", "HARD_RELOAD", "RECOVERY"]) }).strict()
}).strict();

const ScanResultMessageSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("CONTENT_SCAN_RESULT"), dataClass: z.literal("STRUCTURAL"),
  payload: ScanResultSchema
}).strict();

const TelemetryMessageSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("CONTENT_TELEMETRY_BATCH"), dataClass: z.literal("VALUE_FREE_TELEMETRY"),
  payload: z.object({ events: z.array(TelemetryEventSchema).min(1).max(25) }).strict()
}).strict();

const RuntimeErrorMessageSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("CONTENT_RUNTIME_ERROR"), dataClass: z.literal("STRUCTURAL"),
  payload: z.object({ failure: ExtensionFailureSchema }).strict()
}).strict();

const SessionOfferSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("WEB_SESSION_OFFER"), dataClass: z.literal("CANDIDATE_PRIVATE"),
  payload: z.object({ accessToken: z.string().min(16).max(8_192), websiteOrigin: z.string().url().max(300) }).strict()
}).strict();

const WebStatusRequestSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("WEB_STATUS_REQUEST"), dataClass: z.literal("STRUCTURAL"),
  payload: z.object({ websiteOrigin: z.string().url().max(300) }).strict()
}).strict();

const WebLaunchRequestSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("WEB_LAUNCH_REQUEST"), dataClass: z.literal("STRUCTURAL"),
  payload: z.object({ jobId: z.uuid(), applicationUrl: z.string().url().max(2_000), websiteOrigin: z.string().url().max(300) }).strict()
}).strict();

const UiStatusRequestSchema = z.object({ ...base,
  source: z.literal("SIDEPANEL"), type: z.literal("UI_STATUS_REQUEST"), dataClass: z.literal("STRUCTURAL"),
  payload: z.object({}).strict()
}).strict();

const UiSiteAccessSchema = z.object({ ...base,
  source: z.literal("SIDEPANEL"), type: z.literal("UI_SITE_ACCESS_GRANTED"), dataClass: z.literal("STRUCTURAL"),
  payload: z.object({ originPattern: z.string().regex(/^https?:\/\/[^/]+\/\*$/).max(500) }).strict()
}).strict();

const UiScanRequestSchema = z.object({ ...base,
  source: z.literal("SIDEPANEL"), type: z.literal("UI_SCAN_ACTIVE_TAB"), dataClass: z.literal("STRUCTURAL"),
  payload: z.object({}).strict()
}).strict();

const ContentExecutionPlanRequestSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("CONTENT_EXECUTION_PLAN_REQUEST"), dataClass: z.literal("STRUCTURAL"),
  payload: ExecutionPlanRequestSchema
}).strict();

const ContentExecutionResultSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("CONTENT_EXECUTION_RESULT"), dataClass: z.literal("VALUE_FREE_TELEMETRY"),
  payload: ExecutionBatchReceiptSchema
}).strict();

const ContentDeclarationEvidenceSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("CONTENT_DECLARATION_EVIDENCE"), dataClass: z.literal("VALUE_FREE_TELEMETRY"),
  payload: RecordDeclarationEvidenceRequestSchema
}).strict();

const ContentLearningObservationSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("CONTENT_LEARNING_OBSERVATION"), dataClass: z.literal("CANDIDATE_PRIVATE"),
  payload: RecordLearningObservationRequestSchema
}).strict();

const ContentInboxCaptureSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("CONTENT_INBOX_CAPTURE"), dataClass: z.literal("CANDIDATE_PRIVATE"),
  payload: z.object({ pageInstanceId: z.uuid(), capture: LearningInboxCaptureSchema, allowSessionRetry: z.literal(true).optional() }).strict()
}).strict();

const ContentSubmitAttemptSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("CONTENT_SUBMIT_ATTEMPT"), dataClass: z.literal("STRUCTURAL"),
  payload: RecordSubmitAttemptRequestSchema
}).strict();

const ContentSubmissionSignalSchema = z.object({ ...base,
  source: z.literal("CONTENT"), type: z.literal("CONTENT_SUBMISSION_SIGNAL"), dataClass: z.literal("STRUCTURAL"),
  payload: VerifyLearningCheckpointRequestSchema
}).strict();

const UiExecuteRequestSchema = z.object({ ...base,
  source: z.literal("SIDEPANEL"), type: z.literal("UI_EXECUTE_ACTIVE_TAB"), dataClass: z.literal("STRUCTURAL"),
  payload: z.object({}).strict()
}).strict();

const UiUndoLearningSchema = z.object({ ...base,
  source: z.literal("SIDEPANEL"), type: z.literal("UI_UNDO_LEARNING"), dataClass: z.literal("STRUCTURAL"),
  payload: z.object({ changeSetId: z.uuid() }).strict()
}).strict();

const UiDeclarationReviewPresentedSchema = z.object({ ...base,
  source: z.literal("SIDEPANEL"), type: z.literal("UI_DECLARATION_REVIEW_PRESENTED"), dataClass: z.literal("VALUE_FREE_TELEMETRY"),
  payload: z.object({ decisionFingerprints: z.array(z.string().length(64).regex(/^[a-f0-9]+$/)).min(1).max(500) }).strict()
}).strict();

const CandidatePanelRequestSchema = z.object({ ...base, source: z.literal("SIDEPANEL"), type: z.literal("UI_CANDIDATE_PANEL_REQUEST"), dataClass: z.literal("STRUCTURAL"), payload: z.object({ panel: z.enum(["profile", "documents"]) }).strict() }).strict();
export const CandidatePanelSchema = z.object({ panel: z.enum(["profile", "documents"]), items: z.array(z.object({ label: z.string().max(240), value: z.string().max(2048), state: z.string().max(80) }).strict()).max(100), containsCandidateValue: z.literal(true) }).strict();
export const ExtensionRequestSchema = z.discriminatedUnion("type", [
  z.object({ ...base, source: z.literal("SIDEPANEL"), type: z.literal("UI_DELIVERY_DISCARD"), dataClass: z.literal("STRUCTURAL"), payload: z.object({}).strict() }).strict(),
  z.object({ ...base, source: z.literal("SIDEPANEL"), type: z.literal("UI_DELIVERY_STATUS"), dataClass: z.literal("STRUCTURAL"), payload: z.object({}).strict() }).strict(),
  z.object({ ...base, source: z.literal("CONTENT"), type: z.literal("CONTENT_JOURNEY"), dataClass: z.literal("STRUCTURAL"), payload: z.object({ pageInstanceId: z.uuid(), evidence: JourneyEvidenceSchema, action: z.enum(["OBSERVE", "INSPECT", "APPLY"]), targetOrigin: z.string().url().nullable() }).strict() }).strict(),
  z.object({ ...base, source: z.literal("CONTENT"), type: z.literal("CONTENT_OPEN_PANEL"), dataClass: z.literal("STRUCTURAL"), payload: z.object({ pageInstanceId: z.uuid() }).strict() }).strict(),
  z.object({ ...base, source: z.literal("CONTENT"), type: z.literal("CONTENT_AUTOFILL_PROGRESS"), dataClass: z.literal("STRUCTURAL"), payload: AutofillProgressSchema }).strict(),
  z.object({ ...base, source: z.literal("SIDEPANEL"), type: z.literal("UI_AUTOFILL_CONTROL"), dataClass: z.literal("STRUCTURAL"), payload: z.object({ action: z.enum(["PAUSE", "RESUME"]), pageInstanceId: z.uuid() }).strict() }).strict(),
  z.object({ ...base, source: z.literal("SIDEPANEL"), type: z.literal("UI_FOCUS_FIELD"), dataClass: z.literal("STRUCTURAL"), payload: z.object({ fieldRuntimeId: z.string().max(100), pageInstanceId: z.uuid() }).strict() }).strict(),
  CandidatePanelRequestSchema,
  ContentHelloSchema, PageChangedSchema, ScanResultMessageSchema, TelemetryMessageSchema, RuntimeErrorMessageSchema,
  SessionOfferSchema, WebStatusRequestSchema, WebLaunchRequestSchema, UiStatusRequestSchema, UiSiteAccessSchema, UiScanRequestSchema,
  ContentExecutionPlanRequestSchema, ContentExecutionResultSchema, ContentLearningObservationSchema, ContentInboxCaptureSchema,
  ContentDeclarationEvidenceSchema, ContentSubmitAttemptSchema, ContentSubmissionSignalSchema,
  UiExecuteRequestSchema, UiUndoLearningSchema, UiDeclarationReviewPresentedSchema
]);
export type ExtensionRequest = z.infer<typeof ExtensionRequestSchema>;

export const RuntimeStatusSchema = z.object({
  journey: JourneySessionSchema.nullable().optional(),
  autofill: AutofillProgressSchema.nullable().optional(),
  planSkips: ExecutionPlanResponseSchema.shape.skipped.optional(),
  extensionVersion: z.string().min(1).max(30),
  protocolVersion: z.literal(EXTENSION_PROTOCOL_VERSION),
  authState: AuthRuntimeStateSchema,
  runtimeState: RuntimeStateSchema.nullable(),
  identity: RuntimeIdentitySchema.nullable(),
  lastScan: z.object({ fieldCount: z.number().int().nonnegative(), formCount: z.number().int().nonnegative(), at: z.iso.datetime() }).strict().nullable(),
  lastGraph: z.object({
    graphRevision: z.number().int().positive(), graphFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
    nodeCount: z.number().int().nonnegative(), edgeCount: z.number().int().nonnegative(),
    stable: z.boolean(), at: z.iso.datetime()
  }).strict().nullable(),
  lastStep: z.object({
    logicalFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
    visitCount: z.number().int().positive(),
    review: z.boolean(),
    transitionExpected: z.boolean().nullable(),
    transitionFailure: z.string().max(80).nullable(),
    at: z.iso.datetime()
  }).strict().nullable(),
  lastIntelligence: z.object({
    resolvedHigh: z.number().int().nonnegative(),
    resolvedMedium: z.number().int().nonnegative(),
    ambiguous: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    answerAvailable: z.number().int().nonnegative(),
    declarationCount: z.number().int().nonnegative(),
    at: z.iso.datetime()
  }).strict().nullable(),
  lastExecution: z.object({
    verified: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(), at: z.iso.datetime()
  }).strict().nullable(),
  lastFailure: z.object({
    failure: ExtensionFailureSchema,
    at: z.iso.datetime()
  }).strict().nullable(),
  declarations: z.array(DeclarationReviewItemSchema).max(500),
  pendingSubmitAt: z.iso.datetime().nullable(),
  lastLearning: z.object({
    changeSetId: z.uuid().nullable(), saved: z.number().int().nonnegative(),
    askAgain: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(), message: z.enum([
      "UPDATED_FOR_NEXT_TIME", "SOME_UPDATES_SAVED", "ASK_AGAIN_NEXT_TIME",
      "NO_REUSABLE_UPDATES", "COULD_NOT_SAVE_UPDATE", "UPDATES_UNDONE",
      "UPDATES_PARTIALLY_UNDONE", "NOTHING_TO_UNDO"
    ]), at: z.iso.datetime()
  }).strict().nullable(),
  activeOrigin: z.string().url().max(300).nullable(),
  siteAccess: z.enum(["NOT_APPLICABLE", "REQUIRED", "GRANTED"]),
  recoverable: z.boolean()
}).strict();
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

const responseBase = {
  protocolVersion: z.literal(EXTENSION_PROTOCOL_VERSION), messageId: z.uuid(), correlationId: z.uuid().nullable(), sentAt: z.iso.datetime(), source: z.literal("BACKGROUND")
};
export const ExtensionResponseSchema = z.discriminatedUnion("type", [
  z.object({ ...responseBase, type: z.literal("DELIVERY_STATUS"), ok: z.literal(true), payload: z.object({ connected: z.boolean(), queuedNotes: z.number().int().nonnegative(), queuedDiagnostics: z.number().int().nonnegative(), delivered: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), dropped: z.number().int().nonnegative() }).strict() }).strict(),
  z.object({ ...responseBase, type: z.literal("CANDIDATE_PANEL_RESPONSE"), ok: z.literal(true), payload: CandidatePanelSchema }).strict(),
  z.object({ ...responseBase, type: z.literal("ACK"), ok: z.literal(true), payload: z.object({ accepted: z.boolean(), delivery: z.enum(["QUEUED", "DELIVERED"]).optional() }).strict() }).strict(),
  z.object({ ...responseBase, type: z.literal("CONTENT_REGISTERED"), ok: z.literal(true), payload: z.object({ status: RuntimeStatusSchema }).strict() }).strict(),
  z.object({ ...responseBase, type: z.literal("STATUS_RESPONSE"), ok: z.literal(true), payload: z.object({ status: RuntimeStatusSchema }).strict() }).strict(),
  z.object({ ...responseBase, type: z.literal("LAUNCH_RESPONSE"), ok: z.literal(true), payload: z.object({ state: z.enum(["READY_TO_LAUNCH", "PERMISSION_REQUIRED"]), originPattern: z.string().max(500), tabId: z.number().int().nonnegative().nullable() }).strict() }).strict(),
  z.object({ ...responseBase, type: z.literal("EXECUTION_PLAN_RESPONSE"), ok: z.literal(true), payload: ExecutionPlanResponseSchema }).strict(),
  z.object({ ...responseBase, type: z.literal("ERROR_RESPONSE"), ok: z.literal(false), payload: z.object({ failure: ExtensionFailureSchema }).strict() }).strict()
]);
export type ExtensionResponse = z.infer<typeof ExtensionResponseSchema>;

export const ContentCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...base, source: z.literal("BACKGROUND"), type: z.literal("BACKGROUND_AUTOFILL_CONTROL"), dataClass: z.literal("STRUCTURAL"), payload: z.object({ action: z.enum(["PAUSE", "RESUME"]), pageInstanceId: z.uuid() }).strict() }).strict(),
  z.object({ ...base, source: z.literal("BACKGROUND"), type: z.literal("BACKGROUND_FOCUS_FIELD"), dataClass: z.literal("STRUCTURAL"), payload: z.object({ fieldRuntimeId: z.string().max(100), pageInstanceId: z.uuid() }).strict() }).strict(),
  z.object({ ...base, source: z.literal("BACKGROUND"), type: z.literal("BACKGROUND_SCAN_REQUEST"), dataClass: z.literal("STRUCTURAL"), payload: z.object({ reason: z.enum(["MANUAL", "RECOVERY"]) }).strict() }).strict(),
  z.object({ ...base, source: z.literal("BACKGROUND"), type: z.literal("BACKGROUND_STATUS_UPDATE"), dataClass: z.literal("STRUCTURAL"), payload: z.object({ status: RuntimeStatusSchema }).strict() }).strict(),
  z.object({ ...base, source: z.literal("BACKGROUND"), type: z.literal("BACKGROUND_EXECUTE_REQUEST"), dataClass: z.literal("STRUCTURAL"), payload: z.object({
    batchId: z.uuid(), applicationRunId: z.uuid(), pageInstanceId: z.uuid()
  }).strict() }).strict(),
  z.object({ ...base, source: z.literal("BACKGROUND"), type: z.literal("BACKGROUND_INTELLIGENCE_UPDATE"), dataClass: z.literal("STRUCTURAL"), payload: ResolveFieldIntelligenceResponseSchema }).strict()
]);
export type ContentCommand = z.infer<typeof ContentCommandSchema>;

export const ContentCommandAckSchema = z.discriminatedUnion("accepted", [
  z.object({ accepted: z.literal(true) }).strict(),
  z.object({ accepted: z.literal(false), failure: ExtensionFailureSchema }).strict()
]);
export type ContentCommandAck = z.infer<typeof ContentCommandAckSchema>;

type RequestType = ExtensionRequest["type"];
export function createRequest<T extends RequestType>(type: T, source: Extract<ExtensionRequest, { type: T }>["source"], payload: Extract<ExtensionRequest, { type: T }>["payload"], options: { correlationId?: string | null; dataClass?: Extract<ExtensionRequest, { type: T }>["dataClass"] } = {}): Extract<ExtensionRequest, { type: T }> {
  return ExtensionRequestSchema.parse({
    protocolVersion: EXTENSION_PROTOCOL_VERSION,
    messageId: crypto.randomUUID(),
    correlationId: options.correlationId ?? null,
    sentAt: new Date().toISOString(),
    source,
    type,
    dataClass: options.dataClass ?? (
      type === "CONTENT_TELEMETRY_BATCH" || type === "CONTENT_EXECUTION_RESULT"
        || type === "CONTENT_DECLARATION_EVIDENCE" || type === "UI_DECLARATION_REVIEW_PRESENTED"
        ? "VALUE_FREE_TELEMETRY"
        : type === "WEB_SESSION_OFFER" || type === "CONTENT_LEARNING_OBSERVATION" || type === "CONTENT_INBOX_CAPTURE" ? "CANDIDATE_PRIVATE" : "STRUCTURAL"
    ),
    payload
  }) as Extract<ExtensionRequest, { type: T }>;
}

export function createResponse<T extends ExtensionResponse["type"]>(type: T, correlationId: string | null, payload: Extract<ExtensionResponse, { type: T }>["payload"]): Extract<ExtensionResponse, { type: T }> {
  return ExtensionResponseSchema.parse({ protocolVersion: EXTENSION_PROTOCOL_VERSION, messageId: crypto.randomUUID(), correlationId, sentAt: new Date().toISOString(), source: "BACKGROUND", type, ok: type !== "ERROR_RESPONSE", payload }) as Extract<ExtensionResponse, { type: T }>;
}

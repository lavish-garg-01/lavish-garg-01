import { z } from "zod";
import { ExtensionRuntimeError, failure } from "../shared/errors.js";
import type { AuthSessionStore } from "./auth-session.js";
import type { ExtensionConfig } from "./config.js";
import { CandidatePanelSchema } from "../shared/contracts.js";
import {
  AutofillOutcomeSchema,
  LearningInboxCaptureSchema,
  type LearningInboxCapture,
  type AutofillOutcome,
  ResolveFieldIntelligenceRequestSchema,
  ResolveFieldIntelligenceResponseSchema,
  ExecutionPlanRequestSchema,
  ExecutionPlanResponseSchema,
  type ExecutionPlanRequest,
  type ExecutionPlanResponse,
  type ResolveFieldIntelligenceRequest,
  type ResolveFieldIntelligenceResponse,
  StartLearningRunRequestSchema,
  StartLearningRunResponseSchema,
  RecordExecutionEvidenceRequestSchema,
  RecordExecutionEvidenceResponseSchema,
  RecordDeclarationEvidenceRequestSchema,
  RecordDeclarationEvidenceResponseSchema,
  RecordLearningObservationRequestSchema,
  RecordLearningObservationResponseSchema,
  RecordSubmitAttemptRequestSchema,
  RecordSubmitAttemptResponseSchema,
  VerifyLearningCheckpointRequestSchema,
  VerifyLearningCheckpointResponseSchema,
  DocumentUploadEvidenceRequestSchema,
  DocumentUploadEvidenceResponseSchema,
  LearningUndoResponseSchema,
  type StartLearningRunRequest,
  type StartLearningRunResponse,
  type RecordExecutionEvidenceRequest,
  type RecordDeclarationEvidenceRequest,
  type RecordLearningObservationRequest,
  type RecordLearningObservationResponse
  ,type RecordSubmitAttemptRequest
  ,type VerifyLearningCheckpointRequest
  ,type DocumentUploadEvidenceRequest
} from "@job-hunter-v2/contracts";

const CandidateSessionSchema = z.object({
  email: z.string().email().nullable(),
  account: z.object({ type: z.enum(["NORMAL", "TEST", "INTERNAL"]), role: z.enum(["OWNER", "ADMIN", "MEMBER"]) }).strict(),
  candidate: z.object({ id: z.uuid(), new: z.boolean() }).strict(),
  onboarding: z.object({
    stage: z.enum(["WELCOME", "RESUME", "REVIEW", "PROFILE", "READY"]),
    completed: z.boolean(),
    version: z.number().int().positive(),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable()
  }).strict()
}).strict();
export type CandidateSession = z.infer<typeof CandidateSessionSchema>;

export class ExtensionApiClient {
  constructor(private readonly config: ExtensionConfig, private readonly auth: AuthSessionStore, private readonly fetchImpl: typeof fetch = fetch, private readonly timeoutMs = 8_000) {}

  async candidatePanel(panel: "profile" | "documents") {
    const token = await this.auth.token();
    if (!token) throw new ExtensionRuntimeError(failure("AUTH_EXPIRED", "Reconnect from Job Hunter to view your profile.", { category: "AUTHORIZATION" }));
    const request = this.fetchImpl;
    const response = await request(`${this.config.apiOrigin}/v1/${panel}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new ExtensionRuntimeError(failure(response.status === 401 || response.status === 403 ? "AUTH_EXPIRED" : "API_UNAVAILABLE", "Could not load this panel. Reconnect or try again.", { retryable: true }));
    const raw: unknown = await response.json();
    const items = panel === "documents" ? z.object({ documents: z.array(z.object({ fileName: z.string().nullable(), status: z.string(), version: z.number() })) }).parse(raw).documents.slice(0,100)
      .map((item) => ({ label: item.fileName ?? "Document", value: `Version ${item.version}`, state: item.status }))
      : z.object({ answers: z.array(z.object({ label: z.string(), entityId: z.string().nullable(), scopeType: z.string(), trustState: z.string(), normalizedValue: z.record(z.string(), z.unknown()) })) }).parse(raw).answers
        .filter((item) => !item.entityId && item.scopeType === "GLOBAL").slice(0,100).map((item) => {
          const value = item.normalizedValue;
          const text = ["STRING","URL","RICH_TEXT","INTEGER"].includes(String(value.kind)) ? String(value.value ?? "")
            : value.kind === "BOOLEAN" ? value.value ? "Yes" : "No"
            : value.kind === "MONEY" ? `${value.currency} ${value.amountExact} / ${String(value.period).toLowerCase()}`
            : value.kind === "PHONE" ? `${value.countryCode} ${value.nationalNumber}` : "View in profile";
          return { label: item.label, value: text.slice(0,2048), state: item.trustState };
        });
    return CandidatePanelSchema.parse({ panel, items, containsCandidateValue: true });
  }

  async session(): Promise<CandidateSession> {
    const accessToken = await this.auth.token();
    if (!accessToken) throw new ExtensionRuntimeError(failure("AUTH_EXPIRED", "Connect the extension from Job Hunter to continue.", { category: "AUTHORIZATION" }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const request = this.fetchImpl;
      const response = await request(`${this.config.apiOrigin}/v1/auth/session`, { headers: { authorization: `Bearer ${accessToken}` }, signal: controller.signal });
      if (response.status === 401 || response.status === 403) throw new ExtensionRuntimeError(failure("AUTH_EXPIRED", "Your Job Hunter session expired. Reconnect from the website.", { category: "AUTHORIZATION" }));
      if (!response.ok) throw new ExtensionRuntimeError(failure("API_UNAVAILABLE", "Job Hunter is temporarily unavailable.", {
        retryable: response.status >= 500,
        metadata: { httpStatus: response.status, apiOrigin: this.config.apiOrigin }
      }));
      const parsed = CandidateSessionSchema.safeParse(await response.json());
      if (!parsed.success) throw new ExtensionRuntimeError(failure("EXTENSION_UPDATE_REQUIRED", "The extension and Job Hunter API are not compatible.", {
        category: "UNSUPPORTED",
        metadata: { issueCount: parsed.error.issues.length, firstIssueCode: parsed.error.issues[0]?.code ?? "unknown" }
      }));
      await this.auth.bind(parsed.data.candidate.id, accessToken);
      return parsed.data;
    } catch (reason) {
      if (reason instanceof ExtensionRuntimeError) throw reason;
      if (controller.signal.aborted) throw new ExtensionRuntimeError(failure("API_TIMEOUT", "Job Hunter took too long to respond.", { retryable: true }));
      throw new ExtensionRuntimeError(failure("API_UNAVAILABLE", "Job Hunter is temporarily unavailable.", {
        retryable: true, metadata: { apiOrigin: this.config.apiOrigin }
      }));
    } finally { clearTimeout(timeout); }
  }

  async resolveFields(input: ResolveFieldIntelligenceRequest): Promise<ResolveFieldIntelligenceResponse> {
    const accessToken = await this.auth.token();
    if (!accessToken) throw new ExtensionRuntimeError(failure("AUTH_EXPIRED", "Connect the extension from Job Hunter to understand this form.", { category: "AUTHORIZATION" }));
    const requestBody = ResolveFieldIntelligenceRequestSchema.parse(input);
    const controller = new AbortController();
    // Semantic work has its own short server budget; leave room for database
    // binding and larger forms instead of sharing the authentication timeout.
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs * 3);
    try {
      // Native worker fetch must not be invoked with ExtensionApiClient as its
      // receiver. Keeping the function unbound also matches the session path.
      const request = this.fetchImpl;
      const response = await request(`${this.config.apiOrigin}/v1/field-intelligence/resolve`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) throw new ExtensionRuntimeError(failure("AUTH_EXPIRED", "Your Job Hunter session expired. Reconnect from the website.", { category: "AUTHORIZATION" }));
      if (!response.ok) throw new ExtensionRuntimeError(failure("API_UNAVAILABLE", "Field Intelligence is temporarily unavailable.", {
        retryable: response.status >= 500,
        metadata: { httpStatus: response.status, apiOrigin: this.config.apiOrigin }
      }));
      const parsed = ResolveFieldIntelligenceResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new ExtensionRuntimeError(failure("EXTENSION_UPDATE_REQUIRED", "The extension and Field Intelligence API are not compatible.", { category: "UNSUPPORTED", metadata: { issueCount: parsed.error.issues.length } }));
      return parsed.data;
    } catch (reason) {
      if (reason instanceof ExtensionRuntimeError) throw reason;
      if (controller.signal.aborted) throw new ExtensionRuntimeError(failure("API_TIMEOUT", "Field Intelligence took too long to respond.", { retryable: true }));
      throw new ExtensionRuntimeError(failure("API_UNAVAILABLE", "Field Intelligence is temporarily unavailable.", {
        retryable: true, metadata: { apiOrigin: this.config.apiOrigin }
      }));
    } finally { clearTimeout(timeout); }
  }

  async planExecution(input: ExecutionPlanRequest): Promise<ExecutionPlanResponse> {
    const accessToken = await this.auth.token();
    if (!accessToken) throw new ExtensionRuntimeError(failure("AUTH_EXPIRED", "Connect the extension from Job Hunter before filling this form.", { category: "AUTHORIZATION" }));
    const requestBody = ExecutionPlanRequestSchema.parse(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs * 4);
    try {
      const request = this.fetchImpl;
      const response = await request(`${this.config.apiOrigin}/v1/execution/plan`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) throw new ExtensionRuntimeError(failure("AUTH_EXPIRED", "Your Job Hunter session expired. Reconnect from the website.", { category: "AUTHORIZATION" }));
      if (!response.ok) throw new ExtensionRuntimeError(failure("API_UNAVAILABLE", "The safe-fill plan is temporarily unavailable.", {
        retryable: response.status >= 500,
        metadata: { httpStatus: response.status, apiOrigin: this.config.apiOrigin }
      }));
      const parsed = ExecutionPlanResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new ExtensionRuntimeError(failure("EXTENSION_UPDATE_REQUIRED", "The extension and execution API are not compatible.", { category: "UNSUPPORTED", metadata: { issueCount: parsed.error.issues.length } }));
      return parsed.data;
    } catch (reason) {
      if (reason instanceof ExtensionRuntimeError) throw reason;
      if (controller.signal.aborted) throw new ExtensionRuntimeError(failure("API_TIMEOUT", "The safe-fill plan took too long.", { retryable: true }));
      throw new ExtensionRuntimeError(failure("API_UNAVAILABLE", "The safe-fill plan is temporarily unavailable.", {
        retryable: true, metadata: { apiOrigin: this.config.apiOrigin }
      }));
    } finally { clearTimeout(timeout); }
  }

  recordDocumentUploadEvidence(input: DocumentUploadEvidenceRequest) {
    const body = DocumentUploadEvidenceRequestSchema.parse(input);
    return this.learningRequest({
      path: "/v1/execution/document-evidence",
      body,
      idempotencyKey: `document-upload:${body.operationId}`,
      parse: (value) => DocumentUploadEvidenceResponseSchema.parse(value)
    });
  }

  private async learningRequest<Output>(input: {
    path: string;
    body: unknown;
    idempotencyKey: string;
    parse: (value: unknown) => Output;
    expectedToken?: string;
  }): Promise<Output> {
    const accessToken = await this.auth.token();
    if (!accessToken || input.expectedToken && accessToken !== input.expectedToken) throw new ExtensionRuntimeError(failure("AUTH_EXPIRED", "Reconnect Job Hunter before learning from this application.", { category: "AUTHORIZATION" }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const request = this.fetchImpl;
      const response = await request(`${this.config.apiOrigin}${input.path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "x-idempotency-key": input.idempotencyKey },
        body: JSON.stringify(input.body),
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) throw new ExtensionRuntimeError(failure("AUTH_EXPIRED", "Your Job Hunter session expired.", { category: "AUTHORIZATION" }));
      if (!response.ok) throw new ExtensionRuntimeError(failure("API_UNAVAILABLE", "The verified learning service is temporarily unavailable.", { retryable: response.status >= 500 || response.status === 429 || response.status === 408 }));
      return input.parse(await response.json());
    } catch (reason) {
      if (reason instanceof ExtensionRuntimeError) throw reason;
      if (controller.signal.aborted) throw new ExtensionRuntimeError(failure("API_TIMEOUT", "Verified learning took too long.", { retryable: true }));
      throw new ExtensionRuntimeError(failure("API_UNAVAILABLE", "The verified learning service is temporarily unavailable.", { retryable: true }));
    } finally { clearTimeout(timeout); }
  }

  startLearningRun(input: StartLearningRunRequest, idempotencyKey: string): Promise<StartLearningRunResponse> {
    const body = StartLearningRunRequestSchema.parse(input);
    return this.learningRequest({ path: "/v1/learning/runs", body, idempotencyKey, parse: (value) => StartLearningRunResponseSchema.parse(value) });
  }

  recordExecutionEvidence(input: RecordExecutionEvidenceRequest) {
    const body = RecordExecutionEvidenceRequestSchema.parse(input);
    return this.learningRequest({ path: "/v1/learning/execution-evidence", body, idempotencyKey: `execution:${body.receipt.operationId}`, parse: (value) => RecordExecutionEvidenceResponseSchema.parse(value) });
  }

  recordOutcome(input: AutofillOutcome, expectedToken?: string) {
    const body = AutofillOutcomeSchema.parse(input);
    return this.learningRequest({ path: "/v1/learning/outcomes", body, ...(expectedToken ? { expectedToken } : {}), idempotencyKey: `outcome:${body.eventId}`, parse: (value) => z.object({ eventId: z.uuid(), idempotentReplay: z.boolean() }).strict().parse(value) });
  }

  captureInbox(input: LearningInboxCapture, expectedToken?: string) {
    const body = LearningInboxCaptureSchema.parse(input);
    return this.learningRequest({ path: "/v1/learning/inbox", body, ...(expectedToken ? { expectedToken } : {}), idempotencyKey: `inbox:${body.itemId}`, parse: (value) => z.object({ itemId: z.uuid(), status: z.enum(["PENDING", "DELETED", "EXPIRED"]), idempotentReplay: z.boolean() }).strict().parse(value) });
  }

  recordDeclarationEvidence(input: RecordDeclarationEvidenceRequest) {
    const body = RecordDeclarationEvidenceRequestSchema.parse(input);
    return this.learningRequest({
      path: "/v1/declarations/evidence",
      body,
      idempotencyKey: `declaration:${body.evidenceEventId}`,
      parse: (value) => RecordDeclarationEvidenceResponseSchema.parse(value)
    });
  }

  recordLearningObservation(input: RecordLearningObservationRequest): Promise<RecordLearningObservationResponse> {
    const body = RecordLearningObservationRequestSchema.parse(input);
    return this.learningRequest({ path: "/v1/learning/observations", body, idempotencyKey: `observation:${body.observationId}`, parse: (value) => RecordLearningObservationResponseSchema.parse(value) });
  }

  recordSubmitAttempt(input: RecordSubmitAttemptRequest) {
    const body = RecordSubmitAttemptRequestSchema.parse(input);
    return this.learningRequest({ path: "/v1/learning/submit-attempts", body, idempotencyKey: `submit:${body.applicationRunId}:${body.occurredAt}`, parse: (value) => RecordSubmitAttemptResponseSchema.parse(value) });
  }

  verifyLearningCheckpoint(input: VerifyLearningCheckpointRequest) {
    const body = VerifyLearningCheckpointRequestSchema.parse(input);
    return this.learningRequest({ path: "/v1/learning/checkpoints/submission", body, idempotencyKey: `checkpoint:${body.applicationRunId}:${body.signal.successUrlHash}:${body.signal.successMarkerHash}`, parse: (value) => VerifyLearningCheckpointResponseSchema.parse(value) });
  }

  undoLearningChangeSet(changeSetId: string) {
    return this.learningRequest({ path: `/v1/learning/change-sets/${changeSetId}/undo`, body: {}, idempotencyKey: `learning-undo:${changeSetId}`, parse: (value) => LearningUndoResponseSchema.parse(value) });
  }
}

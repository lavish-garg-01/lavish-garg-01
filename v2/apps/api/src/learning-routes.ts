import {
  LearningInboxCaptureSchema,
  ConfirmLearningNoteSchema,
  LearningInboxPageSchema,
  AutofillOutcomeSchema,
  UuidSchema,
  LearningUndoResponseSchema,
  RecordSubmitAttemptRequestSchema,
  RecordSubmitAttemptResponseSchema,
  RecordExecutionEvidenceRequestSchema,
  RecordExecutionEvidenceResponseSchema,
  RecordLearningObservationRequestSchema,
  RecordLearningObservationResponseSchema,
  StartLearningRunRequestSchema,
  StartLearningRunResponseSchema,
  VerifyLearningCheckpointRequestSchema,
  VerifyLearningCheckpointResponseSchema
} from "@job-hunter-v2/contracts";
import { ValidationError } from "@job-hunter-v2/domain";
import type { CandidateSessionAuthenticator } from "@job-hunter-v2/onboarding";
import type { VerifiedLearningService } from "@job-hunter-v2/verified-learning";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { StrategyReceiptBridge } from "./strategy-bridges.js";
import type { KyselyLearningRecovery } from "@job-hunter-v2/database";

export interface PhaseLApiServices {
  recovery?: Pick<KyselyLearningRecovery, "capture" | "list" | "listPage" | "preview" | "remove" | "recordOutcome" | "outcomes"> & Partial<Pick<KyselyLearningRecovery, "confirm">>;
  strategies?: Pick<StrategyReceiptBridge, "record">;
  sessions: CandidateSessionAuthenticator;
  learning: Pick<VerifiedLearningService, "startRun" | "recordExecutionEvidence" | "recordObservation" | "recordSubmitAttempt" | "verifyCheckpoint" | "undoLearningChangeSet">;
}

function idempotencyKey(request: FastifyRequest): string {
  const key = request.headers["x-idempotency-key"];
  if (typeof key !== "string" || key.trim().length < 8) throw new ValidationError("An X-Idempotency-Key header is required.");
  return key;
}

export async function registerPhaseLRoutes(app: FastifyInstance, services: PhaseLApiServices): Promise<void> {
  const recovery = services.recovery;
  if (recovery) {
    const owner = async (request: FastifyRequest) => {
      const session = await services.sessions.authenticate(request.headers.authorization);
      return { accountId: session.account.accountId, candidateId: session.candidate.candidateId };
    };
    app.post("/v1/learning/inbox/:itemId/confirm", { bodyLimit: 4096 }, async (request, reply) => {
      const identity = await owner(request);
      const itemId = UuidSchema.safeParse((request.params as { itemId: string }).itemId);
      const parsed = ConfirmLearningNoteSchema.safeParse(request.body);
      if (!itemId.success || !parsed.success) throw new ValidationError("Review a supported field and confirm its matching reuse scope.");
      if (!recovery.confirm) throw new ValidationError("Note confirmation is not available.");
      reply.header("Cache-Control", "no-store");
      return recovery.confirm(identity, itemId.data, parsed.data);
    });
    app.post("/v1/learning/inbox/:itemId/preview", { bodyLimit: 4096 }, async (request, reply) => {
      const identity = await owner(request);
      const itemId = UuidSchema.safeParse((request.params as { itemId: string }).itemId);
      const parsed = ConfirmLearningNoteSchema.safeParse(request.body);
      if (!itemId.success || !parsed.success) throw new ValidationError("Choose a supported field with explicit units and reuse scope.");
      reply.header("Cache-Control", "no-store");
      return recovery.preview(identity, itemId.data, parsed.data);
    });
    app.post("/v1/learning/inbox", { bodyLimit: 48_000 }, async (request, reply) => {
      const identity = await owner(request);
      const parsed = LearningInboxCaptureSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError("Invalid private answer request.");
      reply.header("Cache-Control", "no-store");
      return recovery.capture(identity, parsed.data);
    });
    app.get("/v1/learning/inbox", async (request, reply) => {
      const identity = await owner(request);
      const page = LearningInboxPageSchema.safeParse(request.query);
      if (!page.success) throw new ValidationError("Invalid note page.");
      reply.header("Cache-Control", "no-store");
      return { ...await recovery.listPage(identity, page.data), containsCandidateValue: true };
    });
    app.delete("/v1/learning/inbox/:itemId", async (request, reply) => {
      const identity = await owner(request);
      const parsed = UuidSchema.safeParse((request.params as { itemId: string }).itemId);
      if (!parsed.success) throw new ValidationError("Invalid pending answer identity.");
      reply.header("Cache-Control", "no-store");
      return recovery.remove(identity, parsed.data);
    });
    app.post("/v1/learning/outcomes", { bodyLimit: 4096 }, async (request) => {
      const identity = await owner(request);
      const parsed = AutofillOutcomeSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError("Invalid value-free outcome request.");
      return recovery.recordOutcome(identity, parsed.data);
    });
    app.get("/v1/learning/outcomes", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return recovery.outcomes(await owner(request));
    });
  }
  app.post("/v1/learning/runs", { schema: { tags: ["extension", "learning"], body: { type: "object" } } }, async (request) => {
    const session = await services.sessions.authenticate(request.headers.authorization);
    const parsed = StartLearningRunRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("The learning-run request does not match the API contract.");
    return StartLearningRunResponseSchema.parse(await services.learning.startRun({
      accountId: session.account.accountId,
      candidateId: session.candidate.candidateId,
      request: parsed.data,
      idempotencyKey: idempotencyKey(request)
    }));
  });

  app.post("/v1/learning/execution-evidence", { schema: { tags: ["extension", "learning"], body: { type: "object" } } }, async (request) => {
    const session = await services.sessions.authenticate(request.headers.authorization);
    const parsed = RecordExecutionEvidenceRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("The execution-evidence request does not match the API contract.");
    const result = await services.learning.recordExecutionEvidence({ accountId: session.account.accountId, candidateId: session.candidate.candidateId, request: parsed.data });
    await services.strategies?.record({ accountId: session.account.accountId, candidateId: session.candidate.candidateId }, parsed.data.receipt);
    return RecordExecutionEvidenceResponseSchema.parse({ schemaVersion: 1, requestId: parsed.data.requestId, ...result, containsCandidateValue: false });
  });

  app.post("/v1/learning/observations", { schema: { tags: ["extension", "learning"], body: { type: "object" } } }, async (request) => {
    const session = await services.sessions.authenticate(request.headers.authorization);
    const parsed = RecordLearningObservationRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("The learning-observation request does not match the API contract.");
    return RecordLearningObservationResponseSchema.parse(await services.learning.recordObservation({
      accountId: session.account.accountId,
      candidateId: session.candidate.candidateId,
      request: parsed.data,
      idempotencyKey: idempotencyKey(request)
    }));
  });

  app.post("/v1/learning/submit-attempts", { schema: { tags: ["extension", "learning"], body: { type: "object" } } }, async (request) => {
    const session = await services.sessions.authenticate(request.headers.authorization);
    const parsed = RecordSubmitAttemptRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("The submit-attempt request does not match the API contract.");
    return RecordSubmitAttemptResponseSchema.parse(await services.learning.recordSubmitAttempt({
      accountId: session.account.accountId,
      candidateId: session.candidate.candidateId,
      request: parsed.data,
      idempotencyKey: idempotencyKey(request)
    }));
  });

  app.post("/v1/learning/checkpoints/submission", { schema: { tags: ["extension", "learning"], body: { type: "object" } } }, async (request) => {
    const session = await services.sessions.authenticate(request.headers.authorization);
    const parsed = VerifyLearningCheckpointRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("The submission-checkpoint request does not match the API contract.");
    return VerifyLearningCheckpointResponseSchema.parse(await services.learning.verifyCheckpoint({
      accountId: session.account.accountId,
      candidateId: session.candidate.candidateId,
      request: parsed.data,
      idempotencyKey: idempotencyKey(request)
    }));
  });

  app.post("/v1/learning/change-sets/:changeSetId/undo", { schema: { tags: ["extension", "learning"], body: { type: "object" } } }, async (request) => {
    const session = await services.sessions.authenticate(request.headers.authorization);
    const params = request.params as { changeSetId?: string };
    if (!params.changeSetId) throw new ValidationError("A learning change set is required.");
    return LearningUndoResponseSchema.parse(await services.learning.undoLearningChangeSet({
      accountId: session.account.accountId,
      candidateId: session.candidate.candidateId,
      changeSetId: params.changeSetId,
      idempotencyKey: idempotencyKey(request)
    }));
  });
}

import {
  ExecutionPlanRequestSchema,
  ExecutionPlanResponseSchema,
  DocumentUploadEvidenceRequestSchema,
  DocumentUploadEvidenceResponseSchema
} from "@job-hunter-v2/contracts";
import type { ExecutionPlanningService } from "@job-hunter-v2/execution";
import { ValidationError } from "@job-hunter-v2/domain";
import type { ApplicationDocumentService, CandidateSessionAuthenticator } from "@job-hunter-v2/onboarding";
import type { FastifyInstance } from "fastify";

export interface PhaseKApiServices {
  sessions: CandidateSessionAuthenticator;
  execution: Pick<ExecutionPlanningService, "plan">;
  documents?: Pick<ApplicationDocumentService, "recordUpload">;
}

export async function registerPhaseKRoutes(app: FastifyInstance, services: PhaseKApiServices): Promise<void> {
  app.post(
    "/v1/execution/plan",
    {
      schema: {
        tags: ["extension", "execution"],
        // Keep the raw object intact for the strict Zod contract below. Fastify's
        // default AJV removeAdditional mode would otherwise silently strip a
        // caller-supplied selector/value instead of rejecting it.
        body: { type: "object" }
      }
    },
    async (request) => {
      const session = await services.sessions.authenticate(request.headers.authorization);
      const validation = ExecutionPlanRequestSchema.safeParse(request.body);
      if (!validation.success) {
        throw new ValidationError("The execution-plan request does not match the API contract.");
      }
      return ExecutionPlanResponseSchema.parse(await services.execution.plan({
        accountId: session.account.accountId,
        candidateId: session.candidate.candidateId,
        request: validation.data
      }));
    }
  );
  if (services.documents) {
    app.post(
      "/v1/execution/document-evidence",
      { schema: { tags: ["extension", "execution", "documents"], body: { type: "object" } } },
      async (request) => {
        const session = await services.sessions.authenticate(request.headers.authorization);
        const parsed = DocumentUploadEvidenceRequestSchema.safeParse(request.body);
        if (!parsed.success) throw new ValidationError("The document upload evidence does not match the API contract.");
        const result = await services.documents!.recordUpload({
          accountId: session.account.accountId,
          candidateId: session.candidate.candidateId,
          applicationId: parsed.data.applicationId,
          applicationRunId: parsed.data.applicationRunId,
          selectionId: parsed.data.selectionId,
          documentId: parsed.data.documentId,
          operationId: parsed.data.operationId,
          fieldKey: parsed.data.fieldKey,
          outcome: parsed.data.outcome,
          reasonCode: parsed.data.reasonCode,
          observedFileCount: parsed.data.observedFileCount
        });
        return DocumentUploadEvidenceResponseSchema.parse({ evidenceId: result.evidenceId, replay: result.idempotentReplay });
      }
    );
  }
}

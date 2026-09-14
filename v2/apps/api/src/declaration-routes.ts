import {
  RecordDeclarationEvidenceRequestSchema,
  RecordDeclarationEvidenceResponseSchema
} from "@job-hunter-v2/contracts";
import type { DeclarationPolicyService } from "@job-hunter-v2/declaration-policy";
import { ValidationError } from "@job-hunter-v2/domain";
import type { CandidateSessionAuthenticator } from "@job-hunter-v2/onboarding";
import type { FastifyInstance } from "fastify";

export interface PhaseOApiServices {
  sessions: CandidateSessionAuthenticator;
  declarations: Pick<DeclarationPolicyService, "recordEvidence">;
}

export async function registerPhaseORoutes(app: FastifyInstance, services: PhaseOApiServices): Promise<void> {
  app.post(
    "/v1/declarations/evidence",
    { schema: { tags: ["extension", "declarations"], body: { type: "object" } } },
    async (request) => {
      const session = await services.sessions.authenticate(request.headers.authorization);
      const validation = RecordDeclarationEvidenceRequestSchema.safeParse(request.body);
      if (!validation.success) throw new ValidationError("The declaration-evidence request does not match the API contract.");
      return RecordDeclarationEvidenceResponseSchema.parse(await services.declarations.recordEvidence({
        accountId: session.account.accountId,
        candidateId: session.candidate.candidateId,
        request: validation.data
      }));
    }
  );
}

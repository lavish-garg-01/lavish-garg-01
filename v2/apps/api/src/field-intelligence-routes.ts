import { ResolveFieldIntelligenceRequestSchema, ResolveFieldIntelligenceResponseSchema } from "@job-hunter-v2/contracts";
import type { FieldIntelligenceService } from "@job-hunter-v2/field-intelligence";
import { proposeCanonicalReview } from "@job-hunter-v2/field-intelligence";
import type { KyselyCanonicalReviewRepository } from "@job-hunter-v2/database";
import type { CandidateSessionAuthenticator } from "@job-hunter-v2/onboarding";
import type { FastifyInstance } from "fastify";
import { ValidationError } from "@job-hunter-v2/domain";

export interface PhaseJApiServices {
  sessions: CandidateSessionAuthenticator;
  intelligence: Pick<FieldIntelligenceService, "resolve">;
  canonicalReviews?: KyselyCanonicalReviewRepository;
}

export async function registerPhaseJRoutes(app: FastifyInstance, services: PhaseJApiServices): Promise<void> {
  app.get("/v1/field-intelligence/proposals", async (request) => {
    const session = await services.sessions.authenticate(request.headers.authorization);
    return { proposals: await services.canonicalReviews?.list(session.account.accountId, session.candidate.candidateId) ?? [], activation: "REVIEWED_CODE_RELEASE_ONLY" };
  });
  app.post(
    "/v1/field-intelligence/resolve",
    {
      schema: {
        tags: ["extension", "field-intelligence"],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "requestId", "applicationRunId", "pageContext", "fields"],
          properties: {
            schemaVersion: { const: 1 },
            requestId: { type: "string", format: "uuid" },
            applicationRunId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
            pageContext: { type: "object" },
            fields: { type: "array", maxItems: 500, items: { type: "object" } }
          }
        }
      }
    },
    async (request) => {
      const session = await services.sessions.authenticate(request.headers.authorization);
      const validation = ResolveFieldIntelligenceRequestSchema.safeParse(request.body);
      if (!validation.success) throw new ValidationError("The field-intelligence request does not match the API contract.");
      const parsed = validation.data;
      const result = ResolveFieldIntelligenceResponseSchema.parse(await services.intelligence.resolve({
        accountId: session.account.accountId,
        candidateId: session.candidate.candidateId,
        request: parsed
      }));
      const proposals = result.items.flatMap((item) => { const proposal = proposeCanonicalReview(item.semantic); return proposal ? [proposal] : []; });
      if (proposals.length && services.canonicalReviews) {
        await services.canonicalReviews.record(session.account.accountId, session.candidate.candidateId, proposals)
          .catch(() => request.log.warn({ code: "CANONICAL_REVIEW_QUEUE_UNAVAILABLE" }, "Canonical review queue unavailable"));
      }
      return result;
    }
  );
}

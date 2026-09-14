import type { CandidateEntityType } from "@job-hunter-v2/contracts";
import type { RepeatableEntityIntelligenceService } from "@job-hunter-v2/repeatable-entities";
import type { CandidateSessionAuthenticator } from "@job-hunter-v2/onboarding";
import type { FastifyInstance } from "fastify";
import { ValidationError } from "@job-hunter-v2/domain";

export interface PhaseMApiServices {
  sessions: CandidateSessionAuthenticator;
  entities: Pick<RepeatableEntityIntelligenceService, "listEntities" | "removeEntity" | "restoreEntity" | "reorderEntities">;
}

function idempotencyKey(headers: Record<string, unknown>): string {
  const value = headers["x-idempotency-key"];
  if (typeof value !== "string" || value.length < 8) throw new ValidationError("An idempotency key is required.");
  return value;
}

export async function registerPhaseMRoutes(app: FastifyInstance, services: PhaseMApiServices): Promise<void> {
  app.get("/v1/profile/entities", { schema: { tags: ["profile", "repeatable-entities"] } }, async (request) => {
    const session = await services.sessions.authenticate(request.headers.authorization);
    return { entities: await services.entities.listEntities({ accountId: session.account.accountId, candidateId: session.candidate.candidateId }) };
  });

  for (const action of ["remove", "restore"] as const) {
    app.post<{ Params: { entityId: string }; Body: { expectedEntityVersion: number } }>(
      `/v1/profile/entities/:entityId/${action}`,
      { schema: {
        tags: ["profile", "repeatable-entities"],
        params: { type: "object", additionalProperties: false, required: ["entityId"], properties: { entityId: { type: "string", format: "uuid" } } },
        body: { type: "object", additionalProperties: false, required: ["expectedEntityVersion"], properties: { expectedEntityVersion: { type: "integer", minimum: 1 } } }
      } },
      async (request) => {
        const session = await services.sessions.authenticate(request.headers.authorization);
        const input = {
          accountId: session.account.accountId, candidateId: session.candidate.candidateId,
          candidateEntityId: request.params.entityId, expectedEntityVersion: request.body.expectedEntityVersion,
          idempotencyKey: idempotencyKey(request.headers)
        };
        return action === "remove" ? services.entities.removeEntity(input) : services.entities.restoreEntity(input);
      }
    );
  }

  app.put<{ Body: { entityType: CandidateEntityType; orderedEntityIds: string[]; expectedEntityVersions: Record<string, number> } }>(
    "/v1/profile/entities/order",
    { schema: {
      tags: ["profile", "repeatable-entities"],
      body: { type: "object", additionalProperties: false, required: ["entityType", "orderedEntityIds", "expectedEntityVersions"], properties: {
        entityType: { enum: ["EMPLOYMENT", "EDUCATION", "PROJECT", "CERTIFICATION", "LANGUAGE"] },
        orderedEntityIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", format: "uuid" } },
        expectedEntityVersions: { type: "object", additionalProperties: { type: "integer", minimum: 1 } }
      } }
    } },
    async (request) => {
      const session = await services.sessions.authenticate(request.headers.authorization);
      return services.entities.reorderEntities({
        accountId: session.account.accountId, candidateId: session.candidate.candidateId,
        ...request.body, idempotencyKey: idempotencyKey(request.headers)
      });
    }
  );
}

import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedError } from "@job-hunter-v2/domain";
import { createApi } from "./app.js";
import type { PhaseMApiServices } from "./repeatable-entity-routes.js";

const accountId = "a1000000-0000-4000-8000-000000000001";
const candidateId = "a1000000-0000-4000-8000-000000000002";
const entityA = "a1000000-0000-4000-8000-000000000003";
const entityB = "a1000000-0000-4000-8000-000000000004";

function services(calls: Array<Record<string, unknown>>): PhaseMApiServices {
  return {
    sessions: {
      authenticate: async (header) => {
        if (header !== "Bearer valid") throw new UnauthorizedError("Authentication is required.");
        return {
          identity: { provider: "TEST", providerSubject: "phase-m", email: null, expiresAt: new Date("2026-09-03T00:00:00.000Z") },
          account: { accountId, userId: "a1000000-0000-4000-8000-000000000009", accountType: "TEST", accountStatus: "ACTIVE", userStatus: "ACTIVE", membershipRole: "OWNER" },
          candidate: { accountId, candidateId, stage: "READY", completed: true, isNewCandidate: false, version: 1, startedAt: new Date(), completedAt: new Date() }
        };
      }
    },
    entities: {
      listEntities: async (input) => {
        calls.push(input);
        return [{ candidateEntityId: entityA, entityType: "EMPLOYMENT", entityVersion: 1, status: "ACTIVE", displayOrder: 0 }];
      },
      removeEntity: async (input) => {
        calls.push(input);
        return { candidateEntityId: input.candidateEntityId, status: "REMOVED", entityVersion: input.expectedEntityVersion + 1, idempotentReplay: false };
      },
      restoreEntity: async (input) => {
        calls.push(input);
        return { candidateEntityId: input.candidateEntityId, status: "ACTIVE", entityVersion: input.expectedEntityVersion + 1, idempotentReplay: false };
      },
      reorderEntities: async (input) => {
        calls.push(input);
        return { entityType: input.entityType, orderedEntityIds: input.orderedEntityIds, entityVersions: input.expectedEntityVersions, idempotentReplay: false };
      }
    }
  };
}

test("Phase M profile entity routes derive ownership and require idempotency for mutations", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const app = await createApi({ phaseM: services(calls) });

  assert.equal((await app.inject({ method: "GET", url: "/v1/profile/entities" })).statusCode, 401);
  const listed = await app.inject({ method: "GET", url: "/v1/profile/entities", headers: { authorization: "Bearer valid" } });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().entities[0].candidateEntityId, entityA);
  assert.deepEqual(calls[0], { accountId, candidateId });

  const missingKey = await app.inject({
    method: "POST", url: `/v1/profile/entities/${entityA}/remove`, headers: { authorization: "Bearer valid" },
    payload: { expectedEntityVersion: 1 }
  });
  assert.equal(missingKey.statusCode, 400);

  const removed = await app.inject({
    method: "POST", url: `/v1/profile/entities/${entityA}/remove`,
    headers: { authorization: "Bearer valid", "x-idempotency-key": "entity-remove:test-1" },
    payload: { expectedEntityVersion: 1 }
  });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(calls[1], {
    accountId, candidateId, candidateEntityId: entityA, expectedEntityVersion: 1, idempotencyKey: "entity-remove:test-1"
  });

  const reordered = await app.inject({
    method: "PUT", url: "/v1/profile/entities/order",
    headers: { authorization: "Bearer valid", "x-idempotency-key": "entity-order:test-1" },
    payload: { entityType: "EMPLOYMENT", orderedEntityIds: [entityB, entityA], expectedEntityVersions: { [entityA]: 2, [entityB]: 1 } }
  });
  assert.equal(reordered.statusCode, 200);
  assert.deepEqual(calls[2], {
    accountId, candidateId, entityType: "EMPLOYMENT", orderedEntityIds: [entityB, entityA],
    expectedEntityVersions: { [entityA]: 2, [entityB]: 1 }, idempotencyKey: "entity-order:test-1"
  });
  await app.close();
});

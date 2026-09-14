import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedError } from "@job-hunter-v2/domain";
import { createApi } from "./app.js";
import type { PhaseOApiServices } from "./declaration-routes.js";

const accountId = "10000000-0000-4000-8000-000000000180";
const candidateId = "20000000-0000-4000-8000-000000000180";

function services(captured: string[]): PhaseOApiServices {
  return {
    sessions: {
      authenticate: async (header) => {
        if (header !== "Bearer valid") throw new UnauthorizedError("Authentication is required.");
        return {
          identity: { provider: "TEST", providerSubject: "phase-o", email: null, expiresAt: new Date("2026-09-11T00:00:00.000Z") },
          account: { accountId, userId: crypto.randomUUID(), accountType: "TEST", accountStatus: "ACTIVE", userStatus: "ACTIVE", membershipRole: "OWNER" },
          candidate: { accountId, candidateId, stage: "READY", completed: true, isNewCandidate: false, version: 1, startedAt: new Date(), completedAt: new Date() }
        };
      }
    },
    declarations: {
      recordEvidence: async (input) => {
        captured.push(`${input.accountId}:${input.candidateId}:${input.request.eventType}`);
        return {
          schemaVersion: 1, requestId: input.request.requestId, evidenceId: input.request.evidenceEventId,
          idempotentReplay: false, valuePrivate: true, containsCandidateValue: false
        };
      }
    }
  };
}

function payload() {
  return {
    schemaVersion: 1, requestId: crypto.randomUUID(), evidenceEventId: crypto.randomUUID(),
    applicationId: crypto.randomUUID(), applicationRunId: crypto.randomUUID(), pageInstanceId: crypto.randomUUID(),
    formInstanceId: "form:declaration", fieldRuntimeId: "field:declaration", controlFingerprint: "control:declaration",
    descriptorFingerprint: "a".repeat(64), graphGuard: { pageInstanceId: crypto.randomUUID(), graphRevision: 1, graphFingerprint: "b".repeat(64) },
    declarationType: "PRIVACY_ACKNOWLEDGEMENT", semanticConfidence: 0.99, policyVersion: "O1-2026-09",
    policyDecision: "PREPARE_FOR_REVIEW", decisionFingerprint: "c".repeat(64), eventType: "REVIEW_PRESENTED",
    actionOrigin: "SYSTEM", operationId: null, executionStatus: null, verificationStatus: null, failureCode: null,
    required: true, candidateModified: false, finalReviewState: "PRESENTED", checkpointId: null,
    occurredAt: new Date().toISOString(), valuePrivate: true, containsCandidateValue: false
  };
}

test("Phase O evidence derives tenant ownership from the authenticated session", async () => {
  const captured: string[] = [];
  const app = await createApi({ phaseO: services(captured) });
  const body = payload();
  assert.equal((await app.inject({ method: "POST", url: "/v1/declarations/evidence", payload: body })).statusCode, 401);
  const response = await app.inject({ method: "POST", url: "/v1/declarations/evidence", headers: { authorization: "Bearer valid" }, payload: body });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(captured, [`${accountId}:${candidateId}:REVIEW_PRESENTED`]);
  assert.equal(response.json().containsCandidateValue, false);
  await app.close();
});

test("Phase O endpoint rejects raw or undeclared evidence fields", async () => {
  const captured: string[] = [];
  const app = await createApi({ phaseO: services(captured) });
  const response = await app.inject({
    method: "POST", url: "/v1/declarations/evidence", headers: { authorization: "Bearer valid" },
    payload: { ...payload(), declarationText: "I agree to hidden terms" }
  });
  assert.equal(response.statusCode, 400);
  assert.equal(captured.length, 0);
  await app.close();
});

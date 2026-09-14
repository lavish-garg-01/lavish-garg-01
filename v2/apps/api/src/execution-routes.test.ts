import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedError } from "@job-hunter-v2/domain";
import { createApi } from "./app.js";
import type { PhaseKApiServices } from "./execution-routes.js";

const accountId = "10000000-0000-4000-8000-000000000081";
const candidateId = "20000000-0000-4000-8000-000000000081";

function services(captured: Array<{ accountId: string; candidateId: string }>): PhaseKApiServices {
  return {
    sessions: {
      authenticate: async (header) => {
        if (header !== "Bearer valid") throw new UnauthorizedError("Authentication is required.");
        return {
          identity: { provider: "TEST", providerSubject: "phase-k", email: null, expiresAt: new Date("2026-09-03T00:00:00.000Z") },
          account: { accountId, userId: "10000000-0000-4000-8000-000000000082", accountType: "TEST", accountStatus: "ACTIVE", userStatus: "ACTIVE", membershipRole: "OWNER" },
          candidate: { accountId, candidateId, stage: "READY", completed: true, isNewCandidate: false, version: 1, startedAt: new Date("2026-09-01T00:00:00.000Z"), completedAt: new Date("2026-09-01T01:00:00.000Z") }
        };
      }
    },
    execution: {
      plan: async (input) => {
        captured.push({ accountId: input.accountId, candidateId: input.candidateId });
        return {
          schemaVersion: 1, requestId: input.request.requestId,
          applicationRunId: input.request.intelligence.applicationRunId,
          pageInstanceId: input.request.pageInstanceId,
          graphGuard: { pageInstanceId: input.request.pageInstanceId, graphRevision: input.request.graph.graphRevision, graphFingerprint: input.request.graph.graphFingerprint },
          frontier: {
            guard: { pageInstanceId: input.request.pageInstanceId, graphRevision: input.request.graph.graphRevision, graphFingerprint: input.request.graph.graphFingerprint },
            executableGraphNodeIds: [], needsUserGraphNodeIds: [], blockedGraphNodeIds: [], readyForNavigation: true,
            failures: [], valuePrivate: true, containsCandidateValue: false
          },
          operations: [], actions: [], declarations: [], skipped: [],
          summary: {
            planned: 0, skipped: 0, reviewRequired: 0, plannedActions: 0,
            declarationPrepared: 0, declarationNeedsAction: 0, declarationBlocked: 0
          },
          dataClass: "CANDIDATE_PRIVATE", containsCandidateValue: true
        };
      }
    }
  };
}

test("Phase K plan is authenticated and derives candidate ownership from the session", async () => {
  const captured: Array<{ accountId: string; candidateId: string }> = [];
  const app = await createApi({ phaseK: services(captured) });
  const pageInstanceId = crypto.randomUUID();
  const applicationRunId = crypto.randomUUID();
  const payload = {
    schemaVersion: 1, requestId: crypto.randomUUID(), pageInstanceId,
    graph: {
      schemaVersion: 1, applicationRunId, pageInstanceId, graphRevision: 1,
      graphFingerprint: "a".repeat(64), routeFingerprint: "b".repeat(64), observedAt: new Date().toISOString(),
      stable: true, nodes: [], edges: [], failures: [],
      summary: { nodeCount: 0, edgeCount: 0, reachableFieldCount: 0, blockingFieldCount: 0, stepCount: 0, validationErrorCount: 0 },
      valuePrivate: true, containsCandidateValue: false
    },
    intelligence: {
      schemaVersion: 1, requestId: crypto.randomUUID(), applicationRunId,
      pageContext: { host: "jobs.example.test", ats: "GENERIC", pageHeading: null, jobId: null, applicationId: null, countryCode: null, roleFamily: null, companyId: null },
      fields: []
    }
  };
  assert.equal((await app.inject({ method: "POST", url: "/v1/execution/plan", payload })).statusCode, 401);
  const response = await app.inject({ method: "POST", url: "/v1/execution/plan", headers: { authorization: "Bearer valid" }, payload });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(captured, [{ accountId, candidateId }]);
  assert.equal(response.json().dataClass, "CANDIDATE_PRIVATE");
  await app.close();
});

test("Phase K endpoint rejects caller-supplied execution authority", async () => {
  const captured: Array<{ accountId: string; candidateId: string }> = [];
  const app = await createApi({ phaseK: services(captured) });
  const pageInstanceId = crypto.randomUUID();
  const response = await app.inject({
    method: "POST", url: "/v1/execution/plan", headers: { authorization: "Bearer valid" },
    payload: {
      schemaVersion: 1, requestId: crypto.randomUUID(), pageInstanceId, selector: "#email",
      intelligence: { schemaVersion: 1, requestId: crypto.randomUUID(), applicationRunId: crypto.randomUUID(), pageContext: { host: "jobs.example.test" }, fields: [] }
    }
  });
  assert.equal(response.statusCode, 400);
  assert.equal(captured.length, 0);
  await app.close();
});

test("R8 document upload evidence is strict, value-free and session-owned", async () => {
  const captured: Array<Record<string, unknown>> = [];
  const phaseK = services([]);
  phaseK.documents = {
    recordUpload: async (input) => {
      captured.push(input);
      return { evidenceId: "90000000-0000-4000-8000-000000000081", idempotentReplay: false };
    }
  };
  const app = await createApi({ phaseK });
  const payload = {
    schemaVersion: 1, requestId: crypto.randomUUID(),
    applicationId: crypto.randomUUID(), applicationRunId: crypto.randomUUID(),
    operationId: crypto.randomUUID(), selectionId: crypto.randomUUID(), documentId: crypto.randomUUID(),
    fieldKey: "field:resume-upload", outcome: "VERIFIED", reasonCode: "DOCUMENT_UPLOAD_VERIFIED",
    observedFileCount: 1, valuePrivate: true, containsCandidateValue: false
  };
  assert.equal((await app.inject({ method: "POST", url: "/v1/execution/document-evidence", payload })).statusCode, 401);
  const response = await app.inject({
    method: "POST", url: "/v1/execution/document-evidence",
    headers: { authorization: "Bearer valid" }, payload
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { evidenceId: "90000000-0000-4000-8000-000000000081", replay: false });
  assert.equal(captured[0]?.accountId, accountId);
  assert.equal(captured[0]?.candidateId, candidateId);
  assert.equal(JSON.stringify(captured).includes("bytesBase64"), false);
  const invalid = await app.inject({
    method: "POST", url: "/v1/execution/document-evidence",
    headers: { authorization: "Bearer valid" }, payload: { ...payload, documentContent: "private" }
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(captured.length, 1);
  await app.close();
});

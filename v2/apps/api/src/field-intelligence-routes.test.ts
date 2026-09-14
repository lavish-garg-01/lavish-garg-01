import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedError } from "@job-hunter-v2/domain";
import { createApi } from "./app.js";
import type { PhaseJApiServices } from "./field-intelligence-routes.js";

const accountId = "10000000-0000-4000-8000-000000000071";
const candidateId = "20000000-0000-4000-8000-000000000071";

test("Phase J endpoint derives Candidate Truth ownership from auth and returns value-free results", async () => {
  let captured: { accountId: string; candidateId: string } | null = null;
  const phaseJ: PhaseJApiServices = {
    sessions: {
      authenticate: async (header) => {
        if (header !== "Bearer valid") throw new UnauthorizedError("Authentication is required.");
        return {
          identity: { provider: "TEST", providerSubject: "phase-j", email: null, expiresAt: new Date("2026-09-03T00:00:00.000Z") },
          account: { accountId, userId: "10000000-0000-4000-8000-000000000072", accountType: "TEST", accountStatus: "ACTIVE", userStatus: "ACTIVE", membershipRole: "OWNER" },
          candidate: { accountId, candidateId, stage: "READY", completed: true, isNewCandidate: false, version: 1, startedAt: new Date("2026-09-01T00:00:00.000Z"), completedAt: new Date("2026-09-01T01:00:00.000Z") }
        };
      }
    },
    intelligence: {
      resolve: async (input) => {
        captured = { accountId: input.accountId, candidateId: input.candidateId };
        return {
          schemaVersion: 1, requestId: input.request.requestId, items: [],
          summary: { resolvedHigh: 0, resolvedMedium: 0, ambiguous: 0, unresolved: 0, unsupported: 0, answerAvailable: 0, aiRequests: 0, cacheHits: 0, durationMs: 0 },
          valuePrivate: true, containsCandidateValue: false
        };
      }
    }
  };
  const app = await createApi({ phaseJ });
  const payload = {
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    applicationRunId: null,
    pageContext: { host: "jobs.example.test", ats: "GENERIC", pageHeading: null, jobId: null, applicationId: null, countryCode: null, roleFamily: null, companyId: null },
    fields: []
  };
  const unauthorized = await app.inject({ method: "POST", url: "/v1/field-intelligence/resolve", payload });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(captured, null);
  const response = await app.inject({ method: "POST", url: "/v1/field-intelligence/resolve", headers: { authorization: "Bearer valid" }, payload });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(captured, { accountId, candidateId });
  assert.equal(response.json().containsCandidateValue, false);
  await app.close();
});

test("Phase J endpoint rejects malformed scanner evidence before semantic processing", async () => {
  let called = false;
  const app = await createApi({
    phaseJ: {
      sessions: {
        authenticate: async () => ({
          identity: { provider: "TEST", providerSubject: "phase-j", email: null, expiresAt: new Date("2026-09-03T00:00:00.000Z") },
          account: { accountId, userId: "10000000-0000-4000-8000-000000000072", accountType: "TEST", accountStatus: "ACTIVE", userStatus: "ACTIVE", membershipRole: "OWNER" },
          candidate: { accountId, candidateId, stage: "READY", completed: true, isNewCandidate: false, version: 1, startedAt: new Date("2026-09-01T00:00:00.000Z"), completedAt: new Date("2026-09-01T01:00:00.000Z") }
        })
      },
      intelligence: { resolve: async () => { called = true; throw new Error("not expected"); } }
    }
  });
  const response = await app.inject({
    method: "POST", url: "/v1/field-intelligence/resolve", headers: { authorization: "Bearer valid" },
    payload: { schemaVersion: 1, requestId: crypto.randomUUID(), applicationRunId: null, pageContext: {}, fields: [{ label: "Email" }] }
  });
  assert.equal(response.statusCode, 400);
  assert.equal(called, false);
  await app.close();
});

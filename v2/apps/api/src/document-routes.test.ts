import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedError } from "@job-hunter-v2/domain";
import type { CandidateDocument } from "@job-hunter-v2/onboarding";
import { createApi } from "./app.js";
import type { PhaseGApiServices } from "./onboarding-routes.js";

const accountId = "10000000-0000-4000-8000-000000000191";
const candidateId = "20000000-0000-4000-8000-000000000191";
const documentId = "50000000-0000-4000-8000-000000000191";
const jobId = "40000000-0000-4000-8000-000000000191";

test("editable document routes authenticate, validate ids and derive ownership from the session", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const draft = { title: "Backend Engineer", titleSourceClaimIds: ["job:title"], blocks: [{ kind: "BULLET" as const, text: "TypeScript", sourceClaimIds: ["truth:fixture"] }] };
  const app = await createApi({ phaseG: { sessions, generation: {
    generate: async () => generated(), approve: async () => ({ document: generated(), idempotentReplay: false }),
    editable: async (input) => { calls.push(input); return draft; },
    revise: async (input) => { calls.push(input); return generated(); }
  } } });
  try {
    assert.equal((await app.inject({ method: "GET", url: `/v1/documents/${documentId}/draft` })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/v1/documents/not-a-uuid/draft", headers: { authorization: "Bearer valid" } })).statusCode, 400);
    const read = await app.inject({ method: "GET", url: `/v1/documents/${documentId}/draft`, headers: { authorization: "Bearer valid" } });
    assert.equal(read.statusCode, 200);
    assert.equal(read.headers["cache-control"], "private, no-store");
    assert.deepEqual(calls[0], { accountId, candidateId, documentId });
    const edit = await app.inject({ method: "PUT", url: `/v1/documents/${documentId}/draft`, headers: { authorization: "Bearer valid", "x-idempotency-key": "edit:route-fixture" }, payload: { draft, template: "COMPACT" } });
    assert.equal(edit.statusCode, 201);
    assert.equal(edit.json().document.status, "RECONCILING");
    assert.deepEqual(calls[1], { accountId, candidateId, documentId, draft, template: "COMPACT", idempotencyKey: "edit:route-fixture" });
    assert.equal((await app.inject({ method: "PUT", url: `/v1/documents/${documentId}/draft`, headers: { authorization: "Bearer valid" }, payload: { draft, accountId: crypto.randomUUID() } })).statusCode, 400);
  } finally { await app.close(); }
});

const sessions: PhaseGApiServices["sessions"] = {
  authenticate: async (header) => {
    if (header !== "Bearer valid") throw new UnauthorizedError("Authentication is required.");
    return {
      identity: { provider: "TEST", providerSubject: "phase-r", email: null, expiresAt: new Date("2026-09-12T00:00:00.000Z") },
      account: { accountId, userId: crypto.randomUUID(), accountType: "TEST", accountStatus: "ACTIVE", userStatus: "ACTIVE", membershipRole: "OWNER" },
      candidate: { accountId, candidateId, stage: "READY", completed: true, isNewCandidate: false, version: 1, startedAt: new Date(), completedAt: new Date() }
    };
  }
};

function generated(status: CandidateDocument["status"] = "RECONCILING"): CandidateDocument {
  const now = new Date("2026-09-11T00:00:00.000Z");
  return {
    documentId, candidateId, purpose: "TAILORED_RESUME", documentVersion: 1, status,
    originalFileName: "tailored-resume.pdf", mimeType: "application/pdf", byteSize: 24,
    contentSha256: "a".repeat(64), sourceDocumentId: crypto.randomUUID(), jobId,
    applicationId: null, generationPolicyVersion: 1, failureCode: null,
    isCurrentMaster: false, createdAt: now, updatedAt: now,
    readyAt: status === "READY" ? now : null, applicationUses: []
  };
}

test("R6/R7 generation and approval routes derive ownership and hide internal document storage metadata", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const app = await createApi({ phaseG: {
    sessions,
    generation: {
      generate: async (input) => { calls.push(input); return generated(); },
      approve: async (input) => { calls.push(input); return { document: generated("READY"), idempotentReplay: false }; }
    }
  } });
  assert.equal((await app.inject({
    method: "POST", url: "/v1/documents/generate", payload: { jobId, type: "TAILORED_RESUME" }
  })).statusCode, 401);
  const create = await app.inject({
    method: "POST", url: "/v1/documents/generate",
    headers: { authorization: "Bearer valid", "x-idempotency-key": "generate:api-route-1" },
    payload: { jobId, type: "TAILORED_RESUME", strength: "FOCUSED" }
  });
  assert.equal(create.statusCode, 201);
  assert.equal(create.json().document.status, "RECONCILING");
  assert.equal("contentSha256" in create.json().document, false);
  assert.equal("objectKey" in create.json().document, false);
  assert.deepEqual(calls[0], {
    accountId, candidateId, jobId, applicationId: null, purpose: "TAILORED_RESUME",
    strength: "FOCUSED", template: "CLASSIC", idempotencyKey: "generate:api-route-1"
  });
  const approve = await app.inject({
    method: "POST", url: `/v1/documents/${documentId}/approve`,
    headers: { authorization: "Bearer valid", "x-idempotency-key": "approve:api-route-1" }
  });
  assert.equal(approve.statusCode, 200);
  assert.equal(approve.json().document.status, "READY");
  assert.deepEqual(calls[1], { accountId, candidateId, documentId, idempotencyKey: "approve:api-route-1" });
  await app.close();
});

test("R5 preview remains authenticated, private and candidate-owned", async () => {
  const reads: Array<Record<string, unknown>> = [];
  const bytes = Buffer.from("%PDF-1.7\n%%EOF");
  const app = await createApi({ phaseG: {
    sessions,
    documents: {
      list: async () => [],
      download: async (input) => { reads.push(input); return { document: { ...generated("READY"), byteSize: bytes.byteLength }, bytes }; }
    }
  } });
  assert.equal((await app.inject({ method: "GET", url: `/v1/documents/${documentId}/preview` })).statusCode, 401);
  const response = await app.inject({
    method: "GET", url: `/v1/documents/${documentId}/preview`, headers: { authorization: "Bearer valid" }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.match(response.headers["content-disposition"] ?? "", /^inline;/);
  assert.deepEqual(reads, [{ accountId, candidateId, documentId }]);
  await app.close();
});

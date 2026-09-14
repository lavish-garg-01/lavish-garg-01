import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "./app.js";
import { UnauthorizedError } from "@job-hunter-v2/domain";

const accountId = "b0000000-0000-4000-8000-000000000001";
const candidateId = "b0000000-0000-4000-8000-000000000002";
const applicationId = "b0000000-0000-4000-8000-000000000003";
const runId = "b0000000-0000-4000-8000-000000000004";

const sessions = {
  authenticate: async () => ({
    identity: { provider: "TEST", providerSubject: "phase-l", email: "candidate@example.com", expiresAt: new Date("2026-09-03T00:00:00.000Z") },
    account: { accountId, userId: "b0000000-0000-4000-8000-000000000009", accountType: "NORMAL" as const, accountStatus: "ACTIVE" as const, userStatus: "ACTIVE" as const, membershipRole: "OWNER" as const },
    candidate: { accountId, candidateId, isNewCandidate: false, stage: "READY" as const, completed: true, version: 1, startedAt: new Date(), completedAt: new Date() }
  })
};

test("recovery routes enforce authentication, private caching and strict telemetry", async () => {
  let writes = 0;
  const app = await createApi({ phaseL: {
    sessions: { authenticate: async (header) => { if (header !== "Bearer token") throw new UnauthorizedError("Authentication required."); return sessions.authenticate(); } },
    learning: {} as never,
    recovery: {
      capture: async (owner, item) => { assert.deepEqual(owner, { accountId, candidateId }); writes++; return { itemId: item.itemId, status: "PENDING", idempotentReplay: false }; },
      confirm: async (owner) => { assert.deepEqual(owner, { accountId, candidateId }); return { changeSetId: crypto.randomUUID(), idempotentReplay: false }; },
      list: async () => [], remove: async (_owner, itemId) => ({ itemId, status: "DELETED" as const }),
      listPage: async (owner, page) => { assert.deepEqual(owner, { accountId, candidateId }); assert.ok((page?.limit ?? 50) <= 100); return { items: [], nextCursor: null }; },
      preview: async (owner) => { assert.deepEqual(owner, { accountId, candidateId }); return { normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "INTEGER", value: 45 }, display: "45 days", scope: "GLOBAL",applicationId:null,currentValue:null,expectedCurrentVersionId:null, containsCandidateValue: true } as const; },
      recordOutcome: async (_owner, event) => { writes++; return { eventId: event.eventId, idempotentReplay: false }; },
      outcomes: async () => ({ groups: [], denominator: "REPORTED_FAILURES_ONLY" as const })
    }
  } });
  const payload = { schemaVersion: 1, itemId: crypto.randomUUID(), applicationId, applicationRunId: runId, question: "Synthetic question", answer: "Private synthetic value", source: "EXPLICIT_SAVE" };
  assert.equal((await app.inject({ method: "POST", url: "/v1/learning/inbox", payload })).statusCode, 401);
  const headers = { authorization: "Bearer token" };
  assert.equal((await app.inject({ method: "POST", url: "/v1/learning/inbox", headers, payload: { ...payload, candidateId } })).statusCode, 400);
  const captured = await app.inject({ method: "POST", url: "/v1/learning/inbox", headers, payload });
  assert.equal(captured.statusCode, 200); assert.equal(captured.headers["cache-control"], "no-store");
  const listing = await app.inject({ method: "GET", url: "/v1/learning/inbox", headers });
  assert.equal(listing.statusCode, 200); assert.equal(listing.headers["cache-control"], "no-store");
  assert.equal(listing.json().nextCursor, null);
  for (const query of ["limit=101", "limit=-1", "cursor=invalid", `candidateId=${candidateId}`]) assert.equal((await app.inject({ method: "GET", url: `/v1/learning/inbox?${query}`, headers })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: `/v1/learning/inbox?cursor=${crypto.randomUUID()}&limit=5`, headers })).statusCode, 200);
  const event = { schemaVersion: 1, eventId: crypto.randomUUID(), applicationId, applicationRunId: runId, questionId: null, stage: "RESOLVE", code: "API_TIMEOUT", release: "ADAPTIVE_CHECKPOINT_4", containsCandidateValue: false };
  const rejected = await app.inject({ method: "POST", url: "/v1/learning/outcomes", headers, payload: { ...event, metadata: { text: payload.answer } } });
  assert.equal(rejected.statusCode, 400); assert.equal(rejected.body.includes(payload.answer), false);
  assert.equal((await app.inject({ method: "POST", url: "/v1/learning/outcomes", headers, payload: event })).statusCode, 200);
  assert.equal(writes, 2);
  const confirmation = { canonicalKey: "FIRST_NAME", answer: "Synthetic", expectedCurrentVersionId: null, confirmedGlobalDefault: true };
  const confirmationUrl = `/v1/learning/inbox/${payload.itemId}/confirm`;
  assert.equal((await app.inject({ method: "POST", url: confirmationUrl, payload: confirmation })).statusCode, 401);
  for (const invalid of [{ ...confirmation, canonicalKey: "CURRENT_CTC" }, { ...confirmation, confirmedGlobalDefault: false }, { ...confirmation, candidateId }]) {
    assert.equal((await app.inject({ method: "POST", url: confirmationUrl, headers, payload: invalid })).statusCode, 400);
  }
  const confirmationResult = await app.inject({ method: "POST", url: confirmationUrl, headers, payload: confirmation });
  assert.equal(confirmationResult.statusCode, 200);
  assert.equal(confirmationResult.headers["cache-control"], "no-store");
  const previewUrl = `/v1/learning/inbox/${payload.itemId}/preview`;
  const typed = { ...confirmation, canonicalKey: "NOTICE_PERIOD", answer: "45", unit: "DAYS" };
  assert.equal((await app.inject({ method: "POST", url: previewUrl, payload: typed })).statusCode, 401);
  const preview = await app.inject({ method: "POST", url: previewUrl, headers, payload: typed });
  assert.equal(preview.statusCode, 200); assert.equal(preview.headers["cache-control"], "no-store");
  assert.equal((await app.inject({ method: "POST", url: previewUrl, headers, payload: { ...typed, scopeType: "APPLICATION" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: confirmationUrl, headers, payload: typed })).statusCode, 200);
  const scoped={canonicalKey:"WORK_MODE_REQUIREMENT",answer:"YES",expectedCurrentVersionId:null,scope:"APPLICATION",confirmedGlobalDefault:false};
  assert.equal((await app.inject({method:"POST",url:confirmationUrl,headers,payload:scoped})).statusCode,200);
  for(const invalid of [{...scoped,applicationId:crypto.randomUUID()},{...scoped,confirmedGlobalDefault:true},{...scoped,scope:"GLOBAL"},{...scoped,answer:"maybe"}])assert.equal((await app.inject({method:"POST",url:confirmationUrl,headers,payload:invalid})).statusCode,400);
  assert.equal((await app.inject({ method: "DELETE", url: "/v1/learning/inbox/not-a-uuid", headers })).statusCode, 400);
  await app.close();
});

test("Phase L run and observation routes derive candidate ownership and preserve the strict private boundary", async () => {
  const calls: Array<{ accountId: string; candidateId: string }> = [];
  const app = await createApi({ phaseL: { sessions, learning: {
    startRun: async (input) => {
      calls.push(input);
      return { schemaVersion: 1 as const, requestId: input.request.requestId, applicationId, applicationRunId: runId, status: "ACTIVE" as const, idempotentReplay: false, containsCandidateValue: false as const };
    },
    recordExecutionEvidence: async () => ({ evidenceId: crypto.randomUUID(), idempotentReplay: false }),
    recordObservation: async (input) => {
      calls.push(input);
      return { schemaVersion: 1 as const, requestId: input.request.requestId, observationId: input.request.observationId, status: "RECORDED" as const, attribution: "CANDIDATE_ANSWER_ENTRY" as const, needsVerifiedCheckpoint: true, expiresAt: new Date(Date.now() + 1_000).toISOString(), reasonCode: "AWAITING_VERIFIED_SUBMISSION", idempotentReplay: false, valuePrivate: true as const, containsCandidateValue: false as const };
    },
    recordSubmitAttempt: async (input) => ({ schemaVersion: 1 as const, requestId: input.request.requestId, submitAttemptId: crypto.randomUUID(), idempotentReplay: false, containsCandidateValue: false as const }),
    verifyCheckpoint: async (input) => ({ schemaVersion: 1 as const, requestId: input.request.requestId, checkpointId: crypto.randomUUID(), checkpointStatus: "VERIFIED" as const, result: { changeSetId: null, saved: 0, askAgain: 0, skipped: 0, conflicts: 0, message: "NO_REUSABLE_UPDATES" as const }, idempotentReplay: false, containsCandidateValue: false as const }),
    undoLearningChangeSet: async (input) => ({ schemaVersion: 1 as const, changeSetId: input.changeSetId, restored: 0, forgotten: 0, keptNewer: 0, message: "NOTHING_TO_UNDO" as const, idempotentReplay: false, containsCandidateValue: false as const })
  } } });
  const launch = await app.inject({ method: "POST", url: "/v1/learning/runs", headers: { authorization: "Bearer token", "x-idempotency-key": "launch:test-run" }, payload: { schemaVersion: 1, requestId: crypto.randomUUID(), jobId: null, targetUrl: "https://apply.example.test/job", extensionVersion: "0.1.0", protocolVersion: 1 } });
  assert.equal(launch.statusCode, 200);
  const observationId = crypto.randomUUID();
  const observed = await app.inject({ method: "POST", url: "/v1/learning/observations", headers: { authorization: "Bearer token", "x-idempotency-key": `observation:${observationId}` }, payload: {
    schemaVersion: 1, requestId: crypto.randomUUID(), observationId, applicationId, applicationRunId: runId,
    pageInstanceId: crypto.randomUUID(), formInstanceId: "form:12345678", fieldRuntimeId: "field:12345678", controlFingerprint: "control:12345678",
    controlType: "EMAIL", labelEvidence: ["Email"], canonicalKey: "EMAIL", descriptorFingerprint: "a".repeat(64), semanticState: "RESOLVED_HIGH",
    semanticConfidence: 0.99, semanticResolver: "EXACT_ALIAS", entityBinding: { entityType: null, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel: null },
    answerVersionId: null, answerScopeFingerprint: null, priorOperationId: null, priorVerificationStatus: null, priorFailureClass: null,
    origin: "USER_ENTERED", observationType: "MANUAL_ANSWER", value: { kind: "TEXT", value: "candidate@example.com" }, occurredAt: new Date().toISOString(),
    candidateId: crypto.randomUUID()
  } });
  assert.equal(observed.statusCode, 400, "strict contract rejects caller-supplied candidate authority");
  assert.deepEqual(calls.map(({ accountId: currentAccount, candidateId: currentCandidate }) => ({ accountId: currentAccount, candidateId: currentCandidate })), [{ accountId, candidateId }]);
  await app.close();
});

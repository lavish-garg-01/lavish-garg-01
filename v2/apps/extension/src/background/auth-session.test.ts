import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionApiClient } from "./api-client.js";
import { AuthSessionStore } from "./auth-session.js";
import { MemoryStorageArea } from "./storage.js";
import { ExtensionRuntimeError } from "../shared/errors.js";

const token = "local-test-access-token-123456";

test("private sidebar panels require authentication and return only global non-entity profile values", async () => {
  const storage = new MemoryStorageArea();
  const auth = new AuthSessionStore(storage);
  let requested = false;
  const fetchImpl = (async () => { requested = true; return new Response(JSON.stringify({ answers: [
    { label: "Name", entityId: null, scopeType: "GLOBAL", trustState: "TRUSTED", normalizedValue: { kind: "STRING", value: "Asha Example" } },
    { label: "Job-specific answer", entityId: null, scopeType: "JOB", trustState: "TRUSTED", normalizedValue: { kind: "STRING", value: "Private override" } }
  ] })); }) as typeof fetch;
  const api = new ExtensionApiClient({ apiOrigin: "http://127.0.0.1:3100", webOrigins: ["http://localhost:3000"], channel: "development" }, auth, fetchImpl);
  await assert.rejects(api.candidatePanel("profile"), /Reconnect/);
  assert.equal(requested, false);
  await auth.offer(token);
  const panel = await api.candidatePanel("profile");
  assert.equal(panel.containsCandidateValue, true);
  assert.deepEqual(panel.items, [{ label: "Name", value: "Asha Example", state: "TRUSTED" }]);
  assert.doesNotMatch(JSON.stringify(await storage.get(null)), /Asha|Private override/);
});

test("expired extension sessions erase the bearer token", async () => {
  const auth = new AuthSessionStore(new MemoryStorageArea());
  await auth.offer(token);
  await auth.clear("SESSION_EXPIRED");
  assert.equal(await auth.token(), null);
  assert.equal(await auth.state(), "SESSION_EXPIRED");
});

test("extension session client accepts the authoritative Phase G response", async () => {
  const auth = new AuthSessionStore(new MemoryStorageArea());
  await auth.offer(token);
  const candidateId = crypto.randomUUID();
  const fetchImpl = (async () => new Response(JSON.stringify({
    email: "local@example.test",
    account: { type: "TEST", role: "OWNER" },
    candidate: { id: candidateId, new: false },
    onboarding: { stage: "READY", completed: true, version: 2, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() }
  }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const client = new ExtensionApiClient({ apiOrigin: "http://127.0.0.1:3100", webOrigins: ["http://localhost:3000"], channel: "development" }, auth, fetchImpl);
  assert.equal((await client.session()).candidate.id, candidateId);
});

test("extension session client classifies timeouts without leaking the bearer token", async () => {
  const auth = new AuthSessionStore(new MemoryStorageArea());
  await auth.offer(token);
  const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  })) as typeof fetch;
  const client = new ExtensionApiClient({ apiOrigin: "http://127.0.0.1:3100", webOrigins: ["http://localhost:3000"], channel: "development" }, auth, fetchImpl, 2);
  await assert.rejects(() => client.session(), (reason: unknown) => {
    assert.ok(reason instanceof ExtensionRuntimeError);
    assert.equal(reason.failure.code, "API_TIMEOUT");
    assert.equal(JSON.stringify(reason.failure).includes(token), false);
    return true;
  });
});

test("extension field-intelligence client validates the value-free API contract", async () => {
  const auth = new AuthSessionStore(new MemoryStorageArea());
  await auth.offer(token);
  const requestId = crypto.randomUUID();
  let authorization = "";
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    authorization = String((init?.headers as Record<string, string> | undefined)?.authorization ?? "");
    return new Response(JSON.stringify({
      schemaVersion: 1, requestId, items: [],
      summary: { resolvedHigh: 0, resolvedMedium: 0, ambiguous: 0, unresolved: 0, unsupported: 0, answerAvailable: 0, aiRequests: 0, cacheHits: 0, durationMs: 1 },
      valuePrivate: true, containsCandidateValue: false
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const client = new ExtensionApiClient({ apiOrigin: "http://127.0.0.1:3100", webOrigins: ["http://localhost:3000"], channel: "development" }, auth, fetchImpl);
  const response = await client.resolveFields({
    schemaVersion: 1, requestId, applicationRunId: null,
    pageContext: { host: "jobs.example", ats: "GENERIC", pageHeading: null, jobId: null, applicationId: null, countryCode: null, roleFamily: null, companyId: null },
    fields: []
  });
  assert.equal(response.containsCandidateValue, false);
  assert.equal(authorization, `Bearer ${token}`);
});

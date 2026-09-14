import assert from "node:assert/strict";
import test from "node:test";
import type { AiPort, AiRequest, AiResult } from "@job-hunter-v2/ai";
import type { DocumentGenerationContext } from "@job-hunter-v2/onboarding";
import { OrchestratedGeneratedDocumentPort } from "./document-generation-bridges.js";

const accountId = crypto.randomUUID();
const candidateId = crypto.randomUUID();
const truthId = crypto.randomUUID();
const context: DocumentGenerationContext & { accountId: string; candidateId: string; purpose: "TAILORED_RESUME"; strength: "LIGHT" } = {
  accountId, candidateId, purpose: "TAILORED_RESUME", strength: "LIGHT",
  sourceDocumentId: crypto.randomUUID(), jobId: crypto.randomUUID(), applicationId: null,
  candidateClaims: [{ sourceId: `truth:${truthId}`, sourceType: "CANDIDATE_TRUTH", canonicalKey: "SKILLS", text: "TypeScript" }],
  jobClaims: [
    { sourceId: "job:title", sourceType: "JOB_INTELLIGENCE", canonicalKey: "JOB_TITLE", text: "Engineer" },
    { sourceId: "job:company", sourceType: "JOB_INTELLIGENCE", canonicalKey: "COMPANY_NAME", text: "Example Labs" }
  ]
};

test("R6/R7 use P with document-private scope and never select a provider directly", async () => {
  let captured: AiRequest | null = null;
  const output = {
    title: "Engineer", titleSourceClaimIds: ["job:title"],
    blocks: [{ kind: "BULLET" as const, text: "TypeScript", sourceClaimIds: [`truth:${truthId}`] }]
  };
  const ai: AiPort = { execute: async (request) => {
    captured = request;
    return { ok: true, value: output, metadata: {
      taskType: request.taskType, requestId: request.requestId, policyVersion: "P1-2026-09",
      taskVersion: 1, schemaVersion: 1, confidence: 0.96, cache: "MISS",
      attempts: [], totalCostMicros: 0, fallbackCount: 0
    } } as AiResult;
  } };
  assert.deepEqual(await new OrchestratedGeneratedDocumentPort(ai, true).generate(context), output);
  assert.ok(captured);
  const sent = captured as unknown as AiRequest;
  assert.equal(sent.taskType, "TAILOR_RESUME");
  assert.equal(sent.privacy, "DOCUMENT_PRIVATE_DATA");
  assert.equal(sent.scope.accountId, accountId);
  assert.equal("provider" in (sent as unknown as Record<string, unknown>), false);
  assert.equal("model" in (sent as unknown as Record<string, unknown>), false);
});

test("an ungrounded AI document safely falls back instead of breaking generation", async () => {
  const ai: AiPort = { execute: async (request) => ({
    ok: true,
    value: {
      title: "Engineer",
      titleSourceClaimIds: ["job:title"],
      blocks: [{ kind: "BULLET", text: "Invented Kubernetes leadership", sourceClaimIds: [`truth:${truthId}`] }]
    },
    metadata: {
      taskType: request.taskType, requestId: request.requestId, policyVersion: "P1-2026-09",
      taskVersion: 1, schemaVersion: 1, confidence: 0.99, cache: "MISS",
      attempts: [], totalCostMicros: 0, fallbackCount: 0
    }
  } as AiResult) };
  const draft = await new OrchestratedGeneratedDocumentPort(ai, true).generate(context);
  assert.equal(draft.title, "TypeScript");
  assert.deepEqual(draft.blocks, [{ kind: "BULLET", text: "TypeScript", sourceClaimIds: [`truth:${truthId}`] }]);
});

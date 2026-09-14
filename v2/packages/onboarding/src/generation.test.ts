import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import {
  DocumentGenerationService,
  renderGeneratedPdf,
  validateGroundedDraft,
  type CandidateDocument,
  type DocumentGenerationContext,
  type DocumentGenerationRepository,
  type GeneratedDocumentDraft,
  type ObjectStoragePort
} from "./index.js";

const accountId = randomUUID();
const candidateId = randomUUID();
const sourceDocumentId = randomUUID();
const jobId = randomUUID();
const truthId = randomUUID();
const context: DocumentGenerationContext = {
  sourceDocumentId, jobId, applicationId: null,
  candidateClaims: [{ sourceId: `truth:${truthId}`, sourceType: "CANDIDATE_TRUTH", canonicalKey: "SKILLS", text: "TypeScript and Node.js" }],
  jobClaims: [
    { sourceId: "job:title", sourceType: "JOB_INTELLIGENCE", canonicalKey: "JOB_TITLE", text: "Backend Engineer" },
    { sourceId: "job:company", sourceType: "JOB_INTELLIGENCE", canonicalKey: "COMPANY_NAME", text: "Example Labs" },
    { sourceId: "job:required-java-0", sourceType: "JOB_INTELLIGENCE", canonicalKey: "REQUIRED_SKILL", text: "Java" }
  ]
};

test("R6 grounded-document validation rejects unsupported job skills and invented metrics", () => {
  const unsupportedSkill: GeneratedDocumentDraft = {
    title: "Backend Engineer", titleSourceClaimIds: ["job:title"],
    blocks: [{ kind: "BULLET", text: "Expert Java engineer", sourceClaimIds: ["job:required-java-0"] }]
  };
  assert.throws(() => validateGroundedDraft(unsupportedSkill, context), /unsupported skill/i);
  const inventedMetric: GeneratedDocumentDraft = {
    title: "Backend Engineer", titleSourceClaimIds: ["job:title"],
    blocks: [{ kind: "BULLET", text: "Improved TypeScript services by 40%", sourceClaimIds: [`truth:${truthId}`] }]
  };
  assert.throws(() => validateGroundedDraft(inventedMetric, context), /unsupported number/i);
  for (const fabricated of [
    "TypeScript engineer at FakeCorp",
    "Lead Architect using TypeScript",
    "Built the Apollo project with TypeScript",
    "Certified Kubernetes professional using TypeScript"
  ]) {
    assert.throws(() => validateGroundedDraft({
      title: "Backend Engineer", titleSourceClaimIds: ["job:title"],
      blocks: [{ kind: "BULLET", text: fabricated, sourceClaimIds: [`truth:${truthId}`] }]
    }, context), /not supported/i);
  }
  assert.throws(() => validateGroundedDraft({
    title: "Backend Engineer", titleSourceClaimIds: ["job:title"],
    blocks: [{ kind: "BULLET", text: "Backend Engineer", sourceClaimIds: ["job:title"] }]
  }, context), /Candidate Truth/i, "job requirements cannot be presented as candidate resume experience");
});

test("grounding accepts exact cited short values and acronyms used by the deterministic fallback", () => {
  for (const text of ["Yes", "AWS", "C++"]) {
    const sourceId = `truth:${truthId}`;
    const exactContext = { ...context, candidateClaims: [{ sourceId, sourceType: "CANDIDATE_TRUTH" as const, canonicalKey: "SKILLS", text }] };
    const draft = { title: "Backend Engineer", titleSourceClaimIds: ["job:title"], blocks: [{ kind: "BULLET" as const, text, sourceClaimIds: [sourceId] }] };
    assert.deepEqual(validateGroundedDraft(draft, exactContext), draft);
  }
  assert.throws(() => validateGroundedDraft({
    title: "Backend Engineer", titleSourceClaimIds: ["job:title"],
    blocks: [{ kind: "BULLET", text: "Yes, Kubernetes expert", sourceClaimIds: [`truth:${truthId}`] }]
  }, { ...context, candidateClaims: [{ sourceId: `truth:${truthId}`, sourceType: "CANDIDATE_TRUTH", canonicalKey: "BOOLEAN", text: "Yes" }] }), /not supported/i);
});

test("R6/R7 generation stores an immutable review draft with a valid one-page PDF and claim-only provenance", async () => {
  let completed: Parameters<DocumentGenerationRepository["complete"]>[0] | null = null;
  const stored = new Map<string, Uint8Array>();
  const storage: ObjectStoragePort = {
    put: async ({ objectKey, bytes }) => { stored.set(objectKey, bytes); },
    get: async (key) => stored.get(key) ?? new Uint8Array(),
    delete: async (key) => { stored.delete(key); }
  };
  const repository: DocumentGenerationRepository = {
    begin: async (input) => ({ runId: input.runId, idempotentReplay: false, document: null }),
    complete: async (input) => {
      completed = input;
      return {
        documentId: input.documentId, candidateId, purpose: "TAILORED_RESUME", documentVersion: 1,
        status: "RECONCILING", originalFileName: input.fileName, mimeType: "application/pdf",
        byteSize: input.byteSize, contentSha256: input.contentSha256, sourceDocumentId,
        jobId, applicationId: null, generationPolicyVersion: 1, failureCode: null,
        isCurrentMaster: false, createdAt: input.completedAt, updatedAt: input.completedAt,
        readyAt: null, applicationUses: []
      } satisfies CandidateDocument;
    },
    fail: async () => undefined,
    approve: async () => { throw new Error("not used"); }
  };
  const service = new DocumentGenerationService(repository, { load: async () => context }, {
    generate: async () => ({
      title: "Backend Engineer", titleSourceClaimIds: ["job:title"],
      blocks: [{ kind: "BULLET", text: "TypeScript and Node.js", sourceClaimIds: [`truth:${truthId}`] }]
    })
  }, storage);
  const document = await service.generate({ accountId, candidateId, jobId, purpose: "TAILORED_RESUME", idempotencyKey: "generate:test-1" });
  assert.equal(document.status, "RECONCILING");
  assert.ok(completed);
  const written = [...stored.values()][0];
  assert.ok(written);
  assert.equal(Buffer.from(written).subarray(0, 8).toString("ascii"), "%PDF-1.7");
  assert.equal(Buffer.from(written).subarray(-5).toString("ascii"), "%%EOF");
  assert.equal((completed as Parameters<DocumentGenerationRepository["complete"]>[0]).contentSha256, createHash("sha256").update(written).digest("hex"));
  assert.deepEqual([...(completed as Parameters<DocumentGenerationRepository["complete"]>[0]).claimManifest].sort(), [`truth:${truthId}`, "job:title"].sort());
});

test("the deterministic renderer never embeds remote assets or active PDF content", () => {
  const bytes = renderGeneratedPdf({
    title: "TypeScript", titleSourceClaimIds: [`truth:${truthId}`],
    blocks: [{ kind: "PARAGRAPH", text: "TypeScript and Node.js", sourceClaimIds: [`truth:${truthId}`] }]
  });
  const text = Buffer.from(bytes).toString("ascii");
  assert.doesNotMatch(text, /https?:|\/JavaScript|\/OpenAction|\/Launch/);
});

test("R6 generation failure closes the run and removes an uncommitted private object", async () => {
  let failure: Parameters<DocumentGenerationRepository["fail"]>[0] | null = null;
  const stored = new Map<string, Uint8Array>();
  const repository: DocumentGenerationRepository = {
    begin: async (input) => ({ runId: input.runId, idempotentReplay: false, document: null }),
    complete: async () => { throw new Error("simulated durable write failure"); },
    fail: async (input) => { failure = input; },
    approve: async () => { throw new Error("not used"); }
  };
  const storage: ObjectStoragePort = {
    put: async ({ objectKey, bytes }) => { stored.set(objectKey, bytes); },
    get: async (objectKey) => stored.get(objectKey) ?? new Uint8Array(),
    delete: async (objectKey) => { stored.delete(objectKey); }
  };
  const service = new DocumentGenerationService(repository, { load: async () => context }, {
    generate: async () => ({
      title: "Backend Engineer", titleSourceClaimIds: ["job:title"],
      blocks: [{ kind: "BULLET", text: "TypeScript and Node.js", sourceClaimIds: [`truth:${truthId}`] }]
    })
  }, storage);
  await assert.rejects(service.generate({
    accountId, candidateId, jobId, purpose: "TAILORED_RESUME", idempotencyKey: "generate:failure-1"
  }), /could not be generated safely/i);
  assert.equal(stored.size, 0);
  assert.equal((failure as Parameters<DocumentGenerationRepository["fail"]>[0] | null)?.errorCode, "DOCUMENT_GENERATION_FAILED");
});
test("both document layouts paginate instead of dropping long résumé content", () => {
  for (const template of ["CLASSIC", "COMPACT"] as const) {
    const pdf = Buffer.from(renderGeneratedPdf({ title: "Candidate", titleSourceClaimIds: ["truth:name"], blocks: Array.from({ length: 130 }, (_, i) => ({ kind: "BULLET" as const, text: `Experience evidence ${i}`, sourceClaimIds: ["truth:experience"] })) }, template)).toString("ascii");
    assert.match(pdf, /Experience evidence 129/);
    assert.match(pdf, /\/Count 3/);
    assert.equal((pdf.match(/\/Type \/Page /g) ?? []).length, 3);
  }
});

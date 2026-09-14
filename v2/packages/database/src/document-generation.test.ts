import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import {
  ApplicationDocumentService,
  DocumentGenerationService,
  type DocumentGenerationContext,
  type GeneratedDocumentPort,
  type ObjectStoragePort
} from "@job-hunter-v2/onboarding";
import {
  KyselyApplicationDocumentRepository,
  KyselyDocumentGenerationRepository,
  migrateCandidateOnboardingBootstrap,
  migrateCandidateOnboardingConfirmation,
  migrateCandidateResumeIntelligence,
  migrateCandidateScopePolicyVectors,
  migrateCandidateTruthOntology,
  migrateDocumentIntelligence,
  migrateInitialSchema,
  type SqlClient,
  type V2Database
} from "./index.js";

function client(database: PGlite): SqlClient {
  const executor = (target: Pick<PGlite, "query" | "exec">) => ({
    query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => ({ rows: (await target.query<Row>(text, values ? [...values] : undefined)).rows }),
    executeScript: async (text: string) => void (await target.exec(text))
  });
  return { ...executor(database), withTransaction: async (work) => database.transaction((transaction) => work(executor(transaction))) };
}

class MemoryStorage implements ObjectStoragePort {
  readonly values = new Map<string, Uint8Array>();
  async put(input: { objectKey: string; bytes: Uint8Array }): Promise<void> { this.values.set(input.objectKey, input.bytes); }
  async get(objectKey: string): Promise<Uint8Array> { const value = this.values.get(objectKey); if (!value) throw new Error("missing"); return value; }
  async delete(objectKey: string): Promise<void> { this.values.delete(objectKey); }
}

test("R6-R8 generation, approval, exact run pinning and value-free upload evidence are durable", async () => {
  const pglite = new PGlite();
  const migrations = client(pglite);
  await migrateInitialSchema(migrations);
  await migrateCandidateTruthOntology(migrations);
  await migrateCandidateScopePolicyVectors(migrations);
  await migrateCandidateOnboardingBootstrap(migrations);
  await migrateCandidateResumeIntelligence(migrations);
  await migrateCandidateOnboardingConfirmation(migrations);
  await migrateDocumentIntelligence(migrations);
  await migrateGlobalAnswerDefaults(migrations);
  const database = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite }) });
  const accountId = "11000000-0000-4000-8000-000000000001";
  const candidateId = "21000000-0000-4000-8000-000000000001";
  const companyId = "31000000-0000-4000-8000-000000000001";
  const jobId = "41000000-0000-4000-8000-000000000001";
  const masterId = "51000000-0000-4000-8000-000000000001";
  const applicationId = "61000000-0000-4000-8000-000000000001";
  const applicationRunId = "71000000-0000-4000-8000-000000000001";
  const truthId = "81000000-0000-4000-8000-000000000001";
  const master = Buffer.from("%PDF-1.7\nmaster v1\n%%EOF");
  const masterHash = createHash("sha256").update(master).digest("hex");
  await pglite.exec(`
    INSERT INTO accounts (id, account_type) VALUES ('${accountId}', 'NORMAL');
    INSERT INTO candidates (id, account_id, status) VALUES ('${candidateId}', '${accountId}', 'ACTIVE');
    INSERT INTO companies (id, canonical_name, normalized_name) VALUES ('${companyId}', 'Example Labs', 'example labs');
    INSERT INTO jobs (id, company_id, canonical_title, normalized_title, status, material_fingerprint, first_seen_at, last_seen_at)
      VALUES ('${jobId}', '${companyId}', 'Backend Engineer', 'backend engineer', 'ACTIVE', '${"a".repeat(64)}', '2026-01-01Z', '2026-01-01Z');
    INSERT INTO documents (
      id, account_id, candidate_id, object_key, original_file_name, content_sha256,
      byte_size, mime_type, purpose, status, metadata, created_at, updated_at,
      document_version, ready_at
    ) VALUES ('${masterId}', '${accountId}', '${candidateId}', 'private/master-v1.pdf', 'master-v1.pdf',
      '${masterHash}', ${master.byteLength}, 'application/pdf', 'MASTER_RESUME', 'READY', '{}',
      '2026-01-01Z', '2026-01-01Z', 1, '2026-01-01Z');
    INSERT INTO applications (id, account_id, candidate_id, job_id, target_url, status)
      VALUES ('${applicationId}', '${accountId}', '${candidateId}', '${jobId}', 'https://fixture.test/apply', 'IN_PROGRESS');
    INSERT INTO application_runs (id, application_id, protocol_version, status)
      VALUES ('${applicationRunId}', '${applicationId}', 1, 'ACTIVE');
  `);
  const storage = new MemoryStorage();
  storage.values.set("private/master-v1.pdf", master);
  const generationContext = (applicationIdValue: string | null): DocumentGenerationContext => ({
    sourceDocumentId: masterId, jobId, applicationId: applicationIdValue,
    candidateClaims: [{ sourceId: `truth:${truthId}`, sourceType: "CANDIDATE_TRUTH", canonicalKey: "SKILLS", text: "TypeScript and Node.js" }],
    jobClaims: [
      { sourceId: "job:title", sourceType: "JOB_INTELLIGENCE", canonicalKey: "JOB_TITLE", text: "Backend Engineer" },
      { sourceId: "job:company", sourceType: "JOB_INTELLIGENCE", canonicalKey: "COMPANY_NAME", text: "Example Labs" }
    ]
  });
  let generatorCalls = 0;
  const generator: GeneratedDocumentPort = { generate: async (input) => {
    generatorCalls += 1;
    return input.purpose === "TAILORED_RESUME" ? {
      title: "Backend Engineer", titleSourceClaimIds: ["job:title"],
      blocks: [{ kind: "BULLET", text: "TypeScript and Node.js", sourceClaimIds: [`truth:${truthId}`] }]
    } : {
      title: "Backend Engineer at Example Labs", titleSourceClaimIds: ["job:title", "job:company"],
      blocks: [{ kind: "PARAGRAPH", text: "Interested in the Backend Engineer role at Example Labs.", sourceClaimIds: ["job:title", "job:company"] }]
    };
  } };
  const repository = new KyselyDocumentGenerationRepository(database);
  const generation = new DocumentGenerationService(repository, {
    load: async (input) => generationContext(input.applicationId)
  }, generator, storage);
  const beforeTruth = await pglite.query<{ count: string }>("SELECT count(*)::text AS count FROM candidate_answer_versions");
  const tailored = await generation.generate({ accountId, candidateId, jobId, purpose: "TAILORED_RESUME", idempotencyKey: "tailor:fixture-1" });
  assert.equal(tailored.status, "RECONCILING");
  const replay = await generation.generate({ accountId, candidateId, jobId, purpose: "TAILORED_RESUME", idempotencyKey: "tailor:fixture-1" });
  assert.equal(replay.documentId, tailored.documentId);
  assert.equal(generatorCalls, 1);
  const readyTailored = (await generation.approve({ accountId, candidateId, documentId: tailored.documentId, idempotencyKey: "approve:fixture-tailored" })).document;
  assert.equal(readyTailored.status, "READY");
  const cover = await generation.generate({ accountId, candidateId, jobId, applicationId, purpose: "COVER_LETTER", idempotencyKey: "cover:fixture-1" });
  await generation.approve({ accountId, candidateId, documentId: cover.documentId, idempotencyKey: "approve:fixture-cover" });
  const afterTruth = await pglite.query<{ count: string }>("SELECT count(*)::text AS count FROM candidate_answer_versions");
  assert.equal(afterTruth.rows[0]?.count, beforeTruth.rows[0]?.count, "cover-letter prose must not become Candidate Truth");

  const applicationDocuments = new ApplicationDocumentService(new KyselyApplicationDocumentRepository(database), storage);
  const pinnedResume = await applicationDocuments.resolve({ accountId, candidateId, applicationId, applicationRunId, jobId, documentKind: "RESUME" });
  const pinnedCover = await applicationDocuments.resolve({ accountId, candidateId, applicationId, applicationRunId, jobId, documentKind: "COVER_LETTER" });
  assert.equal(pinnedResume?.documentId, tailored.documentId);
  assert.equal(pinnedCover?.documentId, cover.documentId);
  assert.notEqual(pinnedResume?.documentId, pinnedCover?.documentId);
  assert.equal(Buffer.from(pinnedResume?.bytesBase64 ?? "", "base64").byteLength, tailored.byteSize);

  const regenerated = await generation.generate({
    accountId, candidateId, jobId, purpose: "TAILORED_RESUME", idempotencyKey: "tailor:fixture-2"
  });
  const readyRegenerated = (await generation.approve({
    accountId, candidateId, documentId: regenerated.documentId, idempotencyKey: "approve:fixture-tailored-2"
  })).document;
  assert.notEqual(readyRegenerated.documentId, readyTailored.documentId);
  assert.equal(readyRegenerated.documentVersion, 2);
  assert.equal(readyTailored.documentVersion, 1);
  const replayedAfterRegeneration = await applicationDocuments.resolve({
    accountId, candidateId, applicationId, applicationRunId, jobId, documentKind: "RESUME"
  });
  assert.equal(replayedAfterRegeneration?.documentId, tailored.documentId, "regeneration must not mutate an active run's immutable pin");
  const editable = await generation.editable({ accountId, candidateId, documentId: regenerated.documentId });
  assert.equal(editable.blocks[0]?.text, "TypeScript and Node.js");
  await assert.rejects(generation.editable({ accountId: randomUUID(), candidateId, documentId: regenerated.documentId }), /not found/i);
  await assert.rejects(generation.revise({ accountId, candidateId: randomUUID(), documentId: regenerated.documentId, draft: editable, idempotencyKey: "revision:foreign" }), /not found/i);
  const revised = await generation.revise({ accountId, candidateId, documentId: regenerated.documentId, draft: editable, template: "COMPACT", idempotencyKey: "revision:own" });
  assert.equal(revised.status, "RECONCILING");
  assert.notEqual(revised.documentId, regenerated.documentId);
  assert.equal(revised.documentVersion, 3);
  assert.equal((await generation.revise({ accountId, candidateId, documentId: regenerated.documentId, draft: editable, template: "COMPACT", idempotencyKey: "revision:own" })).documentId, revised.documentId);
  const malicious = { ...editable, blocks: [{ ...editable.blocks[0]!, text: "TypeScript increased sales 999%" }] };
  await assert.rejects(generation.revise({ accountId, candidateId, documentId: regenerated.documentId, draft: malicious, idempotencyKey: "revision:invented" }), /unsupported number/i);

  await pglite.exec(`
    UPDATE documents SET status = 'SUPERSEDED', updated_at = '2026-02-01Z' WHERE id = '${masterId}';
    INSERT INTO documents (
      id, account_id, candidate_id, object_key, original_file_name, content_sha256,
      byte_size, mime_type, purpose, status, metadata, created_at, updated_at,
      document_version, ready_at
    ) VALUES ('52000000-0000-4000-8000-000000000001', '${accountId}', '${candidateId}', 'private/master-v2.pdf', 'master-v2.pdf',
      '${masterHash}', ${master.byteLength}, 'application/pdf', 'MASTER_RESUME', 'READY', '{}',
      '2026-02-01Z', '2026-02-01Z', 2, '2026-02-01Z');
  `);
  storage.values.set("private/master-v2.pdf", master);
  const replayedPin = await applicationDocuments.resolve({ accountId, candidateId, applicationId, applicationRunId, jobId, documentKind: "RESUME" });
  assert.equal(replayedPin?.documentId, tailored.documentId, "active run must retain its exact original document pin");
  assert.equal(replayedPin?.idempotentReplay, true);
  const generatedStillExact = await pglite.query<{ source_document_id: string; content_sha256: string }>(`SELECT source_document_id, content_sha256 FROM documents WHERE id = '${tailored.documentId}'`);
  assert.equal(generatedStillExact.rows[0]?.source_document_id, masterId);
  assert.equal(generatedStillExact.rows[0]?.content_sha256, tailored.contentSha256);

  const operationId = randomUUID();
  const evidence = await applicationDocuments.recordUpload({
    accountId, candidateId, applicationId, applicationRunId,
    selectionId: pinnedResume!.selectionId, documentId: pinnedResume!.documentId,
    operationId, fieldKey: "field:resume-upload", outcome: "VERIFIED",
    reasonCode: "DOCUMENT_UPLOAD_VERIFIED", observedFileCount: 1
  });
  const evidenceReplay = await applicationDocuments.recordUpload({
    accountId, candidateId, applicationId, applicationRunId,
    selectionId: pinnedResume!.selectionId, documentId: pinnedResume!.documentId,
    operationId, fieldKey: "field:resume-upload", outcome: "VERIFIED",
    reasonCode: "DOCUMENT_UPLOAD_VERIFIED", observedFileCount: 1
  });
  assert.equal(evidenceReplay.evidenceId, evidence.evidenceId);
  assert.equal(evidenceReplay.idempotentReplay, true);
  const privateColumns = await pglite.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM information_schema.columns
    WHERE table_name = 'application_document_upload_evidence'
      AND column_name IN ('document_content', 'bytes', 'object_key', 'storage_url', 'candidate_value')
  `);
  assert.equal(privateColumns.rows[0]?.count, "0");
  await assert.rejects(applicationDocuments.resolve({
    accountId, candidateId: randomUUID(), applicationId, applicationRunId, jobId, documentKind: "RESUME"
  }), /stale or foreign/i);
  await database.destroy();
});
import { migrateGlobalAnswerDefaults } from "./index.js";

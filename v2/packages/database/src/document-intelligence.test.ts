import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { DocumentIntelligenceService, type ObjectStoragePort } from "@job-hunter-v2/onboarding";
import {
  KyselyDocumentIntelligenceRepository,
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
  async get(objectKey: string): Promise<Uint8Array> {
    const value = this.values.get(objectKey);
    if (!value) throw new Error("missing");
    return value;
  }
  async delete(objectKey: string): Promise<void> { this.values.delete(objectKey); }
}

test("R5 history and authorized retrieval preserve exact application document versions", async () => {
  const database = new PGlite();
  const migrations = client(database);
  await migrateInitialSchema(migrations);
  await migrateCandidateTruthOntology(migrations);
  await migrateCandidateScopePolicyVectors(migrations);
  await migrateCandidateOnboardingBootstrap(migrations);
  await migrateCandidateResumeIntelligence(migrations);
  await migrateCandidateOnboardingConfirmation(migrations);
  await migrateDocumentIntelligence(migrations);
  await migrateGlobalAnswerDefaults(migrations);
  const accountId = "10000000-0000-4000-8000-000000000051";
  const candidateId = "20000000-0000-4000-8000-000000000051";
  const oldDocumentId = "30000000-0000-4000-8000-000000000051";
  const currentDocumentId = "30000000-0000-4000-8000-000000000052";
  const applicationId = "40000000-0000-4000-8000-000000000051";
  const runId = "50000000-0000-4000-8000-000000000051";
  const oldBytes = Buffer.from("%PDF-1.7\nold\n%%EOF");
  const currentBytes = Buffer.from("%PDF-1.7\ncurrent\n%%EOF");
  const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  await database.exec(`
    INSERT INTO accounts (id, account_type) VALUES ('${accountId}', 'NORMAL');
    INSERT INTO candidates (id, account_id, status) VALUES ('${candidateId}', '${accountId}', 'ACTIVE');
    INSERT INTO documents (
      id, account_id, candidate_id, object_key, original_file_name, content_sha256,
      byte_size, mime_type, purpose, status, metadata, created_at, updated_at,
      document_version, ready_at
    ) VALUES
      ('${oldDocumentId}', '${accountId}', '${candidateId}', 'private/old.pdf', 'resume-v1.pdf', '${digest(oldBytes)}', ${oldBytes.byteLength}, 'application/pdf', 'MASTER_RESUME', 'SUPERSEDED', '{}', '2026-01-01Z', '2026-02-01Z', 1, '2026-01-01Z'),
      ('${currentDocumentId}', '${accountId}', '${candidateId}', 'private/current.pdf', 'resume-v2.pdf', '${digest(currentBytes)}', ${currentBytes.byteLength}, 'application/pdf', 'MASTER_RESUME', 'READY', '{}', '2026-02-01Z', '2026-02-01Z', 2, '2026-02-01Z');
    INSERT INTO applications (id, account_id, candidate_id, target_url, status)
      VALUES ('${applicationId}', '${accountId}', '${candidateId}', 'https://fixture.test/apply', 'IN_PROGRESS');
    INSERT INTO application_runs (id, application_id, protocol_version, status)
      VALUES ('${runId}', '${applicationId}', 1, 'ACTIVE');
    INSERT INTO application_document_selections (
      id, account_id, candidate_id, application_id, run_id, document_kind,
      document_id, selection_source, created_at
    ) VALUES (
      '60000000-0000-4000-8000-000000000051', '${accountId}', '${candidateId}',
      '${applicationId}', '${runId}', 'RESUME', '${oldDocumentId}', 'MASTER', '2026-01-15Z'
    );
  `);
  const storage = new MemoryStorage();
  storage.values.set("private/old.pdf", oldBytes);
  storage.values.set("private/current.pdf", currentBytes);
  const service = new DocumentIntelligenceService(
    new KyselyDocumentIntelligenceRepository(new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) })),
    storage
  );
  const history = await service.list(accountId, candidateId);
  assert.equal(history.length, 2);
  assert.equal(history.find((document) => document.documentId === currentDocumentId)?.isCurrentMaster, true);
  assert.equal(history.find((document) => document.documentId === oldDocumentId)?.applicationUses[0]?.applicationRunId, runId);
  assert.deepEqual((await service.download({ accountId, candidateId, documentId: oldDocumentId })).bytes, oldBytes);
  await assert.rejects(service.download({
    accountId: "10000000-0000-4000-8000-000000000099", candidateId, documentId: oldDocumentId
  }), /not found/i);
  storage.values.set("private/current.pdf", Buffer.from("tampered"));
  await assert.rejects(service.download({ accountId, candidateId, documentId: currentDocumentId }), /integrity/i);
  await database.close();
});
import { migrateGlobalAnswerDefaults } from "./index.js";

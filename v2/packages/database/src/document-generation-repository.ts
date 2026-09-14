import type {
  CandidateDocument,
  DocumentGenerationRepository,
  DocumentLifecycleStatus,
  DocumentPurpose
} from "@job-hunter-v2/onboarding";
import { IdempotencyConflictError, NotFoundError } from "@job-hunter-v2/domain";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

interface DocumentRow {
  id: string; candidate_id: string; purpose: DocumentPurpose; document_version: number;
  status: DocumentLifecycleStatus; original_file_name: string | null; mime_type: string;
  byte_size: string | number; content_sha256: string; source_document_id: string | null;
  job_id: string | null; application_id: string | null; generation_policy_version: number | null;
  failure_code: string | null; created_at: Date | string; updated_at: Date | string;
  ready_at: Date | string | null;
}

function documentFrom(row: DocumentRow): CandidateDocument {
  return {
    documentId: row.id, candidateId: row.candidate_id, purpose: row.purpose,
    documentVersion: Number(row.document_version), status: row.status,
    originalFileName: row.original_file_name, mimeType: row.mime_type,
    byteSize: Number(row.byte_size), contentSha256: row.content_sha256,
    sourceDocumentId: row.source_document_id, jobId: row.job_id,
    applicationId: row.application_id,
    generationPolicyVersion: row.generation_policy_version === null ? null : Number(row.generation_policy_version),
    failureCode: row.failure_code,
    isCurrentMaster: row.purpose === "MASTER_RESUME" && row.status === "READY",
    createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
    readyAt: row.ready_at ? new Date(row.ready_at) : null, applicationUses: []
  };
}

const columns = sql.raw(`
  id, candidate_id, purpose, document_version, status, original_file_name,
  mime_type, byte_size, content_sha256, source_document_id, job_id,
  application_id, generation_policy_version, failure_code, created_at,
  updated_at, ready_at
`);

export class KyselyDocumentGenerationRepository implements DocumentGenerationRepository {
  constructor(private readonly database: Kysely<V2Database>) {}

  async editableSource(input: { accountId: string; candidateId: string; documentId: string }) {
    const result = await sql<{ objectKey: string; jobId: string; applicationId: string | null; purpose: "TAILORED_RESUME" | "COVER_LETTER" }>`
      SELECT object_key AS "objectKey",job_id AS "jobId",application_id AS "applicationId",purpose
      FROM documents WHERE id=${input.documentId} AND account_id=${input.accountId} AND candidate_id=${input.candidateId}
        AND purpose IN ('TAILORED_RESUME','COVER_LETTER') AND status IN ('RECONCILING','READY') AND job_id IS NOT NULL
    `.execute(this.database);
    return result.rows[0] ?? null;
  }

  async begin(input: Parameters<DocumentGenerationRepository["begin"]>[0]) {
    return this.database.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`document-generate:${input.candidateId}:${input.idempotencyKey}`}))`.execute(transaction);
      const receipt = await sql<{ request_fingerprint: string; id: string; output_document_id: string | null }>`
        SELECT request_fingerprint, id, output_document_id
        FROM document_generation_runs
        WHERE candidate_id = ${input.candidateId} AND idempotency_key = ${input.idempotencyKey}
      `.execute(transaction);
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_fingerprint !== input.requestFingerprint) {
          throw new IdempotencyConflictError("Document generation key was reused for another request.");
        }
        const replay = receipt.rows[0].output_document_id
          ? await sql<DocumentRow>`SELECT ${columns} FROM documents WHERE id = ${receipt.rows[0].output_document_id}`.execute(transaction)
          : { rows: [] as DocumentRow[] };
        return { runId: receipt.rows[0].id, idempotentReplay: true, document: replay.rows[0] ? documentFrom(replay.rows[0]) : null };
      }
      const source = await sql<{ id: string }>`
        SELECT document.id FROM documents document
        JOIN candidates candidate ON candidate.id = document.candidate_id
        WHERE document.id = ${input.sourceDocumentId}
          AND document.account_id = ${input.accountId}
          AND document.candidate_id = ${input.candidateId}
          AND document.purpose = 'MASTER_RESUME' AND document.status = 'READY'
          AND candidate.account_id = ${input.accountId} AND candidate.status = 'ACTIVE'
        FOR UPDATE
      `.execute(transaction);
      if (!source.rows[0]) throw new NotFoundError("A ready master resume is required.");
      const job = await sql<{ id: string }>`SELECT id FROM jobs WHERE id = ${input.jobId} AND status IN ('ACTIVE', 'STALE')`.execute(transaction);
      if (!job.rows[0]) throw new NotFoundError("Job was not found for document generation.");
      if (input.applicationId) {
        const application = await sql<{ id: string }>`
          SELECT id FROM applications WHERE id = ${input.applicationId}
            AND account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
            AND job_id = ${input.jobId}
        `.execute(transaction);
        if (!application.rows[0]) throw new NotFoundError("Application was not found for document generation.");
      }
      await sql`
        INSERT INTO document_generation_runs (
          id, account_id, candidate_id, source_document_id, job_id, application_id,
          document_purpose, status, generator, generator_version,
          generation_policy_version, idempotency_key, request_fingerprint, created_at
        ) VALUES (
          ${input.runId}, ${input.accountId}, ${input.candidateId}, ${input.sourceDocumentId},
          ${input.jobId}, ${input.applicationId}, ${input.purpose}, 'PROCESSING',
          ${input.generator}, ${input.generatorVersion}, ${input.generationPolicyVersion},
          ${input.idempotencyKey}, ${input.requestFingerprint}, ${input.createdAt}
        )
      `.execute(transaction);
      return { runId: input.runId, idempotentReplay: false, document: null };
    });
  }

  async complete(input: Parameters<DocumentGenerationRepository["complete"]>[0]): Promise<CandidateDocument> {
    return this.database.transaction().execute(async (transaction) => {
      const run = await sql<{
        source_document_id: string; job_id: string; application_id: string | null;
        document_purpose: "TAILORED_RESUME" | "COVER_LETTER"; generation_policy_version: number;
        status: string; output_document_id: string | null;
      }>`
        SELECT source_document_id, job_id, application_id, document_purpose,
               generation_policy_version, status, output_document_id
        FROM document_generation_runs
        WHERE id = ${input.runId} AND account_id = ${input.accountId}
          AND candidate_id = ${input.candidateId}
        FOR UPDATE
      `.execute(transaction);
      if (!run.rows[0]) throw new NotFoundError("Document generation run was not found.");
      if (run.rows[0].status !== "PROCESSING") {
        const existing = run.rows[0].output_document_id
          ? await sql<DocumentRow>`SELECT ${columns} FROM documents WHERE id = ${run.rows[0].output_document_id}`.execute(transaction)
          : { rows: [] as DocumentRow[] };
        if (!existing.rows[0]) throw new IdempotencyConflictError("Document generation run is already closed.");
        return documentFrom(existing.rows[0]);
      }
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`document-version:${input.candidateId}:${run.rows[0].document_purpose}`}))`.execute(transaction);
      const version = await sql<{ next_version: number }>`
        SELECT coalesce(max(document_version), 0)::integer + 1 AS next_version
        FROM documents WHERE candidate_id = ${input.candidateId} AND purpose = ${run.rows[0].document_purpose}
      `.execute(transaction);
      await sql`
        INSERT INTO documents (
          id, account_id, candidate_id, object_key, original_file_name, content_sha256,
          byte_size, mime_type, purpose, status, metadata, created_at, updated_at,
          document_version, source_document_id, job_id, application_id, generation_policy_version
        ) VALUES (
          ${input.documentId}, ${input.accountId}, ${input.candidateId}, ${input.objectKey},
          ${input.fileName}, ${input.contentSha256}, ${input.byteSize}, 'application/pdf',
          ${run.rows[0].document_purpose}, 'RECONCILING', ${JSON.stringify({ source: "GROUNDED_GENERATION" })}::jsonb,
          ${input.completedAt}, ${input.completedAt}, ${version.rows[0]?.next_version ?? 1},
          ${run.rows[0].source_document_id}, ${run.rows[0].job_id}, ${run.rows[0].application_id},
          ${run.rows[0].generation_policy_version}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO document_lifecycle_events (
          id, account_id, candidate_id, document_id, sequence, from_status,
          to_status, reason_code, created_at
        ) VALUES (
          gen_random_uuid(), ${input.accountId}, ${input.candidateId}, ${input.documentId}, 1,
          NULL, 'RECONCILING', 'GENERATION_REVIEW_REQUIRED', ${input.completedAt}
        )
      `.execute(transaction);
      await sql`
        UPDATE document_generation_runs
        SET status = 'REVIEW_REQUIRED', output_document_id = ${input.documentId},
            claim_manifest = ${JSON.stringify(input.claimManifest)}::jsonb,
            completed_at = ${input.completedAt}
        WHERE id = ${input.runId}
      `.execute(transaction);
      const stored = await sql<DocumentRow>`SELECT ${columns} FROM documents WHERE id = ${input.documentId}`.execute(transaction);
      if (!stored.rows[0]) throw new Error("Generated document was not persisted.");
      return documentFrom(stored.rows[0]);
    });
  }

  async fail(input: Parameters<DocumentGenerationRepository["fail"]>[0]): Promise<void> {
    await sql`
      UPDATE document_generation_runs SET status = 'FAILED', error_code = ${input.errorCode}, completed_at = ${input.failedAt}
      WHERE id = ${input.runId} AND account_id = ${input.accountId}
        AND candidate_id = ${input.candidateId} AND status = 'PROCESSING'
    `.execute(this.database);
  }

  async approve(input: Parameters<DocumentGenerationRepository["approve"]>[0]) {
    return this.database.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`document-approve:${input.candidateId}:${input.documentId}`}))`.execute(transaction);
      const replay = await sql<{ request_fingerprint: string }>`
        SELECT request_fingerprint FROM document_approval_receipts
        WHERE candidate_id = ${input.candidateId} AND idempotency_key = ${input.idempotencyKey}
      `.execute(transaction);
      if (replay.rows[0] && replay.rows[0].request_fingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError("Document approval key was reused for another document.");
      }
      const document = await sql<DocumentRow>`
        SELECT ${columns} FROM documents
        WHERE id = ${input.documentId} AND account_id = ${input.accountId}
          AND candidate_id = ${input.candidateId}
          AND purpose IN ('TAILORED_RESUME', 'COVER_LETTER')
          AND status IN ('RECONCILING', 'READY')
        FOR UPDATE
      `.execute(transaction);
      if (!document.rows[0]) throw new NotFoundError("Generated document was not found for approval.");
      if (!replay.rows[0]) {
        await sql`
          INSERT INTO document_approval_receipts (
            id, account_id, candidate_id, document_id, idempotency_key,
            request_fingerprint, approved_at
          ) VALUES (
            ${input.receiptId}, ${input.accountId}, ${input.candidateId}, ${input.documentId},
            ${input.idempotencyKey}, ${input.requestFingerprint}, ${input.approvedAt}
          )
        `.execute(transaction);
      }
      if (document.rows[0].status === "RECONCILING") {
        await sql`
          UPDATE documents SET status = 'READY', ready_at = ${input.approvedAt}, updated_at = ${input.approvedAt}
          WHERE id = ${input.documentId}
        `.execute(transaction);
        await sql`
          UPDATE document_generation_runs SET status = 'APPROVED'
          WHERE output_document_id = ${input.documentId} AND status = 'REVIEW_REQUIRED'
        `.execute(transaction);
        await sql`
          INSERT INTO document_lifecycle_events (
            id, account_id, candidate_id, document_id, sequence, from_status,
            to_status, reason_code, created_at
          ) SELECT gen_random_uuid(), ${input.accountId}, ${input.candidateId}, ${input.documentId},
                   coalesce(max(sequence), 0) + 1, 'RECONCILING', 'READY',
                   'CANDIDATE_APPROVED_GENERATED_DOCUMENT', ${input.approvedAt}
            FROM document_lifecycle_events WHERE document_id = ${input.documentId}
        `.execute(transaction);
      }
      const ready = await sql<DocumentRow>`SELECT ${columns} FROM documents WHERE id = ${input.documentId}`.execute(transaction);
      if (!ready.rows[0]) throw new Error("Approved document was not persisted.");
      return { document: documentFrom(ready.rows[0]), idempotentReplay: Boolean(replay.rows[0]) };
    });
  }
}

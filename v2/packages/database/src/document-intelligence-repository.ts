import type {
  CandidateDocument,
  CandidateDocumentRepository,
  DocumentApplicationUse,
  DocumentLifecycleStatus,
  DocumentPurpose,
  StoredCandidateDocument
} from "@job-hunter-v2/onboarding";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

interface DocumentRow {
  id: string;
  account_id: string;
  candidate_id: string;
  object_key: string;
  purpose: DocumentPurpose;
  document_version: number;
  status: DocumentLifecycleStatus;
  original_file_name: string | null;
  mime_type: string;
  byte_size: string | number;
  content_sha256: string;
  source_document_id: string | null;
  job_id: string | null;
  application_id: string | null;
  generation_policy_version: number | null;
  failure_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  ready_at: Date | string | null;
}

interface UseRow {
  document_id: string;
  application_id: string;
  run_id: string;
  document_kind: DocumentApplicationUse["documentKind"];
  created_at: Date | string;
}

function publicDocument(row: DocumentRow, uses: readonly DocumentApplicationUse[]): CandidateDocument {
  return {
    documentId: row.id,
    candidateId: row.candidate_id,
    purpose: row.purpose,
    documentVersion: Number(row.document_version),
    status: row.status,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    contentSha256: row.content_sha256,
    sourceDocumentId: row.source_document_id,
    jobId: row.job_id,
    applicationId: row.application_id,
    generationPolicyVersion: row.generation_policy_version === null ? null : Number(row.generation_policy_version),
    failureCode: row.failure_code,
    isCurrentMaster: row.purpose === "MASTER_RESUME" && row.status === "READY",
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    readyAt: row.ready_at ? new Date(row.ready_at) : null,
    applicationUses: uses
  };
}

const documentColumns = sql.raw(`
  document.id, document.account_id, document.candidate_id, document.object_key,
  document.purpose, document.document_version, document.status,
  document.original_file_name, document.mime_type, document.byte_size,
  document.content_sha256, document.source_document_id, document.job_id,
  document.application_id, document.generation_policy_version, document.failure_code,
  document.created_at, document.updated_at, document.ready_at
`);

export class KyselyDocumentIntelligenceRepository implements CandidateDocumentRepository {
  constructor(private readonly database: Kysely<V2Database>) {}

  async list(input: { accountId: string; candidateId: string }): Promise<readonly CandidateDocument[]> {
    const documents = await sql<DocumentRow>`
      SELECT ${documentColumns}
      FROM documents document
      JOIN candidates candidate ON candidate.id = document.candidate_id
      WHERE document.account_id = ${input.accountId}
        AND document.candidate_id = ${input.candidateId}
        AND candidate.account_id = ${input.accountId}
        AND document.status <> 'DELETED'
      ORDER BY document.created_at DESC, document.document_version DESC
    `.execute(this.database);
    const useRows = await sql<UseRow>`
      SELECT selection.document_id, selection.application_id, selection.run_id,
             selection.document_kind, selection.created_at
      FROM application_document_selections selection
      WHERE selection.account_id = ${input.accountId}
        AND selection.candidate_id = ${input.candidateId}
      ORDER BY selection.created_at DESC
    `.execute(this.database);
    const uses = new Map<string, DocumentApplicationUse[]>();
    for (const row of useRows.rows) {
      const list = uses.get(row.document_id) ?? [];
      list.push({ applicationId: row.application_id, applicationRunId: row.run_id, documentKind: row.document_kind, selectedAt: new Date(row.created_at) });
      uses.set(row.document_id, list);
    }
    return documents.rows.map((row) => publicDocument(row, uses.get(row.id) ?? []));
  }

  async find(input: { accountId: string; candidateId: string; documentId: string }): Promise<StoredCandidateDocument | null> {
    const result = await sql<DocumentRow>`
      SELECT ${documentColumns}
      FROM documents document
      JOIN candidates candidate ON candidate.id = document.candidate_id
      WHERE document.id = ${input.documentId}
        AND document.account_id = ${input.accountId}
        AND document.candidate_id = ${input.candidateId}
        AND candidate.account_id = ${input.accountId}
        AND document.status <> 'DELETED'
      LIMIT 1
    `.execute(this.database);
    const row = result.rows[0];
    if (!row) return null;
    const useRows = await sql<UseRow>`
      SELECT document_id, application_id, run_id, document_kind, created_at
      FROM application_document_selections
      WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
        AND document_id = ${input.documentId}
      ORDER BY created_at DESC
    `.execute(this.database);
    return {
      ...publicDocument(row, useRows.rows.map((use) => ({
        applicationId: use.application_id, applicationRunId: use.run_id,
        documentKind: use.document_kind, selectedAt: new Date(use.created_at)
      }))),
      accountId: row.account_id,
      objectKey: row.object_key
    };
  }
}

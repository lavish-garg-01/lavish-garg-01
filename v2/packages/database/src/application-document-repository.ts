import type {
  ApplicationDocumentRepository,
  ApplicationDocumentSelection,
  ApplicationDocumentKind
} from "@job-hunter-v2/onboarding";
import { IdempotencyConflictError, ValidationError } from "@job-hunter-v2/domain";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

interface SelectionRow {
  selection_id: string;
  document_id: string;
  document_kind: ApplicationDocumentKind;
  original_file_name: string;
  mime_type: ApplicationDocumentSelection["mimeType"];
  byte_size: string | number;
  content_sha256: string;
  object_key: string;
  selection_source: ApplicationDocumentSelection["selectionSource"];
}

function selection(row: SelectionRow, idempotentReplay: boolean): ApplicationDocumentSelection {
  return {
    selectionId: row.selection_id,
    documentId: row.document_id,
    documentKind: row.document_kind,
    fileName: row.original_file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    contentSha256: row.content_sha256,
    objectKey: row.object_key,
    selectionSource: row.selection_source,
    idempotentReplay
  };
}

const selectedColumns = sql.raw(`
  document_selection.id AS selection_id, document_selection.document_id,
  document_selection.document_kind, document.original_file_name,
  document.mime_type, document.byte_size, document.content_sha256,
  document.object_key, document_selection.selection_source
`);

export class KyselyApplicationDocumentRepository implements ApplicationDocumentRepository {
  constructor(private readonly database: Kysely<V2Database>) {}

  async resolve(input: Parameters<ApplicationDocumentRepository["resolve"]>[0]) {
    return this.database.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`document-selection:${input.applicationRunId}:${input.documentKind}`}))`.execute(transaction);
      const existing = await sql<SelectionRow>`
        SELECT ${selectedColumns}
        FROM application_document_selections document_selection
        JOIN documents document ON document.id = document_selection.document_id
        WHERE document_selection.run_id = ${input.applicationRunId}
          AND document_selection.document_kind = ${input.documentKind}
          AND document_selection.account_id = ${input.accountId}
          AND document_selection.candidate_id = ${input.candidateId}
      `.execute(transaction);
      if (existing.rows[0]) return selection(existing.rows[0], true);

      const runtime = await sql<{ job_id: string | null }>`
        SELECT application.job_id
        FROM applications application
        JOIN application_runs run ON run.application_id = application.id
        JOIN candidates candidate ON candidate.id = application.candidate_id
        WHERE application.id = ${input.applicationId}
          AND run.id = ${input.applicationRunId}
          AND application.account_id = ${input.accountId}
          AND application.candidate_id = ${input.candidateId}
          AND candidate.account_id = ${input.accountId}
          AND application.status IN ('IN_PROGRESS', 'REVIEW')
          AND run.status = 'ACTIVE'
        FOR UPDATE OF application, run
      `.execute(transaction);
      if (!runtime.rows[0]) throw new ValidationError("The application document request is stale or foreign.", { reasonCode: "DOCUMENT_OWNERSHIP_INVALID" });
      if (runtime.rows[0].job_id !== input.jobId) throw new ValidationError("The application job changed before document selection.", { reasonCode: "DOCUMENT_CONTEXT_STALE" });

      let picked: { id: string; source: ApplicationDocumentSelection["selectionSource"] } | null = null;
      if (input.documentKind === "RESUME" && input.jobId) {
        const tailored = await sql<{ id: string }>`
          SELECT id FROM documents
          WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
            AND purpose = 'TAILORED_RESUME' AND status = 'READY'
            AND job_id = ${input.jobId}
            AND (application_id IS NULL OR application_id = ${input.applicationId})
          ORDER BY (application_id = ${input.applicationId}) DESC NULLS LAST, document_version DESC, created_at DESC
          LIMIT 1
        `.execute(transaction);
        if (tailored.rows[0]) picked = { id: tailored.rows[0].id, source: "TAILORED" };
      }
      if (input.documentKind === "RESUME" && !picked) {
        const master = await sql<{ id: string }>`
          SELECT id FROM documents
          WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
            AND purpose = 'MASTER_RESUME' AND status = 'READY'
          ORDER BY document_version DESC, ready_at DESC
          LIMIT 1
        `.execute(transaction);
        if (master.rows[0]) picked = { id: master.rows[0].id, source: "MASTER" };
      }
      if (input.documentKind === "COVER_LETTER" && input.jobId) {
        const cover = await sql<{ id: string }>`
          SELECT id FROM documents
          WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
            AND purpose = 'COVER_LETTER' AND status = 'READY'
            AND job_id = ${input.jobId}
            AND (application_id IS NULL OR application_id = ${input.applicationId})
          ORDER BY (application_id = ${input.applicationId}) DESC NULLS LAST, document_version DESC, created_at DESC
          LIMIT 1
        `.execute(transaction);
        if (cover.rows[0]) picked = { id: cover.rows[0].id, source: "APPROVED_COVER_LETTER" };
      }
      if (!picked) return null;
      await sql`
        INSERT INTO application_document_selections (
          id, account_id, candidate_id, application_id, run_id,
          document_kind, document_id, selection_source, created_at
        ) VALUES (
          ${input.selectionId}, ${input.accountId}, ${input.candidateId},
          ${input.applicationId}, ${input.applicationRunId}, ${input.documentKind},
          ${picked.id}, ${picked.source}, ${input.selectedAt}
        )
      `.execute(transaction);
      const saved = await sql<SelectionRow>`
        SELECT ${selectedColumns}
        FROM application_document_selections document_selection
        JOIN documents document ON document.id = document_selection.document_id
        WHERE document_selection.id = ${input.selectionId}
      `.execute(transaction);
      if (!saved.rows[0]) throw new Error("Application document selection was not persisted.");
      return selection(saved.rows[0], false);
    });
  }

  async recordUpload(input: Parameters<ApplicationDocumentRepository["recordUpload"]>[0]) {
    return this.database.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`document-upload:${input.applicationRunId}:${input.operationId}`}))`.execute(transaction);
      const replay = await sql<{ id: string; request_fingerprint: string }>`
        SELECT id, request_fingerprint FROM application_document_upload_evidence
        WHERE run_id = ${input.applicationRunId} AND operation_id = ${input.operationId}
      `.execute(transaction);
      if (replay.rows[0]) {
        if (replay.rows[0].request_fingerprint !== input.requestFingerprint) {
          throw new IdempotencyConflictError("Document upload evidence changed during replay.");
        }
        return { evidenceId: replay.rows[0].id, idempotentReplay: true };
      }
      const authority = await sql<{ id: string }>`
        SELECT document_selection.id
        FROM application_document_selections document_selection
        JOIN applications application ON application.id = document_selection.application_id
        JOIN application_runs run ON run.id = document_selection.run_id AND run.application_id = application.id
        JOIN documents document ON document.id = document_selection.document_id
        WHERE document_selection.id = ${input.selectionId}
          AND document_selection.document_id = ${input.documentId}
          AND document_selection.application_id = ${input.applicationId}
          AND document_selection.run_id = ${input.applicationRunId}
          AND document_selection.account_id = ${input.accountId}
          AND document_selection.candidate_id = ${input.candidateId}
          AND application.account_id = ${input.accountId}
          AND application.candidate_id = ${input.candidateId}
          AND document.account_id = ${input.accountId}
          AND document.candidate_id = ${input.candidateId}
      `.execute(transaction);
      if (!authority.rows[0]) throw new ValidationError("Document upload evidence lacks an exact application selection.", { reasonCode: "DOCUMENT_OWNERSHIP_INVALID" });
      await sql`
        INSERT INTO application_document_upload_evidence (
          id, account_id, candidate_id, application_id, run_id, selection_id,
          document_id, operation_id, field_key, outcome, reason_code,
          observed_file_count, request_fingerprint, observed_at
        ) VALUES (
          ${input.evidenceId}, ${input.accountId}, ${input.candidateId}, ${input.applicationId},
          ${input.applicationRunId}, ${input.selectionId}, ${input.documentId}, ${input.operationId},
          ${input.fieldKey}, ${input.outcome}, ${input.reasonCode}, ${input.observedFileCount},
          ${input.requestFingerprint}, ${input.observedAt}
        )
      `.execute(transaction);
      return { evidenceId: input.evidenceId, idempotentReplay: false };
    });
  }
}

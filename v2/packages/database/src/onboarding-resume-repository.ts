import { resumeEntityAnchorMatches } from "@job-hunter-v2/onboarding";
import type {
  EncryptedCandidatePayload,
  ResumeDocument,
  DocumentLifecycleStatus,
  ResumeExtraction,
  ResumeProposal,
  ResumeRepository,
  ResumeRegistration,
  ResumeSourceSection
} from "@job-hunter-v2/onboarding";
import { PersistableNormalizedValueSchema, type PersistableNormalizedValue } from "@job-hunter-v2/candidate-truth";
import { IdempotencyConflictError, NotFoundError } from "@job-hunter-v2/domain";
import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

interface DocumentRow {
  id: string;
  account_id: string;
  candidate_id: string;
  object_key: string;
  original_file_name: string;
  content_sha256: string;
  byte_size: string | number;
  mime_type: "application/pdf";
  purpose: "MASTER_RESUME";
  status: DocumentLifecycleStatus;
  document_version: number;
  source_document_id: string | null;
  failure_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  ready_at: Date | string | null;
}

interface ExtractionRow {
  id: string;
  document_id: string;
  status: ResumeExtraction["status"];
  attempt: number;
  extractor: string;
  extractor_version: string;
  error_code: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
}

interface ProposalRow {
  id: string;
  extraction_id: string;
  item_key: string;
  canonical_key: string;
  entity_type: ResumeProposal["entityType"];
  entity_group_key: string | null;
  confidence: string | number;
  comparison: ResumeProposal["comparison"];
  decision: ResumeProposal["decision"];
  existing_answer_version_id: string | null;
  matched_entity_id: string | null;
  reason_codes: string[];
  source_section: ResumeSourceSection;
  evidence_sha256: string;
  extraction_schema_version: number;
  payload_key_version: number;
  payload_iv: Uint8Array;
  payload_auth_tag: Uint8Array;
  encrypted_payload: Uint8Array;
}

function storedAnchorValue(row: { value_type: string; text_value: string | null; structured_value: unknown }): PersistableNormalizedValue | null {
  const common = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };
  if ((row.value_type === "STRING" || row.value_type === "URL") && row.text_value !== null) {
    return PersistableNormalizedValueSchema.parse({ ...common, kind: row.value_type, value: row.text_value });
  }
  if (row.value_type === "DATE_RANGE" && row.structured_value) {
    return PersistableNormalizedValueSchema.parse(
      typeof row.structured_value === "string" ? JSON.parse(row.structured_value) : row.structured_value
    );
  }
  return null;
}

function documentFrom(row: DocumentRow): ResumeDocument {
  return {
    documentId: row.id,
    accountId: row.account_id,
    candidateId: row.candidate_id,
    objectKey: row.object_key,
    originalFileName: row.original_file_name,
    contentSha256: row.content_sha256,
    byteSize: Number(row.byte_size),
    mimeType: row.mime_type,
    purpose: row.purpose,
    status: row.status,
    documentVersion: Number(row.document_version),
    sourceDocumentId: row.source_document_id,
    failureCode: row.failure_code,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    readyAt: row.ready_at ? new Date(row.ready_at) : null
  };
}

function extractionFrom(row: ExtractionRow): ResumeExtraction {
  return {
    extractionId: row.id,
    documentId: row.document_id,
    status: row.status,
    attempt: Number(row.attempt),
    extractor: row.extractor,
    extractorVersion: row.extractor_version,
    errorCode: row.error_code,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    idempotentReplay: true
  };
}

function encrypted(row: ProposalRow): EncryptedCandidatePayload {
  return {
    keyVersion: Number(row.payload_key_version),
    initializationVector: new Uint8Array(row.payload_iv),
    authenticationTag: new Uint8Array(row.payload_auth_tag),
    ciphertext: new Uint8Array(row.encrypted_payload)
  };
}

async function ownedDocument(
  database: Kysely<V2Database>,
  input: { accountId: string; candidateId: string; documentId?: string }
): Promise<DocumentRow> {
  const result = await sql<DocumentRow>`
    SELECT document.id, document.account_id, document.candidate_id, document.object_key,
           document.original_file_name, document.content_sha256, document.byte_size,
           document.mime_type, document.purpose, document.status, document.document_version,
           document.source_document_id, document.failure_code, document.created_at,
           document.updated_at, document.ready_at
    FROM documents document
    JOIN candidates candidate
      ON candidate.id = document.candidate_id AND candidate.account_id = document.account_id
    WHERE document.account_id = ${input.accountId}
      AND document.candidate_id = ${input.candidateId}
      AND document.purpose = 'MASTER_RESUME'
      AND document.status ${input.documentId
        ? sql`<> 'DELETED'`
        : sql`IN ('UPLOADED', 'EXTRACTING', 'EXTRACTED', 'RECONCILING', 'FAILED', 'READY')`}
      ${input.documentId ? sql`AND document.id = ${input.documentId}` : sql``}
    ORDER BY document.document_version DESC, document.created_at DESC
    LIMIT 1
  `.execute(database);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Resume was not found for this candidate.");
  return row;
}

export class KyselyResumeRepository implements ResumeRepository {
  constructor(
    private readonly database: Kysely<V2Database>,
    private readonly newId: () => string = randomUUID
  ) {}

  async registerResume(input: Parameters<ResumeRepository["registerResume"]>[0]): Promise<ResumeRegistration> {
    return this.database.transaction().execute(async (transaction) => {
      const candidate = await sql<{ id: string }>`
        SELECT candidate.id
        FROM candidates candidate
        JOIN accounts account ON account.id = candidate.account_id
        WHERE candidate.id = ${input.candidateId}
          AND candidate.account_id = ${input.accountId}
          AND candidate.status = 'ACTIVE'
          AND account.status = 'ACTIVE'
        FOR UPDATE
      `.execute(transaction);
      if (!candidate.rows[0]) throw new NotFoundError("Active candidate was not found for this account.");

      const receipt = await sql<{ request_fingerprint: string; document_id: string }>`
        SELECT request_fingerprint, document_id
        FROM resume_upload_receipts
        WHERE candidate_id = ${input.candidateId} AND idempotency_key = ${input.idempotencyKey}
      `.execute(transaction);
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_fingerprint !== input.requestFingerprint) {
          throw new IdempotencyConflictError("Resume upload idempotency key was reused for another file.");
        }
        const replay = await sql<DocumentRow>`
          SELECT id, account_id, candidate_id, object_key, original_file_name, content_sha256,
                 byte_size, mime_type, purpose, status, document_version, source_document_id,
                 failure_code, created_at, updated_at, ready_at
          FROM documents WHERE id = ${receipt.rows[0].document_id}
        `.execute(transaction);
        if (!replay.rows[0]) throw new Error("Resume upload receipt is missing its document.");
        return { document: documentFrom(replay.rows[0]), retiredObjectKey: null };
      }

      const duplicate = await sql<DocumentRow>`
        SELECT id, account_id, candidate_id, object_key, original_file_name, content_sha256,
               byte_size, mime_type, purpose, status, document_version, source_document_id,
               failure_code, created_at, updated_at, ready_at
        FROM documents
        WHERE candidate_id = ${input.candidateId}
          AND account_id = ${input.accountId}
          AND purpose = 'MASTER_RESUME'
          AND content_sha256 = ${input.contentSha256}
          AND status <> 'DELETED'
        ORDER BY document_version DESC
        LIMIT 1
      `.execute(transaction);
      if (duplicate.rows[0]) {
        await sql`
          INSERT INTO resume_upload_receipts (
            id, account_id, candidate_id, document_id, idempotency_key, request_fingerprint, created_at
          ) VALUES (
            ${this.newId()}, ${input.accountId}, ${input.candidateId}, ${duplicate.rows[0].id},
            ${input.idempotencyKey}, ${input.requestFingerprint}, ${input.createdAt}
          )
        `.execute(transaction);
        return { document: documentFrom(duplicate.rows[0]), retiredObjectKey: input.objectKey };
      }
      const current = await sql<{ id: string }>`
        SELECT id FROM documents
        WHERE candidate_id = ${input.candidateId}
          AND purpose = 'MASTER_RESUME' AND status = 'READY'
        LIMIT 1
      `.execute(transaction);
      const version = await sql<{ next_version: number }>`
        SELECT coalesce(max(document_version), 0)::integer + 1 AS next_version
        FROM documents
        WHERE candidate_id = ${input.candidateId} AND purpose = 'MASTER_RESUME'
      `.execute(transaction);
      await sql`
        INSERT INTO documents (
          id, account_id, candidate_id, object_key, original_file_name, content_sha256,
          byte_size, mime_type, purpose, status, document_version, source_document_id,
          metadata, created_at, updated_at
        ) VALUES (
          ${input.documentId}, ${input.accountId}, ${input.candidateId}, ${input.objectKey},
          ${input.originalFileName}, ${input.contentSha256}, ${input.byteSize}, ${input.mimeType},
          'MASTER_RESUME', 'UPLOADED', ${version.rows[0]?.next_version ?? 1},
          ${current.rows[0]?.id ?? null},
          ${JSON.stringify({ source: "ONBOARDING" })}::jsonb, ${input.createdAt}, ${input.createdAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO document_lifecycle_events (
          id, account_id, candidate_id, document_id, sequence, from_status,
          to_status, reason_code, created_at
        ) VALUES (
          ${this.newId()}, ${input.accountId}, ${input.candidateId}, ${input.documentId}, 1,
          NULL, 'UPLOADED', 'CANDIDATE_UPLOAD_ACCEPTED', ${input.createdAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO resume_upload_receipts (
          id, account_id, candidate_id, document_id, idempotency_key, request_fingerprint, created_at
        ) VALUES (
          ${this.newId()}, ${input.accountId}, ${input.candidateId}, ${input.documentId},
          ${input.idempotencyKey}, ${input.requestFingerprint}, ${input.createdAt}
        )
      `.execute(transaction);
      await sql`
        UPDATE candidate_onboarding_states
        SET stage = CASE WHEN stage = 'WELCOME' THEN 'RESUME' ELSE stage END,
            version = version + 1,
            last_seen_at = ${input.createdAt}
        WHERE candidate_id = ${input.candidateId} AND account_id = ${input.accountId}
      `.execute(transaction);
      return {
        document: documentFrom({
          id: input.documentId, account_id: input.accountId, candidate_id: input.candidateId,
          object_key: input.objectKey, original_file_name: input.originalFileName,
          content_sha256: input.contentSha256, byte_size: input.byteSize,
          mime_type: input.mimeType, purpose: "MASTER_RESUME", status: "UPLOADED",
          document_version: version.rows[0]?.next_version ?? 1,
          source_document_id: current.rows[0]?.id ?? null, failure_code: null,
          created_at: input.createdAt, updated_at: input.createdAt, ready_at: null
        }),
        retiredObjectKey: null
      };
    });
  }

  async beginExtraction(input: Parameters<ResumeRepository["beginExtraction"]>[0]): Promise<ResumeExtraction> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`resume-extract:${input.candidateId}:${input.documentId}`}))`.execute(transaction);
      const document = await sql<{ id: string; status: DocumentLifecycleStatus }>`
        SELECT document.id, document.status
        FROM documents document
        JOIN candidates candidate ON candidate.id = document.candidate_id
        WHERE document.id = ${input.documentId}
          AND document.candidate_id = ${input.candidateId}
          AND document.account_id = ${input.accountId}
          AND candidate.account_id = ${input.accountId}
          AND document.status IN ('UPLOADED', 'EXTRACTING', 'EXTRACTED', 'RECONCILING', 'FAILED', 'READY')
      `.execute(transaction);
      if (!document.rows[0]) throw new NotFoundError("Resume was not found for this candidate.");
      const existing = await sql<ExtractionRow & { request_fingerprint: string }>`
        SELECT id, document_id, status, attempt, extractor, extractor_version, error_code,
               started_at, completed_at, request_fingerprint
        FROM resume_extraction_runs
        WHERE candidate_id = ${input.candidateId} AND idempotency_key = ${input.idempotencyKey}
      `.execute(transaction);
      if (existing.rows[0]) {
        if (existing.rows[0].request_fingerprint !== input.requestFingerprint) {
          throw new IdempotencyConflictError("Resume extraction idempotency key was reused for another request.");
        }
        return extractionFrom(existing.rows[0]);
      }
      const reusable = await sql<ExtractionRow>`
        SELECT id, document_id, status, attempt, extractor, extractor_version, error_code,
               started_at, completed_at
        FROM resume_extraction_runs
        WHERE candidate_id = ${input.candidateId}
          AND account_id = ${input.accountId}
          AND document_id = ${input.documentId}
          AND extractor = ${input.extractor}
          AND extractor_version = ${input.extractorVersion}
          AND status IN ('PROCESSING', 'COMPLETED', 'PARTIAL')
        ORDER BY attempt DESC, started_at DESC
        LIMIT 1
      `.execute(transaction);
      if (reusable.rows[0]) return extractionFrom(reusable.rows[0]);
      const attempt = await sql<{ attempt: number }>`
        SELECT coalesce(max(attempt), 0)::integer + 1 AS attempt
        FROM resume_extraction_runs
        WHERE candidate_id = ${input.candidateId} AND document_id = ${input.documentId}
      `.execute(transaction);
      await sql`
        INSERT INTO resume_extraction_runs (
          id, account_id, candidate_id, document_id, status, attempt, extractor,
          extractor_version, idempotency_key, request_fingerprint, started_at
        ) VALUES (
          ${input.extractionId}, ${input.accountId}, ${input.candidateId}, ${input.documentId},
          'PROCESSING', ${attempt.rows[0]?.attempt ?? 1}, ${input.extractor}, ${input.extractorVersion},
          ${input.idempotencyKey}, ${input.requestFingerprint}, ${input.startedAt}
        )
      `.execute(transaction);
      if (document.rows[0].status !== "READY") {
        await sql`
          UPDATE documents
          SET status = 'EXTRACTING', failure_code = NULL, updated_at = ${input.startedAt}
          WHERE id = ${input.documentId}
        `.execute(transaction);
        await sql`
          INSERT INTO document_lifecycle_events (
            id, account_id, candidate_id, document_id, sequence, from_status,
            to_status, reason_code, created_at
          ) SELECT ${this.newId()}, ${input.accountId}, ${input.candidateId}, ${input.documentId},
                   coalesce(max(sequence), 0) + 1, ${document.rows[0].status}, 'EXTRACTING',
                   'EXTRACTION_STARTED', ${input.startedAt}
            FROM document_lifecycle_events WHERE document_id = ${input.documentId}
        `.execute(transaction);
      }
      return {
        extractionId: input.extractionId, documentId: input.documentId, status: "PROCESSING",
        attempt: attempt.rows[0]?.attempt ?? 1, extractor: input.extractor,
        extractorVersion: input.extractorVersion, errorCode: null,
        startedAt: input.startedAt, completedAt: null,
        idempotentReplay: false
      };
    });
  }

  async completeExtraction(input: Parameters<ResumeRepository["completeExtraction"]>[0]): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const run = await sql<{
        document_id: string;
        status: ResumeExtraction["status"];
        document_status: DocumentLifecycleStatus;
      }>`
        SELECT run.document_id, run.status, document.status AS document_status
        FROM resume_extraction_runs run
        JOIN documents document ON document.id = run.document_id
        WHERE run.id = ${input.extractionId} AND run.candidate_id = ${input.candidateId}
          AND run.account_id = ${input.accountId}
        FOR UPDATE
      `.execute(transaction);
      if (!run.rows[0]) throw new NotFoundError("Resume extraction was not found for this candidate.");
      if (run.rows[0].status !== "PROCESSING") return;

      type EntityResolution = { state: "MATCH" | "NEW" | "AMBIGUOUS"; entityId: string | null };
      const entityResolutions = new Map<string, EntityResolution>();
      const grouped = new Map<string, typeof input.proposals>();
      for (const proposal of input.proposals) {
        if (!proposal.entityType || !proposal.entityGroupKey) continue;
        const key = `${proposal.entityType}:${proposal.entityGroupKey}`;
        grouped.set(key, [...(grouped.get(key) ?? []), proposal]);
      }
      for (const [key, group] of grouped) {
        const first = group[0];
        if (!first?.entityType || !first.entityGroupKey) continue;
        const sourced = await sql<{ entity_id: string }>`
          SELECT source.entity_id
          FROM candidate_entity_source_keys source
          JOIN candidate_entities entity ON entity.id = source.entity_id
          WHERE source.candidate_id = ${input.candidateId}
            AND source.source_key = ${`resume:${first.entityGroupKey}`}
            AND source.entity_type = ${first.entityType}
            AND entity.status = 'ACTIVE'
          LIMIT 1
        `.execute(transaction);
        if (sourced.rows[0]) {
          entityResolutions.set(key, { state: "MATCH", entityId: sourced.rows[0].entity_id });
          continue;
        }
        const existing = await sql<{
          entity_id: string; canonical_key: string; value_fingerprint: string;
          value_type: string; text_value: string | null; structured_value: unknown;
        }>`
          SELECT entity.id AS entity_id, canonical.canonical_key, version.value_fingerprint,
                 version.value_type, version.text_value, version.structured_value
          FROM candidate_entities entity
          JOIN candidate_answers_current current_answer
            ON current_answer.candidate_id = entity.candidate_id AND current_answer.entity_id = entity.id
          JOIN candidate_answer_versions version ON version.id = current_answer.answer_version_id
          JOIN canonical_fields canonical ON canonical.id = current_answer.canonical_id
          JOIN candidate_answer_scopes scope ON scope.id = current_answer.scope_id
          WHERE entity.candidate_id = ${input.candidateId}
            AND entity.entity_type = ${first.entityType}
            AND entity.status = 'ACTIVE'
            AND version.trust_state <> 'REMOVED'
            AND scope.scope_type = 'GLOBAL'
        `.execute(transaction);
        const anchors = first.entityType === "EMPLOYMENT"
          ? ["EMPLOYMENT_COMPANY", "EMPLOYMENT_DATE_RANGE", "EMPLOYMENT_TITLE"]
          : first.entityType === "EDUCATION"
            ? ["EDUCATION_INSTITUTION", "EDUCATION_DATE_RANGE", "EDUCATION_DEGREE"]
            : first.entityType === "PROJECT"
              ? ["PROJECT_NAME", "PROJECT_DATE_RANGE", "PROJECT_URL"]
              : ["CERTIFICATION_NAME", "CERTIFICATION_ISSUER", "CERTIFICATION_DATE"];
        const scores = new Map<string, number>();
        for (const row of existing.rows) {
          const proposal = group.find((item) => item.canonicalKey === row.canonical_key && anchors.includes(item.canonicalKey));
          const currentValue = storedAnchorValue(row);
          if (proposal && (proposal.valueFingerprint === row.value_fingerprint
            || (proposal.entityMatchValue && currentValue
              && resumeEntityAnchorMatches(proposal.canonicalKey, proposal.entityMatchValue, currentValue)))) {
            scores.set(row.entity_id, (scores.get(row.entity_id) ?? 0) + 1);
          }
        }
        const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
        const best = ranked[0];
        const uniquelyGrounded = best && best[1] >= 2 && ranked.filter((item) => item[1] === best[1]).length === 1;
        entityResolutions.set(key, uniquelyGrounded
          ? { state: "MATCH", entityId: best[0] }
          : best
            ? { state: "AMBIGUOUS", entityId: null }
            : { state: "NEW", entityId: null });
      }

      for (const proposal of input.proposals) {
        const canonical = await sql<{ id: number }>`
          SELECT id FROM canonical_fields
          WHERE canonical_key = ${proposal.canonicalKey} AND status = 'ACTIVE'
        `.execute(transaction);
        if (!canonical.rows[0]) continue;
        const entityResolution = proposal.entityType && proposal.entityGroupKey
          ? entityResolutions.get(`${proposal.entityType}:${proposal.entityGroupKey}`) ?? { state: "NEW" as const, entityId: null }
          : null;
        const current = !proposal.entityType || entityResolution?.entityId
          ? await sql<{ answer_version_id: string; value_fingerprint: string }>`
              SELECT version.id AS answer_version_id, version.value_fingerprint
              FROM candidate_answers_current current_answer
              JOIN candidate_answer_versions version ON version.id = current_answer.answer_version_id
              JOIN candidate_answer_scopes scope ON scope.id = current_answer.scope_id
              WHERE current_answer.candidate_id = ${input.candidateId}
                AND current_answer.canonical_id = ${canonical.rows[0].id}
                AND current_answer.entity_id ${entityResolution?.entityId
                  ? sql`= ${entityResolution.entityId}`
                  : sql`IS NULL`}
                AND scope.scope_type = 'GLOBAL'
                AND version.trust_state <> 'REMOVED'
              LIMIT 1
            `.execute(transaction)
          : { rows: [] as { answer_version_id: string; value_fingerprint: string }[] };
        const existing = current.rows[0];
        const comparison: ResumeProposal["comparison"] = entityResolution
          ? entityResolution.state === "AMBIGUOUS"
            ? "AMBIGUOUS"
            : entityResolution.state === "NEW"
              ? "REPEATABLE_ENTITY_NEW"
              : existing?.value_fingerprint === proposal.valueFingerprint
                ? "REPEATABLE_ENTITY_MATCH"
                : existing
                  ? "CONFLICT"
                  : "REPEATABLE_ENTITY_MATCH"
          : !existing
            ? "NEW"
            : existing.value_fingerprint === proposal.valueFingerprint
              ? "MATCH"
              : "CONFLICT";
        await sql`
          INSERT INTO resume_candidate_proposals (
            id, account_id, candidate_id, document_id, extraction_id, item_key,
            canonical_id, entity_type, entity_group_key, confidence, comparison,
            reason_codes, source_section, evidence_sha256, extraction_schema_version,
            source_locator, matched_entity_id, existing_answer_version_id, value_fingerprint,
            fingerprint_key_version, payload_key_version, payload_iv,
            payload_auth_tag, encrypted_payload, created_at
          ) VALUES (
            ${proposal.proposalId}, ${input.accountId}, ${input.candidateId}, ${run.rows[0].document_id},
            ${input.extractionId}, ${proposal.itemKey}, ${canonical.rows[0].id},
            ${proposal.entityType}, ${proposal.entityGroupKey}, ${proposal.confidence}, ${comparison},
            ${proposal.reasonCodes}, ${proposal.sourceSection}, ${proposal.evidenceSha256},
            ${proposal.extractionSchemaVersion}, ${JSON.stringify({ itemKey: proposal.itemKey })}::jsonb,
            ${entityResolution?.entityId ?? null}, ${existing?.answer_version_id ?? null}, ${proposal.valueFingerprint},
            ${proposal.fingerprintKeyVersion}, ${proposal.encryptedPayload.keyVersion},
            ${Buffer.from(proposal.encryptedPayload.initializationVector)},
            ${Buffer.from(proposal.encryptedPayload.authenticationTag)},
            ${Buffer.from(proposal.encryptedPayload.ciphertext)}, ${input.completedAt}
          )
        `.execute(transaction);
      }
      const status: ResumeExtraction["status"] = input.invalidItemCount > 0 ? "PARTIAL" : "COMPLETED";
      await sql`
        UPDATE resume_extraction_runs
        SET status = ${status}, text_sha256 = ${input.textSha256},
            invalid_item_count = ${input.invalidItemCount}, completed_at = ${input.completedAt}
        WHERE id = ${input.extractionId}
      `.execute(transaction);
      if (run.rows[0].document_status !== "READY") {
        await sql`
          UPDATE documents
          SET status = 'RECONCILING', failure_code = NULL, updated_at = ${input.completedAt}
          WHERE id = ${run.rows[0].document_id}
        `.execute(transaction);
        await sql`
          INSERT INTO document_lifecycle_events (
            id, account_id, candidate_id, document_id, sequence, from_status,
            to_status, reason_code, created_at
          ) SELECT ${this.newId()}, ${input.accountId}, ${input.candidateId}, ${run.rows[0].document_id},
                   coalesce(max(sequence), 0) + 1, ${run.rows[0].document_status}, 'RECONCILING',
                   'EXTRACTION_COMPLETED', ${input.completedAt}
            FROM document_lifecycle_events WHERE document_id = ${run.rows[0].document_id}
        `.execute(transaction);
      }
      await sql`
        UPDATE candidate_onboarding_states
        SET stage = 'REVIEW', version = version + 1, last_seen_at = ${input.completedAt}
        WHERE candidate_id = ${input.candidateId} AND account_id = ${input.accountId}
          AND status = 'IN_PROGRESS'
      `.execute(transaction);
    });
  }

  async failExtraction(input: Parameters<ResumeRepository["failExtraction"]>[0]): Promise<void> {
    const result = await this.database.transaction().execute(async (transaction) => {
      const run = await sql<{ document_id: string }>`
        UPDATE resume_extraction_runs
        SET status = 'FAILED', error_code = ${input.errorCode}, completed_at = ${input.failedAt}
        WHERE id = ${input.extractionId} AND candidate_id = ${input.candidateId}
          AND account_id = ${input.accountId} AND status = 'PROCESSING'
        RETURNING document_id
      `.execute(transaction);
      if (!run.rows[0]) return { numAffectedRows: 0n };
      const document = await sql<{ status: DocumentLifecycleStatus }>`
        SELECT status FROM documents WHERE id = ${run.rows[0].document_id} FOR UPDATE
      `.execute(transaction);
      if (document.rows[0] && document.rows[0].status !== "READY") {
        await sql`
          UPDATE documents
          SET status = 'FAILED', failure_code = ${input.errorCode}, updated_at = ${input.failedAt}
          WHERE id = ${run.rows[0].document_id}
        `.execute(transaction);
        await sql`
          INSERT INTO document_lifecycle_events (
            id, account_id, candidate_id, document_id, sequence, from_status,
            to_status, reason_code, created_at
          ) SELECT ${this.newId()}, ${input.accountId}, ${input.candidateId}, ${run.rows[0].document_id},
                   coalesce(max(sequence), 0) + 1, ${document.rows[0].status}, 'FAILED',
                   ${input.errorCode}, ${input.failedAt}
            FROM document_lifecycle_events WHERE document_id = ${run.rows[0].document_id}
        `.execute(transaction);
      }
      return { numAffectedRows: 1n };
    });
    if (Number(result.numAffectedRows ?? 0) === 0) {
      const existing = await sql<{ status: string }>`
        SELECT status FROM resume_extraction_runs
        WHERE id = ${input.extractionId} AND candidate_id = ${input.candidateId} AND account_id = ${input.accountId}
      `.execute(this.database);
      if (!existing.rows[0]) throw new NotFoundError("Resume extraction was not found for this candidate.");
    }
  }

  async getReview(input: Parameters<ResumeRepository["getReview"]>[0]) {
    const document = await ownedDocument(this.database, input);
    const extractionResult = await sql<ExtractionRow>`
      SELECT id, document_id, status, attempt, extractor, extractor_version, error_code,
             started_at, completed_at
      FROM resume_extraction_runs
      WHERE candidate_id = ${input.candidateId} AND account_id = ${input.accountId}
        AND document_id = ${document.id}
      ORDER BY attempt DESC, started_at DESC, id DESC
      LIMIT 1
    `.execute(this.database);
    const extraction = extractionResult.rows[0] ? extractionFrom(extractionResult.rows[0]) : null;
    const proposals = extraction
      ? await sql<ProposalRow>`
          SELECT proposal.id, proposal.extraction_id, proposal.item_key,
                 canonical.canonical_key, proposal.entity_type, proposal.entity_group_key,
                 proposal.confidence, proposal.comparison, proposal.decision,
                 proposal.existing_answer_version_id, proposal.reason_codes,
                 proposal.matched_entity_id,
                 proposal.source_section, proposal.evidence_sha256, proposal.extraction_schema_version,
                 proposal.payload_key_version, proposal.payload_iv, proposal.payload_auth_tag,
                 proposal.encrypted_payload
          FROM resume_candidate_proposals proposal
          JOIN canonical_fields canonical ON canonical.id = proposal.canonical_id
          WHERE proposal.candidate_id = ${input.candidateId}
            AND proposal.account_id = ${input.accountId}
            AND proposal.extraction_id = ${extraction.extractionId}
          ORDER BY proposal.item_key
        `.execute(this.database)
      : { rows: [] as ProposalRow[] };
    return {
      document: documentFrom(document),
      extraction,
      proposals: proposals.rows.map((row) => ({
        proposalId: row.id,
        extractionId: row.extraction_id,
        itemKey: row.item_key,
        canonicalKey: row.canonical_key,
        entityType: row.entity_type,
        entityGroupKey: row.entity_group_key,
        confidence: Number(row.confidence),
        comparison: row.comparison,
        decision: row.decision,
        existingAnswerVersionId: row.existing_answer_version_id,
        matchedEntityId: row.matched_entity_id,
        reasonCodes: row.reason_codes,
        sourceSection: row.source_section,
        evidenceSha256: row.evidence_sha256,
        extractionSchemaVersion: Number(row.extraction_schema_version),
        encryptedPayload: encrypted(row)
      }))
    };
  }
}

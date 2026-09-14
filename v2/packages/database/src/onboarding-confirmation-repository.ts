import type {
  CandidateConfirmationRepository,
  CandidateConfirmationResult
} from "@job-hunter-v2/onboarding";
import { IdempotencyConflictError, NotFoundError } from "@job-hunter-v2/domain";
import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

interface ConfirmationRow {
  id: string;
  candidate_id: string;
  extraction_id: string | null;
  change_set_id: string | null;
  accepted_count: number;
  corrected_count: number;
  removed_count: number;
  skipped_count: number;
  unchanged_match_count: number;
  request_fingerprint: string;
  created_at: Date | string;
}

function result(row: ConfirmationRow, idempotentReplay: boolean): CandidateConfirmationResult {
  return {
    receiptId: row.id,
    candidateId: row.candidate_id,
    extractionId: row.extraction_id,
    changeSetId: row.change_set_id,
    accepted: Number(row.accepted_count),
    corrected: Number(row.corrected_count),
    removed: Number(row.removed_count),
    skipped: Number(row.skipped_count),
    unchangedMatches: Number(row.unchanged_match_count),
    idempotentReplay,
    createdAt: new Date(row.created_at)
  };
}

export class KyselyCandidateConfirmationRepository implements CandidateConfirmationRepository {
  constructor(
    private readonly database: Kysely<V2Database>,
    private readonly newId: () => string = randomUUID
  ) {}

  async findConfirmation(input: Parameters<CandidateConfirmationRepository["findConfirmation"]>[0]) {
    const found = await sql<ConfirmationRow>`
      SELECT id, candidate_id, extraction_id, change_set_id, accepted_count,
             corrected_count, removed_count, skipped_count, unchanged_match_count,
             request_fingerprint, created_at
      FROM candidate_onboarding_confirmation_receipts
      WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
        AND idempotency_key = ${input.idempotencyKey}
    `.execute(this.database);
    if (!found.rows[0]) return null;
    if (found.rows[0].request_fingerprint !== input.requestFingerprint) {
      throw new IdempotencyConflictError("Confirmation idempotency key was reused for different decisions.");
    }
    return result(found.rows[0], true);
  }

  async ensureEntity(input: Parameters<CandidateConfirmationRepository["ensureEntity"]>[0]): Promise<string> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`candidate-entity:${input.candidateId}:${input.sourceKey}`}))`.execute(transaction);
      const candidate = await sql<{ id: string }>`
        SELECT id FROM candidates
        WHERE id = ${input.candidateId} AND account_id = ${input.accountId} AND status = 'ACTIVE'
      `.execute(transaction);
      if (!candidate.rows[0]) throw new NotFoundError("Active candidate was not found for this account.");
      const existing = await sql<{ entity_id: string; entity_type: string }>`
        SELECT entity_id, entity_type FROM candidate_entity_source_keys
        WHERE candidate_id = ${input.candidateId} AND source_key = ${input.sourceKey}
      `.execute(transaction);
      if (existing.rows[0]) {
        if (existing.rows[0].entity_type !== input.entityType) {
          throw new IdempotencyConflictError("Stable history key was reused for another entity type.");
        }
        return existing.rows[0].entity_id;
      }
      if (input.preferredEntityId) {
        const preferred = await sql<{ id: string }>`
          SELECT id FROM candidate_entities
          WHERE id = ${input.preferredEntityId}
            AND candidate_id = ${input.candidateId}
            AND entity_type = ${input.entityType}
            AND status = 'ACTIVE'
          FOR UPDATE
        `.execute(transaction);
        if (!preferred.rows[0]) throw new NotFoundError("Matched candidate history entry was not found.");
        await sql`
          INSERT INTO candidate_entity_source_keys (
            candidate_id, source_key, entity_id, entity_type, created_at
          ) VALUES (
            ${input.candidateId}, ${input.sourceKey}, ${input.preferredEntityId},
            ${input.entityType}, ${input.createdAt}
          )
        `.execute(transaction);
        return input.preferredEntityId;
      }
      await sql`
        INSERT INTO candidate_entities (id, candidate_id, entity_type, status, created_at)
        VALUES (${input.entityId}, ${input.candidateId}, ${input.entityType}, 'ACTIVE', ${input.createdAt})
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_entity_versions (
          id, entity_id, version, attributes, source, created_at
        ) VALUES (
          ${this.newId()}, ${input.entityId}, 1,
          ${JSON.stringify({ origin: "ONBOARDING" })}::jsonb,
          'CANDIDATE_ONBOARDING', ${input.createdAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_entity_source_keys (
          candidate_id, source_key, entity_id, entity_type, created_at
        ) VALUES (
          ${input.candidateId}, ${input.sourceKey}, ${input.entityId}, ${input.entityType}, ${input.createdAt}
        )
      `.execute(transaction);
      return input.entityId;
    });
  }

  async completeConfirmation(
    input: Parameters<CandidateConfirmationRepository["completeConfirmation"]>[0]
  ): Promise<CandidateConfirmationResult> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`candidate-confirm:${input.candidateId}:${input.idempotencyKey}`}))`.execute(transaction);
      const candidate = await sql<{ id: string }>`
        SELECT id FROM candidates
        WHERE id = ${input.candidateId} AND account_id = ${input.accountId} AND status = 'ACTIVE'
      `.execute(transaction);
      if (!candidate.rows[0]) throw new NotFoundError("Active candidate was not found for this account.");
      const existing = await sql<ConfirmationRow>`
        SELECT id, candidate_id, extraction_id, change_set_id, accepted_count,
               corrected_count, removed_count, skipped_count, unchanged_match_count,
               request_fingerprint, created_at
        FROM candidate_onboarding_confirmation_receipts
        WHERE candidate_id = ${input.candidateId} AND idempotency_key = ${input.idempotencyKey}
      `.execute(transaction);
      if (existing.rows[0]) {
        if (existing.rows[0].request_fingerprint !== input.requestFingerprint) {
          throw new IdempotencyConflictError("Confirmation idempotency key was reused for different decisions.");
        }
        return result(existing.rows[0], true);
      }
      for (const decision of input.proposalDecisions) {
        const proposal = await sql<{ document_id: string; canonical_key: string }>`
          SELECT proposal.document_id, canonical.canonical_key
          FROM resume_candidate_proposals proposal
          JOIN canonical_fields canonical ON canonical.id = proposal.canonical_id
          WHERE proposal.id = ${decision.proposalId}
            AND proposal.candidate_id = ${input.candidateId}
            AND proposal.account_id = ${input.accountId}
        `.execute(transaction);
        if (!proposal.rows[0]) throw new NotFoundError("Resume proposal was not found for this candidate.");
        const update = await sql`
          UPDATE resume_candidate_proposals
          SET decision = ${decision.decision}, reviewed_at = ${input.completedAt}
          WHERE id = ${decision.proposalId}
            AND candidate_id = ${input.candidateId}
            AND account_id = ${input.accountId}
            AND decision = 'PENDING'
        `.execute(transaction);
        if (Number(update.numAffectedRows ?? 0) !== 1) {
          throw new IdempotencyConflictError("A resume proposal was already reviewed by another request.");
        }
        if (proposal.rows[0].canonical_key === "RESUME") {
          const document = await sql<{ status: string }>`
            SELECT status FROM documents
            WHERE id = ${proposal.rows[0].document_id}
              AND candidate_id = ${input.candidateId}
              AND account_id = ${input.accountId}
            FOR UPDATE
          `.execute(transaction);
          if (!document.rows[0]) throw new NotFoundError("Reviewed resume document was not found.");
          if (["UPLOADED", "EXTRACTING", "EXTRACTED", "RECONCILING", "FAILED"].includes(document.rows[0].status)) {
            if (["ACCEPTED", "CORRECTED"].includes(decision.decision)) {
              const previous = await sql<{ id: string; status: string }>`
                SELECT id, status FROM documents
                WHERE candidate_id = ${input.candidateId}
                  AND purpose = 'MASTER_RESUME'
                  AND status = 'READY'
                  AND id <> ${proposal.rows[0].document_id}
                FOR UPDATE
              `.execute(transaction);
              await sql`
                UPDATE documents
                SET status = 'SUPERSEDED', updated_at = ${input.completedAt}
                WHERE candidate_id = ${input.candidateId}
                  AND purpose = 'MASTER_RESUME'
                  AND status = 'READY'
                  AND id <> ${proposal.rows[0].document_id}
              `.execute(transaction);
              for (const prior of previous.rows) {
                await sql`
                  INSERT INTO document_lifecycle_events (
                    id, account_id, candidate_id, document_id, sequence, from_status,
                    to_status, reason_code, created_at
                  ) SELECT ${this.newId()}, ${input.accountId}, ${input.candidateId}, ${prior.id},
                           coalesce(max(sequence), 0) + 1, ${prior.status}, 'SUPERSEDED',
                           'MASTER_RESUME_REPLACED', ${input.completedAt}
                    FROM document_lifecycle_events WHERE document_id = ${prior.id}
                `.execute(transaction);
              }
              await sql`
                UPDATE documents
                SET status = 'READY', failure_code = NULL, deleted_at = NULL,
                    ready_at = ${input.completedAt}, updated_at = ${input.completedAt}
                WHERE id = ${proposal.rows[0].document_id}
              `.execute(transaction);
              await sql`
                INSERT INTO document_lifecycle_events (
                  id, account_id, candidate_id, document_id, sequence, from_status,
                  to_status, reason_code, created_at
                ) SELECT ${this.newId()}, ${input.accountId}, ${input.candidateId},
                         ${proposal.rows[0].document_id}, coalesce(max(sequence), 0) + 1,
                         ${document.rows[0].status}, 'READY', 'CANDIDATE_APPROVED_MASTER_RESUME',
                         ${input.completedAt}
                  FROM document_lifecycle_events
                  WHERE document_id = ${proposal.rows[0].document_id}
              `.execute(transaction);
            } else {
              await sql`
                UPDATE documents
                SET status = 'ARCHIVED', failure_code = NULL, updated_at = ${input.completedAt}
                WHERE id = ${proposal.rows[0].document_id}
              `.execute(transaction);
              await sql`
                INSERT INTO document_lifecycle_events (
                  id, account_id, candidate_id, document_id, sequence, from_status,
                  to_status, reason_code, created_at
                ) SELECT ${this.newId()}, ${input.accountId}, ${input.candidateId},
                         ${proposal.rows[0].document_id}, coalesce(max(sequence), 0) + 1,
                         ${document.rows[0].status}, 'ARCHIVED', 'CANDIDATE_REJECTED_MASTER_RESUME',
                         ${input.completedAt}
                  FROM document_lifecycle_events
                  WHERE document_id = ${proposal.rows[0].document_id}
              `.execute(transaction);
            }
          }
        }
      }
      await sql`
        INSERT INTO candidate_onboarding_confirmation_receipts (
          id, account_id, candidate_id, extraction_id, change_set_id, idempotency_key,
          request_fingerprint, accepted_count, corrected_count, removed_count,
          skipped_count, unchanged_match_count, created_at
        ) VALUES (
          ${input.receiptId}, ${input.accountId}, ${input.candidateId}, ${input.extractionId},
          ${input.changeSetId}, ${input.idempotencyKey}, ${input.requestFingerprint},
          ${input.accepted}, ${input.corrected}, ${input.removed}, ${input.skipped},
          ${input.unchangedMatches}, ${input.completedAt}
        )
      `.execute(transaction);
      await sql`
        UPDATE candidate_onboarding_states
        SET stage = 'PROFILE', version = version + 1, last_seen_at = ${input.completedAt}
        WHERE candidate_id = ${input.candidateId} AND account_id = ${input.accountId}
          AND status = 'IN_PROGRESS'
      `.execute(transaction);
      return {
        receiptId: input.receiptId,
        candidateId: input.candidateId,
        extractionId: input.extractionId,
        changeSetId: input.changeSetId,
        accepted: input.accepted,
        corrected: input.corrected,
        removed: input.removed,
        skipped: input.skipped,
        unchangedMatches: input.unchangedMatches,
        idempotentReplay: false,
        createdAt: input.completedAt
      };
    });
  }
}

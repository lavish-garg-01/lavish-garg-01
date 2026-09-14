import { randomUUID } from "node:crypto";
import type {
  CandidateTruthImportPreviewRepository,
  LegacyCandidateTruthImportDecision,
  LegacyCandidateTruthImportPreviewItem,
  LegacyCandidateTruthImportPreviewResult,
  LegacyImportCurrentAnswer,
  PersistLegacyImportPreviewCommand
} from "@job-hunter-v2/candidate-truth";
import {
  IdempotencyConflictError,
  NotFoundError,
  ValidationError
} from "@job-hunter-v2/domain";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

interface PreviewRunRow {
  id: string;
  candidate_id: string;
  migration_version: number;
  snapshot_fingerprint: string;
  fingerprint_key_version: number;
  status: "PREVIEWED";
  source_count: number;
  eligible_count: number;
  review_required_count: number;
  skipped_count: number;
  conflict_count: number;
  invalid_count: number;
  already_present_count: number;
  created_at: Date | string;
}

interface PreviewItemRow {
  id: string;
  source_ordinal: number;
  source_kind: LegacyCandidateTruthImportPreviewItem["sourceKind"];
  source_record_fingerprint: string;
  source_value_fingerprint: string;
  fingerprint_key_version: number;
  source_canonical_key: string;
  target_canonical_key: string | null;
  proposed_scope_type: LegacyCandidateTruthImportPreviewItem["proposedScopeType"];
  decision: LegacyCandidateTruthImportDecision;
  reason_codes: string[];
  existing_answer_version_id: string | null;
}

const decisions: readonly LegacyCandidateTruthImportDecision[] = [
  "ELIGIBLE",
  "REVIEW_REQUIRED",
  "SKIPPED",
  "CONFLICT",
  "INVALID",
  "ALREADY_PRESENT"
];

async function assertActiveCandidate(
  database: Kysely<V2Database>,
  input: { accountId: string; candidateId: string }
): Promise<void> {
  const result = await sql<{ id: string }>`
    SELECT candidate.id
    FROM candidates candidate
    JOIN accounts account ON account.id = candidate.account_id
    WHERE candidate.id = ${input.candidateId}
      AND candidate.account_id = ${input.accountId}
      AND candidate.status = 'ACTIVE'
      AND account.status = 'ACTIVE'
    LIMIT 1
  `.execute(database);
  if (!result.rows[0]) throw new NotFoundError("Active candidate was not found for this account.");
}

export async function loadCandidateTruthImportPreview(
  database: Kysely<V2Database>,
  input: {
    candidateId: string;
    previewRunId: string;
    idempotentReplay: boolean;
    alreadyPreviewed: boolean;
  }
): Promise<LegacyCandidateTruthImportPreviewResult> {
  const runResult = await sql<PreviewRunRow>`
    SELECT
      id, candidate_id, migration_version, snapshot_fingerprint,
      fingerprint_key_version, status, source_count, eligible_count,
      review_required_count, skipped_count, conflict_count, invalid_count,
      already_present_count, created_at
    FROM candidate_truth_import_preview_runs
    WHERE id = ${input.previewRunId}
      AND candidate_id = ${input.candidateId}
    LIMIT 1
  `.execute(database);
  const run = runResult.rows[0];
  if (!run) throw new Error("Committed candidate-truth import preview was not found.");

  const itemResult = await sql<PreviewItemRow>`
    SELECT
      item.id, item.source_ordinal, item.source_kind,
      item.source_record_fingerprint, item.source_value_fingerprint,
      item.fingerprint_key_version, item.source_canonical_key,
      canonical.canonical_key AS target_canonical_key,
      item.proposed_scope_type, item.decision, item.reason_codes,
      item.existing_answer_version_id
    FROM candidate_truth_import_preview_items item
    LEFT JOIN canonical_fields canonical ON canonical.id = item.target_canonical_id
    WHERE item.preview_run_id = ${input.previewRunId}
      AND item.candidate_id = ${input.candidateId}
    ORDER BY item.source_ordinal
  `.execute(database);
  const counts: Record<LegacyCandidateTruthImportDecision, number> = {
    ELIGIBLE: Number(run.eligible_count),
    REVIEW_REQUIRED: Number(run.review_required_count),
    SKIPPED: Number(run.skipped_count),
    CONFLICT: Number(run.conflict_count),
    INVALID: Number(run.invalid_count),
    ALREADY_PRESENT: Number(run.already_present_count)
  };
  const reasonCounter = new Map<string, number>();
  const items = itemResult.rows.map((item) => {
    for (const reason of item.reason_codes) {
      reasonCounter.set(reason, (reasonCounter.get(reason) ?? 0) + 1);
    }
    return {
      previewItemId: item.id,
      sourceOrdinal: Number(item.source_ordinal),
      sourceKind: item.source_kind,
      sourceRecordFingerprint: item.source_record_fingerprint,
      sourceValueFingerprint: item.source_value_fingerprint,
      fingerprintKeyVersion: Number(item.fingerprint_key_version),
      sourceCanonicalKey: item.source_canonical_key,
      targetCanonicalKey: item.target_canonical_key,
      proposedScopeType: item.proposed_scope_type,
      decision: item.decision,
      reasonCodes: item.reason_codes,
      existingAnswerVersionId: item.existing_answer_version_id
    } satisfies LegacyCandidateTruthImportPreviewItem;
  });
  return {
    candidateId: run.candidate_id,
    previewRunId: run.id,
    migrationVersion: Number(run.migration_version),
    snapshotFingerprint: run.snapshot_fingerprint,
    fingerprintKeyVersion: Number(run.fingerprint_key_version),
    status: run.status,
    sourceCount: Number(run.source_count),
    counts,
    reasonCounts: [...reasonCounter.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reasonCode, count]) => ({ reasonCode, count })),
    items,
    candidateTruthMutated: false,
    migrated: 0,
    productionCutover: false,
    createdAt: new Date(run.created_at),
    idempotentReplay: input.idempotentReplay,
    alreadyPreviewed: input.alreadyPreviewed
  };
}

export class KyselyCandidateTruthImportPreviewRepository
  implements CandidateTruthImportPreviewRepository
{
  constructor(
    private readonly database: Kysely<V2Database>,
    private readonly newId: () => string = randomUUID
  ) {}

  async listCurrentAnswers(input: {
    accountId: string;
    candidateId: string;
    canonicalKeys: readonly string[];
  }): Promise<readonly LegacyImportCurrentAnswer[]> {
    await assertActiveCandidate(this.database, input);
    const canonicalKeys = [...new Set(input.canonicalKeys)];
    if (canonicalKeys.length === 0) return [];
    const result = await sql<{
      canonical_key: string;
      scope_fingerprint: string;
      answer_version_id: string;
      value_fingerprint: string;
      fingerprint_key_version: number;
      trust_state: LegacyImportCurrentAnswer["trustState"];
    }>`
      SELECT
        canonical.canonical_key, answer_scope.scope_fingerprint,
        version.id AS answer_version_id, version.value_fingerprint,
        version.fingerprint_key_version, version.trust_state
      FROM candidates candidate
      JOIN candidate_answers_current current_answer
        ON current_answer.candidate_id = candidate.id
      JOIN candidate_answer_versions version
        ON version.id = current_answer.answer_version_id
       AND version.candidate_id = candidate.id
      JOIN canonical_fields canonical ON canonical.id = current_answer.canonical_id
      JOIN candidate_answer_scopes answer_scope
        ON answer_scope.id = current_answer.scope_id
       AND answer_scope.candidate_id = candidate.id
      WHERE candidate.id = ${input.candidateId}
        AND candidate.account_id = ${input.accountId}
        AND candidate.status = 'ACTIVE'
        AND canonical.status = 'ACTIVE'
        AND canonical.canonical_key IN (${sql.join(canonicalKeys.map((key) => sql`${key}`))})
        AND current_answer.entity_id IS NULL
    `.execute(this.database);
    return result.rows.map((row) => ({
      canonicalKey: row.canonical_key,
      scopeFingerprint: row.scope_fingerprint,
      answerVersionId: row.answer_version_id,
      valueFingerprint: row.value_fingerprint,
      fingerprintKeyVersion: Number(row.fingerprint_key_version),
      trustState: row.trust_state
    }));
  }

  async commitPreview(
    command: PersistLegacyImportPreviewCommand
  ): Promise<LegacyCandidateTruthImportPreviewResult> {
    return this.database.transaction().execute(async (transaction) => {
      await assertActiveCandidate(transaction, command);
      if (command.items.length > 2000) {
        throw new ValidationError("A candidate-truth import preview accepts at most 2000 items.");
      }
      const ordinals = new Set(command.items.map((item) => item.sourceOrdinal));
      if (ordinals.size !== command.items.length) {
        throw new ValidationError("Candidate-truth import preview ordinals must be unique.");
      }
      for (const item of command.items) {
        if (
          !decisions.includes(item.decision) ||
          item.reasonCodes.length < 1 ||
          item.reasonCodes.length > 12 ||
          item.reasonCodes.some((reason) => !/^[A-Z][A-Z0-9_]{0,119}$/.test(reason))
        ) {
          throw new ValidationError("Candidate-truth import preview item is invalid.");
        }
      }

      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:legacy-preview:${command.idempotencyKey}`})::bigint)`.execute(
        transaction
      );
      const receiptResult = await sql<{
        request_fingerprint: string;
        preview_run_id: string;
        already_previewed: boolean;
      }>`
        SELECT request_fingerprint, preview_run_id, already_previewed
        FROM candidate_truth_import_preview_receipts
        WHERE candidate_id = ${command.candidateId}
          AND idempotency_key = ${command.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      const receipt = receiptResult.rows[0];
      if (receipt) {
        if (receipt.request_fingerprint !== command.requestFingerprint) {
          throw new IdempotencyConflictError(
            "Candidate-truth import preview idempotency key was reused with different input."
          );
        }
        return loadCandidateTruthImportPreview(transaction, {
          candidateId: command.candidateId,
          previewRunId: receipt.preview_run_id,
          idempotentReplay: true,
          alreadyPreviewed: receipt.already_previewed
        });
      }

      await sql`SELECT pg_advisory_xact_lock(hashtext(${[
        command.candidateId,
        command.migrationVersion,
        command.snapshotFingerprint,
        command.fingerprintKeyVersion
      ].join(":")})::bigint)`.execute(transaction);
      const existingRunResult = await sql<{ id: string }>`
        SELECT id
        FROM candidate_truth_import_preview_runs
        WHERE candidate_id = ${command.candidateId}
          AND migration_version = ${command.migrationVersion}
          AND snapshot_fingerprint = ${command.snapshotFingerprint}
          AND fingerprint_key_version = ${command.fingerprintKeyVersion}
        LIMIT 1
      `.execute(transaction);
      const existingRun = existingRunResult.rows[0];
      if (existingRun) {
        await sql`
          INSERT INTO candidate_truth_import_preview_receipts (
            candidate_id, idempotency_key, request_fingerprint,
            preview_run_id, already_previewed, created_at
          ) VALUES (
            ${command.candidateId}, ${command.idempotencyKey}, ${command.requestFingerprint},
            ${existingRun.id}, true, ${command.createdAt}
          )
        `.execute(transaction);
        return loadCandidateTruthImportPreview(transaction, {
          candidateId: command.candidateId,
          previewRunId: existingRun.id,
          idempotentReplay: false,
          alreadyPreviewed: true
        });
      }

      const targetKeys = [
        ...new Set(command.items.flatMap((item) => item.targetCanonicalKey ? [item.targetCanonicalKey] : []))
      ];
      const canonicalResult = targetKeys.length
        ? await sql<{ id: number; canonical_key: string }>`
            SELECT id, canonical_key
            FROM canonical_fields
            WHERE status = 'ACTIVE'
              AND canonical_key IN (${sql.join(targetKeys.map((key) => sql`${key}`))})
          `.execute(transaction)
        : { rows: [] };
      const canonicalIds = new Map(canonicalResult.rows.map((row) => [row.canonical_key, row.id]));
      if (canonicalIds.size !== targetKeys.length) {
        throw new ValidationError("Candidate-truth import preview references an inactive canonical.");
      }

      const counts = Object.fromEntries(decisions.map((decision) => [decision, 0])) as Record<
        LegacyCandidateTruthImportDecision,
        number
      >;
      for (const item of command.items) counts[item.decision] += 1;
      const previewRunId = this.newId();
      await sql`
        INSERT INTO candidate_truth_import_preview_runs (
          id, candidate_id, migration_version, snapshot_fingerprint,
          fingerprint_key_version, status, source_count, eligible_count,
          review_required_count, skipped_count, conflict_count, invalid_count,
          already_present_count, created_at
        ) VALUES (
          ${previewRunId}, ${command.candidateId}, ${command.migrationVersion},
          ${command.snapshotFingerprint}, ${command.fingerprintKeyVersion}, 'PREVIEWED',
          ${command.items.length}, ${counts.ELIGIBLE}, ${counts.REVIEW_REQUIRED},
          ${counts.SKIPPED}, ${counts.CONFLICT}, ${counts.INVALID},
          ${counts.ALREADY_PRESENT}, ${command.createdAt}
        )
      `.execute(transaction);
      for (const item of command.items) {
        await sql`
          INSERT INTO candidate_truth_import_preview_items (
            id, candidate_id, preview_run_id, source_ordinal, source_kind,
            source_record_fingerprint, source_value_fingerprint,
            fingerprint_key_version, source_canonical_key, target_canonical_id,
            proposed_scope_type, decision, reason_codes,
            existing_answer_version_id, created_at
          ) VALUES (
            ${this.newId()}, ${command.candidateId}, ${previewRunId}, ${item.sourceOrdinal},
            ${item.sourceKind}, ${item.sourceRecordFingerprint}, ${item.sourceValueFingerprint},
            ${item.fingerprintKeyVersion}, ${item.sourceCanonicalKey},
            ${item.targetCanonicalKey ? canonicalIds.get(item.targetCanonicalKey) ?? null : null},
            ${item.proposedScopeType}, ${item.decision}, ${item.reasonCodes},
            ${item.existingAnswerVersionId}, ${command.createdAt}
          )
        `.execute(transaction);
      }
      await sql`
        INSERT INTO candidate_truth_import_preview_receipts (
          candidate_id, idempotency_key, request_fingerprint,
          preview_run_id, already_previewed, created_at
        ) VALUES (
          ${command.candidateId}, ${command.idempotencyKey}, ${command.requestFingerprint},
          ${previewRunId}, false, ${command.createdAt}
        )
      `.execute(transaction);
      return loadCandidateTruthImportPreview(transaction, {
        candidateId: command.candidateId,
        previewRunId,
        idempotentReplay: false,
        alreadyPreviewed: false
      });
    });
  }
}

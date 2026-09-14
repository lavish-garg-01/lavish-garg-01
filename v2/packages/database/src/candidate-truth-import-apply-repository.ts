import { randomUUID } from "node:crypto";
import type {
  BeginLegacyImportApplyCommand,
  CompleteLegacyImportBatchCommand,
  LegacyImportApplyRepository,
  LegacyImportApplyResult,
  LegacyImportCurrentAnswer,
  LegacyImportReconciliationItem,
  LegacyImportReconciliationOutcome,
  LegacyImportVerificationReport
} from "@job-hunter-v2/candidate-truth";
import {
  ConflictError,
  IdempotencyConflictError,
  NotFoundError,
  ValidationError
} from "@job-hunter-v2/domain";
import { sql, type Kysely } from "kysely";
import { loadCandidateTruthImportPreview } from "./candidate-truth-import-preview-repository.js";
import type { V2Database } from "./index.js";

interface ApplyRunRow {
  id: string;
  candidate_id: string;
  preview_run_id: string;
  status: "PENDING" | "COMPLETED";
  examined_count: number;
  imported_count: number;
  already_imported_count: number;
  skipped_count: number;
  review_required_count: number;
  conflict_count: number;
  invalid_count: number;
  unmappable_count: number;
  started_at: Date | string;
  completed_at: Date | string | null;
}

const outcomes: readonly LegacyImportReconciliationOutcome[] = [
  "IMPORTED",
  "ALREADY_IMPORTED",
  "SKIPPED",
  "REVIEW_REQUIRED",
  "CONFLICT",
  "INVALID",
  "UNMAPPABLE"
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

async function loadApplyResult(
  database: Kysely<V2Database>,
  input: { candidateId: string; applyRunId: string; idempotentReplay: boolean }
): Promise<LegacyImportApplyResult> {
  const runResult = await sql<ApplyRunRow>`
    SELECT
      id, candidate_id, preview_run_id, status, examined_count,
      imported_count, already_imported_count, skipped_count,
      review_required_count, conflict_count, invalid_count, unmappable_count,
      started_at, completed_at
    FROM candidate_truth_import_apply_runs
    WHERE id = ${input.applyRunId}
      AND candidate_id = ${input.candidateId}
    LIMIT 1
  `.execute(database);
  const run = runResult.rows[0];
  if (!run) throw new Error("Candidate-truth import apply run was not found.");
  const batchResult = await sql<{
    id: string;
    batch_index: number;
    batch_fingerprint: string;
    status: "PENDING" | "COMPLETED";
    preview_item_ids: string[];
  }>`
    SELECT
      batch.id, batch.batch_index, batch.batch_fingerprint, batch.status,
      coalesce(
        array_agg(item.preview_item_id ORDER BY item.batch_ordinal)
          FILTER (WHERE item.preview_item_id IS NOT NULL),
        '{}'::uuid[]
      ) AS preview_item_ids
    FROM candidate_truth_import_apply_batches batch
    LEFT JOIN candidate_truth_import_apply_batch_items item
      ON item.apply_batch_id = batch.id
     AND item.candidate_id = batch.candidate_id
    WHERE batch.apply_run_id = ${input.applyRunId}
      AND batch.candidate_id = ${input.candidateId}
    GROUP BY batch.id
    ORDER BY batch.batch_index
  `.execute(database);
  const reconciliationResult = await sql<{
    id: string;
    preview_item_id: string;
    outcome: LegacyImportReconciliationOutcome;
    reason_codes: string[];
    answer_version_id: string | null;
    candidate_change_set_id: string | null;
  }>`
    SELECT
      id, preview_item_id, outcome, reason_codes,
      answer_version_id, candidate_change_set_id
    FROM candidate_truth_import_reconciliations
    WHERE apply_run_id = ${input.applyRunId}
      AND candidate_id = ${input.candidateId}
    ORDER BY preview_item_id
  `.execute(database);
  const reconciliations: LegacyImportReconciliationItem[] = reconciliationResult.rows.map(
    (item) => ({
      reconciliationId: item.id,
      previewItemId: item.preview_item_id,
      outcome: item.outcome,
      reasonCodes: item.reason_codes,
      answerVersionId: item.answer_version_id,
      candidateChangeSetId: item.candidate_change_set_id
    })
  );
  const dynamicCounts = Object.fromEntries(outcomes.map((outcome) => [outcome, 0])) as Record<
    LegacyImportReconciliationOutcome,
    number
  >;
  for (const item of reconciliations) dynamicCounts[item.outcome] += 1;
  const counts = run.status === "COMPLETED"
    ? {
        IMPORTED: Number(run.imported_count),
        ALREADY_IMPORTED: Number(run.already_imported_count),
        SKIPPED: Number(run.skipped_count),
        REVIEW_REQUIRED: Number(run.review_required_count),
        CONFLICT: Number(run.conflict_count),
        INVALID: Number(run.invalid_count),
        UNMAPPABLE: Number(run.unmappable_count)
      }
    : dynamicCounts;
  return {
    candidateId: run.candidate_id,
    previewRunId: run.preview_run_id,
    applyRunId: run.id,
    status: run.status,
    examinedCount: Number(run.examined_count),
    counts,
    reconciliations,
    batches: batchResult.rows.map((batch) => ({
      applyBatchId: batch.id,
      batchIndex: Number(batch.batch_index),
      batchFingerprint: batch.batch_fingerprint,
      previewItemIds: batch.preview_item_ids,
      status: batch.status
    })),
    idempotentReplay: input.idempotentReplay,
    startedAt: new Date(run.started_at),
    completedAt: run.completed_at ? new Date(run.completed_at) : null
  };
}

function validReasons(reasons: readonly string[]): boolean {
  return (
    reasons.length >= 1 &&
    reasons.length <= 12 &&
    reasons.every((reason) => /^[A-Z][A-Z0-9_]{0,119}$/.test(reason))
  );
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

export class KyselyLegacyImportApplyRepository implements LegacyImportApplyRepository {
  constructor(
    private readonly database: Kysely<V2Database>,
    private readonly newId: () => string = randomUUID
  ) {}

  async loadPreview(input: { accountId: string; candidateId: string; previewRunId: string }) {
    await assertActiveCandidate(this.database, input);
    return loadCandidateTruthImportPreview(this.database, {
      candidateId: input.candidateId,
      previewRunId: input.previewRunId,
      idempotentReplay: false,
      alreadyPreviewed: true
    });
  }

  async listCurrentAnswers(input: {
    accountId: string;
    candidateId: string;
    canonicalKeys: readonly string[];
  }): Promise<readonly LegacyImportCurrentAnswer[]> {
    await assertActiveCandidate(this.database, input);
    const canonicalKeys = [...new Set(input.canonicalKeys)];
    if (!canonicalKeys.length) return [];
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
      JOIN candidate_answers_current current_answer ON current_answer.candidate_id = candidate.id
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

  async beginOrResumeApply(
    command: BeginLegacyImportApplyCommand
  ): Promise<LegacyImportApplyResult> {
    return this.database.transaction().execute(async (transaction) => {
      await assertActiveCandidate(transaction, command);
      const allItemIds = [
        ...command.terminalItems.map((item) => item.previewItemId),
        ...command.batches.flatMap((batch) => batch.previewItemIds)
      ];
      if (
        command.examinedCount !== allItemIds.length ||
        new Set(allItemIds).size !== allItemIds.length ||
        command.batches.length > 40 ||
        command.batches.some(
          (batch, index) =>
            batch.batchIndex !== index ||
            batch.previewItemIds.length < 1 ||
            batch.previewItemIds.length > 50
        ) ||
        command.terminalItems.some((item) => !validReasons(item.reasonCodes))
      ) {
        throw new ValidationError("Legacy import apply plan is incomplete or invalid.");
      }

      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:legacy-apply:${command.idempotencyKey}`})::bigint)`.execute(
        transaction
      );
      const receiptResult = await sql<{
        request_fingerprint: string;
        apply_run_id: string;
      }>`
        SELECT request_fingerprint, apply_run_id
        FROM candidate_truth_import_apply_receipts
        WHERE candidate_id = ${command.candidateId}
          AND idempotency_key = ${command.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      const receipt = receiptResult.rows[0];
      if (receipt) {
        if (receipt.request_fingerprint !== command.requestFingerprint) {
          throw new IdempotencyConflictError(
            "Candidate-truth import apply idempotency key was reused with different input."
          );
        }
        return loadApplyResult(transaction, {
          candidateId: command.candidateId,
          applyRunId: receipt.apply_run_id,
          idempotentReplay: true
        });
      }

      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:legacy-preview:${command.previewRunId}`})::bigint)`.execute(
        transaction
      );
      const previewResult = await sql<{
        source_count: number;
        snapshot_fingerprint: string;
        fingerprint_key_version: number;
      }>`
        SELECT source_count, snapshot_fingerprint, fingerprint_key_version
        FROM candidate_truth_import_preview_runs
        WHERE id = ${command.previewRunId}
          AND candidate_id = ${command.candidateId}
        LIMIT 1
        FOR SHARE
      `.execute(transaction);
      const preview = previewResult.rows[0];
      if (!preview) throw new NotFoundError("Candidate-truth import preview was not found.");
      if (
        Number(preview.source_count) !== command.examinedCount ||
        preview.snapshot_fingerprint !== command.sourceSnapshotFingerprint ||
        Number(preview.fingerprint_key_version) !== command.fingerprintKeyVersion
      ) {
        throw new IdempotencyConflictError("Legacy import apply plan does not match its preview.");
      }
      const previewItems = allItemIds.length
        ? await sql<{ id: string; decision: string }>`
            SELECT id, decision
            FROM candidate_truth_import_preview_items
            WHERE preview_run_id = ${command.previewRunId}
              AND candidate_id = ${command.candidateId}
              AND id IN (${sql.join(allItemIds.map((id) => sql`${id}`))})
          `.execute(transaction)
        : { rows: [] };
      if (previewItems.rows.length !== allItemIds.length) {
        throw new ValidationError("Legacy import apply plan contains foreign or missing preview items.");
      }
      const batchIds = new Set(command.batches.flatMap((batch) => batch.previewItemIds));
      if (previewItems.rows.some((item) => batchIds.has(item.id) && item.decision !== "ELIGIBLE")) {
        throw new ValidationError("Only preview-eligible items may enter an import batch.");
      }

      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:legacy-apply-preview:${command.previewRunId}`})::bigint)`.execute(
        transaction
      );
      const existingResult = await sql<{
        id: string;
        apply_plan_fingerprint: string;
        source_snapshot_fingerprint: string;
        fingerprint_key_version: number;
      }>`
        SELECT id, apply_plan_fingerprint, source_snapshot_fingerprint, fingerprint_key_version
        FROM candidate_truth_import_apply_runs
        WHERE candidate_id = ${command.candidateId}
          AND preview_run_id = ${command.previewRunId}
        LIMIT 1
      `.execute(transaction);
      const existing = existingResult.rows[0];
      if (existing) {
        if (
          existing.apply_plan_fingerprint !== command.applyPlanFingerprint ||
          existing.source_snapshot_fingerprint !== command.sourceSnapshotFingerprint ||
          Number(existing.fingerprint_key_version) !== command.fingerprintKeyVersion
        ) {
          throw new IdempotencyConflictError("The preview already has a different apply plan.");
        }
        await sql`
          INSERT INTO candidate_truth_import_apply_receipts (
            candidate_id, idempotency_key, request_fingerprint, apply_run_id, created_at
          ) VALUES (
            ${command.candidateId}, ${command.idempotencyKey}, ${command.requestFingerprint},
            ${existing.id}, ${command.startedAt}
          )
        `.execute(transaction);
        return loadApplyResult(transaction, {
          candidateId: command.candidateId,
          applyRunId: existing.id,
          idempotentReplay: true
        });
      }

      const applyRunId = this.newId();
      await sql`
        INSERT INTO candidate_truth_import_apply_runs (
          id, candidate_id, preview_run_id, source_snapshot_fingerprint,
          fingerprint_key_version, apply_plan_fingerprint, status,
          examined_count, batch_count, started_at
        ) VALUES (
          ${applyRunId}, ${command.candidateId}, ${command.previewRunId},
          ${command.sourceSnapshotFingerprint}, ${command.fingerprintKeyVersion},
          ${command.applyPlanFingerprint}, 'PENDING', ${command.examinedCount},
          ${command.batches.length}, ${command.startedAt}
        )
      `.execute(transaction);
      for (const item of command.terminalItems) {
        await sql`
          INSERT INTO candidate_truth_import_reconciliations (
            id, candidate_id, apply_run_id, preview_item_id,
            outcome, reason_codes, created_at
          ) VALUES (
            ${this.newId()}, ${command.candidateId}, ${applyRunId}, ${item.previewItemId},
            ${item.outcome}, ${item.reasonCodes}, ${command.startedAt}
          )
        `.execute(transaction);
      }
      for (const batch of command.batches) {
        const batchId = this.newId();
        await sql`
          INSERT INTO candidate_truth_import_apply_batches (
            id, candidate_id, apply_run_id, batch_index, batch_fingerprint,
            item_count, status, created_at
          ) VALUES (
            ${batchId}, ${command.candidateId}, ${applyRunId}, ${batch.batchIndex},
            ${batch.batchFingerprint}, ${batch.previewItemIds.length}, 'PENDING',
            ${command.startedAt}
          )
        `.execute(transaction);
        for (const [batchOrdinal, previewItemId] of batch.previewItemIds.entries()) {
          await sql`
            INSERT INTO candidate_truth_import_apply_batch_items (
              candidate_id, apply_batch_id, preview_item_id, batch_ordinal
            ) VALUES (
              ${command.candidateId}, ${batchId}, ${previewItemId}, ${batchOrdinal}
            )
          `.execute(transaction);
        }
      }
      await sql`
        INSERT INTO candidate_truth_import_apply_receipts (
          candidate_id, idempotency_key, request_fingerprint, apply_run_id, created_at
        ) VALUES (
          ${command.candidateId}, ${command.idempotencyKey}, ${command.requestFingerprint},
          ${applyRunId}, ${command.startedAt}
        )
      `.execute(transaction);
      return loadApplyResult(transaction, {
        candidateId: command.candidateId,
        applyRunId,
        idempotentReplay: false
      });
    });
  }

  async completeBatch(
    command: CompleteLegacyImportBatchCommand
  ): Promise<LegacyImportApplyResult> {
    return this.database.transaction().execute(async (transaction) => {
      await assertActiveCandidate(transaction, command);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:legacy-apply-batch:${command.applyBatchId}`})::bigint)`.execute(
        transaction
      );
      const batchResult = await sql<{
        status: "PENDING" | "COMPLETED";
        batch_fingerprint: string;
      }>`
        SELECT batch.status, batch.batch_fingerprint
        FROM candidate_truth_import_apply_batches batch
        JOIN candidate_truth_import_apply_runs run
          ON run.id = batch.apply_run_id
         AND run.candidate_id = batch.candidate_id
        WHERE batch.id = ${command.applyBatchId}
          AND batch.apply_run_id = ${command.applyRunId}
          AND batch.candidate_id = ${command.candidateId}
        FOR UPDATE OF batch
      `.execute(transaction);
      const batch = batchResult.rows[0];
      if (!batch) throw new NotFoundError("Legacy import apply batch was not found.");
      const batchItems = await sql<{ preview_item_id: string }>`
        SELECT preview_item_id
        FROM candidate_truth_import_apply_batch_items
        WHERE apply_batch_id = ${command.applyBatchId}
          AND candidate_id = ${command.candidateId}
        ORDER BY batch_ordinal
      `.execute(transaction);
      const previewItemIds = batchItems.rows.map((item) => item.preview_item_id);
      if (
        batch.batch_fingerprint !== command.batchFingerprint ||
        !sameStringSet(previewItemIds, command.items.map((item) => item.previewItemId)) ||
        command.items.some(
          (item) =>
            !["IMPORTED", "ALREADY_IMPORTED", "CONFLICT", "INVALID"].includes(item.outcome) ||
            !validReasons(item.reasonCodes) ||
            ((item.outcome === "IMPORTED") !==
              Boolean(item.answerVersionId && item.candidateChangeSetId))
        )
      ) {
        throw new IdempotencyConflictError("Legacy import batch completion does not match its plan.");
      }
      if (batch.status === "COMPLETED") {
        const existing = await sql<{
          preview_item_id: string;
          outcome: string;
          reason_codes: string[];
          answer_version_id: string | null;
          candidate_change_set_id: string | null;
        }>`
          SELECT
            reconciliation.preview_item_id, reconciliation.outcome,
            reconciliation.reason_codes, reconciliation.answer_version_id,
            reconciliation.candidate_change_set_id
          FROM candidate_truth_import_reconciliations reconciliation
          JOIN candidate_truth_import_apply_batch_items item
            ON item.preview_item_id = reconciliation.preview_item_id
           AND item.apply_batch_id = ${command.applyBatchId}
          WHERE reconciliation.apply_run_id = ${command.applyRunId}
            AND reconciliation.candidate_id = ${command.candidateId}
        `.execute(transaction);
        const expected = [...command.items].sort((left, right) =>
          left.previewItemId.localeCompare(right.previewItemId)
        );
        const actual = existing.rows.sort((left, right) =>
          left.preview_item_id.localeCompare(right.preview_item_id)
        );
        if (
          actual.length !== expected.length ||
          actual.some((item, index) => {
            const wanted = expected[index];
            return (
              !wanted ||
              item.preview_item_id !== wanted.previewItemId ||
              item.outcome !== wanted.outcome ||
              !sameStringSet(item.reason_codes, wanted.reasonCodes) ||
              item.answer_version_id !== wanted.answerVersionId ||
              item.candidate_change_set_id !== wanted.candidateChangeSetId
            );
          })
        ) {
          throw new IdempotencyConflictError("Completed legacy import batch has different outcomes.");
        }
        return loadApplyResult(transaction, {
          candidateId: command.candidateId,
          applyRunId: command.applyRunId,
          idempotentReplay: true
        });
      }
      for (const item of command.items) {
        await sql`
          INSERT INTO candidate_truth_import_reconciliations (
            id, candidate_id, apply_run_id, preview_item_id, outcome,
            reason_codes, answer_version_id, candidate_change_set_id, created_at
          ) VALUES (
            ${this.newId()}, ${command.candidateId}, ${command.applyRunId},
            ${item.previewItemId}, ${item.outcome}, ${item.reasonCodes},
            ${item.answerVersionId}, ${item.candidateChangeSetId}, ${command.completedAt}
          )
        `.execute(transaction);
      }
      await sql`
        UPDATE candidate_truth_import_apply_batches
        SET status = 'COMPLETED', completed_at = ${command.completedAt}
        WHERE id = ${command.applyBatchId}
          AND status = 'PENDING'
      `.execute(transaction);
      return loadApplyResult(transaction, {
        candidateId: command.candidateId,
        applyRunId: command.applyRunId,
        idempotentReplay: false
      });
    });
  }

  async completeApply(input: {
    accountId: string;
    candidateId: string;
    applyRunId: string;
    completedAt: Date;
  }): Promise<LegacyImportApplyResult> {
    return this.database.transaction().execute(async (transaction) => {
      await assertActiveCandidate(transaction, input);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.candidateId}:legacy-apply-run:${input.applyRunId}`})::bigint)`.execute(
        transaction
      );
      const runResult = await sql<{ status: "PENDING" | "COMPLETED"; examined_count: number }>`
        SELECT status, examined_count
        FROM candidate_truth_import_apply_runs
        WHERE id = ${input.applyRunId}
          AND candidate_id = ${input.candidateId}
        LIMIT 1
        FOR UPDATE
      `.execute(transaction);
      const run = runResult.rows[0];
      if (!run) throw new NotFoundError("Legacy import apply run was not found.");
      if (run.status === "COMPLETED") {
        return loadApplyResult(transaction, {
          candidateId: input.candidateId,
          applyRunId: input.applyRunId,
          idempotentReplay: true
        });
      }
      const pending = await sql<{ count: string }>`
        SELECT count(*)::text AS count
        FROM candidate_truth_import_apply_batches
        WHERE apply_run_id = ${input.applyRunId}
          AND candidate_id = ${input.candidateId}
          AND status = 'PENDING'
      `.execute(transaction);
      if (pending.rows[0]?.count !== "0") {
        throw new ConflictError("Legacy import apply run still has pending batches.");
      }
      const countResult = await sql<{ outcome: LegacyImportReconciliationOutcome; count: string }>`
        SELECT outcome, count(*)::text AS count
        FROM candidate_truth_import_reconciliations
        WHERE apply_run_id = ${input.applyRunId}
          AND candidate_id = ${input.candidateId}
        GROUP BY outcome
      `.execute(transaction);
      const counts = Object.fromEntries(outcomes.map((outcome) => [outcome, 0])) as Record<
        LegacyImportReconciliationOutcome,
        number
      >;
      for (const row of countResult.rows) counts[row.outcome] = Number(row.count);
      const terminalCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
      if (terminalCount !== Number(run.examined_count)) {
        throw new ConflictError("Legacy import reconciliation is incomplete.", {
          examinedCount: Number(run.examined_count),
          terminalCount
        });
      }
      await sql`
        UPDATE candidate_truth_import_apply_runs
        SET
          status = 'COMPLETED', imported_count = ${counts.IMPORTED},
          already_imported_count = ${counts.ALREADY_IMPORTED},
          skipped_count = ${counts.SKIPPED},
          review_required_count = ${counts.REVIEW_REQUIRED},
          conflict_count = ${counts.CONFLICT}, invalid_count = ${counts.INVALID},
          unmappable_count = ${counts.UNMAPPABLE}, completed_at = ${input.completedAt}
        WHERE id = ${input.applyRunId}
          AND status = 'PENDING'
      `.execute(transaction);
      return loadApplyResult(transaction, {
        candidateId: input.candidateId,
        applyRunId: input.applyRunId,
        idempotentReplay: false
      });
    });
  }

  async verifyCompletedApply(input: {
    accountId: string;
    candidateId: string;
    applyRunId: string;
    verifiedAt: Date;
  }): Promise<LegacyImportVerificationReport> {
    await assertActiveCandidate(this.database, input);
    const runResult = await sql<ApplyRunRow>`
      SELECT
        id, candidate_id, preview_run_id, status, examined_count,
        imported_count, already_imported_count, skipped_count,
        review_required_count, conflict_count, invalid_count, unmappable_count,
        started_at, completed_at
      FROM candidate_truth_import_apply_runs
      WHERE id = ${input.applyRunId}
        AND candidate_id = ${input.candidateId}
      LIMIT 1
    `.execute(this.database);
    const run = runResult.rows[0];
    if (!run) throw new NotFoundError("Legacy import apply run was not found.");
    const violationCodes: string[] = [];
    if (run.status !== "COMPLETED") violationCodes.push("APPLY_RUN_NOT_COMPLETED");

    const countResult = await sql<{ outcome: LegacyImportReconciliationOutcome; count: string }>`
      SELECT outcome, count(*)::text AS count
      FROM candidate_truth_import_reconciliations
      WHERE apply_run_id = ${input.applyRunId}
        AND candidate_id = ${input.candidateId}
      GROUP BY outcome
    `.execute(this.database);
    const counts = Object.fromEntries(outcomes.map((outcome) => [outcome, 0])) as Record<
      LegacyImportReconciliationOutcome,
      number
    >;
    for (const row of countResult.rows) counts[row.outcome] = Number(row.count);
    const terminalCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (terminalCount !== Number(run.examined_count)) {
      violationCodes.push("TERMINAL_RECONCILIATION_TOTAL_MISMATCH");
    }
    const storedCounts = {
      IMPORTED: Number(run.imported_count),
      ALREADY_IMPORTED: Number(run.already_imported_count),
      SKIPPED: Number(run.skipped_count),
      REVIEW_REQUIRED: Number(run.review_required_count),
      CONFLICT: Number(run.conflict_count),
      INVALID: Number(run.invalid_count),
      UNMAPPABLE: Number(run.unmappable_count)
    };
    if (outcomes.some((outcome) => counts[outcome] !== storedCounts[outcome])) {
      violationCodes.push("STORED_RECONCILIATION_COUNTS_DRIFTED");
    }

    const coverage = await sql<{
      preview_count: string;
      reconciled_preview_count: string;
      foreign_preview_count: string;
    }>`
      SELECT
        (SELECT count(*)::text
         FROM candidate_truth_import_preview_items preview_item
         WHERE preview_item.preview_run_id = ${run.preview_run_id}
           AND preview_item.candidate_id = ${input.candidateId}) AS preview_count,
        (SELECT count(DISTINCT reconciliation.preview_item_id)::text
         FROM candidate_truth_import_reconciliations reconciliation
         JOIN candidate_truth_import_preview_items preview_item
           ON preview_item.id = reconciliation.preview_item_id
          AND preview_item.preview_run_id = ${run.preview_run_id}
         WHERE reconciliation.apply_run_id = ${input.applyRunId}
           AND reconciliation.candidate_id = ${input.candidateId}) AS reconciled_preview_count,
        (SELECT count(*)::text
         FROM candidate_truth_import_reconciliations reconciliation
         JOIN candidate_truth_import_preview_items preview_item
           ON preview_item.id = reconciliation.preview_item_id
         WHERE reconciliation.apply_run_id = ${input.applyRunId}
           AND reconciliation.candidate_id = ${input.candidateId}
           AND preview_item.preview_run_id <> ${run.preview_run_id}) AS foreign_preview_count
    `.execute(this.database);
    const coverageRow = coverage.rows[0];
    if (
      !coverageRow ||
      Number(coverageRow.preview_count) !== Number(run.examined_count) ||
      Number(coverageRow.reconciled_preview_count) !== Number(run.examined_count) ||
      Number(coverageRow.foreign_preview_count) !== 0
    ) {
      violationCodes.push("PREVIEW_RECONCILIATION_COVERAGE_INVALID");
    }

    const importedIntegrity = await sql<{
      invalid_count: string;
      version_count: string;
      change_set_count: string;
    }>`
      SELECT
        count(*) FILTER (WHERE
          version.id IS NULL
          OR version.candidate_id <> reconciliation.candidate_id
          OR version.source <> 'LEGACY_IMPORT'
          OR version.trust_state <> 'REVIEW'
          OR version.entity_id IS NOT NULL
          OR version.canonical_id IS DISTINCT FROM preview_item.target_canonical_id
          OR answer_scope.scope_type <> 'GLOBAL'
          OR answer_scope.company_id IS NOT NULL
          OR answer_scope.job_id IS NOT NULL
          OR answer_scope.application_id IS NOT NULL
          OR answer_scope.country_code IS NOT NULL
          OR answer_scope.role_family IS NOT NULL
          OR current_answer.answer_version_id IS DISTINCT FROM version.id
          OR change_set.id IS NULL
          OR change_set.source <> 'LEGACY_IMPORT'
          OR change_set_item.new_version_id IS DISTINCT FROM version.id
        )::text AS invalid_count,
        count(DISTINCT version.id)::text AS version_count,
        count(DISTINCT change_set.id)::text AS change_set_count
      FROM candidate_truth_import_reconciliations reconciliation
      JOIN candidate_truth_import_preview_items preview_item
        ON preview_item.id = reconciliation.preview_item_id
       AND preview_item.candidate_id = reconciliation.candidate_id
      LEFT JOIN candidate_answer_versions version
        ON version.id = reconciliation.answer_version_id
       AND version.candidate_id = reconciliation.candidate_id
      LEFT JOIN candidate_answer_scopes answer_scope
        ON answer_scope.id = version.scope_id
       AND answer_scope.candidate_id = version.candidate_id
      LEFT JOIN candidate_answers_current current_answer
        ON current_answer.answer_version_id = version.id
       AND current_answer.candidate_id = version.candidate_id
      LEFT JOIN candidate_answer_change_sets change_set
        ON change_set.id = reconciliation.candidate_change_set_id
       AND change_set.candidate_id = reconciliation.candidate_id
      LEFT JOIN candidate_answer_change_set_items change_set_item
        ON change_set_item.change_set_id = change_set.id
       AND change_set_item.new_version_id = version.id
       AND change_set_item.candidate_id = reconciliation.candidate_id
      WHERE reconciliation.apply_run_id = ${input.applyRunId}
        AND reconciliation.candidate_id = ${input.candidateId}
        AND reconciliation.outcome = 'IMPORTED'
    `.execute(this.database);
    const importedRow = importedIntegrity.rows[0];
    const importedVersionCount = Number(importedRow?.version_count ?? 0);
    const importedChangeSetCount = Number(importedRow?.change_set_count ?? 0);
    if (Number(importedRow?.invalid_count ?? 0) !== 0 || importedVersionCount !== counts.IMPORTED) {
      violationCodes.push("IMPORTED_CANDIDATE_TRUTH_INTEGRITY_INVALID");
    }

    const duplicateResult = await sql<{ count: string }>`
      SELECT count(*)::text AS count
      FROM (
        SELECT
          candidate_id, canonical_id,
          coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid) AS entity_key,
          scope_id
        FROM candidate_answers_current
        WHERE candidate_id = ${input.candidateId}
        GROUP BY candidate_id, canonical_id,
          coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), scope_id
        HAVING count(*) > 1
      ) duplicate
    `.execute(this.database);
    const duplicateCurrentAnswerCount = Number(duplicateResult.rows[0]?.count ?? 0);
    if (duplicateCurrentAnswerCount !== 0) violationCodes.push("DUPLICATE_CURRENT_CANDIDATE_ANSWERS");

    const guards = await sql<{ guarded_count: string }>`
      SELECT count(*)::text AS guarded_count
      FROM pg_class class
      JOIN pg_trigger trigger ON trigger.tgrelid = class.oid AND NOT trigger.tgisinternal
      WHERE
        (class.relname = 'candidate_answer_versions'
          AND trigger.tgname = 'candidate_answer_versions_mutation_guard')
        OR
        (class.relname = 'candidate_answer_change_set_items'
          AND trigger.tgname = 'candidate_answer_change_set_items_mutation_guard')
    `.execute(this.database);
    if (guards.rows[0]?.guarded_count !== "2") {
      violationCodes.push("CANDIDATE_TRUTH_APPEND_ONLY_GUARDS_MISSING");
    }

    const uniqueViolationCodes = [...new Set(violationCodes)].sort();
    return {
      candidateId: input.candidateId,
      previewRunId: run.preview_run_id,
      applyRunId: run.id,
      verified: uniqueViolationCodes.length === 0,
      examinedCount: Number(run.examined_count),
      terminalCount,
      counts,
      importedVersionCount,
      importedChangeSetCount,
      duplicateCurrentAnswerCount,
      violationCodes: uniqueViolationCodes,
      verifiedAt: input.verifiedAt
    };
  }
}

import { randomUUID } from "node:crypto";
import type { JobLifecycleRepository, JobSourceScanResult } from "@job-hunter-v2/job-intelligence";
import { IdempotencyConflictError, NotFoundError } from "@job-hunter-v2/domain";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

interface ScanReceiptRow {
  job_source_id: string;
  scan_complete: boolean;
  observed_identity_count: number;
  missing_incremented_count: number;
  stale_transition_count: number;
  expired_transition_count: number;
  request_fingerprint: string;
}

function replay(row: ScanReceiptRow): JobSourceScanResult {
  return {
    sourceId: row.job_source_id,
    scanComplete: row.scan_complete,
    observedIdentityCount: row.observed_identity_count,
    missingIncrementedCount: row.missing_incremented_count,
    staleTransitionCount: row.stale_transition_count,
    expiredTransitionCount: row.expired_transition_count,
    idempotentReplay: true
  };
}

export class KyselyJobLifecycleRepository implements JobLifecycleRepository {
  constructor(
    private readonly database: Kysely<V2Database>,
    private readonly newId: () => string = randomUUID
  ) {}

  async recordSourceScan(input: Parameters<JobLifecycleRepository["recordSourceScan"]>[0]): Promise<JobSourceScanResult> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`job-source-scan-receipt:${input.idempotencyKey}`}))`.execute(transaction);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`job-source-scan:${input.sourceType}:${input.sourceIdentifier}`}))`.execute(transaction);
      const receipt = await sql<ScanReceiptRow>`
        SELECT job_source_id, scan_complete, observed_identity_count, missing_incremented_count,
               stale_transition_count, expired_transition_count, request_fingerprint
        FROM job_source_scan_receipts WHERE idempotency_key = ${input.idempotencyKey}
      `.execute(transaction);
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_fingerprint !== input.requestFingerprint) {
          throw new IdempotencyConflictError("Job source scan idempotency key was reused for another scan.");
        }
        return replay(receipt.rows[0]);
      }
      const source = await sql<{ id: string }>`
        SELECT id FROM job_sources
        WHERE source_type = ${input.sourceType} AND source_identifier = ${input.sourceIdentifier}
        FOR UPDATE
      `.execute(transaction);
      const sourceId = source.rows[0]?.id;
      if (!sourceId) throw new NotFoundError("Job source was not found.");
      await sql`
        UPDATE job_sources SET last_checked_at = ${input.observedAt}
        WHERE id = ${sourceId}
      `.execute(transaction);

      if (input.observedSourceIdentityKeys.length > 0) {
        await sql`
          UPDATE job_source_job_states
          SET missing_observation_count = 0, updated_at = ${input.observedAt}
          WHERE job_source_id = ${sourceId}
            AND source_identity_key = ANY(${input.observedSourceIdentityKeys}::text[])
        `.execute(transaction);
      }
      let missingIncrementedCount = 0;
      if (input.complete) {
        const missing = await sql<{ job_id: string }>`
          UPDATE job_source_job_states
          SET missing_observation_count = missing_observation_count + 1,
              updated_at = ${input.observedAt}
          WHERE job_source_id = ${sourceId}
            AND NOT (source_identity_key = ANY(${input.observedSourceIdentityKeys}::text[]))
          RETURNING job_id
        `.execute(transaction);
        missingIncrementedCount = missing.rows.length;
      }

      const affected = await sql<{ job_id: string }>`
        SELECT DISTINCT job_id FROM job_source_job_states WHERE job_source_id = ${sourceId}
      `.execute(transaction);
      let staleTransitionCount = 0;
      let expiredTransitionCount = 0;
      const staleCutoff = new Date(input.observedAt.getTime() - input.staleAfterMilliseconds);
      for (const { job_id: jobId } of affected.rows) {
        const job = await sql<{ status: string; expires_at: Date | null }>`
          SELECT status, expires_at FROM jobs WHERE id = ${jobId} FOR UPDATE
        `.execute(transaction);
        const current = job.rows[0];
        if (!current || ["CLOSED", "REMOVED", "EXPIRED"].includes(current.status)) continue;
        let nextStatus: "STALE" | "EXPIRED" | null = null;
        let reasonCode = "";
        if (current.expires_at && current.expires_at <= input.observedAt) {
          nextStatus = "EXPIRED";
          reasonCode = "EXPLICIT_EXPIRY_REACHED";
          expiredTransitionCount += 1;
        } else if (input.complete && current.status === "ACTIVE") {
          const healthy = await sql<{ healthy: boolean }>`
            SELECT EXISTS (
              SELECT 1 FROM job_source_job_states state
              JOIN job_sources source ON source.id = state.job_source_id
              WHERE state.job_id = ${jobId} AND source.active
                AND (
                  state.missing_observation_count < ${input.staleAfterMissingScans}
                  OR state.last_observed_at > ${staleCutoff}
                )
            ) AS healthy
          `.execute(transaction);
          if (!healthy.rows[0]?.healthy) {
            nextStatus = "STALE";
            reasonCode = "REPEATED_COMPLETE_SCAN_MISS";
            staleTransitionCount += 1;
          }
        }
        if (nextStatus) {
          const closedAt = nextStatus === "EXPIRED" ? input.observedAt : null;
          await sql`
            UPDATE jobs SET status = ${nextStatus}, closed_at = ${closedAt}, updated_at = ${input.observedAt}
            WHERE id = ${jobId}
          `.execute(transaction);
          await sql`
            INSERT INTO job_lifecycle_events (
              id, job_id, from_status, to_status, reason_code, observed_at, created_at
            ) VALUES (
              ${this.newId()}, ${jobId}, ${current.status}, ${nextStatus}, ${reasonCode},
              ${input.observedAt}, ${input.observedAt}
            )
          `.execute(transaction);
        }
      }

      await sql`
        INSERT INTO job_source_scan_receipts (
          id, job_source_id, idempotency_key, request_fingerprint, scan_complete,
          observed_identity_count, missing_incremented_count, stale_transition_count,
          expired_transition_count, observed_at, created_at
        ) VALUES (
          ${input.receiptId}, ${sourceId}, ${input.idempotencyKey}, ${input.requestFingerprint},
          ${input.complete}, ${input.observedSourceIdentityKeys.length}, ${missingIncrementedCount},
          ${staleTransitionCount}, ${expiredTransitionCount}, ${input.observedAt}, ${input.observedAt}
        )
      `.execute(transaction);
      return {
        sourceId, scanComplete: input.complete,
        observedIdentityCount: input.observedSourceIdentityKeys.length,
        missingIncrementedCount, staleTransitionCount, expiredTransitionCount,
        idempotentReplay: false
      };
    });
  }
}

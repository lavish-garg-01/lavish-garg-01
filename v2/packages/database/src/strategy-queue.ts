import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";
import { z } from "zod";
import { ExecutionReceiptSchema, StrategyFeedbackSchema } from "@job-hunter-v2/contracts";

export const StrategyJobSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FEEDBACK"), accountId: z.uuid(), candidateId: z.uuid(), operationId: z.uuid(),
    observationId: z.uuid(), signal: StrategyFeedbackSchema }).strict(),
  z.object({ kind: z.literal("INGEST"), accountId: z.uuid(), candidateId: z.uuid(), receipt: ExecutionReceiptSchema }).strict(),
  z.object({ kind: z.literal("EVALUATE"), cluster: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
]);
export type StrategyJob = z.infer<typeof StrategyJobSchema>;

export async function enqueueStrategyJob(tx: Kysely<V2Database>, job: StrategyJob): Promise<void> {
  StrategyJobSchema.parse(job);
  await sql`INSERT INTO worker_jobs(id,job_type,payload_reference,max_attempts) VALUES
    (${crypto.randomUUID()},'Q_STRATEGY',${JSON.stringify(job)}::jsonb,8) ON CONFLICT DO NOTHING`.execute(tx);
}

/** PostgreSQL leases survive restart; completion is conditional on the exact lease token. */
export class StrategyJobQueue {
  constructor(private readonly db: Kysely<V2Database>) {}
  async claim(owner: string) {
    const rows = await sql<{ id: string; payload_reference: unknown; attempt_count: number }>`
      UPDATE worker_jobs SET status='PROCESSING',lease_owner=${owner},lease_expires_at=now()+interval '2 minutes',attempt_count=attempt_count+1
      WHERE id=(SELECT id FROM worker_jobs WHERE job_type='Q_STRATEGY' AND attempt_count<max_attempts
        AND ((status='PENDING' AND available_at<=now()) OR (status='PROCESSING' AND lease_expires_at<now()))
        ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id,payload_reference,attempt_count`.execute(this.db);
    return rows.rows[0] ?? null;
  }
  async finish(id: string, owner: string, error: boolean) {
    // An evaluator may have a newer pending successor. Keep failed work retryable without
    // conflicting with its unique pending key by retiring the redundant older evaluation.
    if (error) await sql`UPDATE worker_jobs failed SET status='COMPLETED',completed_at=now(),last_error_code='Q_SUPERSEDED'
      WHERE failed.id=${id} AND failed.lease_owner=${owner} AND failed.status='PROCESSING'
      AND failed.payload_reference->>'kind'='EVALUATE' AND EXISTS(SELECT 1 FROM worker_jobs next
        WHERE next.job_type='Q_STRATEGY' AND next.status='PENDING' AND next.payload_reference->>'kind'='EVALUATE'
        AND next.payload_reference->>'cluster'=failed.payload_reference->>'cluster')`.execute(this.db);
    await sql`UPDATE worker_jobs SET
      status=CASE WHEN ${error} THEN CASE WHEN attempt_count>=max_attempts THEN 'DEAD' ELSE 'PENDING' END ELSE 'COMPLETED' END,
      available_at=now()+interval '10 seconds',lease_owner=NULL,lease_expires_at=NULL,
      completed_at=CASE WHEN ${error} THEN NULL ELSE now() END,last_error_code=CASE WHEN ${error} THEN 'Q_JOB_FAILED' ELSE NULL END
      WHERE id=${id} AND lease_owner=${owner} AND status='PROCESSING'`.execute(this.db);
  }
  async runOne(handler: (job: StrategyJob, id: string) => Promise<void>): Promise<boolean> {
    // Exhausted expired leases cannot remain PROCESSING forever after a crash.
    await sql`UPDATE worker_jobs SET status='DEAD',last_error_code='Q_LEASE_EXHAUSTED'
      WHERE job_type='Q_STRATEGY' AND status='PROCESSING' AND lease_expires_at<now() AND attempt_count>=max_attempts`.execute(this.db);
    const owner = crypto.randomUUID(), row = await this.claim(owner);
    if (!row) return false;
    try { await handler(StrategyJobSchema.parse(row.payload_reference), row.id); await this.finish(row.id, owner, false); }
    catch { await this.finish(row.id, owner, true); }
    return true;
  }
}

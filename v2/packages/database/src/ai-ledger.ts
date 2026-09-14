import { randomUUID } from "node:crypto";
import type { AiLedger, AiReservation, AiEvent, AiScope } from "@job-hunter-v2/ai";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

export class KyselyAiLedger implements AiLedger {
  constructor(private readonly database: Kysely<V2Database>) {}
  async reserve(command: AiReservation) {
    return this.database.transaction().execute(async (tx) => {
      // Serialize the global operational cap across processes before provider dispatch.
      await sql`SELECT pg_advisory_xact_lock(hashtext('P_AI_DAILY_BUDGET')::bigint)`.execute(tx);
      const authority = await sql<{ id: string }>`
        SELECT id FROM candidates WHERE id = ${command.candidateId} AND account_id = ${command.accountId}
          AND (${command.applicationId}::uuid IS NULL OR EXISTS (
            SELECT 1 FROM applications WHERE id = ${command.applicationId}
              AND candidate_id = ${command.candidateId} AND account_id = ${command.accountId}
          ))
      `.execute(tx);
      if (!authority.rows.length) return "CONFLICT" as const;
      const prior = await sql<{ request_fingerprint: string }>`
        SELECT request_fingerprint FROM ai_request_reservations WHERE reservation_key = ${command.key}
      `.execute(tx);
      if (prior.rows[0]) return prior.rows[0].request_fingerprint === command.fingerprint ? "DUPLICATE" as const : "CONFLICT" as const;
      const totals = await sql<{ total: string; candidate: string; application: string }>`
        SELECT COALESCE(sum(reserved_micros),0)::text AS total,
          COALESCE(sum(reserved_micros) FILTER (WHERE candidate_id = ${command.candidateId}),0)::text AS candidate,
          COALESCE(sum(reserved_micros) FILTER (WHERE application_id = ${command.applicationId}),0)::text AS application
        FROM ai_request_reservations WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      `.execute(tx);
      const total = totals.rows[0]!;
      if (Number(total.total) + command.amountMicros > command.dailyLimitMicros
        || Number(total.candidate) + command.amountMicros > command.candidateLimitMicros
        || (command.applicationId && Number(total.application) + command.amountMicros > command.applicationLimitMicros)) return "BUDGET_EXCEEDED" as const;
      await sql`INSERT INTO ai_request_reservations (
        reservation_key, request_fingerprint, account_id, candidate_id, application_id, provider, model_profile, task_type, reserved_micros
      ) VALUES (${command.key}, ${command.fingerprint}, ${command.accountId}, ${command.candidateId}, ${command.applicationId},
        ${command.provider}, ${command.model}, ${command.taskType}, ${command.amountMicros})`.execute(tx);
      return "RESERVED" as const;
    });
  }
  async record(scope: AiScope, event: AiEvent): Promise<void> {
    for (const [index, attempt] of event.attempts.entries()) {
      await sql`INSERT INTO ai_usage_events (
        id, account_id, candidate_id, application_id, task_type, provider, model_profile,
        input_tokens, output_tokens, estimated_cost_minor, latency_ms, accepted, request_id,
        route_policy_version, task_version, schema_version, failure_code, confidence, cache_status,
        reserved_micros, usage_estimated, attempt_index
      ) VALUES (
        ${randomUUID()}, ${scope.accountId}, ${scope.candidateId}, ${scope.applicationId},
        ${event.taskType}, ${attempt.provider}, ${attempt.model}, ${attempt.usage?.inputTokens ?? 0},
        ${attempt.usage?.outputTokens ?? 0}, ${Math.ceil(attempt.chargedMicros / 10_000)},
        ${attempt.latencyMs}, ${attempt.failure === null}, ${event.requestId},
        ${event.policyVersion}, ${event.taskVersion}, ${event.schemaVersion},
        ${attempt.failure}, ${event.confidence}, ${event.cache}, ${attempt.chargedMicros}, ${attempt.usageEstimated}, ${index}
      ) ON CONFLICT (account_id, request_id, attempt_index) DO NOTHING`.execute(this.database);
    }
  }
}

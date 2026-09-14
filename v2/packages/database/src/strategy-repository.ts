import { sql, type Kysely } from "kysely";
import { BindingSchema, ClusterStateSchema, DefinitionSchema, StrategyEvidenceSchema, LifecycleCommandSchema, digest,
  type Binding, type Scope,
  type StrategyRepository, type ClusterState, type Definition, type StrategyEvidence, type Transition } from "@job-hunter-v2/strategy-intelligence";
import type { V2Database } from "./index.js";
import { enqueueStrategyJob, type StrategyJob } from "./strategy-queue.js";

export class KyselyStrategyRepository implements StrategyRepository {
  constructor(readonly database: Kysely<V2Database>) {}
  async bind(raw: Binding) {
    await this.bindMany([raw]);
  }
  async bindMany(raw: Binding[]) {
    const bindings = raw.map((b) => BindingSchema.parse(b));
    if (!bindings.length) return;
    if (bindings.length > 500 || new Set(bindings.map((b) => b.operationId)).size !== bindings.length) throw new Error("Q_INVALID_BINDING_BATCH");
    await this.database.transaction().execute(async (tx) => {
      const result = await sql<{ binding: unknown }>`
        WITH incoming AS (SELECT value AS binding FROM jsonb_array_elements(${JSON.stringify(bindings)}::jsonb)),
        authorized AS (SELECT i.binding FROM incoming i
          JOIN application_runs r ON r.id=(i.binding->>'applicationRunId')::uuid
          JOIN applications a ON a.id=r.application_id
          JOIN strategy_policy_clusters s ON s.cluster=i.binding->'selection'->>'cluster'
          WHERE a.account_id=(i.binding->>'accountId')::uuid AND a.candidate_id=(i.binding->>'candidateId')::uuid
            AND r.status='ACTIVE' AND s.revision=(i.binding->'selection'->>'revision')::integer)
        INSERT INTO strategy_execution_bindings(operation_id,account_id,candidate_id,run_id,cluster,binding)
        SELECT (binding->>'operationId')::uuid,(binding->>'accountId')::uuid,(binding->>'candidateId')::uuid,
          (binding->>'applicationRunId')::uuid,binding->'selection'->>'cluster',binding FROM authorized
        ON CONFLICT DO NOTHING RETURNING binding`.execute(tx);
      if (result.rows.length !== bindings.length) {
        for (const b of bindings) {
          const prior = await sql<{ binding: unknown }>`SELECT binding FROM strategy_execution_bindings WHERE operation_id=${b.operationId}`.execute(tx);
          if (!prior.rows[0] || digest(BindingSchema.parse(prior.rows[0].binding)) !== digest(b)) throw new Error("Q_BINDING_AUTHORITY_OR_REPLAY_CONFLICT");
        }
      }
    });
  }
  async binding(scope: Scope, operationId: string) {
    const result = await sql<{ binding: unknown }>`SELECT binding FROM strategy_execution_bindings
      WHERE operation_id=${operationId} AND account_id=${scope.accountId} AND candidate_id=${scope.candidateId}`.execute(this.database);
    return result.rows[0] ? BindingSchema.parse(result.rows[0].binding) : null;
  }
  async recordFeedback(job: Extract<StrategyJob, { kind: "FEEDBACK" }>) {
    const binding = await this.binding(job, job.operationId);
    if (!binding) return;
    const source = await sql<{ recorded_at: Date }>`SELECT recorded_at FROM candidate_learning_observations
      WHERE id=${job.observationId} AND candidate_id=${job.candidateId} AND run_id=${binding.applicationRunId}
      AND prior_operation_id=${binding.operationId} AND page_instance_id=${binding.pageInstanceId}
      AND field_runtime_id=${binding.fieldRuntimeId}`.execute(this.database);
    if (!source.rows[0]) throw new Error("Q_FEEDBACK_AUTHORITY_REQUIRED");
    const technical = await sql<{ evidence: unknown }>`SELECT evidence FROM strategy_performance_evidence WHERE operation_id=${job.operationId}
      AND evidence->>'evidenceKind'='TECHNICAL' ORDER BY (evidence->>'attempt')::integer LIMIT 1`.execute(this.database);
    if (!technical.rows[0]) throw new Error("Q_TECHNICAL_EVIDENCE_PENDING");
    const event = StrategyEvidenceSchema.parse(technical.rows[0].evidence);
    await this.append({ ...event, eventId: digest(["feedback", job.observationId]), evidenceKind: "FEEDBACK",
      occurredAt: new Date(source.rows[0].recorded_at).toISOString(), attribution: "USER", executed: false, verified: false,
      verifierFailed: false, durationMs: 0, fallback: false, feedback: job.signal.feedback,
      manualPattern: job.signal.pattern, manualCommitted: job.signal.committed });
  }
  async definitions() {
    const rows = await sql<{ q_definition: unknown }>`SELECT q_definition FROM strategy_versions WHERE q_definition IS NOT NULL ORDER BY strategy_key, version`.execute(this.database);
    return rows.rows.map((r) => DefinitionSchema.parse(r.q_definition));
  }
  async addDefinition(raw: Definition) {
    const definition = DefinitionSchema.parse(raw), [key, version] = definition.key.split("@");
    await this.database.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${definition.key})::bigint)`.execute(tx);
      const prior = await sql<{ q_definition: unknown }>`SELECT q_definition FROM strategy_versions WHERE strategy_key = ${key} AND version = ${Number(version)}`.execute(tx);
      if (prior.rows[0]) {
        if (digest(DefinitionSchema.parse(prior.rows[0].q_definition)) !== digest(definition)) throw new Error("Q_IMMUTABLE_DEFINITION_CONFLICT");
        return;
      }
      await sql`INSERT INTO strategy_versions (id,strategy_key,version,supported_widget,capability_version,declarative_plan,verification_plan,status,q_definition)
        VALUES (${crypto.randomUUID()},${key},${Number(version)},${definition.capabilities[0]},1,${JSON.stringify(definition.plan)}::jsonb,
          ${JSON.stringify({ verifier: definition.verifier })}::jsonb,${definition.origin === "BUILTIN" ? "ACTIVE" : "CANDIDATE"},${JSON.stringify(definition)}::jsonb)`.execute(tx);
    });
  }
  async read(cluster: string) {
    const result = await sql<{ state: unknown }>`SELECT state FROM strategy_policy_clusters WHERE cluster = ${cluster}`.execute(this.database);
    return result.rows[0] ? ClusterStateSchema.parse(result.rows[0].state) : null;
  }
  async create(raw: ClusterState) {
    const state = ClusterStateSchema.parse(raw);
    await sql`INSERT INTO strategy_policy_clusters(cluster,revision,state) VALUES (${state.cluster},${state.revision},${JSON.stringify(state)}::jsonb) ON CONFLICT DO NOTHING`.execute(this.database);
  }
  async transition(cluster: string, raw: Transition, mutate: (state: ClusterState) => ClusterState) {
    const command = LifecycleCommandSchema.parse(raw), fingerprint = digest(command);
    return this.database.transaction().execute(async (tx) => {
      const current = await sql<{ state: unknown; revision: number }>`SELECT state,revision FROM strategy_policy_clusters WHERE cluster=${cluster} FOR UPDATE`.execute(tx);
      if (!current.rows[0]) throw new Error("Q_CLUSTER_NOT_FOUND");
      const prior = await sql<{ state: unknown; command_fingerprint: string }>`SELECT state,command_fingerprint FROM strategy_policy_transitions WHERE cluster=${cluster} AND idempotency_key=${command.idempotencyKey}`.execute(tx);
      if (prior.rows[0]) {
        if (prior.rows[0].command_fingerprint !== fingerprint) throw new Error("Q_IDEMPOTENCY_CONFLICT");
        return ClusterStateSchema.parse(prior.rows[0].state);
      }
      if (current.rows[0].revision !== command.expectedRevision) throw new Error("Q_REVISION_CONFLICT");
      const state = ClusterStateSchema.parse({ ...mutate(ClusterStateSchema.parse(current.rows[0].state)), revision: command.expectedRevision + 1 });
      if (state.cluster !== cluster) throw new Error("Q_CLUSTER_CONFLICT");
      await sql`UPDATE strategy_policy_clusters SET state=${JSON.stringify(state)}::jsonb, revision=${state.revision}, updated_at=now() WHERE cluster=${cluster}`.execute(tx);
      await sql`INSERT INTO strategy_policy_transitions(cluster,idempotency_key,command_fingerprint,actor_id,reason,revision,state)
        VALUES (${cluster},${command.idempotencyKey},${fingerprint},${command.actorId},${command.reason},${state.revision},${JSON.stringify(state)}::jsonb)`.execute(tx);
      return state;
    });
  }
  async replay(cluster: string, raw: Transition) {
    const command = LifecycleCommandSchema.parse(raw);
    const prior = await sql<{ state: unknown; command_fingerprint: string }>`SELECT state,command_fingerprint
      FROM strategy_policy_transitions WHERE cluster=${cluster} AND idempotency_key=${command.idempotencyKey}`.execute(this.database);
    if (!prior.rows[0]) return null;
    if (prior.rows[0].command_fingerprint !== digest(command)) throw new Error("Q_IDEMPOTENCY_CONFLICT");
    return ClusterStateSchema.parse(prior.rows[0].state);
  }
  async append(raw: StrategyEvidence) {
    const e = StrategyEvidenceSchema.parse(raw);
    await this.database.transaction().execute(async (tx) => {
      const authority = await sql<{ binding: unknown }>`SELECT b.binding FROM strategy_execution_bindings b
        JOIN application_execution_evidence source ON source.operation_id=b.operation_id AND source.run_id=b.run_id
        WHERE b.operation_id=${e.operationId} AND b.account_id=${e.accountId} AND b.candidate_id=${e.candidateId}
          AND b.run_id=${e.applicationRunId} AND b.cluster=${e.cluster}`.execute(tx);
      if (!authority.rows.length) throw new Error("Q_EVIDENCE_AUTHORITY_REQUIRED");
      const binding = BindingSchema.parse(authority.rows[0]?.binding);
      if (!binding.selection.strategies.some((s) => s.key === e.key) || e.arm !== binding.selection.arm
        || e.experimentId !== binding.selection.experimentId) throw new Error("Q_ASSIGNMENT_MISMATCH");
      const inserted = await sql`INSERT INTO strategy_performance_evidence(event_id,operation_id,account_id,candidate_id,cluster,strategy_key,occurred_at,evidence)
        VALUES (${e.eventId},${e.operationId},${e.accountId},${e.candidateId},${e.cluster},${e.key},${e.occurredAt},${JSON.stringify(e)}::jsonb)
        ON CONFLICT DO NOTHING RETURNING event_id`.execute(tx);
      const prior = await sql<{ evidence: unknown }>`SELECT evidence FROM strategy_performance_evidence WHERE event_id=${e.eventId}`.execute(tx);
      if (digest(StrategyEvidenceSchema.parse(prior.rows[0]?.evidence)) !== digest(e)) throw new Error("Q_EVIDENCE_REPLAY_CONFLICT");
      if (inserted.rows.length) await enqueueStrategyJob(tx, { kind: "EVALUATE", cluster: e.cluster });
    });
  }
  async evidence(cluster: string, since: string) {
    // Non-contributing/test accounts never affect shared production preference.
    const result = await sql<{ evidence: unknown }>`SELECT e.evidence FROM strategy_performance_evidence e
      JOIN accounts a ON a.id=e.account_id WHERE e.cluster=${cluster} AND e.occurred_at>=${since}::timestamptz
      AND a.contributes_to_global_learning=true ORDER BY (e.evidence->>'severe'<>'NONE') DESC,e.occurred_at DESC,e.event_id LIMIT 10000`.execute(this.database);
    return result.rows.map((row) => StrategyEvidenceSchema.parse(row.evidence)).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId));
  }
}

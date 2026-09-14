import { randomUUID } from "node:crypto";
import type { DeclarationEvidenceRepository } from "@job-hunter-v2/declaration-policy";
import { ConflictError, IdempotencyConflictError } from "@job-hunter-v2/domain";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

export class KyselyDeclarationEvidenceRepository implements DeclarationEvidenceRepository {
  constructor(private readonly database: Kysely<V2Database>, private readonly newId: () => string = randomUUID) {}

  async record(command: Parameters<DeclarationEvidenceRepository["record"]>[0]) {
    return this.database.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:${command.idempotencyKey}`})::bigint)`.execute(transaction);
      const replay = await sql<{ id: string; request_fingerprint: string }>`
        SELECT id, request_fingerprint FROM application_declaration_evidence
        WHERE candidate_id = ${command.candidateId} AND idempotency_key = ${command.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      if (replay.rows[0]) {
        if (replay.rows[0].request_fingerprint !== command.requestFingerprint) {
          throw new IdempotencyConflictError("Declaration evidence key was reused with different input.");
        }
        return { evidenceId: replay.rows[0].id, idempotentReplay: true };
      }

      const request = command.request;
      const authority = await sql<{ id: string }>`
        SELECT application.id FROM applications application
        JOIN candidates candidate ON candidate.id = application.candidate_id AND candidate.account_id = application.account_id
        JOIN application_runs run ON run.application_id = application.id
        WHERE application.id = ${request.applicationId} AND run.id = ${request.applicationRunId}
          AND application.account_id = ${command.accountId} AND application.candidate_id = ${command.candidateId}
          AND (
            (${request.eventType} = 'SUBMISSION_VERIFIED' AND application.status = 'SUBMITTED' AND run.status = 'COMPLETED')
            OR (${request.eventType} <> 'SUBMISSION_VERIFIED' AND application.status IN ('IN_PROGRESS', 'REVIEW') AND run.status = 'ACTIVE')
          )
        LIMIT 1
      `.execute(transaction);
      if (!authority.rows[0]) throw new ConflictError("Declaration evidence belongs to a stale or foreign application run.");

      if (request.eventType !== "POLICY_DECIDED") {
        const decision = await sql<{ id: string }>`
          SELECT id FROM application_declaration_evidence
          WHERE account_id = ${command.accountId} AND candidate_id = ${command.candidateId}
            AND application_id = ${request.applicationId} AND run_id = ${request.applicationRunId}
            AND page_instance_id = ${request.pageInstanceId} AND form_instance_id = ${request.formInstanceId}
            AND field_runtime_id = ${request.fieldRuntimeId} AND control_fingerprint = ${request.controlFingerprint}
            AND descriptor_fingerprint = ${request.descriptorFingerprint}
            AND graph_revision = ${request.graphGuard.graphRevision} AND graph_fingerprint = ${request.graphGuard.graphFingerprint}
            AND declaration_type = ${request.declarationType} AND policy_version = ${request.policyVersion}
            AND policy_decision = ${request.policyDecision} AND decision_fingerprint = ${request.decisionFingerprint}
            AND event_type = 'POLICY_DECIDED'
          LIMIT 1
        `.execute(transaction);
        if (!decision.rows[0]) throw new ConflictError("Declaration evidence has no matching policy decision authority.");
      }

      const evidenceId = this.newId();
      await sql`
        INSERT INTO application_declaration_evidence (
          id, account_id, candidate_id, application_id, run_id, evidence_event_id,
          idempotency_key, request_fingerprint, page_instance_id, form_instance_id,
          field_runtime_id, control_fingerprint, descriptor_fingerprint, graph_revision,
          graph_fingerprint, declaration_type, semantic_confidence, policy_version,
          policy_decision, decision_fingerprint, event_type, action_origin, operation_id,
          execution_status, verification_status, failure_code, required, candidate_modified,
          final_review_state, checkpoint_id, occurred_at, recorded_at
        ) VALUES (
          ${evidenceId}, ${command.accountId}, ${command.candidateId}, ${request.applicationId},
          ${request.applicationRunId}, ${request.evidenceEventId}, ${command.idempotencyKey},
          ${command.requestFingerprint}, ${request.pageInstanceId}, ${request.formInstanceId},
          ${request.fieldRuntimeId}, ${request.controlFingerprint}, ${request.descriptorFingerprint},
          ${request.graphGuard.graphRevision}, ${request.graphGuard.graphFingerprint},
          ${request.declarationType}, ${request.semanticConfidence}, ${request.policyVersion},
          ${request.policyDecision}, ${request.decisionFingerprint}, ${request.eventType},
          ${request.actionOrigin}, ${request.operationId}, ${request.executionStatus},
          ${request.verificationStatus}, ${request.failureCode}, ${request.required},
          ${request.candidateModified}, ${request.finalReviewState}, ${request.checkpointId},
          ${request.occurredAt}, ${command.recordedAt}
        )
      `.execute(transaction);
      return { evidenceId, idempotentReplay: false };
    });
  }
}

import { createHash, randomUUID } from "node:crypto";
import { inTransaction } from "./transaction-scope.js";
import {
  hydrateCandidateAnswerScope,
  type CandidateAnswerScope,
  type CandidateCurrentAnswer
} from "@job-hunter-v2/candidate-truth";
import { ConflictError, IdempotencyConflictError, NotFoundError, ValidationError } from "@job-hunter-v2/domain";
import type {
  FinalizeLearningCheckpointInput,
  LearningCheckpointAuthority,
  LearningAnswerAuthority,
  LearningRunContext,
  PendingLearningObservation,
  RecordLearningObservationCommand,
  VerifiedLearningRepository
} from "@job-hunter-v2/verified-learning";
import { sql, type Kysely } from "kysely";
import { KyselyCandidateTruthRepository, type V2Database } from "./index.js";
import { enqueueStrategyJob } from "./strategy-queue.js";

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.startsWith("{")) return value.slice(1, -1).split(",").filter(Boolean);
  return [];
}

function candidateEntityRevision(entityId: string, version: number, canonicalKeys: unknown, valueFingerprints: unknown): string {
  return createHash("sha256").update(JSON.stringify({
    entityId,
    version,
    canonicals: stringArray(canonicalKeys).sort(),
    fingerprints: stringArray(valueFingerprints).sort()
  })).digest("hex");
}

export class KyselyVerifiedLearningRepository implements VerifiedLearningRepository {
  private readonly truth: KyselyCandidateTruthRepository;

  constructor(private readonly database: Kysely<V2Database>, private readonly newId: () => string = randomUUID, private readonly strategyEvidenceEnabled = false) {
    this.truth = new KyselyCandidateTruthRepository(database, newId);
  }

  async startRun(input: Parameters<VerifiedLearningRepository["startRun"]>[0]) {
    return inTransaction(this.database, async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.candidateId}:${input.idempotencyKey}`})::bigint)`.execute(transaction);
      const replay = await sql<{ application_id: string; run_id: string; request_fingerprint: string }>`
        SELECT application_id, run_id, request_fingerprint
        FROM candidate_learning_run_receipts
        WHERE candidate_id = ${input.candidateId} AND idempotency_key = ${input.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      if (replay.rows[0]) {
        if (replay.rows[0].request_fingerprint !== input.requestFingerprint) throw new IdempotencyConflictError("Learning-run key was reused with different input.");
        return { applicationId: replay.rows[0].application_id, runId: replay.rows[0].run_id, idempotentReplay: true };
      }
      const candidate = await sql<{ id: string }>`
        SELECT candidate.id FROM candidates candidate JOIN accounts account ON account.id = candidate.account_id
        WHERE candidate.id = ${input.candidateId} AND candidate.account_id = ${input.accountId}
          AND candidate.status = 'ACTIVE' AND account.status = 'ACTIVE'
      `.execute(transaction);
      if (!candidate.rows[0]) throw new NotFoundError("Active candidate was not found.");
      if (input.request.jobId) {
        const job = await sql<{ id: string }>`SELECT id FROM jobs WHERE id = ${input.request.jobId} AND status = 'ACTIVE'`.execute(transaction);
        if (!job.rows[0]) throw new NotFoundError("The application job is unavailable.");
      }
      await sql`
        INSERT INTO applications (id, account_id, candidate_id, job_id, target_url, status, created_at, updated_at)
        VALUES (${input.applicationId}, ${input.accountId}, ${input.candidateId}, ${input.request.jobId}, ${input.request.targetUrl}, 'IN_PROGRESS', ${input.startedAt}, ${input.startedAt})
      `.execute(transaction);
      await sql`
        INSERT INTO application_runs (id, application_id, protocol_version, extension_version, status, last_sequence, started_at)
        VALUES (${input.runId}, ${input.applicationId}, ${input.request.protocolVersion}, ${input.request.extensionVersion}, 'ACTIVE', 0, ${input.startedAt})
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_learning_run_receipts (id, candidate_id, application_id, run_id, idempotency_key, request_fingerprint, created_at)
        VALUES (${this.newId()}, ${input.candidateId}, ${input.applicationId}, ${input.runId}, ${input.idempotencyKey}, ${input.requestFingerprint}, ${input.startedAt})
      `.execute(transaction);
      return { applicationId: input.applicationId, runId: input.runId, idempotentReplay: false };
    });
  }

  async runContext(input: { accountId: string; candidateId: string; applicationId: string; runId: string }): Promise<LearningRunContext> {
    const result = await sql<{
      application_id: string; run_id: string; job_id: string | null; company_id: string | null;
      country_code: string | null; role_family: string | null; run_status: LearningRunContext["status"];
    }>`
      SELECT application.id AS application_id, run.id AS run_id, application.job_id,
        job.company_id, COALESCE(job.country_code, job.country_codes[1], job.remote_country_codes[1]) AS country_code,
        job.role_family, run.status AS run_status
      FROM applications application
      JOIN candidates candidate ON candidate.id = application.candidate_id AND candidate.account_id = application.account_id
      JOIN application_runs run ON run.application_id = application.id
      LEFT JOIN jobs job ON job.id = application.job_id
      WHERE application.id = ${input.applicationId} AND run.id = ${input.runId}
        AND application.candidate_id = ${input.candidateId} AND application.account_id = ${input.accountId}
      LIMIT 1
    `.execute(this.database);
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Application run was not found.");
    return { applicationId: row.application_id, runId: row.run_id, jobId: row.job_id, companyId: row.company_id, countryCode: row.country_code, roleFamily: row.role_family, status: row.run_status };
  }

  async answerAuthority(input: { accountId: string; candidateId: string; answerVersionId: string }): Promise<LearningAnswerAuthority | null> {
    const result = await sql<{
      answer_version_id: string; canonical_key: string; entity_id: string | null; scope_type: CandidateAnswerScope["scopeType"];
      scope_fingerprint: string; company_id: string | null; job_id: string | null; application_id: string | null;
      country_code: string | null; role_family: string | null; current: boolean;
    }>`
      SELECT version.id AS answer_version_id, canonical.canonical_key, version.entity_id,
        answer_scope.scope_type, answer_scope.scope_fingerprint, answer_scope.company_id, answer_scope.job_id,
        answer_scope.application_id, answer_scope.country_code, answer_scope.role_family,
        (current_answer.answer_version_id IS NOT NULL) AS current
      FROM candidate_answer_versions version
      JOIN candidates candidate ON candidate.id = version.candidate_id
      JOIN canonical_fields canonical ON canonical.id = version.canonical_id
      JOIN candidate_answer_scopes answer_scope ON answer_scope.id = version.scope_id
      LEFT JOIN candidate_answers_current current_answer ON current_answer.answer_version_id = version.id
      WHERE version.id = ${input.answerVersionId} AND version.candidate_id = ${input.candidateId}
        AND candidate.account_id = ${input.accountId} AND version.trust_state <> 'REMOVED'
      LIMIT 1
    `.execute(this.database);
    const row = result.rows[0];
    if (!row) return null;
    return {
      answerVersionId: row.answer_version_id,
      canonicalKey: row.canonical_key,
      entityId: row.entity_id,
      current: row.current,
      scope: hydrateCandidateAnswerScope({ scopeType: row.scope_type, scopeFingerprint: row.scope_fingerprint, context: {
        ...(row.company_id ? { companyId: row.company_id } : {}), ...(row.job_id ? { jobId: row.job_id } : {}),
        ...(row.application_id ? { applicationId: row.application_id } : {}), ...(row.country_code ? { countryCode: row.country_code } : {}),
        ...(row.role_family ? { roleFamily: row.role_family } : {})
      } })
    };
  }

  findCurrent(input: { accountId: string; candidateId: string; canonicalKey: string; entityId: string | null; scopeFingerprint: string }): Promise<CandidateCurrentAnswer | null> {
    return this.truth.findCurrent(input);
  }

  async recordExecutionEvidence(input: Parameters<VerifiedLearningRepository["recordExecutionEvidence"]>[0]) {
    return inTransaction(this.database, async (transaction) => {
      const receipt = input.request.receipt;
      await sql`SELECT pg_advisory_xact_lock(hashtext(${receipt.operationId})::bigint)`.execute(transaction);
      const replay = await sql<{ id: string; request_fingerprint: string }>`
        SELECT id, request_fingerprint FROM application_execution_evidence
        WHERE run_id = ${input.request.applicationRunId} AND operation_id = ${receipt.operationId}
        LIMIT 1
      `.execute(transaction);
      if (replay.rows[0]) {
        if (replay.rows[0].request_fingerprint !== input.requestFingerprint) throw new IdempotencyConflictError("Execution evidence replay changed its receipt.");
        return { evidenceId: replay.rows[0].id, idempotentReplay: true };
      }
      const authority = await sql<{ canonical_id: number }>`
        SELECT version.canonical_id
        FROM applications application
        JOIN application_runs run ON run.application_id = application.id
        JOIN candidates candidate ON candidate.id = application.candidate_id AND candidate.account_id = application.account_id
        JOIN candidate_answer_versions version ON version.id = ${receipt.answerVersionId} AND version.candidate_id = application.candidate_id
        JOIN canonical_fields canonical ON canonical.id = version.canonical_id AND canonical.canonical_key = ${receipt.canonicalKey}
        JOIN candidate_answer_scopes answer_scope ON answer_scope.id = version.scope_id AND answer_scope.scope_fingerprint = ${receipt.answerScopeFingerprint}
        WHERE application.id = ${input.request.applicationId} AND run.id = ${input.request.applicationRunId}
          AND application.candidate_id = ${input.candidateId} AND application.account_id = ${input.accountId}
          AND run.status = 'ACTIVE'
        LIMIT 1
      `.execute(transaction);
      if (!authority.rows[0]) throw new ValidationError("Execution receipt lacks application and Candidate Truth authority.");
      const evidenceId = this.newId();
      await sql`
        INSERT INTO application_execution_evidence (
          id, candidate_id, application_id, run_id, operation_id, page_instance_id, field_runtime_id,
          canonical_id, answer_version_id, representation_id, execution_status, verification_status,
          failure_class, strategy_id, request_fingerprint, recorded_at
        ) VALUES (
          ${evidenceId}, ${input.candidateId}, ${input.request.applicationId}, ${input.request.applicationRunId},
          ${receipt.operationId}, ${receipt.pageInstanceId}, ${receipt.fieldRuntimeId}, ${authority.rows[0].canonical_id},
          ${receipt.answerVersionId}, ${receipt.representationId}, ${receipt.status}, ${receipt.verificationStatus},
          ${receipt.failureClass}, ${receipt.selectedStrategyId}, ${input.requestFingerprint}, ${input.recordedAt}
        )
      `.execute(transaction);
      if (this.strategyEvidenceEnabled) await enqueueStrategyJob(transaction, { kind: "INGEST", accountId: input.accountId, candidateId: input.candidateId, receipt });
      return { evidenceId, idempotentReplay: false };
    });
  }

  async recordObservation(command: RecordLearningObservationCommand) {
    return inTransaction(this.database, async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:${command.idempotencyKey}`})::bigint)`.execute(transaction);
      const replay = await sql<{ id: string; request_fingerprint: string }>`
        SELECT id, request_fingerprint FROM candidate_learning_observations
        WHERE candidate_id = ${command.candidateId} AND idempotency_key = ${command.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      if (replay.rows[0]) {
        if (replay.rows[0].request_fingerprint !== command.requestFingerprint && !command.verificationRequestFingerprints?.includes(replay.rows[0].request_fingerprint)) throw new IdempotencyConflictError("Learning observation key was reused with different input.");
        return { observationId: replay.rows[0].id, idempotentReplay: true };
      }
      const authority = await sql<{ canonical_id: number; policy_id: string; scope_id: string }>`
        SELECT canonical.id AS canonical_id, policy.id AS policy_id, answer_scope.id AS scope_id
        FROM applications application
        JOIN application_runs run ON run.application_id = application.id
        JOIN candidates candidate ON candidate.id = application.candidate_id AND candidate.account_id = application.account_id
        JOIN canonical_fields canonical ON canonical.canonical_key = ${command.request.canonicalKey} AND canonical.status = 'ACTIVE'
        JOIN canonical_answer_policies policy ON policy.canonical_id = canonical.id AND policy.active
        LEFT JOIN candidate_answer_scopes answer_scope ON answer_scope.candidate_id = application.candidate_id
          AND answer_scope.scope_type = ${command.scope.scopeType} AND answer_scope.scope_fingerprint = ${command.scope.scopeFingerprint}
        WHERE application.id = ${command.request.applicationId} AND run.id = ${command.request.applicationRunId}
          AND application.candidate_id = ${command.candidateId} AND application.account_id = ${command.accountId}
          AND application.status IN ('IN_PROGRESS', 'REVIEW') AND run.status = 'ACTIVE'
        LIMIT 1
      `.execute(transaction);
      if (!authority.rows[0]) throw new ConflictError("Learning observation belongs to a stale or foreign application run.");
      let scopeId = authority.rows[0].scope_id;
      if (!scopeId) {
        scopeId = this.newId();
        await sql`
          INSERT INTO candidate_answer_scopes (
            id, candidate_id, scope_type, scope_fingerprint, company_id, job_id, application_id,
            country_code, role_family, created_at
          ) VALUES (
            ${scopeId}, ${command.candidateId}, ${command.scope.scopeType}, ${command.scope.scopeFingerprint},
            ${command.scope.companyId ?? null}, ${command.scope.jobId ?? null}, ${command.scope.applicationId ?? null},
            ${command.scope.countryCode ?? null}, ${command.scope.roleFamily ?? null}, ${command.recordedAt}
          )
        `.execute(transaction);
      }
      if (command.entityId) {
        const entity = await sql<{ id: string; entity_version: number | string; canonical_keys: unknown; value_fingerprints: unknown }>`
          SELECT entity.id, entity.entity_version,
            coalesce(array_agg(DISTINCT canonical.canonical_key) FILTER (WHERE canonical.canonical_key IS NOT NULL), '{}'::text[]) AS canonical_keys,
            coalesce(array_agg(DISTINCT version.value_fingerprint) FILTER (WHERE version.value_fingerprint IS NOT NULL), '{}'::text[]) AS value_fingerprints
          FROM candidate_entities entity
          LEFT JOIN candidate_answers_current current_answer ON current_answer.candidate_id = entity.candidate_id AND current_answer.entity_id = entity.id
          LEFT JOIN candidate_answer_versions version ON version.id = current_answer.answer_version_id
          LEFT JOIN canonical_fields canonical ON canonical.id = current_answer.canonical_id
          WHERE entity.id = ${command.entityId} AND entity.candidate_id = ${command.candidateId} AND entity.status = 'ACTIVE'
          GROUP BY entity.id
        `.execute(transaction);
        const currentEntity = entity.rows[0];
        const expected = command.request.entityIntelligence;
        if (!currentEntity || !expected || Number(currentEntity.entity_version) !== expected.candidateEntityVersion ||
          candidateEntityRevision(currentEntity.id, Number(currentEntity.entity_version), currentEntity.canonical_keys, currentEntity.value_fingerprints) !== expected.candidateEntityRevision) {
          throw new ValidationError("Learning observation has a stale or inactive stable entity binding.");
        }
      }
      if (command.request.priorOperationId) {
        const execution = await sql<{ id: string }>`
          SELECT id FROM application_execution_evidence
          WHERE run_id = ${command.request.applicationRunId} AND operation_id = ${command.request.priorOperationId}
            AND field_runtime_id = ${command.request.fieldRuntimeId}
            AND answer_version_id = ${command.request.answerVersionId}
            AND verification_status = ${command.request.priorVerificationStatus}
            AND failure_class IS NOT DISTINCT FROM ${command.request.priorFailureClass}
          LIMIT 1
        `.execute(transaction);
        if (!execution.rows[0]) throw new ValidationError("Correction attribution lacks its exact persisted execution receipt.");
      }
      const proposalId = this.newId();
      const combinedCiphertext = Buffer.concat([Buffer.from(command.encryptedPayload.authenticationTag), Buffer.from(command.encryptedPayload.ciphertext)]);
      await sql`
        INSERT INTO candidate_answer_runtime_proposals (
          id, candidate_id, application_id, canonical_id, scope_id, value_fingerprint,
          fingerprint_key_version, normalized_value_encrypted, encryption_algorithm,
          encryption_key_version, encryption_nonce, source_revision_id, status, expires_at, created_at
        ) VALUES (
          ${proposalId}, ${command.candidateId}, ${command.request.applicationId}, ${authority.rows[0].canonical_id},
          ${scopeId}, ${command.valueFingerprint}, ${command.fingerprintKeyVersion}, ${combinedCiphertext},
          'AES_256_GCM', ${command.encryptedPayload.keyVersion}, ${Buffer.from(command.encryptedPayload.initializationVector)},
          ${command.request.observationId}, 'PENDING', ${command.expiresAt}, ${command.recordedAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_learning_observations (
          id, candidate_id, application_id, run_id, proposal_id, page_instance_id, form_instance_id,
          field_runtime_id, control_fingerprint, canonical_id, entity_id, expected_entity_version,
          entity_binding_revision, scope_id, used_answer_version_id,
          prior_operation_id, origin, observation_type, attribution, semantic_descriptor_fingerprint,
          semantic_confidence, semantic_resolver, final_value_fingerprint, fingerprint_key_version,
          expected_current_version_id, idempotency_key, request_fingerprint, status, recorded_at, expires_at
        ) VALUES (
          ${command.request.observationId}, ${command.candidateId}, ${command.request.applicationId},
          ${command.request.applicationRunId}, ${proposalId}, ${command.request.pageInstanceId},
          ${command.request.formInstanceId}, ${command.request.fieldRuntimeId}, ${command.request.controlFingerprint},
          ${authority.rows[0].canonical_id}, ${command.entityId}, ${command.request.entityIntelligence?.candidateEntityVersion ?? null},
          ${command.request.entityIntelligence?.candidateEntityRevision ?? null}, ${scopeId}, ${command.request.answerVersionId},
          ${command.request.priorOperationId}, ${command.request.origin}, ${command.request.observationType},
          ${command.attribution}, ${command.request.descriptorFingerprint}, ${command.request.semanticConfidence},
          ${command.request.semanticResolver}, ${command.valueFingerprint}, ${command.fingerprintKeyVersion},
          ${command.expectedCurrentVersionId}, ${command.idempotencyKey}, ${command.requestFingerprint},
          'RECORDED', ${command.recordedAt}, ${command.expiresAt}
        )
      `.execute(transaction);
      const sequence = await sql<{ last_sequence: string }>`
        UPDATE application_runs SET last_sequence = last_sequence + 1
        WHERE id = ${command.request.applicationRunId} AND application_id = ${command.request.applicationId} AND status = 'ACTIVE'
        RETURNING last_sequence
      `.execute(transaction);
      if (!sequence.rows[0]) throw new ConflictError("Application run ended before observation commit.");
      await sql`
        INSERT INTO application_events (id, application_id, run_id, sequence, event_type, reason_code, structural_metadata, occurred_at)
        VALUES (
          ${this.newId()}, ${command.request.applicationId}, ${command.request.applicationRunId},
          ${Number(sequence.rows[0].last_sequence)}, 'LEARNING_OBSERVATION_RECORDED', ${command.attribution},
          CAST(${JSON.stringify({ observationId: command.request.observationId, canonicalKey: command.request.canonicalKey, origin: command.request.origin, fieldRuntimeId: command.request.fieldRuntimeId })} AS jsonb),
          ${command.recordedAt}
        )
      `.execute(transaction);
      if (this.strategyEvidenceEnabled && command.request.priorOperationId && command.request.strategyFeedback) {
        await enqueueStrategyJob(transaction, { kind: "FEEDBACK", accountId: command.accountId, candidateId: command.candidateId,
          operationId: command.request.priorOperationId, observationId: command.request.observationId, signal: command.request.strategyFeedback });
      }
      return { observationId: command.request.observationId, idempotentReplay: false };
    });
  }

  async recordSubmitAttempt(input: Parameters<VerifiedLearningRepository["recordSubmitAttempt"]>[0]) {
    return inTransaction(this.database, async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.candidateId}:${input.idempotencyKey}`})::bigint)`.execute(transaction);
      const replay = await sql<{ id: string; request_fingerprint: string }>`
        SELECT id, request_fingerprint FROM candidate_learning_submit_attempts
        WHERE candidate_id = ${input.candidateId} AND idempotency_key = ${input.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      if (replay.rows[0]) {
        if (replay.rows[0].request_fingerprint !== input.requestFingerprint) {
          throw new IdempotencyConflictError("Submit-attempt key was reused with different input.");
        }
        return { submitAttemptId: replay.rows[0].id, idempotentReplay: true };
      }
      const occurredAt = new Date(input.request.occurredAt);
      if (Math.abs(input.recordedAt.getTime() - occurredAt.getTime()) > 5 * 60_000) {
        throw new ValidationError("Submit-attempt time is outside the accepted clock window.");
      }
      const authority = await sql<{ run_id: string }>`
        SELECT run.id AS run_id
        FROM applications application
        JOIN application_runs run ON run.application_id = application.id
        WHERE application.id = ${input.request.applicationId}
          AND run.id = ${input.request.applicationRunId}
          AND application.candidate_id = ${input.candidateId}
          AND application.account_id = ${input.accountId}
          AND application.status IN ('IN_PROGRESS', 'REVIEW')
          AND run.status = 'ACTIVE'
        LIMIT 1
      `.execute(transaction);
      if (!authority.rows[0]) throw new ConflictError("Submit attempt belongs to a stale or foreign application run.");
      await sql`
        INSERT INTO candidate_learning_submit_attempts (
          id, candidate_id, application_id, run_id, page_instance_id, form_instance_id,
          idempotency_key, request_fingerprint, occurred_at
        ) VALUES (
          ${input.submitAttemptId}, ${input.candidateId}, ${input.request.applicationId},
          ${input.request.applicationRunId}, ${input.request.pageInstanceId}, ${input.request.formInstanceId},
          ${input.idempotencyKey}, ${input.requestFingerprint}, ${occurredAt}
        )
      `.execute(transaction);
      return { submitAttemptId: input.submitAttemptId, idempotentReplay: false };
    });
  }

  async verifySubmissionCheckpoint(
    input: Parameters<VerifiedLearningRepository["verifySubmissionCheckpoint"]>[0]
  ): Promise<LearningCheckpointAuthority> {
    return inTransaction(this.database, async (transaction) => {
      const owned = await sql`SELECT id FROM applications WHERE id = ${input.request.applicationId} AND candidate_id = ${input.candidateId} AND account_id = ${input.accountId}`.execute(transaction);
      if (!owned.rows.length) throw new NotFoundError("Application checkpoint not found.");
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.candidateId}:${input.idempotencyKey}`})::bigint)`.execute(transaction);
      const replay = await sql<{
        checkpoint_id: string;
        finalized_at: Date | null;
        checkpoint_status: "VERIFIED" | "REJECTED";
        change_set_id: string | null;
        saved_count: number;
        ask_again_count: number;
        skipped_count: number;
        conflict_count: number;
        request_fingerprint: string;
      }>`
        SELECT checkpoint_id, checkpoint_status, change_set_id, saved_count, ask_again_count,
          skipped_count, conflict_count, request_fingerprint, finalized_at
        FROM candidate_learning_checkpoint_receipts
        WHERE candidate_id = ${input.candidateId} AND idempotency_key = ${input.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      const replayRow = replay.rows[0];
      if (replayRow) {
        if (replayRow.request_fingerprint !== input.requestFingerprint) {
          throw new IdempotencyConflictError("Checkpoint key was reused with different submission evidence.");
        }
        return {
          checkpointId: replayRow.checkpoint_id,
          finalized: Boolean(replayRow.finalized_at),
          checkpointStatus: replayRow.checkpoint_status,
          changeSetId: replayRow.change_set_id,
          saved: replayRow.saved_count,
          askAgain: replayRow.ask_again_count,
          skipped: replayRow.skipped_count,
          conflicts: replayRow.conflict_count,
          idempotentReplay: true
        };
      }
      const attemptedAt = new Date(input.request.signal.trustedSubmitObservedAt);
      const clientVerifiedAt = new Date(input.request.signal.verifiedAt);
      if (
        clientVerifiedAt.getTime() < attemptedAt.getTime() ||
        input.verifiedAt.getTime() < attemptedAt.getTime() ||
        input.verifiedAt.getTime() - attemptedAt.getTime() > 15 * 60_000 ||
        Math.abs(input.verifiedAt.getTime() - clientVerifiedAt.getTime()) > 5 * 60_000
      ) {
        throw new ValidationError("Submission success signal is not bound to a recent trusted submit attempt.");
      }
      const attempt = await sql<{ id: string }>`
        SELECT attempt.id
        FROM candidate_learning_submit_attempts attempt
        JOIN applications application ON application.id = attempt.application_id
        JOIN application_runs run ON run.id = attempt.run_id AND run.application_id = attempt.application_id
        WHERE attempt.application_id = ${input.request.applicationId}
          AND attempt.run_id = ${input.request.applicationRunId}
          AND attempt.candidate_id = ${input.candidateId}
          AND attempt.occurred_at = ${attemptedAt}
          AND application.account_id = ${input.accountId}
          AND application.candidate_id = ${input.candidateId}
          AND application.status IN ('IN_PROGRESS', 'REVIEW')
          AND run.status = 'ACTIVE'
        LIMIT 1
        FOR UPDATE
      `.execute(transaction);
      if (!attempt.rows[0]) throw new ValidationError("No matching trusted submit attempt was recorded.");
      await sql`
        UPDATE applications
        SET status = 'SUBMITTED', submitted_at = ${input.verifiedAt}, updated_at = ${input.verifiedAt}, version = version + 1
        WHERE id = ${input.request.applicationId} AND candidate_id = ${input.candidateId}
      `.execute(transaction);
      await sql`
        UPDATE application_runs SET status = 'COMPLETED', ended_at = ${input.verifiedAt}
        WHERE id = ${input.request.applicationRunId} AND application_id = ${input.request.applicationId}
      `.execute(transaction);
      await sql`
        INSERT INTO application_checkpoints (
          id, application_id, run_id, checkpoint_type, status, evidence_hash, observed_at
        ) VALUES (
          ${input.checkpointId}, ${input.request.applicationId}, ${input.request.applicationRunId},
          'SUBMISSION', 'VERIFIED', ${input.requestFingerprint}, ${input.verifiedAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_learning_checkpoint_receipts (
          id, candidate_id, application_id, run_id, checkpoint_id, change_set_id,
          idempotency_key, request_fingerprint, checkpoint_status, created_at
        ) VALUES (
          ${this.newId()}, ${input.candidateId}, ${input.request.applicationId},
          ${input.request.applicationRunId}, ${input.checkpointId}, NULL,
          ${input.idempotencyKey}, ${input.requestFingerprint}, 'VERIFIED', ${input.verifiedAt}
        )
      `.execute(transaction);
      return {
        checkpointId: input.checkpointId,
        checkpointStatus: "VERIFIED",
        changeSetId: null,
        saved: 0,
        askAgain: 0,
        skipped: 0,
        conflicts: 0,
        idempotentReplay: false
      };
    });
  }

  async listPendingObservations(
    input: Parameters<VerifiedLearningRepository["listPendingObservations"]>[0]
  ): Promise<readonly PendingLearningObservation[]> {
    return inTransaction(this.database, async (transaction) => {
      const authority = await sql<{ id: string }>`
        SELECT checkpoint.id
        FROM application_checkpoints checkpoint
        JOIN applications application ON application.id = checkpoint.application_id
        WHERE checkpoint.id = ${input.checkpointId}
          AND checkpoint.application_id = ${input.applicationId}
          AND checkpoint.run_id = ${input.runId}
          AND checkpoint.status = 'VERIFIED'
          AND checkpoint.checkpoint_type = 'SUBMISSION'
          AND application.account_id = ${input.accountId}
          AND application.candidate_id = ${input.candidateId}
        LIMIT 1
      `.execute(transaction);
      if (!authority.rows[0]) throw new ValidationError("Learning checkpoint has no submission authority.");
      const expired = await sql<{ proposal_id: string }>`
        UPDATE candidate_learning_observations
        SET status = 'EXPIRED', checkpoint_id = ${input.checkpointId}, consumed_at = ${input.checkpointAt}
        WHERE candidate_id = ${input.candidateId} AND run_id = ${input.runId}
          AND status = 'RECORDED' AND expires_at <= ${input.checkpointAt}
        RETURNING proposal_id
      `.execute(transaction);
      if (expired.rows.length > 0) {
        await sql`
          UPDATE candidate_answer_runtime_proposals SET status = 'EXPIRED'
          WHERE id IN (${sql.join(expired.rows.map((row) => row.proposal_id))})
            AND candidate_id = ${input.candidateId}
        `.execute(transaction);
      }
      const result = await sql<{
        observation_id: string; canonical_key: string; entity_id: string | null;
        scope_type: CandidateAnswerScope["scopeType"]; scope_fingerprint: string;
        company_id: string | null; job_id: string | null; application_id: string | null;
        country_code: string | null; role_family: string | null;
        attribution: PendingLearningObservation["attribution"];
        expected_current_version_id: string | null; final_value_fingerprint: string;
        fingerprint_key_version: number; encryption_key_version: number;
        encryption_nonce: Uint8Array; normalized_value_encrypted: Uint8Array; recorded_at: Date;
      }>`
        SELECT observation.id AS observation_id, canonical.canonical_key, observation.entity_id,
          answer_scope.scope_type, answer_scope.scope_fingerprint, answer_scope.company_id,
          answer_scope.job_id, answer_scope.application_id, answer_scope.country_code,
          answer_scope.role_family, observation.attribution, observation.expected_current_version_id,
          observation.final_value_fingerprint, observation.fingerprint_key_version,
          proposal.encryption_key_version, proposal.encryption_nonce, proposal.normalized_value_encrypted,
          observation.recorded_at
        FROM candidate_learning_observations observation
        JOIN canonical_fields canonical ON canonical.id = observation.canonical_id
        JOIN candidate_answer_scopes answer_scope ON answer_scope.id = observation.scope_id
        JOIN candidate_answer_runtime_proposals proposal ON proposal.id = observation.proposal_id
        WHERE observation.candidate_id = ${input.candidateId}
          AND observation.application_id = ${input.applicationId}
          AND observation.run_id = ${input.runId}
          AND observation.status = 'RECORDED' AND proposal.status = 'PENDING'
          AND observation.recorded_at <= ${input.checkpointAt}
          AND observation.expires_at > ${input.checkpointAt}
        ORDER BY observation.recorded_at, observation.id
        FOR UPDATE OF observation, proposal
      `.execute(transaction);
      return result.rows.map((row) => {
        const combined = Buffer.from(row.normalized_value_encrypted);
        if (combined.byteLength <= 16) throw new Error("Encrypted learning proposal is malformed.");
        return {
          observationId: row.observation_id,
          canonicalKey: row.canonical_key,
          entityId: row.entity_id,
          scope: hydrateCandidateAnswerScope({
            scopeType: row.scope_type,
            scopeFingerprint: row.scope_fingerprint,
            context: {
              ...(row.company_id ? { companyId: row.company_id } : {}),
              ...(row.job_id ? { jobId: row.job_id } : {}),
              ...(row.application_id ? { applicationId: row.application_id } : {}),
              ...(row.country_code ? { countryCode: row.country_code } : {}),
              ...(row.role_family ? { roleFamily: row.role_family } : {})
            }
          }),
          attribution: row.attribution,
          expectedCurrentVersionId: row.expected_current_version_id,
          finalValueFingerprint: row.final_value_fingerprint,
          fingerprintKeyVersion: row.fingerprint_key_version,
          encryptedPayload: {
            keyVersion: row.encryption_key_version,
            initializationVector: new Uint8Array(row.encryption_nonce),
            authenticationTag: new Uint8Array(combined.subarray(0, 16)),
            ciphertext: new Uint8Array(combined.subarray(16))
          },
          recordedAt: new Date(row.recorded_at)
        };
      });
    });
  }

  async finalizeCheckpoint(input: FinalizeLearningCheckpointInput): Promise<LearningCheckpointAuthority> {
    return inTransaction(this.database, async (transaction) => {
      const receipt = await sql<{
        id: string; checkpoint_status: "VERIFIED" | "REJECTED"; finalized_at: Date | null;
        change_set_id: string | null; saved_count: number; ask_again_count: number;
        skipped_count: number; conflict_count: number;
      }>`
        SELECT receipt.id, receipt.checkpoint_status, receipt.finalized_at, receipt.change_set_id,
          receipt.saved_count, receipt.ask_again_count, receipt.skipped_count, receipt.conflict_count
        FROM candidate_learning_checkpoint_receipts receipt
        JOIN applications application ON application.id = receipt.application_id
        WHERE receipt.checkpoint_id = ${input.checkpointId}
          AND receipt.application_id = ${input.applicationId}
          AND receipt.run_id = ${input.runId}
          AND receipt.candidate_id = ${input.candidateId}
          AND application.account_id = ${input.accountId}
        LIMIT 1 FOR UPDATE
      `.execute(transaction);
      const receiptRow = receipt.rows[0];
      if (!receiptRow) throw new ValidationError("Learning checkpoint receipt was not found.");
      if (receiptRow.finalized_at) {
        return {
          checkpointId: input.checkpointId,
          checkpointStatus: receiptRow.checkpoint_status,
          changeSetId: receiptRow.change_set_id,
          saved: receiptRow.saved_count,
          askAgain: receiptRow.ask_again_count,
          skipped: receiptRow.skipped_count,
          conflicts: receiptRow.conflict_count,
          idempotentReplay: true
        };
      }
      if (input.changeSetId) {
        const changeSet = await sql<{ id: string }>`
          SELECT id FROM candidate_answer_change_sets
          WHERE id = ${input.changeSetId} AND candidate_id = ${input.candidateId}
            AND application_id = ${input.applicationId} AND checkpoint_id = ${input.checkpointId}
          LIMIT 1
        `.execute(transaction);
        if (!changeSet.rows[0]) throw new ValidationError("Learning change set lacks checkpoint authority.");
      }
      if (input.consumedObservationIds.length > 0) {
        if (!input.changeSetId) throw new ValidationError("Consumed observations require a Candidate Truth change set.");
        const consumed = await sql<{ proposal_id: string }>`
          UPDATE candidate_learning_observations
          SET status = 'CONSUMED', checkpoint_id = ${input.checkpointId},
            consumed_change_set_id = ${input.changeSetId}, consumed_at = ${input.finalizedAt}
          WHERE candidate_id = ${input.candidateId} AND run_id = ${input.runId}
            AND id IN (${sql.join(input.consumedObservationIds)}) AND status = 'RECORDED'
          RETURNING proposal_id
        `.execute(transaction);
        if (consumed.rows.length !== input.consumedObservationIds.length) {
          throw new ConflictError("Not every verified learning observation remained consumable.");
        }
        await sql`
          UPDATE candidate_answer_runtime_proposals SET status = 'COMMITTED'
          WHERE id IN (${sql.join(consumed.rows.map((row) => row.proposal_id))})
            AND candidate_id = ${input.candidateId} AND status = 'PENDING'
        `.execute(transaction);
      }
      if (input.skippedObservationIds.length > 0) {
        const skipped = await sql<{ proposal_id: string }>`
          UPDATE candidate_learning_observations
          SET status = 'SKIPPED', checkpoint_id = ${input.checkpointId}, consumed_at = ${input.finalizedAt}
          WHERE candidate_id = ${input.candidateId} AND run_id = ${input.runId}
            AND id IN (${sql.join(input.skippedObservationIds)}) AND status = 'RECORDED'
          RETURNING proposal_id
        `.execute(transaction);
        if (skipped.rows.length > 0) {
          await sql`
            UPDATE candidate_answer_runtime_proposals SET status = 'DISCARDED'
            WHERE id IN (${sql.join(skipped.rows.map((row) => row.proposal_id))})
              AND candidate_id = ${input.candidateId} AND status = 'PENDING'
          `.execute(transaction);
        }
      }
      const updated = await sql<{
        checkpoint_status: "VERIFIED" | "REJECTED"; change_set_id: string | null;
        saved_count: number; ask_again_count: number; skipped_count: number; conflict_count: number;
      }>`
        UPDATE candidate_learning_checkpoint_receipts
        SET change_set_id = ${input.changeSetId}, saved_count = ${input.saved},
          ask_again_count = ${input.askAgain}, skipped_count = ${input.skippedObservationIds.length},
          conflict_count = ${input.conflicts}, finalized_at = ${input.finalizedAt}
        WHERE id = ${receiptRow.id}
        RETURNING checkpoint_status, change_set_id, saved_count, ask_again_count, skipped_count, conflict_count
      `.execute(transaction);
      const row = updated.rows[0];
      if (!row) throw new Error("Learning checkpoint receipt update was not returned.");
      const sequence = await sql<{ last_sequence: string }>`
        UPDATE application_runs SET last_sequence = last_sequence + 1
        WHERE id = ${input.runId} AND application_id = ${input.applicationId}
        RETURNING last_sequence
      `.execute(transaction);
      if (!sequence.rows[0]) throw new ConflictError("Learning application run disappeared during finalization.");
      await sql`
        INSERT INTO application_events (
          id, application_id, run_id, sequence, event_type, reason_code, structural_metadata, occurred_at
        ) VALUES (
          ${this.newId()}, ${input.applicationId}, ${input.runId}, ${Number(sequence.rows[0].last_sequence)},
          'VERIFIED_LEARNING_COMMITTED', 'VERIFIED_SUBMISSION',
          CAST(${JSON.stringify({ checkpointId: input.checkpointId, changeSetId: input.changeSetId, saved: input.saved, askAgain: input.askAgain, skipped: input.skippedObservationIds.length, conflicts: input.conflicts })} AS jsonb),
          ${input.finalizedAt}
        )
      `.execute(transaction);
      return {
        checkpointId: input.checkpointId,
        checkpointStatus: row.checkpoint_status,
        changeSetId: row.change_set_id,
        saved: row.saved_count,
        askAgain: row.ask_again_count,
        skipped: row.skipped_count,
        conflicts: row.conflict_count,
        idempotentReplay: false
      };
    });
  }
}

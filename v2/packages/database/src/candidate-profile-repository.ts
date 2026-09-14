import {
  PersistableNormalizedValueSchema,
  type CandidateAnswerTrustState,
  type CandidateScopeContext,
  type EntityType,
  type PersistableNormalizedValue,
  type ScopeType
} from "@job-hunter-v2/candidate-truth";
import {
  withProfilePresentation,
  profileFieldLabel,
  profileSection,
  type CandidateProfileAnswer,
  type CandidateProfileHistoryEntry,
  type CandidateProfileRepository
} from "@job-hunter-v2/onboarding";
import { ConflictError, IdempotencyConflictError, NotFoundError } from "@job-hunter-v2/domain";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

interface ProfileValueRow {
  answer_version_id: string;
  change_set_id: string;
  canonical_key: string;
  entity_id: string | null;
  entity_type: EntityType | null;
  scope_type: ScopeType;
  company_id: string | null;
  job_id: string | null;
  application_id: string | null;
  country_code: string | null;
  role_family: string | null;
  value_type: PersistableNormalizedValue["kind"];
  text_value: string | null;
  integer_value: string | number | null;
  decimal_value: string | number | null;
  boolean_value: boolean | null;
  date_value: Date | string | null;
  date_precision: "DAY" | "MONTH" | "YEAR" | null;
  structured_value: unknown;
  trust_state: CandidateAnswerTrustState;
  source: CandidateProfileAnswer["source"];
  confirmed_at: Date | string | null;
  created_at: Date | string;
}

interface HistoryRow extends ProfileValueRow {
  current: boolean;
  supersedes_version_id: string | null;
  restores_version_id: string | null;
}

function structuredValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  throw new Error("Database returned an invalid structured profile value.");
}

function decode(row: ProfileValueRow): PersistableNormalizedValue {
  const common = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };
  let value: unknown;
  switch (row.value_type) {
    case "STRING":
    case "URL":
    case "RICH_TEXT":
      value = { ...common, kind: row.value_type, value: row.text_value };
      break;
    case "ENUM":
      value = { ...common, kind: "ENUM", value: JSON.parse(row.text_value ?? "null") as unknown };
      break;
    case "BOOLEAN":
      value = { ...common, kind: "BOOLEAN", value: row.boolean_value };
      break;
    case "INTEGER":
      value = { ...common, kind: "INTEGER", value: Number(row.integer_value) };
      break;
    case "DECIMAL":
      value = { ...common, kind: "DECIMAL", valueExact: String(row.decimal_value) };
      break;
    case "DATE":
      value = {
        ...common,
        kind: "DATE",
        value: {
          isoDate: row.date_value instanceof Date
            ? row.date_value.toISOString().slice(0, 10)
            : String(row.date_value).slice(0, 10),
          precision: row.date_precision
        }
      };
      break;
    default:
      value = structuredValue(row.structured_value);
  }
  return PersistableNormalizedValueSchema.parse(value);
}

function context(row: ProfileValueRow): CandidateScopeContext {
  return {
    ...(row.company_id ? { companyId: row.company_id } : {}),
    ...(row.job_id ? { jobId: row.job_id } : {}),
    ...(row.application_id ? { applicationId: row.application_id } : {}),
    ...(row.country_code ? { countryCode: row.country_code } : {}),
    ...(row.role_family ? { roleFamily: row.role_family } : {})
  };
}

function base(row: ProfileValueRow): Omit<CandidateProfileAnswer, "label" | "section" | "freshness"> {
  return {
    answerVersionId: row.answer_version_id,
    changeSetId: row.change_set_id,
    canonicalKey: row.canonical_key,
    entityId: row.entity_id,
    entityType: row.entity_type,
    scopeType: row.scope_type,
    scope: context(row),
    normalizedValue: decode(row),
    trustState: row.trust_state,
    source: row.source,
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
    createdAt: new Date(row.created_at)
  };
}

const valueColumns = sql.raw(`
  version.id AS answer_version_id,
  version.change_set_id,
  canonical.canonical_key,
  version.entity_id,
  entity.entity_type,
  scope.scope_type,
  scope.company_id,
  scope.job_id,
  scope.application_id,
  scope.country_code,
  scope.role_family,
  version.value_type,
  version.text_value,
  version.integer_value,
  version.decimal_value,
  version.boolean_value,
  version.date_value,
  version.date_precision,
  version.structured_value,
  version.trust_state,
  version.source,
  version.confirmed_at,
  version.created_at
`);

export class KyselyCandidateProfileRepository implements CandidateProfileRepository {
  constructor(private readonly database: Kysely<V2Database>) {}

  async getSnapshot(input: Parameters<CandidateProfileRepository["getSnapshot"]>[0]) {
    const state = await sql<{
      version: number;
      status: "IN_PROGRESS" | "COMPLETED";
    }>`
      SELECT onboarding.version, onboarding.status
      FROM candidate_onboarding_states onboarding
      JOIN candidates candidate ON candidate.id = onboarding.candidate_id
      WHERE onboarding.account_id = ${input.accountId}
        AND onboarding.candidate_id = ${input.candidateId}
        AND candidate.account_id = ${input.accountId}
        AND candidate.status = 'ACTIVE'
    `.execute(this.database);
    if (!state.rows[0]) throw new NotFoundError("Candidate profile was not found for this account.");
    const answers = await sql<ProfileValueRow>`
      SELECT ${valueColumns}
      FROM candidate_answers_current current_answer
      JOIN candidate_answer_versions version ON version.id = current_answer.answer_version_id
      JOIN canonical_fields canonical ON canonical.id = current_answer.canonical_id AND canonical.status = 'ACTIVE'
      JOIN candidate_answer_scopes scope ON scope.id = current_answer.scope_id
      LEFT JOIN candidate_entities entity ON entity.id = current_answer.entity_id
      WHERE current_answer.candidate_id = ${input.candidateId}
        AND version.trust_state <> 'REMOVED'
        AND (entity.id IS NULL OR entity.status = 'ACTIVE')
      ORDER BY canonical.canonical_key, version.entity_id NULLS FIRST, scope.scope_type
    `.execute(this.database);
    const resumeState = await sql<{ pending: string; conflicts: string }>`
      WITH latest_document AS (
        SELECT id FROM documents
        WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
          AND purpose = 'MASTER_RESUME' AND status = 'READY'
        ORDER BY created_at DESC LIMIT 1
      ), latest_extraction AS (
        SELECT id FROM resume_extraction_runs
        WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
          AND document_id = (SELECT id FROM latest_document)
        ORDER BY started_at DESC LIMIT 1
      )
      SELECT
        count(*) FILTER (WHERE decision = 'PENDING')::text AS pending,
        count(*) FILTER (WHERE decision = 'PENDING' AND comparison = 'CONFLICT')::text AS conflicts
      FROM resume_candidate_proposals
      WHERE extraction_id = (SELECT id FROM latest_extraction)
    `.execute(this.database);
    return {
      candidateId: input.candidateId,
      answers: answers.rows.map((row) => withProfilePresentation(base(row), input.evaluatedAt)),
      pendingResumeItems: Number(resumeState.rows[0]?.pending ?? 0),
      conflictingResumeItems: Number(resumeState.rows[0]?.conflicts ?? 0),
      onboardingVersion: Number(state.rows[0].version),
      onboardingCompleted: state.rows[0].status === "COMPLETED"
    };
  }

  async listHistory(input: Parameters<CandidateProfileRepository["listHistory"]>[0]): Promise<readonly CandidateProfileHistoryEntry[]> {
    const candidate = await sql<{ id: string }>`
      SELECT id FROM candidates
      WHERE id = ${input.candidateId} AND account_id = ${input.accountId} AND status = 'ACTIVE'
    `.execute(this.database);
    if (!candidate.rows[0]) throw new NotFoundError("Candidate profile was not found for this account.");
    const rows = await sql<HistoryRow>`
      SELECT ${valueColumns},
             (current_answer.answer_version_id = version.id) AS current,
             version.supersedes_version_id,
             version.restores_version_id
      FROM candidate_answer_versions version
      JOIN canonical_fields canonical ON canonical.id = version.canonical_id
      JOIN candidate_answer_scopes scope ON scope.id = version.scope_id
      LEFT JOIN candidate_entities entity ON entity.id = version.entity_id
      LEFT JOIN candidate_answers_current current_answer
        ON current_answer.candidate_id = version.candidate_id
       AND current_answer.canonical_id = version.canonical_id
       AND current_answer.entity_id IS NOT DISTINCT FROM version.entity_id
       AND current_answer.scope_id = version.scope_id
      WHERE version.candidate_id = ${input.candidateId}
        ${input.canonicalKey ? sql`AND canonical.canonical_key = ${input.canonicalKey}` : sql``}
        ${input.entityId !== undefined ? sql`AND version.entity_id IS NOT DISTINCT FROM ${input.entityId}` : sql``}
      ORDER BY version.created_at DESC, version.id DESC
      LIMIT ${input.limit}
    `.execute(this.database);
    return rows.rows.map((row) => ({
      ...base(row),
      label: profileFieldLabel(row.canonical_key),
      section: profileSection(row.canonical_key),
      current: row.current,
      supersedesVersionId: row.supersedes_version_id,
      restoresVersionId: row.restores_version_id
    }));
  }

  async markProfileStarted(input: Parameters<CandidateProfileRepository["markProfileStarted"]>[0]): Promise<void> {
    const candidate = await sql<{ id: string }>`
      SELECT id FROM candidates
      WHERE id = ${input.candidateId} AND account_id = ${input.accountId} AND status = 'ACTIVE'
    `.execute(this.database);
    if (!candidate.rows[0]) throw new NotFoundError("Candidate profile was not found for this account.");
    await sql`
      UPDATE candidate_onboarding_states
      SET stage = 'PROFILE', version = version + 1, last_seen_at = ${input.observedAt}
      WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
        AND status = 'IN_PROGRESS' AND stage <> 'PROFILE'
    `.execute(this.database);
  }

  async findCompletion(input: Parameters<CandidateProfileRepository["findCompletion"]>[0]) {
    const receipt = await sql<{
      request_fingerprint: string;
      onboarding_version: number;
      completed_at: Date | string;
    }>`
      SELECT request_fingerprint, onboarding_version, completed_at
      FROM candidate_onboarding_completion_receipts
      WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
        AND idempotency_key = ${input.idempotencyKey}
    `.execute(this.database);
    if (!receipt.rows[0]) return null;
    if (receipt.rows[0].request_fingerprint !== input.requestFingerprint) {
      throw new IdempotencyConflictError("Onboarding completion key was reused for another state.");
    }
    return {
      completedAt: new Date(receipt.rows[0].completed_at),
      onboardingVersion: Number(receipt.rows[0].onboarding_version),
      idempotentReplay: true as const
    };
  }

  async completeOnboarding(input: Parameters<CandidateProfileRepository["completeOnboarding"]>[0]) {
    return this.database.transaction().execute(async (transaction) => {
      const receipt = await sql<{
        request_fingerprint: string;
        onboarding_version: number;
        completed_at: Date | string;
      }>`
        SELECT request_fingerprint, onboarding_version, completed_at
        FROM candidate_onboarding_completion_receipts
        WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
          AND idempotency_key = ${input.idempotencyKey}
      `.execute(transaction);
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_fingerprint !== input.requestFingerprint) {
          throw new IdempotencyConflictError("Onboarding completion key was reused for another state.");
        }
        return {
          completedAt: new Date(receipt.rows[0].completed_at),
          onboardingVersion: Number(receipt.rows[0].onboarding_version),
          idempotentReplay: true
        };
      }
      const state = await sql<{ version: number; status: string }>`
        SELECT version, status FROM candidate_onboarding_states
        WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
        FOR UPDATE
      `.execute(transaction);
      if (!state.rows[0]) throw new NotFoundError("Candidate onboarding was not found for this account.");
      if (state.rows[0].status === "COMPLETED" || Number(state.rows[0].version) !== input.expectedOnboardingVersion) {
        throw new ConflictError("Onboarding changed since this review was opened. Refresh and try again.");
      }
      const onboardingVersion = Number(state.rows[0].version) + 1;
      await sql`
        UPDATE candidate_onboarding_states
        SET stage = 'READY', status = 'COMPLETED', version = ${onboardingVersion},
            last_seen_at = ${input.completedAt}, completed_at = ${input.completedAt}
        WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_onboarding_completion_receipts (
          id, account_id, candidate_id, idempotency_key, request_fingerprint,
          onboarding_version, completed_at
        ) VALUES (
          ${input.receiptId}, ${input.accountId}, ${input.candidateId}, ${input.idempotencyKey},
          ${input.requestFingerprint}, ${onboardingVersion}, ${input.completedAt}
        )
      `.execute(transaction);
      return { completedAt: input.completedAt, onboardingVersion, idempotentReplay: false };
    });
  }
}

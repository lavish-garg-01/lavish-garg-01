import { createHash, randomUUID } from "node:crypto";
import { inTransaction } from "./transaction-scope.js";
export { learningCheckpointUnitOfWork } from "./learning-unit-of-work.js";
export { KyselyLearningRecovery, purgeExpiredLearningInbox } from "./learning-recovery.js";
export { learningFingerprintKeyStatus } from "./learning-key-status.js";
export async function migrateLearningFingerprintVersions(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0033_learning_fingerprint_versions.sql", import.meta.url));
  return applyMigration(client, { version: "0033_learning_fingerprint_versions", sql: await readFile(path, "utf8") });
}
export async function migrateScopedNoteRecovery(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0032_scoped_note_recovery.sql", import.meta.url));
  return applyMigration(client, { version: "0032_scoped_note_recovery", sql: await readFile(path, "utf8") });
}
export async function migrateLearningInboxLifecycle(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0028_learning_inbox_lifecycle.sql", import.meta.url));
  return applyMigration(client, { version: "0028_learning_inbox_lifecycle", sql: await readFile(path, "utf8") });
}
export { OperatorReviewRepository } from "./operator-review.js";
export { ReviewedExportRepository } from "./reviewed-exports.js";
export { assertReviewDatabaseRole } from "./review-database-role.js";
export async function migrateReviewedExports(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0031_reviewed_exports.sql", import.meta.url));
  return applyMigration(client, { version: "0031_reviewed_exports", sql: await readFile(path, "utf8") });
}
export async function migrateCaseMerge(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0030_case_merge.sql", import.meta.url));
  return applyMigration(client, { version: "0030_case_merge", sql: await readFile(path, "utf8") });
}
export { SupportReviewRepository } from "./support-review.js";
export async function migrateSupportReview(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0029_support_review.sql", import.meta.url));
  return applyMigration(client, { version: "0029_support_review", sql: await readFile(path, "utf8") });
}
export async function migrateOperatorWorkflow(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0027_operator_workflow.sql", import.meta.url));
  return applyMigration(client, { version: "0027_operator_workflow", sql: await readFile(path, "utf8") });
}
export async function migrateOperatorReview(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0026_operator_review.sql", import.meta.url));
  return applyMigration(client, { version: "0026_operator_review", sql: await readFile(path, "utf8") });
}
export async function migrateLearningNoteConfirmation(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0025_learning_note_confirmation.sql", import.meta.url));
  return applyMigration(client, { version: "0025_learning_note_confirmation", sql: await readFile(path, "utf8") });
}
export async function migrateLearningRecovery(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0024_learning_recovery.sql", import.meta.url));
  return applyMigration(client, { version: "0024_learning_recovery", sql: await readFile(path, "utf8") });
}
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { IdentityAccount, IdentityRepository } from "@job-hunter-v2/auth";
import {
  PersistableNormalizedValueSchema,
  candidateAnswerPolicy,
  hydrateCandidateAnswerScope,
  normalizedValuesEqual,
  planRedundantOverrideRemoval,
  type ApplyVerifiedReviewOutcomeCommand,
  type CandidateAnswerMutationResult,
  type CandidateAnswerGroupMutationResult,
  type CandidateAnswerReversalItemResult,
  type CandidateAnswerReversalResult,
  type CandidateAnswerScope,
  type CandidateAnswerSource,
  type CandidateAnswerTransitionKind,
  type CandidateAnswerUsageProofResult,
  type CandidateScopeContext,
  type CandidateCurrentAnswer,
  type ListCandidateAnswerReversalsInput,
  type CandidateResolutionCandidate,
  type CandidateTruthRepository,
  type PersistCandidateAnswerCommand,
  type PersistCandidateAnswerGroupCommand,
  type PersistableNormalizedValue,
  type RecordTrialOutcomeReceiptCommand,
  type RemoveRedundantOverrideCommand,
  type RestoreCandidateAnswerVersionCommand,
  type UndoCandidateAnswerChangeSetCommand
} from "@job-hunter-v2/candidate-truth";
import type {
  EntitlementContext,
  EntitlementRepository
} from "@job-hunter-v2/entitlements";
import type {
  CandidateBootstrapRepository,
  CandidateBootstrapState,
  OnboardingStage
} from "@job-hunter-v2/onboarding";
import type { AccountStatus, AccountType, MembershipRole, SubscriptionStatus } from "@job-hunter-v2/contracts";
import {
  ConflictError,
  IdempotencyConflictError,
  NotFoundError,
  ValidationError
} from "@job-hunter-v2/domain";
import { Kysely, PostgresDialect, sql, type Generated } from "kysely";
import pg from "pg";

export { KyselyCandidateTruthImportPreviewRepository } from "./candidate-truth-import-preview-repository.js";
export { KyselyLegacyImportApplyRepository } from "./candidate-truth-import-apply-repository.js";
export { KyselyResumeRepository } from "./onboarding-resume-repository.js";
export { KyselyCandidateConfirmationRepository } from "./onboarding-confirmation-repository.js";
export { KyselyCandidateProfileRepository } from "./candidate-profile-repository.js";
export { KyselyJobIngestionRepository } from "./job-intelligence-repository.js";
export { KyselyCandidateSearchProfileRepository } from "./candidate-search-profile-repository.js";
export { KyselyJobLifecycleRepository } from "./job-lifecycle-repository.js";
export { KyselyJobCatalogRepository } from "./job-catalog-repository.js";
export { KyselyVerifiedLearningRepository } from "./verified-learning-repository.js";
export { KyselyRepeatableEntityRepository } from "./repeatable-entity-repository.js";
export { KyselyDeclarationEvidenceRepository } from "./declaration-evidence-repository.js";
export { KyselyAiLedger } from "./ai-ledger.js";
export { KyselyCanonicalReviewRepository } from "./canonical-review-repository.js";
export { KyselyStrategyRepository } from "./strategy-repository.js";
export { StrategyJobQueue, StrategyJobSchema } from "./strategy-queue.js";
export { KyselyDocumentIntelligenceRepository } from "./document-intelligence-repository.js";
export { KyselyDocumentGenerationRepository } from "./document-generation-repository.js";
export { KyselyApplicationDocumentRepository } from "./application-document-repository.js";

export async function migrateStrategyIntelligence(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0019_strategy_intelligence.sql", import.meta.url));
  return applyMigration(client, { version: "0019_strategy_intelligence", sql: await readFile(path, "utf8") });
}
export async function migrateStrategyOperations(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0020_strategy_operations.sql", import.meta.url));
  return applyMigration(client, { version: "0020_strategy_operations", sql: await readFile(path, "utf8") });
}
export async function migrateDocumentIntelligence(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0021_document_intelligence.sql", import.meta.url));
  return applyMigration(client, { version: "0021_document_intelligence", sql: await readFile(path, "utf8") });
}

export async function migrateGlobalAnswerDefaults(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0022_global_answer_defaults.sql", import.meta.url));
  return applyMigration(client, { version: "0022_global_answer_defaults", sql: await readFile(path, "utf8") });
}
export async function migrateCanonicalReviewQueue(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0023_canonical_review_queue.sql", import.meta.url));
  return applyMigration(client, { version: "0023_canonical_review_queue", sql: await readFile(path, "utf8") });
}

export async function migrateAiOrchestration(client: SqlClient): Promise<MigrationResult> {
  const path = fileURLToPath(new URL("../../../database/migrations/0018_ai_orchestration.sql", import.meta.url));
  return applyMigration(client, { version: "0018_ai_orchestration", sql: await readFile(path, "utf8") });
}

export interface SqlQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
}

export interface SqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<SqlQueryResult<Row>>;
  executeScript?(text: string): Promise<void>;
}

export interface SqlClient extends SqlExecutor {
  withTransaction<Result>(work: (transaction: SqlExecutor) => Promise<Result>): Promise<Result>;
}

export interface MigrationDefinition {
  version: string;
  sql: string;
  checksumSha256?: string;
}

export interface MigrationResult {
  version: string;
  checksumSha256: string;
  applied: boolean;
}

export async function loadInitialMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0001_initial_v2_schema.sql", import.meta.url)
  );
  return { version: "0001_initial_v2_schema", sql: await readFile(path, "utf8") };
}

export async function loadCoreEntitlementMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0002_core_entitlements.sql", import.meta.url)
  );
  return { version: "0002_core_entitlements", sql: await readFile(path, "utf8") };
}

export async function loadCandidateTruthOntologyMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0003_candidate_truth_ontology.sql", import.meta.url)
  );
  return { version: "0003_candidate_truth_ontology", sql: await readFile(path, "utf8") };
}

export async function loadCandidateTruthMutationGuardsMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0004_candidate_truth_mutation_guards.sql", import.meta.url)
  );
  return { version: "0004_candidate_truth_mutation_guards", sql: await readFile(path, "utf8") };
}

export async function loadCandidateScopePolicyVectorsMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0005_candidate_scope_policy_vectors.sql", import.meta.url)
  );
  return { version: "0005_candidate_scope_policy_vectors", sql: await readFile(path, "utf8") };
}

export async function loadCandidateReviewOutcomeProofsMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0006_candidate_review_outcome_proofs.sql", import.meta.url)
  );
  return { version: "0006_candidate_review_outcome_proofs", sql: await readFile(path, "utf8") };
}

export async function loadCandidateAnswerReversalsMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0007_candidate_answer_reversals.sql", import.meta.url)
  );
  return { version: "0007_candidate_answer_reversals", sql: await readFile(path, "utf8") };
}

export async function loadCandidateTruthImportPreviewsMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0008_candidate_truth_import_previews.sql", import.meta.url)
  );
  return { version: "0008_candidate_truth_import_previews", sql: await readFile(path, "utf8") };
}

export async function loadCandidateTruthImportApplyMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0009_candidate_truth_import_apply.sql", import.meta.url)
  );
  return { version: "0009_candidate_truth_import_apply", sql: await readFile(path, "utf8") };
}

export async function loadCandidateOnboardingBootstrapMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0010_candidate_onboarding_bootstrap.sql", import.meta.url)
  );
  return { version: "0010_candidate_onboarding_bootstrap", sql: await readFile(path, "utf8") };
}

export async function loadCandidateResumeIntelligenceMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0011_candidate_resume_intelligence.sql", import.meta.url)
  );
  return { version: "0011_candidate_resume_intelligence", sql: await readFile(path, "utf8") };
}

export async function loadCandidateOnboardingConfirmationMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0012_candidate_onboarding_confirmation.sql", import.meta.url)
  );
  return { version: "0012_candidate_onboarding_confirmation", sql: await readFile(path, "utf8") };
}

export async function loadCandidateProfileCompletionMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0013_candidate_profile_completion.sql", import.meta.url)
  );
  return { version: "0013_candidate_profile_completion", sql: await readFile(path, "utf8") };
}

export async function loadJobIntelligenceMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0014_job_intelligence.sql", import.meta.url)
  );
  return { version: "0014_job_intelligence", sql: await readFile(path, "utf8") };
}

export async function loadVerifiedLearningLoopMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(
    new URL("../../../database/migrations/0015_verified_learning_loop.sql", import.meta.url)
  );
  return { version: "0015_verified_learning_loop", sql: await readFile(path, "utf8") };
}

export async function loadRepeatableEntityIntelligenceMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(new URL("../../../database/migrations/0016_repeatable_entity_intelligence.sql", import.meta.url));
  return { version: "0016_repeatable_entity_intelligence", sql: await readFile(path, "utf8") };
}

export async function loadDeclarationConsentPolicyMigration(): Promise<MigrationDefinition> {
  const path = fileURLToPath(new URL("../../../database/migrations/0017_declaration_consent_policy.sql", import.meta.url));
  return { version: "0017_declaration_consent_policy", sql: await readFile(path, "utf8") };
}

export async function applyMigration(
  client: SqlClient,
  migration: MigrationDefinition
): Promise<MigrationResult> {
  if (!/^\d{4}_[a-z0-9_]+$/.test(migration.version)) {
    throw new Error(`Invalid migration version: ${migration.version}`);
  }
  const checksumSha256 = createHash("sha256").update(migration.sql).digest("hex");
  if (migration.checksumSha256 && migration.checksumSha256 !== checksumSha256) {
    throw new Error(`Declared checksum mismatch for ${migration.version}.`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum_sha256 text NOT NULL CHECK (length(checksum_sha256) = 64),
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  return client.withTransaction(async (transaction) => {
    await transaction.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["job-hunter-v2:migrations"]);
    const existing = await transaction.query<{ checksum_sha256: string }>(
      "SELECT checksum_sha256 FROM schema_migrations WHERE version = $1",
      [migration.version]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].checksum_sha256 !== checksumSha256) {
        throw new Error(`Applied migration checksum mismatch for ${migration.version}.`);
      }
      return { version: migration.version, checksumSha256, applied: false };
    }

    if (transaction.executeScript) await transaction.executeScript(migration.sql);
    else await transaction.query(migration.sql);
    await transaction.query(
      "INSERT INTO schema_migrations (version, checksum_sha256) VALUES ($1, $2)",
      [migration.version, checksumSha256]
    );
    return { version: migration.version, checksumSha256, applied: true };
  });
}

export async function migrateInitialSchema(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadInitialMigration());
}

export async function migrateCoreEntitlements(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadCoreEntitlementMigration());
}

export async function migrateCandidateTruthOntology(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadCandidateTruthOntologyMigration());
}

export async function migrateCandidateTruthMutationGuards(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadCandidateTruthMutationGuardsMigration());
}

export async function migrateCandidateScopePolicyVectors(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadCandidateScopePolicyVectorsMigration());
}

export async function migrateCandidateReviewOutcomeProofs(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadCandidateReviewOutcomeProofsMigration());
}

export async function migrateCandidateAnswerReversals(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadCandidateAnswerReversalsMigration());
}

export async function migrateCandidateTruthImportPreviews(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadCandidateTruthImportPreviewsMigration());
}

export async function migrateCandidateTruthImportApply(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadCandidateTruthImportApplyMigration());
}

export async function migrateCandidateOnboardingBootstrap(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadCandidateOnboardingBootstrapMigration());
}

export async function migrateCandidateResumeIntelligence(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadCandidateResumeIntelligenceMigration());
}

export async function migrateCandidateOnboardingConfirmation(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadCandidateOnboardingConfirmationMigration());
}

export async function migrateCandidateProfileCompletion(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadCandidateProfileCompletionMigration());
}

export async function migrateJobIntelligence(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadJobIntelligenceMigration());
}

export async function migrateVerifiedLearningLoop(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadVerifiedLearningLoopMigration());
}

export async function migrateRepeatableEntityIntelligence(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadRepeatableEntityIntelligenceMigration());
}

export async function migrateDeclarationConsentPolicy(client: SqlClient): Promise<MigrationResult> {
  return applyMigration(client, await loadDeclarationConsentPolicyMigration());
}

export interface DatabaseConfig {
  connectionString: string;
  maxConnections?: number;
  ssl?: boolean;
}

export interface V2Database {
  accounts: {
    id: string;
    account_type: "NORMAL" | "TEST" | "INTERNAL";
    status: Generated<"ACTIVE" | "SUSPENDED" | "CLOSED">;
    contributes_to_global_learning: Generated<boolean>;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    closed_at: Date | null;
  };
  users: {
    id: string;
    personal_account_id: string;
    status: Generated<"ACTIVE" | "SUSPENDED" | "CLOSED">;
    primary_email: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
  account_memberships: {
    account_id: string;
    user_id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    created_at: Generated<Date>;
  };
  external_auth_identities: {
    id: string;
    user_id: string;
    provider: string;
    provider_subject: string;
    created_at: Generated<Date>;
  };
  plans: {
    id: Generated<number>;
    code: string;
    name: string;
    active: boolean;
    is_default: boolean;
    created_at: Generated<Date>;
  };
  features: {
    id: Generated<number>;
    feature_key: string;
    description: string;
    meter_key: string | null;
    created_at: Generated<Date>;
  };
  plan_entitlements: {
    plan_id: number;
    feature_id: number;
    enabled: boolean;
    usage_limit: string | null;
    period: "DAY" | "WEEK" | "MONTH" | "LIFETIME" | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
  subscriptions: {
    id: string;
    account_id: string;
    plan_id: number;
    provider: string | null;
    provider_subscription_id: string | null;
    status: SubscriptionStatus;
    starts_at: Date;
    trial_ends_at: Date | null;
    current_period_ends_at: Date | null;
    canceled_at: Date | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
  entitlement_overrides: {
    id: string;
    account_id: string;
    feature_id: number;
    effect: "ALLOW" | "DENY";
    usage_limit: string | null;
    reason_code: string;
    expires_at: Date | null;
    created_by_user_id: string | null;
    created_at: Generated<Date>;
  };
  usage_counters: {
    account_id: string;
    feature_id: number;
    period_start: Date;
    period_end: Date;
    quantity: string;
    updated_at: Generated<Date>;
  };
}

export function createDatabase(config: DatabaseConfig): Kysely<V2Database> {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 10,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined
  });
  return new Kysely<V2Database>({ dialect: new PostgresDialect({ pool }) });
}

export interface PostgresMigrationClient extends SqlClient {
  close(): Promise<void>;
}

export function createPostgresMigrationClient(config: DatabaseConfig): PostgresMigrationClient {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 2,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined
  });
  return {
    query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
      const result = await pool.query<Row>(text, values ? [...values] : undefined);
      return { rows: result.rows };
    },
    executeScript: async (text: string) => {
      await pool.query(text);
    },
    withTransaction: async <Result>(work: (transaction: SqlExecutor) => Promise<Result>) => {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const transaction: SqlExecutor = {
          query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
            const result = await connection.query<Row>(text, values ? [...values] : undefined);
            return { rows: result.rows };
          },
          executeScript: async (text: string) => {
            await connection.query(text);
          }
        };
        const result = await work(transaction);
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
    },
    close: async () => pool.end()
  };
}

export class KyselyIdentityRepository implements IdentityRepository {
  constructor(
    private readonly database: Kysely<V2Database>,
    private readonly newId: () => string = randomUUID
  ) {}

  async findByExternalIdentity(identity: {
    provider: string;
    providerSubject: string;
  }): Promise<IdentityAccount | null> {
    const row = await this.database
      .selectFrom("external_auth_identities as external")
      .innerJoin("users as user", "user.id", "external.user_id")
      .innerJoin("accounts as account", "account.id", "user.personal_account_id")
      .innerJoin("account_memberships as membership", (join) =>
        join
          .onRef("membership.account_id", "=", "account.id")
          .onRef("membership.user_id", "=", "user.id")
      )
      .select([
        "account.id as accountId",
        "user.id as userId",
        "account.account_type as accountType",
        "account.status as accountStatus",
        "user.status as userStatus",
        "membership.role as membershipRole"
      ])
      .where("external.provider", "=", identity.provider)
      .where("external.provider_subject", "=", identity.providerSubject)
      .executeTakeFirst();

    return row
      ? {
          accountId: row.accountId,
          userId: row.userId,
          accountType: row.accountType as AccountType,
          accountStatus: row.accountStatus as AccountStatus,
          userStatus: row.userStatus as AccountStatus,
          membershipRole: row.membershipRole as MembershipRole
        }
      : null;
  }

  async createAccountWithOwner(input: {
    identity: { provider: string; providerSubject: string; email: string | null };
    accountType: AccountType;
    createdAt: Date;
  }): Promise<IdentityAccount> {
    return inTransaction(this.database, async (transaction) => {
      const freePlan = await transaction
        .selectFrom("plans")
        .select("id")
        .where("code", "=", "FREE")
        .where("active", "=", true)
        .executeTakeFirst();
      if (!freePlan) throw new NotFoundError("The default FREE plan has not been seeded.");

      const accountId = this.newId();
      const userId = this.newId();
      await transaction.insertInto("accounts").values({
        id: accountId,
        account_type: input.accountType,
        contributes_to_global_learning: input.accountType !== "TEST"
      }).execute();
      await transaction.insertInto("users").values({
        id: userId,
        personal_account_id: accountId,
        primary_email: input.identity.email
      }).execute();
      await transaction.insertInto("account_memberships").values({
        account_id: accountId,
        user_id: userId,
        role: "OWNER"
      }).execute();
      await transaction.insertInto("external_auth_identities").values({
        id: this.newId(),
        user_id: userId,
        provider: input.identity.provider,
        provider_subject: input.identity.providerSubject
      }).execute();
      await transaction.insertInto("subscriptions").values({
        id: this.newId(),
        account_id: accountId,
        plan_id: freePlan.id,
        provider: null,
        provider_subscription_id: null,
        status: "FREE",
        starts_at: input.createdAt,
        trial_ends_at: null,
        current_period_ends_at: null,
        canceled_at: null
      }).execute();

      return {
        accountId,
        userId,
        accountType: input.accountType,
        accountStatus: "ACTIVE",
        userStatus: "ACTIVE",
        membershipRole: "OWNER"
      };
    });
  }
}

export class KyselyCandidateBootstrapRepository implements CandidateBootstrapRepository {
  constructor(private readonly database: Kysely<V2Database>) {}

  async ensureState(input: {
    accountId: string;
    candidateId: string;
    observedAt: Date;
  }): Promise<CandidateBootstrapState> {
    return inTransaction(this.database, async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.accountId}:candidate-onboarding`})::bigint)`.execute(
        transaction
      );
      const candidate = await sql<{ started_at: Date | string }>`
        SELECT candidate.created_at AS started_at
        FROM candidates candidate
        JOIN accounts account ON account.id = candidate.account_id
        WHERE candidate.id = ${input.candidateId}
          AND candidate.account_id = ${input.accountId}
          AND candidate.status = 'ACTIVE'
          AND account.status = 'ACTIVE'
        LIMIT 1
      `.execute(transaction);
      if (!candidate.rows[0]) {
        throw new NotFoundError("Active candidate was not found for the authenticated account.");
      }
      const existing = await sql<{
        stage: OnboardingStage;
        status: "IN_PROGRESS" | "COMPLETED";
        version: number;
        started_at: Date | string;
        completed_at: Date | string | null;
      }>`
        SELECT stage, status, version, started_at, completed_at
        FROM candidate_onboarding_states
        WHERE candidate_id = ${input.candidateId}
          AND account_id = ${input.accountId}
        LIMIT 1
        FOR UPDATE
      `.execute(transaction);
      const state = existing.rows[0];
      if (state) {
        await sql`
          UPDATE candidate_onboarding_states
          SET last_seen_at = ${input.observedAt}
          WHERE candidate_id = ${input.candidateId}
            AND account_id = ${input.accountId}
        `.execute(transaction);
        return {
          accountId: input.accountId,
          candidateId: input.candidateId,
          stage: state.stage,
          completed: state.status === "COMPLETED",
          isNewCandidate: false,
          version: Number(state.version),
          startedAt: new Date(state.started_at),
          completedAt: state.completed_at ? new Date(state.completed_at) : null
        };
      }
      const startedAt = new Date(candidate.rows[0].started_at);
      await sql`
        INSERT INTO candidate_onboarding_states (
          candidate_id, account_id, stage, status, version,
          started_at, last_seen_at, completed_at
        ) VALUES (
          ${input.candidateId}, ${input.accountId}, 'WELCOME', 'IN_PROGRESS', 1,
          ${startedAt}, ${input.observedAt}, NULL
        )
      `.execute(transaction);
      return {
        accountId: input.accountId,
        candidateId: input.candidateId,
        stage: "WELCOME",
        completed: false,
        isNewCandidate: true,
        version: 1,
        startedAt,
        completedAt: null
      };
    });
  }
}

interface EntitlementQueryRow {
  account_type: AccountType;
  account_status: AccountStatus;
  feature_exists: boolean;
  plan_code: string;
  subscription_status: SubscriptionStatus;
  enabled: boolean | null;
  plan_limit: string | null;
  period: "DAY" | "WEEK" | "MONTH" | "LIFETIME" | null;
  used: string;
  override_effect: "ALLOW" | "DENY" | null;
  override_limit: string | null;
  override_expires_at: Date | string | null;
}

export class KyselyEntitlementRepository implements EntitlementRepository {
  constructor(private readonly database: Kysely<V2Database>) {}

  async getContext(input: {
    accountId: string;
    featureKey: string;
    evaluatedAt: Date;
    simulatedPlanCode: string | null;
  }): Promise<EntitlementContext> {
    const result = await sql<EntitlementQueryRow>`
      WITH current_subscription AS (
        SELECT subscription.plan_id, subscription.status
        FROM subscriptions subscription
        WHERE subscription.account_id = ${input.accountId}
          AND (
            subscription.status = 'FREE'
            OR (
              subscription.status = 'TRIALING'
              AND subscription.starts_at <= ${input.evaluatedAt}
              AND subscription.trial_ends_at > ${input.evaluatedAt}
            )
            OR (
              subscription.status = 'ACTIVE'
              AND subscription.starts_at <= ${input.evaluatedAt}
              AND (
                subscription.current_period_ends_at IS NULL
                OR subscription.current_period_ends_at > ${input.evaluatedAt}
              )
            )
            OR (
              subscription.status = 'CANCELED'
              AND subscription.starts_at <= ${input.evaluatedAt}
              AND subscription.current_period_ends_at > ${input.evaluatedAt}
            )
          )
        ORDER BY
          CASE subscription.status
            WHEN 'ACTIVE' THEN 1
            WHEN 'TRIALING' THEN 2
            WHEN 'CANCELED' THEN 3
            ELSE 4
          END,
          subscription.created_at DESC
        LIMIT 1
      ), selected_plan AS (
        SELECT plan.id, plan.code,
          coalesce((SELECT status FROM current_subscription), 'FREE') AS subscription_status
        FROM plans plan
        WHERE plan.active
          AND plan.code = coalesce(
            ${input.simulatedPlanCode},
            (SELECT subscribed_plan.code
             FROM current_subscription
             JOIN plans subscribed_plan ON subscribed_plan.id = current_subscription.plan_id),
            (SELECT default_plan.code FROM plans default_plan WHERE default_plan.is_default LIMIT 1)
          )
        LIMIT 1
      )
      SELECT
        account.account_type,
        account.status AS account_status,
        (feature.id IS NOT NULL) AS feature_exists,
        selected_plan.code AS plan_code,
        selected_plan.subscription_status,
        entitlement.enabled,
        entitlement.usage_limit::text AS plan_limit,
        entitlement.period,
        coalesce(usage.quantity, 0)::text AS used,
        override_row.effect AS override_effect,
        override_row.usage_limit::text AS override_limit,
        override_row.expires_at AS override_expires_at
      FROM accounts account
      CROSS JOIN selected_plan
      LEFT JOIN features feature ON feature.feature_key = ${input.featureKey}
      LEFT JOIN plan_entitlements entitlement
        ON entitlement.plan_id = selected_plan.id
       AND entitlement.feature_id = feature.id
      LEFT JOIN LATERAL (
        SELECT usage_counter.quantity
        FROM usage_counters usage_counter
        WHERE usage_counter.account_id = account.id
          AND usage_counter.feature_id = feature.id
          AND usage_counter.period_start <= ${input.evaluatedAt}
          AND usage_counter.period_end > ${input.evaluatedAt}
        ORDER BY usage_counter.period_start DESC
        LIMIT 1
      ) usage ON true
      LEFT JOIN LATERAL (
        SELECT entitlement_override.effect,
               entitlement_override.usage_limit,
               entitlement_override.expires_at
        FROM entitlement_overrides entitlement_override
        WHERE entitlement_override.account_id = account.id
          AND entitlement_override.feature_id = feature.id
          AND (entitlement_override.expires_at IS NULL OR entitlement_override.expires_at > ${input.evaluatedAt})
        ORDER BY entitlement_override.created_at DESC
        LIMIT 1
      ) override_row ON true
      WHERE account.id = ${input.accountId}
    `.execute(this.database);

    const row = result.rows[0];
    if (!row) throw new NotFoundError("Account or active/default plan was not found.");
    return {
      accountType: row.account_type,
      accountStatus: row.account_status,
      featureExists: row.feature_exists,
      planCode: row.plan_code,
      subscriptionStatus: row.subscription_status,
      enabled: row.enabled ?? false,
      limit: integerOrNull(row.plan_limit),
      period: row.period,
      used: integerOrNull(row.used) ?? 0,
      override: row.override_effect
        ? {
            effect: row.override_effect,
            limit: integerOrNull(row.override_limit),
            expiresAt: row.override_expires_at ? new Date(row.override_expires_at) : null
          }
        : null
    };
  }

  async consumeUsage(input: {
    accountId: string;
    featureKey: string;
    periodStart: Date;
    periodEnd: Date;
    quantity: number;
    limit: number | null;
  }): Promise<{ consumed: boolean; used: number }> {
    const reservation = await sql<{ used: string }>`
      WITH selected_feature AS (
        SELECT feature.id
        FROM features feature
        WHERE feature.feature_key = ${input.featureKey}
      )
      INSERT INTO usage_counters (
        account_id,
        feature_id,
        period_start,
        period_end,
        quantity,
        updated_at
      )
      SELECT
        ${input.accountId},
        selected_feature.id,
        ${input.periodStart},
        ${input.periodEnd},
        ${input.quantity},
        now()
      FROM selected_feature
      WHERE CAST(${input.limit} AS bigint) IS NULL
         OR CAST(${input.quantity} AS bigint) <= CAST(${input.limit} AS bigint)
      ON CONFLICT (account_id, feature_id, period_start)
      DO UPDATE SET
        quantity = usage_counters.quantity + EXCLUDED.quantity,
        updated_at = now()
      WHERE usage_counters.period_end = EXCLUDED.period_end
        AND (
          CAST(${input.limit} AS bigint) IS NULL
          OR usage_counters.quantity + EXCLUDED.quantity <= CAST(${input.limit} AS bigint)
        )
      RETURNING quantity::text AS used
    `.execute(this.database);

    const reserved = reservation.rows[0];
    if (reserved) return { consumed: true, used: integerOrNull(reserved.used) ?? 0 };

    // A conditional upsert that loses a concurrent limit race returns no row.
    // Read again in a fresh statement so PostgreSQL exposes the winning value.
    const current = await sql<{ used: string; period_end: Date | string | null }>`
      SELECT
        coalesce(usage_counter.quantity, 0)::text AS used,
        usage_counter.period_end
      FROM features feature
      LEFT JOIN usage_counters usage_counter
        ON usage_counter.account_id = ${input.accountId}
       AND usage_counter.feature_id = feature.id
       AND usage_counter.period_start = ${input.periodStart}
      WHERE feature.feature_key = ${input.featureKey}
      LIMIT 1
    `.execute(this.database);

    const row = current.rows[0];
    if (!row) throw new NotFoundError("Feature was not found while reserving entitlement usage.");
    if (row.period_end && new Date(row.period_end).getTime() !== input.periodEnd.getTime()) {
      throw new Error("Entitlement usage window conflicts with the existing counter.");
    }
    return { consumed: false, used: integerOrNull(row.used) ?? 0 };
  }
}

interface CandidateAnswerValueRow {
  answer_version_id: string;
  value_type: PersistCandidateAnswerCommand["normalizedValue"]["kind"];
  text_value: string | null;
  integer_value: string | number | null;
  decimal_value: string | number | null;
  boolean_value: boolean | null;
  date_value: Date | string | null;
  date_precision: "DAY" | "MONTH" | "YEAR" | null;
  structured_value: unknown;
  trust_state: CandidateCurrentAnswer["trustState"];
  source: CandidateAnswerSource;
  confirmed_at: Date | string | null;
}

interface CandidateResolutionRow extends CandidateAnswerValueRow {
  created_at: Date | string;
  scope_type: CandidateAnswerScope["scopeType"];
  scope_fingerprint: string;
  company_id: string | null;
  job_id: string | null;
  application_id: string | null;
  country_code: string | null;
  role_family: string | null;
}

interface CandidateRemovalRow extends CandidateResolutionRow {
  current_answer_id: string;
  canonical_id: number;
  scope_id: string;
  value_fingerprint: string;
  fingerprint_key_version: number;
}

interface CandidatePolicyRow {
  canonical_id: number;
  value_type: string;
  entity_type: string | null;
  policy_id: string;
  policy_version: number;
}

interface ScopeRow {
  id: string;
  scope_type: string;
  scope_fingerprint: string;
  company_id: string | null;
  job_id: string | null;
  application_id: string | null;
  country_code: string | null;
  role_family: string | null;
}

interface CandidateVersionStorageRow extends CandidateAnswerValueRow {
  id: string;
  candidate_id: string;
  canonical_id: number;
  entity_id: string | null;
  scope_id: string;
  policy_id: string;
  value_fingerprint: string;
  fingerprint_key_version: number;
  created_at: Date | string;
}

interface CandidateReversalSetRow {
  id: string;
  operation_type: "UNDO_CHANGE_SET" | "RESTORE_VERSION";
  target_change_set_id: string | null;
  target_version_id: string | null;
  compensating_change_set_id: string | null;
  restored_count: number;
  forgotten_count: number;
  skipped_count: number;
  created_at: Date | string;
}

async function loadCandidateAnswerReversal(
  database: Kysely<V2Database>,
  input: {
    candidateId: string;
    reversalSetId: string;
    idempotentReplay: boolean;
    alreadyReversed: boolean;
  }
): Promise<CandidateAnswerReversalResult> {
  const setResult = await sql<CandidateReversalSetRow>`
    SELECT
      id, operation_type, target_change_set_id, target_version_id,
      compensating_change_set_id, restored_count, forgotten_count, skipped_count,
      created_at
    FROM candidate_answer_reversal_sets
    WHERE id = ${input.reversalSetId}
      AND candidate_id = ${input.candidateId}
    LIMIT 1
  `.execute(database);
  const set = setResult.rows[0];
  if (!set) throw new Error("Committed candidate-answer reversal set was not found.");
  const itemResult = await sql<{
    id: string;
    source_change_set_item_id: string | null;
    canonical_key: string;
    scope_id: string;
    expected_version_id: string | null;
    observed_current_version_id: string | null;
    previous_version_id: string | null;
    compensating_version_id: string | null;
    outcome: CandidateAnswerReversalItemResult["outcome"];
    reason_code: CandidateAnswerReversalItemResult["reasonCode"];
  }>`
    SELECT
      reversal_item.id,
      reversal_item.source_change_set_item_id,
      canonical.canonical_key,
      reversal_item.scope_id,
      reversal_item.expected_version_id,
      reversal_item.observed_current_version_id,
      reversal_item.previous_version_id,
      reversal_item.compensating_version_id,
      reversal_item.outcome,
      reversal_item.reason_code
    FROM candidate_answer_reversal_items reversal_item
    JOIN canonical_fields canonical ON canonical.id = reversal_item.canonical_id
    WHERE reversal_item.reversal_set_id = ${input.reversalSetId}
      AND reversal_item.candidate_id = ${input.candidateId}
    ORDER BY reversal_item.created_at, reversal_item.id
  `.execute(database);
  return {
    candidateId: input.candidateId,
    reversalSetId: set.id,
    operationType: set.operation_type,
    targetChangeSetId: set.target_change_set_id,
    targetVersionId: set.target_version_id,
    compensatingChangeSetId: set.compensating_change_set_id,
    summary: {
      restored: Number(set.restored_count),
      forgotten: Number(set.forgotten_count),
      skippedNewerVersion: Number(set.skipped_count)
    },
    items: itemResult.rows.map((item) => ({
      reversalItemId: item.id,
      sourceChangeSetItemId: item.source_change_set_item_id,
      canonicalKey: item.canonical_key,
      scopeId: item.scope_id,
      expectedVersionId: item.expected_version_id,
      observedCurrentVersionId: item.observed_current_version_id,
      previousVersionId: item.previous_version_id,
      compensatingVersionId: item.compensating_version_id,
      outcome: item.outcome,
      reasonCode: item.reason_code
    })),
    createdAt: new Date(set.created_at),
    idempotentReplay: input.idempotentReplay,
    alreadyReversed: input.alreadyReversed
  };
}

function persistedScope(row: CandidateResolutionRow): CandidateAnswerScope {
  return hydrateCandidateAnswerScope({
    scopeType: row.scope_type,
    scopeFingerprint: row.scope_fingerprint,
    context: {
      ...(row.company_id ? { companyId: row.company_id } : {}),
      ...(row.job_id ? { jobId: row.job_id } : {}),
      ...(row.application_id ? { applicationId: row.application_id } : {}),
      ...(row.country_code ? { countryCode: row.country_code } : {}),
      ...(row.role_family ? { roleFamily: row.role_family } : {})
    }
  });
}

export class KyselyCandidateTruthRepository implements CandidateTruthRepository {
  constructor(
    private readonly database: Kysely<V2Database>,
    private readonly newId: () => string = randomUUID
  ) {}

  async ensureCandidate(input: {
    accountId: string;
    candidateId: string;
    createdAt: Date;
  }): Promise<string> {
    const result = await sql<{ id: string }>`
      INSERT INTO candidates (id, account_id, status, created_at, updated_at)
      SELECT ${input.candidateId}, account.id, 'ACTIVE', ${input.createdAt}, ${input.createdAt}
      FROM accounts account
      WHERE account.id = ${input.accountId}
        AND account.status = 'ACTIVE'
      ON CONFLICT (account_id)
      DO UPDATE SET updated_at = candidates.updated_at
      RETURNING id
    `.execute(this.database);
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Active account was not found while creating candidate truth.");
    return row.id;
  }

  async findCurrent(input: {
    accountId: string;
    candidateId: string;
    canonicalKey: string;
    entityId: string | null;
    scopeFingerprint: string;
  }): Promise<CandidateCurrentAnswer | null> {
    const result = await sql<CandidateAnswerValueRow>`
      SELECT
        version.id AS answer_version_id,
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
        version.confirmed_at
      FROM candidates candidate
      JOIN candidate_answers_current current_answer
        ON current_answer.candidate_id = candidate.id
      JOIN candidate_answer_versions version
        ON version.id = current_answer.answer_version_id
      JOIN canonical_fields canonical
        ON canonical.id = current_answer.canonical_id
      LEFT JOIN candidate_entities entity
        ON entity.id = current_answer.entity_id
       AND entity.candidate_id = candidate.id
      JOIN candidate_answer_scopes answer_scope
        ON answer_scope.id = current_answer.scope_id
      WHERE candidate.id = ${input.candidateId}
        AND candidate.account_id = ${input.accountId}
        AND candidate.status = 'ACTIVE'
        AND canonical.canonical_key = ${input.canonicalKey}
        AND current_answer.entity_id IS NOT DISTINCT FROM ${input.entityId}
        AND answer_scope.scope_fingerprint = ${input.scopeFingerprint}
      LIMIT 1
    `.execute(this.database);
    const row = result.rows[0];
    if (!row) return null;
    return {
      answerVersionId: row.answer_version_id,
      normalizedValue: decodeCandidateValue(row),
      trustState: row.trust_state,
      source: row.source,
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null
    };
  }

  async listCurrentCandidates(input: {
    accountId: string;
    candidateId: string;
    canonicalKey: string;
    entityId: string | null;
    context: CandidateScopeContext;
  }): Promise<readonly CandidateResolutionCandidate[]> {
    const result = await sql<CandidateResolutionRow>`
      SELECT
        version.id AS answer_version_id,
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
        version.created_at,
        answer_scope.scope_type,
        answer_scope.scope_fingerprint,
        answer_scope.company_id,
        answer_scope.job_id,
        answer_scope.application_id,
        answer_scope.country_code,
        answer_scope.role_family
      FROM candidates candidate
      JOIN candidate_answers_current current_answer
        ON current_answer.candidate_id = candidate.id
      JOIN candidate_answer_versions version
        ON version.id = current_answer.answer_version_id
      JOIN canonical_fields canonical
        ON canonical.id = current_answer.canonical_id
      LEFT JOIN candidate_entities entity
        ON entity.id = current_answer.entity_id
       AND entity.candidate_id = candidate.id
      JOIN candidate_answer_scopes answer_scope
        ON answer_scope.id = current_answer.scope_id
       AND answer_scope.candidate_id = candidate.id
      WHERE candidate.id = ${input.candidateId}
        AND candidate.account_id = ${input.accountId}
        AND candidate.status = 'ACTIVE'
        AND canonical.canonical_key = ${input.canonicalKey}
        AND canonical.status = 'ACTIVE'
        AND current_answer.entity_id IS NOT DISTINCT FROM ${input.entityId}
        AND version.trust_state <> 'REMOVED'
        AND (
          current_answer.entity_id IS NULL
          OR (entity.status = 'ACTIVE' AND entity.entity_type = canonical.entity_type)
        )
        AND (answer_scope.application_id IS NULL OR answer_scope.application_id = ${input.context.applicationId ?? null})
        AND (answer_scope.job_id IS NULL OR answer_scope.job_id = ${input.context.jobId ?? null})
        AND (answer_scope.company_id IS NULL OR answer_scope.company_id = ${input.context.companyId ?? null})
        AND (answer_scope.country_code IS NULL OR answer_scope.country_code = ${input.context.countryCode ?? null})
        AND (answer_scope.role_family IS NULL OR answer_scope.role_family = ${input.context.roleFamily ?? null})
    `.execute(this.database);
    return result.rows.map((row) => ({
      answerVersionId: row.answer_version_id,
      normalizedValue: decodeCandidateValue(row),
      trustState: row.trust_state,
      source: row.source,
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
      createdAt: new Date(row.created_at),
      scope: persistedScope(row)
    }));
  }

  async commitAnswerGroup(
    command: PersistCandidateAnswerGroupCommand
  ): Promise<CandidateAnswerGroupMutationResult> {
    return inTransaction(this.database, async (transaction) => {
      const candidate = await sql<{ id: string }>`
        SELECT candidate.id
        FROM candidates candidate
        JOIN accounts account ON account.id = candidate.account_id
        WHERE candidate.id = ${command.candidateId}
          AND candidate.account_id = ${command.accountId}
          AND candidate.status = 'ACTIVE'
          AND account.status = 'ACTIVE'
        LIMIT 1
      `.execute(transaction);
      if (!candidate.rows[0]) throw new NotFoundError("Active candidate was not found for this account.");
      if (command.items.length < 1 || command.items.length > 50) {
        throw new ValidationError("Candidate-answer groups must contain between 1 and 50 items.");
      }

      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:${command.idempotencyKey}`})::bigint)`.execute(
        transaction
      );
      const replaySet = await sql<{ id: string; request_fingerprint: string }>`
        SELECT id, request_fingerprint
        FROM candidate_answer_change_sets
        WHERE candidate_id = ${command.candidateId}
          AND idempotency_key = ${command.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      const replayRow = replaySet.rows[0];
      if (replayRow) {
        if (replayRow.request_fingerprint !== command.requestFingerprint) {
          throw new IdempotencyConflictError(
            "Candidate-answer group idempotency key was reused with different input."
          );
        }
        const replayItems = await sql<{
          item_key: string | null;
          canonical_key: string;
          scope_id: string;
          answer_version_id: string;
          trust_state: "REVIEW" | "TRUSTED";
          transition_kind: CandidateAnswerTransitionKind;
        }>`
          SELECT
            item.item_key,
            canonical.canonical_key,
            item.scope_id,
            item.new_version_id AS answer_version_id,
            version.trust_state,
            item.transition_kind
          FROM candidate_answer_change_set_items item
          JOIN candidate_answer_versions version ON version.id = item.new_version_id
          JOIN canonical_fields canonical ON canonical.id = item.canonical_id
          WHERE item.change_set_id = ${replayRow.id}
          ORDER BY item.item_key, item.id
        `.execute(transaction);
        if (
          replayItems.rows.length !== command.items.length ||
          replayItems.rows.some((item) => !item.item_key)
        ) {
          throw new Error("Committed candidate-answer group is missing its item results.");
        }
        return {
          candidateId: command.candidateId,
          changeSetId: replayRow.id,
          items: replayItems.rows.map((item) => ({
            itemKey: item.item_key as string,
            canonicalKey: item.canonical_key,
            scopeId: item.scope_id,
            answerVersionId: item.answer_version_id,
            trustState: item.trust_state,
            transitionKind: item.transition_kind
          })),
          idempotentReplay: true
        };
      }

      const familyLocks = [...new Set(command.items.map((item) =>
        [command.candidateId, item.canonicalKey, item.entityId ?? "NONE", "FAMILY"].join(":")
      ))].sort();
      for (const lock of familyLocks) {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${lock})::bigint)`.execute(transaction);
      }
      const logicalLocks = [...new Set(command.items.map((item) =>
        [command.candidateId, item.canonicalKey, item.entityId ?? "NONE", item.scope.scopeFingerprint].join(":")
      ))].sort();
      if (logicalLocks.length !== command.items.length) {
        throw new ValidationError("A candidate-answer group cannot mutate one logical answer twice.");
      }
      for (const lock of logicalLocks) {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${lock})::bigint)`.execute(transaction);
      }
      if (command.commitPoint === "VERIFIED_SUBMISSION" && (!command.applicationId || !command.checkpointId)) {
        throw new ValidationError("Verified submission learning requires an application checkpoint.");
      }
      if (command.commitPoint === "EXPLICIT_SAVE" && command.checkpointId && !command.applicationId) {
        throw new ValidationError("An explicit-save checkpoint requires its application.");
      }
      if (command.commitPoint === "LEGACY_IMPORT" && (command.applicationId || command.checkpointId)) {
        throw new ValidationError("Legacy import cannot use application checkpoint authority.");
      }

      const prepared: Array<{
        item: PersistCandidateAnswerGroupCommand["items"][number];
        policy: CandidatePolicyRow;
        scope: ScopeRow;
        current: { id: string; answer_version_id: string } | null;
      }> = [];
      for (const item of command.items) {
        const policyResult = await sql<CandidatePolicyRow>`
          SELECT
            canonical.id AS canonical_id,
            canonical.value_type,
            canonical.entity_type,
            policy.id AS policy_id,
            policy.policy_version
          FROM canonical_fields canonical
          JOIN canonical_answer_policies policy
            ON policy.canonical_id = canonical.id
           AND policy.active
          WHERE canonical.canonical_key = ${item.canonicalKey}
            AND canonical.status = 'ACTIVE'
          LIMIT 1
          FOR SHARE
        `.execute(transaction);
        const policy = policyResult.rows[0];
        if (!policy) throw new NotFoundError("Active canonical answer policy was not found.");
        if (policy.policy_version !== item.policyVersion || policy.value_type !== item.normalizedValue.kind) {
          throw new ConflictError("Candidate answer policy changed before the grouped mutation committed.", {
            canonicalKey: item.canonicalKey,
            expectedPolicyVersion: item.policyVersion,
            activePolicyVersion: policy.policy_version
          });
        }
        if (policy.entity_type) {
          if (!item.entityId) throw new ValidationError("The canonical requires a stable candidate entity.");
          const entity = await sql<{ entity_type: string }>`
            SELECT entity_type
            FROM candidate_entities
            WHERE id = ${item.entityId}
              AND candidate_id = ${command.candidateId}
              AND status = 'ACTIVE'
            LIMIT 1
          `.execute(transaction);
          if (entity.rows[0]?.entity_type !== policy.entity_type) {
            throw new ValidationError("Candidate entity does not match the canonical policy.");
          }
        } else if (item.entityId) {
          throw new ValidationError("The canonical does not accept a candidate entity.");
        }

        const scopeId = this.newId();
        const scopeResult = await sql<ScopeRow>`
          INSERT INTO candidate_answer_scopes (
            id, candidate_id, scope_type, scope_fingerprint,
            company_id, job_id, application_id, country_code, role_family
          ) VALUES (
            ${scopeId}, ${command.candidateId}, ${item.scope.scopeType}, ${item.scope.scopeFingerprint},
            ${item.scope.companyId ?? null}, ${item.scope.jobId ?? null},
            ${item.scope.applicationId ?? null}, ${item.scope.countryCode ?? null},
            ${item.scope.roleFamily ?? null}
          )
          ON CONFLICT (candidate_id, scope_type, scope_fingerprint)
          DO UPDATE SET scope_fingerprint = EXCLUDED.scope_fingerprint
          RETURNING id, scope_type, scope_fingerprint, company_id, job_id,
            application_id, country_code, role_family
        `.execute(transaction);
        const persistedScope = scopeResult.rows[0];
        if (!persistedScope) throw new Error("Candidate answer scope was not returned after upsert.");
        assertPersistedScopeMatches(persistedScope, item.scope);

        if (command.checkpointId) {
          const checkpoint = await sql<{ checkpoint_type: string }>`
            SELECT checkpoint.checkpoint_type
            FROM application_checkpoints checkpoint
            JOIN applications application ON application.id = checkpoint.application_id
            JOIN application_runs run
              ON run.id = checkpoint.run_id AND run.application_id = checkpoint.application_id
            LEFT JOIN jobs job ON job.id = application.job_id
            WHERE checkpoint.id = ${command.checkpointId}
              AND checkpoint.application_id = ${command.applicationId}
              AND checkpoint.status = 'VERIFIED'
              AND checkpoint.checkpoint_type = ${
                command.commitPoint === "VERIFIED_SUBMISSION" ? "SUBMISSION" : "EXPLICIT_SAVE"
              }
              AND application.candidate_id = ${command.candidateId}
              AND application.account_id = ${command.accountId}
              AND (${item.scope.applicationId ?? null}::uuid IS NULL OR ${item.scope.applicationId ?? null}::uuid = application.id)
              AND (${item.scope.jobId ?? null}::uuid IS NULL OR ${item.scope.jobId ?? null}::uuid = application.job_id)
              AND (${item.scope.companyId ?? null}::uuid IS NULL OR ${item.scope.companyId ?? null}::uuid = job.company_id)
              AND (${item.scope.countryCode ?? null}::text IS NULL OR ${item.scope.countryCode ?? null}::text = job.country_code)
              AND (${item.scope.roleFamily ?? null}::text IS NULL OR ${item.scope.roleFamily ?? null}::text = job.role_family)
              AND (
                ${command.commitPoint} <> 'VERIFIED_SUBMISSION'
                OR (
                  application.status = 'SUBMITTED'
                  AND application.submitted_at IS NOT NULL
                  AND run.status = 'COMPLETED'
                  AND run.ended_at IS NOT NULL
                )
              )
            LIMIT 1
          `.execute(transaction);
          if (!checkpoint.rows[0]) {
            throw new ValidationError("Candidate answer checkpoint authority is invalid or unverified.", {
              canonicalKey: item.canonicalKey,
              commitPoint: command.commitPoint
            });
          }
        }
        const current = await sql<{ id: string; answer_version_id: string }>`
          SELECT id, answer_version_id
          FROM candidate_answers_current
          WHERE candidate_id = ${command.candidateId}
            AND canonical_id = ${policy.canonical_id}
            AND entity_id IS NOT DISTINCT FROM ${item.entityId}
            AND scope_id = ${persistedScope.id}
          LIMIT 1
          FOR UPDATE
        `.execute(transaction);
        const currentRow = current.rows[0] ?? null;
        if ((currentRow?.answer_version_id ?? null) !== item.expectedCurrentVersionId) {
          throw new ConflictError("Candidate answer changed after the grouped mutation was prepared.", {
            canonicalKey: item.canonicalKey,
            expectedCurrentVersionId: item.expectedCurrentVersionId,
            actualCurrentVersionId: currentRow?.answer_version_id ?? null
          });
        }
        prepared.push({ item, policy, scope: persistedScope, current: currentRow });
      }

      const changeSetId = this.newId();
      await sql`
        INSERT INTO candidate_answer_change_sets (
          id, candidate_id, source, application_id, checkpoint_id,
          idempotency_key, request_fingerprint, status, created_at
        ) VALUES (
          ${changeSetId}, ${command.candidateId}, ${
            command.commitPoint === "LEGACY_IMPORT" ? "LEGACY_IMPORT" : "GROUPED_CANDIDATE_UPDATE"
          },
          ${command.applicationId}, ${command.checkpointId}, ${command.idempotencyKey},
          ${command.requestFingerprint}, 'COMMITTED', ${command.committedAt}
        )
      `.execute(transaction);
      const results: CandidateAnswerGroupMutationResult["items"][number][] = [];
      for (const entry of prepared) {
        const answerVersionId = this.newId();
        const changeSetItemId = this.newId();
        const encoded = encodeCandidateValue(entry.item.normalizedValue);
        await sql`
          INSERT INTO candidate_answer_versions (
            id, candidate_id, canonical_id, entity_id, scope_id, policy_id,
            value_type, text_value, integer_value, decimal_value, boolean_value,
            date_value, date_precision, structured_value, value_fingerprint,
            fingerprint_key_version, source, trust_state, confirmed_at, created_at,
            supersedes_version_id, change_set_id
          ) VALUES (
            ${answerVersionId}, ${command.candidateId}, ${entry.policy.canonical_id},
            ${entry.item.entityId}, ${entry.scope.id}, ${entry.policy.policy_id},
            ${entry.item.normalizedValue.kind}, ${encoded.textValue}, ${encoded.integerValue},
            CAST(${encoded.decimalValue} AS numeric), ${encoded.booleanValue},
            CAST(${encoded.dateValue} AS date), ${encoded.datePrecision},
            CAST(${encoded.structuredValueJson} AS jsonb), ${entry.item.valueFingerprint},
            ${entry.item.fingerprintKeyVersion}, ${entry.item.source}, ${entry.item.trustState},
            ${command.committedAt}, ${command.committedAt},
            ${entry.current?.answer_version_id ?? null}, ${changeSetId}
          )
        `.execute(transaction);
        if (entry.current) {
          const updated = await sql`
            UPDATE candidate_answers_current
            SET answer_version_id = ${answerVersionId}, updated_at = ${command.committedAt}
            WHERE id = ${entry.current.id}
              AND answer_version_id = ${entry.current.answer_version_id}
          `.execute(transaction);
          if (updated.numAffectedRows !== 1n) {
            throw new ConflictError("Candidate answer changed during grouped mutation commit.");
          }
        } else {
          await sql`
            INSERT INTO candidate_answers_current (
              id, candidate_id, canonical_id, entity_id, scope_id, answer_version_id, updated_at
            ) VALUES (
              ${this.newId()}, ${command.candidateId}, ${entry.policy.canonical_id},
              ${entry.item.entityId}, ${entry.scope.id}, ${answerVersionId}, ${command.committedAt}
            )
          `.execute(transaction);
        }
        await sql`
          INSERT INTO candidate_answer_change_set_items (
            id, candidate_id, change_set_id, item_key, canonical_id, scope_id,
            previous_version_id, new_version_id, outcome, transition_kind, created_at
          ) VALUES (
            ${changeSetItemId}, ${command.candidateId}, ${changeSetId}, ${entry.item.itemKey},
            ${entry.policy.canonical_id}, ${entry.scope.id},
            ${entry.current?.answer_version_id ?? null}, ${answerVersionId},
            ${entry.current ? "REPLACED" : "CREATED"}, ${entry.item.transitionKind},
            ${command.committedAt}
          )
        `.execute(transaction);
        results.push({
          itemKey: entry.item.itemKey,
          canonicalKey: entry.item.canonicalKey,
          scopeId: entry.scope.id,
          answerVersionId,
          trustState: entry.item.trustState,
          transitionKind: entry.item.transitionKind
        });
      }
      await sql`
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload_reference, available_at, created_at
        ) VALUES (
          ${this.newId()}, 'CANDIDATE', ${command.candidateId}, ${
            command.commitPoint === "LEGACY_IMPORT"
              ? "candidate.answers.legacy_imported"
              : "candidate.answers.group_updated"
          },
          CAST(${JSON.stringify({
            changeSetId,
            itemCount: results.length,
            answerVersionIds: results.map((item) => item.answerVersionId)
          })} AS jsonb),
          ${command.committedAt}, ${command.committedAt}
        )
      `.execute(transaction);
      return {
        candidateId: command.candidateId,
        changeSetId,
        items: [...results].sort((left, right) => left.itemKey.localeCompare(right.itemKey)),
        idempotentReplay: false
      };
    });
  }

  async recordTrialOutcomeReceipt(
    command: RecordTrialOutcomeReceiptCommand
  ): Promise<CandidateAnswerUsageProofResult> {
    return inTransaction(this.database, async (transaction) => {
      const candidate = await sql<{ id: string }>`
        SELECT candidate.id
        FROM candidates candidate
        JOIN accounts account ON account.id = candidate.account_id
        WHERE candidate.id = ${command.candidateId}
          AND candidate.account_id = ${command.accountId}
          AND candidate.status = 'ACTIVE'
          AND account.status = 'ACTIVE'
        LIMIT 1
      `.execute(transaction);
      if (!candidate.rows[0]) throw new NotFoundError("Active candidate was not found for this account.");

      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:${command.idempotencyKey}`})::bigint)`.execute(
        transaction
      );
      const replay = await sql<{
        id: string;
        request_fingerprint: string;
        outcome: RecordTrialOutcomeReceiptCommand["outcome"];
        final_value_fingerprint: string;
        fingerprint_key_version: number;
      }>`
        SELECT id, request_fingerprint, outcome, final_value_fingerprint, fingerprint_key_version
        FROM candidate_answer_usage_proofs
        WHERE candidate_id = ${command.candidateId}
          AND idempotency_key = ${command.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      const replayRow = replay.rows[0];
      if (replayRow) {
        if (replayRow.request_fingerprint !== command.requestFingerprint) {
          throw new IdempotencyConflictError("Usage-proof idempotency key was reused with different input.");
        }
        return {
          usageProofId: replayRow.id,
          outcome: replayRow.outcome,
          finalValueFingerprint: replayRow.final_value_fingerprint,
          fingerprintKeyVersion: replayRow.fingerprint_key_version,
          idempotentReplay: true
        };
      }

      const runState = await sql<{ last_sequence: string }>`
        SELECT run.last_sequence::text AS last_sequence
        FROM application_runs run
        JOIN applications application
          ON application.id = run.application_id
        WHERE run.id = ${command.runId}
          AND run.application_id = ${command.applicationId}
          AND run.status = 'ACTIVE'
          AND application.candidate_id = ${command.candidateId}
          AND application.account_id = ${command.accountId}
          AND application.status IN ('IN_PROGRESS', 'REVIEW')
        LIMIT 1
        FOR UPDATE OF run
      `.execute(transaction);
      const lastSequence = runState.rows[0] ? Number(runState.rows[0].last_sequence) : null;
      if (lastSequence === null || command.sequence !== lastSequence + 1) {
        throw new ConflictError("Candidate trial outcome sequence is stale or out of order.", {
          expectedSequence: lastSequence === null ? null : lastSequence + 1,
          receivedSequence: command.sequence
        });
      }

      const authority = await sql<{
        canonical_id: number;
        entity_id: string | null;
        scope_id: string;
      }>`
        SELECT
          version.canonical_id,
          version.entity_id,
          version.scope_id
        FROM candidate_answer_versions version
        JOIN candidates candidate
          ON candidate.id = version.candidate_id
        JOIN accounts account
          ON account.id = candidate.account_id
        JOIN candidate_answers_current current_answer
          ON current_answer.answer_version_id = version.id
         AND current_answer.candidate_id = version.candidate_id
         AND current_answer.canonical_id = version.canonical_id
         AND current_answer.entity_id IS NOT DISTINCT FROM version.entity_id
         AND current_answer.scope_id = version.scope_id
        JOIN canonical_fields canonical
          ON canonical.id = version.canonical_id
         AND canonical.status = 'ACTIVE'
        JOIN canonical_answer_policies policy
          ON policy.id = version.policy_id
         AND policy.canonical_id = version.canonical_id
         AND policy.active
        JOIN candidate_answer_scopes answer_scope
          ON answer_scope.id = version.scope_id
         AND answer_scope.candidate_id = version.candidate_id
        JOIN applications application
          ON application.id = ${command.applicationId}
         AND application.candidate_id = version.candidate_id
         AND application.account_id = candidate.account_id
         AND application.status IN ('IN_PROGRESS', 'REVIEW')
        JOIN application_runs run
          ON run.id = ${command.runId}
         AND run.application_id = application.id
         AND run.status = 'ACTIVE'
         AND run.last_sequence = ${lastSequence}
        LEFT JOIN jobs job
          ON job.id = application.job_id
        LEFT JOIN candidate_entities entity
          ON entity.id = version.entity_id
         AND entity.candidate_id = version.candidate_id
        WHERE version.id = ${command.usedAnswerVersionId}
          AND version.candidate_id = ${command.candidateId}
          AND candidate.account_id = ${command.accountId}
          AND candidate.status = 'ACTIVE'
          AND account.status = 'ACTIVE'
          AND version.trust_state = 'REVIEW'
          AND version.source IN ('USER_MANUAL', 'USER_CORRECTION')
          AND policy.learning_mode = 'REVIEW_TO_SAVE'
          AND policy.review_reuse = 'EXACT_SCOPE_TRIAL'
          AND answer_scope.scope_type = ANY(policy.allowed_scope_types)
          AND answer_scope.scope_fingerprint = ${command.expectedScopeFingerprint}
          AND (answer_scope.application_id IS NULL OR answer_scope.application_id = application.id)
          AND (answer_scope.job_id IS NULL OR answer_scope.job_id = application.job_id)
          AND (answer_scope.company_id IS NULL OR answer_scope.company_id = job.company_id)
          AND (answer_scope.country_code IS NULL OR answer_scope.country_code = job.country_code)
          AND (answer_scope.role_family IS NULL OR answer_scope.role_family = job.role_family)
          AND (version.entity_id IS NULL OR (
            entity.status = 'ACTIVE' AND entity.entity_type = canonical.entity_type
          ))
        LIMIT 1
        FOR UPDATE OF current_answer
      `.execute(transaction);
      const authorityRow = authority.rows[0];
      if (!authorityRow) {
        throw new ValidationError("Trial outcome receipt lacks exact current REVIEW and active-run authority.", {
          reasonCode: "ACTIVE_RUN_REVIEW_USAGE_AUTHORITY_REQUIRED"
        });
      }

      const usageProofId = this.newId();
      await sql`
        UPDATE application_runs
        SET last_sequence = ${command.sequence}
        WHERE id = ${command.runId}
          AND application_id = ${command.applicationId}
          AND last_sequence = ${lastSequence}
          AND status = 'ACTIVE'
      `.execute(transaction);
      await sql`
        INSERT INTO application_events (
          id,
          application_id,
          run_id,
          sequence,
          event_type,
          reason_code,
          structural_metadata,
          occurred_at
        ) VALUES (
          ${this.newId()},
          ${command.applicationId},
          ${command.runId},
          ${command.sequence},
          'CANDIDATE_REVIEW_TRIAL_OUTCOME',
          ${command.outcome},
          CAST(${JSON.stringify({
            usageProofId,
            operationId: command.operationId,
            answerVersionId: command.usedAnswerVersionId,
            scopeFingerprint: command.expectedScopeFingerprint,
            finalActor: command.finalActor
          })} AS jsonb),
          ${command.recordedAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_answer_usage_proofs (
          id,
          candidate_id,
          application_id,
          run_id,
          operation_id,
          sequence,
          answer_version_id,
          canonical_id,
          entity_id,
          scope_id,
          scope_fingerprint,
          outcome,
          final_actor,
          final_value_fingerprint,
          fingerprint_key_version,
          idempotency_key,
          request_fingerprint,
          status,
          recorded_at
        ) VALUES (
          ${usageProofId},
          ${command.candidateId},
          ${command.applicationId},
          ${command.runId},
          ${command.operationId},
          ${command.sequence},
          ${command.usedAnswerVersionId},
          ${authorityRow.canonical_id},
          ${authorityRow.entity_id},
          ${authorityRow.scope_id},
          ${command.expectedScopeFingerprint},
          ${command.outcome},
          ${command.finalActor},
          ${command.finalValueFingerprint},
          ${command.fingerprintKeyVersion},
          ${command.idempotencyKey},
          ${command.requestFingerprint},
          'RECORDED',
          ${command.recordedAt}
        )
      `.execute(transaction);
      return {
        usageProofId,
        outcome: command.outcome,
        finalValueFingerprint: command.finalValueFingerprint,
        fingerprintKeyVersion: command.fingerprintKeyVersion,
        idempotentReplay: false
      };
    });
  }

  async applyVerifiedReviewOutcome(
    command: ApplyVerifiedReviewOutcomeCommand
  ): Promise<CandidateAnswerMutationResult> {
    return inTransaction(this.database, async (transaction) => {
      const candidate = await sql<{ id: string }>`
        SELECT candidate.id
        FROM candidates candidate
        JOIN accounts account ON account.id = candidate.account_id
        WHERE candidate.id = ${command.candidateId}
          AND candidate.account_id = ${command.accountId}
          AND candidate.status = 'ACTIVE'
          AND account.status = 'ACTIVE'
        LIMIT 1
      `.execute(transaction);
      if (!candidate.rows[0]) throw new NotFoundError("Active candidate was not found for this account.");

      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:${command.idempotencyKey}`})::bigint)`.execute(
        transaction
      );
      const replay = await sql<{
        change_set_id: string;
        request_fingerprint: string;
        canonical_key: string;
        scope_id: string;
        answer_version_id: string;
        trust_state: "REVIEW" | "TRUSTED";
        transition_kind: CandidateAnswerTransitionKind;
      }>`
        SELECT
          change_set.id AS change_set_id,
          change_set.request_fingerprint,
          canonical.canonical_key,
          item.scope_id,
          item.new_version_id AS answer_version_id,
          version.trust_state,
          item.transition_kind
        FROM candidate_answer_change_sets change_set
        JOIN candidate_answer_change_set_items item
          ON item.change_set_id = change_set.id
        JOIN candidate_answer_versions version
          ON version.id = item.new_version_id
        JOIN canonical_fields canonical
          ON canonical.id = item.canonical_id
        WHERE change_set.candidate_id = ${command.candidateId}
          AND change_set.idempotency_key = ${command.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      const replayRow = replay.rows[0];
      if (replayRow) {
        if (replayRow.request_fingerprint !== command.requestFingerprint) {
          throw new IdempotencyConflictError("Review-outcome idempotency key was reused with different input.");
        }
        return {
          candidateId: command.candidateId,
          canonicalKey: replayRow.canonical_key,
          scopeId: replayRow.scope_id,
          changeSetId: replayRow.change_set_id,
          answerVersionId: replayRow.answer_version_id,
          trustState: replayRow.trust_state,
          transitionKind: replayRow.transition_kind,
          idempotentReplay: true
        };
      }

      const proof = await sql<CandidateAnswerValueRow & {
        proof_status: "RECORDED" | "CONSUMED";
        outcome: "CONFIRMED_UNCHANGED" | "USER_CORRECTED";
        final_actor: "COPILOT" | "USER";
        proof_value_fingerprint: string;
        proof_key_version: number;
        application_id: string;
        answer_version_id: string;
        canonical_id: number;
        canonical_key: string;
        entity_id: string | null;
        scope_id: string;
        policy_id: string;
        policy_version: number;
        value_type: PersistableNormalizedValue["kind"];
        current_answer_id: string;
        checkpoint_observed_at: Date | string;
        scope_type: CandidateAnswerScope["scopeType"];
        scope_fingerprint: string;
        company_id: string | null;
        job_id: string | null;
        scope_application_id: string | null;
        country_code: string | null;
        role_family: string | null;
      }>`
        SELECT
          proof.status AS proof_status,
          proof.outcome,
          proof.final_actor,
          proof.final_value_fingerprint AS proof_value_fingerprint,
          proof.fingerprint_key_version AS proof_key_version,
          proof.application_id,
          used_version.id AS answer_version_id,
          proof.canonical_id,
          canonical.canonical_key,
          proof.entity_id,
          proof.scope_id,
          policy.id AS policy_id,
          policy.policy_version,
          used_version.value_type,
          used_version.text_value,
          used_version.integer_value,
          used_version.decimal_value,
          used_version.boolean_value,
          used_version.date_value,
          used_version.date_precision,
          used_version.structured_value,
          used_version.trust_state,
          used_version.source,
          used_version.confirmed_at,
          current_answer.id AS current_answer_id,
          checkpoint.observed_at AS checkpoint_observed_at,
          answer_scope.scope_type,
          answer_scope.scope_fingerprint,
          answer_scope.company_id,
          answer_scope.job_id,
          answer_scope.application_id AS scope_application_id,
          answer_scope.country_code,
          answer_scope.role_family
        FROM candidate_answer_usage_proofs proof
        JOIN candidates candidate
          ON candidate.id = proof.candidate_id
        JOIN accounts account
          ON account.id = candidate.account_id
        JOIN candidate_answer_versions used_version
          ON used_version.id = proof.answer_version_id
         AND used_version.candidate_id = proof.candidate_id
         AND used_version.canonical_id = proof.canonical_id
         AND used_version.entity_id IS NOT DISTINCT FROM proof.entity_id
         AND used_version.scope_id = proof.scope_id
        JOIN candidate_answers_current current_answer
          ON current_answer.answer_version_id = used_version.id
         AND current_answer.candidate_id = used_version.candidate_id
         AND current_answer.canonical_id = used_version.canonical_id
         AND current_answer.entity_id IS NOT DISTINCT FROM used_version.entity_id
         AND current_answer.scope_id = used_version.scope_id
        JOIN canonical_fields canonical
          ON canonical.id = proof.canonical_id
         AND canonical.status = 'ACTIVE'
        JOIN canonical_answer_policies policy
          ON policy.id = used_version.policy_id
         AND policy.canonical_id = canonical.id
         AND policy.active
        JOIN candidate_answer_scopes answer_scope
          ON answer_scope.id = proof.scope_id
         AND answer_scope.candidate_id = proof.candidate_id
        JOIN applications application
          ON application.id = proof.application_id
         AND application.candidate_id = proof.candidate_id
         AND application.account_id = candidate.account_id
         AND application.status = 'SUBMITTED'
         AND application.submitted_at IS NOT NULL
        JOIN application_runs run
          ON run.id = proof.run_id
         AND run.application_id = proof.application_id
         AND run.status = 'COMPLETED'
         AND run.ended_at IS NOT NULL
        JOIN application_checkpoints checkpoint
          ON checkpoint.id = ${command.checkpointId}
         AND checkpoint.application_id = proof.application_id
         AND checkpoint.run_id = proof.run_id
        LEFT JOIN candidate_entities entity
          ON entity.id = proof.entity_id
         AND entity.candidate_id = proof.candidate_id
        WHERE proof.id = ${command.usageProofId}
          AND proof.candidate_id = ${command.candidateId}
          AND proof.application_id = ${command.applicationId}
          AND proof.run_id = ${command.runId}
          AND proof.answer_version_id = ${command.usedAnswerVersionId}
          AND proof.scope_fingerprint = ${command.expectedScopeFingerprint}
          AND proof.outcome = ${command.outcome}
          AND canonical.canonical_key = ${command.canonicalKey}
          AND candidate.account_id = ${command.accountId}
          AND candidate.status = 'ACTIVE'
          AND account.status = 'ACTIVE'
          AND used_version.trust_state = 'REVIEW'
          AND used_version.source IN ('USER_MANUAL', 'USER_CORRECTION')
          AND policy.learning_mode = 'REVIEW_TO_SAVE'
          AND policy.review_reuse = 'EXACT_SCOPE_TRIAL'
          AND answer_scope.scope_type = ANY(policy.allowed_scope_types)
          AND answer_scope.scope_fingerprint = proof.scope_fingerprint
          AND checkpoint.checkpoint_type = 'SUBMISSION'
          AND checkpoint.status = 'VERIFIED'
          AND proof.recorded_at <= checkpoint.observed_at
          AND proof.sequence <= run.last_sequence
          AND (proof.entity_id IS NULL OR (
            entity.status = 'ACTIVE' AND entity.entity_type = canonical.entity_type
          ))
        LIMIT 1
        FOR UPDATE OF proof, current_answer
      `.execute(transaction);
      const proofRow = proof.rows[0];
      if (!proofRow) {
        throw new ConflictError("Verified REVIEW usage proof is stale, foreign, or no longer authoritative.");
      }
      if (proofRow.proof_status !== "RECORDED") {
        throw new ConflictError("Candidate REVIEW trial outcome receipt has already been consumed.");
      }
      if (
        proofRow.proof_value_fingerprint !== command.finalValueFingerprint ||
        proofRow.proof_key_version !== command.fingerprintKeyVersion
      ) {
        throw new ValidationError("Final candidate value does not match the value-free usage proof.", {
          reasonCode: "USAGE_PROOF_VALUE_MISMATCH"
        });
      }
      if (proofRow.value_type !== command.finalNormalizedValue.kind) {
        throw new ValidationError("Final candidate value type conflicts with the active canonical policy.");
      }
      hydrateCandidateAnswerScope({
        scopeType: proofRow.scope_type,
        scopeFingerprint: proofRow.scope_fingerprint,
        context: {
          ...(proofRow.company_id ? { companyId: proofRow.company_id } : {}),
          ...(proofRow.job_id ? { jobId: proofRow.job_id } : {}),
          ...(proofRow.scope_application_id ? { applicationId: proofRow.scope_application_id } : {}),
          ...(proofRow.country_code ? { countryCode: proofRow.country_code } : {}),
          ...(proofRow.role_family ? { roleFamily: proofRow.role_family } : {})
        }
      });
      const usedNormalizedValue = decodeCandidateValue(proofRow);
      const unchanged = normalizedValuesEqual(usedNormalizedValue, command.finalNormalizedValue);
      if (proofRow.outcome === "CONFIRMED_UNCHANGED" && !unchanged) {
        throw new ValidationError("Unchanged REVIEW receipt conflicts with the locked candidate value.");
      }
      if (proofRow.outcome === "USER_CORRECTED" && unchanged) {
        throw new ValidationError("Corrected REVIEW receipt did not change the locked candidate value.");
      }

      const trustState = proofRow.outcome === "CONFIRMED_UNCHANGED" ? "TRUSTED" : "REVIEW";
      const transitionKind: CandidateAnswerTransitionKind =
        proofRow.outcome === "CONFIRMED_UNCHANGED" ? "PROMOTE_TRUSTED" : "CORRECT_REVIEW";
      const source: CandidateAnswerSource =
        proofRow.outcome === "CONFIRMED_UNCHANGED" ? "USER_ACCEPTED_REUSE" : "USER_CORRECTION";
      if (proofRow.outcome === "USER_CORRECTED" && proofRow.final_actor !== "USER") {
        throw new ValidationError("A corrected REVIEW outcome requires direct candidate action.");
      }

      const changeSetId = this.newId();
      const answerVersionId = this.newId();
      const changeSetItemId = this.newId();
      const encoded = encodeCandidateValue(command.finalNormalizedValue);
      await sql`
        INSERT INTO candidate_answer_change_sets (
          id,
          candidate_id,
          source,
          application_id,
          checkpoint_id,
          idempotency_key,
          request_fingerprint,
          status,
          created_at
        ) VALUES (
          ${changeSetId},
          ${command.candidateId},
          ${source},
          ${proofRow.application_id},
          ${command.checkpointId},
          ${command.idempotencyKey},
          ${command.requestFingerprint},
          'COMMITTED',
          ${command.committedAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_answer_versions (
          id,
          candidate_id,
          canonical_id,
          entity_id,
          scope_id,
          policy_id,
          value_type,
          text_value,
          integer_value,
          decimal_value,
          boolean_value,
          date_value,
          date_precision,
          structured_value,
          value_fingerprint,
          fingerprint_key_version,
          source,
          trust_state,
          confirmed_at,
          created_at,
          supersedes_version_id,
          change_set_id
        ) VALUES (
          ${answerVersionId},
          ${command.candidateId},
          ${proofRow.canonical_id},
          ${proofRow.entity_id},
          ${proofRow.scope_id},
          ${proofRow.policy_id},
          ${command.finalNormalizedValue.kind},
          ${encoded.textValue},
          ${encoded.integerValue},
          CAST(${encoded.decimalValue} AS numeric),
          ${encoded.booleanValue},
          CAST(${encoded.dateValue} AS date),
          ${encoded.datePrecision},
          CAST(${encoded.structuredValueJson} AS jsonb),
          ${command.finalValueFingerprint},
          ${command.fingerprintKeyVersion},
          ${source},
          ${trustState},
          ${new Date(proofRow.checkpoint_observed_at)},
          ${command.committedAt},
          ${proofRow.answer_version_id},
          ${changeSetId}
        )
      `.execute(transaction);
      const currentUpdate = await sql`
        UPDATE candidate_answers_current
        SET answer_version_id = ${answerVersionId}, updated_at = ${command.committedAt}
        WHERE id = ${proofRow.current_answer_id}
          AND answer_version_id = ${proofRow.answer_version_id}
      `.execute(transaction);
      if (currentUpdate.numAffectedRows !== 1n) {
        throw new ConflictError("Candidate REVIEW changed before its verified outcome committed.");
      }
      await sql`
        INSERT INTO candidate_answer_change_set_items (
          id,
          candidate_id,
          change_set_id,
          canonical_id,
          scope_id,
          previous_version_id,
          new_version_id,
          outcome,
          transition_kind,
          created_at
        ) VALUES (
          ${changeSetItemId},
          ${command.candidateId},
          ${changeSetId},
          ${proofRow.canonical_id},
          ${proofRow.scope_id},
          ${proofRow.answer_version_id},
          ${answerVersionId},
          'REPLACED',
          ${transitionKind},
          ${command.committedAt}
        )
      `.execute(transaction);
      const proofUpdate = await sql`
        UPDATE candidate_answer_usage_proofs
        SET
          status = 'CONSUMED',
          checkpoint_id = ${command.checkpointId},
          consumed_change_set_id = ${changeSetId},
          consumed_at = ${command.committedAt}
        WHERE id = ${command.usageProofId}
          AND status = 'RECORDED'
      `.execute(transaction);
      if (proofUpdate.numAffectedRows !== 1n) {
        throw new ConflictError("Verified REVIEW usage proof was consumed concurrently.");
      }
      await sql`
        INSERT INTO outbox_events (
          id,
          aggregate_type,
          aggregate_id,
          event_type,
          payload_reference,
          available_at,
          created_at
        ) VALUES (
          ${this.newId()},
          'CANDIDATE',
          ${command.candidateId},
          'candidate.answer.updated',
          CAST(${JSON.stringify({
            changeSetId,
            answerVersionId,
            canonicalKey: proofRow.canonical_key,
            transitionKind,
            usageProofId: command.usageProofId
          })} AS jsonb),
          ${command.committedAt},
          ${command.committedAt}
        )
      `.execute(transaction);
      return {
        candidateId: command.candidateId,
        canonicalKey: proofRow.canonical_key,
        scopeId: proofRow.scope_id,
        changeSetId,
        answerVersionId,
        trustState,
        transitionKind,
        idempotentReplay: false
      };
    });
  }

  async removeRedundantOverride(
    command: RemoveRedundantOverrideCommand
  ): Promise<CandidateAnswerMutationResult> {
    return inTransaction(this.database, async (transaction) => {
      const candidate = await sql<{ id: string }>`
        SELECT candidate.id
        FROM candidates candidate
        JOIN accounts account ON account.id = candidate.account_id
        WHERE candidate.id = ${command.candidateId}
          AND candidate.account_id = ${command.accountId}
          AND candidate.status = 'ACTIVE'
          AND account.status = 'ACTIVE'
        LIMIT 1
      `.execute(transaction);
      if (!candidate.rows[0]) throw new NotFoundError("Active candidate was not found for this account.");

      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:${command.idempotencyKey}`})::bigint)`.execute(
        transaction
      );
      await sql`SELECT pg_advisory_xact_lock(hashtext(${[
        command.candidateId,
        command.canonicalKey,
        command.entityId ?? "NONE",
        "FAMILY"
      ].join(":")})::bigint)`.execute(transaction);

      const replay = await sql<{
        change_set_id: string;
        request_fingerprint: string;
        canonical_key: string;
        scope_id: string;
        answer_version_id: string;
        trust_state: "REMOVED";
        transition_kind: CandidateAnswerTransitionKind;
      }>`
        SELECT
          change_set.id AS change_set_id,
          change_set.request_fingerprint,
          canonical.canonical_key,
          item.scope_id,
          item.new_version_id AS answer_version_id,
          version.trust_state,
          item.transition_kind
        FROM candidate_answer_change_sets change_set
        JOIN candidate_answer_change_set_items item
          ON item.change_set_id = change_set.id
        JOIN candidate_answer_versions version
          ON version.id = item.new_version_id
        JOIN canonical_fields canonical
          ON canonical.id = item.canonical_id
        WHERE change_set.candidate_id = ${command.candidateId}
          AND change_set.idempotency_key = ${command.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      const replayRow = replay.rows[0];
      if (replayRow) {
        if (replayRow.request_fingerprint !== command.requestFingerprint) {
          throw new IdempotencyConflictError(
            "Override-removal idempotency key was reused with different input."
          );
        }
        if (replayRow.trust_state !== "REMOVED" || replayRow.transition_kind !== "REMOVE_OVERRIDE") {
          throw new Error("Override-removal change set has an invalid committed result.");
        }
        return {
          candidateId: command.candidateId,
          canonicalKey: replayRow.canonical_key,
          scopeId: replayRow.scope_id,
          changeSetId: replayRow.change_set_id,
          answerVersionId: replayRow.answer_version_id,
          trustState: replayRow.trust_state,
          transitionKind: replayRow.transition_kind,
          idempotentReplay: true
        };
      }

      const policyResult = await sql<CandidatePolicyRow>`
        SELECT
          canonical.id AS canonical_id,
          canonical.value_type,
          canonical.entity_type,
          policy.id AS policy_id,
          policy.policy_version
        FROM canonical_fields canonical
        JOIN canonical_answer_policies policy
          ON policy.canonical_id = canonical.id
         AND policy.active
        WHERE canonical.canonical_key = ${command.canonicalKey}
          AND canonical.status = 'ACTIVE'
        LIMIT 1
        FOR SHARE
      `.execute(transaction);
      const persistedPolicy = policyResult.rows[0];
      if (!persistedPolicy) throw new NotFoundError("Active canonical answer policy was not found.");
      const policy = candidateAnswerPolicy(command.canonicalKey);
      if (persistedPolicy.policy_version !== command.policyVersion || policy.policyVersion !== command.policyVersion) {
        throw new ConflictError("Candidate answer policy changed before override removal committed.", {
          canonicalKey: command.canonicalKey,
          expectedPolicyVersion: command.policyVersion,
          activePolicyVersion: persistedPolicy.policy_version
        });
      }
      if (persistedPolicy.value_type !== policy.valueType || persistedPolicy.entity_type !== policy.entityType) {
        throw new ConflictError("Persisted candidate-answer policy differs from the runtime contract.", {
          canonicalKey: command.canonicalKey
        });
      }

      if (policy.entityType) {
        if (!command.entityId) throw new ValidationError("The canonical requires a stable candidate entity.");
        const entity = await sql<{ entity_type: string }>`
          SELECT entity_type
          FROM candidate_entities
          WHERE id = ${command.entityId}
            AND candidate_id = ${command.candidateId}
            AND status = 'ACTIVE'
          LIMIT 1
        `.execute(transaction);
        if (entity.rows[0]?.entity_type !== policy.entityType) {
          throw new ValidationError("Candidate entity does not match the canonical policy.");
        }
      } else if (command.entityId) {
        throw new ValidationError("The canonical does not accept a candidate entity.");
      }

      const current = await sql<CandidateRemovalRow>`
        SELECT
          current_answer.id AS current_answer_id,
          current_answer.scope_id,
          version.id AS answer_version_id,
          version.canonical_id,
          version.value_type,
          version.text_value,
          version.integer_value,
          version.decimal_value,
          version.boolean_value,
          version.date_value,
          version.date_precision,
          version.structured_value,
          version.value_fingerprint,
          version.fingerprint_key_version,
          version.trust_state,
          version.source,
          version.confirmed_at,
          version.created_at,
          answer_scope.scope_type,
          answer_scope.scope_fingerprint,
          answer_scope.company_id,
          answer_scope.job_id,
          answer_scope.application_id,
          answer_scope.country_code,
          answer_scope.role_family
        FROM candidates candidate
        JOIN candidate_answers_current current_answer
          ON current_answer.candidate_id = candidate.id
        JOIN candidate_answer_versions version
          ON version.id = current_answer.answer_version_id
        JOIN canonical_fields canonical
          ON canonical.id = current_answer.canonical_id
        LEFT JOIN candidate_entities entity
          ON entity.id = current_answer.entity_id
         AND entity.candidate_id = candidate.id
        JOIN candidate_answer_scopes answer_scope
          ON answer_scope.id = current_answer.scope_id
         AND answer_scope.candidate_id = candidate.id
        WHERE candidate.id = ${command.candidateId}
          AND candidate.account_id = ${command.accountId}
          AND candidate.status = 'ACTIVE'
          AND canonical.canonical_key = ${command.canonicalKey}
          AND canonical.status = 'ACTIVE'
          AND current_answer.entity_id IS NOT DISTINCT FROM ${command.entityId}
          AND version.trust_state <> 'REMOVED'
          AND (
            current_answer.entity_id IS NULL
            OR (entity.status = 'ACTIVE' AND entity.entity_type = canonical.entity_type)
          )
          AND (answer_scope.application_id IS NULL OR answer_scope.application_id = ${command.context.applicationId ?? null})
          AND (answer_scope.job_id IS NULL OR answer_scope.job_id = ${command.context.jobId ?? null})
          AND (answer_scope.company_id IS NULL OR answer_scope.company_id = ${command.context.companyId ?? null})
          AND (answer_scope.country_code IS NULL OR answer_scope.country_code = ${command.context.countryCode ?? null})
          AND (answer_scope.role_family IS NULL OR answer_scope.role_family = ${command.context.roleFamily ?? null})
        ORDER BY current_answer.id
        FOR UPDATE OF current_answer
      `.execute(transaction);
      const candidates = current.rows.map((row) => ({
        answerVersionId: row.answer_version_id,
        normalizedValue: decodeCandidateValue(row),
        trustState: row.trust_state,
        source: row.source,
        confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
        createdAt: new Date(row.created_at),
        scope: persistedScope(row)
      }));
      const plan = planRedundantOverrideRemoval({
        policy,
        candidates,
        context: command.context,
        overrideAnswerVersionId: command.overrideAnswerVersionId,
        overrideScopeFingerprint: command.overrideScopeFingerprint,
        inheritedAnswerVersionId: command.inheritedAnswerVersionId,
        inheritedScopeFingerprint: command.inheritedScopeFingerprint,
        evaluatedAt: command.removedAt
      });
      if (!plan.ok) {
        const concurrentReasons = new Set([
          "OVERRIDE_IS_NOT_CURRENT",
          "OVERRIDE_SCOPE_MISMATCH",
          "NO_BROADER_CANDIDATE_TRUTH",
          "INHERITED_ANSWER_IS_NOT_NEAREST",
          "INHERITED_SCOPE_MISMATCH"
        ]);
        const details = {
          canonicalKey: command.canonicalKey,
          reasonCode: plan.reason,
          candidateVersionIds: plan.candidateVersionIds
        };
        if (concurrentReasons.has(plan.reason)) {
          throw new ConflictError("Candidate answer hierarchy changed before override removal committed.", details);
        }
        throw new ValidationError("Contextual override cannot safely inherit broader candidate truth.", details);
      }

      const overrideRow = current.rows.find(
        (row) => row.answer_version_id === plan.override.answerVersionId
      );
      if (!overrideRow) throw new Error("Planned override row was not returned by the locked projection.");

      const changeSetId = this.newId();
      const answerVersionId = this.newId();
      const changeSetItemId = this.newId();
      const encoded = encodeCandidateValue(plan.override.normalizedValue);
      await sql`
        INSERT INTO candidate_answer_change_sets (
          id,
          candidate_id,
          source,
          application_id,
          checkpoint_id,
          idempotency_key,
          request_fingerprint,
          status,
          created_at
        ) VALUES (
          ${changeSetId},
          ${command.candidateId},
          'USER_ACCEPTED_REUSE',
          NULL,
          NULL,
          ${command.idempotencyKey},
          ${command.requestFingerprint},
          'COMMITTED',
          ${command.removedAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_answer_versions (
          id,
          candidate_id,
          canonical_id,
          entity_id,
          scope_id,
          policy_id,
          value_type,
          text_value,
          integer_value,
          decimal_value,
          boolean_value,
          date_value,
          date_precision,
          structured_value,
          value_fingerprint,
          fingerprint_key_version,
          source,
          trust_state,
          confirmed_at,
          created_at,
          supersedes_version_id,
          change_set_id
        ) VALUES (
          ${answerVersionId},
          ${command.candidateId},
          ${overrideRow.canonical_id},
          ${command.entityId},
          ${overrideRow.scope_id},
          ${persistedPolicy.policy_id},
          ${plan.override.normalizedValue.kind},
          ${encoded.textValue},
          ${encoded.integerValue},
          CAST(${encoded.decimalValue} AS numeric),
          ${encoded.booleanValue},
          CAST(${encoded.dateValue} AS date),
          ${encoded.datePrecision},
          CAST(${encoded.structuredValueJson} AS jsonb),
          ${overrideRow.value_fingerprint},
          ${overrideRow.fingerprint_key_version},
          'USER_ACCEPTED_REUSE',
          'REMOVED',
          NULL,
          ${command.removedAt},
          ${overrideRow.answer_version_id},
          ${changeSetId}
        )
      `.execute(transaction);
      const currentUpdate = await sql`
        UPDATE candidate_answers_current
        SET answer_version_id = ${answerVersionId}, updated_at = ${command.removedAt}
        WHERE id = ${overrideRow.current_answer_id}
          AND answer_version_id = ${overrideRow.answer_version_id}
      `.execute(transaction);
      if (currentUpdate.numAffectedRows !== 1n) {
        throw new ConflictError("Contextual override changed before removal committed.");
      }
      await sql`
        INSERT INTO candidate_answer_change_set_items (
          id,
          candidate_id,
          change_set_id,
          canonical_id,
          scope_id,
          previous_version_id,
          new_version_id,
          outcome,
          transition_kind,
          created_at
        ) VALUES (
          ${changeSetItemId},
          ${command.candidateId},
          ${changeSetId},
          ${overrideRow.canonical_id},
          ${overrideRow.scope_id},
          ${overrideRow.answer_version_id},
          ${answerVersionId},
          'REMOVED',
          'REMOVE_OVERRIDE',
          ${command.removedAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO outbox_events (
          id,
          aggregate_type,
          aggregate_id,
          event_type,
          payload_reference,
          available_at,
          created_at
        ) VALUES (
          ${this.newId()},
          'CANDIDATE',
          ${command.candidateId},
          'candidate.answer.override_removed',
          CAST(${JSON.stringify({
            changeSetId,
            answerVersionId,
            canonicalKey: command.canonicalKey,
            inheritedAnswerVersionId: plan.inherited.answerVersionId,
            transitionKind: "REMOVE_OVERRIDE"
          })} AS jsonb),
          ${command.removedAt},
          ${command.removedAt}
        )
      `.execute(transaction);

      return {
        candidateId: command.candidateId,
        canonicalKey: command.canonicalKey,
        scopeId: overrideRow.scope_id,
        changeSetId,
        answerVersionId,
        trustState: "REMOVED",
        transitionKind: "REMOVE_OVERRIDE",
        idempotentReplay: false
      };
    });
  }

  async undoChangeSet(
    command: UndoCandidateAnswerChangeSetCommand
  ): Promise<CandidateAnswerReversalResult> {
    return inTransaction(this.database, async (transaction) => {
      const candidate = await sql<{ id: string }>`
        SELECT candidate.id
        FROM candidates candidate
        JOIN accounts account ON account.id = candidate.account_id
        WHERE candidate.id = ${command.candidateId}
          AND candidate.account_id = ${command.accountId}
          AND candidate.status = 'ACTIVE'
          AND account.status = 'ACTIVE'
        LIMIT 1
      `.execute(transaction);
      if (!candidate.rows[0]) throw new NotFoundError("Active candidate was not found for this account.");

      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:${command.idempotencyKey}`})::bigint)`.execute(
        transaction
      );
      const replay = await sql<{
        reversal_set_id: string;
        request_fingerprint: string;
        already_reversed: boolean;
      }>`
        SELECT reversal_set_id, request_fingerprint, already_reversed
        FROM candidate_answer_reversal_receipts
        WHERE candidate_id = ${command.candidateId}
          AND idempotency_key = ${command.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      const replayRow = replay.rows[0];
      if (replayRow) {
        if (replayRow.request_fingerprint !== command.requestFingerprint) {
          throw new IdempotencyConflictError(
            "Candidate-answer reversal idempotency key was reused with different input."
          );
        }
        return loadCandidateAnswerReversal(transaction, {
          candidateId: command.candidateId,
          reversalSetId: replayRow.reversal_set_id,
          idempotentReplay: true,
          alreadyReversed: replayRow.already_reversed
        });
      }

      const targetResult = await sql<{
        id: string;
        status: "COMMITTED" | "REVERSED" | "PARTIALLY_REVERSED";
        source: string;
      }>`
        SELECT id, status, source
        FROM candidate_answer_change_sets
        WHERE id = ${command.targetChangeSetId}
          AND candidate_id = ${command.candidateId}
        LIMIT 1
        FOR UPDATE
      `.execute(transaction);
      const target = targetResult.rows[0];
      if (!target) throw new NotFoundError("Candidate-answer change set was not found.");
      if (["USER_UNDO", "USER_RESTORE"].includes(target.source)) {
        throw new ValidationError(
          "Reversal-generated change sets cannot be recursively undone; restore a historical version instead.",
          { reasonCode: "REVERSAL_CHANGE_SET_NOT_UNDOABLE" }
        );
      }
      if (target.status !== "COMMITTED") {
        const existing = await sql<{ id: string }>`
          SELECT id
          FROM candidate_answer_reversal_sets
          WHERE candidate_id = ${command.candidateId}
            AND operation_type = 'UNDO_CHANGE_SET'
            AND target_change_set_id = ${command.targetChangeSetId}
          LIMIT 1
        `.execute(transaction);
        const existingRow = existing.rows[0];
        if (!existingRow) throw new ConflictError("Reversed change set is missing its reversal receipt.");
        await sql`
          INSERT INTO candidate_answer_reversal_receipts (
            candidate_id, idempotency_key, request_fingerprint, reversal_set_id,
            already_reversed, created_at
          ) VALUES (
            ${command.candidateId}, ${command.idempotencyKey}, ${command.requestFingerprint},
            ${existingRow.id}, true, ${command.reversedAt}
          )
        `.execute(transaction);
        return loadCandidateAnswerReversal(transaction, {
          candidateId: command.candidateId,
          reversalSetId: existingRow.id,
          idempotentReplay: false,
          alreadyReversed: true
        });
      }

      const sourceItems = await sql<{
        item_id: string;
        canonical_id: number;
        canonical_key: string;
        scope_id: string;
        scope_fingerprint: string;
        learned_version_id: string;
        previous_version_id: string | null;
        entity_id: string | null;
      }>`
        SELECT
          item.id AS item_id,
          item.canonical_id,
          canonical.canonical_key,
          item.scope_id,
          answer_scope.scope_fingerprint,
          item.new_version_id AS learned_version_id,
          item.previous_version_id,
          learned.entity_id
        FROM candidate_answer_change_set_items item
        JOIN canonical_fields canonical ON canonical.id = item.canonical_id
        JOIN candidate_answer_versions learned
          ON learned.id = item.new_version_id
         AND learned.candidate_id = item.candidate_id
        JOIN candidate_answer_scopes answer_scope
          ON answer_scope.id = item.scope_id
         AND answer_scope.candidate_id = item.candidate_id
        WHERE item.change_set_id = ${command.targetChangeSetId}
          AND item.candidate_id = ${command.candidateId}
        ORDER BY canonical.canonical_key, learned.entity_id NULLS FIRST,
          answer_scope.scope_fingerprint, item.id
      `.execute(transaction);
      if (sourceItems.rows.length < 1 || sourceItems.rows.length > 50) {
        throw new ValidationError("Undo requires a source change set with between 1 and 50 items.");
      }
      const familyLocks = [...new Set(sourceItems.rows.map((item) =>
        [command.candidateId, item.canonical_key, item.entity_id ?? "NONE", "FAMILY"].join(":")
      ))].sort();
      for (const lock of familyLocks) {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${lock})::bigint)`.execute(transaction);
      }
      const logicalLocks = [...new Set(sourceItems.rows.map((item) =>
        [command.candidateId, item.canonical_key, item.entity_id ?? "NONE", item.scope_fingerprint].join(":")
      ))].sort();
      for (const lock of logicalLocks) {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${lock})::bigint)`.execute(transaction);
      }

      const plans: Array<{
        source: (typeof sourceItems.rows)[number];
        currentRowId: string | null;
        observedCurrentVersionId: string | null;
        previous: CandidateVersionStorageRow | null;
        outcome: "RESTORED" | "FORGOTTEN" | "SKIPPED_NEWER_VERSION";
      }> = [];
      for (const source of sourceItems.rows) {
        const currentResult = await sql<{ id: string; answer_version_id: string }>`
          SELECT id, answer_version_id
          FROM candidate_answers_current
          WHERE candidate_id = ${command.candidateId}
            AND canonical_id = ${source.canonical_id}
            AND entity_id IS NOT DISTINCT FROM ${source.entity_id}
            AND scope_id = ${source.scope_id}
          LIMIT 1
          FOR UPDATE
        `.execute(transaction);
        const current = currentResult.rows[0] ?? null;
        let previous: CandidateVersionStorageRow | null = null;
        if (source.previous_version_id) {
          const previousResult = await sql<CandidateVersionStorageRow>`
            SELECT
              id, candidate_id, canonical_id, entity_id, scope_id, policy_id,
              value_type, text_value, integer_value, decimal_value, boolean_value,
              date_value, date_precision, structured_value, value_fingerprint,
              fingerprint_key_version, trust_state, source, confirmed_at, created_at
            FROM candidate_answer_versions
            WHERE id = ${source.previous_version_id}
              AND candidate_id = ${command.candidateId}
            LIMIT 1
          `.execute(transaction);
          previous = previousResult.rows[0] ?? null;
          if (
            !previous ||
            previous.canonical_id !== source.canonical_id ||
            previous.entity_id !== source.entity_id ||
            previous.scope_id !== source.scope_id
          ) {
            throw new ConflictError("Undo source lineage does not match its logical candidate answer.");
          }
        }
        plans.push({
          source,
          currentRowId: current?.id ?? null,
          observedCurrentVersionId: current?.answer_version_id ?? null,
          previous,
          outcome:
            current?.answer_version_id !== source.learned_version_id
              ? "SKIPPED_NEWER_VERSION"
              : previous
                ? "RESTORED"
                : "FORGOTTEN"
        });
      }
      const restoredCount = plans.filter((plan) => plan.outcome === "RESTORED").length;
      const forgottenCount = plans.filter((plan) => plan.outcome === "FORGOTTEN").length;
      const skippedCount = plans.filter((plan) => plan.outcome === "SKIPPED_NEWER_VERSION").length;
      const mutationCount = restoredCount + forgottenCount;
      const reversalSetId = this.newId();
      const compensatingChangeSetId = mutationCount > 0 ? this.newId() : null;
      if (compensatingChangeSetId) {
        await sql`
          INSERT INTO candidate_answer_change_sets (
            id, candidate_id, source, application_id, checkpoint_id,
            idempotency_key, request_fingerprint, status, created_at
          ) VALUES (
            ${compensatingChangeSetId}, ${command.candidateId}, 'USER_UNDO', NULL, NULL,
            ${`reversal:${reversalSetId}`}, ${command.requestFingerprint}, 'COMMITTED', ${command.reversedAt}
          )
        `.execute(transaction);
      }
      await sql`
        INSERT INTO candidate_answer_reversal_sets (
          id, candidate_id, operation_type, target_change_set_id, target_version_id,
          compensating_change_set_id, item_count, restored_count, forgotten_count,
          skipped_count, created_at
        ) VALUES (
          ${reversalSetId}, ${command.candidateId}, 'UNDO_CHANGE_SET',
          ${command.targetChangeSetId}, NULL, ${compensatingChangeSetId}, ${plans.length},
          ${restoredCount}, ${forgottenCount}, ${skippedCount}, ${command.reversedAt}
        )
      `.execute(transaction);

      for (const plan of plans) {
        let compensatingVersionId: string | null = null;
        if (plan.outcome !== "SKIPPED_NEWER_VERSION") {
          if (!compensatingChangeSetId || !plan.currentRowId) {
            throw new Error("Reversible Undo item is missing its locked current projection.");
          }
          compensatingVersionId = this.newId();
          if (plan.outcome === "RESTORED") {
            if (!plan.previous) throw new Error("Undo restore plan is missing its previous version.");
            await sql`
              INSERT INTO candidate_answer_versions (
                id, candidate_id, canonical_id, entity_id, scope_id, policy_id,
                value_type, text_value, integer_value, decimal_value, boolean_value,
                date_value, date_precision, structured_value, value_fingerprint,
                fingerprint_key_version, source, trust_state, confirmed_at, created_at,
                supersedes_version_id, change_set_id, restores_version_id
              )
              SELECT
                ${compensatingVersionId}, candidate_id, canonical_id, entity_id, scope_id, policy_id,
                value_type, text_value, integer_value, decimal_value, boolean_value,
                date_value, date_precision, structured_value, value_fingerprint,
                fingerprint_key_version, source, trust_state, confirmed_at, ${command.reversedAt},
                ${plan.source.learned_version_id}, ${compensatingChangeSetId}, id
              FROM candidate_answer_versions
              WHERE id = ${plan.previous.id}
                AND candidate_id = ${command.candidateId}
            `.execute(transaction);
          } else {
            await sql`
              INSERT INTO candidate_answer_versions (
                id, candidate_id, canonical_id, entity_id, scope_id, policy_id,
                value_type, text_value, integer_value, decimal_value, boolean_value,
                date_value, date_precision, structured_value, value_fingerprint,
                fingerprint_key_version, source, trust_state, confirmed_at, created_at,
                supersedes_version_id, change_set_id, restores_version_id
              )
              SELECT
                ${compensatingVersionId}, candidate_id, canonical_id, entity_id, scope_id, policy_id,
                value_type, text_value, integer_value, decimal_value, boolean_value,
                date_value, date_precision, structured_value, value_fingerprint,
                fingerprint_key_version, source, 'REMOVED', NULL, ${command.reversedAt},
                id, ${compensatingChangeSetId}, NULL
              FROM candidate_answer_versions
              WHERE id = ${plan.source.learned_version_id}
                AND candidate_id = ${command.candidateId}
            `.execute(transaction);
          }
          const currentUpdate = await sql`
            UPDATE candidate_answers_current
            SET answer_version_id = ${compensatingVersionId}, updated_at = ${command.reversedAt}
            WHERE id = ${plan.currentRowId}
              AND answer_version_id = ${plan.source.learned_version_id}
          `.execute(transaction);
          if (currentUpdate.numAffectedRows !== 1n) {
            throw new ConflictError("Candidate answer changed during Undo commit.");
          }
          await sql`
            INSERT INTO candidate_answer_change_set_items (
              id, candidate_id, change_set_id, item_key, canonical_id, scope_id,
              previous_version_id, new_version_id, outcome, transition_kind, created_at
            ) VALUES (
              ${this.newId()}, ${command.candidateId}, ${compensatingChangeSetId},
              ${`undo:${plan.source.item_id}`}, ${plan.source.canonical_id}, ${plan.source.scope_id},
              ${plan.source.learned_version_id}, ${compensatingVersionId},
              ${plan.outcome === "RESTORED" ? "RESTORED" : "REMOVED"},
              ${plan.outcome === "RESTORED" ? "UNDO_RESTORE" : "UNDO_FORGET"},
              ${command.reversedAt}
            )
          `.execute(transaction);
        }
        await sql`
          INSERT INTO candidate_answer_reversal_items (
            id, candidate_id, reversal_set_id, source_change_set_item_id,
            canonical_id, scope_id, expected_version_id, observed_current_version_id,
            previous_version_id, compensating_version_id, outcome, reason_code, created_at
          ) VALUES (
            ${this.newId()}, ${command.candidateId}, ${reversalSetId}, ${plan.source.item_id},
            ${plan.source.canonical_id}, ${plan.source.scope_id}, ${plan.source.learned_version_id},
            ${plan.observedCurrentVersionId}, ${plan.previous?.id ?? null}, ${compensatingVersionId},
            ${plan.outcome},
            ${
              plan.outcome === "RESTORED"
                ? "PREVIOUS_SCOPED_ANSWER_RESTORED"
                : plan.outcome === "FORGOTTEN"
                  ? "NEW_SCOPED_ANSWER_REMOVED"
                  : "NEWER_CANDIDATE_ANSWER_KEPT"
            },
            ${command.reversedAt}
          )
        `.execute(transaction);
      }
      await sql`
        INSERT INTO candidate_answer_reversal_receipts (
          candidate_id, idempotency_key, request_fingerprint, reversal_set_id,
          already_reversed, created_at
        ) VALUES (
          ${command.candidateId}, ${command.idempotencyKey}, ${command.requestFingerprint},
          ${reversalSetId}, false, ${command.reversedAt}
        )
      `.execute(transaction);
      const sourceStatus = skippedCount === 0 ? "REVERSED" : "PARTIALLY_REVERSED";
      const statusUpdate = await sql`
        UPDATE candidate_answer_change_sets
        SET status = ${sourceStatus}
        WHERE id = ${command.targetChangeSetId}
          AND candidate_id = ${command.candidateId}
          AND status = 'COMMITTED'
      `.execute(transaction);
      if (statusUpdate.numAffectedRows !== 1n) {
        throw new ConflictError("Candidate-answer change set was reversed concurrently.");
      }
      await sql`
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload_reference, available_at, created_at
        ) VALUES (
          ${this.newId()}, 'CANDIDATE', ${command.candidateId}, 'candidate.answers.reversed',
          CAST(${JSON.stringify({
            reversalSetId,
            operationType: "UNDO_CHANGE_SET",
            targetChangeSetId: command.targetChangeSetId,
            compensatingChangeSetId,
            itemCount: plans.length,
            restoredCount,
            forgottenCount,
            skippedCount
          })} AS jsonb),
          ${command.reversedAt}, ${command.reversedAt}
        )
      `.execute(transaction);
      return loadCandidateAnswerReversal(transaction, {
        candidateId: command.candidateId,
        reversalSetId,
        idempotentReplay: false,
        alreadyReversed: false
      });
    });
  }

  async restoreVersion(
    command: RestoreCandidateAnswerVersionCommand
  ): Promise<CandidateAnswerReversalResult> {
    return inTransaction(this.database, async (transaction) => {
      const candidate = await sql<{ id: string }>`
        SELECT candidate.id
        FROM candidates candidate
        JOIN accounts account ON account.id = candidate.account_id
        WHERE candidate.id = ${command.candidateId}
          AND candidate.account_id = ${command.accountId}
          AND candidate.status = 'ACTIVE'
          AND account.status = 'ACTIVE'
        LIMIT 1
      `.execute(transaction);
      if (!candidate.rows[0]) throw new NotFoundError("Active candidate was not found for this account.");
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:${command.idempotencyKey}`})::bigint)`.execute(
        transaction
      );
      const replay = await sql<{
        reversal_set_id: string;
        request_fingerprint: string;
        already_reversed: boolean;
      }>`
        SELECT reversal_set_id, request_fingerprint, already_reversed
        FROM candidate_answer_reversal_receipts
        WHERE candidate_id = ${command.candidateId}
          AND idempotency_key = ${command.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      const replayRow = replay.rows[0];
      if (replayRow) {
        if (replayRow.request_fingerprint !== command.requestFingerprint) {
          throw new IdempotencyConflictError(
            "Candidate-answer reversal idempotency key was reused with different input."
          );
        }
        return loadCandidateAnswerReversal(transaction, {
          candidateId: command.candidateId,
          reversalSetId: replayRow.reversal_set_id,
          idempotentReplay: true,
          alreadyReversed: replayRow.already_reversed
        });
      }
      const targetResult = await sql<CandidateVersionStorageRow & {
        canonical_key: string;
        scope_type: CandidateAnswerScope["scopeType"];
        scope_fingerprint: string;
        company_id: string | null;
        job_id: string | null;
        application_id: string | null;
        country_code: string | null;
        role_family: string | null;
        canonical_value_type: string;
        canonical_entity_type: string | null;
      }>`
        SELECT
          version.id, version.candidate_id, version.canonical_id, version.entity_id,
          version.scope_id, version.policy_id, version.value_type, version.text_value,
          version.integer_value, version.decimal_value, version.boolean_value,
          version.date_value, version.date_precision, version.structured_value,
          version.value_fingerprint, version.fingerprint_key_version, version.trust_state,
          version.source, version.confirmed_at, version.created_at,
          canonical.canonical_key, canonical.value_type AS canonical_value_type,
          canonical.entity_type AS canonical_entity_type,
          answer_scope.scope_type, answer_scope.scope_fingerprint, answer_scope.company_id,
          answer_scope.job_id, answer_scope.application_id, answer_scope.country_code,
          answer_scope.role_family
        FROM candidate_answer_versions version
        JOIN canonical_fields canonical ON canonical.id = version.canonical_id
        JOIN candidate_answer_scopes answer_scope
          ON answer_scope.id = version.scope_id
         AND answer_scope.candidate_id = version.candidate_id
        WHERE version.id = ${command.targetVersionId}
          AND version.candidate_id = ${command.candidateId}
        LIMIT 1
        FOR SHARE OF version
      `.execute(transaction);
      const target = targetResult.rows[0];
      if (!target) throw new NotFoundError("Candidate-answer version was not found.");
      if (target.trust_state === "REMOVED") {
        throw new ValidationError("Removed tombstones cannot be explicitly restored.", {
          reasonCode: "REMOVED_VERSION_NOT_RESTORABLE"
        });
      }
      const policy = candidateAnswerPolicy(target.canonical_key);
      if (
        !["AUTO_VERSION", "REVIEW_TO_SAVE"].includes(policy.learningMode) ||
        !policy.permanentCommitPoints.includes("EXPLICIT_SAVE") ||
        !policy.allowedScopeTypes.includes(target.scope_type) ||
        target.canonical_value_type !== target.value_type ||
        policy.valueType !== target.value_type ||
        policy.entityType !== target.canonical_entity_type
      ) {
        throw new ConflictError("Historical candidate truth is incompatible with the active policy.", {
          canonicalKey: target.canonical_key,
          reasonCode: "RESTORE_POLICY_DRIFT"
        });
      }
      const hydratedScope = hydrateCandidateAnswerScope({
        scopeType: target.scope_type,
        scopeFingerprint: target.scope_fingerprint,
        context: {
          ...(target.company_id ? { companyId: target.company_id } : {}),
          ...(target.job_id ? { jobId: target.job_id } : {}),
          ...(target.application_id ? { applicationId: target.application_id } : {}),
          ...(target.country_code ? { countryCode: target.country_code } : {}),
          ...(target.role_family ? { roleFamily: target.role_family } : {})
        }
      });
      if (policy.entityType) {
        if (!target.entity_id) throw new ConflictError("Historical answer is missing its stable entity.");
        const entity = await sql<{ entity_type: string }>`
          SELECT entity_type
          FROM candidate_entities
          WHERE id = ${target.entity_id}
            AND candidate_id = ${command.candidateId}
            AND status = 'ACTIVE'
          LIMIT 1
        `.execute(transaction);
        if (entity.rows[0]?.entity_type !== policy.entityType) {
          throw new ConflictError("Historical answer entity is no longer active or compatible.");
        }
      } else if (target.entity_id) {
        throw new ConflictError("Historical answer has entity identity forbidden by the active policy.");
      }

      await sql`SELECT pg_advisory_xact_lock(hashtext(${[
        command.candidateId, target.canonical_key, target.entity_id ?? "NONE", "FAMILY"
      ].join(":")})::bigint)`.execute(transaction);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${[
        command.candidateId, target.canonical_key, target.entity_id ?? "NONE",
        hydratedScope.scopeFingerprint
      ].join(":")})::bigint)`.execute(transaction);
      const currentResult = await sql<{ id: string; answer_version_id: string }>`
        SELECT id, answer_version_id
        FROM candidate_answers_current
        WHERE candidate_id = ${command.candidateId}
          AND canonical_id = ${target.canonical_id}
          AND entity_id IS NOT DISTINCT FROM ${target.entity_id}
          AND scope_id = ${target.scope_id}
        LIMIT 1
        FOR UPDATE
      `.execute(transaction);
      const current = currentResult.rows[0] ?? null;
      if ((current?.answer_version_id ?? null) !== command.expectedCurrentVersionId) {
        throw new ConflictError("Candidate answer changed before historical Restore committed.", {
          expectedCurrentVersionId: command.expectedCurrentVersionId,
          actualCurrentVersionId: current?.answer_version_id ?? null
        });
      }
      if (current?.answer_version_id === command.targetVersionId) {
        throw new ConflictError("That candidate-answer version is already current.", {
          reasonCode: "ANSWER_VERSION_ALREADY_CURRENT"
        });
      }
      const activePolicy = await sql<CandidatePolicyRow>`
        SELECT
          canonical.id AS canonical_id, canonical.value_type, canonical.entity_type,
          policy.id AS policy_id, policy.policy_version
        FROM canonical_fields canonical
        JOIN canonical_answer_policies policy
          ON policy.canonical_id = canonical.id AND policy.active
        WHERE canonical.id = ${target.canonical_id}
          AND canonical.status = 'ACTIVE'
        LIMIT 1
        FOR SHARE
      `.execute(transaction);
      const activePolicyRow = activePolicy.rows[0];
      if (
        !activePolicyRow ||
        activePolicyRow.policy_version !== policy.policyVersion ||
        activePolicyRow.value_type !== target.value_type
      ) {
        throw new ConflictError("Candidate answer policy changed before Restore committed.");
      }

      const reversalSetId = this.newId();
      const compensatingChangeSetId = this.newId();
      const restoredVersionId = this.newId();
      await sql`
        INSERT INTO candidate_answer_change_sets (
          id, candidate_id, source, application_id, checkpoint_id,
          idempotency_key, request_fingerprint, status, created_at
        ) VALUES (
          ${compensatingChangeSetId}, ${command.candidateId}, 'USER_RESTORE', NULL, NULL,
          ${`reversal:${reversalSetId}`}, ${command.requestFingerprint}, 'COMMITTED', ${command.restoredAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_answer_reversal_sets (
          id, candidate_id, operation_type, target_change_set_id, target_version_id,
          compensating_change_set_id, item_count, restored_count, forgotten_count,
          skipped_count, created_at
        ) VALUES (
          ${reversalSetId}, ${command.candidateId}, 'RESTORE_VERSION', NULL,
          ${command.targetVersionId}, ${compensatingChangeSetId}, 1, 1, 0, 0, ${command.restoredAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_answer_versions (
          id, candidate_id, canonical_id, entity_id, scope_id, policy_id,
          value_type, text_value, integer_value, decimal_value, boolean_value,
          date_value, date_precision, structured_value, value_fingerprint,
          fingerprint_key_version, source, trust_state, confirmed_at, created_at,
          supersedes_version_id, change_set_id, restores_version_id
        )
        SELECT
          ${restoredVersionId}, candidate_id, canonical_id, entity_id, scope_id,
          ${activePolicyRow.policy_id}, value_type, text_value, integer_value,
          decimal_value, boolean_value, date_value, date_precision, structured_value,
          value_fingerprint, fingerprint_key_version, 'USER_RESTORE', 'TRUSTED',
          ${command.restoredAt}, ${command.restoredAt}, ${current?.answer_version_id ?? null},
          ${compensatingChangeSetId}, id
        FROM candidate_answer_versions
        WHERE id = ${command.targetVersionId}
          AND candidate_id = ${command.candidateId}
      `.execute(transaction);
      if (current) {
        const update = await sql`
          UPDATE candidate_answers_current
          SET answer_version_id = ${restoredVersionId}, updated_at = ${command.restoredAt}
          WHERE id = ${current.id}
            AND answer_version_id = ${current.answer_version_id}
        `.execute(transaction);
        if (update.numAffectedRows !== 1n) {
          throw new ConflictError("Candidate answer changed during historical Restore.");
        }
      } else {
        await sql`
          INSERT INTO candidate_answers_current (
            id, candidate_id, canonical_id, entity_id, scope_id, answer_version_id, updated_at
          ) VALUES (
            ${this.newId()}, ${command.candidateId}, ${target.canonical_id}, ${target.entity_id},
            ${target.scope_id}, ${restoredVersionId}, ${command.restoredAt}
          )
        `.execute(transaction);
      }
      const changeSetItemId = this.newId();
      await sql`
        INSERT INTO candidate_answer_change_set_items (
          id, candidate_id, change_set_id, item_key, canonical_id, scope_id,
          previous_version_id, new_version_id, outcome, transition_kind, created_at
        ) VALUES (
          ${changeSetItemId}, ${command.candidateId}, ${compensatingChangeSetId},
          ${`restore:${command.targetVersionId}`}, ${target.canonical_id}, ${target.scope_id},
          ${current?.answer_version_id ?? null}, ${restoredVersionId}, 'RESTORED', 'RESTORE',
          ${command.restoredAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_answer_reversal_items (
          id, candidate_id, reversal_set_id, source_change_set_item_id,
          canonical_id, scope_id, expected_version_id, observed_current_version_id,
          previous_version_id, compensating_version_id, outcome, reason_code, created_at
        ) VALUES (
          ${this.newId()}, ${command.candidateId}, ${reversalSetId}, NULL,
          ${target.canonical_id}, ${target.scope_id}, ${command.expectedCurrentVersionId},
          ${current?.answer_version_id ?? null}, ${command.targetVersionId},
          ${restoredVersionId}, 'RESTORED', 'HISTORICAL_ANSWER_EXPLICITLY_RESTORED',
          ${command.restoredAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_answer_reversal_receipts (
          candidate_id, idempotency_key, request_fingerprint, reversal_set_id,
          already_reversed, created_at
        ) VALUES (
          ${command.candidateId}, ${command.idempotencyKey}, ${command.requestFingerprint},
          ${reversalSetId}, false, ${command.restoredAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload_reference, available_at, created_at
        ) VALUES (
          ${this.newId()}, 'CANDIDATE', ${command.candidateId}, 'candidate.answer.restored',
          CAST(${JSON.stringify({
            reversalSetId,
            operationType: "RESTORE_VERSION",
            targetVersionId: command.targetVersionId,
            compensatingChangeSetId,
            restoredVersionId
          })} AS jsonb),
          ${command.restoredAt}, ${command.restoredAt}
        )
      `.execute(transaction);
      return loadCandidateAnswerReversal(transaction, {
        candidateId: command.candidateId,
        reversalSetId,
        idempotentReplay: false,
        alreadyReversed: false
      });
    });
  }

  async listReversals(
    input: ListCandidateAnswerReversalsInput
  ): Promise<readonly CandidateAnswerReversalResult[]> {
    const candidate = await sql<{ id: string }>`
      SELECT candidate.id
      FROM candidates candidate
      JOIN accounts account ON account.id = candidate.account_id
      WHERE candidate.id = ${input.candidateId}
        AND candidate.account_id = ${input.accountId}
        AND candidate.status = 'ACTIVE'
        AND account.status = 'ACTIVE'
      LIMIT 1
    `.execute(this.database);
    if (!candidate.rows[0]) {
      throw new NotFoundError("Active candidate was not found for this account.");
    }

    const reversals = await sql<{ id: string }>`
      SELECT reversal.id
      FROM candidate_answer_reversal_sets reversal
      WHERE reversal.candidate_id = ${input.candidateId}
        AND (
          ${input.before?.createdAt ?? null}::timestamptz IS NULL
          OR (reversal.created_at, reversal.id) < (
            ${input.before?.createdAt ?? null}::timestamptz,
            ${input.before?.reversalSetId ?? null}::uuid
          )
        )
      ORDER BY reversal.created_at DESC, reversal.id DESC
      LIMIT ${input.limit}
    `.execute(this.database);

    return Promise.all(
      reversals.rows.map((reversal) =>
        loadCandidateAnswerReversal(this.database, {
          candidateId: input.candidateId,
          reversalSetId: reversal.id,
          idempotentReplay: false,
          alreadyReversed: false
        })
      )
    );
  }

  async commitAnswerVersion(
    command: PersistCandidateAnswerCommand
  ): Promise<CandidateAnswerMutationResult> {
    return inTransaction(this.database, async (transaction) => {
      const candidate = await sql<{ id: string }>`
        SELECT candidate.id
        FROM candidates candidate
        JOIN accounts account ON account.id = candidate.account_id
        WHERE candidate.id = ${command.candidateId}
          AND candidate.account_id = ${command.accountId}
          AND candidate.status = 'ACTIVE'
          AND account.status = 'ACTIVE'
        LIMIT 1
      `.execute(transaction);
      if (!candidate.rows[0]) throw new NotFoundError("Active candidate was not found for this account.");

      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${command.candidateId}:${command.idempotencyKey}`})::bigint)`.execute(
        transaction
      );
      await sql`SELECT pg_advisory_xact_lock(hashtext(${[
        command.candidateId,
        command.canonicalKey,
        command.entityId ?? "NONE",
        "FAMILY"
      ].join(":")})::bigint)`.execute(transaction);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${[
        command.candidateId,
        command.canonicalKey,
        command.entityId ?? "NONE",
        command.scope.scopeFingerprint
      ].join(":")})::bigint)`.execute(transaction);

      if (command.commitPoint === "VERIFIED_SUBMISSION" && (!command.applicationId || !command.checkpointId)) {
        throw new ValidationError("Verified submission learning requires an application checkpoint.");
      }
      if (command.checkpointId) {
        const checkpoint = await sql<{ checkpoint_type: string }>`
          SELECT checkpoint.checkpoint_type
          FROM application_checkpoints checkpoint
          JOIN applications application
            ON application.id = checkpoint.application_id
          JOIN application_runs run
            ON run.id = checkpoint.run_id
           AND run.application_id = checkpoint.application_id
          LEFT JOIN jobs job
            ON job.id = application.job_id
          WHERE checkpoint.id = ${command.checkpointId}
            AND checkpoint.application_id = ${command.applicationId}
            AND checkpoint.status = 'VERIFIED'
            AND checkpoint.checkpoint_type = ${
              command.commitPoint === "VERIFIED_SUBMISSION" ? "SUBMISSION" : "EXPLICIT_SAVE"
            }
            AND application.candidate_id = ${command.candidateId}
            AND application.account_id = ${command.accountId}
            AND (${command.scope.applicationId ?? null}::uuid IS NULL OR ${command.scope.applicationId ?? null}::uuid = application.id)
            AND (${command.scope.jobId ?? null}::uuid IS NULL OR ${command.scope.jobId ?? null}::uuid = application.job_id)
            AND (${command.scope.companyId ?? null}::uuid IS NULL OR ${command.scope.companyId ?? null}::uuid = job.company_id)
            AND (${command.scope.countryCode ?? null}::text IS NULL OR ${command.scope.countryCode ?? null}::text = job.country_code)
            AND (${command.scope.roleFamily ?? null}::text IS NULL OR ${command.scope.roleFamily ?? null}::text = job.role_family)
            AND (
              ${command.commitPoint} <> 'VERIFIED_SUBMISSION'
              OR (
                application.status = 'SUBMITTED'
                AND application.submitted_at IS NOT NULL
                AND run.status = 'COMPLETED'
                AND run.ended_at IS NOT NULL
              )
            )
          LIMIT 1
        `.execute(transaction);
        if (!checkpoint.rows[0]) {
          throw new ValidationError("Candidate answer checkpoint authority is invalid or unverified.", {
            commitPoint: command.commitPoint
          });
        }
      }

      const policyResult = await sql<CandidatePolicyRow>`
        SELECT
          canonical.id AS canonical_id,
          canonical.value_type,
          canonical.entity_type,
          policy.id AS policy_id,
          policy.policy_version
        FROM canonical_fields canonical
        JOIN canonical_answer_policies policy
          ON policy.canonical_id = canonical.id
         AND policy.active
        WHERE canonical.canonical_key = ${command.canonicalKey}
          AND canonical.status = 'ACTIVE'
        LIMIT 1
        FOR SHARE
      `.execute(transaction);
      const policy = policyResult.rows[0];
      if (!policy) throw new NotFoundError("Active canonical answer policy was not found.");
      if (
        policy.policy_version !== command.policyVersion ||
        policy.value_type !== command.normalizedValue.kind
      ) {
        throw new ConflictError("Candidate answer policy changed before the mutation committed.", {
          canonicalKey: command.canonicalKey,
          expectedPolicyVersion: command.policyVersion,
          activePolicyVersion: policy.policy_version
        });
      }

      if (policy.entity_type) {
        if (!command.entityId) {
          throw new ValidationError("The canonical requires a stable candidate entity.");
        }
        const entity = await sql<{ entity_type: string }>`
          SELECT entity_type
          FROM candidate_entities
          WHERE id = ${command.entityId}
            AND candidate_id = ${command.candidateId}
            AND status = 'ACTIVE'
          LIMIT 1
        `.execute(transaction);
        if (entity.rows[0]?.entity_type !== policy.entity_type) {
          throw new ValidationError("Candidate entity does not match the canonical policy.");
        }
      } else if (command.entityId) {
        throw new ValidationError("The canonical does not accept a candidate entity.");
      }

      const scopeId = this.newId();
      const scopeResult = await sql<ScopeRow>`
        INSERT INTO candidate_answer_scopes (
          id,
          candidate_id,
          scope_type,
          scope_fingerprint,
          company_id,
          job_id,
          application_id,
          country_code,
          role_family
        ) VALUES (
          ${scopeId},
          ${command.candidateId},
          ${command.scope.scopeType},
          ${command.scope.scopeFingerprint},
          ${command.scope.companyId ?? null},
          ${command.scope.jobId ?? null},
          ${command.scope.applicationId ?? null},
          ${command.scope.countryCode ?? null},
          ${command.scope.roleFamily ?? null}
        )
        ON CONFLICT (candidate_id, scope_type, scope_fingerprint)
        DO UPDATE SET scope_fingerprint = EXCLUDED.scope_fingerprint
        RETURNING
          id,
          scope_type,
          scope_fingerprint,
          company_id,
          job_id,
          application_id,
          country_code,
          role_family
      `.execute(transaction);
      const persistedScope = scopeResult.rows[0];
      if (!persistedScope) throw new Error("Candidate answer scope was not returned after upsert.");
      assertPersistedScopeMatches(persistedScope, command.scope);

      const replay = await sql<{
        change_set_id: string;
        request_fingerprint: string;
        scope_id: string | null;
        answer_version_id: string | null;
        trust_state: "REVIEW" | "TRUSTED" | null;
        transition_kind: CandidateAnswerTransitionKind | null;
      }>`
        SELECT
          change_set.id AS change_set_id,
          change_set.request_fingerprint,
          item.scope_id,
          item.new_version_id AS answer_version_id,
          version.trust_state
          , item.transition_kind
        FROM candidate_answer_change_sets change_set
        LEFT JOIN candidate_answer_change_set_items item
          ON item.change_set_id = change_set.id
        LEFT JOIN candidate_answer_versions version
          ON version.id = item.new_version_id
        WHERE change_set.candidate_id = ${command.candidateId}
          AND change_set.idempotency_key = ${command.idempotencyKey}
        LIMIT 1
      `.execute(transaction);
      const replayRow = replay.rows[0];
      if (replayRow) {
        if (replayRow.request_fingerprint !== command.requestFingerprint) {
          throw new IdempotencyConflictError("Idempotency key was already used for a different candidate answer mutation.");
        }
        if (
          !replayRow.scope_id ||
          !replayRow.answer_version_id ||
          !replayRow.trust_state ||
          !replayRow.transition_kind
        ) {
          throw new Error("Committed candidate answer change set is missing its result reference.");
        }
        return {
          candidateId: command.candidateId,
          canonicalKey: command.canonicalKey,
          scopeId: replayRow.scope_id,
          changeSetId: replayRow.change_set_id,
          answerVersionId: replayRow.answer_version_id,
          trustState: replayRow.trust_state,
          transitionKind: replayRow.transition_kind,
          idempotentReplay: true
        };
      }

      const current = await sql<{ id: string; answer_version_id: string }>`
        SELECT id, answer_version_id
        FROM candidate_answers_current
        WHERE candidate_id = ${command.candidateId}
          AND canonical_id = ${policy.canonical_id}
          AND entity_id IS NOT DISTINCT FROM ${command.entityId}
          AND scope_id = ${persistedScope.id}
        LIMIT 1
        FOR UPDATE
      `.execute(transaction);
      const currentRow = current.rows[0] ?? null;
      if ((currentRow?.answer_version_id ?? null) !== command.expectedCurrentVersionId) {
        throw new ConflictError("Candidate answer changed after the caller read it.", {
          canonicalKey: command.canonicalKey,
          expectedCurrentVersionId: command.expectedCurrentVersionId,
          actualCurrentVersionId: currentRow?.answer_version_id ?? null
        });
      }

      const changeSetId = this.newId();
      const answerVersionId = this.newId();
      const changeSetItemId = this.newId();
      const encoded = encodeCandidateValue(command.normalizedValue);
      await sql`
        INSERT INTO candidate_answer_change_sets (
          id,
          candidate_id,
          source,
          application_id,
          checkpoint_id,
          idempotency_key,
          request_fingerprint,
          status,
          created_at
        ) VALUES (
          ${changeSetId},
          ${command.candidateId},
          ${command.source},
          ${command.applicationId},
          ${command.checkpointId},
          ${command.idempotencyKey},
          ${command.requestFingerprint},
          'COMMITTED',
          ${command.confirmedAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_answer_versions (
          id,
          candidate_id,
          canonical_id,
          entity_id,
          scope_id,
          policy_id,
          value_type,
          text_value,
          integer_value,
          decimal_value,
          boolean_value,
          date_value,
          date_precision,
          structured_value,
          value_fingerprint,
          fingerprint_key_version,
          source,
          trust_state,
          confirmed_at,
          created_at,
          supersedes_version_id,
          change_set_id
        ) VALUES (
          ${answerVersionId},
          ${command.candidateId},
          ${policy.canonical_id},
          ${command.entityId},
          ${persistedScope.id},
          ${policy.policy_id},
          ${command.normalizedValue.kind},
          ${encoded.textValue},
          ${encoded.integerValue},
          CAST(${encoded.decimalValue} AS numeric),
          ${encoded.booleanValue},
          CAST(${encoded.dateValue} AS date),
          ${encoded.datePrecision},
          CAST(${encoded.structuredValueJson} AS jsonb),
          ${command.valueFingerprint},
          ${command.fingerprintKeyVersion},
          ${command.source},
          ${command.trustState},
          ${command.confirmedAt},
          ${command.confirmedAt},
          ${currentRow?.answer_version_id ?? null},
          ${changeSetId}
        )
      `.execute(transaction);

      if (currentRow) {
        await sql`
          UPDATE candidate_answers_current
          SET answer_version_id = ${answerVersionId}, updated_at = ${command.confirmedAt}
          WHERE id = ${currentRow.id}
        `.execute(transaction);
      } else {
        await sql`
          INSERT INTO candidate_answers_current (
            id,
            candidate_id,
            canonical_id,
            entity_id,
            scope_id,
            answer_version_id,
            updated_at
          ) VALUES (
            ${this.newId()},
            ${command.candidateId},
            ${policy.canonical_id},
            ${command.entityId},
            ${persistedScope.id},
            ${answerVersionId},
            ${command.confirmedAt}
          )
        `.execute(transaction);
      }

      await sql`
        INSERT INTO candidate_answer_change_set_items (
          id,
          candidate_id,
          change_set_id,
          canonical_id,
          scope_id,
          previous_version_id,
          new_version_id,
          outcome,
          transition_kind,
          created_at
        ) VALUES (
          ${changeSetItemId},
          ${command.candidateId},
          ${changeSetId},
          ${policy.canonical_id},
          ${persistedScope.id},
          ${currentRow?.answer_version_id ?? null},
          ${answerVersionId},
          ${currentRow ? "REPLACED" : "CREATED"},
          ${command.transitionKind},
          ${command.confirmedAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO outbox_events (
          id,
          aggregate_type,
          aggregate_id,
          event_type,
          payload_reference,
          available_at,
          created_at
        ) VALUES (
          ${this.newId()},
          'CANDIDATE',
          ${command.candidateId},
          'candidate.answer.updated',
          CAST(${JSON.stringify({
            changeSetId,
            answerVersionId,
            canonicalKey: command.canonicalKey,
            transitionKind: command.transitionKind
          })} AS jsonb),
          ${command.confirmedAt},
          ${command.confirmedAt}
        )
      `.execute(transaction);

      return {
        candidateId: command.candidateId,
        canonicalKey: command.canonicalKey,
        scopeId: persistedScope.id,
        changeSetId,
        answerVersionId,
        trustState: command.trustState,
        transitionKind: command.transitionKind,
        idempotentReplay: false
      };
    });
  }
}

function assertPersistedScopeMatches(
  persisted: ScopeRow,
  expected: PersistCandidateAnswerCommand["scope"]
): void {
  const mismatch =
    persisted.scope_type !== expected.scopeType ||
    persisted.scope_fingerprint !== expected.scopeFingerprint ||
    persisted.company_id !== (expected.companyId ?? null) ||
    persisted.job_id !== (expected.jobId ?? null) ||
    persisted.application_id !== (expected.applicationId ?? null) ||
    persisted.country_code !== (expected.countryCode ?? null) ||
    persisted.role_family !== (expected.roleFamily ?? null);
  if (mismatch) throw new ConflictError("Candidate answer scope fingerprint collision detected.");
}

interface EncodedCandidateValue {
  textValue: string | null;
  integerValue: number | null;
  decimalValue: string | null;
  booleanValue: boolean | null;
  dateValue: string | null;
  datePrecision: "DAY" | "MONTH" | "YEAR" | null;
  structuredValueJson: string | null;
}

function encodeCandidateValue(value: PersistableNormalizedValue): EncodedCandidateValue {
  const encoded: EncodedCandidateValue = {
    textValue: null,
    integerValue: null,
    decimalValue: null,
    booleanValue: null,
    dateValue: null,
    datePrecision: null,
    structuredValueJson: null
  };
  switch (value.kind) {
    case "STRING":
    case "URL":
    case "RICH_TEXT":
      encoded.textValue = value.value;
      break;
    case "ENUM":
      encoded.textValue = JSON.stringify(value.value);
      break;
    case "BOOLEAN":
      encoded.booleanValue = value.value;
      break;
    case "INTEGER":
      encoded.integerValue = value.value;
      break;
    case "DECIMAL":
      encoded.decimalValue = value.valueExact;
      break;
    case "DATE":
      encoded.dateValue = value.value.isoDate;
      encoded.datePrecision = value.value.precision;
      break;
    default:
      encoded.structuredValueJson = JSON.stringify(value);
  }
  return encoded;
}

function structuredValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  throw new Error("Database returned an invalid structured candidate value.");
}

function decodeCandidateValue(row: CandidateAnswerValueRow): PersistableNormalizedValue {
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
    case "DATE": {
      const isoDate =
        row.date_value instanceof Date
          ? row.date_value.toISOString().slice(0, 10)
          : String(row.date_value).slice(0, 10);
      value = {
        ...common,
        kind: "DATE",
        value: { isoDate, precision: row.date_precision }
      };
      break;
    }
    default:
      value = structuredValue(row.structured_value);
  }
  return PersistableNormalizedValueSchema.parse(value);
}

function integerOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Database returned an unsafe entitlement counter.");
  }
  return parsed;
}

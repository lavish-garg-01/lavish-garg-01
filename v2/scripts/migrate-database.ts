import {
  createPostgresMigrationClient,
  migrateCandidateAnswerReversals,
  migrateCandidateOnboardingBootstrap,
  migrateCandidateOnboardingConfirmation,
  migrateCandidateProfileCompletion,
  migrateCandidateResumeIntelligence,
  migrateCandidateReviewOutcomeProofs,
  migrateCandidateScopePolicyVectors,
  migrateCandidateTruthImportApply,
  migrateCandidateTruthImportPreviews,
  migrateCandidateTruthMutationGuards,
  migrateCandidateTruthOntology,
  migrateCoreEntitlements,
  migrateInitialSchema,
  migrateJobIntelligence,
  migrateVerifiedLearningLoop,
  migrateRepeatableEntityIntelligence,
  migrateDeclarationConsentPolicy,
  migrateAiOrchestration,
  migrateStrategyIntelligence,
  migrateStrategyOperations,
  migrateDocumentIntelligence,
  migrateGlobalAnswerDefaults,
  migrateCanonicalReviewQueue,
  migrateLearningRecovery,
  migrateLearningNoteConfirmation,
  migrateOperatorReview,
  migrateOperatorWorkflow,
  migrateLearningInboxLifecycle,
  migrateSupportReview,
  migrateCaseMerge,
  migrateReviewedExports,
  migrateScopedNoteRecovery,
  migrateLearningFingerprintVersions
} from "@job-hunter-v2/database";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const client = createPostgresMigrationClient({ connectionString: databaseUrl });
const migrations = [
  migrateInitialSchema,
  migrateCoreEntitlements,
  migrateCandidateTruthOntology,
  migrateCandidateTruthMutationGuards,
  migrateCandidateScopePolicyVectors,
  migrateCandidateReviewOutcomeProofs,
  migrateCandidateAnswerReversals,
  migrateCandidateTruthImportPreviews,
  migrateCandidateTruthImportApply,
  migrateCandidateOnboardingBootstrap,
  migrateCandidateResumeIntelligence,
  migrateCandidateOnboardingConfirmation,
  migrateCandidateProfileCompletion,
  migrateJobIntelligence,
  migrateVerifiedLearningLoop,
  migrateRepeatableEntityIntelligence,
  migrateDeclarationConsentPolicy,
  migrateAiOrchestration,
  migrateStrategyIntelligence,
  migrateStrategyOperations,
  migrateDocumentIntelligence,
  migrateGlobalAnswerDefaults,
  migrateCanonicalReviewQueue,
  migrateLearningRecovery,
  migrateLearningNoteConfirmation,
  migrateOperatorReview,
  migrateOperatorWorkflow,
  migrateLearningInboxLifecycle,
  migrateSupportReview,
  migrateCaseMerge,
  migrateReviewedExports,
  migrateScopedNoteRecovery,
  migrateLearningFingerprintVersions
] as const;

try {
  for (const migrate of migrations) {
    const result = await migrate(client);
    console.log(`${result.applied ? "applied" : "current"} ${result.version}`);
  }
} finally {
  await client.close();
}

import { jobLifecycleMigration } from "./0001_job_lifecycle.js";
import { candidateSearchProfileMigration } from "./0002_candidate_search_profile.js";
import { candidateJobFeedMigration } from "./0003_candidate_job_feed.js";
import { jobUserStateLifecycleMigration } from "./0004_job_user_state_lifecycle.js";
import { fieldSemanticLearningMigration } from "./0005_field_semantic_learning.js";
import { canonicalSemanticCacheMigration } from "./0006_canonical_semantic_cache.js";
import { fieldRevisionTimelineMigration } from "./0007_field_revision_timeline.js";
import { checkpointReclassificationMigration } from "./0008_checkpoint_reclassification.js";
import { extensionLaunchProtocolMigration } from "./0009_extension_launch_protocol.js";
import { extensionDurableDeliveryMigration } from "./0010_extension_durable_delivery.js";
import { extensionFieldCacheStatusMigration } from "./0011_extension_field_cache_status.js";
import { adaptiveEvidenceShadowMigration } from "./0012_adaptive_evidence_shadow.js";
import { candidateAnswerIntelligenceMigration } from "./0013_candidate_answer_intelligence.js";
import { employerEntityExactAliasesMigration } from "./0014_employer_entity_exact_aliases.js";
import { candidateAnswerLegacyMigration } from "./0015_candidate_answer_legacy_migration.js";
import { candidateAnswerResolutionParityMigration } from "./0016_candidate_answer_resolution_parity.js";
import { candidateAnswerChangeSetsMigration } from "./0017_candidate_answer_change_sets.js";
import { candidateAnswerChangeSetFlagMigration } from "./0018_candidate_answer_change_set_flag.js";
import { candidateAnswerScopedLearningUndoMigration } from "./0019_candidate_answer_scoped_learning_undo.js";
import { candidateAnswerRuntimeProposalsMigration } from "./0020_candidate_answer_runtime_proposals.js";

/**
 * Append new migrations here in lexical order. Never edit or remove an
 * applied migration; migrationRunner checksum-locks the history.
 */
export const DATABASE_MIGRATIONS = Object.freeze([
    jobLifecycleMigration,
    candidateSearchProfileMigration,
    candidateJobFeedMigration,
    jobUserStateLifecycleMigration,
    fieldSemanticLearningMigration,
    canonicalSemanticCacheMigration,
    fieldRevisionTimelineMigration,
    checkpointReclassificationMigration,
    extensionLaunchProtocolMigration,
    extensionDurableDeliveryMigration,
    extensionFieldCacheStatusMigration,
    adaptiveEvidenceShadowMigration,
    candidateAnswerIntelligenceMigration,
    employerEntityExactAliasesMigration,
    candidateAnswerLegacyMigration,
    candidateAnswerResolutionParityMigration,
    candidateAnswerChangeSetsMigration,
    candidateAnswerChangeSetFlagMigration,
    candidateAnswerScopedLearningUndoMigration,
    candidateAnswerRuntimeProposalsMigration
]);

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "docs/ARCHITECTURE_INDEX.md");
const canvasPath = path.join(root, "canvases/job-hunter-code-mind-map.canvas.tsx");
const requiredOwners = [
    "extension/content.js", "extension/background.js", "extension/adapters/registry.js",
    "src/routes/extension.js", "src/routes/dashboard.js", "src/services/fieldOntology.js",
    "src/services/questionResolver.js", "src/contracts/fieldInteractionObservation.js",
    "src/contracts/sharedContracts.js", "src/contracts/fieldSemanticResult.js",
    "src/contracts/canonicalAnswerPolicy.js", "src/contracts/normalizedValue.js",
    "src/contracts/fieldAnswerContract.js", "src/contracts/logicalFieldIdentity.js",
    "src/contracts/fieldRevisionContracts.js", "src/contracts/applicationAuthorizationContracts.js",
    "src/contracts/extensionProtocolContracts.js", "src/contracts/contractPrimitives.js",
    "src/services/fieldRevisionService.js",
    "src/database/migrations/0007_field_revision_timeline.js",
    "src/database/migrations/0008_checkpoint_reclassification.js",
    "src/services/extensionLaunchProtocol.js", "src/services/extensionDeliveryService.js",
    "extension/durable-outbox.js",
    "src/database/migrations/0009_extension_launch_protocol.js",
    "src/database/migrations/0010_extension_durable_delivery.js",
    "src/database/migrations/0011_extension_field_cache_status.js",
    "src/contracts/evidenceUpdate.js", "src/services/evidenceRouter.js",
    "src/services/adaptiveEvidencePolicy.js", "src/services/evidenceAccumulator.js",
    "src/services/volatilityDetector.js", "src/services/promotionPolicy.js",
    "src/repositories/evidenceRollupRepository.js",
    "src/database/migrations/0012_adaptive_evidence_shadow.js",
    "supabase/phase0_extension_rls.sql",
    "src/services/answerPolicyRegistry.js", "src/services/answerContextNormalization.js",
    "src/services/scopeRankPolicy.js", "src/services/candidateAnswerFreshness.js",
    "src/services/candidateAnswerAnomaly.js", "src/repositories/candidateAnswerVersionRepository.js",
    "src/services/fieldAnswerContractService.js",
    "src/services/candidateAnswerLegacyMigrationService.js",
    "src/database/migrations/0013_candidate_answer_intelligence.js",
    "src/database/migrations/0014_employer_entity_exact_aliases.js",
    "src/database/migrations/0015_candidate_answer_legacy_migration.js",
    "supabase/phase2_candidate_truth_rls.sql",
    "src/services/fieldLearningClassifier.js", "src/services/answerLearningPolicy.js",
    "src/services/ingestionScheduler.js",
    "src/services/jobRequirementModel.js", "src/services/candidateProfileBuilder.js",
    "src/services/fieldCanonicalizer.js", "src/repositories/fieldSemanticRepository.js",
    "src/services/semanticMappingEvidenceService.js",
    "src/database/schema.sql",
    "test/extensionBrowserHarness.test.js"
];

for (const file of [indexPath, canvasPath]) {
    if (!fs.existsSync(file)) throw new Error(`Architecture artifact missing: ${path.relative(root, file)}`);
}
const index = fs.readFileSync(indexPath, "utf8");
const canvas = fs.readFileSync(canvasPath, "utf8");
for (const owner of requiredOwners) {
    if (!index.includes(owner)) throw new Error(`Architecture index does not route changes to ${owner}`);
    if (!canvas.includes(owner)) throw new Error(`Architecture canvas does not expose ${owner}`);
}
for (const marker of ["PhonePe Greenhouse Form A", "SHADOW", "CANARY", "review", "attention_items", "application_field_timeline"]) {
    if (!index.toLowerCase().includes(marker.toLowerCase())) throw new Error(`Architecture index missing contract: ${marker}`);
}
console.log(`Architecture index OK · ${requiredOwners.length} core owners · source and canvas synchronized`);

import { stableContractHash } from "../contracts/contractPrimitives.js";
import { buildFieldInteractionObservation } from "../contracts/fieldInteractionObservation.js";
import { getFeatureFlag } from "../repositories/featureFlagRepository.js";
import { recordSemanticMappingEvidence } from "../repositories/fieldSemanticRepository.js";
import { classifyFieldInteraction } from "./fieldLearningClassifier.js";
import { recordNeutralObservation } from "./fieldRevisionService.js";

const DECISIONS = new Set(["CONFIRMED", "CORRECTED"]);

/**
 * Records an explicit, value-free field-meaning decision. The old semantic
 * ledger remains an immutable operator audit, while the Phase 0 classifier
 * and adaptive kernel independently produce SHADOW recommendations. Neither
 * path changes a live mapping status.
 */
export function recordExplicitSemanticDecision({
    applicationId,
    attemptId,
    mappingId,
    canonicalKey,
    fieldId,
    fieldSignature,
    decision,
    correctedTo = null,
    alternative = false,
    legal = false,
    sensitive = false,
    extensionVersion = null,
    adapterVersion = null,
    formFingerprint = null,
    clientTimeMs = Date.now()
} = {}) {
    const normalizedDecision = String(decision || "").toUpperCase();
    if (!DECISIONS.has(normalizedDecision)) throw new Error("Semantic evidence must be CONFIRMED or CORRECTED.");
    if (!applicationId || !attemptId || !mappingId || !canonicalKey) {
        throw new Error("Semantic evidence requires an application, attempt, mapping, and canonical key.");
    }
    const eventType = normalizedDecision === "CONFIRMED"
        ? (alternative ? "MAPPING_ALTERNATIVE_CONFIRMED" : "MAPPING_CONFIRMED")
        : "MAPPING_CORRECTED";
    const legacy = recordSemanticMappingEvidence({
        mappingId,
        applicationId,
        attemptId,
        fieldSignature,
        eventType,
        metadata: {
            correctedTo: alternative ? canonicalKey : correctedTo,
            classifierVersion: "field-learning-v1",
            reasonCodes: [normalizedDecision === "CONFIRMED"
                ? "EXPLICIT_MAPPING_CONFIRMATION" : "EXPLICIT_MAPPING_CORRECTION"]
        }
    });
    const observationId = stableContractHash({
        applicationId,
        attemptId,
        mappingId,
        fieldSignature: String(fieldSignature || ""),
        decision: normalizedDecision
    });
    const observation = buildFieldInteractionObservation({
        id: fieldId || fieldSignature || mappingId,
        fieldSignature: fieldSignature || mappingId,
        semanticKey: canonicalKey,
        mappingId,
        semanticEvidence: normalizedDecision,
        fillOutcome: "OBSERVED",
        source: "USER_SEMANTIC_CONFIRMATION",
        legal,
        sensitive,
        completedByUser: true
    }, {
        observationId,
        applicationId,
        attemptId,
        semanticEvidence: normalizedDecision,
        checkpoint: { type: "EXPLICIT_SAVE", status: "VERIFIED" },
        clientTimeMs
    });
    const classifier = getFeatureFlag("learning.phase0_classifier", false);
    const adaptive = getFeatureFlag("adaptive_evidence.shadow", false);
    const classification = classifier.enabled ? classifyFieldInteraction(observation) : null;
    const recorded = recordNeutralObservation(applicationId, observation, classification, {
        adaptiveEvidenceShadow: Boolean(classification) && adaptive.enabled,
        evidenceContext: {
            extensionVersion,
            adapterVersion,
            formFingerprint: /^[a-f0-9]{64}$/.test(String(formFingerprint || "")) ? formFingerprint : null
        }
    });
    return {
        mapping: legacy,
        observationId,
        classification,
        adaptiveEvidence: recorded.adaptiveEvidence || null,
        productionMutationEnabled: false
    };
}

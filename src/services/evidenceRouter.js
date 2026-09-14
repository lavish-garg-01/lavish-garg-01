import { evidenceUpdateSchema } from "../contracts/evidenceUpdate.js";
import { stableContractHash } from "../contracts/contractPrimitives.js";
import { fieldInteractionObservationSchema } from "../contracts/fieldInteractionObservation.js";
import { fieldLearningClassificationSchema } from "./fieldLearningClassifier.js";
import {
    checkpointStrengthBps,
    completionStrengthBps,
    evidenceBaseWeight
} from "./adaptiveEvidencePolicy.js";
import { accumulateShadowEvidence } from "./evidenceAccumulator.js";

const LAYERS = Object.freeze([
    ["SEMANTIC_MAPPING", "semantic", "CANONICAL_MAPPING"],
    ["CANDIDATE_ANSWER", "answer", "CANONICAL_ANSWER"],
    ["REPRESENTATION", "representation", "REPRESENTATION_RULE"],
    ["INTERACTION_STRATEGY", "strategy", "INTERACTION_STRATEGY"],
    ["ACCEPTANCE", "acceptance", "FIELD_ACCEPTANCE"]
]);

function direction(layer, outcome, eligibility) {
    if (layer === "SEMANTIC_MAPPING") return outcome === "CONFIRMED" ? "POSITIVE" : outcome === "CORRECTED" ? "NEGATIVE" : "UNKNOWN";
    if (layer === "CANDIDATE_ANSWER") {
        if (!eligibility) return "UNKNOWN";
        return outcome === "CONFIRMED_UNCHANGED" ? "POSITIVE" : outcome === "CORRECTED" ? "NEGATIVE" : "UNKNOWN";
    }
    if (layer === "REPRESENTATION") {
        if (outcome === "REJECTED") return "NEGATIVE";
        if (!eligibility) return "UNKNOWN";
        return outcome === "CONFIRMED" ? "POSITIVE" : outcome === "CORRECTED" ? "NEGATIVE" : "UNKNOWN";
    }
    if (layer === "INTERACTION_STRATEGY") {
        if (!eligibility) return "UNKNOWN";
        return outcome === "SUCCESS" ? "POSITIVE" : outcome === "FAILURE" ? "NEGATIVE" : "UNKNOWN";
    }
    if (layer === "ACCEPTANCE") return outcome === "VERIFIED" ? "POSITIVE"
        : ["REJECTED", "ABANDONED"].includes(outcome) ? "NEGATIVE" : "UNKNOWN";
    return "UNKNOWN";
}

function eligible(classification, layer) {
    return ({
        SEMANTIC_MAPPING: classification.learningEligibility.semantic,
        CANDIDATE_ANSWER: classification.learningEligibility.candidateAnswer,
        REPRESENTATION: classification.learningEligibility.representation,
        INTERACTION_STRATEGY: classification.learningEligibility.strategy,
        ACCEPTANCE: true
    })[layer] === true;
}

function subject(observation, layer) {
    const fallbackHash = stableContractHash({ logicalFieldId: observation.logicalFieldId });
    const fallback = `field:${fallbackHash.slice(0, 24)}`;
    if (layer === "SEMANTIC_MAPPING") {
        if (observation.semantic.mappingId && observation.semantic.canonicalKey) {
            return `${observation.semantic.mappingId}:${observation.semantic.canonicalKey}`.slice(0, 180);
        }
        return observation.semantic.mappingId || observation.semantic.canonicalKey || fallback;
    }
    if (layer === "CANDIDATE_ANSWER") return observation.semantic.canonicalKey || fallback;
    if (layer === "REPRESENTATION") return observation.representation.ruleId || fallback;
    if (layer === "INTERACTION_STRATEGY") return observation.strategy.strategyId || fallback;
    return fallback;
}

function evidenceSource(layer, observation) {
    if (layer === "SEMANTIC_MAPPING") return observation.semantic.explicitEvidence !== "NONE"
        ? "EXPLICIT_SEMANTIC" : "CHECKPOINT_CLASSIFIER";
    if (layer === "INTERACTION_STRATEGY") return "STABLE_READBACK";
    if (layer === "REPRESENTATION" && observation.strategy.employerValidation !== "NOT_OBSERVED") return "EMPLOYER_VALIDATION";
    if (layer === "CANDIDATE_ANSWER" && observation.answer.completedByUser) return "HUMAN_OBSERVATION";
    return "CHECKPOINT_CLASSIFIER";
}

function attributionBps(layer, observation, outcome) {
    if (layer === "SEMANTIC_MAPPING") return ["CONFIRMED", "CORRECTED"].includes(outcome) ? 10_000 : 0;
    if (layer === "CANDIDATE_ANSWER") return observation.answer.normalizedEquivalent !== null ? 9500 : 7000;
    if (layer === "REPRESENTATION") return observation.representation.equivalentTruth !== null
        || observation.strategy.employerValidation !== "NOT_OBSERVED" ? 9500 : 6000;
    if (layer === "INTERACTION_STRATEGY") return observation.strategy.readback !== "NOT_OBSERVED" ? 9500 : 5000;
    return ["VERIFIED", "REJECTED", "ABANDONED"].includes(outcome) ? 9000 : 4000;
}

function sampleQualityBps(layer, observation) {
    if (layer !== "INTERACTION_STRATEGY") return 10_000;
    return ({ CLEAN: 10_000, RESTORED: 9000, NOT_REQUIRED: 10_000, UNKNOWN: 5000, DIRTY: 2000 })[observation.strategy.cleanup];
}

function riskMultiplierBps(layer, evidenceDirection) {
    if (evidenceDirection !== "NEGATIVE") return layer === "CANDIDATE_ANSWER" ? 8000 : 10_000;
    return ({ SEMANTIC_MAPPING: 13_000, CANDIDATE_ANSWER: 10_000, REPRESENTATION: 12_000,
        INTERACTION_STRATEGY: 14_000, ACCEPTANCE: 10_000 })[layer] || 10_000;
}

export function buildEvidenceUpdates(observationInput, classificationInput, context = {}) {
    const observation = fieldInteractionObservationSchema.parse(observationInput);
    const classification = fieldLearningClassificationSchema.parse(classificationInput);
    if (classification.observationId !== observation.observationId) throw new Error("Classification and observation do not match.");
    const classificationHash = stableContractHash(classification);
    const fieldScopeHash = observation.fieldSignatureHash || stableContractHash({ logicalFieldId: observation.logicalFieldId });
    return LAYERS.map(([layer, resultKey, subjectType]) => {
        const result = classification[resultKey];
        const isEligible = eligible(classification, layer);
        const evidenceDirection = direction(layer, result.outcome, isEligible);
        const subjectKey = subject(observation, layer);
        const candidatePrivate = ["CANDIDATE_ANSWER", "ACCEPTANCE", "ENTITY_BINDING"].includes(layer);
        const scopeType = layer === "ACCEPTANCE" ? "APPLICATION" : candidatePrivate ? "CANDIDATE" : "FIELD_FINGERPRINT";
        const scopeKeyHash = scopeType === "APPLICATION"
            ? stableContractHash({ applicationId: observation.applicationId })
            : scopeType === "CANDIDATE" ? stableContractHash({ scope: "CURRENT_CANDIDATE" }) : fieldScopeHash;
        const checkpointType = observation.checkpoint.type;
        const checkpointStatus = observation.checkpoint.status;
        const semanticExplicit = layer === "SEMANTIC_MAPPING" && evidenceDirection !== "UNKNOWN";
        return evidenceUpdateSchema.parse({
            schemaVersion: 1,
            evidenceId: stableContractHash({ observationId: observation.observationId, layer, classificationHash }),
            observationId: observation.observationId,
            classificationHash,
            runId: observation.attemptId,
            applicationId: observation.applicationId,
            layer,
            subjectType,
            subjectKey,
            subjectKeyHash: stableContractHash({ layer, subjectKey }),
            aggregationScope: candidatePrivate ? "CANDIDATE_PRIVATE" : "SHARED_REDACTED",
            scopeType,
            scopeKeyHash,
            direction: evidenceDirection,
            source: evidenceSource(layer, observation),
            executionContext: layer === "INTERACTION_STRATEGY" ? String(context.executionContext || "DIRECT") : "NOT_APPLICABLE",
            checkpointType,
            context: {
                baseWeight: evidenceBaseWeight(layer, evidenceDirection),
                sourceReliabilityBps: semanticExplicit ? 10_000 : evidenceDirection === "UNKNOWN" ? 0 : 9000,
                checkpointStrengthBps: semanticExplicit ? 10_000 : checkpointStrengthBps(checkpointType, checkpointStatus),
                attributionConfidenceBps: attributionBps(layer, observation, result.outcome),
                sampleQualityBps: sampleQualityBps(layer, observation),
                recencyBps: 10_000,
                scopeSimilarityBps: 10_000,
                completionStrengthBps: semanticExplicit ? 10_000 : completionStrengthBps(checkpointType, checkpointStatus),
                riskMultiplierBps: riskMultiplierBps(layer, evidenceDirection),
                extensionTrustBps: context.extensionVersion ? 9500 : 8500
            },
            formFingerprint: context.formFingerprint || null,
            extensionVersion: context.extensionVersion || null,
            adapterVersion: context.adapterVersion || null,
            occurredAtMs: observation.clientTimeMs,
            reasonCodes: [...new Set([...result.reasonCodes, isEligible ? "CLASSIFIER_ELIGIBLE" : "CLASSIFIER_NOT_ELIGIBLE", "SHADOW_ONLY"])].slice(0, 12),
            valueFree: true,
            containsProtectedValue: false
        });
    });
}

export function routeClassificationEvidence(observation, classification, context = {}) {
    return buildEvidenceUpdates(observation, classification, context)
        .map((update) => accumulateShadowEvidence(update, context));
}

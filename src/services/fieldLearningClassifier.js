import { z } from "zod";
import { fieldInteractionObservationSchema } from "../contracts/fieldInteractionObservation.js";

export const FIELD_LEARNING_CLASSIFICATION_VERSION = 1;

const reasonCodes = z.array(z.string().max(100)).max(12);
const layerResult = (outcomes) => z.object({
    outcome: z.enum(outcomes),
    reasonCodes
}).strict();

export const fieldLearningClassificationSchema = z.object({
    schemaVersion: z.literal(FIELD_LEARNING_CLASSIFICATION_VERSION),
    observationId: z.string().max(120),
    mode: z.literal("SHADOW"),
    semantic: layerResult(["CONFIRMED", "CORRECTED", "NO_EVIDENCE", "UNKNOWN"]),
    answer: layerResult(["CONFIRMED_UNCHANGED", "CORRECTED", "NO_EVIDENCE", "UNKNOWN"]),
    representation: layerResult(["CONFIRMED", "CORRECTED", "PREFERENCE", "REJECTED", "NO_EVIDENCE", "UNKNOWN"]),
    strategy: layerResult(["SUCCESS", "FAILURE", "NO_EVIDENCE", "UNKNOWN"]),
    acceptance: layerResult(["DRAFT_ONLY", "RUNTIME_ACCEPTED", "PENDING_COMMIT", "VERIFIED", "REJECTED", "ABANDONED", "UNKNOWN"]),
    learningEligibility: z.object({
        semantic: z.boolean(),
        candidateAnswer: z.boolean(),
        representation: z.boolean(),
        strategy: z.boolean()
    }).strict()
}).strict();

function result(outcome, ...reasonCodesValue) {
    return { outcome, reasonCodes: reasonCodesValue.flat().filter(Boolean).slice(0, 12) };
}

function classifyAcceptance(observation) {
    const { type, status } = observation.checkpoint;
    if (status === "ABANDONED") return result("ABANDONED", "CHECKPOINT_ABANDONED");
    if (status === "REJECTED") return result("REJECTED", "CHECKPOINT_REJECTED");
    if (status === "UNKNOWN") return result("UNKNOWN", "CHECKPOINT_UNKNOWN");
    if (status !== "VERIFIED") return result(type === "LOCAL_VALIDITY" ? "DRAFT_ONLY" : "UNKNOWN", "NO_VERIFIED_CHECKPOINT");
    if (["SUBMISSION", "EXPLICIT_SAVE"].includes(type)) return result("VERIFIED", `${type}_VERIFIED`);
    if (type === "REVIEW") return result("PENDING_COMMIT", "REVIEW_IS_NOT_FINAL_COMMIT");
    if (["LOCAL_VALIDITY", "PAGE_ADVANCE"].includes(type)) return result("RUNTIME_ACCEPTED", `${type}_RUNTIME_ONLY`);
    return result("UNKNOWN", "CHECKPOINT_TYPE_UNKNOWN");
}

function classifySemantic(observation) {
    if (observation.semantic.explicitEvidence === "CONFIRMED") return result("CONFIRMED", "EXPLICIT_MAPPING_CONFIRMATION");
    if (observation.semantic.explicitEvidence === "CORRECTED") return result("CORRECTED", "EXPLICIT_MAPPING_CORRECTION");
    return result("NO_EVIDENCE", "ANSWER_BEHAVIOR_IS_NOT_SEMANTIC_EVIDENCE");
}

function classifyStrategy(observation) {
    if (!observation.strategy.attempted) return result("NO_EVIDENCE", "NO_STRATEGY_ATTEMPT");
    if (["MISMATCH", "REVERTED"].includes(observation.strategy.readback)) {
        return result("FAILURE", observation.strategy.readback === "REVERTED" ? "VALUE_REVERTED" : "STABLE_READBACK_MISMATCH");
    }
    if (observation.strategy.readback === "MATCH") return result("SUCCESS", "STABLE_READBACK_MATCH");
    return result("UNKNOWN", "NO_STABLE_READBACK");
}

function classifyAnswer(observation, acceptance) {
    if (observation.protected) return result("NO_EVIDENCE", "PROTECTED_VALUE");
    if (acceptance.outcome !== "VERIFIED") {
        return result(acceptance.outcome === "ABANDONED" ? "NO_EVIDENCE" : "UNKNOWN", "NO_FINAL_LEARNING_COMMIT");
    }
    if (observation.answer.userEdited) {
        if (observation.answer.normalizedEquivalent === true) return result("CONFIRMED_UNCHANGED", "USER_FINAL_VALUE_EQUIVALENT");
        if (observation.answer.normalizedEquivalent === false) return result("CORRECTED", "USER_FINAL_VALUE_CHANGED_TRUTH");
        if (observation.answer.completedByUser && !observation.answer.intendedValueHash
            && observation.answer.finalValueHash) {
            return result("CORRECTED", "USER_PROVIDED_PREVIOUSLY_UNKNOWN_ANSWER");
        }
        return result("UNKNOWN", "USER_EDIT_ATTRIBUTION_AMBIGUOUS");
    }
    if (observation.answer.intendedValueHash && observation.answer.intendedValueHash === observation.answer.finalValueHash) {
        return result("CONFIRMED_UNCHANGED", "FINAL_VALUE_MATCHED_INTENT");
    }
    return result("NO_EVIDENCE", "NO_COMPARABLE_ANSWER_VALUES");
}

function classifyRepresentation(observation, acceptance, strategy) {
    if (!observation.representation.ruleId) return result("NO_EVIDENCE", "NO_REPRESENTATION_RULE");
    if (strategy.outcome === "FAILURE") return result("NO_EVIDENCE", "INTERACTION_FAILED_BEFORE_REPRESENTATION_ACCEPTANCE");
    if (observation.strategy.employerValidation === "REJECTED" && !observation.representation.changed) {
        return result("REJECTED", "EMPLOYER_REJECTED_INTENDED_REPRESENTATION");
    }
    if (observation.representation.changed && observation.representation.equivalentTruth === true) {
        if (observation.representation.originalRejected && acceptance.outcome === "VERIFIED") {
            return result("CORRECTED", "ALTERNATIVE_REPRESENTATION_ACCEPTED");
        }
        if (observation.representation.bothEmployerValid) return result("PREFERENCE", "BOTH_REPRESENTATIONS_VALID");
        return result("UNKNOWN", "EQUIVALENT_TRUTH_WITHOUT_REJECTION_PROOF");
    }
    if (acceptance.outcome === "VERIFIED"
        && observation.representation.intendedValueHash
        && observation.representation.intendedValueHash === observation.representation.finalValueHash) {
        return result("CONFIRMED", "REPRESENTATION_ACCEPTED_AT_FINAL_COMMIT");
    }
    return result("UNKNOWN", "NO_FINAL_REPRESENTATION_PROOF");
}

/**
 * Pure Phase 0 classifier. It returns layer-specific shadow decisions and never
 * writes evidence or changes production behavior.
 */
export function classifyFieldInteraction(input) {
    const observation = fieldInteractionObservationSchema.parse(input);
    const acceptance = classifyAcceptance(observation);
    const semantic = classifySemantic(observation);
    const strategy = classifyStrategy(observation);
    const answer = classifyAnswer(observation, acceptance);
    const representation = classifyRepresentation(observation, acceptance, strategy);
    return fieldLearningClassificationSchema.parse({
        schemaVersion: FIELD_LEARNING_CLASSIFICATION_VERSION,
        observationId: observation.observationId,
        mode: "SHADOW",
        semantic,
        answer,
        representation,
        strategy,
        acceptance,
        learningEligibility: {
            semantic: ["CONFIRMED", "CORRECTED"].includes(semantic.outcome),
            candidateAnswer: !observation.protected && acceptance.outcome === "VERIFIED"
                && ["CONFIRMED_UNCHANGED", "CORRECTED"].includes(answer.outcome),
            representation: acceptance.outcome === "VERIFIED"
                && ["CONFIRMED", "CORRECTED"].includes(representation.outcome),
            strategy: !["ABANDONED", "UNKNOWN"].includes(acceptance.outcome)
                && ["SUCCESS", "FAILURE"].includes(strategy.outcome)
        }
    });
}

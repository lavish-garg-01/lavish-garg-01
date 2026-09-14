import assert from "node:assert/strict";
import test from "node:test";
import { mappingOutcomeFromFill } from "../src/adapters/fillOutcomes.js";
import {
    FIELD_INTERACTION_OBSERVATION_VERSION,
    buildFieldInteractionObservation,
    fieldInteractionObservationSchema
} from "../src/contracts/fieldInteractionObservation.js";
import {
    FIELD_LEARNING_CLASSIFICATION_VERSION,
    classifyFieldInteraction,
    fieldLearningClassificationSchema
} from "../src/services/fieldLearningClassifier.js";
import { fieldLearningReplays } from "./fixtures/field-learning-replays.js";

function observation(field = {}, context = {}) {
    return buildFieldInteractionObservation({
        id: "authorization",
        label: "Are you authorized to work in India?",
        semanticKey: "WORK_AUTHORIZATION_INDIA",
        type: "radio",
        fillOutcome: "USER_CORRECTED",
        source: "USER_MANUAL_INPUT",
        ...field
    }, {
        applicationId: "application-1",
        attemptId: "attempt-1",
        clientTimeMs: 1,
        ...context
    });
}

test("USER_CORRECTED is neutral until the five-layer classifier attributes it", () => {
    assert.equal(mappingOutcomeFromFill("USER_CORRECTED"), null);
    assert.equal(mappingOutcomeFromFill("FILLED"), "success");
    assert.equal(mappingOutcomeFromFill("FILL_FAILED"), "failure");

    const input = observation({
        intendedValue: "Yes",
        value: "No",
        normalizedEquivalent: false,
        strategyId: "RADIO_BY_LABEL_V1",
        strategyAttempted: true,
        readback: "MATCH",
        valid: true
    }, { checkpoint: { type: "SUBMISSION", status: "VERIFIED" } });
    const classified = classifyFieldInteraction(input);

    assert.equal(input.schemaVersion, FIELD_INTERACTION_OBSERVATION_VERSION);
    assert.equal(classified.schemaVersion, FIELD_LEARNING_CLASSIFICATION_VERSION);
    assert.equal(classified.semantic.outcome, "NO_EVIDENCE");
    assert.equal(classified.answer.outcome, "CORRECTED");
    assert.equal(classified.strategy.outcome, "SUCCESS");
    assert.equal(classified.acceptance.outcome, "VERIFIED");
    assert.equal(classified.learningEligibility.semantic, false);
    assert.equal(classified.learningEligibility.candidateAnswer, true);
});

test("a failed strategy does not punish candidate truth or representation", () => {
    const classified = classifyFieldInteraction(observation({
        intendedValue: "Razorpay",
        value: "Razorpay",
        normalizedEquivalent: true,
        representationRuleId: "TEXT_V1",
        strategyId: "REACT_INPUT_V1",
        strategyAttempted: true,
        readback: "REVERTED",
        completedByUser: true
    }, { checkpoint: { type: "SUBMISSION", status: "VERIFIED" } }));

    assert.equal(classified.semantic.outcome, "NO_EVIDENCE");
    assert.equal(classified.answer.outcome, "CONFIRMED_UNCHANGED");
    assert.equal(classified.representation.outcome, "NO_EVIDENCE");
    assert.equal(classified.strategy.outcome, "FAILURE");
});

test("representation correction and preference remain distinct from candidate truth", () => {
    const corrected = classifyFieldInteraction(observation({
        intendedValue: "5",
        value: "4",
        normalizedEquivalent: true,
        equivalentTruth: true,
        representationRuleId: "ROUND_YEARS_V1",
        representationChanged: true,
        originalRepresentationRejected: true,
        strategyAttempted: true,
        readback: "MATCH"
    }, { checkpoint: { type: "EXPLICIT_SAVE", status: "VERIFIED" } }));
    assert.equal(corrected.answer.outcome, "CONFIRMED_UNCHANGED");
    assert.equal(corrected.representation.outcome, "CORRECTED");

    const preference = classifyFieldInteraction(observation({
        intendedValue: "5",
        value: "4",
        normalizedEquivalent: true,
        equivalentTruth: true,
        representationRuleId: "ROUND_YEARS_V1",
        representationChanged: true,
        bothRepresentationsValid: true,
        strategyAttempted: true,
        readback: "MATCH"
    }, { checkpoint: { type: "SUBMISSION", status: "VERIFIED" } }));
    assert.equal(preference.representation.outcome, "PREFERENCE");
    assert.equal(preference.learningEligibility.representation, false);
});

test("review is pending and abandonment creates no learning eligibility", () => {
    const review = classifyFieldInteraction(observation({
        intendedValue: "30",
        value: "30",
        normalizedEquivalent: true,
        strategyAttempted: true,
        readback: "MATCH"
    }, { checkpoint: { type: "REVIEW", status: "VERIFIED" } }));
    assert.equal(review.acceptance.outcome, "PENDING_COMMIT");
    assert.equal(review.learningEligibility.candidateAnswer, false);

    const abandoned = classifyFieldInteraction(observation({
        intendedValue: "30",
        value: "60",
        normalizedEquivalent: false,
        strategyAttempted: true,
        readback: "MATCH"
    }, { checkpoint: { type: "NONE", status: "ABANDONED" } }));
    assert.equal(abandoned.acceptance.outcome, "ABANDONED");
    assert.equal(abandoned.answer.outcome, "NO_EVIDENCE");
    assert.deepEqual(abandoned.learningEligibility, {
        semantic: false,
        candidateAnswer: false,
        representation: false,
        strategy: false
    });
});

test("protected observations contain no value-derived hashes", () => {
    const protectedObservation = observation({
        id: "password",
        label: "Password",
        type: "password",
        value: "must-not-leak",
        intendedValue: "must-not-leak",
        beforeValue: "old-secret"
    });
    assert.equal(protectedObservation.protected, true);
    assert.equal(protectedObservation.answer.beforeValueHash, null);
    assert.equal(protectedObservation.answer.intendedValueHash, null);
    assert.equal(protectedObservation.answer.finalValueHash, null);
    assert.equal(protectedObservation.fieldSignatureHash, null);
    assert.doesNotMatch(JSON.stringify(protectedObservation), /must-not-leak|old-secret/);
    assert.equal(fieldInteractionObservationSchema.safeParse(protectedObservation).success, true);
    assert.equal(fieldLearningClassificationSchema.safeParse(classifyFieldInteraction(protectedObservation)).success, true);
});

for (const replay of fieldLearningReplays) {
    test(`Phase 0 replay: ${replay.name}`, () => {
        const classified = classifyFieldInteraction(observation(replay.field, { checkpoint: replay.checkpoint }));
        assert.deepEqual({
            semantic: classified.semantic.outcome,
            answer: classified.answer.outcome,
            representation: classified.representation.outcome,
            strategy: classified.strategy.outcome,
            acceptance: classified.acceptance.outcome
        }, replay.expected);
    });
}

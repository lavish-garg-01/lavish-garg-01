import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_AUTOFILL_POLICIES } from "../src/repositories/autofillPolicyRepository.js";
import {
    ANSWER_LEARNING_POLICY_VERSION,
    LEARNING_CATEGORY_POLICIES,
    LEARNING_COMMIT_POINTS,
    LEARNING_DECISIONS,
    answerLearningPolicyFor
} from "../src/services/answerLearningPolicy.js";

test("every current autofill category has one Phase 0A learning decision", () => {
    assert.deepEqual(Object.keys(LEARNING_CATEGORY_POLICIES).sort(), Object.keys(DEFAULT_AUTOFILL_POLICIES).sort());
    for (const decision of Object.values(LEARNING_CATEGORY_POLICIES)) {
        assert.equal(Object.values(LEARNING_DECISIONS).includes(decision), true);
    }
});

test("low-risk facts wait for verified completion instead of interrupting each field", () => {
    assert.deepEqual(answerLearningPolicyFor({ category: "CONTACT", semanticKey: "LINKEDIN_URL" }), {
        version: ANSWER_LEARNING_POLICY_VERSION,
        decision: LEARNING_DECISIONS.AUTO_VERSION,
        scope: "CANDIDATE",
        commitPoint: LEARNING_COMMIT_POINTS.VERIFIED_SUBMISSION,
        reasonCode: "LOW_RISK_STABLE_FACT"
    });
});

test("consequential, suspicious, and entity-scoped facts require review to save", () => {
    for (const field of [
        { category: "COMPENSATION", semanticKey: "CURRENT_CTC" },
        { category: "PROFESSIONAL", semanticKey: "WORK_AUTHORIZATION_INDIA" },
        { category: "PROFESSIONAL", semanticKey: "PREVIOUSLY_EMPLOYED_BY_COMPANY", entityScoped: true },
        { category: "CONTACT", semanticKey: "EMAIL", suspiciousChange: true }
    ]) {
        const policy = answerLearningPolicyFor(field);
        assert.equal(policy.decision, LEARNING_DECISIONS.REVIEW_TO_SAVE);
        assert.equal(policy.commitPoint, LEARNING_COMMIT_POINTS.EXPLICIT_SAVE);
    }
});

test("declarations are application authorization, not reusable candidate answers", () => {
    const ordinary = answerLearningPolicyFor({ category: "LEGAL", label: "I agree to the applicant privacy notice", type: "checkbox" });
    assert.equal(ordinary.decision, LEARNING_DECISIONS.APPLICATION_AUTHORIZATION);
    assert.equal(ordinary.scope, "APPLICATION_CONTENT_REVISION");
    assert.equal(ordinary.commitPoint, null);
});

test("security challenges and government identifiers never learn", () => {
    for (const label of ["Enter OTP", "Aadhaar number", "CAPTCHA challenge", "Password"]) {
        assert.equal(answerLearningPolicyFor({ label }).decision, LEARNING_DECISIONS.NEVER_LEARN);
    }
});

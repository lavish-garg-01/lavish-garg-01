import assert from "node:assert/strict";
import test from "node:test";
import { buildApplicationPlan } from "../src/services/applicationPlanner.js";

test("batched planner fills only verified safe fields and never submits", () => {
    const plan = buildApplicationPlan({
        fields: [
            { id: "name", label: "First name", type: "text", required: true },
            { id: "consent", label: "Privacy consent", type: "checkbox", required: true },
            { id: "start", label: "Start date", type: "date", required: true }
        ],
        answers: [
            { fieldId: "name", answer: "Asha", confidence: 1, source: "PROFILE", classification: { kind: "stable", autoFill: true } },
            { fieldId: "consent", answer: "true", confidence: 1, source: "PROFILE", classification: { kind: "legal", autoFill: false } },
            { fieldId: "start", answer: null, confidence: 0, requiresUserInput: true, classification: { kind: "volatile", autoFill: false } }
        ]
    });
    assert.deepEqual(plan.actions.map((item) => item.fieldId), ["name"]);
    assert.deepEqual(plan.review.map((item) => item.fieldId), ["consent", "start"]);
    assert.equal(plan.submits, false);
    assert.equal(plan.actions[0].provenance, "From Profile");
    assert.deepEqual(plan.summary, { total: 3, ready: 1, alreadyComplete: 0, needsYou: 1, aiDrafts: 0, manual: 1 });
});

test("attached document fields are completed instead of becoming candidate questions", () => {
    const plan = buildApplicationPlan({
        fields: [
            { id: "resume", label: "Resume", type: "file", required: true, value: "C:\\fakepath\\resume.pdf" },
            { id: "cover", label: "Cover letter", type: "file", required: false, value: "C:\\fakepath\\cover-letter.pdf" }
        ],
        answers: []
    });
    assert.deepEqual(plan.review, []);
    assert.deepEqual(plan.completed.map((item) => item.label), ["Resume", "Cover letter"]);
});

test("planner never silently overwrites a conflicting portal value", () => {
    const plan = buildApplicationPlan({
        fields: [{ id: "ctc", label: "Expected CTC", type: "text", required: true, value: "20 LPA" }],
        answers: [{ fieldId: "ctc", answer: "24 LPA", confidence: 1, source: "PROFILE", classification: { kind: "stable", autoFill: true } }]
    });
    assert.equal(plan.actions.length, 0);
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0].existingValue, "20 LPA");
    assert.equal(plan.conflicts[0].proposedValue, "24 LPA");
    assert.equal(plan.summary.needsYou, 1);
    assert.equal(plan.submits, false);
});

test("AI grounded writing is inserted for review, not treated as verified profile fill", () => {
    const plan = buildApplicationPlan({
        fields: [{ id: "why", label: "Why are you interested?", type: "textarea", required: true, value: "" }],
        answers: [{ fieldId: "why", normalizedKey: "WHY_INTERESTED", answer: "A grounded draft", confidence: 0.99, source: "AI_GROUNDED",
            classification: { kind: "stable", scope: "REUSABLE_ANSWER_LIBRARY", autoFill: true } }]
    });
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0].source, "AI_GROUNDED");
    assert.equal(plan.review[0].riskGroup, "AI_WRITING_REVIEW");
    assert.equal(plan.summary.aiDrafts, 1);
    assert.equal(plan.submits, false);
});

test("category policies pause volatile facts and remain deterministic", () => {
    const fields = [{ id: "ctc", label: "Expected CTC", type: "text", required: true }];
    const answers = [{ fieldId: "ctc", normalizedKey: "EXPECTED_CTC", answer: "24", confidence: 1, source: "PROFILE",
        classification: { kind: "stable", scope: "CANDIDATE_PROFILE", autoFill: true } }];
    const defaultPlan = buildApplicationPlan({ fields, answers });
    assert.equal(defaultPlan.actions.length, 0);
    assert.equal(defaultPlan.review[0].reason, "category_policy_review");
    assert.equal(defaultPlan.review[0].riskGroup, "COMPENSATION_REVIEW");

    const approvedPlan = buildApplicationPlan({ fields, answers, categoryPolicies: { COMPENSATION: "AUTO_VERIFIED" } });
    assert.equal(approvedPlan.actions[0].fieldId, "ctc");
    assert.equal(approvedPlan.actions[0].category, "COMPENSATION");
    assert.equal(approvedPlan.submits, false);
});

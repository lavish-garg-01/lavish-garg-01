import assert from "node:assert/strict";
import test from "node:test";
import { buildFinalReviewChecklist, releasePolicyForField, RELEASE_MODES } from "../src/services/reviewReleasePolicy.js";

test("final review groups protected fields without learning, filling, or submitting them", () => {
    const checklist = buildFinalReviewChecklist([
        { id: "email", label: "Email", required: true },
        { id: "visa", label: "Will you now or later need visa sponsorship?", required: true },
        { id: "terms", label: "I certify that this information is correct", type: "checkbox", required: true },
        { id: "gender", label: "Gender", required: false },
        { id: "otp", label: "Verification code", required: true }
    ]);
    assert.equal(checklist.items.length, 4);
    assert.equal(checklist.items.some((item) => item.fieldId === "email"), false);
    assert.equal(checklist.items.find((item) => item.fieldId === "terms").mode, RELEASE_MODES.USER_ACTION_ONLY);
    assert.equal(checklist.items.find((item) => item.fieldId === "gender").mode, RELEASE_MODES.OPTIONAL_LEAVE_EMPTY);
    assert.equal(checklist.items.find((item) => item.fieldId === "otp").mode, RELEASE_MODES.NEVER_STORE_OR_FILL);
    assert.equal(checklist.autoSubmits, false);
    assert.equal(checklist.storesRawValues, false);
    assert.equal(checklist.canReachFinalReview, false);
});

test("government IDs are never stored and work authorization is application review", () => {
    assert.equal(releasePolicyForField({ label: "Aadhaar number" }).mode, RELEASE_MODES.NEVER_STORE_OR_FILL);
    assert.equal(releasePolicyForField({ label: "Are you authorized to work in India?" }).mode, RELEASE_MODES.APPLICATION_REVIEW);
});

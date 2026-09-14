import assert from "node:assert/strict";
import test from "node:test";
import { canUseAiApplicationAnswers, canUseAiProcessing, isSensitiveApplicationField, minimizedProfileForAi } from "../src/services/privacyPolicy.js";
import { currentPlan } from "../src/services/entitlements.js";

test("AI processing remains consent-gated and direct identifiers are minimized", () => {
    assert.equal(canUseAiProcessing({ aiProcessingConsent: false }), false);
    assert.equal(canUseAiProcessing({ aiProcessingConsent: true }), true);
    const minimized = minimizedProfileForAi({ name: "Asha", email: "a@example.com", phone: "123", postalCode: "560001", skills: ["Node.js"] });
    assert.deepEqual(minimized, { name: "Asha", skills: ["Node.js"] });
});

test("Free blocks candidate-specific AI even with consent", () => {
    assert.equal(canUseAiApplicationAnswers({ aiProcessingConsent: false }), false);
    assert.equal(canUseAiApplicationAnswers({ aiProcessingConsent: true }), false);
    assert.equal(currentPlan().requirePaidForAiAnswers, true);
    assert.equal(currentPlan().aiCallsPerDay, 0);
    assert.equal(currentPlan().id, "FREE");
});

test("legal and sensitive application fields never enter AI or vector memory paths", () => {
    assert.equal(isSensitiveApplicationField({ label: "I agree to the privacy policy", type: "checkbox" }), true);
    assert.equal(isSensitiveApplicationField({ label: "Captcha", name: "captcha", type: "text" }), true);
    assert.equal(isSensitiveApplicationField({ label: "Will you require visa sponsorship?", type: "select-one" }), true);
    assert.equal(isSensitiveApplicationField({ label: "Current company", type: "text" }), false);
});

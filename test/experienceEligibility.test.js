import assert from "node:assert/strict";
import test from "node:test";
import {
    applyExperienceEligibility,
    evaluateExperienceEligibility,
    extractMinimumExperienceYears
} from "../src/services/experienceEligibility.js";

test("extracts explicit minimum experience formats from employer pages", () => {
    assert.equal(extractMinimumExperienceYears("Experience: 12-14 years"), 12);
    assert.equal(extractMinimumExperienceYears("8-12 years of solid experience in backend engineering."), 8);
    assert.equal(extractMinimumExperienceYears("8–12 years of solid experience in backend engineering."), 8);
    assert.equal(extractMinimumExperienceYears("3+ years of experience"), 3);
    assert.equal(extractMinimumExperienceYears("Minimum 5 years relevant experience"), 5);
    assert.equal(extractMinimumExperienceYears("Minimum 5 years of hands-on backend development experience; Candidates with 8–10 years of experience are also welcome to apply."), 5);
    assert.equal(extractMinimumExperienceYears("Candidates with 8–10 years of experience are also welcome to apply."), null);
    assert.equal(extractMinimumExperienceYears("Strong engineering fundamentals"), null);
});

test("blocks candidates below an explicit experience minimum", () => {
    const eligibility = evaluateExperienceEligibility(
        { yoe_min: 12, title: "Back-end Engineer" },
        { totalExperienceYears: 3.5 }
    );
    assert.equal(eligibility.allowed, false);
    assert.equal(eligibility.requiredYears, 12);
    assert.equal(eligibility.candidateYears, 3.5);
    assert.match(eligibility.reason, /Experience mismatch/);
});

test("hard-caps score and recommendation when experience is insufficient", () => {
    const result = applyExperienceEligibility(
        { matchScore: 85, recommendation: "pursue", explanation: "Skill overlap is strong." },
        { description: "Experience: 12-14 years" },
        { totalExperienceYears: 3.5 }
    );
    assert.equal(result.matchScore, 35);
    assert.equal(result.recommendation, "skip");
    assert.equal(result.experienceCompatible, false);
});

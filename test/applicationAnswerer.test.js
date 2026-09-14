import assert from "node:assert/strict";
import test from "node:test";
import { deriveTechnologyExperienceYears, generateGroundedApplicationAnswer } from "../src/services/applicationAnswerer.js";

const resume = {
    experience: [
        {
            company: "Example",
            title: "Backend Developer",
            startDate: "2025-01",
            endDate: "2026-02",
            bullets: ["Built backend services and APIs."]
        },
        {
            company: "Example",
            title: "Team Lead",
            startDate: "2026-03",
            endDate: "Present",
            bullets: ["Led Node.js backend architecture."]
        }
    ]
};

test("derives conservative technology experience from continuous resume evidence", () => {
    const result = deriveTechnologyExperienceYears(resume, "Node.js", new Date("2026-08-18T00:00:00Z"));
    assert.equal(result.answer, "1.5");
    assert.equal(result.source, "RESUME_DERIVED");
    assert.equal(result.reusable, true);
    assert.ok(result.confidence >= 0.9);
    assert.match(result.evidence, /20 month/);
});

test("requires candidate confirmation for sensitive application facts", async () => {
    const result = await generateGroundedApplicationAnswer("Do you require visa sponsorship?", { resume });
    assert.equal(result.answer, null);
    assert.equal(result.requiresUserInput, true);
    assert.equal(result.source, "USER_REQUIRED");
});

test("does not accept legal consent on the candidate's behalf", async () => {
    const result = await generateGroundedApplicationAnswer("I certify that this application is accurate and complete", { resume });
    assert.equal(result.answer, null);
    assert.equal(result.requiresUserInput, true);
    assert.equal(result.source, "USER_REQUIRED");
});

test("leftover writing stays unfilled when AI answers are off", async () => {
    const result = await generateGroundedApplicationAnswer("Describe a recent project you are proud of", {
        resume,
        profile: { aiProcessingConsent: false }
    });
    assert.equal(result.answer, null);
    assert.equal(result.source, "USER_REQUIRED");
    assert.match(result.evidence, /AI-generated application answers are off/);
});

test("resume-derived Node.js experience still fills when AI answers are off", async () => {
    const result = await generateGroundedApplicationAnswer("How many years of Node.js experience do you have?", {
        resume,
        profile: { aiProcessingConsent: false }
    });
    assert.equal(result.source, "RESUME_DERIVED");
    assert.ok(Number(result.answer) > 0);
});

test("never sends CAPTCHA challenges to AI", async () => {
    const result = await generateGroundedApplicationAnswer("Enter the CAPTCHA verification challenge", {
        resume,
        profile: { aiProcessingConsent: true },
        field: { label: "Captcha", name: "captcha", type: "text" }
    });
    assert.equal(result.answer, null);
    assert.equal(result.requiresUserInput, true);
    assert.equal(result.source, "USER_REQUIRED");
});

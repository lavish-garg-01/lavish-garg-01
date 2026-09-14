import assert from "node:assert/strict";
import test from "node:test";
import { aiGenerationEligible, normalizeQuestionKey, resolveQuestion } from "../src/services/questionResolver.js";

test("normalizes common application questions without guessing answers", () => {
    assert.equal(normalizeQuestionKey("First name"), "FIRST_NAME");
    assert.equal(normalizeQuestionKey("Last name"), "LAST_NAME");
    assert.equal(normalizeQuestionKey("What is your current CTC?"), "CURRENT_CTC");
    assert.equal(normalizeQuestionKey("What is your present compensation?"), "CURRENT_CTC");
    assert.equal(normalizeQuestionKey("What are your compensation expectations for this role?"), "EXPECTED_CTC");
    assert.equal(normalizeQuestionKey("What is your Last Working Day?"), "LAST_WORKING_DATE");
    assert.equal(normalizeQuestionKey("Present Address"), "PRESENT_ADDRESS");
    assert.equal(normalizeQuestionKey("Current(or last) CTC"), "CURRENT_CTC");
    assert.equal(normalizeQuestionKey("Years of Node.js Experience"), "NODEJS_EXPERIENCE");
    assert.equal(normalizeQuestionKey("Are you willing to relocate?"), "RELOCATION");
    assert.equal(normalizeQuestionKey("If you join our company, what is your available start date?"), "START_DATE");
    assert.equal(normalizeQuestionKey("Are you in Bangalore now? If not, do you have any willingness or plan to move to Bangalore?"), "RELOCATION_DETAILS");
    assert.equal(normalizeQuestionKey("How many years of work experience?"), "TOTAL_EXPERIENCE");
    assert.equal(normalizeQuestionKey("Town"), "CURRENT_LOCATION");
    assert.equal(normalizeQuestionKey("Personal Summary Use it to tell us a little more about yourself."), "PERSONAL_SUMMARY");
    assert.equal(normalizeQuestionKey("Separate each skill with a comma."), "SKILLS");
    assert.equal(normalizeQuestionKey("Why are you interested?"), "WHY_INTERESTED");
    assert.equal(normalizeQuestionKey("Do you hold a security clearance?"), "DO_YOU_HOLD_A_SECURITY_CLEARANCE");
});

test("pauses when a profile answer cannot exactly satisfy employer choices", async () => {
    const result = await resolveQuestion("How many years of work experience?", {
        profile: { totalExperienceYears: 3.5 },
        field: { type: "radio", options: [{ value: "3", label: "3" }, { value: "4", label: "4" }] }
    });
    assert.equal(result.requiresUserInput, true);
    assert.equal(result.answer, null);
    assert.equal(result.source, "USER_REQUIRED");
});

test("uses the profile CTC for Lever's visual CTC label", async () => {
    const result = await resolveQuestion("Current(or last) CTC ✱", {
        profile: { currentCTC: 14 }, field: { type: "textarea" }
    });
    assert.equal(result.normalizedKey, "CURRENT_CTC");
    assert.equal(result.answer, "14");
    assert.equal(result.source, "PROFILE");
});

test("does not generate an AI answer for a start-date question", async () => {
    const result = await resolveQuestion("What is your available start date?", {
        profile: {}, field: { type: "text" }
    });
    assert.equal(result.normalizedKey, "START_DATE");
    assert.equal(result.requiresUserInput, true);
    assert.equal(result.answer, null);
});

test("does not put a country into Abnormal's city field", async () => {
    const result = await resolveQuestion("CURRENT_LOCATION", {
        profile: { currentLocation: "India" }, field: { label: "Location (City)*", type: "text" }
    });
    assert.equal(result.requiresUserInput, true);
    assert.equal(result.answer, null);
});

test("uses the LinkedIn URL already grounded in the resume", async () => {
    const result = await resolveQuestion("LINKEDIN_URL", {
        profile: {}, resume: { linkedin: "https://www.linkedin.com/in/example" }, field: { label: "LinkedIn Profile", type: "url" }
    });
    assert.equal(result.answer, "https://www.linkedin.com/in/example");
    assert.equal(result.source, "RESUME");
});

test("uses the verified resume summary without an AI call", async () => {
    const result = await resolveQuestion("PERSONAL_SUMMARY", {
        profile: {}, resume: { summary: "Backend engineer focused on reliable distributed systems." },
        field: { label: "Personal Summary", type: "textarea" }, allowAi: false
    });
    assert.equal(result.answer, "Backend engineer focused on reliable distributed systems.");
    assert.equal(result.source, "RESUME");
    assert.equal(result.requiresUserInput, false);
});

test("structured resume history is deterministic and never AI generated", async () => {
    const resume = {
        experience: [{ title: "Team Lead", company: "Vidyakul", startDate: "2026-03", endDate: "Present", bullets: ["Led backend systems."] }],
        education: [{ school: "Thapar Institute", degree: "B.E. in Computer Science", startDate: "2019-08", endDate: "2023-06" }]
    };
    const title = await resolveQuestion("EXPERIENCE_TITLE", { profile: {}, resume, field: { label: "Title", type: "text", sectionKind: "experience" } });
    const description = await resolveQuestion("EXPERIENCE_DESCRIPTION", { profile: {}, resume, field: { label: "Description", type: "textarea", sectionKind: "experience" } });
    const school = await resolveQuestion("EDUCATION_INSTITUTION", { profile: {}, resume, field: { label: "Institution", type: "text", sectionKind: "education" } });
    const roleStart = await resolveQuestion("EXPERIENCE_START_DATE", { profile: {}, resume, field: { label: "From", type: "text", sectionKind: "experience" } });
    const educationEnd = await resolveQuestion("EDUCATION_END_DATE", { profile: {}, resume, field: { label: "To", type: "text", sectionKind: "education" } });
    assert.deepEqual([title.answer, description.answer, school.answer, roleStart.answer, educationEnd.answer],
        ["Team Lead", "Led backend systems.", "Thapar Institute", "2026-03", "2023-06"]);
    assert.deepEqual([title.source, description.source, school.source, roleStart.source, educationEnd.source],
        ["RESUME", "RESUME", "RESUME", "RESUME", "RESUME"]);
    assert.equal(aiGenerationEligible("DESCRIPTION", { label: "Description", type: "textarea", sectionKind: "experience" }), false);
});

test("Greenhouse repeatable date parts, degree, source, and career stage resolve deterministically", async () => {
    const profile = { totalExperienceYears: 3.6, addressCity: "Gurugram", currentLocation: "India", currentIndustry: "Edtech" };
    const resume = {
        experience: [{ company: "Vidyakul", title: "Team Lead", startDate: "2026-03", endDate: "Present" }],
        education: [{ degree: "B.E. in Computer Science", startDate: "2019-08", endDate: "2023-06" }]
    };
    const startMonth = await resolveQuestion("EXPERIENCE_START_DATE", { profile, resume, field: { label: "Start date month", type: "combobox", sectionKind: "experience", sectionIndex: 0 } });
    const startYear = await resolveQuestion("EXPERIENCE_START_DATE", { profile, resume, field: { label: "Start date year", type: "combobox", sectionKind: "experience", sectionIndex: 0 } });
    const degree = await resolveQuestion("EDUCATION_DEGREE", { profile, resume, field: { label: "Degree", type: "combobox", sectionKind: "education", sectionIndex: 0 } });
    const stage = await resolveQuestion("Current Career Stage", { profile, resume, field: { label: "Current Career Stage", type: "combobox" } });
    const industry = await resolveQuestion("Current Industry", { profile, resume, field: { label: "Current Industry", type: "combobox" } });
    const city = await resolveQuestion("Current Location", { profile, resume, field: { label: "City", type: "text" } });
    const source = await resolveQuestion("Source", { profile, resume, job: { source: "LinkedIn" }, field: { label: "Source", type: "combobox" } });
    assert.deepEqual([startMonth.answer, startYear.answer, degree.answer, stage.answer, industry.answer, city.answer, source.answer],
        ["March", "2026", "Bachelor’s Degree", "Experienced Professional", "Edtech", "Gurugram", "LinkedIn"]);
    assert.equal(source.source, "JOB_SOURCE");
});

test("Phenom skills are deterministic resume facts and never AI generated", async () => {
    const result = await resolveQuestion("SKILLS", {
        profile: {}, resume: { skills: ["Node.js", "AWS", "Node.js"] },
        field: { label: "Separate each skill with a comma.", type: "textarea" }, allowAi: false
    });
    assert.equal(result.answer, "Node.js, AWS");
    assert.equal(result.source, "RESUME");
    assert.equal(result.requiresUserInput, false);
    assert.equal(aiGenerationEligible("SKILLS", { label: "Separate each skill with a comma.", type: "textarea" }), false);
});

test("AI is allowed only for explicit writing prompts, never unknown profile fields", () => {
    assert.equal(aiGenerationEligible("WHY_INTERESTED", { label: "Why are you interested?", type: "textarea" }), true);
    assert.equal(aiGenerationEligible("FACEBOOK", { label: "Facebook", type: "text" }), false);
    assert.equal(aiGenerationEligible("CUSTOM_FIELD", { label: "Unrecognized", type: "text" }), false);
    assert.equal(aiGenerationEligible("CUSTOM_FIELD", { label: "Let the company know about your interest", type: "textarea" }), true);
});

test("unverified social and website fields remain empty even when AI answers are enabled", async () => {
    for (const label of ["Facebook", "X (fka Twitter)", "Website"]) {
        const result = await resolveQuestion(label, {
            profile: { linkedinUrl: "https://www.linkedin.com/in/example" },
            resume: { linkedin: "https://www.linkedin.com/in/example" },
            field: { label, type: "text" }, allowAi: true
        });
        assert.equal(result.answer, null, `${label} must not borrow another URL or an AI essay`);
        assert.equal(result.requiresUserInput, true);
    }
});

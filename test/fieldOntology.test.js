import assert from "node:assert/strict";
import test from "node:test";
import {
    contextualMappingPrompt,
    inferFieldSemantic,
    mappingChoices,
    MAX_MAPPING_QUESTIONS,
    shouldAskMappingQuestion
} from "../src/services/fieldOntology.js";

const abnormalFields = new Map([
    ["First Name", "FIRST_NAME"],
    ["Last Name", "LAST_NAME"],
    ["Preferred First Name", "PREFERRED_FIRST_NAME"],
    ["Email", "EMAIL"],
    ["Country", "COUNTRY"],
    ["Phone", "PHONE"],
    ["Location (City)*", "CURRENT_LOCATION"],
    ["Town", "CURRENT_LOCATION"],
    ["Zip Code / Postal Code", "POSTAL_CODE"],
    ["LinkedIn Profile", "LINKEDIN_URL"],
    ["Facebook", "SOCIAL_FACEBOOK_URL"],
    ["X (fka Twitter)", "SOCIAL_TWITTER_URL"],
    ["Current Company", "CURRENT_COMPANY"],
    ["Are you currently eligible to work in this country?", "WORK_AUTHORIZATION"],
    ["Will you now or in the future require immigration sponsorship?", "SPONSORSHIP"],
    ["Are you currently an employee or contractor?", "CURRENT_EMPLOYEE"],
    ["Have you previously worked for this employer?", "PREVIOUS_EMPLOYEE"],
    ["Previous Employment Type", "PREVIOUS_EMPLOYMENT_TYPE"],
    ["Can you meet this hybrid working requirement?", "WORK_MODE_REQUIREMENT"],
    ["Personal Summary Use it to tell us a little more about yourself.", "PERSONAL_SUMMARY"],
    ["Are you currently working for an existing DAZN entity?", "CURRENT_EMPLOYEE"]
]);

test("Abnormal Greenhouse labels map to the finite candidate-data ontology", () => {
    for (const [label, expected] of abnormalFields) {
        const inferred = inferFieldSemantic({ label });
        assert.equal(inferred.key, expected, label);
        assert.equal(inferred.obvious, true, label);
    }
});

test("visible labels and stable structural leaves remain semantic across rescans", () => {
    for (const [field, key] of [
        [{ label: "First Name", name: "application_form[application][first_name]" }, "FIRST_NAME"],
        [{ label: "India", name: "application_form[application][country]" }, "COUNTRY"],
        [{ label: "Email Address", portalFieldKey: "application.email" }, "EMAIL"]
    ]) {
        const result = inferFieldSemantic(field);
        assert.equal(result.key, key);
        assert.equal(result.obvious, true);
    }
});

test("mapping questions provide context, bounded choices, and no free-text fallback", () => {
    const inference = inferFieldSemantic({ label: "Home base" });
    const prompt = contextualMappingPrompt("Home base", inference);
    const options = mappingChoices(inference);
    assert.match(prompt, /Home base/);
    assert.match(prompt, /Is that right\?/);
    assert.doesNotMatch(prompt, /^What does this field represent\?$/);
    assert.ok(options.length <= 5);
    assert.equal(options.at(-1).value, "CUSTOM_FIELD");
    assert.equal(options.at(-1).label, "None of these");
});

test("Teach Mode asks at most two mapping questions", () => {
    const inference = inferFieldSemantic({ label: "Unfamiliar employer detail" });
    assert.equal(MAX_MAPPING_QUESTIONS, 2);
    assert.equal(shouldAskMappingQuestion(inference, 0), true);
    assert.equal(shouldAskMappingQuestion(inference, 1), true);
    assert.equal(shouldAskMappingQuestion(inference, 2), false);
    assert.equal(shouldAskMappingQuestion(inferFieldSemantic({ label: "Zip Code" }), 0), false);
});

test("known employer yes/no details expose bounded choices", () => {
    for (const label of [
        "Are you currently eligible to work in this country?",
        "Will you require immigration sponsorship?",
        "Are you currently an employee or contractor?",
        "Can you meet this hybrid working requirement?"
    ]) assert.deepEqual(inferFieldSemantic({ label }).options, ["Yes", "No"]);
});

test("repeatable ATS labels are scoped to resume history", () => {
    assert.equal(inferFieldSemantic({ label: "Title", sectionKind: "experience" }).key, "EXPERIENCE_TITLE");
    assert.equal(inferFieldSemantic({ label: "Job Title*", sectionKind: "experience" }).key, "EXPERIENCE_TITLE");
    assert.equal(inferFieldSemantic({ label: "Description", sectionKind: "experience" }).key, "EXPERIENCE_DESCRIPTION");
    assert.equal(inferFieldSemantic({ label: "Institution", sectionKind: "education" }).key, "EDUCATION_INSTITUTION");
    assert.equal(inferFieldSemantic({ label: "From", sectionKind: "education" }).key, "EDUCATION_START_DATE");
    assert.equal(inferFieldSemantic({ label: "Separate each skill with a comma." }).key, "SKILLS");
    assert.equal(inferFieldSemantic({ label: "Company name*", sectionKind: "experience" }).key, "EXPERIENCE_COMPANY");
    assert.equal(inferFieldSemantic({ label: "Start date month", sectionKind: "experience" }).key, "EXPERIENCE_START_DATE");
    assert.equal(inferFieldSemantic({ label: "End date year", sectionKind: "education" }).key, "EDUCATION_END_DATE");
    assert.equal(inferFieldSemantic({ label: "Years of Expereince*" }).key, "TOTAL_EXPERIENCE");
});

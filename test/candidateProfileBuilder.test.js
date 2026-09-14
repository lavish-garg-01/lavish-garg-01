import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidateResumeProfile, totalExperienceYears } from "../src/services/candidateProfileBuilder.js";
import { CANDIDATE_PERSONAS, personaResumeText } from "./fixtures/candidate-personas.js";

const resume = {
    fullName: "Asha Rao",
    email: "asha@example.com",
    phone: "9876543210",
    location: "Bengaluru, India",
    linkedin: "https://www.linkedin.com/in/asharao",
    github: "https://github.com/asharao",
    summary: "Backend engineer building reliable services.",
    skills: ["Node.js", "PostgreSQL", "AWS", "Docker"],
    skillGroups: { backend: ["Node.js", "PostgreSQL"], cloud: ["AWS", "Docker"] },
    experience: [
        { title: "Senior Backend Engineer", company: "Acme", startDate: "2023-01", endDate: "Present", bullets: ["Built APIs."] },
        { title: "Backend Engineer", company: "Beta", startDate: "2021-01", endDate: "2022-12", bullets: ["Owned services."] }
    ],
    education: [{ school: "Example Institute", degree: "B.Tech Computer Science", startDate: "2017-08", endDate: "2021-06" }]
};

test("resume profile builder returns structured facts, timelines, skills and search suggestions", () => {
    const text = `Asha Rao\nasha@example.com · 9876543210\nhttps://www.linkedin.com/in/asharao\nhttps://github.com/asharao\nNode.js PostgreSQL AWS Docker\nSenior Backend Engineer Acme\nExample Institute`;
    const profile = buildCandidateResumeProfile({ text, existingResume: resume });
    assert.equal(profile.contact.fullName, "Asha Rao");
    assert.equal(profile.contact.email, "asha@example.com");
    assert.equal(profile.contact.github, "https://github.com/asharao");
    assert.equal(profile.experience.length, 2);
    assert.equal(profile.education.length, 1);
    assert.ok(profile.skills.includes("Node.js"));
    assert.ok(profile.skills.every((skill) => !/[()]$|\($/.test(skill)), "display fragments are not stored as skills");
    assert.ok(!profile.searchSuggestions.targetRoles.includes("Freelancer"));
    assert.ok(!profile.searchSuggestions.targetRoles.includes("Developer"));
    assert.ok(profile.searchSuggestions.targetRoles.includes("Backend Engineer"));
    assert.ok(profile.preferredSkills.length > 0);
    assert.equal(profile.source, "PDF_TEXT_PLUS_VERIFIED_MASTER");
    assert.equal(profile.evidence.sectionSources.experience, "VERIFIED_MASTER_FALLBACK");
    assert.equal(profile.extraction.canonicalFallbackUsed, true);
    assert.equal(profile.reviewRequired, false);
});

test("experience duration merges overlapping roles instead of double counting", () => {
    assert.equal(totalExperienceYears([
        { startDate: "2020-01", endDate: "2021-12" },
        { startDate: "2021-01", endDate: "2022-12" }
    ]), 3);
});

test("an unrelated PDF never inherits another candidate's structured employment", () => {
    const profile = buildCandidateResumeProfile({
        text: "Different Person\ndifferent@example.com\nPython AWS PostgreSQL",
        existingResume: resume
    });
    assert.equal(profile.experience.length, 0);
    assert.equal(profile.education.length, 0);
    assert.equal(profile.source, "PDF_TEXT");
    assert.equal(profile.reviewRequired, true);
});

test("layout parser handles numeric date ranges and keeps PDF evidence instead of hiding behind canonical data", () => {
    const profile = buildCandidateResumeProfile({
        text: `Asha Rao\nasha@example.com\nWORK EXPERIENCE\nBackend Engineer, NewCo\n01/2022 - Present\n• Built Node.js and PostgreSQL services used by customers.\nEDUCATION\nB.Tech Computer Science\nExample Institute\n08/2017 - 06/2021\nSKILLS\nNode.js PostgreSQL`,
        existingResume: resume
    });
    assert.equal(profile.experience[0].company, "NewCo");
    assert.equal(profile.evidence.sectionSources.experience, "PDF_LAYOUT_TEXT");
    assert.equal(profile.evidence.sectionSources.education, "PDF_LAYOUT_TEXT");
    assert.equal(profile.extraction.canonicalFallbackUsed, false);
});

test("resume onboarding stays grounded across eight representative candidate personas", () => {
    assert.equal(CANDIDATE_PERSONAS.length, 8);
    for (const persona of CANDIDATE_PERSONAS) {
        const profile = buildCandidateResumeProfile({
            text: personaResumeText(persona),
            existingResume: { ...persona, fullName: persona.name, linkedin: persona.linkedinUrl, github: persona.githubUrl, portfolio: persona.portfolioUrl }
        });
        assert.equal(profile.contact.fullName, persona.name, persona.id);
        assert.equal(profile.contact.email, persona.email, persona.id);
        assert.equal(profile.experience.length, persona.experience.length, persona.id);
        assert.equal(profile.education.length, persona.education.length, persona.id);
        assert.deepEqual(
            [...profile.skills].sort(),
            persona.skills.filter((skill) => profile.skills.includes(skill)).sort(),
            persona.id
        );
        assert.equal(profile.source, "PDF_TEXT_PLUS_VERIFIED_MASTER", persona.id);
        assert.equal(profile.reviewRequired, false, persona.id);
        assert.ok(profile.searchSuggestions.targetRoles.length > 0 || persona.experience.length === 0, persona.id);
    }
});

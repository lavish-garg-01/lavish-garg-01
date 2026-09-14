import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    applySupportBadgeClass,
    applySupportForJob,
    buildAssistCards,
    detectApplySurface,
    extractAssistQuestions,
    resolveAssistSession
} from "../src/services/applySupport.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("listing jobs advertise Autofill, Partial, or Assist before the candidate opens Apply", () => {
    assert.equal(applySupportForJob({ url: "https://boards.greenhouse.io/acme/jobs/1" }).mode, "AUTOFILL");
    assert.equal(applySupportForJob({ url: "https://jobs.smartrecruiters.com/oneclick-ui/company/acme/publication/1" }).mode, "AUTOFILL");
    assert.equal(applySupportForJob({ url: "https://www.naukri.com/job-listings-x" }).mode, "PARTIAL");
    assert.equal(applySupportForJob({ url: "https://www.linkedin.com/jobs/view/123" }).mode, "PARTIAL");
    assert.equal(applySupportForJob({ url: "https://www.instahyre.com/job/1" }).mode, "PARTIAL");
    assert.equal(applySupportForJob({ url: "https://jobs.lever.co/acme/role" }).label, "Autofill");
    assert.equal(applySupportForJob({ source: "direct_ats", url: "https://careers.unknown.example/apply" }), null);
    assert.match(applySupportBadgeClass("PARTIAL"), /amber/);
    assert.match(applySupportForJob({ source: "naukri" }).reason, /company website/i);
});

test("Naukri chat and LinkedIn Easy Apply resolve to Assist with copyable profile answers", () => {
    const naukriPage = [
        "Hi Lavish Garg, thank you for showing interest. Kindly answer all the recruiter's questions to successfully apply for the job.",
        "How many years of experience do you have in Backend Development?",
        "Type message here...",
        "Save"
    ].join("\n");
    const naukri = resolveAssistSession({
        url: "https://www.naukri.com/job-listings-airtel",
        pageText: naukriPage,
        portalKind: "naukri",
        questions: ["How many years of experience do you have in Backend Development?"],
        profile: { totalExperienceYears: 7, currentLocation: "Gurugram", currentCTC: "32 LPA", noticePeriodDays: 30, phone: "9999999999", email: "a@b.com" }
    });
    assert.equal(naukri.applySupport.mode, "ASSIST");
    assert.equal(naukri.applySupport.surface, "chat_apply");
    const current = naukri.cards.find((card) => card.kind === "current");
    assert.equal(current.semanticKey, "TOTAL_EXPERIENCE");
    assert.equal(current.copy, "7");
    assert.equal(current.display, "7 years");
    assert.equal(current.missing, false);
    assert.equal(naukri.cards.some((card) => card.semanticKey === "CURRENT_CTC" && card.copy === "32 LPA"), true);

    const linkedinListing = detectApplySurface({
        url: "https://www.linkedin.com/jobs/view/123",
        pageText: "Easy Apply  Apply on company website",
        portalKind: "linkedin"
    });
    assert.equal(linkedinListing.mode, "PARTIAL");

    const easyApply = detectApplySurface({
        url: "https://www.linkedin.com/jobs/view/123/easy-apply",
        portalKind: "linkedin",
        easyApplyUi: true
    });
    assert.equal(easyApply.mode, "ASSIST");
    assert.equal(easyApply.surface, "easy_apply");

    const employerForm = detectApplySurface({
        url: "https://boards.greenhouse.io/acme/jobs/1",
        hasLikelyForm: true
    });
    assert.equal(employerForm.mode, "AUTOFILL");
    assert.equal(employerForm.surface, "employer_form");

    const smartRecruiters = detectApplySurface({
        url: "https://jobs.smartrecruiters.com/oneclick-ui/company/acme/publication/1",
        portalKind: "smartrecruiters",
        hasLikelyForm: true
    });
    assert.equal(smartRecruiters.mode, "AUTOFILL");
    assert.equal(smartRecruiters.platformId, "smartrecruiters");
});

test("assist question extraction prefers recruiter questions and ignores the greeting", () => {
    const questions = extractAssistQuestions(`
        Hi there, thank you for showing interest. Kindly answer all the recruiter's questions.
        How many years of experience do you have in Backend Development?
        What is your notice period?
    `);
    assert.deepEqual(questions, [
        "How many years of experience do you have in Backend Development?",
        "What is your notice period?"
    ]);
    const cards = buildAssistCards({
        questions: ["How many years of experience do you have in Node.js?"],
        profile: { totalExperienceYears: 7 }
    });
    const current = cards.find((card) => card.kind === "current");
    assert.equal(current.missing, true);
    assert.notEqual(current.semanticKey, "TOTAL_EXPERIENCE");
});

test("dashboard, COPILOT, Attention, and sidecar render support-mode badges and assist copy", () => {
    const dashboard = read("src/views/index.ejs");
    const copilot = read("src/views/copilot.ejs");
    const attention = read("src/views/attention.ejs");
    const panelJs = read("extension/sidepanel.js");
    const content = read("extension/content.js");
    const background = read("extension/background.js");
    const routes = read("src/routes/extension.js");
    assert.match(dashboard, /applySupportOf\(job\)/);
    assert.match(dashboard, /selectedSupport\.title/);
    assert.match(copilot, /applySupportOf\(job\)/);
    assert.match(attention, /session\.applySupport\.label/);
    assert.match(panelJs, /function assistMarkup/);
    assert.match(panelJs, /Assist mode/);
    assert.match(panelJs, /data-assist-key/);
    assert.match(panelJs, /RECORD_ASSIST_COPY/);
    assert.match(content, /function enterAssistMode/);
    assert.match(content, /function localApplySurface/);
    assert.match(content, /applySurface\.mode === "ASSIST"/);
    assert.match(read("extension/adapters/common/hops.js"), /type: "RESOLVE_ASSIST"/);
    assert.match(background, /RESOLVE_ASSIST/);
    assert.match(background, /RECORD_ASSIST_COPY/);
    assert.match(routes, /\/api\/extension\/jobs\/:id\/assist/);
    assert.match(routes, /ASSIST_VALUE_COPIED/);
});

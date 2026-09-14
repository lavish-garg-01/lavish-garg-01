import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Phase 0A has one authoritative policy and no per-application learning prompt", () => {
    const adr = read("docs/adr/0001-answer-learning-and-application-authorization.md");
    const repository = read("src/repositories/learningRepository.js");
    const panel = read("extension/sidepanel.js");
    const content = read("extension/content.js");

    assert.match(adr, /USER_CORRECTED.*neutral/);
    assert.match(adr, /Verified submission/);
    assert.match(adr, /Do not learn from this application/);
    assert.match(adr, /Final employer submission.*candidate action/);
    assert.match(repository, /promptRequired: false/);
    assert.match(repository, /globalConsent && !learningDisabledForApplication/);
    assert.match(panel, /Do not learn from this application/);
    assert.doesNotMatch(content, /Help COPILOT learn\?|Always allow|Not this time/);
    assert.doesNotMatch(panel, /reuseConsent\?\.promptRequired/);
});

test("Phase 0A copy distinguishes current manual declarations from reusable memory", () => {
    const files = [
        "README.md", "extension/README.md", "docs/PROJECT_CONTEXT.md",
        "docs/DEPLOYMENT_CHECKLIST.md", "src/views/onboarding.ejs",
        "src/views/copilot.ejs", "src/views/reliability.ejs", "web/app/app/jobs/page.tsx"
    ].map(read).join("\n");
    assert.match(files, /application-specific/i);
    assert.match(files, /never reusable|never.*reusable/i);
    assert.match(files, /current build/i);
    assert.match(files, /final submit|final submission/i);
    assert.doesNotMatch(files, /asks again on the next application|Always allow/);
});

test("current field entry cannot immediately mutate future candidate memory", () => {
    const routes = read("src/routes/extension.js");
    const manualStart = routes.indexOf('router.post("/api/extension/jobs/:id/manual-input"');
    const manualEnd = routes.indexOf("router.", manualStart + 20);
    const manual = routes.slice(manualStart, manualEnd);
    assert.match(manual, /const promoted = false/);
    assert.match(manual, /pendingLearning/);
    assert.doesNotMatch(manual, /UPDATE candidate_profiles|saveCandidateFact|saveCandidateAnswer/);
});

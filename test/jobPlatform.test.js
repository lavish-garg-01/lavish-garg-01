import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { jobPlatform, platformBadgeClass } from "../src/services/jobPlatform.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("major boards and ATS hosts resolve to a visible platform tag", () => {
    assert.deepEqual(jobPlatform({ url: "https://www.linkedin.com/jobs/view/123" }), { id: "linkedin", label: "LinkedIn" });
    assert.deepEqual(jobPlatform({ url: "https://in.indeed.com/viewjob?jk=abc" }), { id: "indeed", label: "Indeed" });
    assert.deepEqual(jobPlatform({ source: "naukri" }), { id: "naukri", label: "Naukri" });
    assert.deepEqual(jobPlatform({ source: "jobspy", url: "https://www.linkedin.com/jobs/view/999" }), { id: "linkedin", label: "LinkedIn" });
    assert.deepEqual(jobPlatform({ url: "https://boards.greenhouse.io/postman/jobs/1" }), { id: "greenhouse", label: "Greenhouse" });
    assert.deepEqual(jobPlatform({ url: "https://jobs.lever.co/acme/role" }), { id: "lever", label: "Lever" });
    assert.deepEqual(jobPlatform({ url: "https://jobs.smartrecruiters.com/oneclick-ui/company/acme/publication/1" }), { id: "smartrecruiters", label: "SmartRecruiters" });
    assert.equal(jobPlatform({ source: "direct_ats", url: "https://careers.unknown-corp.example/apply" }), null);
    assert.match(platformBadgeClass("linkedin"), /bg-\[#0a66c2\]/);
    assert.match(platformBadgeClass({ id: "unknown" }), /bg-slate-700/);
});

test("dashboard, COPILOT, Attention, and sidecar all render major-platform tags", () => {
    const dashboard = read("src/views/index.ejs");
    const copilot = read("src/views/copilot.ejs");
    const attention = read("src/views/attention.ejs");
    const panelJs = read("extension/sidepanel.js");
    const routes = read("src/routes/extension.js");
    assert.match(dashboard, /const listPlatform = platformOf\(job\)/);
    assert.match(dashboard, /selectedPlatform\.label/);
    assert.match(dashboard, /selectedSupport && selectedSupport\.mode !== 'AUTOFILL'/);
    assert.match(copilot, /const jobTag = platformOf\(job\)/);
    assert.match(copilot, /platformOf\(\{ source: application\.job_source, url: application\.job_url \}\)/);
    assert.match(attention, /session\.platform\.label/);
    assert.match(panelJs, /const platform = data\.currentPlatform \|\| data\.job\.platform/);
    assert.match(panelJs, /platform \? `<span class="platform-tag">/);
    assert.match(routes, /platform: jobPlatform\(job\)/);
});

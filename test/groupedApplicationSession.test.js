import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("application sessions use one dashboard-grouped tab and keep COPILOT scoped to it", () => {
    const manifest = JSON.parse(read("extension/manifest.json"));
    const background = read("extension/background.js");
    const content = read("extension/content.js");
    assert.ok(manifest.permissions.includes("tabGroups"));
    assert.match(background, /chrome\.tabs\.group\(\{ tabIds: \[dashboardTabId, applicationTabId\] \}\)/);
    assert.match(background, /Job Hunter · Applying/);
    assert.match(background, /OPEN_GROUPED_APPLICATION/);
    assert.match(background, /existingSession\.activeJob && existingSession\.activeTabId && existingSession\.activeTabId !== tabId\) return null/);
    assert.match(background, /setSidePanelEnabled\(dashboardTabId, false\)/);
    assert.match(background, /setSidePanelEnabled\(applicationTabId, true\)/);
    assert.match(background, /Never re-enable COPILOT on the Job Hunter applications\/dashboard tab/);
    assert.match(background, /isOrdinaryDashboardUrl\(tabUrl\)/);
    assert.match(background, /chrome\.tabs\.onActivated/);
    assert.match(background, /function consumeGestureToOpenSidePanel/);
    assert.match(background, /chrome\.sidePanel\.open\(\{ windowId: sender\.tab\.windowId \}\)/);
    assert.match(background, /chrome\.tabs\.create\(\{ url: "about:blank", active: true, windowId: dashboardWindowId \}\)/);
    assert.match(background, /request\("\/api\/extension\/launches\/issue"/);
    assert.match(background, /request\("\/api\/extension\/launches\/consume"/);
    assert.match(background, /chrome\.tabs\.update\(applicationTab\.id, \{ url: target, active: true \}\)/);
    assert.match(background, /chrome\.sidePanel\.open\(\{ tabId: applicationTab\.id \}\)/);
    assert.match(background, /setTimeout\(\(\) => clearSidePanelHandoff\(dashboardTabId\), 4000\)/);
    assert.match(background, /injectIntoActiveApplication\(applicationTab\.id, target\)/);
    assert.match(background, /prepareExtensionApplication/);
    assert.doesNotMatch(background, /permissions\.request\(\{ origins: ALL_JOB_SITE_ORIGINS \}\)/);
    assert.match(background, /beginSidePanelHandoff\(dashboardTabId\)/);
    assert.match(background, /clearSidePanelHandoff\(dashboardTabId\)/);
    assert.match(content, /addEventListener\("submit", interceptOpenWithExtension, true\)/);
    assert.match(content, /prepare: true/);
    assert.match(content, /const originalButtonText = button\?\.textContent/);
    assert.match(content, /button\.textContent = originalButtonText/);
    assert.doesNotMatch(content, /ENSURE_JOB_SITE_ACCESS/);
    assert.match(content, /Side panel is the default COPILOT UI/);
    assert.match(content, /job-hunter-open-application/);
    assert.match(content, /job-hunter-applying-strip/);
    assert.doesNotMatch(background, /stored\.dashboardTabId[\s\S]{0,120}enabled: true/);
    assert.match(background, /function openDashboardSurface/);
    assert.match(background, /case "OPEN_DASHBOARD_SURFACE"/);
    assert.match(background, /Dashboard surfaces can only be opened from the trusted side panel/);
    assert.match(background, /if \(stored\.activeTabId\) \{\s*await groupApplicationTabs\(dashboardTab\.id, stored\.activeTabId\)/);
    assert.match(background, /setSidePanelEnabled\(dashboardTab\.id, false\)/);
});

test("the React jobs workspace launches through the extension bridge and can skip preflight", () => {
    const manifest = JSON.parse(read("extension/manifest.json"));
    const background = read("extension/background.js");
    const jobsPage = read("web/app/app/jobs/page.tsx");
    for (const origin of ["http://127.0.0.1:3000/*", "http://localhost:3000/*"]) {
        assert.ok(manifest.host_permissions.includes(origin));
        assert.ok(manifest.content_scripts[0].matches.includes(origin));
    }
    assert.match(background, /"http:\/\/127\.0\.0\.1:3000"/);
    assert.match(background, /"http:\/\/localhost:3000"/);
    assert.match(jobsPage, /data-open-with-extension="true"/);
    assert.match(jobsPage, /data-job-url=\{job\.url\}/);
    assert.match(jobsPage, /job-hunter\.application-preflight\.hidden\.v1/);
    assert.match(jobsPage, /Don’t show this preflight again/);
    assert.match(jobsPage, /Preflight hidden · Show again/);
    assert.doesNotMatch(jobsPage, /href=\{selected\.url\}/);
});

test("new application navigation targets are folded back into the active application tab", () => {
    const background = read("extension/background.js");
    const targetHandler = background.slice(background.indexOf("chrome.webNavigation.onCreatedNavigationTarget"), background.indexOf("chrome.webNavigation.onCompleted"));
    assert.match(targetHandler, /pendingChildTabs\.set\(details\.tabId, details\.sourceTabId\)/);
    assert.match(targetHandler, /foldCreatedNavigationTarget\(details\.sourceTabId, details\.tabId, details\.url\)/);
    assert.doesNotMatch(targetHandler, /activeTabId: details\.tabId/);
    assert.match(background, /function shouldDeferChildFold/);
    assert.match(background, /function settleDeferredChildFold/);
    assert.match(background, /isNaukriRedirectReceipt\(details\.url\)/);
});

test("switching, closing, and dashboard return preserve unfinished work in Attention Center", () => {
    const background = read("extension/background.js");
    const routes = read("src/routes/extension.js");
    const attention = read("src/views/attention.ejs");
    assert.match(background, /SWITCHED_TO_ANOTHER_APPLICATION/);
    assert.match(background, /APPLICATION_TAB_CLOSED/);
    assert.match(background, /RETURNED_TO_DASHBOARD/);
    assert.match(background, /CANDIDATE_FINISHED_LATER/);
    assert.match(background, /\/api\/extension\/session\/pending-review/);
    assert.match(routes, /fieldId: "__submission_review__"/);
    assert.match(routes, /type: "SUBMISSION_REVIEW"/);
    assert.match(attention, /Mark submitted/);
    assert.match(background, /pendingSubmissionReview/);
    assert.match(background, /DISMISS_SUBMISSION_REVIEW/);
    assert.match(background, /pendingSubmissionReview\?\.jobId/);
});

test("verified or candidate-confirmed submission closes only the application tab and focuses dashboard", () => {
    const background = read("extension/background.js");
    assert.match(background, /finishApplicationSession\(sender\.tab\?\.id\)/);
    assert.match(background, /case "CONFIRM_ACTIVE_SUBMITTED"/);
    assert.match(background, /candidateVerified: true/);
    assert.match(background, /closeApplicationTab\(applicationTabId\)/);
    assert.match(background, /focusDashboard\(stored\.dashboardTabId\)/);
});

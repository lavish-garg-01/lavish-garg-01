import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("document actions are live-target aware and preview dragging uses the same bridge", () => {
    const content = read("extension/content.js");
    const panel = read("extension/sidepanel.js");
    const background = read("extension/background.js");

    assert.match(content, /function liveDocumentTargets\(\)/);
    assert.match(content, /GET_DOCUMENT_TARGETS/);
    assert.match(content, /documentSurface/);
    assert.match(background, /liveDocumentTargets\(stored\.activeTabId\)/);
    assert.match(panel, /data\.documentTargets\?\.\[kind\]\?\.available && data\.tabMatchesApplication/);
    assert.match(panel, /class="preview-surface" draggable="true" data-drag-document=/);
    assert.match(panel, /querySelectorAll\("\[data-drag-document\]"\)/);
    assert.match(panel, /data-download-document/);
    assert.match(background, /chrome\.downloads\.download/);
});

test("document preview opens in the application group and returns through one controlled action", () => {
    const panel = read("extension/sidepanel.js");
    const background = read("extension/background.js");

    assert.match(background, /async function openGroupedDocumentTab/);
    assert.match(background, /applicationTab\.groupId >= 0/);
    assert.match(background, /documentPreviewContexts/);
    assert.match(background, /isDocumentPreview/);
    assert.match(background, /chrome\.tabs\.create\(\{ url, active: false/);
    assert.match(background, /setSidePanelEnabled\(previewTab\.id, true\)[\s\S]{0,120}chrome\.tabs\.update\(previewTab\.id, \{ active: true \}\)/);
    assert.match(background, /async function returnFromDocumentTab/);
    assert.match(background, /prewarmedDocuments\.delete/);
    assert.match(background, /searchParams\.get\("template"\)/);
    assert.match(background, /resume-selection/);
    assert.match(background, /REPLACE_RESUME_DOCUMENT/);
    assert.match(background, /pendingResumeReplacement/);
    assert.match(background, /preferredSidePanelView/);
    assert.match(background, /chrome\.tabs\.remove\(currentTabId\)/);
    assert.match(panel, /documentPreviewMode/);
    assert.match(panel, /Go to application tab/);
    assert.match(panel, /RETURN_FROM_DOCUMENT_TAB/);
    assert.doesNotMatch(panel.slice(panel.indexOf("const documentAction"), panel.indexOf("const closeQuickLook")), /OPEN_DASHBOARD_SURFACE/);
});

test("resume preview editor persists job-scoped additions and removals without editing the master", () => {
    const view = read("src/views/resumePreview.ejs");
    const dashboard = read("src/routes/dashboard.js");
    const renderer = read("src/services/resumeRenderer.js");

    assert.match(view, /Tailor this resume’s content/);
    assert.match(view, /name="resumeSummary"/);
    assert.match(view, /name="modifiedBullets"/);
    assert.match(view, /name="includedSkills"/);
    assert.match(view, /name="extraSkills"/);
    assert.match(view, /Save changes and regenerate/);
    assert.match(dashboard, /excludedSkills/);
    assert.match(dashboard, /generated_resume_path = NULL/);
    assert.match(renderer, /modifications\.excludedSkills/);
    assert.match(renderer, /groups\[key\] = .*filter/);
});

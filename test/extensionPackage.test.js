import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("extension package declares current-browser and iframe capabilities", () => {
    const manifest = JSON.parse(read("extension/manifest.json"));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, "1.15.8");
    assert.ok(manifest.permissions.includes("downloads"));
    assert.ok(manifest.permissions.includes("webNavigation"));
    assert.ok(manifest.permissions.includes("sidePanel"));
    assert.ok(manifest.permissions.includes("tabGroups"));
    assert.equal(manifest.side_panel.default_path, "sidepanel.html");
    assert.equal(manifest.action.default_popup, undefined);
    assert.equal(manifest.content_scripts[0].all_frames, true);
    assert.ok(manifest.permissions.includes("scripting"));
    assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
    assert.equal(manifest.host_permissions.includes("<all_urls>"), false);
    assert.equal(manifest.content_scripts[0].matches.includes("<all_urls>"), false);
    for (const localFrontend of ["http://127.0.0.1:3000/*", "http://localhost:3000/*"]) {
        assert.ok(manifest.host_permissions.includes(localFrontend));
        assert.ok(manifest.content_scripts[0].matches.includes(localFrontend));
    }
    assert.deepEqual(manifest.content_scripts[0].js, [
        "contracts/shared-contract-validator.js", "adapters/registry.js", "adapters/runtime.js",
        "adapters/common/shadow.js", "adapters/common/identity.js", "adapters/common/dates.js",
        "adapters/common/uploads.js", "adapters/common/repeatables.js", "adapters/common/hops.js",
        "runtime/scanner.js", "runtime/ownership.js", "runtime/executor.js", "runtime/verifier.js",
        "runtime/telemetry.js", "runtime/orchestrator.js", "content.js"
    ]);
});

test("dynamic site-script refresh is serialized and reconciles an existing registration", () => {
    const background = read("extension/background.js");
    assert.match(background, /let approvedSiteRefresh = Promise\.resolve\(\)/);
    assert.match(background, /const DYNAMIC_CONTENT_ID = "job-hunter-approved-sites-v2"/);
    assert.match(background, /LEGACY_DYNAMIC_CONTENT_IDS/);
    assert.match(background, /getRegisteredContentScripts\(\{ ids: \[DYNAMIC_CONTENT_ID\] \}\)/);
    assert.match(background, /updateContentScripts\(\[registration\]\)/);
    assert.match(background, /approvedSiteRefresh = approvedSiteRefresh\.catch\(\(\) => null\)\.then\(reconcileApprovedSiteScripts\)/);
    // Approved third-party sites are registered dynamically and must load the
    // same helper scripts as the bundled local-dashboard registration.
    for (const module of ["runtime/scanner.js", "runtime/ownership.js", "runtime/executor.js", "runtime/verifier.js", "runtime/telemetry.js", "runtime/orchestrator.js"]) {
        assert.match(background, new RegExp(module.replaceAll("/", "\\/").replaceAll(".", "\\.")));
    }
    assert.match(background, /GET_HOT_PATH/);
    assert.match(background, /function warmHotPath/);
    assert.match(background, /function mappingPackFor/);
});

test("extension and backend share progress and manual-fill contracts", () => {
    const background = read("extension/background.js");
    const content = read("extension/content.js");
    const routes = read("src/routes/extension.js");
    const dashboard = read("src/views/copilot.ejs");

    for (const status of ["OPENING", "FORM_DETECTED", "FIELDS_ANALYZED", "PLAN_READY", "FILLING", "WAITING_FOR_USER", "READY_TO_SUBMIT", "USER_ACTION_REQUIRED"]) {
        assert.match(routes, new RegExp(`(?:^|[\\s\"'])${status}(?:$|[\\s\"',])`));
    }
    assert.match(background, /FILL_CHILD_FRAMES/);
    assert.match(content, /FILL_FRAME/);
    assert.match(content, /activeApplication\?\.status === "OPENING"/);
    assert.match(content, /MARK_FILLED/);
    assert.match(dashboard, /Mark as filled/);
    assert.match(dashboard, /data-application-status/);
});

test("native sidecar keeps a simple autofill, documents, and profile interface", () => {
    const panel = read("extension/sidepanel.html");
    const panelJs = read("extension/sidepanel.js");
    const background = read("extension/background.js");
    const content = read("extension/content.js");
    const routes = read("src/routes/extension.js");
    for (const label of ["CURRENT STATE", "Autofill", "Documents", "Profile", "Ask AI", "AI answers", "Run autofill again", "Open Attention Center"]) assert.match(panel, new RegExp(label));
    for (const contract of ["document-preview", "Your active resumes", "SELECT_RESUME_VARIANT", "consecutiveRefreshFailures", "refreshRunning", "data-quick-look", "data-drag-document", "data-attach-document", "DOCUMENT_DRAG_START"]) assert.match(panelJs, new RegExp(contract));
    for (const removed of ["Undo Autofill", ">Stop<", ">Pause<"]) assert.doesNotMatch(panel, new RegExp(removed));
    assert.match(panel, /id="settings-button"/);
    assert.match(panelJs, /function settingsMarkup/);
    assert.match(panelJs, /activeView === "settings"/);
    assert.match(panelJs, /data-policy/);
    assert.match(panelJs, /OPEN_DASHBOARD_SURFACE/);
    assert.match(panel, /Use AI-generated application answers/);
    assert.doesNotMatch(panelJs, /chrome\.tabs\.create/);
    assert.match(panelJs, /GET_SIDECAR_STATE/);
    assert.match(background, /trusted extension pages/);
    assert.match(background, /SIDECAR_TAB_ACTION/);
    assert.match(background, /openPanelOnActionClick: true/);
    assert.match(background, /setOptions\(\{ path: "sidepanel\.html", enabled: true \}\)/);
    assert.match(panelJs, /Scan this page/);
    assert.match(panelJs, /Permission needed for this employer site/);
    assert.match(panelJs, /job-hunter-sidepanel/);
    assert.match(background, /FULL_ACCESS_GRANTED/);
    assert.doesNotMatch(background, /GRANT_SITE_ACCESS|grantSiteAccess/);
    assert.match(panelJs, /Allow Copilot on this employer site/);
    assert.match(panelJs, /Allow this employer site/);
    assert.match(panelJs, /chrome\.permissions\.request\(\{ origins: \[originPattern\] \}\)/);
    assert.match(panelJs, /data-grant-origin/);
    assert.doesNotMatch(panelJs, /Enable autofill on all job sites/);
    assert.match(background, /activateSiteAccess/);
    assert.match(content, /The in-page robot is a launcher only/);
    assert.match(content, /SIDECAR_VISIBILITY/);
    assert.match(content, /executePlan = false/);
    assert.match(content, /reportProgress\("PLAN_READY"/);
    assert.match(content, /ownership\.isUserActive/);
    assert.match(content, /undoAutofill/);
    for (const label of ["Application documents", "Create a fresh tailored resume", "Your active resumes", "Cover letter", "Your profile", "Edit profile in dashboard"]) assert.match(panelJs, new RegExp(label));
    assert.match(panel, /state-help/);
    assert.match(panelJs, /applicationSession/);
    assert.match(panelJs, /Need to review \(\$\{review\.length\}\)/);
    assert.match(panelJs, /Completed \(\$\{completed\.length\}\)/);
    assert.match(panelJs, /applicationSession\?\.fields/);
    assert.match(panelJs, /SET_AI_ENHANCEMENT/);
    assert.match(background, /SET_AI_ENHANCEMENT/);
    assert.match(background, /AI answers can only be changed from the trusted side panel/);
    assert.match(panelJs, /SIDEPANEL_ASK_AI/);
    assert.match(panelJs, /function assistantMarkup/);
    assert.match(panelJs, /Ask Job Hunter AI/);
    assert.match(background, /Ask AI is available only from the trusted side panel/);
    assert.match(background, /\/api\/extension\/assistant\/ask/);
    assert.match(routes, /router\.post\("\/api\/extension\/assistant\/ask"/);
    assert.match(background, /aiProcessingConsent/);
    assert.match(routes, /aiApplicationAnswers: canUseAiApplicationAnswers\(profile\)/);
    assert.match(panelJs, /\^\(\?:select\|textbox\|search/);
    assert.match(panelJs, /data-drag-document/);
    assert.match(panelJs, /Attach to form/);
    assert.match(background, /GET_COVER_LETTER_TEXT/);
    assert.match(background, /ATTACH_DOCUMENT/);
    assert.match(content, /isLabeledDocumentUpload/);
    assert.match(content, /DOCUMENT_DRAG_START/);
    assert.match(routes, /coverLetterText: job\.cover_letter/);
});

test("sidecar session summary exposes navigation and attachment outcomes without application values", () => {
    const routes = read("src/routes/extension.js");
    const start = routes.indexOf("function applicationSessionSummary");
    const end = routes.indexOf("function extensionProgress", start);
    const summary = routes.slice(start, end);
    assert.match(summary, /listAttemptTimeline\(applicationId\)/);
    assert.match(summary, /pageCount/);
    assert.match(summary, /documentsAttached/);
    assert.match(summary, /fieldId: field\.field_id/);
    assert.match(summary, /lastMessage/);
    assert.doesNotMatch(summary, /application_value|answer:/);
    assert.match(summary, /validation\.valid !== false/);
    assert.match(summary, /fill_outcome \|\| ""\)\.toUpperCase\(\) !== "INVALID"/);
    assert.match(routes, /applicationSession: applicationSessionSummary\(application\.id, plan\?\.pageUrl\)/);
});

test("employer-rejected manual values are quarantined from replay and reusable learning", () => {
    const routes = read("src/routes/extension.js");
    const start = routes.indexOf('router.post("/api/extension/jobs/:id/manual-input"');
    const end = routes.indexOf("router.", start + 20);
    const manualInput = routes.slice(start, end);
    assert.match(manualInput, /finalState: valid \? "USER_EDITED" : "INVALID"/);
    assert.match(manualInput, /type: "VALIDATION_FAILED"/);
    assert.match(manualInput, /return res\.json\(\{ saved: false, promoted: false, invalid: true \}\)/);
    assert.ok(manualInput.indexOf("invalid: true") < manualInput.indexOf("saveResolvedQuestion"));
});

test("browser corrections remain neutral until the Phase 0 classifier attributes them", () => {
    const routes = read("src/routes/extension.js");
    const manualStart = routes.indexOf('router.post("/api/extension/jobs/:id/manual-input"');
    const manualEnd = routes.indexOf("router.", manualStart + 20);
    const manualInput = routes.slice(manualStart, manualEnd);
    const evidenceStart = routes.indexOf('router.post("/api/extension/jobs/:id/field-evidence"');
    const evidenceEnd = routes.indexOf("router.", evidenceStart + 20);
    const fieldEvidence = routes.slice(evidenceStart, evidenceEnd);

    assert.doesNotMatch(manualInput, /ANSWER_KEPT|ANSWER_OVERWRITTEN/);
    assert.doesNotMatch(fieldEvidence, /ANSWER_KEPT|ANSWER_OVERWRITTEN/);
    assert.match(fieldEvidence, /buildFieldInteractionObservation/);
    assert.match(fieldEvidence, /classifyFieldInteraction/);
    assert.match(fieldEvidence, /mode: "SHADOW"/);
});

test("sidecar attention is scoped to the latest page plan", () => {
    const routes = read("src/routes/extension.js");
    assert.match(routes, /item\.pageUrl === plan\.pageUrl/);
    assert.match(routes, /planFields\.has\(String\(item\.fieldId\)\)/);
    assert.match(routes, /applicationSessionSummary\(application\.id, plan\?\.pageUrl\)/);
});

test("observed ATS controls cover company Apply labels, checkbox groups, CAPTCHA, and post-upload evidence", () => {
    const content = read("extension/content.js");
    assert.match(content, /to\\s\+this\\s\+job/);
    assert.match(content, /to\\s\+\.\{1,80\}/);
    assert.match(content, /type: "checkbox-group"/);
    assert.match(content, /selectedCheckboxes\.length > 0/);
    assert.match(content, /captcha\|verification/);
    assert.match(content, /captchaRequired/);
    const attachIndex = content.lastIndexOf("await attachApplicationDocuments");
    const evidenceIndex = content.indexOf('type: "RECORD_FIELD_EVIDENCE"', attachIndex);
    assert.ok(attachIndex >= 0 && evidenceIndex > attachIndex);
});

test("verified autofill follows SPA routes and attaches each document to its own field", () => {
    const content = read("extension/content.js");
    const uploads = read("extension/adapters/common/uploads.js");
    const scripts = `${content}\n${uploads}`;
    const background = read("extension/background.js");
    const routes = read("src/routes/extension.js");
    assert.match(content, /MutationObserver/);
    assert.match(content, /SPA_ROUTE_CHANGED/);
    assert.match(content, /fillPage\(\{ executePlan: true \}\)/);
    assert.match(background, /onHistoryStateUpdated/);
    assert.match(background, /onCompleted/);
    assert.match(background, /pendingDashboardApplication/);
    assert.match(scripts, /GET_COVER_LETTER/);
    assert.match(scripts, /GET_COVER_LETTER_TEXT/);
    assert.match(scripts, /fillCoverLetterNote/);
    assert.match(scripts, /REPLACE_RESUME_DOCUMENT|replaceResumeDocument/);
    assert.match(scripts, /Cover letter/);
    assert.match(scripts, /coverLetterField|isCoverLetterUploadField/);
    assert.match(routes, /\/api\/extension\/jobs\/:id\/cover-letter/);
});

test("attention and learning persistence stay separate from raw candidate values", () => {
    const schema = read("src/database/schema.sql");
    const repository = read("src/repositories/attentionRepository.js");
    const routes = read("src/routes/extension.js");
    assert.match(schema, /CREATE TABLE IF NOT EXISTS attention_items/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS learning_events/);
    assert.doesNotMatch(schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS attention_items"), schema.indexOf("CREATE TABLE IF NOT EXISTS field_mappings")), /application_value|answer TEXT/);
    assert.match(repository, /safeMetadata/);
    assert.doesNotMatch(repository, /before_json|after_json/);
    assert.match(routes, /correctionApprovalRequired/);
    assert.match(routes, /const promoted = false/);
    assert.match(routes, /pendingLearning/);
    const connection = read("src/database/connection.js");
    assert.match(connection, /Protected CAPTCHA values are never retained/);
    assert.match(connection, /application_value = NULL, answer_source = NULL, is_sensitive = 1/);
});

test("embedded Greenhouse forms are handled before same-page Apply anchors", () => {
    const content = read("extension/content.js");
    const fillPage = content.slice(content.indexOf("async function fillPage"), content.indexOf("async function markFilled"));
    assert.ok(fillPage.indexOf("hasEmbeddedApplicationFrame") < fillPage.indexOf("return continueApplication"));
    assert.match(content, /#grnhse_iframe/);
    assert.match(content, /fillEmbeddedApplication/);
    assert.match(content, /OPERATION_TIMEOUT_MS = 30000/);
});

test("multi-hop Workday applications remain linked and expose manual form recovery", () => {
    const content = read("extension/content.js");
    const background = read("extension/background.js");
    const popup = read("extension/popup.html");
    assert.match(content, /MAX_NAVIGATION_HOPS = 12/);
    assert.match(content, /myworkdayjobs\\\.com/);
    assert.match(content, /applyManually/);
    assert.match(content, /Process this form/);
    assert.match(content, /<\/style><div class="agent">/);
    assert.match(content, /processFormBtn\?\.addEventListener/);
    assert.match(content, /id="minimize-toggle"/);
    assert.match(content, /id="expand-agent"/);
    assert.match(content, /agent\.compact \.bubble,\.agent\.compact \.pet-static\{display:none\}/);
    assert.match(content, /robots\?\\s\+only/);
    assert.match(content, /function adapterContext/);
    assert.match(content, /fillOutcome/);
    assert.match(content, /GET_HOT_PATH/);
    assert.match(content, /function applyAdapterRuntime/);
    assert.match(read("extension/adapters/registry.js"), /naukri\.com/);
    assert.match(read("extension/adapters/registry.js"), /wellfound\.com/);
    assert.match(read("extension/adapters/runtime.js"), /embeddedFrameSelector/);
    assert.match(content, /JobHunterIdentity/);
    assert.match(content, /locallyFilledFieldIds/);
    assert.match(content, /void message\(\{\s*type: "RECORD_FIELD_EVIDENCE"/);
    assert.match(background, /case "NAVIGATE_TAB"/);
    assert.match(popup, /Process this form now/);
});

test("manual field learning uses stable DOM identity, global preference, application opt-out, and protected-value boundaries", () => {
    const content = read("extension/content.js");
    const background = read("extension/background.js");
    const panel = read("extension/sidepanel.js");
    const routes = read("src/routes/extension.js");
    const scanner = read("extension/runtime/scanner.js");
    const ownership = read("extension/runtime/ownership.js");
    assert.match(scanner, /elementByFieldId = new Map/);
    assert.match(scanner, /fieldIdByElement = new WeakMap/);
    assert.match(content, /scanner\.fieldIdForElement\(target\)/);
    assert.match(content, /ownership\.isProgrammatic\(target\)/);
    assert.match(ownership, /withProgrammaticMutation/);
    assert.doesNotMatch(content, /f\.element === target/);
    assert.match(content, /if \(!activeJob \|\| !field \|\| field\.legal \|\| field\.sensitive\) return;/);
    assert.match(content, /value: snapshot\.value/);
    assert.doesNotMatch(content, /SET_REUSE_CONSENT|Help COPILOT learn\?|Always allow|Not this time/);
    assert.match(panel, /Do not learn from this application/);
    assert.match(panel, /SET_APPLICATION_LEARNING/);
    assert.match(background, /SET_APPLICATION_LEARNING/);
    assert.match(routes, /learning-preference/);
    assert.match(routes, /setApplicationLearningDisabled/);
    assert.doesNotMatch(content, /confirm\("Learn reusable/);
    assert.match(background, /RECORD_FIELD_EVIDENCE/);
    assert.match(background, /response\.application\.adapter === "EXTENSION"/);
    assert.match(background, /dashboard-prepared active application/);
    assert.match(content, /async function saveUserField/);
    assert.match(content, /Could not save this field/);
    assert.match(routes, /const runtimeProposal = consent\.allowed \? stageManualCandidateAnswerProposal/);
    assert.match(routes, /pendingLearning: runtimeProposal\.staged/);
    assert.match(routes, /\["legal", "sensitive"\]\.includes\(classification\.kind\)/);
    assert.match(routes, /Submission requires an employer confirmation page or explicit candidate verification/);
});

test("the persistent UI is a pet robot without generic action controls", () => {
    const content = read("extension/content.js");
    assert.match(content, /assets\/pet-robot-v2\.png/);
    assert.match(content, /Application agent/);
    assert.doesNotMatch(content, /<details><summary>Details/);
    assert.doesNotMatch(content, /class="undo"|class="stop"|class="done"/);
    assert.match(content, /This form is taking longer than expected/);
    assert.doesNotMatch(content, /I could not autofill this page/);
    assert.match(content, /data-action="skip"/);
    assert.match(content, /data-semantic-key/);
    assert.match(content, /requiredInput/);
    assert.match(content, /field\.type === "combobox"/);
    assert.match(content, /response\.plan\?\.actions/);
    assert.doesNotMatch(content, /forceAi: window\.__forceAi/);
});

test("safe local diagnostic form covers text, select, textarea, and resume fields", () => {
    const diagnostic = read("src/views/extensionDiagnostic.ejs");
    const content = read("extension/content.js");
    assert.match(diagnostic, /Years of Node\.js Experience/);
    assert.match(diagnostic, /type="file"/);
    assert.match(diagnostic, /<textarea/);
    assert.match(diagnostic, /<select/);
    assert.match(diagnostic, /No data was submitted/);
    assert.match(diagnostic, /data-step="1"/);
    assert.match(diagnostic, /data-step="3"/);
    assert.match(diagnostic, /relocation-city/);
    assert.match(diagnostic, /backend_skills/);
    assert.match(diagnostic, /test CAPTCHA/);
    assert.match(diagnostic, /legal_declaration/);
    assert.match(diagnostic, /bot_trap/);
    assert.match(diagnostic, /Gender \(optional\)/);
    assert.match(content, /conditional field\(s\)/);
});

test("uploads and hops attach on globalThis even if a prior inject set a load flag without an API", () => {
    const uploads = read("extension/adapters/common/uploads.js");
    const hops = read("extension/adapters/common/hops.js");
    const context = {
        atob: () => "",
        File: class File {},
        DataTransfer: class DataTransfer {},
        Event: class Event {},
        setTimeout,
        clearTimeout,
        document: {
            addEventListener() {},
            getElementById() { return null; },
            querySelectorAll() { return []; },
            createElement() { return { className: "", textContent: "", classList: { add() {}, remove() {} } }; },
            documentElement: { appendChild() {} }
        }
    };
    context.globalThis = context;
    context.window = context;
    context.globalThis.__jobHunterUploadsLoaded = true;
    context.globalThis.__jobHunterHopsLoaded = true;
    vm.runInNewContext(uploads, context);
    vm.runInNewContext(hops, context);
    assert.equal(typeof context.globalThis.JobHunterUploads.installDocumentDropBridge, "function");
    assert.equal(typeof context.globalThis.JobHunterUploads.uploadLabelFor, "function");
    assert.equal(typeof context.globalThis.JobHunterHops.findApplyButton, "function");
    let currentJob = null;
    context.globalThis.JobHunterUploads.bind({
        get activeJob() { return currentJob; },
        detectFields: () => []
    });
    currentJob = { id: "job-live-1" };
    context.globalThis.JobHunterUploads.beginDocumentDrag("resume");
    assert.equal(context.globalThis.JobHunterUploads.getPendingDocumentDrag().jobId, "job-live-1");
    assert.match(uploads, /host\.activeJob\.id/);
    assert.match(uploads, /host\.adapterPayload\(\)/);
    assert.doesNotMatch(uploads, /\$\{activeJob\.id/);
    assert.doesNotMatch(uploads, /\.\.\.adapterPayload\(\)/);
});

test("content wrappers do not throw when adapter modules are missing and bind the host bag", () => {
    const content = read("extension/content.js");
    assert.match(content, /^\s*bindAdapterModules\(\);/m);
    assert.match(content, /JobHunterUploads\?\.installDocumentDropBridge\?\./);
    assert.match(content, /JobHunterUploads\?\.uploadLabelFor\?\./);
    assert.match(content, /JobHunterHops\?\.findApplyButton\?\./);
});

test("portal learning stores structural selectors only and exposes explicit non-submitting replay", () => {
    const schema = read("src/database/schema.sql");
    const routes = read("src/routes/extension.js");
    const popup = read("extension/popup.html");
    assert.match(schema, /CREATE TABLE IF NOT EXISTS portal_field_patterns/);
    assert.match(schema, /selector_candidates_json/);
    assert.doesNotMatch(schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS portal_field_patterns"), schema.indexOf("CREATE TABLE IF NOT EXISTS agent_sessions")), /application_value|answer TEXT/);
    assert.match(routes, /savePortalFieldPattern/);
    assert.match(routes, /findPortalFieldPattern/);
    assert.match(routes, /application_attempts aa/);
    assert.match(popup, /never submits/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { CANDIDATE_PERSONAS } from "./fixtures/candidate-personas.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const identityScript = fs.readFileSync(path.join(root, "extension/adapters/common/identity.js"), "utf8");
const datesScript = fs.readFileSync(path.join(root, "extension/adapters/common/dates.js"), "utf8");
const uploadsScript = fs.readFileSync(path.join(root, "extension/adapters/common/uploads.js"), "utf8");
const repeatablesScript = fs.readFileSync(path.join(root, "extension/adapters/common/repeatables.js"), "utf8");
const hopsScript = fs.readFileSync(path.join(root, "extension/adapters/common/hops.js"), "utf8");
const runtimeScript = fs.readFileSync(path.join(root, "extension/adapters/runtime.js"), "utf8");
const registryScript = fs.readFileSync(path.join(root, "extension/adapters/registry.js"), "utf8");
const shadowScript = fs.readFileSync(path.join(root, "extension/adapters/common/shadow.js"), "utf8");
const runtimeModuleScripts = ["scanner", "ownership", "executor", "verifier", "telemetry", "orchestrator"]
    .map((name) => fs.readFileSync(path.join(root, `extension/runtime/${name}.js`), "utf8"));
const contentScript = fs.readFileSync(path.join(root, "extension/content.js"), "utf8");
const greenhousePhonePeForm = fs.readFileSync(path.join(root, "test/fixtures/live-greenhouse-phonepe.html"), "utf8");
const searchBackedComboboxForm = fs.readFileSync(path.join(root, "test/fixtures/live-search-backed-combobox.html"), "utf8");

const PROFILE = {
    name: "Lavish Garg",
    email: "candidate@example.com",
    phone: "9999999999",
    linkedinUrl: "https://www.linkedin.com/in/lavish02",
    skills: ["Node.js", "AWS", "PostgreSQL"],
    experience: [{ title: "Team Lead", company: "Vidyakul", location: "India", startDate: "2026-03", endDate: "Present", bullets: ["Led backend systems."] }],
    education: [{ institution: "Thapar Institute", degree: "B.E. in Computer Science", field: "Computer Science", startDate: "2019-08", endDate: "2023-06" }]
};

function mockInitScript(hotPath = null) {
    const resolvedHotPath = hotPath || {
        portalKind: "generic",
        killed: false,
        pack: { hotPath: { skipLlmOn: ["FIRST_NAME","LAST_NAME","FULL_NAME","EMAIL","PHONE","RESUME","COVER_LETTER"] } },
        profile: PROFILE
    };
    return `
        const listeners = [];
        const progress = [];
        const messages = [];
        const operations = [];
        globalThis.__extensionProgress = progress;
        globalThis.__extensionMessages = messages;
        globalThis.__extensionOperations = operations;
        globalThis.__fieldEvidence = [];
        globalThis.__resolveFieldsSnapshots = [];
        globalThis.chrome = {
            runtime: {
                lastError: null,
                getURL: (path) => "chrome-extension://phase1/" + path,
                onMessage: { addListener: (listener) => { listeners.push(listener); globalThis.__contentMessageListener = listener; } },
                sendMessage(payload, callback) {
                    messages.push(payload.type);
                    const finish = (result) => queueMicrotask(() => callback({ ok: true, result }));
                    if (payload.type === "JOB_CONTEXT") return finish({ job: { id: "job-1", title: "Backend Engineer", company: "Example", matchScore: 90 } });
                    if (payload.type === "GET_EXTENSION_STATE") return finish({ activeApplication: { status: "OPENING" }, teachModeGlobal: false, teachModeSites: {} });
                    if (payload.type === "GET_PANEL_VISIBILITY") return finish({ open: false });
                    if (payload.type === "GET_HOT_PATH") {
                        return finish(${JSON.stringify(resolvedHotPath)});
                    }
                    if (payload.type === "RESOLVE_FIELDS") {
                        globalThis.__resolveFieldsSnapshots.push({
                            locallyFilledFieldIds: payload.payload.locallyFilledFieldIds || [],
                            labels: (payload.payload.fields || []).map((field) => field.label),
                            fullName: document.querySelector('input[name="full_name"]')?.value || "",
                            email: document.querySelector('input[name="email"]')?.value || "",
                            resumeFiles: document.querySelector('input[name="resume"]')?.files?.length || 0
                        });
                        const leftoverAnswers = {
                            "Years of Node.js Experience": "3.5", "City": ${JSON.stringify(resolvedHotPath.profile?.currentLocation || "Gurgaon")},
                            "Country": "India", "Personal Summary": "Backend engineer focused on reliable distributed systems.",
                            "Job Title": ${JSON.stringify(resolvedHotPath.profile?.experience?.[0]?.title || "")},
                            "Job Title*": ${JSON.stringify(resolvedHotPath.profile?.experience?.[0]?.title || "")},
                            "Title*": ${JSON.stringify(resolvedHotPath.profile?.experience?.[0]?.title || "")},
                            "Company*": ${JSON.stringify(resolvedHotPath.profile?.experience?.[0]?.company || "")},
                            "Company name*": ${JSON.stringify(resolvedHotPath.profile?.experience?.[0]?.company || "")},
                            "From": ${JSON.stringify(resolvedHotPath.profile?.experience?.[0]?.startDate || "")},
                            "From*": ${JSON.stringify(resolvedHotPath.profile?.experience?.[0]?.startDate || "")},
                            "I currently work here": "Yes",
                            "Separate each skill with a comma.": ${(JSON.stringify((resolvedHotPath.profile?.skills || []).join(", ")))},
                            "Title": ${JSON.stringify(resolvedHotPath.profile?.experience?.[0]?.title || "")},
                            "Company": ${JSON.stringify(resolvedHotPath.profile?.experience?.[0]?.company || "")},
                            "Institution": ${JSON.stringify(resolvedHotPath.profile?.education?.[0]?.institution || "")},
                            "Major": ${JSON.stringify(resolvedHotPath.profile?.education?.[0]?.field || "")},
                            "Degree": "Bachelor’s Degree"
                            ,"Start date month": "March"
                            ,"Start date year": "2026"
                            ,"End date month": ""
                            ,"End date year": ""
                            ,"Years of Expereince*": "3"
                            ,"Source of your application?*": "LinkedIn"
                        };
                        const leftoverKeys = {
                            "Job Title": "EXPERIENCE_TITLE", "Job Title*": "EXPERIENCE_TITLE",
                            "Title*": "EXPERIENCE_TITLE",
                            "Company": "EXPERIENCE_COMPANY", "Company*": "EXPERIENCE_COMPANY",
                            "Company name*": "EXPERIENCE_COMPANY",
                            "From": "EXPERIENCE_START_DATE", "From*": "EXPERIENCE_START_DATE",
                            "Start date month": "EXPERIENCE_START_DATE", "Start date year": "EXPERIENCE_START_DATE",
                            "End date month": "EXPERIENCE_END_DATE", "End date year": "EXPERIENCE_END_DATE",
                            "I currently work here": "EXPERIENCE_CURRENT",
                            "Degree": "EDUCATION_DEGREE",
                            "Years of Expereince*": "TOTAL_EXPERIENCE",
                            "Source of your application?*": "HEARING_SOURCE",
                            "Separate each skill with a comma.": "SKILLS", "Country": "COUNTRY",
                            "Personal Summary": "PERSONAL_SUMMARY"
                        };
                        const actions = payload.payload.fields.flatMap((field) => {
                            let normalizedLabel = String(field.label || "").trim();
                            while (normalizedLabel.endsWith("*")) normalizedLabel = normalizedLabel.slice(0, -1).trim();
                            const value = leftoverAnswers[field.label] ?? leftoverAnswers[normalizedLabel];
                            if (!value) return [];
                            return [{ fieldId: field.id, action: "FILL", value, source: "PROFILE", semanticKey: leftoverKeys[field.label] || leftoverKeys[normalizedLabel] || null }];
                        });
                        return finish({
                            blocked: false,
                            reuseConsent: { promptRequired: false },
                            currentQuestion: null,
                            attentionItems: [],
                            plan: { actions, review: [], conflicts: [], summary: { total: payload.payload.fields.length, ready: actions.length, needsYou: 0, aiDrafts: 0, manual: 2 }, submits: false }
                        });
                    }
                    if (payload.type === "GET_RESUME") return finish({ base64: "JVBERi0xLjQKJSVFT0Y=", contentType: "application/pdf" });
                    if (payload.type === "GET_COVER_LETTER") return finish({ base64: "JVBERi0xLjQKJSVFT0Y=", contentType: "application/pdf" });
                    if (payload.type === "GET_COVER_LETTER_TEXT") return finish({ text: "Dear Hiring Manager, I am applying to EarnIn." });
                    if (payload.type === "VALIDATE_FORM") return finish({ status: "WAITING_FOR_USER" });
                    if (payload.type === "REPORT_PROGRESS") { progress.push(payload.payload); return finish({}); }
                    if (payload.type === "RECORD_OPERATION") { operations.push(payload.payload); return finish({}); }
                    if (payload.type === "RECORD_FIELD_EVIDENCE") { globalThis.__fieldEvidence.push(payload.payload); return finish({}); }
                    if (payload.type === "REGISTER_TAB" || payload.type === "STOP_NAVIGATION" || payload.type === "FILL_CHILD_FRAMES") {
                        return finish(payload.type === "FILL_CHILD_FRAMES" ? { filled: false } : {});
                    }
                    return finish({});
                }
            },
            storage: { local: { set: async () => {}, get: async () => ({}) } }
        };
    `;
}

async function loadCopilot(page, html, hotPath = null) {
    await page.addInitScript(mockInitScript(hotPath));
    await page.goto(`data:text/html,${encodeURIComponent(html)}`);
    await page.addScriptTag({ content: registryScript });
    await page.addScriptTag({ content: runtimeScript });
    await page.addScriptTag({ content: shadowScript });
    await page.addScriptTag({ content: identityScript });
    await page.addScriptTag({ content: datesScript });
    await page.addScriptTag({ content: uploadsScript });
    await page.addScriptTag({ content: repeatablesScript });
    await page.addScriptTag({ content: hopsScript });
    for (const script of runtimeModuleScripts) await page.addScriptTag({ content: script });
    await page.addScriptTag({ content: contentScript });
}

const identityForm = `<!doctype html><form>
    <label>Full name<input name="full_name" required></label>
    <label>Email address<input name="email" type="email" required></label>
    <label>Phone number<input name="phone" required></label>
    <label>Years of Node.js Experience<input name="node_experience" type="number" required></label>
    <label>Address line 1<input name="address1" required></label>
    <label>Resume Upload<input name="resume" type="file" required></label>
    <label>Cover Letter<input name="cover_letter" type="file"></label>
    <label>Verification challenge (test CAPTCHA)<input name="captcha_code" required></label>
    <label><input name="legal_declaration" type="checkbox" required> I certify this application</label>
</form>`;

const openShadowForm = `<!doctype html><form id="application">
    <x-field data-kind="first"><span>First name</span></x-field>
    <x-field data-kind="last"><span>Last name</span></x-field>
    <x-field data-kind="email"><span>Email</span></x-field>
    <x-field data-kind="resume"><span>Resume</span></x-field>
    <script>
      for (const host of document.querySelectorAll("x-field")) {
        const kind = host.dataset.kind;
        const root = host.attachShadow({ mode: "open" });
        const id = kind === "resume" ? "input-resume" : kind + "-input";
        const type = kind === "resume" ? "file" : kind === "email" ? "email" : "text";
        const autocomplete = kind === "first" ? "given-name" : kind === "last" ? "family-name" : kind === "email" ? "email" : "";
        root.innerHTML = '<label for="' + id + '">' + host.textContent + '</label><input id="' + id + '" type="' + type + '" autocomplete="' + autocomplete + '" data-testid="' + id + '">';
      }
    <\/script>
</form>`;

const smartRecruitersShadowForm = `<!doctype html>
<oc-apply-with-resume><x-upload data-zone="parser">Upload a resume to autocomplete</x-upload></oc-apply-with-resume>
<main><form id="application">
  <x-field data-kind="first">First name</x-field>
  <x-field data-kind="last">Last name</x-field>
  <x-field data-kind="email">Email</x-field>
  <x-city>City</x-city>
  <x-phone>+91</x-phone>
  <div class="form-section" data-test="experience">
    <oc-button data-test="add-experience" aria-expanded="false"><button aria-label="Add experience entry">Add</button></oc-button>
    <div data-entry hidden><label>Title<input aria-label="Title"></label><label>Company<input aria-label="Company"></label><label>Description<textarea aria-label="Description"></textarea></label></div>
  </div>
  <div class="form-section" data-test="education">
    <oc-button data-test="add-education" aria-expanded="false"><button aria-label="Add education entry">Add</button></oc-button>
    <div data-entry hidden><label>Institution<input aria-label="Institution"></label><label>Major<input aria-label="Major"></label><label>Degree<input aria-label="Degree"></label></div>
  </div>
  <x-upload data-zone="application">Resume</x-upload>
</form></main>
<script>
  for (const host of document.querySelectorAll("x-field")) {
    const kind = host.dataset.kind;
    const root = host.attachShadow({ mode: "open" });
    const autocomplete = kind === "first" ? "given-name" : kind === "last" ? "family-name" : "email";
    root.innerHTML = '<label>' + host.textContent + '<input type="' + (kind === "email" ? "email" : "text") + '" autocomplete="' + autocomplete + '"></label>';
  }
  for (const host of document.querySelectorAll("x-upload")) {
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<label>' + host.textContent + '<input id="file-input" data-testid="file-input" type="file" accept="application/pdf"></label>';
  }
  const phoneRoot = document.querySelector("x-phone").attachShadow({ mode: "open" });
  phoneRoot.innerHTML = '<input type="tel" aria-label="Phone number">';
  const cityRoot = document.querySelector("x-city").attachShadow({ mode: "open" });
  cityRoot.innerHTML = '<input type="text" role="combobox" aria-label="City">';
  const cityInput = cityRoot.querySelector("input");
  cityInput.addEventListener("input", () => {
    cityRoot.querySelector('[role="listbox"]')?.remove();
    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    const option = document.createElement("div");
    option.setAttribute("role", "option");
    option.textContent = "Gurugram, Haryana, India";
    option.addEventListener("click", () => { cityInput.value = option.textContent; });
    list.appendChild(option);
    cityRoot.appendChild(list);
  });
  for (const button of document.querySelectorAll('oc-button[data-test^="add-"] button')) button.addEventListener("click", () => {
    button.closest("oc-button").setAttribute("aria-expanded", "true");
    button.closest(".form-section").querySelector("[data-entry]").hidden = false;
  });
<\/script>`;

const pinpointForm = `<!doctype html><form class="external-form" id="application-form" action="/en/postings/example/applications">
  <label>First Name<input name="application_form[application][first_name]" autocomplete="given-name" required></label>
  <label>Last Name<input name="application_form[application][last_name]" autocomplete="family-name" required></label>
  <label>Email Address<input name="application_form[application][email]" type="email" autocomplete="email" required></label>
  <div id="address-country"><label>Country</label>
    <input type="text" id="application_form[application][country]" role="combobox" aria-describedby="country-placeholder" autocomplete="off">
    <input type="hidden" name="application_form[application][country]" value="">
    <select hidden id="application_form[application][country]"><option value="blank">Select</option><option value="IN">India</option></select>
  </div>
  <label>Town<input name="application_form[application][town]" required></label>
  <label>Postcode<input name="application_form[application][postcode]" required></label>
  <label>Résumé / CV<input type="file" name="application_form[application][cv]" accept="application/pdf"></label>
  <label>Personal Summary<textarea name="application_form[application][summary]" required></textarea></label>
  <label><input type="checkbox" name="application[process_information]" required>Allow us to process your personal information.</label>
</form><script>
  const country = document.querySelector('input[role=combobox]');
  country.addEventListener('input', () => {
    document.querySelector('[role=listbox]')?.remove();
    const list = document.createElement('div');
    list.setAttribute('role', 'listbox');
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    option.textContent = 'India';
    option.addEventListener('click', () => {
      country.value = 'India';
      document.querySelector('input[type=hidden][name="application_form[application][country]"]').value = 'IN';
      list.remove();
    });
    list.appendChild(option);
    document.body.appendChild(list);
  });
<\/script>`;

const phenomForm = `<!doctype html><form class="rjsf">
  <label>Legal Given Name(s)<input id="cntryFields.firstName" aria-label="Legal Given Name(s)" autocomplete="given-name" required></label>
  <label>Email Address<input id="email" aria-label="Email Address" autocomplete="email" required></label>
  <label>Phone Number<input id="phoneWidget.phoneNumber" aria-label="Phone Number" autocomplete="tel-national" required></label>
  <section aria-label="Work experience">
    <label>Job Title*<input id="experienceData[0].title" aria-label="Job Title" required></label>
    <label>Company*<input id="experienceData[0].companyName" aria-label="Company" required></label>
    <label>From*<input id="experienceData[0].fromTo.startDate" aria-label="From" required></label>
    <label>To*<input id="experienceData[0].fromTo.endDate" aria-label="To"></label>
    <label><input type="checkbox" id="experienceData[0].fromTo.currentlyWorkHere" aria-label="I currently work here">I currently work here</label>
  </section>
  <label>Separate each skill with a comma.<textarea id="skillObject.skills"></textarea></label>
  <label>Resume<input type="file" data-testid="phenom-resume" accept="application/pdf"></label>
  <p>I consent to Cisco emailing me information about additional opportunities.</p>
  <label><input type="checkbox" id="emailOptIn">Send Emails</label>
  <fieldset><legend>Have you ever worked for this employer?</legend><label><input type="radio" name="previousWorkerConfirmation" value="Yes">Yes</label><label><input type="radio" name="previousWorkerConfirmation" value="No">No</label></fieldset>
</form><script src="https://cdn.example.test/phenompeople/apply.js"><\/script>`;

test("browser harness keeps the robot as a side-panel launcher and fills only safe fields", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await loadCopilot(page, identityForm);
        await page.waitForSelector("#job-hunter-copilot-host");
        const initial = await page.locator("#job-hunter-copilot-host").evaluate((host) => ({
            launcherVisible: getComputedStyle(host.shadowRoot.querySelector("#expand-agent")).display !== "none",
            bubbleVisible: getComputedStyle(host.shadowRoot.querySelector(".bubble")).display !== "none"
        }));
        assert.deepEqual(initial, { launcherVisible: true, bubbleVisible: false });

        await page.waitForFunction(() => document.querySelector('input[name="full_name"]')?.value === "Lavish Garg"
            && document.querySelector('input[name="resume"]')?.files?.length === 1
            && document.querySelector('input[name="cover_letter"]')?.files?.length === 1
            && document.querySelector('input[name="node_experience"]')?.value === "3.5");
        assert.equal(await page.locator('input[name="full_name"]').inputValue(), "Lavish Garg");
        assert.equal(await page.locator('input[name="email"]').inputValue(), "candidate@example.com");
        assert.equal(await page.locator('input[name="phone"]').inputValue(), "9999999999");
        assert.equal(await page.locator('input[name="resume"]').evaluate((input) => input.files?.[0]?.name), "resume-job-1.pdf");
        assert.equal(await page.locator('input[name="cover_letter"]').evaluate((input) => input.files?.[0]?.name), "cover-letter-job-1.pdf");
        assert.equal(await page.locator('input[name="captcha_code"]').inputValue(), "");
        assert.equal(await page.locator('input[name="legal_declaration"]').isChecked(), false);

        const snapshot = await page.evaluate(() => globalThis.__resolveFieldsSnapshots[0]);
        assert.ok(snapshot, "RESOLVE_FIELDS should run after the local identity pass");
        assert.equal(snapshot.fullName, "Lavish Garg");
        assert.equal(snapshot.email, "candidate@example.com");
        assert.equal(snapshot.resumeFiles, 1);
        assert.equal(snapshot.labels.includes("Full name"), false);
        assert.equal(snapshot.labels.includes("Email address"), false);
        assert.ok(snapshot.locallyFilledFieldIds.length >= 3);
        const types = await page.evaluate(() => globalThis.__extensionMessages);
        assert.ok(types.indexOf("GET_HOT_PATH") >= 0);
        assert.ok(types.indexOf("GET_HOT_PATH") < types.indexOf("RESOLVE_FIELDS"));
        await page.waitForFunction(() => globalThis.__extensionMessages.includes("RECORD_FIELD_EVIDENCE"));
        assert.ok((await page.evaluate(() => globalThis.__extensionMessages)).includes("RECORD_FIELD_EVIDENCE"));
        const evidence = await page.evaluate(() => globalThis.__fieldEvidence.at(-1)?.fields || []);
        const nameEvidence = evidence.find((field) => field.label === "Full name");
        const addressEvidence = evidence.find((field) => field.label === "Address line 1");
        const captchaEvidence = evidence.find((field) => /CAPTCHA/i.test(field.label));
        assert.equal(nameEvidence?.semanticKey, "FULL_NAME");
        assert.equal(nameEvidence?.fillOutcome, "FILLED");
        assert.equal(addressEvidence?.fillOutcome, "NOT_ATTEMPTED");
        assert.equal(captchaEvidence?.fillOutcome, "LEGAL_BLOCK");
        assert.equal(captchaEvidence?.value, null);

        await page.evaluate(() => globalThis.__contentMessageListener({ type: "SIDECAR_VISIBILITY", open: true }, null, () => {}));
        assert.equal(await page.locator("#job-hunter-copilot-host").isVisible(), false);
        const submitted = await page.evaluate(() => globalThis.__extensionProgress.some((item) => ["SUBMITTING", "SUCCESS"].includes(item.status)));
        assert.equal(submitted, false);
    } finally {
        await browser.close();
    }
});

test("white-labelled Pinpoint form uses the visible country combobox and preserves manual consent", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await loadCopilot(page, pinpointForm);
        await page.waitForFunction(() => globalThis.__extensionMessages.includes("RECORD_FIELD_EVIDENCE"));
        const state = await page.evaluate(() => ({
            firstName: document.querySelector('input[name="application_form[application][first_name]"]')?.value,
            countryText: document.querySelector('input[type=text][autocomplete=off]')?.value,
            countryBacking: document.querySelector('input[type=hidden][name="application_form[application][country]"]')?.value,
            files: document.querySelector('input[type=file]')?.files?.length,
            summary: document.querySelector('textarea')?.value,
            portalKind: globalThis.__fieldEvidence.at(-1)?.portalKind
        }));
        assert.deepEqual(state, {
            firstName: "Lavish", countryText: "India", countryBacking: "IN", files: 1,
            summary: "Backend engineer focused on reliable distributed systems.", portalKind: "pinpoint"
        });
        assert.equal(await page.locator('input[type=text][autocomplete=off]').inputValue(), "India");
        assert.equal(await page.locator('input[type=hidden][name="application_form[application][country]"]').inputValue(), "IN");
        assert.equal(await page.locator('input[name="application[process_information]"]').isChecked(), false);
    } finally {
        await browser.close();
    }
});

test("white-labelled Phenom form fills structured history and protects marketing consent", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await loadCopilot(page, phenomForm, {
            portalKind: "phenom", killed: false,
            pack: {
                textVerifyDelayMs: 180,
                fileFields: { resume: { testIds: ["phenom-resume"], labelPatterns: ["resume", "cv"] } },
                overlays: { formContainers: "form.rjsf" },
                hotPath: { skipLlmOn: ["FIRST_NAME", "EMAIL", "PHONE", "EXPERIENCE_TITLE", "EXPERIENCE_COMPANY", "EXPERIENCE_START_DATE", "EXPERIENCE_CURRENT", "SKILLS", "RESUME"] }
            },
            profile: PROFILE
        });
        await page.waitForFunction(() => document.getElementById('experienceData[0].title')?.value === "Team Lead"
            && document.getElementById('experienceData[0].companyName')?.value === "Vidyakul"
            && document.getElementById('skillObject.skills')?.value.includes("Node.js")
            && document.querySelector('[data-testid=phenom-resume]')?.files?.length === 1);
        await page.waitForFunction(() => globalThis.__fieldEvidence.length > 0);
        assert.equal(await page.locator('#experienceData\\[0\\]\\.fromTo\\.startDate').inputValue(), "2026-03");
        assert.equal(await page.locator('#experienceData\\[0\\]\\.fromTo\\.currentlyWorkHere').isChecked(), true);
        assert.equal(await page.locator('#emailOptIn').isChecked(), false);
        const evidence = await page.evaluate(() => globalThis.__fieldEvidence.flatMap((batch) => batch.fields || []));
        assert.equal(evidence.find((field) => field.label === "Job Title*" && field.semanticKey)?.semanticKey, "EXPERIENCE_TITLE",
            JSON.stringify(evidence.map((field) => ({ id: field.id, label: field.label, semanticKey: field.semanticKey, fillOutcome: field.fillOutcome }))));
        assert.equal(evidence.find((field) => field.label === "Send Emails")?.fillOutcome, "LEGAL_BLOCK");
        assert.equal(evidence.some((field) => field.label === "Yes"), false);
    } finally {
        await browser.close();
    }
});

test("PhonePe Greenhouse Form A fills structured history and verifies a replaced upload input", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await loadCopilot(page, greenhousePhonePeForm, {
            portalKind: "greenhouse", killed: false,
            pack: {
                fileFields: { resume: { testIds: ["resume"], labelPatterns: ["resume"], verifyDelayMs: 100 } },
                hotPath: { skipLlmOn: ["FIRST_NAME", "LAST_NAME", "EMAIL", "RESUME"] }
            },
            profile: PROFILE
        });
        await page.waitForFunction(() => globalThis.__extensionMessages.includes("RECORD_FIELD_EVIDENCE"));
        const state = await page.evaluate(() => ({
            company: document.getElementById("company-name-0")?.value,
            title: document.getElementById("title-0")?.value,
            startMonth: document.getElementById("start-date-month-0")?.closest("[data-select-root]")?.querySelector(".select__single-value")?.textContent,
            startMonthInput: document.getElementById("start-date-month-0")?.value,
            startYear: document.getElementById("start-date-year-0")?.value,
            degree: document.getElementById("degree--0")?.closest("[data-select-root]")?.querySelector(".select__single-value")?.textContent,
            years: document.getElementById("years-experience")?.closest("[data-select-root]")?.querySelector(".select__single-value")?.textContent,
            source: document.getElementById("source")?.closest("[data-select-root]")?.querySelector(".select__single-value")?.textContent,
            receipt: document.querySelector(".file-upload__filename")?.textContent || "",
            labels: globalThis.__resolveFieldsSnapshots.at(-1)?.labels || []
        }));
        assert.deepEqual(state, {
            company: "Vidyakul", title: "Team Lead", startMonth: "March", startYear: "2026",
            startMonthInput: "", degree: "Bachelor’s Degree", years: "3", source: "Linkedln", receipt: "resume-job-1.pdf",
            labels: state.labels
        });
        assert.equal(await page.locator("#company-name-0").inputValue(), "Vidyakul");
        assert.equal(await page.locator("#title-0").inputValue(), "Team Lead");
        assert.equal(await page.locator("#start-date-year-0").inputValue(), "2026");
        assert.equal(await page.locator("#degree--0").inputValue(), "");
        assert.equal(await page.locator("#years-experience").inputValue(), "");
        await page.waitForFunction(() => globalThis.__extensionOperations.some((operation) => operation.phase === "DOCUMENT" && operation.status === "CONFIRMED"));
        const evidence = await page.evaluate(() => globalThis.__fieldEvidence.flatMap((batch) => batch.fields || []));
        assert.equal(evidence.find((field) => field.label === "Company name*")?.semanticKey, "EXPERIENCE_COMPANY");
        assert.equal(evidence.find((field) => field.label === "Start date month*")?.semanticKey, "EXPERIENCE_START_DATE");
        assert.equal(evidence.find((field) => field.label === "Start date month*")?.filled, true);
        const comboboxOperations = await page.evaluate(() => globalThis.__extensionOperations.filter((operation) => operation.metadata?.selectionVerified));
        assert.ok(comboboxOperations.length >= 4, JSON.stringify(comboboxOperations));
        assert.ok(comboboxOperations.every((operation) => operation.metadata.matchConfidence >= 0.8));
        assert.equal(comboboxOperations.some((operation) => /March|Bachelor|Linked|Vidyakul/.test(JSON.stringify(operation.metadata))), false);
    } finally {
        await browser.close();
    }
});

test("search-backed combobox types incrementally, scores suggestions, and commits one exact location", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await loadCopilot(page, searchBackedComboboxForm, {
            portalKind: "greenhouse", killed: false,
            pack: { hotPath: { skipLlmOn: ["FIRST_NAME", "EMAIL", "PHONE"] } },
            profile: { ...PROFILE, currentLocation: "Gurugram, Haryana, India" }
        });
        await page.waitForFunction(() => document.querySelector("#city-search")?.closest("[data-select-root]")
            ?.querySelector(".select__single-value")?.textContent === "Gurugram, Haryana, India"
            && globalThis.__extensionOperations?.some((operation) => operation.metadata?.widgetMode === "SEARCH"
                && operation.metadata?.selectionVerified), null, { timeout: 8000 });
        const state = await page.evaluate(() => ({
            selected: document.querySelector("#city-search")?.closest("[data-select-root]")?.querySelector(".select__single-value")?.textContent,
            inputValue: document.querySelector("#city-search")?.value,
            inputEvents: Number(document.querySelector("#city-search")?.dataset.inputEvents || 0),
            operation: globalThis.__extensionOperations.find((operation) => operation.metadata?.widgetMode === "SEARCH" && operation.metadata?.selectionVerified),
            operations: globalThis.__extensionOperations
        }));
        assert.equal(state.selected, "Gurugram, Haryana, India");
        assert.equal(state.inputValue, "");
        assert.ok(state.inputEvents >= "Gurugram".length, JSON.stringify(state));
        assert.equal(state.operation?.metadata.matchClass, "EXACT", JSON.stringify(state.operations));
        assert.equal(state.operation?.metadata.matchConfidence, 1);
        assert.ok(state.operation?.metadata.queryAttempts >= 1);
        assert.equal(/Gurugram|Haryana|India/.test(JSON.stringify(state.operation?.metadata)), false);
    } finally {
        await browser.close();
    }
});

test("browser harness fills eight candidate personas without leaking optional or protected facts", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const profile of CANDIDATE_PERSONAS) {
            const page = await browser.newPage();
            try {
                await loadCopilot(page, `<!doctype html><form>
                    <label>First name<input name="first_name" autocomplete="given-name"></label>
                    <label>Last name<input name="last_name" autocomplete="family-name"></label>
                    <label>Email<input name="email" type="email" autocomplete="email"></label>
                    <label>Confirm your email<input name="confirm_email" type="email" autocomplete="email"></label>
                    <label>Phone number<input name="phone" type="tel" autocomplete="tel"></label>
                    <label>LinkedIn<input name="linkedin"></label>
                    <label>Facebook<input name="facebook"></label>
                    <label>X (fka Twitter)<input name="twitter"></label>
                    <label>Website<input name="website"></label>
                    <label>Resume<input name="resume" type="file"></label>
                    <label><input name="consent" type="checkbox" required> I certify this application</label>
                </form>`, {
                    portalKind: "generic",
                    killed: false,
                    pack: { hotPath: { skipLlmOn: ["FIRST_NAME", "LAST_NAME", "EMAIL", "PHONE", "LINKEDIN_URL", "RESUME"] } },
                    profile
                });
                await page.waitForFunction(({ email, phone, linkedin }) => document.querySelector('input[name="email"]')?.value === email
                    && document.querySelector('input[name="confirm_email"]')?.value === email
                    && document.querySelector('input[name="phone"]')?.value === phone
                    && (!linkedin || document.querySelector('input[name="linkedin"]')?.value === linkedin)
                    && globalThis.__extensionMessages.includes("VALIDATE_FORM"),
                { email: profile.email, phone: profile.phone, linkedin: profile.linkedinUrl || "" });
                assert.equal(await page.locator('input[name="first_name"]').inputValue(), profile.preferredFirstName || profile.name.split(/\s+/)[0], profile.id);
                assert.equal(await page.locator('input[name="last_name"]').inputValue(), profile.preferredLastName || profile.name.split(/\s+/).slice(1).join(" "), profile.id);
                assert.equal(await page.locator('input[name="linkedin"]').inputValue(), profile.linkedinUrl || "", profile.id);
                assert.equal(await page.locator('input[name="facebook"]').inputValue(), "", profile.id);
                assert.equal(await page.locator('input[name="twitter"]').inputValue(), "", profile.id);
                assert.equal(await page.locator('input[name="website"]').inputValue(), "", profile.id);
                assert.equal(await page.locator('input[name="consent"]').isChecked(), false, profile.id);
                assert.equal(await page.locator('input[name="resume"]').evaluate((input) => input.files?.length || 0), 1, profile.id);
            } finally {
                await page.close();
            }
        }
    } finally {
        await browser.close();
    }
});

test("browser harness reports review when a controlled input clears the proposed value", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await loadCopilot(page, `<!doctype html><form>
            <label>First name<input name="first_name" autocomplete="given-name"></label>
            <label>Email<input name="email" type="email" autocomplete="email"></label>
            <label>Phone<input name="phone" type="tel" autocomplete="tel"></label>
            <script>
              document.querySelector('[name=email]').addEventListener('input', (event) => { event.currentTarget.value = ''; });
            <\/script>
        </form>`);
        await page.waitForFunction(() => globalThis.__extensionOperations.some((item) => item.phase === "IDENTITY" && item.status === "REVIEW"));
        assert.equal(await page.locator('input[name="email"]').inputValue(), "");
        assert.equal(await page.locator('input[name="phone"]').inputValue(), PROFILE.phone);
        assert.equal(await page.evaluate(() => globalThis.__extensionOperations.some((item) => item.semanticKey === "EMAIL" && item.status === "FILLED")), false);
    } finally {
        await browser.close();
    }
});

test("browser harness repairs one delayed React clear without overwriting candidate edits", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await loadCopilot(page, `<!doctype html><form>
            <label>First name<input name="first_name" autocomplete="given-name"></label>
            <label>Email<input name="email" type="email" autocomplete="email"></label>
            <label>Phone<input name="phone" type="tel" autocomplete="tel"></label>
            <script>
              let cleared = false;
              document.querySelector('[name=email]').addEventListener('input', (event) => {
                if (cleared) return;
                cleared = true;
                setTimeout(() => { document.body.dataset.controlledClear = 'true'; event.currentTarget.value = ''; event.currentTarget.dispatchEvent(new Event('input', { bubbles: true })); }, 250);
              });
            <\/script>
        </form>`);
        await page.waitForFunction(() => document.body.dataset.controlledClear === "true"
            && document.querySelector('[name=email]')?.value === "candidate@example.com", null, { timeout: 8000 });
        const repaired = await page.evaluate(() => ({
            value: document.querySelector('[name=email]')?.value,
            rechecks: globalThis.__extensionMessages.filter((item) => item === "GET_HOT_PATH").length
        }));
        assert.equal(repaired.value, "candidate@example.com", JSON.stringify(repaired));
        assert.ok(repaired.rechecks >= 2, JSON.stringify(repaired));
        await page.locator('[name=email]').fill("candidate+edited@example.com");
        await page.waitForTimeout(1200);
        assert.equal(await page.locator('[name=email]').inputValue(), "candidate+edited@example.com");
    } finally {
        await browser.close();
    }
});

test("browser harness detects and fills identity plus resume inside open shadow roots", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await loadCopilot(page, openShadowForm);
        await page.waitForFunction(() => {
            const fields = [...document.querySelectorAll("x-field")].map((host) => host.shadowRoot?.querySelector("input"));
            return fields[0]?.value.includes("Lavish") && fields[2]?.value.includes("@") && fields[3]?.files?.length === 1;
        });
        const result = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("x-field")].map((host) => {
            const input = host.shadowRoot.querySelector("input");
            return [host.dataset.kind, input.type === "file" ? input.files.length : input.value];
        })));
        assert.match(result.first, /Lavish/);
        assert.match(result.email, /@/);
        assert.equal(result.resume, 1);
        await page.waitForFunction(() => globalThis.__extensionMessages.includes("VALIDATE_FORM"));
        assert.equal(await page.evaluate(() => globalThis.__extensionMessages.includes("VALIDATE_FORM")), true);
    } finally {
        await browser.close();
    }
});

test("SmartRecruiters attaches only the application resume, not the parser upload", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await loadCopilot(page, smartRecruitersShadowForm, {
            portalKind: "smartrecruiters",
            killed: false,
            pack: {
                skipAncestorSelectors: ["oc-apply-with-resume"],
                fileFields: { resume: { testIds: ["file-input"], labelPatterns: ["resume"] } },
                hotPath: { skipLlmOn: ["FIRST_NAME", "LAST_NAME", "EMAIL", "RESUME"] }
            },
            profile: PROFILE
        });
        await page.waitForFunction(() => document.querySelector('x-upload[data-zone="application"]')?.shadowRoot?.querySelector("input")?.files?.length === 1);
        const uploads = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("x-upload")].map((host) => [
            host.dataset.zone,
            host.shadowRoot.querySelector("input").files.length
        ])));
        assert.deepEqual(uploads, { parser: 0, application: 1 });
        assert.equal(await page.evaluate(() => globalThis.JobHunterAdapterRuntime.current().portalKind), "smartrecruiters");
        assert.equal(await page.evaluate(() => document.querySelector("x-phone").shadowRoot.querySelector("input").value), PROFILE.phone);
        await page.waitForFunction(() => document.querySelector("x-city").shadowRoot.querySelector("input").value.includes("Gurugram"));
        await page.waitForFunction(() => document.querySelector('[data-test="experience"] [aria-label="Title"]')?.value === "Team Lead"
            && document.querySelector('[data-test="education"] [aria-label="Institution"]')?.value === "Thapar Institute");
        assert.equal(await page.locator('[data-test="experience"] oc-button').getAttribute("aria-expanded"), "true");
        assert.equal(await page.locator('[data-test="education"] oc-button').getAttribute("aria-expanded"), "true");

        // A non-composed drop never reaches document. The Shadow Root bridge
        // must still receive it and attach exactly one resume.
        await page.evaluate(() => {
            const input = document.querySelector('x-upload[data-zone="application"]').shadowRoot.querySelector("input");
            input.files = new DataTransfer().files;
            globalThis.__contentMessageListener({ type: "DOCUMENT_DRAG_START", kind: "resume", jobId: "job-1" }, null, () => {});
            const event = new Event("drop", { bubbles: true, cancelable: true, composed: false });
            Object.defineProperty(event, "dataTransfer", { value: new DataTransfer() });
            input.closest("label").dispatchEvent(event);
        });
        await page.waitForFunction(() => document.querySelector('x-upload[data-zone="application"]')?.shadowRoot?.querySelector("input")?.files?.length === 1);
        assert.deepEqual(await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("x-upload")].map((host) => [
            host.dataset.zone,
            host.shadowRoot.querySelector("input").files.length
        ]))), { parser: 0, application: 1 });
    } finally {
        await browser.close();
    }
});

test("SmartRecruiters suppresses failed automatic upload loops but allows one explicit retry", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await loadCopilot(page, `<!doctype html><main><form>
            <label>First name<input autocomplete="given-name"></label>
            <label>Email<input type="email" autocomplete="email"></label>
            <label>Phone<input type="tel" autocomplete="tel"></label>
            <label>Resume<input id="file-input" data-testid="file-input" type="file"></label>
            <script>
              document.querySelector('#file-input').addEventListener('change', (event) => {
                event.currentTarget.files = new DataTransfer().files;
              });
            <\/script>
        </form></main>`, {
            portalKind: "smartrecruiters",
            killed: false,
            pack: {
                fileFields: { resume: { testIds: ["file-input"], labelPatterns: ["resume"], eventRecipe: ["change"], attachAttempts: 1, verifyDelayMs: 100 } },
                hotPath: { skipLlmOn: ["FIRST_NAME", "EMAIL", "PHONE", "RESUME"] }
            },
            profile: PROFILE
        });
        await page.waitForFunction(() => globalThis.__extensionOperations.some((item) => item.phase === "DOCUMENT" && item.status === "FAILED"));
        const started = () => page.evaluate(() => globalThis.__extensionOperations.filter((item) => item.phase === "DOCUMENT" && item.status === "STARTED").length);
        assert.equal(await started(), 1);

        await page.evaluate(() => document.querySelector("main").appendChild(document.createElement("div")));
        await page.waitForTimeout(900);
        assert.equal(await started(), 1, "a rescan must not restart an already failed automatic upload");

        await page.evaluate(() => globalThis.__contentMessageListener({ type: "ATTACH_DOCUMENT", kind: "resume", jobId: "job-1" }, null, () => {}));
        await page.waitForFunction(() => globalThis.__extensionOperations.filter((item) => item.phase === "DOCUMENT" && item.status === "STARTED").length === 2);
        assert.equal(await started(), 2, "an explicit candidate retry is allowed once requested");
    } finally {
        await browser.close();
    }
});

test("browser harness auto-fills a React-style form inserted without a page reload", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await page.addInitScript(mockInitScript());
        await page.goto(`data:text/html,${encodeURIComponent("<!doctype html><main id=app><button>Continue</button></main>")}`);
        await page.addScriptTag({ content: runtimeScript });
        await page.addScriptTag({ content: identityScript });
        await page.addScriptTag({ content: datesScript });
        await page.addScriptTag({ content: uploadsScript });
        await page.addScriptTag({ content: hopsScript });
        for (const script of runtimeModuleScripts) await page.addScriptTag({ content: script });
        await page.addScriptTag({ content: contentScript });
        await page.evaluate(() => {
            history.pushState({}, "", "#application");
            document.getElementById("app").innerHTML = `<form>
                <label>Full name<input name="full_name" required></label>
                <label>Email address<input name="email" type="email" required></label>
                <label>Phone number<input name="phone" required></label>
                <label><input name="legal_declaration" type="checkbox" required> I certify this application</label>
            </form>`;
        });
        await page.waitForFunction(() => document.querySelector('input[name="email"]')?.value === "candidate@example.com"
            && document.querySelector('input[name="full_name"]')?.value === "Lavish Garg");
        assert.equal(await page.locator('input[name="email"]').inputValue(), "candidate@example.com");
        assert.equal(await page.locator('input[name="full_name"]').inputValue(), "Lavish Garg");
        assert.equal(await page.locator('input[name="legal_declaration"]').isChecked(), false);
    } finally {
        await browser.close();
    }
});

test("live unpacked extension fills the diagnostic ATS without touching protected fields", async (t) => {
    const jobId = "f533a49d3e98ec9d7a80b0931c770b95";
    const reachable = await fetch("http://127.0.0.1:3001/api/profile").then((response) => response.ok).catch(() => false);
    if (!reachable) {
        t.skip("Local dashboard is not running on 127.0.0.1:3001");
        return;
    }
    const diagnosticUrl = `http://127.0.0.1:3001/extension-diagnostic?jobId=${jobId}`;
    const session = await fetch(`http://127.0.0.1:3001/api/extension/job-context?url=${encodeURIComponent(diagnosticUrl)}`)
        .then((response) => response.json())
        .catch(() => null);
    if (!session?.job) {
        t.skip("Diagnostic job is not available for a live extension session.");
        return;
    }
    if (session.application?.status === "SUCCESS") {
        t.skip("Diagnostic application is already SUCCESS; COPILOT will not refill it.");
        return;
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-hunter-ext-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        channel: "chromium",
        ignoreDefaultArgs: ["--disable-extensions"],
        args: [
            `--disable-extensions-except=${path.join(root, "extension")}`,
            `--load-extension=${path.join(root, "extension")}`
        ]
    });
    try {
        const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
        if (!worker) throw new Error("The unpacked COPILOT extension did not start.");
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:3001/extension-diagnostic?jobId=${jobId}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#job-hunter-copilot-host, input[name=full_name]", { timeout: 20000 });
        await page.waitForFunction(() => {
            const name = document.querySelector('input[name="full_name"]')?.value || "";
            const email = document.querySelector('input[name="email"]')?.value || "";
            return name.includes("Lavish") && email.includes("@");
        }, null, { timeout: 25000 });
        assert.match(await page.locator('input[name="full_name"]').inputValue(), /Lavish/);
        assert.match(await page.locator('input[name="email"]').inputValue(), /@/);
        assert.ok(String(await page.locator('input[name="phone"]').inputValue()).length >= 8);

        await page.locator('section.step:not([hidden]) button.next').filter({ hasText: "Next" }).click();
        await page.waitForSelector('input[name="resume"]', { state: "visible" });
        await page.waitForFunction(() => document.querySelector('input[name="resume"]')?.files?.length === 1, null, { timeout: 20000 });
        assert.equal(await page.locator('input[name="resume"]').evaluate((input) => input.files.length), 1);

        await page.locator('section.step:not([hidden]) button.next').filter({ hasText: "Next" }).click();
        await page.waitForSelector('input[name="captcha_code"]', { state: "visible" });
        assert.equal(await page.locator('input[name="captcha_code"]').inputValue(), "");
        assert.equal(await page.locator('input[name="legal_declaration"]').isChecked(), false);
        assert.equal(await page.locator('select[name="gender"]').inputValue(), "");
        assert.equal(await page.locator('input[name="bot_trap"]').inputValue(), "");
    } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
    }
});

test("HTML Open with Extension never navigates the dashboard to the employer site", async (t) => {
    const jobId = "f533a49d3e98ec9d7a80b0931c770b95";
    const reachable = await fetch("http://127.0.0.1:3001/api/profile").then((response) => response.ok).catch(() => false);
    if (!reachable) {
        t.skip("Local dashboard is not running on 127.0.0.1:3001");
        return;
    }
    const response = await fetch(`http://127.0.0.1:3001/jobs/${jobId}/open-with-extension`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" },
        body: `panel=matches&job=${jobId}`,
        redirect: "manual"
    });
    assert.equal(response.status, 303);
    const location = response.headers.get("location") || "";
    assert.match(location, /^\/\?/);
    assert.match(location, /job=/);
    assert.doesNotMatch(location, /linkedin\.com/i);
});

test("Open with Extension keeps the dashboard tab and opens a grouped application tab", async (t) => {
    const reachable = await fetch("http://127.0.0.1:3001/api/profile").then((response) => response.ok).catch(() => false);
    if (!reachable) {
        t.skip("Local dashboard is not running on 127.0.0.1:3001");
        return;
    }
    const feed = await fetch("http://127.0.0.1:3001/api/jobs").then((response) => response.json()).catch(() => null);
    const launchableJob = feed?.jobs?.find((job) => job?.id && job?.url && job.application_status !== "SUCCESS");
    if (!launchableJob) {
        t.skip("No non-submitted job is currently available for the live extension launch test.");
        return;
    }
    const jobId = launchableJob.id;
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-hunter-open-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        channel: "chromium",
        ignoreDefaultArgs: ["--disable-extensions"],
        args: [
            `--disable-extensions-except=${path.join(root, "extension")}`,
            `--load-extension=${path.join(root, "extension")}`
        ]
    });
    try {
        context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
        const page = await context.newPage();
        page.on("dialog", (dialog) => dialog.dismiss());
        await page.goto(`http://127.0.0.1:3001/?job=${jobId}`, { waitUntil: "domcontentloaded" });
        const dashboardUrl = page.url();
        // Asset preparation and the local extension handshake can contend with the
        // other browser fixtures in the full suite. The page event is still the
        // contract; allow enough time for the dashboard POST to finish under load.
        const opened = context.waitForEvent("page", { timeout: 45000 });
        await page.getByRole("button", { name: /Open with Extension/ }).click();
        const applicationPage = await opened;
        await page.waitForTimeout(1500);
        assert.match(page.url(), /127\.0\.0\.1:3001/);
        assert.doesNotMatch(page.url(), /linkedin\.com/i);
        assert.equal(new URL(dashboardUrl).origin, "http://127.0.0.1:3001");
        assert.ok(applicationPage);
        assert.notEqual(applicationPage, page);
        const host = await applicationPage.evaluate(() => Boolean(document.querySelector("#job-hunter-copilot-host"))).catch(() => false);
        const title = await applicationPage.title().catch(() => "");
        assert.ok(host || /linkedin|rippling|alaan|apply|job/i.test(`${applicationPage.url()} ${title}`));
    } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
    }
});

const wellfoundForm = `<!doctype html><form role="dialog" aria-label="Apply to EarnIn">
    <label>Full name<input name="full_name" required></label>
    <label>Email address<input name="email" type="email" required></label>
    <div class="dropzone">
        <p>Drag to upload your resume, or browse</p>
        <input type="file" accept=".pdf,.doc,.docx" style="display:none">
    </div>
    <label>Cover letter<textarea placeholder="Write a note to EarnIn."></textarea></label>
</form>
<form hidden>
    <label>How many years of experience do you have in Backend Engineering?<input type="file" name="screening_file" style="display:none"></label>
</form>`;

test("Wellfound-style hidden resume dropzone attaches and cover-letter note is filled", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await loadCopilot(page, wellfoundForm);
        await page.waitForFunction(() => document.querySelector(".dropzone input[type=file]")?.files?.length === 1
            && /Dear Hiring Manager/.test(document.querySelector("textarea")?.value || "")
            && globalThis.__extensionMessages.includes("VALIDATE_FORM"));
        assert.equal(await page.locator(".dropzone input[type=file]").evaluate((input) => input.files?.[0]?.name), "resume-job-1.pdf");
        assert.match(await page.locator("textarea").inputValue(), /Dear Hiring Manager/);
        assert.equal(await page.locator("input[name=screening_file]").evaluate((input) => input.files?.length || 0), 0);

        await page.evaluate(() => {
            const input = document.querySelector(".dropzone input[type=file]");
            const transfer = new DataTransfer();
            input.files = transfer.files;
        });
        await page.evaluate(() => globalThis.__contentMessageListener({ type: "DOCUMENT_DRAG_START", kind: "resume" }, null, () => {}));
        assert.ok(await page.locator(".dropzone").evaluate((node) => node.classList.contains("job-hunter-drop-target")));
        await page.locator(".dropzone p").click();
        await page.waitForFunction(() => document.querySelector(".dropzone input[type=file]")?.files?.length === 1);
        assert.equal(await page.locator(".dropzone input[type=file]").evaluate((input) => input.files?.[0]?.name), "resume-job-1.pdf");

        await page.evaluate(() => { document.querySelector("textarea").value = ""; });
        await page.evaluate(() => globalThis.__contentMessageListener({ type: "DOCUMENT_DRAG_START", kind: "cover" }, null, () => {}));
        await page.locator("textarea").click();
        await page.waitForFunction(() => /Dear Hiring Manager/.test(document.querySelector("textarea")?.value || ""));
    } finally {
        await browser.close();
    }
});

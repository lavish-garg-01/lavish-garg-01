import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
    buildAssistCards,
    detectApplySurface,
    extractAssistQuestions,
    resolveAssistSession
} from "../src/services/applySupport.js";
import { clusterHygieneReason } from "../src/services/learnProposer.js";
import { extractFileControls } from "../src/services/formAGate.js";
import { normalizeQuestionKey } from "../src/services/questionResolver.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fixture = (name) => read(`test/fixtures/${name}`);

function loadUploads(pack) {
    const sandbox = { URL, console };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(read("extension/adapters/runtime.js"), sandbox);
    sandbox.JobHunterAdapterRuntime.apply({ portalKind: pack.portalKind, pack });
    vm.runInNewContext(read("extension/adapters/common/uploads.js"), sandbox);
    return sandbox.JobHunterUploads;
}

function fakeFile({ testId = "", automationId = "", name = "resume" } = {}) {
    return {
        name,
        id: "",
        type: "file",
        getAttribute(attr) {
            if (attr === "data-testid") return testId;
            if (attr === "data-qa") return "";
            if (attr === "data-field") return "";
            if (attr === "data-automation-id") return automationId;
            if (attr === "aria-label") return "";
            return "";
        },
        parentElement: null
    };
}

test("iframe fills apply the mapping pack, re-inject silent frames, and attach into the selected frame", () => {
    const content = read("extension/content.js");
    const background = read("extension/background.js");
    const host = fixture("live-greenhouse-iframe-host.html");
    const inner = fixture("live-greenhouse-iframe-inner.html");

    assert.match(host, /id="grnhse_iframe"/);
    assert.match(inner, /id="grnhse_app"/);
    assert.match(inner, /data-testid="resume"/);
    assert.match(inner, /data-testid="cover_letter"/);

    assert.match(content, /async function bootstrap\(\) \{[\s\S]{0,180}applyAdapterRuntime\(\)/);
    assert.doesNotMatch(content, /isTopFrame \? applyAdapterRuntime\(\) : Promise\.resolve\(null\)/);
    assert.match(content, /request\.type === "PROBE_FORM"[\s\S]{0,250}applyAdapterRuntime\(\)/);

    assert.match(background, /async function injectScriptsIntoFrame/);
    assert.match(background, /chrome\.scripting\.executeScript/);
    assert.match(background, /frameIds: \[frameId\]/);
    assert.match(background, /async function selectApplicationFrame/);
    assert.match(background, /async function deliverToApplicationFrame/);
    assert.match(background, /case "FILL_CHILD_FRAMES"[\s\S]{0,500}selectApplicationFrame/);
    assert.match(background, /case "ATTACH_DOCUMENT"[\s\S]{0,400}deliverToApplicationFrame/);
    assert.match(background, /deliverToApplicationFrame\([\s\S]{0,80}REPLACE_RESUME_DOCUMENT/);
});

test("Workday data-automation-id and pack testIds identify resume vs cover letter", () => {
    const workday = JSON.parse(read("src/adapters/packs/workday.json"));
    const uploads = loadUploads(workday);
    const html = fixture("form-a-workday.html");
    const controls = extractFileControls(html);
    assert.equal(controls.find((control) => control.fieldHint === "resume")?.testId, "file-upload-input-resume");
    assert.equal(controls.find((control) => control.fieldHint === "cover_letter")?.testId, "file-upload-input-coverLetter");

    assert.equal(uploads.uploadLabelFor(fakeFile({ automationId: "file-upload-input-resume" })), "Resume");
    assert.equal(uploads.uploadLabelFor(fakeFile({ automationId: "file-upload-input-coverLetter", name: "cover_letter" })), "Cover letter");
    assert.equal(uploads.isResumeUploadField({ label: "Resume", name: "resume" }), true);
    assert.equal(uploads.isCoverLetterUploadField({ label: "Cover letter", name: "cover_letter" }), true);
});

test("combobox fill uses activedescendant, keyboard confirm, and broader option selectors", () => {
    const content = read("extension/content.js");
    const html = fixture("live-combobox-activedescendant.html");
    assert.match(html, /aria-activedescendant="location-opt-gurugram"/);
    assert.match(html, /role="listbox"/);
    assert.match(content, /aria-activedescendant/);
    assert.match(content, /function activateComboboxOption/);
    assert.match(content, /async function selectComboboxByKeyboard/);
    assert.match(content, /key: "ArrowDown"/);
    assert.match(content, /key: "Enter"/);
    assert.match(content, /\[id\*="-option-"\]/);
    assert.match(content, /waitForComboboxOptions/);
    assert.match(content, /verifyComboboxSelection/);
    assert.match(content, /\.select__single-value/);
    assert.match(content, /matchConfidence/);
});

test("ordinal Application field N labels are not learned as mapping keys", () => {
    const content = read("extension/content.js");
    const html = fixture("live-rippling-ordinal.html");
    assert.match(html, /name="field-1"/);
    assert.match(html, /data-testid="input-resume"/);
    assert.match(content, /application field\\s\+\\d\+/);
    assert.match(content, /skipLearning:/);
    assert.match(content, /filter\(\(field\) => !field\.skipLearning\)/);
    assert.equal(clusterHygieneReason({ semanticKey: "EMAIL", fieldLabel: "Application field 2" }), "UNLABELED_CLUSTER");
    assert.equal(clusterHygieneReason({ semanticKey: "NOTICE_PERIOD", fieldLabel: "Notice period" }), null);
});

test("GET_HOT_PATH awaits a fresh mapping pack so CANARY is used on the next fill", () => {
    const background = read("extension/background.js");
    assert.match(background, /async function mappingPackFor\(url, \{ fresh = false \} = \{\}\)/);
    assert.match(background, /GET_ADAPTER_RUNTIME[\s\S]{0,180}mappingPackFor\(url, \{ fresh: true \}\)/);
    assert.match(background, /GET_HOT_PATH[\s\S]{0,220}mappingPackFor\(url, \{ fresh: true \}\)/);
    assert.match(background, /if \(!fresh\) \{/);
});

test("Naukri chat Backend Development uses total experience; Node.js does not", () => {
    const html = fixture("live-naukri-chat.html");
    const hops = read("extension/adapters/common/hops.js");
    assert.match(html, /Type message here/);
    assert.match(html, /Backend Development/);
    assert.match(hops, /jobs-easy-apply-modal/);
    assert.match(hops, /label, legend/);
    assert.match(hops, /slice\(-8\)/);

    assert.equal(
        normalizeQuestionKey("How many years of experience do you have in Backend Development?"),
        "TOTAL_EXPERIENCE"
    );
    assert.notEqual(
        normalizeQuestionKey("How many years of experience do you have with Node.js?"),
        "TOTAL_EXPERIENCE"
    );

    const naukri = resolveAssistSession({
        url: "https://www.naukri.com/job-listings-airtel",
        pageText: html.replace(/<[^>]+>/g, " "),
        portalKind: "naukri",
        questions: ["How many years of experience do you have in Backend Development?"],
        profile: {
            totalExperienceYears: 7,
            currentLocation: "Gurugram",
            currentCTC: "32 LPA",
            noticePeriodDays: 30,
            phone: "9999999999",
            email: "a@b.com"
        }
    });
    assert.equal(naukri.applySupport.mode, "ASSIST");
    assert.equal(naukri.applySupport.surface, "chat_apply");
    const current = naukri.cards.find((card) => card.kind === "current");
    assert.equal(current.semanticKey, "TOTAL_EXPERIENCE");
    assert.equal(current.copy, "7");
    assert.equal(current.missing, false);

    const tech = buildAssistCards({
        questions: ["How many years of experience do you have with Node.js?"],
        profile: { totalExperienceYears: 7 }
    });
    const techCurrent = tech.find((card) => card.kind === "current");
    assert.equal(techCurrent.missing, true);
    assert.notEqual(techCurrent.semanticKey, "TOTAL_EXPERIENCE");
});

test("LinkedIn Easy Apply modal is Assist and scrapes education and authorization questions", () => {
    const html = fixture("live-linkedin-easy-apply.html");
    const pageText = html.replace(/<[^>]+>/g, " ");
    const surface = detectApplySurface({
        url: "https://www.linkedin.com/jobs/view/123/easy-apply",
        portalKind: "linkedin",
        easyApplyUi: true,
        pageText
    });
    assert.equal(surface.mode, "ASSIST");
    assert.equal(surface.surface, "easy_apply");

    const questions = extractAssistQuestions(pageText);
    assert.ok(questions.some((question) => /bachelor/i.test(question)));
    assert.ok(questions.some((question) => /authorized to work|javascript/i.test(question)));

    const cards = buildAssistCards({
        pageText,
        questions,
        profile: { totalExperienceYears: 7, currentLocation: "Gurugram" }
    });
    const jsYears = cards.find((card) => /javascript/i.test(card.question || ""));
    assert.ok(jsYears);
    assert.notEqual(jsYears.semanticKey, "TOTAL_EXPERIENCE");
    assert.equal(jsYears.missing, true);
});

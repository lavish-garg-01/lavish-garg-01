import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = fs.readFileSync(path.join(root, "extension/content.js"), "utf8");
const uploads = fs.readFileSync(path.join(root, "extension/adapters/common/uploads.js"), "utf8");
const verifier = fs.readFileSync(path.join(root, "extension/runtime/verifier.js"), "utf8");
const scripts = content + "\n" + uploads;

function loadIdentity() {
    const sandbox = { globalThis: {} };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(root, "extension/adapters/common/identity.js"), "utf8"), sandbox);
    return sandbox.JobHunterIdentity;
}

test("location and years-of-experience resolve from the profile instead of a model", async () => {
    const { normalizeQuestionKey } = await import("../src/services/questionResolver.js");
    const { inferFieldSemantic } = await import("../src/services/fieldOntology.js");
    const { allowAiForSemanticKey } = await import("../src/adapters/hotPath.js");

    assert.equal(normalizeQuestionKey("Location"), "CURRENT_LOCATION");
    assert.equal(normalizeQuestionKey("City"), "CURRENT_LOCATION");
    assert.equal(normalizeQuestionKey("How many years of experience do you have in your field?"), "TOTAL_EXPERIENCE");
    assert.equal(normalizeQuestionKey("Years of experience"), "TOTAL_EXPERIENCE");
    assert.equal(normalizeQuestionKey("Experience"), "TOTAL_EXPERIENCE");
    assert.equal(normalizeQuestionKey("How many years of work experience?"), "TOTAL_EXPERIENCE");
    // Technology questions are role-specific and must not take the profile total.
    assert.equal(normalizeQuestionKey("How many years of experience do you have with Node.js?"), "NODEJS_EXPERIENCE");
    assert.equal(normalizeQuestionKey("Years of experience with React"), "YEARS_OF_EXPERIENCE_WITH_REACT");

    assert.equal(inferFieldSemantic({ label: "Location" }).key, "CURRENT_LOCATION");
    assert.equal(inferFieldSemantic({ label: "Experience" }).key, "TOTAL_EXPERIENCE");
    assert.equal(inferFieldSemantic({ label: "Years of experience with Kafka" }).key, "CUSTOM_FIELD");

    assert.equal(allowAiForSemanticKey("CURRENT_LOCATION"), false);
    assert.equal(allowAiForSemanticKey("TOTAL_EXPERIENCE"), false);
    assert.equal(allowAiForSemanticKey("KAFKA_EXPERIENCE"), true);
});

test("the extension hot path fills location and experience only on plain text controls", () => {
    const identity = loadIdentity();
    const profile = { name: "Test Person", email: "t@example.com", currentLocation: "Gurugram, Haryana, India", totalExperienceYears: 3.5 };
    const planned = identity.plan([
        { id: "loc-text", label: "Location", type: "text", value: "" },
        { id: "loc-combo", label: "Location", type: "combobox", value: "" },
        { id: "yoe", label: "Years of experience", type: "number", value: "" },
        { id: "kafka", label: "Years of experience with Kafka", type: "number", value: "" }
    ], profile);
    const byField = new Map(planned.actions.map((action) => [action.fieldId, action]));
    assert.equal(byField.get("loc-text").value, "Gurugram, Haryana, India");
    assert.equal(byField.get("loc-text").semanticKey, "CURRENT_LOCATION");
    assert.equal(byField.get("yoe").value, "3.5");
    // A suggestion widget needs the resolver's option matching, not a blind type.
    assert.equal(byField.has("loc-combo"), false);
    assert.equal(byField.has("kafka"), false);
});

test("the hot profile carries the facts the local plan needs", () => {
    const background = fs.readFileSync(path.join(root, "extension/background.js"), "utf8");
    const slim = background.slice(background.indexOf("function slimHotProfile"), background.indexOf("function mappingPackStorageKey"));
    assert.match(slim, /currentLocation/);
    assert.match(slim, /totalExperienceYears/);
    // Protected facts stay out of the cached hot profile.
    assert.doesNotMatch(slim, /currentCTC|expectedCTC|dateOfBirth|passport/);
});

test("comboboxes retry with a narrowed answer and never leave unselected text", () => {
    assert.match(content, /async function fillCombobox/);
    assert.match(content, /aria-controls/);
    assert.match(content, /function comboboxSearchQueries/);
    assert.match(content, /for \(const character of String\(text\)\)/);
    assert.match(content, /bestComboboxOption/);
    assert.match(content, /match\.confidence < 0\.8/);
    assert.match(content, /selectionVerified = await verifyComboboxSelection/);
    // Restores the page value when no suggestion matched.
    assert.match(content, /if \(element\.value !== original\) \{\s*\n\s*setNativeValue\(element, original\)/);
    assert.doesNotMatch(content, /if \(active\) \{\s*\n\s*activateComboboxOption\(active\)/);
});

test("plain text fills are verified after framework events instead of reporting a cleared value as filled", () => {
    assert.match(content, /async function textFillStuck/);
    assert.match(content, /textVerifyDelayMs/);
    assert.match(content, /verifier\.verifyText\(element, expected\)/);
    assert.match(verifier, /await delay\(Number\(textVerifyDelay\?\.\(\)\) \|\| 120\)/);
    assert.match(verifier, /element\?\.getAttribute\?\.\("aria-invalid"\) === "true"/);
    assert.match(content, /return textFillStuck\(element, formatted \|\| answer\)/);
});

test("resume attach is idempotent and uses portal-specific retries for controls that swap or clear the file", () => {
    assert.match(scripts, /attachAttempts: 3/);
    assert.match(scripts, /fileAttachAttempts/);
    assert.match(scripts, /for \(let attempt = 1; attempt <= maxAttempts/);
    assert.match(scripts, /attachmentLedger/);
    assert.match(scripts, /attachmentFlights/);
    assert.match(scripts, /function attachmentConfirmed/);
    // Re-resolves the control each attempt because the node may be detached.
    assert.match(scripts, /const element = (?:host\.)?control\(field\);\s*\n\s*if \(!element\) break;/);
    assert.match(scripts, /uploaded\|attached/);
    assert.match(uploads, /prior\?\.status === "FAILED" && !force/);
    assert.match(uploads, /Automatic attachment already failed/);
    assert.match(uploads, /async function attachDraggedDocument\(kind, target, \{ force = true \} = \{\}\)/);
});

test("split date sections become one date field and are filled per section", () => {
    assert.match(content, /type: "date-parts"/);
    assert.match(content, /const sections = dateSectionInputs\(element\);/);
    assert.match(content, /for \(const kind of \["month", "day", "year"\]\)/);
    // A bare number is a value, never a question label.
    assert.match(content, /\/\^\\d\{1,4\}\$\/\.test\(token\)/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveQuestion } from "../src/services/questionResolver.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("SmartRecruiters uses a one-event, one-attempt document recipe", () => {
    const pack = JSON.parse(read("src/adapters/packs/smartrecruiters.json"));
    assert.deepEqual(pack.fileFields.resume.eventRecipe, ["change"]);
    assert.equal(pack.fileFields.resume.attachAttempts, 1);
    assert.deepEqual(pack.fileFields.coverLetter.eventRecipe, ["change"]);
    const uploads = read("extension/adapters/common/uploads.js");
    assert.match(uploads, /attachmentLedger/);
    assert.match(uploads, /attachmentFlights/);
    assert.match(uploads, /operationKey/);
    assert.match(uploads, /CONFIRMED/);
});

test("dynamic rescans process new fields and bounded blank repairs without replaying the whole known form", () => {
    const content = read("extension/content.js");
    assert.match(content, /incrementalOnly: true/);
    assert.match(content, /knownFieldIds/);
    assert.match(content, /verifiedFillLedger/);
    assert.match(content, /knownFieldNeedsRepair/);
    assert.match(content, /detectedFields\.filter\(\(field\) => !knownFieldIds\.has\(field\.id\) \|\| knownFieldNeedsRepair\(field\)\)/);
    assert.match(content, /previous\.repairAttempts >= 2/);
    assert.match(content, /ownership\.isUserEdited\(field\.id\)/);
});

test("an extension reload deactivates the stale content script without recursive reporting errors", () => {
    const content = read("extension/content.js");
    assert.match(content, /cachedExtensionVersion/);
    assert.match(content, /isExtensionContextInvalidation/);
    assert.match(content, /deactivateInvalidatedContext/);
    assert.match(content, /dynamicObserver\?\.disconnect/);
    assert.match(content, /Job Hunter was updated\. Refresh this application page to reconnect\./);
    const adapterContext = content.match(/function adapterContext\(\) \{[\s\S]*?\n    \}/)?.[0] || "";
    assert.match(adapterContext, /extensionVersion: cachedExtensionVersion/);
    assert.doesNotMatch(adapterContext, /chrome\.runtime/);
});

test("structured history resolves the requested resume record index", async () => {
    const profile = { name: "Asha Rao", email: "asha@example.com" };
    const resume = {
        experience: [
            { title: "Lead Engineer", company: "First" },
            { title: "Backend Engineer", company: "Second" }
        ],
        education: [
            { school: "First School", degree: "B.Sc" },
            { school: "Second School", degree: "M.Sc" }
        ]
    };
    const role = await resolveQuestion("EXPERIENCE_TITLE", { profile, resume, allowAi: false,
        field: { label: "Title", type: "text", sectionKind: "experience", sectionIndex: 1 } });
    const school = await resolveQuestion("EDUCATION_INSTITUTION", { profile, resume, allowAi: false,
        field: { label: "Institution", type: "text", sectionKind: "education", sectionIndex: 1 } });
    assert.equal(role.answer, "Backend Engineer");
    assert.equal(school.answer, "Second School");
    assert.equal(role.source, "RESUME");
});

test("operation evidence is append-only and excludes raw application values", () => {
    const schema = read("src/database/schema.sql");
    const routes = read("src/routes/extension.js");
    assert.match(schema, /CREATE TABLE IF NOT EXISTS application_operation_events/);
    assert.match(routes, /operation-event/);
    assert.doesNotMatch(schema.match(/CREATE TABLE IF NOT EXISTS application_operation_events[\s\S]*?\);/)?.[0] || "", /application_value|raw_value/);
});

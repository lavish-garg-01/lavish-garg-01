import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDates() {
    const sandbox = { globalThis: {} };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(root, "extension/adapters/common/dates.js"), "utf8"), sandbox);
    const dates = sandbox.JobHunterDates;
    // Objects built inside the sandbox realm need copying before deep-equal.
    const local = (value) => (value == null ? value : { ...value });
    return {
        ...dates,
        parseDateParts: (value) => local(dates.parseDateParts(value)),
        sectionValues: (value) => local(dates.sectionValues(value))
    };
}

test("date answers are read from every shape an ATS or resume produces", () => {
    const dates = loadDates();
    assert.deepEqual(dates.parseDateParts("2024-05-17"), { year: 2024, month: 5, day: 17 });
    assert.deepEqual(dates.parseDateParts("2024-05"), { year: 2024, month: 5, day: null });
    assert.deepEqual(dates.parseDateParts("05/2024"), { year: 2024, month: 5, day: null });
    assert.deepEqual(dates.parseDateParts("17/05/2024"), { year: 2024, month: 5, day: 17 });
    assert.deepEqual(dates.parseDateParts("05/17/2024"), { year: 2024, month: 5, day: 17 });
    assert.deepEqual(dates.parseDateParts("May 2024"), { year: 2024, month: 5, day: null });
    assert.deepEqual(dates.parseDateParts("Sept 2023"), { year: 2023, month: 9, day: null });
    assert.deepEqual(dates.parseDateParts("17 May 2024"), { year: 2024, month: 5, day: 17 });
    assert.equal(dates.parseDateParts("Immediately"), null);
    assert.equal(dates.parseDateParts("2 years"), null);
    assert.equal(dates.parseDateParts(""), null);
    assert.equal(dates.parseDateParts("13/13/2024"), null);
});

test("date fills follow the format the employer control declares", () => {
    const dates = loadDates();
    // Workday employment history asks for month and year only.
    assert.equal(dates.formatForField("2024-05-17", { placeholder: "MM/YYYY" }), "05/2024");
    assert.equal(dates.formatForField("May 2024", { label: "From* (MM/YYYY)" }), "05/2024");
    // Keka and other India-first portals use day-first masks.
    assert.equal(dates.formatForField("2024-05-17", { placeholder: "dd/MM/yyyy" }), "17/05/2024");
    assert.equal(dates.formatForField("2024-05", { placeholder: "dd/MM/yyyy" }), "01/05/2024");
    assert.equal(dates.formatForField("17/05/2024", { placeholder: "MM/DD/YYYY" }), "05/17/2024");
    assert.equal(dates.formatForField("2024-05-17", { inputType: "date" }), "2024-05-17");
    assert.equal(dates.formatForField("May 2024", { inputType: "month" }), "2024-05");
    assert.equal(dates.formatForField("2024-05-17", { placeholder: "MMM yyyy" }), "May 2024");
    // No declared format means the raw answer is left alone.
    assert.equal(dates.formatForField("2024-05-17", { label: "Start date" }), null);
    // A non-date answer is never reshaped into a date.
    assert.equal(dates.formatForField("Immediately", { placeholder: "MM/YYYY" }), null);
});

test("split month/day/year sections are recognised and given padded values", () => {
    const dates = loadDates();
    assert.equal(dates.sectionKind("dateSectionMonth-input"), "month");
    assert.equal(dates.sectionKind("dateSectionDay-input"), "day");
    assert.equal(dates.sectionKind("dateSectionYear-input"), "year");
    assert.equal(dates.sectionKind("month"), "month");
    assert.equal(dates.sectionKind("year"), "year");
    assert.equal(dates.sectionKind("email"), null);
    assert.deepEqual(dates.sectionValues(dates.parseDateParts("2024-05")), { month: "05", day: null, year: "2024" });
    assert.deepEqual(dates.sectionValues(dates.parseDateParts("2024-05-07")), { month: "05", day: "07", year: "2024" });
});

test("content script wires the date module into detection and fill", () => {
    const content = fs.readFileSync(path.join(root, "extension/content.js"), "utf8");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
    assert.equal(manifest.content_scripts[0].js.includes("adapters/common/dates.js"), true);
    assert.match(content, /JobHunterDates/);
    assert.match(content, /date-parts/);
    assert.match(content, /dateSectionInputs/);
    const datesSrc = fs.readFileSync(path.join(root, "extension/adapters/common/dates.js"), "utf8");
    assert.match(datesSrc, /function sectionInputs/);
    assert.match(datesSrc, /function sectionKindFromElement/);
});

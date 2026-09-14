import assert from "node:assert/strict";
import test from "node:test";
import { learningNoteValue } from "./learning-note-value.js";

const consent = { expectedCurrentVersionId: null, confirmedGlobalDefault: true as const };
test("reviewed salary keeps exact explicit scale, currency and period", () => {
  for (const [answer, scale] of [["1400000", "BASE"], ["14", "LAKH"], ["0.14", "CRORE"]] as const) {
    const result = learningNoteValue({ ...consent, canonicalKey: "CURRENT_CTC", answer, currency: "INR", scale, period: "YEAR" });
    assert.equal(result.display, "INR 1400000 per year");
    assert.deepEqual(result.normalizedValue, { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "MONEY", amountExact: "1400000", currency: "INR", period: "YEAR" });
  }
  assert.equal(learningNoteValue({ ...consent, canonicalKey: "EXPECTED_CTC", answer: "14.123456", currency: "INR", scale: "LAKH", period: "MONTH" }).display, "INR 1412345.6 per month");
  for (const invalid of [
    { canonicalKey: "CURRENT_CTC", answer: "14" },
    { canonicalKey: "CURRENT_CTC", answer: "14", currency: "USD", scale: "LAKH", period: "YEAR" },
    { canonicalKey: "CURRENT_CTC", answer: "14", currency: "XYZ", scale: "BASE", period: "YEAR" },
    { canonicalKey: "CURRENT_CTC", answer: "1,4", currency: "INR", scale: "LAKH", period: "YEAR" },
    { canonicalKey: "CURRENT_CTC", answer: "14LPA", currency: "INR", scale: "LAKH", period: "YEAR" },
    { canonicalKey: "CURRENT_CTC", answer: "-14", currency: "INR", scale: "LAKH", period: "YEAR" }
  ]) assert.throws(() => learningNoteValue({ ...consent, ...invalid } as never));
});

test("notice, experience and calendar dates remain distinct typed facts", () => {
  assert.match(learningNoteValue({ ...consent, canonicalKey: "NOTICE_PERIOD", answer: "45", unit: "DAYS" }).display, /45 days.*not a joining date/);
  assert.equal(learningNoteValue({ ...consent, canonicalKey: "TOTAL_EXPERIENCE", answer: "44", unit: "MONTHS" }).display, "3 years 8 months (44 months total)");
  assert.equal(learningNoteValue({ ...consent, canonicalKey: "LAST_WORKING_DAY", answer: "2024-02-29" }).normalizedValue.kind, "DATE");
  for (const invalid of [
    { canonicalKey: "NOTICE_PERIOD", answer: "45" },
    { canonicalKey: "NOTICE_PERIOD", answer: "3651", unit: "DAYS" },
    { canonicalKey: "TOTAL_EXPERIENCE", answer: "3.5", unit: "MONTHS" },
    { canonicalKey: "TOTAL_EXPERIENCE", answer: "1201", unit: "MONTHS" },
    { canonicalKey: "LAST_WORKING_DAY", answer: "2025-02-29" },
    { canonicalKey: "LAST_WORKING_DAY", answer: "45" },
    { canonicalKey: "START_DATE", answer: "2026-10-01" },
    { canonicalKey: "WORK_MODE_REQUIREMENT", answer: "yes" },
    { canonicalKey: "EMPLOYMENT_TITLE", answer: "Engineer" },
    { canonicalKey: "FIRST_NAME", answer: "Test", confirmedGlobalDefault: false }
  ]) assert.throws(() => learningNoteValue({ ...consent, ...invalid } as never));
});

test("professional links preserve URL type and reject unsafe schemes or credentials", () => {
  assert.equal(learningNoteValue({ ...consent, canonicalKey: "GITHUB_URL", answer: "https://github.com/synthetic" }).normalizedValue.kind, "URL");
  for (const answer of ["javascript:alert(1)", "https://user:secret@example.com", "github.com/synthetic"]) assert.throws(() => learningNoteValue({ ...consent, canonicalKey: "GITHUB_URL", answer }));
});

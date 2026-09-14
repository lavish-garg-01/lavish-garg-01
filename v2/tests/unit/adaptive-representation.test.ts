import assert from "node:assert/strict";
import test from "node:test";
import type { FieldEvidenceInput } from "@job-hunter-v2/contracts";
import type { PersistableNormalizedValue } from "@job-hunter-v2/candidate-truth";
import { exactScale, learnMoney } from "../../packages/domain/src/answer-units.js";
import { RepresentationResolver } from "../../packages/execution/src/representation.js";
import { normalizeObservedFieldValue } from "../../packages/verified-learning/src/normalization.js";

const common = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };
const resolver = new RepresentationResolver();
function field(label: string, controlType: FieldEvidenceInput["controlType"] = "TEXT", options: string[] = []): FieldEvidenceInput {
  return {
    evidenceVersion: 1, fieldRuntimeId: "field:12345678", pageInstanceId: crypto.randomUUID(), formInstanceId: "form:12345678", sectionFingerprint: "section:12345678", controlFingerprint: "control:12345678",
    controlType, labelEvidence: [label], contextEvidence: { section: null, previousLabel: null, nextLabel: null, semanticGroup: null, pageHeading: null, formHeading: null, nearbyDescription: null },
    locatorEvidence: { tagName: controlType === "TEXTAREA" ? "textarea" : "input", type: controlType === "DATE" ? "date" : "text", name: null, id: null, autocomplete: null, ariaLabel: null, placeholder: null, role: null, accessibleDescription: null, occurrence: 0 },
    optionEvidence: { count: options.length, samples: options }, repeatableEvidence: { entityType: null, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel: null }, required: true, disabled: false, ownership: "UNKNOWN"
  };
}
const money = (amount = "1400000", currency = "INR", period: "YEAR" | "MONTH" = "YEAR"): PersistableNormalizedValue => ({ ...common, kind: "MONEY", amountExact: amount, currency, period });
function rendered(value: PersistableNormalizedValue, label: string, control: FieldEvidenceInput["controlType"] = "TEXT", canonicalKey?: string) {
  const result = resolver.resolve(value, field(label, control), canonicalKey ? { canonicalKey } : {});
  assert.equal(result.kind, "TEXT"); if (result.kind !== "TEXT") throw new Error("Expected text"); return result.text;
}
const learn = (canonicalKey: string, raw: string, label: string, countryCode: string | null = "IN") => normalizeObservedFieldValue({ canonicalKey, value: { kind: "TEXT", value: raw }, labelEvidence: [label], countryCode });

for (const [label, amount, sourcePeriod, expected] of [
  ["Current CTC", "1400000", "YEAR", "1400000"],
  ["Current CTC (LPA)", "1400000", "YEAR", "14"],
  ["Current CTC in lakhs", "1400000.01", "YEAR", "14.0000001"],
  ["Expected monthly salary (INR)", "1200000", "YEAR", "100000"],
  ["Annual salary INR", "100000.25", "MONTH", "1200003"],
  ["CTC (LPA)", "100000", "MONTH", "12"],
  ["Salary INR per month", "99999.125", "MONTH", "99999.125"],
  ["CTC in crores", "1400000", "YEAR", "0.14"],
  ["Current CTC", "0", "YEAR", "0"],
  ["Annual salary INR", "9007199254740993.01", "YEAR", "9007199254740993.01"]
] as const) test(`money renders ${label}: ${amount}/${sourcePeriod}`, () => {
  const value = money(amount, "INR", sourcePeriod); const snapshot = structuredClone(value);
  assert.equal(rendered(value, label), expected); assert.deepEqual(value, snapshot);
  const learned = learn("CURRENT_CTC", expected, label);
  assert.equal(learned.kind, "MONEY");
  if (learned.kind === "MONEY") {
    assert.equal(learned.currency, "INR");
    const canonicalAnnual = exactScale(amount, sourcePeriod === "MONTH" ? 12n : 1n);
    assert.equal(exactScale(learned.amountExact, learned.period === "MONTH" ? 12n : 1n), canonicalAnnual);
  }
});

for (const [label, amount] of [
  ["Annual and monthly salary INR", "1200000"], ["Current CTC USD", "1200000"],
  ["Salary per hour INR", "1200000"], ["CTC LPA monthly", "1200000"],
  ["CTC INR USD", "1200000"], ["CTC lakhs crores", "1200000"],
  ["Salary $ per year", "1200000"], ["Monthly salary INR", "1400000"],
  ["CTC", "-1"], ["CTC", "1e6"]
] as const) test(`money abstains: ${label} / ${amount}`, () => assert.throws(() => rendered(money(amount), label)));

test("explicit currency does not default to country currency", () => {
  assert.equal(rendered(money("100000", "EUR"), "Annual salary EUR"), "100000");
  const result = learn("EXPECTED_CTC", "100000", "Annual salary EUR", "IN");
  assert.equal(result.kind === "MONEY" && result.currency, "EUR");
});
for (const [raw, label, country] of [
  ["14", "Salary", null], ["14", "Annual salary", "GB"], ["14", "Salary INR", "IN"],
  ["1,5", "CTC", "IN"], ["-14", "CTC", "IN"], ["1e6", "CTC", "IN"],
  ["14-20", "CTC LPA", "IN"], ["14 USD", "CTC INR", "IN"], ["14", "Annual salary USD LPA", "US"]
]) test(`money learning rejects ambiguous input ${raw}/${label}`, () => assert.throws(() => learn("CURRENT_CTC", raw!, label!, country ?? null)));
for (const [raw, expected] of [["14 LPA", "1400000"], ["14,00,000", "1400000"], ["1,400,000", "1400000"], ["₹1400000", "1400000"], ["0.0000001 LPA", "0.01"]]) {
  test(`money learns explicit value ${raw}`, () => assert.equal(learnMoney(raw!, "CTC", "IN").amountExact, expected));
}

for (const [label, months, control, expected] of [
  ["Total experience", 44, "TEXT", "3 years 8 months"],
  ["Years of experience", 56, "TEXT", "4 years 8 months"],
  ["Completed years of experience", 56, "NUMBER", "4"],
  ["Experience in months", 56, "NUMBER", "56"],
  ["Experience in years", 54, "NUMBER", "4.5"],
  ["Experience", 0, "TEXT", "0 years 0 months"]
] as const) test(`experience ${months}: ${label}`, () => assert.equal(rendered({ ...common, kind: "DURATION", months }, label, control), expected));
for (const [label, months] of [["Experience in years", 56], ["Experience", 44]] as const) test(`numeric experience abstains: ${label}`, () => assert.throws(() => rendered({ ...common, kind: "DURATION", months }, label, "NUMBER")));
for (const [raw, label, months] of [["4 years 8 months", "Experience", 56], ["4.5", "Years of experience", 54], ["56", "Experience months", 56], ["3 years", "Experience", 36]] as const) test(`experience learns exact ${raw}`, () => {
  const result = learn("TOTAL_EXPERIENCE", raw, label); assert.equal(result.kind === "DURATION" && result.months, months);
});
for (const raw of ["4.67", "-1", "4 to 6 yrs", "6+ yrs", "4 years 18 months"]) test(`experience refuses rounded/ranged fact ${raw}`, () => assert.throws(() => learn("TOTAL_EXPERIENCE", raw, "Experience in years")));
test("experience radio bucket is mapped; overlapping boundaries require review", () => {
  const target = field("Years of experience", "RADIO", ["0 to 4 yrs", "4 to 6 yrs", "6+ yrs"]);
  const result = resolver.resolve({ ...common, kind: "DURATION", months: 56 }, target);
  assert.equal(result.kind === "SINGLE_OPTION" && result.option.label, "4 to 6 yrs");
  assert.throws(() => resolver.resolve({ ...common, kind: "DURATION", months: 48 }, target));
});

test("joining availability includes units, never an invented date/anchor", () => {
  const value: PersistableNormalizedValue = { ...common, kind: "INTEGER", value: 45 };
  assert.equal(rendered(value, "If you are offered, by when can you join?", "TEXT", "NOTICE_PERIOD"), "45 days' notice");
  assert.equal(rendered(value, "Notice period (days)", "NUMBER", "NOTICE_PERIOD"), "45");
  assert.throws(() => rendered(value, "Joining date", "DATE", "NOTICE_PERIOD"));
  assert.throws(() => rendered(value, "Joining date dd/mm/yyyy", "TEXT", "NOTICE_PERIOD"));
  assert.throws(() => rendered(value, "Notice period (months)", "NUMBER", "NOTICE_PERIOD"));
  assert.throws(() => rendered(value, "When can you join?", "NUMBER", "NOTICE_PERIOD"));
  const anchored = resolver.resolve(value, field("When can you join?"), { canonicalKey: "NOTICE_PERIOD", temporalAnchor: "OFFER_ACCEPTANCE" });
  assert.equal(anchored.kind === "TEXT" && anchored.text, "45 days after offer acceptance");
});
for (const [raw, label, days] of [["45 days' notice", "When can you join?", 45], ["45 days after offer acceptance", "When can you join?", 45], ["6", "Notice period weeks", 42], ["0", "Notice period days", 0]] as const) test(`notice learns ${raw}`, () => {
  const result = learn("NOTICE_PERIOD", raw, label); assert.equal(result.kind === "INTEGER" && result.value, days);
});
for (const [raw, label] of [["2", "Notice period months"], ["2026-11-01", "Joining date"], ["45 to 60", "Notice period days"], ["-1", "Notice period days"]]) test(`notice refuses ambiguous ${raw}`, () => assert.throws(() => learn("NOTICE_PERIOD", raw!, label!)));

for (const control of ["TEXT", "TEXTAREA"] as const) test(`enum and boolean are compatible with ${control}`, () => {
  assert.equal(rendered({ ...common, kind: "ENUM", value: { key: "LINKEDIN", label: "LinkedIn" } }, "How did you hear about us?", control), "LinkedIn");
  assert.equal(rendered({ ...common, kind: "BOOLEAN", value: true }, "Office preference", control), "Yes");
  assert.equal(rendered({ ...common, kind: "BOOLEAN", value: false }, "Office preference", control), "No");
});
test("section text cannot silently change the salary scale", () => {
  const target = field("Current CTC"); target.contextEvidence.section = "Previous role (LPA)";
  const result = resolver.resolve(money(), target); assert.equal(result.kind === "TEXT" && result.text, "1400000");
});
test("a completed-year bucket cannot reduce an exact learned tenure", () => {
  assert.throws(() => learn("TOTAL_EXPERIENCE", "4", "Completed years of experience"));
});
test("hourly amounts are preserved, not annualized without working hours", () => {
  const hourly: PersistableNormalizedValue = { ...common, kind: "MONEY", amountExact: "500.25", currency: "INR", period: "HOUR" };
  assert.equal(rendered(hourly, "Hourly salary INR"), "500.25");
  assert.throws(() => rendered(hourly, "Annual salary INR"));
});
test("other explicit ISO currencies are never silently treated as INR", () => {
  assert.throws(() => rendered(money(), "Annual salary ZAR"));
  const result = learn("EXPECTED_CTC", "ZAR 400000", "Annual salary", "IN");
  assert.equal(result.kind === "MONEY" && result.currency, "ZAR");
});
test("unsupported scales fail closed", () => {
  assert.throws(() => rendered(money(), "Annual salary in millions INR"));
});
test("unspecified salary period is qualified in text, not guessed in a number box", () => {
  assert.equal(rendered(money(), "Salary"), "INR 1400000 per year");
  assert.throws(() => rendered(money(), "Salary", "NUMBER"));
  const learned = learn("EXPECTED_CTC", rendered(money(), "Salary"), "Salary");
  assert.equal(learned.kind === "MONEY" && learned.amountExact, "1400000");
});
for (const [precision, control, inputType, pass] of [["YEAR", "DATE", "month", false], ["MONTH", "DATE", "date", false], ["MONTH", "DATE", "month", true], ["DAY", "DATE", "date", true]] as const) test(`date precision ${precision} to ${inputType}`, () => {
  const value: PersistableNormalizedValue = { ...common, kind: "DATE", value: { isoDate: "2026-11-01", precision } };
  const target = field("Start date", control); target.locatorEvidence.type = inputType;
  if (pass) assert.equal(resolver.resolve(value, target).kind, "DATE");
  else assert.throws(() => resolver.resolve(value, target));
});

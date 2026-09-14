import assert from "node:assert/strict";
import test from "node:test";
import { normalizeObservedFieldValue } from "./normalization.js";

test("Indian LPA compensation is normalized without changing its canonical truth layer", () => {
  assert.deepEqual(normalizeObservedFieldValue({
    canonicalKey: "EXPECTED_CTC",
    value: { kind: "TEXT", value: "25" },
    labelEvidence: ["Expected CTC (LPA)"],
    countryCode: "IN"
  }), {
    schemaVersion: 1,
    dataClass: "CANDIDATE_PRIVATE",
    kind: "MONEY",
    amountExact: "2500000",
    currency: "INR",
    period: "YEAR"
  });
});

test("duration learning fails closed when the unit is ambiguous", () => {
  assert.throws(() => normalizeObservedFieldValue({ canonicalKey: "TOTAL_EXPERIENCE", value: { kind: "TEXT", value: "5" }, labelEvidence: ["Experience"], countryCode: "IN" }), /unit is not clear/i);
});


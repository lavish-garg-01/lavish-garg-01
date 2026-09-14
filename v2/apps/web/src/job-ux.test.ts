import assert from "node:assert/strict";
import test from "node:test";
import { formatJobCompensation, humanJobValue, primaryMatchMessage } from "./job-ux.js";

test("job UI renders deterministic evidence without inventing missing facts", () => {
  assert.equal(humanJobValue("STRONG_MATCH"), "Strong Match");
  assert.equal(humanJobValue(null), "Not specified");
  assert.equal(formatJobCompensation({ currency: "INR", minimumMinor: 2_000_000_00, maximumMinor: 3_000_000_00, period: "YEAR" }), "₹20,00,000–₹30,00,000");
  assert.equal(formatJobCompensation({ currency: "INR", minimumMinor: null, maximumMinor: null, period: "YEAR" }), null);
  assert.equal(primaryMatchMessage({
    policyVersion: "H1-DETERMINISTIC-2026-09",
    score: 68,
    label: "GOOD_MATCH",
    eligibility: "UNKNOWN",
    reasons: [],
    gaps: [],
    unknowns: [{ code: "SPONSORSHIP_UNKNOWN", message: "Sponsorship is not specified.", evidence: [] }]
  }), "Sponsorship is not specified.");
});

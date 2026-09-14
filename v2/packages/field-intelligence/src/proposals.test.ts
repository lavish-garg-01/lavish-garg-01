import test from "node:test";
import assert from "node:assert/strict";
import { canonicalPromotionChecks } from "./proposals.js";
test("new canonical activation requires reviewed typed policy, migration and independent fixtures", () => {
  const complete = { canonicalKey: "NEW_FIELD", definitionRegistered: true, policyReviewed: true, migrationIncluded: true, positiveFixtures: 2, negativeFixtures: 2, fixturesPassed: true, reviewer: "Reviewer" };
  assert.deepEqual(canonicalPromotionChecks(complete), []);
  for (const missing of [ { reviewer: "" }, { policyReviewed: false }, { migrationIncluded: false }, { definitionRegistered: false }, { fixturesPassed: false }, { positiveFixtures: 1 }, { negativeFixtures: 0 }, { canonicalKey: "untrusted-script()" }]) assert.ok(canonicalPromotionChecks({ ...complete, ...missing }).length);
});

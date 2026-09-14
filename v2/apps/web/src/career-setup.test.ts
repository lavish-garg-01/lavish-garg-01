import test from "node:test";
import assert from "node:assert/strict";
import { CAREER_STEPS, careerValue } from "./CareerSetup.js";
import { PersistableNormalizedValueSchema, canonicalDefinition } from "@job-hunter-v2/candidate-truth";
test("India setup uses exact rupees, integer days and typed registered fields", () => {
  for (const field of CAREER_STEPS.flatMap((step) => step.fields)) {
    const input = field.type === "money" ? "14.25" : field.type === "days" ? "30" : field.type === "boolean" ? "no" : field.type === "date" ? "2026-10-11" : field.type === "url" ? "https://example.com/profile" : "Example";
    const value = PersistableNormalizedValueSchema.parse(careerValue(field, input));
    assert.equal(value.kind, canonicalDefinition(field.key)?.valueType);
    if (value.kind === "MONEY") assert.equal(value.amountExact, "1425000");
    if (value.kind === "BOOLEAN") assert.equal(value.value, false);
  }
  const fields = CAREER_STEPS.flatMap((step) => step.fields);
  const money = fields.find((field) => field.type === "money")!;
  for (const bad of ["-1", "NaN", "1e5", "14.999", "0"]) assert.throws(() => careerValue(money, bad));
  const notice = fields.find((field) => field.type === "days")!;
  assert.equal(careerValue(notice, "0").value, 0);
  for (const bad of ["-1", "30.5", "366", "tomorrow"]) assert.throws(() => careerValue(notice, bad));
});

import assert from "node:assert/strict";
import test from "node:test";
import { classifyJourney, type JourneySignals } from "./application-journey.js";

const base: JourneySignals = { career: false, job: false, knownRoute: false, application: false, controls: 0, resume: false, personal: false, applyActions: 0, social: false, native: false, review: false, success: false, login: false, excluded: false, manual: false, active: false };
test("journey separates jobs, entry actions, forms, review and unverified success", () => {
  for (const [signals, stage, fill] of [
    [{}, "UNRELATED", false],
    [{ career: true, applyActions: 5 }, "JOB_LIST", false],
    [{ job: true, applyActions: 1 }, "JOB_DETAIL", false],
    [{ job: true, social: true }, "APPLICATION_ENTRY", false],
    [{ job: true, application: true, controls: 3, personal: true }, "APPLICATION_FORM", true],
    [{ job: true, resume: true }, "APPLICATION_FORM", true],
    [{ job: true, review: true, controls: 3, personal: true }, "APPLICATION_REVIEW", false],
    [{ job: true, success: true }, "APPLICATION_SUCCESS", false],
    [{ job: true, native: true, controls: 8, application: true }, "APPLICATION_ENTRY", false],
    [{ active: true, login: true }, "AUTH_REQUIRED", false]
  ] as const) {
    const result = classifyJourney({ ...base, ...signals }); assert.equal(result.stage, stage); assert.equal(result.canFill, fill);
  }
});
test("manual inspection is page evidence, not a bypass for passwords, checkout or unrelated forms", () => {
  assert.equal(classifyJourney({ ...base, career: true, controls: 3, personal: true }).stage, "UNCERTAIN");
  assert.equal(classifyJourney({ ...base, career: true, controls: 3, personal: true, manual: true }).canFill, true);
  for (const signals of [{ excluded: true, job: true }, { login: true, job: true }, {}, { native: true, job: true }]) {
    assert.equal(classifyJourney({ ...base, controls: 4, personal: true, manual: true, ...signals }).canFill, false);
  }
});

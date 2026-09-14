import assert from "node:assert/strict";
import test from "node:test";
import { progressHeading } from "./autofill-progress.js";
import type { AutofillProgress } from "../shared/contracts.js";

const progress: AutofillProgress = { pageInstanceId: crypto.randomUUID(), phase: "REVIEW", containsCandidateValue: false, fields: [{ fieldRuntimeId: "field:12345678", canonicalKey: "EMAIL", required: true, state: "COMPLETED", reason: "DOM_READBACK_ONLY" }] };
test("review heading never promises submission readiness", () => {
  assert.equal(progressHeading(progress), "Check your answers before submitting");
  assert.equal(progressHeading({ ...progress, scanIncomplete: true }), "Some questions still need you");
  for (const state of ["PENDING", "ATTENTION", "USER_OWNED", "SKIPPED"] as const) {
    assert.equal(progressHeading({ ...progress, fields: [{ ...progress.fields[0]!, state }] }), "Some questions still need you");
  }
});

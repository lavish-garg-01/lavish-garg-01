import assert from "node:assert/strict";
import test from "node:test";
import type { PersistableNormalizedValue } from "@job-hunter-v2/candidate-truth";
import type { FieldEvidenceInput } from "@job-hunter-v2/contracts";
import { RepresentationError, RepresentationResolver } from "./representation.js";

function field(overrides: Partial<FieldEvidenceInput> = {}): FieldEvidenceInput {
  return {
    evidenceVersion: 1, fieldRuntimeId: "field:12345678", pageInstanceId: crypto.randomUUID(),
    formInstanceId: "form:12345678", sectionFingerprint: "section:12345678",
    controlFingerprint: "control:12345678", controlType: "TEXT",
    labelEvidence: ["Field"],
    contextEvidence: { section: null, previousLabel: null, nextLabel: null, semanticGroup: null, pageHeading: null, formHeading: null, nearbyDescription: null },
    locatorEvidence: { tagName: "input", type: "text", name: null, id: null, autocomplete: null, ariaLabel: null, placeholder: null, role: null, accessibleDescription: null, occurrence: 0 },
    optionEvidence: { count: 0, samples: [] },
    repeatableEvidence: { entityType: null, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel: null },
    required: false, disabled: false, ownership: "UNKNOWN", ...overrides
  };
}

const common = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };

test("notice chooses the tightest truthful upper bound and rejects ambiguous ranges", () => {
  const resolver = new RepresentationResolver();
  const makeField = (samples: string[]) => field({ controlType: "SELECT", labelEvidence: ["3. Notice Period:"], optionEvidence: { count: samples.length, samples } });
  const samples = ["Less than 90 days", "Less than 60 days", "Less than 30 days"];
  for (const [days, expected] of [[45, "Less than 60 days"], [60, "Less than 90 days"], [29, "Less than 30 days"]] as const) {
    const result = resolver.resolve({ ...common, kind: "INTEGER", value: days }, makeField(samples));
    assert.equal(result.kind, "SINGLE_OPTION");
    if (result.kind === "SINGLE_OPTION") assert.equal(result.option.label, expected);
  }
  assert.throws(() => resolver.resolve({ ...common, kind: "INTEGER", value: 90 }, makeField(samples)));
  assert.throws(() => resolver.resolve({ ...common, kind: "INTEGER", value: 30 }, makeField(["0 to 30 days", "30 to 60 days"])));
});

test("representation is explicit for experience years and INR LPA", () => {
  const resolver = new RepresentationResolver();
  const duration = resolver.resolve({ ...common, kind: "DURATION", months: 56 }, field({ labelEvidence: ["Completed years of experience"] }));
  assert.equal(duration.kind, "TEXT");
  if (duration.kind === "TEXT") assert.deepEqual([duration.representationId, duration.text], ["DURATION_COMPLETED_YEARS@2", "4"]);
  const money = resolver.resolve({ ...common, kind: "MONEY", amountExact: "1200000", currency: "INR", period: "YEAR" }, field({ labelEvidence: ["Current CTC (LPA)"] }));
  assert.equal(money.kind, "TEXT");
  if (money.kind === "TEXT") assert.deepEqual([money.representationId, money.text], ["MONEY_INR_YEAR_100000@2", "12"]);
});

test("representation keeps option semantics separate from DOM strategy", () => {
  const resolver = new RepresentationResolver();
  const value: PersistableNormalizedValue = { ...common, kind: "ENUM", value: { key: "IN", label: "India" } };
  const result = resolver.resolve(value, field({ controlType: "SELECT", locatorEvidence: { ...field().locatorEvidence, tagName: "select" } }));
  assert.equal(result.kind, "SINGLE_OPTION");
  if (result.kind === "SINGLE_OPTION") assert.deepEqual(result.option, { key: "IN", label: "India", aliases: ["India", "IN"] });
});

test("files fail closed outside the document authorization flow", () => {
  const resolver = new RepresentationResolver();
  const value: PersistableNormalizedValue = {
    ...common, kind: "FILE_REF", fileId: crypto.randomUUID(), contentSha256: "a".repeat(64),
    fileName: "resume.pdf", mimeType: "application/pdf"
  };
  assert.throws(() => resolver.resolve(value, field({ controlType: "FILE" })), (reason) => reason instanceof RepresentationError && reason.code === "REPRESENTATION_UNSUPPORTED");
});

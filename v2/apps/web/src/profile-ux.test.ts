import assert from "node:assert/strict";
import test from "node:test";
import { correctedValue, displayValue, employmentProfileDrafts, essentialProfileDraft } from "./profile-ux.js";

test("candidate UI renders and corrects supported onboarding values without exposing internals", () => {
  const phone = correctedValue({ kind: "PHONE" }, "+91 98765 43210");
  assert.deepEqual(phone, {
    schemaVersion: 1,
    dataClass: "CANDIDATE_PRIVATE",
    kind: "PHONE",
    countryCode: "+91",
    nationalNumber: "9876543210",
    extension: null
  });
  const skills = correctedValue({ kind: "MULTI_ENUM" }, "TypeScript, Node.js, PostgreSQL");
  assert.equal(displayValue(skills), "TypeScript, Node.js, PostgreSQL");
  assert.equal(displayValue({ kind: "FILE_REF", fileName: "Lavish Resume.pdf" }), "Lavish Resume.pdf");
});

test("the essential editor draft is rebuilt only from current global Candidate Truth", () => {
  assert.deepEqual(essentialProfileDraft([
    { canonicalKey: "FULL_NAME", entityId: null, scopeType: "GLOBAL", normalizedValue: { kind: "STRING", value: "Asha" } },
    { canonicalKey: "EMAIL", entityId: null, scopeType: "GLOBAL", normalizedValue: { kind: "STRING", value: "asha@example.com" } },
    { canonicalKey: "PHONE", entityId: null, scopeType: "GLOBAL", normalizedValue: { kind: "PHONE", countryCode: "+91", nationalNumber: "9000000001" } },
    { canonicalKey: "SKILLS", entityId: null, scopeType: "GLOBAL", normalizedValue: { kind: "MULTI_ENUM", values: [{ key: "typescript", label: "TypeScript" }] } },
    { canonicalKey: "FULL_NAME", entityId: null, scopeType: "COMPANY", normalizedValue: { kind: "STRING", value: "Wrong scope" } }
  ]), {
    name: "Asha",
    email: "asha@example.com",
    phone: "+91 9000000001",
    skills: "TypeScript"
  });
});

test("repeatable employment fields remain grouped by stable entity identity", () => {
  assert.deepEqual(employmentProfileDrafts([
    { answerVersionId: "v2-title", canonicalKey: "EMPLOYMENT_TITLE", entityId: "entity-2", scopeType: "GLOBAL", normalizedValue: { kind: "STRING", value: "Senior Engineer" } },
    { answerVersionId: "v1-company", canonicalKey: "EMPLOYMENT_COMPANY", entityId: "entity-1", scopeType: "GLOBAL", normalizedValue: { kind: "STRING", value: "Alpha" } },
    { answerVersionId: "v2-company", canonicalKey: "EMPLOYMENT_COMPANY", entityId: "entity-2", scopeType: "GLOBAL", normalizedValue: { kind: "STRING", value: "Beta" } },
    { answerVersionId: "v1-title", canonicalKey: "EMPLOYMENT_TITLE", entityId: "entity-1", scopeType: "GLOBAL", normalizedValue: { kind: "STRING", value: "Engineer" } },
    { answerVersionId: "global", canonicalKey: "CURRENT_COMPANY", entityId: null, scopeType: "GLOBAL", normalizedValue: { kind: "STRING", value: "Ignore" } }
  ]), [
    { entityId: "entity-1", company: "Alpha", title: "Engineer", companyVersionId: "v1-company", titleVersionId: "v1-title" },
    { entityId: "entity-2", company: "Beta", title: "Senior Engineer", companyVersionId: "v2-company", titleVersionId: "v2-title" }
  ]);
});

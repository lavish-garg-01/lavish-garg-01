import assert from "node:assert/strict";
import test from "node:test";
import { AiOrchestrator, type ProviderAdapter } from "@job-hunter-v2/ai";
import { FieldSemanticResolver } from "@job-hunter-v2/field-intelligence";
import { fieldAiBridge, OrchestratedResumeCandidateExtractor, entityAiBridge } from "./ai-bridges.js";
import type { FieldEvidenceInput, FieldIntelligencePageContext } from "@job-hunter-v2/contracts";

const scope = { accountId: "10000000-0000-4000-8000-000000000001", candidateId: "20000000-0000-4000-8000-000000000001", applicationId: null, requestId: crypto.randomUUID() };
const page: FieldIntelligencePageContext = { applicationId: null, jobId: null, companyId: null, countryCode: null, roleFamily: null, ats: "GENERIC", host: "fixture.test", pageHeading: null };
function field(label: string): FieldEvidenceInput {
  return {
    evidenceVersion: 1, sectionFingerprint: "section:fixture", pageInstanceId: crypto.randomUUID(), formInstanceId: "form:fixture", fieldRuntimeId: "field:fixture",
    controlFingerprint: "control:fixture", controlType: "TEXT", required: false, disabled: false,
    labelEvidence: [label],
    contextEvidence: { section: null, previousLabel: null, nextLabel: null, semanticGroup: null, pageHeading: "Application", formHeading: "Apply", nearbyDescription: null },
    locatorEvidence: { tagName: "input", type: "text", name: null, id: null, autocomplete: null, ariaLabel: null, placeholder: null, role: null, accessibleDescription: null, occurrence: 0 },
    optionEvidence: { count: 0, samples: [] },
    repeatableEvidence: { entityType: null, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel: null },
    ownership: "UNKNOWN"
  } as unknown as FieldEvidenceInput;
}
function provider(execute: ProviderAdapter["execute"]): ProviderAdapter {
  return { provider: "GROQ", model: "fixture", privacy: ["FIELD_METADATA_ONLY"], maxInputTokens: 50_000, inputMicrosPerToken: 0, outputMicrosPerToken: 0, execute };
}
test("P/J deterministic high-confidence fields avoid provider execution; low confidence traverses P", async () => {
  let calls = 0;
  const ai = new AiOrchestrator([provider(async () => {
    calls++; return { value: { selectedCanonical: "CURRENT_COMPANY", confidence: 0.99, ambiguous: false,
      ranking: [{ canonicalKey: "CURRENT_COMPANY", confidence: 0.99 }], reasonCategory: "LABEL_CONTEXT" }, usage: null };
  })]);
  const resolver = new FieldSemanticResolver(fieldAiBridge(ai));
  const deterministic = await resolver.resolve(field("Email"), page, true, scope);
  assert.equal(deterministic.resolution.state, "RESOLVED_HIGH"); assert.equal(calls, 0);
  await resolver.resolve(field("Company"), page, true, scope);
  assert.ok(calls > 0); assert.equal(ai.snapshot().events[0]?.taskType, "CANONICALIZE_FIELD");
});
test("P/J no route degrades safely; account boundaries do not reuse AI cache", async () => {
  const resolver = new FieldSemanticResolver(fieldAiBridge(new AiOrchestrator([])));
  const result = await resolver.resolve(field("Company"), page, true, scope);
  assert.ok(result.resolution.errorCodes.includes("AI_ROUTE_UNAVAILABLE"));
  assert.equal(result.resolution.state, "AMBIGUOUS");
});
test("P/G deterministic parsing survives absent routes and private AI opt-out", async () => {
  let calls = 0;
  const ai = { execute: async () => { calls++; throw new Error("must not execute"); } };
  const extractor = new OrchestratedResumeCandidateExtractor(ai, false);
  const proposals = await extractor.extract("Example Person\nexample@fixture.test", { ...scope, documentId: crypto.randomUUID(), extractionId: crypto.randomUUID() });
  assert.ok(proposals.some((p) => p.canonicalKey === "EMAIL")); assert.equal(calls, 0);
});
test("P/G large-document proposal uses P and stays a review proposal", async () => {
  let calls = 0;
  const adapter: ProviderAdapter = { ...provider(async () => {
    calls++; return { value: { fields: [{ itemKey: "full-name", canonicalKey: "FULL_NAME", entityType: null,
      entityGroupKey: null, value: { kind: "TEXT", value: "Example Person" }, sourceSection: "HEADER",
      sourceQuote: "Example Person" }] }, usage: null };
  }), provider: "GEMINI", privacy: ["DOCUMENT_PRIVATE_DATA"] };
  const extractor = new OrchestratedResumeCandidateExtractor(new AiOrchestrator([adapter]), true, { extract: async () => [] });
  const result = await extractor.extract("Example Person", { ...scope, documentId: crypto.randomUUID(), extractionId: crypto.randomUUID() });
  assert.equal(calls, 1); assert.equal(result[0]?.canonicalKey, "FULL_NAME");
  assert.ok(result[0]?.reasonCodes.includes("CANDIDATE_REVIEW_REQUIRED"));
});
test("P/G maps grounded projects and certifications into typed Candidate Truth proposals", async () => {
  const text = "PROJECTS\nProject Atlas\nTypeScript React\nCERTIFICATIONS\nCloud Certificate Example Issuer 2024";
  const adapter: ProviderAdapter = { ...provider(async () => ({ value: { fields: [
    { itemKey: "project-name", canonicalKey: "PROJECT_NAME", entityType: "PROJECT", entityGroupKey: "project-1",
      value: { kind: "TEXT", value: "Project Atlas" }, sourceSection: "PROJECTS", sourceQuote: "Project Atlas" },
    { itemKey: "project-tech", canonicalKey: "PROJECT_TECHNOLOGIES", entityType: "PROJECT", entityGroupKey: "project-1",
      value: { kind: "LIST", values: ["TypeScript", "React"] }, sourceSection: "PROJECTS", sourceQuote: "TypeScript React" },
    { itemKey: "cert-name", canonicalKey: "CERTIFICATION_NAME", entityType: "CERTIFICATION", entityGroupKey: "cert-1",
      value: { kind: "TEXT", value: "Cloud Certificate" }, sourceSection: "CERTIFICATIONS", sourceQuote: "Cloud Certificate Example Issuer 2024" },
    { itemKey: "cert-date", canonicalKey: "CERTIFICATION_DATE", entityType: "CERTIFICATION", entityGroupKey: "cert-1",
      value: { kind: "DATE", value: "2024-01-01", precision: "YEAR" }, sourceSection: "CERTIFICATIONS", sourceQuote: "Cloud Certificate Example Issuer 2024" }
  ] }, usage: null })), provider: "GEMINI", privacy: ["DOCUMENT_PRIVATE_DATA"] };
  const result = await new OrchestratedResumeCandidateExtractor(new AiOrchestrator([adapter]), true, { extract: async () => [] })
    .extract(text, { ...scope, documentId: crypto.randomUUID(), extractionId: crypto.randomUUID() });
  assert.equal(result.filter((item) => item.entityType === "PROJECT").length, 2);
  assert.equal(result.find((item) => item.canonicalKey === "PROJECT_TECHNOLOGIES")?.normalizedValue.kind, "MULTI_ENUM");
  assert.equal(result.find((item) => item.canonicalKey === "CERTIFICATION_DATE")?.normalizedValue.kind, "DATE");
  assert.ok(result.every((item) => text.includes(item.sourceEvidence)));
});
test("P/G binds same-company AI enrichment with two anchors and never duplicates deterministic fields", async () => {
  const first = "TEAM LEAD, VIDYAKUL March 2026 – present";
  const second = "BACKEND DEVELOPER, VIDYAKUL January 2025 – February 2026";
  const text = ["Example Person", "EXPERIENCE", first, "Gurgaon", "• Built Node.js services.", second, "• Built APIs."].join("\n");
  const adapter: ProviderAdapter = { ...provider(async () => ({ value: { fields: [
    { itemKey: "ai-company", canonicalKey: "EMPLOYMENT_COMPANY", entityType: "EMPLOYMENT", entityGroupKey: "ai-current",
      value: { kind: "TEXT", value: "VIDYAKUL" }, sourceSection: "EXPERIENCE", sourceQuote: first },
    { itemKey: "ai-title", canonicalKey: "EMPLOYMENT_TITLE", entityType: "EMPLOYMENT", entityGroupKey: "ai-current",
      value: { kind: "TEXT", value: "TEAM LEAD" }, sourceSection: "EXPERIENCE", sourceQuote: first },
    { itemKey: "ai-dates", canonicalKey: "EMPLOYMENT_DATE_RANGE", entityType: "EMPLOYMENT", entityGroupKey: "ai-current",
      value: { kind: "DATE_RANGE", start: "2026-03-01", end: null, precision: "MONTH", current: true }, sourceSection: "EXPERIENCE", sourceQuote: first },
    { itemKey: "ai-location", canonicalKey: "EMPLOYMENT_LOCATION", entityType: "EMPLOYMENT", entityGroupKey: "ai-current",
      value: { kind: "TEXT", value: "Gurgaon" }, sourceSection: "EXPERIENCE", sourceQuote: "Gurgaon" }
  ] }, usage: null })), provider: "GEMINI", privacy: ["DOCUMENT_PRIVATE_DATA"] };
  const result = await new OrchestratedResumeCandidateExtractor(new AiOrchestrator([adapter]), true)
    .extract(text, { ...scope, documentId: crypto.randomUUID(), extractionId: crypto.randomUUID() });
  assert.equal(result.filter((item) => item.canonicalKey === "EMPLOYMENT_COMPANY").length, 2);
  const location = result.find((item) => item.canonicalKey === "EMPLOYMENT_LOCATION");
  const currentCompany = result.find((item) => item.canonicalKey === "EMPLOYMENT_COMPANY" && item.normalizedValue.kind === "STRING" && item.normalizedValue.value === "VIDYAKUL");
  assert.equal(location?.entityGroupKey, currentCompany?.entityGroupKey);
  const identities = result.map((item) => `${item.entityType}:${item.entityGroupKey}:${item.canonicalKey}`);
  assert.equal(new Set(identities).size, identities.length);
});
test("P/M missing routes return ambiguity without breaking deterministic runtime", async () => {
  const result = await entityAiBridge(new AiOrchestrator([])).resolve({
    entityType: "EMPLOYMENT", group: { semanticRole: "CURRENT", identityKind: "STABLE_DOM", canonicalKeys: ["EMPLOYMENT_COMPANY"] },
    candidates: [{ candidateEntityId: crypto.randomUUID(), recencyRank: 0, canonicalCoverage: ["EMPLOYMENT_COMPANY"] }], containsCandidateValue: false
  }, { ...scope, applicationRunId: null });
  assert.equal(result, null);
});

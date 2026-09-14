import assert from "node:assert/strict";
import test from "node:test";
import type {
  FieldEvidenceInput,
  FieldIntelligencePageContext,
  SemanticControlType
} from "@job-hunter-v2/contracts";
import type { CandidateTruthResolution, ResolveCandidateTruthInput } from "@job-hunter-v2/candidate-truth";
import { normalizeFieldEvidence } from "./evidence.js";
import {
  FieldCanonicalizationAiUnavailableError,
  FieldSemanticResolver,
  type FieldCanonicalizationAiPort
} from "./semantic-resolver.js";
import { FieldIntelligenceService } from "./service.js";
import { configureCanonicalAliases } from "./ontology.js";

const page: FieldIntelligencePageContext = {
  host: "jobs.example.test", ats: "GENERIC", pageHeading: "Application",
  jobId: null, applicationId: null, countryCode: null, roleFamily: null, companyId: null
};

test("admin alias changes invalidate existing semantic caches and retain scoped guards",async()=>{
  const resolver=new FieldSemanticResolver(),input=field("candidate electronic address");
  try {
    const before=await resolver.resolve(input,page,false);assert.notEqual(before.resolution.canonicalKey,"EMAIL");
    configureCanonicalAliases(new Map([["EMAIL",["candidate electronic address"]]]));
    const after=await resolver.resolve(input,page,false);assert.equal(after.resolution.canonicalKey,"EMAIL");assert.equal(after.cacheHit,false);
    const repeat=await resolver.resolve(input,page,false);assert.equal(repeat.cacheHit,true);
    configureCanonicalAliases(new Map());
    assert.notEqual((await resolver.resolve(input,page,false)).resolution.canonicalKey,"EMAIL");
  }finally{configureCanonicalAliases(new Map());}
});

function field(label: string, options: {
  type?: SemanticControlType;
  section?: string | null;
  previous?: string | null;
  next?: string | null;
  autocomplete?: string | null;
  ariaLabel?: string | null;
  placeholder?: string | null;
  options?: readonly string[];
  entityType?: FieldEvidenceInput["repeatableEvidence"]["entityType"];
  bindingKind?: FieldEvidenceInput["repeatableEvidence"]["bindingKind"];
  candidateEntityId?: string | null;
} = {}): FieldEvidenceInput {
  const candidateEntityId = options.candidateEntityId ?? null;
  return {
    evidenceVersion: 1,
    fieldRuntimeId: `field:${crypto.randomUUID()}`,
    pageInstanceId: crypto.randomUUID(),
    formInstanceId: `form:${crypto.randomUUID()}`,
    sectionFingerprint: `section:${crypto.randomUUID()}`,
    controlFingerprint: `control:${crypto.randomUUID()}`,
    controlType: options.type ?? "TEXT",
    labelEvidence: [label],
    contextEvidence: {
      section: options.section ?? null,
      previousLabel: options.previous ?? null,
      nextLabel: options.next ?? null,
      semanticGroup: null,
      pageHeading: "Application",
      formHeading: "Apply",
      nearbyDescription: null
    },
    locatorEvidence: {
      tagName: "input", type: "text", name: null, id: null,
      autocomplete: options.autocomplete ?? null,
      ariaLabel: options.ariaLabel ?? null,
      placeholder: options.placeholder ?? null,
      role: null, accessibleDescription: null, occurrence: 0
    },
    optionEvidence: { count: options.options?.length ?? 0, samples: [...(options.options ?? [])] },
    repeatableEvidence: {
      entityType: options.entityType ?? null,
      bindingKind: options.bindingKind ?? (candidateEntityId ? "CANDIDATE_ENTITY" : "NONE"),
      instanceKey: candidateEntityId,
      candidateEntityId,
      ordinalHint: null,
      groupLabel: options.section ?? null
    },
    required: false,
    disabled: false,
    ownership: "UNKNOWN"
  };
}

const corpus: readonly [string, FieldEvidenceInput, string][] = [
  ["first name", field("First name", { autocomplete: "given-name" }), "FIRST_NAME"],
  ["legal surname", field("Legal surname"), "LEGAL_LAST_NAME"],
  ["full name", field("Full name"), "FULL_NAME"],
  ["email", field("Contact email", { type: "EMAIL", autocomplete: "email" }), "EMAIL"],
  ["confirmation email", field("Confirm your email", { type: "EMAIL" }), "EMAIL"],
  ["personal city", field("City", { section: "Personal information", type: "COMBOBOX" }), "CURRENT_LOCATION"],
  ["hiring message", field("Let the company know about your interest working there", { type: "TEXTAREA" }), "COVER_LETTER"],
  ["plain linkedin", field("LinkedIn"), "LINKEDIN_URL"],
  ["phone", field("Mobile number", { type: "TEL", autocomplete: "tel" }), "PHONE"],
  ["address", field("Residential address", { section: "Contact information" }), "CURRENT_ADDRESS"],
  ["location", field("Where are you currently based?"), "CURRENT_LOCATION"],
  ["linkedin", field("LinkedIn profile URL"), "LINKEDIN_URL"],
  ["github", field("GitHub profile"), "GITHUB_URL"],
  ["portfolio", field("Professional website"), "PORTFOLIO_URL"],
  ["current employer", field("Organization with which you are presently engaged", { section: "Current employment" }), "CURRENT_COMPANY"],
  ["current title", field("Present designation", { section: "Current employment" }), "CURRENT_JOB_TITLE"],
  ["current ctc", field("Current annual compensation", { type: "NUMBER" }), "CURRENT_CTC"],
  ["expected ctc", field("Expected CTC", { type: "NUMBER" }), "EXPECTED_CTC"],
  ["notice", field("Notice period in days", { type: "NUMBER" }), "NOTICE_PERIOD"],
  ["experience", field("Overall professional experience", { type: "NUMBER" }), "TOTAL_EXPERIENCE"],
  ["skills", field("Primary technical skills", { type: "MULTISELECT" }), "SKILLS"],
  ["resume", field("Upload your CV", { type: "FILE" }), "RESUME"],
  ["cover letter file", field("Upload your cover letter", { type: "FILE" }), "COVER_LETTER"],
  ["sponsorship", field("Will you require visa sponsorship now or in the future?", { type: "RADIO" }), "SPONSORSHIP_REQUIRED"],
  ["adult", field("Are you at least 18 years of age?", { type: "CHECKBOX" }), "AGE_OVER_18"],
  ["government", field("Are you currently a government employee?", { type: "RADIO" }), "GOVERNMENT_EMPLOYEE"],
  ["non compete", field("Are you subject to a non-compete agreement?", { type: "RADIO" }), "NON_COMPETE"],
  ["relocate", field("Are you willing to relocate for this role?", { type: "RADIO" }), "RELOCATION"],
  ["start", field("When can you start?", { type: "DATE" }), "START_DATE"],
  ["hearing", field("How did you hear about this opportunity?", { type: "SELECT" }), "HEARING_SOURCE"],
  ["employment company", field("Company", { section: "Work experience", entityType: "EMPLOYMENT", bindingKind: "DOM_STABLE_KEY" }), "EMPLOYMENT_COMPANY"],
  ["employment title", field("Job title", { section: "Work experience", entityType: "EMPLOYMENT", bindingKind: "DOM_STABLE_KEY" }), "EMPLOYMENT_TITLE"],
  ["education institution", field("University", { section: "Education", entityType: "EDUCATION", bindingKind: "DOM_STABLE_KEY" }), "EDUCATION_INSTITUTION"],
  ["degree", field("Degree", { section: "Academic history", entityType: "EDUCATION", bindingKind: "DOM_STABLE_KEY" }), "EDUCATION_DEGREE"],
  ["field study", field("Field of study", { section: "Education", entityType: "EDUCATION", bindingKind: "DOM_STABLE_KEY" }), "EDUCATION_FIELD_OF_STUDY"],
  ["accuracy", field("I certify that the information in this application is accurate", { type: "CHECKBOX" }), "CERTIFY_INFORMATION_ACCURATE"],
  ["privacy", field("I acknowledge the applicant privacy notice", { type: "CHECKBOX" }), "PRIVACY_ACKNOWLEDGEMENT"],
  ["background", field("I consent to a background check", { type: "CHECKBOX" }), "BACKGROUND_CHECK_AUTHORIZATION"],
  ["terms", field("I agree to the terms and conditions", { type: "CHECKBOX" }), "TERMS_ACKNOWLEDGEMENT"],
  ["data processing", field("I consent to processing of my personal data", { type: "CHECKBOX" }), "DATA_PROCESSING_CONSENT"],
  ["applicant certification", field("I understand employment is subject to verification", { type: "CHECKBOX" }), "APPLICANT_CERTIFICATION"],
  ["eeo acknowledgement", field("I acknowledge the equal employment opportunity notice", { type: "CHECKBOX" }), "EEO_ACKNOWLEDGEMENT"],
  ["application acknowledgement", field("I acknowledge the statement above", { type: "CHECKBOX" }), "APPLICATION_SPECIFIC_ACKNOWLEDGEMENT"],
  ["gender", field("Gender identity", { type: "SELECT", section: "Equal opportunity information" }), "EEO_GENDER"]
];

test("bare city without personal context must not become current location", async () => {
  const resolver = new FieldSemanticResolver();
  for (const section of ["Education", "Employment history", "Birth details", "Preferred locations"]) {
    const result = await resolver.resolve(field("City", { section }), page);
    assert.notEqual(result.resolution.canonicalKey, "CURRENT_LOCATION", section);
  }
});

test("hearing-source wording works across employers without employer-specific aliases", async () => {
  const resolver = new FieldSemanticResolver();
  for (const employer of ["Plane", "Bosch", "Meesho", "Northstar Robotics", "us", "this opportunity"]) {
    for (const type of ["TEXT", "TEXTAREA", "SELECT"] as const) {
      const result = await resolver.resolve(field(`How did you come to know about ${employer}?`, { type }), page);
      assert.equal(result.resolution.canonicalKey, "HEARING_SOURCE", `${employer}: ${type}`);
      assert.equal(result.resolution.state, "RESOLVED_HIGH");
      assert.equal(result.aiRequests, 0);
    }
  }
});

test("numbered screening questions retain their canonical meaning", async () => {
  const resolver = new FieldSemanticResolver();
  for (const [label, canonical] of [["1. What is your preferred location?", "PREFERRED_LOCATIONS"], ["4. What is your work experience?", "TOTAL_EXPERIENCE"], ["8. What is your expected Annual salary?", "EXPECTED_CTC"]]) {
    const result = await resolver.resolve(field(label!), page);
    assert.equal(result.resolution.canonicalKey, canonical);
    assert.equal(result.aiRequests, 0);
  }
});

test("semantic accuracy corpus resolves common application fields without AI", async (context) => {
  const resolver = new FieldSemanticResolver();
  for (const [name, evidence, canonical] of corpus) {
    await context.test(name, async () => {
      const result = await resolver.resolve(evidence, page);
      assert.ok(["RESOLVED_HIGH", "RESOLVED_MEDIUM"].includes(result.resolution.state), JSON.stringify(result.resolution));
      assert.equal(result.resolution.canonicalKey, canonical);
      assert.equal(result.aiRequests, 0);
    });
  }
});

test("Ashby-style short labels stay high-confidence despite decorative placeholders", async () => {
  const resolver = new FieldSemanticResolver();
  const name = await resolver.resolve(field("Name", { placeholder: "Type here..." }), page);
  assert.equal(name.resolution.canonicalKey, "FULL_NAME");
  assert.equal(name.resolution.state, "RESOLVED_HIGH");
  const email = await resolver.resolve(field("Email", { type: "EMAIL", placeholder: "hello@example.com..." }), page);
  assert.equal(email.resolution.canonicalKey, "EMAIL");
  assert.equal(email.resolution.state, "RESOLVED_HIGH");
  const linkedin = await resolver.resolve(field("Your Linkedin profile link.", { placeholder: "Type here..." }), page);
  assert.equal(linkedin.resolution.canonicalKey, "LINKEDIN_URL");
  assert.equal(linkedin.resolution.state, "RESOLVED_HIGH");
  const experience = await resolver.resolve(field("What is your total work experience in a similar role/ capacity?"), page);
  assert.equal(experience.resolution.canonicalKey, "TOTAL_EXPERIENCE");
  assert.equal(experience.resolution.state, "RESOLVED_HIGH");
  const firstName = await resolver.resolve(field("First name"), page);
  assert.equal(firstName.resolution.canonicalKey, "FIRST_NAME");
  assert.notEqual(firstName.resolution.canonicalKey, "FULL_NAME");
});

test("country-scoped authorization resolves with explicit jurisdiction and stays ambiguous without it", async () => {
  const resolver = new FieldSemanticResolver();
  const india = await resolver.resolve(field("Are you legally authorized to work in India?", { type: "RADIO" }), page);
  assert.equal(india.resolution.canonicalKey, "WORK_AUTHORIZATION");
  assert.equal(india.resolution.contextHints.countryCode, "IN");
  const missing = await resolver.resolve(field("Are you legally authorized to work?", { type: "RADIO" }), page);
  assert.equal(missing.resolution.state, "AMBIGUOUS");
  assert.equal(missing.resolution.canonicalKey, null);
  assert.ok(missing.resolution.errorCodes.includes("FIELD_CONTEXT_INSUFFICIENT"));
});

test("false positives and incompatible specialized input types fail safely", async () => {
  const resolver = new FieldSemanticResolver();
  for (const negative of [
    field("Do you enjoy solving hard problems?"),
    field("Work item"),
    field("Phone number", { type: "EMAIL" }),
    field("Current project")
  ]) {
    const result = await resolver.resolve(negative, page);
    assert.equal(result.resolution.state.startsWith("RESOLVED") && result.resolution.canonicalKey === "WORK_AUTHORIZATION", false);
    assert.notEqual(result.resolution.state, "RESOLVED_HIGH");
  }
});

test("evidence normalization removes interpolated candidate identifiers before hashing or AI", () => {
  const raw = field("Email for person@example.com", { ariaLabel: "Call +91 99999 99999", placeholder: "https://private.example/me" });
  const normalized = normalizeFieldEvidence(raw, page);
  const serialized = JSON.stringify(normalized);
  assert.equal(serialized.includes("person@example.com"), false);
  assert.equal(serialized.includes("99999"), false);
  assert.equal(serialized.includes("private.example"), false);
  assert.match(serialized, /\[email\]/);
});

test("AI fallback is candidate-bounded, schema validated, cached and never receives candidate values", async () => {
  const payloads: unknown[] = [];
  const ai: FieldCanonicalizationAiPort = {
    canonicalize: async (payload) => {
      payloads.push(payload);
      return { selectedCanonical: "CURRENT_COMPANY", confidence: 0.96, ambiguous: false,
        ranking: [{ canonicalKey: "CURRENT_COMPANY", confidence: 0.96 }], reasonCategory: "LABEL_CONTEXT" };
    }
  };
  const resolver = new FieldSemanticResolver(ai);
  const ambiguous = field("Company");
  const first = await resolver.resolve(ambiguous, page);
  assert.ok(first.resolution.state.startsWith("RESOLVED"));
  assert.equal(first.resolution.canonicalKey, "CURRENT_COMPANY");
  const sameEvidence = { ...ambiguous, fieldRuntimeId: `field:${crypto.randomUUID()}` };
  const second = await resolver.resolve(sameEvidence, page);
  assert.equal(second.cacheHit, true);
  assert.equal(payloads.length, 1);
  assert.equal(JSON.stringify(payloads).includes("candidateAnswer"), false);
  assert.equal(JSON.stringify(payloads).includes("normalizedValue"), false);
});

test("malformed and unavailable AI leave deterministic ambiguity explicit", async () => {
  const malformed = new FieldSemanticResolver({ canonicalize: async () => ({ selectedCanonical: "INVENTED", confidence: 1, ambiguous: false, ranking: [], reasonCategory: "LABEL_CONTEXT" }) });
  const malformedResult = await malformed.resolve(field("Company"), page);
  assert.ok(malformedResult.resolution.errorCodes.includes("AI_SCHEMA_INVALID"));
  assert.equal(malformedResult.resolution.canonicalKey, null);

  const unavailable = new FieldSemanticResolver({ canonicalize: async () => { throw new FieldCanonicalizationAiUnavailableError(); } });
  const unavailableResult = await unavailable.resolve(field("Company"), page);
  assert.ok(unavailableResult.resolution.errorCodes.includes("AI_ROUTE_UNAVAILABLE"));
});

test("Candidate Truth boundary returns only answer references and preserves repeatable entity identity", async () => {
  const answerVersionId = "40000000-0000-4000-8000-000000000001";
  const entityId = "50000000-0000-4000-8000-000000000001";
  const calls: ResolveCandidateTruthInput[] = [];
  const candidateTruth = {
    resolve: async (input: ResolveCandidateTruthInput): Promise<CandidateTruthResolution> => {
      calls.push(input);
      return {
        status: "RESOLVED", canonicalKey: String(input.canonicalKey), answerVersionId,
        normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: "SECRET_EMPLOYER" },
        scope: { scopeType: "GLOBAL", scopeKey: "scope=GLOBAL", scopeFingerprint: "a".repeat(64), precedence: 100 },
        trustState: "TRUSTED", trialReuse: false, requiresUserReview: false, autofillMode: "AUTO", expiresAt: null,
        reasonCodes: ["BEST_COMPATIBLE_SCOPE", "ANSWER_HAS_NO_EXPIRY"], candidateVersionIds: [answerVersionId]
      };
    }
  };
  const service = new FieldIntelligenceService(new FieldSemanticResolver(), candidateTruth);
  const response = await service.resolve({
    accountId: "10000000-0000-4000-8000-000000000001",
    candidateId: "20000000-0000-4000-8000-000000000001",
    request: {
      schemaVersion: 1, requestId: crypto.randomUUID(), applicationRunId: null, pageContext: page,
      fields: [field("Company", { section: "Work experience", entityType: "EMPLOYMENT", candidateEntityId: entityId })]
    }
  });
  assert.equal(response.items[0]?.semantic.canonicalKey, "EMPLOYMENT_COMPANY");
  assert.equal(response.items[0]?.answer.answerVersionId, answerVersionId);
  assert.equal(calls[0]?.entityId, entityId);
  assert.equal(JSON.stringify(response).includes("SECRET_EMPLOYER"), false);
  assert.equal(response.containsCandidateValue, false);
});

test("M binds a real DOM repeat group before Candidate Truth without exposing entity values", async () => {
  const entityId = "50000000-0000-4000-8000-000000000009";
  const calls: ResolveCandidateTruthInput[] = [];
  const repeatableField = field("Company", { section: "Current work experience", entityType: "EMPLOYMENT", bindingKind: "DOM_STABLE_KEY" });
  repeatableField.repeatableEvidence.formGroup = {
    schemaVersion: 1, formRepeatGroupId: "repeat:employment-current", identityKind: "STABLE_DOM",
    stableGroupKey: "employment-current", structuralFingerprint: "d".repeat(64),
    entityType: "EMPLOYMENT", semanticRole: "CURRENT", ordinalHint: 0, groupLabel: "Current work experience"
  };
  const service = new FieldIntelligenceService(
    new FieldSemanticResolver(),
    { resolve: async (input: ResolveCandidateTruthInput): Promise<CandidateTruthResolution> => {
      calls.push(input);
      return { status: "MISSING", canonicalKey: String(input.canonicalKey), reasonCodes: ["NO_COMPATIBLE_CANDIDATE_TRUTH"] };
    } },
    null, undefined, 8,
    { bind: async () => ({
      byFieldRuntimeId: new Map([[repeatableField.fieldRuntimeId, {
        schemaVersion: 1, formRepeatGroupId: "repeat:employment-current", entityType: "EMPLOYMENT",
        state: "BOUND_HIGH", candidateEntityId: entityId, candidateEntityVersion: 3,
        candidateEntityRevision: "e".repeat(64), bindingVersion: 1, confidence: 0.96,
        confidenceBucket: "HIGH", evidenceCategories: ["SEMANTIC_ROLE"], reasonCodes: ["ENTITY_BINDING_DETERMINISTIC_HIGH"],
        errorCodes: [], valuePrivate: true, containsCandidateValue: false
      }]]), capacityByEntityType: new Map([["EMPLOYMENT", { activeCount: 1, boundCount: 1, remainingCount: 0 }]]), aiRequests: 0
    }) }
  );
  const response = await service.resolve({
    accountId: "10000000-0000-4000-8000-000000000001",
    candidateId: "20000000-0000-4000-8000-000000000001",
    request: { schemaVersion: 1, requestId: crypto.randomUUID(), applicationRunId: null, pageContext: page, fields: [repeatableField] }
  });
  assert.equal(calls[0]?.entityId, entityId);
  assert.equal(response.items[0]?.semantic.entityBinding.bindingKind, "CANDIDATE_ENTITY");
  assert.equal(response.items[0]?.semantic.entityIntelligence?.candidateEntityVersion, 3);
  assert.equal(response.containsCandidateValue, false);
});

test("declarations are understood without consulting or polluting Candidate Truth", async () => {
  let candidateTruthCalls = 0;
  const candidateTruth = {
    resolve: async (): Promise<CandidateTruthResolution> => {
      candidateTruthCalls += 1;
      return ({
      status: "NEEDS_USER", canonicalKey: "PRIVACY_ACKNOWLEDGEMENT",
      reasonCodes: ["POLICY_REQUIRES_CURRENT_APPLICATION_ACTION"], candidateVersionIds: []
      });
    }
  };
  const service = new FieldIntelligenceService(new FieldSemanticResolver(), candidateTruth);
  const response = await service.resolve({
    accountId: "10000000-0000-4000-8000-000000000001",
    candidateId: "20000000-0000-4000-8000-000000000001",
    request: { schemaVersion: 1, requestId: crypto.randomUUID(), applicationRunId: null, pageContext: page,
      fields: [field("I acknowledge the privacy notice", { type: "CHECKBOX" })] }
  });
  assert.equal(response.items[0]?.semantic.canonicalKey, "PRIVACY_ACKNOWLEDGEMENT");
  assert.equal(response.items[0]?.semantic.declarationHint.state, "KNOWN_DECLARATION");
  assert.equal(response.items[0]?.answer.status, "NOT_APPLICABLE");
  assert.equal(candidateTruthCalls, 0);
});

test("ambiguous declaration language remains a J hint without inventing a canonical", async () => {
  const result = await new FieldSemanticResolver().resolve(field("I agree", { type: "CHECKBOX" }), page);
  assert.equal(result.resolution.canonicalKey, null);
  assert.equal(result.resolution.declarationHint.state, "DECLARATION_LIKE");
  assert.equal(result.resolution.declarationHint.textEvidence, "PARTIAL");
});

test("large forms use bounded answer deduplication and no AI for deterministic fields", async () => {
  let answerCalls = 0;
  const service = new FieldIntelligenceService(new FieldSemanticResolver(), {
    resolve: async (): Promise<CandidateTruthResolution> => {
      answerCalls += 1;
      return { status: "MISSING", canonicalKey: "EMAIL", reasonCodes: ["NO_COMPATIBLE_CANDIDATE_TRUTH"] };
    }
  });
  const fields = Array.from({ length: 200 }, (_, index) => ({ ...field("Email", { type: "EMAIL" }), fieldRuntimeId: `field:${String(index).padStart(8, "0")}` }));
  const before = Date.now();
  const result = await service.resolve({
    accountId: "10000000-0000-4000-8000-000000000001", candidateId: "20000000-0000-4000-8000-000000000001",
    request: { schemaVersion: 1, requestId: crypto.randomUUID(), applicationRunId: null, pageContext: page, fields }
  });
  assert.equal(result.items.length, 200);
  assert.equal(result.summary.aiRequests, 0);
  assert.equal(answerCalls, 1);
  assert.ok(Date.now() - before < 1_500);
});

test("a slow AI cannot block ordinary fields in a 35-control form; enrichment is bounded and reused", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const semantic = new FieldSemanticResolver({ canonicalize: async () => {
    calls += 1; await gate;
    return { selectedCanonical: "CURRENT_COMPANY", confidence: .96, ambiguous: false, ranking: [{ canonicalKey: "CURRENT_COMPANY", confidence: .96 }], reasonCategory: "LABEL_CONTEXT" };
  } });
  const service = new FieldIntelligenceService(semantic, { resolve: async ({ canonicalKey }): Promise<CandidateTruthResolution> => ({ status: "MISSING", canonicalKey: String(canonicalKey), reasonCodes: ["NO_COMPATIBLE_CANDIDATE_TRUTH"] }) }, null, undefined, 8, null, 25);
  const fields = [...Array.from({ length: 30 }, () => field("Email", { type: "EMAIL" })), ...Array.from({ length: 5 }, () => field("Company"))];
  const input = { accountId: crypto.randomUUID(), candidateId: crypto.randomUUID(), request: { schemaVersion: 1 as const, requestId: crypto.randomUUID(), applicationRunId: null, pageContext: page, fields } };
  const started = Date.now();
  const result = await service.resolve(input);
  assert.ok(Date.now() - started < 1000, "Do not wait for an unresponsive provider");
  assert.equal(result.items.filter((item) => item.semantic.canonicalKey === "EMAIL").length, 30);
  assert.equal(result.items.filter((item) => item.semantic.reasonCodes.includes("AI_ENRICHMENT_PENDING")).length, 5, "Overflow fields must also request recovery");
  assert.equal(calls, 4);
  const again = await service.resolve(input);
  assert.equal(calls, 4, "Do not launch duplicate in-flight AI work");
  assert.ok(again.items.some((item) => item.semantic.reasonCodes.includes("AI_ENRICHMENT_PENDING")));
  release(); await new Promise((resolve) => setTimeout(resolve, 10));
  const enriched = await service.resolve(input);
  assert.equal(enriched.items.filter((item) => item.semantic.canonicalKey === "CURRENT_COMPANY").length, 5);
  assert.equal(calls, 4);
});
test("India application questions have distinct canonicals without model calls", async () => {
  const resolver = new FieldSemanticResolver();
  for (const [label, canonical, type] of [
    ["If you are offered, by when can you join?", "NOTICE_PERIOD", "TEXT"],
    ["If available immediately, what was your last working day in the previous organisation?", "LAST_WORKING_DAY", "TEXT"],
    ["Do you have hands-on experience with AI coding agents?", "AI_CODING_EXPERIENCE", "SELECT"],
    ["How did you come to know about Plane?", "HEARING_SOURCE", "SELECT"],
    ["Autofill from resume", "RESUME", "FILE"]
  ] as const) {
    const result = await resolver.resolve(field(label, { type }), page);
    assert.equal(result.resolution.canonicalKey, canonical, label);
    assert.equal(result.resolution.state, "RESOLVED_HIGH", label);
    assert.equal(result.aiRequests, 0);
  }
});

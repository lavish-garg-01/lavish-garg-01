import assert from "node:assert/strict";
import test from "node:test";
import { CandidateSearchPreferencesSchema, type CandidateJobProfile, type CatalogJob } from "./contracts.js";
import { candidateJobFactsFromTruth, evaluateAndRankJob, evaluateHardEligibility } from "./matching.js";

const now = new Date("2026-09-01T10:00:00.000Z");

function job(overrides: Partial<CatalogJob> = {}): CatalogJob {
  return {
    jobId: "10000000-0000-4000-8000-000000000001", materialVersion: 1,
    companyId: "20000000-0000-4000-8000-000000000001", companyName: "Razorpay",
    normalizedCompanyName: "razorpay", title: "Senior Backend Engineer", description: "Build APIs",
    roleFamily: "BACKEND", seniority: "SENIOR", locationText: "Bengaluru, India",
    countryCodes: ["IN"], workMode: "REMOTE", remoteCountryCodes: ["IN"],
    employmentType: "FULL_TIME", minExperienceMonths: 36, maxExperienceMonths: 72,
    requiredSkills: [
      { key: "nodejs", label: "Node.js", requirement: "REQUIRED" },
      { key: "postgresql", label: "PostgreSQL", requirement: "REQUIRED" }
    ],
    preferredSkills: [{ key: "aws", label: "AWS", requirement: "PREFERRED" }],
    minCompensationMinor: 2_000_000_00, maxCompensationMinor: 3_000_000_00,
    currencyCode: "INR", compensationPeriod: "YEAR", sponsorshipAvailable: false,
    workAuthorizationCountryCodes: ["IN"], educationRequirement: null,
    relocationRequired: false, nightShiftRequired: false, heavyTravelRequired: false,
    employmentBondRequired: false, ats: "GREENHOUSE",
    applicationUrl: "https://jobs.example/1", status: "ACTIVE",
    firstSeenAt: now, lastSeenAt: now, lastVerifiedAt: now,
    postedAt: new Date("2026-08-30T00:00:00.000Z"), expiresAt: null,
    ...overrides
  };
}

function profile(overrides: Partial<CandidateJobProfile["facts"]> = {}, preferenceOverrides: Record<string, unknown> = {}): CandidateJobProfile {
  return {
    preferences: CandidateSearchPreferencesSchema.parse({
      version: 1, targetRoleFamilies: ["BACKEND"], acceptableRoleFamilies: ["FULLSTACK"],
      preferredWorkModes: ["REMOTE", "HYBRID"], preferredCountryCodes: ["IN"],
      excludedCompanyNames: [], minimumCompensationMinor: 2_500_000_00,
      compensationCurrencyCode: "INR",
      dealBreakers: { mandatoryRelocation: true, nightShift: true, heavyTravel: true, employmentBond: true },
      ...preferenceOverrides
    }),
    facts: {
      currentRoleFamily: "BACKEND", skills: ["nodejs", "postgresql"], totalExperienceMonths: 48,
      authorizedCountryCodes: ["IN"], sponsorshipRequiredCountryCodes: [], currentCountryCode: "IN",
      expectedCompensationMinor: 2_500_000_00, expectedCompensationCurrencyCode: "INR",
      relocationWilling: false, ...overrides
    }
  };
}

test("H4 hard eligibility excludes only explicit conflicts and ranking cannot rescue them", () => {
  const cases: Array<[CatalogJob, CandidateJobProfile, string]> = [
    [job(), profile({}, { excludedCompanyNames: ["Razorpay Pvt Ltd", "Razorpay"] }), "EXCLUDED_COMPANY"],
    [job({ remoteCountryCodes: ["US"] }), profile(), "REMOTE_GEOGRAPHY_INCOMPATIBLE"],
    [job({ sponsorshipAvailable: false, workAuthorizationCountryCodes: ["US"] }), profile({ authorizedCountryCodes: [], sponsorshipRequiredCountryCodes: ["US"] }), "SPONSORSHIP_UNAVAILABLE"],
    [job({ relocationRequired: true }), profile(), "MANDATORY_RELOCATION"],
    [job({ nightShiftRequired: true }), profile(), "NIGHT_SHIFT_REQUIRED"],
    [job({ heavyTravelRequired: true }), profile(), "HEAVY_TRAVEL_REQUIRED"],
    [job({ employmentBondRequired: true }), profile(), "EMPLOYMENT_BOND_REQUIRED"]
  ];
  for (const [candidateJob, candidate, code] of cases) {
    const result = evaluateAndRankJob(candidateJob, candidate, now);
    assert.equal(result.eligibility.state, "INELIGIBLE");
    assert.equal(result.eligibility.reasons.some((item) => item.code === code), true);
    assert.equal(result.rankScore, null);
    assert.equal(result.label, "HIDDEN");
  }
});

test("missing sponsorship and authorization information remains UNKNOWN and visible", () => {
  const candidate = profile({ authorizedCountryCodes: [], sponsorshipRequiredCountryCodes: [] });
  const result = evaluateHardEligibility(job({ sponsorshipAvailable: null }), candidate);
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.unknowns.some((item) => item.code === "WORK_AUTHORIZATION_UNKNOWN"), true);
  const ranked = evaluateAndRankJob(job({ sponsorshipAvailable: null }), candidate, now);
  assert.notEqual(ranked.rankScore, null);
  assert.notEqual(ranked.label, "HIDDEN");
});

test("H5/H6 produces deterministic component scores and explanations from the same evidence", () => {
  const first = evaluateAndRankJob(job(), profile(), now);
  const second = evaluateAndRankJob(job(), profile(), now);
  assert.deepEqual(second, first);
  assert.equal(first.eligibility.state, "ELIGIBLE");
  assert.equal(first.label, "STRONG_MATCH");
  assert.equal(first.reasons.some((item) => item.code === "TARGET_ROLE_MATCH"), true);
  assert.equal(first.reasons.some((item) => item.code === "REQUIRED_SKILLS_MATCH"), true);
  assert.equal(first.reasons.some((item) => item.code === "EXPERIENCE_IN_RANGE"), true);
  assert.equal(first.gaps.some((item) => item.code === "PREFERRED_SKILLS_GAP"), true);
  assert.equal(first.dimensions.reduce((sum, item) => sum + (item.score === null ? 0 : 1), 0) >= 6, true);
});

test("seniority is tolerant: lower and slightly higher roles remain visible while excessive gaps rank down", () => {
  const lower = evaluateAndRankJob(job({ seniority: "MID" }), profile(), now);
  const higher = evaluateAndRankJob(job({ seniority: "LEAD" }), profile(), now);
  const excessive = evaluateAndRankJob(job({ seniority: "PRINCIPAL" }), profile({ totalExperienceMonths: 24 }), now);
  assert.notEqual(lower.label, "HIDDEN");
  assert.notEqual(higher.label, "HIDDEN");
  assert.notEqual(excessive.label, "HIDDEN");
  assert.ok((lower.dimensions.find((item) => item.key === "SENIORITY")?.score ?? 0) > (excessive.dimensions.find((item) => item.key === "SENIORITY")?.score ?? 100));
  assert.equal(excessive.gaps.some((item) => item.code === "EXCESSIVE_SENIORITY_GAP"), true);
  assert.equal(excessive.label, "LOW_MATCH");
  assert.ok((excessive.rankScore ?? 100) < 50);
});

test("H2 guardrails prevent sparse metadata from over-ranking unsuitable roles", () => {
  const outsideFamily = evaluateAndRankJob(job({
    title: "Data Scientist III", roleFamily: "ML_AI", seniority: "MID",
    requiredSkills: [{ key: "python", label: "Python", requirement: "REQUIRED" }],
    preferredSkills: [], minExperienceMonths: null, maxExperienceMonths: null
  }), profile({ skills: ["python"] }), now);
  assert.equal(outsideFamily.label, "LOW_MATCH");
  assert.ok((outsideFamily.rankScore ?? 100) < 50);

  const farAboveExperience = evaluateAndRankJob(job({
    title: "Staff Backend Engineer", seniority: "STAFF", minExperienceMonths: 120, maxExperienceMonths: 144
  }), profile({ totalExperienceMonths: 44 }), now);
  assert.equal(farAboveExperience.label, "LOW_MATCH");
  assert.ok((farAboveExperience.rankScore ?? 100) < 50);

  const explicitlyAccepted = evaluateAndRankJob(job({
    title: "Data Engineer", roleFamily: "DATA", seniority: "MID",
    minExperienceMonths: 36, maxExperienceMonths: 60
  }), profile({}, { acceptableRoleFamilies: ["DATA"] }), now);
  assert.ok((explicitlyAccepted.rankScore ?? 0) >= 50);
});

test("Candidate Truth facts are adapted without becoming a second candidate profile store", () => {
  const facts = candidateJobFactsFromTruth([
    { canonicalKey: "CURRENT_JOB_TITLE", normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: "Backend Engineer" }, scope: {}, trustState: "TRUSTED" },
    { canonicalKey: "SKILLS", normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "MULTI_ENUM", values: [{ key: "node", label: "Node JS" }] }, scope: {}, trustState: "TRUSTED" },
    { canonicalKey: "TOTAL_EXPERIENCE", normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "DURATION", months: 56 }, scope: {}, trustState: "TRUSTED" },
    { canonicalKey: "WORK_AUTHORIZATION", normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "BOOLEAN", value: true }, scope: { countryCode: "IN" }, trustState: "TRUSTED" },
    { canonicalKey: "EXPECTED_CTC", normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "MONEY", amountExact: "2500000", currency: "INR", period: "YEAR" }, scope: {}, trustState: "TRUSTED" },
    { canonicalKey: "RELOCATION", normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "BOOLEAN", value: false }, scope: {}, trustState: "REVIEW" }
  ]);
  assert.deepEqual(facts, {
    currentRoleFamily: "BACKEND", skills: ["nodejs"], totalExperienceMonths: 56,
    authorizedCountryCodes: ["IN"], sponsorshipRequiredCountryCodes: [], currentCountryCode: null,
    expectedCompensationMinor: 250_000_000, expectedCompensationCurrencyCode: "INR",
    relocationWilling: false
  });
});

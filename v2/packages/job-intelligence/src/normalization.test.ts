import assert from "node:assert/strict";
import test from "node:test";
import { NormalizedJobSchema, RawJobPostingSchema } from "./contracts.js";
import { inferRoleFamily, inferSeniority, normalizeRawJob, normalizeSkill, normalizedUrl } from "./normalization.js";

export function rawPosting(overrides: Record<string, unknown> = {}) {
  return {
    source: {
      type: "ATS_API" as const,
      identifier: "greenhouse:razorpay",
      url: "https://boards.greenhouse.io/razorpay",
      externalJobId: "827361",
      ingestionVersion: "greenhouse-v1",
      etag: null,
      lastModified: null
    },
    observedAt: new Date("2026-09-01T10:00:00.000Z"),
    rawContent: JSON.stringify({ id: 827361, title: "Senior Backend Engineer" }),
    job: {
      title: "Senior Backend Engineer",
      companyName: "Razorpay Private Limited",
      companyWebsiteDomain: "razorpay.com",
      description: "Build reliable Node.js APIs with PostgreSQL and AWS.",
      locationText: "Bengaluru, Karnataka, India",
      countryCodes: ["IN"],
      workMode: "HYBRID" as const,
      remoteCountryCodes: [],
      employmentType: "FULL_TIME" as const,
      minExperienceMonths: 36,
      maxExperienceMonths: 72,
      requiredSkills: ["Node JS", "Postgres"],
      preferredSkills: ["AWS", "Node.js"],
      minCompensationMinor: 2_000_000_00,
      maxCompensationMinor: 3_000_000_00,
      currencyCode: "INR",
      compensationPeriod: "YEAR" as const,
      sponsorshipAvailable: false,
      workAuthorizationCountryCodes: ["IN"],
      educationRequirement: "Bachelor's degree or equivalent experience",
      relocationRequired: false,
      nightShiftRequired: false,
      heavyTravelRequired: false,
      employmentBondRequired: false,
      ats: "GREENHOUSE",
      applicationUrl: "https://boards.greenhouse.io/razorpay/jobs/827361?utm_source=feed",
      postedAt: new Date("2026-08-30T00:00:00.000Z"),
      expiresAt: null,
      explicitlyClosed: false,
      explicitlyRemoved: false,
      ...overrides
    }
  };
}

test("H2/H3 normalizes role, seniority, skills, URLs and provenance deterministically", () => {
  const normalized = normalizeRawJob(RawJobPostingSchema.parse(rawPosting()));
  assert.equal(normalized.roleFamily, "BACKEND");
  assert.equal(normalized.seniority, "SENIOR");
  assert.deepEqual(normalized.skills, [
    { key: "aws", label: "AWS", requirement: "PREFERRED" },
    { key: "nodejs", label: "Node.js", requirement: "REQUIRED" },
    { key: "postgresql", label: "PostgreSQL", requirement: "REQUIRED" }
  ]);
  assert.equal(normalized.applicationUrl, "https://boards.greenhouse.io/razorpay/jobs/827361");
  assert.equal(normalized.facts.title?.origin, "EXPLICIT_SOURCE_FACT");
  assert.equal(normalized.facts.roleFamily?.origin, "DETERMINISTIC_DERIVATION");
  assert.notEqual(normalized.rawSourceFingerprint, normalized.materialFingerprint);
  assert.deepEqual(normalized.strongDedupeKeys, [
    "company-requisition:razorpay:827361",
    "application-url:https://boards.greenhouse.io/razorpay/jobs/827361"
  ]);
});

test("normalization avoids exact-title dependence and rejects malformed structured source facts", () => {
  assert.equal(inferRoleFamily("SDE II, Platform APIs"), "OTHER");
  assert.equal(inferRoleFamily("Full Stack Product Engineer"), "FULLSTACK");
  assert.equal(inferSeniority("Software Engineer III"), "SENIOR");
  assert.deepEqual(normalizeSkill("K8s"), { key: "kubernetes", label: "Kubernetes" });
  assert.equal(normalizedUrl("https://example.com/job/1/?utm_source=x&ref=feed"), "https://example.com/job/1");
  assert.throws(
    () => RawJobPostingSchema.parse(rawPosting({ minExperienceMonths: 84, maxExperienceMonths: 24 })),
    /EXPERIENCE_RANGE_REVERSED/
  );
  assert.throws(
    () => RawJobPostingSchema.parse(rawPosting({ minCompensationMinor: 10, currencyCode: null })),
    /COMPENSATION_CURRENCY_REQUIRED/
  );
  const deterministic = normalizeRawJob(RawJobPostingSchema.parse(rawPosting()));
  assert.throws(
    () => NormalizedJobSchema.parse({
      ...deterministic,
      facts: {
        ...deterministic.facts,
        roleFamily: { ...deterministic.facts.roleFamily, origin: "AI_DERIVED", derivedBy: null, derivedVersion: null }
      }
    }),
    /AI_PROVENANCE_REQUIRED/
  );
});

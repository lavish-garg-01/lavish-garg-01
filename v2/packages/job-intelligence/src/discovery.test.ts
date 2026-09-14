import assert from "node:assert/strict";
import test from "node:test";
import { CandidateSearchPreferencesSchema, type CandidateJobProfile, type CatalogJob } from "./contracts.js";
import { JobDiscoveryService, type JobCatalogRepository } from "./discovery.js";

const now = new Date("2026-09-11T12:00:00.000Z");

function job(overrides: Partial<CatalogJob> = {}): CatalogJob {
  return {
    jobId: "10000000-0000-4000-8000-000000000001", materialVersion: 1,
    companyId: "20000000-0000-4000-8000-000000000001", companyName: "Bosch Group",
    normalizedCompanyName: "bosch group", title: "Sr. Data Engineer",
    description: "Build reliable data pipelines for connected products.",
    roleFamily: "DATA", seniority: "SENIOR", locationText: "Bengaluru, India",
    countryCodes: ["IN"], workMode: "ONSITE", remoteCountryCodes: [],
    employmentType: "FULL_TIME", minExperienceMonths: 36, maxExperienceMonths: 72,
    requiredSkills: [{ key: "python", label: "Python", requirement: "REQUIRED" }],
    preferredSkills: [], minCompensationMinor: null, maxCompensationMinor: null,
    currencyCode: null, compensationPeriod: null, sponsorshipAvailable: null,
    workAuthorizationCountryCodes: ["IN"], educationRequirement: null,
    relocationRequired: null, nightShiftRequired: null, heavyTravelRequired: null,
    employmentBondRequired: null, ats: "SMARTRECRUITERS",
    applicationUrl: "https://jobs.example/1", status: "ACTIVE",
    firstSeenAt: now, lastSeenAt: now, lastVerifiedAt: now, postedAt: now, expiresAt: null,
    ...overrides
  };
}

const profile: CandidateJobProfile = {
  preferences: CandidateSearchPreferencesSchema.parse({
    version: 1, targetRoleFamilies: ["BACKEND"], acceptableRoleFamilies: ["DATA"],
    preferredWorkModes: [], preferredCountryCodes: ["IN"], excludedCompanyNames: [],
    minimumCompensationMinor: null, compensationCurrencyCode: null,
    dealBreakers: { mandatoryRelocation: false, nightShift: false, heavyTravel: false, employmentBond: false }
  }),
  facts: {
    currentRoleFamily: "BACKEND", skills: ["python"], totalExperienceMonths: 48,
    authorizedCountryCodes: ["IN"], sponsorshipRequiredCountryCodes: [], currentCountryCode: "IN",
    expectedCompensationMinor: null, expectedCompensationCurrencyCode: null, relocationWilling: true
  }
};

test("candidate discovery collapses exact presentation duplicates but preserves materially distinct requisitions", async () => {
  const duplicate = job({
    jobId: "10000000-0000-4000-8000-000000000002",
    applicationUrl: "https://jobs.example/2",
    lastSeenAt: new Date(now.getTime() - 1_000), lastVerifiedAt: new Date(now.getTime() - 1_000)
  });
  const distinct = job({
    jobId: "10000000-0000-4000-8000-000000000003",
    applicationUrl: "https://jobs.example/3",
    description: "Build streaming data products and own their production reliability."
  });
  const jobs = [duplicate, distinct, job()];
  const repository: JobCatalogRepository = {
    listDiscoverable: async () => jobs,
    findById: async (jobId) => jobs.find((item) => item.jobId === jobId) ?? null
  };
  const discovery = new JobDiscoveryService(
    repository, { getCandidateJobProfile: async () => profile }, { now: () => now }
  );

  const page = await discovery.discover({ accountId: "account", candidateId: "candidate", limit: 20 });
  assert.deepEqual(page.items.map((item) => item.job.jobId).sort(), [
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000003"
  ]);

  const related = await discovery.related({
    accountId: "account", candidateId: "candidate", jobId: duplicate.jobId, limit: 5
  });
  assert.deepEqual(related.items.map((item) => item.job.jobId), [distinct.jobId]);
});

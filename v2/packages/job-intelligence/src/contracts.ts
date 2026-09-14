import { z } from "zod";

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const httpUrl = z.url().max(2_048).refine((value) => {
  const parsed = new URL(value);
  return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
}, "UNSAFE_URL");
const countryCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);

export const JOB_SOURCE_TYPES = ["ATS_API", "COMPANY_CAREERS", "CRAWLER", "IMPORTED_FEED", "CONNECTOR"] as const;
export const JOB_FACT_ORIGINS = ["EXPLICIT_SOURCE_FACT", "DETERMINISTIC_DERIVATION", "AI_DERIVED"] as const;
export const JOB_LIFECYCLE_STATUSES = ["ACTIVE", "STALE", "CLOSED", "EXPIRED", "REMOVED"] as const;
export const WORK_MODES = ["ONSITE", "HYBRID", "REMOTE"] as const;
export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "TEMPORARY"] as const;
export const ROLE_FAMILIES = [
  "BACKEND", "FRONTEND", "FULLSTACK", "MOBILE", "DEVOPS", "DATA", "ML_AI",
  "QA", "SECURITY", "EMBEDDED", "PRODUCT", "DESIGN", "ENGINEERING_MANAGEMENT", "OTHER"
] as const;
export const SENIORITY_LEVELS = ["INTERN", "ENTRY", "MID", "SENIOR", "LEAD", "STAFF", "PRINCIPAL", "MANAGER", "DIRECTOR", "UNKNOWN"] as const;

export const SourceFactSchema = z.object({
  origin: z.enum(JOB_FACT_ORIGINS),
  evidencePath: boundedText(240),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  derivedBy: boundedText(120).nullable(),
  derivedVersion: boundedText(80).nullable(),
  confidence: z.number().min(0).max(1)
}).strict().superRefine((fact, context) => {
  if (fact.origin === "AI_DERIVED" && (!fact.derivedBy || !fact.derivedVersion)) {
    context.addIssue({ code: "custom", message: "AI_PROVENANCE_REQUIRED" });
  }
});

export const RawJobPostingSchema = z.object({
  source: z.object({
    type: z.enum(JOB_SOURCE_TYPES),
    identifier: boundedText(240),
    url: httpUrl,
    externalJobId: boundedText(240).nullable().default(null),
    ingestionVersion: boundedText(80),
    etag: boundedText(512).nullable().default(null),
    lastModified: boundedText(512).nullable().default(null)
  }).strict(),
  observedAt: z.coerce.date(),
  rawContent: z.string().min(1).max(2_000_000),
  job: z.object({
    title: boundedText(300),
    companyName: boundedText(300),
    companyWebsiteDomain: boundedText(255).nullable().default(null),
    description: z.string().trim().min(1).max(200_000),
    locationText: boundedText(500).nullable().default(null),
    countryCodes: z.array(countryCode).max(20).default([]),
    workMode: z.enum(WORK_MODES).nullable().default(null),
    remoteCountryCodes: z.array(countryCode).max(250).default([]),
    employmentType: z.enum(EMPLOYMENT_TYPES).nullable().default(null),
    minExperienceMonths: z.number().int().min(0).max(1_200).nullable().default(null),
    maxExperienceMonths: z.number().int().min(0).max(1_200).nullable().default(null),
    requiredSkills: z.array(boundedText(120)).max(100).default([]),
    preferredSkills: z.array(boundedText(120)).max(100).default([]),
    minCompensationMinor: z.number().int().min(0).nullable().default(null),
    maxCompensationMinor: z.number().int().min(0).nullable().default(null),
    currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullable().default(null),
    compensationPeriod: z.enum(["HOUR", "DAY", "WEEK", "MONTH", "YEAR", "ONE_TIME"]).nullable().default(null),
    sponsorshipAvailable: z.boolean().nullable().default(null),
    workAuthorizationCountryCodes: z.array(countryCode).max(20).default([]),
    educationRequirement: boundedText(1_000).nullable().default(null),
    relocationRequired: z.boolean().nullable().default(null),
    nightShiftRequired: z.boolean().nullable().default(null),
    heavyTravelRequired: z.boolean().nullable().default(null),
    employmentBondRequired: z.boolean().nullable().default(null),
    ats: boundedText(120).nullable().default(null),
    applicationUrl: httpUrl,
    postedAt: z.coerce.date().nullable().default(null),
    expiresAt: z.coerce.date().nullable().default(null),
    explicitlyClosed: z.boolean().default(false),
    explicitlyRemoved: z.boolean().default(false)
  }).strict().superRefine((job, context) => {
    if (job.minExperienceMonths !== null && job.maxExperienceMonths !== null && job.minExperienceMonths > job.maxExperienceMonths) {
      context.addIssue({ code: "custom", message: "EXPERIENCE_RANGE_REVERSED" });
    }
    if (job.minCompensationMinor !== null && job.maxCompensationMinor !== null && job.minCompensationMinor > job.maxCompensationMinor) {
      context.addIssue({ code: "custom", message: "COMPENSATION_RANGE_REVERSED" });
    }
    if ((job.minCompensationMinor !== null || job.maxCompensationMinor !== null) && !job.currencyCode) {
      context.addIssue({ code: "custom", message: "COMPENSATION_CURRENCY_REQUIRED" });
    }
  })
}).strict();

export type JobSourceType = (typeof JOB_SOURCE_TYPES)[number];
export type JobFactOrigin = (typeof JOB_FACT_ORIGINS)[number];
export type JobLifecycleStatus = (typeof JOB_LIFECYCLE_STATUSES)[number];
export type WorkMode = (typeof WORK_MODES)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type RoleFamily = (typeof ROLE_FAMILIES)[number];
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];
export type SourceFact = z.infer<typeof SourceFactSchema>;
export type RawJobPosting = z.infer<typeof RawJobPostingSchema>;

export interface NormalizedSkill {
  key: string;
  label: string;
  requirement: "REQUIRED" | "PREFERRED";
}

export interface NormalizedJob {
  sourceIdentityKey: string;
  strongDedupeKeys: readonly string[];
  rawSourceFingerprint: string;
  materialFingerprint: string;
  canonicalCompanyName: string;
  normalizedCompanyName: string;
  companyWebsiteDomain: string | null;
  canonicalTitle: string;
  normalizedTitle: string;
  description: string;
  roleFamily: RoleFamily;
  seniority: SeniorityLevel;
  locationText: string | null;
  countryCodes: readonly string[];
  workMode: WorkMode | null;
  remoteCountryCodes: readonly string[];
  employmentType: EmploymentType | null;
  minExperienceMonths: number | null;
  maxExperienceMonths: number | null;
  skills: readonly NormalizedSkill[];
  minCompensationMinor: number | null;
  maxCompensationMinor: number | null;
  currencyCode: string | null;
  compensationPeriod: string | null;
  sponsorshipAvailable: boolean | null;
  workAuthorizationCountryCodes: readonly string[];
  educationRequirement: string | null;
  relocationRequired: boolean | null;
  nightShiftRequired: boolean | null;
  heavyTravelRequired: boolean | null;
  employmentBondRequired: boolean | null;
  ats: string | null;
  applicationUrl: string;
  postedAt: Date | null;
  expiresAt: Date | null;
  lifecycleStatus: JobLifecycleStatus;
  facts: Readonly<Record<string, SourceFact>>;
}

export const NormalizedJobSchema: z.ZodType<NormalizedJob> = z.object({
  sourceIdentityKey: boundedText(1_000),
  strongDedupeKeys: z.array(boundedText(2_048)).max(10),
  rawSourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  materialFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  canonicalCompanyName: boundedText(300),
  normalizedCompanyName: boundedText(300),
  companyWebsiteDomain: boundedText(255).nullable(),
  canonicalTitle: boundedText(300),
  normalizedTitle: boundedText(300),
  description: z.string().trim().min(1).max(200_000),
  roleFamily: z.enum(ROLE_FAMILIES),
  seniority: z.enum(SENIORITY_LEVELS),
  locationText: boundedText(500).nullable(),
  countryCodes: z.array(countryCode).max(20),
  workMode: z.enum(WORK_MODES).nullable(),
  remoteCountryCodes: z.array(countryCode).max(250),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable(),
  minExperienceMonths: z.number().int().min(0).max(1_200).nullable(),
  maxExperienceMonths: z.number().int().min(0).max(1_200).nullable(),
  skills: z.array(z.object({
    key: boundedText(120),
    label: boundedText(120),
    requirement: z.enum(["REQUIRED", "PREFERRED"])
  }).strict()).max(200),
  minCompensationMinor: z.number().int().min(0).nullable(),
  maxCompensationMinor: z.number().int().min(0).nullable(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  compensationPeriod: z.enum(["HOUR", "DAY", "WEEK", "MONTH", "YEAR", "ONE_TIME"]).nullable(),
  sponsorshipAvailable: z.boolean().nullable(),
  workAuthorizationCountryCodes: z.array(countryCode).max(20),
  educationRequirement: boundedText(1_000).nullable(),
  relocationRequired: z.boolean().nullable(),
  nightShiftRequired: z.boolean().nullable(),
  heavyTravelRequired: z.boolean().nullable(),
  employmentBondRequired: z.boolean().nullable(),
  ats: boundedText(120).nullable(),
  applicationUrl: httpUrl,
  postedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  lifecycleStatus: z.enum(JOB_LIFECYCLE_STATUSES),
  facts: z.record(z.string(), SourceFactSchema)
}).strict().superRefine((job, context) => {
  if (job.minExperienceMonths !== null && job.maxExperienceMonths !== null && job.minExperienceMonths > job.maxExperienceMonths) {
    context.addIssue({ code: "custom", message: "EXPERIENCE_RANGE_REVERSED" });
  }
  if (job.minCompensationMinor !== null && job.maxCompensationMinor !== null && job.minCompensationMinor > job.maxCompensationMinor) {
    context.addIssue({ code: "custom", message: "COMPENSATION_RANGE_REVERSED" });
  }
  if ((job.minCompensationMinor !== null || job.maxCompensationMinor !== null) && !job.currencyCode) {
    context.addIssue({ code: "custom", message: "COMPENSATION_CURRENCY_REQUIRED" });
  }
});

export const CandidateSearchPreferencesSchema = z.object({
  version: z.literal(1),
  targetRoleFamilies: z.array(z.enum(ROLE_FAMILIES)).max(20).default([]),
  acceptableRoleFamilies: z.array(z.enum(ROLE_FAMILIES)).max(20).default([]),
  preferredWorkModes: z.array(z.enum(WORK_MODES)).max(3).default([]),
  preferredCountryCodes: z.array(countryCode).max(20).default([]),
  excludedCompanyNames: z.array(boundedText(300)).max(200).default([]),
  minimumCompensationMinor: z.number().int().min(0).nullable().default(null),
  compensationCurrencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullable().default(null),
  dealBreakers: z.object({
    mandatoryRelocation: z.boolean().default(false),
    nightShift: z.boolean().default(false),
    heavyTravel: z.boolean().default(false),
    employmentBond: z.boolean().default(false)
  }).strict()
}).strict();

export type CandidateSearchPreferences = z.infer<typeof CandidateSearchPreferencesSchema>;

export interface CandidateJobFacts {
  currentRoleFamily: RoleFamily | null;
  skills: readonly string[];
  totalExperienceMonths: number | null;
  authorizedCountryCodes: readonly string[];
  sponsorshipRequiredCountryCodes: readonly string[];
  currentCountryCode: string | null;
  expectedCompensationMinor: number | null;
  expectedCompensationCurrencyCode: string | null;
  relocationWilling: boolean | null;
}

export interface CandidateJobProfile {
  preferences: CandidateSearchPreferences;
  facts: CandidateJobFacts;
}

export interface CatalogJob {
  jobId: string;
  materialVersion: number;
  companyId: string;
  companyName: string;
  normalizedCompanyName: string;
  title: string;
  description: string;
  roleFamily: RoleFamily;
  seniority: SeniorityLevel;
  locationText: string | null;
  countryCodes: readonly string[];
  workMode: WorkMode | null;
  remoteCountryCodes: readonly string[];
  employmentType: EmploymentType | null;
  minExperienceMonths: number | null;
  maxExperienceMonths: number | null;
  requiredSkills: readonly NormalizedSkill[];
  preferredSkills: readonly NormalizedSkill[];
  minCompensationMinor: number | null;
  maxCompensationMinor: number | null;
  currencyCode: string | null;
  compensationPeriod: string | null;
  sponsorshipAvailable: boolean | null;
  workAuthorizationCountryCodes: readonly string[];
  educationRequirement: string | null;
  relocationRequired: boolean | null;
  nightShiftRequired: boolean | null;
  heavyTravelRequired: boolean | null;
  employmentBondRequired: boolean | null;
  ats: string | null;
  applicationUrl: string;
  status: JobLifecycleStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastVerifiedAt: Date | null;
  postedAt: Date | null;
  expiresAt: Date | null;
}

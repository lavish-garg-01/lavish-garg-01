import { createDatabase, KyselyJobIngestionRepository } from "@job-hunter-v2/database";
import { JobIngestionService, RawJobPostingSchema } from "@job-hunter-v2/job-intelligence";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to seed the H0 audit catalog.");

const database = createDatabase({ connectionString });
const ingestion = new JobIngestionService(new KyselyJobIngestionRepository(database));
const day = new Date().toISOString().slice(0, 10);
const observedAt = new Date(`${day}T00:00:00.000Z`);

type AuditJob = {
  key: string;
  title: string;
  companyName?: string;
  description: string;
  countryCodes?: string[];
  workMode?: "ONSITE" | "HYBRID" | "REMOTE";
  remoteCountryCodes?: string[];
  minExperienceMonths?: number | null;
  maxExperienceMonths?: number | null;
  requiredSkills?: string[];
  preferredSkills?: string[];
  sponsorshipAvailable?: boolean | null;
  workAuthorizationCountryCodes?: string[];
  relocationRequired?: boolean | null;
  nightShiftRequired?: boolean | null;
  heavyTravelRequired?: boolean | null;
  employmentBondRequired?: boolean | null;
};

const jobs: AuditJob[] = [
  {
    key: "strong-backend", title: "Senior Backend Engineer", companyName: "Audit Labs India",
    description: "Build reliable TypeScript and Node.js APIs backed by PostgreSQL and AWS.",
    workMode: "HYBRID", minExperienceMonths: 36, maxExperienceMonths: 72,
    requiredSkills: ["TypeScript", "Node.js", "PostgreSQL"], preferredSkills: ["AWS"],
    sponsorshipAvailable: true, workAuthorizationCountryCodes: ["IN"]
  },
  {
    key: "weak-eligible", title: "Frontend UI Engineer", companyName: "Pixel Audit",
    description: "Build accessible user interfaces with Vue, CSS and modern browser APIs.",
    workMode: "HYBRID", minExperienceMonths: 24, maxExperienceMonths: 72,
    requiredSkills: ["Vue", "CSS"], preferredSkills: ["JavaScript"]
  },
  {
    key: "lower-seniority", title: "Junior Backend Engineer", companyName: "Audit Starter",
    description: "Grow backend services using Node.js and PostgreSQL with senior mentorship.",
    workMode: "ONSITE", minExperienceMonths: 12, maxExperienceMonths: 36,
    requiredSkills: ["Node.js", "PostgreSQL"]
  },
  {
    key: "higher-seniority", title: "Lead Backend Engineer", companyName: "Audit Scale",
    description: "Lead a backend team building TypeScript services and distributed systems.",
    workMode: "HYBRID", minExperienceMonths: 72, maxExperienceMonths: 108,
    requiredSkills: ["TypeScript", "Node.js", "Distributed Systems"]
  },
  {
    key: "excessive-seniority", title: "Principal Backend Engineer", companyName: "Audit Principal",
    description: "Set organization-wide platform architecture and technical direction.",
    workMode: "HYBRID", minExperienceMonths: 120, maxExperienceMonths: 180,
    requiredSkills: ["Distributed Systems", "Architecture"]
  },
  {
    key: "unknown-requirements", title: "Software Engineer", companyName: "Audit Unknowns",
    description: "Join an engineering team; exact work arrangement and requirements will be discussed.",
    countryCodes: [], workMode: undefined, minExperienceMonths: null, maxExperienceMonths: null,
    requiredSkills: [], preferredSkills: [], sponsorshipAvailable: null,
    workAuthorizationCountryCodes: []
  },
  {
    key: "excluded-company", title: "Backend Engineer", companyName: "Blocked Audit Corp",
    description: "Build Node.js services for a company explicitly excluded by the candidate.",
    workMode: "HYBRID", requiredSkills: ["Node.js"]
  },
  {
    key: "sponsorship-conflict", title: "Backend Engineer — US", companyName: "Audit Visa",
    description: "US backend role that explicitly cannot sponsor employment authorization.",
    countryCodes: ["US"], workMode: "ONSITE", requiredSkills: ["Node.js"],
    sponsorshipAvailable: false, workAuthorizationCountryCodes: ["US"]
  },
  {
    key: "remote-geo-conflict", title: "Remote Backend Engineer — US only", companyName: "Audit Remote",
    description: "Remote backend work explicitly restricted to candidates located in the United States.",
    countryCodes: ["US"], workMode: "REMOTE", remoteCountryCodes: ["US"], requiredSkills: ["Node.js"]
  },
  {
    key: "relocation-conflict", title: "Backend Engineer — Relocation", companyName: "Audit Relocate",
    description: "Backend position requiring permanent relocation to the work location.",
    workMode: "ONSITE", relocationRequired: true, requiredSkills: ["Node.js"]
  },
  {
    key: "night-conflict", title: "Backend Engineer — Night Shift", companyName: "Audit Nights",
    description: "Backend operations role with an explicit permanent night-shift requirement.",
    workMode: "REMOTE", remoteCountryCodes: ["IN"], nightShiftRequired: true, requiredSkills: ["Node.js"]
  },
  {
    key: "travel-conflict", title: "Solutions Engineer — Heavy Travel", companyName: "Audit Travel",
    description: "Engineering role that explicitly requires frequent heavy travel.",
    workMode: "HYBRID", heavyTravelRequired: true, requiredSkills: ["Node.js"]
  },
  {
    key: "bond-conflict", title: "Graduate Engineer — Employment Bond", companyName: "Audit Bond",
    description: "Engineering role with an explicit mandatory employment bond.",
    workMode: "ONSITE", employmentBondRequired: true, requiredSkills: ["JavaScript"]
  }
];

// More than one discovery page proves that eligibility is applied before the
// cursor boundary and that hidden fixtures cannot reappear on page two.
jobs.push(...Array.from({ length: 22 }, (_, index): AuditJob => ({
  key: `pagination-backend-${String(index + 1).padStart(2, "0")}`,
  title: `Backend Platform Engineer ${index + 1}`,
  companyName: `Audit Platform ${index + 1}`,
  description: "Controlled pagination fixture for a Node.js backend role in India.",
  workMode: index % 2 ? "HYBRID" : "REMOTE",
  remoteCountryCodes: index % 2 ? [] : ["IN"],
  minExperienceMonths: 36,
  maxExperienceMonths: 72,
  requiredSkills: ["Node.js", "TypeScript"]
})));

try {
  for (const fixture of jobs) {
    const companyName = fixture.companyName ?? "Audit Labs India";
    const posting = RawJobPostingSchema.parse({
      source: {
        type: "IMPORTED_FEED",
        identifier: "h0-controlled-audit-feed",
        url: "https://feed.audit.example/jobs",
        externalJobId: fixture.key,
        ingestionVersion: "h0-v1",
        etag: null,
        lastModified: null
      },
      observedAt,
      rawContent: JSON.stringify({ fixture: fixture.key, day }),
      job: {
        title: fixture.title,
        companyName,
        companyWebsiteDomain: `${fixture.key}.audit.example`,
        description: fixture.description,
        locationText: (fixture.countryCodes ?? ["IN"]).length ? `${(fixture.countryCodes ?? ["IN"])[0]} · controlled audit fixture` : null,
        countryCodes: fixture.countryCodes ?? ["IN"],
        workMode: fixture.workMode ?? null,
        remoteCountryCodes: fixture.remoteCountryCodes ?? [],
        employmentType: "FULL_TIME",
        minExperienceMonths: fixture.minExperienceMonths === undefined ? 36 : fixture.minExperienceMonths,
        maxExperienceMonths: fixture.maxExperienceMonths === undefined ? 72 : fixture.maxExperienceMonths,
        requiredSkills: fixture.requiredSkills ?? [],
        preferredSkills: fixture.preferredSkills ?? [],
        minCompensationMinor: 1_800_000_00,
        maxCompensationMinor: 3_000_000_00,
        currencyCode: "INR",
        compensationPeriod: "YEAR",
        sponsorshipAvailable: fixture.sponsorshipAvailable ?? null,
        workAuthorizationCountryCodes: fixture.workAuthorizationCountryCodes ?? [],
        educationRequirement: null,
        relocationRequired: fixture.relocationRequired ?? false,
        nightShiftRequired: fixture.nightShiftRequired ?? false,
        heavyTravelRequired: fixture.heavyTravelRequired ?? false,
        employmentBondRequired: fixture.employmentBondRequired ?? false,
        ats: "AUDIT_FIXTURE",
        applicationUrl: `https://jobs.audit.example/${fixture.key}`,
        postedAt: observedAt,
        expiresAt: null,
        explicitlyClosed: false,
        explicitlyRemoved: false
      }
    });
    const result = await ingestion.ingest({
      posting,
      idempotencyKey: `h0-audit:${day}:${fixture.key}:v1`
    });
    process.stdout.write(`${fixture.key}: ${result.jobId} (${result.idempotentReplay ? "replay" : result.created ? "created" : "updated"})\n`);
  }
} finally {
  await database.destroy();
}

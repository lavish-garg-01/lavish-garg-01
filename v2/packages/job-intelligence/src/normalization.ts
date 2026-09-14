import { createHash } from "node:crypto";
import { RawJobPostingSchema, type NormalizedJob, type RawJobPosting, type RoleFamily, type SeniorityLevel, type SourceFact } from "./contracts.js";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizedText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9+#.]+/g, " ").trim().replace(/\s+/g, " ");
}

export function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|source$|ref$|referrer$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  url.searchParams.sort();
  return url.toString();
}

const skillAliases: Readonly<Record<string, { key: string; label: string }>> = {
  "node": { key: "nodejs", label: "Node.js" }, "node js": { key: "nodejs", label: "Node.js" }, "node.js": { key: "nodejs", label: "Node.js" },
  "js": { key: "javascript", label: "JavaScript" }, "javascript": { key: "javascript", label: "JavaScript" },
  "ts": { key: "typescript", label: "TypeScript" }, "typescript": { key: "typescript", label: "TypeScript" },
  "react.js": { key: "react", label: "React" }, "reactjs": { key: "react", label: "React" }, "react": { key: "react", label: "React" },
  "postgres": { key: "postgresql", label: "PostgreSQL" }, "postgresql": { key: "postgresql", label: "PostgreSQL" },
  "k8s": { key: "kubernetes", label: "Kubernetes" }, "kubernetes": { key: "kubernetes", label: "Kubernetes" },
  "amazon web services": { key: "aws", label: "AWS" }, "aws": { key: "aws", label: "AWS" },
  "google cloud platform": { key: "gcp", label: "GCP" }, "gcp": { key: "gcp", label: "GCP" },
  "c sharp": { key: "csharp", label: "C#" }, "c#": { key: "csharp", label: "C#" },
  "c plus plus": { key: "cpp", label: "C++" }, "c++": { key: "cpp", label: "C++" }
};

export function normalizeSkill(value: string): { key: string; label: string } {
  const normalized = normalizedText(value);
  return skillAliases[normalized] ?? {
    key: normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120),
    label: value.trim().replace(/\s+/g, " ").slice(0, 120)
  };
}

export function inferRoleFamily(title: string): RoleFamily {
  const value = normalizedText(title);
  if (/\b(engineering manager|head of engineering|vp engineering)\b/.test(value)) return "ENGINEERING_MANAGEMENT";
  if (/\b(machine learning|ml engineer|artificial intelligence|ai engineer|data scientist)\b/.test(value)) return "ML_AI";
  if (/\b(data engineer|analytics engineer|etl)\b/.test(value)) return "DATA";
  if (/\b(devops|site reliability|sre|platform engineer|cloud engineer)\b/.test(value)) return "DEVOPS";
  if (/\b(security|appsec|cybersecurity)\b/.test(value)) return "SECURITY";
  if (/\b(qa|quality assurance|test automation|sdet)\b/.test(value)) return "QA";
  if (/\b(android|ios|mobile|flutter|react native)\b/.test(value)) return "MOBILE";
  if (/\b(embedded|firmware|iot)\b/.test(value)) return "EMBEDDED";
  if (/\b(full stack|fullstack)\b/.test(value)) return "FULLSTACK";
  if (/\b(front end|frontend|ui engineer|react developer)\b/.test(value)) return "FRONTEND";
  if (/\b(back end|backend|server|api engineer)\b/.test(value)) return "BACKEND";
  if (/\bproduct manager|product owner\b/.test(value)) return "PRODUCT";
  if (/\b(product designer|ux|ui designer)\b/.test(value)) return "DESIGN";
  return "OTHER";
}

export function inferSeniority(title: string): SeniorityLevel {
  const value = normalizedText(title);
  if (/\b(intern|trainee|apprentice)\b/.test(value)) return "INTERN";
  if (/\b(director|head|vice president|vp)\b/.test(value)) return "DIRECTOR";
  if (/\b(engineering manager|manager)\b/.test(value)) return "MANAGER";
  if (/\b(principal)\b/.test(value)) return "PRINCIPAL";
  if (/\b(staff)\b/.test(value)) return "STAFF";
  if (/\b(lead|tech lead)\b/.test(value)) return "LEAD";
  if (/\b(senior|sr\.?|sde[ -]?3|software engineer iii)\b/.test(value)) return "SENIOR";
  if (/\b(junior|jr\.?|entry|graduate|sde[ -]?1|software engineer i)\b/.test(value)) return "ENTRY";
  if (/\b(sde[ -]?2|software engineer ii|engineer)\b/.test(value)) return "MID";
  return "UNKNOWN";
}

function explicitFact(rawFingerprint: string, path: string): SourceFact {
  return {
    origin: "EXPLICIT_SOURCE_FACT",
    evidencePath: path,
    evidenceHash: sha256(`${rawFingerprint}:${path}`),
    derivedBy: null,
    derivedVersion: null,
    confidence: 1
  };
}

function derivedFact(rawFingerprint: string, path: string, version: string): SourceFact {
  return {
    origin: "DETERMINISTIC_DERIVATION",
    evidencePath: path,
    evidenceHash: sha256(`${rawFingerprint}:${path}`),
    derivedBy: "JOB_NORMALIZER",
    derivedVersion: version,
    confidence: 0.95
  };
}

export const JOB_NORMALIZATION_VERSION = "H-1";

export function normalizeRawJob(input: RawJobPosting): NormalizedJob {
  const raw = RawJobPostingSchema.parse(input);
  const rawSourceFingerprint = sha256(raw.rawContent);
  const title = raw.job.title.trim().replace(/\s+/g, " ");
  const company = raw.job.companyName.trim().replace(/\s+/g, " ");
  const applicationUrl = normalizedUrl(raw.job.applicationUrl);
  const sourceUrl = normalizedUrl(raw.source.url);
  const sourceIdentity = raw.source.externalJobId
    ? `${raw.source.type}:${normalizedText(raw.source.identifier)}:external:${normalizedText(raw.source.externalJobId)}`
    : `${raw.source.type}:${normalizedText(raw.source.identifier)}:url:${sourceUrl}`;
  const required = raw.job.requiredSkills.map(normalizeSkill);
  const requiredKeys = new Set(required.map((skill) => skill.key));
  const preferred = raw.job.preferredSkills.map(normalizeSkill).filter((skill) => !requiredKeys.has(skill.key));
  const skills = [
    ...new Map(required.map((skill) => [skill.key, { ...skill, requirement: "REQUIRED" as const }])).values(),
    ...new Map(preferred.map((skill) => [skill.key, { ...skill, requirement: "PREFERRED" as const }])).values()
  ].sort((a, b) => a.key.localeCompare(b.key));
  const countryCodes = [...new Set(raw.job.countryCodes)].sort();
  const remoteCountryCodes = [...new Set(raw.job.remoteCountryCodes)].sort();
  const authorizationCountries = [...new Set(raw.job.workAuthorizationCountryCodes)].sort();
  const roleFamily = inferRoleFamily(title);
  const seniority = inferSeniority(title);
  const normalizedCompanyName = normalizedText(company).replace(/\b(?:private limited|pvt ltd|limited|ltd|incorporated|inc|llc)\b/g, "").trim();
  const material = {
    company: normalizedCompanyName, title: normalizedText(title), description: raw.job.description.trim(),
    roleFamily, seniority, location: raw.job.locationText, countryCodes, workMode: raw.job.workMode,
    remoteCountryCodes, employmentType: raw.job.employmentType,
    experience: [raw.job.minExperienceMonths, raw.job.maxExperienceMonths], skills,
    compensation: [raw.job.minCompensationMinor, raw.job.maxCompensationMinor, raw.job.currencyCode, raw.job.compensationPeriod],
    sponsorshipAvailable: raw.job.sponsorshipAvailable, authorizationCountries,
    education: raw.job.educationRequirement, relocation: raw.job.relocationRequired,
    nightShift: raw.job.nightShiftRequired, heavyTravel: raw.job.heavyTravelRequired,
    bond: raw.job.employmentBondRequired, applicationUrl, expiresAt: raw.job.expiresAt?.toISOString() ?? null
  };
  const facts: Record<string, SourceFact> = {
    title: explicitFact(rawSourceFingerprint, "job.title"),
    company: explicitFact(rawSourceFingerprint, "job.companyName"),
    description: explicitFact(rawSourceFingerprint, "job.description"),
    applicationUrl: explicitFact(rawSourceFingerprint, "job.applicationUrl"),
    roleFamily: derivedFact(rawSourceFingerprint, "job.title", JOB_NORMALIZATION_VERSION),
    seniority: derivedFact(rawSourceFingerprint, "job.title", JOB_NORMALIZATION_VERSION),
    skills: derivedFact(rawSourceFingerprint, "job.requiredSkills|job.preferredSkills", JOB_NORMALIZATION_VERSION)
  };
  for (const key of ["locationText", "countryCodes", "workMode", "remoteCountryCodes", "employmentType", "minExperienceMonths", "maxExperienceMonths", "minCompensationMinor", "maxCompensationMinor", "currencyCode", "sponsorshipAvailable", "workAuthorizationCountryCodes", "educationRequirement", "relocationRequired", "nightShiftRequired", "heavyTravelRequired", "employmentBondRequired", "ats", "postedAt", "expiresAt"] as const) {
    if (raw.job[key] !== null && (!Array.isArray(raw.job[key]) || raw.job[key].length > 0)) facts[key] = explicitFact(rawSourceFingerprint, `job.${key}`);
  }
  const lifecycleStatus = raw.job.explicitlyRemoved ? "REMOVED"
    : raw.job.explicitlyClosed ? "CLOSED"
      : raw.job.expiresAt && raw.job.expiresAt <= raw.observedAt ? "EXPIRED" : "ACTIVE";
  const strongDedupeKeys = [
    ...(raw.source.externalJobId ? [`company-requisition:${normalizedCompanyName}:${normalizedText(raw.source.externalJobId)}`] : []),
    `application-url:${applicationUrl}`
  ];
  return {
    sourceIdentityKey: sha256(sourceIdentity), strongDedupeKeys,
    rawSourceFingerprint, materialFingerprint: sha256(JSON.stringify(stable(material))),
    canonicalCompanyName: company, normalizedCompanyName,
    companyWebsiteDomain: raw.job.companyWebsiteDomain?.toLowerCase() ?? null,
    canonicalTitle: title, normalizedTitle: normalizedText(title), description: raw.job.description.trim(),
    roleFamily, seniority, locationText: raw.job.locationText,
    countryCodes, workMode: raw.job.workMode, remoteCountryCodes,
    employmentType: raw.job.employmentType, minExperienceMonths: raw.job.minExperienceMonths,
    maxExperienceMonths: raw.job.maxExperienceMonths, skills,
    minCompensationMinor: raw.job.minCompensationMinor, maxCompensationMinor: raw.job.maxCompensationMinor,
    currencyCode: raw.job.currencyCode, compensationPeriod: raw.job.compensationPeriod,
    sponsorshipAvailable: raw.job.sponsorshipAvailable,
    workAuthorizationCountryCodes: authorizationCountries,
    educationRequirement: raw.job.educationRequirement, relocationRequired: raw.job.relocationRequired,
    nightShiftRequired: raw.job.nightShiftRequired, heavyTravelRequired: raw.job.heavyTravelRequired,
    employmentBondRequired: raw.job.employmentBondRequired, ats: raw.job.ats,
    applicationUrl, postedAt: raw.job.postedAt, expiresAt: raw.job.expiresAt,
    lifecycleStatus, facts
  };
}

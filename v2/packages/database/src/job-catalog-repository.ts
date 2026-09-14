import type { CatalogJob, JobCatalogRepository, NormalizedSkill } from "@job-hunter-v2/job-intelligence";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

interface CatalogRow {
  job_id: string;
  material_version: number;
  company_id: string;
  company_name: string;
  normalized_company_name: string;
  title: string;
  description: string;
  role_family: CatalogJob["roleFamily"];
  seniority: CatalogJob["seniority"];
  location_text: string | null;
  country_codes: string[];
  work_mode: CatalogJob["workMode"];
  remote_country_codes: string[];
  employment_type: CatalogJob["employmentType"];
  min_experience_months: number | null;
  max_experience_months: number | null;
  min_compensation_minor: string | number | null;
  max_compensation_minor: string | number | null;
  currency_code: string | null;
  compensation_period: string | null;
  sponsorship_available: boolean | null;
  work_authorization_country_codes: string[];
  education_requirement: string | null;
  relocation_required: boolean | null;
  night_shift_required: boolean | null;
  heavy_travel_required: boolean | null;
  employment_bond_required: boolean | null;
  ats: string | null;
  application_url: string;
  status: CatalogJob["status"];
  first_seen_at: Date;
  last_seen_at: Date;
  last_verified_at: Date | null;
  published_at: Date | null;
  expires_at: Date | null;
}

interface SkillRow {
  job_id: string;
  canonical_name: string;
  requirement: "REQUIRED" | "PREFERRED" | "ALTERNATIVE";
}

function safeNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function skill(row: SkillRow): NormalizedSkill {
  return {
    key: row.canonical_name,
    label: row.canonical_name,
    requirement: row.requirement === "PREFERRED" ? "PREFERRED" : "REQUIRED"
  };
}

function catalog(row: CatalogRow, skills: readonly SkillRow[]): CatalogJob {
  return {
    jobId: row.job_id, materialVersion: row.material_version,
    companyId: row.company_id, companyName: row.company_name,
    normalizedCompanyName: row.normalized_company_name, title: row.title,
    description: row.description, roleFamily: row.role_family, seniority: row.seniority,
    locationText: row.location_text, countryCodes: row.country_codes, workMode: row.work_mode,
    remoteCountryCodes: row.remote_country_codes, employmentType: row.employment_type,
    minExperienceMonths: row.min_experience_months, maxExperienceMonths: row.max_experience_months,
    requiredSkills: skills.filter((item) => item.requirement !== "PREFERRED").map(skill),
    preferredSkills: skills.filter((item) => item.requirement === "PREFERRED").map(skill),
    minCompensationMinor: safeNumber(row.min_compensation_minor),
    maxCompensationMinor: safeNumber(row.max_compensation_minor),
    currencyCode: row.currency_code, compensationPeriod: row.compensation_period,
    sponsorshipAvailable: row.sponsorship_available,
    workAuthorizationCountryCodes: row.work_authorization_country_codes,
    educationRequirement: row.education_requirement, relocationRequired: row.relocation_required,
    nightShiftRequired: row.night_shift_required, heavyTravelRequired: row.heavy_travel_required,
    employmentBondRequired: row.employment_bond_required, ats: row.ats,
    applicationUrl: row.application_url, status: row.status,
    firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
    lastVerifiedAt: row.last_verified_at, postedAt: row.published_at, expiresAt: row.expires_at
  };
}

export class KyselyJobCatalogRepository implements JobCatalogRepository {
  constructor(private readonly database: Kysely<V2Database>) {}

  async listDiscoverable(input: Parameters<JobCatalogRepository["listDiscoverable"]>[0]): Promise<readonly CatalogJob[]> {
    const result = await sql<CatalogRow>`
      SELECT
        job.id AS job_id, job.material_version, company.id AS company_id,
        company.canonical_name AS company_name, company.normalized_name AS normalized_company_name,
        job.canonical_title AS title, job.description, job.role_family, job.seniority,
        job.location_text, job.country_codes, job.work_mode, job.remote_country_codes,
        job.employment_type, facet.min_experience_months, facet.max_experience_months,
        facet.min_compensation_minor, facet.max_compensation_minor, facet.currency_code,
        facet.compensation_period, facet.sponsorship_available,
        facet.work_authorization_country_codes, facet.education_requirement,
        facet.relocation_required, facet.night_shift_required, facet.heavy_travel_required,
        facet.employment_bond_required, job.ats, job.application_url, job.status,
        job.first_seen_at, job.last_seen_at, job.last_verified_at, job.published_at, job.expires_at
      FROM jobs job
      JOIN companies company ON company.id = job.company_id
      JOIN job_facets facet ON facet.job_id = job.id
      WHERE job.status IN ('ACTIVE', 'STALE')
        AND job.ats IS DISTINCT FROM 'AUDIT_FIXTURE'
        ${input.query ? sql`AND to_tsvector('english', job.canonical_title || ' ' || job.description) @@ plainto_tsquery('english', ${input.query})` : sql``}
        ${input.roleFamily ? sql`AND job.role_family = ${input.roleFamily}` : sql``}
        ${input.workMode ? sql`AND job.work_mode = ${input.workMode}` : sql``}
        ${input.countryCode ? sql`AND (${input.countryCode} = ANY(job.country_codes) OR ${input.countryCode} = ANY(job.remote_country_codes))` : sql``}
      ORDER BY coalesce(job.last_verified_at, job.last_seen_at) DESC, job.id
      LIMIT ${input.maximum}
    `.execute(this.database);
    return this.hydrate(result.rows);
  }

  async findById(jobId: string): Promise<CatalogJob | null> {
    const result = await sql<CatalogRow>`
      SELECT
        job.id AS job_id, job.material_version, company.id AS company_id,
        company.canonical_name AS company_name, company.normalized_name AS normalized_company_name,
        job.canonical_title AS title, job.description, job.role_family, job.seniority,
        job.location_text, job.country_codes, job.work_mode, job.remote_country_codes,
        job.employment_type, facet.min_experience_months, facet.max_experience_months,
        facet.min_compensation_minor, facet.max_compensation_minor, facet.currency_code,
        facet.compensation_period, facet.sponsorship_available,
        facet.work_authorization_country_codes, facet.education_requirement,
        facet.relocation_required, facet.night_shift_required, facet.heavy_travel_required,
        facet.employment_bond_required, job.ats, job.application_url, job.status,
        job.first_seen_at, job.last_seen_at, job.last_verified_at, job.published_at, job.expires_at
      FROM jobs job
      JOIN companies company ON company.id = job.company_id
      JOIN job_facets facet ON facet.job_id = job.id
      WHERE job.id = ${jobId}
        AND job.ats IS DISTINCT FROM 'AUDIT_FIXTURE'
    `.execute(this.database);
    return (await this.hydrate(result.rows))[0] ?? null;
  }

  private async hydrate(rows: readonly CatalogRow[]): Promise<readonly CatalogJob[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.job_id);
    const skills = await sql<SkillRow>`
      SELECT job_skill.job_id, skill.canonical_name, job_skill.requirement
      FROM job_skills job_skill
      JOIN skills skill ON skill.id = job_skill.skill_id
      WHERE job_skill.job_id = ANY(${ids}::uuid[])
      ORDER BY job_skill.job_id, job_skill.requirement, skill.canonical_name
    `.execute(this.database);
    const byJob = new Map<string, SkillRow[]>();
    for (const row of skills.rows) byJob.set(row.job_id, [...(byJob.get(row.job_id) ?? []), row]);
    return rows.map((row) => catalog(row, byJob.get(row.job_id) ?? []));
  }
}

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabase,
  KyselyJobIngestionRepository,
  KyselyJobLifecycleRepository
} from "@job-hunter-v2/database";
import {
  FileSystemJobRawEvidenceStore,
  JobIngestionService,
  JobLifecycleService,
  RawJobPostingSchema,
  inferExperienceMonths,
  normalizeRawJob,
  type EmploymentType,
  type RawJobPosting,
  type WorkMode
} from "@job-hunter-v2/job-intelligence";

const LIVE_SYNC_VERSION = "live-public-ats-v3";
const DEFAULT_LIMIT = 4;
const FETCH_TIMEOUT_MS = 20_000;
const ENABLED_SOURCES = ["greenhouse", "lever", "ashby", "smartrecruiters", "workday"] as const;
type SourceKey = (typeof ENABLED_SOURCES)[number];
type JsonRecord = Record<string, unknown>;

interface SourceBatch {
  key: SourceKey;
  label: string;
  sourceIdentifier: string;
  postings: RawJobPosting[];
  // These test feeds are deliberately capped, so a missing listing cannot safely imply closure.
  complete: false;
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function observationHour(now = new Date()): Date {
  const value = new Date(now);
  value.setUTCMinutes(0, 0, 0);
  return value;
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
    ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“"
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? match;
  });
}

function htmlToText(value: string): string {
  let decoded = value;
  // Greenhouse encodes its HTML; the other public ATS APIs generally return HTML directly.
  for (let index = 0; index < 2; index += 1) decoded = decodeHtmlEntities(decoded);
  return decoded
    .replace(/<\s*(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function bounded(value: string | null, maximum: number): string | null {
  return value ? value.trim().replace(/\s+/g, " ").slice(0, maximum) || null : null;
}

function parseDate(value: unknown): Date | null {
  const date = typeof value === "number" && Number.isFinite(value)
    ? new Date(value < 10_000_000_000 ? value * 1_000 : value)
    : new Date(asString(value) ?? "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function inferCountryCodes(location: string | null, explicit?: string | null): string[] {
  const code = explicit?.trim().toUpperCase();
  if (code && /^[A-Z]{2}$/.test(code)) return [code];
  if (!location) return [];
  if (/\b(india|bengaluru|bangalore|hyderabad|pune|chennai|gurugram|gurgaon|noida|mumbai|delhi)\b/i.test(location)) return ["IN"];
  return [];
}

function inferWorkMode(explicit: unknown, location: string | null, description: string): WorkMode | null {
  const value = `${asString(explicit) ?? ""} ${location ?? ""}`.toLowerCase();
  if (/remote|work from home/.test(value)) return "REMOTE";
  if (/hybrid/.test(value)) return "HYBRID";
  if (/on[ -]?site|in person|office based/.test(value)) return "ONSITE";
  const opening = description.slice(0, 4_000).toLowerCase();
  if (/\bfully remote\b|\b100% remote\b/.test(opening)) return "REMOTE";
  if (/\bhybrid (?:role|position|work|employee)/.test(opening)) return "HYBRID";
  return null;
}

function inferEmploymentType(value: unknown): EmploymentType | null {
  const text = (asString(value) ?? "").toLowerCase().replace(/[^a-z]+/g, " ");
  if (/intern/.test(text)) return "INTERNSHIP";
  if (/part time/.test(text)) return "PART_TIME";
  if (/contract|contractor|freelance/.test(text)) return "CONTRACT";
  if (/temporary|fixed term/.test(text)) return "TEMPORARY";
  if (/full time|permanent|employee/.test(text)) return "FULL_TIME";
  return null;
}

const SKILLS: readonly [string, RegExp][] = [
  ["JavaScript", /\bjavascript\b/i], ["TypeScript", /\btypescript\b/i],
  ["Node.js", /\bnode(?:\.js|js)?\b/i], ["React", /\breact(?:\.js|js)?\b/i],
  ["Angular", /\bangular\b/i], ["Vue", /\bvue(?:\.js|js)?\b/i],
  ["Java", /\bjava\b/i], ["Spring Boot", /\bspring boot\b/i],
  ["Python", /\bpython\b/i], ["Django", /\bdjango\b/i], ["FastAPI", /\bfastapi\b/i],
  ["Go", /\b(?:golang|go language)\b/i], ["C++", /\bc\+\+\b/i], ["C#", /\bc#\b/i],
  ["Kotlin", /\bkotlin\b/i], ["Swift", /\bswift\b/i], ["Android", /\bandroid\b/i],
  ["iOS", /\bios\b/i], ["SQL", /\bsql\b/i], ["PostgreSQL", /\bpostgres(?:ql)?\b/i],
  ["MySQL", /\bmysql\b/i], ["MongoDB", /\bmongodb\b/i], ["Redis", /\bredis\b/i],
  ["Kafka", /\bkafka\b/i], ["AWS", /\baws\b|amazon web services/i],
  ["Azure", /\bazure\b/i], ["GCP", /\bgcp\b|google cloud/i],
  ["Docker", /\bdocker\b/i], ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["Terraform", /\bterraform\b/i], ["GraphQL", /\bgraphql\b/i]
];

function extractSkills(title: string, description: string): string[] {
  const value = `${title}\n${description}`;
  return SKILLS.filter(([, expression]) => expression.test(value)).map(([skill]) => skill).slice(0, 30);
}

function isIndiaEngineering(title: string, location: string | null, context = ""): boolean {
  // Title is authoritative here. Department text alone produces false positives such as
  // "Business Development Representative" and non-technical roles inside a Tech org.
  const engineering = /\b(software (?:development )?engineer|engineer(?:ing)?|developer|backend|front[ -]?end|full[ -]?stack|mobile developer|android developer|ios developer|data scientist|machine learning (?:engineer|scientist)|ml engineer|ai engineer|devops|site reliability|sre|platform engineer|security engineer|quality (?:assurance|engineer)|sdet|cloud architect|technical architect|solutions? architect)\b/i;
  const india = /\b(india|bengaluru|bangalore|hyderabad|pune|chennai|gurugram|gurgaon|noida|mumbai|delhi)\b/i;
  return engineering.test(title) && india.test(location ?? context);
}

async function fetchJson(url: string, init: RequestInit = {}, attempt = 0): Promise<{ data: unknown; response: Response }> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      "user-agent": "JobHunterV2-LocalLiveSync/1.0",
      ...init.headers
    }
  });
  if ((response.status === 429 || response.status >= 500) && attempt === 0) {
    await new Promise((done) => setTimeout(done, 500));
    return fetchJson(url, init, 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${new URL(url).hostname}`);
  return { data: await response.json(), response };
}

function posting(input: Omit<RawJobPosting, "observedAt">, observedAt: Date): RawJobPosting {
  return RawJobPostingSchema.parse({ ...input, observedAt });
}

async function greenhouse(limit: number, observedAt: Date): Promise<SourceBatch> {
  const url = "https://boards-api.greenhouse.io/v1/boards/postman/jobs?content=true";
  const { data, response } = await fetchJson(url);
  const jobs = asArray(asRecord(data).jobs).map(asRecord).filter((job) => {
    const departments = asArray(job.departments).map((item) => asString(asRecord(item).name) ?? "").join(" ");
    return isIndiaEngineering(asString(job.title) ?? "", asString(asRecord(job.location).name), departments);
  }).slice(0, limit);
  return {
    key: "greenhouse", label: "Greenhouse · Postman", sourceIdentifier: "greenhouse:postman:india-engineering", complete: false,
    postings: jobs.map((job) => {
      const title = asString(job.title) ?? "Untitled engineering role";
      const location = bounded(asString(asRecord(job.location).name), 500);
      const description = htmlToText(asString(job.content) ?? "") || `${title} at Postman`;
      const experience = inferExperienceMonths(`${title}\n${description}`);
      const workMode = inferWorkMode(null, location, description);
      return posting({
        source: { type: "ATS_API", identifier: "greenhouse:postman:india-engineering", url,
          externalJobId: String(job.id), ingestionVersion: LIVE_SYNC_VERSION,
          etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") },
        rawContent: JSON.stringify(job),
        job: { title, companyName: asString(job.company_name) ?? "Postman", companyWebsiteDomain: "postman.com",
          description: description.slice(0, 200_000), locationText: location, countryCodes: inferCountryCodes(location), workMode,
          remoteCountryCodes: workMode === "REMOTE" ? ["IN"] : [], employmentType: "FULL_TIME",
          minExperienceMonths: experience.minimum, maxExperienceMonths: experience.maximum,
          requiredSkills: extractSkills(title, description), preferredSkills: [], minCompensationMinor: null,
          maxCompensationMinor: null, currencyCode: null, compensationPeriod: null, sponsorshipAvailable: null,
          workAuthorizationCountryCodes: [], educationRequirement: null, relocationRequired: null, nightShiftRequired: null,
          heavyTravelRequired: null, employmentBondRequired: null, ats: "GREENHOUSE",
          applicationUrl: asString(job.absolute_url) ?? url, postedAt: parseDate(job.first_published),
          expiresAt: parseDate(job.application_deadline), explicitlyClosed: false, explicitlyRemoved: false }
      }, observedAt);
    })
  };
}

async function lever(limit: number, observedAt: Date): Promise<SourceBatch> {
  const url = "https://api.lever.co/v0/postings/meesho?mode=json";
  const { data, response } = await fetchJson(url);
  const jobs = asArray(data).map(asRecord).filter((job) => {
    const categories = asRecord(job.categories);
    return isIndiaEngineering(asString(job.text) ?? "", asString(categories.location), `${asString(categories.team) ?? ""} ${asString(categories.department) ?? ""}`);
  }).slice(0, limit);
  return {
    key: "lever", label: "Lever · Meesho", sourceIdentifier: "lever:meesho:india-engineering", complete: false,
    postings: jobs.map((job) => {
      const categories = asRecord(job.categories);
      const title = asString(job.text) ?? "Untitled engineering role";
      const location = bounded(asString(categories.location), 500);
      const lists = asArray(job.lists).map((value) => {
        const list = asRecord(value);
        return `${asString(list.text) ?? ""}\n${htmlToText(asString(list.content) ?? "")}`;
      }).join("\n");
      const description = [asString(job.descriptionPlain), lists, asString(job.additionalPlain)].filter(Boolean).join("\n\n") || `${title} at Meesho`;
      const experience = inferExperienceMonths(`${title}\n${description}`);
      const workMode = inferWorkMode(job.workplaceType, location, description);
      return posting({
        source: { type: "ATS_API", identifier: "lever:meesho:india-engineering", url,
          externalJobId: asString(job.id), ingestionVersion: LIVE_SYNC_VERSION,
          etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") },
        rawContent: JSON.stringify(job),
        job: { title, companyName: "Meesho", companyWebsiteDomain: "meesho.io", description: description.slice(0, 200_000),
          locationText: location, countryCodes: inferCountryCodes(location, asString(job.country)), workMode,
          remoteCountryCodes: workMode === "REMOTE" ? ["IN"] : [], employmentType: inferEmploymentType(categories.commitment),
          minExperienceMonths: experience.minimum, maxExperienceMonths: experience.maximum,
          requiredSkills: extractSkills(title, description), preferredSkills: [], minCompensationMinor: null,
          maxCompensationMinor: null, currencyCode: null, compensationPeriod: null, sponsorshipAvailable: null,
          workAuthorizationCountryCodes: [], educationRequirement: null, relocationRequired: null, nightShiftRequired: null,
          heavyTravelRequired: null, employmentBondRequired: null, ats: "LEVER",
          applicationUrl: asString(job.applyUrl) ?? asString(job.hostedUrl) ?? url,
          postedAt: parseDate(job.createdAt),
          expiresAt: null, explicitlyClosed: false, explicitlyRemoved: false }
      }, observedAt);
    })
  };
}

async function ashby(limit: number, observedAt: Date): Promise<SourceBatch> {
  const url = "https://api.ashbyhq.com/posting-api/job-board/plane";
  const { data, response } = await fetchJson(url);
  const jobs = asArray(asRecord(data).jobs).map(asRecord).filter((job) =>
    job.isListed !== false && isIndiaEngineering(asString(job.title) ?? "", asString(job.location), `${asString(job.department) ?? ""} ${asString(job.team) ?? ""}`)
  ).slice(0, limit);
  return {
    key: "ashby", label: "Ashby · Plane", sourceIdentifier: "ashby:plane:india-engineering", complete: false,
    postings: jobs.map((job) => {
      const title = asString(job.title) ?? "Untitled engineering role";
      const location = bounded(asString(job.location), 500);
      const description = (asString(job.descriptionPlain) ?? htmlToText(asString(job.descriptionHtml) ?? "")) || `${title} at Plane`;
      const experience = inferExperienceMonths(`${title}\n${description}`);
      const country = asString(asRecord(asRecord(job.address).postalAddress).addressCountry);
      const workMode = inferWorkMode(job.workplaceType ?? (job.isRemote === true ? "remote" : null), location, description);
      return posting({
        source: { type: "ATS_API", identifier: "ashby:plane:india-engineering", url,
          externalJobId: asString(job.id), ingestionVersion: LIVE_SYNC_VERSION,
          etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") },
        rawContent: JSON.stringify(job),
        job: { title, companyName: "Plane", companyWebsiteDomain: "plane.so", description: description.slice(0, 200_000),
          locationText: location, countryCodes: inferCountryCodes(location, country?.toLowerCase() === "india" ? "IN" : null),
          workMode, remoteCountryCodes: workMode === "REMOTE" ? ["IN"] : [], employmentType: inferEmploymentType(job.employmentType),
          minExperienceMonths: experience.minimum, maxExperienceMonths: experience.maximum,
          requiredSkills: extractSkills(title, description), preferredSkills: [], minCompensationMinor: null,
          maxCompensationMinor: null, currencyCode: null, compensationPeriod: null, sponsorshipAvailable: null,
          workAuthorizationCountryCodes: [], educationRequirement: null, relocationRequired: null, nightShiftRequired: null,
          heavyTravelRequired: null, employmentBondRequired: null, ats: "ASHBY",
          applicationUrl: asString(job.applyUrl) ?? asString(job.jobUrl) ?? url, postedAt: parseDate(job.publishedAt),
          expiresAt: null, explicitlyClosed: false, explicitlyRemoved: job.isListed === false }
      }, observedAt);
    })
  };
}

async function smartRecruiters(limit: number, observedAt: Date): Promise<SourceBatch> {
  const company = "BoschGroup";
  const url = `https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=100&country=in`;
  const { data, response } = await fetchJson(url);
  const selected = asArray(asRecord(data).content).map(asRecord).filter((job) => {
    const location = asString(asRecord(job.location).fullLocation) ?? asString(asRecord(job.location).city);
    return isIndiaEngineering(asString(job.name) ?? "", location, `${asString(asRecord(job.function).label) ?? ""} ${asString(asRecord(job.department).label) ?? ""}`);
  }).slice(0, limit);
  const details = await Promise.all(selected.map(async (summary) => {
    const detailUrl = asString(summary.ref) ?? `https://api.smartrecruiters.com/v1/companies/${company}/postings/${String(summary.id)}`;
    return { summary, detail: asRecord((await fetchJson(detailUrl)).data) };
  }));
  return {
    key: "smartrecruiters", label: "SmartRecruiters · Bosch", sourceIdentifier: "smartrecruiters:bosch:india-engineering", complete: false,
    postings: details.map(({ summary, detail }) => {
      const locationRecord = asRecord(detail.location ?? summary.location);
      const location = bounded(asString(locationRecord.fullLocation) ?? [asString(locationRecord.city), asString(locationRecord.region), "India"].filter(Boolean).join(", "), 500);
      const sections = asRecord(asRecord(detail.jobAd).sections);
      const description = Object.values(sections).map((value) => {
        const section = asRecord(value);
        return `${asString(section.title) ?? ""}\n${htmlToText(asString(section.text) ?? "")}`;
      }).join("\n\n") || `${asString(detail.name ?? summary.name) ?? "Engineering role"} at Bosch`;
      const title = asString(detail.name ?? summary.name) ?? "Untitled engineering role";
      const experience = inferExperienceMonths(`${title}\n${description}`);
      const workMode: WorkMode = locationRecord.remote === true ? "REMOTE" : locationRecord.hybrid === true ? "HYBRID" : "ONSITE";
      return posting({
        source: { type: "ATS_API", identifier: "smartrecruiters:bosch:india-engineering", url,
          externalJobId: asString(detail.id ?? summary.id), ingestionVersion: LIVE_SYNC_VERSION,
          etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") },
        rawContent: JSON.stringify(detail),
        job: { title, companyName: asString(asRecord(detail.company ?? summary.company).name) ?? "Bosch Group",
          companyWebsiteDomain: "bosch.com", description: description.slice(0, 200_000), locationText: location,
          countryCodes: inferCountryCodes(location, asString(locationRecord.country)), workMode,
          remoteCountryCodes: workMode === "REMOTE" ? ["IN"] : [],
          employmentType: inferEmploymentType(asRecord(detail.typeOfEmployment ?? summary.typeOfEmployment).label),
          minExperienceMonths: experience.minimum, maxExperienceMonths: experience.maximum,
          requiredSkills: extractSkills(title, description), preferredSkills: [], minCompensationMinor: null,
          maxCompensationMinor: null, currencyCode: null, compensationPeriod: null, sponsorshipAvailable: null,
          workAuthorizationCountryCodes: [], educationRequirement: null, relocationRequired: null, nightShiftRequired: null,
          heavyTravelRequired: null, employmentBondRequired: null, ats: "SMARTRECRUITERS",
          applicationUrl: asString(detail.applyUrl) ?? `https://jobs.smartrecruiters.com/${company}/${String(detail.id ?? summary.id)}`,
          postedAt: parseDate(detail.releasedDate ?? summary.releasedDate), expiresAt: null,
          explicitlyClosed: detail.active === false, explicitlyRemoved: false }
      }, observedAt);
    })
  };
}

async function workday(limit: number, observedAt: Date): Promise<SourceBatch> {
  const host = "https://visa.wd5.myworkdayjobs.com";
  const url = `${host}/wday/cxs/visa/Visa/jobs`;
  const pageSize = 20;
  const maximumPages = Math.max(1, Math.ceil((limit * 4) / pageSize));
  const selected: JsonRecord[] = [];
  let response: Response | null = null;
  for (let page = 0; page < maximumPages && selected.length < limit; page += 1) {
    const result = await fetchJson(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: pageSize, offset: page * pageSize, searchText: "India software engineer" })
    });
    response = result.response;
    const postings = asArray(asRecord(result.data).jobPostings).map(asRecord);
    selected.push(...postings.filter((job) =>
      isIndiaEngineering(asString(job.title) ?? "", asString(job.locationsText))
    ));
    if (postings.length < pageSize) break;
  }
  const uniqueSelected = [...new Map(selected.map((job) => [asString(job.externalPath) ?? JSON.stringify(job), job])).values()].slice(0, limit);
  const details = await Promise.all(uniqueSelected.map(async (summary) => {
    const path = asString(summary.externalPath);
    if (!path) throw new Error("Workday returned a job without an externalPath.");
    return { summary, detail: asRecord((await fetchJson(`${host}/wday/cxs/visa/Visa${path}`)).data) };
  }));
  return {
    key: "workday", label: "Workday · Visa", sourceIdentifier: "workday:visa:india-software-engineering", complete: false,
    postings: details.map(({ summary, detail }) => {
      const info = asRecord(detail.jobPostingInfo);
      const country = asRecord(asRecord(info.jobRequisitionLocation).country ?? info.country);
      const title = asString(info.title ?? summary.title) ?? "Untitled engineering role";
      const location = bounded(asString(info.location) ?? asString(summary.locationsText), 500);
      const description = htmlToText(asString(info.jobDescription) ?? "") || `${title} at Visa`;
      const experience = inferExperienceMonths(`${title}\n${description}`);
      const workMode = inferWorkMode(info.remoteType, location, description);
      return posting({
        source: { type: "ATS_API", identifier: "workday:visa:india-software-engineering", url,
          externalJobId: asString(info.jobReqId) ?? asString(info.id), ingestionVersion: LIVE_SYNC_VERSION,
          etag: response?.headers.get("etag") ?? null, lastModified: response?.headers.get("last-modified") ?? null },
        rawContent: JSON.stringify(detail),
        job: { title, companyName: "Visa", companyWebsiteDomain: "visa.com", description: description.slice(0, 200_000),
          locationText: location, countryCodes: inferCountryCodes(location, asString(country.alpha2Code)), workMode,
          remoteCountryCodes: workMode === "REMOTE" ? ["IN"] : [], employmentType: inferEmploymentType(info.timeType),
          minExperienceMonths: experience.minimum, maxExperienceMonths: experience.maximum,
          requiredSkills: extractSkills(title, description), preferredSkills: [], minCompensationMinor: null,
          maxCompensationMinor: null, currencyCode: null, compensationPeriod: null, sponsorshipAvailable: null,
          workAuthorizationCountryCodes: [], educationRequirement: null, relocationRequired: null, nightShiftRequired: null,
          heavyTravelRequired: null, employmentBondRequired: null, ats: "WORKDAY",
          applicationUrl: asString(info.externalUrl) ?? `${host}${asString(summary.externalPath) ?? ""}`,
          postedAt: parseDate(info.startDate), expiresAt: parseDate(info.endDate),
          explicitlyClosed: info.canApply === false, explicitlyRemoved: info.posted === false }
      }, observedAt);
    })
  };
}

const LOADERS: Record<SourceKey, (limit: number, observedAt: Date) => Promise<SourceBatch>> = {
  greenhouse, lever, ashby, smartrecruiters: smartRecruiters, workday
};

function parseArguments(argv: string[]): { limit: number; sources: SourceKey[]; dryRun: boolean; sinceDays: number | null } {
  let limit = DEFAULT_LIMIT;
  let sources: SourceKey[] = [...ENABLED_SOURCES];
  let dryRun = false;
  let sinceDays: number | null = null;
  for (const argument of argv) {
    if (argument === "--dry-run") dryRun = true;
    else if (argument.startsWith("--limit=")) {
      limit = Number(argument.slice("--limit=".length));
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("--limit must be an integer from 1 to 20.");
    } else if (argument.startsWith("--since-days=")) {
      sinceDays = Number(argument.slice("--since-days=".length));
      if (!Number.isInteger(sinceDays) || sinceDays < 1 || sinceDays > 30) {
        throw new Error("--since-days must be an integer from 1 to 30.");
      }
    } else if (argument.startsWith("--sources=")) {
      const requested = argument.slice("--sources=".length).split(",").filter(Boolean);
      const unknown = requested.filter((source) => !ENABLED_SOURCES.includes(source as SourceKey));
      if (unknown.length) throw new Error(`Unknown sources: ${unknown.join(", ")}`);
      sources = requested as SourceKey[];
    } else if (argument === "--help") {
      process.stdout.write("Usage: npm run jobs:sync-live -- [--limit=4] [--since-days=5] [--sources=greenhouse,lever,ashby,smartrecruiters,workday] [--dry-run]\n");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!sources.length) throw new Error("At least one live source is required.");
  return { limit, sources: [...new Set(sources)], dryRun, sinceDays };
}

const options = parseArguments(process.argv.slice(2));
const observedAt = observationHour();
const postedAfter = options.sinceDays === null
  ? null
  : new Date(observedAt.getTime() - options.sinceDays * 86_400_000);
const connectionString = process.env.DATABASE_URL;
if (!options.dryRun && !connectionString) throw new Error("DATABASE_URL is required. Run npm run dev:setup first.");

const settled = await Promise.all(options.sources.map(async (source) => {
  try {
    const loaded = await LOADERS[source](options.limit, observedAt);
    const batch = postedAfter
      ? { ...loaded, postings: loaded.postings.filter((posting) =>
          posting.job.postedAt !== null && posting.job.postedAt >= postedAfter
        ) }
      : loaded;
    if (!batch.postings.length) throw new Error("No current India engineering jobs matched this source.");
    return { source, batch, error: null };
  } catch (error) {
    return { source, batch: null, error: error instanceof Error ? error.message : String(error) };
  }
}));

const successful = settled.filter((item) => item.batch !== null);
for (const item of settled) {
  if (item.error) process.stderr.write(`WARN ${item.source}: ${item.error}\n`);
  else process.stdout.write(`FETCH ${item.batch?.label}: ${item.batch?.postings.length ?? 0} live jobs${postedAfter ? ` posted since ${postedAfter.toISOString()}` : ""}\n`);
}
if (!successful.length) throw new Error("Every configured live source failed; nothing was synchronized.");

if (options.dryRun) {
  for (const item of successful) {
    if (!item.batch) continue;
    for (const job of item.batch.postings) process.stdout.write(`DRY ${job.job.ats} · ${job.job.companyName} · ${job.job.title} · ${job.job.locationText ?? "location unknown"}\n`);
  }
  process.exit(0);
}

const database = createDatabase({ connectionString: connectionString as string });
const evidenceRoot = resolve(process.env.JOB_RAW_EVIDENCE_ROOT ?? ".local-data/job-evidence");
const ingestion = new JobIngestionService(
  new KyselyJobIngestionRepository(database), undefined,
  new FileSystemJobRawEvidenceStore(evidenceRoot)
);
const lifecycle = new JobLifecycleService(new KyselyJobLifecycleRepository(database));
const summary = { created: 0, updated: 0, observed: 0, replayed: 0, failed: 0 };

try {
  for (const item of successful) {
    const batch = item.batch;
    if (!batch) continue;
    const observedIdentityKeys: string[] = [];
    for (const job of batch.postings) {
      const rawHash = sha256(job.rawContent);
      const identityHash = sha256(`${batch.sourceIdentifier}:${job.source.externalJobId ?? job.job.applicationUrl}`);
      const hour = observedAt.toISOString().replace(/[-:T]/g, "").slice(0, 10);
      try {
        const result = await ingestion.ingest({
          posting: job,
          idempotencyKey: `live.${LIVE_SYNC_VERSION}.${batch.key}.${hour}.${identityHash.slice(0, 16)}.${rawHash.slice(0, 16)}`
        });
        observedIdentityKeys.push(normalizeRawJob(job).sourceIdentityKey);
        if (result.idempotentReplay) summary.replayed += 1;
        else if (result.created) summary.created += 1;
        else if (result.changed) summary.updated += 1;
        else summary.observed += 1;
        process.stdout.write(`SYNC ${job.job.ats} · ${job.job.companyName} · ${job.job.title} · ${result.idempotentReplay ? "replay" : result.created ? "created" : result.changed ? "updated" : "observed"}\n`);
      } catch (error) {
        summary.failed += 1;
        process.stderr.write(`ERROR ${batch.label} · ${job.job.title}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    if (observedIdentityKeys.length) {
      const identityHash = sha256(observedIdentityKeys.slice().sort().join(":"));
      const hour = observedAt.toISOString().replace(/[-:T]/g, "").slice(0, 10);
      await lifecycle.recordSourceScan({
        sourceType: "ATS_API", sourceIdentifier: batch.sourceIdentifier,
        observedSourceIdentityKeys: observedIdentityKeys, complete: batch.complete,
        idempotencyKey: `live.scan.${LIVE_SYNC_VERSION}.${batch.key}.${hour}.${identityHash.slice(0, 24)}`,
        observedAt
      });
    }
  }
} finally {
  await database.destroy();
}

process.stdout.write(`DONE created=${summary.created} updated=${summary.updated} observed=${summary.observed} replayed=${summary.replayed} failed=${summary.failed}\n`);
if (summary.failed > 0) process.exitCode = 1;

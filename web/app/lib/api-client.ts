import type { AttentionGap, CandidateSearchProfile, ProductApplication, ProductJob, ProductState, Readiness } from "./product-types";
import { initialProductState } from "./local-product";

const API_BASE = (process.env.NEXT_PUBLIC_JOB_HUNTER_API_URL || "").replace(/\/$/, "");

export class ApiRequestError extends Error {
  readonly status: number;
  readonly data: Record<string, unknown>;

  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.data = data;
  }
}

export function apiConfigured() {
  return Boolean(API_BASE);
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE) throw new Error("Local backend is not configured.");
  const response = await fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: init.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init.headers },
  });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = asRecord(data);
    throw new ApiRequestError(String(details.error || `Request failed (${response.status}).`), response.status, details);
  }
  return data as T;
}

type ApiRecord = Record<string, unknown>;

function asRecord(value: unknown): ApiRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ApiRecord : {};
}

function readinessFromApi(value: unknown, fallback: Readiness): Readiness {
  const raw = asRecord(value);
  const missing = Array.isArray(raw.missing) ? raw.missing.map((item) => {
    const field = asRecord(item);
    return { key: String(field.key || ""), label: String(field.label || field.key || "Unknown field") };
  }) : [];
  return {
    credible: Boolean(raw.credible),
    label: String(raw.label || fallback.label),
    percent: raw.percent == null ? null : Number(raw.percent),
    knownFieldCount: Number(raw.knownFieldCount || 0),
    requiredFieldCount: raw.requiredFieldCount == null ? null : Number(raw.requiredFieldCount),
    missing,
  };
}

function searchProfileFromApi(value: unknown, fallback: CandidateSearchProfile): CandidateSearchProfile {
  const raw = asRecord(value);
  const list = (item: unknown) => Array.isArray(item) ? item.map(String) : [];
  const mode = (item: unknown) => item === "HARD" ? "HARD" as const : "SOFT" as const;
  const tolerance = asRecord(raw.experienceTolerance);
  return {
    schemaVersion: Number(raw.schemaVersion || fallback.schemaVersion),
    profileVersion: Number(raw.profileVersion || fallback.profileVersion),
    targetRoles: list(raw.targetRoles),
    careerFamilies: list(raw.careerFamilies),
    primaryCoreStacks: list(raw.primaryCoreStacks),
    acceptableCoreStacks: list(raw.acceptableCoreStacks),
    adjacentCareerTracks: list(raw.adjacentCareerTracks),
    desiredSeniorityLevels: list(raw.desiredSeniorityLevels),
    preferredSkills: list(raw.preferredSkills),
    excludedSkills: list(raw.excludedSkills),
    preferredLocations: list(raw.preferredLocations),
    preferredWorkModes: list(raw.preferredWorkModes) as CandidateSearchProfile["preferredWorkModes"],
    employmentTypes: (list(raw.employmentTypes).length ? list(raw.employmentTypes) : fallback.employmentTypes) as CandidateSearchProfile["employmentTypes"],
    minimumSalary: raw.minimumSalary == null ? null : Number(raw.minimumSalary),
    compensationConstraintMode: mode(raw.compensationConstraintMode),
    locationConstraintMode: mode(raw.locationConstraintMode),
    workModeConstraintMode: mode(raw.workModeConstraintMode),
    employmentTypeConstraintMode: mode(raw.employmentTypeConstraintMode),
    experienceTolerance: {
      smallGapYears: Number(tolerance.smallGapYears ?? fallback.experienceTolerance.smallGapYears),
      maxPlausibleGapYears: Number(tolerance.maxPlausibleGapYears ?? fallback.experienceTolerance.maxPlausibleGapYears),
      allowNearbySeniority: tolerance.allowNearbySeniority === undefined
        ? fallback.experienceTolerance.allowNearbySeniority : Boolean(tolerance.allowNearbySeniority),
    },
    excludedCompanies: list(raw.excludedCompanies),
    dealBreakers: list(raw.dealBreakers),
    countryCode: String(raw.countryCode || "IN"),
    workAuthorization: (["AUTHORIZED_IN_MARKET", "NOT_AUTHORIZED"].includes(String(raw.workAuthorization))
      ? raw.workAuthorization : "UNKNOWN") as CandidateSearchProfile["workAuthorization"],
    sponsorshipNeed: (["REQUIRED", "NOT_REQUIRED"].includes(String(raw.sponsorshipNeed))
      ? raw.sponsorshipNeed : "UNKNOWN") as CandidateSearchProfile["sponsorshipNeed"],
    relocationPreference: (["WILLING", "NOT_WILLING"].includes(String(raw.relocationPreference))
      ? raw.relocationPreference : "UNKNOWN") as CandidateSearchProfile["relocationPreference"],
  };
}

function profileFromApi(raw: Record<string, unknown>, search: CandidateSearchProfile): ProductState["profile"] {
  const list = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
  const workModeLabel: Record<CandidateSearchProfile["preferredWorkModes"][number], string> = {
    REMOTE: "Remote", HYBRID: "Hybrid", OFFICE: "Office",
  };
  const employmentLabel: Record<CandidateSearchProfile["employmentTypes"][number], string> = {
    FULL_TIME: "Full-time", CONTRACT: "Contract", PART_TIME: "Part-time", INTERNSHIP: "Internship",
  };
  const workModeLabels = search.preferredWorkModes.map((value) => workModeLabel[value]);
  const employmentLabels = search.employmentTypes.map((value) => employmentLabel[value]);
  const dealBreakerLabels: Record<string, string> = {
    NIGHT_SHIFT: "No night shifts", MANDATORY_RELOCATION: "No mandatory relocation",
    EMPLOYMENT_BOND: "No employment bond", HEAVY_TRAVEL: "No heavy travel",
    SIX_DAY_WEEK: "No 6-day week", INTERNSHIP: "No internships", STAFFING_AGENCY: "No staffing agencies",
  };
  return {
    name: String(raw.name || ""),
    email: String(raw.email || ""),
    phone: String(raw.phone || ""),
    currentTitle: String(raw.currentTitle || ""),
    currentCompany: String(raw.currentCompany || ""),
    totalExperienceYears: raw.totalExperienceYears == null ? null : Number(raw.totalExperienceYears),
    targetRoles: search.targetRoles,
    preferredLocations: search.preferredLocations,
    preferredWorkModes: workModeLabels,
    employmentTypes: employmentLabels,
    minimumSalary: search.minimumSalary,
    skills: list(raw.skills),
    excludedSkills: search.excludedSkills,
    dealBreakers: search.dealBreakers.map((code) => dealBreakerLabels[code] || code),
    linkedinUrl: String(raw.linkedinUrl || ""),
    githubUrl: String(raw.githubUrl || ""),
    currentCTC: raw.currentCTC == null ? null : Number(raw.currentCTC),
    expectedCTC: raw.expectedCTC == null ? null : Number(raw.expectedCTC),
    noticePeriodDays: raw.noticePeriodDays == null ? null : Number(raw.noticePeriodDays),
    workAuthorization: search.workAuthorization,
    searchProfileVersion: search.profileVersion,
    primaryCoreStacks: search.primaryCoreStacks,
    acceptableCoreStacks: search.acceptableCoreStacks,
    adjacentCareerTracks: search.adjacentCareerTracks,
    desiredSeniorityLevels: search.desiredSeniorityLevels,
    preferredSkills: search.preferredSkills,
    excludedCompanies: search.excludedCompanies,
    compensationConstraintMode: search.compensationConstraintMode,
    locationConstraintMode: search.locationConstraintMode,
    workModeConstraintMode: search.workModeConstraintMode,
    employmentTypeConstraintMode: search.employmentTypeConstraintMode,
    experienceTolerance: search.experienceTolerance,
    searchCountryCode: search.countryCode,
    sponsorshipNeed: search.sponsorshipNeed,
    relocationPreference: search.relocationPreference,
  };
}

export function productStateFromBootstrap(payload: ApiRecord): ProductState {
  const fallback = initialProductState();
  const onboarding = asRecord(payload.onboarding);
  const stored = asRecord(onboarding.stored);
  const workspace = asRecord(payload.workspace);
  const attention = asRecord(workspace.attention);
  const activation = asRecord(onboarding.activation);
  const applicationReadiness = workspace.readiness ?? onboarding.applicationReadiness;
  const plan = asRecord(payload.plan);
  const trial = asRecord(plan.trial);
  const resume = asRecord(onboarding.resume);
  const searchReadiness = asRecord(onboarding.searchReadiness);
  const jobFeed = asRecord(workspace.jobFeed);
  const jobFeedPage = asRecord(jobFeed.page);
  const searchProfile = searchProfileFromApi(payload.searchProfile ?? onboarding.searchProfile, fallback.searchProfile);
  const steps = Array.isArray(onboarding.steps) ? onboarding.steps.map(asRecord) : [];
  const stepComplete = (id: string) => Boolean(steps.find((step) => step.id === id)?.complete);
  const nextStep = asRecord(onboarding.next);
  const confirmedResumeSelected = Boolean(resume.candidateConfirmed && stored.resumeProfileReviewed);
  const resumeSkipped = Boolean(stored.resumeSkipped && !confirmedResumeSelected);
  return {
    ...fallback,
    runtime: { mode: "api", connection: "CONNECTED", message: "Local API connected · SQLite data on this machine" },
    profile: profileFromApi(asRecord(payload.profile ?? onboarding.profile), searchProfile),
    searchProfile,
    onboarding: {
      status: String(onboarding.status || "NOT_STARTED"),
      lastStep: Boolean(onboarding.complete)
        ? "value"
        : String(nextStep.id || (Boolean(searchReadiness.ready) ? "search" : onboarding.lastStep) || "intent"),
      complete: Boolean(onboarding.complete),
      intentReviewed: stepComplete("intent"),
      resumeReviewed: stepComplete("verify"),
      searchReviewed: stepComplete("search"),
      valueShown: Boolean(activation.valueShown),
      resumeSkipped,
      searchReadiness: Number(searchReadiness.percent || 0),
    },
    resume: resumeSkipped ? {
      id: "skipped",
      fileName: "No resume yet",
      pageCount: null,
      parseConfidence: null,
      status: "SKIPPED",
      uploadedAt: String(stored.updatedAt || new Date().toISOString()),
    } : Object.keys(resume).length ? {
      id: String(resume.id),
      fileName: "Master resume.pdf",
      pageCount: null,
      parseConfidence: Number(resume.parseConfidence || 0),
      status: resume.candidateConfirmed ? "CONFIRMED" : "REVIEW",
      uploadedAt: String(resume.createdAt || new Date().toISOString()),
    } : null,
    jobs: Array.isArray(workspace.jobs) ? workspace.jobs as ProductJob[] : [],
    savedJobs: Array.isArray(workspace.savedJobs) ? workspace.savedJobs as ProductJob[] : [],
    jobFeed: {
      status: (["READY", "STALE", "BUILDING", "FAILED"].includes(String(jobFeed.status))
        ? jobFeed.status : "MISSING") as ProductState["jobFeed"]["status"],
      stale: jobFeed.stale === undefined ? true : Boolean(jobFeed.stale),
      staleReasons: Array.isArray(jobFeed.staleReasons) ? jobFeed.staleReasons.map(String) : [],
      generationId: jobFeed.generationId ? String(jobFeed.generationId) : null,
      builtAt: jobFeed.builtAt ? String(jobFeed.builtAt) : null,
      durationMs: jobFeed.durationMs == null ? null : Number(jobFeed.durationMs),
      total: Number(jobFeedPage.total ?? jobFeed.feedCount ?? 0),
      nextCursor: jobFeedPage.nextCursor ? String(jobFeedPage.nextCursor) : null,
      hasMore: Boolean(jobFeedPage.hasMore),
    },
    applications: Array.isArray(workspace.applications) ? workspace.applications as ProductApplication[] : [],
    attention: {
      blockers: Array.isArray(attention.blockers) ? attention.blockers as ProductState["attention"]["blockers"] : [],
      gaps: Array.isArray(attention.gaps) ? attention.gaps as AttentionGap[] : [],
    },
    readiness: readinessFromApi(applicationReadiness, fallback.readiness),
    plan: {
      id: plan.id === "PRO" ? "PRO" : "FREE",
      trialStatus: trial.status === "ACTIVE" || trial.status === "EXPIRED" ? trial.status : "AVAILABLE",
      trialDays: Number(trial.days || 7),
    },
  };
}

export async function loadApiProductState() {
  return productStateFromBootstrap(await apiRequest<ApiRecord>("/bootstrap"));
}

export type FitLabel = "STRONG_FIT" | "POSSIBLE_FIT" | "REVIEW_CAREFULLY";

export type ProductJob = {
  id: string;
  company: string;
  logo: string;
  role: string;
  location: string;
  salary: string;
  matchScore: number | null;
  fit: FitLabel;
  fitReasons: string[];
  gaps: string[];
  unknowns: string[];
  skills: string[];
  source: string;
  support: { mode: string; label: string; reason: string } | null;
  fresh: string;
  postedAt?: string;
  url: string;
  status: string;
  saved?: boolean;
  dismissed?: boolean;
  personalState?: {
    seen: boolean;
    saved: boolean;
    dismissed: boolean;
    hasMaterialUpdate: boolean;
    currentMatchVersion: number;
    seenMatchVersion: number | null;
    savedMatchVersion: number | null;
    dismissedMatchVersion: number | null;
    seenAt: string | null;
    savedAt: string | null;
    dismissedAt: string | null;
  };
  actionability: {
    status: "OPEN" | "AGED_OUT" | "EXPIRED" | "CLOSED";
    canApply: boolean;
    discoveryEligible: boolean;
    reason: string | null;
  };
  applicationSchema: {
    available: boolean;
    freshness: "FRESH" | "RECENT" | null;
    observedAt: string | null;
    fieldCount: number;
    requiredFieldCount: number;
  };
  availability: JobAvailability;
  whyThisJob: {
    scoringMethod: string;
    evidenceCoverage: number;
    hardRequirementsFirst: boolean;
    eligibility?: "ELIGIBLE" | "INELIGIBLE";
    versions?: { profileVersion: number; jobMatchVersion: number; algorithmVersion: string } | null;
    dimensions?: Array<{ name: string; score: number; status: string; codes: string[] }>;
    evidence?: {
      reasons: MatchEvidenceSignal[];
      gaps: MatchEvidenceSignal[];
      unknowns: MatchEvidenceSignal[];
    };
  };
};

export type MatchEvidenceSignal = {
  code: string;
  dimension: string;
  label: string;
  evidence: { candidate: unknown; job: unknown };
};

export type JobAvailability = {
  status: "ACTIVE" | "EXPIRY_SCHEDULED" | "SUSPECTED_CLOSED" | "CLOSED" | "UNKNOWN" | "REOPENED";
  reason: string | null;
  confidence: number;
  explicitDeadline: string | null;
  lastVerifiedAt: string | null;
  closedAt: string | null;
  verificationRecommended: boolean;
};

export type AvailabilityPrompt = {
  requestId: string;
  jobId: string;
  question: string;
  options: Array<"OPEN" | "CLOSED" | "UNCERTAIN">;
  expiresAt: string;
};

export type ProductApplication = {
  id: string;
  jobId: string;
  company: string;
  role: string;
  url?: string | null;
  stage: string;
  status: string;
  matchScore?: number | null;
  pendingQuestions: number;
  startedAt?: string | null;
  submittedAt?: string | null;
  updatedAt?: string | null;
  nextAction: string;
  actionability?: ProductJob["actionability"];
};

export type CandidateProfile = {
  name: string;
  email: string;
  phone: string;
  currentTitle: string;
  currentCompany: string;
  totalExperienceYears: number | null;
  targetRoles: string[];
  preferredLocations: string[];
  preferredWorkModes: string[];
  employmentTypes: string[];
  minimumSalary: number | null;
  skills: string[];
  excludedSkills: string[];
  dealBreakers: string[];
  linkedinUrl: string;
  githubUrl: string;
  currentCTC?: number | null;
  expectedCTC?: number | null;
  noticePeriodDays?: number | null;
  workAuthorization?: string;
  searchProfileVersion: number;
  primaryCoreStacks: string[];
  acceptableCoreStacks: string[];
  adjacentCareerTracks: string[];
  desiredSeniorityLevels: string[];
  preferredSkills: string[];
  excludedCompanies: string[];
  compensationConstraintMode: "SOFT" | "HARD";
  locationConstraintMode: "SOFT" | "HARD";
  workModeConstraintMode: "SOFT" | "HARD";
  employmentTypeConstraintMode: "SOFT" | "HARD";
  experienceTolerance: { smallGapYears: number; maxPlausibleGapYears: number; allowNearbySeniority: boolean };
  searchCountryCode: string;
  sponsorshipNeed: "UNKNOWN" | "REQUIRED" | "NOT_REQUIRED";
  relocationPreference: "UNKNOWN" | "WILLING" | "NOT_WILLING";
};

export type CandidateSearchProfile = {
  schemaVersion: number;
  profileVersion: number;
  targetRoles: string[];
  careerFamilies: string[];
  primaryCoreStacks: string[];
  acceptableCoreStacks: string[];
  adjacentCareerTracks: string[];
  desiredSeniorityLevels: string[];
  preferredSkills: string[];
  excludedSkills: string[];
  preferredLocations: string[];
  preferredWorkModes: Array<"REMOTE" | "HYBRID" | "OFFICE">;
  employmentTypes: Array<"FULL_TIME" | "CONTRACT" | "PART_TIME" | "INTERNSHIP">;
  minimumSalary: number | null;
  compensationConstraintMode: "SOFT" | "HARD";
  locationConstraintMode: "SOFT" | "HARD";
  workModeConstraintMode: "SOFT" | "HARD";
  employmentTypeConstraintMode: "SOFT" | "HARD";
  experienceTolerance: { smallGapYears: number; maxPlausibleGapYears: number; allowNearbySeniority: boolean };
  excludedCompanies: string[];
  dealBreakers: string[];
  countryCode: string;
  workAuthorization: "UNKNOWN" | "AUTHORIZED_IN_MARKET" | "NOT_AUTHORIZED";
  sponsorshipNeed: "UNKNOWN" | "REQUIRED" | "NOT_REQUIRED";
  relocationPreference: "UNKNOWN" | "WILLING" | "NOT_WILLING";
};

export type ResumeState = {
  id: string;
  fileName: string;
  pageCount: number | null;
  parseConfidence: number | null;
  status: "UPLOADED" | "PARSING" | "REVIEW" | "CONFIRMED" | "FAILED" | "SKIPPED";
  uploadedAt: string;
  warning?: string;
};

export type AttentionGap = {
  id: string;
  canonicalFieldKey: string;
  label: string;
  affectedJobCount: number;
  affectedJobs: Array<{ id: string; company: string; role: string }>;
  impactScore: number;
  status: string;
  freshness?: "FRESH" | "RECENT";
};

export type AttentionBlocker = {
  id: string;
  applicationId: string;
  company: string;
  role: string;
  title: string;
  reason: string;
  semanticKey?: string | null;
  type?: string;
  priority?: number;
  blocking?: boolean;
};

export type Readiness = {
  credible: boolean;
  label: string;
  percent: number | null;
  knownFieldCount: number;
  requiredFieldCount: number | null;
  missing: Array<{ key: string; label: string }>;
};

export type OnboardingState = {
  status: string;
  lastStep: string;
  complete: boolean;
  intentReviewed: boolean;
  resumeReviewed: boolean;
  searchReviewed: boolean;
  valueShown: boolean;
  resumeSkipped: boolean;
  searchReadiness: number;
};

export type CandidateJobFeedState = {
  status: "MISSING" | "READY" | "STALE" | "BUILDING" | "FAILED";
  stale: boolean;
  staleReasons: string[];
  generationId: string | null;
  builtAt: string | null;
  durationMs: number | null;
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
};

export type ProductState = {
  version: number;
  runtime: {
    mode: "local" | "api";
    connection: "CONNECTING" | "CONNECTED" | "LOCAL_FALLBACK" | "ERROR";
    message: string;
  };
  profile: CandidateProfile;
  searchProfile: CandidateSearchProfile;
  onboarding: OnboardingState;
  resume: ResumeState | null;
  jobs: ProductJob[];
  savedJobs: ProductJob[];
  jobFeed: CandidateJobFeedState;
  applications: ProductApplication[];
  attention: { blockers: AttentionBlocker[]; gaps: AttentionGap[] };
  readiness: Readiness;
  plan: { id: "FREE" | "PRO"; trialStatus: "AVAILABLE" | "ACTIVE" | "EXPIRED"; trialDays: number };
};

export type IntentInput = Pick<CandidateProfile, "currentTitle" | "currentCompany" | "totalExperienceYears" | "targetRoles">;
export type SearchInput = Pick<CandidateProfile, "preferredLocations" | "preferredWorkModes" | "employmentTypes" | "minimumSalary" | "excludedSkills" | "dealBreakers"> & { excludedCompanies: string[] };
export type VerifiedProfileInput = Pick<CandidateProfile, "name" | "email" | "phone" | "currentTitle" | "currentCompany" | "totalExperienceYears" | "skills" | "linkedinUrl" | "githubUrl">;

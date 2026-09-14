import type { PersistableNormalizedValue } from "@job-hunter-v2/candidate-truth";
import {
  CandidateSearchPreferencesSchema,
  type CandidateJobFacts,
  type CandidateJobProfile,
  type CatalogJob,
  type RoleFamily,
  type SeniorityLevel
} from "./contracts.js";
import { inferRoleFamily, normalizeSkill, normalizedText } from "./normalization.js";

export type EligibilityState = "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";
export type MatchDimensionKey = "ROLE" | "SKILLS" | "EXPERIENCE" | "SENIORITY" | "LOCATION" | "WORK_MODE" | "COMPENSATION" | "PREFERENCES";

export interface EvaluationReason {
  code: string;
  message: string;
  evidence: readonly string[];
}

export interface EligibilityResult {
  state: EligibilityState;
  reasons: readonly EvaluationReason[];
  unknowns: readonly EvaluationReason[];
}

export interface MatchDimension {
  key: MatchDimensionKey;
  score: number | null;
  weight: number;
  reasons: readonly EvaluationReason[];
  gaps: readonly EvaluationReason[];
  unknowns: readonly EvaluationReason[];
}

export interface RankedJobEvaluation {
  policyVersion: typeof JOB_RANKING_POLICY_VERSION;
  eligibility: EligibilityResult;
  dimensions: readonly MatchDimension[];
  matchScore: number | null;
  rankScore: number | null;
  label: "STRONG_MATCH" | "GOOD_MATCH" | "POSSIBLE_MATCH" | "LOW_MATCH" | "HIDDEN";
  reasons: readonly EvaluationReason[];
  gaps: readonly EvaluationReason[];
  unknowns: readonly EvaluationReason[];
}

export interface CandidateTruthFactView {
  canonicalKey: string;
  normalizedValue: PersistableNormalizedValue;
  scope: { countryCode?: string | null | undefined };
  trustState: "REVIEW" | "TRUSTED" | "REMOVED";
}

const emptyFacts = (): CandidateJobFacts => ({
  currentRoleFamily: null,
  skills: [],
  totalExperienceMonths: null,
  authorizedCountryCodes: [],
  sponsorshipRequiredCountryCodes: [],
  currentCountryCode: null,
  expectedCompensationMinor: null,
  expectedCompensationCurrencyCode: null,
  relocationWilling: null
});

function decimalToMinor(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

export function candidateJobFactsFromTruth(answers: readonly CandidateTruthFactView[]): CandidateJobFacts {
  const facts = emptyFacts();
  for (const answer of answers) {
    if (answer.trustState === "REMOVED") continue;
    const value = answer.normalizedValue;
    if (answer.canonicalKey === "CURRENT_JOB_TITLE" && value.kind === "STRING") facts.currentRoleFamily = inferRoleFamily(value.value);
    if (answer.canonicalKey === "SKILLS" && value.kind === "MULTI_ENUM") facts.skills = value.values.map((skill) => normalizeSkill(skill.label).key);
    if (answer.canonicalKey === "TOTAL_EXPERIENCE" && value.kind === "DURATION") facts.totalExperienceMonths = value.months;
    if (answer.canonicalKey === "WORK_AUTHORIZATION" && value.kind === "BOOLEAN" && value.value && answer.scope.countryCode) {
      facts.authorizedCountryCodes = [...new Set([...facts.authorizedCountryCodes, answer.scope.countryCode])];
    }
    if (answer.canonicalKey === "SPONSORSHIP_REQUIRED" && value.kind === "BOOLEAN" && value.value && answer.scope.countryCode) {
      facts.sponsorshipRequiredCountryCodes = [...new Set([...facts.sponsorshipRequiredCountryCodes, answer.scope.countryCode])];
    }
    if (answer.canonicalKey === "CURRENT_ADDRESS" && value.kind === "ADDRESS") facts.currentCountryCode = value.countryCode;
    if (answer.canonicalKey === "EXPECTED_CTC" && value.kind === "MONEY" && value.period === "YEAR") {
      facts.expectedCompensationMinor = decimalToMinor(value.amountExact);
      facts.expectedCompensationCurrencyCode = value.currency;
    }
    if (answer.canonicalKey === "RELOCATION" && value.kind === "BOOLEAN") facts.relocationWilling = value.value;
  }
  return facts;
}

function reason(code: string, message: string, evidence: readonly string[]): EvaluationReason {
  return { code, message, evidence };
}

function candidateCountries(profile: CandidateJobProfile): string[] {
  return [...new Set([
    ...profile.preferences.preferredCountryCodes,
    ...(profile.facts.currentCountryCode ? [profile.facts.currentCountryCode] : []),
    ...profile.facts.authorizedCountryCodes
  ])];
}

export function evaluateHardEligibility(job: CatalogJob, profile: CandidateJobProfile): EligibilityResult {
  const rejected: EvaluationReason[] = [];
  const unknowns: EvaluationReason[] = [];
  const preferences = CandidateSearchPreferencesSchema.parse(profile.preferences);
  const excluded = new Set(preferences.excludedCompanyNames.map(normalizedText));
  if (excluded.has(job.normalizedCompanyName) || excluded.has(normalizedText(job.companyName))) {
    rejected.push(reason("EXCLUDED_COMPANY", "You excluded this company.", [job.companyName]));
  }
  if (job.relocationRequired === true && (preferences.dealBreakers.mandatoryRelocation || profile.facts.relocationWilling === false)) {
    rejected.push(reason("MANDATORY_RELOCATION", "This role requires relocation, which conflicts with your preference.", ["relocation required"]));
  }
  if (job.nightShiftRequired === true && preferences.dealBreakers.nightShift) {
    rejected.push(reason("NIGHT_SHIFT_REQUIRED", "This role explicitly requires night-shift work.", ["night shift required"]));
  }
  if (job.heavyTravelRequired === true && preferences.dealBreakers.heavyTravel) {
    rejected.push(reason("HEAVY_TRAVEL_REQUIRED", "This role explicitly requires heavy travel.", ["heavy travel required"]));
  }
  if (job.employmentBondRequired === true && preferences.dealBreakers.employmentBond) {
    rejected.push(reason("EMPLOYMENT_BOND_REQUIRED", "This role explicitly includes an employment bond.", ["employment bond required"]));
  }

  const countries = candidateCountries(profile);
  if (job.workMode === "REMOTE" && job.remoteCountryCodes.length > 0) {
    if (countries.length === 0) {
      unknowns.push(reason("CANDIDATE_REMOTE_GEOGRAPHY_UNKNOWN", "Your location is needed to verify this remote restriction.", job.remoteCountryCodes));
    } else if (!countries.some((country) => job.remoteCountryCodes.includes(country))) {
      rejected.push(reason("REMOTE_GEOGRAPHY_INCOMPATIBLE", "This remote role is not available in your geography.", job.remoteCountryCodes));
    }
  }

  const authorizationCountries = job.workAuthorizationCountryCodes.length > 0
    ? job.workAuthorizationCountryCodes : job.countryCodes;
  for (const country of authorizationCountries) {
    if (profile.facts.authorizedCountryCodes.includes(country)) continue;
    if (profile.facts.sponsorshipRequiredCountryCodes.includes(country)) {
      if (job.sponsorshipAvailable === false) {
        rejected.push(reason("SPONSORSHIP_UNAVAILABLE", "This role explicitly does not offer required sponsorship.", [country]));
      } else if (job.sponsorshipAvailable === null) {
        unknowns.push(reason("SPONSORSHIP_NOT_SPECIFIED", "The posting does not specify sponsorship availability.", [country]));
      }
    } else if (job.workAuthorizationCountryCodes.length > 0) {
      unknowns.push(reason("WORK_AUTHORIZATION_UNKNOWN", "Your work authorization is not confirmed for this role.", [country]));
    }
  }
  return {
    state: rejected.length > 0 ? "INELIGIBLE" : unknowns.length > 0 ? "UNKNOWN" : "ELIGIBLE",
    reasons: rejected,
    unknowns
  };
}

const dimensionWeights: Readonly<Record<MatchDimensionKey, number>> = {
  ROLE: 25, SKILLS: 25, EXPERIENCE: 15, SENIORITY: 10,
  LOCATION: 10, WORK_MODE: 5, COMPENSATION: 5, PREFERENCES: 5
};

const roleAdjacency: Readonly<Record<RoleFamily, readonly RoleFamily[]>> = {
  BACKEND: ["FULLSTACK", "DEVOPS"], FRONTEND: ["FULLSTACK", "MOBILE"], FULLSTACK: ["BACKEND", "FRONTEND"],
  MOBILE: ["FRONTEND", "FULLSTACK"], DEVOPS: ["BACKEND", "SECURITY"], DATA: ["ML_AI", "BACKEND"],
  ML_AI: ["DATA", "BACKEND"], QA: ["BACKEND", "FRONTEND"], SECURITY: ["DEVOPS", "BACKEND"],
  EMBEDDED: ["BACKEND", "MOBILE"], PRODUCT: ["DESIGN"], DESIGN: ["PRODUCT", "FRONTEND"],
  ENGINEERING_MANAGEMENT: ["BACKEND", "FRONTEND", "FULLSTACK", "DEVOPS", "DATA", "ML_AI", "MOBILE", "QA", "SECURITY", "EMBEDDED"],
  OTHER: []
};

const seniorityIndex: Readonly<Record<SeniorityLevel, number | null>> = {
  INTERN: 0, ENTRY: 1, MID: 2, SENIOR: 3, LEAD: 4, STAFF: 5, PRINCIPAL: 6,
  MANAGER: 5, DIRECTOR: 7, UNKNOWN: null
};

function dimension(key: MatchDimensionKey, score: number | null, reasons: EvaluationReason[] = [], gaps: EvaluationReason[] = [], unknowns: EvaluationReason[] = []): MatchDimension {
  return { key, score, weight: dimensionWeights[key], reasons, gaps, unknowns };
}

function roleDimension(job: CatalogJob, profile: CandidateJobProfile): MatchDimension {
  const targets = profile.preferences.targetRoleFamilies.length > 0
    ? profile.preferences.targetRoleFamilies
    : profile.facts.currentRoleFamily ? [profile.facts.currentRoleFamily] : [];
  const acceptable = new Set([...targets, ...profile.preferences.acceptableRoleFamilies]);
  if (targets.includes(job.roleFamily)) return dimension("ROLE", 100, [reason("TARGET_ROLE_MATCH", "The role matches your target role family.", [job.roleFamily])]);
  if (acceptable.has(job.roleFamily)) return dimension("ROLE", 85, [reason("ACCEPTABLE_ROLE_MATCH", "The role is in your accepted role families.", [job.roleFamily])]);
  if (targets.some((target) => roleAdjacency[target].includes(job.roleFamily))) return dimension("ROLE", 65, [reason("ADJACENT_ROLE_MATCH", "The role is adjacent to your target.", [job.roleFamily])]);
  if (targets.length === 0) return dimension("ROLE", null, [], [], [reason("TARGET_ROLE_UNKNOWN", "Add target roles to improve role matching.", [])]);
  return dimension("ROLE", 20, [], [reason("ROLE_FAMILY_GAP", "This role is outside your target role families.", [job.roleFamily])]);
}

function skillDimension(job: CatalogJob, profile: CandidateJobProfile): MatchDimension {
  const candidate = new Set(profile.facts.skills.map((skill) => normalizeSkill(skill).key));
  const required = job.requiredSkills.map((skill) => skill.key);
  const preferred = job.preferredSkills.map((skill) => skill.key);
  if (required.length === 0 && preferred.length === 0) return dimension("SKILLS", null, [], [], [reason("JOB_SKILLS_UNKNOWN", "The posting does not list structured skills.", [])]);
  const requiredMatches = required.filter((skill) => candidate.has(skill));
  const requiredMissing = required.filter((skill) => !candidate.has(skill));
  const preferredMatches = preferred.filter((skill) => candidate.has(skill));
  const preferredMissing = preferred.filter((skill) => !candidate.has(skill));
  const requiredScore = required.length ? requiredMatches.length / required.length : 1;
  const preferredScore = preferred.length ? preferredMatches.length / preferred.length : 1;
  const score = Math.round(100 * (requiredScore * 0.85 + preferredScore * 0.15));
  return dimension(
    "SKILLS", score,
    requiredMatches.length ? [reason("REQUIRED_SKILLS_MATCH", `You match ${requiredMatches.length} required skill${requiredMatches.length === 1 ? "" : "s"}.`, requiredMatches)] : [],
    [
      ...(requiredMissing.length ? [reason("REQUIRED_SKILLS_GAP", "Some required skills are not confirmed in your profile.", requiredMissing)] : []),
      ...(preferredMissing.length ? [reason("PREFERRED_SKILLS_GAP", "Some preferred skills are not confirmed.", preferredMissing)] : [])
    ]
  );
}

function experienceDimension(job: CatalogJob, profile: CandidateJobProfile): MatchDimension {
  const months = profile.facts.totalExperienceMonths;
  if (months === null) return dimension("EXPERIENCE", null, [], [], [reason("CANDIDATE_EXPERIENCE_UNKNOWN", "Add total experience to improve matching.", [])]);
  if (job.minExperienceMonths === null && job.maxExperienceMonths === null) return dimension("EXPERIENCE", null, [], [], [reason("JOB_EXPERIENCE_UNKNOWN", "The posting does not specify an experience range.", [])]);
  const min = job.minExperienceMonths ?? 0;
  const max = job.maxExperienceMonths ?? Number.MAX_SAFE_INTEGER;
  if (months >= min && months <= max) return dimension("EXPERIENCE", 100, [reason("EXPERIENCE_IN_RANGE", "Your experience is within the requested range.", [`${months} months`])]);
  if (months < min) {
    const gap = min - months;
    return dimension("EXPERIENCE", gap <= 12 ? 70 : gap <= 24 ? 40 : 10, [], [reason("EXPERIENCE_BELOW_RANGE", "Your confirmed experience is below the requested minimum.", [`${gap} month gap`])]);
  }
  return dimension("EXPERIENCE", 80, [reason("EXPERIENCE_ABOVE_RANGE", "Your experience is above the requested range.", [`${months} months`])]);
}

function seniorityDimension(job: CatalogJob, profile: CandidateJobProfile): MatchDimension {
  const current = inferSeniorityFromMonths(profile.facts.totalExperienceMonths);
  const candidateLevel = seniorityIndex[current];
  const jobLevel = seniorityIndex[job.seniority];
  if (candidateLevel === null || jobLevel === null) return dimension("SENIORITY", null, [], [], [reason("SENIORITY_UNKNOWN", "Seniority could not be compared reliably.", [])]);
  const gap = jobLevel - candidateLevel;
  if (gap === 0) return dimension("SENIORITY", 100, [reason("SENIORITY_ALIGNED", "The seniority level aligns with your experience.", [job.seniority])]);
  if (gap < 0) return dimension("SENIORITY", Math.max(55, 90 + gap * 10), [reason("LOWER_SENIORITY", "This role is below your estimated level but remains eligible.", [job.seniority])]);
  return dimension("SENIORITY", gap === 1 ? 70 : gap === 2 ? 35 : 5, [], [reason(gap >= 3 ? "EXCESSIVE_SENIORITY_GAP" : "HIGHER_SENIORITY_GAP", "The role may be above your current experience level.", [job.seniority])]);
}

function inferSeniorityFromMonths(months: number | null): SeniorityLevel {
  if (months === null) return "UNKNOWN";
  if (months < 12) return "ENTRY";
  if (months < 48) return "MID";
  if (months < 84) return "SENIOR";
  if (months < 120) return "LEAD";
  return "STAFF";
}

function locationDimension(job: CatalogJob, profile: CandidateJobProfile): MatchDimension {
  const countries = candidateCountries(profile);
  if (job.countryCodes.length === 0 && job.remoteCountryCodes.length === 0) return dimension("LOCATION", null, [], [], [reason("JOB_LOCATION_UNKNOWN", "The posting does not specify a compatible geography.", [])]);
  if (countries.length === 0) return dimension("LOCATION", null, [], [], [reason("CANDIDATE_LOCATION_UNKNOWN", "Add preferred locations to improve matching.", [])]);
  const allowed = job.workMode === "REMOTE" && job.remoteCountryCodes.length ? job.remoteCountryCodes : job.countryCodes;
  const matches = countries.some((country) => allowed.includes(country));
  return matches
    ? dimension("LOCATION", 100, [reason("LOCATION_COMPATIBLE", "The job's geography is compatible with your profile.", allowed)])
    : dimension("LOCATION", 20, [], [reason("LOCATION_PREFERENCE_GAP", "The job is outside your preferred locations.", allowed)]);
}

function workModeDimension(job: CatalogJob, profile: CandidateJobProfile): MatchDimension {
  if (!job.workMode) return dimension("WORK_MODE", null, [], [], [reason("WORK_MODE_UNKNOWN", "The posting does not specify a work mode.", [])]);
  if (!profile.preferences.preferredWorkModes.length) return dimension("WORK_MODE", null, [], [], [reason("WORK_MODE_PREFERENCE_UNKNOWN", "Add a work-mode preference to improve matching.", [])]);
  return profile.preferences.preferredWorkModes.includes(job.workMode)
    ? dimension("WORK_MODE", 100, [reason("WORK_MODE_MATCH", `The role supports your ${job.workMode.toLowerCase()} preference.`, [job.workMode])])
    : dimension("WORK_MODE", 30, [], [reason("WORK_MODE_GAP", "The role's work mode differs from your preference.", [job.workMode])]);
}

function compensationDimension(job: CatalogJob, profile: CandidateJobProfile): MatchDimension {
  const minimum = profile.preferences.minimumCompensationMinor ?? profile.facts.expectedCompensationMinor;
  const currency = profile.preferences.compensationCurrencyCode ?? profile.facts.expectedCompensationCurrencyCode;
  if (minimum === null) return dimension("COMPENSATION", null, [], [], [reason("CANDIDATE_COMPENSATION_UNKNOWN", "Add a compensation preference to compare salary.", [])]);
  if (job.maxCompensationMinor === null || !job.currencyCode) return dimension("COMPENSATION", null, [], [], [reason("JOB_COMPENSATION_UNKNOWN", "The posting does not disclose compensation.", [])]);
  if (currency && job.currencyCode !== currency) return dimension("COMPENSATION", null, [], [], [reason("COMPENSATION_CURRENCY_MISMATCH", "Compensation uses a different currency and was not converted.", [job.currencyCode, currency])]);
  return job.maxCompensationMinor >= minimum
    ? dimension("COMPENSATION", 100, [reason("COMPENSATION_MEETS_MINIMUM", "The disclosed range meets your minimum.", [job.currencyCode])])
    : dimension("COMPENSATION", 20, [], [reason("COMPENSATION_BELOW_MINIMUM", "The disclosed range is below your minimum.", [job.currencyCode])]);
}

function preferenceDimension(job: CatalogJob, profile: CandidateJobProfile): MatchDimension {
  const reasons: EvaluationReason[] = [];
  const gaps: EvaluationReason[] = [];
  if (profile.preferences.acceptableRoleFamilies.includes(job.roleFamily)) reasons.push(reason("ACCEPTABLE_ROLE_PREFERENCE", "This role is in your broader accepted roles.", [job.roleFamily]));
  if (job.employmentType === "CONTRACT") gaps.push(reason("CONTRACT_ROLE", "This is a contract role.", ["CONTRACT"]));
  return dimension("PREFERENCES", reasons.length ? 100 : gaps.length ? 50 : null, reasons, gaps, gaps.length || reasons.length ? [] : [reason("PREFERENCES_NOT_APPLICABLE", "No additional preference signal applies.", [])]);
}

export const JOB_RANKING_POLICY_VERSION = "H2-DETERMINISTIC-2026-09" as const;

function freshnessBonus(job: CatalogJob, evaluatedAt: Date): number {
  const reference = job.lastVerifiedAt ?? job.lastSeenAt;
  const days = Math.max(0, Math.floor((evaluatedAt.getTime() - reference.getTime()) / 86_400_000));
  return days <= 1 ? 5 : days <= 3 ? 3 : days <= 7 ? 1 : days <= 30 ? 0 : -5;
}

export function evaluateAndRankJob(job: CatalogJob, profile: CandidateJobProfile, evaluatedAt: Date): RankedJobEvaluation {
  const eligibility = evaluateHardEligibility(job, profile);
  if (eligibility.state === "INELIGIBLE") {
    return { policyVersion: JOB_RANKING_POLICY_VERSION, eligibility, dimensions: [], matchScore: null, rankScore: null, label: "HIDDEN", reasons: [], gaps: eligibility.reasons, unknowns: eligibility.unknowns };
  }
  const dimensions = [
    roleDimension(job, profile), skillDimension(job, profile), experienceDimension(job, profile),
    seniorityDimension(job, profile), locationDimension(job, profile), workModeDimension(job, profile),
    compensationDimension(job, profile), preferenceDimension(job, profile)
  ];
  const known = dimensions.filter((item): item is MatchDimension & { score: number } => item.score !== null);
  const totalWeight = known.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = totalWeight ? Math.round(known.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight) : 0;
  const role = dimensions.find((item) => item.key === "ROLE");
  const experience = dimensions.find((item) => item.key === "EXPERIENCE");
  const seniority = dimensions.find((item) => item.key === "SENIORITY");
  // Sparse ATS metadata must not let geography/freshness or a single incidental
  // skill promote a fundamentally unsuitable role. Explicitly accepted role
  // families are not capped because roleDimension classifies them as accepted.
  const lowMatchGuard = role?.gaps.some((item) => item.code === "ROLE_FAMILY_GAP")
    || (experience?.score === 10 && experience.gaps.some((item) => item.code === "EXPERIENCE_BELOW_RANGE"))
    || seniority?.gaps.some((item) => item.code === "EXCESSIVE_SENIORITY_GAP");
  const ceiling = lowMatchGuard ? 49 : 100;
  const matchScore = Math.min(ceiling, weightedScore);
  const rankScore = Math.max(0, Math.min(ceiling, matchScore + freshnessBonus(job, evaluatedAt)));
  const label = matchScore >= 85 ? "STRONG_MATCH" : matchScore >= 70 ? "GOOD_MATCH" : matchScore >= 50 ? "POSSIBLE_MATCH" : "LOW_MATCH";
  return {
    policyVersion: JOB_RANKING_POLICY_VERSION, eligibility, dimensions, matchScore, rankScore, label,
    reasons: dimensions.flatMap((item) => item.reasons),
    gaps: dimensions.flatMap((item) => item.gaps),
    unknowns: [...eligibility.unknowns, ...dimensions.flatMap((item) => item.unknowns)]
  };
}

import { z } from "zod";
import {
  PERSISTABLE_NORMALIZED_VALUE_KINDS,
  type NormalizedValueKind
} from "./normalized-value.js";

export const CANDIDATE_POLICY_VERSION = 3 as const;
export const ANSWER_CLASSES = [
  "STABLE_FACT",
  "MUTABLE_FACT",
  "PREFERENCE",
  "CONTEXTUAL",
  "LEGAL_FACT",
  "CONSENT",
  "PROTECTED"
] as const;
export const SCOPE_TYPES = ["GLOBAL", "SEARCH", "COMPANY", "JOB", "APPLICATION"] as const;
export const SCOPE_CONTEXT_DIMENSIONS = ["COUNTRY", "ROLE_FAMILY", "COMPANY", "JOB", "APPLICATION"] as const;
export const ENTITY_TYPES = ["EMPLOYMENT", "EDUCATION", "PROJECT", "CERTIFICATION", "LANGUAGE"] as const;

export type AnswerClass = (typeof ANSWER_CLASSES)[number];
export type ScopeType = (typeof SCOPE_TYPES)[number];
export type ScopeContextDimension = (typeof SCOPE_CONTEXT_DIMENSIONS)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];

const CanonicalKeySchema = z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/).max(140);

export const CanonicalDefinitionSchema = z
  .object({
    key: CanonicalKeySchema,
    description: z.string().trim().min(1).max(500),
    valueType: z.enum(PERSISTABLE_NORMALIZED_VALUE_KINDS),
    entityType: z.enum(ENTITY_TYPES).nullable()
  })
  .strict();

export type CanonicalDefinition = z.infer<typeof CanonicalDefinitionSchema>;

export const CandidateAnswerPolicySchema = z
  .object({
    policyVersion: z.literal(CANDIDATE_POLICY_VERSION),
    canonicalKey: CanonicalKeySchema,
    valueType: z.enum(PERSISTABLE_NORMALIZED_VALUE_KINDS),
    entityType: z.enum(ENTITY_TYPES).nullable(),
    answerClass: z.enum(ANSWER_CLASSES),
    reuseMode: z.enum(["AUTO", "REVIEW", "DRAFT", "ASK", "NEVER"]),
    allowedScopeTypes: z.array(z.enum(SCOPE_TYPES)).min(1),
    scopeContextDimensions: z.array(z.enum(SCOPE_CONTEXT_DIMENSIONS)),
    requiredContextDimensions: z.array(z.enum(SCOPE_CONTEXT_DIMENSIONS)),
    freshnessDays: z.number().int().positive().max(3_650).nullable(),
    riskTier: z.enum(["LOW", "MEDIUM", "HIGH", "PROTECTED"]),
    autofillMode: z.enum(["AUTO", "REVIEW", "APPLICATION_GESTURE", "FORBIDDEN"]),
    learningMode: z.enum([
      "AUTO_VERSION",
      "REVIEW_TO_SAVE",
      "APPLICATION_ONLY",
      "APPLICATION_AUTHORIZATION",
      "NEVER_LEARN"
    ]),
    permanentCommitPoints: z.array(z.enum(["VERIFIED_SUBMISSION", "EXPLICIT_SAVE"])).max(2),
    reviewReuse: z.enum(["NEVER", "EXACT_SCOPE_TRIAL"]),
    derivationPolicy: z.enum(["DETERMINISTIC_ONLY", "NEVER_INFER", "GROUNDED_GENERATION"]),
    sensitivity: z.enum(["NORMAL", "PERSONAL", "LEGAL", "SENSITIVE"]),
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(120)
  })
  .strict()
  .superRefine((policy, context) => {
    const learnable = policy.learningMode === "AUTO_VERSION" || policy.learningMode === "REVIEW_TO_SAVE";
    if (learnable && policy.permanentCommitPoints.length === 0) {
      context.addIssue({ code: "custom", message: "LEARNABLE_POLICY_REQUIRES_COMMIT_POINT" });
    }
    if (!learnable && policy.permanentCommitPoints.length > 0) {
      context.addIssue({ code: "custom", message: "NON_LEARNABLE_POLICY_FORBIDS_COMMIT_POINT" });
    }
    if (
      policy.answerClass === "PROTECTED" &&
      (policy.reuseMode !== "NEVER" ||
        policy.autofillMode !== "FORBIDDEN" ||
        policy.learningMode !== "NEVER_LEARN")
    ) {
      context.addIssue({ code: "custom", message: "PROTECTED_POLICY_MUST_FAIL_CLOSED" });
    }
    if (
      policy.answerClass === "CONSENT" &&
      (!policy.allowedScopeTypes.includes("APPLICATION") ||
        policy.autofillMode !== "APPLICATION_GESTURE" ||
        policy.learningMode !== "APPLICATION_AUTHORIZATION")
    ) {
      context.addIssue({ code: "custom", message: "CONSENT_REQUIRES_APPLICATION_GESTURE" });
    }
    if (policy.answerClass === "LEGAL_FACT" && policy.derivationPolicy !== "NEVER_INFER") {
      context.addIssue({ code: "custom", message: "LEGAL_FACT_MUST_NOT_BE_INFERRED" });
    }
    if (new Set(policy.allowedScopeTypes).size !== policy.allowedScopeTypes.length) {
      context.addIssue({ code: "custom", message: "DUPLICATE_ALLOWED_SCOPE" });
    }
    if (new Set(policy.scopeContextDimensions).size !== policy.scopeContextDimensions.length) {
      context.addIssue({ code: "custom", message: "DUPLICATE_SCOPE_CONTEXT_DIMENSION" });
    }
    if (
      policy.requiredContextDimensions.some(
        (dimension) => !policy.scopeContextDimensions.includes(dimension)
      )
    ) {
      context.addIssue({ code: "custom", message: "REQUIRED_CONTEXT_NOT_IN_SCOPE_VECTOR" });
    }
    const identityByScope: Partial<Record<ScopeType, ScopeContextDimension>> = {
      COMPANY: "COMPANY",
      JOB: "JOB",
      APPLICATION: "APPLICATION"
    };
    for (const scopeType of policy.allowedScopeTypes) {
      const identity = identityByScope[scopeType];
      if (identity && !policy.scopeContextDimensions.includes(identity)) {
        context.addIssue({ code: "custom", message: `SCOPE_VECTOR_MISSING_${identity}` });
      }
      if (
        scopeType === "SEARCH" &&
        !policy.scopeContextDimensions.includes("COUNTRY") &&
        !policy.scopeContextDimensions.includes("ROLE_FAMILY")
      ) {
        context.addIssue({ code: "custom", message: "SEARCH_SCOPE_VECTOR_HAS_NO_QUALIFIER" });
      }
    }
  });

export type CandidateAnswerPolicy = z.infer<typeof CandidateAnswerPolicySchema>;

const definitions = [
  ["LEGAL_FIRST_NAME", "Candidate-verified legal given name.", "STRING", null],
  ["LEGAL_MIDDLE_NAME", "Candidate-verified legal middle name.", "STRING", null],
  ["LEGAL_LAST_NAME", "Candidate-verified legal family name.", "STRING", null],
  ["PREFERRED_FIRST_NAME", "Preferred given name.", "STRING", null],
  ["PREFERRED_LAST_NAME", "Preferred family name.", "STRING", null],
  ["FIRST_NAME", "Standard given name used for applications.", "STRING", null],
  ["LAST_NAME", "Standard family name used for applications.", "STRING", null],
  ["FULL_NAME", "Complete candidate name.", "STRING", null],
  ["EMAIL", "Application contact email.", "STRING", null],
  ["PHONE", "Application contact phone number.", "PHONE", null],
  ["CURRENT_ADDRESS", "Candidate's current postal address.", "ADDRESS", null],
  ["CURRENT_LOCATION", "Candidate's current city or locality.", "STRING", null],
  ["LINKEDIN_URL", "Candidate's LinkedIn profile.", "URL", null],
  ["GITHUB_URL", "Candidate's GitHub profile.", "URL", null],
  ["PORTFOLIO_URL", "Candidate's portfolio or professional website.", "URL", null],
  ["CURRENT_COMPANY", "Candidate's current or most recent employer.", "STRING", null],
  ["CURRENT_JOB_TITLE", "Candidate's current or most recent job title.", "STRING", null],
  ["CURRENT_CTC", "Candidate's current compensation.", "MONEY", null],
  ["NOTICE_PERIOD", "Candidate's current notice period in days.", "INTEGER", null],
  ["TOTAL_EXPERIENCE", "Candidate's total professional experience.", "DURATION", null],
  ["SKILLS", "Candidate-verified professional skills.", "MULTI_ENUM", null],
  ["PERSONAL_SUMMARY", "Candidate-verified professional summary.", "RICH_TEXT", null],
  ["RESUME", "Candidate-selected master or application resume.", "FILE_REF", null],
  ["WORK_AUTHORIZATION", "Whether the candidate may work in a specific country.", "BOOLEAN", null],
  ["SPONSORSHIP_REQUIRED", "Whether the candidate requires sponsorship in a specific country.", "BOOLEAN", null],
  ["AGE_OVER_18", "Whether the candidate is at least 18 years old.", "BOOLEAN", null],
  ["GOVERNMENT_EMPLOYEE", "Whether the candidate is currently a government employee.", "BOOLEAN", null],
  ["NON_COMPETE", "Whether the candidate is subject to a non-compete obligation.", "BOOLEAN", null],
  ["PREVIOUSLY_EMPLOYED_BY_COMPANY", "Whether the candidate previously worked for the hiring company.", "BOOLEAN", null],
  ["RELATIVE_AT_COMPANY", "Whether the candidate has a relative at the hiring company.", "BOOLEAN", null],
  ["EXPECTED_CTC", "Candidate's expected compensation for a context.", "MONEY", null],
  ["RELOCATION", "Candidate's relocation preference for a context.", "BOOLEAN", null],
  ["PREFERRED_LOCATIONS", "Candidate's preferred work locations.", "MULTI_ENUM", null],
  ["START_DATE", "Candidate's available start date for one application.", "DATE", null],
  ["WORK_MODE_REQUIREMENT", "Candidate response to a job-specific work-mode requirement.", "BOOLEAN", null],
  ["LAST_WORKING_DAY", "Confirmed last working day at the previous employer.", "DATE", null],
  ["AI_CODING_EXPERIENCE", "Candidate-confirmed hands-on experience with AI coding assistants.", "BOOLEAN", null],
  ["HEARING_SOURCE", "How the candidate learned about one role.", "ENUM", null],
  ["COVER_LETTER", "Job-grounded cover letter draft.", "RICH_TEXT", null],
  ["EMPLOYMENT_COMPANY", "Employer for one stable employment entity.", "STRING", "EMPLOYMENT"],
  ["EMPLOYMENT_TITLE", "Job title for one stable employment entity.", "STRING", "EMPLOYMENT"],
  ["EMPLOYMENT_DATE_RANGE", "Dates for one stable employment entity.", "DATE_RANGE", "EMPLOYMENT"],
  ["EMPLOYMENT_LOCATION", "Location for one stable employment entity.", "STRING", "EMPLOYMENT"],
  ["EMPLOYMENT_DESCRIPTION", "Resume-supported description for one employment entity.", "RICH_TEXT", "EMPLOYMENT"],
  ["EMPLOYMENT_SKILLS", "Resume-supported technologies for one employment entity.", "MULTI_ENUM", "EMPLOYMENT"],
  ["EDUCATION_INSTITUTION", "Institution for one stable education entity.", "STRING", "EDUCATION"],
  ["EDUCATION_DEGREE", "Degree for one stable education entity.", "STRING", "EDUCATION"],
  ["EDUCATION_FIELD_OF_STUDY", "Field of study for one stable education entity.", "STRING", "EDUCATION"],
  ["EDUCATION_DATE_RANGE", "Dates for one stable education entity.", "DATE_RANGE", "EDUCATION"],
  ["EDUCATION_GRADE", "Grade stated for one education entity.", "STRING", "EDUCATION"],
  ["EDUCATION_LOCATION", "Location for one education entity.", "STRING", "EDUCATION"],
  ["PROJECT_NAME", "Name for one candidate project.", "STRING", "PROJECT"],
  ["PROJECT_DESCRIPTION", "Resume-supported description for one project.", "RICH_TEXT", "PROJECT"],
  ["PROJECT_TECHNOLOGIES", "Technologies stated for one project.", "MULTI_ENUM", "PROJECT"],
  ["PROJECT_DATE_RANGE", "Dates for one candidate project.", "DATE_RANGE", "PROJECT"],
  ["PROJECT_URL", "Link stated for one candidate project.", "URL", "PROJECT"],
  ["CERTIFICATION_NAME", "Name for one certification or award.", "STRING", "CERTIFICATION"],
  ["CERTIFICATION_ISSUER", "Issuer for one certification or award.", "STRING", "CERTIFICATION"],
  ["CERTIFICATION_DATE", "Date for one certification or award.", "DATE", "CERTIFICATION"],
  ["CERTIFICATION_URL", "Verification link for one certification.", "URL", "CERTIFICATION"],
  ["CERTIFICATION_KIND", "Whether the record is a certification or award.", "ENUM", "CERTIFICATION"],
  ["CERTIFY_INFORMATION_ACCURATE", "Application-specific accuracy certification.", "BOOLEAN", null],
  ["PRIVACY_ACKNOWLEDGEMENT", "Application-specific privacy notice acknowledgement.", "BOOLEAN", null],
  ["BACKGROUND_CHECK_AUTHORIZATION", "Application-specific background-check authorization.", "BOOLEAN", null],
  ["TERMS_ACKNOWLEDGEMENT", "Application-specific terms acknowledgement.", "BOOLEAN", null],
  ["EEO_GENDER", "Voluntary demographic gender disclosure.", "ENUM", null],
  ["EEO_RACE", "Voluntary demographic race or ethnicity disclosure.", "ENUM", null],
  ["EEO_VETERAN", "Voluntary veteran-status disclosure.", "ENUM", null],
  ["EEO_DISABILITY", "Voluntary disability-status disclosure.", "ENUM", null]
] as const satisfies readonly (readonly [string, string, Exclude<NormalizedValueKind, "UNKNOWN">, EntityType | null])[];

export const CANONICAL_DEFINITIONS: readonly CanonicalDefinition[] = Object.freeze(
  definitions.map(([key, description, valueType, entityType]) =>
    CanonicalDefinitionSchema.parse({ key, description, valueType, entityType })
  )
);

const stableIdentity = new Set([
  "LEGAL_FIRST_NAME",
  "LEGAL_MIDDLE_NAME",
  "LEGAL_LAST_NAME",
  "PREFERRED_FIRST_NAME",
  "PREFERRED_LAST_NAME",
  "FIRST_NAME",
  "LAST_NAME",
  "FULL_NAME",
  "EMAIL",
  "PHONE",
  "CURRENT_ADDRESS",
  "CURRENT_LOCATION",
  "LINKEDIN_URL",
  "GITHUB_URL",
  "PORTFOLIO_URL",
  "TOTAL_EXPERIENCE",
  "SKILLS",
  "PERSONAL_SUMMARY"
]);
const mutableEmployment = new Set(["CURRENT_COMPANY", "CURRENT_JOB_TITLE"]);
const countryLegal = new Set(["WORK_AUTHORIZATION", "SPONSORSHIP_REQUIRED"]);
const globalLegal = new Set(["AGE_OVER_18", "GOVERNMENT_EMPLOYEE", "NON_COMPETE"]);
const companyLegal = new Set(["PREVIOUSLY_EMPLOYED_BY_COMPANY", "RELATIVE_AT_COMPANY"]);
const preferences = new Set(["EXPECTED_CTC", "RELOCATION", "PREFERRED_LOCATIONS"]);
const applicationDefaults = new Set(["START_DATE", "WORK_MODE_REQUIREMENT", "HEARING_SOURCE", "LAST_WORKING_DAY", "AI_CODING_EXPERIENCE"]);
const consent = new Set([
  "CERTIFY_INFORMATION_ACCURATE",
  "PRIVACY_ACKNOWLEDGEMENT",
  "BACKGROUND_CHECK_AUTHORIZATION",
  "TERMS_ACKNOWLEDGEMENT"
]);
const protectedCanonicals = new Set(["EEO_GENDER", "EEO_RACE", "EEO_VETERAN", "EEO_DISABILITY"]);

const commitPoints = ["VERIFIED_SUBMISSION", "EXPLICIT_SAVE"] as const;

function basePolicy(definition: CanonicalDefinition): CandidateAnswerPolicy {
  return {
    policyVersion: CANDIDATE_POLICY_VERSION,
    canonicalKey: definition.key,
    valueType: definition.valueType,
    entityType: definition.entityType,
    answerClass: "CONTEXTUAL",
    reuseMode: "ASK",
    allowedScopeTypes: ["APPLICATION"],
    scopeContextDimensions: ["APPLICATION"],
    requiredContextDimensions: ["APPLICATION"],
    freshnessDays: null,
    riskTier: "MEDIUM",
    autofillMode: "FORBIDDEN",
    learningMode: "APPLICATION_ONLY",
    permanentCommitPoints: [],
    reviewReuse: "NEVER",
    derivationPolicy: "NEVER_INFER",
    sensitivity: "NORMAL",
    reasonCode: "UNREVIEWED_CANONICAL_FAILS_CLOSED"
  };
}

function policyForDefinition(definition: CanonicalDefinition): CandidateAnswerPolicy {
  const policy = basePolicy(definition);
  const key = definition.key;
  if (stableIdentity.has(key) || definition.entityType) {
    return CandidateAnswerPolicySchema.parse({
      ...policy,
      answerClass: "STABLE_FACT",
      reuseMode: "AUTO",
      allowedScopeTypes: ["GLOBAL"],
      scopeContextDimensions: [],
      requiredContextDimensions: [],
      riskTier: "LOW",
      autofillMode: "AUTO",
      learningMode: "AUTO_VERSION",
      permanentCommitPoints: commitPoints,
      derivationPolicy: "DETERMINISTIC_ONLY",
      sensitivity: /LEGAL_|EMAIL|PHONE|ADDRESS/.test(key) ? "PERSONAL" : "NORMAL",
      reasonCode: definition.entityType ? "STABLE_ENTITY_FACT" : "STABLE_CANDIDATE_FACT"
    });
  }
  if (mutableEmployment.has(key)) {
    return CandidateAnswerPolicySchema.parse({
      ...policy,
      answerClass: "MUTABLE_FACT",
      reuseMode: "AUTO",
      allowedScopeTypes: ["GLOBAL"],
      scopeContextDimensions: [],
      requiredContextDimensions: [],
      freshnessDays: 180,
      autofillMode: "AUTO",
      learningMode: "AUTO_VERSION",
      permanentCommitPoints: commitPoints,
      derivationPolicy: "DETERMINISTIC_ONLY",
      reasonCode: "FRESH_MUTABLE_EMPLOYMENT_FACT"
    });
  }
  if (key === "CURRENT_CTC" || key === "NOTICE_PERIOD") {
    return CandidateAnswerPolicySchema.parse({
      ...policy,
      answerClass: "MUTABLE_FACT",
      reuseMode: "AUTO",
      allowedScopeTypes: ["GLOBAL"],
      scopeContextDimensions: [],
      requiredContextDimensions: [],
      freshnessDays: key === "NOTICE_PERIOD" ? 30 : 180,
      riskTier: key === "CURRENT_CTC" ? "HIGH" : "MEDIUM",
      autofillMode: "AUTO",
      learningMode: "REVIEW_TO_SAVE",
      permanentCommitPoints: commitPoints,
      sensitivity: key === "CURRENT_CTC" ? "PERSONAL" : "NORMAL",
      reasonCode: key === "CURRENT_CTC" ? "FRESH_COMPENSATION_FACT" : "FRESH_AVAILABILITY_FACT"
    });
  }
  if (key === "RESUME") {
    return CandidateAnswerPolicySchema.parse({
      ...policy,
      answerClass: "STABLE_FACT",
      reuseMode: "AUTO",
      allowedScopeTypes: ["GLOBAL", "JOB"],
      scopeContextDimensions: ["JOB"],
      requiredContextDimensions: [],
      autofillMode: "AUTO",
      learningMode: "REVIEW_TO_SAVE",
      permanentCommitPoints: commitPoints,
      derivationPolicy: "NEVER_INFER",
      sensitivity: "PERSONAL",
      reasonCode: "CANDIDATE_SELECTED_DOCUMENT"
    });
  }
  if (countryLegal.has(key)) {
    return CandidateAnswerPolicySchema.parse({
      ...policy,
      answerClass: "LEGAL_FACT",
      reuseMode: "REVIEW",
      allowedScopeTypes: ["SEARCH"],
      scopeContextDimensions: ["COUNTRY"],
      requiredContextDimensions: ["COUNTRY"],
      freshnessDays: 180,
      riskTier: "HIGH",
      autofillMode: "REVIEW",
      learningMode: "REVIEW_TO_SAVE",
      permanentCommitPoints: commitPoints,
      reviewReuse: "EXACT_SCOPE_TRIAL",
      sensitivity: "LEGAL",
      reasonCode: "JURISDICTION_SCOPED_LEGAL_FACT"
    });
  }
  if (globalLegal.has(key)) {
    return CandidateAnswerPolicySchema.parse({
      ...policy,
      answerClass: "LEGAL_FACT",
      reuseMode: "REVIEW",
      allowedScopeTypes: ["GLOBAL"],
      scopeContextDimensions: [],
      requiredContextDimensions: [],
      freshnessDays: key === "AGE_OVER_18" ? 365 : 180,
      riskTier: "HIGH",
      autofillMode: "REVIEW",
      learningMode: "REVIEW_TO_SAVE",
      permanentCommitPoints: commitPoints,
      reviewReuse: "EXACT_SCOPE_TRIAL",
      sensitivity: "LEGAL",
      reasonCode: "CANDIDATE_CONFIRMED_LEGAL_FACT"
    });
  }
  if (companyLegal.has(key)) {
    return CandidateAnswerPolicySchema.parse({
      ...policy,
      answerClass: "LEGAL_FACT",
      reuseMode: "REVIEW",
      allowedScopeTypes: ["COMPANY"],
      scopeContextDimensions: ["COMPANY"],
      requiredContextDimensions: ["COMPANY"],
      freshnessDays: 180,
      riskTier: "HIGH",
      autofillMode: "REVIEW",
      learningMode: "REVIEW_TO_SAVE",
      permanentCommitPoints: commitPoints,
      reviewReuse: "EXACT_SCOPE_TRIAL",
      sensitivity: "LEGAL",
      reasonCode: "EXACT_COMPANY_SCOPE_REQUIRED"
    });
  }
  if (preferences.has(key)) {
    return CandidateAnswerPolicySchema.parse({
      ...policy,
      answerClass: "PREFERENCE",
      reuseMode: "AUTO",
      allowedScopeTypes: ["GLOBAL", "SEARCH", "COMPANY", "JOB"],
      scopeContextDimensions: ["COUNTRY", "ROLE_FAMILY", "COMPANY", "JOB"],
      requiredContextDimensions: [],
      freshnessDays: key === "EXPECTED_CTC" ? 90 : null,
      riskTier: key === "EXPECTED_CTC" ? "HIGH" : "MEDIUM",
      autofillMode: "AUTO",
      learningMode: "REVIEW_TO_SAVE",
      permanentCommitPoints: commitPoints,
      reviewReuse: "EXACT_SCOPE_TRIAL",
      sensitivity: key === "EXPECTED_CTC" ? "PERSONAL" : "NORMAL",
      reasonCode: "CONTEXTUAL_PREFERENCE_WITH_GLOBAL_DEFAULT"
    });
  }
  if (applicationDefaults.has(key)) return CandidateAnswerPolicySchema.parse({
    ...policy, answerClass: "CONTEXTUAL", reuseMode: "AUTO",
    allowedScopeTypes: ["GLOBAL", "SEARCH", "COMPANY", "JOB", "APPLICATION"],
    scopeContextDimensions: ["COUNTRY", "ROLE_FAMILY", "COMPANY", "JOB", "APPLICATION"],
    requiredContextDimensions: [], freshnessDays: key === "START_DATE" ? 30 : null,
    autofillMode: "AUTO", learningMode: "REVIEW_TO_SAVE", permanentCommitPoints: commitPoints,
    reviewReuse: "EXACT_SCOPE_TRIAL", reasonCode: "VERIFIED_FACT_WITH_GLOBAL_DEFAULT"
  });
  if (key === "COVER_LETTER") {
    return CandidateAnswerPolicySchema.parse({
      ...policy,
      reuseMode: "DRAFT",
      autofillMode: "REVIEW",
      derivationPolicy: "GROUNDED_GENERATION",
      reasonCode: "JOB_GROUNDED_WRITING"
    });
  }
  if (consent.has(key)) {
    return CandidateAnswerPolicySchema.parse({
      ...policy,
      answerClass: "CONSENT",
      reuseMode: "NEVER",
      autofillMode: "APPLICATION_GESTURE",
      learningMode: "APPLICATION_AUTHORIZATION",
      sensitivity: "LEGAL",
      riskTier: "HIGH",
      reasonCode: "APPLICATION_DECLARATION_REQUIRES_GESTURE"
    });
  }
  if (protectedCanonicals.has(key)) {
    return CandidateAnswerPolicySchema.parse({
      ...policy,
      answerClass: "PROTECTED",
      reuseMode: "NEVER",
      requiredContextDimensions: [],
      riskTier: "PROTECTED",
      autofillMode: "FORBIDDEN",
      learningMode: "NEVER_LEARN",
      sensitivity: "SENSITIVE",
      reasonCode: "PROTECTED_OR_VOLUNTARY_VALUE"
    });
  }
  return CandidateAnswerPolicySchema.parse(policy);
}

const canonicalByKey = new Map(CANONICAL_DEFINITIONS.map((definition) => [definition.key, definition]));
const policyByKey = new Map(
  CANONICAL_DEFINITIONS.map((definition) => {
    const policy = policyForDefinition(definition);
    const reusableFact = !definition.entityType && definition.valueType !== "FILE_REF"
      && ["STABLE_FACT", "MUTABLE_FACT", "PREFERENCE", "CONTEXTUAL"].includes(policy.answerClass)
      && policy.allowedScopeTypes.includes("GLOBAL");
    return [definition.key, reusableFact ? CandidateAnswerPolicySchema.parse({
      ...policy, allowedScopeTypes: [...SCOPE_TYPES], scopeContextDimensions: [...SCOPE_CONTEXT_DIMENSIONS]
    }) : policy];
  })
);

export function normalizeCanonicalKey(key: string): string {
  return key.trim().toUpperCase();
}

export function canonicalDefinition(key: string): CanonicalDefinition | null {
  return canonicalByKey.get(normalizeCanonicalKey(key)) ?? null;
}

export function candidateAnswerPolicy(key: string): CandidateAnswerPolicy {
  const canonicalKey = normalizeCanonicalKey(key);
  const registered = policyByKey.get(canonicalKey);
  if (registered) return registered;
  return CandidateAnswerPolicySchema.parse({
    ...basePolicy({
      key: CanonicalKeySchema.parse(canonicalKey),
      description: "Unreviewed canonical.",
      valueType: "STRING",
      entityType: null
    }),
    canonicalKey
  });
}

export function listCandidateAnswerPolicies(): readonly CandidateAnswerPolicy[] {
  return [...policyByKey.values()];
}

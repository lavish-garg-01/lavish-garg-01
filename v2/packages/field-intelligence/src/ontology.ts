import {
  CANONICAL_DEFINITIONS,
  candidateAnswerPolicy,
  type CanonicalDefinition
} from "@job-hunter-v2/candidate-truth";
import type { SemanticControlType } from "@job-hunter-v2/contracts";

export interface AliasRule {
  canonicalKey: string;
  aliases: readonly string[];
  section?: RegExp;
  requiredSection?: RegExp;
  negative?: RegExp;
  attributeAliases?: readonly string[];
}

const rules: readonly AliasRule[] = [
  { canonicalKey: "LEGAL_FIRST_NAME", aliases: ["legal first name", "legal given name"] },
  { canonicalKey: "LEGAL_MIDDLE_NAME", aliases: ["legal middle name"] },
  { canonicalKey: "LEGAL_LAST_NAME", aliases: ["legal last name", "legal family name", "legal surname"] },
  { canonicalKey: "PREFERRED_FIRST_NAME", aliases: ["preferred first name", "preferred given name"] },
  { canonicalKey: "PREFERRED_LAST_NAME", aliases: ["preferred last name", "preferred family name"] },
  { canonicalKey: "FIRST_NAME", aliases: ["first name", "given name", "forename"], attributeAliases: ["given-name", "fname", "first_name"] },
  { canonicalKey: "LAST_NAME", aliases: ["last name", "family name", "surname"], attributeAliases: ["family-name", "lname", "last_name"] },
  { canonicalKey: "FULL_NAME", aliases: ["full name", "candidate name", "your name", "name as per records", "name"], attributeAliases: ["name"], negative: /first name|last name|middle name|given name|family name|user name|username|file name|company name|display name|account name|preferred name/ },
  { canonicalKey: "EMAIL", aliases: ["email", "email address", "primary email", "contact email", "confirm your email", "confirm email", "confirm email address", "re enter email"], attributeAliases: ["email"] },
  { canonicalKey: "PHONE", aliases: ["phone", "phone number", "mobile", "mobile number", "telephone", "contact number"], attributeAliases: ["tel", "phone"] },
  { canonicalKey: "CURRENT_ADDRESS", aliases: ["current address", "residential address", "mailing address", "street address", "address line"], section: /address|contact|personal/ },
  { canonicalKey: "CURRENT_LOCATION", aliases: ["current location", "current city", "city of residence", "where are you based", "present location"], negative: /preferred|relocat/ },
  { canonicalKey: "CURRENT_LOCATION", aliases: ["city"], requiredSection: /personal|contact|residential|current address/, negative: /preferred|relocat|birth|employer|company|school|university/ },
  { canonicalKey: "LINKEDIN_URL", aliases: ["linkedin", "linkedin url", "linkedin profile", "linkedin profile url", "linkedin profile link"] },
  { canonicalKey: "GITHUB_URL", aliases: ["github", "github url", "github profile", "github profile url"] },
  { canonicalKey: "PORTFOLIO_URL", aliases: ["portfolio", "portfolio url", "personal website", "professional website", "website url"] },
  { canonicalKey: "CURRENT_COMPANY", aliases: ["current company", "current employer", "present employer", "present organization", "organization currently engaged", "organization with which you are presently engaged"], negative: /previous|former/ },
  { canonicalKey: "CURRENT_JOB_TITLE", aliases: ["current job title", "current title", "present designation", "current designation", "current role"], negative: /desired|target/ },
  { canonicalKey: "CURRENT_CTC", aliases: ["current ctc", "present ctc", "current compensation", "current annual compensation", "current salary", "present salary"], negative: /expected|desired|minimum/ },
  { canonicalKey: "EXPECTED_CTC", aliases: ["expected ctc", "desired ctc", "expected compensation", "expected annual salary", "salary expectation", "expected salary", "desired salary", "minimum expected salary"], negative: /current|present/ },
  { canonicalKey: "NOTICE_PERIOD", aliases: ["notice period", "current notice period", "days notice", "notice period in days", "time required to join", "if you are offered by when can you join", "by when can you join", "joining availability"] },
  { canonicalKey: "LAST_WORKING_DAY", aliases: ["last working day", "if available immediately what was your last working day in the previous organisation", "last working date", "last working day in previous organization"] },
  { canonicalKey: "AI_CODING_EXPERIENCE", aliases: ["do you have hands on experience with ai coding agents e g claude code cursor github copilot as part of your development workflow", "hands on experience with ai coding agents", "experience with ai coding assistants"] },
  { canonicalKey: "TOTAL_EXPERIENCE", aliases: ["total experience", "years of experience", "overall experience", "professional experience", "total work experience", "what is your work experience", "months of experience"], negative: /node|java|python|react|skill|technology/ },
  { canonicalKey: "SKILLS", aliases: ["skills", "technical skills", "key skills", "technology stack", "tech stack", "primary skills"] },
  { canonicalKey: "PERSONAL_SUMMARY", aliases: ["professional summary", "profile summary", "about you", "career summary", "brief introduction"] },
  { canonicalKey: "RESUME", aliases: ["resume", "autofill from resume", "upload resume", "attach resume", "cv", "curriculum vitae"] },
  { canonicalKey: "WORK_AUTHORIZATION", aliases: ["work authorization", "authorized to work", "legally authorized to work", "eligible to work", "right to work"], negative: /sponsor/ },
  { canonicalKey: "SPONSORSHIP_REQUIRED", aliases: ["require sponsorship", "need sponsorship", "visa sponsorship", "sponsorship now or in future", "immigration sponsorship"] },
  { canonicalKey: "AGE_OVER_18", aliases: ["over 18", "at least 18", "18 years of age", "legal working age"] },
  { canonicalKey: "GOVERNMENT_EMPLOYEE", aliases: ["government employee", "employed by government", "government official", "public official"] },
  { canonicalKey: "NON_COMPETE", aliases: ["non compete", "non-compete", "restrictive covenant", "contractual restriction"] },
  { canonicalKey: "PREVIOUSLY_EMPLOYED_BY_COMPANY", aliases: ["previously employed by this company", "worked here before", "former employee", "previously worked for us", "prior employment with company"] },
  { canonicalKey: "RELATIVE_AT_COMPANY", aliases: ["relative at company", "family member works here", "related to an employee", "relative employed by us"] },
  { canonicalKey: "RELOCATION", aliases: ["willing to relocate", "open to relocation", "relocate for this role", "relocation willingness"] },
  { canonicalKey: "PREFERRED_LOCATIONS", aliases: ["preferred locations", "preferred location", "location preference", "preferred work location", "desired location"] },
  { canonicalKey: "START_DATE", aliases: ["available start date", "earliest start date", "when can you start", "joining date", "date available"] },
  { canonicalKey: "WORK_MODE_REQUIREMENT", aliases: ["work from office", "comfortable working onsite", "agree to hybrid work", "onsite requirement"] },
  { canonicalKey: "HEARING_SOURCE", aliases: ["how did you hear", "how did you learn about this job", "source of application", "job source", "how did you come to know about"] },
  { canonicalKey: "COVER_LETTER", aliases: ["cover letter", "letter of motivation", "motivation letter", "message to the hiring team", "let the company know about your interest working there"] },
  { canonicalKey: "EMPLOYMENT_COMPANY", aliases: ["company", "employer", "organization"], section: /employment history|work experience|work history|previous employment/ },
  { canonicalKey: "EMPLOYMENT_TITLE", aliases: ["job title", "position", "designation", "role"], section: /employment history|work experience|work history|previous employment/ },
  { canonicalKey: "EMPLOYMENT_DATE_RANGE", aliases: ["employment dates", "dates employed", "start and end date", "duration of employment"], section: /employment history|work experience|work history|previous employment/ },
  { canonicalKey: "EDUCATION_INSTITUTION", aliases: ["school", "college", "university", "institution", "educational institution"], section: /education|academic/ },
  { canonicalKey: "EDUCATION_DEGREE", aliases: ["degree", "qualification", "degree type", "highest degree"], section: /education|academic/ },
  { canonicalKey: "EDUCATION_FIELD_OF_STUDY", aliases: ["field of study", "major", "specialization", "discipline"], section: /education|academic/ },
  { canonicalKey: "EDUCATION_DATE_RANGE", aliases: ["education dates", "graduation date", "start and graduation year", "attendance dates"], section: /education|academic/ },
  { canonicalKey: "CERTIFY_INFORMATION_ACCURATE", aliases: ["information is accurate", "certify information", "application is true", "details are correct"] },
  { canonicalKey: "PRIVACY_ACKNOWLEDGEMENT", aliases: ["privacy policy", "privacy notice", "data processing notice", "acknowledge privacy"] },
  { canonicalKey: "BACKGROUND_CHECK_AUTHORIZATION", aliases: ["background check", "background verification", "authorize screening", "consent to background"] },
  { canonicalKey: "TERMS_ACKNOWLEDGEMENT", aliases: ["agree to terms", "acknowledge terms", "terms and conditions", "applicant terms"] },
  { canonicalKey: "DATA_PROCESSING_CONSENT", aliases: ["consent to processing", "processing of my personal data", "processing of my personal information", "data processing consent", "international transfer of my data"] },
  { canonicalKey: "APPLICANT_CERTIFICATION", aliases: ["applicant certification", "employment is subject to verification", "false information may lead to withdrawal", "false information may lead to termination", "withdrawal or termination"] },
  { canonicalKey: "EEO_ACKNOWLEDGEMENT", aliases: ["acknowledge eeo", "acknowledge the equal employment opportunity notice", "equal employment opportunity acknowledgement", "voluntary disclosure acknowledgement"] },
  { canonicalKey: "APPLICATION_SPECIFIC_ACKNOWLEDGEMENT", aliases: ["application specific acknowledgement", "acknowledge the statement above", "understand the statement above", "confirm the above statement"] },
  { canonicalKey: "EEO_GENDER", aliases: ["gender", "gender identity", "sex"], section: /demographic|equal opportunity|eeo/ },
  { canonicalKey: "EEO_RACE", aliases: ["race", "ethnicity", "race or ethnicity"], section: /demographic|equal opportunity|eeo/ },
  { canonicalKey: "EEO_VETERAN", aliases: ["veteran status", "protected veteran", "military veteran"], section: /demographic|equal opportunity|eeo/ },
  { canonicalKey: "EEO_DISABILITY", aliases: ["disability status", "person with disability", "self identify disability"], section: /demographic|equal opportunity|eeo/ }
];

// These are semantic declaration concepts owned by J/O, not reusable Candidate
// Truth. The original four declaration canonicals remain in the shared registry
// for compatibility; new O concepts are deliberately local to semantic meaning.
const declarationDefinitions: readonly CanonicalDefinition[] = [
  { key: "DATA_PROCESSING_CONSENT", description: "Application-specific personal-data processing consent.", valueType: "BOOLEAN", entityType: null },
  { key: "APPLICANT_CERTIFICATION", description: "Application-specific applicant certification.", valueType: "BOOLEAN", entityType: null },
  { key: "EEO_ACKNOWLEDGEMENT", description: "Application-specific EEO or voluntary-disclosure acknowledgement.", valueType: "BOOLEAN", entityType: null },
  { key: "APPLICATION_SPECIFIC_ACKNOWLEDGEMENT", description: "Acknowledgement whose meaning is limited to the current application.", valueType: "BOOLEAN", entityType: null }
];

const allDefinitions = [...CANONICAL_DEFINITIONS, ...declarationDefinitions];
const byKey = new Map(allDefinitions.map((definition) => [definition.key, definition]));

export function canonicalDefinitions(): readonly CanonicalDefinition[] { return allDefinitions; }
export function canonicalDefinitionFor(key: string): CanonicalDefinition | null { return byKey.get(key) ?? null; }
let configuredAliases: ReadonlyMap<string, readonly string[]> = new Map();
let aliasRevision = 0;
export function canonicalAliasRevision(): number { return aliasRevision; }
/** Admin aliases inherit each built-in rule's scope, negative and type guards. */
export function configureCanonicalAliases(aliases: ReadonlyMap<string, readonly string[]>): void {
  if (JSON.stringify([...configuredAliases]) !== JSON.stringify([...aliases])) { configuredAliases = new Map(aliases); aliasRevision++; }
}
export function aliasRules(): readonly AliasRule[] {
  return rules.map(rule => ({ ...rule, aliases: [...rule.aliases, ...(configuredAliases.get(rule.canonicalKey) ?? [])] }));
}

export function fieldTypeCompatibility(controlType: SemanticControlType, canonicalKey: string): number {
  const definition = canonicalDefinitionFor(canonicalKey);
  if (!definition) return -1;
  if (controlType === "BUTTON" || controlType === "UNKNOWN") return -1;
  if (controlType === "FILE") return ["RESUME", "COVER_LETTER"].includes(canonicalKey) ? 1 : -1;
  if (["RESUME", "COVER_LETTER"].includes(canonicalKey) && controlType !== "TEXTAREA") return -1;
  const kind = definition.valueType;
  if (["CHECKBOX", "RADIO"].includes(controlType)) return ["BOOLEAN", "ENUM"].includes(kind) ? 1 : -0.8;
  if (["SELECT", "COMBOBOX", "MULTISELECT"].includes(controlType)) {
    if (["ENUM", "MULTI_ENUM", "BOOLEAN", "STRING", "INTEGER", "DATE"].includes(kind)) return 0.8;
    return -0.5;
  }
  if (controlType === "EMAIL") return canonicalKey === "EMAIL" ? 1 : -0.6;
  if (controlType === "TEL") return canonicalKey === "PHONE" ? 1 : -0.6;
  if (controlType === "DATE") return ["DATE", "DATE_RANGE"].includes(kind) ? 1 : -0.5;
  if (controlType === "NUMBER") return ["INTEGER", "DECIMAL", "MONEY", "DURATION"].includes(kind) ? 0.9 : -0.4;
  if (controlType === "TEXTAREA") return ["RICH_TEXT", "STRING"].includes(kind) ? 0.8 : 0.2;
  return 0.5;
}

export function policyAllowsSemanticResolution(canonicalKey: string): boolean {
  return Boolean(canonicalDefinitionFor(canonicalKey) && (
    declarationDefinitions.some((definition) => definition.key === canonicalKey)
    || candidateAnswerPolicy(canonicalKey)
  ));
}

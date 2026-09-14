const DEFINITIONS = [
    { key: "LEGAL_FIRST_NAME", label: "Legal first name", description: "your candidate-verified legal given name", patterns: [/legal\s+(?:first|given)\s+name/i] },
    { key: "LEGAL_MIDDLE_NAME", label: "Legal middle name", description: "your candidate-verified legal middle name", patterns: [/legal\s+middle\s+name/i] },
    { key: "LEGAL_LAST_NAME", label: "Legal family name", description: "your candidate-verified legal family name", patterns: [/legal\s+(?:last|family|sur)name/i] },
    { key: "PREFERRED_FIRST_NAME", label: "Preferred first name", description: "the first name you want the employer to use", patterns: [/preferred\s+first\s+name/i] },
    { key: "PREFERRED_LAST_NAME", label: "Preferred last name", description: "the surname you want the employer to use", patterns: [/preferred\s+(?:last\s+name|surname)/i] },
    { key: "FIRST_NAME", label: "First name", description: "your legal or standard first name", patterns: [/^first\s*name$/i, /^given\s*name$/i] },
    { key: "LAST_NAME", label: "Last name", description: "your legal or standard surname", patterns: [/^last\s*name$/i, /^surname$/i, /^family\s*name$/i] },
    { key: "FULL_NAME", label: "Full name", description: "your complete candidate name", patterns: [/^(?:full\s*)?(?:candidate\s*)?name$/i] },
    { key: "EMAIL", label: "Email", description: "your application contact email", patterns: [/e-?mail(?:\s+address)?/i] },
    { key: "PHONE", label: "Phone", description: "your application contact number", patterns: [/phone|mobile|telephone/i] },
    { key: "COUNTRY", label: "Country", description: "the country associated with your current address and phone number", patterns: [/^country$/i, /phone\s+country/i] },
    { key: "POSTAL_CODE", label: "Postal code", description: "the PIN or postal code used for your current address", patterns: [/zip\s*code|postal\s*code|\bpin\s*code\b|\bpincode\b/i] },
    { key: "ADDRESS_LINE1", label: "Address line 1", description: "the first line of your current address", patterns: [/address\s*(?:line)?\s*1|street\s+address/i] },
    { key: "ADDRESS_LINE2", label: "Address line 2", description: "the optional second line of your current address", patterns: [/address\s*(?:line)?\s*2|apartment|suite/i] },
    { key: "ADDRESS_CITY", label: "Address city", description: "the city or town in your current postal address", patterns: [/^address\s+(?:city|town)$/i] },
    { key: "ADDRESS_STATE", label: "State", description: "the state or union territory in your current address", patterns: [/^(?:state|province|region)$/i] },
    { key: "CURRENT_LOCATION", label: "Current location", description: "the city or locality used for your current address", patterns: [/location\s*\(?city\)?|current\s+(?:location|city)|city\s+of\s+residence|where\s+are\s+you\s+based/i, /^location$/i, /^city$/i, /^town$/i] },
    { key: "PREFERRED_LOCATIONS", label: "Preferred locations", description: "the cities where you prefer to work", patterns: [/preferred\s+(?:work\s+)?location/i] },
    { key: "LINKEDIN_URL", label: "LinkedIn profile", description: "the LinkedIn URL saved with your resume", patterns: [/linkedin(?:\s+(?:profile|url))?/i] },
    { key: "PORTFOLIO_URL", label: "Portfolio URL", description: "your professional portfolio or personal website", patterns: [/portfolio|personal\s+website/i] },
    { key: "GITHUB_URL", label: "GitHub profile", description: "your GitHub profile URL", patterns: [/github/i] },
    { key: "SOCIAL_FACEBOOK_URL", label: "Facebook profile", description: "your verified Facebook profile URL", patterns: [/^facebook(?:\s+(?:profile|url))?$/i] },
    { key: "SOCIAL_TWITTER_URL", label: "X / Twitter profile", description: "your verified X or Twitter profile URL", patterns: [/^(?:x\s*\(fka\s+twitter\)|twitter|x profile)(?:\s+url)?$/i] },
    { key: "CURRENT_COMPANY", label: "Current company", description: "your present or most recent employer", patterns: [/current\s+(?:company|employer)|most\s+recent\s+employer/i] },
    { key: "CURRENT_CAREER_STAGE", label: "Current career stage", description: "your career stage derived from verified professional experience", patterns: [/current\s+career\s+stage|career\s+stage/i] },
    { key: "CURRENT_INDUSTRY", label: "Current industry", description: "the candidate-verified industry of your current or most recent employer", patterns: [/current\s+industry|most\s+recent\s+industry/i] },
    { key: "WORK_AUTHORIZATION", label: "Work authorization", description: "whether you are currently eligible to work in the job's country", options: ["Yes", "No"], patterns: [/eligible\s+to\s+work|authori[sz]ed\s+to\s+work|work\s+authori[sz]ation/i] },
    { key: "SPONSORSHIP", label: "Immigration sponsorship", description: "whether you need immigration or visa support now or later", options: ["Yes", "No"], patterns: [/sponsorship|immigration.{0,30}(?:support|visa)|need.{0,30}(?:visa|immigration)/i] },
    { key: "CURRENT_EMPLOYEE", label: "Current employee or contractor", description: "whether you currently work for this employer", options: ["Yes", "No"], patterns: [/currently\s+an?\s+(?:employee|contractor)|current\s+(?:employee|contractor)|currently\s+working\s+for\s+(?:an?\s+)?(?:existing\s+)?(?:.+\s+)?(?:entity|employer|company)/i] },
    { key: "PREVIOUS_EMPLOYEE", label: "Previous employment", description: "whether you previously worked for this employer", options: ["Yes", "No"], patterns: [/previously\s+worked|former\s+employee|worked\s+(?:at|for)\s+this/i] },
    { key: "PREVIOUS_EMPLOYMENT_TYPE", label: "Previous employment type", description: "the type of a previous role with this employer", options: ["Employee", "Contractor"], patterns: [/previous\s+employment\s+type/i] },
    { key: "WORK_MODE_REQUIREMENT", label: "Work-mode requirement", description: "whether you can meet this role's office, hybrid, or remote schedule", options: ["Yes", "No"], patterns: [/hybrid\s+working|days?\s+per\s+week.{0,30}(?:office|on.?site)|meet\s+this\s+requirement/i] },
    { key: "CURRENT_CTC", label: "Current CTC", description: "your current annual compensation", patterns: [/current(?:\s*\([^)]*\))?\s*(?:ctc|salary|compensation)/i] },
    { key: "EXPECTED_CTC", label: "Expected CTC", description: "your expected annual compensation", patterns: [/expected\s*(?:ctc|salary|compensation)/i] },
    { key: "NOTICE_PERIOD", label: "Notice period", description: "the notice period required by your current employer", patterns: [/notice\s*period/i] },
    { key: "START_DATE", label: "Available start date", description: "the date you could start this specific role", patterns: [/(?:available|start).*date|when.*(?:start|join)|earliest\s+start/i] },
    { key: "TOTAL_EXPERIENCE", label: "Total experience", description: "your total years of professional experience", patterns: [/total.{0,20}exp(?:erience|ereince)|years?.{0,20}(?:professional|work|overall).{0,20}exp(?:erience|ereince)/i, /how\s+many\s+years[^?]*exp(?:erience|ereince)/i, /years?\s+of\s+exp(?:erience|ereince)/i, /^exp(?:erience|ereince)(?:\s*\(\s*(?:in\s+)?years?\s*\))?$/i] },
    { key: "RELOCATION", label: "Relocation", description: "whether you are willing to relocate for the role", patterns: [/relocat/i] },
    { key: "HEARING_SOURCE", label: "How did you hear about this role", description: "how you found or were referred to this job opening", patterns: [/how\s+did\s+you\s+(?:hear|learn)|source|where\s+did\s+you\s+find/i] },
    { key: "WEBSITE_URL", label: "Website", description: "your personal website or link", patterns: [/website|personal\s+url|blog\s+url/i] },
    { key: "RESUME", label: "Resume", description: "your selected resume file", patterns: [/resume|\bcv\b/i] },
    { key: "COVER_LETTER", label: "Cover letter", description: "a role-specific cover letter", patterns: [/cover\s+letter/i] },
    { key: "PERSONAL_SUMMARY", label: "Professional summary", description: "the verified professional summary from your selected resume", patterns: [/^personal\s+summary(?:\s+use\s+it.*)?$/i, /^professional\s+summary$/i, /^profile\s+summary$/i] },
    { key: "SKILLS", label: "Skills", description: "verified skills from the selected resume", patterns: [/^skills?$/i, /separate each skill with a comma/i] },
    { key: "EEO_GENDER", label: "Gender (EEO)", description: "voluntary demographic gender disclosure", patterns: [/\bgender\b|\bsex\b/i] },
    { key: "EEO_RACE", label: "Race / Ethnicity (EEO)", description: "voluntary demographic race or ethnic background disclosure", patterns: [/race|ethnic/i] },
    { key: "EEO_VETERAN", label: "Veteran status (EEO)", description: "voluntary veteran or military status disclosure", patterns: [/veteran/i] },
    { key: "EEO_DISABILITY", label: "Disability status (EEO)", description: "voluntary disability status disclosure", patterns: [/disabilit/i] }
];

const GROUPS = {
    location: ["CURRENT_LOCATION", "ADDRESS_CITY", "ADDRESS_STATE", "PREFERRED_LOCATIONS", "POSTAL_CODE", "RELOCATION"],
    identity: ["FULL_NAME", "FIRST_NAME", "LAST_NAME", "LEGAL_FIRST_NAME", "LEGAL_MIDDLE_NAME", "LEGAL_LAST_NAME", "PREFERRED_FIRST_NAME", "PREFERRED_LAST_NAME"],
    link: ["LINKEDIN_URL", "PORTFOLIO_URL", "GITHUB_URL", "WEBSITE_URL", "SOCIAL_FACEBOOK_URL", "SOCIAL_TWITTER_URL"],
    employment: ["CURRENT_COMPANY", "CURRENT_CAREER_STAGE", "CURRENT_INDUSTRY", "WORK_AUTHORIZATION", "SPONSORSHIP", "PREVIOUS_EMPLOYEE", "HEARING_SOURCE"],
    compensation: ["CURRENT_CTC", "EXPECTED_CTC", "NOTICE_PERIOD", "START_DATE"],
    demographics: ["EEO_GENDER", "EEO_RACE", "EEO_VETERAN", "EEO_DISABILITY"]
};

function cleanLabel(value = "") {
    return String(value).replace(/[✱*]+/g, " ").replace(/\s+/g, " ").trim();
}

function structuralLeaf(value = "") {
    const parts = String(value || "")
        .replace(/\[([^\]]+)\]/g, " $1 ")
        .replace(/[._:-]+/g, " ")
        .split(/\s+/)
        .map(cleanLabel)
        .filter(Boolean);
    return parts.at(-1) || "";
}

function semanticCandidates(field = {}) {
    const visible = cleanLabel(field.label || "");
    const structural = [field.name, field.autocomplete, field.portalFieldKey]
        .flatMap((value) => [cleanLabel(value || ""), structuralLeaf(value)])
        .filter(Boolean);
    return [...new Set([visible, ...structural])];
}

const TECHNOLOGY_EXPERIENCE = /node\.?js|\baws\b|kafka|\breact\b|angular|vue\b|python|golang|\bgo\b|\bjava\b|kotlin|kubernetes|docker|typescript|javascript|\bsql\b|mongo|postgres|redis|graphql|\.net|\bphp\b|ruby|rust|scala|spark|terraform/i;

const STRUCTURED_RESUME_FIELDS = {
    experience: [
        [/^(?:job\s+)?title$/i, "EXPERIENCE_TITLE", "Role title"],
        [/^(?:company(?:\s+name)?|employer)$/i, "EXPERIENCE_COMPANY", "Employer"],
        [/^office\s+location$/i, "EXPERIENCE_LOCATION", "Role location"],
        [/^description$/i, "EXPERIENCE_DESCRIPTION", "Role description"],
        [/^(?:from|start\s+date(?:\s+(?:month|year))?)$/i, "EXPERIENCE_START_DATE", "Role start date"],
        [/^(?:to|end\s+date(?:\s+(?:month|year))?)$/i, "EXPERIENCE_END_DATE", "Role end date"],
        [/(?:currently\s+work|current\s+role)/i, "EXPERIENCE_CURRENT", "Current role"]
    ],
    education: [
        [/^institution$/i, "EDUCATION_INSTITUTION", "Institution"],
        [/^major$/i, "EDUCATION_MAJOR", "Major or field of study"],
        [/^degree$/i, "EDUCATION_DEGREE", "Degree"],
        [/^school\s+location$/i, "EDUCATION_LOCATION", "School location"],
        [/^description$/i, "EDUCATION_DESCRIPTION", "Education description"],
        [/^(?:from|start\s+date(?:\s+year)?)$/i, "EDUCATION_START_DATE", "Education start date"],
        [/^(?:to|end\s+date(?:\s+year)?)$/i, "EDUCATION_END_DATE", "Education end date"],
        [/currently\s+attend/i, "EDUCATION_CURRENT", "Current education"]
    ]
};

function structuredResumeDefinition(field, clean) {
    const kind = String(field?.sectionKind || "").toLowerCase();
    const match = STRUCTURED_RESUME_FIELDS[kind]?.find(([pattern]) => pattern.test(clean));
    if (!match) return null;
    return {
        key: match[1], label: match[2],
        description: `verified ${kind} history from the selected resume`
    };
}

/**
 * "Years of experience with Kafka" is a role-specific question, not the
 * candidate's total experience, so it must not take the profile value.
 */
export function isTechnologySpecificExperience(label = "") {
    return TECHNOLOGY_EXPERIENCE.test(cleanLabel(label));
}

export function semanticDefinition(key) {
    return DEFINITIONS.find((definition) => definition.key === key) || {
        key: key || "CUSTOM_FIELD",
        label: String(key || "Custom field").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()),
        description: "an application detail that is not yet in your candidate profile"
    };
}

function groupFor(label) {
    if (/location|city|address|postal|zip|pin\b|relocat/i.test(label)) return "location";
    if (/name|surname/i.test(label)) return "identity";
    if (/url|profile|website|linkedin|github|portfolio/i.test(label)) return "link";
    if (/company|employ|work|visa|sponsor|immigration/i.test(label)) return "employment";
    if (/ctc|salary|compensation|notice|start|join/i.test(label)) return "compensation";
    return "employment";
}

export function inferFieldSemantic(field = {}) {
    const candidates = semanticCandidates(field);
    const label = candidates[0] || "";
    const structured = structuredResumeDefinition(field, cleanLabel(field.label || ""));
    if (structured) return { ...structured, confidence: 1, obvious: true, alternatives: [] };
    const exact = DEFINITIONS.find((definition) => candidates.some((candidate) =>
        definition.patterns.some((pattern) => pattern.test(candidate))
        && !(definition.key === "TOTAL_EXPERIENCE" && isTechnologySpecificExperience(candidate))));
    const suggested = exact || semanticDefinition("CUSTOM_FIELD");
    const alternatives = (GROUPS[groupFor(label)] || []).filter((key) => key !== suggested.key).slice(0, 4).map(semanticDefinition);
    return {
        ...suggested,
        confidence: exact ? 0.98 : 0.35,
        obvious: Boolean(exact),
        alternatives
    };
}

export function contextualMappingPrompt(fieldLabel, inference) {
    return `I matched “${cleanLabel(fieldLabel)}” to ${inference.label} — ${inference.description}. Is that right?`;
}

export function mappingChoices(inference) {
    return [...inference.alternatives.slice(0, 4).map((item) => ({ value: item.key, label: item.label, description: item.description })),
        { value: "CUSTOM_FIELD", label: "None of these", description: "keep this as a new application-specific detail" }];
}

export function candidateValuePrompt(fieldLabel, semanticKey, scope) {
    const definition = semanticDefinition(semanticKey);
    const storage = scope === "CANDIDATE_PROFILE"
        ? "If you provide it, I’ll save it to your candidate profile."
        : scope === "APPLICATION_ONLY" ? "I’ll use it only for this application." : "I won’t reuse it unless you approve.";
    return `The employer requires “${cleanLabel(fieldLabel)}”. I need ${definition.label.toLowerCase()} — ${definition.description}. ${storage}`;
}

export const MAX_MAPPING_QUESTIONS = 2;

export function shouldAskMappingQuestion(inference, questionCount) {
    return !inference.obvious && Number(questionCount || 0) < MAX_MAPPING_QUESTIONS;
}

export const EMPLOYER_FIELD_ONTOLOGY = DEFINITIONS;

export const DEFAULT_SKIP_LLM_ON = Object.freeze([
    "FIRST_NAME",
    "LAST_NAME",
    "FULL_NAME",
    "PREFERRED_FIRST_NAME",
    "PREFERRED_LAST_NAME",
    "EMAIL",
    "PHONE",
    "LINKEDIN_URL",
    "PORTFOLIO_URL",
    "GITHUB_URL",
    "WEBSITE_URL",
    "SOCIAL_FACEBOOK_URL",
    "SOCIAL_TWITTER_URL",
    "EXPERIENCE_TITLE", "EXPERIENCE_COMPANY", "EXPERIENCE_LOCATION", "EXPERIENCE_DESCRIPTION",
    "EXPERIENCE_START_DATE", "EXPERIENCE_END_DATE", "EXPERIENCE_CURRENT",
    "EDUCATION_INSTITUTION", "EDUCATION_MAJOR", "EDUCATION_DEGREE", "EDUCATION_LOCATION",
    "EDUCATION_DESCRIPTION", "EDUCATION_START_DATE", "EDUCATION_END_DATE", "EDUCATION_CURRENT",
    "PERSONAL_SUMMARY",
    "SKILLS",
    // Location and total experience are candidate profile facts. A model must
    // never invent them, even when the employer asks in prose.
    "CURRENT_LOCATION",
    "TOTAL_EXPERIENCE",
    "RESUME",
    "COVER_LETTER"
]);

export const HOT_IDENTITY_KEYS = Object.freeze(
    DEFAULT_SKIP_LLM_ON.filter((key) => key !== "RESUME" && key !== "COVER_LETTER")
);

// Candidate profile facts. No mapping pack may hand these to a model, however
// the employer phrases the question.
export const NEVER_AI_KEYS = Object.freeze([
    "CURRENT_LOCATION", "TOTAL_EXPERIENCE",
    // A social/profile URL is an identity fact, never a writing prompt. If it
    // is absent from the verified profile or resume, leave the optional field blank.
    "LINKEDIN_URL", "PORTFOLIO_URL", "GITHUB_URL", "WEBSITE_URL",
    "SOCIAL_FACEBOOK_URL", "SOCIAL_TWITTER_URL",
    "EXPERIENCE_TITLE", "EXPERIENCE_COMPANY", "EXPERIENCE_LOCATION", "EXPERIENCE_DESCRIPTION",
    "EXPERIENCE_START_DATE", "EXPERIENCE_END_DATE", "EXPERIENCE_CURRENT",
    "EDUCATION_INSTITUTION", "EDUCATION_MAJOR", "EDUCATION_DEGREE", "EDUCATION_LOCATION",
    "EDUCATION_DESCRIPTION", "EDUCATION_START_DATE", "EDUCATION_END_DATE", "EDUCATION_CURRENT",
    "PERSONAL_SUMMARY", "SKILLS"
]);

export function allowAiForSemanticKey(semanticKey, pack = {}) {
    const skip = new Set([...DEFAULT_SKIP_LLM_ON, ...(pack?.hotPath?.skipLlmOn || []), ...NEVER_AI_KEYS]);
    const key = String(semanticKey || "").toUpperCase();
    if (!key || key === "CUSTOM_FIELD") return true;
    return !skip.has(key);
}

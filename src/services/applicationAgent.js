export const AGENT_STATES = Object.freeze({
    PAGE_DETECTED: "PAGE_DETECTED",
    FORM_UNDERSTOOD: "FORM_UNDERSTOOD",
    PLAN_READY: "PLAN_READY",
    FILLING_VERIFIED_FIELDS: "FILLING_VERIFIED_FIELDS",
    TEACHING_UNKNOWN_FIELD: "TEACHING_UNKNOWN_FIELD",
    ASKING_CANDIDATE_QUESTION: "ASKING_CANDIDATE_QUESTION",
    VALIDATING_FORM: "VALIDATING_FORM",
    READY_FOR_REVIEW: "READY_FOR_REVIEW",
    SUBMISSION_DETECTED: "SUBMISSION_DETECTED",
    LOGIN_REQUIRED: "LOGIN_REQUIRED",
    CAPTCHA_REQUIRED: "CAPTCHA_REQUIRED",
    USER_ACTION_REQUIRED: "USER_ACTION_REQUIRED",
    UNKNOWN_FIELD: "UNKNOWN_FIELD",
    PORTAL_CHANGED: "PORTAL_CHANGED",
    BLOCKED_BY_ELIGIBILITY: "BLOCKED_BY_ELIGIBILITY"
});

export const QUESTION_TYPES = new Set(["CONFIRM_MAPPING", "ASK_VALUE", "CHOOSE_OPTION", "MANUAL_ACTION"]);
export const ANSWER_SCOPES = new Set(["APPLICATION_ONLY", "QUESTION_CATEGORY", "GLOBAL_FACT", "ROLE_SPECIFIC", "COMPANY_SPECIFIC", "STYLE_ONLY", "CANDIDATE_PROFILE", "REUSABLE_ANSWER_LIBRARY", "NEVER_PERSIST"]);

const PROTECTED = /password|passcode|one.?time|\botp\b|captcha|verification\s+(?:code|challenge)|cookie|upload|attachment|resume|cv\b|citizen|visa|work\s*authori[sz]ation|sponsor|criminal|conviction|veteran|medical|health|disability|race|ethnic|religion|gender|sexual|date of birth|dob\b|aadhaar|passport|social security|national id/i;
const LEGAL = /consent|privacy|terms|declaration|certif|signature|confirm.{0,25}(?:true|accurate)|agree.{0,25}(?:terms|policy)|authorize/i;
const VOLATILE = new Set(["START_DATE", "LAST_WORKING_DATE"]);
const PROFILE_KEYS = new Set([
    "PREFERRED_FIRST_NAME", "PREFERRED_LAST_NAME", "CURRENT_CTC", "EXPECTED_CTC", "NOTICE_PERIOD",
    "CURRENT_LOCATION", "PREFERRED_LOCATIONS", "POSTAL_CODE", "COUNTRY", "PHONE", "EMAIL", "LINKEDIN_URL",
    "PORTFOLIO_URL", "CURRENT_COMPANY", "RELOCATION"
]);
const APPLICATION_ONLY_KEYS = new Set(["CUSTOM_FIELD", "PRESENT_ADDRESS", "CURRENT_EMPLOYEE", "PREVIOUS_EMPLOYEE", "PREVIOUS_EMPLOYMENT_TYPE", "WORK_MODE_REQUIREMENT"]);

export function classifyAgentField(field = {}, semanticKey = "UNKNOWN") {
    const text = `${field.label || ""} ${field.name || ""} ${field.type || ""}`;
    if (LEGAL.test(text)) return { kind: "legal", scope: "NEVER_PERSIST", autoFill: false };
    if (PROTECTED.test(text) || ["password", "file"].includes(String(field.type || "").toLowerCase())) {
        return { kind: "sensitive", scope: "NEVER_PERSIST", autoFill: false };
    }
    if (VOLATILE.has(semanticKey)) return { kind: "volatile", scope: "APPLICATION_ONLY", autoFill: false };
    if (APPLICATION_ONLY_KEYS.has(semanticKey)) return { kind: "job-specific", scope: "APPLICATION_ONLY", autoFill: false };
    if (["checkbox", "checkbox-group"].includes(String(field.type || "").toLowerCase()) && /(?:no\s+travel|up\s+to\s+\d+%|travel)/i.test(text)) {
        return { kind: "job-specific", scope: "APPLICATION_ONLY", autoFill: false };
    }
    if (/why|cover|motivation|(?:salary|compensation) expectation.*(?:this|role)|available start/i.test(text)) {
        return { kind: "job-specific", scope: "APPLICATION_ONLY", autoFill: false };
    }
    if (PROFILE_KEYS.has(semanticKey)) return { kind: "stable", scope: "CANDIDATE_PROFILE", autoFill: true };
    return { kind: "stable", scope: "REUSABLE_ANSWER_LIBRARY", autoFill: true };
}

export function mappingPrompt(fieldLabel, semanticKey) {
    const label = semanticKey.split("_").map((word) => word.length <= 3 ? word : `${word[0]}${word.slice(1).toLowerCase()}`).join(" ");
    return `I found a required field labelled:\n“${fieldLabel}”\n\nDoes this field represent:\n“${label}”?`;
}

export function manualActionPrompt(fieldLabel) {
    return `This requires your direct confirmation on the employer form.\n\nField: “${fieldLabel}”`;
}

export function readinessStatus({ fields = [], resumeAttached = false, loginRequired = false, captchaRequired = false, portalChanged = false } = {}) {
    if (loginRequired) return { status: "LOGIN_REQUIRED", state: AGENT_STATES.LOGIN_REQUIRED };
    if (captchaRequired) return { status: "CAPTCHA_REQUIRED", state: AGENT_STATES.CAPTCHA_REQUIRED };
    if (portalChanged || !fields.length) return { status: "PORTAL_CHANGED", state: AGENT_STATES.PORTAL_CHANGED };
    const required = fields.filter((field) => field.visible !== false && field.required);
    const legal = required.find((field) => field.legal && !field.confirmed);
    if (legal) return { status: "USER_ACTION_REQUIRED", state: AGENT_STATES.USER_ACTION_REQUIRED, fieldId: legal.id };
    const unknown = required.find((field) => field.unknown || field.lowConfidence);
    if (unknown) return { status: "UNKNOWN_FIELD", state: AGENT_STATES.UNKNOWN_FIELD, fieldId: unknown.id };
    const invalid = required.find((field) => !field.filled || field.valid === false || field.exactOptionMatch === false);
    if (invalid) return { status: "WAITING_FOR_USER", state: AGENT_STATES.ASKING_CANDIDATE_QUESTION, fieldId: invalid.id };
    const resumeRequired = required.some((field) => field.type === "file" && /resume|cv/i.test(field.label || ""));
    if (resumeRequired && !resumeAttached) return { status: "WAITING_FOR_USER", state: AGENT_STATES.ASKING_CANDIDATE_QUESTION };
    return { status: "READY_TO_SUBMIT", state: AGENT_STATES.READY_FOR_REVIEW };
}

export function safeStructuralMapping(mapping = {}) {
    const allowed = ["id", "userId", "siteHost", "fieldSignature", "fieldLabel", "semanticKey", "status"];
    return Object.fromEntries(allowed.filter((key) => mapping[key] !== undefined).map((key) => [key, mapping[key]]));
}

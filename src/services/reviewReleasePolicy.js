const SECURITY_CHALLENGE = /password|passcode|one.?time|\botp\b|captcha|verification\s+(?:code|challenge)/i;
const GOVERNMENT_ID = /aadhaar|passport|social security|national id|government id|pan(?:\s+card|\s+number)?/i;
const LEGAL_ATTESTATION = /consent|privacy|terms|declaration|certif|signature|authorize|agree|acknowledge/i;
const DEMOGRAPHIC = /disability|race|ethnic|religion|gender|sexual orientation|veteran|medical|health/i;
const WORK_AUTHORIZATION = /citizen|visa|authori[sz]ed\s+to\s+work|work\s*authori[sz](?:ation|ed)|sponsor/i;
const PRIVATE_IDENTITY = /date of birth|\bdob\b|legal family name/i;

export const RELEASE_MODES = Object.freeze({
    SAFE_AUTOFILL: "SAFE_AUTOFILL",
    APPLICATION_REVIEW: "APPLICATION_REVIEW",
    USER_ACTION_ONLY: "USER_ACTION_ONLY",
    OPTIONAL_LEAVE_EMPTY: "OPTIONAL_LEAVE_EMPTY",
    NEVER_STORE_OR_FILL: "NEVER_STORE_OR_FILL"
});

export function releasePolicyForField(field = {}) {
    const text = `${field.semanticKey || ""} ${field.label || ""} ${field.name || ""} ${field.type || ""}`;
    if (SECURITY_CHALLENGE.test(text)) return { mode: RELEASE_MODES.NEVER_STORE_OR_FILL, category: "SECURITY_CHALLENGE", reason: "Authentication challenges must be completed directly by the candidate." };
    if (GOVERNMENT_ID.test(text)) return { mode: RELEASE_MODES.NEVER_STORE_OR_FILL, category: "GOVERNMENT_ID", reason: "Government identifiers are never stored or filled." };
    if (WORK_AUTHORIZATION.test(text)) return { mode: RELEASE_MODES.APPLICATION_REVIEW, category: "WORK_AUTHORIZATION", reason: "Authorization and sponsorship answers are volatile and employer-specific." };
    if (LEGAL_ATTESTATION.test(text) || field.legal) return { mode: RELEASE_MODES.USER_ACTION_ONLY, category: "LEGAL_ATTESTATION", reason: "The candidate must review the employer statement and act on the employer control." };
    if (DEMOGRAPHIC.test(text)) return { mode: field.required ? RELEASE_MODES.APPLICATION_REVIEW : RELEASE_MODES.OPTIONAL_LEAVE_EMPTY, category: "DEMOGRAPHIC", reason: "Optional demographic data defaults to empty; required questions are reviewed per application." };
    if (PRIVATE_IDENTITY.test(text) || field.sensitive) return { mode: RELEASE_MODES.APPLICATION_REVIEW, category: "PRIVATE_IDENTITY", reason: "Private identity data requires explicit review for this application." };
    return { mode: RELEASE_MODES.SAFE_AUTOFILL, category: "STANDARD", reason: "Verified non-sensitive profile facts may fill locally." };
}

export function buildFinalReviewChecklist(fields = []) {
    const items = fields.map((field) => ({
        fieldId: field.id,
        label: field.label,
        required: Boolean(field.required),
        ...releasePolicyForField(field)
    })).filter((item) => item.mode !== RELEASE_MODES.SAFE_AUTOFILL);
    const rank = {
        [RELEASE_MODES.NEVER_STORE_OR_FILL]: 0,
        [RELEASE_MODES.USER_ACTION_ONLY]: 1,
        [RELEASE_MODES.APPLICATION_REVIEW]: 2,
        [RELEASE_MODES.OPTIONAL_LEAVE_EMPTY]: 3
    };
    return {
        items: items.sort((a, b) => rank[a.mode] - rank[b.mode] || Number(b.required) - Number(a.required)),
        canReachFinalReview: !items.some((item) => item.required && item.mode === RELEASE_MODES.NEVER_STORE_OR_FILL),
        autoSubmits: false,
        storesRawValues: false
    };
}

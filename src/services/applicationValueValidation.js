const NAME_KEYS = new Set(["FIRST_NAME", "LAST_NAME", "PREFERRED_FIRST_NAME", "PREFERRED_LAST_NAME"]);
const URL_KEYS = new Set(["LINKEDIN_URL", "PORTFOLIO_URL", "GITHUB_URL", "WEBSITE_URL", "SOCIAL_FACEBOOK_URL", "SOCIAL_TWITTER_URL"]);
const DATE_KEYS = new Set(["EXPERIENCE_START_DATE", "EXPERIENCE_END_DATE", "EDUCATION_START_DATE", "EDUCATION_END_DATE"]);
const OPTION_TYPES = new Set(["select-one", "radio", "checkbox-group", "combobox"]);

function text(value) {
    return String(value ?? "").trim();
}

function normalized(value) {
    return text(value).toLowerCase().replace(/\s+/g, " ");
}

function optionValues(field = {}) {
    return (Array.isArray(field.options) ? field.options : [])
        .flatMap((option) => [option?.value, option?.label])
        .map(normalized)
        .filter(Boolean);
}

export function semanticValueMismatchReason(field = {}, resolved = {}) {
    const key = String(resolved.normalizedKey || "").toUpperCase();
    const value = text(resolved.answer);
    if (!value) return null;

    if (NAME_KEYS.has(key) && (/@|\d|https?:\/\//i.test(value) || value.length > 80 || value.split(/\s+/).length > 6)) {
        return "NAME_FORMAT";
    }
    if (key === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "EMAIL_FORMAT";
    if (key === "PHONE") {
        const digits = value.replace(/\D/g, "");
        if (/[A-Za-z@]/.test(value) || digits.length < 7 || digits.length > 15) return "PHONE_FORMAT";
    }
    if (key === "CURRENT_COMPANY" && (/@|https?:\/\/|linkedin\.com/i.test(value) || /^\+?[\d\s().-]{7,}$/.test(value))) {
        return "COMPANY_FORMAT";
    }
    if (URL_KEYS.has(key)) {
        try {
            const url = new URL(value);
            if (!["http:", "https:"].includes(url.protocol)) return "URL_FORMAT";
            if (key === "LINKEDIN_URL" && !/(^|\.)linkedin\.com$/i.test(url.hostname)) return "LINKEDIN_URL_FORMAT";
            if (key === "GITHUB_URL" && !/(^|\.)github\.com$/i.test(url.hostname)) return "GITHUB_URL_FORMAT";
            if (key === "SOCIAL_FACEBOOK_URL" && !/(^|\.)facebook\.com$/i.test(url.hostname)) return "FACEBOOK_URL_FORMAT";
            if (key === "SOCIAL_TWITTER_URL" && !/(^|\.)(?:x|twitter)\.com$/i.test(url.hostname)) return "TWITTER_URL_FORMAT";
        } catch {
            return "URL_FORMAT";
        }
    }
    if (DATE_KEYS.has(key) && !/^\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?$/.test(value)) return "DATE_FORMAT";
    if (OPTION_TYPES.has(String(field.type || "").toLowerCase()) && optionValues(field).length) {
        const requested = Array.isArray(resolved.answer)
            ? resolved.answer.map(normalized)
            : String(resolved.answer).split(/\s*(?:,|\||;)\s*/).map(normalized).filter(Boolean);
        if (!requested.length || requested.some((answer) => !optionValues(field).includes(answer))) return "OPTION_NOT_FOUND";
    }
    return null;
}

export function validateResolvedValue(field = {}, resolved = {}) {
    const reason = semanticValueMismatchReason(field, resolved);
    if (!reason) return { valid: true, resolved };
    return {
        valid: false,
        reason,
        resolved: {
            ...resolved,
            answer: null,
            confidence: 0,
            source: "VALUE_SEMANTIC_MISMATCH",
            evidence: "The available value did not match the current field semantics.",
            requiresUserInput: true
        }
    };
}

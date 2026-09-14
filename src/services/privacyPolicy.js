import { env } from "../config/environment.js";
import { currentPlan } from "./entitlements.js";

const DIRECT_IDENTIFIERS = new Set([
    "email", "phone", "postalCode", "country", "currentLocation",
    "legalFirstName", "legalMiddleName", "legalLastName",
    "addressLine1", "addressLine2", "addressCity", "addressState",
    "workAuthorization", "sponsorshipRequired"
]);
const SENSITIVE = /password|passcode|one.?time|\botp\b|captcha|verification\s+(?:code|challenge)|cookie|citizen|visa|work\s*authori[sz]ation|sponsor|criminal|conviction|veteran|medical|health|disability|race|ethnic|religion|gender|sexual|date of birth|dob\b|aadhaar|passport|social security|national id|consent|privacy|terms|declaration|certif|signature|authorize/i;

export function canUseAiProcessing(profile = {}) {
    return Boolean(env.privacy.aiProcessingEnabled && profile.aiProcessingConsent);
}

/** Side-panel toggle: use AI-generated leftover answers on employer forms. Paid gate is reserved. */
export function canUseAiApplicationAnswers(profile = {}) {
    if (!canUseAiProcessing(profile)) return false;
    const plan = currentPlan();
    if (plan.requirePaidForAiAnswers && plan.id === "FREE") return false;
    return true;
}

/**
 * Shared canonicalization receives only the value-free descriptor contract.
 * It is a platform-learning operation, not candidate-specific AI generation,
 * so Free and Paid users use the same gate and cache.
 */
export function canUseSharedCanonicalizationAi(field = {}) {
    return Boolean(env.canonicalization.aiEnabled
        && !isSensitiveApplicationField(field)
        && !field.legal
        && !field.sensitive
        && !field.skipLearning);
}

export function isSensitiveApplicationField(field = {}) {
    return SENSITIVE.test(`${field.label || ""} ${field.name || ""} ${field.type || ""}`);
}

export function minimizedProfileForAi(profile = {}) {
    return Object.fromEntries(Object.entries(profile).filter(([key]) => !DIRECT_IDENTIFIERS.has(key) && key !== "userId" && key !== "createdAt" && key !== "updatedAt"));
}

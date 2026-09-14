import { getDb } from "../database/connection.js";

export function freshnessProfile(profileKey) {
    if (!profileKey) return null;
    return getDb().prepare(`SELECT profile_key AS profileKey, max_age_days AS maxAgeDays,
        stale_behavior AS staleBehavior, description FROM canonical_answer_freshness_profiles
        WHERE profile_key = ?`).get(profileKey) || null;
}

export function validUntilForPolicy(policy, confirmedAt = new Date().toISOString()) {
    const profile = freshnessProfile(policy.freshnessProfile);
    if (!profile?.maxAgeDays) return null;
    const date = new Date(confirmedAt);
    if (Number.isNaN(date.getTime())) throw new Error("Invalid candidate confirmation time.");
    date.setUTCDate(date.getUTCDate() + Number(profile.maxAgeDays));
    return date.toISOString();
}

export function evaluateAnswerFreshness(policy, answerVersion, now = new Date()) {
    if (!answerVersion) return { usable: false, state: "MISSING", reasonCodes: ["CANDIDATE_TRUTH_MISSING"] };
    if (answerVersion.status !== "ACTIVE") return { usable: false, state: "INACTIVE", reasonCodes: ["ANSWER_VERSION_NOT_ACTIVE"] };
    const validUntil = answerVersion.validUntil || answerVersion.valid_until || null;
    if (!validUntil) return { usable: true, state: "FRESH", expiresAt: null, reasonCodes: ["NO_TIME_EXPIRY"] };
    const expiry = new Date(validUntil);
    const stale = Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime();
    return stale
        ? { usable: false, state: "STALE", expiresAt: validUntil, reasonCodes: ["ANSWER_REQUIRES_RECONFIRMATION"] }
        : { usable: true, state: "FRESH", expiresAt: validUntil, reasonCodes: ["ANSWER_WITHIN_FRESHNESS_WINDOW"] };
}

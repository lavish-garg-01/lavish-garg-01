import crypto from "node:crypto";
import { getDb } from "../database/connection.js";

const LOCAL_USER_ID = "local-user";

export const FACT_POLICIES = Object.freeze({
    CURRENT_CTC: { category: "COMPENSATION", valueType: "NUMBER", maxAgeDays: 180 },
    EXPECTED_CTC: { category: "COMPENSATION", valueType: "NUMBER", maxAgeDays: 90 },
    NOTICE_PERIOD: { category: "AVAILABILITY", valueType: "INTEGER", maxAgeDays: 30 },
    LAST_WORKING_DATE: { category: "AVAILABILITY", valueType: "DATE", maxAgeDays: 30 },
    START_DATE: { category: "AVAILABILITY", valueType: "DATE", maxAgeDays: 30, applicationOnly: true }
});

function profileValue(key, profile = {}) {
    return ({
        CURRENT_CTC: profile.currentCTC,
        EXPECTED_CTC: profile.expectedCTC,
        NOTICE_PERIOD: profile.noticePeriodDays,
        LAST_WORKING_DATE: profile.lastWorkingDate
    })[key];
}

function normalized(value) {
    return value == null ? "" : String(value).trim();
}

function expiry(verifiedAt, maxAgeDays) {
    const date = new Date(verifiedAt);
    date.setUTCDate(date.getUTCDate() + maxAgeDays);
    return date.toISOString();
}

export function saveCandidateFact({ semanticKey, value, source = "USER", candidateApproved = false, verifiedAt = new Date().toISOString(), factScope = "CANDIDATE_PROFILE" } = {}) {
    const key = String(semanticKey || "").toUpperCase();
    const policy = FACT_POLICIES[key];
    if (!policy) throw new Error("Unsupported candidate fact.");
    if (!candidateApproved) throw new Error("Candidate approval is required before saving this fact.");
    if (policy.applicationOnly && factScope !== "APPLICATION_ONLY") throw new Error("This availability answer may only be saved for one application.");
    const valueText = normalized(value);
    if (!valueText) throw new Error("Candidate fact value is required.");
    const validUntil = expiry(verifiedAt, policy.maxAgeDays);
    getDb().prepare(`
        INSERT INTO candidate_fact_memory
            (id, user_id, semantic_key, category, value_text, value_type, fact_scope, source,
             candidate_approved, verified_at, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(user_id, semantic_key, fact_scope) DO UPDATE SET
            value_text = excluded.value_text, value_type = excluded.value_type,
            category = excluded.category, source = excluded.source,
            candidate_approved = 1, verified_at = excluded.verified_at,
            valid_until = excluded.valid_until, updated_at = CURRENT_TIMESTAMP
    `).run(crypto.randomUUID(), LOCAL_USER_ID, key, policy.category, valueText, policy.valueType,
        factScope, String(source), verifiedAt, validUntil);
    return getCandidateFact(key, factScope);
}

export function getCandidateFact(semanticKey, factScope = "CANDIDATE_PROFILE") {
    return getDb().prepare(`
        SELECT semantic_key AS semanticKey, category, value_text AS value,
               value_type AS valueType, fact_scope AS factScope, source,
               candidate_approved AS candidateApproved, verified_at AS verifiedAt,
               valid_until AS validUntil, updated_at AS updatedAt
        FROM candidate_fact_memory WHERE user_id = ? AND semantic_key = ? AND fact_scope = ?
    `).get(LOCAL_USER_ID, String(semanticKey || "").toUpperCase(), factScope) || null;
}

export function candidateFactStatus(semanticKey, profile = {}, now = new Date()) {
    const key = String(semanticKey || "").toUpperCase();
    const policy = FACT_POLICIES[key];
    if (!policy) return { managed: false, usable: true, value: profileValue(key, profile) };
    if (policy.applicationOnly) return { managed: true, usable: false, stale: false, reason: "application_only" };
    const value = profileValue(key, profile);
    if (value == null || normalized(value) === "") return { managed: true, usable: false, stale: false, reason: "missing" };
    // Explicit in-memory profiles used by deterministic callers/tests do not
    // carry persistence timestamps. Treat their supplied value as current;
    // persisted production profiles always include updatedAt.
    if (!profile.updatedAt) return { managed: true, usable: true, stale: false, conflict: false, value };
    let fact = getCandidateFact(key);
    if (!fact) {
        const verifiedAt = profile.updatedAt || new Date(0).toISOString();
        fact = saveCandidateFact({ semanticKey: key, value, source: "LEGACY_PROFILE", candidateApproved: true, verifiedAt });
    }
    const conflict = normalized(fact.value) !== normalized(value);
    const stale = !fact.validUntil || new Date(fact.validUntil).getTime() < now.getTime();
    return {
        managed: true,
        usable: Boolean(fact.candidateApproved) && !stale && !conflict,
        stale,
        conflict,
        value: fact.value,
        reason: conflict ? "profile_conflict" : stale ? "stale" : null,
        fact
    };
}

export function syncCandidateFacts(previous = {}, next = {}) {
    const mappings = {
        CURRENT_CTC: "currentCTC",
        EXPECTED_CTC: "expectedCTC",
        NOTICE_PERIOD: "noticePeriodDays",
        LAST_WORKING_DATE: "lastWorkingDate"
    };
    for (const [semanticKey, property] of Object.entries(mappings)) {
        const value = next[property];
        if (value == null || normalized(value) === "" || normalized(previous[property]) === normalized(value)) continue;
        saveCandidateFact({ semanticKey, value, source: "PROFILE", candidateApproved: true });
    }
}

export function saveWritingStyleProfile({ roleCluster = "default", tone = "professional", maxWords = 150, traits = [], candidateApproved = false } = {}) {
    if (!candidateApproved) throw new Error("Candidate approval is required before saving writing style.");
    const safeTraits = [...new Set((Array.isArray(traits) ? traits : []).map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 12);
    getDb().prepare(`
        INSERT INTO writing_style_profiles
            (id, user_id, role_cluster, tone, max_words, traits_json, candidate_approved, approved_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, role_cluster) DO UPDATE SET
            tone = excluded.tone, max_words = excluded.max_words, traits_json = excluded.traits_json,
            candidate_approved = 1, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    `).run(crypto.randomUUID(), LOCAL_USER_ID, String(roleCluster).slice(0, 100), String(tone).slice(0, 50),
        Math.max(40, Math.min(500, Number(maxWords) || 150)), JSON.stringify(safeTraits));
    return getDb().prepare(`SELECT role_cluster AS roleCluster, tone, max_words AS maxWords,
        traits_json AS traitsJson, candidate_approved AS candidateApproved, approved_at AS approvedAt
        FROM writing_style_profiles WHERE user_id = ? AND role_cluster = ?`).get(LOCAL_USER_ID, roleCluster);
}

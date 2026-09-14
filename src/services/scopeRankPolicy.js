import { canonicalContractJson, stableContractHash } from "../contracts/contractPrimitives.js";

export const SCOPE_RANK_POLICY_VERSION = 1;

const DIMENSION_PROPERTIES = Object.freeze({
    APPLICATION_CONTENT_REVISION: "applicationContentRevision",
    APPLICATION: "application",
    COMPANY_GROUP: "companyGroup",
    COUNTRY: "country",
    ROLE_FAMILY: "roleFamily",
    LOCATION: "location",
    EMPLOYMENT_TYPE: "employmentType"
});

function cleanQualifiers(value = {}) {
    return Object.fromEntries(Object.entries(value)
        .filter(([, item]) => item !== null && item !== undefined && String(item).trim())
        .map(([key, item]) => [key, String(item).trim()]));
}

export function scopeQualifiersForPolicy(policy, requested = {}, normalizedContext = {}, { forWrite = false } = {}) {
    const supplied = cleanQualifiers(requested);
    const allowedDimensions = policy.scopePolicy === "APPLICATION"
        ? ["APPLICATION_CONTENT_REVISION", "APPLICATION"]
        : policy.scopeDimensions;
    const allowedProperties = new Set(allowedDimensions.map((dimension) => DIMENSION_PROPERTIES[dimension]));
    const unknownKeys = Object.keys(supplied).filter((key) => !allowedProperties.has(key));
    if (unknownKeys.length) return { ok: false, reasonCodes: ["SCOPE_DIMENSION_NOT_ALLOWED"], unknownKeys };

    const qualifiers = {};
    for (const dimension of allowedDimensions) {
        const property = DIMENSION_PROPERTIES[dimension];
        const requestedValue = supplied[property];
        const contextValue = normalizedContext[property];
        if (requestedValue && contextValue && requestedValue !== contextValue) {
            return { ok: false, reasonCodes: ["SCOPE_CONTEXT_CONFLICT"], conflictDimension: dimension };
        }
        if (requestedValue) qualifiers[property] = requestedValue;
    }
    if (policy.scopePolicy === "APPLICATION") {
        if (normalizedContext.applicationContentRevision) qualifiers.applicationContentRevision = normalizedContext.applicationContentRevision;
        else if (normalizedContext.application) qualifiers.application = normalizedContext.application;
    }
    for (const dimension of policy.requiredScopeDimensions || []) {
        const property = DIMENSION_PROPERTIES[dimension];
        const value = qualifiers[property] || normalizedContext[property];
        if (!value) return { ok: false, reasonCodes: ["REQUIRED_SCOPE_CONTEXT_MISSING"], missingDimension: dimension };
        qualifiers[property] = value;
    }
    if (policy.scopePolicy === "GLOBAL" && Object.keys(qualifiers).length) {
        return { ok: false, reasonCodes: ["GLOBAL_POLICY_FORBIDS_QUALIFIERS"] };
    }
    if (forWrite && policy.scopePolicy === "GLOBAL_WITH_OVERRIDES") {
        for (const [property, value] of Object.entries(qualifiers)) {
            if (normalizedContext[property] !== value) return { ok: false, reasonCodes: ["UNVERIFIED_SCOPE_QUALIFIER"] };
        }
    }
    const vector = scopeRankVector(policy, qualifiers);
    return {
        ok: true,
        qualifiers: Object.freeze(qualifiers),
        scopeHash: stableContractHash(qualifiers),
        rankVector: vector,
        scopeSpecificity: vector.reduce((sum, item) => sum + item, 0),
        reasonCodes: [Object.keys(qualifiers).length ? "CONTROLLED_SCOPE" : "GLOBAL_DEFAULT"]
    };
}

/** Ordered vector: application revision > application > policy-declared dimensions. */
export function scopeRankVector(policy, qualifiers = {}) {
    return [
        qualifiers.applicationContentRevision ? 1 : 0,
        qualifiers.application ? 1 : 0,
        ...(policy.scopeDimensions || []).map((dimension) => qualifiers[DIMENSION_PROPERTIES[dimension]] ? 1 : 0)
    ];
}

export function compareScopeRank(left = [], right = []) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const difference = Number(left[index] || 0) - Number(right[index] || 0);
        if (difference) return difference;
    }
    return 0;
}

export function scopeCompatible(qualifiers = {}, context = {}) {
    return Object.entries(qualifiers).every(([key, value]) => context[key] === value);
}

export function scopeDebugKey(qualifiers = {}) {
    return canonicalContractJson(qualifiers);
}

export function primarySharedScope(policy, qualifiers = {}) {
    if (qualifiers.applicationContentRevision) return { schemaVersion: 1, scopeType: "APPLICATION_CONTENT_REVISION", scopeKey: qualifiers.applicationContentRevision, rank: 100 };
    if (qualifiers.application) return { schemaVersion: 1, scopeType: "APPLICATION", scopeKey: qualifiers.application, rank: 95 };
    if (qualifiers.companyGroup) return { schemaVersion: 1, scopeType: "EMPLOYER_GROUP", scopeKey: qualifiers.companyGroup, rank: 90 };
    if (qualifiers.roleFamily) return { schemaVersion: 1, scopeType: "ROLE_FAMILY", scopeKey: qualifiers.roleFamily, rank: 80 };
    if (qualifiers.country) return { schemaVersion: 1, scopeType: "COUNTRY", scopeKey: qualifiers.country, rank: 75 };
    if (policy.scopePolicy === "APPLICATION") return { schemaVersion: 1, scopeType: "NONE", scopeKey: null, rank: 0 };
    return { schemaVersion: 1, scopeType: "CANDIDATE", scopeKey: null, rank: 50 };
}

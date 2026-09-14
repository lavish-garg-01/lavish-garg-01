import { getDb } from "../database/connection.js";
import { canonicalContractJson, stableContractHash } from "../contracts/contractPrimitives.js";
import { canonicalAnswerPolicySchema, CANONICAL_ANSWER_POLICY_VERSION } from "../contracts/canonicalAnswerPolicy.js";
import { ensureCanonicalDefinitions, listCanonicalDefinitions } from "../repositories/fieldSemanticRepository.js";
import { EMPLOYER_FIELD_ONTOLOGY } from "./fieldOntology.js";

export const ANSWER_POLICY_REGISTRY_VERSION = 2;

export const ANSWER_KINDS = Object.freeze([
    "STABLE_FACT", "MUTABLE_FACT", "PREFERENCE", "ENTITY_SCOPED_FACT", "CONTEXTUAL_ANSWER",
    "LEGAL_FACT", "APPLICATION_ACTION", "SUBMISSION_ACTION", "SECURITY_CHALLENGE"
]);
export const SCOPE_DIMENSIONS = Object.freeze([
    "APPLICATION_CONTENT_REVISION", "APPLICATION", "COMPANY_GROUP", "COUNTRY", "ROLE_FAMILY", "LOCATION", "EMPLOYMENT_TYPE"
]);

const IDENTITY = new Set([
    "LEGAL_FIRST_NAME", "LEGAL_MIDDLE_NAME", "LEGAL_LAST_NAME", "PREFERRED_FIRST_NAME", "PREFERRED_LAST_NAME",
    "FIRST_NAME", "LAST_NAME", "FULL_NAME", "EMAIL", "PHONE", "COUNTRY", "POSTAL_CODE", "ADDRESS_LINE1",
    "ADDRESS_LINE2", "ADDRESS_CITY", "ADDRESS_STATE", "CURRENT_LOCATION", "LINKEDIN_URL", "PORTFOLIO_URL",
    "GITHUB_URL", "WEBSITE_URL", "SOCIAL_FACEBOOK_URL", "SOCIAL_TWITTER_URL"
]);
const MUTABLE_EMPLOYMENT = new Set(["CURRENT_COMPANY", "CURRENT_CAREER_STAGE", "CURRENT_INDUSTRY"]);
const LEGAL_FACTS = new Set(["WORK_AUTHORIZATION", "SPONSORSHIP"]);
const ENTITY_FACTS = new Set(["CURRENT_EMPLOYEE", "PREVIOUS_EMPLOYEE", "PREVIOUS_EMPLOYMENT_TYPE"]);
const PREFERENCES = new Set(["EXPECTED_CTC", "RELOCATION", "PREFERRED_LOCATIONS"]);
const APPLICATION_ONLY = new Set(["WORK_MODE_REQUIREMENT", "START_DATE", "HEARING_SOURCE"]);
const WRITING = new Set(["COVER_LETTER"]);
const DERIVED = new Set(["TOTAL_EXPERIENCE", "SKILLS", "PERSONAL_SUMMARY"]);
const FILES = new Set(["RESUME"]);
const PROTECTED = new Set(["EEO_GENDER", "EEO_RACE", "EEO_VETERAN", "EEO_DISABILITY"]);

const VALUE_TYPES = Object.freeze({
    EMAIL: "STRING", PHONE: "PHONE", LINKEDIN_URL: "URL", PORTFOLIO_URL: "URL", GITHUB_URL: "URL",
    WEBSITE_URL: "URL", SOCIAL_FACEBOOK_URL: "URL", SOCIAL_TWITTER_URL: "URL",
    CURRENT_CTC: "MONEY", EXPECTED_CTC: "MONEY", NOTICE_PERIOD: "INTEGER", START_DATE: "DATE",
    TOTAL_EXPERIENCE: "DURATION", WORK_AUTHORIZATION: "BOOLEAN", SPONSORSHIP: "BOOLEAN",
    CURRENT_EMPLOYEE: "BOOLEAN", PREVIOUS_EMPLOYEE: "BOOLEAN", WORK_MODE_REQUIREMENT: "BOOLEAN",
    RELOCATION: "BOOLEAN", PREFERRED_LOCATIONS: "MULTI_ENUM", RESUME: "FILE_REF", COVER_LETTER: "RICH_TEXT", PERSONAL_SUMMARY: "RICH_TEXT",
    SKILLS: "MULTI_ENUM"
});

const FRESHNESS_PROFILES = Object.freeze([
    ["STABLE", null, "USE_UNTIL_CHANGED", "Long-lived candidate fact; dependency changes still invalidate it."],
    ["EMPLOYMENT", 180, "REVIEW", "Employment facts should be reconfirmed after six months."],
    ["CURRENT_COMPENSATION", 180, "REVIEW", "Current compensation should be reconfirmed after six months."],
    ["EXPECTED_COMPENSATION", 90, "REVIEW", "Compensation preferences should be reconfirmed every quarter."],
    ["NOTICE", 30, "REVIEW", "Notice and availability facts are short-lived."],
    ["LEGAL_FACT", 180, "REVIEW", "Legal screening facts require matching jurisdiction and periodic review."],
    ["DATE_SENSITIVE", 30, "REVIEW", "A date-sensitive answer should not be reused after one month."]
]);

const ANOMALY_PROFILES = Object.freeze([
    ["LOW_RISK_TEXT", { rejectBlank: true, maxLength: 4000 }, "QUIET_SUMMARY", "Basic shape checks for stable text facts."],
    ["EMPLOYMENT_CHANGE", { rejectBlank: true }, "PROMINENT_SUMMARY", "Employment changes affect dependent answers."],
    ["COMPENSATION", { rejectBlank: true, maxRatio: 5, minRatio: 0.2 }, "REVIEW_TO_SAVE", "Large compensation changes require review."],
    ["AVAILABILITY", { rejectNegative: true, maxValue: 365 }, "REVIEW_TO_SAVE", "Availability values must remain plausible."],
    ["LEGAL_FACT", { requireExplicitCandidateSource: true }, "REVIEW_TO_SAVE", "Legal facts require direct, scoped confirmation."],
    ["PROTECTED", {}, "HIDDEN", "Protected values cannot become candidate truth."]
]);

function valueType(key, canonical) {
    if (VALUE_TYPES[key]) return VALUE_TYPES[key];
    if (String(canonical.answerType || canonical.dataType).toUpperCase() === "ENUM") return "ENUM";
    if (/_DATE$/.test(key)) return "DATE";
    if (/_CURRENT$/.test(key)) return "BOOLEAN";
    return "STRING";
}

function base(canonical) {
    return {
        canonicalKey: canonical.key,
        answerKind: "CONTEXTUAL_ANSWER",
        valueType: valueType(canonical.key, canonical),
        questionFamily: canonical.semanticGroup || "application",
        scopePolicy: "APPLICATION",
        scopeDimensions: ["APPLICATION"],
        requiredScopeDimensions: ["APPLICATION"],
        reusePolicy: "ASK",
        learningMode: "NEVER",
        learningPresentation: "HIDDEN",
        anomalyProfile: "LOW_RISK_TEXT",
        autofillMode: "USER_ONLY",
        authorizationMode: "NONE",
        freshnessProfile: null,
        dependencyKeys: [],
        derivationPolicy: "NEVER_INFER",
        sensitivity: canonical.sensitivity === "SENSITIVE" ? "SENSITIVE" : "NORMAL",
        riskTier: "MEDIUM",
        reasonCode: "UNREVIEWED_CANONICAL_FAILS_CLOSED"
    };
}

/** Code-reviewed policy matrix. Unknown/proposed canonicals fail closed. */
export function policyDefinitionForCanonical(canonical) {
    const key = canonical.key;
    const policy = base(canonical);
    if (canonical.status === "PROPOSED") return policy;
    if (IDENTITY.has(key)) return {
        ...policy, answerKind: "STABLE_FACT", scopePolicy: "GLOBAL", scopeDimensions: [], requiredScopeDimensions: [],
        reusePolicy: "AUTO", learningMode: "AUTO_VERSION", learningPresentation: "QUIET_SUMMARY",
        autofillMode: "AUTO", freshnessProfile: "STABLE", derivationPolicy: "DETERMINISTIC_ONLY",
        sensitivity: /LEGAL_|EMAIL|PHONE|ADDRESS|POSTAL/.test(key) ? "PERSONAL" : "NORMAL", riskTier: "LOW",
        reasonCode: "STABLE_CANDIDATE_FACT"
    };
    if (MUTABLE_EMPLOYMENT.has(key)) return {
        ...policy, answerKind: "MUTABLE_FACT", scopePolicy: "GLOBAL", scopeDimensions: [], requiredScopeDimensions: [],
        reusePolicy: "AUTO_IF_FRESH", learningMode: "AUTO_VERSION", learningPresentation: "PROMINENT_SUMMARY",
        autofillMode: "AUTO", freshnessProfile: "EMPLOYMENT", anomalyProfile: "EMPLOYMENT_CHANGE",
        dependencyKeys: key === "CURRENT_COMPANY" ? [] : ["CURRENT_COMPANY"], derivationPolicy: "DETERMINISTIC_ONLY",
        riskTier: "MEDIUM", reasonCode: "MUTABLE_EMPLOYMENT_FACT"
    };
    if (key === "CURRENT_CTC") return {
        ...policy, answerKind: "MUTABLE_FACT", valueType: "MONEY", scopePolicy: "GLOBAL", scopeDimensions: [],
        requiredScopeDimensions: [], reusePolicy: "AUTO_IF_FRESH", learningMode: "EXPLICIT_CONFIRM",
        learningPresentation: "REVIEW_TO_SAVE", anomalyProfile: "COMPENSATION", autofillMode: "AUTO",
        freshnessProfile: "CURRENT_COMPENSATION", dependencyKeys: ["CURRENT_COMPANY"],
        sensitivity: "PERSONAL", riskTier: "HIGH", reasonCode: "FRESH_COMPENSATION_FACT"
    };
    if (key === "NOTICE_PERIOD") return {
        ...policy, answerKind: "MUTABLE_FACT", valueType: "INTEGER", scopePolicy: "GLOBAL", scopeDimensions: [],
        requiredScopeDimensions: [], reusePolicy: "AUTO_IF_FRESH", learningMode: "EXPLICIT_CONFIRM",
        learningPresentation: "REVIEW_TO_SAVE", anomalyProfile: "AVAILABILITY", autofillMode: "AUTO",
        freshnessProfile: "NOTICE", dependencyKeys: ["CURRENT_COMPANY"], riskTier: "MEDIUM",
        reasonCode: "FRESH_AVAILABILITY_FACT"
    };
    if (LEGAL_FACTS.has(key)) return {
        ...policy, answerKind: "LEGAL_FACT", valueType: "BOOLEAN", scopePolicy: "GLOBAL_WITH_OVERRIDES",
        scopeDimensions: ["COUNTRY"], requiredScopeDimensions: ["COUNTRY"], reusePolicy: "AUTO_IF_FRESH",
        learningMode: "EXPLICIT_CONFIRM", learningPresentation: "REVIEW_TO_SAVE", anomalyProfile: "LEGAL_FACT",
        autofillMode: "PREPARE_FOR_REVIEW", authorizationMode: "NONE", freshnessProfile: "LEGAL_FACT",
        derivationPolicy: "NEVER_INFER", sensitivity: "LEGAL", riskTier: "HIGH",
        reasonCode: "JURISDICTION_SCOPED_LEGAL_FACT"
    };
    if (PROTECTED.has(key) || canonical.sensitivity === "SENSITIVE") return {
        ...policy, answerKind: "SECURITY_CHALLENGE", scopePolicy: "APPLICATION", scopeDimensions: [],
        requiredScopeDimensions: [], reusePolicy: "NEVER", learningMode: "NEVER",
        anomalyProfile: "PROTECTED", autofillMode: "NEVER", authorizationMode: "USER_DIRECT",
        sensitivity: "SENSITIVE", riskTier: "PROHIBITED", reasonCode: "PROTECTED_OR_VOLUNTARY_VALUE"
    };
    if (ENTITY_FACTS.has(key)) return {
        ...policy, answerKind: "ENTITY_SCOPED_FACT", scopePolicy: "GLOBAL_WITH_OVERRIDES",
        scopeDimensions: ["COMPANY_GROUP"], requiredScopeDimensions: ["COMPANY_GROUP"],
        reusePolicy: "AUTO_IF_FRESH", learningMode: "EXPLICIT_CONFIRM", learningPresentation: "REVIEW_TO_SAVE",
        anomalyProfile: "LEGAL_FACT", autofillMode: "PREPARE_FOR_REVIEW", freshnessProfile: "EMPLOYMENT",
        derivationPolicy: "NEVER_INFER", sensitivity: "LEGAL", riskTier: "HIGH",
        reasonCode: "EXACT_EMPLOYER_GROUP_REQUIRED"
    };
    if (PREFERENCES.has(key)) return {
        ...policy, answerKind: "PREFERENCE", scopePolicy: "GLOBAL_WITH_OVERRIDES",
        scopeDimensions: key === "EXPECTED_CTC"
            ? ["COMPANY_GROUP", "ROLE_FAMILY", "COUNTRY"]
            : key === "RELOCATION" ? ["COMPANY_GROUP", "ROLE_FAMILY", "COUNTRY"]
                : ["ROLE_FAMILY", "COUNTRY"],
        requiredScopeDimensions: [], reusePolicy: "CONTEXTUAL", learningMode: "EXPLICIT_CONFIRM",
        learningPresentation: "REVIEW_TO_SAVE", anomalyProfile: key === "EXPECTED_CTC" ? "COMPENSATION" : "LOW_RISK_TEXT",
        autofillMode: "AUTO", freshnessProfile: key === "EXPECTED_CTC" ? "EXPECTED_COMPENSATION" : "STABLE",
        derivationPolicy: "NEVER_INFER", riskTier: key === "EXPECTED_CTC" ? "HIGH" : "MEDIUM",
        reasonCode: "CONTEXTUAL_PREFERENCE_WITH_GLOBAL_DEFAULT"
    };
    if (APPLICATION_ONLY.has(key)) return {
        ...policy, answerKind: "CONTEXTUAL_ANSWER", scopePolicy: "APPLICATION", scopeDimensions: ["APPLICATION"],
        requiredScopeDimensions: ["APPLICATION"], reusePolicy: "ASK", learningMode: "NEVER",
        learningPresentation: "HIDDEN", autofillMode: key === "HEARING_SOURCE" ? "PREPARE_FOR_REVIEW" : "USER_ONLY",
        freshnessProfile: key === "START_DATE" ? "DATE_SENSITIVE" : null, riskTier: "MEDIUM",
        reasonCode: "APPLICATION_CONTEXT_ONLY"
    };
    if (WRITING.has(key)) return {
        ...policy, answerKind: "CONTEXTUAL_ANSWER", valueType: "RICH_TEXT", scopePolicy: "APPLICATION",
        scopeDimensions: ["APPLICATION"], requiredScopeDimensions: ["APPLICATION"], reusePolicy: "GENERATE",
        learningMode: "NEVER", learningPresentation: "HIDDEN", autofillMode: "PREPARE_FOR_REVIEW",
        derivationPolicy: "GROUNDED_GENERATION", riskTier: "MEDIUM", reasonCode: "JOB_GROUNDED_WRITING"
    };
    if (DERIVED.has(key) || /^EXPERIENCE_|^EDUCATION_/.test(key)) return {
        ...policy, answerKind: "STABLE_FACT", scopePolicy: "GLOBAL", scopeDimensions: [], requiredScopeDimensions: [],
        reusePolicy: "AUTO", learningMode: "AUTO_VERSION", learningPresentation: "QUIET_SUMMARY",
        autofillMode: "AUTO", freshnessProfile: "STABLE", derivationPolicy: "DETERMINISTIC_ONLY",
        riskTier: "LOW", reasonCode: "VERIFIED_RESUME_OR_DERIVED_FACT"
    };
    if (FILES.has(key)) return {
        ...policy, answerKind: "STABLE_FACT", valueType: "FILE_REF", scopePolicy: "GLOBAL", scopeDimensions: [],
        requiredScopeDimensions: [], reusePolicy: "AUTO", learningMode: "EXPLICIT_CONFIRM",
        learningPresentation: "QUIET_SUMMARY", autofillMode: "AUTO", freshnessProfile: "STABLE",
        derivationPolicy: "NEVER_INFER", riskTier: "MEDIUM", reasonCode: "CANDIDATE_SELECTED_DOCUMENT"
    };
    return policy;
}

function parseJson(value, fallback) {
    try { return JSON.parse(value || "") ?? fallback; } catch { return fallback; }
}

function publicPolicy(row) {
    if (!row) return null;
    return {
        registryVersion: ANSWER_POLICY_REGISTRY_VERSION,
        canonicalKey: row.canonical_key,
        policyVersion: Number(row.policy_version),
        answerKind: row.answer_kind,
        valueType: row.value_type,
        questionFamily: row.question_family,
        scopePolicy: row.scope_policy,
        scopeDimensions: parseJson(row.scope_dimensions_json, []),
        requiredScopeDimensions: parseJson(row.required_scope_dimensions_json, []),
        reusePolicy: row.reuse_policy,
        learningMode: row.learning_mode,
        learningPresentation: row.learning_presentation,
        anomalyProfile: row.anomaly_profile,
        autofillMode: row.autofill_mode,
        authorizationMode: row.authorization_mode,
        freshnessProfile: row.freshness_profile,
        dependencyKeys: parseJson(row.dependency_keys_json, []),
        derivationPolicy: row.derivation_policy,
        sensitivity: row.sensitivity,
        riskTier: row.risk_tier,
        reasonCode: row.reason_code,
        configHash: row.config_hash,
        createdSource: row.created_source,
        createdAt: row.created_at
    };
}

function insertProfiles(db) {
    const freshness = db.prepare(`INSERT OR IGNORE INTO canonical_answer_freshness_profiles
        (profile_key, max_age_days, stale_behavior, description) VALUES (?, ?, ?, ?)`);
    for (const row of FRESHNESS_PROFILES) freshness.run(...row);
    const anomaly = db.prepare(`INSERT OR IGNORE INTO canonical_answer_anomaly_profiles
        (profile_key, rules_json, default_presentation, description) VALUES (?, ?, ?, ?)`);
    for (const [key, rules, presentation, description] of ANOMALY_PROFILES) {
        anomaly.run(key, JSON.stringify(rules), presentation, description);
    }
}

export function ensureAnswerPolicyRegistry() {
    ensureCanonicalDefinitions(EMPLOYER_FIELD_ONTOLOGY);
    const db = getDb();
    insertProfiles(db);
    const canonicals = listCanonicalDefinitions({ includeProposed: true });
    const insertPolicy = db.prepare(`INSERT INTO canonical_answer_policies
        (canonical_key, policy_version, answer_kind, value_type, question_family, scope_policy,
         scope_dimensions_json, required_scope_dimensions_json, reuse_policy, learning_mode,
         learning_presentation, anomaly_profile, autofill_mode, authorization_mode, freshness_profile,
         dependency_keys_json, derivation_policy, sensitivity, risk_tier, reason_code, config_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const activate = db.prepare(`INSERT INTO canonical_answer_policy_active
        (canonical_key, policy_version, activated_by, activated_at) VALUES (?, ?, 'CODE_REVIEWED_SEED', CURRENT_TIMESTAMP)
        ON CONFLICT(canonical_key) DO UPDATE SET policy_version = excluded.policy_version,
            activated_by = excluded.activated_by, activated_at = CURRENT_TIMESTAMP`);
    const write = db.transaction(() => {
        for (const canonical of canonicals) {
            const definition = policyDefinitionForCanonical(canonical);
            const configuration = { ...definition, registryVersion: ANSWER_POLICY_REGISTRY_VERSION };
            const configHash = stableContractHash(configuration);
            const existing = db.prepare(`SELECT policy_version FROM canonical_answer_policies
                WHERE canonical_key = ? AND config_hash = ?`).get(canonical.key, configHash);
            let policyVersion = Number(existing?.policy_version || 0);
            if (!policyVersion) {
                policyVersion = Number(db.prepare(`SELECT COALESCE(MAX(policy_version), 0) + 1 AS version
                    FROM canonical_answer_policies WHERE canonical_key = ?`).get(canonical.key).version);
                insertPolicy.run(canonical.key, policyVersion, definition.answerKind, definition.valueType,
                    definition.questionFamily, definition.scopePolicy, JSON.stringify(definition.scopeDimensions),
                    JSON.stringify(definition.requiredScopeDimensions), definition.reusePolicy, definition.learningMode,
                    definition.learningPresentation, definition.anomalyProfile, definition.autofillMode,
                    definition.authorizationMode, definition.freshnessProfile, JSON.stringify(definition.dependencyKeys),
                    definition.derivationPolicy, definition.sensitivity, definition.riskTier, definition.reasonCode, configHash);
            }
            activate.run(canonical.key, policyVersion);
        }
    });
    write();
    return { canonicalCount: canonicals.length, policyCount: Number(db.prepare("SELECT COUNT(*) AS count FROM active_canonical_answer_policies").get().count) };
}

export function getActiveAnswerPolicy(canonicalKey) {
    const key = String(canonicalKey || "").trim().toUpperCase();
    const db = getDb();
    let row = db.prepare("SELECT * FROM active_canonical_answer_policies WHERE canonical_key = ?").get(key);
    // The hot path is read-only after bootstrap. Reconcile only when a new canonical has no policy yet.
    if (!row) {
        ensureAnswerPolicyRegistry();
        row = db.prepare("SELECT * FROM active_canonical_answer_policies WHERE canonical_key = ?").get(key);
    }
    return publicPolicy(row);
}

export function listActiveAnswerPolicies(canonicalKeys = null) {
    const db = getDb();
    const keys = Array.isArray(canonicalKeys) ? [...new Set(canonicalKeys.map((key) => String(key).trim().toUpperCase()).filter(Boolean))] : [];
    const activeCount = Number(db.prepare("SELECT COUNT(*) AS count FROM active_canonical_answer_policies").get().count);
    if (!activeCount || (keys.length && Number(db.prepare(`SELECT COUNT(*) AS count FROM active_canonical_answer_policies
        WHERE canonical_key IN (${keys.map(() => "?").join(",")})`).get(...keys).count) !== keys.length)) {
        ensureAnswerPolicyRegistry();
    }
    const rows = keys.length
        ? db.prepare(`SELECT * FROM active_canonical_answer_policies WHERE canonical_key IN (${keys.map(() => "?").join(",")}) ORDER BY canonical_key`).all(...keys)
        : db.prepare("SELECT * FROM active_canonical_answer_policies ORDER BY canonical_key").all();
    return rows.map(publicPolicy);
}

export function answerPolicyDiagnostics() {
    const db = getDb();
    const policyCount = Number(db.prepare("SELECT COUNT(*) AS count FROM active_canonical_answer_policies").get().count);
    const seeded = policyCount ? {
        canonicalCount: Number(db.prepare("SELECT COUNT(*) AS count FROM canonical_fields WHERE status NOT IN ('REJECTED','MERGED')").get().count),
        policyCount
    } : ensureAnswerPolicyRegistry();
    const byKind = db.prepare("SELECT answer_kind AS answerKind, COUNT(*) AS count FROM active_canonical_answer_policies GROUP BY answer_kind ORDER BY answer_kind").all();
    const byDecision = db.prepare(`SELECT reuse_policy AS reusePolicy, learning_mode AS learningMode,
        autofill_mode AS autofillMode, COUNT(*) AS count FROM active_canonical_answer_policies
        GROUP BY reuse_policy, learning_mode, autofill_mode ORDER BY count DESC`).all();
    const missing = db.prepare(`SELECT c.key, c.label FROM canonical_fields c LEFT JOIN canonical_answer_policy_active a
        ON a.canonical_key = c.key WHERE c.status NOT IN ('REJECTED','MERGED') AND a.canonical_key IS NULL ORDER BY c.key`).all();
    return { registryVersion: ANSWER_POLICY_REGISTRY_VERSION, ...seeded, byKind, byDecision, missingPolicies: missing };
}

/** Narrow Phase 0B summary for the extension cache; full policy remains server-owned. */
export function sharedAnswerPolicy(policy, scope) {
    const answerClass = policy.answerKind === "CONTEXTUAL_ANSWER" ? "WRITING"
        : policy.answerKind === "APPLICATION_ACTION" ? "DECLARATION"
            : ["SUBMISSION_ACTION", "SECURITY_CHALLENGE"].includes(policy.answerKind) ? "PROTECTED"
                : policy.answerKind === "LEGAL_FACT" ? "MUTABLE_FACT" : policy.answerKind;
    const reuseDecision = policy.learningMode === "AUTO_VERSION" ? "AUTO_VERSION"
        : policy.learningMode === "EXPLICIT_CONFIRM" ? "REVIEW_TO_SAVE"
            : policy.answerKind === "APPLICATION_ACTION" ? "APPLICATION_AUTHORIZATION"
                : policy.scopePolicy === "APPLICATION" ? "APPLICATION_ONLY" : "NEVER_LEARN";
    const freshness = policy.freshnessProfile
        ? getDb().prepare("SELECT max_age_days FROM canonical_answer_freshness_profiles WHERE profile_key = ?").get(policy.freshnessProfile)?.max_age_days ?? null
        : null;
    return canonicalAnswerPolicySchema.parse({
        schemaVersion: CANONICAL_ANSWER_POLICY_VERSION,
        policyVersion: policy.policyVersion,
        canonicalKey: policy.canonicalKey,
        answerClass,
        reuseDecision,
        defaultScope: scope,
        freshnessDays: freshness,
        autofill: policy.autofillMode === "AUTO" ? "ALLOWED"
            : policy.autofillMode === "PREPARE_FOR_REVIEW" ? "REVIEW"
                : policy.authorizationMode !== "NONE" ? "APPLICATION_GESTURE" : "FORBIDDEN",
        learningCommitPoint: policy.learningMode === "AUTO_VERSION" ? "VERIFIED_SUBMISSION"
            : policy.learningMode === "EXPLICIT_CONFIRM" ? "EXPLICIT_SAVE" : null,
        reasonCode: policy.reasonCode
    });
}

export function policyConfigurationJson(policy) {
    return canonicalContractJson(policy);
}

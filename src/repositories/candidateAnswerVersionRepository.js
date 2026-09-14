import crypto from "node:crypto";
import { getDb } from "../database/connection.js";
import { canonicalContractJson, stableContractHash } from "../contracts/contractPrimitives.js";
import { normalizedValueSchema } from "../contracts/normalizedValue.js";
import { getActiveAnswerPolicy, listActiveAnswerPolicies } from "../services/answerPolicyRegistry.js";
import { normalizeAnswerContext } from "../services/answerContextNormalization.js";
import {
    compareScopeRank, scopeCompatible, scopeQualifiersForPolicy
} from "../services/scopeRankPolicy.js";
import { evaluateAnswerFreshness, validUntilForPolicy } from "../services/candidateAnswerFreshness.js";
import { evaluateAnswerAnomaly } from "../services/candidateAnswerAnomaly.js";
import { scopedCandidateAnswerLearningPolicy } from "../services/scopedCandidateAnswerLearning.js";

const ALLOWED_SOURCES = new Set([
    "PROFILE", "VERIFIED_RESUME", "DERIVED", "USER_ENTERED", "EXPLICIT_SAVE", "APPROVED_MEMORY", "MIGRATED_LEGACY",
    "USER_UNDO", "USER_RESTORE"
]);
const EXPLICIT_LEGAL_SOURCES = new Set([
    "PROFILE", "USER_ENTERED", "EXPLICIT_SAVE", "APPROVED_MEMORY", "USER_UNDO", "USER_RESTORE"
]);

const VALUE_KIND_BY_POLICY = Object.freeze({
    STRING: ["STRING"], BOOLEAN: ["BOOLEAN"], DATE: ["DATE"], MONEY: ["MONEY"], PHONE: ["PHONE"],
    ENUM: ["ENUM"], RICH_TEXT: ["RICH_TEXT"], DURATION: ["DURATION"], INTEGER: ["INTEGER"], URL: ["URL"],
    FILE_REF: ["FILE_REF"], MULTI_ENUM: ["MULTI_ENUM"]
});

export class CandidateAnswerConflictError extends Error {
    constructor(message = "Candidate answer changed in another tab or device.") {
        super(message);
        this.name = "CandidateAnswerConflictError";
        this.code = "ANSWER_VERSION_CONFLICT";
        this.status = 409;
    }
}

function parseJson(value, fallback) {
    try { return JSON.parse(value || "") ?? fallback; } catch { return fallback; }
}

function publicVersion(row) {
    if (!row) return null;
    return {
        id: row.id,
        userId: row.user_id,
        canonicalKey: row.canonical_key,
        scopeQualifiers: parseJson(row.scope_qualifiers_json, {}),
        scopeHash: row.scope_hash,
        scopeRank: parseJson(row.scope_rank_json, []),
        scopeSpecificity: Number(row.scope_specificity || 0),
        normalizedValue: parseJson(row.value_json, null),
        normalizedHash: row.normalized_hash,
        source: row.source,
        sourceVersionId: row.source_version_id || null,
        status: row.status,
        learningState: row.learning_state || "TRUSTED",
        originKind: row.origin_kind || "EXISTING_TRUTH",
        restoresVersionId: row.restores_version_id || null,
        evidenceScore: Number(row.evidence_score || 0),
        evidenceObservations: Number(row.evidence_observations || 0),
        policyVersion: Number(row.policy_version),
        confirmedAt: row.confirmed_at || null,
        validUntil: row.valid_until || null,
        invalidatedAt: row.invalidated_at || null,
        invalidationReason: row.invalidation_reason || null,
        supersedesId: row.supersedes_id || null,
        rowVersion: Number(row.row_version),
        createdAt: row.created_at
    };
}

function assertValueMatchesPolicy(policy, value) {
    const parsed = normalizedValueSchema.parse(value);
    const allowedKinds = VALUE_KIND_BY_POLICY[policy.valueType] || [];
    if (!allowedKinds.includes(parsed.kind)) {
        const error = new Error(`Expected ${policy.valueType} candidate truth for ${policy.canonicalKey}.`);
        error.code = "ANSWER_VALUE_TYPE_MISMATCH";
        throw error;
    }
    return parsed;
}

export function getActiveCandidateAnswerVersion(userId, canonicalKey, scopeHash) {
    return publicVersion(getDb().prepare(`SELECT * FROM candidate_answer_versions
        WHERE user_id = ? AND canonical_key = ? AND scope_hash = ? AND status = 'ACTIVE'`)
        .get(String(userId), String(canonicalKey).toUpperCase(), scopeHash));
}

export function getCandidateAnswerVersion(userId, versionId) {
    return publicVersion(getDb().prepare(`SELECT * FROM candidate_answer_versions
        WHERE user_id = ? AND id = ?`).get(String(userId), String(versionId)));
}

export function candidateAnswerContextFromScopeQualifiers(qualifiers = {}) {
    return {
        ...(qualifiers.applicationContentRevision ? { applicationContentRevisionId: qualifiers.applicationContentRevision } : {}),
        ...(qualifiers.application ? { applicationId: qualifiers.application } : {}),
        ...(qualifiers.companyGroup ? { employerGroupId: qualifiers.companyGroup } : {}),
        ...(qualifiers.country ? { countryCode: qualifiers.country } : {}),
        ...(qualifiers.roleFamily ? { roleFamily: qualifiers.roleFamily } : {}),
        ...(qualifiers.location ? { location: qualifiers.location } : {}),
        ...(qualifiers.employmentType ? { employmentType: qualifiers.employmentType } : {})
    };
}

export function listCandidateAnswerVersions(userId, { canonicalKey = null, includeInactive = true } = {}) {
    const clauses = ["user_id = ?"];
    const values = [String(userId)];
    if (canonicalKey) { clauses.push("canonical_key = ?"); values.push(String(canonicalKey).toUpperCase()); }
    if (!includeInactive) clauses.push("status = 'ACTIVE'");
    return getDb().prepare(`SELECT * FROM candidate_answer_versions WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC, id DESC`).all(...values).map(publicVersion);
}

function dependentCanonicals(db, dependencyKey) {
    return db.prepare(`SELECT DISTINCT canonical_key FROM active_canonical_answer_policies p,
        json_each(p.dependency_keys_json) dependency WHERE dependency.value = ?`)
        .all(dependencyKey).map((row) => row.canonical_key);
}

function invalidateDependents(db, { userId, dependencyKey, sourceVersionId, reasonCode, excludeCanonicals = [] }) {
    const exclusions = new Set((Array.isArray(excludeCanonicals) ? excludeCanonicals : [])
        .map((key) => String(key).trim().toUpperCase()).filter(Boolean));
    const dependents = dependentCanonicals(db, dependencyKey).filter((key) => !exclusions.has(key));
    let invalidatedCount = 0;
    if (dependents.length) {
        invalidatedCount = db.prepare(`UPDATE candidate_answer_versions SET status = 'INVALIDATED',
            invalidated_at = CURRENT_TIMESTAMP, invalidation_reason = ?
            WHERE user_id = ? AND status = 'ACTIVE'
              AND canonical_key IN (${dependents.map(() => "?").join(",")})`)
            .run(String(reasonCode).slice(0, 120), String(userId), ...dependents).changes;
    }
    const eventId = crypto.randomUUID();
    db.prepare(`INSERT INTO candidate_answer_dependency_events
        (id, user_id, dependency_key, source_version_id, reason_code, invalidated_count)
        VALUES (?, ?, ?, ?, ?, ?)`).run(eventId, String(userId), dependencyKey, sourceVersionId,
        String(reasonCode).slice(0, 120), invalidatedCount);
    return { id: eventId, dependencyKey, invalidatedCount, dependentCanonicals: dependents };
}

export function recordCandidateDependencyChange({ userId, dependencyKey, sourceVersionId = null,
    reasonCode = "DEPENDENCY_CHANGED" } = {}) {
    const key = String(dependencyKey || "").trim().toUpperCase();
    if (!userId || !key) throw new Error("Candidate and dependency key are required.");
    const db = getDb();
    return db.transaction(() => invalidateDependents(db, {
        userId, dependencyKey: key, sourceVersionId, reasonCode
    }))();
}

/**
 * Transaction-aware candidate-truth writer. Callers must execute this inside
 * a database transaction; the public single-version wrapper below supplies
 * one, while change sets reuse the same transaction for every item.
 */
export function saveCandidateAnswerVersionInTransaction(db, { userId, canonicalKey, normalizedValue, context = {}, scopeQualifiers = {},
    source = "EXPLICIT_SAVE", sourceVersionId = null, expectedActiveVersionId = null, idempotencyKey,
    confirmedAt = null, candidateApproved = false, dependencyInvalidationExcludeCanonicals = [],
    learningState = "TRUSTED", originKind = "EXISTING_TRUTH", restoresVersionId = null,
    activate = true, inactiveReason = null } = {}) {
    if (!userId) throw new Error("Candidate identity is required.");
    if (!candidateApproved) throw new Error("Explicit candidate approval is required to save candidate truth.");
    if (!idempotencyKey || String(idempotencyKey).length > 160) throw new Error("A bounded idempotency key is required.");
    const key = String(canonicalKey || "").trim().toUpperCase();
    const policy = getActiveAnswerPolicy(key);
    if (!policy) throw new Error("No active candidate-answer policy exists for this canonical.");
    if (policy.learningMode === "NEVER" || ["APPLICATION_ACTION", "SUBMISSION_ACTION", "SECURITY_CHALLENGE"].includes(policy.answerKind)) {
        const error = new Error("This field is not allowed in reusable candidate truth.");
        error.code = "ANSWER_POLICY_FORBIDS_PERSISTENCE";
        throw error;
    }
    const safeSource = String(source || "").trim().toUpperCase();
    if (!ALLOWED_SOURCES.has(safeSource)) throw new Error("Unsupported candidate truth source.");
    const safeLearningState = String(learningState || "").trim().toUpperCase();
    if (!new Set(["REVIEW", "TRUSTED", "REMOVED"]).has(safeLearningState)) {
        throw new Error("Unsupported candidate-answer learning state.");
    }
    if (activate === false && safeLearningState !== "REMOVED") {
        throw new Error("Only a removed scoped answer may be written inactive.");
    }
    const safeOrigin = String(originKind || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 80);
    if (!safeOrigin) throw new Error("Candidate-answer origin is required.");
    if (policy.anomalyProfile === "LEGAL_FACT" && !EXPLICIT_LEGAL_SOURCES.has(safeSource)) {
        const error = new Error("Legal and employer-scoped facts require a direct candidate source.");
        error.code = "ANSWER_SOURCE_REQUIRES_CANDIDATE";
        throw error;
    }
    const confirmationTime = confirmedAt ? new Date(confirmedAt) : new Date();
    if (Number.isNaN(confirmationTime.getTime()) || confirmationTime.getTime() > Date.now() + 5 * 60 * 1000) {
        const error = new Error("Candidate confirmation time is invalid or in the future.");
        error.code = "ANSWER_CONFIRMATION_TIME_INVALID";
        throw error;
    }
    const value = assertValueMatchesPolicy(policy, normalizedValue);
    const normalizedContext = normalizeAnswerContext(context, { policy });
    if (!normalizedContext.ok) {
        const error = new Error(`Required answer context is unknown: ${normalizedContext.unknownDimensions.join(", ")}.`);
        error.code = "ANSWER_CONTEXT_UNKNOWN";
        throw error;
    }
    const scope = scopeQualifiersForPolicy(policy, scopeQualifiers, normalizedContext.context, { forWrite: true });
    if (!scope.ok) {
        const error = new Error(scope.reasonCodes[0] || "Candidate answer scope is invalid.");
        error.code = "ANSWER_SCOPE_INVALID";
        throw error;
    }
    const payloadHash = stableContractHash({
        key, value, scope: scope.qualifiers, policyVersion: policy.policyVersion, source: safeSource,
        sourceVersionId, expectedActiveVersionId, confirmedAt: confirmedAt ? confirmationTime.toISOString() : null,
        learningState: safeLearningState, originKind: safeOrigin, restoresVersionId, activate: Boolean(activate)
    });
    const receipt = db.prepare("SELECT * FROM candidate_answer_write_receipts WHERE user_id = ? AND idempotency_key = ?")
        .get(String(userId), String(idempotencyKey));
    if (receipt) {
        if (receipt.payload_hash !== payloadHash) throw new CandidateAnswerConflictError("Idempotency key was reused with different candidate truth.");
        return {
            ...publicVersion(db.prepare("SELECT * FROM candidate_answer_versions WHERE id = ?").get(receipt.answer_version_id)),
            anomaly: { allowed: true, suspicious: false, presentation: policy.learningPresentation,
                reasonCodes: ["IDEMPOTENT_REPLAY"] },
            dependencyInvalidations: 0,
            idempotentReplay: true
        };
    }
    const currentRow = db.prepare(`SELECT * FROM candidate_answer_versions WHERE user_id = ?
        AND canonical_key = ? AND scope_hash = ? AND status = 'ACTIVE'`)
        .get(String(userId), key, scope.scopeHash);
    if (currentRow && currentRow.id !== expectedActiveVersionId) throw new CandidateAnswerConflictError();
    if (!currentRow && expectedActiveVersionId) throw new CandidateAnswerConflictError("The expected candidate answer version is no longer active.");
    if (restoresVersionId) {
        const restored = db.prepare("SELECT id FROM candidate_answer_versions WHERE id = ? AND user_id = ?")
            .get(String(restoresVersionId), String(userId));
        if (!restored) {
            const error = new Error("The restored candidate-answer version does not belong to this candidate.");
            error.code = "RESTORE_VERSION_NOT_FOUND";
            throw error;
        }
    }
    const previousValue = currentRow ? parseJson(currentRow.value_json, null) : null;
    const anomaly = evaluateAnswerAnomaly(policy, value, previousValue);
    if (!anomaly.allowed) {
        const error = new Error("Candidate truth failed deterministic anomaly checks.");
        error.code = "ANSWER_ANOMALY_REJECTED";
        error.reasonCodes = anomaly.reasonCodes;
        throw error;
    }
    const answerId = crypto.randomUUID();
    const validUntil = validUntilForPolicy(policy, confirmationTime.toISOString());
    const rowVersion = Number(currentRow?.row_version || 0) + 1;
    const valueJson = canonicalContractJson(value);
    if (currentRow) {
        const changed = db.prepare("UPDATE candidate_answer_versions SET status = 'SUPERSEDED' WHERE id = ? AND status = 'ACTIVE'")
            .run(currentRow.id).changes;
        if (!changed) throw new CandidateAnswerConflictError();
    }
    db.prepare(`INSERT INTO candidate_answer_versions
        (id, user_id, canonical_key, scope_qualifiers_json, scope_hash, scope_rank_json, scope_specificity,
         value_json, normalized_hash, source, source_version_id, status, policy_version, confirmed_at,
         valid_until, supersedes_id, row_version, learning_state, origin_kind, restores_version_id,
         invalidated_at, invalidation_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(answerId, String(userId), key, canonicalContractJson(scope.qualifiers), scope.scopeHash,
            canonicalContractJson(scope.rankVector), scope.scopeSpecificity, valueJson, stableContractHash(value),
            safeSource, sourceVersionId, activate === false ? "INVALIDATED" : "ACTIVE", policy.policyVersion,
            confirmationTime.toISOString(), validUntil, currentRow?.id || null, rowVersion,
            safeLearningState, safeOrigin, restoresVersionId,
            activate === false ? confirmationTime.toISOString() : null,
            activate === false ? String(inactiveReason || "SCOPED_ANSWER_REMOVED").slice(0, 120) : null);
    db.prepare(`INSERT INTO candidate_answer_write_receipts
        (user_id, idempotency_key, payload_hash, answer_version_id) VALUES (?, ?, ?, ?)`)
        .run(String(userId), String(idempotencyKey), payloadHash, answerId);
    // Truth version, supersession, receipt, and dependent invalidation join the
    // caller's transaction, including a multi-item learning change set.
    const dependency = invalidateDependents(db, { userId, dependencyKey: key, sourceVersionId: answerId,
        reasonCode: "CANDIDATE_TRUTH_VERSION_CHANGED",
        excludeCanonicals: dependencyInvalidationExcludeCanonicals });
    const saved = publicVersion(db.prepare("SELECT * FROM candidate_answer_versions WHERE id = ?").get(answerId));
    return { ...saved, anomaly, dependencyInvalidations: dependency.invalidatedCount, idempotentReplay: false };
}

export function saveCandidateAnswerVersion(input = {}) {
    const db = getDb();
    return db.transaction(() => saveCandidateAnswerVersionInTransaction(db, input))();
}

/** Pure selection helper; an equal-rank disagreement always needs the candidate. */
export function selectBestCandidateTruth(candidates, policy, context, now = new Date()) {
    const compatible = candidates.filter((candidate) => candidate.status === "ACTIVE"
        && scopeCompatible(candidate.scopeQualifiers, context));
    if (!compatible.length) return { status: "MISSING", reasonCodes: ["NO_COMPATIBLE_CANDIDATE_TRUTH"], candidates: [] };
    compatible.sort((left, right) => compareScopeRank(right.scopeRank, left.scopeRank));
    const bestRank = compatible[0].scopeRank;
    const best = compatible.filter((candidate) => compareScopeRank(candidate.scopeRank, bestRank) === 0);
    const distinctValues = new Set(best.map((candidate) => candidate.normalizedHash));
    if (distinctValues.size > 1) {
        return { status: "NEEDS_USER", reasonCodes: ["EQUAL_RANK_NON_EQUIVALENT_ANSWERS"],
            candidates: best.map((candidate) => candidate.id) };
    }
    const selected = best.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
    if (selected.learningState === "REVIEW") {
        const scopedPolicy = scopedCandidateAnswerLearningPolicy(selected.canonicalKey);
        const exactScope = scopedPolicy?.overrideScope.every((dimension) => Boolean(selected.scopeQualifiers[dimension]))
            && Object.keys(selected.scopeQualifiers).length === scopedPolicy.overrideScope.length;
        if (scopedPolicy?.reviewReuse !== "AUTOFILL" || !exactScope) {
            return { status: "NEEDS_USER", reasonCodes: ["REVIEW_ANSWER_NOT_TRIAL_REUSABLE"],
                suggestedAnswerVersionId: selected.id, candidates: best.map((candidate) => candidate.id) };
        }
    }
    const freshness = evaluateAnswerFreshness(policy, selected, now);
    if (!freshness.usable) return { status: "NEEDS_USER", reasonCodes: freshness.reasonCodes,
        suggestedAnswerVersionId: selected.id, candidates: best.map((candidate) => candidate.id), freshness };
    return { status: "RESOLVED", reasonCodes: ["BEST_COMPATIBLE_SCOPE",
        ...(selected.learningState === "REVIEW" ? ["TRIAL_REUSE_REVIEW_OVERRIDE"] : []), ...freshness.reasonCodes],
        answerVersion: selected, candidates: best.map((candidate) => candidate.id), freshness,
        trialReuse: selected.learningState === "REVIEW" };
}

export function resolveCandidateTruth({ userId, canonicalKey, context = {}, now = new Date() } = {}) {
    const key = String(canonicalKey || "").trim().toUpperCase();
    const policy = getActiveAnswerPolicy(key);
    if (!policy) return { canonicalKey: key, status: "NEEDS_USER", reasonCodes: ["ANSWER_POLICY_MISSING"] };
    if (["NEVER", "ASK", "GENERATE"].includes(policy.reusePolicy)
        || ["APPLICATION_ACTION", "SUBMISSION_ACTION", "SECURITY_CHALLENGE"].includes(policy.answerKind)) {
        return { canonicalKey: key, status: "NEEDS_USER", policy,
            reasonCodes: ["POLICY_REQUIRES_CURRENT_APPLICATION_ACTION"] };
    }
    const normalizedContext = normalizeAnswerContext(context, { policy });
    if (!normalizedContext.ok) return { canonicalKey: key, status: "NEEDS_USER", policy,
        context: normalizedContext, reasonCodes: ["REQUIRED_CONTEXT_UNKNOWN"] };
    const candidates = listCandidateAnswerVersions(userId, { canonicalKey: key, includeInactive: false });
    return { canonicalKey: key, policy, context: normalizedContext,
        ...selectBestCandidateTruth(candidates, policy, normalizedContext.context, now) };
}

export function resolveCandidateTruthBatch({ userId, canonicalKeys = [], context = {}, now = new Date() } = {}) {
    const keys = [...new Set(canonicalKeys.map((key) => String(key).trim().toUpperCase()).filter(Boolean))];
    if (!keys.length) return [];

    // Application pages commonly contain 20-50 fields. Fetch the policy set and
    // all active candidate versions once instead of executing a policy + answer
    // query for every control on the page.
    const policies = new Map(listActiveAnswerPolicies(keys).map((policy) => [policy.canonicalKey, policy]));
    const rows = getDb().prepare(`SELECT * FROM candidate_answer_versions
        WHERE user_id = ? AND status = 'ACTIVE'
          AND canonical_key IN (${keys.map(() => "?").join(",")})
        ORDER BY canonical_key, scope_specificity DESC, created_at DESC, id DESC`)
        .all(String(userId), ...keys).map(publicVersion);
    const versionsByCanonical = new Map();
    for (const version of rows) {
        const versions = versionsByCanonical.get(version.canonicalKey) || [];
        versions.push(version);
        versionsByCanonical.set(version.canonicalKey, versions);
    }

    return keys.map((canonicalKey) => {
        const policy = policies.get(canonicalKey);
        if (!policy) return { canonicalKey, status: "NEEDS_USER", reasonCodes: ["ANSWER_POLICY_MISSING"] };
        if (["NEVER", "ASK", "GENERATE"].includes(policy.reusePolicy)
            || ["APPLICATION_ACTION", "SUBMISSION_ACTION", "SECURITY_CHALLENGE"].includes(policy.answerKind)) {
            return { canonicalKey, status: "NEEDS_USER", policy,
                reasonCodes: ["POLICY_REQUIRES_CURRENT_APPLICATION_ACTION"] };
        }
        const normalizedContext = normalizeAnswerContext(context, { policy });
        if (!normalizedContext.ok) return { canonicalKey, status: "NEEDS_USER", policy,
            context: normalizedContext, reasonCodes: ["REQUIRED_CONTEXT_UNKNOWN"] };
        return { canonicalKey, policy, context: normalizedContext,
            ...selectBestCandidateTruth(versionsByCanonical.get(canonicalKey) || [], policy, normalizedContext.context, now) };
    });
}

export function candidateTruthDiagnostics() {
    const db = getDb();
    return {
        byStatus: db.prepare("SELECT status, COUNT(*) AS count FROM candidate_answer_versions GROUP BY status ORDER BY status").all(),
        activeByKind: db.prepare(`SELECT p.answer_kind AS answerKind, COUNT(v.id) AS count
            FROM active_canonical_answer_policies p LEFT JOIN candidate_answer_versions v
              ON v.canonical_key = p.canonical_key AND v.status = 'ACTIVE'
            GROUP BY p.answer_kind ORDER BY p.answer_kind`).all(),
        dependencyEvents: Number(db.prepare("SELECT COUNT(*) AS count FROM candidate_answer_dependency_events").get().count),
        learningStates: db.prepare(`SELECT learning_state AS learningState, COUNT(*) AS count
            FROM candidate_answer_versions GROUP BY learning_state ORDER BY learning_state`).all()
    };
}

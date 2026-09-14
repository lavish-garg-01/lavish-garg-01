import crypto from "node:crypto";
import { NORMALIZED_VALUE_VERSION, normalizedValueSchema } from "../contracts/normalizedValue.js";
import { stableContractHash } from "../contracts/contractPrimitives.js";
import { getDb } from "../database/connection.js";
import {
    discardCandidateAnswerRuntimeProposals,
    listCandidateAnswerRuntimeProposals,
    stageCandidateAnswerRuntimeProposal,
    updateCandidateAnswerRuntimeProposalOutcomes
} from "../repositories/candidateAnswerRuntimeProposalRepository.js";
import { getActiveCandidateAnswerVersion } from "../repositories/candidateAnswerVersionRepository.js";
import { getActiveAnswerPolicy } from "./answerPolicyRegistry.js";
import { normalizeAnswerContext } from "./answerContextNormalization.js";
import { commitCandidateAnswerChangeSet } from "./candidateAnswerChangeSetService.js";
import { preferredOverrideScope, scopedCandidateAnswerLearningPolicy } from "./scopedCandidateAnswerLearning.js";
import { scopeQualifiersForPolicy } from "./scopeRankPolicy.js";

const COMMON = Object.freeze({ schemaVersion: NORMALIZED_VALUE_VERSION, dataClass: "CANDIDATE_PRIVATE" });
const NEVER_RUNTIME_LEARN = /^(?:EXPERIENCE_|EDUCATION_)/;

function cleanText(value) {
    return String(value ?? "").normalize("NFKC").trim();
}

function optionRows(options = []) {
    return (Array.isArray(options) ? options : []).map((option) => typeof option === "string"
        ? { key: cleanText(option), label: cleanText(option) }
        : { key: cleanText(option?.value ?? option?.key ?? option?.label),
            label: cleanText(option?.label ?? option?.text ?? option?.value ?? option?.key) })
        .filter((option) => option.key || option.label);
}

function exactOption(raw, options) {
    const token = cleanText(raw).toLowerCase();
    return optionRows(options).find((option) => [option.key, option.label]
        .some((value) => value.toLowerCase() === token)) || null;
}

function exactDate(raw) {
    const token = cleanText(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return null;
    const date = new Date(`${token}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== token ? null : token;
}

function moneyValue(raw, label = "") {
    const token = cleanText(raw).replace(/,/g, "");
    const numeric = Number(token.replace(/(?:₹|rs\.?|inr)/gi, "").replace(/\s*(?:lpa|lakhs?|lacs?|l)\s*$/i, "").trim());
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    const lakhUnit = /(?:lpa|lakhs?|lacs?|\d\s*l\s*$)/i.test(token)
        || (!/[₹]|\b(?:rs\.?|inr)\b/i.test(token) && numeric <= 1000 && /ctc|compensation|salary.*lpa|lpa/i.test(label));
    const amount = lakhUnit ? numeric * 100000 : numeric;
    if (!Number.isSafeInteger(amount)) return null;
    return { ...COMMON, kind: "MONEY", amountExact: String(amount), currency: "INR", period: "YEAR" };
}

/** Conservative, deterministic normalizer. Ambiguity means no proposal. */
export function normalizeRuntimeCandidateAnswer({ rawValue, policy, field = {} } = {}) {
    const raw = cleanText(rawValue);
    if (!raw || !policy) return { ok: false, reasonCodes: ["EMPTY_OR_POLICY_MISSING"] };
    let value = null;
    if (["STRING", "RICH_TEXT"].includes(policy.valueType)) {
        value = { ...COMMON, kind: policy.valueType, value: raw };
    } else if (policy.valueType === "BOOLEAN") {
        if (/^(?:yes|true|1)$/i.test(raw)) value = { ...COMMON, kind: "BOOLEAN", value: true };
        if (/^(?:no|false|0)$/i.test(raw)) value = { ...COMMON, kind: "BOOLEAN", value: false };
    } else if (policy.valueType === "INTEGER") {
        const match = raw.match(/^([+-]?\d+)\s*(?:days?)?$/i);
        if (match) value = { ...COMMON, kind: "INTEGER", value: Number(match[1]) };
    } else if (policy.valueType === "DURATION") {
        const match = raw.match(/^(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?)?$/i);
        if (match) {
            const quantity = Number(match[1]);
            const unit = String(match[2] || (/month/i.test(field.label || "") ? "months" : "years"));
            const months = /month|mo/i.test(unit) ? quantity : quantity * 12;
            if (Number.isInteger(months)) value = { ...COMMON, kind: "DURATION", months };
        }
    } else if (policy.valueType === "MONEY") value = moneyValue(raw, field.label);
    else if (policy.valueType === "PHONE") {
        const digits = raw.replace(/\D/g, "");
        if (digits.length === 10) value = { ...COMMON, kind: "PHONE", countryCode: "+91", nationalNumber: digits, extension: null };
        else if (digits.length === 12 && digits.startsWith("91")) value = { ...COMMON, kind: "PHONE", countryCode: "+91", nationalNumber: digits.slice(2), extension: null };
    } else if (policy.valueType === "URL") {
        try {
            const url = new URL(raw);
            if (/^https?:$/i.test(url.protocol)) value = { ...COMMON, kind: "URL", value: raw };
        } catch { /* Ambiguous URLs are not learned. */ }
    } else if (policy.valueType === "DATE") {
        const date = exactDate(raw);
        if (date) value = { ...COMMON, kind: "DATE", value: { isoDate: date, precision: "DAY" } };
    } else if (policy.valueType === "ENUM") {
        const option = exactOption(raw, field.options);
        if (option) value = { ...COMMON, kind: "ENUM", value: option };
    } else if (policy.valueType === "MULTI_ENUM") {
        const tokens = raw.split(/[,;]+/).map(cleanText).filter(Boolean);
        const values = tokens.map((token) => exactOption(token, field.options));
        if (tokens.length && values.every(Boolean)) value = { ...COMMON, kind: "MULTI_ENUM", values };
    }
    const parsed = value ? normalizedValueSchema.safeParse(value) : null;
    return parsed?.success
        ? { ok: true, normalizedValue: parsed.data, reasonCodes: ["DETERMINISTIC_RUNTIME_NORMALIZATION"] }
        : { ok: false, reasonCodes: ["RUNTIME_VALUE_AMBIGUOUS_OR_UNSUPPORTED"] };
}

function applicationContext(applicationId) {
    const row = getDb().prepare(`SELECT a.id AS application_id, a.user_id, a.job_id,
            j.company_id, j.title, j.location, j.employment_type, j.country_code,
            c.name AS company_name, c.domain AS company_domain
        FROM applications a JOIN jobs j ON j.id = a.job_id
        LEFT JOIN companies c ON c.id = j.company_id WHERE a.id = ?`).get(applicationId);
    if (!row) return null;
    return {
        applicationId: row.application_id,
        companyId: row.company_id || undefined,
        companyName: row.company_name || undefined,
        companyDomain: row.company_domain || undefined,
        countryCode: row.country_code || "IN",
        roleTitle: row.title || undefined,
        location: row.location || undefined,
        employmentType: row.employment_type && row.employment_type !== "UNKNOWN" ? row.employment_type : undefined
    };
}

function candidateScope(policy, canonicalKey, contextInput) {
    const normalized = normalizeAnswerContext(contextInput, { policy });
    if (!normalized.ok) return { ok: false, reasonCodes: normalized.reasonCodes };
    let requested = {};
    const scoped = scopedCandidateAnswerLearningPolicy(canonicalKey);
    if (scoped) {
        const preferred = preferredOverrideScope(scoped, normalized.context);
        if (!preferred.ok) return { ok: false, reasonCodes: preferred.reasonCodes };
        requested = preferred.qualifiers;
    }
    const scope = scopeQualifiersForPolicy(policy, requested, normalized.context, { forWrite: true });
    return scope.ok ? { ok: true, context: contextInput, scopeQualifiers: scope.qualifiers, scopeHash: scope.scopeHash }
        : { ok: false, reasonCodes: scope.reasonCodes };
}

export function stageManualCandidateAnswerProposal({ userId, applicationId, runId, observation,
    canonicalKey, rawValue, field = {}, protectedValue = false } = {}) {
    const key = String(canonicalKey || "").trim().toUpperCase();
    if (!userId || !applicationId || !runId || !observation?.observationId || !observation?.answer?.finalValueHash) {
        return { staged: false, reasonCodes: ["RUNTIME_PROPOSAL_IDENTITY_INCOMPLETE"] };
    }
    if (protectedValue || key === "CUSTOM_FIELD" || NEVER_RUNTIME_LEARN.test(key)) {
        return { staged: false, reasonCodes: [protectedValue ? "PROTECTED_VALUE" : "CANONICAL_NOT_RUNTIME_LEARNABLE"] };
    }
    const policy = getActiveAnswerPolicy(key);
    if (!policy || policy.learningMode === "NEVER" || policy.riskTier === "PROHIBITED") {
        return { staged: false, reasonCodes: ["ANSWER_POLICY_FORBIDS_RUNTIME_PROPOSAL"] };
    }
    const normalized = normalizeRuntimeCandidateAnswer({ rawValue, policy, field });
    if (!normalized.ok) return { staged: false, reasonCodes: normalized.reasonCodes };
    const context = applicationContext(applicationId);
    const scope = context ? candidateScope(policy, key, context) : { ok: false, reasonCodes: ["APPLICATION_CONTEXT_MISSING"] };
    if (!scope.ok) return { staged: false, reasonCodes: scope.reasonCodes };
    const active = getActiveCandidateAnswerVersion(userId, key, scope.scopeHash);
    const proposal = stageCandidateAnswerRuntimeProposal({
        userId, applicationId, runId, observationId: observation.observationId,
        fieldLogicalId: observation.logicalFieldId, canonicalKey: key,
        normalizedValue: normalized.normalizedValue, finalValueHash: observation.answer.finalValueHash,
        context, scopeQualifiers: scope.scopeQualifiers, expectedActiveVersionId: active?.id || null,
        usedAnswerVersionId: null, source: "USER_MANUAL_INPUT",
        reasonCodes: [...normalized.reasonCodes, "WAITING_FOR_VERIFIED_CHECKPOINT"]
    });
    return { staged: true, proposalId: proposal.id, reasonCodes: proposal.reasonCodes };
}

export function stageVersionedCandidateAnswerProposal({ userId, applicationId, runId, observation,
    canonicalKey, rawValue, usedAnswerVersionId, field = {}, protectedValue = false } = {}) {
    const key = String(canonicalKey || "").trim().toUpperCase();
    if (!usedAnswerVersionId || protectedValue || !observation?.answer?.finalValueHash
        || observation.answer.intendedValueHash !== observation.answer.finalValueHash) {
        return { staged: false, reasonCodes: ["UNCHANGED_VERSIONED_REUSE_PROOF_INCOMPLETE"] };
    }
    const policy = getActiveAnswerPolicy(key);
    if (!policy || policy.learningMode === "NEVER" || policy.riskTier === "PROHIBITED") {
        return { staged: false, reasonCodes: ["ANSWER_POLICY_FORBIDS_RUNTIME_PROPOSAL"] };
    }
    const normalized = normalizeRuntimeCandidateAnswer({ rawValue, policy, field });
    if (!normalized.ok) return { staged: false, reasonCodes: normalized.reasonCodes };
    const context = applicationContext(applicationId);
    const scope = context ? candidateScope(policy, key, context) : { ok: false, reasonCodes: ["APPLICATION_CONTEXT_MISSING"] };
    if (!scope.ok) return { staged: false, reasonCodes: scope.reasonCodes };
    const active = getActiveCandidateAnswerVersion(userId, key, scope.scopeHash);
    if (!active || active.id !== usedAnswerVersionId) {
        return { staged: false, reasonCodes: ["USED_ANSWER_VERSION_IS_NOT_ACTIVE_FOR_SCOPE"] };
    }
    const proposal = stageCandidateAnswerRuntimeProposal({
        userId, applicationId, runId, observationId: observation.observationId,
        fieldLogicalId: observation.logicalFieldId, canonicalKey: key,
        normalizedValue: normalized.normalizedValue, finalValueHash: observation.answer.finalValueHash,
        context, scopeQualifiers: scope.scopeQualifiers, expectedActiveVersionId: active.id,
        usedAnswerVersionId: active.id, source: "VERSIONED_REUSE",
        reasonCodes: ["UNCHANGED_VERSIONED_REUSE", "WAITING_FOR_VERIFIED_CHECKPOINT"]
    });
    return { staged: true, proposalId: proposal.id, reasonCodes: proposal.reasonCodes };
}

function changeSetProposal(row) {
    return {
        observationId: row.observationId,
        fieldLogicalId: row.fieldLogicalId,
        canonicalKey: row.canonicalKey,
        normalizedValue: row.normalizedValue,
        finalValueHash: row.finalValueHash,
        context: row.context,
        scopeQualifiers: row.scopeQualifiers,
        expectedActiveVersionId: row.expectedActiveVersionId,
        usedAnswerVersionId: row.usedAnswerVersionId,
        reasonCodes: row.reasonCodes
    };
}

export function finalizeRuntimeCandidateAnswerProposals({ userId, applicationId, runId, checkpointId } = {}) {
    const rows = listCandidateAnswerRuntimeProposals(userId, {
        applicationId, runId, statuses: ["PENDING"], includeValue: true, limit: 100
    });
    if (!rows.length) return { enabled: true, status: "NO_PROPOSALS", reasonCode: "NO_SERVER_STAGED_PROPOSALS" };
    const latest = new Map();
    for (const row of rows) latest.set(row.canonicalKey, row);
    const selected = [...latest.values()];
    const superseded = rows.filter((row) => latest.get(row.canonicalKey)?.id !== row.id);
    if (superseded.length) updateCandidateAnswerRuntimeProposalOutcomes(userId, superseded.map((row) => ({
        id: row.id, status: "SUPERSEDED", reasonCodes: ["NEWER_CANONICAL_PROPOSAL_SELECTED"]
    })));
    let committed;
    try {
        committed = commitCandidateAnswerChangeSet({
            userId,
            idempotencyKey: `runtime-checkpoint:${checkpointId}`,
            input: { applicationId, runId, checkpointId, proposals: selected.map(changeSetProposal) }
        });
    } catch (error) {
        return { enabled: true, status: "NOT_COMMITTED", reasonCode: error.code || "RUNTIME_CHANGE_SET_FAILED" };
    }
    const learnedKeys = new Set((committed.items || []).map((item) => item.canonicalKey));
    const unchangedKeys = new Set((committed.unchanged || []).map((item) => item.canonicalKey));
    const heldByKey = new Map((committed.held || []).map((item) => [item.canonicalKey, item]));
    updateCandidateAnswerRuntimeProposalOutcomes(userId, selected.map((row) => {
        if (learnedKeys.has(row.canonicalKey)) return { id: row.id, status: "COMMITTED", changeSetId: committed.id,
            reasonCodes: ["CANDIDATE_TRUTH_CHANGE_SET_COMMITTED"] };
        if (unchangedKeys.has(row.canonicalKey)) return { id: row.id, status: "UNCHANGED",
            reasonCodes: ["EQUIVALENT_ACTIVE_TRUTH_ALREADY_EXISTS"] };
        const held = heldByKey.get(row.canonicalKey);
        return { id: row.id, status: "HELD", reasonCodes: held?.reasonCodes || ["REVIEW_REQUIRED"] };
    }));
    return {
        enabled: true,
        status: committed.status,
        changeSet: committed,
        summary: {
            learned: Number(committed.itemCount || 0),
            needsReview: committed.held?.length || 0,
            unchanged: committed.unchanged?.length || 0,
            canonicalKeys: (committed.items || []).map((item) => item.canonicalKey),
            changeSetId: committed.id || null,
            canUndo: Boolean(committed.id)
        }
    };
}

export function listPendingCandidateAnswerReviews(userId, { limit = 100 } = {}) {
    const proposals = listCandidateAnswerRuntimeProposals(userId, {
        statuses: ["HELD"], includeValue: true, limit
    });
    const groups = new Map();
    for (const proposal of proposals) {
        const key = `${proposal.applicationId}:${proposal.runId}`;
        if (!groups.has(key)) groups.set(key, { applicationId: proposal.applicationId, runId: proposal.runId,
            createdAt: proposal.createdAt, proposals: [] });
        groups.get(key).proposals.push(proposal);
    }
    return [...groups.values()].reverse();
}

export function discardPendingCandidateAnswerReviews(userId, proposalIds) {
    return { discarded: discardCandidateAnswerRuntimeProposals(userId, proposalIds) };
}

export function commitPendingCandidateAnswerReviews({ userId, applicationId, runId, checkpointId,
    proposalIds, idempotencyKey } = {}) {
    const rows = listCandidateAnswerRuntimeProposals(userId, {
        applicationId, runId, statuses: ["HELD"], ids: proposalIds, includeValue: true, limit: 50
    });
    if (!rows.length || rows.length !== proposalIds.length) {
        const error = new Error("One or more review items are no longer available.");
        error.code = "PENDING_REVIEW_CHANGED";
        error.status = 409;
        throw error;
    }
    if (new Set(rows.map((row) => row.canonicalKey)).size !== rows.length) {
        const error = new Error("Choose only the latest review item for each answer.");
        error.code = "DUPLICATE_REVIEW_CANONICAL";
        throw error;
    }
    const committed = commitCandidateAnswerChangeSet({
        userId, idempotencyKey,
        input: { applicationId, runId, checkpointId, proposals: rows.map(changeSetProposal) }
    });
    const learned = new Set((committed.items || []).map((item) => item.canonicalKey));
    const unchanged = new Set((committed.unchanged || []).map((item) => item.canonicalKey));
    const heldByKey = new Map((committed.held || []).map((item) => [item.canonicalKey, item]));
    updateCandidateAnswerRuntimeProposalOutcomes(userId, rows.map((row) => learned.has(row.canonicalKey)
        ? { id: row.id, status: "COMMITTED", changeSetId: committed.id,
            reasonCodes: ["CANDIDATE_EXPLICITLY_SAVED"] }
        : unchanged.has(row.canonicalKey)
            ? { id: row.id, status: "UNCHANGED", reasonCodes: ["EQUIVALENT_ACTIVE_TRUTH_ALREADY_EXISTS"] }
            : { id: row.id, status: "HELD", reasonCodes: heldByKey.get(row.canonicalKey)?.reasonCodes || ["REVIEW_REQUIRED"] }));
    return committed;
}

export function runtimeProposalHash(input) {
    return stableContractHash(input);
}

export function runtimeReviewCheckpointId(seed = null) {
    return seed ? `checkpoint:review:${stableContractHash({ seed }).slice(0, 40)}`
        : `checkpoint:review:${crypto.randomUUID()}`;
}

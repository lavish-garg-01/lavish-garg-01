import crypto from "node:crypto";
import fs from "node:fs";
import { getDb } from "../database/connection.js";
import { env } from "../config/environment.js";
import { canonicalContractJson, stableContractHash } from "../contracts/contractPrimitives.js";
import { normalizedValueSchema } from "../contracts/normalizedValue.js";
import {
    listCandidateAnswerVersions, saveCandidateAnswerVersion
} from "../repositories/candidateAnswerVersionRepository.js";
import { listActiveAnswerPolicies } from "./answerPolicyRegistry.js";
import { evaluateAnswerAnomaly } from "./candidateAnswerAnomaly.js";
import { loadResume } from "./resumeStore.js";

export const LEGACY_CANDIDATE_TRUTH_MIGRATION_VERSION = 1;

const CANDIDATE_PRIVATE = Object.freeze({ schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE" });
const DIRECT_ANSWER_SOURCES = new Set([
    "USER", "USER_MANUAL_INPUT", "VERIFIED_APPLICATION_INPUT", "ATTENTION_GAP", "PROFILE"
]);
const SOURCE_PRIORITY = Object.freeze({
    APPROVED_MEMORY: 40,
    PROFILE: 30,
    VERIFIED_RESUME: 20,
    CANDIDATE_ANSWER: 10
});
const PLACEHOLDERS = new Set(["local user", "local@example.com", "n/a", "na", "none", "unknown", "-"]);
const PROFILE_FIELDS = Object.freeze([
    ["name", "FULL_NAME"],
    ["preferred_first_name", "PREFERRED_FIRST_NAME"],
    ["preferred_last_name", "PREFERRED_LAST_NAME"],
    ["legal_first_name", "LEGAL_FIRST_NAME"],
    ["legal_middle_name", "LEGAL_MIDDLE_NAME"],
    ["legal_last_name", "LEGAL_LAST_NAME"],
    ["email", "EMAIL"],
    ["phone", "PHONE"],
    ["country", "COUNTRY"],
    ["current_location", "CURRENT_LOCATION"],
    ["address_line1", "ADDRESS_LINE1"],
    ["address_line2", "ADDRESS_LINE2"],
    ["address_city", "ADDRESS_CITY"],
    ["address_state", "ADDRESS_STATE"],
    ["postal_code", "POSTAL_CODE"],
    ["linkedin_url", "LINKEDIN_URL"],
    ["github_url", "GITHUB_URL"],
    ["portfolio_url", "PORTFOLIO_URL"],
    ["current_company", "CURRENT_COMPANY"],
    ["current_industry", "CURRENT_INDUSTRY"],
    ["preferred_locations", "PREFERRED_LOCATIONS", "JSON_LIST"],
    ["current_ctc", "CURRENT_CTC", "LPA"],
    ["expected_ctc", "EXPECTED_CTC", "LPA"],
    ["notice_period_days", "NOTICE_PERIOD", "DAYS"],
    ["last_working_date", "LAST_WORKING_DATE", "DATE"],
    ["total_experience_years", "TOTAL_EXPERIENCE", "YEARS"],
    ["skills", "SKILLS", "JSON_LIST"],
    ["willing_to_relocate", "RELOCATION", "PROFILE_BOOLEAN"],
    ["work_authorization", "WORK_AUTHORIZATION"],
    ["sponsorship_required", "SPONSORSHIP"]
]);
const RESUME_FIELDS = Object.freeze([
    ["fullName", "FULL_NAME"],
    ["email", "EMAIL"],
    ["phone", "PHONE"],
    ["country", "COUNTRY"],
    ["location", "CURRENT_LOCATION"],
    ["linkedin", "LINKEDIN_URL"],
    ["github", "GITHUB_URL"],
    ["portfolio", "PORTFOLIO_URL"],
    ["noticePeriodDays", "NOTICE_PERIOD", "DAYS"],
    ["totalExperienceYears", "TOTAL_EXPERIENCE", "YEARS"],
    ["summary", "PERSONAL_SUMMARY"],
    ["skills", "SKILLS", "LIST"]
]);

function parseJson(value, fallback) {
    try { return JSON.parse(value ?? "") ?? fallback; } catch { return fallback; }
}

function text(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function timestamp(value, fallback = new Date().toISOString()) {
    const date = new Date(value || fallback);
    if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 5 * 60 * 1000) return fallback;
    return date.toISOString();
}

function itemKey(label) {
    return text(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 160)
        || stableContractHash(text(label)).slice(0, 24);
}

function listValue(raw, mode) {
    if (Array.isArray(raw)) return raw;
    if (mode === "JSON_LIST") return parseJson(raw, []);
    return String(raw || "").split(/[,;\n]+/);
}

function numberFrom(raw) {
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    const match = String(raw ?? "").replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : null;
}

function urlValue(raw) {
    const value = text(raw);
    if (!value) return null;
    try {
        const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
        if (!/^https?:$/.test(parsed.protocol) || (!parsed.hostname.includes(".") && parsed.hostname !== "localhost")) return null;
        return parsed.href.replace(/\/$/, "");
    } catch { return null; }
}

function countryCallingCode(country = "") {
    const key = text(country).toUpperCase();
    if (["IN", "IND", "INDIA"].includes(key)) return "+91";
    if (["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA", "CA", "CANADA"].includes(key)) return "+1";
    if (["GB", "UK", "UNITED KINGDOM"].includes(key)) return "+44";
    if (["AU", "AUSTRALIA"].includes(key)) return "+61";
    return null;
}

function phoneValue(raw, country) {
    const original = text(raw);
    if (!original) return null;
    let digits = original.replace(/\D/g, "");
    let callingCode = null;
    if (original.startsWith("+")) {
        for (const code of ["91", "44", "61", "1"]) {
            if (digits.startsWith(code)) { callingCode = `+${code}`; digits = digits.slice(code.length); break; }
        }
    } else {
        callingCode = countryCallingCode(country);
        const prefix = callingCode?.slice(1) || "";
        if (prefix && digits.length > 10 && digits.startsWith(prefix)) digits = digits.slice(prefix.length);
        if (callingCode === "+91" && digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    }
    if (!callingCode || digits.length < 4 || digits.length > 14) return null;
    return { ...CANDIDATE_PRIVATE, kind: "PHONE", countryCode: callingCode, nationalNumber: digits, extension: null };
}

function booleanValue(raw) {
    if (raw === true || raw === 1) return true;
    if (raw === false || raw === 0) return false;
    const value = text(raw).toLowerCase();
    if (["yes", "true", "1", "y", "willing", "required", "authorized", "authorized_in_market"].includes(value)) return true;
    if (["no", "false", "0", "n", "not willing", "not required", "not_required", "not authorized", "not_authorized"].includes(value)) return false;
    return null;
}

function normalizeLegacyValue(policy, raw, { unit = null, country = "" } = {}) {
    let value = null;
    if (policy.valueType === "STRING") {
        const clean = text(raw);
        if (clean && !PLACEHOLDERS.has(clean.toLowerCase())) value = { ...CANDIDATE_PRIVATE, kind: "STRING", value: clean };
    } else if (policy.valueType === "RICH_TEXT") {
        const clean = String(raw ?? "").trim();
        if (clean) value = { ...CANDIDATE_PRIVATE, kind: "RICH_TEXT", value: clean };
    } else if (policy.valueType === "URL") {
        const clean = urlValue(raw);
        if (clean) value = { ...CANDIDATE_PRIVATE, kind: "URL", value: clean };
    } else if (policy.valueType === "PHONE") {
        value = phoneValue(raw, country);
    } else if (policy.valueType === "BOOLEAN") {
        const clean = booleanValue(raw);
        if (clean !== null) value = { ...CANDIDATE_PRIVATE, kind: "BOOLEAN", value: clean };
    } else if (policy.valueType === "INTEGER") {
        const clean = numberFrom(raw);
        if (clean !== null && Number.isInteger(clean) && clean > 0) value = { ...CANDIDATE_PRIVATE, kind: "INTEGER", value: clean };
    } else if (policy.valueType === "DURATION") {
        const clean = numberFrom(raw);
        const months = unit === "MONTHS" ? clean : clean === null ? null : Math.round(clean * 12);
        if (months !== null && Number.isInteger(months) && months >= 0) value = { ...CANDIDATE_PRIVATE, kind: "DURATION", months };
    } else if (policy.valueType === "MONEY") {
        const clean = numberFrom(raw);
        const explicitlyLpa = unit === "LPA" || /\blpa\b|lakhs?\s+per\s+annum/i.test(String(raw || ""));
        if (clean !== null && clean > 0 && explicitlyLpa && clean <= 1_000) {
            value = { ...CANDIDATE_PRIVATE, kind: "MONEY", amountExact: String(Math.round(clean * env.market.lpaToInr)), currency: "INR", period: "YEAR" };
        }
    } else if (policy.valueType === "MULTI_ENUM") {
        const values = [...new Map(listValue(raw, unit).map(text).filter(Boolean)
            .map((label) => [itemKey(label), { key: itemKey(label), label }])).values()];
        if (values.length) value = { ...CANDIDATE_PRIVATE, kind: "MULTI_ENUM", values };
    } else if (policy.valueType === "ENUM") {
        const label = text(raw);
        if (label) value = { ...CANDIDATE_PRIVATE, kind: "ENUM", value: { key: itemKey(label), label } };
    } else if (policy.valueType === "DATE") {
        const clean = text(raw);
        if (/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(clean)) {
            value = { ...CANDIDATE_PRIVATE, kind: "DATE", value: { isoDate: clean, precision: "DAY" } };
        }
    }
    const parsed = normalizedValueSchema.safeParse(value);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reasonCode: "LEGACY_VALUE_NOT_SAFELY_NORMALIZABLE" };
}

function policyDecision(policy, canonicalKey) {
    if (!policy) return { eligible: false, reasonCode: "ANSWER_POLICY_MISSING" };
    if (/^(?:EXPERIENCE|EDUCATION)_/.test(canonicalKey)) {
        return { eligible: false, reasonCode: "STABLE_ENTITY_BINDING_NOT_IMPLEMENTED" };
    }
    if (policy.answerKind === "LEGAL_FACT") return { eligible: false, reasonCode: "LEGAL_FACT_REQUIRES_RECONFIRMATION" };
    if (policy.answerKind === "ENTITY_SCOPED_FACT") return { eligible: false, reasonCode: "ENTITY_SCOPE_REQUIRES_EXACT_BINDING" };
    if ((policy.requiredScopeDimensions || []).length) return { eligible: false, reasonCode: "REQUIRED_SCOPE_CONTEXT_MISSING" };
    if (["APPLICATION_ACTION", "SUBMISSION_ACTION", "SECURITY_CHALLENGE", "CONTEXTUAL_ANSWER"].includes(policy.answerKind)
        || ["NEVER", "ASK", "GENERATE"].includes(policy.reusePolicy)
        || policy.learningMode === "NEVER" || policy.riskTier === "PROHIBITED") {
        return { eligible: false, reasonCode: "POLICY_FORBIDS_AUTOMATIC_MIGRATION" };
    }
    if (!["STABLE_FACT", "MUTABLE_FACT", "PREFERENCE"].includes(policy.answerKind)) {
        return { eligible: false, reasonCode: "ANSWER_KIND_NOT_MIGRATION_SAFE" };
    }
    if (policy.valueType === "FILE_REF") return { eligible: false, reasonCode: "FILE_REFERENCE_REQUIRES_EXPLICIT_SELECTION" };
    return { eligible: true, reasonCode: "POLICY_ALLOWS_SAFE_LEGACY_MIGRATION" };
}

function sourceCandidate({ canonicalKey, sourceKind, sourceRecordId, rawValue, confirmedAt, unit = null,
    country = "", reasonCode = null, priority = 0 }) {
    return {
        canonicalKey: String(canonicalKey || "").trim().toUpperCase(),
        sourceKind,
        sourceRecordId: String(sourceRecordId),
        sourceValueHash: stableContractHash({ sourceKind, sourceRecordId: String(sourceRecordId), rawValue }),
        rawValue,
        confirmedAt: timestamp(confirmedAt),
        unit,
        country,
        reasonCode,
        priority
    };
}

function rawProfileCandidates(profile) {
    if (!profile) return [];
    const country = profile.country || "";
    const result = [];
    for (const [column, canonicalKey, unit] of PROFILE_FIELDS) {
        let rawValue = profile[column];
        if (unit === "JSON_LIST") rawValue = parseJson(rawValue, []);
        if (rawValue == null || rawValue === "" || (Array.isArray(rawValue) && !rawValue.length)) continue;
        let reasonCode = null;
        if (unit === "PROFILE_BOOLEAN" && !Boolean(rawValue)) reasonCode = "PROFILE_BOOLEAN_DEFAULT_AMBIGUOUS";
        if (["name", "email"].includes(column) && PLACEHOLDERS.has(text(rawValue).toLowerCase())) reasonCode = "PLACEHOLDER_PROFILE_VALUE";
        result.push(sourceCandidate({
            canonicalKey, sourceKind: "PROFILE", sourceRecordId: `candidate_profiles:${profile.user_id}:${column}`,
            rawValue, confirmedAt: profile.updated_at, unit, country, reasonCode, priority: SOURCE_PRIORITY.PROFILE
        }));
    }
    return result;
}

function rawResumeCandidates(resume, { userId, confirmedAt, country = "" }) {
    if (!resume) return [];
    const resumeCountry = resume.country || country;
    return RESUME_FIELDS.flatMap(([property, canonicalKey, unit]) => {
        const rawValue = resume[property];
        if (rawValue == null || rawValue === "" || (Array.isArray(rawValue) && !rawValue.length)) return [];
        return [sourceCandidate({
            canonicalKey, sourceKind: "VERIFIED_RESUME", sourceRecordId: `master_resume:${userId}:${property}`,
            rawValue, confirmedAt, unit, country: resumeCountry, priority: SOURCE_PRIORITY.VERIFIED_RESUME
        })];
    });
}

function rawFactCandidates(rows, profileCountry) {
    return rows.map((row) => sourceCandidate({
        canonicalKey: row.semantic_key,
        sourceKind: "APPROVED_MEMORY",
        sourceRecordId: `candidate_fact_memory:${row.id}`,
        rawValue: row.value_text,
        confirmedAt: row.verified_at || row.updated_at,
        unit: ["CURRENT_CTC", "EXPECTED_CTC"].includes(row.semantic_key) ? "LPA"
            : row.semantic_key === "TOTAL_EXPERIENCE" ? "YEARS" : null,
        country: profileCountry,
        reasonCode: !Number(row.candidate_approved) ? "LEGACY_FACT_NOT_CANDIDATE_APPROVED"
            : row.fact_scope !== "CANDIDATE_PROFILE" ? "APPLICATION_OR_NON_PROFILE_SCOPE_NOT_MIGRATED" : null,
        priority: SOURCE_PRIORITY.APPROVED_MEMORY
    }));
}

function rawAnswerCandidates(rows, profileCountry) {
    return rows.map((row) => {
        const source = String(row.source || "").toUpperCase();
        const confidence = Number(row.confidence || 0);
        const reasonCode = !DIRECT_ANSWER_SOURCES.has(source) ? "LEGACY_SOURCE_NOT_CANDIDATE_VERIFIED"
            : confidence < 0.9 ? "LEGACY_ANSWER_CONFIDENCE_TOO_LOW" : null;
        return sourceCandidate({
            canonicalKey: row.question_key,
            sourceKind: "CANDIDATE_ANSWER",
            sourceRecordId: `candidate_answers:${row.id}`,
            rawValue: row.answer,
            confirmedAt: row.updated_at,
            unit: ["CURRENT_CTC", "EXPECTED_CTC"].includes(String(row.question_key).toUpperCase()) ? "LPA"
                : String(row.question_key).toUpperCase() === "TOTAL_EXPERIENCE" ? "YEARS" : null,
            country: profileCountry,
            reasonCode,
            priority: SOURCE_PRIORITY.CANDIDATE_ANSWER
        });
    });
}

export function readLegacyCandidateTruthSnapshot(userId, { db = getDb(), resume = undefined } = {}) {
    const id = String(userId || "").trim();
    if (!id) throw new Error("Candidate identity is required for legacy migration.");
    const profile = db.prepare("SELECT * FROM candidate_profiles WHERE user_id = ?").get(id) || null;
    const facts = db.prepare("SELECT * FROM candidate_fact_memory WHERE user_id = ? ORDER BY semantic_key, id").all(id);
    const answers = db.prepare("SELECT * FROM candidate_answers WHERE user_id = ? ORDER BY question_key, id").all(id);
    let loadedResume = resume;
    let resumeTimestamp = new Date().toISOString();
    if (resume === undefined && id === "local-user") {
        try {
            loadedResume = loadResume();
            resumeTimestamp = fs.statSync(env.paths.masterResume).mtime.toISOString();
        } catch { loadedResume = null; }
    }
    const sources = [
        ...rawProfileCandidates(profile),
        ...rawResumeCandidates(loadedResume, { userId: id, confirmedAt: resumeTimestamp, country: profile?.country || "" }),
        ...rawFactCandidates(facts, profile?.country || loadedResume?.country || ""),
        ...rawAnswerCandidates(answers, profile?.country || loadedResume?.country || "")
    ];
    return {
        userId: id,
        migrationVersion: LEGACY_CANDIDATE_TRUTH_MIGRATION_VERSION,
        sources,
        snapshotHash: stableContractHash({
            migrationVersion: LEGACY_CANDIDATE_TRUTH_MIGRATION_VERSION,
            sources: sources.map(({ canonicalKey, sourceKind, sourceRecordId, sourceValueHash, reasonCode }) => ({
                canonicalKey, sourceKind, sourceRecordId, sourceValueHash, reasonCode
            })).sort((left, right) => canonicalContractJson(left).localeCompare(canonicalContractJson(right)))
        })
    };
}

function item(candidate, decision, reasonCodes, extra = {}) {
    return {
        canonicalKey: candidate.canonicalKey || null,
        sourceKind: candidate.sourceKind,
        sourceRecordId: candidate.sourceRecordId,
        sourceValueHash: candidate.sourceValueHash,
        decision,
        reasonCodes: [...new Set(reasonCodes)].sort(),
        ...extra
    };
}

function migrationPriority(canonicalKey) {
    if (canonicalKey === "CURRENT_COMPANY") return 10;
    if (["CURRENT_INDUSTRY", "CURRENT_CAREER_STAGE", "CURRENT_CTC", "NOTICE_PERIOD"].includes(canonicalKey)) return 20;
    return 15;
}

export function planLegacyCandidateTruthMigration(snapshot, { existingVersions = null } = {}) {
    const policies = new Map(listActiveAnswerPolicies().map((policy) => [policy.canonicalKey, policy]));
    const versions = existingVersions || listCandidateAnswerVersions(snapshot.userId, { includeInactive: false });
    const existing = new Map(versions.map((version) => [`${version.canonicalKey}:${version.scopeHash}`, version]));
    const grouped = new Map();
    const items = [];

    for (const candidate of snapshot.sources) {
        const policy = policies.get(candidate.canonicalKey) || null;
        if (candidate.reasonCode) {
            items.push(item(candidate, "SKIPPED", [candidate.reasonCode]));
            continue;
        }
        const eligibility = policyDecision(policy, candidate.canonicalKey);
        if (!eligibility.eligible) {
            items.push(item(candidate, "SKIPPED", [eligibility.reasonCode]));
            continue;
        }
        const normalized = normalizeLegacyValue(policy, candidate.rawValue, { unit: candidate.unit, country: candidate.country });
        if (!normalized.ok) {
            items.push(item(candidate, "INVALID", [normalized.reasonCode]));
            continue;
        }
        const anomaly = evaluateAnswerAnomaly(policy, normalized.value, null);
        if (!anomaly.allowed) {
            items.push(item(candidate, "INVALID", anomaly.reasonCodes));
            continue;
        }
        const scopeHash = stableContractHash({});
        const key = `${candidate.canonicalKey}:${scopeHash}`;
        const group = grouped.get(key) || { policy, scopeHash, candidates: [] };
        group.candidates.push({ ...candidate, normalizedValue: normalized.value, normalizedHash: stableContractHash(normalized.value) });
        grouped.set(key, group);
    }

    for (const group of grouped.values()) {
        group.candidates.sort((left, right) => right.priority - left.priority || left.sourceRecordId.localeCompare(right.sourceRecordId));
        const selected = group.candidates[0];
        const hashes = new Set(group.candidates.map((candidate) => candidate.normalizedHash));
        if (hashes.size > 1) {
            items.push(item({ ...selected, sourceKind: "MULTIPLE", sourceRecordId: `conflict:${selected.canonicalKey}` },
                "CONFLICT", ["NON_EQUIVALENT_LEGACY_SOURCES"]));
            continue;
        }
        const active = existing.get(`${selected.canonicalKey}:${group.scopeHash}`);
        if (active) {
            items.push(item(selected, active.normalizedHash === selected.normalizedHash ? "ALREADY_PRESENT" : "CONFLICT",
                [active.normalizedHash === selected.normalizedHash ? "EQUIVALENT_ACTIVE_TRUTH_EXISTS" : "ACTIVE_TRUTH_WOULD_BE_OVERWRITTEN"],
                { existingAnswerVersionId: active.id }));
            continue;
        }
        const activeDependents = versions.filter((version) => {
            const dependentPolicy = policies.get(version.canonicalKey);
            return version.status === "ACTIVE" && (dependentPolicy?.dependencyKeys || []).includes(selected.canonicalKey);
        });
        if (activeDependents.length) {
            items.push(item(selected, "SKIPPED", ["ACTIVE_DEPENDENT_TRUTH_REQUIRES_REVIEW"]));
            continue;
        }
        items.push(item(selected, "MIGRATE", ["POLICY_APPROVED_UNAMBIGUOUS_LEGACY_VALUE"], {
            normalizedValue: selected.normalizedValue,
            normalizedHash: selected.normalizedHash,
            confirmedAt: selected.confirmedAt,
            migrationPriority: migrationPriority(selected.canonicalKey)
        }));
    }

    items.sort((left, right) => Number(left.migrationPriority || 99) - Number(right.migrationPriority || 99)
        || String(left.canonicalKey).localeCompare(String(right.canonicalKey)));
    return { ...snapshot, items };
}

function countsFor(items) {
    const counts = { migrated: 0, skipped: 0, conflict: 0, alreadyPresent: 0, invalid: 0 };
    for (const current of items) {
        if (current.decision === "MIGRATE" || current.decision === "MIGRATED") counts.migrated += 1;
        else if (current.decision === "SKIPPED") counts.skipped += 1;
        else if (current.decision === "CONFLICT") counts.conflict += 1;
        else if (current.decision === "ALREADY_PRESENT") counts.alreadyPresent += 1;
        else if (current.decision === "INVALID") counts.invalid += 1;
    }
    return counts;
}

function publicSummary({ migrationVersion, snapshotHash, sources = [], sourceCount = null, items = [], id = null, status = "PREVIEW",
    initiatedBy = null, createdAt = null, completedAt = null, idempotentReplay = false } = {}) {
    const reasonCounts = new Map();
    for (const current of items) {
        for (const reason of current.reasonCodes || []) reasonCounts.set(reason, Number(reasonCounts.get(reason) || 0) + 1);
    }
    const counts = countsFor(items);
    const preview = status === "PREVIEW";
    return {
        id,
        migrationVersion,
        snapshotFingerprint: snapshotHash ? snapshotHash.slice(0, 12) : null,
        status,
        initiatedBy,
        sourceCount: sourceCount ?? sources.length,
        eligible: preview ? counts.migrated : 0,
        ...counts,
        migrated: preview ? 0 : counts.migrated,
        reasonCounts: [...reasonCounts.entries()].map(([reasonCode, count]) => ({ reasonCode, count }))
            .sort((left, right) => right.count - left.count || left.reasonCode.localeCompare(right.reasonCode)),
        productionCutover: false,
        idempotentReplay,
        createdAt,
        completedAt
    };
}

function storedRun(db, row, { idempotentReplay = false } = {}) {
    if (!row) return null;
    const storedItems = db.prepare(`SELECT decision, reason_codes_json FROM candidate_answer_migration_items
        WHERE run_id = ? ORDER BY created_at, id`).all(row.id).map((current) => ({
        decision: current.decision,
        reasonCodes: parseJson(current.reason_codes_json, [])
    }));
    return publicSummary({
        id: row.id,
        migrationVersion: Number(row.migration_version),
        snapshotHash: row.snapshot_hash,
        sourceCount: Number(row.source_count || 0),
        items: storedItems,
        status: row.status,
        initiatedBy: row.initiated_by,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        idempotentReplay
    });
}

export function previewLegacyCandidateTruthMigration({ userId, resume = undefined } = {}) {
    const snapshot = readLegacyCandidateTruthSnapshot(userId, { resume });
    return publicSummary(planLegacyCandidateTruthMigration(snapshot));
}

export function applyLegacyCandidateTruthMigration({ userId, resume = undefined, initiatedBy = "ADMIN" } = {}) {
    const actor = String(initiatedBy || "ADMIN").toUpperCase();
    if (!new Set(["STARTUP", "ADMIN", "TEST"]).has(actor)) throw new Error("Unsupported legacy migration initiator.");
    const db = getDb();
    const snapshot = readLegacyCandidateTruthSnapshot(userId, { db, resume });
    const previous = db.prepare(`SELECT * FROM candidate_answer_migration_runs
        WHERE user_id = ? AND migration_version = ? AND snapshot_hash = ?`)
        .get(snapshot.userId, snapshot.migrationVersion, snapshot.snapshotHash);
    if (previous) return storedRun(db, previous, { idempotentReplay: true });
    const plan = planLegacyCandidateTruthMigration(snapshot);
    const runId = crypto.randomUUID();
    const completedItems = [];
    const write = db.transaction(() => {
        db.prepare(`INSERT INTO candidate_answer_migration_runs
            (id, user_id, migration_version, snapshot_hash, status, source_count, initiated_by)
            VALUES (?, ?, ?, ?, 'IN_PROGRESS', ?, ?)`).run(
            runId, snapshot.userId, snapshot.migrationVersion, snapshot.snapshotHash, snapshot.sources.length, actor
        );
        const insertItem = db.prepare(`INSERT INTO candidate_answer_migration_items
            (id, run_id, user_id, canonical_key, source_kind, source_record_id, source_value_hash,
             decision, reason_codes_json, answer_version_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const current of plan.items) {
            let decision = current.decision;
            let answerVersionId = current.existingAnswerVersionId || null;
            if (decision === "MIGRATE") {
                const version = saveCandidateAnswerVersion({
                    userId: snapshot.userId,
                    canonicalKey: current.canonicalKey,
                    normalizedValue: current.normalizedValue,
                    source: "MIGRATED_LEGACY",
                    sourceVersionId: current.sourceRecordId,
                    expectedActiveVersionId: null,
                    idempotencyKey: `legacy-v${snapshot.migrationVersion}:${stableContractHash({
                        snapshotHash: snapshot.snapshotHash, canonicalKey: current.canonicalKey, scope: {}
                    })}`,
                    confirmedAt: current.confirmedAt,
                    candidateApproved: true
                });
                decision = "MIGRATED";
                answerVersionId = version.id;
            }
            const completed = { ...current, decision, answerVersionId };
            completedItems.push(completed);
            insertItem.run(crypto.randomUUID(), runId, snapshot.userId, current.canonicalKey, current.sourceKind,
                current.sourceRecordId, current.sourceValueHash, decision,
                canonicalContractJson(current.reasonCodes || []), answerVersionId);
        }
        const counts = countsFor(completedItems);
        db.prepare(`UPDATE candidate_answer_migration_runs SET status = 'COMPLETED',
            migrated_count = ?, skipped_count = ?, conflict_count = ?, already_present_count = ?, invalid_count = ?,
            completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
            counts.migrated, counts.skipped, counts.conflict, counts.alreadyPresent, counts.invalid, runId
        );
    });
    write();
    return storedRun(db, db.prepare("SELECT * FROM candidate_answer_migration_runs WHERE id = ?").get(runId));
}

export function legacyCandidateTruthMigrationDiagnostics(userId) {
    const db = getDb();
    const id = String(userId || "").trim();
    const latest = db.prepare(`SELECT * FROM candidate_answer_migration_runs
        WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`).get(id);
    return {
        migrationVersion: LEGACY_CANDIDATE_TRUTH_MIGRATION_VERSION,
        runCount: Number(db.prepare("SELECT COUNT(*) AS count FROM candidate_answer_migration_runs WHERE user_id = ?").get(id).count),
        latest: storedRun(db, latest)
    };
}

export function ensureSafeLegacyCandidateTruthMigration({ userId = "local-user" } = {}) {
    return applyLegacyCandidateTruthMigration({ userId, initiatedBy: "STARTUP" });
}

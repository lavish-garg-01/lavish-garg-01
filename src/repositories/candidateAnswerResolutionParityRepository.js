import crypto from "node:crypto";
import { getDb } from "../database/connection.js";

const parseJson = (value, fallback) => {
    try { return JSON.parse(value || "") ?? fallback; } catch { return fallback; }
};

const cleanReasons = (values = []) => [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 120))
    .filter(Boolean))].slice(0, 16);

function publicEvent(row) {
    if (!row) return null;
    return {
        id: row.id,
        idempotentReplay: false,
        resolverMode: row.resolver_mode,
        productionSource: row.production_source,
        legacyDecision: row.legacy_decision,
        versionedDecision: row.versioned_decision,
        comparisonOutcome: row.comparison_outcome,
        canonicalKey: row.canonical_key || null,
        reasonCodes: parseJson(row.reason_codes_json, []),
        createdAt: row.created_at
    };
}

/**
 * Append-only parity receipt. Candidate values are never accepted here; the
 * caller may supply only already-redacted SHA-256 digests.
 */
export function recordCandidateAnswerResolutionParity(input) {
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM candidate_answer_resolution_parity_events
        WHERE event_key = ?`).get(input.eventKey);
    if (existing) return { ...publicEvent(existing), idempotentReplay: true };
    const id = `answer_parity_${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO candidate_answer_resolution_parity_events
        (id, event_key, user_id, application_id, application_run_id, field_logical_id,
         canonical_key, resolver_mode, production_source, legacy_decision, versioned_decision,
         comparison_outcome, legacy_value_hash, versioned_value_hash, contract_id,
         candidate_answer_version_id, policy_version, risk_tier, reason_codes_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.eventKey, input.userId, input.applicationId || null, input.applicationRunId || null,
            input.fieldLogicalId, input.canonicalKey || null, input.resolverMode, input.productionSource,
            input.legacyDecision, input.versionedDecision, input.comparisonOutcome,
            input.legacyValueHash || null, input.versionedValueHash || null, input.contractId || null,
            input.candidateAnswerVersionId || null, input.policyVersion || null, input.riskTier || null,
            JSON.stringify(cleanReasons(input.reasonCodes)));
    return publicEvent(db.prepare("SELECT * FROM candidate_answer_resolution_parity_events WHERE id = ?").get(id));
}

export function recordCandidateAnswerResolutionParityBatch(inputs = []) {
    const bounded = (Array.isArray(inputs) ? inputs : []).slice(0, 100);
    if (!bounded.length) return [];
    return getDb().transaction(() => bounded.map(recordCandidateAnswerResolutionParity))();
}

export function candidateAnswerResolutionParityDiagnostics({ days = 14 } = {}) {
    const boundedDays = Math.max(1, Math.min(90, Number(days) || 14));
    const db = getDb();
    const totals = db.prepare(`SELECT
            COUNT(*) AS compared,
            SUM(CASE WHEN comparison_outcome = 'MATCH' THEN 1 ELSE 0 END) AS matched,
            SUM(CASE WHEN comparison_outcome IN ('MATCH', 'BOTH_NEED_USER') THEN 1 ELSE 0 END) AS agreed,
            SUM(CASE WHEN comparison_outcome = 'VALUE_MISMATCH' THEN 1 ELSE 0 END) AS value_mismatches,
            SUM(CASE WHEN comparison_outcome = 'VERSIONED_ONLY' THEN 1 ELSE 0 END) AS versioned_only,
            SUM(CASE WHEN comparison_outcome = 'LEGACY_ONLY' THEN 1 ELSE 0 END) AS legacy_only,
            SUM(CASE WHEN production_source = 'VERSIONED' THEN 1 ELSE 0 END) AS versioned_selected,
            SUM(CASE WHEN risk_tier IN ('HIGH', 'PROHIBITED') AND production_source = 'VERSIONED' THEN 1 ELSE 0 END) AS unsafe_versioned_selected
        FROM candidate_answer_resolution_parity_events
        WHERE created_at >= datetime('now', ?)`)
        .get(`-${boundedDays} days`);
    const outcomes = db.prepare(`SELECT comparison_outcome AS outcome, COUNT(*) AS count
        FROM candidate_answer_resolution_parity_events
        WHERE created_at >= datetime('now', ?)
        GROUP BY comparison_outcome ORDER BY count DESC, comparison_outcome`).all(`-${boundedDays} days`)
        .map((row) => ({ outcome: row.outcome, count: Number(row.count) }));
    const compared = Number(totals?.compared || 0);
    const matched = Number(totals?.matched || 0);
    const agreed = Number(totals?.agreed || 0);
    return {
        windowDays: boundedDays,
        compared,
        matched,
        agreed,
        agreementRate: compared ? Number((agreed / compared).toFixed(4)) : 0,
        valueMatchRate: compared ? Number((matched / compared).toFixed(4)) : 0,
        valueMismatches: Number(totals?.value_mismatches || 0),
        versionedOnly: Number(totals?.versioned_only || 0),
        legacyOnly: Number(totals?.legacy_only || 0),
        versionedSelected: Number(totals?.versioned_selected || 0),
        unsafeVersionedSelected: Number(totals?.unsafe_versioned_selected || 0),
        outcomes
    };
}

export function recordCandidateAnswerResolverModeChange(input) {
    const id = `answer_mode_${crypto.randomUUID()}`;
    getDb().prepare(`INSERT INTO candidate_answer_resolver_mode_history
        (id, from_mode, to_mode, canary_percent, gate_passed, gate_snapshot_json,
         reason_codes_json, changed_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.fromMode, input.toMode, input.canaryPercent || 0, input.gatePassed ? 1 : 0,
            JSON.stringify(input.gateSnapshot || {}), JSON.stringify(cleanReasons(input.reasonCodes)),
            String(input.changedBy || "LOCAL_ADMIN").slice(0, 120));
    return { id, ...input };
}

export function listCandidateAnswerResolverModeHistory(limit = 20) {
    return getDb().prepare(`SELECT * FROM candidate_answer_resolver_mode_history
        ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(Math.max(1, Math.min(100, Number(limit) || 20)))
        .map((row) => ({
            id: row.id,
            fromMode: row.from_mode,
            toMode: row.to_mode,
            canaryPercent: Number(row.canary_percent),
            gatePassed: Boolean(row.gate_passed),
            gateSnapshot: parseJson(row.gate_snapshot_json, {}),
            reasonCodes: parseJson(row.reason_codes_json, []),
            changedBy: row.changed_by,
            createdAt: row.created_at
        }));
}

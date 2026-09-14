import crypto from "node:crypto";
import { canonicalContractJson } from "../contracts/contractPrimitives.js";
import { getDb } from "../database/connection.js";

function parseJson(value, fallback) {
    try { return JSON.parse(value || "") ?? fallback; } catch { return fallback; }
}

function publicProposal(row, { includeValue = false } = {}) {
    if (!row) return null;
    return {
        id: row.id,
        userId: row.user_id,
        applicationId: row.application_id,
        runId: row.run_id,
        observationId: row.observation_id,
        fieldLogicalId: row.field_logical_id,
        canonicalKey: row.canonical_key,
        ...(includeValue ? { normalizedValue: parseJson(row.normalized_value_json, null) } : {}),
        finalValueHash: row.final_value_hash,
        context: parseJson(row.context_json, {}),
        scopeQualifiers: parseJson(row.scope_qualifiers_json, {}),
        expectedActiveVersionId: row.expected_active_version_id || null,
        usedAnswerVersionId: row.used_answer_version_id || null,
        source: row.source,
        status: row.status,
        reasonCodes: parseJson(row.reason_codes_json, []),
        changeSetId: row.change_set_id || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

export function stageCandidateAnswerRuntimeProposal(input) {
    const db = getDb();
    return db.transaction(() => {
        db.prepare(`UPDATE candidate_answer_runtime_proposals
            SET status = 'SUPERSEDED', reason_codes_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND run_id = ? AND field_logical_id = ? AND canonical_key = ?
              AND status IN ('PENDING', 'HELD')`)
            .run(canonicalContractJson(["NEWER_FIELD_REVISION_STAGED"]), String(input.userId), input.runId,
                input.fieldLogicalId, input.canonicalKey);
        const id = `runtime_answer_${crypto.randomUUID()}`;
        db.prepare(`INSERT INTO candidate_answer_runtime_proposals
            (id, user_id, application_id, run_id, observation_id, field_logical_id, canonical_key,
             normalized_value_json, final_value_hash, context_json, scope_qualifiers_json,
             expected_active_version_id, used_answer_version_id, source, status, reason_codes_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`)
            .run(id, String(input.userId), input.applicationId, input.runId, input.observationId,
                input.fieldLogicalId, input.canonicalKey, canonicalContractJson(input.normalizedValue),
                input.finalValueHash, canonicalContractJson(input.context || {}),
                canonicalContractJson(input.scopeQualifiers || {}), input.expectedActiveVersionId || null,
                input.usedAnswerVersionId || null, input.source,
                canonicalContractJson(input.reasonCodes || []));
        return publicProposal(db.prepare("SELECT * FROM candidate_answer_runtime_proposals WHERE id = ?").get(id),
            { includeValue: true });
    })();
}

export function listCandidateAnswerRuntimeProposals(userId, { applicationId = null, runId = null,
    statuses = ["PENDING"], ids = null, includeValue = false, limit = 100 } = {}) {
    const clauses = ["user_id = ?"];
    const values = [String(userId)];
    if (applicationId) { clauses.push("application_id = ?"); values.push(String(applicationId)); }
    if (runId) { clauses.push("run_id = ?"); values.push(String(runId)); }
    if (Array.isArray(statuses) && statuses.length) {
        clauses.push(`status IN (${statuses.map(() => "?").join(",")})`);
        values.push(...statuses.map(String));
    }
    if (Array.isArray(ids) && ids.length) {
        clauses.push(`id IN (${ids.map(() => "?").join(",")})`);
        values.push(...ids.map(String));
    }
    values.push(Math.max(1, Math.min(500, Number(limit) || 100)));
    return getDb().prepare(`SELECT * FROM candidate_answer_runtime_proposals
        WHERE ${clauses.join(" AND ")} ORDER BY updated_at ASC, id ASC LIMIT ?`)
        .all(...values).map((row) => publicProposal(row, { includeValue }));
}

export function updateCandidateAnswerRuntimeProposalOutcomes(userId, outcomes = []) {
    if (!outcomes.length) return 0;
    const db = getDb();
    const update = db.prepare(`UPDATE candidate_answer_runtime_proposals
        SET status = ?, reason_codes_json = ?, change_set_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND status IN ('PENDING', 'HELD')`);
    return db.transaction(() => outcomes.reduce((count, outcome) => count + update.run(
        outcome.status, canonicalContractJson(outcome.reasonCodes || []), outcome.changeSetId || null,
        outcome.id, String(userId)).changes, 0))();
}

export function discardCandidateAnswerRuntimeProposals(userId, ids) {
    if (!Array.isArray(ids) || !ids.length) return 0;
    const params = ids.map(String);
    return getDb().prepare(`UPDATE candidate_answer_runtime_proposals
        SET status = 'DISCARDED', reason_codes_json = '["CANDIDATE_KEPT_APPLICATION_ONLY"]',
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND id IN (${params.map(() => "?").join(",")}) AND status = 'HELD'`)
        .run(String(userId), ...params).changes;
}

export function candidateAnswerRuntimeProposalDiagnostics(userId = null) {
    const clause = userId ? "WHERE user_id = ?" : "";
    const args = userId ? [String(userId)] : [];
    return getDb().prepare(`SELECT status, COUNT(*) AS count FROM candidate_answer_runtime_proposals
        ${clause} GROUP BY status ORDER BY status`).all(...args);
}

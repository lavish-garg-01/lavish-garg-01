import { getDb } from "../database/connection.js";

function parseJson(value, fallback) {
    try { return JSON.parse(value || "") ?? fallback; } catch { return fallback; }
}

function publicItem(row) {
    return {
        id: row.id,
        changeSetItemId: row.change_set_item_id || null,
        canonicalKey: row.canonical_key,
        scopeHash: row.scope_hash,
        expectedVersionId: row.expected_version_id || null,
        currentVersionId: row.current_version_id || null,
        previousVersionId: row.previous_version_id || null,
        compensatingVersionId: row.compensating_version_id || null,
        outcome: row.outcome,
        reasonCodes: parseJson(row.reason_codes_json, []),
        createdAt: row.created_at
    };
}

function publicReversal(db, row) {
    if (!row) return null;
    return {
        id: row.id,
        userId: row.user_id,
        operationType: row.operation_type,
        targetChangeSetId: row.target_change_set_id || null,
        targetVersionId: row.target_version_id || null,
        itemCount: Number(row.item_count),
        summary: parseJson(row.summary_json, {}),
        createdAt: row.created_at,
        items: db.prepare(`SELECT * FROM candidate_answer_reversal_items
            WHERE reversal_set_id = ? ORDER BY created_at, canonical_key, id`).all(row.id).map(publicItem)
    };
}

export function getCandidateAnswerReversal(userId, reversalSetId) {
    const db = getDb();
    return publicReversal(db, db.prepare(`SELECT * FROM candidate_answer_reversal_sets
        WHERE id = ? AND user_id = ?`).get(String(reversalSetId), String(userId)));
}

export function getChangeSetUndo(userId, changeSetId) {
    const db = getDb();
    return publicReversal(db, db.prepare(`SELECT * FROM candidate_answer_reversal_sets
        WHERE user_id = ? AND operation_type = 'UNDO_CHANGE_SET' AND target_change_set_id = ?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(String(userId), String(changeSetId)));
}

export function listCandidateAnswerReversals(userId, { limit = 20 } = {}) {
    const db = getDb();
    return db.prepare(`SELECT * FROM candidate_answer_reversal_sets
        WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
        .all(String(userId), Math.max(1, Math.min(100, Number(limit) || 20)))
        .map((row) => publicReversal(db, row));
}

export function candidateAnswerReversalDiagnostics() {
    const db = getDb();
    return {
        operations: Number(db.prepare("SELECT COUNT(*) AS count FROM candidate_answer_reversal_sets").get().count),
        items: Number(db.prepare("SELECT COUNT(*) AS count FROM candidate_answer_reversal_items").get().count),
        byOutcome: db.prepare(`SELECT outcome, COUNT(*) AS count FROM candidate_answer_reversal_items
            GROUP BY outcome ORDER BY outcome`).all()
    };
}

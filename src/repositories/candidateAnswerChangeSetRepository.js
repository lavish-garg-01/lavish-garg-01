import { getDb } from "../database/connection.js";
import { getChangeSetUndo } from "./candidateAnswerReversalRepository.js";

function parseJson(value, fallback) {
    try { return JSON.parse(value || "") ?? fallback; } catch { return fallback; }
}

function publicItem(row) {
    return {
        id: row.id,
        observationId: row.observation_id,
        fieldLogicalId: row.field_logical_id,
        canonicalKey: row.canonical_key,
        scopeHash: row.scope_hash,
        previousVersionId: row.previous_version_id || null,
        learnedVersionId: row.learned_version_id,
        normalizedHash: row.normalized_hash,
        presentationMode: row.presentation_mode,
        transitionKind: row.transition_kind || "CREATE_TRUSTED",
        learningStateBefore: row.learning_state_before || null,
        learningStateAfter: row.learning_state_after || "TRUSTED",
        usedAnswerVersionId: row.used_answer_version_id || null,
        reasonCodes: parseJson(row.reason_codes_json, []),
        status: row.status,
        createdAt: row.created_at
    };
}

function publicChangeSet(db, row) {
    if (!row) return null;
    const undo = getChangeSetUndo(row.user_id, row.id);
    return {
        id: row.id,
        userId: row.user_id,
        applicationId: row.application_id,
        runId: row.run_id,
        checkpointId: row.checkpoint_id,
        checkpointKind: row.checkpoint_kind,
        checkpointRevision: Number(row.checkpoint_revision),
        source: row.source,
        status: row.status,
        itemCount: Number(row.item_count),
        summary: parseJson(row.summary_json, {}),
        createdAt: row.created_at,
        canUndo: !undo,
        undo,
        items: db.prepare(`SELECT * FROM candidate_answer_change_set_items
            WHERE change_set_id = ? ORDER BY created_at, canonical_key, id`).all(row.id).map(publicItem)
    };
}

export function getCandidateAnswerChangeSet(userId, changeSetId) {
    const db = getDb();
    return publicChangeSet(db, db.prepare(`SELECT * FROM candidate_answer_change_sets
        WHERE id = ? AND user_id = ?`).get(String(changeSetId), String(userId)));
}

export function listCandidateAnswerChangeSets(userId, { limit = 20 } = {}) {
    const db = getDb();
    return db.prepare(`SELECT * FROM candidate_answer_change_sets
        WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
        .all(String(userId), Math.max(1, Math.min(100, Number(limit) || 20)))
        .map((row) => publicChangeSet(db, row));
}

export function candidateAnswerChangeSetDiagnostics() {
    const db = getDb();
    const totals = db.prepare(`SELECT COUNT(*) AS change_sets, COALESCE(SUM(item_count), 0) AS learned_items
        FROM candidate_answer_change_sets`).get();
    return {
        changeSets: Number(totals.change_sets || 0),
        learnedItems: Number(totals.learned_items || 0),
        byPresentation: db.prepare(`SELECT presentation_mode AS presentationMode, COUNT(*) AS count
            FROM candidate_answer_change_set_items GROUP BY presentation_mode ORDER BY presentation_mode`).all(),
        byCheckpoint: db.prepare(`SELECT checkpoint_kind AS checkpointKind, COUNT(*) AS count
            FROM candidate_answer_change_sets GROUP BY checkpoint_kind ORDER BY checkpoint_kind`).all()
    };
}

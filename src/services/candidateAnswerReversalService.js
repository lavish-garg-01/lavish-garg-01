import crypto from "node:crypto";
import { z } from "zod";
import { canonicalContractJson, stableContractHash } from "../contracts/contractPrimitives.js";
import { getDb } from "../database/connection.js";
import {
    CandidateAnswerConflictError,
    candidateAnswerContextFromScopeQualifiers,
    saveCandidateAnswerVersionInTransaction
} from "../repositories/candidateAnswerVersionRepository.js";
import {
    getCandidateAnswerReversal,
    getChangeSetUndo,
    listCandidateAnswerReversals
} from "../repositories/candidateAnswerReversalRepository.js";

export const candidateAnswerRestoreSchema = z.object({
    expectedActiveVersionId: z.string().min(1).max(160).nullable()
}).strict();

function boundedIdempotencyKey(value) {
    const key = String(value || "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/.test(key)) {
        throw new Error("A bounded idempotency key is required.");
    }
    return key;
}

function rowValue(row) {
    return JSON.parse(row.value_json);
}

function rowScope(row) {
    return JSON.parse(row.scope_qualifiers_json || "{}");
}

function replay(db, userId, idempotencyKey, payloadHash) {
    const receipt = db.prepare(`SELECT * FROM candidate_answer_reversal_receipts
        WHERE user_id = ? AND idempotency_key = ?`).get(userId, idempotencyKey);
    if (!receipt) return null;
    if (receipt.payload_hash !== payloadHash) {
        const error = new CandidateAnswerConflictError("Idempotency key was reused with a different reversal operation.");
        error.code = "REVERSAL_IDEMPOTENCY_CONFLICT";
        throw error;
    }
    return { ...getCandidateAnswerReversal(userId, receipt.reversal_set_id), idempotentReplay: true };
}

function insertReversalSet(db, { id, userId, operationType, targetChangeSetId = null,
    targetVersionId = null, payloadHash, summary, itemCount }) {
    db.prepare(`INSERT INTO candidate_answer_reversal_sets
        (id, user_id, operation_type, target_change_set_id, target_version_id,
         payload_hash, item_count, summary_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, operationType, targetChangeSetId, targetVersionId,
            payloadHash, itemCount, canonicalContractJson(summary));
}

function insertReversalItem(db, reversalSetId, item) {
    db.prepare(`INSERT INTO candidate_answer_reversal_items
        (id, reversal_set_id, change_set_item_id, canonical_key, scope_hash,
         expected_version_id, current_version_id, previous_version_id,
         compensating_version_id, outcome, reason_codes_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`answer_reversal_item_${crypto.randomUUID()}`, reversalSetId, item.changeSetItemId,
            item.canonicalKey, item.scopeHash, item.expectedVersionId, item.currentVersionId,
            item.previousVersionId, item.compensatingVersionId, item.outcome,
            canonicalContractJson(item.reasonCodes));
}

function insertReceiptAndOutbox(db, { userId, idempotencyKey, payloadHash, reversalSetId,
    runId = null, operationType, itemCount }) {
    db.prepare(`INSERT INTO candidate_answer_reversal_receipts
        (user_id, idempotency_key, payload_hash, reversal_set_id) VALUES (?, ?, ?, ?)`)
        .run(userId, idempotencyKey, payloadHash, reversalSetId);
    db.prepare(`INSERT INTO extension_backend_outbox
        (id, candidate_id, run_id, event_type, aggregate_id, payload_json, available_at_ms)
        VALUES (?, ?, ?, 'CANDIDATE_ANSWER_REVERSAL_COMMITTED', ?, ?, ?)`)
        .run(crypto.randomUUID(), userId, runId, reversalSetId,
            canonicalContractJson({ reversalSetId, operationType, itemCount }), Date.now());
}

/** Undo only the still-current members of one immutable learning change set. */
export function undoCandidateAnswerChangeSet({ userId, changeSetId, idempotencyKey }) {
    const candidateId = String(userId || "");
    if (!candidateId) throw new Error("Candidate identity is required.");
    const key = boundedIdempotencyKey(idempotencyKey);
    const payload = { operationType: "UNDO_CHANGE_SET", changeSetId: String(changeSetId) };
    const payloadHash = stableContractHash(payload);
    const db = getDb();
    return db.transaction(() => {
        const replayed = replay(db, candidateId, key, payloadHash);
        if (replayed) return replayed;
        const already = getChangeSetUndo(candidateId, changeSetId);
        if (already) return { ...already, alreadyReversed: true, idempotentReplay: false };
        const changeSet = db.prepare(`SELECT * FROM candidate_answer_change_sets
            WHERE id = ? AND user_id = ?`).get(String(changeSetId), candidateId);
        if (!changeSet) {
            const error = new Error("Candidate-answer learning change set was not found.");
            error.code = "CHANGE_SET_NOT_FOUND";
            error.status = 404;
            throw error;
        }
        const sourceItems = db.prepare(`SELECT * FROM candidate_answer_change_set_items
            WHERE change_set_id = ? ORDER BY created_at, canonical_key, id`).all(changeSet.id);
        const plans = sourceItems.map((item) => {
            const current = db.prepare(`SELECT * FROM candidate_answer_versions
                WHERE user_id = ? AND canonical_key = ? AND scope_hash = ? AND status = 'ACTIVE'`)
                .get(candidateId, item.canonical_key, item.scope_hash);
            // REMOVE_OVERRIDE intentionally leaves no active row. Its inactive
            // REMOVED version is still the logical head until another write is
            // appended for the same scope. Checking the newest storage row keeps
            // an old Undo from resurrecting an override after a later removal.
            const learnedRemoval = item.transition_kind === "REMOVE_OVERRIDE"
                ? db.prepare(`SELECT rowid AS storage_order, * FROM candidate_answer_versions
                    WHERE id = ? AND user_id = ? AND canonical_key = ? AND scope_hash = ?`)
                    .get(item.learned_version_id, candidateId, item.canonical_key, item.scope_hash)
                : null;
            const latest = learnedRemoval
                ? db.prepare(`SELECT rowid AS storage_order, id FROM candidate_answer_versions
                    WHERE user_id = ? AND canonical_key = ? AND scope_hash = ?
                    ORDER BY rowid DESC LIMIT 1`)
                    .get(candidateId, item.canonical_key, item.scope_hash)
                : null;
            const removalStillCurrent = Boolean(!current && learnedRemoval
                && learnedRemoval.status === "INVALIDATED"
                && learnedRemoval.learning_state === "REMOVED"
                && latest?.id === learnedRemoval.id);
            if (!removalStillCurrent && current?.id !== item.learned_version_id) {
                return { item, current, outcome: "SKIPPED_NEWER_VERSION",
                    reasonCodes: ["NEWER_CANDIDATE_ANSWER_KEPT"] };
            }
            const previous = item.previous_version_id ? db.prepare(`SELECT * FROM candidate_answer_versions
                WHERE id = ? AND user_id = ?`).get(item.previous_version_id, candidateId) : null;
            return previous
                ? { item, current, previous, outcome: "RESTORED", reasonCodes: ["PREVIOUS_SCOPED_ANSWER_RESTORED"] }
                : { item, current, previous: null, outcome: "FORGOTTEN", reasonCodes: ["NEW_SCOPED_ANSWER_REMOVED"] };
        });
        const counts = plans.reduce((result, plan) => ({ ...result,
            [plan.outcome]: (result[plan.outcome] || 0) + 1 }), {});
        const reversalSetId = `answer_reversal_${crypto.randomUUID()}`;
        const summary = {
            restored: counts.RESTORED || 0,
            forgotten: counts.FORGOTTEN || 0,
            skippedNewerVersion: counts.SKIPPED_NEWER_VERSION || 0,
            canonicalKeys: sourceItems.map((item) => item.canonical_key).sort()
        };
        insertReversalSet(db, { id: reversalSetId, userId: candidateId,
            operationType: "UNDO_CHANGE_SET", targetChangeSetId: changeSet.id,
            payloadHash, summary, itemCount: plans.length });
        for (let index = 0; index < plans.length; index += 1) {
            const plan = plans[index];
            let compensatingVersionId = null;
            if (plan.outcome !== "SKIPPED_NEWER_VERSION") {
                const source = plan.previous || plan.current;
                const saved = saveCandidateAnswerVersionInTransaction(db, {
                    userId: candidateId,
                    canonicalKey: source.canonical_key,
                    normalizedValue: rowValue(source),
                    context: candidateAnswerContextFromScopeQualifiers(rowScope(source)),
                    scopeQualifiers: rowScope(source),
                    source: "USER_UNDO",
                    sourceVersionId: reversalSetId,
                    expectedActiveVersionId: plan.current?.id || null,
                    idempotencyKey: `undo:${stableContractHash({ reversalSetId, index }).slice(0, 48)}`,
                    candidateApproved: true,
                    learningState: plan.previous?.learning_state || "REMOVED",
                    originKind: "USER_UNDO",
                    restoresVersionId: plan.previous?.id || null,
                    activate: Boolean(plan.previous),
                    inactiveReason: plan.previous ? null : "UNDO_NEW_SCOPED_ANSWER"
                });
                compensatingVersionId = saved.id;
            }
            insertReversalItem(db, reversalSetId, {
                changeSetItemId: plan.item.id,
                canonicalKey: plan.item.canonical_key,
                scopeHash: plan.item.scope_hash,
                expectedVersionId: plan.item.learned_version_id,
                currentVersionId: plan.current?.id || null,
                previousVersionId: plan.previous?.id || null,
                compensatingVersionId,
                outcome: plan.outcome,
                reasonCodes: plan.reasonCodes
            });
        }
        insertReceiptAndOutbox(db, { userId: candidateId, idempotencyKey: key, payloadHash,
            reversalSetId, runId: changeSet.run_id, operationType: "UNDO_CHANGE_SET", itemCount: plans.length });
        return { ...getCandidateAnswerReversal(candidateId, reversalSetId), idempotentReplay: false };
    })();
}

/** Explicitly restore one historical scoped answer as a new trusted version. */
export function restoreCandidateAnswerVersion({ userId, versionId, idempotencyKey, input }) {
    const candidateId = String(userId || "");
    if (!candidateId) throw new Error("Candidate identity is required.");
    const key = boundedIdempotencyKey(idempotencyKey);
    const parsed = candidateAnswerRestoreSchema.parse(input);
    const payload = { operationType: "RESTORE_VERSION", versionId: String(versionId), ...parsed };
    const payloadHash = stableContractHash(payload);
    const db = getDb();
    return db.transaction(() => {
        const replayed = replay(db, candidateId, key, payloadHash);
        if (replayed) return replayed;
        const target = db.prepare("SELECT * FROM candidate_answer_versions WHERE id = ? AND user_id = ?")
            .get(String(versionId), candidateId);
        if (!target) {
            const error = new Error("Candidate-answer version was not found.");
            error.code = "ANSWER_VERSION_NOT_FOUND";
            error.status = 404;
            throw error;
        }
        const current = db.prepare(`SELECT * FROM candidate_answer_versions
            WHERE user_id = ? AND canonical_key = ? AND scope_hash = ? AND status = 'ACTIVE'`)
            .get(candidateId, target.canonical_key, target.scope_hash);
        if ((current?.id || null) !== parsed.expectedActiveVersionId) throw new CandidateAnswerConflictError();
        if (current?.id === target.id) {
            const error = new CandidateAnswerConflictError("That answer version is already current.");
            error.code = "ANSWER_VERSION_ALREADY_CURRENT";
            throw error;
        }
        const reversalSetId = `answer_reversal_${crypto.randomUUID()}`;
        const summary = { restored: 1, forgotten: 0, skippedNewerVersion: 0,
            canonicalKeys: [target.canonical_key] };
        insertReversalSet(db, { id: reversalSetId, userId: candidateId,
            operationType: "RESTORE_VERSION", targetVersionId: target.id,
            payloadHash, summary, itemCount: 1 });
        const saved = saveCandidateAnswerVersionInTransaction(db, {
            userId: candidateId,
            canonicalKey: target.canonical_key,
            normalizedValue: rowValue(target),
            context: candidateAnswerContextFromScopeQualifiers(rowScope(target)),
            scopeQualifiers: rowScope(target),
            source: "USER_RESTORE",
            sourceVersionId: reversalSetId,
            expectedActiveVersionId: current?.id || null,
            idempotencyKey: `restore:${stableContractHash({ reversalSetId, target: target.id }).slice(0, 48)}`,
            candidateApproved: true,
            learningState: "TRUSTED",
            originKind: "USER_RESTORE",
            restoresVersionId: target.id
        });
        insertReversalItem(db, reversalSetId, {
            changeSetItemId: null,
            canonicalKey: target.canonical_key,
            scopeHash: target.scope_hash,
            expectedVersionId: current?.id || null,
            currentVersionId: current?.id || null,
            previousVersionId: target.id,
            compensatingVersionId: saved.id,
            outcome: "RESTORED",
            reasonCodes: ["HISTORICAL_ANSWER_EXPLICITLY_RESTORED"]
        });
        insertReceiptAndOutbox(db, { userId: candidateId, idempotencyKey: key, payloadHash,
            reversalSetId, operationType: "RESTORE_VERSION", itemCount: 1 });
        return { ...getCandidateAnswerReversal(candidateId, reversalSetId), idempotentReplay: false };
    })();
}

export function candidateAnswerReversalHistory(userId, options = {}) {
    return listCandidateAnswerReversals(userId, options);
}

import { getDb } from "../database/connection.js";
import { canonicalContractJson, stableContractHash } from "../contracts/contractPrimitives.js";
import { parseSharedContract } from "../contracts/sharedContracts.js";
import { fieldInteractionObservationSchema } from "../contracts/fieldInteractionObservation.js";
import { classifyFieldInteraction, fieldLearningClassificationSchema } from "./fieldLearningClassifier.js";
import { routeClassificationEvidence } from "./evidenceRouter.js";

function requireContract(name, input) {
    const parsed = parseSharedContract(name, input);
    if (!parsed.success) {
        const error = new Error(`${name} rejected: ${parsed.reasonCode}.`);
        error.code = parsed.reasonCode;
        throw error;
    }
    return parsed.data;
}

function requireAttempt(applicationId, attemptId) {
    const attempt = getDb().prepare("SELECT id FROM application_attempts WHERE id = ? AND application_id = ?").get(attemptId, applicationId);
    if (!attempt) throw new Error("The contract run does not belong to this application.");
    return attempt;
}

/** Append one immutable, value-free browser revision. Duplicate IDs are safe retries. */
export function recordFieldRevision(applicationId, input) {
    const revision = requireContract("FieldRevision", input);
    requireAttempt(applicationId, revision.identity.runId);
    const result = getDb().prepare(`INSERT OR IGNORE INTO field_revision_events
        (revision_id, application_id, attempt_id, logical_field_fingerprint, operation_id,
         edit_session_id, sequence, actor, event_type, client_time_ms, contract_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(revision.revisionId, applicationId, revision.identity.runId,
            revision.identity.logicalFieldFingerprint, revision.operationId, revision.editSessionId,
            revision.sequence, revision.actor, revision.eventType, revision.clientTimeMs,
            canonicalContractJson(revision));
    return { revisionId: revision.revisionId, recorded: result.changes === 1, duplicate: result.changes === 0 };
}

/** Append a materialized edit-session snapshot without mutating prior history. */
export function recordEditSessionSnapshot(applicationId, input) {
    const session = requireContract("EditSession", input);
    requireAttempt(applicationId, session.identity.runId);
    const id = stableContractHash({
        editSessionId: session.editSessionId,
        lastRevisionSequence: session.lastRevisionSequence,
        status: session.status
    });
    const result = getDb().prepare(`INSERT OR IGNORE INTO field_edit_session_snapshots
        (id, edit_session_id, application_id, attempt_id, logical_field_fingerprint, status,
         first_revision_sequence, last_revision_sequence, contract_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, session.editSessionId, applicationId, session.identity.runId,
            session.identity.logicalFieldFingerprint, session.status,
            session.firstRevisionSequence, session.lastRevisionSequence,
            canonicalContractJson(session));
    return { editSessionId: session.editSessionId, recorded: result.changes === 1, duplicate: result.changes === 0 };
}

export function recordCheckpointReceipt(applicationId, input) {
    const receipt = requireContract("CheckpointReceipt", input);
    if (receipt.applicationId !== applicationId) throw new Error("The checkpoint application does not match this route.");
    requireAttempt(applicationId, receipt.runId);
    const result = getDb().prepare(`INSERT OR IGNORE INTO application_checkpoint_receipts
        (checkpoint_id, application_id, attempt_id, checkpoint_type, status, observed_at_ms,
         evidence_hash, contract_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(receipt.checkpointId, applicationId, receipt.runId, receipt.type, receipt.status,
            receipt.observedAtMs, receipt.evidenceHash, canonicalContractJson(receipt));
    return { checkpointId: receipt.checkpointId, recorded: result.changes === 1, duplicate: result.changes === 0 };
}

/**
 * Persist the neutral observation before its SHADOW classification. Neither
 * table is a learning ledger and this function never changes candidate truth.
 */
export function recordNeutralObservation(applicationId, observationInput, classificationInput = null, options = {}) {
    const observation = fieldInteractionObservationSchema.parse(observationInput);
    if (observation.applicationId !== applicationId) throw new Error("The observation application does not match this route.");
    requireAttempt(applicationId, observation.attemptId);
    const classification = classificationInput ? fieldLearningClassificationSchema.parse(classificationInput) : null;
    if (classification && classification.observationId !== observation.observationId) {
        throw new Error("The classification does not belong to this observation.");
    }
    const db = getDb();
    const result = db.transaction(() => {
        const inserted = db.prepare(`INSERT OR IGNORE INTO field_interaction_observations
            (observation_id, application_id, attempt_id, logical_field_id, event_type,
             protected, contract_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(observation.observationId, applicationId, observation.attemptId,
                observation.logicalFieldId, observation.eventType, observation.protected ? 1 : 0,
                canonicalContractJson(observation));
        let classificationRecorded = false;
        if (classification) {
            const classificationJson = canonicalContractJson(classification);
            const classificationHash = stableContractHash(classification);
            classificationRecorded = db.prepare(`INSERT OR IGNORE INTO field_learning_shadow_classifications
                (id, observation_id, application_id, attempt_id, classification_version,
                 classification_hash, classification_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
                .run(stableContractHash({ observationId: observation.observationId, classificationHash }),
                    observation.observationId, applicationId, observation.attemptId,
                    classification.schemaVersion, classificationHash, classificationJson).changes === 1;
        }
        return { observationRecorded: inserted.changes === 1, classificationRecorded };
    })();
    const adaptiveEvidence = classification && options.adaptiveEvidenceShadow === true
        ? routeClassificationEvidence(observation, classification, options.evidenceContext || {}) : null;
    return { observationId: observation.observationId, ...result,
        ...(adaptiveEvidence ? { adaptiveEvidence: { mode: "SHADOW", updates: adaptiveEvidence } } : {}) };
}

/** Replays persisted neutral observations against a later durable checkpoint. */
export function classifyAttemptAtCheckpoint(applicationId, receiptInput, options = {}) {
    const receipt = requireContract("CheckpointReceipt", receiptInput);
    if (receipt.applicationId !== applicationId) throw new Error("The checkpoint application does not match this route.");
    requireAttempt(applicationId, receipt.runId);
    const db = getDb();
    const rows = db.prepare(`SELECT contract_json FROM field_interaction_observations
        WHERE application_id = ? AND attempt_id = ? ORDER BY created_at`).all(applicationId, receipt.runId);
    const latestPageFingerprint = db.prepare(`SELECT page_fingerprint FROM application_page_snapshots
        WHERE application_id = ? AND attempt_id = ? ORDER BY created_at DESC LIMIT 1`)
        .get(applicationId, receipt.runId)?.page_fingerprint || null;
    let recorded = 0;
    const classified = [];
    const transaction = db.transaction(() => {
        for (const row of rows) {
            const observation = fieldInteractionObservationSchema.parse({
                ...JSON.parse(row.contract_json),
                checkpoint: { type: receipt.type, status: receipt.status }
            });
            const classification = classifyFieldInteraction(observation);
            classified.push({ observation, classification });
            const classificationJson = canonicalContractJson(classification);
            const classificationHash = stableContractHash(classification);
            recorded += db.prepare(`INSERT OR IGNORE INTO field_learning_shadow_classifications
                (id, observation_id, application_id, attempt_id, classification_version,
                 classification_hash, classification_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
                .run(stableContractHash({ observationId: observation.observationId, classificationHash }),
                    observation.observationId, applicationId, receipt.runId,
                    classification.schemaVersion, classificationHash, classificationJson).changes;
        }
    });
    transaction();
    const adaptiveEvidence = options.adaptiveEvidenceShadow === true
        ? classified.flatMap(({ observation, classification }) =>
            routeClassificationEvidence(observation, classification, {
                ...(options.evidenceContext || {}),
                formFingerprint: options.evidenceContext?.formFingerprint || latestPageFingerprint
            })) : null;
    return { observations: rows.length, classificationsRecorded: recorded,
        ...(adaptiveEvidence ? { adaptiveEvidence: { mode: "SHADOW", updates: adaptiveEvidence } } : {}) };
}

export function fieldRevisionDiagnostics(applicationId, attemptId = null) {
    const db = getDb();
    const selected = attemptId
        ? requireAttempt(applicationId, attemptId)
        : db.prepare("SELECT id FROM application_attempts WHERE application_id = ? ORDER BY started_at DESC LIMIT 1").get(applicationId);
    if (!selected) return { attemptId: null, revisions: [], editSessions: [], checkpoints: [], observations: [], classifications: [] };
    const parseRows = (sql) => db.prepare(sql).all(selected.id).map((row) => JSON.parse(row.contract_json || row.classification_json));
    return {
        attemptId: selected.id,
        revisions: parseRows("SELECT contract_json FROM field_revision_events WHERE attempt_id = ? ORDER BY sequence, client_time_ms, created_at"),
        editSessions: parseRows("SELECT contract_json FROM field_edit_session_snapshots WHERE attempt_id = ? ORDER BY created_at"),
        checkpoints: parseRows("SELECT contract_json FROM application_checkpoint_receipts WHERE attempt_id = ? ORDER BY observed_at_ms, created_at"),
        observations: parseRows("SELECT contract_json FROM field_interaction_observations WHERE attempt_id = ? ORDER BY created_at"),
        classifications: db.prepare("SELECT classification_json FROM field_learning_shadow_classifications WHERE attempt_id = ? ORDER BY created_at")
            .all(selected.id).map((row) => JSON.parse(row.classification_json))
    };
}

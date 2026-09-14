import crypto from "crypto";
import { getDb } from "../database/connection.js";
import { addApplicationEvent } from "./applicationRepository.js";
import { LOCAL_USER_ID } from "./copilotRepository.js";
import { AGENT_STATES, QUESTION_TYPES, ANSWER_SCOPES, safeStructuralMapping } from "../services/applicationAgent.js";
import { safeStructuralSelectors } from "../adapters/structuralSelectors.js";

function parseJson(value, fallback) {
    try { return JSON.parse(value || "") ?? fallback; } catch { return fallback; }
}

function publicSession(row) {
    if (!row) return null;
    return {
        id: row.id,
        applicationId: row.application_id,
        currentState: row.current_state,
        currentFieldMappingId: row.current_field_mapping_id,
        pendingQuestion: parseJson(row.pending_question_json, null),
        conversationHistory: parseJson(row.conversation_history_json, []),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

export function getOrCreateAgentSession(applicationId) {
    const db = getDb();
    let row = db.prepare("SELECT * FROM agent_sessions WHERE application_id = ?").get(applicationId);
    if (!row) {
        db.prepare("INSERT INTO agent_sessions (id, application_id) VALUES (?, ?)").run(crypto.randomUUID(), applicationId);
        row = db.prepare("SELECT * FROM agent_sessions WHERE application_id = ?").get(applicationId);
        addApplicationEvent(applicationId, AGENT_STATES.PAGE_DETECTED, "Application agent detected the page.");
    }
    return publicSession(row);
}

export function transitionAgent(applicationId, state, message, metadata = {}) {
    if (!Object.hasOwn(AGENT_STATES, state)) throw new Error(`Invalid agent state: ${state}`);
    const session = getOrCreateAgentSession(applicationId);
    if (session.currentState === state && !message) return session;
    const history = [...session.conversationHistory, { state, message: message || state, at: new Date().toISOString() }].slice(-100);
    getDb().prepare(`
        UPDATE agent_sessions SET current_state = ?, conversation_history_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(state, JSON.stringify(history), session.id);
    addApplicationEvent(applicationId, state, message || state, metadata);
    return getOrCreateAgentSession(applicationId);
}

export function findFieldMapping(siteHost, fieldSignature) {
    const row = getDb().prepare(`
        SELECT id, user_id AS userId, site_host AS siteHost, field_signature AS fieldSignature,
               field_label AS fieldLabel, semantic_key AS semanticKey, status
        FROM field_mappings WHERE user_id = ? AND site_host = ? AND field_signature = ?
    `).get(LOCAL_USER_ID, siteHost, fieldSignature);
    return row ? safeStructuralMapping(row) : null;
}

export function saveLocalDraftMapping({ siteHost, fieldSignature, fieldLabel, semanticKey, status = "LOCAL_DRAFT" }) {
    if (!siteHost || !fieldSignature || !fieldLabel || !semanticKey) throw new Error("Structural mapping fields are required.");
    if (!["LOCAL_DRAFT", "AUTO_INFERRED"].includes(status)) throw new Error("Invalid structural mapping status.");
    const id = crypto.randomUUID();
    getDb().prepare(`
        INSERT INTO field_mappings (id, user_id, site_host, field_signature, field_label, semantic_key, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, site_host, field_signature) DO UPDATE SET
            field_label = excluded.field_label, semantic_key = excluded.semantic_key,
            status = excluded.status, updated_at = CURRENT_TIMESTAMP
    `).run(id, LOCAL_USER_ID, siteHost, fieldSignature, fieldLabel, semanticKey, status);
    return findFieldMapping(siteHost, fieldSignature);
}

function safeSelectorCandidates(candidates = []) {
    return safeStructuralSelectors(candidates);
}

export function savePortalFieldPattern({ siteHost, portalFieldKey, fieldLabel, controlKind, selectorCandidates, containerSignature, semanticKey = null }) {
    if (!siteHost || !portalFieldKey || !fieldLabel) return null;
    const selectors = safeSelectorCandidates(selectorCandidates);
    // A pattern without a structural locator can never be replayed, so storing
    // it would only add unusable rows that later look like learned knowledge.
    if (!selectors.length) return null;
    getDb().prepare(`
        INSERT INTO portal_field_patterns (
            id, user_id, site_host, portal_field_key, field_label, control_kind,
            selector_candidates_json, container_signature, semantic_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, site_host, portal_field_key) DO UPDATE SET
            field_label = excluded.field_label,
            control_kind = excluded.control_kind,
            selector_candidates_json = excluded.selector_candidates_json,
            container_signature = excluded.container_signature,
            semantic_key = COALESCE(excluded.semantic_key, portal_field_patterns.semantic_key),
            observed_count = portal_field_patterns.observed_count + 1,
            last_observed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
    `).run(crypto.randomUUID(), LOCAL_USER_ID, siteHost, String(portalFieldKey).slice(0, 300), String(fieldLabel).slice(0, 500),
        String(controlKind || "text").slice(0, 50), JSON.stringify(selectors), String(containerSignature || "").slice(0, 500) || null,
        semanticKey ? String(semanticKey).slice(0, 100) : null);
    return getDb().prepare(`
        SELECT portal_field_key AS portalFieldKey, field_label AS fieldLabel, control_kind AS controlKind,
               selector_candidates_json AS selectorCandidatesJson, container_signature AS containerSignature,
               semantic_key AS semanticKey, observed_count AS observedCount, success_count AS successCount,
               failure_count AS failureCount
        FROM portal_field_patterns WHERE user_id = ? AND site_host = ? AND portal_field_key = ?
    `).get(LOCAL_USER_ID, siteHost, portalFieldKey);
}

export function recordPortalFieldPatternOutcome(siteHost, portalFieldKey, succeeded, { portalKind = null } = {}) {
    if (!siteHost || !portalFieldKey) return;
    const column = succeeded ? "success_count" : "failure_count";
    const stamp = succeeded ? "last_success_at" : "last_failure_at";
    getDb().prepare(`UPDATE portal_field_patterns
        SET ${column} = ${column} + 1, ${stamp} = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
            portal_kind = COALESCE(?, portal_kind)
        WHERE user_id = ? AND site_host = ? AND portal_field_key = ?`)
        .run(portalKind || null, LOCAL_USER_ID, siteHost, portalFieldKey);
}

export function rejectStaleFieldMapping({ siteHost, fieldSignature, portalFieldKey, observedLabel, inferredSemanticKey }) {
    const db = getDb();
    if (siteHost && fieldSignature) {
        db.prepare(`DELETE FROM field_mappings WHERE user_id = ? AND site_host = ? AND field_signature = ?`)
            .run(LOCAL_USER_ID, siteHost, fieldSignature);
    }
    if (siteHost && portalFieldKey) {
        db.prepare(`UPDATE portal_field_patterns
            SET semantic_key = ?, field_label = COALESCE(?, field_label), failure_count = failure_count + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND site_host = ? AND portal_field_key = ?`)
            .run(inferredSemanticKey || null, observedLabel || null, LOCAL_USER_ID, siteHost, portalFieldKey);
    }
}


export function cleanupStalePortalPatterns({ minFailures = 3 } = {}) {
    const db = getDb();
    const threshold = Math.max(1, Number(minFailures) || 3);
    const emptySelectors = db.prepare(`
        DELETE FROM portal_field_patterns
        WHERE user_id = ?
          AND (
            selector_candidates_json IS NULL
            OR selector_candidates_json = ''
            OR selector_candidates_json = '[]'
          )
    `).run(LOCAL_USER_ID).changes;
    const customFieldNoise = db.prepare(`
        DELETE FROM portal_field_patterns
        WHERE user_id = ?
          AND UPPER(COALESCE(semantic_key, '')) = 'CUSTOM_FIELD'
          AND failure_count >= ?
          AND failure_count > success_count
    `).run(LOCAL_USER_ID, threshold).changes;
    return {
        removedEmptySelectors: Number(emptySelectors || 0),
        removedCustomFieldNoise: Number(customFieldNoise || 0)
    };
}

export function findPortalFieldPattern(siteHost, portalFieldKey) {
    if (!siteHost || !portalFieldKey) return null;
    const row = getDb().prepare(`
        SELECT portal_field_key AS portalFieldKey, field_label AS fieldLabel, control_kind AS controlKind,
               selector_candidates_json AS selectorCandidatesJson, container_signature AS containerSignature,
               semantic_key AS semanticKey, observed_count AS observedCount, success_count AS successCount,
               failure_count AS failureCount
        FROM portal_field_patterns WHERE user_id = ? AND site_host = ? AND portal_field_key = ?
    `).get(LOCAL_USER_ID, siteHost, portalFieldKey);
    if (!row) return null;
    return { ...row, selectorCandidates: parseJson(row.selectorCandidatesJson, []), selectorCandidatesJson: undefined };
}

export function queueAgentQuestion(applicationId, question) {
    if (!QUESTION_TYPES.has(question.questionType)) throw new Error("Invalid agent question type.");
    if (question.answerScope && !ANSWER_SCOPES.has(question.answerScope)) throw new Error("Invalid answer scope.");
    const session = getOrCreateAgentSession(applicationId);
    const existing = getDb().prepare(`SELECT id FROM agent_questions WHERE agent_session_id = ? AND field_id = ? AND question_type = ? AND status = 'PENDING'`)
        .get(session.id, question.fieldId, question.questionType);
    const id = existing?.id || crypto.createHash("sha256").update(`${session.id}:${question.fieldId}:${question.questionType}`).digest("hex").slice(0, 32);
    if (!existing) getDb().prepare(`
        INSERT INTO agent_questions (id, agent_session_id, field_id, question_type, prompt, suggested_semantic_key, answer_scope, options_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, session.id, question.fieldId, question.questionType, question.prompt, question.suggestedSemanticKey || null, question.answerScope || null, JSON.stringify(question.options || []));
    else getDb().prepare(`
        UPDATE agent_questions SET prompt = ?, suggested_semantic_key = ?, answer_scope = ?, options_json = ?
        WHERE id = ?
    `).run(question.prompt, question.suggestedSemanticKey || null, question.answerScope || null, JSON.stringify(question.options || []), id);
    const pending = nextAgentQuestion(session.id);
    getDb().prepare("UPDATE agent_sessions SET pending_question_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(JSON.stringify(pending), session.id);
    return pending;
}

export function nextAgentQuestion(sessionId) {
    const row = getDb().prepare(`
        SELECT id, field_id AS fieldId, question_type AS questionType, prompt,
               suggested_semantic_key AS suggestedSemanticKey, answer_scope AS answerScope, options_json AS optionsJson, status
        FROM agent_questions WHERE agent_session_id = ? AND status = 'PENDING' ORDER BY created_at ASC LIMIT 1
    `).get(sessionId);
    return row ? { ...row, options: parseJson(row.optionsJson, []), optionsJson: undefined } : null;
}

export function countMappingQuestions(applicationId) {
    return getDb().prepare(`
        SELECT COUNT(*) AS count FROM agent_questions q JOIN agent_sessions s ON s.id = q.agent_session_id
        WHERE s.application_id = ? AND q.question_type = 'CONFIRM_MAPPING'
    `).get(applicationId).count;
}

export function hasSkippedAgentQuestion(applicationId, fieldId) {
    return Boolean(getDb().prepare(`
        SELECT 1 FROM agent_questions q JOIN agent_sessions s ON s.id = q.agent_session_id
        WHERE s.application_id = ? AND q.field_id = ? AND q.status = 'SKIPPED' LIMIT 1
    `).get(applicationId, fieldId));
}

export function dismissPendingMappingQuestion(applicationId, fieldId) {
    const db = getDb();
    const session = getOrCreateAgentSession(applicationId);
    db.prepare(`
        UPDATE agent_questions SET status = 'DISMISSED', answered_at = CURRENT_TIMESTAMP
        WHERE agent_session_id = ? AND field_id = ? AND question_type = 'CONFIRM_MAPPING' AND status = 'PENDING'
    `).run(session.id, fieldId);
    const pending = nextAgentQuestion(session.id);
    db.prepare("UPDATE agent_sessions SET pending_question_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(pending ? JSON.stringify(pending) : null, session.id);
    return pending;
}

export function dismissPendingAgentQuestion(applicationId, fieldId) {
    const db = getDb();
    const session = getOrCreateAgentSession(applicationId);
    db.prepare(`
        UPDATE agent_questions SET status = 'DISMISSED', answered_at = CURRENT_TIMESTAMP
        WHERE agent_session_id = ? AND field_id = ? AND status = 'PENDING'
    `).run(session.id, fieldId);
    const pending = nextAgentQuestion(session.id);
    db.prepare("UPDATE agent_sessions SET pending_question_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(pending ? JSON.stringify(pending) : null, session.id);
    return pending;
}

export function answerAgentQuestion(questionId) {
    const db = getDb();
    const question = db.prepare("SELECT * FROM agent_questions WHERE id = ?").get(questionId);
    if (!question) throw new Error("Agent question not found.");
    db.prepare("UPDATE agent_questions SET status = 'ANSWERED', answered_at = CURRENT_TIMESTAMP WHERE id = ?").run(questionId);
    const pending = nextAgentQuestion(question.agent_session_id);
    db.prepare("UPDATE agent_sessions SET pending_question_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(pending ? JSON.stringify(pending) : null, question.agent_session_id);
    return { question, nextQuestion: pending };
}

export function skipAgentQuestion(questionId) {
    const db = getDb();
    const question = db.prepare("SELECT * FROM agent_questions WHERE id = ?").get(questionId);
    if (!question) throw new Error("Agent question not found.");
    db.prepare("UPDATE agent_questions SET status = 'SKIPPED', answered_at = CURRENT_TIMESTAMP WHERE id = ?").run(questionId);
    const pending = nextAgentQuestion(question.agent_session_id);
    db.prepare("UPDATE agent_sessions SET pending_question_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(pending ? JSON.stringify(pending) : null, question.agent_session_id);
    return { question, nextQuestion: pending };
}

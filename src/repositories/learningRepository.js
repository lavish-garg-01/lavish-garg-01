import crypto from "crypto";
import { normalizeControlKind } from "../adapters/controlKinds.js";
import { safeStructuralSelectors } from "../adapters/structuralSelectors.js";
import { honestFillOutcome, legacyFinalState, mappingOutcomeFromFill } from "../adapters/fillOutcomes.js";
import { hostFor as adapterHostFor, portalKindFor } from "../adapters/registry.js";
import { getDb } from "../database/connection.js";
import { LOCAL_USER_ID } from "./copilotRepository.js";

const FIELD_STATES = new Set(["DETECTED", "FILLED", "UNCHANGED", "INVALID", "HIDDEN", "BLOCKED", "USER_EDITED"]);
export const APPLICATION_SESSION_RETENTION_DAYS = 3;

function hostFor(pageUrl = "") {
    return adapterHostFor(pageUrl) || "unknown-site";
}

function valueHash(value, protectedField) {
    if (protectedField || value == null || String(value).trim() === "") return null;
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function ensureApplicationAttempt(applicationId, pageUrl = "") {
    const db = getDb();
    // Keep recovery bounded in SQL: old rows are never loaded merely to decide
    // whether an application session can be resumed.
    db.prepare(`
        UPDATE application_attempts
        SET status = 'EXPIRED', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
        WHERE application_id = ? AND status = 'ACTIVE'
          AND started_at < datetime('now', '-3 days')
    `).run(applicationId);
    let attempt = db.prepare(`
        SELECT * FROM application_attempts
        WHERE application_id = ? AND status = 'ACTIVE'
          AND started_at >= datetime('now', '-3 days')
        ORDER BY started_at DESC LIMIT 1
    `).get(applicationId);
    if (!attempt) {
        const id = crypto.randomUUID();
        db.prepare(`
            INSERT INTO application_attempts (id, application_id, started_url, current_url)
            VALUES (?, ?, ?, ?)
        `).run(id, applicationId, pageUrl || null, pageUrl || null);
        attempt = db.prepare("SELECT * FROM application_attempts WHERE id = ?").get(id);
    } else if (pageUrl && pageUrl !== attempt.current_url) {
        db.prepare("UPDATE application_attempts SET current_url = ? WHERE id = ?").run(pageUrl, attempt.id);
        attempt = db.prepare("SELECT * FROM application_attempts WHERE id = ?").get(attempt.id);
    }
    return attempt;
}

export function completeApplicationAttempt(applicationId, { status, confirmationSource = null, pageUrl = "" } = {}) {
    const attempt = ensureApplicationAttempt(applicationId, pageUrl);
    getDb().prepare(`
        UPDATE application_attempts
        SET status = ?, confirmation_source = ?, current_url = COALESCE(NULLIF(?, ''), current_url), completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(status || "COMPLETED", confirmationSource, pageUrl, attempt.id);
    return getDb().prepare("SELECT * FROM application_attempts WHERE id = ?").get(attempt.id);
}

export function reusableAnswerConsent(applicationId) {
    const row = getDb().prepare(`
        SELECT COALESCE(p.reusable_answer_consent, 0) AS global_consent,
               COALESCE(a.reusable_answer_decision, 'PENDING') AS application_decision
        FROM applications a
        LEFT JOIN candidate_profiles p ON p.user_id = a.user_id
        WHERE a.id = ? AND a.user_id = ?
    `).get(applicationId, LOCAL_USER_ID);
    if (!row) throw new Error("Application not found.");
    const globalConsent = Boolean(row.global_consent);
    const learningDisabledForApplication = row.application_decision === "DECLINED";
    return {
        globalConsent,
        applicationDecision: row.application_decision,
        allowed: globalConsent && !learningDisabledForApplication,
        promptRequired: false,
        learningDisabledForApplication
    };
}

export function setReusableLearningPreference(enabled) {
    getDb().prepare(`UPDATE candidate_profiles SET reusable_answer_consent = ?,
        reusable_answer_consented_at = CASE WHEN ? = 1 THEN COALESCE(reusable_answer_consented_at, CURRENT_TIMESTAMP) ELSE NULL END,
        updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`)
        .run(enabled ? 1 : 0, enabled ? 1 : 0, LOCAL_USER_ID);
    return { enabled: Boolean(enabled) };
}

export function setApplicationLearningDisabled(applicationId, disabled) {
    const db = getDb();
    const application = db.prepare("SELECT user_id FROM applications WHERE id = ? AND user_id = ?").get(applicationId, LOCAL_USER_ID);
    if (!application) throw new Error("Application not found.");
    db.prepare("UPDATE applications SET reusable_answer_decision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(disabled ? "DECLINED" : "PENDING", applicationId);
    return reusableAnswerConsent(applicationId);
}

// Backward-compatible local API wrapper. New UI uses the explicit global
// preference plus per-application opt-out instead of prompting every run.
export function setReusableAnswerConsent(applicationId, approved) {
    if (approved) setReusableLearningPreference(true);
    return setApplicationLearningDisabled(applicationId, !approved);
}

export function recordFieldEvidence(applicationId, pageUrl, fields = [], context = {}) {
    const db = getDb();
    const attempt = ensureApplicationAttempt(applicationId, pageUrl);
    const siteHost = hostFor(pageUrl);
    const portalKind = String(context.portalKind || portalKindFor(pageUrl) || "generic").slice(0, 80);
    const extensionVersion = context.extensionVersion ? String(context.extensionVersion).slice(0, 40) : null;
    const adapterKind = String(context.adapterKind || portalKind).slice(0, 80);
    const adapterVersion = context.adapterVersion ? String(context.adapterVersion).slice(0, 80) : null;
    const mappingPackId = context.mappingPackId ? String(context.mappingPackId).slice(0, 64) : null;
    const mappingPackVersion = context.mappingPackVersion == null ? null : Number(context.mappingPackVersion);
    const mappingStage = context.mappingStage ? String(context.mappingStage).slice(0, 40) : null;
    const pageFingerprint = context.pageFingerprint ? String(context.pageFingerprint).slice(0, 128) : null;
    const upsert = db.prepare(`
        INSERT INTO application_field_evidence (
            id, attempt_id, application_id, page_url, site_host, field_id, field_signature,
            field_label, semantic_key, field_type, options_json, required, is_legal,
            is_sensitive, final_state, answer_source, application_value, validation_json,
            portal_kind, control_kind, fill_outcome, intended_action, extension_version,
            adapter_kind, adapter_version, mapping_pack_id, mapping_pack_version, mapping_stage, page_fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_id, page_url, field_id) DO UPDATE SET
            field_signature = excluded.field_signature, field_label = excluded.field_label,
            semantic_key = COALESCE(excluded.semantic_key, application_field_evidence.semantic_key),
            field_type = excluded.field_type, options_json = excluded.options_json,
            required = excluded.required, is_legal = excluded.is_legal,
            is_sensitive = excluded.is_sensitive,
            final_state = CASE
                WHEN excluded.fill_outcome IN ('NOT_ATTEMPTED','DETECTED','UNCHANGED')
                  AND application_field_evidence.fill_outcome IN ('FILLED','USER_CORRECTED','LEGAL_BLOCK','FILL_FAILED','SNAPSHOT_LIE','BLOCKED','INVALID','HIDDEN')
                THEN application_field_evidence.final_state
                ELSE excluded.final_state
            END,
            answer_source = COALESCE(excluded.answer_source, application_field_evidence.answer_source),
            application_value = CASE
                WHEN excluded.is_legal = 1 OR excluded.is_sensitive = 1 THEN NULL
                WHEN excluded.fill_outcome IN ('NOT_ATTEMPTED','DETECTED','UNCHANGED')
                  AND application_field_evidence.fill_outcome IN ('FILLED','USER_CORRECTED','FILL_FAILED','SNAPSHOT_LIE','BLOCKED','INVALID','HIDDEN')
                THEN application_field_evidence.application_value
                ELSE excluded.application_value
            END,
            validation_json = excluded.validation_json,
            portal_kind = excluded.portal_kind, control_kind = excluded.control_kind,
            fill_outcome = CASE
                WHEN excluded.fill_outcome IN ('NOT_ATTEMPTED','DETECTED','UNCHANGED')
                  AND application_field_evidence.fill_outcome IN ('FILLED','USER_CORRECTED','LEGAL_BLOCK','FILL_FAILED','SNAPSHOT_LIE','BLOCKED','INVALID','HIDDEN')
                THEN application_field_evidence.fill_outcome
                ELSE excluded.fill_outcome
            END,
            intended_action = CASE
                WHEN excluded.fill_outcome IN ('NOT_ATTEMPTED','DETECTED','UNCHANGED')
                  AND application_field_evidence.fill_outcome IN ('FILLED','USER_CORRECTED','LEGAL_BLOCK','FILL_FAILED','SNAPSHOT_LIE','BLOCKED','INVALID','HIDDEN')
                THEN application_field_evidence.intended_action
                ELSE excluded.intended_action
            END,
            extension_version = COALESCE(excluded.extension_version, application_field_evidence.extension_version),
            adapter_kind = COALESCE(excluded.adapter_kind, application_field_evidence.adapter_kind),
            adapter_version = COALESCE(excluded.adapter_version, application_field_evidence.adapter_version),
            mapping_pack_id = COALESCE(excluded.mapping_pack_id, application_field_evidence.mapping_pack_id),
            mapping_pack_version = COALESCE(excluded.mapping_pack_version, application_field_evidence.mapping_pack_version),
            mapping_stage = COALESCE(excluded.mapping_stage, application_field_evidence.mapping_stage),
            page_fingerprint = COALESCE(excluded.page_fingerprint, application_field_evidence.page_fingerprint),
            updated_at = CURRENT_TIMESTAMP
    `);
    const appendTimeline = db.prepare(`
        INSERT INTO application_field_timeline (
            id, attempt_id, application_id, page_url, site_host, portal_kind, field_id, field_label,
            field_signature, control_kind, semantic_key, observed_state, intended_action,
            intended_value_hash, observed_value_hash, answer_source, extension_version,
            adapter_kind, adapter_version, mapping_pack_id, mapping_pack_version, mapping_stage,
            page_fingerprint, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let recorded = 0;
    const transaction = db.transaction(() => {
        for (const field of fields.slice(0, 120)) {
            const legal = Boolean(field.legal);
            const sensitive = Boolean(field.sensitive) || String(field.type || "").toLowerCase() === "password";
            const fillOutcome = honestFillOutcome(field);
            const finalState = FIELD_STATES.has(String(field.finalState || "").toUpperCase())
                ? String(field.finalState).toUpperCase()
                : legacyFinalState(fillOutcome, field);
            const signature = String(field.fieldSignature || `${field.name || field.id || "field"}|${field.type || "text"}|${field.label || "Unknown field"}`).slice(0, 500);
            const fieldId = String(field.id || signature);
            const controlKind = normalizeControlKind(field.controlKind || field.type);
            const intendedAction = field.intendedAction ? String(field.intendedAction).toUpperCase().slice(0, 40) : (fillOutcome === "NOT_ATTEMPTED" ? "NOT_ATTEMPTED" : null);
            upsert.run(
                crypto.randomUUID(), attempt.id, applicationId, String(pageUrl || ""), siteHost,
                fieldId, signature, String(field.label || "Unknown field").slice(0, 500),
                field.semanticKey ? String(field.semanticKey) : null, String(field.type || "text").slice(0, 50),
                JSON.stringify(Array.isArray(field.options) ? field.options.slice(0, 100) : []), field.required ? 1 : 0,
                legal ? 1 : 0, sensitive ? 1 : 0, finalState, field.source ? String(field.source) : null,
                legal || sensitive || field.value == null ? null : String(field.value),
                JSON.stringify({
                    visible: field.visible, filled: field.filled, valid: field.valid,
                    exactOptionMatch: field.exactOptionMatch,
                    selectorCandidates: safeStructuralSelectors(field.selectorCandidates)
                }),
                portalKind, controlKind, fillOutcome, intendedAction, extensionVersion,
                adapterKind, adapterVersion, mappingPackId, mappingPackVersion, mappingStage, pageFingerprint
            );
            appendTimeline.run(
                crypto.randomUUID(), attempt.id, applicationId, String(pageUrl || ""), siteHost, portalKind,
                fieldId, String(field.label || "Unknown field").slice(0, 500), signature, controlKind,
                field.semanticKey ? String(field.semanticKey) : null, fillOutcome, intendedAction,
                valueHash(field.intendedValue, legal || sensitive), valueHash(field.value, legal || sensitive),
                field.source ? String(field.source).slice(0, 80) : null, extensionVersion, adapterKind, adapterVersion,
                mappingPackId, mappingPackVersion, mappingStage, pageFingerprint,
                JSON.stringify({
                    mappingOutcome: mappingOutcomeFromFill(fillOutcome),
                    selectorCandidates: safeStructuralSelectors(field.selectorCandidates)
                })
            );
            recorded += 1;
        }
    });
    transaction();
    return { attemptId: attempt.id, recorded, portalKind, extensionVersion };
}

export function listAttemptTimeline(applicationId) {
    const db = getDb();
    const attempts = db.prepare("SELECT * FROM application_attempts WHERE application_id = ? ORDER BY started_at ASC").all(applicationId);
    return attempts.map((attempt) => ({
        ...attempt,
        events: db.prepare("SELECT * FROM application_events WHERE application_id = ? AND attempt_id = ? ORDER BY id ASC").all(applicationId, attempt.id)
            .map((event) => ({ ...event, metadata: JSON.parse(event.metadata || "{}") })),
        fields: db.prepare("SELECT * FROM application_field_evidence WHERE attempt_id = ? ORDER BY created_at ASC").all(attempt.id),
        timeline: db.prepare("SELECT * FROM application_field_timeline WHERE attempt_id = ? ORDER BY created_at ASC").all(attempt.id)
    }));
}

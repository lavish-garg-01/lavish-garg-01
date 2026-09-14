import crypto from "node:crypto";
import { portalKindFor } from "../adapters/registry.js";
import { getDb } from "../database/connection.js";
import { ensureApplicationAttempt } from "./learningRepository.js";
import { LOCAL_USER_ID } from "./copilotRepository.js";
import { registerCurrentApplicationSchema } from "../services/applicationSchemaRegistry.js";

const OUTCOME_TYPES = new Set(["SUBMITTED", "RECRUITER_RESPONSE", "SCREENING_CALL", "INTERVIEW", "REJECTED", "OFFER", "WITHDRAWN", "FOLLOW_UP_SENT"]);
const OUTCOME_SOURCES = new Set(["CANDIDATE", "BROWSER", "EMPLOYER_PORTAL", "EMAIL", "CALENDAR"]);
const CONFIRMATION_STATES = new Set(["PROPOSED", "CONFIRMED", "REJECTED"]);

function text(value, max = 500) { return String(value == null ? "" : value).trim().slice(0, max); }
function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function hostFor(url = "") { try { return new URL(url).hostname.toLowerCase(); } catch { return "unknown-site"; } }
function normalizedOptions(options) {
    return (Array.isArray(options) ? options : []).slice(0, 100).map((option) =>
        typeof option === "object" ? text(option.value ?? option.label, 200) : text(option, 200)
    ).filter(Boolean).sort();
}
function valueState(field) {
    const state = text(field.finalState, 30).toUpperCase();
    if (state === "USER_EDITED") return "USER_MODIFIED";
    if (["FILLED", "INVALID", "BLOCKED", "HIDDEN", "UNCHANGED"].includes(state)) return state;
    if (field.filled === true) return "FILLED";
    return "EMPTY";
}

export function capturePageSnapshot(applicationId, pageUrl, fields = [], { reason = "OBSERVED", adapterKind = "EXTENSION", adapterVersion = "1", extensionVersion = null, mappingPackVersion = null, mappingStage = null } = {}) {
    const db = getDb();
    const attempt = ensureApplicationAttempt(applicationId, pageUrl);
    const safeFields = (Array.isArray(fields) ? fields : []).slice(0, 120).map((field) => ({
        id: text(field.id || field.name || field.fieldSignature || "field", 300),
        signature: text(field.fieldSignature || `${field.name || field.id || "field"}|${field.type || "text"}|${field.label || "Unknown field"}`, 500),
        label: text(field.label || "Unknown field", 500), semanticKey: field.semanticKey ? text(field.semanticKey, 200) : null,
        type: text(field.type || "text", 50), options: normalizedOptions(field.options), required: Boolean(field.required),
        visible: field.visible !== false, valueState: valueState(field), legal: Boolean(field.legal),
        sensitive: Boolean(field.sensitive) || String(field.type || "").toLowerCase() === "password"
    }));
    const structural = safeFields.map(({ signature, label, semanticKey, type, options, required, visible, legal, sensitive }) =>
        ({ signature, label, semanticKey, type, options, required, visible, legal, sensitive }));
    const pageFingerprint = hash(JSON.stringify(structural));
    const snapshotId = hash(`${attempt.id}|${pageFingerprint}`).slice(0, 32);
    const host = hostFor(pageUrl);
    db.prepare(`INSERT INTO application_page_snapshots
        (id, attempt_id, application_id, page_url, site_host, portal_kind, page_fingerprint, field_count, required_count, snapshot_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_id, page_fingerprint) DO UPDATE SET snapshot_reason = excluded.snapshot_reason`)
        .run(snapshotId, attempt.id, applicationId, text(pageUrl, 2000), host, portalKindFor(pageUrl), pageFingerprint,
            safeFields.length, safeFields.filter((field) => field.required).length, text(reason, 50).toUpperCase() || "OBSERVED");
    const insertField = db.prepare(`INSERT INTO application_field_snapshots
        (id, page_snapshot_id, field_id, field_signature, field_label, semantic_key, field_type, options_hash,
         required, visible, value_state, is_legal, is_sensitive)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(page_snapshot_id, field_id) DO UPDATE SET value_state = excluded.value_state, visible = excluded.visible`);
    const transaction = db.transaction(() => safeFields.forEach((field) => insertField.run(
        hash(`${snapshotId}|${field.id}`).slice(0, 32), snapshotId, field.id, field.signature, field.label, field.semanticKey,
        field.type, hash(JSON.stringify(field.options)), field.required ? 1 : 0, field.visible ? 1 : 0, field.valueState,
        field.legal ? 1 : 0, field.sensitive ? 1 : 0
    )));
    transaction();
    const runId = crypto.randomUUID();
    const portalKind = portalKindFor(pageUrl);
    db.prepare(`INSERT INTO adapter_runs
        (id, attempt_id, application_id, page_snapshot_id, adapter_kind, adapter_version, status, field_count,
         portal_kind, extension_version, mapping_pack_version, mapping_stage)
        VALUES (?, ?, ?, ?, ?, ?, 'STARTED', ?, ?, ?, ?, ?)`)
        .run(runId, attempt.id, applicationId, snapshotId, text(adapterKind, 80), text(adapterVersion, 80), safeFields.length,
            portalKind, extensionVersion ? text(extensionVersion, 40) : null,
            mappingPackVersion == null ? null : Number(mappingPackVersion), mappingStage ? text(mappingStage, 40) : null);
    const schema = registerCurrentApplicationSchema(applicationId);
    return { attemptId: attempt.id, snapshotId, runId, pageFingerprint, fieldCount: safeFields.length,
        schemaId: schema?.id || null, schemaStatus: schema?.status || null };
}

export function completeAdapterRun(runId, { status = "VERIFIED", failureCode = null, filledCount = 0, reviewCount = 0 } = {}) {
    const normalizedStatus = ["VERIFIED", "NEEDS_REVIEW", "FAILED"].includes(String(status).toUpperCase()) ? String(status).toUpperCase() : "FAILED";
    getDb().prepare(`UPDATE adapter_runs SET status = ?, failure_code = ?, filled_count = ?, review_count = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(normalizedStatus, failureCode ? text(failureCode, 100).toUpperCase() : null, Number(filledCount) || 0, Number(reviewCount) || 0, runId);
}

export function recordFieldResolution(applicationId, pageUrl, field, resolution, policyDecision = "REVIEW") {
    const attempt = ensureApplicationAttempt(applicationId, pageUrl);
    const protectedField = Boolean(field?.legal || field?.sensitive) || String(field?.type || "").toLowerCase() === "password";
    const answer = resolution?.answer;
    const sourceType = text(resolution?.source || "UNKNOWN", 80).toUpperCase();
    getDb().prepare(`INSERT INTO field_resolutions
        (id, attempt_id, application_id, page_url, field_id, semantic_key, source_type, source_version,
         confidence, policy_decision, value_hash, evidence_summary, model_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), attempt.id, applicationId, text(pageUrl, 2000), text(field?.id || "field", 300),
            resolution?.normalizedKey ? text(resolution.normalizedKey, 200) : null, sourceType,
            resolution?.sourceVersion ? text(resolution.sourceVersion, 100) : null, Math.max(0, Math.min(1, Number(resolution?.confidence) || 0)),
            text(policyDecision, 50).toUpperCase(), protectedField || answer == null ? null : hash(answer),
            resolution?.evidence ? text(resolution.evidence, 500) : null,
            resolution?.modelVersion ? text(resolution.modelVersion, 100) : null);
}

export function proposeFactCorrection({ semanticKey, factScope, valueType, previousValue, proposedValue, reason = "Repeated candidate correction" }) {
    const key = text(semanticKey, 200).toUpperCase();
    const scope = text(factScope, 100).toUpperCase();
    if (!key || !scope || proposedValue == null || text(proposedValue, 2000) === "") throw new Error("Correction proposal requires key, scope, and value.");
    const proposedHash = hash(proposedValue);
    const id = hash(`${LOCAL_USER_ID}|${key}|${scope}|${proposedHash}`).slice(0, 32);
    getDb().prepare(`INSERT INTO candidate_fact_correction_proposals
        (id, user_id, semantic_key, fact_scope, value_type, previous_value_hash, proposed_value_hash, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, semantic_key, fact_scope, proposed_value_hash) DO UPDATE SET
            observation_count = observation_count + 1, reason = excluded.reason, updated_at = CURRENT_TIMESTAMP`)
        .run(id, LOCAL_USER_ID, key, scope, text(valueType || "TEXT", 50).toUpperCase(), previousValue == null ? null : hash(previousValue), proposedHash, text(reason, 500));
    return getDb().prepare("SELECT * FROM candidate_fact_correction_proposals WHERE id = ?").get(id);
}

export function recordApplicationOutcome({ applicationId, eventType, occurredAt = new Date().toISOString(), evidenceSource = "CANDIDATE", confidence = 1, confirmationStatus, sourceReference = null, note = null }) {
    const type = text(eventType, 50).toUpperCase();
    const source = text(evidenceSource, 50).toUpperCase();
    if (!OUTCOME_TYPES.has(type)) throw new Error("Invalid application outcome type.");
    if (!OUTCOME_SOURCES.has(source)) throw new Error("Invalid application outcome source.");
    const application = getDb().prepare("SELECT id FROM applications WHERE id = ? AND user_id = ?").get(applicationId, LOCAL_USER_ID);
    if (!application) throw new Error("Application not found.");
    const status = text(confirmationStatus || (source === "CANDIDATE" || source === "BROWSER" ? "CONFIRMED" : "PROPOSED"), 30).toUpperCase();
    if (!CONFIRMATION_STATES.has(status)) throw new Error("Invalid outcome confirmation status.");
    const id = crypto.randomUUID();
    getDb().prepare(`INSERT INTO application_outcome_events
        (id, application_id, event_type, occurred_at, evidence_source, confidence, confirmation_status,
         candidate_confirmed_at, source_reference, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, applicationId, type, new Date(occurredAt).toISOString(), source, Math.max(0, Math.min(1, Number(confidence) || 0)), status,
            status === "CONFIRMED" && source === "CANDIDATE" ? new Date().toISOString() : null,
            sourceReference ? text(sourceReference, 500) : null, note ? text(note, 1000) : null);
    return getDb().prepare("SELECT * FROM application_outcome_events WHERE id = ?").get(id);
}

export function confirmApplicationOutcome(id, confirmed) {
    const status = confirmed ? "CONFIRMED" : "REJECTED";
    const result = getDb().prepare(`UPDATE application_outcome_events SET confirmation_status = ?,
        candidate_confirmed_at = CASE WHEN ? = 'CONFIRMED' THEN CURRENT_TIMESTAMP ELSE NULL END
        WHERE id = ? AND application_id IN (SELECT id FROM applications WHERE user_id = ?)`)
        .run(status, status, id, LOCAL_USER_ID);
    if (!result.changes) throw new Error("Outcome event not found.");
    return getDb().prepare("SELECT * FROM application_outcome_events WHERE id = ?").get(id);
}

export function applicationOutcomeReport() {
    const db = getDb();
    const applications = db.prepare("SELECT COUNT(*) AS count FROM applications WHERE user_id = ? AND status = 'SUCCESS'").get(LOCAL_USER_ID).count;
    const known = db.prepare(`SELECT COUNT(DISTINCT application_id) AS count FROM application_outcome_events
        WHERE confirmation_status = 'CONFIRMED' AND application_id IN (SELECT id FROM applications WHERE user_id = ?)`)
        .get(LOCAL_USER_ID).count;
    const events = db.prepare(`SELECT oe.*, j.title, c.name AS company_name FROM application_outcome_events oe
        JOIN applications a ON a.id = oe.application_id JOIN jobs j ON j.id = a.job_id
        LEFT JOIN companies c ON c.id = j.company_id WHERE a.user_id = ? ORDER BY oe.occurred_at DESC`).all(LOCAL_USER_ID);
    return { submittedApplications: applications, applicationsWithKnownOutcome: known,
        coveragePercent: applications ? Number((known * 100 / applications).toFixed(1)) : 0, events };
}

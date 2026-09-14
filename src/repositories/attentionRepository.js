import crypto from "crypto";
import { getDb } from "../database/connection.js";
import { LOCAL_USER_ID } from "./copilotRepository.js";
import { jobPlatform } from "../services/jobPlatform.js";
import { applySupportForJob } from "../services/applySupport.js";

const ATTENTION_TYPES = new Set([
    "FACT_REQUIRED", "PREFERENCE_REQUIRED", "OPEN_ENDED_REVIEW", "SENSITIVE_QUESTION",
    "DATA_CONFLICT", "STALE_INFORMATION", "RESUME_REVIEW", "LOGIN_REQUIRED",
    "CAPTCHA_REQUIRED", "OTP_REQUIRED", "PORTAL_PERMISSION", "LEGAL_CONFIRMATION",
    "UNSUPPORTED_FIELD", "UPLOAD_REQUIRED", "APPLICATION_FAILURE", "VALIDATION_FAILED", "SUBMISSION_REVIEW"
]);

const LEARNING_TYPES = new Set([
    "FACT_CONFIRMED", "FACT_CORRECTED", "ANSWER_REMEMBERED", "ANSWER_REVOKED",
    "DRAFT_APPROVED", "DRAFT_EDITED", "DRAFT_REJECTED", "FIELD_MAPPING_CORRECTED",
    "FIELD_MAPPING_REJECTED", "STALE_APPLICATION_ANSWER_REJECTED", "VALUE_SEMANTIC_MISMATCH",
    "ANSWER_INVALIDATED", "UPLOAD_FAILED", "UNKNOWN_MAPPING", "FORM_CHANGED",
    "SESSION_RECOVERED", "REDIRECT_BLOCKED", "VALIDATION_FAILED",
    "EMPLOYER_CONFIRMATION_DETECTED", "PREFERENCE_CHANGED", "AUTOFILL_DISABLED"
]);

function parseJson(value, fallback) {
    try { return JSON.parse(value || "") ?? fallback; } catch { return fallback; }
}

function publicAttention(row) {
    if (!row) return null;
    return {
        id: row.id, applicationId: row.application_id, fieldId: row.field_id,
        type: row.attention_type, title: row.title, reason: row.reason,
        semanticKey: row.semantic_key, answerScope: row.answer_scope,
        options: parseJson(row.options_json, []), priority: row.priority,
        blocking: Boolean(row.blocking), status: row.status, pageUrl: row.page_url,
        company: row.company_name, role: row.job_title, createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

export function saveApplicationPlan(applicationId, pageUrl, summary, status = "PLAN_READY") {
    const id = crypto.createHash("sha256").update(`${applicationId}|${pageUrl || ""}`).digest("hex").slice(0, 32);
    getDb().prepare(`
        INSERT INTO application_plans (id, application_id, page_url, status, summary_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(application_id, page_url) DO UPDATE SET
            status = excluded.status, summary_json = excluded.summary_json, updated_at = CURRENT_TIMESTAMP
    `).run(id, applicationId, String(pageUrl || ""), status, JSON.stringify(summary || {}));
    return getLatestApplicationPlan(applicationId);
}

export function getLatestApplicationPlan(applicationId) {
    const row = getDb().prepare("SELECT * FROM application_plans WHERE application_id = ? ORDER BY updated_at DESC LIMIT 1").get(applicationId);
    return row ? { id: row.id, applicationId: row.application_id, pageUrl: row.page_url, status: row.status, summary: parseJson(row.summary_json, {}), updatedAt: row.updated_at } : null;
}

export function upsertAttentionItem(applicationId, item) {
    if (!ATTENTION_TYPES.has(item.type)) throw new Error(`Invalid attention type: ${item.type}`);
    const id = crypto.createHash("sha256").update(`${applicationId}|${item.fieldId}`).digest("hex").slice(0, 32);
    getDb().prepare(`
        INSERT INTO attention_items (id, application_id, field_id, attention_type, title, reason,
            semantic_key, answer_scope, options_json, priority, blocking, status, page_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
        ON CONFLICT(application_id, field_id) DO UPDATE SET
            attention_type = excluded.attention_type, title = excluded.title, reason = excluded.reason,
            semantic_key = excluded.semantic_key, answer_scope = excluded.answer_scope,
            options_json = excluded.options_json, priority = excluded.priority, blocking = excluded.blocking,
            status = 'OPEN', page_url = excluded.page_url, resolved_at = NULL, updated_at = CURRENT_TIMESTAMP
    `).run(id, applicationId, String(item.fieldId), item.type, String(item.title).slice(0, 500),
        String(item.reason).slice(0, 1000), item.semanticKey || null, item.answerScope || null,
        JSON.stringify(Array.isArray(item.options) ? item.options.slice(0, 100) : []),
        Number(item.priority || 50), item.blocking === false ? 0 : 1, String(item.pageUrl || ""));
    return id;
}

export function resolveAttentionItem(applicationId, fieldId) {
    getDb().prepare(`UPDATE attention_items SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE application_id = ? AND field_id = ?`).run(applicationId, fieldId);
}

export function resolveAttentionItemsByType(applicationId, type) {
    if (!ATTENTION_TYPES.has(type)) throw new Error(`Invalid attention type: ${type}`);
    return getDb().prepare(`UPDATE attention_items SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE application_id = ? AND attention_type = ? AND status = 'OPEN'`)
        .run(applicationId, type).changes;
}

export function resolveAbsentAttentionItems(applicationId, activeFieldIds = [], pageUrl = "") {
    const active = new Set(activeFieldIds.map(String));
    const open = getDb().prepare("SELECT field_id FROM attention_items WHERE application_id = ? AND status = 'OPEN' AND page_url = ?").all(applicationId, String(pageUrl || ""));
    const update = getDb().prepare("UPDATE attention_items SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE application_id = ? AND field_id = ?");
    for (const row of open) if (!active.has(row.field_id)) update.run(applicationId, row.field_id);
}

export function listAttentionItems({ applicationId = null, status = "OPEN" } = {}) {
    const where = ["ai.status = ?"];
    const params = [status];
    if (applicationId) { where.push("ai.application_id = ?"); params.push(applicationId); }
    return getDb().prepare(`
        SELECT ai.*, j.title AS job_title, c.name AS company_name
        FROM attention_items ai
        JOIN applications a ON a.id = ai.application_id
        JOIN jobs j ON j.id = a.job_id
        LEFT JOIN companies c ON c.id = j.company_id
        WHERE ${where.join(" AND ")}
        ORDER BY ai.blocking DESC, ai.priority DESC, ai.created_at ASC
    `).all(...params).map(publicAttention);
}

export function listAttentionSessions({ sinceDays = 3 } = {}) {
    const days = Math.max(1, Math.min(30, Number(sinceDays) || 3));
    const db = getDb();
    // One row per application. The correlated lookup is deliberately bounded
    // by the retention window, so reopening after expiry creates a fresh entry.
    const rows = db.prepare(`
        SELECT a.id AS application_id, a.job_id, a.status AS application_status,
               j.title AS job_title, j.source AS job_source, j.url AS job_url, c.name AS company_name,
               latest.id AS attempt_id, latest.status AS attempt_status,
               latest.started_at, latest.current_url
        FROM applications a
        JOIN jobs j ON j.id = a.job_id
        LEFT JOIN companies c ON c.id = j.company_id
        JOIN application_attempts latest ON latest.id = (
            SELECT aa.id FROM application_attempts aa
            WHERE aa.application_id = a.id
              AND aa.started_at >= datetime('now', '-' || ? || ' days')
            ORDER BY aa.started_at DESC LIMIT 1
        )
        WHERE a.user_id = ?
        ORDER BY latest.started_at DESC
    `).all(days, LOCAL_USER_ID);
    if (!rows.length) return [];

    const placeholders = rows.map(() => "?").join(",");
    const attemptPlaceholders = rows.map(() => "?").join(",");
    const items = db.prepare(`
        SELECT ai.*, j.title AS job_title, c.name AS company_name
        FROM attention_items ai
        JOIN applications a ON a.id = ai.application_id
        JOIN jobs j ON j.id = a.job_id
        LEFT JOIN companies c ON c.id = j.company_id
        JOIN application_attempts current_attempt
          ON current_attempt.application_id = ai.application_id
         AND current_attempt.id IN (${attemptPlaceholders})
        WHERE ai.status = 'OPEN' AND ai.application_id IN (${placeholders})
          AND ai.updated_at >= datetime('now', '-' || ? || ' days')
          AND ai.updated_at >= current_attempt.started_at
        ORDER BY ai.blocking DESC, ai.priority DESC, ai.updated_at DESC
    `).all(...rows.map((row) => row.attempt_id), ...rows.map((row) => row.application_id), days).map(publicAttention);
    const byApplication = new Map();
    for (const item of items) {
        const group = byApplication.get(item.applicationId) || [];
        group.push(item);
        byApplication.set(item.applicationId, group);
    }
    return rows.map((row) => {
        const sessionItems = byApplication.get(row.application_id) || [];
        return {
            applicationId: row.application_id,
            jobId: row.job_id,
            company: row.company_name,
            role: row.job_title,
            applicationStatus: row.application_status,
            sessionId: row.attempt_id,
            sessionStatus: row.attempt_status,
            startedAt: row.started_at,
            currentUrl: row.current_url,
            platform: jobPlatform({ source: row.job_source, url: row.current_url || row.job_url }),
            applySupport: applySupportForJob({ source: row.job_source, url: row.current_url || row.job_url }),
            attentionCount: sessionItems.length,
            blockingCount: sessionItems.filter((item) => item.blocking).length,
            items: sessionItems
        };
    });
}

export function listAttentionGroups() {
    const groups = new Map();
    for (const item of listAttentionItems()) {
        const optionKey = crypto.createHash("sha256").update(JSON.stringify((item.options || []).map((option) =>
            typeof option === "object" ? String(option.value ?? option.label ?? "") : String(option)
        ).sort())).digest("hex").slice(0, 12);
        // Cross-application grouping is allowed only when semantic identity,
        // decision type, scope, and choice set are compatible.
        const groupKey = `${item.type}|${item.semanticKey || item.title}|${item.answerScope || "UNSCOPED"}|${optionKey}`.toLowerCase();
        const group = groups.get(groupKey) || {
            groupKey,
            type: item.type,
            semanticKey: item.semanticKey || null,
            answerScope: item.answerScope || null,
            title: item.title,
            count: 0,
            blockingCount: 0,
            batchAction: item.type === "DATA_CONFLICT" ? "KEEP_EXISTING" : null,
            itemIds: [],
            applications: []
        };
        group.count += 1;
        group.blockingCount += item.blocking ? 1 : 0;
        group.itemIds.push(item.id);
        group.applications.push({ applicationId: item.applicationId, company: item.company, role: item.role, fieldId: item.fieldId });
        groups.set(groupKey, group);
    }
    return [...groups.values()].sort((a, b) => b.blockingCount - a.blockingCount || b.count - a.count || a.title.localeCompare(b.title));
}

// Batch resolution is intentionally narrow. It may apply the same explicit
// "keep the existing portal value" decision to conflicts, but it can never
// dismiss facts, protected controls, uploads, or submission review in bulk.
export function resolveAttentionBatch({ ids = [], decision, candidateApproved = false } = {}) {
    const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))].slice(0, 50);
    if (!candidateApproved) throw new Error("Candidate approval is required for batch resolution.");
    if (!uniqueIds.length) throw new Error("Select at least one attention item.");
    if (String(decision || "").toUpperCase() !== "KEEP_EXISTING") throw new Error("Unsupported batch resolution decision.");
    const placeholders = uniqueIds.map(() => "?").join(",");
    const rows = getDb().prepare(`SELECT id, application_id, field_id, attention_type
        FROM attention_items WHERE status = 'OPEN' AND id IN (${placeholders})`).all(...uniqueIds);
    if (rows.length !== uniqueIds.length || rows.some((row) => row.attention_type !== "DATA_CONFLICT")) {
        throw new Error("Only open data conflicts can be resolved in a batch.");
    }
    const update = getDb().prepare(`UPDATE attention_items SET status = 'RESOLVED',
        resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'OPEN'`);
    const transaction = getDb().transaction(() => rows.reduce((count, row) => count + update.run(row.id).changes, 0));
    return { resolved: transaction(), decision: "KEEP_EXISTING", items: rows };
}

export function recordLearningEvent({ type, applicationId = null, fieldId = null, memoryKey = null, memoryScope = null, metadata = {} }) {
    if (!LEARNING_TYPES.has(type)) throw new Error(`Invalid learning event type: ${type}`);
    const safeMetadata = {
        source: metadata.source || null,
        changed: metadata.changed === true,
        candidateApproved: metadata.candidateApproved === true,
        protected: metadata.protected === true,
        reason: metadata.reason ? String(metadata.reason).slice(0, 500) : null
    };
    getDb().prepare(`INSERT INTO learning_events
        (id, user_id, event_type, application_id, field_id, memory_key, memory_scope, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), LOCAL_USER_ID, type, applicationId, fieldId, memoryKey, memoryScope, JSON.stringify(safeMetadata));
}

export function attentionCount() {
    return getDb().prepare("SELECT COUNT(*) AS count FROM attention_items WHERE status = 'OPEN' AND blocking = 1").get().count;
}

import crypto from "crypto";
import { getDb } from "../database/connection.js";
import { semanticValueMismatchReason } from "../services/applicationValueValidation.js";
import { portalKindFor } from "../adapters/registry.js";
import { LOCAL_USER_ID } from "./copilotRepository.js";
import { ensureApplicationAttempt } from "./learningRepository.js";

export const APPLICATION_STATUSES = new Set([
    "QUEUED", "OPENING", "FORM_DETECTED", "FIELDS_ANALYZED", "PLAN_READY", "FILLING",
    "WAITING_FOR_USER", "READY_TO_SUBMIT", "SUBMITTING", "VERIFYING", "SUCCESS",
    "FAILED", "BLOCKED", "CAPTCHA_REQUIRED", "LOGIN_REQUIRED", "UNKNOWN_FIELD",
    "USER_ACTION_REQUIRED", "PORTAL_CHANGED"
]);

export function getJobForApplication(jobId) {
    return getDb().prepare(`
        SELECT j.*, c.name AS company_name, c.domain AS company_domain,
               c.overall_score AS company_score, c.score_source AS company_score_source
        FROM jobs j LEFT JOIN companies c ON c.id = j.company_id WHERE j.id = ?
    `).get(jobId);
}

export function createOrResetApplication(job, settings, { realSubmission = false, adapter: requestedAdapter = null } = {}) {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM applications WHERE user_id = ? AND job_id = ?").get(LOCAL_USER_ID, job.id);
    if (existing?.status === "SUCCESS" && existing.adapter === "REAL_WEB") {
        throw new Error("This job already has a verified successful real application.");
    }
    const id = existing?.id || crypto.randomUUID();
    if (existing) {
        db.prepare(`UPDATE application_attempts SET status = 'ABANDONED', completed_at = CURRENT_TIMESTAMP
            WHERE application_id = ? AND status = 'ACTIVE'`).run(existing.id);
    }
    let resumeVersionId = existing?.resume_version_id || null;
    if (job.generated_resume_path) {
        const version = db.prepare(`
            SELECT id FROM resume_versions WHERE user_id = ? AND job_id = ? AND file_path = ? ORDER BY created_at DESC LIMIT 1
        `).get(LOCAL_USER_ID, job.id, job.generated_resume_path);
        resumeVersionId = version?.id || crypto.randomUUID();
        if (!version) {
            db.prepare(`
                INSERT INTO resume_versions (id, user_id, job_id, type, file_path) VALUES (?, ?, ?, 'TAILORED', ?)
            `).run(resumeVersionId, LOCAL_USER_ID, job.id, job.generated_resume_path);
        }
    }
    const adapter = requestedAdapter || (realSubmission ? "REAL_WEB" : "TEST_FORM");
    db.prepare(`
        INSERT INTO applications (id, user_id, job_id, resume_version_id, adapter, mode, status, match_score)
        VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?)
        ON CONFLICT(user_id, job_id) DO UPDATE SET
            adapter = excluded.adapter, mode = excluded.mode, status = 'QUEUED',
            resume_version_id = excluded.resume_version_id,
            match_score = excluded.match_score, failure_reason = NULL,
            reusable_answer_decision = 'PENDING',
            updated_at = CURRENT_TIMESTAMP
    `).run(id, LOCAL_USER_ID, job.id, resumeVersionId, adapter, settings.mode, job.match_score);
    addApplicationEvent(id, "QUEUED", adapter === "EXTENSION"
        ? "Current-browser extension application prepared."
        : realSubmission
            ? "Real job-site application preparation queued."
            : "Application preparation queued in local COPILOT mode.");
    return getApplication(id);
}

export function getApplicationByJobId(jobId) {
    return getDb().prepare(`
        SELECT a.*, j.title, j.url AS job_url, j.generated_resume_path,
               c.name AS company_name
        FROM applications a
        JOIN jobs j ON j.id = a.job_id
        LEFT JOIN companies c ON c.id = j.company_id
        WHERE a.user_id = ? AND a.job_id = ?
    `).get(LOCAL_USER_ID, jobId);
}

export function getApplication(id) {
    return getDb().prepare(`
        SELECT a.*, j.title, j.url AS job_url, j.generated_resume_path,
               c.name AS company_name
        FROM applications a
        JOIN jobs j ON j.id = a.job_id
        LEFT JOIN companies c ON c.id = j.company_id
        WHERE a.id = ?
    `).get(id);
}

export function listApplications() {
    return getDb().prepare(`
        SELECT a.*, j.title, j.url AS job_url, j.source AS job_source, j.status AS job_status, j.yoe_min,
               j.lifecycle_status, j.lifecycle_reason, j.explicit_deadline, j.posted_at,
               c.name AS company_name,
               (SELECT COUNT(*) FROM application_questions q WHERE q.application_id = a.id AND q.status = 'PENDING') AS pending_questions
        FROM applications a
        JOIN jobs j ON j.id = a.job_id
        LEFT JOIN companies c ON c.id = j.company_id
        WHERE a.user_id = ?
        ORDER BY a.created_at DESC
    `).all(LOCAL_USER_ID);
}

export function updateApplicationStatus(id, status, message, { failureReason = null, metadata = {} } = {}) {
    if (!APPLICATION_STATUSES.has(status)) throw new Error(`Invalid application status: ${status}`);
    const current = getApplication(id);
    if (!current) throw new Error("Application not found.");
    // SUCCESS is terminal evidence of a verified submission. Late iframe
    // events, stale tabs, or unlink cleanup must never downgrade it.
    if (current.status === "SUCCESS" && status !== "SUCCESS") return current;
    const started = status === "OPENING" ? "started_at = COALESCE(started_at, CURRENT_TIMESTAMP)," : "";
    const submitted = status === "SUCCESS" ? "submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP)," : "";
    getDb().prepare(`
        UPDATE applications SET ${started} ${submitted}
            status = @status, failure_reason = @failureReason, updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
    `).run({ id, status, failureReason });
    addApplicationEvent(id, status, message || status, metadata);
    return getApplication(id);
}

export function safeEventMetadata(metadata = {}, depth = 0) {
    if (depth > 3 || metadata == null) return null;
    if (Array.isArray(metadata)) return metadata.slice(0, 50).map((item) => safeEventMetadata(item, depth + 1));
    if (typeof metadata !== "object") {
        return typeof metadata === "string" ? metadata.slice(0, 1000) : metadata;
    }
    return Object.fromEntries(Object.entries(metadata)
        .filter(([key]) => {
            const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
            return !/(?:^|_)(?:value|answer|password|otp|captcha|raw|error)(?:$|_)/.test(normalizedKey);
        })
        .map(([key, value]) => [key, safeEventMetadata(value, depth + 1)]));
}

export function addApplicationEvent(applicationId, eventType, message = "", metadata = {}) {
    const pageUrl = String(metadata?.pageUrl || "");
    const attempt = ensureApplicationAttempt(applicationId, pageUrl);
    getDb().prepare(`
        INSERT INTO application_events (application_id, event_type, message, metadata, attempt_id, extension_version, portal_kind)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        applicationId,
        eventType,
        message,
        JSON.stringify(safeEventMetadata(metadata)),
        attempt.id,
        metadata?.extensionVersion ? String(metadata.extensionVersion).slice(0, 40) : null,
        metadata?.portalKind ? String(metadata.portalKind).slice(0, 80) : (pageUrl ? portalKindFor(pageUrl) : null)
    );
}

export function listApplicationEvents(applicationId) {
    return getDb().prepare(`
        SELECT * FROM application_events WHERE application_id = ? ORDER BY id ASC
    `).all(applicationId).map((event) => ({ ...event, metadata: JSON.parse(event.metadata || "{}") }));
}

export function savePendingQuestion(applicationId, field, resolved) {
    const id = crypto.createHash("sha256").update(`${applicationId}:${field.id}`).digest("hex").slice(0, 32);
    getDb().prepare(`
        INSERT INTO application_questions (id, application_id, question_key, question, field_id, confidence, source, evidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(application_id, field_id) DO UPDATE SET
            question_key = excluded.question_key, question = excluded.question,
            confidence = excluded.confidence, source = excluded.source, evidence = excluded.evidence,
            status = 'PENDING', answer = NULL,
            invalidated_reason = NULL, invalidated_at = NULL,
            updated_at = CURRENT_TIMESTAMP
    `).run(
        id,
        applicationId,
        resolved.normalizedKey,
        field.label,
        field.id,
        Number(resolved.confidence || 0),
        resolved.source || null,
        resolved.evidence || null
    );
    return id;
}

export function saveResolvedQuestion(applicationId, field, resolved) {
    const id = crypto.createHash("sha256").update(`${applicationId}:${field.id}`).digest("hex").slice(0, 32);
    getDb().prepare(`
        INSERT INTO application_questions (
            id, application_id, question_key, question, field_id,
            status, answer, confidence, source, evidence
        ) VALUES (?, ?, ?, ?, ?, 'ANSWERED', ?, ?, ?, ?)
        ON CONFLICT(application_id, field_id) DO UPDATE SET
            question_key = excluded.question_key, question = excluded.question,
            status = 'ANSWERED', answer = excluded.answer, confidence = excluded.confidence,
            source = excluded.source, evidence = excluded.evidence,
            invalidated_reason = NULL, invalidated_at = NULL,
            updated_at = CURRENT_TIMESTAMP
    `).run(
        id,
        applicationId,
        resolved.normalizedKey,
        field.label,
        field.id,
        String(resolved.answer),
        Number(resolved.confidence || 0),
        resolved.source || null,
        resolved.evidence || null
    );
    return id;
}

export function listPendingQuestions(applicationId) {
    return getDb().prepare(`
        SELECT * FROM application_questions
        WHERE application_id = ? AND status = 'PENDING' ORDER BY created_at ASC
    `).all(applicationId);
}

export function listApplicationQuestions(applicationId) {
    return getDb().prepare(`
        SELECT * FROM application_questions
        WHERE application_id = ? ORDER BY created_at ASC
    `).all(applicationId);
}

export function invalidateApplicationQuestion(applicationId, fieldId, reason) {
    const db = getDb();
    const prior = db.prepare(`
        SELECT answer, source FROM application_questions
        WHERE application_id = ? AND field_id = ? AND status != 'INVALIDATED'
    `).get(applicationId, fieldId);
    const changes = db.prepare(`
        UPDATE application_questions
        SET status = 'INVALIDATED', answer = NULL, confidence = 0,
            source = 'DATA_INTEGRITY_REPAIR', evidence = ?,
            invalidated_reason = ?, invalidated_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE application_id = ? AND field_id = ? AND status != 'INVALIDATED'
    `).run(
        "Stored answer was quarantined because it did not match the current field semantics.",
        String(reason || "SEMANTIC_MISMATCH").slice(0, 100),
        applicationId,
        fieldId
    ).changes;
    if (changes) {
        const priorValueHash = prior?.answer == null
            ? null
            : crypto.createHash("sha256").update(String(prior.answer)).digest("hex");
        db.prepare(`
            UPDATE field_resolutions
            SET source_type = 'DATA_INTEGRITY_REPAIR', confidence = 0,
                policy_decision = 'REVIEW', value_hash = NULL,
                evidence_summary = 'Quarantined incompatible historical answer.'
            WHERE application_id = ? AND field_id = ? AND value_hash = ?
        `).run(applicationId, fieldId, priorValueHash);
        db.prepare(`
            UPDATE application_field_evidence
            SET application_value = NULL, answer_source = 'DATA_INTEGRITY_REPAIR'
            WHERE application_id = ? AND field_id = ? AND application_value = ?
              AND (answer_source = ? OR (answer_source IS NULL AND ? IS NULL))
        `).run(applicationId, fieldId, prior?.answer ?? null, prior?.source ?? null, prior?.source ?? null);
    }
    return changes;
}

export function invalidateContaminatedApplicationQuestions(applicationId) {
    const rows = getDb().prepare(`
        SELECT * FROM application_questions
        WHERE application_id = ? AND status = 'ANSWERED' AND answer IS NOT NULL
    `).all(applicationId);
    const invalidated = [];
    for (const row of rows) {
        const generic = /^(?:select|search|textbox|input|choose|drop or select(?:\s*\([^)]*\))?|field(?:\s+\d+)?)$/i
            .test(String(row.question || "").trim());
        const uploadAsText = /^(?:RESUME|COVER_LETTER)$/i.test(row.question_key)
            || /^drop or select/i.test(String(row.question || "").trim());
        const aiIdentityFact = String(row.source || "").toUpperCase() === "AI_GROUNDED"
            && (/^(?:LINKEDIN_URL|PORTFOLIO_URL|GITHUB_URL|WEBSITE_URL|SOCIAL_FACEBOOK_URL|SOCIAL_TWITTER_URL|FACEBOOK|X_FKA_TWITTER|PHONE)$/i.test(row.question_key)
                || /^\d{1,4}$/.test(String(row.question_key || "")));
        const reason = generic ? "GENERIC_FIELD_IDENTITY"
            : uploadAsText ? "DOCUMENT_STORED_AS_TEXT"
                : aiIdentityFact ? "AI_IDENTITY_FACT_UNGROUNDED"
                : semanticValueMismatchReason(
                    { label: row.question, type: "text" },
                    { normalizedKey: row.question_key, answer: row.answer }
                );
        if (!reason || !invalidateApplicationQuestion(applicationId, row.field_id, reason)) continue;
        invalidated.push({ fieldId: row.field_id, semanticKey: row.question_key, reason });
        addApplicationEvent(applicationId, "APPLICATION_ANSWER_INVALIDATED",
            "Quarantined an incompatible historical application answer.", {
                metadata: { fieldId: row.field_id, semanticKey: row.question_key, reason, automationEligible: false }
            });
    }
    return invalidated;
}

export function answerApplicationQuestion(questionId, answer) {
    const db = getDb();
    if (!String(answer ?? "").trim()) throw new Error("An answer is required.");
    const question = db.prepare("SELECT * FROM application_questions WHERE id = ?").get(questionId);
    if (!question) throw new Error("Pending question not found.");
    db.prepare(`
        UPDATE application_questions
        SET answer = ?, status = 'ANSWERED', confidence = 1, source = 'USER',
            evidence = 'Candidate confirmed this answer in COPILOT.', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(String(answer).trim(), questionId);
    return question;
}

export function enqueueTask(type, payload, { priority = 0, maxAttempts = 3 } = {}) {
    const id = crypto.randomUUID();
    getDb().prepare(`
        INSERT INTO agent_tasks (id, type, priority, payload, max_attempts)
        VALUES (?, ?, ?, ?, ?)
    `).run(id, type, priority, JSON.stringify(payload || {}), maxAttempts);
    return id;
}

export function claimNextTask() {
    const db = getDb();
    const claim = db.transaction(() => {
        const task = db.prepare(`
            SELECT * FROM agent_tasks
            WHERE status = 'PENDING' AND scheduled_at <= CURRENT_TIMESTAMP
            ORDER BY priority DESC, created_at ASC LIMIT 1
        `).get();
        if (!task) return null;
        db.prepare(`
            UPDATE agent_tasks SET status = 'RUNNING', attempts = attempts + 1,
                started_at = CURRENT_TIMESTAMP, error = NULL WHERE id = ? AND status = 'PENDING'
        `).run(task.id);
        return { ...task, payload: JSON.parse(task.payload || "{}") };
    });
    return claim();
}

export function finishTask(id) {
    getDb().prepare("UPDATE agent_tasks SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

export function failTask(task, error) {
    const retry = Number(task.attempts || 0) + 1 < Number(task.max_attempts || 3);
    getDb().prepare(`
        UPDATE agent_tasks SET status = ?, error = ?, completed_at = CASE WHEN ? THEN NULL ELSE CURRENT_TIMESTAMP END,
            scheduled_at = CASE WHEN ? THEN datetime('now', '+5 seconds') ELSE scheduled_at END
        WHERE id = ?
    `).run(retry ? "PENDING" : "FAILED", String(error.message || error), retry ? 1 : 0, retry ? 1 : 0, task.id);
}

export function applicationMetrics() {
    const db = getDb();
    const row = (sql) => db.prepare(sql).get().n;
    const duration = db.prepare(`
        SELECT AVG((julianday(COALESCE(submitted_at, updated_at)) - julianday(started_at)) * 86400) AS seconds
        FROM applications WHERE started_at IS NOT NULL
    `).get().seconds;
    return {
        totalJobs: row("SELECT COUNT(*) AS n FROM jobs WHERE status != 'ARCHIVED'"),
        qualifiedJobs: row("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('MATCHED','APPROVED','APPLIED')"),
        applicationsPrepared: row("SELECT COUNT(*) AS n FROM applications"),
        applicationsSubmitted: row("SELECT COUNT(*) AS n FROM applications WHERE adapter IN ('REAL_WEB','EXTENSION') AND submitted_at IS NOT NULL"),
        applicationsSuccessful: row("SELECT COUNT(*) AS n FROM applications WHERE adapter IN ('REAL_WEB','EXTENSION') AND status = 'SUCCESS'"),
        applicationsFailed: row("SELECT COUNT(*) AS n FROM applications WHERE status IN ('FAILED','BLOCKED','PORTAL_CHANGED')"),
        unknownQuestionCount: row("SELECT COUNT(*) AS n FROM application_questions WHERE status != 'INVALIDATED'"),
        userInterventionCount: row("SELECT COUNT(*) AS n FROM application_questions WHERE status = 'ANSWERED'"),
        averageApplicationDurationSeconds: duration == null ? null : Math.round(duration),
        averageMatchScore: db.prepare("SELECT ROUND(AVG(match_score), 1) AS n FROM applications").get().n
    };
}

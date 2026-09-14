import { getDb } from "../database/connection.js";
import { aiUsageSummary } from "./aiTelemetry.js";
import { resolveReliabilityScope, scopedSql } from "./reliabilityScope.js";

const SUCCESS = new Set(["FILLED"]);
const CANDIDATE_COMPLETED = new Set(["USER_EDITED", "USER_CORRECTED"]);
const FAILED = new Set(["BLOCKED", "INVALID", "FILL_FAILED", "SNAPSHOT_LIE"]);

function percent(numerator, denominator) {
    return denominator ? Number(((Number(numerator || 0) / Number(denominator || 0)) * 100).toFixed(1)) : null;
}

function countOutcomes(rows = []) {
    const result = { filled: 0, candidateCompleted: 0, failed: 0, notAttempted: 0, other: 0 };
    for (const row of rows) {
        const outcome = String(row.outcome || "DETECTED").toUpperCase();
        const count = Number(row.count || 0);
        if (SUCCESS.has(outcome)) result.filled += count;
        else if (CANDIDATE_COMPLETED.has(outcome)) result.candidateCompleted += count;
        else if (FAILED.has(outcome)) result.failed += count;
        else if (["NOT_ATTEMPTED", "DETECTED", "UNCHANGED", "HIDDEN", "LEGAL_BLOCK"].includes(outcome)) result.notAttempted += count;
        else result.other += count;
    }
    result.attempted = result.filled + result.candidateCompleted + result.failed;
    result.autoAttempted = result.filled + result.failed;
    result.detected = result.attempted + result.notAttempted + result.other;
    return result;
}

function currentMappingMetrics(db, scope) {
    const timeline = scopedSql(scope, { alias: "t", timeColumn: "created_at" });
    const rows = db.prepare(`WITH meaningful AS (
            SELECT t.attempt_id, t.page_url, t.field_id, t.metadata_json, t.created_at,
                   ROW_NUMBER() OVER (
                     PARTITION BY t.attempt_id, t.page_url, t.field_id
                     ORDER BY t.created_at DESC, t.rowid DESC
                   ) AS rank
            FROM application_field_timeline t
            WHERE ${timeline.clause}
              AND json_extract(t.metadata_json, '$.mappingOutcome') IS NOT NULL
        ) SELECT json_extract(metadata_json, '$.mappingOutcome') AS outcome, COUNT(*) AS count
          FROM meaningful WHERE rank = 1 GROUP BY outcome`).all(...timeline.params);
    let succeeded = Number(rows.find((row) => row.outcome === "success")?.count || 0);
    let failed = Number(rows.find((row) => row.outcome === "failure")?.count || 0);
    if (!succeeded && !failed) {
        const fields = scopedSql(scope, { alias: "e" });
        const fallback = countOutcomes(db.prepare(`SELECT COALESCE(e.fill_outcome, e.final_state) AS outcome, COUNT(*) AS count
            FROM application_field_evidence e WHERE ${fields.clause}
              AND e.is_sensitive = 0 AND e.is_legal = 0 AND e.semantic_key IS NOT NULL
            GROUP BY COALESCE(e.fill_outcome, e.final_state)`).all(...fields.params));
        succeeded = fallback.filled + fallback.candidateCompleted;
        failed = fallback.failed;
    }
    return { succeeded, failed, successRate: percent(succeeded, succeeded + failed) };
}

function historicalMappingMetrics(db, scope) {
    const age = `-${scope.days} days`;
    const row = db.prepare(`SELECT COALESCE(SUM(success_count), 0) AS succeeded,
        COALESCE(SUM(failure_count), 0) AS failed, COUNT(*) AS knownPatterns
        FROM portal_field_patterns WHERE updated_at >= datetime('now', ?)`).get(age);
    const succeeded = Number(row.succeeded || 0);
    const failed = Number(row.failed || 0);
    return { succeeded, failed, knownPatterns: Number(row.knownPatterns || 0), successRate: percent(succeeded, succeeded + failed) };
}

function attachmentMetrics(db, scope, fieldOutcomes) {
    const operations = scopedSql(scope, { alias: "o", timeColumn: "created_at" });
    const finals = db.prepare(`WITH ranked AS (
            SELECT o.operation_id, o.status, o.error_code,
                   ROW_NUMBER() OVER (PARTITION BY o.operation_id ORDER BY o.client_time_ms DESC, o.created_at DESC, o.rowid DESC) AS rank
            FROM application_operation_events o
            WHERE ${operations.clause} AND o.phase = 'DOCUMENT'
              AND o.semantic_key IN ('RESUME','COVER_LETTER')
        ) SELECT status, error_code AS errorCode, COUNT(*) AS count
          FROM ranked WHERE rank = 1 AND status IN ('CONFIRMED','FAILED') GROUP BY status, error_code`).all(...operations.params);
    let confirmed = Number(finals.filter((row) => row.status === "CONFIRMED").reduce((sum, row) => sum + Number(row.count || 0), 0));
    let failures = Number(finals.filter((row) => row.status === "FAILED").reduce((sum, row) => sum + Number(row.count || 0), 0));
    let source = "OPERATION_RECEIPT";
    if (!confirmed && !failures) {
        confirmed = fieldOutcomes.filled;
        failures = fieldOutcomes.failed;
        source = "FIELD_EVIDENCE_FALLBACK";
    }
    const receipts = confirmed + failures;
    return {
        confirmed, failures, receipts, detected: fieldOutcomes.detected,
        notAttempted: fieldOutcomes.notAttempted,
        successRate: percent(confirmed, receipts), source
    };
}

function portalBreakdown(db, scope) {
    const base = scopedSql(scope, { alias: "e" });
    const portals = db.prepare(`SELECT DISTINCT COALESCE(NULLIF(e.portal_kind, ''), 'generic') AS portalKind
        FROM application_field_evidence e WHERE ${base.clause} ORDER BY portalKind`).all(...base.params);
    return portals.map(({ portalKind }) => {
        const portalScope = { ...scope, portalKind };
        const fields = scopedSql(portalScope, { alias: "e" });
        const outcomes = countOutcomes(db.prepare(`SELECT COALESCE(e.fill_outcome, e.final_state) AS outcome, COUNT(*) AS count
            FROM application_field_evidence e WHERE ${fields.clause} AND e.is_sensitive = 0 AND e.is_legal = 0
            GROUP BY COALESCE(e.fill_outcome, e.final_state)`).all(...fields.params));
        const files = countOutcomes(db.prepare(`SELECT COALESCE(e.fill_outcome, e.final_state) AS outcome, COUNT(*) AS count
            FROM application_field_evidence e WHERE ${fields.clause} AND e.is_sensitive = 0 AND e.is_legal = 0 AND e.field_type = 'file'
            GROUP BY COALESCE(e.fill_outcome, e.final_state)`).all(...fields.params));
        const mappings = scope.mode === "HISTORICAL" ? null : currentMappingMetrics(db, portalScope);
        const uploads = attachmentMetrics(db, portalScope, files);
        return {
            portalKind,
            autofillRate: percent(outcomes.filled, outcomes.autoAttempted),
            verificationRate: percent(outcomes.filled + outcomes.candidateCompleted, outcomes.attempted),
            mappingRate: mappings?.successRate ?? null,
            uploadRate: uploads.successRate,
            attemptedFields: outcomes.attempted,
            notAttemptedFields: outcomes.notAttempted,
            uploadReceipts: uploads.receipts
        };
    });
}

export function reliabilityReport(options = {}) {
    const db = getDb();
    const scope = resolveReliabilityScope(options);
    const fieldScope = scopedSql(scope, { alias: "e" });
    const outcomeRows = db.prepare(`SELECT COALESCE(e.fill_outcome, e.final_state) AS outcome, COUNT(*) AS count
        FROM application_field_evidence e WHERE ${fieldScope.clause}
          AND e.is_sensitive = 0 AND e.is_legal = 0
        GROUP BY COALESCE(e.fill_outcome, e.final_state)`).all(...fieldScope.params);
    const outcomes = countOutcomes(outcomeRows);
    const fileRows = db.prepare(`SELECT COALESCE(e.fill_outcome, e.final_state) AS outcome, COUNT(*) AS count
        FROM application_field_evidence e WHERE ${fieldScope.clause}
          AND e.is_sensitive = 0 AND e.is_legal = 0 AND e.field_type = 'file'
        GROUP BY COALESCE(e.fill_outcome, e.final_state)`).all(...fieldScope.params);
    const fileOutcomes = countOutcomes(fileRows);
    const attention = db.prepare(`SELECT COUNT(*) AS openItems,
        SUM(CASE WHEN blocking = 1 THEN 1 ELSE 0 END) AS blockingItems
        FROM attention_items WHERE status = 'OPEN' AND updated_at >= datetime(?)`).get(scope.baselineStartedAt);
    const unknown = db.prepare(`SELECT COUNT(*) AS pending
        FROM agent_questions q JOIN agent_sessions s ON s.id = q.agent_session_id
        WHERE q.question_type = 'CONFIRM_MAPPING' AND q.status = 'PENDING'
          AND s.updated_at >= datetime(?)`).get(scope.baselineStartedAt);
    const knownPatterns = db.prepare(`SELECT COUNT(*) AS count FROM portal_field_patterns
        WHERE updated_at >= datetime(?)`).get(scope.baselineStartedAt).count;
    const recovery = db.prepare(`SELECT COUNT(*) AS multiPageSessions,
        SUM(CASE WHEN a.status IN ('READY_TO_SUBMIT','SUCCESS') THEN 1 ELSE 0 END) AS recovered
        FROM applications a JOIN (
          SELECT e.application_id, e.attempt_id FROM application_field_evidence e
          WHERE ${fieldScope.clause} GROUP BY e.application_id, e.attempt_id
          HAVING COUNT(DISTINCT e.page_url) >= 2
        ) multi ON multi.application_id = a.id`).get(...fieldScope.params);
    const applications = db.prepare(`SELECT COUNT(DISTINCT a.id) AS total,
        COUNT(DISTINCT CASE WHEN a.status IN ('READY_TO_SUBMIT','SUCCESS') THEN a.id END) AS prepared,
        COUNT(DISTINCT CASE WHEN a.status = 'SUCCESS' THEN a.id END) AS successful,
        COUNT(DISTINCT CASE WHEN a.status IN ('FAILED','BLOCKED','PORTAL_CHANGED') THEN a.id END) AS failed
        FROM applications a JOIN application_field_evidence e ON e.application_id = a.id
        WHERE ${fieldScope.clause}`).get(...fieldScope.params);
    const mapping = scope.mode === "HISTORICAL" ? historicalMappingMetrics(db, scope) : currentMappingMetrics(db, scope);
    return {
        days: scope.days,
        generatedAt: new Date().toISOString(),
        scope,
        autofill: {
            successRate: percent(outcomes.filled, outcomes.autoAttempted),
            filled: outcomes.filled, attempted: outcomes.autoAttempted,
            detected: outcomes.detected, notAttempted: outcomes.notAttempted,
            candidateCompleted: outcomes.candidateCompleted, failed: outcomes.failed
        },
        verification: {
            successRate: percent(outcomes.filled + outcomes.candidateCompleted, outcomes.attempted),
            verified: outcomes.filled + outcomes.candidateCompleted, attempted: outcomes.attempted
        },
        review: {
            fields: outcomes.failed, openItems: Number(attention.openItems || 0),
            blockingItems: Number(attention.blockingItems || 0)
        },
        uploads: attachmentMetrics(db, scope, fileOutcomes),
        mappings: {
            unknown: Number(unknown.pending || 0), knownPatterns: Number(mapping.knownPatterns ?? knownPatterns ?? 0), ...mapping
        },
        sessions: {
            recovered: Number(recovery.recovered || 0), multiPageSessions: Number(recovery.multiPageSessions || 0),
            recoveryRate: percent(recovery.recovered, recovery.multiPageSessions)
        },
        applications: {
            total: Number(applications.total || 0), prepared: Number(applications.prepared || 0),
            successful: Number(applications.successful || 0), failed: Number(applications.failed || 0)
        },
        byPortal: portalBreakdown(db, scope),
        ai: aiUsageSummary({ days: scope.days })
    };
}

import crypto from "node:crypto";
import { CONNECTED_JOBS_POLICY } from "../config/connectedJobsPolicy.js";
import { getDb } from "../database/connection.js";

export const JOB_LIFECYCLE_STATUSES = Object.freeze([
    "ACTIVE",
    "EXPIRY_SCHEDULED",
    "SUSPECTED_CLOSED",
    "CLOSED",
    "UNKNOWN",
    "REOPENED"
]);

export const AVAILABILITY_RESULTS = Object.freeze(["OPEN", "CLOSED", "UNCERTAIN"]);
export const AVAILABILITY_EVIDENCE_CODES = Object.freeze([
    "NONE",
    "EMPLOYER_CLOSED_MESSAGE",
    "HTTP_404",
    "HTTP_410",
    "ATS_CLOSED_STATE",
    "APPLY_CONTROL_AVAILABLE"
]);

const STRONG_CLOSURE_EVIDENCE = new Set([
    "EMPLOYER_CLOSED_MESSAGE",
    "HTTP_404",
    "HTTP_410",
    "ATS_CLOSED_STATE"
]);

function iso(value = new Date()) {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error("A valid lifecycle timestamp is required.");
    return parsed.toISOString();
}

function safeEvidence(value = {}) {
    const status = Number(value.httpStatus);
    return {
        httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
        pageHost: String(value.pageHost || "").toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 253) || null
    };
}

function jobById(db, jobId) {
    return db.prepare(`SELECT id, lifecycle_status, lifecycle_reason, lifecycle_confidence,
        explicit_deadline, last_verified_at, next_check_at, closed_at, closure_evidence_source,
        posted_at, created_at FROM jobs WHERE id = ?`).get(jobId);
}

function addLifecycleEvent(db, jobId, fromStatus, toStatus, reason, evidenceSource, evidence = {}, now = new Date()) {
    db.prepare(`INSERT INTO job_lifecycle_events
        (id, job_id, from_status, to_status, reason, evidence_source, evidence_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), jobId, fromStatus || null, toStatus, reason, evidenceSource,
            JSON.stringify(evidence), iso(now));
}

function transition(db, job, {
    status,
    reason,
    confidence,
    evidenceSource,
    explicitDeadline = job.explicit_deadline || null,
    lastVerifiedAt = job.last_verified_at || null,
    nextCheckAt = job.next_check_at || null,
    now = new Date(),
    evidence = {}
}) {
    const changed = job.lifecycle_status !== status || job.lifecycle_reason !== reason;
    const closedAt = status === "CLOSED" ? iso(now) : null;
    db.prepare(`UPDATE jobs SET
        lifecycle_status = ?, lifecycle_reason = ?, lifecycle_confidence = ?,
        explicit_deadline = ?, last_verified_at = ?, next_check_at = ?, closed_at = ?,
        closure_evidence_source = ?,
        consecutive_verification_failures = CASE WHEN ? IN ('ACTIVE', 'REOPENED', 'EXPIRY_SCHEDULED') THEN 0
            ELSE consecutive_verification_failures END
        WHERE id = ?`)
        .run(status, reason, confidence, explicitDeadline, lastVerifiedAt, nextCheckAt, closedAt,
            status === "CLOSED" ? evidenceSource : null, status, job.id);
    if (changed) addLifecycleEvent(db, job.id, job.lifecycle_status, status, reason, evidenceSource, evidence, now);
    return { ...job, lifecycle_status: status, lifecycle_reason: reason, lifecycle_confidence: confidence,
        explicit_deadline: explicitDeadline, last_verified_at: lastVerifiedAt, next_check_at: nextCheckAt,
        closed_at: closedAt, closure_evidence_source: status === "CLOSED" ? evidenceSource : null };
}

export function discoveryFreshness(job, now = new Date()) {
    const raw = job?.posted_at || job?.postedAt || job?.created_at || job?.createdAt;
    if (!raw) return "ELIGIBLE";
    const posted = new Date(raw);
    if (Number.isNaN(posted.getTime())) return "ELIGIBLE";
    const days = Math.max(0, (new Date(now).getTime() - posted.getTime()) / 86_400_000);
    if (days <= CONNECTED_JOBS_POLICY.discovery.freshThroughDays) return "FRESH";
    if (days <= CONNECTED_JOBS_POLICY.discovery.eligibleThroughDays) return "ELIGIBLE";
    return "HIDDEN";
}

export function isDiscoverableJob(job, now = new Date()) {
    return job?.lifecycle_status !== "CLOSED" && discoveryFreshness(job, now) !== "HIDDEN";
}

export function observeJobAvailable(jobId, {
    db = getDb(),
    source = "INGESTION",
    confidence = 0.82,
    explicitDeadline = null,
    now = new Date()
} = {}) {
    return db.transaction(() => {
        const job = jobById(db, jobId);
        if (!job) throw new Error("Job not found.");
        const nowIso = iso(now);
        const deadline = explicitDeadline || job.explicit_deadline || null;
        if (deadline && new Date(deadline).getTime() <= new Date(now).getTime()) {
            return transition(db, job, {
                status: "CLOSED", reason: "EXPLICIT_DEADLINE_PASSED", confidence: 1,
                evidenceSource: source, explicitDeadline: iso(deadline), lastVerifiedAt: nowIso,
                nextCheckAt: null, now
            });
        }
        const reopened = job.lifecycle_status === "CLOSED";
        const status = deadline ? "EXPIRY_SCHEDULED" : reopened ? "REOPENED" : "ACTIVE";
        const nextCheck = new Date(new Date(now).getTime()
            + (discoveryFreshness(job, now) === "FRESH" ? 12 : 24) * 3_600_000).toISOString();
        const updated = transition(db, job, {
            status,
            reason: reopened ? "SOURCE_CONFIRMED_REOPENED" : deadline ? "SOURCE_CONFIRMED_WITH_DEADLINE" : "SOURCE_CONFIRMED_AVAILABLE",
            confidence,
            evidenceSource: source,
            explicitDeadline: deadline ? iso(deadline) : null,
            lastVerifiedAt: nowIso,
            nextCheckAt: nextCheck,
            now
        });
        db.prepare(`UPDATE job_verification_requests SET status = 'CANCELLED', updated_at = ?, resolved_at = ?
            WHERE job_id = ? AND status IN ('OPEN', 'CLAIMED')`).run(nowIso, nowIso, jobId);
        return updated;
    })();
}

export function refreshLifecycleBatch(db = getDb(), now = new Date()) {
    return db.transaction(() => {
        const nowIso = iso(now);
        const expiredClaims = db.prepare(`UPDATE job_verification_requests
            SET status = 'OPEN', claimed_by_user_id = NULL, claim_expires_at = NULL, updated_at = ?
            WHERE status = 'CLAIMED' AND datetime(claim_expires_at) <= datetime(?)`).run(nowIso, nowIso).changes;
        const expiredJobs = db.prepare(`SELECT id FROM jobs
            WHERE lifecycle_status != 'CLOSED' AND explicit_deadline IS NOT NULL
              AND datetime(explicit_deadline) <= datetime(?)`).all(nowIso);
        for (const row of expiredJobs) {
            const job = jobById(db, row.id);
            transition(db, job, {
                status: "CLOSED", reason: "EXPLICIT_DEADLINE_PASSED", confidence: 1,
                evidenceSource: "EXPLICIT_DEADLINE", lastVerifiedAt: nowIso, nextCheckAt: null, now
            });
        }
        return { closedByDeadline: expiredJobs.length, releasedClaims: expiredClaims };
    })();
}

function ensureVerificationRequestInTransaction(db, jobId, reason, now) {
    const existing = db.prepare(`SELECT * FROM job_verification_requests
        WHERE job_id = ? AND status IN ('OPEN', 'CLAIMED') ORDER BY created_at LIMIT 1`).get(jobId);
    if (existing) return existing;
    const id = crypto.randomUUID();
    const timestamp = iso(now);
    db.prepare(`INSERT INTO job_verification_requests
        (id, job_id, status, reason, created_at, updated_at) VALUES (?, ?, 'OPEN', ?, ?, ?)`)
        .run(id, jobId, reason, timestamp, timestamp);
    return db.prepare("SELECT * FROM job_verification_requests WHERE id = ?").get(id);
}

export function ensureVerificationRequest(jobId, {
    db = getDb(), reason = "AVAILABILITY_UNCERTAIN", now = new Date()
} = {}) {
    return db.transaction(() => ensureVerificationRequestInTransaction(db, jobId, reason, now))();
}

export function claimAvailabilityVerification(jobId, userId, { db = getDb(), now = new Date() } = {}) {
    return db.transaction(() => {
        let job = jobById(db, jobId);
        if (!job) throw new Error("Job not found.");
        if (["ACTIVE", "REOPENED"].includes(job.lifecycle_status) && job.next_check_at
            && new Date(job.next_check_at).getTime() <= new Date(now).getTime()) {
            job = transition(db, job, {
                status: "UNKNOWN", reason: "SCHEDULED_VERIFICATION_DUE", confidence: 0,
                evidenceSource: "LIFECYCLE_SCHEDULER", nextCheckAt: iso(now), now
            });
        }
        if (!new Set(["UNKNOWN", "SUSPECTED_CLOSED"]).has(job.lifecycle_status)) return null;
        const nowIso = iso(now);
        db.prepare(`UPDATE job_verification_requests SET status = 'OPEN', claimed_by_user_id = NULL,
            claim_expires_at = NULL, updated_at = ? WHERE status = 'CLAIMED'
            AND datetime(claim_expires_at) <= datetime(?)`).run(nowIso, nowIso);
        const alreadyReported = db.prepare(`SELECT 1 FROM job_availability_reports
            WHERE job_id = ? AND user_id = ? AND datetime(created_at) >= datetime(?, '-7 days') LIMIT 1`)
            .get(jobId, userId, nowIso);
        if (alreadyReported) return null;
        const dailyPrompt = db.prepare(`SELECT 1 FROM job_verification_requests
            WHERE claimed_by_user_id = ? AND datetime(updated_at) >= datetime(?, 'start of day') LIMIT 1`)
            .get(userId, nowIso);
        if (dailyPrompt) return null;
        let request = ensureVerificationRequestInTransaction(db, jobId, job.lifecycle_reason || "AVAILABILITY_UNCERTAIN", now);
        if (request.status === "CLAIMED" && request.claimed_by_user_id !== userId) return null;
        const claimExpiresAt = new Date(new Date(now).getTime() + 15 * 60_000).toISOString();
        const changed = db.prepare(`UPDATE job_verification_requests SET status = 'CLAIMED',
            claimed_by_user_id = ?, claim_expires_at = ?, updated_at = ?
            WHERE id = ? AND status = 'OPEN'`).run(userId, claimExpiresAt, nowIso, request.id).changes;
        if (!changed && request.claimed_by_user_id !== userId) return null;
        request = db.prepare("SELECT * FROM job_verification_requests WHERE id = ?").get(request.id);
        return {
            requestId: request.id,
            jobId,
            question: "Were you able to open this application?",
            options: AVAILABILITY_RESULTS,
            expiresAt: request.claim_expires_at
        };
    })();
}

export function submitAvailabilityFeedback(jobId, userId, input = {}, { db = getDb(), now = new Date() } = {}) {
    return db.transaction(() => {
        const result = String(input.result || "").toUpperCase();
        const evidenceCode = String(input.evidenceCode || "NONE").toUpperCase();
        if (!AVAILABILITY_RESULTS.includes(result)) throw new Error("Invalid availability result.");
        if (!AVAILABILITY_EVIDENCE_CODES.includes(evidenceCode)) throw new Error("Invalid availability evidence code.");
        const job = jobById(db, jobId);
        if (!job) throw new Error("Job not found.");
        const request = db.prepare("SELECT * FROM job_verification_requests WHERE id = ? AND job_id = ?")
            .get(input.requestId, jobId);
        if (!request || request.status !== "CLAIMED" || request.claimed_by_user_id !== userId) {
            throw new Error("This availability check is no longer assigned to you.");
        }
        const timestamp = iso(now);
        const evidence = safeEvidence(input);
        const strongClose = result === "CLOSED" && (STRONG_CLOSURE_EVIDENCE.has(evidenceCode)
            || evidence.httpStatus === 404 || evidence.httpStatus === 410);
        const confidence = result === "OPEN"
            ? evidenceCode === "APPLY_CONTROL_AVAILABLE" ? 0.98 : 0.8
            : result === "CLOSED" ? strongClose ? 0.98 : 0.55 : 0;
        db.prepare(`INSERT INTO job_availability_reports
            (id, job_id, request_id, user_id, result, evidence_source, evidence_code, confidence, evidence_json, created_at)
            VALUES (?, ?, ?, ?, ?, 'USER_INTERACTION', ?, ?, ?, ?)`)
            .run(crypto.randomUUID(), jobId, request.id, userId, result, evidenceCode, confidence,
                JSON.stringify(evidence), timestamp);
        db.prepare(`UPDATE job_verification_requests SET status = 'RESOLVED', result = ?,
            updated_at = ?, resolved_at = ? WHERE id = ?`).run(result, timestamp, timestamp, request.id);

        let updated = job;
        if (result === "OPEN") {
            const unsupportedClosedReport = db.prepare(`SELECT 1 FROM job_availability_reports
                WHERE job_id = ? AND result = 'CLOSED'
                  AND evidence_code = 'NONE' AND datetime(created_at) >= datetime(?, '-7 days') LIMIT 1`)
                .get(jobId, timestamp);
            const strongOpen = evidenceCode === "APPLY_CONTROL_AVAILABLE";
            if (unsupportedClosedReport && !strongOpen) {
                updated = transition(db, job, {
                    status: "UNKNOWN", reason: "CONFLICTING_USER_REPORTS", confidence: 0,
                    evidenceSource: "USER_INTERACTION", lastVerifiedAt: timestamp,
                    nextCheckAt: timestamp, now, evidence
                });
            } else {
                updated = transition(db, job, {
                    status: job.lifecycle_status === "CLOSED" ? "REOPENED" : "ACTIVE",
                    reason: "USER_CONFIRMED_AVAILABLE", confidence, evidenceSource: "USER_INTERACTION",
                    lastVerifiedAt: timestamp,
                    nextCheckAt: new Date(new Date(now).getTime() + 24 * 3_600_000).toISOString(), now, evidence
                });
                db.prepare(`UPDATE job_verification_requests SET status = 'CANCELLED', updated_at = ?, resolved_at = ?
                    WHERE job_id = ? AND status IN ('OPEN', 'CLAIMED')`).run(timestamp, timestamp, jobId);
            }
        } else if (strongClose) {
            updated = transition(db, job, {
                status: "CLOSED", reason: `EXPLICIT_${evidenceCode}`, confidence,
                evidenceSource: "USER_INTERACTION", lastVerifiedAt: timestamp, nextCheckAt: null, now, evidence
            });
        } else if (result === "CLOSED") {
            const reports = db.prepare(`SELECT result, user_id FROM job_availability_reports
                WHERE job_id = ? AND datetime(created_at) >= datetime(?, '-7 days')`).all(jobId, timestamp);
            const closedUsers = new Set(reports.filter((report) => report.result === "CLOSED").map((report) => report.user_id));
            const openUsers = new Set(reports.filter((report) => report.result === "OPEN").map((report) => report.user_id));
            if (openUsers.size) {
                updated = transition(db, job, {
                    status: "UNKNOWN", reason: "CONFLICTING_USER_REPORTS", confidence: 0,
                    evidenceSource: "USER_INTERACTION", lastVerifiedAt: timestamp,
                    nextCheckAt: timestamp, now
                });
            } else if (closedUsers.size >= CONNECTED_JOBS_POLICY.availabilityVerification.unsupportedReportsToClose) {
                updated = transition(db, job, {
                    status: "CLOSED", reason: "INDEPENDENT_USER_CORROBORATION", confidence: 0.82,
                    evidenceSource: "USER_INTERACTION", lastVerifiedAt: timestamp, nextCheckAt: null, now
                });
            } else {
                updated = transition(db, job, {
                    status: "SUSPECTED_CLOSED", reason: "ONE_UNSUPPORTED_USER_REPORT", confidence,
                    evidenceSource: "USER_INTERACTION", lastVerifiedAt: timestamp,
                    nextCheckAt: timestamp, now
                });
            }
        }

        if (updated.lifecycle_status === "CLOSED") {
            db.prepare(`UPDATE job_verification_requests SET status = 'CANCELLED', updated_at = ?, resolved_at = ?
                WHERE job_id = ? AND status IN ('OPEN', 'CLAIMED')`).run(timestamp, timestamp, jobId);
        } else if (["UNKNOWN", "SUSPECTED_CLOSED"].includes(updated.lifecycle_status)) {
            ensureVerificationRequestInTransaction(db, jobId,
                updated.lifecycle_status === "UNKNOWN" ? "CONFLICTING_REPORTS" : "NEEDS_INDEPENDENT_CONFIRMATION", now);
        }
        return publicJobLifecycle(updated);
    })();
}

export function publicJobLifecycle(job) {
    const status = job?.lifecycle_status || "UNKNOWN";
    return {
        status,
        reason: job?.lifecycle_reason || null,
        confidence: Number(job?.lifecycle_confidence || 0),
        explicitDeadline: job?.explicit_deadline || null,
        lastVerifiedAt: job?.last_verified_at || null,
        closedAt: job?.closed_at || null,
        verificationRecommended: status === "UNKNOWN" || status === "SUSPECTED_CLOSED"
    };
}

export function assertJobCanApply(job, now = new Date()) {
    if (!job) throw new Error("Job not found.");
    if (job.lifecycle_status === "CLOSED"
        || (job.explicit_deadline && new Date(job.explicit_deadline).getTime() <= new Date(now).getTime())) {
        const error = new Error("This application is confirmed closed.");
        error.code = "JOB_CLOSED";
        throw error;
    }
    return true;
}

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
    assertJobCanApply,
    claimAvailabilityVerification,
    discoveryFreshness,
    submitAvailabilityFeedback
} from "../src/services/jobLifecycle.js";

function lifecycleDb(status = "UNKNOWN") {
    const db = new Database(":memory:");
    db.exec(`
        CREATE TABLE jobs (
            id TEXT PRIMARY KEY, lifecycle_status TEXT, lifecycle_reason TEXT,
            lifecycle_confidence REAL DEFAULT 0, explicit_deadline DATETIME,
            last_verified_at DATETIME, next_check_at DATETIME, closed_at DATETIME,
            closure_evidence_source TEXT, consecutive_verification_failures INTEGER DEFAULT 0,
            posted_at DATETIME, created_at DATETIME
        );
        CREATE TABLE job_lifecycle_events (
            id TEXT PRIMARY KEY, job_id TEXT, from_status TEXT, to_status TEXT, reason TEXT,
            evidence_source TEXT, evidence_json TEXT, created_at DATETIME
        );
        CREATE TABLE job_verification_requests (
            id TEXT PRIMARY KEY, job_id TEXT, status TEXT, reason TEXT, claimed_by_user_id TEXT,
            claim_expires_at DATETIME, result TEXT, created_at DATETIME, updated_at DATETIME, resolved_at DATETIME
        );
        CREATE UNIQUE INDEX idx_job_verification_one_open ON job_verification_requests(job_id)
            WHERE status IN ('OPEN', 'CLAIMED');
        CREATE TABLE job_availability_reports (
            id TEXT PRIMARY KEY, job_id TEXT, request_id TEXT, user_id TEXT, result TEXT,
            evidence_source TEXT, evidence_code TEXT, confidence REAL, evidence_json TEXT, created_at DATETIME
        );
    `);
    db.prepare(`INSERT INTO jobs (id, lifecycle_status, lifecycle_reason, posted_at, created_at, next_check_at)
        VALUES ('job-1', ?, 'NEEDS_CHECK', '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z', '2026-08-28T00:00:00.000Z')`)
        .run(status);
    return db;
}

test("discovery freshness follows the shared 7/14-day policy", () => {
    const now = new Date("2026-08-28T12:00:00.000Z");
    assert.equal(discoveryFreshness({ posted_at: "2026-08-23T12:00:00.000Z" }, now), "FRESH");
    assert.equal(discoveryFreshness({ posted_at: "2026-08-18T12:00:00.000Z" }, now), "ELIGIBLE");
    assert.equal(discoveryFreshness({ posted_at: "2026-08-01T12:00:00.000Z" }, now), "HIDDEN");
});

test("one unsupported closure report only marks suspected; two independent reports close globally", () => {
    const db = lifecycleDb();
    const now = new Date("2026-08-28T12:00:00.000Z");
    try {
        const first = claimAvailabilityVerification("job-1", "user-a", { db, now });
        assert.ok(first?.requestId);
        assert.equal(claimAvailabilityVerification("job-1", "user-b", { db, now }), null,
            "only one user is disturbed at a time");
        const suspected = submitAvailabilityFeedback("job-1", "user-a", {
            requestId: first.requestId, result: "CLOSED", evidenceCode: "NONE"
        }, { db, now });
        assert.equal(suspected.status, "SUSPECTED_CLOSED");
        assert.equal(claimAvailabilityVerification("job-1", "user-a", { db, now }), null,
            "the reporting user is not asked again");

        const second = claimAvailabilityVerification("job-1", "user-b", {
            db, now: new Date("2026-08-28T12:01:00.000Z")
        });
        const closed = submitAvailabilityFeedback("job-1", "user-b", {
            requestId: second.requestId, result: "CLOSED", evidenceCode: "NONE"
        }, { db, now: new Date("2026-08-28T12:02:00.000Z") });
        assert.equal(closed.status, "CLOSED");
        assert.equal(closed.reason, "INDEPENDENT_USER_CORROBORATION");
        assert.throws(() => assertJobCanApply(db.prepare("SELECT * FROM jobs WHERE id='job-1'").get()),
            /confirmed closed/);
    } finally { db.close(); }
});

test("explicit employer evidence can close once while conflicting soft reports remain unknown", () => {
    const now = new Date("2026-08-28T12:00:00.000Z");
    const explicitDb = lifecycleDb();
    try {
        const request = claimAvailabilityVerification("job-1", "user-a", { db: explicitDb, now });
        const result = submitAvailabilityFeedback("job-1", "user-a", {
            requestId: request.requestId, result: "CLOSED", evidenceCode: "EMPLOYER_CLOSED_MESSAGE",
            pageHost: "jobs.example.in"
        }, { db: explicitDb, now });
        assert.equal(result.status, "CLOSED");
        assert.equal(explicitDb.prepare("SELECT COUNT(*) AS count FROM job_availability_reports").get().count, 1);
    } finally { explicitDb.close(); }

    const conflictDb = lifecycleDb();
    try {
        const first = claimAvailabilityVerification("job-1", "user-a", { db: conflictDb, now });
        submitAvailabilityFeedback("job-1", "user-a", {
            requestId: first.requestId, result: "CLOSED", evidenceCode: "NONE"
        }, { db: conflictDb, now });
        const secondNow = new Date("2026-08-28T12:01:00.000Z");
        const second = claimAvailabilityVerification("job-1", "user-b", { db: conflictDb, now: secondNow });
        const result = submitAvailabilityFeedback("job-1", "user-b", {
            requestId: second.requestId, result: "OPEN", evidenceCode: "NONE"
        }, { db: conflictDb, now: secondNow });
        assert.equal(result.status, "UNKNOWN");
        assert.equal(result.reason, "CONFLICTING_USER_REPORTS");
    } finally { conflictDb.close(); }
});

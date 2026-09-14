import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { archiveStaleJobs, getPipelineRunState, launchPipelineRun, parseProcessLimit } from "../src/services/pipelineRunner.js";
import { selectPendingJobsForProcessing } from "../src/services/openai.js";

test("parseProcessLimit accepts whole numbers from 1 to 100", () => {
    assert.equal(parseProcessLimit("1"), 1);
    assert.equal(parseProcessLimit("25"), 25);
    assert.equal(parseProcessLimit("100"), 100);
    assert.throws(() => parseProcessLimit("0"), /whole number from 1 to 100/);
    assert.throws(() => parseProcessLimit("3.5"), /whole number from 1 to 100/);
    assert.throws(() => parseProcessLimit("101"), /whole number from 1 to 100/);
});

test("lifecycle refresh closes explicit deadlines without archiving jobs by age", () => {
    const db = new Database(":memory:");
    db.exec(`
        CREATE TABLE jobs (
            id TEXT PRIMARY KEY,
            status TEXT,
            posted_at DATETIME,
            created_at DATETIME,
            archived_from_status TEXT,
            archived_at DATETIME,
            lifecycle_status TEXT DEFAULT 'ACTIVE', lifecycle_reason TEXT,
            lifecycle_confidence REAL DEFAULT 0, explicit_deadline DATETIME,
            last_verified_at DATETIME, next_check_at DATETIME, closed_at DATETIME,
            closure_evidence_source TEXT, consecutive_verification_failures INTEGER DEFAULT 0
        );
        CREATE TABLE job_lifecycle_events (
            id TEXT PRIMARY KEY, job_id TEXT, from_status TEXT, to_status TEXT, reason TEXT,
            evidence_source TEXT, evidence_json TEXT, created_at DATETIME
        );
        CREATE TABLE job_verification_requests (
            id TEXT PRIMARY KEY, job_id TEXT, status TEXT, reason TEXT, claimed_by_user_id TEXT,
            claim_expires_at DATETIME, result TEXT, created_at DATETIME, updated_at DATETIME, resolved_at DATETIME
        );
        INSERT INTO jobs (id, status, created_at) VALUES
            ('pending-old', 'PENDING', datetime('now', '-4 days')),
            ('pending-new', 'PENDING', datetime('now', '-2 days')),
            ('match-old', 'MATCHED', datetime('now', '-8 days')),
            ('match-new', 'MATCHED', datetime('now', '-6 days')),
            ('close-old', 'CLOSE', datetime('now', '-8 days')),
            ('approved-old', 'APPROVED', datetime('now', '-20 days')),
            ('applied-old', 'APPLIED', datetime('now', '-20 days'));
        UPDATE jobs SET posted_at = datetime('now', '-1 day') WHERE id = 'pending-old';
        INSERT INTO jobs (id, status, posted_at, created_at)
        VALUES ('pending-posted-old', 'PENDING', datetime('now', '-4 days'), datetime('now'));
        UPDATE jobs SET explicit_deadline = datetime('now', '-1 hour') WHERE id = 'close-old';
    `);

    assert.equal(archiveStaleJobs(db), 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status = 'ARCHIVED'").get().count, 0);
    assert.equal(db.prepare("SELECT lifecycle_status FROM jobs WHERE id = 'close-old'").get().lifecycle_status, "CLOSED");
    assert.equal(db.prepare("SELECT status FROM jobs WHERE id = 'match-old'").get().status, "MATCHED");
    assert.equal(db.prepare("SELECT status FROM jobs WHERE id = 'pending-posted-old'").get().status, "PENDING");
    assert.equal(db.prepare("SELECT status FROM jobs WHERE id = 'pending-old'").get().status, "PENDING");
    assert.equal(db.prepare("SELECT status FROM jobs WHERE id = 'approved-old'").get().status, "APPROVED");
    assert.equal(db.prepare("SELECT status FROM jobs WHERE id = 'applied-old'").get().status, "APPLIED");
    db.close();
});

test("pending processing prefers the newest posted date and falls back to created date", () => {
    const db = new Database(":memory:");
    db.exec(`
        CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE jobs (
            id TEXT PRIMARY KEY, company_id TEXT, status TEXT,
            posted_at DATETIME, created_at DATETIME, lifecycle_status TEXT DEFAULT 'ACTIVE'
        );
        INSERT INTO companies (id, name) VALUES ('company', 'Company');
        INSERT INTO jobs (id, company_id, status, posted_at, created_at) VALUES
            ('posted-old', 'company', 'PENDING', datetime('now', '-3 days'), datetime('now', '-1 day')),
            ('created-new', 'company', 'PENDING', NULL, datetime('now', '-2 hours')),
            ('posted-new', 'company', 'PENDING', datetime('now', '-1 hour'), datetime('now', '-2 days')),
            ('not-pending', 'company', 'MATCHED', datetime('now'), datetime('now'));
    `);
    assert.deepEqual(
        selectPendingJobsForProcessing(db, { limit: 3 }).map((job) => job.id),
        ["posted-new", "created-new", "posted-old"]
    );
    db.close();
});

test("long dashboard runs start asynchronously and expose pollable progress", async () => {
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    const started = launchPipelineRun("PENDING", 3, {
        pending: async () => { await waiting; return { archived: 0, scoring: { scanned: 3, matched: 1, close: 1, rejected: 1 } }; }
    });
    assert.equal(started.status, "RUNNING");
    assert.equal(getPipelineRunState().id, started.id);
    assert.throws(() => launchPipelineRun("PENDING", 1, { pending: async () => ({}) }), /already in progress/i);
    release();
    for (let attempt = 0; attempt < 20 && getPipelineRunState().status === "RUNNING"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(getPipelineRunState().status, "COMPLETE");
    assert.equal(getPipelineRunState().result.scoring.scanned, 3);
});

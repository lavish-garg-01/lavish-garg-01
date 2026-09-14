import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { jobLifecycleMigration } from "../src/database/migrations/0001_job_lifecycle.js";
import { candidateSearchProfileMigration } from "../src/database/migrations/0002_candidate_search_profile.js";
import { candidateJobFeedMigration } from "../src/database/migrations/0003_candidate_job_feed.js";
import { jobUserStateLifecycleMigration } from "../src/database/migrations/0004_job_user_state_lifecycle.js";
import {
    activeFeedGeneration,
    candidateJobFeedStatus,
    ensureCandidateJobFeed,
    listCandidateJobFeed,
    rebuildCandidateJobFeed
} from "../src/services/candidateJobFeed.js";

const NOW = new Date("2026-08-28T12:00:00.000Z");
const USER_ID = "candidate-feed-user";

function profile(overrides = {}) {
    return {
        profileVersion: 1,
        targetRoles: ["Backend Engineer"],
        careerFamilies: ["SOFTWARE_ENGINEERING"],
        primaryCoreStacks: ["Node.js"],
        acceptableCoreStacks: [],
        adjacentCareerTracks: [],
        desiredSeniorityLevels: [],
        preferredSkills: ["PostgreSQL"],
        excludedSkills: [],
        preferredLocations: ["Bengaluru"],
        preferredWorkModes: ["REMOTE", "HYBRID"],
        employmentTypes: ["FULL_TIME"],
        minimumSalary: null,
        compensationConstraintMode: "SOFT",
        locationConstraintMode: "SOFT",
        workModeConstraintMode: "SOFT",
        employmentTypeConstraintMode: "SOFT",
        experienceTolerance: { smallGapYears: 1, maxPlausibleGapYears: 3, allowNearbySeniority: true },
        excludedCompanies: [],
        dealBreakers: [],
        countryCode: "IN",
        workAuthorization: "AUTHORIZED_IN_MARKET",
        sponsorshipNeed: "NOT_REQUIRED",
        relocationPreference: "NOT_WILLING",
        totalExperienceYears: 4,
        currentTitle: "Backend Engineer",
        skills: ["Node.js", "PostgreSQL", "Redis"],
        ...overrides
    };
}

function resume() {
    return { skills: ["Node.js", "PostgreSQL", "Redis"], skillGroups: {}, experience: [] };
}

function database() {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(fs.readFileSync(new URL("../src/database/schema.sql", import.meta.url), "utf8"));
    jobLifecycleMigration.up(db);
    candidateSearchProfileMigration.up(db);
    candidateJobFeedMigration.up(db);
    jobUserStateLifecycleMigration.up(db);
    db.prepare("INSERT INTO candidate_profiles (user_id, name, email) VALUES (?, ?, ?)")
        .run(USER_ID, "Candidate", "candidate@example.com");
    db.prepare("INSERT INTO candidate_search_profiles (user_id, profile_version) VALUES (?, 1)").run(USER_ID);
    db.prepare("INSERT INTO companies (id, name) VALUES ('company-1', 'Product Co')").run();
    return db;
}

function insertJob(db, {
    id,
    title = "Backend Engineer",
    description = "Full-time Node.js backend role with PostgreSQL. Minimum 4 years experience.",
    postedAt = "2026-08-27T10:00:00.000Z",
    lifecycle = "ACTIVE",
    matchVersion = 1
}) {
    db.prepare(`INSERT INTO jobs
        (id, company_id, title, location, description, url, source, status, posted_at,
         lifecycle_status, match_version)
        VALUES (?, 'company-1', ?, 'Bengaluru, India', ?, ?, 'greenhouse', 'PENDING', ?, ?, ?)`)
        .run(id, title, description, `https://jobs.productco.test/${id}`, postedAt, lifecycle, matchVersion);
}

function seedSmallRegistry(db) {
    insertJob(db, { id: "node-best", postedAt: "2026-08-28T08:00:00.000Z" });
    insertJob(db, { id: "node-second", description: "Full-time Node.js backend role. Minimum 5 years experience." });
    insertJob(db, { id: "java-hard-conflict", title: "Java Backend Engineer",
        description: "Full-time Java and Spring Boot backend role. Minimum 4 years experience." });
    insertJob(db, { id: "closed-job", lifecycle: "CLOSED" });
}

test("an atomic rebuild stores only eligible ranked results and feed reads are mutation-free", async () => {
    const db = database();
    try {
        seedSmallRegistry(db);
        const build = await rebuildCandidateJobFeed(USER_ID, { db, profile: profile(), resume: resume(), now: NOW });
        assert.equal(build.status, "READY");
        assert.equal(build.feedCount, 2);
        assert.equal(candidateJobFeedMigration.verify(db), true);

        const first = listCandidateJobFeed({ userId: USER_ID, db, profile: profile(), resume: resume(), now: NOW, limit: 1 });
        assert.equal(first.jobs.length, 1);
        assert.equal(first.page.hasMore, true);
        assert.ok(first.page.nextCursor);
        assert.equal(first.feed.status, "READY");
        const second = listCandidateJobFeed({ userId: USER_ID, db, profile: profile(), resume: resume(), now: NOW,
            limit: 1, cursor: first.page.nextCursor });
        assert.equal(second.jobs.length, 1);
        assert.notEqual(second.jobs[0].job.id, first.jobs[0].job.id);
        assert.equal(second.page.hasMore, false);

        const buildsBefore = db.prepare("SELECT COUNT(*) AS count FROM candidate_job_feed_builds").get().count;
        const aiCallsBefore = db.prepare("SELECT COUNT(*) AS count FROM ai_call_metrics").get().count;
        listCandidateJobFeed({ userId: USER_ID, db, profile: profile(), resume: resume(), now: NOW });
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM candidate_job_feed_builds").get().count, buildsBefore);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ai_call_metrics").get().count, aiCallsBefore);

        const expectedIds = db.prepare("SELECT job_id FROM candidate_job_feed ORDER BY rank")
            .all().map((row) => row.job_id);
        await rebuildCandidateJobFeed(USER_ID, { db, profile: profile(), resume: resume(), now: NOW });
        assert.deepEqual(db.prepare("SELECT job_id FROM candidate_job_feed ORDER BY rank")
            .all().map((row) => row.job_id), expectedIds, "the disposable feed must rebuild deterministically");
        assert.throws(() => listCandidateJobFeed({ userId: USER_ID, db, profile: profile(), resume: resume(),
            now: NOW, cursor: first.page.nextCursor }), (error) => error.code === "FEED_CURSOR_EXPIRED");
    } finally {
        db.close();
    }
});

test("profile, evidence, algorithm inputs, and job versions make staleness explicit", async () => {
    const db = database();
    try {
        seedSmallRegistry(db);
        await rebuildCandidateJobFeed(USER_ID, { db, profile: profile(), resume: resume(), now: NOW });
        const profileChanged = candidateJobFeedStatus(USER_ID, {
            db, profile: profile({ profileVersion: 2 }), resume: resume(), now: NOW
        });
        assert.equal(profileChanged.status, "STALE");
        assert.ok(profileChanged.staleReasons.includes("PROFILE_VERSION_CHANGED"));

        const evidenceChanged = candidateJobFeedStatus(USER_ID, {
            db, profile: profile({ skills: ["Node.js", "PostgreSQL", "Kafka"] }), resume: resume(), now: NOW
        });
        assert.ok(evidenceChanged.staleReasons.includes("CANDIDATE_EVIDENCE_CHANGED"));

        db.prepare("UPDATE jobs SET match_version=match_version+1 WHERE id='node-best'").run();
        const registryChanged = candidateJobFeedStatus(USER_ID, { db, profile: profile(), resume: resume(), now: NOW });
        assert.ok(registryChanged.staleReasons.includes("JOB_REGISTRY_CHANGED"));

        const refreshed = await ensureCandidateJobFeed(USER_ID, {
            db, profile: profile(), resume: resume(), now: NOW
        });
        assert.equal(refreshed.status, "READY");
    } finally {
        db.close();
    }
});

test("a failed rebuild preserves the complete previous generation", async () => {
    const db = database();
    try {
        seedSmallRegistry(db);
        await rebuildCandidateJobFeed(USER_ID, { db, profile: profile(), resume: resume(), now: NOW });
        const before = activeFeedGeneration(USER_ID, { db });
        const beforeIds = db.prepare("SELECT job_id FROM candidate_job_feed WHERE generation_id=? ORDER BY rank")
            .all(before).map((row) => row.job_id);
        await assert.rejects(rebuildCandidateJobFeed(USER_ID, {
            db,
            profile: profile(),
            resume: resume(),
            now: NOW,
            evaluate() { throw new Error("synthetic scoring failure"); }
        }), /synthetic scoring failure/);
        assert.equal(activeFeedGeneration(USER_ID, { db }), before);
        assert.deepEqual(db.prepare("SELECT job_id FROM candidate_job_feed WHERE generation_id=? ORDER BY rank")
            .all(before).map((row) => row.job_id), beforeIds);
        assert.equal(db.prepare("SELECT status FROM candidate_job_feed_builds ORDER BY started_at DESC, rowid DESC LIMIT 1").get().status,
            "FAILED");
    } finally {
        db.close();
    }
});

test("same-user rebuild requests share one in-flight generation", async () => {
    const db = database();
    try {
        seedSmallRegistry(db);
        const first = rebuildCandidateJobFeed(USER_ID, { db, profile: profile(), resume: resume(), now: NOW });
        const second = rebuildCandidateJobFeed(USER_ID, { db, profile: profile(), resume: resume(), now: NOW });
        assert.equal(first, second);
        const [left, right] = await Promise.all([first, second]);
        assert.equal(left.generationId, right.generationId);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM candidate_job_feed_builds WHERE status='READY'").get().count, 1);
    } finally {
        db.close();
    }
});

test("a 655-job local cold rebuild stays below one second and caps the feed at 300", async () => {
    const db = database();
    try {
        const insertMany = db.transaction(() => {
            for (let index = 0; index < 655; index += 1) {
                insertJob(db, { id: `job-${String(index).padStart(4, "0")}`,
                    postedAt: `2026-08-${String(20 + (index % 9)).padStart(2, "0")}T10:00:00.000Z` });
            }
        });
        insertMany();
        const started = performance.now();
        const build = await rebuildCandidateJobFeed(USER_ID, { db, profile: profile(), resume: resume(), now: NOW });
        const wallTimeMs = performance.now() - started;
        assert.equal(build.feedCount, 300);
        assert.ok(wallTimeMs < 1000, `cold rebuild took ${wallTimeMs.toFixed(1)}ms`);
    } finally {
        db.close();
    }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { jobLifecycleMigration } from "../src/database/migrations/0001_job_lifecycle.js";
import { candidateSearchProfileMigration } from "../src/database/migrations/0002_candidate_search_profile.js";
import { candidateJobFeedMigration } from "../src/database/migrations/0003_candidate_job_feed.js";
import { jobUserStateLifecycleMigration } from "../src/database/migrations/0004_job_user_state_lifecycle.js";
import { getJobUserState, updateJobUserState } from "../src/repositories/jobUserStateRepository.js";
import { listCandidateJobFeed, listSavedCandidateJobs, rebuildCandidateJobFeed } from "../src/services/candidateJobFeed.js";

const USER_ID = "local-user";
const NOW = new Date("2026-08-28T12:00:00.000Z");

function profile() {
    return {
        profileVersion: 1,
        targetRoles: ["Backend Engineer"],
        careerFamilies: ["SOFTWARE_ENGINEERING"],
        primaryCoreStacks: ["Node.js"],
        acceptableCoreStacks: ["Node.js"],
        adjacentCareerTracks: [],
        desiredSeniorityLevels: [],
        preferredSkills: ["PostgreSQL"],
        excludedSkills: [],
        preferredLocations: ["Bengaluru"],
        preferredWorkModes: ["HYBRID"],
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
        relocationPreference: "WILLING",
        totalExperienceYears: 4,
        currentTitle: "Backend Engineer",
        skills: ["Node.js", "PostgreSQL"]
    };
}

function resume() {
    return { skills: ["Node.js", "PostgreSQL"], skillGroups: {}, experience: [] };
}

function database({ stateMigration = true } = {}) {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(fs.readFileSync(new URL("../src/database/schema.sql", import.meta.url), "utf8"));
    jobLifecycleMigration.up(db);
    candidateSearchProfileMigration.up(db);
    candidateJobFeedMigration.up(db);
    if (stateMigration) jobUserStateLifecycleMigration.up(db);
    db.prepare("INSERT INTO candidate_profiles (user_id, name, email) VALUES (?, 'Candidate', 'candidate@example.com')")
        .run(USER_ID);
    db.prepare("INSERT INTO candidate_search_profiles (user_id, profile_version) VALUES (?, 1)").run(USER_ID);
    db.prepare("INSERT INTO companies (id, name) VALUES ('company-1', 'Product Co')").run();
    return db;
}

function insertJob(db, {
    id,
    title = "Backend Engineer",
    postedAt = "2026-08-27T10:00:00.000Z",
    lifecycle = "ACTIVE",
    matchVersion = 1,
    seriesKey = "product-co-backend-bengaluru",
    explicitDeadline = null
}) {
    db.prepare(`INSERT INTO jobs
        (id, company_id, title, location, description, url, source, status, posted_at,
         lifecycle_status, match_version, posting_series_key, explicit_deadline,
         primary_stack, employment_type, country_code)
        VALUES (?, 'company-1', ?, 'Bengaluru, India',
            'Full-time Node.js backend role with PostgreSQL. Minimum 4 years experience.',
            ?, 'greenhouse', 'PENDING', ?, ?, ?, ?, ?, 'Node.js', 'FULL_TIME', 'IN')`)
        .run(id, title, `https://jobs.productco.test/${id}`, postedAt, lifecycle, matchVersion, seriesKey, explicitDeadline);
}

test("the state migration preserves legacy saves and attaches their material job version", () => {
    const db = database({ stateMigration: false });
    try {
        insertJob(db, { id: "legacy-saved", matchVersion: 3 });
        db.prepare("INSERT INTO job_user_states (user_id, job_id, saved, dismissed) VALUES (?, ?, 1, 0)")
            .run(USER_ID, "legacy-saved");
        jobUserStateLifecycleMigration.up(db);
        assert.equal(jobUserStateLifecycleMigration.verify(db), true);
        const state = getJobUserState("legacy-saved", USER_ID, { db });
        assert.equal(state.saved, true);
        assert.equal(state.seen, true);
        assert.equal(state.savedMatchVersion, 3);
        assert.ok(state.savedAt);
    } finally {
        db.close();
    }
});

test("dismissal applies only to the current material version", async () => {
    const db = database();
    try {
        insertJob(db, { id: "versioned-job" });
        updateJobUserState("versioned-job", { dismissed: true }, USER_ID, { db, now: NOW });
        await rebuildCandidateJobFeed(USER_ID, { db, profile: profile(), resume: resume(), now: NOW });
        assert.equal(listCandidateJobFeed({ userId: USER_ID, db, profile: profile(), resume: resume(), now: NOW }).jobs.length, 0);

        db.prepare("UPDATE jobs SET last_seen_at=? WHERE id='versioned-job'").run(NOW.toISOString());
        await rebuildCandidateJobFeed(USER_ID, { db, profile: profile(), resume: resume(), now: NOW });
        assert.equal(listCandidateJobFeed({ userId: USER_ID, db, profile: profile(), resume: resume(), now: NOW }).jobs.length, 0,
            "a cosmetic refresh must not restore a dismissed job");

        db.prepare("UPDATE jobs SET match_version=2 WHERE id='versioned-job'").run();
        await rebuildCandidateJobFeed(USER_ID, { db, profile: profile(), resume: resume(), now: NOW });
        const restored = listCandidateJobFeed({ userId: USER_ID, db, profile: profile(), resume: resume(), now: NOW });
        assert.equal(restored.jobs.length, 1);
        assert.equal(getJobUserState("versioned-job", USER_ID, { db }).dismissed, false);
        assert.equal(getJobUserState("versioned-job", USER_ID, { db }).dismissedForOlderVersion, true);
    } finally {
        db.close();
    }
});

test("saved jobs ignore discovery age and retain confirmed closed history", () => {
    const db = database();
    try {
        insertJob(db, { id: "old-closed", postedAt: "2026-08-01T10:00:00.000Z", lifecycle: "CLOSED" });
        updateJobUserState("old-closed", { saved: true }, USER_ID, { db, now: NOW });
        const saved = listSavedCandidateJobs({ userId: USER_ID, db });
        assert.equal(saved.length, 1);
        assert.equal(saved[0].job.id, "old-closed");
        assert.equal(saved[0].job.lifecycle_status, "CLOSED");
    } finally {
        db.close();
    }
});

test("verified applications suppress near-identical reposts for 45 days but allow materially different roles", async () => {
    const db = database();
    try {
        insertJob(db, { id: "applied-original" });
        insertJob(db, { id: "same-role-repost" });
        insertJob(db, { id: "different-role", title: "Platform Engineer", seriesKey: "product-co-platform-bengaluru" });
        db.prepare(`INSERT INTO applications
            (id, user_id, job_id, adapter, mode, status, submitted_at, created_at, updated_at)
            VALUES ('application-1', ?, 'applied-original', 'EXTENSION', 'COPILOT', 'SUCCESS', ?, ?, ?)`)
            .run(USER_ID, "2026-08-08T12:00:00.000Z", "2026-08-08T12:00:00.000Z", "2026-08-08T12:00:00.000Z");

        await rebuildCandidateJobFeed(USER_ID, { db, profile: profile(), resume: resume(), now: NOW });
        let ids = listCandidateJobFeed({ userId: USER_ID, db, profile: profile(), resume: resume(), now: NOW })
            .jobs.map(({ job }) => job.id);
        assert.deepEqual(ids, ["different-role"]);

        db.prepare("UPDATE applications SET submitted_at=?, updated_at=? WHERE id='application-1'")
            .run("2026-07-10T12:00:00.000Z", "2026-07-10T12:00:00.000Z");
        await rebuildCandidateJobFeed(USER_ID, { db, profile: profile(), resume: resume(), now: NOW });
        ids = listCandidateJobFeed({ userId: USER_ID, db, profile: profile(), resume: resume(), now: NOW })
            .jobs.map(({ job }) => job.id).sort();
        assert.deepEqual(ids, ["different-role", "same-role-repost"]);
        assert.equal(ids.includes("applied-original"), false, "the exact verified application remains out of Discovery");
    } finally {
        db.close();
    }
});

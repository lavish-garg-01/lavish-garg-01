import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { candidateSearchProfileMigration } from "../src/database/migrations/0002_candidate_search_profile.js";
import {
    getCandidateSearchProfile,
    saveCandidateSearchProfile,
    toCandidateProfileSearchFields
} from "../src/repositories/candidateSearchProfileRepository.js";

function legacyDatabase() {
    const db = new Database(":memory:");
    db.exec(`
        CREATE TABLE candidate_profiles (
            user_id TEXT PRIMARY KEY,
            preferred_locations TEXT DEFAULT '[]',
            preferred_skills TEXT DEFAULT '[]',
            excluded_skills TEXT DEFAULT '[]',
            target_roles TEXT DEFAULT '[]',
            career_profiles TEXT DEFAULT '[]',
            preferred_work_modes TEXT DEFAULT '[]',
            minimum_salary REAL,
            willing_to_relocate INTEGER DEFAULT 0,
            work_authorization TEXT,
            sponsorship_required TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE auto_apply_settings (
            user_id TEXT PRIMARY KEY,
            target_roles TEXT DEFAULT '[]',
            preferred_locations TEXT DEFAULT '[]',
            excluded_companies TEXT DEFAULT '[]',
            minimum_salary REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE onboarding_states (
            user_id TEXT PRIMARY KEY,
            state_json TEXT NOT NULL DEFAULT '{}'
        );
    `);
    return db;
}

test("candidate search profile backfills legacy intent and versions only material matching changes", () => {
    const db = legacyDatabase();
    try {
        db.prepare(`INSERT INTO candidate_profiles
            (user_id, preferred_locations, preferred_skills, excluded_skills, target_roles,
             career_profiles, preferred_work_modes, minimum_salary, willing_to_relocate,
             work_authorization, sponsorship_required)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            "candidate-1", '["Bengaluru","Remote India"]', '["Kafka"]', '["PHP"]',
            '["Backend Engineer","Platform Engineer"]', '["SOFTWARE_ENGINEERING"]',
            '["Hybrid","Remote"]', 24, 0, "authorized in India", "not required"
        );
        db.prepare(`INSERT INTO auto_apply_settings
            (user_id, target_roles, preferred_locations, excluded_companies, minimum_salary)
            VALUES (?, '[]', '[]', '["Example Staffing"]', 20)`).run("candidate-1");
        db.prepare("INSERT INTO onboarding_states (user_id, state_json) VALUES (?, ?)").run(
            "candidate-1",
            JSON.stringify({ currentTitle: "Senior Software Engineer", employmentTypes: ["Full-time", "Contract"], dealBreakers: ["No night shifts"] })
        );

        candidateSearchProfileMigration.up(db);
        assert.equal(candidateSearchProfileMigration.verify(db), true);

        const initial = getCandidateSearchProfile("candidate-1", { db });
        assert.equal(initial.profileVersion, 1);
        assert.deepEqual(initial.targetRoles, ["Backend Engineer", "Platform Engineer"]);
        assert.deepEqual(initial.employmentTypes, ["FULL_TIME", "CONTRACT"]);
        assert.deepEqual(initial.dealBreakers, ["NIGHT_SHIFT"]);
        assert.equal(initial.workAuthorization, "AUTHORIZED_IN_MARKET");
        assert.equal(initial.sponsorshipNeed, "NOT_REQUIRED");
        assert.equal(toCandidateProfileSearchFields(initial).workAuthorization, "AUTHORIZED");
        assert.equal(toCandidateProfileSearchFields(initial).sponsorshipRequired, "NO");
        assert.equal(db.prepare("SELECT current_title FROM candidate_profiles WHERE user_id = ?").get("candidate-1").current_title,
            "Senior Software Engineer");

        const reordered = saveCandidateSearchProfile({
            targetRoles: ["Platform Engineer", "Backend Engineer"],
            preferredLocations: ["Remote India", "Bengaluru"]
        }, "candidate-1", { db, source: "TEST" });
        assert.equal(reordered.profileVersion, 1, "ordering-only edits must not invalidate match results");

        const changed = saveCandidateSearchProfile({
            primaryCoreStacks: ["Node.js + PostgreSQL"],
            acceptableCoreStacks: ["Java + Spring"],
            compensationConstraintMode: "HARD",
            experienceTolerance: { smallGapYears: 1, maxPlausibleGapYears: 2, allowNearbySeniority: true }
        }, "candidate-1", { db, source: "PROFILE" });
        assert.equal(changed.profileVersion, 2);
        assert.equal(changed.compensationConstraintMode, "HARD");
        assert.deepEqual(changed.acceptableCoreStacks, ["Java + Spring"]);

        const event = db.prepare("SELECT * FROM candidate_search_profile_events WHERE user_id = ?").get("candidate-1");
        assert.equal(event.from_version, 1);
        assert.equal(event.to_version, 2);
        assert.ok(JSON.parse(event.changed_fields_json).includes("primaryCoreStacks"));

        const cleared = saveCandidateSearchProfile({ minimumSalary: null }, "candidate-1", { db, source: "PROFILE" });
        assert.equal(cleared.profileVersion, 3);
        assert.equal(cleared.minimumSalary, null, "an explicit null clears the salary preference");
        const legacy = db.prepare("SELECT target_roles, minimum_salary FROM candidate_profiles WHERE user_id = ?").get("candidate-1");
        assert.deepEqual(JSON.parse(legacy.target_roles), ["Backend Engineer", "Platform Engineer"]);
        assert.equal(legacy.minimum_salary, null);
    } finally {
        db.close();
    }
});

test("candidate search profile uses fail-safe defaults for unrecognized policy values", () => {
    const db = legacyDatabase();
    try {
        db.prepare("INSERT INTO candidate_profiles (user_id) VALUES ('candidate-2')").run();
        candidateSearchProfileMigration.up(db);
        const profile = saveCandidateSearchProfile({
            compensationConstraintMode: "MAYBE",
            preferredWorkModes: ["Anywhere somehow"],
            workAuthorization: "unclear",
            sponsorshipNeed: "ask later",
            relocationPreference: "depends"
        }, "candidate-2", { db });
        assert.equal(profile.compensationConstraintMode, "SOFT");
        assert.deepEqual(profile.preferredWorkModes, []);
        assert.equal(profile.workAuthorization, "UNKNOWN");
        assert.equal(profile.sponsorshipNeed, "UNKNOWN");
        assert.equal(profile.relocationPreference, "UNKNOWN");
        assert.equal(toCandidateProfileSearchFields(profile).workAuthorization, "");
        assert.equal(toCandidateProfileSearchFields(profile).sponsorshipRequired, "");
        const candidateAnswer = saveCandidateSearchProfile({
            workAuthorization: "Yes",
            sponsorshipRequired: "No"
        }, "candidate-2", { db, source: "ATTENTION_GAP" });
        assert.equal(candidateAnswer.workAuthorization, "AUTHORIZED_IN_MARKET");
        assert.equal(candidateAnswer.sponsorshipNeed, "NOT_REQUIRED");
        assert.equal(toCandidateProfileSearchFields(candidateAnswer).workAuthorization, "AUTHORIZED");
        assert.equal(toCandidateProfileSearchFields(candidateAnswer).sponsorshipRequired, "NO");
    } finally {
        db.close();
    }
});

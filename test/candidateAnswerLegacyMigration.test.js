import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const candidatePrivate = (kind, properties) => ({ schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind, ...properties });

test("Part 2B migrates only unambiguous policy-safe legacy candidate truth", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-answer-legacy-migration-"));
    process.env.DATABASE_PATH = path.join(directory, "migration.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { ensureAnswerPolicyRegistry } = await import("../src/services/answerPolicyRegistry.js");
    const {
        applyLegacyCandidateTruthMigration,
        legacyCandidateTruthMigrationDiagnostics,
        previewLegacyCandidateTruthMigration
    } = await import("../src/services/candidateAnswerLegacyMigrationService.js");
    const {
        listCandidateAnswerVersions, saveCandidateAnswerVersion
    } = await import("../src/repositories/candidateAnswerVersionRepository.js");

    try {
        const db = getDb();
        ensureAnswerPolicyRegistry();
        db.prepare(`INSERT INTO candidate_profiles
            (user_id, name, email, phone, country, current_location, current_company, current_ctc,
             expected_ctc, notice_period_days, total_experience_years, skills, preferred_locations,
             willing_to_relocate, work_authorization, sponsorship_required, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
            .run("migration-user", "Asha Sharma", "asha@example.com", "9876543210", "India", "Bengaluru",
                "Private Employer", 12, 24, 30, 4.5, JSON.stringify(["Node.js", "PostgreSQL"]),
                JSON.stringify(["Bengaluru", "Remote India"]), "AUTHORIZED_IN_MARKET", "NOT_REQUIRED",
                "2026-08-20T00:00:00.000Z");
        db.prepare(`INSERT INTO candidate_fact_memory
            (id, user_id, semantic_key, category, value_text, value_type, fact_scope, source,
             candidate_approved, verified_at, valid_until)
            VALUES ('fact-ctc', 'migration-user', 'CURRENT_CTC', 'COMPENSATION', '12', 'NUMBER',
                    'CANDIDATE_PROFILE', 'PROFILE', 1, '2026-08-20T00:00:00.000Z', '2027-02-20T00:00:00.000Z')`).run();
        db.prepare(`INSERT INTO candidate_answers
            (id, user_id, question_key, original_question, answer, confidence, source)
            VALUES ('unsafe-answer', 'migration-user', 'PERSONAL_SUMMARY', 'Summary',
                    'Do not copy this generated answer', 1, 'AI_GENERATED')`).run();

        const preview = previewLegacyCandidateTruthMigration({ userId: "migration-user", resume: null });
        assert.ok(preview.eligible >= 8, "profile-backed facts should be eligible in the preview");
        assert.equal(preview.migrated, 0, "a preview must never imply that it wrote candidate truth");
        assert.ok(preview.skipped >= 4, "legal, ambiguous-default and unverified sources must be skipped");
        assert.equal(preview.productionCutover, false);
        assert.ok(preview.reasonCounts.some((row) => row.reasonCode === "LEGAL_FACT_REQUIRES_RECONFIRMATION"));
        assert.ok(preview.reasonCounts.some((row) => row.reasonCode === "PROFILE_BOOLEAN_DEFAULT_AMBIGUOUS"));
        assert.ok(preview.reasonCounts.some((row) => row.reasonCode === "LEGACY_SOURCE_NOT_CANDIDATE_VERIFIED"));

        const applied = applyLegacyCandidateTruthMigration({ userId: "migration-user", resume: null, initiatedBy: "TEST" });
        assert.equal(applied.status, "COMPLETED");
        assert.equal(applied.idempotentReplay, false);
        const email = listCandidateAnswerVersions("migration-user", { canonicalKey: "EMAIL", includeInactive: false })[0];
        assert.equal(email.normalizedValue.value, "asha@example.com");
        const phone = listCandidateAnswerVersions("migration-user", { canonicalKey: "PHONE", includeInactive: false })[0];
        assert.deepEqual(phone.normalizedValue, candidatePrivate("PHONE", {
            countryCode: "+91", nationalNumber: "9876543210", extension: null
        }));
        const currentCtc = listCandidateAnswerVersions("migration-user", { canonicalKey: "CURRENT_CTC", includeInactive: false })[0];
        assert.equal(currentCtc.normalizedValue.amountExact, "1200000", "legacy profile compensation is stored in LPA");
        const experience = listCandidateAnswerVersions("migration-user", { canonicalKey: "TOTAL_EXPERIENCE", includeInactive: false })[0];
        assert.equal(experience.normalizedValue.months, 54);
        assert.equal(listCandidateAnswerVersions("migration-user", { canonicalKey: "WORK_AUTHORIZATION", includeInactive: false }).length, 0);
        assert.equal(listCandidateAnswerVersions("migration-user", { canonicalKey: "SPONSORSHIP", includeInactive: false }).length, 0);
        assert.equal(listCandidateAnswerVersions("migration-user", { canonicalKey: "RELOCATION", includeInactive: false }).length, 0,
            "a database default false must not be treated as an explicit candidate answer");
        assert.equal(listCandidateAnswerVersions("migration-user", { canonicalKey: "PERSONAL_SUMMARY", includeInactive: false }).length, 0,
            "AI-generated legacy text must not become candidate truth");

        const audit = JSON.stringify({
            runs: db.prepare("SELECT * FROM candidate_answer_migration_runs WHERE user_id = ?").all("migration-user"),
            items: db.prepare("SELECT * FROM candidate_answer_migration_items WHERE user_id = ?").all("migration-user")
        });
        assert.doesNotMatch(audit, /asha@example\.com|9876543210|Private Employer|generated answer/,
            "migration audit stores hashes and reason codes, never candidate values");

        const replay = applyLegacyCandidateTruthMigration({ userId: "migration-user", resume: null, initiatedBy: "TEST" });
        assert.equal(replay.id, applied.id);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM candidate_answer_migration_runs WHERE user_id = ?")
            .get("migration-user").count, 1);
        assert.equal(legacyCandidateTruthMigrationDiagnostics("migration-user").latest.id, applied.id);

        db.prepare(`INSERT INTO candidate_profiles (user_id, name, email, phone, preferred_locations, skills,
            target_roles, preferred_work_modes) VALUES ('conflict-user', 'Conflict User', 'legacy@example.com', '', '[]', '[]', '[]', '[]')`).run();
        const explicit = saveCandidateAnswerVersion({
            userId: "conflict-user", canonicalKey: "EMAIL",
            normalizedValue: candidatePrivate("STRING", { value: "explicit@example.com" }),
            expectedActiveVersionId: null, idempotencyKey: "explicit-email", candidateApproved: true
        });
        const conflict = applyLegacyCandidateTruthMigration({ userId: "conflict-user", resume: null, initiatedBy: "TEST" });
        assert.ok(conflict.conflict >= 1);
        assert.equal(listCandidateAnswerVersions("conflict-user", { canonicalKey: "EMAIL", includeInactive: false })[0].id, explicit.id,
            "legacy migration must never overwrite active candidate truth");

        db.prepare(`INSERT INTO candidate_profiles (user_id, name, email, phone, preferred_locations, skills,
            target_roles, preferred_work_modes) VALUES ('resume-conflict', 'Resume User', 'profile@example.com', '', '[]', '[]', '[]', '[]')`).run();
        const sourceConflict = applyLegacyCandidateTruthMigration({
            userId: "resume-conflict",
            resume: { fullName: "Resume User", email: "resume@example.com", skills: [], experience: [], education: [] },
            initiatedBy: "TEST"
        });
        assert.ok(sourceConflict.conflict >= 1, "non-equivalent legacy sources require review instead of priority guessing");
        assert.equal(listCandidateAnswerVersions("resume-conflict", { canonicalKey: "EMAIL", includeInactive: false }).length, 0);

        db.prepare(`INSERT INTO candidate_profiles (user_id, name, email, phone, notice_period_days, preferred_locations,
            skills, target_roles, preferred_work_modes) VALUES ('atomic-user', 'Atomic User', 'atomic@example.com', '', 30, '[]', '[]', '[]', '[]')`).run();
        db.exec(`CREATE TRIGGER fail_atomic_notice BEFORE INSERT ON candidate_answer_versions
            WHEN NEW.user_id = 'atomic-user' AND NEW.canonical_key = 'NOTICE_PERIOD'
            BEGIN SELECT RAISE(ABORT, 'synthetic migration failure'); END;`);
        assert.throws(() => applyLegacyCandidateTruthMigration({ userId: "atomic-user", resume: null, initiatedBy: "TEST" }),
            /synthetic migration failure/);
        assert.equal(listCandidateAnswerVersions("atomic-user").length, 0,
            "one failed item rolls back every answer version from the migration run");
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM candidate_answer_migration_runs WHERE user_id = 'atomic-user'").get().count, 0,
            "a failed migration leaves no misleading completed audit run");
        db.exec("DROP TRIGGER fail_atomic_notice");
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

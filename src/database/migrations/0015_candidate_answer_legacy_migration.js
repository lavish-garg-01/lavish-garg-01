import { defineMigration } from "../migrationRunner.js";

export const candidateAnswerLegacyMigration = defineMigration({
    id: "0015_candidate_answer_legacy_migration",
    description: "Add candidate-private audit records for idempotent policy-aware legacy truth migration",
    up(db) {
        db.exec(`
            CREATE TABLE candidate_answer_migration_runs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                migration_version INTEGER NOT NULL,
                snapshot_hash TEXT NOT NULL,
                status TEXT NOT NULL,
                source_count INTEGER NOT NULL DEFAULT 0,
                migrated_count INTEGER NOT NULL DEFAULT 0,
                skipped_count INTEGER NOT NULL DEFAULT 0,
                conflict_count INTEGER NOT NULL DEFAULT 0,
                already_present_count INTEGER NOT NULL DEFAULT 0,
                invalid_count INTEGER NOT NULL DEFAULT 0,
                initiated_by TEXT NOT NULL,
                completed_at DATETIME,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, migration_version, snapshot_hash),
                CHECK(migration_version >= 1),
                CHECK(status IN ('IN_PROGRESS', 'COMPLETED')),
                CHECK(initiated_by IN ('STARTUP', 'ADMIN', 'TEST')),
                CHECK(source_count >= 0 AND migrated_count >= 0 AND skipped_count >= 0
                    AND conflict_count >= 0 AND already_present_count >= 0 AND invalid_count >= 0)
            );

            CREATE TABLE candidate_answer_migration_items (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                canonical_key TEXT,
                source_kind TEXT NOT NULL,
                source_record_id TEXT NOT NULL,
                source_value_hash TEXT NOT NULL,
                decision TEXT NOT NULL,
                reason_codes_json TEXT NOT NULL DEFAULT '[]',
                answer_version_id TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(run_id) REFERENCES candidate_answer_migration_runs(id) ON DELETE CASCADE,
                FOREIGN KEY(answer_version_id) REFERENCES candidate_answer_versions(id),
                CHECK(decision IN ('MIGRATED', 'SKIPPED', 'CONFLICT', 'ALREADY_PRESENT', 'INVALID')),
                CHECK(json_valid(reason_codes_json))
            );

            CREATE INDEX candidate_answer_migration_runs_user
                ON candidate_answer_migration_runs(user_id, created_at DESC);
            CREATE INDEX candidate_answer_migration_items_run
                ON candidate_answer_migration_items(run_id, decision, canonical_key);
            CREATE INDEX candidate_answer_migration_items_user
                ON candidate_answer_migration_items(user_id, canonical_key, created_at DESC);
        `);
    },
    verify(db) {
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all().map((row) => row.name));
        const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
            .all().map((row) => row.name));
        return tables.has("candidate_answer_migration_runs")
            && tables.has("candidate_answer_migration_items")
            && indexes.has("candidate_answer_migration_runs_user")
            && indexes.has("candidate_answer_migration_items_run");
    }
});

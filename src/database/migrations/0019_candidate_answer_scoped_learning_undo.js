import { defineMigration } from "../migrationRunner.js";

export const candidateAnswerScopedLearningUndoMigration = defineMigration({
    id: "0019_candidate_answer_scoped_learning_undo",
    description: "Add scoped REVIEW/TRUSTED answer state and immutable append-only undo and restore records",
    up(db) {
        db.exec(`
            ALTER TABLE candidate_answer_versions
                ADD COLUMN learning_state TEXT NOT NULL DEFAULT 'TRUSTED'
                CHECK(learning_state IN ('REVIEW', 'TRUSTED', 'REMOVED'));
            ALTER TABLE candidate_answer_versions
                ADD COLUMN origin_kind TEXT NOT NULL DEFAULT 'EXISTING_TRUTH';
            ALTER TABLE candidate_answer_versions
                ADD COLUMN restores_version_id TEXT REFERENCES candidate_answer_versions(id);

            ALTER TABLE candidate_answer_change_set_items
                ADD COLUMN transition_kind TEXT NOT NULL DEFAULT 'CREATE_TRUSTED';
            ALTER TABLE candidate_answer_change_set_items
                ADD COLUMN learning_state_before TEXT;
            ALTER TABLE candidate_answer_change_set_items
                ADD COLUMN learning_state_after TEXT;
            ALTER TABLE candidate_answer_change_set_items
                ADD COLUMN used_answer_version_id TEXT REFERENCES candidate_answer_versions(id);

            CREATE INDEX candidate_answer_learning_lookup
                ON candidate_answer_versions(user_id, canonical_key, scope_hash, learning_state, created_at DESC);

            CREATE TABLE candidate_answer_reversal_sets (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                operation_type TEXT NOT NULL,
                target_change_set_id TEXT,
                target_version_id TEXT,
                payload_hash TEXT NOT NULL,
                item_count INTEGER NOT NULL,
                summary_json TEXT NOT NULL DEFAULT '{}',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(target_change_set_id) REFERENCES candidate_answer_change_sets(id),
                FOREIGN KEY(target_version_id) REFERENCES candidate_answer_versions(id),
                CHECK(operation_type IN ('UNDO_CHANGE_SET', 'RESTORE_VERSION')),
                CHECK(length(payload_hash) = 64),
                CHECK(item_count BETWEEN 1 AND 50),
                CHECK(json_valid(summary_json)),
                CHECK(
                    (operation_type = 'UNDO_CHANGE_SET' AND target_change_set_id IS NOT NULL AND target_version_id IS NULL)
                    OR
                    (operation_type = 'RESTORE_VERSION' AND target_change_set_id IS NULL AND target_version_id IS NOT NULL)
                )
            );

            CREATE TABLE candidate_answer_reversal_items (
                id TEXT PRIMARY KEY,
                reversal_set_id TEXT NOT NULL,
                change_set_item_id TEXT,
                canonical_key TEXT NOT NULL,
                scope_hash TEXT NOT NULL,
                expected_version_id TEXT,
                current_version_id TEXT,
                previous_version_id TEXT,
                compensating_version_id TEXT,
                outcome TEXT NOT NULL,
                reason_codes_json TEXT NOT NULL DEFAULT '[]',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(reversal_set_id) REFERENCES candidate_answer_reversal_sets(id),
                FOREIGN KEY(change_set_item_id) REFERENCES candidate_answer_change_set_items(id),
                FOREIGN KEY(expected_version_id) REFERENCES candidate_answer_versions(id),
                FOREIGN KEY(current_version_id) REFERENCES candidate_answer_versions(id),
                FOREIGN KEY(previous_version_id) REFERENCES candidate_answer_versions(id),
                FOREIGN KEY(compensating_version_id) REFERENCES candidate_answer_versions(id),
                CHECK(length(scope_hash) = 64),
                CHECK(outcome IN ('RESTORED', 'FORGOTTEN', 'SKIPPED_NEWER_VERSION')),
                CHECK(json_valid(reason_codes_json))
            );

            CREATE TABLE candidate_answer_reversal_receipts (
                user_id TEXT NOT NULL,
                idempotency_key TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                reversal_set_id TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(user_id, idempotency_key),
                FOREIGN KEY(reversal_set_id) REFERENCES candidate_answer_reversal_sets(id),
                CHECK(length(payload_hash) = 64)
            );

            CREATE INDEX candidate_answer_reversal_user
                ON candidate_answer_reversal_sets(user_id, created_at DESC);
            CREATE INDEX candidate_answer_reversal_target_set
                ON candidate_answer_reversal_sets(target_change_set_id, created_at DESC);
            CREATE INDEX candidate_answer_reversal_items_set
                ON candidate_answer_reversal_items(reversal_set_id, canonical_key);

            CREATE TRIGGER candidate_answer_reversal_sets_immutable_update
                BEFORE UPDATE ON candidate_answer_reversal_sets
                BEGIN SELECT RAISE(ABORT, 'candidate answer reversal sets are immutable'); END;
            CREATE TRIGGER candidate_answer_reversal_sets_immutable_delete
                BEFORE DELETE ON candidate_answer_reversal_sets
                BEGIN SELECT RAISE(ABORT, 'candidate answer reversal sets are immutable'); END;
            CREATE TRIGGER candidate_answer_reversal_items_immutable_update
                BEFORE UPDATE ON candidate_answer_reversal_items
                BEGIN SELECT RAISE(ABORT, 'candidate answer reversal items are immutable'); END;
            CREATE TRIGGER candidate_answer_reversal_items_immutable_delete
                BEFORE DELETE ON candidate_answer_reversal_items
                BEGIN SELECT RAISE(ABORT, 'candidate answer reversal items are immutable'); END;
        `);
    },
    verify(db) {
        const columns = new Set(db.prepare("PRAGMA table_info(candidate_answer_versions)").all().map((row) => row.name));
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
        const triggers = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((row) => row.name));
        return ["learning_state", "origin_kind", "restores_version_id"].every((column) => columns.has(column))
            && ["candidate_answer_reversal_sets", "candidate_answer_reversal_items",
                "candidate_answer_reversal_receipts"].every((table) => tables.has(table))
            && triggers.has("candidate_answer_reversal_sets_immutable_update")
            && triggers.has("candidate_answer_reversal_items_immutable_update");
    }
});

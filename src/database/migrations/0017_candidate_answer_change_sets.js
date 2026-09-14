import { defineMigration } from "../migrationRunner.js";

export const candidateAnswerChangeSetsMigration = defineMigration({
    id: "0017_candidate_answer_change_sets",
    description: "Add immutable candidate-private application learning change sets and idempotency receipts",
    up(db) {
        db.exec(`
            CREATE TABLE candidate_answer_change_sets (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                application_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                checkpoint_id TEXT NOT NULL,
                checkpoint_kind TEXT NOT NULL,
                checkpoint_revision INTEGER NOT NULL,
                source TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'COMMITTED',
                payload_hash TEXT NOT NULL,
                item_count INTEGER NOT NULL,
                summary_json TEXT NOT NULL DEFAULT '{}',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(application_id) REFERENCES applications(id),
                FOREIGN KEY(run_id) REFERENCES application_attempts(id),
                FOREIGN KEY(checkpoint_id) REFERENCES application_checkpoint_receipts(checkpoint_id),
                UNIQUE(user_id, application_id, run_id, checkpoint_id),
                CHECK(checkpoint_kind IN ('SUBMISSION', 'EXPLICIT_SAVE')),
                CHECK(source IN ('VERIFIED_SUBMISSION', 'EXPLICIT_CANDIDATE_SAVE')),
                CHECK(status = 'COMMITTED'),
                CHECK(length(payload_hash) = 64),
                CHECK(item_count BETWEEN 1 AND 50),
                CHECK(json_valid(summary_json))
            );

            CREATE TABLE candidate_answer_change_set_items (
                id TEXT PRIMARY KEY,
                change_set_id TEXT NOT NULL,
                observation_id TEXT NOT NULL,
                field_logical_id TEXT NOT NULL,
                canonical_key TEXT NOT NULL,
                scope_hash TEXT NOT NULL,
                previous_version_id TEXT,
                learned_version_id TEXT NOT NULL,
                normalized_hash TEXT NOT NULL,
                presentation_mode TEXT NOT NULL,
                reason_codes_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'LEARNED',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(change_set_id) REFERENCES candidate_answer_change_sets(id),
                FOREIGN KEY(observation_id) REFERENCES field_interaction_observations(observation_id),
                FOREIGN KEY(previous_version_id) REFERENCES candidate_answer_versions(id),
                FOREIGN KEY(learned_version_id) REFERENCES candidate_answer_versions(id),
                UNIQUE(change_set_id, learned_version_id),
                UNIQUE(change_set_id, canonical_key, scope_hash),
                CHECK(length(scope_hash) = 64),
                CHECK(length(normalized_hash) = 64),
                CHECK(presentation_mode IN ('AUTO_QUIET', 'AUTO_PROMINENT')),
                CHECK(status = 'LEARNED'),
                CHECK(json_valid(reason_codes_json))
            );

            CREATE TABLE candidate_answer_change_set_receipts (
                user_id TEXT NOT NULL,
                idempotency_key TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                change_set_id TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(user_id, idempotency_key),
                FOREIGN KEY(change_set_id) REFERENCES candidate_answer_change_sets(id),
                CHECK(length(payload_hash) = 64)
            );

            CREATE INDEX candidate_answer_change_sets_user
                ON candidate_answer_change_sets(user_id, created_at DESC);
            CREATE INDEX candidate_answer_change_sets_application
                ON candidate_answer_change_sets(application_id, run_id, created_at DESC);
            CREATE INDEX candidate_answer_change_set_items_set
                ON candidate_answer_change_set_items(change_set_id, canonical_key);

            CREATE TRIGGER candidate_answer_change_sets_immutable_update
                BEFORE UPDATE ON candidate_answer_change_sets
                BEGIN SELECT RAISE(ABORT, 'candidate answer change sets are immutable'); END;
            CREATE TRIGGER candidate_answer_change_sets_immutable_delete
                BEFORE DELETE ON candidate_answer_change_sets
                BEGIN SELECT RAISE(ABORT, 'candidate answer change sets are immutable'); END;
            CREATE TRIGGER candidate_answer_change_set_items_immutable_update
                BEFORE UPDATE ON candidate_answer_change_set_items
                BEGIN SELECT RAISE(ABORT, 'candidate answer change set items are immutable'); END;
            CREATE TRIGGER candidate_answer_change_set_items_immutable_delete
                BEFORE DELETE ON candidate_answer_change_set_items
                BEGIN SELECT RAISE(ABORT, 'candidate answer change set items are immutable'); END;
        `);
    },
    verify(db) {
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all().map((row) => row.name));
        const triggers = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
            .all().map((row) => row.name));
        return ["candidate_answer_change_sets", "candidate_answer_change_set_items",
            "candidate_answer_change_set_receipts"].every((table) => tables.has(table))
            && triggers.has("candidate_answer_change_sets_immutable_update")
            && triggers.has("candidate_answer_change_set_items_immutable_update");
    }
});

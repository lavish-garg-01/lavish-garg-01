import { defineMigration } from "../migrationRunner.js";

export const candidateAnswerRuntimeProposalsMigration = defineMigration({
    id: "0020_candidate_answer_runtime_proposals",
    description: "Stage candidate-private runtime answer proposals until a verified checkpoint or explicit save",
    up(db) {
        db.exec(`
            CREATE TABLE candidate_answer_runtime_proposals (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                application_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                observation_id TEXT NOT NULL,
                field_logical_id TEXT NOT NULL,
                canonical_key TEXT NOT NULL,
                normalized_value_json TEXT NOT NULL,
                final_value_hash TEXT NOT NULL,
                context_json TEXT NOT NULL DEFAULT '{}',
                scope_qualifiers_json TEXT NOT NULL DEFAULT '{}',
                expected_active_version_id TEXT,
                used_answer_version_id TEXT,
                source TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                reason_codes_json TEXT NOT NULL DEFAULT '[]',
                change_set_id TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(application_id) REFERENCES applications(id),
                FOREIGN KEY(run_id) REFERENCES application_attempts(id),
                FOREIGN KEY(observation_id) REFERENCES field_interaction_observations(observation_id),
                FOREIGN KEY(expected_active_version_id) REFERENCES candidate_answer_versions(id),
                FOREIGN KEY(used_answer_version_id) REFERENCES candidate_answer_versions(id),
                FOREIGN KEY(change_set_id) REFERENCES candidate_answer_change_sets(id),
                UNIQUE(user_id, run_id, observation_id),
                CHECK(source IN ('USER_MANUAL_INPUT', 'VERSIONED_REUSE')),
                CHECK(status IN ('PENDING', 'HELD', 'COMMITTED', 'UNCHANGED', 'DISCARDED', 'SUPERSEDED')),
                CHECK(length(final_value_hash) = 64),
                CHECK(json_valid(normalized_value_json)),
                CHECK(json_valid(context_json)),
                CHECK(json_valid(scope_qualifiers_json)),
                CHECK(json_valid(reason_codes_json))
            );

            CREATE INDEX candidate_answer_runtime_pending_run
                ON candidate_answer_runtime_proposals(user_id, application_id, run_id, status, created_at);
            CREATE INDEX candidate_answer_runtime_pending_review
                ON candidate_answer_runtime_proposals(user_id, status, updated_at DESC);

            UPDATE feature_flags
            SET enabled = 1,
                payload_json = '{"mode":"LOCAL_CANARY","reasonCodes":["SERVER_STAGED_PROPOSALS","VERIFIED_CHECKPOINT_REQUIRED"]}',
                updated_at = CURRENT_TIMESTAMP
            WHERE key = 'candidate-answer-intelligence.change-sets'
              AND enabled = 0
              AND json_extract(payload_json, '$.mode') = 'SHADOW';
        `);
    },
    verify(db) {
        const columns = new Set(db.prepare("PRAGMA table_info(candidate_answer_runtime_proposals)")
            .all().map((row) => row.name));
        const flag = db.prepare(`SELECT enabled, payload_json FROM feature_flags
            WHERE key = 'candidate-answer-intelligence.change-sets'`).get();
        return ["normalized_value_json", "final_value_hash", "scope_qualifiers_json", "status", "change_set_id"]
            .every((column) => columns.has(column))
            && Boolean(flag?.enabled)
            && JSON.parse(flag?.payload_json || "{}").mode === "LOCAL_CANARY";
    }
});

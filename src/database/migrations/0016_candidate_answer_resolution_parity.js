import { defineMigration } from "../migrationRunner.js";

export const candidateAnswerResolutionParityMigration = defineMigration({
    id: "0016_candidate_answer_resolution_parity",
    description: "Add value-redacted candidate-answer resolver parity events and append-only mode history",
    up(db) {
        db.exec(`
            CREATE TABLE candidate_answer_resolution_parity_events (
                id TEXT PRIMARY KEY,
                event_key TEXT NOT NULL UNIQUE,
                user_id TEXT NOT NULL,
                application_id TEXT,
                application_run_id TEXT,
                field_logical_id TEXT NOT NULL,
                canonical_key TEXT,
                resolver_mode TEXT NOT NULL,
                production_source TEXT NOT NULL,
                legacy_decision TEXT NOT NULL,
                versioned_decision TEXT NOT NULL,
                comparison_outcome TEXT NOT NULL,
                legacy_value_hash TEXT,
                versioned_value_hash TEXT,
                contract_id TEXT,
                candidate_answer_version_id TEXT,
                policy_version INTEGER,
                risk_tier TEXT,
                reason_codes_json TEXT NOT NULL DEFAULT '[]',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE SET NULL,
                FOREIGN KEY(candidate_answer_version_id) REFERENCES candidate_answer_versions(id),
                CHECK(resolver_mode IN ('LEGACY_ONLY', 'SHADOW_COMPARE', 'CANARY', 'VERSIONED_PRIMARY')),
                CHECK(production_source IN ('LEGACY', 'VERSIONED', 'NONE')),
                CHECK(legacy_decision IN ('READY', 'NEEDS_USER')),
                CHECK(versioned_decision IN ('READY', 'REVIEW_REQUIRED', 'NEEDS_USER', 'NOT_EVALUATED')),
                CHECK(comparison_outcome IN (
                    'NOT_COMPARED', 'MATCH', 'BOTH_NEED_USER', 'LEGACY_ONLY', 'VERSIONED_ONLY',
                    'VALUE_MISMATCH', 'REVIEW_POLICY_MISMATCH', 'SHADOW_ERROR'
                )),
                CHECK(legacy_value_hash IS NULL OR length(legacy_value_hash) = 64),
                CHECK(versioned_value_hash IS NULL OR length(versioned_value_hash) = 64),
                CHECK(json_valid(reason_codes_json))
            );

            CREATE INDEX candidate_answer_parity_recent
                ON candidate_answer_resolution_parity_events(created_at DESC, comparison_outcome);
            CREATE INDEX candidate_answer_parity_user
                ON candidate_answer_resolution_parity_events(user_id, created_at DESC);
            CREATE INDEX candidate_answer_parity_canonical
                ON candidate_answer_resolution_parity_events(canonical_key, created_at DESC);

            CREATE TABLE candidate_answer_resolver_mode_history (
                id TEXT PRIMARY KEY,
                from_mode TEXT NOT NULL,
                to_mode TEXT NOT NULL,
                canary_percent INTEGER NOT NULL DEFAULT 0,
                gate_passed INTEGER NOT NULL DEFAULT 0,
                gate_snapshot_json TEXT NOT NULL DEFAULT '{}',
                reason_codes_json TEXT NOT NULL DEFAULT '[]',
                changed_by TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CHECK(from_mode IN ('LEGACY_ONLY', 'SHADOW_COMPARE', 'CANARY', 'VERSIONED_PRIMARY')),
                CHECK(to_mode IN ('LEGACY_ONLY', 'SHADOW_COMPARE', 'CANARY', 'VERSIONED_PRIMARY')),
                CHECK(canary_percent BETWEEN 0 AND 10),
                CHECK(gate_passed IN (0, 1)),
                CHECK(json_valid(gate_snapshot_json)),
                CHECK(json_valid(reason_codes_json))
            );

            CREATE INDEX candidate_answer_resolver_mode_history_recent
                ON candidate_answer_resolver_mode_history(created_at DESC);

            INSERT OR IGNORE INTO feature_flags
                (key, enabled, scope, payload_json, updated_at)
            VALUES (
                'candidate-answer-intelligence.resolver-mode', 1, 'global',
                '{"mode":"SHADOW_COMPARE","canaryPercent":0,"gatePassed":false,"reasonCodes":["SAFE_SHADOW_DEFAULT"]}',
                CURRENT_TIMESTAMP
            );
        `);
    },
    verify(db) {
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all().map((row) => row.name));
        const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
            .all().map((row) => row.name));
        return tables.has("candidate_answer_resolution_parity_events")
            && tables.has("candidate_answer_resolver_mode_history")
            && indexes.has("candidate_answer_parity_recent")
            && indexes.has("candidate_answer_resolver_mode_history_recent");
    }
});

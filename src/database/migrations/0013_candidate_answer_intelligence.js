import { defineMigration } from "../migrationRunner.js";

export const candidateAnswerIntelligenceMigration = defineMigration({
    id: "0013_candidate_answer_intelligence",
    description: "Add immutable canonical answer policies, controlled context registries, and append-only candidate truth versions",
    up(db) {
        db.exec(`
            CREATE TABLE canonical_answer_freshness_profiles (
                profile_key TEXT PRIMARY KEY,
                max_age_days INTEGER,
                stale_behavior TEXT NOT NULL,
                description TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CHECK(max_age_days IS NULL OR (max_age_days >= 1 AND max_age_days <= 3650))
            );

            CREATE TABLE canonical_answer_anomaly_profiles (
                profile_key TEXT PRIMARY KEY,
                rules_json TEXT NOT NULL DEFAULT '{}',
                default_presentation TEXT NOT NULL,
                description TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CHECK(json_valid(rules_json))
            );

            CREATE TABLE canonical_answer_policies (
                canonical_key TEXT NOT NULL,
                policy_version INTEGER NOT NULL,
                answer_kind TEXT NOT NULL,
                value_type TEXT NOT NULL,
                question_family TEXT NOT NULL,
                scope_policy TEXT NOT NULL,
                scope_dimensions_json TEXT NOT NULL DEFAULT '[]',
                required_scope_dimensions_json TEXT NOT NULL DEFAULT '[]',
                reuse_policy TEXT NOT NULL,
                learning_mode TEXT NOT NULL,
                learning_presentation TEXT NOT NULL,
                anomaly_profile TEXT,
                autofill_mode TEXT NOT NULL,
                authorization_mode TEXT NOT NULL,
                freshness_profile TEXT,
                dependency_keys_json TEXT NOT NULL DEFAULT '[]',
                derivation_policy TEXT NOT NULL,
                sensitivity TEXT NOT NULL,
                risk_tier TEXT NOT NULL,
                reason_code TEXT NOT NULL,
                config_hash TEXT NOT NULL,
                created_source TEXT NOT NULL DEFAULT 'CODE_REVIEWED_SEED',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(canonical_key, policy_version),
                UNIQUE(canonical_key, config_hash),
                FOREIGN KEY(canonical_key) REFERENCES canonical_fields(key),
                FOREIGN KEY(freshness_profile) REFERENCES canonical_answer_freshness_profiles(profile_key),
                FOREIGN KEY(anomaly_profile) REFERENCES canonical_answer_anomaly_profiles(profile_key),
                CHECK(policy_version >= 1),
                CHECK(json_valid(scope_dimensions_json)),
                CHECK(json_valid(required_scope_dimensions_json)),
                CHECK(json_valid(dependency_keys_json))
            );

            CREATE TABLE canonical_answer_policy_active (
                canonical_key TEXT PRIMARY KEY,
                policy_version INTEGER NOT NULL,
                activated_by TEXT NOT NULL DEFAULT 'CODE_REVIEWED_SEED',
                activated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(canonical_key, policy_version)
                    REFERENCES canonical_answer_policies(canonical_key, policy_version)
            );

            CREATE VIEW active_canonical_answer_policies AS
            SELECT p.* FROM canonical_answer_policies p
            JOIN canonical_answer_policy_active a
              ON a.canonical_key = p.canonical_key AND a.policy_version = p.policy_version;

            CREATE TABLE answer_context_registry (
                dimension TEXT NOT NULL,
                context_key TEXT NOT NULL,
                label TEXT NOT NULL,
                aliases_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(dimension, context_key),
                CHECK(json_valid(aliases_json))
            );

            CREATE TABLE employer_entity_groups (
                id TEXT PRIMARY KEY,
                normalized_name TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE employer_entities (
                id TEXT PRIMARY KEY,
                employer_group_id TEXT NOT NULL,
                company_id TEXT,
                normalized_name TEXT NOT NULL,
                normalized_domain TEXT NOT NULL DEFAULT '',
                legal_name TEXT,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(employer_group_id) REFERENCES employer_entity_groups(id),
                FOREIGN KEY(company_id) REFERENCES companies(id),
                UNIQUE(company_id),
                UNIQUE(normalized_name, normalized_domain)
            );

            CREATE TABLE candidate_answer_versions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                canonical_key TEXT NOT NULL,
                scope_qualifiers_json TEXT NOT NULL DEFAULT '{}',
                scope_hash TEXT NOT NULL,
                scope_rank_json TEXT NOT NULL DEFAULT '[]',
                scope_specificity INTEGER NOT NULL DEFAULT 0,
                value_json TEXT NOT NULL,
                normalized_hash TEXT NOT NULL,
                source TEXT NOT NULL,
                source_version_id TEXT,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                evidence_score INTEGER NOT NULL DEFAULT 0,
                evidence_observations INTEGER NOT NULL DEFAULT 0,
                policy_version INTEGER NOT NULL,
                confirmed_at DATETIME,
                valid_until DATETIME,
                invalidated_at DATETIME,
                invalidation_reason TEXT,
                supersedes_id TEXT,
                row_version INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(canonical_key, policy_version)
                    REFERENCES canonical_answer_policies(canonical_key, policy_version),
                FOREIGN KEY(supersedes_id) REFERENCES candidate_answer_versions(id),
                CHECK(json_valid(scope_qualifiers_json)),
                CHECK(json_valid(scope_rank_json)),
                CHECK(json_valid(value_json)),
                CHECK(row_version >= 1)
            );

            CREATE UNIQUE INDEX candidate_answer_one_active
                ON candidate_answer_versions(user_id, canonical_key, scope_hash)
                WHERE status = 'ACTIVE';
            CREATE INDEX candidate_answer_bootstrap
                ON candidate_answer_versions(user_id, status, canonical_key, scope_specificity DESC);
            CREATE INDEX candidate_answer_active_lookup
                ON candidate_answer_versions(user_id, canonical_key, scope_hash, created_at DESC)
                WHERE status = 'ACTIVE';

            CREATE TABLE candidate_answer_write_receipts (
                user_id TEXT NOT NULL,
                idempotency_key TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                answer_version_id TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(user_id, idempotency_key),
                FOREIGN KEY(answer_version_id) REFERENCES candidate_answer_versions(id)
            );

            CREATE TABLE candidate_answer_dependency_events (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                dependency_key TEXT NOT NULL,
                source_version_id TEXT,
                reason_code TEXT NOT NULL,
                invalidated_count INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX candidate_answer_dependency_lookup
                ON candidate_answer_dependency_events(user_id, dependency_key, created_at DESC);
            CREATE INDEX employer_entity_exact_name
                ON employer_entities(normalized_name, status);
            CREATE INDEX employer_entity_exact_domain
                ON employer_entities(normalized_domain, status);
            CREATE INDEX answer_context_alias
                ON answer_context_registry(dimension, status);
        `);
    },
    verify(db) {
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
        const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name));
        return [
            "canonical_answer_freshness_profiles", "canonical_answer_anomaly_profiles",
            "canonical_answer_policies", "canonical_answer_policy_active", "answer_context_registry",
            "employer_entity_groups", "employer_entities", "candidate_answer_versions",
            "candidate_answer_write_receipts", "candidate_answer_dependency_events"
        ].every((table) => tables.has(table)) && indexes.has("candidate_answer_one_active");
    }
});

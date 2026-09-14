import { defineMigration } from "../migrationRunner.js";

function addColumn(db, table, name, ddl) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
    if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

export const fieldSemanticLearningMigration = defineMigration({
    id: "0005_field_semantic_learning",
    description: "Add versioned field semantic mappings, canonical proposals, question catalog, and append-only evidence",
    up(db) {
        addColumn(db, "canonical_fields", "description", "description TEXT");
        addColumn(db, "canonical_fields", "semantic_group", "semantic_group TEXT");
        addColumn(db, "canonical_fields", "answer_type", "answer_type TEXT");
        addColumn(db, "canonical_fields", "status", "status TEXT NOT NULL DEFAULT 'TRUSTED'");
        addColumn(db, "canonical_fields", "created_source", "created_source TEXT NOT NULL DEFAULT 'LEGACY'");
        addColumn(db, "canonical_fields", "canonical_version", "canonical_version INTEGER NOT NULL DEFAULT 1");
        addColumn(db, "canonical_fields", "reuse_policy", "reuse_policy TEXT NOT NULL DEFAULT 'WHEN_RELEVANT'");
        addColumn(db, "canonical_fields", "autofill_policy", "autofill_policy TEXT NOT NULL DEFAULT 'POLICY_CONTROLLED'");
        addColumn(db, "canonical_fields", "ask_policy", "ask_policy TEXT NOT NULL DEFAULT 'WHEN_RELEVANT'");
        addColumn(db, "canonical_fields", "merged_into_key", "merged_into_key TEXT");

        db.exec(`
            UPDATE canonical_fields
            SET description = COALESCE(NULLIF(description, ''), label),
                semantic_group = COALESCE(NULLIF(semantic_group, ''), LOWER(category)),
                answer_type = COALESCE(NULLIF(answer_type, ''), data_type),
                status = COALESCE(NULLIF(status, ''), 'TRUSTED'),
                created_source = COALESCE(NULLIF(created_source, ''), 'LEGACY');

            CREATE TABLE IF NOT EXISTS field_semantic_mappings (
                id TEXT PRIMARY KEY,
                canonical_field_key TEXT NOT NULL,
                exact_fingerprint TEXT NOT NULL UNIQUE,
                semantic_fingerprint TEXT,
                normalized_label TEXT NOT NULL,
                ats_type TEXT NOT NULL DEFAULT '',
                site_host TEXT NOT NULL DEFAULT '',
                control_type TEXT NOT NULL DEFAULT 'text',
                section_family TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'RULE',
                confidence REAL NOT NULL DEFAULT 0,
                evidence_score INTEGER NOT NULL DEFAULT 0,
                kept_count INTEGER NOT NULL DEFAULT 0,
                overwrite_count INTEGER NOT NULL DEFAULT 0,
                observation_count INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'CANDIDATE',
                ai_model TEXT,
                prompt_version TEXT,
                first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_validated_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(canonical_field_key) REFERENCES canonical_fields(key)
            );

            CREATE TABLE IF NOT EXISTS canonical_examples (
                id TEXT PRIMARY KEY,
                canonical_field_key TEXT NOT NULL,
                example_text TEXT NOT NULL,
                normalized_text TEXT NOT NULL,
                embedding_json TEXT,
                embedding_model TEXT,
                source TEXT NOT NULL DEFAULT 'REGISTRY',
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(canonical_field_key, normalized_text),
                FOREIGN KEY(canonical_field_key) REFERENCES canonical_fields(key)
            );

            CREATE TABLE IF NOT EXISTS canonical_question_catalog (
                canonical_field_key TEXT PRIMARY KEY,
                display_question TEXT NOT NULL,
                answer_type TEXT NOT NULL DEFAULT 'TEXT',
                options_json TEXT NOT NULL DEFAULT '[]',
                attention_type TEXT NOT NULL DEFAULT 'FACT_REQUIRED',
                ask_policy TEXT NOT NULL DEFAULT 'WHEN_RELEVANT',
                status TEXT NOT NULL DEFAULT 'TRUSTED',
                created_source TEXT NOT NULL DEFAULT 'REGISTRY',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(canonical_field_key) REFERENCES canonical_fields(key)
            );

            CREATE TABLE IF NOT EXISTS semantic_mapping_evidence (
                id TEXT PRIMARY KEY,
                evidence_key TEXT NOT NULL UNIQUE,
                mapping_id TEXT NOT NULL,
                application_id TEXT,
                attempt_id TEXT,
                field_signature TEXT,
                event_type TEXT NOT NULL,
                score_delta INTEGER NOT NULL DEFAULT 0,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(mapping_id) REFERENCES field_semantic_mappings(id),
                FOREIGN KEY(application_id) REFERENCES applications(id),
                FOREIGN KEY(attempt_id) REFERENCES application_attempts(id)
            );

            CREATE INDEX IF NOT EXISTS idx_semantic_mapping_normalized
                ON field_semantic_mappings(normalized_label, control_type, section_family, status);
            CREATE INDEX IF NOT EXISTS idx_semantic_mapping_ats
                ON field_semantic_mappings(ats_type, site_host, normalized_label, status);
            CREATE INDEX IF NOT EXISTS idx_semantic_mapping_canonical
                ON field_semantic_mappings(canonical_field_key, status, evidence_score);
            CREATE INDEX IF NOT EXISTS idx_canonical_examples_status
                ON canonical_examples(status, canonical_field_key);
            CREATE INDEX IF NOT EXISTS idx_semantic_mapping_evidence_mapping
                ON semantic_mapping_evidence(mapping_id, created_at);

            INSERT OR IGNORE INTO canonical_examples
                (id, canonical_field_key, example_text, normalized_text, source, status)
            SELECT 'definition:' || LOWER(key), key, label, LOWER(TRIM(label)), 'REGISTRY',
                   CASE WHEN status IN ('TRUSTED', 'VALIDATED') THEN 'ACTIVE' ELSE 'CANDIDATE' END
            FROM canonical_fields
            WHERE TRIM(label) != '';

            INSERT OR IGNORE INTO canonical_question_catalog
                (canonical_field_key, display_question, answer_type, attention_type, ask_policy, status, created_source)
            SELECT key, label, COALESCE(answer_type, data_type), 'FACT_REQUIRED',
                   COALESCE(ask_policy, 'WHEN_RELEVANT'), status, 'REGISTRY'
            FROM canonical_fields;

            INSERT OR IGNORE INTO field_semantic_mappings
                (id, canonical_field_key, exact_fingerprint, semantic_fingerprint,
                 normalized_label, source, confidence, evidence_score, observation_count, status)
            SELECT 'legacy:' || normalized_question_hash, canonical_field_key,
                   normalized_question_hash, normalized_question_hash, normalized_question,
                   resolution_source, confidence, observation_count, observation_count, 'VALIDATED'
            FROM question_mappings;

            INSERT OR IGNORE INTO canonical_examples
                (id, canonical_field_key, example_text, normalized_text, source, status)
            SELECT 'legacy-question:' || normalized_question_hash, canonical_field_key,
                   normalized_question, normalized_question, resolution_source, 'ACTIVE'
            FROM question_mappings;
        `);
    },
    verify(db) {
        const canonicalColumns = new Set(db.prepare("PRAGMA table_info(canonical_fields)").all().map((column) => column.name));
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
        return ["description", "semantic_group", "answer_type", "status", "created_source",
            "reuse_policy", "autofill_policy", "ask_policy", "merged_into_key"]
            .every((column) => canonicalColumns.has(column))
            && ["field_semantic_mappings", "canonical_examples", "canonical_question_catalog", "semantic_mapping_evidence"]
                .every((table) => tables.has(table));
    }
});

import { defineMigration } from "../migrationRunner.js";

export const fieldRevisionTimelineMigration = defineMigration({
    id: "0007_field_revision_timeline",
    description: "Persist value-free field revisions, edit sessions, checkpoint receipts, neutral observations and shadow classifications",
    up(db) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS field_revision_events (
                revision_id TEXT PRIMARY KEY,
                application_id TEXT NOT NULL,
                attempt_id TEXT NOT NULL,
                logical_field_fingerprint TEXT NOT NULL,
                operation_id TEXT,
                edit_session_id TEXT,
                sequence INTEGER NOT NULL,
                actor TEXT NOT NULL,
                event_type TEXT NOT NULL,
                client_time_ms INTEGER NOT NULL,
                contract_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(application_id) REFERENCES applications(id),
                FOREIGN KEY(attempt_id) REFERENCES application_attempts(id)
            );

            CREATE TABLE IF NOT EXISTS field_edit_session_snapshots (
                id TEXT PRIMARY KEY,
                edit_session_id TEXT NOT NULL,
                application_id TEXT NOT NULL,
                attempt_id TEXT NOT NULL,
                logical_field_fingerprint TEXT NOT NULL,
                status TEXT NOT NULL,
                first_revision_sequence INTEGER NOT NULL,
                last_revision_sequence INTEGER NOT NULL,
                contract_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(edit_session_id, last_revision_sequence, status),
                FOREIGN KEY(application_id) REFERENCES applications(id),
                FOREIGN KEY(attempt_id) REFERENCES application_attempts(id)
            );

            CREATE TABLE IF NOT EXISTS application_checkpoint_receipts (
                checkpoint_id TEXT PRIMARY KEY,
                application_id TEXT NOT NULL,
                attempt_id TEXT NOT NULL,
                checkpoint_type TEXT NOT NULL,
                status TEXT NOT NULL,
                observed_at_ms INTEGER NOT NULL,
                evidence_hash TEXT NOT NULL,
                contract_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(application_id) REFERENCES applications(id),
                FOREIGN KEY(attempt_id) REFERENCES application_attempts(id)
            );

            CREATE TABLE IF NOT EXISTS field_interaction_observations (
                observation_id TEXT PRIMARY KEY,
                application_id TEXT NOT NULL,
                attempt_id TEXT NOT NULL,
                logical_field_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                protected INTEGER NOT NULL DEFAULT 0,
                contract_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(application_id) REFERENCES applications(id),
                FOREIGN KEY(attempt_id) REFERENCES application_attempts(id)
            );

            CREATE TABLE IF NOT EXISTS field_learning_shadow_classifications (
                id TEXT PRIMARY KEY,
                observation_id TEXT NOT NULL UNIQUE,
                application_id TEXT NOT NULL,
                attempt_id TEXT NOT NULL,
                classification_version INTEGER NOT NULL,
                classification_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(observation_id) REFERENCES field_interaction_observations(observation_id),
                FOREIGN KEY(application_id) REFERENCES applications(id),
                FOREIGN KEY(attempt_id) REFERENCES application_attempts(id)
            );

            CREATE INDEX IF NOT EXISTS idx_field_revision_attempt_field
                ON field_revision_events(attempt_id, logical_field_fingerprint, sequence, client_time_ms);
            CREATE INDEX IF NOT EXISTS idx_edit_session_attempt_field
                ON field_edit_session_snapshots(attempt_id, logical_field_fingerprint, created_at);
            CREATE INDEX IF NOT EXISTS idx_checkpoint_attempt_time
                ON application_checkpoint_receipts(attempt_id, observed_at_ms);
            CREATE INDEX IF NOT EXISTS idx_interaction_observation_attempt
                ON field_interaction_observations(attempt_id, logical_field_id, created_at);
        `);
    },
    verify(db) {
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
        return ["field_revision_events", "field_edit_session_snapshots", "application_checkpoint_receipts",
            "field_interaction_observations", "field_learning_shadow_classifications"]
            .every((table) => tables.has(table));
    }
});

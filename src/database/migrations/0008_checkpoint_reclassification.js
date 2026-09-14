import { defineMigration } from "../migrationRunner.js";

export const checkpointReclassificationMigration = defineMigration({
    id: "0008_checkpoint_reclassification",
    description: "Allow append-only shadow reclassification as stronger checkpoints arrive",
    up(db) {
        db.exec(`
            ALTER TABLE field_learning_shadow_classifications
                RENAME TO field_learning_shadow_classifications_v1;

            CREATE TABLE field_learning_shadow_classifications (
                id TEXT PRIMARY KEY,
                observation_id TEXT NOT NULL,
                application_id TEXT NOT NULL,
                attempt_id TEXT NOT NULL,
                classification_version INTEGER NOT NULL,
                classification_hash TEXT NOT NULL,
                classification_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(observation_id, classification_hash),
                FOREIGN KEY(observation_id) REFERENCES field_interaction_observations(observation_id),
                FOREIGN KEY(application_id) REFERENCES applications(id),
                FOREIGN KEY(attempt_id) REFERENCES application_attempts(id)
            );

            INSERT INTO field_learning_shadow_classifications
                (id, observation_id, application_id, attempt_id, classification_version,
                 classification_hash, classification_json, created_at)
            SELECT id, observation_id, application_id, attempt_id, classification_version,
                   lower(hex(randomblob(32))), classification_json, created_at
            FROM field_learning_shadow_classifications_v1;

            DROP TABLE field_learning_shadow_classifications_v1;
            CREATE INDEX IF NOT EXISTS idx_shadow_classification_attempt
                ON field_learning_shadow_classifications(attempt_id, created_at);
        `);
    },
    verify(db) {
        const columns = new Set(db.prepare("PRAGMA table_info(field_learning_shadow_classifications)").all().map((column) => column.name));
        return columns.has("classification_hash")
            && !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='field_learning_shadow_classifications_v1'").get();
    }
});


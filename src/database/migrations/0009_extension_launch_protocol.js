import { defineMigration } from "../migrationRunner.js";

export const extensionLaunchProtocolMigration = defineMigration({
    id: "0009_extension_launch_protocol",
    description: "Add single-use extension launches, bound run sessions and replay protection",
    up(db) {
        db.exec(`
            CREATE TABLE extension_launch_authorizations (
                id TEXT PRIMARY KEY,
                token_hash TEXT NOT NULL UNIQUE,
                candidate_id TEXT NOT NULL,
                job_id TEXT NOT NULL,
                application_id TEXT NOT NULL,
                attempt_id TEXT NOT NULL,
                website_origin TEXT NOT NULL,
                target_origin TEXT NOT NULL,
                target_url_hash TEXT NOT NULL,
                protocol_version INTEGER NOT NULL,
                client_nonce_hash TEXT NOT NULL,
                expires_at_ms INTEGER NOT NULL,
                consumed_at_ms INTEGER,
                consumed_tab_id INTEGER,
                consumed_frame_id INTEGER,
                consumed_document_id TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(application_id) REFERENCES applications(id),
                FOREIGN KEY(attempt_id) REFERENCES application_attempts(id)
            );

            CREATE TABLE extension_run_bindings (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                application_id TEXT NOT NULL,
                candidate_id TEXT NOT NULL,
                launch_authorization_id TEXT NOT NULL UNIQUE,
                session_token_hash TEXT NOT NULL UNIQUE,
                protocol_version INTEGER NOT NULL,
                extension_version TEXT NOT NULL,
                website_origin TEXT NOT NULL,
                target_origin TEXT NOT NULL,
                tab_id INTEGER NOT NULL,
                frame_id INTEGER NOT NULL,
                document_id TEXT NOT NULL,
                document_lifecycle TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'ACTIVE',
                last_page_generation INTEGER NOT NULL DEFAULT 0,
                last_form_generation INTEGER NOT NULL DEFAULT 0,
                last_sequence INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                expires_at_ms INTEGER NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(application_id) REFERENCES applications(id),
                FOREIGN KEY(run_id) REFERENCES application_attempts(id),
                FOREIGN KEY(launch_authorization_id) REFERENCES extension_launch_authorizations(id)
            );

            CREATE TABLE extension_protocol_replays (
                message_id TEXT PRIMARY KEY,
                run_id TEXT,
                nonce_hash TEXT NOT NULL UNIQUE,
                message_type TEXT NOT NULL,
                source_origin TEXT NOT NULL,
                received_at_ms INTEGER NOT NULL,
                expires_at_ms INTEGER NOT NULL
            );

            CREATE TABLE extension_run_field_cache (
                run_id TEXT NOT NULL,
                logical_field_fingerprint TEXT NOT NULL,
                descriptor_hash TEXT NOT NULL,
                page_generation INTEGER NOT NULL,
                form_generation INTEGER NOT NULL,
                last_resolved_at_ms INTEGER NOT NULL,
                PRIMARY KEY(run_id, logical_field_fingerprint),
                FOREIGN KEY(run_id) REFERENCES application_attempts(id)
            );

            CREATE INDEX idx_extension_launch_expiry
                ON extension_launch_authorizations(expires_at_ms, consumed_at_ms);
            CREATE INDEX idx_extension_run_binding_active
                ON extension_run_bindings(run_id, state, created_at);
            CREATE INDEX idx_extension_protocol_replay_expiry
                ON extension_protocol_replays(expires_at_ms);
        `);
    },
    verify(db) {
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
        return ["extension_launch_authorizations", "extension_run_bindings", "extension_protocol_replays", "extension_run_field_cache"]
            .every((table) => tables.has(table));
    }
});

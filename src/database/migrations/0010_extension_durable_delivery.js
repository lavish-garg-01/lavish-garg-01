import { defineMigration } from "../migrationRunner.js";

export const extensionDurableDeliveryMigration = defineMigration({
    id: "0010_extension_durable_delivery",
    description: "Add tenant-bound idempotency, telemetry receipts, backend outbox and protocol audit",
    up(db) {
        db.exec(`
            CREATE TABLE extension_idempotency_requests (
                idempotency_key TEXT PRIMARY KEY,
                candidate_id TEXT NOT NULL,
                run_id TEXT,
                request_hash TEXT NOT NULL,
                state TEXT NOT NULL,
                response_status INTEGER,
                response_json TEXT,
                expires_at_ms INTEGER NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE extension_telemetry_events (
                telemetry_id TEXT PRIMARY KEY,
                candidate_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                occurred_at_ms INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                envelope_json TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(candidate_id, run_id, sequence),
                FOREIGN KEY(run_id) REFERENCES application_attempts(id)
            );

            CREATE TABLE extension_backend_outbox (
                id TEXT PRIMARY KEY,
                candidate_id TEXT NOT NULL,
                run_id TEXT,
                event_type TEXT NOT NULL,
                aggregate_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                attempts INTEGER NOT NULL DEFAULT 0,
                available_at_ms INTEGER NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                delivered_at DATETIME
            );

            CREATE TABLE extension_protocol_audit_events (
                id TEXT PRIMARY KEY,
                candidate_id TEXT NOT NULL,
                run_id TEXT,
                event_type TEXT NOT NULL,
                reason_code TEXT,
                metadata_json TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX idx_extension_idempotency_expiry
                ON extension_idempotency_requests(expires_at_ms, state);
            CREATE INDEX idx_extension_telemetry_run
                ON extension_telemetry_events(candidate_id, run_id, sequence);
            CREATE INDEX idx_extension_backend_outbox_pending
                ON extension_backend_outbox(status, available_at_ms);
            CREATE INDEX idx_extension_protocol_audit_run
                ON extension_protocol_audit_events(candidate_id, run_id, created_at);
        `);
    },
    verify(db) {
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
        return ["extension_idempotency_requests", "extension_telemetry_events", "extension_backend_outbox", "extension_protocol_audit_events"]
            .every((table) => tables.has(table));
    }
});


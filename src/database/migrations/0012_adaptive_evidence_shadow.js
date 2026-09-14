import { defineMigration } from "../migrationRunner.js";

export const adaptiveEvidenceShadowMigration = defineMigration({
    id: "0012_adaptive_evidence_shadow",
    description: "Add append-only adaptive evidence and materialized SHADOW recommendations",
    up(db) {
        db.exec(`
            CREATE TABLE adaptive_evidence_shadow_events (
                evidence_id TEXT PRIMARY KEY,
                candidate_id TEXT NOT NULL,
                observation_id TEXT NOT NULL,
                classification_hash TEXT NOT NULL,
                run_id TEXT NOT NULL,
                application_id TEXT NOT NULL,
                layer TEXT NOT NULL,
                subject_type TEXT NOT NULL,
                subject_key TEXT NOT NULL,
                subject_key_hash TEXT NOT NULL,
                aggregation_scope TEXT NOT NULL,
                scope_type TEXT NOT NULL,
                scope_key_hash TEXT NOT NULL DEFAULT '',
                direction TEXT NOT NULL,
                source TEXT NOT NULL,
                execution_context TEXT NOT NULL,
                checkpoint_type TEXT NOT NULL,
                effective_weight INTEGER NOT NULL,
                sample_weight_bps INTEGER NOT NULL,
                checkpoint_strength_bps INTEGER NOT NULL,
                form_fingerprint TEXT,
                extension_version TEXT,
                adapter_version TEXT,
                occurred_at_ms INTEGER NOT NULL,
                policy_version INTEGER NOT NULL,
                contract_json TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(observation_id, layer, classification_hash)
            );

            CREATE TABLE adaptive_evidence_shadow_rollups (
                rollup_key TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                aggregation_scope TEXT NOT NULL,
                layer TEXT NOT NULL,
                subject_type TEXT NOT NULL,
                subject_key TEXT NOT NULL,
                subject_key_hash TEXT NOT NULL,
                scope_type TEXT NOT NULL,
                scope_key_hash TEXT NOT NULL DEFAULT '',
                execution_context TEXT NOT NULL,
                lifetime_positive INTEGER NOT NULL DEFAULT 0,
                lifetime_negative INTEGER NOT NULL DEFAULT 0,
                lifetime_unknown_count INTEGER NOT NULL DEFAULT 0,
                recent_positive INTEGER NOT NULL DEFAULT 0,
                recent_negative INTEGER NOT NULL DEFAULT 0,
                recent_unknown_count INTEGER NOT NULL DEFAULT 0,
                effective_sample_size_bps INTEGER NOT NULL DEFAULT 0,
                independent_candidate_count INTEGER NOT NULL DEFAULT 0,
                independent_run_count INTEGER NOT NULL DEFAULT 0,
                independent_form_count INTEGER NOT NULL DEFAULT 0,
                state TEXT NOT NULL DEFAULT 'SHADOW_OBSERVING',
                volatile INTEGER NOT NULL DEFAULT 0,
                volatility_epoch INTEGER NOT NULL DEFAULT 0,
                policy_version INTEGER NOT NULL,
                decision_hash TEXT NOT NULL,
                decision_json TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                first_evidence_at_ms INTEGER,
                last_evidence_at_ms INTEGER,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE adaptive_evidence_shadow_recommendations (
                id TEXT PRIMARY KEY,
                rollup_key TEXT NOT NULL,
                state TEXT NOT NULL,
                decision_hash TEXT NOT NULL,
                reason_codes_json TEXT NOT NULL,
                inputs_hash TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'SHADOW',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(rollup_key) REFERENCES adaptive_evidence_shadow_rollups(rollup_key),
                UNIQUE(rollup_key, decision_hash)
            );

            CREATE INDEX idx_adaptive_evidence_subject
                ON adaptive_evidence_shadow_events(aggregation_scope, layer, subject_key_hash, scope_type, scope_key_hash, execution_context, occurred_at_ms);
            CREATE INDEX idx_adaptive_evidence_observation
                ON adaptive_evidence_shadow_events(observation_id, layer, checkpoint_strength_bps, occurred_at_ms);
            CREATE INDEX idx_adaptive_evidence_candidate
                ON adaptive_evidence_shadow_events(candidate_id, run_id, occurred_at_ms);
            CREATE INDEX idx_adaptive_rollup_state
                ON adaptive_evidence_shadow_rollups(state, volatile, updated_at);
            CREATE INDEX idx_adaptive_recommendation_rollup
                ON adaptive_evidence_shadow_recommendations(rollup_key, created_at);
        `);
    },
    verify(db) {
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
        return ["adaptive_evidence_shadow_events", "adaptive_evidence_shadow_rollups", "adaptive_evidence_shadow_recommendations"]
            .every((table) => tables.has(table));
    }
});

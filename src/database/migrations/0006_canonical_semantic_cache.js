import { defineMigration } from "../migrationRunner.js";

export const canonicalSemanticCacheMigration = defineMigration({
    id: "0006_canonical_semantic_cache",
    description: "Cache value-free semantic embeddings and bounded unresolved AI decisions",
    up(db) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS canonical_semantic_cache (
                semantic_fingerprint TEXT PRIMARY KEY,
                input_text_hash TEXT NOT NULL,
                embedding_json TEXT,
                embedding_model TEXT,
                ai_decision_json TEXT,
                decision_model TEXT,
                prompt_version TEXT,
                decision_expires_at DATETIME,
                embedding_hit_count INTEGER NOT NULL DEFAULT 0,
                decision_hit_count INTEGER NOT NULL DEFAULT 0,
                last_hit_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_canonical_semantic_cache_expiry
                ON canonical_semantic_cache(decision_expires_at);
        `);
    },
    verify(db) {
        const columns = new Set(db.prepare("PRAGMA table_info(canonical_semantic_cache)").all().map((column) => column.name));
        return ["semantic_fingerprint", "input_text_hash", "embedding_json", "embedding_model",
            "ai_decision_json", "decision_model", "prompt_version", "decision_expires_at",
            "embedding_hit_count", "decision_hit_count"].every((column) => columns.has(column));
    }
});

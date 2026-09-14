import crypto from "node:crypto";
import { getDb } from "../database/connection.js";

function inputHash(value) {
    return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function parseJson(value, fallback = null) {
    try { return JSON.parse(value || "null") ?? fallback; } catch { return fallback; }
}

export function getCachedSemanticEmbedding({ semanticFingerprint, inputText, model }) {
    const db = getDb();
    const row = db.prepare(`SELECT embedding_json FROM canonical_semantic_cache
        WHERE semantic_fingerprint = ? AND input_text_hash = ? AND embedding_model = ?
          AND embedding_json IS NOT NULL`).get(semanticFingerprint, inputHash(inputText), model);
    const embedding = parseJson(row?.embedding_json);
    if (!Array.isArray(embedding) || !embedding.length) return null;
    db.prepare(`UPDATE canonical_semantic_cache SET embedding_hit_count = embedding_hit_count + 1,
        last_hit_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE semantic_fingerprint = ?`)
        .run(semanticFingerprint);
    return embedding;
}

export function saveCachedSemanticEmbedding({ semanticFingerprint, inputText, model, embedding }) {
    if (!semanticFingerprint || !Array.isArray(embedding) || !embedding.length) return false;
    getDb().prepare(`INSERT INTO canonical_semantic_cache
        (semantic_fingerprint, input_text_hash, embedding_json, embedding_model)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(semantic_fingerprint) DO UPDATE SET
            input_text_hash = excluded.input_text_hash, embedding_json = excluded.embedding_json,
            embedding_model = excluded.embedding_model, updated_at = CURRENT_TIMESTAMP`)
        .run(semanticFingerprint, inputHash(inputText), JSON.stringify(embedding), model);
    return true;
}

export function getCachedCanonicalizationDecision({ semanticFingerprint, inputText, model, promptVersion }) {
    const db = getDb();
    const row = db.prepare(`SELECT ai_decision_json FROM canonical_semantic_cache
        WHERE semantic_fingerprint = ? AND input_text_hash = ?
          AND decision_model = ? AND prompt_version = ?
          AND ai_decision_json IS NOT NULL AND decision_expires_at > CURRENT_TIMESTAMP`)
        .get(semanticFingerprint, inputHash(inputText), model, promptVersion);
    const decision = parseJson(row?.ai_decision_json);
    if (!decision) return null;
    db.prepare(`UPDATE canonical_semantic_cache SET decision_hit_count = decision_hit_count + 1,
        last_hit_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE semantic_fingerprint = ?`)
        .run(semanticFingerprint);
    return decision;
}

export function saveCachedCanonicalizationDecision({ semanticFingerprint, inputText, model,
    promptVersion, decision, ttlHours = 24 }) {
    if (!semanticFingerprint || !decision) return false;
    const boundedTtl = Math.max(1, Math.min(168, Number(ttlHours) || 24));
    getDb().prepare(`INSERT INTO canonical_semantic_cache
        (semantic_fingerprint, input_text_hash, ai_decision_json, decision_model, prompt_version, decision_expires_at)
        VALUES (?, ?, ?, ?, ?, datetime('now', '+' || ? || ' hours'))
        ON CONFLICT(semantic_fingerprint) DO UPDATE SET
            input_text_hash = excluded.input_text_hash, ai_decision_json = excluded.ai_decision_json,
            decision_model = excluded.decision_model, prompt_version = excluded.prompt_version,
            decision_expires_at = excluded.decision_expires_at, updated_at = CURRENT_TIMESTAMP`)
        .run(semanticFingerprint, inputHash(inputText), JSON.stringify(decision), model, promptVersion, boundedTtl);
    return true;
}

export function semanticCacheDiagnostics() {
    return getDb().prepare(`SELECT COUNT(*) AS entries,
        COALESCE(SUM(embedding_hit_count), 0) AS embeddingHits,
        COALESCE(SUM(decision_hit_count), 0) AS decisionHits,
        SUM(CASE WHEN decision_expires_at > CURRENT_TIMESTAMP THEN 1 ELSE 0 END) AS activeDecisionEntries
        FROM canonical_semantic_cache`).get();
}

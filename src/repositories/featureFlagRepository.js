import { getDb } from "../database/connection.js";

function text(value, max = 120) {
    return String(value == null ? "" : value).trim().slice(0, max);
}

export function listFeatureFlags() {
    return getDb().prepare("SELECT * FROM feature_flags ORDER BY key").all().map((row) => ({
        key: row.key,
        enabled: Boolean(row.enabled),
        scope: row.scope,
        portalKind: row.portal_kind,
        payload: (() => { try { return JSON.parse(row.payload_json || "{}"); } catch { return {}; } })(),
        updatedAt: row.updated_at
    }));
}

export function getFeatureFlag(key, fallback = false) {
    const row = getDb().prepare("SELECT enabled, payload_json FROM feature_flags WHERE key = ?").get(text(key, 120));
    if (!row) return { key: text(key, 120), enabled: fallback, payload: {} };
    try {
        return { key: text(key, 120), enabled: Boolean(row.enabled), payload: JSON.parse(row.payload_json || "{}") };
    } catch {
        return { key: text(key, 120), enabled: Boolean(row.enabled), payload: {} };
    }
}

export function setFeatureFlag({ key, enabled, scope = "global", portalKind = null, payload = {} }) {
    const flagKey = text(key, 120);
    if (!flagKey) throw new Error("Flag key is required.");
    getDb().prepare(`
        INSERT INTO feature_flags (key, enabled, scope, portal_kind, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            enabled = excluded.enabled, scope = excluded.scope, portal_kind = excluded.portal_kind,
            payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP
    `).run(flagKey, enabled ? 1 : 0, text(scope, 40) || "global", portalKind ? text(portalKind, 80).toLowerCase() : null, JSON.stringify(payload || {}));
    return getFeatureFlag(flagKey);
}

export function isAdapterKilled(portalKind) {
    return getFeatureFlag(`kill.adapter.${String(portalKind || "").toLowerCase()}`).enabled;
}

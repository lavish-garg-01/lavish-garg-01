import crypto from "node:crypto";
import { getDb } from "../database/connection.js";
import { LOCAL_USER_ID } from "./copilotRepository.js";

const METERS = ["AI_TOKENS", "AI_ASSISTANT_REQUEST", "ADAPTER_FILL", "DOCUMENT_GEN"];

export function recordUsageEvent({ meterKey, quantity = 1, unit = "count", metadata = {} } = {}) {
    const key = String(meterKey || "").toUpperCase();
    if (!METERS.includes(key)) return null;
    try {
        getDb().prepare(`
            INSERT INTO usage_events (id, user_id, meter_key, quantity, unit, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            crypto.randomUUID(),
            LOCAL_USER_ID,
            key,
            Number(quantity) || 0,
            String(unit || "count").slice(0, 40),
            JSON.stringify(metadata && typeof metadata === "object" ? metadata : {})
        );
        return true;
    } catch (error) {
        console.warn("[usage] Could not record meter:", error.message);
        return false;
    }
}

export function usageSummary({ days = 30 } = {}) {
    const boundedDays = Math.max(1, Math.min(365, Number(days) || 30));
    const rows = getDb().prepare(`
        SELECT meter_key AS meterKey, SUM(quantity) AS quantity, COUNT(*) AS events
        FROM usage_events
        WHERE created_at >= datetime('now', ?)
        GROUP BY meter_key
    `).all(`-${boundedDays} days`);
    const meters = Object.fromEntries(METERS.map((key) => [key, { quantity: 0, events: 0 }]));
    for (const row of rows) {
        meters[row.meterKey] = { quantity: Number(row.quantity || 0), events: Number(row.events || 0) };
    }
    return { days: boundedDays, meters };
}

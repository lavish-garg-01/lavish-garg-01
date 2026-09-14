import { recordUsageEvent } from "../repositories/usageMeterRepository.js";
import { getDb } from "../database/connection.js";

// Prices are intentionally a local estimate, not an invoice. Update this table
// when the configured model changes; unknown models retain usage but no cost.
const TOKEN_PRICES_PER_MILLION_USD = {
    "gpt-4o-mini": { input: 0.15, output: 0.60 },
    "text-embedding-3-small": { input: 0.02, output: 0 }
};

function number(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function estimateAiCostUsd(model, inputTokens, outputTokens) {
    const price = TOKEN_PRICES_PER_MILLION_USD[String(model || "")];
    if (!price) return null;
    return Number((((number(inputTokens) * price.input) + (number(outputTokens) * price.output)) / 1_000_000).toFixed(8));
}

export function recordAiCall({ operation, model, usage, succeeded = true } = {}) {
    const inputTokens = number(usage?.prompt_tokens ?? usage?.input_tokens);
    const outputTokens = number(usage?.completion_tokens ?? usage?.output_tokens);
    const estimatedCostUsd = estimateAiCostUsd(model, inputTokens, outputTokens);
    try {
        getDb().prepare(`
            INSERT INTO ai_call_metrics (operation, model, input_tokens, output_tokens, estimated_cost_usd, succeeded)
            VALUES (?, ?, ?, ?, ?, ?)
        `)        .run(String(operation || "unknown").slice(0, 100), String(model || "unknown").slice(0, 100),
            inputTokens, outputTokens, estimatedCostUsd, succeeded ? 1 : 0);
        recordUsageEvent({
            meterKey: "AI_TOKENS",
            quantity: inputTokens + outputTokens,
            unit: "tokens",
            metadata: { operation: String(operation || "unknown"), model: String(model || "unknown"), succeeded }
        });
        return { inputTokens, outputTokens, estimatedCostUsd, recorded: true };
    } catch (error) {
        // Observability must never interrupt scoring, tailoring, or form filling.
        console.warn("[aiTelemetry] Could not record call:", error.message);
        return { inputTokens, outputTokens, estimatedCostUsd, recorded: false };
    }
}

export function aiUsageSummary({ days = 30 } = {}) {
    const boundedDays = Math.max(1, Math.min(365, Number(days) || 30));
    const row = getDb().prepare(`
        SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens), 0) AS inputTokens,
               COALESCE(SUM(output_tokens), 0) AS outputTokens,
               COALESCE(SUM(estimated_cost_usd), 0) AS estimatedCostUsd,
               COALESCE(SUM(CASE WHEN succeeded = 0 THEN 1 ELSE 0 END), 0) AS failedCalls,
               COALESCE(SUM(CASE WHEN estimated_cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unpricedCalls
        FROM ai_call_metrics
        WHERE created_at >= datetime('now', '-' || ? || ' days')
    `).get(boundedDays);
    return {
        calls: Number(row.calls || 0),
        inputTokens: Number(row.inputTokens || 0),
        outputTokens: Number(row.outputTokens || 0),
        estimatedCostUsd: Number(Number(row.estimatedCostUsd || 0).toFixed(6)),
        failedCalls: Number(row.failedCalls || 0),
        unpricedCalls: Number(row.unpricedCalls || 0),
        days: boundedDays
    };
}

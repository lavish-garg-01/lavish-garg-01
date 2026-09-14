import { getDb } from "../database/connection.js";

export function matchingDashboardMetrics(db = getDb(), { days = 30 } = {}) {
    const boundedDays = Math.max(1, Math.min(365, Number(days) || 30));
    const row = db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN ai_escalated = 0 THEN 1 ELSE 0 END) AS heuristicOnly,
        SUM(CASE WHEN ai_escalated = 1 THEN 1 ELSE 0 END) AS aiEscalated,
        SUM(CASE WHEN scoring_method IN ('MATCHING_POLICY_PREFILTER_V1','HEURISTIC_PREFILTER_V2') THEN 1 ELSE 0 END) AS prefiltered,
        AVG(confidence) AS averageConfidence,
        SUM(CASE WHEN outcome IN ('MATCHED','CLOSE') THEN 1 ELSE 0 END) AS compatible
        FROM job_score_events WHERE created_at >= datetime('now', '-' || ? || ' days')`).get(boundedDays);
    const methods = db.prepare(`SELECT scoring_method AS method, COUNT(*) AS count,
        AVG(final_score) AS averageScore, AVG(confidence) AS averageConfidence
        FROM job_score_events WHERE created_at >= datetime('now', '-' || ? || ' days')
        GROUP BY scoring_method ORDER BY count DESC`).all(boundedDays).map((item) => ({
            method: item.method,
            count: Number(item.count || 0),
            averageScore: Number(Number(item.averageScore || 0).toFixed(1)),
            averageConfidence: Number((Number(item.averageConfidence || 0) * 100).toFixed(1))
        }));
    const total = Number(row.total || 0);
    const heuristicOnly = Number(row.heuristicOnly || 0);
    return {
        days: boundedDays,
        total,
        heuristicOnly,
        aiEscalated: Number(row.aiEscalated || 0),
        prefiltered: Number(row.prefiltered || 0),
        compatible: Number(row.compatible || 0),
        aiAvoidanceRate: total ? Number(((heuristicOnly / total) * 100).toFixed(1)) : null,
        averageConfidence: total ? Number((Number(row.averageConfidence || 0) * 100).toFixed(1)) : null,
        methods
    };
}

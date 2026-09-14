import { getDb } from "../database/connection.js";

const EXPLORATION_SHARE = 0.35;
const POSTERIOR_PRIOR = 2;

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function freshnessQuality(value, fallback = 0.5) {
    const timestamp = new Date(value || 0).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= 0) return fallback;
    const ageDays = Math.max(0, (Date.now() - timestamp) / (24 * 60 * 60 * 1000));
    // Seven-day exponential decay rewards genuinely current sources without
    // permanently starving a slower board.
    return Math.exp(-ageDays / 7);
}

function betaPosterior(successes, trials, prior = POSTERIOR_PRIOR) {
    const safeTrials = Math.max(0, Number(trials) || 0);
    const safeSuccesses = clamp(successes, 0, safeTrials);
    const alpha = prior + safeSuccesses;
    const beta = prior + safeTrials - safeSuccesses;
    const total = alpha + beta;
    const mean = alpha / total;
    const variance = (alpha * beta) / ((total ** 2) * (total + 1));
    return {
        mean,
        standardDeviation: Math.sqrt(variance),
        trials: safeTrials
    };
}

export function sourceQualityEvidence(stat = {}, currentNewestAt = null) {
    const selected = Number(stat.totalSelected ?? stat.total_selected ?? 0);
    const matched = Number(stat.totalMatched ?? stat.total_matched ?? 0);
    const close = Number(stat.totalClose ?? stat.total_close ?? 0);
    const fetched = Number(stat.totalFetched ?? stat.total_fetched ?? 0);
    const inserted = Number(stat.totalInserted ?? stat.total_inserted ?? 0);
    const compatible = Math.min(selected, matched + close * 0.5);
    const compatiblePosterior = betaPosterior(compatible, selected);
    const uniquePosterior = betaPosterior(Math.min(fetched, inserted), fetched);
    const recency = freshnessQuality(
        currentNewestAt || stat.newestPostedAt || stat.newest_posted_at,
        fetched || selected ? 0.35 : 0.5
    );
    // A small uncertainty bonus learns about sparse/new sources while the hard
    // one-slot floor below prevents established high-volume sources starving them.
    const uncertainty = clamp(
        compatiblePosterior.standardDeviation + uniquePosterior.standardDeviation,
        0,
        0.5
    ) / 0.5;
    const quality = compatiblePosterior.mean * 0.50
        + uniquePosterior.mean * 0.20
        + recency * 0.20
        + uncertainty * 0.10;
    return {
        quality,
        compatiblePosterior: compatiblePosterior.mean,
        uniquePosterior: uniquePosterior.mean,
        recency,
        uncertainty,
        selected,
        fetched
    };
}

export function sourceQuality(stat = {}, currentNewestAt = null) {
    return sourceQualityEvidence(stat, currentNewestAt).quality;
}

function candidateTime(candidate) {
    const value = new Date(candidate.postedAt || candidate.posted_at || candidate.createdAt || 0).getTime();
    return Number.isFinite(value) ? value : 0;
}

export function adaptiveSourceSelection(candidates = [], limit = 50, historical = []) {
    const boundedLimit = Math.max(0, Math.floor(Number(limit) || 0));
    if (!boundedLimit || !candidates.length) return { selected: [], quotas: {}, weights: {} };
    const groups = new Map();
    for (const candidate of candidates) {
        const source = String(candidate.source || "unknown");
        if (!groups.has(source)) groups.set(source, []);
        groups.get(source).push(candidate);
    }
    for (const rows of groups.values()) rows.sort((a, b) => candidateTime(b) - candidateTime(a));
    const stats = new Map(historical.map((row) => [String(row.source), row]));
    let sources = [...groups.keys()];
    if (sources.length > boundedLimit) {
        sources = sources.sort((a, b) => {
            const aLast = new Date(stats.get(a)?.lastSelectedAt || stats.get(a)?.last_selected_at || 0).getTime() || 0;
            const bLast = new Date(stats.get(b)?.lastSelectedAt || stats.get(b)?.last_selected_at || 0).getTime() || 0;
            if (aLast !== bLast) return aLast - bLast;
            return candidateTime(groups.get(b)[0]) - candidateTime(groups.get(a)[0]);
        }).slice(0, boundedLimit);
    }
    const diagnostics = Object.fromEntries(sources.map((source) => [source,
        sourceQualityEvidence(stats.get(source), groups.get(source)[0]?.postedAt || groups.get(source)[0]?.posted_at)
    ]));
    const qualities = Object.fromEntries(sources.map((source) => [source, diagnostics[source].quality]));
    const qualityTotal = Object.values(qualities).reduce((sum, value) => sum + value, 0) || sources.length;
    const weights = Object.fromEntries(sources.map((source) => [source,
        (EXPLORATION_SHARE / sources.length) + ((1 - EXPLORATION_SHARE) * qualities[source] / qualityTotal)
    ]));
    const quotas = Object.fromEntries(sources.map((source) => [source, 1]));
    let remaining = boundedLimit - sources.length;
    const fractions = [];
    if (remaining > 0) {
        for (const source of sources) {
            const available = Math.max(0, groups.get(source).length - 1);
            const ideal = remaining * weights[source];
            const allocation = Math.min(available, Math.floor(ideal));
            quotas[source] += allocation;
            fractions.push({ source, fraction: ideal - Math.floor(ideal) });
        }
        remaining = boundedLimit - Object.values(quotas).reduce((sum, value) => sum + value, 0);
        fractions.sort((a, b) => b.fraction - a.fraction || qualities[b.source] - qualities[a.source]);
        while (remaining > 0) {
            let allocated = false;
            for (const { source } of fractions) {
                if (quotas[source] >= groups.get(source).length) continue;
                quotas[source] += 1;
                remaining -= 1;
                allocated = true;
                if (!remaining) break;
            }
            if (!allocated) break;
        }
    }
    const selected = [];
    let round = 0;
    while (selected.length < boundedLimit) {
        let added = false;
        for (const source of sources) {
            if (round >= quotas[source]) continue;
            const candidate = groups.get(source)[round];
            if (!candidate) continue;
            selected.push(candidate);
            added = true;
            if (selected.length >= boundedLimit) break;
        }
        if (!added) break;
        round += 1;
    }
    return { selected, quotas, weights, qualities, diagnostics };
}

export function ingestionHistory(db = getDb()) {
    return db.prepare(`SELECT source, newest_posted_at AS newestPostedAt,
        last_selected_at AS lastSelectedAt, total_fetched AS totalFetched,
        total_inserted AS totalInserted, total_selected AS totalSelected,
        total_matched AS totalMatched, total_close AS totalClose
        FROM ingestion_source_state ORDER BY source`).all();
}

export function dailyFetchRecommendation(db = getDb(), { days = 14 } = {}) {
    const boundedDays = Math.max(3, Math.min(90, Number(days) || 14));
    const row = db.prepare(`SELECT COALESCE(SUM(fetched_count),0) AS fetched,
        COALESCE(SUM(inserted_count),0) AS inserted,
        COUNT(DISTINCT date(created_at)) AS activeDays
        FROM ingestion_source_runs WHERE created_at >= datetime('now', '-' || ? || ' days')`).get(boundedDays);
    const activeDays = Math.max(1, Number(row.activeDays || 0));
    const fetched = Number(row.fetched || 0);
    const inserted = Number(row.inserted || 0);
    const observedYield = fetched ? inserted / fetched : 0;
    const uniquePosterior = betaPosterior(inserted, fetched, 10);
    const conservativeYield = Math.max(0.05,
        uniquePosterior.mean - (1.64 * uniquePosterior.standardDeviation));
    const averageUnique = inserted / activeDays;
    const targetUnique = Math.max(40, Math.ceil(averageUnique * 1.35));
    const fetchPerDay = Math.round(clamp(Math.ceil(targetUnique / conservativeYield), 100, 2000));
    const processPerDay = Math.round(clamp(Math.ceil(targetUnique * 1.15), 40, 250));
    return {
        fetchPerDay,
        processPerDay,
        targetUnique,
        observedYield: Number((observedYield * 100).toFixed(1)),
        conservativeYield: Number((conservativeYield * 100).toFixed(1)),
        activeDays,
        basis: fetched ? "RECENT_SOURCE_YIELD" : "COLD_START_PRIOR",
        scopeNote: "Estimate covers enabled sources and selected career profiles; no crawler can guarantee every public vacancy."
    };
}

export function ingestionDashboardMetrics(db = getDb(), { days = 30 } = {}) {
    const boundedDays = Math.max(1, Math.min(365, Number(days) || 30));
    const sources = db.prepare(`SELECT source,
        SUM(fetched_count) AS fetched, SUM(inserted_count) AS inserted,
        SUM(selected_count) AS selected, SUM(matched_count) AS matched,
        SUM(close_count) AS closeMatches, SUM(failed) AS failures,
        SUM(quota_count) AS allocated, AVG(allocation_weight) AS averageWeight,
        AVG(quality_score) AS averageQuality,
        MAX(newest_posted_at) AS newestPostedAt
        FROM ingestion_source_runs WHERE created_at >= datetime('now', '-' || ? || ' days')
        GROUP BY source ORDER BY source`).all(boundedDays).map((row) => ({
            ...row,
            fetched: Number(row.fetched || 0), inserted: Number(row.inserted || 0),
            selected: Number(row.selected || 0), matched: Number(row.matched || 0),
            closeMatches: Number(row.closeMatches || 0), failures: Number(row.failures || 0),
            allocated: Number(row.allocated || 0),
            averageWeight: Number((Number(row.averageWeight || 0) * 100).toFixed(1)),
            averageQuality: Number((Number(row.averageQuality || 0) * 100).toFixed(1)),
            uniqueYield: Number(row.fetched ? ((row.inserted / row.fetched) * 100).toFixed(1) : 0),
            compatibleYield: Number(row.selected ? (((row.matched + row.closeMatches) / row.selected) * 100).toFixed(1) : 0)
        }));
    return { days: boundedDays, sources, recommendation: dailyFetchRecommendation(db) };
}

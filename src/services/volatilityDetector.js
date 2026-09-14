import { policyForEvidenceLayer, recencyWeightBps } from "./adaptiveEvidencePolicy.js";

function weighted(events, direction, nowMs, layer) {
    return events.filter((event) => event.direction === direction).reduce((sum, event) =>
        sum + Math.round(event.effectiveWeight * recencyWeightBps(layer, event.occurredAtMs, nowMs) / 10_000), 0);
}

/** Detects a recent regression without erasing long-lived success evidence. */
export function detectEvidenceVolatility(layer, events, { nowMs = Date.now() } = {}) {
    const policy = policyForEvidenceLayer(layer);
    const recent = events.filter((event) => nowMs - event.occurredAtMs <= policy.regressionWindowMs);
    const historical = events.filter((event) => nowMs - event.occurredAtMs > policy.regressionWindowMs);
    const recentNegativeEvents = recent.filter((event) => event.direction === "NEGATIVE" && event.effectiveWeight > 0);
    const recentNegative = weighted(recent, "NEGATIVE", nowMs, layer);
    const recentPositive = weighted(recent, "POSITIVE", nowMs, layer);
    const historicalPositiveFingerprints = new Set(historical
        .filter((event) => event.direction === "POSITIVE" && event.formFingerprint)
        .map((event) => event.formFingerprint));
    const negativeFingerprints = new Set(recentNegativeEvents.map((event) => event.formFingerprint).filter(Boolean));
    const fingerprintShift = negativeFingerprints.size > 0
        && [...negativeFingerprints].some((fingerprint) => !historicalPositiveFingerprints.has(fingerprint));
    const independentRuns = new Set(recentNegativeEvents.map((event) => event.runId)).size;
    const clusteredFailures = recentNegativeEvents.length >= 2 && independentRuns >= 2
        && recentNegative >= policy.degradeThreshold;
    const volatile = clusteredFailures && (fingerprintShift || recentNegative > recentPositive);
    const reasonCodes = [];
    if (clusteredFailures) reasonCodes.push("RECENT_FAILURE_CLUSTER");
    if (fingerprintShift) reasonCodes.push("FORM_FINGERPRINT_SHIFT");
    if (recentNegative > recentPositive) reasonCodes.push("RECENT_NEGATIVE_EVIDENCE_DOMINATES");
    return { volatile, fingerprintShift, clusteredFailures, recentNegative, recentPositive,
        recentNegativeRuns: independentRuns, reasonCodes };
}

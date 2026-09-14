export const ADAPTIVE_EVIDENCE_POLICY_VERSION = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

const COMMON = Object.freeze({
    recentWindowMs: 30 * DAY_MS,
    regressionWindowMs: 7 * DAY_MS,
    maxNegativeRatioBps: 1500,
    minimumIndependentCandidates: 2,
    minimumIndependentRuns: 3,
    stablePrivateThreshold: 2500
});

export const ADAPTIVE_EVIDENCE_POLICIES = Object.freeze({
    SEMANTIC_MAPPING: Object.freeze({ ...COMMON, positiveBase: 1000, negativeBase: 2000,
        promoteThreshold: 8000, degradeThreshold: 2400, quarantineThreshold: 5000 }),
    CANDIDATE_ANSWER: Object.freeze({ ...COMMON, positiveBase: 1000, negativeBase: 2200,
        promoteThreshold: Number.MAX_SAFE_INTEGER, degradeThreshold: 2800, quarantineThreshold: 5600,
        minimumIndependentCandidates: 1 }),
    REPRESENTATION: Object.freeze({ ...COMMON, positiveBase: 800, negativeBase: 1800,
        promoteThreshold: 7000, degradeThreshold: 2000, quarantineThreshold: 4200 }),
    INTERACTION_STRATEGY: Object.freeze({ ...COMMON, positiveBase: 700, negativeBase: 2200,
        promoteThreshold: 7000, degradeThreshold: 1800, quarantineThreshold: 4000,
        maxNegativeRatioBps: 1200 }),
    ACCEPTANCE: Object.freeze({ ...COMMON, positiveBase: 300, negativeBase: 600,
        promoteThreshold: Number.MAX_SAFE_INTEGER, degradeThreshold: Number.MAX_SAFE_INTEGER,
        quarantineThreshold: Number.MAX_SAFE_INTEGER, minimumIndependentCandidates: 1 }),
    FORM_SCHEMA: Object.freeze({ ...COMMON, positiveBase: 700, negativeBase: 1500,
        promoteThreshold: 6000, degradeThreshold: 2000, quarantineThreshold: 4500 }),
    ENTITY_BINDING: Object.freeze({ ...COMMON, positiveBase: 600, negativeBase: 2200,
        promoteThreshold: Number.MAX_SAFE_INTEGER, degradeThreshold: 1800, quarantineThreshold: 3800,
        minimumIndependentCandidates: 1 })
});

export function policyForEvidenceLayer(layer) {
    const policy = ADAPTIVE_EVIDENCE_POLICIES[layer];
    if (!policy) throw new Error(`Unknown adaptive-evidence layer: ${layer}.`);
    return policy;
}

function multiplyBasisPoints(value, factor) {
    return Number((BigInt(value) * BigInt(factor) + 5000n) / 10_000n);
}

/** Deterministic integer-only effective weight calculation. */
export function effectiveEvidenceWeight(update) {
    if (update.direction === "UNKNOWN") return { effectiveWeight: 0, sampleWeightBps: 0 };
    const factors = [
        update.context.sourceReliabilityBps,
        update.context.checkpointStrengthBps,
        update.context.attributionConfidenceBps,
        update.context.sampleQualityBps,
        update.context.recencyBps,
        update.context.scopeSimilarityBps,
        update.context.completionStrengthBps,
        update.context.riskMultiplierBps,
        update.context.extensionTrustBps
    ];
    const effectiveWeight = factors.reduce(multiplyBasisPoints, update.context.baseWeight);
    const evidenceQuality = factors
        .filter((_, index) => index !== 7)
        .reduce(multiplyBasisPoints, 10_000);
    return { effectiveWeight: Math.max(0, effectiveWeight), sampleWeightBps: Math.max(0, Math.min(10_000, evidenceQuality)) };
}

/** Bucketed decay is reproducible and does not rewrite lifetime evidence. */
export function recencyWeightBps(layer, occurredAtMs, nowMs) {
    policyForEvidenceLayer(layer);
    const age = Math.max(0, Number(nowMs) - Number(occurredAtMs));
    if (age <= 7 * DAY_MS) return 10_000;
    if (age <= 30 * DAY_MS) return 7000;
    if (age <= 90 * DAY_MS) return 4000;
    return 2000;
}

export function checkpointStrengthBps(type, status) {
    if (status === "ABANDONED" || status === "UNKNOWN") return 0;
    if (status === "REJECTED") return 9000;
    return ({ NONE: 0, LOCAL_VALIDITY: 2500, PAGE_ADVANCE: 3500, REVIEW: 5500,
        SUBMISSION: 10_000, EXPLICIT_SAVE: 9500 })[type] ?? 0;
}

export function completionStrengthBps(type, status) {
    if (status !== "VERIFIED") return status === "REJECTED" ? 8000 : 0;
    return ({ NONE: 0, LOCAL_VALIDITY: 3000, PAGE_ADVANCE: 4000, REVIEW: 6000,
        SUBMISSION: 10_000, EXPLICIT_SAVE: 9500 })[type] ?? 0;
}

export function evidenceBaseWeight(layer, direction) {
    if (direction === "UNKNOWN") return 0;
    const policy = policyForEvidenceLayer(layer);
    return direction === "POSITIVE" ? policy.positiveBase : policy.negativeBase;
}

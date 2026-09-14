import { policyForEvidenceLayer } from "./adaptiveEvidencePolicy.js";

function negativeRatioBps(rollup) {
    const total = rollup.lifetimePositive + rollup.lifetimeNegative;
    return total ? Math.round(rollup.lifetimeNegative * 10_000 / total) : 0;
}

/** Produces recommendations only. Callers must never mutate live selection. */
export function recommendShadowEvidenceState(rollup, volatility) {
    const policy = policyForEvidenceLayer(rollup.layer);
    const reasons = [];
    if (volatility.volatile) {
        return { state: "SHADOW_VOLATILE", reasonCodes: [...volatility.reasonCodes, "ADMIN_REVIEW_REQUIRED"] };
    }
    if (rollup.recentNegative >= policy.quarantineThreshold && rollup.independentRunCount >= 2) {
        return { state: "SHADOW_QUARANTINE_RECOMMENDED", reasonCodes: ["NEGATIVE_THRESHOLD_EXCEEDED", "ADMIN_REVIEW_REQUIRED"] };
    }
    if (rollup.recentNegative >= policy.degradeThreshold) {
        return { state: "SHADOW_DEGRADE_RECOMMENDED", reasonCodes: ["RECENT_NEGATIVE_THRESHOLD_EXCEEDED", "ADMIN_REVIEW_REQUIRED"] };
    }
    if (rollup.layer === "ACCEPTANCE") {
        return { state: "SHADOW_OBSERVING", reasonCodes: ["ACCEPTANCE_IS_DIAGNOSTIC_ONLY"] };
    }
    if (["CANDIDATE_ANSWER", "ENTITY_BINDING"].includes(rollup.layer)
        && rollup.lifetimePositive >= policy.stablePrivateThreshold
        && negativeRatioBps(rollup) <= policy.maxNegativeRatioBps) {
        return { state: "SHADOW_STABLE_PRIVATE", reasonCodes: ["PRIVATE_EVIDENCE_STABLE", "NO_AUTOMATIC_PROMOTION"] };
    }
    if (rollup.layer === "INTERACTION_STRATEGY" && rollup.executionContext === "RESCUE"
        && rollup.lifetimePositive >= policy.stablePrivateThreshold) {
        return { state: "SHADOW_RESCUE_PROVEN", reasonCodes: ["RESCUE_POPULATION_SEPARATE", "REQUIRES_PROVISIONAL_DIRECT_TEST"] };
    }
    if (rollup.lifetimePositive >= policy.promoteThreshold
        && negativeRatioBps(rollup) <= policy.maxNegativeRatioBps
        && rollup.independentRunCount >= policy.minimumIndependentRuns) {
        if (rollup.aggregationScope === "SHARED_REDACTED"
            && rollup.independentCandidateCount < policy.minimumIndependentCandidates) {
            return { state: "SHADOW_OBSERVING", reasonCodes: ["INDEPENDENT_CANDIDATES_BELOW_THRESHOLD"] };
        }
        if (rollup.layer === "INTERACTION_STRATEGY" && rollup.executionContext !== "DIRECT") {
            return { state: "SHADOW_OBSERVING", reasonCodes: ["DIRECT_EVIDENCE_REQUIRED_FOR_PROMOTION"] };
        }
        return { state: "SHADOW_PROMOTION_RECOMMENDED", reasonCodes: ["POSITIVE_THRESHOLD_MET", "ADMIN_APPROVAL_REQUIRED"] };
    }
    if (rollup.lifetimeUnknownCount > rollup.eventCount / 2) reasons.push("UNKNOWN_EVIDENCE_DOMINATES");
    if (rollup.independentRunCount < policy.minimumIndependentRuns) reasons.push("MORE_INDEPENDENT_RUNS_REQUIRED");
    if (!reasons.length) reasons.push("MORE_EVIDENCE_REQUIRED");
    return { state: "SHADOW_OBSERVING", reasonCodes: reasons };
}

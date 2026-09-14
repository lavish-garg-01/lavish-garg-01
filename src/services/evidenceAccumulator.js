import { evidenceUpdateSchema } from "../contracts/evidenceUpdate.js";
import { LOCAL_USER_ID } from "../repositories/copilotRepository.js";
import {
    activeEvidenceForRollup,
    evidenceRollupKey,
    getShadowRollup,
    insertShadowEvidence,
    saveShadowRollup
} from "../repositories/evidenceRollupRepository.js";
import {
    ADAPTIVE_EVIDENCE_POLICY_VERSION,
    effectiveEvidenceWeight,
    policyForEvidenceLayer,
    recencyWeightBps
} from "./adaptiveEvidencePolicy.js";
import { recommendShadowEvidenceState } from "./promotionPolicy.js";
import { detectEvidenceVolatility } from "./volatilityDetector.js";

function sumDirection(events, direction) {
    return events.filter((event) => event.direction === direction).reduce((sum, event) => sum + event.effectiveWeight, 0);
}

function buildStatistics(layer, events, nowMs) {
    const policy = policyForEvidenceLayer(layer);
    const recent = events.filter((event) => nowMs - event.occurredAtMs <= policy.recentWindowMs);
    const decayed = (event) => Math.round(event.effectiveWeight * recencyWeightBps(layer, event.occurredAtMs, nowMs) / 10_000);
    return {
        eventCount: events.length,
        lifetimePositive: sumDirection(events, "POSITIVE"),
        lifetimeNegative: sumDirection(events, "NEGATIVE"),
        lifetimeUnknownCount: events.filter((event) => event.direction === "UNKNOWN").length,
        recentPositive: recent.filter((event) => event.direction === "POSITIVE").reduce((sum, event) => sum + decayed(event), 0),
        recentNegative: recent.filter((event) => event.direction === "NEGATIVE").reduce((sum, event) => sum + decayed(event), 0),
        recentUnknownCount: recent.filter((event) => event.direction === "UNKNOWN").length,
        effectiveSampleSizeBps: events.reduce((sum, event) => sum + event.sampleWeightBps, 0),
        independentCandidateCount: new Set(events.map((event) => event.candidateId)).size,
        independentRunCount: new Set(events.map((event) => event.runId)).size,
        independentFormCount: new Set(events.map((event) => event.formFingerprint).filter(Boolean)).size,
        firstEvidenceAtMs: events.length ? Math.min(...events.map((event) => event.occurredAtMs)) : null,
        lastEvidenceAtMs: events.length ? Math.max(...events.map((event) => event.occurredAtMs)) : null
    };
}

/** Inserts immutable evidence, then deterministically rebuilds its SHADOW rollup. */
export function accumulateShadowEvidence(updateInput, { candidateId = LOCAL_USER_ID, nowMs = Date.now() } = {}) {
    if (candidateId !== LOCAL_USER_ID) throw new Error("Cross-candidate adaptive evidence is disabled in the local runtime.");
    const update = evidenceUpdateSchema.parse(updateInput);
    const weighted = effectiveEvidenceWeight(update);
    const recorded = insertShadowEvidence(candidateId, update, weighted, ADAPTIVE_EVIDENCE_POLICY_VERSION);
    if (!recorded) {
        const existing = getShadowRollup(evidenceRollupKey(candidateId, update));
        let existingDecision = {};
        try { existingDecision = JSON.parse(existing?.decision_json || "{}"); } catch { existingDecision = {}; }
        return { mode: "SHADOW", recorded: false, productionMutationEnabled: false,
            effectiveWeight: weighted.effectiveWeight, sampleWeightBps: weighted.sampleWeightBps,
            state: existing?.state || "SHADOW_OBSERVING", reasonCodes: existingDecision.reasonCodes || [],
            rollupKey: existing?.rollup_key || evidenceRollupKey(candidateId, update), volatility: null };
    }
    const events = activeEvidenceForRollup(candidateId, update);
    const statistics = buildStatistics(update.layer, events, nowMs);
    const volatility = detectEvidenceVolatility(update.layer, events, { nowMs });
    const decision = recommendShadowEvidenceState({
        ...statistics,
        layer: update.layer,
        aggregationScope: update.aggregationScope,
        executionContext: update.executionContext
    }, volatility);
    const rollup = saveShadowRollup(candidateId, update, statistics, decision, volatility, ADAPTIVE_EVIDENCE_POLICY_VERSION);
    return { mode: "SHADOW", recorded, productionMutationEnabled: false, effectiveWeight: weighted.effectiveWeight,
        sampleWeightBps: weighted.sampleWeightBps, state: decision.state, reasonCodes: decision.reasonCodes,
        rollupKey: rollup.rollup_key, volatility };
}

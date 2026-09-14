import crypto from "node:crypto";
import { canonicalContractJson, stableContractHash } from "../contracts/contractPrimitives.js";
import { getDb } from "../database/connection.js";

export const SHARED_EVIDENCE_OWNER = "__shared_redacted__";

export function evidenceRollupOwner(candidateId, aggregationScope) {
    return aggregationScope === "SHARED_REDACTED" ? SHARED_EVIDENCE_OWNER : candidateId;
}

export function evidenceRollupKey(candidateId, update) {
    return stableContractHash({
        ownerId: evidenceRollupOwner(candidateId, update.aggregationScope),
        aggregationScope: update.aggregationScope,
        layer: update.layer,
        subjectKeyHash: update.subjectKeyHash,
        scopeType: update.scopeType,
        scopeKeyHash: update.scopeKeyHash || "",
        executionContext: update.executionContext
    });
}

export function insertShadowEvidence(candidateId, update, weighted, policyVersion) {
    const result = getDb().prepare(`INSERT OR IGNORE INTO adaptive_evidence_shadow_events
        (evidence_id, candidate_id, observation_id, classification_hash, run_id, application_id,
         layer, subject_type, subject_key, subject_key_hash, aggregation_scope, scope_type,
         scope_key_hash, direction, source, execution_context, checkpoint_type, effective_weight,
         sample_weight_bps, checkpoint_strength_bps, form_fingerprint, extension_version,
         adapter_version, occurred_at_ms, policy_version, contract_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(update.evidenceId, candidateId, update.observationId, update.classificationHash,
            update.runId, update.applicationId, update.layer, update.subjectType, update.subjectKey,
            update.subjectKeyHash, update.aggregationScope, update.scopeType, update.scopeKeyHash || "",
            update.direction, update.source, update.executionContext, update.checkpointType,
            weighted.effectiveWeight, weighted.sampleWeightBps, update.context.checkpointStrengthBps,
            update.formFingerprint, update.extensionVersion, update.adapterVersion, update.occurredAtMs,
            policyVersion, canonicalContractJson(update));
    return result.changes === 1;
}

export function activeEvidenceForRollup(candidateId, update) {
    const params = [update.layer, update.subjectKeyHash, update.scopeType, update.scopeKeyHash || "", update.executionContext];
    const candidateWhere = update.aggregationScope === "CANDIDATE_PRIVATE" ? "AND candidate_id = ?" : "";
    if (candidateWhere) params.push(candidateId);
    const rows = getDb().prepare(`SELECT * FROM adaptive_evidence_shadow_events
        WHERE layer = ? AND subject_key_hash = ? AND scope_type = ? AND scope_key_hash = ?
          AND execution_context = ? ${candidateWhere}
        ORDER BY checkpoint_strength_bps DESC, occurred_at_ms DESC, created_at DESC`).all(...params);
    const selected = new Map();
    for (const row of rows) {
        const identity = `${row.candidate_id}:${row.observation_id}:${row.layer}`;
        if (!selected.has(identity)) selected.set(identity, row);
    }
    return [...selected.values()].map((row) => ({
        candidateId: row.candidate_id,
        observationId: row.observation_id,
        runId: row.run_id,
        direction: row.direction,
        effectiveWeight: row.effective_weight,
        sampleWeightBps: row.sample_weight_bps,
        occurredAtMs: row.occurred_at_ms,
        formFingerprint: row.form_fingerprint,
        checkpointStrengthBps: row.checkpoint_strength_bps
    }));
}

export function getShadowRollup(rollupKey) {
    return getDb().prepare("SELECT * FROM adaptive_evidence_shadow_rollups WHERE rollup_key = ?").get(rollupKey) || null;
}

export function saveShadowRollup(candidateId, update, statistics, decision, volatility, policyVersion) {
    const rollupKey = evidenceRollupKey(candidateId, update);
    const previous = getShadowRollup(rollupKey);
    const volatilityEpoch = Number(previous?.volatility_epoch || 0) + (volatility.volatile && !previous?.volatile ? 1 : 0);
    const decisionPayload = {
        mode: "SHADOW",
        state: decision.state,
        reasonCodes: decision.reasonCodes,
        volatility,
        policyVersion,
        inputs: statistics
    };
    const decisionHash = stableContractHash(decisionPayload);
    getDb().prepare(`INSERT INTO adaptive_evidence_shadow_rollups
        (rollup_key, owner_id, aggregation_scope, layer, subject_type, subject_key, subject_key_hash,
         scope_type, scope_key_hash, execution_context, lifetime_positive, lifetime_negative,
         lifetime_unknown_count, recent_positive, recent_negative, recent_unknown_count,
         effective_sample_size_bps, independent_candidate_count, independent_run_count,
         independent_form_count, state, volatile, volatility_epoch, policy_version, decision_hash,
         decision_json, version, first_evidence_at_ms, last_evidence_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(rollup_key) DO UPDATE SET
            lifetime_positive = excluded.lifetime_positive,
            lifetime_negative = excluded.lifetime_negative,
            lifetime_unknown_count = excluded.lifetime_unknown_count,
            recent_positive = excluded.recent_positive,
            recent_negative = excluded.recent_negative,
            recent_unknown_count = excluded.recent_unknown_count,
            effective_sample_size_bps = excluded.effective_sample_size_bps,
            independent_candidate_count = excluded.independent_candidate_count,
            independent_run_count = excluded.independent_run_count,
            independent_form_count = excluded.independent_form_count,
            state = excluded.state,
            volatile = excluded.volatile,
            volatility_epoch = excluded.volatility_epoch,
            policy_version = excluded.policy_version,
            decision_hash = excluded.decision_hash,
            decision_json = excluded.decision_json,
            version = adaptive_evidence_shadow_rollups.version + 1,
            first_evidence_at_ms = excluded.first_evidence_at_ms,
            last_evidence_at_ms = excluded.last_evidence_at_ms,
            updated_at = CURRENT_TIMESTAMP`)
        .run(rollupKey, evidenceRollupOwner(candidateId, update.aggregationScope), update.aggregationScope,
            update.layer, update.subjectType, update.subjectKey, update.subjectKeyHash, update.scopeType,
            update.scopeKeyHash || "", update.executionContext, statistics.lifetimePositive,
            statistics.lifetimeNegative, statistics.lifetimeUnknownCount, statistics.recentPositive,
            statistics.recentNegative, statistics.recentUnknownCount, statistics.effectiveSampleSizeBps,
            statistics.independentCandidateCount, statistics.independentRunCount,
            statistics.independentFormCount, decision.state, volatility.volatile ? 1 : 0,
            volatilityEpoch, policyVersion, decisionHash, canonicalContractJson(decisionPayload),
            statistics.firstEvidenceAtMs, statistics.lastEvidenceAtMs);
    const recommendationId = crypto.createHash("sha256").update(`${rollupKey}:${decisionHash}`).digest("hex");
    getDb().prepare(`INSERT OR IGNORE INTO adaptive_evidence_shadow_recommendations
        (id, rollup_key, state, decision_hash, reason_codes_json, inputs_hash)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(recommendationId, rollupKey, decision.state, decisionHash,
            canonicalContractJson(decision.reasonCodes), stableContractHash(statistics));
    return { ...getShadowRollup(rollupKey), decision: decisionPayload };
}

export function listAdaptiveEvidenceDiagnostics({ limit = 100 } = {}) {
    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const rollups = getDb().prepare(`SELECT * FROM adaptive_evidence_shadow_rollups
        ORDER BY volatile DESC,
          CASE state WHEN 'SHADOW_QUARANTINE_RECOMMENDED' THEN 1 WHEN 'SHADOW_DEGRADE_RECOMMENDED' THEN 2
            WHEN 'SHADOW_PROMOTION_RECOMMENDED' THEN 3 ELSE 4 END,
          updated_at DESC LIMIT ?`).all(boundedLimit).map((row) => ({
        ...row,
        volatile: Boolean(row.volatile),
        decision: JSON.parse(row.decision_json || "{}"),
        decision_json: undefined
    }));
    const counts = getDb().prepare(`SELECT state, COUNT(*) AS count FROM adaptive_evidence_shadow_rollups
        GROUP BY state ORDER BY state`).all();
    const totals = getDb().prepare(`SELECT COUNT(*) AS events,
        COUNT(DISTINCT candidate_id) AS candidates, COUNT(DISTINCT run_id) AS runs
        FROM adaptive_evidence_shadow_events`).get();
    return { mode: "SHADOW", productionMutationEnabled: false, counts, totals, rollups };
}

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validSharedContractFixtures } from "./fixtures/shared-contract-fixtures.js";

const NOW = 1_788_070_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const TEST_DIRECTORY = fs.mkdtempSync(path.join(os.tmpdir(), "job-adaptive-evidence-"));
process.env.DATABASE_PATH = path.join(TEST_DIRECTORY, "test.db");

function update(overrides = {}) {
    const sequence = overrides.sequence || 1;
    const layer = overrides.layer || "INTERACTION_STRATEGY";
    const subjectType = ({ CANDIDATE_ANSWER: "CANONICAL_ANSWER", SEMANTIC_MAPPING: "CANONICAL_MAPPING",
        REPRESENTATION: "REPRESENTATION_RULE", INTERACTION_STRATEGY: "INTERACTION_STRATEGY",
        ACCEPTANCE: "FIELD_ACCEPTANCE" })[layer] || "FORM_SCHEMA";
    const aggregationScope = ["CANDIDATE_ANSWER", "ACCEPTANCE", "ENTITY_BINDING"].includes(layer)
        ? "CANDIDATE_PRIVATE" : "SHARED_REDACTED";
    const result = {
        ...structuredClone(validSharedContractFixtures.EvidenceUpdate),
        evidenceId: hash(`evidence-${sequence}-${layer}-${overrides.direction || "POSITIVE"}`),
        observationId: `observation_${sequence}`,
        classificationHash: hash(`classification-${sequence}`),
        runId: `run_${sequence}`,
        applicationId: `application_${sequence}`,
        layer,
        subjectType,
        subjectKey: overrides.subjectKey || (layer === "CANDIDATE_ANSWER" ? "CURRENT_CITY" : "strategy_01"),
        subjectKeyHash: hash(overrides.subjectKey || (layer === "CANDIDATE_ANSWER" ? "CURRENT_CITY" : "strategy_01")),
        aggregationScope,
        scopeType: aggregationScope === "CANDIDATE_PRIVATE" ? "CANDIDATE" : "FIELD_FINGERPRINT",
        scopeKeyHash: hash(aggregationScope === "CANDIDATE_PRIVATE" ? "candidate" : "field"),
        direction: overrides.direction || "POSITIVE",
        executionContext: layer === "INTERACTION_STRATEGY" ? (overrides.executionContext || "DIRECT") : "NOT_APPLICABLE",
        checkpointType: "SUBMISSION",
        context: {
            baseWeight: overrides.baseWeight ?? (overrides.direction === "NEGATIVE" ? 2200 : 1000),
            sourceReliabilityBps: 10_000,
            checkpointStrengthBps: 10_000,
            attributionConfidenceBps: 10_000,
            sampleQualityBps: 10_000,
            recencyBps: 10_000,
            scopeSimilarityBps: 10_000,
            completionStrengthBps: 10_000,
            riskMultiplierBps: overrides.riskMultiplierBps ?? 10_000,
            extensionTrustBps: 10_000
        },
        formFingerprint: overrides.formFingerprint || hash("form-a"),
        occurredAtMs: overrides.occurredAtMs ?? NOW,
        reasonCodes: overrides.reasonCodes || ["TEST_EVIDENCE"],
        ...overrides
    };
    delete result.sequence;
    delete result.baseWeight;
    delete result.riskMultiplierBps;
    return result;
}

test("adaptive weighting is deterministic, integer-only, and unknown evidence has zero weight", async () => {
    const { effectiveEvidenceWeight } = await import("../src/services/adaptiveEvidencePolicy.js");
    const evidence = update({ sequence: 1, baseWeight: 1000 });
    assert.deepEqual(effectiveEvidenceWeight(evidence), { effectiveWeight: 1000, sampleWeightBps: 10000 });
    const unknown = update({ sequence: 2, direction: "UNKNOWN", baseWeight: 0 });
    assert.deepEqual(effectiveEvidenceWeight(unknown), { effectiveWeight: 0, sampleWeightBps: 0 });
    const weighted = update({ sequence: 3, baseWeight: 1000, context: {
        ...evidence.context, sourceReliabilityBps: 9000, checkpointStrengthBps: 5000,
        attributionConfidenceBps: 8000, riskMultiplierBps: 12000
    } });
    assert.deepEqual(effectiveEvidenceWeight(weighted), { effectiveWeight: 432, sampleWeightBps: 3600 });
    const wrongScope = update({ sequence: 4, baseWeight: 1000, context: {
        ...evidence.context, scopeSimilarityBps: 0
    } });
    assert.deepEqual(effectiveEvidenceWeight(wrongScope), { effectiveWeight: 0, sampleWeightBps: 0 });
});

test("the evidence router keeps semantic, answer, representation, strategy, and acceptance attribution separate", async () => {
    const { buildFieldInteractionObservation } = await import("../src/contracts/fieldInteractionObservation.js");
    const { classifyFieldInteraction } = await import("../src/services/fieldLearningClassifier.js");
    const { buildEvidenceUpdates } = await import("../src/services/evidenceRouter.js");
    const observation = buildFieldInteractionObservation({
        id: "authorization",
        semanticKey: "WORK_AUTHORIZATION_INDIA",
        fillOutcome: "USER_CORRECTED",
        source: "USER_MANUAL_INPUT",
        intendedValue: "Yes",
        value: "No",
        normalizedEquivalent: false,
        completedByUser: true,
        strategyId: "RADIO_BY_LABEL_V1",
        strategyAttempted: true,
        readback: "MATCH",
        cleanup: "CLEAN"
    }, {
        applicationId: "application_01",
        attemptId: "run_01",
        checkpoint: { type: "SUBMISSION", status: "VERIFIED" },
        clientTimeMs: NOW
    });
    const updates = buildEvidenceUpdates(observation, classifyFieldInteraction(observation));
    const byLayer = Object.fromEntries(updates.map((item) => [item.layer, item]));
    assert.equal(byLayer.SEMANTIC_MAPPING.direction, "UNKNOWN");
    assert.equal(byLayer.CANDIDATE_ANSWER.direction, "NEGATIVE");
    assert.equal(byLayer.REPRESENTATION.direction, "UNKNOWN");
    assert.equal(byLayer.INTERACTION_STRATEGY.direction, "POSITIVE");
    assert.equal(byLayer.ACCEPTANCE.direction, "POSITIVE");
    assert.equal(byLayer.CANDIDATE_ANSWER.aggregationScope, "CANDIDATE_PRIVATE");
    assert.equal(byLayer.INTERACTION_STRATEGY.aggregationScope, "SHARED_REDACTED");
});

test("SHADOW rollups retain lifetime success, detect recent regressions, and stay idempotent", async () => {
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { accumulateShadowEvidence } = await import("../src/services/evidenceAccumulator.js");
    const { listAdaptiveEvidenceDiagnostics } = await import("../src/repositories/evidenceRollupRepository.js");
    const { getFeatureFlag } = await import("../src/repositories/featureFlagRepository.js");
    const { ensureApplicationAttempt } = await import("../src/repositories/learningRepository.js");
    const { buildFieldInteractionObservation } = await import("../src/contracts/fieldInteractionObservation.js");
    const { classifyFieldInteraction } = await import("../src/services/fieldLearningClassifier.js");
    const { classifyAttemptAtCheckpoint, recordNeutralObservation } = await import("../src/services/fieldRevisionService.js");
    try {
        assert.equal(getFeatureFlag("adaptive_evidence.shadow", false).enabled, false);
        for (let index = 1; index <= 10; index += 1) {
            accumulateShadowEvidence(update({ sequence: index, baseWeight: 1000,
                occurredAtMs: NOW - 20 * DAY_MS, formFingerprint: hash("form-a") }), { nowMs: NOW });
        }
        let report = listAdaptiveEvidenceDiagnostics();
        assert.equal(report.rollups.length, 1);
        assert.equal(report.rollups[0].lifetime_positive, 10_000);
        assert.equal(report.rollups[0].recent_positive, 7000);
        assert.equal(report.rollups[0].state, "SHADOW_OBSERVING");
        assert.ok(report.rollups[0].decision.reasonCodes.includes("INDEPENDENT_CANDIDATES_BELOW_THRESHOLD"));

        const firstFailure = update({ sequence: 20, direction: "NEGATIVE", baseWeight: 2200,
            riskMultiplierBps: 14_000, occurredAtMs: NOW - DAY_MS, formFingerprint: hash("form-b") });
        accumulateShadowEvidence(firstFailure, { nowMs: NOW });
        accumulateShadowEvidence(update({ sequence: 21, direction: "NEGATIVE", baseWeight: 2200,
            riskMultiplierBps: 14_000, occurredAtMs: NOW, formFingerprint: hash("form-b") }), { nowMs: NOW });
        report = listAdaptiveEvidenceDiagnostics();
        const volatile = report.rollups[0];
        assert.equal(volatile.volatile, true);
        assert.equal(volatile.state, "SHADOW_VOLATILE");
        assert.equal(volatile.volatility_epoch, 1);
        assert.equal(volatile.lifetime_positive, 10_000);
        assert.ok(volatile.decision.reasonCodes.includes("FORM_FINGERPRINT_SHIFT"));

        const versionBeforeRetry = volatile.version;
        const duplicate = accumulateShadowEvidence(firstFailure, { nowMs: NOW });
        assert.equal(duplicate.recorded, false);
        assert.equal(listAdaptiveEvidenceDiagnostics().rollups[0].version, versionBeforeRetry);
        assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM adaptive_evidence_shadow_events").get().count, 12);

        const db = getDb();
        db.prepare("INSERT INTO candidate_profiles (user_id, name, email) VALUES ('local-user', 'Candidate', 'candidate@example.com')").run();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES ('job-adaptive', 'Engineer', '', 'https://example.com/job', 'test')").run();
        db.prepare("INSERT INTO applications (id, job_id, user_id, adapter) VALUES ('app-adaptive', 'job-adaptive', 'local-user', 'EXTENSION')").run();
        const attempt = ensureApplicationAttempt("app-adaptive", "https://example.com/apply");
        const observation = buildFieldInteractionObservation({
            id: "current-city", semanticKey: "CURRENT_CITY", fillOutcome: "USER_CORRECTED",
            source: "USER_MANUAL_INPUT", intendedValue: "Old", value: "New", normalizedEquivalent: false,
            completedByUser: true, strategyId: "TEXT_INPUT_V1", strategyAttempted: true,
            readback: "MATCH", cleanup: "CLEAN"
        }, { applicationId: "app-adaptive", attemptId: attempt.id,
            checkpoint: { type: "NONE", status: "NOT_OBSERVED" }, clientTimeMs: NOW });
        recordNeutralObservation("app-adaptive", observation, classifyFieldInteraction(observation), { adaptiveEvidenceShadow: true });
        const checkpointReplay = classifyAttemptAtCheckpoint("app-adaptive", {
            schemaVersion: 1, checkpointId: "checkpoint-adaptive", runId: attempt.id,
            applicationId: "app-adaptive", applicationContentRevisionId: null, type: "SUBMISSION",
            status: "VERIFIED", source: "EMPLOYER_RECEIPT", observedAtMs: NOW + 1000,
            evidenceHash: hash("checkpoint"), valueFree: true
        }, { adaptiveEvidenceShadow: true });
        assert.equal(checkpointReplay.adaptiveEvidence.updates.length, 5);
        const candidateRollup = listAdaptiveEvidenceDiagnostics({ limit: 100 }).rollups
            .find((row) => row.layer === "CANDIDATE_ANSWER" && row.subject_key === "CURRENT_CITY");
        assert.ok(candidateRollup.lifetime_negative > 0);
        assert.equal(candidateRollup.lifetime_unknown_count, 0);
        assert.equal(candidateRollup.decision.inputs.eventCount, 1);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM adaptive_evidence_shadow_events WHERE observation_id = ?")
            .get(observation.observationId).count, 10);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM candidate_answers").get().count, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM semantic_mapping_evidence").get().count, 0);
    } finally {
        closeDb();
        fs.rmSync(TEST_DIRECTORY, { recursive: true, force: true });
    }
});

test("private candidate evidence can become stable only in SHADOW and never recommends promotion", async () => {
    const { recommendShadowEvidenceState } = await import("../src/services/promotionPolicy.js");
    const privateDecision = recommendShadowEvidenceState({
        layer: "CANDIDATE_ANSWER", aggregationScope: "CANDIDATE_PRIVATE", executionContext: "NOT_APPLICABLE",
        lifetimePositive: 5000, lifetimeNegative: 0, lifetimeUnknownCount: 0, recentNegative: 0,
        independentCandidateCount: 1, independentRunCount: 5, eventCount: 5
    }, { volatile: false, reasonCodes: [] });
    assert.equal(privateDecision.state, "SHADOW_STABLE_PRIVATE");
    assert.ok(privateDecision.reasonCodes.includes("NO_AUTOMATIC_PROMOTION"));

    const sharedDecision = recommendShadowEvidenceState({
        layer: "SEMANTIC_MAPPING", aggregationScope: "SHARED_REDACTED", executionContext: "NOT_APPLICABLE",
        lifetimePositive: 10_000, lifetimeNegative: 0, lifetimeUnknownCount: 0, recentNegative: 0,
        independentCandidateCount: 2, independentRunCount: 5, eventCount: 5
    }, { volatile: false, reasonCodes: [] });
    assert.equal(sharedDecision.state, "SHADOW_PROMOTION_RECOMMENDED");
    assert.ok(sharedDecision.reasonCodes.includes("ADMIN_APPROVAL_REQUIRED"));

    const rescueDecision = recommendShadowEvidenceState({
        layer: "INTERACTION_STRATEGY", aggregationScope: "SHARED_REDACTED", executionContext: "RESCUE",
        lifetimePositive: 8000, lifetimeNegative: 0, lifetimeUnknownCount: 0, recentNegative: 0,
        independentCandidateCount: 3, independentRunCount: 8, eventCount: 8
    }, { volatile: false, reasonCodes: [] });
    assert.equal(rescueDecision.state, "SHADOW_RESCUE_PROVEN");
    assert.ok(rescueDecision.reasonCodes.includes("REQUIRES_PROVISIONAL_DIRECT_TEST"));
});

test("Phase 0F artifacts remain value-free and cannot mutate production learning ledgers", () => {
    const contract = fs.readFileSync("src/contracts/evidenceUpdate.js", "utf8");
    const router = fs.readFileSync("src/services/evidenceRouter.js", "utf8");
    const accumulator = fs.readFileSync("src/services/evidenceAccumulator.js", "utf8");
    const combined = `${contract}\n${router}\n${accumulator}`;
    assert.match(combined, /containsProtectedValue/);
    assert.match(combined, /productionMutationEnabled: false/);
    assert.doesNotMatch(combined, /UPDATE\s+(?:candidate_answers|field_semantic_mappings|mapping_packs|portal_field_patterns)/i);
    assert.doesNotMatch(combined, /INSERT\s+INTO\s+(?:candidate_answers|semantic_mapping_evidence|mapping_packs|portal_field_patterns)/i);
});

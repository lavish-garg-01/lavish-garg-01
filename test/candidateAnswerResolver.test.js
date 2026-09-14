import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function versioned(value = "Asha", riskTier = "LOW") {
    return {
        fieldId: "name",
        canonicalKey: "FULL_NAME",
        status: "READY",
        reasonCodes: ["FIELD_ANSWER_CONTRACT_READY"],
        policy: { policyVersion: 1, riskTier, autofillMode: "AUTO" },
        contract: {
            contractId: "answer_contract:test_name",
            canonicalKey: "FULL_NAME",
            policyVersion: 1,
            candidateAnswerVersionId: null,
            confidence: 1,
            review: "NONE",
            protected: false,
            representation: { ruleKey: "TEXT_IDENTITY", ruleVersion: 1, renderedValue: value }
        }
    };
}

test("Part 2B records value-redacted parity and gates staged answer authority", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-answer-resolver-"));
    process.env.DATABASE_PATH = path.join(directory, "resolver.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const {
        candidateAnswerResolverConfig,
        candidateAnswerResolverDiagnostics,
        candidateAnswerResolverReleaseGates,
        routeCandidateAnswerResolution,
        setCandidateAnswerResolverMode
    } = await import("../src/services/candidateAnswerResolver.js");

    const legacy = {
        normalizedKey: "FULL_NAME", answer: "Asha", confidence: 1,
        source: "PROFILE", evidence: "Candidate profile", requiresUserInput: false
    };
    try {
        assert.equal(candidateAnswerResolverConfig().mode, "SHADOW_COMPARE");
        const first = routeCandidateAnswerResolution({
            userId: "candidate-1", fieldLogicalId: "field-0", canonicalKey: "FULL_NAME",
            controlType: "text", legacyResolution: legacy, versionedResolution: versioned()
        });
        assert.equal(first.productionResolution, legacy, "shadow must preserve the established production object");
        assert.equal(first.routing.productionSource, "LEGACY");
        assert.equal(first.routing.comparisonOutcome, "MATCH");

        routeCandidateAnswerResolution({
            userId: "candidate-1", fieldLogicalId: "field-0", canonicalKey: "FULL_NAME",
            controlType: "text", legacyResolution: legacy, versionedResolution: versioned()
        });
        assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM candidate_answer_resolution_parity_events").get().count, 1,
            "the same page result must create one idempotent receipt");

        for (let index = 1; index < 100; index += 1) {
            routeCandidateAnswerResolution({
                userId: "candidate-1", fieldLogicalId: `field-${index}`, canonicalKey: "FULL_NAME",
                controlType: "text", legacyResolution: legacy, versionedResolution: versioned()
            });
        }
        const shadow = candidateAnswerResolverDiagnostics();
        assert.equal(shadow.runtime.compared, 100);
        assert.equal(shadow.runtime.agreementRate, 1);
        assert.equal(shadow.runtime.valueMismatches, 0);
        assert.equal(shadow.gates.canary.passed, true);

        const canary = setCandidateAnswerResolverMode({ mode: "CANARY", canaryPercent: 10, changedBy: "TEST" });
        assert.equal(canary.config.mode, "CANARY");
        assert.equal(canary.config.canaryPercent, 10);
        assert.equal(canary.productionMutationEnabled, true);

        let selected = null;
        for (let index = 100; index < 250 && !selected; index += 1) {
            const routed = routeCandidateAnswerResolution({
                userId: "candidate-1", fieldLogicalId: `field-${index}`, canonicalKey: "FULL_NAME",
                controlType: "text", legacyResolution: legacy, versionedResolution: versioned()
            });
            if (routed.routing.productionSource === "VERSIONED") selected = routed;
        }
        assert.ok(selected, "the deterministic 10% canary should select at least one low-risk parity match");
        assert.equal(selected.productionResolution.source, "VERSIONED_CANDIDATE_TRUTH");
        assert.equal(selected.productionResolution.answer, "Asha");

        const highRisk = routeCandidateAnswerResolution({
            userId: "candidate-1", fieldLogicalId: "high-risk", canonicalKey: "FULL_NAME",
            controlType: "text", legacyResolution: legacy, versionedResolution: versioned("Asha", "HIGH")
        });
        assert.equal(highRisk.routing.productionSource, "LEGACY");
        assert.ok(highRisk.routing.reasonCodes.includes("ONLY_LOW_RISK_CANARY_ALLOWED"));

        const mismatch = routeCandidateAnswerResolution({
            userId: "candidate-1", fieldLogicalId: "mismatch", canonicalKey: "FULL_NAME",
            controlType: "text", legacyResolution: legacy, versionedResolution: versioned("Ananya")
        });
        assert.equal(mismatch.routing.comparisonOutcome, "VALUE_MISMATCH");
        assert.equal(mismatch.routing.productionSource, "LEGACY");
        assert.equal(mismatch.productionResolution.answer, "Asha");

        assert.throws(() => setCandidateAnswerResolverMode({ mode: "VERSIONED_PRIMARY", changedBy: "TEST" }),
            /VERIFIED_BROWSER_OUTCOME_GATE_NOT_IMPLEMENTED/);
        const explicitGate = candidateAnswerResolverReleaseGates({
            mode: "CANARY", currentMode: "SHADOW_COMPARE",
            diagnostics: { compared: 100, agreementRate: 0.99, valueMismatches: 0, unsafeVersionedSelected: 0 }
        });
        assert.equal(explicitGate.passed, true);

        setCandidateAnswerResolverMode({ mode: "LEGACY_ONLY", changedBy: "TEST" });
        const countBefore = getDb().prepare("SELECT COUNT(*) AS count FROM candidate_answer_resolution_parity_events").get().count;
        const legacyOnly = routeCandidateAnswerResolution({
            userId: "candidate-1", fieldLogicalId: "legacy-only", canonicalKey: "FULL_NAME",
            controlType: "text", legacyResolution: legacy, versionedResolution: versioned()
        });
        assert.equal(legacyOnly.routing.comparisonOutcome, "NOT_COMPARED");
        assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM candidate_answer_resolution_parity_events").get().count, countBefore);

        const audit = JSON.stringify({
            events: getDb().prepare("SELECT * FROM candidate_answer_resolution_parity_events").all(),
            history: getDb().prepare("SELECT * FROM candidate_answer_resolver_mode_history").all()
        });
        assert.doesNotMatch(audit, /Asha|Ananya|Candidate profile/,
            "the runtime parity ledger and mode history must not retain candidate values");
        assert.ok(getDb().prepare("SELECT COUNT(*) AS count FROM candidate_answer_resolver_mode_history").get().count >= 2);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("Part 2B option parity is case-insensitive while free text remains exact", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-answer-option-parity-"));
    process.env.DATABASE_PATH = path.join(directory, "resolver.db");
    const { closeDb } = await import("../src/database/connection.js");
    const { routeCandidateAnswerResolution } = await import("../src/services/candidateAnswerResolver.js");
    try {
        const legacyYes = { answer: "Yes", source: "PROFILE", requiresUserInput: false };
        const option = routeCandidateAnswerResolution({
            userId: "candidate-2", fieldLogicalId: "radio", canonicalKey: "RELOCATION",
            controlType: "radio", legacyResolution: legacyYes, versionedResolution: versioned("yes")
        });
        assert.equal(option.routing.comparisonOutcome, "MATCH");
        const text = routeCandidateAnswerResolution({
            userId: "candidate-2", fieldLogicalId: "text", canonicalKey: "FULL_NAME",
            controlType: "text", legacyResolution: legacyYes, versionedResolution: versioned("yes")
        });
        assert.equal(text.routing.comparisonOutcome, "VALUE_MISMATCH");
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

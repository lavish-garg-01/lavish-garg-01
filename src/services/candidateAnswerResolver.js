import { stableContractHash } from "../contracts/contractPrimitives.js";
import { getDb } from "../database/connection.js";
import { getFeatureFlag, setFeatureFlag } from "../repositories/featureFlagRepository.js";
import {
    candidateAnswerResolutionParityDiagnostics,
    listCandidateAnswerResolverModeHistory,
    recordCandidateAnswerResolutionParity,
    recordCandidateAnswerResolutionParityBatch,
    recordCandidateAnswerResolverModeChange
} from "../repositories/candidateAnswerResolutionParityRepository.js";

export const CANDIDATE_ANSWER_RESOLVER_FLAG = "candidate-answer-intelligence.resolver-mode";
export const CANDIDATE_ANSWER_RESOLVER_MODES = Object.freeze([
    "LEGACY_ONLY", "SHADOW_COMPARE", "CANARY", "VERSIONED_PRIMARY"
]);

const OPTION_CONTROL_TYPES = new Set(["select-one", "select", "radio", "checkbox", "checkbox-group", "choice-group", "combobox"]);
const SAFE_SHADOW_DEFAULT = Object.freeze({
    mode: "SHADOW_COMPARE",
    canaryPercent: 0,
    gatePassed: false,
    reasonCodes: ["SAFE_SHADOW_DEFAULT"]
});

function cleanReasons(...groups) {
    return [...new Set(groups.flat().filter(Boolean).map((value) => String(value).slice(0, 120)))].slice(0, 16);
}

function normalizedComparable(value, controlType) {
    if (value === undefined || value === null) return null;
    const text = String(value).normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!text) return null;
    return OPTION_CONTROL_TYPES.has(String(controlType || "").toLowerCase()) ? text.toLocaleLowerCase("en") : text;
}

function valueHash(value, controlType) {
    const normalized = normalizedComparable(value, controlType);
    return normalized === null ? null : stableContractHash(normalized);
}

function legacyDecision(resolution) {
    return resolution?.answer !== undefined && resolution?.answer !== null
        && resolution?.requiresUserInput !== true ? "READY" : "NEEDS_USER";
}

function versionedDecision(resolution) {
    return ["READY", "REVIEW_REQUIRED", "NEEDS_USER"].includes(resolution?.status)
        ? resolution.status : "NEEDS_USER";
}

function compareResolutions({ legacyResolution, versionedResolution, controlType, shadowError = false }) {
    const legacy = legacyDecision(legacyResolution);
    const versioned = versionedDecision(versionedResolution);
    const legacyValueHash = legacy === "READY" ? valueHash(legacyResolution.answer, controlType) : null;
    const versionedValueHash = versioned === "READY"
        ? valueHash(versionedResolution?.contract?.representation?.renderedValue, controlType) : null;
    let outcome = "BOTH_NEED_USER";
    if (shadowError) outcome = "SHADOW_ERROR";
    else if (versioned === "REVIEW_REQUIRED") outcome = "REVIEW_POLICY_MISMATCH";
    else if (legacy === "READY" && versioned === "READY") {
        outcome = legacyValueHash === versionedValueHash ? "MATCH" : "VALUE_MISMATCH";
    } else if (legacy === "READY") outcome = "LEGACY_ONLY";
    else if (versioned === "READY") outcome = "VERSIONED_ONLY";
    return { legacy, versioned, outcome, legacyValueHash, versionedValueHash };
}

function modePayload(flag = getFeatureFlag(CANDIDATE_ANSWER_RESOLVER_FLAG, true)) {
    const requested = String(flag.payload?.mode || SAFE_SHADOW_DEFAULT.mode).toUpperCase();
    const mode = flag.enabled !== false && CANDIDATE_ANSWER_RESOLVER_MODES.includes(requested)
        ? requested : "LEGACY_ONLY";
    return {
        mode,
        canaryPercent: mode === "CANARY" ? Math.max(1, Math.min(10, Number(flag.payload?.canaryPercent) || 1)) : 0,
        gatePassed: flag.payload?.gatePassed === true,
        gateApprovalHash: String(flag.payload?.gateApprovalHash || "") || null,
        reasonCodes: cleanReasons(flag.payload?.reasonCodes || SAFE_SHADOW_DEFAULT.reasonCodes),
        updatedAt: flag.payload?.updatedAt || null
    };
}

export function candidateAnswerResolverConfig() {
    return modePayload();
}

function canaryBucket({ userId, canonicalKey, fieldLogicalId }) {
    const hash = stableContractHash({ userId, canonicalKey: canonicalKey || "UNKNOWN", fieldLogicalId });
    return Number.parseInt(hash.slice(0, 8), 16) % 100;
}

function versionedEligible({ versionedResolution, legacyResolution, protectedField, comparison }) {
    const policy = versionedResolution?.policy;
    const contract = versionedResolution?.contract;
    if (protectedField) return { eligible: false, reasonCode: "FIELD_CLASSIFICATION_BLOCKS_VERSIONED" };
    if (legacyResolution?.source === "APPLICATION_DRAFT") return { eligible: false, reasonCode: "APPLICATION_DRAFT_PRECEDENCE" };
    if (versionedResolution?.status !== "READY" || !contract) return { eligible: false, reasonCode: "VERSIONED_CONTRACT_NOT_READY" };
    if (contract.review !== "NONE") return { eligible: false, reasonCode: "VERSIONED_CONTRACT_REQUIRES_REVIEW" };
    if (contract.protected || policy?.riskTier !== "LOW") return { eligible: false, reasonCode: "ONLY_LOW_RISK_CANARY_ALLOWED" };
    if (comparison.outcome !== "MATCH") return { eligible: false, reasonCode: "PARITY_MATCH_REQUIRED_FOR_CANARY" };
    return { eligible: true, reasonCode: "LOW_RISK_PARITY_MATCH" };
}

function versionedAsLegacyShape(versionedResolution) {
    const contract = versionedResolution.contract;
    return {
        normalizedKey: contract.canonicalKey,
        answer: contract.representation.renderedValue,
        confidence: contract.confidence,
        source: "VERSIONED_CANDIDATE_TRUTH",
        evidence: `Candidate truth v${contract.policyVersion}; ${contract.representation.ruleKey}.`,
        requiresUserInput: false,
        answerContractId: contract.contractId,
        candidateAnswerVersionId: contract.candidateAnswerVersionId
    };
}

/**
 * The only production authority switch for Part 2 answers. SHADOW_COMPARE is
 * deliberately side-effect-free except for a value-redacted parity receipt.
 */
export function routeCandidateAnswerResolution({
    userId,
    applicationId = null,
    applicationRunId = null,
    fieldLogicalId,
    canonicalKey = null,
    controlType = "text",
    legacyResolution,
    versionedResolution,
    protectedField = false,
    shadowError = false,
    persistParity = true
}) {
    const config = candidateAnswerResolverConfig();
    if (config.mode === "LEGACY_ONLY") {
        return {
            productionResolution: legacyResolution,
            routing: {
                mode: config.mode,
                productionSource: legacyDecision(legacyResolution) === "READY" ? "LEGACY" : "NONE",
                comparisonOutcome: "NOT_COMPARED",
                canaryEligible: false,
                reasonCodes: ["LEGACY_ONLY_MODE"]
            }
        };
    }

    const comparison = compareResolutions({ legacyResolution, versionedResolution, controlType, shadowError });
    const eligibility = versionedEligible({ versionedResolution, legacyResolution, protectedField, comparison });
    const bucket = canaryBucket({ userId, canonicalKey, fieldLogicalId });
    const canUseVersioned = config.gatePassed && eligibility.eligible
        && (config.mode === "VERSIONED_PRIMARY" || (config.mode === "CANARY" && bucket < config.canaryPercent));
    const productionResolution = canUseVersioned ? versionedAsLegacyShape(versionedResolution) : legacyResolution;
    const productionSource = canUseVersioned ? "VERSIONED"
        : legacyDecision(legacyResolution) === "READY" ? "LEGACY" : "NONE";
    const reasonCodes = cleanReasons(
        comparison.outcome,
        eligibility.reasonCode,
        canUseVersioned ? "VERSIONED_ROUTE_SELECTED" : `${config.mode}_LEGACY_AUTHORITY`,
        versionedResolution?.reasonCodes || [],
        shadowError ? "FIELD_ANSWER_SHADOW_ERROR" : null
    );
    const eventKey = stableContractHash({
        userId,
        applicationId,
        applicationRunId,
        fieldLogicalId,
        canonicalKey,
        resolverMode: config.mode,
        productionSource,
        comparisonOutcome: comparison.outcome,
        legacyValueHash: comparison.legacyValueHash,
        versionedValueHash: comparison.versionedValueHash,
        contractId: versionedResolution?.contract?.contractId || null
    });
    const parityEvent = {
        eventKey,
        userId,
        applicationId,
        applicationRunId,
        fieldLogicalId,
        canonicalKey,
        resolverMode: config.mode,
        productionSource,
        legacyDecision: comparison.legacy,
        versionedDecision: comparison.versioned,
        comparisonOutcome: comparison.outcome,
        legacyValueHash: comparison.legacyValueHash,
        versionedValueHash: comparison.versionedValueHash,
        contractId: versionedResolution?.contract?.contractId || null,
        candidateAnswerVersionId: versionedResolution?.contract?.candidateAnswerVersionId || null,
        policyVersion: versionedResolution?.contract?.policyVersion || null,
        riskTier: versionedResolution?.policy?.riskTier || null,
        reasonCodes
    };
    if (persistParity) recordCandidateAnswerResolutionParity(parityEvent);
    return {
        productionResolution,
        parityEvent,
        routing: {
            mode: config.mode,
            productionSource,
            comparisonOutcome: comparison.outcome,
            canaryEligible: eligibility.eligible,
            canaryBucket: config.mode === "CANARY" ? bucket : null,
            reasonCodes
        }
    };
}

export function persistCandidateAnswerResolutionParityBatch(events) {
    return recordCandidateAnswerResolutionParityBatch(events);
}

export function candidateAnswerResolverReleaseGates({ mode, currentMode, diagnostics } = {}) {
    const target = String(mode || "").toUpperCase();
    const reasons = [];
    if (!CANDIDATE_ANSWER_RESOLVER_MODES.includes(target)) reasons.push("UNKNOWN_RESOLVER_MODE");
    if (target === "CANARY") {
        if (currentMode !== "SHADOW_COMPARE" && currentMode !== "CANARY") reasons.push("CANARY_REQUIRES_SHADOW_COMPARE");
        if ((diagnostics?.compared || 0) < 100) reasons.push("MINIMUM_100_SHADOW_COMPARISONS_REQUIRED");
        if ((diagnostics?.agreementRate || 0) < 0.98) reasons.push("MINIMUM_98_PERCENT_AGREEMENT_REQUIRED");
        if ((diagnostics?.valueMismatches || 0) > 0) reasons.push("ZERO_VALUE_MISMATCHES_REQUIRED");
        if ((diagnostics?.unsafeVersionedSelected || 0) > 0) reasons.push("UNSAFE_VERSIONED_SELECTION_DETECTED");
    }
    if (target === "VERSIONED_PRIMARY") {
        if (currentMode !== "CANARY" && currentMode !== "VERSIONED_PRIMARY") reasons.push("PRIMARY_REQUIRES_CANARY");
        if ((diagnostics?.versionedSelected || 0) < 500) reasons.push("MINIMUM_500_CANARY_SELECTIONS_REQUIRED");
        // Browser acceptance and correction-attribution evidence belongs to a
        // later Part 2B/3 checkpoint. Fail closed until that gate exists.
        reasons.push("VERIFIED_BROWSER_OUTCOME_GATE_NOT_IMPLEMENTED");
    }
    return {
        passed: reasons.length === 0,
        reasonCodes: reasons.length ? reasons : ["RESOLVER_MODE_GATE_PASSED"],
        snapshot: {
            compared: Number(diagnostics?.compared || 0),
            agreementRate: Number(diagnostics?.agreementRate || 0),
            valueMismatches: Number(diagnostics?.valueMismatches || 0),
            versionedSelected: Number(diagnostics?.versionedSelected || 0),
            unsafeVersionedSelected: Number(diagnostics?.unsafeVersionedSelected || 0)
        }
    };
}

export function setCandidateAnswerResolverMode({ mode, canaryPercent = 1, changedBy = "LOCAL_ADMIN" }) {
    const target = String(mode || "").toUpperCase();
    const current = candidateAnswerResolverConfig();
    const diagnostics = candidateAnswerResolutionParityDiagnostics();
    const gate = candidateAnswerResolverReleaseGates({ mode: target, currentMode: current.mode, diagnostics });
    if (!gate.passed) {
        const error = new Error(`Resolver mode change blocked: ${gate.reasonCodes.join(", ")}`);
        error.code = "RESOLVER_MODE_GATE_BLOCKED";
        error.status = 409;
        error.details = gate;
        throw error;
    }
    const percent = target === "CANARY" ? Math.max(1, Math.min(10, Number(canaryPercent) || 1)) : 0;
    const gateApprovalHash = stableContractHash({ target, percent, snapshot: gate.snapshot });
    const payload = {
        mode: target,
        canaryPercent: percent,
        gatePassed: ["CANARY", "VERSIONED_PRIMARY"].includes(target),
        gateApprovalHash,
        reasonCodes: gate.reasonCodes,
        updatedAt: new Date().toISOString()
    };
    getDb().transaction(() => {
        setFeatureFlag({ key: CANDIDATE_ANSWER_RESOLVER_FLAG, enabled: true, scope: "global", payload });
        recordCandidateAnswerResolverModeChange({
            fromMode: current.mode,
            toMode: target,
            canaryPercent: percent,
            gatePassed: gate.passed,
            gateSnapshot: gate.snapshot,
            reasonCodes: gate.reasonCodes,
            changedBy
        });
    })();
    return candidateAnswerResolverDiagnostics();
}

export function candidateAnswerResolverDiagnostics() {
    const config = candidateAnswerResolverConfig();
    const runtime = candidateAnswerResolutionParityDiagnostics();
    const canaryGate = candidateAnswerResolverReleaseGates({ mode: "CANARY", currentMode: config.mode, diagnostics: runtime });
    const primaryGate = candidateAnswerResolverReleaseGates({ mode: "VERSIONED_PRIMARY", currentMode: config.mode, diagnostics: runtime });
    return {
        config,
        runtime,
        gates: { canary: canaryGate, versionedPrimary: primaryGate },
        history: listCandidateAnswerResolverModeHistory(12),
        productionMutationEnabled: ["CANARY", "VERSIONED_PRIMARY"].includes(config.mode) && config.gatePassed
    };
}

import { env } from "../config/environment.js";
import { getDb } from "../database/connection.js";
import { compactCanonicalizationPayload, richCanonicalizationPayload, semanticTextForEmbedding } from "../contracts/fieldSemanticDescriptor.js";
import { canUseSharedCanonicalizationAi } from "./privacyPolicy.js";
import { resolveFieldCanonicalWithAi } from "./openai.js";
import { getFeatureFlag } from "../repositories/featureFlagRepository.js";
import {
    getCachedCanonicalizationDecision,
    saveCachedCanonicalizationDecision
} from "../repositories/canonicalSemanticCacheRepository.js";

export const FIELD_CANONICALIZATION_PROMPT_VERSION = "field-canonical-v1";

function dailyCalls() {
    try {
        return Number(getDb().prepare(`SELECT COUNT(*) AS count FROM ai_call_metrics
            WHERE operation LIKE 'shared_field_canonicalization_%'
              AND created_at >= datetime('now', 'start of day')`).get()?.count || 0);
    } catch {
        return 0;
    }
}

function allowed(descriptor) {
    return getFeatureFlag("canonical.ai-fallback", env.canonicalization.aiEnabled).enabled
        && canUseSharedCanonicalizationAi({
            label: descriptor.source.label,
            name: descriptor.source.attributes.name,
            type: descriptor.source.controlType,
            legal: descriptor.flags.legal,
            sensitive: descriptor.flags.sensitive,
            skipLearning: descriptor.flags.skipLearning
        }) && dailyCalls() < env.canonicalization.aiDailyLimit;
}

function sanitizeResult(result, candidates) {
    if (!result) return null;
    if (result.decision === "EXISTING_CANONICAL") {
        const canonical = String(result.canonical || "").toUpperCase();
        if (!candidates.some((candidate) => candidate.key === canonical)) {
            return { decision: "UNRESOLVED", canonical: null, confidence: 0,
                reasonCodes: ["MODEL_RETURNED_OUT_OF_VOCABULARY_CANONICAL"], needsMoreContext: false, proposed: null };
        }
        return { ...result, canonical, proposed: null };
    }
    if (result.decision === "NEW_CANONICAL_REQUIRED" && !result.proposed) {
        return { decision: "UNRESOLVED", canonical: null, confidence: 0,
            reasonCodes: ["MODEL_OMITTED_NEW_CANONICAL_DEFINITION"], needsMoreContext: false, proposed: null };
    }
    return result;
}

export async function aiCanonicalizationFallback(descriptor, candidates = []) {
    const inputText = semanticTextForEmbedding(descriptor);
    const cached = getCachedCanonicalizationDecision({
        semanticFingerprint: descriptor.fingerprints.semantic,
        inputText,
        model: env.openaiModel,
        promptVersion: FIELD_CANONICALIZATION_PROMPT_VERSION
    });
    if (cached) return { attempted: false, cached: true, reason: "CACHED_UNRESOLVED", result: cached };
    if (!allowed(descriptor)) return { attempted: false, reason: "AI_DISABLED_OR_BUDGET_EXHAUSTED", result: null };
    const compact = sanitizeResult(await resolveFieldCanonicalWithAi(
        compactCanonicalizationPayload(descriptor, candidates), { rich: false }), candidates);
    if (!compact) return { attempted: true, reason: "AI_FAILED", result: null };
    if (!compact.needsMoreContext || compact.decision !== "UNRESOLVED") {
        if (compact.decision === "UNRESOLVED") saveCachedCanonicalizationDecision({
            semanticFingerprint: descriptor.fingerprints.semantic, inputText,
            model: env.openaiModel, promptVersion: FIELD_CANONICALIZATION_PROMPT_VERSION,
            decision: compact
        });
        return { attempted: true, richAttempted: false, result: compact };
    }
    if (dailyCalls() >= env.canonicalization.aiDailyLimit) {
        saveCachedCanonicalizationDecision({
            semanticFingerprint: descriptor.fingerprints.semantic, inputText,
            model: env.openaiModel, promptVersion: FIELD_CANONICALIZATION_PROMPT_VERSION,
            decision: compact, ttlHours: 6
        });
        return { attempted: true, richAttempted: false, reason: "AI_BUDGET_EXHAUSTED_AFTER_COMPACT", result: compact };
    }
    const rich = sanitizeResult(await resolveFieldCanonicalWithAi(
        richCanonicalizationPayload(descriptor, candidates), { rich: true }), candidates);
    const final = rich || compact;
    if (final.decision === "UNRESOLVED") saveCachedCanonicalizationDecision({
        semanticFingerprint: descriptor.fingerprints.semantic, inputText,
        model: env.openaiModel, promptVersion: FIELD_CANONICALIZATION_PROMPT_VERSION,
        decision: final
    });
    return { attempted: true, richAttempted: true, result: final };
}

import { answerLearningPolicyFor } from "./answerLearningPolicy.js";
import { listActiveAnswerPolicies } from "./answerPolicyRegistry.js";
import { candidateAnswerResolverConfig } from "./candidateAnswerResolver.js";

function legacyCategory(policy) {
    if (["APPLICATION_ACTION", "LEGAL_FACT"].includes(policy.answerKind)) return "LEGAL";
    if (policy.answerKind === "SECURITY_CHALLENGE") return "SENSITIVE";
    if (policy.answerKind === "CONTEXTUAL_ANSWER") return policy.reusePolicy === "GENERATE" ? "WRITING" : "PROFESSIONAL";
    if (policy.valueType === "MONEY") return "COMPENSATION";
    if (policy.freshnessProfile === "NOTICE" || policy.freshnessProfile === "DATE_SENSITIVE") return "AVAILABILITY";
    if (policy.answerKind === "PREFERENCE") return "PREFERENCE";
    if (policy.questionFamily === "identity") return "IDENTITY";
    if (["STRING", "PHONE", "URL"].includes(policy.valueType)) return "CONTACT";
    return "PROFESSIONAL";
}

function phase2Decision(policy) {
    if (policy.answerKind === "APPLICATION_ACTION") return "APPLICATION_AUTHORIZATION";
    if (policy.learningMode === "AUTO_VERSION") return "AUTO_VERSION";
    if (policy.learningMode === "EXPLICIT_CONFIRM") return "REVIEW_TO_SAVE";
    if (policy.scopePolicy === "APPLICATION" && policy.riskTier !== "PROHIBITED") return "APPLICATION_ONLY";
    return "NEVER_LEARN";
}

export function candidateAnswerPolicyParityReport() {
    const enabled = candidateAnswerResolverConfig().mode !== "LEGACY_ONLY";
    const rows = listActiveAnswerPolicies().map((policy) => {
        const legacy = answerLearningPolicyFor({
            category: legacyCategory(policy), semanticKey: policy.canonicalKey,
            applicationOnly: policy.scopePolicy === "APPLICATION",
            protected: policy.riskTier === "PROHIBITED",
            entityScoped: policy.answerKind === "ENTITY_SCOPED_FACT"
        });
        const nextDecision = phase2Decision(policy);
        return {
            canonicalKey: policy.canonicalKey,
            legacyDecision: legacy.decision,
            phase2Decision: nextDecision,
            equal: legacy.decision === nextDecision,
            reasonCodes: legacy.decision === nextDecision ? ["POLICY_PARITY"] : ["REFINED_POLICY_DIFFERS_FROM_REGEX_FALLBACK"]
        };
    });
    return {
        enabled,
        productionMutationEnabled: false,
        compared: rows.length,
        matched: rows.filter((row) => row.equal).length,
        mismatches: rows.filter((row) => !row.equal)
    };
}

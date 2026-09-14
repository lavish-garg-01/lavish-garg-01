export const ANSWER_LEARNING_POLICY_VERSION = 1;

export const LEARNING_DECISIONS = Object.freeze({
    AUTO_VERSION: "AUTO_VERSION",
    REVIEW_TO_SAVE: "REVIEW_TO_SAVE",
    APPLICATION_ONLY: "APPLICATION_ONLY",
    APPLICATION_AUTHORIZATION: "APPLICATION_AUTHORIZATION",
    NEVER_LEARN: "NEVER_LEARN"
});

export const LEARNING_COMMIT_POINTS = Object.freeze({
    VERIFIED_SUBMISSION: "VERIFIED_SUBMISSION",
    EXPLICIT_SAVE: "EXPLICIT_SAVE"
});

// This is the authoritative Phase 0A answer for every category currently
// exposed by autofillPolicyRepository. Runtime promotion remains disabled
// until the later durable revision/checkpoint phases consume this policy.
export const LEARNING_CATEGORY_POLICIES = Object.freeze({
    IDENTITY: LEARNING_DECISIONS.AUTO_VERSION,
    CONTACT: LEARNING_DECISIONS.AUTO_VERSION,
    PROFESSIONAL: LEARNING_DECISIONS.AUTO_VERSION,
    COMPENSATION: LEARNING_DECISIONS.REVIEW_TO_SAVE,
    AVAILABILITY: LEARNING_DECISIONS.REVIEW_TO_SAVE,
    PREFERENCE: LEARNING_DECISIONS.REVIEW_TO_SAVE,
    WRITING: LEARNING_DECISIONS.APPLICATION_ONLY,
    SENSITIVE: LEARNING_DECISIONS.NEVER_LEARN,
    LEGAL: LEARNING_DECISIONS.APPLICATION_AUTHORIZATION
});

const SECURITY_CHALLENGE = /password|passcode|one.?time|\botp\b|captcha|verification\s+(?:code|challenge)/i;
const GOVERNMENT_ID = /aadhaar|passport|social security|national id|government id|\bpan\b(?:\s+card|\s+number)?/i;
const DECLARATION = /privacy\s+(?:notice|policy)|terms|declaration|certif|e-?signature|agree|acknowledge|consent\s+to\s+(?:processing|background|terms)/i;
const REVIEW_FACT = /ctc|salary|compensation|notice[_\s]*period|start[_\s]*date|relocat|work[_\s]*authori[sz]|sponsor|government[_\s]*employee|non.?compete|relative[_\s]*at|previously[_\s]*employed/i;

function normalizedCategory(value) {
    const category = String(value || "").trim().toUpperCase();
    return category in LEARNING_CATEGORY_POLICIES ? category : null;
}

/**
 * Phase 0A policy classification only. It does not save candidate memory.
 * Declaration authorization is bound to one application/content revision and
 * is deliberately separate from reusable candidate-answer learning.
 */
export function answerLearningPolicyFor(field = {}) {
    const category = normalizedCategory(field.category);
    const text = `${field.semanticKey || ""} ${field.label || ""} ${field.name || ""} ${field.type || ""}`;
    if (field.protected || SECURITY_CHALLENGE.test(text) || GOVERNMENT_ID.test(text)) {
        return { version: ANSWER_LEARNING_POLICY_VERSION, decision: LEARNING_DECISIONS.NEVER_LEARN, scope: "NONE", commitPoint: null, reasonCode: "PROTECTED_VALUE" };
    }
    if (field.declaration || DECLARATION.test(text) || (category === "LEGAL" && !REVIEW_FACT.test(text))) {
        return { version: ANSWER_LEARNING_POLICY_VERSION, decision: LEARNING_DECISIONS.APPLICATION_AUTHORIZATION, scope: "APPLICATION_CONTENT_REVISION", commitPoint: null, reasonCode: "DECLARATION_IS_NOT_CANDIDATE_MEMORY" };
    }
    if (field.applicationOnly || ["APPLICATION_ONLY", "ROLE_SPECIFIC"].includes(String(field.scope || "").toUpperCase())) {
        return { version: ANSWER_LEARNING_POLICY_VERSION, decision: LEARNING_DECISIONS.APPLICATION_ONLY, scope: "APPLICATION", commitPoint: null, reasonCode: "CONTEXT_SPECIFIC_ANSWER" };
    }
    if (field.suspiciousChange || field.ambiguousScope || field.entityScoped || REVIEW_FACT.test(text)) {
        return { version: ANSWER_LEARNING_POLICY_VERSION, decision: LEARNING_DECISIONS.REVIEW_TO_SAVE, scope: field.entityScoped ? "QUALIFIED_ENTITY" : "CANDIDATE", commitPoint: LEARNING_COMMIT_POINTS.EXPLICIT_SAVE, reasonCode: "CONSEQUENTIAL_OR_SCOPED_FACT" };
    }
    const decision = category ? LEARNING_CATEGORY_POLICIES[category] : LEARNING_DECISIONS.REVIEW_TO_SAVE;
    if (decision === LEARNING_DECISIONS.AUTO_VERSION) {
        return { version: ANSWER_LEARNING_POLICY_VERSION, decision, scope: "CANDIDATE", commitPoint: LEARNING_COMMIT_POINTS.VERIFIED_SUBMISSION, reasonCode: "LOW_RISK_STABLE_FACT" };
    }
    if (decision === LEARNING_DECISIONS.APPLICATION_AUTHORIZATION) {
        return { version: ANSWER_LEARNING_POLICY_VERSION, decision, scope: "APPLICATION_CONTENT_REVISION", commitPoint: null, reasonCode: "DECLARATION_IS_NOT_CANDIDATE_MEMORY" };
    }
    if (decision === LEARNING_DECISIONS.APPLICATION_ONLY || decision === LEARNING_DECISIONS.NEVER_LEARN) {
        return { version: ANSWER_LEARNING_POLICY_VERSION, decision, scope: decision === LEARNING_DECISIONS.NEVER_LEARN ? "NONE" : "APPLICATION", commitPoint: null, reasonCode: decision === LEARNING_DECISIONS.NEVER_LEARN ? "CATEGORY_NEVER_LEARNS" : "CONTEXT_SPECIFIC_ANSWER" };
    }
    return { version: ANSWER_LEARNING_POLICY_VERSION, decision: LEARNING_DECISIONS.REVIEW_TO_SAVE, scope: "CANDIDATE", commitPoint: LEARNING_COMMIT_POINTS.EXPLICIT_SAVE, reasonCode: category ? "CATEGORY_REQUIRES_REVIEW" : "UNKNOWN_CATEGORY_FAILS_CLOSED" };
}

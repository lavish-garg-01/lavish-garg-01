export const SCOPED_CANDIDATE_ANSWER_LEARNING_VERSION = 1;

const POLICIES = Object.freeze({
    EXPECTED_CTC: Object.freeze({
        canonicalKey: "EXPECTED_CTC",
        mode: "OVERRIDE_REVIEW",
        overrideScope: Object.freeze(["companyGroup", "roleFamily", "country"]),
        reviewReuse: "AUTOFILL",
        promoteReviewOn: "UNCHANGED_VERIFIED_SUBMISSION"
    }),
    RELOCATION: Object.freeze({
        canonicalKey: "RELOCATION",
        mode: "OVERRIDE_REVIEW",
        overrideScope: Object.freeze(["companyGroup", "roleFamily", "country"]),
        reviewReuse: "AUTOFILL",
        promoteReviewOn: "UNCHANGED_VERIFIED_SUBMISSION"
    }),
    PREFERRED_LOCATIONS: Object.freeze({
        canonicalKey: "PREFERRED_LOCATIONS",
        mode: "OVERRIDE_REVIEW",
        overrideScope: Object.freeze(["roleFamily", "country"]),
        reviewReuse: "AUTOFILL",
        promoteReviewOn: "UNCHANGED_VERIFIED_SUBMISSION"
    })
});

const PROMOTABLE_ORIGINS = new Set(["USER_CORRECTION", "USER_MANUAL", "USER_EXPLICIT_SAVE"]);

export function scopedCandidateAnswerLearningPolicy(canonicalKey) {
    return POLICIES[String(canonicalKey || "").trim().toUpperCase()] || null;
}

export function preferredOverrideScope(scopedPolicy, normalizedContext = {}) {
    if (!scopedPolicy || scopedPolicy.mode !== "OVERRIDE_REVIEW") {
        return { ok: false, qualifiers: {}, reasonCodes: ["SCOPED_REVIEW_POLICY_NOT_CONFIGURED"] };
    }
    const qualifiers = {};
    const missing = [];
    for (const dimension of scopedPolicy.overrideScope) {
        const value = normalizedContext[dimension];
        if (value) qualifiers[dimension] = value;
        else missing.push(dimension);
    }
    if (missing.length) {
        return { ok: false, qualifiers: {}, missing,
            reasonCodes: ["PREFERRED_OVERRIDE_SCOPE_INCOMPLETE"] };
    }
    return { ok: true, qualifiers, missing: [], reasonCodes: ["EXACT_POLICY_OVERRIDE_SCOPE"] };
}

export function reviewOriginPromotable(originKind) {
    return PROMOTABLE_ORIGINS.has(String(originKind || "").trim().toUpperCase());
}

export function scopedLearningDiagnostics() {
    return {
        version: SCOPED_CANDIDATE_ANSWER_LEARNING_VERSION,
        policies: Object.values(POLICIES).map((policy) => ({ ...policy, overrideScope: [...policy.overrideScope] })),
        confidenceScoring: false,
        historicalScanning: false
    };
}

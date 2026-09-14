const POLICY_VERSION = 1;

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

/**
 * Product decisions for Connected Jobs.
 *
 * This is deliberately data, not matching implementation. Routes and UI may
 * render a MatchDecision, but eligibility and ranking logic must live in the
 * jobs domain and use this versioned contract.
 */
export const CONNECTED_JOBS_POLICY = deepFreeze({
    id: "connected-jobs-india",
    version: POLICY_VERSION,
    algorithmVersion: "matching-policy-v1.3",
    ownership: {
        policy: "src/config/connectedJobsPolicy.js",
        evaluation: "src/services/matchingPolicy.js",
        forbiddenRuleOwners: ["src/routes", "web"]
    },
    market: {
        countryCode: "IN",
        currency: "INR"
    },
    discovery: {
        freshThroughDays: 7,
        eligibleThroughDays: 14,
        olderJobTreatment: "HIDDEN"
    },
    availabilityVerification: {
        promptMode: "NATURAL_INTERACTION_ONLY",
        maxOpenClaimsPerJob: 1,
        maxPromptsPerUserPerDay: 1,
        unsupportedReportsToClose: 2,
        singleUnsupportedReportTreatment: "SUSPECTED_CLOSED",
        conflictingReportsTreatment: "UNKNOWN",
        candidateAnswersStored: false
    },
    savedJobs: {
        ignoresDiscoveryAge: true,
        retainUntilUserUnsaves: true,
        closedJobTreatment: "SHOW_WITH_CLOSED_BADGE",
        copilotAllowedWhenClosed: false
    },
    dismissedJobs: {
        scope: "MATERIAL_JOB_VERSION",
        cosmeticRefreshRestoresJob: false,
        materialUpdateMayRestoreJob: true
    },
    appliedJobs: {
        nearDuplicateCooldownDays: 45,
        materiallyDifferentRoleMayBypassCooldown: true
    },
    evidence: {
        missingPostingEvidence: "UNKNOWN",
        unknownCreatesHardConflict: false,
        hardExclusionsRequireExplicitEvidence: true
    },
    compensation: {
        missingSalaryTreatment: "UNKNOWN_NO_PENALTY",
        minimumSalaryDefaultMode: "SOFT",
        supportedConstraintModes: ["SOFT", "HARD"]
    },
    location: {
        defaultMode: "SOFT",
        supportedConstraintModes: ["SOFT", "HARD"],
        explicitRemoteCountryConflict: "HARD_EXCLUDE"
    },
    workMode: {
        defaultMode: "SOFT",
        supportedConstraintModes: ["SOFT", "HARD"]
    },
    employmentType: {
        defaultMode: "SOFT",
        fullTimePreferenceAllowsContract: true,
        supportedConstraintModes: ["SOFT", "HARD"]
    },
    experience: {
        smallGapTreatment: "VISIBLE_WITH_PENALTY",
        largeButPlausibleGapTreatment: "VISIBLE_WITH_STRONG_PENALTY",
        unrealisticGapTreatment: "HARD_EXCLUDE",
        thresholdsAreVersioned: true
    },
    skills: {
        missingPrimaryCoreStack: "HARD_EXCLUDE",
        missingSecondarySkill: "VISIBLE_WITH_GAP",
        acceptableCoreStacksRemainEligible: true,
        unacceptedCoreStacksAreExcluded: true
    },
    roles: {
        unrelatedFamilyTreatment: "HARD_EXCLUDE",
        explicitAdjacentTrackTreatment: "VISIBLE_WITH_PENALTY",
        adjacentTracksMustBeCandidateSelected: true
    },
    seniority: {
        nearbyLevelsMayRemainVisible: true,
        leadershipLevelsRequireEvidence: true,
        unsupportedLeadershipTreatment: "HARD_EXCLUDE"
    },
    exclusions: {
        excludedCompanyTreatment: "HARD_EXCLUDE",
        dealBreakersRequireExplicitEvidence: true,
        supportedDealBreakers: [
            "NIGHT_SHIFT",
            "MANDATORY_RELOCATION",
            "EMPLOYMENT_BOND",
            "HEAVY_TRAVEL",
            "SIX_DAY_WEEK",
            "INTERNSHIP",
            "STAFFING_AGENCY"
        ],
        explicitSponsorshipConflict: "HARD_EXCLUDE",
        explicitWorkAuthorizationConflict: "HARD_EXCLUDE"
    },
    freePlan: {
        aiRequiredForJobMatching: false,
        aiRequiredForMatchExplanation: false,
        explanationSource: "DETERMINISTIC_EVIDENCE"
    }
});

export const MATCH_DECISION_CONTRACT = deepFreeze({
    version: POLICY_VERSION,
    eligibilityStatuses: ["ELIGIBLE", "INELIGIBLE"],
    requiredFields: ["eligibility", "score", "reasons", "gaps", "unknowns", "versions"],
    scoreDimensions: ["role", "skills", "experience", "location", "workMode", "compensation", "employmentType", "seniority"],
    requiredVersions: ["profileVersion", "jobMatchVersion", "algorithmVersion"]
});

export function assertConnectedJobsPolicy(policy = CONNECTED_JOBS_POLICY) {
    const errors = [];
    const positiveInteger = (value) => Number.isInteger(value) && value > 0;

    if (policy.id !== "connected-jobs-india") errors.push("policy id must remain connected-jobs-india");
    if (!positiveInteger(policy.version)) errors.push("version must be a positive integer");
    if (!positiveInteger(policy.discovery?.freshThroughDays)) errors.push("freshThroughDays must be a positive integer");
    if (!positiveInteger(policy.discovery?.eligibleThroughDays)) errors.push("eligibleThroughDays must be a positive integer");
    if (policy.discovery?.freshThroughDays >= policy.discovery?.eligibleThroughDays) {
        errors.push("freshThroughDays must be lower than eligibleThroughDays");
    }
    if (policy.discovery?.olderJobTreatment !== "HIDDEN") errors.push("jobs older than the discovery window must be hidden");
    if (policy.availabilityVerification?.maxOpenClaimsPerJob !== 1) errors.push("only one user may hold an availability check at a time");
    if (policy.availabilityVerification?.unsupportedReportsToClose < 2) errors.push("one unsupported report must never close a job globally");
    if (policy.availabilityVerification?.candidateAnswersStored !== false) errors.push("availability verification must not store candidate answers");
    if (policy.appliedJobs?.nearDuplicateCooldownDays !== 45) errors.push("near-duplicate application cooldown must be 45 days");
    if (policy.compensation?.missingSalaryTreatment !== "UNKNOWN_NO_PENALTY") errors.push("missing salary must remain unknown without penalty");
    if (policy.evidence?.unknownCreatesHardConflict !== false) errors.push("unknown evidence must not create a hard conflict");
    if (policy.freePlan?.aiRequiredForJobMatching !== false) errors.push("Free matching must not require AI");
    if (policy.freePlan?.aiRequiredForMatchExplanation !== false) errors.push("Free explanations must not require AI");

    if (errors.length) throw new Error(`Invalid Connected Jobs policy v${policy.version || "?"}: ${errors.join("; ")}`);
    return policy;
}

assertConnectedJobsPolicy();

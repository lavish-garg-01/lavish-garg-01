import { getCandidateSearchProfile } from "../repositories/candidateSearchProfileRepository.js";
import { getCandidateProfile, LOCAL_USER_ID } from "../repositories/copilotRepository.js";
import { evaluateMatchingPolicy } from "./matchingPolicy.js";
import { loadResume } from "./resumeStore.js";

/**
 * Joins candidate evidence and search intent at the boundary of the matching
 * domain. Search intent wins when a legacy candidate-profile column overlaps.
 */
export function currentCandidateMatchingProfile(userId = LOCAL_USER_ID) {
    const evidence = getCandidateProfile();
    const search = getCandidateSearchProfile(userId);
    return { ...evidence, ...search, profileVersion: search.profileVersion };
}

export function evaluateCurrentCandidateMatch(job, {
    userId = LOCAL_USER_ID,
    resume = loadResume(),
    profile = null,
    context = "APPLICATION",
    saved = true,
    lexical,
    now
} = {}) {
    return evaluateMatchingPolicy(job, resume, profile || currentCandidateMatchingProfile(userId), {
        context,
        saved,
        ...(lexical ? { lexical } : {}),
        ...(now ? { now } : {})
    });
}

export function matchBlockingReason(decision) {
    return decision?.eligibility?.exclusions?.[0]?.label || "Job conflicts with your current search policy.";
}

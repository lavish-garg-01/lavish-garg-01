import { getCandidateProfile } from "../repositories/copilotRepository.js";
import { evaluateHeuristicMatch, recentJobCorpus } from "./heuristicMatcher.js";

/**
 * Cheap keyword overlap vs resume. 0–100. Skip obvious mismatches before OpenAI.
 */
export function preScoreJob(job, resume, {
    profile = getCandidateProfile(),
    corpus = recentJobCorpus()
} = {}) {
    const result = evaluateHeuristicMatch(job, resume, profile, { corpus });
    return {
        preScore: Math.round(result.matchScore),
        matchedSkills: result.matchedSkills,
        transferableSkills: result.transferableSkills,
        missingSkills: result.missingSkills,
        confidence: result.confidence,
        breakdown: result.breakdown,
        heuristic: result,
        tokenOverlap: result.breakdown?.bm25Terms?.length || 0
    };
}

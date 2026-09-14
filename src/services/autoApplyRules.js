import fs from "fs";
import { getDb } from "../database/connection.js";
import { env } from "../config/environment.js";
import { getAutoApplySettings, getCandidateProfile, LOCAL_USER_ID } from "../repositories/copilotRepository.js";
import { currentCandidateMatchingProfile, matchBlockingReason } from "./currentCandidateMatching.js";
import { evaluateMatchingPolicy } from "./matchingPolicy.js";
import { loadResume } from "./resumeStore.js";

export function evaluateAutoApply(
    job,
    candidate = getCandidateProfile(),
    settings = getAutoApplySettings(),
    { requireResume = true } = {}
) {
    if (!settings.enabled) return { allowed: false, reason: "COPILOT preparation is disabled in settings." };
    const resume = loadResume();
    const matchingProfile = { ...candidate, ...currentCandidateMatchingProfile(LOCAL_USER_ID) };
    const decision = evaluateMatchingPolicy(job, resume, matchingProfile, {
        context: "APPLICATION",
        saved: true
    });
    if (decision.eligibility.status === "INELIGIBLE") {
        return { allowed: false, reason: matchBlockingReason(decision), decision };
    }
    if (Number(decision.matchScore) < Number(settings.minimumMatchScore)) {
        return { allowed: false, reason: `Match score ${decision.matchScore} is below minimum ${settings.minimumMatchScore}.`, decision };
    }
    if (requireResume && (!job.generated_resume_path || !fs.existsSync(job.generated_resume_path))) {
        return { allowed: false, reason: "Build the tailored resume PDF before preparing an application." };
    }
    if (!candidate.name || !candidate.email) {
        return { allowed: false, reason: "Candidate name and email are required." };
    }
    const db = getDb();
    const today = db.prepare(`SELECT COUNT(*) AS n FROM applications WHERE user_id = ? AND adapter IN ('REAL_WEB','EXTENSION') AND submitted_at >= date('now')`).get(LOCAL_USER_ID).n;
    if (today >= Math.min(settings.maxApplicationsPerDay, env.copilot.maxRealApplicationsPerDay)) {
        return { allowed: false, reason: "Daily application limit reached." };
    }
    const week = db.prepare(`SELECT COUNT(*) AS n FROM applications WHERE user_id = ? AND adapter IN ('REAL_WEB','EXTENSION') AND submitted_at >= datetime('now', '-7 days')`).get(LOCAL_USER_ID).n;
    if (week >= settings.maxApplicationsPerWeek) return { allowed: false, reason: "Weekly application limit reached." };
    return { allowed: true, reason: "All COPILOT preparation criteria are satisfied.", decision };
}

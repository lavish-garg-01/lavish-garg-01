function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function extractMinimumExperienceYears(value = "") {
    const text = String(value).replace(/\\-/g, "-").replace(/\s+/g, " ");
    const patterns = [
        { expression: /\b(?:minimum|min\.?|at least)\s*(?:of\s*)?(\d{1,2}(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b/gi, optional: false },
        { expression: /\b(?:requires?|requirement)\s*(?:of|:)?\s*(\d{1,2}(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b/gi, optional: false },
        { expression: /\b(\d{1,2}(?:\.\d+)?)\s*\+\s*(?:years?|yrs?)(?:\s+of)?\s+(?:relevant\s+)?experience\b/gi, optional: true },
        { expression: /\b(?:experience\s*(?:of|:)?\s*)?(\d{1,2}(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?:\.\d+)?)\s*(?:years?|yrs?)\b/gi, optional: true },
        { expression: /\b(?:experience)\s*(?:of|:)?\s*(\d{1,2}(?:\.\d+)?)\s*(?:years?|yrs?)\b/gi, optional: true },
        { expression: /\b(\d{1,2}(?:\.\d+)?)\s*(?:years?|yrs?)(?:\s+of)?\s+(?:relevant\s+)?experience\b/gi, optional: true }
    ];
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern.expression)) {
            if (pattern.optional) {
                const context = text.slice(Math.max(0, match.index - 70), Math.min(text.length, match.index + match[0].length + 70));
                if (/\b(?:preferred|nice to have|bonus|welcome to apply|also welcome|maximum|max\.?|up to)\b/i.test(context)) continue;
            }
            const minimum = number(match[1]);
            if (minimum !== null && minimum <= 40) return minimum;
        }
    }
    return null;
}

export function candidateExperienceYears(candidate = {}, resume = {}) {
    const explicit = number(candidate.totalExperienceYears ?? resume.totalExperienceYears);
    if (explicit !== null) return explicit;
    const roles = Array.isArray(resume.experience) ? resume.experience : [];
    const starts = roles.map((role) => String(role.startDate || "").match(/^(\d{4})-(\d{2})/)).filter(Boolean);
    if (!starts.length) return null;
    const earliest = Math.min(...starts.map((match) => Number(match[1]) * 12 + Number(match[2]) - 1));
    const now = new Date();
    return Math.floor((((now.getUTCFullYear() * 12 + now.getUTCMonth()) - earliest + 1) / 12) * 2) / 2;
}

export function evaluateExperienceEligibility(job = {}, candidate = {}, resume = {}) {
    const requiredYears = number(job.yoe_min) ?? extractMinimumExperienceYears(`${job.title || ""} ${job.description || ""}`);
    const candidateYears = candidateExperienceYears(candidate, resume);
    if (requiredYears === null) {
        return { allowed: true, known: false, requiredYears: null, candidateYears, reason: "Minimum experience was not stated." };
    }
    if (candidateYears === null) {
        return { allowed: false, known: true, requiredYears, candidateYears: null, reason: `Role requires at least ${requiredYears} year(s), but candidate experience is not confirmed.` };
    }
    const allowed = candidateYears >= requiredYears;
    return {
        allowed,
        known: true,
        requiredYears,
        candidateYears,
        reason: allowed
            ? `Candidate experience ${candidateYears} year(s) meets the ${requiredYears} year minimum.`
            : `Experience mismatch: role requires at least ${requiredYears} year(s), but candidate has ${candidateYears} year(s).`
    };
}

export function applyExperienceEligibility(analysis, job, candidate = {}, resume = {}) {
    const eligibility = evaluateExperienceEligibility(job, candidate, resume);
    if (eligibility.allowed) {
        return { ...analysis, minimumExperienceYears: eligibility.requiredYears, candidateExperienceYears: eligibility.candidateYears, experienceCompatible: true };
    }
    return {
        ...analysis,
        matchScore: Math.min(Number(analysis.matchScore || 0), 35),
        recommendation: "skip",
        explanation: `${eligibility.reason} ${analysis.explanation || ""}`.trim(),
        minimumExperienceYears: eligibility.requiredYears,
        candidateExperienceYears: eligibility.candidateYears,
        experienceCompatible: false
    };
}

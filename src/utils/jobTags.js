import { extractMinimumExperienceYears } from "../services/experienceEligibility.js";

/**
 * Heuristic extraction of India-market job tags for UI chips.
 */
export function extractJobTags(job = {}) {
    const text = `${job.title || ""} ${job.description || ""}`.toLowerCase();

    const rawExplicitYoe = job.minimumExperienceYears ?? job.minimum_experience_years;
    const explicitYoe = rawExplicitYoe === null || rawExplicitYoe === undefined || rawExplicitYoe === "" ? NaN : Number(rawExplicitYoe);
    const yoeMin = Number.isFinite(explicitYoe) && explicitYoe >= 0 && explicitYoe <= 40
        ? explicitYoe
        : extractMinimumExperienceYears(text);

    const lpaMatch = text.match(
        /(\d{1,2}(?:\.\d+)?)\s*[\-–to]+\s*(\d{1,2}(?:\.\d+)?)\s*lpa|\b(\d{1,2}(?:\.\d+)?)\s*lpa/i
    );
    let ctcMinLpa = null;
    let ctcMaxLpa = null;
    if (lpaMatch) {
        if (lpaMatch[1] && lpaMatch[2]) {
            ctcMinLpa = Number(lpaMatch[1]);
            ctcMaxLpa = Number(lpaMatch[2]);
        } else if (lpaMatch[3]) {
            ctcMinLpa = Number(lpaMatch[3]);
            ctcMaxLpa = Number(lpaMatch[3]);
        }
    }

    let workMode = "unstated";
    if (/\b(wfo|work from office|office first|5 days?\s*(in|at)\s*office)\b/.test(text)) {
        workMode = "WFO";
    } else if (/\bhybrid\b/.test(text)) {
        workMode = "Hybrid";
    } else if (/\b(remote|wfh|work from home)\b/.test(text)) {
        workMode = "Remote";
    }

    return {
        yoeMin: Number.isFinite(yoeMin) ? yoeMin : null,
        ctcMinLpa: Number.isFinite(ctcMinLpa) ? ctcMinLpa : null,
        ctcMaxLpa: Number.isFinite(ctcMaxLpa) ? ctcMaxLpa : null,
        workMode,
        hasEsops: /\b(esop|esops|equity|stock options)\b/.test(text) ? 1 : 0,
        hasBond: /\b(service bond|employment bond|bond of)\b/.test(text) ? 1 : 0
    };
}

export function salarySanity(title = "", ctcMinLpa, ctcMaxLpa) {
    const t = String(title).toLowerCase();
    let expected = [12, 28];
    if (/\b(staff|principal|architect|team lead|sde-?3|sde iii)\b/.test(t)) {
        expected = [30, 55];
    } else if (/\b(senior|sde-?2|sde ii)\b/.test(t)) {
        expected = [18, 40];
    }
    const mid = ctcMinLpa && ctcMaxLpa ? (ctcMinLpa + ctcMaxLpa) / 2 : ctcMinLpa || ctcMaxLpa;
    if (!mid) {
        return `Typical backend band ~${expected[0]}–${expected[1]} LPA (India product/GCC). JD has no CTC.`;
    }
    if (mid < expected[0] * 0.7) {
        return `${mid} LPA looks low vs typical ${expected[0]}–${expected[1]} LPA for this title.`;
    }
    if (mid > expected[1] * 1.3) {
        return `${mid} LPA looks high vs typical ${expected[0]}–${expected[1]} LPA — verify level.`;
    }
    return `${mid} LPA is in a plausible ${expected[0]}–${expected[1]} LPA band for this title in India.`;
}

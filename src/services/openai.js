import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { normalizeLineBreaks } from "../utils/textFormatting.js";
import { z } from "zod";
import { env } from "../config/environment.js";
import { getDb } from "../database/connection.js";
import { loadResume, scoringTerms } from "./resumeStore.js";
import { preScoreJob } from "./prescore.js";
import { extractJobTags } from "../utils/jobTags.js";
import { getCandidateProfile } from "../repositories/copilotRepository.js";
import { getCandidateSearchProfile } from "../repositories/candidateSearchProfileRepository.js";
import { canUseAiProcessing } from "./privacyPolicy.js";
import { currentPlan } from "./entitlements.js";
import { recordAiCall } from "./aiTelemetry.js";
import { evaluateHeuristicMatch, recentJobCorpus, shouldEscalateToAi } from "./heuristicMatcher.js";
import { filterClaimableSkills } from "./skillOntology.js";
import { classifyJobTitle } from "./roleTaxonomy.js";
import crypto from "node:crypto";

const INDIA_LPA_SYSTEM_RULES = [
    "You are analyzing the Indian tech market.",
    "Salary figures are written as LPA (Lakhs Per Annum).",
    "1 LPA equals 100,000 INR.",
    "Treat a range like 15-25 LPA as standard for a mid-to-senior developer role.",
    "Never interpret a bare number like 20 in 'CTC: 20 LPA' as USD thousands, hourly wage, or poverty pay.",
    "1 Crore = 100 LPA = 10,000,000 INR.",
    "Only treat figures as USD if the posting explicitly uses $, USD, or 'k/year' US-style notation."
].join(" ");

const MatchEvaluationSchema = z.object({
    matchScore: z.number().min(0).max(100),
    explanation: z.string(),
    matchedSkills: z.array(z.string()),
    missingSkills: z.array(z.string()),
    recommendation: z.enum(["pursue", "maybe", "skip"]),
    noticePeriodRequired: z
        .string()
        .nullable()
        .describe(
            "Extracted notice requirement, e.g. 'immediate', '15 days', '30 days', '90 days', or null if unstated"
        ),
    noticePeriodRequiredDays: z
        .number()
        .int()
        .min(0)
        .max(365)
        .nullable()
        .describe("Max notice days allowed by employer; 0 means immediate joiner; null if unstated"),
    immediateJoiner: z
        .boolean()
        .describe("True if the posting demands immediate joiners / serving no notice"),
    coachingNudges: z
        .array(z.string())
        .max(3)
        .describe("Up to 3 actionable coaching nudges to improve resume or interview fit")
});

const TailoringRoleSchema = z.object({
    company: z.string(),
    title: z.string(),
    bullets: z.array(z.string())
});

const TailoringSchema = z.object({
    coverLetter: z.string(),
    resumeSummary: z.string(),
    modifiedBullets: z.array(z.string()).min(1),
    outreachEmail: z.string(),
    linkedinOutreachNote: z
        .string()
        .describe("Proof-first LinkedIn note, max 300 characters"),
    linkedinOutreachCuriosity: z
        .string()
        .describe("Curiosity-hook LinkedIn note, max 300 characters; empty string if not used"),
    extraSkills: z
        .array(z.string())
        .describe("Adjacent JD skills the candidate can honestly emphasize (no invented employers)"),
    modifiedBulletsByRole: z
        .array(TailoringRoleSchema)
        .describe("Rewritten bullets for each experience role, grounded in the resume"),
    keywordsToEmphasize: z.array(z.string())
});

const FieldCanonicalizationSchema = z.object({
    decision: z.enum(["EXISTING_CANONICAL", "NEW_CANONICAL_REQUIRED", "UNRESOLVED"]),
    canonical: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    reasonCodes: z.array(z.string()).max(8),
    needsMoreContext: z.boolean(),
    proposed: z.object({
        canonicalName: z.string(),
        label: z.string(),
        description: z.string(),
        semanticGroup: z.string(),
        dataType: z.enum(["TEXT", "NUMBER", "BOOLEAN", "DATE", "ENUM", "URL"]),
        answerType: z.enum(["TEXT", "NUMBER", "BOOLEAN", "DATE", "ENUM", "URL"]),
        sensitivity: z.enum(["STANDARD", "SENSITIVE", "LEGAL"]),
        displayQuestion: z.string()
    }).strict().nullable()
}).strict();

let client = null;

function getClient() {
    if (!env.openaiApiKey) {
        throw new Error("OPENAI_API_KEY is required for AI scoring and document generation");
    }
    if (!client) {
        client = new OpenAI({ apiKey: env.openaiApiKey });
    }
    return client;
}

export function loadMasterResume() {
    return loadResume();
}

function noticeFilterEnabled() {
    return Number(env.candidateNoticeDays) > 0;
}

function candidateNoticeDays(resume = {}) {
    if (!noticeFilterEnabled()) {
        return 0;
    }
    const fromResume = Number(resume.noticePeriodDays);
    if (Number.isFinite(fromResume) && fromResume > 0) {
        return fromResume;
    }
    return env.candidateNoticeDays;
}

function extractNoticeHeuristic(description = "") {
    const text = String(description).toLowerCase();
    if (/\b(immediate\s+joiner|joining\s+immediately|asap\s+joiner|can\s+join\s+immediately)\b/.test(text)) {
        return { noticePeriodRequired: "immediate", noticePeriodRequiredDays: 0, immediateJoiner: true };
    }

    const match = text.match(
        /\b(?:max(?:imum)?|only|within|upto|up\s*to)?\s*(\d{1,3})\s*(?:days?|day)\s*(?:notice|np)\b|\bnotice\s*(?:period)?\s*(?:of|:)?\s*(\d{1,3})\s*days?\b|\b(\d{1,3})\s*days?\s*notice\b/
    );
    if (match) {
        const days = Number(match[1] || match[2] || match[3]);
        if (Number.isFinite(days)) {
            return {
                noticePeriodRequired: `${days} days`,
                noticePeriodRequiredDays: days,
                immediateJoiner: days === 0
            };
        }
    }

    return { noticePeriodRequired: null, noticePeriodRequiredDays: null, immediateJoiner: false };
}

function applyNoticeCompatibility(analysis, resume) {
    const candidateDays = candidateNoticeDays(resume);
    const requiredDays = analysis.noticePeriodRequiredDays;
    let noticeCompatible = true;
    let score = analysis.matchScore;
    let recommendation = analysis.recommendation;
    let explanation = analysis.explanation;

    if (!noticeFilterEnabled() || requiredDays === null || requiredDays === undefined || !Number.isFinite(requiredDays)) {
        return {
            ...analysis,
            matchScore: score,
            recommendation,
            explanation,
            candidateNoticeDays: noticeFilterEnabled() ? candidateDays : null,
            noticeCompatible: true
        };
    }

    noticeCompatible = candidateDays <= requiredDays;
    if (!noticeCompatible) {
        score = Math.min(score, 40);
        recommendation = "skip";
        explanation = `${explanation} Notice mismatch: role allows max ${requiredDays} day(s) but candidate notice is ${candidateDays} day(s).`;
    }

    return {
        ...analysis,
        matchScore: score,
        recommendation,
        explanation,
        candidateNoticeDays: candidateDays,
        noticeCompatible
    };
}

const SKILL_EVIDENCE_ALIASES = Object.freeze({
    "voice ai orchestration": ["voice ai", "ai voice", "voice streaming", "conversational ai"],
    "real-time media pipelines": ["voice streaming", "video streaming", "rtmp", "hls", "webrtc", "ffmpeg", "streaming audio"],
    "speech and ai provider integrations": ["exotel", "voice streaming", "ai voice", "asr", "tts", "llm provider"]
});

function evidenceText(resume = {}) {
    return JSON.stringify(resume).toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ");
}

function normalizedSkill(value = "") {
    return String(value).toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
}

function hasExplicitResumeEvidence(skill, resume = {}) {
    const key = normalizedSkill(skill);
    const evidence = evidenceText(resume);
    const aliasEntry = Object.entries(SKILL_EVIDENCE_ALIASES).find(([name]) => normalizedSkill(name) === key);
    const aliases = [key, ...(aliasEntry?.[1] || [])].map(normalizedSkill).filter(Boolean);
    return aliases.some((alias) => evidence.includes(alias));
}

function alternativeAlreadySatisfied(skill, jobDescription, resume = {}) {
    const key = normalizedSkill(skill);
    if (!key) return false;
    const resumeTerms = scoringTerms(resume).map(normalizedSkill).filter((term) => term.length >= 2);
    return String(jobDescription || "").split(/[\n;]+|[.!?](?=\s+[A-Z])/).some((raw) => {
        const sentence = normalizedSkill(raw);
        return sentence.includes(key) && /\bor\b/.test(sentence) && resumeTerms.some((term) => term !== key && sentence.includes(term));
    });
}

export function reconcileModelSkillClaims(analysis = {}, job = {}, resume = {}) {
    const matched = [...new Set((analysis.matchedSkills || []).map(String).filter(Boolean))];
    const reconciled = [];
    const missingSkills = [];
    for (const skill of analysis.missingSkills || []) {
        if (hasExplicitResumeEvidence(skill, resume) || alternativeAlreadySatisfied(skill, job.description, resume)) {
            reconciled.push(String(skill));
            if (!matched.some((item) => normalizedSkill(item) === normalizedSkill(skill))) matched.push(String(skill));
        } else missingSkills.push(String(skill));
    }
    if (!reconciled.length) return { ...analysis, matchedSkills: matched, missingSkills };
    const reconciledKeys = reconciled.flatMap((skill) => {
        const key = normalizedSkill(skill);
        const aliasEntry = Object.entries(SKILL_EVIDENCE_ALIASES).find(([name]) => normalizedSkill(name) === key);
        return [key, ...(aliasEntry?.[1] || []).map(normalizedSkill)];
    });
    const keptSentences = String(analysis.explanation || "").split(/(?<=[.!?])\s+/).filter((sentence) => {
        const text = normalizedSkill(sentence);
        return !/(?:lack|missing|does not mention|no experience)/.test(text) || !reconciledKeys.some((key) => text.includes(key));
    });
    return {
        ...analysis,
        explanation: `Verified resume evidence satisfies: ${reconciled.join(", ")}. ${keptSentences.join(" ")}`.trim(),
        matchedSkills: matched,
        missingSkills,
        coachingNudges: (analysis.coachingNudges || []).filter((nudge) => {
            const text = normalizedSkill(nudge);
            return !reconciledKeys.some((key) => text.includes(key));
        })
    };
}

function heuristicScore(job, resume, { corpus = recentJobCorpus(), profile = getCandidateProfile() } = {}) {
    const search = getCandidateSearchProfile();
    const matchingProfile = { ...profile, ...search, profileVersion: search.profileVersion };
    const deterministic = evaluateHeuristicMatch(job, resume, matchingProfile, { corpus });
    const notice = extractNoticeHeuristic(job.description);
    return applyNoticeCompatibility(
        {
            ...deterministic,
            aiEscalated: false,
            ...notice
        },
        resume
    );
}

function heuristicTailoring(job, resume) {
    const topBullets = (resume.experience?.[0]?.bullets || []).slice(0, 4);
    const company = job.company_name || job.company;
    const role = resume.experience?.[0] || {};
    const groundedSkills = scoringTerms(resume).filter((skill) =>
        String(`${job.title} ${job.description}`).toLowerCase().includes(String(skill).toLowerCase())).slice(0, 5);
    const proof = topBullets[0] || `Worked as ${role.title || "a professional"} at ${role.company || "a prior employer"}`;
    const linkedinOutreachNote = `Hi — saw the ${job.title} role at ${company}. ${proof} Open to a quick chat?`
        .slice(0, 300);
    const linkedinOutreachCuriosity = `Curious how ${company} is approaching ${job.title} this year — my background includes ${groundedSkills.join(", ") || role.title || "related work"}, and I would love to compare notes.`
        .slice(0, 300);

    return {
        coverLetter: `Dear Hiring Team,\n\nI am applying for the ${job.title} role at ${company}. My verified experience in ${groundedSkills.join(", ") || role.title || "the relevant field"} maps to this opening.\n\nHighlights:\n- ${topBullets.join("\n- ")}\n\nI would welcome a conversation about how I can contribute.\n\nBest regards,\n${resume.fullName}`,
        resumeSummary: resume.summary,
        modifiedBullets: topBullets,
        modifiedBulletsByRole: (resume.experience || []).map((role) => ({
            company: role.company,
            title: role.title,
            bullets: role.bullets || []
        })),
        outreachEmail: `Hi there,\n\nI noticed the ${job.title} opening at ${company}. My background in ${groundedSkills.join(", ") || role.title || "related work"} appears relevant. Would you be open to a quick chat?\n\nThanks,\n${resume.fullName}`,
        linkedinOutreachNote,
        linkedinOutreachCuriosity,
        extraSkills: [],
        keywordsToEmphasize: (resume.skills || []).slice(0, 6)
    };
}

function clampLinkedInNote(note = "") {
    return normalizeLineBreaks(note).trim().slice(0, 300);
}

function normalizeTailoredCopy(tailored) {
    return {
        ...tailored,
        coverLetter: normalizeLineBreaks(tailored.coverLetter || ""),
        resumeSummary: normalizeLineBreaks(tailored.resumeSummary || ""),
        outreachEmail: normalizeLineBreaks(tailored.outreachEmail || ""),
        linkedinOutreachNote: clampLinkedInNote(tailored.linkedinOutreachNote),
        linkedinOutreachCuriosity: clampLinkedInNote(tailored.linkedinOutreachCuriosity)
    };
}

function groundedTailoringSkills(tailored, resume) {
    const candidateSkills = [
        ...(resume.skills || []),
        ...(resume.keywords || []),
        ...Object.values(resume.skillGroups || {}).flat()
    ];
    return {
        ...tailored,
        extraSkills: filterClaimableSkills(tailored.extraSkills || [], candidateSkills),
        keywordsToEmphasize: filterClaimableSkills(tailored.keywordsToEmphasize || [], candidateSkills)
    };
}

export async function scoreJob(job, resume = loadMasterResume(), options = {}) {
    const deterministic = options.deterministic
        ? applyNoticeCompatibility({
            ...options.deterministic,
            aiEscalated: false,
            ...extractNoticeHeuristic(job.description)
        }, resume)
        : heuristicScore(job, resume, options);
    // AI may refine an eligible score, but it must never rescue an explicit
    // hard conflict from the versioned deterministic policy.
    if (deterministic.eligibility?.status === "INELIGIBLE") return deterministic;
    if (currentPlan().aiCallsPerDay <= 0 || !canUseAiProcessing(getCandidateProfile())) return deterministic;
    if (!env.openaiApiKey) {
        console.warn("[openai] No OPENAI_API_KEY — using heuristic scoring");
        return deterministic;
    }
    if (!shouldEscalateToAi(deterministic)) {
        return {
            ...deterministic,
            scoringMethod: "MATCHING_POLICY_V1",
            aiEscalated: false,
            explanation: `${deterministic.explanation} OpenAI was skipped because deterministic confidence was ${(Number(deterministic.confidence || 0) * 100).toFixed(0)}%.`
        };
    }

    let aiUsage = null;
    try {
        const openai = getClient();
        const completion = await openai.beta.chat.completions.parse({
            model: env.openaiModel,
            temperature: 0.2,
            messages: [
                {
                    role: "system",
                    content: [
                        "You are a strict technical recruiter assistant for Indian software hiring.",
                        "Score job fit honestly from 0-100 using only the candidate resume facts. Prefer precision over optimism.",
                        "Treat requirements joined by 'or' as alternatives: once one listed alternative is evidenced, do not report the other alternatives as missing. Never list a skill as missing when it appears explicitly in the resume, including experience bullets.",
                        INDIA_LPA_SYSTEM_RULES,
                        "Also extract noticePeriodRequired / noticePeriodRequiredDays / immediateJoiner from the job text for UI tags.",
                        noticeFilterEnabled()
                            ? "If the employer demands immediate joiners or a max notice shorter than the candidate's noticePeriodDays, set recommendation to skip and keep matchScore ≤ 40 even if skills match perfectly."
                            : "Do not penalize or skip based on notice period. Extract notice fields only; they are informational.",
                        "Provide 3 actionable coaching nudges to improve the candidate's fit (e.g., 'Add Kafka to your resume — it appears 5× in this JD and you have similar pub/sub experience')."
                    ].join(" ")
                },

                {
                    role: "user",
                    content: JSON.stringify({
                        market: env.market,
                        targetTitles: getCandidateProfile().targetRoles?.length
                            ? getCandidateProfile().targetRoles
                            : env.targetTitles,
                        targetLocations: env.targetLocations,
                        compensationGuidance: INDIA_LPA_SYSTEM_RULES,
                        candidateNoticePeriodDays: noticeFilterEnabled() ? candidateNoticeDays(resume) : 0,
                        noticeFilterEnabled: noticeFilterEnabled(),
                        noticeGuidance: noticeFilterEnabled()
                            ? "Indian roles often require immediate joiners or max 15/30 day notice. Extract noticePeriodRequiredDays (0 = immediate). Null only if truly unstated. Unstated notice must NOT reduce the score."
                            : "Extract noticePeriodRequiredDays for display (0 = immediate, null if unstated). Do not use notice to skip or lower the score.",
                        resume,
                        deterministicAssessment: deterministic,
                        job: {
                            title: job.title,
                            company: job.company_name || job.company,
                            location: job.location,
                            description: String(job.description || "").slice(0, 8000)
                        }
                    })
                }
            ],
            response_format: zodResponseFormat(MatchEvaluationSchema, "match_evaluation")
        });
        aiUsage = completion.usage;

        const parsed = completion.choices[0]?.message?.parsed;
        if (!parsed) {
            throw new Error("OpenAI returned empty match evaluation");
        }
        const modelAnalysis = reconcileModelSkillClaims(MatchEvaluationSchema.parse(parsed), job, resume);
        const blendedScore = Math.round((Number(deterministic.matchScore || 0) * 0.45) + (Number(modelAnalysis.matchScore || 0) * 0.55));
        const analysis = {
            ...modelAnalysis,
            matchScore: blendedScore,
            confidence: Math.max(0.72, Number(deterministic.confidence || 0)),
            scoringMethod: "AI_ESCALATED_HYBRID_V2",
            aiEscalated: true,
            deterministicScore: deterministic.matchScore,
            modelScore: modelAnalysis.matchScore,
            eligibility: deterministic.eligibility,
            reasons: deterministic.reasons,
            gaps: deterministic.gaps,
            unknowns: deterministic.unknowns,
            versions: deterministic.versions,
            dimensions: deterministic.dimensions,
            experienceCompatible: deterministic.experienceCompatible,
            minimumExperienceYears: deterministic.minimumExperienceYears,
            candidateExperienceYears: deterministic.candidateExperienceYears,
            transferableSkills: deterministic.transferableSkills || [],
            breakdown: deterministic.breakdown || {}
        };
        recordAiCall({ operation: "job_scoring", model: env.openaiModel, usage: aiUsage });
        if (analysis.noticePeriodRequiredDays == null) {
            const fallback = extractNoticeHeuristic(job.description);
            return applyNoticeCompatibility({ ...analysis, ...fallback }, resume);
        }
        return applyNoticeCompatibility(analysis, resume);
    } catch (error) {
        recordAiCall({ operation: "job_scoring", model: env.openaiModel, usage: aiUsage, succeeded: false });
        console.error("[openai:scoreJob]", error.message);
        return deterministic;
    }
}

export async function tailorApplication(job, resume = loadMasterResume(), analysis = null) {
    if (currentPlan().aiCallsPerDay <= 0 || !canUseAiProcessing(getCandidateProfile())) return heuristicTailoring(job, resume);
    if (!env.openaiApiKey) {
        console.warn("[openai] No OPENAI_API_KEY — using heuristic tailoring");
        return normalizeTailoredCopy(heuristicTailoring(job, resume));
    }

    let aiUsage = null;
    try {
        const openai = getClient();
        const completion = await openai.beta.chat.completions.parse({
            model: env.openaiModel,
            temperature: 0.4,
            messages: [
                {
                    role: "system",
                    content: [
                        "You customize resumes and cover letters for the Indian tech job market.",
                        "Never invent employers, dates, or skills. Only rephrase and reorder real experience.",
                        INDIA_LPA_SYSTEM_RULES
                    ].join(" ")
                },
                {
                    role: "user",
                    content: JSON.stringify({
                        market: env.market,
                        resume,
                        analysis,
                        job: {
                            title: job.title,
                            company: job.company_name || job.company,
                            location: job.location,
                            description: String(job.description || "").slice(0, 8000)
                        },
                        instructions: {
                            coverLetter: "250-400 words, specific to the job; use INR/LPA if salary is mentioned",
                            modifiedBullets:
                                "4-6 strong bullets for the most relevant recent role, grounded in resume experience",
                            modifiedBulletsByRole:
                                "Rewrite bullets for EVERY experience role (not just the latest). Keep facts, dates, employers. Reorder/rephrase to match the JD.",
                            extraSkills:
                                "3-8 adjacent JD keywords the candidate can honestly list (skills they already have or closely related). Never invent employers.",
                            outreachEmail: "short recruiter cold email under 120 words",
                            linkedinOutreachNote:
                                "Proof-first LinkedIn note: one concrete result (scale, latency, cost). STRICT max 300 characters.",
                            linkedinOutreachCuriosity:
                                "Curiosity-hook LinkedIn note: ask about their stack/scale. STRICT max 300 characters. Different from the proof note."
                        }
                    })
                }
            ],
            response_format: zodResponseFormat(TailoringSchema, "application_tailoring")
        });
        aiUsage = completion.usage;

        const parsed = completion.choices[0]?.message?.parsed;
        if (!parsed) {
            throw new Error("OpenAI returned empty tailoring payload");
        }
        const tailored = TailoringSchema.parse(parsed);
        recordAiCall({ operation: "resume_tailoring", model: env.openaiModel, usage: aiUsage });
        return normalizeTailoredCopy(groundedTailoringSkills(tailored, resume));
    } catch (error) {
        recordAiCall({ operation: "resume_tailoring", model: env.openaiModel, usage: aiUsage, succeeded: false });
        console.error("[openai:tailorApplication]", error.message);
        return normalizeTailoredCopy(heuristicTailoring(job, resume));
    }
}

export function selectPendingJobsForProcessing(db, { limit = 25, jobIds = null } = {}) {
    const ids = Array.isArray(jobIds) ? [...new Set(jobIds.filter(Boolean))] : null;
    if (ids && ids.length === 0) {
        return [];
    }
    const idFilter = ids ? `AND j.id IN (${ids.map(() => "?").join(", ")})` : "";
    return db.prepare(
        `
            SELECT j.*, c.name AS company_name
            FROM jobs j
            LEFT JOIN companies c ON c.id = j.company_id
            WHERE j.status = 'PENDING'
              AND COALESCE(j.lifecycle_status, 'UNKNOWN') != 'CLOSED'
              AND COALESCE(NULLIF(j.posted_at, ''), j.created_at) >= datetime('now', '-' || ? || ' days')
              ${idFilter}
            ORDER BY COALESCE(NULLIF(j.posted_at, ''), j.created_at) DESC,
                     j.created_at DESC
            LIMIT ?
        `
    ).all(env.ingestion.maxJobAgeDays, ...(ids || []), limit);
}

function recordScoreEvent(db, job, {
    preScore, finalScore, confidence, scoringMethod, aiEscalated, outcome, breakdown
}) {
    db.prepare(`INSERT INTO job_score_events
        (id, job_id, source, pre_score, final_score, confidence, scoring_method,
         ai_escalated, outcome, breakdown_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), job.id, job.source || "unknown", preScore, finalScore,
            confidence, scoringMethod, aiEscalated ? 1 : 0, outcome,
            JSON.stringify(breakdown || {}));
}

export async function processPendingJobs({ limit = 25, jobIds = null } = {}) {
    const db = getDb();
    const resume = loadMasterResume();
    const evidenceProfile = getCandidateProfile();
    const searchProfile = getCandidateSearchProfile();
    const profile = { ...evidenceProfile, ...searchProfile, profileVersion: searchProfile.profileVersion };
    const corpus = recentJobCorpus(db);
    const pending = selectPendingJobsForProcessing(db, { limit, jobIds });
    if (!pending.length && Array.isArray(jobIds) && jobIds.length === 0) {
        return { scanned: 0, matched: 0, close: 0, prefiltered: 0, rejected: 0, failed: 0 };
    }

    let matched = 0;
    let close = 0;
    let prefiltered = 0;
    let rejected = 0;
    let failed = 0;

    const update = db.prepare(
        `
        UPDATE jobs
        SET match_score = @matchScore,
            pre_score = @preScore,
            ai_analysis = @aiAnalysis,
            career_family = @careerFamily,
            career_track = @careerTrack,
            scoring_method = @scoringMethod,
            scoring_confidence = @scoringConfidence,
            matching_breakdown_json = @matchingBreakdown,
            cover_letter = @coverLetter,
            resume_modifications = @resumeModifications,
            generated_resume_path = NULL,
            notice_period_required = @noticePeriodRequired,
            notice_period_days = @noticePeriodDays,
            yoe_min = COALESCE(@yoeMin, yoe_min),
            ctc_min_lpa = COALESCE(@ctcMinLpa, ctc_min_lpa),
            ctc_max_lpa = COALESCE(@ctcMaxLpa, ctc_max_lpa),
            work_mode = COALESCE(@workMode, work_mode),
            has_esops = COALESCE(@hasEsops, has_esops),
            has_bond = COALESCE(@hasBond, has_bond),
            status = @status
        WHERE id = @id
        `
    );

    for (const job of pending) {
        try {
            const tags = extractJobTags(job);
            const pre = preScoreJob(job, resume, { profile, corpus });
            const classification = classifyJobTitle(job.title);

            if (pre.heuristic.eligibility?.status === "INELIGIBLE") {
                rejected += 1;
                const analysis = { ...pre.heuristic, preScore: pre.preScore };
                update.run({
                    id: job.id,
                    matchScore: pre.preScore,
                    preScore: pre.preScore,
                    aiAnalysis: JSON.stringify(analysis),
                    careerFamily: classification.family,
                    careerTrack: classification.track,
                    scoringMethod: "MATCHING_POLICY_V1",
                    scoringConfidence: pre.confidence,
                    matchingBreakdown: JSON.stringify(pre.breakdown || {}),
                    coverLetter: null,
                    resumeModifications: null,
                    noticePeriodRequired: null,
                    noticePeriodDays: null,
                    yoeMin: tags.yoeMin,
                    ctcMinLpa: tags.ctcMinLpa,
                    ctcMaxLpa: tags.ctcMaxLpa,
                    workMode: tags.workMode,
                    hasEsops: tags.hasEsops,
                    hasBond: tags.hasBond,
                    status: "REJECTED"
                });
                recordScoreEvent(db, job, {
                    preScore: pre.preScore, finalScore: pre.preScore, confidence: pre.confidence,
                    scoringMethod: "MATCHING_POLICY_V1", aiEscalated: false,
                    outcome: "REJECTED", breakdown: pre.breakdown
                });
                continue;
            }

            if (pre.preScore < env.prefilterMinScore) {
                prefiltered += 1;
                update.run({
                    id: job.id,
                    matchScore: pre.preScore,
                    preScore: pre.preScore,
                    aiAnalysis: JSON.stringify({
                        matchScore: pre.preScore,
                        explanation: `Pre-filter skipped OpenAI (deterministic policy score ${pre.preScore} < ${env.prefilterMinScore}). Matched: ${pre.matchedSkills.join(", ") || "none"}.`,
                        matchedSkills: pre.matchedSkills,
                        missingSkills: [],
                        recommendation: "skip",
                        prefiltered: true,
                        scoringMethod: "MATCHING_POLICY_PREFILTER_V1",
                        confidence: pre.confidence,
                        breakdown: pre.breakdown,
                        transferableSkills: pre.transferableSkills
                    }),
                    careerFamily: classification.family,
                    careerTrack: classification.track,
                    scoringMethod: "MATCHING_POLICY_PREFILTER_V1",
                    scoringConfidence: pre.confidence,
                    matchingBreakdown: JSON.stringify(pre.breakdown || {}),
                    coverLetter: null,
                    resumeModifications: null,
                    noticePeriodRequired: null,
                    noticePeriodDays: null,
                    yoeMin: tags.yoeMin,
                    ctcMinLpa: tags.ctcMinLpa,
                    ctcMaxLpa: tags.ctcMaxLpa,
                    workMode: tags.workMode,
                    hasEsops: tags.hasEsops,
                    hasBond: tags.hasBond,
                    status: "PREFILTERED"
                });
                recordScoreEvent(db, job, {
                    preScore: pre.preScore, finalScore: pre.preScore, confidence: pre.confidence,
                    scoringMethod: "MATCHING_POLICY_PREFILTER_V1", aiEscalated: false,
                    outcome: "PREFILTERED", breakdown: pre.breakdown
                });
                continue;
            }

            const analysis = await scoreJob(job, resume, { deterministic: pre.heuristic, profile, corpus });
            const noticeBlocked = noticeFilterEnabled() && analysis.noticeCompatible === false;
            const policyBlocked = analysis.eligibility?.status === "INELIGIBLE";
            const score = Math.round(analysis.matchScore);
            let status = "REJECTED";
            if (!noticeBlocked && !policyBlocked && score >= env.matchThreshold) {
                status = "MATCHED";
            } else if (!noticeBlocked && !policyBlocked && score >= env.closeMinScore) {
                status = "CLOSE";
            }

            let coverLetter = null;
            let resumeModifications = null;

            if (status === "MATCHED" || status === "CLOSE") {
                // Tailoring is deliberately lazy. Discovery/ranking should not
                // spend model tokens on a job the candidate never opens.
                if (status === "MATCHED") matched += 1;
                else close += 1;
            } else {
                rejected += 1;
            }

            update.run({
                id: job.id,
                matchScore: score,
                preScore: pre.preScore,
                aiAnalysis: JSON.stringify({ ...analysis, preScore: pre.preScore }),
                careerFamily: classification.family,
                careerTrack: classification.track,
                scoringMethod: analysis.scoringMethod || "MATCHING_POLICY_V1",
                scoringConfidence: analysis.confidence ?? pre.confidence,
                matchingBreakdown: JSON.stringify(analysis.breakdown || pre.breakdown || {}),
                coverLetter,
                resumeModifications,
                noticePeriodRequired: analysis.noticePeriodRequired || null,
                noticePeriodDays:
                    analysis.noticePeriodRequiredDays === null ||
                    analysis.noticePeriodRequiredDays === undefined
                        ? null
                        : Number(analysis.noticePeriodRequiredDays),
                yoeMin: tags.yoeMin,
                ctcMinLpa: tags.ctcMinLpa,
                ctcMaxLpa: tags.ctcMaxLpa,
                workMode: tags.workMode,
                hasEsops: tags.hasEsops,
                hasBond: tags.hasBond,
                status
            });
            recordScoreEvent(db, job, {
                preScore: pre.preScore, finalScore: score,
                confidence: analysis.confidence ?? pre.confidence,
                scoringMethod: analysis.scoringMethod || "MATCHING_POLICY_V1",
                aiEscalated: Boolean(analysis.aiEscalated), outcome: status,
                breakdown: analysis.breakdown || pre.breakdown
            });
        } catch (error) {
            failed += 1;
            console.error(`[openai] Failed processing job ${job.id}:`, error.message);
        }
    }

    return { scanned: pending.length, matched, close, prefiltered, rejected, failed };
}

export async function createEmbedding(text, profile = getCandidateProfile()) {
    if (currentPlan().aiCallsPerDay <= 0 || !canUseAiProcessing(profile)) return null;
    if (!env.openaiApiKey) return null;
    const openai = getClient();
    let aiUsage = null;
    try {
        const res = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: String(text).trim().slice(0, 8000)
        });
        aiUsage = res.usage;
        recordAiCall({ operation: "question_embedding", model: "text-embedding-3-small", usage: aiUsage });
        return res.data[0].embedding;
    } catch (err) {
        recordAiCall({ operation: "question_embedding", model: "text-embedding-3-small", usage: aiUsage, succeeded: false });
        console.error('[openai:embedding] failed', err.message);
        return null;
    }
}

/** Shared, value-free embeddings used by the canonical field registry. */
export async function createSharedCanonicalEmbeddings(inputs = []) {
    const values = (Array.isArray(inputs) ? inputs : [inputs]).map((value) => String(value || "").trim().slice(0, 1200)).filter(Boolean);
    if (!values.length || !env.openaiApiKey || !env.canonicalization.embeddingsEnabled) return [];
    const openai = getClient();
    let aiUsage = null;
    try {
        const response = await openai.embeddings.create({ model: "text-embedding-3-small", input: values });
        aiUsage = response.usage;
        recordAiCall({ operation: "shared_field_canonical_embedding", model: "text-embedding-3-small", usage: aiUsage });
        return response.data.sort((left, right) => left.index - right.index).map((item) => item.embedding);
    } catch (error) {
        recordAiCall({ operation: "shared_field_canonical_embedding", model: "text-embedding-3-small", usage: aiUsage, succeeded: false });
        console.error("[openai:canonical-embedding] failed", error.message);
        return [];
    }
}

/**
 * The caller supplies only a validated field-semantic payload. This operation
 * never receives candidate answers, profile data, resume text, or raw HTML.
 */
export async function resolveFieldCanonicalWithAi(payload, { rich = false } = {}) {
    if (!env.openaiApiKey || !env.canonicalization.aiEnabled) return null;
    const openai = getClient();
    let aiUsage = null;
    try {
        const completion = await openai.beta.chat.completions.parse({
            model: env.openaiModel,
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content: [
                        "You classify one job-application form field by meaning.",
                        "Use only the supplied value-free field structure; never infer or return a candidate answer.",
                        "Prefer an existing canonical from candidate_canonicals whenever it represents the same concept.",
                        "Do not create synonyms or spelling variants of an existing canonical.",
                        "Return NEW_CANONICAL_REQUIRED only when none of the candidates represents the concept.",
                        "Return UNRESOLVED when the field is generic, ambiguous, unsafe, or context is insufficient.",
                        rich ? "This is the bounded rich-context pass; make a final cautious decision." : "Set needsMoreContext=true when section and nearest labels are insufficient."
                    ].join(" ")
                },
                { role: "user", content: JSON.stringify(payload) }
            ],
            response_format: zodResponseFormat(FieldCanonicalizationSchema, "field_canonicalization")
        });
        aiUsage = completion.usage;
        recordAiCall({ operation: rich ? "shared_field_canonicalization_rich" : "shared_field_canonicalization_compact",
            model: env.openaiModel, usage: aiUsage });
        const parsed = completion.choices[0]?.message?.parsed;
        return parsed ? FieldCanonicalizationSchema.parse(parsed) : null;
    } catch (error) {
        recordAiCall({ operation: rich ? "shared_field_canonicalization_rich" : "shared_field_canonicalization_compact",
            model: env.openaiModel, usage: aiUsage, succeeded: false });
        console.error("[openai:field-canonicalization] failed", error.message);
        return null;
    }
}

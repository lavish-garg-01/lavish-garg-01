import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { env } from "../config/environment.js";
import { canUseAiApplicationAnswers, isSensitiveApplicationField, minimizedProfileForAi } from "./privacyPolicy.js";
import { recordAiCall } from "./aiTelemetry.js";

const GroundedAnswerSchema = z.object({
    answer: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string(),
    reusable: z.boolean(),
    requiresUserInput: z.boolean()
});

const SENSITIVE_FACT_PATTERN = /\b(?:captcha|verification\s+(?:code|challenge)|citizen|visa|work\s*authori[sz]ation|sponsor|security\s*clearance|criminal|conviction|disab|veteran|gender|race|ethnicity|religion|marital|pregnan|medical|health|background\s*check|terms|privacy|consent|certif(?:y|ication)|signature|accurate and complete)\b/i;

let client = null;

function openaiClient() {
    if (!env.openaiApiKey) return null;
    if (!client) client = new OpenAI({ apiKey: env.openaiApiKey });
    return client;
}

function monthIndex(value, now = new Date()) {
    if (!value || /^present$/i.test(String(value))) return now.getUTCFullYear() * 12 + now.getUTCMonth();
    const match = String(value).match(/^(\d{4})-(\d{2})/);
    if (!match) return null;
    return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function mergedMonths(intervals = []) {
    const sorted = intervals
        .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end >= item.start)
        .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const interval of sorted) {
        const previous = merged.at(-1);
        if (!previous || interval.start > previous.end + 1) merged.push({ ...interval });
        else previous.end = Math.max(previous.end, interval.end);
    }
    return merged.reduce((sum, interval) => sum + interval.end - interval.start + 1, 0);
}

export function deriveTechnologyExperienceYears(resume = {}, technology = "Node.js", now = new Date()) {
    const escaped = technology.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\.js$/i, "(?:\\.?js)?");
    const technologyPattern = technology.toLowerCase().startsWith("node")
        ? /\bnode(?:\.?js)?\b/i
        : new RegExp(`\\b${escaped}\\b`, "i");
    const roles = Array.isArray(resume.experience) ? resume.experience : [];
    const explicitCompanies = new Set(
        roles
            .filter((role) => technologyPattern.test(`${role.title || ""} ${(role.bullets || []).join(" ")}`))
            .map((role) => String(role.company || "").trim().toLowerCase())
            .filter(Boolean)
    );
    const supportingRoles = roles.filter((role) => {
        const text = `${role.title || ""} ${(role.bullets || []).join(" ")}`;
        if (technologyPattern.test(text)) return true;
        const sameCompany = explicitCompanies.has(String(role.company || "").trim().toLowerCase());
        return sameCompany && /backend|software|developer|engineer|team\s*lead/i.test(String(role.title || ""));
    });
    const intervals = supportingRoles.map((role) => ({
        start: monthIndex(role.startDate, now),
        end: monthIndex(role.endDate, now)
    }));
    const months = mergedMonths(intervals);
    if (!months) return null;
    const years = Math.max(0.5, Math.floor((months / 12) * 2) / 2);
    const roleEvidence = supportingRoles.map((role) => `${role.title} at ${role.company} (${role.startDate}–${role.endDate})`).join("; ");
    return {
        answer: String(years),
        confidence: explicitCompanies.size ? 0.94 : 0.7,
        evidence: `${technology} evidence and continuous related employment: ${roleEvidence}. Calculated ${months} month(s), conservatively rounded down to ${years} year(s).`,
        reusable: true,
        requiresUserInput: false,
        source: "RESUME_DERIVED"
    };
}

function parsedJson(raw, fallback = {}) {
    if (!raw) return fallback;
    if (typeof raw === "object") return raw;
    try { return JSON.parse(raw) || fallback; } catch { return fallback; }
}

function groundedFallback(question, { job = {}, resume = {} } = {}) {
    if (/node\.?js.*experience|experience.*node\.?js/i.test(question)) {
        return deriveTechnologyExperienceYears(resume, "Node.js");
    }
    if (/why.*(?:interested|join|role)|cover\s*note/i.test(question)) {
        const analysis = parsedJson(job.ai_analysis);
        const modifications = parsedJson(job.resume_modifications);
        const strengths = (analysis.matchedSkills || []).slice(0, 3).join(", ");
        const focus = modifications.resumeSummary || resume.summary || "my backend engineering experience";
        return {
            answer: `I am interested in the ${job.title || "role"} at ${job.company_name || "your company"} because it aligns with ${strengths || "my relevant experience"}. ${focus}`.slice(0, 900),
            confidence: 0.82,
            evidence: "Generated from the scored job, matched skills, and tailored resume summary.",
            reusable: false,
            requiresUserInput: false,
            source: "GROUNDED_TEMPLATE"
        };
    }
    return null;
}

export async function generateGroundedApplicationAnswer(question, context = {}) {
    if (SENSITIVE_FACT_PATTERN.test(question) || isSensitiveApplicationField(context.field)) {
        return {
            answer: null,
            confidence: 0,
            evidence: "This is a sensitive or legally significant fact that must be confirmed by the candidate.",
            reusable: false,
            requiresUserInput: true,
            source: "USER_REQUIRED"
        };
    }

    const deterministic = groundedFallback(question, context);
    if (deterministic && /node\.?js.*experience|experience.*node\.?js/i.test(question)) return deterministic;
    if (!canUseAiApplicationAnswers(context.profile)) {
        return deterministic || {
            answer: null,
            confidence: 0,
            evidence: "AI-generated application answers are off on Free and require Pro. Deterministic answers from verified facts remain available, and you still review and submit.",
            reusable: false,
            requiresUserInput: true,
            source: "USER_REQUIRED"
        };
    }
    const openai = openaiClient();
    if (!openai) return deterministic;

    let aiUsage = null;
    try {
        const { job = {}, profile = {}, resume = {}, field = {} } = context;
        const completion = await openai.beta.chat.completions.parse({
            model: env.openaiModel,
            temperature: 0.1,
            messages: [
                {
                    role: "system",
                    content: [
                        "Answer a job-application question using only the supplied candidate profile, resume, and computed job context.",
                        "Never invent, exaggerate, or change a fact to satisfy the job requirement.",
                        "If evidence is insufficient, require user input.",
                        "For numeric fields return only a valid number. Keep text answers concise, specific, professional, and in first person.",
                        "Mark reusable=true only for stable candidate facts that should be reused unchanged across employers. Motivation answers are job-specific."
                    ].join(" ")
                },
                {
                    role: "user",
                    content: JSON.stringify({
                        question,
                        field: { type: field.type, options: field.options || [] },
                        profile: minimizedProfileForAi(profile),
                        resume,
                        job: {
                            title: job.title,
                            company: job.company_name,
                            location: job.location,
                            description: String(job.description || "").slice(0, 5000),
                            analysis: parsedJson(job.ai_analysis),
                            tailoredResume: parsedJson(job.resume_modifications)
                        }
                    })
                }
            ],
            response_format: zodResponseFormat(GroundedAnswerSchema, "grounded_application_answer")
        });
        aiUsage = completion.usage;
        const result = completion.choices[0]?.message?.parsed;
        if (!result) {
            recordAiCall({ operation: "grounded_application_answer", model: env.openaiModel, usage: aiUsage, succeeded: false });
            return deterministic;
        }
        recordAiCall({ operation: "grounded_application_answer", model: env.openaiModel, usage: aiUsage });
        return { ...result, source: "AI_GROUNDED" };
    } catch (error) {
        recordAiCall({ operation: "grounded_application_answer", model: env.openaiModel, usage: aiUsage, succeeded: false });
        console.error("[applicationAnswerer]", error.message);
        return deterministic;
    }
}

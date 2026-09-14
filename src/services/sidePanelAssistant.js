import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { env } from "../config/environment.js";
import { canUseAiApplicationAnswers, isSensitiveApplicationField, minimizedProfileForAi } from "./privacyPolicy.js";
import { recordAiCall } from "./aiTelemetry.js";

const AssistantAnswerSchema = z.object({
    answer: z.string().min(1).max(1600),
    grounded: z.boolean(),
    copyReady: z.boolean(),
    needsCandidateInput: z.boolean(),
    safety: z.enum(["SAFE", "EXPLAIN_ONLY", "CANDIDATE_REQUIRED"]),
    evidence: z.array(z.string()).min(1).max(6)
});

let client = null;

function openaiClient() {
    if (!env.openaiApiKey) return null;
    if (!client) client = new OpenAI({ apiKey: env.openaiApiKey });
    return client;
}

function result(answer, overrides = {}) {
    return {
        answer,
        grounded: true,
        copyReady: false,
        needsCandidateInput: false,
        safety: "SAFE",
        evidence: [],
        source: "LOCAL_CONTEXT",
        ...overrides
    };
}

function asksFor(question, pattern) {
    return /^(?:please\s+)?(?:what(?:'s|\s+is)|show|give|tell|copy|remind)\b/i.test(question.trim()) && pattern.test(question);
}

function localProfileAnswer(question, profile = {}) {
    const definitions = [
        { pattern: /\bemail(?:\s+address)?\b/i, value: profile.email, label: "saved email" },
        { pattern: /\b(?:phone|mobile)(?:\s+number)?\b/i, value: profile.phone, label: "saved phone number" },
        { pattern: /\blinkedin\b/i, value: profile.linkedinUrl, label: "saved LinkedIn profile" },
        { pattern: /\bgithub\b/i, value: profile.githubUrl, label: "saved GitHub profile" },
        { pattern: /\bportfolio\b/i, value: profile.portfolioUrl, label: "saved portfolio" },
        { pattern: /\b(?:current\s+)?location\b/i, value: profile.currentLocation, label: "saved current location" },
        { pattern: /\bcurrent\s+company\b/i, value: profile.currentCompany, label: "saved current company" },
        { pattern: /\bnotice\s+period\b/i, value: profile.noticePeriodDays == null ? "" : `${profile.noticePeriodDays} days`, label: "saved notice period" },
        { pattern: /\bcurrent\s+(?:ctc|salary)\b/i, value: profile.currentCTC == null ? "" : `${profile.currentCTC} LPA`, label: "saved current CTC" },
        { pattern: /\bexpected\s+(?:ctc|salary)\b/i, value: profile.expectedCTC == null ? "" : `${profile.expectedCTC} LPA`, label: "saved expected CTC" },
        { pattern: /\b(?:total\s+)?experience\b/i, value: profile.totalExperienceYears == null ? "" : `${profile.totalExperienceYears} years`, label: "saved total experience" },
        { pattern: /\blegal\s+(?:family|last)\s+name\b/i, value: profile.legalLastName, label: "saved legal family name", review: true },
        { pattern: /\blegal\s+(?:first|given)\s+name\b/i, value: profile.legalFirstName, label: "saved legal first name", review: true },
        { pattern: /\bwork\s*authori[sz]ation\b/i, value: profile.workAuthorization, label: "saved work-authorization preference", review: true },
        { pattern: /\bsponsor(?:ship)?\b/i, value: profile.sponsorshipRequired, label: "saved sponsorship preference", review: true }
    ];
    const match = definitions.find((item) => item.value !== "" && item.value != null && asksFor(question, item.pattern));
    if (!match) return null;
    return result(String(match.value), {
        copyReady: !match.review,
        needsCandidateInput: Boolean(match.review),
        safety: match.review ? "CANDIDATE_REQUIRED" : "SAFE",
        evidence: [`Your ${match.label} in Job Hunter.`],
        source: "LOCAL_PROFILE"
    });
}

function localApplicationAnswer(question, application = null) {
    if (!application || !/(?:autofill|fill|failed|failure|remaining|left|review|problem|issue)/i.test(question)) return null;
    const fields = Array.isArray(application.fields) ? application.fields : [];
    const filled = fields.filter((field) => ["FILLED", "USER_EDITED"].includes(String(field.state).toUpperCase())).length;
    const unresolved = fields.filter((field) => !["FILLED", "USER_EDITED"].includes(String(field.state).toUpperCase()));
    const failures = Array.isArray(application.failures) ? application.failures : [];
    const labels = [...new Set(unresolved.map((field) => field.label).filter(Boolean))].slice(0, 8);
    const failureText = failures.length
        ? ` Recorded failures: ${failures.slice(0, 4).map((item) => `${item.phase}: ${item.errorCode || item.reason || "failed"}`).join("; ")}.`
        : "";
    return result(`COPILOT completed ${filled} of ${fields.length} observed fields. ${unresolved.length} remain unresolved${labels.length ? `: ${labels.join(", ")}` : ""}.${failureText}`, {
        evidence: ["Latest application attempt and field-result timeline."],
        source: "LOCAL_APPLICATION"
    });
}

function safeResume(resume = {}) {
    return {
        summary: resume.summary || "",
        skills: (resume.skills || []).slice(0, 120),
        experience: (resume.experience || []).slice(0, 16).map((item) => ({
            company: item.company || "",
            title: item.title || "",
            startDate: item.startDate || "",
            endDate: item.endDate || "",
            bullets: (item.bullets || []).slice(0, 10)
        })),
        projects: (resume.projects || []).slice(0, 12).map((item) => ({
            name: item.name || item.title || "",
            description: item.description || "",
            bullets: (item.bullets || []).slice(0, 8)
        })),
        education: (resume.education || []).slice(0, 8).map((item) => ({
            school: item.school || item.institution || "",
            degree: item.degree || "",
            field: item.field || item.fieldOfStudy || "",
            startDate: item.startDate || "",
            endDate: item.endDate || ""
        }))
    };
}

function redactDirectIdentifiers(question) {
    return String(question || "")
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
        .replace(/(?:\+?\d[\s().-]*){8,15}/g, "[phone redacted]")
        .slice(0, 2000);
}

export async function answerSidePanelQuestion(question, context = {}) {
    const cleanQuestion = String(question || "").trim();
    if (cleanQuestion.length < 2) throw new Error("Ask a complete question.");
    if (cleanQuestion.length > 2000) throw new Error("Keep the question under 2,000 characters.");

    const profileAnswer = localProfileAnswer(cleanQuestion, context.profile);
    if (profileAnswer) return profileAnswer;
    const applicationAnswer = localApplicationAnswer(cleanQuestion, context.application);
    if (applicationAnswer) return applicationAnswer;

    const sensitive = isSensitiveApplicationField({ label: cleanQuestion });
    const explainOnly = sensitive && /\b(?:explain|meaning|mean|what\s+does|what\s+is|help\s+me\s+understand)\b/i.test(cleanQuestion);
    if (sensitive && !explainOnly) {
        return result("This asks for a sensitive or legally significant decision. I can explain the field, but I will not choose, attest, sign, or invent the answer for you.", {
            grounded: false,
            needsCandidateInput: true,
            safety: "CANDIDATE_REQUIRED",
            evidence: ["Protected-field safety policy."],
            source: "SAFETY_GUARD"
        });
    }

    if (!canUseAiApplicationAnswers(context.profile)) {
        return result("AI enhancement is off on Free and requires Pro. Verified profile facts and deterministic autofill remain available.", {
            grounded: false,
            needsCandidateInput: true,
            source: "AI_DISABLED"
        });
    }

    const openai = openaiClient();
    if (!openai) {
        return result("The local service has no OpenAI API key configured. Add the key and restart Job Hunter to use Ask AI.", {
            grounded: false,
            needsCandidateInput: true,
            source: "AI_UNAVAILABLE"
        });
    }

    const visibleFields = (context.application?.fields || [])
        .filter((field) => !field.sensitive && !isSensitiveApplicationField({ label: field.label, type: field.type }))
        .slice(0, 80);
    let usage = null;
    try {
        const completion = await openai.beta.chat.completions.parse({
            model: env.openaiModel,
            temperature: 0.1,
            messages: [
                {
                    role: "system",
                    content: [
                        "You are Job Hunter's grounded application assistant.",
                        "Use only the supplied verified candidate, resume, job, and current-form context.",
                        "Never invent experience, skills, compensation, identity, URLs, employment, education, or employer history.",
                        "If evidence is missing, say exactly what the candidate must provide.",
                        "Never choose legal attestations, consent, demographic/self-ID, health/disability, government-ID, work-authorization, sponsorship, CAPTCHA, OTP, password, or signature answers.",
                        "For a sensitive-field explanation, explain neutral meaning only and set safety=EXPLAIN_ONLY, copyReady=false, needsCandidateInput=true.",
                        "For copy-ready application prose, keep it concise, first-person, job-specific, and factually grounded.",
                        "Do not claim that anything was submitted or filled. The candidate controls final review and submission."
                    ].join(" ")
                },
                {
                    role: "user",
                    content: JSON.stringify({
                        question: redactDirectIdentifiers(cleanQuestion),
                        requestedMode: explainOnly ? "EXPLAIN_SENSITIVE_TERM_ONLY" : "GROUNDED_HELP",
                        profile: minimizedProfileForAi(context.profile || {}),
                        resume: safeResume(context.resume),
                        job: context.job ? {
                            title: context.job.title || "",
                            company: context.job.company_name || context.job.company || "",
                            location: context.job.location || "",
                            description: String(context.job.description || "").slice(0, 6000),
                            matchScore: context.job.match_score ?? null,
                            analysis: String(context.job.ai_analysis || "").slice(0, 4000)
                        } : null,
                        application: context.application ? {
                            status: context.application.status || "",
                            pageHost: context.application.pageHost || "",
                            fields: visibleFields.map((field) => ({
                                label: field.label,
                                semanticKey: field.semanticKey || null,
                                type: field.type,
                                state: field.state,
                                required: Boolean(field.required)
                            })),
                            failures: (context.application.failures || []).slice(0, 12)
                        } : null
                    })
                }
            ],
            response_format: zodResponseFormat(AssistantAnswerSchema, "side_panel_assistant_answer")
        });
        usage = completion.usage;
        const parsed = completion.choices[0]?.message?.parsed;
        if (!parsed) throw new Error("The model returned no grounded answer.");
        recordAiCall({ operation: "sidepanel_assistant", model: env.openaiModel, usage });
        return { ...parsed, source: "AI_GROUNDED" };
    } catch (error) {
        recordAiCall({ operation: "sidepanel_assistant", model: env.openaiModel, usage, succeeded: false });
        console.error("[sidePanelAssistant]", error.message);
        return result("Ask AI could not produce a grounded answer right now. No employer form was changed; try again or use Profile quick copy.", {
            grounded: false,
            needsCandidateInput: true,
            source: "AI_ERROR"
        });
    }
}

import { findCandidateAnswer, getCandidateProfile } from "../repositories/copilotRepository.js";
import { loadResume } from "./resumeStore.js";
import { generateGroundedApplicationAnswer } from "./applicationAnswerer.js";
import { getDb } from "../database/connection.js";
import { createEmbedding } from "./openai.js";
import { classifyAgentField } from "./applicationAgent.js";
import { isSensitiveApplicationField } from "./privacyPolicy.js";
import { candidateFactStatus } from "../repositories/candidateFactRepository.js";
import { isTechnologySpecificExperience } from "./fieldOntology.js";

const QUESTION_PATTERNS = [
    [/legal\s+(?:first|given)\s+name/i, "LEGAL_FIRST_NAME"],
    [/legal\s+middle\s+name/i, "LEGAL_MIDDLE_NAME"],
    [/legal\s+(?:last|family|sur)name/i, "LEGAL_LAST_NAME"],
    [/^first\s*name$/i, "FIRST_NAME"],
    [/^last\s*name$/i, "LAST_NAME"],
    [/full\s*name|candidate\s*name|your\s*name/i, "FULL_NAME"],
    [/e-?mail/i, "EMAIL"],
    [/phone|mobile/i, "PHONE"],
    [/zip\s*code|postal\s*code|\bpin\s*code\b|\bpincode\b/i, "POSTAL_CODE"],
    [/^address\s+(?:city|town)$/i, "ADDRESS_CITY"],
    [/current\s*(location|city)|where.*located/i, "CURRENT_LOCATION"],
    [/^location$/i, "CURRENT_LOCATION"],
    [/^city$/i, "CURRENT_LOCATION"],
    [/^town$/i, "CURRENT_LOCATION"],
    [/preferred\s*(location|city)/i, "PREFERRED_LOCATIONS"],
    [/current(?:\s*\([^)]*\))?\s*(ctc|salary|compensation)/i, "CURRENT_CTC"],
    [/present\s*(ctc|salary|compensation)/i, "CURRENT_CTC"],
    [/expected\s*(ctc|salary|compensation)/i, "EXPECTED_CTC"],
    [/(?:salary|compensation)\s*expectations?/i, "EXPECTED_CTC"],
    [/current\s*company|most\s*recent\s*employer/i, "CURRENT_COMPANY"],
    [/current\s+career\s+stage|career\s+stage/i, "CURRENT_CAREER_STAGE"],
    [/current\s+industry|most\s+recent\s+industry/i, "CURRENT_INDUSTRY"],
    [/notice\s*period/i, "NOTICE_PERIOD"],
    [/last\s*working\s*date/i, "LAST_WORKING_DATE"],
    [/last\s*working\s*day/i, "LAST_WORKING_DATE"],
    [/present\s*address/i, "PRESENT_ADDRESS"],
    [/address\s*(?:line)?\s*1|street\s+address/i, "ADDRESS_LINE1"],
    [/address\s*(?:line)?\s*2|apartment|suite/i, "ADDRESS_LINE2"],
    [/^(?:state|province|region)$/i, "ADDRESS_STATE"],
    [/(?:available|start).*date|when.*(?:start|join)/i, "START_DATE"],
    [/are\s*you\s*in\b.*(?:now|currently)|willingness\s*or\s*plan\s*to\s*move/i, "RELOCATION_DETAILS"],
    [/relocat/i, "RELOCATION"],
    [/node\.?js.*experience|experience.*node\.?js/i, "NODEJS_EXPERIENCE"],
    [/aws.*experience|experience.*aws/i, "AWS_EXPERIENCE"],
    [/kafka.*experience|experience.*kafka/i, "KAFKA_EXPERIENCE"],
    [/how\s*many\s*years[^?]*exp(?:erience|ereince)|years?\s*of\s*exp(?:erience|ereince)|total.*exp(?:erience|ereince)|overall\s*exp(?:erience|ereince)/i, "TOTAL_EXPERIENCE"],
    [/^exp(?:erience|ereince)(?:\s*\(\s*(?:in\s+)?years?\s*\))?$/i, "TOTAL_EXPERIENCE"],
    [/how\s+did\s+you\s+(?:hear|learn)|source|where\s+did\s+you\s+find/i, "HEARING_SOURCE"],
    [/github(?:\s*(?:url|profile))?/i, "GITHUB_URL"],
    [/^facebook(?:\s+(?:profile|url))?$/i, "SOCIAL_FACEBOOK_URL"],
    [/^(?:x\s*\(fka\s+twitter\)|twitter|x profile)(?:\s+url)?$/i, "SOCIAL_TWITTER_URL"],
    [/website|personal\s+url|blog\s+url/i, "WEBSITE_URL"],
    [/^personal\s+summary(?:\s+use\s+it.*)?$|^professional\s+summary$|^profile\s+summary$/i, "PERSONAL_SUMMARY"],
    [/^skills?$|separate each skill with a comma/i, "SKILLS"],
    [/why.*(interested|join|role)|cover\s*note/i, "WHY_INTERESTED"]
];

// These questions are either volatile or materially sensitive. A fluent answer is not
// necessarily a truthful answer, so they must come from the profile or candidate review.
const CANDIDATE_REVIEW_KEYS = new Set([
    "CURRENT_COMPANY", "START_DATE", "RELOCATION_DETAILS", "WORK_AUTHORIZATION"
]);
const VOLATILE_KEYS = new Set(["START_DATE", "LAST_WORKING_DATE", "NOTICE_PERIOD"]);
const AI_DRAFT_KEYS = new Set(["WHY_INTERESTED", "NODEJS_EXPERIENCE", "AWS_EXPERIENCE", "KAFKA_EXPERIENCE"]);

const WRITING_PROMPT = /why\s+(?:are\s+you\s+)?(?:interested|join)|motivat|cover\s+(?:note|letter)|message\s+to|let\s+the\s+company\s+know|describe\s+(?:a|your)|tell\s+us\s+about/i;

/** AI is an allow-list for genuine writing prompts, never a fallback for an
 * unknown text control. */
export function aiGenerationEligible(semanticKey, field = {}) {
    const key = String(semanticKey || "").toUpperCase();
    const type = String(field.type || "text").toLowerCase();
    if (field.sectionKind || ["url", "date", "month", "number", "tel", "email", "combobox", "select-one", "radio", "checkbox", "checkbox-group"].includes(type)) return false;
    if (AI_DRAFT_KEYS.has(key)) return true;
    return type === "textarea" && WRITING_PROMPT.test(String(field.label || ""));
}

export function normalizeQuestionKey(question = "") {
    const suppliedKey = String(question || "").trim().toUpperCase();
    // Field detection may already have produced a canonical structured-resume
    // key. Never reinterpret EXPERIENCE_START_DATE as the volatile application
    // START_DATE question (or similarly collapse another section-scoped key).
    if (/^(?:EXPERIENCE_(?:TITLE|COMPANY|LOCATION|DESCRIPTION|START_DATE|END_DATE|CURRENT)|EDUCATION_(?:INSTITUTION|MAJOR|DEGREE|LOCATION|DESCRIPTION|START_DATE|END_DATE|CURRENT))$/.test(suppliedKey)) {
        return suppliedKey;
    }
    for (const [pattern, key] of QUESTION_PATTERNS) {
        if (!pattern.test(question)) continue;
        if (key === "TOTAL_EXPERIENCE" && isTechnologySpecificExperience(question)) continue;
        return key;
    }
    return String(question || "UNKNOWN")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 80) || "UNKNOWN";
}

function careerStage(profile) {
    const years = Number(profile.totalExperienceYears);
    if (!Number.isFinite(years)) return null;
    return years > 0 ? "Experienced Professional" : "College Grads/Fresher";
}

function profileAnswer(key, profile, field = {}) {
    const nameParts = String(profile.name || "").trim().split(/\s+/).filter(Boolean);
    const values = {
        FULL_NAME: profile.name,
        LEGAL_FIRST_NAME: profile.legalFirstName,
        LEGAL_MIDDLE_NAME: profile.legalMiddleName,
        LEGAL_LAST_NAME: profile.legalLastName,
        FIRST_NAME: nameParts[0],
        LAST_NAME: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
        EMAIL: profile.email,
        PHONE: profile.phone,
        COUNTRY: profile.country || (() => {
            const location = String(profile.currentLocation || "").trim();
            if (/^(?:india|united states|usa|uk|united kingdom|canada|australia)$/i.test(location)) return location;
            return location.includes(",") ? location.split(",").at(-1).trim() : null;
        })(),
        PREFERRED_FIRST_NAME: profile.preferredFirstName,
        PREFERRED_LAST_NAME: profile.preferredLastName,
        CURRENT_LOCATION: /\b(?:city|town)\b/i.test(String(field.label || ""))
            ? (profile.addressCity || profile.currentLocation)
            : profile.currentLocation,
        ADDRESS_CITY: profile.addressCity || profile.currentLocation,
        POSTAL_CODE: profile.postalCode,
        ADDRESS_LINE1: profile.addressLine1,
        ADDRESS_LINE2: profile.addressLine2,
        ADDRESS_STATE: profile.addressState,
        PREFERRED_LOCATIONS: profile.preferredLocations?.join(", "),
        LINKEDIN_URL: profile.linkedinUrl,
        PORTFOLIO_URL: profile.portfolioUrl,
        CURRENT_COMPANY: profile.currentCompany,
        CURRENT_CAREER_STAGE: careerStage(profile),
        CURRENT_INDUSTRY: profile.currentIndustry,
        CURRENT_CTC: profile.currentCTC,
        EXPECTED_CTC: profile.expectedCTC,
        NOTICE_PERIOD: profile.noticePeriodDays,
        LAST_WORKING_DATE: profile.lastWorkingDate,
        TOTAL_EXPERIENCE: profile.totalExperienceYears,
        RELOCATION: profile.willingToRelocate ? "Yes" : "No",
        WORK_AUTHORIZATION: profile.workAuthorization === "AUTHORIZED" ? "Yes" : null,
        SPONSORSHIP: profile.sponsorshipRequired === "YES" ? "Yes" : profile.sponsorshipRequired === "NO" ? "No" : null
    };
    const value = values[key];
    return value === undefined || value === null || value === "" ? null : String(value);
}

function jobAnswer(key, job = {}) {
    if (key !== "HEARING_SOURCE") return null;
    const haystack = `${job.source || ""} ${job.url || job.applicationUrl || ""}`.toLowerCase();
    if (haystack.includes("linkedin")) return "LinkedIn";
    if (haystack.includes("indeed")) return "Indeed";
    if (haystack.includes("naukri")) return "Other Job Board";
    if (/jobspy|wellfound|cutshort|instahyre/.test(haystack)) return "Other Job Board";
    return "Company Career Site";
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function adaptResumeAnswer(key, value, field = {}) {
    const text = String(value || "").trim();
    if (/_(?:START|END)_DATE$/.test(key)) {
        const date = text.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?/);
        if (date && /\bmonth\b/i.test(String(field.label || ""))) return MONTH_NAMES[Number(date[2]) - 1] || text;
        if (date && /\byear\b/i.test(String(field.label || ""))) return date[1];
    }
    if (key === "EDUCATION_DEGREE" && /degree/i.test(String(field.label || ""))) {
        if (/\b(?:b\.?e\.?|b\.?tech|bachelor)/i.test(text)) return "Bachelor’s Degree";
        if (/\b(?:m\.?e\.?|m\.?tech|m\.?s\.?|master)/i.test(text)) return "Master’s Degree";
        if (/\b(?:ph\.?d|doctor)/i.test(text)) return "PhD";
        if (/associate/i.test(text)) return "Associate’s Degree";
    }
    return value;
}

function resumeAnswer(key, resume = {}, field = {}) {
    const recordIndex = field.sectionIndex != null && Number.isInteger(Number(field.sectionIndex))
        ? Math.max(0, Number(field.sectionIndex)) : null;
    const activeRole = Array.isArray(resume.experience)
        ? (recordIndex === null ? resume.experience.find((role) => /present|current/i.test(String(role.endDate || ""))) : resume.experience[recordIndex]) || resume.experience[0]
        : null;
    const education = Array.isArray(resume.education) ? resume.education[recordIndex ?? 0] || resume.education[0] : null;
    const educationMajor = education?.field || education?.fieldOfStudy
        || String(education?.degree || "").match(/\b(?:in|of)\s+(.+)$/i)?.[1] || "";
    const skills = Array.isArray(resume.skills)
        ? resume.skills.flatMap((item) => typeof item === "string" ? [item] : Object.values(item || {}).flat()).filter(Boolean)
        : Object.values(resume.skills || {}).flat().filter(Boolean);
    const values = {
        LINKEDIN_URL: resume.linkedin || resume.linkedinUrl,
        PORTFOLIO_URL: resume.portfolio,
        GITHUB_URL: resume.github,
        PERSONAL_SUMMARY: resume.summary,
        SKILLS: [...new Set(skills.map((item) => String(item).trim()).filter(Boolean))].join(", "),
        CURRENT_COMPANY: activeRole?.company,
        EXPERIENCE_TITLE: activeRole?.title,
        EXPERIENCE_COMPANY: activeRole?.company,
        EXPERIENCE_LOCATION: activeRole?.location,
        EXPERIENCE_DESCRIPTION: activeRole?.description || (activeRole?.bullets || []).join("\n"),
        EXPERIENCE_START_DATE: activeRole?.startDate,
        EXPERIENCE_END_DATE: /present|current/i.test(String(activeRole?.endDate || "")) ? null : activeRole?.endDate,
        EXPERIENCE_CURRENT: /present|current/i.test(String(activeRole?.endDate || "")) ? "Yes" : "No",
        EDUCATION_INSTITUTION: education?.institution || education?.school,
        EDUCATION_MAJOR: educationMajor,
        EDUCATION_DEGREE: education?.degree,
        EDUCATION_LOCATION: education?.location,
        EDUCATION_DESCRIPTION: education?.description,
        EDUCATION_START_DATE: education?.startDate,
        EDUCATION_END_DATE: /present|current/i.test(String(education?.endDate || "")) ? null : education?.endDate,
        EDUCATION_CURRENT: /present|current/i.test(String(education?.endDate || "")) ? "Yes" : "No"
    };
    const value = adaptResumeAnswer(key, values[key], field);
    return value === undefined || value === null || value === "" ? null : String(value);
}

function optionMatches(answer, options = []) {
    const normalized = String(answer ?? "").trim().toLowerCase();
    return options.some((option) => [option?.value, option?.label]
        .some((value) => String(value ?? "").trim().toLowerCase() === normalized));
}

function answerFitsField(answer, field = {}) {
    const value = String(answer ?? "").trim();
    const type = String(field.type || "text").toLowerCase();
    if (!value || type === "file") return Boolean(value) || type === "file";
    if (type === "number") return /^[-+]?\d+(?:\.\d+)?$/.test(value);
    if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (["radio", "select-one", "checkbox-group"].includes(type) && Array.isArray(field.options) && field.options.length) {
        return optionMatches(value, field.options);
    }
    if (type === "checkbox") return /^(?:yes|no|true|false|1|0|agree|accepted)$/i.test(value);
    return true;
}

function unsuitableForField(resolved, field) {
    if (resolved.answer == null || resolved.requiresUserInput || answerFitsField(resolved.answer, field)) return resolved;
    return {
        normalizedKey: resolved.normalizedKey,
        answer: null,
        confidence: 0,
        source: "USER_REQUIRED",
        evidence: "The available answer does not exactly match this employer field's required type or choices.",
        requiresUserInput: true
    };
}

function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizedFieldType(field = {}) {
    const type = String(field.type || "text").toLowerCase();
    return ["text", "textarea", "email", "url", "number", "date", "radio", "select-one", "checkbox-group", "combobox"].includes(type) ? type : "text";
}

function reusableMemoryEligible({ semanticKey, field = {}, answerScope = "REUSABLE_ANSWER_LIBRARY", approvedByCandidate = false } = {}) {
    const classification = classifyAgentField(field, semanticKey);
    return approvedByCandidate
        && answerScope === "REUSABLE_ANSWER_LIBRARY"
        && classification.scope === "REUSABLE_ANSWER_LIBRARY"
        && classification.autoFill
        && !isSensitiveApplicationField(field)
        && !/^(?:UNKNOWN|CUSTOM_FIELD|WHY_INTERESTED)$/.test(String(semanticKey || ""));
}

async function searchFormAnswers(question, field, profile) {
    const semanticKey = normalizeQuestionKey(question);
    if (!reusableMemoryEligible({ semanticKey, field, approvedByCandidate: true })) return null;
    const db = getDb();
    const rows = db.prepare(`
        SELECT * FROM form_answers
        WHERE is_sensitive = 0 AND answer_scope = 'REUSABLE_ANSWER_LIBRARY'
          AND semantic_key = ? AND (field_type = ? OR field_type IS NULL OR field_type = '')
    `).all(semanticKey, normalizedFieldType(field));
    if (rows.length === 0) return null;
    
    const emb = await createEmbedding(question, profile);
    if (!emb) return null;

    let bestMatch = null;
    let bestScore = -1;
    for (const row of rows) {
        if (!row.question_embedding) continue;
        try {
            const targetEmb = JSON.parse(row.question_embedding);
            const score = cosineSimilarity(emb, targetEmb);
            if (score > 0.88 && score > bestScore) {
                bestScore = score;
                bestMatch = row;
            }
        } catch(e) {}
    }
    
    if (bestMatch && answerFitsField(bestMatch.answer, field)) {
        db.prepare("UPDATE form_answers SET used_count = used_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(bestMatch.id);
        return {
            answer: bestMatch.answer,
            confidence: bestScore,
            source: "VECTOR_MEMORY",
            evidence: `Matched past question: "${bestMatch.question_text}" (score: ${(bestScore * 100).toFixed(1)}%)`,
            requiresUserInput: false
        };
    }
    return null;
}

export async function saveFormAnswer({ questionText, answer, sourceJobId = null, semanticKey, field = {}, answerScope, approvedByCandidate = false, profile } = {}) {
    if (!questionText || !answer || !reusableMemoryEligible({ semanticKey, field, answerScope, approvedByCandidate })) return false;
    try {
        const emb = await createEmbedding(questionText, profile);
        if (!emb) return false;
        getDb().prepare(`
            INSERT INTO form_answers (question_text, question_embedding, answer, source_job_id, semantic_key, field_type, answer_scope, is_sensitive)
            VALUES (?, ?, ?, ?, ?, ?, 'REUSABLE_ANSWER_LIBRARY', 0)
            ON CONFLICT DO UPDATE SET question_embedding = excluded.question_embedding,
                source_job_id = excluded.source_job_id, last_used_at = CURRENT_TIMESTAMP
        `).run(questionText, JSON.stringify(emb), answer, sourceJobId, semanticKey, normalizedFieldType(field));
        return true;
    } catch (e) {
        console.error("[memory] Failed to save form answer", e);
        return false;
    }
}

export async function resolveQuestion(question, {
    profile = getCandidateProfile(),
    resume = loadResume(),
    job = {},
    field = {},
    allowAi = true
} = {}) {
    const normalizedKey = normalizeQuestionKey(question);
    const fromProfile = profileAnswer(normalizedKey, profile, field);
    if (fromProfile !== null) {
        const freshness = candidateFactStatus(normalizedKey, profile);
        if (freshness.managed && !freshness.usable) {
            return {
                normalizedKey,
                answer: null,
                confidence: 0,
                source: "USER_REQUIRED",
                evidence: freshness.conflict
                    ? "This profile fact conflicts with the last candidate-verified value. Confirm it before use."
                    : "This compensation or availability fact is stale. Confirm it before use.",
                requiresUserInput: true
            };
        }
        if (normalizedKey === "CURRENT_LOCATION" && /city/i.test(field.label || "") && /^(?:india|united states|usa|uk|united kingdom|canada|australia)$/i.test(fromProfile.trim())) {
            return {
                normalizedKey,
                answer: null,
                confidence: 0,
                source: "USER_REQUIRED",
                evidence: "The profile contains a country, but this employer requires a city.",
                requiresUserInput: true
            };
        }
        return unsuitableForField({ normalizedKey, answer: fromProfile, confidence: 1, source: "PROFILE", requiresUserInput: false }, field);
    }
    const fromResume = resumeAnswer(normalizedKey, resume, field);
    if (fromResume !== null) {
        return unsuitableForField({ normalizedKey, answer: fromResume, confidence: 0.95, source: "RESUME", evidence: "Verified from the selected resume.", requiresUserInput: false }, field);
    }
    const fromJob = jobAnswer(normalizedKey, job);
    if (fromJob !== null) {
        return unsuitableForField({ normalizedKey, answer: fromJob, confidence: 0.95, source: "JOB_SOURCE", evidence: "Derived from the job discovery source.", requiresUserInput: false }, field);
    }
    const saved = VOLATILE_KEYS.has(normalizedKey) ? null : findCandidateAnswer(normalizedKey);
    if (saved?.answer) {
        return unsuitableForField({
            normalizedKey,
            answer: saved.answer,
            confidence: Number(saved.confidence || 1),
            source: saved.source || "CANDIDATE_ANSWER",
            requiresUserInput: Number(saved.confidence || 1) < 0.7
        }, field);
    }
    if (CANDIDATE_REVIEW_KEYS.has(normalizedKey)) {
        return {
            normalizedKey,
            answer: null,
            confidence: 0,
            source: "USER_REQUIRED",
            evidence: "This question needs a verified candidate answer; it is not sent to AI for guessing.",
            requiresUserInput: true
        };
    }

    if (!allowAi || !aiGenerationEligible(normalizedKey, field)) {
        return {
            normalizedKey,
            answer: null,
            confidence: 0,
            source: "LOCAL_ONLY",
            evidence: "This field is not an approved AI writing prompt. It requires verified profile/resume data or candidate review.",
            requiresUserInput: true
        };
    }
    
    // NEW: Check Application Memory (vector store) before doing an expensive AI grounding call
    const memoryMatch = await searchFormAnswers(question, field, profile);
    if (memoryMatch) {
        return unsuitableForField({
            normalizedKey,
            answer: memoryMatch.answer,
            confidence: memoryMatch.confidence,
            source: memoryMatch.source,
            evidence: memoryMatch.evidence,
            requiresUserInput: false
        }, field);
    }
    
    const grounded = await generateGroundedApplicationAnswer(question, { profile, resume, job, field });
    if (grounded?.answer || grounded?.requiresUserInput) {
        return unsuitableForField({
            normalizedKey,
            answer: grounded.answer,
            confidence: Number(grounded.confidence || 0),
            source: grounded.source || "AI_GROUNDED",
            evidence: grounded.evidence || "",
            persistForReuse: Boolean(grounded.reusable && grounded.answer),
            requiresUserInput: Boolean(grounded.requiresUserInput || !grounded.answer)
        }, field);
    }
    return { normalizedKey, answer: null, confidence: 0, source: null, requiresUserInput: true };
}

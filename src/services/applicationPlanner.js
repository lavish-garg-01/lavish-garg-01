import { classifyAgentField } from "./applicationAgent.js";
import { DEFAULT_AUTOFILL_POLICIES } from "../repositories/autofillPolicyRepository.js";

const CONFIDENCE_THRESHOLD = 0.7;

function comparable(value) {
    return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function provenanceFor(source = "") {
    return ({
        PROFILE: "From Profile", RESUME: "Verified", CANDIDATE_ANSWER: "Remembered",
        USER: "Remembered", APPLICATION_DRAFT: "Remembered", USER_MANUAL_INPUT: "Verified",
        VERIFIED_APPLICATION_INPUT: "Verified", CALCULATED: "Calculated", AI_GROUNDED: "AI Draft"
    })[String(source).toUpperCase()] || "Verified";
}

export function autofillCategory(field = {}, answer = {}, classification = {}) {
    const key = String(answer.normalizedKey || field.semanticKey || "").toUpperCase();
    const text = `${key} ${field.label || ""}`.toUpperCase();
    if (classification.kind === "legal") return "LEGAL";
    if (classification.kind === "sensitive") return "SENSITIVE";
    if (String(answer.source || "").toUpperCase() === "AI_GROUNDED" || /WHY_|COVER|MOTIVATION|ABOUT_YOU|WRITE/.test(text)) return "WRITING";
    if (/CTC|SALARY|COMPENSATION|PAY/.test(text)) return "COMPENSATION";
    if (/NOTICE|START_DATE|LAST_WORKING|AVAILABLE/.test(text)) return "AVAILABILITY";
    if (/RELOCAT|TRAVEL|SHIFT|WORK_MODE|REMOTE|HYBRID|ONSITE/.test(text)) return "PREFERENCE";
    if (/EMAIL|PHONE|ADDRESS|LOCATION|COUNTRY|POSTAL|LINKEDIN|PORTFOLIO|GITHUB/.test(text)) return "CONTACT";
    if (/NAME|PRONOUN/.test(text)) return "IDENTITY";
    return "PROFESSIONAL";
}

// This is intentionally deterministic. AI may help resolve an answer, but the plan
// only translates verified answers into exact, reviewable fill actions.
export function buildApplicationPlan({ fields = [], answers = [], categoryPolicies = DEFAULT_AUTOFILL_POLICIES } = {}) {
    const byId = new Map(answers.map((answer) => [answer.fieldId, answer]));
    const actions = [];
    const review = [];
    const conflicts = [];
    const completed = [];
    for (const field of fields) {
        const answer = byId.get(field.id);
        if (field.type === "file") {
            if (field.value) completed.push({ fieldId: field.id, label: field.label, provenance: "Attached document" });
            else if (field.required) review.push({ fieldId: field.id, label: field.label, reason: "upload_required", group: "manual" });
            continue;
        }
        if (!answer) {
            if (field.required && !field.value) review.push({ fieldId: field.id, label: field.label, reason: "missing_or_unverified", group: "needsYou" });
            continue;
        }
        const classification = answer.classification || classifyAgentField(field, answer.normalizedKey);
        const category = autofillCategory(field, answer, classification);
        const policy = categoryPolicies?.[category] || DEFAULT_AUTOFILL_POLICIES[category] || "ASK_EACH_TIME";
        const blocked = ["legal", "sensitive"].includes(classification.kind);
        const aiDraft = String(answer.source || "").toUpperCase() === "AI_GROUNDED";
        const policyReview = policy !== "AUTO_VERIFIED";
        const fillAction = {
            fieldId: field.id,
            action: "FILL",
            value: String(answer.answer ?? ""),
            semanticKey: answer.normalizedKey || field.semanticKey || null,
            candidateAnswerVersionId: answer.resolutionRouting?.productionSource === "VERSIONED"
                ? answer.candidateAnswerVersionId || null : null,
            inputMethod: ["radio", "select-one", "checkbox-group", "combobox", "choice-group"].includes(field.type) ? "EXACT_OPTION" : "TEXT",
            source: answer.source,
            category,
            provenance: provenanceFor(answer.source)
        };
        if (blocked || answer.requiresUserInput || answer.answer == null || Number(answer.confidence || 0) < CONFIDENCE_THRESHOLD || !classification.autoFill) {
            if (field.required) review.push({
                fieldId: field.id, label: field.label,
                reason: blocked ? "candidate_confirmation" : aiDraft ? "ai_draft_review" : "missing_or_unverified",
                group: blocked ? "manual" : aiDraft ? "aiDraft" : "needsYou",
                riskGroup: blocked ? "PROTECTED" : aiDraft ? "AI_WRITING_REVIEW" : "FACT_REVIEW",
                category, policy,
                provenance: blocked ? "Manual Step" : aiDraft ? "AI Draft" : "Needs You"
            });
            continue;
        }
        if (aiDraft) {
            review.push({
                fieldId: field.id, label: field.label, reason: "ai_draft_review", group: "aiDraft",
                riskGroup: "AI_WRITING_REVIEW", category, policy, provenance: "AI Draft"
            });
            if (!field.value) actions.push(fillAction);
            continue;
        }
        if (field.value) {
            if (comparable(field.value) !== comparable(answer.answer)) {
                conflicts.push({
                    fieldId: field.id, label: field.label, existingValue: String(field.value),
                    proposedValue: String(answer.answer), source: answer.source,
                    provenance: provenanceFor(answer.source), reason: "existing_value_conflict"
                });
            } else completed.push({ fieldId: field.id, label: field.label, provenance: provenanceFor(answer.source) });
            continue;
        }
        if (policyReview) {
            if (field.required) review.push({
                fieldId: field.id, label: field.label, reason: "category_policy_review", group: "needsYou",
                riskGroup: `${category}_REVIEW`, category, policy, provenance: "Review policy"
            });
            continue;
        }
        actions.push(fillAction);
    }
    const summary = Object.freeze({
        total: fields.length,
        ready: actions.length,
        alreadyComplete: completed.length,
        needsYou: review.filter((item) => item.group === "needsYou").length + conflicts.length,
        aiDrafts: review.filter((item) => item.group === "aiDraft").length,
        manual: review.filter((item) => item.group === "manual").length
    });
    return Object.freeze({ version: 2, actions, review, conflicts, completed, summary, submits: false });
}

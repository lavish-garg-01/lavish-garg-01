import { jobPlatform } from "./jobPlatform.js";
import { portalKindFor } from "../adapters/registry.js";
import { normalizeQuestionKey } from "./questionResolver.js";

export const APPLY_MODES = Object.freeze({
    AUTOFILL: "AUTOFILL",
    PARTIAL: "PARTIAL",
    ASSIST: "ASSIST"
});

const MODE_META = {
    AUTOFILL: {
        label: "Autofill",
        title: "Autofill",
        reason: "COPILOT fills verified, non-sensitive fields on this employer form. You review and submit."
    },
    PARTIAL: {
        label: "Partial",
        title: "Partial — hop then fill",
        reason: "Prefer Apply on company website. COPILOT fills the employer form after that hop. Board chat or instant apply stays Assist."
    },
    ASSIST: {
        label: "Assist",
        title: "Assist — copy answers",
        reason: "This surface cannot be autofilled safely. Copy an answer, paste it yourself, then continue."
    }
};

const LISTING_MODE = {
    greenhouse: APPLY_MODES.AUTOFILL,
    lever: APPLY_MODES.AUTOFILL,
    ashby: APPLY_MODES.AUTOFILL,
    smartrecruiters: APPLY_MODES.AUTOFILL,
    workday: APPLY_MODES.AUTOFILL,
    rippling: APPLY_MODES.AUTOFILL,
    keka: APPLY_MODES.AUTOFILL,
    wellfound: APPLY_MODES.AUTOFILL,
    naukri: APPLY_MODES.PARTIAL,
    instahyre: APPLY_MODES.PARTIAL,
    linkedin: APPLY_MODES.PARTIAL,
    indeed: APPLY_MODES.PARTIAL,
    hirist: APPLY_MODES.PARTIAL,
    cutshort: APPLY_MODES.PARTIAL
};

const CHAT_APPLY = /type message here|recruiter'?s questions|kindly answer all the recruiter/i;
const EASY_APPLY_URL = /linkedin\.com\/.*(?:easy-apply|jobs-apply)/i;
const QUESTION_HINT = /how many years|years of experience|notice period|current ctc|expected ctc|willing to relocate|current location|available to join|last working|why (?:are you|do you want)|total experience|education|bachelor|degree|visa|work authori[sz]ation|currently working/i;

const FALLBACK_FACTS = [
    { key: "TOTAL_EXPERIENCE", label: "Total experience" },
    { key: "CURRENT_LOCATION", label: "Current location" },
    { key: "CURRENT_CTC", label: "Current CTC" },
    { key: "EXPECTED_CTC", label: "Expected CTC" },
    { key: "NOTICE_PERIOD", label: "Notice period" },
    { key: "PHONE", label: "Phone" },
    { key: "EMAIL", label: "Email" }
];

function supportRecord(mode, extras = {}) {
    const meta = MODE_META[mode] || MODE_META.ASSIST;
    return {
        mode,
        label: extras.label || meta.label,
        title: extras.title || meta.title,
        reason: extras.reason || meta.reason,
        hint: extras.hint || extras.reason || meta.reason,
        surface: extras.surface || null,
        platformId: extras.platformId || null
    };
}

function surfaceReason(surface, mode) {
    if (surface === "chat_apply") {
        return "This board’s chat apply cannot be autofilled. Copy an answer, paste it in the chat, then Save yourself.";
    }
    if (surface === "easy_apply") {
        return "LinkedIn Easy Apply is not a fillable employer form. Copy answers here, or use Apply on company website.";
    }
    if (surface === "instant_apply") {
        return "This board would send your saved profile immediately. Click Apply yourself, then paste from the answers below.";
    }
    if (surface === "employer_form") return MODE_META.AUTOFILL.reason;
    return MODE_META[mode]?.reason || MODE_META.PARTIAL.reason;
}

export function applySupportBadgeClass(modeOrSupport) {
    const mode = typeof modeOrSupport === "string" ? modeOrSupport : modeOrSupport?.mode;
    if (mode === APPLY_MODES.AUTOFILL) return "bg-emerald-100 text-emerald-800";
    if (mode === APPLY_MODES.PARTIAL) return "bg-amber-100 text-amber-900";
    if (mode === APPLY_MODES.ASSIST) return "bg-slate-200 text-slate-800";
    return "bg-slate-100 text-slate-700";
}

export function applySupportForPortal(platformId, extras = {}) {
    const id = String(platformId || "").toLowerCase();
    if (!id) return null;
    const mode = extras.mode || LISTING_MODE[id] || APPLY_MODES.PARTIAL;
    return supportRecord(mode, {
        ...extras,
        platformId: id,
        surface: extras.surface || "listing"
    });
}

export function applySupportForJob(job = {}) {
    const platform = jobPlatform(job);
    if (!platform) return null;
    return applySupportForPortal(platform.id);
}

export function isChatApplyText(pageText = "") {
    return CHAT_APPLY.test(String(pageText || ""));
}

export function isEasyApplySurface({ url = "", portalKind = "", easyApplyUi = false } = {}) {
    const portal = String(portalKind || "").toLowerCase();
    if (portal && portal !== "linkedin") return false;
    // A listing that merely mentions Easy Apply is still Partial. Only the
    // Easy Apply modal / apply-flow URL is Assist.
    return Boolean(easyApplyUi) || EASY_APPLY_URL.test(String(url || ""));
}

export function detectApplySurface({
    url = "",
    pageText = "",
    portalKind = "",
    hasLikelyForm = false,
    instantApplySuppressed = false,
    easyApplyUi = false
} = {}) {
    const portal = String(portalKind || portalKindFor(url) || jobPlatform({ url })?.id || "").toLowerCase();
    const text = String(pageText || "");
    if ((portal === "naukri" || portal === "instahyre" || isChatApplyText(text)) && isChatApplyText(text)) {
        return supportRecord(APPLY_MODES.ASSIST, {
            platformId: portal || "naukri",
            surface: "chat_apply",
            reason: surfaceReason("chat_apply", APPLY_MODES.ASSIST)
        });
    }
    if (easyApplyUi || (portal === "linkedin" && EASY_APPLY_URL.test(url))) {
        return supportRecord(APPLY_MODES.ASSIST, {
            platformId: "linkedin",
            surface: "easy_apply",
            reason: surfaceReason("easy_apply", APPLY_MODES.ASSIST)
        });
    }
    if (instantApplySuppressed) {
        return supportRecord(APPLY_MODES.ASSIST, {
            platformId: portal,
            surface: "instant_apply",
            reason: surfaceReason("instant_apply", APPLY_MODES.ASSIST)
        });
    }
    if (hasLikelyForm) {
        return supportRecord(APPLY_MODES.AUTOFILL, {
            platformId: portal || null,
            surface: "employer_form",
            reason: surfaceReason("employer_form", APPLY_MODES.AUTOFILL)
        });
    }
    if (LISTING_MODE[portal]) {
        return applySupportForPortal(portal, { surface: "listing" });
    }
    return supportRecord(APPLY_MODES.PARTIAL, { surface: "unknown", reason: MODE_META.PARTIAL.reason });
}

export function extractAssistQuestions(pageText = "") {
    const text = String(pageText || "").replace(/\s+/g, " ");
    const seen = new Set();
    const questions = [];
    const matches = text.match(/[A-Za-z][^.!?]{10,200}\?/g) || [];
    for (const match of matches) {
        const cleaned = match.replace(/\s+/g, " ").trim();
        const key = cleaned.toLowerCase();
        if (seen.has(key) || /thank you for showing interest|kindly answer all/i.test(cleaned)) continue;
        if (!QUESTION_HINT.test(cleaned) && !/\?$/.test(cleaned)) continue;
        if (!QUESTION_HINT.test(cleaned) && cleaned.length > 140) continue;
        if (!QUESTION_HINT.test(cleaned)) continue;
        seen.add(key);
        questions.push(cleaned);
    }
    return questions.slice(0, 4);
}

function profileValueForKey(key, profile = {}) {
    const nameParts = String(profile.name || "").trim().split(/\s+/).filter(Boolean);
    const values = {
        FULL_NAME: profile.name,
        FIRST_NAME: nameParts[0],
        LAST_NAME: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
        EMAIL: profile.email,
        PHONE: profile.phone,
        CURRENT_LOCATION: profile.currentLocation,
        CURRENT_COMPANY: profile.currentCompany,
        CURRENT_CTC: profile.currentCTC,
        EXPECTED_CTC: profile.expectedCTC,
        NOTICE_PERIOD: profile.noticePeriodDays,
        TOTAL_EXPERIENCE: profile.totalExperienceYears,
        LINKEDIN_URL: profile.linkedinUrl || profile.linkedin,
        PORTFOLIO_URL: profile.portfolioUrl || profile.portfolio
    };
    const value = values[key];
    return value == null || String(value).trim() === "" ? null : String(value).trim();
}

function formatAssistValue(key, raw) {
    if (raw == null || String(raw).trim() === "") return null;
    const value = String(raw).trim();
    if (key === "TOTAL_EXPERIENCE" && /^\d+(?:\.\d+)?$/.test(value)) {
        return { copy: value, display: `${value} years` };
    }
    if (key === "NOTICE_PERIOD" && /^\d+$/.test(value)) {
        return { copy: value, display: `${value} days` };
    }
    return { copy: value, display: value };
}

function cardFor({ kind, question, key, label, profile }) {
    const semanticKey = key || (question ? normalizeQuestionKey(question) : null);
    const known = FALLBACK_FACTS.some((fact) => fact.key === semanticKey)
        || ["FULL_NAME", "FIRST_NAME", "LAST_NAME", "CURRENT_COMPANY", "LINKEDIN_URL", "PORTFOLIO_URL"].includes(semanticKey);
    const formatted = known ? formatAssistValue(semanticKey, profileValueForKey(semanticKey, profile)) : null;
    return {
        id: `${kind}:${semanticKey || "CUSTOM"}:${String(question || label || "").slice(0, 40)}`,
        kind,
        question: question || null,
        label: label || FALLBACK_FACTS.find((fact) => fact.key === semanticKey)?.label || "Answer",
        semanticKey: semanticKey || "CUSTOM_FIELD",
        copy: formatted?.copy || "",
        display: formatted?.display || "",
        source: formatted ? "PROFILE" : null,
        missing: !formatted
    };
}

export function buildAssistCards({ pageText = "", questions = [], profile = {} } = {}) {
    const detected = [...new Set([
        ...((Array.isArray(questions) ? questions : []).map((item) => String(item || "").trim()).filter(Boolean)),
        ...extractAssistQuestions(pageText)
    ])].slice(0, 4);
    const current = detected.map((question) => cardFor({ kind: "current", question, profile }));
    const used = new Set(current.map((card) => card.semanticKey));
    const ready = FALLBACK_FACTS
        .filter((fact) => !used.has(fact.key))
        .map((fact) => cardFor({ kind: "ready", key: fact.key, label: fact.label, profile }))
        .filter((card) => !card.missing);
    return [...current, ...ready].slice(0, 10);
}

export function resolveAssistSession({
    url = "",
    pageText = "",
    questions = [],
    portalKind = "",
    hasLikelyForm = false,
    instantApplySuppressed = false,
    easyApplyUi = false,
    surface = "",
    profile = {}
} = {}) {
    const detected = detectApplySurface({
        url, pageText, portalKind, hasLikelyForm, instantApplySuppressed, easyApplyUi
    });
    const mode = ["chat_apply", "easy_apply", "instant_apply"].includes(surface)
        ? APPLY_MODES.ASSIST
        : detected.mode;
    const resolvedSurface = surface || detected.surface;
    return {
        applySupport: supportRecord(mode, {
            platformId: portalKind || detected.platformId || portalKindFor(url) || jobPlatform({ url })?.id,
            surface: resolvedSurface,
            reason: surfaceReason(resolvedSurface, mode)
        }),
        cards: buildAssistCards({ pageText, questions, profile })
    };
}

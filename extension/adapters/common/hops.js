(() => {
    if (globalThis.JobHunterHops) return;

    let host = {
        visible: () => false,
        buttonText: () => "",
        adapterContext: () => ({}),
        hasLikelyApplicationForm: () => false,
        message: async () => null,
        get activeJob() { return null; },
        reportProgress: async () => {},
        setStatus: () => {}
    };

const APPLY_TEXT = /^(?:(?:easy\s+)?apply(?:ing)?(?:\s+(?:now|online|here|manually|externally|with\s+linkedin|for\s+this\s+job|to\s+this\s+job|on\s+(?:naukri(?:\.com)?|(?:the\s+)?(?:company|employer)\s+(?:site|website|portal))|to\s+.{1,80}))?|view\s+(?:&|and)\s+apply|start\s+(?:your\s+)?application)(?:\s+save)?(?:\s*|opens in a new tab|opens in a new window|external link|.*icon.*)*$/i;
const SUBMIT_TEXT = /^(?:submit|send)(?:\s*application)?$/i;
const EXTERNAL_APPLY_TEXT = /apply\s+(?:on|at|via|through)\b|company\s+(?:site|website)|apply\s+externally/i;
const SUGGESTED_JOBS_SELECTOR = "[class*='similar' i], [class*='recommend' i], [class*='related' i], [id*='similar' i], [id*='recommend' i], [data-testid*='similar' i], [aria-label*='similar' i], aside, footer";
const INSTANT_APPLY_PORTALS = new Set(["naukri", "instahyre"]);

    function bind(nextHost = {}) {
        const merged = { ...host };
        for (const key of Object.keys(nextHost)) {
            const descriptor = Object.getOwnPropertyDescriptor(nextHost, key);
            if (descriptor) Object.defineProperty(merged, key, descriptor);
        }
        host = merged;
        return api;
    }

function applyControlCandidates() {
    const matching = [...document.querySelectorAll("a, button, [role=button]")]
        .filter((element) => host.visible(element) && APPLY_TEXT.test(host.buttonText(element)));
    // Job boards repeat an Apply control for every recommended job. Those
    // belong to other listings, so they are only used if nothing else exists.
    const primary = matching.filter((element) => !element.closest?.(SUGGESTED_JOBS_SELECTOR));
    const scoped = primary.length ? primary : matching;
    return [...scoped].sort((a, b) => applyControlRank(b) - applyControlRank(a));
}
function applyControlRank(element) {
    const text = host.buttonText(element);
    // The listing-to-employer hop is the one that reaches a real form.
    if (EXTERNAL_APPLY_TEXT.test(text)) return 3;
    if (/^easy\s+apply/i.test(text)) return 2;
    return 1;
}
function isInstantApplyBoard() {
    if (globalThis.JobHunterAdapterRuntime?.overlay?.("instantApplyBoard", false)) return true;
    const portalKind = globalThis.JobHunterAdapterRegistry?.portalKindFor?.(location.hostname);
    return INSTANT_APPLY_PORTALS.has(String(portalKind || ""));
}
function suppressedInstantApply() {
    const candidates = applyControlCandidates();
    return Boolean(candidates.length) && isInstantApplyBoard() && candidates.every((element) => applyControlRank(element) === 1);
}
function findApplyButton() {
    const candidates = applyControlCandidates();
    if (!candidates.length) return null;
    if (isInstantApplyBoard() && applyControlRank(candidates[0]) === 1) return null;
    return candidates[0];
}
function localApplySurface() {
    const portal = host.adapterContext().portalKind || globalThis.JobHunterAdapterRegistry?.portalKindFor?.(location.href) || "";
    const text = String(document.body?.innerText || "").slice(0, 20000);
    const chatComposer = document.querySelector(
        'input[placeholder*="Type message" i], textarea[placeholder*="Type message" i], input[placeholder*="Type a message" i], textarea[placeholder*="Type a message" i], [class*="chat"] textarea, [class*="chatbot"] textarea'
    );
    const chatApply = Boolean(chatComposer) || /type message here|recruiter'?s questions|kindly answer all the recruiter/i.test(text);
    if ((portal === "naukri" || portal === "instahyre") && chatApply && !host.hasLikelyApplicationForm()) {
        return { mode: "ASSIST", surface: "chat_apply" };
    }
    const easyApplyUi = Boolean(document.querySelector(".jobs-easy-apply-modal, [class*='jobs-easy-apply'], [data-test-modal-id*='easy-apply']"));
    if (portal === "linkedin" && easyApplyUi) return { mode: "ASSIST", surface: "easy_apply" };
    if (suppressedInstantApply()) return { mode: "ASSIST", surface: "instant_apply", instantApply: true };
    if (host.hasLikelyApplicationForm()) return { mode: "AUTOFILL", surface: "employer_form" };
    return { mode: "PARTIAL", surface: "listing" };
}
const ASSIST_QUESTION_HINT = /how many years|years of experience|notice period|current ctc|expected ctc|willing to relocate|current location|available to join|last working|why (?:are you|do you want)|total experience|education|bachelor|degree|visa|work authori[sz]ation|currently working/i;

function extractVisibleAssistQuestions() {
    const scopes = [
        document.querySelector(".jobs-easy-apply-modal, [class*='jobs-easy-apply'], [data-test-modal-id*='easy-apply']"),
        document.querySelector("[class*='chat'], [class*='Chatbot'], [class*='chatbot']"),
        document
    ].filter(Boolean);
    const seen = new Set();
    const questions = [];
    const selectors = "p, h1, h2, h3, h4, li, label, legend, [class*='question'], [class*='chat'], [class*='message'], [class*='botMsg']";
    for (const scope of scopes) {
        for (const node of scope.querySelectorAll(selectors)) {
            if (!host.visible(node)) continue;
            const text = String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
            if (text.length < 12 || text.length > 220) continue;
            if (/thank you for showing interest|kindly answer all|type message here/i.test(text)) continue;
            if (!/\?$/.test(text) && !ASSIST_QUESTION_HINT.test(text)) continue;
            const key = text.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            questions.push(text);
        }
        if (questions.length) break;
    }
    return questions.slice(-8);
}
async function enterAssistMode(surface = localApplySurface()) {
    const result = await host.message({
        type: "RESOLVE_ASSIST",
        jobId: host.activeJob.id,
        payload: {
            pageUrl: location.href,
            pageText: String(document.body?.innerText || "").slice(0, 20000),
            questions: extractVisibleAssistQuestions(),
            portalKind: host.adapterContext().portalKind,
            surface: surface.surface,
            instantApplyBoard: Boolean(surface.instantApply || isInstantApplyBoard()),
            easyApplyUi: surface.surface === "easy_apply",
            hasLikelyForm: host.hasLikelyApplicationForm()
        }
    }).catch(() => null);
    const text = result?.applySupport?.reason
        || "This page cannot be autofilled. Copy an answer in the side panel and paste it yourself.";
    await host.reportProgress("USER_ACTION_REQUIRED", text, {
        assist: true,
        instantApplyBoard: Boolean(surface.instantApply),
        surface: result?.applySupport?.surface || surface.surface
    });
    host.setStatus(text, "warning");
    return { assist: true, requiresUserClick: true, applySupport: result?.applySupport || surface, cards: result?.cards || [] };
}

    const api = {
        bind,
        APPLY_TEXT,
        SUBMIT_TEXT,
        EXTERNAL_APPLY_TEXT,
        SUGGESTED_JOBS_SELECTOR,
        INSTANT_APPLY_PORTALS,
        applyControlCandidates,
        applyControlRank,
        isInstantApplyBoard,
        suppressedInstantApply,
        findApplyButton,
        localApplySurface,
        extractVisibleAssistQuestions,
        enterAssistMode
    };
    globalThis.JobHunterHops = api;
})();

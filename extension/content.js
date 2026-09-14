(() => {
    if (window.__jobHunterCopilotLoaded) return;
    window.__jobHunterCopilotLoaded = true;

    // Cache immutable extension values while the context is healthy. Chrome
    // invalidates existing content scripts when an unpacked extension reloads;
    // runtime getters can then throw even behind optional chaining.
    let cachedExtensionVersion = "unknown";
    let cachedRobotAssetUrl = "";
    try {
        cachedExtensionVersion = chrome.runtime.getManifest().version || "unknown";
        cachedRobotAssetUrl = chrome.runtime.getURL("assets/pet-robot-v2.png");
    } catch {}

    if (["localhost", "127.0.0.1"].includes(location.hostname) && location.pathname !== "/extension-diagnostic") {
        const documentSurface = /^\/jobs\/[^/]+\/(?:resume-preview|resume\.html|cover-letter\.html)$/.test(location.pathname);
        if (window.top === window && documentSurface) return;
        if (window.top === window) {
            const dashboardMessage = (payload) => new Promise((resolve, reject) => {
                try {
                    chrome.runtime.sendMessage(payload, (response) => {
                        let lastError = null;
                        try { lastError = chrome.runtime.lastError; }
                        catch (error) { lastError = error; }
                        if (lastError) return reject(new Error(lastError.message || String(lastError)));
                        return response?.ok ? resolve(response.result) : reject(new Error(response?.error || "Extension request failed."));
                    });
                } catch (error) { reject(error); }
            });
            const dashboardOrigin = location.origin;
            const protocolNonce = () => `${crypto.randomUUID()}${crypto.randomUUID()}`;
            const newLaunchRequest = ({ messageId = crypto.randomUUID(), jobId, url }) => ({
                messageId,
                clientNonce: protocolNonce(),
                sentAtMs: Date.now(),
                protocolVersion: 1,
                websiteOrigin: dashboardOrigin,
                jobId: String(jobId || ""),
                targetUrl: String(url || "")
            });
            const dispatchBridgeResponse = (messageId, response) => {
                window.dispatchEvent(new CustomEvent("job-hunter-extension-response", {
                    detail: { messageId, extensionVersion: cachedExtensionVersion, ...response }
                }));
            };
            document.addEventListener("job-hunter-extension-request", async (event) => {
                const detail = event.detail || {};
                const messageId = String(detail.messageId || "");
                if (!messageId || !["JOB_HUNTER_PING", "JOB_HUNTER_LAUNCH_REQUEST"].includes(detail.type)) return;
                if (Math.abs(Date.now() - Number(detail.sentAtMs || 0)) > 60_000) {
                    dispatchBridgeResponse(messageId, { state: "DISCONNECTED", reasonCode: "STALE_WEBSITE_MESSAGE" });
                    return;
                }
                try {
                    const negotiation = await dashboardMessage({
                        type: "NEGOTIATE_PROTOCOL",
                        protocolVersions: Array.isArray(detail.protocolVersions) ? detail.protocolVersions : [1],
                        targetUrl: detail.targetUrl || ""
                    });
                    if (detail.type === "JOB_HUNTER_PING" || negotiation.state === "VERSION_INCOMPATIBLE") {
                        dispatchBridgeResponse(messageId, negotiation);
                        return;
                    }
                    const launchRequest = newLaunchRequest({ messageId, jobId: detail.jobId, url: detail.targetUrl });
                    const result = await dashboardMessage({
                        type: "OPEN_GROUPED_APPLICATION",
                        jobId: launchRequest.jobId,
                        url: launchRequest.targetUrl,
                        prepare: true,
                        launchRequest
                    });
                    dispatchBridgeResponse(messageId, {
                        state: result.siteAccess ? "READY_TO_LAUNCH" : "PERMISSION_REQUIRED",
                        launched: true,
                        ...result
                    });
                } catch (error) {
                    dispatchBridgeResponse(messageId, { state: "DISCONNECTED", reasonCode: "LAUNCH_FAILED", error: error.message });
                }
            });
            const renderApplyingStrip = async () => {
                const existing = document.getElementById("job-hunter-applying-strip");
                const response = await dashboardMessage({ type: "GET_EXTENSION_STATE" }).catch(() => null);
                const state = response;
                const review = state?.pendingSubmissionReview;
                if (state?.activeJob && state.activeTabId) {
                    const strip = existing || document.createElement("aside");
                    strip.id = "job-hunter-applying-strip";
                    strip.style.cssText = "position:sticky;top:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;gap:10px;padding:9px 14px;background:#eff6ff;border-bottom:1px solid #bfdbfe;color:#102a43;font:13px system-ui,sans-serif";
                    strip.innerHTML = `<strong>Applying: ${String(state.activeJob.title || "Application").replace(/[<>&]/g, "")}</strong><span>${String(state.activeApplication?.status || "IN PROGRESS").replaceAll("_", " ")}</span><button data-session-action="continue">Continue</button><button data-session-action="submitted">Yes, submitted</button><button data-session-action="later">Finish later</button>`;
                    strip.querySelectorAll("button").forEach((button) => { button.style.cssText = "border:1px solid #93c5fd;background:white;border-radius:7px;padding:5px 8px;font-weight:700;cursor:pointer"; });
                    if (!existing) document.body.prepend(strip);
                    return;
                }
                if (review?.jobId) {
                    const strip = existing || document.createElement("aside");
                    strip.id = "job-hunter-applying-strip";
                    strip.style.cssText = "position:sticky;top:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;gap:10px;padding:9px 14px;background:#fff7ed;border-bottom:1px solid #fdba74;color:#9a3412;font:13px system-ui,sans-serif";
                    strip.innerHTML = `<strong>Did the employer receive “${String(review.title || "this application").replace(/[<>&]/g, "")}”?</strong><button data-session-action="submitted">Yes, submitted</button><button data-session-action="not-submitted">Not submitted</button>`;
                    strip.querySelectorAll("button").forEach((button) => { button.style.cssText = "border:1px solid #fdba74;background:white;border-radius:7px;padding:5px 8px;font-weight:700;cursor:pointer"; });
                    if (!existing) document.body.prepend(strip);
                    return;
                }
                existing?.remove();
            };
            const interceptOpenWithExtension = async (event) => {
                const form = event.type === "submit"
                    ? event.target
                    : event.target?.closest?.("form[data-open-with-extension]");
                if (!form || form.tagName !== "FORM" || !form.hasAttribute("data-open-with-extension")) return;
                if (form.dataset.protocolBridge === "true") return;
                event.preventDefault();
                event.stopImmediatePropagation();
                const jobId = form.action.match(/\/jobs\/([^/]+)\/open-with-extension/)?.[1] || "";
                const button = form.querySelector("button");
                const originalButtonText = button?.textContent || "Open employer application ↗";
                if (button) { button.disabled = true; button.textContent = "Preparing application…"; }
                try {
                    // Message the extension FIRST so the click gesture can open the
                    // side panel. Do not await fetch/prepare before this message —
                    // Chrome rejects sidePanel.open / permissions.request afterward.
                    await dashboardMessage({
                        type: "OPEN_GROUPED_APPLICATION",
                        jobId: decodeURIComponent(jobId),
                        url: form.dataset.jobUrl || "",
                        prepare: true,
                        launchRequest: newLaunchRequest({
                            jobId: decodeURIComponent(jobId),
                            url: form.dataset.jobUrl || ""
                        })
                    });
                    await renderApplyingStrip();
                } catch (error) { alert(error.message); }
                finally { if (button) { button.disabled = false; button.textContent = originalButtonText; } }
            };
            document.addEventListener("click", interceptOpenWithExtension, true);
            document.addEventListener("submit", interceptOpenWithExtension, true);
            document.addEventListener("job-hunter-open-application", async (event) => {
                const detail = event.detail || {};
                try {
                    await dashboardMessage({
                        type: "OPEN_GROUPED_APPLICATION",
                        jobId: detail.jobId,
                        url: detail.url,
                        prepare: true,
                        launchRequest: newLaunchRequest({ jobId: detail.jobId, url: detail.url })
                    });
                } catch (error) { alert(error.message); }
                await renderApplyingStrip();
            });
            document.addEventListener("click", async (event) => {
                const action = event.target?.dataset?.sessionAction;
                if (!action) return;
                try {
                    if (action === "continue") await dashboardMessage({ type: "CONTINUE_ACTIVE_APPLICATION" });
                    if (action === "submitted" && confirm("Did the employer receive this application?")) await dashboardMessage({ type: "CONFIRM_ACTIVE_SUBMITTED" });
                    if (action === "not-submitted") await dashboardMessage({ type: "DISMISS_SUBMISSION_REVIEW" });
                    if (action === "later") await dashboardMessage({ type: "FINISH_APPLICATION_LATER" });
                    await renderApplyingStrip();
                } catch {}
            });
            chrome.storage.onChanged.addListener(() => void renderApplyingStrip());
            window.dispatchEvent(new CustomEvent("job-hunter-extension-ready", {
                detail: { protocolVersion: 1, extensionVersion: cachedExtensionVersion, state: "CONNECTED" }
            }));
            void renderApplyingStrip();
        }
        return;
    }

    const isTopFrame = window.top === window;

    const FIELD_SELECTOR = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]), textarea, select, [contenteditable=true][role=textbox], [role=combobox]";
    const APPLY_TEXT = /^(?:(?:easy\s+)?apply(?:ing)?(?:\s+(?:now|online|here|manually|externally|with\s+linkedin|for\s+this\s+job|to\s+this\s+job|on\s+(?:naukri(?:\.com)?|(?:the\s+)?(?:company|employer)\s+(?:site|website|portal))|to\s+.{1,80}))?|view\s+(?:&|and)\s+apply|start\s+(?:your\s+)?application)(?:\s+save)?(?:\s*|opens in a new tab|opens in a new window|external link|.*icon.*)*$/i;
    const SUBMIT_TEXT = /^(?:submit|send)(?:\s*application)?$/i;
    const EXTERNAL_APPLY_TEXT = /apply\s+(?:on|at|via|through)\b|company\s+(?:site|website)|apply\s+externally/i;
    const SUGGESTED_JOBS_SELECTOR = "[class*='similar' i], [class*='recommend' i], [class*='related' i], [id*='similar' i], [id*='recommend' i], [data-testid*='similar' i], [aria-label*='similar' i], aside, footer";
    const INSTANT_APPLY_PORTALS = new Set(["naukri", "instahyre"]);
    const CONFIRMATION_TEXT = /application (?:has been )?(?:submitted|received)|thanks? for applying|thank you for (?:applying|your application)|we have received your application/i;
    const KEKA_SUCCESS_ROUTE = /\/careers\/success\/\d+\/?$/i;
    const EMBEDDED_APPLICATION_SELECTOR = "#grnhse_iframe, iframe[src*='greenhouse.io'], iframe[src*='job_app'], iframe[src*='lever.co'], iframe[src*='ashbyhq.com']";
    const OPERATION_TIMEOUT_MS = 30000;
    const MAX_NAVIGATION_HOPS = 12;
    const ATTACH_ATTEMPTS = 3;
    const LEGAL_TEXT = /consent|privacy|terms|declaration|certif|signature|confirm.{0,25}(?:true|accurate)|agree.{0,25}(?:terms|policy)|authorize/i;
    const SENSITIVE_TEXT = /password|passcode|one.?time|\botp\b|captcha|verification\s+(?:code|challenge)|cookie|citizen|visa|work\s*authori[sz]ation|sponsor|criminal|conviction|veteran|medical|health|disability|race|ethnic|religion|gender|sexual|date of birth|aadhaar|passport|social security|national id/i;
    
    let activeJob = null;
    let activeRunContext = null;
    let hostNode = null;
    let statusNode = null;
    let shadowRoot = null;
    let timelineNode = null;
    let questionNode = null;
    let manualSectionNode = null;
    let timerNode = null;
    let pauseBtn = null;
    let processingTimer = null;
    let currentQuestion = null;
    let lastFill = [];
    const ownership = globalThis.JobHunterRuntimeOwnership.create();
    const pendingConflicts = new Map();
    let stopped = false;
    let isPaused = false;
    let sidePanelOpen = false;
    let pendingDocumentDrag = null;
    let documentDragClearTimer = 0;
    let dynamicRescanTimer = null;
    let dynamicObserver = null;
    const observedDynamicRoots = new WeakSet();
    let lastDynamicFingerprint = "";
    let lastFormStructureFingerprint = "";
    let pageGeneration = 0;
    let formGeneration = 0;
    let knownApplicationRoute = "";
    const knownFieldIds = new Set();
    const editSessionByField = new Map();
    const editSessionStartByField = new Map();
    const revisionSequenceByField = new Map();
    const editUpdateTimerByField = new Map();
    const verifiedFillLedger = new Map();
    const comboboxSelectionEvidence = new Map();
    let extensionContextInvalidated = false;

    function isExtensionContextInvalidation(error) {
        return /extension context invalidated|receiving end does not exist|message port closed/i
            .test(String(error?.message || error || ""));
    }

    function deactivateInvalidatedContext() {
        if (extensionContextInvalidated) return;
        extensionContextInvalidated = true;
        stopped = true;
        clearTimeout(dynamicRescanTimer);
        clearTimeout(documentDragClearTimer);
        clearInterval(processingTimer);
        dynamicObserver?.disconnect?.();
        dynamicObserver = null;
        orchestrator.cancel();
        if (statusNode) {
            statusNode.textContent = "Job Hunter was updated. Refresh this application page to reconnect.";
            statusNode.dataset.kind = "warning";
        }
        if (timerNode) timerNode.textContent = "Refresh required";
    }

    function message(payload, timeoutMs = OPERATION_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            if (extensionContextInvalidated) return reject(new Error("Extension context invalidated."));
            const timeout = setTimeout(() => reject(new Error("This step did not finish within 30 seconds.")), timeoutMs);
            try {
                chrome.runtime.sendMessage(payload, (response) => {
                    clearTimeout(timeout);
                    let lastError = null;
                    try { lastError = chrome.runtime.lastError; }
                    catch (error) { lastError = error; }
                    if (lastError) {
                        if (isExtensionContextInvalidation(lastError)) deactivateInvalidatedContext();
                        return reject(new Error(lastError.message || String(lastError)));
                    }
                    if (!response?.ok) return reject(new Error(response?.error || "Extension request failed."));
                    resolve(response.result);
                });
            } catch (error) {
                clearTimeout(timeout);
                if (isExtensionContextInvalidation(error)) deactivateInvalidatedContext();
                reject(error);
            }
        });
    }

    const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

    function beginProcessing(label) {
        if (statusNode) {
            statusNode.textContent = label;
            statusNode.dataset.kind = "processing";
        }
        const startedAt = Date.now();
        clearInterval(processingTimer);
        const update = () => {
            if (isPaused) {
                if (timerNode) timerNode.textContent = "Paused";
                return;
            }
            if (timerNode) timerNode.textContent = `Processing · ${Math.min(30, Math.floor((Date.now() - startedAt) / 1000))}s / 30s`;
        };
        update();
        processingTimer = setInterval(update, 1000);
    }

    function endProcessing() {
        clearInterval(processingTimer);
        processingTimer = null;
        if (timerNode && !isPaused) timerNode.textContent = "";
    }

    const orchestrator = globalThis.JobHunterRuntimeOrchestrator.create({
        timeoutMs: OPERATION_TIMEOUT_MS,
        isPaused: () => isPaused,
        begin: beginProcessing,
        end: endProcessing
    });
    const runAgentOperation = (label, operation) => orchestrator.run(label, operation);

    function dynamicPageFingerprint() {
        const controls = fieldControls(document.body);
        const identity = controls.slice(0, 80).map((element) => [
            element.tagName,
            element.type || "",
            element.name || element.id || element.getAttribute("aria-label") || "",
            // Track only empty/non-empty state, never candidate values. This
            // lets a React rerender that clears a verified fill trigger repair.
            element.type === "file" ? Boolean(element.files?.length) : Boolean(String(element.value || "").trim())
        ].join(":"));
        return `${location.href}|${controls.length}|${identity.join("|")}`;
    }

    function formStructureFingerprint() {
        return detectFields().slice(0, 120).map((field) => `${field.id}|${field.type}|${field.sectionKind || ""}|${field.sectionIndex ?? 0}`).join("||");
    }

    function scheduleDynamicPageCheck({ routeChanged = false } = {}) {
        if (!isTopFrame || stopped || isPaused || !activeJob) return;
        clearTimeout(dynamicRescanTimer);
        dynamicRescanTimer = setTimeout(async () => {
            if (stopped || isPaused || !activeJob) return;
            if (orchestrator.isRunning()) {
                scheduleDynamicPageCheck({ routeChanged });
                return;
            }
            const fingerprint = dynamicPageFingerprint();
            if (!routeChanged && fingerprint === lastDynamicFingerprint) return;
            lastDynamicFingerprint = fingerprint;
            const structure = formStructureFingerprint();
            if (structure !== lastFormStructureFingerprint) {
                lastFormStructureFingerprint = structure;
                formGeneration += 1;
            }
            if (routeChanged) pageGeneration += 1;
            try {
                if (hasLikelyApplicationForm() || hasEmbeddedApplicationFrame()) {
                    await runAgentOperation("Filling newly available application fields…", () => fillPage({ executePlan: true, incrementalOnly: true }));
                } else if (routeChanged && findApplyButton()) {
                    await runAgentOperation("Following the updated application page…", () => resumeNavigation());
                }
            } catch (error) {
                await reportVisibleFailure(error);
            }
        }, 650);
    }

    function startDynamicPageDetection() {
        if (!isTopFrame || dynamicObserver || !document.body) return;
        lastDynamicFingerprint = dynamicPageFingerprint();
        lastFormStructureFingerprint = formStructureFingerprint();
        const observeRoots = () => {
            const roots = [document.body, ...(globalThis.JobHunterShadow?.openRoots?.() || [])];
            for (const root of roots) {
                if (!root || observedDynamicRoots.has(root)) continue;
                observedDynamicRoots.add(root);
                dynamicObserver.observe(root, { childList: true, subtree: true, attributes: true });
            }
        };
        dynamicObserver = new MutationObserver(() => {
            observeRoots();
            scheduleDynamicPageCheck();
        });
        observeRoots();
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    }

    function visible(element) {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }

    function deepQueryAll(selector, root = document) {
        return globalThis.JobHunterShadow?.queryAll?.(selector, root)
            || [...(root?.querySelectorAll?.(selector) || [])];
    }

    function deepQuery(selector, root = document) {
        return globalThis.JobHunterShadow?.query?.(selector, root)
            || root?.querySelector?.(selector)
            || null;
    }

    function deepGetById(id, root = document) {
        return globalThis.JobHunterShadow?.getById?.(id, root)
            || (root === document ? document.getElementById(id) : root?.querySelector?.(`#${CSS.escape(id)}`))
            || null;
    }

    function composedParent(element) {
        return globalThis.JobHunterShadow?.parent?.(element) || element?.parentElement || null;
    }

    function composedClosest(element, selector) {
        return globalThis.JobHunterShadow?.closest?.(element, selector) || element?.closest?.(selector) || null;
    }

    const scanner = globalThis.JobHunterRuntimeScanner.create({ deepQueryAll, visible, genericControlLabel });

    function buttonText(element) {
        return String(element.innerText || element.value || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    }

    function applyControlCandidates() {
        return globalThis.JobHunterHops?.applyControlCandidates?.() || [];
    }

    function applyControlRank(element) {
        return globalThis.JobHunterHops?.applyControlRank?.(element) || 0;
    }

    function isInstantApplyBoard() {
        return globalThis.JobHunterHops?.isInstantApplyBoard?.() || false;
    }

    /**
     * Some boards send the application straight from the saved board profile the
     * moment Apply is clicked, with no form and no review. The candidate makes
     * that call, never the extension.
     */
    function suppressedInstantApply() {
        return globalThis.JobHunterHops?.suppressedInstantApply?.() || false;
    }

    function findApplyButton() {
        return globalThis.JobHunterHops?.findApplyButton?.() || null;
    }

    function isWorkdayApplicationRoute() {
        if (globalThis.JobHunterAdapterRuntime?.isApplicationRoute?.(location)) return true;
        return /(?:^|\.)myworkdayjobs\.com$/i.test(location.hostname)
            && /\/apply(?:\/applyManually)?\/?$/i.test(location.pathname);
    }

    function embeddedApplicationSelector() {
        return globalThis.JobHunterAdapterRuntime?.embeddedFrameSelector?.() || EMBEDDED_APPLICATION_SELECTOR;
    }

    function formContainerSelector() {
        return globalThis.JobHunterAdapterRuntime?.formContainerSelector?.()
            || 'form, [role="dialog"], #application_form, #grnhse_app';
    }

    async function applyAdapterRuntime() {
        const runtime = await message({ type: "GET_HOT_PATH", url: location.href, jobId: activeJob?.id }).catch(() => null);
        const registry = globalThis.JobHunterAdapterRegistry;
        const resolved = registry?.resolveForPage?.(location, document) || registry?.resolve?.(location.hostname)
            || { id: "generic", portalKind: "generic", version: "1.0.0" };
        const targetPortalKind = resolved.portalKind === "generic" && runtime?.portalKind
            ? runtime.portalKind
            : (resolved.portalKind || resolved.id || runtime?.portalKind || "generic");
        const fallback = registry?.runtimeFallback?.(resolved.portalKind || location.hostname) || {};
        const runtimeMatchesPortal = !runtime?.portalKind
            || runtime.portalKind === targetPortalKind;
        const remotePack = runtimeMatchesPortal
            ? (runtime?.pack || {})
            : { hotPath: runtime?.pack?.hotPath || {} };
        const normalized = {
            ...(runtime || {}),
            portalKind: targetPortalKind,
            adapterVersion: resolved.version || runtime?.adapterVersion || "1.0.0",
            pack: {
                ...fallback,
                ...remotePack,
                skipSelectors: [...new Set([...(fallback.skipSelectors || []), ...(remotePack.skipSelectors || [])])],
                skipAncestorSelectors: [...new Set([...(fallback.skipAncestorSelectors || []), ...(remotePack.skipAncestorSelectors || [])])],
                fileFields: {
                    ...(fallback.fileFields || {}),
                    ...(remotePack.fileFields || {}),
                    resume: { ...(fallback.fileFields?.resume || {}), ...(remotePack.fileFields?.resume || {}) },
                    coverLetter: { ...(fallback.fileFields?.coverLetter || {}), ...(remotePack.fileFields?.coverLetter || {}) }
                },
                overlays: { ...(fallback.overlays || {}), ...(remotePack.overlays || {}) }
            }
        };
        globalThis.JobHunterAdapterRuntime?.apply?.(normalized);
        return normalized;
    }

    function adapterContext() {
        const resolved = globalThis.JobHunterAdapterRegistry?.resolveForPage?.(location, document)
            || globalThis.JobHunterAdapterRegistry?.resolve?.(location.hostname)
            || { id: "generic", portalKind: "generic", version: "1.0.0" };
        const runtime = globalThis.JobHunterAdapterRuntime?.current?.() || {};
        return {
            portalKind: runtime.portalKind || resolved.portalKind || resolved.id || "generic",
            adapterVersion: resolved.version || "1.0.0",
            extensionVersion: cachedExtensionVersion,
            mappingPackVersion: runtime.version || null,
            mappingStage: runtime.stage || "DEFAULT",
            mappingPackId: runtime.mappingPackId || null,
            killed: Boolean(runtime.killed),
            killReason: runtime.killReason || null
        };
    }

    function adapterPayload() {
        const adapter = adapterContext();
        return {
            portalKind: adapter.portalKind,
            adapterKind: adapter.portalKind,
            adapterVersion: adapter.adapterVersion,
            extensionVersion: adapter.extensionVersion,
            mappingPackVersion: adapter.mappingPackVersion,
            mappingStage: adapter.mappingStage,
            mappingPackId: adapter.mappingPackId
        };
    }

    function controlKindFor(type) {
        if (type === "choice-group" || type === "radio") return "choice-group";
        if (type === "select-one" || type === "select-multiple") return "select";
        if (type === "checkbox-group") return "checkbox";
        if (type === "date-parts" || type === "month") return "date";
        if (["file", "email", "tel", "number", "date", "combobox", "textarea", "checkbox"].includes(type)) return type;
        return "text";
    }

    function isSamePageApply(element) {
        const href = element?.getAttribute?.("href") || "";
        return href.startsWith("#") || (() => {
            try { const target = new URL(element.href, location.href); return target.origin === location.origin && target.pathname === location.pathname && Boolean(target.hash); } catch { return false; }
        })();
    }

    function hasEmbeddedApplicationFrame() {
        return [...document.querySelectorAll(embeddedApplicationSelector())].some((frame) => {
            const rect = frame.getBoundingClientRect();
            return rect.width > 0 && rect.height > 100;
        });
    }

    function textOf(element) {
        return String(element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
    }

    function labelText(element) {
        if (!element) return "";
        const clone = element.cloneNode(true);
        clone.querySelectorAll?.("input, textarea, select, option, button, [role=combobox], [role=listbox], [role=option]")
            .forEach((control) => control.remove());
        return textOf(clone);
    }

    function directlyAssociatedLabel(element) {
        const root = element.getRootNode?.() || document;
        const labelledBy = String(element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
            .map((id) => deepGetById(id, root)).filter(Boolean).map(textOf).filter(Boolean).join(" ");
        if (labelledBy) return labelledBy;
        const associated = element.id ? deepQuery(`label[for="${CSS.escape(element.id)}"]`, root) : null;
        if (labelText(associated)) return labelText(associated);
        const wrappingLabel = composedClosest(element, "label");
        return labelText(wrappingLabel);
    }

    function fieldHeadingText(container) {
        const lines = String(container?.innerText || "").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
        return lines.find((line) =>
            line.length >= 2 && line.length < 180
            && !genericControlLabel(line)
            && !/^drop or select/i.test(line)
            && !/^total \d+ file/i.test(line)
            && !/^\d+\s*\/\s*\d+$/.test(line)
            && !/^(?:x{1,2}\s+)?(?:strong\s+)?(?:yes|no)$/i.test(line)
        ) || "";
    }

    function contextualQuestionLabel(element) {
        let current = composedParent(element);
        for (let depth = 0; current && depth < 16; depth += 1, current = composedParent(current)) {
            const candidates = deepQueryAll(".application-label .text, .application-label, legend, [data-qa*='question-label'], [data-qa*='field-label'], [data-testid*='label'], .field-label, label", current);
            const question = candidates.find((candidate) => !candidate.contains(element) && textOf(candidate) && !genericControlLabel(textOf(candidate)) && !/^drop or select/i.test(textOf(candidate)));
            if (question) return textOf(question).replace(/\*+$/g, "").trim();
            const ownText = [...current.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim()).find(Boolean);
            if (ownText && ownText.length < 180 && !genericControlLabel(ownText)) return ownText.replace(/\*+$/g, "").trim();
            const controlCount = deepQueryAll("input:not([type=hidden]):not([type=file]), textarea, select, [role=combobox], [role=radiogroup]", current).length;
            if (controlCount > 0 && controlCount <= 3) {
                const heading = fieldHeadingText(current);
                if (heading) return heading.replace(/\*+$/g, "").trim();
            }
        }
        return "";
    }

    function opaqueControlToken(value) {
        const token = String(value || "").trim();
        if (!token) return false;
        if (/^(?:field|input|select|react-select)[-_]?\d+$/i.test(token)) return true;
        return /^[A-Za-z0-9_-]{6,}$/.test(token) && /[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token);
    }

    function genericControlLabel(value) {
        const token = String(value || "").trim();
        return opaqueControlToken(token)
            // A bare number is a control's current value, never its question.
            || /^\d{1,4}$/.test(token)
            || /^(?:select|search|textbox|input|choose|drop or select(?:\s*\([^)]*\))?|field(?:[\s_-]*\d+)?)$/i.test(token)
            // Ordinal fallbacks are display-only; they must not become mapping keys.
            || /^application field\s+\d+$/i.test(token);
    }

    function isAttachmentStatusNoise(element) {
        const blob = `${element.value || ""} ${element.getAttribute("aria-label") || ""} ${element.id || ""} ${textOf(element.parentElement)}`;
        return /(?:resume|cover[-_ ]?letter)-[a-f0-9]+\.pdf|\buploaded successfully\b|\\fakepath\\|\.pdf\b.*\bremove\b/i.test(blob);
    }

    function dynamicControlId(value) {
        return scanner.dynamicControlId(value);
    }

    function durableControlIdentity(value) {
        return scanner.durableControlIdentity(value);
    }

    function groupLabelFor(element) {
        const group = composedClosest(element, "fieldset, [role=group], .application-question, .question, .form-group, .field");
        if (!group) return "";
        return [
            group.getAttribute("aria-label"),
            textOf(deepQuery("legend, .application-label .text, .application-label, [data-qa*='question-label'], [data-qa*='field-label'], .field-label", group))
        ].find((value) => String(value || "").trim()) || "";
    }

    function uploadLabelFor(element) {
        return globalThis.JobHunterUploads?.uploadLabelFor?.(element) || "";
    }

    function documentUploadIdentity(element) {
        return globalThis.JobHunterUploads?.documentUploadIdentity?.(element) || "";
    }

    function isNamedDocumentUpload(element) {
        return globalThis.JobHunterUploads?.isNamedDocumentUpload?.(element) || false;
    }

    function isQuestionDisguisedAsUpload(label) {
        return globalThis.JobHunterUploads?.isQuestionDisguisedAsUpload?.(label) || false;
    }

    function isLabeledDocumentUpload(element) {
        return globalThis.JobHunterUploads?.isLabeledDocumentUpload?.(element) || false;
    }

    function isResumeUploadField(field) {
        return globalThis.JobHunterUploads?.isResumeUploadField?.(field) || false;
    }

    function isCoverLetterUploadField(field) {
        return globalThis.JobHunterUploads?.isCoverLetterUploadField?.(field) || false;
    }

    function isCoverLetterNoteField(field) {
        return globalThis.JobHunterUploads?.isCoverLetterNoteField?.(field) || false;
    }

    function dropZoneFor(element) {
        return globalThis.JobHunterUploads?.dropZoneFor?.(element) || element?.parentElement || element;
    }

    // Workday-style portals split one date question into month/day/year spin
    // buttons. Each section alone is meaningless, so they are detected and
    // filled as a single date field.
    function dateSectionKind(element) {
        return globalThis.JobHunterDates?.sectionKindFromElement?.(element) || null;
    }

    function dateSectionInputs(element) {
        return globalThis.JobHunterDates?.sectionInputs?.(element) || {};
    }

    function dateSectionLabel(element, index) {
        return globalThis.JobHunterDates?.pickSectionLabel?.(
            [groupLabelFor(element), contextualQuestionLabel(element), labelFor(element, index)],
            genericControlLabel
        ) || "Date";
    }

    function dateSectionValue(sections) {
        return globalThis.JobHunterDates?.sectionValue?.(sections) || "";
    }

    function labelFor(element, index) {
        const group = composedClosest(element, "fieldset, [role=group], .field, .application-question, .question, .form-group");
        const candidates = [
            element.type === "file" ? uploadLabelFor(element) : "",
            directlyAssociatedLabel(element),
            genericControlLabel(element.getAttribute("aria-label")) ? "" : element.getAttribute("aria-label"),
            contextualQuestionLabel(element),
            deepQuery("legend, .label, .field-label", group)?.innerText,
            element.getAttribute("placeholder"),
            durableControlIdentity(element.name),
            opaqueControlToken(element.id) ? "" : element.id
        ];
        return (candidates.find((value) => String(value || "").trim() && !genericControlLabel(value))
            || `Application field ${index + 1}`)
            .replace(/\s+/g, " ").trim();
    }

    function radioOptionLabel(element) {
        const label = composedClosest(element, "label");
        return textOf(deepQuery(".application-answer-alternative", label) || label) || element.value;
    }

    function bestContainer() {
        const candidates = deepQueryAll(formContainerSelector());
        return candidates.sort((a, b) =>
            fieldControls(b).length - fieldControls(a).length
        )[0] || document.body;
    }

    function fieldControls(container = bestContainer()) {
        const controls = scanner.collect(FIELD_SELECTOR, container, (element) => {
            if (element.type === "file") {
                if (isQuestionDisguisedAsUpload(uploadLabelFor(element))) return false;
                if (!visible(element) && !isNamedDocumentUpload(element) && !isLabeledDocumentUpload(element)) return false;
            } else if (!visible(element)) {
                return false;
            }
            if (String(element.className || "").includes("requiredInput")) return false;
            if (element.type === "search" && element.getAttribute("aria-label") === "Search") return false;
            if (element.getAttribute("role") === "combobox" && /^search$/i.test(element.getAttribute("aria-label") || "")) return false;
            if (composedClosest(element, "[role=listbox], [role=option]")) return false;
            if (element.id?.startsWith("g-recaptcha-response")) return false;
            // Portal UI libraries often add read-only display inputs and a
            // second combobox facade for one real field. Learn/fill the named
            // backing control once, not every visual component.
            if (element.readOnly && !element.isContentEditable) return false;
            if (element.getAttribute("role") === "combobox" && element.closest(".select2")) return false;
            if (/\.(?:countryCode|currency|salaryPeriod|months)$/i.test(element.name || "")) return false;
            if (isAttachmentStatusNoise(element)) return false;
            if (globalThis.JobHunterAdapterRuntime?.skipElement?.(element)) return false;
            const context = `${contextualQuestionLabel(element)} ${element.name || ""} ${element.getAttribute("aria-label") || ""}`;
            if (/robots?\s+only|do not enter if you(?:'|’)re human|honeypot/i.test(context)) return false;
            return true;
        });
        const identifiableUploads = controls.filter((element) => element.type === "file"
            && /resume|cv|cover.?letter|portfolio/i.test(`${element.name || ""} ${element.id || ""} ${element.getAttribute("data-field") || ""} ${element.getAttribute("data-testid") || ""} ${element.getAttribute("data-qa") || ""}`));
        return controls.filter((element) => element.type !== "file" || !identifiableUploads.length
            || identifiableUploads.includes(element)
            || Boolean(element.name || element.id || element.getAttribute("aria-label")));
    }

    function normalizedToken(value) {
        return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 120);
    }

    function selectorCandidatesFor(element) {
        const candidates = [];
        const add = (value) => { if (value && !candidates.includes(value)) candidates.push(value); };
        const durableName = durableControlIdentity(element.name);
        if (durableName) add(`${element.tagName.toLowerCase()}[name="${CSS.escape(durableName)}"]`);
        if (element.getAttribute("autocomplete")) add(`[autocomplete="${CSS.escape(element.getAttribute("autocomplete"))}"]`);
        for (const attribute of ["data-testid", "data-qa", "data-field", "data-automation-id", "aria-label"]) {
            const value = attribute === "aria-label"
                ? element.getAttribute(attribute)
                : durableControlIdentity(element.getAttribute(attribute));
            if (value) add(`[${attribute}="${CSS.escape(value)}"]`);
        }
        if (element.id && !dynamicControlId(element.id)
            && !/(?:^|[-_])(\d{5,}|[a-f0-9]{12,})(?:$|[-_])/i.test(element.id)) add(`#${CSS.escape(element.id)}`);
        return candidates.slice(0, 8);
    }

    function structuralMetadata(element, type, label, index = 0) {
        const rawId = element.id || "";
        const stableId = dynamicControlId(rawId) ? "" : rawId;
        const aria = genericControlLabel(element.getAttribute("aria-label")) ? "" : element.getAttribute("aria-label");
        const identity = durableControlIdentity(element.name)
            || durableControlIdentity(element.getAttribute("data-testid"))
            || durableControlIdentity(element.getAttribute("data-qa"))
            || durableControlIdentity(element.getAttribute("data-automation-id"))
            || element.getAttribute("autocomplete") || aria || label || stableId;
        const container = composedClosest(element, "fieldset, [role=group], .application-question, .question, .form-group, .row") || composedParent(element);
        const containerSignature = normalizedToken(`${container?.tagName || ""}.${String(container?.className || "")} ${textOf(deepQuery("legend,label,.field-label", container))}`);
        const genericOrdinal = genericControlLabel(identity) || genericControlLabel(label) ? `:${index + 1}` : "";
        return {
            portalFieldKey: `${normalizedToken(identity)}:${normalizedToken(type)}:${containerSignature}${genericOrdinal}`,
            selectorCandidates: selectorCandidatesFor(element),
            containerSignature
        };
    }

    function structuredSectionFor(element) {
        const structuralId = String(element?.id || element?.name || "");
        if (/^experienceData\[\d+\](?:\.|\[)/i.test(structuralId)) return "experience";
        if (/^(?:educationData|education)\[\d+\](?:\.|\[)/i.test(structuralId)) return "education";
        if (/^(?:company-name|title|start-date-(?:month|year)|end-date-(?:month|year)|current-role)-\d+(?:_\d+)?$/i.test(structuralId)) return "experience";
        if (/^(?:degree|start-year|end-year)--?\d+$/i.test(structuralId)) return "education";
        const section = composedClosest(element, '[data-test="experience"], [data-test="education"], oc-experience, oc-education, .employment-form, .employment--container, .education--form, .education--container');
        const token = `${section?.getAttribute?.("data-test") || ""} ${section?.tagName || ""} ${section?.className || ""}`.toLowerCase();
        if (token.includes("experience")) return "experience";
        if (token.includes("employment")) return "experience";
        if (token.includes("education")) return "education";
        return "";
    }

    function sectionHeadingFor(element) {
        let current = composedParent(element);
        for (let depth = 0; current && depth < 12; depth += 1, current = composedParent(current)) {
            const heading = deepQuery("legend, h1, h2, h3, h4, [role=heading], .section-title, .section-heading, [data-qa*='section'], [data-testid*='section']", current);
            const value = textOf(heading);
            if (value && value.length <= 180 && !genericControlLabel(value)) return value;
        }
        return "";
    }

    function firstHeading(container, selector) {
        return deepQueryAll(selector, container).map(textOf)
            .find((value) => value && value.length <= 180 && !genericControlLabel(value)) || "";
    }

    function semanticAttributesFor(element) {
        return {
            name: durableControlIdentity(element?.name),
            ariaLabel: genericControlLabel(element?.getAttribute?.("aria-label")) ? "" : (element?.getAttribute?.("aria-label") || ""),
            placeholder: element?.getAttribute?.("placeholder") || "",
            autocomplete: element?.getAttribute?.("autocomplete") || "",
            dataAutomationId: durableControlIdentity(element?.getAttribute?.("data-automation-id")),
            dataQa: durableControlIdentity(element?.getAttribute?.("data-qa")),
            dataTestId: durableControlIdentity(element?.getAttribute?.("data-testid")),
            tag: String(element?.tagName || "").toLowerCase()
        };
    }

    function enrichSemanticContext(fields) {
        const pageHeading = firstHeading(document, "h1, [role=heading][aria-level='1'], h2");
        const formHeading = firstHeading(bestContainer(), "h1, h2, h3, legend, [role=heading]");
        return fields.map((field, index) => {
            const element = control(field);
            const previous = fields[index - 1];
            const next = fields[index + 1];
            return {
                ...field,
                attributes: semanticAttributesFor(element),
                semanticContext: {
                    section: sectionHeadingFor(element) || field.sectionKind || "",
                    sectionFamily: field.sectionKind || "",
                    previous: previous ? { label: previous.label, canonical: previous.semanticKey || null } : { label: "", canonical: null },
                    next: next ? { label: next.label, canonical: next.semanticKey || null } : { label: "", canonical: null },
                    pageHeading,
                    formHeading
                }
            };
        });
    }

    function structuredSectionIndexFor(element, sectionKind) {
        const structuralId = String(element?.id || element?.name || "");
        const match = structuralId.match(/^(?:experienceData|educationData|education)\[(\d+)\]/i);
        if (match) return Number(match[1]);
        const greenhouse = structuralId.match(/(?:-|--)(\d+)(?:_\d+)?$/);
        if (greenhouse) return Number(greenhouse[1]);
        return globalThis.JobHunterRepeatables?.recordIndexFor?.(element, sectionKind) ?? 0;
    }

    function detectFields() {
        const controls = fieldControls();
        const fields = [];
        const radioNames = new Set();
        const checkboxNames = new Set();
        scanner.beginScan();
        const stableId = (...args) => scanner.stableId(...args);
        controls.forEach((element, index) => {
            const type = element.getAttribute("role") === "combobox" ? "combobox" : element.tagName === "SELECT" ? "select-one" : element.tagName === "TEXTAREA" ? "textarea" : (element.type || "text").toLowerCase();
            const sectionKind = structuredSectionFor(element);
            const sectionIndex = sectionKind ? structuredSectionIndexFor(element, sectionKind) : null;
            if (type === "radio") {
                const groupKey = element.name || `radio-${index}`;
                if (radioNames.has(groupKey)) return;
                radioNames.add(groupKey);
                const radios = controls.filter((control) => control.type === "radio" && (control.name || `radio-${controls.indexOf(control)}`) === groupKey);
                const label = groupLabelFor(element) || contextualQuestionLabel(element) || labelFor(element, index);
                const id = stableId(element, type, label, sectionKind, sectionIndex);
                scanner.bind(id, element, radios);
                fields.push({
                    id,
                    index,
                    label,
                    type,
                    name: element.name || "",
                    required: radios.some((radio) => Boolean(radio.required || radio.getAttribute("aria-required") === "true")),
                    value: radios.find((radio) => radio.checked)?.value || "",
                    options: radios.map((radio) => ({ value: radio.value, label: radioOptionLabel(radio) })),
                    sectionKind,
                    sectionIndex,
                    ...structuralMetadata(element, type, label, index)
                });
                return;
            }
            if (type === "checkbox" && element.name) {
                const checkboxes = controls.filter((control) => control.type === "checkbox" && control.name === element.name);
                if (checkboxes.length > 1) {
                    if (checkboxNames.has(element.name)) return;
                    checkboxNames.add(element.name);
                    const label = groupLabelFor(element) || labelFor(element, index);
                    const id = stableId(element, "checkbox-group", label, sectionKind, sectionIndex);
                    scanner.bind(id, element, checkboxes);
                    fields.push({
                        id,
                        index,
                        label,
                        type: "checkbox-group",
                        name: element.name,
                        required: checkboxes.some((checkbox) => Boolean(checkbox.required || checkbox.getAttribute("aria-required") === "true")),
                        value: checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => radioOptionLabel(checkbox)).join(", "),
                        options: checkboxes.map((checkbox) => ({ value: checkbox.value, label: radioOptionLabel(checkbox) })),
                        sectionKind,
                        sectionIndex,
                        ...structuralMetadata(element, "checkbox-group", label, index)
                    });
                    return;
                }
            }
            const datePartKind = dateSectionKind(element);
            if (datePartKind) {
                const sections = dateSectionInputs(element);
                const anchor = sections.month || sections.day || sections.year;
                if (anchor && anchor !== element) return;
                const label = dateSectionLabel(element, index);
                const id = stableId(element, "date-parts", label, sectionKind, sectionIndex);
                scanner.bind(id, element, Object.values(sections));
                fields.push({
                    id,
                    index,
                    label,
                    type: "date-parts",
                    name: element.name || "",
                    required: Object.values(sections).some((section) => Boolean(section.required || section.getAttribute("aria-required") === "true")),
                    value: dateSectionValue(sections),
                    options: [],
                    sectionKind,
                    sectionIndex,
                    ...structuralMetadata(element, "date-parts", label, index)
                });
                return;
            }
            const label = labelFor(element, index);
            const id = stableId(element, type, label, sectionKind, sectionIndex);
            scanner.bind(id, element);
                fields.push({
                    id,
                    index,
                    label,
                    type,
                    name: element.name || "",
                    required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
                    value: ["checkbox", "radio"].includes(type) ? (element.checked ? element.value || "true" : "") : element.value || "",
                    options: element.tagName === "SELECT" ? [...element.options].map((option) => ({ value: option.value, label: option.textContent.trim() })) : [],
                    sectionKind,
                    sectionIndex,
                    ...structuralMetadata(element, type, label, index)
                });
        });
        const occupied = new Set(fields.map((field) => scanner.control(field)).filter(Boolean));
        deepQueryAll("[role=radiogroup], fieldset, [role=group], .application-question", bestContainer()).forEach((block, groupIndex) => {
            const buttons = deepQueryAll("button, [role=radio]", block).filter((button) => visible(button) && !occupied.has(button));
            if (buttons.length < 2 || buttons.length > 6) return;
            const options = buttons.map((button) => ({ value: button.getAttribute("value") || buttonText(button), label: buttonText(button) }));
            if (options.filter((option) => /yes|no|consent/i.test(option.label)).length < 2) return;
            let questionRoot = block;
            for (let depth = 0; questionRoot && depth < 6; questionRoot = questionRoot.parentElement, depth += 1) {
                if (fieldHeadingText(questionRoot) && (questionRoot.querySelectorAll("[role=radiogroup]").length <= 1 || questionRoot === block)) break;
            }
            const label = fieldHeadingText(questionRoot || block) || groupLabelFor(buttons[0]) || `Application field ${fields.length + 1}`;
            if (genericControlLabel(label)) return;
            const id = stableId(buttons[0], "choice-group", label);
            scanner.bind(id, buttons[0], buttons);
            const selected = buttons.find((button) => button.getAttribute("aria-pressed") === "true" || button.getAttribute("aria-checked") === "true" || button.className?.toString?.().includes("selected"));
            fields.push({
                id,
                index: 1000 + groupIndex,
                label,
                type: "choice-group",
                name: buttons[0].getAttribute("name") || "",
                required: /\*$/.test(label) || /required|\*/i.test(textOf((questionRoot || block).querySelector("legend, .application-label, label")) || "") || Boolean(block.querySelector("[aria-required=true]")),
                value: selected ? buttonText(selected) : "",
                options,
                ...structuralMetadata(buttons[0], "choice-group", label, groupIndex)
            });
        });
        const safeFields = fields.map((field) => {
            const element = control(field);
            const parent = composedParent(element);
            const sibling = parent?.previousElementSibling;
            const nearbySafetyText = ["checkbox", "radio", "choice-group"].includes(field.type)
                ? `${textOf(parent)} ${textOf(sibling)}`.slice(0, 1200) : "";
            return {
                ...field,
                legal: LEGAL_TEXT.test(`${field.label} ${field.name} ${nearbySafetyText}`),
                sensitive: SENSITIVE_TEXT.test(`${field.label} ${field.name}`) || field.type === "password",
                skipLearning: genericControlLabel(field.label) || /^application field\s+\d+$/i.test(field.label)
            };
        });
        return enrichSemanticContext(safeFields);
    }

    function hasLikelyApplicationForm() {
        const files = deepQueryAll('input[type="file"]');
        if (files.some((element) => isNamedDocumentUpload(element) || isLabeledDocumentUpload(element) || (visible(element) && !isQuestionDisguisedAsUpload(uploadLabelFor(element))))) return true;
        if (globalThis.JobHunterAdapterRuntime?.isApplicationRoute?.(location)
            && fieldControls(document.body).length >= 3
            && /personal information|easy apply|application questions|resume/i.test(document.body.innerText)) return true;
        if (isWorkdayApplicationRoute() && fieldControls(document.body).length > 0
            && /current step|create account|my information|my experience|application questions|review/i.test(document.body.innerText)) return true;
        return deepQueryAll("form").some((form) => {
            const fields = deepQueryAll(FIELD_SELECTOR, form).filter(visible);
            const identity = deepQuery('input[type="email"], input[name*="email" i], input[name*="first" i], input[name*="last" i], input[autocomplete="given-name"], input[autocomplete="family-name"]', form);
            return fields.length >= 3 && Boolean(identity);
        });
    }

    function control(field) {
        return scanner.control(field);
    }

    function focusAndHighlightField(fieldId) {
        const fields = detectFields();
        const field = fields.find((f) => f.id === fieldId || f.name === fieldId || f.label === fieldId);
        const element = field ? control(field) : deepGetById(fieldId) || deepQuery(`[name="${CSS.escape(fieldId)}"]`);
        if (!element) return;
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        try { element.focus(); } catch {}
        const prevOutline = element.style.outline;
        const prevBoxShadow = element.style.boxShadow;
        element.style.outline = "3px solid #315ee7";
        element.style.boxShadow = "0 0 18px rgba(49, 94, 231, 0.75)";
        setTimeout(() => {
            element.style.outline = prevOutline;
            element.style.boxShadow = prevBoxShadow;
        }, 3000);
    }

    const executor = globalThis.JobHunterRuntimeExecutor.create({ ownership, setStatus });
    const dispatch = (element, eventTypes) => executor.dispatch(element, eventTypes);
    const setNativeValue = (element, value) => executor.setNativeValue(element, value);

    function comboboxListbox(element) {
        const ownedId = element.getAttribute("aria-controls") || element.getAttribute("aria-owns");
        const activeId = element.getAttribute("aria-activedescendant");
        const derived = element.id ? deepGetById(`react-select-${element.id}-listbox`) : null;
        const owned = (ownedId ? deepGetById(ownedId) : null) || derived;
        const active = activeId ? deepGetById(activeId) : null;
        if (owned) return owned;
        const activeScope = composedClosest(active, "[role=listbox], [role=list], ul, ol, div");
        if (activeScope) return activeScope;
        // Some accessible widgets (including Pinpoint's country picker) render
        // one portal listbox but omit aria-controls. Only use this fallback
        // when the page exposes exactly one visible listbox, so options from a
        // different open combobox can never be selected by accident.
        const visibleListboxes = deepQueryAll('[role="listbox"]')
            .filter((listbox) => visible(listbox));
        return visibleListboxes.length === 1 ? visibleListboxes[0] : null;
    }

    function comboboxOptions(element) {
        const scope = comboboxListbox(element);
        if (!scope) return [];
        return deepQueryAll(
            '[role="option"], [role="listbox"] li, .select2-results__option, [class*="option"], [id*="-option-"]'
        , scope).filter((node) => (visible(node) || node.id === element.getAttribute("aria-activedescendant"))
            && node.getAttribute("aria-disabled") !== "true");
    }

    function comboboxOptionText(option) {
        return String(option?.getAttribute?.("aria-label") || option?.textContent || option?.innerText || "")
            .replace(/\s+/g, " ").trim();
    }

    function activateComboboxOption(option) {
        if (!option) return false;
        if (typeof PointerEvent === "function") {
            option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerType: "mouse" }));
        }
        option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
        // React Select commits on mousedown and can synchronously remove the
        // option. Preserve the browser event order for widgets that commit on
        // mouseup/click instead.
        if (!option.isConnected) return true;
        option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true }));
        if (typeof PointerEvent === "function") {
            option.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerType: "mouse" }));
        }
        option.click();
        return true;
    }

    async function selectComboboxByKeyboard(element, answer, evidence = null) {
        element.focus();
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true, composed: true }));
        await delay(80);
        const activeId = element.getAttribute("aria-activedescendant");
        const active = activeId ? deepGetById(activeId) : null;
        const match = active ? optionMatchDetails(comboboxOptionText(active), answer) : null;
        if (active && match?.confidence >= 0.8) {
            const selectedText = comboboxOptionText(active);
            element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, composed: true }));
            const verified = await verifyComboboxSelection(element, answer, selectedText);
            if (evidence) {
                evidence.matchConfidence = match.confidence;
                evidence.matchClass = match.matchClass;
                evidence.selectionVerified = verified;
            }
            return verified;
        }
        // Never choose the first highlighted option merely because the ATS
        // highlighted it. SmartRecruiters and similar widgets commonly
        // highlight a fuzzy suggestion that is unrelated to the requested
        // city/title/company. An unmatched option must stay in review.
        return false;
    }

    async function textFillStuck(element, expected) {
        return verifier.verifyText(element, expected);
    }

    async function typeIntoCombobox(element, text) {
        if (!(element instanceof HTMLInputElement) || !setNativeValue(element, "")) return false;
        element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "deleteContentBackward", data: null }));
        let typed = "";
        for (const character of String(text)) {
            element.dispatchEvent(new KeyboardEvent("keydown", { key: character, bubbles: true, cancelable: true, composed: true }));
            typed += character;
            if (!setNativeValue(element, typed)) return false;
            element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: character }));
            element.dispatchEvent(new KeyboardEvent("keyup", { key: character, bubbles: true, cancelable: true, composed: true }));
            await delay(12);
        }
        return true;
    }

    function comboboxSearchQueries(answer) {
        const text = String(answer || "").trim();
        const leading = text.split(",")[0].trim();
        const withoutQualifier = text.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
        const aliases = [
            [/\bgurugram\b/i, "Gurgaon"], [/\bgurgaon\b/i, "Gurugram"],
            [/\bbengaluru\b/i, "Bangalore"], [/\bbangalore\b/i, "Bengaluru"],
            [/\bmumbai\b/i, "Bombay"], [/\bkolkata\b/i, "Calcutta"]
        ];
        const queries = [text, leading, withoutQualifier];
        for (const [pattern, replacement] of aliases) {
            if (pattern.test(leading)) queries.push(leading.replace(pattern, replacement));
        }
        return [...new Set(queries.map((item) => item.trim()).filter(Boolean))].slice(0, 4);
    }

    function comboboxSelectedDisplay(element) {
        const root = composedClosest(element, ".select__control, [data-select-root], [class*='select-control']")
            || composedParent(composedParent(element)) || composedParent(element);
        const selectedNode = deepQuery(
            ".select__single-value, [class*='single-value'], [class*='singleValue'], [data-selected-value]",
            root
        );
        const selectedText = selectedNode?.getAttribute?.("data-selected-value") || textOf(selectedNode);
        if (String(selectedText || "").trim()) return String(selectedText).trim();
        const selectedOption = comboboxOptions(element).find((option) =>
            option.getAttribute("aria-selected") === "true" || option.getAttribute("aria-checked") === "true");
        if (selectedOption) return textOf(selectedOption).trim();
        const typed = String(element.value || "").trim();
        return element.getAttribute("aria-expanded") === "true" ? "" : typed;
    }

    async function waitForComboboxOptions(element, timeoutMs = 900) {
        const started = performance.now();
        let lastCount = -1;
        let stableReads = 0;
        while (performance.now() - started < timeoutMs) {
            const options = comboboxOptions(element);
            if (options.length) {
                stableReads = options.length === lastCount ? stableReads + 1 : 0;
                if (stableReads >= 1) return options;
                lastCount = options.length;
            }
            await delay(80);
        }
        return comboboxOptions(element);
    }

    const verifier = globalThis.JobHunterRuntimeVerifier.create({
        delay,
        selectedComboboxDisplay: comboboxSelectedDisplay,
        optionMatchScore,
        textVerifyDelay: () => globalThis.JobHunterAdapterRuntime?.textVerifyDelayMs?.() || 120
    });

    async function verifyComboboxSelection(element, answer, selectedText) {
        return verifier.verifyCombobox(element, answer, selectedText);
    }

    /**
     * Location and school comboboxes only accept a value the widget itself
     * selected, and they render suggestions after a debounce. Typing the full
     * answer, then its leading segment, covers "Gurugram, Haryana, India" style
     * profile values against "Gurugram" style suggestion lists.
     */
    async function fillCombobox(element, answer, field = {}) {
        const text = String(answer ?? "").trim();
        if (!text) return false;
        const original = element.value;
        const evidence = {
            widgetMode: "FINITE",
            candidateCount: 0,
            queryAttempts: 0,
            matchConfidence: 0,
            matchClass: "NONE",
            selectionVerified: false
        };
        if (field.id) comboboxSelectionEvidence.set(field.id, evidence);

        const tryVisibleOptions = async () => {
            const candidates = await waitForComboboxOptions(element);
            evidence.candidateCount = Math.max(evidence.candidateCount, candidates.length);
            const match = bestComboboxOption(candidates, text, comboboxOptionText);
            if (!match || match.confidence < 0.8) return false;
            const selectedText = comboboxOptionText(match.candidate);
            evidence.matchConfidence = match.confidence;
            evidence.matchClass = match.matchClass;
            activateComboboxOption(match.candidate);
            evidence.selectionVerified = await verifyComboboxSelection(element, text, selectedText);
            return evidence.selectionVerified;
        };

        element.focus();
        element.click();
        if (await tryVisibleOptions()) return true;

        evidence.widgetMode = "SEARCH";
        for (const query of comboboxSearchQueries(text)) {
            evidence.queryAttempts += 1;
            element.click();
            if (!(await typeIntoCombobox(element, query))) break;
            await delay(180 + (120 * evidence.queryAttempts));
            if (await tryVisibleOptions()) return true;
            if (await selectComboboxByKeyboard(element, text, evidence)) return true;
        }
        // Leaving typed-but-unselected text behind makes the employer form look
        // complete while it is still invalid, so restore what the page had.
        if (element.value !== original) {
            setNativeValue(element, original);
            element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertReplacementText", data: original }));
        }
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, composed: true }));
        return false;
    }

    async function fill(field, answer, options = {}) {
        const element = control(field);
        if (!element) return false;
        return executor.execute(field, options, async () => {
        if (field.type === "checkbox-group") {
            const checkboxes = deepQueryAll(`input[type=checkbox][name="${CSS.escape(field.name)}"]`, bestContainer());
            const requested = Array.isArray(answer)
                ? answer.map((value) => String(value).trim().toLowerCase())
                : String(answer).split(/\s*(?:,|\||;)\s*/).map((value) => value.trim().toLowerCase()).filter(Boolean);
            const targets = checkboxes.filter((checkbox) => {
                const label = radioOptionLabel(checkbox).trim().toLowerCase();
                const value = String(checkbox.value || "").trim().toLowerCase();
                return requested.includes(label) || requested.includes(value);
            });
            if (!targets.length) return false;
            for (const checkbox of checkboxes) {
                lastFill.push({ element: checkbox, value: checkbox.value, checked: checkbox.checked });
                checkbox.checked = targets.includes(checkbox);
                dispatch(checkbox);
            }
            return true;
        }
        if (field.type === "date-parts") {
            const dates = globalThis.JobHunterDates;
            const values = dates?.sectionValues?.(dates?.parseDateParts?.(answer));
            if (!values) return false;
            const sections = dateSectionInputs(element);
            let wrote = false;
            for (const kind of ["month", "day", "year"]) {
                const section = sections[kind];
                if (!section || !values[kind]) continue;
                lastFill.push({ element: section, value: section.value, checked: false });
                if (!setNativeValue(section, values[kind])) continue;
                dispatch(section);
                wrote = true;
            }
            return wrote && Boolean(sections.month && sections.year);
        }
        if (field.type === "choice-group") {
            const block = composedClosest(element, "fieldset, [role=radiogroup], [role=group], .application-question") || composedParent(element);
            const buttons = deepQueryAll("button, [role=radio]", block).filter(visible);
            const target = bestMatchingOption(buttons, answer, buttonText);
            if (!target) return false;
            lastFill.push({ element: target, value: buttonText(target), checked: false });
            target.click();
            return true;
        }
        lastFill.push({ element, value: element.value, checked: element.checked });
        if (field.type === "checkbox") {
            element.checked = /^(yes|true|1|agree|accepted)$/i.test(String(answer));
        } else if (field.type === "radio") {
            const radios = field.name ? deepQueryAll(`input[type=radio][name="${CSS.escape(field.name)}"]`, bestContainer()) : [element];
            const target = radios.find((radio) => {
                const label = labelFor(radio, 0);
                return [radio.value, label].some((value) => String(value).trim().toLowerCase() === String(answer).trim().toLowerCase());
            });
            if (!target) return false;
            target.checked = true;
            dispatch(target);
            return true;
        } else if (field.type === "combobox") {
            return await fillCombobox(element, answer, field);
        } else if (field.type === "select-one") {
            if (!(element instanceof HTMLSelectElement)) return false;
            const options = [...element.options];
            const option = options.find((item) => [item.value, item.textContent.trim()].some((value) => String(value).toLowerCase() === String(answer).toLowerCase()));
            if (!option) return false;
            
            if (!setNativeValue(element, option.value)) return false;
            
            element.selectedIndex = options.indexOf(option);
            dispatch(element);
        } else if (element.isContentEditable) {
            element.focus();
            element.textContent = String(answer);
            element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: String(answer) }));
            element.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
            return true;
        } else {
            // Honour a date mask the control declares (MM/YYYY on Workday,
            // dd/MM/yyyy on India-first portals) so the employer does not
            // reject a correct answer for its shape.
            const formatted = globalThis.JobHunterDates?.formatForField?.(answer, {
                inputType: element.type,
                placeholder: element.getAttribute("placeholder"),
                ariaLabel: element.getAttribute("aria-label"),
                title: element.getAttribute("title"),
                label: field.label
            });
            if (!setNativeValue(element, formatted || answer)) return false;
            dispatch(element);
            return textFillStuck(element, formatted || answer);
        }
        dispatch(element);
        return true;
        });
    }

    function base64File(base64, contentType, name) {
        return globalThis.JobHunterUploads?.base64File?.(base64, contentType, name);
    }

    function assignFilesToControl(element, transfer) {
        return globalThis.JobHunterUploads?.assignFilesToControl?.(element, transfer);
    }

    // Portals like Rippling swap the file input for a new node after a drop and
    // render the accepted file as text, so a single `files` read reports a
    // false failure. Confirm from either the control or the visible receipt.
    function attachmentConfirmed(element, filename) {
        return globalThis.JobHunterUploads?.attachmentConfirmed?.(element, filename) || false;
    }

    async function attachDocument(field, messageType, filename) {
        return globalThis.JobHunterUploads?.attachDocument?.(field, messageType, filename);
    }

    async function fillCoverLetterNote(fields) {
        return globalThis.JobHunterUploads?.fillCoverLetterNote?.(fields);
    }

    async function replaceResumeDocument() {
        return globalThis.JobHunterUploads?.replaceResumeDocument?.();
    }

    async function attachApplicationDocuments(fields) {
        return globalThis.JobHunterUploads?.attachApplicationDocuments?.(fields);
    }

    function fileInputNear(node) {
        return globalThis.JobHunterUploads?.fileInputNear?.(node) || null;
    }

    function documentDropInputs(kind) {
        return globalThis.JobHunterUploads?.documentDropInputs?.(kind) || [];
    }

    function ensureDropStyles() {
        return globalThis.JobHunterUploads?.ensureDropStyles?.();
    }

    function highlightDocumentDrops(kind) {
        return globalThis.JobHunterUploads?.highlightDocumentDrops?.(kind);
    }

    function clearDocumentDrag() {
        return globalThis.JobHunterUploads?.clearDocumentDrag?.();
    }

    function beginDocumentDrag(kind, jobId) {
        return globalThis.JobHunterUploads?.beginDocumentDrag?.(kind, jobId);
    }

    async function attachDraggedDocument(kind, target) {
        return globalThis.JobHunterUploads?.attachDraggedDocument?.(kind, target);
    }

    function liveDocumentTargets() {
        const fields = detectFields();
        const uploads = fields.filter((field) => field.type === "file" && !isQuestionDisguisedAsUpload(field.label));
        const resumeUploads = uploads.filter((field) => !isCoverLetterUploadField(field));
        const resumeField = resumeUploads.find((field) => isResumeUploadField(field))
            || (resumeUploads.length === 1 ? resumeUploads[0] : null);
        const coverField = uploads.find((field) => isCoverLetterUploadField(field));
        const coverNote = fields.find((field) => isCoverLetterNoteField(field));
        const usable = (field) => {
            const element = field ? control(field) : null;
            if (!element?.isConnected) return false;
            return visible(element) || visible(dropZoneFor(element)) || isNamedDocumentUpload(element) || isLabeledDocumentUpload(element);
        };
        return {
            resume: { available: usable(resumeField), fieldId: resumeField?.id || null, mode: resumeField ? "file" : null },
            cover: {
                available: usable(coverField) || Boolean(coverNote && visible(control(coverNote))),
                fieldId: coverField?.id || coverNote?.id || null,
                mode: usable(coverField) ? "file" : coverNote && visible(control(coverNote)) ? "text" : null
            }
        };
    }

    function installDocumentDropBridge() {
        return globalThis.JobHunterUploads?.installDocumentDropBridge?.();
    }

    function setStatus(text, kind = "normal") {
        if (!statusNode) return;
        statusNode.textContent = text;
        statusNode.dataset.kind = kind;
        if (timelineNode) {
            const item = document.createElement("div");
            item.className = "event";
            item.textContent = text;
            timelineNode.prepend(item);
            while (timelineNode.children.length > 5) timelineNode.lastElementChild.remove();
        }
    }

    function evidenceSignature(field) {
        const durableName = durableControlIdentity(field.name);
        return `${String(durableName || field.portalFieldKey || field.id || "field").toLowerCase()}|${String(field.type || "text").toLowerCase()}|${String(field.label || "").toLowerCase().replace(/\s+/g, " ").trim()}`.slice(0, 500);
    }

    async function sha256Text(value) {
        if (value == null || String(value) === "") return null;
        // Some local/insecure fixture contexts do not expose Web Crypto. A
        // missing strong hash must suppress value-linked evidence, not turn an
        // otherwise verified DOM fill into a failure or fall back to a weak
        // reversible hash.
        if (!globalThis.crypto?.subtle?.digest) return null;
        const bytes = new TextEncoder().encode(String(value));
        const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
    }

    function contractId(prefix) {
        return `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    }

    function nextRevisionSequence(fieldId) {
        const next = (revisionSequenceByField.get(fieldId) || 0) + 1;
        revisionSequenceByField.set(fieldId, next);
        return next;
    }

    function formGroupIdFor(field) {
        return String(`${field.sectionKind || "application"}-${field.sectionIndex ?? 0}`)
            .replace(/[^A-Za-z0-9._:@/-]+/g, "-").slice(0, 160) || "application";
    }

    async function logicalIdentityFor(field) {
        return {
            runId: String(activeRunContext?.runId || ""),
            pageGeneration,
            formGeneration,
            formGroupId: formGroupIdFor(field),
            logicalFieldFingerprint: await sha256Text(`${evidenceSignature(field)}|${formGroupIdFor(field)}`),
            fieldInstanceGeneration: Math.max(0, Number(field.sectionIndex) || 0)
        };
    }

    async function sendFieldRevision(field, session, eventType, { afterValueHash = null, actor = "CANDIDATE",
        canonicalKey = null, answerVersionId = null } = {}) {
        if (!activeJob || !activeRunContext?.runId || !field || field.legal || field.sensitive || field.type === "password") return null;
        const sequence = nextRevisionSequence(field.id);
        const revisionId = contractId("revision");
        const payload = {
            schemaVersion: 1,
            revisionId,
            identity: await logicalIdentityFor(field),
            operationId: telemetry.lastOperationId(field.id),
            editSessionId: session?.editSessionId || null,
            sequence,
            actor,
            eventType,
            beforeValueHash: session?.initialValueHash || null,
            intendedValueHash: session?.intendedValueHash || null,
            afterValueHash,
            canonicalKey: canonicalKey || field.semanticKey || session?.semanticKey || null,
            answerVersionId,
            representationVersionId: null,
            strategyVersionId: null,
            clientTimeMs: Date.now(),
            valueFree: true
        };
        const result = await message({ type: "RECORD_FIELD_REVISION", jobId: activeJob.id, payload }).catch(() => null);
        return result ? sequence : null;
    }

    async function sendEditSession(field, session, status, finalValueHash = null, interruptionReason = null) {
        if (!activeJob || !activeRunContext?.runId || !session) return;
        const payload = {
            schemaVersion: 1,
            editSessionId: session.editSessionId,
            identity: await logicalIdentityFor(field),
            startedAtMs: session.startedAtMs,
            lastActivityAtMs: session.lastActivityAtMs,
            endedAtMs: status === "OPEN" ? null : Date.now(),
            status,
            firstRevisionSequence: session.firstRevisionSequence,
            lastRevisionSequence: session.lastRevisionSequence,
            initialValueHash: session.initialValueHash,
            finalValueHash,
            interruptionReason
        };
        await message({ type: "RECORD_EDIT_SESSION", jobId: activeJob.id, payload }).catch(() => null);
    }

    async function beginFieldEdit(field) {
        if (!activeJob || !activeRunContext?.runId || !field || field.legal || field.sensitive || field.type === "password") return null;
        const existing = editSessionByField.get(field.id);
        if (existing && !existing.closing) return existing;
        if (editSessionStartByField.has(field.id)) return editSessionStartByField.get(field.id);
        const starting = (async () => {
            const snapshot = fieldSnapshot(field);
            const verified = verifiedFillLedger.get(field.id);
            const initialValueHash = await sha256Text(snapshot.value);
            const session = {
                editSessionId: contractId("edit"),
                startedAtMs: Date.now(),
                lastActivityAtMs: Date.now(),
                initialValueHash,
                lastValueHash: initialValueHash,
                intendedValueHash: await sha256Text(verified?.value),
                semanticKey: verified?.semanticKey || field.semanticKey || null,
                firstRevisionSequence: 0,
                lastRevisionSequence: 0,
                closing: false
            };
            editSessionByField.set(field.id, session);
            const sequence = await sendFieldRevision(field, session, "EDIT_STARTED", { afterValueHash: initialValueHash });
            if (sequence != null) {
                session.firstRevisionSequence = sequence;
                session.lastRevisionSequence = sequence;
                await sendEditSession(field, session, "OPEN", initialValueHash);
            }
            return session;
        })();
        editSessionStartByField.set(field.id, starting);
        try { return await starting; }
        finally { editSessionStartByField.delete(field.id); }
    }

    async function updateFieldEdit(field) {
        const session = await beginFieldEdit(field);
        if (!session || session.closing) return;
        session.lastActivityAtMs = Date.now();
        session.lastValueHash = await sha256Text(fieldSnapshot(field).value);
        const sequence = await sendFieldRevision(field, session, "EDIT_UPDATED", { afterValueHash: session.lastValueHash });
        if (sequence != null) session.lastRevisionSequence = sequence;
    }

    async function commitFieldEdit(field) {
        const session = editSessionByField.get(field.id) || await beginFieldEdit(field);
        if (!session || session.closing) return;
        session.closing = true;
        session.lastActivityAtMs = Date.now();
        const finalValueHash = await sha256Text(fieldSnapshot(field).value);
        session.lastValueHash = finalValueHash;
        const status = finalValueHash === session.initialValueHash ? "RESTORED" : "COMMITTED";
        const sequence = await sendFieldRevision(field, session, status === "RESTORED" ? "VALUE_REVERTED" : "EDIT_COMMITTED", { afterValueHash: finalValueHash });
        if (sequence != null) session.lastRevisionSequence = sequence;
        await sendEditSession(field, session, status, finalValueHash);
        editSessionByField.delete(field.id);
        clearTimeout(editUpdateTimerByField.get(field.id));
        editUpdateTimerByField.delete(field.id);
    }

    function scheduleFieldEditUpdate(field) {
        clearTimeout(editUpdateTimerByField.get(field.id));
        editUpdateTimerByField.set(field.id, setTimeout(() => {
            editUpdateTimerByField.delete(field.id);
            void updateFieldEdit(field);
        }, 250));
    }

    async function recordCheckpoint(type, status, source) {
        if (!activeJob || !activeRunContext?.runId || !activeRunContext.applicationId) return null;
        const evidenceHash = await sha256Text(`${type}|${status}|${location.origin}${location.pathname}|${dynamicPageFingerprint()}`);
        return message({
            type: "RECORD_CHECKPOINT_RECEIPT",
            jobId: activeJob.id,
            payload: {
                schemaVersion: 1,
                checkpointId: contractId("checkpoint"),
                runId: activeRunContext.runId,
                applicationId: activeRunContext.applicationId,
                applicationContentRevisionId: null,
                type,
                status,
                source,
                observedAtMs: Date.now(),
                evidenceHash,
                valueFree: true
            }
        }).catch(() => null);
    }

    function interruptOpenEditSessions(reason) {
        for (const [fieldId, session] of editSessionByField.entries()) {
            if (session.closing) continue;
            session.closing = true;
            const field = detectFields().find((item) => item.id === fieldId);
            if (!field) continue;
            void (async () => {
                const sequence = await sendFieldRevision(field, session, "INTERRUPTED", { afterValueHash: session.lastValueHash });
                if (sequence != null) session.lastRevisionSequence = sequence;
                await sendEditSession(field, session, "INTERRUPTED", session.lastValueHash, reason);
            })();
        }
    }

    async function rememberVerifiedFill(field, action = {}) {
        if (!field?.id || field.type === "file" || field.legal || field.sensitive) return;
        const semanticKey = action.semanticKey || action.normalizedKey || action.key || null;
        const valueHash = await sha256Text(action.value);
        const identity = activeRunContext?.runId ? await logicalIdentityFor(field) : null;
        verifiedFillLedger.set(field.id, {
            value: action.value,
            semanticKey,
            candidateAnswerVersionId: action.candidateAnswerVersionId || null,
            logicalFieldFingerprint: identity?.logicalFieldFingerprint || null,
            intendedValueHash: valueHash,
            source: action.source || "VERIFIED",
            repairAttempts: 0
        });
        if (action.candidateAnswerVersionId && valueHash) {
            await sendFieldRevision(field, { initialValueHash: null, intendedValueHash: valueHash, semanticKey },
                "READBACK", { afterValueHash: valueHash, actor: "COPILOT", canonicalKey: semanticKey,
                    answerVersionId: action.candidateAnswerVersionId });
        }
    }

    function knownFieldNeedsRepair(field) {
        const previous = verifiedFillLedger.get(field?.id);
        if (!previous || previous.repairAttempts >= 2 || ownership.isUserEdited(field.id) || ownership.isUserActive(field.id)) return false;
        const snapshot = fieldSnapshot(field, { source: previous.source });
        if (!snapshot.visible || snapshot.filled || field.legal || field.sensitive) return false;
        previous.repairAttempts += 1;
        return true;
    }

    function normalizeOptionText(value) {
        let normalized = String(value || "")
            .replace(/â€™|â€˜/g, "'").replace(/â€œ|â€/g, '"').replace(/â€“|â€”/g, "-")
            .normalize("NFKD").toLowerCase()
            .replace(/[’']/g, "").replace(/[✓x×*]+/g, " ")
            .replace(/[^a-z0-9+.,-]+/g, " ").replace(/\s+/g, " ").trim();
        const aliases = [
            [/\bgurgaon\b/g, "gurugram"], [/\bbangalore\b/g, "bengaluru"],
            [/\bbombay\b/g, "mumbai"], [/\bcalcutta\b/g, "kolkata"],
            [/\bmadras\b/g, "chennai"], [/\blinkedln\b/g, "linkedin"],
            [/\bbachelors\b/g, "bachelor"], [/\bmasters\b/g, "master"]
        ];
        for (const [pattern, replacement] of aliases) normalized = normalized.replace(pattern, replacement);
        return normalized.replace(/\s+/g, " ").trim();
    }

    function optionMatchDetails(optionText, answer) {
        const option = normalizeOptionText(optionText);
        const wanted = normalizeOptionText(answer);
        if (!option || !wanted) return { score: 0, confidence: 0, matchClass: "NONE" };
        if (option === wanted) return { score: 5, confidence: 1, matchClass: "EXACT" };
        if (option.replace(/\s+/g, "") === wanted.replace(/\s+/g, "")) return { score: 4, confidence: 0.98, matchClass: "NORMALIZED_EXACT" };
        if (option.startsWith(`${wanted},`)) return { score: 4, confidence: 0.92, matchClass: "QUALIFIED_EXACT" };
        const degreeLevel = (value) => {
            const compact = value.replace(/[^a-z0-9]/g, "");
            if (/^(?:be|btech|bachelor|bachelordegree|(?:be|btech|bachelor)(?:in|of).+)$/.test(compact)) return "BACHELOR";
            if (/^(?:me|mtech|ms|msc|master|masterdegree|(?:me|mtech|ms|msc|master)(?:in|of).+)$/.test(compact)) return "MASTER";
            if (/^(?:phd|doctorate|doctorofphilosophy)$/.test(compact)) return "DOCTORATE";
            if (/^(?:associate|associatedegree)$/.test(compact)) return "ASSOCIATE";
            if (/^(?:highschool|secondaryschool|12th)$/.test(compact)) return "HIGH_SCHOOL";
            return null;
        };
        const optionDegree = degreeLevel(option);
        const wantedDegree = degreeLevel(wanted);
        if (optionDegree && optionDegree === wantedDegree) {
            return { score: 4, confidence: 0.94, matchClass: "DEGREE_LEVEL_ALIAS" };
        }
        if (wanted === "company career site" && /\bcareer site\b/.test(option)) return { score: 4, confidence: 0.9, matchClass: "SOURCE_ALIAS" };
        if (/(?:^|\s)immediate(?:\s|$)/.test(option) && /immediate|no notice|available now|can start now/.test(wanted)) {
            return { score: 4, confidence: 0.9, matchClass: "AVAILABILITY_ALIAS" };
        }
        const years = Number(wanted.replace(/years?/, "").trim());
        const range = option.match(/^(\d+(?:\.\d+)?)\s*[-–to]+\s*(\d+(?:\.\d+)?)/i);
        if (Number.isFinite(years) && range && years >= Number(range[1]) && years <= Number(range[2])) {
            return { score: 4, confidence: 0.92, matchClass: "NUMERIC_RANGE" };
        }
        if (Number.isFinite(years) && /^\d+\+?$/.test(option) && Math.floor(years) === Number(option.replace("+", ""))) {
            return { score: 4, confidence: Number.isInteger(years) ? 0.96 : 0.86, matchClass: "NUMERIC_BUCKET" };
        }
        const moneyRange = option.match(/([\d,]+)\s*[-–]\s*([\d,]+)/);
        if (Number.isFinite(years) && moneyRange) {
            const annual = years < 1000 ? years * 100000 : years;
            const low = Number(moneyRange[1].replaceAll(",", ""));
            const high = Number(moneyRange[2].replaceAll(",", ""));
            if (annual >= low && annual <= high) return { score: 4, confidence: 0.92, matchClass: "COMPENSATION_RANGE" };
        }
        if (new RegExp(`(?:^|\\s)${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(option) && Math.abs(option.length - wanted.length) <= 4) {
            return { score: 3, confidence: 0.74, matchClass: "TOKEN_MATCH" };
        }
        if (wanted.includes(option) && option.length >= 4) return { score: 2, confidence: 0.55, matchClass: "PARTIAL" };
        return { score: 0, confidence: 0, matchClass: "NONE" };
    }

    function optionMatchScore(optionText, answer) {
        return optionMatchDetails(optionText, answer).score;
    }

    function bestComboboxOption(candidates, answer, readText) {
        const ranked = candidates.map((candidate) => ({ candidate, ...optionMatchDetails(readText(candidate), answer) }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score || b.confidence - a.confidence);
        if (!ranked.length) return null;
        const best = ranked[0];
        const second = ranked[1];
        if (second && best.score === second.score
            && normalizeOptionText(readText(best.candidate)) !== normalizeOptionText(readText(second.candidate))) return null;
        return best;
    }

    function bestMatchingOption(candidates, answer, readText) {
        let best = null;
        let score = 0;
        for (const candidate of candidates) {
            const next = optionMatchScore(readText(candidate), answer);
            if (next > score) {
                score = next;
                best = candidate;
            }
        }
        return score ? best : null;
    }

    function selectedControlValue(element) {
        if (element?.getAttribute?.("role") === "combobox") return comboboxSelectedDisplay(element);
        const typed = String(element.value || element.textContent || "").trim();
        const selected = deepQueryAll('[role="option"][aria-selected="true"], [role="option"][aria-current="true"]')
            .map((option) => textOf(option)).find((value) => value && (!typed || value.toLowerCase().includes(typed.toLowerCase())));
        if (selected && selected.length >= typed.length) return selected;
        return typed;
    }

    function selectedChoiceValue(field, element) {
        const block = composedClosest(element, "fieldset, [role=radiogroup], [role=group], .application-question") || composedParent(element);
        const selected = deepQueryAll("button, [role=radio]", block).find((button) =>
            button.getAttribute("aria-pressed") === "true" || button.getAttribute("aria-checked") === "true" || /selected|checked|active/i.test(String(button.className || "")));
        return selected ? buttonText(selected) : "";
    }

    function fieldSnapshot(field, { action = null, source = null } = {}) {
        const element = control(field);
        if (!element) return { ...field, fieldSignature: evidenceSignature(field), value: null, visible: false, filled: false, valid: false, finalState: "HIDDEN", source };
        const checkboxGroup = field.type === "checkbox-group"
            ? deepQueryAll(`input[type=checkbox][name="${CSS.escape(field.name)}"]`, bestContainer())
            : [];
        const selectedCheckboxes = checkboxGroup.filter((checkbox) => checkbox.checked);
        const value = field.type === "radio"
            ? (deepQueryAll(`input[type=radio][name="${CSS.escape(field.name)}"]`, bestContainer()).find((radio) => radio.checked)?.value || "")
            : field.type === "checkbox-group" ? selectedCheckboxes.map((checkbox) => radioOptionLabel(checkbox)).join(", ")
            : field.type === "choice-group" ? selectedChoiceValue(field, element)
            : field.type === "file" ? (element.files?.[0]?.name || "")
            : field.type === "checkbox" ? (element.checked ? element.value || "true" : "")
            : field.type === "date-parts" ? dateSectionValue(dateSectionInputs(element))
            : selectedControlValue(element);
        const exactOptionMatch = field.type === "checkbox-group"
            ? selectedCheckboxes.every((checkbox) => field.options.some((option) => String(option.value) === String(checkbox.value)))
            : !["radio", "select-one"].includes(field.type) || !value || field.options.some((option) => [option.value, option.label].some((candidate) => String(candidate).trim().toLowerCase() === String(value).trim().toLowerCase()));
        const isVisible = visible(element) || (field.type === "file" && Boolean(element.files?.length));
        const filled = field.type === "file" ? Boolean(element.files?.length) : Boolean(String(value).trim());
        const valid = field.type === "checkbox-group" ? (!field.required || selectedCheckboxes.length > 0) : element.checkValidity?.() !== false;
        const protectedField = field.legal || field.sensitive || field.type === "password";
        const intendedAction = action ? "FILL" : protectedField ? "LEGAL_BLOCK" : "NOT_ATTEMPTED";
        const finalState = field.type === "file"
            ? (filled ? "FILLED" : isVisible ? "UNCHANGED" : "HIDDEN")
            : !isVisible ? "HIDDEN"
            : ownership.isUserEdited(field.id) ? "USER_EDITED"
                : ownership.hasFillFailed(field.id) ? "BLOCKED"
                : !valid || exactOptionMatch === false ? "INVALID"
                    : action && filled ? "FILLED"
                        : protectedField ? "BLOCKED" : "UNCHANGED";
        const fillOutcome = finalState === "USER_EDITED" ? "USER_CORRECTED"
            : protectedField && !filled ? "LEGAL_BLOCK"
            : !action ? "NOT_ATTEMPTED"
            : action && filled && finalState === "FILLED" ? "FILLED"
            : action && !filled && finalState === "FILLED" ? "SNAPSHOT_LIE"
            : action && !filled ? "FILL_FAILED"
            : finalState;
        return {
            ...field,
            semanticKey: action?.semanticKey || action?.normalizedKey || action?.key || field.semanticKey || null,
            candidateAnswerVersionId: action?.candidateAnswerVersionId
                || verifiedFillLedger.get(field.id)?.candidateAnswerVersionId || null,
            logicalFieldId: verifiedFillLedger.get(field.id)?.logicalFieldFingerprint || null,
            intendedValueHash: verifiedFillLedger.get(field.id)?.intendedValueHash || null,
            fieldSignature: evidenceSignature(field),
            controlKind: controlKindFor(field.type),
            value: protectedField ? null : value,
            visible: isVisible,
            filled,
            valid,
            exactOptionMatch,
            confirmed: field.legal ? Boolean(element.checked) : undefined,
            finalState,
            fillOutcome,
            intendedAction,
            source: ownership.isUserEdited(field.id) ? "USER_MANUAL_INPUT" : source
        };
    }

    async function validateForm(fields, resumeAttached) {
        const snapshots = fields.map((field) => fieldSnapshot(field));
        const captchaRequired = snapshots.some((field) => field.required && field.sensitive && /captcha|verification\s+(?:code|challenge)/i.test(`${field.label} ${field.name || ""}`) && !field.filled);
        const result = await message({ type: "VALIDATE_FORM", jobId: activeJob.id, payload: { pageUrl: location.href, fields: snapshots, resumeAttached, captchaRequired } });
        if (result.status === "READY_TO_SUBMIT") {
            await recordCheckpoint("REVIEW", "VERIFIED", "DOM_VALIDATION");
            setStatus("Everything required is complete. I am ready for your review. Submit when satisfied.", "success");
        } else {
            await recordCheckpoint("LOCAL_VALIDITY", "REJECTED", "DOM_VALIDATION");
        }
        return result;
    }

    function sourceLabel(source, learned) {
        if (learned) return "Learned mapping";
        return ({ PROFILE: "Profile", RESUME: "Resume-derived", USER: "Saved answer", CANDIDATE_ANSWER: "Saved answer", AI_GROUNDED: "AI draft" })[source] || source || "Verified source";
    }

    let questionTimeout = null;

    function renderQuestion(question) {
        if (questionTimeout) {
            clearTimeout(questionTimeout);
            questionTimeout = null;
        }
        currentQuestion = question || null;
        if (!questionNode) return;
        if (!question) { questionNode.innerHTML = ""; return; }
        const prompt = escapeHtml(question.prompt || "I need one answer.").replace(/\n/g, "<br>");
        if (question.questionType === "MANUAL_ACTION") {
            questionNode.innerHTML = `<div class="prompt manual">${prompt} <button class="btn-jump" data-field-id="${escapeHtml(question.fieldId)}">🎯 Jump to field</button></div>`;
            return;
        }
        const options = Array.isArray(question.options) ? question.options : [];
        questionNode.innerHTML = `<div class="prompt">${prompt} <button class="btn-jump" data-field-id="${escapeHtml(question.fieldId)}">🎯 View field</button></div><div class="answer"></div>`;
        const answer = questionNode.querySelector(".answer");
        if (question.questionType === "CONFIRM_MAPPING") {
            answer.innerHTML = `<button data-answer="Yes" class="primary">Yes</button><button data-action="show-mapping-options">No</button><button data-action="skip">Skip</button>`;
            questionTimeout = setTimeout(() => {
                if (currentQuestion?.id === question.id) {
                    runAgentOperation("Skipping…", () => submitAgentAnswer("", { action: "SKIP" }));
                }
            }, 6000);
        } else if (question.questionType === "CHOOSE_OPTION" && options.length) {
            answer.innerHTML = `${options.slice(0, 12).map((option) => `<button data-answer="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`).join("")}<button data-action="skip">Skip</button>`;
        } else {
            answer.innerHTML = `<input aria-label="Answer" placeholder="Type your answer"><button class="primary send">Send</button><button data-action="skip">Skip</button><div class="scope">${String(question.answerScope || "APPLICATION_ONLY").replaceAll("_", " ").toLowerCase()}</div>`;
        }
    }

    function renderMissingFieldsSection(missingFields = []) {
        if (!manualSectionNode) return;
        if (!missingFields.length) {
            manualSectionNode.innerHTML = "";
            return;
        }
        const visibleFields = missingFields.slice(0, 5);
        const remainingText = missingFields.length > 5 ? `<div style="font-size: 11px; margin-top: 4px; color: #6b7280;">+ ${missingFields.length - 5} more field(s) hidden...</div>` : "";
        manualSectionNode.innerHTML = `
            <div class="manual-title">📋 Please fill these fields on the page:</div>
            <div class="chips-container" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">
                ${visibleFields.map((f) => `<button class="jump-chip" data-field-id="${escapeHtml(f.id)}" style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:12px;padding:4px 8px;font-size:12px;cursor:pointer;">🎯 ${escapeHtml(f.label)}</button>`).join("")}
            </div>
            ${remainingText}
        `;
    }

    function renderPlanSummary(response) {
        if (!manualSectionNode) return;
        const counts = response.plan?.summary || {};
        const conflicts = response.plan?.conflicts || [];
        pendingConflicts.clear();
        conflicts.forEach((item) => pendingConflicts.set(item.fieldId, item));
        const provenance = response.plan?.actions?.slice(0, 5).map((action) =>
            `<div class="event">✓ ${escapeHtml(action.provenance || sourceLabel(action.source, false))}</div>`).join("") || "";
        const conflictCards = conflicts.map((item) => `<div class="prompt conflict-card"><strong>${escapeHtml(item.label)}</strong><div>Application: ${escapeHtml(item.existingValue)}</div><div>${escapeHtml(item.provenance)}: ${escapeHtml(item.proposedValue)}</div><div class="answer"><button data-conflict="keep" data-field-id="${escapeHtml(item.fieldId)}">Keep application</button><button class="primary" data-conflict="profile" data-field-id="${escapeHtml(item.fieldId)}">Use saved value</button><button data-conflict="edit" data-field-id="${escapeHtml(item.fieldId)}">Edit</button></div></div>`).join("");
        manualSectionNode.innerHTML = `<div class="plan-card"><strong>Application plan</strong><div class="plan-counts"><span><b>${Number(counts.ready || 0)}</b> ready</span> · <span><b>${Number(counts.needsYou || 0)}</b> need you</span> · <span><b>${Number(counts.aiDrafts || 0)}</b> AI drafts</span> · <span><b>${Number(counts.manual || 0)}</b> manual</span></div>${provenance}${conflicts.length ? `<div class="conflict-note">${conflicts.length} existing value conflict(s) will not be overwritten.</div>` : ""}${conflictCards}</div>`;
        const process = shadowRoot?.querySelector("#process-form");
        if (process) process.textContent = "Fill safe fields";
    }

    function renderCorrectionPrompt(field, snapshot) {
        if (!manualSectionNode) return;
        const card = document.createElement("div");
        card.className = "prompt correction-card";
        card.innerHTML = `<strong>You changed ${escapeHtml(field.label)}</strong><div>Update this saved fact for future applications?</div><div class="answer"><button class="primary" data-correction="update">Update</button><button data-correction="application">Just this application</button></div>`;
        card.addEventListener("click", async (event) => {
            const choice = event.target.closest("[data-correction]")?.dataset.correction;
            if (!choice) return;
            if (choice === "update") await message({
                type: "SAVE_MANUAL_INPUT", jobId: activeJob.id,
                payload: { fieldId: field.id, fieldLabel: field.label, fieldType: field.type,
                    fieldSignature: evidenceSignature(field), options: field.options, name: field.name,
                    portalFieldKey: field.portalFieldKey, attributes: field.attributes,
                    semanticContext: field.semanticContext, required: field.required,
                    legal: field.legal, sensitive: field.sensitive, value: snapshot.value,
                    visible: snapshot.visible, valid: snapshot.valid, pageUrl: location.href,
                    promoteCorrection: true, recordSemanticEvidence: false }
            }).catch((error) => setStatus(`Could not update this fact: ${error.message}`, "warning"));
            card.remove();
        });
        manualSectionNode.appendChild(card);
    }

    function renderMappingOptions() {
        const options = Array.isArray(currentQuestion?.options) ? currentQuestion.options : [];
        const answer = questionNode?.querySelector(".answer");
        if (!answer) return;
        answer.innerHTML = options.slice(0, 5).map((option) => `
            <button class="mapping-option" data-semantic-key="${escapeHtml(option.value)}">
                <span>${escapeHtml(option.label)}</span><small>${escapeHtml(option.description || "")}</small>
            </button>`).join("") + `<button data-action="skip">Skip</button>`;
    }

    async function submitAgentAnswer(answer, extra = {}) {
        const fields = detectFields();
        const field = fields.find((item) => item.id === currentQuestion?.fieldId);
        const result = await message({
            type: "ANSWER_AGENT_QUESTION", jobId: activeJob.id, questionId: currentQuestion.id,
            payload: {
                answer,
                pageUrl: location.href,
                siteHost: currentQuestion.siteHost || location.hostname,
                fieldSignature: currentQuestion.fieldSignature || (field ? `${String(field.name || field.id).toLowerCase()}|${field.type}|${field.label.toLowerCase().replace(/\s+/g, " ").trim()}`.slice(0, 500) : ""),
                fieldLabel: currentQuestion.fieldLabel || field?.label || "",
                ...extra
            }
        });
        if (result.chooseMapping) { renderQuestion(result.nextQuestion); renderMappingOptions(); return; }
        renderQuestion(result.nextQuestion);
        await fillPage({ executePlan: true });
    }

    async function reportProgress(status, text, metadata = {}) {
        if (!activeJob) return null;
        return message({
            type: "REPORT_PROGRESS",
            jobId: activeJob.id,
            payload: { status, message: text, metadata: { pageUrl: location.href, ...adapterPayload(), ...metadata } }
        }).catch(() => null);
    }

    const telemetry = globalThis.JobHunterRuntimeTelemetry.create({
        emit: message,
        getJob: () => activeJob,
        adapterPayload,
        evidenceSignature,
        pageUrl: () => location.href,
        operationScope: () => `${location.origin}${location.pathname}`
    });
    const recordOperation = (payload) => telemetry.recordOperation(payload);
    const fieldOperation = (field, phase, status, options) => telemetry.fieldOperation(field, phase, status, options);

    function comboboxOperationMetadata(field) {
        return field?.type === "combobox" ? (comboboxSelectionEvidence.get(field.id) || {}) : {};
    }


    function bindAdapterModules() {
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        globalThis.JobHunterUploads?.bind?.({
            fieldHeadingText,
            genericControlLabel,
            dispatch,
            delay,
            control,
            message,
            get activeJob() { return activeJob; },
            detectFields,
            fill,
            fieldSnapshot,
            adapterPayload,
            refreshContext,
            recordOperation,
            setStatus,
            textOf,
            visible,
            deepQueryAll,
            deepQuery,
            composedParent,
            composedClosest,
            attachAttempts: ATTACH_ATTEMPTS
        });
        globalThis.JobHunterHops?.bind?.({
            visible,
            buttonText,
            adapterContext,
            hasLikelyApplicationForm,
            message,
            get activeJob() { return activeJob; },
            reportProgress,
            setStatus
        });
    }


    async function refreshContext({ replay = false } = {}) {
        const context = await message({ type: "JOB_CONTEXT", url: location.href, replay });
        activeJob = context.job;
        activeRunContext = context.runContext || null;
        // Keep lastActivity fresh so the background can adopt new tabs during active sessions
        if (activeJob) {
            try { chrome.storage.local.set({ lastActivity: Date.now() }).catch(() => {}); }
            catch (error) { if (isExtensionContextInvalidation(error)) deactivateInvalidatedContext(); }
        }
        return activeJob;
    }

    function localApplySurface() {
        return globalThis.JobHunterHops?.localApplySurface?.() || { mode: "PARTIAL", surface: "listing" };
    }

    function extractVisibleAssistQuestions() {
        return globalThis.JobHunterHops?.extractVisibleAssistQuestions?.() || [];
    }

    async function enterAssistMode(surface = localApplySurface()) {
        return globalThis.JobHunterHops?.enterAssistMode?.(surface);
    }

    async function continueApplication({ continuing = false } = {}) {
        setStatus("Finding the next Apply action…");
        if (!(await refreshContext())) throw new Error("Open this job from your Job Hunter dashboard first.");
        await reportProgress("OPENING", "Extension is locating the next application page.");
        const analysis = await message({
            type: "ANALYZE_PAGE", jobId: activeJob.id,
            payload: { pageUrl: location.href, pageText: document.body.innerText.slice(0, 40000) }
        });
        if (!analysis.eligibility.allowed) throw new Error(analysis.eligibility.reason);
        const button = findApplyButton();
        if (!button) {
            if (suppressedInstantApply()) {
                return enterAssistMode({ mode: "ASSIST", surface: "instant_apply", instantApply: true });
            }
            await reportProgress("PORTAL_CHANGED", "No Apply button or supported application form was detected.");
            setStatus("I could not find the next Apply control. Click Apply on this page, then use “Process this form” if filling does not start.", "warning");
            return { requiresUserClick: true };
        }
        if (!continuing) await message({ type: "START_NAVIGATION", jobId: activeJob.id });
        await message({ type: "NAVIGATION_HOP" });
        const href = button.href ? new URL(button.href, location.href).href : "";
        if (/^https?:\/\//i.test(href) && !isSamePageApply(button)) {
            setStatus("Opening the next application page…", "processing");
            await message({ type: "NAVIGATE_TAB", jobId: activeJob.id, url: href });
            return { navigated: true };
        }
        const previousUrl = location.href;
        setStatus("Opening the next application page…", "processing");
        button.click();
        await delay(2500);
        if (hasLikelyApplicationForm() || hasEmbeddedApplicationFrame()) {
            await message({ type: "STOP_NAVIGATION" }).catch(() => null);
            return fillPage({ executePlan: true });
        }
        if (location.href === previousUrl && !hasLikelyApplicationForm() && !hasEmbeddedApplicationFrame()) {
            const text = `I could not open this step automatically. Click “${buttonText(button) || "Apply"}” on the page, then press “Process this form”.`;
            setStatus(text, "warning");
            await reportProgress("USER_ACTION_REQUIRED", text, { navigationBlocked: true });
            return { requiresUserClick: true };
        }
        return { navigated: location.href !== previousUrl };
    }

    async function fillEmbeddedApplication(executePlan = false) {
        const deadline = Date.now() + OPERATION_TIMEOUT_MS - 1000;
        let lastReason = "The embedded application form did not respond.";
        while (Date.now() < deadline) {
            if (stopped || isPaused) return { filled: false, reason: "Stopped or paused on this page." };
            const embedded = await message({ type: "FILL_CHILD_FRAMES", executePlan }).catch((error) => ({ filled: false, reason: error.message }));
            if (embedded.filled) return embedded;
            lastReason = embedded.reason || lastReason;
            await delay(750);
        }
        return { filled: false, reason: lastReason };
    }

    async function reportVisibleFailure(error) {
        const raw = String(error?.message || error || "Unknown error");
        if (isExtensionContextInvalidation(error)) {
            deactivateInvalidatedContext();
            return "Job Hunter was updated. Refresh this application page to reconnect.";
        }
        const timeout = /30 seconds|timed? out|did not respond/i.test(raw);
        const messageText = timeout
            ? "This form is taking longer than expected. Please continue on the employer page."
            : "I need your help with this page. Please continue on the employer form.";
        setStatus(messageText, "warning");
        await reportProgress(timeout ? "PORTAL_CHANGED" : "USER_ACTION_REQUIRED", messageText, { timeout, error: raw });
        return messageText;
    }

    async function fillPage({ localOnly = false, replay = false, executePlan = false, rescanDepth = 0, incrementalOnly = false } = {}) {
        if (stopped || isPaused) return { stopped: true };
        setStatus("🔍 Analyzing form layout & fields…", "processing");
        if (!(await refreshContext({ replay }))) throw new Error(replay
            ? "No previous application was found for this employer page."
            : "Open this job from your Job Hunter dashboard first.");
        const runtime = await applyAdapterRuntime();
        if (adapterContext().killed || runtime?.killed) {
            const text = runtime?.killReason || adapterContext().killReason || "Autofill is paused for this portal.";
            setStatus(text, "warning");
            await reportProgress("PORTAL_CHANGED", text, { killed: true });
            return { killed: true };
        }
        const hotProfile = runtime?.profile || {};
        const surface = localApplySurface();
        if (surface.mode === "ASSIST") return enterAssistMode(surface);

        if (executePlan) {
            const expanded = globalThis.JobHunterRepeatables?.expand?.({
                portalKind: adapterContext().portalKind,
                profile: hotProfile
            }) || 0;
            if (expanded) {
                await reportProgress("FORM_CHANGED", `Opened ${expanded} structured resume section(s).`, {
                    structuredSectionsExpanded: expanded
                });
                await delay(300);
            }
        }

        if (isTopFrame && !localOnly && !hasLikelyApplicationForm()) {
            const applyButton = findApplyButton();
            const shouldWaitForFrame = hasEmbeddedApplicationFrame() || (applyButton && isSamePageApply(applyButton) && location.hash);
            const embedded = shouldWaitForFrame
                ? await fillEmbeddedApplication(executePlan)
                : await message({ type: "FILL_CHILD_FRAMES", executePlan }).catch((error) => ({ filled: false, reason: error.message }));
            if (embedded.filled) {
                await message({ type: "STOP_NAVIGATION" }).catch(() => null);
                const childResult = embedded.result || {};
                if (childResult.planReady) {
                    renderPlanSummary(childResult);
                    setStatus("Application plan ready. Review it, then choose Fill safe fields.", "success");
                } else if (childResult.consentRequired) {
                    setStatus("Choose the learning preference in the COPILOT side panel.", "warning");
                    return embedded;
                } else if (childResult.question) {
                    renderQuestion(childResult.question);
                    setStatus(childResult.question.questionType === "MANUAL_ACTION"
                        ? "I found the application form. One field requires your direct confirmation."
                        : "I found the application form. I need one answer from you.", "warning");
                } else if (childResult.validation?.status === "READY_TO_SUBMIT") {
                    setStatus("Application is complete and ready for your review.", "success");
                } else {
                    setStatus("Completed verified fields. Review highlighted items.", "success");
                }
                return embedded;
            }
            if (shouldWaitForFrame) {
                const text = "This embedded application cannot be inspected from the current browser frame. Copilot switched to Assist so you can copy verified answers and continue safely.";
                setStatus(text, "warning");
                await reportProgress("USER_ACTION_REQUIRED", text, {
                    supportOutcome: "ASSIST_REQUIRED",
                    inaccessibleSurface: "CROSS_ORIGIN_IFRAME_OR_CLOSED_SHADOW_ROOT"
                });
                return enterAssistMode({ mode: "ASSIST", surface: "embedded-application", reason: text });
            }
            if (applyButton) return continueApplication();
        }

        const routeKey = `${location.origin}${location.pathname}${location.search}${location.hash}`;
        if (routeKey !== knownApplicationRoute) {
            knownApplicationRoute = routeKey;
            knownFieldIds.clear();
            telemetry.resetOperations();
            verifiedFillLedger.clear();
        }
        const detectedFields = detectFields();
        const fields = incrementalOnly
            ? detectedFields.filter((field) => !knownFieldIds.has(field.id) || knownFieldNeedsRepair(field))
            : detectedFields;
        if (incrementalOnly && !fields.length) return { incremental: true, changed: false };
        if (!fields.length) {
            const applyButton = findApplyButton();
            if (applyButton && !isSamePageApply(applyButton)) return continueApplication();
            return enterAssistMode(localApplySurface());
        }
        fields.forEach((field) => knownFieldIds.add(field.id));

        await reportProgress("FORM_DETECTED", `Extension detected an application form with ${fields.length} field(s).`, { fieldCount: fields.length });
        await reportProgress("FIELDS_ANALYZED", `Analyzing ${fields.length} application field(s).`, { fieldCount: fields.length });

        let filled = 0;
        const review = [];
        const missingFields = [];
        const actionsByField = new Map();
        let documents = { resumeAttached: false, coverLetterAttached: false, attachedCount: 0, errors: [] };
        const localPlan = globalThis.JobHunterIdentity?.plan?.(fields, hotProfile) || { actions: [], filledIds: [] };
        const locallyFilled = new Set(localPlan.filledIds || []);

        if (executePlan && localPlan.actions.length) {
            setStatus("✍️ Filling verified identity fields…", "processing");
            await reportProgress("FILLING", "Filling name, email, and phone from the on-device profile.");
            for (const action of localPlan.actions) {
                const field = fields.find((item) => item.id === action.fieldId);
                if (!field || field.legal || field.sensitive) continue;
                const operationStarted = performance.now();
                fieldOperation(field, "IDENTITY", "STARTED", { semanticKey: action.semanticKey || action.key || "" });
                try {
                    if (await fill(field, action.value)) {
                        ownership.clearFillFailed(field.id);
                        await rememberVerifiedFill(field, action);
                        filled += 1;
                        actionsByField.set(field.id, action);
                        setStatus(`Filled “${field.label}” (Profile).`);
                        fieldOperation(field, "IDENTITY", "FILLED", { semanticKey: action.semanticKey || action.key || "", durationMs: Math.round(performance.now() - operationStarted), metadata: comboboxOperationMetadata(field) });
                    } else {
                        fieldOperation(field, "IDENTITY", "REVIEW", { semanticKey: action.semanticKey || action.key || "", reason: "NO_EXACT_FILL", durationMs: Math.round(performance.now() - operationStarted), metadata: comboboxOperationMetadata(field) });
                    }
                } catch {
                    locallyFilled.delete(field.id);
                    setStatus(`Could not fill “${field.label}”; it is ready for manual review.`, "warning");
                    fieldOperation(field, "IDENTITY", "FAILED", { semanticKey: action.semanticKey || action.key || "", reason: "FIELD_REJECTED_VALUE", durationMs: Math.round(performance.now() - operationStarted) });
                }
            }
        }

        if (executePlan) {
            setStatus("📎 Attaching tailored application documents…", "processing");
            documents = await attachApplicationDocuments(fields);
            review.push(...documents.errors);
        }

        setStatus("🧠 Matching leftover questions…", "processing");
        const extensionState = await message({ type: "GET_EXTENSION_STATE" });
        const teachMode = extensionState.teachModeGlobal !== false && extensionState.teachModeSites?.[location.hostname] !== false;
        const leftoverFields = executePlan
            ? fields.filter((field) => !locallyFilled.has(field.id) && field.type !== "file")
            : fields;
        // Durable delta resolution belongs to an authorized run. Legacy/unbound
        // sessions still need to work on non-secure pages where WebCrypto is not
        // available (for example local fixtures and older dashboard launches).
        const deltaFields = activeRunContext?.runId
            ? await Promise.all(leftoverFields.map(async (field) => ({
                ...field,
                logicalFieldFingerprint: (await logicalIdentityFor(field)).logicalFieldFingerprint,
                descriptorHash: await sha256Text(JSON.stringify({
                    signature: evidenceSignature(field),
                    type: field.type || "text",
                    required: Boolean(field.required),
                    options: Array.isArray(field.options) ? field.options.map((option) => String(option).slice(0, 160)).slice(0, 100) : []
                }))
            })))
            : leftoverFields;

        const response = await message({
            type: "RESOLVE_FIELDS",
            jobId: activeJob.id,
            payload: {
                pageUrl: location.href,
                pageText: document.body.innerText.slice(0, 40000),
                fields: deltaFields,
                locallyFilledFieldIds: [...locallyFilled],
                teachMode,
                pageGeneration,
                formGeneration,
                ...adapterPayload()
            }
        });
        if (response.killed) {
            const text = response.killReason || "Autofill is paused for this portal.";
            setStatus(text, "warning");
            await reportProgress("PORTAL_CHANGED", text, { killed: true });
            return { killed: true };
        }
        if (response.blocked) throw new Error(response.eligibility.reason);
        if (locallyFilled.size && response.plan?.summary) {
            response.plan.summary.ready = Number(response.plan.summary.ready || 0) + locallyFilled.size;
        }

        renderPlanSummary(response);
        if (!executePlan) {
            const counts = response.plan?.summary || {};
            const reviewCount = Number(counts.needsYou || 0) + Number(counts.aiDrafts || 0) + Number(counts.manual || 0);
            const text = `${Number(counts.ready || 0)} safe field(s) ready${reviewCount ? `; ${reviewCount} need review` : ""}.`;
            setStatus(text, reviewCount ? "warning" : "success");
            await reportProgress("PLAN_READY", text, { counts, submits: false });
            return { planReady: true, plan: response.plan, attentionItems: response.attentionItems || [] };
        }

        renderQuestion(response.currentQuestion);

        setStatus("✍️ Filling remaining verified fields…", "processing");
        await reportProgress("FILLING", "Filling leftover verified answers on the current form page.");

        for (const action of response.plan?.actions || []) {
            actionsByField.set(action.fieldId, action);
            const field = fields.find((item) => item.id === action.fieldId);
            if (!field || locallyFilled.has(field.id) || field.legal || field.sensitive || response.currentQuestion?.fieldId === field.id) continue;
            const operationStarted = performance.now();
            fieldOperation(field, field.sectionKind ? "STRUCTURED_HISTORY" : "QUESTION", "STARTED", { semanticKey: action.semanticKey || action.normalizedKey || "" });
            try {
                if (await fill(field, action.value)) {
                    ownership.clearFillFailed(field.id);
                    await rememberVerifiedFill(field, action);
                    filled += 1;
                    setStatus(`Filled “${field.label}” (${sourceLabel(action.source, false)}).`);
                    fieldOperation(field, field.sectionKind ? "STRUCTURED_HISTORY" : "QUESTION", "FILLED", { semanticKey: action.semanticKey || action.normalizedKey || "", durationMs: Math.round(performance.now() - operationStarted), metadata: comboboxOperationMetadata(field) });
                } else {
                    ownership.markFillFailed(field.id);
                    if (field.required) missingFields.push({ id: field.id, label: field.label });
                    fieldOperation(field, field.sectionKind ? "STRUCTURED_HISTORY" : "QUESTION", "REVIEW", { semanticKey: action.semanticKey || action.normalizedKey || "", reason: "NO_EXACT_FILL", durationMs: Math.round(performance.now() - operationStarted), metadata: comboboxOperationMetadata(field) });
                }
            } catch {
                ownership.markFillFailed(field.id);
                if (field.required) missingFields.push({ id: field.id, label: field.label });
                setStatus(`Could not fill “${field.label}”; it is ready for manual review.`, "warning");
                fieldOperation(field, field.sectionKind ? "STRUCTURED_HISTORY" : "QUESTION", "FAILED", { semanticKey: action.semanticKey || action.normalizedKey || "", reason: "FIELD_REJECTED_VALUE", durationMs: Math.round(performance.now() - operationStarted) });
            }
        }
        const repeatableProgress = executePlan ? await globalThis.JobHunterRepeatables?.advance?.({
            portalKind: adapterContext().portalKind,
            profile: hotProfile
        }) : null;
        if (repeatableProgress?.review?.length) {
            review.push(...repeatableProgress.review.map((item) => `${item.kind} ${item.index + 1}: ${item.reason}`));
        }
        if (repeatableProgress?.advanced) {
            await reportProgress("FIELDS_ANALYZED", `Saved ${repeatableProgress.saved.length} verified resume record(s) inside the application.`, {
                structuredRecordsSaved: repeatableProgress.saved,
                structuredRecordsOpened: repeatableProgress.opened
            });
            if (repeatableProgress.opened.length) {
                await delay(450);
                return fillPage({ localOnly, replay, executePlan: true, rescanDepth: rescanDepth + 1, incrementalOnly: true });
            }
        }
        // Many ATS forms reveal required questions after a select/radio value
        // changes. Re-scan a bounded number of times under the same explicit
        // Fill action; existing values become completed/conflicts and are not
        // overwritten silently.
        await delay(400);
        const originalFieldIds = new Set(fields.map((field) => field.id));
        const rescannedFields = detectFields();
        const newlyVisible = rescannedFields.filter((field) => !originalFieldIds.has(field.id)
            && field.type !== "file"
            && !/\.pdf\b|\buploaded successfully\b|\bremove File\b/i.test(`${field.label || ""} ${field.value || ""}`));
        if (newlyVisible.length && rescanDepth < 2) {
            await reportProgress("FIELDS_ANALYZED", `Detected ${newlyVisible.length} conditional field(s) after the form changed.`, {
                conditionalRescan: true, rescanDepth: rescanDepth + 1, fieldCount: rescannedFields.length
            });
            return fillPage({ localOnly, replay, executePlan: true, rescanDepth: rescanDepth + 1, incrementalOnly: true });
        }
        const currentFields = rescannedFields;
        for (const item of response.plan?.review || []) {
            if (!missingFields.some((field) => field.id === item.fieldId)) missingFields.push({ id: item.fieldId, label: item.label });
        }
        review.push(...missingFields.map((field) => field.label));

        renderMissingFieldsSection(missingFields);

        if (!documents.attachedCount) {
            setStatus("📎 Attaching tailored application documents…", "processing");
            documents = await attachApplicationDocuments(currentFields);
            review.push(...documents.errors);
        }
        const attached = documents.resumeAttached;

        void message({
            type: "RECORD_FIELD_EVIDENCE",
            jobId: activeJob.id,
            payload: {
                pageUrl: location.href,
                fields: currentFields.filter((field) => !field.skipLearning).map((field) => {
                    let action = actionsByField.get(field.id);
                    if (!action && documents.resumeAttached && field.id === documents.resumeFieldId) {
                        action = { semanticKey: "RESUME", source: "GENERATED_DOCUMENT" };
                    } else if (!action && documents.coverLetterAttached && field.id === documents.coverLetterFieldId) {
                        action = { semanticKey: "COVER_LETTER", source: "GENERATED_DOCUMENT" };
                    }
                    return fieldSnapshot(field, { action, source: action?.source });
                }),
                ...adapterPayload()
            }
        }).catch(() => null);

        if (response.currentQuestion) {
            const text = response.currentQuestion.questionType === "CONFIRM_MAPPING" ? "Teaching this site — one field needs confirmation." : response.currentQuestion.questionType === "MANUAL_ACTION" ? "A field requires your direct confirmation on the employer form." : "One answer needs you.";
            setStatus(text, "warning");
            await reportProgress(response.currentQuestion.questionType === "MANUAL_ACTION" ? "USER_ACTION_REQUIRED" : "WAITING_FOR_USER", text, { filled, attached });
            return { filled, attached, review, question: response.currentQuestion };
        }
        if (review.length) {
            const attachmentText = documents.attachedCount ? ` + ${documents.attachedCount} document${documents.attachedCount === 1 ? "" : "s"}` : "";
            const text = `Filled ${filled}${attachmentText}. Review required: ${review.slice(0, 3).join(", ")}`;
            setStatus(text, "warning");
            await reportProgress("WAITING_FOR_USER", text, { filled, attached, documents, review });
            return { filled, attached, documents, review };
        }

        const attachmentText = documents.attachedCount ? ` and attached ${documents.attachedCount} document${documents.attachedCount === 1 ? "" : "s"}` : "";
        await reportProgress("FILLING", `Filled ${filled} verified field(s)${attachmentText}.`, { filled, attached, documents });
        const resumeAttached = attached || currentFields.some((field) => field.type === "file" && fieldSnapshot(field).filled);
        const validationFields = detectFields();
        return {
            filled,
            attached,
            documents,
            review: [],
            validation: await validateForm(validationFields, resumeAttached)
        };
    }

    async function markFilled() {
        if (!(await refreshContext())) throw new Error("Open this job from your Job Hunter dashboard first.");
        if (!confirm("You are marking this form ready without automated validation. Confirm that you reviewed all required fields.")) return;
        const text = "Candidate manually marked the current application form as filled and ready for review without automated validation.";
        await reportProgress("READY_TO_SUBMIT", text, { manual: true });
        setStatus("Marked as filled. Review the form before submitting.", "success");
    }

    async function undoAutofill() {
        let restored = 0;
        for (const entry of [...lastFill].reverse()) {
            const fieldId = scanner.fieldIdForElement(entry.element);
            if (!entry.element?.isConnected || (fieldId && ownership.isUserEdited(fieldId))) continue;
            if (entry.element instanceof HTMLInputElement && ["checkbox", "radio"].includes(entry.element.type)) {
                entry.element.checked = Boolean(entry.checked);
            } else if (entry.element.isContentEditable) entry.element.textContent = String(entry.value || "");
            else if (!setNativeValue(entry.element, entry.value || "")) continue;
            dispatch(entry.element);
            restored += 1;
        }
        lastFill = [];
        setStatus(restored ? `Undid autofill on ${restored} field(s).` : "No safe autofill changes were available to undo.", restored ? "success" : "warning");
        return { restored };
    }

    function mountWidget() {
        if (document.getElementById("job-hunter-copilot-host")) return;
        hostNode = document.createElement("div");
        hostNode.id = "job-hunter-copilot-host";
        hostNode.style.cssText = "all:initial;position:fixed;right:20px;bottom:88px;z-index:2147483647;pointer-events:auto";
        const shadow = hostNode.attachShadow({ mode: "open" });
        shadow.innerHTML = `<style>
          :host{color-scheme:light}.agent{display:flex;align-items:flex-end;gap:10px;font:13px system-ui,-apple-system,sans-serif}.bubble{position:relative;width:290px;padding:13px 14px;border:1px solid #cbd5e1;border-radius:18px;background:#fff;color:#102a43;box-shadow:0 14px 40px #0f172a2e}.bubble:after{content:"";position:absolute;right:-9px;bottom:26px;width:16px;height:16px;background:#fff;border-right:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1;transform:rotate(-45deg)}.header{display:flex;align-items:center;justify-content:space-between}.header-actions{display:flex;gap:5px}.title{display:flex;align-items:center;gap:7px;font-weight:800}.live{width:7px;height:7px;border-radius:50%;background:#10b981;box-shadow:0 0 0 4px #d1fae5}.btn-pause,.btn-minimize{border:none;background:#f1f5f9;border-radius:6px;cursor:pointer;padding:3px 7px;font-size:11px;font-weight:700;color:#475569}.status{margin-top:8px;line-height:1.45;font-weight:650}.status[data-kind=processing]{color:#315ee7}.status[data-kind=success]{color:#047857}.status[data-kind=warning]{color:#b45309}.status[data-kind=error]{color:#b91c1c}.timer{min-height:15px;margin-top:3px;color:#64748b;font-size:10px}.prompt{margin-top:9px;padding:10px;border-radius:11px;background:#f1f5f9;line-height:1.45}.consent-card{border:1px solid #bfdbfe;background:#eff6ff}.consent-card strong,.consent-card span{display:block}.consent-card span{margin-top:4px;color:#475569;font-size:11px;font-weight:500}.consent-actions{justify-content:flex-end}.manual{background:#fff7ed;color:#9a3412}.answer{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}button{border:1px solid #cbd5e1;background:#fff;color:#102a43;border-radius:999px;padding:7px 11px;font-weight:750;cursor:pointer}.primary{background:#315ee7;color:#fff;border-color:#315ee7}.mapping-option{width:100%;border-radius:11px;text-align:left}.mapping-option span,.mapping-option small{display:block}.mapping-option small{margin-top:2px;color:#64748b;font-weight:500}input{box-sizing:border-box;min-width:0;flex:1;border:1px solid #cbd5e1;border-radius:10px;padding:8px}.scope{width:100%;font-size:10px;color:#64748b}.manual-section{margin-top:9px;border-top:1px solid #f1f5f9;padding-top:7px}.manual-title{font-size:11px;font-weight:700;color:#64748b}.chips-container{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.jump-chip,.btn-jump{font-size:11px;padding:4px 8px;border-radius:6px;background:#f8fafc;border:1px solid #e2e8f0;color:#315ee7;cursor:pointer}.timeline{display:grid;gap:3px;margin-top:7px}.event{font-size:10px;color:#64748b;border-left:2px solid #bfdbfe;padding-left:7px}.question:empty,.manual-section:empty,.timeline:empty{display:none}.pet{position:relative;z-index:2;width:82px;height:82px;object-fit:cover;border-radius:25px;filter:drop-shadow(0 10px 14px #0f172a3d);animation:float 2.8s ease-in-out infinite}.launcher{display:none;border:0;background:transparent;padding:8px;cursor:pointer;pointer-events:auto}.agent.compact .bubble,.agent.compact .pet-static{display:none}.agent.compact .launcher{display:block}.agent.compact .pet{width:64px;height:64px;border:2px solid #bfdbfe;background:#fff}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@media(max-width:520px){.bubble{width:min(250px,calc(100vw - 130px))}.pet{width:68px;height:68px}}
          </style><div class="agent"><div class="bubble"><div class="header"><div class="title"><span class="live"></span>Application agent</div><div class="header-actions"><button id="minimize-toggle" class="btn-minimize" title="Minimize application agent" aria-label="Minimize application agent">−</button><button id="pause-toggle" class="btn-pause" title="Pause COPILOT">⏸️ Pause</button></div></div><div class="status" data-kind="processing">Understanding this application…</div><div class="timer">Processing · 0s / 30s</div><button id="process-form" class="primary" style="margin-top:8px;width:100%">Process this form</button><div class="question"></div><div class="manual-section"></div><div class="timeline"></div></div><button id="expand-agent" class="launcher" title="Open application agent" aria-label="Open application agent"><img class="pet" src="${cachedRobotAssetUrl}" alt="Application agent robot"></button><img class="pet pet-static" src="${cachedRobotAssetUrl}" alt="Application agent robot"></div>`;
        shadowRoot = shadow;
        statusNode = shadow.querySelector(".status");
        timerNode = shadow.querySelector(".timer");
        timelineNode = shadow.querySelector(".timeline");
        questionNode = shadow.querySelector(".question");
        manualSectionNode = shadow.querySelector(".manual-section");
        pauseBtn = shadow.querySelector("#pause-toggle");
        const agentNode = shadow.querySelector(".agent");
        const minimizeBtn = shadow.querySelector("#minimize-toggle");
        const expandBtn = shadow.querySelector("#expand-agent");
        const processFormBtn = shadow.querySelector("#process-form");

        const setCompact = (compact) => {
            agentNode?.classList.toggle("compact", compact);
        };
        // The in-page robot is a launcher only. The Side Panel owns the full
        // workflow so users never see two competing COPILOT interfaces.
        setCompact(true);
        minimizeBtn?.addEventListener("click", () => setCompact(true));
        expandBtn?.addEventListener("click", async () => {
            try { await message({ type: "OPEN_SIDECAR" }); }
            catch (error) { expandBtn.title = `Could not open COPILOT: ${error.message}`; }
        });

        processFormBtn?.addEventListener("click", async () => {
            try {
                await message({ type: "STOP_NAVIGATION" }).catch(() => null);
                await runAgentOperation("Filling safe fields…", () => fillPage({ executePlan: true }));
            } catch (error) {
                await reportVisibleFailure(error);
            }
        });

        pauseBtn?.addEventListener("click", async () => {
            isPaused = !isPaused;
            if (isPaused) {
                await message({ type: "PAUSE_COPILOT" });
                pauseBtn.textContent = "▶️ Resume";
                setStatus("Paused · Application stays linked", "warning");
                if (timerNode) timerNode.textContent = "Paused";
            } else {
                await message({ type: "RESUME_COPILOT" });
                pauseBtn.textContent = "⏸️ Pause";
                setStatus("Resumed · Continuing application…", "processing");
                await runAgentOperation("Checking application fields…", () => fillPage({ executePlan: true }));
            }
        });

        questionNode.addEventListener("click", async (event) => {
            const jumpBtn = event.target.closest(".btn-jump");
            if (jumpBtn?.dataset.fieldId) {
                focusAndHighlightField(jumpBtn.dataset.fieldId);
                return;
            }
            const button = event.target.closest("button");
            if (!button || !currentQuestion) return;
            try {
                if (button.dataset.action === "show-mapping-options") return renderMappingOptions();
                if (button.dataset.action === "skip") return runAgentOperation("Skipping this question…", () => submitAgentAnswer("", { action: "SKIP" }));
                if (button.dataset.semanticKey) return runAgentOperation("Saving your choice…", () => submitAgentAnswer("No", { action: "CHOOSE", semanticKey: button.dataset.semanticKey, saveMapping: true }));
                const value = button.dataset.answer ?? questionNode.querySelector("input")?.value;
                if (value) await runAgentOperation("Applying your answer…", () => submitAgentAnswer(value, currentQuestion.questionType === "CONFIRM_MAPPING" ? { action: "CONFIRM", saveMapping: true } : {}));
            } catch (error) { await reportVisibleFailure(error); }
        });

        manualSectionNode.addEventListener("click", async (event) => {
            const conflictButton = event.target.closest("[data-conflict]");
            if (conflictButton?.dataset.fieldId) {
                const conflict = pendingConflicts.get(conflictButton.dataset.fieldId);
                if (!conflict) return;
                if (conflictButton.dataset.conflict === "edit") return focusAndHighlightField(conflict.fieldId);
                try {
                    if (conflictButton.dataset.conflict === "profile") {
                        const field = detectFields().find((item) => item.id === conflict.fieldId);
                        if (!field || !(await fill(field, conflict.proposedValue))) throw new Error("This field could not be updated safely.");
                    }
                    await message({ type: "RESOLVE_ATTENTION", jobId: activeJob.id, fieldId: conflict.fieldId,
                        decision: conflictButton.dataset.conflict === "profile" ? "USE_PROFILE" : "KEEP_EXISTING" });
                    pendingConflicts.delete(conflict.fieldId);
                    conflictButton.closest(".conflict-card")?.remove();
                    setStatus("Conflict resolved by you.", "success");
                } catch (error) { await reportVisibleFailure(error); }
                return;
            }
            const chip = event.target.closest(".jump-chip");
            if (chip?.dataset.fieldId) {
                focusAndHighlightField(chip.dataset.fieldId);
            }
        });

        document.documentElement.appendChild(hostNode);
        hostNode.style.display = sidePanelOpen ? "none" : "block";
    }

    document.addEventListener("click", (event) => {
        const eventTarget = event.composedPath?.()[0] || event.target;
        const button = composedClosest(eventTarget, "a, button, input[type=submit], [role=button]");
        if (button && activeJob) {
            const text = buttonText(button);
            const isBlank = button.getAttribute("target") === "_blank";
            const isApply = /apply/i.test(text) || /^continue$/i.test(text) || /^next$/i.test(text);
            
            const isKekaFormSubmit = Boolean(globalThis.JobHunterAdapterRuntime?.isPortalSubmit?.(location, text))
                || (/(?:^|\.)keka\.com$/i.test(location.hostname)
                    && /\/careers\/applyjob\/\d+\/?$/i.test(location.pathname) && /apply|submit/i.test(text));
            if (SUBMIT_TEXT.test(text) || isKekaFormSubmit) {
                interruptOpenEditSessions("SUBMIT_NAVIGATION");
                void message({ type: "MARK_SUBMITTING", jobId: activeJob.id }).catch(() => null);
            } else if ((isApply || isBlank) && !isSamePageApply(button)) {
                interruptOpenEditSessions("PAGE_NAVIGATION");
                void message({ type: "START_NAVIGATION", jobId: activeJob.id }).catch(() => null);
            }
        }
    }, true);

    async function saveUserField(field) {
        if (!activeJob || !field || field.legal || field.sensitive) return;
        const wasAutofilled = verifiedFillLedger.has(field.id);
        const identity = activeRunContext?.runId ? await logicalIdentityFor(field) : null;
        const snapshot = fieldSnapshot(field, { source: "USER_MANUAL_INPUT" });
        const session = editSessionByField.get(field.id) || null;
        const finalValueHash = await sha256Text(snapshot.value);
        if (session && finalValueHash === session.initialValueHash) return;
        ownership.markUserEdited(field.id);
        verifiedFillLedger.delete(field.id);
        const chip = manualSectionNode?.querySelector(`.jump-chip[data-field-id="${field.id}"]`);
        if (chip) chip.remove();
        if (!String(snapshot.value || "").trim()) return;
        try {
            const result = await message({
                type: "SAVE_MANUAL_INPUT",
                jobId: activeJob.id,
                payload: {
                    fieldId: field.id,
                    fieldLabel: field.label,
                    fieldType: field.type,
                    fieldSignature: evidenceSignature(field),
                    options: field.options,
                    name: field.name,
                    portalFieldKey: field.portalFieldKey,
                    attributes: field.attributes,
                    semanticContext: field.semanticContext,
                    required: field.required,
                    legal: field.legal,
                    sensitive: field.sensitive,
                    wasAutofilled,
                    operationId: telemetry.lastOperationId(field.id),
                    logicalFieldFingerprint: identity?.logicalFieldFingerprint || null,
                    beforeValueHash: session?.initialValueHash || null,
                    intendedValueHash: session?.intendedValueHash || null,
                    finalValueHash,
                    normalizedEquivalent: session?.intendedValueHash
                        ? session.intendedValueHash === finalValueHash
                        : null,
                    clientTimeMs: Date.now(),
                    value: snapshot.value,
                    visible: snapshot.visible,
                    valid: snapshot.valid,
                    pageUrl: location.href
                }
            });
            if (result?.correctionApprovalRequired) renderCorrectionPrompt(field, snapshot);
        } catch (error) {
            setStatus(`Could not save this field: ${error.message}`, "warning");
        }
    }

    function fieldFromEventTarget(target) {
        const fields = detectFields();
        const fieldId = scanner.fieldIdForElement(target)
            || scanner.fieldIdForElement(composedClosest(target, "[role=option], [role=combobox], input, textarea, select"));
        const detected = fields.find((item) => item.id === fieldId);
        if (detected) return detected;
        const element = composedClosest(target, "input:not([type=hidden]), textarea, select, [role=combobox], [role=radio]");
        if (!element || !visible(element) || composedClosest(element, "[role=listbox], [role=option]")) return null;
        const type = element.getAttribute("role") === "combobox" ? "combobox"
            : element.tagName === "SELECT" ? "select-one"
                : element.tagName === "TEXTAREA" ? "textarea" : (element.type || "text").toLowerCase();
        const label = labelFor(element, fields.length);
        if (genericControlLabel(label)) return null;
        const sectionKind = structuredSectionFor(element);
        const rescuedId = `ext:rescued:${normalizedToken(`${label}:${element.name || ""}`)}:${type}`;
        const options = element.tagName === "SELECT"
            ? [...element.options].map((option) => ({ value: option.value, label: option.textContent.trim() })) : [];
        const nearbySafetyText = textOf(composedParent(element)).slice(0, 1200);
        const rescued = {
            id: rescuedId,
            index: fields.length,
            label,
            type,
            name: element.name || "",
            required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
            value: element.value || "",
            options,
            sectionKind,
            sectionIndex: sectionKind ? structuredSectionIndexFor(element, sectionKind) : null,
            ...structuralMetadata(element, type, label, fields.length),
            legal: LEGAL_TEXT.test(`${label} ${element.name || ""} ${nearbySafetyText}`),
            sensitive: SENSITIVE_TEXT.test(`${label} ${element.name || ""}`) || type === "password",
            skipLearning: false,
            attributes: semanticAttributesFor(element),
            semanticContext: {
                section: sectionHeadingFor(element) || sectionKind || "",
                sectionFamily: sectionKind || "",
                previous: { label: fields.at(-1)?.label || "", canonical: fields.at(-1)?.semanticKey || null },
                next: { label: "", canonical: null },
                pageHeading: firstHeading(document, "h1, [role=heading][aria-level='1'], h2"),
                formHeading: firstHeading(bestContainer(), "h1, h2, h3, legend, [role=heading]")
            }
        };
        scanner.bind(rescuedId, element);
        return rescued;
    }

    document.addEventListener("change", (event) => {
        if (!event.isTrusted || !activeJob || !event.target || !event.target.tagName) return;
        const target = event.composedPath?.()[0] || event.target;
        if (ownership.isProgrammatic(target)) return;
        const field = fieldFromEventTarget(target);
        if (field) void (async () => {
            await updateFieldEdit(field);
            await saveUserField(field);
            await commitFieldEdit(field);
        })();
    }, true);

    // A controlled framework input can accept a verified value, then clear it
    // in the same render cycle without changing the field structure. Schedule
    // a bounded incremental check after every input event; the verified ledger
    // repairs only blank fields and never user-edited or focused controls.
    document.addEventListener("input", (event) => {
        if (!activeJob) return;
        scheduleDynamicPageCheck();
        if (!event.isTrusted) return;
        const target = event.composedPath?.()[0] || event.target;
        if (ownership.isProgrammatic(target)) return;
        const field = fieldFromEventTarget(target);
        if (field) scheduleFieldEditUpdate(field);
    }, false);

    document.addEventListener("focusin", (event) => {
        if (!event.isTrusted) return;
        const target = event.composedPath?.()[0] || event.target;
        const fieldId = scanner.fieldIdForElement(target);
        ownership.beginUserInteraction(fieldId);
        const field = fieldFromEventTarget(target);
        if (field) void beginFieldEdit(field);
    }, true);

    document.addEventListener("focusout", (event) => {
        if (!event.isTrusted) return;
        const target = event.composedPath?.()[0] || event.target;
        const fieldId = scanner.fieldIdForElement(target);
        if (fieldId) setTimeout(() => ownership.endUserInteraction(fieldId), 0);
        if (!activeJob || ownership.isProgrammatic(target)) return;
        if (!composedClosest(target, "input, textarea, select, [role=combobox], [role=radio]")) return;
        const field = fieldFromEventTarget(target);
        if (field) void (async () => {
            await saveUserField(field);
            if (editSessionByField.has(field.id)) await commitFieldEdit(field);
        })();
    }, true);

    document.addEventListener("click", (event) => {
        if (!event.isTrusted || !activeJob) return;
        const target = event.composedPath?.()[0] || event.target;
        const option = composedClosest(target, "[role=option], .select2-results__option");
        if (!option) return;
        const combobox = deepQuery("[role=combobox][aria-expanded=true], input:focus, [role=combobox]:focus");
        const field = combobox ? fieldFromEventTarget(combobox) : detectFields().find((item) => /location|city|where/i.test(item.label));
        if (!field) return;
        setTimeout(() => void (async () => {
            await updateFieldEdit(field);
            await saveUserField(field);
            await commitFieldEdit(field);
        })(), 50);
    }, true);

    async function detectConfirmation() {
        const state = await message({ type: "GET_EXTENSION_STATE" });
        const kekaConfirmation = Boolean(globalThis.JobHunterAdapterRuntime?.isSuccessRoute?.(location))
            || (/(?:^|\.)keka\.com$/i.test(location.hostname) && KEKA_SUCCESS_ROUTE.test(location.pathname));
        const recentPending = state.pendingSubmission && Date.now() - state.pendingSubmission.at <= 30 * 60 * 1000;
        if (!recentPending && !kekaConfirmation) return;
        if (kekaConfirmation || CONFIRMATION_TEXT.test(document.body.innerText)) {
            const jobId = state.pendingSubmission?.jobId || state.activeJob?.id;
            if (!jobId) return;
            await recordCheckpoint("SUBMISSION", "VERIFIED", "EMPLOYER_RECEIPT");
            await message({ type: "CONFIRM_SUBMITTED", jobId, pageUrl: location.href, employerConfirmation: true });
            setStatus("Application confirmation recorded.", "success");
        }
    }

    async function confirmSubmissionByCandidate() {
        if (!(await refreshContext())) throw new Error("Open this job from your Job Hunter dashboard first.");
        const state = await message({ type: "GET_EXTENSION_STATE" });
        if (!state.pendingSubmission || state.pendingSubmission.jobId !== activeJob.id) {
            throw new Error("No recent Submit action was detected for this application.");
        }
        if (!confirm("Did the employer confirm that this application was submitted?")) return { confirmed: false };
        await recordCheckpoint("SUBMISSION", "VERIFIED", "CANDIDATE_GESTURE");
        await message({ type: "CONFIRM_SUBMITTED", jobId: activeJob.id, pageUrl: location.href, candidateVerified: true });
        setStatus("Application submission verified by you.", "success");
        return { confirmed: true };
    }

    async function resumeNavigation() {
        const state = await message({ type: "GET_EXTENSION_STATE" });
        if (state.isPaused) {
            isPaused = true;
            if (pauseBtn) pauseBtn.textContent = "▶️ Resume";
            return;
        }
        const navigation = state.navigation;
        if (!navigation || Date.now() - navigation.at > 15 * 60 * 1000 || Number(navigation.hops || 0) >= MAX_NAVIGATION_HOPS) {
            if (navigation) await message({ type: "STOP_NAVIGATION" });
            if (activeJob && (hasLikelyApplicationForm() || hasEmbeddedApplicationFrame())) await fillPage({ executePlan: true });
            return;
        }
        if (!activeJob || activeJob.id !== navigation.jobId) return;
        
        let attempts = 0;
        while (!hasLikelyApplicationForm() && !hasEmbeddedApplicationFrame() && attempts < 10) {
            await delay(1000);
            attempts++;
        }
        
        if (hasLikelyApplicationForm() || hasEmbeddedApplicationFrame()) {
            await message({ type: "STOP_NAVIGATION" });
            await fillPage({ executePlan: true });
            return;
        }
        if (!findApplyButton()) {
            const embedded = await message({ type: "FILL_CHILD_FRAMES" }).catch(() => ({ filled: false }));
            if (embedded.filled) {
                await message({ type: "STOP_NAVIGATION" });
                setStatus("Embedded application form filled. Review it before continuing.", "success");
                return;
            }
            const text = "I could not find the next Apply control. Click Apply on this page; if you reach a form and filling does not start, press “Process this form”.";
            setStatus(text, "warning");
            await reportProgress("USER_ACTION_REQUIRED", text, { navigationPausedForUser: true });
            return;
        }
        try {
            await continueApplication({ continuing: true });
        } catch (error) {
            await message({ type: "STOP_NAVIGATION" });
            await reportVisibleFailure(error);
        }
    }

    async function bootstrap() {
        const runtimeTask = applyAdapterRuntime();
        const job = await refreshContext();
        await runtimeTask;
        if (!job) return;

        const state = await message({ type: "GET_EXTENSION_STATE" });
        if (state.isPaused) {
            isPaused = true;
        }
        if (state.isStopped) stopped = true;

        await detectConfirmation();
        if (!isTopFrame) return;

        // Side panel is the default COPILOT UI on employer pages. Keep the
        // robot as a launcher fallback when the panel is closed.
        if (!statusNode) mountWidget();
        const panelVisibility = await message({ type: "GET_PANEL_VISIBILITY" }).catch(() => ({ open: false }));
        sidePanelOpen = panelVisibility?.open === true;
        if (hostNode) hostNode.style.display = sidePanelOpen ? "none" : "block";
        startDynamicPageDetection();
        // Tell the background service worker this tab is COPILOT-active
        // so new tabs opened from here will be adopted automatically
        void message({ type: "REGISTER_TAB" }).catch(() => null);

        if (isPaused && pauseBtn) {
            pauseBtn.textContent = "▶️ Resume";
            setStatus("Paused · Application stays linked", "warning");
            if (timerNode) timerNode.textContent = "Paused";
        }
        if (isPaused) return; // Halt operations but keep widget visible
        if (stopped) {
            setStatus("Stopped by you · Resume from the sidecar when ready.", "warning");
            return;
        }

        // Wait for a form / apply button to appear (up to 10 s)
        let attempts = 0;
        while (!hasLikelyApplicationForm() && !hasEmbeddedApplicationFrame() && !findApplyButton() && attempts < 10) {
            await delay(1000);
            attempts++;
        }

        const hasForm = hasLikelyApplicationForm() || hasEmbeddedApplicationFrame();
        const hasApply = findApplyButton();
        const applySurface = localApplySurface();

        // Naukri/Instahyre bare Apply controls are deliberately never clicked:
        // they can instantly submit the board profile or open a recruiter chat.
        // Enter Assist immediately instead of falling through to the idle state.
        if (job && applySurface.mode === "ASSIST" && !hasForm) {
            await runAgentOperation("Preparing answers to copy…", () => enterAssistMode(applySurface));
            return;
        }

        // A redirect chain that has reached a form must be resumed before the
        // ordinary idle branches below. This is especially important for Workday.
        if (job && state.navigation) {
            await runAgentOperation(hasForm ? "Processing the application form…" : "Following the application page…", () => resumeNavigation());
            return;
        }

        if (job && state.activeApplication?.status === "OPENING" && !state.navigation) {
            await runAgentOperation("Filling verified application details…", () => fillPage({ executePlan: true }));
            return;
        }

        if (job && hasForm && !state.navigation) {
            await runAgentOperation("Filling verified application details…", () => fillPage({ executePlan: true }));
            return;
        }

        if (hasApply) {
            await runAgentOperation("Following the application page…", () => resumeNavigation());
            return;
        }

        // No form and no apply button found – show an idle status so the
        // widget stays visible and the user knows the assistant is ready.
        setStatus("I could not detect a form or Apply control. Click Apply if one is visible, or press “Process this form” to retry detection.", "warning");
        if (timerNode) timerNode.textContent = "Waiting for your action";
    }

    bindAdapterModules();
    bootstrap().catch(async (error) => {
        if (!isTopFrame) return;
        if (!statusNode && (activeJob || findApplyButton() || hasEmbeddedApplicationFrame())) mountWidget();
        await reportVisibleFailure(error);
    });

    installDocumentDropBridge();

    window.addEventListener("pagehide", () => interruptOpenEditSessions("PAGE_HIDDEN"), { capture: true });
    window.addEventListener("beforeunload", () => interruptOpenEditSessions("DOCUMENT_UNLOAD"), { capture: true });

    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        if (request.type === "SIDECAR_VISIBILITY") {
            sidePanelOpen = request.open === true;
            if (hostNode) hostNode.style.display = sidePanelOpen ? "none" : "block";
            sendResponse({ ok: true });
            return false;
        }
        if (request.type === "SPA_ROUTE_CHANGED") {
            interruptOpenEditSessions("SPA_ROUTE_CHANGED");
            lastDynamicFingerprint = "";
            void recordCheckpoint("PAGE_ADVANCE", "VERIFIED", "NAVIGATION");
            scheduleDynamicPageCheck({ routeChanged: true });
            sendResponse({ ok: true, result: { scheduled: true } });
            return false;
        }
        if (request.type === "STOP_COPILOT") {
            interruptOpenEditSessions("COPILOT_STOPPED");
            stopped = true;
            if (hostNode) hostNode.remove();
            activeJob = null;
            sendResponse({ ok: true });
            return false;
        }
        if (request.type === "PAUSE_FROM_SIDECAR" || request.type === "RESUME_FROM_SIDECAR") {
            isPaused = request.type === "PAUSE_FROM_SIDECAR";
            if (!isPaused) stopped = false;
            message({ type: isPaused ? "PAUSE_COPILOT" : "RESUME_COPILOT" }).then(() => {
                setStatus(isPaused ? "Paused · Application stays linked" : "Resumed · Ready to continue", isPaused ? "warning" : "success");
                sendResponse({ ok: true, result: { paused: isPaused } });
            }).catch((error) => sendResponse({ ok: false, error: error.message }));
            return true;
        }
        if (request.type === "PROBE_FORM") {
            applyAdapterRuntime().then(() => {
                sendResponse({
                    ok: true,
                    result: {
                        likely: hasLikelyApplicationForm(),
                        fieldCount: detectFields().length,
                        pageUrl: location.href
                    }
                });
            }).catch((error) => sendResponse({ ok: false, error: error.message }));
            return true;
        }
        if (request.type === "FOCUS_FIELD") {
            focusAndHighlightField(request.payload?.fieldId);
            sendResponse({ ok: true, result: { focused: true } });
            return false;
        }
        if (request.type === "ANSWER_CURRENT_QUESTION") {
            currentQuestion = request.payload?.question || currentQuestion;
            if (!currentQuestion) {
                sendResponse({ ok: false, error: "Refresh the application plan before answering this question." });
                return false;
            }
            runAgentOperation("Applying your answer…", () => submitAgentAnswer(request.payload?.answer || "", request.payload?.extra || {}))
                .then((result) => sendResponse({ ok: true, result }))
                .catch((error) => sendResponse({ ok: false, error: error.message }));
            return true;
        }
        if (request.type === "REPLACE_RESUME_DOCUMENT") {
            runAgentOperation("Replacing the resume on this form…", replaceResumeDocument)
                .then((result) => sendResponse({ ok: true, result }))
                .catch((error) => sendResponse({ ok: false, error: error.message }));
            return true;
        }
        if (request.type === "GET_DOCUMENT_TARGETS") {
            applyAdapterRuntime().then(() => sendResponse({ ok: true, result: liveDocumentTargets() }))
                .catch((error) => sendResponse({ ok: false, error: error.message }));
            return true;
        }
        if (request.type === "DOCUMENT_DRAG_START") {
            beginDocumentDrag(request.kind, request.jobId);
            sendResponse({ ok: true, result: { started: true } });
            return false;
        }
        if (request.type === "DOCUMENT_DRAG_END") {
            // Cross-surface drags can end in the side panel before Chrome
            // dispatches the page drop. Keep click/drop mode alive briefly.
            documentDragClearTimer = setTimeout(clearDocumentDrag, 20000);
            sendResponse({ ok: true, result: { ended: true } });
            return false;
        }
        if (request.type === "ATTACH_DOCUMENT") {
            const kind = request.kind === "cover" ? "cover" : "resume";
            beginDocumentDrag(kind, request.jobId);
            attachDraggedDocument(kind, document.body)
                .then((result) => {
                    setStatus(kind === "cover" ? "Cover letter added to the form." : "Resume attached to the form.", "success");
                    clearDocumentDrag();
                    sendResponse({ ok: true, result });
                })
                .catch((error) => {
                    setStatus(error.message, "error");
                    sendResponse({ ok: false, error: error.message });
                });
            return true;
        }
        const action = request.type === "FILL_PAGE"
            ? fillPage
            : request.type === "FILL_SAFE_FIELDS"
                ? () => fillPage({ executePlan: true })
            : request.type === "UNDO_AUTOFILL"
                ? undoAutofill
            : request.type === "TEST_LEARNED_AUTOFILL"
                ? () => fillPage({ replay: true })
            : request.type === "FILL_FRAME"
                ? () => fillPage({ localOnly: true, executePlan: request.executePlan === true })
                : request.type === "CONTINUE_APPLICATION"
                    ? continueApplication
                    : request.type === "MARK_FILLED"
                        ? markFilled
                        : request.type === "CONFIRM_SUBMISSION"
                            ? confirmSubmissionByCandidate
                        : null;
        if (!action) return false;
        const execute = isTopFrame
            ? () => runAgentOperation(request.type === "CONTINUE_APPLICATION" ? "Opening the application…" : "Checking this application…", action)
            : action;
        execute().then((result) => sendResponse({ ok: true, result })).catch(async (error) => {
            if (isTopFrame) await reportVisibleFailure(error);
            sendResponse({ ok: false, error: error.message });
        });
        return true;
    });
})();

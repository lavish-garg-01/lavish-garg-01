importScripts("contracts/shared-contract-validator.js");
importScripts("durable-outbox.js");
importScripts("runtime/background/api-client.js");
importScripts("runtime/background/session-store.js");
importScripts("runtime/background/outbox-transport.js");
importScripts("runtime/background/message-router.js");

const DEFAULT_API = "http://127.0.0.1:3001";
const backgroundApi = globalThis.JobHunterBackgroundApiClient.create({ chromeApi: chrome, defaultApi: DEFAULT_API });
const apiBase = () => backgroundApi.base();
const request = (path, options) => backgroundApi.request(path, options);
const sessionStore = globalThis.JobHunterBackgroundSessionStore.create({
    storage: chrome.storage.local,
    defaultApi: DEFAULT_API
});

// In-memory set of tab IDs where COPILOT is currently active (registered via content.js).
// Reset on service worker restart — tabs re-register themselves on next JOB_CONTEXT call.
const watchedTabs = new Set();
const closingTabs = new Set();
const pendingChildTabs = new Map();
// Some job boards open the employer URL in a child tab and then navigate the
// source tab to a "redirected" receipt. If we fold the child back immediately,
// that later receipt navigation can overwrite the employer URL. Keep the
// captured destination until the board navigation settles.
const pendingSourceRedirects = new Map();

function safeApplicationDestination(rawUrl) {
    const original = new URL(String(rawUrl || ""));
    if (!["http:", "https:"].includes(original.protocol)) throw new Error("Only web application links can be opened.");
    const linkedInHost = /^(?:www\.|in\.)?linkedin\.com$/i.test(original.hostname);
    if (!linkedInHost || original.pathname.replace(/\/+$/, "") !== "/safety/go") return original.href;
    const embedded = original.searchParams.get("url");
    if (!embedded) throw new Error("This LinkedIn redirect has expired. Return to the job and click Apply again.");
    let decoded = String(embedded).replaceAll("&amp;", "&");
    for (let pass = 0; pass < 2; pass += 1) {
        try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { break; }
    }
    const target = new URL(decoded);
    if (!["http:", "https:"].includes(target.protocol)) throw new Error("LinkedIn supplied an unsafe application destination.");
    if (/^(?:www\.|in\.)?linkedin\.com$/i.test(target.hostname) && target.pathname.replace(/\/+$/, "") === "/safety/go") {
        throw new Error("LinkedIn supplied a recursive safety redirect.");
    }
    return target.href;
}
const sidePanelPorts = new Map();
const LOCAL_ORIGINS = new Set([
    "http://127.0.0.1:3000", "http://localhost:3000",
    "http://127.0.0.1:3001", "http://localhost:3001"
]);
const DYNAMIC_CONTENT_ID = "job-hunter-approved-sites-v2";
const LEGACY_DYNAMIC_CONTENT_IDS = ["job-hunter-approved-sites"];
const CONTENT_SCRIPT_FILES = [
    "contracts/shared-contract-validator.js", "adapters/registry.js", "adapters/runtime.js",
    "adapters/common/shadow.js", "adapters/common/identity.js", "adapters/common/dates.js",
    "adapters/common/uploads.js", "adapters/common/repeatables.js", "adapters/common/hops.js",
    "runtime/scanner.js", "runtime/ownership.js", "runtime/executor.js", "runtime/verifier.js",
    "runtime/telemetry.js", "runtime/orchestrator.js", "content.js"
];
const ALL_JOB_SITE_ORIGINS = ["https://*/*", "http://*/*"];
const selectedApplicationFrames = new Map();
let approvedSiteRefresh = Promise.resolve();
let sidePanelHandoff = { dashboardTabId: null, until: 0 };

// Register the service-worker message boundary before starting any async
// startup work. MV3 can deliver a content-script message as soon as the worker
// wakes, so late registration creates a real lost-launch race.
chrome.runtime.onMessage.addListener(globalThis.JobHunterBackgroundMessageRouter.createHandler({
    consumeGesture: consumeGestureToOpenSidePanel,
    dispatch: dispatchBackgroundMessage
}));

function validatedSharedContract(contractName, value) {
    const parsed = globalThis.JobHunterSharedContracts?.validate?.(contractName, value);
    if (!parsed?.success) throw new Error(`${contractName} rejected: ${parsed?.reasonCode || "INVALID_CONTRACT"}.`);
    return parsed.data;
}

function logicalIdentityFromSender(partial = {}, sender = {}) {
    const tabId = Number(sender.tab?.id ?? partial.tabId);
    const frameId = Number(sender.frameId ?? partial.frameId ?? 0);
    return {
        schemaVersion: 1,
        runId: String(partial.runId || ""),
        tabId,
        frameId,
        documentId: String(sender.documentId || partial.documentId || `legacy-document-${tabId}-${frameId}`).slice(0, 160),
        documentLifecycle: ["ACTIVE", "PRERENDER", "BF_CACHE", "DISCARDED"].includes(String(sender.documentLifecycle || "").toUpperCase())
            ? String(sender.documentLifecycle).toUpperCase() : "UNKNOWN",
        pageGeneration: Math.max(0, Number(partial.pageGeneration) || 0),
        formGeneration: Math.max(0, Number(partial.formGeneration) || 0),
        formGroupId: String(partial.formGroupId || "application").slice(0, 160),
        logicalFieldFingerprint: String(partial.logicalFieldFingerprint || ""),
        fieldInstanceGeneration: Math.max(0, Number(partial.fieldInstanceGeneration) || 0)
    };
}

function sitePattern(url) {
    try {
        const parsed = new URL(String(url || ""));
        if (!["http:", "https:"].includes(parsed.protocol)) return null;
        return `${parsed.origin}/*`;
    } catch { return null; }
}

async function grantedSitePatterns() {
    const permissions = await chrome.permissions.getAll();
    // Broad access is intentionally not registered as a persistent content
    // script. It only lets the service worker inject COPILOT into the active,
    // dashboard-prepared application tab.
    return [...new Set((permissions.origins || []).filter((origin) => origin !== "<all_urls>"
        && !origin.includes("://*/*")
        && !origin.includes("localhost:3000")
        && !origin.includes("127.0.0.1:3000")
        && !origin.includes("localhost:3001")
        && !origin.includes("127.0.0.1:3001")))];
}

async function unregisterContentScriptIds(ids) {
    if (!ids?.length || !chrome.scripting?.unregisterContentScripts) return;
    try {
        await chrome.scripting.unregisterContentScripts({ ids });
    } catch {
        // Missing IDs are expected when migrating a previous registration.
    }
}

async function reconcileApprovedSiteScripts() {
    if (!chrome.scripting) return;
    await unregisterContentScriptIds(LEGACY_DYNAMIC_CONTENT_IDS);
    const matches = await grantedSitePatterns();
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [DYNAMIC_CONTENT_ID] });
    if (!matches.length) {
        if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_CONTENT_ID] });
        return;
    }
    const registration = {
        id: DYNAMIC_CONTENT_ID,
        matches,
        js: CONTENT_SCRIPT_FILES,
        runAt: "document_idle",
        allFrames: true,
        persistAcrossSessions: true
    };
    if (existing.length) {
        await chrome.scripting.updateContentScripts([registration]);
        return;
    }
    try {
        await chrome.scripting.registerContentScripts([registration]);
    } catch (error) {
        // A service-worker startup/permission event can observe the same empty
        // state concurrently. Reconcile the winner instead of surfacing the
        // harmless duplicate-ID rejection as an uncaught extension error.
        const raced = await chrome.scripting.getRegisteredContentScripts({ ids: [DYNAMIC_CONTENT_ID] });
        if (!raced.length) throw error;
        await chrome.scripting.updateContentScripts([registration]);
    }
}

function refreshApprovedSiteScripts() {
    approvedSiteRefresh = approvedSiteRefresh.catch(() => null).then(reconcileApprovedSiteScripts);
    return approvedSiteRefresh;
}

async function hasSiteAccess(url) {
    const pattern = sitePattern(url);
    if (!pattern) return false;
    const parsed = new URL(url);
    if (LOCAL_ORIGINS.has(parsed.origin)) return true;
    if (await chrome.permissions.contains({ origins: [pattern] })) return true;
    if (await chrome.permissions.contains({ origins: ALL_JOB_SITE_ORIGINS })) return true;
    return chrome.permissions.contains({ origins: [`${parsed.protocol}//*/*`] });
}

async function activateSiteAccess(tabId, originPattern) {
    const stored = await chrome.storage.local.get(["activeApplicationUrl", "activeRunAuthorization"]);
    const expectedPattern = sitePattern(stored.activeApplicationUrl);
    if (!expectedPattern || originPattern !== expectedPattern) {
        throw new Error("Permission must match the active employer site exactly.");
    }
    const granted = await chrome.permissions.contains({ origins: [originPattern] });
    if (!granted) throw new Error("Employer-site access was not granted. Autofill remains disabled.");
    if (stored.activeRunAuthorization?.runId && new URL(stored.activeApplicationUrl).origin !== stored.activeRunAuthorization.targetOrigin) {
        const updated = await request(`/api/extension/runs/${encodeURIComponent(stored.activeRunAuthorization.runId)}/authorize-origin`, {
            method: "POST",
            body: JSON.stringify({ currentUrl: stored.activeApplicationUrl })
        });
        await chrome.storage.local.set({
            activeRunAuthorization: { ...stored.activeRunAuthorization, targetOrigin: updated.targetOrigin },
            pendingOriginPermission: null
        });
    }
    await refreshApprovedSiteScripts();
    if (tabId) {
        await adoptPendingApplication(tabId);
        await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_SCRIPT_FILES }).catch(() => null);
    }
    return { granted: true, pattern: originPattern };
}

async function injectIntoActiveApplication(tabId, url, { routeChanged = false } = {}) {
    if (!tabId || !url || !(await hasSiteAccess(url))) return false;
    await adoptPendingApplication(tabId);
    const stored = await chrome.storage.local.get(["activeJob", "activeTabId", "isStopped"]);
    if (!stored.activeJob || stored.isStopped) return false;
    if (stored.activeTabId && stored.activeTabId !== tabId) return false;
    if (!stored.activeTabId) {
        await chrome.storage.local.set({ activeTabId: tabId });
    }
    if (routeChanged) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, { type: "SPA_ROUTE_CHANGED", url });
            if (response?.ok) return true;
        } catch {
            // A newly rendered route may not have a receiver yet; inject below.
        }
    }
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_SCRIPT_FILES }).catch(() => null);
    if (stored.activeJob?.id) void warmHotPath(stored.activeJob.id, url);
    return true;
}

async function adoptPendingApplication(tabId) {
    const stored = await chrome.storage.local.get("pendingDashboardApplication");
    const pending = stored.pendingDashboardApplication;
    if (!pending?.jobId || Date.now() - Number(pending.at || 0) > 15 * 60 * 1000) return null;
    try {
        const response = await request(`/api/extension/job-context?jobId=${encodeURIComponent(pending.jobId)}`);
        if (!response.job || response.application?.adapter !== "EXTENSION" || response.application.status === "SUCCESS") return null;
        watchedTabs.add(tabId);
        await chrome.storage.local.set({ activeJob: response.job, activeApplication: response.application, activeTabId: tabId, isStopped: false });
        await chrome.storage.local.remove("pendingDashboardApplication");
        return response.job;
    } catch {
        return null;
    }
}

function notifyPanelVisibility(tabId, open) {
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, { type: "SIDECAR_VISIBILITY", open }).catch(() => null);
}

function isPanelOpenForTab(tabId) {
    if (sidePanelPorts.size > 0) return true;
    return [...sidePanelPorts.values()].some((activeTabId) => activeTabId === tabId);
}

function beginSidePanelHandoff(dashboardTabId, ttlMs = 15000) {
    sidePanelHandoff = { dashboardTabId, until: Date.now() + ttlMs };
}

function clearSidePanelHandoff(dashboardTabId) {
    if (sidePanelHandoff.dashboardTabId === dashboardTabId) {
        sidePanelHandoff = { dashboardTabId: null, until: 0 };
    }
}

function isDashboardHandoffActive(tabId) {
    return sidePanelHandoff.dashboardTabId === tabId && Date.now() < sidePanelHandoff.until;
}

function consumeGestureToOpenSidePanel(message, sender) {
    if (!chrome.sidePanel?.open) return;
    // Chrome only treats runtime.onMessage as a user gesture if open() is
    // invoked in this turn — not after an await in the async handler.
    if (message?.type === "OPEN_GROUPED_APPLICATION") {
        if (!sender.tab?.id || !sender.tab.windowId) return;
        beginSidePanelHandoff(sender.tab.id);
        chrome.sidePanel.setOptions({ tabId: sender.tab.id, path: "sidepanel.html", enabled: true });
        chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
        chrome.sidePanel.open({ windowId: sender.tab.windowId });
        return;
    }
    if (message?.type === "OPEN_SIDECAR") {
        const tabId = sender.tab?.id || Number(message.tabId) || null;
        if (tabId) {
            chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true });
            chrome.sidePanel.open({ tabId });
            return;
        }
        if (sender.tab?.windowId) chrome.sidePanel.open({ windowId: sender.tab.windowId });
    }
}

async function setSidePanelEnabled(tabId, enabled) {
    if (!chrome.sidePanel || !tabId) return;
    await chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: Boolean(enabled) }).catch(() => null);
}

async function syncSidePanelForTab(tabId, url = "") {
    if (!chrome.sidePanel || !tabId) return;
    let tabUrl = url;
    if (!tabUrl) {
        try { tabUrl = (await chrome.tabs.get(tabId)).url || ""; } catch { return; }
    }
    // Only the Job Hunter dashboard/applications pages must hide COPILOT.
    // Employer tabs keep the side panel available so the candidate can grant
    // site access, open Autofill, and recover if injection races.
    const previewContexts = (await chrome.storage.local.get("documentPreviewContexts")).documentPreviewContexts || {};
    const isDocumentPreview = Boolean(previewContexts[String(tabId)]);
    if (isOrdinaryDashboardUrl(tabUrl) && !isDashboardHandoffActive(tabId) && !isDocumentPreview) {
        await setSidePanelEnabled(tabId, false);
        notifyPanelVisibility(tabId, false);
        return;
    }
    await setSidePanelEnabled(tabId, true);
}

async function configureSidePanel() {
    if (!chrome.sidePanel) return;
    // Global default stays available for employer tabs. Dashboard tabs are
    // explicitly disabled whenever they become active or finish loading.
    await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await refreshApprovedSiteScripts();
    await chrome.alarms?.create?.("job-hunter-outbox-flush", { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => { void configureSidePanel(); });
chrome.runtime.onStartup.addListener(() => {
    void configureSidePanel();
    void restoreSessionAfterRestart().catch(() => null);
    void flushDurableOutbox().catch(() => null);
});
void configureSidePanel().catch(() => null);
chrome.permissions.onAdded.addListener(() => { void refreshApprovedSiteScripts().catch(() => null); });
chrome.permissions.onRemoved.addListener(() => { void refreshApprovedSiteScripts().catch(() => null); });
chrome.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm.name === "job-hunter-outbox-flush") void flushDurableOutbox().catch(() => null);
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "job-hunter-sidepanel") return;
    sidePanelPorts.set(port, null);
    port.onMessage.addListener((message) => {
        if (message?.type !== "PANEL_ACTIVE_TAB") return;
        const previous = sidePanelPorts.get(port);
        const next = Number(message.tabId) || null;
        if (previous && previous !== next) notifyPanelVisibility(previous, false);
        sidePanelPorts.set(port, next);
        if (!next) return;
        void chrome.tabs.get(next).then(async (tab) => {
            const contexts = (await chrome.storage.local.get("documentPreviewContexts")).documentPreviewContexts || {};
            if (isOrdinaryDashboardUrl(tab.url || "") && !isDashboardHandoffActive(next) && !contexts[String(next)]) {
                notifyPanelVisibility(next, false);
                void setSidePanelEnabled(next, false);
                return;
            }
            notifyPanelVisibility(next, true);
        }).catch(() => notifyPanelVisibility(next, true));
    });
    port.onDisconnect.addListener(() => {
        const tabId = sidePanelPorts.get(port);
        sidePanelPorts.delete(port);
        notifyPanelVisibility(tabId, false);
    });
});

async function rememberLearningSummary(jobId, result = {}) {
    const learning = result.learningChangeSet || result;
    const summary = learning.summary || learning.changeSet?.summary || null;
    const changeSetId = summary?.changeSetId || learning.changeSet?.id || null;
    const learned = Number(summary?.learned ?? learning.changeSet?.itemCount ?? 0);
    const needsReview = Number(summary?.needsReview ?? summary?.held ?? learning.changeSet?.held?.length ?? 0);
    if (!learned && !needsReview) return null;
    const saved = {
        jobId: String(jobId || ""),
        changeSetId,
        learned,
        needsReview,
        canonicalKeys: (summary?.canonicalKeys || learning.changeSet?.summary?.canonicalKeys || []).slice(0, 12),
        canUndo: Boolean(changeSetId && learned),
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
    };
    await chrome.storage.local.set({ lastLearningSummary: saved });
    return saved;
}

const outboxTransport = globalThis.JobHunterBackgroundOutboxTransport.create({
    durableOutbox: globalThis.JobHunterDurableOutbox,
    request,
    rememberLearningSummary
});
// Keep this declaration hoisted because startup wiring invokes it before the
// transport constant is initialized. An async function turns that early wake
// into a caught rejection instead of aborting service-worker evaluation.
async function flushDurableOutbox() { return outboxTransport.flush(); }
const durablePost = (input) => outboxTransport.post(input);
void flushDurableOutbox().catch(() => null);

function isDashboardUrl(url = "") {
    try { return LOCAL_ORIGINS.has(new URL(url).origin); } catch { return false; }
}

function isOrdinaryDashboardUrl(url = "") {
    try { const parsed = new URL(url); return LOCAL_ORIGINS.has(parsed.origin) && parsed.pathname !== "/extension-diagnostic"; } catch { return false; }
}

function shouldKeepSeparatePopup(url = "") {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return /(?:^|\.)(?:accounts\.google\.com|login\.microsoftonline\.com|okta\.com|auth0\.com)$/.test(host);
    } catch { return false; }
}

function isNaukriRedirectReceipt(url = "") {
    try {
        const parsed = new URL(url);
        return /(?:^|\.)naukri\.com$/i.test(parsed.hostname)
            && /^\/myapply\/(?:showAcp|saveApply)(?:\/|$)/i.test(parsed.pathname);
    } catch { return false; }
}

function shouldDeferChildFold(sourceUrl = "", targetUrl = "") {
    try {
        const source = new URL(sourceUrl);
        const target = new URL(targetUrl);
        return /(?:^|\.)naukri\.com$/i.test(source.hostname)
            && !/(?:^|\.)naukri\.com$/i.test(target.hostname);
    } catch { return false; }
}

async function reportRecoveredRedirect(jobId, sourceUrl, targetUrl) {
    if (!jobId) return;
    let sourceHost = "naukri.com";
    let targetHost = "employer-site";
    try { sourceHost = new URL(sourceUrl).hostname.toLowerCase(); } catch {}
    try { targetHost = new URL(targetUrl).hostname.toLowerCase(); } catch {}
    await request(`/api/extension/jobs/${encodeURIComponent(jobId)}/progress`, {
        method: "POST",
        body: JSON.stringify({
            status: "OPENING",
            message: "Recovered the employer application after the job-board redirect page.",
            metadata: {
                pageUrl: targetUrl,
                extensionVersion: chrome.runtime.getManifest().version,
                portalKind: "naukri",
                redirectRecovered: true,
                sourceHost,
                targetHost
            }
        })
    }).catch(() => null);
}

async function settleDeferredChildFold(sourceTabId, reason = "timeout") {
    const pending = pendingSourceRedirects.get(sourceTabId);
    if (!pending) return false;
    pendingSourceRedirects.delete(sourceTabId);
    clearTimeout(pending.timer);

    const stored = await chrome.storage.local.get(["activeTabId", "activeJob"]);
    if (!stored.activeJob || stored.activeTabId !== sourceTabId) return false;
    const target = safeApplicationDestination(pending.targetUrl);
    await chrome.tabs.update(sourceTabId, { url: target, active: true });
    if (pending.childTabId) {
        closingTabs.add(pending.childTabId);
        await chrome.tabs.remove(pending.childTabId).catch(() => closingTabs.delete(pending.childTabId));
    }
    await chrome.storage.local.set({ activeApplicationUrl: target });
    void reportRecoveredRedirect(stored.activeJob.id, pending.sourceUrl, target);
    return reason === "receipt" || reason === "timeout";
}

async function foldCreatedNavigationTarget(sourceTabId, childTabId, rawTarget) {
    if (shouldKeepSeparatePopup(rawTarget)) return false;
    const target = safeApplicationDestination(rawTarget);
    const sourceTab = await chrome.tabs.get(sourceTabId);
    if (shouldDeferChildFold(sourceTab.url || "", target)) {
        const previous = pendingSourceRedirects.get(sourceTabId);
        if (previous) clearTimeout(previous.timer);
        const pending = {
            sourceTabId,
            childTabId,
            sourceUrl: sourceTab.url || "",
            targetUrl: target,
            createdAt: Date.now(),
            timer: null
        };
        // The receipt normally completes immediately. The timer covers board
        // variants that leave the source page unchanged after opening a child.
        pending.timer = setTimeout(() => {
            void settleDeferredChildFold(sourceTabId, "timeout").catch(() => null);
        }, 2500);
        pendingSourceRedirects.set(sourceTabId, pending);
        return true;
    }
    await chrome.tabs.update(sourceTabId, { url: target, active: true });
    closingTabs.add(childTabId);
    await chrome.tabs.remove(childTabId).catch(() => closingTabs.delete(childTabId));
    await chrome.storage.local.set({ activeApplicationUrl: target });
    return true;
}

async function moveSessionToAttention(reason, pageUrl = "") {
    const stored = await chrome.storage.local.get(["activeJob", "activeApplication"]);
    if (!stored.activeJob?.id || stored.activeApplication?.status === "SUCCESS") return { pending: false };
    await chrome.storage.local.set({
        pendingSubmissionReview: {
            jobId: stored.activeJob.id,
            title: stored.activeJob.title || "Application",
            reason,
            at: Date.now()
        }
    });
    return request("/api/extension/session/pending-review", {
        method: "POST",
        body: JSON.stringify({ jobId: stored.activeJob.id, reason, pageUrl })
    }).catch(() => ({ pending: false }));
}

function sameApplicationPage(candidateUrl, sessionUrl) {
    try {
        const candidate = new URL(String(candidateUrl || ""));
        const session = new URL(String(sessionUrl || ""));
        return candidate.origin === session.origin && candidate.pathname === session.pathname;
    } catch { return false; }
}

async function findRestoredApplicationTab(sessionUrl) {
    if (!sessionUrl) return null;
    const tabs = await chrome.tabs.query({}).catch(() => []);
    return tabs.find((tab) => sameApplicationPage(tab.url, sessionUrl)) || null;
}

/**
 * Chrome hands out new tab ids after a restart, so a stored session points at a
 * tab that no longer exists. Rebind it when the same application page is still
 * open, otherwise park it in the Attention Center instead of leaving a session
 * that looks active but can never be continued.
 */
async function restoreSessionAfterRestart() {
    const stored = await chrome.storage.local.get(["activeJob", "activeApplication", "activeTabId", "activeApplicationUrl", "dashboardTabId"]);
    if (!stored.activeJob?.id || stored.activeApplication?.status === "SUCCESS") return { restored: false };
    const pageUrl = stored.activeApplicationUrl || "";
    const tab = await findRestoredApplicationTab(pageUrl);
    if (tab?.id) {
        watchedTabs.add(tab.id);
        await chrome.storage.local.set({ activeTabId: tab.id, isPaused: false });
        await setSidePanelEnabled(tab.id, true).catch(() => null);
        await request("/api/extension/session/recovered", {
            method: "POST",
            body: JSON.stringify({ jobId: stored.activeJob.id, pageUrl, rebound: true })
        }).catch(() => null);
        void updateAttentionBadge();
        return { restored: true, rebound: true, tabId: tab.id };
    }
    await chrome.storage.local.set({
        pendingSubmissionReview: {
            jobId: stored.activeJob.id,
            title: stored.activeJob.title || "Application",
            reason: "CHROME_RESTARTED",
            at: Date.now()
        }
    });
    await request("/api/extension/session/recovered", {
        method: "POST",
        body: JSON.stringify({ jobId: stored.activeJob.id, pageUrl, rebound: false })
    }).catch(() => null);
    await clearActiveSession();
    if (stored.dashboardTabId) await setSidePanelEnabled(stored.dashboardTabId, false).catch(() => null);
    void updateAttentionBadge();
    return { restored: true, rebound: false };
}

async function clearActiveSession() {
    await sessionStore.clearActive();
    prewarmedDocuments.clear();
    watchedTabs.clear();
}

async function focusDashboard(tabId) {
    if (!tabId) return;
    try {
        const dashboard = await chrome.tabs.get(tabId);
        await chrome.windows.update(dashboard.windowId, { focused: true });
        await chrome.tabs.update(tabId, { active: true });
    } catch { /* Dashboard may have been closed independently. */ }
}

async function openDashboardSurface(path = "/") {
    const destPath = String(path || "/");
    const dest = `${await apiBase()}${destPath.startsWith("/") ? destPath : `/${destPath}`}`;
    const stored = await chrome.storage.local.get(["dashboardTabId", "activeTabId"]);
    let dashboardTab = null;
    if (stored.dashboardTabId) {
        try { dashboardTab = await chrome.tabs.get(stored.dashboardTabId); } catch { dashboardTab = null; }
    }
    if (!dashboardTab || !isDashboardUrl(dashboardTab.url)) {
        const existing = (await chrome.tabs.query({})).find((tab) => isOrdinaryDashboardUrl(tab.url));
        dashboardTab = existing || null;
    }
    if (dashboardTab) {
        await chrome.tabs.update(dashboardTab.id, { url: dest, active: true });
    } else {
        const windowId = stored.activeTabId ? (await chrome.tabs.get(stored.activeTabId).catch(() => null))?.windowId : undefined;
        dashboardTab = await chrome.tabs.create({ url: dest, active: true, ...(windowId ? { windowId } : {}) });
    }
    await chrome.storage.local.set({ dashboardTabId: dashboardTab.id });
    await chrome.windows.update(dashboardTab.windowId, { focused: true }).catch(() => null);
    if (stored.activeTabId) {
        await groupApplicationTabs(dashboardTab.id, stored.activeTabId).catch(() => null);
        await setSidePanelEnabled(dashboardTab.id, false);
    }
    return { opened: true, tabId: dashboardTab.id, url: dest };
}

async function openGroupedDocumentTab(jobId, kind = "resume") {
    const stored = await chrome.storage.local.get(["activeJob", "activeTabId", "documentPreviewContexts"]);
    if (!stored.activeJob?.id || stored.activeJob.id !== jobId || !stored.activeTabId) {
        throw new Error("Open the prepared application tab before opening its documents.");
    }
    const applicationTab = await chrome.tabs.get(stored.activeTabId);
    const base = await apiBase();
    const encodedJob = encodeURIComponent(jobId);
    const url = kind === "cover"
        ? `${base}/jobs/${encodedJob}/cover-letter.html`
        : `${base}/jobs/${encodedJob}/resume-preview`;
    const previewTab = await chrome.tabs.create({ url, active: false, windowId: applicationTab.windowId });
    if (chrome.tabs.group) {
        const groupId = applicationTab.groupId >= 0
            ? await chrome.tabs.group({ groupId: applicationTab.groupId, tabIds: previewTab.id })
            : await chrome.tabs.group({ tabIds: [applicationTab.id, previewTab.id] });
        if (chrome.tabGroups && groupId >= 0) {
            await chrome.tabGroups.update(groupId, { title: "Job Hunter · Applying", color: "blue", collapsed: false });
        }
    }
    const contexts = { ...(stored.documentPreviewContexts || {}) };
    contexts[String(previewTab.id)] = {
        tabId: previewTab.id,
        applicationTabId: applicationTab.id,
        jobId,
        kind: kind === "cover" ? "cover" : "resume",
        openedAt: Date.now()
    };
    await chrome.storage.local.set({ documentPreviewContexts: contexts });
    await setSidePanelEnabled(previewTab.id, true);
    await chrome.tabs.update(previewTab.id, { active: true });
    return { opened: true, tabId: previewTab.id, applicationTabId: applicationTab.id, url };
}

async function returnFromDocumentTab(currentTabId) {
    const stored = await chrome.storage.local.get(["activeJob", "activeTabId", "documentPreviewContexts"]);
    const contexts = { ...(stored.documentPreviewContexts || {}) };
    const context = contexts[String(currentTabId)];
    if (!context || context.jobId !== stored.activeJob?.id || context.applicationTabId !== stored.activeTabId) {
        throw new Error("This document tab is no longer linked to an active application.");
    }
    const applicationTab = await chrome.tabs.get(context.applicationTabId);
    const previewTab = await chrome.tabs.get(currentTabId);
    if (context.kind === "resume") {
        let selectedTemplate = "";
        try { selectedTemplate = new URL(previewTab.url || "").searchParams.get("template") || ""; } catch { /* keep current template */ }
        if (selectedTemplate) {
            await request(`/api/extension/jobs/${encodeURIComponent(context.jobId)}/resume-selection`, {
                method: "POST",
                body: JSON.stringify({ templateId: selectedTemplate })
            });
        }
    }
    prewarmedDocuments.delete(`${context.jobId}:${context.kind}`);
    let attached = false;
    let attachmentError = "";
    try {
        const payload = context.kind === "cover"
            ? { type: "ATTACH_DOCUMENT", kind: "cover", jobId: context.jobId }
            : { type: "REPLACE_RESUME_DOCUMENT" };
        const response = await deliverToApplicationFrame(applicationTab.id, payload);
        attached = Boolean(response?.ok);
        if (!attached) attachmentError = response?.error || "The employer form does not currently expose a compatible document field.";
    } catch (error) {
        attachmentError = error.message;
    }
    if (context.kind === "resume") {
        if (attached) await chrome.storage.local.remove("pendingResumeReplacement");
        else await chrome.storage.local.set({ pendingResumeReplacement: { jobId: context.jobId, at: Date.now() } });
    }
    delete contexts[String(currentTabId)];
    await chrome.storage.local.set({
        documentPreviewContexts: contexts,
        preferredSidePanelView: { view: "documents", jobId: context.jobId, at: Date.now() }
    });
    await setSidePanelEnabled(applicationTab.id, true);
    await chrome.windows.update(applicationTab.windowId, { focused: true }).catch(() => null);
    await chrome.tabs.update(applicationTab.id, { active: true });
    if (chrome.sidePanel?.open) await chrome.sidePanel.open({ tabId: applicationTab.id }).catch(() => null);
    await chrome.tabs.remove(currentTabId).catch(() => null);
    return { activated: true, attached, attachmentError };
}

async function liveDocumentTargets(tabId) {
    if (!tabId) return { resume: { available: false }, cover: { available: false } };
    const response = await deliverToApplicationFrame(tabId, { type: "GET_DOCUMENT_TARGETS" }).catch(() => null);
    return response?.ok && response.result
        ? response.result
        : { resume: { available: false }, cover: { available: false } };
}

async function closeApplicationTab(tabId) {
    if (!tabId) return;
    closingTabs.add(tabId);
    try { await chrome.tabs.remove(tabId); } catch { closingTabs.delete(tabId); }
}

async function groupApplicationTabs(dashboardTabId, applicationTabId) {
    // Enable the application tab first so disabling the dashboard cannot close
    // a window-level panel that was opened from the dashboard click.
    await setSidePanelEnabled(applicationTabId, true);
    if (!isDashboardHandoffActive(dashboardTabId)) await setSidePanelEnabled(dashboardTabId, false);
    if (!chrome.tabs.group || !chrome.tabGroups) return null;
    const dashboard = await chrome.tabs.get(dashboardTabId);
    let groupId = dashboard.groupId;
    if (groupId >= 0) await chrome.tabs.group({ groupId, tabIds: applicationTabId });
    else groupId = await chrome.tabs.group({ tabIds: [dashboardTabId, applicationTabId] });
    await chrome.tabGroups.update(groupId, { title: "Job Hunter · Applying", color: "blue", collapsed: false });
    return groupId;
}

async function prepareExtensionApplication(jobId) {
    const response = await fetch(`${await apiBase()}/jobs/${encodeURIComponent(jobId)}/open-with-extension`, {
        method: "POST",
        headers: { Accept: "application/json" }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || "Application preparation failed.");
    return body;
}

async function openGroupedApplication({ jobId, url, prepare = false, launchRequest = null }, dashboardTabId, { windowId } = {}) {
    if (!dashboardTabId) throw new Error("The Job Hunter dashboard tab could not be identified.");
    beginSidePanelHandoff(dashboardTabId);
    let createdApplicationTabId = null;
    try {
        // Host permission is requested from the side panel button. Avoid requesting
        // it here because user-gesture state can be lost by async preparation.
        const dashboardWindowId = windowId || (await chrome.tabs.get(dashboardTabId)).windowId;
        const stored = await chrome.storage.local.get(["activeJob", "activeTabId", "dashboardTabId", "activeApplicationUrl"]);
        if (stored.activeJob?.id && stored.activeJob.id !== jobId) {
            await moveSessionToAttention("SWITCHED_TO_ANOTHER_APPLICATION", stored.activeApplicationUrl || "");
            await closeApplicationTab(stored.activeTabId);
            await clearActiveSession();
        }

        let destination = String(url || "");
        let target = destination ? safeApplicationDestination(destination) : null;

        let applicationTab = null;
        if (stored.activeJob?.id === jobId && stored.activeTabId) {
            try { applicationTab = await chrome.tabs.get(stored.activeTabId); } catch { applicationTab = null; }
        }
        if (!applicationTab) {
            // Keep the new tab inert until the backend consumes the single-use
            // launch authorization. A failed/replayed request must never open
            // an employer page as a side effect.
            applicationTab = await chrome.tabs.create({ url: "about:blank", active: true, windowId: dashboardWindowId });
            createdApplicationTabId = applicationTab.id;
        }

        // Keep COPILOT on the application tab. Opening with tabId after the
        // click-gesture window open follows the new tab instead of the dashboard.
        await setSidePanelEnabled(applicationTab.id, true);
        await chrome.tabs.update(applicationTab.id, { active: true });
        if (chrome.sidePanel?.open) {
            chrome.sidePanel.open({ tabId: applicationTab.id }).catch(() => {
                chrome.sidePanel.open({ windowId: dashboardWindowId }).catch(() => null);
            });
        }

        if (prepare) {
            const prepared = await prepareExtensionApplication(jobId);
            if (!destination) destination = String(prepared.jobUrl || "");
            target = safeApplicationDestination(destination);
        }
        if (!target) throw new Error("No application destination URL was available.");

        const dashboardTab = await chrome.tabs.get(dashboardTabId);
        const websiteOrigin = new URL(dashboardTab.url).origin;
        const protocolRequest = launchRequest || {
            messageId: crypto.randomUUID(),
            clientNonce: `${crypto.randomUUID()}${crypto.randomUUID()}`,
            sentAtMs: Date.now(),
            protocolVersion: 1,
            websiteOrigin
        };
        if (protocolRequest.protocolVersion !== 1 || protocolRequest.websiteOrigin !== websiteOrigin) {
            throw new Error("The website and Copilot extension protocol do not match.");
        }
        const authorization = await request("/api/extension/launches/issue", {
            method: "POST",
            skipRunAuth: true,
            body: JSON.stringify({
                messageId: protocolRequest.messageId,
                sentAtMs: protocolRequest.sentAtMs,
                clientNonce: protocolRequest.clientNonce,
                protocolVersion: protocolRequest.protocolVersion,
                websiteOrigin,
                jobId,
                targetUrl: target
            })
        });
        const bound = await request("/api/extension/launches/consume", {
            method: "POST",
            skipRunAuth: true,
            body: JSON.stringify({
                authorizationId: authorization.authorizationId,
                launchToken: authorization.launchToken,
                clientNonce: protocolRequest.clientNonce,
                protocolVersion: protocolRequest.protocolVersion,
                websiteOrigin,
                jobId,
                targetUrl: target,
                tabId: applicationTab.id,
                frameId: 0,
                documentId: `pending-document-${applicationTab.id}`,
                documentLifecycle: "UNKNOWN",
                extensionVersion: chrome.runtime.getManifest().version
            })
        });
        const activeRunAuthorization = {
            runId: bound.runId,
            applicationId: bound.applicationId,
            bindingId: bound.bindingId,
            sessionToken: bound.sessionToken,
            targetOrigin: authorization.targetOrigin,
            protocolVersion: authorization.protocolVersion,
            expiresAtMs: bound.expiresAtMs
        };
        await chrome.storage.local.set({ activeRunAuthorization });

        const siteAccess = await hasSiteAccess(target);
        const response = await request("/api/extension/runs/bootstrap", {
            method: "POST",
            body: JSON.stringify({ runId: bound.runId })
        });
        if (!response.job || response.application?.adapter !== "EXTENSION" || response.application.status === "SUCCESS") {
            throw new Error("Prepare this application from Job Hunter before opening it.");
        }

        await chrome.tabs.update(applicationTab.id, { url: target, active: true });
        watchedTabs.add(applicationTab.id);
        await chrome.storage.local.remove("lastLearningSummary");
        await chrome.storage.local.set({
            activeJob: response.job,
            activeApplication: response.application,
            activeTabId: applicationTab.id,
            dashboardTabId,
            activeApplicationUrl: target,
            isStopped: false,
            pendingDashboardApplication: { jobId, targetUrl: target, sourceTabId: dashboardTabId, at: Date.now() }
        });
        await groupApplicationTabs(dashboardTabId, applicationTab.id).catch(() => null);
        await setSidePanelEnabled(applicationTab.id, true);
        if (isPanelOpenForTab(applicationTab.id) || sidePanelPorts.size > 0) notifyPanelVisibility(applicationTab.id, true);
        const injected = siteAccess ? await injectIntoActiveApplication(applicationTab.id, target) : false;
        if (siteAccess) setTimeout(() => { void injectIntoActiveApplication(applicationTab.id, target); }, 1200);
        else await chrome.action.setBadgeText({ text: "!" }).catch(() => null);
        void warmHotPath(jobId, target);
        return {
            opened: true,
            tabId: applicationTab.id,
            jobId,
            siteAccess,
            permissionOrigin: siteAccess ? null : `${new URL(target).origin}/*`,
            protocolVersion: authorization.protocolVersion,
            runId: bound.runId,
            injected: Boolean(injected)
        };
    } catch (error) {
        if (createdApplicationTabId) await closeApplicationTab(createdApplicationTabId).catch(() => null);
        throw error;
    } finally {
        setTimeout(() => clearSidePanelHandoff(dashboardTabId), 4000);
    }
}

async function finishApplicationSession(applicationTabId) {
    const stored = await chrome.storage.local.get("dashboardTabId");
    await closeApplicationTab(applicationTabId);
    await clearActiveSession();
    // Never re-enable COPILOT on the Job Hunter applications/dashboard tab.
    if (stored.dashboardTabId) await setSidePanelEnabled(stored.dashboardTabId, false);
    await focusDashboard(stored.dashboardTabId);
}

async function updateAttentionBadge() {
    try {
        const result = await request("/api/extension/attention");
        const count = Number(result.blockingCount || 0);
        await chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
        await chrome.action.setBadgeText({ text: count ? String(Math.min(count, 99)) : "" });
    } catch {
        // Badge is advisory; application work must not fail with it.
    }
}

function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
}

const prewarmedDocuments = new Map();

function slimHotProfile(profile = {}) {
    const cleanRows = (rows, keys) => (Array.isArray(rows) ? rows : []).slice(0, 12).map((row) =>
        Object.fromEntries(keys.map((key) => [key, Array.isArray(row?.[key])
            ? row[key].map(String).filter(Boolean).slice(0, 8)
            : String(row?.[key] ?? "").trim()])))
        .filter((row) => Object.values(row).some((value) => Array.isArray(value) ? value.length : value));
    return {
        name: profile.name || "",
        email: profile.email || "",
        phone: profile.phone || "",
        preferredFirstName: profile.preferredFirstName || "",
        preferredLastName: profile.preferredLastName || "",
        linkedinUrl: profile.linkedinUrl || profile.linkedin || "",
        githubUrl: profile.githubUrl || profile.github || "",
        portfolioUrl: profile.portfolioUrl || profile.portfolio || "",
        currentLocation: profile.currentLocation || "",
        totalExperienceYears: profile.totalExperienceYears ?? "",
        skills: Array.isArray(profile.skills) ? profile.skills.map(String).filter(Boolean).slice(0, 80) : [],
        preferredSkills: Array.isArray(profile.preferredSkills) ? profile.preferredSkills.map(String).filter(Boolean).slice(0, 30) : [],
        experience: cleanRows(profile.experience, ["title", "company", "location", "startDate", "endDate", "description", "bullets"]),
        education: cleanRows(profile.education, ["institution", "school", "degree", "field", "location", "startDate", "endDate", "description"])
    };
}

function mappingPackStorageKey(url) {
    try { return `mappingPack:${new URL(String(url || "")).hostname.toLowerCase()}`; } catch { return ""; }
}

async function fetchDocumentPayload(jobId, kind) {
    const path = kind === "cover" ? "cover-letter" : "resume";
    const response = await fetch(`${await apiBase()}/api/extension/jobs/${jobId}/${path}`);
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `${kind} download failed.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { base64: bytesToBase64(bytes), contentType: response.headers.get("content-type") || "application/pdf" };
}

async function storeDocument(jobId, kind, payload) {
    if (!payload?.base64) return;
    prewarmedDocuments.set(`${jobId}:${kind}`, payload);
}

async function documentForJob(jobId, kind) {
    const memoryKey = `${jobId}:${kind}`;
    if (prewarmedDocuments.has(memoryKey)) return prewarmedDocuments.get(memoryKey);
    const payload = await fetchDocumentPayload(jobId, kind);
    await storeDocument(jobId, kind, payload);
    return payload;
}

async function readCachedMappingPack(url) {
    const key = mappingPackStorageKey(url);
    if (!key) return null;
    const stored = await chrome.storage.local.get(key);
    return stored[key] || null;
}

async function fetchAndCacheMappingPack(url) {
    const runtime = await request(`/api/extension/mapping-pack?url=${encodeURIComponent(url || "")}`);
    const key = mappingPackStorageKey(url);
    if (key && runtime) await chrome.storage.local.set({ [key]: runtime });
    return runtime;
}

async function mappingPackFor(url, { fresh = false } = {}) {
    if (!fresh) {
        const cached = await readCachedMappingPack(url);
        if (cached) {
            void fetchAndCacheMappingPack(url).catch(() => null);
            return cached;
        }
    }
    return fetchAndCacheMappingPack(url);
}

async function hotProfile(jobId = "") {
    const stored = await chrome.storage.local.get("hotProfile");
    if ((stored.hotProfile?.email || stored.hotProfile?.name)
        && (stored.hotProfile?.experience?.length || stored.hotProfile?.education?.length || !jobId)) return stored.hotProfile;
    const sidecar = jobId ? await request(`/api/extension/jobs/${jobId}/sidecar-state`).catch(() => null) : null;
    const profile = slimHotProfile(sidecar?.profileDetails || await request("/api/profile").catch(() => ({})));
    await chrome.storage.local.set({ hotProfile: profile });
    return profile;
}

async function warmHotPath(jobId, url) {
    if (!jobId) return;
    const tasks = [
        request(`/api/extension/jobs/${jobId}/sidecar-state`)
            .then((state) => chrome.storage.local.set({ hotProfile: slimHotProfile(state.profileDetails || {}) }))
            .catch(() => request("/api/profile").then((profile) => chrome.storage.local.set({ hotProfile: slimHotProfile(profile) })).catch(() => null)),
        documentForJob(jobId, "resume").catch(() => null),
        documentForJob(jobId, "cover").catch(() => null)
    ];
    if (url) tasks.push(fetchAndCacheMappingPack(url).catch(() => null));
    await Promise.all(tasks);
}

async function jobContext(url, tabId, { replay = false } = {}) {
    try {
        const parsed = new URL(url);
        if (["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname !== "/extension-diagnostic") {
            return null;
        }
    } catch {
        return null;
    }

    const existingSession = await chrome.storage.local.get(["activeJob", "activeTabId", "pendingDashboardApplication"]);
    if (existingSession.activeJob && existingSession.activeTabId && existingSession.activeTabId !== tabId) return null;

    // First: try to match the URL directly to a job in the DB
    try {
        const response = await request(`/api/extension/job-context?url=${encodeURIComponent(url)}`);
        if (response.job
            && response.application
            && response.application.adapter === "EXTENSION"
            && (response.application.status !== "SUCCESS" || replay)) {
            // Register this tab as a COPILOT-active tab
            watchedTabs.add(tabId);
            const previous = await chrome.storage.local.get(["activeJob", "isStopped"]);
            await chrome.storage.local.set({
                activeJob: response.job,
                activeApplication: response.application || null,
                activeTabId: tabId || null,
                isStopped: previous.activeJob?.id === response.job.id ? Boolean(previous.isStopped) : false,
            });
            return response.job;
        }
        // A scraped URL match without a prepared extension session must not
        // block the dashboard-prepared active application on this tab.
    } catch {
        // Fall through to session-based check
    }

    const stored = await chrome.storage.local.get(["activeJob", "activeTabId", "navigation", "pendingDashboardApplication"]);
    if (!stored.activeJob || !tabId) {
        const pending = await adoptPendingApplication(tabId);
        return pending;
    }

    // Same tab — always inherit
    if (stored.activeTabId === tabId) {
        watchedTabs.add(tabId);
        return stored.activeJob;
    }

    // Pending dashboard launch can land on a redirected employer URL before
    // activeTabId is confirmed; adopt it instead of leaving COPILOT dark.
    if (stored.pendingDashboardApplication?.jobId) {
        const pending = await adoptPendingApplication(tabId);
        if (pending) return pending;
    }

    return null;
}

function sendToFrame(tabId, frameId, payload) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ ok: false, error: "The embedded frame did not respond within 5 seconds." }), 5000);
        chrome.tabs.sendMessage(tabId, payload, { frameId }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
            resolve(response || { ok: false, error: "The frame did not respond." });
        });
    });
}

async function injectScriptsIntoFrame(tabId, frameId) {
    await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        files: CONTENT_SCRIPT_FILES
    }).catch(() => null);
}

function probeLooksLikeForm(result = {}) {
    return Boolean(result.likely || result.likely)
        || Number(result.fieldCount || result.fieldCount || 0) >= 3;
}

async function probeChildFrame(tabId, frameId) {
    let response = await sendToFrame(tabId, frameId, { type: "PROBE_FORM" });
    if (!response.ok) {
        await injectScriptsIntoFrame(tabId, frameId);
        response = await sendToFrame(tabId, frameId, { type: "PROBE_FORM" });
    }
    return response;
}

async function selectApplicationFrame(tabId, senderFrameId = -1) {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const probes = [];
    for (const frame of frames || []) {
        if (frame.frameId === senderFrameId) continue;
        const response = await probeChildFrame(tabId, frame.frameId);
        if (response.ok && probeLooksLikeForm(response.result)) {
            probes.push({ frameId: frame.frameId, ...response.result });
        }
    }
    probes.sort((a, b) => Number(Boolean(b.likely || b.likely)) - Number(Boolean(a.likely || a.likely))
        || Number(b.fieldCount || b.fieldCount || 0) - Number(a.fieldCount || a.fieldCount || 0));
    const selected = probes[0] || null;
    if (selected) selectedApplicationFrames.set(tabId, selected.frameId);
    return selected;
}

async function deliverToApplicationFrame(tabId, payload) {
    const remembered = selectedApplicationFrames.get(tabId);
    if (remembered != null) {
        const response = await sendToFrame(tabId, remembered, payload);
        if (response.ok) return response;
    }
    const selected = await selectApplicationFrame(tabId);
    if (selected) return sendToFrame(tabId, selected.frameId, payload);
    return chrome.tabs.sendMessage(tabId, payload).catch((error) => ({ ok: false, error: error.message }));
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
    watchedTabs.delete(tabId);
    pendingChildTabs.delete(tabId);
    const sourceRedirect = pendingSourceRedirects.get(tabId);
    if (sourceRedirect) {
        clearTimeout(sourceRedirect.timer);
        pendingSourceRedirects.delete(tabId);
    }
    for (const pending of pendingSourceRedirects.values()) {
        if (pending.childTabId === tabId) pending.childTabId = null;
    }
    selectedApplicationFrames.delete(tabId);
    const previewStored = await chrome.storage.local.get("documentPreviewContexts").catch(() => ({}));
    if (previewStored.documentPreviewContexts?.[String(tabId)]) {
        const contexts = { ...previewStored.documentPreviewContexts };
        delete contexts[String(tabId)];
        await chrome.storage.local.set({ documentPreviewContexts: contexts }).catch(() => null);
    }
    if (closingTabs.delete(tabId)) return;
    try {
        const stored = await chrome.storage.local.get(["activeTabId", "activeJob", "activeApplication", "activeApplicationUrl", "dashboardTabId"]);
        if (stored.activeTabId === tabId) {
            if (stored.activeApplication?.status !== "SUCCESS") await moveSessionToAttention("APPLICATION_TAB_CLOSED", stored.activeApplicationUrl || "");
            await clearActiveSession();
            if (stored.dashboardTabId) await setSidePanelEnabled(stored.dashboardTabId, false);
            await focusDashboard(stored.dashboardTabId);
            void updateAttentionBadge();
        }
    } catch {
        // Ignore background cleanup errors
    }
});

async function dispatchBackgroundMessage(message, sender) {
        switch (message.type) {
            case "NEGOTIATE_PROTOCOL": {
                if (!sender.tab?.id || !isDashboardUrl(sender.tab.url)) throw new Error("Protocol negotiation is available only on the Job Hunter website.");
                const supported = Array.isArray(message.protocolVersions) ? message.protocolVersions.map(Number) : [];
                const protocolVersion = supported.includes(1) ? 1 : null;
                if (!protocolVersion) {
                    return {
                        state: "VERSION_INCOMPATIBLE",
                        protocolVersion: null,
                        supportedProtocolVersions: [1],
                        extensionVersion: chrome.runtime.getManifest().version,
                        reasonCode: "NO_SHARED_PROTOCOL_VERSION"
                    };
                }
                const target = message.targetUrl ? safeApplicationDestination(message.targetUrl) : null;
                const siteAccess = target ? await hasSiteAccess(target) : true;
                return {
                    state: siteAccess ? "READY_TO_LAUNCH" : "PERMISSION_REQUIRED",
                    protocolVersion,
                    supportedProtocolVersions: [1],
                    extensionVersion: chrome.runtime.getManifest().version,
                    permissionOrigin: target && !siteAccess ? `${new URL(target).origin}/*` : null,
                    reasonCode: siteAccess ? null : "EMPLOYER_ORIGIN_PERMISSION_REQUIRED"
                };
            }
            case "JOB_CONTEXT": {
                const job = await jobContext(message.url, sender.tab?.id, { replay: message.replay === true });
                const stored = await chrome.storage.local.get("activeRunAuthorization");
                let bindingError = null;
                if (job && stored.activeRunAuthorization?.runId && sender.tab?.id && sender.frameId === 0) {
                    try {
                        await request(`/api/extension/runs/${encodeURIComponent(stored.activeRunAuthorization.runId)}/rebind`, {
                            method: "POST",
                            body: JSON.stringify({
                                tabId: sender.tab.id,
                                frameId: sender.frameId || 0,
                                documentId: sender.documentId || `document-${sender.tab.id}`,
                                documentLifecycle: sender.documentLifecycle || "ACTIVE",
                                currentUrl: message.url
                            })
                        });
                    } catch (error) {
                        bindingError = error.message;
                        await chrome.storage.local.set({ pendingOriginPermission: { url: message.url, reason: bindingError, at: Date.now() } });
                    }
                }
                return {
                    job,
                    runContext: job && stored.activeRunAuthorization ? {
                        runId: stored.activeRunAuthorization.runId,
                        applicationId: stored.activeRunAuthorization.applicationId,
                        schemaVersion: 1
                    } : null,
                    permissionRequired: bindingError ? { url: message.url, reason: bindingError } : null
                };
            }
            case "REGISTER_TAB":
                // content.js calls this when COPILOT successfully mounts on a page
                if (sender.tab?.id) watchedTabs.add(sender.tab.id);
                return { registered: true };
            case "GET_PANEL_VISIBILITY":
                return { open: isPanelOpenForTab(sender.tab?.id) };
            case "PREPARE_APPLICATION_NAVIGATION": {
                if (!sender.tab?.id) throw new Error("The dashboard tab could not be identified.");
                const source = new URL(sender.tab.url || "");
                if (!LOCAL_ORIGINS.has(source.origin)) throw new Error("Application navigation can only be prepared from the local dashboard.");
                await chrome.storage.local.set({ pendingDashboardApplication: {
                    jobId: String(message.jobId || ""),
                    targetUrl: String(message.url || ""),
                    sourceTabId: sender.tab.id,
                    at: Date.now()
                } });
                return { prepared: true };
            }
            case "OPEN_GROUPED_APPLICATION": {
                if (!sender.tab?.id || !isDashboardUrl(sender.tab.url)) throw new Error("Applications can only be opened from the Job Hunter dashboard.");
                return openGroupedApplication(
                    {
                        jobId: String(message.jobId || ""),
                        url: String(message.url || ""),
                        prepare: message.prepare === true,
                        launchRequest: message.launchRequest || null
                    },
                    sender.tab.id,
                    { windowId: sender.tab.windowId }
                );
            }
            case "CONTINUE_ACTIVE_APPLICATION": {
                const stored = await chrome.storage.local.get("activeTabId");
                if (!stored.activeTabId) throw new Error("No application is currently open.");
                const tab = await chrome.tabs.get(stored.activeTabId);
                await chrome.tabs.update(tab.id, { active: true });
                await chrome.windows.update(tab.windowId, { focused: true });
                return { continued: true };
            }
            case "FINISH_APPLICATION_LATER": {
                const stored = await chrome.storage.local.get(["activeTabId", "activeApplicationUrl"]);
                await moveSessionToAttention("CANDIDATE_FINISHED_LATER", stored.activeApplicationUrl || "");
                await finishApplicationSession(stored.activeTabId);
                void updateAttentionBadge();
                return { pending: true };
            }
            case "CONFIRM_ACTIVE_SUBMITTED": {
                const stored = await chrome.storage.local.get(["activeJob", "activeTabId", "activeApplicationUrl", "pendingSubmissionReview"]);
                const jobId = stored.activeJob?.id || stored.pendingSubmissionReview?.jobId;
                if (!jobId) throw new Error("No active application was found.");
                const result = await request(`/api/extension/jobs/${jobId}/submitted`, {
                    method: "POST", body: JSON.stringify({ pageUrl: stored.activeApplicationUrl || "", candidateVerified: true })
                });
                await rememberLearningSummary(jobId, result);
                await chrome.storage.local.remove("pendingSubmissionReview");
                await finishApplicationSession(stored.activeTabId);
                void updateAttentionBadge();
                return result;
            }
            case "DISMISS_SUBMISSION_REVIEW": {
                await chrome.storage.local.remove("pendingSubmissionReview");
                void updateAttentionBadge();
                return { dismissed: true };
            }
            case "ANALYZE_PAGE":
                return request(`/api/extension/jobs/${message.jobId}/analyze-page`, {
                    method: "POST", body: JSON.stringify(message.payload)
                });
            case "RESOLVE_ASSIST": {
                const result = await request(`/api/extension/jobs/${message.jobId}/assist`, {
                    method: "POST", body: JSON.stringify(message.payload || {})
                });
                await chrome.storage.local.set({ activeAssist: result });
                return result;
            }
            case "RECORD_ASSIST_COPY":
                if (sender.tab) throw new Error("Assist copy evidence is available only to the trusted side panel.");
                return request(`/api/extension/jobs/${message.jobId}/assist-copy`, {
                    method: "POST",
                    body: JSON.stringify({ semanticKey: message.semanticKey, surface: message.surface })
                });
            case "REPORT_PROGRESS": {
                const result = await request(`/api/extension/jobs/${message.jobId}/progress`, {
                    method: "POST", body: JSON.stringify(message.payload)
                });
                if (result.application) await chrome.storage.local.set({ activeApplication: result.application });
                if (["FORM_DETECTED", "FILLING", "READY_TO_SUBMIT"].includes(String(message.payload?.status || "").toUpperCase())) {
                    await chrome.storage.local.remove("activeAssist");
                }
                void updateAttentionBadge();
                return result;
            }
            case "RECORD_OPERATION":
                return request(`/api/extension/jobs/${message.jobId}/operation-event`, {
                    method: "POST", body: JSON.stringify(message.payload)
                });
            case "RECORD_FIELD_REVISION": {
                const contract = validatedSharedContract("FieldRevision", {
                    ...message.payload,
                    identity: logicalIdentityFromSender(message.payload?.identity, sender)
                });
                return durablePost({
                    runId: contract.identity.runId,
                    operationId: contract.operationId,
                    kind: "FIELD_REVISION",
                    ownership: contract.identity,
                    path: `/api/extension/jobs/${message.jobId}/field-revision`,
                    body: contract
                });
            }
            case "RECORD_EDIT_SESSION": {
                const contract = validatedSharedContract("EditSession", {
                    ...message.payload,
                    identity: logicalIdentityFromSender(message.payload?.identity, sender)
                });
                return durablePost({
                    runId: contract.identity.runId,
                    operationId: contract.editSessionId,
                    kind: "EDIT_SESSION",
                    ownership: contract.identity,
                    path: `/api/extension/jobs/${message.jobId}/edit-session`,
                    body: contract
                });
            }
            case "RECORD_CHECKPOINT_RECEIPT": {
                const contract = validatedSharedContract("CheckpointReceipt", message.payload);
                return durablePost({
                    runId: contract.runId,
                    operationId: contract.checkpointId,
                    kind: "CHECKPOINT_RECEIPT",
                    ownership: { tabId: sender.tab?.id || 0, frameId: sender.frameId || 0, documentId: sender.documentId || "unknown" },
                    path: `/api/extension/jobs/${message.jobId}/checkpoint-receipt`,
                    body: contract
                });
            }
            case "FILL_CHILD_FRAMES": {
                if (!sender.tab?.id) throw new Error("The extension could not identify the current browser tab.");
                const selected = await selectApplicationFrame(sender.tab.id, sender.frameId);
                if (!selected) return { filled: false, reason: "No application form was detected in child frames." };
                const response = await sendToFrame(sender.tab.id, selected.frameId, {
                    type: "FILL_FRAME",
                    executePlan: message.executePlan === true || message.executePlan === true
                });
                if (!response.ok) throw new Error(response.error || "The embedded application form could not be filled.");
                return { filled: true, frameId: selected.frameId, result: response.result };
            }
            case "RESOLVE_FIELDS":
                {
                    const stored = await chrome.storage.local.get("activeRunAuthorization");
                    const run = stored.activeRunAuthorization;
                    let payload = message.payload || {};
                    if (run?.runId && Array.isArray(payload.fields)) {
                        const delta = await request(`/api/extension/runs/${encodeURIComponent(run.runId)}/resolve-delta`, {
                            method: "POST",
                            body: JSON.stringify({
                                pageGeneration: payload.pageGeneration || 0,
                                formGeneration: payload.formGeneration || 0,
                                fields: payload.fields.map((field) => ({
                                    logicalFieldFingerprint: field.logicalFieldFingerprint,
                                    descriptorHash: field.descriptorHash
                                }))
                            })
                        });
                        const changed = new Set(delta.changedLogicalFieldFingerprints || []);
                        payload = { ...payload, fields: payload.fields.filter((field) => changed.has(field.logicalFieldFingerprint)) };
                        if (!payload.fields.length) {
                            return {
                                blocked: false,
                                delta: true,
                                answers: [],
                                plan: { actions: [], review: [], summary: { ready: 0, needsYou: 0, manual: 0, aiDrafts: 0 } },
                                currentQuestion: null,
                                sensitiveFields: [],
                                attentionItems: []
                            };
                        }
                    }
                    const result = await request(`/api/extension/jobs/${message.jobId}/resolve-fields`, {
                        method: "POST", body: JSON.stringify(payload)
                    });
                    if (run?.runId && payload.fields.length) {
                        await request(`/api/extension/runs/${encodeURIComponent(run.runId)}/resolve-delta/commit`, {
                            method: "POST",
                            body: JSON.stringify({
                                logicalFieldFingerprints: payload.fields.map((field) => field.logicalFieldFingerprint)
                            })
                        });
                    }
                    void updateAttentionBadge();
                    return result;
                }
            case "ANSWER_AGENT_QUESTION":
                return request(`/api/extension/jobs/${message.jobId}/agent-questions/${message.questionId}/answer`, {
                    method: "POST", body: JSON.stringify(message.payload)
                }).then((result) => { void updateAttentionBadge(); return result; });
            case "SAVE_MANUAL_INPUT":
                return request(`/api/extension/jobs/${message.jobId}/manual-input`, {
                    method: "POST", body: JSON.stringify(message.payload)
                }).then((result) => { void updateAttentionBadge(); return result; });
            case "RESOLVE_ATTENTION":
                return request(`/api/extension/jobs/${message.jobId}/attention/${encodeURIComponent(message.fieldId)}/resolve`, {
                    method: "POST", body: JSON.stringify({ decision: message.decision })
                }).then((result) => { void updateAttentionBadge(); return result; });
            case "SET_REUSE_CONSENT":
                return request(`/api/extension/jobs/${message.jobId}/reuse-consent`, {
                    method: "POST", body: JSON.stringify(message.payload)
                });
            case "SET_APPLICATION_LEARNING":
                return request(`/api/extension/jobs/${message.jobId}/learning-preference`, {
                    method: "POST", body: JSON.stringify(message.payload)
                });
            case "SET_AUTOFILL_POLICY":
                if (sender.tab) throw new Error("Autofill policies can only be changed from the trusted side panel.");
                return request("/api/extension/autofill-policies", {
                    method: "POST", body: JSON.stringify({ ...message.payload, candidateApproved: true })
                });
            case "RECORD_FIELD_EVIDENCE":
                return request(`/api/extension/jobs/${message.jobId}/field-evidence`, {
                    method: "POST", body: JSON.stringify(message.payload)
                });
            case "GET_ADAPTER_RUNTIME": {
                const url = message.url || sender.tab?.url || "";
                return mappingPackFor(url, { fresh: true });
            }
            case "GET_HOT_PATH": {
                const url = message.url || sender.tab?.url || "";
                const [pack, profile] = await Promise.all([mappingPackFor(url, { fresh: true }), hotProfile(message.jobId)]);
                return { ...(pack || {}), profile };
            }
            case "VALIDATE_FORM":
                return request(`/api/extension/jobs/${message.jobId}/validate`, {
                    method: "POST", body: JSON.stringify(message.payload)
                });
            case "GET_RESUME":
                return documentForJob(message.jobId, "resume");
            case "GET_COVER_LETTER":
                return documentForJob(message.jobId, "cover");
            case "GET_COVER_LETTER_TEXT": {
                const state = await request(`/api/extension/jobs/${message.jobId}/sidecar-state`);
                return { text: String(state.documents?.coverLetterText || "") };
            }
            case "DOCUMENT_DRAG_START":
            case "DOCUMENT_DRAG_END":
            case "ATTACH_DOCUMENT": {
                if (sender.tab) throw new Error("Document drag is available only from the trusted side panel.");
                const stored = await chrome.storage.local.get("activeTabId");
                if (!stored.activeTabId) throw new Error("Reopen the application tab to drop documents onto the form.");
                const response = await deliverToApplicationFrame(stored.activeTabId, {
                    type: message.type,
                    kind: message.kind,
                    jobId: message.jobId
                });
                if (message.type === "ATTACH_DOCUMENT" && !response?.ok) {
                    throw new Error(response?.error || "The application page did not accept the document.");
                }
                return response?.result || { delivered: Boolean(response?.ok) };
            }
            case "OPEN_DOCUMENT_TAB": {
                if (sender.tab) throw new Error("Documents can only be opened from the trusted side panel.");
                return openGroupedDocumentTab(message.jobId, message.kind);
            }
            case "RETURN_FROM_DOCUMENT_TAB": {
                if (sender.tab) throw new Error("This control is available only from the COPILOT side panel.");
                const currentTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
                if (!currentTab?.id) throw new Error("The document tab could not be identified.");
                return returnFromDocumentTab(currentTab.id);
            }
            case "DOWNLOAD_DOCUMENT": {
                if (sender.tab) throw new Error("Documents can only be downloaded from the trusted side panel.");
                const base = await apiBase();
                const encodedJob = encodeURIComponent(message.jobId || "");
                const url = message.kind === "cover"
                    ? `${base}/jobs/${encodedJob}/cover-letter.pdf`
                    : `${base}/jobs/${encodedJob}/resume.pdf`;
                const downloadId = await chrome.downloads.download({ url, saveAs: false });
                return { started: true, downloadId };
            }
            case "SELECT_RESUME_VARIANT": {
                if (sender.tab) throw new Error("Resume selection is available only from the trusted side panel.");
                const selected = await request(`/api/extension/jobs/${message.jobId}/resume-selection`, {
                    method: "POST", body: JSON.stringify({
                        templateId: message.templateId,
                        variantId: message.variantId,
                        fresh: message.fresh === true
                    })
                });
                prewarmedDocuments.delete(`${message.jobId}:resume`);
                void documentForJob(message.jobId, "resume").catch(() => null);
                const stored = await chrome.storage.local.get("activeTabId");
                if (!stored.activeTabId) {
                    await chrome.storage.local.set({
                        pendingResumeReplacement: {
                            jobId: message.jobId,
                            variantId: selected.variantId || message.variantId || null,
                            at: Date.now()
                        }
                    });
                    throw new Error("The selected resume is prepared and will be attached when the application tab is available.");
                }
                let response;
                try {
                    response = await deliverToApplicationFrame(stored.activeTabId, { type: "REPLACE_RESUME_DOCUMENT" });
                } catch (error) {
                    response = { ok: false, error: error.message };
                }
                if (!response?.ok) {
                    await chrome.storage.local.set({
                        pendingResumeReplacement: {
                            jobId: message.jobId,
                            variantId: selected.variantId || message.variantId || null,
                            at: Date.now()
                        }
                    });
                    throw new Error(response?.error || "The selected resume is prepared and will be attached when its upload field is available.");
                }
                await chrome.storage.local.remove("pendingResumeReplacement");
                return { ...selected, replaced: true };
            }
            case "CLEAR_PENDING_RESUME_REPLACEMENT": {
                const stored = await chrome.storage.local.get(["activeJob", "pendingResumeReplacement"]);
                if (stored.activeJob?.id === message.jobId && stored.pendingResumeReplacement?.jobId === message.jobId) {
                    await chrome.storage.local.remove("pendingResumeReplacement");
                }
                return { cleared: true };
            }
            case "MARK_SUBMITTING":
                await chrome.storage.local.set({ pendingSubmission: { jobId: message.jobId, at: Date.now() } });
                return { recorded: true };
            case "START_NAVIGATION":
                await chrome.storage.local.set({ navigation: { jobId: message.jobId, at: Date.now(), hops: 0 } });
                return { started: true };
            case "NAVIGATION_HOP": {
                const current = (await chrome.storage.local.get("navigation")).navigation;
                const navigation = { ...(current || {}), hops: Number(current?.hops || 0) + 1, at: current?.at || Date.now() };
                await chrome.storage.local.set({ navigation });
                return navigation;
            }
            case "NAVIGATE_TAB": {
                if (!sender.tab?.id) throw new Error("The extension could not identify the current browser tab.");
                const target = safeApplicationDestination(message.url);
                const stored = await chrome.storage.local.get("activeJob");
                if (!stored.activeJob || stored.activeJob.id !== message.jobId) throw new Error("This application session is no longer active.");
                watchedTabs.add(sender.tab.id);
                await chrome.storage.local.set({ activeTabId: sender.tab.id });
                await chrome.tabs.update(sender.tab.id, { url: target, active: true });
                return { opened: true };
            }
            case "STOP_NAVIGATION":
                await chrome.storage.local.remove("navigation");
                return { stopped: true };
            case "CONFIRM_SUBMITTED": {
                const result = await request(`/api/extension/jobs/${message.jobId}/submitted`, {
                    method: "POST", body: JSON.stringify({
                        pageUrl: message.pageUrl,
                        employerConfirmation: message.employerConfirmation === true,
                        candidateVerified: message.candidateVerified === true
                    })
                });
                await rememberLearningSummary(message.jobId, result);
                await chrome.storage.local.remove("pendingSubmission");
                await finishApplicationSession(sender.tab?.id);
                void updateAttentionBadge();
                return result;
            }
            case "OPEN_SIDECAR": {
                const tab = sender.tab || (message.tabId ? await chrome.tabs.get(message.tabId) : null) || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
                if (!tab?.id) throw new Error("No active browser tab was found.");
                return { opened: true };
            }
            case "FULL_ACCESS_GRANTED": {
                if (sender.tab) throw new Error("Full access can only be activated from the trusted side panel.");
                const tab = message.tabId ? await chrome.tabs.get(message.tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
                return activateSiteAccess(tab?.id, String(message.originPattern || ""));
            }
            case "GET_SIDECAR_STATE": {
                if (sender.tab) throw new Error("Sidecar state is available only to trusted extension pages.");
                const currentTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
                let stored = await chrome.storage.local.get(["activeJob", "activeApplication", "activeTabId", "activeApplicationUrl", "activeRunAuthorization", "isPaused", "isStopped", "pendingResumeReplacement", "activeAssist", "documentPreviewContexts", "preferredSidePanelView", "lastLearningSummary"]);
                if (stored.lastLearningSummary?.expiresAt <= Date.now()) {
                    await chrome.storage.local.remove("lastLearningSummary");
                    stored.lastLearningSummary = null;
                }
                // Chrome can retain the grouped employer tab after extension storage or
                // the service worker was reset. Recover from the current URL before
                // showing the misleading "No prepared application" empty state.
                if (!stored.activeJob?.id && currentTab?.id && /^https?:/i.test(String(currentTab.url || ""))) {
                    const recovered = await jobContext(currentTab.url, currentTab.id).catch(() => null);
                    if (recovered?.id) {
                        await injectIntoActiveApplication(currentTab.id, currentTab.url).catch(() => false);
                        stored = await chrome.storage.local.get(["activeJob", "activeApplication", "activeTabId", "activeApplicationUrl", "activeRunAuthorization", "isPaused", "isStopped", "pendingResumeReplacement", "activeAssist", "documentPreviewContexts", "preferredSidePanelView", "lastLearningSummary"]);
                    }
                }
                const permissionTargetUrl = stored.activeApplicationUrl || currentTab?.url || "";
                const siteAccess = permissionTargetUrl ? await hasSiteAccess(permissionTargetUrl) : false;
                const allJobSitesEnabled = await chrome.permissions.contains({ origins: ALL_JOB_SITE_ORIGINS });
                const tabMatchesApplication = Boolean(currentTab?.id && stored.activeTabId && currentTab.id === stored.activeTabId);
                const documentPreview = currentTab?.id ? stored.documentPreviewContexts?.[String(currentTab.id)] || null : null;
                const global = await request("/api/extension/attention").catch(() => ({ items: [], blockingCount: 0 }));
                if (!stored.activeJob?.id) {
                    const profile = await request("/api/profile").catch(() => ({}));
                    return { ...stored, currentTab: currentTab ? { id: currentTab.id, url: currentTab.url, title: currentTab.title } : null, siteAccess, allJobSitesEnabled, tabMatchesApplication, globalAttentionCount: global.blockingCount, attentionItems: [], profileDetails: profile, activeAssist: stored.activeAssist || null, quickCopy: {
                        name: profile.name || "", email: profile.email || "", phone: profile.phone || "",
                        linkedin: profile.linkedinUrl || "", currentCompany: profile.currentCompany || "",
                        currentLocation: profile.currentLocation || "", currentCTC: profile.currentCTC ?? "",
                        expectedCTC: profile.expectedCTC ?? "", noticePeriod: profile.noticePeriodDays == null ? "" : `${profile.noticePeriodDays} days`
                    } };
                }
                const [sidecar, documentTargets] = await Promise.all([
                    request(`/api/extension/jobs/${stored.activeJob.id}/sidecar-state?pageUrl=${encodeURIComponent(currentTab?.url || "")}`),
                    liveDocumentTargets(stored.activeTabId)
                ]);
                return { ...stored, currentTab: currentTab ? { id: currentTab.id, url: currentTab.url, title: currentTab.title } : null, siteAccess, allJobSitesEnabled, tabMatchesApplication, documentPreviewMode: documentPreview, documentTargets, activeAssist: stored.activeAssist || null, ...sidecar };
            }
            case "UNDO_LEARNING_CHANGE_SET": {
                if (sender.tab) throw new Error("Learned-answer undo is available only in the trusted side panel.");
                const stored = await chrome.storage.local.get("lastLearningSummary");
                const summary = stored.lastLearningSummary;
                if (!summary?.changeSetId || summary.changeSetId !== message.changeSetId || summary.jobId !== message.jobId) {
                    throw new Error("That learned-answer summary is no longer current.");
                }
                const result = await request(`/api/extension/jobs/${encodeURIComponent(summary.jobId)}/learning-change-sets/${encodeURIComponent(summary.changeSetId)}/undo`, {
                    method: "POST",
                    headers: { "Idempotency-Key": `sidepanel-undo:${crypto.randomUUID()}` },
                    body: JSON.stringify({}),
                    skipRunAuth: true
                });
                await chrome.storage.local.remove("lastLearningSummary");
                return result;
            }
            case "DISMISS_LEARNING_SUMMARY":
                if (sender.tab) throw new Error("Learning summaries can only be dismissed from the trusted side panel.");
                await chrome.storage.local.remove("lastLearningSummary");
                return { dismissed: true };
            case "CONSUME_PREFERRED_SIDEPANEL_VIEW": {
                await chrome.storage.local.remove("preferredSidePanelView");
                return { consumed: true };
            }
            case "OPEN_DASHBOARD_SURFACE": {
                if (sender.tab) throw new Error("Dashboard surfaces can only be opened from the trusted side panel.");
                return openDashboardSurface(message.path || "/");
            }
            case "ACTIVATE_APPLICATION_TAB": {
                if (sender.tab) throw new Error("This control is available only from the COPILOT side panel.");
                const stored = await chrome.storage.local.get("activeTabId");
                if (!stored.activeTabId) throw new Error("No linked application tab was found.");
                const tab = await chrome.tabs.get(stored.activeTabId);
                await chrome.windows.update(tab.windowId, { focused: true });
                await chrome.tabs.update(tab.id, { active: true });
                return { activated: true };
            }
            case "SIDECAR_TAB_ACTION": {
                if (sender.tab) throw new Error("Sidecar controls are available only to trusted extension pages.");
                const allowed = new Set(["FILL_SAFE_FIELDS", "UNDO_AUTOFILL", "STOP_COPILOT", "PAUSE_FROM_SIDECAR", "RESUME_FROM_SIDECAR", "FOCUS_FIELD", "ANSWER_CURRENT_QUESTION"]);
                if (!allowed.has(message.action)) throw new Error("Unsupported sidecar action.");
                const stored = await chrome.storage.local.get("activeTabId");
                const tabId = stored.activeTabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
                if (!tabId) throw new Error("Reopen the application tab to continue.");
                const response = await chrome.tabs.sendMessage(tabId, { type: message.action, payload: message.payload || {} });
                if (!response?.ok) throw new Error(response?.error || "The application page did not accept the action.");
                if (message.action === "STOP_COPILOT") await chrome.storage.local.set({ isStopped: true });
                if (message.action === "RESUME_FROM_SIDECAR") await chrome.storage.local.set({ isStopped: false });
                return response.result || { completed: true };
            }
            case "GET_EXTENSION_STATE": {
                return sessionStore.extensionState();
            }
            case "PAUSE_COPILOT": {
                await chrome.storage.local.set({ isPaused: true });
                return { paused: true };
            }
            case "RESUME_COPILOT": {
                await chrome.storage.local.set({ isPaused: false });
                return { paused: false };
            }
            case "UNLINK_SESSION": {
                const stored = await chrome.storage.local.get("activeJob");
                if (stored.activeJob?.id) {
                    await request("/api/extension/session/unlink", {
                        method: "POST",
                        body: JSON.stringify({ jobId: stored.activeJob.id })
                    }).catch(() => null);
                }
                await chrome.storage.local.remove(["activeJob", "activeApplication", "activeTabId", "activeRunAuthorization", "pendingSubmission", "pendingResumeReplacement", "navigation", "isPaused", "isStopped"]);
                watchedTabs.clear();
                return { unlinked: true };
            }
            case "SET_TEACH_MODE": {
                const current = await chrome.storage.local.get(["teachModeGlobal", "teachModeSites"]);
                if (message.scope === "global") await chrome.storage.local.set({ teachModeGlobal: Boolean(message.enabled) });
                else {
                    const sites = { ...(current.teachModeSites || {}), [message.host]: Boolean(message.enabled) };
                    await chrome.storage.local.set({ teachModeSites: sites });
                }
                return { saved: true };
            }
            case "SET_API_BASE":
                await backgroundApi.setBase(message.apiBase);
                return { saved: true };
            case "SET_AI_ENHANCEMENT": {
                if (sender.tab) throw new Error("AI answers can only be changed from the trusted side panel.");
                const profile = await request("/api/profile", {
                    method: "PUT",
                    body: JSON.stringify({ aiProcessingConsent: message.enabled === true })
                });
                return { enabled: Boolean(profile.aiProcessingConsent) };
            }
            case "SIDEPANEL_ASK_AI": {
                if (sender.tab) throw new Error("Ask AI is available only from the trusted side panel.");
                const stored = await chrome.storage.local.get("activeJob");
                const currentTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
                return request("/api/extension/assistant/ask", {
                    method: "POST",
                    body: JSON.stringify({
                        question: String(message.question || ""),
                        jobId: String(message.jobId || stored.activeJob?.id || ""),
                        pageUrl: String(currentTab?.url || "")
                    })
                });
            }
            case "CLEAR_JOB":
                await chrome.storage.local.remove(["activeJob", "activeApplication", "activeTabId", "activeRunAuthorization", "pendingSubmission", "navigation", "isPaused"]);
                watchedTabs.clear();
                return { cleared: true };
            default:
                throw new Error(`Unknown extension message: ${message.type}`);
        }
}

// Track new tabs opened from COPILOT-watched tabs
// This fires at the browser level (before the page loads) — catches noopener/JS redirects
chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
    try {
        // ONLY follow if a COPILOT-active tab spawned this new tab
        if (!watchedTabs.has(details.sourceTabId)) return;

        const stored = await chrome.storage.local.get(["activeTabId", "activeJob"]);
        if (!stored.activeJob || stored.activeTabId !== details.sourceTabId) return;
        // A common window.open() pattern creates about:blank first and assigns
        // the real ATS URL a moment later. Remember it and fold it back when
        // that first web navigation arrives.
        if (!/^https?:/i.test(String(details.url || ""))) {
            pendingChildTabs.set(details.tabId, details.sourceTabId);
            return;
        }
        await foldCreatedNavigationTarget(details.sourceTabId, details.tabId, details.url);
    } catch {}
});

// Full navigations and SPA history changes are separate Chrome events. Keep
// COPILOT attached to the one dashboard-prepared application tab in both cases.
chrome.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;
    const pendingSourceRedirect = pendingSourceRedirects.get(details.tabId);
    if (pendingSourceRedirect) {
        if (details.url === pendingSourceRedirect.targetUrl) {
            pendingSourceRedirects.delete(details.tabId);
            clearTimeout(pendingSourceRedirect.timer);
            if (pendingSourceRedirect.childTabId) {
                closingTabs.add(pendingSourceRedirect.childTabId);
                void chrome.tabs.remove(pendingSourceRedirect.childTabId).catch(() => closingTabs.delete(pendingSourceRedirect.childTabId));
            }
            void chrome.storage.local.set({ activeApplicationUrl: details.url });
            return;
        }
        if (isNaukriRedirectReceipt(details.url)) {
            void settleDeferredChildFold(details.tabId, "receipt").catch(() => null);
            return;
        }
    }
    const pendingSourceTabId = pendingChildTabs.get(details.tabId);
    if (pendingSourceTabId && /^https?:/i.test(String(details.url || ""))) {
        pendingChildTabs.delete(details.tabId);
        void chrome.storage.local.get(["activeTabId", "activeJob"]).then(async (stored) => {
            if (!stored.activeJob || stored.activeTabId !== pendingSourceTabId) return;
            await foldCreatedNavigationTarget(pendingSourceTabId, details.tabId, details.url);
        }).catch(() => null);
        return;
    }
    if (isOrdinaryDashboardUrl(details.url)) {
        void syncSidePanelForTab(details.tabId, details.url);
        void chrome.storage.local.get(["activeTabId", "activeApplicationUrl"]).then(async (stored) => {
            if (stored.activeTabId !== details.tabId) return;
            await moveSessionToAttention("RETURNED_TO_DASHBOARD", stored.activeApplicationUrl || "");
            await finishApplicationSession(details.tabId);
            void updateAttentionBadge();
        });
        return;
    }
    void syncSidePanelForTab(details.tabId, details.url);
    void chrome.storage.local.get(["activeTabId", "activeApplicationUrl"]).then(async (stored) => {
        if (stored.activeTabId !== details.tabId) return;
        await chrome.storage.local.set({ activeApplicationUrl: details.url });
    });
    void injectIntoActiveApplication(details.tabId, details.url);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return;
    void syncSidePanelForTab(details.tabId, details.url);
    void injectIntoActiveApplication(details.tabId, details.url, { routeChanged: true });
});

chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => {
    if (details.frameId !== 0) return;
    void syncSidePanelForTab(details.tabId, details.url);
    void injectIntoActiveApplication(details.tabId, details.url, { routeChanged: true });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    void syncSidePanelForTab(activeInfo.tabId);
});

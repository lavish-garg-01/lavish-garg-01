import {
  ExtensionResponseSchema,
  createRequest,
  type ExtensionResponse,
  type RuntimeStatus
} from "../shared/contracts.js";
import { loadExtensionConfig } from "../background/config.js";
import { fieldLabel, progressHeading } from "../content/autofill-progress.js";

for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-panel]")) tab.addEventListener("click", () => {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-panel]")) button.setAttribute("aria-pressed", String(button === tab));
  for (const name of ["autofill", "profile", "documents"]) {
    const panel = document.getElementById(`${name}-panel`);
    if (panel) panel.hidden = name !== tab.dataset.panel;
  }
  if (tab.dataset.panel === "profile" || tab.dataset.panel === "documents") void loadCandidatePanel(tab.dataset.panel);
});

async function loadCandidatePanel(panel: "profile" | "documents"): Promise<void> {
  const root = document.getElementById(`${panel}-content`);
  if (!root) return;
  root.textContent = "Loading your saved information…";
  try {
    const response = ExtensionResponseSchema.parse(await chrome.runtime.sendMessage(createRequest("UI_CANDIDATE_PANEL_REQUEST", "SIDEPANEL", { panel })));
    if (response.type === "ERROR_RESPONSE") throw new Error(response.payload.failure.message);
    if (response.type !== "CANDIDATE_PANEL_RESPONSE") throw new Error("Reconnect to load this panel.");
    if (status && status.authState !== "READY") { root.textContent = "Reconnect to view your saved information."; return; }
    root.innerHTML = response.payload.items.length ? `<ul class="private-panel-items">${response.payload.items.map((item) => `<li><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.value)}</span><small>${escapeHtml(item.state.toLowerCase().replaceAll("_", " "))}</small></li>`).join("")}</ul>` : "Nothing saved yet. Complete your profile on Job Hunter.";
  } catch (reason) { root.textContent = reason instanceof Error ? reason.message : "Could not load. Try again."; }
}
for (const name of ["profile", "documents"]) document.getElementById(`open-${name}`)?.addEventListener("click", () => {
  void loadExtensionConfig().then((config) => chrome.tabs.create({ url: `${config.webOrigins[0]}/#${name}` }));
});

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error("SIDEPANEL_MARKUP_INVALID");
  return element;
}

const statusElement = requiredElement<HTMLElement>("#status");
const allowSiteButton = requiredElement<HTMLButtonElement>("#allow-site");
const scanButton = requiredElement<HTMLButtonElement>("#scan-page");
const fillButton = requiredElement<HTMLButtonElement>("#fill-page");
const retryButton = requiredElement<HTMLButtonElement>("#retry");

let status: RuntimeStatus | null = null;
let executionPending = false;
let lastStatusMarkup = "";
const declarationReviewsPresented = new Set<string>();

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

async function send(type: "UI_STATUS_REQUEST" | "UI_SCAN_ACTIVE_TAB" | "UI_SITE_ACCESS_GRANTED" | "UI_EXECUTE_ACTIVE_TAB" | "UI_UNDO_LEARNING" | "UI_DECLARATION_REVIEW_PRESENTED", payload: Record<string, unknown> = {}): Promise<ExtensionResponse> {
  const request = type === "UI_SITE_ACCESS_GRANTED"
    ? createRequest(type, "SIDEPANEL", { originPattern: String(payload.originPattern ?? "") })
    : type === "UI_UNDO_LEARNING"
      ? createRequest(type, "SIDEPANEL", { changeSetId: String(payload.changeSetId ?? "") })
      : type === "UI_DECLARATION_REVIEW_PRESENTED"
        ? createRequest(type, "SIDEPANEL", { decisionFingerprints: Array.isArray(payload.decisionFingerprints) ? payload.decisionFingerprints.map(String) : [] })
    : createRequest(type, "SIDEPANEL", {});
  return ExtensionResponseSchema.parse(await chrome.runtime.sendMessage(request));
}

function authLabel(value: RuntimeStatus["authState"]): string {
  if (value === "READY") return "Connected";
  if (value === "BACKEND_UNAVAILABLE") return "Backend unavailable";
  if (value === "SESSION_EXPIRED") return "Session expired";
  if (value === "AUTHENTICATED_NO_CANDIDATE") return "Finish account setup";
  if (value === "EXTENSION_UPDATE_REQUIRED") return "Update required";
  return "Connect from Job Hunter";
}

function heading(next: RuntimeStatus): string {
  if (next.lastFailure) return "Copilot needs attention";
  if (next.journey && !next.journey.evidence.canFill) return ({ AUTH_REQUIRED: "Sign in to continue", APPLICATION_ENTRY: "Continue on the employer’s page", APPLICATION_REVIEW: "Review before submitting", APPLICATION_SUCCESS: "Confirmation detected", JOB_DETAIL: "Job recognized", UNCERTAIN: "Inspect this application", JOB_LIST: "Browse jobs", UNRELATED: "No application detected", APPLICATION_FORM: "Application detected" })[next.journey.evidence.stage];
  if (next.autofill?.phase === "FILLING") return "Filling your application…";
  if (next.autofill?.phase === "PAUSED") return "Autofill paused";
  if (next.autofill?.phase === "REVIEW") return "Ready for your review";
  if (executionPending) return "Filling safe fields…";
  if (next.siteAccess === "REQUIRED") return "Allow Copilot on this site";
  if (!next.runtimeState) return next.activeOrigin ? "Waiting for this page" : "No application detected";
  if (next.runtimeState === "APPLICATION_DETECTED") return "Application detected";
  if (next.runtimeState === "SCANNING") return next.lastScan?.fieldCount ? "Scanning fields" : "Application detected";
  return next.runtimeState.replaceAll("_", " ").toLowerCase();
}

function detail(next: RuntimeStatus): string {
  if (executionPending) return "Keep this application tab open while Copilot fills and verifies each field.";
  if (next.lastFailure) return escapeHtml(next.lastFailure.failure.message);
  if (next.siteAccess === "REQUIRED") return "Chrome needs permission before Copilot can scan this employer application.";
  if (!next.runtimeState && !next.activeOrigin) {
    return "Click the Job Hunter toolbar icon while this employer tab is focused, then allow Copilot on the site.";
  }
  if (!next.lastScan || next.lastScan.fieldCount === 0) {
    if (next.runtimeState === "APPLICATION_DETECTED" || next.runtimeState === "SCANNING" || next.runtimeState === "PAGE_DETECTED") {
      return "Application detected. Scanning fields…";
    }
    return "Open an employer application to start a safe structural scan.";
  }
  return `${next.lastScan.fieldCount} structural fields across ${next.lastScan.formCount} forms`;
}

function declarationLabel(type: RuntimeStatus["declarations"][number]["declarationType"]): string {
  if (type === "ACCURACY_CERTIFICATION") return "Accuracy certification";
  if (type === "PRIVACY_ACKNOWLEDGEMENT") return "Privacy acknowledgement";
  if (type === "TERMS_ACKNOWLEDGEMENT") return "Terms acknowledgement";
  if (type === "BACKGROUND_CHECK_CONSENT") return "Background check consent";
  if (type === "DATA_PROCESSING_CONSENT") return "Data processing consent";
  if (type === "APPLICANT_CERTIFICATION") return "Applicant certification";
  if (type === "EEO_ACKNOWLEDGEMENT") return "Equal opportunity acknowledgement";
  if (type === "APPLICATION_SPECIFIC_ACKNOWLEDGEMENT") return "Application acknowledgement";
  return "Unrecognized declaration";
}

function declarationList(items: RuntimeStatus["declarations"]): string {
  if (!items.length) return `<p class="declaration-empty">None on this page</p>`;
  return `<ul>${items.map((item) => `<li><span>${declarationLabel(item.declarationType)}</span>${item.required ? `<small>Required</small>` : `<small>Optional</small>`}</li>`).join("")}</ul>`;
}

function declarationPanel(next: RuntimeStatus): string {
  if (!next.declarations.length) return "";
  if (next.autofill) return `<section class="declarations"><h2>Your choices, kept manual</h2><p class="declaration-note">Review these acknowledgements on the form. Copilot never accepts them or submits for you.</p>${declarationList(next.declarations)}</section>`;
  const prepared = next.declarations.filter((item) => item.status === "PREPARED_BY_COPILOT");
  const needsAction = next.declarations.filter((item) => ["NEEDS_CANDIDATE_ACTION", "BLOCKED", "UNRESOLVED", "CANDIDATE_MODIFIED"].includes(item.status));
  const awaitingReview = next.declarations.filter((item) => item.status === "REVIEW_BEFORE_SUBMIT");
  const preparedForReview = prepared.filter((item) => item.reviewRequired);
  return `<section class="declarations" aria-labelledby="declarations-heading">
    <h2 id="declarations-heading">Declarations &amp; acknowledgements</h2>
    <p class="declaration-note">These choices apply only to this application. Copilot never remembers them as profile answers.</p>
    <div class="declaration-group prepared"><h3>Prepared by Copilot</h3>${declarationList(prepared)}</div>
    <div class="declaration-group action"><h3>Needs your action</h3>${declarationList(needsAction)}</div>
    <div class="declaration-group review"><h3>Review before submitting</h3>${declarationList(awaitingReview)}${preparedForReview.length ? `<p class="review-reminder">Review ${preparedForReview.length === 1 ? "the prepared selection" : "all prepared selections"} on the application before you submit.</p>` : ""}</div>
  </section>`;
}

function render(next: RuntimeStatus): void {
  status = next;
  const ready = next.authState === "READY";
  if (!ready) for (const panel of ["profile", "documents"]) {
    const root = document.getElementById(`${panel}-content`);
    if (root) root.textContent = "Reconnect to view your saved information.";
  }
  const warn = !ready || next.siteAccess === "REQUIRED" || Boolean(next.lastFailure);
  const skipLabels: Record<string, string> = { QUESTION_CONTRACT_INVALID:"Question group changed or is too large — review manually", UNSUPPORTED_CONTROL:"This control needs manual input", ALREADY_COMPLETED: "Already populated — review it", DEPENDENCY_BLOCKED: "Waiting for another field", NOT_APPLICABLE: "Not applicable to your notice period", USER_OWNED: "Your edit was preserved", HIDDEN_OR_DISABLED: "Not available on this step", ANSWER_NOT_AVAILABLE: "Add an answer to your profile", SEMANTIC_NOT_HIGH_CONFIDENCE: "Question needs interpretation", ANSWER_CONTEXT_REQUIRED: "More context needed", ANSWER_CONFLICT: "Conflicting answers — review", ANSWER_REVIEW_EXPIRED: "Please confirm this answer again" };
  const progress = next.autofill;
  Object.assign(skipLabels, {
    DOM_READBACK_ONLY: "Populated on page — review; employer acceptance not confirmed",
    DEFERRED_RESCAN: "Waiting for the next scan — not attempted yet",
    POPUP_ASSOCIATION_UNPROVEN: "Cannot safely identify this dropdown's options",
    CONTROL_VALIDATION_FAILED: "The form reports a validation error",
    STRATEGY_UNSUPPORTED: "This control needs manual completion",
    DATE_REQUIRES_CONFIRMED_ANCHOR: "Confirm a joining date; notice days alone are insufficient",
    DATE_PRECISION_INSUFFICIENT: "A more precise date is needed",
    NON_TERMINATING_CONVERSION: "Confirm the required rounding before filling",
    MONEY_PERIOD_AMBIGUOUS: "Confirm monthly or annual compensation",
    CURRENCY_CONVERSION_NOT_AUTHORIZED: "Requested currency differs from your saved amount"
  });
  const completed = progress?.fields.filter((item) => ["COMPLETED", "ATS_AUTOFILLED"].includes(item.state)).length ?? 0;
  const progressHtml = progress ? `<section class="autofill-progress"><div class="progress-summary"><strong>${completed}<small>completed</small></strong><strong>${progress.fields.filter((item) => ["ATTENTION", "USER_OWNED"].includes(item.state)).length}<small>to review</small></strong><strong>${progress.fields.filter((item) => ["PENDING", "FILLING"].includes(item.state)).length}<small>remaining</small></strong></div><progress max="${Math.max(1, progress.fields.length)}" value="${completed}" aria-label="Application completion"></progress><p class="muted">Select a field to find it on the form. Your edits are never overwritten.</p><ul class="field-checklist">${progress.fields.map((item, index) => `<li><button data-focus-field="${escapeHtml(item.fieldRuntimeId)}"><span class="field-state ${item.state.toLowerCase()}">${["COMPLETED", "ATS_AUTOFILLED"].includes(item.state) ? "✓" : item.state === "FILLING" ? "↻" : "○"}</span><span><b>${escapeHtml(fieldLabel(item.canonicalKey, index))}${item.required ? " *" : ""}</b><small>${escapeHtml(item.reason ? skipLabels[item.reason] ?? item.reason.toLowerCase().replaceAll("_", " ") : item.state.toLowerCase().replaceAll("_", " "))}</small></span></button></li>`).join("")}</ul><button id="toggle-autofill" class="secondary">${progress.phase === "PAUSED" || progress.phase === "FAILED" ? "Resume / retry" : "Pause autofill"}</button></section>` : "";
  const markup = `
    <span class="badge${warn ? " warn" : ""}">${authLabel(next.authState)}</span>
    <h1>${ready && progress && !next.lastFailure ? escapeHtml(progressHeading(progress)) : heading(next)}</h1>
    ${progress?.scanIncomplete ? '<p class="muted">Some controls or frames could not be scanned. Counts cover scanned questions only; inspect the remaining form.</p>' : ''}
    ${progress ? '<p class="muted">Populated fields are checked on the page, not confirmed by the employer. Review all answers before submitting.</p>' : ''}
    ${next.journey && !next.journey.evidence.canFill ? '<p class="muted">Copilot is observing this journey, not filling or submitting. Sign-in, social-profile sharing and final submission remain yours.</p>' : ""}
    <p class="muted">${detail(next)}</p>
    ${next.lastIntelligence ? `<p class="muted">Understood ${next.lastIntelligence.resolvedHigh + next.lastIntelligence.resolvedMedium} fields · ${next.lastIntelligence.answerAvailable} answers ready · ${next.lastIntelligence.ambiguous + next.lastIntelligence.unresolved} need attention</p>` : ""}
    ${next.lastExecution ? `<p class="muted">Last fill: ${next.lastExecution.verified} verified · ${next.lastExecution.failed} need attention · ${next.lastExecution.skipped} safely skipped</p>` : ""}
    ${next.planSkips?.length ? `<details class="plan-reasons"><summary>Why ${next.planSkips.length} fields were not filled</summary><ul>${next.planSkips.slice(0, 40).map((skip) => `<li><b>${escapeHtml((skip.canonicalKey ?? "Unrecognized question").toLowerCase().replaceAll("_", " "))}</b><small>${escapeHtml(skipLabels[skip.reason] ?? skip.reason.toLowerCase().replaceAll("_", " "))}</small></li>`).join("")}</ul></details>` : ""}
    ${next.lastFailure ? `<p class="failure-code">Reference: ${next.lastFailure.failure.code}${typeof next.lastFailure.failure.metadata.diagnosticCode === "string" ? ` · ${escapeHtml(next.lastFailure.failure.metadata.diagnosticCode)}` : ""}</p>` : ""}
    ${progressHtml}
    ${declarationPanel(next)}
    ${next.lastLearning ? `<div class="learning-summary"><strong>${learningLabel(next.lastLearning.message)}</strong><p class="muted">${next.lastLearning.saved} saved · ${next.lastLearning.askAgain} will be checked next time · ${next.lastLearning.skipped + next.lastLearning.conflicts} not changed</p>${next.lastLearning.changeSetId && !next.lastLearning.message.startsWith("UPDATES_") ? `<button id="undo-learning" class="secondary" data-change-set="${next.lastLearning.changeSetId}">Undo updates</button>` : ""}</div>` : ""}
  `;
  if (markup !== lastStatusMarkup) {
    const focusedField = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusField : undefined;
    statusElement.innerHTML = markup; lastStatusMarkup = markup;
    if (focusedField) [...statusElement.querySelectorAll<HTMLButtonElement>("[data-focus-field]")].find((button) => button.dataset.focusField === focusedField)?.focus();
  }
  allowSiteButton.hidden = next.siteAccess !== "REQUIRED" || !next.activeOrigin;
  scanButton.hidden = true;
  fillButton.hidden = true;
  retryButton.hidden = ready && !next.lastFailure;
  scanButton.disabled = executionPending;
  fillButton.disabled = executionPending;
  const newlyPresented = next.declarations.map((item) => item.decisionFingerprint)
    .filter((fingerprint) => !declarationReviewsPresented.has(fingerprint));
  if (newlyPresented.length) {
    newlyPresented.forEach((fingerprint) => declarationReviewsPresented.add(fingerprint));
    void send("UI_DECLARATION_REVIEW_PRESENTED", { decisionFingerprints: newlyPresented }).then((response) => {
      if (!response.ok) newlyPresented.forEach((fingerprint) => declarationReviewsPresented.delete(fingerprint));
    }).catch(() => newlyPresented.forEach((fingerprint) => declarationReviewsPresented.delete(fingerprint)));
  }
}

function learningLabel(message: NonNullable<RuntimeStatus["lastLearning"]>["message"]): string {
  if (message === "UPDATED_FOR_NEXT_TIME" || message === "SOME_UPDATES_SAVED") return "Updated for next time";
  if (message === "ASK_AGAIN_NEXT_TIME") return "We’ll check this next time";
  if (message === "UPDATES_UNDONE") return "Updates undone";
  if (message === "UPDATES_PARTIALLY_UNDONE") return "Some updates undone";
  if (message === "NOTHING_TO_UNDO") return "Nothing needed changing";
  if (message === "COULD_NOT_SAVE_UPDATE") return "Couldn’t save this update";
  return "No reusable answers changed";
}

function renderError(message: string): void {
  lastStatusMarkup = "";
  statusElement.innerHTML = `<span class="badge warn">Needs attention</span><h1>Copilot could not connect</h1><p class="muted">${escapeHtml(message)}</p>`;
  allowSiteButton.hidden = true;
  scanButton.hidden = true;
  fillButton.hidden = true;
}

async function refresh(): Promise<void> {
  try {
    const response = await send("UI_STATUS_REQUEST");
    if (!response.ok) throw new Error(response.payload.failure.code);
    if (response.type !== "STATUS_RESPONSE") throw new Error("STATUS_RESPONSE_REQUIRED");
    render(response.payload.status);
  } catch {
    renderError("Reload the active tab or reconnect from the Job Hunter website.");
  }
}

allowSiteButton.addEventListener("click", () => {
  void (async () => {
    if (!status?.activeOrigin) return;
    const originPattern = `${new URL(status.activeOrigin).origin}/*`;
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (!granted) { renderError("Chrome did not grant access to this employer site."); return; }
    const response = await send("UI_SITE_ACCESS_GRANTED", { originPattern });
    if (!response.ok) { renderError(response.payload.failure.message); return; }
    await refresh();
  })().catch(() => renderError("Site access could not be configured."));
});

scanButton.addEventListener("click", () => {
  void send("UI_SCAN_ACTIVE_TAB").then(refresh).catch(() => renderError("The active application could not be scanned."));
});
fillButton.addEventListener("click", () => {
  executionPending = true;
  if (status) render(status);
  void send("UI_EXECUTE_ACTIVE_TAB").then(async (response) => {
    executionPending = false;
    if (!response.ok) {
      await refresh().catch(() => renderError(response.payload.failure.message));
      return;
    }
    await refresh();
  }).catch(() => {
    executionPending = false;
    renderError("Copilot could not safely fill this application.");
  }).finally(() => {
    fillButton.disabled = executionPending;
  });
});
retryButton.addEventListener("click", () => {
  if (status?.authState === "READY") void send("UI_SCAN_ACTIVE_TAB").then(refresh).catch((reason) => renderError(String(reason)));
  else void loadExtensionConfig().then((config) => chrome.tabs.create({ url: config.webOrigins[0] }));
});
statusElement.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("#undo-learning") : null;
  const changeSetId = target?.dataset.changeSet;
  if (!target || !changeSetId) return;
  target.disabled = true;
  void send("UI_UNDO_LEARNING", { changeSetId }).then(async (response) => {
    if (!response.ok) throw new Error(response.payload.failure.message);
    await refresh();
  }).catch(() => renderError("The learned updates could not be undone safely."));
});

statusElement.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) || !status?.identity) return;
  const field = event.target.closest<HTMLButtonElement>("[data-focus-field]")?.dataset.focusField;
  const toggle = event.target.closest("#toggle-autofill");
  if (!field && !toggle) return;
  const pageInstanceId = status.identity.pageInstanceId;
  const request = field ? createRequest("UI_FOCUS_FIELD", "SIDEPANEL", { fieldRuntimeId: field, pageInstanceId })
    : createRequest("UI_AUTOFILL_CONTROL", "SIDEPANEL", { action: status.autofill?.phase === "PAUSED" || status.autofill?.phase === "FAILED" ? "RESUME" : "PAUSE", pageInstanceId });
  void chrome.runtime.sendMessage(request).then((raw: unknown) => { const response = ExtensionResponseSchema.parse(raw); if (!response.ok) throw new Error(response.payload.failure.message); return refresh(); }).catch(() => renderError("This field changed. Refresh the application and retry."));
});

let deliveryRefreshing = false;
async function refreshDelivery() {
  if (deliveryRefreshing) return;
  const root = document.getElementById("delivery-status");
  if (!root) return;
  deliveryRefreshing = true;
  try {
    const response = ExtensionResponseSchema.parse(await chrome.runtime.sendMessage(createRequest("UI_DELIVERY_STATUS", "SIDEPANEL", {})));
    if (response.type !== "DELIVERY_STATUS") throw new Error("unavailable");
    const value = response.payload;
    root.textContent = value.connected ? `${value.queuedNotes} notes queued · ${value.queuedDiagnostics} diagnostics queued · ${value.delivered} acknowledged · ${value.rejected} rejected · ${value.dropped} expired or dropped. Counts cover retained queue history, not autofill accuracy.` : "Reconnect to view this account’s delivery status.";
  } catch { root.textContent = "Delivery status unavailable — do not assume notes were saved."; }
  finally { deliveryRefreshing = false; }
}
document.getElementById("discard-delivery")?.addEventListener("click", async () => {
  if (!window.confirm("Discard queued notes and diagnostics? This removes unsent local copies. It cannot undo a request already sent or delete a note already saved on Job Hunter.")) return;
  const response = ExtensionResponseSchema.safeParse(await chrome.runtime.sendMessage(createRequest("UI_DELIVERY_DISCARD", "SIDEPANEL", {})).catch(() => null));
  if (!response.success || response.data.type !== "DELIVERY_STATUS") { const root = document.getElementById("delivery-status"); if (root) root.textContent = "Discard could not be confirmed. Reconnect and check again."; return; }
  await refreshDelivery();
});
void refresh();
void refreshDelivery();

// Learning is finalized by the content/background runtime after a verified
// submission. Keep the visible summary current without requiring the user to
// close and reopen the side panel. This reads extension-local runtime state;
// it does not poll the backend.
const refreshTimer = window.setInterval(() => {
  if (document.visibilityState === "visible") void refresh();
  if (document.visibilityState === "visible") void refreshDelivery();
}, 1_000);

window.addEventListener("pagehide", () => window.clearInterval(refreshTimer), { once: true });

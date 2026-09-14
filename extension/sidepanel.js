const jobNode = document.getElementById("job");
const stateNode = document.getElementById("state");
const stateHelpNode = document.getElementById("state-help");
const contentNode = document.getElementById("content");
const primaryBtn = document.getElementById("primary");
const attentionCenterBtn = document.getElementById("attention-center");
const settingsBtn = document.getElementById("settings-button");
const aiToggleBtn = document.getElementById("ai-toggle");
const autofillStateNode = document.getElementById("autofill-state");
let panelPort = null;
let currentData = null;
let activeView = "autofill";
let configuredApiBase = "http://127.0.0.1:3001";
let refreshRunning = false;
let consecutiveRefreshFailures = 0;
let renderedDocumentsFingerprint = "";
let assistantMessages = [];
let assistantPending = false;
let assistantContextKey = "";

function connectPanelPort() {
    try {
        panelPort = chrome.runtime.connect({ name: "job-hunter-sidepanel" });
        panelPort.onDisconnect.addListener(() => { panelPort = null; });
    } catch { panelPort = null; }
}
connectPanelPort();

function escapeHtml(value) {
    const node = document.createElement("span");
    node.textContent = String(value ?? "");
    return node.innerHTML;
}

function send(payload) {
    return new Promise((resolve, reject) => chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        return response?.ok ? resolve(response.result) : reject(new Error(response?.error || "Extension request failed."));
    }));
}

function stateLabel(value) {
    return String(value || "IDLE").replaceAll("_", " ").toLowerCase().replace(/^./, (character) => character.toUpperCase());
}

function listPreview(items = [], fallback) {
    const labels = items.map((item) => item.label).filter(Boolean).slice(0, 4);
    return labels.length ? labels.join(", ") : fallback;
}

function uniqueProgressItems(items = []) {
    const seen = new Set();
    return items.map((item) => {
        const label = String(item.label || item.title || "").trim();
        if (/^drop or select\b/i.test(label) && String(item.type || "").toLowerCase() === "file") return { ...item, label: "Resume or document" };
        return { ...item, label };
    }).filter((item) => {
        if (/^(?:select|textbox|search|input|application field)(?:\s+\d+)?$/i.test(item.label)) return false;
        if (/^(?:field|input|select)[-_]?\d+$/i.test(item.label)) return false;
        if (/\.pdf\b|\buploaded successfully\b|\bremove File\b/i.test(item.label)) return false;
        const key = String(item.label || item.fieldId || "").trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function fieldProgressMarkup(data) {
    const summary = data.plan?.summary || {};
    const evidence = data.applicationSession?.fields || [];
    const completedEvidence = evidence.filter((field) => ["FILLED", "USER_EDITED"].includes(String(field.state).toUpperCase())
        && field.valid !== false && String(field.fillOutcome || "").toUpperCase() !== "INVALID");
    const blockedEvidence = evidence.filter((field) => ["BLOCKED", "INVALID"].includes(String(field.state).toUpperCase())
        || field.valid === false || String(field.fillOutcome || "").toUpperCase() === "INVALID");
    const completed = uniqueProgressItems([...completedEvidence, ...(summary.completed || [])]);
    const completedIds = new Set(completed.map((item) => String(item.fieldId || "")).filter(Boolean));
    const review = uniqueProgressItems([...(data.attentionItems || []), ...blockedEvidence, ...(summary.review || []), ...(summary.conflicts || [])])
        .filter((item) => !completedIds.has(String(item.fieldId || "")));
    const row = (item, done) => `<li class="progress-field"><span class="progress-mark ${done ? "done" : "review"}">${done ? "✓" : "!"}</span><button data-focus="${escapeHtml(item.fieldId || "")}" ${item.fieldId ? "" : "disabled"}>${escapeHtml(item.label || item.title || "Application field")}</button></li>`;
    return `<section class="field-progress" aria-label="Autofill field progress">
        <div class="progress-title">Autofill complete! <strong>${review.length} field${review.length === 1 ? "" : "s"} need review</strong></div>
        <div class="progress-group"><h3>Need to review (${review.length})</h3>${review.length ? `<ul>${review.map((item) => row(item, false)).join("")}</ul>` : `<p>Nothing needs your attention on this page.</p>`}</div>
        <div class="progress-group"><h3>Completed (${completed.length})</h3>${completed.length ? `<ul>${completed.map((item) => row(item, true)).join("")}</ul>` : `<p>No fields have been completed yet.</p>`}</div>
    </section>`;
}

function operationProgressMarkup(data) {
    const operations = data.operations?.latest || [];
    if (!operations.length) return "";
    const rank = { STARTED: 0, PLANNED: 1, DETECTED: 2, REVIEW: 3, FAILED: 4, SKIPPED: 5, FILLED: 6, CONFIRMED: 7 };
    const visible = [...operations].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)).slice(0, 24);
    const row = (item) => {
        const status = String(item.status || "DETECTED").toUpperCase();
        const done = ["FILLED", "CONFIRMED"].includes(status);
        const working = ["STARTED", "PLANNED", "DETECTED"].includes(status);
        const label = String(item.targetSignature || "").split("|")[0]
            || String(item.semanticKey || item.phase || "Application field").replaceAll("_", " ");
        return `<li class="operation-row ${done ? "done" : working ? "working" : "review"}"><span>${done ? "✓" : working ? "•" : "!"}</span><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(stateLabel(status))} · ${escapeHtml(stateLabel(item.phase))}</small></div></li>`;
    };
    const active = visible.filter((item) => ["STARTED", "PLANNED", "DETECTED"].includes(String(item.status).toUpperCase())).length;
    return `<section class="operation-progress" aria-label="Live autofill operations"><div class="operation-head"><strong>${active ? "Autofilling this page…" : "Autofill activity"}</strong><span>${operations.length} operation${operations.length === 1 ? "" : "s"}</span></div><ul>${visible.map(row).join("")}</ul></section>`;
}

function preflightMarkup(data) {
    const summary = data.plan?.summary || {};
    const ready = summary.ready || [];
    const completed = summary.completed || [];
    const review = summary.review || [];
    const conflicts = summary.conflicts || [];
    const attention = data.attentionItems || [];
    const sessionCounts = data.applicationSession?.counts || {};
    const filledCount = Math.max(Number(sessionCounts.filled || 0), Number(summary.counts?.alreadyComplete || 0));
    const readyCount = Number(summary.counts?.ready || 0);
    const helpCount = Number(summary.counts?.needsYou || 0) + Number(summary.counts?.manual || 0);
    const aiCount = Number(summary.counts?.aiDrafts || 0);
    const uploadItems = attention.filter((item) => item.type === "UPLOAD_REQUIRED");
    const uploadsAttached = Number(sessionCounts.documentsAttached || 0);
    const uploadsDetected = Number(sessionCounts.documents || 0);
    return `<section class="plan" aria-label="Application preflight">
        <div class="plan-head"><strong>Application preflight</strong><p>See what COPILOT handled and what still needs you. Every value remains editable.</p></div>
        <div class="preflight-row ${filledCount ? "done" : ""}"><div class="preflight-icon">✓</div><div><strong>Autofilled details</strong><span>${escapeHtml(listPreview([...completed, ...ready], readyCount ? "Verified fields are ready to fill" : "No verified fields found yet"))}</span></div><b class="badge ${filledCount ? "good" : ""}">${filledCount ? `${filledCount} filled` : `${readyCount} ready`}</b></div>
        <div class="preflight-row ${uploadsAttached ? "done" : uploadItems.length ? "help" : ""}"><div class="preflight-icon">D</div><div><strong>Resume and documents</strong><span>${escapeHtml(uploadsAttached ? "Attachment verified on the employer form" : uploadItems.length ? listPreview(uploadItems, "A required document needs attention") : uploadsDetected ? "Document field detected" : "No document field on this page")}</span></div><b class="badge ${uploadsAttached ? "good" : uploadItems.length ? "warn" : ""}">${uploadsAttached ? `${uploadsAttached} attached` : uploadItems.length ? "Needs help" : "Checked"}</b></div>
        <div class="preflight-row ${helpCount || conflicts.length ? "help" : "done"}"><div class="preflight-icon">!</div><div><strong>Needs your help</strong><span>${escapeHtml(listPreview([...review, ...conflicts], helpCount ? "Open the items below to finish this page" : "No required answers are waiting"))}</span></div><b class="badge ${helpCount || conflicts.length ? "warn" : "good"}">${helpCount || conflicts.length || 0}</b></div>
        <div class="preflight-row ${aiCount ? "help" : "done"}"><div class="preflight-icon">AI</div><div><strong>AI-written answers</strong><span>${aiCount ? "Drafts are inserted only for your review" : "No AI drafts need review"}</span></div><b class="badge ${aiCount ? "warn" : "good"}">${aiCount}</b></div>
    </section>`;
}

function sessionMarkup(data) {
    const session = data.applicationSession;
    if (!session) return "";
    let host = "Employer application";
    try { host = new URL(session.currentUrl).hostname; } catch {}
    const pageCount = Number(session.pageCount || 1);
    return `<section class="session" aria-label="Application session"><div class="session-head"><strong>Application session</strong><span class="badge good">Active</span></div><p>${escapeHtml(session.lastMessage || "COPILOT is following this application across pages and redirects.")}</p><div class="session-meta"><span>${escapeHtml(host)}</span><span>${pageCount} page${pageCount === 1 ? "" : "s"} seen</span><span>Review-only submit</span></div></section>`;
}

function documentsMarkup(data) {
    if (!data.job) return `<p class="empty">Open a prepared application to preview tailored documents.</p>`;
    const jobId = encodeURIComponent(data.job.id);
    const documents = data.documents || {};
    const selectedVariant = documents.selectedResumeVariantId || "";
    const replacementPending = data.pendingResumeReplacement?.jobId === data.job.id;
    const revision = encodeURIComponent(documents.resumeRevision || "current");
    const resumeUrl = `${configuredApiBase}/jobs/${jobId}/resume.html?template=${encodeURIComponent(documents.selectedResumeTemplate || "ats")}&embed=1&v=${revision}`;
    const coverUrl = `${configuredApiBase}/jobs/${jobId}/cover-letter.html?embed=1`;
    const variants = (documents.resumeVariants || []).map((variant) => `<button class="resume-variant ${variant.id === selectedVariant ? "selected" : ""}" data-resume-variant="${escapeHtml(variant.id)}"><strong>${escapeHtml(variant.name)}</strong><span>${escapeHtml(variant.description || "Reusable tailoring profile")}</span><b>${variant.id === selectedVariant ? replacementPending ? "Attach pending" : "In form" : "Use"}</b></button>`).join("");
    const preview = (kind, title, available, url) => {
        const attachable = Boolean(data.documentTargets?.[kind]?.available && data.tabMatchesApplication);
        return `<section class="document-preview"><div class="document-preview-head"><div><strong>${title}</strong><span>${available ? "Prepared for this application" : "Not prepared yet"}</span></div>${available ? `<div class="document-preview-actions">${attachable ? `<button data-attach-document="${kind}">Attach to form</button>` : ""}<button data-open-quick-look="${kind}">Quick Look</button><button data-download-document="${kind}">Download</button><button data-document="${kind}">Open</button></div>` : ""}</div>${available ? `<button class="preview-surface" draggable="true" data-drag-document="${kind}" data-quick-look="${kind}" aria-label="Drag ${title} to the employer form or click for Quick Look"><iframe src="${escapeHtml(url)}" title="${title} preview" tabindex="-1"></iframe><span>Drag me · click to enlarge</span></button><button class="document-drag-handle" draggable="true" data-drag-document="${kind}">↗ Drag this document onto the ${kind === "cover" ? "cover letter" : "resume"} field</button>` : `<p>Generate this document from the dashboard before applying.</p>`}</section>`;
    };
    return `<section class="document-card"><h3>Application documents</h3><p class="secondary-note">The master resume is canonical. Drag a document onto the employer upload field, or attach it from here. Active resumes are compact tailoring recipes; employer PDFs are rendered and cached only when selected.</p><p id="document-status" class="document-status ${replacementPending ? "warning" : ""}" role="status">${replacementPending ? "The selected resume is ready and will attach when a resume field is visible." : ""}</p><div class="document-actions"><button class="primary" data-fresh-resume>Create a fresh tailored resume</button></div>${preview("resume", "Resume", documents.resumeAvailable, resumeUrl)}${variants ? `<details class="resume-library" open><summary>Your active resumes (${documents.resumeVariants.length})</summary><div class="resume-variants">${variants}</div></details>` : ""}${preview("cover", "Cover letter", documents.coverLetterAvailable, coverUrl)}<div id="quick-look"></div></section>`;
}

function setDocumentStatus(message, kind = "") {
    const node = document.getElementById("document-status");
    if (!node) return;
    node.textContent = message;
    node.className = `document-status ${kind}`.trim();
}

function bindDocumentDrag() {
    contentNode.querySelectorAll("[data-drag-document]").forEach((node) => {
        node.addEventListener("dragstart", (event) => {
            const kind = node.dataset.dragDocument;
            const payload = JSON.stringify({ kind, jobId: currentData?.job?.id || "" });
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("text/plain", payload);
            try { event.dataTransfer.setData("application/x-job-hunter-doc", payload); } catch { /* custom types can be blocked */ }
            send({ type: "DOCUMENT_DRAG_START", kind, jobId: currentData?.job?.id }).catch(() => null);
            setDocumentStatus("Drop on the highlighted field in the application tab, or click it.");
        });
        node.addEventListener("dragend", () => {
            send({ type: "DOCUMENT_DRAG_END" }).catch(() => null);
        });
    });
}

function profileRow(label, value) {
    if (value === "" || value == null || (Array.isArray(value) && !value.length)) return "";
    const display = Array.isArray(value) ? value.join(", ") : String(value);
    return `<div class="profile-row"><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(display)}</strong></div><button data-copy="${escapeHtml(display)}">Copy</button></div>`;
}

function profileMarkup(data) {
    const profile = data.profileDetails || data.quickCopy || {};
    const experience = (profile.experience || []).map((item) => `${item.title}${item.company ? ` · ${item.company}` : ""}${item.startDate || item.endDate ? ` (${item.startDate || ""}–${item.endDate || ""})` : ""}`);
    const education = (profile.education || []).map((item) => `${item.degree || item.field || "Education"}${item.institution ? ` · ${item.institution}` : ""}`);
    return `<section class="profile-card"><h3>Your profile</h3><p class="secondary-note">Click Copy beside any value, or edit the complete profile in Job Hunter.</p>${profileRow("Name", profile.name)}${profileRow("Email", profile.email)}${profileRow("Phone", profile.phone)}${profileRow("Location", profile.currentLocation)}${profileRow("Country", profile.country)}${profileRow("Current company", profile.currentCompany)}${profileRow("LinkedIn", profile.linkedinUrl || profile.linkedin)}${profileRow("GitHub", profile.githubUrl || profile.github)}${profileRow("Portfolio", profile.portfolioUrl || profile.portfolio)}${profileRow("Current CTC", profile.currentCTC)}${profileRow("Expected CTC", profile.expectedCTC)}${profileRow("Notice period", profile.noticePeriodDays == null ? "" : `${profile.noticePeriodDays} days`)}${profileRow("Total experience", profile.totalExperienceYears == null ? "" : `${profile.totalExperienceYears} years`)}${profileRow("Skills", profile.skills)}${profileRow("Preferred search skills", profile.preferredSkills)}${profileRow("Preferred locations", profile.preferredLocations)}${profileRow("Work modes", profile.preferredWorkModes)}${profileRow("Experience", experience)}${profileRow("Education", education)}<div class="document-actions" style="margin-top:12px"><button class="primary" data-edit-profile>Edit profile in dashboard</button></div></section>`;
}

function assistantMarkup(data) {
    const hasJob = Boolean(data.job?.id);
    const suggestions = hasJob
        ? ["Why am I a fit for this role?", "Draft a concise answer about my relevant experience.", "Why did autofill leave fields unresolved?"]
        : ["Summarize my strongest skills.", "What roles best fit my profile?", "What is my notice period?"];
    const messages = assistantMessages.map((message) => {
        if (message.role === "user") return `<div class="assistant-message user">${escapeHtml(message.text)}</div>`;
        const evidence = (message.result?.evidence || []).filter(Boolean).slice(0, 4);
        return `<div class="assistant-message assistant">${escapeHtml(message.text)}${evidence.length ? `<small>Grounding: ${escapeHtml(evidence.join(" · "))}</small>` : ""}${message.result?.copyReady ? `<button class="assistant-copy" data-copy="${escapeHtml(message.text)}">Copy answer</button>` : ""}</div>`;
    }).join("");
    return `<section class="assistant-card" aria-label="Ask Job Hunter AI">
        <div class="assistant-intro"><h3>Ask Job Hunter AI</h3><p>${hasJob
            ? `Grounded in your verified profile, resume, this ${escapeHtml(data.job.title || "job")}, and the latest form results.`
            : "Grounded in your verified profile and resume. Open a prepared application to add job and form context."}</p></div>
        <div class="assistant-suggestions">${suggestions.map((prompt) => `<button data-assistant-suggestion="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`).join("")}</div>
        <div class="assistant-thread" aria-live="polite">${messages || `<p class="empty">Ask for a copy-ready answer, an explanation of a field, a fit summary, or why autofill stopped.</p>`}${assistantPending ? `<div class="assistant-typing">Checking verified context…</div>` : ""}</div>
        <div class="assistant-composer"><textarea id="assistant-question" maxlength="2000" placeholder="Ask about this application or your profile…" aria-label="Ask Job Hunter AI" ${assistantPending ? "disabled" : ""}></textarea><div class="assistant-composer-actions"><small>Ctrl/⌘ + Enter to send</small><button class="primary" data-assistant-send ${assistantPending ? "disabled" : ""}>Ask AI</button></div></div>
        <p class="assistant-safety">Ask AI never changes the employer form. It does not decide legal attestations, consent, demographic answers, passwords, OTPs, or CAPTCHA.</p>
    </section>`;
}

function renderView(data) {
    document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === activeView));
    settingsBtn.classList.toggle("active", activeView === "settings");
    autofillStateNode.classList.toggle("hidden", activeView !== "autofill");
    primaryBtn.classList.toggle("hidden", activeView !== "autofill" || !data.application || data.application.status === "SUCCESS" || data.isStopped);
    if (activeView === "documents") {
        const fingerprint = JSON.stringify({ jobId: data.job?.id || "", documents: data.documents || {}, documentTargets: data.documentTargets || {}, tabMatchesApplication: data.tabMatchesApplication });
        if (fingerprint !== renderedDocumentsFingerprint || !contentNode.querySelector(".document-card")) {
            contentNode.innerHTML = documentsMarkup(data);
            renderedDocumentsFingerprint = fingerprint;
            bindDocumentDrag();
        }
    }
    else if (activeView === "profile") contentNode.innerHTML = profileMarkup(data);
    else if (activeView === "ask-ai") {
        const fingerprint = JSON.stringify({
            context: data.job?.id || "profile",
            consent: Boolean(data.profileDetails?.aiProcessingConsent),
            pending: assistantPending,
            messages: assistantMessages
        });
        if (contentNode.dataset.assistantFingerprint !== fingerprint || !contentNode.querySelector(".assistant-card")) {
            contentNode.innerHTML = assistantMarkup(data);
            contentNode.dataset.assistantFingerprint = fingerprint;
            contentNode.querySelector(".assistant-thread")?.lastElementChild?.scrollIntoView({ block: "nearest" });
        }
    }
    else if (activeView === "settings") contentNode.innerHTML = settingsMarkup(data);
}

async function askAssistant(question) {
    const text = String(question || "").trim();
    if (!text || assistantPending) return;
    assistantMessages.push({ role: "user", text });
    assistantPending = true;
    if (currentData) renderView(currentData);
    try {
        const answer = await send({ type: "SIDEPANEL_ASK_AI", question: text, jobId: currentData?.job?.id || "" });
        assistantMessages.push({ role: "assistant", text: String(answer.answer || "No grounded answer was available."), result: answer });
    } catch (error) {
        assistantMessages.push({ role: "assistant", text: error.message, result: { source: "ERROR", evidence: [] } });
    } finally {
        assistantPending = false;
        if (currentData) renderView(currentData);
        document.getElementById("assistant-question")?.focus();
    }
}

async function tabAction(action, payload = {}) {
    stateNode.textContent = "Working…";
    try {
        await send({ type: "SIDECAR_TAB_ACTION", action, payload });
        await refresh();
    } catch (error) {
        stateNode.textContent = error.message;
        stateNode.className = "state error";
    }
}

function supportBadge(support) {
    if (!support?.mode) return "";
    return `<span class="support-tag support-${escapeHtml(String(support.mode).toLowerCase())}" title="${escapeHtml(support.reason || "")}">${escapeHtml(support.label || support.mode)}</span>`;
}

function activeAssistForCurrentPage(data) {
    const assist = data.activeAssist;
    const currentPlatformId = data.currentPlatform?.id;
    const assistPlatformId = assist?.applySupport?.platformId;
    if (!assist?.cards?.length) return null;
    if (currentPlatformId && assistPlatformId && currentPlatformId !== assistPlatformId) return null;
    return assist;
}

function platformHeader(data, { includeMatch = false } = {}) {
    if (!data.job) return "";
    const platform = data.currentPlatform || data.job.platform;
    const support = activeAssistForCurrentPage(data)?.applySupport || data.currentApplySupport || data.applySupport || data.job.applySupport;
    return `<div class="job"><div class="company">${escapeHtml(data.job.company)}</div><div class="role">${escapeHtml(data.job.title)}</div>${platform ? `<span class="platform-tag">${escapeHtml(platform.label)}</span>` : ""}${supportBadge(support)}${includeMatch ? `<div class="match">${escapeHtml(data.job.matchScore ?? "—")}% match</div>` : ""}</div>`;
}

function assistMarkup(assist) {
    if (!assist?.cards?.length) return "";
    const current = assist.cards.filter((card) => card.kind === "current");
    const ready = assist.cards.filter((card) => card.kind !== "current");
    const row = (card) => {
        const title = escapeHtml(card.question || card.label || "Answer");
        if (card.missing) {
            return `<div class="assist-row missing"><div><strong>${title}</strong><span>No saved profile fact — type this yourself.</span></div></div>`;
        }
        return `<div class="assist-row"><div><strong>${title}</strong><span>${escapeHtml(card.display || card.copy)} · ${escapeHtml((card.source || "profile").toLowerCase())}</span></div><button data-copy="${escapeHtml(card.copy)}" data-assist-key="${escapeHtml(card.semanticKey || "UNKNOWN")}">Copy</button></div>`;
    };
    return `<section class="assist" aria-label="Assist answers">
        <p>${escapeHtml(assist.applySupport?.reason || "Copy an answer and paste it on the page. COPILOT will not type into this surface.")}</p>
        ${current.length ? `<h3>Current question</h3><div class="assist-list">${current.map(row).join("")}</div>` : ""}
        ${ready.length ? `<h3>Also ready to paste</h3><div class="assist-list">${ready.map(row).join("")}</div>` : ""}
    </section>`;
}

function renderQuickCopy(values = {}) {
    const rows = Object.entries(values).filter(([, value]) => value !== "" && value != null);
    contentNode.innerHTML = `<p class="empty">Open a prepared application from the Job Hunter dashboard. COPILOT will appear here automatically.</p><h3>Profile quick copy</h3><div class="quick">${rows.map(([key, value]) => `<div class="quick-row"><span><strong>${escapeHtml(key.replace(/([A-Z])/g, " $1"))}</strong><br>${escapeHtml(value)}</span><button data-copy="${escapeHtml(value)}">Copy</button></div>`).join("")}</div>`;
}

function learningSummaryMarkup(summary) {
    if (!summary) return "";
    const learned = Number(summary.learned || 0);
    const review = Number(summary.needsReview || 0);
    return `<section class="learning-summary" aria-live="polite"><div class="learning-summary-head"><div><strong>Updated for next time</strong><p>${learned ? `${learned} answer${learned === 1 ? "" : "s"} saved from your completed application.` : "No answer was saved automatically."}${review ? ` ${review} change${review === 1 ? "" : "s"} need your review.` : ""}</p></div><button data-dismiss-learning aria-label="Dismiss learned-answer summary">×</button></div><div class="answer-controls">${summary.canUndo ? `<button data-undo-learning data-job-id="${escapeHtml(summary.jobId)}" data-change-set-id="${escapeHtml(summary.changeSetId)}">Undo</button>` : ""}${review ? `<button class="primary" data-review-learning>Review changes</button>` : ""}</div></section>`;
}

function renderPermission(data) {
    const currentUrl = String(data.currentTab?.url || "");
    const activeUrl = String(data.activeApplicationUrl || "");
    const currentExternal = /^https?:/i.test(currentUrl) && !/^https?:\/\/(?:localhost|127\.0\.0\.1):(?:3000|3001)\//i.test(currentUrl);
    const permissionUrl = currentExternal ? currentUrl : activeUrl;
    const externalPage = /^https?:/i.test(permissionUrl) && !/^https?:\/\/(?:localhost|127\.0\.0\.1):(?:3000|3001)\//i.test(permissionUrl);
    const needsAccess = externalPage && !data.siteAccess;
    // Show while an application session is active even if Chrome briefly reports
    // the dashboard/extension page as the current tab.
    if (!needsAccess) return false;
    if (!externalPage && !data.activeJob) return false;
    stateNode.textContent = "Permission needed for this employer site";
    const parsed = new URL(permissionUrl);
    const originPattern = `${parsed.origin}/*`;
    contentNode.innerHTML = `<section class="permission"><strong>Allow Copilot on this employer site</strong><p>Chrome requires your approval before Job Hunter can inspect and fill this application. Access is limited to the employer origin below.</p><div class="host">${escapeHtml(parsed.hostname)}</div><div class="permission-actions"><button class="primary" data-grant-origin="${escapeHtml(originPattern)}">Allow this employer site</button></div><p class="permission-note">Copilot activates only for the application you opened from Job Hunter and never submits for you.</p></section>`;
    primaryBtn.classList.add("hidden");
    return true;
}

function questionMarkup(question) {
    if (!question) return "";
    const prompt = escapeHtml(question.prompt || "COPILOT needs one answer.").replace(/\n/g, "<br>");
    if (question.questionType === "MANUAL_ACTION") {
        return `<section class="question-card manual"><strong>Complete on employer form</strong><p>${prompt}</p><button data-focus="${escapeHtml(question.fieldId)}">Show field</button></section>`;
    }
    const options = Array.isArray(question.options) ? question.options : [];
    let controls = "";
    if (question.questionType === "CONFIRM_MAPPING") {
        controls = `<button class="primary" data-question-answer="Yes">Yes</button>${options.slice(0, 5).map((option) => `<button data-question-mapping="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`).join("")}<button data-question-skip>Skip</button>`;
    } else if (question.questionType === "CHOOSE_OPTION") {
        controls = `${options.slice(0, 20).map((option) => `<button data-question-answer="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`).join("")}<button data-question-skip>Skip</button>`;
    } else {
        controls = `<input id="question-value" aria-label="Answer" placeholder="Type your answer"><button class="primary" data-question-send>Use this answer</button><button data-question-skip>Skip</button>`;
    }
    return `<section class="question-card"><strong>Needs your answer</strong><p>${prompt}</p><button class="link" data-focus="${escapeHtml(question.fieldId)}">Show field</button><div class="answer-controls">${controls}</div><small>${escapeHtml(String(question.answerScope || "APPLICATION_ONLY").replaceAll("_", " ").toLowerCase())}</small></section>`;
}

function applicationLearningMarkup(data) {
    if (!data.application) return "";
    const preference = data.reuseConsent || {};
    if (!preference.globalConsent) {
        return `<section class="consent"><strong>Application learning is off</strong><p>Enable quiet reusable-answer learning in Profile when you want completed applications to improve future autofill.</p><div class="answer-controls"><button data-open-profile>Open Profile</button></div></section>`;
    }
    if (preference.learningDisabledForApplication) {
        return `<section class="consent"><strong>Learning is off for this application</strong><p>COPILOT can still fill verified information. Nothing from this application will update future memory.</p><div class="answer-controls"><button data-application-learning="enable">Allow learning for this application</button></div></section>`;
    }
    return `<section class="consent"><strong>Application learning</strong><p>After verified completion, eligible low-risk answers may be summarized for future use. Consequential changes require review.</p><div class="answer-controls"><button data-application-learning="disable">Do not learn from this application</button></div></section>`;
}

function reconciliationMarkup(data) {
    const result = data.profileReconciliation;
    if (!result || result.status !== "REVIEW_REQUIRED") return "";
    const labels = [...(result.conflicts || []), ...(result.missingFromProfile || [])].map((item) => item.label).slice(0, 6);
    return `<section class="attention"><strong>Profile and resume need review</strong><p>${escapeHtml(labels.join(", "))} differ or are missing. COPILOT will not choose a value silently.</p><button data-open-profile>Review profile</button></section>`;
}

function policiesMarkup(data) {
    const policies = data.autofillPolicies || [];
    if (!policies.length) return "";
    return `<div class="policies"><p>Verified identity, contact, and professional facts can fill automatically. Other categories pause for review.</p>${policies.map((policy) => `<label><span>${escapeHtml(policy.category.toLowerCase().replaceAll("_", " "))}</span><select data-policy="${escapeHtml(policy.category)}" ${policy.isProtected ? "disabled" : ""}><option value="AUTO_VERIFIED" ${policy.mode === "AUTO_VERIFIED" ? "selected" : ""}>Fill verified</option><option value="ASK_EACH_TIME" ${policy.mode === "ASK_EACH_TIME" ? "selected" : ""}>Ask each time</option><option value="NEVER" ${policy.mode === "NEVER" ? "selected" : ""}>Never fill</option></select></label>`).join("")}</div>`;
}

function settingsMarkup(data) {
    return `<section class="settings-card"><h3>Autofill settings</h3><p>Control what Job Hunter may place on employer forms. Protected and sensitive answers always require the safer policy.</p>${policiesMarkup(data)}</section>`;
}

function render(data) {
    currentData = data;
    const nextAssistantContext = data.job?.id || "profile";
    if (assistantContextKey && assistantContextKey !== nextAssistantContext) assistantMessages = [];
    assistantContextKey = nextAssistantContext;
    const tabs = document.querySelector(".tabs");
    const previewMode = Boolean(data.documentPreviewMode);
    if (tabs) tabs.style.display = previewMode ? "none" : "";
    settingsBtn.classList.toggle("hidden", previewMode);
    attentionCenterBtn.classList.toggle("hidden", previewMode);
    const aiToggleRow = aiToggleBtn.closest(".ai-toggle");
    if (aiToggleRow) aiToggleRow.style.display = previewMode ? "none" : "";
    stateNode.className = "state";
    primaryBtn.dataset.action = "fill";
    aiToggleBtn.classList.toggle("on", Boolean(data.profileDetails?.aiProcessingConsent));
    aiToggleBtn.setAttribute("aria-checked", String(Boolean(data.profileDetails?.aiProcessingConsent)));

    if (previewMode) {
        activeView = "autofill";
        jobNode.innerHTML = platformHeader(data);
        autofillStateNode.classList.remove("hidden");
        stateNode.textContent = "Document preview";
        stateHelpNode.textContent = "Return to the linked employer tab when you finish reviewing or editing this document.";
        contentNode.innerHTML = `<section class="document-return"><strong>Your application is still open</strong><p>Changes saved in this tab will be used for the application. Returning will replace the resume when a compatible upload field is available.</p></section>`;
        primaryBtn.textContent = "Go to application tab";
        primaryBtn.dataset.action = "return-from-document";
        primaryBtn.classList.remove("hidden");
        return;
    }

    if (data.preferredSidePanelView?.view && data.preferredSidePanelView.jobId === data.job?.id) {
        activeView = data.preferredSidePanelView.view;
        void send({ type: "CONSUME_PREFERRED_SIDEPANEL_VIEW" }).catch(() => null);
    }

    if (activeView === "autofill" && renderPermission(data)) return;
    if (data.job && data.activeTabId && !data.tabMatchesApplication) {
        jobNode.innerHTML = platformHeader(data);
        if (activeView === "autofill") {
            stateNode.textContent = "COPILOT is active in another tab";
            contentNode.innerHTML = `<p class="empty">Switch back to the linked employer application before filling.</p>`;
            primaryBtn.textContent = "Go to application tab";
            primaryBtn.dataset.action = "activate-tab";
            primaryBtn.classList.remove("hidden");
            return;
        }
    }
    if (!data.job) {
        jobNode.innerHTML = "";
        if (activeView === "profile") contentNode.innerHTML = profileMarkup(data);
        else if (activeView === "documents") contentNode.innerHTML = documentsMarkup(data);
        else if (activeView === "ask-ai") contentNode.innerHTML = assistantMarkup(data);
        else {
            stateNode.textContent = data.lastLearningSummary ? "Application completed" : "No prepared application on this tab";
            stateHelpNode.textContent = data.lastLearningSummary
                ? "COPILOT saved only eligible answers after verified completion. You can undo them here."
                : "COPILOT never submits the application for you.";
            primaryBtn.classList.add("hidden");
            renderQuickCopy(data.quickCopy);
            if (data.lastLearningSummary) contentNode.insertAdjacentHTML("afterbegin", learningSummaryMarkup(data.lastLearningSummary));
        }
        renderView(data);
        return;
    }

    jobNode.innerHTML = platformHeader(data, { includeMatch: true });
    if (activeView !== "autofill") {
        renderView(data);
        return;
    }
    const activeAssist = activeAssistForCurrentPage(data);
    const assist = activeAssist || (data.currentApplySupport?.mode === "AUTOFILL" ? null : data.assistPreview);
    const support = assist?.applySupport || data.currentApplySupport || data.applySupport || data.job.applySupport;
    const hasAssistCards = Boolean(assist?.cards?.length);
    const assistActive = support?.mode === "ASSIST";
    stateNode.textContent = data.isStopped
        ? "Stopped by you"
        : assistActive
            ? "Assist mode"
            : hasAssistCards && support?.mode === "PARTIAL"
                ? "Partial — answers ready"
                : stateLabel(data.agentSession?.currentState || data.application?.status);
    stateHelpNode.textContent = assistActive || (hasAssistCards && support?.mode === "PARTIAL")
        ? (support?.reason || "Copy an answer below and paste it yourself when autofill cannot run.")
        : data.application?.status === "READY_TO_SUBMIT"
            ? "Everything required is complete. Review the employer form, then submit it yourself."
            : data.application?.status === "WAITING_FOR_USER" || data.application?.status === "USER_ACTION_REQUIRED"
                ? "COPILOT filled what it safely could. Complete the highlighted items below."
                : "COPILOT fills verified fields automatically and never submits for you.";
    const plan = data.plan?.summary;
    const operationMarkup = operationProgressMarkup(data);
    const activeOperations = (data.operations?.latest || []).some((item) => ["STARTED", "PLANNED", "DETECTED"].includes(String(item.status).toUpperCase()));
    if (activeOperations) stateNode.textContent = "Autofilling this page…";
    contentNode.innerHTML = plan
        ? `${operationMarkup}${fieldProgressMarkup(data)}`
        : hasAssistCards
            ? assistMarkup(assist)
            : `${operationMarkup}<p class="empty">${support && support.mode !== "AUTOFILL"
                ? escapeHtml(support.reason)
                : "COPILOT automatically fills verified, non-sensitive details when an application form becomes available. You can edit every filled value before submitting."}</p>`;
    contentNode.insertAdjacentHTML("beforeend", applicationLearningMarkup(data));
    contentNode.insertAdjacentHTML("beforeend", questionMarkup(data.agentSession?.pendingQuestion));
    const canProcess = Boolean(data.application && data.application.status !== "SUCCESS" && !data.isStopped);
    primaryBtn.textContent = plan ? "Run autofill again" : "Scan this page";
    primaryBtn.classList.toggle("hidden", !canProcess);
    renderView(data);
}

async function refresh() {
    if (refreshRunning) return;
    refreshRunning = true;
    try {
        const data = await send({ type: "GET_SIDECAR_STATE" });
        if (!panelPort) connectPanelPort();
        try { panelPort?.postMessage({ type: "PANEL_ACTIVE_TAB", tabId: data.currentTab?.id || null }); } catch { panelPort = null; }
        consecutiveRefreshFailures = 0;
        render(data);
    } catch (error) {
        consecutiveRefreshFailures += 1;
        if (consecutiveRefreshFailures >= 3) {
            stateNode.textContent = "Connection interrupted";
            stateNode.className = "state error";
            stateHelpNode.textContent = "Your application is still open and has not been submitted.";
            if (!currentData) contentNode.innerHTML = `<p class="empty">Reconnect the local service, then retry. Your employer form remains unchanged.</p>`;
        }
    } finally { refreshRunning = false; }
}

primaryBtn.addEventListener("click", async () => {
    if (primaryBtn.dataset.action === "return-from-document") {
        primaryBtn.disabled = true;
        stateNode.textContent = "Returning to the application…";
        try { await send({ type: "RETURN_FROM_DOCUMENT_TAB" }); }
        catch (error) { stateNode.textContent = error.message; stateNode.className = "state error"; primaryBtn.disabled = false; }
        return;
    }
    if (primaryBtn.dataset.action === "activate-tab") {
        await send({ type: "ACTIVATE_APPLICATION_TAB" });
        await refresh();
        return;
    }
    await tabAction("FILL_SAFE_FIELDS");
});
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
    activeView = button.dataset.view;
    if (currentData) render(currentData);
}));

settingsBtn.addEventListener("click", () => {
    activeView = activeView === "settings" ? "autofill" : "settings";
    if (currentData) render(currentData);
});

attentionCenterBtn.addEventListener("click", async () => {
    await send({ type: "OPEN_DASHBOARD_SURFACE", path: "/attention" });
});

aiToggleBtn.addEventListener("click", async () => {
    const enabled = aiToggleBtn.getAttribute("aria-checked") !== "true";
    aiToggleBtn.disabled = true;
    try {
        const result = await send({ type: "SET_AI_ENHANCEMENT", enabled });
        if (currentData?.profileDetails) currentData.profileDetails.aiProcessingConsent = result.enabled;
        aiToggleBtn.classList.toggle("on", result.enabled);
        aiToggleBtn.setAttribute("aria-checked", String(result.enabled));
    } catch (error) {
        stateNode.textContent = error.message;
        stateNode.className = "state error";
    } finally { aiToggleBtn.disabled = false; }
});

contentNode.addEventListener("click", async (event) => {
    const undoLearning = event.target.closest("[data-undo-learning]");
    if (undoLearning) {
        undoLearning.disabled = true;
        try {
            await send({ type: "UNDO_LEARNING_CHANGE_SET", jobId: undoLearning.dataset.jobId,
                changeSetId: undoLearning.dataset.changeSetId });
            await refresh();
        } catch (error) {
            stateNode.textContent = error.message;
            stateNode.className = "state error";
            undoLearning.disabled = false;
        }
        return;
    }
    const reviewLearning = event.target.closest("[data-review-learning]");
    if (reviewLearning) {
        await send({ type: "OPEN_DASHBOARD_SURFACE", path: "/app/profile#learning-review" });
        return;
    }
    const dismissLearning = event.target.closest("[data-dismiss-learning]");
    if (dismissLearning) {
        await send({ type: "DISMISS_LEARNING_SUMMARY" });
        await refresh();
        return;
    }
    const assistantSuggestion = event.target.closest("[data-assistant-suggestion]");
    if (assistantSuggestion) {
        const input = document.getElementById("assistant-question");
        if (input) {
            input.value = assistantSuggestion.dataset.assistantSuggestion;
            input.focus();
        }
        return;
    }
    const assistantSend = event.target.closest("[data-assistant-send]");
    if (assistantSend) {
        await askAssistant(document.getElementById("assistant-question")?.value);
        return;
    }
    const grant = event.target.closest("[data-grant-origin]");
    if (grant) {
        stateNode.textContent = "Waiting for Chrome permission…";
        try {
            const originPattern = String(grant.dataset.grantOrigin || "");
            const granted = await chrome.permissions.request({ origins: [originPattern] });
            if (!granted) {
                stateNode.textContent = "Employer-site access was not granted; autofill is still disabled";
                stateNode.className = "state error";
                return;
            }
            await send({ type: "FULL_ACCESS_GRANTED", tabId: currentData?.activeTabId || currentData?.currentTab?.id, originPattern });
            await refresh();
        } catch (error) {
            stateNode.textContent = error.message;
            stateNode.className = "state error";
        }
        return;
    }
    const copy = event.target.closest("[data-copy]");
    if (copy) {
        await navigator.clipboard.writeText(copy.dataset.copy);
        if (copy.dataset.assistKey && currentData?.job?.id) {
            await send({
                type: "RECORD_ASSIST_COPY",
                jobId: currentData.job.id,
                semanticKey: copy.dataset.assistKey,
                surface: currentData.activeAssist?.applySupport?.surface || currentData.assistPreview?.applySupport?.surface || "assist"
            }).catch(() => null);
        }
        return;
    }
    const attachDocument = event.target.closest("[data-attach-document]");
    if (attachDocument && currentData?.job?.id) {
        const kind = attachDocument.dataset.attachDocument === "cover" ? "cover" : "resume";
        stateNode.textContent = kind === "cover" ? "Adding the cover letter to the form…" : "Attaching the resume to the form…";
        setDocumentStatus(stateNode.textContent);
        attachDocument.disabled = true;
        try {
            await send({ type: "ATTACH_DOCUMENT", kind, jobId: currentData.job.id });
            await refresh();
            setDocumentStatus(kind === "cover" ? "Cover letter added to the form." : "Resume attached to the form.");
        } catch (error) {
            stateNode.textContent = error.message;
            stateNode.className = "state error";
            setDocumentStatus(error.message, "error");
        } finally { attachDocument.disabled = false; }
        return;
    }
    const freshResume = event.target.closest("[data-fresh-resume]");
    if (freshResume && currentData?.job?.id) {
        stateNode.textContent = "Creating and attaching a fresh tailored resume…";
        setDocumentStatus("Creating and attaching a fresh tailored resume…");
        freshResume.disabled = true;
        try {
            await send({ type: "SELECT_RESUME_VARIANT", jobId: currentData.job.id, fresh: true });
            await refresh();
        } catch (error) {
            stateNode.textContent = error.message;
            stateNode.className = "state error";
            setDocumentStatus(error.message, "error");
        } finally { freshResume.disabled = false; }
        return;
    }
    const documentAction = event.target.closest("[data-document]");
    if (documentAction && currentData?.job?.id) {
        await send({ type: "OPEN_DOCUMENT_TAB", kind: documentAction.dataset.document, jobId: currentData.job.id });
        return;
    }
    const downloadDocument = event.target.closest("[data-download-document]");
    if (downloadDocument && currentData?.job?.id) {
        await send({ type: "DOWNLOAD_DOCUMENT", kind: downloadDocument.dataset.downloadDocument, jobId: currentData.job.id });
        setDocumentStatus(`${downloadDocument.dataset.downloadDocument === "cover" ? "Cover letter" : "Resume"} download started.`);
        return;
    }
    const closeQuickLook = event.target.closest("[data-close-quick-look]");
    if (closeQuickLook && (closeQuickLook.dataset.closeQuickLook === "button" || event.target === closeQuickLook)) {
        document.getElementById("quick-look")?.replaceChildren();
        return;
    }
    const quickLook = event.target.closest("[data-quick-look], [data-open-quick-look]");
    if (quickLook) {
        const kind = quickLook.dataset.quickLook || quickLook.dataset.openQuickLook;
        const preview = quickLook.closest(".document-preview");
        const iframe = preview?.querySelector(".preview-surface iframe");
        const host = document.getElementById("quick-look");
        if (iframe?.src && host) host.innerHTML = `<div class="quick-look-backdrop" data-close-quick-look="backdrop"><section class="quick-look-window ${kind === "cover" ? "cover" : "resume"}" role="dialog" aria-modal="true" aria-label="Document Quick Look"><header><strong>${kind === "cover" ? "Cover letter" : "Resume"}</strong><button data-close-quick-look="button" aria-label="Close Quick Look">×</button></header><div class="quick-look-page"><iframe src="${escapeHtml(iframe.src)}" title="Expanded document preview"></iframe></div></section></div>`;
        return;
    }
    const resumeVariant = event.target.closest("[data-resume-variant]");
    if (resumeVariant && currentData?.job?.id) {
        stateNode.textContent = "Preparing and replacing the selected resume…";
        setDocumentStatus("Preparing and replacing the selected resume…");
        resumeVariant.disabled = true;
        try {
            await send({ type: "SELECT_RESUME_VARIANT", jobId: currentData.job.id, variantId: resumeVariant.dataset.resumeVariant });
            await refresh();
        } catch (error) {
            stateNode.textContent = error.message;
            stateNode.className = "state error";
            setDocumentStatus(error.message, "error");
        } finally { resumeVariant.disabled = false; }
        return;
    }
    const editProfile = event.target.closest("[data-edit-profile]");
    if (editProfile) {
        await send({ type: "OPEN_DASHBOARD_SURFACE", path: "/copilot#profile" });
        return;
    }
    const focus = event.target.closest("[data-focus]");
    if (focus) return tabAction("FOCUS_FIELD", { fieldId: focus.dataset.focus });
    const profile = event.target.closest("[data-open-profile]");
    if (profile) {
        await send({ type: "OPEN_DASHBOARD_SURFACE", path: "/copilot#profile" });
        return;
    }
    const applicationLearning = event.target.closest("[data-application-learning]");
    if (applicationLearning) {
        await send({ type: "SET_APPLICATION_LEARNING", jobId: currentData.job.id,
            payload: { disabled: applicationLearning.dataset.applicationLearning === "disable" } });
        await refresh();
        return;
    }
    const conflict = event.target.closest("[data-conflict]");
    if (conflict) {
        await send({ type: "RESOLVE_ATTENTION", jobId: currentData.job.id, fieldId: conflict.dataset.fieldId, decision: conflict.dataset.conflict });
        await refresh();
        return;
    }
    const question = currentData?.agentSession?.pendingQuestion;
    if (!question) return;
    const answerButton = event.target.closest("[data-question-answer]");
    const mappingButton = event.target.closest("[data-question-mapping]");
    const sendButton = event.target.closest("[data-question-send]");
    const skipButton = event.target.closest("[data-question-skip]");
    if (!answerButton && !mappingButton && !sendButton && !skipButton) return;
    const answer = answerButton?.dataset.questionAnswer || (sendButton ? document.getElementById("question-value")?.value : "");
    const extra = skipButton ? { action: "SKIP" }
        : mappingButton ? { action: "CHOOSE", semanticKey: mappingButton.dataset.questionMapping, saveMapping: true }
            : question.questionType === "CONFIRM_MAPPING" ? { action: "CONFIRM", saveMapping: true } : {};
    await tabAction("ANSWER_CURRENT_QUESTION", { question, answer: mappingButton ? "No" : answer, extra });
});

contentNode.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-policy]");
    if (!select) return;
    stateNode.textContent = "Saving autofill policy…";
    try {
        await send({ type: "SET_AUTOFILL_POLICY", payload: { category: select.dataset.policy, mode: select.value } });
        await refresh();
    } catch (error) {
        stateNode.textContent = error.message;
        stateNode.className = "state error";
    }
});

document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && event.target?.id === "assistant-question") {
        event.preventDefault();
        void askAssistant(event.target.value);
        return;
    }
    if (event.key !== "Escape") return;
    const quickLook = document.getElementById("quick-look");
    if (quickLook?.childElementCount) {
        quickLook.replaceChildren();
        event.preventDefault();
    }
});

chrome.storage.local.get("apiBase").then((storage) => {
    configuredApiBase = String(storage.apiBase || configuredApiBase).replace(/\/$/, "");
    return refresh();
});
chrome.tabs.onActivated.addListener(() => { void refresh(); });
setInterval(() => { void refresh(); }, 3000);

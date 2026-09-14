(() => {
    if (globalThis.JobHunterUploads) return;

    let host = {
        fieldHeadingText: () => "",
        genericControlLabel: () => false,
        dispatch: () => {},
        delay: async () => {},
        control: () => null,
        message: async () => null,
        get activeJob() { return null; },
        detectFields: () => [],
        fill: async () => false,
        fieldSnapshot: () => ({}),
        adapterPayload: () => ({}),
        refreshContext: async () => false,
        recordOperation: () => {},
        setStatus: () => {},
        textOf: () => "",
        visible: () => false,
        deepQueryAll: (selector, root = document) => [...(root?.querySelectorAll?.(selector) || [])],
        deepQuery: (selector, root = document) => root?.querySelector?.(selector) || null,
        composedParent: (element) => element?.parentElement || null,
        composedClosest: (element, selector) => element?.closest?.(selector) || null,
        attachAttempts: 3
    };
    let pendingDocumentDrag = null;
    let documentDragClearTimer = 0;
    const documentDropBridgeRoots = new WeakSet();
    const attachmentLedger = new Map();
    const attachmentFlights = new Map();

    function bind(nextHost = {}) {
        const merged = { ...host };
        for (const key of Object.keys(nextHost)) {
            const descriptor = Object.getOwnPropertyDescriptor(nextHost, key);
            if (descriptor) Object.defineProperty(merged, key, descriptor);
        }
        host = merged;
        return api;
    }

function uploadIdentityTokens(element) {
    return [
        element.name,
        element.id,
        element.getAttribute("data-field"),
        element.getAttribute("data-testid"),
        element.getAttribute("data-qa"),
        element.getAttribute("data-automation-id"),
        element.getAttribute("aria-label")
    ].map((value) => String(value || "").trim()).filter(Boolean);
}

function uploadMatchesPack(element, kind) {
    const tokens = uploadIdentityTokens(element).map((value) => value.toLowerCase());
    const testIds = (globalThis.JobHunterAdapterRuntime?.fileTestIds?.(kind) || []).map((value) => String(value).toLowerCase());
    if (testIds.some((id) => tokens.includes(id))) return true;
    const patterns = globalThis.JobHunterAdapterRuntime?.fileLabelPatterns?.(kind) || [];
    const haystack = tokens.join(" ");
    return patterns.some((pattern) => {
        try { return new RegExp(pattern, "i").test(haystack); } catch { return false; }
    });
}

function uploadLabelFor(element) {
    const identity = uploadIdentityTokens(element).join(" ");
    if (uploadMatchesPack(element, "coverLetter")) return "Cover letter";
    if (uploadMatchesPack(element, "resume")) return "Resume";
    if (/input[-_]?cover[-_]?letter|cover\s*[-_]?\s*letter/i.test(identity)) return "Cover letter";
    if (/input[-_]?resume|r[eé]sum[eé]|curriculum|(?:^|\W)cv(?:\W|$)/i.test(identity)) return "Resume";
    for (let current = host.composedParent(element), depth = 0; current && depth < 12; current = host.composedParent(current), depth += 1) {
        const fileCount = host.deepQueryAll("input[type=file]", current).length;
        if (fileCount > 1) continue;
        const nearest = host.fieldHeadingText(current);
        if (/cover\s*[-_]?\s*letter/i.test(nearest) && !/r[eé]sum[eé]|\bcv\b/i.test(nearest)) return "Cover letter";
        if (/r[eé]sum[eé]|curriculum|(?:^|\W)cv(?:\W|$)/i.test(nearest) && !/cover/i.test(nearest)) return "Resume";
        if (nearest && !host.genericControlLabel(nearest) && !/^drop or select/i.test(nearest)) return nearest;
    }
    return "Document upload";
}
function documentUploadIdentity(element) {
    return uploadIdentityTokens(element).join(" ");
}
function isNamedDocumentUpload(element) {
    return /r[eé]sum[eé]|curriculum|(?:^|\W)cv(?:\W|$)|cover.?letter|portfolio|input[-_]?resume|input[-_]?cover/i.test(documentUploadIdentity(element));
}
function isQuestionDisguisedAsUpload(label) {
    const text = String(label || "");
    if (/r[eé]sum[eé]|(?:^|\W)cv(?:\W|$)|cover.?letter/i.test(text)) return false;
    return /how many years|years of experience|notice period|current ctc|expected ctc|willing to relocate|why (?:are you|do you want)|backend engineering/i.test(text);
}
function isLabeledDocumentUpload(element) {
    if (element?.type !== "file") return false;
    const label = uploadLabelFor(element);
    if (isQuestionDisguisedAsUpload(label)) return false;
    return /r[eé]sum[eé]|curriculum|(?:^|\W)cv(?:\W|$)|cover.?letter|drag to upload|drop.{0,40}(?:resume|cv|file)|upload (?:your )?(?:resume|cv)/i.test(label);
}
function isResumeUploadField(field) {
    return /r[eé]sum[eé]|curriculum|(?:^|\W)cv(?:\W|$)/i.test(`${field?.label || ""} ${field?.name || ""}`);
}
function isCoverLetterUploadField(field) {
    return /cover.?letter/i.test(`${field?.label || ""} ${field?.name || ""}`);
}
function isCoverLetterNoteField(field) {
    if (!field || field.type === "file") return false;
    return /cover.?letter|write a note|note to (?:the )?(?:hiring|team|company|recruiter)|message to (?:the )?(?:hiring|recruiter|company)/i.test(`${field.label || ""} ${field.name || ""}`);
}
function dropZoneFor(element) {
    // Prefer the custom-element host so document-level highlight styles remain
    // visible; CSS outside a Shadow Root cannot style its internal <label>.
    return host.composedClosest(element, "spl-dropzone")
        || host.composedClosest(element, "label, [class*='dropzone' i], [class*='drop-zone' i], [class*='Dropzone'], [data-testid*='upload' i], [class*='upload' i]")
        || host.composedParent(element)
        || element;
}
function base64File(base64, contentType, name) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], name, { type: contentType });
}
function assignFilesToControl(element, transfer, eventRecipe = ["input", "change", "blur", "drop"]) {
    try { element.files = transfer.files; } catch {}
    const events = new Set(eventRecipe);
    host.dispatch(element, ["input", "change", "blur"].filter((type) => events.has(type)));
    const zone = dropZoneFor(element);
    if (events.has("drop") && zone && zone !== element) {
        for (const type of ["dragenter", "dragover", "drop"]) {
            const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
            Object.defineProperty(event, "dataTransfer", { value: transfer });
            zone.dispatchEvent(event);
        }
    }
}
function attachmentConfirmed(element, filename) {
    if (element?.isConnected !== false && element?.files?.length && element.files[0]?.size) return true;
    const stem = String(filename || "").replace(/\.[a-z0-9]+$/i, "").toLowerCase();
    // Greenhouse replaces the original file input after upload and renders the
    // receipt in a sibling container. The detached input is no longer a useful
    // verification anchor, so look for the exact generated filename globally.
    if (stem) {
        const globalReceipt = host.deepQueryAll(".file-upload__filename, [class*='file-upload' i], [data-testid*='upload' i]")
            .some((candidate) => host.textOf(candidate).toLowerCase().includes(stem));
        if (globalReceipt) return true;
    }
    const zone = dropZoneFor(element);
    const scope = host.composedClosest(zone, "[class*='upload' i], [data-testid*='upload' i], fieldset, [role=group], .form-group, .field, oc-resume-upload") || zone;
    const receipt = host.textOf(scope);
    if (!receipt) return false;
    return (Boolean(stem) && receipt.toLowerCase().includes(stem))
        || /\b(?:uploaded|attached)\b/i.test(receipt)
        || /total \d+ file/i.test(receipt);
}
function fileKind(messageType) {
    return messageType === "GET_COVER_LETTER" ? "coverLetter" : "resume";
}
function quickHash(value = "") {
    let hash = 2166136261;
    const input = String(value);
    for (let index = 0; index < input.length; index += Math.max(1, Math.floor(input.length / 4096))) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
function stableUploadSignature(field, element) {
    const tokens = uploadIdentityTokens(element).filter((value) => !/^(?:field|input|select|react-select)[-_]?\d+$/i.test(value));
    return `${String(field?.label || uploadLabelFor(element)).toLowerCase().replace(/\s+/g, " ").trim()}|${tokens.join("|").toLowerCase()}`.slice(0, 500);
}
function attachmentOperationKey(field, element, messageType, fileHash) {
    const route = `${location.origin}${location.pathname}`;
    return `${host.activeJob?.id || "job"}|${route}|${messageType}|${stableUploadSignature(field, element)}|${fileHash}`;
}
function operationEvent(payload) {
    try { host.recordOperation?.(payload); } catch {}
}
function clearAttachmentState(messageType) {
    const token = `|${messageType}|`;
    for (const key of attachmentLedger.keys()) if (key.includes(token)) attachmentLedger.delete(key);
}
async function attachDocumentOnce(field, messageType, filename, { force = false } = {}) {
    if (!host.control(field)) return false;
    const existing = host.control(field).files?.[0];
    if (existing?.size) {
        if (messageType === "GET_RESUME" && /resume/i.test(existing.name) && !/cover/i.test(existing.name)) return true;
        if (messageType === "GET_COVER_LETTER" && /cover/i.test(existing.name)) return true;
    }
    const asset = await host.message({ type: messageType, jobId: host.activeJob.id });
    const kind = fileKind(messageType);
    const fileHash = quickHash(`${asset.base64?.length || 0}:${asset.base64 || ""}`);
    let firstElement = host.control(field);
    const operationKey = attachmentOperationKey(field, firstElement, messageType, fileHash);
    if (force) attachmentLedger.delete(operationKey);
    const prior = attachmentLedger.get(operationKey);
    if (prior?.status === "FAILED" && !force) {
        throw new Error("Automatic attachment already failed on this employer control. Use Attach to form or choose the file manually to retry.");
    }
    if (prior?.status === "CONFIRMED") {
        if (attachmentConfirmed(host.control(field), filename)) return true;
        attachmentLedger.delete(operationKey);
    }
    const operationId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const eventRecipe = globalThis.JobHunterAdapterRuntime?.fileEventRecipe?.(kind) || ["input", "change", "blur", "drop"];
    const maxAttempts = globalThis.JobHunterAdapterRuntime?.fileAttachAttempts?.(kind) || host.attachAttempts;
    const verifyDelayMs = globalThis.JobHunterAdapterRuntime?.fileVerifyDelayMs?.(kind) || 150;
    const startedAt = performance.now();
    attachmentLedger.set(operationKey, { status: "ATTACHING", operationId });
    operationEvent({ operationId, operationKey, phase: "DOCUMENT", semanticKey: kind === "resume" ? "RESUME" : "COVER_LETTER",
        targetSignature: stableUploadSignature(field, firstElement), status: "STARTED", attemptNumber: 1,
        triggerEvents: eventRecipe, fileHash, metadata: { documentKind: kind } });
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        // Re-resolve every attempt: the previous element may be detached.
        const element = host.control(field);
        if (!element) break;
        const transfer = new DataTransfer();
        transfer.items.add(base64File(asset.base64, asset.contentType, filename));
        assignFilesToControl(element, transfer, eventRecipe);
        await host.delay(verifyDelayMs * attempt);
        if (attachmentConfirmed(host.control(field), filename) || attachmentConfirmed(element, filename)) {
            attachmentLedger.set(operationKey, { status: "CONFIRMED", operationId, fileHash });
            operationEvent({ operationId, operationKey, phase: "DOCUMENT", semanticKey: kind === "resume" ? "RESUME" : "COVER_LETTER",
                targetSignature: stableUploadSignature(field, host.control(field) || element), status: "CONFIRMED", attemptNumber: attempt,
                triggerEvents: eventRecipe, fileHash, durationMs: Math.round(performance.now() - startedAt), metadata: { documentKind: kind } });
            return true;
        }
        if (attempt < maxAttempts) await host.delay(250 * attempt);
    }
    attachmentLedger.set(operationKey, { status: "FAILED", operationId, fileHash });
    operationEvent({ operationId, operationKey, phase: "DOCUMENT", semanticKey: kind === "resume" ? "RESUME" : "COVER_LETTER",
        targetSignature: stableUploadSignature(field, host.control(field) || firstElement), status: "FAILED", attemptNumber: maxAttempts,
        triggerEvents: eventRecipe, fileHash, durationMs: Math.round(performance.now() - startedAt), errorCode: "ATS_CLEARED_FILE",
        metadata: { documentKind: kind, reason: "Employer control cleared the file" } });
    throw new Error("The employer control cleared the selected file before it could be verified.");
}
async function attachDocument(field, messageType, filename, options = {}) {
    const assetKey = `${host.activeJob?.id || "job"}|${location.origin}${location.pathname}|${messageType}|${String(field?.label || field?.id || "field")}`;
    if (attachmentFlights.has(assetKey)) return attachmentFlights.get(assetKey);
    const flight = attachDocumentOnce(field, messageType, filename, options).finally(() => attachmentFlights.delete(assetKey));
    attachmentFlights.set(assetKey, flight);
    return flight;
}
async function fillCoverLetterNote(fields) {
    const note = (fields || host.detectFields()).find((field) => isCoverLetterNoteField(field));
    if (!note) return false;
    const element = host.control(note);
    if (!element) return false;
    if (String(element.value || "").trim()) return true;
    const payload = await host.message({ type: "GET_COVER_LETTER_TEXT", jobId: host.activeJob.id }).catch(() => null);
    const text = String(payload?.text || "").trim();
    if (!text) return false;
    const filled = await host.fill(note, text, { force: true });
    if (filled) {
        await host.message({
            type: "RECORD_FIELD_EVIDENCE",
            jobId: host.activeJob.id,
            payload: { pageUrl: location.href, fields: [host.fieldSnapshot(note, { source: "GENERATED_DOCUMENT" })], ...host.adapterPayload() }
        }).catch(() => null);
    }
    return filled;
}
async function replaceResumeDocument() {
    if (!(await host.refreshContext())) throw new Error("Open this job from your Job Hunter dashboard first.");
    const fields = host.detectFields();
    const uploads = fields.filter((field) => field.type === "file" && !isQuestionDisguisedAsUpload(field.label));
    const resumeField = uploads.find((field) => isResumeUploadField(field))
        || (uploads.length === 1 && !isCoverLetterUploadField(uploads[0]) && /document upload|attach|upload|r[eé]sum[eé]|curriculum|\bcv\b/i.test(`${uploads[0].label} ${uploads[0].name}`) ? uploads[0] : null);
    if (!resumeField) throw new Error("No resume upload field is visible on this page.");
    clearAttachmentState("GET_RESUME");
    const attached = await attachDocument(resumeField, "GET_RESUME", `resume-${host.activeJob.id.slice(0, 8)}.pdf`, { force: true });
    if (!attached) throw new Error("The selected resume could not be attached to this form.");
    await host.message({
        type: "RECORD_FIELD_EVIDENCE",
        jobId: host.activeJob.id,
        payload: { pageUrl: location.href, fields: [host.fieldSnapshot(resumeField, {
            action: { semanticKey: "RESUME", source: "USER_SELECTED_RESUME" }, source: "USER_SELECTED_RESUME"
        })], ...host.adapterPayload() }
    }).catch(() => null);
    host.setStatus("Selected resume replaced on the employer form.", "success");
    return { attached: true, fieldId: resumeField.id };
}
async function attachApplicationDocuments(fields) {
    const uploads = fields.filter((field) => field.type === "file" && !isQuestionDisguisedAsUpload(field.label));
    const resumeField = uploads.find((field) => isResumeUploadField(field))
        || (uploads.length === 1 && /document upload|attach|upload/i.test(`${uploads[0].label} ${uploads[0].name}`) && !isCoverLetterUploadField(uploads[0]) ? uploads[0] : null);
    const coverLetterField = uploads.find((field) => isCoverLetterUploadField(field));
    const result = { resumeAttached: false, coverLetterAttached: false, resumeFieldId: null, coverLetterFieldId: null, attachedCount: 0, errors: [] };
    if (resumeField) {
        try {
            result.resumeAttached = await attachDocument(resumeField, "GET_RESUME", `resume-${host.activeJob.id.slice(0, 8)}.pdf`);
            if (result.resumeAttached) {
                result.resumeFieldId = resumeField.id;
                result.attachedCount += 1;
            }
        } catch (error) { result.errors.push(`Resume: ${error.message}`); }
    }
    if (coverLetterField && coverLetterField.id !== resumeField?.id) {
        try {
            result.coverLetterAttached = await attachDocument(coverLetterField, "GET_COVER_LETTER", `cover-letter-${host.activeJob.id.slice(0, 8)}.pdf`);
            if (result.coverLetterAttached) {
                result.coverLetterFieldId = coverLetterField.id;
                result.attachedCount += 1;
            }
        } catch (error) { result.errors.push(`Cover letter: ${error.message}`); }
    }
    if (!result.coverLetterAttached) {
        try {
            result.coverLetterAttached = await fillCoverLetterNote(fields);
            if (result.coverLetterAttached) result.attachedCount += 1;
        } catch (error) { result.errors.push(`Cover letter: ${error.message}`); }
    }
    if (result.resumeAttached) {
        await host.message({ type: "CLEAR_PENDING_RESUME_REPLACEMENT", jobId: host.activeJob.id }).catch(() => null);
    }
    return result;
}
function fileInputNear(node) {
    if (node?.matches?.('input[type="file"]')) return node;
    const zone = host.composedClosest(node, "label, [class*='drop' i], [class*='upload' i], form, [role=dialog], .job-hunter-drop-target, spl-dropzone") || node;
    const files = host.deepQueryAll('input[type="file"]', zone);
    return files.find((element) => isNamedDocumentUpload(element) || isLabeledDocumentUpload(element) || host.visible(element)) || files[0] || null;
}
function documentDropInputs(kind) {
    return host.deepQueryAll('input[type="file"]').filter((element) => {
        if (isQuestionDisguisedAsUpload(uploadLabelFor(element))) return false;
        if (!(host.visible(element) || isNamedDocumentUpload(element) || isLabeledDocumentUpload(element))) return false;
        const field = { label: uploadLabelFor(element), name: element.name || "" };
        if (kind === "cover") return isCoverLetterUploadField(field);
        if (kind === "resume") return !isCoverLetterUploadField(field);
        return true;
    });
}
function ensureDropStyles() {
    if (document.getElementById("job-hunter-drop-style")) return;
    const style = document.createElement("style");
    style.id = "job-hunter-drop-style";
    style.textContent = ".job-hunter-drop-target{outline:3px dashed #315ee7!important;outline-offset:4px!important;background:rgba(49,94,231,.08)!important}.job-hunter-drop-banner{position:fixed;z-index:2147483646;top:12px;left:50%;transform:translateX(-50%);background:#1e3a8a;color:#fff;padding:10px 16px;border-radius:999px;font:600 13px system-ui,sans-serif;pointer-events:none;box-shadow:0 8px 24px rgba(15,23,42,.28)}";
    document.documentElement.appendChild(style);
}
function highlightDocumentDrops(kind) {
    host.deepQueryAll(".job-hunter-drop-target").forEach((node) => node.classList.remove("job-hunter-drop-target"));
    document.getElementById("job-hunter-drop-banner")?.remove();
    if (!kind) return;
    ensureDropStyles();
    for (const input of documentDropInputs(kind)) dropZoneFor(input)?.classList.add("job-hunter-drop-target");
    if (kind === "cover") {
        host.detectFields().filter((field) => isCoverLetterNoteField(field)).forEach((field) => host.control(field)?.classList.add("job-hunter-drop-target"));
    }
    const banner = document.createElement("div");
    banner.id = "job-hunter-drop-banner";
    banner.className = "job-hunter-drop-banner";
    banner.textContent = kind === "cover"
        ? "Drop or click the highlighted cover-letter field"
        : "Drop or click the highlighted resume field";
    document.documentElement.appendChild(banner);
}
function clearDocumentDrag() {
    pendingDocumentDrag = null;
    clearTimeout(documentDragClearTimer);
    highlightDocumentDrops(null);
}
function beginDocumentDrag(kind, jobId) {
    pendingDocumentDrag = { kind: kind === "cover" ? "cover" : "resume", jobId: jobId || host.activeJob?.id };
    clearTimeout(documentDragClearTimer);
    refreshDocumentDropBridgeRoots();
    highlightDocumentDrops(pendingDocumentDrag.kind);
}
async function attachDraggedDocument(kind, target, { force = true } = {}) {
    if (!(await host.refreshContext())) throw new Error("Open this job from your Job Hunter dashboard first.");
    const fields = host.detectFields();
    if (kind === "cover") {
        const near = fileInputNear(target);
        const coverFile = fields.find((field) => field.type === "file" && isCoverLetterUploadField(field) && (!near || host.control(field) === near))
            || fields.find((field) => field.type === "file" && isCoverLetterUploadField(field));
        if (coverFile) {
            const attached = await attachDocument(coverFile, "GET_COVER_LETTER", `cover-letter-${host.activeJob.id.slice(0, 8)}.pdf`, { force });
            if (!attached) throw new Error("The cover letter could not be attached to this form.");
            return { attached: true, kind: "cover", mode: "file", fieldId: coverFile.id };
        }
        const filled = await fillCoverLetterNote(fields);
        if (!filled) throw new Error("No cover letter field is visible on this page.");
        return { attached: true, kind: "cover", mode: "text" };
    }
    const near = fileInputNear(target);
    const uploads = fields.filter((field) => field.type === "file" && !isQuestionDisguisedAsUpload(field.label) && !isCoverLetterUploadField(field));
    const resumeField = uploads.find((field) => near && host.control(field) === near)
        || uploads.find((field) => isResumeUploadField(field))
        || (uploads.length === 1 ? uploads[0] : null);
    if (!resumeField) throw new Error("No resume upload field is visible on this page.");
    const attached = await attachDocument(resumeField, "GET_RESUME", `resume-${host.activeJob.id.slice(0, 8)}.pdf`, { force });
    if (!attached) throw new Error("The selected resume could not be attached to this form.");
    await host.message({ type: "CLEAR_PENDING_RESUME_REPLACEMENT", jobId: host.activeJob.id }).catch(() => null);
    await host.message({
        type: "RECORD_FIELD_EVIDENCE",
        jobId: host.activeJob.id,
        payload: { pageUrl: location.href, fields: [host.fieldSnapshot(resumeField, { source: "USER_SELECTED_RESUME" })], ...host.adapterPayload() }
    }).catch(() => null);
    return { attached: true, kind: "resume", fieldId: resumeField.id };
}
function markDropEventHandled(event) {
    if (event.__jobHunterDocumentHandled) return false;
    try { Object.defineProperty(event, "__jobHunterDocumentHandled", { value: true }); }
    catch { event.__jobHunterDocumentHandled = true; }
    return true;
}
function bindDocumentDropBridgeRoot(root) {
    if (!root?.addEventListener || documentDropBridgeRoots.has(root)) return;
    documentDropBridgeRoots.add(root);
    root.addEventListener("dragover", (event) => {
        if (!pendingDocumentDrag) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }, true);
    root.addEventListener("drop", (event) => {
        if (!pendingDocumentDrag || !markDropEventHandled(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const kind = pendingDocumentDrag.kind;
        attachDraggedDocument(kind, event.composedPath?.()[0] || event.target)
            .then(() => {
                host.setStatus(kind === "cover" ? "Cover letter added to the form." : "Resume attached to the form.", "success");
                clearDocumentDrag();
            })
            .catch((error) => host.setStatus(error.message, "error"));
    }, true);
    root.addEventListener("click", (event) => {
        if (!pendingDocumentDrag || event.__jobHunterDocumentHandled) return;
        const zone = host.composedClosest(event.composedPath?.()[0] || event.target, ".job-hunter-drop-target");
        if (!zone) return;
        markDropEventHandled(event);
        event.preventDefault();
        event.stopPropagation();
        const kind = pendingDocumentDrag.kind;
        attachDraggedDocument(kind, zone)
            .then(() => {
                host.setStatus(kind === "cover" ? "Cover letter added to the form." : "Resume attached to the form.", "success");
                clearDocumentDrag();
            })
            .catch((error) => host.setStatus(error.message, "error"));
    }, true);
}
function refreshDocumentDropBridgeRoots() {
    bindDocumentDropBridgeRoot(document);
    for (const root of globalThis.JobHunterShadow?.openRoots?.() || []) bindDocumentDropBridgeRoot(root);
}
function installDocumentDropBridge() {
    if (window.__jobHunterDocumentDropBridge) {
        refreshDocumentDropBridgeRoots();
        return;
    }
    window.__jobHunterDocumentDropBridge = true;
    refreshDocumentDropBridgeRoots();
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && pendingDocumentDrag) clearDocumentDrag();
    }, true);
}

    const api = {
        bind,
        uploadLabelFor,
        documentUploadIdentity,
        isNamedDocumentUpload,
        isQuestionDisguisedAsUpload,
        isLabeledDocumentUpload,
        isResumeUploadField,
        isCoverLetterUploadField,
        isCoverLetterNoteField,
        dropZoneFor,
        base64File,
        assignFilesToControl,
        attachmentConfirmed,
        attachDocument,
        fillCoverLetterNote,
        replaceResumeDocument,
        attachApplicationDocuments,
        fileInputNear,
        documentDropInputs,
        ensureDropStyles,
        highlightDocumentDrops,
        clearDocumentDrag,
        beginDocumentDrag,
        refreshDocumentDropBridgeRoots,
        attachDraggedDocument,
        installDocumentDropBridge,
        clearAttachmentState,
        getPendingDocumentDrag() { return pendingDocumentDrag; }
    };
    globalThis.JobHunterUploads = api;
})();

import { ExecutionBatchReceiptSchema, ExecutionPlanResponseSchema, ScanResultSchema, type FieldCandidate, type RuntimeStatus, type ScanResult } from "../shared/contracts.js";
import type {
  GraphActionExecutionReceipt,
  DeclarationReviewItem,
  ExecutionReceipt,
  ExecutionRequest,
  FormGraphGuard,
  ObservedFieldValue,
  ResolveFieldIntelligenceResponse
} from "@job-hunter-v2/contracts";
import { pageIdentity } from "../shared/identity.js";
import { PrivateNoteRetries } from "./private-note.js";
import { LearningInboxCaptureSchema } from "@job-hunter-v2/contracts";
import { applicationAction } from "../shared/application-journey.js";
import { JourneyCard } from "./journey-card.js";
import { RuntimeStateMachine } from "../shared/runtime-state.js";
import { TelemetryBatcher } from "../shared/telemetry.js";
import { ExtensionRuntimeError, safeFailure } from "../shared/errors.js";
import { BackgroundMessenger } from "./messaging.js";
import { PageObserver, type StructuralChangeReason } from "./observer.js";
import { FieldOwnershipTracker } from "./ownership.js";
import { DomScanner, FieldRegistry, GraphElementRegistry } from "./scanner.js";
import { radioOptionLabel, selectedRadio } from "./radio-group.js";
import { installWebsiteBridge } from "./website-bridge.js";
import { IndependentFieldVerifier } from "./verifier.js";
import { FieldExecutionOrchestrator } from "./orchestrator.js";
import { GraphActionExecutor } from "./graph-action-executor.js";
import { emptyAutofillTargets, resumeFirstPlan, waitForResumeParser } from "./ats-autofill.js";
import { ApplicationProgressCard } from "./autofill-progress.js";
import type { AutofillProgress } from "../shared/contracts.js";

export class ContentRuntimeController {
  private paused = false;
  private manualJourneyPath: string | null = null;
  private readonly journeyCard = new JourneyCard(() => { void this.inspectJourney(); });
  private executing = false;
  private readonly autoAttempted = new Set<string>();
  private aiRefreshCount = 0;
  private aiRefreshTimer: number | null = null;
  private progress: AutofillProgress | null = null;
  private readonly progressCard = new ApplicationProgressCard((id) => this.focusField(id), () => { void this.controlAutofill(this.paused || this.progress?.phase === "FAILED" ? "RESUME" : "PAUSE"); }, () => { void this.messenger.request("CONTENT_OPEN_PANEL", { pageInstanceId: this.page.pageInstanceId }); }, (id) => this.savePrivateNote(id));
  private readonly privateNoteRetries = new PrivateNoteRetries();

  private async savePrivateNote(fieldId: string): Promise<string> {
    const identity = this.runtimeStatus?.identity;
    const field = this.fields.get(fieldId);
    const element = this.registry.get(fieldId);
    const semantic = this.intelligence?.items.find((item) => item.semantic.fieldRuntimeId === fieldId)?.semantic;
    if (!identity?.applicationId || !identity.applicationRunId || identity.pageInstanceId !== this.page.pageInstanceId || !field || !element?.isConnected) return "Form changed — scan again";
    if (semantic?.canonicalKey || semantic && semantic.declarationHint.state !== "NOT_DECLARATION") return "Review this answer in your profile";
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || element instanceof HTMLInputElement && !["text", "email", "tel", "number", "url", "search"].includes(element.type)) return "This control needs manual review";
    const question = field.labelEvidence.join(" · ").trim();
    const answer = element.value.trim();
    if (!question || !answer) return "Enter an answer first";
    const snapshot = { applicationId: identity.applicationId, applicationRunId: identity.applicationRunId, pageInstanceId: identity.pageInstanceId, fieldId, question, answer };
    const capture = LearningInboxCaptureSchema.safeParse({ schemaVersion: 1, itemId: await this.privateNoteRetries.id(snapshot), applicationId: identity.applicationId, applicationRunId: identity.applicationRunId, question, answer, source: "EXPLICIT_SAVE" });
    if (!capture.success) return "Note is too long to save";
    if (!window.confirm(`Save this private note to Job Hunter? It will not become an autofill answer until you review it. If offline, allow retries from extension-only session memory for up to 24 hours, or until Chrome closes. Do not save passwords, identifiers or sensitive disclosures.\n\n${question}\n\n${answer}`)) return "Save cancelled";
    if (this.page.pageInstanceId !== snapshot.pageInstanceId || !element.isConnected || element.value.trim() !== answer) return "Answer changed — review again";
    const response = await this.messenger.request("CONTENT_INBOX_CAPTURE", { pageInstanceId: snapshot.pageInstanceId, capture: capture.data, allowSessionRetry: true }, { dataClass: "CANDIDATE_PRIVATE" });
    if (response.type === "ERROR_RESPONSE") throw new ExtensionRuntimeError(response.payload.failure);
    if (response.type !== "ACK" || !response.payload.accepted) return "Not saved — check delivery status";
    return response.payload.delivery === "QUEUED" ? "Queued — open panel for delivery status" : response.payload.delivery === "DELIVERED" ? "Saved — review in Attention" : "Delivery unconfirmed — reload extension";
  }
  private page = pageIdentity(new URL(location.href), document);
  private lastPageUrl = new URL(location.href);
  private readonly state = new RuntimeStateMachine();
  private readonly registry = new FieldRegistry();
  private readonly graphRegistry = new GraphElementRegistry();
  private readonly ownership = new FieldOwnershipTracker();
  private readonly scanner = new DomScanner(this.registry, this.ownership, this.graphRegistry);
  private readonly verifier = new IndependentFieldVerifier(
    this.registry,
    () => this.page.pageInstanceId,
    () => { this.scanner.scan(document, this.page.pageInstanceId, "STRUCTURAL_MUTATION", this.runtimeStatus?.identity?.applicationRunId ?? null); }
  );
  private readonly execution = new FieldExecutionOrchestrator(
    this.registry,
    this.ownership,
    this.verifier,
    undefined,
    () => this.page.pageInstanceId,
    () => {
      const graph = this.scanner.graphSnapshot();
      return graph ? { pageInstanceId: graph.pageInstanceId, graphRevision: graph.graphRevision, graphFingerprint: graph.graphFingerprint } : null;
    },
    (fieldRuntimeId) => this.intelligence?.items.find((item) => item.semantic.fieldRuntimeId === fieldRuntimeId)?.semantic.descriptorFingerprint ?? null
  );
  private readonly graphActions = new GraphActionExecutor(this.graphRegistry, () => {
    const graph = this.scanner.graphSnapshot();
    return graph ? { pageInstanceId: graph.pageInstanceId, graphRevision: graph.graphRevision, graphFingerprint: graph.graphFingerprint } : null;
  });
  private readonly messenger = new BackgroundMessenger();
  private readonly observer = new PageObserver((reason) => void this.handleStructuralChange(reason));
  private readonly telemetry = new TelemetryBatcher(async (events) => {
    await this.messenger.request("CONTENT_TELEMETRY_BATCH", { events: [...events] }, { dataClass: "VALUE_FREE_TELEMETRY" });
  });
  private runtimeStatus: RuntimeStatus | null = null;
  private lastScanSignature: string | null = null;
  private scanIncomplete = false;
  private scanQueue = Promise.resolve();
  private removeWebsiteBridge: (() => void) | null = null;
  private intelligence: ResolveFieldIntelligenceResponse | null = null;
  private readonly fields = new Map<string, FieldCandidate>();
  private readonly operations = new Map<string, ExecutionRequest>();
  private readonly executionReceipts = new Map<string, ExecutionReceipt>();
  private readonly declarationReviews = new Map<string, DeclarationReviewItem>();
  private readonly observationTimers = new Map<string, number>();
  private lastSubmitCaptureAt = 0;
  private submissionSignalSentFor: string | null = null;
  private lastCandidateGraphSource: { graphNodeId: string; at: number } | null = null;
  private pendingStepTransition: { guard: FormGraphGuard; stepFingerprint: string; at: number } | null = null;

  constructor() {
    this.removeWebsiteBridge = installWebsiteBridge(this.messenger, () => this.runtimeStatus);
  }

  async start(): Promise<void> {
    this.state.transition("PAGE_DETECTED", "content-started");
    await this.telemetry.record({ eventType: "PAGE_DETECTED", applicationRunId: null, pageInstanceId: this.page.pageInstanceId, fieldRuntimeId: null, operationId: null, outcome: "DETECTED", durationMs: null, metadata: { frameKind: window.top === window ? "TOP" : "CHILD" } });
    await this.register("HARD_RELOAD");
    if (this.runtimeStatus?.journey?.manualPathHash === this.page.pathHash) this.manualJourneyPath = this.page.pathHash;
    await this.updateJourney();
    if (__JH_WEB_ORIGINS__.includes(location.origin) && !this.page.applicationKey) {
      await this.maybeVerifySubmission();
      await this.telemetry.flush();
      return;
    }
    this.ownership.install(document);
    this.ownership.onCandidateChange((fieldRuntimeId) => this.scheduleObservation(fieldRuntimeId));
    this.messenger.onCommand(async (command) => {
      if (command.type === "BACKGROUND_SCAN_REQUEST") { this.autoAttempted.clear(); await this.enqueueScan(command.payload.reason); }
      if (command.type === "BACKGROUND_FOCUS_FIELD" && command.payload.pageInstanceId === this.page.pageInstanceId) this.focusField(command.payload.fieldRuntimeId);
      if (command.type === "BACKGROUND_AUTOFILL_CONTROL" && command.payload.pageInstanceId === this.page.pageInstanceId) await this.controlAutofill(command.payload.action);
      if (command.type === "BACKGROUND_STATUS_UPDATE") this.runtimeStatus = command.payload.status;
      if (command.type === "BACKGROUND_EXECUTE_REQUEST") await this.runExecution(command.payload);
      if (command.type === "BACKGROUND_INTELLIGENCE_UPDATE") this.intelligence = command.payload;
    });
    this.observer.start(document, history, window);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void this.maybeAutofill(); });
    document.addEventListener("submit", this.onTrustedSubmit, true);
    document.addEventListener("click", this.onTrustedSubmitClick, true);
    document.addEventListener("click", this.onTrustedGraphActionClick, true);
    document.addEventListener("click", this.onJourneyAction, true);
    await this.enqueueScan("INITIAL");
    await this.maybeVerifySubmission();
    window.addEventListener("pagehide", () => { void this.telemetry.flush(); }, { once: true });
  }

  stop(): void {
    this.paused = true;
    if (this.aiRefreshTimer !== null) window.clearTimeout(this.aiRefreshTimer);
    this.aiRefreshTimer = null;
    this.progressCard.remove();
    this.journeyCard.remove();
    this.observer.stop();
    document.removeEventListener("submit", this.onTrustedSubmit, true);
    document.removeEventListener("click", this.onTrustedSubmitClick, true);
    document.removeEventListener("click", this.onTrustedGraphActionClick, true);
    document.removeEventListener("click", this.onJourneyAction, true);
    this.removeWebsiteBridge?.();
    this.removeWebsiteBridge = null;
  }

  private async register(reason: "HARD_RELOAD" | "SPA_NAVIGATION" | "APPLICATION_DETECTED" | "RECOVERY"): Promise<void> {
    const response = await this.messenger.request(reason === "HARD_RELOAD" ? "CONTENT_HELLO" : "CONTENT_PAGE_CHANGED", {
      pageInstanceId: this.page.pageInstanceId,
      applicationKey: this.page.applicationKey,
      origin: location.origin,
      pathHash: this.page.pathHash,
      hasForms: this.page.hasForms,
      frameKind: window.top === window ? "TOP" : "CHILD",
      extensionVersion: __JH_EXTENSION_VERSION__,
      ...(reason === "HARD_RELOAD" ? {} : { reason })
    });
    if (response.type === "CONTENT_REGISTERED" || response.type === "STATUS_RESPONSE") this.runtimeStatus = response.payload.status;
  }

  private detectPage(url: URL) {
    const detected = pageIdentity(url, document);
    const next = pageIdentity(url, document, this.manualJourneyPath === detected.pathHash, this.runtimeStatus?.journey?.userInitiated === true);
    const flowPath = (path: string) => path.replace(/\/(?:step|page)\/\d+\/?$/i, "");
    if (next.journey.stage === "UNRELATED" && !next.journey.reasons.includes("NON_EMPLOYMENT_CONTEXT") && this.page.applicationKey && (this.page.journey.canFill || this.runtimeStatus?.journey?.evidence.canFill)
      && url.origin === this.lastPageUrl.origin && /\/(?:step|page)\/\d+\/?$/i.test(url.pathname)
      && flowPath(url.pathname) === flowPath(this.lastPageUrl.pathname)
      && !document.querySelector('input[type="password"],input[autocomplete^="cc-"]')
      && document.querySelector('form input,form select,form textarea')) {
      next.applicationKey = this.page.applicationKey;
      next.journey = { stage: "APPLICATION_FORM", method: "GENERIC_FORM", confidence: .9, canFill: true, reasons: ["SAME_APPLICATION_STEP"] };
    }
    return next;
  }

  private async updateJourney(action: "OBSERVE" | "INSPECT" | "APPLY" = "OBSERVE", targetOrigin: string | null = null): Promise<void> {
    if (__JH_WEB_ORIGINS__.includes(location.origin)) return;
    const detected = this.detectPage(new URL(location.href));
    if (detected.applicationKey !== this.page.applicationKey) {
      this.page = { ...detected, pageInstanceId: this.page.pageInstanceId };
      await this.register("APPLICATION_DETECTED");
    } else this.page.journey = detected.journey;
    const response = await this.messenger.request("CONTENT_JOURNEY", { pageInstanceId: this.page.pageInstanceId, evidence: this.page.journey, action, targetOrigin }).catch(() => null);
    if (response?.type === "STATUS_RESPONSE") this.runtimeStatus = response.payload.status;
    this.journeyCard.render(this.page.journey);
  }

  private async inspectJourney(): Promise<void> {
    if (["UNRELATED", "JOB_LIST", "AUTH_REQUIRED"].includes(this.page.journey.stage)) return;
    this.manualJourneyPath = this.page.pathHash;
    await this.updateJourney("INSPECT");
    this.autoAttempted.clear(); await this.enqueueScan("RECOVERY");
  }

  private readonly onJourneyAction = (event: MouseEvent): void => {
    if (!event.isTrusted || ["UNRELATED", "JOB_LIST", "AUTH_REQUIRED"].includes(this.page.journey.stage)) return;
    const action = event.composedPath().find((item): item is Element => item instanceof Element && item.matches('a,button,[role="button"],input[type="submit"]') && applicationAction(item));
    if (!action) return;
    let targetOrigin: string | null = null;
    try { const href = action.getAttribute("href"); const target = href ? new URL(href, location.href) : null; if (target && ["https:", "http:"].includes(target.protocol)) targetOrigin = target.origin; } catch { /* Opaque destinations are not followed. */ }
    // Observe only. Never prevent the event, follow a link, share a social profile,
    // or interpret the click itself as a confirmed application submission.
    void this.updateJourney("APPLY", targetOrigin);
  };

  private async handleStructuralChange(reason: StructuralChangeReason): Promise<void> {
    if (reason === "SPA_NAVIGATION") {
      const previousGraph = this.scanner.graphSnapshot();
      const previousStep = previousGraph?.nodes.find((node) => node.nodeType === "STEP" && node.currentStep);
      if (previousGraph && previousStep) {
        this.pendingStepTransition = {
          guard: { pageInstanceId: previousGraph.pageInstanceId, graphRevision: previousGraph.graphRevision, graphFingerprint: previousGraph.graphFingerprint },
          stepFingerprint: previousStep.logicalFingerprint,
          at: Date.now()
        };
      }
      const nextUrl = new URL(location.href);
      const nextPage = this.detectPage(nextUrl);
      const flowPath = (path: string) => path.replace(/\/(?:step|page)\/\d+\/?$/i, "");
      // A verified generic application may replace its job heading on later steps.
      if (!nextPage.applicationKey && this.page.applicationKey && nextUrl.origin === this.lastPageUrl.origin
        && /\/(?:step|page)\/\d+\/?$/i.test(nextUrl.pathname) && flowPath(nextUrl.pathname) === flowPath(this.lastPageUrl.pathname)) {
        nextPage.applicationKey = this.page.applicationKey;
      }
      this.lastPageUrl = nextUrl;
      this.page = nextPage;
      this.progressCard.remove(); this.autoAttempted.clear(); this.progress = null;
      this.aiRefreshCount = 0;
      if (this.aiRefreshTimer !== null) window.clearTimeout(this.aiRefreshTimer);
      this.aiRefreshTimer = null;
      this.scanner.resetGraph();
      this.lastScanSignature = null;
      await this.register("SPA_NAVIGATION");
    } else if (reason === "RECOVERY") {
      if (this.state.canTransition("RECOVERING")) this.state.transition("RECOVERING", "browser-online");
      await this.register("RECOVERY");
    } else {
      const detected = this.detectPage(new URL(location.href));
      this.page.journey = detected.journey;
      if (detected.applicationKey !== this.page.applicationKey) {
        this.page = { ...detected, pageInstanceId: this.page.pageInstanceId };
        if (!detected.applicationKey) { this.progressCard.remove(); this.progress = null; }
        await this.register("APPLICATION_DETECTED");
      }
    }
    await this.updateJourney();
    await this.enqueueScan(reason);
    await this.maybeVerifySubmission();
  }

  private enqueueScan(reason: ScanResult["reason"] | StructuralChangeReason): Promise<void> {
    this.scanQueue = this.scanQueue.catch(() => undefined).then(() => this.scan(reason === "RECOVERY" ? "RECOVERY" : reason));
    return this.scanQueue;
  }

  private async scan(reason: ScanResult["reason"]): Promise<void> {
    if (!this.page.journey.canFill) {
      this.progressCard.remove();
      if (!__JH_WEB_ORIGINS__.includes(location.origin)) this.journeyCard.render(this.page.journey);
      return;
    }
    this.journeyCard.remove();
    const correlationId = crypto.randomUUID();
    try {
      if (this.state.state === "FAILED" && this.state.canTransition("RECOVERING")) this.state.transition("RECOVERING", "retry-after-failure");
      if (this.page.applicationKey && this.state.state === "PAGE_DETECTED") this.state.transition("APPLICATION_DETECTED", "application-structure-present");
      if (this.state.state !== "SCANNING") this.state.transition("SCANNING", reason.toLowerCase());
      await this.telemetry.record({ eventType: "SCAN_STARTED", applicationRunId: this.runtimeStatus?.identity?.applicationRunId ?? null, pageInstanceId: this.page.pageInstanceId, fieldRuntimeId: null, operationId: correlationId, outcome: reason, durationMs: null, metadata: {} });
      let result = ScanResultSchema.parse(this.scanner.scan(document, this.page.pageInstanceId, reason, this.runtimeStatus?.identity?.applicationRunId ?? null));
      const pendingStep = this.pendingStepTransition;
      const currentStep = result.graph.nodes.find((node) => node.nodeType === "STEP" && node.currentStep);
      if (reason === "SPA_NAVIGATION" && pendingStep && currentStep && pendingStep.stepFingerprint !== currentStep.logicalFingerprint) {
        result = ScanResultSchema.parse({
          ...result,
          stepTransition: {
            schemaVersion: 1,
            transitionId: crypto.randomUUID(),
            operationId: null,
            origin: this.lastCandidateGraphSource && Date.now() - this.lastCandidateGraphSource.at <= 2_000 ? "CANDIDATE" : "UNKNOWN",
            before: pendingStep.guard,
            after: { pageInstanceId: result.graph.pageInstanceId, graphRevision: result.graph.graphRevision, graphFingerprint: result.graph.graphFingerprint },
            delta: {
              fromRevision: pendingStep.guard.graphRevision,
              toRevision: result.graph.graphRevision,
              material: true,
              items: [{
                deltaType: "STEP_CHANGED", graphNodeId: currentStep.graphNodeId, graphEdgeId: null,
                beforeFingerprint: pendingStep.stepFingerprint, afterFingerprint: currentStep.logicalFingerprint
              }],
              affectedGraphNodeIds: [currentStep.graphNodeId],
              valuePrivate: true,
              containsCandidateValue: false
            },
            expected: Date.now() - pendingStep.at <= 5_000,
            failureCode: null,
            durationMs: Math.max(0, Date.now() - pendingStep.at),
            valuePrivate: true,
            containsCandidateValue: false
          }
        });
        this.pendingStepTransition = null;
      } else if (reason === "SPA_NAVIGATION") {
        this.pendingStepTransition = null;
      }
      const candidateSource = this.lastCandidateGraphSource;
      if (reason === "STRUCTURAL_MUTATION" && candidateSource && Date.now() - candidateSource.at <= 2_000 && result.graphDelta.material) {
        const correlated = this.scanner.recordObservedTransition(candidateSource.graphNodeId, result.graphDelta, "CANDIDATE");
        if (correlated) result = this.withGraphTransition(result, correlated.graph, correlated.delta);
        this.lastCandidateGraphSource = null;
      }
      this.fields.clear();
      for (const field of result.fields) this.fields.set(field.fieldRuntimeId, field);
      const signature = result.graph.graphFingerprint;
      const duplicate = reason === "STRUCTURAL_MUTATION" && signature === this.lastScanSignature;
      this.lastScanSignature = signature;
      this.scanIncomplete = Boolean(result.inaccessibleFrameCount || result.scanLimits && Object.values(result.scanLimits).some(Boolean));
      if (!duplicate) {
        this.refreshProgress(this.paused ? "PAUSED" : this.executing ? "FILLING" : "RESOLVING");
        const response = await this.messenger.request("CONTENT_SCAN_RESULT", result, { correlationId });
        if (response.type === "ERROR_RESPONSE") throw new ExtensionRuntimeError(response.payload.failure);
        if (response.type === "STATUS_RESPONSE" || response.type === "CONTENT_REGISTERED") this.runtimeStatus = response.payload.status;
      }
      this.state.transition(
        result.fields.length ? "READY" : this.page.applicationKey ? "APPLICATION_DETECTED" : "UNSUPPORTED",
        result.fields.length ? "scan-complete" : this.page.applicationKey ? "application-fields-pending" : "no-supported-fields"
      );
      await this.telemetry.record({ eventType: "SCAN_COMPLETED", applicationRunId: this.runtimeStatus?.identity?.applicationRunId ?? null, pageInstanceId: this.page.pageInstanceId, fieldRuntimeId: null, operationId: correlationId, outcome: duplicate ? "UNCHANGED" : "RECORDED", durationMs: result.durationMs, metadata: { fieldCount: result.fields.length, formCount: result.formInstanceIds.length, inaccessibleFrames: result.inaccessibleFrameCount } });
      await this.telemetry.flush();
      if (this.page.applicationKey && !__JH_WEB_ORIGINS__.includes(location.origin)) {
        this.refreshProgress(this.executing ? "FILLING" : this.paused ? "PAUSED" : this.runtimeStatus?.lastFailure ? "FAILED" : this.runtimeStatus?.authState !== "READY" ? "DETECTING" : "REVIEW");
        window.setTimeout(() => { void this.maybeAutofill(); }, 0);
        if (this.intelligence?.items.some((item) => item.semantic.reasonCodes.includes("AI_ENRICHMENT_PENDING")) && this.aiRefreshTimer === null && this.aiRefreshCount < 3) {
          const pageId = this.page.pageInstanceId;
          this.aiRefreshCount += 1;
          this.aiRefreshTimer = window.setTimeout(() => {
            this.aiRefreshTimer = null;
            if (this.paused || this.page.pageInstanceId !== pageId || document.visibilityState !== "visible") return;
            this.autoAttempted.clear(); void this.enqueueScan("RECOVERY");
          }, 3000);
        }
      } else this.progressCard.remove();
    } catch (reasonCaught) {
      this.refreshProgress("FAILED");
      if (this.state.canTransition("FAILED")) this.state.transition("FAILED", "scan-failed");
      const currentFailure = safeFailure(reasonCaught, correlationId);
      await this.messenger.request("CONTENT_RUNTIME_ERROR", { failure: currentFailure }, { correlationId }).catch(() => undefined);
    }
  }

  private focusField(id: string): void {
    const element = this.registry.get(id);
    if (!element?.isConnected) return;
    this.ownership.markUserOwned(id);
    element.scrollIntoView({ block: "center", behavior: "smooth" }); element.focus({ preventScroll: true });
    element.animate([{ outline: "3px solid #e3a334" }, { outline: "3px solid transparent" }], { duration: 1800 });
  }

  private async controlAutofill(action: "PAUSE" | "RESUME"): Promise<void> {
    this.paused = action === "PAUSE";
    this.refreshProgress(this.paused ? "PAUSED" : "RESOLVING");
    if (!this.paused) { this.autoAttempted.clear(); await this.enqueueScan("RECOVERY"); }
  }

  private refreshProgress(phase: AutofillProgress["phase"]): void {
    const previous = new Map(this.progress?.fields.map((field) => [field.fieldRuntimeId, field]) ?? []);
    this.progress = { pageInstanceId: this.page.pageInstanceId, phase, scanIncomplete: this.scanIncomplete, containsCandidateValue: false, fields: [...this.fields.values()].slice(0,500).map((field) => {
      const element = this.registry.get(field.fieldRuntimeId);
      const semantic = this.intelligence?.items.find((item) => item.semantic.fieldRuntimeId === field.fieldRuntimeId)?.semantic;
      const existing = previous.get(field.fieldRuntimeId);
      return { fieldRuntimeId: field.fieldRuntimeId, canonicalKey: semantic?.canonicalKey ?? existing?.canonicalKey ?? null, required: field.required,
        state: element?.dataset.jobHunterFillSource === "ATS_AUTOFILLED" ? "ATS_AUTOFILLED" : this.ownership.ownershipOf(field.fieldRuntimeId) === "USER_OWNED" ? "USER_OWNED" : existing?.state ?? "PENDING", reason: existing?.reason ?? null };
    }) };
    this.publishProgress();
  }

  private publishProgress(): void {
    if (!this.progress || !this.page.applicationKey || !this.page.journey.canFill || __JH_WEB_ORIGINS__.includes(location.origin)) return;
    this.progressCard.render(this.progress);
    void this.messenger.request("CONTENT_AUTOFILL_PROGRESS", this.progress).catch(() => undefined);
  }

  private async maybeAutofill(): Promise<void> {
    const identity = this.runtimeStatus?.identity;
    const signature = this.scanner.graphSnapshot()?.graphFingerprint;
    if (this.paused || this.executing || !this.page.journey.canFill || !this.page.applicationKey || __JH_WEB_ORIGINS__.includes(location.origin) || document.visibilityState !== "visible"
      || !identity?.applicationRunId || this.runtimeStatus?.authState !== "READY" || this.runtimeStatus.siteAccess !== "GRANTED" || !this.intelligence || !signature || !this.fields.size || this.autoAttempted.has(signature) || this.autoAttempted.size >= 50) return;
    this.autoAttempted.add(signature);
    await this.runExecution({ batchId: crypto.randomUUID(), applicationRunId: identity.applicationRunId, pageInstanceId: identity.pageInstanceId });
  }

  private async runExecution(command: { batchId: string; applicationRunId: string; pageInstanceId: string }): Promise<void> {
    if (this.executing || this.paused || !this.detectPage(new URL(location.href)).journey.canFill) return;
    this.executing = true; this.refreshProgress("FILLING");
    try { await this.execute(command); this.refreshProgress(this.paused ? "PAUSED" : "REVIEW"); }
    catch (reason) {
      this.refreshProgress("FAILED");
      await this.messenger.request("CONTENT_RUNTIME_ERROR", { failure: safeFailure(reason) }).catch(() => undefined);
    } finally { this.executing = false; }
  }

  private async execute(command: { batchId: string; applicationRunId: string; pageInstanceId: string }): Promise<void> {
    const identity = this.runtimeStatus?.identity;
    if (!identity || identity.pageInstanceId !== command.pageInstanceId || identity.applicationRunId !== command.applicationRunId || this.page.pageInstanceId !== command.pageInstanceId) {
      throw new Error("STALE_EXECUTION_RUNTIME");
    }
    await this.telemetry.record({ eventType: "EXECUTION_STARTED", applicationRunId: command.applicationRunId, pageInstanceId: command.pageInstanceId, fieldRuntimeId: null, operationId: command.batchId, outcome: "REQUESTED", durationMs: null, metadata: {} });
    const seenFingerprints = new Set<string>();
    const maximumIterations = 12;
    for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
      if (this.paused || !this.page.applicationKey || this.page.pageInstanceId !== command.pageInstanceId) return;
      const scan = ScanResultSchema.parse(this.scanner.scan(document, this.page.pageInstanceId, "MANUAL", command.applicationRunId));
      this.scanIncomplete = Boolean(scan.inaccessibleFrameCount || scan.scanLimits && Object.values(scan.scanLimits).some(Boolean));
      this.fields.clear();
      for (const field of scan.fields) this.fields.set(field.fieldRuntimeId, field);
      if (seenFingerprints.has(scan.graph.graphFingerprint)) {
        await this.recordGraphStop(command, "REPEATED_GRAPH_STATE", iteration, scan.graph.graphRevision);
        return;
      }
      seenFingerprints.add(scan.graph.graphFingerprint);
      const fields = scan.fields.map((candidate) => {
        const { schemaVersion, ...field } = candidate;
        if (schemaVersion !== 2) throw new Error("STALE_FIELD_RUNTIME");
        return field;
      });
      const planRequest = {
        schemaVersion: 1 as const,
        requestId: crypto.randomUUID(),
        pageInstanceId: command.pageInstanceId,
        graph: scan.graph,
        intelligence: {
          schemaVersion: 1 as const,
          requestId: crypto.randomUUID(),
          applicationRunId: command.applicationRunId,
          pageContext: {
            host: scan.pageContext.host, ats: scan.pageContext.ats, pageHeading: scan.pageContext.pageHeading,
            jobId: null, applicationId: identity.applicationId, countryCode: null, roleFamily: null, companyId: null
          },
          fields
        }
      };
      const response = await this.messenger.request("CONTENT_EXECUTION_PLAN_REQUEST", planRequest);
      if (this.paused || this.page.pageInstanceId !== command.pageInstanceId) return;
      if (response.type === "ERROR_RESPONSE") throw new ExtensionRuntimeError(response.payload.failure);
      if (response.type !== "EXECUTION_PLAN_RESPONSE") throw new Error("EXECUTION_PLAN_REQUIRED");
      const parsedPlan = ExecutionPlanResponseSchema.parse(response.payload);
      const declarations = new Set(parsedPlan.declarations.map((item) => item.fieldRuntimeId));
      const fullPlan = { ...parsedPlan, operations: parsedPlan.operations.filter((operation) => !declarations.has(operation.fieldRuntimeId)) };
      this.refreshProgress("FILLING");
      for (const field of this.progress!.fields) {
        const operation = fullPlan.operations.find((item) => item.fieldRuntimeId === field.fieldRuntimeId);
        const skip = fullPlan.skipped.find((item) => item.fieldRuntimeId === field.fieldRuntimeId);
        field.canonicalKey = operation?.canonicalKey ?? skip?.canonicalKey ?? field.canonicalKey;
        if (skip && !["COMPLETED", "ATS_AUTOFILLED"].includes(field.state)) { field.reason = skip.diagnosticCode ?? skip.reason; field.state = skip.reason === "ALREADY_COMPLETED" ? "COMPLETED" : ["NOT_APPLICABLE", "HIDDEN_OR_DISABLED"].includes(skip.reason) ? "SKIPPED" : skip.reason === "USER_OWNED" ? "USER_OWNED" : "ATTENTION"; }
        if (declarations.has(field.fieldRuntimeId)) { field.state = "ATTENTION"; field.reason = "DECLARATION_REQUIRES_USER"; }
      }
      this.publishProgress();
      const plan = resumeFirstPlan(fullPlan, (id) => this.registry.get(id));
      const atsFirst = plan !== fullPlan;
      if (plan.applicationRunId !== command.applicationRunId || plan.pageInstanceId !== command.pageInstanceId
        || plan.graphGuard.graphRevision !== scan.graph.graphRevision || plan.graphGuard.graphFingerprint !== scan.graph.graphFingerprint) {
        throw new Error("STALE_EXECUTION_PLAN");
      }
      this.declarationReviews.clear();
      for (const item of plan.declarations) this.declarationReviews.set(item.fieldRuntimeId, item);
      const automaticAction = plan.actions.find((action) => action.authorization === "AUTO_SAFE") ?? null;
      if (!plan.operations.length && !automaticAction) {
        await this.telemetry.flush();
        return;
      }
      const preflight = ScanResultSchema.parse(this.scanner.scan(document, this.page.pageInstanceId, "MANUAL", command.applicationRunId));
      if (preflight.graph.graphRevision !== plan.graphGuard.graphRevision || preflight.graph.graphFingerprint !== plan.graphGuard.graphFingerprint) continue;
      const batchId = iteration === 0 ? command.batchId : crypto.randomUUID();
      let actionReceipt: GraphActionExecutionReceipt | null = null;
      let receipt;
      if (plan.operations.length) {
        const parserTargets = atsFirst ? emptyAutofillTargets(document) : null;
        for (const operation of plan.operations) this.operations.set(operation.fieldRuntimeId, operation);
        receipt = await this.execution.execute(plan, batchId, { shouldContinue: () => !this.paused && this.page.pageInstanceId === command.pageInstanceId, onField: (id, status) => {
          const field = this.progress?.fields.find((item) => item.fieldRuntimeId === id);
          if (field) { field.state = status === "FILLING" ? "FILLING" : status === "VERIFIED" ? "COMPLETED" : "ATTENTION"; field.reason = status === "FILLING" || status === "VERIFIED" ? null : "FILL_VERIFICATION_FAILED"; }
          this.publishProgress();
        } });
        if (parserTargets && receipt.receipts.some((item) => item.status === "VERIFIED")) {
          await waitForResumeParser(parserTargets, (element) => {
            const field = scan.fields.find((candidate) => this.registry.get(candidate.fieldRuntimeId) === element);
            if (!field || this.ownership.ownershipOf(field.fieldRuntimeId) === "USER_OWNED") return false;
            this.ownership.markShared(field.fieldRuntimeId);
            return true;
          });
        }
      } else {
        actionReceipt = await this.graphActions.execute(automaticAction!);
        receipt = ExecutionBatchReceiptSchema.parse({
          schemaVersion: 1, batchId, planRequestId: plan.requestId,
          applicationRunId: plan.applicationRunId, pageInstanceId: plan.pageInstanceId,
          status: actionReceipt.status === "EXECUTED_AWAITING_GRAPH" ? "COMPLETED" : "FAILED",
          receipts: [], actionReceipts: [actionReceipt], skippedCount: plan.skipped.length,
          durationMs: actionReceipt.durationMs, valuePrivate: true, containsCandidateValue: false
        });
      }
      for (const item of receipt.receipts) {
        this.executionReceipts.set(item.fieldRuntimeId, item);
        const field = this.progress?.fields.find(field => field.fieldRuntimeId === item.fieldRuntimeId);
        if (field) { field.state = item.status === "VERIFIED" ? "COMPLETED" : "ATTENTION"; field.reason = item.failureClass ?? "DOM_READBACK_ONLY"; }
      }
      const attempted = new Set(receipt.receipts.map(item => item.fieldRuntimeId));
      for (const operation of plan.operations) {
        const field = this.progress?.fields.find(field => field.fieldRuntimeId === operation.fieldRuntimeId);
        if (field && !attempted.has(operation.fieldRuntimeId)) { field.state = "PENDING"; field.reason = "DEFERRED_RESCAN"; }
      }
      for (const item of receipt.receipts) {
        const operation = this.operations.get(item.fieldRuntimeId);
        if (operation?.trialReuse && item.status === "VERIFIED" && item.verificationStatus === "VERIFIED") await this.stageTrialConfirmation(operation, item);
        const last = item.attempts.at(-1);
        await this.telemetry.record({
          eventType: item.status === "VERIFIED" ? "EXECUTION_VERIFIED" : item.status === "ABORTED" ? "EXECUTION_ABORTED" : "EXECUTION_FAILED",
          applicationRunId: item.applicationRunId, pageInstanceId: item.pageInstanceId,
          fieldRuntimeId: item.fieldRuntimeId, operationId: item.operationId, outcome: item.failureClass ?? item.status,
          durationMs: item.durationMs,
          metadata: {
            strategyId: item.selectedStrategyId, representationId: item.representationId,
            attemptCount: item.attempts.length, capability: last?.capability ?? null,
            structuralChange: item.structuralChange, graphRevision: item.graphGuard.graphRevision
          }
        });
      }
      let after = ScanResultSchema.parse(this.scanner.scan(document, this.page.pageInstanceId, "STRUCTURAL_MUTATION", command.applicationRunId));
      const sourceReceipt = [...receipt.receipts].reverse().find((item) => item.status === "VERIFIED");
      const transitionSourceId = sourceReceipt?.graphNodeId ?? actionReceipt?.graphNodeId ?? null;
      if (transitionSourceId && after.graphDelta.material) {
        const correlated = this.scanner.recordObservedTransition(transitionSourceId, after.graphDelta, "COPILOT");
        if (correlated) after = this.withGraphTransition(after, correlated.graph, correlated.delta);
      }
      const graphChanged = after.graph.graphFingerprint !== scan.graph.graphFingerprint;
      if (actionReceipt) {
        actionReceipt = {
          ...actionReceipt,
          status: graphChanged ? "VERIFIED_TRANSITION" : "FAILED",
          failureCode: graphChanged ? null : "EXPECTED_NODE_NOT_REVEALED",
          durationMs: Math.max(actionReceipt.durationMs, 1)
        };
        receipt = ExecutionBatchReceiptSchema.parse({
          ...receipt,
          status: graphChanged ? "COMPLETED" : "FAILED",
          actionReceipts: [actionReceipt]
        });
        await this.telemetry.record({
          eventType: actionReceipt.status === "VERIFIED_TRANSITION" ? "EXECUTION_VERIFIED" : "EXECUTION_FAILED",
          applicationRunId: actionReceipt.applicationRunId,
          pageInstanceId: actionReceipt.pageInstanceId,
          fieldRuntimeId: null,
          operationId: actionReceipt.operationId,
          outcome: actionReceipt.failureCode ?? actionReceipt.status,
          durationMs: actionReceipt.durationMs,
          metadata: {
            actionKind: actionReceipt.actionKind,
            graphNodeId: actionReceipt.graphNodeId,
            graphRevision: actionReceipt.graphGuard.graphRevision
          }
        });
      }
      const recorded = await this.messenger.request("CONTENT_EXECUTION_RESULT", receipt, { dataClass: "VALUE_FREE_TELEMETRY" });
      if (recorded.type === "ERROR_RESPONSE") throw new ExtensionRuntimeError(recorded.payload.failure);
      if (recorded.type === "STATUS_RESPONSE") this.runtimeStatus = recorded.payload.status;
      await this.telemetry.flush();
      if (!graphChanged) return;
      await this.enqueueScan("STRUCTURAL_MUTATION");
    }
    const graph = this.scanner.graphSnapshot();
    await this.recordGraphStop(command, "GRAPH_NOT_CONVERGED", maximumIterations, graph?.graphRevision ?? 1);
  }

  private async recordGraphStop(
    command: { batchId: string; applicationRunId: string; pageInstanceId: string },
    outcome: "REPEATED_GRAPH_STATE" | "GRAPH_NOT_CONVERGED",
    iterationCount: number,
    graphRevision: number
  ): Promise<void> {
    await this.telemetry.record({
      eventType: "EXECUTION_ABORTED", applicationRunId: command.applicationRunId, pageInstanceId: command.pageInstanceId,
      fieldRuntimeId: null, operationId: command.batchId, outcome, durationMs: null,
      metadata: { iterationCount, graphRevision }
    });
    await this.telemetry.flush();
  }

  private scheduleObservation(fieldRuntimeId: string): void {
    const graphNode = this.scanner.graphSnapshot()?.nodes.find((node) => node.fieldRuntimeId === fieldRuntimeId);
    if (graphNode) this.lastCandidateGraphSource = { graphNodeId: graphNode.graphNodeId, at: Date.now() };
    const previous = this.observationTimers.get(fieldRuntimeId);
    if (previous !== undefined) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      this.observationTimers.delete(fieldRuntimeId);
      void this.observeCandidateField(fieldRuntimeId);
    }, 250);
    this.observationTimers.set(fieldRuntimeId, timer);
  }

  private withGraphTransition(
    result: ScanResult,
    graph: ScanResult["graph"],
    edgeDelta: ScanResult["graphDelta"]
  ): ScanResult {
    return ScanResultSchema.parse({
      ...result,
      graph,
      graphDelta: {
        fromRevision: result.graphDelta.fromRevision,
        toRevision: graph.graphRevision,
        material: result.graphDelta.material || edgeDelta.material,
        items: [...result.graphDelta.items, ...edgeDelta.items],
        affectedGraphNodeIds: [...new Set([...result.graphDelta.affectedGraphNodeIds, ...edgeDelta.affectedGraphNodeIds])],
        valuePrivate: true,
        containsCandidateValue: false
      }
    });
  }

  private observedValue(element: HTMLElement): ObservedFieldValue | null {
    if ((element instanceof HTMLInputElement && element.type === "radio") || element.matches('[role=radio],[role=radiogroup]')) {
      const selected = selectedRadio(element);
      if (!selected) return null;
      const label = radioOptionLabel(selected);
      const key = selected instanceof HTMLInputElement ? selected.value : selected.getAttribute("data-value");
      return label ? { kind: "SINGLE_OPTION", key: key || null, label } : null;
    }
    if (element instanceof HTMLSelectElement) {
      if (element.multiple) return { kind: "MULTI_OPTION", values: [...element.selectedOptions].map((option) => ({ key: option.value || null, label: option.text.trim() })).filter((option) => option.label) };
      const option = element.selectedOptions[0];
      return option?.text.trim() ? { kind: "SINGLE_OPTION", key: option.value || null, label: option.text.trim() } : null;
    }
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox") return { kind: "BOOLEAN", value: element.checked };
      if (element.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(element.value)) return { kind: "DATE", isoDate: element.value, precision: "DAY" };
      return element.value.trim() ? { kind: "TEXT", value: element.value } : null;
    }
    if (element instanceof HTMLTextAreaElement) return element.value.trim() ? { kind: "TEXT", value: element.value } : null;
    const text = element.isContentEditable ? (element.textContent ?? "").trim() : "";
    return text ? { kind: "TEXT", value: text } : null;
  }

  private async observeCandidateField(fieldRuntimeId: string): Promise<void> {
    const identity = this.runtimeStatus?.identity;
    const field = this.fields.get(fieldRuntimeId);
    const resolved = this.intelligence?.items.find((item) => item.semantic.fieldRuntimeId === fieldRuntimeId);
    const element = this.registry.get(fieldRuntimeId);
    if (!identity?.applicationId || !identity.applicationRunId || !field || !resolved || !element) return;
    if (resolved.semantic.state !== "RESOLVED_HIGH" || !resolved.semantic.canonicalKey) return;
    const canonicalKey = resolved.semantic.canonicalKey;
    if (resolved.semantic.declarationHint.state !== "NOT_DECLARATION") {
      const review = this.declarationReviews.get(fieldRuntimeId);
      if (!review) return;
      const operation = this.operations.get(fieldRuntimeId) ?? null;
      const candidateModified = Boolean(operation?.declarationAuthorization);
      await this.messenger.request("CONTENT_DECLARATION_EVIDENCE", {
        schemaVersion: 1, requestId: crypto.randomUUID(), evidenceEventId: crypto.randomUUID(),
        applicationId: identity.applicationId, applicationRunId: identity.applicationRunId,
        pageInstanceId: identity.pageInstanceId, formInstanceId: review.formInstanceId,
        fieldRuntimeId: review.fieldRuntimeId, controlFingerprint: review.controlFingerprint,
        descriptorFingerprint: review.descriptorFingerprint, graphGuard: review.graphGuard,
        declarationType: review.declarationType, semanticConfidence: review.semanticConfidence,
        policyVersion: review.policyVersion, policyDecision: review.policyDecision,
        decisionFingerprint: review.decisionFingerprint,
        eventType: candidateModified ? "CANDIDATE_MODIFIED" : "CANDIDATE_ACTION_OBSERVED",
        actionOrigin: "CANDIDATE", operationId: operation?.operationId ?? null,
        executionStatus: null, verificationStatus: candidateModified ? "USER_MODIFIED" : null,
        failureCode: candidateModified ? "DECLARATION_MODIFIED_BY_USER" : null,
        required: review.required, candidateModified, finalReviewState: "NOT_PRESENTED",
        checkpointId: null, occurredAt: new Date().toISOString(), valuePrivate: true, containsCandidateValue: false
      }, { dataClass: "VALUE_FREE_TELEMETRY" });
      return;
    }
    const forbidden = new Set([
      "EEO_GENDER", "EEO_RACE", "EEO_VETERAN", "EEO_DISABILITY", "RESUME",
    ]);
    if (forbidden.has(canonicalKey) || ["FILE", "BUTTON", "UNKNOWN"].includes(field.controlType)) return;
    const value = this.observedValue(element);
    if (!value) return;
    const operation = this.operations.get(fieldRuntimeId) ?? null;
    const receipt = this.executionReceipts.get(fieldRuntimeId) ?? null;
    const correction = Boolean(operation);
    await this.messenger.request("CONTENT_LEARNING_OBSERVATION", {
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      observationId: crypto.randomUUID(),
      applicationId: identity.applicationId,
      applicationRunId: identity.applicationRunId,
      pageInstanceId: identity.pageInstanceId,
      formInstanceId: field.formInstanceId,
      fieldRuntimeId,
      controlFingerprint: field.controlFingerprint,
      controlType: field.controlType,
      labelEvidence: field.labelEvidence,
      canonicalKey,
      descriptorFingerprint: resolved.semantic.descriptorFingerprint,
      semanticState: resolved.semantic.state,
      semanticConfidence: resolved.semantic.confidence,
      semanticResolver: resolved.semantic.resolver === "NONE" ? "DETERMINISTIC" : resolved.semantic.resolver,
      entityBinding: resolved.semantic.entityBinding,
      entityIntelligence: resolved.semantic.entityIntelligence ?? null,
      answerVersionId: operation?.answerVersionId ?? null,
      answerScopeFingerprint: operation?.answerScopeFingerprint ?? null,
      priorOperationId: operation?.operationId ?? null,
      priorVerificationStatus: receipt?.verificationStatus ?? null,
      priorFailureClass: receipt?.failureClass ?? null,
      ...(operation?.strategySelection ? { strategyFeedback: {
        pattern: this.ownership.interactionPattern(fieldRuntimeId),
        committed: (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.checkValidity(),
        feedback: operation.representation.kind === "TEXT" && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
          ? element.value === operation.representation.text ? "KEPT" : "OVERWRITTEN" : "NONE"
      } } : {}),
      origin: correction ? "USER_CORRECTED" : "USER_ENTERED",
      observationType: correction ? "COPILOT_CORRECTION" : "MANUAL_ANSWER",
      value,
      occurredAt: new Date().toISOString()
    }, { dataClass: "CANDIDATE_PRIVATE" });
  }

  private readonly onTrustedSubmit = (event: Event): void => {
    if (event.isTrusted) void this.captureSubmitAttempt(event.target instanceof HTMLFormElement ? event.target : null).catch(() => undefined);
  };

  private readonly onTrustedSubmitClick = (event: Event): void => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLElement>('button,input[type="submit"],input[type="button"],[role="button"]');
    if (!control) return;
    const nodeId = this.graphRegistry.nodeIdFor(control);
    const submit = control.matches('button[type="submit"],input[type="submit"]') || (control.matches('button:not([type])') && Boolean(control.closest("form")))
      || this.scanner.graphSnapshot()?.nodes.some((node) => node.graphNodeId === nodeId && node.actionKind === "SUBMIT")
      || /^(?:submit (?:my |your )?application|send application)$/i.test((control.textContent ?? "").trim());
    if (submit) void this.captureSubmitAttempt(control.closest("form")).catch(() => undefined);
  };

  private readonly onTrustedGraphActionClick = (event: Event): void => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLElement>('button,input[type="button"],input[type="submit"],[role="button"]');
    if (!control) return;
    const graphNodeId = this.graphRegistry.nodeIdFor(control);
    if (!graphNodeId) return;
    const graphNode = this.scanner.graphSnapshot()?.nodes.find((node) => node.graphNodeId === graphNodeId);
    if (graphNode?.nodeType === "ACTION" && graphNode.actionKind !== "SUBMIT") {
      this.lastCandidateGraphSource = { graphNodeId, at: Date.now() };
    }
  };

  private async captureSubmitAttempt(form: HTMLFormElement | null): Promise<void> {
    const now = Date.now();
    if (now - this.lastSubmitCaptureAt < 1_000) return;
    const identity = this.runtimeStatus?.identity;
    if (!identity?.applicationId || !identity.applicationRunId) return;
    const matchingField = [...this.fields.values()].find((field) => {
      const element = this.registry.get(field.fieldRuntimeId);
      return form ? element?.closest("form") === form : false;
    });
    const formInstanceId = matchingField?.formInstanceId ?? identity.formInstanceIds[0];
    if (!formInstanceId) return;
    this.lastSubmitCaptureAt = now;
    const pendingObservations = [...this.observationTimers.keys()];
    for (const fieldRuntimeId of pendingObservations) {
      const timer = this.observationTimers.get(fieldRuntimeId);
      if (timer !== undefined) window.clearTimeout(timer);
      this.observationTimers.delete(fieldRuntimeId);
      await this.observeCandidateField(fieldRuntimeId);
    }
    const occurredAt = new Date(now).toISOString();
    const response = await this.messenger.request("CONTENT_SUBMIT_ATTEMPT", {
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      applicationId: identity.applicationId,
      applicationRunId: identity.applicationRunId,
      pageInstanceId: identity.pageInstanceId,
      formInstanceId,
      occurredAt
    });
    if (response.type === "STATUS_RESPONSE") {
      this.runtimeStatus = response.payload.status;
      await this.maybeVerifySubmission();
    }
  }

  private async maybeVerifySubmission(): Promise<void> {
    const identity = this.runtimeStatus?.identity;
    const pendingSubmitAt = this.runtimeStatus?.pendingSubmitAt;
    if (!identity?.applicationId || !identity.applicationRunId || !pendingSubmitAt || this.submissionSignalSentFor === pendingSubmitAt) return;
    const urlEvidence = `${location.pathname} ${location.search}`.toLowerCase();
    const visibleText = (document.body?.innerText ?? "").toLowerCase().slice(0, 80_000);
    const urlMarker = ["thank", "success", "confirmation", "submitted", "complete"].find((token) => urlEvidence.includes(token));
    const textMarker = [
      "application submitted", "successfully submitted", "thank you for applying",
      "application has been received", "we received your application"
    ].find((token) => visibleText.includes(token));
    const formExited = ![...this.fields.keys()].some((id) => { const element = this.registry.get(id); return element?.isConnected && element.getClientRects().length > 0; });
    if (!textMarker || (!urlMarker && !formExited)) return;
    this.submissionSignalSentFor = pendingSubmitAt;
    const verifiedAt = new Date().toISOString();
    const response = await this.messenger.request("CONTENT_SUBMISSION_SIGNAL", {
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      applicationId: identity.applicationId,
      applicationRunId: identity.applicationRunId,
      signal: {
        signalType: urlMarker ? "SUCCESS_URL_AND_MARKER" : "ATS_CONFIRMATION",
        pageInstanceId: identity.pageInstanceId,
        successUrlHash: await sha256(`${location.origin}${location.pathname}`),
        successMarkerHash: await sha256(`SUCCESS_MARKER:${textMarker}:${urlMarker ?? "FORM_EXIT"}`),
        trustedSubmitObservedAt: pendingSubmitAt,
        verifiedAt
      }
    });
    if (response.type === "STATUS_RESPONSE") this.runtimeStatus = response.payload.status;
    if (response.type === "ERROR_RESPONSE") this.submissionSignalSentFor = null;
  }

  private async stageTrialConfirmation(operation: ExecutionRequest, receipt: ExecutionReceipt): Promise<void> {
    const identity = this.runtimeStatus?.identity;
    const field = this.fields.get(operation.fieldRuntimeId);
    const resolved = this.intelligence?.items.find((item) => item.semantic.fieldRuntimeId === operation.fieldRuntimeId);
    const element = this.registry.get(operation.fieldRuntimeId);
    if (!identity?.applicationId || !identity.applicationRunId || !field || !resolved || !element || resolved.semantic.state !== "RESOLVED_HIGH") return;
    const value = this.observedValue(element);
    if (!value) return;
    await this.messenger.request("CONTENT_LEARNING_OBSERVATION", {
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      observationId: crypto.randomUUID(),
      applicationId: identity.applicationId,
      applicationRunId: identity.applicationRunId,
      pageInstanceId: identity.pageInstanceId,
      formInstanceId: field.formInstanceId,
      fieldRuntimeId: field.fieldRuntimeId,
      controlFingerprint: field.controlFingerprint,
      controlType: field.controlType,
      labelEvidence: field.labelEvidence,
      canonicalKey: operation.canonicalKey,
      descriptorFingerprint: resolved.semantic.descriptorFingerprint,
      semanticState: resolved.semantic.state,
      semanticConfidence: resolved.semantic.confidence,
      semanticResolver: resolved.semantic.resolver === "NONE" ? "DETERMINISTIC" : resolved.semantic.resolver,
      entityBinding: resolved.semantic.entityBinding,
      entityIntelligence: resolved.semantic.entityIntelligence ?? null,
      answerVersionId: operation.answerVersionId,
      answerScopeFingerprint: operation.answerScopeFingerprint,
      priorOperationId: operation.operationId,
      priorVerificationStatus: receipt.verificationStatus,
      priorFailureClass: receipt.failureClass,
      origin: "USER_CONFIRMED",
      observationType: "ANSWER_CONFIRMATION",
      value,
      occurredAt: new Date().toISOString()
    }, { dataClass: "CANDIDATE_PRIVATE" });
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

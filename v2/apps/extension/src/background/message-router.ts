import { ContentCommandAckSchema, ExtensionRequestSchema, createResponse, type ContentCommand, type ExtensionRequest, type ExtensionResponse, type RuntimeStatus } from "../shared/contracts.js";
import { ExtensionRuntimeError, failure, safeFailure } from "../shared/errors.js";
import type { AuthSessionStore } from "./auth-session.js";
import type { DeliveryQueue } from "./delivery-queue.js";
import type { ExtensionApiClient } from "./api-client.js";
import type { ExtensionConfig } from "./config.js";
import type { MessageReceiptStore } from "./message-receipts.js";
import type { RuntimeRecord, RuntimeRegistry } from "./runtime-registry.js";
import { exactOriginPattern, type SiteAccessManager } from "./site-access.js";
import type { TelemetryStore } from "./telemetry-store.js";
import { groupApplicationTabs, setApplicationPanel } from "./application-tabs.js";
import {
  DeclarationFailureCodeSchema,
  type AutofillOutcome,
  RecordDeclarationEvidenceRequestSchema,
  type DeclarationReviewItem,
  type ExecutionReceipt,
  type RecordDeclarationEvidenceRequest
} from "@job-hunter-v2/contracts";

export interface RouterDependencies {
  config: ExtensionConfig;
  auth: AuthSessionStore;
  api: ExtensionApiClient;
  runtimes: RuntimeRegistry;
  receipts: MessageReceiptStore;
  telemetry: TelemetryStore;
  sites: SiteAccessManager;
  delivery?: DeliveryQueue;
}

function frame(sender: chrome.runtime.MessageSender): { tabId: number; frameId: number } {
  if (sender.tab?.id === undefined) throw new ExtensionRuntimeError(failure("MESSAGE_SOURCE_INVALID", "This message requires a browser tab.", { category: "AUTHORIZATION" }));
  return { tabId: sender.tab.id, frameId: sender.frameId ?? 0 };
}

function assertSource(request: ExtensionRequest, sender: chrome.runtime.MessageSender): void {
  if (request.source === "CONTENT" && sender.tab?.id === undefined) throw new ExtensionRuntimeError(failure("MESSAGE_SOURCE_INVALID", "Content message has no tab identity.", { category: "AUTHORIZATION" }));
  if (request.source === "SIDEPANEL" && !sender.url?.startsWith(chrome.runtime.getURL(""))) throw new ExtensionRuntimeError(failure("MESSAGE_SOURCE_INVALID", "Only an extension page can send this message.", { category: "AUTHORIZATION" }));
  if (request.source !== "CONTENT") return;
  let sourceOrigin: string | null;
  try { sourceOrigin = sender.url ? new URL(sender.url).origin : null; } catch { sourceOrigin = null; }
  const claimedOrigin = request.type === "CONTENT_HELLO" || request.type === "CONTENT_PAGE_CHANGED"
    ? request.payload.origin
    : request.type === "WEB_SESSION_OFFER" || request.type === "WEB_STATUS_REQUEST" || request.type === "WEB_LAUNCH_REQUEST"
      ? request.payload.websiteOrigin
      : null;
  if (claimedOrigin && claimedOrigin !== sourceOrigin) throw new ExtensionRuntimeError(failure("MESSAGE_SOURCE_INVALID", "The message origin does not match its browser frame.", { category: "AUTHORIZATION" }));
}

export function originFromTabUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function contentRuntimeVersionMatches(loadedVersion: string | null | undefined, expectedVersion: string): boolean {
  return loadedVersion === expectedVersion;
}

async function probeTabOrigin(tabId: number): Promise<string | null> {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => location.origin
    });
    const probed = injected[0]?.result;
    return typeof probed === "string" ? originFromTabUrl(probed) : null;
  } catch {
    return null;
  }
}

async function activeEmployerTab(): Promise<{ tabId: number | null; origin: string | null }> {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tabId = active?.id ?? null;
  let origin = originFromTabUrl(active?.url) ?? originFromTabUrl(active?.pendingUrl);
  if (!origin && tabId !== null) origin = await probeTabOrigin(tabId);
  return { tabId, origin };
}

function declarationEvidence(
  applicationId: string,
  item: DeclarationReviewItem,
  event: {
    eventType: RecordDeclarationEvidenceRequest["eventType"];
    actionOrigin: RecordDeclarationEvidenceRequest["actionOrigin"];
    operationId?: string | null;
    executionStatus?: RecordDeclarationEvidenceRequest["executionStatus"];
    verificationStatus?: RecordDeclarationEvidenceRequest["verificationStatus"];
    failureCode?: RecordDeclarationEvidenceRequest["failureCode"];
    candidateModified?: boolean;
    finalReviewState?: RecordDeclarationEvidenceRequest["finalReviewState"];
    checkpointId?: string | null;
  }
): RecordDeclarationEvidenceRequest {
  return RecordDeclarationEvidenceRequestSchema.parse({
    schemaVersion: 1, requestId: crypto.randomUUID(), evidenceEventId: crypto.randomUUID(), applicationId,
    applicationRunId: item.applicationRunId, pageInstanceId: item.pageInstanceId,
    formInstanceId: item.formInstanceId, fieldRuntimeId: item.fieldRuntimeId,
    controlFingerprint: item.controlFingerprint, descriptorFingerprint: item.descriptorFingerprint,
    graphGuard: item.graphGuard, declarationType: item.declarationType,
    semanticConfidence: item.semanticConfidence, policyVersion: item.policyVersion,
    policyDecision: item.policyDecision, decisionFingerprint: item.decisionFingerprint,
    eventType: event.eventType, actionOrigin: event.actionOrigin, operationId: event.operationId ?? null,
    executionStatus: event.executionStatus ?? null, verificationStatus: event.verificationStatus ?? null,
    failureCode: event.failureCode ?? null, required: item.required,
    candidateModified: event.candidateModified ?? false,
    finalReviewState: event.finalReviewState ?? "NOT_PRESENTED", checkpointId: event.checkpointId ?? null,
    occurredAt: new Date().toISOString(), valuePrivate: true, containsCandidateValue: false
  });
}

function declarationReceiptEvent(receipt: ExecutionReceipt, item: DeclarationReviewItem) {
  const declaredFailure = DeclarationFailureCodeSchema.safeParse(receipt.failureClass);
  if (receipt.verificationStatus === "USER_MODIFIED") return {
    eventType: "CANDIDATE_MODIFIED" as const, actionOrigin: "CANDIDATE" as const,
    operationId: receipt.operationId, executionStatus: receipt.status, verificationStatus: receipt.verificationStatus,
    failureCode: "DECLARATION_MODIFIED_BY_USER" as const, candidateModified: true
  };
  if (receipt.status === "VERIFIED") return {
    eventType: item.policyDecision === "AUTO_ALLOWED" ? "AUTO_INTERACTED" as const : "PREPARED" as const,
    actionOrigin: "COPILOT" as const, operationId: receipt.operationId,
    executionStatus: receipt.status, verificationStatus: receipt.verificationStatus, failureCode: null
  };
  return {
    eventType: receipt.failureClass === "DECLARATION_VERIFICATION_FAILED" ? "VERIFICATION_FAILED" as const : "EXECUTION_FAILED" as const,
    actionOrigin: "COPILOT" as const, operationId: receipt.operationId,
    executionStatus: receipt.status, verificationStatus: receipt.verificationStatus,
    failureCode: declaredFailure.success ? declaredFailure.data : "DECLARATION_EXECUTION_FAILED" as const
  };
}

export class BackgroundMessageRouter {
  constructor(private readonly dependencies: RouterDependencies) {}
  private outcomeRequests = 0;
  private reportOutcome(record: RuntimeRecord, stage: AutofillOutcome["stage"], code: AutofillOutcome["code"]): void {
    if (!record.identity.applicationId || !record.identity.applicationRunId || (!this.dependencies.delivery && this.outcomeRequests >= 3)) return;
    this.outcomeRequests++;
    // Best effort and bounded; diagnostics must never hold up a form or replace its error.
    const event: AutofillOutcome = { schemaVersion: 1, eventId: crypto.randomUUID(), applicationId: record.identity.applicationId!, applicationRunId: record.identity.applicationRunId!, questionId: null, stage, code, release: "ADAPTIVE_CHECKPOINT_4", containsCandidateValue: false };
    void Promise.resolve().then(async () => {
      if (this.dependencies.delivery) { await this.dependencies.delivery.enqueueOutcome(event); void this.dependencies.delivery.flush(); }
      else await this.dependencies.api.recordOutcome(event);
    }).catch(() => undefined).finally(() => { this.outcomeRequests--; });
  }

  private async preferredRuntime(tabId: number, requireApplicationRun = false): Promise<RuntimeRecord | null> {
    const records = (await this.dependencies.runtimes.recordsForTab(tabId))
      .filter((record) => !requireApplicationRun || Boolean(record.identity.applicationRunId));
    const quality = (record: RuntimeRecord) =>
      (record.lastIntelligence?.answerAvailable ?? 0) * 1_000_000
      + (record.lastScan?.fieldCount ?? 0) * 1_000
      + (record.identity.frameId === 0 ? 1 : 0);
    return records.sort((left, right) =>
      quality(right) - quality(left)
      || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      || left.identity.frameId - right.identity.frameId
    )[0] ?? null;
  }

  async handle(raw: unknown, sender: chrome.runtime.MessageSender): Promise<ExtensionResponse> {
    const parsed = ExtensionRequestSchema.safeParse(raw);
    const correlationId = parsed.success ? parsed.data.messageId : null;
    if (!parsed.success) return createResponse("ERROR_RESPONSE", correlationId, { failure: failure("MESSAGE_SCHEMA_INVALID", "The extension rejected a malformed message.") });
    try {
      assertSource(parsed.data, sender);
      // Inbox writes are acknowledged only after server persistence; server owns item replay.
      if (!["CONTENT_INBOX_CAPTURE", "UI_DELIVERY_STATUS"].includes(parsed.data.type) && !(await this.dependencies.receipts.claim(parsed.data.messageId))) return createResponse("ACK", parsed.data.messageId, { accepted: true });
      return await this.dispatch(parsed.data, sender);
    } catch (reason) {
      return createResponse("ERROR_RESPONSE", correlationId, { failure: safeFailure(reason, correlationId) });
    }
  }

  private async runtimeStatus(tabId: number | null, frameId = 0, activeOrigin: string | null = null): Promise<RuntimeStatus> {
    let record = tabId === null ? null : await this.dependencies.runtimes.record(tabId, frameId);
    const origin = activeOrigin ?? record?.origin ?? null;
    const web = Boolean(origin && this.dependencies.config.webOrigins.includes(origin));
    const websiteSurface = web && !record?.identity.applicationKey && !record?.pendingSubmitAt && !record?.lastLearning;
    if (websiteSurface) record = null;
    const siteAccess = !origin || websiteSurface ? "NOT_APPLICABLE" : web || await this.dependencies.sites.has(exactOriginPattern(origin)) ? "GRANTED" : "REQUIRED";
    if (!record && tabId !== null && origin && !web && siteAccess === "GRANTED") {
      await this.dependencies.sites.injectExistingTab(tabId, origin).catch(() => undefined);
      for (let attempt = 0; attempt < 20 && !record; attempt += 1) {
        await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 75));
        record = await this.dependencies.runtimes.record(tabId, frameId);
      }
    }
    return this.dependencies.runtimes.status(record, await this.dependencies.auth.state(), siteAccess, origin);
  }

  private async dispatch(request: ExtensionRequest, sender: chrome.runtime.MessageSender): Promise<ExtensionResponse> {
    if (request.type === "UI_DELIVERY_STATUS" || request.type === "UI_DELIVERY_DISCARD") {
      if (!this.dependencies.delivery) throw new ExtensionRuntimeError(failure("PHASE_NOT_AVAILABLE", "Delivery status is unavailable. Reload the extension."));
      if (request.type === "UI_DELIVERY_DISCARD") await this.dependencies.delivery.discardPending();
      return createResponse("DELIVERY_STATUS", request.messageId, await this.dependencies.delivery.summary());
    }
    if (request.type === "CONTENT_AUTOFILL_PROGRESS") {
      const identity = frame(sender);
      await this.dependencies.runtimes.recordProgress(identity.tabId, identity.frameId, request.payload);
      return createResponse("ACK", request.messageId, { accepted: true });
    }
    if (request.type === "UI_FOCUS_FIELD" || request.type === "UI_AUTOFILL_CONTROL") {
      const active = await activeEmployerTab();
      const record = active.tabId === null ? null : (await this.dependencies.runtimes.recordsForTab(active.tabId)).find((item) => item.identity.pageInstanceId === request.payload.pageInstanceId);
      if (!record?.identity.applicationKey) throw new Error("STALE_FIELD_RUNTIME");
      await this.assertCurrentContentVersion(record.identity.tabId, record.identity.frameId, record.contentVersion, request.messageId);
      await this.runUserContentCommand(record.identity.tabId, record.identity.frameId, { protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: request.messageId, sentAt: new Date().toISOString(), source: "BACKGROUND", dataClass: "STRUCTURAL",
        ...(request.type === "UI_FOCUS_FIELD" ? { type: "BACKGROUND_FOCUS_FIELD" as const, payload: request.payload } : { type: "BACKGROUND_AUTOFILL_CONTROL" as const, payload: request.payload }) });
      return createResponse("ACK", request.messageId, { accepted: true });
    }
    if (request.type === "CONTENT_HELLO" || request.type === "CONTENT_PAGE_CHANGED") {
      const identity = frame(sender);
      if (identity.frameId === 0) await setApplicationPanel(identity.tabId, Boolean(request.payload.applicationKey) && !this.dependencies.config.webOrigins.includes(request.payload.origin)).catch(() => undefined);
      else if (request.payload.applicationKey && !this.dependencies.config.webOrigins.includes(originFromTabUrl(sender.tab?.url) ?? request.payload.origin)) await setApplicationPanel(identity.tabId, true).catch(() => undefined);
      const previous = await this.dependencies.runtimes.record(identity.tabId, identity.frameId);
      if (this.dependencies.config.webOrigins.includes(request.payload.origin) && !request.payload.applicationKey && !previous?.pendingSubmitAt && !previous?.lastLearning) {
        await this.dependencies.runtimes.removeFrame(identity.tabId, identity.frameId);
        return createResponse("CONTENT_REGISTERED", request.messageId, {
          status: this.dependencies.runtimes.status(null, await this.dependencies.auth.state(), "NOT_APPLICABLE", request.payload.origin)
        });
      }
      const record = await this.dependencies.runtimes.register({
        ...identity,
        pageInstanceId: request.payload.pageInstanceId,
        applicationKey: request.payload.applicationKey,
        origin: request.payload.origin,
        pathHash: request.payload.pathHash,
        contentVersion: request.payload.extensionVersion
      });
      return createResponse("CONTENT_REGISTERED", request.messageId, { status: this.dependencies.runtimes.status(record, await this.dependencies.auth.state(), "GRANTED") });
    }
    if (request.type === "CONTENT_JOURNEY") {
      const identity = frame(sender);
      const record = await this.dependencies.runtimes.record(identity.tabId, identity.frameId);
      if (!record || record.origin !== originFromTabUrl(sender.url)) throw new ExtensionRuntimeError(failure("MESSAGE_SOURCE_INVALID", "Journey frame changed."));
      const updated = await this.dependencies.runtimes.recordJourney(identity.tabId, identity.frameId, request.payload.pageInstanceId, request.payload.evidence, request.payload.action, request.payload.targetOrigin);
      return createResponse("STATUS_RESPONSE", request.messageId, { status: this.dependencies.runtimes.status(updated, await this.dependencies.auth.state(), "GRANTED") });
    }
    if (request.type === "CONTENT_SCAN_RESULT") {
      const identity = frame(sender);
      const senderOrigin = originFromTabUrl(sender.url);
      const existing = await this.dependencies.runtimes.record(identity.tabId, identity.frameId);
      if (senderOrigin && this.dependencies.config.webOrigins.includes(senderOrigin) && !existing?.identity.applicationKey) {
        return createResponse("STATUS_RESPONSE", request.messageId, {
          status: this.dependencies.runtimes.status(null, await this.dependencies.auth.state(), "NOT_APPLICABLE", senderOrigin)
        });
      }
      let record = await this.dependencies.runtimes.recordScan(identity.tabId, identity.frameId, request.payload);
      if ((await this.dependencies.auth.state()) === "READY") {
        try {
          await this.assertCurrentContentVersion(identity.tabId, identity.frameId, record.contentVersion, request.messageId);
          if (!record.identity.applicationKey) return createResponse("STATUS_RESPONSE", request.messageId, { status: this.dependencies.runtimes.status(record, "READY", "NOT_APPLICABLE") });
          if (!record.identity.applicationId && !this.dependencies.config.webOrigins.includes(record.origin)) {
            const run = await this.dependencies.api.startLearningRun({ schemaVersion: 1, requestId: crypto.randomUUID(), jobId: record.pendingJobId, targetUrl: sender.tab?.url ?? sender.url!, extensionVersion: __JH_EXTENSION_VERSION__, protocolVersion: 1 }, `detected:${record.identity.tabSessionId}:${record.identity.applicationKey}`);
            record = await this.dependencies.runtimes.bindRun(identity.tabId, identity.frameId, record.identity.pageInstanceId, run.applicationId, run.applicationRunId);
          }
          const fields = request.payload.fields.map((candidate) => {
            const { schemaVersion, ...field } = candidate;
            if (schemaVersion !== 2) throw new Error("STALE_FIELD_RUNTIME");
            return field;
          });
          const intelligence = await this.dependencies.api.resolveFields({
            schemaVersion: 1,
            requestId: crypto.randomUUID(),
            applicationRunId: record.identity.applicationRunId,
            pageContext: {
              host: request.payload.pageContext.host,
              ats: request.payload.pageContext.ats,
              pageHeading: request.payload.pageContext.pageHeading,
              jobId: record.pendingJobId,
              applicationId: record.identity.applicationId,
              countryCode: null,
              roleFamily: null,
              companyId: null
            },
            fields
          });
          record = await this.dependencies.runtimes.recordIntelligence(identity.tabId, identity.frameId, intelligence, request.payload.pageInstanceId);
          await chrome.tabs.sendMessage(identity.tabId, {
            protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: request.messageId,
            sentAt: new Date().toISOString(), source: "BACKGROUND", type: "BACKGROUND_INTELLIGENCE_UPDATE",
            dataClass: "STRUCTURAL", payload: intelligence
          }, { frameId: identity.frameId }).catch(() => undefined);
        } catch (reason) {
          const current = await this.dependencies.runtimes.record(identity.tabId, identity.frameId);
          if (current?.identity.pageInstanceId !== request.payload.pageInstanceId) return createResponse("STATUS_RESPONSE", request.messageId, { status: this.dependencies.runtimes.status(current, await this.dependencies.auth.state(), "GRANTED") });
          const currentFailure = safeFailure(reason);
          this.reportOutcome(record, "RESOLVE", currentFailure.code === "API_TIMEOUT" ? "API_TIMEOUT" : "API_UNAVAILABLE");
          record = await this.dependencies.runtimes.recordFailure(identity.tabId, identity.frameId, currentFailure);
          await this.dependencies.telemetry.append([{
            schemaVersion: 1, telemetryId: crypto.randomUUID(), eventType: "BACKEND_UNAVAILABLE",
            occurredAt: new Date().toISOString(), applicationRunId: record.identity.applicationRunId,
            pageInstanceId: record.identity.pageInstanceId, fieldRuntimeId: null, operationId: request.messageId,
            outcome: currentFailure.code, durationMs: null, metadata: { retryable: currentFailure.retryable },
            valuePrivate: true, containsCandidateValue: false
          }]);
        }
      }
      return createResponse("STATUS_RESPONSE", request.messageId, { status: this.dependencies.runtimes.status(record, await this.dependencies.auth.state(), "GRANTED") });
    }
    if (request.type === "CONTENT_EXECUTION_PLAN_REQUEST") {
      const identity = frame(sender);
      const record = await this.dependencies.runtimes.record(identity.tabId, identity.frameId);
      if (!record || record.identity.pageInstanceId !== request.payload.pageInstanceId || record.identity.applicationRunId !== request.payload.intelligence.applicationRunId) {
        throw new ExtensionRuntimeError(failure("FIELD_STALE", "This form changed before Copilot could prepare it.", { category: "STALE", retryable: true }));
      }
      if (await this.dependencies.auth.state() !== "READY") throw new ExtensionRuntimeError(failure("AUTH_EXPIRED", "Reconnect Job Hunter before filling this form.", { category: "AUTHORIZATION" }));
      const plan = await this.dependencies.api.planExecution({
        ...request.payload,
        intelligence: {
          ...request.payload.intelligence,
          pageContext: { ...request.payload.intelligence.pageContext, jobId: record.pendingJobId }
        }
      }).catch((reason: unknown) => { this.reportOutcome(record, "PLAN", safeFailure(reason).code === "API_TIMEOUT" ? "API_TIMEOUT" : "API_UNAVAILABLE"); throw reason; });
      if (plan.operations.length === 0 && plan.skipped.some((field) => !["ALREADY_COMPLETED", "CONDITION_NOT_APPLICABLE"].includes(field.reason))) this.reportOutcome(record, "PLAN", "NO_SAFE_OPERATION");
      if (plan.applicationRunId !== record.identity.applicationRunId || plan.pageInstanceId !== record.identity.pageInstanceId) {
        throw new ExtensionRuntimeError(failure("FIELD_STALE", "The execution plan no longer matches this form.", { category: "STALE" }));
      }
      await this.dependencies.runtimes.recordDeclarationPlan(identity.tabId, identity.frameId, plan);
      return createResponse("EXECUTION_PLAN_RESPONSE", request.messageId, plan);
    }
    if (request.type === "CONTENT_EXECUTION_RESULT") {
      const identity = frame(sender);
      const active = await this.dependencies.runtimes.record(identity.tabId, identity.frameId);
      if (!active || active.identity.applicationRunId !== request.payload.applicationRunId) {
        throw new ExtensionRuntimeError(failure("FIELD_STALE", "Execution evidence belongs to a stale application run.", { category: "STALE" }));
      }
      if (active.identity.applicationId) {
        for (const receipt of request.payload.receipts) {
          if (receipt.document) {
            await this.dependencies.api.recordDocumentUploadEvidence({
              schemaVersion: 1,
              requestId: crypto.randomUUID(),
              applicationId: active.identity.applicationId,
              applicationRunId: active.identity.applicationRunId,
              operationId: receipt.operationId,
              selectionId: receipt.document.selectionId,
              documentId: receipt.document.documentId,
              fieldKey: receipt.fieldRuntimeId,
              outcome: receipt.status === "VERIFIED" ? "VERIFIED" : receipt.status === "SKIPPED" ? "SKIPPED" : "FAILED",
              reasonCode: receipt.status === "VERIFIED" ? "DOCUMENT_UPLOAD_VERIFIED" : receipt.failureClass ?? "DOCUMENT_UPLOAD_TO_ATS_FAILED",
              observedFileCount: receipt.document.observedFileCount,
              valuePrivate: true,
              containsCandidateValue: false
            });
          } else if (receipt.declaration) {
            const item = active.declarations.find((candidate) => candidate.decisionFingerprint === receipt.declaration?.decisionFingerprint);
            if (!item) throw new ExtensionRuntimeError(failure("FIELD_STALE", "Declaration evidence no longer matches the active policy decision.", { category: "STALE" }));
            await this.dependencies.api.recordDeclarationEvidence(declarationEvidence(
              active.identity.applicationId,
              item,
              declarationReceiptEvent(receipt, item)
            ));
          } else {
            await this.dependencies.api.recordExecutionEvidence({
              schemaVersion: 1,
              requestId: crypto.randomUUID(),
              applicationId: active.identity.applicationId,
              applicationRunId: active.identity.applicationRunId,
              receipt
            });
          }
        }
      }
      const record = await this.dependencies.runtimes.recordExecution(identity.tabId, identity.frameId, request.payload);
      return createResponse("STATUS_RESPONSE", request.messageId, { status: this.dependencies.runtimes.status(record, await this.dependencies.auth.state(), "GRANTED") });
    }
    if (request.type === "CONTENT_DECLARATION_EVIDENCE") {
      const identity = frame(sender);
      const active = await this.dependencies.runtimes.record(identity.tabId, identity.frameId);
      const item = active?.declarations.find((candidate) => candidate.decisionFingerprint === request.payload.decisionFingerprint);
      if (!active?.identity.applicationId || !active.identity.applicationRunId || !item
          || request.payload.applicationId !== active.identity.applicationId
          || request.payload.applicationRunId !== active.identity.applicationRunId
          || request.payload.pageInstanceId !== active.identity.pageInstanceId
          || request.payload.fieldRuntimeId !== item.fieldRuntimeId
          || request.payload.controlFingerprint !== item.controlFingerprint
          || request.payload.descriptorFingerprint !== item.descriptorFingerprint
          || request.payload.graphGuard.graphFingerprint !== item.graphGuard.graphFingerprint) {
        throw new ExtensionRuntimeError(failure("FIELD_STALE", "Declaration evidence no longer matches the active application decision.", { category: "STALE" }));
      }
      await this.dependencies.api.recordDeclarationEvidence(request.payload);
      await this.dependencies.runtimes.recordDeclarationCandidateAction(
        identity.tabId, identity.frameId, request.payload.decisionFingerprint, request.payload.candidateModified
      );
      return createResponse("ACK", request.messageId, { accepted: true });
    }
    if (request.type === "CONTENT_LEARNING_OBSERVATION") {
      const identity = frame(sender);
      const active = await this.dependencies.runtimes.record(identity.tabId, identity.frameId);
      if (!active?.identity.applicationId || !active.identity.applicationRunId ||
          request.payload.applicationId !== active.identity.applicationId ||
          request.payload.applicationRunId !== active.identity.applicationRunId ||
          request.payload.pageInstanceId !== active.identity.pageInstanceId) {
        throw new ExtensionRuntimeError(failure("FIELD_STALE", "The candidate answer belongs to a stale application page.", { category: "STALE" }));
      }
      await this.dependencies.api.recordLearningObservation(request.payload);
      return createResponse("ACK", request.messageId, { accepted: true });
    }
    if (request.type === "CONTENT_INBOX_CAPTURE") {
      const identity = frame(sender);
      const active = await this.dependencies.runtimes.record(identity.tabId, identity.frameId);
      const capture = request.payload.capture;
      if (!active?.identity.applicationId || active.identity.applicationId !== capture.applicationId || active.identity.applicationRunId !== capture.applicationRunId || active.identity.pageInstanceId !== request.payload.pageInstanceId) {
        throw new ExtensionRuntimeError(failure("FIELD_STALE", "This pending answer belongs to a different application page.", { category: "STALE" }));
      }
      if (this.dependencies.delivery && request.payload.allowSessionRetry === true) {
        const queued = await this.dependencies.delivery.enqueueNote(capture);
        if (queued.state === "REJECTED") throw new ExtensionRuntimeError(failure("API_UNAVAILABLE", "This note could not be delivered. Review delivery status; it has not been saved."));
        void this.dependencies.delivery.flush();
        return createResponse("ACK", request.messageId, { accepted: true, delivery: queued.state });
      }
      const saved = await this.dependencies.api.captureInbox(capture);
      if (saved.status !== "PENDING") throw new ExtensionRuntimeError(failure("FIELD_STALE", "This note was deleted or expired. Edit the answer before saving a new note.", { category: "STALE" }));
      return createResponse("ACK", request.messageId, { accepted: true, delivery: "DELIVERED" });
    }
    if (request.type === "CONTENT_SUBMIT_ATTEMPT") {
      const identity = frame(sender);
      const active = await this.dependencies.runtimes.record(identity.tabId, identity.frameId);
      if (!active?.identity.applicationId ||
          request.payload.applicationId !== active.identity.applicationId ||
          request.payload.applicationRunId !== active.identity.applicationRunId ||
          request.payload.pageInstanceId !== active.identity.pageInstanceId) {
        throw new ExtensionRuntimeError(failure("FIELD_STALE", "The submit attempt belongs to a stale application page.", { category: "STALE" }));
      }
      await this.dependencies.api.recordSubmitAttempt(request.payload);
      const record = await this.dependencies.runtimes.recordSubmitAttempt(identity.tabId, identity.frameId, request.payload.occurredAt);
      return createResponse("STATUS_RESPONSE", request.messageId, { status: this.dependencies.runtimes.status(record, await this.dependencies.auth.state(), "GRANTED") });
    }
    if (request.type === "CONTENT_SUBMISSION_SIGNAL") {
      const identity = frame(sender);
      const active = await this.dependencies.runtimes.record(identity.tabId, identity.frameId);
      if (!active?.identity.applicationId || !active.pendingSubmitAt ||
          request.payload.applicationId !== active.identity.applicationId ||
          request.payload.applicationRunId !== active.identity.applicationRunId ||
          request.payload.signal.pageInstanceId !== active.identity.pageInstanceId ||
          request.payload.signal.trustedSubmitObservedAt !== active.pendingSubmitAt) {
        throw new ExtensionRuntimeError(failure("FIELD_STALE", "The submission signal is not bound to the active submit attempt.", { category: "STALE" }));
      }
      const learned = await this.dependencies.api.verifyLearningCheckpoint(request.payload);
      if (learned.checkpointStatus === "VERIFIED" && active.identity.applicationId) {
        for (const item of active.declarations) {
          await this.dependencies.api.recordDeclarationEvidence(declarationEvidence(active.identity.applicationId, item, {
            eventType: "SUBMISSION_VERIFIED", actionOrigin: "SYSTEM",
            finalReviewState: "SUBMISSION_VERIFIED", checkpointId: learned.checkpointId
          }));
        }
      }
      const record = await this.dependencies.runtimes.recordLearning(identity.tabId, identity.frameId, learned);
      return createResponse("STATUS_RESPONSE", request.messageId, { status: this.dependencies.runtimes.status(record, await this.dependencies.auth.state(), "GRANTED") });
    }
    if (request.type === "CONTENT_TELEMETRY_BATCH") {
      await this.dependencies.telemetry.append(request.payload.events);
      return createResponse("ACK", request.messageId, { accepted: true });
    }
    if (request.type === "CONTENT_RUNTIME_ERROR") {
      const identity = frame(sender);
      const senderOrigin = originFromTabUrl(sender.url);
      const existing = await this.dependencies.runtimes.record(identity.tabId, identity.frameId);
      if (!senderOrigin || !this.dependencies.config.webOrigins.includes(senderOrigin) || existing?.identity.applicationKey) {
        await this.dependencies.runtimes.recordFailure(identity.tabId, identity.frameId, request.payload.failure);
      }
      return createResponse("ACK", request.messageId, { accepted: true });
    }
    if (request.type === "WEB_SESSION_OFFER") {
      if (!this.dependencies.config.webOrigins.includes(request.payload.websiteOrigin)) throw new ExtensionRuntimeError(failure("MESSAGE_SOURCE_INVALID", "This website cannot connect an extension session.", { category: "AUTHORIZATION" }));
      await this.dependencies.auth.offer(request.payload.accessToken);
      try {
        const session = await this.dependencies.api.session();
        await this.dependencies.auth.mark(session.candidate?.id ? "READY" : "AUTHENTICATED_NO_CANDIDATE");
        if (this.dependencies.delivery) void this.dependencies.delivery.flush();
      } catch (reason) {
        const currentFailure = safeFailure(reason);
        if (currentFailure.code === "AUTH_EXPIRED") await this.dependencies.auth.clear("SESSION_EXPIRED");
        else if (currentFailure.code === "EXTENSION_UPDATE_REQUIRED") await this.dependencies.auth.mark("EXTENSION_UPDATE_REQUIRED");
        else await this.dependencies.auth.mark("BACKEND_UNAVAILABLE");
        return createResponse("ERROR_RESPONSE", request.messageId, { failure: currentFailure });
      }
      const identity = frame(sender);
      // A first scan can precede login. Resume other application runtimes after
      // the session becomes ready; do not depend on another DOM mutation.
      for (const record of await this.dependencies.runtimes.allRecords()) if (record.identity.applicationKey && record.identity.tabId !== identity.tabId) {
        void chrome.tabs.sendMessage(record.identity.tabId, { protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: request.messageId, sentAt: new Date().toISOString(), source: "BACKGROUND", type: "BACKGROUND_SCAN_REQUEST", dataClass: "STRUCTURAL", payload: { reason: "RECOVERY" } }, { frameId: record.identity.frameId }).catch(() => undefined);
      }
      return createResponse("STATUS_RESPONSE", request.messageId, { status: await this.runtimeStatus(identity.tabId, identity.frameId, request.payload.websiteOrigin) });
    }
    if (request.type === "WEB_STATUS_REQUEST") {
      const identity = frame(sender);
      return createResponse("STATUS_RESPONSE", request.messageId, { status: await this.runtimeStatus(identity.tabId, identity.frameId, request.payload.websiteOrigin) });
    }
    if (request.type === "WEB_LAUNCH_REQUEST") {
      if (!this.dependencies.config.webOrigins.includes(request.payload.websiteOrigin)) throw new ExtensionRuntimeError(failure("MESSAGE_SOURCE_INVALID", "This website cannot launch Copilot.", { category: "AUTHORIZATION" }));
      if (await this.dependencies.auth.state() !== "READY") throw new ExtensionRuntimeError(failure("AUTH_EXPIRED", "Reconnect Job Hunter before opening an application.", { category: "AUTHORIZATION" }));
      const target = new URL(request.payload.applicationUrl);
      const pattern = exactOriginPattern(target.origin);
      const permitted = await this.dependencies.sites.has(pattern);
      const learningRun = await this.dependencies.api.startLearningRun({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        jobId: request.payload.jobId,
        targetUrl: target.href,
        extensionVersion: __JH_EXTENSION_VERSION__,
        protocolVersion: 1
      }, `launch:${request.messageId}`);
      const tab = await chrome.tabs.create({ url: target.href, active: true, windowId: sender.tab?.windowId });
      if (tab.id === undefined) throw new ExtensionRuntimeError(failure("INTERNAL_FAILURE", "The application tab could not be opened.", { retryable: true }));
      await this.dependencies.runtimes.prepareLaunch(tab.id, request.payload.jobId, target.origin, learningRun.applicationId, learningRun.applicationRunId);
      await groupApplicationTabs(sender.tab?.id, tab.id).catch(() => undefined);
      await chrome.sidePanel.setOptions({ tabId: tab.id, path: "sidepanel.html", enabled: true }).catch(() => undefined);
      if (chrome.sidePanel?.open) {
        await chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
      }
      if (permitted) {
        await this.dependencies.sites.register(pattern).catch(() => undefined);
        await this.dependencies.sites.injectExistingTab(tab.id, target.origin).catch(() => undefined);
      }
      return createResponse("LAUNCH_RESPONSE", request.messageId, {
        state: permitted ? "READY_TO_LAUNCH" : "PERMISSION_REQUIRED",
        originPattern: pattern,
        tabId: tab.id
      });
    }
    if (request.type === "UI_CANDIDATE_PANEL_REQUEST") {
      return createResponse("CANDIDATE_PANEL_RESPONSE", request.messageId, await this.dependencies.api.candidatePanel(request.payload.panel));
    }
    if (request.type === "UI_STATUS_REQUEST") {
      const active = await activeEmployerTab();
      const record = active.tabId === null ? null : await this.preferredRuntime(active.tabId);
      return createResponse("STATUS_RESPONSE", request.messageId, {
        status: await this.runtimeStatus(active.tabId, record?.identity.frameId ?? 0, active.origin)
      });
    }
    if (request.type === "UI_DECLARATION_REVIEW_PRESENTED") {
      const activeTab = await activeEmployerTab();
      if (activeTab.tabId === null) throw new ExtensionRuntimeError(failure("APPLICATION_NOT_FOUND", "No active application tab was found.", { category: "UNSUPPORTED" }));
      const active = await this.preferredRuntime(activeTab.tabId, true);
      if (!active?.identity.applicationId) throw new ExtensionRuntimeError(failure("APPLICATION_NOT_FOUND", "No active declaration review was found.", { category: "UNSUPPORTED" }));
      const requested = new Set(request.payload.decisionFingerprints);
      const items = active.declarations.filter((item) => requested.has(item.decisionFingerprint));
      if (items.length !== requested.size) throw new ExtensionRuntimeError(failure("FIELD_STALE", "Declaration review items changed before presentation.", { category: "STALE" }));
      for (const item of items) {
        await this.dependencies.api.recordDeclarationEvidence(declarationEvidence(active.identity.applicationId, item, {
          eventType: "REVIEW_PRESENTED", actionOrigin: "SYSTEM", finalReviewState: "PRESENTED"
        }));
      }
      return createResponse("ACK", request.messageId, { accepted: true });
    }
    if (request.type === "UI_SITE_ACCESS_GRANTED") {
      if (!(await this.dependencies.sites.has(request.payload.originPattern))) throw new ExtensionRuntimeError(failure("PERMISSION_REQUIRED", "Chrome did not grant access to this employer site.", { category: "AUTHORIZATION" }));
      await this.dependencies.sites.register(request.payload.originPattern);
      const active = await activeEmployerTab();
      const record = active.tabId === null ? null : await this.dependencies.runtimes.record(active.tabId, 0);
      const origin = active.origin ?? record?.origin ?? null;
      if (active.tabId !== null && origin && exactOriginPattern(origin) === request.payload.originPattern) {
        await this.dependencies.sites.injectExistingTab(active.tabId, origin).catch(() => undefined);
      }
      return createResponse("ACK", request.messageId, { accepted: true });
    }
    if (request.type === "UI_SCAN_ACTIVE_TAB") {
      const active = await activeEmployerTab();
      if (active.tabId === null) throw new ExtensionRuntimeError(failure("APPLICATION_NOT_FOUND", "No active application tab was found.", { category: "UNSUPPORTED" }));
      const activeRecord = await this.preferredRuntime(active.tabId);
      if (active.origin && this.dependencies.config.webOrigins.includes(active.origin) && !activeRecord?.identity.applicationKey) throw new ExtensionRuntimeError(failure("APPLICATION_NOT_FOUND", "Open an employer application before scanning.", { category: "UNSUPPORTED" }));
      const frameId = activeRecord?.identity.frameId ?? 0;
      if (activeRecord) await this.assertCurrentContentVersion(active.tabId, frameId, activeRecord.contentVersion, request.messageId);
      await this.runUserContentCommand(active.tabId, frameId, { protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: request.messageId, sentAt: new Date().toISOString(), source: "BACKGROUND", type: "BACKGROUND_SCAN_REQUEST", dataClass: "STRUCTURAL", payload: { reason: "MANUAL" } });
      return createResponse("ACK", request.messageId, { accepted: true });
    }
    if (request.type === "UI_EXECUTE_ACTIVE_TAB") {
      const active = await activeEmployerTab();
      if (active.tabId === null) throw new ExtensionRuntimeError(failure("APPLICATION_NOT_FOUND", "No active application tab was found.", { category: "UNSUPPORTED" }));
      if (await this.dependencies.auth.state() !== "READY") throw new ExtensionRuntimeError(failure("AUTH_EXPIRED", "Reconnect Job Hunter before filling this form.", { category: "AUTHORIZATION" }));
      const record = await this.preferredRuntime(active.tabId, true);
      if (active.origin && this.dependencies.config.webOrigins.includes(active.origin) && !record?.identity.applicationKey) throw new ExtensionRuntimeError(failure("APPLICATION_NOT_FOUND", "Open an employer application before filling.", { category: "UNSUPPORTED" }));
      if (!record?.identity.applicationRunId) throw new ExtensionRuntimeError(failure("APPLICATION_NOT_FOUND", "Open a supported employer application first.", { category: "UNSUPPORTED" }));
      const frameId = record.identity.frameId;
      await this.assertCurrentContentVersion(active.tabId, frameId, record.contentVersion, request.messageId);
      if (!(await this.dependencies.sites.has(exactOriginPattern(record.origin)))) throw new ExtensionRuntimeError(failure("PERMISSION_REQUIRED", "Allow Copilot on this employer site first.", { category: "AUTHORIZATION" }));
      await this.runUserContentCommand(active.tabId, frameId, {
        protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: request.messageId,
        sentAt: new Date().toISOString(), source: "BACKGROUND", type: "BACKGROUND_EXECUTE_REQUEST",
        dataClass: "STRUCTURAL", payload: {
          batchId: crypto.randomUUID(), applicationRunId: record.identity.applicationRunId,
          pageInstanceId: record.identity.pageInstanceId
        }
      });
      return createResponse("ACK", request.messageId, { accepted: true });
    }
    if (request.type === "UI_UNDO_LEARNING") {
      const active = await activeEmployerTab();
      if (active.tabId === null) throw new ExtensionRuntimeError(failure("APPLICATION_NOT_FOUND", "No active application tab was found.", { category: "UNSUPPORTED" }));
      const undone = await this.dependencies.api.undoLearningChangeSet(request.payload.changeSetId);
      const activeRecord = await this.preferredRuntime(active.tabId, true);
      const record = await this.dependencies.runtimes.recordLearningUndo(active.tabId, activeRecord?.identity.frameId ?? 0, undone);
      return createResponse("STATUS_RESPONSE", request.messageId, { status: this.dependencies.runtimes.status(record, await this.dependencies.auth.state(), "GRANTED") });
    }
    throw new ExtensionRuntimeError(failure("MESSAGE_SCHEMA_INVALID", "Unsupported extension message."));
  }

  private async assertCurrentContentVersion(tabId: number, frameId: number, contentVersion: string, correlationId: string): Promise<void> {
    if (contentRuntimeVersionMatches(contentVersion, __JH_EXTENSION_VERSION__)) return;
    const currentFailure = failure("EXTENSION_UPDATE_REQUIRED", "Reload the application page to finish updating Job Hunter Copilot.", {
      category: "TECHNICAL",
      retryable: true,
      correlationId,
      metadata: { loadedVersion: contentVersion, expectedVersion: __JH_EXTENSION_VERSION__ }
    });
    await this.dependencies.runtimes.recordFailure(tabId, frameId, currentFailure).catch(() => undefined);
    throw new ExtensionRuntimeError(currentFailure);
  }

  private async runUserContentCommand(tabId: number, frameId: number, command: ContentCommand): Promise<void> {
    await this.dependencies.runtimes.clearFailure(tabId, frameId);
    try {
      const raw: unknown = await chrome.tabs.sendMessage(tabId, command, { frameId });
      const acknowledgement = ContentCommandAckSchema.safeParse(raw);
      if (!acknowledgement.success) {
        throw new ExtensionRuntimeError(failure("MESSAGE_SCHEMA_INVALID", "The application page returned an invalid command result.", {
          retryable: true,
          correlationId: command.correlationId ?? command.messageId
        }));
      }
      if (!acknowledgement.data.accepted) throw new ExtensionRuntimeError(acknowledgement.data.failure);
    } catch (reason) {
      const currentFailure = reason instanceof ExtensionRuntimeError
        ? reason.failure
        : failure("EXTENSION_CONTEXT_INVALIDATED", "Reload the application page, then try again.", {
            retryable: true,
            correlationId: command.correlationId ?? command.messageId
          });
      await this.dependencies.runtimes.recordFailure(tabId, frameId, currentFailure).catch(() => undefined);
      throw new ExtensionRuntimeError(currentFailure);
    }
  }
}

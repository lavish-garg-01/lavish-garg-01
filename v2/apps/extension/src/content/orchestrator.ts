import {
  DeclarationCanonicalKeySchema,
  ExecutionBatchReceiptSchema,
  ExecutionReceiptSchema,
  type ExecutionBatchReceipt,
  type ExecutionAttemptReceipt,
  type ExecutionFailureClass,
  type ExecutionPlanResponse,
  type ExecutionRequest,
  type ExecutionReceipt,
  type FormGraphGuard,
  type VerificationStatus
} from "@job-hunter-v2/contracts";
import { ExecutionStrategyRegistry, FieldExecutionError } from "./executor.js";
import type { FieldOwnershipTracker } from "./ownership.js";
import type { FieldRegistry } from "./scanner.js";
import type { IndependentFieldVerifier } from "./verifier.js";

function structureMarker(): string {
  const controls = [...document.querySelectorAll<HTMLElement>("input:not([type=hidden]),select,textarea,button,[role=combobox],[contenteditable=true]")].slice(0, 1_000);
  return controls.map((element) => [
    element.tagName, element.id, element.getAttribute("name"), element.getAttribute("type"),
    element.hasAttribute("hidden"), element.getAttribute("aria-hidden"), element.matches(":disabled"),
    element.getAttribute("aria-disabled"), element.matches(":required"), element.getAttribute("aria-required"),
    element.getAttribute("aria-expanded"), element.getAttribute("aria-invalid"),
    element instanceof HTMLSelectElement ? element.options.length : 0
  ].join(":" )).join("|");
}

function sameGuard(left: FormGraphGuard | null, right: FormGraphGuard): boolean {
  return Boolean(left && left.pageInstanceId === right.pageInstanceId && left.graphRevision === right.graphRevision && left.graphFingerprint === right.graphFingerprint);
}

interface ControlState { value: string | null; checked: boolean | null; selected: boolean[] | null; text: string | null }
function captureState(element: HTMLElement): ControlState {
  return {
    value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element.value : element.getAttribute("data-value"),
    checked: element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type) ? element.checked : element.hasAttribute("aria-checked") ? element.getAttribute("aria-checked") === "true" : null,
    selected: element instanceof HTMLSelectElement ? [...element.options].map((option) => option.selected) : null,
    text: element.isContentEditable ? element.textContent : null
  };
}
function restoreState(element: HTMLElement, state: ControlState): void {
  if (state.selected && element instanceof HTMLSelectElement) {
    for (let index = 0; index < element.options.length; index += 1) if (element.options[index]) element.options[index]!.selected = state.selected[index] ?? false;
  } else if (state.value !== null && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) element.value = state.value;
  if (state.checked !== null && element instanceof HTMLInputElement) element.checked = state.checked;
  if (state.checked !== null && element.hasAttribute("aria-checked")) element.setAttribute("aria-checked", String(state.checked));
  if (state.text !== null && element.isContentEditable) element.textContent = state.text;
  element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

export class FieldExecutionOrchestrator {
  private readonly activeFields = new Set<string>();
  private readonly completed = new Map<string, { request: string; receipt: ExecutionReceipt }>();

  constructor(
    private readonly registry: FieldRegistry,
    private readonly ownership: FieldOwnershipTracker,
    private readonly verifier: IndependentFieldVerifier,
    private readonly strategies = new ExecutionStrategyRegistry(),
    private readonly currentPageInstanceId: () => string,
    private readonly currentGraphGuard: () => FormGraphGuard | null = () => null,
    private readonly currentSemanticDescriptor: (fieldRuntimeId: string) => string | null = () => null
  ) {}

  async execute(plan: ExecutionPlanResponse, batchId: string, progress?: { shouldContinue: () => boolean; onField: (fieldId: string, status: string) => void }): Promise<ExecutionBatchReceipt> {
    const started = performance.now();
    const receipts = [];
    if (plan.pageInstanceId !== this.currentPageInstanceId() || !sameGuard(this.currentGraphGuard(), plan.graphGuard)) {
      return ExecutionBatchReceiptSchema.parse({
        schemaVersion: 1, batchId, planRequestId: plan.requestId,
        applicationRunId: plan.applicationRunId, pageInstanceId: plan.pageInstanceId,
        status: "ABORTED", receipts: [], skippedCount: plan.skipped.length + plan.operations.length,
        durationMs: Math.round(performance.now() - started), valuePrivate: true, containsCandidateValue: false
      });
    }
    for (const operation of plan.operations) {
      if (progress && !progress.shouldContinue()) break;
      progress?.onField(operation.fieldRuntimeId, "FILLING");
      if (!sameGuard(this.currentGraphGuard(), operation.graphGuard)) {
        receipts.push(this.receipt(operation, [], null, "ABORTED", "STALE_FIELD", "GRAPH_REVISION_STALE", true, false, performance.now()));
        break;
      }
      const identity = JSON.stringify(operation);
      const previous = this.completed.get(operation.operationId);
      const receipt = previous
        ? previous.request === identity ? previous.receipt : this.receipt(operation, [], null, "ABORTED", "UNVERIFIABLE", "RUNTIME_INVALIDATED", false, false, performance.now())
        : await this.executeField(operation);
      if (!previous) {
        if (this.completed.size >= 1000) this.completed.delete(this.completed.keys().next().value!);
        this.completed.set(operation.operationId, { request: identity, receipt });
      }
      receipts.push(receipt);
      progress?.onField(operation.fieldRuntimeId, receipt.status);
      if (receipt.structuralChange) break;
    }
    const verified = receipts.filter((receipt) => receipt.status === "VERIFIED").length;
    const failed = receipts.filter((receipt) => receipt.status === "FAILED").length;
    const aborted = receipts.filter((receipt) => receipt.status === "ABORTED").length;
    const deferred = plan.operations.length - receipts.length;
    const status = deferred > 0 && failed === 0 && aborted === 0 ? "PARTIAL" : failed === 0 && aborted === 0 ? "COMPLETED" : verified > 0 ? "PARTIAL" : aborted > 0 && failed === 0 ? "ABORTED" : "FAILED";
    return ExecutionBatchReceiptSchema.parse({
      schemaVersion: 1, batchId, planRequestId: plan.requestId,
      applicationRunId: plan.applicationRunId, pageInstanceId: plan.pageInstanceId,
        status, receipts, skippedCount: plan.skipped.length + Math.max(0, plan.operations.length - receipts.length),
      durationMs: Math.round(performance.now() - started), valuePrivate: true, containsCandidateValue: false
    });
  }

  private async executeField(request: ExecutionRequest) {
    const started = performance.now();
    const attempts = [];
    let selectedStrategyId: string | null = null;
    let finalStatus: VerificationStatus = "FAILED";
    let finalFailure: ExecutionFailureClass | null = "UNKNOWN_EXECUTION_FAILURE";
    let retryable = false;
    let structuralChange = false;
    const declarationCanonical = DeclarationCanonicalKeySchema.safeParse(request.canonicalKey).success;
    const declarationAuthorization = request.declarationAuthorization;
    if (declarationCanonical && !declarationAuthorization) {
      return this.receipt(request, [], null, "ABORTED", "UNVERIFIABLE", "POLICY_AUTHORIZATION_REQUIRED", false, false, started);
    }
    if (declarationAuthorization) {
      const guard = this.currentGraphGuard();
      const descriptor = this.currentSemanticDescriptor(request.fieldRuntimeId);
      if (
        declarationAuthorization.applicationRunId !== request.applicationRunId
        || declarationAuthorization.pageInstanceId !== request.pageInstanceId
        || declarationAuthorization.formInstanceId !== request.formInstanceId
        || declarationAuthorization.fieldRuntimeId !== request.fieldRuntimeId
        || declarationAuthorization.controlFingerprint !== request.controlFingerprint
        || declarationAuthorization.canonicalKey !== request.canonicalKey
        || descriptor !== declarationAuthorization.descriptorFingerprint
        || !sameGuard(guard, declarationAuthorization.graphGuard)
      ) {
        return this.receipt(request, [], null, "ABORTED", "STALE_FIELD", "DECLARATION_CONTEXT_CHANGED", false, false, started);
      }
    }
    if (this.activeFields.has(request.fieldRuntimeId)) {
      return this.receipt(request, [], null, "ABORTED", "AMBIGUOUS", "RUNTIME_INVALIDATED", false, false, started);
    }
    this.activeFields.add(request.fieldRuntimeId);
    try {
      if (request.pageInstanceId !== this.currentPageInstanceId()) {
        return this.receipt(request, [], null, "ABORTED", "PAGE_TRANSITIONED", declarationAuthorization ? "DECLARATION_CONTEXT_CHANGED" : "PAGE_TRANSITIONED", false, false, started);
      }
      if (!sameGuard(this.currentGraphGuard(), request.graphGuard)) {
        return this.receipt(request, [], null, "ABORTED", "STALE_FIELD", declarationAuthorization ? "DECLARATION_STALE" : "GRAPH_REVISION_STALE", true, false, started);
      }
      let element = this.registry.get(request.fieldRuntimeId);
      if (!element) return this.receipt(request, [], null, "FAILED", "STALE_FIELD", declarationAuthorization ? "DECLARATION_STALE" : "FIELD_STALE", true, false, started);
      if (!this.registry.matches(request.fieldRuntimeId, request.controlFingerprint)) return this.receipt(request, [], null, "FAILED", "STALE_FIELD", declarationAuthorization ? "DECLARATION_STALE" : "FIELD_STALE", false, false, started);
      if (!this.ownership.canAutomate(request.fieldRuntimeId)) return this.receipt(request, [], null, "ABORTED", "USER_MODIFIED", declarationAuthorization ? "DECLARATION_MODIFIED_BY_USER" : "USER_OWNERSHIP", false, false, started);
      const candidates = this.strategies.candidates(element, request).slice(0, request.maximumAttempts);
      if (!candidates.length) return this.receipt(request, [], null, "FAILED", "UNVERIFIABLE", declarationAuthorization ? "DECLARATION_EXECUTION_FAILED" : "STRATEGY_UNSUPPORTED", false, false, started);
      const before = structureMarker();
      for (let index = 0; index < candidates.length; index += 1) {
        const strategy = candidates[index];
        if (!strategy) continue;
        const attemptStarted = performance.now();
        let executionStatus: "EXECUTED" | "FAILED" | "ABORTED" = "FAILED";
        let safetyViolation: ExecutionAttemptReceipt["safetyViolation"] = null;
        let verificationStatus: VerificationStatus = "FAILED";
        let failureClass: ExecutionFailureClass | null = null;
        let attemptRetryable = false;
        const attemptElement = this.registry.get(request.fieldRuntimeId);
        if (!attemptElement) break;
        const initialState = captureState(attemptElement);
        try {
          if (request.pageInstanceId !== this.currentPageInstanceId()) throw new FieldExecutionError("PAGE_TRANSITIONED");
          if (!sameGuard(this.currentGraphGuard(), request.graphGuard)) throw new FieldExecutionError("GRAPH_REVISION_STALE", true);
          element = this.registry.get(request.fieldRuntimeId);
          if (!element) throw new FieldExecutionError("FIELD_DETACHED", true);
          if (!this.registry.matches(request.fieldRuntimeId, request.controlFingerprint)) throw new FieldExecutionError("FIELD_STALE");
          if (!this.ownership.canAutomate(request.fieldRuntimeId)) throw new FieldExecutionError("USER_OWNERSHIP");
          const result = await this.ownership.withCopilotMutation(request.fieldRuntimeId, element, () => this.strategies.execute(
            strategy,
            element as HTMLElement,
            request,
            () => request.pageInstanceId !== this.currentPageInstanceId()
              ? "PAGE_TRANSITIONED"
              : !sameGuard(this.currentGraphGuard(), request.graphGuard) ? "GRAPH_REVISION_STALE"
                : !this.ownership.canAutomate(request.fieldRuntimeId) ? "USER_OWNERSHIP" : null
          ));
          selectedStrategyId = result.strategyId;
          executionStatus = "EXECUTED";
          if (!this.ownership.canAutomate(request.fieldRuntimeId)) {
            verificationStatus = "USER_MODIFIED";
            failureClass = declarationAuthorization ? "DECLARATION_MODIFIED_BY_USER" : "USER_OWNERSHIP";
          } else {
            const verification = await this.verifier.verify(request);
            verificationStatus = this.ownership.canAutomate(request.fieldRuntimeId) ? verification.status : "USER_MODIFIED";
            failureClass = this.ownership.canAutomate(request.fieldRuntimeId)
              ? request.representation.kind === "FILE" && verification.status !== "VERIFIED"
                ? "DOCUMENT_UPLOAD_VERIFICATION_FAILED"
                : verification.failureClass
              : "USER_OWNERSHIP";
          }
          structuralChange = structureMarker() !== before;
          if (verificationStatus === "VERIFIED") {
            finalStatus = verificationStatus; finalFailure = null; retryable = false;
          } else {
            if (declarationAuthorization && failureClass) {
              failureClass = failureClass === "PAGE_TRANSITIONED"
                ? "DECLARATION_CONTEXT_CHANGED"
                : failureClass === "FIELD_DETACHED" || failureClass === "FIELD_STALE" || failureClass === "GRAPH_REVISION_STALE"
                  ? "DECLARATION_STALE"
                  : "DECLARATION_VERIFICATION_FAILED";
            }
            finalStatus = verificationStatus; finalFailure = failureClass; attemptRetryable = failureClass === "VERIFICATION_FAILED"; retryable = attemptRetryable;
          }
        } catch (reason) {
          const failure = reason instanceof FieldExecutionError ? reason : new FieldExecutionError("UNKNOWN_EXECUTION_FAILURE");
          safetyViolation = failure.safetyViolation;
          const mappedFailure = declarationAuthorization
            ? failure.failureClass === "USER_OWNERSHIP"
              ? "DECLARATION_MODIFIED_BY_USER"
              : failure.failureClass === "PAGE_TRANSITIONED"
                ? "DECLARATION_CONTEXT_CHANGED"
                : failure.failureClass === "GRAPH_REVISION_STALE" || failure.failureClass === "FIELD_STALE" || failure.failureClass === "FIELD_DETACHED"
                  ? "DECLARATION_STALE"
                  : failure.failureClass === "VERIFICATION_FAILED"
                    ? "DECLARATION_VERIFICATION_FAILED"
                    : "DECLARATION_EXECUTION_FAILED"
            : request.representation.kind === "FILE"
              && !["USER_OWNERSHIP", "PAGE_TRANSITIONED", "GRAPH_REVISION_STALE", "FIELD_STALE", "FIELD_DETACHED", "REPRESENTATION_INVALID"].includes(failure.failureClass)
              ? "DOCUMENT_UPLOAD_TO_ATS_FAILED"
              : failure.failureClass;
          failureClass = mappedFailure; attemptRetryable = failure.retryable; retryable = failure.retryable;
          verificationStatus = failure.failureClass === "PAGE_TRANSITIONED" ? "PAGE_TRANSITIONED" : failure.failureClass === "USER_OWNERSHIP" ? "USER_MODIFIED" : "FAILED";
          executionStatus = failure.failureClass === "PAGE_TRANSITIONED" || failure.failureClass === "USER_OWNERSHIP" ? "ABORTED" : "FAILED";
          finalStatus = verificationStatus; finalFailure = mappedFailure;
        }
        attempts.push({
          attempt: index + 1, strategyId: strategy.strategyId, capability: strategy.capabilities[0] ?? "UNSUPPORTED",
          executionStatus, verificationStatus, failureClass, safetyViolation,
          durationMs: Math.round(performance.now() - attemptStarted), retryable: attemptRetryable, structuralChange
        });
        if (safetyViolation || finalStatus === "VERIFIED" || finalStatus === "USER_MODIFIED" || finalStatus === "PAGE_TRANSITIONED" || finalFailure === "OPTION_AMBIGUOUS") break;
        const current = this.registry.get(request.fieldRuntimeId);
        if (current && this.ownership.canAutomate(request.fieldRuntimeId) && index + 1 < candidates.length) restoreState(current, initialState);
      }
      const status = finalStatus === "VERIFIED" ? "VERIFIED" : finalStatus === "USER_MODIFIED" || finalStatus === "PAGE_TRANSITIONED" ? "ABORTED" : "FAILED";
      return this.receipt(request, attempts, selectedStrategyId, status, finalStatus, finalFailure, retryable, structuralChange, started);
    } finally {
      this.activeFields.delete(request.fieldRuntimeId);
    }
  }

  private receipt(
    request: ExecutionRequest,
    attempts: ExecutionAttemptReceipt[],
    selectedStrategyId: string | null,
    status: "VERIFIED" | "FAILED" | "SKIPPED" | "ABORTED",
    verificationStatus: VerificationStatus,
    failureClass: ExecutionFailureClass | null,
    retryable: boolean,
    structuralChange: boolean,
    started: number
  ) {
    return ExecutionReceiptSchema.parse({
      schemaVersion: 1, operationId: request.operationId, applicationRunId: request.applicationRunId,
      pageInstanceId: request.pageInstanceId, fieldRuntimeId: request.fieldRuntimeId,
      graphNodeId: request.graphNodeId, graphGuard: request.graphGuard,
      canonicalKey: request.canonicalKey, answerVersionId: failureClass === "POLICY_AUTHORIZATION_REQUIRED" ? null : request.answerVersionId,
      answerScopeFingerprint: failureClass === "POLICY_AUTHORIZATION_REQUIRED" ? null : request.answerScopeFingerprint,
      trialReuse: failureClass === "POLICY_AUTHORIZATION_REQUIRED" ? false : request.trialReuse,
      representationId: request.representation.representationId,
      representationPolicyVersion: request.representation.policyVersion,
      status, verificationStatus, failureClass, selectedStrategyId, attempts,
      verificationEvidence: verificationStatus === "VERIFIED" ? "DOM_READBACK" : "NONE",
      retryable, requiresUserReview: request.authorization === "REVIEW_REQUIRED", structuralChange,
      declaration: request.declarationAuthorization ? {
        canonicalKey: request.declarationAuthorization.canonicalKey,
        declarationType: request.declarationAuthorization.declarationType,
        policyVersion: request.declarationAuthorization.policyVersion,
        policyDecision: request.declarationAuthorization.policyDecision,
        decisionFingerprint: request.declarationAuthorization.decisionFingerprint,
        descriptorFingerprint: request.declarationAuthorization.descriptorFingerprint,
        reviewRequirement: request.declarationAuthorization.reviewRequirement
      } : null,
      document: request.documentAuthority ? {
        ...request.documentAuthority,
        observedFileCount: (() => {
          const element = this.registry.get(request.fieldRuntimeId);
          return element instanceof HTMLInputElement && element.type === "file" ? element.files?.length ?? 0 : null;
        })()
      } : null,
      durationMs: Math.round(performance.now() - started), valuePrivate: true, containsCandidateValue: false
    });
  }
}

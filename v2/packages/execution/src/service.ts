import { candidateAnswerPolicy } from "@job-hunter-v2/candidate-truth";
import {
  ExecutionPlanRequestSchema,
  ExecutionPlanResponseSchema,
  ExecutionPlanSkippedFieldSchema,
  capabilitiesForControl,
  type ExecutionPlanRequest,
  type ExecutionPlanResponse,
  type FieldCapability,
  type FieldEvidenceInput,
  type FormGraphFieldReadiness
} from "@job-hunter-v2/contracts";
import type { FieldIntelligenceService } from "@job-hunter-v2/field-intelligence";
import { DeclarationPolicyService } from "@job-hunter-v2/declaration-policy";
import { safeFormGraphFrontier } from "@job-hunter-v2/form-graph";
import { RepresentationError, RepresentationResolver } from "./representation.js";
import { noticeMakesLastDayInapplicable } from "./conditions.js";

export interface PlanExecutionInput {
  accountId: string;
  candidateId: string;
  request: ExecutionPlanRequest;
}

export interface ApplicationDocumentResolverPort {
  resolve(input: {
    accountId: string; candidateId: string; applicationId: string; applicationRunId: string;
    jobId: string | null; documentKind: "RESUME" | "COVER_LETTER";
  }): Promise<{
    selectionId: string; documentId: string; documentKind: "RESUME" | "COVER_LETTER";
    fileName: string; mimeType: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    byteSize: number; contentSha256: string; bytesBase64: string;
  } | null>;
}

export function capabilityHints(field: FieldEvidenceInput): FieldCapability[] {
  return capabilitiesForControl({...field.locatorEvidence,contentEditable:field.locatorEvidence.contentEditable===true,ariaAutocomplete:field.locatorEvidence.ariaAutocomplete===true,multiple:field.controlType==="MULTISELECT"});
}

function answerSkipReason(reasonCodes: readonly string[]) {
  if (reasonCodes.includes("EQUAL_RANK_NON_EQUIVALENT_ANSWERS")) return "ANSWER_CONFLICT" as const;
  if (reasonCodes.includes("NEEDS_RECONFIRMATION")) return "ANSWER_REVIEW_EXPIRED" as const;
  if (reasonCodes.includes("REQUIRED_SCOPE_CONTEXT_MISSING") || reasonCodes.includes("ENTITY_CONTEXT_REQUIRED")) return "ANSWER_CONTEXT_REQUIRED" as const;
  return "ANSWER_NOT_AVAILABLE" as const;
}

export class ExecutionPlanningService {
  constructor(
    private readonly intelligence: Pick<FieldIntelligenceService, "resolvePrivate">,
    private readonly representations = new RepresentationResolver(),
    private readonly declarations = new DeclarationPolicyService(),
    private readonly documents: ApplicationDocumentResolverPort | null = null
  ) {}

  async plan(input: PlanExecutionInput): Promise<ExecutionPlanResponse> {
    const request = ExecutionPlanRequestSchema.parse(input.request);
    const applicationRunId = request.intelligence.applicationRunId;
    const privateResult = await this.intelligence.resolvePrivate({
      accountId: input.accountId,
      candidateId: input.candidateId,
      request: request.intelligence
    });
    const graphNodeByField = new Map(request.graph.nodes
      .filter((node) => node.nodeType === "FIELD" && node.fieldRuntimeId)
      .map((node) => [node.fieldRuntimeId as string, node]));
    const declarationByField = new Map<string, Awaited<ReturnType<DeclarationPolicyService["evaluate"]>>>();
    const declarationItems: ExecutionPlanResponse["declarations"] = [];
    for (let index = 0; index < privateResult.items.length; index += 1) {
      const item = privateResult.items[index];
      const field = request.intelligence.fields[index];
      if (!item || !field || item.semantic.declarationHint.state === "NOT_DECLARATION") continue;
      const graphNode = graphNodeByField.get(field.fieldRuntimeId);
      if (!graphNode) continue;
      const evaluated = await this.declarations.evaluate({
        accountId: input.accountId,
        candidateId: input.candidateId,
        context: {
          schemaVersion: 1,
          applicationId: privateResult.pageContext.applicationId,
          applicationRunId,
          pageInstanceId: request.pageInstanceId,
          formInstanceId: field.formInstanceId,
          fieldRuntimeId: field.fieldRuntimeId,
          controlFingerprint: field.controlFingerprint,
          graphGuard: {
            pageInstanceId: request.graph.pageInstanceId,
            graphRevision: request.graph.graphRevision,
            graphFingerprint: request.graph.graphFingerprint
          },
          semantic: {
            state: item.semantic.state,
            canonicalKey: item.semantic.canonicalKey,
            confidence: item.semantic.confidence,
            descriptorFingerprint: item.semantic.descriptorFingerprint,
            declarationHint: item.semantic.declarationHint
          },
          controlType: field.controlType,
          required: field.required,
          disabled: field.disabled,
          visible: graphNode.visible,
          enabled: graphNode.enabled,
          currentStep: graphNode.currentStep,
          ownership: field.ownership,
          materialTermsInspectable: item.semantic.declarationHint.textEvidence === "FULL",
          finalReviewGuaranteed: true,
          valuePrivate: true,
          containsCandidateValue: false
        }
      });
      declarationByField.set(field.fieldRuntimeId, evaluated);
      declarationItems.push(evaluated.reviewItem);
    }
    const noticeAnswer = privateResult.items.find((item) => item.semantic.canonicalKey === "NOTICE_PERIOD")?.answerResolution;
    const noticeDays = noticeAnswer?.status === "RESOLVED" && noticeAnswer.normalizedValue.kind === "INTEGER" ? noticeAnswer.normalizedValue.value : privateResult.noticePeriodDays ?? null;
    const inapplicableFields = new Set(request.intelligence.fields.filter((field, index) =>
      noticeMakesLastDayInapplicable(privateResult.items[index]?.semantic.canonicalKey ?? null,
        field.labelEvidence, noticeDays)).map((field) => field.fieldRuntimeId));
    const readiness: FormGraphFieldReadiness[] = request.intelligence.fields.flatMap((field, index) => {
      const graphNode = graphNodeByField.get(field.fieldRuntimeId);
      const item = privateResult.items[index];
      if (!graphNode || !item) return [];
      const canonicalKey = item.semantic.canonicalKey;
      const repeated = Boolean(field.repeatableEvidence.formGroup);
      const declaration = declarationByField.get(field.fieldRuntimeId);
      const policy = canonicalKey && !declaration ? candidateAnswerPolicy(canonicalKey) : null;
      const documentField = field.controlType === "FILE" && (canonicalKey === "RESUME" || canonicalKey === "COVER_LETTER");
      return [{
        graphNodeId: graphNode.graphNodeId,
        semanticSafe: declaration
          ? item.semantic.state === "RESOLVED_HIGH" && declaration.decision.classification.declarationType !== "UNKNOWN_DECLARATION"
          : item.semantic.state === "RESOLVED_HIGH" && Boolean(canonicalKey),
        entityBindingSafe: !repeated || item.semantic.entityIntelligence?.state === "BOUND_HIGH",
        answerAllowed: documentField
          ? Boolean(privateResult.pageContext.applicationId && this.documents)
          : declaration
          ? declaration.decision.outcome === "AUTO_ALLOWED" || declaration.decision.outcome === "PREPARE_FOR_REVIEW"
          : item.answerResolution?.status === "RESOLVED" && policy?.autofillMode !== "FORBIDDEN" && policy?.autofillMode !== "APPLICATION_GESTURE",
        capabilitySupported: capabilityHints(field)[0] !== "UNSUPPORTED",
        ownershipAllowed: field.ownership !== "USER_OWNED",
        completed: graphNode.state === "COMPLETED" || inapplicableFields.has(field.fieldRuntimeId)
      }];
    });
    const frontier = safeFormGraphFrontier(request.graph, readiness);
    const safeNodes = new Set(frontier.executableGraphNodeIds);
    const needsUserNodes = new Set(frontier.needsUserGraphNodeIds);
    const operations: ExecutionPlanResponse["operations"] = [];
    const actions: ExecutionPlanResponse["actions"] = [];
    const skipped: ExecutionPlanResponse["skipped"] = [];
    for (let index = 0; index < privateResult.items.length; index += 1) {
      const item = privateResult.items[index];
      const field = request.intelligence.fields[index];
      if (!item || !field) continue;
      const question=field.question;
      if(question&&(!question.membershipComplete||question.questionId!==field.fieldRuntimeId||question.pageInstanceId!==field.pageInstanceId||question.formInstanceId!==field.formInstanceId||(question.kind==="SINGLE_CHOICE")!==(field.controlType==="RADIO"))) {
        skipped.push({fieldRuntimeId:field.fieldRuntimeId,canonicalKey:item.semantic.canonicalKey,reason:"QUESTION_CONTRACT_INVALID",containsCandidateValue:false});
        continue;
      }
      const graphNode = graphNodeByField.get(field.fieldRuntimeId);
      if (!graphNode) {
        skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey: item.semantic.canonicalKey, reason: "GRAPH_NODE_STALE", containsCandidateValue: false });
        continue;
      }
      if (inapplicableFields.has(field.fieldRuntimeId)) {
        skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey: item.semantic.canonicalKey, reason: "NOT_APPLICABLE", containsCandidateValue: false });
        continue;
      }
      const declaration = declarationByField.get(field.fieldRuntimeId);
      if (declaration && declaration.decision.outcome !== "AUTO_ALLOWED" && declaration.decision.outcome !== "PREPARE_FOR_REVIEW") {
        const reason = declaration.decision.outcome === "UNRESOLVED"
          ? "DECLARATION_UNRESOLVED" as const
          : declaration.decision.outcome === "BLOCKED"
            ? "DECLARATION_POLICY_BLOCKED" as const
            : declaration.decision.failureCode === "DECLARATION_TEXT_UNAVAILABLE"
              ? "DECLARATION_TEXT_UNAVAILABLE" as const
              : declaration.decision.failureCode === "DECLARATION_POLICY_AMBIGUOUS"
                ? "DECLARATION_POLICY_AMBIGUOUS" as const
                : "DECLARATION_USER_ACTION_REQUIRED" as const;
        skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey: item.semantic.canonicalKey, reason, containsCandidateValue: false });
        continue;
      }
      if (!safeNodes.has(graphNode.graphNodeId)) {
        const reason = graphNode.state === "COMPLETED" ? "ALREADY_COMPLETED"
          : field.ownership === "USER_OWNED" ? "USER_OWNED"
          : !graphNode.visible || !graphNode.enabled || graphNode.technical || !graphNode.currentStep ? "HIDDEN_OR_DISABLED"
          : frontier.failures.includes("GRAPH_CYCLE_DETECTED") ? "GRAPH_CYCLE_DETECTED"
          : needsUserNodes.has(graphNode.graphNodeId) ? item.semantic.state !== "RESOLVED_HIGH" ? "SEMANTIC_NOT_HIGH_CONFIDENCE"
            : item.answerResolution?.status !== "RESOLVED" && item.semantic.canonicalKey !== "RESUME" && item.semantic.canonicalKey !== "COVER_LETTER" ? answerSkipReason(item.answerResolution?.reasonCodes ?? [])
            : "GRAPH_NEEDS_USER"
          : readiness.find((entry) => entry.graphNodeId === graphNode.graphNodeId)?.answerAllowed ? "DEPENDENCY_BLOCKED"
          : "GRAPH_NODE_BLOCKED";
        skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey: item.semantic.canonicalKey, reason, containsCandidateValue: false });
        continue;
      }
      const canonicalKey = item.semantic.canonicalKey;
      if (item.semantic.state !== "RESOLVED_HIGH" || !canonicalKey) {
        skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey, reason: "SEMANTIC_NOT_HIGH_CONFIDENCE", containsCandidateValue: false });
        continue;
      }
      if (!this.representations.isEnabled(canonicalKey)) {
        skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey, reason: "POLICY_FORBIDS_EXECUTION", containsCandidateValue: false });
        continue;
      }
      if (declaration) {
        const declarationAuthorization = declaration.decision.authorization;
        if (!declarationAuthorization) {
          skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey, reason: "POLICY_AUTHORIZATION_REQUIRED", containsCandidateValue: false });
          continue;
        }
        const hints = capabilityHints(field);
        if (hints[0] === "UNSUPPORTED") {
          skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey, reason: "UNSUPPORTED_CONTROL", containsCandidateValue: false });
          continue;
        }
        operations.push({
          schemaVersion: 1,
          operationId: crypto.randomUUID(),
          applicationRunId,
          pageInstanceId: request.pageInstanceId,
          formInstanceId: field.formInstanceId,
          fieldRuntimeId: field.fieldRuntimeId,
          graphNodeId: graphNode.graphNodeId,
          graphGuard: frontier.guard,
          controlFingerprint: field.controlFingerprint,
          canonicalKey,
          answerVersionId: null,
          answerScopeFingerprint: null,
          trialReuse: false,
          semanticControlType: field.controlType,
          capabilityHints: hints,
          representation: {
            representationId: "DECLARATION_BOOLEAN@1",
            policyVersion: 1,
            sourceKind: "BOOLEAN",
            containsCandidateValue: true,
            kind: "BOOLEAN",
            checked: true
          },
          documentAuthority: null,
          authorization: declarationAuthorization.policyDecision === "PREPARE_FOR_REVIEW" ? "REVIEW_REQUIRED" : "AUTO",
          declarationAuthorization,
          maximumAttempts: 1
        });
        continue;
      }
      if (field.controlType === "FILE" && (canonicalKey === "RESUME" || canonicalKey === "COVER_LETTER")) {
        const applicationId = privateResult.pageContext.applicationId;
        if (!applicationId || !this.documents) {
          skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey, reason: "DOCUMENT_NOT_READY", containsCandidateValue: false });
          continue;
        }
        const documentKind = canonicalKey;
        const resolved = await this.documents.resolve({
          accountId: input.accountId, candidateId: input.candidateId,
          applicationId, applicationRunId, jobId: privateResult.pageContext.jobId,
          documentKind
        });
        if (!resolved) {
          skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey, reason: "DOCUMENT_NOT_READY", containsCandidateValue: false });
          continue;
        }
        operations.push({
          schemaVersion: 1,
          operationId: crypto.randomUUID(),
          applicationRunId,
          pageInstanceId: request.pageInstanceId,
          formInstanceId: field.formInstanceId,
          fieldRuntimeId: field.fieldRuntimeId,
          graphNodeId: graphNode.graphNodeId,
          graphGuard: frontier.guard,
          controlFingerprint: field.controlFingerprint,
          canonicalKey,
          answerVersionId: null,
          answerScopeFingerprint: null,
          trialReuse: false,
          semanticControlType: field.controlType,
          capabilityHints: ["FILE_INPUT"],
          representation: {
            representationId: "DOCUMENT_FILE@1",
            policyVersion: 1,
            sourceKind: "FILE_REF",
            containsCandidateValue: true,
            kind: "FILE",
            selectionId: resolved.selectionId,
            documentId: resolved.documentId,
            documentKind: resolved.documentKind,
            fileName: resolved.fileName,
            mimeType: resolved.mimeType,
            byteSize: resolved.byteSize,
            contentSha256: resolved.contentSha256,
            bytesBase64: resolved.bytesBase64
          },
          documentAuthority: {
            selectionId: resolved.selectionId,
            documentId: resolved.documentId,
            documentKind: resolved.documentKind,
            contentSha256: resolved.contentSha256
          },
          authorization: "AUTO",
          declarationAuthorization: null,
          maximumAttempts: 1
        });
        continue;
      }
      const resolution = item.answerResolution;
      if (!resolution || resolution.status !== "RESOLVED") {
        skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey, reason: answerSkipReason(resolution?.reasonCodes ?? []), containsCandidateValue: false });
        continue;
      }
      const policy = candidateAnswerPolicy(canonicalKey);
      if (policy.autofillMode === "APPLICATION_GESTURE") {
        skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey, reason: "DECLARATION_REQUIRES_GESTURE", containsCandidateValue: false });
        continue;
      }
      if (policy.autofillMode === "FORBIDDEN") {
        skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey, reason: "POLICY_FORBIDS_EXECUTION", containsCandidateValue: false });
        continue;
      }
      if (resolution.normalizedValue.kind === "FILE_REF") {
        skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey, reason: "FILE_REQUIRES_DOCUMENT_FLOW", containsCandidateValue: false });
        continue;
      }
      const hints = capabilityHints(field);
      if (hints[0] === "UNSUPPORTED") {
        skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey, reason: "UNSUPPORTED_CONTROL", containsCandidateValue: false });
        continue;
      }
      try {
        operations.push({
          schemaVersion: 1,
          operationId: crypto.randomUUID(),
          applicationRunId,
          pageInstanceId: request.pageInstanceId,
          formInstanceId: field.formInstanceId,
          fieldRuntimeId: field.fieldRuntimeId,
          graphNodeId: graphNode.graphNodeId,
          graphGuard: frontier.guard,
          controlFingerprint: field.controlFingerprint,
          canonicalKey,
          answerVersionId: resolution.answerVersionId,
          answerScopeFingerprint: resolution.scope.scopeFingerprint,
          trialReuse: resolution.trialReuse,
          semanticControlType: field.controlType,
          capabilityHints: hints,
          representation: this.representations.resolve(resolution.normalizedValue, field, { canonicalKey }),
          documentAuthority: null,
          authorization: resolution.requiresUserReview ? "REVIEW_REQUIRED" : "AUTO",
          declarationAuthorization: null,
          maximumAttempts: 2
        });
      } catch (error) {
        const reason = error instanceof RepresentationError ? error.code : "REPRESENTATION_INVALID";
        const diagnostic = ExecutionPlanSkippedFieldSchema.shape.diagnosticCode.safeParse(error instanceof RepresentationError ? error.reasonCode : undefined);
        skipped.push({ fieldRuntimeId: field.fieldRuntimeId, canonicalKey, reason, ...(diagnostic.success && diagnostic.data ? { diagnosticCode: diagnostic.data } : {}), containsCandidateValue: false });
      }
    }
    if (operations.length === 0 && frontier.needsUserGraphNodeIds.length === 0 && !frontier.failures.length) {
      const capacity = new Map((privateResult.repeatableCapacity ?? []).map((item) => [item.entityType, item]));
      for (const node of request.graph.nodes) {
        if (node.nodeType !== "ACTION" || !node.actionKind || !node.formInstanceId || node.state !== "REACHABLE" || !node.visible || !node.enabled || !node.currentStep) continue;
        if (node.actionKind === "ADD_REPEAT") {
          const remaining = node.semanticRole ? capacity.get(node.semanticRole)?.remainingCount ?? 0 : 0;
          if (remaining <= 0) continue;
          actions.push({
            schemaVersion: 1, operationId: crypto.randomUUID(), applicationRunId,
            pageInstanceId: request.pageInstanceId, formInstanceId: node.formInstanceId,
            graphNodeId: node.graphNodeId, graphGuard: frontier.guard, actionKind: node.actionKind,
            authorization: "AUTO_SAFE", expectedEffect: "REPEAT_GROUP_ADDED"
          });
          break;
        }
        if (["NEXT", "CONTINUE", "SAVE"].includes(node.actionKind) && frontier.readyForNavigation) {
          actions.push({
            schemaVersion: 1, operationId: crypto.randomUUID(), applicationRunId,
            pageInstanceId: request.pageInstanceId, formInstanceId: node.formInstanceId,
            graphNodeId: node.graphNodeId, graphGuard: frontier.guard, actionKind: node.actionKind,
            authorization: "USER_GESTURE_REQUIRED", expectedEffect: node.actionKind === "SAVE" ? "FORM_SAVED" : "STEP_TRANSITION"
          });
        }
      }
    }
    return ExecutionPlanResponseSchema.parse({
      schemaVersion: 1,
      requestId: request.requestId,
      applicationRunId,
      pageInstanceId: request.pageInstanceId,
      graphGuard: frontier.guard,
      frontier,
      operations,
      actions,
      declarations: declarationItems,
      skipped,
      summary: {
        planned: operations.length,
        skipped: skipped.length,
        reviewRequired: operations.filter((operation) => operation.authorization === "REVIEW_REQUIRED").length,
        plannedActions: actions.length,
        declarationPrepared: declarationItems.filter((item) => item.policyDecision === "AUTO_ALLOWED" || item.policyDecision === "PREPARE_FOR_REVIEW").length,
        declarationNeedsAction: declarationItems.filter((item) => item.status === "NEEDS_CANDIDATE_ACTION" || item.status === "UNRESOLVED").length,
        declarationBlocked: declarationItems.filter((item) => item.status === "BLOCKED").length
      },
      dataClass: "CANDIDATE_PRIVATE",
      containsCandidateValue: true
    });
  }
}

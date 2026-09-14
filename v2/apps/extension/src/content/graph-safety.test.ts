import assert from "node:assert/strict";
import test from "node:test";
import {
  GraphActionExecutionRequestSchema,
  type ExecutionPlanResponse,
  type FormGraphGuard,
  type GraphActionExecutionRequest
} from "@job-hunter-v2/contracts";
import { FieldExecutionOrchestrator } from "./orchestrator.js";
import { GraphActionExecutor } from "./graph-action-executor.js";

const pageInstanceId = "10000000-0000-4000-8000-000000000071";
const applicationRunId = "20000000-0000-4000-8000-000000000071";
const planGuard: FormGraphGuard = { pageInstanceId, graphRevision: 3, graphFingerprint: "a".repeat(64) };
const currentGuard: FormGraphGuard = { pageInstanceId, graphRevision: 4, graphFingerprint: "b".repeat(64) };

test("field execution rejects a stale graph plan before touching the DOM", async () => {
  const plan: ExecutionPlanResponse = {
    schemaVersion: 1, requestId: crypto.randomUUID(), applicationRunId, pageInstanceId,
    graphGuard: planGuard,
    frontier: {
      guard: planGuard, executableGraphNodeIds: [], needsUserGraphNodeIds: [], blockedGraphNodeIds: [],
      readyForNavigation: false, failures: [], valuePrivate: true, containsCandidateValue: false
    },
    operations: [], actions: [], declarations: [], skipped: [],
    summary: {
      planned: 0, skipped: 0, reviewRequired: 0, plannedActions: 0,
      declarationPrepared: 0, declarationNeedsAction: 0, declarationBlocked: 0
    },
    dataClass: "CANDIDATE_PRIVATE", containsCandidateValue: true
  };
  const orchestrator = new FieldExecutionOrchestrator(
    null as never, null as never, null as never, undefined,
    () => pageInstanceId, () => currentGuard
  );
  const result = await orchestrator.execute(plan, crypto.randomUUID());
  assert.equal(result.status, "ABORTED");
  assert.equal(result.receipts.length, 0);
  // Deliberately unreadable operation: both preflight exits must occur before inspecting it.
  const pendingPlan = { ...plan, operations: [null as never] };
  const stale = await orchestrator.execute(pendingPlan, crypto.randomUUID());
  assert.equal(stale.skippedCount, 1);
  const paused = new FieldExecutionOrchestrator(null as never, null as never, null as never, undefined, () => pageInstanceId, () => planGuard);
  const deferred = await paused.execute(pendingPlan, crypto.randomUUID(), { shouldContinue: () => false, onField: () => assert.fail("paused operation must not start") });
  assert.equal(deferred.status, "PARTIAL");
  assert.equal(deferred.skippedCount, 1);
  assert.equal(deferred.receipts.length, 0);
});

test("structural actions reject stale guards and never authorize navigation or submit", async () => {
  const request: GraphActionExecutionRequest = {
    schemaVersion: 1, operationId: crypto.randomUUID(), applicationRunId, pageInstanceId,
    formInstanceId: "form:fixture", graphNodeId: "graph:action:12345678", graphGuard: planGuard,
    actionKind: "ADD_REPEAT", authorization: "AUTO_SAFE", expectedEffect: "REPEAT_GROUP_ADDED"
  };
  const executor = new GraphActionExecutor({ get: () => { throw new Error("DOM_MUST_NOT_BE_READ"); } } as never, () => currentGuard);
  const result = await executor.execute(request);
  assert.equal(result.status, "ABORTED");
  assert.equal(result.failureCode, "GRAPH_REVISION_STALE");
  assert.equal(GraphActionExecutionRequestSchema.safeParse({ ...request, actionKind: "NEXT" }).success, false);
  assert.equal(GraphActionExecutionRequestSchema.safeParse({ ...request, actionKind: "SUBMIT" }).success, false);
});

test("declaration execution rejects a changed semantic descriptor before touching the DOM", async () => {
  const authorization = {
    schemaVersion: 1 as const, authorizationId: crypto.randomUUID(), decisionFingerprint: "c".repeat(64),
    canonicalKey: "CERTIFY_INFORMATION_ACCURATE" as const, declarationType: "ACCURACY_CERTIFICATION" as const,
    policyVersion: "O1-2026-09" as const, policyDecision: "PREPARE_FOR_REVIEW" as const,
    applicationRunId, pageInstanceId, formInstanceId: "form:declaration", fieldRuntimeId: "field:declaration",
    controlFingerprint: "control:declaration", descriptorFingerprint: "d".repeat(64), graphGuard: planGuard,
    authorizedInteraction: "SET_TRUE" as const, reviewRequirement: "FINAL_REVIEW" as const,
    valuePrivate: true as const, containsCandidateValue: false as const
  };
  const plan: ExecutionPlanResponse = {
    schemaVersion: 1, requestId: crypto.randomUUID(), applicationRunId, pageInstanceId, graphGuard: planGuard,
    frontier: {
      guard: planGuard, executableGraphNodeIds: ["graph:field:12345678"], needsUserGraphNodeIds: [], blockedGraphNodeIds: [],
      readyForNavigation: false, failures: [], valuePrivate: true, containsCandidateValue: false
    },
    operations: [{
      schemaVersion: 1, operationId: crypto.randomUUID(), applicationRunId, pageInstanceId,
      formInstanceId: "form:declaration", fieldRuntimeId: "field:declaration", graphNodeId: "graph:field:12345678",
      graphGuard: planGuard, controlFingerprint: "control:declaration", canonicalKey: "CERTIFY_INFORMATION_ACCURATE",
      answerVersionId: null, answerScopeFingerprint: null, trialReuse: false, semanticControlType: "CHECKBOX",
      capabilityHints: ["NATIVE_CHECKBOX"], representation: {
        representationId: "DECLARATION_BOOLEAN@1", policyVersion: 1, sourceKind: "BOOLEAN",
        containsCandidateValue: true, kind: "BOOLEAN", checked: true
      },
      documentAuthority: null,
      authorization: "REVIEW_REQUIRED", declarationAuthorization: authorization, maximumAttempts: 1
    }],
    actions: [], declarations: [{
      schemaVersion: 1, decisionFingerprint: authorization.decisionFingerprint, policyVersion: "O1-2026-09",
      declarationType: "ACCURACY_CERTIFICATION", policyDecision: "PREPARE_FOR_REVIEW", status: "REVIEW_BEFORE_SUBMIT",
      required: true, reviewRequired: true, applicationRunId, pageInstanceId,
      formInstanceId: "form:declaration", fieldRuntimeId: "field:declaration", controlFingerprint: "control:declaration",
      descriptorFingerprint: authorization.descriptorFingerprint, graphGuard: planGuard, semanticConfidence: 0.99,
      failureCode: null, valuePrivate: true, containsCandidateValue: false
    }],
    skipped: [], summary: {
      planned: 1, skipped: 0, reviewRequired: 1, plannedActions: 0,
      declarationPrepared: 1, declarationNeedsAction: 0, declarationBlocked: 0
    }, dataClass: "CANDIDATE_PRIVATE", containsCandidateValue: true
  };
  const orchestrator = new FieldExecutionOrchestrator(
    null as never, null as never, null as never, undefined,
    () => pageInstanceId, () => planGuard, () => "e".repeat(64)
  );
  const result = await orchestrator.execute(plan, crypto.randomUUID());
  assert.equal(result.receipts[0]?.failureClass, "DECLARATION_CONTEXT_CHANGED");
  assert.equal(result.receipts[0]?.attempts.length, 0);
});

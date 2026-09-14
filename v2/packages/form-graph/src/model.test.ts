import assert from "node:assert/strict";
import test from "node:test";
import { FormGraphEdgeSchema, type FormGraphEdge, type FormGraphNode, type FormGraphObservation } from "@job-hunter-v2/contracts";
import { FormGraphRuntime, createGraphEdgeId, createGraphNodeId, formGraphHash, reconcileFormGraph, safeFormGraphFrontier } from "./model.js";

const pageInstanceId = "10000000-0000-4000-8000-000000000001";
const formInstanceId = "form:fixture";

function node(key: string, overrides: Partial<FormGraphNode> = {}): FormGraphNode {
  const graphNodeId = createGraphNodeId("FIELD", `${pageInstanceId}:${key}`);
  return {
    graphNodeId, nodeType: "FIELD", pageInstanceId, formInstanceId,
    logicalFingerprint: formGraphHash(key), parentGraphNodeId: null,
    fieldRuntimeId: `field:${key.padEnd(8, "0")}`, controlFingerprint: `control:${key.padEnd(8, "0")}`,
    formRepeatGroupId: null, actionKind: null, semanticRole: null, state: "REACHABLE",
    visible: true, enabled: true, required: false, currentStep: true, technical: false,
    optionFingerprint: null, optionCount: 0, validationState: "NONE", validationErrorCount: 0,
    declaredTargetKeys: [], evidence: ["STRUCTURAL_INFERENCE"], confidence: 0.9,
    valuePrivate: true, containsCandidateValue: false, ...overrides
  };
}

function observation(nodes: FormGraphNode[], edges: FormGraphEdge[] = []): FormGraphObservation {
  return {
    schemaVersion: 1, observationId: crypto.randomUUID(), applicationRunId: null, pageInstanceId,
    routeFingerprint: formGraphHash("/apply"), observedAt: new Date().toISOString(), nodes, edges,
    source: "INITIAL_SCAN", valuePrivate: true, containsCandidateValue: false
  };
}

test("reconciliation preserves revision across cosmetic observations and increments material changes", () => {
  const first = reconcileFormGraph(null, observation([node("name")])).graph;
  const same = reconcileFormGraph(first, observation([node("name", { evidence: ["REPEATED_OBSERVATION"], confidence: 0.9 })]));
  assert.equal(same.graph.graphRevision, 1);
  assert.equal(same.delta.material, false);
  const changed = reconcileFormGraph(same.graph, observation([node("name", { required: true })]));
  assert.equal(changed.graph.graphRevision, 2);
  assert.deepEqual(changed.delta.items.map((item) => item.deltaType), ["REQUIREDNESS_CHANGED"]);
});

test("structural deltas classify option, visibility and removal changes without values", () => {
  const initial = reconcileFormGraph(null, observation([
    node("country", { optionFingerprint: formGraphHash("IN|US"), optionCount: 2 }),
    node("state")
  ])).graph;
  const changed = reconcileFormGraph(initial, observation([
    node("country", { optionFingerprint: formGraphHash("IN|US|GB"), optionCount: 3 }),
    node("state", { visible: false, state: "HIDDEN" })
  ]));
  assert.ok(changed.delta.items.some((item) => item.deltaType === "OPTIONS_CHANGED"));
  assert.ok(changed.delta.items.some((item) => item.deltaType === "VISIBILITY_CHANGED"));
  assert.equal(JSON.stringify(changed).includes("candidate answer"), false);
});

test("safe frontier respects typed dependencies and required missing answers", () => {
  const country = node("country", { required: true });
  const state = node("state", { required: true });
  const edge: FormGraphEdge = {
    graphEdgeId: createGraphEdgeId("OPTIONS_DEPEND_ON", country.graphNodeId, state.graphNodeId),
    edgeType: "OPTIONS_DEPEND_ON", sourceGraphNodeId: country.graphNodeId, targetGraphNodeId: state.graphNodeId,
    predicate: { kind: "NODE_COMPLETED", expectedBoolean: null, normalizedOperandHash: null },
    evidence: ["DECLARED_DOM_RELATION"], confidence: 0.95, scope: "RUNTIME", executable: true,
    valuePrivate: true, containsCandidateValue: false
  };
  const graph = reconcileFormGraph(null, observation([country, state], [edge])).graph;
  const frontier = safeFormGraphFrontier(graph, [
    { graphNodeId: country.graphNodeId, semanticSafe: true, entityBindingSafe: true, answerAllowed: true, capabilitySupported: true, ownershipAllowed: true, completed: false },
    { graphNodeId: state.graphNodeId, semanticSafe: true, entityBindingSafe: true, answerAllowed: true, capabilitySupported: true, ownershipAllowed: true, completed: false }
  ]);
  assert.deepEqual(frontier.executableGraphNodeIds, [country.graphNodeId]);
  assert.ok(frontier.blockedGraphNodeIds.includes(state.graphNodeId));
});

test("cycle evidence fails closed", () => {
  const left = node("left");
  const right = node("right");
  const make = (source: FormGraphNode, target: FormGraphNode): FormGraphEdge => ({
    graphEdgeId: createGraphEdgeId("DEPENDS_ON", source.graphNodeId, target.graphNodeId), edgeType: "DEPENDS_ON",
    sourceGraphNodeId: source.graphNodeId, targetGraphNodeId: target.graphNodeId,
    predicate: { kind: "ALWAYS", expectedBoolean: null, normalizedOperandHash: null },
    evidence: ["OBSERVED_TRANSITION"], confidence: 1, scope: "RUNTIME", executable: true,
    valuePrivate: true, containsCandidateValue: false
  });
  const graph = reconcileFormGraph(null, observation([left, right], [make(left, right), make(right, left)])).graph;
  assert.ok(graph.failures.includes("GRAPH_CYCLE_DETECTED"));
  assert.equal(safeFormGraphFrontier(graph, []).executableGraphNodeIds.length, 0);
});

test("fields inherit reveal prerequisites from their containing section", () => {
  const controller = node("controller", { state: "REACHABLE" });
  const sectionId = createGraphNodeId("SECTION", `${pageInstanceId}:conditional`);
  const section: FormGraphNode = {
    ...node("section"), graphNodeId: sectionId, nodeType: "SECTION", logicalFingerprint: formGraphHash("conditional"),
    fieldRuntimeId: null, controlFingerprint: null, state: "REACHABLE"
  };
  const dependent = node("dependent", { parentGraphNodeId: sectionId, required: true });
  const edge: FormGraphEdge = {
    graphEdgeId: createGraphEdgeId("REVEALS", controller.graphNodeId, sectionId), edgeType: "REVEALS",
    sourceGraphNodeId: controller.graphNodeId, targetGraphNodeId: sectionId,
    predicate: { kind: "NODE_COMPLETED", expectedBoolean: null, normalizedOperandHash: null },
    evidence: ["DECLARED_DOM_RELATION"], confidence: 1, scope: "RUNTIME", executable: true,
    valuePrivate: true, containsCandidateValue: false
  };
  const graph = reconcileFormGraph(null, observation([controller, section, dependent], [edge])).graph;
  const common = { semanticSafe: true, entityBindingSafe: true, answerAllowed: true, capabilitySupported: true, ownershipAllowed: true };
  const blocked = safeFormGraphFrontier(graph, [
    { graphNodeId: controller.graphNodeId, ...common, completed: false },
    { graphNodeId: dependent.graphNodeId, ...common, completed: false }
  ]);
  assert.deepEqual(blocked.executableGraphNodeIds, [controller.graphNodeId]);
  const ready = safeFormGraphFrontier(graph, [
    { graphNodeId: controller.graphNodeId, ...common, completed: true },
    { graphNodeId: dependent.graphNodeId, ...common, completed: false }
  ]);
  assert.ok(ready.executableGraphNodeIds.includes(dependent.graphNodeId));
});

test("observed transitions add runtime-scoped executable evidence without values", () => {
  const runtime = new FormGraphRuntime();
  const controller = node("controller", { state: "COMPLETED" });
  const hidden = node("conditional", { visible: false, state: "HIDDEN" });
  runtime.reconcile(observation([controller, hidden]));
  const revealed = runtime.reconcile(observation([controller, node("conditional")], []));
  const learned = runtime.recordObservedTransition(controller.graphNodeId, revealed.delta, "CANDIDATE");
  assert.ok(learned);
  const edge = learned?.graph.edges.find((candidate) => candidate.edgeType === "REVEALS");
  assert.equal(edge?.scope, "RUNTIME");
  assert.equal(edge?.executable, true);
  assert.equal(JSON.stringify(learned).includes("candidate value"), false);
});

test("malformed references fail closed and AI-only edges cannot authorize execution", () => {
  const source = node("source");
  const missingTarget = createGraphNodeId("FIELD", `${pageInstanceId}:missing`);
  const malformed: FormGraphEdge = {
    graphEdgeId: createGraphEdgeId("ENABLES", source.graphNodeId, missingTarget), edgeType: "ENABLES",
    sourceGraphNodeId: source.graphNodeId, targetGraphNodeId: missingTarget,
    predicate: { kind: "ALWAYS", expectedBoolean: null, normalizedOperandHash: null },
    evidence: ["DECLARED_DOM_RELATION"], confidence: 1, scope: "RUNTIME", executable: true,
    valuePrivate: true, containsCandidateValue: false
  };
  const graph = reconcileFormGraph(null, observation([source], [malformed])).graph;
  assert.ok(graph.failures.includes("MALFORMED_GRAPH_EVIDENCE"));
  assert.equal(FormGraphEdgeSchema.safeParse({ ...malformed, evidence: ["AI_SUGGESTED"], executable: true }).success, false);
});

test("runtime reports repeated graph states without mutating the revision", () => {
  const runtime = new FormGraphRuntime();
  const input = observation([node("stable")]);
  assert.equal(runtime.reconcile(input).repeatedState, false);
  assert.equal(runtime.reconcile({ ...input, observationId: crypto.randomUUID() }).repeatedState, false);
  const repeated = runtime.reconcile({ ...input, observationId: crypto.randomUUID() });
  assert.equal(repeated.repeatedState, true);
  assert.equal(repeated.graph.graphRevision, 1);
});

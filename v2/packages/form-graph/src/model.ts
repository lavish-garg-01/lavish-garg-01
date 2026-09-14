import {
  FormGraphDeltaSchema,
  FormGraphFrontierSchema,
  FormGraphObservationSchema,
  FormGraphSnapshotSchema,
  type FormGraphDelta,
  type FormGraphDeltaItem,
  type FormGraphEdge,
  type FormGraphFailureCode,
  type FormGraphFieldReadiness,
  type FormGraphFrontier,
  type FormGraphNode,
  type FormGraphObservation,
  type FormGraphSnapshot
} from "@job-hunter-v2/contracts";

function fnv(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function formGraphHash(value: string): string {
  return Array.from({ length: 8 }, (_, index) => fnv(`${index}:${value}`)).join("");
}

export function createGraphNodeId(nodeType: FormGraphNode["nodeType"], logicalEvidence: string): string {
  return `graph:${nodeType.toLowerCase()}:${fnv(logicalEvidence)}`;
}

export function createGraphEdgeId(edgeType: FormGraphEdge["edgeType"], sourceGraphNodeId: string, targetGraphNodeId: string, predicateKey = "ALWAYS"): string {
  return `edge:${fnv(`${edgeType}:${sourceGraphNodeId}:${targetGraphNodeId}:${predicateKey}`)}`;
}

function canonicalNode(node: FormGraphNode): string {
  return JSON.stringify({
    id: node.graphNodeId,
    type: node.nodeType,
    form: node.formInstanceId,
    logical: node.logicalFingerprint,
    parent: node.parentGraphNodeId,
    field: node.fieldRuntimeId,
    control: node.controlFingerprint,
    repeat: node.formRepeatGroupId,
    action: node.actionKind,
    role: node.semanticRole,
    state: node.state,
    visible: node.visible,
    enabled: node.enabled,
    required: node.required,
    currentStep: node.currentStep,
    technical: node.technical,
    options: node.optionFingerprint,
    optionCount: node.optionCount,
    validation: node.validationState,
    validationErrors: node.validationErrorCount,
    targets: [...node.declaredTargetKeys].sort(),
    confidence: Math.round(node.confidence * 1_000) / 1_000
  });
}

function canonicalEdge(edge: FormGraphEdge): string {
  return JSON.stringify({
    id: edge.graphEdgeId,
    type: edge.edgeType,
    source: edge.sourceGraphNodeId,
    target: edge.targetGraphNodeId,
    predicate: edge.predicate,
    confidence: Math.round(edge.confidence * 1_000) / 1_000,
    scope: edge.scope,
    executable: edge.executable
  });
}

function graphFingerprint(observation: FormGraphObservation): string {
  const nodes = [...observation.nodes].sort((left, right) => left.graphNodeId.localeCompare(right.graphNodeId)).map(canonicalNode);
  const edges = [...observation.edges].sort((left, right) => left.graphEdgeId.localeCompare(right.graphEdgeId)).map(canonicalEdge);
  return formGraphHash(JSON.stringify({ route: observation.routeFingerprint, nodes, edges }));
}

function validateTopology(observation: FormGraphObservation): FormGraphFailureCode[] {
  const failures = new Set<FormGraphFailureCode>();
  const ids = new Set<string>();
  for (const node of observation.nodes) {
    if (ids.has(node.graphNodeId)) failures.add("MALFORMED_GRAPH_EVIDENCE");
    ids.add(node.graphNodeId);
  }
  const edgeIds = new Set<string>();
  for (const edge of observation.edges) {
    if (edgeIds.has(edge.graphEdgeId) || !ids.has(edge.sourceGraphNodeId) || !ids.has(edge.targetGraphNodeId)) {
      failures.add("MALFORMED_GRAPH_EVIDENCE");
    }
    edgeIds.add(edge.graphEdgeId);
  }
  for (const node of observation.nodes) {
    if (node.parentGraphNodeId && !ids.has(node.parentGraphNodeId)) failures.add("MALFORMED_GRAPH_EVIDENCE");
  }
  if (hasDependencyCycle(observation.nodes, observation.edges)) failures.add("GRAPH_CYCLE_DETECTED");
  return [...failures];
}

const dependencyEdges = new Set<FormGraphEdge["edgeType"]>([
  "DEPENDS_ON", "REVEALS", "ENABLES", "OPTIONS_DEPEND_ON", "REQUIRES_VALID", "EXECUTION_BEFORE"
]);

export function hasDependencyCycle(nodes: readonly FormGraphNode[], edges: readonly FormGraphEdge[]): boolean {
  const adjacency = new Map(nodes.map((node) => [node.graphNodeId, [] as string[]]));
  for (const edge of edges) {
    if (!edge.executable || !dependencyEdges.has(edge.edgeType)) continue;
    if (["EXECUTION_BEFORE", "REVEALS", "ENABLES", "OPTIONS_DEPEND_ON"].includes(edge.edgeType)) adjacency.get(edge.sourceGraphNodeId)?.push(edge.targetGraphNodeId);
    else adjacency.get(edge.targetGraphNodeId)?.push(edge.sourceGraphNodeId);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) if (visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return nodes.some((node) => visit(node.graphNodeId));
}

function nodeDelta(previous: FormGraphNode, next: FormGraphNode): FormGraphDeltaItem[] {
  const items: FormGraphDeltaItem[] = [];
  const before = formGraphHash(canonicalNode(previous));
  const after = formGraphHash(canonicalNode(next));
  if (before === after) return items;
  if (previous.optionFingerprint !== next.optionFingerprint || previous.optionCount !== next.optionCount) {
    items.push({ deltaType: "OPTIONS_CHANGED", graphNodeId: next.graphNodeId, graphEdgeId: null, beforeFingerprint: before, afterFingerprint: after });
  }
  if (previous.required !== next.required) items.push({ deltaType: "REQUIREDNESS_CHANGED", graphNodeId: next.graphNodeId, graphEdgeId: null, beforeFingerprint: before, afterFingerprint: after });
  if (previous.visible !== next.visible || previous.state === "HIDDEN" !== (next.state === "HIDDEN")) {
    items.push({ deltaType: "VISIBILITY_CHANGED", graphNodeId: next.graphNodeId, graphEdgeId: null, beforeFingerprint: before, afterFingerprint: after });
  }
  if (previous.enabled !== next.enabled || previous.state === "DISABLED" !== (next.state === "DISABLED")) {
    items.push({ deltaType: "ENABLEDNESS_CHANGED", graphNodeId: next.graphNodeId, graphEdgeId: null, beforeFingerprint: before, afterFingerprint: after });
  }
  if (previous.currentStep !== next.currentStep || previous.nodeType === "STEP" && previous.state !== next.state) {
    items.push({ deltaType: "STEP_CHANGED", graphNodeId: next.graphNodeId, graphEdgeId: null, beforeFingerprint: before, afterFingerprint: after });
  }
  if (!items.length) items.push({ deltaType: "NODE_CHANGED", graphNodeId: next.graphNodeId, graphEdgeId: null, beforeFingerprint: before, afterFingerprint: after });
  return items;
}

export function diffFormGraphs(previous: FormGraphSnapshot | null, observation: FormGraphObservation): FormGraphDelta {
  const fromRevision = previous?.graphRevision ?? 0;
  const beforeNodes = new Map(previous?.nodes.map((node) => [node.graphNodeId, node]) ?? []);
  const afterNodes = new Map(observation.nodes.map((node) => [node.graphNodeId, node]));
  const beforeEdges = new Map(previous?.edges.map((edge) => [edge.graphEdgeId, edge]) ?? []);
  const afterEdges = new Map(observation.edges.map((edge) => [edge.graphEdgeId, edge]));
  const items: FormGraphDeltaItem[] = [];
  for (const [id, node] of afterNodes) {
    const old = beforeNodes.get(id);
    if (!old) items.push({ deltaType: "NODE_ADDED", graphNodeId: id, graphEdgeId: null, beforeFingerprint: null, afterFingerprint: formGraphHash(canonicalNode(node)) });
    else items.push(...nodeDelta(old, node));
  }
  for (const [id, node] of beforeNodes) if (!afterNodes.has(id)) {
    items.push({ deltaType: "NODE_REMOVED", graphNodeId: id, graphEdgeId: null, beforeFingerprint: formGraphHash(canonicalNode(node)), afterFingerprint: null });
  }
  for (const [id, edge] of afterEdges) {
    const old = beforeEdges.get(id);
    if (!old) items.push({ deltaType: "EDGE_ADDED", graphNodeId: null, graphEdgeId: id, beforeFingerprint: null, afterFingerprint: formGraphHash(canonicalEdge(edge)) });
    else if (canonicalEdge(old) !== canonicalEdge(edge)) {
      items.push({ deltaType: "EDGE_REMOVED", graphNodeId: null, graphEdgeId: id, beforeFingerprint: formGraphHash(canonicalEdge(old)), afterFingerprint: null });
      items.push({ deltaType: "EDGE_ADDED", graphNodeId: null, graphEdgeId: id, beforeFingerprint: null, afterFingerprint: formGraphHash(canonicalEdge(edge)) });
    }
  }
  for (const [id, edge] of beforeEdges) if (!afterEdges.has(id)) {
    items.push({ deltaType: "EDGE_REMOVED", graphNodeId: null, graphEdgeId: id, beforeFingerprint: formGraphHash(canonicalEdge(edge)), afterFingerprint: null });
  }
  const affectedGraphNodeIds = [...new Set(items.flatMap((item) => {
    if (item.graphNodeId) return [item.graphNodeId];
    const edge = afterEdges.get(item.graphEdgeId ?? "") ?? beforeEdges.get(item.graphEdgeId ?? "");
    return edge ? [edge.sourceGraphNodeId, edge.targetGraphNodeId] : [];
  }))].sort();
  return FormGraphDeltaSchema.parse({
    fromRevision,
    toRevision: fromRevision + 1,
    material: items.length > 0,
    items,
    affectedGraphNodeIds,
    valuePrivate: true,
    containsCandidateValue: false
  });
}

function summary(nodes: readonly FormGraphNode[]) {
  return {
    nodeCount: nodes.length,
    edgeCount: 0,
    reachableFieldCount: nodes.filter((node) => node.nodeType === "FIELD" && node.state === "REACHABLE").length,
    blockingFieldCount: nodes.filter((node) => node.nodeType === "FIELD" && node.required && ["BLOCKED", "NEEDS_USER", "UNRESOLVED"].includes(node.state)).length,
    stepCount: nodes.filter((node) => node.nodeType === "STEP").length,
    validationErrorCount: nodes.reduce((total, node) => total + node.validationErrorCount, 0)
  };
}

export function reconcileFormGraph(previousInput: FormGraphSnapshot | null, observationInput: FormGraphObservation): { graph: FormGraphSnapshot; delta: FormGraphDelta } {
  const observation = FormGraphObservationSchema.parse(observationInput);
  const previous = previousInput ? FormGraphSnapshotSchema.parse(previousInput) : null;
  if (previous && previous.pageInstanceId !== observation.pageInstanceId) throw new Error("GRAPH_PAGE_INSTANCE_MISMATCH");
  const fingerprint = graphFingerprint(observation);
  const delta = diffFormGraphs(previous, observation);
  const unchanged = previous?.graphFingerprint === fingerprint;
  const failures = validateTopology(observation);
  const graphSummary = summary(observation.nodes);
  graphSummary.edgeCount = observation.edges.length;
  const graph = FormGraphSnapshotSchema.parse({
    schemaVersion: 1,
    applicationRunId: observation.applicationRunId,
    pageInstanceId: observation.pageInstanceId,
    graphRevision: unchanged ? previous.graphRevision : (previous?.graphRevision ?? 0) + 1,
    graphFingerprint: fingerprint,
    routeFingerprint: observation.routeFingerprint,
    observedAt: observation.observedAt,
    stable: failures.length === 0,
    nodes: [...observation.nodes].sort((left, right) => left.graphNodeId.localeCompare(right.graphNodeId)),
    edges: [...observation.edges].sort((left, right) => left.graphEdgeId.localeCompare(right.graphEdgeId)),
    failures,
    summary: graphSummary,
    valuePrivate: true,
    containsCandidateValue: false
  });
  return {
    graph,
    delta: unchanged ? FormGraphDeltaSchema.parse({ ...delta, toRevision: graph.graphRevision, material: false, items: [], affectedGraphNodeIds: [] }) : delta
  };
}

function directPrerequisitesFor(nodeId: string, nodeById: ReadonlyMap<string, FormGraphNode>, edges: readonly FormGraphEdge[]): string[] {
  const dependencies: string[] = [];
  for (const edge of edges) {
    if (!edge.executable) continue;
    if (["DEPENDS_ON", "REQUIRES_VALID"].includes(edge.edgeType) && edge.sourceGraphNodeId === nodeId) dependencies.push(edge.targetGraphNodeId);
    if (["EXECUTION_BEFORE", "REVEALS", "ENABLES", "OPTIONS_DEPEND_ON"].includes(edge.edgeType) && edge.targetGraphNodeId === nodeId) {
      const target = nodeById.get(nodeId);
      const observedRevealAlreadyMaterialized = edge.edgeType === "REVEALS"
        && edge.evidence.includes("OBSERVED_TRANSITION")
        && target?.visible === true
        && target.state !== "HIDDEN";
      if (!observedRevealAlreadyMaterialized) dependencies.push(edge.sourceGraphNodeId);
    }
  }
  return dependencies;
}

function prerequisitesFor(node: FormGraphNode, nodeById: ReadonlyMap<string, FormGraphNode>, edges: readonly FormGraphEdge[]): string[] {
  const dependencies = new Set<string>();
  const visited = new Set<string>();
  let current: FormGraphNode | undefined = node;
  while (current && !visited.has(current.graphNodeId)) {
    visited.add(current.graphNodeId);
    for (const dependency of directPrerequisitesFor(current.graphNodeId, nodeById, edges)) dependencies.add(dependency);
    current = current.parentGraphNodeId ? nodeById.get(current.parentGraphNodeId) : undefined;
  }
  return [...dependencies];
}

export function safeFormGraphFrontier(
  graphInput: FormGraphSnapshot,
  readinessInput: readonly FormGraphFieldReadiness[],
  maximumActions = 12
): FormGraphFrontier {
  const graph = FormGraphSnapshotSchema.parse(graphInput);
  const readiness = new Map(readinessInput.map((item) => [item.graphNodeId, item]));
  const failures = new Set<FormGraphFailureCode>(graph.failures);
  if (hasDependencyCycle(graph.nodes, graph.edges)) failures.add("GRAPH_CYCLE_DETECTED");
  const nodeById = new Map(graph.nodes.map((node) => [node.graphNodeId, node]));
  const executable: string[] = [];
  const needsUser: string[] = [];
  const blocked: string[] = [];
  for (const node of graph.nodes) {
    if (node.nodeType !== "FIELD") continue;
    if (node.technical || !node.currentStep || !node.visible || !node.enabled || node.state === "STALE") {
      blocked.push(node.graphNodeId);
      continue;
    }
    const status = readiness.get(node.graphNodeId);
    if (node.state === "COMPLETED" || status?.completed === true) continue;
    const dependencies = prerequisitesFor(node, nodeById, graph.edges);
    const dependencyReady = dependencies.every((id) => {
      const dependency = nodeById.get(id);
      const status = readiness.get(id);
      return status?.completed === true || dependency?.state === "COMPLETED";
    });
    if (!dependencyReady) {
      blocked.push(node.graphNodeId);
      continue;
    }
    if (!status || !status.semanticSafe || !status.entityBindingSafe || !status.answerAllowed || !status.capabilitySupported || !status.ownershipAllowed) {
      if (node.required) needsUser.push(node.graphNodeId);
      else blocked.push(node.graphNodeId);
      continue;
    }
    if (executable.length < Math.max(1, Math.min(maximumActions, 50))) executable.push(node.graphNodeId);
  }
  const activeValidation = graph.nodes.some((node) => node.nodeType === "VALIDATION_GATE" && node.validationState === "INVALID");
  if (activeValidation) failures.add("VALIDATION_GATE_BLOCKED");
  return FormGraphFrontierSchema.parse({
    guard: { pageInstanceId: graph.pageInstanceId, graphRevision: graph.graphRevision, graphFingerprint: graph.graphFingerprint },
    executableGraphNodeIds: failures.has("GRAPH_CYCLE_DETECTED") ? [] : executable,
    needsUserGraphNodeIds: needsUser,
    blockedGraphNodeIds: blocked,
    readyForNavigation: !activeValidation && needsUser.length === 0 && graph.nodes.filter((node) => node.nodeType === "FIELD" && node.required && node.visible && node.currentStep).every((node) => readiness.get(node.graphNodeId)?.completed === true),
    failures: [...failures],
    valuePrivate: true,
    containsCandidateValue: false
  });
}

export class FormGraphRuntime {
  private current: FormGraphSnapshot | null = null;
  private readonly seen = new Map<string, number>();
  private readonly observedEdges = new Map<string, FormGraphEdge>();
  private lastObservation: FormGraphObservation | null = null;

  reconcile(observation: FormGraphObservation): { graph: FormGraphSnapshot; delta: FormGraphDelta; repeatedState: boolean } {
    const nodeIds = new Set(observation.nodes.map((node) => node.graphNodeId));
    const reusable = [...this.observedEdges.values()].filter((edge) => nodeIds.has(edge.sourceGraphNodeId) && nodeIds.has(edge.targetGraphNodeId));
    const enriched = FormGraphObservationSchema.parse({
      ...observation,
      edges: [...new Map([...observation.edges, ...reusable].map((edge) => [edge.graphEdgeId, edge])).values()]
    });
    const result = reconcileFormGraph(this.current, enriched);
    this.current = result.graph;
    this.lastObservation = enriched;
    const count = (this.seen.get(result.graph.graphFingerprint) ?? 0) + 1;
    this.seen.set(result.graph.graphFingerprint, count);
    return { ...result, repeatedState: count > 2 };
  }

  recordObservedTransition(
    sourceGraphNodeId: string,
    delta: FormGraphDelta,
    origin: "COPILOT" | "CANDIDATE" | "BROWSER" | "UNKNOWN"
  ): { graph: FormGraphSnapshot; delta: FormGraphDelta } | null {
    if (!this.current || !this.lastObservation || !this.current.nodes.some((node) => node.graphNodeId === sourceGraphNodeId)) return null;
    const source = this.current.nodes.find((node) => node.graphNodeId === sourceGraphNodeId);
    if (!source) return null;
    const targets = new Set(delta.items.flatMap((item) => {
      if (!item.graphNodeId || item.graphNodeId === sourceGraphNodeId) return [];
      if (["NODE_ADDED", "OPTIONS_CHANGED", "VISIBILITY_CHANGED", "ENABLEDNESS_CHANGED", "REQUIREDNESS_CHANGED"].includes(item.deltaType)) return [item.graphNodeId];
      return [];
    }));
    let added = false;
    for (const targetGraphNodeId of targets) {
      const target = this.current.nodes.find((node) => node.graphNodeId === targetGraphNodeId);
      if (!target) continue;
      const edgeType: FormGraphEdge["edgeType"] = source.nodeType === "ACTION" && source.actionKind === "ADD_REPEAT" && target.nodeType === "REPEAT_GROUP"
        ? "CREATES_REPEAT_GROUP"
        : delta.items.some((item) => item.graphNodeId === targetGraphNodeId && item.deltaType === "OPTIONS_CHANGED")
          ? "OPTIONS_DEPEND_ON"
          : "REVEALS";
      const edge: FormGraphEdge = {
        graphEdgeId: createGraphEdgeId(edgeType, sourceGraphNodeId, targetGraphNodeId, "OBSERVED"),
        edgeType,
        sourceGraphNodeId,
        targetGraphNodeId,
        predicate: { kind: "UNKNOWN", expectedBoolean: null, normalizedOperandHash: null },
        evidence: ["OBSERVED_TRANSITION"],
        confidence: origin === "COPILOT" ? 1 : origin === "CANDIDATE" ? 0.9 : 0.65,
        scope: "RUNTIME",
        executable: origin === "COPILOT" || origin === "CANDIDATE",
        valuePrivate: true,
        containsCandidateValue: false
      };
      this.observedEdges.set(edge.graphEdgeId, edge);
      added = true;
    }
    if (!added) return null;
    const enriched = FormGraphObservationSchema.parse({
      ...this.lastObservation,
      observationId: crypto.randomUUID(),
      observedAt: new Date().toISOString(),
      source: origin === "COPILOT" ? "COPILOT_ACTION" : origin === "CANDIDATE" ? "USER_ACTION" : "MUTATION_BATCH",
      edges: [...new Map([...this.lastObservation.edges, ...this.observedEdges.values()].map((edge) => [edge.graphEdgeId, edge])).values()]
    });
    const result = reconcileFormGraph(this.current, enriched);
    this.current = result.graph;
    this.lastObservation = enriched;
    return result;
  }

  snapshot(): FormGraphSnapshot | null { return this.current; }
  reset(): void { this.current = null; this.seen.clear(); this.observedEdges.clear(); this.lastObservation = null; }
}

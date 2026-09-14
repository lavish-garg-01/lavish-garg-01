import {
  GraphActionExecutionReceiptSchema,
  type FormGraphGuard,
  type GraphActionExecutionRequest,
  type GraphActionExecutionReceipt
} from "@job-hunter-v2/contracts";
import type { GraphElementRegistry } from "./scanner.js";

function sameGuard(left: FormGraphGuard | null, right: FormGraphGuard): boolean {
  return Boolean(left && left.pageInstanceId === right.pageInstanceId && left.graphRevision === right.graphRevision && left.graphFingerprint === right.graphFingerprint);
}

export class GraphActionExecutor {
  private readonly active = new Set<string>();

  constructor(
    private readonly registry: GraphElementRegistry,
    private readonly currentGuard: () => FormGraphGuard | null
  ) {}

  async execute(request: GraphActionExecutionRequest): Promise<GraphActionExecutionReceipt> {
    const started = performance.now();
    const receipt = (status: GraphActionExecutionReceipt["status"], failureCode: GraphActionExecutionReceipt["failureCode"]) => GraphActionExecutionReceiptSchema.parse({
      schemaVersion: 1,
      operationId: request.operationId,
      applicationRunId: request.applicationRunId,
      pageInstanceId: request.pageInstanceId,
      graphNodeId: request.graphNodeId,
      graphGuard: request.graphGuard,
      actionKind: request.actionKind,
      status,
      failureCode,
      durationMs: Math.round(performance.now() - started),
      valuePrivate: true,
      containsCandidateValue: false
    });
    if (request.authorization !== "AUTO_SAFE" || !["ADD_REPEAT", "EXPAND"].includes(request.actionKind)) return receipt("ABORTED", "DEPENDENCY_UNRESOLVED");
    if (!sameGuard(this.currentGuard(), request.graphGuard)) return receipt("ABORTED", "GRAPH_REVISION_STALE");
    if (this.active.has(request.graphNodeId)) return receipt("ABORTED", "REPEATED_GRAPH_STATE");
    const element = this.registry.get(request.graphNodeId);
    if (!element?.isConnected) return receipt("FAILED", "GRAPH_NODE_STALE");
    if (element.matches(":disabled,[aria-disabled=true],[inert]") || element.getAttribute("aria-hidden") === "true") return receipt("FAILED", "DEPENDENCY_UNRESOLVED");
    this.active.add(request.graphNodeId);
    try {
      element.focus({ preventScroll: true });
      element.click();
      return receipt("EXECUTED_AWAITING_GRAPH", null);
    } finally {
      this.active.delete(request.graphNodeId);
    }
  }
}

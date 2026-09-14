import { ExecutionReceiptSchema, type ExecutionReceipt } from "@job-hunter-v2/contracts";
import type { ExecutionPlanningService, PlanExecutionInput } from "@job-hunter-v2/execution";
import { attribute, digest, type StrategyIntelligenceService, type Scope, type Binding } from "@job-hunter-v2/strategy-intelligence";
import type { KyselyStrategyRepository } from "@job-hunter-v2/database";

/** Q only adds scoped strategy preference to an already-authorized K plan. */
export class StrategyPlanningBridge {
  constructor(private readonly planner: Pick<ExecutionPlanningService, "plan">, private readonly q: StrategyIntelligenceService,
    private readonly repository: Pick<KyselyStrategyRepository, "bindMany">) {}
  async plan(input: PlanExecutionInput) {
    const plan = await this.planner.plan(input);
    const scope = { accountId: input.accountId, candidateId: input.candidateId };
    const definitions = await this.q.repository.definitions();
    const states = new Map<string, Awaited<ReturnType<StrategyIntelligenceService["cluster"]>>>();
    const bindings: Binding[] = [];
    for (const operation of plan.operations) {
      if (operation.declarationAuthorization || operation.documentAuthority || operation.representation.kind === "FILE") continue;
      const capability = operation.capabilityHints[0];
      if (!capability) continue;
      const field = input.request.intelligence.fields.find((f) => f.fieldRuntimeId === operation.fieldRuntimeId);
      const ats = input.request.intelligence.pageContext.ats.toUpperCase();
      const pattern = { capability, representationKind: operation.representation.kind,
        representationId: operation.representation.representationId,
        // No IDs, names, labels or candidate values: cluster by structural control semantics.
        structuralFingerprint: digest([input.request.intelligence.pageContext.host.toLowerCase(), field?.locatorEvidence.tagName,
          field?.locatorEvidence.type, field?.locatorEvidence.role, field?.controlType,
          input.request.intelligence.fields.map((f) => [f.locatorEvidence.tagName, f.locatorEvidence.type, f.locatorEvidence.role, f.optionEvidence.count])]),
        siteFamily: ["GREENHOUSE", "LEVER", "WORKDAY", "ASHBY"].includes(ats) ? ats as "GREENHOUSE" | "LEVER" | "WORKDAY" | "ASHBY" : "OTHER" as const };
      const clusterKey = digest(pattern);
      const state = states.get(clusterKey) ?? await this.q.cluster(pattern);
      states.set(clusterKey, state);
      operation.strategySelection = this.q.selection(state, definitions, scope, plan.applicationRunId);
      bindings.push({ ...scope, applicationRunId: plan.applicationRunId, operationId: operation.operationId,
        pageInstanceId: plan.pageInstanceId, fieldRuntimeId: operation.fieldRuntimeId, representationId: operation.representation.representationId,
        selection: operation.strategySelection, recordedAt: new Date().toISOString() });
    }
    await this.repository.bindMany(bindings);
    return plan;
  }
}

export class StrategyReceiptBridge {
  constructor(private readonly repository: Pick<KyselyStrategyRepository, "binding" | "append">) {}
  async record(scope: Scope, raw: ExecutionReceipt) {
    const receipt = ExecutionReceiptSchema.parse(raw);
    if (receipt.declaration || receipt.document) return;
    const binding = await this.repository.binding(scope, receipt.operationId);
    if (!binding) return; // Old extension/plan evidence remains L-only, never fabricated as Q experiments.
    this.match(binding, receipt);
    let lastIndex = -1;
    for (const attempt of receipt.attempts) {
      const index = binding.selection.strategies.findIndex((s) => s.key === attempt.strategyId);
      if (index <= lastIndex || attempt.attempt !== receipt.attempts.indexOf(attempt) + 1) throw new Error("Q_UNASSIGNED_STRATEGY");
      lastIndex = index;
      if (attempt.verificationStatus === "VERIFIED" && (attempt.executionStatus !== "EXECUTED" || attempt.failureClass)) throw new Error("Q_INVALID_VERIFIED_EVIDENCE");
      await this.repository.append({ evidenceKind: "TECHNICAL", eventId: digest([receipt.operationId, attempt.attempt]), ...scope,
        applicationRunId: receipt.applicationRunId, operationId: receipt.operationId, key: attempt.strategyId,
        cluster: binding.selection.cluster, occurredAt: binding.recordedAt, experimentId: binding.selection.experimentId,
        arm: binding.selection.arm, attribution: attribute(attempt, receipt),
        executed: attempt.executionStatus === "EXECUTED", verified: attempt.verificationStatus === "VERIFIED",
        verifierFailed: attempt.verificationStatus === "FAILED", attempt: attempt.attempt, durationMs: attempt.durationMs,
        fallback: receipt.attempts.length > 1, feedback: "NONE", severe: attempt.safetyViolation ?? "NONE", manualPattern: [], manualCommitted: false,
        containsCandidateValue: false });
    }
  }
  private match(binding: Binding, receipt: ExecutionReceipt) {
    if (binding.applicationRunId !== receipt.applicationRunId || binding.pageInstanceId !== receipt.pageInstanceId
      || binding.fieldRuntimeId !== receipt.fieldRuntimeId || binding.representationId !== receipt.representationId) throw new Error("Q_RECEIPT_CONTEXT_MISMATCH");
  }
}

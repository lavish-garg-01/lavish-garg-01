import { ExecutionStrategyRegistry } from "../content/executor.js";
import { IndependentFieldVerifier } from "../content/verifier.js";
import { FieldExecutionOrchestrator } from "../content/orchestrator.js";
import { FieldOwnershipTracker } from "../content/ownership.js";
import { ExecutionPlanResponseSchema, type StrategyPlan } from "@job-hunter-v2/contracts";
import type { FieldRegistry } from "../content/scanner.js";

/** Synthetic, value-free-input test harness. Never loaded by production extension entrypoints. */
export async function strategyFixture(plan: StrategyPlan, scenario: string) {
  document.body.innerHTML = '<form><label>Target<input id="target"></label><input id="unrelated" value="untouched"><input id="consent" type="checkbox"><button type="submit">Submit</button></form>';
  if (scenario === "textarea") document.querySelector("#target")!.outerHTML = '<textarea id="target"></textarea>';
  const target = document.querySelector<HTMLInputElement>("#target")!;
  const events: string[] = [];
  let submitted = false;
  document.querySelector("form")!.addEventListener("submit", (e) => { submitted = true; e.preventDefault(); });
  const page = crypto.randomUUID(), run = crypto.randomUUID(), operation = crypto.randomUUID();
  let currentPage = page;
  const guard = { pageInstanceId: page, graphRevision: 1, graphFingerprint: "a".repeat(64) };
  let liveGuard = { ...guard };
  const registry = { get: () => document.querySelector<HTMLInputElement>("#target"), matches: () => true } as unknown as FieldRegistry;
  const ownership = new FieldOwnershipTracker();
  const field = "field:offline-target";
  ownership.bind(field, target);
  for (const name of ["input", "change", "blur"]) target.addEventListener(name, () => events.push(name));
  if (scenario === "react" || scenario === "fallback") Object.defineProperty(target, "value", { get: () => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.get!.call(target), set: () => { /* framework-intercepted own setter */ }, configurable: true });
  if (scenario === "rerender") target.addEventListener("change", () => queueMicrotask(() => target.replaceWith(target.cloneNode(true))));
  if (scenario === "revert") target.addEventListener("change", () => setTimeout(() => { target.value = ""; }, 50));
  if (scenario === "disabled") target.disabled = true;
  if (scenario === "ownership") ownership.markUserOwned(field);
  if (scenario === "interrupt") target.addEventListener("input", () => ownership.markUserOwned(field));
  if (scenario === "graph") target.addEventListener("input", () => { liveGuard = { ...guard, graphRevision: 2 }; });
  if (scenario === "navigation") target.addEventListener("input", () => { currentPage = crypto.randomUUID(); });
  if (scenario === "outside") target.addEventListener("change", () => { document.querySelector<HTMLInputElement>("#unrelated")!.value = "changed"; });
  if (scenario === "dynamic") target.addEventListener("change", () => { const input = document.createElement("input"); input.id = "dependent"; document.body.append(input); });
  const request = {
    schemaVersion: 1, requestId: crypto.randomUUID(), applicationRunId: run, pageInstanceId: page, graphGuard: guard,
    frontier: { guard, executableGraphNodeIds: ["graph:field:12345678"], needsUserGraphNodeIds: [], blockedGraphNodeIds: [], readyForNavigation: false, failures: [], valuePrivate: true, containsCandidateValue: false },
    operations: [{ schemaVersion: 1, operationId: operation, applicationRunId: run, pageInstanceId: page,
      formInstanceId: "form:offline-target", fieldRuntimeId: field, graphNodeId: "graph:field:12345678", graphGuard: guard,
      controlFingerprint: "control:offline", canonicalKey: "FIRST_NAME", answerVersionId: crypto.randomUUID(), answerScopeFingerprint: "b".repeat(64), trialReuse: false,
      semanticControlType: scenario === "textarea" ? "TEXTAREA" : "TEXT", capabilityHints: [scenario === "textarea" ? "NATIVE_TEXTAREA" : "NATIVE_TEXT"],
      representation: { representationId: "TEXT@1", policyVersion: 1, sourceKind: "STRING", containsCandidateValue: true, kind: "TEXT", text: "Synthetic Fixture" },
      authorization: "AUTO", declarationAuthorization: null, maximumAttempts: 1,
      strategySelection: { policyVersion: "Q1-2026-09", revision: 1, cluster: "c".repeat(64), experimentId: null, arm: "STABLE", strategies: [{ key: "Q_OFFLINE@1", plan }] }
    }], actions: [], declarations: [], skipped: [], summary: { planned: 1, skipped: 0, reviewRequired: 0, plannedActions: 0,
      declarationPrepared: 0, declarationNeedsAction: 0, declarationBlocked: 0 }, dataClass: "CANDIDATE_PRIVATE", containsCandidateValue: true
  };
  const parsed = ExecutionPlanResponseSchema.parse(request);
  if (scenario === "fallback") {
    parsed.operations[0]!.maximumAttempts = 2;
    parsed.operations[0]!.strategySelection!.strategies = [
      { key: "Q_OFFLINE@1", plan: { kind: "TARGET_TEXT", steps: ["SET_DIRECT_VALUE", "INPUT", "CHANGE"] } },
      { key: "NATIVE_VALUE_SETTER@1", plan: { kind: "BUILTIN", implementation: "NATIVE_VALUE_SETTER@1" } }
    ];
  }
  if (scenario === "expired") parsed.operations[0]!.strategySelection!.expiresAt = "2000-01-01T00:00:00Z";
  if (scenario === "declaration") parsed.operations[0]!.canonicalKey = "CERTIFY_INFORMATION_ACCURATE";
  const engine = new FieldExecutionOrchestrator(registry, ownership, new IndependentFieldVerifier(registry, () => currentPage), new ExecutionStrategyRegistry(), () => currentPage, () => liveGuard);
  const start = performance.now();
  const first = await engine.execute(parsed, crypto.randomUUID());
  const eventCount = events.length;
  if (scenario === "duplicate") await engine.execute(parsed, crypto.randomUUID());
  return { status: first.receipts[0]?.status, failure: first.receipts[0]?.failureClass, events, duplicateEvents: events.length - eventCount,
    targetMatches: (registry.get(field) as HTMLInputElement | null)?.value === "Synthetic Fixture",
    unrelatedUntouched: document.querySelector<HTMLInputElement>("#unrelated")!.value === "untouched",
    consentUntouched: !document.querySelector<HTMLInputElement>("#consent")!.checked, submitted,
    elapsed: performance.now() - start, structuralChange: first.receipts[0]?.structuralChange,
    attempts: first.receipts[0]?.attempts.map((a) => ({ key: a.strategyId, verified: a.verificationStatus, safety: a.safetyViolation })),
    receipt: first.receipts[0] };
}
Object.assign(globalThis, { strategyFixture });

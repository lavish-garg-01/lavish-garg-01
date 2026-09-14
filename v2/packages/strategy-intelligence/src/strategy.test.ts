import assert from "node:assert/strict";
import test from "node:test";
import { safeStrategyPlan, type ExecutionAttemptReceipt, type ExecutionReceipt } from "@job-hunter-v2/contracts";
import { StrategyIntelligenceService, digest, builtinDefinitions } from "./service.js";
import { attribute, metrics, opportunity } from "./metrics.js";
import { ClusterStateSchema, DefinitionSchema, StrategyEvidenceSchema, type ClusterState, type Definition,
  type Pattern, type StrategyEvidence, type StrategyRepository, type Transition } from "./model.js";
import { AiOrchestrator, type ProviderAdapter, type AiRequest } from "@job-hunter-v2/ai";

export class MemoryStrategyRepository implements StrategyRepository {
  definitionsByKey = new Map<string, Definition>(); states = new Map<string, ClusterState>(); events: StrategyEvidence[] = [];
  history = new Map<string, { fingerprint: string; state: ClusterState }>();
  async definitions() { return [...this.definitionsByKey.values()]; }
  async addDefinition(d: Definition) {
    d = DefinitionSchema.parse(d);
    const old = this.definitionsByKey.get(d.key);
    if (old && digest(old) !== digest(d)) throw new Error("Q_IMMUTABLE_DEFINITION_CONFLICT");
    this.definitionsByKey.set(d.key, structuredClone(d));
  }
  async read(cluster: string) { return structuredClone(this.states.get(cluster) ?? null); }
  async create(state: ClusterState) { if (!this.states.has(state.cluster)) this.states.set(state.cluster, ClusterStateSchema.parse(state)); }
  async replay(cluster: string, command: Transition) {
    const prior = this.history.get(cluster + command.idempotencyKey);
    if (!prior) return null;
    if (prior.fingerprint !== digest(command)) throw new Error("Q_IDEMPOTENCY_CONFLICT");
    return structuredClone(prior.state);
  }
  async transition(cluster: string, command: Transition, mutate: (state: ClusterState) => ClusterState) {
    const key = cluster + command.idempotencyKey, prior = this.history.get(key);
    if (prior) { if (prior.fingerprint !== digest(command)) throw new Error("Q_IDEMPOTENCY_CONFLICT"); return structuredClone(prior.state); }
    const current = this.states.get(cluster)!;
    if (current.revision !== command.expectedRevision) throw new Error("Q_REVISION_CONFLICT");
    const next = ClusterStateSchema.parse({ ...mutate(structuredClone(current)), revision: current.revision + 1 });
    this.states.set(cluster, next); this.history.set(key, { fingerprint: digest(command), state: structuredClone(next) });
    return structuredClone(next);
  }
  async append(e: StrategyEvidence) { e = StrategyEvidenceSchema.parse(e); if (!this.events.some((old) => old.eventId === e.eventId)) this.events.push(e); }
  async evidence(cluster: string, since: string) { return this.events.filter((e) => e.cluster === cluster && e.occurredAt >= since); }
}
const now = Date.parse("2026-09-10T12:00:00.000Z");
const pattern: Pattern = { capability: "NATIVE_TEXT", representationKind: "TEXT", representationId: "TEXT@1", structuralFingerprint: "a".repeat(32), siteFamily: "OTHER" };
const scope = { accountId: crypto.randomUUID(), candidateId: crypto.randomUUID() };
const command = (revision: number, reason = "EVIDENCE_EVALUATION"): Transition => ({ expectedRevision: revision, idempotencyKey: crypto.randomUUID(), actorId: crypto.randomUUID(), reason });
const event = (cluster: string, key = "NATIVE_VALUE_SETTER@1", overrides: Partial<StrategyEvidence> = {}): StrategyEvidence => ({
  evidenceKind: "TECHNICAL",
  eventId: digest(crypto.randomUUID()), ...scope, applicationRunId: crypto.randomUUID(), operationId: crypto.randomUUID(),
  key, cluster, occurredAt: new Date(now).toISOString(), experimentId: null, arm: "STABLE", attribution: "NONE",
  executed: true, verified: true, verifierFailed: false, attempt: 1, durationMs: 10, fallback: false,
  feedback: "NONE", severe: "NONE", manualPattern: [], manualCommitted: false, containsCandidateValue: false, ...overrides
});
async function setup() { const repo = new MemoryStrategyRepository(), service = new StrategyIntelligenceService(repo, "s".repeat(32), undefined, () => now); await service.initialize(); const state = await service.cluster(pattern); return { repo, service, state }; }
async function canary() {
  const f = await setup();
  const proposed = await f.service.propose(f.state.cluster, { kind: "TARGET_TEXT", steps: ["SET_NATIVE_VALUE", "INPUT", "CHANGE"] }, "DEVELOPER", command(0));
  const d = (await f.repo.definitions()).find((d) => d.key === proposed.key)!;
  const proof = { definitionHash: digest(d), suiteVersion: "Q_FIXTURES@1",
    checks: { targetOnly: true, events: true, verifier: true, rerender: true, failure: true, bounded: true, userIntervention: true,
      dynamic: true, declaration: true, deduplication: true, regression: true, browser: true }, reviewedBy: crypto.randomUUID(), checkedAt: new Date(now).toISOString() };
  const approved = await f.service.approveOffline(f.state.cluster, proposed.key, { ...proof, attestation: f.service.attestProof(proof) }, { ...command(1, "OFFLINE_APPROVED"), actorId: proof.reviewedBy });
  const state = await f.service.startCanary(f.state.cluster, proposed.key, command(approved.revision));
  return { ...f, state, key: proposed.key };
}
test("Q registry uses existing identities, versions, compatible variable-length lists and immutable definitions", async () => {
  const { service, repo, state } = await setup();
  assert.equal((await repo.definitions()).length, 10);
  assert.equal(state.order.length, 2);
  assert.equal((await service.cluster({ ...pattern, capability: "NATIVE_SELECT", representationKind: "SINGLE_OPTION" })).order.length, 1);
  assert.equal((await service.cluster({ ...pattern, capability: "UNSUPPORTED" })).order.length, 0);
  const d = builtinDefinitions()[0]!;
  await assert.rejects(repo.addDefinition({ ...d, origin: "DEVELOPER" }), /IMMUTABLE/);
});
test("Q unknown/code/network/submit/unrelated-target/loop plans fail closed", () => {
  for (const plan of [{ kind: "JAVASCRIPT", code: "unsafe" }, { kind: "TARGET_TEXT", steps: ["NETWORK", "SUBMIT", "CLICK_OTHER"] },
    { kind: "TARGET_TEXT", steps: ["INPUT", "CHANGE", "SET_NATIVE_VALUE"] },
    { kind: "BUILTIN", implementation: "INVENTED@1" }, { kind: "TARGET_TEXT", steps: ["SET_NATIVE_VALUE", "INPUT", "CHANGE"], selector: "body" }]) assert.equal(safeStrategyPlan(plan), null);
  assert.ok(safeStrategyPlan({ kind: "TARGET_TEXT", steps: ["FOCUS", "SET_NATIVE_VALUE", "INPUT", "CHANGE", "BLUR"] }));
});
test("Q verified technical success is separate from overwrite, representation, semantic, graph and policy", () => {
  const attempt = { failureClass: null, executionStatus: "EXECUTED", verificationStatus: "VERIFIED", structuralChange: false } as ExecutionAttemptReceipt;
  const receipt = { declaration: null, failureClass: null } as ExecutionReceipt;
  assert.equal(attribute(attempt, receipt), "NONE");
  assert.equal(attribute({ ...attempt, failureClass: "REPRESENTATION_INVALID" }, receipt), "REPRESENTATION");
  assert.equal(attribute({ ...attempt, failureClass: "GRAPH_REVISION_STALE" }, receipt), "GRAPH");
  assert.equal(attribute({ ...attempt, failureClass: "POLICY_AUTHORIZATION_REQUIRED" }, receipt), "POLICY");
  const rows = [event("a".repeat(64), undefined, { feedback: "OVERWRITTEN" }), event("a".repeat(64), undefined, { attribution: "SEMANTIC" }),
    event("a".repeat(64), undefined, { attribution: "REPRESENTATION" }), event("a".repeat(64), undefined, { verified: false })];
  const m = metrics(rows, "NATIVE_VALUE_SETTER@1", now).recent;
  assert.equal(m.verifiedSuccesses, 1); assert.equal(m.attempts, 2); assert.equal(m.feedbackScore, -2);
  assert.equal(opportunity(rows, "NATIVE_VALUE_SETTER@1", now), null);
});
test("Q one success cannot promote or outrank stable; proposals require all independent offline checks", async () => {
  const { service, repo, state, key } = await canary();
  await repo.append(event(state.cluster, key, { experimentId: state.experiment!.id, arm: "TREATMENT" }));
  assert.equal((await service.evaluate(state.cluster, command(state.revision))).states[key], "CANARY");
  assert.equal((await repo.read(state.cluster))!.order[0], "NATIVE_VALUE_SETTER@1");
  assert.equal((await service.select(pattern, scope, "same-run")).strategies.some((s) => s.key === "NATIVE_VALUE_SETTER@1"), true);
  await assert.rejects(service.startCanary(state.cluster, key, command(state.revision)), /ELIGIBLE/);
});
test("Q deterministic candidate-isolated canary assignment and severe automatic stop preserve stable fallback", async () => {
  const { service, repo, state, key } = await canary();
  const first = await service.select(pattern, scope, "run"); assert.deepEqual(await service.select(pattern, scope, "run"), first);
  let treatments = 0;
  for (let i = 0; i < 300; i++) if ((await service.select(pattern, { ...scope, candidateId: crypto.randomUUID() }, "run")).arm === "TREATMENT") treatments++;
  assert.ok(treatments > 0 && treatments < 45);
  await repo.append(event(state.cluster, key, { experimentId: state.experiment!.id, arm: "TREATMENT", severe: "POLICY_VIOLATION" }));
  const stopped = await service.evaluate(state.cluster, command(state.revision));
  assert.equal(stopped.states[key], "DISABLED"); assert.equal(stopped.experiment?.status, "HALTED");
  assert.equal((await service.select(pattern, scope, "run")).strategies[0]?.key, "NATIVE_VALUE_SETTER@1");
});
test("Q evidence volume, diverse users and confidence intervals gate staged promotion; rollback retains history", async () => {
  const { service, repo, state, key } = await canary();
  const addSamples = async () => { for (let i = 0; i < 500; i++) {
    await repo.append(event(state.cluster, key, { candidateId: crypto.randomUUID(), experimentId: state.experiment!.id, arm: "TREATMENT" }));
    await repo.append(event(state.cluster, state.experiment!.control, { candidateId: crypto.randomUUID(), experimentId: state.experiment!.id, arm: "CONTROL",
      verified: i < 430, verifierFailed: i >= 430, attribution: i >= 430 ? "VERIFIER" : "NONE" }));
  } };
  await addSamples();
  const stage20 = await service.evaluate(state.cluster, command(state.revision)); assert.equal(stage20.experiment?.percent, 20);
  assert.equal((await service.evaluate(state.cluster, command(stage20.revision))).experiment?.percent, 20);
  await addSamples();
  const stage50 = await service.evaluate(state.cluster, command(stage20.revision)); assert.equal(stage50.experiment?.percent, 50);
  await addSamples();
  const cmd = command(stage50.revision);
  const results = await Promise.allSettled([service.evaluate(state.cluster, cmd), service.evaluate(state.cluster, command(stage50.revision))]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const promoted = (await repo.read(state.cluster))!; assert.equal(promoted.order[0], key); assert.equal(promoted.states[key], "STABLE");
  await assert.rejects(service.control(state.cluster, "NATIVE_VALUE_SETTER@1", "ROLLBACK", command(promoted.revision)), /ROLLBACK_TARGET/);
  const rolled = await service.control(state.cluster, key, "ROLLBACK", command(promoted.revision, "ROLLBACK"));
  assert.equal(rolled.order[0], "NATIVE_VALUE_SETTER@1"); assert.equal(rolled.states[key], "DEGRADED"); assert.equal(repo.events.length, 3000);
});
test("Q failures need multi-user causal evidence; unrelated versions and old evidence never contaminate recent rates", async () => {
  const { repo, service, state } = await setup();
  for (let i = 0; i < 6; i++) await repo.append(event(state.cluster, undefined, { candidateId: crypto.randomUUID(),
    attribution: "EXECUTION", verified: false, executed: false }));
  assert.ok(opportunity(repo.events, "NATIVE_VALUE_SETTER@1", now));
  const result = await service.discover(state.cluster, scope, command(0)); assert.equal(result.status, "PROPOSED");
  assert.equal(metrics(repo.events, "NATIVE_VALUE_SETTER@2", now).recent.attempts, 0);
  assert.equal(metrics(repo.events, "NATIVE_VALUE_SETTER@1", now + 8 * 86400_000).recent.attempts, 0);
});

test("Q canonical fingerprints survive JSONB property reordering and definition replay", () => {
  assert.equal(digest({ z: 1, a: { y: 2, b: 3 } }), digest({ a: { b: 3, y: 2 }, z: 1 }));
  assert.notEqual(digest(["INPUT", "CHANGE"]), digest(["CHANGE", "INPUT"]));
});
test("Q canary verifier spike halts exposure and a site change degrades only its scoped primary", async () => {
  const { service, repo, state, key } = await canary();
  for (let i = 0; i < 40; i++) await repo.append(event(state.cluster, key, { candidateId: crypto.randomUUID(),
    experimentId: state.experiment!.id, arm: "TREATMENT", attribution: "VERIFIER", verified: false, verifierFailed: true }));
  const stopped = await service.evaluate(state.cluster, command(state.revision));
  assert.equal(stopped.states[key], "DEGRADED");
  const other = await service.cluster({ ...pattern, structuralFingerprint: "c".repeat(32) });
  assert.equal(other.states["NATIVE_VALUE_SETTER@1"], "STABLE");
  for (let i = 0; i < 40; i++) await repo.append(event(state.cluster, undefined, { candidateId: crypto.randomUUID(), attribution: "EXECUTION", executed: false, verified: false }));
  const degraded = await service.evaluate(state.cluster, command(stopped.revision));
  assert.equal(degraded.states["NATIVE_VALUE_SETTER@1"], "DEGRADED");
  assert.equal((await service.select(pattern, scope, "run")).strategies[0]?.key, "DIRECT_PROPERTY_EVENTS_FALLBACK@1");
  assert.equal((await repo.read(other.cluster))!.states["NATIVE_VALUE_SETTER@1"], "STABLE");
});
test("Q a single noisy candidate, duplicate evidence and feedback cannot fabricate mature technical success", async () => {
  const { service, repo, state, key } = await canary();
  for (let i = 0; i < 500; i++) {
    await repo.append(event(state.cluster, key, { experimentId: state.experiment!.id, arm: "TREATMENT" }));
    await repo.append(event(state.cluster, state.experiment!.control, { experimentId: state.experiment!.id, arm: "CONTROL", verified: false, attribution: "VERIFIER" }));
  }
  assert.equal((await service.evaluate(state.cluster, command(state.revision))).states[key], "CANARY");
  const technical = event(state.cluster, key);
  const feedback = { ...technical, eventId: digest("feedback"), evidenceKind: "FEEDBACK" as const, attribution: "USER" as const,
    verified: false, executed: false, feedback: "OVERWRITTEN" as const };
  const m = metrics([technical, technical, feedback], key, now).recent;
  assert.equal(m.attempts, 1); assert.equal(m.verifiedSuccesses, 1); assert.equal(m.overwrites, 1);
  assert.equal(StrategyEvidenceSchema.safeParse({ ...technical, answer: "private" }).success, false);
});
test("Q retirement cannot remove primary/fallback dependency and wrong-action replay is rejected", async () => {
  const { service, state } = await setup();
  await assert.rejects(service.control(state.cluster, state.order[0]!, "RETIRE", command(0)), /FALLBACK/);
  await assert.rejects(service.control(state.cluster, state.order[0]!, "ROLLBACK", command(0)), /FALLBACK/);
  const cmd = command(0);
  const disabled = await service.control(state.cluster, state.order[1]!, "DISABLE", cmd);
  assert.equal((await service.control(state.cluster, state.order[1]!, "DISABLE", cmd)).revision, disabled.revision);
  await assert.rejects(service.control(state.cluster, state.order[1]!, "REJECT", cmd), /IDEMPOTENCY/);
});
test("Q P-assisted plans are constrained twice; provider failure and arbitrary code never create production strategies", async () => {
  const { repo, state } = await setup();
  const requests: AiRequest[] = [];
  let response: unknown = { plan: { kind: "TARGET_TEXT", steps: ["SET_NATIVE_VALUE", "INPUT", "CHANGE"] }, reason: "EVENT_SEQUENCE" };
  const adapter: ProviderAdapter = { provider: "GROQ", model: "fixture", maxInputTokens: 100000, inputMicrosPerToken: 0,
    outputMicrosPerToken: 0, privacy: ["FIELD_METADATA_ONLY"], execute: async () => ({ value: response, usage: { inputTokens: 10, outputTokens: 10 } }) };
  const ai = new AiOrchestrator([adapter]);
  const q = new StrategyIntelligenceService(repo, "s".repeat(32), { execute: async (r) => { requests.push(r); return ai.execute(r); } }, () => now);
  for (let i = 0; i < 6; i++) await repo.append(event(state.cluster, undefined, { candidateId: crypto.randomUUID(), attribution: "EXECUTION", verified: false }));
  // First deterministic proposal is retained for review; only the unresolved follow-up uses P.
  const deterministic = await q.discover(state.cluster, scope, command(0)); assert.equal(deterministic.status, "PROPOSED");
  const result = await q.discover(state.cluster, scope, command(1)); assert.equal(result.status, "PROPOSED");
  assert.equal(requests[0]?.taskType, "GENERATE_STRATEGY_CANDIDATE");
  const current = (await repo.read(state.cluster))!;
  assert.equal(current.order[0], "NATIVE_VALUE_SETTER@1");
  response = { plan: { kind: "JAVASCRIPT", code: "unsafe" }, reason: "EVENT_SEQUENCE" };
  const unsafe = await q.discover(state.cluster, { ...scope, candidateId: crypto.randomUUID() }, command(current.revision));
  assert.equal(unsafe.status, "AI_UNAVAILABLE_OR_REJECTED");
  assert.equal(JSON.stringify(requests).includes("candidate@example"), false);
});
test("Q manual structural success creates an opportunity but semantic/representation corrections never do", () => {
  const cluster = "c".repeat(64), rows: StrategyEvidence[] = [];
  for (let i = 0; i < 6; i++) rows.push(event(cluster, undefined, { candidateId: crypto.randomUUID(), attribution: "EXECUTION", verified: false }));
  rows.push({ ...rows[0]!, eventId: digest("manual"), evidenceKind: "FEEDBACK", attribution: "USER", manualCommitted: true,
    manualPattern: ["FOCUS", "TYPE", "ENTER"], feedback: "KEPT" });
  assert.deepEqual(opportunity(rows, "NATIVE_VALUE_SETTER@1", now)?.manualPattern, ["FOCUS", "TYPE", "ENTER"]);
  for (const attribution of ["SEMANTIC", "REPRESENTATION", "TRUTH", "ENTITY", "GRAPH", "POLICY"] as const) {
    assert.equal(opportunity(rows.map((e) => ({ ...e, attribution })), "NATIVE_VALUE_SETTER@1", now), null);
  }
});

test("Q stale proof withdraws exposure and blocks promotion; missing safe control blocks canary", async () => {
  const { repo, service, state, key } = await canary();
  const later = new StrategyIntelligenceService(repo, "s".repeat(32), undefined, () => now + 8 * 86400_000);
  for (let i = 0; i < 100; i++) assert.equal((await later.select(pattern, { ...scope, candidateId: crypto.randomUUID() }, "run")).arm, "STABLE");
  const d = (await repo.definitions()).find((d) => d.key === key)!;
  const proof = { ...state.proofs[key]!, definitionHash: digest(d) };
  await assert.rejects(later.approveOffline(state.cluster, key, proof, { ...command(state.revision), actorId: proof.reviewedBy }), /VALIDATION/);
  const fresh = { ...proof, checkedAt: new Date(now + 8 * 86400_000).toISOString() };
  const renewed = await later.approveOffline(state.cluster, key, { ...fresh, attestation: later.attestProof(fresh) }, { ...command(state.revision), actorId: proof.reviewedBy });
  assert.equal(renewed.states[key], "CANARY"); assert.equal(renewed.experiment?.id, state.experiment?.id);
  const stopped = await service.control(state.cluster, key, "REJECT", command(renewed.revision));
  await assert.rejects(later.approveOffline(state.cluster, key, { ...fresh, attestation: later.attestProof(fresh) }, { ...command(stopped.revision), actorId: proof.reviewedBy }), /TRANSITION/);
  const candidate = await service.propose(state.cluster, { kind: "TARGET_TEXT", steps: ["FOCUS", "SET_NATIVE_VALUE", "INPUT", "CHANGE"] }, "DEVELOPER", command(stopped.revision));
  let current = candidate.state;
  const newDefinition = (await repo.definitions()).find((definition) => definition.key === candidate.key)!;
  const unsigned = { ...proof, definitionHash: digest(newDefinition) };
  current = await service.approveOffline(state.cluster, candidate.key, { ...unsigned, attestation: service.attestProof(unsigned) }, { ...command(current.revision), actorId: proof.reviewedBy });
  for (const stable of current.order) current = await service.control(state.cluster, stable, "DISABLE", command(current.revision));
  await assert.rejects(service.startCanary(state.cluster, candidate.key, command(current.revision)), /FALLBACK/);
  assert.equal((await service.select(pattern, scope, "run")).strategies.length, 0);
});
test("Q latency and independent user-correction spikes halt canaries without erasing technical successes", async () => {
  for (const signal of ["LATENCY", "USER"] as const) {
    const { repo, service, state, key } = await canary();
    for (let i = 0; i < 40; i++) {
      const technical = event(state.cluster, key, { candidateId: crypto.randomUUID(), experimentId: state.experiment!.id, arm: "TREATMENT", durationMs: signal === "LATENCY" ? 500 : 10 });
      await repo.append(technical);
      if (signal === "USER") await repo.append({ ...technical, eventId: digest(crypto.randomUUID()), evidenceKind: "FEEDBACK", attribution: "USER", feedback: "OVERWRITTEN", executed: false, verified: false });
      await repo.append(event(state.cluster, state.experiment!.control, { candidateId: crypto.randomUUID(), experimentId: state.experiment!.id, arm: "CONTROL" }));
    }
    assert.equal(metrics(repo.events, key, now).recent.verifiedSuccesses, 40);
    const halted = await service.evaluate(state.cluster, command(state.revision));
    assert.equal(halted.experiment?.status, "HALTED"); assert.equal(halted.states[key], "DEGRADED");
  }
});

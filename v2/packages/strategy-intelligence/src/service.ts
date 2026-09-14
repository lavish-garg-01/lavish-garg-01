import { createHash, createHmac } from "node:crypto";
import { BUILTIN_STRATEGIES, safeStrategyPlan, type StrategySelection, type StrategyPlan } from "@job-hunter-v2/contracts";
import { FailureAiOutputSchema, StrategyProposalOutputSchema, type AiPort } from "@job-hunter-v2/ai";
import { ClusterStateSchema, DefinitionSchema, LifecycleCommandSchema, OfflineProofSchema, PatternSchema,
  Q_POLICY, type ClusterState, type Definition, type OfflineProof, type Pattern, type Scope, type StrategyRepository, type Transition } from "./model.js";
import { metrics, opportunity, wilson } from "./metrics.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const LIMITS = { minimumSamples: 200, minimumUsers: 20, maximumUserSamples: 10,
  minimumCanarySamples: 30, maximumFailureRate: 0.15, maximumLatencyRatio: 1.25, stages: [5, 20, 50] } as const;
const builtinTime = "2026-09-10T00:00:00.000Z";
export const builtinDefinitions = (): Definition[] => BUILTIN_STRATEGIES.map((s) => DefinitionSchema.parse({
  key: s.key, plan: { kind: "BUILTIN", implementation: s.key }, capabilities: [...s.capabilities],
  representations: [...s.representations], origin: "BUILTIN", verifier: "K_INDEPENDENT_READBACK@1",
  preconditions: "LIVE_TARGET_GRAPH_AUTHORITY_USER_OWNERSHIP", createdAt: builtinTime
}));

export class StrategyIntelligenceService {
  constructor(readonly repository: StrategyRepository, private readonly secret: string, private readonly ai?: AiPort,
    private readonly clock = () => Date.now()) {
    if (secret.length < 32) throw new Error("Q_FINGERPRINT_SECRET_REQUIRED");
  }
  async initialize() { for (const definition of builtinDefinitions()) await this.repository.addDefinition(definition); }
  async cluster(raw: Pattern): Promise<ClusterState> {
    const pattern = PatternSchema.parse(raw), cluster = digest(pattern);
    const existing = await this.repository.read(cluster);
    if (existing) return existing;
    const order = BUILTIN_STRATEGIES.filter((s) => (s.capabilities as readonly string[]).includes(pattern.capability)
      && (s.representations as readonly string[]).includes(pattern.representationKind))
      .sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key)).map((s) => s.key);
    const state = ClusterStateSchema.parse({ cluster, pattern, revision: 0, order,
      states: Object.fromEntries(order.map((key) => [key, "STABLE"])), proofs: {}, experiment: null, previousPrimary: null });
    await this.repository.create(state);
    return (await this.repository.read(cluster))!;
  }
  async select(pattern: Pattern, scope: Scope, applicationRunId: string): Promise<StrategySelection> {
    const state = await this.cluster(pattern);
    const definitions = await this.repository.definitions();
    return this.selection(state, definitions, scope, applicationRunId);
  }
  selection(state: ClusterState, definitions: Definition[], scope: Scope, applicationRunId: string): StrategySelection {
    const pattern = state.pattern;
    let order = state.order.filter((key) => state.states[key] === "STABLE");
    let arm: StrategySelection["arm"] = "STABLE";
    const experiment = state.experiment;
    const proofFresh = experiment && state.proofs[experiment.candidate]
      && this.clock() - Date.parse(state.proofs[experiment.candidate]!.checkedAt) <= 7 * 86400_000;
    if (experiment?.status === "RUNNING" && proofFresh && state.states[experiment.candidate] === "CANARY" && state.states[experiment.control] === "STABLE") {
      const bucket = parseInt(createHmac("sha256", this.secret).update(JSON.stringify([
        scope.accountId, scope.candidateId, applicationRunId, state.cluster, experiment.id
      ])).digest("hex").slice(0, 8), 16) % 100;
      arm = bucket < experiment.percent ? "TREATMENT" : "CONTROL";
      if (arm === "TREATMENT") order = [experiment.candidate, ...order];
    }
    return { policyVersion: Q_POLICY, revision: state.revision, cluster: state.cluster, expiresAt: new Date(this.clock() + 30_000).toISOString(),
      experimentId: experiment?.status === "RUNNING" ? experiment.id : null, arm,
      strategies: order.flatMap((key) => {
        const d = definitions.find((s) => s.key === key);
        return d && d.capabilities.includes(pattern.capability) && d.representations.includes(pattern.representationKind)
          ? [{ key, plan: d.plan }] : [];
      }).slice(0, 10) };
  }
  async propose(cluster: string, plan: unknown, origin: Definition["origin"], command: Transition, sourceEvidence: string[] = []) {
    const state = await this.requireState(cluster), validated = safeStrategyPlan(plan);
    if (!validated || origin === "BUILTIN") throw new Error("Q_UNSAFE_PROPOSAL");
    if (validated.kind === "TARGET_TEXT" && (!['NATIVE_TEXT', 'NATIVE_TEXTAREA'].includes(state.pattern.capability)
      || state.pattern.representationKind !== "TEXT")) throw new Error("Q_INCOMPATIBLE_PROPOSAL");
    if (validated.kind === "BUILTIN") {
      const builtin = builtinDefinitions().find((s) => s.key === validated.implementation)!;
      if (!builtin.capabilities.includes(state.pattern.capability) || !builtin.representations.includes(state.pattern.representationKind)) throw new Error("Q_INCOMPATIBLE_PROPOSAL");
    }
    // Definition identity is a content hash; re-proposal cannot mutate behavior under one version.
    const key = `Q_${digest([cluster, validated]).slice(0, 40).toUpperCase()}@1`;
    const existing = (await this.repository.definitions()).find((d) => d.key === key);
    if (!existing) await this.repository.addDefinition(DefinitionSchema.parse({ key, plan: validated,
      capabilities: [state.pattern.capability], representations: [state.pattern.representationKind], origin, sourceEvidence,
      verifier: "K_INDEPENDENT_READBACK@1", preconditions: "LIVE_TARGET_GRAPH_AUTHORITY_USER_OWNERSHIP",
      createdAt: new Date(this.clock()).toISOString() }));
    const updated = await this.repository.transition(cluster, { ...command, intent: digest(["PROPOSE", key, origin]) }, (current) => {
      if (current.states[key]) return current;
      return { ...current, states: { ...current.states, [key]: "CANDIDATE" } };
    });
    return { key, state: updated };
  }
  async discover(cluster: string, scope: Scope, command: Transition) {
    const state = await this.requireState(cluster);
    const events = await this.repository.evidence(cluster, new Date(this.clock() - 7 * 86400_000).toISOString());
    const gap = state.order.map((key) => opportunity(events, key, this.clock())).find(Boolean);
    if (!gap) return { status: "INSUFFICIENT_EVIDENCE" as const };
    const previousProposals = (await this.repository.definitions()).filter((d) => state.states[d.key]);
    if (previousProposals.some((d) => ["REJECTED", "DISABLED", "RETIRED", "DEGRADED"].includes(state.states[d.key] ?? "")
      && digest(d.sourceEvidence) === digest(gap.sourceEvents))) return { status: "ALREADY_REVIEWED" as const };
    // Reuse existing compatible K mechanisms before asking P for structural analysis.
    const alternative = state.order.find((key) => key !== gap.key && state.states[key] === "STABLE");
    if (alternative && !state.states[`Q_${digest([cluster, { kind: "BUILTIN", implementation: alternative }]).slice(0, 40).toUpperCase()}@1`]) return { status: "PROPOSED" as const,
      ...await this.propose(cluster, { kind: "BUILTIN", implementation: alternative }, "DETERMINISTIC", command, gap.sourceEvents) };
    if (gap.manualPattern.length && ["NATIVE_TEXT", "NATIVE_TEXTAREA"].includes(state.pattern.capability)) {
      const plan: StrategyPlan = { kind: "TARGET_TEXT", steps: ["FOCUS", "SET_NATIVE_VALUE", "INPUT", "CHANGE", "BLUR"] };
      return { status: "PROPOSED" as const, ...await this.propose(cluster, plan, "MANUAL_PATTERN", command, gap.sourceEvents) };
    }
    if (!this.ai) return { status: "DEVELOPER_REVIEW_REQUIRED" as const };
    if (["NATIVE_TEXT", "NATIVE_TEXTAREA"].includes(state.pattern.capability)) {
      const allowedPlans: StrategyPlan[] = [
        { kind: "TARGET_TEXT", steps: ["SET_NATIVE_VALUE", "INPUT", "CHANGE"] },
        { kind: "TARGET_TEXT", steps: ["FOCUS", "SET_DIRECT_VALUE", "INPUT", "CHANGE", "BLUR"] }
      ];
      const result = await this.ai.execute({ schemaVersion: 1, requestId: crypto.randomUUID(), idempotencyKey: command.idempotencyKey,
        scope: { ...scope, applicationId: null }, privacy: "FIELD_METADATA_ONLY", latencyPriority: "BACKGROUND", costPriority: "ECONOMY",
        maxCostMicros: 20_000, maxOutputTokens: 500, minimumConfidence: 0.8, allowFallback: true,
        taskType: "GENERATE_STRATEGY_CANDIDATE", payload: { allowedPlans, failureCount: gap.failures, userCount: gap.users,
          failureClass: "EXECUTION", capability: state.pattern.capability as "NATIVE_TEXT" | "NATIVE_TEXTAREA" } });
      const parsed = result.ok ? StrategyProposalOutputSchema.safeParse(result.value) : null;
      if (!parsed?.success || parsed.data.reason === "INSUFFICIENT_EVIDENCE"
        || !allowedPlans.some((p) => digest(p) === digest(parsed.data.plan))) return { status: "AI_UNAVAILABLE_OR_REJECTED" as const };
      return { status: "PROPOSED" as const, ...await this.propose(cluster, parsed.data.plan, "AI_ASSISTED", command, gap.sourceEvents) };
    }
    const result = await this.ai.execute({ schemaVersion: 1, requestId: crypto.randomUUID(), idempotencyKey: command.idempotencyKey,
      scope: { ...scope, applicationId: null }, privacy: "FIELD_METADATA_ONLY", latencyPriority: "BACKGROUND",
      costPriority: "ECONOMY", maxCostMicros: 20_000, maxOutputTokens: 500, minimumConfidence: 0.8, allowFallback: true,
      taskType: "ANALYZE_EXECUTION_FAILURE", payload: { failureCode: "INTERACTION_REJECTED", strategyIds: state.order,
        evidence: ["READBACK_MISMATCH"] } });
    const output = result.ok ? FailureAiOutputSchema.safeParse(result.value) : null;
    // P cannot add an executable implementation. Unknown mechanisms stay a developer/release task.
    if (!output?.success || !output.data.strategyId || !state.order.includes(output.data.strategyId)) return { status: "AI_UNAVAILABLE_OR_REJECTED" as const };
    return { status: "REVIEW_ANALYSIS" as const, analysis: output.data, sourceEvents: gap.sourceEvents };
  }
  async approveOffline(cluster: string, key: string, raw: OfflineProof, command: Transition) {
    const proof = OfflineProofSchema.parse(raw), definition = (await this.repository.definitions()).find((s) => s.key === key);
    if (!definition || digest(definition) !== proof.definitionHash || !Object.values(proof.checks).every(Boolean)
      || proof.attestation !== this.attestProof(proof) || command.actorId !== proof.reviewedBy
      || Date.parse(proof.checkedAt) > this.clock() || this.clock() - Date.parse(proof.checkedAt) > 7 * 86400_000) throw new Error("Q_OFFLINE_VALIDATION_REQUIRED");
    return this.repository.transition(cluster, { ...command, intent: digest(["APPROVE", key, proof]) }, (state) => {
      // A reviewer can renew a still-running canary's expired offline proof; disabled or
      // rejected versions never regain exposure merely through re-validation.
      if (!["CANDIDATE", "CANARY"].includes(state.states[key] ?? "")) throw new Error("Q_INVALID_TRANSITION");
      return { ...state, proofs: { ...state.proofs, [key]: proof } };
    });
  }
  /** Only an independently executed trusted fixture runner should call this server-side signer. */
  attestProof(proof: Omit<OfflineProof, "attestation"> | OfflineProof): string {
    const unsigned = { ...proof } as Partial<OfflineProof>;
    delete unsigned.attestation;
    return createHmac("sha256", this.secret).update(digest(unsigned)).digest("hex");
  }
  async startCanary(cluster: string, key: string, command: Transition) {
    const id = crypto.randomUUID();
    return this.repository.transition(cluster, { ...command, intent: digest(["CANARY", key]) }, (state) => {
      if (state.states[key] !== "CANDIDATE" || !state.proofs[key] || state.experiment?.status === "RUNNING"
        || this.clock() - Date.parse(state.proofs[key].checkedAt) > 7 * 86400_000) throw new Error("Q_CANARY_NOT_ELIGIBLE");
      const control = state.order.find((s) => state.states[s] === "STABLE");
      if (!control) throw new Error("Q_STABLE_FALLBACK_REQUIRED");
      return { ...state, states: { ...state.states, [key]: "CANARY" }, experiment: { id, candidate: key, control,
        percent: 5, startedAt: new Date(this.clock()).toISOString(), status: "RUNNING", assessedTreatmentSamples: 0, assessedControlSamples: 0 } };
    });
  }
  async evaluate(cluster: string, command: Transition) {
    LifecycleCommandSchema.parse(command);
    command = { ...command, intent: digest(["EVALUATE", cluster]) };
    const replay = await this.repository.replay(cluster, command);
    if (replay) return replay;
    const state = await this.requireState(cluster), experiment = state.experiment;
    if (state.revision !== command.expectedRevision) throw new Error("Q_REVISION_CONFLICT");
    if (!experiment || experiment.status !== "RUNNING") return this.evaluateStable(state, command);
    const all = (await this.repository.evidence(cluster, experiment.startedAt)).filter((e) => e.experimentId === experiment.id);
    // Cap each candidate's influence per arm; all safety evidence is still checked below.
    const counts = new Map<string, number>();
    const balanced = all.filter((e) => e.evidenceKind !== "FEEDBACK").filter((e) => {
      const unit = `${e.accountId}:${e.candidateId}:${e.arm}`;
      const count = counts.get(unit) ?? 0; counts.set(unit, count + 1);
      return count < LIMITS.maximumUserSamples;
    });
    const selectedOperations = new Set(balanced.map((e) => e.operationId));
    const withFeedback = [...balanced, ...all.filter((e) => e.evidenceKind === "FEEDBACK" && selectedOperations.has(e.operationId))];
    const treatment = metrics(withFeedback.filter((e) => e.arm === "TREATMENT" && e.attempt === 1), experiment.candidate, this.clock()).recent;
    const control = metrics(withFeedback.filter((e) => e.arm === "CONTROL" && e.attempt === 1), experiment.control, this.clock()).recent;
    const candidateEvents = all.filter((e) => e.key === experiment.candidate);
    const severe = candidateEvents.some((e) => e.severe !== "NONE");
    const controlUnsafe = all.some((e) => e.key === experiment.control && e.severe !== "NONE");
    const regression = treatment.attempts >= LIMITS.minimumCanarySamples && (
      1 - treatment.successRate > LIMITS.maximumFailureRate
      || (control.attempts >= 30 && (treatment.userRate > control.userRate + 0.1 || treatment.meanLatency > Math.max(100, control.meanLatency * 2))));
    const intent = command;
    if (severe || regression || controlUnsafe) return this.repository.transition(cluster, intent, (s) => ({ ...s,
      states: { ...s.states, [experiment.candidate]: severe ? "DISABLED" : "DEGRADED",
        ...(controlUnsafe ? { [experiment.control]: "DISABLED" as const } : {}) },
      experiment: { ...experiment, status: "HALTED" } }));
    const enough = treatment.attempts >= LIMITS.minimumSamples && control.attempts >= LIMITS.minimumSamples
      && treatment.attempts - experiment.assessedTreatmentSamples >= LIMITS.minimumSamples
      && control.attempts - experiment.assessedControlSamples >= LIMITS.minimumSamples
      && treatment.users >= LIMITS.minimumUsers && control.users >= LIMITS.minimumUsers;
    const better = wilson(treatment.verifiedSuccesses, treatment.attempts)[0] > wilson(control.verifiedSuccesses, control.attempts)[1]
      && treatment.meanLatency <= Math.max(50, control.meanLatency * LIMITS.maximumLatencyRatio)
      && treatment.fallbackRate <= control.fallbackRate + 0.02 && treatment.userRate <= control.userRate + 0.02;
    const proof = state.proofs[experiment.candidate];
    if (!enough || !better || !proof || this.clock() - Date.parse(proof.checkedAt) > 7 * 86400_000) return state;
    return this.repository.transition(cluster, intent, (s) => {
      if (experiment.percent !== 50) return { ...s, experiment: { ...experiment, percent: experiment.percent === 5 ? 20 : 50,
        assessedTreatmentSamples: treatment.attempts, assessedControlSamples: control.attempts } };
      return { ...s, states: { ...s.states, [experiment.candidate]: "STABLE" },
        order: [experiment.candidate, ...s.order.filter((key) => key !== experiment.candidate)],
        previousPrimary: experiment.control, experiment: { ...experiment, status: "PROMOTED" } };
    });
  }
  private async evaluateStable(state: ClusterState, command: Transition) {
    const key = state.order.find((k) => state.states[k] === "STABLE");
    if (!key) return state;
    const events = await this.repository.evidence(state.cluster, new Date(this.clock() - 7 * 86400_000).toISOString());
    const m = metrics(events, key, this.clock()).recent;
    if (!m.severe && !(m.attempts >= 30 && m.users >= 3 && m.successRate < 0.8)) return state;
    return this.repository.transition(state.cluster, command, (s) => ({ ...s,
      states: { ...s.states, [key]: m.severe ? "DISABLED" : "DEGRADED" } }));
  }
  async control(cluster: string, key: string, action: "DISABLE" | "REJECT" | "ROLLBACK" | "RETIRE", command: Transition) {
    return this.repository.transition(cluster, { ...command, intent: digest(["CONTROL", key, action]) }, (s) => {
      if (!s.states[key]) throw new Error("Q_STRATEGY_NOT_FOUND");
      if (action === "ROLLBACK" && (!s.previousPrimary || s.states[s.previousPrimary] !== "STABLE")) throw new Error("Q_STABLE_FALLBACK_REQUIRED");
      if (action === "ROLLBACK" && (s.order[0] !== key || s.previousPrimary === key)) throw new Error("Q_ROLLBACK_TARGET_REQUIRED");
      if (action === "RETIRE" && (s.order[0] === key || s.previousPrimary === key || (s.experiment?.status === "RUNNING" && s.experiment.control === key)
        || !s.order.some((other) => other !== key && s.states[other] === "STABLE"))) throw new Error("Q_FALLBACK_DEPENDENCY");
      const states = { ...s.states, [key]: action === "DISABLE" ? "DISABLED" as const : action === "REJECT" ? "REJECTED" as const : action === "RETIRE" ? "RETIRED" as const : "DEGRADED" as const };
      return { ...s, states, order: action === "ROLLBACK" ? [s.previousPrimary!, ...s.order.filter((k) => k !== s.previousPrimary)] : s.order,
        experiment: s.experiment && [s.experiment.candidate, s.experiment.control].includes(key) ? { ...s.experiment, status: "HALTED" } : s.experiment };
    });
  }
  private async requireState(cluster: string) { const state = await this.repository.read(cluster); if (!state) throw new Error("Q_CLUSTER_NOT_FOUND"); return state; }
}

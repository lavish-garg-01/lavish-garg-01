import { z } from "zod";
import { FieldCapabilitySchema, StrategyKeySchema, StrategyPlanSchema, StrategySelectionSchema, safeStrategyPlan } from "@job-hunter-v2/contracts";

export const Q_POLICY = "Q1-2026-09" as const;
export const StrategyStatusSchema = z.enum(["STABLE", "CANDIDATE", "CANARY", "DEGRADED", "DISABLED", "RETIRED", "REJECTED"]);
export const PatternSchema = z.object({
  capability: FieldCapabilitySchema,
  representationKind: z.enum(["TEXT", "DATE", "BOOLEAN", "SINGLE_OPTION", "MULTI_OPTION"]),
  representationId: z.string().regex(/^[A-Z0-9_]+@\d+$/).max(120),
  // Server derives buckets, never a caller-provided hostname or raw DOM dump.
  structuralFingerprint: z.string().regex(/^[a-f0-9]{8,64}$/),
  siteFamily: z.enum(["GREENHOUSE", "LEVER", "WORKDAY", "ASHBY", "OTHER"])
}).strict();
export type Pattern = z.infer<typeof PatternSchema>;
export const DefinitionSchema = z.object({
  sourceEvidence: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20).default([]),
  key: StrategyKeySchema, plan: StrategyPlanSchema,
  capabilities: z.array(FieldCapabilitySchema).min(1).max(17),
  representations: z.array(PatternSchema.shape.representationKind).min(1).max(5),
  origin: z.enum(["BUILTIN", "DETERMINISTIC", "MANUAL_PATTERN", "AI_ASSISTED", "DEVELOPER"]),
  verifier: z.literal("K_INDEPENDENT_READBACK@1"),
  preconditions: z.literal("LIVE_TARGET_GRAPH_AUTHORITY_USER_OWNERSHIP"),
  createdAt: z.iso.datetime()
}).strict().refine((definition) => Boolean(safeStrategyPlan(definition.plan)), "UNSAFE_STRATEGY_PLAN");
export type Definition = z.infer<typeof DefinitionSchema>;
export const AttributionSchema = z.enum(["SCANNER_RUNTIME", "SEMANTIC", "ENTITY", "GRAPH", "TRUTH", "REPRESENTATION", "EXECUTION", "VERIFIER", "USER", "SITE_CHANGE", "POLICY", "UNKNOWN", "NONE"]);
export type Attribution = z.infer<typeof AttributionSchema>;
export const StrategyEvidenceSchema = z.object({
  evidenceKind: z.enum(["TECHNICAL", "FEEDBACK"]).default("TECHNICAL"),
  eventId: z.string().regex(/^[a-f0-9]{64}$/), accountId: z.uuid(), candidateId: z.uuid(),
  applicationRunId: z.uuid(), operationId: z.uuid(), key: StrategyKeySchema,
  cluster: z.string().regex(/^[a-f0-9]{64}$/), occurredAt: z.iso.datetime(),
  experimentId: z.uuid().nullable(), arm: z.enum(["STABLE", "CONTROL", "TREATMENT"]),
  attribution: AttributionSchema, executed: z.boolean(), verified: z.boolean(),
  verifierFailed: z.boolean(), attempt: z.number().int().min(1).max(3),
  durationMs: z.number().int().min(0).max(300_000), fallback: z.boolean(),
  feedback: z.enum(["NONE", "KEPT", "OVERWRITTEN"]),
  severe: z.enum(["NONE", "OUTSIDE_TARGET", "NAVIGATION", "POLICY_VIOLATION"]),
  manualPattern: z.array(z.enum(["FOCUS", "TYPE", "OPTIONS_APPEARED", "ARROW_DOWN", "ENTER", "BLUR"])).max(12),
  manualCommitted: z.boolean(), containsCandidateValue: z.literal(false)
}).strict();
export type StrategyEvidence = z.infer<typeof StrategyEvidenceSchema>;
export const OfflineProofSchema = z.object({
  attestation: z.string().regex(/^[a-f0-9]{64}$/),
  definitionHash: z.string().regex(/^[a-f0-9]{64}$/),
  suiteVersion: z.string().regex(/^Q_FIXTURES@[1-9][0-9]*$/),
  checks: z.object({ targetOnly: z.boolean(), events: z.boolean(), verifier: z.boolean(), rerender: z.boolean(),
    failure: z.boolean(), bounded: z.boolean(), userIntervention: z.boolean(), dynamic: z.boolean(),
    declaration: z.boolean(), deduplication: z.boolean(), regression: z.boolean(), browser: z.boolean() }).strict(),
  reviewedBy: z.uuid(), checkedAt: z.iso.datetime()
}).strict();
export type OfflineProof = z.infer<typeof OfflineProofSchema>;
export const ClusterStateSchema = z.object({
  cluster: z.string().regex(/^[a-f0-9]{64}$/), pattern: PatternSchema, revision: z.number().int().nonnegative(),
  states: z.record(z.string(), StrategyStatusSchema), order: z.array(StrategyKeySchema).max(30),
  proofs: z.record(z.string(), OfflineProofSchema),
  experiment: z.object({ id: z.uuid(), candidate: StrategyKeySchema, control: StrategyKeySchema,
    percent: z.union([z.literal(5), z.literal(20), z.literal(50)]), startedAt: z.iso.datetime(),
    status: z.enum(["RUNNING", "HALTED", "PROMOTED"]), assessedTreatmentSamples: z.number().int().nonnegative(),
    assessedControlSamples: z.number().int().nonnegative() }).strict().nullable(),
  previousPrimary: StrategyKeySchema.nullable()
}).strict();
export type ClusterState = z.infer<typeof ClusterStateSchema>;
export interface Scope { accountId: string; candidateId: string }
export const BindingSchema = z.object({
  accountId: z.uuid(), candidateId: z.uuid(), applicationRunId: z.uuid(), operationId: z.uuid(),
  pageInstanceId: z.uuid(), fieldRuntimeId: z.string().min(8).max(100),
  representationId: z.string().regex(/^[A-Z0-9_]+@\d+$/).max(120),
  selection: StrategySelectionSchema, recordedAt: z.iso.datetime()
}).strict();
export type Binding = z.infer<typeof BindingSchema>;
export interface Transition { idempotencyKey: string; expectedRevision: number; actorId: string; reason: string; intent?: string }
export const LifecycleCommandSchema = z.object({
  idempotencyKey: z.string().min(8).max(160), expectedRevision: z.number().int().nonnegative(), actorId: z.uuid(),
  reason: z.enum(["OFFLINE_APPROVED", "EVIDENCE_EVALUATION", "SAFETY_STOP", "REVIEW_REJECTED", "EMERGENCY_DISABLE", "ROLLBACK", "COVERED_OBSOLETE"]),
  intent: z.string().regex(/^[a-f0-9]{64}$/).optional()
}).strict();
export interface StrategyRepository {
  definitions(): Promise<Definition[]>;
  addDefinition(definition: Definition): Promise<void>;
  read(cluster: string): Promise<ClusterState | null>;
  create(state: ClusterState): Promise<void>;
  replay(cluster: string, command: Transition): Promise<ClusterState | null>;
  transition(cluster: string, command: Transition, mutate: (state: ClusterState) => ClusterState): Promise<ClusterState>;
  append(evidence: StrategyEvidence): Promise<void>;
  evidence(cluster: string, since: string): Promise<StrategyEvidence[]>;
}

import { z } from "zod";

export const FORM_GRAPH_CONTRACT_VERSION = 1 as const;

export const FormGraphNodeTypeSchema = z.enum([
  "FIELD", "FIELD_GROUP", "REPEAT_GROUP", "SECTION", "ACTION", "STEP", "VALIDATION_GATE"
]);
export type FormGraphNodeType = z.infer<typeof FormGraphNodeTypeSchema>;

export const FormGraphActionKindSchema = z.enum([
  "ADD_REPEAT", "REMOVE_REPEAT", "NEXT", "CONTINUE", "SAVE", "EXPAND", "EDIT", "SUBMIT", "OTHER"
]);
export type FormGraphActionKind = z.infer<typeof FormGraphActionKindSchema>;

export const FormGraphNodeStateSchema = z.enum([
  "REACHABLE", "BLOCKED", "CONDITIONAL", "HIDDEN", "DISABLED", "STALE", "COMPLETED", "NEEDS_USER", "UNRESOLVED"
]);
export type FormGraphNodeState = z.infer<typeof FormGraphNodeStateSchema>;

export const FormGraphEdgeTypeSchema = z.enum([
  "CONTAINS", "DEPENDS_ON", "REVEALS", "HIDES", "ENABLES", "OPTIONS_DEPEND_ON",
  "NAVIGATES_TO", "CREATES_REPEAT_GROUP", "REQUIRES_VALID", "EXECUTION_BEFORE"
]);
export type FormGraphEdgeType = z.infer<typeof FormGraphEdgeTypeSchema>;

export const FormGraphEvidenceKindSchema = z.enum([
  "DECLARED_DOM_RELATION", "OBSERVED_TRANSITION", "REPEATED_OBSERVATION", "STRUCTURAL_INFERENCE", "AI_SUGGESTED"
]);
export type FormGraphEvidenceKind = z.infer<typeof FormGraphEvidenceKindSchema>;

export const FormGraphFailureCodeSchema = z.enum([
  "GRAPH_NODE_STALE", "GRAPH_REVISION_STALE", "DEPENDENCY_UNRESOLVED", "DEPENDENCY_AMBIGUOUS",
  "GRAPH_NOT_CONVERGED", "UNEXPECTED_GRAPH_TRANSITION", "EXPECTED_NODE_NOT_REVEALED",
  "UNEXPECTED_NODE_REMOVED", "STEP_TRANSITION_FAILED", "VALIDATION_GATE_BLOCKED",
  "DYNAMIC_OPTIONS_NOT_READY", "GRAPH_CYCLE_DETECTED", "FORM_STRUCTURE_UNSUPPORTED",
  "MALFORMED_GRAPH_EVIDENCE", "REPEATED_GRAPH_STATE"
]);
export type FormGraphFailureCode = z.infer<typeof FormGraphFailureCodeSchema>;

export const FormGraphPredicateSchema = z.object({
  kind: z.enum(["ALWAYS", "BOOLEAN_IS", "OPTION_IS", "NODE_COMPLETED", "NODE_VALID", "UNKNOWN"]),
  expectedBoolean: z.boolean().nullable(),
  normalizedOperandHash: z.string().length(64).regex(/^[a-f0-9]+$/).nullable()
}).strict().superRefine((value, context) => {
  if (value.kind === "BOOLEAN_IS" && value.expectedBoolean === null) {
    context.addIssue({ code: "custom", message: "BOOLEAN_PREDICATE_REQUIRES_EXPECTED_BOOLEAN" });
  }
  if (value.kind === "OPTION_IS" && value.normalizedOperandHash === null) {
    context.addIssue({ code: "custom", message: "OPTION_PREDICATE_REQUIRES_HASH" });
  }
});
export type FormGraphPredicate = z.infer<typeof FormGraphPredicateSchema>;

export const FormGraphNodeSchema = z.object({
  graphNodeId: z.string().regex(/^graph:[a-z_]+:[a-f0-9]{8,64}$/).max(100),
  nodeType: FormGraphNodeTypeSchema,
  pageInstanceId: z.uuid(),
  formInstanceId: z.string().min(8).max(100).nullable(),
  logicalFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  parentGraphNodeId: z.string().regex(/^graph:[a-z_]+:[a-f0-9]{8,64}$/).max(100).nullable(),
  fieldRuntimeId: z.string().min(8).max(100).nullable(),
  controlFingerprint: z.string().min(8).max(80).nullable(),
  formRepeatGroupId: z.string().min(8).max(100).nullable(),
  actionKind: FormGraphActionKindSchema.nullable(),
  semanticRole: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(80).nullable(),
  state: FormGraphNodeStateSchema,
  visible: z.boolean(),
  enabled: z.boolean(),
  required: z.boolean(),
  currentStep: z.boolean(),
  technical: z.boolean(),
  optionFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/).nullable(),
  optionCount: z.number().int().nonnegative().max(10_000),
  validationState: z.enum(["NONE", "VALID", "INVALID", "UNKNOWN"]),
  validationErrorCount: z.number().int().nonnegative().max(1_000),
  declaredTargetKeys: z.array(z.string().length(64).regex(/^[a-f0-9]+$/)).max(20),
  evidence: z.array(FormGraphEvidenceKindSchema).min(1).max(8),
  confidence: z.number().min(0).max(1),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict().superRefine((value, context) => {
  if (value.nodeType === "FIELD" && (!value.fieldRuntimeId || !value.controlFingerprint)) {
    context.addIssue({ code: "custom", message: "FIELD_NODE_REQUIRES_FIELD_IDENTITY" });
  }
  if (value.nodeType === "ACTION" && !value.actionKind) {
    context.addIssue({ code: "custom", message: "ACTION_NODE_REQUIRES_KIND" });
  }
  if (value.technical && value.state === "REACHABLE") {
    context.addIssue({ code: "custom", message: "TECHNICAL_NODE_CANNOT_BE_REACHABLE" });
  }
});
export type FormGraphNode = z.infer<typeof FormGraphNodeSchema>;

export const FormGraphEdgeSchema = z.object({
  graphEdgeId: z.string().regex(/^edge:[a-f0-9]{8,64}$/).max(80),
  edgeType: FormGraphEdgeTypeSchema,
  sourceGraphNodeId: z.string().regex(/^graph:[a-z_]+:[a-f0-9]{8,64}$/).max(100),
  targetGraphNodeId: z.string().regex(/^graph:[a-z_]+:[a-f0-9]{8,64}$/).max(100),
  predicate: FormGraphPredicateSchema,
  evidence: z.array(FormGraphEvidenceKindSchema).min(1).max(8),
  confidence: z.number().min(0).max(1),
  scope: z.enum(["RUNTIME", "SITE_TEMPLATE"]),
  executable: z.boolean(),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict().superRefine((value, context) => {
  if (value.sourceGraphNodeId === value.targetGraphNodeId) {
    context.addIssue({ code: "custom", message: "SELF_EDGE_NOT_ALLOWED" });
  }
  if (value.evidence.includes("AI_SUGGESTED") && value.executable) {
    context.addIssue({ code: "custom", message: "AI_ONLY_EDGE_CANNOT_AUTHORIZE_EXECUTION" });
  }
});
export type FormGraphEdge = z.infer<typeof FormGraphEdgeSchema>;

export const FormGraphObservationSchema = z.object({
  schemaVersion: z.literal(FORM_GRAPH_CONTRACT_VERSION),
  observationId: z.uuid(),
  applicationRunId: z.uuid().nullable(),
  pageInstanceId: z.uuid(),
  routeFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  observedAt: z.iso.datetime(),
  nodes: z.array(FormGraphNodeSchema).max(2_000),
  edges: z.array(FormGraphEdgeSchema).max(6_000),
  source: z.enum(["INITIAL_SCAN", "MUTATION_BATCH", "USER_ACTION", "COPILOT_ACTION", "RECOVERY", "NAVIGATION"]),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type FormGraphObservation = z.infer<typeof FormGraphObservationSchema>;

export const FormGraphDeltaTypeSchema = z.enum([
  "NODE_ADDED", "NODE_REMOVED", "NODE_CHANGED", "EDGE_ADDED", "EDGE_REMOVED",
  "OPTIONS_CHANGED", "REQUIREDNESS_CHANGED", "VISIBILITY_CHANGED", "ENABLEDNESS_CHANGED", "STEP_CHANGED"
]);
export type FormGraphDeltaType = z.infer<typeof FormGraphDeltaTypeSchema>;

export const FormGraphDeltaItemSchema = z.object({
  deltaType: FormGraphDeltaTypeSchema,
  graphNodeId: z.string().max(100).nullable(),
  graphEdgeId: z.string().max(80).nullable(),
  beforeFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/).nullable(),
  afterFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/).nullable()
}).strict();
export type FormGraphDeltaItem = z.infer<typeof FormGraphDeltaItemSchema>;

export const FormGraphDeltaSchema = z.object({
  fromRevision: z.number().int().nonnegative(),
  toRevision: z.number().int().positive(),
  material: z.boolean(),
  items: z.array(FormGraphDeltaItemSchema).max(8_000),
  affectedGraphNodeIds: z.array(z.string().max(100)).max(2_000),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type FormGraphDelta = z.infer<typeof FormGraphDeltaSchema>;

export const FormGraphSnapshotSchema = z.object({
  schemaVersion: z.literal(FORM_GRAPH_CONTRACT_VERSION),
  applicationRunId: z.uuid().nullable(),
  pageInstanceId: z.uuid(),
  graphRevision: z.number().int().positive(),
  graphFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  routeFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  observedAt: z.iso.datetime(),
  stable: z.boolean(),
  nodes: z.array(FormGraphNodeSchema).max(2_000),
  edges: z.array(FormGraphEdgeSchema).max(6_000),
  failures: z.array(FormGraphFailureCodeSchema).max(20),
  summary: z.object({
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    reachableFieldCount: z.number().int().nonnegative(),
    blockingFieldCount: z.number().int().nonnegative(),
    stepCount: z.number().int().nonnegative(),
    validationErrorCount: z.number().int().nonnegative()
  }).strict(),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type FormGraphSnapshot = z.infer<typeof FormGraphSnapshotSchema>;

export const FormGraphGuardSchema = z.object({
  pageInstanceId: z.uuid(),
  graphRevision: z.number().int().positive(),
  graphFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/)
}).strict();
export type FormGraphGuard = z.infer<typeof FormGraphGuardSchema>;

export const FormGraphTransitionReceiptSchema = z.object({
  schemaVersion: z.literal(FORM_GRAPH_CONTRACT_VERSION),
  transitionId: z.uuid(),
  operationId: z.uuid().nullable(),
  origin: z.enum(["COPILOT", "CANDIDATE", "BROWSER", "UNKNOWN"]),
  before: FormGraphGuardSchema,
  after: FormGraphGuardSchema,
  delta: FormGraphDeltaSchema,
  expected: z.boolean(),
  failureCode: FormGraphFailureCodeSchema.nullable(),
  durationMs: z.number().int().nonnegative().max(300_000),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type FormGraphTransitionReceipt = z.infer<typeof FormGraphTransitionReceiptSchema>;

export const FormGraphFieldReadinessSchema = z.object({
  graphNodeId: z.string().max(100),
  semanticSafe: z.boolean(),
  entityBindingSafe: z.boolean(),
  answerAllowed: z.boolean(),
  capabilitySupported: z.boolean(),
  ownershipAllowed: z.boolean(),
  completed: z.boolean()
}).strict();
export type FormGraphFieldReadiness = z.infer<typeof FormGraphFieldReadinessSchema>;

export const FormGraphFrontierSchema = z.object({
  guard: FormGraphGuardSchema,
  executableGraphNodeIds: z.array(z.string().max(100)).max(500),
  needsUserGraphNodeIds: z.array(z.string().max(100)).max(500),
  blockedGraphNodeIds: z.array(z.string().max(100)).max(2_000),
  readyForNavigation: z.boolean(),
  failures: z.array(FormGraphFailureCodeSchema).max(20),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict();
export type FormGraphFrontier = z.infer<typeof FormGraphFrontierSchema>;

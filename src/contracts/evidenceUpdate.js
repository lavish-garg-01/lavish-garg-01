import { z } from "zod";

export const EVIDENCE_UPDATE_VERSION = 1;

const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const basisPoints = z.number().int().min(0).max(10_000);

export const evidenceLayerSchema = z.enum([
    "SEMANTIC_MAPPING",
    "CANDIDATE_ANSWER",
    "REPRESENTATION",
    "INTERACTION_STRATEGY",
    "ACCEPTANCE",
    "FORM_SCHEMA",
    "ENTITY_BINDING"
]);

/**
 * Value-free evidence exchanged between the classifier and the adaptive
 * evidence kernel. It intentionally contains no candidate answer or hash
 * derived from a protected value.
 */
export const evidenceUpdateSchema = z.object({
    schemaVersion: z.literal(EVIDENCE_UPDATE_VERSION),
    evidenceId: id,
    observationId: id,
    classificationHash: hash,
    runId: id,
    applicationId: id,
    layer: evidenceLayerSchema,
    subjectType: z.enum([
        "CANONICAL_MAPPING", "CANONICAL_ANSWER", "REPRESENTATION_RULE",
        "INTERACTION_STRATEGY", "FIELD_ACCEPTANCE", "FORM_SCHEMA", "ENTITY_BINDING"
    ]),
    subjectKey: z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
    subjectKeyHash: hash,
    aggregationScope: z.enum(["CANDIDATE_PRIVATE", "SHARED_REDACTED"]),
    scopeType: z.enum(["GLOBAL", "CANDIDATE", "APPLICATION", "FORM_FAMILY", "FIELD_FINGERPRINT"]),
    scopeKeyHash: hash.nullable(),
    direction: z.enum(["POSITIVE", "NEGATIVE", "UNKNOWN"]),
    source: z.enum([
        "EXPLICIT_SEMANTIC", "CHECKPOINT_CLASSIFIER", "STABLE_READBACK",
        "EMPLOYER_VALIDATION", "HUMAN_OBSERVATION", "SCHEMA_OBSERVATION"
    ]),
    executionContext: z.enum(["DIRECT", "RESCUE", "PROVISIONAL_DIRECT", "NOT_APPLICABLE"]),
    checkpointType: z.enum(["NONE", "LOCAL_VALIDITY", "PAGE_ADVANCE", "REVIEW", "SUBMISSION", "EXPLICIT_SAVE"]),
    context: z.object({
        baseWeight: z.number().int().min(0).max(10_000),
        sourceReliabilityBps: basisPoints,
        checkpointStrengthBps: basisPoints,
        attributionConfidenceBps: basisPoints,
        sampleQualityBps: basisPoints,
        recencyBps: basisPoints,
        scopeSimilarityBps: basisPoints,
        completionStrengthBps: basisPoints,
        riskMultiplierBps: z.number().int().min(0).max(20_000),
        extensionTrustBps: basisPoints
    }).strict(),
    formFingerprint: hash.nullable(),
    extensionVersion: z.string().max(80).nullable(),
    adapterVersion: z.string().max(80).nullable(),
    occurredAtMs: z.number().int().nonnegative(),
    reasonCodes: z.array(z.string().min(1).max(120)).max(12),
    valueFree: z.literal(true),
    containsProtectedValue: z.literal(false)
}).strict().superRefine((value, context) => {
    if (value.scopeType === "GLOBAL" && value.scopeKeyHash !== null) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Global evidence cannot carry a scope key." });
    }
    if (value.scopeType !== "GLOBAL" && value.scopeKeyHash === null) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Scoped evidence requires a scope-key hash." });
    }
    if (value.direction === "UNKNOWN" && value.context.baseWeight !== 0) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown evidence must have zero base weight." });
    }
    if (value.layer !== "INTERACTION_STRATEGY" && value.executionContext !== "NOT_APPLICABLE") {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Execution context applies only to strategy evidence." });
    }
});

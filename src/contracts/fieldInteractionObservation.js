import crypto from "node:crypto";
import { z } from "zod";

export const FIELD_INTERACTION_OBSERVATION_VERSION = 1;

const boundedText = (max) => z.string().max(max);
const nullableHash = z.string().regex(/^[a-f0-9]{64}$/).nullable();

const checkpointSchema = z.object({
    type: z.enum(["NONE", "LOCAL_VALIDITY", "PAGE_ADVANCE", "REVIEW", "SUBMISSION", "EXPLICIT_SAVE"]).default("NONE"),
    status: z.enum(["NOT_OBSERVED", "VERIFIED", "REJECTED", "ABANDONED", "UNKNOWN"]).default("NOT_OBSERVED")
}).strict();

export const fieldInteractionObservationSchema = z.object({
    schemaVersion: z.literal(FIELD_INTERACTION_OBSERVATION_VERSION),
    observationId: boundedText(120),
    applicationId: boundedText(120),
    attemptId: boundedText(120),
    operationId: boundedText(120).nullable(),
    logicalFieldId: boundedText(240),
    fieldSignatureHash: nullableHash,
    eventType: z.enum([
        "DETECTED", "NOT_ATTEMPTED", "FILL_ATTEMPTED", "FILLED", "FILL_FAILED",
        "SNAPSHOT_LIE", "LEGAL_BLOCK", "USER_CORRECTED", "HIDDEN", "UNCHANGED",
        "BLOCKED", "INVALID", "OBSERVED"
    ]),
    protected: z.boolean(),
    semantic: z.object({
        canonicalKey: boundedText(140).nullable(),
        mappingId: boundedText(160).nullable(),
        explicitEvidence: z.enum(["NONE", "CONFIRMED", "CORRECTED"]).default("NONE")
    }).strict(),
    answer: z.object({
        source: boundedText(80),
        beforeValueHash: nullableHash,
        intendedValueHash: nullableHash,
        finalValueHash: nullableHash,
        normalizedEquivalent: z.boolean().nullable(),
        userEdited: z.boolean(),
        completedByUser: z.boolean()
    }).strict(),
    representation: z.object({
        ruleId: boundedText(160).nullable(),
        intendedValueHash: nullableHash,
        finalValueHash: nullableHash,
        equivalentTruth: z.boolean().nullable(),
        changed: z.boolean(),
        originalRejected: z.boolean(),
        bothEmployerValid: z.boolean()
    }).strict(),
    strategy: z.object({
        strategyId: boundedText(160).nullable(),
        attempted: z.boolean(),
        readback: z.enum(["NOT_OBSERVED", "MATCH", "MISMATCH", "REVERTED"]),
        employerValidation: z.enum(["NOT_OBSERVED", "ACCEPTED", "REJECTED"]),
        cleanup: z.enum(["NOT_REQUIRED", "CLEAN", "RESTORED", "DIRTY", "UNKNOWN"])
    }).strict(),
    checkpoint: checkpointSchema,
    clientTimeMs: z.number().int().nonnegative()
}).strict();

function text(value, max) {
    const normalized = String(value == null ? "" : value).trim().slice(0, max);
    return normalized || null;
}

function hash(value, protectedField) {
    if (protectedField || value == null || String(value) === "") return null;
    const token = String(value).toLowerCase();
    if (/^[a-f0-9]{64}$/.test(token)) return token;
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function eventType(field = {}) {
    const value = String(field.fillOutcome || field.fill_outcome || field.finalState || field.final_state || "OBSERVED").toUpperCase();
    return fieldInteractionObservationSchema.shape.eventType.safeParse(value).success ? value : "OBSERVED";
}

function readback(field = {}) {
    const explicit = String(field.readback || field.readbackStatus || "").toUpperCase();
    if (["MATCH", "MISMATCH", "REVERTED", "NOT_OBSERVED"].includes(explicit)) return explicit;
    if (field.stableReadbackMatched === true || field.readbackMatched === true) return "MATCH";
    if (field.valueReverted === true) return "REVERTED";
    if (field.stableReadbackMatched === false || field.readbackMatched === false) return "MISMATCH";
    return "NOT_OBSERVED";
}

function employerValidation(field = {}) {
    const explicit = String(field.employerValidation || field.validationStatus || "").toUpperCase();
    if (["ACCEPTED", "REJECTED", "NOT_OBSERVED"].includes(explicit)) return explicit;
    if (field.valid === true) return "ACCEPTED";
    if (field.valid === false) return "REJECTED";
    return "NOT_OBSERVED";
}

function checkpoint(field = {}, context = {}) {
    const source = context.checkpoint || field.checkpoint || {};
    return checkpointSchema.parse({
        type: String(source.type || "NONE").toUpperCase(),
        status: String(source.status || "NOT_OBSERVED").toUpperCase()
    });
}

/**
 * Creates the private, value-free observation consumed by the Phase 0
 * classifier. Raw candidate values are never part of the returned contract.
 */
export function buildFieldInteractionObservation(field = {}, context = {}) {
    const protectedField = Boolean(field.legal || field.sensitive || context.protected)
        || String(field.type || field.fieldType || "").toLowerCase() === "password";
    const signature = text(field.fieldSignature || field.field_signature || field.portalFieldKey || field.id, 500);
    const applicationId = text(context.applicationId, 120) || "unknown-application";
    const attemptId = text(context.attemptId, 120) || "unknown-attempt";
    const logicalFieldId = text(field.logicalFieldId || field.fieldLogicalId || field.id || signature, 240) || "unknown-field";
    const finalHash = hash(field.finalValueHash || field.value, protectedField);
    const intendedHash = hash(field.intendedValueHash || field.intendedValue, protectedField);
    const beforeHash = hash(field.beforeValueHash || field.beforeValue, protectedField);
    const userEdited = eventType(field) === "USER_CORRECTED"
        || String(field.finalState || "").toUpperCase() === "USER_EDITED"
        || String(field.source || "").toUpperCase().includes("USER");
    const representationChanged = Boolean(field.representationChanged)
        || Boolean(intendedHash && finalHash && intendedHash !== finalHash);
    const operationId = text(field.operationId || context.operationId, 120);
    const observationId = text(context.observationId, 120)
        || crypto.createHash("sha256").update([
            applicationId, attemptId, operationId || "", logicalFieldId,
            eventType(field), String(context.clientTimeMs || field.clientTimeMs || 0)
        ].join("|")).digest("hex").slice(0, 40);

    return fieldInteractionObservationSchema.parse({
        schemaVersion: FIELD_INTERACTION_OBSERVATION_VERSION,
        observationId,
        applicationId,
        attemptId,
        operationId,
        logicalFieldId,
        fieldSignatureHash: hash(signature, protectedField),
        eventType: eventType(field),
        protected: protectedField,
        semantic: {
            canonicalKey: text(field.semanticKey || context.semanticKey, 140),
            mappingId: text(field.mappingId || context.mappingId, 160),
            explicitEvidence: String(context.semanticEvidence || field.semanticEvidence || "NONE").toUpperCase()
        },
        answer: {
            source: text(field.source || context.source, 80) || "UNKNOWN",
            beforeValueHash: beforeHash,
            intendedValueHash: intendedHash,
            finalValueHash: finalHash,
            normalizedEquivalent: typeof field.normalizedEquivalent === "boolean" ? field.normalizedEquivalent
                : typeof context.normalizedEquivalent === "boolean" ? context.normalizedEquivalent : null,
            userEdited,
            completedByUser: Boolean(field.completedByUser || context.completedByUser || userEdited)
        },
        representation: {
            ruleId: text(field.representationRuleId || context.representationRuleId, 160),
            intendedValueHash: intendedHash,
            finalValueHash: finalHash,
            equivalentTruth: typeof field.equivalentTruth === "boolean" ? field.equivalentTruth
                : typeof context.equivalentTruth === "boolean" ? context.equivalentTruth : null,
            changed: representationChanged,
            originalRejected: Boolean(field.originalRepresentationRejected || context.originalRepresentationRejected),
            bothEmployerValid: Boolean(field.bothRepresentationsValid || context.bothRepresentationsValid)
        },
        strategy: {
            strategyId: text(field.strategyId || context.strategyId, 160),
            attempted: Boolean(field.strategyAttempted || field.intendedAction === "FILL" || context.strategyAttempted),
            readback: readback(field),
            employerValidation: employerValidation(field),
            cleanup: ["NOT_REQUIRED", "CLEAN", "RESTORED", "DIRTY", "UNKNOWN"].includes(String(field.cleanup || "").toUpperCase())
                ? String(field.cleanup).toUpperCase() : "UNKNOWN"
        },
        checkpoint: checkpoint(field, context),
        clientTimeMs: Math.max(0, Math.trunc(Number(context.clientTimeMs || field.clientTimeMs || Date.now())))
    });
}


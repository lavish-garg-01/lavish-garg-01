import { z } from "zod";
import { SHARED_CONTRACT_VERSION, boundedContractText, contractIdSchema, nullableSha256Schema, sha256Schema } from "./contractPrimitives.js";
import { logicalFieldIdentitySchema } from "./logicalFieldIdentity.js";

export const FIELD_REVISION_VERSION = SHARED_CONTRACT_VERSION;
export const EDIT_SESSION_VERSION = SHARED_CONTRACT_VERSION;
export const CHECKPOINT_RECEIPT_VERSION = SHARED_CONTRACT_VERSION;

export const fieldRevisionSchema = z.object({
    schemaVersion: z.literal(FIELD_REVISION_VERSION),
    revisionId: contractIdSchema,
    identity: logicalFieldIdentitySchema,
    operationId: contractIdSchema.nullable(),
    editSessionId: contractIdSchema.nullable(),
    sequence: z.number().int().nonnegative(),
    actor: z.enum(["COPILOT", "CANDIDATE", "ATS_SCRIPT", "PASSWORD_MANAGER", "UNKNOWN"]),
    eventType: z.enum(["OBSERVED", "FILL_INTENDED", "READBACK", "EDIT_STARTED", "EDIT_UPDATED", "EDIT_COMMITTED", "VALUE_REVERTED", "VALIDATION", "INTERRUPTED"]),
    beforeValueHash: nullableSha256Schema,
    intendedValueHash: nullableSha256Schema,
    afterValueHash: nullableSha256Schema,
    canonicalKey: boundedContractText(140).nullable(),
    answerVersionId: contractIdSchema.nullable(),
    representationVersionId: contractIdSchema.nullable(),
    strategyVersionId: contractIdSchema.nullable(),
    clientTimeMs: z.number().int().nonnegative(),
    valueFree: z.literal(true)
}).strict();

export const editSessionSchema = z.object({
    schemaVersion: z.literal(EDIT_SESSION_VERSION),
    editSessionId: contractIdSchema,
    identity: logicalFieldIdentitySchema,
    startedAtMs: z.number().int().nonnegative(),
    lastActivityAtMs: z.number().int().nonnegative(),
    endedAtMs: z.number().int().nonnegative().nullable(),
    status: z.enum(["OPEN", "COMMITTED", "RESTORED", "INTERRUPTED", "ABANDONED"]),
    firstRevisionSequence: z.number().int().nonnegative(),
    lastRevisionSequence: z.number().int().nonnegative(),
    initialValueHash: nullableSha256Schema,
    finalValueHash: nullableSha256Schema,
    interruptionReason: boundedContractText(120).nullable()
}).strict().superRefine((value, context) => {
    if (value.lastActivityAtMs < value.startedAtMs) context.addIssue({ code: z.ZodIssueCode.custom, message: "INVALID_EDIT_TIMELINE" });
    if (value.endedAtMs != null && value.endedAtMs < value.startedAtMs) context.addIssue({ code: z.ZodIssueCode.custom, message: "INVALID_EDIT_TIMELINE" });
    if (value.lastRevisionSequence < value.firstRevisionSequence) context.addIssue({ code: z.ZodIssueCode.custom, message: "INVALID_EDIT_SEQUENCE" });
});

export const checkpointReceiptSchema = z.object({
    schemaVersion: z.literal(CHECKPOINT_RECEIPT_VERSION),
    checkpointId: contractIdSchema,
    runId: contractIdSchema,
    applicationId: contractIdSchema,
    applicationContentRevisionId: contractIdSchema.nullable(),
    type: z.enum(["LOCAL_VALIDITY", "PAGE_ADVANCE", "REVIEW", "SUBMISSION", "EXPLICIT_SAVE"]),
    status: z.enum(["VERIFIED", "REJECTED", "ABANDONED", "UNKNOWN"]),
    source: z.enum(["DOM_VALIDATION", "NAVIGATION", "EMPLOYER_RECEIPT", "CANDIDATE_GESTURE", "RECOVERY"]),
    observedAtMs: z.number().int().nonnegative(),
    evidenceHash: sha256Schema,
    valueFree: z.literal(true)
}).strict();


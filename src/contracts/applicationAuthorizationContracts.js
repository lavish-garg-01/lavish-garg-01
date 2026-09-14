import { z } from "zod";
import { SHARED_CONTRACT_VERSION, boundedContractText, contractIdSchema, sha256Schema } from "./contractPrimitives.js";

export const APPLICATION_CONTENT_REVISION_VERSION = SHARED_CONTRACT_VERSION;
export const APPLICATION_AUTHORIZATION_RECEIPT_VERSION = SHARED_CONTRACT_VERSION;

export const applicationContentRevisionSchema = z.object({
    schemaVersion: z.literal(APPLICATION_CONTENT_REVISION_VERSION),
    revisionId: contractIdSchema,
    applicationId: contractIdSchema,
    runId: contractIdSchema,
    pageGeneration: z.number().int().nonnegative(),
    formGeneration: z.number().int().nonnegative(),
    formGroupId: contractIdSchema,
    fieldSetFingerprint: sha256Schema,
    contentFingerprint: sha256Schema,
    employerRevisionTokenHash: sha256Schema.nullable(),
    observedAtMs: z.number().int().nonnegative(),
    valueFree: z.literal(true)
}).strict();

const authorizationItemSchema = z.object({
    logicalFieldFingerprint: sha256Schema,
    canonicalKey: boundedContractText(140).nullable(),
    labelDigest: sha256Schema,
    impact: z.enum(["ORDINARY", "HIGH_IMPACT"]),
    decision: z.enum(["AUTHORIZED", "DECLINED"])
}).strict();

export const applicationAuthorizationReceiptSchema = z.object({
    schemaVersion: z.literal(APPLICATION_AUTHORIZATION_RECEIPT_VERSION),
    authorizationId: contractIdSchema,
    applicationId: contractIdSchema,
    runId: contractIdSchema,
    applicationContentRevisionId: contractIdSchema,
    kind: z.enum(["ORDINARY_DECLARATION_GROUP", "HIGH_IMPACT_ITEM", "EXPLICIT_ANSWER_SAVE"]),
    items: z.array(authorizationItemSchema).min(1).max(50),
    userGestureAtMs: z.number().int().nonnegative(),
    expiresAtMs: z.number().int().nonnegative().nullable(),
    reusableCandidateMemory: z.literal(false),
    valueFree: z.literal(true)
}).strict().superRefine((value, context) => {
    if (value.kind === "HIGH_IMPACT_ITEM" && value.items.length !== 1) context.addIssue({ code: z.ZodIssueCode.custom, message: "HIGH_IMPACT_REQUIRES_ONE_ITEM" });
    if (value.kind === "ORDINARY_DECLARATION_GROUP" && value.items.some((item) => item.impact !== "ORDINARY")) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "HIGH_IMPACT_CANNOT_BE_GROUPED" });
    }
});


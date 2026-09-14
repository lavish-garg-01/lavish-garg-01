import { z } from "zod";
import { SHARED_CONTRACT_VERSION, boundedContractText, contractIdSchema, nullableSha256Schema } from "./contractPrimitives.js";
import { normalizedValueSchema } from "./normalizedValue.js";
import { scopeRankSchema } from "./canonicalAnswerPolicy.js";

export const FIELD_ANSWER_CONTRACT_VERSION = SHARED_CONTRACT_VERSION;

export const fieldAnswerContractSchema = z.object({
    schemaVersion: z.literal(FIELD_ANSWER_CONTRACT_VERSION),
    contractId: contractIdSchema,
    canonicalKey: boundedContractText(140),
    policyVersion: z.number().int().positive(),
    candidateAnswerVersionId: contractIdSchema.nullable(),
    normalizedValue: normalizedValueSchema,
    normalizedValueHash: nullableSha256Schema,
    scope: scopeRankSchema,
    source: z.enum(["PROFILE", "VERIFIED_RESUME", "DERIVED", "USER_ENTERED", "APPROVED_MEMORY", "JOB_CONTEXT", "AI_WRITING"]),
    sourceVersionId: contractIdSchema.nullable(),
    representation: z.object({
        ruleKey: boundedContractText(120),
        ruleVersion: z.number().int().positive(),
        renderedValue: boundedContractText(4_000),
        renderedValueHash: nullableSha256Schema
    }).strict(),
    confidence: z.number().min(0).max(1),
    review: z.enum(["NONE", "RECOMMENDED", "REQUIRED"]),
    expiresAtMs: z.number().int().nonnegative().nullable(),
    protected: z.literal(false)
}).strict().superRefine((value, context) => {
    if (value.normalizedValue.kind === "UNKNOWN" && value.review !== "REQUIRED") {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "UNKNOWN_VALUE_REQUIRES_REVIEW" });
    }
});


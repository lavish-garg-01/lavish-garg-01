import { z } from "zod";
import { SHARED_CONTRACT_VERSION, boundedContractText } from "./contractPrimitives.js";

export const CANONICAL_ANSWER_POLICY_VERSION = SHARED_CONTRACT_VERSION;
export const SCOPE_RANK_VERSION = SHARED_CONTRACT_VERSION;
export const SCOPE_TYPES = Object.freeze(["NONE", "APPLICATION_CONTENT_REVISION", "APPLICATION", "EMPLOYER_GROUP", "ROLE_FAMILY", "COUNTRY", "CANDIDATE"]);
export const REUSE_DECISIONS = Object.freeze(["AUTO_VERSION", "REVIEW_TO_SAVE", "APPLICATION_ONLY", "APPLICATION_AUTHORIZATION", "NEVER_LEARN"]);

export const scopeRankSchema = z.object({
    schemaVersion: z.literal(SCOPE_RANK_VERSION),
    scopeType: z.enum(SCOPE_TYPES),
    scopeKey: boundedContractText(160).nullable(),
    rank: z.number().int().min(0).max(100)
}).strict().superRefine((value, context) => {
    const requiresKey = ["APPLICATION_CONTENT_REVISION", "APPLICATION", "EMPLOYER_GROUP", "ROLE_FAMILY", "COUNTRY"].includes(value.scopeType);
    if (requiresKey && !value.scopeKey) context.addIssue({ code: z.ZodIssueCode.custom, message: "SCOPE_KEY_REQUIRED" });
    if (!requiresKey && value.scopeKey) context.addIssue({ code: z.ZodIssueCode.custom, message: "SCOPE_KEY_FORBIDDEN" });
});

export const canonicalAnswerPolicySchema = z.object({
    schemaVersion: z.literal(CANONICAL_ANSWER_POLICY_VERSION),
    policyVersion: z.number().int().positive(),
    canonicalKey: boundedContractText(140),
    answerClass: z.enum(["STABLE_FACT", "MUTABLE_FACT", "PREFERENCE", "ENTITY_SCOPED_FACT", "WRITING", "DECLARATION", "PROTECTED"]),
    reuseDecision: z.enum(REUSE_DECISIONS),
    defaultScope: scopeRankSchema,
    freshnessDays: z.number().int().positive().max(3650).nullable(),
    autofill: z.enum(["ALLOWED", "REVIEW", "APPLICATION_GESTURE", "FORBIDDEN"]),
    learningCommitPoint: z.enum(["VERIFIED_SUBMISSION", "EXPLICIT_SAVE"]).nullable(),
    reasonCode: boundedContractText(120)
}).strict().superRefine((value, context) => {
    if (value.answerClass === "PROTECTED" && (value.reuseDecision !== "NEVER_LEARN" || value.autofill !== "FORBIDDEN")) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "PROTECTED_VALUE_FORBIDDEN" });
    }
    if (value.reuseDecision === "APPLICATION_AUTHORIZATION" && value.defaultScope.scopeType !== "APPLICATION_CONTENT_REVISION") {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "AUTHORIZATION_SCOPE_INVALID" });
    }
});


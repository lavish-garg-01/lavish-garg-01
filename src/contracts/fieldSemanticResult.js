import { z } from "zod";
import { SHARED_CONTRACT_VERSION, boundedContractText, nullableSha256Schema, sha256Schema } from "./contractPrimitives.js";

export const FIELD_SEMANTIC_RESULT_VERSION = SHARED_CONTRACT_VERSION;

const candidateSchema = z.object({
    canonicalKey: boundedContractText(140),
    confidence: z.number().min(0).max(1),
    source: z.enum(["EXACT", "DETERMINISTIC", "SEMANTIC_SEARCH", "AI_PROPOSAL"])
}).strict();

export const fieldSemanticResultSchema = z.object({
    schemaVersion: z.literal(FIELD_SEMANTIC_RESULT_VERSION),
    descriptorFingerprint: sha256Schema,
    status: z.enum(["RESOLVED", "AMBIGUOUS", "UNKNOWN", "PROTECTED"]),
    canonicalKey: boundedContractText(140).nullable(),
    mappingId: boundedContractText(160).nullable(),
    mappingVersion: z.number().int().positive().nullable(),
    resolver: z.enum(["EXACT", "DETERMINISTIC", "SEMANTIC_SEARCH", "AI", "NONE"]),
    confidence: z.number().min(0).max(1),
    candidates: z.array(candidateSchema).max(8),
    optionSetHash: nullableSha256Schema,
    valueFree: z.literal(true),
    reasonCodes: z.array(boundedContractText(100)).max(12)
}).strict().superRefine((value, context) => {
    if (value.status === "RESOLVED" && !value.canonicalKey) context.addIssue({ code: z.ZodIssueCode.custom, message: "RESOLVED_WITHOUT_CANONICAL" });
    if (["UNKNOWN", "PROTECTED"].includes(value.status) && value.canonicalKey) context.addIssue({ code: z.ZodIssueCode.custom, message: "UNSAFE_CANONICAL_FOR_STATUS" });
    if (value.status === "PROTECTED" && value.candidates.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "PROTECTED_VALUE_FORBIDDEN" });
});


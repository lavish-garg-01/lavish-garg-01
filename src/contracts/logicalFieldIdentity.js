import { z } from "zod";
import { SHARED_CONTRACT_VERSION, boundedContractText, contractIdSchema, sha256Schema } from "./contractPrimitives.js";

export const LOGICAL_FIELD_IDENTITY_VERSION = SHARED_CONTRACT_VERSION;

export const logicalFieldIdentitySchema = z.object({
    schemaVersion: z.literal(LOGICAL_FIELD_IDENTITY_VERSION),
    runId: contractIdSchema,
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    documentId: boundedContractText(160),
    documentLifecycle: z.enum(["ACTIVE", "PRERENDER", "BF_CACHE", "DISCARDED", "UNKNOWN"]),
    pageGeneration: z.number().int().nonnegative(),
    formGeneration: z.number().int().nonnegative(),
    formGroupId: contractIdSchema,
    logicalFieldFingerprint: sha256Schema,
    fieldInstanceGeneration: z.number().int().nonnegative()
}).strict();


import { z } from "zod";
import {
    CONTRACT_LIMITS, SHARED_CONTRACT_VERSION, boundedContractText, contractIdSchema,
    jsonValueSchema, sha256Schema, withinContractBytes
} from "./contractPrimitives.js";

export const EXTENSION_PROTOCOL_ENVELOPE_VERSION = SHARED_CONTRACT_VERSION;
export const TELEMETRY_ENVELOPE_VERSION = SHARED_CONTRACT_VERSION;
export const EXTENSION_PROTOCOL_VERSION = 1;

const FORBIDDEN_KEY = /(?:password|passcode|otp|captcha|aadhaar|passport|social.?security|national.?id|government.?id|raw.?value|protected.?value)/i;

function containsForbiddenKey(value) {
    if (Array.isArray(value)) return value.some(containsForbiddenKey);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key) || containsForbiddenKey(child));
}

export const extensionProtocolEnvelopeSchema = z.object({
    schemaVersion: z.literal(EXTENSION_PROTOCOL_ENVELOPE_VERSION),
    protocolVersion: z.literal(EXTENSION_PROTOCOL_VERSION),
    messageId: contractIdSchema,
    messageType: boundedContractText(100),
    source: z.enum(["WEBSITE", "EXTENSION", "BACKEND"]),
    destination: z.enum(["WEBSITE", "EXTENSION", "BACKEND"]),
    sentAtMs: z.number().int().nonnegative(),
    correlationId: contractIdSchema.nullable(),
    nonce: z.string().min(16).max(160),
    dataClass: z.enum(["STRUCTURAL", "VALUE_FREE_TELEMETRY", "CANDIDATE_PRIVATE"]),
    containsProtectedValue: z.literal(false),
    payloadContract: boundedContractText(100),
    payloadHash: sha256Schema,
    payload: jsonValueSchema
}).strict()
    .refine((value) => !containsForbiddenKey(value.payload), "PROTECTED_VALUE_FORBIDDEN")
    .refine(withinContractBytes(CONTRACT_LIMITS.PROTOCOL_BYTES), "CONTRACT_SIZE_LIMIT_EXCEEDED");

const telemetryDimensionsSchema = z.object({
    ats: boundedContractText(80).nullable(),
    portalKind: boundedContractText(80).nullable(),
    eventType: boundedContractText(100),
    outcome: boundedContractText(100).nullable(),
    strategyId: boundedContractText(160).nullable(),
    adapterVersion: boundedContractText(80).nullable(),
    reasonCode: boundedContractText(120).nullable(),
    checkpointType: boundedContractText(80).nullable(),
    fieldType: boundedContractText(80).nullable()
}).strict();

export const telemetryEnvelopeSchema = z.object({
    schemaVersion: z.literal(TELEMETRY_ENVELOPE_VERSION),
    telemetryId: contractIdSchema,
    runId: contractIdSchema,
    sequence: z.number().int().nonnegative(),
    occurredAtMs: z.number().int().nonnegative(),
    dimensions: telemetryDimensionsSchema,
    measures: z.object({ durationMs: z.number().int().nonnegative().nullable(), count: z.number().int().nonnegative().max(1_000_000).nullable() }).strict(),
    logicalFieldFingerprint: sha256Schema.nullable(),
    operationHash: sha256Schema.nullable(),
    valueFree: z.literal(true),
    containsProtectedValue: z.literal(false)
}).strict().refine(withinContractBytes(CONTRACT_LIMITS.TELEMETRY_BYTES), "CONTRACT_SIZE_LIMIT_EXCEEDED");


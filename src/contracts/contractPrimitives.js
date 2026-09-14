import crypto from "node:crypto";
import { z } from "zod";

export const SHARED_CONTRACT_VERSION = 1;
export const CONTRACT_LIMITS = Object.freeze({
    ID: 160,
    SHORT_TEXT: 240,
    VALUE_TEXT: 4_000,
    RICH_TEXT: 12_000,
    URL: 2_048,
    ARRAY_ITEMS: 100,
    PROTOCOL_BYTES: 64 * 1024,
    TELEMETRY_BYTES: 16 * 1024
});

export const contractIdSchema = z.string().min(1).max(CONTRACT_LIMITS.ID).regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const nullableSha256Schema = sha256Schema.nullable();
export const boundedContractText = (max = CONTRACT_LIMITS.SHORT_TEXT) => z.string().max(max);
export const exactDecimalSchema = z.string().regex(/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/, "INVALID_EXACT_DECIMAL");

const finiteNumber = z.number().refine(Number.isFinite, "NON_FINITE_NUMBER");
export const jsonValueSchema = z.lazy(() => z.union([
    z.null(), z.boolean(), finiteNumber, z.string().max(CONTRACT_LIMITS.RICH_TEXT),
    z.array(jsonValueSchema).max(CONTRACT_LIMITS.ARRAY_ITEMS),
    z.record(z.string().max(80), jsonValueSchema)
]));

function normalizeForSerialization(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new TypeError("NON_FINITE_NUMBER");
        return Object.is(value, -0) ? 0 : value;
    }
    if (Array.isArray(value)) return value.map(normalizeForSerialization);
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        const normalized = {};
        for (const key of Object.keys(value).sort()) {
            if (value[key] === undefined) throw new TypeError("UNDEFINED_VALUE");
            normalized[key] = normalizeForSerialization(value[key]);
        }
        return normalized;
    }
    throw new TypeError("NON_JSON_VALUE");
}

export function canonicalContractJson(value) {
    return JSON.stringify(normalizeForSerialization(value));
}

export function contractByteLength(value) {
    return Buffer.byteLength(canonicalContractJson(value), "utf8");
}

export function stableContractHash(value) {
    return crypto.createHash("sha256").update(canonicalContractJson(value)).digest("hex");
}

function rejectionCode(error) {
    const issues = error?.issues || [];
    if (issues.some((issue) => issue.message === "PROTECTED_VALUE_FORBIDDEN")) return "PROTECTED_VALUE_FORBIDDEN";
    if (issues.some((issue) => issue.message === "CONTRACT_SIZE_LIMIT_EXCEEDED")) return "CONTRACT_SIZE_LIMIT_EXCEEDED";
    if (issues.some((issue) => issue.code === "unrecognized_keys")) return "UNKNOWN_FIELD";
    return "INVALID_CONTRACT";
}

/** Fail-closed parser used by routes and persistence boundaries. */
export function parseVersionedContract(contractName, schema, input, supportedVersions = [SHARED_CONTRACT_VERSION]) {
    const version = Number(input?.schemaVersion);
    if (!supportedVersions.includes(version)) {
        return {
            success: false,
            contractName,
            reasonCode: "UNSUPPORTED_SCHEMA_VERSION",
            supportedVersions: [...supportedVersions]
        };
    }
    const parsed = schema.safeParse(input);
    if (parsed.success) return { success: true, contractName, data: parsed.data };
    return {
        success: false,
        contractName,
        reasonCode: rejectionCode(parsed.error),
        issues: parsed.error.issues.map((issue) => ({ code: issue.code, path: issue.path, message: issue.message }))
    };
}

export function withinContractBytes(limit) {
    return (value) => {
        try {
            return contractByteLength(value) <= limit;
        } catch {
            return false;
        }
    };
}


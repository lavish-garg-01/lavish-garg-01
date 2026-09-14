import { z } from "zod";
import {
    CONTRACT_LIMITS, SHARED_CONTRACT_VERSION, boundedContractText, contractIdSchema,
    exactDecimalSchema, nullableSha256Schema, sha256Schema
} from "./contractPrimitives.js";

export const NORMALIZED_VALUE_VERSION = SHARED_CONTRACT_VERSION;
export const NORMALIZED_VALUE_KINDS = Object.freeze([
    "STRING", "BOOLEAN", "INTEGER", "DECIMAL", "DATE", "DATE_RANGE", "DURATION",
    "MONEY", "PHONE", "URL", "ADDRESS", "ENUM", "MULTI_ENUM", "ENTITY_REF",
    "FILE_REF", "RICH_TEXT", "DECLINE_TO_ANSWER", "UNKNOWN"
]);

const common = {
    schemaVersion: z.literal(NORMALIZED_VALUE_VERSION),
    dataClass: z.literal("CANDIDATE_PRIVATE")
};
const datePrecision = z.enum(["DAY", "MONTH", "YEAR"]);
const isoDate = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/).refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, "INVALID_CALENDAR_DATE");
const dateValue = z.object({ isoDate, precision: datePrecision }).strict();
const enumItem = z.object({ key: boundedContractText(160), label: boundedContractText(240) }).strict();

const schemas = [
    z.object({ ...common, kind: z.literal("STRING"), value: boundedContractText(CONTRACT_LIMITS.VALUE_TEXT) }).strict(),
    z.object({ ...common, kind: z.literal("BOOLEAN"), value: z.boolean() }).strict(),
    z.object({ ...common, kind: z.literal("INTEGER"), value: z.number().int().safe() }).strict(),
    z.object({ ...common, kind: z.literal("DECIMAL"), valueExact: exactDecimalSchema }).strict(),
    z.object({ ...common, kind: z.literal("DATE"), value: dateValue }).strict(),
    z.object({
        ...common, kind: z.literal("DATE_RANGE"), start: dateValue.nullable(), end: dateValue.nullable(), current: z.boolean()
    }).strict().superRefine((value, context) => {
        if (!value.start && !value.end) context.addIssue({ code: z.ZodIssueCode.custom, message: "EMPTY_DATE_RANGE" });
        if (value.current && value.end) context.addIssue({ code: z.ZodIssueCode.custom, message: "CURRENT_RANGE_HAS_END" });
        if (value.start && value.end && value.start.isoDate > value.end.isoDate) context.addIssue({ code: z.ZodIssueCode.custom, message: "REVERSED_DATE_RANGE" });
    }),
    z.object({ ...common, kind: z.literal("DURATION"), months: z.number().int().min(0).max(1_200) }).strict(),
    z.object({
        ...common, kind: z.literal("MONEY"), amountExact: exactDecimalSchema,
        currency: z.string().regex(/^[A-Z]{3}$/), period: z.enum(["HOUR", "DAY", "WEEK", "MONTH", "YEAR", "ONE_TIME"])
    }).strict(),
    z.object({
        ...common, kind: z.literal("PHONE"), countryCode: z.string().regex(/^\+[1-9]\d{0,3}$/),
        nationalNumber: z.string().regex(/^\d{4,14}$/), extension: z.string().regex(/^\d{1,8}$/).nullable()
    }).strict(),
    z.object({ ...common, kind: z.literal("URL"), value: z.string().url().max(CONTRACT_LIMITS.URL).refine((value) => /^https?:\/\//i.test(value), "UNSAFE_URL_SCHEME") }).strict(),
    z.object({
        ...common, kind: z.literal("ADDRESS"), line1: boundedContractText(240), line2: boundedContractText(240),
        city: boundedContractText(120), region: boundedContractText(120), postalCode: boundedContractText(24),
        countryCode: z.string().regex(/^[A-Z]{2}$/)
    }).strict(),
    z.object({ ...common, kind: z.literal("ENUM"), value: enumItem }).strict(),
    z.object({ ...common, kind: z.literal("MULTI_ENUM"), values: z.array(enumItem).max(CONTRACT_LIMITS.ARRAY_ITEMS) }).strict()
        .superRefine((value, context) => {
            if (new Set(value.values.map((item) => item.key)).size !== value.values.length) {
                context.addIssue({ code: z.ZodIssueCode.custom, message: "DUPLICATE_ENUM_KEY" });
            }
        }),
    z.object({
        ...common, kind: z.literal("ENTITY_REF"), entityType: boundedContractText(80),
        entityId: contractIdSchema, displayLabel: boundedContractText(240)
    }).strict(),
    z.object({
        ...common, kind: z.literal("FILE_REF"), fileId: contractIdSchema, contentSha256: sha256Schema,
        fileName: boundedContractText(240), mimeType: boundedContractText(120)
    }).strict(),
    z.object({ ...common, kind: z.literal("RICH_TEXT"), value: boundedContractText(CONTRACT_LIMITS.RICH_TEXT) }).strict(),
    z.object({ ...common, kind: z.literal("DECLINE_TO_ANSWER"), reasonCode: boundedContractText(120) }).strict(),
    z.object({ ...common, kind: z.literal("UNKNOWN"), reasonCode: boundedContractText(160), evidenceHash: nullableSha256Schema }).strict()
];

// DATE_RANGE and MULTI_ENUM carry cross-field refinements, so use a regular
// union rather than discarding those refinements to satisfy discriminatedUnion.
export const normalizedValueSchema = z.union(schemas);

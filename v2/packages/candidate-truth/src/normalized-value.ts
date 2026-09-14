import { z } from "zod";

export const NORMALIZED_VALUE_SCHEMA_VERSION = 1 as const;
export const NORMALIZED_VALUE_KINDS = [
  "STRING",
  "BOOLEAN",
  "INTEGER",
  "DECIMAL",
  "DATE",
  "DATE_RANGE",
  "DURATION",
  "MONEY",
  "PHONE",
  "URL",
  "ADDRESS",
  "ENUM",
  "MULTI_ENUM",
  "ENTITY_REF",
  "FILE_REF",
  "RICH_TEXT",
  "DECLINE_TO_ANSWER",
  "UNKNOWN"
] as const;
export const PERSISTABLE_NORMALIZED_VALUE_KINDS = NORMALIZED_VALUE_KINDS.filter(
  (kind) => kind !== "UNKNOWN"
) as Exclude<(typeof NORMALIZED_VALUE_KINDS)[number], "UNKNOWN">[];

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const common = {
  schemaVersion: z.literal(NORMALIZED_VALUE_SCHEMA_VERSION),
  dataClass: z.literal("CANDIDATE_PRIVATE")
};

export function canonicalExactDecimal(input: string): string {
  const negative = input.startsWith("-");
  const unsigned = negative ? input.slice(1) : input;
  const [integerPart = "0", fractionalPart] = unsigned.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionalPart?.replace(/0+$/, "") ?? "";
  const canonical = fraction ? `${integer}.${fraction}` : integer;
  return negative && canonical !== "0" ? `-${canonical}` : canonical;
}

export const ExactDecimalSchema = z
  .string()
  .max(100)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/)
  .transform(canonicalExactDecimal);

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === (month ?? 1) - 1 &&
      date.getUTCDate() === day
    );
  }, "INVALID_CALENDAR_DATE");

const DateValueSchema = z
  .object({
    isoDate: IsoDateSchema,
    precision: z.enum(["DAY", "MONTH", "YEAR"])
  })
  .strict();

const EnumItemSchema = z
  .object({
    key: boundedText(160),
    label: boundedText(240)
  })
  .strict();

const HttpUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, "UNSAFE_URL");

const StringValueSchema = z.object({ ...common, kind: z.literal("STRING"), value: boundedText(8_000) }).strict();
const BooleanValueSchema = z.object({ ...common, kind: z.literal("BOOLEAN"), value: z.boolean() }).strict();
const IntegerValueSchema = z.object({ ...common, kind: z.literal("INTEGER"), value: z.number().int().safe() }).strict();
const DecimalValueSchema = z.object({ ...common, kind: z.literal("DECIMAL"), valueExact: ExactDecimalSchema }).strict();
const DateNormalizedValueSchema = z.object({ ...common, kind: z.literal("DATE"), value: DateValueSchema }).strict();
const DateRangeValueSchema = z
  .object({
    ...common,
    kind: z.literal("DATE_RANGE"),
    start: DateValueSchema.nullable(),
    end: DateValueSchema.nullable(),
    current: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.start && !value.end) {
      context.addIssue({ code: "custom", message: "EMPTY_DATE_RANGE" });
    }
    if (value.current && value.end) {
      context.addIssue({ code: "custom", message: "CURRENT_RANGE_HAS_END" });
    }
    if (value.start && value.end && value.start.isoDate > value.end.isoDate) {
      context.addIssue({ code: "custom", message: "REVERSED_DATE_RANGE" });
    }
  });
const DurationValueSchema = z
  .object({ ...common, kind: z.literal("DURATION"), months: z.number().int().min(0).max(1_200) })
  .strict();
const MoneyValueSchema = z
  .object({
    ...common,
    kind: z.literal("MONEY"),
    amountExact: ExactDecimalSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    period: z.enum(["HOUR", "DAY", "WEEK", "MONTH", "YEAR", "ONE_TIME"])
  })
  .strict();
const PhoneValueSchema = z
  .object({
    ...common,
    kind: z.literal("PHONE"),
    countryCode: z.string().regex(/^\+[1-9]\d{0,3}$/),
    nationalNumber: z.string().regex(/^\d{4,14}$/),
    extension: z.string().regex(/^\d{1,8}$/).nullable()
  })
  .strict();
const UrlValueSchema = z.object({ ...common, kind: z.literal("URL"), value: HttpUrlSchema }).strict();
const AddressValueSchema = z
  .object({
    ...common,
    kind: z.literal("ADDRESS"),
    line1: boundedText(240),
    line2: boundedText(240).nullable(),
    city: boundedText(120),
    region: boundedText(120),
    postalCode: boundedText(24),
    countryCode: z.string().regex(/^[A-Z]{2}$/)
  })
  .strict();
const EnumValueSchema = z.object({ ...common, kind: z.literal("ENUM"), value: EnumItemSchema }).strict();
const MultiEnumValueSchema = z
  .object({ ...common, kind: z.literal("MULTI_ENUM"), values: z.array(EnumItemSchema).max(100) })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.values.map((item) => item.key)).size !== value.values.length) {
      context.addIssue({ code: "custom", message: "DUPLICATE_ENUM_KEY" });
    }
  });
const EntityRefValueSchema = z
  .object({
    ...common,
    kind: z.literal("ENTITY_REF"),
    entityType: z.enum(["EMPLOYMENT", "EDUCATION", "PROJECT", "CERTIFICATION", "LANGUAGE"]),
    entityId: z.uuid(),
    displayLabel: boundedText(240)
  })
  .strict();
const FileRefValueSchema = z
  .object({
    ...common,
    kind: z.literal("FILE_REF"),
    fileId: z.uuid(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    fileName: boundedText(240),
    mimeType: boundedText(120)
  })
  .strict();
const RichTextValueSchema = z.object({ ...common, kind: z.literal("RICH_TEXT"), value: boundedText(30_000) }).strict();
const DeclineValueSchema = z
  .object({ ...common, kind: z.literal("DECLINE_TO_ANSWER"), reasonCode: boundedText(120) })
  .strict();
const UnknownValueSchema = z
  .object({
    ...common,
    kind: z.literal("UNKNOWN"),
    reasonCode: boundedText(160),
    evidenceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable()
  })
  .strict();

const persistableSchemas = [
  StringValueSchema,
  BooleanValueSchema,
  IntegerValueSchema,
  DecimalValueSchema,
  DateNormalizedValueSchema,
  DateRangeValueSchema,
  DurationValueSchema,
  MoneyValueSchema,
  PhoneValueSchema,
  UrlValueSchema,
  AddressValueSchema,
  EnumValueSchema,
  MultiEnumValueSchema,
  EntityRefValueSchema,
  FileRefValueSchema,
  RichTextValueSchema,
  DeclineValueSchema
] as const;

export const PersistableNormalizedValueSchema = z.union(persistableSchemas);
export const NormalizedValueSchema = z.union([...persistableSchemas, UnknownValueSchema]);

export type PersistableNormalizedValue = z.infer<typeof PersistableNormalizedValueSchema>;
export type NormalizedValue = z.infer<typeof NormalizedValueSchema>;
export type NormalizedValueKind = (typeof NORMALIZED_VALUE_KINDS)[number];

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableObject(item)])
    );
  }
  return value;
}

export function canonicalNormalizedValueJson(value: PersistableNormalizedValue): string {
  return JSON.stringify(stableObject(PersistableNormalizedValueSchema.parse(value)));
}

export function normalizedValuesEqual(
  left: PersistableNormalizedValue,
  right: PersistableNormalizedValue
): boolean {
  return canonicalNormalizedValueJson(left) === canonicalNormalizedValueJson(right);
}

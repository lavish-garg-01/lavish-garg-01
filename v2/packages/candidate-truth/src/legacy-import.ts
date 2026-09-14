import { createHash, createHmac } from "node:crypto";
import { UuidSchema } from "@job-hunter-v2/contracts";
import { type Clock, ValidationError, systemClock } from "@job-hunter-v2/domain";
import { z } from "zod";
import { evaluateCandidateAnswerAnomaly } from "./anomaly.js";
import type { CandidateValueFingerprinter } from "./candidate-truth-service.js";
import { evaluateAnswerFreshness } from "./freshness.js";
import {
  PersistableNormalizedValueSchema,
  canonicalExactDecimal,
  type PersistableNormalizedValue
} from "./normalized-value.js";
import { CANONICAL_DEFINITIONS, candidateAnswerPolicy } from "./policy.js";
import { resolveCandidateAnswerScope } from "./scope.js";

export const LEGACY_CANDIDATE_TRUTH_IMPORT_VERSION = 1 as const;
export const LEGACY_CANDIDATE_TRUTH_SOURCE_KINDS = [
  "V1_VERSIONED_TRUTH",
  "CANDIDATE_PROFILE",
  "APPROVED_FACT_MEMORY",
  "CANDIDATE_ANSWER",
  "MASTER_RESUME",
  "SHARED_FORM_MEMORY"
] as const;
export const LEGACY_CANDIDATE_TRUTH_IMPORT_DECISIONS = [
  "ELIGIBLE",
  "REVIEW_REQUIRED",
  "SKIPPED",
  "CONFLICT",
  "INVALID",
  "ALREADY_PRESENT"
] as const;

export type LegacyCandidateTruthSourceKind =
  (typeof LEGACY_CANDIDATE_TRUTH_SOURCE_KINDS)[number];
export type LegacyCandidateTruthImportDecision =
  (typeof LEGACY_CANDIDATE_TRUTH_IMPORT_DECISIONS)[number];

const IdempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/);
const LegacyCanonicalKeySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z][A-Z0-9_]{0,139}$/));
const LegacySourceMetadataSchema = z
  .object({
    unit: z.enum(["LPA", "YEARS", "MONTHS", "DAYS", "JSON_LIST", "LIST"]).nullable().optional(),
    countryCode: z.string().trim().min(1).max(64).nullable().optional(),
    candidateApproved: z.boolean().nullable().optional(),
    factScope: z.string().trim().min(1).max(120).nullable().optional(),
    answerSource: z.string().trim().min(1).max(120).nullable().optional(),
    confidence: z.number().finite().min(0).max(1).nullable().optional(),
    resumeCandidateConfirmed: z.boolean().nullable().optional(),
    ambiguousDefault: z.boolean().optional(),
    versionStatus: z.string().trim().min(1).max(80).nullable().optional(),
    trustState: z.enum(["REVIEW", "TRUSTED", "REMOVED"]).nullable().optional(),
    scopeKind: z.enum(["GLOBAL", "CONTEXTUAL", "ENTITY"]).nullable().optional()
  })
  .strict()
  .default({});
const LegacyCandidateTruthSourceSchema = z
  .object({
    sourceKind: z.enum(LEGACY_CANDIDATE_TRUTH_SOURCE_KINDS),
    sourceRecordId: z.string().trim().min(1).max(500),
    canonicalKey: LegacyCanonicalKeySchema,
    rawValue: z.unknown(),
    confirmedAt: z.union([z.date(), z.string().trim().min(1).max(80)]).nullable().optional(),
    metadata: LegacySourceMetadataSchema.optional()
  })
  .strict();

export interface LegacyCandidateTruthSource
  extends Omit<z.input<typeof LegacyCandidateTruthSourceSchema>, "metadata"> {
  metadata?: z.input<typeof LegacySourceMetadataSchema>;
}

export interface LegacyCandidateTruthSourceIdentity {
  sourceRecordFingerprint: LegacyImportFingerprint;
  sourceValueFingerprint: LegacyImportFingerprint;
}

export interface LegacyImportFingerprint {
  digest: string;
  keyVersion: number;
}

export interface LegacyImportFingerprinter {
  fingerprint(domain: "SOURCE_RECORD" | "SOURCE_VALUE" | "SNAPSHOT", value: unknown): LegacyImportFingerprint;
}

function stableJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ValidationError("Legacy import values must be finite JSON data.");
    return value;
  }
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJsonValue(item)])
    );
  }
  throw new ValidationError("Legacy import values must be bounded JSON-compatible data.");
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(stableJsonValue(value));
  if (Buffer.byteLength(serialized, "utf8") > 100_000) {
    throw new ValidationError("One legacy candidate-truth source exceeds the preview size limit.");
  }
  return serialized;
}

export class HmacLegacyImportFingerprinter implements LegacyImportFingerprinter {
  private readonly secret: Buffer;

  constructor(secret: string | Uint8Array, private readonly keyVersion: number) {
    this.secret = Buffer.from(secret);
    if (this.secret.byteLength < 32) {
      throw new Error("Legacy import fingerprint key must contain at least 32 bytes.");
    }
    if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) {
      throw new Error("Legacy import fingerprint key version must be a positive safe integer.");
    }
  }

  fingerprint(
    domain: "SOURCE_RECORD" | "SOURCE_VALUE" | "SNAPSHOT",
    value: unknown
  ): LegacyImportFingerprint {
    return {
      digest: createHmac("sha256", this.secret)
        .update(`candidate-truth-import:${domain}:`)
        .update(stableJson(value))
        .digest("hex"),
      keyVersion: this.keyVersion
    };
  }
}

interface FingerprintedLegacySource {
  source: z.output<typeof LegacyCandidateTruthSourceSchema>;
  metadata: z.output<typeof LegacySourceMetadataSchema>;
  sourceRecordFingerprint: LegacyImportFingerprint;
  sourceValueFingerprint: LegacyImportFingerprint;
}

function fingerprintLegacySources(
  sources: readonly LegacyCandidateTruthSource[],
  fingerprinter: LegacyImportFingerprinter
): FingerprintedLegacySource[] {
  return sources
    .map((sourceInput) => {
      const source = LegacyCandidateTruthSourceSchema.parse(sourceInput);
      const metadata = LegacySourceMetadataSchema.parse(source.metadata ?? {});
      return {
        source,
        metadata,
        sourceRecordFingerprint: fingerprinter.fingerprint("SOURCE_RECORD", {
          sourceKind: source.sourceKind,
          sourceRecordId: source.sourceRecordId
        }),
        sourceValueFingerprint: fingerprinter.fingerprint("SOURCE_VALUE", source.rawValue)
      };
    })
    .sort((left, right) =>
      left.sourceRecordFingerprint.digest.localeCompare(right.sourceRecordFingerprint.digest)
    );
}

export function fingerprintLegacyCandidateTruthSource(
  source: LegacyCandidateTruthSource,
  fingerprinter: LegacyImportFingerprinter
): LegacyCandidateTruthSourceIdentity {
  const [entry] = fingerprintLegacySources([source], fingerprinter);
  if (!entry) throw new Error("Legacy source identity was not produced.");
  return {
    sourceRecordFingerprint: entry.sourceRecordFingerprint,
    sourceValueFingerprint: entry.sourceValueFingerprint
  };
}

export function fingerprintLegacyCandidateTruthSnapshot(
  sources: readonly LegacyCandidateTruthSource[],
  fingerprinter: LegacyImportFingerprinter
): LegacyImportFingerprint {
  const fingerprinted = fingerprintLegacySources(sources, fingerprinter);
  return fingerprinter.fingerprint(
    "SNAPSHOT",
    fingerprinted.map((entry) => ({
      sourceKind: entry.source.sourceKind,
      sourceRecordFingerprint: entry.sourceRecordFingerprint,
      sourceValueFingerprint: entry.sourceValueFingerprint,
      canonicalKey: entry.source.canonicalKey,
      confirmedAt:
        entry.source.confirmedAt instanceof Date
          ? entry.source.confirmedAt.toISOString()
          : entry.source.confirmedAt ?? null,
      metadata: entry.metadata
    }))
  );
}

export interface LegacyImportCurrentAnswer {
  canonicalKey: string;
  scopeFingerprint: string;
  answerVersionId: string;
  valueFingerprint: string;
  fingerprintKeyVersion: number;
  trustState: "REVIEW" | "TRUSTED" | "REMOVED";
}

export interface PersistLegacyImportPreviewItemCommand {
  sourceOrdinal: number;
  sourceKind: LegacyCandidateTruthSourceKind;
  sourceRecordFingerprint: string;
  sourceValueFingerprint: string;
  fingerprintKeyVersion: number;
  sourceCanonicalKey: string;
  targetCanonicalKey: string | null;
  proposedScopeType: "GLOBAL" | "SEARCH" | "COMPANY" | "JOB" | "APPLICATION" | null;
  decision: LegacyCandidateTruthImportDecision;
  reasonCodes: readonly string[];
  existingAnswerVersionId: string | null;
}

export interface PersistLegacyImportPreviewCommand {
  accountId: string;
  candidateId: string;
  migrationVersion: number;
  snapshotFingerprint: string;
  fingerprintKeyVersion: number;
  idempotencyKey: string;
  requestFingerprint: string;
  createdAt: Date;
  items: readonly PersistLegacyImportPreviewItemCommand[];
}

export interface LegacyCandidateTruthImportPreviewItem {
  previewItemId: string;
  sourceOrdinal: number;
  sourceKind: LegacyCandidateTruthSourceKind;
  sourceRecordFingerprint: string;
  sourceValueFingerprint: string;
  fingerprintKeyVersion: number;
  sourceCanonicalKey: string;
  targetCanonicalKey: string | null;
  proposedScopeType: PersistLegacyImportPreviewItemCommand["proposedScopeType"];
  decision: LegacyCandidateTruthImportDecision;
  reasonCodes: readonly string[];
  existingAnswerVersionId: string | null;
}

export interface LegacyCandidateTruthImportPreviewResult {
  candidateId: string;
  previewRunId: string;
  migrationVersion: number;
  snapshotFingerprint: string;
  fingerprintKeyVersion: number;
  status: "PREVIEWED";
  sourceCount: number;
  counts: Record<LegacyCandidateTruthImportDecision, number>;
  reasonCounts: readonly { reasonCode: string; count: number }[];
  items: readonly LegacyCandidateTruthImportPreviewItem[];
  candidateTruthMutated: false;
  migrated: 0;
  productionCutover: false;
  createdAt: Date;
  idempotentReplay: boolean;
  alreadyPreviewed: boolean;
}

export interface CandidateTruthImportPreviewRepository {
  listCurrentAnswers(input: {
    accountId: string;
    candidateId: string;
    canonicalKeys: readonly string[];
  }): Promise<readonly LegacyImportCurrentAnswer[]>;
  commitPreview(command: PersistLegacyImportPreviewCommand): Promise<LegacyCandidateTruthImportPreviewResult>;
}

interface PlannedSource extends PersistLegacyImportPreviewItemCommand {
  normalizedValue: PersistableNormalizedValue | null;
  normalizedValueFingerprint: LegacyImportFingerprint | null;
  sourcePriority: number;
}

const knownCanonicals = new Set(CANONICAL_DEFINITIONS.map((definition) => definition.key));
const canonicalAliases = new Map([["SPONSORSHIP", "SPONSORSHIP_REQUIRED"]]);
const placeholders = new Set(["local user", "local@example.com", "n/a", "na", "none", "unknown", "-"]);
const directAnswerSources = new Set([
  "USER",
  "USER_MANUAL_INPUT",
  "VERIFIED_APPLICATION_INPUT",
  "ATTENTION_GAP",
  "PROFILE",
  "USER_ENTERED",
  "EXPLICIT_SAVE",
  "APPROVED_MEMORY"
]);
const sourcePriority: Record<LegacyCandidateTruthSourceKind, number> = {
  V1_VERSIONED_TRUTH: 50,
  APPROVED_FACT_MEMORY: 40,
  CANDIDATE_PROFILE: 30,
  MASTER_RESUME: 20,
  CANDIDATE_ANSWER: 10,
  SHARED_FORM_MEMORY: 0
};
const privateValue = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function itemKey(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 160) || createHash("sha256").update(label).digest("hex").slice(0, 24)
  );
}

function exactNumberString(raw: unknown): string | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? canonicalExactDecimal(String(raw)) : null;
  const match = cleanText(raw).replaceAll(",", "").match(/^(?:₹\s*)?(-?(?:0|[1-9]\d*)(?:\.\d{1,18})?)(?:\s*(?:lpa|lakhs?))?$/i);
  return match?.[1] ? canonicalExactDecimal(match[1]) : null;
}

function multiplyExactByInteger(value: string, multiplier: bigint): string | null {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const scaled = BigInt(`${whole}${fraction}` || "0") * multiplier;
  if (scaled % scale !== 0n) return null;
  const result = scaled / scale;
  return `${negative && result !== 0n ? "-" : ""}${result}`;
}

function parseList(raw: unknown, jsonList: boolean): string[] {
  let values: unknown = raw;
  if (jsonList && typeof raw === "string") {
    try {
      values = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(values) ? values : cleanText(values).split(/[,;\n]+/);
  return list.map(cleanText).filter(Boolean).slice(0, 100);
}

function callingCode(country: string | null | undefined): string | null {
  const key = cleanText(country).toUpperCase();
  if (["IN", "IND", "INDIA"].includes(key)) return "+91";
  if (["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA", "CA", "CANADA"].includes(key)) return "+1";
  if (["GB", "UK", "UNITED KINGDOM"].includes(key)) return "+44";
  if (["AU", "AUSTRALIA"].includes(key)) return "+61";
  return null;
}

function normalizeLegacyValue(
  valueType: ReturnType<typeof candidateAnswerPolicy>["valueType"],
  raw: unknown,
  metadata: z.output<typeof LegacySourceMetadataSchema>
): PersistableNormalizedValue | null {
  const alreadyNormalized = PersistableNormalizedValueSchema.safeParse(raw);
  if (alreadyNormalized.success) return alreadyNormalized.data.kind === valueType ? alreadyNormalized.data : null;
  let proposed: unknown = null;
  if (valueType === "STRING") {
    const value = cleanText(raw);
    if (value && !placeholders.has(value.toLowerCase())) proposed = { ...privateValue, kind: "STRING", value };
  } else if (valueType === "RICH_TEXT") {
    const value = String(raw ?? "").trim();
    if (value) proposed = { ...privateValue, kind: "RICH_TEXT", value };
  } else if (valueType === "URL") {
    const value = cleanText(raw);
    if (value) {
      try {
        const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
        proposed = { ...privateValue, kind: "URL", value: parsed.href.replace(/\/$/, "") };
      } catch {
        proposed = null;
      }
    }
  } else if (valueType === "PHONE") {
    const original = cleanText(raw);
    let digits = original.replace(/\D/g, "");
    let countryCode = original.startsWith("+")
      ? ["91", "44", "61", "1"].find((code) => digits.startsWith(code)) ?? null
      : null;
    if (countryCode) digits = digits.slice(countryCode.length);
    else {
      const inferred = callingCode(metadata.countryCode);
      countryCode = inferred?.slice(1) ?? null;
      if (countryCode && digits.length > 10 && digits.startsWith(countryCode)) digits = digits.slice(countryCode.length);
      if (countryCode === "91" && digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    }
    if (countryCode) {
      proposed = { ...privateValue, kind: "PHONE", countryCode: `+${countryCode}`, nationalNumber: digits, extension: null };
    }
  } else if (valueType === "BOOLEAN") {
    const value = cleanText(raw).toLowerCase();
    const truth = raw === true || raw === 1 || ["yes", "true", "1", "y", "willing", "required", "authorized", "authorized_in_market"].includes(value);
    const falsehood = raw === false || raw === 0 || ["no", "false", "0", "n", "not willing", "not required", "not_required", "not authorized", "not_authorized"].includes(value);
    if (truth || falsehood) proposed = { ...privateValue, kind: "BOOLEAN", value: truth };
  } else if (valueType === "INTEGER") {
    const exact = exactNumberString(raw);
    if (exact && /^-?\d+$/.test(exact)) proposed = { ...privateValue, kind: "INTEGER", value: Number(exact) };
  } else if (valueType === "DURATION") {
    const exact = exactNumberString(raw);
    const months = exact
      ? metadata.unit === "MONTHS"
        ? /^\d+$/.test(exact)
          ? exact
          : null
        : multiplyExactByInteger(exact, 12n)
      : null;
    if (months !== null) proposed = { ...privateValue, kind: "DURATION", months: Number(months) };
  } else if (valueType === "MONEY") {
    const exact = exactNumberString(raw);
    const amountExact = exact && metadata.unit === "LPA" ? multiplyExactByInteger(exact, 100_000n) : null;
    if (amountExact !== null) {
      proposed = { ...privateValue, kind: "MONEY", amountExact, currency: "INR", period: "YEAR" };
    }
  } else if (valueType === "MULTI_ENUM") {
    const labels = parseList(raw, metadata.unit === "JSON_LIST");
    if (labels.length) {
      proposed = {
        ...privateValue,
        kind: "MULTI_ENUM",
        values: [...new Map(labels.map((label) => [itemKey(label), { key: itemKey(label), label }])).values()]
      };
    }
  } else if (valueType === "ENUM") {
    const label = cleanText(raw);
    if (label) proposed = { ...privateValue, kind: "ENUM", value: { key: itemKey(label), label } };
  } else if (valueType === "DATE") {
    const value = cleanText(raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      proposed = { ...privateValue, kind: "DATE", value: { isoDate: value, precision: "DAY" } };
    }
  }
  const parsed = PersistableNormalizedValueSchema.safeParse(proposed);
  return parsed.success && parsed.data.kind === valueType ? parsed.data : null;
}

function parseConfirmedAt(value: Date | string | null | undefined, evaluatedAt: Date): Date | null | "INVALID" {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > evaluatedAt.getTime() + 5 * 60_000) return "INVALID";
  return parsed;
}

function terminalPlan(
  source: {
    sourceOrdinal: number;
    sourceKind: LegacyCandidateTruthSourceKind;
    sourceRecordFingerprint: string;
    sourceValueFingerprint: string;
    fingerprintKeyVersion: number;
    sourceCanonicalKey: string;
  },
  targetCanonicalKey: string | null,
  decision: LegacyCandidateTruthImportDecision,
  reasonCodes: readonly string[]
): PlannedSource {
  return {
    ...source,
    targetCanonicalKey,
    proposedScopeType: null,
    decision,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    existingAnswerVersionId: null,
    normalizedValue: null,
    normalizedValueFingerprint: null,
    sourcePriority: sourcePriority[source.sourceKind]
  };
}

export type LegacyEligibleSourceRevalidation =
  | {
      ok: true;
      sourceKind: LegacyCandidateTruthSourceKind;
      sourceCanonicalKey: string;
      targetCanonicalKey: string;
      normalizedValue: PersistableNormalizedValue;
      normalizedValueFingerprint: LegacyImportFingerprint;
      sourceIdentity: LegacyCandidateTruthSourceIdentity;
      proposedScopeType: "GLOBAL";
    }
  | {
      ok: false;
      decision: Exclude<LegacyCandidateTruthImportDecision, "ELIGIBLE" | "ALREADY_PRESENT">;
      reasonCodes: readonly string[];
      sourceIdentity: LegacyCandidateTruthSourceIdentity;
      targetCanonicalKey: string | null;
    };

/**
 * Revalidates only the narrow F1 automatic-import lane. It intentionally does
 * not make reconciliation decisions for ambiguous/contextual records.
 */
export function revalidateEligibleLegacyCandidateTruthSource(input: {
  source: LegacyCandidateTruthSource;
  evaluatedAt: Date;
  valueFingerprinter: CandidateValueFingerprinter;
  importFingerprinter: LegacyImportFingerprinter;
}): LegacyEligibleSourceRevalidation {
  const source = LegacyCandidateTruthSourceSchema.parse(input.source);
  const metadata = LegacySourceMetadataSchema.parse(source.metadata ?? {});
  const sourceIdentity = fingerprintLegacyCandidateTruthSource(source, input.importFingerprinter);
  const targetCanonicalKey = canonicalAliases.get(source.canonicalKey) ?? source.canonicalKey;
  const reject = (
    decision: Exclude<LegacyCandidateTruthImportDecision, "ELIGIBLE" | "ALREADY_PRESENT">,
    reasonCodes: readonly string[],
    target: string | null = targetCanonicalKey
  ): LegacyEligibleSourceRevalidation => ({
    ok: false,
    decision,
    reasonCodes,
    sourceIdentity,
    targetCanonicalKey: target
  });

  if (source.sourceKind === "SHARED_FORM_MEMORY") {
    return reject("SKIPPED", ["SHARED_MEMORY_NOT_CANDIDATE_OWNED"]);
  }
  if (!knownCanonicals.has(targetCanonicalKey)) {
    return reject("SKIPPED", ["CANONICAL_NOT_SUPPORTED_IN_V2"], null);
  }
  const policy = candidateAnswerPolicy(targetCanonicalKey);
  if (
    policy.learningMode === "APPLICATION_ONLY" ||
    policy.learningMode === "APPLICATION_AUTHORIZATION" ||
    policy.learningMode === "NEVER_LEARN"
  ) {
    return reject("SKIPPED", ["POLICY_FORBIDS_REUSABLE_IMPORT"]);
  }
  if (metadata.ambiguousDefault) {
    return reject("REVIEW_REQUIRED", ["PROFILE_DEFAULT_ORIGIN_AMBIGUOUS"]);
  }
  if (source.sourceKind === "V1_VERSIONED_TRUTH") {
    const status = cleanText(metadata.versionStatus).toUpperCase();
    if (status && status !== "ACTIVE") return reject("SKIPPED", ["V1_VERSION_NOT_ACTIVE"]);
    if (metadata.trustState === "REMOVED") {
      return reject("SKIPPED", ["V1_REMOVED_TRUTH_IS_NOT_REIMPORTED"]);
    }
    if (metadata.trustState !== "TRUSTED") {
      return reject("REVIEW_REQUIRED", ["V1_REVIEW_TRUTH_REQUIRES_RECONFIRMATION"]);
    }
  }
  if (source.sourceKind === "APPROVED_FACT_MEMORY") {
    if (!metadata.candidateApproved) {
      return reject("REVIEW_REQUIRED", ["LEGACY_FACT_NOT_CANDIDATE_APPROVED"]);
    }
    if (metadata.factScope !== "CANDIDATE_PROFILE") {
      return reject("REVIEW_REQUIRED", ["NON_PROFILE_FACT_SCOPE_REQUIRES_RECONCILIATION"]);
    }
  }
  if (source.sourceKind === "CANDIDATE_ANSWER") {
    const answerSource = cleanText(metadata.answerSource).toUpperCase();
    if (/AI|GENERATED|MODEL/.test(answerSource)) {
      return reject("SKIPPED", ["AI_GENERATED_LEGACY_ANSWER_DISCARDED"]);
    }
    if (!directAnswerSources.has(answerSource)) {
      return reject("REVIEW_REQUIRED", ["LEGACY_ANSWER_SOURCE_NOT_VERIFIED"]);
    }
    if ((metadata.confidence ?? 0) < 0.9) {
      return reject("REVIEW_REQUIRED", ["LEGACY_ANSWER_CONFIDENCE_TOO_LOW"]);
    }
  }
  if (source.sourceKind === "MASTER_RESUME" && metadata.resumeCandidateConfirmed !== true) {
    return reject("REVIEW_REQUIRED", ["MASTER_RESUME_NOT_CANDIDATE_CONFIRMED"]);
  }
  if (metadata.scopeKind === "CONTEXTUAL") {
    return reject("REVIEW_REQUIRED", ["CONTEXTUAL_SCOPE_REQUIRES_ID_RECONCILIATION"]);
  }
  if (metadata.scopeKind === "ENTITY" || policy.entityType) {
    return reject("REVIEW_REQUIRED", ["STABLE_ENTITY_BINDING_REQUIRED"]);
  }
  if (policy.answerClass === "LEGAL_FACT") {
    return reject("REVIEW_REQUIRED", ["LEGAL_FACT_REQUIRES_RECONFIRMATION"]);
  }
  if (policy.valueType === "FILE_REF") {
    return reject("REVIEW_REQUIRED", ["FILE_REFERENCE_REQUIRES_EXPLICIT_SELECTION"]);
  }
  if (!policy.allowedScopeTypes.includes("GLOBAL")) {
    return reject("REVIEW_REQUIRED", ["GLOBAL_IMPORT_NOT_ALLOWED_BY_POLICY"]);
  }
  const normalizedValue = normalizeLegacyValue(policy.valueType, source.rawValue, metadata);
  if (!normalizedValue) return reject("INVALID", ["LEGACY_VALUE_NOT_SAFELY_NORMALIZABLE"]);
  const anomaly = evaluateCandidateAnswerAnomaly({ policy, proposedValue: normalizedValue });
  if (!anomaly.allowed) return reject("INVALID", anomaly.reasonCodes);
  if (anomaly.requiresReview) return reject("REVIEW_REQUIRED", anomaly.reasonCodes);
  const confirmedAt = parseConfirmedAt(source.confirmedAt, input.evaluatedAt);
  if (confirmedAt === "INVALID") return reject("INVALID", ["LEGACY_CONFIRMATION_TIME_INVALID"]);
  if (!confirmedAt) return reject("REVIEW_REQUIRED", ["LEGACY_CONFIRMATION_TIME_MISSING"]);
  const freshness = evaluateAnswerFreshness({
    trustState: "TRUSTED",
    confirmedAt,
    freshnessDays: policy.freshnessDays,
    evaluatedAt: input.evaluatedAt
  });
  if (!freshness.reusable) return reject("REVIEW_REQUIRED", ["LEGACY_VALUE_STALE"]);
  const scope = resolveCandidateAnswerScope({ policy, scopeType: "GLOBAL" });
  if (!scope.ok) return reject("REVIEW_REQUIRED", ["GLOBAL_SCOPE_REQUIRES_RECONCILIATION"]);
  return {
    ok: true,
    sourceKind: source.sourceKind,
    sourceCanonicalKey: source.canonicalKey,
    targetCanonicalKey,
    normalizedValue,
    normalizedValueFingerprint: input.valueFingerprinter.fingerprint(normalizedValue),
    sourceIdentity,
    proposedScopeType: "GLOBAL"
  };
}

export class LegacyCandidateTruthImportPreviewService {
  constructor(
    private readonly repository: CandidateTruthImportPreviewRepository,
    private readonly valueFingerprinter: CandidateValueFingerprinter,
    private readonly importFingerprinter: LegacyImportFingerprinter,
    private readonly clock: Clock = systemClock
  ) {}

  async preview(input: {
    accountId: string;
    candidateId: string;
    idempotencyKey: string;
    migrationVersion?: number;
    sources: readonly LegacyCandidateTruthSource[];
  }): Promise<LegacyCandidateTruthImportPreviewResult> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    const migrationVersion = z.number().int().positive().max(100).parse(
      input.migrationVersion ?? LEGACY_CANDIDATE_TRUTH_IMPORT_VERSION
    );
    if (input.sources.length > 2000) {
      throw new ValidationError("A legacy import preview accepts at most 2000 source records.");
    }
    const evaluatedAt = this.clock.now();
    const parsed = input.sources.map((source) => LegacyCandidateTruthSourceSchema.parse(source));
    const uniqueRecords = new Set(parsed.map((source) => `${source.sourceKind}:${source.sourceRecordId}`));
    if (uniqueRecords.size !== parsed.length) {
      throw new ValidationError("Legacy import source identities must be unique.", {
        reasonCode: "DUPLICATE_LEGACY_SOURCE_IDENTITY"
      });
    }

    const fingerprinted = fingerprintLegacySources(parsed, this.importFingerprinter);

    const plans: PlannedSource[] = fingerprinted.map((entry, sourceOrdinal) => {
      const base = {
        sourceOrdinal,
        sourceKind: entry.source.sourceKind,
        sourceRecordFingerprint: entry.sourceRecordFingerprint.digest,
        sourceValueFingerprint: entry.sourceValueFingerprint.digest,
        fingerprintKeyVersion: entry.sourceValueFingerprint.keyVersion,
        sourceCanonicalKey: entry.source.canonicalKey
      };
      const targetCanonicalKey = canonicalAliases.get(entry.source.canonicalKey) ?? entry.source.canonicalKey;
      if (entry.source.sourceKind === "SHARED_FORM_MEMORY") {
        return terminalPlan(base, knownCanonicals.has(targetCanonicalKey) ? targetCanonicalKey : null, "SKIPPED", [
          "SHARED_MEMORY_NOT_CANDIDATE_OWNED"
        ]);
      }
      if (!knownCanonicals.has(targetCanonicalKey)) {
        return terminalPlan(base, null, "SKIPPED", ["CANONICAL_NOT_SUPPORTED_IN_V2"]);
      }
      const policy = candidateAnswerPolicy(targetCanonicalKey);
      if (
        policy.learningMode === "APPLICATION_ONLY" ||
        policy.learningMode === "APPLICATION_AUTHORIZATION" ||
        policy.learningMode === "NEVER_LEARN"
      ) {
        return terminalPlan(base, targetCanonicalKey, "SKIPPED", ["POLICY_FORBIDS_REUSABLE_IMPORT"]);
      }
      if (entry.metadata.ambiguousDefault) {
        return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["PROFILE_DEFAULT_ORIGIN_AMBIGUOUS"]);
      }
      if (entry.source.sourceKind === "V1_VERSIONED_TRUTH") {
        const status = cleanText(entry.metadata.versionStatus).toUpperCase();
        if (status && status !== "ACTIVE") {
          return terminalPlan(base, targetCanonicalKey, "SKIPPED", ["V1_VERSION_NOT_ACTIVE"]);
        }
        if (entry.metadata.trustState === "REMOVED") {
          return terminalPlan(base, targetCanonicalKey, "SKIPPED", ["V1_REMOVED_TRUTH_IS_NOT_REIMPORTED"]);
        }
        if (entry.metadata.trustState !== "TRUSTED") {
          return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["V1_REVIEW_TRUTH_REQUIRES_RECONFIRMATION"]);
        }
      }
      if (entry.source.sourceKind === "APPROVED_FACT_MEMORY") {
        if (!entry.metadata.candidateApproved) {
          return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["LEGACY_FACT_NOT_CANDIDATE_APPROVED"]);
        }
        if (entry.metadata.factScope !== "CANDIDATE_PROFILE") {
          return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["NON_PROFILE_FACT_SCOPE_REQUIRES_RECONCILIATION"]);
        }
      }
      if (entry.source.sourceKind === "CANDIDATE_ANSWER") {
        const answerSource = cleanText(entry.metadata.answerSource).toUpperCase();
        if (/AI|GENERATED|MODEL/.test(answerSource)) {
          return terminalPlan(base, targetCanonicalKey, "SKIPPED", ["AI_GENERATED_LEGACY_ANSWER_DISCARDED"]);
        }
        if (!directAnswerSources.has(answerSource)) {
          return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["LEGACY_ANSWER_SOURCE_NOT_VERIFIED"]);
        }
        if ((entry.metadata.confidence ?? 0) < 0.9) {
          return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["LEGACY_ANSWER_CONFIDENCE_TOO_LOW"]);
        }
      }
      if (
        entry.source.sourceKind === "MASTER_RESUME" &&
        entry.metadata.resumeCandidateConfirmed !== true
      ) {
        return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["MASTER_RESUME_NOT_CANDIDATE_CONFIRMED"]);
      }
      if (entry.metadata.scopeKind === "CONTEXTUAL") {
        return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["CONTEXTUAL_SCOPE_REQUIRES_ID_RECONCILIATION"]);
      }
      if (entry.metadata.scopeKind === "ENTITY" || policy.entityType) {
        return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["STABLE_ENTITY_BINDING_REQUIRED"]);
      }
      if (policy.answerClass === "LEGAL_FACT") {
        return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["LEGAL_FACT_REQUIRES_RECONFIRMATION"]);
      }
      if (policy.valueType === "FILE_REF") {
        return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["FILE_REFERENCE_REQUIRES_EXPLICIT_SELECTION"]);
      }
      if (!policy.allowedScopeTypes.includes("GLOBAL")) {
        return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["GLOBAL_IMPORT_NOT_ALLOWED_BY_POLICY"]);
      }
      const normalizedValue = normalizeLegacyValue(policy.valueType, entry.source.rawValue, entry.metadata);
      if (!normalizedValue) {
        return terminalPlan(base, targetCanonicalKey, "INVALID", ["LEGACY_VALUE_NOT_SAFELY_NORMALIZABLE"]);
      }
      const anomaly = evaluateCandidateAnswerAnomaly({ policy, proposedValue: normalizedValue });
      if (!anomaly.allowed) return terminalPlan(base, targetCanonicalKey, "INVALID", anomaly.reasonCodes);
      if (anomaly.requiresReview) {
        return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", anomaly.reasonCodes);
      }
      const confirmedAt = parseConfirmedAt(entry.source.confirmedAt, evaluatedAt);
      if (confirmedAt === "INVALID") {
        return terminalPlan(base, targetCanonicalKey, "INVALID", ["LEGACY_CONFIRMATION_TIME_INVALID"]);
      }
      if (!confirmedAt) {
        return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["LEGACY_CONFIRMATION_TIME_MISSING"]);
      }
      const freshness = evaluateAnswerFreshness({
        trustState: "TRUSTED",
        confirmedAt,
        freshnessDays: policy.freshnessDays,
        evaluatedAt
      });
      if (!freshness.reusable) {
        return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["LEGACY_VALUE_STALE"]);
      }
      const scope = resolveCandidateAnswerScope({ policy, scopeType: "GLOBAL" });
      if (!scope.ok) {
        return terminalPlan(base, targetCanonicalKey, "REVIEW_REQUIRED", ["GLOBAL_SCOPE_REQUIRES_RECONCILIATION"]);
      }
      return {
        ...base,
        targetCanonicalKey,
        proposedScopeType: "GLOBAL",
        decision: "ELIGIBLE",
        reasonCodes: ["POLICY_APPROVED_UNAMBIGUOUS_LEGACY_VALUE"],
        existingAnswerVersionId: null,
        normalizedValue,
        normalizedValueFingerprint: this.valueFingerprinter.fingerprint(normalizedValue),
        sourcePriority: sourcePriority[entry.source.sourceKind]
      };
    });

    const eligibleGroups = new Map<string, PlannedSource[]>();
    for (const plan of plans) {
      if (plan.decision !== "ELIGIBLE" || !plan.targetCanonicalKey || !plan.normalizedValueFingerprint) continue;
      const group = eligibleGroups.get(plan.targetCanonicalKey) ?? [];
      group.push(plan);
      eligibleGroups.set(plan.targetCanonicalKey, group);
    }
    for (const group of eligibleGroups.values()) {
      const distinct = new Set(group.map((plan) => `${plan.normalizedValueFingerprint?.keyVersion}:${plan.normalizedValueFingerprint?.digest}`));
      if (distinct.size > 1) {
        for (const plan of group) {
          plan.decision = "CONFLICT";
          plan.reasonCodes = ["NON_EQUIVALENT_LEGACY_SOURCES"];
        }
        continue;
      }
      group.sort((left, right) => right.sourcePriority - left.sourcePriority || left.sourceRecordFingerprint.localeCompare(right.sourceRecordFingerprint));
      for (const duplicate of group.slice(1)) {
        duplicate.decision = "SKIPPED";
        duplicate.reasonCodes = ["EQUIVALENT_LOWER_PRIORITY_SOURCE"];
      }
    }

    const selected = plans.filter((plan) => plan.decision === "ELIGIBLE" && plan.targetCanonicalKey);
    const current = await this.repository.listCurrentAnswers({
      accountId,
      candidateId,
      canonicalKeys: selected.map((plan) => plan.targetCanonicalKey as string)
    });
    const currentByCanonical = new Map(
      current
        .filter((answer) => answer.scopeFingerprint === resolveGlobalScopeFingerprint())
        .map((answer) => [answer.canonicalKey, answer])
    );
    for (const plan of selected) {
      const existing = currentByCanonical.get(plan.targetCanonicalKey as string);
      if (!existing) continue;
      plan.existingAnswerVersionId = existing.answerVersionId;
      if (existing.trustState === "REMOVED") {
        plan.decision = "CONFLICT";
        plan.reasonCodes = ["REMOVED_V2_TRUTH_BLOCKS_LEGACY_IMPORT"];
      } else if (
        existing.fingerprintKeyVersion === plan.normalizedValueFingerprint?.keyVersion &&
        existing.valueFingerprint === plan.normalizedValueFingerprint.digest
      ) {
        plan.decision = "ALREADY_PRESENT";
        plan.reasonCodes = ["EQUIVALENT_V2_TRUTH_EXISTS"];
      } else {
        plan.decision = "CONFLICT";
        plan.reasonCodes = [
          existing.fingerprintKeyVersion === plan.normalizedValueFingerprint?.keyVersion
            ? "ACTIVE_V2_TRUTH_WOULD_BE_OVERWRITTEN"
            : "V2_FINGERPRINT_KEY_VERSION_MISMATCH"
        ];
      }
    }

    const publicItems = plans
      .sort((left, right) => left.sourceOrdinal - right.sourceOrdinal)
      .map((plan): PersistLegacyImportPreviewItemCommand => ({
        sourceOrdinal: plan.sourceOrdinal,
        sourceKind: plan.sourceKind,
        sourceRecordFingerprint: plan.sourceRecordFingerprint,
        sourceValueFingerprint: plan.sourceValueFingerprint,
        fingerprintKeyVersion: plan.fingerprintKeyVersion,
        sourceCanonicalKey: plan.sourceCanonicalKey,
        targetCanonicalKey: plan.targetCanonicalKey,
        proposedScopeType: plan.proposedScopeType,
        decision: plan.decision,
        reasonCodes: plan.reasonCodes,
        existingAnswerVersionId: plan.existingAnswerVersionId
      }));
    const snapshot = fingerprintLegacyCandidateTruthSnapshot(parsed, this.importFingerprinter);
    const requestFingerprint = createHash("sha256")
      .update(stableJson({
        accountId,
        candidateId,
        migrationVersion,
        snapshotFingerprint: snapshot.digest,
        fingerprintKeyVersion: snapshot.keyVersion
      }))
      .digest("hex");
    return this.repository.commitPreview({
      accountId,
      candidateId,
      migrationVersion,
      snapshotFingerprint: snapshot.digest,
      fingerprintKeyVersion: snapshot.keyVersion,
      idempotencyKey,
      requestFingerprint,
      createdAt: evaluatedAt,
      items: publicItems
    });
  }
}

let cachedGlobalScopeFingerprint: string | null = null;
function resolveGlobalScopeFingerprint(): string {
  if (cachedGlobalScopeFingerprint) return cachedGlobalScopeFingerprint;
  const policy = candidateAnswerPolicy("EMAIL");
  const scope = resolveCandidateAnswerScope({ policy, scopeType: "GLOBAL" });
  if (!scope.ok) throw new Error("Global candidate-answer scope contract is unavailable.");
  cachedGlobalScopeFingerprint = scope.scope.scopeFingerprint;
  return cachedGlobalScopeFingerprint;
}

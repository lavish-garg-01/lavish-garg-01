import {
  candidateAnswerPolicy,
  type PersistableNormalizedValue
} from "@job-hunter-v2/candidate-truth";
import type { ObservedFieldValue } from "@job-hunter-v2/contracts";
import { AnswerUnitError, learnMoney, learnDurationMonths, learnNoticeDays, ValidationError } from "@job-hunter-v2/domain";

function textOf(value: ObservedFieldValue): string {
  if (value.kind === "TEXT") return value.value.trim();
  if (value.kind === "SINGLE_OPTION") return value.label.trim();
  throw new ValidationError("This field value cannot be converted safely.", {
    reasonCode: "OBSERVED_VALUE_SHAPE_UNSUPPORTED"
  });
}

function exactNumber(value: string): string {
  const cleaned = value.replace(/[,₹$£€\s]/g, "");
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(cleaned)) {
    throw new ValidationError("This numeric answer could not be understood safely.", {
      reasonCode: "OBSERVED_NUMBER_INVALID"
    });
  }
  return cleaned;
}

function enumItem(input: { key: string | null; label: string }) {
  return { key: (input.key || input.label).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 160), label: input.label.trim() };
}

export function normalizeObservedFieldValue(input: {
  canonicalKey: string;
  value: ObservedFieldValue;
  labelEvidence: readonly string[];
  countryCode: string | null;
}): PersistableNormalizedValue {
  try { return normalize(input); }
  catch (error) {
    if (error instanceof AnswerUnitError) throw new ValidationError("The answer's unit is not clear enough to learn safely.", { reasonCode: `OBSERVED_${error.reasonCode}` });
    throw error;
  }
}

function normalize(input: { canonicalKey: string; value: ObservedFieldValue; labelEvidence: readonly string[]; countryCode: string | null }): PersistableNormalizedValue {
  const policy = candidateAnswerPolicy(input.canonicalKey);
  const common = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };
  if (policy.valueType === "STRING") return { ...common, kind: "STRING", value: textOf(input.value) };
  if (policy.valueType === "RICH_TEXT") return { ...common, kind: "RICH_TEXT", value: textOf(input.value) };
  if (policy.valueType === "URL") return { ...common, kind: "URL", value: textOf(input.value) };
  if (policy.valueType === "BOOLEAN") {
    if (input.value.kind === "BOOLEAN") return { ...common, kind: "BOOLEAN", value: input.value.value };
    const normalized = textOf(input.value).toLowerCase();
    if (["yes", "true", "1", "agree", "authorized"].includes(normalized)) return { ...common, kind: "BOOLEAN", value: true };
    if (["no", "false", "0", "disagree", "not authorized"].includes(normalized)) return { ...common, kind: "BOOLEAN", value: false };
    throw new ValidationError("This yes/no answer is ambiguous.", { reasonCode: "OBSERVED_BOOLEAN_AMBIGUOUS" });
  }
  if (policy.valueType === "INTEGER") {
    if (input.canonicalKey === "NOTICE_PERIOD") {
      const raw = textOf(input.value);
      // Bare numbers in month/week-labelled fields are not days.
      if (/^\d+$/.test(raw) && /\bmonths?\b/i.test(input.labelEvidence.join(" "))) throw new AnswerUnitError("NOTICE_DURATION_AMBIGUOUS");
      const qualified = /^\d+$/.test(raw) && /\bweeks?\b/i.test(input.labelEvidence.join(" ")) ? `${raw} weeks` : raw;
      return { ...common, kind: "INTEGER", value: learnNoticeDays(qualified) };
    }
    const value = Number(exactNumber(textOf(input.value)));
    if (!Number.isSafeInteger(value)) throw new ValidationError("This whole-number answer is invalid.");
    return { ...common, kind: "INTEGER", value };
  }
  if (policy.valueType === "DECIMAL") return { ...common, kind: "DECIMAL", valueExact: exactNumber(textOf(input.value)) };
  if (policy.valueType === "DATE") {
    if (input.value.kind === "DATE") return { ...common, kind: "DATE", value: { isoDate: input.value.isoDate, precision: input.value.precision } };
    const value = textOf(input.value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError("This date answer is invalid.");
    return { ...common, kind: "DATE", value: { isoDate: value, precision: "DAY" } };
  }
  if (policy.valueType === "ENUM") {
    if (input.value.kind === "SINGLE_OPTION") return { ...common, kind: "ENUM", value: enumItem(input.value) };
    const label = textOf(input.value);
    return { ...common, kind: "ENUM", value: enumItem({ key: null, label }) };
  }
  if (policy.valueType === "MULTI_ENUM") {
    if (input.value.kind !== "MULTI_OPTION") throw new ValidationError("This multiple-choice answer is invalid.");
    return { ...common, kind: "MULTI_ENUM", values: input.value.values.map(enumItem) };
  }
  if (policy.valueType === "DURATION") {
    return { ...common, kind: "DURATION", months: learnDurationMonths(textOf(input.value), input.labelEvidence.join(" ")) };
  }
  if (policy.valueType === "MONEY") {
    return { ...common, kind: "MONEY", ...learnMoney(textOf(input.value), input.labelEvidence.join(" "), input.countryCode) };
  }
  if (policy.valueType === "PHONE") {
    const raw = textOf(input.value).replace(/[^\d+]/g, "");
    const defaultCountry = input.countryCode === "IN" ? "+91" : null;
    const match = raw.match(/^(\+[1-9]\d{0,3})?(\d{4,14})$/);
    const countryCode = match?.[1] ?? defaultCountry;
    const nationalNumber = match?.[2];
    if (!countryCode || !nationalNumber) throw new ValidationError("This phone answer requires an explicit country code.");
    return { ...common, kind: "PHONE", countryCode, nationalNumber, extension: null };
  }
  throw new ValidationError("This field type is not eligible for automatic learning yet.", {
    canonicalKey: input.canonicalKey,
    reasonCode: "OBSERVED_VALUE_TYPE_UNSUPPORTED"
  });
}

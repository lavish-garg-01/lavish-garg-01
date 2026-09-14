import type { CandidateAnswerPolicy } from "./policy.js";
import {
  PersistableNormalizedValueSchema,
  type PersistableNormalizedValue
} from "./normalized-value.js";

export interface CandidateAnswerAnomaly {
  allowed: boolean;
  requiresReview: boolean;
  reasonCodes: readonly string[];
}

function numericValue(value: PersistableNormalizedValue): number | null {
  if (value.kind === "INTEGER") return value.value;
  if (value.kind === "DECIMAL") return Number(value.valueExact);
  if (value.kind === "DURATION") return value.months;
  if (value.kind === "MONEY") return Number(value.amountExact);
  return null;
}

export function evaluateCandidateAnswerAnomaly(input: {
  policy: CandidateAnswerPolicy;
  proposedValue: PersistableNormalizedValue;
  previousValue?: PersistableNormalizedValue | null;
}): CandidateAnswerAnomaly {
  const proposed = PersistableNormalizedValueSchema.parse(input.proposedValue);
  if (proposed.kind !== input.policy.valueType) {
    return { allowed: false, requiresReview: true, reasonCodes: ["VALUE_TYPE_MISMATCH"] };
  }
  if (input.policy.answerClass === "PROTECTED" || input.policy.learningMode === "NEVER_LEARN") {
    return { allowed: false, requiresReview: true, reasonCodes: ["POLICY_FORBIDS_CANDIDATE_TRUTH"] };
  }
  if (input.policy.canonicalKey === "NOTICE_PERIOD" && proposed.kind === "INTEGER") {
    if (proposed.value < 0 || proposed.value > 365) {
      return { allowed: false, requiresReview: true, reasonCodes: ["VALUE_OUTSIDE_POLICY_RANGE"] };
    }
  }
  if (input.policy.canonicalKey === "EMAIL" && proposed.kind === "STRING") {
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposed.value);
    if (!validEmail) {
      return { allowed: false, requiresReview: true, reasonCodes: ["EMAIL_FORMAT_INVALID"] };
    }
  }
  if (
    ["CURRENT_CTC", "EXPECTED_CTC"].includes(input.policy.canonicalKey) &&
    proposed.kind === "MONEY" &&
    Number(proposed.amountExact) < 0
  ) {
    return { allowed: false, requiresReview: true, reasonCodes: ["NEGATIVE_COMPENSATION_REJECTED"] };
  }

  const previous = input.previousValue
    ? PersistableNormalizedValueSchema.parse(input.previousValue)
    : null;
  if (proposed.kind === "MONEY" && previous?.kind === "MONEY") {
    if (proposed.currency !== previous.currency || proposed.period !== previous.period) {
      return { allowed: true, requiresReview: true, reasonCodes: ["COMPENSATION_UNIT_CHANGED"] };
    }
    const currentAmount = numericValue(proposed);
    const previousAmount = numericValue(previous);
    if (
      currentAmount !== null &&
      previousAmount !== null &&
      currentAmount > 0 &&
      previousAmount > 0
    ) {
      const ratio = currentAmount / previousAmount;
      if (ratio > 5 || ratio < 0.2) {
        return { allowed: true, requiresReview: true, reasonCodes: ["UNUSUAL_VALUE_DELTA"] };
      }
    }
  }
  return { allowed: true, requiresReview: false, reasonCodes: ["ANOMALY_CHECK_PASSED"] };
}

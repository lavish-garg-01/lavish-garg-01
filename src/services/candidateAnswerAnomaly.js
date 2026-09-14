import { getDb } from "../database/connection.js";
import { normalizedValueSchema } from "../contracts/normalizedValue.js";

function parseJson(value, fallback = {}) {
    try { return JSON.parse(value || "") ?? fallback; } catch { return fallback; }
}

function numericValue(value) {
    if (!value) return null;
    if (value.kind === "MONEY") return Number(value.amountExact);
    if (value.kind === "INTEGER") return value.value;
    if (value.kind === "DECIMAL") return Number(value.valueExact);
    if (value.kind === "DURATION") return value.months;
    return null;
}

function comparableNumeric(left, right) {
    if (!left || !right || left.kind !== right.kind) return false;
    if (left.kind === "MONEY") return left.currency === right.currency && left.period === right.period;
    return ["INTEGER", "DECIMAL", "DURATION"].includes(left.kind);
}

export function evaluateAnswerAnomaly(policy, proposedValue, previousValue = null) {
    const parsed = normalizedValueSchema.safeParse(proposedValue);
    if (!parsed.success) return { allowed: false, presentation: "REVIEW_TO_SAVE", reasonCodes: ["NORMALIZED_VALUE_INVALID"] };
    const row = policy.anomalyProfile
        ? getDb().prepare("SELECT * FROM canonical_answer_anomaly_profiles WHERE profile_key = ?").get(policy.anomalyProfile)
        : null;
    const rules = parseJson(row?.rules_json);
    const reasons = [];
    if (rules.rejectBlank && parsed.data.kind === "STRING" && !parsed.data.value.trim()) reasons.push("BLANK_VALUE_REJECTED");
    if (rules.rejectNegative && numericValue(parsed.data) < 0) reasons.push("NEGATIVE_VALUE_REJECTED");
    if (rules.maxMonths && parsed.data.kind === "DURATION" && parsed.data.months > rules.maxMonths) reasons.push("VALUE_OUTSIDE_POLICY_RANGE");
    if (rules.maxValue && numericValue(parsed.data) > rules.maxValue) reasons.push("VALUE_OUTSIDE_POLICY_RANGE");
    const current = numericValue(parsed.data);
    const previous = numericValue(previousValue);
    let suspicious = false;
    if (current !== null && previous !== null && current > 0 && previous > 0 && comparableNumeric(parsed.data, previousValue)) {
        const ratio = current / previous;
        suspicious = ratio > Number(rules.maxRatio || Infinity) || ratio < Number(rules.minRatio || 0);
        if (suspicious) reasons.push("UNUSUAL_VALUE_DELTA");
    } else if (parsed.data.kind === "MONEY" && previousValue?.kind === "MONEY"
        && (parsed.data.currency !== previousValue.currency || parsed.data.period !== previousValue.period)) {
        suspicious = true;
        reasons.push("COMPENSATION_UNIT_CHANGED");
    }
    return {
        allowed: !reasons.some((reason) => reason.endsWith("REJECTED") || reason === "VALUE_OUTSIDE_POLICY_RANGE"),
        suspicious,
        presentation: suspicious ? "REVIEW_TO_SAVE" : (row?.default_presentation || policy.learningPresentation),
        reasonCodes: reasons.length ? reasons : ["ANOMALY_CHECK_PASSED"]
    };
}

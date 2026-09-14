import { fieldAnswerContractSchema, FIELD_ANSWER_CONTRACT_VERSION } from "../contracts/fieldAnswerContract.js";
import { contractIdSchema, stableContractHash } from "../contracts/contractPrimitives.js";
import { fieldSemanticResultSchema } from "../contracts/fieldSemanticResult.js";
import { resolveCandidateTruthBatch } from "../repositories/candidateAnswerVersionRepository.js";
import { sharedAnswerPolicy } from "./answerPolicyRegistry.js";
import { primarySharedScope } from "./scopeRankPolicy.js";

export const FIELD_ANSWER_CONTRACT_MODE = "SHADOW";

const OPTION_CONTROLS = new Set(["select-one", "select", "radio", "checkbox-group", "choice-group", "combobox"]);
const FORBIDDEN_CONTROL_TYPES = new Set(["password", "hidden", "file", "submit", "reset", "button"]);
const SOURCE_CONFIDENCE = Object.freeze({
    PROFILE: 1,
    VERIFIED_RESUME: 0.98,
    DERIVED: 0.9,
    USER_ENTERED: 1,
    EXPLICIT_SAVE: 1,
    APPROVED_MEMORY: 0.96,
    MIGRATED_LEGACY: 0.8,
    USER_UNDO: 1,
    USER_RESTORE: 1
});
const CONTRACT_SOURCE = Object.freeze({
    PROFILE: "PROFILE",
    VERIFIED_RESUME: "VERIFIED_RESUME",
    DERIVED: "DERIVED",
    USER_ENTERED: "USER_ENTERED",
    EXPLICIT_SAVE: "USER_ENTERED",
    APPROVED_MEMORY: "APPROVED_MEMORY",
    MIGRATED_LEGACY: "APPROVED_MEMORY",
    USER_UNDO: "APPROVED_MEMORY",
    USER_RESTORE: "APPROVED_MEMORY"
});

function normalizedText(value) {
    return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanOptions(options = []) {
    return (Array.isArray(options) ? options : []).slice(0, 100).map((option) => {
        if (typeof option === "string") return { value: option, label: option, disabled: false };
        return {
            value: String(option?.value ?? option?.key ?? "").slice(0, 240),
            label: String(option?.label ?? option?.text ?? option?.value ?? option?.key ?? "").slice(0, 240),
            disabled: Boolean(option?.disabled)
        };
    }).filter((option) => option.value || option.label);
}

function exactOption(targets, options) {
    const wanted = new Set(targets.map(normalizedText).filter(Boolean));
    const matches = options.filter((option) => !option.disabled
        && [option.value, option.label].some((value) => wanted.has(normalizedText(value))));
    return matches.length === 1 ? matches[0] : null;
}

function validateTextConstraints(renderedValue, control) {
    if (control.minLength != null && renderedValue.length < control.minLength) return "CONTROL_MIN_LENGTH_NOT_MET";
    if (control.maxLength != null && renderedValue.length > control.maxLength) return "CONTROL_MAX_LENGTH_EXCEEDED";
    // Employer regexes are untrusted and can be expensive to execute on the
    // server. The browser validity receipt will own pattern validation later.
    if (control.pattern) return "CONTROL_PATTERN_REQUIRES_BROWSER_VALIDATION";
    if (control.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(renderedValue)) return "CONTROL_EMAIL_FORMAT_INVALID";
    if (control.type === "url") {
        try {
            if (!/^https?:$/i.test(new URL(renderedValue).protocol)) return "CONTROL_URL_FORMAT_INVALID";
        } catch {
            return "CONTROL_URL_FORMAT_INVALID";
        }
    }
    if (control.type === "number") {
        if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(renderedValue)) return "CONTROL_NUMBER_FORMAT_INVALID";
        const number = Number(renderedValue);
        if (!Number.isFinite(number)) return "CONTROL_NUMBER_FORMAT_INVALID";
        if (control.min != null && number < control.min) return "CONTROL_NUMBER_BELOW_MIN";
        if (control.max != null && number > control.max) return "CONTROL_NUMBER_ABOVE_MAX";
        if (control.step != null) {
            const ratio = (number - (control.min ?? 0)) / control.step;
            if (Math.abs(ratio - Math.round(ratio)) > 1e-9) return "CONTROL_NUMBER_STEP_MISMATCH";
        }
    }
    return null;
}

/**
 * Part 2B intentionally starts with a small, deterministic representation set.
 * Money, phone parts, durations, multi-selects and files remain fail-closed until
 * the packaged representation registry in Part 2D is enabled.
 */
export function resolveBaselineRepresentation(normalizedValue, rawControl = {}) {
    const control = {
        type: String(rawControl.type || "text").trim().toLowerCase(),
        minLength: Number.isInteger(rawControl.minLength) && rawControl.minLength >= 0 ? rawControl.minLength : null,
        maxLength: Number.isInteger(rawControl.maxLength) && rawControl.maxLength >= 0 ? rawControl.maxLength : null,
        min: Number.isFinite(rawControl.min) ? Number(rawControl.min) : null,
        max: Number.isFinite(rawControl.max) ? Number(rawControl.max) : null,
        step: Number.isFinite(rawControl.step) && Number(rawControl.step) > 0 ? Number(rawControl.step) : null,
        pattern: String(rawControl.pattern || "").trim().slice(0, 240),
        options: cleanOptions(rawControl.options)
    };
    if (FORBIDDEN_CONTROL_TYPES.has(control.type)) {
        return { ok: false, reasonCodes: ["CONTROL_TYPE_FORBIDDEN"] };
    }
    const kind = normalizedValue.kind;
    let ruleKey = null;
    let renderedValue = null;

    if (["STRING", "RICH_TEXT", "URL"].includes(kind)) {
        const value = normalizedValue.value;
        if (OPTION_CONTROLS.has(control.type)) {
            const option = exactOption([value], control.options);
            if (!option) return { ok: false, reasonCodes: ["EXACT_ENABLED_OPTION_NOT_FOUND"] };
            ruleKey = "OPTION_EXACT_IDENTITY";
            renderedValue = option.value || option.label;
        } else {
            ruleKey = "TEXT_IDENTITY";
            renderedValue = String(value);
        }
    } else if (kind === "INTEGER") {
        if (OPTION_CONTROLS.has(control.type)) {
            const option = exactOption([String(normalizedValue.value)], control.options);
            if (!option) return { ok: false, reasonCodes: ["EXACT_ENABLED_OPTION_NOT_FOUND"] };
            ruleKey = "INTEGER_OPTION_EXACT";
            renderedValue = option.value || option.label;
        } else {
            ruleKey = "INTEGER_IDENTITY";
            renderedValue = String(normalizedValue.value);
        }
    } else if (kind === "DECIMAL") {
        if (OPTION_CONTROLS.has(control.type)) return { ok: false, reasonCodes: ["DECIMAL_OPTION_REPRESENTATION_UNKNOWN"] };
        ruleKey = "DECIMAL_EXACT_IDENTITY";
        renderedValue = normalizedValue.valueExact;
    } else if (kind === "BOOLEAN") {
        if (control.type === "checkbox") {
            ruleKey = "CHECKBOX_BOOLEAN";
            renderedValue = normalizedValue.value ? "true" : "false";
        } else if (OPTION_CONTROLS.has(control.type)) {
            const targets = normalizedValue.value ? ["yes", "true", "1"] : ["no", "false", "0"];
            const option = exactOption(targets, control.options);
            if (!option) return { ok: false, reasonCodes: ["BOOLEAN_OPTION_NOT_UNAMBIGUOUS"] };
            ruleKey = "BOOLEAN_OPTION_EXACT";
            renderedValue = option.value || option.label;
        } else {
            return { ok: false, reasonCodes: ["BOOLEAN_CONTROL_REPRESENTATION_UNKNOWN"] };
        }
    } else if (kind === "ENUM") {
        if (!OPTION_CONTROLS.has(control.type)) return { ok: false, reasonCodes: ["ENUM_REQUIRES_OPTION_CONTROL"] };
        const option = exactOption([normalizedValue.value.key, normalizedValue.value.label], control.options);
        if (!option) return { ok: false, reasonCodes: ["EXACT_ENABLED_OPTION_NOT_FOUND"] };
        ruleKey = "ENUM_OPTION_EXACT";
        renderedValue = option.value || option.label;
    } else if (kind === "DATE") {
        if (control.type === "date" && normalizedValue.value.precision === "DAY") {
            ruleKey = "ISO_DATE_DAY";
            renderedValue = normalizedValue.value.isoDate;
        } else if (control.type === "month" && ["DAY", "MONTH"].includes(normalizedValue.value.precision)) {
            ruleKey = "ISO_DATE_MONTH";
            renderedValue = normalizedValue.value.isoDate.slice(0, 7);
        } else {
            return { ok: false, reasonCodes: ["DATE_CONTROL_PRECISION_UNSUPPORTED"] };
        }
    } else {
        return { ok: false, reasonCodes: [`REPRESENTATION_NOT_IMPLEMENTED_${kind}`] };
    }

    if (!renderedValue) return { ok: false, reasonCodes: ["EMPTY_RENDERED_VALUE"] };
    const constraintFailure = validateTextConstraints(renderedValue, control);
    if (constraintFailure) return { ok: false, reasonCodes: [constraintFailure] };
    return {
        ok: true,
        representation: {
            ruleKey,
            ruleVersion: 1,
            renderedValue,
            renderedValueHash: stableContractHash(renderedValue)
        },
        reasonCodes: [ruleKey]
    };
}

function reviewDecision(policy) {
    if (policy.autofillMode === "AUTO") return "NONE";
    if (policy.autofillMode === "PREPARE_FOR_REVIEW") return "RECOMMENDED";
    return "REQUIRED";
}

function sourceVersionId(value) {
    return contractIdSchema.safeParse(value).success ? value : null;
}

function reasonCodes(...groups) {
    return [...new Set(groups.flat().filter(Boolean).map((code) => String(code).slice(0, 120)))].slice(0, 12);
}

function unresolved(fieldId, canonicalKey, reasons, policy = null, scopeQualifiers = {}) {
    const scope = policy ? primarySharedScope(policy, scopeQualifiers) : null;
    return Object.freeze({
        fieldId,
        canonicalKey: canonicalKey || null,
        status: "NEEDS_USER",
        reasonCodes: reasonCodes(reasons),
        policy: policy && scope ? sharedAnswerPolicy(policy, scope) : null,
        contract: null
    });
}

/**
 * Produces candidate-private FieldAnswerContracts in one page-sized batch.
 * It is read-only and SHADOW-only: callers must not use these contracts to
 * replace the current production resolver until the Part 2B parity gates pass.
 */
export function buildFieldAnswerContracts({ userId, fields = [], context = {}, now = new Date() } = {}) {
    if (!userId) throw new Error("Candidate identity is required.");
    const requests = (Array.isArray(fields) ? fields : []).slice(0, 100).map((request, index) => {
        const parsed = fieldSemanticResultSchema.safeParse(request?.semantic);
        return {
            fieldId: String(request?.fieldId || `field-${index + 1}`).slice(0, 160),
            semantic: parsed.success ? parsed.data : null,
            control: request?.control || {},
            semanticError: parsed.success ? null : "INVALID_FIELD_SEMANTIC_RESULT"
        };
    });
    const keys = requests.filter((request) => request.semantic?.status === "RESOLVED")
        .map((request) => request.semantic.canonicalKey);
    const truthByCanonical = new Map(resolveCandidateTruthBatch({ userId, canonicalKeys: keys, context, now })
        .map((result) => [result.canonicalKey, result]));

    return requests.map((request) => {
        const { fieldId, semantic, control } = request;
        if (!semantic) return unresolved(fieldId, null, [request.semanticError]);
        if (semantic.status !== "RESOLVED" || !semantic.canonicalKey) {
            return unresolved(fieldId, null, [
                semantic.status === "PROTECTED" ? "FIELD_SEMANTIC_PROTECTED" : `FIELD_SEMANTIC_${semantic.status}`,
                ...semantic.reasonCodes
            ]);
        }
        const truth = truthByCanonical.get(semantic.canonicalKey);
        if (!truth || truth.status !== "RESOLVED" || !truth.answerVersion) {
            return unresolved(fieldId, semantic.canonicalKey,
                truth?.reasonCodes || ["CANDIDATE_TRUTH_MISSING"], truth?.policy || null,
                truth?.context?.context || {});
        }
        const { policy, answerVersion } = truth;
        if (answerVersion.policyVersion !== policy.policyVersion) {
            return unresolved(fieldId, semantic.canonicalKey, ["ANSWER_POLICY_VERSION_CHANGED"], policy,
                answerVersion.scopeQualifiers);
        }
        const computedValueHash = stableContractHash(answerVersion.normalizedValue);
        if (computedValueHash !== answerVersion.normalizedHash) {
            return unresolved(fieldId, semantic.canonicalKey, ["CANDIDATE_TRUTH_HASH_MISMATCH"], policy,
                answerVersion.scopeQualifiers);
        }
        if (!CONTRACT_SOURCE[answerVersion.source]) {
            return unresolved(fieldId, semantic.canonicalKey, ["ANSWER_SOURCE_UNSUPPORTED"], policy,
                answerVersion.scopeQualifiers);
        }
        const rendered = resolveBaselineRepresentation(answerVersion.normalizedValue, control);
        if (!rendered.ok) return unresolved(fieldId, semantic.canonicalKey, rendered.reasonCodes, policy,
            answerVersion.scopeQualifiers);

        const scope = primarySharedScope(policy, answerVersion.scopeQualifiers);
        const review = reviewDecision(policy);
        const payload = {
            canonicalKey: semantic.canonicalKey,
            descriptorFingerprint: semantic.descriptorFingerprint,
            mappingId: semantic.mappingId,
            mappingVersion: semantic.mappingVersion,
            policyVersion: policy.policyVersion,
            candidateAnswerVersionId: answerVersion.id,
            normalizedValueHash: computedValueHash,
            scope,
            representation: rendered.representation
        };
        const contract = fieldAnswerContractSchema.parse({
            schemaVersion: FIELD_ANSWER_CONTRACT_VERSION,
            contractId: `answer_contract:${stableContractHash(payload)}`,
            canonicalKey: semantic.canonicalKey,
            policyVersion: policy.policyVersion,
            candidateAnswerVersionId: answerVersion.id,
            normalizedValue: answerVersion.normalizedValue,
            normalizedValueHash: computedValueHash,
            scope,
            source: CONTRACT_SOURCE[answerVersion.source],
            sourceVersionId: sourceVersionId(answerVersion.sourceVersionId),
            representation: rendered.representation,
            confidence: Math.min(Number(semantic.confidence || 0), SOURCE_CONFIDENCE[answerVersion.source] ?? 0.8),
            review,
            expiresAtMs: answerVersion.validUntil && Number.isFinite(new Date(answerVersion.validUntil).getTime())
                ? new Date(answerVersion.validUntil).getTime() : null,
            protected: false
        });
        return Object.freeze({
            fieldId,
            canonicalKey: semantic.canonicalKey,
            status: review === "NONE" ? "READY" : "REVIEW_REQUIRED",
            reasonCodes: reasonCodes(truth.reasonCodes, rendered.reasonCodes,
                review === "NONE" ? "FIELD_ANSWER_CONTRACT_READY" : "FIELD_ANSWER_REVIEW_REQUIRED"),
            policy: sharedAnswerPolicy(policy, scope),
            contract
        });
    });
}

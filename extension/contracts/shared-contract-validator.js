// Generated from src/contracts/browserValidatorTemplate.js. Do not edit by hand.
(() => {
    const VERSION = 1;
    const MAX_PROTOCOL_BYTES = 64 * 1024;
    const MAX_TELEMETRY_BYTES = 16 * 1024;
    const SHA = /^[a-f0-9]{64}$/;
    const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;
    const EXACT_DECIMAL = /^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/;
    const FORBIDDEN_KEY = /(?:password|passcode|otp|captcha|aadhaar|passport|social.?security|national.?id|government.?id|raw.?value|protected.?value)/i;
    const VALUE_KINDS = new Set(["STRING", "BOOLEAN", "INTEGER", "DECIMAL", "DATE", "DATE_RANGE", "DURATION", "MONEY", "PHONE", "URL", "ADDRESS", "ENUM", "MULTI_ENUM", "ENTITY_REF", "FILE_REF", "RICH_TEXT", "DECLINE_TO_ANSWER", "UNKNOWN"]);

    const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
    const isString = (value, max = 160, min = 0) => typeof value === "string" && value.length >= min && value.length <= max;
    const isId = (value) => isString(value, 160, 1) && ID.test(value);
    const isHash = (value) => typeof value === "string" && SHA.test(value);
    const isInt = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
    const nullable = (value, validator) => value === null || validator(value);
    const oneOf = (value, values) => values.includes(value);
    const exactKeys = (value, keys) => isObject(value) && Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

    function normalize(value) {
        if (value === null || typeof value === "string" || typeof value === "boolean") return value;
        if (typeof value === "number") {
            if (!Number.isFinite(value)) throw new TypeError("NON_FINITE_NUMBER");
            return Object.is(value, -0) ? 0 : value;
        }
        if (Array.isArray(value)) return value.map(normalize);
        if (isObject(value)) {
            const result = {};
            for (const key of Object.keys(value).sort()) {
                if (value[key] === undefined) throw new TypeError("UNDEFINED_VALUE");
                result[key] = normalize(value[key]);
            }
            return result;
        }
        throw new TypeError("NON_JSON_VALUE");
    }

    const canonicalContractJson = (value) => JSON.stringify(normalize(value));
    const byteLength = (value) => new TextEncoder().encode(canonicalContractJson(value)).byteLength;
    async function stableContractHash(value) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalContractJson(value)));
        return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    }

    function hasForbiddenKey(value) {
        if (Array.isArray(value)) return value.some(hasForbiddenKey);
        if (!isObject(value)) return false;
        return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key) || hasForbiddenKey(child));
    }

    function validScope(value) {
        if (!exactKeys(value, ["schemaVersion", "scopeType", "scopeKey", "rank"]) || value.schemaVersion !== VERSION || !isInt(value.rank, 0, 100)) return false;
        const types = ["NONE", "APPLICATION_CONTENT_REVISION", "APPLICATION", "EMPLOYER_GROUP", "ROLE_FAMILY", "COUNTRY", "CANDIDATE"];
        if (!oneOf(value.scopeType, types) || !nullable(value.scopeKey, (item) => isString(item, 160, 1))) return false;
        const needsKey = ["APPLICATION_CONTENT_REVISION", "APPLICATION", "EMPLOYER_GROUP", "ROLE_FAMILY", "COUNTRY"].includes(value.scopeType);
        return needsKey ? Boolean(value.scopeKey) : value.scopeKey === null;
    }

    function validDateValue(value) {
        if (!exactKeys(value, ["isoDate", "precision"]) || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value.isoDate) || !oneOf(value.precision, ["DAY", "MONTH", "YEAR"])) return false;
        const [year, month, day] = value.isoDate.split("-").map(Number);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
    }

    function validEnumItem(value) {
        return exactKeys(value, ["key", "label"]) && isString(value.key, 160) && isString(value.label, 240);
    }

    function validNormalizedValue(value) {
        if (!isObject(value) || value.schemaVersion !== VERSION || value.dataClass !== "CANDIDATE_PRIVATE" || !VALUE_KINDS.has(value.kind)) return false;
        const base = ["schemaVersion", "dataClass", "kind"];
        switch (value.kind) {
            case "STRING": return exactKeys(value, [...base, "value"]) && isString(value.value, 4000);
            case "BOOLEAN": return exactKeys(value, [...base, "value"]) && typeof value.value === "boolean";
            case "INTEGER": return exactKeys(value, [...base, "value"]) && Number.isSafeInteger(value.value);
            case "DECIMAL": return exactKeys(value, [...base, "valueExact"]) && typeof value.valueExact === "string" && EXACT_DECIMAL.test(value.valueExact);
            case "DATE": return exactKeys(value, [...base, "value"]) && validDateValue(value.value);
            case "DATE_RANGE": return exactKeys(value, [...base, "start", "end", "current"]) && nullable(value.start, validDateValue) && nullable(value.end, validDateValue) && typeof value.current === "boolean" && Boolean(value.start || value.end) && !(value.current && value.end) && !(value.start && value.end && value.start.isoDate > value.end.isoDate);
            case "DURATION": return exactKeys(value, [...base, "months"]) && isInt(value.months, 0, 1200);
            case "MONEY": return exactKeys(value, [...base, "amountExact", "currency", "period"]) && typeof value.amountExact === "string" && EXACT_DECIMAL.test(value.amountExact) && /^[A-Z]{3}$/.test(value.currency) && oneOf(value.period, ["HOUR", "DAY", "WEEK", "MONTH", "YEAR", "ONE_TIME"]);
            case "PHONE": return exactKeys(value, [...base, "countryCode", "nationalNumber", "extension"]) && /^\+[1-9]\d{0,3}$/.test(value.countryCode) && /^\d{4,14}$/.test(value.nationalNumber) && nullable(value.extension, (item) => /^\d{1,8}$/.test(item));
            case "URL": { try { const url = new URL(value.value); return exactKeys(value, [...base, "value"]) && value.value.length <= 2048 && ["http:", "https:"].includes(url.protocol); } catch { return false; } }
            case "ADDRESS": return exactKeys(value, [...base, "line1", "line2", "city", "region", "postalCode", "countryCode"]) && isString(value.line1, 240) && isString(value.line2, 240) && isString(value.city, 120) && isString(value.region, 120) && isString(value.postalCode, 24) && /^[A-Z]{2}$/.test(value.countryCode);
            case "ENUM": return exactKeys(value, [...base, "value"]) && validEnumItem(value.value);
            case "MULTI_ENUM": return exactKeys(value, [...base, "values"]) && Array.isArray(value.values) && value.values.length <= 100 && value.values.every(validEnumItem) && new Set(value.values.map((item) => item.key)).size === value.values.length;
            case "ENTITY_REF": return exactKeys(value, [...base, "entityType", "entityId", "displayLabel"]) && isString(value.entityType, 80) && isId(value.entityId) && isString(value.displayLabel, 240);
            case "FILE_REF": return exactKeys(value, [...base, "fileId", "contentSha256", "fileName", "mimeType"]) && isId(value.fileId) && isHash(value.contentSha256) && isString(value.fileName, 240) && isString(value.mimeType, 120);
            case "RICH_TEXT": return exactKeys(value, [...base, "value"]) && isString(value.value, 12000);
            case "DECLINE_TO_ANSWER": return exactKeys(value, [...base, "reasonCode"]) && isString(value.reasonCode, 120);
            case "UNKNOWN": return exactKeys(value, [...base, "reasonCode", "evidenceHash"]) && isString(value.reasonCode, 160) && nullable(value.evidenceHash, isHash);
            default: return false;
        }
    }

    const identityKeys = ["schemaVersion", "runId", "tabId", "frameId", "documentId", "documentLifecycle", "pageGeneration", "formGeneration", "formGroupId", "logicalFieldFingerprint", "fieldInstanceGeneration"];
    function validIdentity(value) {
        return exactKeys(value, identityKeys) && value.schemaVersion === VERSION && isId(value.runId) && isInt(value.tabId) && isInt(value.frameId) && isString(value.documentId, 160) && oneOf(value.documentLifecycle, ["ACTIVE", "PRERENDER", "BF_CACHE", "DISCARDED", "UNKNOWN"]) && isInt(value.pageGeneration) && isInt(value.formGeneration) && isId(value.formGroupId) && isHash(value.logicalFieldFingerprint) && isInt(value.fieldInstanceGeneration);
    }

    const validators = {
        FieldSemanticResult(value) {
            const keys = ["schemaVersion", "descriptorFingerprint", "status", "canonicalKey", "mappingId", "mappingVersion", "resolver", "confidence", "candidates", "optionSetHash", "valueFree", "reasonCodes"];
            if (!exactKeys(value, keys) || !isHash(value.descriptorFingerprint) || !oneOf(value.status, ["RESOLVED", "AMBIGUOUS", "UNKNOWN", "PROTECTED"]) || !nullable(value.canonicalKey, (item) => isString(item, 140)) || !nullable(value.mappingId, (item) => isString(item, 160)) || !nullable(value.mappingVersion, (item) => isInt(item, 1)) || !oneOf(value.resolver, ["EXACT", "DETERMINISTIC", "SEMANTIC_SEARCH", "AI", "NONE"]) || typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1 || !Array.isArray(value.candidates) || value.candidates.length > 8 || !nullable(value.optionSetHash, isHash) || value.valueFree !== true || !Array.isArray(value.reasonCodes) || value.reasonCodes.length > 12) return false;
            if (!value.candidates.every((item) => exactKeys(item, ["canonicalKey", "confidence", "source"]) && isString(item.canonicalKey, 140) && typeof item.confidence === "number" && item.confidence >= 0 && item.confidence <= 1 && oneOf(item.source, ["EXACT", "DETERMINISTIC", "SEMANTIC_SEARCH", "AI_PROPOSAL"]))) return false;
            return !(value.status === "RESOLVED" && !value.canonicalKey) && !(["UNKNOWN", "PROTECTED"].includes(value.status) && value.canonicalKey) && !(value.status === "PROTECTED" && value.candidates.length);
        },
        ScopeRank: validScope,
        CanonicalAnswerPolicy(value) {
            const keys = ["schemaVersion", "policyVersion", "canonicalKey", "answerClass", "reuseDecision", "defaultScope", "freshnessDays", "autofill", "learningCommitPoint", "reasonCode"];
            if (!exactKeys(value, keys) || !isInt(value.policyVersion, 1) || !isString(value.canonicalKey, 140) || !oneOf(value.answerClass, ["STABLE_FACT", "MUTABLE_FACT", "PREFERENCE", "ENTITY_SCOPED_FACT", "WRITING", "DECLARATION", "PROTECTED"]) || !oneOf(value.reuseDecision, ["AUTO_VERSION", "REVIEW_TO_SAVE", "APPLICATION_ONLY", "APPLICATION_AUTHORIZATION", "NEVER_LEARN"]) || !validScope(value.defaultScope) || !nullable(value.freshnessDays, (item) => isInt(item, 1, 3650)) || !oneOf(value.autofill, ["ALLOWED", "REVIEW", "APPLICATION_GESTURE", "FORBIDDEN"]) || !nullable(value.learningCommitPoint, (item) => oneOf(item, ["VERIFIED_SUBMISSION", "EXPLICIT_SAVE"])) || !isString(value.reasonCode, 120)) return false;
            return !(value.answerClass === "PROTECTED" && (value.reuseDecision !== "NEVER_LEARN" || value.autofill !== "FORBIDDEN")) && !(value.reuseDecision === "APPLICATION_AUTHORIZATION" && value.defaultScope.scopeType !== "APPLICATION_CONTENT_REVISION");
        },
        NormalizedValue: validNormalizedValue,
        FieldAnswerContract(value) {
            const keys = ["schemaVersion", "contractId", "canonicalKey", "policyVersion", "candidateAnswerVersionId", "normalizedValue", "normalizedValueHash", "scope", "source", "sourceVersionId", "representation", "confidence", "review", "expiresAtMs", "protected"];
            const representation = value?.representation;
            return exactKeys(value, keys) && isId(value.contractId) && isString(value.canonicalKey, 140) && isInt(value.policyVersion, 1) && nullable(value.candidateAnswerVersionId, isId) && validNormalizedValue(value.normalizedValue) && nullable(value.normalizedValueHash, isHash) && validScope(value.scope) && oneOf(value.source, ["PROFILE", "VERIFIED_RESUME", "DERIVED", "USER_ENTERED", "APPROVED_MEMORY", "JOB_CONTEXT", "AI_WRITING"]) && nullable(value.sourceVersionId, isId) && exactKeys(representation, ["ruleKey", "ruleVersion", "renderedValue", "renderedValueHash"]) && isString(representation.ruleKey, 120) && isInt(representation.ruleVersion, 1) && isString(representation.renderedValue, 4000) && nullable(representation.renderedValueHash, isHash) && typeof value.confidence === "number" && value.confidence >= 0 && value.confidence <= 1 && oneOf(value.review, ["NONE", "RECOMMENDED", "REQUIRED"]) && nullable(value.expiresAtMs, isInt) && value.protected === false && !(value.normalizedValue.kind === "UNKNOWN" && value.review !== "REQUIRED");
        },
        LogicalFieldIdentity: validIdentity,
        FieldRevision(value) {
            const keys = ["schemaVersion", "revisionId", "identity", "operationId", "editSessionId", "sequence", "actor", "eventType", "beforeValueHash", "intendedValueHash", "afterValueHash", "canonicalKey", "answerVersionId", "representationVersionId", "strategyVersionId", "clientTimeMs", "valueFree"];
            return exactKeys(value, keys) && isId(value.revisionId) && validIdentity(value.identity) && nullable(value.operationId, isId) && nullable(value.editSessionId, isId) && isInt(value.sequence) && oneOf(value.actor, ["COPILOT", "CANDIDATE", "ATS_SCRIPT", "PASSWORD_MANAGER", "UNKNOWN"]) && oneOf(value.eventType, ["OBSERVED", "FILL_INTENDED", "READBACK", "EDIT_STARTED", "EDIT_UPDATED", "EDIT_COMMITTED", "VALUE_REVERTED", "VALIDATION", "INTERRUPTED"]) && [value.beforeValueHash, value.intendedValueHash, value.afterValueHash].every((item) => nullable(item, isHash)) && nullable(value.canonicalKey, (item) => isString(item, 140)) && [value.answerVersionId, value.representationVersionId, value.strategyVersionId].every((item) => nullable(item, isId)) && isInt(value.clientTimeMs) && value.valueFree === true;
        },
        EditSession(value) {
            const keys = ["schemaVersion", "editSessionId", "identity", "startedAtMs", "lastActivityAtMs", "endedAtMs", "status", "firstRevisionSequence", "lastRevisionSequence", "initialValueHash", "finalValueHash", "interruptionReason"];
            return exactKeys(value, keys) && isId(value.editSessionId) && validIdentity(value.identity) && isInt(value.startedAtMs) && isInt(value.lastActivityAtMs) && nullable(value.endedAtMs, isInt) && oneOf(value.status, ["OPEN", "COMMITTED", "RESTORED", "INTERRUPTED", "ABANDONED"]) && isInt(value.firstRevisionSequence) && isInt(value.lastRevisionSequence) && nullable(value.initialValueHash, isHash) && nullable(value.finalValueHash, isHash) && nullable(value.interruptionReason, (item) => isString(item, 120)) && value.lastActivityAtMs >= value.startedAtMs && (value.endedAtMs === null || value.endedAtMs >= value.startedAtMs) && value.lastRevisionSequence >= value.firstRevisionSequence;
        },
        CheckpointReceipt(value) {
            const keys = ["schemaVersion", "checkpointId", "runId", "applicationId", "applicationContentRevisionId", "type", "status", "source", "observedAtMs", "evidenceHash", "valueFree"];
            return exactKeys(value, keys) && isId(value.checkpointId) && isId(value.runId) && isId(value.applicationId) && nullable(value.applicationContentRevisionId, isId) && oneOf(value.type, ["LOCAL_VALIDITY", "PAGE_ADVANCE", "REVIEW", "SUBMISSION", "EXPLICIT_SAVE"]) && oneOf(value.status, ["VERIFIED", "REJECTED", "ABANDONED", "UNKNOWN"]) && oneOf(value.source, ["DOM_VALIDATION", "NAVIGATION", "EMPLOYER_RECEIPT", "CANDIDATE_GESTURE", "RECOVERY"]) && isInt(value.observedAtMs) && isHash(value.evidenceHash) && value.valueFree === true;
        },
        ApplicationContentRevision(value) {
            const keys = ["schemaVersion", "revisionId", "applicationId", "runId", "pageGeneration", "formGeneration", "formGroupId", "fieldSetFingerprint", "contentFingerprint", "employerRevisionTokenHash", "observedAtMs", "valueFree"];
            return exactKeys(value, keys) && isId(value.revisionId) && isId(value.applicationId) && isId(value.runId) && isInt(value.pageGeneration) && isInt(value.formGeneration) && isId(value.formGroupId) && isHash(value.fieldSetFingerprint) && isHash(value.contentFingerprint) && nullable(value.employerRevisionTokenHash, isHash) && isInt(value.observedAtMs) && value.valueFree === true;
        },
        ApplicationAuthorizationReceipt(value) {
            const keys = ["schemaVersion", "authorizationId", "applicationId", "runId", "applicationContentRevisionId", "kind", "items", "userGestureAtMs", "expiresAtMs", "reusableCandidateMemory", "valueFree"];
            if (!exactKeys(value, keys) || !isId(value.authorizationId) || !isId(value.applicationId) || !isId(value.runId) || !isId(value.applicationContentRevisionId) || !oneOf(value.kind, ["ORDINARY_DECLARATION_GROUP", "HIGH_IMPACT_ITEM", "EXPLICIT_ANSWER_SAVE"]) || !Array.isArray(value.items) || !value.items.length || value.items.length > 50 || !isInt(value.userGestureAtMs) || !nullable(value.expiresAtMs, isInt) || value.reusableCandidateMemory !== false || value.valueFree !== true) return false;
            const itemsValid = value.items.every((item) => exactKeys(item, ["logicalFieldFingerprint", "canonicalKey", "labelDigest", "impact", "decision"]) && isHash(item.logicalFieldFingerprint) && nullable(item.canonicalKey, (entry) => isString(entry, 140)) && isHash(item.labelDigest) && oneOf(item.impact, ["ORDINARY", "HIGH_IMPACT"]) && oneOf(item.decision, ["AUTHORIZED", "DECLINED"]));
            return itemsValid && !(value.kind === "HIGH_IMPACT_ITEM" && value.items.length !== 1) && !(value.kind === "ORDINARY_DECLARATION_GROUP" && value.items.some((item) => item.impact !== "ORDINARY"));
        },
        ExtensionProtocolEnvelope(value) {
            const keys = ["schemaVersion", "protocolVersion", "messageId", "messageType", "source", "destination", "sentAtMs", "correlationId", "nonce", "dataClass", "containsProtectedValue", "payloadContract", "payloadHash", "payload"];
            return exactKeys(value, keys) && value.protocolVersion === 1 && isId(value.messageId) && isString(value.messageType, 100) && oneOf(value.source, ["WEBSITE", "EXTENSION", "BACKEND"]) && oneOf(value.destination, ["WEBSITE", "EXTENSION", "BACKEND"]) && isInt(value.sentAtMs) && nullable(value.correlationId, isId) && isString(value.nonce, 160, 16) && oneOf(value.dataClass, ["STRUCTURAL", "VALUE_FREE_TELEMETRY", "CANDIDATE_PRIVATE"]) && value.containsProtectedValue === false && isString(value.payloadContract, 100) && isHash(value.payloadHash) && !hasForbiddenKey(value.payload) && byteLength(value) <= MAX_PROTOCOL_BYTES;
        },
        TelemetryEnvelope(value) {
            const keys = ["schemaVersion", "telemetryId", "runId", "sequence", "occurredAtMs", "dimensions", "measures", "logicalFieldFingerprint", "operationHash", "valueFree", "containsProtectedValue"];
            const dimensions = value?.dimensions;
            const measures = value?.measures;
            return exactKeys(value, keys) && isId(value.telemetryId) && isId(value.runId) && isInt(value.sequence) && isInt(value.occurredAtMs) && exactKeys(dimensions, ["ats", "portalKind", "eventType", "outcome", "strategyId", "adapterVersion", "reasonCode", "checkpointType", "fieldType"]) && nullable(dimensions.ats, (item) => isString(item, 80)) && nullable(dimensions.portalKind, (item) => isString(item, 80)) && isString(dimensions.eventType, 100) && nullable(dimensions.outcome, (item) => isString(item, 100)) && nullable(dimensions.strategyId, (item) => isString(item, 160)) && nullable(dimensions.adapterVersion, (item) => isString(item, 80)) && nullable(dimensions.reasonCode, (item) => isString(item, 120)) && nullable(dimensions.checkpointType, (item) => isString(item, 80)) && nullable(dimensions.fieldType, (item) => isString(item, 80)) && exactKeys(measures, ["durationMs", "count"]) && nullable(measures.durationMs, isInt) && nullable(measures.count, (item) => isInt(item, 0, 1000000)) && nullable(value.logicalFieldFingerprint, isHash) && nullable(value.operationHash, isHash) && value.valueFree === true && value.containsProtectedValue === false && byteLength(value) <= MAX_TELEMETRY_BYTES;
        },
        EvidenceUpdate(value) {
            const keys = ["schemaVersion", "evidenceId", "observationId", "classificationHash", "runId", "applicationId", "layer", "subjectType", "subjectKey", "subjectKeyHash", "aggregationScope", "scopeType", "scopeKeyHash", "direction", "source", "executionContext", "checkpointType", "context", "formFingerprint", "extensionVersion", "adapterVersion", "occurredAtMs", "reasonCodes", "valueFree", "containsProtectedValue"];
            const weights = value?.context;
            if (!exactKeys(value, keys) || !isId(value.evidenceId) || !isId(value.observationId) || !isHash(value.classificationHash) || !isId(value.runId) || !isId(value.applicationId)
                || !oneOf(value.layer, ["SEMANTIC_MAPPING", "CANDIDATE_ANSWER", "REPRESENTATION", "INTERACTION_STRATEGY", "ACCEPTANCE", "FORM_SCHEMA", "ENTITY_BINDING"])
                || !oneOf(value.subjectType, ["CANONICAL_MAPPING", "CANONICAL_ANSWER", "REPRESENTATION_RULE", "INTERACTION_STRATEGY", "FIELD_ACCEPTANCE", "FORM_SCHEMA", "ENTITY_BINDING"])
                || !isString(value.subjectKey, 180, 1) || !ID.test(value.subjectKey) || !isHash(value.subjectKeyHash)
                || !oneOf(value.aggregationScope, ["CANDIDATE_PRIVATE", "SHARED_REDACTED"])
                || !oneOf(value.scopeType, ["GLOBAL", "CANDIDATE", "APPLICATION", "FORM_FAMILY", "FIELD_FINGERPRINT"])
                || !nullable(value.scopeKeyHash, isHash) || !oneOf(value.direction, ["POSITIVE", "NEGATIVE", "UNKNOWN"])
                || !oneOf(value.source, ["EXPLICIT_SEMANTIC", "CHECKPOINT_CLASSIFIER", "STABLE_READBACK", "EMPLOYER_VALIDATION", "HUMAN_OBSERVATION", "SCHEMA_OBSERVATION"])
                || !oneOf(value.executionContext, ["DIRECT", "RESCUE", "PROVISIONAL_DIRECT", "NOT_APPLICABLE"])
                || !oneOf(value.checkpointType, ["NONE", "LOCAL_VALIDITY", "PAGE_ADVANCE", "REVIEW", "SUBMISSION", "EXPLICIT_SAVE"])
                || !exactKeys(weights, ["baseWeight", "sourceReliabilityBps", "checkpointStrengthBps", "attributionConfidenceBps", "sampleQualityBps", "recencyBps", "scopeSimilarityBps", "completionStrengthBps", "riskMultiplierBps", "extensionTrustBps"])
                || !isInt(weights.baseWeight, 0, 10000) || ![weights.sourceReliabilityBps, weights.checkpointStrengthBps, weights.attributionConfidenceBps, weights.sampleQualityBps, weights.recencyBps, weights.scopeSimilarityBps, weights.completionStrengthBps, weights.extensionTrustBps].every((item) => isInt(item, 0, 10000))
                || !isInt(weights.riskMultiplierBps, 0, 20000) || !nullable(value.formFingerprint, isHash)
                || !nullable(value.extensionVersion, (item) => isString(item, 80)) || !nullable(value.adapterVersion, (item) => isString(item, 80))
                || !isInt(value.occurredAtMs) || !Array.isArray(value.reasonCodes) || value.reasonCodes.length > 12 || !value.reasonCodes.every((item) => isString(item, 120, 1))
                || value.valueFree !== true || value.containsProtectedValue !== false) return false;
            if (value.scopeType === "GLOBAL" ? value.scopeKeyHash !== null : value.scopeKeyHash === null) return false;
            if (value.direction === "UNKNOWN" && weights.baseWeight !== 0) return false;
            return value.layer === "INTERACTION_STRATEGY" ? value.executionContext !== "NOT_APPLICABLE" : value.executionContext === "NOT_APPLICABLE";
        }
    };

    function validate(contractName, input) {
        if (!validators[contractName]) return { success: false, contractName, reasonCode: "UNKNOWN_CONTRACT" };
        if (!isObject(input) || input.schemaVersion !== VERSION) return { success: false, contractName, reasonCode: "UNSUPPORTED_SCHEMA_VERSION", supportedVersions: [VERSION] };
        try {
            return validators[contractName](input)
                ? { success: true, contractName, data: input }
                : { success: false, contractName, reasonCode: hasForbiddenKey(input) ? "PROTECTED_VALUE_FORBIDDEN" : "INVALID_CONTRACT" };
        } catch {
            return { success: false, contractName, reasonCode: "INVALID_CONTRACT" };
        }
    }

    globalThis.JobHunterSharedContracts = Object.freeze({ VERSION, validate, canonicalContractJson, stableContractHash });
})();

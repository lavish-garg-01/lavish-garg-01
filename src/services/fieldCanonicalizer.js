import { env } from "../config/environment.js";
import { getDb } from "../database/connection.js";
import { buildFieldSemanticDescriptor, normalizeSemanticText } from "../contracts/fieldSemanticDescriptor.js";
import {
    ensureCanonicalDefinitions,
    findSemanticMapping,
    getCanonicalDefinition,
    proposeCanonical,
    saveSemanticMapping
} from "../repositories/fieldSemanticRepository.js";
import { EMPLOYER_FIELD_ONTOLOGY, inferFieldSemantic, semanticDefinition } from "./fieldOntology.js";
import { nearestCanonicals } from "./canonicalSemanticSearch.js";
import { aiCanonicalizationFallback, FIELD_CANONICALIZATION_PROMPT_VERSION } from "./fieldCanonicalizationAi.js";
import { getFeatureFlag } from "../repositories/featureFlagRepository.js";
import { stableContractHash } from "../contracts/contractPrimitives.js";
import { FIELD_SEMANTIC_RESULT_VERSION, fieldSemanticResultSchema } from "../contracts/fieldSemanticResult.js";

let seededDatabase = null;

function ensureOntology() {
    const dbName = getDb().name;
    if (seededDatabase === dbName) return;
    ensureCanonicalDefinitions(EMPLOYER_FIELD_ONTOLOGY);
    seededDatabase = dbName;
}

function tokens(value = "") {
    return new Set(normalizeSemanticText(value)
        .replace(/\bemployer\b|\borganization\b/g, "company")
        .replace(/\bengaged\b|\bworking\b|\bwork\b/g, "employed")
        .replace(/\bcompensation\b|\bctc\b/g, "salary")
        .replace(/\bmobile\b|\btelephone\b/g, "phone")
        .split(/\s+/).filter((token) => token.length > 1));
}

function overlap(left, right) {
    const a = tokens(left);
    const b = tokens(right);
    if (!a.size || !b.size) return 0;
    let matched = 0;
    for (const token of a) if (b.has(token)) matched += 1;
    return matched / Math.min(a.size, b.size);
}

function groupHint(key = "", section = "") {
    const normalized = normalizeSemanticText(section);
    if (!normalized) return 0;
    if (/company|industry|title|experience|employee|employ/.test(key.toLowerCase()) && /employ|experience|career|professional/.test(normalized)) return 0.12;
    if (/education|degree|school|institution/.test(key.toLowerCase()) && /education|academic|school/.test(normalized)) return 0.12;
    if (/address|location|country|postal/.test(key.toLowerCase()) && /address|location|personal|contact/.test(normalized)) return 0.1;
    if (/salary|ctc|notice|start_date/.test(key.toLowerCase()) && /salary|compensation|availability|employment/.test(normalized)) return 0.1;
    return 0;
}

function deterministicRank(field, descriptor) {
    const inference = inferFieldSemantic({
        ...field,
        label: descriptor.source.label,
        type: descriptor.source.controlType,
        sectionKind: field.sectionKind || descriptor.context.sectionFamily
    });
    if (inference.obvious && inference.key !== "CUSTOM_FIELD") {
        return [{ key: inference.key, confidence: inference.confidence,
            reasonCodes: ["ONTOLOGY_PATTERN"], definition: semanticDefinition(inference.key) }];
    }
    const labelSignals = [
        descriptor.source.normalizedLabel,
        descriptor.source.attributes.name,
        descriptor.source.attributes.ariaLabel,
        descriptor.source.attributes.placeholder,
        descriptor.source.attributes.autocomplete
    ].filter(Boolean).join(" ");
    const neighborSignals = `${descriptor.context.previous.label} ${descriptor.context.next.label}`;
    return EMPLOYER_FIELD_ONTOLOGY.map((definition) => {
        const definitionText = `${definition.label} ${definition.description}`;
        const labelScore = overlap(labelSignals, definitionText) * 0.72;
        const neighborScore = overlap(neighborSignals, definitionText) * 0.08;
        const sectionScore = groupHint(definition.key, `${descriptor.context.section} ${descriptor.context.sectionFamily}`);
        const optionScore = definition.options?.length && descriptor.source.optionSamples.length ? 0.04 : 0;
        const typeScore = descriptor.source.controlType ? 0.04 : 0;
        return {
            key: definition.key,
            confidence: Number(Math.min(0.96, labelScore + neighborScore + sectionScore + optionScore + typeScore).toFixed(4)),
            reasonCodes: [
                labelScore > 0.4 ? "LABEL_SEMANTIC_OVERLAP" : null,
                sectionScore ? "SECTION_MATCH" : null,
                neighborScore > 0.02 ? "NEIGHBOR_MATCH" : null,
                optionScore ? "OPTION_SHAPE_MATCH" : null
            ].filter(Boolean),
            definition
        };
    }).filter((candidate) => candidate.confidence > 0)
        .sort((left, right) => right.confidence - left.confidence).slice(0, 8);
}

function alternativesFrom(candidates = [], exclude = null) {
    return candidates.filter((candidate) => candidate.key !== exclude).slice(0, 5).map((candidate) => ({
        ...semanticDefinition(candidate.key),
        confidence: Number(candidate.confidence ?? candidate.similarity ?? 0)
    }));
}

function result({ descriptor, canonicalKey = null, confidence = 0, source = "UNRESOLVED", decision = "UNRESOLVED",
    mapping = null, candidates = [], reasonCodes = [], proposed = false } = {}) {
    const canonical = canonicalKey ? getCanonicalDefinition(canonicalKey) : null;
    const definition = canonicalKey ? semanticDefinition(canonicalKey) : semanticDefinition("CUSTOM_FIELD");
    const alternatives = alternativesFrom(candidates, canonicalKey);
    return {
        descriptor,
        canonicalKey,
        canonical,
        confidence: Number(confidence || 0),
        source,
        decision,
        mapping,
        candidates,
        reasonCodes,
        proposed,
        inference: {
            ...definition,
            key: canonicalKey || "CUSTOM_FIELD",
            confidence: Number(confidence || 0),
            obvious: decision === "RESOLVED" && (
                ["EXACT_MAPPING", "PORTAL_MAPPING", "USER_LOCAL_MAPPING"].includes(source)
                || reasonCodes.includes("ONTOLOGY_PATTERN")
            ),
            alternatives
        }
    };
}

function mappedResult(descriptor, mapping) {
    const safe = mapping.status === "VALIDATED" || mapping.status === "TRUSTED";
    return result({ descriptor, canonicalKey: mapping.canonicalFieldKey, confidence: mapping.confidence,
        source: mapping.lookupSource || "EXACT_MAPPING", decision: safe ? "RESOLVED" : "NEEDS_CONFIRMATION",
        mapping, reasonCodes: [mapping.lookupSource || "LEARNED_MAPPING"] });
}

function sharedSource(source = "") {
    if (["EXACT_MAPPING", "HOST_NORMALIZED_MAPPING", "ATS_NORMALIZED_MAPPING", "GLOBAL_NORMALIZED_MAPPING", "USER_LOCAL_MAPPING", "PORTAL_MAPPING"].includes(source)) return "EXACT";
    if (["DETERMINISTIC", "DETERMINISTIC_UNCERTAIN"].includes(source)) return "DETERMINISTIC";
    if (source === "SEMANTIC") return "SEMANTIC_SEARCH";
    return "AI_PROPOSAL";
}

/** Stable value-free contract returned across the backend/extension boundary. */
export function toSharedFieldSemanticResult(canonicalization) {
    const descriptor = canonicalization.descriptor;
    const status = canonicalization.decision === "RESOLVED" ? "RESOLVED"
        : ["NEEDS_CONFIRMATION", "NEW_CONCEPT_PROPOSED"].includes(canonicalization.decision) ? "AMBIGUOUS"
            : (descriptor.flags.sensitive || descriptor.flags.legal) && !canonicalization.canonicalKey ? "PROTECTED" : "UNKNOWN";
    const resolver = sharedSource(canonicalization.source) === "EXACT" ? "EXACT"
        : sharedSource(canonicalization.source) === "DETERMINISTIC" ? "DETERMINISTIC"
            : sharedSource(canonicalization.source) === "SEMANTIC_SEARCH" ? "SEMANTIC_SEARCH"
                : String(canonicalization.source || "").startsWith("AI") ? "AI" : "NONE";
    const candidates = status === "PROTECTED" ? [] : (canonicalization.candidates || []).slice(0, 8).map((candidate) => ({
        canonicalKey: candidate.key,
        confidence: Math.max(0, Math.min(1, Number(candidate.confidence ?? candidate.similarity ?? 0))),
        source: sharedSource(canonicalization.source)
    }));
    return fieldSemanticResultSchema.parse({
        schemaVersion: FIELD_SEMANTIC_RESULT_VERSION,
        descriptorFingerprint: descriptor.fingerprints.exact,
        status,
        canonicalKey: ["UNKNOWN", "PROTECTED"].includes(status) ? null : canonicalization.canonicalKey,
        mappingId: canonicalization.mapping?.id || null,
        mappingVersion: null,
        resolver,
        confidence: Math.max(0, Math.min(1, Number(canonicalization.confidence || 0))),
        candidates,
        optionSetHash: descriptor.source.optionSamples.length
            ? stableContractHash(descriptor.source.optionSamples) : null,
        valueFree: true,
        reasonCodes: [...new Set(canonicalization.reasonCodes || [])].slice(0, 12)
    });
}

function portalMappingResult(descriptor, canonicalKey) {
    const canonical = getCanonicalDefinition(canonicalKey);
    if (!canonical || descriptor.flags.generic) return null;
    return result({ descriptor, canonicalKey, confidence: 0.92, source: "PORTAL_MAPPING", decision: "RESOLVED",
        reasonCodes: ["EXISTING_PORTAL_MAPPING"] });
}

export function canonicalizeFieldSync(field = {}, context = {}) {
    ensureOntology();
    const descriptor = buildFieldSemanticDescriptor(field, context);
    if (descriptor.flags.generic) return result({ descriptor, reasonCodes: ["GENERIC_FIELD_IDENTITY"] });
    if (descriptor.flags.skipLearning) return result({ descriptor, source: "PROTECTED_FIELD",
        reasonCodes: [descriptor.flags.legal ? "LEGAL_FIELD_NOT_LEARNED" : "SENSITIVE_FIELD_NOT_LEARNED"] });
    const learned = findSemanticMapping(descriptor);
    if (learned) {
        if (context.knownSemanticKey
            && String(context.knownSemanticKey).toUpperCase() === learned.canonicalFieldKey) {
            return result({ descriptor, canonicalKey: learned.canonicalFieldKey,
                confidence: Math.max(0.9, learned.confidence), source: "USER_LOCAL_MAPPING",
                decision: "RESOLVED", mapping: learned, reasonCodes: ["USER_LOCAL_MAPPING"] });
        }
        return mappedResult(descriptor, learned);
    }
    const ranked = deterministicRank(field, descriptor);
    const top = ranked[0];
    const runnerUp = ranked[1];
    if (top && top.confidence >= env.canonicalization.deterministicAcceptConfidence
        && top.confidence - Number(runnerUp?.confidence || 0) >= 0.08) {
        const mapping = descriptor.flags.sensitive || descriptor.flags.legal ? null : saveSemanticMapping({ descriptor,
            canonicalFieldKey: top.key, source: "RULE", confidence: top.confidence, status: "VALIDATED" });
        return result({ descriptor, canonicalKey: top.key, confidence: top.confidence, source: "DETERMINISTIC",
            decision: "RESOLVED", mapping, candidates: ranked, reasonCodes: top.reasonCodes });
    }
    const portal = context.knownSemanticKey ? portalMappingResult(descriptor, String(context.knownSemanticKey).toUpperCase()) : null;
    if (portal) return { ...portal, candidates: ranked, inference: { ...portal.inference, alternatives: alternativesFrom(ranked, portal.canonicalKey) } };
    return result({ descriptor, confidence: top?.confidence || 0, source: "DETERMINISTIC_UNCERTAIN",
        decision: "UNRESOLVED", candidates: ranked, reasonCodes: top?.reasonCodes || ["NO_DETERMINISTIC_MATCH"] });
}

export async function canonicalizeField(field = {}, context = {}, dependencies = {}) {
    const cheap = canonicalizeFieldSync(field, context);
    if (cheap.decision === "RESOLVED" || cheap.decision === "NEEDS_CONFIRMATION" || cheap.descriptor.flags.generic) return cheap;
    const descriptor = cheap.descriptor;
    if (descriptor.flags.skipLearning) return cheap;
    const semanticSearch = dependencies.semanticSearch || nearestCanonicals;
    const aiFallback = dependencies.aiFallback || aiCanonicalizationFallback;
    const semantic = await semanticSearch(descriptor);
    const semanticTop = semantic[0];
    const semanticRunnerUp = semantic[1];
    if (semanticTop && semanticTop.similarity >= env.canonicalization.semanticAcceptConfidence
        && semanticTop.similarity - Number(semanticRunnerUp?.similarity || 0) >= 0.05) {
        const mapping = saveSemanticMapping({ descriptor, canonicalFieldKey: semanticTop.key,
            source: "SEMANTIC", confidence: semanticTop.similarity, status: "CANDIDATE" });
        return result({ descriptor, canonicalKey: semanticTop.key, confidence: semanticTop.similarity,
            source: "SEMANTIC", decision: "NEEDS_CONFIRMATION", mapping, candidates: semantic,
            reasonCodes: ["SEMANTIC_SIMILARITY", "CANDIDATE_MAPPING_REQUIRES_EVIDENCE"] });
    }
    const candidateMap = new Map();
    for (const candidate of [...semantic, ...cheap.candidates]) {
        if (!candidateMap.has(candidate.key)) candidateMap.set(candidate.key, {
            key: candidate.key,
            label: candidate.label || candidate.definition?.label || semanticDefinition(candidate.key).label,
            description: candidate.description || candidate.definition?.description || semanticDefinition(candidate.key).description,
            similarity: Number(candidate.similarity ?? candidate.confidence ?? 0)
        });
    }
    const candidates = [...candidateMap.values()].sort((left, right) => right.similarity - left.similarity).slice(0, 8);
    const ai = await aiFallback(descriptor, candidates);
    const aiResult = ai.result;
    if (!aiResult) return result({ descriptor, confidence: semanticTop?.similarity || cheap.confidence,
        source: ai.attempted ? "AI_FAILED" : "AI_SKIPPED", decision: "UNRESOLVED", candidates,
        reasonCodes: [ai.reason || "NO_SAFE_CANONICAL"] });
    if (aiResult.decision === "EXISTING_CANONICAL" && aiResult.confidence >= env.canonicalization.aiAcceptConfidence) {
        const mapping = saveSemanticMapping({ descriptor, canonicalFieldKey: aiResult.canonical,
            source: "AI", confidence: aiResult.confidence, status: "CANDIDATE",
            aiModel: env.openaiModel, promptVersion: FIELD_CANONICALIZATION_PROMPT_VERSION });
        return result({ descriptor, canonicalKey: aiResult.canonical, confidence: aiResult.confidence,
            source: "AI", decision: "NEEDS_CONFIRMATION", mapping, candidates,
            reasonCodes: [...aiResult.reasonCodes, "AI_MAPPING_REQUIRES_EVIDENCE"] });
    }
    if (aiResult.decision === "NEW_CANONICAL_REQUIRED" && aiResult.confidence >= env.canonicalization.aiAcceptConfidence) {
        if (!getFeatureFlag("canonical.new-proposals", env.canonicalization.newProposalsEnabled).enabled) {
            return result({ descriptor, confidence: aiResult.confidence, source: "AI_NEW_CONCEPT_DISABLED",
                decision: "UNRESOLVED", candidates, reasonCodes: ["NEW_CANONICAL_PROPOSALS_DISABLED"] });
        }
        const proposal = proposeCanonical({
            canonicalName: aiResult.proposed.canonicalName,
            label: aiResult.proposed.label,
            description: aiResult.proposed.description,
            semanticGroup: aiResult.proposed.semanticGroup,
            dataType: aiResult.proposed.dataType,
            answerType: aiResult.proposed.answerType,
            sensitivity: aiResult.proposed.sensitivity,
            question: aiResult.proposed.displayQuestion,
            options: descriptor.source.optionSamples,
            askPolicy: "CURRENT_APPLICATION_ONLY"
        });
        if (!proposal?.canonical) return result({ descriptor, source: "AI_NEW_CONCEPT_REJECTED", candidates,
            reasonCodes: ["INVALID_CANONICAL_PROPOSAL"] });
        if (!proposal.created) {
            const mapping = saveSemanticMapping({ descriptor, canonicalFieldKey: proposal.canonical.key,
                source: "AI_DUPLICATE_RESOLVED", confidence: aiResult.confidence, status: "CANDIDATE",
                aiModel: env.openaiModel, promptVersion: FIELD_CANONICALIZATION_PROMPT_VERSION });
            return result({ descriptor, canonicalKey: proposal.canonical.key, confidence: aiResult.confidence,
                source: "AI_DUPLICATE_RESOLVED", decision: "NEEDS_CONFIRMATION", mapping, candidates,
                reasonCodes: [...aiResult.reasonCodes, "NEW_CONCEPT_MATCHED_EXISTING_CANONICAL"] });
        }
        const mapping = saveSemanticMapping({ descriptor, canonicalFieldKey: proposal.canonical.key,
            source: "AI_NEW_CONCEPT", confidence: aiResult.confidence, status: "CANDIDATE",
            aiModel: env.openaiModel, promptVersion: FIELD_CANONICALIZATION_PROMPT_VERSION });
        return result({ descriptor, canonicalKey: proposal.canonical.key, confidence: aiResult.confidence,
            source: "AI_NEW_CONCEPT", decision: "NEW_CONCEPT_PROPOSED", mapping, candidates,
            reasonCodes: aiResult.reasonCodes, proposed: proposal.created });
    }
    return result({ descriptor, confidence: aiResult.confidence, source: "AI_UNRESOLVED",
        decision: "UNRESOLVED", candidates, reasonCodes: aiResult.reasonCodes });
}

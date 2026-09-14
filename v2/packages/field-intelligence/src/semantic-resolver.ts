import {
  AiCanonicalizationOutputSchema,
  CompactCanonicalizationPayloadSchema,
  FieldSemanticResolutionSchema,
  RichCanonicalizationPayloadSchema,
  type AiCanonicalizationOutput,
  type CanonicalCandidate,
  type CompactCanonicalizationPayload,
  type DeclarationSemanticHint,
  type FieldIntelligencePageContext,
  type FieldSemanticResolution,
  type RichCanonicalizationPayload
} from "@job-hunter-v2/contracts";
import { candidateAnswerPolicy } from "@job-hunter-v2/candidate-truth";
import { normalizeFieldEvidence, normalizeSemanticText, type NormalizedFieldEvidence } from "./evidence.js";
import { aliasRules, canonicalDefinitionFor, fieldTypeCompatibility, policyAllowsSemanticResolution } from "./ontology.js";
import type { FieldEvidenceInput } from "@job-hunter-v2/contracts";

export const FIELD_CONFIDENCE_POLICY_VERSION = "J1-2026-09";
export const FIELD_CONFIDENCE_THRESHOLDS = Object.freeze({
  high: 0.88,
  highMargin: 0.1,
  medium: 0.72,
  mediumMargin: 0.07,
  candidateMinimum: 0.24,
  ambiguityMinimum: 0.5
});

export interface FieldCanonicalizationAiPort {
  canonicalize(payload: CompactCanonicalizationPayload | RichCanonicalizationPayload, context?: FieldAiContext): Promise<unknown>;
}

export interface FieldAiContext { accountId: string; candidateId: string; applicationId: string | null; requestId: string }

export class FieldCanonicalizationAiUnavailableError extends Error {
  constructor(readonly reasonCode = "AI_ROUTE_UNAVAILABLE") { super(reasonCode); }
}

interface ScoredCandidate extends CanonicalCandidate {
  evidence: { alias: number; fieldType: number; section: number; neighbor: number; attribute: number };
}

function publicCandidate(candidate: ScoredCandidate): CanonicalCandidate {
  return {
    canonicalKey: candidate.canonicalKey,
    description: candidate.description,
    confidence: candidate.confidence,
    source: candidate.source,
    reasonCodes: candidate.reasonCodes
  };
}

interface CachedSemanticCore {
  state: FieldSemanticResolution["state"];
  canonicalKey: string | null;
  confidence: number;
  resolver: FieldSemanticResolution["resolver"];
  candidates: readonly CanonicalCandidate[];
  reasonCodes: readonly string[];
  errorCodes: FieldSemanticResolution["errorCodes"];
  evidence: FieldSemanticResolution["evidence"];
  contextHints: FieldSemanticResolution["contextHints"];
  declarationHint?: DeclarationSemanticHint;
}

export interface SemanticResolutionResult {
  resolution: FieldSemanticResolution;
  aiRequests: number;
  cacheHit: boolean;
}

function tokens(value: string): Set<string> {
  return new Set(normalizeSemanticText(value).split(" ").filter((token) => token.length > 1));
}

function tokenScore(signal: string, alias: string): number {
  const left = tokens(signal);
  const right = tokens(alias);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of right) if (left.has(token)) overlap += 1;
  const coverage = overlap / right.size;
  if (coverage < 0.5) return 0;
  const precision = overlap / left.size;
  return Math.min(0.78, 0.34 + (coverage * 0.3) + (precision * 0.14));
}

function phraseScore(signal: string, alias: string): number {
  const normalizedSignal = normalizeSemanticText(signal);
  const normalizedAlias = normalizeSemanticText(alias);
  if (!normalizedSignal || !normalizedAlias) return 0;
  if (normalizedSignal === normalizedAlias) return 0.94;
  if (normalizedSignal.includes(normalizedAlias) && normalizedAlias.split(" ").length >= 2) return 0.9;
  return tokenScore(normalizedSignal, normalizedAlias);
}

function bestPhraseScore(signals: readonly string[], aliases: readonly string[]): number {
  let best = 0;
  for (const signal of signals) {
    if (!signal) continue;
    for (const alias of aliases) best = Math.max(best, phraseScore(signal, alias));
  }
  return best;
}

function relationEntityBoost(evidence: NormalizedFieldEvidence, canonicalKey: string): number {
  if (evidence.repeatableEvidence.bindingKind === "NONE") return 0;
  const entity = evidence.repeatableEvidence.entityType;
  if (!entity) return 0;
  if (entity === "EMPLOYMENT" && canonicalKey.startsWith("EMPLOYMENT_")) return 0.16;
  if (entity === "EDUCATION" && canonicalKey.startsWith("EDUCATION_")) return 0.16;
  if (entity === "EMPLOYMENT" && ["CURRENT_COMPANY", "CURRENT_JOB_TITLE"].includes(canonicalKey)) return -0.18;
  return 0;
}

function candidateSource(evidence: ScoredCandidate["evidence"]): CanonicalCandidate["source"] {
  if (evidence.attribute >= 0.9) return "ATTRIBUTE";
  if (evidence.alias >= 0.9) return "EXACT_ALIAS";
  if (evidence.section >= 0.08) return "SECTION";
  if (evidence.neighbor >= 0.04) return "NEIGHBOR";
  return "LEXICAL";
}

export function generateCanonicalCandidates(evidence: NormalizedFieldEvidence): readonly ScoredCandidate[] {
  const primarySignals = [evidence.label, evidence.attributes.ariaLabel].filter(Boolean);
  const placeholderSignal = evidence.attributes.placeholder;
  const attributeSignal = [evidence.attributes.autocomplete, evidence.attributes.name, evidence.attributes.id].filter(Boolean).join(" ");
  const neighborSignal = `${evidence.previousLabel} ${evidence.nextLabel}`;
  const negativeSignal = [...primarySignals, placeholderSignal].filter(Boolean).join(" ");
  const candidates: ScoredCandidate[] = [];
  for (const rule of aliasRules()) {
    if (rule.requiredSection && !rule.requiredSection.test(evidence.normalizedSection)) continue;
    if (rule.negative?.test(normalizeSemanticText(negativeSignal))) continue;
    const definition = canonicalDefinitionFor(rule.canonicalKey);
    if (!definition || !policyAllowsSemanticResolution(rule.canonicalKey)) continue;
    const primaryAlias = bestPhraseScore(primarySignals, rule.aliases);
    const placeholderAlias = primaryAlias === 0 && placeholderSignal
      ? bestPhraseScore([placeholderSignal], rule.aliases) * 0.72
      : 0;
    const alias = Math.max(primaryAlias, placeholderAlias);
    const attribute = Math.max(...(rule.attributeAliases ?? rule.aliases).map((value) => phraseScore(attributeSignal, value)), 0);
    const type = fieldTypeCompatibility(evidence.controlType, rule.canonicalKey);
    if (type < 0) continue;
    const section = rule.section?.test(evidence.normalizedSection) ? 0.1 : 0;
    const neighbor = Math.max(...rule.aliases.map((value) => tokenScore(neighborSignal, value)), 0) * 0.08;
    const entityBoost = relationEntityBoost(evidence, rule.canonicalKey);
    const definitionEntity = definition.entityType;
    const entityContextPenalty = definitionEntity && !section && evidence.repeatableEvidence.entityType !== definitionEntity ? -0.35 : 0;
    const raw = Math.max(alias, attribute * 0.98) + (Math.max(0, type) * 0.05) + section + neighbor + entityBoost + entityContextPenalty;
    const confidence = Math.max(0, Math.min(0.99, Number(raw.toFixed(4))));
    if (confidence < FIELD_CONFIDENCE_THRESHOLDS.candidateMinimum) continue;
    const components = { alias, fieldType: type, section, neighbor, attribute };
    candidates.push({
      canonicalKey: rule.canonicalKey,
      description: definition.description,
      confidence,
      source: candidateSource(components),
      reasonCodes: [
        alias >= 0.9 ? "EXACT_NORMALIZED_ALIAS" : alias > 0 ? "LEXICAL_ALIAS_OVERLAP" : null,
        attribute >= 0.9 ? "SEMANTIC_ATTRIBUTE_MATCH" : null,
        section > 0 ? "SECTION_CONTEXT_MATCH" : null,
        neighbor > 0.03 ? "NEIGHBOR_CONTEXT_MATCH" : null,
        entityBoost > 0 ? "REPEATABLE_ENTITY_CONTEXT_MATCH" : null,
        type > 0.7 ? "FIELD_TYPE_COMPATIBLE" : null
      ].filter((value): value is string => Boolean(value)),
      evidence: components
    });
  }
  return candidates.sort((left, right) => right.confidence - left.confidence || left.canonicalKey.localeCompare(right.canonicalKey)).slice(0, 8);
}

function compactPayload(evidence: NormalizedFieldEvidence, candidates: readonly CanonicalCandidate[]): CompactCanonicalizationPayload {
  return CompactCanonicalizationPayloadSchema.parse({
    field: { label: evidence.label, type: evidence.controlType },
    context: { section: evidence.section || null, previousLabel: evidence.previousLabel || null, nextLabel: evidence.nextLabel || null },
    candidateCanonicals: candidates.map((candidate) => ({ canonicalKey: candidate.canonicalKey, description: candidate.description })),
    containsCandidateValue: false
  });
}

function richPayload(evidence: NormalizedFieldEvidence, candidates: readonly CanonicalCandidate[]): RichCanonicalizationPayload {
  return RichCanonicalizationPayloadSchema.parse({
    ...compactPayload(evidence, candidates),
    richerContext: {
      ariaLabel: evidence.attributes.ariaLabel || null,
      placeholder: evidence.attributes.placeholder || null,
      name: evidence.attributes.name || null,
      role: evidence.attributes.role || null,
      optionSamples: evidence.optionSamples,
      nearbyDescription: evidence.nearbyDescription || null,
      pageHeading: evidence.pageHeading || null,
      ats: evidence.ats
    }
  });
}

function validateAiOutput(raw: unknown, candidates: readonly CanonicalCandidate[]): AiCanonicalizationOutput {
  const output = AiCanonicalizationOutputSchema.parse(raw);
  const allowed = new Set(candidates.map((candidate) => candidate.canonicalKey));
  if (output.selectedCanonical && !allowed.has(output.selectedCanonical)) throw new Error("AI_CANONICAL_NOT_IN_CANDIDATE_SET");
  if (output.ranking.some((candidate) => !allowed.has(candidate.canonicalKey))) throw new Error("AI_RANKING_NOT_IN_CANDIDATE_SET");
  return output;
}

function requiredSemanticContextMissing(canonicalKey: string, page: FieldIntelligencePageContext, evidence: NormalizedFieldEvidence): boolean {
  const policy = candidateAnswerPolicy(canonicalKey);
  // Country changes the meaning of a generic work-authorization question.
  // Company/job/application identity changes answer scope, not field meaning,
  // and is therefore handled by the Candidate Truth boundary instead.
  return canonicalKey === "WORK_AUTHORIZATION" && policy.requiredContextDimensions.includes("COUNTRY") && !(evidence.countryCodeHint ?? page.countryCode);
}

const declarationCanonicals = new Set([
  "CERTIFY_INFORMATION_ACCURATE",
  "PRIVACY_ACKNOWLEDGEMENT",
  "TERMS_ACKNOWLEDGEMENT",
  "BACKGROUND_CHECK_AUTHORIZATION",
  "DATA_PROCESSING_CONSENT",
  "APPLICANT_CERTIFICATION",
  "EEO_ACKNOWLEDGEMENT",
  "APPLICATION_SPECIFIC_ACKNOWLEDGEMENT"
]);

function declarationSemanticHint(
  evidence: NormalizedFieldEvidence,
  core: Pick<CachedSemanticCore, "canonicalKey" | "confidence">
): DeclarationSemanticHint {
  const sourceEvidence: DeclarationSemanticHint["sourceEvidence"] = [];
  const signals = [
    evidence.label,
    evidence.attributes.ariaLabel,
    evidence.attributes.accessibleDescription,
    evidence.section,
    evidence.nearbyDescription
  ];
  if (evidence.label) sourceEvidence.push("LABEL");
  if (evidence.attributes.ariaLabel) sourceEvidence.push("ARIA_LABEL");
  if (evidence.attributes.accessibleDescription) sourceEvidence.push("ACCESSIBLE_DESCRIPTION");
  if (evidence.section) sourceEvidence.push("SECTION_CONTEXT");
  if (evidence.nearbyDescription) sourceEvidence.push("NEARBY_DESCRIPTION");
  const normalized = normalizeSemanticText(signals.filter(Boolean).join(" "));
  const declarationLanguage = /\b(certify|certification|acknowledge|acknowledgement|consent|authorize|authorization|agree|accept|understand|confirm)\b/.test(normalized);
  const materialLanguage = /\b(accurate|true|privacy|terms|condition|background|screening|personal data|personal information|processing|verification|withdrawal|termination|equal opportunity|eeo|voluntary disclosure|statement above|application)\b/.test(normalized);
  const compatibleControl = ["CHECKBOX", "RADIO", "SELECT", "COMBOBOX"].includes(evidence.controlType);
  const known = Boolean(core.canonicalKey && declarationCanonicals.has(core.canonicalKey));
  if (known) sourceEvidence.unshift("CANONICAL_MATCH");
  const tokenCount = normalized.split(" ").filter(Boolean).length;
  const textEvidence = tokenCount >= 3 && materialLanguage ? "FULL" : declarationLanguage ? "PARTIAL" : "UNAVAILABLE";
  if (known) {
    return {
      state: "KNOWN_DECLARATION",
      confidence: core.confidence,
      textEvidence,
      sourceEvidence: [...new Set(sourceEvidence)],
      reasonCodes: ["J_DECLARATION_CANONICAL_MATCH"],
      valuePrivate: true,
      containsCandidateValue: false
    };
  }
  if (compatibleControl && declarationLanguage) {
    return {
      state: "DECLARATION_LIKE",
      confidence: materialLanguage ? 0.76 : 0.55,
      textEvidence,
      sourceEvidence: [...new Set(sourceEvidence)],
      reasonCodes: [materialLanguage ? "J_DECLARATION_LANGUAGE_WITH_CONTEXT" : "J_AMBIGUOUS_DECLARATION_LANGUAGE"],
      valuePrivate: true,
      containsCandidateValue: false
    };
  }
  return {
    state: "NOT_DECLARATION",
    confidence: 0,
    textEvidence: "UNAVAILABLE",
    sourceEvidence: [],
    reasonCodes: ["J_NO_DECLARATION_EVIDENCE"],
    valuePrivate: true,
    containsCandidateValue: false
  };
}

function baseCore(evidence: NormalizedFieldEvidence, candidates: readonly ScoredCandidate[]): CachedSemanticCore {
  const top = candidates[0];
  const second = candidates[1];
  const margin = top ? Math.max(0, top.confidence - (second?.confidence ?? 0)) : 0;
  const baseEvidence = top?.evidence ?? { alias: 0, fieldType: 0, section: 0, neighbor: 0, attribute: 0 };
  if (!top) {
    return {
      state: "UNRESOLVED", canonicalKey: null, confidence: 0, resolver: "NONE", candidates: [],
      reasonCodes: [FIELD_CONFIDENCE_POLICY_VERSION], errorCodes: ["NO_CANONICAL_CANDIDATE"],
      evidence: { ...baseEvidence, candidateMargin: 0 }, contextHints: { countryCode: evidence.countryCodeHint }
    };
  }
  const exact = top.source === "EXACT_ALIAS" || top.source === "ATTRIBUTE";
  const high = top.confidence >= FIELD_CONFIDENCE_THRESHOLDS.high && margin >= FIELD_CONFIDENCE_THRESHOLDS.highMargin;
  const medium = top.confidence >= FIELD_CONFIDENCE_THRESHOLDS.medium && margin >= FIELD_CONFIDENCE_THRESHOLDS.mediumMargin;
  return {
    state: high ? "RESOLVED_HIGH" : medium ? "RESOLVED_MEDIUM" : "AMBIGUOUS",
    canonicalKey: high || medium ? top.canonicalKey : null,
    confidence: top.confidence,
    resolver: exact ? "EXACT_ALIAS" : "DETERMINISTIC",
    candidates: candidates.map(publicCandidate),
    reasonCodes: [FIELD_CONFIDENCE_POLICY_VERSION, ...top.reasonCodes],
    errorCodes: high || medium ? [] : ["AMBIGUOUS_CANONICAL"],
    evidence: { ...baseEvidence, candidateMargin: Number(margin.toFixed(4)) },
    contextHints: { countryCode: evidence.countryCodeHint }
  };
}

function hasRichFallback(evidence: NormalizedFieldEvidence): boolean {
  return Boolean(evidence.attributes.ariaLabel || evidence.attributes.placeholder || evidence.attributes.name || evidence.optionSamples.length || evidence.nearbyDescription || evidence.pageHeading);
}

function aiMergedCore(core: CachedSemanticCore, output: AiCanonicalizationOutput, candidates: readonly ScoredCandidate[], evidence: NormalizedFieldEvidence): CachedSemanticCore {
  if (!output.selectedCanonical || output.ambiguous) return { ...core, reasonCodes: [...new Set([...core.reasonCodes, "AI_REMAINED_AMBIGUOUS"])], errorCodes: ["AMBIGUOUS_CANONICAL"] };
  const candidate = candidates.find((item) => item.canonicalKey === output.selectedCanonical);
  if (!candidate) return core;
  const second = candidates.find((item) => item.canonicalKey !== candidate.canonicalKey)?.confidence ?? 0;
  const agreement = candidates[0]?.canonicalKey === candidate.canonicalKey ? 0.06 : 0;
  const confidence = Math.min(0.98, Number(((candidate.confidence * 0.58) + (output.confidence * 0.42) + agreement).toFixed(4)));
  const margin = Math.max(0, confidence - second);
  const high = confidence >= FIELD_CONFIDENCE_THRESHOLDS.high && margin >= FIELD_CONFIDENCE_THRESHOLDS.highMargin;
  const medium = confidence >= FIELD_CONFIDENCE_THRESHOLDS.medium && margin >= FIELD_CONFIDENCE_THRESHOLDS.mediumMargin;
  return {
    ...core,
    state: high ? "RESOLVED_HIGH" : medium ? "RESOLVED_MEDIUM" : "AMBIGUOUS",
    canonicalKey: high || medium ? candidate.canonicalKey : null,
    confidence,
    resolver: "AI_ASSISTED",
    candidates: candidates.map((scored) => {
      const item = publicCandidate(scored);
      return item.canonicalKey === candidate.canonicalKey
        ? { ...item, confidence, source: "AI_PROPOSAL" as const, reasonCodes: [...new Set([...item.reasonCodes, `AI_${output.reasonCategory}`])] }
        : item;
    }),
    reasonCodes: [...new Set([...core.reasonCodes, "AI_SCHEMA_VALID", `AI_${output.reasonCategory}`])],
    errorCodes: high || medium ? [] : ["AMBIGUOUS_CANONICAL"],
    evidence: { ...candidate.evidence, candidateMargin: Number(margin.toFixed(4)) },
    contextHints: { countryCode: evidence.countryCodeHint }
  };
}

export class FieldSemanticResolver {
  private readonly cache = new Map<string, CachedSemanticCore>();
  private readonly inFlight = new Map<string, Promise<SemanticResolutionResult>>();

  constructor(private readonly ai: FieldCanonicalizationAiPort | null = null, private readonly maximumCacheEntries = 2_000) {}

  async resolve(raw: FieldEvidenceInput, page: FieldIntelligencePageContext, allowAi = true, aiContext?: FieldAiContext): Promise<SemanticResolutionResult> {
    const normalized = normalizeFieldEvidence(raw, page);
    const key = JSON.stringify([normalized.descriptorFingerprint, raw.fieldRuntimeId, page, allowAi, aiContext?.accountId, aiContext?.candidateId, aiContext?.applicationId]);
    const current = this.inFlight.get(key);
    if (current) return current;
    const pending = this.resolveOnce(raw, page, allowAi, aiContext);
    this.inFlight.set(key, pending);
    try { return await pending; } finally { if (this.inFlight.get(key) === pending) this.inFlight.delete(key); }
  }

  private async resolveOnce(raw: FieldEvidenceInput, page: FieldIntelligencePageContext, allowAi: boolean, aiContext?: FieldAiContext): Promise<SemanticResolutionResult> {
    const evidence = normalizeFieldEvidence(raw, page);
    if (evidence.controlType === "BUTTON" || evidence.controlType === "UNKNOWN") {
      return { resolution: FieldSemanticResolutionSchema.parse({
        fieldRuntimeId: evidence.fieldRuntimeId, descriptorFingerprint: evidence.descriptorFingerprint,
        state: "UNSUPPORTED", canonicalKey: null, confidence: 0, resolver: "NONE", candidates: [],
        reasonCodes: [FIELD_CONFIDENCE_POLICY_VERSION], errorCodes: ["UNSUPPORTED_CONTROL"],
        evidence: { alias: 0, fieldType: -1, section: 0, neighbor: 0, attribute: 0, candidateMargin: 0 },
        contextHints: { countryCode: evidence.countryCodeHint },
        declarationHint: declarationSemanticHint(evidence, { canonicalKey: null, confidence: 0 }),
        entityBinding: evidence.repeatableEvidence,
        valuePrivate: true, containsCandidateValue: false
      }), aiRequests: 0, cacheHit: false };
    }
    const cacheKey = JSON.stringify([evidence.descriptorFingerprint, allowAi, aiContext?.accountId ?? null, aiContext?.candidateId ?? null, aiContext?.applicationId ?? null]);
    const enrichedKey = JSON.stringify([evidence.descriptorFingerprint, true, aiContext?.accountId ?? null, aiContext?.candidateId ?? null, aiContext?.applicationId ?? null]);
    const cached = this.cache.get(enrichedKey) ?? this.cache.get(cacheKey);
    if (cached) return {
      resolution: FieldSemanticResolutionSchema.parse({ ...cached, fieldRuntimeId: evidence.fieldRuntimeId, descriptorFingerprint: evidence.descriptorFingerprint, resolver: "CACHE", entityBinding: evidence.repeatableEvidence, valuePrivate: true, containsCandidateValue: false }),
      aiRequests: 0,
      cacheHit: true
    };
    const candidates = generateCanonicalCandidates(evidence);
    let core = baseCore(evidence, candidates);
    let aiRequests = 0;
    if (core.state !== "RESOLVED_HIGH" && candidates.length > 0 && allowAi && this.ai) {
      try {
        aiRequests += 1;
        let output = validateAiOutput(await this.ai.canonicalize(compactPayload(evidence, candidates), aiContext), candidates);
        if ((!output.selectedCanonical || output.ambiguous || output.confidence < FIELD_CONFIDENCE_THRESHOLDS.medium) && hasRichFallback(evidence)) {
          aiRequests += 1;
          output = validateAiOutput(await this.ai.canonicalize(richPayload(evidence, candidates), aiContext), candidates);
        }
        core = aiMergedCore(core, output, candidates, evidence);
      } catch (reason) {
        const unavailable = reason instanceof FieldCanonicalizationAiUnavailableError;
        core = { ...core,
          reasonCodes: [...new Set([...core.reasonCodes, unavailable ? reason.reasonCode : "AI_OUTPUT_REJECTED"])],
          errorCodes: [...new Set([...core.errorCodes, unavailable
            ? FieldSemanticResolutionSchema.shape.errorCodes.element.parse(reason.reasonCode)
            : "AI_SCHEMA_INVALID" as const])]
        };
      }
    } else if (core.state !== "RESOLVED_HIGH" && allowAi && !this.ai && candidates.length > 0) {
      core = { ...core, reasonCodes: [...core.reasonCodes, "AI_PROVIDER_NOT_CONFIGURED"], errorCodes: [...new Set([...core.errorCodes, "AI_UNAVAILABLE" as const])] };
    }
    if (core.canonicalKey && requiredSemanticContextMissing(core.canonicalKey, page, evidence)) {
      core = { ...core, state: "AMBIGUOUS", canonicalKey: null,
        reasonCodes: [...new Set([...core.reasonCodes, "REQUIRED_SEMANTIC_CONTEXT_MISSING"])],
        errorCodes: [...new Set([...core.errorCodes, "FIELD_CONTEXT_INSUFFICIENT" as const])]
      };
    }
    if (core.canonicalKey && (!canonicalDefinitionFor(core.canonicalKey) || !policyAllowsSemanticResolution(core.canonicalKey))) {
      core = { ...core, state: "UNRESOLVED", canonicalKey: null,
        reasonCodes: [...new Set([...core.reasonCodes, "AUTHORITATIVE_CANONICAL_POLICY_REJECTED"])],
        errorCodes: [...new Set([...core.errorCodes, "CANONICAL_POLICY_REJECTED" as const])]
      };
    }
    const declarationHint = declarationSemanticHint(evidence, core);
    const cachedCore = { ...core, declarationHint };
    if (!core.errorCodes.some((code) => code.startsWith("AI_"))) this.cache.set(cacheKey, cachedCore);
    if (this.cache.size > this.maximumCacheEntries) this.cache.delete(this.cache.keys().next().value as string);
    return {
      resolution: FieldSemanticResolutionSchema.parse({ ...cachedCore, fieldRuntimeId: evidence.fieldRuntimeId, descriptorFingerprint: evidence.descriptorFingerprint, entityBinding: evidence.repeatableEvidence, valuePrivate: true, containsCandidateValue: false }),
      aiRequests,
      cacheHit: false
    };
  }
}

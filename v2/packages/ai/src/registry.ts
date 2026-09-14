import { z } from "zod";
import { AiCanonicalizationOutputSchema, EntityBindingAiOutputSchema, safeStrategyPlan } from "@job-hunter-v2/contracts";
import { AiError, FailureAiOutputSchema, GeneratedDocumentOutputSchema, ResumeAiOutputSchema, StrategyProposalOutputSchema, type AiRequest, type Privacy, type Provider, type Task } from "./contracts.js";

interface TaskPolicy {
  version: number; workload: "COMPACT_JSON" | "LARGE_DOCUMENT"; privacy: Privacy;
  providers: readonly Provider[]; timeoutMs: number; maxInputBytes: number;
  maxOutputTokens: number; minimumConfidence: number; cacheTtlMs: number;
  output: z.ZodType;
  instruction: string;
}
export const TASKS: Readonly<Record<Task, TaskPolicy>> = Object.freeze({
  GENERATE_STRATEGY_CANDIDATE: {
    version: 1, workload: "COMPACT_JSON", privacy: "FIELD_METADATA_ONLY", providers: ["GROQ", "OPENAI"],
    timeoutMs: 10_000, maxInputBytes: 8_000, maxOutputTokens: 500, minimumConfidence: 0.8, cacheTtlMs: 60_000,
    output: StrategyProposalOutputSchema,
    instruction: "Propose exactly one supplied allowed plan for the evidenced execution failures. Do not add actions, values, selectors or code. This is an untrusted proposal requiring independent fixtures and human review, never permission to execute. Abstain when evidence is insufficient."
  },
  CANONICALIZE_FIELD: {
    version: 1, workload: "COMPACT_JSON", privacy: "FIELD_METADATA_ONLY",
    providers: ["GROQ", "OPENAI"], timeoutMs: 8_000, maxInputBytes: 12_000,
    maxOutputTokens: 700, minimumConfidence: 0.72, cacheTtlMs: 300_000,
    output: AiCanonicalizationOutputSchema,
    instruction: "Choose only a supplied canonical ID using label and context. Rank supplied IDs. Report ambiguity when evidence is insufficient."
  },
  DISAMBIGUATE_ENTITY: {
    version: 1, workload: "COMPACT_JSON", privacy: "CANDIDATE_PRIVATE_DATA",
    providers: ["GROQ", "OPENAI"], timeoutMs: 8_000, maxInputBytes: 16_000,
    maxOutputTokens: 400, minimumConfidence: 0.9, cacheTtlMs: 0,
    output: EntityBindingAiOutputSchema,
    instruction: "Choose only a supplied entity ID using explicit role and coverage evidence. Ordinal order is not identity. Abstain when ambiguous."
  },
  EXTRACT_RESUME: {
    version: 2, workload: "LARGE_DOCUMENT", privacy: "DOCUMENT_PRIVATE_DATA",
    providers: ["GEMINI", "OPENAI"], timeoutMs: 45_000, maxInputBytes: 240_000,
    maxOutputTokens: 8_000, minimumConfidence: 0.9, cacheTtlMs: 0,
    output: ResumeAiOutputSchema,
    instruction: "Extract only explicitly stated allowed resume fields as separate repeatable entities. Copy an exact source quote for every value; use stable local group keys within this output. Do not infer, summarize, normalize beyond the requested date shape, combine distinct roles, or invent facts. Missing data is preferred to unsupported data."
  },
  TAILOR_RESUME: {
    version: 1, workload: "LARGE_DOCUMENT", privacy: "DOCUMENT_PRIVATE_DATA",
    providers: ["GEMINI", "OPENAI"], timeoutMs: 45_000, maxInputBytes: 240_000,
    maxOutputTokens: 8_000, minimumConfidence: 0.95, cacheTtlMs: 0,
    output: GeneratedDocumentOutputSchema,
    instruction: "Create a concise tailored resume using only supplied claims. Every block must cite supplied source IDs. Reorder, select and lightly rewrite truthful candidate claims; never add experience, employers, titles, dates, metrics, projects, certifications or skills. Do not represent a job requirement as candidate experience."
  },
  GENERATE_COVER_LETTER: {
    version: 1, workload: "LARGE_DOCUMENT", privacy: "DOCUMENT_PRIVATE_DATA",
    providers: ["GEMINI", "OPENAI"], timeoutMs: 45_000, maxInputBytes: 240_000,
    maxOutputTokens: 4_000, minimumConfidence: 0.95, cacheTtlMs: 0,
    output: GeneratedDocumentOutputSchema,
    instruction: "Write a concise cover letter using only supplied candidate and job claims. Every block must cite supplied source IDs. Interest may be expressed, but never invent motivation history, relationships, accomplishments, years, expertise, metrics or skills."
  },
  ANALYZE_EXECUTION_FAILURE: {
    version: 1, workload: "COMPACT_JSON", privacy: "FIELD_METADATA_ONLY",
    providers: ["GROQ", "OPENAI"], timeoutMs: 10_000, maxInputBytes: 8_000,
    maxOutputTokens: 500, minimumConfidence: 0.8, cacheTtlMs: 60_000,
    output: FailureAiOutputSchema,
    instruction: "Classify supplied failure evidence and select only a supplied strategy ID, or null. This is an analysis proposal, never execution authorization."
  }
});

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
}

/** Schema validity is necessary, but confidence comes from task evidence. */
export function validateResult(request: AiRequest, raw: unknown): { value: unknown; confidence: number } {
  const parsed = TASKS[request.taskType].output.safeParse(raw);
  if (!parsed.success) throw new AiError("AI_SCHEMA_INVALID");
  if (request.taskType === "GENERATE_STRATEGY_CANDIDATE") {
    const value = StrategyProposalOutputSchema.parse(parsed.data);
    const plan = safeStrategyPlan(value.plan);
    if (!plan || !request.payload.allowedPlans.some((allowed) => JSON.stringify(allowed) === JSON.stringify(plan))) throw new AiError("AI_SAFETY_REJECTED");
    return { value, confidence: value.reason === "INSUFFICIENT_EVIDENCE" ? 0 : 0.85 };
  }
  if (request.taskType === "CANONICALIZE_FIELD") {
    const value = AiCanonicalizationOutputSchema.parse(parsed.data);
    const candidates = request.payload.candidateCanonicals;
    if (value.ranking.some((rank) => !candidates.some((c) => c.canonicalKey === rank.canonicalKey))
      || new Set(value.ranking.map((r) => r.canonicalKey)).size !== value.ranking.length
      || (value.selectedCanonical && !candidates.some((c) => c.canonicalKey === value.selectedCanonical))) throw new AiError("AI_SCHEMA_INVALID");
    if (value.ambiguous || !value.selectedCanonical || value.reasonCategory === "INSUFFICIENT_EVIDENCE") return { value, confidence: 0 };
    const context = words([request.payload.field.label, ...Object.values(request.payload.context)].filter(Boolean).join(" "));
    const scores = candidates.map((c) => ({
      key: c.canonicalKey,
      overlap: [...words(c.description + " " + c.canonicalKey)].filter((w) => context.has(w)).length
    })).sort((a, b) => b.overlap - a.overlap);
    const selected = scores.find((c) => c.key === value.selectedCanonical);
    const others = scores.filter((c) => c.key !== value.selectedCanonical);
    const supported = selected && selected.overlap > 0 && selected.overlap > (others[0]?.overlap ?? 0);
    const confidence = supported ? 0.9 : selected?.overlap ? 0.7 : 0;
    return { value: { ...value, confidence: Math.min(value.confidence, confidence) }, confidence: Math.min(value.confidence, confidence) };
  }
  if (request.taskType === "DISAMBIGUATE_ENTITY") {
    const value = EntityBindingAiOutputSchema.parse(parsed.data);
    const selected = request.payload.candidates.find((c) => c.candidateEntityId === value.selectedCandidateEntityId);
    if (value.selectedCandidateEntityId && !selected) throw new AiError("AI_SCHEMA_INVALID");
    const coverage = request.payload.candidates.filter((c) => request.payload.group.canonicalKeys.every((key) => c.canonicalCoverage.includes(key)));
    const supported = request.payload.group.identityKind !== "ORDINAL_ONLY" && request.payload.group.canonicalKeys.length > 0
      && coverage.length === 1 && coverage[0]?.candidateEntityId === selected?.candidateEntityId;
    const confidence = supported && !value.ambiguous ? Math.min(0.92, value.confidence) : 0;
    return { value: { ...value, confidence }, confidence };
  }
  if (request.taskType === "EXTRACT_RESUME") {
    const value = ResumeAiOutputSchema.parse(parsed.data);
    const seen = new Set<string>();
    const seenFields = new Set<string>();
    const expected = new Map<string, { kind: "TEXT" | "LIST" | "DATE" | "DATE_RANGE"; entity: string | null }>([
      ["FULL_NAME", { kind: "TEXT", entity: null }], ["EMAIL", { kind: "TEXT", entity: null }],
      ["PHONE", { kind: "TEXT", entity: null }], ["CURRENT_LOCATION", { kind: "TEXT", entity: null }],
      ["LINKEDIN_URL", { kind: "TEXT", entity: null }], ["GITHUB_URL", { kind: "TEXT", entity: null }],
      ["PORTFOLIO_URL", { kind: "TEXT", entity: null }], ["SKILLS", { kind: "LIST", entity: null }],
      ...["EMPLOYMENT_COMPANY", "EMPLOYMENT_TITLE", "EMPLOYMENT_LOCATION", "EMPLOYMENT_DESCRIPTION"].map((key) => [key, { kind: "TEXT" as const, entity: "EMPLOYMENT" }] as const),
      ["EMPLOYMENT_DATE_RANGE", { kind: "DATE_RANGE", entity: "EMPLOYMENT" }],
      ["EMPLOYMENT_SKILLS", { kind: "LIST", entity: "EMPLOYMENT" }],
      ...["EDUCATION_INSTITUTION", "EDUCATION_DEGREE", "EDUCATION_FIELD_OF_STUDY", "EDUCATION_GRADE", "EDUCATION_LOCATION"].map((key) => [key, { kind: "TEXT" as const, entity: "EDUCATION" }] as const),
      ["EDUCATION_DATE_RANGE", { kind: "DATE_RANGE", entity: "EDUCATION" }],
      ...["PROJECT_NAME", "PROJECT_DESCRIPTION", "PROJECT_URL"].map((key) => [key, { kind: "TEXT" as const, entity: "PROJECT" }] as const),
      ["PROJECT_TECHNOLOGIES", { kind: "LIST", entity: "PROJECT" }],
      ["PROJECT_DATE_RANGE", { kind: "DATE_RANGE", entity: "PROJECT" }],
      ...["CERTIFICATION_NAME", "CERTIFICATION_ISSUER", "CERTIFICATION_URL", "CERTIFICATION_KIND"].map((key) => [key, { kind: "TEXT" as const, entity: "CERTIFICATION" }] as const),
      ["CERTIFICATION_DATE", { kind: "DATE", entity: "CERTIFICATION" }]
    ]);
    for (const field of value.fields) {
      const shape = expected.get(field.canonicalKey);
      const fieldIdentity = field.entityType
        ? `${field.entityType}:${field.entityGroupKey}:${field.canonicalKey}`
        : `GLOBAL:${field.canonicalKey}`;
      if (!shape || !request.payload.allowedFields.includes(field.canonicalKey) || seen.has(field.itemKey)
        || seenFields.has(fieldIdentity)
        || shape.kind !== field.value.kind || shape.entity !== field.entityType
        || !request.payload.text.includes(field.sourceQuote)) throw new AiError("AI_SCHEMA_INVALID");
      seen.add(field.itemKey);
      seenFields.add(fieldIdentity);
      const quote = field.sourceQuote.toLocaleLowerCase();
      if (field.value.kind === "TEXT" && !quote.includes(field.value.value.toLocaleLowerCase())) throw new AiError("AI_SCHEMA_INVALID");
      if (field.value.kind === "LIST" && field.value.values.some((item) => !quote.includes(item.toLocaleLowerCase()))) throw new AiError("AI_SCHEMA_INVALID");
      if (field.value.kind === "DATE" && !quote.includes(field.value.value.slice(0, 4))) throw new AiError("AI_SCHEMA_INVALID");
      if (field.value.kind === "DATE_RANGE") {
        if (!field.value.start || (field.value.current && field.value.end) || (!field.value.current && !field.value.end)
          || (field.value.end && field.value.start > field.value.end)
          || !quote.includes(field.value.start.slice(0, 4))
          || (field.value.end && !quote.includes(field.value.end.slice(0, 4)))) throw new AiError("AI_SCHEMA_INVALID");
      }
      const textValue = field.value.kind === "TEXT" ? field.value.value : "";
      if (field.canonicalKey === "EMAIL" && !z.email().safeParse(textValue).success) throw new AiError("AI_SCHEMA_INVALID");
      if (["LINKEDIN_URL", "GITHUB_URL", "PORTFOLIO_URL", "PROJECT_URL", "CERTIFICATION_URL"].includes(field.canonicalKey)
        && !/^(?:https?:\/\/)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/?#][^\s]*)?$/.test(textValue)) throw new AiError("AI_SCHEMA_INVALID");
      if (field.canonicalKey === "PHONE" && !/^\+?[\d ()-]{7,25}$/.test(textValue)) throw new AiError("AI_SCHEMA_INVALID");
      if (field.canonicalKey === "CERTIFICATION_KIND" && !["CERTIFICATION", "AWARD"].includes(textValue.toUpperCase())) throw new AiError("AI_SCHEMA_INVALID");
    }
    return { value, confidence: value.fields.length ? 0.92 : 0 };
  }
  if (request.taskType === "TAILOR_RESUME" || request.taskType === "GENERATE_COVER_LETTER") {
    const value = GeneratedDocumentOutputSchema.parse(parsed.data);
    const supplied = new Map([...request.payload.candidateClaims, ...request.payload.jobClaims].map((claim) => [claim.sourceId, claim]));
    const candidateText = request.payload.candidateClaims.map((claim) => claim.text).join(" ").toLocaleLowerCase();
    const jobSkills = request.payload.jobClaims.filter((claim) => ["REQUIRED_SKILL", "PREFERRED_SKILL"].includes(claim.canonicalKey));
    if (value.titleSourceClaimIds.some((id) => !supplied.has(id))) throw new AiError("AI_SCHEMA_INVALID");
    const titled = value.titleSourceClaimIds.map((id) => supplied.get(id)?.text ?? "").join(" ");
    if (![...words(value.title)].some((token) => token.length >= 4 && words(titled).has(token))) throw new AiError("AI_CONFIDENCE_INSUFFICIENT");
    for (const block of value.blocks) {
      if (new Set(block.sourceClaimIds).size !== block.sourceClaimIds.length
        || block.sourceClaimIds.some((id) => !supplied.has(id))) throw new AiError("AI_SCHEMA_INVALID");
      const cited = block.sourceClaimIds.map((id) => supplied.get(id)?.text ?? "").join(" ").toLocaleLowerCase();
      const significant = [...words(block.text)].filter((token) => token.length >= 4);
      const neutralHeading = block.kind === "HEADING" && /^(?:technical |professional |relevant )?(?:skills|experience|education|projects|certifications|summary|contact|languages)$/i.test(block.text.trim());
      if (!neutralHeading && significant.length && !significant.some((token) => words(cited).has(token))) throw new AiError("AI_CONFIDENCE_INSUFFICIENT");
      const citedNumbers = new Set(cited.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []);
      if ((block.text.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []).some((number) => !citedNumbers.has(number))) {
        throw new AiError("AI_SAFETY_REJECTED");
      }
      if (jobSkills.some((skill) => block.text.toLocaleLowerCase().includes(skill.text.toLocaleLowerCase())
        && !candidateText.includes(skill.text.toLocaleLowerCase()))) throw new AiError("AI_SAFETY_REJECTED");
    }
    return { value, confidence: 0.96 };
  }
  const value = FailureAiOutputSchema.parse(parsed.data);
  if ((value.strategyId && !request.payload.strategyIds.includes(value.strategyId))
    || value.evidence.some((e) => !request.payload.evidence.includes(e))) throw new AiError("AI_SCHEMA_INVALID");
  const consistent = value.diagnosis === "CONTROL_CHANGED" ? value.evidence.some((e) => ["CONTROL_REMOVED", "OPTIONS_CHANGED"].includes(e))
    : value.diagnosis === "CANDIDATE_OVERRIDE" ? value.evidence.includes("USER_MODIFIED")
      : value.diagnosis === "SELECTION_NOT_COMMITTED" && value.evidence.includes("READBACK_MISMATCH");
  return { value, confidence: consistent ? 0.85 : 0 };
}

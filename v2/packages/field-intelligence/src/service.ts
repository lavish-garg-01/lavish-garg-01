import {
  CandidateAnswerReferenceSchema,
  ResolveFieldIntelligenceRequestSchema,
  ResolveFieldIntelligenceResponseSchema,
  type CandidateAnswerReference,
  type FieldIntelligencePageContext,
  type FieldSemanticResolution,
  type ResolvedField,
  type ResolveFieldIntelligenceRequest,
  type ResolveFieldIntelligenceResponse
} from "@job-hunter-v2/contracts";
import { parseCandidateScopeContext, type CandidateScopeContext, type CandidateTruthResolution } from "@job-hunter-v2/candidate-truth";
import type { CandidateTruthResolver } from "@job-hunter-v2/candidate-truth";
import { systemClock } from "@job-hunter-v2/domain";
import type { Clock } from "@job-hunter-v2/domain";
import type { FieldSemanticResolver } from "./semantic-resolver.js";
import type { RepeatableEntityIntelligenceService } from "@job-hunter-v2/repeatable-entities";

export interface FieldIntelligenceJobContext {
  jobId: string;
  companyId: string;
  countryCode: string | null;
  roleFamily: string | null;
  ats: string | null;
}

export interface FieldIntelligenceJobContextPort {
  find(jobId: string): Promise<FieldIntelligenceJobContext | null>;
}

export interface ResolveFieldIntelligenceInput {
  accountId: string;
  candidateId: string;
  request: ResolveFieldIntelligenceRequest;
}

export interface PrivateResolvedField {
  semantic: FieldSemanticResolution;
  answerResolution: CandidateTruthResolution | null;
}

export interface PrivateFieldIntelligenceResult {
  noticePeriodDays?: number | null;
  request: ResolveFieldIntelligenceRequest;
  pageContext: FieldIntelligencePageContext;
  items: readonly PrivateResolvedField[];
  aiRequests: number;
  cacheHits: number;
  durationMs: number;
  repeatableCapacity?: readonly { entityType: string; activeCount: number; boundCount: number; remainingCount: number }[];
}

function unresolvedAnswer(): CandidateAnswerReference {
  return CandidateAnswerReferenceSchema.parse({
    status: "SEMANTIC_UNRESOLVED", answerVersionId: null, trustState: null,
    trialReuse: false, requiresUserReview: true, autofillMode: null, expiresAt: null,
    reasonCodes: ["SEMANTIC_FIELD_NOT_RESOLVED"], valuePrivate: true, containsCandidateValue: false
  });
}

function declarationAnswer(): CandidateAnswerReference {
  return CandidateAnswerReferenceSchema.parse({
    status: "NOT_APPLICABLE", answerVersionId: null, trustState: null,
    trialReuse: false, requiresUserReview: true, autofillMode: null, expiresAt: null,
    reasonCodes: ["APPLICATION_DECLARATION_NOT_CANDIDATE_TRUTH"], valuePrivate: true, containsCandidateValue: false
  });
}

function answerReference(resolution: CandidateTruthResolution): CandidateAnswerReference {
  if (resolution.status === "RESOLVED") {
    return CandidateAnswerReferenceSchema.parse({
      status: resolution.requiresUserReview ? "AVAILABLE_REVIEW" : "AVAILABLE_REUSABLE",
      answerVersionId: resolution.answerVersionId,
      trustState: resolution.trustState,
      trialReuse: resolution.trialReuse,
      requiresUserReview: resolution.requiresUserReview,
      autofillMode: resolution.autofillMode,
      expiresAt: resolution.expiresAt,
      reasonCodes: resolution.reasonCodes,
      valuePrivate: true,
      containsCandidateValue: false
    });
  }
  if (resolution.status === "MISSING") {
    return CandidateAnswerReferenceSchema.parse({
      status: "MISSING", answerVersionId: null, trustState: null, trialReuse: false,
      requiresUserReview: true, autofillMode: null, expiresAt: null,
      reasonCodes: resolution.reasonCodes, valuePrivate: true, containsCandidateValue: false
    });
  }
  const reasons = [...resolution.reasonCodes];
  const status = reasons.includes("EQUAL_RANK_NON_EQUIVALENT_ANSWERS") ? "CONFLICT"
    : reasons.includes("NEEDS_RECONFIRMATION") ? "STALE"
      : reasons.includes("REQUIRED_SCOPE_CONTEXT_MISSING") || reasons.includes("ENTITY_CONTEXT_REQUIRED") ? "CONTEXT_REQUIRED"
        : "POLICY_BLOCKED";
  return CandidateAnswerReferenceSchema.parse({
    status,
    answerVersionId: resolution.suggestedAnswerVersionId ?? null,
    trustState: null,
    trialReuse: false,
    requiresUserReview: true,
    autofillMode: null,
    expiresAt: null,
    reasonCodes: reasons,
    valuePrivate: true,
    containsCandidateValue: false
  });
}

function answerContext(page: FieldIntelligencePageContext, job: FieldIntelligenceJobContext | null, countryHint: string | null): CandidateScopeContext {
  return parseCandidateScopeContext({
    ...(page.applicationId ? { applicationId: page.applicationId } : {}),
    ...(page.jobId ? { jobId: page.jobId } : {}),
    ...(page.companyId ?? job?.companyId ? { companyId: page.companyId ?? job?.companyId } : {}),
    ...(countryHint ?? page.countryCode ?? job?.countryCode ? { countryCode: countryHint ?? page.countryCode ?? job?.countryCode ?? undefined } : {}),
    ...(page.roleFamily ?? job?.roleFamily ? { roleFamily: page.roleFamily ?? job?.roleFamily ?? undefined } : {})
  });
}

export class FieldIntelligenceService {
  constructor(
    private readonly semantic: FieldSemanticResolver,
    private readonly candidateTruth: Pick<CandidateTruthResolver, "resolve">,
    private readonly jobs: FieldIntelligenceJobContextPort | null = null,
    private readonly clock: Clock = systemClock,
    private readonly maximumAiCallsPerBatch = 8,
    private readonly repeatableEntities: Pick<RepeatableEntityIntelligenceService, "bind"> | null = null,
    private readonly semanticBudgetMs = 4_000
  ) {}

  async resolvePrivate(input: ResolveFieldIntelligenceInput): Promise<PrivateFieldIntelligenceResult> {
    const started = this.clock.now().getTime();
    const request = ResolveFieldIntelligenceRequestSchema.parse(input.request);
    const job = request.pageContext.jobId && this.jobs ? await this.jobs.find(request.pageContext.jobId) : null;
    const page = {
      ...request.pageContext,
      ats: request.pageContext.ats === "GENERIC" && job?.ats ? job.ats.toUpperCase() : request.pageContext.ats
    };
    const answerCache = new Map<string, Promise<CandidateTruthResolution>>();
    const semanticItems: { field: ResolveFieldIntelligenceRequest["fields"][number]; resolution: FieldSemanticResolution }[] = [];
    let aiRequests = 0;
    let cacheHits = 0;
    for (const field of request.fields) {
      const semanticResult = await this.semantic.resolve(field, page, false, {
        accountId: input.accountId, candidateId: input.candidateId, applicationId: page.applicationId, requestId: request.requestId
      });
      aiRequests += semanticResult.aiRequests;
      cacheHits += semanticResult.cacheHit ? 1 : 0;
      semanticItems.push({ field, resolution: semanticResult.resolution });
    }
    // Resolve ordinary fields immediately. A slow provider must not hold every
    // name/email field hostage. Each enrichment can make at most two AI calls.
    const eligible = semanticItems.filter((item) => item.resolution.state !== "RESOLVED_HIGH" && item.resolution.candidates.length > 0
      && !item.resolution.reasonCodes.some((code) => ["AI_SCHEMA_VALID", "AI_REMAINED_AMBIGUOUS"].includes(code)));
    const candidates = eligible.slice(0, Math.floor(this.maximumAiCallsPerBatch / 2));
    // Queue overflow must also request a rescan; otherwise four fast responses
    // would leave every later question permanently outside the enrichment batch.
    for (const item of eligible.slice(candidates.length)) {
      item.resolution = { ...item.resolution, reasonCodes: [...item.resolution.reasonCodes, "AI_ENRICHMENT_PENDING"] };
    }
    const completed = new Map<string, Awaited<ReturnType<FieldSemanticResolver["resolve"]>>>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (candidates.length) {
      const work = Promise.all(candidates.map(async ({ field }) => {
        const result = await this.semantic.resolve(field, page, true, { accountId: input.accountId, candidateId: input.candidateId, applicationId: page.applicationId, requestId: request.requestId });
        completed.set(field.fieldRuntimeId, result);
      }));
      try { await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, this.semanticBudgetMs); })]); }
      finally { clearTimeout(timer); }
      for (const item of candidates) {
        const enriched = completed.get(item.field.fieldRuntimeId);
        if (enriched) { item.resolution = enriched.resolution; aiRequests += enriched.aiRequests; cacheHits += Number(enriched.cacheHit); }
        else { aiRequests += 2; item.resolution = { ...item.resolution, reasonCodes: [...item.resolution.reasonCodes, "AI_ENRICHMENT_PENDING"] }; }
      }
    }
    const binding = this.repeatableEntities ? await this.repeatableEntities.bind({
      accountId: input.accountId,
      candidateId: input.candidateId,
      applicationRunId: request.applicationRunId,
      pageInstanceId: request.fields[0]?.pageInstanceId ?? crypto.randomUUID(),
      fields: semanticItems.flatMap(({ field, resolution }) => field.repeatableEvidence.formGroup ? [{
        fieldRuntimeId: field.fieldRuntimeId,
        formInstanceId: field.formInstanceId,
        group: field.repeatableEvidence.formGroup,
        semantic: resolution
      }] : [])
    }) : { byFieldRuntimeId: new Map(), capacityByEntityType: new Map(), aiRequests: 0 };
    aiRequests += binding.aiRequests;
    const items: PrivateResolvedField[] = [];
    for (const { field, resolution: rawResolution } of semanticItems) {
      const entityIntelligence = binding.byFieldRuntimeId.get(field.fieldRuntimeId) ?? rawResolution.entityIntelligence;
      const resolution: FieldSemanticResolution = entityIntelligence?.state === "BOUND_HIGH"
        ? {
            ...rawResolution,
            entityBinding: {
              entityType: entityIntelligence.entityType,
              bindingKind: "CANDIDATE_ENTITY",
              instanceKey: entityIntelligence.candidateEntityId,
              candidateEntityId: entityIntelligence.candidateEntityId,
              ordinalHint: null,
              groupLabel: field.repeatableEvidence.groupLabel,
              formGroup: field.repeatableEvidence.formGroup
            },
            entityIntelligence
          }
        : { ...rawResolution, entityIntelligence };
      if (resolution.declarationHint.state !== "NOT_DECLARATION") {
        items.push({ semantic: resolution, answerResolution: null });
        continue;
      }
      if (!resolution.canonicalKey || !resolution.state.startsWith("RESOLVED")) {
        items.push({ semantic: resolution, answerResolution: null });
        continue;
      }
      const context = answerContext(page, job, resolution.contextHints.countryCode);
      const entityId = resolution.entityBinding.bindingKind === "CANDIDATE_ENTITY"
        ? resolution.entityBinding.candidateEntityId
        : null;
      const cacheKey = JSON.stringify({ canonicalKey: resolution.canonicalKey, entityId, context });
      let answer = answerCache.get(cacheKey);
      if (!answer) {
        answer = this.candidateTruth.resolve({
          accountId: input.accountId,
          candidateId: input.candidateId,
          canonicalKey: resolution.canonicalKey,
          entityId,
          context
        });
        answerCache.set(cacheKey, answer);
      }
      items.push({ semantic: resolution, answerResolution: await answer });
    }
    const noticeResolution = items.some((item) => item.semantic.canonicalKey === "LAST_WORKING_DAY")
      ? await this.candidateTruth.resolve({ accountId: input.accountId, candidateId: input.candidateId,
        canonicalKey: "NOTICE_PERIOD", context: answerContext(page, job, null) }) : null;
    return {
      noticePeriodDays: noticeResolution?.status === "RESOLVED" && noticeResolution.normalizedValue.kind === "INTEGER" ? noticeResolution.normalizedValue.value : null,
      request,
      pageContext: page,
      items,
      aiRequests,
      cacheHits,
      durationMs: Math.max(0, this.clock.now().getTime() - started),
      repeatableCapacity: [...binding.capacityByEntityType.entries()].map(([entityType, capacity]) => ({ entityType, ...capacity }))
    };
  }

  async resolve(input: ResolveFieldIntelligenceInput): Promise<ResolveFieldIntelligenceResponse> {
    const privateResult = await this.resolvePrivate(input);
    const items: ResolvedField[] = privateResult.items.map((item) => ({
      semantic: item.semantic,
      answer: item.semantic.declarationHint.state !== "NOT_DECLARATION"
        ? declarationAnswer()
        : item.answerResolution ? answerReference(item.answerResolution) : unresolvedAnswer()
    }));
    const count = (state: string) => items.filter((item) => item.semantic.state === state).length;
    return ResolveFieldIntelligenceResponseSchema.parse({
      schemaVersion: 1,
      requestId: privateResult.request.requestId,
      items,
      summary: {
        resolvedHigh: count("RESOLVED_HIGH"),
        resolvedMedium: count("RESOLVED_MEDIUM"),
        ambiguous: count("AMBIGUOUS"),
        unresolved: count("UNRESOLVED"),
        unsupported: count("UNSUPPORTED"),
        answerAvailable: items.filter((item) => item.answer.status === "AVAILABLE_REUSABLE" || item.answer.status === "AVAILABLE_REVIEW").length,
        aiRequests: privateResult.aiRequests,
        cacheHits: privateResult.cacheHits,
        durationMs: privateResult.durationMs
      },
      valuePrivate: true,
      containsCandidateValue: false
    });
  }
}

import { createHash, randomUUID } from "node:crypto";
import {
  GeneratedDocumentOutputSchema,
  type AiPort,
  type AiRequest
} from "@job-hunter-v2/ai";
import type { PersistableNormalizedValue } from "@job-hunter-v2/candidate-truth";
import type { JobCatalogRepository } from "@job-hunter-v2/job-intelligence";
import {
  DeterministicGeneratedDocumentPort,
  generationClaimFromProfile,
  validateGroundedDraft,
  type CandidateDocumentRepository,
  type CandidateProfileService,
  type DocumentGenerationContext,
  type DocumentGenerationContextPort,
  type GeneratedDocumentPort,
  type GenerationClaim,
  type GenerationStrength
} from "@job-hunter-v2/onboarding";
import { NotFoundError, ValidationError } from "@job-hunter-v2/domain";

const excludedCandidateClaims = new Set([
  "RESUME", "COVER_LETTER", "CERTIFY_INFORMATION_ACCURATE",
  "PRIVACY_ACKNOWLEDGEMENT", "BACKGROUND_CHECK_AUTHORIZATION",
  "TERMS_ACKNOWLEDGEMENT", "EEO_GENDER", "EEO_RACE",
  "EEO_VETERAN", "EEO_DISABILITY"
]);

function dateText(value: { isoDate: string; precision: "DAY" | "MONTH" | "YEAR" }): string {
  return value.precision === "YEAR" ? value.isoDate.slice(0, 4)
    : value.precision === "MONTH" ? value.isoDate.slice(0, 7) : value.isoDate;
}

/** Converts typed Candidate Truth to a presentation string without exposing
 * storage references or manufacturing semantic content. */
export function generationText(value: PersistableNormalizedValue): string | null {
  switch (value.kind) {
    case "STRING": case "RICH_TEXT": case "URL": return value.value;
    case "BOOLEAN": return value.value ? "Yes" : "No";
    case "INTEGER": return String(value.value);
    case "DECIMAL": return value.valueExact;
    case "DATE": return dateText(value.value);
    case "DATE_RANGE": return [value.start ? dateText(value.start) : null, value.current ? "Present" : value.end ? dateText(value.end) : null].filter(Boolean).join(" – ");
    case "DURATION": return `${value.months} months`;
    case "MONEY": return `${value.currency} ${value.amountExact} per ${value.period.toLocaleLowerCase()}`;
    case "PHONE": return `${value.countryCode}${value.nationalNumber}${value.extension ? ` ext ${value.extension}` : ""}`;
    case "ADDRESS": return [value.line1, value.line2, value.city, value.region, value.postalCode, value.countryCode].filter(Boolean).join(", ");
    case "ENUM": return value.value.label;
    case "MULTI_ENUM": return value.values.map((item) => item.label).join(", ");
    case "ENTITY_REF": return value.displayLabel;
    case "DECLINE_TO_ANSWER": case "FILE_REF": return null;
  }
}

function slug(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "claim";
}

export class CandidateDocumentGenerationContext implements DocumentGenerationContextPort {
  constructor(
    private readonly profiles: Pick<CandidateProfileService, "get">,
    private readonly documents: CandidateDocumentRepository,
    private readonly jobs: Pick<JobCatalogRepository, "findById">
  ) {}

  async load(input: { accountId: string; candidateId: string; jobId: string; applicationId: string | null }): Promise<DocumentGenerationContext> {
    const [profile, documents, job] = await Promise.all([
      this.profiles.get(input.accountId, input.candidateId),
      this.documents.list({ accountId: input.accountId, candidateId: input.candidateId }),
      this.jobs.findById(input.jobId)
    ]);
    const source = documents.find((document) => document.purpose === "MASTER_RESUME" && document.status === "READY");
    if (!source) throw new NotFoundError("Upload and approve a master resume before generating documents.");
    if (!job || !["ACTIVE", "STALE"].includes(job.status)) throw new NotFoundError("The job is unavailable for document generation.");
    const candidateClaims = profile.answers.flatMap((answer): GenerationClaim[] => {
      if (answer.trustState !== "TRUSTED" || excludedCandidateClaims.has(answer.canonicalKey)) return [];
      const text = generationText(answer.normalizedValue);
      return text ? [generationClaimFromProfile(answer, text)] : [];
    });
    if (!candidateClaims.length) throw new ValidationError("Confirm profile details before generating a document.");
    const jobClaims: GenerationClaim[] = [
      { sourceId: "job:title", sourceType: "JOB_INTELLIGENCE", canonicalKey: "JOB_TITLE", text: job.title },
      { sourceId: "job:company", sourceType: "JOB_INTELLIGENCE", canonicalKey: "COMPANY_NAME", text: job.companyName },
      ...job.requiredSkills.map((skill, index) => ({
        sourceId: `job:required-${slug(skill.key)}-${index}`,
        sourceType: "JOB_INTELLIGENCE" as const,
        canonicalKey: "REQUIRED_SKILL",
        text: skill.label
      })),
      ...job.preferredSkills.map((skill, index) => ({
        sourceId: `job:preferred-${slug(skill.key)}-${index}`,
        sourceType: "JOB_INTELLIGENCE" as const,
        canonicalKey: "PREFERRED_SKILL",
        text: skill.label
      }))
    ];
    return {
      sourceDocumentId: source.documentId,
      jobId: job.jobId,
      applicationId: input.applicationId,
      candidateClaims,
      jobClaims
    };
  }
}

export class OrchestratedGeneratedDocumentPort implements GeneratedDocumentPort {
  constructor(
    private readonly ai: AiPort,
    private readonly allowPrivate: boolean,
    private readonly fallback: GeneratedDocumentPort = new DeterministicGeneratedDocumentPort()
  ) {}

  async generate(input: DocumentGenerationContext & {
    accountId: string; candidateId: string;
    purpose: "TAILORED_RESUME" | "COVER_LETTER"; strength: GenerationStrength;
  }) {
    if (!this.allowPrivate) return this.fallback.generate(input);
    const taskType = input.purpose === "TAILORED_RESUME" ? "TAILOR_RESUME" : "GENERATE_COVER_LETTER";
    const request: AiRequest = {
      schemaVersion: 1,
      requestId: randomUUID(),
      idempotencyKey: `document:${createHash("sha256").update(JSON.stringify({
        taskType, sourceDocumentId: input.sourceDocumentId, jobId: input.jobId,
        applicationId: input.applicationId, strength: input.strength,
        claims: [...input.candidateClaims, ...input.jobClaims].map((claim) => claim.sourceId)
      })).digest("hex")}`,
      scope: {
        accountId: input.accountId,
        candidateId: input.candidateId,
        applicationId: input.applicationId
      },
      taskType,
      privacy: "DOCUMENT_PRIVATE_DATA",
      latencyPriority: "BACKGROUND",
      costPriority: "QUALITY",
      maxCostMicros: 100_000,
      maxOutputTokens: taskType === "TAILOR_RESUME" ? 8_000 : 4_000,
      minimumConfidence: 0.95,
      allowFallback: true,
      payload: {
        sourceDocumentId: input.sourceDocumentId,
        jobId: input.jobId,
        applicationId: input.applicationId,
        strength: input.strength,
        candidateClaims: input.candidateClaims.map((claim) => ({ ...claim, sourceType: "CANDIDATE_TRUTH" as const })),
        jobClaims: input.jobClaims.map((claim) => ({ ...claim, sourceType: "JOB_INTELLIGENCE" as const }))
      }
    };
    const result = await this.ai.execute(request);
    if (result.ok) {
      try {
        const draft = GeneratedDocumentOutputSchema.parse(result.value);
        // Validate at the provider boundary so a fluent but unsupported model
        // response falls back to the grounded deterministic draft. The service
        // validates again before persistence as a defense-in-depth check.
        return validateGroundedDraft(draft, input, input.purpose);
      } catch {
        return this.fallback.generate(input);
      }
    }
    return this.fallback.generate(input);
  }
}

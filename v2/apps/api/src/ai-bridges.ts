import { randomUUID, createHash } from "node:crypto";
import { AiError, ResumeAiOutputSchema, type AiPort, type AiRequest, type AiScope } from "@job-hunter-v2/ai";
import { FieldCanonicalizationAiUnavailableError, type FieldCanonicalizationAiPort } from "@job-hunter-v2/field-intelligence";
import type { EntityBindingAiPort } from "@job-hunter-v2/repeatable-entities";
import {
  DeterministicResumeCandidateExtractor,
  resumeEntityAnchorMatches,
  type ResumeCandidateExtractor,
  type ExtractedResumeProposal
} from "@job-hunter-v2/onboarding";

function metadata(scope: AiScope, key: string) {
  return { schemaVersion: 1 as const, requestId: randomUUID(), idempotencyKey: key, scope,
    latencyPriority: "INTERACTIVE" as const, costPriority: "ECONOMY" as const,
    maxCostMicros: 50_000, maxOutputTokens: 2_000, minimumConfidence: 0.72, allowFallback: true };
}
export function fieldAiBridge(ai: AiPort): FieldCanonicalizationAiPort {
  return { canonicalize: async (payload, context) => {
    if (!context) throw new FieldCanonicalizationAiUnavailableError();
    const result = await ai.execute({
      ...metadata(context, context.requestId + ":" + createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32)),
      // Copy only trusted scope fields; never spread a request's client metadata.
      scope: { accountId: context.accountId, candidateId: context.candidateId, applicationId: context.applicationId },
      taskType: "CANONICALIZE_FIELD", privacy: "FIELD_METADATA_ONLY", payload
    });
    if (!result.ok) throw new FieldCanonicalizationAiUnavailableError(result.error);
    return result.value;
  } };
}
export function entityAiBridge(ai: AiPort): EntityBindingAiPort {
  return { resolve: async (payload, context) => {
    if (!context) return null;
    const result = await ai.execute({
      ...metadata({ accountId: context.accountId, candidateId: context.candidateId, applicationId: null }, randomUUID()),
      minimumConfidence: 0.9, taskType: "DISAMBIGUATE_ENTITY", privacy: "CANDIDATE_PRIVATE_DATA", payload
    });
    return result.ok ? result.value : null;
  } };
}

/** Existing G parser remains first. P may supply grounded contact proposals only;
 * G's encryption, validation and review pipeline still owns all persistence. */
export class OrchestratedResumeCandidateExtractor implements ResumeCandidateExtractor {
  constructor(private readonly ai: AiPort, private readonly allowPrivate: boolean,
    private readonly deterministic: ResumeCandidateExtractor = new DeterministicResumeCandidateExtractor()) {}
  async extract(text: string, context?: { accountId: string; candidateId: string; documentId: string; extractionId: string }): Promise<readonly ExtractedResumeProposal[]> {
    const existing = await this.deterministic.extract(text);
    if (!this.allowPrivate || !context) return existing;
    const fields = [
      "FULL_NAME", "EMAIL", "PHONE", "CURRENT_LOCATION", "LINKEDIN_URL", "GITHUB_URL", "PORTFOLIO_URL",
      "SKILLS", "EMPLOYMENT_COMPANY", "EMPLOYMENT_TITLE", "EMPLOYMENT_DATE_RANGE", "EMPLOYMENT_LOCATION",
      "EMPLOYMENT_DESCRIPTION", "EMPLOYMENT_SKILLS", "EDUCATION_INSTITUTION", "EDUCATION_DEGREE",
      "EDUCATION_FIELD_OF_STUDY", "EDUCATION_DATE_RANGE", "EDUCATION_GRADE", "EDUCATION_LOCATION",
      "PROJECT_NAME", "PROJECT_DESCRIPTION", "PROJECT_TECHNOLOGIES", "PROJECT_DATE_RANGE", "PROJECT_URL",
      "CERTIFICATION_NAME", "CERTIFICATION_ISSUER", "CERTIFICATION_DATE", "CERTIFICATION_URL", "CERTIFICATION_KIND"
    ] as const;
    const request: AiRequest = {
      ...metadata({ accountId: context.accountId, candidateId: context.candidateId, applicationId: null }, context.extractionId),
      taskType: "EXTRACT_RESUME", privacy: "DOCUMENT_PRIVATE_DATA", minimumConfidence: 0.9,
      latencyPriority: "BACKGROUND", maxOutputTokens: 8_000, payload: { text, allowedFields: [...fields] }
    };
    const result = await this.ai.execute(request);
    if (!result.ok) {
      if (existing.length) return existing;
      throw new AiError(result.error);
    }
    const output = ResumeAiOutputSchema.parse(result.value);
    const urlKeys = new Set(["LINKEDIN_URL", "GITHUB_URL", "PORTFOLIO_URL", "PROJECT_URL", "CERTIFICATION_URL"]);
    const richTextKeys = new Set(["EMPLOYMENT_DESCRIPTION", "PROJECT_DESCRIPTION"]);
    const proposals: ExtractedResumeProposal[] = output.fields.flatMap((field) => {
      let normalizedValue: ExtractedResumeProposal["normalizedValue"];
      if (field.value.kind === "LIST") {
        normalizedValue = {
          schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "MULTI_ENUM",
          values: [...new Map(field.value.values.map((label) => [
            label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
            { key: label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), label }
          ])).values()]
        };
      } else if (field.value.kind === "DATE_RANGE") {
        normalizedValue = {
          schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "DATE_RANGE",
          start: field.value.start ? { isoDate: field.value.start, precision: field.value.precision } : null,
          end: field.value.end ? { isoDate: field.value.end, precision: field.value.precision } : null,
          current: field.value.current
        };
      } else if (field.value.kind === "DATE") {
        normalizedValue = {
          schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "DATE",
          value: { isoDate: field.value.value, precision: field.value.precision }
        };
      } else if (field.canonicalKey === "PHONE") {
        const digits = field.value.value.replace(/\D/g, "");
        if (digits.length !== 10 || !/^[6-9]/.test(digits)) return [];
        normalizedValue = { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "PHONE", countryCode: "+91", nationalNumber: digits, extension: null };
      } else if (urlKeys.has(field.canonicalKey)) {
        normalizedValue = { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "URL", value: /^https?:\/\//i.test(field.value.value) ? field.value.value : `https://${field.value.value}` };
      } else if (richTextKeys.has(field.canonicalKey)) {
        normalizedValue = { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "RICH_TEXT", value: field.value.value };
      } else if (field.canonicalKey === "CERTIFICATION_KIND") {
        const label = field.value.value.toUpperCase();
        normalizedValue = { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "ENUM", value: { key: label.toLowerCase(), label } };
      } else {
        normalizedValue = { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: field.value.value };
      }
      return [{
        itemKey: `p-${field.itemKey}`, canonicalKey: field.canonicalKey,
        entityType: field.entityType, entityGroupKey: field.entityGroupKey,
        normalizedValue, confidence: result.metadata.confidence,
        reasonCodes: ["AI_SOURCE_GROUNDED_PROPOSAL", "CANDIDATE_REVIEW_REQUIRED"],
        sourceSection: field.sourceSection, sourceEvidence: field.sourceQuote
      }];
    });

    const anchors: Record<string, readonly string[]> = {
      EMPLOYMENT: ["EMPLOYMENT_COMPANY", "EMPLOYMENT_TITLE", "EMPLOYMENT_DATE_RANGE"],
      EDUCATION: ["EDUCATION_INSTITUTION", "EDUCATION_DEGREE", "EDUCATION_DATE_RANGE"],
      PROJECT: ["PROJECT_NAME", "PROJECT_DATE_RANGE", "PROJECT_URL"],
      CERTIFICATION: ["CERTIFICATION_NAME", "CERTIFICATION_ISSUER", "CERTIFICATION_DATE"]
    };
    const valuesMatch = (canonicalKey: string, left: ExtractedResumeProposal, right: ExtractedResumeProposal) =>
      resumeEntityAnchorMatches(canonicalKey, left.normalizedValue, right.normalizedValue);
    const remapped = new Map<string, string>();
    for (const proposal of proposals) {
      if (!proposal.entityType || !proposal.entityGroupKey || remapped.has(`${proposal.entityType}:${proposal.entityGroupKey}`)) continue;
      const entityType = proposal.entityType;
      const entityGroupKey = proposal.entityGroupKey;
      const aiGroup = proposals.filter((item) => item.entityType === entityType && item.entityGroupKey === entityGroupKey);
      const matchingExistingGroups = [...new Set(existing.filter((item) => item.entityType === entityType).map((item) => item.entityGroupKey).filter(Boolean))]
        .map((group) => {
          const deterministicGroup = existing.filter((item) => item.entityType === entityType && item.entityGroupKey === group);
          const matches = (anchors[entityType] ?? []).filter((key: string) => {
            const left = aiGroup.find((item) => item.canonicalKey === key);
            const right = deterministicGroup.find((item) => item.canonicalKey === key);
            return Boolean(left && right && valuesMatch(key, left, right));
          }).length;
          return { group, matches };
        })
        // A single company name is not enough: one employer can contain several
        // separate roles. Two independent anchors uniquely bind the AI group.
        .filter((candidate) => candidate.matches >= 2);
      if (matchingExistingGroups.length === 1 && matchingExistingGroups[0]) {
        remapped.set(`${entityType}:${entityGroupKey}`, matchingExistingGroups[0].group as string);
      }
    }
    const enriched = proposals.map((proposal) => proposal.entityType && proposal.entityGroupKey
      ? { ...proposal, entityGroupKey: remapped.get(`${proposal.entityType}:${proposal.entityGroupKey}`) ?? proposal.entityGroupKey }
      : proposal);
    // Deterministic extraction is the primary source. AI enriches canonicals the
    // deterministic parser could not recover; it must not create a second value
    // for the same logical field in one review transaction.
    const deduplicated = enriched.filter((proposal) => !existing.some((item) =>
      item.canonicalKey === proposal.canonicalKey
      && item.entityType === proposal.entityType
      && item.entityGroupKey === proposal.entityGroupKey
    ));
    return [...existing, ...deduplicated];
  }
}

import { createHash, randomUUID } from "node:crypto";
import {
  DECLARATION_POLICY_VERSION,
  DeclarationClassificationSchema,
  DeclarationContextSchema,
  DeclarationPolicyDecisionSchema,
  type DeclarationAuthorization,
  type DeclarationClassification,
  type DeclarationContext,
  type DeclarationFailureCode,
  type DeclarationPolicyDecision,
  type DeclarationPolicyOutcome,
  type DeclarationType
} from "@job-hunter-v2/contracts";

const canonicalType = new Map<string, DeclarationType>([
  ["CERTIFY_INFORMATION_ACCURATE", "ACCURACY_CERTIFICATION"],
  ["PRIVACY_ACKNOWLEDGEMENT", "PRIVACY_ACKNOWLEDGEMENT"],
  ["TERMS_ACKNOWLEDGEMENT", "TERMS_ACKNOWLEDGEMENT"],
  ["BACKGROUND_CHECK_AUTHORIZATION", "BACKGROUND_CHECK_CONSENT"],
  ["DATA_PROCESSING_CONSENT", "DATA_PROCESSING_CONSENT"],
  ["APPLICANT_CERTIFICATION", "APPLICANT_CERTIFICATION"],
  ["EEO_ACKNOWLEDGEMENT", "EEO_ACKNOWLEDGEMENT"],
  ["APPLICATION_SPECIFIC_ACKNOWLEDGEMENT", "APPLICATION_SPECIFIC_ACKNOWLEDGEMENT"]
]);

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function materiality(type: DeclarationType): DeclarationClassification["materiality"] {
  if (type === "PRIVACY_ACKNOWLEDGEMENT") return "MEDIUM";
  return type === "UNKNOWN_DECLARATION" ? "HIGH" : "HIGH";
}

function reuseScope(type: DeclarationType): DeclarationClassification["reuseScope"] {
  if ([
    "PRIVACY_ACKNOWLEDGEMENT",
    "TERMS_ACKNOWLEDGEMENT",
    "BACKGROUND_CHECK_CONSENT",
    "DATA_PROCESSING_CONSENT"
  ].includes(type)) return "COMPANY_APPLICATION_SPECIFIC";
  return "APPLICATION_SPECIFIC";
}

function reviewStatus(outcome: DeclarationPolicyOutcome) {
  if (outcome === "PREPARE_FOR_REVIEW" || outcome === "AUTO_ALLOWED") return "REVIEW_BEFORE_SUBMIT" as const;
  if (outcome === "REQUIRES_EXPLICIT_USER_ACTION") return "NEEDS_CANDIDATE_ACTION" as const;
  if (outcome === "BLOCKED") return "BLOCKED" as const;
  return "UNRESOLVED" as const;
}

export function isDeclarationCanonicalKey(canonicalKey: string | null): boolean {
  return Boolean(canonicalKey && canonicalType.has(canonicalKey));
}

export class DeclarationPolicyEngine {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID
  ) {}

  classify(raw: DeclarationContext): DeclarationClassification {
    const context = DeclarationContextSchema.parse(raw);
    const declarationType = canonicalType.get(context.semantic.canonicalKey ?? "") ?? "UNKNOWN_DECLARATION";
    const canPrepare = declarationType === "ACCURACY_CERTIFICATION" || declarationType === "PRIVACY_ACKNOWLEDGEMENT";
    return DeclarationClassificationSchema.parse({
      schemaVersion: 1,
      fieldRuntimeId: context.fieldRuntimeId,
      descriptorFingerprint: context.semantic.descriptorFingerprint,
      declarationType,
      semanticConfidence: Math.min(context.semantic.confidence, context.semantic.declarationHint.confidence || context.semantic.confidence),
      sourceEvidence: context.semantic.declarationHint.sourceEvidence,
      textEvidence: context.semantic.declarationHint.textEvidence,
      reuseScope: reuseScope(declarationType),
      reusePolicy: "NEVER",
      materiality: materiality(declarationType),
      required: context.required,
      candidateReviewRequired: true,
      automaticInteractionAllowed: false,
      prepareForReviewAllowed: canPrepare,
      valuePrivate: true,
      containsCandidateValue: false
    });
  }

  decide(raw: DeclarationContext): DeclarationPolicyDecision {
    const context = DeclarationContextSchema.parse(raw);
    const classification = this.classify(context);
    let outcome: DeclarationPolicyOutcome;
    let failureCode: DeclarationFailureCode | null;
    let reasonCodes: string[];

    if (context.semantic.declarationHint.state === "NOT_DECLARATION") {
      outcome = "UNRESOLVED";
      failureCode = "DECLARATION_UNRESOLVED";
      reasonCodes = ["O_NOT_A_DECLARATION_CONTEXT"];
    } else if (classification.declarationType === "UNKNOWN_DECLARATION") {
      outcome = "UNRESOLVED";
      failureCode = "DECLARATION_POLICY_AMBIGUOUS";
      reasonCodes = ["O_AMBIGUOUS_DECLARATION_DEFAULT_SAFE"];
    } else if (!context.applicationId) {
      outcome = "BLOCKED";
      failureCode = "DECLARATION_CONTEXT_CHANGED";
      reasonCodes = ["O_APPLICATION_AUTHORITY_REQUIRED"];
    } else if (!context.visible || !context.enabled || !context.currentStep || context.disabled) {
      outcome = "BLOCKED";
      failureCode = "DECLARATION_POLICY_BLOCKED";
      reasonCodes = ["O_CONTROL_NOT_CURRENTLY_INTERACTABLE"];
    } else if (context.controlType !== "CHECKBOX") {
      outcome = "REQUIRES_EXPLICIT_USER_ACTION";
      failureCode = "DECLARATION_USER_ACTION_REQUIRED";
      reasonCodes = ["O_CONTROL_REQUIRES_CANDIDATE_CHOICE"];
    } else if (context.ownership === "USER_OWNED") {
      outcome = "REQUIRES_EXPLICIT_USER_ACTION";
      failureCode = "DECLARATION_MODIFIED_BY_USER";
      reasonCodes = ["O_CANDIDATE_OWNERSHIP_WINS"];
    } else if (
      context.semantic.state !== "RESOLVED_HIGH"
      || classification.semanticConfidence < 0.88
      || context.semantic.declarationHint.state !== "KNOWN_DECLARATION"
    ) {
      outcome = "REQUIRES_EXPLICIT_USER_ACTION";
      failureCode = "DECLARATION_POLICY_AMBIGUOUS";
      reasonCodes = ["O_HIGH_CONFIDENCE_DECLARATION_REQUIRED"];
    } else if (classification.textEvidence !== "FULL" || !context.materialTermsInspectable) {
      outcome = "REQUIRES_EXPLICIT_USER_ACTION";
      failureCode = "DECLARATION_TEXT_UNAVAILABLE";
      reasonCodes = ["O_MATERIAL_WORDING_NOT_INSPECTABLE"];
    } else if (classification.prepareForReviewAllowed && context.finalReviewGuaranteed) {
      outcome = "PREPARE_FOR_REVIEW";
      failureCode = null;
      reasonCodes = ["O_PREPARE_ONLY_WITH_FINAL_REVIEW"];
    } else {
      outcome = "REQUIRES_EXPLICIT_USER_ACTION";
      failureCode = "DECLARATION_USER_ACTION_REQUIRED";
      reasonCodes = ["O_MATERIAL_DECLARATION_CANDIDATE_OWNED"];
    }

    // Requiredness is evidence and UX context only. It is intentionally absent
    // from authorization branches, so a required declaration cannot escalate.
    const decisionFingerprint = hash({
      policyVersion: DECLARATION_POLICY_VERSION,
      outcome,
      declarationType: classification.declarationType,
      applicationId: context.applicationId,
      applicationRunId: context.applicationRunId,
      pageInstanceId: context.pageInstanceId,
      formInstanceId: context.formInstanceId,
      fieldRuntimeId: context.fieldRuntimeId,
      controlFingerprint: context.controlFingerprint,
      descriptorFingerprint: context.semantic.descriptorFingerprint,
      graphGuard: context.graphGuard,
      ownership: context.ownership,
      required: context.required,
      textEvidence: classification.textEvidence,
      finalReviewGuaranteed: context.finalReviewGuaranteed
    });
    const authorization: DeclarationAuthorization | null = outcome === "PREPARE_FOR_REVIEW"
      ? {
          schemaVersion: 1,
          authorizationId: this.newId(),
          decisionFingerprint,
          canonicalKey: context.semantic.canonicalKey as DeclarationAuthorization["canonicalKey"],
          declarationType: classification.declarationType as Exclude<DeclarationType, "UNKNOWN_DECLARATION">,
          policyVersion: DECLARATION_POLICY_VERSION,
          policyDecision: outcome,
          applicationRunId: context.applicationRunId,
          pageInstanceId: context.pageInstanceId,
          formInstanceId: context.formInstanceId,
          fieldRuntimeId: context.fieldRuntimeId,
          controlFingerprint: context.controlFingerprint,
          descriptorFingerprint: context.semantic.descriptorFingerprint,
          graphGuard: context.graphGuard,
          authorizedInteraction: "SET_TRUE",
          reviewRequirement: outcome === "PREPARE_FOR_REVIEW" ? "FINAL_REVIEW" : "NONE",
          valuePrivate: true,
          containsCandidateValue: false
        }
      : null;
    return DeclarationPolicyDecisionSchema.parse({
      schemaVersion: 1,
      policyVersion: DECLARATION_POLICY_VERSION,
      decisionFingerprint,
      evaluatedAt: this.now().toISOString(),
      outcome,
      failureCode,
      reasonCodes,
      classification,
      authorization,
      valuePrivate: true,
      containsCandidateValue: false
    });
  }

  reviewItem(context: DeclarationContext, decision: DeclarationPolicyDecision) {
    return {
      schemaVersion: 1 as const,
      decisionFingerprint: decision.decisionFingerprint,
      policyVersion: DECLARATION_POLICY_VERSION,
      declarationType: decision.classification.declarationType,
      policyDecision: decision.outcome,
      status: reviewStatus(decision.outcome),
      required: context.required,
      reviewRequired: decision.classification.candidateReviewRequired,
      applicationRunId: context.applicationRunId,
      pageInstanceId: context.pageInstanceId,
      formInstanceId: context.formInstanceId,
      fieldRuntimeId: context.fieldRuntimeId,
      controlFingerprint: context.controlFingerprint,
      descriptorFingerprint: context.semantic.descriptorFingerprint,
      graphGuard: context.graphGuard,
      semanticConfidence: decision.classification.semanticConfidence,
      failureCode: decision.failureCode,
      valuePrivate: true as const,
      containsCandidateValue: false as const
    };
  }
}

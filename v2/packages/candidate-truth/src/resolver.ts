import { UuidSchema } from "@job-hunter-v2/contracts";
import { type Clock, systemClock } from "@job-hunter-v2/domain";
import type { CandidateResolutionCandidate, CandidateTruthRepository } from "./candidate-truth-service.js";
import { evaluateAnswerFreshness, evaluateReviewTrialFreshness } from "./freshness.js";
import { normalizedValuesEqual, type PersistableNormalizedValue } from "./normalized-value.js";
import {
  candidateAnswerPolicy,
  type CandidateAnswerPolicy,
  type ScopeContextDimension
} from "./policy.js";
import {
  candidateScopeCompatible,
  candidateReviewScopeIsExact,
  compareCandidateScopeSpecificity,
  parseCandidateScopeContext,
  type CandidateAnswerScope,
  type CandidateScopeContext
} from "./scope.js";

export type CandidateTruthResolutionReasonCode =
  | "POLICY_REQUIRES_CURRENT_APPLICATION_ACTION"
  | "ENTITY_CONTEXT_REQUIRED"
  | "ENTITY_CONTEXT_NOT_ALLOWED"
  | "REQUIRED_SCOPE_CONTEXT_MISSING"
  | "NO_COMPATIBLE_CANDIDATE_TRUTH"
  | "CANDIDATE_TRUTH_POLICY_DRIFT"
  | "EQUAL_RANK_NON_EQUIVALENT_ANSWERS"
  | "NEEDS_RECONFIRMATION"
  | "REVIEW_ANSWER_NOT_TRIAL_REUSABLE"
  | "BEST_COMPATIBLE_SCOPE"
  | "TRIAL_REUSE_REVIEW_OVERRIDE"
  | "ANSWER_WITHIN_FRESHNESS_WINDOW"
  | "ANSWER_HAS_NO_EXPIRY";

export type CandidateTruthResolution =
  | {
      status: "MISSING";
      canonicalKey: string;
      reasonCodes: readonly ["NO_COMPATIBLE_CANDIDATE_TRUTH"];
    }
  | {
      status: "NEEDS_USER";
      canonicalKey: string;
      reasonCodes: readonly CandidateTruthResolutionReasonCode[];
      candidateVersionIds: readonly string[];
      suggestedAnswerVersionId?: string;
      missingContextDimension?: ScopeContextDimension | "ENTITY";
    }
  | {
      status: "RESOLVED";
      canonicalKey: string;
      answerVersionId: string;
      normalizedValue: PersistableNormalizedValue;
      scope: CandidateAnswerScope;
      trustState: "REVIEW" | "TRUSTED";
      trialReuse: boolean;
      requiresUserReview: boolean;
      autofillMode: CandidateAnswerPolicy["autofillMode"];
      expiresAt: string | null;
      reasonCodes: readonly CandidateTruthResolutionReasonCode[];
      candidateVersionIds: readonly string[];
    };

export interface ResolveCandidateTruthInput {
  accountId: string;
  candidateId: string;
  canonicalKey: string;
  entityId?: string | null;
  context?: CandidateScopeContext;
}

function contextValue(
  dimension: ScopeContextDimension,
  context: CandidateScopeContext
): string | undefined {
  if (dimension === "COUNTRY") return context.countryCode;
  if (dimension === "ROLE_FAMILY") return context.roleFamily;
  if (dimension === "COMPANY") return context.companyId;
  if (dimension === "JOB") return context.jobId;
  return context.applicationId;
}

function candidateVersionIds(candidates: readonly CandidateResolutionCandidate[]): string[] {
  return candidates.map((candidate) => candidate.answerVersionId).sort();
}

function mostRecent(candidates: readonly CandidateResolutionCandidate[]): CandidateResolutionCandidate {
  const sorted = [...candidates].sort((left, right) => {
    const leftTime = (left.confirmedAt ?? left.createdAt).getTime();
    const rightTime = (right.confirmedAt ?? right.createdAt).getTime();
    return rightTime - leftTime || right.answerVersionId.localeCompare(left.answerVersionId);
  });
  const selected = sorted[0];
  if (!selected) throw new Error("Cannot select a candidate answer from an empty collection.");
  return selected;
}

function resolvedResult(input: {
  canonicalKey: string;
  policy: CandidateAnswerPolicy;
  candidate: CandidateResolutionCandidate;
  best: readonly CandidateResolutionCandidate[];
  trialReuse: boolean;
  expiresAt: string | null;
  freshnessReason: "ANSWER_WITHIN_FRESHNESS_WINDOW" | "ANSWER_HAS_NO_EXPIRY";
}): CandidateTruthResolution {
  return {
    status: "RESOLVED",
    canonicalKey: input.canonicalKey,
    answerVersionId: input.candidate.answerVersionId,
    normalizedValue: input.candidate.normalizedValue,
    scope: input.candidate.scope,
    trustState: input.candidate.trustState as "REVIEW" | "TRUSTED",
    trialReuse: input.trialReuse,
    requiresUserReview: input.trialReuse || input.policy.autofillMode !== "AUTO",
    autofillMode: input.policy.autofillMode,
    expiresAt: input.expiresAt,
    reasonCodes: [
      "BEST_COMPATIBLE_SCOPE",
      ...(input.trialReuse ? (["TRIAL_REUSE_REVIEW_OVERRIDE"] as const) : []),
      input.freshnessReason
    ],
    candidateVersionIds: candidateVersionIds(input.best)
  };
}

/**
 * Resolves reusable candidate truth from one bounded current-projection read.
 * A more-specific conflict, stale value, or non-reusable REVIEW value blocks
 * broader fallback and asks the candidate instead.
 */
export class CandidateTruthResolver {
  constructor(
    private readonly repository: Pick<CandidateTruthRepository, "listCurrentCandidates">,
    private readonly clock: Clock = systemClock
  ) {}

  async resolve(input: ResolveCandidateTruthInput): Promise<CandidateTruthResolution> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const canonicalKey = input.canonicalKey.trim().toUpperCase();
    const policy = candidateAnswerPolicy(canonicalKey);
    const context = parseCandidateScopeContext(input.context);
    const entityId = input.entityId ? UuidSchema.parse(input.entityId) : null;

    if (
      !["AUTO", "REVIEW"].includes(policy.reuseMode) ||
      !["AUTO_VERSION", "REVIEW_TO_SAVE"].includes(policy.learningMode) ||
      policy.autofillMode === "FORBIDDEN"
    ) {
      return {
        status: "NEEDS_USER",
        canonicalKey,
        reasonCodes: ["POLICY_REQUIRES_CURRENT_APPLICATION_ACTION"],
        candidateVersionIds: []
      };
    }
    if (policy.entityType && !entityId) {
      return {
        status: "NEEDS_USER",
        canonicalKey,
        reasonCodes: ["ENTITY_CONTEXT_REQUIRED"],
        candidateVersionIds: [],
        missingContextDimension: "ENTITY"
      };
    }
    if (!policy.entityType && entityId) {
      return {
        status: "NEEDS_USER",
        canonicalKey,
        reasonCodes: ["ENTITY_CONTEXT_NOT_ALLOWED"],
        candidateVersionIds: []
      };
    }
    const missingContext = policy.requiredContextDimensions.find(
      (dimension) => !contextValue(dimension, context)
    );
    if (missingContext) {
      return {
        status: "NEEDS_USER",
        canonicalKey,
        reasonCodes: ["REQUIRED_SCOPE_CONTEXT_MISSING"],
        candidateVersionIds: [],
        missingContextDimension: missingContext
      };
    }

    const current = await this.repository.listCurrentCandidates({
      accountId,
      candidateId,
      canonicalKey,
      entityId,
      context
    });
    const policyDrift = current.filter(
      (candidate) => !policy.allowedScopeTypes.includes(candidate.scope.scopeType)
    );
    if (policyDrift.length > 0) {
      return {
        status: "NEEDS_USER",
        canonicalKey,
        reasonCodes: ["CANDIDATE_TRUTH_POLICY_DRIFT"],
        candidateVersionIds: candidateVersionIds(policyDrift)
      };
    }
    const compatible = current.filter(
      (candidate) =>
        candidate.trustState !== "REMOVED" && candidateScopeCompatible(candidate.scope, context)
    );
    if (compatible.length === 0) {
      return {
        status: "MISSING",
        canonicalKey,
        reasonCodes: ["NO_COMPATIBLE_CANDIDATE_TRUTH"]
      };
    }

    const ranked = [...compatible].sort((left, right) =>
      compareCandidateScopeSpecificity(right.scope, left.scope)
    );
    const bestScope = ranked[0]?.scope;
    if (!bestScope) throw new Error("Candidate truth ranking unexpectedly produced no best scope.");
    const best = ranked.filter(
      (candidate) => compareCandidateScopeSpecificity(candidate.scope, bestScope) === 0
    );
    const first = best[0];
    if (!first) throw new Error("Candidate truth ranking unexpectedly produced an empty best rank.");
    if (!best.every((candidate) => normalizedValuesEqual(first.normalizedValue, candidate.normalizedValue))) {
      return {
        status: "NEEDS_USER",
        canonicalKey,
        reasonCodes: ["EQUAL_RANK_NON_EQUIVALENT_ANSWERS"],
        candidateVersionIds: candidateVersionIds(best)
      };
    }

    const evaluatedAt = this.clock.now();
    const freshTrusted = best.filter((candidate) => {
      if (candidate.trustState !== "TRUSTED") return false;
      return evaluateAnswerFreshness({
        trustState: candidate.trustState,
        confirmedAt: candidate.confirmedAt,
        freshnessDays: policy.freshnessDays,
        evaluatedAt
      }).reusable;
    });
    if (freshTrusted.length > 0) {
      const selected = mostRecent(freshTrusted);
      const freshness = evaluateAnswerFreshness({
        trustState: selected.trustState,
        confirmedAt: selected.confirmedAt,
        freshnessDays: policy.freshnessDays,
        evaluatedAt
      });
      if (freshness.state !== "FRESH") {
        throw new Error("Reusable trusted candidate truth did not remain fresh during one resolution.");
      }
      return resolvedResult({
        canonicalKey,
        policy,
        candidate: selected,
        best,
        trialReuse: false,
        expiresAt: freshness.expiresAt,
        freshnessReason:
          freshness.reason === "NO_EXPIRY"
            ? "ANSWER_HAS_NO_EXPIRY"
            : "ANSWER_WITHIN_FRESHNESS_WINDOW"
      });
    }

    const trialReviews = best.filter((candidate) => {
      if (candidate.trustState !== "REVIEW" || policy.reviewReuse !== "EXACT_SCOPE_TRIAL") return false;
      if (candidate.source !== "USER_MANUAL" && candidate.source !== "USER_CORRECTION") return false;
      if (!candidateReviewScopeIsExact(policy, candidate.scope, context)) return false;
      return evaluateReviewTrialFreshness({
        confirmedAt: candidate.confirmedAt,
        freshnessDays: policy.freshnessDays,
        evaluatedAt
      }).reusable;
    });
    if (trialReviews.length > 0) {
      const selected = mostRecent(trialReviews);
      const freshness = evaluateReviewTrialFreshness({
        confirmedAt: selected.confirmedAt,
        freshnessDays: policy.freshnessDays,
        evaluatedAt
      });
      return resolvedResult({
        canonicalKey,
        policy,
        candidate: selected,
        best,
        trialReuse: true,
        expiresAt: freshness.expiresAt,
        freshnessReason:
          freshness.expiresAt === null
            ? "ANSWER_HAS_NO_EXPIRY"
            : "ANSWER_WITHIN_FRESHNESS_WINDOW"
      });
    }

    const selected = mostRecent(best);
    const hasExpired = best.some((candidate) => {
      if (candidate.trustState === "TRUSTED") {
        return (
          evaluateAnswerFreshness({
            trustState: candidate.trustState,
            confirmedAt: candidate.confirmedAt,
            freshnessDays: policy.freshnessDays,
            evaluatedAt
          }).state === "STALE"
        );
      }
      return (
        candidate.trustState === "REVIEW" &&
        !evaluateReviewTrialFreshness({
          confirmedAt: candidate.confirmedAt,
          freshnessDays: policy.freshnessDays,
          evaluatedAt
        }).reusable &&
        candidate.confirmedAt !== null
      );
    });
    return {
      status: "NEEDS_USER",
      canonicalKey,
      reasonCodes: [
        hasExpired ? "NEEDS_RECONFIRMATION" : "REVIEW_ANSWER_NOT_TRIAL_REUSABLE"
      ],
      candidateVersionIds: candidateVersionIds(best),
      suggestedAnswerVersionId: selected.answerVersionId
    };
  }
}

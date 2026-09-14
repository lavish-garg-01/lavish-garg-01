import { evaluateAnswerFreshness } from "./freshness.js";
import { normalizedValuesEqual } from "./normalized-value.js";
import type { CandidateAnswerPolicy } from "./policy.js";
import {
  candidateScopeCompatible,
  compareCandidateScopeSpecificity,
  type CandidateScopeContext
} from "./scope.js";
import type { CandidateResolutionCandidate } from "./candidate-truth-service.js";

export type RedundantOverrideRemovalReason =
  | "POLICY_DOES_NOT_PERMIT_INHERITANCE"
  | "OVERRIDE_IS_NOT_CURRENT"
  | "OVERRIDE_SCOPE_MISMATCH"
  | "OVERRIDE_IS_NOT_CONTEXTUAL"
  | "POLICY_SCOPE_DRIFT"
  | "NO_BROADER_CANDIDATE_TRUTH"
  | "EQUAL_RANK_BROADER_CONFLICT"
  | "INHERITED_ANSWER_IS_NOT_NEAREST"
  | "INHERITED_SCOPE_MISMATCH"
  | "INHERITED_ANSWER_IS_NOT_TRUSTED"
  | "INHERITED_ANSWER_IS_STALE"
  | "OVERRIDE_VALUE_DIFFERS_FROM_INHERITED_TRUTH";

export type RedundantOverrideRemovalPlan =
  | {
      ok: true;
      override: CandidateResolutionCandidate;
      inherited: CandidateResolutionCandidate;
    }
  | {
      ok: false;
      reason: RedundantOverrideRemovalReason;
      candidateVersionIds: readonly string[];
    };

function versionIds(candidates: readonly CandidateResolutionCandidate[]): string[] {
  return candidates.map((candidate) => candidate.answerVersionId).sort();
}

/**
 * Proves that one exact contextual answer can safely inherit the nearest
 * broader truth. This function is value-aware inside the trusted domain only;
 * its command and failure contract never expose candidate values.
 */
export function planRedundantOverrideRemoval(input: {
  policy: CandidateAnswerPolicy;
  candidates: readonly CandidateResolutionCandidate[];
  context: CandidateScopeContext;
  overrideAnswerVersionId: string;
  overrideScopeFingerprint: string;
  inheritedAnswerVersionId: string;
  inheritedScopeFingerprint: string;
  evaluatedAt: Date;
}): RedundantOverrideRemovalPlan {
  const inheritanceAllowed =
    ["AUTO", "REVIEW"].includes(input.policy.reuseMode) &&
    ["AUTO_VERSION", "REVIEW_TO_SAVE"].includes(input.policy.learningMode) &&
    input.policy.allowedScopeTypes.length > 1;
  if (!inheritanceAllowed) {
    return {
      ok: false,
      reason: "POLICY_DOES_NOT_PERMIT_INHERITANCE",
      candidateVersionIds: []
    };
  }

  const override = input.candidates.find(
    (candidate) => candidate.answerVersionId === input.overrideAnswerVersionId
  );
  if (!override) {
    return { ok: false, reason: "OVERRIDE_IS_NOT_CURRENT", candidateVersionIds: [] };
  }
  if (override.scope.scopeFingerprint !== input.overrideScopeFingerprint) {
    return {
      ok: false,
      reason: "OVERRIDE_SCOPE_MISMATCH",
      candidateVersionIds: [override.answerVersionId]
    };
  }
  if (override.scope.scopeType === "GLOBAL") {
    return {
      ok: false,
      reason: "OVERRIDE_IS_NOT_CONTEXTUAL",
      candidateVersionIds: [override.answerVersionId]
    };
  }
  if (
    !input.policy.allowedScopeTypes.includes(override.scope.scopeType) ||
    !candidateScopeCompatible(override.scope, input.context)
  ) {
    return {
      ok: false,
      reason: "POLICY_SCOPE_DRIFT",
      candidateVersionIds: [override.answerVersionId]
    };
  }

  const policyDrift = input.candidates.filter(
    (candidate) =>
      candidate.trustState !== "REMOVED" &&
      candidateScopeCompatible(candidate.scope, input.context) &&
      !input.policy.allowedScopeTypes.includes(candidate.scope.scopeType)
  );
  if (policyDrift.length > 0) {
    return {
      ok: false,
      reason: "POLICY_SCOPE_DRIFT",
      candidateVersionIds: versionIds(policyDrift)
    };
  }

  const broader = input.candidates.filter(
    (candidate) =>
      candidate.trustState !== "REMOVED" &&
      input.policy.allowedScopeTypes.includes(candidate.scope.scopeType) &&
      candidateScopeCompatible(candidate.scope, input.context) &&
      compareCandidateScopeSpecificity(override.scope, candidate.scope) > 0
  );
  if (broader.length === 0) {
    return {
      ok: false,
      reason: "NO_BROADER_CANDIDATE_TRUTH",
      candidateVersionIds: []
    };
  }

  const ranked = [...broader].sort((left, right) =>
    compareCandidateScopeSpecificity(right.scope, left.scope)
  );
  const nearestScope = ranked[0]?.scope;
  if (!nearestScope) throw new Error("Broader candidate ranking unexpectedly produced no scope.");
  const nearest = ranked.filter(
    (candidate) => compareCandidateScopeSpecificity(candidate.scope, nearestScope) === 0
  );
  const first = nearest[0];
  if (!first) throw new Error("Broader candidate ranking unexpectedly produced an empty rank.");
  if (
    !nearest.every((candidate) =>
      normalizedValuesEqual(first.normalizedValue, candidate.normalizedValue)
    )
  ) {
    return {
      ok: false,
      reason: "EQUAL_RANK_BROADER_CONFLICT",
      candidateVersionIds: versionIds(nearest)
    };
  }

  const inherited = nearest.find(
    (candidate) => candidate.answerVersionId === input.inheritedAnswerVersionId
  );
  if (!inherited) {
    return {
      ok: false,
      reason: "INHERITED_ANSWER_IS_NOT_NEAREST",
      candidateVersionIds: versionIds(nearest)
    };
  }
  if (inherited.scope.scopeFingerprint !== input.inheritedScopeFingerprint) {
    return {
      ok: false,
      reason: "INHERITED_SCOPE_MISMATCH",
      candidateVersionIds: [inherited.answerVersionId]
    };
  }
  if (inherited.trustState !== "TRUSTED") {
    return {
      ok: false,
      reason: "INHERITED_ANSWER_IS_NOT_TRUSTED",
      candidateVersionIds: [inherited.answerVersionId]
    };
  }
  const freshness = evaluateAnswerFreshness({
    trustState: inherited.trustState,
    confirmedAt: inherited.confirmedAt,
    freshnessDays: input.policy.freshnessDays,
    evaluatedAt: input.evaluatedAt
  });
  if (!freshness.reusable) {
    return {
      ok: false,
      reason: "INHERITED_ANSWER_IS_STALE",
      candidateVersionIds: [inherited.answerVersionId]
    };
  }
  if (!normalizedValuesEqual(override.normalizedValue, inherited.normalizedValue)) {
    return {
      ok: false,
      reason: "OVERRIDE_VALUE_DIFFERS_FROM_INHERITED_TRUTH",
      candidateVersionIds: [override.answerVersionId, inherited.answerVersionId].sort()
    };
  }

  return { ok: true, override, inherited };
}

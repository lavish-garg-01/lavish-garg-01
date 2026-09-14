import assert from "node:assert/strict";
import test from "node:test";
import {
  PersistableNormalizedValueSchema,
  candidateAnswerPolicy,
  planRedundantOverrideRemoval,
  resolveCandidateAnswerScope,
  type CandidateAnswerScope,
  type CandidateResolutionCandidate,
  type CandidateScopeContext
} from "./index.js";

const now = new Date("2026-09-01T12:00:00.000Z");
const companyId = "31000000-0000-4000-8000-000000000001";
const jobId = "31000000-0000-4000-8000-000000000002";
const context = { countryCode: "IN", roleFamily: "BACKEND", companyId, jobId } as const;
const privateValue = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };

function money(amountExact: string) {
  return PersistableNormalizedValueSchema.parse({
    ...privateValue,
    kind: "MONEY",
    amountExact,
    currency: "INR",
    period: "YEAR"
  });
}

function scope(
  scopeType: CandidateAnswerScope["scopeType"],
  scopeContext: CandidateScopeContext = context
) {
  const resolved = resolveCandidateAnswerScope({
    policy: candidateAnswerPolicy("EXPECTED_CTC"),
    scopeType,
    context: scopeContext
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) throw new Error("Expected test scope to resolve.");
  return resolved.scope;
}

function candidate(input: {
  id: string;
  amount: string;
  scope: CandidateAnswerScope;
  trustState?: CandidateResolutionCandidate["trustState"];
  confirmedAt?: Date | null;
}): CandidateResolutionCandidate {
  return {
    answerVersionId: input.id,
    normalizedValue: money(input.amount),
    scope: input.scope,
    trustState: input.trustState ?? "TRUSTED",
    source: "USER_CORRECTION",
    confirmedAt:
      input.confirmedAt === undefined
        ? new Date("2026-08-20T00:00:00.000Z")
        : input.confirmedAt,
    createdAt: new Date("2026-08-20T00:00:00.000Z")
  };
}

function plan(input: {
  candidates: readonly CandidateResolutionCandidate[];
  override: CandidateResolutionCandidate;
  inherited: CandidateResolutionCandidate;
}) {
  return planRedundantOverrideRemoval({
    policy: candidateAnswerPolicy("EXPECTED_CTC"),
    candidates: input.candidates,
    context,
    overrideAnswerVersionId: input.override.answerVersionId,
    overrideScopeFingerprint: input.override.scope.scopeFingerprint,
    inheritedAnswerVersionId: input.inherited.answerVersionId,
    inheritedScopeFingerprint: input.inherited.scope.scopeFingerprint,
    evaluatedAt: now
  });
}

test("redundant override planner selects the nearest broader truth and ignores children", () => {
  const global = candidate({ id: "global", amount: "2500000", scope: scope("GLOBAL") });
  const search = candidate({ id: "search", amount: "2500000", scope: scope("SEARCH") });
  const company = candidate({ id: "company", amount: "2500000", scope: scope("COMPANY") });
  const childJob = candidate({ id: "job", amount: "3000000", scope: scope("JOB") });
  const result = plan({ candidates: [global, search, company, childJob], override: company, inherited: search });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.inherited.answerVersionId : null, "search");
});

test("redundant override planner compares exact decimals semantically", () => {
  const global = candidate({ id: "global", amount: "2500000.00", scope: scope("GLOBAL") });
  const search = candidate({ id: "search", amount: "2500000", scope: scope("SEARCH") });
  const result = plan({ candidates: [global, search], override: search, inherited: global });
  assert.equal(result.ok, true);
});

test("redundant override planner fails closed on stale or REVIEW broader truth", () => {
  const search = candidate({ id: "search", amount: "2500000", scope: scope("SEARCH") });
  const stale = candidate({
    id: "stale-global",
    amount: "2500000",
    scope: scope("GLOBAL"),
    confirmedAt: new Date("2026-01-01T00:00:00.000Z")
  });
  const staleResult = plan({ candidates: [stale, search], override: search, inherited: stale });
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.ok ? null : staleResult.reason, "INHERITED_ANSWER_IS_STALE");

  const review = candidate({
    id: "review-global",
    amount: "2500000",
    scope: scope("GLOBAL"),
    trustState: "REVIEW"
  });
  const reviewResult = plan({ candidates: [review, search], override: search, inherited: review });
  assert.equal(reviewResult.ok, false);
  assert.equal(reviewResult.ok ? null : reviewResult.reason, "INHERITED_ANSWER_IS_NOT_TRUSTED");
});

test("redundant override planner rejects conflicts, different values, and a non-nearest ancestor", () => {
  const global = candidate({ id: "global", amount: "2500000", scope: scope("GLOBAL") });
  const countrySearch = candidate({
    id: "country-search",
    amount: "2500000",
    scope: scope("SEARCH", { countryCode: "IN" })
  });
  const roleSearch = candidate({
    id: "role-search",
    amount: "2600000",
    scope: scope("SEARCH", { roleFamily: "BACKEND" })
  });
  const company = candidate({ id: "company", amount: "2500000", scope: scope("COMPANY") });
  const conflict = plan({
    candidates: [global, countrySearch, roleSearch, company],
    override: company,
    inherited: countrySearch
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.ok ? null : conflict.reason, "EQUAL_RANK_BROADER_CONFLICT");

  const nonNearest = plan({
    candidates: [global, countrySearch, company],
    override: company,
    inherited: global
  });
  assert.equal(nonNearest.ok, false);
  assert.equal(nonNearest.ok ? null : nonNearest.reason, "INHERITED_ANSWER_IS_NOT_NEAREST");

  const differentCompany = candidate({
    id: "different-company",
    amount: "2700000",
    scope: scope("COMPANY")
  });
  const different = plan({
    candidates: [global, differentCompany],
    override: differentCompany,
    inherited: global
  });
  assert.equal(different.ok, false);
  assert.equal(
    different.ok ? null : different.reason,
    "OVERRIDE_VALUE_DIFFERS_FROM_INHERITED_TRUTH"
  );
});

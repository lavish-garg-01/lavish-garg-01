import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CandidateTruthResolver,
  PersistableNormalizedValueSchema,
  SCOPE_PRECEDENCE,
  candidateAnswerPolicy,
  resolveCandidateAnswerScope,
  type CandidateAnswerScope,
  type CandidateResolutionCandidate,
  type CandidateTruthRepository,
  type PersistableNormalizedValue
} from "./index.js";

const accountId = "30000000-0000-4000-8000-000000000001";
const candidateId = "30000000-0000-4000-8000-000000000002";
const companyId = "30000000-0000-4000-8000-000000000003";
const jobId = "30000000-0000-4000-8000-000000000004";
const entityId = "30000000-0000-4000-8000-000000000005";
const now = new Date("2026-09-01T12:00:00.000Z");
const privateValue = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };

function money(amountExact: string): PersistableNormalizedValue {
  return PersistableNormalizedValueSchema.parse({
    ...privateValue,
    kind: "MONEY",
    amountExact,
    currency: "INR",
    period: "YEAR"
  });
}

function stringValue(value: string): PersistableNormalizedValue {
  return { ...privateValue, kind: "STRING", value };
}

function scope(
  canonicalKey: string,
  scopeType: CandidateAnswerScope["scopeType"],
  context: Parameters<typeof resolveCandidateAnswerScope>[0]["context"] = {}
): CandidateAnswerScope {
  const resolution = resolveCandidateAnswerScope({
    policy: candidateAnswerPolicy(canonicalKey),
    scopeType,
    context
  });
  assert.equal(resolution.ok, true);
  if (!resolution.ok) throw new Error("Test scope failed to resolve.");
  return resolution.scope;
}

function manualSearchScope(context: { countryCode?: string; roleFamily?: string }): CandidateAnswerScope {
  const components = ["scope=SEARCH"];
  if (context.countryCode) components.push(`country=${context.countryCode}`);
  if (context.roleFamily) components.push(`role=${context.roleFamily}`);
  const scopeKey = components.join("|");
  return {
    scopeType: "SEARCH",
    ...context,
    scopeKey,
    scopeFingerprint: createHash("sha256").update(scopeKey).digest("hex"),
    precedence: SCOPE_PRECEDENCE.SEARCH
  };
}

function candidate(input: {
  id: string;
  value: PersistableNormalizedValue;
  scope: CandidateAnswerScope;
  trustState?: CandidateResolutionCandidate["trustState"];
  source?: CandidateResolutionCandidate["source"];
  confirmedAt?: Date | null;
}): CandidateResolutionCandidate {
  return {
    answerVersionId: input.id,
    normalizedValue: input.value,
    scope: input.scope,
    trustState: input.trustState ?? "TRUSTED",
    source: input.source ?? "USER_MANUAL",
    confirmedAt: input.confirmedAt === undefined ? new Date("2026-08-20T00:00:00.000Z") : input.confirmedAt,
    createdAt: new Date("2026-08-20T00:00:00.000Z")
  };
}

function resolverWith(candidates: readonly CandidateResolutionCandidate[]) {
  const calls: Parameters<CandidateTruthRepository["listCurrentCandidates"]>[0][] = [];
  const repository: Pick<CandidateTruthRepository, "listCurrentCandidates"> = {
    listCurrentCandidates: async (input) => {
      calls.push(input);
      return candidates;
    }
  };
  return {
    resolver: new CandidateTruthResolver(repository, { now: () => now }),
    calls
  };
}

test("ordinary work-mode answers fall back globally and an explicit job answer wins", async () => {
  const global = candidate({ id: "global", value: { ...privateValue, kind: "BOOLEAN", value: true }, scope: scope("WORK_MODE_REQUIREMENT", "GLOBAL") });
  const specific = candidate({ id: "specific", value: { ...privateValue, kind: "BOOLEAN", value: false }, scope: scope("WORK_MODE_REQUIREMENT", "JOB", { jobId }) });
  const fallback = await resolverWith([global]).resolver.resolve({ accountId, candidateId, canonicalKey: "WORK_MODE_REQUIREMENT", context: { jobId } });
  assert.equal(fallback.status, "RESOLVED");
  const override = await resolverWith([global, specific]).resolver.resolve({ accountId, candidateId, canonicalKey: "WORK_MODE_REQUIREMENT", context: { jobId } });
  assert.equal(override.status, "RESOLVED");
  if (override.status === "RESOLVED") assert.equal(override.answerVersionId, "specific");
});

test("resolver avoids storage for current-application policies and missing required context", async () => {
  const blocked = resolverWith([]);
  const applicationOnly = await blocked.resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "PRIVACY_ACKNOWLEDGEMENT"
  });
  assert.equal(applicationOnly.status, "NEEDS_USER");
  assert.deepEqual(applicationOnly.reasonCodes, ["POLICY_REQUIRES_CURRENT_APPLICATION_ACTION"]);

  const missingCountry = await blocked.resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "WORK_AUTHORIZATION"
  });
  assert.equal(missingCountry.status, "NEEDS_USER");
  assert.deepEqual(missingCountry.reasonCodes, ["REQUIRED_SCOPE_CONTEXT_MISSING"]);
  assert.equal(blocked.calls.length, 0);
});

test("resolver selects the most-specific compatible current answer", async () => {
  const global = candidate({ id: "global", value: money("2000000"), scope: scope("EXPECTED_CTC", "GLOBAL") });
  const search = candidate({
    id: "search",
    value: money("2200000"),
    scope: scope("EXPECTED_CTC", "SEARCH", { countryCode: "IN", roleFamily: "BACKEND" })
  });
  const company = candidate({
    id: "company",
    value: money("2500000"),
    scope: scope("EXPECTED_CTC", "COMPANY", { companyId, countryCode: "IN", roleFamily: "BACKEND" })
  });
  const { resolver, calls } = resolverWith([global, search, company]);
  const result = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: { companyId, jobId, countryCode: "IN", roleFamily: "BACKEND" }
  });
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.status === "RESOLVED" ? result.answerVersionId : null, "company");
  assert.equal(result.status === "RESOLVED" ? result.trialReuse : null, false);
  assert.equal(calls.length, 1, "resolution performs one current-projection repository read");
});

test("a stale more-specific answer blocks a fresh broad fallback", async () => {
  const global = candidate({ id: "fresh-global", value: money("2000000"), scope: scope("EXPECTED_CTC", "GLOBAL") });
  const staleCompany = candidate({
    id: "stale-company",
    value: money("2500000"),
    scope: scope("EXPECTED_CTC", "COMPANY", { companyId }),
    confirmedAt: new Date("2026-01-01T00:00:00.000Z")
  });
  const { resolver } = resolverWith([global, staleCompany]);
  const result = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: { companyId }
  });
  assert.equal(result.status, "NEEDS_USER");
  assert.deepEqual(result.reasonCodes, ["NEEDS_RECONFIRMATION"]);
  assert.equal(result.status === "NEEDS_USER" ? result.suggestedAnswerVersionId : null, "stale-company");
});

test("an exact REVIEW answer expires at the boundary and requires reconfirmation", async () => {
  const confirmedAt = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000);
  const expiredReview = candidate({
    id: "expired-review",
    value: money("2800000"),
    scope: scope("EXPECTED_CTC", "COMPANY", { companyId }),
    trustState: "REVIEW",
    confirmedAt
  });
  const { resolver } = resolverWith([expiredReview]);
  const result = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: { companyId }
  });
  assert.equal(result.status, "NEEDS_USER");
  assert.deepEqual(result.reasonCodes, ["NEEDS_RECONFIRMATION"]);
});

test("exact contextual REVIEW values trial-reuse, while a provisional global fallback does not", async () => {
  const companyReview = candidate({
    id: "company-review",
    value: money("2800000"),
    scope: scope("EXPECTED_CTC", "COMPANY", { companyId, countryCode: "IN", roleFamily: "BACKEND" }),
    trustState: "REVIEW"
  });
  const exact = resolverWith([companyReview]);
  const exactResult = await exact.resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: { companyId, jobId, countryCode: "IN", roleFamily: "BACKEND" }
  });
  assert.equal(exactResult.status, "RESOLVED");
  assert.equal(exactResult.status === "RESOLVED" ? exactResult.trialReuse : null, true);
  assert.equal(exactResult.status === "RESOLVED" ? exactResult.requiresUserReview : null, true);

  const globalReview = candidate({
    id: "global-review",
    value: money("2400000"),
    scope: scope("EXPECTED_CTC", "GLOBAL"),
    trustState: "REVIEW"
  });
  const fallback = resolverWith([globalReview]);
  const fallbackResult = await fallback.resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: { companyId, countryCode: "IN", roleFamily: "BACKEND" }
  });
  assert.equal(fallbackResult.status, "NEEDS_USER");
  assert.deepEqual(fallbackResult.reasonCodes, ["REVIEW_ANSWER_NOT_TRIAL_REUSABLE"]);
});

test("an exact REVIEW answer from a direct USER_CORRECTION source trial-reuses", async () => {
  const review = candidate({
    id: "direct-correction-review",
    value: money("2800000"),
    scope: scope("EXPECTED_CTC", "COMPANY", { companyId }),
    trustState: "REVIEW",
    source: "USER_CORRECTION"
  });
  const { resolver } = resolverWith([review]);
  const result = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: { companyId }
  });
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.status === "RESOLVED" ? result.trialReuse : null, true);
});

test("an exact REVIEW answer from a non-direct source is not trial-reused", async () => {
  for (const source of ["PROFILE", "VERIFIED_RESUME", "DERIVED", "USER_ACCEPTED_REUSE"] as const) {
    const review = candidate({
      id: `non-direct-${source.toLowerCase()}`,
      value: money("2800000"),
      scope: scope("EXPECTED_CTC", "COMPANY", { companyId }),
      trustState: "REVIEW",
      source
    });
    const { resolver } = resolverWith([review]);
    const result = await resolver.resolve({
      accountId,
      candidateId,
      canonicalKey: "EXPECTED_CTC",
      context: { companyId }
    });
    assert.equal(result.status, "NEEDS_USER", source);
    assert.deepEqual(result.reasonCodes, ["REVIEW_ANSWER_NOT_TRIAL_REUSABLE"], source);
  }
});

test("global REVIEW remains an exact trial when the policy has no contextual override scopes", async () => {
  const legalReview = candidate({
    id: "age-review",
    value: { ...privateValue, kind: "BOOLEAN", value: true },
    scope: scope("AGE_OVER_18", "GLOBAL"),
    trustState: "REVIEW"
  });
  const { resolver } = resolverWith([legalReview]);
  const result = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "AGE_OVER_18",
    context: { companyId, countryCode: "IN" }
  });
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.status === "RESOLVED" ? result.trialReuse : null, true);
  assert.equal(result.status === "RESOLVED" ? result.requiresUserReview : null, true);
});

test("equal-rank non-equivalent answers fail closed without exposing their values", async () => {
  const country = candidate({
    id: "country-answer",
    value: money("2000000"),
    scope: manualSearchScope({ countryCode: "IN" })
  });
  const role = candidate({
    id: "role-answer",
    value: money("3000000"),
    scope: manualSearchScope({ roleFamily: "BACKEND" })
  });
  const { resolver } = resolverWith([country, role]);
  const result = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: { countryCode: "IN", roleFamily: "BACKEND" }
  });
  assert.equal(result.status, "NEEDS_USER");
  assert.deepEqual(result.reasonCodes, ["EQUAL_RANK_NON_EQUIVALENT_ANSWERS"]);
  assert.deepEqual(result.status === "NEEDS_USER" ? result.candidateVersionIds : [], [
    "country-answer",
    "role-answer"
  ]);
  assert.doesNotMatch(JSON.stringify(result), /2000000|3000000/);
});

test("semantically equivalent equal-rank answers resolve only after equality is established", async () => {
  const country = candidate({
    id: "country-equivalent",
    value: money("2400000.00"),
    scope: manualSearchScope({ countryCode: "IN" })
  });
  const role = candidate({
    id: "role-equivalent",
    value: money("2400000"),
    scope: manualSearchScope({ roleFamily: "BACKEND" })
  });
  const { resolver } = resolverWith([country, role]);
  const result = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: { countryCode: "IN", roleFamily: "BACKEND" }
  });
  assert.equal(result.status, "RESOLVED");
  assert.deepEqual(result.status === "RESOLVED" ? result.candidateVersionIds : [], [
    "country-equivalent",
    "role-equivalent"
  ]);
});

test("more-qualified same-type truth outranks single-qualifier truth", async () => {
  const country = candidate({
    id: "country-only",
    value: money("2200000"),
    scope: manualSearchScope({ countryCode: "IN" })
  });
  const countryAndRole = candidate({
    id: "country-and-role",
    value: money("2600000"),
    scope: manualSearchScope({ countryCode: "IN", roleFamily: "BACKEND" })
  });
  const { resolver } = resolverWith([country, countryAndRole]);
  const result = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: { countryCode: "IN", roleFamily: "BACKEND" }
  });
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.status === "RESOLVED" ? result.answerVersionId : null, "country-and-role");
});

test("a removed override falls through, while active-policy scope drift fails closed", async () => {
  const global = candidate({ id: "global-active", value: money("2400000"), scope: scope("EXPECTED_CTC", "GLOBAL") });
  const removedCompany = candidate({
    id: "company-removed",
    value: money("2800000"),
    scope: scope("EXPECTED_CTC", "COMPANY", { companyId }),
    trustState: "REMOVED"
  });
  const inherited = resolverWith([global, removedCompany]);
  const inheritedResult = await inherited.resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EXPECTED_CTC",
    context: { companyId }
  });
  assert.equal(inheritedResult.status, "RESOLVED");
  assert.equal(inheritedResult.status === "RESOLVED" ? inheritedResult.answerVersionId : null, "global-active");

  const applicationScope: CandidateAnswerScope = {
    scopeType: "APPLICATION",
    applicationId: "30000000-0000-4000-8000-000000000099",
    scopeKey: "scope=APPLICATION|application=30000000-0000-4000-8000-000000000099",
    scopeFingerprint: "f".repeat(64),
    precedence: SCOPE_PRECEDENCE.APPLICATION
  };
  const drift = resolverWith([
    candidate({ id: "old-policy-scope", value: money("3000000"), scope: applicationScope })
  ]);
  const driftResult = await drift.resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "WORK_AUTHORIZATION",
    context: { applicationId: applicationScope.applicationId, countryCode: "IN" }
  });
  assert.equal(driftResult.status, "NEEDS_USER");
  assert.deepEqual(driftResult.reasonCodes, ["CANDIDATE_TRUTH_POLICY_DRIFT"]);
});

test("a REVIEW answer is not trial-reused when its policy forbids provisional reuse", async () => {
  const review = candidate({
    id: "ctc-review",
    value: money("1200000"),
    scope: scope("CURRENT_CTC", "GLOBAL"),
    trustState: "REVIEW"
  });
  const { resolver } = resolverWith([review]);
  const result = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "CURRENT_CTC"
  });
  assert.equal(result.status, "NEEDS_USER");
  assert.deepEqual(result.reasonCodes, ["REVIEW_ANSWER_NOT_TRIAL_REUSABLE"]);
});

test("entity canonicals require stable entity identity and pass only that identity to storage", async () => {
  const employment = candidate({
    id: "employment-company",
    value: stringValue("Acme"),
    scope: scope("EMPLOYMENT_COMPANY", "GLOBAL")
  });
  const { resolver, calls } = resolverWith([employment]);
  const missing = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EMPLOYMENT_COMPANY"
  });
  assert.equal(missing.status, "NEEDS_USER");
  assert.deepEqual(missing.reasonCodes, ["ENTITY_CONTEXT_REQUIRED"]);

  const resolved = await resolver.resolve({
    accountId,
    candidateId,
    canonicalKey: "EMPLOYMENT_COMPANY",
    entityId
  });
  assert.equal(resolved.status, "RESOLVED");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.entityId, entityId);
});

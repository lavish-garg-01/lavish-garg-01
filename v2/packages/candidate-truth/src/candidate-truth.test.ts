import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_DEFINITIONS,
  CandidateAnswerPolicySchema,
  NormalizedValueSchema,
  PersistableNormalizedValueSchema,
  candidateAnswerPolicy,
  candidateScopeCompatible,
  canonicalDefinition,
  canonicalNormalizedValueJson,
  compareCandidateScopeSpecificity,
  evaluateAnswerFreshness,
  evaluateCandidateAnswerAnomaly,
  listCandidateAnswerPolicies,
  normalizedValuesEqual,
  resolveCandidateAnswerScope
} from "./index.js";

const candidatePrivate = {
  schemaVersion: 1 as const,
  dataClass: "CANDIDATE_PRIVATE" as const
};
const companyId = "10000000-0000-4000-8000-000000000001";
const jobId = "10000000-0000-4000-8000-000000000002";
const applicationId = "10000000-0000-4000-8000-000000000003";

test("the reviewed ontology has one fail-closed policy per canonical", () => {
  const policies = listCandidateAnswerPolicies();
  assert.equal(policies.length, CANONICAL_DEFINITIONS.length);
  assert.equal(new Set(policies.map((policy) => policy.canonicalKey)).size, policies.length);
  for (const policy of policies) CandidateAnswerPolicySchema.parse(policy);

  assert.equal(canonicalDefinition("SPONSORSHIP_REQUIRED")?.valueType, "BOOLEAN");
  assert.equal(canonicalDefinition("SPONSORSHIP"), null, "the ambiguous legacy key is not V2 authority");
  const unknown = candidateAnswerPolicy("NEW_UNREVIEWED_FIELD");
  assert.equal(unknown.reuseMode, "ASK");
  assert.equal(unknown.learningMode, "APPLICATION_ONLY");
  assert.equal(unknown.autofillMode, "FORBIDDEN");
  assert.deepEqual(unknown.allowedScopeTypes, ["APPLICATION"]);
});

test("permanent learning points are explicit and application actions never become candidate truth", () => {
  const email = candidateAnswerPolicy("EMAIL");
  assert.deepEqual(email.permanentCommitPoints, ["VERIFIED_SUBMISSION", "EXPLICIT_SAVE"]);
  assert.equal(email.learningMode, "AUTO_VERSION");

  const declaration = candidateAnswerPolicy("PRIVACY_ACKNOWLEDGEMENT");
  assert.equal(declaration.answerClass, "CONSENT");
  assert.equal(declaration.learningMode, "APPLICATION_AUTHORIZATION");
  assert.equal(declaration.autofillMode, "APPLICATION_GESTURE");
  assert.deepEqual(declaration.permanentCommitPoints, []);

  const protectedPolicy = candidateAnswerPolicy("EEO_DISABILITY");
  assert.equal(protectedPolicy.answerClass, "PROTECTED");
  assert.equal(protectedPolicy.reuseMode, "NEVER");
  assert.equal(protectedPolicy.autofillMode, "FORBIDDEN");
});

test("normalized values reject unsafe or ambiguous representations", () => {
  const decimal = NormalizedValueSchema.parse({
    ...candidatePrivate,
    kind: "DECIMAL",
    valueExact: "120.5000"
  });
  assert.equal(decimal.kind === "DECIMAL" ? decimal.valueExact : null, "120.5");

  assert.throws(() =>
    NormalizedValueSchema.parse({
      ...candidatePrivate,
      kind: "DATE",
      value: { isoDate: "2026-02-30", precision: "DAY" }
    })
  );
  assert.throws(() =>
    NormalizedValueSchema.parse({
      ...candidatePrivate,
      kind: "URL",
      value: "https://user:secret@example.com/profile"
    })
  );
  assert.throws(() =>
    NormalizedValueSchema.parse({
      ...candidatePrivate,
      kind: "MULTI_ENUM",
      values: [
        { key: "NODE", label: "Node.js" },
        { key: "NODE", label: "NodeJS" }
      ]
    })
  );
  assert.throws(() =>
    PersistableNormalizedValueSchema.parse({
      ...candidatePrivate,
      kind: "UNKNOWN",
      reasonCode: "NO_ANSWER",
      evidenceHash: null
    })
  );
});

test("normalized equality is semantic and independent of object key order", () => {
  const left = PersistableNormalizedValueSchema.parse({
    ...candidatePrivate,
    kind: "MONEY",
    amountExact: "2400000.00",
    currency: "INR",
    period: "YEAR"
  });
  const right = PersistableNormalizedValueSchema.parse({
    kind: "MONEY",
    period: "YEAR",
    currency: "INR",
    amountExact: "2400000",
    dataClass: "CANDIDATE_PRIVATE",
    schemaVersion: 1
  });
  assert.equal(normalizedValuesEqual(left, right), true);
  assert.equal(canonicalNormalizedValueJson(left), canonicalNormalizedValueJson(right));
});

test("legal facts require exact jurisdiction or company scope", () => {
  const authorization = candidateAnswerPolicy("WORK_AUTHORIZATION");
  const missingCountry = resolveCandidateAnswerScope({
    policy: authorization,
    scopeType: "SEARCH"
  });
  assert.deepEqual(missingCountry, {
    ok: false,
    reason: "SCOPE_SHAPE_INVALID"
  });

  const india = resolveCandidateAnswerScope({
    policy: authorization,
    scopeType: "SEARCH",
    context: { countryCode: "IN" }
  });
  assert.equal(india.ok, true);
  if (!india.ok) return;
  assert.equal(india.scope.countryCode, "IN");
  assert.equal(candidateScopeCompatible(india.scope, { countryCode: "IN" }), true);
  assert.equal(candidateScopeCompatible(india.scope, { countryCode: "US" }), false);

  const indiaFromJobContext = resolveCandidateAnswerScope({
    policy: authorization,
    scopeType: "SEARCH",
    context: { countryCode: "IN", roleFamily: "BACKEND", companyId, jobId }
  });
  assert.equal(indiaFromJobContext.ok, true);
  if (!indiaFromJobContext.ok) return;
  assert.equal(indiaFromJobContext.scope.scopeFingerprint, india.scope.scopeFingerprint);
  assert.equal(indiaFromJobContext.scope.roleFamily, undefined, "country legal truth is not over-scoped to role");

  const previousEmployment = candidateAnswerPolicy("PREVIOUSLY_EMPLOYED_BY_COMPANY");
  const company = resolveCandidateAnswerScope({
    policy: previousEmployment,
    scopeType: "COMPANY",
    context: { companyId }
  });
  assert.equal(company.ok, true);
  const conflict = resolveCandidateAnswerScope({
    policy: previousEmployment,
    scopeType: "COMPANY",
    context: { companyId },
    requested: { companyId: "10000000-0000-4000-8000-000000000009" }
  });
  assert.deepEqual(conflict, { ok: false, reason: "SCOPE_CONTEXT_CONFLICT" });
});

test("scope precedence is application then job, company, search and global", () => {
  const policy = candidateAnswerPolicy("EXPECTED_CTC");
  const global = resolveCandidateAnswerScope({ policy, scopeType: "GLOBAL" });
  const search = resolveCandidateAnswerScope({
    policy,
    scopeType: "SEARCH",
    context: { countryCode: "IN", roleFamily: "BACKEND" }
  });
  const company = resolveCandidateAnswerScope({
    policy,
    scopeType: "COMPANY",
    context: { companyId, countryCode: "IN", roleFamily: "BACKEND" }
  });
  const job = resolveCandidateAnswerScope({
    policy,
    scopeType: "JOB",
    context: { jobId, companyId, countryCode: "IN", roleFamily: "BACKEND" }
  });
  assert.ok(global.ok && search.ok && company.ok && job.ok);
  if (!global.ok || !search.ok || !company.ok || !job.ok) return;
  assert.ok(compareCandidateScopeSpecificity(search.scope, global.scope) > 0);
  assert.ok(compareCandidateScopeSpecificity(company.scope, search.scope) > 0);
  assert.ok(compareCandidateScopeSpecificity(job.scope, company.scope) > 0);

  const applicationPolicy = candidateAnswerPolicy("START_DATE");
  assert.equal(resolveCandidateAnswerScope({ policy: applicationPolicy, scopeType: "GLOBAL" }).ok, true);
  const application = resolveCandidateAnswerScope({
    policy: applicationPolicy,
    scopeType: "APPLICATION",
    context: { applicationId, jobId }
  });
  assert.equal(application.ok, true);
});

test("freshness makes stale mutable facts request reconfirmation instead of becoming false", () => {
  const fresh = evaluateAnswerFreshness({
    trustState: "TRUSTED",
    confirmedAt: new Date("2026-08-15T00:00:00.000Z"),
    freshnessDays: 30,
    evaluatedAt: new Date("2026-09-01T00:00:00.000Z")
  });
  assert.equal(fresh.state, "FRESH");
  assert.equal(fresh.reusable, true);

  const stale = evaluateAnswerFreshness({
    trustState: "TRUSTED",
    confirmedAt: new Date("2026-07-01T00:00:00.000Z"),
    freshnessDays: 30,
    evaluatedAt: new Date("2026-09-01T00:00:00.000Z")
  });
  assert.deepEqual(
    { state: stale.state, reusable: stale.reusable, reason: stale.reason },
    { state: "STALE", reusable: false, reason: "NEEDS_RECONFIRMATION" }
  );
});

test("anomaly checks reject invalid policy values without changing candidate truth semantics", () => {
  const notice = candidateAnswerPolicy("NOTICE_PERIOD");
  const invalidNotice = evaluateCandidateAnswerAnomaly({
    policy: notice,
    proposedValue: { ...candidatePrivate, kind: "INTEGER", value: 500 }
  });
  assert.equal(invalidNotice.allowed, false);
  assert.deepEqual(invalidNotice.reasonCodes, ["VALUE_OUTSIDE_POLICY_RANGE"]);

  const invalidEmail = evaluateCandidateAnswerAnomaly({
    policy: candidateAnswerPolicy("EMAIL"),
    proposedValue: { ...candidatePrivate, kind: "STRING", value: "not-an-email" }
  });
  assert.equal(invalidEmail.allowed, false);
  assert.deepEqual(invalidEmail.reasonCodes, ["EMAIL_FORMAT_INVALID"]);

  const compensation = candidateAnswerPolicy("EXPECTED_CTC");
  const unitChange = evaluateCandidateAnswerAnomaly({
    policy: compensation,
    proposedValue: {
      ...candidatePrivate,
      kind: "MONEY",
      amountExact: "30000",
      currency: "USD",
      period: "YEAR"
    },
    previousValue: {
      ...candidatePrivate,
      kind: "MONEY",
      amountExact: "2400000",
      currency: "INR",
      period: "YEAR"
    }
  });
  assert.equal(unitChange.allowed, true);
  assert.equal(unitChange.requiresReview, true);
  assert.deepEqual(unitChange.reasonCodes, ["COMPENSATION_UNIT_CHANGED"]);
});

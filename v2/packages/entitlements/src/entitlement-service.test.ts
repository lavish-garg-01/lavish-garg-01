import assert from "node:assert/strict";
import test from "node:test";
import type { EntitlementContext, EntitlementRepository } from "./index.js";
import { EntitlementService } from "./index.js";

const now = new Date("2026-09-01T12:00:00.000Z");
const base: EntitlementContext = {
  accountType: "NORMAL",
  accountStatus: "ACTIVE",
  featureExists: true,
  planCode: "FREE",
  subscriptionStatus: "FREE",
  enabled: true,
  limit: 10,
  period: "MONTH",
  used: 3,
  override: null
};

function service(context: EntitlementContext | ((plan: string | null) => EntitlementContext)) {
  const repository: EntitlementRepository = {
    getContext: async ({ simulatedPlanCode }) =>
      typeof context === "function" ? context(simulatedPlanCode) : context,
    consumeUsage: async ({ quantity, limit }) => {
      const current = typeof context === "function" ? context(null) : context;
      const next = current.used + quantity;
      return { consumed: limit === null || next <= limit, used: limit !== null && next > limit ? current.used : next };
    }
  };
  return new EntitlementService(repository, { now: () => now });
}

test("allows an entitled FREE feature without treating FREE as an account type", async () => {
  const result = await service(base).evaluate({ accountId: "account-1", featureKey: "jobs.search" });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "PLAN_ENTITLED");
  assert.equal(result.accountType, "NORMAL");
  assert.equal(result.remaining, 7);
});

test("denies at the usage limit", async () => {
  const result = await service({ ...base, used: 10 }).evaluate({
    accountId: "account-1",
    featureKey: "applications.smart"
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "USAGE_LIMIT_REACHED");
});

test("a deny override wins over the plan", async () => {
  const result = await service({
    ...base,
    override: { effect: "DENY", limit: null, expiresAt: null }
  }).evaluate({ accountId: "account-1", featureKey: "applications.smart" });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "OVERRIDE_DENY");
});

test("an unlimited ALLOW override can enable a plan-disabled feature", async () => {
  const result = await service({
    ...base,
    enabled: false,
    limit: 0,
    used: 0,
    override: { effect: "ALLOW", limit: null, expiresAt: null }
  }).evaluate({ accountId: "account-1", featureKey: "candidate.ai_application_answers" });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "OVERRIDE_ALLOW");
  assert.equal(result.limit, null);
});

test("only an authorized TEST or INTERNAL account can simulate a plan", async () => {
  const result = await service((plan) => ({
    ...base,
    accountType: "TEST",
    planCode: plan === "PRO" ? "PRO" : "FREE",
    limit: plan === "PRO" ? null : 10
  })).evaluate({
    accountId: "test-account",
    featureKey: "applications.smart",
    simulatedPlanCode: "PRO",
    simulationAuthorized: true
  });
  assert.equal(result.allowed, true);
  assert.equal(result.planCode, "PRO");
  assert.equal(result.limit, null);
});

test("a NORMAL account cannot self-select a PRO simulation", async () => {
  const result = await service(base).evaluate({
    accountId: "account-1",
    featureKey: "applications.smart",
    simulatedPlanCode: "PRO",
    simulationAuthorized: true
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "SIMULATION_NOT_ALLOWED");
  assert.equal(result.planCode, "FREE");
});

test("authorizeAndConsume uses an atomic repository reservation before allowing metered work", async () => {
  const repository: EntitlementRepository = {
    getContext: async () => ({ ...base, used: 9, limit: 10 }),
    consumeUsage: async () => ({ consumed: false, used: 10 })
  };
  const result = await new EntitlementService(repository, { now: () => now }).authorizeAndConsume({
    accountId: "account-1",
    featureKey: "applications.smart",
    quantity: 2
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "USAGE_LIMIT_REACHED");
  assert.equal(result.used, 10);
});

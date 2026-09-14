import type {
  AccountStatus,
  AccountType,
  EntitlementDecision,
  FeatureKey,
  PlanCode,
  SubscriptionStatus
} from "@job-hunter-v2/contracts";
import { type Clock, systemClock } from "@job-hunter-v2/domain";

export interface EntitlementOverride {
  effect: "ALLOW" | "DENY";
  limit: number | null;
  expiresAt: Date | null;
}

export interface EntitlementContext {
  accountType: AccountType;
  accountStatus: AccountStatus;
  featureExists: boolean;
  planCode: PlanCode;
  subscriptionStatus: SubscriptionStatus;
  enabled: boolean;
  limit: number | null;
  period: "DAY" | "WEEK" | "MONTH" | "LIFETIME" | null;
  used: number;
  override: EntitlementOverride | null;
}

export interface EntitlementRepository {
  getContext(input: {
    accountId: string;
    featureKey: FeatureKey;
    evaluatedAt: Date;
    simulatedPlanCode: PlanCode | null;
  }): Promise<EntitlementContext>;
  consumeUsage(input: {
    accountId: string;
    featureKey: FeatureKey;
    periodStart: Date;
    periodEnd: Date;
    quantity: number;
    limit: number | null;
  }): Promise<{ consumed: boolean; used: number }>;
}

export interface EvaluateEntitlementInput {
  accountId: string;
  featureKey: FeatureKey;
  simulatedPlanCode?: PlanCode;
  simulationAuthorized?: boolean;
}

export interface ConsumeEntitlementInput extends EvaluateEntitlementInput {
  quantity?: number;
}

export class EntitlementService {
  constructor(
    private readonly repository: EntitlementRepository,
    private readonly clock: Clock = systemClock
  ) {}

  async evaluate(input: EvaluateEntitlementInput): Promise<EntitlementDecision> {
    const evaluatedAt = this.clock.now();
    return decide(await this.resolveContext(input, evaluatedAt), input.featureKey, evaluatedAt, input);
  }

  async authorizeAndConsume(input: ConsumeEntitlementInput): Promise<EntitlementDecision> {
    const quantity = input.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error("Entitlement usage quantity must be a positive safe integer.");
    }
    const evaluatedAt = this.clock.now();
    const context = await this.resolveContext(input, evaluatedAt);
    const authorization = decide(context, input.featureKey, evaluatedAt, input);
    if (!authorization.allowed || context.period === null) return authorization;

    const window = usageWindow(context.period, evaluatedAt);
    const consumed = await this.repository.consumeUsage({
      accountId: input.accountId,
      featureKey: input.featureKey,
      periodStart: window.start,
      periodEnd: window.end,
      quantity,
      limit: authorization.limit
    });
    if (!consumed.consumed) {
      return {
        ...authorization,
        allowed: false,
        reason: "USAGE_LIMIT_REACHED",
        used: consumed.used,
        remaining: authorization.limit === null ? null : Math.max(0, authorization.limit - consumed.used)
      };
    }
    return {
      ...authorization,
      used: consumed.used,
      remaining: authorization.limit === null ? null : Math.max(0, authorization.limit - consumed.used)
    };
  }

  private async resolveContext(
    input: EvaluateEntitlementInput,
    evaluatedAt: Date
  ): Promise<EntitlementContext> {
    const baseContext = await this.repository.getContext({
      accountId: input.accountId,
      featureKey: input.featureKey,
      evaluatedAt,
      simulatedPlanCode: null
    });
    const simulationRequested = input.simulatedPlanCode !== undefined;
    const canSimulate =
      input.simulationAuthorized === true &&
      (baseContext.accountType === "TEST" || baseContext.accountType === "INTERNAL");
    if (!simulationRequested || !canSimulate) return baseContext;
    return this.repository.getContext({
      accountId: input.accountId,
      featureKey: input.featureKey,
      evaluatedAt,
      simulatedPlanCode: input.simulatedPlanCode ?? null
    });
  }
}

function decide(
  context: EntitlementContext,
  featureKey: FeatureKey,
  evaluatedAt: Date,
  input: EvaluateEntitlementInput
): EntitlementDecision {
  const simulationRequested = input.simulatedPlanCode !== undefined;
  const canSimulate =
    input.simulationAuthorized === true &&
    (context.accountType === "TEST" || context.accountType === "INTERNAL");
  if (simulationRequested && !canSimulate) {
    return decision(context, featureKey, evaluatedAt, false, "SIMULATION_NOT_ALLOWED");
  }
  if (context.accountStatus !== "ACTIVE") {
    return decision(context, featureKey, evaluatedAt, false, "ACCOUNT_INACTIVE");
  }
  if (!context.featureExists) {
    return decision(context, featureKey, evaluatedAt, false, "FEATURE_UNKNOWN");
  }
  const activeOverride =
    context.override && (!context.override.expiresAt || context.override.expiresAt > evaluatedAt)
      ? context.override
      : null;
  if (activeOverride?.effect === "DENY") {
    return decision(context, featureKey, evaluatedAt, false, "OVERRIDE_DENY", activeOverride.limit);
  }
  const effectiveLimit = activeOverride ? activeOverride.limit : context.limit;
  const enabled = activeOverride?.effect === "ALLOW" || context.enabled;
  if (!enabled) {
    return decision(context, featureKey, evaluatedAt, false, "PLAN_NOT_ENTITLED", effectiveLimit);
  }
  if (effectiveLimit !== null && context.used >= effectiveLimit) {
    return decision(context, featureKey, evaluatedAt, false, "USAGE_LIMIT_REACHED", effectiveLimit);
  }
  return decision(
    context,
    featureKey,
    evaluatedAt,
    true,
    activeOverride?.effect === "ALLOW" ? "OVERRIDE_ALLOW" : "PLAN_ENTITLED",
    effectiveLimit
  );
}

function usageWindow(
  period: Exclude<EntitlementContext["period"], null>,
  at: Date
): { start: Date; end: Date } {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const day = at.getUTCDate();
  if (period === "DAY") {
    return { start: new Date(Date.UTC(year, month, day)), end: new Date(Date.UTC(year, month, day + 1)) };
  }
  if (period === "WEEK") {
    const mondayOffset = (at.getUTCDay() + 6) % 7;
    return {
      start: new Date(Date.UTC(year, month, day - mondayOffset)),
      end: new Date(Date.UTC(year, month, day - mondayOffset + 7))
    };
  }
  if (period === "MONTH") {
    return { start: new Date(Date.UTC(year, month, 1)), end: new Date(Date.UTC(year, month + 1, 1)) };
  }
  return { start: new Date("1970-01-01T00:00:00.000Z"), end: new Date("9999-12-31T23:59:59.999Z") };
}

function decision(
  context: EntitlementContext,
  featureKey: FeatureKey,
  evaluatedAt: Date,
  allowed: boolean,
  reason: EntitlementDecision["reason"],
  limit: number | null = context.limit
): EntitlementDecision {
  return {
    allowed,
    accountType: context.accountType,
    planCode: context.planCode,
    featureKey,
    reason,
    limit,
    used: context.used,
    remaining: limit === null ? null : Math.max(0, limit - context.used),
    evaluatedAt: evaluatedAt.toISOString()
  };
}

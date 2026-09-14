import { z } from "zod";
export * from "./learning-recovery.js";
export * from "./operator-review.js";
export * from "./question-contract.js";

export const UuidSchema = z.uuid();
export type Uuid = z.infer<typeof UuidSchema>;

export const AccountTypeSchema = z.enum(["NORMAL", "TEST", "INTERNAL"]);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const AccountStatusSchema = z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const MembershipRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const SubscriptionStatusSchema = z.enum([
  "FREE",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "EXPIRED"
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const FeatureKeySchema = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
export type FeatureKey = z.infer<typeof FeatureKeySchema>;

export const PlanCodeSchema = z
  .string()
  .min(2)
  .max(50)
  .regex(/^[A-Z][A-Z0-9_]*$/);
export type PlanCode = z.infer<typeof PlanCodeSchema>;

export const EntitlementReasonSchema = z.enum([
  "ACCOUNT_INACTIVE",
  "FEATURE_UNKNOWN",
  "OVERRIDE_DENY",
  "OVERRIDE_ALLOW",
  "PLAN_NOT_ENTITLED",
  "PLAN_ENTITLED",
  "USAGE_LIMIT_REACHED",
  "SIMULATION_NOT_ALLOWED"
]);

export const EntitlementDecisionSchema = z
  .object({
    allowed: z.boolean(),
    accountType: AccountTypeSchema,
    planCode: PlanCodeSchema,
    featureKey: FeatureKeySchema,
    reason: EntitlementReasonSchema,
    limit: z.number().int().nonnegative().nullable(),
    used: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative().nullable(),
    evaluatedAt: z.iso.datetime()
  })
  .strict();
export type EntitlementDecision = z.infer<typeof EntitlementDecisionSchema>;

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("job-hunter-v2-api"),
    version: z.string(),
    time: z.iso.datetime()
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string().optional()
    })
  })
  .strict();
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export * from "./field-intelligence.js";
export * from "./execution.js";
export * from "./learning.js";
export * from "./repeatable-entities.js";
export * from "./form-graph.js";
export * from "./declaration-policy.js";
export * from "./strategy-policy.js";

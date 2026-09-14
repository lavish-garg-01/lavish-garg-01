import { createHash } from "node:crypto";
import { z } from "zod";
import type { CandidateAnswerPolicy, ScopeContextDimension, ScopeType } from "./policy.js";

export const SCOPE_PRECEDENCE: Readonly<Record<ScopeType, number>> = Object.freeze({
  GLOBAL: 100,
  SEARCH: 200,
  COMPANY: 300,
  JOB: 400,
  APPLICATION: 500
});

const CandidateScopeContextSchema = z
  .object({
    countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
    roleFamily: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(100).optional(),
    companyId: z.uuid().optional(),
    jobId: z.uuid().optional(),
    applicationId: z.uuid().optional()
  })
  .strict();

export type CandidateScopeContext = z.infer<typeof CandidateScopeContextSchema>;

export function parseCandidateScopeContext(input?: CandidateScopeContext): CandidateScopeContext {
  return CandidateScopeContextSchema.parse(input ?? {});
}

export interface CandidateAnswerScope extends CandidateScopeContext {
  scopeType: ScopeType;
  scopeKey: string;
  scopeFingerprint: string;
  precedence: number;
}

export function hydrateCandidateAnswerScope(input: {
  scopeType: ScopeType;
  scopeFingerprint: string;
  context?: CandidateScopeContext;
}): CandidateAnswerScope {
  const context = CandidateScopeContextSchema.parse(input.context ?? {});
  const scoped = scopeContextForType(input.scopeType, context);
  const identity = requiredIdentity(input.scopeType);
  if (identity && !contextValue(identity, scoped)) {
    throw new Error(`Persisted ${input.scopeType} candidate scope is missing ${identity}.`);
  }
  if (input.scopeType === "SEARCH" && !scoped.countryCode && !scoped.roleFamily) {
    throw new Error("Persisted SEARCH candidate scope has no search qualifier.");
  }
  const scopeKey = keyForScope(input.scopeType, scoped);
  const expectedFingerprint = createHash("sha256").update(scopeKey).digest("hex");
  if (input.scopeFingerprint !== expectedFingerprint) {
    throw new Error("Persisted candidate scope fingerprint does not match its canonical scope key.");
  }
  return {
    scopeType: input.scopeType,
    ...scoped,
    scopeKey,
    scopeFingerprint: input.scopeFingerprint,
    precedence: SCOPE_PRECEDENCE[input.scopeType]
  };
}

export type ScopeResolution =
  | { ok: true; scope: CandidateAnswerScope }
  | {
      ok: false;
      reason:
        | "SCOPE_NOT_ALLOWED"
        | "SCOPE_CONTEXT_CONFLICT"
        | "SCOPE_CONTEXT_MISSING"
        | "SCOPE_SHAPE_INVALID";
      dimension?: ScopeContextDimension;
    };

function contextValue(
  dimension: ScopeContextDimension,
  context: CandidateScopeContext
): string | undefined {
  switch (dimension) {
    case "COUNTRY":
      return context.countryCode;
    case "ROLE_FAMILY":
      return context.roleFamily;
    case "COMPANY":
      return context.companyId;
    case "JOB":
      return context.jobId;
    case "APPLICATION":
      return context.applicationId;
  }
}

function requiredIdentity(scopeType: ScopeType): ScopeContextDimension | null {
  if (scopeType === "COMPANY") return "COMPANY";
  if (scopeType === "JOB") return "JOB";
  if (scopeType === "APPLICATION") return "APPLICATION";
  return null;
}

function keyForScope(scopeType: ScopeType, context: CandidateScopeContext): string {
  const components = [`scope=${scopeType}`];
  if (context.applicationId) components.push(`application=${context.applicationId}`);
  if (context.jobId) components.push(`job=${context.jobId}`);
  if (context.companyId) components.push(`company=${context.companyId}`);
  if (context.countryCode) components.push(`country=${context.countryCode}`);
  if (context.roleFamily) components.push(`role=${context.roleFamily}`);
  return components.join("|");
}

function scopeContextForType(
  scopeType: ScopeType,
  context: CandidateScopeContext
): CandidateScopeContext {
  if (scopeType === "GLOBAL") return {};
  if (scopeType === "SEARCH") {
    return {
      ...(context.countryCode ? { countryCode: context.countryCode } : {}),
      ...(context.roleFamily ? { roleFamily: context.roleFamily } : {})
    };
  }
  if (scopeType === "COMPANY") {
    return {
      ...(context.companyId ? { companyId: context.companyId } : {}),
      ...(context.countryCode ? { countryCode: context.countryCode } : {}),
      ...(context.roleFamily ? { roleFamily: context.roleFamily } : {})
    };
  }
  if (scopeType === "JOB") {
    return {
      ...(context.jobId ? { jobId: context.jobId } : {}),
      ...(context.companyId ? { companyId: context.companyId } : {}),
      ...(context.countryCode ? { countryCode: context.countryCode } : {}),
      ...(context.roleFamily ? { roleFamily: context.roleFamily } : {})
    };
  }
  return {
    ...(context.applicationId ? { applicationId: context.applicationId } : {}),
    ...(context.jobId ? { jobId: context.jobId } : {}),
    ...(context.companyId ? { companyId: context.companyId } : {}),
    ...(context.countryCode ? { countryCode: context.countryCode } : {}),
    ...(context.roleFamily ? { roleFamily: context.roleFamily } : {})
  };
}

function contextForPolicy(
  policy: CandidateAnswerPolicy,
  context: CandidateScopeContext
): CandidateScopeContext {
  const includes = (dimension: ScopeContextDimension) =>
    policy.scopeContextDimensions.includes(dimension);
  return {
    ...(includes("COUNTRY") && context.countryCode ? { countryCode: context.countryCode } : {}),
    ...(includes("ROLE_FAMILY") && context.roleFamily ? { roleFamily: context.roleFamily } : {}),
    ...(includes("COMPANY") && context.companyId ? { companyId: context.companyId } : {}),
    ...(includes("JOB") && context.jobId ? { jobId: context.jobId } : {}),
    ...(includes("APPLICATION") && context.applicationId
      ? { applicationId: context.applicationId }
      : {})
  };
}

export function resolveCandidateAnswerScope(input: {
  policy: CandidateAnswerPolicy;
  scopeType: ScopeType;
  requested?: CandidateScopeContext;
  context?: CandidateScopeContext;
}): ScopeResolution {
  if (!input.policy.allowedScopeTypes.includes(input.scopeType)) {
    return { ok: false, reason: "SCOPE_NOT_ALLOWED" };
  }

  const requested = CandidateScopeContextSchema.parse(input.requested ?? {});
  const context = CandidateScopeContextSchema.parse(input.context ?? {});
  for (const property of Object.keys(requested) as (keyof CandidateScopeContext)[]) {
    if (context[property] && requested[property] !== context[property]) {
      return { ok: false, reason: "SCOPE_CONTEXT_CONFLICT" };
    }
  }
  const combined = contextForPolicy(input.policy, { ...context, ...requested });
  const scoped = scopeContextForType(input.scopeType, combined);
  const identity = requiredIdentity(input.scopeType);
  if (identity && !contextValue(identity, scoped)) {
    return { ok: false, reason: "SCOPE_CONTEXT_MISSING", dimension: identity };
  }
  if (input.scopeType === "SEARCH" && !scoped.countryCode && !scoped.roleFamily) {
    return { ok: false, reason: "SCOPE_SHAPE_INVALID" };
  }
  for (const dimension of input.policy.requiredContextDimensions) {
    if (!contextValue(dimension, scoped)) {
      return { ok: false, reason: "SCOPE_CONTEXT_MISSING", dimension };
    }
  }

  const scopeKey = keyForScope(input.scopeType, scoped);
  return {
    ok: true,
    scope: {
      scopeType: input.scopeType,
      ...scoped,
      scopeKey,
      scopeFingerprint: createHash("sha256").update(scopeKey).digest("hex"),
      precedence: SCOPE_PRECEDENCE[input.scopeType]
    }
  };
}

export function candidateScopeCompatible(
  scope: CandidateAnswerScope,
  context: CandidateScopeContext
): boolean {
  const properties: (keyof CandidateScopeContext)[] = [
    "applicationId",
    "jobId",
    "companyId",
    "countryCode",
    "roleFamily"
  ];
  return properties.every((property) => !scope[property] || scope[property] === context[property]);
}

export function compareCandidateScopeSpecificity(
  left: CandidateAnswerScope,
  right: CandidateAnswerScope
): number {
  const precedence = left.precedence - right.precedence;
  if (precedence !== 0) return precedence;
  const fields: (keyof CandidateScopeContext)[] = [
    "applicationId",
    "jobId",
    "companyId",
    "countryCode",
    "roleFamily"
  ];
  const leftSpecificity = fields.filter((field) => left[field] !== undefined).length;
  const rightSpecificity = fields.filter((field) => right[field] !== undefined).length;
  return leftSpecificity - rightSpecificity;
}

export function candidateReviewScopeIsExact(
  policy: CandidateAnswerPolicy,
  scope: CandidateAnswerScope,
  context: CandidateScopeContext
): boolean {
  const reconstructed = resolveCandidateAnswerScope({ policy, scopeType: scope.scopeType, context });
  if (!reconstructed.ok || reconstructed.scope.scopeFingerprint !== scope.scopeFingerprint) return false;
  if (scope.scopeType === "GLOBAL") {
    const moreSpecificContextExists = policy.allowedScopeTypes
      .filter((scopeType) => scopeType !== "GLOBAL")
      .some((scopeType) => resolveCandidateAnswerScope({ policy, scopeType, context }).ok);
    if (moreSpecificContextExists) return false;
  }
  return true;
}

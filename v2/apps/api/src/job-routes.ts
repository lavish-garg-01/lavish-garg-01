import type {
  CandidateSearchProfileService,
  JobDiscoveryService
} from "@job-hunter-v2/job-intelligence";
import { ROLE_FAMILIES, WORK_MODES } from "@job-hunter-v2/job-intelligence";
import type { CandidateSessionAuthenticator } from "@job-hunter-v2/onboarding";
import { ValidationError } from "@job-hunter-v2/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";

export interface PhaseHApiServices {
  sessions: CandidateSessionAuthenticator;
  discovery: Pick<JobDiscoveryService, "discover" | "detail" | "related">;
  searchProfiles: Pick<CandidateSearchProfileService, "get" | "save">;
}

async function sessionFor(request: FastifyRequest, services: PhaseHApiServices) {
  return services.sessions.authenticate(request.headers.authorization);
}

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers["x-idempotency-key"];
  if (typeof value !== "string" || !value.trim()) throw new ValidationError("An X-Idempotency-Key header is required.");
  return value;
}

function publicReason(reason: { code: string; message: string; evidence: readonly string[] }) {
  return { code: reason.code, message: reason.message, evidence: reason.evidence };
}

function publicJob(item: Awaited<ReturnType<JobDiscoveryService["detail"]>>) {
  return {
    id: item.job.jobId,
    company: item.job.companyName,
    title: item.job.title,
    description: item.job.description,
    roleFamily: item.job.roleFamily,
    seniority: item.job.seniority,
    location: item.job.locationText,
    countryCodes: item.job.countryCodes,
    workMode: item.job.workMode,
    employmentType: item.job.employmentType,
    compensation: item.job.currencyCode ? {
      minimumMinor: item.job.minCompensationMinor,
      maximumMinor: item.job.maxCompensationMinor,
      currency: item.job.currencyCode,
      period: item.job.compensationPeriod
    } : null,
    skills: {
      required: item.job.requiredSkills.map((skill) => ({ key: skill.key, label: skill.label })),
      preferred: item.job.preferredSkills.map((skill) => ({ key: skill.key, label: skill.label }))
    },
    applicationUrl: item.job.applicationUrl,
    ats: item.job.ats,
    freshness: {
      state: item.freshness.state,
      verifiedAt: item.freshness.verifiedAt?.toISOString() ?? null
    },
    match: {
      policyVersion: item.evaluation.policyVersion,
      label: item.evaluation.label,
      score: item.evaluation.matchScore,
      eligibility: item.evaluation.eligibility.state,
      reasons: item.evaluation.reasons.map(publicReason),
      gaps: item.evaluation.gaps.map(publicReason),
      unknowns: item.evaluation.unknowns.map(publicReason)
    }
  };
}

const searchPreferencesJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "dealBreakers"],
  properties: {
    version: { const: 1 },
    targetRoleFamilies: { type: "array", maxItems: 20, items: { enum: ROLE_FAMILIES } },
    acceptableRoleFamilies: { type: "array", maxItems: 20, items: { enum: ROLE_FAMILIES } },
    preferredWorkModes: { type: "array", maxItems: 3, uniqueItems: true, items: { enum: WORK_MODES } },
    preferredCountryCodes: { type: "array", maxItems: 20, items: { type: "string", pattern: "^[A-Za-z]{2}$" } },
    excludedCompanyNames: { type: "array", maxItems: 200, items: { type: "string", minLength: 1, maxLength: 300 } },
    // Keep null first. Fastify/Ajv coercion otherwise turns JSON null into 0/""
    // while evaluating the first branch, corrupting the optional preference.
    minimumCompensationMinor: { anyOf: [{ type: "null" }, { type: "integer", minimum: 0 }] },
    compensationCurrencyCode: { anyOf: [{ type: "null" }, { type: "string", pattern: "^[A-Za-z]{3}$" }] },
    dealBreakers: {
      type: "object",
      additionalProperties: false,
      properties: {
        mandatoryRelocation: { type: "boolean" }, nightShift: { type: "boolean" },
        heavyTravel: { type: "boolean" }, employmentBond: { type: "boolean" }
      }
    }
  }
} as const;

export async function registerPhaseHRoutes(app: FastifyInstance, services: PhaseHApiServices): Promise<void> {
  app.get<{
    Querystring: {
      query?: string;
      roleFamily?: (typeof ROLE_FAMILIES)[number];
      workMode?: (typeof WORK_MODES)[number];
      countryCode?: string;
      limit?: number;
      cursor?: string;
    };
  }>("/v1/jobs", {
    schema: {
      tags: ["jobs"],
      querystring: {
        type: "object", additionalProperties: false,
        properties: {
          query: { type: "string", maxLength: 200 },
          roleFamily: { enum: ROLE_FAMILIES }, workMode: { enum: WORK_MODES },
          countryCode: { type: "string", pattern: "^[A-Za-z]{2}$" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
          cursor: { type: "string", maxLength: 2000 }
        }
      }
    }
  }, async (request) => {
    const session = await sessionFor(request, services);
    const page = await services.discovery.discover({
      accountId: session.account.accountId, candidateId: session.candidate.candidateId,
      ...(request.query.query ? { query: request.query.query } : {}),
      ...(request.query.roleFamily ? { roleFamily: request.query.roleFamily } : {}),
      ...(request.query.workMode ? { workMode: request.query.workMode } : {}),
      ...(request.query.countryCode ? { countryCode: request.query.countryCode } : {}),
      ...(request.query.limit ? { limit: request.query.limit } : {}),
      ...(request.query.cursor ? { cursor: request.query.cursor } : {})
    });
    return {
      items: page.items.map(publicJob), nextCursor: page.nextCursor,
      catalogTruncated: page.catalogTruncated, policyVersion: page.policyVersion
    };
  });

  app.get<{ Params: { jobId: string } }>("/v1/jobs/:jobId", {
    schema: {
      tags: ["jobs"],
      params: { type: "object", additionalProperties: false, required: ["jobId"], properties: { jobId: { type: "string", format: "uuid" } } }
    }
  }, async (request) => {
    const session = await sessionFor(request, services);
    return publicJob(await services.discovery.detail({
      accountId: session.account.accountId, candidateId: session.candidate.candidateId,
      jobId: request.params.jobId
    }));
  });

  app.get<{ Params: { jobId: string }; Querystring: { limit?: number } }>("/v1/jobs/:jobId/related", {
    schema: {
      tags: ["jobs"],
      params: { type: "object", additionalProperties: false, required: ["jobId"], properties: { jobId: { type: "string", format: "uuid" } } },
      querystring: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 20 } } }
    }
  }, async (request) => {
    const session = await sessionFor(request, services);
    const page = await services.discovery.related({
      accountId: session.account.accountId, candidateId: session.candidate.candidateId,
      jobId: request.params.jobId, ...(request.query.limit ? { limit: request.query.limit } : {})
    });
    return { items: page.items.map(publicJob), policyVersion: page.policyVersion };
  });

  app.get("/v1/job-search/profile", { schema: { tags: ["jobs", "profile"] } }, async (request) => {
    const session = await sessionFor(request, services);
    return services.searchProfiles.get(session.account.accountId, session.candidate.candidateId);
  });

  app.put<{ Body: { expectedVersion: number; preferences: Parameters<CandidateSearchProfileService["save"]>[0]["preferences"] } }>(
    "/v1/job-search/profile",
    {
      schema: {
        tags: ["jobs", "profile"],
        body: {
          type: "object", additionalProperties: false, required: ["expectedVersion", "preferences"],
          properties: { expectedVersion: { type: "integer", minimum: 0 }, preferences: searchPreferencesJsonSchema }
        }
      }
    },
    async (request) => {
      const session = await sessionFor(request, services);
      return services.searchProfiles.save({
        accountId: session.account.accountId, candidateId: session.candidate.candidateId,
        expectedVersion: request.body.expectedVersion, preferences: request.body.preferences,
        idempotencyKey: idempotencyKey(request)
      });
    }
  );
}

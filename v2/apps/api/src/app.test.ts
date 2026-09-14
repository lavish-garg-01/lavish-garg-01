import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedError } from "@job-hunter-v2/domain";
import { createApi } from "./app.js";
import type { PhaseGApiServices } from "./onboarding-routes.js";
import type { PhaseHApiServices } from "./job-routes.js";

test("health route satisfies the public response contract", async () => {
  const app = await createApi();
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(response.json()).sort(), ["service", "status", "time", "version"]);
  assert.equal(response.json().status, "ok");
  await app.close();
});

test("OpenAPI is generated from registered route schemas", async () => {
  const app = await createApi();
  await app.ready();
  const document = app.swagger();
  assert.ok(document.paths?.["/health"]?.get);
  await app.close();
});

test("request schema failures return a stable 400 error instead of an internal error", async () => {
  const app = await createApi();
  app.post(
    "/test/validated",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: { name: { type: "string", minLength: 1 } }
        }
      }
    },
    async () => ({ ok: true })
  );
  const response = await app.inject({ method: "POST", url: "/test/validated", payload: {} });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  await app.close();
});

test("Fastify request parsing failures remain stable client errors", async () => {
  const app = await createApi();
  const response = await app.inject({
    method: "POST",
    url: "/missing-route",
    headers: { "content-type": "application/json" },
    payload: ""
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(response.json().error.message, "The request body could not be read.");
  await app.close();
});

test("database connection failures return an actionable 503 response", async () => {
  const app = await createApi();
  app.get("/test/database-unavailable", async () => {
    throw new AggregateError([
      Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" })
    ]);
  });
  const response = await app.inject({ method: "GET", url: "/test/database-unavailable" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, "DATABASE_UNAVAILABLE");
  assert.match(response.json().error.message, /Start PostgreSQL/);
  await app.close();
});

test("development CORS accepts both localhost loopback spellings and rejects unrelated origins", async () => {
  const app = await createApi({
    corsOrigin: ["http://127.0.0.1:3000", "http://localhost:3000"]
  });
  for (const origin of ["http://127.0.0.1:3000", "http://localhost:3000"]) {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/auth/bootstrap",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type"
      }
    });
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["access-control-allow-origin"], origin);
  }
  const rejected = await app.inject({
    method: "OPTIONS",
    url: "/v1/auth/bootstrap",
    headers: { origin: "https://attacker.example", "access-control-request-method": "POST" }
  });
  assert.equal(rejected.headers["access-control-allow-origin"], undefined);
  const extensionOrigin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const extension = await app.inject({
    method: "OPTIONS",
    url: "/v1/field-intelligence/resolve",
    headers: {
      origin: extensionOrigin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization,content-type,x-idempotency-key",
      "access-control-request-private-network": "true"
    }
  });
  assert.equal(extension.statusCode, 204);
  assert.equal(extension.headers["access-control-allow-origin"], extensionOrigin);
  assert.equal(extension.headers["access-control-allow-private-network"], "true");
  const malformedExtension = await app.inject({
    method: "OPTIONS",
    url: "/v1/learning/runs",
    headers: { origin: "chrome-extension://not-an-id", "access-control-request-method": "POST" }
  });
  assert.equal(malformedExtension.headers["access-control-allow-origin"], undefined);
  await app.close();
});

test("Phase G routes require a verified bearer session and expose new/returning state", async () => {
  const app = await createApi({
    phaseG: {
      sessions: {
        authenticate: async (header) => {
          if (header !== "Bearer valid") throw new UnauthorizedError("Authentication is required.");
          return {
            identity: {
              provider: "TEST",
              providerSubject: "subject",
              email: "candidate@example.com",
              expiresAt: new Date("2026-09-02T00:00:00.000Z")
            },
            account: {
              accountId: "10000000-0000-4000-8000-000000000001",
              userId: "10000000-0000-4000-8000-000000000002",
              accountType: "NORMAL",
              accountStatus: "ACTIVE",
              userStatus: "ACTIVE",
              membershipRole: "OWNER"
            },
            candidate: {
              accountId: "10000000-0000-4000-8000-000000000001",
              candidateId: "20000000-0000-4000-8000-000000000001",
              stage: "WELCOME",
              completed: false,
              isNewCandidate: true,
              version: 1,
              startedAt: new Date("2026-09-01T00:00:00.000Z"),
              completedAt: null
            }
          };
        }
      }
    }
  });
  const unauthorized = await app.inject({ method: "GET", url: "/v1/onboarding" });
  assert.equal(unauthorized.statusCode, 401);
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/bootstrap",
    headers: { authorization: "Bearer valid" }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().candidate.new, true);
  assert.equal(response.json().onboarding.stage, "WELCOME");
  const logout = await app.inject({
    method: "POST",
    url: "/v1/auth/logout",
    headers: { authorization: "Bearer valid" }
  });
  assert.equal(logout.statusCode, 204);
  await app.close();
});

test("Phase G profile routes derive tenant and candidate ownership only from the verified session", async () => {
  const expectedAccountId = "10000000-0000-4000-8000-000000000001";
  const expectedCandidateId = "20000000-0000-4000-8000-000000000001";
  let profileRead: { accountId: string; candidateId: string } | null = null;
  const profiles = {
    get: async (accountId: string, candidateId: string) => {
      profileRead = { accountId, candidateId };
      return {
        candidateId,
        answers: [],
        pendingResumeItems: 0,
        conflictingResumeItems: 0,
        onboardingVersion: 1,
        onboardingCompleted: false
      };
    },
    save: async () => { throw new Error("not invoked"); },
    history: async () => [],
    readiness: async () => ({ ready: false, requirements: [], needsConfirmation: 0, staleItems: 0, conflicts: 0 }),
    complete: async () => { throw new Error("not invoked"); },
    undo: async () => { throw new Error("not invoked"); },
    restore: async () => { throw new Error("not invoked"); },
    reversalHistory: async () => []
  } as unknown as NonNullable<PhaseGApiServices["profiles"]>;
  const app = await createApi({
    phaseG: {
      sessions: {
        authenticate: async (header) => {
          if (header !== "Bearer valid") throw new UnauthorizedError("Authentication is required.");
          return {
            identity: {
              provider: "TEST",
              providerSubject: "subject",
              email: "candidate@example.com",
              expiresAt: new Date("2026-09-02T00:00:00.000Z")
            },
            account: {
              accountId: expectedAccountId,
              userId: "10000000-0000-4000-8000-000000000002",
              accountType: "NORMAL",
              accountStatus: "ACTIVE",
              userStatus: "ACTIVE",
              membershipRole: "OWNER"
            },
            candidate: {
              accountId: expectedAccountId,
              candidateId: expectedCandidateId,
              stage: "PROFILE",
              completed: false,
              isNewCandidate: false,
              version: 1,
              startedAt: new Date("2026-09-01T00:00:00.000Z"),
              completedAt: null
            }
          };
        }
      },
      profiles
    }
  });

  const unauthorized = await app.inject({ method: "GET", url: "/v1/profile" });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(profileRead, null);

  const authorized = await app.inject({
    method: "GET",
    url: "/v1/profile?candidateId=ffffffff-ffff-4fff-8fff-ffffffffffff",
    headers: { authorization: "Bearer valid" }
  });
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(profileRead, { accountId: expectedAccountId, candidateId: expectedCandidateId });
  assert.equal(authorized.json().candidateId, expectedCandidateId);
  await app.close();
});

test("Phase H discovery is protected and derives candidate ownership from the bearer session", async () => {
  const accountId = "10000000-0000-4000-8000-000000000021";
  const candidateId = "20000000-0000-4000-8000-000000000021";
  let requested: { accountId: string; candidateId: string } | null = null;
  const capturedSave: { preferences: Record<string, unknown> | null } = { preferences: null };
  const phaseH: PhaseHApiServices = {
    sessions: {
      authenticate: async (header) => {
        if (header !== "Bearer valid") throw new UnauthorizedError("Authentication is required.");
        return {
          identity: { provider: "TEST", providerSubject: "subject", email: "candidate@example.com", expiresAt: new Date("2026-09-02T00:00:00.000Z") },
          account: {
            accountId, userId: "10000000-0000-4000-8000-000000000022", accountType: "NORMAL",
            accountStatus: "ACTIVE", userStatus: "ACTIVE", membershipRole: "OWNER"
          },
          candidate: {
            accountId, candidateId, stage: "READY", completed: true, isNewCandidate: false,
            version: 2, startedAt: new Date("2026-09-01T00:00:00.000Z"), completedAt: new Date("2026-09-01T01:00:00.000Z")
          }
        };
      }
    },
    discovery: {
      discover: async (input) => {
        requested = { accountId: input.accountId, candidateId: input.candidateId };
        return { items: [], nextCursor: null, catalogTruncated: false, policyVersion: "H1-DETERMINISTIC-2026-09" };
      },
      detail: async () => { throw new Error("not invoked"); },
      related: async () => { throw new Error("not invoked"); }
    },
    searchProfiles: {
      get: async (_accountId, requestedCandidateId) => ({
        candidateId: requestedCandidateId, version: 0,
        preferences: {
          version: 1, targetRoleFamilies: [], acceptableRoleFamilies: [], preferredWorkModes: [],
          preferredCountryCodes: [], excludedCompanyNames: [], minimumCompensationMinor: null,
          compensationCurrencyCode: null,
          dealBreakers: { mandatoryRelocation: false, nightShift: false, heavyTravel: false, employmentBond: false }
        },
        updatedAt: null
      }),
      save: async (input) => {
        capturedSave.preferences = input.preferences;
        return {
          candidateId: input.candidateId,
          version: input.expectedVersion + 1,
          preferences: input.preferences,
          updatedAt: new Date("2026-09-01T02:00:00.000Z"),
          idempotentReplay: false
        };
      }
    }
  };
  const app = await createApi({ phaseH });
  const unauthorized = await app.inject({ method: "GET", url: "/v1/jobs" });
  assert.equal(unauthorized.statusCode, 401);
  const injection = await app.inject({
    method: "GET",
    url: "/v1/jobs?candidateId=ffffffff-ffff-4fff-8fff-ffffffffffff",
    headers: { authorization: "Bearer valid" }
  });
  assert.equal(injection.statusCode, 200);
  assert.deepEqual(requested, { accountId, candidateId }, "caller-supplied identity must never replace session ownership");
  const authorized = await app.inject({
    method: "GET", url: "/v1/jobs?limit=10", headers: { authorization: "Bearer valid" }
  });
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(requested, { accountId, candidateId });
  const malformedPreferences = await app.inject({
    method: "PUT", url: "/v1/job-search/profile",
    headers: { authorization: "Bearer valid", "x-idempotency-key": "phase-h-invalid-profile" },
    payload: { expectedVersion: 0, preferences: { version: 1, targetRoleFamilies: ["INVALID"], dealBreakers: {} } }
  });
  assert.equal(malformedPreferences.statusCode, 400);
  assert.equal(malformedPreferences.json().error.code, "VALIDATION_ERROR");
  const validNullPreferences = await app.inject({
    method: "PUT", url: "/v1/job-search/profile",
    headers: { authorization: "Bearer valid", "x-idempotency-key": "phase-h-null-preferences" },
    payload: {
      expectedVersion: 0,
      preferences: {
        version: 1, targetRoleFamilies: ["BACKEND"], acceptableRoleFamilies: [],
        preferredWorkModes: ["HYBRID"], preferredCountryCodes: ["IN"],
        excludedCompanyNames: [], minimumCompensationMinor: null,
        compensationCurrencyCode: null,
        dealBreakers: { mandatoryRelocation: true, nightShift: true, heavyTravel: true, employmentBond: true }
      }
    }
  });
  assert.equal(validNullPreferences.statusCode, 200);
  assert.equal(capturedSave.preferences?.minimumCompensationMinor, null);
  assert.equal(capturedSave.preferences?.compensationCurrencyCode, null);
  await app.close();
});

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { IdentityAccount, IdentityRepository } from "./index.js";
import { IdentityService, OidcJwtIdentityVerifier, StaticIdentityTokenVerifier } from "./index.js";

const identity = {
  provider: "SUPABASE" as const,
  providerSubject: "auth-user-1",
  email: "engineer@example.com"
};

test("creates a NORMAL account independently of plan or subscription", async () => {
  let createdType = "";
  const expected: IdentityAccount = {
    accountId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
    accountType: "NORMAL",
    accountStatus: "ACTIVE",
    userStatus: "ACTIVE",
    membershipRole: "OWNER"
  };
  const repository: IdentityRepository = {
    findByExternalIdentity: async () => null,
    createAccountWithOwner: async (input) => {
      createdType = input.accountType;
      return expected;
    }
  };

  const result = await new IdentityService(repository, { now: () => new Date("2026-09-01T00:00:00Z") }).ensureNormalAccount(identity);
  assert.equal(createdType, "NORMAL");
  assert.deepEqual(result, expected);
});

test("returns an existing account without creating another one", async () => {
  let createCount = 0;
  const existing: IdentityAccount = {
    accountId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
    accountType: "TEST",
    accountStatus: "ACTIVE",
    userStatus: "ACTIVE",
    membershipRole: "OWNER"
  };
  const repository: IdentityRepository = {
    findByExternalIdentity: async () => existing,
    createAccountWithOwner: async () => {
      createCount += 1;
      return existing;
    }
  };

  assert.deepEqual(await new IdentityService(repository).ensureNormalAccount(identity), existing);
  assert.equal(createCount, 0);
});

test("recovers from a concurrent first-account creation race", async () => {
  const concurrent: IdentityAccount = {
    accountId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
    accountType: "NORMAL",
    accountStatus: "ACTIVE",
    userStatus: "ACTIVE",
    membershipRole: "OWNER"
  };
  let lookups = 0;
  const repository: IdentityRepository = {
    findByExternalIdentity: async () => (++lookups === 1 ? null : concurrent),
    createAccountWithOwner: async () => {
      throw new Error("unique violation");
    }
  };

  assert.deepEqual(await new IdentityService(repository).ensureNormalAccount(identity), concurrent);
});

test("does not disguise an infrastructure or seed failure as a conflict", async () => {
  const failure = new Error("FREE plan missing");
  const repository: IdentityRepository = {
    findByExternalIdentity: async () => null,
    createAccountWithOwner: async () => {
      throw failure;
    }
  };

  await assert.rejects(new IdentityService(repository).ensureNormalAccount(identity), (error) => error === failure);
});

test("rejects a suspended user even when the account remains active", async () => {
  const repository: IdentityRepository = {
    findByExternalIdentity: async () => ({
      accountId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      accountType: "NORMAL",
      accountStatus: "ACTIVE",
      userStatus: "SUSPENDED",
      membershipRole: "OWNER"
    }),
    createAccountWithOwner: async () => {
      throw new Error("not reached");
    }
  };
  await assert.rejects(
    new IdentityService(repository).ensureNormalAccount(identity),
    (error: unknown) => error instanceof Error && error.message === "This user or account is not active."
  );
});

test("static verifier requires an exact Bearer header and never accepts a caller identity header", async () => {
  const expected = {
    provider: "TEST",
    providerSubject: "subject-1",
    email: "engineer@example.com",
    tokenId: "token-1",
    expiresAt: new Date("2026-09-02T00:00:00Z")
  };
  const verifier = new StaticIdentityTokenVerifier(async (token) => {
    assert.equal(token, "verified-token");
    return expected;
  });
  assert.deepEqual(await verifier.verifyAuthorizationHeader("Bearer verified-token"), expected);
  await assert.rejects(verifier.verifyAuthorizationHeader(undefined), /Authentication is required/);
  await assert.rejects(
    verifier.verifyAuthorizationHeader("candidate-id-from-caller"),
    /authorization header is invalid/
  );
});

test("OIDC verifier validates signature, issuer, audience, expiry and subject", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [{ ...jwk, kid: "test-key", use: "sig", alg: "RS256" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const issuer = "https://identity.example.test";
    const now = new Date("2026-09-01T10:00:00.000Z");
    const verifier = new OidcJwtIdentityVerifier(
      {
        provider: "SUPABASE",
        issuer,
        audience: "authenticated",
        jwksUrl: new URL(`http://127.0.0.1:${address.port}/jwks`)
      },
      { now: () => now }
    );
    const token = await new SignJWT({ email: "Engineer@Example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("auth-user-1")
      .setIssuer(issuer)
      .setAudience("authenticated")
      .setIssuedAt(Math.floor(now.getTime() / 1_000))
      .setExpirationTime(Math.floor(now.getTime() / 1_000) + 600)
      .sign(privateKey);
    const verified = await verifier.verifyAuthorizationHeader(`Bearer ${token}`);
    assert.equal(verified.providerSubject, "auth-user-1");
    assert.equal(verified.email, "engineer@example.com");

    const wrongAudience = await new SignJWT({ email: "engineer@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("auth-user-1")
      .setIssuer(issuer)
      .setAudience("wrong")
      .setExpirationTime(Math.floor(now.getTime() / 1_000) + 600)
      .sign(privateKey);
    await assert.rejects(
      verifier.verifyAuthorizationHeader(`Bearer ${wrongAudience}`),
      /could not be verified/
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { OperatorTokenVerifier } from "./operator.js";

test("operator tokens require signed issuer, audience, expiry and fresh MFA, not role claims", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const server = createServer((_request, response) => { response.setHeader("content-type","application/json"); response.end(JSON.stringify({ keys: [{ ...jwk, kid: "operator", alg: "RS256", use: "sig" }] })); });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address === "object");
    const issuer = "https://identity.example.test", now = Math.floor(Date.now()/1000);
    const verifier = new OperatorTokenVerifier({ issuer, audience: "operator-test", jwksUrl: new URL(`http://127.0.0.1:${address.port}/jwks`) });
    const sign = (claims: Record<string, unknown>, audience = "operator-test", expiry = now + 300) => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "operator" }).setSubject("subject").setIssuer(issuer).setAudience(audience).setExpirationTime(expiry).sign(privateKey);
    const claims = { auth_time: now - 10, amr: ["mfa"] };
    assert.deepEqual(await verifier.verify(`Bearer ${await sign(claims)}`), { issuer, subject: "subject" });
    for (const rejected of [{ role: "ADMIN" }, { ...claims, amr: ["pwd"] }, { ...claims, auth_time: now-901 }, { ...claims, auth_time: now+300 }]) await assert.rejects(verifier.verify(`Bearer ${await sign(rejected)}`));
    await assert.rejects(verifier.verify(`Bearer ${await sign(claims,"wrong")}`));
    await assert.rejects(verifier.verify(`Bearer ${await sign(claims,"operator-test",now-1)}`));
    await assert.rejects(verifier.verify("Bearer development-token"));
  } finally { await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
});

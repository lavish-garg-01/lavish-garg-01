import assert from "node:assert/strict";
import test from "node:test";
import { allowedWebOrigins, readApiConfig } from "./config.js";
import { createDevelopmentIdentityVerifier } from "./development-auth.js";

const core = {
  DATABASE_URL: "postgresql://localhost/job_hunter_v2",
  CANDIDATE_VALUE_HMAC_SECRET: "candidate-secret-that-is-at-least-32-bytes",
  RESUME_PROPOSAL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64")
};

test("fingerprint history configuration rejects unsafe versions without exposing key contents",()=>{
  const base={...core,ENABLE_DEV_AUTH:"true",DEV_AUTH_TOKEN:"synthetic-development-token"};
  assert.equal(readApiConfig(base).CANDIDATE_VALUE_HMAC_KEY_VERSION,1);
  const secret="synthetic-historical-secret-at-least-32-bytes";
  const history=JSON.stringify([{keyVersion:1,secret}]);
  assert.equal(readApiConfig({...base,CANDIDATE_VALUE_HMAC_KEY_VERSION:"2",CANDIDATE_VALUE_HMAC_PREVIOUS_KEYS:history}).CANDIDATE_VALUE_HMAC_PREVIOUS_KEYS?.length,1);
  for(const raw of [secret,JSON.stringify({secret}),JSON.stringify([{keyVersion:0,secret}]),JSON.stringify([{keyVersion:2,secret}]),JSON.stringify([{keyVersion:1,secret},{keyVersion:1,secret}])]){
    assert.throws(()=>readApiConfig({...base,CANDIDATE_VALUE_HMAC_KEY_VERSION:"2",CANDIDATE_VALUE_HMAC_PREVIOUS_KEYS:raw}),error=>{assert.equal(String(error).includes(secret),false);return true;});
  }
  assert.throws(()=>readApiConfig({CANDIDATE_VALUE_HMAC_KEY_VERSION:"2"}),/active secret/);
});

test("operator activation requires a separate database and complete identity configuration",()=>{
  assert.equal(readApiConfig({}).OPERATOR_DATABASE_URL,undefined);
  assert.throws(()=>readApiConfig({ENABLE_OPERATOR_REVIEW:"true"}),/dedicated OPERATOR_DATABASE_URL/);
  const config=readApiConfig({...core,ENABLE_OPERATOR_REVIEW:"true",OPERATOR_DATABASE_URL:"postgresql://review_api@localhost/job_hunter_v2",OIDC_PROVIDER:"test",OIDC_ISSUER:"https://identity.example.test",OIDC_AUDIENCE:"operator",OIDC_JWKS_URL:"https://identity.example.test/jwks"});
  assert.equal(config.ENABLE_OPERATOR_REVIEW,true);
  assert.notEqual(config.OPERATOR_DATABASE_URL,config.DATABASE_URL);
});

test("development auth requires an explicit token, development mode and a loopback host", async () => {
  const config = readApiConfig({
    ...core, NODE_ENV: "development", HOST: "127.0.0.1",
    ENABLE_DEV_AUTH: "true", DEV_AUTH_TOKEN: "local-development-token"
  });
  assert.equal(config.ENABLE_DEV_AUTH, true);
  assert.equal(config.OIDC_ISSUER, undefined);
  assert.deepEqual(allowedWebOrigins(config), ["http://127.0.0.1:3000", "http://localhost:3000"]);
  assert.deepEqual(allowedWebOrigins({ NODE_ENV: "production", WEB_ORIGIN: "https://app.example.com" }), ["https://app.example.com"]);
  assert.throws(() => readApiConfig({
    ...core, NODE_ENV: "production", HOST: "127.0.0.1",
    ENABLE_DEV_AUTH: "true", DEV_AUTH_TOKEN: "local-development-token"
  }), /Development authentication|Production requires/);
  assert.throws(() => readApiConfig({
    ...core, NODE_ENV: "development", HOST: "0.0.0.0",
    ENABLE_DEV_AUTH: "true", DEV_AUTH_TOKEN: "local-development-token"
  }), /loopback/);

  const verifier = createDevelopmentIdentityVerifier(
    "local-development-token", "Developer@JobHunter.Local",
    { now: () => new Date("2026-09-01T10:00:00.000Z") }
  );
  const identity = await verifier.verifyAuthorizationHeader("Bearer local-development-token");
  assert.equal(identity.provider, "LOCAL_DEVELOPMENT");
  assert.equal(identity.email, "developer@jobhunter.local");
  await assert.rejects(verifier.verifyAuthorizationHeader("Bearer wrong-token-value"), /invalid/);
});

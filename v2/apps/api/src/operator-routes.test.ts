import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedError } from "@job-hunter-v2/domain";
import { createApi } from "./app.js";

test("operator routes are absent by default and cannot accept browser authority claims", async () => {
  const disabled = await createApi({});
  assert.equal((await disabled.inject({ method:"GET",url:"/v1/operator/cases" })).statusCode,404); await disabled.close();
  let writes = 0;
  const app = await createApi({ operators: { verifier: { verify: async header => { if(header !== "Bearer verified") throw new UnauthorizedError("No operator authentication"); return { issuer:"issuer",subject:"subject" }; } }, repository: {
    list: async () => ({ cases: [], evidence:"VALUE_FREE_FAILURE_COUNTS_ONLY" }),
    detail: async (_identity,caseId) => ({id:caseId,revision:1,layer:"UNASSIGNED",reproduction:"NONE",expectedBehavior:"UNSPECIFIED",timeline:[],members:[],mergedInto:null,evidence:"SYNTHETIC_REFERENCE_NOT_EVALUATION"}),
    edit: async (_identity,_caseId,input) => ({revision:input.expectedRevision+1}),
    provision: async () => ({updated:true}),
    transition: async (identity, input) => { assert.deepEqual(identity,{issuer:"issuer",subject:"subject"}); writes++; return {revision:input.expectedRevision+1,status:input.status,replay:false}; }
  } } });
  assert.equal((await app.inject({method:"GET",url:"/v1/operator/cases"})).statusCode,401);
  assert.equal((await app.inject({method:"POST",url:"/v1/operator/support",headers:{authorization:"Bearer verified"},payload:{}})).statusCode,404,"operator dashboard activation alone does not activate private support");
  const headers = {authorization:"Bearer verified"};
  const result = await app.inject({method:"GET",url:"/v1/operator/cases",headers}); assert.equal(result.statusCode,200); assert.equal(result.headers["cache-control"],"no-store");
  const url = `/v1/operator/cases/${crypto.randomUUID()}/status`, payload = {requestId:crypto.randomUUID(),expectedRevision:1,status:"INVESTIGATING"};
  assert.equal((await app.inject({method:"POST",url,headers,payload:{...payload,role:"ADMIN"}})).statusCode,400);
  assert.equal((await app.inject({method:"POST",url,headers,payload})).statusCode,200); assert.equal(writes,1);
  const reviewUrl = url.replace('/status','/review');
  const edit = {requestId:crypto.randomUUID(),expectedRevision:1,layer:"EXECUTION",reproduction:"OPERATOR_REVIEW",expectedBehavior:"REQUIRE_CONFIRMATION"};
  assert.equal((await app.inject({method:"POST",url:reviewUrl,headers,payload:edit})).statusCode,200);
  assert.equal((await app.inject({method:"POST",url:reviewUrl,headers,payload:{...edit,reproduction:"https://untrusted.test"}})).statusCode,400);
  assert.equal((await app.inject({method:"POST",url:'/v1/operator/roles',payload:{}})).statusCode,401);
  assert.equal((await app.inject({method:"POST",url:'/v1/operator/roles',headers,payload:{requestId:crypto.randomUUID(),issuer:'https://issuer.test',subject:'peer',role:'ADMIN',active:true,actorId:'forged'}})).statusCode,400);
  await app.close();
});

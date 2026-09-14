import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "./app.js";
import { readApiConfig } from "./config.js";
import { UnauthorizedError } from "@job-hunter-v2/domain";
import { builtinDefinitions } from "@job-hunter-v2/strategy-intelligence";
test("reviewed exports have separate activation and no caller-uploaded evaluation authority",async()=>{
  assert.equal(readApiConfig({}).ENABLE_REVIEWED_EXPORTS,false);
  const disabled=await createApi({});assert.equal((await disabled.inject({method:"POST",url:"/v1/operator/artifacts",payload:{}})).statusCode,404);await disabled.close();
  const id=crypto.randomUUID(),caseId=crypto.randomUUID(),hash="a".repeat(64),who={issuer:"https://identity.example.test",subject:"trusted"};let proposals=0,approvals=0;
  const app=await createApi({operators:{verifier:{verify:async token=>{if(token!=="Bearer operator")throw new UnauthorizedError("No recent MFA");return who;}},repository:{list:async()=>({cases:[],evidence:"VALUE_FREE_FAILURE_COUNTS_ONLY"}),transition:async()=>({revision:2,status:"OPEN",replay:false}),merge:async(identity,source,input)=>{assert.deepEqual(identity,who);return {sourceCaseId:source,targetCaseId:input.targetCaseId,sourceRevision:2,targetRevision:2};}},reviewedExports:{
    propose:async(identity,input)=>{assert.deepEqual(identity,who);assert.equal(input.caseId,caseId);proposals++;return {id,artifactHash:hash};},
    approve:async()=>{approvals++;return {id};},prepare:async()=>({id,revision:2,mode:"EXPORT_ONLY_NOT_DEPLOYED"}),control:async()=>({revision:3,mode:"EXPORT_ONLY_NOT_DEPLOYED"}),
    inspect:async()=>({artifacts:[],strategyKeys:[],state:{revision:1,disabled:true,current_id:null},mode:"EXPORT_ONLY_NOT_DEPLOYED"}),
    manifest:async()=>({exportId:id,artifactHash:hash,definition:builtinDefinitions()[0]!,evaluationHash:hash,suiteHash:hash,apiProtocol:1,extensionProtocol:1,mode:"EXPORT_ONLY_NOT_DEPLOYED"})
  }}});
  try{
    const headers={authorization:"Bearer operator"},payload={requestId:crypto.randomUUID(),caseId,strategyKey:"NATIVE_VALUE_SETTER@1",apiProtocol:1,extensionProtocol:1};
    assert.equal((await app.inject({method:"POST",url:"/v1/operator/artifacts",payload})).statusCode,401);
    for(const invalid of [{...payload,plan:"console.log('injected')"},{...payload,passed:true},{...payload,apiProtocol:2},{...payload,actorId:"forged"}])assert.equal((await app.inject({method:"POST",url:"/v1/operator/artifacts",headers,payload:invalid})).statusCode,400);
    assert.equal(proposals,0);const created=await app.inject({method:"POST",url:"/v1/operator/artifacts",headers,payload});assert.equal(created.statusCode,200);assert.equal(created.headers["cache-control"],"no-store");
    assert.equal((await app.inject({method:"POST",url:"/v1/operator/artifacts/evaluate",headers,payload:{artifactId:id,passed:true}})).statusCode,404);
    const approval={requestId:crypto.randomUUID(),artifactId:id,artifactHash:hash,evaluationId:crypto.randomUUID(),confirmed:true};
    assert.equal((await app.inject({method:"POST",url:"/v1/operator/artifacts/approve",headers,payload:{...approval,proof:{passed:true}}})).statusCode,400);
    assert.equal(approvals,0);assert.equal((await app.inject({method:"POST",url:"/v1/operator/artifacts/approve",headers,payload:approval})).statusCode,200);
    const merge={requestId:crypto.randomUUID(),targetCaseId:id,expectedSourceRevision:1,expectedTargetRevision:1,confirmed:true};
    assert.equal((await app.inject({method:"POST",url:`/v1/operator/cases/${caseId}/merge`,headers,payload:{...merge,confirmed:false}})).statusCode,400);
    assert.equal((await app.inject({method:"POST",url:`/v1/operator/cases/${caseId}/merge`,headers,payload:merge})).statusCode,200);
  }finally{await app.close();}
});

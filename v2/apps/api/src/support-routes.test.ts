import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedError } from "@job-hunter-v2/domain";
import { createApi } from "./app.js";
import { readApiConfig } from "./config.js";

test("support routes require separate activation, strict consent and server-derived identities",async()=>{
  const config=readApiConfig({});assert.equal(config.ENABLE_OPERATOR_PRIVATE_REVIEW,false);
  assert.equal(readApiConfig({ENABLE_OPERATOR_PRIVATE_REVIEW:"true"}).ENABLE_OPERATOR_PRIVATE_REVIEW,true);
  const disabled=await createApi({});assert.equal((await disabled.inject({method:"POST",url:"/v1/operator/support",payload:{}})).statusCode,404);await disabled.close();
  const owner={accountId:crypto.randomUUID(),candidateId:crypto.randomUUID()},identity={issuer:"https://id.example.test",subject:"operator"};
  const id=crypto.randomUUID(),itemId=crypto.randomUUID(),caseId=crypto.randomUUID();let reads=0,approvals=0;
  const grant={id,caseId,issuer:identity.issuer,subject:identity.subject,purpose:"DEBUG_AUTOFILL",status:"PENDING",expiresAt:null};
  const verify=async(header:string|undefined)=>{if(header!=="Bearer operator")throw new UnauthorizedError("Recent MFA required.");return identity;};
  const app=await createApi({operators:{verifier:{verify},repository:{list:async()=>({cases:[],evidence:"VALUE_FREE_FAILURE_COUNTS_ONLY"}),transition:async()=>({revision:2,status:"OPEN",replay:false})},support:{
    sessions:{authenticate:async header=>{if(header!=="Bearer candidate")throw new UnauthorizedError("Candidate required.");return {
      identity:{provider:"TEST",providerSubject:"candidate",email:"synthetic@example.test",expiresAt:new Date()},
      account:{accountId:owner.accountId,userId:crypto.randomUUID(),accountType:"NORMAL",accountStatus:"ACTIVE",userStatus:"ACTIVE",membershipRole:"OWNER"},
      candidate:{...owner,isNewCandidate:false,stage:"READY",completed:true,version:1,startedAt:new Date(),completedAt:new Date()}
    };}},repository:{
      request:async(who,input)=>{assert.deepEqual(who,identity);assert.equal(input.caseId,caseId);return grant;},
      preview:async(who,g,n)=>{assert.deepEqual(who,owner);assert.equal(g,id);assert.equal(n,itemId);return grant;},
      approve:async(who,g,input)=>{assert.deepEqual(who,owner);assert.equal(g,id);assert.equal(input.confirmed,true);approvals++;return grant;},
      revoke:async(who)=>{assert.deepEqual(who,owner);return {revoked:true};},list:async()=>({grants:[grant]}),listForNote:async()=>({grants:[grant]}),
      read:async(who,g)=>{assert.deepEqual(who,identity);reads++;return {grantId:g,expiresAt:new Date(),evidence:{question:"Synthetic",answer:"Private"},containsCandidateValue:true};}
    }
  }}});
  try {
    const candidate={authorization:"Bearer candidate"},operator={authorization:"Bearer operator"};
    const url=`/v1/support/${id}/approve`,payload={itemId,durationMinutes:15,confirmed:true};
    for(const invalid of [{...payload,confirmed:false},{...payload,durationMinutes:120},{...payload,accountId:owner.accountId},{...payload,role:"ADMIN"}])assert.equal((await app.inject({method:"POST",url,headers:candidate,payload:invalid})).statusCode,400);
    assert.equal(approvals,0);
    assert.equal((await app.inject({method:"POST",url,headers:operator,payload})).statusCode,401);
    const approved=await app.inject({method:"POST",url,headers:candidate,payload});assert.equal(approved.statusCode,200);assert.equal(approved.headers["cache-control"],"no-store");assert.equal(approvals,1);
    const read=`/v1/operator/support/${id}/read`;
    assert.equal((await app.inject({method:"POST",url:read,headers:candidate,payload:{}})).statusCode,401);
    assert.equal((await app.inject({method:"GET",url:read,headers:operator})).statusCode,404);
    assert.equal((await app.inject({method:"POST",url:read,headers:operator,payload:{candidateId:owner.candidateId}})).statusCode,400);assert.equal(reads,0);
    const result=await app.inject({method:"POST",url:read,headers:operator,payload:{}});assert.equal(result.statusCode,200);assert.equal(result.headers["cache-control"],"no-store");assert.equal(reads,1);
    assert.equal((await app.inject({method:"POST",url:`/v1/support/${id}/preview`,headers:candidate,payload:{itemId}})).statusCode,200);
    assert.equal((await app.inject({method:"POST",url:`/v1/support/${id}/revoke`,headers:candidate,payload:{}})).statusCode,200);
    assert.equal((await app.inject({method:"POST",url:"/v1/operator/support",headers:operator,payload:{requestId:crypto.randomUUID(),caseId,purpose:"DEBUG_AUTOFILL"}})).statusCode,200);
    assert.equal((await app.inject({method:"POST",url:"/v1/operator/support",headers:operator,payload:{requestId:crypto.randomUUID(),caseId,purpose:"EXPORT_PROFILE"}})).statusCode,400);
  }finally{await app.close();}
});

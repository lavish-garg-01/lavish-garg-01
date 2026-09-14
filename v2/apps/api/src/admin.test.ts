import assert from "node:assert/strict";
import test from "node:test";
import { AdminAuth, registerAdminAuth } from "./admin-auth.js";
import Fastify from "fastify";
import { readApiConfig } from "./config.js";
import { adminFixture } from "./admin-test-fixture.js";
import { canonicalAliasRevision } from "@job-hunter-v2/field-intelligence";

test("admin login is separate, expiring, revocable and rate limited",()=>{
  let now=1000;const auth=new AdminAuth("admin@example.test","long-admin-password",()=>now);
  assert.equal(auth.login("wrong@example.test","long-admin-password","1"),null);
  const token=auth.login("ADMIN@example.test","long-admin-password","1");assert.ok(token);assert.ok(auth.verify(`Bearer ${token}`));
  assert.equal(auth.verify("Bearer candidate-token"),false);auth.logout(`Bearer ${token}`);assert.equal(auth.verify(`Bearer ${token}`),false);
  const expired=auth.login("admin@example.test","long-admin-password","2");now+=28800001;assert.equal(auth.verify(`Bearer ${expired}`),false);
  for(let i=0;i<10;i++)assert.equal(auth.login("admin@example.test","wrong","3"),null);
  assert.equal(auth.login("admin@example.test","long-admin-password","3"),null);now+=900001;assert.ok(auth.login("admin@example.test","long-admin-password","3"));
});

test("admin HTTP login distinguishes incorrect credentials from a temporary rate limit", async t=>{
  let now=1000;
  const app=Fastify();t.after(()=>app.close());
  await app.register(async scoped=>registerAdminAuth(scoped,new AdminAuth("admin@example.test","long-admin-password",()=>now)));
  const login=(password:string)=>app.inject({method:"POST",url:"/v1/admin/login",payload:{email:"admin@example.test",password}});
  for(let i=0;i<10;i++){
    const failed=await login("wrong-password");assert.equal(failed.statusCode,401);assert.equal(failed.json().error.code,"ADMIN_LOGIN_FAILED");assert.equal(failed.headers["retry-after"],undefined);
  }
  const limited=await login("long-admin-password");assert.equal(limited.statusCode,429);assert.equal(limited.json().error.code,"ADMIN_LOGIN_RATE_LIMITED");assert.equal(limited.headers["retry-after"],"900");
  now+=900001;
  assert.equal((await login("long-admin-password")).statusCode,200);
});

test("admin configuration supports no OIDC but refuses partial credentials and remote production access",()=>{
  const core={DATABASE_URL:"postgresql://localhost/job_hunter_v2",CANDIDATE_VALUE_HMAC_SECRET:"test-hmac-secret".repeat(3),RESUME_PROPOSAL_ENCRYPTION_KEY:Buffer.alloc(32,1).toString("base64"),ADMIN_EMAIL:"admin@example.test",ADMIN_PASSWORD:"long-admin-password"};
  assert.equal(readApiConfig(core).ADMIN_EMAIL,core.ADMIN_EMAIL);
  assert.throws(()=>readApiConfig({...core,ADMIN_PASSWORD:undefined}),/together/);
  assert.throws(()=>readApiConfig({...core,ADMIN_PASSWORD:"short"}));
  assert.throws(()=>readApiConfig({...core,HOST:"0.0.0.0"}),/local/);
  assert.throws(()=>readApiConfig({...core,NODE_ENV:"production"}),/local/);
});

test("admin API with real schema: auth, every read, private versioning, CAS, audit and strategy gates",async t=>{
  const f=await adminFixture();t.after(()=>f.close());
  assert.equal((await f.app.inject({url:"/health"})).statusCode,200);
  for(const url of ["/v1/admin/overview","/v1/admin/registry",`/v1/admin/candidates/${f.user.candidate.candidateId}`]) {
    assert.equal((await f.app.inject({url})).statusCode,401);
    assert.equal((await f.app.inject({url,headers:{authorization:"Bearer synthetic-candidate"}})).statusCode,401);
  }
  const login=await f.app.inject({method:"POST",url:"/v1/admin/login",payload:{email:"admin@example.test",password:"synthetic-admin-password"}});
  assert.equal(login.statusCode,200,login.body);const headers={authorization:`Bearer ${login.json().token}`};
  const get=(url:string)=>f.app.inject({url:`/v1/admin${url}`,headers});
  const post=(url:string,payload:unknown)=>f.app.inject({method:"POST",url:`/v1/admin${url}`,headers,payload:payload as Record<string,unknown>});
  for(const section of ["users","applications","runs","jobs","documents","ai","learning","evidence","failures","proposals","strategies","audit","workers"]) {
    const r=await get(`/resources/${section}`);assert.equal(r.statusCode,200,`${section}: ${r.body}`);assert.ok(Array.isArray(r.json().items));
  }
  assert.equal((await get("/resources/accounts")).statusCode,400);
  assert.equal((await get("/resources/users?offset=-1")).statusCode,400);
  assert.equal((await get("/overview")).statusCode,200);
  assert.equal((await get("/registry")).statusCode,200);
  assert.equal((await get("/strategy-definitions")).statusCode,200);
  const c=f.user.candidate.candidateId;
  const answer={itemKey:"location",canonicalKey:"CURRENT_LOCATION",normalizedValue:{schemaVersion:1,dataClass:"CANDIDATE_PRIVATE",kind:"STRING",value:"Gurugram"},expectedCurrentVersionId:null};
  const payload={items:[answer],idempotencyKey:crypto.randomUUID(),reason:"Verified candidate correction for synthetic test."};
  const saved=await post(`/candidates/${c}/answers`,payload);assert.equal(saved.statusCode,200,saved.body);
  assert.equal((await post(`/candidates/${c}/answers`,payload)).statusCode,200,"identical replay");
  const graph=await get(`/candidates/${c}`);assert.equal(graph.statusCode,200,graph.body);
  const prior=graph.json().snapshot.answers.find((a:{canonicalKey:string})=>a.canonicalKey==="CURRENT_LOCATION");assert.equal(prior.normalizedValue.value,"Gurugram");
  const revised=await post(`/candidates/${c}/answers`,{...payload,idempotencyKey:crypto.randomUUID(),items:[{...answer,expectedCurrentVersionId:prior.answerVersionId,normalizedValue:{...answer.normalizedValue,value:"Delhi"}}]});assert.equal(revised.statusCode,200,revised.body);
  assert.equal((await post(`/candidates/${c}/answers`,{...payload,idempotencyKey:crypto.randomUUID()})).statusCode,409,"stale write rejected");
  const after=(await get(`/candidates/${c}`)).json();assert.equal(after.history.length,2);assert.equal(after.snapshot.answers[0].normalizedValue.value,"Delhi");
  const cfg={kind:"CANONICAL",key:"EMAIL",expectedRevision:0,value:{description:"Contact email",aliases:["candidate electronic address"]},reason:"Verified alternative email label from test."};
  const before=canonicalAliasRevision();assert.equal((await post("/configuration",cfg)).statusCode,200);assert.ok(canonicalAliasRevision()>before);
  assert.equal((await post("/configuration",cfg)).statusCode,409);
  assert.equal((await post("/configuration",{...cfg,key:"PRIVACY_ACKNOWLEDGEMENT"})).statusCode,400);
  assert.equal((await post("/configuration",{...cfg,reason:"bad"})).statusCode,400);
  const rep={kind:"REPRESENTATION",key:"CURRENT_CTC",expectedRevision:0,value:{enabled:true,moneyScale:"LAKHS",experienceUnit:"AUTO",notes:""},reason:"Validate rupee-to-lakh formatting default."};
  assert.equal((await post("/configuration",rep)).statusCode,200);
  const preview={canonicalKey:"CURRENT_CTC",label:"Current CTC",controlType:"TEXT",options:[],value:{schemaVersion:1,dataClass:"CANDIDATE_PRIVATE",kind:"MONEY",amountExact:"1400000",currency:"INR",period:"YEAR"}};
  const output=await post("/representation-preview",preview);assert.equal(output.statusCode,200,output.body);assert.equal(output.json().text,"14");
  assert.equal((await post("/representation-preview",{...preview,label:"Current CTC in rupees"})).json().text,"1400000");
  assert.equal((await post("/configuration",{...rep,expectedRevision:1,value:{...rep.value,enabled:false}})).statusCode,200);
  assert.equal((await post("/representation-preview",preview)).statusCode,422);
  const gate=await post("/strategy",{cluster:f.cluster.cluster,key:f.cluster.order[0],expectedRevision:0,idempotencyKey:crypto.randomUUID(),action:"START_CANARY",reason:"Attempt canary without independent offline proof."});assert.equal(gate.statusCode,400,gate.body);
  const audit=(await get("/resources/audit")).json().items;assert.ok(audit.some((a:{action:string})=>a.action==="PROFILE_VERSION_CREATED"));assert.ok(audit.some((a:{action:string})=>a.action==="PRIVATE_GRAPH_READ"));
  assert.ok(!JSON.stringify(audit).includes('"value":"Delhi"'),"private answer text is not copied into audit");
  const restore=await post(`/candidates/${c}/restore`,{versionId:prior.answerVersionId,expectedCurrentVersionId:after.snapshot.answers[0].answerVersionId,idempotencyKey:crypto.randomUUID(),reason:"Restore original candidate location from verified history."});assert.equal(restore.statusCode,200,restore.body);
  assert.equal((await get(`/candidates/${c}`)).json().snapshot.answers[0].normalizedValue.value,"Gurugram");
  assert.equal((await post(`/candidates/${c}/answers`,{...payload,idempotencyKey:crypto.randomUUID(),items:[{...answer,canonicalKey:"WORK_AUTHORIZATION"}]})).statusCode,400,"admin cannot impersonate candidate legal confirmation");
  const accountId=f.user.candidate.accountId,opsReason="Explicit administrative lifecycle test.";
  assert.equal((await post("/operate",{kind:"ACCOUNT",id:accountId,expectedStatus:"ACTIVE",status:"SUSPENDED",reason:opsReason})).statusCode,200);
  assert.equal((await post("/operate",{kind:"ACCOUNT",id:accountId,expectedStatus:"ACTIVE",status:"SUSPENDED",reason:opsReason})).statusCode,409);
  assert.equal((await post("/operate",{kind:"ACCOUNT",id:accountId,expectedStatus:"SUSPENDED",status:"ACTIVE",reason:opsReason})).statusCode,200);
  const company=crypto.randomUUID(),job=crypto.randomUUID(),application=crypto.randomUUID(),run=crypto.randomUUID(),worker=crypto.randomUUID(),failure=crypto.randomUUID();
  await f.pg.query("INSERT INTO companies(id,canonical_name,normalized_name) VALUES($1,'Test Company','test company')",[company]);
  await f.pg.query("INSERT INTO jobs(id,company_id,canonical_title,normalized_title,status,material_fingerprint,first_seen_at,last_seen_at) VALUES($1,$2,'Engineer','engineer','ACTIVE','test',now(),now())",[job,company]);
  assert.equal((await post("/operate",{kind:"JOB",id:job,expectedStatus:"ACTIVE",status:"EXPIRED",reason:opsReason})).statusCode,200);
  assert.ok((await f.pg.query<{closed_at:unknown}>("SELECT closed_at FROM jobs WHERE id=$1",[job])).rows[0]!.closed_at);
  assert.equal((await post("/operate",{kind:"JOB",id:job,expectedStatus:"EXPIRED",status:"ACTIVE",reason:opsReason})).statusCode,200);
  await f.pg.query("INSERT INTO applications(id,account_id,candidate_id,target_url,status) VALUES($1,$2,$3,'https://test.example/apply','IN_PROGRESS')",[application,accountId,c]);
  await f.pg.query("INSERT INTO application_runs(id,application_id,protocol_version,status) VALUES($1,$2,1,'ACTIVE')",[run,application]);
  assert.equal((await post("/operate",{kind:"ABORT_RUN",id:run,expectedStatus:"ACTIVE",reason:opsReason})).statusCode,200);
  assert.equal((await post("/operate",{kind:"ABORT_RUN",id:run,expectedStatus:"ACTIVE",reason:opsReason})).statusCode,409);
  await f.pg.query("INSERT INTO worker_jobs(id,job_type,payload_reference,status,attempt_count) VALUES($1,'Q_STRATEGY','{}','DEAD',8)",[worker]);
  assert.equal((await post("/operate",{kind:"RETRY_WORKER",id:worker,expectedAttempts:8,reason:opsReason})).statusCode,200);
  assert.equal((await post("/operate",{kind:"RETRY_WORKER",id:worker,expectedAttempts:8,reason:opsReason})).statusCode,409);
  await f.pg.query("INSERT INTO autofill_review_cases(id,release,stage,code) VALUES($1,'test','SCAN','TEST_FAILURE')",[failure]);
  assert.equal((await post("/failure-review",{id:failure,expectedRevision:1,status:"INVESTIGATING",reason:opsReason})).statusCode,200);
  assert.equal((await post("/failure-review",{id:failure,expectedRevision:1,status:"RESOLVED",reason:opsReason})).statusCode,409);
  await f.pg.query("INSERT INTO canonical_review_queue(account_id,candidate_id,descriptor_fingerprint,reason) VALUES($1,$2,$3,'ALIAS_REVIEW')",[accountId,c,"b".repeat(64)]);
  assert.equal((await post("/canonical-review",{candidateId:c,fingerprint:"b".repeat(64),expectedStatus:"PENDING_REVIEW",status:"RESOLVED",reason:opsReason})).statusCode,200);
  const proposal={kind:"PROPOSAL",key:"SYNTHETIC_NEW_FIELD",expectedRevision:0,value:{description:"Synthetic canonical proposal",valueType:"STRING",aliases:[],status:"PROPOSED",notes:"Needs implementation"},reason:opsReason};
  assert.equal((await post("/configuration",proposal)).statusCode,200);
  assert.equal((await post("/configuration",{...proposal,expectedRevision:1,value:{...proposal.value,status:"APPROVED_FOR_IMPLEMENTATION"}})).statusCode,200);
  assert.ok(!(await get("/registry")).json().definitions.some((d:{key:string})=>d.key===proposal.key),"approval does not fabricate active runtime support");
  const strategyBase={cluster:f.cluster.cluster,key:f.cluster.order[0],expectedRevision:0,idempotencyKey:crypto.randomUUID(),action:"PROPOSE",payload:{kind:"BUILTIN",implementation:f.cluster.order[0]},reason:opsReason};
  const proposed=await post("/strategy",strategyBase);assert.equal(proposed.statusCode,200,proposed.body);
  const disabled=await post("/strategy",{...strategyBase,key:proposed.json().key,payload:undefined,expectedRevision:proposed.json().state.revision,idempotencyKey:crypto.randomUUID(),action:"DISABLE"});assert.equal(disabled.statusCode,200,disabled.body);
  await assert.rejects(f.pg.exec("DELETE FROM admin_workspace_audit"),/append-only/);
  const logout=await post("/logout",{});assert.equal(logout.statusCode,200);assert.equal((await get("/overview")).statusCode,401);
});

import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { CandidateTruthService, HmacCandidateValueFingerprinter } from "@job-hunter-v2/candidate-truth";
import { AesGcmCandidatePayloadCipher } from "@job-hunter-v2/onboarding";
import { VerifiedLearningService } from "@job-hunter-v2/verified-learning";
import { KyselyCandidateTruthRepository, KyselyVerifiedLearningRepository, KyselyLearningRecovery, OperatorReviewRepository, SupportReviewRepository,
  migrateInitialSchema,migrateCandidateTruthOntology,migrateCandidateTruthMutationGuards,migrateCandidateScopePolicyVectors,migrateCandidateReviewOutcomeProofs,
  migrateCandidateAnswerReversals,migrateJobIntelligence,migrateVerifiedLearningLoop,migrateRepeatableEntityIntelligence,migrateGlobalAnswerDefaults,
  migrateLearningRecovery,migrateLearningNoteConfirmation,migrateLearningInboxLifecycle,migrateOperatorReview,migrateOperatorWorkflow,migrateSupportReview,migrateCaseMerge,migrateLearningFingerprintVersions,
  type SqlClient,type V2Database } from "./index.js";

test("scoped support consent and private reads fail closed across lifecycle boundaries", async t => {
  const pg=new PGlite();
  const executor=(target:Pick<PGlite,"query"|"exec">)=>({query:async<Row extends Record<string,unknown>>(text:string,values?:readonly unknown[])=>({rows:(await target.query<Row>(text,values?[...values]:undefined)).rows}),executeScript:async(text:string)=>{await target.exec(text);}});
  const client:SqlClient={...executor(pg),withTransaction:async work=>pg.transaction(tx=>work(executor(tx)))};
  for(const migrate of [migrateInitialSchema,migrateCandidateTruthOntology,migrateCandidateTruthMutationGuards,migrateCandidateScopePolicyVectors,migrateCandidateReviewOutcomeProofs,
    migrateCandidateAnswerReversals,migrateJobIntelligence,migrateVerifiedLearningLoop,migrateRepeatableEntityIntelligence,migrateGlobalAnswerDefaults,
    migrateLearningRecovery,migrateLearningNoteConfirmation,migrateLearningInboxLifecycle,migrateOperatorReview,migrateOperatorWorkflow,migrateSupportReview,migrateCaseMerge,migrateLearningFingerprintVersions]) await migrate(client);
  const db=new Kysely<V2Database>({dialect:new PGliteDialect({pglite:pg})});
  try {
    const owner={accountId:crypto.randomUUID(),candidateId:crypto.randomUUID()};
    await pg.query("INSERT INTO accounts(id,account_type,contributes_to_global_learning) VALUES($1,'NORMAL',true)",[owner.accountId]);
    const hmac=new HmacCandidateValueFingerprinter("support-review-synthetic-test-secret-32-bytes",1);
    const cipher=new AesGcmCandidatePayloadCipher(new Uint8Array(32).fill(7),1);
    await new CandidateTruthService(new KyselyCandidateTruthRepository(db),hmac).ensureCandidate(owner);
    const secondOwner={accountId:crypto.randomUUID(),candidateId:crypto.randomUUID()};
    await pg.query("INSERT INTO accounts(id,account_type,contributes_to_global_learning) VALUES($1,'NORMAL',true)",[secondOwner.accountId]);
    await new CandidateTruthService(new KyselyCandidateTruthRepository(db),hmac).ensureCandidate(secondOwner);
    const run=await new VerifiedLearningService(new KyselyVerifiedLearningRepository(db),hmac,cipher).startRun({...owner,idempotencyKey:"support-run",request:{schemaVersion:1,requestId:crypto.randomUUID(),jobId:null,targetUrl:"https://apply.example.test/job",extensionVersion:"0.1.0",protocolVersion:1}});
    const recovery=new KyselyLearningRecovery(db,cipher,hmac), support=new SupportReviewRepository(db,cipher);
    const operator={issuer:"https://identity.example.test",subject:"reviewer-one"}, other={...operator,subject:"reviewer-two"};
    for(const who of [operator,other]) await pg.query("INSERT INTO platform_operators(issuer,subject,role,active) VALUES($1,$2,'REVIEWER',true)",[who.issuer,who.subject]);
    await recovery.recordOutcome(owner,{schemaVersion:1,eventId:crypto.randomUUID(),applicationId:run.applicationId,applicationRunId:run.applicationRunId,questionId:null,stage:"EXECUTE",code:"CONTROL_VALIDATION_FAILED",release:"ADAPTIVE_CHECKPOINT_4",containsCandidateValue:false});
    const caseId=(await new OperatorReviewRepository(db).list(operator)).cases[0]!.id;
    const newNote=async()=>{const itemId=crypto.randomUUID();await recovery.capture(owner,{schemaVersion:1,itemId,applicationId:run.applicationId,applicationRunId:run.applicationRunId,question:"Synthetic private question",answer:"Private answer <img src=x onerror=alert(1)>",source:"EXPLICIT_SAVE"});return itemId;};
    const newRequest=()=>support.request(operator,{requestId:crypto.randomUUID(),caseId,purpose:"DEBUG_AUTOFILL"});
    const approved=async()=>{const note=await newNote(),g=await newRequest();await support.approve(owner,g.id,{itemId:note,durationMinutes:15,confirmed:true});return {note,id:g.id};};
    await t.test("request replay is stable, changed inputs rejected; no private data before consent",async()=>{
      const input={requestId:crypto.randomUUID(),caseId,purpose:"DEBUG_AUTOFILL" as const};
      const g=await support.request(operator,input);
      assert.equal((await support.request(operator,input)).id,g.id);
      await assert.rejects(support.request(operator,{...input,purpose:"DEBUG_LEARNING"}),/identity reused/);
      await assert.rejects(support.read(operator,g.id),/unavailable/);
    });
    await t.test("exact note ownership, operator identity and matching recorded failure required",async()=>{
      const note=await newNote(),g=await newRequest();
      await assert.rejects(support.preview({...owner,candidateId:crypto.randomUUID()},g.id,note),/unavailable/);
      await assert.rejects(support.preview({...owner,accountId:crypto.randomUUID()},g.id,note),/unavailable/);
      await assert.rejects(support.preview(secondOwner,g.id,note),/unavailable/);
      await assert.rejects(support.approve(secondOwner,g.id,{itemId:note,durationMinutes:15,confirmed:true}),/unavailable/);
      const preview=await support.preview(owner,g.id,note);assert.equal(preview.subject,operator.subject);assert.equal(JSON.stringify(preview).includes("Private answer"),false);
      const unrelated=crypto.randomUUID();await pg.query("INSERT INTO autofill_review_cases(id,release,stage,code) VALUES($1,'OTHER','SCAN','SCAN_INCOMPLETE')",[unrelated]);
      const wrong=await support.request(operator,{requestId:crypto.randomUUID(),caseId:unrelated,purpose:"DEBUG_LEARNING"});
      await assert.rejects(support.approve(owner,wrong.id,{itemId:note,durationMinutes:15,confirmed:true}),/unavailable/);
      await support.approve(owner,g.id,{itemId:note,durationMinutes:60,confirmed:true});
      await assert.rejects(support.read(other,g.id),/unavailable/);
      assert.deepEqual((await support.list(other,caseId)).grants,[]);
      assert.equal((await support.read(operator,g.id)).evidence.answer,"Private answer <img src=x onerror=alert(1)>");
    });
    await t.test("approval replay never extends duration or reopens revoked access",async()=>{
      const {id,note}=await approved();const input={itemId:note,durationMinutes:15 as const,confirmed:true as const};
      const before=await support.approve(owner,id,input),after=await support.approve(owner,id,input);assert.deepEqual(after.expiresAt,before.expiresAt);
      await assert.rejects(support.approve(owner,id,{...input,durationMinutes:60}),/identity reused/);
      await assert.rejects(support.approve(owner,id,{...input,itemId:await newNote()}),/identity reused/);
      await assert.rejects(support.revoke({...owner,candidateId:crypto.randomUUID()},id),/unavailable/);
      await assert.rejects(support.revoke(secondOwner,id),/unavailable/);
      await assert.rejects(support.listForNote(secondOwner,note),/unavailable/);
      await support.revoke(owner,id);await support.revoke(owner,id);
      assert.equal((await support.approve(owner,id,input)).status,"REVOKED");
      await assert.rejects(support.read(operator,id),/unavailable/);
    });
    await t.test("expired requests and expired grants cannot expose notes",async()=>{
      const note=await newNote(),g=await newRequest();await pg.query("UPDATE support_review_grants SET request_expires_at=now()-interval '1 minute' WHERE id=$1",[g.id]);
      await assert.rejects(support.approve(owner,g.id,{itemId:note,durationMinutes:15,confirmed:true}),/unavailable/);
      const granted=await approved();await pg.query("UPDATE support_review_grants SET expires_at=now()-interval '1 second' WHERE id=$1",[granted.id]);
      await assert.rejects(support.read(operator,granted.id),/unavailable/);
    });
    await t.test("deleting or expiring a note invalidates reads, independent of grant expiry",async()=>{
      const deleted=await approved();await recovery.remove(owner,deleted.note);await assert.rejects(support.read(operator,deleted.id),/unavailable/);
      assert.equal((await support.listForNote(owner,deleted.note)).grants.length,1);await support.revoke(owner,deleted.id);
      const expired=await approved();await pg.query("UPDATE candidate_learning_inbox SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.note]);await assert.rejects(support.read(operator,expired.id),/unavailable/);
      const short=await newNote();await pg.query("UPDATE candidate_learning_inbox SET expires_at=now()+interval '1 minute' WHERE id=$1",[short]);
      const g=await newRequest();const approval=await support.approve(owner,g.id,{itemId:short,durationMinutes:60,confirmed:true});
      assert.ok(new Date(approval.expiresAt!).getTime()<Date.now()+65000);
    });
    await t.test("operator removal and inactive account/candidate block existing grants",async()=>{
      const {id}=await approved();await pg.query("UPDATE platform_operators SET active=false WHERE issuer=$1 AND subject=$2",[operator.issuer,operator.subject]);
      await assert.rejects(support.read(operator,id),/Active operator/);
      await pg.query("UPDATE platform_operators SET active=true WHERE issuer=$1 AND subject=$2",[operator.issuer,operator.subject]);
      await pg.query("UPDATE candidates SET status='DELETED' WHERE id=$1",[owner.candidateId]);await assert.rejects(support.read(operator,id),/unavailable/);
      await pg.query("UPDATE candidates SET status='ACTIVE' WHERE id=$1",[owner.candidateId]);
      await pg.query("UPDATE accounts SET status='SUSPENDED' WHERE id=$1",[owner.accountId]);await assert.rejects(support.read(operator,id),/unavailable/);
      await pg.query("UPDATE accounts SET status='ACTIVE' WHERE id=$1",[owner.accountId]);
    });
    await t.test("read and denial audits are value-free, append-only, and mandatory",async()=>{
      const rows=(await pg.query<{action:string}>("SELECT * FROM support_review_audit")).rows;
      assert.ok(rows.some(row=>row.action==="READ"));assert.ok(rows.some(row=>row.action==="DENIED"));
      assert.equal(JSON.stringify(rows).includes("Private answer"),false);assert.equal(JSON.stringify(rows).includes("Synthetic private question"),false);
      await assert.rejects(pg.exec("DELETE FROM support_review_audit"),/append-only/);
      await assert.rejects(pg.exec("UPDATE support_review_audit SET action='READ'"),/append-only/);
      const {id}=await approved();
      await pg.exec("CREATE FUNCTION deny_support_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit outage'; END $$; CREATE TRIGGER deny_support_audit BEFORE INSERT ON support_review_audit FOR EACH ROW EXECUTE FUNCTION deny_support_audit()");
      await assert.rejects(support.read(operator,id),/synthetic audit outage/);
      await pg.exec("DROP TRIGGER deny_support_audit ON support_review_audit");
    });
    await t.test("malformed decrypted notes never leak parser excerpts through errors",async()=>{
      const {id}=await approved();
      const malformed=new SupportReviewRepository(db,{encrypt:value=>cipher.encrypt(value),decrypt:()=>({schemaVersion:1,dataClass:"CANDIDATE_PRIVATE",kind:"STRING",value:"private-malformed-secret {"})});
      await assert.rejects(malformed.read(operator,id),error=>{assert.ok(error instanceof Error);assert.equal(error.message,"Private note cannot be read.");assert.equal(String(error.stack).includes("private-malformed-secret"),false);return true;});
    });
    await t.test("assignment has revision guards, exclusive claims and authority-safe replay",async()=>{
      const review=new OperatorReviewRepository(db);
      const input={requestId:crypto.randomUUID(),expectedRevision:1,action:"CLAIM" as const};
      const race=await Promise.allSettled([review.assign(operator,caseId,input),review.assign(other,caseId,{...input,requestId:crypto.randomUUID()})]);
      assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
      const row=(await review.list(operator)).cases.find(c=>c.id===caseId)!;
      const winner=row.assigneeSubject===operator.subject?operator:other,loser=winner===operator?other:operator;
      await assert.rejects(review.assign(loser,caseId,{requestId:crypto.randomUUID(),expectedRevision:row.revision,action:"CLAIM"}),/unassigned/);
      await assert.rejects(review.assign(loser,caseId,{requestId:crypto.randomUUID(),expectedRevision:row.revision,action:"RELEASE"}),/assigned operator/);
      await assert.rejects(review.assign(loser,caseId,{requestId:crypto.randomUUID(),expectedRevision:row.revision,action:"ADMIN_RELEASE"}),/administrator/);
      const release={requestId:crypto.randomUUID(),expectedRevision:row.revision,action:"RELEASE" as const};
      const result=await review.assign(winner,caseId,release);assert.deepEqual(await review.assign(winner,caseId,release),result);
      await assert.rejects(review.assign(winner,caseId,{...release,action:"CLAIM"}),/identity.*reused/);
      await assert.rejects(review.transition(winner,{caseId,requestId:release.requestId,expectedRevision:row.revision,status:"RESOLVED"}),/identity.*reused/);
      const claim=await review.assign(operator,caseId,{requestId:crypto.randomUUID(),expectedRevision:result.revision,action:"CLAIM"});
      await pg.query("UPDATE platform_operators SET role='ADMIN' WHERE issuer=$1 AND subject=$2",[other.issuer,other.subject]);
      const adminRelease=await review.assign(other,caseId,{requestId:crypto.randomUUID(),expectedRevision:claim.revision,action:"ADMIN_RELEASE"});
      await review.transition(other,{caseId,requestId:crypto.randomUUID(),expectedRevision:adminRelease.revision,status:"RESOLVED"});
      await assert.rejects(review.assign(operator,caseId,{requestId:crypto.randomUUID(),expectedRevision:adminRelease.revision+1,action:"CLAIM"}),/open, unassigned/);
      const history=await review.detail(operator,caseId);assert.ok(history.timeline.some(e=>e.action==="CASE_ASSIGNED"));assert.ok(history.timeline.some(e=>e.action==="CASE_RELEASED"));
      await pg.query("UPDATE platform_operators SET active=false WHERE issuer=$1 AND subject=$2",[winner.issuer,winner.subject]);
      await assert.rejects(review.assign(winner,caseId,release),/operator access/);
      await pg.query("UPDATE platform_operators SET active=true WHERE issuer=$1 AND subject=$2",[winner.issuer,winner.subject]);
    });
    await t.test("bounded requests retain exact retry identity at capacity",async()=>{
      const quotaCase=crypto.randomUUID();await pg.query("INSERT INTO autofill_review_cases(id,release,stage,code) VALUES($1,'QUOTA','SCAN','SCAN_INCOMPLETE')",[quotaCase]);
      const input={requestId:crypto.randomUUID(),caseId:quotaCase,purpose:"DEBUG_LEARNING" as const};
      const first=await support.request(operator,input);
      for(let i=1;i<20;i++)await support.request(operator,{...input,requestId:crypto.randomUUID()});
      await assert.rejects(support.request(operator,{...input,requestId:crypto.randomUUID()}),/Too many live requests/);
      assert.equal((await support.request(operator,input)).id,first.id);
      const current=(await support.list(operator,quotaCase)).grants;assert.equal(current.length,20);
      await pg.query("UPDATE support_review_grants SET request_expires_at=now()-interval '1 second' WHERE id=$1",[first.id]);
      await support.request(operator,{...input,requestId:crypto.randomUUID()});
      assert.equal((await support.list(operator,quotaCase)).grants.filter(g=>g.status==="PENDING").length,20);
    });
    await t.test("competing approvals bind exactly one note and cannot overwrite consent",async()=>{
      const g=await newRequest(),a=await newNote(),b=await newNote();
      const results=await Promise.allSettled([a,b].map(itemId=>support.approve(owner,g.id,{itemId,durationMinutes:15,confirmed:true})));
      assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
      const saved=(await pg.query<{note_id:string}>("SELECT note_id FROM support_review_grants WHERE id=$1",[g.id])).rows[0]!;
      assert.equal(saved.note_id,results[0]!.status==="fulfilled"?a:b);
      await support.revoke(owner,g.id);await assert.rejects(support.read(operator,g.id),/unavailable/);
    });
    await t.test("case merges preserve distinct-run counts, original history and private consent",async()=>{
      const review=new OperatorReviewRepository(db);
      const current=(await review.list(operator)).cases.find(c=>c.id===caseId)!;
      await review.transition(operator,{caseId,requestId:crypto.randomUUID(),expectedRevision:current.revision,status:"OPEN"});
      await recovery.recordOutcome(owner,{schemaVersion:1,eventId:crypto.randomUUID(),applicationId:run.applicationId,applicationRunId:run.applicationRunId,questionId:null,stage:"PLAN",code:"NO_SAFE_OPERATION",release:"ADAPTIVE_CHECKPOINT_4",containsCandidateValue:false});
      const cases=(await review.list(operator)).cases,source=cases.find(c=>c.id===caseId)!,target=cases.find(c=>c.stage==="PLAN")!;
      const {id:grantId,note}=await approved();
      const request={requestId:crypto.randomUUID(),targetCaseId:target.id,expectedSourceRevision:source.revision,expectedTargetRevision:target.revision,confirmed:true as const};
      await assert.rejects(review.merge(operator,caseId,{...request,targetCaseId:caseId}),/itself/);
      await assert.rejects(review.merge(operator,caseId,{...request,expectedTargetRevision:0+target.revision+1}),/changed/);
      const result=await review.merge(operator,caseId,request);assert.deepEqual(await review.merge(operator,caseId,request),result);
      const after=(await review.list(operator)).cases;assert.equal(after.some(c=>c.id===caseId),false);assert.equal(after.find(c=>c.id===target.id)?.affectedRuns,1,"the same run in two groups is counted once");
      assert.equal((await review.detail(operator,caseId)).mergedInto,target.id);
      const detail=await review.detail(operator,target.id);assert.equal(detail.members.length,2);assert.ok(detail.timeline.some(e=>e.action==="CASE_MERGED"));
      await assert.rejects(review.assign(operator,caseId,{requestId:crypto.randomUUID(),expectedRevision:result.sourceRevision,action:"CLAIM"}),/merged/);
      await assert.rejects(review.transition(operator,{caseId,requestId:crypto.randomUUID(),expectedRevision:result.sourceRevision,status:"INVESTIGATING"}),/merged/);
      await assert.rejects(review.merge(operator,target.id,{...request,requestId:crypto.randomUUID(),targetCaseId:caseId,expectedSourceRevision:result.targetRevision,expectedTargetRevision:result.sourceRevision}),/root cases/);
      assert.equal((await support.read(operator,grantId)).evidence.question,"Synthetic private question");
      assert.ok((await support.list(operator,target.id)).grants.some(g=>g.id===grantId&&g.caseId===caseId));
      assert.equal((await support.list(other,target.id)).grants.some(g=>g.id===grantId),false,"merging does not transfer grant visibility to another operator");
      await assert.rejects(newRequest(),/unavailable/);
      const rootRequest=await support.request(other,{requestId:crypto.randomUUID(),caseId:target.id,purpose:"DEBUG_LEARNING"});
      await support.preview(owner,rootRequest.id,note);
      await assert.rejects(support.read(other,grantId),/unavailable/);
      const third=crypto.randomUUID();await pg.query("INSERT INTO autofill_review_cases(id,release,stage,code) VALUES($1,'THIRD','SCAN','SCAN_INCOMPLETE')",[third]);
      await review.merge(operator,target.id,{requestId:crypto.randomUUID(),targetCaseId:third,expectedSourceRevision:result.targetRevision,expectedTargetRevision:1,confirmed:true});
      assert.equal((await review.detail(operator,caseId)).mergedInto,third);assert.equal((await review.detail(operator,third)).members.length,3);
      assert.equal((await review.list(operator)).cases.find(c=>c.id===third)?.affectedRuns,1);
      await support.revoke(owner,grantId);await assert.rejects(support.read(operator,grantId),/unavailable/);
    });
  } finally {await db.destroy();}
});

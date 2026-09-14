import assert from "node:assert/strict";
import { randomUUID,randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdir,readFile } from "node:fs/promises";
import pg from "pg";
import { sql } from "kysely";
import { createDatabase,KyselyCandidateTruthRepository,KyselyVerifiedLearningRepository,KyselyLearningRecovery,OperatorReviewRepository,SupportReviewRepository,ReviewedExportRepository,KyselyStrategyRepository,assertReviewDatabaseRole } from "@job-hunter-v2/database";
import { CandidateTruthService,HmacCandidateValueFingerprinter } from "@job-hunter-v2/candidate-truth";
import { AesGcmCandidatePayloadCipher } from "@job-hunter-v2/onboarding";
import { VerifiedLearningService } from "@job-hunter-v2/verified-learning";
import { StrategyIntelligenceService } from "@job-hunter-v2/strategy-intelligence";
import { runLearningJourney } from "./learning-journey.js";

// Never reads DATABASE_URL. Only this newly created, labeled, volume-free container is touched.
const name=`job-hunter-review-test-${randomUUID()}`,password=randomBytes(24).toString("hex");
function docker(args:string[]){const r=spawnSync("docker",args,{encoding:"utf8",timeout:60000});if(r.status!==0)throw new Error("Disposable PostgreSQL operation failed (details suppressed).");return r.stdout.trim();}
function cleanup(){const label=docker(["inspect","--format",'{{index .Config.Labels "job-hunter.review-certification"}}',name]);if(label!=="true")throw new Error("Refusing cleanup of an unrecognized container.");docker(["stop",name]);console.log("Removed the disposable test container; no project database or persistent volume was used.");}
let created=false;
try{
  docker(["image","inspect","postgres:17-alpine"]); // Do not implicitly download/install software.
  docker(["run","--detach","--rm","--name",name,"--label","job-hunter.review-certification=true","--tmpfs","/var/lib/postgresql/data","--publish","127.0.0.1::5432","--env",`POSTGRES_PASSWORD=${password}`,"postgres:17-alpine"]);created=true;
  const port=docker(["port",name,"5432/tcp"]).match(/^127\.0\.0\.1:(\d+)$/)?.[1];if(!port)throw new Error("Test database must bind only loopback.");
  const connectionString=`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  const admin=new pg.Client({connectionString});
  let ready=false;
  for(let i=0;i<40;i++){const probe=new pg.Client({connectionString});try{await probe.connect();ready=true;}catch{/* Container init only. */}finally{await probe.end().catch(()=>{});}if(ready)break;await new Promise(r=>setTimeout(r,250));}
  if(!ready)throw new Error("Disposable PostgreSQL was not ready.");
  await admin.connect();
  const db=createDatabase({connectionString});
  const runtimeUrl=`postgresql://review_api_login:${password}@127.0.0.1:${port}/postgres`,evaluatorUrl=`postgresql://review_evaluator_login:${password}@127.0.0.1:${port}/postgres`;
  const runtime=createDatabase({connectionString:runtimeUrl}),evaluator=createDatabase({connectionString:evaluatorUrl});
  try{
    const dir=new URL("../database/migrations/",import.meta.url);
    for(const file of (await readdir(dir)).filter(f=>/^\d{4}_.+\.sql$/.test(f)).sort())await admin.query(await readFile(new URL(file,dir),"utf8"));
    const provisionSql=await readFile(new URL("../database/security/review-service-roles.sql",import.meta.url),"utf8");
    await admin.query(provisionSql);await admin.query(provisionSql); // Idempotent explicit provisioning.
    // Password is generated hex, not an input or a logged credential. Only this disposable DB.
    await admin.query(`CREATE ROLE review_api_login LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; GRANT job_hunter_review_runtime TO review_api_login; CREATE ROLE review_evaluator_login LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; GRANT job_hunter_review_evaluator TO review_evaluator_login`);
    await assertReviewDatabaseRole(runtime,"runtime");await assertReviewDatabaseRole(evaluator,"evaluator");
    await assert.rejects(assertReviewDatabaseRole(db,"runtime"),/unsafe/);
    await assert.rejects(assertReviewDatabaseRole(runtime,"evaluator"),/unsafe/);
    await assert.rejects(sql`INSERT INTO reviewed_evaluations(id,artifact_id,artifact_hash,suite_hash,result_hash,passed,outcome) VALUES(${randomUUID()},${randomUUID()},${"a".repeat(64)},${"a".repeat(64)},${"a".repeat(64)},true,'PASSED')`.execute(runtime),/permission denied/);
    for(const table of ["candidate_answers_current","candidate_answer_versions","documents"]){await assert.rejects(sql.raw(`SELECT * FROM ${table}`).execute(runtime),/permission denied/);await assert.rejects(sql.raw(`SELECT * FROM ${table}`).execute(evaluator),/permission denied/);}
    await assert.rejects(sql`SELECT payload FROM candidate_learning_inbox`.execute(evaluator),/permission denied/);
    await assert.rejects(sql`UPDATE reviewed_export_state SET disabled=false`.execute(evaluator),/permission denied/);
    const owner={accountId:randomUUID(),candidateId:randomUUID()};
    await admin.query("INSERT INTO accounts(id,account_type,contributes_to_global_learning) VALUES($1,'NORMAL',true)",[owner.accountId]);
    const hmac=new HmacCandidateValueFingerprinter("postgres-review-disposable-fixture-only-32",1),cipher=new AesGcmCandidatePayloadCipher(new Uint8Array(32).fill(7),1);
    await new CandidateTruthService(new KyselyCandidateTruthRepository(db),hmac).ensureCandidate(owner);
    const run=await new VerifiedLearningService(new KyselyVerifiedLearningRepository(db),hmac,cipher).startRun({...owner,idempotencyKey:"postgres-certification",request:{schemaVersion:1,requestId:randomUUID(),jobId:null,targetUrl:"https://synthetic.example.test/apply",extensionVersion:"0.1.0",protocolVersion:1}});
    const recovery=new KyselyLearningRecovery(db,cipher,hmac),review=new OperatorReviewRepository(runtime),support=new SupportReviewRepository(runtime,cipher);
    const identity={issuer:"https://synthetic.example.test",subject:"certification-operator"};
    await admin.query("INSERT INTO platform_operators(issuer,subject,role,active) VALUES($1,$2,'REVIEWER',true)",[identity.issuer,identity.subject]);
    await recovery.recordOutcome(owner,{schemaVersion:1,eventId:randomUUID(),applicationId:run.applicationId,applicationRunId:run.applicationRunId,questionId:null,stage:"PLAN",code:"NO_SAFE_OPERATION",release:"ADAPTIVE_CHECKPOINT_4",containsCandidateValue:false});
    const caseId=(await review.list(identity)).cases[0]!.id,itemId=randomUUID();
    await recovery.capture(owner,{schemaVersion:1,itemId,applicationId:run.applicationId,applicationRunId:run.applicationRunId,question:"Synthetic question",answer:"Synthetic private value",source:"EXPLICIT_SAVE"});
    const g=await support.request(identity,{requestId:randomUUID(),caseId,purpose:"DEBUG_AUTOFILL"});
    await support.approve(owner,g.id,{itemId,durationMinutes:15,confirmed:true});assert.equal((await support.read(identity,g.id)).evidence.answer,"Synthetic private value");
    await admin.query("CREATE ROLE review_untrusted NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO review_untrusted; GRANT SELECT,INSERT,UPDATE,DELETE ON platform_operators,autofill_review_cases,operator_review_audit,operator_action_receipts,support_review_grants,support_review_audit,candidate_learning_inbox TO review_untrusted");
    const restricted=new pg.Client({connectionString});await restricted.connect();
    try{
      await restricted.query("SET ROLE review_untrusted");
      await restricted.query("SELECT set_config('app.current_account_id',$1,false)",[owner.accountId]);
      for(const table of ["platform_operators","autofill_review_cases","operator_review_audit","support_review_grants","support_review_audit","candidate_learning_inbox"]){
        assert.ok(Number((await admin.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count)>0);
        assert.equal(Number((await restricted.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count),0,`${table}: no rows for non-owner even with forged tenant settings`);
      }
      await assert.rejects(restricted.query("INSERT INTO platform_operators(issuer,subject,role,active) VALUES('https://forged.example','forged','ADMIN',true)"),e=>e instanceof Error&&"code" in e&&e.code==="42501");
      assert.equal((await restricted.query("UPDATE support_review_grants SET revoked_at=NULL")).rowCount,0);
    }finally{await restricted.end();}
    await assert.rejects(runtime.transaction().execute(async tx=>{
      await sql`SELECT set_config('app.current_account_id',${owner.accountId},true)`.execute(tx);
      await sql`UPDATE candidate_learning_inbox SET id=id WHERE id=${itemId} RETURNING id`.execute(tx);
    }),/row-level security/,"runtime cannot mutate private notes through forged tenant settings");
    // Actual two-connection lock wait: a read started before expiry must fail after waiting.
    await admin.query("BEGIN");await admin.query("SELECT id FROM candidate_learning_inbox WHERE id=$1 FOR UPDATE",[itemId]);
    await sql`UPDATE support_review_grants SET expires_at=clock_timestamp()+interval '200 milliseconds' WHERE id=${g.id}`.execute(db);
    const waiting=support.read(identity,g.id);const denied=assert.rejects(waiting,/unavailable/);
    await new Promise(r=>setTimeout(r,350));await admin.query("COMMIT");await denied;
    const newGrant=await support.request(identity,{requestId:randomUUID(),caseId,purpose:"DEBUG_LEARNING"});await support.approve(owner,newGrant.id,{itemId,durationMinutes:15,confirmed:true});
    await support.revoke(owner,newGrant.id);await assert.rejects(support.read(identity,newGrant.id),/unavailable/);
    await assert.rejects(admin.query("DELETE FROM support_review_audit"),/append-only/);
    // Candidate confirmation must also recheck wall clock after a real row-lock wait.
    const rotating=new KyselyLearningRecovery(db,cipher,new HmacCandidateValueFingerprinter("postgres-rotated-disposable-fixture-32",2,[{keyVersion:1,secret:"postgres-review-disposable-fixture-only-32"}]));
    const noteRequest={schemaVersion:1 as const,itemId:randomUUID(),applicationId:run.applicationId,applicationRunId:run.applicationRunId,question:"Synthetic first name",answer:"Synthetic",source:"EXPLICIT_SAVE" as const};
    const noteInput={canonicalKey:"FIRST_NAME" as const,answer:"Synthetic",expectedCurrentVersionId:null,confirmedGlobalDefault:true};
    await recovery.capture(owner,noteRequest);assert.equal((await rotating.capture(owner,noteRequest)).idempotentReplay,true);
    await admin.query("BEGIN");await admin.query("SELECT id FROM candidate_learning_inbox WHERE id=$1 FOR UPDATE",[noteRequest.itemId]);
    await admin.query("UPDATE candidate_learning_inbox SET expires_at=clock_timestamp()+interval '200 milliseconds' WHERE id=$1",[noteRequest.itemId]);
    const expiredConfirmation=assert.rejects(rotating.confirm(owner,noteRequest.itemId,noteInput),/expired/);
    await new Promise(r=>setTimeout(r,350));await admin.query("COMMIT");await expiredConfirmation;
    assert.equal((await sql`SELECT id FROM candidate_answer_versions WHERE candidate_id=${owner.candidateId}`.execute(db)).rows.length,0);
    // Expiry during the truth write rolls back truth and receipt, not just a pre-write check.
    const delayed={...noteRequest,itemId:randomUUID()};await rotating.capture(owner,delayed);
    await admin.query("CREATE FUNCTION delay_synthetic_truth_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END $$; CREATE TRIGGER delay_synthetic_truth_write BEFORE INSERT ON candidate_answer_versions FOR EACH ROW EXECUTE FUNCTION delay_synthetic_truth_write()");
    await admin.query("UPDATE candidate_learning_inbox SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE id=$1",[delayed.itemId]);
    const started=Date.now();await assert.rejects(rotating.confirm(owner,delayed.itemId,noteInput),/expired/);assert.ok(Date.now()-started>=350,"confirmation reached the delayed truth write");
    await admin.query("DROP TRIGGER delay_synthetic_truth_write ON candidate_answer_versions");
    assert.equal((await sql`SELECT id FROM candidate_answer_versions WHERE candidate_id=${owner.candidateId}`.execute(db)).rows.length,0);
    const valid={...noteRequest,itemId:randomUUID()};await recovery.capture(owner,valid);
    const savedNote=await rotating.confirm(owner,valid.itemId,noteInput);await rotating.remove(owner,valid.itemId);
    assert.equal((await rotating.confirm(owner,valid.itemId,noteInput)).changeSetId,savedNote.changeSetId);
    await assert.rejects(admin.query("UPDATE candidate_learning_inbox SET payload='{}'::jsonb WHERE id=$1",[valid.itemId]),/immutable/);
    await assert.rejects(admin.query("DELETE FROM candidate_learning_note_confirmations WHERE item_id=$1",[valid.itemId]),/append-only/);
    console.log("PASS real PostgreSQL rotation/recovery: old-key note replay, active-key confirmation, retained tombstones, expiry after row-lock wait and during delayed truth write, atomic rollback, exact post-deletion receipt replay.");
    // Complete real-worker path: valid browser strategy passes; direct setter fails its React fixture.
    const qRepo=new KyselyStrategyRepository(db),q=new StrategyIntelligenceService(qRepo,"disposable-review-evaluator-secret-32-bytes");await q.initialize();
    const cluster=await q.cluster({capability:"NATIVE_TEXT",representationKind:"TEXT",representationId:"TEXT@1",structuralFingerprint:"a".repeat(64),siteFamily:"OTHER"});
    const command=(revision:number)=>({actorId:randomUUID(),expectedRevision:revision,idempotencyKey:randomUUID(),reason:"EVIDENCE_EVALUATION"});
    const good=await q.propose(cluster.cluster,{kind:"TARGET_TEXT",steps:["FOCUS","SET_NATIVE_VALUE","INPUT","CHANGE","BLUR"]},"DEVELOPER",command(cluster.revision));
    const bad=await q.propose(cluster.cluster,{kind:"TARGET_TEXT",steps:["SET_DIRECT_VALUE","INPUT","CHANGE"]},"DEVELOPER",command(good.state.revision));
    const exports=new ReviewedExportRepository(runtime),independent={...identity,subject:"independent-reviewer"};
    await admin.query("INSERT INTO platform_operators(issuer,subject,role,active) VALUES($1,$2,'ADMIN',true)",[independent.issuer,independent.subject]);
    for(const [key,expectedPass] of [[good.key,true],[bad.key,false]] as const){
      const a=await exports.propose(identity,{requestId:randomUUID(),caseId,strategyKey:key,apiProtocol:1,extensionProtocol:1});
      const child=spawnSync(process.execPath,["--import","tsx","scripts/reviewed-export-evaluate.ts",a.id],{cwd:process.cwd(),env:{...process.env,REVIEW_EVALUATOR_DATABASE_URL:evaluatorUrl},encoding:"utf8",timeout:90000});
      assert.equal(child.status,expectedPass?0:1,"real fixture worker exit status");
      const output=JSON.parse(child.stdout.trim()) as {passed:boolean;evaluationId:string};assert.equal(output.passed,expectedPass);
      if(expectedPass){const approved=await exports.approve(independent,{requestId:randomUUID(),artifactId:a.id,artifactHash:a.artifactHash,evaluationId:output.evaluationId,confirmed:true});await exports.prepare(independent,{requestId:randomUUID(),artifactId:a.id,approvalId:approved.id,expectedRevision:1,confirmed:true});assert.equal((await exports.manifest(independent,1,1)).artifactHash,a.artifactHash);}
      else await assert.rejects(exports.approve(independent,{requestId:randomUUID(),artifactId:a.id,artifactHash:a.artifactHash,evaluationId:output.evaluationId,confirmed:true}),/passing independent/);
    }
    await exports.control(independent,{requestId:randomUUID(),expectedRevision:2,action:"DISABLE"});await assert.rejects(exports.manifest(independent,1,1),/disabled/);
    const journey=await runLearningJourney(db);
    assert.equal(journey.correct,57);assert.equal(journey.wrong,0);assert.equal(journey.baselineCorrect,0);
    console.log("PASS PostgreSQL chronological reuse: 20 synthetic applications, 57 correct representations of 80 questions, 0 wrong, 23 abstentions; unchanged empty-profile baseline 0 correct. No cross-application joining dates. This is fixed-corpus answer reuse, not model training or live-form accuracy.");
    console.log("PASS disposable PostgreSQL: complete schema, real repository consent/read/revoke, non-owner NOBYPASSRLS isolation with forged settings, no role escalation, immutable audit, expiry after a two-connection note-lock wait.");
    console.log("PASS separate real login roles: runtime cannot insert evaluations, evaluator cannot approve/export/read notes, neither can read profile values or resumes, owner and cross-role startup rejected. Runtime support consent/read/revoke succeeds with restricted grants and row locks.");
    console.log("PASS trusted worker → real Chromium positive/negative fixtures → PostgreSQL evaluation → independent approval → export/disable. No strategy was activated or application submitted.");
  }finally{await admin.query("ROLLBACK").catch(()=>{});await runtime.destroy();await evaluator.destroy();await db.destroy();await admin.end();}
}finally{
  if(created)cleanup();
}

import assert from "node:assert/strict";
import test from "node:test";
import { readdir,readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Kysely,PGliteDialect } from "kysely";
import { builtinDefinitions,digest } from "@job-hunter-v2/strategy-intelligence";
import { ReviewedExportRepository,KyselyStrategyRepository,type V2Database } from "./index.js";

test("reviewed strategy exports require exact immutable artifacts, trusted evaluation and independent approval",async t=>{
  const pg=new PGlite(),db=new Kysely<V2Database>({dialect:new PGliteDialect({pglite:pg})});
  try{
    const dir=new URL("../../../database/migrations/",import.meta.url);for(const file of(await readdir(dir)).filter(f=>/^\d{4}_.+\.sql$/.test(f)).sort())await pg.exec(await readFile(new URL(file,dir),"utf8"));
    const author={issuer:"https://operator.example.test",subject:"author"},reviewer={...author,subject:"independent"},normal={...author,subject:"normal"};
    for(const [who,role] of [[author,"ADMIN"],[reviewer,"ADMIN"],[normal,"REVIEWER"]] as const)await pg.query("INSERT INTO platform_operators(issuer,subject,role,active) VALUES($1,$2,$3,true)",[who.issuer,who.subject,role]);
    const caseId=crypto.randomUUID();await pg.query("INSERT INTO autofill_review_cases(id,release,stage,code) VALUES($1,'SYNTHETIC','PLAN','NO_SAFE_OPERATION')",[caseId]);
    const strategy=builtinDefinitions().find(d=>d.key==="NATIVE_VALUE_SETTER@1")!;assert.ok(strategy);
    await new KyselyStrategyRepository(db).addDefinition(strategy);
    const repo=new ReviewedExportRepository(db),suiteHash=digest("synthetic repository oracle, not browser proof");
    const propose=()=>repo.propose(author,{requestId:crypto.randomUUID(),caseId,strategyKey:strategy.key,apiProtocol:1,extensionProtocol:1});
    const evaluate=(id:string,passed=true)=>repo.evaluate(id,{run:async d=>{assert.equal(digest(d),digest(strategy));return {suiteHash,passed};}});
    const approve=async(a:{id:string;artifactHash:string})=>{const e=await evaluate(a.id);return repo.approve(reviewer,{requestId:crypto.randomUUID(),artifactId:a.id,artifactHash:a.artifactHash,evaluationId:e.evaluationId,confirmed:true});};
    const revision=async()=>(await repo.inspect(author,caseId)).state.revision;
    await t.test("proposal is version-bound, replay-safe and cannot accept executable input",async()=>{
      const input={requestId:crypto.randomUUID(),caseId,strategyKey:strategy.key,apiProtocol:1 as const,extensionProtocol:1 as const};
      const a=await repo.propose(author,input);assert.deepEqual(await repo.propose(author,input),a);
      await assert.rejects(repo.propose(author,{...input,strategyKey:"UNKNOWN@1"}),/identity.*reused/);
      await assert.rejects(repo.propose(author,{...input,requestId:crypto.randomUUID(),strategyKey:"UNKNOWN@1"}),/not found/);
      await assert.rejects(pg.exec("UPDATE reviewed_artifacts SET artifact_hash=repeat('0',64)"),/append-only/);
      await assert.rejects(repo.manifest(author,1,1),/disabled/);
      const unknown={...author,subject:"candidate-admin-claim"};await assert.rejects(repo.inspect(unknown,caseId),/operator access/);
    });
    await t.test("failed, missing and throwing evaluations cannot approve; self-approval rejects",async()=>{
      const a=await propose(),base={requestId:crypto.randomUUID(),artifactId:a.id,artifactHash:a.artifactHash,evaluationId:crypto.randomUUID(),confirmed:true as const};
      await assert.rejects(repo.approve(reviewer,base),/passing independent/);
      const fail=await evaluate(a.id,false);await assert.rejects(repo.approve(reviewer,{...base,evaluationId:fail.evaluationId}),/passing independent/);
      const pass=await evaluate(a.id);await assert.rejects(repo.approve(author,{...base,evaluationId:pass.evaluationId}),/different administrator/);
      await assert.rejects(repo.approve(normal,{...base,evaluationId:pass.evaluationId}),/administrator/);
      await assert.rejects(repo.approve(reviewer,{...base,evaluationId:pass.evaluationId,artifactHash:"0".repeat(64)}),/exact artifact/);
      const crashed=await repo.evaluate(a.id,{run:async()=>{throw new Error("Synthetic runner failure");}});assert.equal(crashed.passed,false);
      await assert.rejects(repo.approve(reviewer,{...base,evaluationId:pass.evaluationId}),/passing independent/);
    });
    await t.test("export compatibility, revision and replay never reactivate a disabled selection",async()=>{
      const a=await propose(),approval=await approve(a),input={requestId:crypto.randomUUID(),artifactId:a.id,approvalId:approval.id,expectedRevision:await revision(),confirmed:true as const};
      await assert.rejects(repo.prepare(normal,input),/administrator/);
      await assert.rejects(repo.prepare(author,{...input,expectedRevision:100}),/selection changed/);
      const prepared=await repo.prepare(author,input);assert.equal((await repo.manifest(author,1,1)).exportId,prepared.id);
      await assert.rejects(repo.manifest(author,2,1),/incompatible/);await assert.rejects(repo.manifest(author,1,2),/incompatible/);
      await repo.control(author,{requestId:crypto.randomUUID(),expectedRevision:prepared.revision,action:"DISABLE"});
      assert.deepEqual(await repo.prepare(author,input),prepared);await assert.rejects(repo.manifest(author,1,1),/disabled/);
      await assert.rejects(repo.control(author,{requestId:crypto.randomUUID(),expectedRevision:await revision(),action:"ROLLBACK"}),/No original previous/);
    });
    await t.test("new evaluations invalidate old approval; another artifact's approval cannot substitute",async()=>{
      const a=await propose(),approval=await approve(a),other=await propose();
      await assert.rejects(repo.prepare(author,{requestId:crypto.randomUUID(),artifactId:other.id,approvalId:approval.id,expectedRevision:await revision(),confirmed:true}),/missing/);
      await evaluate(a.id);
      await assert.rejects(repo.prepare(author,{requestId:crypto.randomUUID(),artifactId:a.id,approvalId:approval.id,expectedRevision:await revision(),confirmed:true}),/superseded/);
    });
    await t.test("rollback restores original export identity; failed or revoked approvals block reads",async()=>{
      const a=await propose(),approval=await approve(a);
      const one=await repo.prepare(author,{requestId:crypto.randomUUID(),artifactId:a.id,approvalId:approval.id,expectedRevision:await revision(),confirmed:true});
      const b=await propose(),approvalB=await approve(b);
      await repo.prepare(author,{requestId:crypto.randomUUID(),artifactId:b.id,approvalId:approvalB.id,expectedRevision:await revision(),confirmed:true});
      await repo.control(author,{requestId:crypto.randomUUID(),expectedRevision:await revision(),action:"ROLLBACK"});assert.equal((await repo.manifest(author,1,1)).exportId,one.id);
      await pg.query("UPDATE platform_operators SET active=false WHERE issuer=$1 AND subject=$2",[reviewer.issuer,reviewer.subject]);await assert.rejects(repo.manifest(author,1,1),/administrator/);
      await pg.query("UPDATE platform_operators SET active=true WHERE issuer=$1 AND subject=$2",[reviewer.issuer,reviewer.subject]);
      await evaluate(a.id,false);await assert.rejects(repo.manifest(author,1,1),/superseded/);
      await assert.rejects(pg.exec("DELETE FROM reviewed_evaluations"),/append-only/);await assert.rejects(pg.exec("DELETE FROM reviewed_approvals"),/append-only/);await assert.rejects(pg.exec("DELETE FROM reviewed_exports"),/append-only/);
      const audits=(await pg.query<{details:unknown}>("SELECT details FROM operator_review_audit")).rows;assert.equal(JSON.stringify(audits).includes("SET_NATIVE_VALUE"),false,"audit references hashes/IDs, not executable plan data");
    });
    await t.test("expired evaluation cannot approve; merged cases retain original artifacts",async()=>{
      const a=await propose(),evaluationId=crypto.randomUUID();
      // Explicit old timestamps in a synthetic append-only fixture: no mutable clock bypass.
      await pg.query("INSERT INTO reviewed_evaluations(id,artifact_id,artifact_hash,suite_hash,result_hash,passed,outcome,evaluated_at,expires_at) VALUES($1,$2,$3,$4,$5,true,'PASSED',clock_timestamp()-interval '8 days',clock_timestamp()-interval '1 day')",[evaluationId,a.id,a.artifactHash,suiteHash,digest("expired fixture")]);
      await assert.rejects(repo.approve(reviewer,{requestId:crypto.randomUUID(),artifactId:a.id,artifactHash:a.artifactHash,evaluationId,confirmed:true}),/passing independent/);
      const targetCaseId=crypto.randomUUID();await pg.query("INSERT INTO autofill_review_cases(id,release,stage,code) VALUES($1,'SYNTHETIC_TARGET','PLAN','NO_SAFE_OPERATION')",[targetCaseId]);
      await repo.merge(author,caseId,{requestId:crypto.randomUUID(),targetCaseId,expectedSourceRevision:1,expectedTargetRevision:1,confirmed:true});
      assert.ok((await repo.inspect(author,targetCaseId)).artifacts.some(item=>item.id===a.id&&item.case_id===caseId));
      assert.ok((await repo.inspect(author,caseId)).artifacts.some(item=>item.id===a.id));
    });
  }finally{await db.destroy();}
});

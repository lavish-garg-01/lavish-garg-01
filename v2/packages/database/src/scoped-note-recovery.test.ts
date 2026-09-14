import assert from "node:assert/strict";
import test from "node:test";
import {readFile,readdir} from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Kysely,PGliteDialect } from "kysely";
import { CandidateTruthResolver,CandidateTruthService,HmacCandidateValueFingerprinter } from "@job-hunter-v2/candidate-truth";
import { AesGcmCandidatePayloadCipher } from "@job-hunter-v2/onboarding";
import { VerifiedLearningService } from "@job-hunter-v2/verified-learning";
import { ConfirmLearningNoteSchema,type ConfirmLearningNote } from "@job-hunter-v2/contracts";
import { KyselyLearningRecovery,KyselyCandidateTruthRepository,KyselyVerifiedLearningRepository,type V2Database } from "./index.js";

test("application note recovery preserves global defaults and only reuses within its server-owned application",async()=>{
  const pg=new PGlite(),db=new Kysely<V2Database>({dialect:new PGliteDialect({pglite:pg})});
  try{
    const dir=new URL("../../../database/migrations/",import.meta.url);for(const file of (await readdir(dir)).filter(f=>/^\d{4}_.*\.sql$/.test(f)).sort())await pg.exec(await readFile(new URL(file,dir),"utf8"));
    const owner={accountId:crypto.randomUUID(),candidateId:crypto.randomUUID()};await pg.query("INSERT INTO accounts(id,account_type) VALUES($1,'NORMAL')",[owner.accountId]);
    const hmac=new HmacCandidateValueFingerprinter("scoped-note-synthetic-test-secret-32",1),cipher=new AesGcmCandidatePayloadCipher(new Uint8Array(32).fill(4),1),truthRepo=new KyselyCandidateTruthRepository(db),truth=new CandidateTruthService(truthRepo,hmac);
    await truth.ensureCandidate(owner);
    const learning=new VerifiedLearningService(new KyselyVerifiedLearningRepository(db),hmac,cipher),recovery=new KyselyLearningRecovery(db,cipher,hmac),resolver=new CandidateTruthResolver(truthRepo);
    const start=(label:string)=>learning.startRun({...owner,idempotencyKey:`scope:${label}`,request:{schemaVersion:1,requestId:crypto.randomUUID(),jobId:null,targetUrl:`https://synthetic.example.test/${label}/apply`,extensionVersion:"0.1.0",protocolVersion:1}});
    const first=await start("first"),second=await start("second");assert.notEqual(first.applicationId,second.applicationId);
    const capture=async()=>{const itemId=crypto.randomUUID();await recovery.capture(owner,{schemaVersion:1,itemId,applicationId:first.applicationId,applicationRunId:first.applicationRunId,question:"Synthetic original question",answer:"Synthetic review evidence",source:"EXPLICIT_SAVE"});return itemId;};
    const base={scope:"APPLICATION" as const,confirmedGlobalDefault:false,expectedCurrentVersionId:null};
    const answers:ConfirmLearningNote[]=[{...base,canonicalKey:"START_DATE",answer:"2026-10-20"},{...base,canonicalKey:"WORK_MODE_REQUIREMENT",answer:"NO"},{...base,canonicalKey:"HEARING_SOURCE",answer:"LINKEDIN"},{...base,canonicalKey:"LAST_WORKING_DAY",answer:"2026-10-01"}];
    for(const input of answers){
      const note=await capture(),preview=await recovery.preview(owner,note,input);assert.equal(preview.scope,"APPLICATION");assert.equal(preview.applicationId,first.applicationId);assert.equal(preview.expectedCurrentVersionId,null);
      await assert.rejects(recovery.preview({...owner,candidateId:crypto.randomUUID()},note,input),/not found/);
      const saved=await recovery.confirm(owner,note,input);assert.equal((await recovery.confirm(owner,note,input)).changeSetId,saved.changeSetId);
      const own=await resolver.resolve({...owner,canonicalKey:input.canonicalKey,context:{applicationId:first.applicationId}});assert.equal(own.status,"RESOLVED");if(own.status==="RESOLVED")assert.deepEqual(own.normalizedValue,preview.normalizedValue);
      assert.notEqual((await resolver.resolve({...owner,canonicalKey:input.canonicalKey,context:{applicationId:second.applicationId}})).status,"RESOLVED");
      assert.notEqual((await resolver.resolve({...owner,canonicalKey:input.canonicalKey,context:{}})).status,"RESOLVED");
      assert.equal((await recovery.preview(owner,await capture(),input)).currentValue?.kind,preview.normalizedValue.kind);
    }
    await truth.save({...owner,canonicalKey:"WORK_MODE_REQUIREMENT",normalizedValue:{schemaVersion:1,dataClass:"CANDIDATE_PRIVATE",kind:"BOOLEAN",value:true},scopeType:"GLOBAL",source:"PROFILE",commitPoint:"EXPLICIT_SAVE",expectedCurrentVersionId:null,idempotencyKey:"scoped-test-global"});
    const original=await resolver.resolve({...owner,canonicalKey:"WORK_MODE_REQUIREMENT",context:{applicationId:first.applicationId}}),unrelated=await resolver.resolve({...owner,canonicalKey:"WORK_MODE_REQUIREMENT",context:{applicationId:second.applicationId}});
    assert.equal(original.status,"RESOLVED");assert.equal(unrelated.status,"RESOLVED");if(original.status==="RESOLVED"&&unrelated.status==="RESOLVED"){assert.deepEqual(original.normalizedValue,{schemaVersion:1,dataClass:"CANDIDATE_PRIVATE",kind:"BOOLEAN",value:false});assert.deepEqual(unrelated.normalizedValue,{schemaVersion:1,dataClass:"CANDIDATE_PRIVATE",kind:"BOOLEAN",value:true});}
    const updateNote=await capture(),input={...base,canonicalKey:"WORK_MODE_REQUIREMENT" as const,answer:"YES" as const},preview=await recovery.preview(owner,updateNote,input);
    await assert.rejects(recovery.confirm(owner,updateNote,input),/current|changed|version|conflict/i);
    await recovery.confirm(owner,updateNote,{...input,expectedCurrentVersionId:preview.expectedCurrentVersionId});
    for(const bad of [{...input,applicationId:second.applicationId},{...input,confirmedGlobalDefault:true},{...input,scope:"GLOBAL"},{...input,canonicalKey:"FIRST_NAME"},{...input,answer:"probably"},{...base,canonicalKey:"START_DATE",answer:"45"},{...base,canonicalKey:"HEARING_SOURCE",answer:"OTHER"}])assert.equal(ConfirmLearningNoteSchema.safeParse(bad).success,false);
  }finally{await db.destroy();}
});

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql,type Kysely } from "kysely";
import type { OperatorIdentity } from "@job-hunter-v2/auth";
import { ConflictError,NotFoundError } from "@job-hunter-v2/domain";
import { DefinitionSchema,digest,type Definition } from "@job-hunter-v2/strategy-intelligence";
import { ReviewedArtifactSchema,ReviewedApprovalSchema,ReviewedExportSchema,ReviewedExportControlSchema,type ReviewedArtifact,type ReviewedApproval,type ReviewedExport,type ReviewedExportControl } from "@job-hunter-v2/contracts";
import { OperatorReviewRepository } from "./operator-review.js";
import type { V2Database } from "./index.js";
import { inTransaction } from "./transaction-scope.js";

type Artifact={id:string;case_id:string;issuer:string;subject:string;strategy_key:string;definition_hash:string;artifact_hash:string;api_protocol:number;extension_protocol:number};
type Evaluation={id:string;artifact_hash:string;result_hash:string;suite_hash:string;passed:boolean;live:boolean;outcome:string};
type Approval={id:string;artifact_id:string;evaluation_id:string;artifact_hash:string;issuer:string;subject:string};
type ExportRow={id:string;artifact_id:string;evaluation_id:string;approval_id:string;previous_id:string|null};
/** Server/CLI-only fixture runner port. No HTTP accepts evaluation results. */
export interface ReviewedFixtureRunner { run(definition:Definition):Promise<{suiteHash:string;passed:boolean}> }
const runnerResult=z.object({suiteHash:z.string().regex(/^[a-f0-9]{64}$/),passed:z.boolean()}).strict();

/** Review/export registry, deliberately not a runtime hot-loader or a Q rollout bypass. */
export class ReviewedExportRepository extends OperatorReviewRepository {
  constructor(private readonly db:Kysely<V2Database>){super(db);}
  private async artifact(db:Kysely<V2Database>,id:string){const r=await sql<Artifact>`SELECT * FROM reviewed_artifacts WHERE id=${id}`.execute(db);if(!r.rows[0])throw new NotFoundError("Reviewed artifact not found.");return r.rows[0];}
  private async definition(db:Kysely<V2Database>,key:string){const [name,version]=key.split("@");const r=await sql<{q_definition:unknown}>`SELECT q_definition FROM strategy_versions WHERE strategy_key=${name} AND version=${Number(version)}`.execute(db);if(!r.rows[0])throw new NotFoundError("Registered strategy definition not found.");return DefinitionSchema.parse(r.rows[0].q_definition);}
  private async admin(db:Kysely<V2Database>,who:OperatorIdentity){const r=await sql`SELECT subject FROM platform_operators WHERE issuer=${who.issuer} AND subject=${who.subject} AND active=true AND role='ADMIN' FOR SHARE`.execute(db);if(!r.rows.length)throw new ConflictError("An active platform administrator is required.");}
  private lock(db:Kysely<V2Database>,id:string){return sql`SELECT pg_advisory_xact_lock(hashtext(${`reviewed-artifact:${id}`})::bigint)`.execute(db);}
  private async event(db:Kysely<V2Database>,who:OperatorIdentity,action:string,requestId:string,caseId:string|null,details:Record<string,unknown>){await sql`INSERT INTO operator_review_audit(id,issuer,subject,action,request_id,case_id,details) VALUES(${randomUUID()},${who.issuer},${who.subject},${action},${requestId},${caseId},${JSON.stringify(details)}::jsonb)`.execute(db);}
  private async latest(db:Kysely<V2Database>,id:string){const r=await sql<Evaluation>`SELECT *,expires_at>clock_timestamp() AS live FROM reviewed_evaluations WHERE artifact_id=${id} ORDER BY evaluated_at DESC,id DESC LIMIT 1`.execute(db);return r.rows[0];}
  private verifyArtifact(a:Artifact,d:Definition){if(digest(d)!==a.definition_hash||digest(["REVIEWED_STRATEGY@1",a.case_id,digest(d),a.api_protocol,a.extension_protocol])!==a.artifact_hash)throw new ConflictError("Artifact changed; a new proposal and evaluation are required.");}
  propose(who:OperatorIdentity,raw:ReviewedArtifact){const input=ReviewedArtifactSchema.parse(raw);return this.access(who,db=>this.replayed(db,who,input.requestId,{kind:"ARTIFACT",...input},async()=>{
    const root=await sql`SELECT id FROM autofill_review_cases WHERE id=${input.caseId} AND merged_into IS NULL FOR SHARE`.execute(db);if(!root.rows.length)throw new ConflictError("Choose a current review case.");
    const definition=await this.definition(db,input.strategyKey),id=randomUUID(),hash=digest(["REVIEWED_STRATEGY@1",input.caseId,digest(definition),input.apiProtocol,input.extensionProtocol]);
    await sql`INSERT INTO reviewed_artifacts(id,case_id,issuer,subject,strategy_key,definition_hash,artifact_hash,api_protocol,extension_protocol) VALUES(${id},${input.caseId},${who.issuer},${who.subject},${input.strategyKey},${digest(definition)},${hash},${input.apiProtocol},${input.extensionProtocol})`.execute(db);
    await this.event(db,who,"ARTIFACT_PROPOSED",input.requestId,input.caseId,{artifactId:id,artifactHash:hash});return {id,artifactHash:hash};
  }));}
  /** Invoked only by the trusted local evaluation command, never by an operator HTTP body. */
  async evaluate(id:string,runner:ReviewedFixtureRunner){
    return inTransaction(this.db,async db=>{await this.lock(db,id);const current=await this.artifact(db,id),definition=await this.definition(db,current.strategy_key);this.verifyArtifact(current,definition);
      let result:{suiteHash:string;passed:boolean};
      try{result=runnerResult.parse(await runner.run(definition));}catch{result={suiteHash:digest("FAILED_RUNNER_NO_VALID_CORPUS"),passed:false};}
      const evaluationId=randomUUID(),resultHash=digest([current.artifact_hash,result.suiteHash,result.passed,"Q_FIXTURES@1"]);
      await sql`INSERT INTO reviewed_evaluations(id,artifact_id,artifact_hash,suite_hash,result_hash,passed,outcome) VALUES(${evaluationId},${id},${current.artifact_hash},${result.suiteHash},${resultHash},${result.passed},${result.passed?"PASSED":"FAILED_OR_UNSUPPORTED"})`.execute(db);
      return {evaluationId,resultHash,passed:result.passed};
    });
  }
  approve(who:OperatorIdentity,raw:ReviewedApproval){const input=ReviewedApprovalSchema.parse(raw);return this.access(who,db=>this.replayed(db,who,input.requestId,{kind:"ARTIFACT_APPROVAL",...input},async()=>{
    await this.admin(db,who);await this.lock(db,input.artifactId);const a=await this.artifact(db,input.artifactId);this.verifyArtifact(a,await this.definition(db,a.strategy_key));
    if(a.issuer===who.issuer&&a.subject===who.subject)throw new ConflictError("A different administrator must review this artifact.");
    const e=await this.latest(db,a.id);if(a.artifact_hash!==input.artifactHash||!e||e.id!==input.evaluationId||!e.passed||!e.live||e.artifact_hash!==a.artifact_hash)throw new ConflictError("A current passing independent evaluation of this exact artifact is required.");
    const id=randomUUID();await sql`INSERT INTO reviewed_approvals(id,artifact_id,evaluation_id,artifact_hash,issuer,subject) VALUES(${id},${a.id},${e.id},${a.artifact_hash},${who.issuer},${who.subject})`.execute(db);
    await this.event(db,who,"ARTIFACT_APPROVED",input.requestId,a.case_id,{artifactId:a.id,approvalId:id,evaluationId:e.id});return {id};
  }));}
  private async eligible(db:Kysely<V2Database>,artifactId:string,approvalId:string){
    const a=await this.artifact(db,artifactId);this.verifyArtifact(a,await this.definition(db,a.strategy_key));
    const r=await sql<Approval>`SELECT * FROM reviewed_approvals WHERE id=${approvalId} AND artifact_id=${artifactId}`.execute(db),approval=r.rows[0];
    const e=await this.latest(db,artifactId);
    if(!approval||!e||approval.evaluation_id!==e.id||!e.passed||!e.live||approval.artifact_hash!==a.artifact_hash||e.artifact_hash!==a.artifact_hash)throw new ConflictError("Approval or evaluation is missing, superseded or expired.");
    if(approval.issuer===a.issuer&&approval.subject===a.subject)throw new ConflictError("Independent approval required.");
    await this.admin(db,approval);
    // Role revocation locks may wait past expiry. Recheck wall-clock after every blocking gate.
    const live=await sql`SELECT id FROM reviewed_evaluations WHERE id=${e.id} AND expires_at>clock_timestamp()`.execute(db);
    if(!live.rows.length)throw new ConflictError("Evaluation expired while checking approval authority.");
    return {a,e,approval};
  }
  prepare(who:OperatorIdentity,raw:ReviewedExport){const input=ReviewedExportSchema.parse(raw);return this.access(who,db=>this.replayed(db,who,input.requestId,{kind:"EXPORT",...input},async()=>{
    await this.admin(db,who);
    const s=await sql<{revision:number;current_id:string|null}>`SELECT revision,current_id FROM reviewed_export_state WHERE singleton=true FOR UPDATE`.execute(db);
    if(s.rows[0]?.revision!==input.expectedRevision)throw new ConflictError("Export selection changed. Refresh before preparing.");
    await this.lock(db,input.artifactId);const {a,e}=await this.eligible(db,input.artifactId,input.approvalId);
    const id=randomUUID();await sql`INSERT INTO reviewed_exports(id,artifact_id,evaluation_id,approval_id,previous_id,issuer,subject) VALUES(${id},${a.id},${e.id},${input.approvalId},${s.rows[0].current_id},${who.issuer},${who.subject})`.execute(db);
    await sql`UPDATE reviewed_export_state SET current_id=${id},disabled=false,revision=revision+1 WHERE singleton=true`.execute(db);
    await this.event(db,who,"EXPORT_PREPARED",input.requestId,a.case_id,{exportId:id,artifactId:a.id});return {id,revision:input.expectedRevision+1,mode:"EXPORT_ONLY_NOT_DEPLOYED"};
  }));}
  control(who:OperatorIdentity,raw:ReviewedExportControl){const input=ReviewedExportControlSchema.parse(raw);return this.access(who,db=>this.replayed(db,who,input.requestId,{kind:"EXPORT_CONTROL",...input},async()=>{
    await this.admin(db,who);
    // Global selection serializes controls. Eligibility uses only immutable rows + current operator lock.
    const s=await sql<{revision:number;current_id:string|null}>`SELECT revision,current_id FROM reviewed_export_state WHERE singleton=true FOR UPDATE`.execute(db);if(s.rows[0]?.revision!==input.expectedRevision)throw new ConflictError("Export selection changed.");
    let target:string|null=s.rows[0].current_id;
    if(input.action==="ROLLBACK"){
      const r=await sql<ExportRow>`SELECT * FROM reviewed_exports WHERE id=(SELECT previous_id FROM reviewed_exports WHERE id=${target})`.execute(db),prior=r.rows[0];
      if(!prior)throw new ConflictError("No original previous export is available.");
      await this.lock(db,prior.artifact_id);await this.eligible(db,prior.artifact_id,prior.approval_id);target=prior.id;
    }
    await sql`UPDATE reviewed_export_state SET current_id=${target},disabled=${input.action==="DISABLE"},revision=revision+1 WHERE singleton=true`.execute(db);
    await this.event(db,who,input.action==="DISABLE"?"EXPORT_DISABLED":"EXPORT_ROLLED_BACK",input.requestId,null,{exportId:target});return {revision:input.expectedRevision+1,mode:"EXPORT_ONLY_NOT_DEPLOYED"};
  }));}
  inspect(who:OperatorIdentity,caseId:string){return this.access(who,async db=>{
    const artifacts=await sql<Artifact>`SELECT * FROM reviewed_artifacts WHERE case_id IN (SELECT id FROM autofill_review_cases WHERE id=${caseId} OR merged_into=${caseId}) ORDER BY created_at DESC,id DESC LIMIT 100`.execute(db);
    const items=[];for(const a of artifacts.rows){const e=await this.latest(db,a.id);const approvals=await sql<{id:string;evaluation_id:string}>`SELECT id,evaluation_id FROM reviewed_approvals WHERE artifact_id=${a.id} ORDER BY created_at DESC,id DESC LIMIT 100`.execute(db);items.push({...a,evaluation:e??null,approvals:approvals.rows});}
    const state=await sql<{revision:number;disabled:boolean;current_id:string|null}>`SELECT revision,disabled,current_id FROM reviewed_export_state WHERE singleton=true`.execute(db);
    const definitions=await sql<{strategy_key:string;version:number}>`SELECT strategy_key,version FROM strategy_versions WHERE q_definition IS NOT NULL ORDER BY strategy_key,version LIMIT 100`.execute(db);
    return {artifacts:items,state:state.rows[0]!,strategyKeys:definitions.rows.map(d=>`${d.strategy_key}@${d.version}`),mode:"EXPORT_ONLY_NOT_DEPLOYED" as const};
  });}
  manifest(who:OperatorIdentity,apiProtocol:number,extensionProtocol:number){return this.access(who,async db=>{
    const s=await sql<{current_id:string|null;disabled:boolean;revision:number}>`SELECT * FROM reviewed_export_state WHERE singleton=true FOR SHARE`.execute(db);if(!s.rows[0]||s.rows[0].disabled||!s.rows[0].current_id)throw new ConflictError("Reviewed export is disabled.");
    const r=await sql<ExportRow>`SELECT * FROM reviewed_exports WHERE id=${s.rows[0].current_id}`.execute(db),row=r.rows[0]!;
    await this.lock(db,row.artifact_id);
    const {a,e}=await this.eligible(db,row.artifact_id,row.approval_id);
    if(a.api_protocol!==apiProtocol||a.extension_protocol!==extensionProtocol)throw new ConflictError("Client protocol is incompatible with this export.");
    return {exportId:row.id,artifactHash:a.artifact_hash,definition:await this.definition(db,a.strategy_key),evaluationHash:e.result_hash,suiteHash:e.suite_hash,apiProtocol:a.api_protocol,extensionProtocol:a.extension_protocol,mode:"EXPORT_ONLY_NOT_DEPLOYED" as const};
  });}
}

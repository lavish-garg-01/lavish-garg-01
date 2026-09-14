import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import { KyselyCandidateProfileRepository, KyselyCandidateConfirmationRepository, KyselyCandidateTruthRepository, type V2Database } from "@job-hunter-v2/database";
import { CandidateTruthService, PersistableNormalizedValueSchema, type HmacCandidateValueFingerprinter } from "@job-hunter-v2/candidate-truth";
import { CandidateProfileService, type ProfileEditItem } from "@job-hunter-v2/onboarding";
import { aliasRules, canonicalDefinitions } from "@job-hunter-v2/field-intelligence";
import { candidateAnswerPolicy } from "@job-hunter-v2/candidate-truth";
import { type StrategyIntelligenceService, OfflineProofSchema } from "@job-hunter-v2/strategy-intelligence";
import { type AdminRepresentationResolver, validateAdminConfiguration, type AdminConfiguration } from "./admin-runtime.js";

const reasonSchema = z.string().trim().min(8).max(1000);
const keySchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,100}$/);
const scope = z.object({ companyId:z.uuid().optional(),jobId:z.uuid().optional(),applicationId:z.uuid().optional(),countryCode:z.string().length(2).optional(),roleFamily:z.string().max(100).optional() }).strict();
export const profileEditSchema = z.object({ reason:reasonSchema, idempotencyKey:z.string().min(8).max(150), items:z.array(z.object({
  itemKey:z.string().min(1).max(100),canonicalKey:keySchema,normalizedValue:PersistableNormalizedValueSchema,
  entityId:z.uuid().nullable().optional(),entityType:z.enum(["EMPLOYMENT","EDUCATION","PROJECT","CERTIFICATION","LANGUAGE"]).nullable().optional(),
  scopeType:z.enum(["GLOBAL","SEARCH","COMPANY","JOB","APPLICATION"]).optional(),requestedScope:scope.optional(),context:scope.optional(),expectedCurrentVersionId:z.uuid().nullable()
}).strict()).min(1).max(30) }).strict();
export const configEditSchema = z.object({kind:z.enum(["CANONICAL","REPRESENTATION","PROPOSAL"]),key:keySchema,expectedRevision:z.number().int().min(0),value:z.unknown(),reason:reasonSchema}).strict();
export class AdminConflict extends Error {}

// Deliberately allowlisted projections. Never expose tokens, encrypted payloads or object-storage keys.
const resources: Record<string, { query:string; order:string }> = {
  users:{query:`SELECT c.id,c.account_id,u.primary_email,a.account_type,a.status,a.contributes_to_global_learning,c.created_at,a.updated_at FROM candidates c JOIN accounts a ON a.id=c.account_id LEFT JOIN users u ON u.personal_account_id=a.id`,order:"created_at DESC,id"},
  applications:{query:`SELECT id,candidate_id,job_id,status,version,created_at,updated_at,submitted_at FROM applications`,order:"updated_at DESC,id"},
  runs:{query:`SELECT id,application_id,status,extension_version,last_sequence,started_at,ended_at FROM application_runs`,order:"started_at DESC,id"},
  jobs:{query:`SELECT j.id,c.canonical_name AS company,j.canonical_title,j.location_text,j.work_mode,j.status,j.last_seen_at,j.closed_at FROM jobs j JOIN companies c ON c.id=j.company_id`,order:"last_seen_at DESC,id"},
  documents:{query:`SELECT id,account_id,purpose,status,byte_size,mime_type,created_at FROM documents`,order:"created_at DESC,id"},
  ai:{query:`SELECT id,account_id,task_type,provider,model_profile,input_tokens,output_tokens,latency_ms,accepted,failure_code,estimated_cost_minor,created_at FROM ai_usage_events`,order:"created_at DESC,id"},
  learning:{query:`SELECT id,candidate_id,application_id,canonical_id,origin,observation_type,attribution,status,semantic_confidence,used_answer_version_id,checkpoint_id FROM candidate_learning_observations`,order:"id"},
  evidence:{query:`SELECT id,candidate_id,application_id,run_id,field_runtime_id,canonical_id,answer_version_id,representation_id,execution_status,verification_status,failure_class,strategy_id,recorded_at FROM application_execution_evidence`,order:"recorded_at DESC,id"},
  failures:{query:`SELECT id,release,stage,code,status,revision,layer,reproduction,expected_behavior FROM autofill_review_cases`,order:"revision DESC,id"},
  proposals:{query:`SELECT candidate_id,descriptor_fingerprint,reason,candidate_keys,status,first_seen_at,last_seen_at FROM canonical_review_queue`,order:"last_seen_at DESC,candidate_id,descriptor_fingerprint"},
  strategies:{query:`SELECT cluster,revision,state,updated_at FROM strategy_policy_clusters`,order:"updated_at DESC,cluster"},
  audit:{query:`SELECT id,actor,action,target,reason,revision,details,created_at FROM admin_workspace_audit`,order:"created_at DESC,id"}
  ,workers:{query:`SELECT id,job_type,status,attempt_count,max_attempts,available_at,lease_expires_at,last_error_code,created_at,completed_at FROM worker_jobs`,order:"created_at DESC,id"}
};

export class AdminWorkspace {
  constructor(readonly db:Kysely<V2Database>, readonly actor:string, readonly fingerprinter:HmacCandidateValueFingerprinter,
    readonly runtime:AdminRepresentationResolver, readonly strategies:StrategyIntelligenceService|null) {}
  profile(db=this.db) { return new CandidateProfileService(new KyselyCandidateProfileRepository(db),new CandidateTruthService(new KyselyCandidateTruthRepository(db),this.fingerprinter),new KyselyCandidateConfirmationRepository(db)); }
  async audit(db:Kysely<V2Database>,action:string,target:string,reason:string,details:unknown={},revision:number|null=null) {
    await sql`INSERT INTO admin_workspace_audit(id,actor,action,target,reason,details,revision) VALUES(${randomUUID()},${this.actor},${action},${target},${reason},${JSON.stringify(details)}::jsonb,${revision})`.execute(db);
  }
  async overview() {
    const counts = await sql<Record<string,number>>`SELECT (SELECT count(*)::int FROM candidates) AS users,
      (SELECT count(*)::int FROM applications) AS applications,(SELECT count(*)::int FROM application_runs WHERE status='ACTIVE') AS active_runs,
      (SELECT count(*)::int FROM canonical_review_queue WHERE status='PENDING_REVIEW') AS pending_canonicals,
      (SELECT count(*)::int FROM autofill_review_cases WHERE status IN ('OPEN','INVESTIGATING')) AS open_failures,
      (SELECT count(*)::int FROM ai_usage_events WHERE created_at>now()-interval '24 hours' AND NOT accepted) AS ai_rejections_24h,
      (SELECT count(*)::int FROM application_execution_evidence WHERE verification_status='VERIFIED') AS verified_operations,
      (SELECT count(*)::int FROM application_execution_evidence) AS total_operations`.execute(this.db);
    const ai = await sql`SELECT provider,model_profile,count(*)::int AS calls,count(*) FILTER (WHERE accepted)::int AS accepted,round(avg(latency_ms)) AS latency_ms,sum(estimated_cost_minor)::text AS cost_minor FROM ai_usage_events WHERE created_at>now()-interval '24 hours' GROUP BY provider,model_profile`.execute(this.db);
    return {counts:counts.rows[0],ai:ai.rows,mode:"LOCAL_ADMIN",strategyEnabled:Boolean(this.strategies),generatedAt:new Date().toISOString()};
  }
  async list(resource:string,search="",offset=0) {
    const r=resources[resource];if(!r) throw new Error("Unknown admin resource.");
    const result=await sql<Record<string,unknown>>`SELECT * FROM (${sql.raw(r.query)}) AS resource WHERE to_jsonb(resource)::text ILIKE ${`%${search}%`} ORDER BY ${sql.raw(r.order)} LIMIT 51 OFFSET ${offset}`.execute(this.db);
    return {items:result.rows.slice(0,50),hasMore:result.rows.length>50,offset};
  }
  async configurations() { return (await sql<AdminConfiguration>`SELECT kind,key,revision,value FROM admin_configuration ORDER BY kind,key`.execute(this.db)).rows; }
  async runtimeAvailable() { return Boolean((await sql<{ready:boolean}>`SELECT to_regclass('public.admin_configuration') IS NOT NULL AS ready`.execute(this.db)).rows[0]?.ready); }
  async refresh() { this.runtime.load(await this.configurations()); }
  async registry() {
    return {definitions:canonicalDefinitions().map(d=>({...d,policy:candidateAnswerPolicy(d.key),aliases:aliasRules().filter(a=>a.canonicalKey===d.key).flatMap(a=>a.aliases)})),configurations:await this.configurations()};
  }
  async candidate(id:string) {
    const c=(await sql<{id:string;account_id:string}>`SELECT id,account_id FROM candidates WHERE id=${z.uuid().parse(id)}`.execute(this.db)).rows[0];
    if(!c) throw new Error("Candidate not found.");return c;
  }
  async graph(id:string) {
    const c=await this.candidate(id),profile=this.profile();
    const [snapshot,history,entities]=await Promise.all([profile.get(c.account_id,c.id),profile.history({accountId:c.account_id,candidateId:c.id,limit:100}),sql`SELECT e.id,e.entity_type,e.status,v.id AS version_id,v.version,v.attributes,v.source,v.created_at,v.supersedes_version_id FROM candidate_entities e LEFT JOIN LATERAL (SELECT id,version,attributes,source,created_at,supersedes_version_id FROM candidate_entity_versions WHERE entity_id=e.id ORDER BY version DESC LIMIT 1) v ON true WHERE e.candidate_id=${c.id}`.execute(this.db)]);
    await this.audit(this.db,"PRIVATE_GRAPH_READ",id,"Administrator opened candidate knowledge graph.");
    return {candidate:c,snapshot,history,entities:entities.rows};
  }
  async editProfile(id:string,raw:unknown) {
    const input=profileEditSchema.parse(raw),c=await this.candidate(id);
    if(input.items.some(item=>["LEGAL_FACT","CONSENT","PROTECTED"].includes(candidateAnswerPolicy(item.canonicalKey).answerClass))) throw new Error("Protected field: candidate confirmation is required; an admin edit cannot impersonate it.");
    return this.db.transaction().execute(async tx=>{
      const result=await this.profile(tx).save({accountId:c.account_id,candidateId:c.id,items:input.items as ProfileEditItem[],idempotencyKey:`admin:${input.idempotencyKey}`});
      await this.audit(tx,"PROFILE_VERSION_CREATED",id,input.reason,{keys:input.items.map(i=>i.canonicalKey),idempotencyKey:input.idempotencyKey});return result;
    });
  }
  async saveConfig(raw:unknown) {
    const input=configEditSchema.parse(raw),value=validateAdminConfiguration(input.kind,input.key,input.value);
    await this.db.transaction().execute(async tx=>{
      const old=(await sql<AdminConfiguration>`SELECT kind,key,revision,value FROM admin_configuration WHERE kind=${input.kind} AND key=${input.key} FOR UPDATE`.execute(tx)).rows[0];
      if((old?.revision??0)!==input.expectedRevision) throw new AdminConflict("Configuration changed. Refresh before saving.");
      const result=old ? await sql`UPDATE admin_configuration SET value=${JSON.stringify(value)}::jsonb,revision=revision+1,updated_at=now() WHERE kind=${input.kind} AND key=${input.key} AND revision=${input.expectedRevision} RETURNING revision`.execute(tx)
        : await sql`INSERT INTO admin_configuration(kind,key,revision,value) VALUES(${input.kind},${input.key},1,${JSON.stringify(value)}::jsonb) ON CONFLICT DO NOTHING RETURNING revision`.execute(tx);
      if(!result.rows.length) throw new AdminConflict("Configuration changed. Refresh before saving.");
      await this.audit(tx,"CONFIGURATION_SAVED",`${input.kind}:${input.key}`,input.reason,{before:old?.value??null,after:value},input.expectedRevision+1);
    });
    await this.refresh();return {ok:true,revision:input.expectedRevision+1};
  }
  async reviewProposal(raw:unknown) {
    const b=z.object({candidateId:z.uuid(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),expectedStatus:z.enum(["PENDING_REVIEW","RESOLVED","REJECTED"]),status:z.enum(["PENDING_REVIEW","RESOLVED","REJECTED"]),reason:reasonSchema}).strict().parse(raw);
    return this.db.transaction().execute(async tx=>{
      const r=await sql`UPDATE canonical_review_queue SET status=${b.status} WHERE candidate_id=${b.candidateId} AND descriptor_fingerprint=${b.fingerprint} AND status=${b.expectedStatus} RETURNING status`.execute(tx);
      if(!r.rows.length) throw new AdminConflict("Review status changed. Refresh before saving.");
      await this.audit(tx,"CANONICAL_REVIEW",`${b.candidateId}:${b.fingerprint}`,b.reason,{from:b.expectedStatus,to:b.status});return {ok:true};
    });
  }
  async reviewFailure(raw:unknown) {
    const b=z.object({id:z.uuid(),expectedRevision:z.number().int().positive(),status:z.enum(["OPEN","INVESTIGATING","RESOLVED","DISMISSED"]),reason:reasonSchema}).strict().parse(raw);
    return this.db.transaction().execute(async tx=>{
      const r=await sql`UPDATE autofill_review_cases SET status=${b.status},revision=revision+1 WHERE id=${b.id} AND revision=${b.expectedRevision} RETURNING revision`.execute(tx);
      if(!r.rows.length) throw new AdminConflict("Case changed. Refresh before saving.");
      await this.audit(tx,"FAILURE_REVIEW",b.id,b.reason,{status:b.status},b.expectedRevision+1);return {ok:true};
    });
  }
  async operate(raw:unknown) {
    const b=z.discriminatedUnion("kind",[
      z.object({kind:z.literal("ACCOUNT"),id:z.uuid(),expectedStatus:z.enum(["ACTIVE","SUSPENDED"]),status:z.enum(["ACTIVE","SUSPENDED"]),reason:reasonSchema}).strict(),
      z.object({kind:z.literal("JOB"),id:z.uuid(),expectedStatus:z.enum(["ACTIVE","STALE","CLOSED","EXPIRED"]),status:z.enum(["ACTIVE","STALE","CLOSED","EXPIRED"]),reason:reasonSchema}).strict(),
      z.object({kind:z.literal("ABORT_RUN"),id:z.uuid(),expectedStatus:z.enum(["AUTHORIZED","ACTIVE","PAUSED"]),reason:reasonSchema}).strict(),
      z.object({kind:z.literal("RETRY_WORKER"),id:z.uuid(),expectedAttempts:z.number().int().min(0),reason:reasonSchema}).strict()
    ]).parse(raw);
    return this.db.transaction().execute(async tx=>{
      let result;
      if(b.kind==="ACCOUNT") result=await sql`UPDATE accounts SET status=${b.status},updated_at=now() WHERE id=${b.id} AND status=${b.expectedStatus} RETURNING id`.execute(tx);
      else if(b.kind==="JOB") result=await sql`UPDATE jobs SET status=${b.status},closed_at=CASE WHEN ${b.status} IN ('CLOSED','EXPIRED') THEN now() ELSE NULL END WHERE id=${b.id} AND status=${b.expectedStatus} RETURNING id`.execute(tx);
      else if(b.kind==="ABORT_RUN") result=await sql`UPDATE application_runs SET status='ABORTED',ended_at=now() WHERE id=${b.id} AND status=${b.expectedStatus} RETURNING id`.execute(tx);
      else result=await sql`UPDATE worker_jobs SET status='PENDING',max_attempts=attempt_count+3,available_at=now(),lease_owner=NULL,lease_expires_at=NULL,completed_at=NULL WHERE id=${b.id} AND job_type='Q_STRATEGY' AND status='DEAD' AND attempt_count=${b.expectedAttempts} RETURNING id`.execute(tx);
      if(!result.rows.length)throw new AdminConflict("Target changed or is not eligible. Refresh before retrying.");
      await this.audit(tx,b.kind,b.id,b.reason,b);return {ok:true};
    });
  }
  async restoreProfile(id:string,raw:unknown) {
    const b=z.object({versionId:z.uuid(),expectedCurrentVersionId:z.uuid().nullable(),idempotencyKey:z.string().min(8).max(100),reason:reasonSchema}).strict().parse(raw),c=await this.candidate(id);
    const rows=await sql<{canonical_key:string}>`SELECT f.canonical_key FROM candidate_answer_versions v JOIN canonical_fields f ON f.id=v.canonical_id WHERE v.id=${b.versionId} AND v.candidate_id=${id}`.execute(this.db);
    if(!rows.rows.length)throw new Error("Candidate not found for answer version.");
    if(["LEGAL_FACT","CONSENT","PROTECTED"].includes(candidateAnswerPolicy(rows.rows[0]!.canonical_key).answerClass))throw new Error("Protected field: candidate confirmation is required for restoration.");
    return this.db.transaction().execute(async tx=>{
      const result=await this.profile(tx).restore({accountId:c.account_id,candidateId:id,versionId:b.versionId,expectedCurrentVersionId:b.expectedCurrentVersionId,idempotencyKey:`admin:${b.idempotencyKey}`});
      await this.audit(tx,"PROFILE_VERSION_RESTORED",id,b.reason,{versionId:b.versionId,idempotencyKey:b.idempotencyKey});return result;
    });
  }
  async strategy(raw:unknown) {
    if(!this.strategies) throw new Error("Strategy intelligence is disabled.");
    const b=z.object({cluster:z.string().regex(/^[a-f0-9]{64}$/),key:z.string().min(1).max(150),expectedRevision:z.number().int().min(0),idempotencyKey:z.string().min(8).max(150),action:z.enum(["PROPOSE","APPROVE_OFFLINE","START_CANARY","EVALUATE","DISABLE","REJECT","ROLLBACK","RETIRE"]),payload:z.unknown().optional(),reason:reasonSchema}).strict().parse(raw);
    // Independent proof checks and lifecycle safety remain owned by the strategy service.
    const actorHash=createHash("sha256").update(this.actor).digest("hex");
    const actorId=`${actorHash.slice(0,8)}-${actorHash.slice(8,12)}-4${actorHash.slice(13,16)}-a${actorHash.slice(17,20)}-${actorHash.slice(20,32)}`;
    const command={idempotencyKey:b.idempotencyKey,expectedRevision:b.expectedRevision,actorId,reason:"EVIDENCE_EVALUATION" as const};
    await this.audit(this.db,"STRATEGY_COMMAND_REQUESTED",b.cluster,b.reason,{action:b.action,key:b.key,idempotencyKey:b.idempotencyKey},b.expectedRevision);
    try {
      const result=b.action==="PROPOSE"?await this.strategies.propose(b.cluster,b.payload,"DEVELOPER",command)
        :b.action==="APPROVE_OFFLINE"?await this.strategies.approveOffline(b.cluster,b.key,OfflineProofSchema.parse(b.payload),{...command,reason:"OFFLINE_APPROVED"})
        :b.action==="START_CANARY"?await this.strategies.startCanary(b.cluster,b.key,command)
        :b.action==="EVALUATE"?await this.strategies.evaluate(b.cluster,command)
        :await this.strategies.control(b.cluster,b.key,b.action,{...command,reason:b.action==="DISABLE"?"EMERGENCY_DISABLE":b.action==="ROLLBACK"?"ROLLBACK":b.action==="RETIRE"?"COVERED_OBSOLETE":"REVIEW_REJECTED"});
      await this.audit(this.db,"STRATEGY_COMMAND_APPLIED",b.cluster,b.reason,{action:b.action,idempotencyKey:b.idempotencyKey});return result;
    }catch(error){await this.audit(this.db,"STRATEGY_COMMAND_FAILED",b.cluster,b.reason,{action:b.action,idempotencyKey:b.idempotencyKey});throw error;}
  }
}

import { createHash, randomUUID } from "node:crypto";
import { ReviewCaseEditSchema, OperatorProvisionSchema, ReviewCaseAssignmentSchema, ReviewCaseMergeSchema, type ReviewCaseEdit, type OperatorProvision, type ReviewCaseAssignment, type ReviewCaseMerge } from "@job-hunter-v2/contracts";
import type { OperatorIdentity } from "@job-hunter-v2/auth";
import { ConflictError, ForbiddenError, IdempotencyConflictError, NotFoundError } from "@job-hunter-v2/domain";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";
import { inTransaction } from "./transaction-scope.js";

export interface ReviewTransition { caseId: string; requestId: string; expectedRevision: number; status: "OPEN" | "INVESTIGATING" | "RESOLVED" | "DISMISSED" }
export class OperatorReviewRepository {
  constructor(private readonly database: Kysely<V2Database>) {}
  private async permitted(database: Kysely<V2Database>, identity: OperatorIdentity) {
    const result = await sql`SELECT role FROM platform_operators WHERE issuer = ${identity.issuer} AND subject = ${identity.subject} AND active = true FOR SHARE`.execute(database);
    return result.rows.length > 0;
  }
  protected async access<T>(identity: OperatorIdentity, work: (database: Kysely<V2Database>) => Promise<T>): Promise<T> {
    try {
      const result = await inTransaction(this.database, async transaction => {
        const allowed = await this.permitted(transaction, identity);
        await sql`INSERT INTO operator_review_audit(id,issuer,subject,action) VALUES(${randomUUID()},${identity.issuer},${identity.subject},${allowed ? "ACCESS_ALLOWED" : "ACCESS_DENIED"})`.execute(transaction);
        if (!allowed) return { allowed: false as const };
        return { allowed: true as const, value: await work(transaction) };
      });
      if (!result.allowed) throw new ForbiddenError("Platform operator access is required.");
      return result.value;
    } catch (error) {
      if (!(error instanceof ForbiddenError)) {
        // Separate commit: a rejected mutation must not erase its failure audit.
        await sql`INSERT INTO operator_review_audit(id,issuer,subject,action) VALUES(${randomUUID()},${identity.issuer},${identity.subject},'ACTION_FAILED')`.execute(this.database);
      }
      throw error;
    }
  }

  detail(identity: OperatorIdentity, caseId: string) {
    return this.access(identity, async database => {
      const item = await sql<{ id: string; revision: number; layer: ReviewCaseEdit["layer"]; reproduction: ReviewCaseEdit["reproduction"]; expectedBehavior: ReviewCaseEdit["expectedBehavior"]; mergedInto:string|null }>`SELECT id,revision,layer,reproduction,expected_behavior AS "expectedBehavior",merged_into AS "mergedInto" FROM autofill_review_cases WHERE id = ${caseId}`.execute(database);
      if (!item.rows[0]) throw new NotFoundError("Review case not found.");
      const timeline = await sql<{ action: string; at: Date; revision: number | null; status: string | null; caseId:string }>`SELECT action,created_at AS at,from_revision AS revision,to_status AS status,case_id AS "caseId" FROM operator_review_audit WHERE case_id IN (SELECT id FROM autofill_review_cases WHERE id=${caseId} OR merged_into=${caseId}) ORDER BY created_at DESC,id DESC LIMIT 100`.execute(database);
      const members=await sql<{id:string;release:string;stage:string;code:string}>`SELECT id,release,stage,code FROM autofill_review_cases WHERE id=${caseId} OR merged_into=${caseId} ORDER BY id LIMIT 100`.execute(database);
      return { ...item.rows[0], members:members.rows, timeline: timeline.rows, evidence: "SYNTHETIC_REFERENCE_NOT_EVALUATION" as const };
    });
  }

  merge(identity:OperatorIdentity,caseId:string,raw:ReviewCaseMerge) {
    const input=ReviewCaseMergeSchema.parse(raw);
    return this.access(identity,db=>this.replayed(db,identity,input.requestId,{kind:"CASE_MERGE",caseId,...input},async()=>{
      if(caseId===input.targetCaseId)throw new ConflictError("A case cannot merge into itself.");
      // Serialize merge topology; lock both roots in stable order against ordinary OCC edits.
      await sql`SELECT pg_advisory_xact_lock(hashtext('operator-case-merge-topology')::bigint)`.execute(db);
      const rows=await sql<{id:string;revision:number;merged_into:string|null;status:string}>`SELECT id,revision,merged_into,status FROM autofill_review_cases WHERE id IN (${caseId},${input.targetCaseId}) ORDER BY id FOR UPDATE`.execute(db);
      const source=rows.rows.find(r=>r.id===caseId),target=rows.rows.find(r=>r.id===input.targetCaseId);
      if(!source||!target)throw new NotFoundError("Review case not found.");
      if(source.merged_into||target.merged_into)throw new ConflictError("Choose current root cases; merged cases cannot be merged again.");
      if(source.revision!==input.expectedSourceRevision||target.revision!==input.expectedTargetRevision)throw new ConflictError("Cases changed. Refresh both revisions before merging.");
      if(["RESOLVED","DISMISSED"].includes(target.status))throw new ConflictError("Reopen the target before merging active evidence into it.");
      const size=await sql<{count:number}>`SELECT count(*)::int AS count FROM autofill_review_cases WHERE id IN (${caseId},${input.targetCaseId}) OR merged_into IN (${caseId},${input.targetCaseId})`.execute(db);
      if((size.rows[0]?.count??0)>100)throw new ConflictError("A merged case can contain at most 100 evidence groups.");
      await sql`UPDATE autofill_review_cases SET merged_into=${input.targetCaseId},revision=revision+1 WHERE id=${caseId} OR merged_into=${caseId}`.execute(db);
      await sql`UPDATE autofill_review_cases SET revision=revision+1 WHERE id=${input.targetCaseId}`.execute(db);
      const details=JSON.stringify({sourceCaseId:caseId,targetCaseId:input.targetCaseId,sourceRevision:source.revision,targetRevision:target.revision});
      await sql`INSERT INTO operator_review_audit(id,issuer,subject,action,case_id,request_id,from_revision,details) VALUES(${randomUUID()},${identity.issuer},${identity.subject},'CASE_MERGED',${caseId},${input.requestId},${source.revision},${details}::jsonb)`.execute(db);
      return {sourceCaseId:caseId,targetCaseId:input.targetCaseId,sourceRevision:source.revision+1,targetRevision:target.revision+1};
    }));
  }

  private async rootOnly(db:Kysely<V2Database>,caseId:string) {
    const row=await sql<{merged_into:string|null}>`SELECT merged_into FROM autofill_review_cases WHERE id=${caseId}`.execute(db);
    if(row.rows[0]?.merged_into)throw new ConflictError("This case was merged. Open its current root before making changes.");
  }

  assign(identity: OperatorIdentity, caseId: string, raw: ReviewCaseAssignment) {
    const input=ReviewCaseAssignmentSchema.parse(raw);
    return this.access(identity,db=>this.replayed(db,identity,input.requestId,{kind:"ASSIGNMENT",caseId,...input},async()=>{
      const result=await sql<{revision:number;status:string;assignee_issuer:string|null;assignee_subject:string|null}>`SELECT revision,status,assignee_issuer,assignee_subject FROM autofill_review_cases WHERE id=${caseId} FOR UPDATE`.execute(db);
      const row=result.rows[0];if(!row)throw new NotFoundError("Review case not found.");
      await this.rootOnly(db,caseId);
      if(row.revision!==input.expectedRevision)throw new ConflictError("Case changed. Refresh before assigning.");
      if(input.action==="CLAIM") {
        if(row.assignee_subject!==null || ["RESOLVED","DISMISSED"].includes(row.status))throw new ConflictError("Only open, unassigned cases can be claimed.");
      } else {
        if(row.assignee_subject===null)throw new ConflictError("This case is not assigned.");
        if(input.action==="ADMIN_RELEASE") {
          const admin=await sql`SELECT subject FROM platform_operators WHERE issuer=${identity.issuer} AND subject=${identity.subject} AND role='ADMIN' AND active=true`.execute(db);
          if(!admin.rows.length)throw new ConflictError("Releasing another operator's case requires an administrator.");
        } else if(row.assignee_issuer!==identity.issuer || row.assignee_subject!==identity.subject)throw new ConflictError("Only the assigned operator can release this case.");
      }
      const claim=input.action==="CLAIM";
      await sql`UPDATE autofill_review_cases SET assignee_issuer=${claim?identity.issuer:null},assignee_subject=${claim?identity.subject:null},revision=revision+1 WHERE id=${caseId}`.execute(db);
      await sql`INSERT INTO operator_review_audit(id,issuer,subject,action,case_id,request_id,from_revision,details) VALUES(${randomUUID()},${identity.issuer},${identity.subject},${claim?"CASE_ASSIGNED":"CASE_RELEASED"},${caseId},${input.requestId},${input.expectedRevision},${JSON.stringify({action:input.action,previousIssuer:row.assignee_issuer,previousSubject:row.assignee_subject})}::jsonb)`.execute(db);
      return {revision:input.expectedRevision+1,assigneeIssuer:claim?identity.issuer:null,assigneeSubject:claim?identity.subject:null};
    }));
  }

  async edit(identity: OperatorIdentity, caseId: string, raw: ReviewCaseEdit) {
    const input = ReviewCaseEditSchema.parse(raw);
    return this.access(identity, database => this.replayed(database, identity, input.requestId, { kind: "CASE_EDIT", caseId, ...input }, async () => {
      const current = await sql<{ revision: number }>`SELECT revision FROM autofill_review_cases WHERE id = ${caseId} FOR UPDATE`.execute(database);
      if (!current.rows[0]) throw new NotFoundError("Review case not found.");
      await this.rootOnly(database,caseId);
      if (current.rows[0].revision !== input.expectedRevision) throw new ConflictError("This case changed. Refresh before reviewing.");
      await sql`UPDATE autofill_review_cases SET layer = ${input.layer},reproduction = ${input.reproduction},expected_behavior = ${input.expectedBehavior},revision = revision + 1 WHERE id = ${caseId}`.execute(database);
      await sql`INSERT INTO operator_review_audit(id,issuer,subject,action,case_id,request_id,from_revision,details) VALUES(${randomUUID()},${identity.issuer},${identity.subject},'CASE_EDITED',${caseId},${input.requestId},${input.expectedRevision},${JSON.stringify({layer:input.layer,reproduction:input.reproduction,expectedBehavior:input.expectedBehavior})}::jsonb)`.execute(database);
      return { revision: input.expectedRevision + 1 };
    }));
  }

  /** Only an already authenticated active ADMIN can provision peers; no self-grant. */
  async provision(identity: OperatorIdentity, raw: OperatorProvision) {
    const input = OperatorProvisionSchema.parse(raw);
    return this.access(identity, async database => {
      const admin = await sql`SELECT role FROM platform_operators WHERE issuer = ${identity.issuer} AND subject = ${identity.subject} AND active = true AND role = 'ADMIN'`.execute(database);
      if (!admin.rows.length || identity.issuer === input.issuer && identity.subject === input.subject) throw new ConflictError("Peer provisioning requires an active administrator and a different target identity.");
      return this.replayed(database, identity, input.requestId, {kind:"PROVISION",...input}, async () => {
        await sql`INSERT INTO platform_operators(issuer,subject,role,active) VALUES(${input.issuer},${input.subject},${input.role},${input.active}) ON CONFLICT(issuer,subject) DO UPDATE SET role = excluded.role,active = excluded.active`.execute(database);
        await sql`INSERT INTO operator_review_audit(id,issuer,subject,action,request_id,details) VALUES(${randomUUID()},${identity.issuer},${identity.subject},'OPERATOR_PROVISIONED',${input.requestId},${JSON.stringify({targetIssuer:input.issuer,targetSubject:input.subject,role:input.role,active:input.active})}::jsonb)`.execute(database);
        return { updated: true };
      });
    });
  }

  protected async replayed<T extends Record<string, unknown>>(database: Kysely<V2Database>, identity: OperatorIdentity, requestId: string, input: unknown, work: () => Promise<T>): Promise<T> {
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`${identity.issuer}:${identity.subject}:${requestId}`})::bigint)`.execute(database);
    const prior = await sql<{ fingerprint: string; result: T }>`SELECT fingerprint,result FROM operator_action_receipts WHERE issuer = ${identity.issuer} AND subject = ${identity.subject} AND request_id = ${requestId}`.execute(database);
    if (prior.rows[0]) {
      if (prior.rows[0].fingerprint !== fingerprint) throw new IdempotencyConflictError("Operator request identity was reused.");
      return prior.rows[0].result;
    }
    // Status transitions predate receipts; all mutations share the audit identity namespace.
    const audited = await sql`SELECT id FROM operator_review_audit WHERE issuer = ${identity.issuer} AND subject = ${identity.subject} AND request_id = ${requestId}`.execute(database);
    if (audited.rows.length) throw new IdempotencyConflictError("Operator request identity was reused.");
    const result = await work();
    await sql`INSERT INTO operator_action_receipts(issuer,subject,request_id,fingerprint,result) VALUES(${identity.issuer},${identity.subject},${requestId},${fingerprint},${JSON.stringify(result)}::jsonb)`.execute(database);
    return result;
  }
  list(identity: OperatorIdentity) {
    return this.access(identity, async database => {
      const groups = await sql<{ release: string; stage: string; code: string }>`SELECT DISTINCT release,stage,code FROM autofill_outcome_events LIMIT 100`.execute(database);
      for (const group of groups.rows) await sql`INSERT INTO autofill_review_cases(id,release,stage,code) VALUES(${randomUUID()},${group.release},${group.stage},${group.code}) ON CONFLICT(release,stage,code) DO NOTHING`.execute(database);
      const result = await sql<{ id: string; release: string; stage: string; code: string; status: ReviewTransition["status"]; revision: number; affectedRuns: number; assigneeIssuer:string|null;assigneeSubject:string|null }>`SELECT c.id,c.release,c.stage,c.code,c.status,c.revision,c.assignee_issuer AS "assigneeIssuer",c.assignee_subject AS "assigneeSubject",count(DISTINCT e.run_id)::int AS "affectedRuns"
        FROM autofill_review_cases c JOIN autofill_review_cases member ON member.id=c.id OR member.merged_into=c.id
        LEFT JOIN autofill_outcome_events e ON (e.release,e.stage,e.code) = (member.release,member.stage,member.code)
        WHERE c.merged_into IS NULL
        GROUP BY c.id ORDER BY count(DISTINCT e.run_id) DESC,c.id LIMIT 100`.execute(database);
      return { cases: result.rows, evidence: "VALUE_FREE_FAILURE_COUNTS_ONLY" as const };
    });
  }
  transition(identity: OperatorIdentity, input: ReviewTransition) {
    return this.access(identity, async database => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${identity.issuer}:${identity.subject}:${input.requestId}`})::bigint)`.execute(database);
      const current = await sql<{ revision: number }>`SELECT revision FROM autofill_review_cases WHERE id = ${input.caseId} FOR UPDATE`.execute(database);
      if (!current.rows[0]) throw new NotFoundError("Review case not found.");
      const replay = await sql<{ case_id: string; from_revision: number; to_status: string }>`SELECT case_id,from_revision,to_status FROM operator_review_audit WHERE issuer = ${identity.issuer} AND subject = ${identity.subject} AND request_id = ${input.requestId}`.execute(database);
      if (replay.rows[0]) {
        const previous = replay.rows[0];
        if (previous.case_id !== input.caseId || previous.from_revision !== input.expectedRevision || previous.to_status !== input.status) throw new IdempotencyConflictError("Review action identity was reused.");
        return { revision: previous.from_revision + 1, status: previous.to_status, replay: true };
      }
      await this.rootOnly(database,input.caseId);
      if (current.rows[0].revision !== input.expectedRevision) throw new ConflictError("This case changed. Refresh before reviewing.");
      await sql`UPDATE autofill_review_cases SET status = ${input.status},revision = revision + 1 WHERE id = ${input.caseId}`.execute(database);
      await sql`INSERT INTO operator_review_audit(id,issuer,subject,action,case_id,request_id,from_revision,to_status) VALUES(${randomUUID()},${identity.issuer},${identity.subject},'STATUS_CHANGED',${input.caseId},${input.requestId},${input.expectedRevision},${input.status})`.execute(database);
      return { revision: input.expectedRevision + 1, status: input.status, replay: false };
    });
  }
}

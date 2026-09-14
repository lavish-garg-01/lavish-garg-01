import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SupportRequestSchema, SupportApproveSchema, type SupportRequest, type SupportApprove } from "@job-hunter-v2/contracts";
import type { OperatorIdentity } from "@job-hunter-v2/auth";
import { ConflictError, ForbiddenError, IdempotencyConflictError, NotFoundError } from "@job-hunter-v2/domain";
import type { LearningPayloadCipher } from "@job-hunter-v2/verified-learning";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";
import { inTransaction } from "./transaction-scope.js";

type Owner = { accountId: string; candidateId: string };
type Actor = OperatorIdentity | Owner;
type Grant = { id: string; case_id: string; issuer: string; subject: string; purpose: string; account_id: string | null; candidate_id: string | null; note_id: string | null; approved_at: Date | null; expires_at: Date | null; revoked_at: Date | null; duration_minutes: number | null; request_live: boolean; live: boolean };
type Payload = { keyVersion: number; initializationVector: string; authenticationTag: string; ciphertext: string };
const evidenceSchema = z.object({ question: z.string().max(4000), answer: z.string().max(16000) });
const unavailable = () => new NotFoundError("Support access unavailable. Check ownership, consent and expiry.");

/** One note, one requesting operator, explicit candidate approval. Never a profile export. */
export class SupportReviewRepository {
  constructor(private readonly database: Kysely<V2Database>, private readonly cipher: LearningPayloadCipher) {}
  private async operator(db: Kysely<V2Database>, identity: OperatorIdentity) {
    const row = await sql`SELECT subject FROM platform_operators WHERE issuer=${identity.issuer} AND subject=${identity.subject} AND active=true FOR SHARE`.execute(db);
    if (!row.rows.length) throw new ForbiddenError("Active operator access required.");
  }
  private async audit(db: Kysely<V2Database>, actor: Actor, action: string, grantId: string | null) {
    const operator = "issuer" in actor;
    await sql`INSERT INTO support_review_audit(id,grant_id,actor_kind,issuer,subject,candidate_id,action)
      VALUES(${randomUUID()},${grantId},${operator ? "OPERATOR" : "CANDIDATE"},${operator ? actor.issuer : null},${operator ? actor.subject : null},${operator ? null : actor.candidateId},${action})`.execute(db);
  }
  private async access<T>(actor: Actor, action: string, work: (db: Kysely<V2Database>) => Promise<{ value: T; grantId: string | null }>) {
    try {
      return await inTransaction(this.database, async db => {
        if ("issuer" in actor) await this.operator(db, actor);
        else {
          const active = await sql`SELECT c.id FROM candidates c JOIN accounts a ON a.id=c.account_id WHERE c.id=${actor.candidateId} AND a.id=${actor.accountId} AND c.status='ACTIVE' AND a.status='ACTIVE' FOR SHARE OF c,a`.execute(db);
          if (!active.rows.length) throw unavailable();
        }
        const result = await work(db);
        await this.audit(db, actor, action, result.grantId);
        return result.value;
      });
    } catch (error) {
      // A failed transaction must not remove its denial record; never log inputs/errors here.
      await this.audit(this.database, actor, "DENIED", null);
      throw error;
    }
  }
  private async grant(db: Kysely<V2Database>, id: string) {
    const result = await sql<Grant>`SELECT *,request_expires_at>clock_timestamp() AS request_live,expires_at>clock_timestamp() AS live FROM support_review_grants WHERE id=${id} FOR UPDATE`.execute(db);
    if (!result.rows[0]) throw unavailable();
    return result.rows[0];
  }
  private async note(db: Kysely<V2Database>, owner: Owner, id: string, caseId?: string) {
    const related = caseId ? sql`AND EXISTS(SELECT 1 FROM autofill_outcome_events e JOIN autofill_review_cases review ON (review.release,review.stage,review.code)=(e.release,e.stage,e.code)
      WHERE (review.id=${caseId} OR review.merged_into=${caseId}) AND e.run_id=n.run_id AND e.application_id=n.application_id AND e.account_id=n.account_id AND e.candidate_id=n.candidate_id)` : sql``;
    const rows = await sql<{ payload: Payload; expires_at: Date }>`SELECT n.payload,n.expires_at FROM candidate_learning_inbox n
      JOIN applications app ON app.id=n.application_id AND app.account_id=n.account_id AND app.candidate_id=n.candidate_id
      JOIN application_runs run ON run.id=n.run_id AND run.application_id=app.id
      JOIN candidates c ON c.id=n.candidate_id AND c.account_id=n.account_id JOIN accounts a ON a.id=n.account_id
      WHERE n.id=${id} AND n.account_id=${owner.accountId} AND n.candidate_id=${owner.candidateId} AND n.payload IS NOT NULL AND n.status='PENDING'
      AND n.expires_at>clock_timestamp() AND c.status='ACTIVE' AND a.status='ACTIVE' ${related} FOR SHARE OF n,c,a,app,run`.execute(db);
    if (!rows.rows[0]) throw unavailable();
    return rows.rows[0];
  }
  private view(g: Grant) { return { id:g.id,caseId:g.case_id,issuer:g.issuer,subject:g.subject,purpose:g.purpose,expiresAt:g.expires_at,
    status:g.revoked_at ? "REVOKED" : g.approved_at ? g.live ? "APPROVED" : "EXPIRED" : g.request_live ? "PENDING" : "EXPIRED" }; }
  request(identity: OperatorIdentity, raw: SupportRequest) {
    const input = SupportRequestSchema.parse(raw);
    return this.access(identity,"REQUESTED",async db => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`support:${identity.issuer}:${identity.subject}:${input.requestId}`})::bigint)`.execute(db);
      const existing = await sql<{id:string;case_id:string;purpose:string}>`SELECT id,case_id,purpose FROM support_review_grants WHERE issuer=${identity.issuer} AND subject=${identity.subject} AND request_id=${input.requestId}`.execute(db);
      let id = existing.rows[0]?.id;
      if (id && (existing.rows[0]!.case_id!==input.caseId || existing.rows[0]!.purpose!==input.purpose)) throw new IdempotencyConflictError("Support request identity reused.");
      if (!id) {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${`support-case:${identity.issuer}:${identity.subject}:${input.caseId}`})::bigint)`.execute(db);
        const count=await sql<{count:number}>`SELECT count(*)::int AS count FROM support_review_grants WHERE issuer=${identity.issuer} AND subject=${identity.subject} AND case_id=${input.caseId} AND revoked_at IS NULL AND (expires_at>clock_timestamp() OR approved_at IS NULL AND request_expires_at>clock_timestamp())`.execute(db);
        if((count.rows[0]?.count??0)>=20)throw new ConflictError("Too many live requests for this case. Wait for expiry or have candidates revoke old grants.");
        const found = await sql`SELECT id FROM autofill_review_cases WHERE id=${input.caseId} AND merged_into IS NULL FOR SHARE`.execute(db);
        if (!found.rows.length) throw unavailable();
        id=randomUUID();
        await sql`INSERT INTO support_review_grants(id,request_id,case_id,issuer,subject,purpose) VALUES(${id},${input.requestId},${input.caseId},${identity.issuer},${identity.subject},${input.purpose})`.execute(db);
      }
      return {value:this.view(await this.grant(db,id)),grantId:id};
    });
  }
  preview(owner: Owner, grantId: string, itemId: string) {
    return this.access(owner,"PREVIEWED",async db => {
      const g=await this.grant(db,grantId);
      if (g.revoked_at || (g.approved_at ? g.candidate_id!==owner.candidateId || g.account_id!==owner.accountId || g.note_id!==itemId || !g.live : !g.request_live)) throw unavailable();
      await this.operator(db,g);
      await this.note(db,owner,itemId,g.case_id);
      return {value:this.view(g),grantId};
    });
  }
  approve(owner: Owner, grantId: string, raw: SupportApprove) {
    const input=SupportApproveSchema.parse(raw);
    return this.access(owner,"APPROVED",async db => {
      const g=await this.grant(db,grantId);
      await this.operator(db,g);
      if (g.approved_at) {
        if (g.candidate_id!==owner.candidateId || g.account_id!==owner.accountId || g.note_id!==input.itemId || g.duration_minutes!==input.durationMinutes) throw new IdempotencyConflictError("Approval identity reused.");
        // Replay reports the original status; never extends consent or reopens a revoked grant.
        return {value:this.view(g),grantId};
      }
      if (!g.request_live || g.revoked_at) throw unavailable();
      const note=await this.note(db,owner,input.itemId,g.case_id);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`support-note:${input.itemId}`})::bigint)`.execute(db);
      const count=await sql<{count:number}>`SELECT count(*)::int AS count FROM support_review_grants WHERE note_id=${input.itemId} AND revoked_at IS NULL AND expires_at>clock_timestamp()`.execute(db);
      if((count.rows[0]?.count??0)>=20)throw new ConflictError("Revoke an existing grant before sharing this note again.");
      const updated=await sql`WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS at)
        UPDATE support_review_grants SET account_id=${owner.accountId},candidate_id=${owner.candidateId},note_id=${input.itemId},approved_at=stamp.at,
        expires_at=least(${note.expires_at},stamp.at+${input.durationMinutes}*interval '1 minute'),duration_minutes=${input.durationMinutes} FROM stamp
        WHERE id=${grantId} AND request_expires_at>stamp.at AND ${note.expires_at}>stamp.at RETURNING id`.execute(db);
      if(!updated.rows.length)throw unavailable();
      return {value:this.view(await this.grant(db,grantId)),grantId};
    });
  }
  revoke(owner: Owner, grantId: string) {
    return this.access(owner,"REVOKED",async db => {
      const g=await this.grant(db,grantId);
      if (g.candidate_id!==owner.candidateId || g.account_id!==owner.accountId) throw unavailable();
      await sql`UPDATE support_review_grants SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=${grantId}`.execute(db);
      return {value:{revoked:true},grantId};
    });
  }
  listForNote(owner: Owner, itemId: string) {
    return this.access(owner,"LISTED",async db => {
      // Deleted/expired notes still permit listing and revoking their grants.
      const owned=await sql`SELECT id FROM candidate_learning_inbox WHERE id=${itemId} AND account_id=${owner.accountId} AND candidate_id=${owner.candidateId}`.execute(db);
      if (!owned.rows.length) throw unavailable();
      const rows=await sql<Grant>`SELECT *,request_expires_at>clock_timestamp() AS request_live,expires_at>clock_timestamp() AS live FROM support_review_grants WHERE note_id=${itemId} AND account_id=${owner.accountId} AND candidate_id=${owner.candidateId} ORDER BY (revoked_at IS NULL AND expires_at>clock_timestamp()) DESC,requested_at DESC,id DESC LIMIT 200`.execute(db);
      return {value:{grants:rows.rows.map(g=>this.view(g))},grantId:null};
    });
  }
  list(identity: OperatorIdentity, caseId: string) {
    return this.access(identity,"LISTED",async db => {
      const rows=await sql<Grant>`SELECT *,request_expires_at>clock_timestamp() AS request_live,expires_at>clock_timestamp() AS live FROM support_review_grants WHERE case_id IN (SELECT id FROM autofill_review_cases WHERE id=${caseId} OR merged_into=${caseId}) AND issuer=${identity.issuer} AND subject=${identity.subject} ORDER BY (revoked_at IS NULL AND (expires_at>clock_timestamp() OR approved_at IS NULL AND request_expires_at>clock_timestamp())) DESC NULLS LAST,requested_at DESC,id DESC LIMIT 100`.execute(db);
      return {value:{grants:rows.rows.map(g=>this.view(g))},grantId:null};
    });
  }
  read(identity: OperatorIdentity, grantId: string) {
    return this.access(identity,"READ",async db => {
      const g=await this.grant(db,grantId);
      if (g.issuer!==identity.issuer || g.subject!==identity.subject || !g.approved_at || !g.live || g.revoked_at || !g.account_id || !g.candidate_id || !g.note_id) throw unavailable();
      const note=await this.note(db,{accountId:g.account_id,candidateId:g.candidate_id},g.note_id);
      // Recheck wall-clock after locks: transaction start time must not extend access.
      const live=await sql`SELECT id FROM support_review_grants WHERE id=${grantId} AND expires_at>clock_timestamp() AND ${note.expires_at}>clock_timestamp()`.execute(db);
      if (!live.rows.length) throw unavailable();
      const p=note.payload;
      let evidence: z.infer<typeof evidenceSchema>;
      try {
        const decoded=this.cipher.decrypt({keyVersion:p.keyVersion,initializationVector:Buffer.from(p.initializationVector,"base64"),authenticationTag:Buffer.from(p.authenticationTag,"base64"),ciphertext:Buffer.from(p.ciphertext,"base64")});
        if(decoded.kind!=="STRING") throw new Error("Invalid payload type");
        evidence=evidenceSchema.parse(JSON.parse(decoded.value));
      } catch {
        // JSON/decryption errors can contain private text. Never send them to request logging.
        throw new ConflictError("Private note cannot be read.");
      }
      return {value:{grantId,expiresAt:g.expires_at,evidence,containsCandidateValue:true as const},grantId};
    });
  }
}

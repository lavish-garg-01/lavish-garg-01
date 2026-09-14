import { sql,type Kysely } from "kysely";
import type { V2Database } from "./index.js";

/** Startup check, not a replacement for grants/RLS or per-request consent and MFA. */
export async function assertReviewDatabaseRole(db:Kysely<V2Database>,kind:"runtime"|"evaluator") {
  const wanted=`job_hunter_review_${kind}`,other=`job_hunter_review_${kind==="runtime"?"evaluator":"runtime"}`;
  const roles=await sql<{valid:boolean}>`SELECT
    pg_has_role(current_user,${wanted},'USAGE') AND NOT pg_has_role(current_user,${other},'MEMBER')
    AND NOT EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER') AND (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb))
    AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND pg_has_role(current_user,c.relowner,'MEMBER'))
    AND NOT has_schema_privilege(current_user,'public','CREATE') AS valid`.execute(db);
  if(!roles.rows[0]?.valid)throw new Error("Review database role is unsafe or unprovisioned; use its dedicated least-privilege login.");
  const permissions=await sql<{evaluation_write:boolean;approval_write:boolean;profile_read:boolean;note_read:boolean}>`SELECT
    has_any_column_privilege(current_user,'reviewed_evaluations','INSERT') AS evaluation_write,
    has_any_column_privilege(current_user,'reviewed_approvals','INSERT') AS approval_write,
    (has_any_column_privilege(current_user,'candidate_answers_current','SELECT') OR has_any_column_privilege(current_user,'candidate_answer_versions','SELECT') OR has_any_column_privilege(current_user,'documents','SELECT')) AS profile_read,
    has_any_column_privilege(current_user,'candidate_learning_inbox','SELECT') AS note_read`.execute(db);
  const p=permissions.rows[0]!;
  if(p.profile_read||(kind==="runtime"?(p.evaluation_write||!p.approval_write):(!p.evaluation_write||p.approval_write||p.note_read)))throw new Error("Review database permission separation is invalid.");
}

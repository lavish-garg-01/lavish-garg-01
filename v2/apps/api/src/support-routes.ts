import { z } from "zod";
import { SupportRequestSchema, SupportApproveSchema } from "@job-hunter-v2/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CandidateSessionAuthenticator } from "@job-hunter-v2/onboarding";
import type { SupportReviewRepository } from "@job-hunter-v2/database";
import type { OperatorTokenVerifier } from "@job-hunter-v2/auth";
import { ValidationError } from "@job-hunter-v2/domain";

export interface SupportServices {
  sessions: CandidateSessionAuthenticator;
  repository: Pick<SupportReviewRepository,"request"|"preview"|"approve"|"revoke"|"listForNote"|"list"|"read">;
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T { const result=schema.safeParse(raw); if(!result.success) throw new ValidationError("Invalid support review request."); return result.data; }
export async function registerSupportRoutes(app: FastifyInstance, services: SupportServices, verifier: Pick<OperatorTokenVerifier,"verify">) {
  const id=(r:FastifyRequest)=>parse(z.uuid(),(r.params as {id:string}).id);
  const owner=async(r:FastifyRequest)=>{const s=await services.sessions.authenticate(r.headers.authorization);return {accountId:s.account.accountId,candidateId:s.candidate.candidateId};};
  app.post("/v1/operator/support",{bodyLimit:2048},async(r,p)=>{p.header("Cache-Control","no-store");const who=await verifier.verify(r.headers.authorization);return services.repository.request(who,parse(SupportRequestSchema,r.body));});
  app.get("/v1/operator/cases/:id/support",async(r,p)=>{p.header("Cache-Control","no-store");const who=await verifier.verify(r.headers.authorization);return services.repository.list(who,id(r));});
  // Explicit POST, not prefetchable GET: every private read is authenticated and audited.
  app.post("/v1/operator/support/:id/read",{bodyLimit:256},async(r,p)=>{p.header("Cache-Control","no-store");const who=await verifier.verify(r.headers.authorization);parse(z.object({}).strict(),r.body);return services.repository.read(who,id(r));});
  app.post("/v1/support/:id/preview",{bodyLimit:512},async(r,p)=>{p.header("Cache-Control","no-store");const who=await owner(r);const body=parse(z.object({itemId:z.uuid()}).strict(),r.body);return services.repository.preview(who,id(r),body.itemId);});
  app.post("/v1/support/:id/approve",{bodyLimit:1024},async(r,p)=>{p.header("Cache-Control","no-store");const who=await owner(r);return services.repository.approve(who,id(r),parse(SupportApproveSchema,r.body));});
  app.post("/v1/support/:id/revoke",{bodyLimit:256},async(r,p)=>{p.header("Cache-Control","no-store");const who=await owner(r);parse(z.object({}).strict(),r.body);return services.repository.revoke(who,id(r));});
  app.get("/v1/learning/inbox/:id/support",async(r,p)=>{p.header("Cache-Control","no-store");const who=await owner(r);return services.repository.listForNote(who,id(r));});
}

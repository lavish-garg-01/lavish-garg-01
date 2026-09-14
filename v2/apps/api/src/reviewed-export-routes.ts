import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { OperatorTokenVerifier } from "@job-hunter-v2/auth";
import type { ReviewedExportRepository } from "@job-hunter-v2/database";
import { ReviewedArtifactSchema,ReviewedApprovalSchema,ReviewedExportSchema,ReviewedExportControlSchema } from "@job-hunter-v2/contracts";
import { ValidationError } from "@job-hunter-v2/domain";
export type ReviewedExportServices=Pick<ReviewedExportRepository,"propose"|"approve"|"prepare"|"control"|"inspect"|"manifest">;
const parse=<T>(schema:z.ZodType<T>,raw:unknown)=>{const p=schema.safeParse(raw);if(!p.success)throw new ValidationError("Invalid reviewed export request.");return p.data;};
export async function registerReviewedExportRoutes(app:FastifyInstance,repo:ReviewedExportServices,verifier:Pick<OperatorTokenVerifier,"verify">){
  app.post("/v1/operator/artifacts",{bodyLimit:2048},async(r,p)=>{p.header("Cache-Control","no-store");const who=await verifier.verify(r.headers.authorization);return repo.propose(who,parse(ReviewedArtifactSchema,r.body));});
  app.post("/v1/operator/artifacts/approve",{bodyLimit:2048},async(r,p)=>{p.header("Cache-Control","no-store");const who=await verifier.verify(r.headers.authorization);return repo.approve(who,parse(ReviewedApprovalSchema,r.body));});
  app.post("/v1/operator/exports/prepare",{bodyLimit:2048},async(r,p)=>{p.header("Cache-Control","no-store");const who=await verifier.verify(r.headers.authorization);return repo.prepare(who,parse(ReviewedExportSchema,r.body));});
  app.post("/v1/operator/exports/control",{bodyLimit:1024},async(r,p)=>{p.header("Cache-Control","no-store");const who=await verifier.verify(r.headers.authorization);return repo.control(who,parse(ReviewedExportControlSchema,r.body));});
  app.get("/v1/operator/cases/:caseId/artifacts",async(r,p)=>{p.header("Cache-Control","no-store");const who=await verifier.verify(r.headers.authorization);return repo.inspect(who,parse(z.uuid(),(r.params as {caseId:string}).caseId));});
  app.get("/v1/operator/exports/manifest",async(r,p)=>{p.header("Cache-Control","no-store");const who=await verifier.verify(r.headers.authorization),input=parse(z.object({apiProtocol:z.coerce.number().int().positive(),extensionProtocol:z.coerce.number().int().positive()}).strict(),r.query);return repo.manifest(who,input.apiProtocol,input.extensionProtocol);});
  // Intentionally no evaluator/proof-upload endpoint and no runtime activation endpoint.
}

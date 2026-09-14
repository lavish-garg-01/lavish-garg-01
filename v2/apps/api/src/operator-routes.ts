import { z } from "zod";
import { ReviewCaseEditSchema, OperatorProvisionSchema, ReviewCaseAssignmentSchema, ReviewCaseMergeSchema } from "@job-hunter-v2/contracts";
import type { FastifyInstance } from "fastify";
import type { OperatorTokenVerifier } from "@job-hunter-v2/auth";
import type { OperatorReviewRepository } from "@job-hunter-v2/database";
import { ValidationError } from "@job-hunter-v2/domain";
import { registerSupportRoutes, type SupportServices } from "./support-routes.js";
import { registerReviewedExportRoutes,type ReviewedExportServices } from "./reviewed-export-routes.js";

export interface OperatorServices { reviewedExports?:ReviewedExportServices; support?: SupportServices; verifier: Pick<OperatorTokenVerifier, "verify">; repository: Pick<OperatorReviewRepository, "list" | "transition"> & Partial<Pick<OperatorReviewRepository,"detail" | "edit" | "provision" | "assign" | "merge">> }
const transition = z.object({ requestId: z.uuid(), expectedRevision: z.number().int().positive(), status: z.enum(["OPEN","INVESTIGATING","RESOLVED","DISMISSED"]) }).strict();
export async function registerOperatorRoutes(app: FastifyInstance, services: OperatorServices) {
  if (services.support) await registerSupportRoutes(app,services.support,services.verifier);
  if(services.reviewedExports)await registerReviewedExportRoutes(app,services.reviewedExports,services.verifier);
  app.post("/v1/operator/cases/:caseId/merge",{bodyLimit:1024},async(request,reply)=>{
    reply.header("Cache-Control","no-store");const identity=await services.verifier.verify(request.headers.authorization);
    const id=z.uuid().safeParse((request.params as {caseId:string}).caseId),body=ReviewCaseMergeSchema.safeParse(request.body);
    if(!id.success||!body.success||!services.repository.merge)throw new ValidationError("Review and confirm both case revisions before merging.");
    return services.repository.merge(identity,id.data,body.data);
  });
  app.post("/v1/operator/cases/:caseId/assignment",{bodyLimit:1024},async(request,reply)=>{
    reply.header("Cache-Control","no-store");
    const identity=await services.verifier.verify(request.headers.authorization);
    const id=z.uuid().safeParse((request.params as {caseId:string}).caseId),body=ReviewCaseAssignmentSchema.safeParse(request.body);
    if(!id.success||!body.success||!services.repository.assign)throw new ValidationError("Invalid case assignment.");
    return services.repository.assign(identity,id.data,body.data);
  });
  app.get("/v1/operator/cases/:caseId", async (request, reply) => {
    const identity = await services.verifier.verify(request.headers.authorization);
    const id = z.uuid().safeParse((request.params as {caseId:string}).caseId);
    if (!id.success || !services.repository.detail) throw new ValidationError("Case details unavailable.");
    reply.header("Cache-Control","no-store"); return services.repository.detail(identity,id.data);
  });
  app.post("/v1/operator/cases/:caseId/review", {bodyLimit:2048}, async (request,reply) => {
    const identity = await services.verifier.verify(request.headers.authorization);
    const id = z.uuid().safeParse((request.params as {caseId:string}).caseId), body = ReviewCaseEditSchema.safeParse(request.body);
    if (!id.success || !body.success || !services.repository.edit) throw new ValidationError("Invalid case review.");
    reply.header("Cache-Control","no-store"); return services.repository.edit(identity,id.data,body.data);
  });
  app.post("/v1/operator/roles", {bodyLimit:4096}, async (request,reply) => {
    const identity = await services.verifier.verify(request.headers.authorization);
    const body = OperatorProvisionSchema.safeParse(request.body);
    if (!body.success || !services.repository.provision) throw new ValidationError("Invalid operator provisioning command.");
    reply.header("Cache-Control","no-store"); return services.repository.provision(identity,body.data);
  });
  app.get("/v1/operator/cases", async (request, reply) => {
    const identity = await services.verifier.verify(request.headers.authorization);
    reply.header("Cache-Control","no-store");
    return services.repository.list(identity);
  });
  app.post("/v1/operator/cases/:caseId/status", { bodyLimit: 2048 }, async (request, reply) => {
    const identity = await services.verifier.verify(request.headers.authorization);
    const caseId = z.uuid().safeParse((request.params as { caseId: string }).caseId);
    const body = transition.safeParse(request.body);
    if (!caseId.success || !body.success) throw new ValidationError("Invalid review transition.");
    reply.header("Cache-Control","no-store");
    return services.repository.transition(identity, { ...body.data, caseId: caseId.data });
  });
}

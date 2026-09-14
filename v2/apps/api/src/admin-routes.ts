import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "@job-hunter-v2/domain";
import { FieldEvidenceInputSchema } from "@job-hunter-v2/contracts";
import { PersistableNormalizedValueSchema } from "@job-hunter-v2/candidate-truth";
import { RepresentationError } from "@job-hunter-v2/execution";
import { type AdminAuth, registerAdminAuth } from "./admin-auth.js";
import { type AdminWorkspace, AdminConflict } from "./admin-workspace.js";
export interface AdminServices { auth:AdminAuth; workspace:AdminWorkspace }
export async function registerAdminRoutes(app:FastifyInstance,services:AdminServices) {
  await app.register(async admin=>{
    await registerAdminAuth(admin,services.auth);
    admin.setErrorHandler((error,request,reply)=>{
      if(error instanceof AppError) return reply.code(error.statusCode).send({error:{code:error.code,message:error.message}});
      if(error instanceof AdminConflict) return reply.code(409).send({error:{code:"ADMIN_CONFLICT",message:error.message}});
      if(error instanceof RepresentationError) return reply.code(422).send({error:{code:error.code,message:error.reasonCode}});
      if(error instanceof z.ZodError) return reply.code(400).send({error:{code:"ADMIN_VALIDATION",message:error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")}});
      if(typeof error==="object"&&error!==null&&"statusCode" in error&&error.statusCode===413)return reply.code(413).send({error:{code:"ADMIN_PAYLOAD_TOO_LARGE",message:"This admin request exceeds the allowed size."}});
      const message=error instanceof Error?error.message:"";
      if(/^(Q_|Unknown admin|Unknown canonical|UNKNOWN_CANONICAL|Protected field|Money scale|Experience units|Candidate not found|Strategy intelligence)/.test(message)) return reply.code(400).send({error:{code:"ADMIN_COMMAND_REJECTED",message}});
      request.log.error({err:error},"admin operation failed");
      return reply.code(500).send({error:{code:"ADMIN_OPERATION_FAILED",message:"Operation failed. Check API logs using this request ID.",requestId:request.id}});
    });
    admin.get("/v1/admin/overview",()=>services.workspace.overview());
    admin.get("/v1/admin/registry",()=>services.workspace.registry());
    admin.get("/v1/admin/strategy-definitions",async()=>({items:await services.workspace.strategies?.repository.definitions()??[]}));
    admin.post("/v1/admin/representation-preview",request=>{
      const b=z.object({canonicalKey:z.string().max(100),label:z.string().max(500),controlType:z.enum(["TEXT","TEXTAREA","NUMBER","DATE","SELECT"]).default("TEXT"),options:z.array(z.string().max(200)).max(100).default([]),value:PersistableNormalizedValueSchema}).strict().parse(request.body);
      const field=FieldEvidenceInputSchema.parse({evidenceVersion:1,fieldRuntimeId:"field:12345678",pageInstanceId:crypto.randomUUID(),formInstanceId:"form:12345678",sectionFingerprint:"section:12345678",controlFingerprint:"control:12345678",controlType:b.controlType,labelEvidence:[b.label],
        contextEvidence:{section:null,previousLabel:null,nextLabel:null,semanticGroup:null,pageHeading:null,formHeading:null,nearbyDescription:null},locatorEvidence:{tagName:b.controlType==="SELECT"?"select":"input",type:b.controlType==="DATE"?"date":"text",name:null,id:null,autocomplete:null,ariaLabel:null,placeholder:null,role:null,accessibleDescription:null,occurrence:0},optionEvidence:{count:b.options.length,samples:b.options},repeatableEvidence:{entityType:null,bindingKind:"NONE",instanceKey:null,candidateEntityId:null,ordinalHint:null,groupLabel:null},required:false,disabled:false,ownership:"UNKNOWN"});
      return services.workspace.runtime.resolve(b.value,field,{canonicalKey:b.canonicalKey});
    });
    admin.get("/v1/admin/resources/:resource",request=>{
      const p=z.object({resource:z.string().max(40)}).parse(request.params);
      const q=z.object({search:z.string().max(150).default(""),offset:z.coerce.number().int().min(0).max(100000).default(0)}).parse(request.query);
      return services.workspace.list(p.resource,q.search,q.offset);
    });
    admin.get("/v1/admin/candidates/:id",request=>services.workspace.graph(z.object({id:z.uuid()}).parse(request.params).id));
    admin.post("/v1/admin/candidates/:id/answers",{bodyLimit:65536},request=>services.workspace.editProfile(z.object({id:z.uuid()}).parse(request.params).id,request.body));
    admin.post("/v1/admin/candidates/:id/restore",request=>services.workspace.restoreProfile(z.object({id:z.uuid()}).parse(request.params).id,request.body));
    admin.post("/v1/admin/operate",request=>services.workspace.operate(request.body));
    admin.post("/v1/admin/configuration",{bodyLimit:32768},request=>services.workspace.saveConfig(request.body));
    admin.post("/v1/admin/canonical-review",request=>services.workspace.reviewProposal(request.body));
    admin.post("/v1/admin/failure-review",request=>services.workspace.reviewFailure(request.body));
    admin.post("/v1/admin/strategy",{bodyLimit:65536},request=>services.workspace.strategy(request.body));
  });
}

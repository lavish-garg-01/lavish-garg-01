import { z } from "zod";
import { StrategyKeySchema } from "./strategy-policy.js";
export const ReviewCaseEditSchema = z.object({
  requestId: z.uuid(), expectedRevision: z.number().int().positive(),
  layer: z.enum(["UNASSIGNED","SCAN","SEMANTICS","REPRESENTATION","EXECUTION","LEARNING","AUTHORIZATION"]),
  reproduction: z.enum(["NONE","ADAPTIVE_AUTOFILL","PRIVATE_NOTE","LEARNING_RECOVERY","OPERATOR_REVIEW"]),
  expectedBehavior: z.enum(["UNSPECIFIED","PRESERVE_CANDIDATE_EDIT","FILL_VERIFIED_VALUE","REQUIRE_CONFIRMATION","REJECT_UNAUTHORIZED_ACCESS","REPLAY_ORIGINAL_RESULT","REPORT_INCOMPLETE_SCAN"])
}).strict();
export type ReviewCaseEdit = z.infer<typeof ReviewCaseEditSchema>;
export const OperatorProvisionSchema = z.object({ requestId: z.uuid(), issuer: z.string().url().max(500), subject: z.string().min(1).max(300), role: z.enum(["REVIEWER","ADMIN"]), active: z.boolean() }).strict();
export type OperatorProvision = z.infer<typeof OperatorProvisionSchema>;
export const SupportRequestSchema = z.object({ requestId: z.uuid(), caseId: z.uuid(), purpose: z.enum(["DEBUG_AUTOFILL","DEBUG_REPRESENTATION","DEBUG_LEARNING"]) }).strict();
export const SupportApproveSchema = z.object({ itemId: z.uuid(), durationMinutes: z.union([z.literal(15),z.literal(60)]), confirmed: z.literal(true) }).strict();
export type SupportRequest = z.infer<typeof SupportRequestSchema>;
export type SupportApprove = z.infer<typeof SupportApproveSchema>;
export const ReviewCaseAssignmentSchema = z.object({ requestId:z.uuid(),expectedRevision:z.number().int().positive(),action:z.enum(["CLAIM","RELEASE","ADMIN_RELEASE"]) }).strict();
export type ReviewCaseAssignment = z.infer<typeof ReviewCaseAssignmentSchema>;
export const ReviewCaseMergeSchema=z.object({requestId:z.uuid(),targetCaseId:z.uuid(),expectedSourceRevision:z.number().int().positive(),expectedTargetRevision:z.number().int().positive(),confirmed:z.literal(true)}).strict();
export type ReviewCaseMerge=z.infer<typeof ReviewCaseMergeSchema>;
export const ReviewedArtifactSchema=z.object({requestId:z.uuid(),caseId:z.uuid(),strategyKey:StrategyKeySchema,apiProtocol:z.literal(1),extensionProtocol:z.literal(1)}).strict();
export const ReviewedApprovalSchema=z.object({requestId:z.uuid(),artifactId:z.uuid(),artifactHash:z.string().regex(/^[a-f0-9]{64}$/),evaluationId:z.uuid(),confirmed:z.literal(true)}).strict();
export const ReviewedExportSchema=z.object({requestId:z.uuid(),artifactId:z.uuid(),approvalId:z.uuid(),expectedRevision:z.number().int().positive(),confirmed:z.literal(true)}).strict();
export const ReviewedExportControlSchema=z.object({requestId:z.uuid(),expectedRevision:z.number().int().positive(),action:z.enum(["DISABLE","ROLLBACK"])}).strict();
export type ReviewedArtifact=z.infer<typeof ReviewedArtifactSchema>;
export type ReviewedApproval=z.infer<typeof ReviewedApprovalSchema>;
export type ReviewedExport=z.infer<typeof ReviewedExportSchema>;
export type ReviewedExportControl=z.infer<typeof ReviewedExportControlSchema>;

import { z } from "zod";

const identity = { schemaVersion: z.literal(1), applicationId: z.uuid(), applicationRunId: z.uuid() };
export const LearningInboxCaptureSchema = z.object({
  ...identity, itemId: z.uuid(),
  question: z.string().trim().min(1).max(2000), answer: z.string().trim().min(1).max(8000),
  source: z.enum(["EXPLICIT_SAVE", "COMMITTED_EDIT"])
}).strict().refine((item) => JSON.stringify(item).length <= 7800, "Private evidence exceeds the combined limit.");
export type LearningInboxCapture = z.infer<typeof LearningInboxCaptureSchema>;
const noteConfirmation = {
  expectedCurrentVersionId: z.uuid().nullable(),
  confirmedGlobalDefault: z.boolean(),
  scope: z.enum(["GLOBAL", "APPLICATION"]).optional()
};
export const ConfirmLearningNoteSchema = z.union([
  z.object({ ...noteConfirmation, canonicalKey: z.enum(["FIRST_NAME", "LAST_NAME", "FULL_NAME", "EMAIL", "CURRENT_LOCATION"]), answer: z.string().trim().min(1).max(500) }).strict(),
  z.object({ ...noteConfirmation, canonicalKey: z.enum(["LINKEDIN_URL", "GITHUB_URL", "PORTFOLIO_URL"]), answer: z.string().trim().min(1).max(2048) }).strict(),
  z.object({ ...noteConfirmation, canonicalKey: z.enum(["CURRENT_CTC", "EXPECTED_CTC"]), answer: z.string().trim().regex(/^\d{1,16}(?:\.\d{1,6})?$/), currency: z.string().regex(/^[A-Z]{3}$/), scale: z.enum(["BASE", "LAKH", "CRORE"]), period: z.enum(["YEAR", "MONTH"]) }).strict(),
  z.object({ ...noteConfirmation, canonicalKey: z.literal("NOTICE_PERIOD"), answer: z.string().trim().regex(/^\d{1,4}$/), unit: z.literal("DAYS") }).strict(),
  z.object({ ...noteConfirmation, canonicalKey: z.literal("TOTAL_EXPERIENCE"), answer: z.string().trim().regex(/^\d{1,4}$/), unit: z.literal("MONTHS") }).strict(),
  z.object({ ...noteConfirmation, canonicalKey: z.enum(["LAST_WORKING_DAY","START_DATE"]), answer: z.iso.date() }).strict(),
  z.object({ ...noteConfirmation, canonicalKey: z.literal("WORK_MODE_REQUIREMENT"), answer: z.enum(["YES","NO"]) }).strict(),
  z.object({ ...noteConfirmation, canonicalKey: z.literal("HEARING_SOURCE"), answer: z.enum(["LINKEDIN","COMPANY_WEBSITE","EMPLOYEE_REFERRAL","JOB_BOARD","RECRUITER","OTHER"]), otherLabel:z.string().trim().min(1).max(120).optional() }).strict()
]).superRefine((input,context)=>{
  const scope=input.scope??"GLOBAL";
  if(input.confirmedGlobalDefault!==(scope==="GLOBAL"))context.addIssue({code:"custom",message:"Explicit confirmation must match the selected reuse scope."});
  if(["START_DATE","WORK_MODE_REQUIREMENT","HEARING_SOURCE"].includes(input.canonicalKey)&&scope!=="APPLICATION")context.addIssue({code:"custom",message:"This role-specific answer must be reviewed for the original application only."});
  if(scope==="APPLICATION"&&!["START_DATE","WORK_MODE_REQUIREMENT","HEARING_SOURCE","LAST_WORKING_DAY"].includes(input.canonicalKey))context.addIssue({code:"custom",message:"Application note mapping is not supported for this field."});
  if(input.canonicalKey==="HEARING_SOURCE"&&((input.answer==="OTHER")!==Boolean(input.otherLabel)))context.addIssue({code:"custom",message:"Other requires a reviewed source label; predefined sources must not include one."});
});
export type ConfirmLearningNote = z.infer<typeof ConfirmLearningNoteSchema>;
export const LearningInboxPageSchema = z.object({ cursor: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
export const AutofillOutcomeSchema = z.object({
  ...identity, eventId: z.uuid(), questionId: z.uuid().nullable(),
  stage: z.enum(["SCAN", "RESOLVE", "PLAN", "EXECUTE", "VERIFY", "LEARN"]),
  code: z.enum(["API_TIMEOUT", "API_UNAVAILABLE", "NO_SAFE_OPERATION", "POPUP_ASSOCIATION_UNPROVEN", "CONTROL_VALIDATION_FAILED", "REPRESENTATION_INVALID", "STALE_PLAN", "CHECKPOINT_FAILED", "SCAN_INCOMPLETE"]),
  release: z.enum(["ADAPTIVE_CHECKPOINT_4"]), containsCandidateValue: z.literal(false)
}).strict();
export type AutofillOutcome = z.infer<typeof AutofillOutcomeSchema>;

import { ConfirmLearningNoteSchema, type ConfirmLearningNote } from "@job-hunter-v2/contracts";
import { PersistableNormalizedValueSchema } from "@job-hunter-v2/candidate-truth";
import { exactScale, ValidationError } from "@job-hunter-v2/domain";

/** Explicitly selected units only. Never infer salary scale or a date from note wording. */
export function learningNoteValue(raw: ConfirmLearningNote) {
  const input = ConfirmLearningNoteSchema.parse(raw);
  const common = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };
  let value: unknown;
  let display: string;
  if ("currency" in input) {
    if (!Intl.supportedValuesOf("currency").includes(input.currency) || (input.scale !== "BASE" && input.currency !== "INR")) throw new ValidationError("Choose a supported currency; lakh and crore require INR.");
    const amountExact = exactScale(input.answer, input.scale === "LAKH" ? 100_000n : input.scale === "CRORE" ? 10_000_000n : 1n);
    value = { ...common, kind: "MONEY", amountExact, currency: input.currency, period: input.period };
    display = `${input.currency} ${amountExact} per ${input.period === "YEAR" ? "year" : "month"}`;
  } else if (input.canonicalKey === "NOTICE_PERIOD") {
    const days = Number(input.answer);
    if (days > 3650) throw new ValidationError("Notice period must be between 0 and 3650 days.");
    value = { ...common, kind: "INTEGER", value: days }; display = `${days} days of notice (not a joining date)`;
  } else if (input.canonicalKey === "TOTAL_EXPERIENCE") {
    const months = Number(input.answer);
    if (months > 1200) throw new ValidationError("Experience must be between 0 and 1200 months.");
    value = { ...common, kind: "DURATION", months }; display = `${Math.floor(months / 12)} years ${months % 12} months (${months} months total)`;
  } else if (input.canonicalKey === "LAST_WORKING_DAY" || input.canonicalKey === "START_DATE") {
    value = { ...common, kind: "DATE", value: { isoDate: input.answer, precision: "DAY" } }; display = input.answer;
  } else if(input.canonicalKey==="WORK_MODE_REQUIREMENT") {
    value={...common,kind:"BOOLEAN",value:input.answer==="YES"};display=input.answer==="YES"?"Yes — for this application's stated requirement":"No — for this application's stated requirement";
  } else if(input.canonicalKey==="HEARING_SOURCE") {
    const labels:Record<string,string>={LINKEDIN:"LinkedIn",COMPANY_WEBSITE:"Company website",EMPLOYEE_REFERRAL:"Employee referral",JOB_BOARD:"Job board",RECRUITER:"Recruiter"};
    display=input.otherLabel??labels[input.answer]!;
    value={...common,kind:"ENUM",value:{key:input.answer,label:display}};
  } else {
    value = { ...common, kind: input.canonicalKey.endsWith("_URL") ? "URL" : "STRING", value: input.answer }; display = input.answer;
  }
  const parsed = PersistableNormalizedValueSchema.safeParse(value);
  if (!parsed.success) throw new ValidationError("The reviewed answer has an invalid value, date or URL.");
  return { normalizedValue: parsed.data, display };
}

import { z } from "zod";

export const FieldCapabilitySchema = z.enum([
  "NATIVE_TEXT", "NATIVE_TEXTAREA", "NATIVE_NUMBER", "NATIVE_DATE", "NATIVE_MONTH",
  "NATIVE_SELECT", "NATIVE_MULTISELECT", "NATIVE_RADIO", "NATIVE_CHECKBOX",
  "CONTENTEDITABLE", "ARIA_COMBOBOX", "SEARCHABLE_SELECT", "CUSTOM_LISTBOX",
  "CUSTOM_RADIO_GROUP", "TOGGLE", "FILE_INPUT", "UNSUPPORTED"
]);
export type FieldCapability = z.infer<typeof FieldCapabilitySchema>;

/** Same pure capability vocabulary at scan, plan and live execution. No DOM or candidate values. */
export function capabilitiesForControl(input:{tagName:string;type?:string|null;role?:string|null;contentEditable?:boolean;multiple?:boolean;ariaAutocomplete?:boolean}):FieldCapability[]{
  const tag=input.tagName.toLowerCase(),type=(input.type??"text").toLowerCase(),role=(input.role??"").toLowerCase();
  if(tag==="input"){
    if(type==="file")return ["FILE_INPUT"];
    if(type==="radio")return ["NATIVE_RADIO"];
    if(type==="checkbox")return [role==="switch"?"TOGGLE":"NATIVE_CHECKBOX"];
    if(type==="number")return ["NATIVE_NUMBER","NATIVE_TEXT"];
    if(type==="date")return ["NATIVE_DATE","NATIVE_TEXT"];
    if(type==="month")return ["NATIVE_MONTH","NATIVE_TEXT"];
    // Range/time/week and password/submit controls need dedicated, verified implementations.
    if(!["text","email","tel","url","search"].includes(type))return ["UNSUPPORTED"];
    if(role==="combobox"||input.ariaAutocomplete)return ["ARIA_COMBOBOX","SEARCHABLE_SELECT","NATIVE_TEXT"];
    return ["NATIVE_TEXT"];
  }
  if(tag==="textarea")return ["NATIVE_TEXTAREA"];
  if(tag==="select")return [input.multiple?"NATIVE_MULTISELECT":"NATIVE_SELECT"];
  if(input.contentEditable)return ["CONTENTEDITABLE"];
  if(role==="combobox")return ["ARIA_COMBOBOX","SEARCHABLE_SELECT"];
  if(role==="listbox")return ["CUSTOM_LISTBOX"];
  if(role==="radiogroup"||role==="radio")return ["CUSTOM_RADIO_GROUP"];
  if(role==="switch"||role==="checkbox")return ["TOGGLE"];
  return ["UNSUPPORTED"];
}

/** Structural question membership, not inferred canonical truth or a claim of successful fill. */
export const QuestionContractSchema=z.object({
  version:z.literal(1),questionId:z.string().min(8).max(100),pageInstanceId:z.uuid(),formInstanceId:z.string().min(8).max(100),
  treeScopeId:z.string().min(8).max(100),kind:z.enum(["SINGLE_CONTROL","SINGLE_CHOICE"]),
  memberIds:z.array(z.string().min(8).max(100)).min(1).max(100),memberCount:z.number().int().positive().max(10000),
  membershipComplete:z.boolean(),containsCandidateValue:z.literal(false)
}).strict().superRefine((q,c)=>{
  if(new Set(q.memberIds).size!==q.memberIds.length)c.addIssue({code:"custom",message:"Question member IDs must be unique."});
  if(q.memberCount<q.memberIds.length||q.membershipComplete!== (q.memberCount===q.memberIds.length))c.addIssue({code:"custom",message:"Question membership completeness mismatch."});
  if(q.kind==="SINGLE_CONTROL"&&q.memberCount!==1)c.addIssue({code:"custom",message:"Independent control must have one member."});
});
export type QuestionContract=z.infer<typeof QuestionContractSchema>;

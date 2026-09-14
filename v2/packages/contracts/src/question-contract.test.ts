import assert from "node:assert/strict";
import test from "node:test";
import {capabilitiesForControl,QuestionContractSchema} from "./question-contract.js";

test("shared control capabilities distinguish native, ARIA and unsupported controls",()=>{
  const cases:Array<[Parameters<typeof capabilitiesForControl>[0],string[]]>=[
    [{tagName:"input",type:"number"},["NATIVE_NUMBER","NATIVE_TEXT"]],
    [{tagName:"input",type:"date"},["NATIVE_DATE","NATIVE_TEXT"]],
    [{tagName:"input",type:"month"},["NATIVE_MONTH","NATIVE_TEXT"]],
    [{tagName:"input",type:"text",ariaAutocomplete:true},["ARIA_COMBOBOX","SEARCHABLE_SELECT","NATIVE_TEXT"]],
    [{tagName:"input",type:"radio"},["NATIVE_RADIO"]],
    [{tagName:"input",type:"checkbox",role:"switch"},["TOGGLE"]],
    [{tagName:"div",role:"checkbox"},["TOGGLE"]],
    [{tagName:"div",role:"radio"},["CUSTOM_RADIO_GROUP"]],
    [{tagName:"select",multiple:true},["NATIVE_MULTISELECT"]],
    [{tagName:"div",contentEditable:true},["CONTENTEDITABLE"]],
    [{tagName:"div",role:"textbox"},["UNSUPPORTED"]],
    [{tagName:"input",type:"file"},["FILE_INPUT"]]
  ];for(const [input,expected]of cases)assert.deepEqual(capabilitiesForControl(input),expected);
  for(const type of ["password","hidden","range","week","time","datetime-local","submit","reset","button"])assert.deepEqual(capabilitiesForControl({tagName:"input",type}),["UNSUPPORTED"]);
});

test("question membership is bounded, versioned and value-free",()=>{
  const q={version:1,questionId:"field:12345",pageInstanceId:crypto.randomUUID(),formInstanceId:"form:12345",treeScopeId:"tree:12345",kind:"SINGLE_CHOICE",memberIds:["member:123","member:456"],memberCount:2,membershipComplete:true,containsCandidateValue:false};
  assert.equal(QuestionContractSchema.safeParse(q).success,true);
  assert.equal(QuestionContractSchema.safeParse({...q,memberCount:3,membershipComplete:false}).success,true);
  for(const bad of [{...q,version:2},{...q,memberIds:["member:123","member:123"]},{...q,memberCount:1},{...q,kind:"SINGLE_CONTROL"},{...q,answer:"private"},{...q,memberCount:3},{...q,containsCandidateValue:true}])assert.equal(QuestionContractSchema.safeParse(bad).success,false);
});

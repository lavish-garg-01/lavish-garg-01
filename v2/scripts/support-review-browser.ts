import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

// Synthetic API; production components. No actual operators, grants or candidate data.
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {CandidateSupport,OperatorSupport} from './apps/web/src/SupportReview.tsx';
window.approvals=0;window.reads=0;window.denied=false;window.delay=false;
let grant={id:'00000000-0000-4000-8000-000000000001',caseId:'synthetic-case',issuer:'https://identity.example.test',subject:'reviewer-one',purpose:'DEBUG_AUTOFILL',status:'PENDING',expiresAt:null};
const api={previewSupport:async()=>grant,approveSupport:async(_id,itemId,duration)=>{if(itemId!=='synthetic-note'||![15,60].includes(duration))throw Error('bad consent');window.approvals++;grant={...grant,status:'APPROVED',expiresAt:new Date(Date.now()+60000).toISOString()};return grant;},noteSupport:async()=>({grants:grant.status==='PENDING'?[]:[grant]}),revokeSupport:async()=>{grant={...grant,status:'REVOKED'};return {revoked:true};},requestSupport:async()=>grant,operatorSupport:async()=>({grants:[grant]}),readSupport:async()=>{window.reads++;if(window.delay)await new Promise(r=>window.finishRead=r);if(window.denied||grant.status!=='APPROVED')throw Error('denied');return {grantId:grant.id,expiresAt:grant.expiresAt,evidence:{question:'Synthetic private question',answer:'<img src=x onerror=alert(1)>'}};}};
createRoot(document.getElementById('root')).render(<><h1>Support consent fixture</h1><CandidateSupport api={api} itemId="synthetic-note" available={true}/><OperatorSupport api={api} caseId="synthetic-case"/></>);
`},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'}});
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();
  await page.route("https://support.example.test/**",r=>r.fulfill({contentType:"text/html",body:'<main id="root"></main>'}));
  await page.goto("https://support.example.test/");await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.clock.install();
  await page.getByText("Share this note with support (optional)",{exact:true}).click();
  await page.getByLabel("Support request code",{exact:true}).fill("00000000-0000-4000-8000-000000000001");
  await page.getByRole("button",{name:"Review support request",exact:true}).click();
  await page.getByText("Operator: reviewer-one · Identity provider: https://identity.example.test",{exact:true}).waitFor();
  const approve=page.getByRole("button",{name:"Approve access to this note",exact:true});
  assert.equal(await approve.isDisabled(),true);
  await page.getByRole("checkbox").check();await page.getByLabel("Access duration",{exact:true}).selectOption("60");assert.equal(await approve.isDisabled(),true,"duration change invalidates consent");
  await page.getByRole("checkbox").check();await approve.click();await page.getByText(/Support access: APPROVED/).waitFor();
  assert.equal(await page.evaluate(()=>(window as unknown as {approvals:number}).approvals),1);
  await page.getByText("Candidate-approved private review",{exact:true}).click();
  await page.getByRole("button",{name:"Refresh support requests",exact:true}).click();
  assert.equal(await page.evaluate(()=>(window as unknown as {reads:number}).reads),0,"refresh never reads private payloads");
  const read=page.getByRole("button",{name:"View approved note",exact:true});await read.click();
  await page.getByRole("region",{name:"Approved private note"}).waitFor();
  assert.equal(await page.locator("img").count(),0,"private payload renders inert");
  await page.clock.fastForward(30001);
  await page.getByRole("region",{name:"Approved private note"}).waitFor({state:"hidden"});
  await read.click();await page.getByRole("region",{name:"Approved private note"}).waitFor();
  await page.evaluate(()=>window.dispatchEvent(new Event("blur")));
  await page.getByRole("region",{name:"Approved private note"}).waitFor({state:"hidden"});
  await page.evaluate(()=>{(window as unknown as {delay:boolean}).delay=true;});await read.click();
  await page.getByText("Candidate-approved private review",{exact:true}).click();
  await page.evaluate(()=>{const w=window as unknown as {finishRead:()=>void};w.finishRead();});
  await page.getByText("Candidate-approved private review",{exact:true}).click();
  assert.equal(await page.getByRole("region",{name:"Approved private note"}).count(),0,"closing invalidates late read responses");
  await page.evaluate(()=>{(window as unknown as {delay:boolean}).delay=false;});
  await page.getByRole("button",{name:"Revoke support access",exact:true}).click();
  await page.getByText("Access revoked. Previously viewed copies cannot be recalled.",{exact:true}).waitFor();
  await read.click();await page.getByText("Private access denied or expired. Refresh consent status.",{exact:true}).waitFor();
  assert.equal(await page.getByRole("region",{name:"Approved private note"}).count(),0);
  await page.getByRole("button",{name:"Refresh support requests",exact:true}).click();assert.equal(await read.count(),0);
  console.log("PASS support review UI: explicit scoped consent, duration reconfirmation, no prefetch, inert private text, timed/focus-loss clearing, stale-response exclusion, revocation and denied-access clearing.");
}finally{await browser.close();}

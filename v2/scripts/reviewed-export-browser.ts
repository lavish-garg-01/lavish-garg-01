import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

// Production components, synthetic API responses. This is UI evidence, not a database oracle.
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {OperatorReview} from './apps/web/src/OperatorReview.tsx';
let cases=['source','target'].map(id=>({id,revision:1,release:'SYNTHETIC',stage:'PLAN',code:id,affectedRuns:1,status:'OPEN',assigneeSubject:null,assigneeIssuer:null}));
let artifacts=[],state={revision:1,disabled:true,current_id:null};window.writes=[];window.evaluated=false;window.deny=false;window.pwned=false;
const api={operatorCases:async()=>({cases}),operatorMerge:async(source,input)=>{window.writes.push(['merge',source,input]);cases=cases.filter(c=>c.id!==source).map(c=>({...c,revision:2}));},
reviewedArtifacts:async()=>{if(window.deny)throw Error('denied');return {artifacts:artifacts.map(a=>({...a,evaluation:window.evaluated?{id:'evaluation',passed:true,live:true}:null})),state,strategyKeys:['NATIVE_VALUE_SETTER@1']};},
proposeReviewed:async(caseId,key)=>{window.writes.push(['propose',caseId,key]);artifacts.push({id:'artifact',case_id:caseId,strategy_key:key,artifact_hash:'a'.repeat(64),subject:'synthetic-proposer',approvals:[]});},
approveReviewed:async(id,hash,evaluation)=>{window.writes.push(['approve',id,hash,evaluation]);artifacts[0].approvals=[{id:'approval',evaluation_id:'evaluation'}];},
prepareReviewed:async(id,approval,revision)=>{if(revision!==state.revision)throw Error('stale');window.writes.push(['prepare',id,approval,revision]);state={revision:2,disabled:false,current_id:'export'};},
controlReviewed:async(action,revision)=>{window.writes.push(['control',action,revision]);state={...state,revision:3,disabled:true};},
reviewedManifest:async()=>{if(window.deny)throw Error('denied');return {mode:'EXPORT_ONLY_NOT_DEPLOYED',example:'<img src=x onerror="window.pwned=true">'};}};
createRoot(document.getElementById('root')).render(<OperatorReview api={api}/>);
`},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'}});
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1100,height:900}}),errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",route=>route.request().url()==="https://review.example.test/"?route.fulfill({contentType:"text/html",body:'<main id="root"></main>'}):route.abort());
  await page.goto("https://review.example.test/");await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const source=page.locator('article').filter({has:page.getByRole('heading',{name:'PLAN · source',exact:true})});
  await source.getByText('Merge duplicate case',{exact:true}).click();
  const merge=source.getByRole('button',{name:'Merge into selected case'});
  assert.equal(await merge.isDisabled(),true);
  await source.getByLabel('Merge target for source').selectOption('target');assert.equal(await merge.isDisabled(),true);
  await source.getByLabel('I reviewed both cases and confirm they belong together.').check();
  await merge.focus();await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'PLAN · source',exact:true}).waitFor({state:'detached'});
  const writes=()=>page.evaluate(()=>(window as unknown as {writes:unknown[][]}).writes);
  assert.deepEqual((await writes())[0],['merge','source',{...(await writes())[0]![2] as object,targetCaseId:'target',expectedSourceRevision:1,expectedTargetRevision:1,confirmed:true}]);
  await page.getByText('Reviewed strategy exports',{exact:true}).click();
  await page.getByRole('button',{name:'Load reviewed artifacts'}).click();
  assert.equal(await page.getByRole('button',{name:'Propose exact version'}).isDisabled(),true);
  await page.getByLabel('Registered strategy',{exact:true}).selectOption('NATIVE_VALUE_SETTER@1');
  await page.getByRole('button',{name:'Propose exact version'}).click();
  await page.getByText('Independent evaluation required',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Approve evaluated artifact'}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Prepare approved export'}).isDisabled(),true);
  await page.evaluate(()=>{(window as unknown as {evaluated:boolean}).evaluated=true;});
  await page.getByRole('button',{name:'Load reviewed artifacts'}).click();
  const approve=page.getByRole('button',{name:'Approve evaluated artifact'});
  page.once('dialog',dialog=>dialog.dismiss());await approve.click();assert.equal((await writes()).length,2);
  page.once('dialog',dialog=>dialog.accept());await approve.click();
  await page.getByRole('button',{name:'Prepare approved export'}).waitFor();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Prepare approved export'}).click();
  await page.getByText('Export selection revision 2 · Prepared, not deployed',{exact:true}).waitFor();
  await page.getByRole('button',{name:'View verified manifest'}).click();await page.locator('pre').waitFor();
  assert.equal(await page.locator('pre img').count(),0);assert.equal(await page.evaluate(()=>(window as unknown as {pwned:boolean}).pwned),false);
  await page.getByRole('button',{name:'Disable exports',exact:true}).click();
  await page.getByText('Export selection revision 3 · Disabled',{exact:true}).waitFor();
  assert.equal(await page.locator('pre').count(),0);assert.equal(await page.getByRole('button',{name:'View verified manifest'}).isDisabled(),true);
  await page.evaluate(()=>{(window as unknown as {deny:boolean}).deny=true;});
  await page.getByRole('button',{name:'Load reviewed artifacts'}).click();await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('heading',{name:'NATIVE_VALUE_SETTER@1'}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS production review UI / synthetic API: explicit revision-bound merge, proposal, failed/missing evaluation gates, cancelled/confirmed approval, export-only status, inert manifest, disable and access-denial clearing.');
}finally{await browser.close();}

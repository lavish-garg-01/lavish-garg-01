import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {OperatorReview} from './apps/web/src/OperatorReview.tsx';
let status='OPEN',revision=1,assigneeSubject=null; window.denied=false; window.writes=0;
const api={operatorCases:async()=>{if(window.denied)throw new Error('denied');return {cases:[{id:'case',release:'test',stage:'PLAN',code:'NO_SAFE_OPERATION',affectedRuns:2,status,revision,assigneeSubject,assigneeIssuer:assigneeSubject?'https://identity.example.test':null}]};},operatorTransition:async(_id,expected,next)=>{if(expected!==revision)throw new Error('conflict');status=next;revision++;window.writes++;},operatorAssign:async(_id,expected,action)=>{if(expected!==revision)throw new Error('conflict');assigneeSubject=action==='CLAIM'?'reviewer-one':null;revision++;}};
let layer='UNASSIGNED',reproduction='NONE',expectedBehavior='UNSPECIFIED';
api.operatorDetail=async()=>({id:'case',revision,layer,reproduction,expectedBehavior,timeline:[]});
api.operatorEdit=async(_id,input)=>{if(input.expectedRevision!==revision)throw new Error('conflict');layer=input.layer;reproduction=input.reproduction;expectedBehavior=input.expectedBehavior;revision++;};
createRoot(document.getElementById('root')).render(<OperatorReview api={api}/>);
` }, bundle:true, write:false, platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'} });
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  await page.route('https://operator.example.test/**',route=>route.fulfill({contentType:'text/html',body:'<main id="root"></main>'}));
  await page.goto('https://operator.example.test/'); await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.getByRole('heading',{name:'PLAN · NO_SAFE_OPERATION'}).waitFor();
  await page.getByRole('button',{name:'investigating',exact:true}).click();
  await page.getByText('test · 2 affected runs · INVESTIGATING · Revision 2',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=> (window as unknown as {writes:number}).writes),1);
  await page.getByRole('button',{name:'Load review & timeline'}).click();
  await page.getByLabel('Responsible layer',{exact:true}).selectOption('REPRESENTATION');
  await page.getByLabel('Synthetic reproduction',{exact:true}).selectOption('ADAPTIVE_AUTOFILL');
  await page.getByLabel('Expected behavior',{exact:true}).selectOption('FILL_VERIFIED_VALUE');
  await page.getByRole('button',{name:'Save review',exact:true}).click();
  await page.getByText('test · 2 affected runs · INVESTIGATING · Revision 3',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Responsible layer',{exact:true}).inputValue(),'REPRESENTATION');
  await page.getByRole('button',{name:'Claim case',exact:true}).click();
  await page.getByText('test · 2 affected runs · INVESTIGATING · Revision 4',{exact:true}).waitFor();
  await page.getByText(/Assigned to: reviewer-one/).waitFor();
  await page.getByRole('button',{name:'Release my case',exact:true}).click();
  await page.getByText('test · 2 affected runs · INVESTIGATING · Revision 5',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Claim case',exact:true}).waitFor();
  await page.evaluate(()=>{(window as unknown as {denied:boolean}).denied=true;});
  await page.getByRole('button',{name:'Refresh cases'}).click(); await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('heading',{name:'PLAN · NO_SAFE_OPERATION'}).count(),0);
  console.log('PASS synthetic operator UI: triage transition, metadata edit, claim/release, refresh and clearing cases after access denial.');
} finally { await browser.close(); }

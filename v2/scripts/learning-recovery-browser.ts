import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

// Synthetic API, real React component. No credentials, employer or app database.
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {LearningRecovery} from './apps/web/src/LearningRecovery.tsx';
let deleted = false;
window.denied=false; window.confirmed=[];
const api = {
 learningInbox: async (cursor) => {if(window.denied)throw new Error('denied'); return cursor ? {nextCursor:null,items:[{itemId:'salary-item',status:'PENDING',expiresAt:'2026-10-01T00:00:00Z',evidence:{question:'Your current CTC',answer:'14 LPA',source:'EXPLICIT_SAVE'}}]} : {nextCursor:'older',items:[{itemId:'test-item',status:deleted?'DELETED':'PENDING',expiresAt:'2026-10-01T00:00:00Z',evidence:deleted?null:{question:'Unknown question',answer:'<img src=x onerror=alert(1)>',source:'EXPLICIT_SAVE'}}]};},
 learningOutcomes:async()=>({groups:[{stage:'PLAN',code:'NO_SAFE_OPERATION',affected_runs:1}],denominator:'REPORTED_FAILURES_ONLY'}),
 deleteLearningInboxItem:async()=>{deleted=true;}
 ,profile:async()=>({answers:[]}),
 previewLearningNote:async(_id,input)=>({display:input.canonicalKey==='CURRENT_CTC'?'INR 1400000 per year':input.answer,scope:input.scope??'GLOBAL',applicationId:input.scope==='APPLICATION'?'original-application':null,currentValue:null,expectedCurrentVersionId:null}),
 confirmLearningNote:async(_id,input)=>{window.confirmed.push(input);return {changeSetId:'synthetic',idempotentReplay:false};}
};
createRoot(document.getElementById('root')).render(<LearningRecovery api={api}/>);
` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body><main id="root"></main></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  await page.getByText('Unknown question', { exact: true }).waitFor();
  assert.equal(await page.locator('img').count(), 0, 'candidate text must be inert');
  assert.equal(await page.getByText('<img src=x onerror=alert(1)>', { exact: true }).count(), 1);
  assert.equal(await page.getByText('PLAN · NO_SAFE_OPERATION · 1 affected runs', { exact: true }).count(), 1);
  await page.getByText('Review as a profile answer', { exact: true }).click();
  await page.getByLabel('Profile field', { exact: true }).selectOption('FIRST_NAME');
  await page.getByLabel('Reviewed answer', { exact: true }).fill('Synthetic name');
  await page.getByRole('button', { name: 'Review profile change', exact: true }).click();
  await page.getByText('Current default: No saved default', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Confirm global default', exact: true }).click();
  await page.getByText('Saved to profile. You can undo this change in Profile history.', { exact: true }).waitFor();
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  assert.equal(await page.getByText('Unknown question', { exact: true }).count(), 1);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await page.getByText('Private note unavailable', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Delete note', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Load older notes', exact: true }).click();
  await page.getByText('Your current CTC', { exact: true }).waitFor();
  await page.getByText('Review as a profile answer', { exact: true }).click();
  await page.getByLabel('Profile field', { exact: true }).selectOption('CURRENT_CTC');
  await page.getByLabel('Reviewed answer', { exact: true }).fill('14');
  assert.equal(await page.getByRole('button', { name: 'Review profile change', exact: true }).isDisabled(), true);
  await page.getByLabel('Currency', { exact: true }).selectOption('INR');
  await page.getByLabel('Amount scale', { exact: true }).selectOption('LAKH');
  await page.getByLabel('Pay period', { exact: true }).selectOption('YEAR');
  await page.getByRole('button', { name: 'Review profile change', exact: true }).click();
  await page.getByText('New default: INR 1400000 per year', { exact: true }).waitFor();
  await page.getByLabel('Amount scale', { exact: true }).selectOption('BASE');
  assert.equal(await page.getByRole('button', { name: 'Confirm global default', exact: true }).count(), 0, 'unit change invalidates preview');
  await page.getByLabel('Amount scale', { exact: true }).selectOption('LAKH');
  await page.getByRole('button', { name: 'Review profile change', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm global default', exact: true }).click();
  await page.getByText('Saved to profile. You can undo this change in Profile history.', { exact: true }).waitFor();
  const inputs = await page.evaluate(() => (window as unknown as { confirmed: unknown[] }).confirmed);
  assert.deepEqual(inputs[1], { canonicalKey:'CURRENT_CTC',answer:'14',expectedCurrentVersionId:null,confirmedGlobalDefault:true,currency:'INR',scale:'LAKH',period:'YEAR' });
  await page.evaluate(() => { (window as unknown as {denied:boolean}).denied=true; });
  await page.getByRole('button', { name: 'Refresh saved notes', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('14 LPA', { exact:true }).count(),0,'access failure clears private notes');
  console.log('PASS recovery UI: inert text, explicit typed review, unit-change invalidation, pagination, deletion and denied-access clearing (synthetic API).');
} finally { await browser.close(); }

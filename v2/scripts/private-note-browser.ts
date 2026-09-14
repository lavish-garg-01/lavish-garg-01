import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

// Production capture method with synthetic controller dependencies; no real API or accounts.
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
import {ContentRuntimeController} from './apps/extension/src/content/controller.ts';
import {PrivateNoteRetries} from './apps/extension/src/content/private-note.ts';
const controller = Object.create(ContentRuntimeController.prototype);
const id = crypto.randomUUID();
const identity = {applicationId:crypto.randomUUID(),applicationRunId:crypto.randomUUID(),pageInstanceId:id};
Object.assign(controller, {runtimeStatus:{identity}, page:{pageInstanceId:id}, fields:new Map([['field:note',{labelEvidence:['Unmapped question']}]]), registry:{get:()=>document.querySelector('input')}, intelligence:null, privateNoteRetries:new PrivateNoteRetries(), messenger:{request:async(type,payload,options)=>{window.calls.push({type,payload,options}); if(window.failSave)throw new Error('outage'); if(window.replyError)return {type:'ERROR_RESPONSE',payload:{failure:{code:'API_UNAVAILABLE',category:'TECHNICAL',message:'Synthetic rejection',retryable:false,correlationId:null,metadata:{}}}}; return {type:'ACK',payload:{accepted:true,delivery:window.queued?'QUEUED':'DELIVERED'}};}}});
window.calls=[]; window.failSave=false; window.accept=false;
window.confirm=()=>window.accept;
window.save=()=>controller.savePrivateNote('field:note');
` }, bundle: true, write: false, platform: "browser", format: "iife" });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  // Secure synthetic origin enables WebCrypto, with all requests locally intercepted.
  await page.route('https://private-note.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<input value="Synthetic answer">' }));
  await page.goto('https://private-note.example.test/');
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const result = await page.evaluate(async () => {
    const state = window as unknown as { save: () => Promise<string>; calls: Array<{ type: string; payload: { capture: { itemId: string } }; options: { dataClass: string } }>; failSave: boolean; accept: boolean; replyError:boolean;queued:boolean };
    const cancelled = await state.save(); const noCalls = state.calls.length;
    state.accept = true; state.failSave = true;
    let failed = false; try { await state.save(); } catch { failed = true; }
    state.failSave = false;
    const saved = await state.save();
    const sameIdentity = state.calls[0]!.payload.capture.itemId === state.calls[1]!.payload.capture.itemId;
    state.replyError=true;
    let rejected=false; try { await state.save(); } catch { rejected=true; }
    state.replyError=false; state.queued=true;
    const queued = await state.save();
    document.querySelector('input')!.type = 'password';
    const blocked = await state.save();
    return { cancelled, noCalls, failed, saved, sameIdentity, blocked, rejected, queued, calls: state.calls.length, classification: state.calls[1]!.options.dataClass };
  });
  assert.equal(result.cancelled, 'Save cancelled'); assert.equal(result.noCalls, 0);
  assert.equal(result.failed, true); assert.equal(result.saved, 'Saved — review in Attention');
  assert.equal(result.sameIdentity, true); assert.equal(result.calls, 4);
  assert.equal(result.rejected,true); assert.equal(result.queued,'Queued — open panel for delivery status');
  assert.equal(result.blocked, 'This control needs manual review');
  assert.equal(result.classification, 'CANDIDATE_PRIVATE');
  console.log('PASS private capture: cancellation, outage/retry identity, private transport, password exclusion. Synthetic dependencies, production capture method.');
} finally { await browser.close(); }

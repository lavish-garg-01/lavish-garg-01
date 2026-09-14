import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
import {createResponse} from './apps/extension/src/shared/contracts.ts';
window.connected=true; window.discards=0;
window.chrome={runtime:{sendMessage:async request=>{
  if(request.type==='UI_DELIVERY_DISCARD')window.discards++;
  if(request.type==='UI_DELIVERY_STATUS'||request.type==='UI_DELIVERY_DISCARD')return createResponse('DELIVERY_STATUS',request.messageId,{connected:window.connected,queuedNotes:window.discards?0:2,queuedDiagnostics:1,delivered:3,rejected:1,dropped:window.discards});
  return createResponse('ERROR_RESPONSE',request.messageId,{failure:{code:'AUTH_EXPIRED',category:'AUTHORIZATION',message:'Synthetic no application',retryable:false,correlationId:null,metadata:{}}});
}}};
await import('./apps/extension/src/sidepanel/main.ts');
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const html = (await readFile("apps/extension/static/sidepanel.html", "utf8")).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route("https://delivery.example.test/**", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("https://delivery.example.test/");
  await page.addScriptTag({ type: "module", content: bundle.outputFiles[0]!.text });
  await page.getByText(/2 notes queued.*1 diagnostics queued.*3 acknowledged.*1 rejected/).waitFor();
  page.once("dialog", dialog => void dialog.dismiss());
  await page.getByRole("button", { name: "Discard pending delivery" }).click();
  assert.equal(await page.evaluate(() => (window as unknown as {discards:number}).discards), 0);
  page.once("dialog", dialog => void dialog.accept());
  await page.getByRole("button", { name: "Discard pending delivery" }).click();
  await page.getByText(/0 notes queued.*1 expired or dropped/).waitFor();
  await page.evaluate(() => { (window as unknown as {connected:boolean}).connected=false; });
  await page.getByText("Reconnect to view this account’s delivery status.", {exact:true}).waitFor();
  assert.equal(await page.getByText(/3 acknowledged/).count(),0);
  console.log("PASS delivery sidebar: queued/acknowledged/rejected counts, discard cancellation/confirmation and disconnected clearing (synthetic transport).");
} finally { await browser.close(); }

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({ stdin: { contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CareerSetup} from './apps/web/src/CareerSetup.tsx';
import * as ats from './apps/extension/src/content/ats-autofill.ts';
window.ats=ats;window.saved=[];
const api={jobs:async()=>({items:[{id:'40000000-0000-4000-8000-000000000001',title:'Backend Engineer',company:'Example Co'}]}),saveProfile:async(items)=>{window.saved.push(items);return {changeSetId:'fixture-save'}}};
const root=createRoot(document.getElementById('root'));
root.render(<CareerSetup api={api} profile={{answers:[],onboardingCompleted:false}} onSaved={async()=>{}}/>);
window.showStale=()=>root.render(<CareerSetup key="stale" api={api} profile={{answers:[{canonicalKey:'CURRENT_LOCATION',answerVersionId:'old-version',entityId:null,scopeType:'GLOBAL',scope:{},normalizedValue:{kind:'STRING',value:'Pune, Maharashtra'},freshness:{state:'STALE'}}],onboardingCompleted:true}} onSaved={async()=>{}}/>);
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' } });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.route("https://passport.example.test/**", (route) => route.fulfill({ contentType: "text/html", body: '<main style="max-width:1000px;margin:30px auto" id="root"></main>' }));
  await page.goto("https://passport.example.test/");
  await page.addStyleTag({ path: "apps/web/src/styles.css" });
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  await page.getByRole("heading", { name: "A little setup. A lot less typing." }).waitFor();
  await page.getByLabel("Time needed to join (days)").fill("30");
  await page.getByLabel("Current city").fill("Pune, Maharashtra");
  await page.getByRole("button", { name: "Save & continue" }).click();
  await page.getByLabel("Current / last CTC (₹ lakh per year)").fill("14.25");
  assert.equal(await page.getByLabel("Generally open to relocation?").inputValue(), "");
  await page.getByLabel("Generally comfortable with office-based work?").selectOption("yes");
  await mkdir(".local-data/qa", { recursive: true });
  await page.screenshot({ path: ".local-data/qa/passport-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Save & continue" }).click();
  const saved = await page.evaluate(() => (window as unknown as { saved: { canonicalKey: string; normalizedValue: { value?: number; amountExact?: string }; scopeType: string }[][] }).saved);
  assert.equal(saved[0]?.find((item) => item.canonicalKey === "NOTICE_PERIOD")?.normalizedValue.value, 30);
  assert.equal(saved[1]?.find((item) => item.canonicalKey === "CURRENT_CTC")?.normalizedValue.amountExact, "1425000");
  assert.ok(saved.flat().every((item) => item.scopeType === "GLOBAL"));
  assert.ok(!saved.flat().some((item) => item.canonicalKey === "RELOCATION"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local-data/qa/passport-mobile.png", fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.evaluate(() => (window as unknown as { showStale: () => void }).showStale());
  await page.getByText("Saved global answer · stale").waitFor();
  await page.getByRole("button", { name: "Save & continue" }).click();
  await page.getByText("Saved as verified global answers.", { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => (window as unknown as { saved: { expectedCurrentVersionId: string }[][] }).saved.at(-1)?.[0]?.expectedCurrentVersionId), "old-version", "explicit Save can reconfirm an unchanged stale answer");
  const atsResult = await page.evaluate(async () => {
    const api = (window as unknown as { ats: { isResumeAutofillControl: (element: HTMLElement) => boolean; emptyAutofillTargets: (document: Document) => Set<HTMLElement>; waitForResumeParser: (targets: Set<HTMLElement>, check: (element: HTMLElement) => boolean) => Promise<number> } }).ats;
    document.body.innerHTML = '<form><section><h2>Autofill from resume</h2><input id="upload" type="file"></section><label>Name<input id="name"></label><input id="existing" value="Keep me"><input id="user"><section><label>Cover letter<input id="cover" type="file"></label></section></form>';
    const targets = api.emptyAutofillTargets(document);
    setTimeout(() => { (document.getElementById('name') as HTMLInputElement).value='Asha Example'; (document.getElementById('user') as HTMLInputElement).value='Candidate edit'; }, 500);
    const count = await api.waitForResumeParser(targets, (element) => element.id !== 'user');
    return { count, resume: api.isResumeAutofillControl(document.getElementById('upload')!), cover: api.isResumeAutofillControl(document.getElementById('cover')!),
      source: document.getElementById('name')!.dataset.jobHunterFillSource,
      userSource: document.getElementById('user')!.dataset.jobHunterFillSource ?? null,
      existing: (document.getElementById('existing') as HTMLInputElement).value };
  });
  assert.deepEqual(atsResult, { count: 1, resume: true, cover: false, source: "ATS_AUTOFILLED", userSource: null, existing: "Keep me" });
  console.log("PASS: desktop/mobile onboarding, exact LPA, blank booleans, global saves, ATS detection, delayed parser, ownership and preservation");
} finally { await browser.close(); }

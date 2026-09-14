// Desired-outcome regressions against production browser modules. Synthetic pages only;
// no employer requests, AI calls, or production candidate data.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import type { FieldCandidate } from "../apps/extension/src/shared/contracts.js";
import { RepresentationResolver } from "../packages/execution/src/representation.js";
import { capabilityHints } from "../packages/execution/src/service.js";
import { normalizeObservedFieldValue } from "../packages/verified-learning/src/normalization.js";
import type { FieldRepresentation } from "@job-hunter-v2/contracts";

const bundle = await build({ stdin: { contents: `
import {DomScanner,FieldRegistry} from './apps/extension/src/content/scanner.ts';
import {FieldOwnershipTracker} from './apps/extension/src/content/ownership.ts';
import {ExecutionStrategyRegistry} from './apps/extension/src/content/executor.ts';
import {IndependentFieldVerifier} from './apps/extension/src/content/verifier.ts';
import {detectFieldCapabilities} from './apps/extension/src/content/capabilities.ts';
const registry=new FieldRegistry(), ownership=new FieldOwnershipTracker();
const scanner=new DomScanner(registry,ownership), pageId=crypto.randomUUID();
ownership.install(document);
window.scan=()=>scanner.scan(document,pageId,'INITIAL');
window.liveCapabilities=detectFieldCapabilities;
window.fill=async(id,representation)=>{
 const element=registry.get(id), strategies=new ExecutionStrategyRegistry();
 const request={fieldRuntimeId:id,pageInstanceId:pageId,
 representation,
 capabilityHints:detectFieldCapabilities(element)};
 if(!ownership.canAutomate(id)) return 'USER_OWNED';
 const candidates=strategies.candidates(element,request);
 await strategies.execute(candidates[0],element,request);
 window.lastVerification=await new IndependentFieldVerifier(registry,()=>pageId).verify(request);
 return window.lastVerification.status;
};
window.verify=async(id,representation)=>new IndependentFieldVerifier(registry,()=>pageId).verify({fieldRuntimeId:id,pageInstanceId:pageId,representation});
window.execute=(id,label)=>window.fill(id,{kind:'SINGLE_OPTION',option:{key:null,label,aliases:[]}});
`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife", platform: "browser" });
const browser = await chromium.launch({ headless: true });
let failures = 0;
let passed = 0;
try {
  const page = await browser.newPage();
  await page.route("https://fixture.example.test/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Application</h1>" }));
  await page.goto("https://fixture.example.test/apply");
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  let resetBeforeScan = true;
  const scan = async () => {
    // setContent/document.open removes document listeners. Reinstall production
    // modules once per fixture, preserving them for rescans within that fixture.
    if (resetBeforeScan) { await page.addScriptTag({ content: bundle.outputFiles[0]!.text }); resetBeforeScan = false; }
    return await page.evaluate("window.scan()") as { fields: FieldCandidate[]; scanLimits: { controlLimitReached: boolean; fieldLimitReached: boolean; formLimitReached: boolean }; graph: { nodes: Array<{ nodeType: string; state: string; fieldRuntimeId: string }> } };
  };
  const test = async (name: string, run: () => Promise<void>) => {
    resetBeforeScan = true;
    try { await run(); passed++; console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}: ${String(error)}`); }
  };
  const execute = (id: string, label: string) => page.evaluate(([id, label]) =>
    (window as unknown as { execute: (id: string, label: string) => Promise<string> }).execute(id!, label!), [id, label]);
  await test("AC-01: Lever-style four options are one question and one graph field", async () => {
    await page.setContent('<form><li class="application-question"><div class="application-label">Gender</div>'+['Male','Female','Other','Prefer not to disclose'].map((label,i)=>`<label><input type="radio" name="gender" value="${i}" ${i===2?'required':''}>${label}</label>`).join('')+'</li></form>');
    const result = await scan();
    assert.equal(result.fields.length,1); assert.equal(result.fields[0]!.labelEvidence[0],"Gender");
    assert.equal(result.fields[0]!.optionEvidence.count,4); assert.equal(result.fields[0]!.required,true);
    assert.equal(result.fields[0]!.question?.memberCount,4);assert.equal(result.fields[0]!.question?.memberIds.length,4);assert.equal(result.fields[0]!.question?.questionId,result.fields[0]!.fieldRuntimeId);assert.equal(result.fields[0]!.question?.membershipComplete,true);
    assert.equal(result.graph.nodes.filter(n=>n.nodeType==='FIELD').length,1);
  });
  await test("AC-02: separate form owners cannot share completion or execution", async () => {
    await page.setContent('<form id="a"><fieldset><legend>First</legend><label><input name="choice" type="radio" value="yes">Yes</label><input name="choice" type="radio" value="no"></fieldset></form><form id="b"><label><input name="choice" type="radio" value="yes" checked>Yes</label></form>');
    const result = await scan(); assert.equal(result.fields.length,2);
    assert.equal(result.graph.nodes.find(n=>n.fieldRuntimeId===result.fields[0]!.fieldRuntimeId)!.state,'REACHABLE');
    assert.equal(await execute(result.fields[0]!.fieldRuntimeId,'Yes'),'VERIFIED');
    assert.equal(await page.locator('#b input').isChecked(),true);
  });
  await test("External form-associated radios share their actual owner", async () => {
    await page.setContent('<form id="owner"><label><input name="external" type="radio" value="yes">Yes</label></form><label><input form="owner" name="external" type="radio" value="no">No</label>');
    const result=await scan(); assert.equal(result.fields.length,1); assert.equal(result.fields[0]!.optionEvidence.count,2);
    assert.equal(await execute(result.fields[0]!.fieldRuntimeId,'No'),'VERIFIED');
  });
  await test("Nameless radios are not silently merged", async () => {
    await page.setContent('<label><input type="radio" value="one">One</label><label><input type="radio" value="two" checked>Two</label>');
    const result=await scan(); assert.equal(result.fields.length,2);
    assert.equal(result.graph.nodes.find(n=>n.fieldRuntimeId===result.fields[0]!.fieldRuntimeId)!.state,'REACHABLE');
  });
  await test("AC-02: same names in independent shadow roots stay isolated", async () => {
    await page.setContent('<div id="one"></div><div id="two"></div>');
    await page.evaluate(()=>{for(const id of ['one','two'])document.getElementById(id)!.attachShadow({mode:'open'}).innerHTML='<fieldset><legend>Choice</legend><label><input type="radio" name="same" value="yes">Yes</label><label><input type="radio" name="same" value="no">No</label></fieldset>';});
    const result=await scan(); assert.equal(result.fields.length,2); assert.notEqual(result.fields[0]!.fieldRuntimeId,result.fields[1]!.fieldRuntimeId);
    assert.notEqual(result.fields[0]!.question?.treeScopeId,result.fields[1]!.question?.treeScopeId);
    assert.equal(await execute(result.fields[1]!.fieldRuntimeId,'No'),'VERIFIED');
    assert.equal(await page.locator('#one input:checked').count(),0); assert.equal(await page.locator('#two input:checked').count(),1);
  });
  await test("AC-03: hidden shadow host cannot expose fillable fields", async () => {
    await page.setContent('<div id="hidden" style="display:none"></div>');
    await page.evaluate(()=>document.getElementById('hidden')!.attachShadow({mode:'open'}).innerHTML='<label>Email<input type="email"></label>');
    assert.equal((await scan()).fields.length,0);
  });
  await test("Question contract bounds oversized radio membership without inflating question counts",async()=>{
    await page.setContent('<form><fieldset><legend>Choose one</legend>'+Array.from({length:105},(_,i)=>`<label><input type="radio" name="large" value="${i}">Option ${i}</label>`).join('')+'</fieldset></form>');
    const result=await scan();assert.equal(result.fields.length,1);assert.equal(result.fields[0]!.question?.memberCount,105);assert.equal(result.fields[0]!.question?.memberIds.length,100);assert.equal(result.fields[0]!.question?.membershipComplete,false);
  });
  await test("Shared capabilities: browser and planner agree for mixed native and ARIA controls",async()=>{
    await page.setContent('<form><input type="month"><input type="week"><input type="range"><input aria-autocomplete="list"><div role="checkbox" tabindex="0">Agree</div><div role="textbox" contenteditable="true">Text</div><textarea></textarea><select multiple><option>One</option></select></form>');
    const result=await scan();
    const live=await page.evaluate(()=>Array.from(document.querySelectorAll<HTMLElement>('input,textarea,select,[role=checkbox],[contenteditable]')).map(element=>(window as unknown as {liveCapabilities:(e:HTMLElement)=>string[]}).liveCapabilities(element)));
    assert.equal(live.length,result.fields.length);for(let i=0;i<live.length;i++)assert.deepEqual(capabilityHints(result.fields[i]!),live[i]);
    assert.deepEqual(capabilityHints(result.fields[1]!),['UNSUPPORTED']);assert.deepEqual(capabilityHints(result.fields[2]!),['UNSUPPORTED']);
  });
  await test("ARIA radios use the group label and selected-member completion", async () => {
    await page.setContent('<div role="radiogroup" aria-label="Work mode" aria-required="true"><div role="radio" aria-label="Office" aria-checked="false">Office</div><div role="radio" aria-checked="true">Remote</div></div>');
    const result=await scan(); assert.equal(result.fields.length,1); assert.equal(result.fields[0]!.labelEvidence[0],'Work mode');
    assert.equal(result.fields[0]!.required,true); assert.equal(result.fields[0]!.optionEvidence.count,2);
    assert.equal(result.graph.nodes.find(n=>n.nodeType==='FIELD')!.state,'COMPLETED');
  });
  await test("Nested ARIA groups remain independent", async () => {
    await page.setContent('<div role="radiogroup" aria-label="Outer"><div role="radio">One</div><div role="radiogroup" aria-label="Inner"><div role="radio" aria-checked="true">Two</div></div></div>');
    const result=await scan(); assert.equal(result.fields.length,2); assert.equal(result.fields[0]!.optionEvidence.count,1);
    assert.equal(result.graph.nodes.find(n=>n.fieldRuntimeId===result.fields[0]!.fieldRuntimeId)!.state,'REACHABLE');
  });
  await test("Any member's trusted edit protects the whole question across rescans", async () => {
    await page.setContent('<fieldset><legend>Consent-free preference</legend><label><input name="preference" type="radio" value="yes">Yes</label><label><input name="preference" type="radio" value="no">No</label></fieldset>');
    const first=await scan(); await page.locator('input[value=no]').click(); const second=await scan();
    assert.equal(second.fields.length,1); assert.equal(second.fields[0]!.fieldRuntimeId,first.fields[0]!.fieldRuntimeId);
    assert.equal(second.fields[0]!.ownership,'USER_OWNED');
    assert.equal(await execute(first.fields[0]!.fieldRuntimeId,'Yes'),'USER_OWNED');
    assert.equal(await page.locator('input[value=no]').isChecked(),true);
  });
  await test("Independent acknowledgement checkboxes are not grouped", async () => {
    await page.setContent('<fieldset><label><input type="checkbox">Privacy policy</label><label><input type="checkbox">Terms</label></fieldset>');
    assert.equal((await scan()).fields.length,2);
  });
  await test("Trusted click on an ARIA option's child protects its question", async () => {
    await page.setContent('<div role="radiogroup" aria-label="Schedule"><div role="radio">Morning</div><div role="radio"><span id="night">Night</span></div></div>');
    await scan(); await page.locator('#night').click();
    const result=await scan(); assert.equal(result.fields.length,1); assert.equal(result.fields[0]!.ownership,'USER_OWNED');
  });
  const common = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };
  const resolver = new RepresentationResolver();
  const fill = (id: string, representation: FieldRepresentation) => page.evaluate(({id, representation}) =>
    (window as unknown as { fill: (id: string, representation: FieldRepresentation) => Promise<string> }).fill(id, representation), {id, representation});
  for (const [label, expected] of [["Current CTC", "1200000"], ["Current CTC (LPA)", "12"], ["Monthly salary INR", "100000"]]) {
    await test(`money browser fill and learning round trip: ${label}`, async () => {
      await page.setContent(`<label>${label}<input></label>`);
      const target = (await scan()).fields[0]!;
      const rep = resolver.resolve({ ...common, kind: "MONEY", amountExact: "1200000", currency: "INR", period: "YEAR" }, target);
      assert.equal(await fill(target.fieldRuntimeId, rep), "VERIFIED");
      const actual = await page.locator('input').inputValue(); assert.equal(actual, expected);
      const learned = normalizeObservedFieldValue({ canonicalKey: "CURRENT_CTC", value: { kind: "TEXT", value: actual }, labelEvidence: target.labelEvidence, countryCode: "IN" });
      assert.equal(learned.kind === "MONEY" && learned.amountExact, label!.startsWith("Monthly") ? "100000" : "1200000");
    });
  }
  await test("enum/boolean answers fill actual textarea/text controls", async () => {
    await page.setContent('<label>How did you hear about us?<textarea></textarea></label><label>Work from office?<input></label>');
    const targets = (await scan()).fields;
    assert.equal(await fill(targets[0]!.fieldRuntimeId, resolver.resolve({ ...common, kind: "ENUM", value: { key: "LINKEDIN", label: "LinkedIn" } }, targets[0]!)), "VERIFIED");
    assert.equal(await fill(targets[1]!.fieldRuntimeId, resolver.resolve({ ...common, kind: "BOOLEAN", value: true }, targets[1]!)), "VERIFIED");
    assert.equal(await page.locator('textarea').inputValue(), "LinkedIn"); assert.equal(await page.locator('input').inputValue(), "Yes");
  });
  await test("notice text fills with units while unknown date stays empty", async () => {
    await page.setContent('<label>If offered, when can you join?<input id="notice"></label><label>Joining date<input type="date" id="date"></label>');
    const targets = (await scan()).fields;
    const value = { ...common, kind: "INTEGER" as const, value: 45 };
    assert.equal(await fill(targets[0]!.fieldRuntimeId, resolver.resolve(value, targets[0]!, { canonicalKey: "NOTICE_PERIOD" })), "VERIFIED");
    assert.equal(await page.locator('#notice').inputValue(), "45 days' notice");
    assert.throws(() => resolver.resolve(value, targets[1]!, { canonicalKey: "NOTICE_PERIOD" }));
    assert.equal(await page.locator('#date').inputValue(), "");
  });
  await test("experience bucket executes only the intended group option", async () => {
    await page.setContent('<fieldset><legend>Years of experience</legend><label><input type="radio" name="experience" value="0-4">0 to 4 yrs</label><label><input type="radio" name="experience" value="4-6">4 to 6 yrs</label><label><input type="radio" name="experience" value="6+">6+ yrs</label></fieldset>');
    const target = (await scan()).fields[0]!;
    assert.equal(await fill(target.fieldRuntimeId, resolver.resolve({ ...common, kind: "DURATION", months: 56 }, target)), "VERIFIED");
    assert.equal(await page.locator('input:checked').inputValue(), "4-6");
  });
  const country = resolver.resolve({ ...common, kind: "ENUM", value: { key: "IN", label: "India" } }, { ...(await scan()).fields[0]!, controlType: "COMBOBOX" });
  await test("unassociated combobox never clicks another field's option", async () => {
    await page.setContent('<input role="combobox"><div role="listbox"><div role="option" id="unrelated">India</div></div>');
    await page.evaluate(() => { document.querySelector('#unrelated')!.addEventListener('click', () => document.body.dataset.clicked = 'true'); });
    const target = (await scan()).fields[0]!;
    await assert.rejects(() => fill(target.fieldRuntimeId, country), /POPUP_ASSOCIATION_UNPROVEN/);
    assert.equal(await page.evaluate(() => document.body.dataset.clicked), undefined);
  });
  await test("same-root explicitly associated popup selects only its own option", async () => {
    await page.setContent('<input role="combobox" aria-controls="mine"><div role="listbox" id="other"><div role="option">India</div></div><div role="listbox" id="mine"><div role="option">India</div></div>');
    await page.evaluate(() => {
      for (const id of ['other','mine']) document.querySelector(`#${id} [role=option]`)!.addEventListener('click', () => document.body.dataset.clicked = id);
    });
    const target = (await scan()).fields[0]!;
    assert.equal(await fill(target.fieldRuntimeId, country), 'VERIFIED');
    assert.equal(await page.evaluate(() => document.body.dataset.clicked), 'mine');
  });
  await test("shadow popup ID resolves within the control's root", async () => {
    await page.setContent('<div id="host"></div><div id="options" role="listbox"><div role="option">India</div></div>');
    await page.evaluate(() => {
      const root = document.querySelector('#host')!.attachShadow({mode:'open'});
      root.innerHTML='<input role="combobox" aria-controls="options"><div id="options" role="listbox"><div role="option">India</div></div>';
      root.querySelector('[role=option]')!.addEventListener('click', () => document.body.dataset.clicked='shadow');
      document.querySelector('[role=option]')!.addEventListener('click', () => document.body.dataset.clicked='wrong');
    });
    assert.equal(await fill((await scan()).fields[0]!.fieldRuntimeId, country), 'VERIFIED');
    assert.equal(await page.evaluate(() => document.body.dataset.clicked), 'shadow');
  });
  await test("missing popup IDs and disabled options fail without unrelated clicks", async () => {
    await page.setContent('<input role="combobox" aria-controls="missing"><div role="listbox"><div role="option">India</div></div>');
    const target = (await scan()).fields[0]!;
    await assert.rejects(() => fill(target.fieldRuntimeId, country), /POPUP_ASSOCIATION_UNPROVEN/);
    await page.locator('input').evaluate(element => element.setAttribute('aria-controls','options'));
    await page.locator('[role=listbox]').evaluate(element => { element.id='options'; element.querySelector('[role=option]')!.setAttribute('aria-disabled','true'); });
    await assert.rejects(() => fill(target.fieldRuntimeId, country), /OPTION_NOT_FOUND/);
  });
  await test("rich-text descriptor matches planner and real executor capabilities", async () => {
    await page.setContent('<div contenteditable="true" aria-label="Summary"></div>');
    const target = (await scan()).fields[0]!;
    assert.equal(target.locatorEvidence.contentEditable, true);
    assert.deepEqual(capabilityHints(target), ['CONTENTEDITABLE']);
    assert.equal(await fill(target.fieldRuntimeId, resolver.resolve({ ...common, kind: 'RICH_TEXT', value: 'Backend engineer' }, target)), 'VERIFIED');
    assert.equal(await page.locator('[contenteditable]').textContent(), 'Backend engineer');
  });
  await test("delayed associated validation rejects DOM-matching text", async () => {
    await page.setContent('<input aria-describedby="error"><span id="error" role="alert" hidden>Not accepted</span>');
    await page.evaluate(() => document.querySelector('input')!.addEventListener('input',()=>setTimeout(()=>{document.querySelector('#error')!.removeAttribute('hidden');},60)));
    const target=(await scan()).fields[0]!;
    assert.equal(await fill(target.fieldRuntimeId,resolver.resolve({...common,kind:'STRING',value:'Candidate'},target)),'FAILED');
    assert.equal(await page.evaluate('window.lastVerification.failureClass'),'CONTROL_VALIDATION_FAILED');
  });
  await test("DOM readback does not claim an inaccessible framework model is committed", async () => {
    await page.setContent('<input>');
    await page.evaluate(() => { document.body.dataset.model=''; document.querySelector('input')!.addEventListener('input',event=>{if(event.isTrusted)document.body.dataset.model='accepted';}); });
    const target=(await scan()).fields[0]!;
    assert.equal(await fill(target.fieldRuntimeId,resolver.resolve({...common,kind:'STRING',value:'Candidate'},target)),'VERIFIED');
    assert.equal(await page.evaluate('window.lastVerification.evidenceLevel'),'DOM_READBACK');
    assert.equal(await page.evaluate(()=>document.body.dataset.model),'');
  });
  await test("oversized scan explicitly reports unscanned fields", async () => {
    await page.setContent(Array.from({length:805},(_,i)=>`<input aria-label="Question ${i}">`).join(''));
    const result=await scan(); assert.equal(result.fields.length,500);
    assert.equal(result.scanLimits.controlLimitReached,true); assert.equal(result.scanLimits.fieldLimitReached,true);
  });
  await test("excess forms report truncation instead of a schema crash", async () => {
    await page.setContent(Array.from({length:101},(_,i)=>`<form id="f${i}"><input></form>`).join(''));
    const result=await scan(); assert.equal(result.fields.length,100); assert.equal(result.scanLimits.formLimitReached,true);
  });
  for (const attribute of ['readonly', 'aria-readonly="true"', 'disabled']) await test(`late ${attribute} blocks a previously planned text write`, async () => {
    await page.setContent('<input>'); const target=(await scan()).fields[0]!;
    await page.locator('input').evaluate((element, attribute) => { const [name]=attribute.split('='); element.setAttribute(name!, 'true'); },attribute);
    await assert.rejects(()=>fill(target.fieldRuntimeId,resolver.resolve({...common,kind:'STRING',value:'Do not write'},target)),/INTERACTION_REJECTED/);
    assert.equal(await page.locator('input').inputValue(),'');
  });
} finally { await browser.close(); }
console.log(JSON.stringify({ checkpoint: "AF-01/02/03 grouping, representation and execution safety", passed, failures, evidence: "Synthetic Chromium, production representation/normalization and browser modules; not API or employer E2E" }));
process.exitCode = failures ? 1 : 0;

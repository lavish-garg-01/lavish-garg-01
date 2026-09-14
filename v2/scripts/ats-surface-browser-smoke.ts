import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({ stdin: { contents: `
import {pageIdentity} from './apps/extension/src/shared/identity.ts';
import {DomScanner,FieldRegistry,GraphElementRegistry} from './apps/extension/src/content/scanner.ts';
import {FieldOwnershipTracker} from './apps/extension/src/content/ownership.ts';
import {PageObserver} from './apps/extension/src/content/observer.ts';
import {ApplicationProgressCard} from './apps/extension/src/content/autofill-progress.ts';
import {emptyAutofillTargets} from './apps/extension/src/content/ats-autofill.ts';
import {associatedPopups} from './apps/extension/src/content/associated-popup.ts';
window.associatedPopups=associatedPopups;
window.emptyTargets=()=>emptyAutofillTargets(document).size;
window.panelOpens=0;window.showProgress=()=>new ApplicationProgressCard(()=>{},()=>{},()=>window.panelOpens++).render({pageInstanceId:crypto.randomUUID(),phase:'REVIEW',fields:[],containsCandidateValue:false});
window.inspectSurface=(url,manual=false)=>{const page=pageIdentity(new URL(url),document,manual);return {page,scan:new DomScanner(new FieldRegistry(),new FieldOwnershipTracker(),new GraphElementRegistry()).scan(document,page.pageInstanceId,'INITIAL',null)}};
window.changes=0; window.observer=new PageObserver(()=>window.changes++);window.observer.start(document,history,window);
`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife", platform: "browser" });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route("https://ats.example.test/**", (route) => route.fulfill({ contentType: "text/html", body: '<h1>Backend engineer</h1><h3>Easy Apply</h3><div id="component"></div>' }));
  await page.goto("https://ats.example.test/"); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  await page.evaluate(() => { const root = document.querySelector("#component")!.attachShadow({ mode: "open" }); root.innerHTML = '<label for="first">First name</label><input id="first"><span id="email-label">Email</span><input type="email" aria-labelledby="email-label"><label for="last">Last name</label><input id="last">'; });
  await page.waitForFunction("window.changes > 0");
  const result = await page.evaluate("window.inspectSurface('https://jobs.smartrecruiters.com/oneclick-ui/company/AnyEmployer/publication/a8554853-afb1-4bf7-a0ff-2a105bc92ce8')") as { page: { applicationKey: string }; scan: { fields: Array<{ labelEvidence: string[] }> } };
  assert.ok(result.page.applicationKey);
  assert.equal(result.scan.fields.length, 3);
  assert.ok(result.scan.fields.some((field) => field.labelEvidence.includes("First name")));
  assert.ok(result.scan.fields.some((field) => field.labelEvidence.includes("Email")));
  const screening = await page.evaluate("window.inspectSurface('https://jobs.smartrecruiters.com/oneclick-ui/company/AnyEmployer/publication/a8554853-afb1-4bf7-a0ff-2a105bc92ce8/screening').page") as {applicationKey:string;journey:{canFill:boolean}};
  assert.equal(screening.applicationKey, result.page.applicationKey, 'screening preserves publication identity');
  assert.equal(screening.journey.canFill, true, 'screening automatically activates without manual confirmation');
  // Match the live SmartRecruiters structure: identical native input IDs in
  // separate shadow roots, with purpose available only on the component host.
  await page.evaluate(() => {
    for (const marker of ['apply-with-resume-container', 'resume-upload']) {
      const host = document.createElement('spl-dropzone'); host.setAttribute('data-test', marker);
      host.attachShadow({mode:'open'}).innerHTML = '<label for="file-input">Choose a file</label><input id="file-input" type="file">';
      document.body.append(host);
    }
  });
  const uploads = await page.evaluate("window.inspectSurface('https://jobs.smartrecruiters.com/oneclick-ui/company/AnyEmployer/publication/id').scan.fields.filter(f=>f.controlType==='FILE').map(f=>f.labelEvidence)") as string[][];
  assert.deepEqual(uploads, [['Autofill from resume'], ['Resume']]);
  assert.equal(await page.evaluate('window.emptyTargets()'), 3, 'ATS parser tracking includes shadow inputs');
  await page.evaluate(() => document.querySelectorAll('spl-dropzone').forEach(e => e.remove()));
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div id="repeat-actions"><div aria-label="Add experience entry"><button type="button">Add</button></div><div aria-label="Add education entry"><button type="button">Add</button></div><div aria-label="Add experience entry"><button type="submit">Add</button></div><div><button type="button">Add</button></div></div>'));
  const repeatActions = await page.evaluate("window.inspectSurface('https://jobs.smartrecruiters.com/oneclick-ui/company/AnyEmployer/publication/id').scan.graph.nodes.filter(n=>n.nodeType==='ACTION').map(n=>({kind:n.actionKind,role:n.semanticRole}))") as Array<{kind:string;role:string|null}>;
  assert.equal(repeatActions.filter(a=>a.kind==='ADD_REPEAT').length, 2, 'nearby explicit labels identify repeat actions without activating unlabelled Add');
  assert.ok(repeatActions.filter(a=>a.kind==='ADD_REPEAT').every(a=>a.role !== null));
  assert.equal(repeatActions.filter(a=>a.kind==='SUBMIT').length, 1, 'submit semantics take precedence over ancestor labels');
  await page.evaluate(() => document.querySelector('#repeat-actions')!.remove());
  await page.evaluate(() => {
    const section = document.createElement('section'); section.id = 'personal-section';
    section.innerHTML = '<h3>Personal information</h3><city-picker></city-picker>';
    section.querySelector('city-picker')!.attachShadow({mode:'open'}).innerHTML = '<label for="city">City</label><input id="city" role="combobox" aria-expanded="false">';
    document.body.append(section);
  });
  const citySection = await page.evaluate("window.inspectSurface('https://jobs.smartrecruiters.com/oneclick-ui/company/AnyEmployer/publication/id').scan.fields.find(f=>f.labelEvidence.includes('City')).contextEvidence.section");
  assert.equal(citySection, 'Personal information', 'shadow fields retain their enclosing section context');
  await page.evaluate(() => document.querySelector('#personal-section')!.remove());
  await page.evaluate(() => {
    const outer = document.createElement('test-autocomplete'); outer.id = 'slotted-test';
    outer.innerHTML = '<span slot="label-content">3. Notice Period:</span>';
    const outerRoot = outer.attachShadow({mode:'open'});
    outerRoot.innerHTML = '<test-input><slot name="label-content" slot="label-content"></slot></test-input><div id="notice-options" role="listbox"><div role="option">30 to 60 days</div></div>';
    outerRoot.querySelector('test-input')!.attachShadow({mode:'open'}).innerHTML = '<label for="notice"><slot name="label-content"></slot><span aria-hidden="true">*</span></label><input id="notice" role="combobox" aria-controls="notice-options">';
    document.body.append(outer);
  });
  const slottedLabels = await page.evaluate("window.inspectSurface('https://jobs.smartrecruiters.com/oneclick-ui/company/AnyEmployer/publication/id/screening').scan.fields.map(f=>f.labelEvidence)") as string[][];
  assert.ok(slottedLabels.some(labels=>labels.includes('3. Notice Period:')), 'nested assigned slots preserve the actual screening question');
  assert.equal(await page.evaluate("window.associatedPopups(document.querySelector('#slotted-test').shadowRoot.querySelector('test-input').shadowRoot.querySelector('input')).length"), 1, 'explicit popup ID resolves in enclosing shadow scope');
  await page.evaluate(() => document.querySelector('#slotted-test')!.remove());
  await page.evaluate(() => { document.querySelector("#component")!.shadowRoot!.innerHTML = ''; document.body.insertAdjacentHTML('beforeend', '<form><li class="application-question"><div class="application-label">Total years of experience</div><label><input type="radio" name="experience" value="low">0 to 4 yrs</label><label><input type="radio" name="experience" value="high">4 to 6 yrs</label></li></form>'); });
  const radio = await page.evaluate("window.inspectSurface('https://jobs.lever.co/any-employer/job-id/apply').scan.fields") as Array<{ labelEvidence: string[]; options: unknown }>;
  assert.equal(radio.length, 1);
  assert.ok(radio.every((field) => field.labelEvidence[0] === "Total years of experience"));
  await page.evaluate("window.showProgress()");
  const card = await page.locator('[data-job-hunter-ui]').boundingBox(); assert.ok(card);
  await page.mouse.click(card.x + card.width - 29, card.y + 27);
  assert.equal(await page.evaluate("window.panelOpens"), 1);
  assert.equal(await page.locator('[data-job-hunter-ui]').evaluate((host) => host.shadowRoot), null);
  const cases: Array<[string, string, string, boolean, boolean?]> = [
    ['https://custom.test/careers', '<h1>Open roles</h1><a>Apply</a><a>Apply</a>', 'JOB_LIST', false],
    ['https://custom.test/role/123', '<h1>Backend Engineer</h1><button>Apply</button>', 'JOB_DETAIL', false],
    ['https://custom.test/role/123', '<h1>Backend Engineer</h1><button>Apply with LinkedIn</button>', 'APPLICATION_ENTRY', false],
    ['https://custom.test/role/123', '<h1>Backend Engineer application</h1><label>Email<input name="email"></label>', 'APPLICATION_FORM', true],
    ['https://custom.test/careers/custom', '<h1>Join our team</h1><label>Email<input name="email"></label>', 'UNCERTAIN', false],
    ['https://custom.test/careers/custom', '<h1>Join our team</h1><label>Email<input name="email"></label>', 'APPLICATION_FORM', true, true],
    ['https://custom.test/careers/contact', '<h1>Contact us</h1><label>Email<input name="email"></label>', 'UNRELATED', false, true],
    ['https://custom.test/careers/login', '<h1>Sign in</h1><input type="password">', 'AUTH_REQUIRED', false, true],
    ['https://linkedin.com/jobs/view/123', '<h1>Backend Engineer</h1><dialog open><label>Email<input name="email"></label><button>Submit application</button></dialog>', 'APPLICATION_ENTRY', false, true],
    ['https://custom.test/careers/review', '<h1>Review your application</h1><button>Submit application</button>', 'APPLICATION_REVIEW', false],
    ['https://custom.test/careers/success', '<h1>Application submitted</h1>', 'APPLICATION_SUCCESS', false]
  ];
  for (const [url, html, stage, canFill, manual = false] of cases) {
    await page.setContent(html);
    const journey = await page.evaluate(([url, manual]) => (window as unknown as { inspectSurface: (url: string, manual: boolean) => { page: { journey: { stage: string; canFill: boolean } } } }).inspectSurface(url as string, manual as boolean).page.journey, [url, manual]);
    assert.equal(journey.stage, stage, url); assert.equal(journey.canFill, canFill, url);
    assert.equal(await page.locator('input').evaluateAll((inputs) => inputs.some((input) => (input as HTMLInputElement).value !== '')), false);
  }
  console.log("PASS: form-less SmartRecruiters routes, late open-shadow controls, shadow labels, aria-labelledby, shared question/radio evidence, mini-panel icon click with closed-root isolation");
  console.log("PASS: 11 application journey surfaces, safe manual inspection, native modal no-write, login/contact exclusions, review and unverified success");
} finally { await browser.close(); }

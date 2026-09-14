// Read-only audit probes: deliberately document current counterexamples, not product fixes.
// Run from v2: bash scripts/with-node.sh node --import tsx audits/2026-09-12/autofill-boundaries.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { RepresentationResolver } from '../../packages/execution/src/representation.ts';
import { normalizeObservedFieldValue } from '../../packages/verified-learning/src/normalization.ts';
import { FieldSemanticResolver } from '../../packages/field-intelligence/src/semantic-resolver.ts';
import { validateResult } from '../../packages/ai/src/registry.ts';
import { validateGroundedDraft } from '../../packages/onboarding/src/generation.ts';

const common = { schemaVersion: 1, dataClass: 'CANDIDATE_PRIVATE' };
const field = (label, controlType = 'TEXT', tagName = 'input') => ({
  evidenceVersion: 1, fieldRuntimeId: 'field:12345678', pageInstanceId: crypto.randomUUID(),
  formInstanceId: 'form:12345678', sectionFingerprint: 'section:12345678',
  controlFingerprint: 'control:12345678', controlType, labelEvidence: [label],
  contextEvidence: { section: null, previousLabel: null, nextLabel: null, semanticGroup: null, pageHeading: null, formHeading: null, nearbyDescription: null },
  locatorEvidence: { tagName, type: 'text', name: null, id: null, autocomplete: null, ariaLabel: null, placeholder: null, role: null, accessibleDescription: null, occurrence: 0 },
  optionEvidence: { count: 0, samples: [] },
  repeatableEvidence: { entityType: null, bindingKind: 'NONE', instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel: null },
  required: false, disabled: false, ownership: 'UNKNOWN'
});
const resolver = new RepresentationResolver();
const results = [];
const salaryField = field('What is your current CTC/ last drawn CTC?');
const salary = resolver.resolve({ ...common, kind: 'MONEY', amountExact: '1400000', currency: 'INR', period: 'YEAR' }, salaryField);
const learnedSalary = normalizeObservedFieldValue({ canonicalKey: 'CURRENT_CTC', value: { kind: 'TEXT', value: salary.text }, labelEvidence: salaryField.labelEvidence, countryCode: 'IN' });
assert.equal(salary.text, '14'); assert.equal(learnedSalary.amountExact, '14');
results.push({ id: 'D01', finding: 'CTC renderer/parser disagree by 100000x', representation: salary, normalizedBack: learnedSalary });
const experience = resolver.resolve({ ...common, kind: 'DURATION', months: 44 }, field('What is your total work experience in a similar role/ capacity?'));
assert.equal(experience.text, '44');
results.push({ id: 'D02', finding: 'Unitless experience outputs bare months', representation: experience });
const monthly = resolver.resolve({ ...common, kind: 'MONEY', amountExact: '1200000', currency: 'INR', period: 'YEAR' }, field('Expected monthly salary (INR)'));
assert.equal(monthly.text, '1200000');
results.push({ id: 'D03', finding: 'Annual money not converted for explicitly monthly field', representation: monthly });
let calls = 0;
const semantic = new FieldSemanticResolver({ canonicalize: async () => { calls++; throw new Error('Unexpected AI call'); } });
const pageContext = { applicationId: null, jobId: null, companyId: null, countryCode: 'IN', roleFamily: null, ats: 'ASHBY', host: 'jobs.ashbyhq.com' };
const joining = await semantic.resolve(field('If you are offered, by when can you join?'), pageContext);
assert.equal(joining.resolution.canonicalKey, 'NOTICE_PERIOD'); assert.equal(joining.resolution.state, 'RESOLVED_HIGH'); assert.equal(calls, 0);
results.push({ id: 'D04', finding: 'Joining wording confidently mapped to integer notice period; AI not called', semantic: joining.resolution });
const unknown = await semantic.resolve(field('Please describe the hardest production incident you personally resolved'), pageContext);
results.push({ id: 'D05', finding: 'Incident narrative retrieves PERSONAL_SUMMARY, not a dedicated contextual answer concept; fake AI adapter invoked then rejected', state: unknown.resolution.state, candidates: unknown.resolution.candidates.map(c => c.canonicalKey), aiCalls: calls });
const phone = normalizeObservedFieldValue({ canonicalKey: 'PHONE', value: { kind: 'TEXT', value: '+919876543210' }, labelEvidence: ['Phone'], countryCode: 'IN' });
results.push({ id: 'D06', finding: 'Greedy telephone parser splits valid country prefix incorrectly', normalized: phone });
assert.notEqual(phone.countryCode, '+91');
const lexical = validateResult({taskType:'CANONICALIZE_FIELD',payload:{field:{label:'Organization with which you are presently engaged'},context:{},candidateCanonicals:[{canonicalKey:'CURRENT_COMPANY',description:'Candidate current or most recent employer'}]}},
  {selectedCanonical:'CURRENT_COMPANY',confidence:0.99,ambiguous:false,ranking:[{canonicalKey:'CURRENT_COMPANY',confidence:0.99}],reasonCategory:'LABEL_CONTEXT'});
assert.equal(lexical.confidence,0);
results.push({id:'D14',finding:'Semantically correct supplied AI synonym mapping gets zero confidence from lexical overlap validator',result:lexical});
const nameId='truth:'+crypto.randomUUID(), claimId='truth:'+crypto.randomUUID();
const negation = validateGroundedDraft({title:'Example Candidate',titleSourceClaimIds:[nameId],blocks:[{kind:'BULLET',text:'I lead Kubernetes teams.',sourceClaimIds:[claimId]}]},
 {sourceDocumentId:crypto.randomUUID(),jobId:crypto.randomUUID(),applicationId:null,candidateClaims:[{sourceId:nameId,sourceType:'CANDIDATE_TRUTH',canonicalKey:'FULL_NAME',text:'Example Candidate'},{sourceId:claimId,sourceType:'CANDIDATE_TRUTH',canonicalKey:'EMPLOYMENT_DESCRIPTION',text:'I supported Kubernetes migrations, but did not lead teams.'}],jobClaims:[]});
results.push({id:'D15',finding:'Grounding validator accepts a negation reversal using only words in the source',accepted:negation.blocks[0].text});

const bundle = await build({ stdin: { contents: `
import {DomScanner, FieldRegistry, GraphElementRegistry} from './apps/extension/src/content/scanner.ts';
import {FieldOwnershipTracker} from './apps/extension/src/content/ownership.ts';
import {IndependentFieldVerifier} from './apps/extension/src/content/verifier.ts';
import {ExecutionStrategyRegistry} from './apps/extension/src/content/executor.ts';
import {detectFieldCapabilities} from './apps/extension/src/content/capabilities.ts';
window.auditScan = () => new DomScanner(new FieldRegistry(),new FieldOwnershipTracker(),new GraphElementRegistry()).scan(document, crypto.randomUUID(),'INITIAL',null);
window.auditExecute = async (selector, representation, hints) => {
 const target=document.querySelector(selector), registry=new FieldRegistry(), pageId=crypto.randomUUID();
 registry.bind('field:test',target,'control:test');
 const request={fieldRuntimeId:'field:test',pageInstanceId:pageId,representation,capabilityHints:hints??detectFieldCapabilities(target)};
 const strategies=new ExecutionStrategyRegistry(), candidates=strategies.candidates(target,request);
 if(candidates.length) await strategies.execute(candidates[0],target,request);
 const verification=await new IndependentFieldVerifier(registry,()=>pageId).verify(request);
 return {candidates:candidates.map(c=>c.strategyId),value:target.value??target.textContent,verification};
};
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://audit.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Application</h1>' }));
  await page.goto('https://audit.example.test/apply');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.setContent('<form><fieldset><legend>Total years of experience</legend><label><input type="radio" name="exp" value="0-4">0 to 4 yrs</label><label><input type="radio" name="exp" value="4-6">4 to 6 yrs</label><label><input type="radio" name="exp" value="6+">6+ yrs</label></fieldset></form>');
  const radio = await page.evaluate('window.auditScan()');
  assert.equal(radio.fields.length,3);
  results.push({ id: 'D07', finding: 'One radio question scanned as three independent fields', fieldCount: radio.fields.length });
  await page.setContent('<form><label>Answer<textarea id="answer"></textarea></label></form>');
  const enumRep = resolver.resolve({ ...common, kind: 'ENUM', value: { key: 'LINKEDIN', label: 'LinkedIn' } }, field('How did you hear about us?', 'TEXTAREA', 'textarea'));
  const enumExecution = await page.evaluate(r => window.auditExecute('#answer', r), enumRep);
  assert.equal(enumExecution.candidates.length,0);
  results.push({ id: 'D08', finding: 'Enum answer in textarea has no compatible executor', result: enumExecution });
  await page.setContent('<form><label>Work from office?<input id="answer"></label></form>');
  const booleanRep = resolver.resolve({ ...common, kind: 'BOOLEAN', value: true }, field('Will you work from office?'));
  const booleanExecution = await page.evaluate(r => window.auditExecute('#answer', r), booleanRep);
  assert.equal(booleanExecution.candidates.length,0);
  results.push({ id: 'D09', finding: 'Boolean answer in text input has no compatible executor', result: booleanExecution });
  await page.setContent('<form><label>Joining availability<input id="answer"></label></form>');
  const noticeRep = resolver.resolve({ ...common, kind: 'INTEGER', value: 45 }, field('If you are offered, by when can you join?'));
  const noticeExecution = await page.evaluate(r => window.auditExecute('#answer', r), noticeRep);
  assert.equal(noticeExecution.verification.status,'VERIFIED');
  results.push({ id: 'D10', finding: 'Bare 45 is independently VERIFIED without verifying answer meaning', result: noticeExecution });
  await page.setContent('<form><div contenteditable="true" id="answer" aria-label="Personal summary"></div></form>');
  const rich = resolver.resolve({ ...common, kind: 'RICH_TEXT', value: 'Backend engineer' }, field('Personal summary','TEXTAREA','div'));
  const editable = await page.evaluate(r => window.auditExecute('#answer',r,['NATIVE_TEXTAREA']), rich);
  assert.equal(editable.candidates.length,0);
  results.push({ id: 'D11', finding: 'Contenteditable scanner type becomes native-textarea planner hint, excluding its existing strategy', result: editable });
  await page.setContent('<form><input id="answer" type="text"></form>');
  await page.evaluate(() => { window.committedAnswer = ''; document.querySelector('#answer').addEventListener('input', event => { if(event.isTrusted) window.committedAnswer=event.target.value; }); });
  const framework = await page.evaluate(r => window.auditExecute('#answer',r), resolver.resolve({ ...common, kind: 'STRING', value: 'Example' },field('Full name')));
  const committed = await page.evaluate('window.committedAnswer');
  assert.equal(framework.verification.status,'VERIFIED'); assert.equal(committed,'');
  results.push({ id: 'D12', finding: 'DOM readback passes while application model rejects synthetic event', result: framework, applicationModel: committed });
  await page.setContent('<form><div id="answer" role="combobox" data-value="" tabindex="0"></div><div id="other-options" role="listbox"><div role="option">India</div></div></form>');
  await page.evaluate(() => {window.unrelatedClicked=false;document.querySelector('[role="option"]').onclick=()=>{window.unrelatedClicked=true;};});
  const country = resolver.resolve({ ...common, kind: 'ENUM', value: { key: 'IN', label: 'India' } },field('Country','COMBOBOX','div'));
  const combo=await page.evaluate(r=>window.auditExecute('#answer',r),country);
  const unrelatedClicked=await page.evaluate('window.unrelatedClicked');
  assert.equal(unrelatedClicked,true);
  results.push({id:'D13',finding:'Unassociated combobox searches whole document and clicks another listbox option',unrelatedClicked,result:combo});
  await page.setContent('<div id="shadow-host" style="display:none"></div>');
  await page.evaluate(()=>{document.querySelector('#shadow-host').attachShadow({mode:'open'}).innerHTML='<label>Email<input type="email"></label>';});
  const hiddenShadow=await page.evaluate('window.auditScan()');
  assert.equal(hiddenShadow.fields.length,1);
  results.push({id:'D16',finding:'Open-shadow control under display:none host is incorrectly scanned as visible',fields:hiddenShadow.fields.length});
} finally { await browser.close(); }
console.log(JSON.stringify({ auditedAt: new Date().toISOString(), method: 'Synthetic counterexamples against current source; not employer submissions', results },null,2));

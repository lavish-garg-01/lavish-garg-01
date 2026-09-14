import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright";
import {
  ExecutionPlanRequestSchema,
  ResolveFieldIntelligenceRequestSchema,
  type ExecutionPlanRequest,
  type ResolveFieldIntelligenceRequest
} from "@job-hunter-v2/contracts";
import type { CandidateTruthResolution, PersistableNormalizedValue, ResolveCandidateTruthInput } from "@job-hunter-v2/candidate-truth";
import { FieldIntelligenceService, FieldSemanticResolver } from "@job-hunter-v2/field-intelligence";
import { ExecutionPlanningService } from "@job-hunter-v2/execution";
import { RepeatableEntityIntelligenceService, type RepeatableEntityRepository } from "@job-hunter-v2/repeatable-entities";

const automaticSmoke = process.env.AUTOFILL_SMOKE === "true";
const webOrigin = "http://127.0.0.1:43301";
const fixtureOrigin = automaticSmoke ? "http://127.0.0.1:43310" : webOrigin;
const apiOrigin = "http://127.0.0.1:43310";
const extensionPath = process.env.EXTENSION_OUTPUT_DIR
  ? resolve(new URL("..", import.meta.url).pathname, process.env.EXTENSION_OUTPUT_DIR)
  : resolve(new URL("../apps/extension/dist", import.meta.url).pathname);
const accountId = "10000000-0000-4000-8000-000000000091";
const candidateId = "20000000-0000-4000-8000-000000000091";
const answerVersionId = "40000000-0000-4000-8000-000000000091";
const currentEmploymentId = "40000000-0000-4000-8000-000000000092";
const previousEmploymentId = "40000000-0000-4000-8000-000000000093";
const educationId = "40000000-0000-4000-8000-000000000094";
const fixtureApplicationId = "30000000-0000-4000-8000-000000000091";
const resumeSelectionId = "50000000-0000-4000-8000-000000000091";
const coverSelectionId = "50000000-0000-4000-8000-000000000092";
const resumeDocumentId = "60000000-0000-4000-8000-000000000091";
const coverDocumentId = "60000000-0000-4000-8000-000000000092";
const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n", "utf8");
const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");
const common = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };

function html(body: string, script = ""): string {
  return `<!doctype html><html data-ats="GREENHOUSE"><head><meta charset="utf-8"><title>Phase K fixture</title></head><body data-ats="GREENHOUSE"><main><h1>Software Engineer application</h1>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

function fixture(path: string): string {
  if (path === "/careers/custom") return '<!doctype html><h1>Join our team</h1><label>Email<input id="journey-email" name="email" type="email"></label>';
  if (path === "/contact") return '<!doctype html><h1>Contact us</h1><form><label>Name<input name="name"></label><label>Email<input name="email" type="email"></label><textarea name="message"></textarea></form>';
  if (path === "/auto-pause" || path === "/auto-failure") return html('<form><label>First name<input id="auto-first" name="first_name"></label><label>Email<input id="auto-email" name="email" type="email"></label><label><input id="auto-privacy" type="checkbox">I acknowledge the privacy policy</label><button type="submit">Submit application</button></form>', 'window.submitted=0;document.querySelector("form").addEventListener("submit",e=>{e.preventDefault();window.submitted++})');
  if (path === "/web") return html("<p>Connect Job Hunter.</p>");
  if (path === "/documents-native") return html(`
    <form id="documents-native">
      <label>Resume<input id="native-resume" type="file" name="resume" accept="application/pdf"></label>
      <label>Cover letter<input id="native-cover" type="file" name="cover_letter" accept=".pdf"></label>
    </form>`);
  if (path === "/documents-custom") return html(`
    <form id="documents-custom"><div class="upload" role="group">
      <label for="custom-resume">Upload resume</label><button type="button">Choose file</button>
      <input id="custom-resume" type="file" name="resume" accept="application/pdf" style="display:none">
    </div></form>`);
  if (path === "/documents-rejected") return html(`
    <form id="documents-rejected"><label>Resume<input id="rejected-resume" type="file" name="resume" accept="image/png"></label></form>`);
  if (path === "/conditional") return html(`
    <form id="conditional-form">
      <fieldset><legend>Will you require visa sponsorship in India?</legend><label><input type="radio" name="sponsorship" value="yes" aria-controls="sponsorship-details">Yes</label><label><input type="radio" name="sponsorship" value="no" aria-controls="sponsorship-details">No</label></fieldset>
      <section id="sponsorship-details" hidden><label>Notice period in days<input id="conditional-notice" type="number" name="notice"></label></section>
    </form>`, `
      const controls=[...document.querySelectorAll('input[name=sponsorship]')],details=document.querySelector('#sponsorship-details');
      controls.forEach(control=>control.addEventListener('change',()=>{details.hidden=control.value!=='yes'||!control.checked}));
    `);
  if (path === "/nested") return html(`
    <form id="nested-form">
      <fieldset><legend>Are you legally authorized to work in India?</legend><label><input type="radio" name="authorized" value="yes" aria-controls="sponsor-section">Yes</label><label><input type="radio" name="authorized" value="no" aria-controls="sponsor-section">No</label></fieldset>
      <section id="sponsor-section" hidden><fieldset><legend>Will you require visa sponsorship in India?</legend><label><input type="radio" name="sponsorship" value="yes" aria-controls="notice-section">Yes</label><label><input type="radio" name="sponsorship" value="no" aria-controls="notice-section">No</label></fieldset></section>
      <section id="notice-section" hidden><label>Notice period in days<input id="nested-notice" type="number" name="notice"></label></section>
    </form>`, `
      const authorized=[...document.querySelectorAll('input[name=authorized]')],sponsor=document.querySelector('#sponsor-section'),notice=document.querySelector('#notice-section');
      authorized.forEach(control=>control.addEventListener('change',()=>{sponsor.hidden=control.value!=='yes'||!control.checked;if(sponsor.hidden)notice.hidden=true}));
      [...document.querySelectorAll('input[name=sponsorship]')].forEach(control=>control.addEventListener('change',()=>{notice.hidden=control.value!=='yes'||!control.checked}));
    `);
  if (path === "/dependent-options") return html(`
    <form><label>Current location<select id="country" name="location" aria-controls="preferred"><option value="">Choose</option><option value="India">India</option><option value="Singapore">Singapore</option></select></label>
    <label>Preferred locations<select id="preferred" name="preferred_locations" data-controlled-by="country" multiple><option value="">Choose country first</option></select></label></form>`, `
      const country=document.querySelector('#country'),preferred=document.querySelector('#preferred');
      country.addEventListener('change',()=>{preferred.innerHTML=country.value==='India'?'<option value="bengaluru">Bengaluru</option><option value="pune">Pune</option>':'<option value="singapore">Singapore</option>'});
    `);
  if (path === "/auto-repeatable") return html(`
    <form id="auto-history"><section id="auto-history-list"><h2>Employment history</h2>
      <div class="experience-item" data-repeatable-item="employment-current"><h3>Current employment</h3><label>Company<input id="auto-current-company"></label><label>Job title<input id="auto-current-title"></label></div>
    </section><button type="button" id="auto-add">Add another experience</button></form>`, `
      document.querySelector('#auto-add').addEventListener('click',()=>{if(!document.querySelector('[data-repeatable-item="employment-previous"]'))document.querySelector('#auto-history-list').insertAdjacentHTML('beforeend','<div class="experience-item" data-repeatable-item="employment-previous"><h3>Previous employment</h3><label>Company<input id="auto-previous-company"></label><label>Job title<input id="auto-previous-title"></label></div>')});
    `);
  if (path === "/requiredness") return html(`
    <form><fieldset><legend>Will you require visa sponsorship in India?</legend><label><input type="radio" name="sponsorship" value="yes" aria-controls="required-details">Yes</label><label><input type="radio" name="sponsorship" value="no" aria-controls="required-details">No</label></fieldset>
    <section id="required-details" hidden><label>Notice period in days<input id="required-notice" type="number" name="notice"></label></section><button type="button">Next</button></form>`, `
      [...document.querySelectorAll('input[name=sponsorship]')].forEach(control=>control.addEventListener('change',()=>{const section=document.querySelector('#required-details'),notice=document.querySelector('#required-notice');section.hidden=control.value!=='yes'||!control.checked;notice.required=!section.hidden;notice.setAttribute('aria-required',String(!section.hidden))}));
    `);
  if (path === "/validation") return html(`
    <form id="validation-form"><label>Email address<input id="validation-email" name="email" type="email" required></label><button id="validation-next" type="button">Next</button></form>`, `
      document.querySelector('#validation-next').addEventListener('click',()=>{const input=document.querySelector('#validation-email');input.value='';input.setAttribute('aria-invalid','true');if(!document.querySelector('#validation-error'))input.insertAdjacentHTML('afterend','<span id="validation-error" role="alert">Email is required</span>')});
    `);
  if (path === "/manual-branch") return html(`
    <form><fieldset><legend>Will you require visa sponsorship in India?</legend><label><input type="radio" name="sponsorship" value="yes" aria-controls="manual-details">Yes</label><label><input type="radio" name="sponsorship" value="no" aria-controls="manual-details">No</label></fieldset>
    <section id="manual-details" hidden><label>Notice period in days<input id="manual-notice" type="number" name="notice"></label></section></form>`, `
      [...document.querySelectorAll('input[name=sponsorship]')].forEach(control=>control.addEventListener('change',()=>{document.querySelector('#manual-details').hidden=control.value!=='yes'||!control.checked}));
    `);
  if (path === "/rerender") return html(`<div id="rerender-root"><form><label>Email address<input id="rerender-email" name="email" type="email"></label></form></div><button id="rerender">Rerender</button>`, `
    document.querySelector('#rerender').addEventListener('click',()=>{document.querySelector('#rerender-root').innerHTML='<form><label>Email address<input id="rerender-email" name="email" type="email"></label></form>'});
  `);
  if (path === "/cycle") return html(`<form><label>Current location<select id="cycle-a" name="location" data-controlled-by="cycle-b"><option value="">Choose</option><option value="India">India</option></select></label><label>Preferred locations<select id="cycle-b" name="preferred_locations" data-controlled-by="cycle-a" multiple><option value="">Choose</option><option value="bengaluru">Bengaluru</option></select></label></form>`);
  if (path.startsWith("/multi-step")) return html(`
    <div id="multi-root"><form action="/multi-step/step/1"><h2>Personal information</h2><label>Email address<input id="multi-email" name="email" type="email"></label><button id="multi-next" type="button">Next</button></form></div>`, `
      document.querySelector('#multi-next').addEventListener('click',()=>{history.pushState({},'', '/multi-step/step/2');document.querySelector('h1').textContent='Experience';document.querySelector('#multi-root').innerHTML='<form action="/multi-step/step/2"><h2>Experience</h2><label>Notice period in days<input id="multi-notice" type="number" name="notice"></label><button type="button">Continue</button></form>'});
    `);
  if (path === "/interrupt") return html(`
    <form><label>Current employer<input id="company" name="company" role="combobox" aria-controls="companies" aria-expanded="false"></label>
    <div id="companies" role="listbox" hidden><div role="option" data-value="Vidyakul">Vidyakul</div><div role="option" data-value="Other">Other</div></div></form>`, `
    const company=document.querySelector('#company'), list=document.querySelector('#companies');
    const show=()=>setTimeout(()=>{list.hidden=false;company.setAttribute('aria-expanded','true')},450);
    company.addEventListener('click',show);company.addEventListener('input',show);
    list.addEventListener('click',event=>{const option=event.target.closest('[role=option]');if(!option)return;company.value=option.dataset.value;company.dataset.committed=option.dataset.value;company.setAttribute('aria-expanded','false');list.hidden=true;company.dispatchEvent(new Event('change',{bubbles:true}))});
  `);
  if (path === "/ambiguous-option") return html(`<form><label>Current location<select id="location" name="location"><option value="">Choose</option><option value="india-a">India</option><option value="india-b">India</option></select></label></form>`);
  if (path === "/spa-stale") return html(`
    <div id="root"><form><label>Current employer<input id="company" name="company" role="combobox" aria-controls="companies" aria-expanded="false"></label>
    <div id="companies" role="listbox" hidden><div role="option" data-value="Vidyakul">Vidyakul</div></div></form></div>`, `
    const company=document.querySelector('#company'), list=document.querySelector('#companies');
    const show=()=>setTimeout(()=>{if(list.isConnected){list.hidden=false;company.setAttribute('aria-expanded','true')}},650);
    company.addEventListener('click',show);company.addEventListener('input',show);
    list.addEventListener('click',event=>{const option=event.target.closest('[role=option]');if(option){company.value=option.dataset.value;company.dataset.committed=option.dataset.value}});
  `);
  if (path === "/repeatable") return html(`
    <form id="history-form"><section id="history">
      <div class="experience-item" data-repeatable-item="employment-previous"><h3>Previous employment</h3><label>Company<input id="previous-company"></label><label>Job title<input id="previous-title"></label></div>
      <div class="experience-item" data-repeatable-item="employment-current"><h3>Current employment</h3><label>Company<input id="current-company"></label><label>Job title<input id="current-title"></label></div>
      <div class="education-item" data-repeatable-item="education-main"><h3>Education</h3><label>University<input id="education-school"></label><label>Degree<input id="education-degree"></label></div>
    </section><button type="button" id="remove-previous">Remove previous</button><button type="button" id="reorder-history">Reorder history</button><button type="button" id="add-previous">Add another experience</button></form>`, `
      const history=document.querySelector('#history');
      document.querySelector('#remove-previous').addEventListener('click',()=>document.querySelector('[data-repeatable-item="employment-previous"]')?.remove());
      document.querySelector('#reorder-history').addEventListener('click',()=>{const current=document.querySelector('[data-repeatable-item="employment-current"]'),previous=document.querySelector('[data-repeatable-item="employment-previous"]');if(current&&previous)history.insertBefore(current,previous)});
      document.querySelector('#add-previous').addEventListener('click',()=>{if(!document.querySelector('[data-repeatable-item="employment-previous"]'))history.insertAdjacentHTML('afterbegin','<div class="experience-item" data-repeatable-item="employment-previous"><h3>Previous employment</h3><label>Company<input id="previous-company"></label><label>Job title<input id="previous-title"></label></div>')});
    `);
  return html(`
    <form id="application"><section><h2>Personal information</h2>
      <label>First name<input id="first" name="first_name" autocomplete="given-name"></label>
      <label>Email address<input id="react-email" name="email" type="email" autocomplete="email"></label>
      <label>Professional summary<textarea id="summary" name="summary"></textarea></label>
      <label>Notice period in days<input id="notice" type="number" name="notice"></label>
      <label>Current location<select id="location" name="location"><option value="">Choose</option><option value="India">India</option><option value="Singapore">Singapore</option></select></label>
      <div id="dynamic"></div>
      <label>Technical skills<select id="skills" name="technical_skills" aria-label="Technical skills" multiple><option value="typescript">TypeScript</option><option value="postgresql">PostgreSQL</option><option value="java">Java</option></select></label>
      <label>Current employer<input id="company" name="company" role="combobox" aria-controls="companies" aria-expanded="false"></label>
      <div id="companies" role="listbox" hidden><div role="option" data-value="Vidyakul">Vidyakul</div><div role="option" data-value="Other">Other</div></div>
    </section>
    <fieldset><legend>Are you at least 18 years old?</legend><label><input id="adult" type="checkbox" name="adult">Yes</label></fieldset>
    <fieldset><legend>Are you legally authorized to work in India?</legend><label><input type="radio" name="authorized" value="yes">Yes</label><label><input type="radio" name="authorized" value="no">No</label></fieldset>
    <label><input id="privacy" type="checkbox" name="privacy">I acknowledge the applicant privacy notice</label>
    <label>Resume<input id="resume" type="file" name="resume"></label></form>`, `
    function bindReactEmail(input){input.addEventListener('input',()=>{const replacement=input.cloneNode();replacement.value=input.value;input.replaceWith(replacement);bindReactEmail(replacement)},{once:true})}bindReactEmail(document.querySelector('#react-email'));
    const locationField=document.querySelector('#location');locationField.addEventListener('change',()=>{if(locationField.value==='India'&&!document.querySelector('#portfolio'))document.querySelector('#dynamic').innerHTML='<label>Portfolio URL<input id="portfolio" name="portfolio"></label>'});
    const company=document.querySelector('#company'), list=document.querySelector('#companies');
    const show=()=>setTimeout(()=>{list.hidden=false;company.setAttribute('aria-expanded','true')},40);
    company.addEventListener('click',show);company.addEventListener('input',show);
    list.addEventListener('click',event=>{const option=event.target.closest('[role=option]');if(!option)return;company.value=option.dataset.value;company.dataset.committed=option.dataset.value;company.setAttribute('aria-expanded','false');list.hidden=true;company.dispatchEvent(new Event('change',{bubbles:true}))});
  `);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => { let value = ""; request.setEncoding("utf8"); request.on("data", (chunk) => { value += chunk; }); request.on("end", () => resolvePromise(value)); request.on("error", reject); });
}

function listen(port: number, handler: (request: IncomingMessage) => Promise<{ status?: number; body: string; contentType?: string }>): Promise<Server> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer((request, response) => { void handler(request).then((result) => {
      response.writeHead(result.status ?? 200, { "content-type": result.contentType ?? "text/html; charset=utf-8", "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type" }); response.end(result.body);
    }).catch((reason) => { response.writeHead(500); response.end(reason instanceof Error ? reason.message : "error"); }); });
    server.once("error", reject); server.listen(port, "127.0.0.1", () => resolvePromise(server));
  });
}

const close = (server: Server) => new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
async function waitFor<T>(read: () => Promise<T | null | false>, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const result = await read(); if (result) return result; await new Promise((resolvePromise) => setTimeout(resolvePromise, 75)); }
  throw new Error(`Timed out waiting for ${label}.`);
}
async function extensionWorker(context: BrowserContext): Promise<Worker> { return context.serviceWorkers().find((item) => item.url().startsWith("chrome-extension://")) ?? context.waitForEvent("serviceworker"); }
function structuralHash(value: string): string { let hash = 2_166_136_261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16_777_619); } return (hash >>> 0).toString(16).padStart(8, "0"); }

async function waitForRuntime(worker: Worker, path: string, answerCount = 1): Promise<void> {
  const pathHash = structuralHash(`${fixtureOrigin}${path}`);
  await waitFor(async () => worker.evaluate(async ({ expectedPathHash, minimum }) => {
    const raw = await chrome.storage.session.get("jobHunter.extension.runtimes.v1");
    return Object.values((raw["jobHunter.extension.runtimes.v1"] ?? {}) as Record<string, { pathHash?: string; lastIntelligence?: { answerAvailable?: number } }>).some((record) => record.pathHash === expectedPathHash && (record.lastIntelligence?.answerAvailable ?? 0) >= minimum) || null;
  }, { expectedPathHash: pathHash, minimum: answerCount }), `${path} intelligence`);
}

async function runtimeForPath(worker: Worker, path: string): Promise<Record<string, unknown> | null> {
  const pathHash = structuralHash(`${fixtureOrigin}${path}`);
  return worker.evaluate(async ({ key, expectedPathHash }) => {
    const raw = await chrome.storage.session.get(key);
    return Object.values((raw[key] ?? {}) as Record<string, Record<string, unknown>>).find((record) => record.pathHash === expectedPathHash) ?? null;
  }, { key: "jobHunter.extension.runtimes.v1", expectedPathHash: pathHash });
}

async function executeActive(panel: Page): Promise<void> {
  const result = await panel.evaluate(async () => chrome.runtime.sendMessage({
    protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: null, sentAt: new Date().toISOString(),
    source: "SIDEPANEL", type: "UI_EXECUTE_ACTIVE_TAB", dataClass: "STRUCTURAL", payload: {}
  })) as { ok: boolean; failure?: unknown };
  assert.equal(result.ok, true, JSON.stringify(result));
}

async function webMessage(page: Page, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serialized = JSON.stringify(message).replaceAll("<", "\\u003c");
  return page.evaluate(`(async () => {
    const input = ${serialized}; const nonce = crypto.randomUUID();
    return new Promise((resolvePromise, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("bridge timeout")), 5000);
      const listener = (event) => { const data = event.data;
        if (event.source !== window || event.origin !== location.origin || !data || data.source !== "JOB_HUNTER_EXTENSION" || data.nonce !== nonce) return;
        clearTimeout(timeout); window.removeEventListener("message", listener); resolvePromise(data);
      };
      window.addEventListener("message", listener); window.postMessage({ source: "JOB_HUNTER_WEB", nonce, ...input }, location.origin);
    });
  })()`) as Promise<Record<string, unknown>>;
}

function normalized(canonicalKey: string): PersistableNormalizedValue | null {
  const values: Record<string, PersistableNormalizedValue> = {
    FIRST_NAME: { ...common, kind: "STRING", value: "Ada" },
    EMAIL: { ...common, kind: "STRING", value: "ada@example.test" },
    PERSONAL_SUMMARY: { ...common, kind: "RICH_TEXT", value: "Backend engineer building reliable systems." },
    NOTICE_PERIOD: { ...common, kind: "INTEGER", value: 30 },
    CURRENT_LOCATION: { ...common, kind: "STRING", value: "India" },
    SKILLS: { ...common, kind: "MULTI_ENUM", values: [{ key: "typescript", label: "TypeScript" }, { key: "postgresql", label: "PostgreSQL" }] },
    CURRENT_COMPANY: { ...common, kind: "STRING", value: "Vidyakul" },
    AGE_OVER_18: { ...common, kind: "BOOLEAN", value: true },
    WORK_AUTHORIZATION: { ...common, kind: "BOOLEAN", value: true },
    SPONSORSHIP_REQUIRED: { ...common, kind: "BOOLEAN", value: true },
    PREFERRED_LOCATIONS: { ...common, kind: "MULTI_ENUM", values: [{ key: "bengaluru", label: "Bengaluru" }] },
    PORTFOLIO_URL: { ...common, kind: "URL", value: "https://portfolio.example.test/ada" },
    PRIVACY_ACKNOWLEDGEMENT: { ...common, kind: "BOOLEAN", value: true },
    RESUME: { ...common, kind: "FILE_REF", fileId: crypto.randomUUID(), contentSha256: "b".repeat(64), fileName: "resume.pdf", mimeType: "application/pdf" }
  };
  return values[canonicalKey] ?? null;
}

function entityValue(canonicalKey: string, entityId: string | null | undefined): PersistableNormalizedValue | null {
  const values: Record<string, Record<string, PersistableNormalizedValue>> = {
    [currentEmploymentId]: {
      EMPLOYMENT_COMPANY: { ...common, kind: "STRING", value: "Same Company" },
      EMPLOYMENT_TITLE: { ...common, kind: "STRING", value: "Senior Engineer" }
    },
    [previousEmploymentId]: {
      EMPLOYMENT_COMPANY: { ...common, kind: "STRING", value: "Same Company" },
      EMPLOYMENT_TITLE: { ...common, kind: "STRING", value: "Engineer" }
    },
    [educationId]: {
      EDUCATION_INSTITUTION: { ...common, kind: "STRING", value: "University A" },
      EDUCATION_DEGREE: { ...common, kind: "STRING", value: "B.Tech" }
    }
  };
  return entityId ? values[entityId]?.[canonicalKey] ?? null : null;
}

const repeatableRepository: RepeatableEntityRepository = {
  invalidateBindingsExcept: async () => undefined,
  listCandidateEntities: async () => [
    { candidateEntityId: currentEmploymentId, entityType: "EMPLOYMENT", entityVersion: 1, entityRevision: "1".repeat(64), status: "ACTIVE", displayOrder: 1, recencyRank: 0, canonicalCoverage: ["EMPLOYMENT_COMPANY", "EMPLOYMENT_TITLE"], privateValueFingerprints: [] },
    { candidateEntityId: previousEmploymentId, entityType: "EMPLOYMENT", entityVersion: 1, entityRevision: "2".repeat(64), status: "ACTIVE", displayOrder: 0, recencyRank: 1, canonicalCoverage: ["EMPLOYMENT_COMPANY", "EMPLOYMENT_TITLE"], privateValueFingerprints: [] },
    { candidateEntityId: educationId, entityType: "EDUCATION", entityVersion: 1, entityRevision: "3".repeat(64), status: "ACTIVE", displayOrder: 0, recencyRank: 0, canonicalCoverage: ["EDUCATION_INSTITUTION", "EDUCATION_DEGREE"], privateValueFingerprints: [] }
  ],
  findBinding: async () => null,
  saveBinding: async (input) => input.receipt,
  mutateEntity: async () => { throw new Error("not used"); },
  reorderEntities: async () => { throw new Error("not used"); }
};

const scopeKey = "scope=GLOBAL";
const candidateTruth = {
  resolve: async (input: ResolveCandidateTruthInput): Promise<CandidateTruthResolution> => {
    const value = entityValue(input.canonicalKey, input.entityId) ?? normalized(input.canonicalKey);
    if (!value) return { status: "MISSING", canonicalKey: input.canonicalKey, reasonCodes: ["NO_COMPATIBLE_CANDIDATE_TRUTH"] };
    return {
      status: "RESOLVED", canonicalKey: input.canonicalKey, answerVersionId, normalizedValue: value,
      scope: { scopeType: "GLOBAL", scopeKey, scopeFingerprint: createHash("sha256").update(scopeKey).digest("hex"), precedence: 100 },
      trustState: "TRUSTED", trialReuse: false, requiresUserReview: false, autofillMode: "AUTO", expiresAt: null,
      reasonCodes: ["BEST_COMPATIBLE_SCOPE", "ANSWER_HAS_NO_EXPIRY"], candidateVersionIds: [answerVersionId]
    };
  }
};
const fieldIntelligence = new FieldIntelligenceService(
  new FieldSemanticResolver(), candidateTruth, null, undefined, 8,
  new RepeatableEntityIntelligenceService(repeatableRepository)
);
const documentSelections: Array<"RESUME" | "COVER_LETTER"> = [];
const execution = new ExecutionPlanningService(fieldIntelligence, undefined, undefined, {
  resolve: async (input) => {
    documentSelections.push(input.documentKind);
    const cover = input.documentKind === "COVER_LETTER";
    return {
      selectionId: cover ? coverSelectionId : resumeSelectionId,
      documentId: cover ? coverDocumentId : resumeDocumentId,
      documentKind: input.documentKind,
      fileName: cover ? "Ada-cover-letter.pdf" : "Ada-resume.pdf",
      mimeType: "application/pdf" as const,
      byteSize: pdfBytes.byteLength,
      contentSha256: pdfSha256,
      bytesBase64: pdfBytes.toString("base64")
    };
  }
});
const intelligenceRequests: ResolveFieldIntelligenceRequest[] = [];
const executionRequests: ExecutionPlanRequest[] = [];
const executionPlans: Array<Awaited<ReturnType<ExecutionPlanningService["plan"]>>> = [];

let failNextResolve = false;
let delayPlans = false;
const fixtureServer = await listen(43301, async (request) => ({ body: fixture(new URL(request.url ?? "/", fixtureOrigin).pathname) }));
const apiServer = await listen(43310, async (request) => {
  const path = new URL(request.url ?? "/", apiOrigin).pathname;
  if (request.method === "OPTIONS") return { status: 204, body: "" };
  if (automaticSmoke && request.method === "GET" && !path.startsWith("/v1/")) return { body: fixture(path) };
  if (path === "/v1/learning/runs") {
    const input = JSON.parse(await readBody(request));
    return { body: JSON.stringify({ schemaVersion: 1, requestId: input.requestId, applicationId: fixtureApplicationId, applicationRunId: crypto.randomUUID(), status: "ACTIVE", idempotentReplay: false, containsCandidateValue: false }), contentType: "application/json" };
  }
  if (path === "/v1/learning/execution-evidence") {
    const input = JSON.parse(await readBody(request));
    return { body: JSON.stringify({ schemaVersion: 1, requestId: input.requestId, evidenceId: crypto.randomUUID(), idempotentReplay: false, containsCandidateValue: false }), contentType: "application/json" };
  }
  if (path === "/v1/auth/session") return { body: JSON.stringify({ email: "phase-k@example.test", account: { type: "TEST", role: "OWNER" }, candidate: { id: candidateId, new: false }, onboarding: { stage: "READY", completed: true, version: 1, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() } }), contentType: "application/json" };
  if (path === "/v1/field-intelligence/resolve" && request.method === "POST") {
    if (failNextResolve) { failNextResolve = false; return { status: 503, body: JSON.stringify({ error: "Fixture unavailable" }), contentType: "application/json" }; }
    const parsed = ResolveFieldIntelligenceRequestSchema.parse(JSON.parse(await readBody(request))); intelligenceRequests.push(parsed);
    return { body: JSON.stringify(await fieldIntelligence.resolve({ accountId, candidateId, request: parsed })), contentType: "application/json" };
  }
  if (path === "/v1/execution/plan" && request.method === "POST") {
    const parsed = ExecutionPlanRequestSchema.parse(JSON.parse(await readBody(request))); executionRequests.push(parsed);
    if (delayPlans) await new Promise((resolvePromise) => setTimeout(resolvePromise, 800));
    const documentOnly = parsed.intelligence.fields.length > 0
      && parsed.intelligence.fields.every((field) => field.controlType === "FILE");
    const planRequest = ExecutionPlanRequestSchema.parse({
      ...parsed,
      intelligence: {
        ...parsed.intelligence,
        pageContext: {
          ...parsed.intelligence.pageContext,
          applicationId: documentOnly ? fixtureApplicationId : parsed.intelligence.pageContext.applicationId
        }
      }
    });
    const plan = await execution.plan({ accountId, candidateId, request: planRequest }); executionPlans.push(plan);
    if (process.env.PHASE_Q_BROWSER === "true") {
      for (const operation of plan.operations) {
        if (operation.declarationAuthorization || operation.representation.kind !== "TEXT"
          || !["NATIVE_TEXT", "NATIVE_TEXTAREA"].includes(operation.capabilityHints[0] ?? "")) continue;
        // Offline candidate-only exposure: passing assertions cannot be rescued by a builtin.
        operation.maximumAttempts = 1;
        operation.strategySelection = { policyVersion: "Q1-2026-09", revision: 1,
          cluster: "a".repeat(64), experimentId: null, arm: "STABLE",
          strategies: [{ key: "Q_OFFLINE_NATIVE_TEXT@1", plan: { kind: "TARGET_TEXT",
            steps: ["FOCUS", "SET_NATIVE_VALUE", "INPUT", "CHANGE", "BLUR"] } }] };
      }
    }
    return { body: JSON.stringify(plan), contentType: "application/json" };
  }
  return { status: 404, body: JSON.stringify({ error: "not found" }), contentType: "application/json" };
});

const profile = await mkdtemp(join(tmpdir(), "job-hunter-phase-k-"));
let context: BrowserContext | null = null;
const browserErrors: string[] = [];
try {
  context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: false, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  let worker = await extensionWorker(context); worker.on("console", (entry) => { if (entry.type() === "error") browserErrors.push(`worker:${entry.text()}`); });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage(); page.on("pageerror", (error) => browserErrors.push(`page:${error.message}`)); page.on("console", (entry) => { if (entry.type() === "error") browserErrors.push(`page:${entry.text()}`); });
  const panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.goto(`${webOrigin}/web`);
  if (!automaticSmoke) await waitForRuntime(worker, "/web", 0).catch(() => undefined);
  const connected = await webMessage(page, { type: "JOB_HUNTER_SESSION_OFFER", accessToken: "phase-k-browser-token-123456789" }); assert.equal(connected.authState, "READY");

  if (automaticSmoke) {
    assert.equal(await page.locator("[data-job-hunter-ui]").count(), 0, "No dashboard Copilot overlay");
    // The API fixture origin has an existing host grant, but is not a trusted dashboard origin.
    await worker.evaluate(async (origin) => chrome.scripting.registerContentScripts([{ id: "autofill-fixture", matches: [`${origin}/*`], js: ["content.js"], runAt: "document_idle" }]), fixtureOrigin);
    await page.goto(`${fixtureOrigin}/careers/custom`); await page.bringToFront();
    await waitFor(async () => await page.locator('[data-job-hunter-ui]').count() === 1 || null, "manual journey fallback");
    assert.equal(await page.locator('#journey-email').inputValue(), '', "Uncertain pages do not fill automatically");
    const fallback = await page.locator('[data-job-hunter-ui]').boundingBox(); assert.ok(fallback);
    await page.mouse.click(fallback.x + 130, fallback.y + fallback.height - 34);
    await waitFor(async () => await page.locator('#journey-email').inputValue() === 'ada@example.test' || null, "manual inspection enables safe generic autofill");
    assert.ok((await runtimeForPath(worker, '/careers/custom'))?.journey, "Manual confirmation is scoped to the tab journey");
    await page.goto(`${fixtureOrigin}/application`); await page.bringToFront();
    await waitFor(async () => await page.locator("#portfolio").inputValue().catch(() => "") === "https://portfolio.example.test/ada" || null, "automatic dynamic-field fill", 20000);
    assert.equal(await page.locator("#first").inputValue(), "Ada");
    assert.equal(await page.locator("#react-email").inputValue(), "ada@example.test");
    assert.equal(await page.locator("#privacy").isChecked(), false, "Acknowledgements stay manual");
    const firstRuntime = await runtimeForPath(worker, "/application");
    assert.equal((firstRuntime?.identity as { applicationId: string }).applicationId, fixtureApplicationId, "Manually opened forms bind to a durable run");
    await waitFor(async () => (await runtimeForPath(worker, "/application"))?.autofill as object || null, "progress persisted");
    assert.equal(await page.locator("[data-job-hunter-ui]").count(), 1, "One on-page progress card");

    delayPlans = true;
    const before = executionRequests.length;
    await page.goto(`${fixtureOrigin}/auto-pause`); await page.bringToFront();
    await waitFor(async () => executionRequests.length > before || null, "planning began automatically");
    const control = async (action: "PAUSE" | "RESUME", path: string) => {
      const current = await runtimeForPath(worker, path);
      const identity = current?.identity as { tabId: number; pageInstanceId: string };
      const response = await worker.evaluate(async ({ identity, action }) => chrome.tabs.sendMessage(identity.tabId, { protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: null, sentAt: new Date().toISOString(), source: "BACKGROUND", type: "BACKGROUND_AUTOFILL_CONTROL", dataClass: "STRUCTURAL", payload: { pageInstanceId: identity.pageInstanceId, action } }), { identity, action });
      assert.equal(response.accepted, true);
    };
    await control("PAUSE", "/auto-pause");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    assert.equal(await page.locator("#auto-first").inputValue(), "", "Pause prevents pending plans from writing");
    delayPlans = false; await control("RESUME", "/auto-pause");
    await waitFor(async () => await page.locator("#auto-email").inputValue() === "ada@example.test" || null, "resumed fill");
    assert.equal(await page.locator("#auto-privacy").isChecked(), false);
    assert.equal(await page.evaluate(() => (window as unknown as { submitted: number }).submitted), 0, "Never auto-submit");

    failNextResolve = true;
    await page.goto(`${fixtureOrigin}/auto-failure`); await page.bringToFront();
    await waitFor(async () => (await runtimeForPath(worker, "/auto-failure"))?.lastFailure || null, "durable resolve failure");
    await control("RESUME", "/auto-failure");
    await waitFor(async () => await page.locator("#auto-email").inputValue() === "ada@example.test" || null, "resolve failure retry");
    assert.equal((await runtimeForPath(worker, "/auto-failure"))?.lastFailure, null);
    await waitFor(async () => await panel.locator("[data-focus-field]").count() > 0 || null, "clickable sidebar checklist");
    assert.equal(await panel.locator("#fill-page").isVisible(), false);
    await panel.setViewportSize({ width: 380, height: 950 });
    await mkdir(".local-data/qa", { recursive: true });
    await panel.screenshot({ path: ".local-data/qa/autofill-panel.png", fullPage: true });
    const retryRuntime = await runtimeForPath(worker, "/auto-failure");
    const email = (retryRuntime?.autofill as { fields: Array<{ canonicalKey: string; fieldRuntimeId: string }> }).fields.find((field) => field.canonicalKey === "EMAIL")!;
    // Programmatic click keeps the employer tab active, just like Chrome's side panel.
    await panel.evaluate((id) => document.querySelector<HTMLButtonElement>(`[data-focus-field="${id}"]`)!.click(), email.fieldRuntimeId);
    await waitFor(async () => await page.locator("#auto-email").evaluate((element) => document.activeElement === element) || null, "attention item focuses employer field");
    await page.locator("#auto-email").fill("candidate-edit@example.test");
    await control("RESUME", "/auto-failure");
    await page.waitForTimeout(800);
    assert.equal(await page.locator("#auto-email").inputValue(), "candidate-edit@example.test", "Manual edits survive retry");
    await page.goto(`${fixtureOrigin}/contact`); await page.bringToFront();
    await page.waitForTimeout(500);
    assert.equal(await page.locator("[data-job-hunter-ui]").count(), 0, "Contact forms never show Copilot");
    assert.equal(await page.locator("input[name=email]").inputValue(), "", "Contact forms are not autofilled");
    console.log("PASS: zero-click autofill, dynamic fields, durable run, progress, clickable focus, preserved edit, pause pending plan, resume, failure retry, manual privacy, no submission, dashboard/contact exclusion");
  } else {
  await page.goto(`${fixtureOrigin}/application`); await waitForRuntime(worker, "/application", 8); await page.bringToFront();
  const result = await panel.evaluate(async () => chrome.runtime.sendMessage({ protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: null, sentAt: new Date().toISOString(), source: "SIDEPANEL", type: "UI_EXECUTE_ACTIVE_TAB", dataClass: "STRUCTURAL", payload: {} })) as { ok: boolean };
  assert.equal(result.ok, true);
  await waitFor(async () => (await page.locator("#portfolio").inputValue().catch(() => "")) === "https://portfolio.example.test/ada" || null, "dynamic continuation");
  assert.equal(await page.locator("#first").inputValue(), "Ada");
  assert.equal(await page.locator("#react-email").inputValue(), "ada@example.test");
  assert.equal(await page.locator("#summary").inputValue(), "Backend engineer building reliable systems.");
  assert.equal(await page.locator("#notice").inputValue(), "30");
  assert.equal(await page.locator("#location").inputValue(), "India");
  assert.deepEqual(await page.locator("#skills option:checked").evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value).sort()), ["postgresql", "typescript"], JSON.stringify(executionPlans.map((plan) => ({ operations: plan.operations.map((item) => [item.canonicalKey, item.representation.kind]), skipped: plan.skipped })), null, 2));
  assert.equal(await page.locator("#company").getAttribute("data-committed"), "Vidyakul");
  assert.equal(await page.locator("#adult").isChecked(), true);
  assert.equal(await page.locator("input[name=authorized][value=yes]").isChecked(), true);
  assert.equal(await page.locator("#privacy").isChecked(), false);
  assert.equal(await page.locator("#resume").inputValue(), "");

  await page.goto(`${fixtureOrigin}/documents-native`); await waitForRuntime(worker, "/documents-native", 1); await page.bringToFront();
  await executeActive(panel);
  await waitFor(async () => await page.locator("#native-resume").evaluate((element) => (element as HTMLInputElement).files?.length === 1) || null, "native resume upload");
  await waitFor(async () => await page.locator("#native-cover").evaluate((element) => (element as HTMLInputElement).files?.length === 1) || null, "native cover-letter upload");
  assert.deepEqual(await page.locator("#native-resume").evaluate((element) => {
    const file = (element as HTMLInputElement).files?.[0]; return file ? { name: file.name, type: file.type, size: file.size } : null;
  }), { name: "Ada-resume.pdf", type: "application/pdf", size: pdfBytes.byteLength });
  assert.deepEqual(await page.locator("#native-cover").evaluate((element) => {
    const file = (element as HTMLInputElement).files?.[0]; return file ? { name: file.name, type: file.type, size: file.size } : null;
  }), { name: "Ada-cover-letter.pdf", type: "application/pdf", size: pdfBytes.byteLength });

  await page.goto(`${fixtureOrigin}/documents-custom`); await waitForRuntime(worker, "/documents-custom", 1); await page.bringToFront();
  assert.equal(await page.locator("#custom-resume").isHidden(), true);
  await executeActive(panel);
  await waitFor(async () => await page.locator("#custom-resume").evaluate((element) => (element as HTMLInputElement).files?.[0]?.name === "Ada-resume.pdf") || null, "hidden custom resume upload");

  await page.goto(`${fixtureOrigin}/documents-rejected`); await waitForRuntime(worker, "/documents-rejected", 1); await page.bringToFront();
  await executeActive(panel);
  assert.equal(await page.locator("#rejected-resume").evaluate((element) => (element as HTMLInputElement).files?.length ?? 0), 0);
  await waitFor(async () => {
    const runtime = await runtimeForPath(worker, "/documents-rejected");
    return Number((runtime?.lastExecution as { failed?: number } | undefined)?.failed ?? 0) >= 1 || null;
  }, "rejected upload receipt");

  const conditionalStart = executionRequests.length;
  await page.goto(`${fixtureOrigin}/conditional`); await waitForRuntime(worker, "/conditional", 1); await page.bringToFront();
  await executeActive(panel);
  await waitFor(async () => (await page.locator("#conditional-notice").inputValue().catch(() => "")) === "30" || null, "conditional reveal continuation");
  assert.equal(await page.locator("input[name=sponsorship][value=yes]").isChecked(), true);
  const conditionalRequests = executionRequests.slice(conditionalStart);
  assert.ok(new Set(conditionalRequests.map((request) => request.graph.graphRevision)).size >= 2);
  assert.ok(conditionalRequests.some((request) => request.intelligence.fields.some((field) => field.labelEvidence.some((label) => /notice period/i.test(label)))));
  await page.locator("input[name=sponsorship][value=no]").check();
  await waitFor(async () => await page.locator("#conditional-notice").isHidden() || null, "conditional hide");
  const hiddenPlanStart = executionRequests.length;
  await executeActive(panel);
  await waitFor(async () => executionRequests.length > hiddenPlanStart || null, "hidden-branch replan");
  assert.equal(executionRequests.slice(hiddenPlanStart).some((request) => request.intelligence.fields.some((field) => field.fieldRuntimeId === conditionalRequests.at(-1)?.intelligence.fields.find((candidate) => candidate.labelEvidence.some((label) => /notice period/i.test(label)))?.fieldRuntimeId)), false);

  const nestedStart = executionRequests.length;
  await page.goto(`${fixtureOrigin}/nested`); await waitForRuntime(worker, "/nested", 1); await page.bringToFront();
  await executeActive(panel);
  await waitFor(async () => (await page.locator("#nested-notice").inputValue().catch(() => "")) === "30" || null, "nested conditional continuation");
  const nestedRequests = executionRequests.slice(nestedStart);
  assert.ok(new Set(nestedRequests.map((request) => request.graph.graphRevision)).size >= 3);
  assert.equal(await page.locator("input[name=authorized][value=yes]").isChecked(), true);
  assert.equal(await page.locator("input[name=sponsorship][value=yes]").isChecked(), true);

  const optionStart = executionRequests.length;
  await page.goto(`${fixtureOrigin}/dependent-options`); await waitForRuntime(worker, "/dependent-options", 2); await page.bringToFront();
  await executeActive(panel);
  await waitFor(async () => (await page.locator("#preferred option:checked").allTextContents()).includes("Bengaluru") || null, "dependent option continuation");
  assert.equal(await page.locator("#country").inputValue(), "India");
  const optionRequests = executionRequests.slice(optionStart);
  assert.ok(optionRequests.some((request) => request.graph.edges.some((edge) => edge.edgeType === "OPTIONS_DEPEND_ON")));
  assert.ok(optionRequests.length >= 2);

  const automaticRepeatStart = executionPlans.length;
  await page.goto(`${fixtureOrigin}/auto-repeatable`); await waitForRuntime(worker, "/auto-repeatable", 2); await page.bringToFront();
  await executeActive(panel);
  try {
    await waitFor(async () => (await page.locator("#auto-previous-title").inputValue().catch(() => "")) === "Engineer" || null, "automatic Add Another and M continuation");
  } catch {
    throw new Error(`Automatic repeat diagnostics: ${JSON.stringify(executionPlans.slice(automaticRepeatStart).map((plan) => ({ revision: plan.graphGuard.graphRevision, operations: plan.operations.map((item) => item.canonicalKey), actions: plan.actions.map((item) => [item.actionKind, item.authorization]), skipped: plan.skipped })))}`);
  }
  assert.equal(await page.locator("#auto-current-title").inputValue(), "Senior Engineer");
  assert.ok(executionPlans.some((plan) => plan.actions.some((action) => action.actionKind === "ADD_REPEAT" && action.authorization === "AUTO_SAFE")));

  const requiredStart = executionRequests.length;
  await page.goto(`${fixtureOrigin}/requiredness`); await waitForRuntime(worker, "/requiredness", 1); await page.bringToFront();
  await executeActive(panel);
  await waitFor(async () => (await page.locator("#required-notice").inputValue().catch(() => "")) === "30" || null, "requiredness continuation");
  assert.equal(await page.locator("#required-notice").getAttribute("aria-required"), "true");
  assert.ok(executionRequests.slice(requiredStart).some((request) => request.graph.nodes.some((node) => node.fieldRuntimeId && node.required && node.visible)));

  await page.goto(`${fixtureOrigin}/validation`); await waitForRuntime(worker, "/validation", 1); await page.bringToFront();
  await page.locator("#validation-next").click();
  const validationRecord = await waitFor(async () => {
    const record = await runtimeForPath(worker, "/validation");
    const graph = record?.lastGraph as { stable?: boolean } | undefined;
    return graph && graph.stable === true && await page.locator('[role="alert"]').count() === 1 ? record : null;
  }, "validation graph gate");
  assert.equal((validationRecord.lastStepTransition as unknown | null) ?? null, null);
  assert.equal(await page.locator("#validation-email").getAttribute("aria-invalid"), "true");

  await page.goto(`${fixtureOrigin}/multi-step/step/1`); await waitForRuntime(worker, "/multi-step/step/1", 1); await page.bringToFront();
  const firstStepRecord = await runtimeForPath(worker, "/multi-step/step/1");
  const firstIdentity = firstStepRecord?.identity as { applicationRunId?: string } | undefined;
  await executeActive(panel);
  await waitFor(async () => (await page.locator("#multi-email").inputValue()) === "ada@example.test" || null, "multi-step first page fill");
  await page.locator("#multi-next").click();
  await waitForRuntime(worker, "/multi-step/step/2", 1);
  const secondStepRecord = await runtimeForPath(worker, "/multi-step/step/2");
  const secondIdentity = secondStepRecord?.identity as { applicationRunId?: string } | undefined;
  assert.equal(secondIdentity?.applicationRunId, firstIdentity?.applicationRunId);
  assert.ok(((secondStepRecord?.stepHistory as unknown[] | undefined)?.length ?? 0) >= 2, JSON.stringify({
    first: firstStepRecord,
    second: secondStepRecord
  }));
  assert.equal((secondStepRecord?.lastStepTransition as { expected?: boolean } | null)?.expected, true);
  await page.bringToFront();
  await executeActive(panel);
  await waitFor(async () => (await page.locator("#multi-notice").inputValue()) === "30" || null, "multi-step second page fill");

  await page.goto(`${fixtureOrigin}/manual-branch`); await waitForRuntime(worker, "/manual-branch", 1); await page.bringToFront();
  await page.locator("input[name=sponsorship][value=yes]").check();
  await waitFor(async () => await page.locator("#manual-notice").isVisible() || null, "manual branch reveal");
  await waitForRuntime(worker, "/manual-branch", 2);
  await executeActive(panel);
  await waitFor(async () => (await page.locator("#manual-notice").inputValue()) === "30" || null, "manual branch safe continuation");
  assert.equal(await page.locator("input[name=sponsorship][value=yes]").isChecked(), true);

  await page.goto(`${fixtureOrigin}/rerender`); await waitForRuntime(worker, "/rerender", 1); await page.bringToFront();
  const beforeRerender = await runtimeForPath(worker, "/rerender");
  const beforeGraph = beforeRerender?.lastGraph as { graphRevision?: number; graphFingerprint?: string; at?: string } | undefined;
  const rerenderPlanStart = executionRequests.length;
  await page.locator("#rerender").click();
  await executeActive(panel);
  await waitFor(async () => (await page.locator("#rerender-email").inputValue()) === "ada@example.test" || null, "equivalent SPA container rerender");
  const afterRerenderPlan = executionRequests.slice(rerenderPlanStart)[0];
  assert.equal(afterRerenderPlan?.graph.graphRevision, beforeGraph?.graphRevision);
  assert.equal(afterRerenderPlan?.graph.graphFingerprint, beforeGraph?.graphFingerprint);

  const cdp = await context.newCDPSession(page);
  const targets = await cdp.send("Target.getTargets");
  const serviceWorkerTarget = targets.targetInfos.find((target) => target.type === "service_worker" && target.url.startsWith(`chrome-extension://${extensionId}/`));
  assert.ok(serviceWorkerTarget);
  await cdp.send("Target.closeTarget", { targetId: serviceWorkerTarget.targetId });
  await page.reload();
  worker = await extensionWorker(context);
  worker.on("console", (entry) => { if (entry.type() === "error") browserErrors.push(`worker:${entry.text()}`); });
  await waitForRuntime(worker, "/rerender", 1);
  const recoveredGraph = (await runtimeForPath(worker, "/rerender"))?.lastGraph as { stable?: boolean } | undefined;
  assert.equal(recoveredGraph?.stable, true);

  await page.goto(`${fixtureOrigin}/cycle`); await waitForRuntime(worker, "/cycle", 2); await page.bringToFront();
  await executeActive(panel);
  const cycleRecord = await runtimeForPath(worker, "/cycle");
  assert.equal((cycleRecord?.lastGraph as { stable?: boolean } | undefined)?.stable, false);
  assert.equal(await page.locator("#cycle-a").inputValue(), "");
  assert.deepEqual(await page.locator("#cycle-b option:checked").allTextContents(), []);

  await page.goto(`${fixtureOrigin}/ambiguous-option`); await waitForRuntime(worker, "/ambiguous-option", 1); await page.bringToFront();
  await panel.evaluate(async () => chrome.runtime.sendMessage({ protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: null, sentAt: new Date().toISOString(), source: "SIDEPANEL", type: "UI_EXECUTE_ACTIVE_TAB", dataClass: "STRUCTURAL", payload: {} }));
  assert.equal(await page.locator("#location").inputValue(), "");

  await page.goto(`${fixtureOrigin}/interrupt`); await waitForRuntime(worker, "/interrupt", 1); await page.bringToFront();
  const interrupted = panel.evaluate(async () => chrome.runtime.sendMessage({ protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: null, sentAt: new Date().toISOString(), source: "SIDEPANEL", type: "UI_EXECUTE_ACTIVE_TAB", dataClass: "STRUCTURAL", payload: {} })) as Promise<{ ok: boolean }>;
  await waitFor(async () => (await page.locator("#company").inputValue()) === "Vidyakul" || null, "combobox strategy to start");
  await page.locator("#company").click(); await page.locator("#company").press("ControlOrMeta+A"); await page.locator("#company").pressSequentially("Other"); await interrupted;
  assert.equal(await page.locator("#company").inputValue(), "Other");
  assert.equal(await page.locator("#company").getAttribute("data-committed"), null);

  await page.goto(`${fixtureOrigin}/spa-stale`); await waitForRuntime(worker, "/spa-stale", 1); await page.bringToFront();
  const stale = panel.evaluate(async () => chrome.runtime.sendMessage({ protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: null, sentAt: new Date().toISOString(), source: "SIDEPANEL", type: "UI_EXECUTE_ACTIVE_TAB", dataClass: "STRUCTURAL", payload: {} }));
  await waitFor(async () => (await page.locator("#company").inputValue()) === "Vidyakul" || null, "stale operation to start");
  await page.evaluate(`history.pushState({},'', '/spa-stale/next');document.querySelector('#root').innerHTML='<form><label>Email address<input id="new-email" type="email" name="email"></label></form>'`);
  await stale;
  assert.equal(await page.locator("#new-email").inputValue(), "");

  await page.goto(`${fixtureOrigin}/repeatable`); await waitForRuntime(worker, "/repeatable", 6); await page.bringToFront();
  await panel.evaluate(async () => chrome.runtime.sendMessage({ protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: null, sentAt: new Date().toISOString(), source: "SIDEPANEL", type: "UI_EXECUTE_ACTIVE_TAB", dataClass: "STRUCTURAL", payload: {} }));
  await waitFor(async () => (await page.locator("#education-degree").inputValue()) === "B.Tech" || null, "repeatable entity execution");
  assert.equal(await page.locator("#current-company").inputValue(), "Same Company");
  assert.equal(await page.locator("#current-title").inputValue(), "Senior Engineer");
  assert.equal(await page.locator("#previous-company").inputValue(), "Same Company");
  assert.equal(await page.locator("#previous-title").inputValue(), "Engineer");
  assert.equal(await page.locator("#education-school").inputValue(), "University A");
  await page.getByRole("button", { name: "Reorder history" }).click();
  await waitFor(async () => await page.locator("#current-company").count() === 1 || null, "repeat group reorder");
  assert.equal(await page.locator("#current-title").inputValue(), "Senior Engineer");
  assert.equal(await page.locator("#previous-title").inputValue(), "Engineer");
  const repeatableRequests = intelligenceRequests.filter((request) => request.pageContext.host === "127.0.0.1" && request.fields.some((field) => field.repeatableEvidence.formGroup));
  const latestRepeatable = repeatableRequests.at(-1)!;
  const groupBindings = latestRepeatable.fields.filter((field) => field.repeatableEvidence.formGroup).map((field) => field.repeatableEvidence.formGroup!);
  assert.equal(new Set(groupBindings.map((group) => group.formRepeatGroupId)).size, 3);
  assert.equal(groupBindings.every((group) => group.identityKind === "STABLE_DOM"), true);
  await page.getByRole("button", { name: "Remove previous" }).click();
  await waitFor(async () => await page.locator("#previous-company").count() === 0 || null, "repeat group deletion");
  assert.equal(await page.locator("#current-title").inputValue(), "Senior Engineer");
  await page.getByRole("button", { name: "Add another experience" }).click();
  await waitFor(async () => await page.locator("#previous-company").count() === 1 || null, "dynamic repeat group insertion");
  await panel.evaluate(async () => chrome.runtime.sendMessage({ protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: null, sentAt: new Date().toISOString(), source: "SIDEPANEL", type: "UI_EXECUTE_ACTIVE_TAB", dataClass: "STRUCTURAL", payload: {} }));
  await waitFor(async () => (await page.locator("#previous-title").inputValue()) === "Engineer" || null, "inserted repeat group execution");
  assert.equal(await page.locator("#current-title").inputValue(), "Senior Engineer");

  const stored = await worker.evaluate(async () => ({ session: await chrome.storage.session.get(null), local: await chrome.storage.local.get(null) }));
  const serializedStorage = JSON.stringify(stored);
  for (const privateValue of ["ada@example.test", "Backend engineer building reliable systems.", "https://portfolio.example.test/ada"]) assert.equal(serializedStorage.includes(privateValue), false);
  assert.equal(JSON.stringify(executionRequests).includes("ada@example.test"), false);
  assert.ok(intelligenceRequests.length >= 6);
  assert.ok(executionRequests.length >= 5);
  const telemetry = await worker.evaluate(async () => {
    const local = await chrome.storage.local.get("jobHunter.extension.telemetry.v1");
    return local["jobHunter.extension.telemetry.v1"] as unknown[] | undefined;
  });
  const documentOperations = executionPlans.flatMap((plan) => plan.operations)
    .filter((operation) => operation.representation.kind === "FILE");
  assert.ok(documentSelections.filter((kind) => kind === "RESUME").length >= 3);
  assert.ok(documentSelections.includes("COVER_LETTER"));
  assert.ok(documentOperations.some((operation) => operation.canonicalKey === "RESUME" && operation.documentAuthority?.documentId === resumeDocumentId));
  assert.ok(documentOperations.some((operation) => operation.canonicalKey === "COVER_LETTER" && operation.documentAuthority?.documentId === coverDocumentId));
  assert.equal(serializedStorage.includes("bytesBase64"), false);
  assert.equal(JSON.stringify(telemetry ?? []).includes("ada@example.test"), false);
  assert.equal(browserErrors.length, 0, browserErrors.join("\n"));
  if (process.env.PHASE_Q_BROWSER === "true") {
    assert.ok(executionPlans.some((plan) => plan.operations.some((op) => op.strategySelection?.strategies[0]?.key === "Q_OFFLINE_NATIVE_TEXT@1")));
    process.stdout.write("Q restricted native-text candidate passed the controlled K/N regression fixtures without native fallback; lifecycle rollout is not certified by this smoke test.\n");
  }
  process.stdout.write(`Phase K/N/R browser smoke passed: ${executionRequests.length} transient plans; ordinary fields, exact document uploads, hidden upload controls, upload rejection, conditional, nested, option-dependent, repeatable, requiredness, validation, multi-step, manual, rerender, recovery and cycle behavior verified.\n`);
  }
} finally {
  await context?.close().catch(() => undefined);
  await Promise.all([close(fixtureServer), close(apiServer)]);
  await rm(profile, { recursive: true, force: true });
}

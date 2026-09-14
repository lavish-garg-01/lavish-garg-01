import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright";
import { ResolveFieldIntelligenceRequestSchema, type ResolveFieldIntelligenceRequest, type ResolveFieldIntelligenceResponse } from "@job-hunter-v2/contracts";
import type { CandidateTruthResolution, ResolveCandidateTruthInput } from "@job-hunter-v2/candidate-truth";
import { FieldIntelligenceService, FieldSemanticResolver } from "@job-hunter-v2/field-intelligence";
import { AiOrchestrator, type ProviderAdapter } from "@job-hunter-v2/ai";
import { fieldAiBridge } from "../apps/api/src/ai-bridges.js";

const fixtureOrigin = "http://127.0.0.1:43201";
const apiOrigin = "http://127.0.0.1:43210";
const extensionPath = process.env.EXTENSION_OUTPUT_DIR
  ? resolve(new URL("..", import.meta.url).pathname, process.env.EXTENSION_OUTPUT_DIR)
  : resolve(new URL("../apps/extension/dist", import.meta.url).pathname);
const accountId = "10000000-0000-4000-8000-000000000081";
const candidateId = "20000000-0000-4000-8000-000000000081";
const answerVersionId = "40000000-0000-4000-8000-000000000081";

function html(ats: string, body: string, script = ""): string {
  return `<!doctype html><html data-ats="${ats}"><head><meta charset="utf-8"><title>${ats} semantic fixture</title></head><body data-ats="${ats}"><main><h1>Software Engineer application</h1>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

function fixture(path: string): string {
  if (path === "/web") return html("GENERIC", "<p>Connect the extension.</p>");
  if (path === "/greenhouse") return html("GREENHOUSE", `
    <form><section><h2>Personal information</h2>
      <label>First name<input name="first_name" autocomplete="given-name"></label>
      <label>Email address<input name="email" type="email" autocomplete="email"></label>
      <label>LinkedIn profile URL<input name="linkedin"></label>
      <label>Resume<input name="resume" type="file"></label>
    </section><fieldset><legend>Are you legally authorized to work in India?</legend>
      <label><input name="authorized" type="radio" value="yes">Yes</label>
      <label><input name="authorized" type="radio" value="no">No</label>
    </fieldset><button type="button">Continue</button></form>`);
  if (path === "/lever") return html("LEVER", `
    <form><section><h2>Current employment</h2>
      <label>Current employer<input name="company"></label>
      <label>Current annual compensation<input type="number" name="current_ctc"></label>
      <label>Expected CTC<input type="number" name="expected_ctc"></label>
      <label>Notice period in days<input type="number" name="notice"></label>
    </section><fieldset><legend>Will you require visa sponsorship now or in the future?</legend>
      <label><input type="radio" name="sponsor" value="yes">Yes</label><label><input type="radio" name="sponsor" value="no">No</label>
    </fieldset><label><input type="checkbox" name="privacy">I acknowledge the applicant privacy notice</label></form>`);
  if (path === "/workday") return html("WORKDAY", `
    <form><section><h2>Work history</h2>
      <div class="experience-item" data-repeatable-item="employment-alpha"><h3>Work experience 1</h3><label>Company<input name="company-1"></label><label>Job title<input name="title-1"></label></div>
      <div class="experience-item" data-repeatable-item="employment-beta"><h3>Work experience 2</h3><label>Company<input name="company-2"></label><label>Job title<input name="title-2"></label></div>
    </section><section><h2>Education</h2>
      <div class="education-item" data-repeatable-item="education-alpha"><h3>Education 1</h3><label>University<input name="school"></label><label>Degree<input name="degree"></label></div>
    </section><label>Work item<input name="not-authorization"></label></form>`);
  if (path === "/ambiguous") return html("CUSTOM", `<form><label>Are you authorized to work?<input name="authorization"></label><label>Favorite color<input name="favorite"></label></form>`);
  if (path === "/application/dynamic") return html("CUSTOM", `<div id="target">Loading…</div>`, `setTimeout(()=>{document.querySelector('#target').innerHTML='<form><label>Mobile number<input type="tel" name="phone"></label><label>Professional summary<textarea name="summary"></textarea></label></form>'},300);`);
  if (path === "/spa" || path === "/spa/step-2") return html("CUSTOM", `<div id="root"><form><label>Current job title<input name="title"></label><button type="button" id="next">Next</button></form></div>`, `document.querySelector('#next').addEventListener('click',()=>{history.pushState({},'', '/spa/step-2');document.querySelector('#root').innerHTML='<form><label>Expected salary<input type="number" name="expected"></label><label>When can you start?<input type="date" name="start"></label></form>'});`);
  return html("GENERIC", "<p>Not found</p>");
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let value = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { value += chunk; });
    request.on("end", () => resolvePromise(value));
    request.on("error", reject);
  });
}

function listen(port: number, handler: (request: IncomingMessage) => Promise<{ status?: number; body: string; contentType?: string }>): Promise<Server> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer((request, response) => {
      void handler(request).then((result) => {
        response.writeHead(result.status ?? 200, { "content-type": result.contentType ?? "text/html; charset=utf-8", "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type" });
        response.end(result.body);
      }).catch((reason) => { response.writeHead(500); response.end(reason instanceof Error ? reason.message : "error"); });
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise(server));
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}

async function waitFor<T>(read: () => Promise<T | null | false>, label: string, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 75));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers().find((worker) => worker.url().startsWith("chrome-extension://")) ?? context.waitForEvent("serviceworker");
}

function structuralHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16_777_619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function intelligenceFor(worker: Worker, path: string, minimumItems: number): Promise<ResolveFieldIntelligenceResponse> {
  const pathHash = structuralHash(`${fixtureOrigin}${path}`);
  return waitFor(async () => {
    const observed = await worker.evaluate(async ({ expectedPathHash, minimum }) => {
    const runtime = await chrome.storage.session.get(["jobHunter.extension.runtimes.v1", "jobHunter.extension.fieldIntelligence.v1"]);
    const records = (runtime["jobHunter.extension.runtimes.v1"] ?? {}) as Record<string, Record<string, unknown>>;
    const results = (runtime["jobHunter.extension.fieldIntelligence.v1"] ?? {}) as Record<string, ResolveFieldIntelligenceResponse>;
    const key = Object.entries(records).find(([, record]) => record.pathHash === expectedPathHash)?.[0];
    const result = key ? results[key] : null;
    const pageInstanceId = key ? (records[key]?.identity as { pageInstanceId?: string } | undefined)?.pageInstanceId : null;
    return result && result.items.length >= minimum ? { result, pageInstanceId } : null;
    }, { expectedPathHash: pathHash, minimum: minimumItems });
    if (!observed) return null;
    const matchingRequest = capturedRequests.find((request) => request.requestId === observed.result.requestId);
    if (!matchingRequest || matchingRequest.fields[0]?.pageInstanceId !== observed.pageInstanceId) return null;
    return observed.result;
  }, `${path} field intelligence`);
}

async function webMessage(page: Page, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serialized = JSON.stringify(message).replaceAll("<", "\\u003c");
  return page.evaluate(`(async () => {
    const input = ${serialized};
    const nonce = crypto.randomUUID();
    return new Promise((resolvePromise, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("bridge timeout")), 5000);
      const listener = (event) => {
        const data = event.data;
        if (event.source !== window || event.origin !== location.origin || !data || data.source !== "JOB_HUNTER_EXTENSION" || data.nonce !== nonce) return;
        clearTimeout(timeout); window.removeEventListener("message", listener); resolvePromise(data);
      };
      window.addEventListener("message", listener);
      window.postMessage({ source: "JOB_HUNTER_WEB", nonce, ...input }, location.origin);
    });
  })()`) as Promise<Record<string, unknown>>;
}

const candidateTruth = {
  resolve: async (input: ResolveCandidateTruthInput): Promise<CandidateTruthResolution> => input.canonicalKey === "EMAIL"
    ? {
        status: "RESOLVED", canonicalKey: input.canonicalKey, answerVersionId,
        normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: "private-candidate@example.test" },
        scope: { scopeType: "GLOBAL", scopeKey: "scope=GLOBAL", scopeFingerprint: "a".repeat(64), precedence: 100 },
        trustState: "TRUSTED", trialReuse: false, requiresUserReview: false, autofillMode: "AUTO", expiresAt: null,
        reasonCodes: ["BEST_COMPATIBLE_SCOPE", "ANSWER_HAS_NO_EXPIRY"], candidateVersionIds: [answerVersionId]
      }
    : { status: "MISSING", canonicalKey: input.canonicalKey, reasonCodes: ["NO_COMPATIBLE_CANDIDATE_TRUTH"] }
};
const phaseP = process.env.PHASE_P_BROWSER === "true";
const providerCalls: string[] = [];
const fixtureProviders: ProviderAdapter[] = (["GROQ", "OPENAI"] as const).map((provider) => ({
  provider, model: "fixture-schema-failure", privacy: ["FIELD_METADATA_ONLY"], maxInputTokens: 50_000,
  inputMicrosPerToken: 0, outputMicrosPerToken: 0,
  execute: async () => {
    providerCalls.push(provider);
    return { value: { selectedCanonical: "INVENTED_CANONICAL", confidence: 1, ambiguous: false,
      ranking: [], reasonCategory: "LABEL_CONTEXT" }, usage: { inputTokens: 10, outputTokens: 10 } };
  }
}));
const ai = new AiOrchestrator(fixtureProviders);
const service = new FieldIntelligenceService(new FieldSemanticResolver(phaseP ? fieldAiBridge(ai) : null), candidateTruth);
const capturedRequests: ResolveFieldIntelligenceRequest[] = [];
const fixtureServer = await listen(43201, async (request) => ({ body: fixture(new URL(request.url ?? "/", fixtureOrigin).pathname) }));
const apiServer = await listen(43210, async (request) => {
  const path = new URL(request.url ?? "/", apiOrigin).pathname;
  if (request.method === "OPTIONS") return { status: 204, body: "" };
  if (path === "/v1/auth/session") return { body: JSON.stringify({
    email: "phase-j-browser@example.test", account: { type: "TEST", role: "OWNER" }, candidate: { id: candidateId, new: false },
    onboarding: { stage: "READY", completed: true, version: 1, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() }
  }), contentType: "application/json" };
  if (path === "/v1/field-intelligence/resolve" && request.method === "POST") {
    const parsed = ResolveFieldIntelligenceRequestSchema.parse(JSON.parse(await readBody(request)));
    capturedRequests.push(parsed);
    return { body: JSON.stringify(await service.resolve({ accountId, candidateId, request: parsed })), contentType: "application/json" };
  }
  return { status: 404, body: JSON.stringify({ error: "not found" }), contentType: "application/json" };
});

const profile = await mkdtemp(join(tmpdir(), "job-hunter-phase-j-"));
let context: BrowserContext | null = null;
const browserErrors: string[] = [];

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  const worker = await extensionWorker(context);
  worker.on("console", (entry) => { if (entry.type() === "error") browserErrors.push(`worker:${entry.text()}`); });
  const page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(`page:${error.message}`));
  page.on("console", (entry) => { if (entry.type() === "error") browserErrors.push(`page:${entry.text()}`); });

  await page.goto(`${fixtureOrigin}/web`);
  const connected = await webMessage(page, { type: "JOB_HUNTER_SESSION_OFFER", accessToken: "phase-j-browser-token-123456789" });
  assert.equal(connected.authState, "READY");

  await page.goto(`${fixtureOrigin}/greenhouse`);
  const greenhouse: ResolveFieldIntelligenceResponse = await intelligenceFor(worker, "/greenhouse", 6);
  const greenhouseKeys = new Set(greenhouse.items.map((item) => item.semantic.canonicalKey).filter(Boolean));
  for (const key of ["FIRST_NAME", "EMAIL", "LINKEDIN_URL", "RESUME", "WORK_AUTHORIZATION"]) assert.ok(greenhouseKeys.has(key), key);
  assert.equal(greenhouse.items.find((item) => item.semantic.canonicalKey === "EMAIL")?.answer.status, "AVAILABLE_REUSABLE");
  assert.equal(await page.locator("input:not([type=file])").evaluateAll((inputs) => inputs.every((input) => {
    const element = input as HTMLInputElement;
    return element.value === element.defaultValue && element.checked === element.defaultChecked;
  })), true);

  await page.goto(`${fixtureOrigin}/lever`);
  const lever = await intelligenceFor(worker, "/lever", 7);
  const leverKeys = new Set(lever.items.map((item) => item.semantic.canonicalKey).filter(Boolean));
  for (const key of ["CURRENT_COMPANY", "CURRENT_CTC", "EXPECTED_CTC", "NOTICE_PERIOD", "SPONSORSHIP_REQUIRED", "PRIVACY_ACKNOWLEDGEMENT"]) assert.ok(leverKeys.has(key), key);

  await page.goto(`${fixtureOrigin}/workday`);
  const workday = await intelligenceFor(worker, "/workday", 7);
  assert.equal(workday.items.filter((item) => item.semantic.canonicalKey === "EMPLOYMENT_COMPANY").length, 2);
  assert.equal(workday.items.filter((item) => item.semantic.canonicalKey === "EMPLOYMENT_TITLE").length, 2);
  const entityKeys = workday.items.filter((item) => item.semantic.canonicalKey?.startsWith("EMPLOYMENT_")).map((item) => item.semantic.entityBinding.instanceKey);
  assert.deepEqual(new Set(entityKeys), new Set(["employment-alpha", "employment-beta"]));
  const employmentGroups = workday.items
    .filter((item) => item.semantic.canonicalKey === "EMPLOYMENT_COMPANY")
    .map((item) => item.semantic.entityBinding.formGroup);
  assert.equal(employmentGroups.every((group) => group?.identityKind === "STABLE_DOM"), true);
  assert.equal(new Set(employmentGroups.map((group) => group?.formRepeatGroupId)).size, 2);
  assert.equal(employmentGroups.every((group) => group?.structuralFingerprint.length === 64), true);
  assert.equal(workday.items.some((item) => item.semantic.canonicalKey === "WORK_AUTHORIZATION" && item.semantic.state.startsWith("RESOLVED")), false);

  await page.goto(`${fixtureOrigin}/ambiguous`);
  const ambiguous = await intelligenceFor(worker, "/ambiguous", 2);
  assert.ok(ambiguous.items.some((item) => item.semantic.errorCodes.includes("FIELD_CONTEXT_INSUFFICIENT")));
  assert.ok(ambiguous.items.some((item) => item.semantic.errorCodes.includes("NO_CANONICAL_CANDIDATE")));

  await page.goto(`${fixtureOrigin}/application/dynamic`);
  const dynamic = await intelligenceFor(worker, "/application/dynamic", 2);
  assert.ok(dynamic.items.some((item) => item.semantic.canonicalKey === "PHONE"));
  assert.ok(dynamic.items.some((item) => item.semantic.canonicalKey === "PERSONAL_SUMMARY"));

  await page.goto(`${fixtureOrigin}/spa`);
  await intelligenceFor(worker, "/spa", 1);
  await page.getByRole("button", { name: "Next" }).click();
  const spa = await intelligenceFor(worker, "/spa/step-2", 2);
  assert.ok(spa.items.some((item) => item.semantic.canonicalKey === "EXPECTED_CTC"));
  assert.ok(spa.items.some((item) => item.semantic.canonicalKey === "START_DATE"));

  const serializedRequests = JSON.stringify(capturedRequests);
  assert.equal(serializedRequests.includes("private-candidate@example.test"), false);
  assert.equal(serializedRequests.includes("normalizedValue"), false);
  const extensionStorage = await worker.evaluate(async () => ({ session: await chrome.storage.session.get(null), local: await chrome.storage.local.get(null) }));
  const serializedStorage = JSON.stringify(extensionStorage);
  assert.equal(serializedStorage.includes("private-candidate@example.test"), false);
  assert.equal(serializedStorage.includes("normalizedValue"), false);
  assert.equal(browserErrors.length, 0, browserErrors.join("\n"));
  if (phaseP) {
    assert.ok(providerCalls.includes("GROQ") && providerCalls.includes("OPENAI"), "P should attempt bounded primary/fallback for ambiguous fields");
    assert.equal(JSON.stringify(ai.snapshot()).includes("private-candidate@example.test"), false);
    assert.ok(ai.snapshot().events.every((e) => e.attempts.length <= 2));
    assert.ok(ai.snapshot().events.some((e) => e.status === "REJECTED"));
    process.stdout.write("Phase P browser integration passed: malformed primary/fallback output rejected; deterministic fields, auth, SPA, privacy and graceful degradation preserved.\n");
  }
  process.stdout.write(`Phase J browser smoke passed: ${capturedRequests.length} value-free semantic batches across Greenhouse, Lever, Workday, ambiguous, dynamic and SPA fixtures.\n`);
} finally {
  await context?.close().catch(() => undefined);
  await Promise.all([close(fixtureServer), close(apiServer)]);
  await rm(profile, { recursive: true, force: true });
}

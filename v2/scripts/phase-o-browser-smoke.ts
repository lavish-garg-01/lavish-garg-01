import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright";
import {
  ExecutionPlanRequestSchema,
  RecordDeclarationEvidenceRequestSchema,
  RecordExecutionEvidenceRequestSchema,
  ResolveFieldIntelligenceRequestSchema,
  StartLearningRunRequestSchema,
  type RecordDeclarationEvidenceRequest
} from "@job-hunter-v2/contracts";
import type { CandidateTruthResolution, PersistableNormalizedValue, ResolveCandidateTruthInput } from "@job-hunter-v2/candidate-truth";
import { DeclarationPolicyEngine, DeclarationPolicyService, type DeclarationEvidenceCommand } from "@job-hunter-v2/declaration-policy";
import { ExecutionPlanningService } from "@job-hunter-v2/execution";
import { FieldIntelligenceService, FieldSemanticResolver } from "@job-hunter-v2/field-intelligence";
import { AiOrchestrator } from "@job-hunter-v2/ai";
import { fieldAiBridge } from "../apps/api/src/ai-bridges.js";

const fixtureOrigin = "http://127.0.0.1:43501";
const apiOrigin = "http://127.0.0.1:43510";
const extensionPath = process.env.EXTENSION_OUTPUT_DIR
  ? resolve(new URL("..", import.meta.url).pathname, process.env.EXTENSION_OUTPUT_DIR)
  : resolve(new URL("../apps/extension/dist", import.meta.url).pathname);
const accountId = "10000000-0000-4000-8000-000000000190";
const candidateId = "20000000-0000-4000-8000-000000000190";
const jobId = "30000000-0000-4000-8000-000000000190";
const answerVersionId = "40000000-0000-4000-8000-000000000190";
const policyEvidence: DeclarationEvidenceCommand[] = [];
const runtimeEvidence: RecordDeclarationEvidenceRequest[] = [];
const ordinaryExecutionCanonicals: string[] = [];
const plans: Array<Awaited<ReturnType<ExecutionPlanningService["plan"]>>> = [];
const truthCalls: string[] = [];
let staleRequested = false;

function html(body: string, script = ""): string {
  return `<!doctype html><html data-ats="GREENHOUSE"><head><meta charset="utf-8"><title>Phase O fixture</title></head><body data-ats="GREENHOUSE"><main><h1>Declaration policy application</h1>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

function declarationForm(suffix: string): string {
  return html(`
    <form id="application-${suffix}">
      <fieldset><legend>Candidate facts</legend><label><input id="adult-${suffix}" type="checkbox" name="adult">Are you at least 18 years old?</label></fieldset>
      <section aria-label="Declarations and acknowledgements">
        <label><input id="accuracy-${suffix}" type="checkbox" name="accuracy" required>information is accurate</label>
        <label><input id="privacy-${suffix}" type="checkbox" name="privacy">I acknowledge privacy notice</label>
        <label><input id="terms-${suffix}" type="checkbox" name="terms" required>agree to terms</label>
        <label><input id="background-${suffix}" type="checkbox" name="background" required>background check</label>
        <label><input id="processing-${suffix}" type="checkbox" name="processing">consent to processing my personal data</label>
        <label><input id="applicant-${suffix}" type="checkbox" name="applicant">applicant certification</label>
        <label><input id="eeo-${suffix}" type="checkbox" name="eeo">acknowledge eeo</label>
        <label><input id="specific-${suffix}" type="checkbox" name="specific">application specific acknowledgement</label>
        <label><input id="ambiguous-${suffix}" type="checkbox" name="ambiguous">I agree</label>
      </section>
      <button id="reveal-${suffix}" type="button">Show additional declaration</button>
      <section id="conditional-${suffix}" hidden><label><input id="conditional-privacy-${suffix}" type="checkbox" name="conditional_privacy">I acknowledge privacy notice</label></section>
    </form>`, `
      document.querySelector('#reveal-${suffix}').addEventListener('click',()=>{document.querySelector('#conditional-${suffix}').hidden=false});
    `);
}

function fixture(path: string): string {
  if (path === "/web") return html("<p>Connect Job Hunter.</p>");
  if (path === "/application-stale") return html(`
    <form><div id="stale-root"><label><input id="stale" type="checkbox" name="stale_certification">information is accurate</label></div></form>`, `
      let replaced=false;
      window.setInterval(async()=>{if(replaced)return;const state=await fetch('/mutation-state').then(response=>response.json());if(state.mutate){replaced=true;document.querySelector('#stale-root').innerHTML='<label><input id="stale" type="checkbox" name="stale_terms">agree to terms</label>'}},20);
    `);
  if (path === "/application-two") return declarationForm("two");
  return declarationForm("one");
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
    const server = createServer((request, response) => { void handler(request).then((result) => {
      response.writeHead(result.status ?? 200, {
        "content-type": result.contentType ?? "text/html; charset=utf-8",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "authorization,content-type,x-idempotency-key"
      });
      response.end(result.body);
    }).catch((reason) => { response.writeHead(500); response.end(reason instanceof Error ? reason.message : "error"); }); });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise(server));
  });
}

const close = (server: Server) => new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
async function waitFor<T>(read: () => Promise<T | null | false>, label: string, timeoutMs = 12_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 75));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
async function extensionWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers().find((item) => item.url().startsWith("chrome-extension://")) ?? context.waitForEvent("serviceworker");
}
async function webMessage(page: Page, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serialized = JSON.stringify(message).replaceAll("<", "\\u003c");
  return page.evaluate(`(async()=>{const input=${serialized};const nonce=crypto.randomUUID();return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('bridge timeout')),5000);const listener=(event)=>{const data=event.data;if(event.source!==window||event.origin!==location.origin||!data||data.source!=='JOB_HUNTER_EXTENSION'||data.nonce!==nonce)return;clearTimeout(timeout);removeEventListener('message',listener);resolve(data)};addEventListener('message',listener);postMessage({source:'JOB_HUNTER_WEB',nonce,...input},location.origin)})})()`) as Promise<Record<string, unknown>>;
}
async function runtimeRecords(worker: Worker) {
  return worker.evaluate(async () => Object.values(((await chrome.storage.session.get("jobHunter.extension.runtimes.v1"))["jobHunter.extension.runtimes.v1"] ?? {}) as Record<string, Record<string, unknown>>));
}
function runtimeForTab(records: Record<string, unknown>[], tabId: number): Record<string, unknown> | undefined {
  return records.find((record) => (record.identity as { tabId?: number }).tabId === tabId);
}
async function waitForIntelligence(worker: Worker, tabId: number, declarations: number): Promise<Record<string, unknown>> {
  return waitFor(async () => {
    const record = runtimeForTab(await runtimeRecords(worker), tabId);
    const summary = record?.lastIntelligence as { declarationCount?: number } | null;
    return (summary?.declarationCount ?? 0) >= declarations ? record ?? null : null;
  }, `tab ${tabId} declaration intelligence`);
}
async function launch(web: Page, applicationUrl: string): Promise<number> {
  const response = await webMessage(web, { type: "JOB_HUNTER_LAUNCH_APPLICATION", jobId, applicationUrl });
  const result = response.launch as { state?: string; tabId?: number } | undefined;
  assert.equal(result?.state, "READY_TO_LAUNCH", JSON.stringify(response));
  assert.equal(typeof result?.tabId, "number");
  return result!.tabId!;
}
async function executeActive(panel: Page): Promise<void> {
  const response = await panel.evaluate(async () => chrome.runtime.sendMessage({
    protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: null, sentAt: new Date().toISOString(),
    source: "SIDEPANEL", type: "UI_EXECUTE_ACTIVE_TAB", dataClass: "STRUCTURAL", payload: {}
  })) as { ok: boolean };
  assert.equal(response.ok, true);
}

const privateValue: PersistableNormalizedValue = { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "BOOLEAN", value: true };
const truth = {
  resolve: async (input: ResolveCandidateTruthInput): Promise<CandidateTruthResolution> => {
    truthCalls.push(input.canonicalKey);
    if (input.canonicalKey !== "AGE_OVER_18") return { status: "MISSING", canonicalKey: input.canonicalKey, reasonCodes: ["NO_COMPATIBLE_CANDIDATE_TRUTH"] };
    const scopeKey = "scope=GLOBAL";
    return {
      status: "RESOLVED", canonicalKey: input.canonicalKey, answerVersionId, normalizedValue: privateValue,
      scope: { scopeType: "GLOBAL", scopeKey, scopeFingerprint: createHash("sha256").update(scopeKey).digest("hex"), precedence: 100 },
      trustState: "TRUSTED", trialReuse: false, requiresUserReview: false, autofillMode: "AUTO", expiresAt: null,
      reasonCodes: ["BEST_COMPATIBLE_SCOPE"], candidateVersionIds: [answerVersionId]
    };
  }
};
const intelligence = new FieldIntelligenceService(new FieldSemanticResolver(fieldAiBridge(new AiOrchestrator([]))), truth);
const declarationPolicy = new DeclarationPolicyService(new DeclarationPolicyEngine(), {
  record: async (command) => {
    policyEvidence.push(command);
    return { evidenceId: command.request.evidenceEventId, idempotentReplay: false };
  }
});
const execution = new ExecutionPlanningService(intelligence, undefined, declarationPolicy);

const fixtureServer = await listen(43501, async (request) => {
  const path = new URL(request.url ?? "/", fixtureOrigin).pathname;
  if (path === "/mutation-state") return { body: JSON.stringify({ mutate: staleRequested }), contentType: "application/json" };
  return { body: fixture(path) };
});
const apiServer = await listen(43510, async (request) => {
  if (request.method === "OPTIONS") return { status: 204, body: "" };
  const path = new URL(request.url ?? "/", apiOrigin).pathname;
  if (path === "/v1/auth/session") return { body: JSON.stringify({
    email: "phase-o@example.test", account: { type: "TEST", role: "OWNER" }, candidate: { id: candidateId, new: false },
    onboarding: { stage: "READY", completed: true, version: 1, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() }
  }), contentType: "application/json" };
  const raw = request.method === "POST" ? JSON.parse(await readBody(request) || "{}") : {};
  if (path === "/v1/learning/runs") {
    const parsed = StartLearningRunRequestSchema.parse(raw);
    return { body: JSON.stringify({ schemaVersion: 1, requestId: parsed.requestId, applicationId: crypto.randomUUID(), applicationRunId: crypto.randomUUID(), status: "ACTIVE", idempotentReplay: false, containsCandidateValue: false }), contentType: "application/json" };
  }
  if (path === "/v1/field-intelligence/resolve") {
    const parsed = ResolveFieldIntelligenceRequestSchema.parse(raw);
    return { body: JSON.stringify(await intelligence.resolve({ accountId, candidateId, request: parsed })), contentType: "application/json" };
  }
  if (path === "/v1/execution/plan") {
    const parsed = ExecutionPlanRequestSchema.parse(raw);
    const plan = await execution.plan({ accountId, candidateId, request: parsed });
    plans.push(plan);
    if (parsed.intelligence.fields.some((field) => field.locatorEvidence.name === "stale_certification")) {
      staleRequested = true;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 180));
    }
    return { body: JSON.stringify(plan), contentType: "application/json" };
  }
  if (path === "/v1/declarations/evidence") {
    const parsed = RecordDeclarationEvidenceRequestSchema.parse(raw);
    runtimeEvidence.push(parsed);
    return { body: JSON.stringify({ schemaVersion: 1, requestId: parsed.requestId, evidenceId: parsed.evidenceEventId, idempotentReplay: false, valuePrivate: true, containsCandidateValue: false }), contentType: "application/json" };
  }
  if (path === "/v1/learning/execution-evidence") {
    const parsed = RecordExecutionEvidenceRequestSchema.parse(raw);
    ordinaryExecutionCanonicals.push(parsed.receipt.canonicalKey);
    return { body: JSON.stringify({ schemaVersion: 1, requestId: parsed.requestId, evidenceId: crypto.randomUUID(), idempotentReplay: false, containsCandidateValue: false }), contentType: "application/json" };
  }
  return { status: 404, body: JSON.stringify({ error: "not found" }), contentType: "application/json" };
});

const profile = await mkdtemp(join(tmpdir(), "job-hunter-phase-o-"));
let context: BrowserContext | null = null;
const errors: string[] = [];
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  const worker = await extensionWorker(context);
  worker.on("console", (entry) => { if (entry.type() === "error") errors.push(`worker:${entry.text()}`); });
  const extensionId = new URL(worker.url()).host;
  const web = await context.newPage();
  web.on("pageerror", (error) => errors.push(`web:${error.message}`));
  await web.goto(`${fixtureOrigin}/web`);
  await waitFor(async () => (await webMessage(web, { type: "JOB_HUNTER_WEB_PROBE" }).catch(() => null))?.installed === true || null, "extension bridge");
  assert.equal((await webMessage(web, { type: "JOB_HUNTER_SESSION_OFFER", accessToken: "phase-o-browser-token-123456789" })).authState, "READY");
  const panel = await context.newPage();
  panel.on("pageerror", (error) => errors.push(`panel:${error.message}`));
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const firstTabId = await launch(web, `${fixtureOrigin}/application-one`);
  const first = await waitFor(async () => context?.pages().find((page) => page.url().includes("/application-one")) ?? null, "first application tab");
  first.on("pageerror", (error) => errors.push(`application-one:${error.message}`));
  await first.bringToFront();
  await waitForIntelligence(worker, firstTabId, 9);
  assert.equal(await first.locator("#accuracy-one").isChecked(), false);
  await executeActive(panel);
  try {
    await waitFor(async () => await first.locator("#accuracy-one").isChecked() && await first.locator("#privacy-one").isChecked() || null, "allowed declaration preparation");
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; plans=${JSON.stringify(plans.map((plan) => ({ declarations: plan.declarations.map((item) => [item.declarationType, item.policyDecision, item.failureCode]), operations: plan.operations.map((item) => item.canonicalKey), skipped: plan.skipped }))) }; runtimeEvidence=${JSON.stringify(runtimeEvidence)}`, { cause: error });
  }
  assert.equal(await first.locator("#adult-one").isChecked(), true, "ordinary checkbox should remain on Candidate Truth path");
  for (const id of ["terms-one", "background-one", "processing-one", "applicant-one", "eeo-one", "specific-one", "ambiguous-one"]) {
    assert.equal(await first.locator(`#${id}`).isChecked(), false, `${id} must remain candidate-owned`);
  }
  await waitFor(async () => {
    const text = await panel.locator("body").innerText();
    return text.includes("Declarations & acknowledgements") && text.includes("Prepared by Copilot")
      && text.includes("Needs your action") && text.includes("Review before submitting") ? text : null;
  }, "candidate declaration review panel");
  await first.bringToFront();
  await first.locator("#reveal-one").click();
  await waitFor(async () => await first.locator("#conditional-privacy-one").isVisible() || null, "conditional declaration reveal");
  await waitForIntelligence(worker, firstTabId, 10);
  await executeActive(panel);
  await waitFor(async () => await first.locator("#conditional-privacy-one").isChecked() || null, "conditional declaration policy pass");

  await first.locator("#accuracy-one").uncheck();
  await waitFor(async () => runtimeEvidence.some((item) => item.eventType === "CANDIDATE_MODIFIED" && item.declarationType === "ACCURACY_CERTIFICATION") || null, "candidate override evidence");
  await executeActive(panel);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
  assert.equal(await first.locator("#accuracy-one").isChecked(), false, "candidate override must survive later Fill");

  await web.bringToFront();
  const secondTabId = await launch(web, `${fixtureOrigin}/application-two`);
  const second = await waitFor(async () => context?.pages().find((page) => page.url().includes("/application-two")) ?? null, "second application tab");
  await second.bringToFront();
  await waitForIntelligence(worker, secondTabId, 9);
  assert.equal(await second.locator("#accuracy-two").isChecked(), false, "prior application acceptance must not transfer");
  await executeActive(panel);
  await waitFor(async () => await second.locator("#accuracy-two").isChecked() || null, "independent second-application decision");

  await web.bringToFront();
  const staleTabId = await launch(web, `${fixtureOrigin}/application-stale`);
  const stale = await waitFor(async () => context?.pages().find((page) => page.url().includes("/application-stale")) ?? null, "stale application tab");
  await stale.bringToFront();
  await waitForIntelligence(worker, staleTabId, 1);
  await executeActive(panel);
  await waitFor(async () => staleRequested && await stale.locator("input[name=stale_terms]").count() === 1 || null, "stale declaration rerender");
  assert.equal(await stale.locator("#stale").isChecked(), false, "stale authorization must not check the replacement");

  const allEvidence = [...policyEvidence.map((item) => item.request), ...runtimeEvidence];
  assert.ok(allEvidence.some((item) => item.eventType === "POLICY_DECIDED"));
  assert.ok(runtimeEvidence.some((item) => item.eventType === "PREPARED"));
  assert.ok(runtimeEvidence.some((item) => item.eventType === "REVIEW_PRESENTED"));
  const preparedOperations = runtimeEvidence.filter((item) => item.eventType === "PREPARED").map((item) => item.operationId);
  assert.equal(new Set(preparedOperations).size, preparedOperations.length, "one declaration operation must produce one prepared event");
  assert.equal(ordinaryExecutionCanonicals.includes("AGE_OVER_18"), true);
  assert.equal(ordinaryExecutionCanonicals.some((canonical) => canonical.includes("ACKNOWLEDGEMENT") || canonical.includes("CERTIF")), false);
  assert.deepEqual([...new Set(truthCalls)], ["AGE_OVER_18"], "declarations must never resolve through Candidate Truth");
  const finalRuntimes = await runtimeRecords(worker);
  const firstRunId = (runtimeForTab(finalRuntimes, firstTabId)?.identity as { applicationRunId?: string }).applicationRunId;
  const secondRunId = (runtimeForTab(finalRuntimes, secondTabId)?.identity as { applicationRunId?: string }).applicationRunId;
  const firstAccuracy = policyEvidence.find((item) => item.request.applicationRunId === firstRunId && item.request.declarationType === "ACCURACY_CERTIFICATION");
  const secondAccuracy = policyEvidence.find((item) => item.request.applicationRunId === secondRunId && item.request.declarationType === "ACCURACY_CERTIFICATION");
  assert.ok(firstAccuracy && secondAccuracy);
  assert.notEqual(firstAccuracy.request.decisionFingerprint, secondAccuracy.request.decisionFingerprint);
  assert.equal(JSON.stringify(allEvidence).includes("I agree"), false);
  assert.equal(JSON.stringify(allEvidence).includes("information is accurate"), false);
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.ok(plans.length >= 4);
  process.stdout.write(`Phase O browser smoke passed: ${plans.length} context-bound plans; allowed preparation, sensitive/ambiguous refusal, candidate override, conditional reveal, per-application isolation, review UX and stale rerender rejection verified.\n`);
} finally {
  await context?.close().catch(() => undefined);
  await Promise.all([close(fixtureServer), close(apiServer)]);
  await rm(profile, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright";
import {
  ExecutionPlanRequestSchema,
  RecordExecutionEvidenceRequestSchema,
  RecordLearningObservationRequestSchema,
  RecordSubmitAttemptRequestSchema,
  ResolveFieldIntelligenceRequestSchema,
  StartLearningRunRequestSchema,
  VerifyLearningCheckpointRequestSchema
} from "@job-hunter-v2/contracts";
import type { CandidateTruthResolution, ResolveCandidateTruthInput } from "@job-hunter-v2/candidate-truth";
import { FieldIntelligenceService, FieldSemanticResolver } from "@job-hunter-v2/field-intelligence";
import { ExecutionPlanningService } from "@job-hunter-v2/execution";
import {
  RepeatableEntityIntelligenceService,
  type CandidateEntityLifecycleResult,
  type CandidateEntityReorderResult,
  type RepeatableEntityRepository,
  type StoredEntityBinding
} from "@job-hunter-v2/repeatable-entities";
import type { EntityBindingReceipt } from "@job-hunter-v2/contracts";

const fixtureOrigin = "http://127.0.0.1:43401";
const apiOrigin = "http://127.0.0.1:43410";
const extensionPath = process.env.EXTENSION_OUTPUT_DIR
  ? resolve(new URL("..", import.meta.url).pathname, process.env.EXTENSION_OUTPUT_DIR)
  : resolve(new URL("../apps/extension/dist", import.meta.url).pathname);
const accountId = "61000000-0000-4000-8000-000000000001";
const candidateId = "61000000-0000-4000-8000-000000000002";
const jobId = "61000000-0000-4000-8000-000000000003";
const scopeKey = "scope=GLOBAL";
const scopeFingerprint = createHash("sha256").update(scopeKey).digest("hex");
const employmentEntityId = "61000000-0000-4000-8000-000000000020";
const previousEmploymentEntityId = "61000000-0000-4000-8000-000000000021";
interface LearnedEntry { value: string; answerVersionId: string }
interface LearnedChange { key: string; before: LearnedEntry | null; afterVersionId: string }
const learnedValues = new Map<string, LearnedEntry>();
const changeSets = new Map<string, { changes: LearnedChange[]; reversed: boolean }>();
const checkpointResults = new Map<string, Record<string, unknown>>();
let lastChangeSetId: string | null = null;
const runs = new Map<string, { applicationId: string; submittedAt: string | null }>();
const observations = new Map<string, Array<ReturnType<typeof RecordLearningObservationRequestSchema.parse>>>();
const submitAttempts = new Map<string, string>();
const requestBodies: unknown[] = [];
const intelligenceResults: unknown[] = [];
let exposeTwoEmploymentEntities = false;

function answerKey(canonicalKey: string, candidateEntityId: string | null | undefined): string {
  return `${canonicalKey}:${candidateEntityId ?? "NONE"}`;
}

const candidateTruth = {
  resolve: async (input: ResolveCandidateTruthInput): Promise<CandidateTruthResolution> => {
    const learned = learnedValues.get(answerKey(input.canonicalKey, input.entityId));
    if (!learned) {
      return { status: "MISSING", canonicalKey: input.canonicalKey, reasonCodes: ["NO_COMPATIBLE_CANDIDATE_TRUTH"] };
    }
    return {
      status: "RESOLVED",
      canonicalKey: input.canonicalKey,
      answerVersionId: learned.answerVersionId,
      normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: learned.value },
      scope: { scopeType: "GLOBAL", scopeKey, scopeFingerprint, precedence: 100 },
      trustState: "TRUSTED",
      trialReuse: false,
      requiresUserReview: false,
      autofillMode: "AUTO",
      expiresAt: null,
      reasonCodes: ["BEST_COMPATIBLE_SCOPE", "ANSWER_HAS_NO_EXPIRY"],
      candidateVersionIds: [learned.answerVersionId]
    };
  }
};
class RepeatableRepository implements RepeatableEntityRepository {
  private readonly bindings = new Map<string, StoredEntityBinding>();
  async invalidateBindingsExcept(): Promise<void> {}
  async listCandidateEntities() {
    const entities = [{
      candidateEntityId: employmentEntityId, entityType: "EMPLOYMENT" as const,
      entityVersion: 1, entityRevision: "e".repeat(64), status: "ACTIVE" as const,
      displayOrder: 0, recencyRank: 0, canonicalCoverage: ["EMPLOYMENT_COMPANY"], privateValueFingerprints: []
    }];
    if (exposeTwoEmploymentEntities) entities.push({
      candidateEntityId: previousEmploymentEntityId, entityType: "EMPLOYMENT",
      entityVersion: 1, entityRevision: "f".repeat(64), status: "ACTIVE",
      displayOrder: 1, recencyRank: 1, canonicalCoverage: ["EMPLOYMENT_COMPANY"], privateValueFingerprints: []
    });
    return entities;
  }
  async findBinding(input: { applicationRunId: string; pageInstanceId: string; formRepeatGroupId: string }) {
    return this.bindings.get(`${input.applicationRunId}:${input.pageInstanceId}:${input.formRepeatGroupId}`) ?? null;
  }
  async saveBinding(input: { applicationRunId: string; pageInstanceId: string; group: { formRepeatGroupId: string; structuralFingerprint: string }; receipt: EntityBindingReceipt }) {
    this.bindings.set(`${input.applicationRunId}:${input.pageInstanceId}:${input.group.formRepeatGroupId}`, {
      receipt: input.receipt, structuralFingerprint: input.group.structuralFingerprint
    });
    return input.receipt;
  }
  async mutateEntity(): Promise<CandidateEntityLifecycleResult> { throw new Error("not used"); }
  async reorderEntities(): Promise<CandidateEntityReorderResult> { throw new Error("not used"); }
}
const repeatableEntities = new RepeatableEntityIntelligenceService(new RepeatableRepository());
const intelligence = new FieldIntelligenceService(new FieldSemanticResolver(), candidateTruth, null, undefined, 8, repeatableEntities);
const execution = new ExecutionPlanningService(intelligence);

function html(body: string, script = ""): string {
  return `<!doctype html><html data-ats="GREENHOUSE"><head><meta charset="utf-8"><title>Phase L fixture</title></head><body data-ats="GREENHOUSE"><main><h1>Engineer application</h1>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

function fixture(path: string): string {
  if (path === "/web") return html("<p>Job Hunter browser learning fixture.</p>");
  if (path === "/application-b") return html(`<form id="application-b"><label>Given name<input id="name-b" name="given_name"></label><label>Best contact email<input id="email-b" type="email" name="contact_email"></label><button type="submit">Submit application</button></form>`, `
    document.querySelector('#application-b').addEventListener('submit',event=>{
      event.preventDefault(); // Modern ATS confirmation: same URL, form replaced.
      document.querySelector('main').innerHTML='<h1>Application submitted</h1><p>Thank you for applying. Your application has been received.</p>';
    });
  `);
  if (path === "/application-c") return html(`<form><label>First name<input id="name-c" name="first_name"></label><label>Email address<input id="email-c" type="email" name="email_address"></label></form>`);
  if (path === "/application-abandoned") return html(`<form><label>Email for recruiter<input id="email-c" type="email" name="recruiter_email"></label></form>`);
  if (path === "/application-failed-verification") return html(`<form id="failed-form"><label>Contact email<input id="email-failed" type="email" name="email"></label><button type="submit">Submit application</button></form>`, `
    document.querySelector('#failed-form').addEventListener('submit',event=>{
      event.preventDefault(); history.pushState({},'', '/application-failed-verification/pending');
      document.querySelector('main').innerHTML='<h1>Processing application</h1><p>Please wait while we process your application.</p>';
    });
  `);
  if (path === "/application-interaction-failure") return html(`<form id="interaction-form"><label>Email address<input id="email-interaction" type="email" name="email"></label><button type="submit">Submit application</button></form>`, `
    const input=document.querySelector('#email-interaction');
    input.addEventListener('input',event=>{ if(!event.isTrusted) input.value=''; });
    document.querySelector('#interaction-form').addEventListener('submit',event=>{
      event.preventDefault(); history.pushState({},'', '/application-interaction-failure/success');
      document.querySelector('main').innerHTML='<h1>Application submitted</h1><p>We received your application.</p>';
    });
  `);
  if (path === "/repeatable-a") return html(`<form id="repeatable-a"><section><h2>Work history</h2><div data-repeatable-item="employment-2"><h3>Work experience 2</h3><label>Company<input id="company-a" name="company_2"></label></div></section><button type="submit">Submit application</button></form>`, `
    document.querySelector('#repeatable-a').addEventListener('submit',event=>{
      event.preventDefault(); history.pushState({},'', '/repeatable-a/success');
      document.querySelector('main').innerHTML='<h1>Application submitted</h1><p>Application has been received.</p>';
    });
  `);
  if (path === "/repeatable-b") return html(`<form><section><h2>Work experience</h2><div data-repeatable-item="employment-2"><h3>Work experience 2</h3><label>Employer<input id="company-b" name="employer_2"></label></div></section></form>`);
  if (path === "/repeatable-multi") return html(`<form id="repeatable-multi"><section><h2>Work history</h2><div data-repeatable-item="employment-previous"><h3>Previous employment</h3><label>Company<input id="previous-company"></label><label>Job title<input id="previous-title"></label></div><div data-repeatable-item="employment-current"><h3>Current employment</h3><label>Company<input id="current-company"></label><label>Job title<input id="current-title"></label></div></section><button type="submit">Submit application</button></form>`, `
    document.querySelector('#repeatable-multi').addEventListener('submit',event=>{
      event.preventDefault(); history.pushState({},'', '/repeatable-multi/success');
      document.querySelector('main').innerHTML='<h1>Application submitted</h1><p>Application has been received.</p>';
    });
  `);
  return html(`<form id="application"><label>First name<input id="name-a" name="first_name"></label><label>Email address<input id="email-a" type="email" name="email"></label><button type="submit">Submit application</button></form>`, `
    document.querySelector('#application').addEventListener('submit',event=>{
      event.preventDefault();
      history.pushState({},'', '/application-a/success');
      document.querySelector('main').innerHTML='<h1>Application submitted</h1><p>Thank you for applying. Your application has been received.</p>';
    });
  `);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => resolvePromise(body));
    request.on("error", reject);
  });
}

function listen(port: number, handler: (request: IncomingMessage) => Promise<{ status?: number; body: string; contentType?: string }>): Promise<Server> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer((request, response) => {
      void handler(request).then((result) => {
        response.writeHead(result.status ?? 200, {
          "content-type": result.contentType ?? "text/html; charset=utf-8",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "authorization,content-type,x-idempotency-key"
        });
        response.end(result.body);
      }).catch((error) => { response.writeHead(500); response.end(error instanceof Error ? error.message : "error"); });
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise(server));
  });
}

const close = (server: Server) => new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
async function waitFor<T>(read: () => Promise<T | null | false>, label: string, timeoutMs = 12_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 75));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
async function extensionWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers().find((item) => item.url().startsWith("chrome-extension://")) ?? context.waitForEvent("serviceworker");
}
async function webMessage(page: Page, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serialized = JSON.stringify(message).replaceAll("<", "\\u003c");
  return page.evaluate(`(async()=>{const input=${serialized};const nonce=crypto.randomUUID();return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('bridge timeout')),5000);const listener=(event)=>{const data=event.data;if(event.source!==window||event.origin!==location.origin||!data||data.source!=='JOB_HUNTER_EXTENSION'||data.nonce!==nonce)return;clearTimeout(timeout);removeEventListener('message',listener);resolve(data)};addEventListener('message',listener);postMessage({source:'JOB_HUNTER_WEB',nonce,...input},location.origin)})})()` ) as Promise<Record<string, unknown>>;
}
async function runtimeRecords(worker: Worker) {
  return worker.evaluate(async () => Object.values(((await chrome.storage.session.get("jobHunter.extension.runtimes.v1"))["jobHunter.extension.runtimes.v1"] ?? {}) as Record<string, Record<string, unknown>>));
}
async function intelligenceItemsForTab(worker: Worker, tabId: number): Promise<Array<{ canonicalKey: string | null; state: string; fieldRuntimeId: string }>> {
  return worker.evaluate(async (expectedTabId) => {
    const stored = await chrome.storage.session.get(["jobHunter.extension.runtimes.v1", "jobHunter.extension.fieldIntelligence.v1"]);
    const runtimes = (stored["jobHunter.extension.runtimes.v1"] ?? {}) as Record<string, { identity?: { tabId?: number } }>;
    const key = Object.entries(runtimes).find(([, record]) => record.identity?.tabId === expectedTabId)?.[0];
    const intelligence = (stored["jobHunter.extension.fieldIntelligence.v1"] ?? {}) as Record<string, { items?: Array<{ semantic: { canonicalKey: string | null; state: string; fieldRuntimeId: string } }> }>;
    return key ? (intelligence[key]?.items ?? []).map((item) => item.semantic) : [];
  }, tabId);
}
async function launch(page: Page, applicationUrl: string): Promise<number> {
  const response = await webMessage(page, { type: "JOB_HUNTER_LAUNCH_APPLICATION", jobId, applicationUrl });
  const launchResult = response.launch as { state?: string; tabId?: number } | undefined;
  assert.equal(launchResult?.state, "READY_TO_LAUNCH", JSON.stringify(response));
  assert.equal(typeof launchResult?.tabId, "number");
  return launchResult?.tabId as number;
}

async function executeActive(panel: Page): Promise<void> {
  const response = await panel.evaluate(async () => chrome.runtime.sendMessage({
    protocolVersion: 1,
    messageId: crypto.randomUUID(),
    correlationId: null,
    sentAt: new Date().toISOString(),
    source: "SIDEPANEL",
    type: "UI_EXECUTE_ACTIVE_TAB",
    dataClass: "STRUCTURAL",
    payload: {}
  })) as { ok: boolean };
  assert.equal(response.ok, true);
}

function runtimeForTab(records: Record<string, unknown>[], tabId: number): Record<string, unknown> | undefined {
  return records.find((record) => (record.identity as { tabId?: number }).tabId === tabId);
}

const fixtureServer = await listen(43401, async (request) => ({ body: fixture(new URL(request.url ?? "/", fixtureOrigin).pathname) }));
const apiServer = await listen(43410, async (request) => {
  if (request.method === "OPTIONS") return { status: 204, body: "" };
  const path = new URL(request.url ?? "/", apiOrigin).pathname;
  if (path === "/v1/auth/session") return { body: JSON.stringify({ email: "phase-l@example.test", account: { type: "TEST", role: "OWNER" }, candidate: { id: candidateId, new: false }, onboarding: { stage: "READY", completed: true, version: 1, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() } }), contentType: "application/json" };
  const raw = request.method === "POST" ? JSON.parse(await readBody(request) || "{}") : {};
  requestBodies.push(raw);
  if (path === "/v1/learning/runs") {
    const parsed = StartLearningRunRequestSchema.parse(raw);
    const applicationId = crypto.randomUUID(), applicationRunId = crypto.randomUUID();
    runs.set(applicationRunId, { applicationId, submittedAt: null });
    return { body: JSON.stringify({ schemaVersion: 1, requestId: parsed.requestId, applicationId, applicationRunId, status: "ACTIVE", idempotentReplay: false, containsCandidateValue: false }), contentType: "application/json" };
  }
  if (path === "/v1/field-intelligence/resolve") {
    const parsed = ResolveFieldIntelligenceRequestSchema.parse(raw);
    const result = await intelligence.resolve({ accountId, candidateId, request: parsed });
    intelligenceResults.push(result);
    return { body: JSON.stringify(result), contentType: "application/json" };
  }
  if (path === "/v1/execution/plan") {
    const parsed = ExecutionPlanRequestSchema.parse(raw);
    return { body: JSON.stringify(await execution.plan({ accountId, candidateId, request: parsed })), contentType: "application/json" };
  }
  if (path === "/v1/learning/execution-evidence") {
    const parsed = RecordExecutionEvidenceRequestSchema.parse(raw);
    return { body: JSON.stringify({ schemaVersion: 1, requestId: parsed.requestId, evidenceId: crypto.randomUUID(), idempotentReplay: false, containsCandidateValue: false }), contentType: "application/json" };
  }
  if (path === "/v1/learning/observations") {
    const parsed = RecordLearningObservationRequestSchema.parse(raw);
    if (parsed.observationType === "COPILOT_CORRECTION" && parsed.priorVerificationStatus !== "VERIFIED") {
      return { body: JSON.stringify({ schemaVersion: 1, requestId: parsed.requestId, observationId: parsed.observationId, status: "ATTRIBUTION_BLOCKED", attribution: parsed.priorFailureClass === "REPRESENTATION_INVALID" ? "REPRESENTATION_SUSPECT" : "INTERACTION_SUSPECT", needsVerifiedCheckpoint: false, expiresAt: null, reasonCode: "CORRECTION_CAUSE_NOT_PROVEN", idempotentReplay: false, valuePrivate: true, containsCandidateValue: false }), contentType: "application/json" };
    }
    const values = observations.get(parsed.applicationRunId) ?? [];
    values.push(parsed); observations.set(parsed.applicationRunId, values);
    return { body: JSON.stringify({ schemaVersion: 1, requestId: parsed.requestId, observationId: parsed.observationId, status: "RECORDED", attribution: parsed.observationType === "COPILOT_CORRECTION" ? "CANDIDATE_ANSWER_CORRECTION" : parsed.observationType === "ANSWER_CONFIRMATION" ? "CANDIDATE_ANSWER_CONFIRMATION" : "CANDIDATE_ANSWER_ENTRY", needsVerifiedCheckpoint: true, expiresAt: new Date(Date.now() + 60_000).toISOString(), reasonCode: "AWAITING_VERIFIED_SUBMISSION", idempotentReplay: false, valuePrivate: true, containsCandidateValue: false }), contentType: "application/json" };
  }
  if (path === "/v1/learning/submit-attempts") {
    const parsed = RecordSubmitAttemptRequestSchema.parse(raw);
    submitAttempts.set(parsed.applicationRunId, parsed.occurredAt);
    return { body: JSON.stringify({ schemaVersion: 1, requestId: parsed.requestId, submitAttemptId: crypto.randomUUID(), idempotentReplay: false, containsCandidateValue: false }), contentType: "application/json" };
  }
  if (path === "/v1/learning/checkpoints/submission") {
    const parsed = VerifyLearningCheckpointRequestSchema.parse(raw);
    assert.equal(submitAttempts.get(parsed.applicationRunId), parsed.signal.trustedSubmitObservedAt);
    const replay = checkpointResults.get(parsed.applicationRunId);
    if (replay) return { body: JSON.stringify({ ...replay, requestId: parsed.requestId, idempotentReplay: true }), contentType: "application/json" };
    const latestByAnswer = new Map<string, ReturnType<typeof RecordLearningObservationRequestSchema.parse>>();
    for (const item of observations.get(parsed.applicationRunId) ?? []) {
      latestByAnswer.set(answerKey(item.canonicalKey, item.entityBinding.candidateEntityId), item);
    }
    const changes: LearnedChange[] = [];
    let skipped = 0;
    for (const [key, item] of latestByAnswer) {
      if (item.value.kind !== "TEXT") { skipped += 1; continue; }
      const before = learnedValues.get(key) ?? null;
      if (before?.value === item.value.value) { skipped += 1; continue; }
      const answerVersionId = crypto.randomUUID();
      learnedValues.set(key, { value: item.value.value, answerVersionId });
      changes.push({ key, before, afterVersionId: answerVersionId });
    }
    lastChangeSetId = changes.length ? crypto.randomUUID() : null;
    if (lastChangeSetId) changeSets.set(lastChangeSetId, { changes, reversed: false });
    const result = {
      schemaVersion: 1, requestId: parsed.requestId, checkpointId: crypto.randomUUID(), checkpointStatus: "VERIFIED",
      result: {
        changeSetId: lastChangeSetId, saved: changes.length, askAgain: 0, skipped, conflicts: 0,
        message: changes.length ? (skipped ? "SOME_UPDATES_SAVED" : "UPDATED_FOR_NEXT_TIME") : "NO_REUSABLE_UPDATES"
      },
      idempotentReplay: false, containsCandidateValue: false
    };
    checkpointResults.set(parsed.applicationRunId, result);
    return { body: JSON.stringify(result), contentType: "application/json" };
  }
  if (/^\/v1\/learning\/change-sets\/[0-9a-f-]+\/undo$/.test(path)) {
    const changeSetId = path.split("/").at(-2) as string;
    const group = changeSets.get(changeSetId);
    if (!group || group.reversed) return { body: JSON.stringify({ schemaVersion: 1, changeSetId, restored: 0, forgotten: 0, keptNewer: 0, message: "NOTHING_TO_UNDO", idempotentReplay: Boolean(group?.reversed), containsCandidateValue: false }), contentType: "application/json" };
    let restored = 0, forgotten = 0, keptNewer = 0;
    for (const change of group.changes) {
      const current = learnedValues.get(change.key);
      if (current?.answerVersionId !== change.afterVersionId) { keptNewer += 1; continue; }
      if (change.before) { learnedValues.set(change.key, change.before); restored += 1; }
      else { learnedValues.delete(change.key); forgotten += 1; }
    }
    group.reversed = true;
    return { body: JSON.stringify({ schemaVersion: 1, changeSetId, restored, forgotten, keptNewer, message: restored + forgotten === 0 ? "NOTHING_TO_UNDO" : keptNewer ? "UPDATES_PARTIALLY_UNDONE" : "UPDATES_UNDONE", idempotentReplay: false, containsCandidateValue: false }), contentType: "application/json" };
  }
  return { status: 404, body: JSON.stringify({ error: "not found" }), contentType: "application/json" };
});

const profile = await mkdtemp(join(tmpdir(), "job-hunter-phase-l-"));
let context: BrowserContext | null = null;
const errors: string[] = [];
try {
  context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: false, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  const worker = await extensionWorker(context);
  worker.on("console", (entry) => { if (entry.type() === "error") errors.push(`worker:${entry.text()}`); });
  const extensionId = new URL(worker.url()).host;
  const web = await context.newPage();
  web.on("pageerror", (error) => errors.push(`web:${error.message}`));
  await web.goto(`${fixtureOrigin}/web`);
  await waitFor(async () => {
    const probe = await webMessage(web, { type: "JOB_HUNTER_WEB_PROBE" }).catch(() => null);
    return probe?.installed === true ? probe : null;
  }, "extension website bridge");
  const connected = await webMessage(web, { type: "JOB_HUNTER_SESSION_OFFER", accessToken: "phase-l-browser-token-123456789" });
  assert.equal(connected.authState, "READY");
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const firstTabId = await launch(web, `${fixtureOrigin}/application-a`);
  const first = await waitFor(async () => context?.pages().find((item) => item.url().includes("/application-a")) ?? null, "Application A tab");
  first.on("pageerror", (error) => errors.push(`application-a:${error.message}`));
  await first.bringToFront();
  await waitFor(async () => {
    const record = runtimeForTab(await runtimeRecords(worker), firstTabId);
    return ((record?.lastIntelligence as { resolvedHigh?: number } | null)?.resolvedHigh ?? 0) >= 2 ? record : null;
  }, "Application A intelligence");
  const firstSemantics = await intelligenceItemsForTab(worker, firstTabId);
  assert.equal(firstSemantics.find((item) => item.canonicalKey === "EMAIL")?.state, "RESOLVED_HIGH", JSON.stringify(firstSemantics));
  assert.equal(firstSemantics.find((item) => item.canonicalKey === "FIRST_NAME")?.state, "RESOLVED_HIGH", JSON.stringify(firstSemantics));
  await first.locator("#name-a").click();
  await first.locator("#name-a").pressSequentially("Lavish");
  await first.locator("#email-a").click();
  await first.locator("#email-a").pressSequentially("learned@example.test");
  await first.locator("#email-a").press("Tab");
  await waitFor(async () => [...observations.values()].flat().some((item) => item.canonicalKey === "EMAIL") || null, "committed email observation");
  await first.locator("button[type=submit]").click();
  const firstLearning = await waitFor(async () => {
    const record = runtimeForTab(await runtimeRecords(worker), firstTabId);
    const learning = record?.lastLearning as { message?: string; saved?: number; changeSetId?: string } | null;
    return learning ? record : null;
  }, "grouped verified learning summary");
  assert.deepEqual(firstLearning.lastLearning, {
    changeSetId: lastChangeSetId,
    saved: 2,
    askAgain: 0,
    skipped: 0,
    conflicts: 0,
    message: "UPDATED_FOR_NEXT_TIME",
    at: (firstLearning.lastLearning as { at: string }).at
  }, `unexpected first learning result; observations=${JSON.stringify([...observations.values()].flat().map((item) => ({ canonical: item.canonicalKey, origin: item.origin })))}`);
  const initialChangeSetId = lastChangeSetId;
  assert.ok(initialChangeSetId);
  await waitFor(async () => (await panel.locator("body").innerText()).includes("Updated for next time") || null, "side-panel learning feedback");
  assert.equal(learnedValues.get(answerKey("FIRST_NAME", null))?.value, "Lavish");
  assert.equal(learnedValues.get(answerKey("EMAIL", null))?.value, "learned@example.test");

  await web.bringToFront();
  const secondTabId = await launch(web, `${fixtureOrigin}/application-b`);
  const second = await waitFor(async () => context?.pages().find((item) => item.url().includes("/application-b")) ?? null, "Application B tab");
  await second.bringToFront();
  await second.locator('#email-b').waitFor({ state: 'attached' });
  await waitFor(async () => {
    const record = runtimeForTab(await runtimeRecords(worker), secondTabId);
    return ((record?.lastIntelligence as { answerAvailable?: number } | null)?.answerAvailable ?? 0) >= 2 ? record : null;
  }, "future Candidate Truth reuse");
  await executeActive(panel);
  assert.equal(await second.locator('#email-b').count(), 1, `Application B form disappeared after safe fill: ${second.url()} ${(await second.locator('main').innerText()).slice(0, 300)}`);
  await waitFor(async () => (await second.locator("#email-b").inputValue()) === "learned@example.test" || null, "Application B verified autofill");
  assert.equal(await second.locator("#name-b").inputValue(), "Lavish");

  // A trusted candidate correction after a K VERIFIED readback becomes a new
  // append-only answer only after this second application is verified.
  await second.locator("#email-b").click();
  await second.locator("#email-b").press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await second.locator("#email-b").pressSequentially("corrected@example.test");
  await second.locator("#email-b").press("Tab");
  await second.locator("button[type=submit]").click();
  await waitFor(async () => learnedValues.get(answerKey("EMAIL", null))?.value === "corrected@example.test" || null, "verified correction");

  await web.bringToFront();
  const thirdTabId = await launch(web, `${fixtureOrigin}/application-c`);
  const third = await waitFor(async () => context?.pages().find((item) => item.url().includes("/application-c")) ?? null, "Application C tab");
  await third.bringToFront();
  await waitFor(async () => {
    const record = runtimeForTab(await runtimeRecords(worker), thirdTabId);
    return ((record?.lastIntelligence as { answerAvailable?: number } | null)?.answerAvailable ?? 0) >= 2 ? record : null;
  }, "corrected Candidate Truth reuse");
  await executeActive(panel);
  await waitFor(async () => (await third.locator("#email-c").inputValue()) === "corrected@example.test" || null, "corrected value autofill");
  assert.equal(await third.locator("#name-c").inputValue(), "Lavish");

  await web.bringToFront();
  await launch(web, `${fixtureOrigin}/application-abandoned`);
  const abandoned = await waitFor(async () => context?.pages().find((item) => item.url().includes("/application-abandoned")) ?? null, "abandoned application");
  await abandoned.locator("#email-c").click();
  await abandoned.locator("#email-c").pressSequentially("unverified@example.test");
  await abandoned.locator("body").click({ position: { x: 5, y: 5 } });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
  assert.equal(learnedValues.get(answerKey("EMAIL", null))?.value, "corrected@example.test", "an abandoned observation must not become permanent truth");

  // A trusted submit click without both success URL and success marker stays
  // pending and cannot claim that a permanent update was made.
  await web.bringToFront();
  const failedTabId = await launch(web, `${fixtureOrigin}/application-failed-verification`);
  const failed = await waitFor(async () => context?.pages().find((item) => item.url().includes("/application-failed-verification")) ?? null, "failed-verification application");
  await failed.bringToFront();
  await failed.locator("#email-failed").fill("not-verified@example.test");
  await failed.locator("#email-failed").press("Tab");
  await failed.locator("button[type=submit]").click();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 600));
  const failedRuntime = runtimeForTab(await runtimeRecords(worker), failedTabId);
  assert.ok(failedRuntime?.pendingSubmitAt, "failed verification should preserve the pending submit for recovery");
  assert.equal(failedRuntime?.lastLearning, null);
  assert.equal(learnedValues.get(answerKey("EMAIL", null))?.value, "corrected@example.test");

  // If K cannot make its value stick, the later human value is typed as an
  // interaction failure rather than poisoning Candidate Truth.
  await web.bringToFront();
  const interactionTabId = await launch(web, `${fixtureOrigin}/application-interaction-failure`);
  const interaction = await waitFor(async () => context?.pages().find((item) => item.url().includes("/application-interaction-failure")) ?? null, "interaction-failure application");
  await interaction.bringToFront();
  await waitFor(async () => {
    const record = runtimeForTab(await runtimeRecords(worker), interactionTabId);
    return ((record?.lastIntelligence as { answerAvailable?: number } | null)?.answerAvailable ?? 0) >= 1 ? record : null;
  }, "interaction-failure intelligence");
  await executeActive(panel);
  await waitFor(async () => {
    const record = runtimeForTab(await runtimeRecords(worker), interactionTabId);
    return ((record?.lastExecution as { failed?: number } | null)?.failed ?? 0) >= 1 ? record : null;
  }, "independent K verification failure");
  await interaction.locator("#email-interaction").pressSequentially("blocked-by-attribution@example.test");
  await interaction.locator("#email-interaction").press("Tab");
  await interaction.locator("button[type=submit]").click();
  await waitFor(async () => {
    const record = runtimeForTab(await runtimeRecords(worker), interactionTabId);
    return (record?.lastLearning as { message?: string } | null)?.message === "NO_REUSABLE_UPDATES" ? record : null;
  }, "failure-attribution no-learning result");
  assert.equal(learnedValues.get(answerKey("EMAIL", null))?.value, "corrected@example.test");

  // Stable repeatable identity is preserved. A DOM-only/ordinal binding would
  // be policy-blocked and is owned by Phase M.
  await web.bringToFront();
  const repeatTabId = await launch(web, `${fixtureOrigin}/repeatable-a`);
  const repeat = await waitFor(async () => context?.pages().find((item) => item.url().includes("/repeatable-a")) ?? null, "repeatable application A");
  await repeat.bringToFront();
  await waitFor(async () => {
    const record = runtimeForTab(await runtimeRecords(worker), repeatTabId);
    return ((record?.lastIntelligence as { resolvedHigh?: number } | null)?.resolvedHigh ?? 0) >= 1 ? record : null;
  }, "repeatable application intelligence");
  const repeatSemantics = await intelligenceItemsForTab(worker, repeatTabId);
  assert.equal(repeatSemantics.find((item) => item.canonicalKey === "EMPLOYMENT_COMPANY")?.state, "RESOLVED_HIGH", JSON.stringify(repeatSemantics));
  await repeat.locator("#company-a").pressSequentially("Vidyakul");
  await repeat.locator("#company-a").press("Tab");
  await waitFor(async () => [...observations.values()].flat().some((item) => item.canonicalKey === "EMPLOYMENT_COMPANY") || null, "entity-scoped observation");
  const repeatObservations = [...observations.values()].flat().filter((item) => item.canonicalKey === "EMPLOYMENT_COMPANY");
  assert.equal(repeatObservations.at(-1)?.entityBinding.candidateEntityId, employmentEntityId, JSON.stringify(repeatObservations.at(-1)?.entityBinding));
  assert.equal(repeatObservations.at(-1)?.entityIntelligence?.state, "BOUND_HIGH");
  assert.equal(repeatObservations.at(-1)?.entityIntelligence?.candidateEntityId, employmentEntityId);
  await repeat.locator("button[type=submit]").click();
  await waitFor(async () => learnedValues.get(answerKey("EMPLOYMENT_COMPANY", employmentEntityId))?.value === "Vidyakul" || null, "entity-scoped learning");

  await web.bringToFront();
  const repeatReuseTabId = await launch(web, `${fixtureOrigin}/repeatable-b`);
  const repeatReuse = await waitFor(async () => context?.pages().find((item) => item.url().includes("/repeatable-b")) ?? null, "repeatable application B");
  await repeatReuse.bringToFront();
  await waitFor(async () => {
    const record = runtimeForTab(await runtimeRecords(worker), repeatReuseTabId);
    return ((record?.lastIntelligence as { answerAvailable?: number } | null)?.answerAvailable ?? 0) >= 1 ? record : null;
  }, "repeatable Candidate Truth reuse");
  await executeActive(panel);
  await waitFor(async () => (await repeatReuse.locator("#company-b").inputValue()) === "Vidyakul" || null, "entity-scoped autofill");

  // With two stable employment entities, correcting the reversed previous
  // group must learn only against that UUID. Undo must restore that entity
  // while leaving the current employment untouched.
  exposeTwoEmploymentEntities = true;
  learnedValues.set(answerKey("EMPLOYMENT_COMPANY", previousEmploymentEntityId), {
    value: "PreviousCo", answerVersionId: crypto.randomUUID()
  });
  await web.bringToFront();
  const multiTabId = await launch(web, `${fixtureOrigin}/repeatable-multi`);
  const multi = await waitFor(async () => context?.pages().find((item) => item.url().includes("/repeatable-multi")) ?? null, "multi-entity repeatable application");
  await multi.bringToFront();
  try {
    await waitFor(async () => {
      const record = runtimeForTab(await runtimeRecords(worker), multiTabId);
      return ((record?.lastIntelligence as { answerAvailable?: number } | null)?.answerAvailable ?? 0) >= 2 ? record : null;
    }, "two bound employment answers");
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; latest=${JSON.stringify(intelligenceResults.at(-1))}`, { cause: error });
  }
  await executeActive(panel);
  await waitFor(async () => (await multi.locator("#previous-company").inputValue()) === "PreviousCo" || null, "previous employment autofill");
  assert.equal(await multi.locator("#current-company").inputValue(), "Vidyakul");
  await multi.locator("#previous-company").click();
  await multi.locator("#previous-company").press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await multi.locator("#previous-company").pressSequentially("PreviousCoUpdated");
  await multi.locator("#previous-company").press("Tab");
  await multi.locator("button[type=submit]").click();
  await waitFor(async () => learnedValues.get(answerKey("EMPLOYMENT_COMPANY", previousEmploymentEntityId))?.value === "PreviousCoUpdated" || null, "previous employment correction learning");
  const multiChangeSetId = lastChangeSetId;
  assert.ok(multiChangeSetId);
  assert.equal(learnedValues.get(answerKey("EMPLOYMENT_COMPANY", employmentEntityId))?.value, "Vidyakul");
  const multiUndo = await panel.evaluate(async (changeSetId) => chrome.runtime.sendMessage({ protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: null, sentAt: new Date().toISOString(), source: "SIDEPANEL", type: "UI_UNDO_LEARNING", dataClass: "STRUCTURAL", payload: { changeSetId } }), multiChangeSetId) as { ok: boolean };
  assert.equal(multiUndo.ok, true);
  assert.equal(learnedValues.get(answerKey("EMPLOYMENT_COMPANY", previousEmploymentEntityId))?.value, "PreviousCo");
  assert.equal(learnedValues.get(answerKey("EMPLOYMENT_COMPANY", employmentEntityId))?.value, "Vidyakul");

  // Undoing the original two-answer group after a newer email correction is
  // partial-safe: FIRST_NAME is forgotten and the newer EMAIL survives.
  await repeatReuse.bringToFront();
  const undo = await panel.evaluate(async (changeSetId) => chrome.runtime.sendMessage({ protocolVersion: 1, messageId: crypto.randomUUID(), correlationId: null, sentAt: new Date().toISOString(), source: "SIDEPANEL", type: "UI_UNDO_LEARNING", dataClass: "STRUCTURAL", payload: { changeSetId } }), initialChangeSetId) as { ok: boolean };
  assert.equal(undo.ok, true);
  assert.equal(learnedValues.has(answerKey("FIRST_NAME", null)), false);
  assert.equal(learnedValues.get(answerKey("EMAIL", null))?.value, "corrected@example.test");
  await waitFor(async () => (await panel.locator("body").innerText()).includes("Some updates undone") || null, "partial-safe Undo feedback");

  const storage = await worker.evaluate(async () => ({ session: await chrome.storage.session.get(null), local: await chrome.storage.local.get(null) }));
  assert.doesNotMatch(JSON.stringify(storage), /learned@example\.test|corrected@example\.test|unverified@example\.test|Vidyakul/i);
  const valueFreeBodies = requestBodies.filter((body) => {
    const record = body as Record<string, unknown>;
    return !("value" in record);
  });
  assert.ok(valueFreeBodies.length > 0);
  assert.equal(errors.length, 0, errors.join("\n"));
  process.stdout.write("Phase L browser certification passed: grouped unknown answers learned after verified submission, reused across wording, corrected safely, abandoned/failed/interaction evidence did not poison truth, stable repeatable identity was preserved, partial Undo kept newer truth, and storage remained value-private.\n");
} finally {
  await context?.close().catch(() => undefined);
  await Promise.all([close(fixtureServer), close(apiServer)]);
  await rm(profile, { recursive: true, force: true });
}

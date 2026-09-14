import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright";

const fixtureOrigin = "http://127.0.0.1:43101";
const crossOrigin = "http://127.0.0.1:43102";
const extensionPath = process.env.EXTENSION_OUTPUT_DIR
  ? resolve(new URL("../../..", import.meta.url).pathname, process.env.EXTENSION_OUTPUT_DIR)
  : resolve(new URL("../dist", import.meta.url).pathname);

function html(body: string, script = ""): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Phase I fixture</title></head><body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;
}

function fixture(path: string): string {
  if (path === "/web") return html("<main><h1>Job Hunter test website</h1><p>Extension handshake fixture.</p></main>");
  if (path === "/ordinary") return html("<main><h1>Documentation</h1><form role=search><input type=search name=q><button>Search</button></form></main>");
  if (path === "/basic") return html(`<form action="/submit"><label>Full name<input name="fullName" required></label><label>Email<input type="email" name="email"></label><label>Country<select name="country"><option>India</option></select></label><label><input type="checkbox" name="authorized"> Authorized</label><button type="button">Continue</button></form>`);
  if (path === "/spa" || path === "/spa/profile") return html(`<main id="root"><form><label>Current company<input name="company"></label><button id="route" type="button">Next route</button></form></main>`, `document.querySelector('#route').addEventListener('click',()=>{history.pushState({},'', '/spa/profile');document.querySelector('#root').innerHTML='<form><label>Current title<input name="title"></label><label>Notice period<input type="number" name="notice"></label></form>'});`);
  if (path === "/multi" || path === "/multi/step/2") return html(`<main id="step"><form action="/multi"><label>First name<input name="first"></label><button id="next" type="button">Next step</button></form></main>`, `document.querySelector('#next').addEventListener('click',()=>{history.pushState({},'', '/multi/step/2');document.querySelector('#step').innerHTML='<form action="/multi"><label>Experience<input type="number" name="experience"></label><label>Portfolio<input type="url" name="portfolio"></label></form>'});`);
  if (path === "/application/dynamic") return html(`<main id="dynamic"><p>Loading application…</p></main>`, `setTimeout(()=>{document.querySelector('#dynamic').innerHTML='<form><label>Dynamic field<input name="dynamicField"></label></form>'},450);`);
  if (path === "/plane/188f905e-3f6f-4569-9a32-d8ec48dfe656/application") return html(`<main id="ashby"><p>You need to enable JavaScript to run this app.</p></main>`, `setTimeout(()=>{document.querySelector('#ashby').innerHTML='<label>Name<input name="name"></label><label>Email<input type="email" name="email"></label><label>Resume<input type="file" name="resume"></label>';},500);`);
  if (path === "/iframe") return html(`<form><label>Top field<input name="top"></label></form><iframe title="same origin" src="/iframe-inner"></iframe><iframe title="cross origin" src="${crossOrigin}/cross"></iframe>`);
  if (path === "/iframe-inner") return html(`<form><label>Frame field<input name="frameField"></label></form>`);
  return html("<h1>Not found</h1>");
}

function listen(port: number, responder: (path: string) => { status?: number; body: string; contentType?: string }): Promise<Server> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer((request, response) => {
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,OPTIONS", "access-control-allow-headers": "authorization,content-type" });
        response.end();
        return;
      }
      const result = responder(new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname);
      response.writeHead(result.status ?? 200, { "content-type": result.contentType ?? "text/html; charset=utf-8", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type" });
      response.end(result.body);
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise(server));
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}

async function waitFor<T>(read: () => Promise<T | null | false>, label: string, timeoutMs = 6_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 75));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers().find((candidate) => candidate.url().startsWith("chrome-extension://"));
  return existing ?? context.waitForEvent("serviceworker");
}

async function runtimeRecords(worker: Worker): Promise<Array<Record<string, unknown>>> {
  return worker.evaluate(async () => {
    const stored = await chrome.storage.session.get("jobHunter.extension.runtimes.v1");
    return Object.values((stored["jobHunter.extension.runtimes.v1"] ?? {}) as Record<string, Record<string, unknown>>);
  });
}

function structuralHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16_777_619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function waitForPage(worker: Worker, path: string, fieldCount: number, frameId = 0): Promise<Record<string, unknown>> {
  const pathHash = structuralHash(`${fixtureOrigin}${path}`);
  return waitFor(async () => {
    const records = await runtimeRecords(worker);
    return records.find((record) => record.origin === fixtureOrigin
      && record.pathHash === pathHash
      && Number((record.identity as Record<string, unknown>).frameId) === frameId
      && Number((record.lastScan as Record<string, unknown> | null)?.fieldCount ?? -1) >= fieldCount) ?? null;
  }, `${path} scan with ${fieldCount} fields`);
}

async function webMessage(page: Page, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serialized = JSON.stringify(message).replaceAll("<", "\\u003c");
  return page.evaluate(`(async () => {
    const input = ${serialized};
    const nonce = crypto.randomUUID();
    return new Promise((resolvePromise, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("bridge timeout")), 5000);
      const listener = (event) => {
        const value = event.data;
        if (event.source !== window || event.origin !== location.origin || !value || value.source !== "JOB_HUNTER_EXTENSION" || value.nonce !== nonce) return;
        clearTimeout(timeout); window.removeEventListener("message", listener); resolvePromise(value);
      };
      window.addEventListener("message", listener);
      window.postMessage({ source: "JOB_HUNTER_WEB", nonce, ...input }, location.origin);
    });
  })()`) as Promise<Record<string, unknown>>;
}

let authMode: "READY" | "EXPIRED" | "UNAVAILABLE" = "READY";
const fixtureServer = await listen(43101, (path) => ({ body: fixture(path) }));
const crossServer = await listen(43102, () => ({ body: html("<form><label>Cross field<input name=\"cross\"></label></form>") }));
const apiServer = await listen(43110, (path) => {
  if (path !== "/v1/auth/session") return { status: 404, body: JSON.stringify({ error: "not found" }), contentType: "application/json" };
  if (authMode === "EXPIRED") return { status: 401, body: JSON.stringify({ error: "expired" }), contentType: "application/json" };
  if (authMode === "UNAVAILABLE") return { status: 503, body: JSON.stringify({ error: "unavailable" }), contentType: "application/json" };
  return { body: JSON.stringify({
    email: "extension-fixture@example.test",
    account: { type: "TEST", role: "OWNER" },
    candidate: { id: crypto.randomUUID(), new: false },
    onboarding: { stage: "READY", completed: true, version: 1, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() }
  }), contentType: "application/json" };
});

const profile = await mkdtemp(join(tmpdir(), "job-hunter-extension-"));
let context: BrowserContext | null = null;
const pageErrors: string[] = [];

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  let worker = await extensionWorker(context);
  const extensionId = new URL(worker.url()).host;

  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (entry) => { if (entry.type() === "error") pageErrors.push(entry.text()); });

  await page.goto(`${fixtureOrigin}/basic`);
  const basic = await waitForPage(worker, "/basic", 4);
  assert.equal(basic.state, "READY");

  const secondApplicationTab = await context.newPage();
  await secondApplicationTab.goto(`${fixtureOrigin}/basic?second=1`);
  const simultaneous = await waitFor(async () => {
    const records = (await runtimeRecords(worker)).filter((record) => record.origin === fixtureOrigin && Number((record.lastScan as Record<string, unknown> | null)?.fieldCount ?? 0) >= 4);
    return records.length >= 2 ? records : null;
  }, "two isolated application tabs");
  assert.notEqual(
    (simultaneous[0]?.identity as Record<string, unknown>).tabSessionId,
    (simultaneous[1]?.identity as Record<string, unknown>).tabSessionId
  );
  await secondApplicationTab.close();

  await page.goto(`${fixtureOrigin}/ordinary`);
  await waitFor(async () => {
    const records = await runtimeRecords(worker);
    return records.every((record) => record.origin !== fixtureOrigin) || null;
  }, "configured website surface to remain outside employer runtime storage");

  await page.goto(`${fixtureOrigin}/spa`);
  const beforeSpa = await waitForPage(worker, "/spa", 1);
  const beforeSpaPageId = (beforeSpa.identity as Record<string, unknown>).pageInstanceId;
  await page.getByRole("button", { name: "Next route" }).click();
  let afterSpa: Record<string, unknown>;
  try {
    afterSpa = await waitFor(async () => {
      const records = await runtimeRecords(worker);
      return records.find((record) => record.pathHash === structuralHash(`${fixtureOrigin}/spa/profile`) && Number((record.lastScan as Record<string, unknown> | null)?.fieldCount ?? 0) >= 2 && (record.identity as Record<string, unknown>).pageInstanceId !== beforeSpaPageId) ?? null;
    }, "SPA page identity replacement");
  } catch (reason) {
    process.stderr.write(`SPA diagnostics ${page.url()} ${JSON.stringify(await runtimeRecords(worker))}\n`);
    throw reason;
  }
  assert.notEqual((afterSpa.identity as Record<string, unknown>).pageInstanceId, beforeSpaPageId);

  await page.goto(`${fixtureOrigin}/multi`);
  const firstStep = await waitForPage(worker, "/multi", 1);
  const applicationRunId = (firstStep.identity as Record<string, unknown>).applicationRunId;
  await page.getByRole("button", { name: "Next step" }).click();
  const secondStep = await waitFor(async () => {
    const records = await runtimeRecords(worker);
    return records.find((record) => record.pathHash === structuralHash(`${fixtureOrigin}/multi/step/2`) && Number((record.lastScan as Record<string, unknown> | null)?.fieldCount ?? 0) >= 2 && (record.identity as Record<string, unknown>).applicationRunId === applicationRunId) ?? null;
  }, "multi-step application continuity");
  assert.equal((secondStep.identity as Record<string, unknown>).applicationRunId, applicationRunId);

  await page.goto(`${fixtureOrigin}/application/dynamic`);
  const dynamic = await waitForPage(worker, "/application/dynamic", 1);
  assert.equal(dynamic.state, "READY");

  await page.goto(`${fixtureOrigin}/plane/188f905e-3f6f-4569-9a32-d8ec48dfe656/application`);
  const ashbyPath = "/plane/188f905e-3f6f-4569-9a32-d8ec48dfe656/application";
  const pendingAshby = await waitFor(async () => {
    const records = await runtimeRecords(worker);
    return records.find((record) => record.pathHash === structuralHash(`${fixtureOrigin}${ashbyPath}`)
      && (record.identity as Record<string, unknown>).applicationKey
      && ["APPLICATION_DETECTED", "SCANNING", "READY"].includes(String(record.state))) ?? null;
  }, "Ashby-like application URL detected before fields");
  assert.ok((pendingAshby.identity as Record<string, unknown>).applicationKey);
  const ashby = await waitForPage(worker, ashbyPath, 3);
  assert.equal(ashby.state, "READY");
  assert.equal(Number((ashby.lastScan as Record<string, unknown>).formCount) >= 1, true);

  await page.goto(`${fixtureOrigin}/iframe`);
  const iframeTop = await waitForPage(worker, "/iframe", 1);
  assert.ok(Number((iframeTop.lastScan as Record<string, unknown>).fieldCount) >= 1);
  const iframeRecord = await waitFor(async () => (await runtimeRecords(worker)).find((record) => record.pathHash === structuralHash(`${fixtureOrigin}/iframe-inner`) && Number((record.lastScan as Record<string, unknown> | null)?.fieldCount ?? 0) >= 1) ?? null, "same-origin child-frame registration");
  const iframePageId = (iframeRecord.identity as Record<string, unknown>).pageInstanceId;
  await page.evaluate("document.querySelector('iframe[title=\"same origin\"]').src = '/iframe-inner?reload=1'");
  await waitFor(async () => (await runtimeRecords(worker)).find((record) => record.pathHash === structuralHash(`${fixtureOrigin}/iframe-inner`) && (record.identity as Record<string, unknown>).pageInstanceId !== iframePageId) ?? null, "same-origin iframe reload");
  const iframeTelemetry = await waitFor(async () => worker.evaluate(async () => {
    const stored = await chrome.storage.local.get("jobHunter.extension.telemetry.v1");
    const events = Array.isArray(stored["jobHunter.extension.telemetry.v1"]) ? stored["jobHunter.extension.telemetry.v1"] as Array<Record<string, unknown>> : [];
    return events.find((event) => Number((event.metadata as Record<string, unknown> | undefined)?.inaccessibleFrames ?? 0) >= 1) ?? null;
  }), "cross-origin iframe telemetry");
  assert.equal((iframeTelemetry as Record<string, unknown>).containsCandidateValue, false);

  await page.goto(`${fixtureOrigin}/web`);
  const probe = await webMessage(page, { type: "JOB_HUNTER_WEB_PROBE" });
  assert.equal(probe.installed, true);
  const connected = await webMessage(page, { type: "JOB_HUNTER_SESSION_OFFER", accessToken: "browser-fixture-access-token-12345" });
  if (connected.authState !== "READY") {
    const diagnostic = await worker.evaluate(async () => {
      try {
        const response = await fetch("http://127.0.0.1:43110/v1/auth/session", { headers: { authorization: "Bearer browser-fixture-access-token-12345" } });
        return { status: response.status, body: await response.text() };
      } catch (reason) { return { error: reason instanceof Error ? reason.message : String(reason) }; }
    });
    process.stderr.write(`Auth diagnostics ${JSON.stringify({ connected, diagnostic })}\n`);
  }
  assert.equal(connected.authState, "READY");
  authMode = "EXPIRED";
  const expired = await webMessage(page, { type: "JOB_HUNTER_SESSION_OFFER", accessToken: "browser-fixture-access-token-67890" });
  assert.equal(expired.errorCode, "AUTH_EXPIRED");
  authMode = "UNAVAILABLE";
  const unavailable = await webMessage(page, { type: "JOB_HUNTER_SESSION_OFFER", accessToken: "browser-fixture-access-token-24680" });
  assert.equal(unavailable.errorCode, "API_UNAVAILABLE");
  authMode = "READY";
  assert.equal((await webMessage(page, { type: "JOB_HUNTER_SESSION_OFFER", accessToken: "browser-fixture-access-token-13579" })).authState, "READY");
  const durableStorage = await worker.evaluate(async () => chrome.storage.local.get(null));
  assert.equal(JSON.stringify(durableStorage).includes("browser-fixture-access-token"), false);
  assert.equal(JSON.stringify(durableStorage).includes("extension-fixture@example.test"), false);

  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await extensionPage.getByText("Job Hunter Copilot", { exact: true }).waitFor();
  const malformed = await extensionPage.evaluate("chrome.runtime.sendMessage({ type: 'MALFORMED' })");
  assert.equal((malformed as Record<string, unknown>).type, "ERROR_RESPONSE");

  const cdp = await context.newCDPSession(page);
  const targets = await cdp.send("Target.getTargets");
  const serviceWorkerTarget = targets.targetInfos.find((target) => target.type === "service_worker" && target.url.startsWith(`chrome-extension://${extensionId}/`));
  assert.ok(serviceWorkerTarget);
  await cdp.send("Target.closeTarget", { targetId: serviceWorkerTarget.targetId });
  await page.reload();
  worker = await extensionWorker(context);
  const recovered = await webMessage(page, { type: "JOB_HUNTER_WEB_PROBE" });
  assert.equal(recovered.installed, true);
  assert.equal((await runtimeRecords(worker)).some((record) => Number((record.identity as Record<string, unknown>).frameId) === 0), false);

  assert.equal(pageErrors.length, 0);
  await context.close();
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  worker = await extensionWorker(context);
  const coldReloadPage = await context.newPage();
  coldReloadPage.on("pageerror", (error) => pageErrors.push(error.message));
  coldReloadPage.on("console", (entry) => { if (entry.type() === "error") pageErrors.push(entry.text()); });
  await coldReloadPage.goto(`${fixtureOrigin}/web`);
  assert.equal((await webMessage(coldReloadPage, { type: "JOB_HUNTER_WEB_PROBE" })).installed, true);
  assert.equal((await runtimeRecords(worker)).some((record) => Number((record.identity as Record<string, unknown>).frameId) === 0), false);
  assert.equal(pageErrors.length, 0);
  process.stdout.write("Phase I extension browser smoke passed: dashboard exclusion, two-tab isolation, SPA, multi-step, dynamic, iframe/reload, auth, malformed-message, worker recovery and cold extension reload.\n");
} finally {
  await context?.close().catch(() => undefined);
  await Promise.all([close(fixtureServer), close(crossServer), close(apiServer)]);
  await rm(profile, { recursive: true, force: true });
}

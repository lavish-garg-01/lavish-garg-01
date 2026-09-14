import assert from "node:assert/strict";
import test from "node:test";
import { createRequest } from "../shared/contracts.js";
import { AuthSessionStore } from "./auth-session.js";
import type { ExtensionApiClient } from "./api-client.js";
import { BackgroundMessageRouter } from "./message-router.js";
import { MessageReceiptStore } from "./message-receipts.js";
import { RuntimeRegistry } from "./runtime-registry.js";
import type { SiteAccessManager } from "./site-access.js";
import { MemoryStorageArea } from "./storage.js";
import { TelemetryStore } from "./telemetry-store.js";
import { DeliveryQueue } from "./delivery-queue.js";

test("private inbox retries require server acknowledgement and reject stale pages", async () => {
  const storage = new MemoryStorageArea();
  const auth = new AuthSessionStore(storage);
  const runtimes = new RuntimeRegistry(storage);
  const applicationId = crypto.randomUUID(), applicationRunId = crypto.randomUUID(), pageInstanceId = crypto.randomUUID();
  await runtimes.register({ tabId: 63, frameId: 0, pageInstanceId, applicationKey: "app:private-note", origin: "https://jobs.example", pathHash: "12345678", contentVersion: "test" });
  await runtimes.bindRun(63, 0, pageInstanceId, applicationId, applicationRunId);
  let calls = 0;
  const router = new BackgroundMessageRouter({
    config: { apiOrigin: "http://127.0.0.1:3100", webOrigins: [], channel: "development" }, auth, runtimes,
    receipts: new MessageReceiptStore(storage), telemetry: new TelemetryStore(storage), sites: {} as SiteAccessManager,
    api: { captureInbox: async (item: { itemId: string }) => { calls++; if (calls === 1) throw new Error("synthetic outage"); return { itemId: item.itemId, status: "PENDING", idempotentReplay: true }; } } as unknown as ExtensionApiClient
  });
  const request = createRequest("CONTENT_INBOX_CAPTURE", "CONTENT", { pageInstanceId, capture: { schemaVersion: 1, itemId: crypto.randomUUID(), applicationId, applicationRunId, question: "Unknown", answer: "Synthetic private", source: "EXPLICIT_SAVE" } });
  const sender = { tab: { id: 63 }, frameId: 0, url: "https://jobs.example/apply" } as chrome.runtime.MessageSender;
  assert.equal((await router.handle(request, sender)).type, "ERROR_RESPONSE");
  assert.equal((await router.handle(request, sender)).type, "ACK");
  assert.equal(calls, 2, "a claimed transport message must not falsely acknowledge a failed write");
  const stale = createRequest("CONTENT_INBOX_CAPTURE", "CONTENT", { ...request.payload, pageInstanceId: crypto.randomUUID() });
  assert.equal((await router.handle(stale, sender)).type, "ERROR_RESPONSE");
  assert.equal(calls, 2);
  const token = "test-session-retry-consent";
  await auth.offer(token); await auth.bind(crypto.randomUUID(), token);
  const api = { session: async () => { throw new Error("synthetic offline"); }, captureInbox: async (item: { itemId: string }) => { calls++; return { itemId: item.itemId, status: "PENDING", idempotentReplay: false }; } } as unknown as ExtensionApiClient;
  const delivery = new DeliveryQueue(new MemoryStorageArea(), storage, auth, api, "https://api.example.test");
  const durableRouter = new BackgroundMessageRouter({ config: { apiOrigin: "https://api.example.test", webOrigins: [], channel: "development" }, auth, runtimes, receipts: new MessageReceiptStore(storage), telemetry: new TelemetryStore(storage), sites: {} as SiteAccessManager, api, delivery });
  await durableRouter.handle(createRequest("CONTENT_INBOX_CAPTURE", "CONTENT", request.payload), sender);
  assert.equal((await delivery.summary()).queuedNotes,0,"old consent does not authorize offline storage");
  const queued = await durableRouter.handle(createRequest("CONTENT_INBOX_CAPTURE", "CONTENT", { ...request.payload, allowSessionRetry: true }), sender);
  assert.equal(queued.type,"ACK");
  if (queued.type === "ACK") assert.equal(queued.payload.delivery,"QUEUED");
  assert.equal((await delivery.summary()).queuedNotes,1);
});

test("a stale content bundle blocks fill, records a durable failure, and never receives the command", async () => {
  const runtimeGlobals = globalThis as unknown as Record<string, unknown>;
  const originalVersion = runtimeGlobals.__JH_EXTENSION_VERSION__;
  const originalChrome = globalThis.chrome;
  let commandSent = false;
  runtimeGlobals.__JH_EXTENSION_VERSION__ = "2.0.1";
  globalThis.chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://job-hunter/${path}` },
    tabs: {
      query: async () => [{ id: 61, url: "https://jobs.example/application/1" }],
      sendMessage: async () => { commandSent = true; return { accepted: true }; }
    }
  } as unknown as typeof chrome;

  try {
    const storage = new MemoryStorageArea();
    const auth = new AuthSessionStore(storage);
    await auth.offer("t".repeat(16));
    await auth.mark("READY");
    const runtimes = new RuntimeRegistry(storage);
    const applicationRunId = crypto.randomUUID();
    await runtimes.prepareLaunch(61, crypto.randomUUID(), "https://jobs.example", crypto.randomUUID(), applicationRunId);
    await runtimes.register({
      tabId: 61,
      frameId: 0,
      pageInstanceId: crypto.randomUUID(),
      applicationKey: "app:12345678",
      origin: "https://jobs.example",
      pathHash: "12345678",
      contentVersion: "2.0.0"
    });
    const sites = { has: async () => true } as unknown as SiteAccessManager;
    const router = new BackgroundMessageRouter({
      config: { apiOrigin: "http://127.0.0.1:3100", webOrigins: ["http://127.0.0.1:3000"], channel: "development" },
      auth,
      api: {} as ExtensionApiClient,
      runtimes,
      receipts: new MessageReceiptStore(storage),
      telemetry: new TelemetryStore(storage),
      sites
    });
    const request = createRequest("UI_EXECUTE_ACTIVE_TAB", "SIDEPANEL", {});
    const response = await router.handle(request, { url: chrome.runtime.getURL("sidepanel.html") });

    assert.equal(response.type, "ERROR_RESPONSE");
    if (response.type !== "ERROR_RESPONSE") return;
    assert.equal(response.payload.failure.code, "EXTENSION_UPDATE_REQUIRED");
    assert.equal(response.payload.failure.metadata.loadedVersion, "2.0.0");
    assert.equal(response.payload.failure.metadata.expectedVersion, "2.0.1");
    assert.equal(commandSent, false);
    const failed = await runtimes.record(61, 0);
    assert.equal(failed?.state, "FAILED");
    assert.equal(failed?.lastFailure?.failure.code, "EXTENSION_UPDATE_REQUIRED");
  } finally {
    globalThis.chrome = originalChrome;
    if (originalVersion === undefined) delete runtimeGlobals.__JH_EXTENSION_VERSION__;
    else runtimeGlobals.__JH_EXTENSION_VERSION__ = originalVersion;
  }
});

test("side-panel fill targets the child frame that owns the application fields", async () => {
  const runtimeGlobals = globalThis as unknown as Record<string, unknown>;
  const originalVersion = runtimeGlobals.__JH_EXTENSION_VERSION__;
  const originalChrome = globalThis.chrome;
  runtimeGlobals.__JH_EXTENSION_VERSION__ = "test";
  let commandedFrame: number | undefined;
  globalThis.chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://job-hunter/${path}` },
    tabs: {
      query: async () => [{ id: 62, url: "https://jobs.example/application/2" }],
      sendMessage: async (_tabId: number, _command: unknown, options?: { frameId?: number }) => {
        commandedFrame = options?.frameId;
        return { accepted: true };
      }
    }
  } as unknown as typeof chrome;

  try {
    const storage = new MemoryStorageArea();
    const auth = new AuthSessionStore(storage);
    await auth.offer("t".repeat(16));
    await auth.mark("READY");
    const runtimes = new RuntimeRegistry(storage);
    const applicationRunId = crypto.randomUUID();
    await runtimes.prepareLaunch(62, crypto.randomUUID(), "https://jobs.example", crypto.randomUUID(), applicationRunId);
    await runtimes.register({
      tabId: 62, frameId: 0, pageInstanceId: crypto.randomUUID(), applicationKey: "app:top-frame",
      origin: "https://jobs.example", pathHash: "12345678", contentVersion: "test"
    });
    await runtimes.register({
      tabId: 62, frameId: 7, pageInstanceId: crypto.randomUUID(), applicationKey: "app:child-frame",
      origin: "https://jobs.example", pathHash: "87654321", contentVersion: "test"
    });
    await runtimes.recordIntelligence(62, 7, {
      schemaVersion: 1, requestId: crypto.randomUUID(), items: [],
      summary: { resolvedHigh: 0, resolvedMedium: 0, ambiguous: 0, unresolved: 0, unsupported: 0, answerAvailable: 3, aiRequests: 0, cacheHits: 0, durationMs: 0 },
      valuePrivate: true, containsCandidateValue: false
    });
    const sites = { has: async () => true } as unknown as SiteAccessManager;
    const router = new BackgroundMessageRouter({
      config: { apiOrigin: "http://127.0.0.1:3100", webOrigins: ["http://127.0.0.1:3000"], channel: "development" },
      auth, api: {} as ExtensionApiClient, runtimes,
      receipts: new MessageReceiptStore(storage), telemetry: new TelemetryStore(storage), sites
    });
    const response = await router.handle(createRequest("UI_EXECUTE_ACTIVE_TAB", "SIDEPANEL", {}), {
      url: chrome.runtime.getURL("sidepanel.html")
    });
    assert.equal(response.type, "ACK");
    assert.equal(commandedFrame, 7);
  } finally {
    globalThis.chrome = originalChrome;
    if (originalVersion === undefined) delete runtimeGlobals.__JH_EXTENSION_VERSION__;
    else runtimeGlobals.__JH_EXTENSION_VERSION__ = originalVersion;
  }
});

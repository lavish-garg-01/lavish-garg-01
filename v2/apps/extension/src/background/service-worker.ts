import { AuthSessionStore } from "./auth-session.js";
import { ExtensionApiClient } from "./api-client.js";
import { loadExtensionConfig } from "./config.js";
import { BackgroundMessageRouter } from "./message-router.js";
import { MessageReceiptStore } from "./message-receipts.js";
import { RuntimeRegistry } from "./runtime-registry.js";
import { SiteAccessManager } from "./site-access.js";
import { manualApplicationPanelEligible, setApplicationPanel } from "./application-tabs.js";
import { ExtensionRequestSchema, createResponse } from "../shared/contracts.js";
import { safeFailure } from "../shared/errors.js";
import { ChromeStorageArea } from "./storage.js";
import { TelemetryStore } from "./telemetry-store.js";
import { DeliveryQueue } from "./delivery-queue.js";
import { consumeLaunchGesture } from "./side-panel-gesture.js";

interface BackgroundRuntime {
  router: BackgroundMessageRouter;
  runtimes: RuntimeRegistry;
  sites: SiteAccessManager;
  webOrigins: readonly string[];
  apiOrigin: string;
  delivery: DeliveryQueue;
}

async function initialize(): Promise<BackgroundRuntime> {
  const sessionStorage = new ChromeStorageArea(chrome.storage.session);
  const localStorage = new ChromeStorageArea(chrome.storage.local);
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const config = await loadExtensionConfig();
  const auth = new AuthSessionStore(sessionStorage);
  const runtimes = new RuntimeRegistry(sessionStorage);
  const sites = new SiteAccessManager();
  const api = new ExtensionApiClient(config, auth);
  const delivery = new DeliveryQueue(localStorage, sessionStorage, auth, api, config.apiOrigin);
  const router = new BackgroundMessageRouter({
    config,
    auth,
    api,
    delivery,
    runtimes,
    receipts: new MessageReceiptStore(sessionStorage),
    telemetry: new TelemetryStore(localStorage),
    sites
  });
  await runtimes.recover();
  await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: false });
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id === undefined) continue;
    const enabled = manualApplicationPanelEligible(tab.url ?? tab.pendingUrl, config.webOrigins);
    await setApplicationPanel(tab.id, enabled).catch(() => undefined);
  }
  await sites.reconcile(config.webOrigins, config.apiOrigin);
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.alarms.create("jobHunter.delivery", { periodInMinutes: 1 });
  void delivery.flush();
  return { router, runtimes, sites, delivery, webOrigins: config.webOrigins, apiOrigin: config.apiOrigin };
}

const runtime = initialize();
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "jobHunter.delivery") void runtime.then(({ delivery }) => delivery.flush()).catch(() => undefined);
});

// MV3 requires listeners to be registered synchronously at module evaluation.
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  const parsed = ExtensionRequestSchema.safeParse(message);
  // Opening a side panel is allowed only while Chrome still considers the
  // dashboard click a user gesture. Do this synchronously, before runtime
  // initialization, API calls, permission checks or creation of the employer
  // tab. The panel remains available as the new application tab becomes active.
  if (parsed.success) consumeLaunchGesture(parsed.data, sender);
  // Consume this explicit click synchronously, before the initialization await
  // loses Chrome's user-gesture token. Only the sender's own tab can be opened.
  if (parsed.success && parsed.data.type === "CONTENT_OPEN_PANEL" && sender.tab?.id !== undefined && sender.url?.startsWith("http")) {
    const id = parsed.data.messageId;
    void chrome.sidePanel.open({ tabId: sender.tab.id }).then(() => respond(createResponse("ACK", id, { accepted: true }))).catch((reason) => respond(createResponse("ERROR_RESPONSE", id, { failure: safeFailure(reason) })));
    return true;
  }
  void runtime.then(({ router }) => router.handle(message, sender)).then(respond).catch(() => respond(undefined));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => { void runtime.then(({ runtimes }) => runtimes.removeTab(tabId)); });
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!change.url && change.status !== "loading") return;
  void runtime.then(async ({ webOrigins }) => {
    const enabled = manualApplicationPanelEligible(change.url ?? tab.url ?? tab.pendingUrl, webOrigins);
    await setApplicationPanel(tabId, enabled);
  }).catch(() => undefined);
});
chrome.runtime.onInstalled.addListener(() => {
  void runtime.then(async ({ sites, webOrigins, apiOrigin }) => {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await sites.reconcile(webOrigins, apiOrigin);
  });
});
chrome.runtime.onStartup.addListener(() => {
  void runtime.then(async ({ runtimes, sites, webOrigins, apiOrigin }) => {
    await runtimes.recover();
    await sites.reconcile(webOrigins, apiOrigin);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { groupApplicationTabs, manualApplicationPanelEligible, setApplicationPanel } from "./application-tabs.js";

test("manual Copilot access is available on employer web pages but not the dashboard or browser pages", () => {
  const webOrigins = ["http://127.0.0.1:3000"];
  assert.equal(manualApplicationPanelEligible("https://jobs.smartrecruiters.com/oneclick-ui/company/BoschGroup/publication/id", webOrigins), true);
  assert.equal(manualApplicationPanelEligible("https://employer.example/careers/custom-flow", webOrigins), true);
  assert.equal(manualApplicationPanelEligible("http://127.0.0.1:3000/#jobs", webOrigins), false);
  assert.equal(manualApplicationPanelEligible("chrome://extensions", webOrigins), false);
});

test("application grouping preserves unrelated user groups and reuses only its window's group", async () => {
  const original = globalThis.chrome;
  const calls: unknown[] = [];
  let appGroup = -1;
  globalThis.chrome = {
    tabs: { get: async (id: number) => ({ id, windowId: 3, groupId: id === 1 ? 99 : appGroup }), group: async (options: unknown) => { calls.push(options); return 7; } },
    tabGroups: { query: async (options: unknown) => { calls.push(options); return [{ id: 7 }]; }, update: async () => undefined },
    sidePanel: { setOptions: async (options: unknown) => { calls.push(options); } }
  } as unknown as typeof chrome;
  try {
    await groupApplicationTabs(1, 2);
    assert.deepEqual(calls, [{ windowId: 3, title: "Job Hunter · Applying" }, { groupId: 7, tabIds: [2] }]);
    calls.length = 0; appGroup = 99;
    await groupApplicationTabs(1, 2);
    assert.equal(calls.length, 1, "Do not move an already grouped employer tab");
    await setApplicationPanel(2, false);
    assert.deepEqual(calls.at(-1), { tabId: 2, path: "sidepanel.html", enabled: false });
  } finally { globalThis.chrome = original; }
});

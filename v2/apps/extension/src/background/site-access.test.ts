import assert from "node:assert/strict";
import test from "node:test";
import { contentRuntimeVersionMatches, originFromTabUrl } from "./message-router.js";
import { exactOriginPattern, SiteAccessManager } from "./site-access.js";

test("tab URLs without host permission do not invent an origin", () => {
  assert.equal(originFromTabUrl(undefined), null);
  assert.equal(originFromTabUrl("chrome://extensions"), null);
  assert.equal(originFromTabUrl("https://jobs.ashbyhq.com/plane/188f905e-3f6f-4569-9a32-d8ec48dfe656/application"), "https://jobs.ashbyhq.com");
});

test("content runtime compatibility requires an exact loaded bundle version", () => {
  assert.equal(contentRuntimeVersionMatches("2.0.1", "2.0.1"), true);
  assert.equal(contentRuntimeVersionMatches("2.0.0", "2.0.1"), false);
  assert.equal(contentRuntimeVersionMatches("unknown", "2.0.1"), false);
  assert.equal(contentRuntimeVersionMatches(null, "2.0.1"), false);
});

test("optional employer access registers and recovers an already-open tab", async () => {
  const originalChrome = globalThis.chrome;
  const registered: chrome.scripting.RegisteredContentScript[] = [];
  const injections: chrome.scripting.ScriptInjection<[], unknown>[] = [];
  globalThis.chrome = {
    permissions: {
      contains: async ({ origins }: chrome.permissions.Permissions) => origins?.[0] === "https://jobs.example/*"
    },
    scripting: {
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => { registered.push(...scripts); },
      updateContentScripts: async () => undefined,
      executeScript: async (injection: chrome.scripting.ScriptInjection<[], unknown>) => { injections.push(injection); return []; }
    }
  } as unknown as typeof chrome;
  try {
    const manager = new SiteAccessManager();
    await manager.injectExistingTab(42, "https://jobs.example/application/1");
    assert.equal(exactOriginPattern("https://jobs.example/application/1"), "https://jobs.example/*");
    assert.equal(registered[0]?.matches?.[0], "https://jobs.example/*");
    assert.deepEqual(injections[0]?.target, { tabId: 42, allFrames: true });
    assert.deepEqual(injections[0]?.files, ["content.js"]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

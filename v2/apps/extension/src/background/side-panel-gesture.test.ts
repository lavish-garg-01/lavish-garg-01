import assert from "node:assert/strict";
import test from "node:test";
import { consumeLaunchGesture, isWebLaunchRequest } from "./side-panel-gesture.js";

test("dashboard Apply clicks are recognized as launch gestures before any await", () => {
  assert.equal(isWebLaunchRequest({ type: "WEB_LAUNCH_REQUEST" }), true);
  assert.equal(isWebLaunchRequest({ type: "UI_STATUS_REQUEST" }), false);
  assert.equal(isWebLaunchRequest(null), false);
});

test("launch gestures open the side panel in the same turn as the dashboard click", () => {
  const originalChrome = globalThis.chrome;
  const opened: Array<Record<string, unknown>> = [];
  globalThis.chrome = {
    sidePanel: {
      open: (options: chrome.sidePanel.OpenOptions) => {
        opened.push(options);
        return Promise.resolve();
      },
      setOptions: async () => undefined
    }
  } as unknown as typeof chrome;
  try {
    consumeLaunchGesture({ type: "WEB_LAUNCH_REQUEST" }, { tab: { id: 9, windowId: 4 } } as chrome.runtime.MessageSender);
    assert.deepEqual(opened, [{ windowId: 4 }]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

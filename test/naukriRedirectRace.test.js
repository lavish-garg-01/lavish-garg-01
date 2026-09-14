import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const background = fs.readFileSync(path.join(root, "extension/background.js"), "utf8");

function redirectHarness() {
    const start = background.indexOf("function isNaukriRedirectReceipt");
    const end = background.indexOf("async function moveSessionToAttention", start);
    assert.ok(start >= 0 && end > start, "redirect helpers must remain testable as one background block");
    const updates = [];
    const removals = [];
    const storageWrites = [];
    const progress = [];
    const sandbox = {
        URL,
        encodeURIComponent,
        pendingSourceRedirects: new Map(),
        closingTabs: new Set(),
        setTimeout: (callback, delay) => ({ callback, delay }),
        clearTimeout: () => {},
        shouldKeepSeparatePopup: () => false,
        safeApplicationDestination: (url) => new URL(url).href,
        request: async (url, options) => { progress.push({ url, body: JSON.parse(options.body) }); },
        chrome: {
            runtime: { getManifest: () => ({ version: "test-version" }) },
            storage: {
                local: {
                    get: async () => ({ activeTabId: 10, activeJob: { id: "job-1" } }),
                    set: async (value) => { storageWrites.push(value); }
                }
            },
            tabs: {
                get: async (tabId) => ({ id: tabId, url: "https://www.naukri.com/job-listings-backend-engineer" }),
                update: async (tabId, value) => { updates.push({ tabId, ...value }); },
                remove: async (tabId) => { removals.push(tabId); }
            }
        }
    };
    vm.runInNewContext(background.slice(start, end), sandbox);
    return { sandbox, updates, removals, storageWrites, progress };
}

test("Naukri employer child waits for the redirect receipt before replacing the source tab", async () => {
    const harness = redirectHarness();
    const target = "https://careers.example.com/jobs/backend/apply";

    assert.equal(await harness.sandbox.foldCreatedNavigationTarget(10, 20, target), true);
    assert.equal(harness.updates.length, 0, "the employer URL must not race Naukri's pending receipt navigation");
    assert.equal(harness.removals.length, 0, "the only surviving employer target must remain open until captured");
    assert.equal(harness.sandbox.pendingSourceRedirects.get(10).targetUrl, target);

    assert.equal(harness.sandbox.isNaukriRedirectReceipt(
        "https://www.naukri.com/myapply/showAcp?file=123&multiApplyResp=x"
    ), true);
    await harness.sandbox.settleDeferredChildFold(10, "receipt");

    assert.deepEqual(harness.updates, [{ tabId: 10, url: target, active: true }]);
    assert.deepEqual(harness.removals, [20]);
    assert.equal(harness.storageWrites.at(-1).activeApplicationUrl, target);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.progress[0].body.metadata.redirectRecovered, true);
    assert.equal(harness.progress[0].body.metadata.targetHost, "careers.example.com");
});

test("about:blank child destinations use the same deferred Naukri fold", async () => {
    const harness = redirectHarness();
    const target = "https://jobs.example.org/apply/42";
    assert.equal(await harness.sandbox.foldCreatedNavigationTarget(10, 21, target), true);
    const pending = harness.sandbox.pendingSourceRedirects.get(10);
    assert.equal(pending.childTabId, 21);
    assert.equal(pending.timer.delay, 2500);
    await pending.timer.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(harness.updates, [{ tabId: 10, url: target, active: true }]);
    assert.deepEqual(harness.removals, [21]);
});

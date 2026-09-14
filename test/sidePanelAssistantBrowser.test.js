import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("side panel Ask AI remains available without a prepared application", async (t) => {
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const html = fs.readFileSync(path.join(root, "extension/sidepanel.html"), "utf8")
        .replace('<script src="sidepanel.js"></script>', "");
    await page.setContent(html);
    await page.evaluate(() => {
        const listeners = [];
        globalThis.chrome = {
            runtime: {
                lastError: null,
                connect: () => ({
                    onMessage: { addListener: () => {} },
                    onDisconnect: { addListener: () => {} },
                    postMessage: () => {}
                }),
                sendMessage: (message, callback) => {
                    if (message.type === "GET_SIDECAR_STATE") {
                        callback({ ok: true, result: {
                            currentTab: { id: 1, url: "http://127.0.0.1:3001/" },
                            allJobSitesEnabled: true,
                            siteAccess: true,
                            profileDetails: { aiProcessingConsent: true },
                            quickCopy: { name: "Test Candidate" }
                        } });
                        return;
                    }
                    if (message.type === "SIDEPANEL_ASK_AI") {
                        callback({ ok: true, result: {
                            answer: "30 days",
                            grounded: true,
                            copyReady: true,
                            needsCandidateInput: false,
                            safety: "SAFE",
                            evidence: ["Saved profile fact."],
                            source: "LOCAL_PROFILE"
                        } });
                        return;
                    }
                    callback({ ok: true, result: {} });
                }
            },
            storage: { local: { get: async () => ({}) } },
            tabs: { onActivated: { addListener: (listener) => listeners.push(listener) } },
            permissions: { request: async () => true }
        };
    });
    await page.addScriptTag({ path: path.join(root, "extension/sidepanel.js") });
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await page.getByRole("textbox", { name: "Ask Job Hunter AI" }).fill("What is my notice period?");
    await page.locator("[data-assistant-send]").click();
    await page.waitForTimeout(100);
    assert.match(await page.locator("body").innerText(), /30 days/);
    assert.equal(await page.getByRole("button", { name: "Copy answer" }).isVisible(), true);
    assert.match(await page.locator(".assistant-safety").innerText(), /never changes the employer form/i);
});

import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { env } from "../config/environment.js";

let contextPromise = null;
const pages = new Map();

async function context() {
    if (!contextPromise) {
        const profilePath = path.join(env.paths.storage, "browser-profile");
        fs.mkdirSync(profilePath, { recursive: true });
        contextPromise = chromium.launchPersistentContext(profilePath, {
            headless: env.copilot.playwrightHeadless,
            viewport: { width: 1280, height: 900 }
        }).catch((error) => {
            contextPromise = null;
            throw error;
        });
    }
    return contextPromise;
}

export async function applicationPage(applicationId) {
    const existing = pages.get(applicationId);
    if (existing && !existing.isClosed()) return existing;
    const browserContext = await context();
    const page = await browserContext.newPage();
    pages.set(applicationId, page);
    return page;
}

export async function closeBrowserManager() {
    if (contextPromise) {
        const browserContext = await contextPromise;
        await browserContext.close();
    }
    contextPromise = null;
    pages.clear();
}

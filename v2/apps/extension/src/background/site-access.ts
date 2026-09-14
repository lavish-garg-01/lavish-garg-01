import { structuralHash } from "../shared/identity.js";

export function exactOriginPattern(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("UNSUPPORTED_ORIGIN");
  return `${parsed.origin}/*`;
}

export class SiteAccessManager {
  async has(pattern: string): Promise<boolean> { return chrome.permissions.contains({ origins: [pattern] }); }

  async register(pattern: string): Promise<void> {
    if (!(await this.has(pattern))) throw new Error("PERMISSION_REQUIRED");
    const id = `job-hunter-v2-${structuralHash(pattern)}`;
    const registration: chrome.scripting.RegisteredContentScript = {
      id, matches: [pattern], js: ["content.js"], allFrames: true, persistAcrossSessions: true, runAt: "document_idle"
    };
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    if (existing.length) await chrome.scripting.updateContentScripts([registration]);
    else await chrome.scripting.registerContentScripts([registration]);
  }

  async injectExistingTab(tabId: number, origin: string): Promise<void> {
    const pattern = exactOriginPattern(origin);
    if (!(await this.has(pattern))) throw new Error("PERMISSION_REQUIRED");
    await this.register(pattern);
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
  }

  async reconcile(webOrigins: readonly string[], apiOrigin: string): Promise<void> {
    const permissions = await chrome.permissions.getAll();
    const reserved = new Set([...webOrigins, apiOrigin].map(exactOriginPattern));
    for (const pattern of permissions.origins ?? []) {
      if (reserved.has(pattern) || !/^https?:\/\/[^/]+\/\*$/.test(pattern)) continue;
      await this.register(pattern).catch(() => undefined);
    }
  }
}

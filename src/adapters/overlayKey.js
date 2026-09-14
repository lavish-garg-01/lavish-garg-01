/** Tenant overlay identity: hostname, optional board slug, then portal-level pack. */

export function hostnameOf(value = "") {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "";
    try {
        if (raw.includes("://")) return new URL(raw).hostname.toLowerCase();
    } catch { /* fall through */ }
    return raw.replace(/^www\./, "").split("/")[0];
}

function pathParts(url) {
    try {
        const href = String(url || "");
        const parsed = new URL(href.includes("://") ? href : `https://${href}`);
        return parsed.pathname.split("/").filter(Boolean);
    } catch {
        return [];
    }
}

export function isPortalLevelHost(siteHost, portalKind) {
    const host = String(siteHost || "").trim().toLowerCase();
    const kind = String(portalKind || "").trim().toLowerCase();
    return host === "*" || (kind && host === kind);
}

export function boardSlugFromUrl(url = "", portalKind = "generic") {
    const host = hostnameOf(url).replace(/^www\./, "");
    const parts = pathParts(url).map((part) => decodeURIComponent(part));
    const kind = String(portalKind || "generic").toLowerCase();
    if (kind === "greenhouse") {
        const board = parts.find((part) => part && !/^(jobs|embed|job_app)$/i.test(part));
        return board && !/^\d+$/.test(board) ? board.toLowerCase() : "";
    }
    if (kind === "lever" || kind === "ashby") {
        const company = parts[0] || "";
        return company && !/^\d+$/.test(company) ? company.toLowerCase() : "";
    }
    if (kind === "wellfound") {
        if (parts[0] === "company" && parts[1]) return parts[1].toLowerCase();
        return "";
    }
    if (kind === "workday") {
        const tenant = host.split(".")[0];
        return tenant && !/^(www|wd\d+)$/i.test(tenant) ? tenant.toLowerCase() : "";
    }
    if (kind === "rippling" || kind === "keka") {
        const sub = host.split(".")[0];
        return sub && !["www", "app", "ats", kind].includes(sub) ? sub.toLowerCase() : "";
    }
    return "";
}

export function overlayKeysForUrl(url = "", portalKind = "generic") {
    const host = hostnameOf(url).replace(/^www\./, "") || "unknown-site";
    const kind = String(portalKind || "generic").toLowerCase() || "generic";
    const slug = boardSlugFromUrl(url, kind);
    const keys = [];
    if (slug) keys.push(`${host}/${slug}`);
    if (host) keys.push(host);
    if (kind) keys.push(kind);
    keys.push("*");
    return [...new Set(keys)];
}

function uniqueStrings(values = []) {
    return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function mergeFileFields(base = {}, extra = {}) {
    const keys = new Set([...Object.keys(base || {}), ...Object.keys(extra || {})]);
    const merged = {};
    for (const key of keys) {
        const left = base?.[key] || {};
        const right = extra?.[key] || {};
        merged[key] = {
            ...left,
            ...right,
            testIds: uniqueStrings([...(left.testIds || []), ...(right.testIds || [])]),
            labelPatterns: uniqueStrings([...(left.labelPatterns || []), ...(right.labelPatterns || [])])
        };
    }
    return merged;
}

export function mergePacks(...packs) {
    return packs.filter((pack) => pack && typeof pack === "object").reduce((merged, pack) => ({
        ...merged,
        ...pack,
        portalKind: pack.portalKind || merged.portalKind,
        version: pack.version || merged.version,
        stage: pack.stage || merged.stage,
        skipSelectors: uniqueStrings([...(merged.skipSelectors || []), ...(pack.skipSelectors || [])]),
        neverFill: uniqueStrings([...(merged.neverFill || []), ...(pack.neverFill || [])]),
        fileFields: mergeFileFields(merged.fileFields, pack.fileFields),
        overlays: { ...(merged.overlays || {}), ...(pack.overlays || {}) },
        controlKindAliases: { ...(merged.controlKindAliases || {}), ...(pack.controlKindAliases || {}) },
        hotPath: {
            ...(merged.hotPath || {}),
            ...(pack.hotPath || {}),
            skipLlmOn: uniqueStrings([...(merged.hotPath?.skipLlmOn || []), ...(pack.hotPath?.skipLlmOn || [])])
        }
    }), {
        skipSelectors: [],
        neverFill: ["password", "otp", "captcha", "legal"],
        fileFields: {},
        overlays: {},
        controlKindAliases: {},
        hotPath: { skipLlmOn: [] }
    });
}

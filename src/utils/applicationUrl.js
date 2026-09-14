const LINKEDIN_HOSTS = new Set(["linkedin.com", "www.linkedin.com", "in.linkedin.com"]);

function decodeRepeatedly(value, maxPasses = 2) {
    let current = String(value || "").replaceAll("&amp;", "&");
    for (let pass = 0; pass < maxPasses; pass += 1) {
        try {
            const decoded = decodeURIComponent(current);
            if (decoded === current) break;
            current = decoded;
        } catch { break; }
    }
    return current;
}

export function resolveApplicationUrl(rawUrl) {
    const original = new URL(String(rawUrl || "").trim());
    if (!new Set(["http:", "https:"]).has(original.protocol)) throw new Error("Only web application URLs can be opened.");
    const isLinkedInSafety = LINKEDIN_HOSTS.has(original.hostname.toLowerCase())
        && original.pathname.replace(/\/+$/, "") === "/safety/go";
    if (!isLinkedInSafety) return { url: original.href, unwrapped: false, source: null };
    const embedded = original.searchParams.get("url");
    if (!embedded) throw new Error("This LinkedIn safety link has expired or lost its employer destination. Open the LinkedIn job again and click Apply.");
    const target = new URL(decodeRepeatedly(embedded));
    if (!new Set(["http:", "https:"]).has(target.protocol)) throw new Error("LinkedIn supplied an unsafe application destination.");
    if (LINKEDIN_HOSTS.has(target.hostname.toLowerCase()) && target.pathname.replace(/\/+$/, "") === "/safety/go") {
        throw new Error("LinkedIn supplied a recursive safety redirect.");
    }
    return { url: target.href, unwrapped: true, source: original.href };
}

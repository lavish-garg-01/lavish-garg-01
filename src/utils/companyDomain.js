const NON_COMPANY_HOSTS = new Set([
    "linkedin.com",
    "www.linkedin.com",
    "in.linkedin.com"
]);

export function normalizeCompanyDomain(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;

    try {
        const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
        const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
        if (!hostname || NON_COMPANY_HOSTS.has(hostname) || hostname.endsWith(".linkedin.com")) {
            return null;
        }
        if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(hostname)) {
            return null;
        }
        return hostname;
    } catch {
        return null;
    }
}

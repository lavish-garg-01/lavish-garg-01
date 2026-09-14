const PORTALS = [
    {
        id: "rippling",
        version: "1.0.0",
        label: "Rippling",
        hosts: ["rippling.com"],
        identityHotPath: true
    },
    {
        id: "greenhouse",
        version: "1.0.0",
        label: "Greenhouse",
        hosts: ["greenhouse.io", "boards.greenhouse.io", "job-boards.greenhouse.io"],
        identityHotPath: true
    },
    {
        id: "workday",
        version: "1.0.0",
        label: "Workday",
        hosts: ["myworkdayjobs.com", "workday.com"],
        identityHotPath: true
    },
    {
        id: "keka",
        version: "1.0.0",
        label: "Keka",
        hosts: ["keka.com"],
        identityHotPath: true
    },
    {
        id: "lever",
        version: "1.0.0",
        label: "Lever",
        hosts: ["lever.co", "jobs.lever.co"],
        identityHotPath: true
    },
    {
        id: "ashby",
        version: "1.0.0",
        label: "Ashby",
        hosts: ["ashbyhq.com", "jobs.ashbyhq.com"],
        identityHotPath: true
    },
    {
        id: "smartrecruiters",
        version: "1.0.0",
        label: "SmartRecruiters",
        hosts: ["smartrecruiters.com", "jobs.smartrecruiters.com"],
        identityHotPath: true
    },
    {
        id: "pinpoint",
        version: "1.0.0",
        label: "Pinpoint",
        hosts: ["pinpointhq.com"],
        identityHotPath: true
    },
    {
        id: "phenom",
        version: "1.0.0",
        label: "Phenom",
        hosts: ["phenompeople.com", "careers.cisco.com"],
        identityHotPath: true
    },
    {
        id: "naukri",
        version: "1.0.0",
        label: "Naukri",
        hosts: ["naukri.com"],
        identityHotPath: true
    },
    {
        id: "instahyre",
        version: "1.0.0",
        label: "Instahyre",
        hosts: ["instahyre.com"],
        identityHotPath: true
    },
    {
        id: "wellfound",
        version: "1.0.0",
        label: "Wellfound",
        hosts: ["wellfound.com", "angel.co"],
        identityHotPath: true
    },
    {
        id: "linkedin",
        version: "1.0.0",
        label: "LinkedIn",
        hosts: ["linkedin.com"],
        identityHotPath: true
    },
    {
        id: "generic",
        version: "1.0.0",
        label: "Generic ATS",
        hosts: [],
        identityHotPath: true
    }
];

function hostnameOf(value = "") {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "";
    try {
        if (raw.includes("://")) return new URL(raw).hostname.toLowerCase();
    } catch { /* fall through */ }
    return raw.replace(/^www\./, "").split("/")[0];
}

function hostMatches(hostname, pattern) {
    const host = String(hostname || "").replace(/^www\./, "");
    const needle = String(pattern || "").replace(/^www\./, "").toLowerCase();
    return host === needle || host.endsWith(`.${needle}`);
}

export function listPortals() {
    return PORTALS.map((portal) => ({ ...portal, hosts: [...portal.hosts] }));
}

export function resolvePortal(hostnameOrUrl = "") {
    const hostname = hostnameOf(hostnameOrUrl);
    const match = PORTALS.find((portal) => portal.id !== "generic" && portal.hosts.some((host) => hostMatches(hostname, host)))
        || PORTALS.find((portal) => portal.id !== "generic" && portal.id === hostname);
    const portal = match || PORTALS.find((item) => item.id === "generic");
    return {
        id: portal.id,
        portalKind: portal.id,
        version: portal.version,
        label: portal.label,
        hostname: hostname || "unknown-site",
        identityHotPath: portal.identityHotPath !== false
    };
}

export function portalKindFor(hostnameOrUrl = "") {
    return resolvePortal(hostnameOrUrl).portalKind;
}

export function hostFor(url = "") {
    return resolvePortal(url).hostname || "unknown-site";
}

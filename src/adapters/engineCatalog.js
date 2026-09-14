import { listPortals, resolvePortal } from "./registry.js";

// This catalog is deliberately separate from the runtime registry. An engine is
// not advertised as supported until it has an adapter pack plus Form A/B locks.
// Discovery-only entries help cluster unknown sites without enabling autofill.
export const DISCOVERY_ONLY_ENGINES = Object.freeze([
    { id: "icims", label: "iCIMS", hosts: ["icims.com"] },
    { id: "taleo", label: "Oracle Taleo", hosts: ["taleo.net"] },
    { id: "oracle-recruiting", label: "Oracle Recruiting Cloud", hosts: ["oraclecloud.com"] },
    { id: "successfactors", label: "SAP SuccessFactors", hosts: ["successfactors.com"] },
    { id: "jobvite", label: "Jobvite", hosts: ["jobvite.com"] },
    { id: "eightfold", label: "Eightfold", hosts: ["eightfold.ai"] },
    { id: "avature", label: "Avature", hosts: ["avature.net"] },
    { id: "darwinbox", label: "Darwinbox", hosts: ["darwinbox.in", "darwinbox.com"] },
    { id: "freshteam", label: "Freshteam", hosts: ["freshteam.com"] },
    { id: "bamboohr", label: "BambooHR", hosts: ["bamboohr.com"] },
    { id: "breezy", label: "Breezy HR", hosts: ["breezy.hr"] },
    { id: "recruitee", label: "Recruitee", hosts: ["recruitee.com"] },
    { id: "teamtailor", label: "Teamtailor", hosts: ["teamtailor.com"] },
    { id: "zoho-recruit", label: "Zoho Recruit", hosts: ["zohorecruit.com"] },
    { id: "jazzhr", label: "JazzHR", hosts: ["applytojob.com"] },
    { id: "pageup", label: "PageUp", hosts: ["pageuppeople.com"] },
    { id: "cornerstone", label: "Cornerstone", hosts: ["csod.com"] },
    { id: "ukg", label: "UKG", hosts: ["ultipro.com", "ukg.com"] },
    { id: "adp", label: "ADP Recruiting", hosts: ["adp.com"] },
    { id: "peoplestrong", label: "PeopleStrong", hosts: ["peoplestrong.com"] },
    { id: "indeed", label: "Indeed", hosts: ["indeed.com", "indeed.co.in"] },
    { id: "cutshort", label: "Cutshort", hosts: ["cutshort.io"] }
]);

function hostnameOf(value = "") {
    try { return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, ""); }
    catch { return String(value || "").toLowerCase().replace(/^www\./, "").split("/")[0]; }
}

function matches(hostname, suffix) {
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function classifyEngineCoverage(urlOrHost = "") {
    const hostname = hostnameOf(urlOrHost);
    const resolved = resolvePortal(hostname);
    if (resolved.portalKind !== "generic") {
        return { tier: "REGRESSION_LOCKED", portalKind: resolved.portalKind, hostname };
    }
    const discovered = DISCOVERY_ONLY_ENGINES.find((engine) => engine.hosts.some((host) => matches(hostname, host)));
    if (discovered) {
        return { tier: "DISCOVERY_ONLY", portalKind: discovered.id, hostname };
    }
    return { tier: "GENERIC_FALLBACK", portalKind: "generic", hostname: hostname || "unknown-site" };
}

export function engineCoverageCatalog() {
    const locked = listPortals().filter((portal) => portal.id !== "generic");
    return {
        regressionLocked: locked,
        genericFallback: listPortals().find((portal) => portal.id === "generic"),
        discoveryOnly: DISCOVERY_ONLY_ENGINES.map((engine) => ({ ...engine, hosts: [...engine.hosts] }))
    };
}

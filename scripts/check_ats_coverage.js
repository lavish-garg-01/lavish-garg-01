import { getDb, closeDb } from "../src/database/connection.js";
import { classifyEngineCoverage, engineCoverageCatalog } from "../src/adapters/engineCatalog.js";
import { campaignSummary } from "../src/services/certificationCampaign.js";

const db = getDb();
const catalog = engineCoverageCatalog();
const urls = db.prepare(`
    SELECT url FROM jobs WHERE COALESCE(url, '') != ''
    UNION
    SELECT page_url AS url FROM application_field_evidence WHERE COALESCE(page_url, '') != ''
    UNION
    SELECT page_url AS url FROM application_page_snapshots WHERE COALESCE(page_url, '') != ''
`).all().map((row) => row.url);

const observed = new Map();
for (const url of urls) {
    const result = classifyEngineCoverage(url);
    const key = `${result.tier}:${result.portalKind}`;
    const item = observed.get(key) || { ...result, hosts: new Set(), urls: 0 };
    item.hosts.add(result.hostname);
    item.urls += 1;
    observed.set(key, item);
}

const report = {
    generatedAt: new Date().toISOString(),
    policy: "Only REGRESSION_LOCKED engines may be described as supported. DISCOVERY_ONLY is telemetry/backlog, not autofill support.",
    catalog: {
        regressionLocked: catalog.regressionLocked.length,
        discoveryOnly: catalog.discoveryOnly.length,
        genericFallback: Boolean(catalog.genericFallback)
    },
    campaign: campaignSummary(),
    observed: [...observed.values()].map((item) => ({ ...item, hosts: [...item.hosts].sort() }))
        .sort((a, b) => a.tier.localeCompare(b.tier) || b.urls - a.urls)
};

console.log(JSON.stringify(report, null, 2));
closeDb();

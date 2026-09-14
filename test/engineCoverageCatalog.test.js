import assert from "node:assert/strict";
import test from "node:test";
import { classifyEngineCoverage, engineCoverageCatalog } from "../src/adapters/engineCatalog.js";

test("coverage catalog never presents discovery-only engines as autofill support", () => {
    const catalog = engineCoverageCatalog();
    assert.equal(catalog.regressionLocked.some((entry) => entry.id === "phenom"), true);
    assert.equal(catalog.discoveryOnly.length >= 20, true);
    assert.equal(catalog.discoveryOnly.some((entry) => entry.id === "indeed"), true);
    assert.equal(catalog.regressionLocked.some((entry) => entry.id === "indeed"), false);
});

test("coverage classification is truthful for locked, discovery, and unknown hosts", () => {
    assert.deepEqual(
        classifyEngineCoverage("https://careers.cisco.com/global/en/apply"),
        { tier: "REGRESSION_LOCKED", portalKind: "phenom", hostname: "careers.cisco.com" }
    );
    assert.equal(classifyEngineCoverage("https://jobs.smartrecruiters.com/acme").tier, "REGRESSION_LOCKED");
    assert.deepEqual(
        classifyEngineCoverage("https://acme.icims.com/jobs/1"),
        { tier: "DISCOVERY_ONLY", portalKind: "icims", hostname: "acme.icims.com" }
    );
});

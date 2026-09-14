import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = fs.readFileSync(path.join(root, "extension/content.js"), "utf8");
const hops = fs.readFileSync(path.join(root, "extension/adapters/common/hops.js"), "utf8");
const scripts = `${content}\n${hops}`;

function contentConstant(name) {
    const match = content.match(new RegExp(`const ${name} = (\\/[\\s\\S]*?\\/i);`));
    assert.ok(match, `${name} must remain a single extractable regular expression`);
    return eval(match[1]);
}

test("Instahyre is a known portal on both the server and the extension", async () => {
    const { portalKindFor, listPortals } = await import("../src/adapters/registry.js");
    assert.equal(portalKindFor("https://www.instahyre.com/job/12345"), "instahyre");
    assert.equal(listPortals().some((portal) => portal.id === "instahyre"), true);

    const sandbox = { URL, globalThis: {} };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(root, "extension/adapters/registry.js"), "utf8"), sandbox);
    assert.equal(sandbox.JobHunterAdapterRegistry.portalKindFor("https://www.instahyre.com/job/12345"), "instahyre");

    const pack = JSON.parse(fs.readFileSync(path.join(root, "src/adapters/packs/instahyre.json"), "utf8"));
    assert.equal(pack.portalKind, "instahyre");
    assert.equal(Boolean((pack.overlays || {}).instantApplyBoard || (pack.overlays || {}).instant_apply_board), true);
    assert.ok((pack.neverFill || pack.never_fill || []).includes("legal") || (pack.neverFill || []).includes("consent"));
    assert.ok(((pack.hotPath || pack.hot_path || {}).skipLlmOn || []).length >= 0);
});

test("Apply labels cover the listing-to-employer hops seen on real boards", () => {
    const apply = contentConstant("APPLY_TEXT");
    for (const label of [
        "Apply", "Apply Save", "Apply now", "Easy Apply", "Apply on Naukri",
        "Apply on company website", "Apply on the employer site", "Apply externally",
        "View & Apply", "Start your application", "Apply manually"
    ]) {
        assert.equal(apply.test(label), true, `${label} should be treated as an Apply control`);
    }
    for (const label of ["Save", "Submit", "Submit application", "Continue", "Next", "Withdraw"]) {
        assert.equal(apply.test(label), false, `${label} must never be treated as an Apply control`);
    }

    const external = contentConstant("EXTERNAL_APPLY_TEXT");
    assert.equal(external.test("Apply on company site"), true);
    assert.equal(external.test("Apply externally"), true);
    assert.equal(external.test("Easy Apply"), false);
});

test("apply-control selection prefers the employer hop and ignores recommended jobs", () => {
    assert.match(scripts, /const SUGGESTED_JOBS_SELECTOR = /);
    assert.match(scripts, /closest\?\.\(SUGGESTED_JOBS_SELECTOR\)/);
    assert.match(scripts, /primary\.length \? primary : matching/);
    assert.match(scripts, /function applyControlRank/);
    assert.match(scripts, /EXTERNAL_APPLY_TEXT\.test\(text\)\) return 3/);
});

test("instant-apply boards are handed back to the candidate instead of clicked", () => {
    assert.match(scripts, /const INSTANT_APPLY_PORTALS = new Set\(\["naukri", "instahyre"\]\)/);
    assert.match(scripts, /function isInstantApplyBoard/);
    assert.match(scripts, /instantApplyBoard/);
    assert.match(scripts, /isInstantApplyBoard\(\) && applyControlRank\(candidates\[0\]\) === 1\) return null/);
    assert.match(scripts, /function enterAssistMode/);
    assert.match(scripts, /surface: "instant_apply"/);
    assert.match(scripts, /USER_ACTION_REQUIRED/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("overlay keys prefer hostname/slug then host then portal, and never treat Wellfound job ids as slugs", async () => {
    const { boardSlugFromUrl, mergePacks, overlayKeysForUrl } = await import("../src/adapters/overlayKey.js");
    assert.equal(boardSlugFromUrl("https://boards.greenhouse.io/acme/jobs/123", "greenhouse"), "acme");
    assert.equal(boardSlugFromUrl("https://jobs.lever.co/acme/senior-engineer", "lever"), "acme");
    assert.equal(boardSlugFromUrl("https://jobs.ashbyhq.com/acme", "ashby"), "acme");
    assert.equal(boardSlugFromUrl("https://iqvia.wd1.myworkdayjobs.com/en-US/job/x/apply", "workday"), "iqvia");
    assert.equal(boardSlugFromUrl("https://alaan.rippling.com/apply", "rippling"), "alaan");
    assert.equal(boardSlugFromUrl("https://wellfound.com/company/earnin/jobs/1", "wellfound"), "earnin");
    assert.equal(boardSlugFromUrl("https://wellfound.com/jobs/4607227-senior-software-engineer", "wellfound"), "");
    assert.equal(boardSlugFromUrl("https://www.naukri.com/job-listings-x", "naukri"), "");
    assert.deepEqual(
        overlayKeysForUrl("https://boards.greenhouse.io/acme/jobs/123", "greenhouse"),
        ["boards.greenhouse.io/acme", "boards.greenhouse.io", "greenhouse", "*"]
    );
    assert.deepEqual(
        overlayKeysForUrl("https://wellfound.com/jobs/4607227-senior-software-engineer", "wellfound"),
        ["wellfound.com", "wellfound", "*"]
    );

    const merged = mergePacks(
        { portalKind: "rippling", skipSelectors: ["[aria-label='Search country']"], overlays: { preferTestIdForUploads: true } },
        { skipSelectors: [".alaan-only"], overlays: { extra: true } }
    );
    assert.deepEqual(merged.skipSelectors, ["[aria-label='Search country']", ".alaan-only"]);
    assert.equal(merged.overlays.preferTestIdForUploads, true);
    assert.equal(merged.overlays.extra, true);
    assert.equal(merged.portalKind, "rippling");
});

test("extension runtime consumes pack overlays for iframe, form, Workday apply, and Keka submit/success", () => {
    const sandbox = { URL, globalThis: {} };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(read("extension/adapters/runtime.js"), sandbox);
    const runtime = sandbox.JobHunterAdapterRuntime;
    assert.equal(runtime.embeddedFrameSelector().includes("#grnhse_iframe"), true);
    assert.equal(runtime.formContainerSelector().includes("#grnhse_app"), true);

    const workday = JSON.parse(read("src/adapters/packs/workday.json"));
    runtime.apply({ portalKind: "workday", pack: workday });
    assert.equal(runtime.isApplicationRoute({
        hostname: "iqvia.wd1.myworkdayjobs.com",
        pathname: "/en-US/Apply/job/x/apply"
    }), true);
    assert.equal(runtime.isApplicationRoute({
        hostname: "iqvia.wd1.myworkdayjobs.com",
        pathname: "/en-US/job/x"
    }), false);
    assert.equal(runtime.isApplicationRoute({
        hostname: "alaan.rippling.com",
        pathname: "/apply"
    }), false);

    const keka = JSON.parse(read("src/adapters/packs/keka.json"));
    runtime.apply({ portalKind: "keka", pack: keka });
    assert.equal(runtime.isSuccessRoute({
        hostname: "gokwik.keka.com",
        pathname: "/careers/success/42"
    }), true);
    assert.equal(runtime.isSuccessRoute({
        hostname: "gokwik.keka.com",
        pathname: "/careers/applyjob/42"
    }), false);
    assert.equal(runtime.isPortalSubmit({
        hostname: "gokwik.keka.com",
        pathname: "/careers/applyjob/9"
    }, "Apply"), true);
    assert.equal(runtime.isPortalSubmit({
        hostname: "alaan.rippling.com",
        pathname: "/careers/applyjob/9"
    }, "Apply"), false);
});

test("content.js keeps Workday/Keka/iframe fallbacks and applies the mapping pack at bootstrap", () => {
    const content = read("extension/content.js");
    assert.match(content, /function isWorkdayApplicationRoute/);
    assert.match(content, /myworkdayjobs\\\.com/);
    assert.match(content, /applyManually/);
    assert.match(content, /KEKA_SUCCESS_ROUTE/);
    assert.match(content, /isKekaFormSubmit/);
    assert.match(content, /applyjob/);
    assert.match(content, /#grnhse_iframe/);
    assert.match(content, /iframe\[src\*='lever\.co'\]/);
    assert.match(content, /#grnhse_app/);
    assert.match(content, /function applyAdapterRuntime/);
    assert.match(content, /async function bootstrap\(\) \{[\s\S]{0,280}applyAdapterRuntime\(\)/);
    assert.match(content, /isLabeledDocumentUpload/);
    assert.match(content, /isQuestionDisguisedAsUpload/);
    assert.doesNotMatch(content, /\.click\(\)[\s\S]{0,80}submit/i);
});

test("seeded portal packs stay host-independent after a tenant overlay is saved", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-overlay-lookup-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { activeMappingPackForHost, saveLocalDraftPack } = await import("../src/repositories/mappingPackRepository.js");
    try {
        getDb();
        saveLocalDraftPack({
            portalKind: "rippling",
            siteHost: "alaan.rippling.com",
            pack: { skipSelectors: [".tenant-only"], overlays: { extraFlag: true } }
        });
        const alaan = activeMappingPackForHost("https://alaan.rippling.com/en/apply");
        const other = activeMappingPackForHost("https://foo.rippling.com/en/apply");
        assert.equal(alaan.portalKind, "rippling");
        assert.equal(other.portalKind, "rippling");
        assert.equal(alaan.pack.skipSelectors.includes(".tenant-only"), true);
        assert.equal(other.pack.skipSelectors.includes(".tenant-only"), false);
        assert.equal(other.pack.fileFields.resume.testIds.includes("input-resume"), true);
        assert.equal(alaan.pack.overlays.preferTestIdForUploads, true);
        assert.equal(other.pack.overlays.extraFlag, undefined);
        assert.equal(activeMappingPackForHost("https://www.naukri.com/job-listings-x").portalKind, "naukri");
        assert.equal(activeMappingPackForHost("https://wellfound.com/jobs/1").portalKind, "wellfound");
        const workday = activeMappingPackForHost("https://iqvia.wd1.myworkdayjobs.com/en-US/job/x/apply");
        assert.equal(workday.pack.overlays.applicationHost.includes("myworkdayjobs"), true);
        const keka = activeMappingPackForHost("https://gokwik.keka.com/careers/applyjob/1");
        assert.match(keka.pack.overlays.successRoute, /careers\/success/);
        assert.doesNotMatch(keka.pack.overlays.successRoute, /apply\/.+\/success/);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

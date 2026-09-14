import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("npm test isolates synthetic fixtures from the candidate database", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const runner = fs.readFileSync(path.join(root, "scripts/run_tests.js"), "utf8");
    assert.equal(pkg.scripts.test, "node scripts/run_tests.js");
    assert.match(runner, /mkdtempSync/);
    assert.match(runner, /DATABASE_PATH: databasePath/);
    assert.match(runner, /NODE_ENV: "test"/);
});

test("hostname registry maps Rippling, Greenhouse, Workday, Keka, Naukri, Wellfound, Lever, Ashby, and LinkedIn without company-page adapters", async () => {
    const { portalKindFor, resolvePortal, listPortals } = await import("../src/adapters/registry.js");
    assert.equal(portalKindFor("https://alaan.rippling.com/apply"), "rippling");
    assert.equal(portalKindFor("boards.greenhouse.io"), "greenhouse");
    assert.equal(portalKindFor("https://iqvia.wd1.myworkdayjobs.com/en-US/Apply/job/x/apply"), "workday");
    assert.equal(portalKindFor("gokwik.keka.com"), "keka");
    assert.equal(portalKindFor("https://www.naukri.com/job-listings-x"), "naukri");
    assert.equal(portalKindFor("https://wellfound.com/jobs/1"), "wellfound");
    assert.equal(portalKindFor("https://jobs.lever.co/acme/abc"), "lever");
    assert.equal(portalKindFor("https://jobs.ashbyhq.com/acme"), "ashby");
    assert.equal(portalKindFor("https://careers.cisco.com/global/en/apply"), "phenom");
    assert.equal(portalKindFor("https://www.linkedin.com/jobs/view/1"), "linkedin");
    assert.equal(portalKindFor("https://jobs.example.com/apply"), "generic");
    assert.equal(portalKindFor("rippling"), "rippling");
    assert.equal(listPortals().some((portal) => portal.id === "rippling"), true);
    assert.deepEqual([...new Set(listPortals().map((portal) => portal.id))].sort(), listPortals().map((portal) => portal.id).sort());

    const code = fs.readFileSync(path.join(root, "extension/adapters/registry.js"), "utf8");
    const sandbox = { URL, globalThis: {} };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(code, sandbox);
    assert.equal(sandbox.JobHunterAdapterRegistry.portalKindFor("https://alaan.rippling.com/x"), "rippling");
    assert.equal(sandbox.JobHunterAdapterRegistry.resolve("boards.greenhouse.io").id, "greenhouse");
    assert.equal(sandbox.JobHunterAdapterRegistry.portalKindFor("https://www.naukri.com/x"), "naukri");
    assert.equal(resolvePortal("alaan.rippling.com").version, sandbox.JobHunterAdapterRegistry.resolve("alaan.rippling.com").version);
});

test("append-only field timeline keeps the latest evidence row and honest fill outcomes", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-adapter-timeline-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { recordFieldEvidence } = await import("../src/repositories/learningRepository.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES ('job-tl', 'Backend', '', 'https://alaan.rippling.com/apply', 'test')").run();
        db.prepare("INSERT INTO applications (id, job_id, adapter) VALUES ('app-tl', 'job-tl', 'EXTENSION')").run();
        recordFieldEvidence("app-tl", "https://alaan.rippling.com/apply", [
            { id: "email", label: "Email", type: "email", value: "a@example.com", finalState: "DETECTED", intendedAction: "NOT_ATTEMPTED" }
        ], { extensionVersion: "1.13.0", portalKind: "rippling" });
        recordFieldEvidence("app-tl", "https://alaan.rippling.com/apply", [
            { id: "email", label: "Email", type: "email", value: "a@example.com", filled: true, finalState: "FILLED", intendedAction: "FILL" }
        ], { extensionVersion: "1.13.0", portalKind: "rippling" });
        recordFieldEvidence("app-tl", "https://alaan.rippling.com/apply", [
            { id: "email", label: "Email", type: "email", value: "a@example.com", finalState: "UNCHANGED", intendedAction: "NOT_ATTEMPTED" }
        ], { extensionVersion: "1.13.0", portalKind: "rippling" });
        recordFieldEvidence("app-tl", "https://alaan.rippling.com/apply", [
            { id: "consent", label: "I agree", type: "checkbox", legal: true, filled: false, finalState: "BLOCKED" }
        ], { extensionVersion: "1.13.0" });
        const latest = db.prepare("SELECT fill_outcome, portal_kind, extension_version FROM application_field_evidence WHERE field_id = 'email'").get();
        assert.equal(latest.fill_outcome, "FILLED");
        assert.equal(latest.portal_kind, "rippling");
        assert.equal(latest.extension_version, "1.13.0");
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM application_field_evidence WHERE field_id = 'email'").get().n, 1);
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM application_field_timeline WHERE field_id = 'email'").get().n, 3);
        assert.equal(db.prepare("SELECT observed_state FROM application_field_timeline WHERE field_id = 'consent'").get().observed_state, "LEGAL_BLOCK");
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("mapping packs promote with Form A PASS and a kill switch pauses a portal", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-adapter-packs-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const {
        activeMappingPackForHost, killPortalAdapter, listMappingPacks, promoteMappingPack, revivePortalAdapter, saveLocalDraftPack
    } = await import("../src/repositories/mappingPackRepository.js");
    const { formAGate } = await import("../src/services/learnProposer.js");
    try {
        getDb();
        const seeded = listMappingPacks({ portalKind: "rippling" });
        assert.equal(seeded.some((pack) => pack.stage === "DEFAULT"), true);
        assert.equal(activeMappingPackForHost("https://alaan.rippling.com/apply").portalKind, "rippling");
        assert.equal(activeMappingPackForHost("https://alaan.rippling.com/apply").killed, false);
        const draft = saveLocalDraftPack({
            portalKind: "rippling",
            siteHost: "rippling",
            pack: { portalKind: "rippling", skipSelectors: ["[aria-label='Search country']", ".canary-marker"] }
        });
        const shadow = promoteMappingPack(draft.id, { gate: formAGate({ portalKind: "rippling" }) });
        assert.equal(shadow.stage, "SHADOW");
        assert.equal(activeMappingPackForHost("https://alaan.rippling.com/apply").stage, "DEFAULT");
        assert.equal(activeMappingPackForHost("https://alaan.rippling.com/apply").pack.skipSelectors.includes(".canary-marker"), false);
        const canary = promoteMappingPack(shadow.id, { gate: formAGate({ portalKind: "rippling" }) });
        assert.equal(canary.stage, "CANARY");
        assert.equal(activeMappingPackForHost("https://alaan.rippling.com/apply").stage, "CANARY");
        assert.equal(activeMappingPackForHost("https://alaan.rippling.com/apply").pack.skipSelectors.includes(".canary-marker"), true);
        killPortalAdapter("rippling", "Test kill");
        assert.equal(activeMappingPackForHost("alaan.rippling.com").killed, true);
        revivePortalAdapter("rippling");
        assert.equal(activeMappingPackForHost("alaan.rippling.com").killed, false);
        assert.equal(formAGate().status, "PASS");
        const tenant = saveLocalDraftPack({
            portalKind: "rippling",
            siteHost: "alaan.rippling.com",
            pack: { portalKind: "rippling", skipSelectors: [".alaan-only"] }
        });
        assert.equal(tenant.siteHost, "alaan.rippling.com");
        const alaan = activeMappingPackForHost("https://alaan.rippling.com/apply");
        const other = activeMappingPackForHost("https://other.rippling.com/apply");
        assert.equal(alaan.pack.skipSelectors.includes(".alaan-only"), true);
        assert.equal(alaan.pack.skipSelectors.includes("[aria-label='Search country']"), true);
        assert.equal(other.pack.skipSelectors.includes(".alaan-only"), false);
        assert.equal(other.pack.skipSelectors.includes("[aria-label='Search country']"), true);
        assert.equal(other.portalKind, "rippling");
        const board = saveLocalDraftPack({
            portalKind: "greenhouse",
            siteHost: "boards.greenhouse.io/acme",
            pack: { skipSelectors: [".acme-board"] }
        });
        assert.equal(board.siteHost, "boards.greenhouse.io/acme");
        assert.equal(activeMappingPackForHost("https://boards.greenhouse.io/acme/jobs/1").pack.skipSelectors.includes(".acme-board"), true);
        assert.equal(activeMappingPackForHost("https://boards.greenhouse.io/other/jobs/1").pack.skipSelectors.includes(".acme-board"), false);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("learn proposer clusters failures into a scoped pack and never emits a content.js patch", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-learn-proposer-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { recordFieldEvidence } = await import("../src/repositories/learningRepository.js");
    const { promoteMappingProposal, proposeMappingPatches } = await import("../src/services/learnProposer.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES ('job-lp', 'Backend', '', 'https://alaan.rippling.com/apply', 'test')").run();
        db.prepare("INSERT INTO applications (id, job_id, adapter) VALUES ('app-lp', 'job-lp', 'EXTENSION')").run();
        recordFieldEvidence("app-lp", "https://alaan.rippling.com/apply", [{
            id: "availability", label: "Availability", type: "choice-group", controlKind: "choice-group",
            finalState: "BLOCKED", intendedAction: "FILL", filled: false, portalFieldKey: "availability:choice",
            selectorCandidates: ['[data-testid="availability"]']
        }], { portalKind: "rippling", extensionVersion: "1.13.0" });
        const proposals = proposeMappingPatches();
        assert.equal(proposals.length >= 1, true);
        const proposal = proposals.find((item) => item.portalKind === "rippling");
        assert.equal(proposal.patch.neverTouches.includes("content.js"), true);
        const promoted = promoteMappingProposal(proposal.id);
        assert.equal(promoted.mappingPack.stage, "LOCAL_DRAFT");
        assert.equal(promoted.formAGate.status, "PASS");
        assert.equal(JSON.stringify(promoted.mappingPack.pack).includes("content.js rewrite"), false);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

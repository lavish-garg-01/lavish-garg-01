import assert from "node:assert/strict";
import ejs from "ejs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("adapter health reports learning hygiene and why a proposal cannot be promoted", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-adapter-ops-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { recordFieldEvidence } = await import("../src/repositories/learningRepository.js");
    const { adapterHealthReport } = await import("../src/services/adapterHealth.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES ('job-o', 'Backend', '', 'https://acme.rippling.com/apply', 'test')").run();
        db.prepare("INSERT INTO applications (id, job_id, adapter) VALUES ('app-o', 'job-o', 'EXTENSION')").run();
        recordFieldEvidence("app-o", "https://acme.rippling.com/apply", [
            {
                id: "notice", label: "Notice period", type: "text", controlKind: "text", semanticKey: "NOTICE_PERIOD",
                finalState: "FILL_FAILED", intendedAction: "FILL", filled: false
            },
            {
                id: "anything", label: "Anything else?", type: "textarea", controlKind: "textarea", semanticKey: "CUSTOM_FIELD",
                finalState: "FILL_FAILED", intendedAction: "FILL", filled: false, selectorCandidates: ['textarea[name="x"]']
            }
        ], { portalKind: "rippling", extensionVersion: "1.13.7" });
        db.prepare(`INSERT INTO portal_field_patterns (id, user_id, site_host, portal_field_key, field_label, control_kind, selector_candidates_json)
            VALUES ('legacy', 'local-user', 'acme.rippling.com', 'legacy:text', 'Legacy', 'text', '[]')`).run();

        const report = adapterHealthReport();
        assert.equal(report.learningHygiene.removedEmptySelectors, 1);
        assert.equal(report.portals.some((portal) => portal.id === "instahyre"), true);
        assert.equal(report.learningHygiene.skippedClusters.some((cluster) => cluster.skipReason === "NOISY_SEMANTIC_KEY"), true);

        const proposal = report.proposals.find((item) => item.patch.semanticKey === "NOTICE_PERIOD");
        assert.equal(proposal.promoteBlockedReason, "NO_STRUCTURAL_SELECTOR");
        assert.equal(report.proposals.some((item) => item.patch.semanticKey === "CUSTOM_FIELD"), false);

        const view = fs.readFileSync(path.join(root, "src/views/adapters.ejs"), "utf8");
        const html = ejs.render(view, { report, counts: {}, panel: "adapters", error: "", success: "" }, {
            filename: path.join(root, "src/views/adapters.ejs")
        });
        assert.match(html, /Learning hygiene/);
        assert.match(html, /Empty-selector patterns removed/);
        assert.match(html, /Cannot promote · no structural selector/);
        // A blocked proposal hides promote but stays dismissible by hand.
        const proposalsHtml = html.slice(html.indexOf("Learn proposals"), html.indexOf("Flags"));
        assert.doesNotMatch(proposalsHtml, /Save as LOCAL_DRAFT/);
        assert.match(proposalsHtml, /Dismiss/);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("the deployment checklist covers the Phase 1 reliability work for this build", () => {
    const checklist = fs.readFileSync(path.join(root, "docs/DEPLOYMENT_CHECKLIST.md"), "utf8");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
    assert.ok(checklist.includes(`\`${manifest.version}\``), "checklist must name the shipping extension version");
    for (const section of [
        "Support modes",
        "Listing-to-employer hops",
        "Portal fill quality",
        "Learning hygiene and adapter ops",
        "Chrome restart session restore"
    ]) {
        assert.match(checklist, new RegExp(section));
    }
    // Out-of-scope items stay listed as non-blocking, not as done work.
    const outOfScope = checklist.slice(checklist.indexOf("Do not block this release on"));
    assert.match(outOfScope, /paid paywall for AI answers/);
    assert.match(outOfScope, /ASSISTED \/ AUTOPILOT/);
    assert.match(outOfScope, /Cloud or Postgres/);
    assert.doesNotMatch(outOfScope, /Chrome restart session restore/);

    const context = fs.readFileSync(path.join(root, "docs/PROJECT_CONTEXT.md"), "utf8");
    assert.match(context, /SESSION_RECOVERED/);
    assert.match(context, /Learning hygiene gates/);
    assert.match(context, /Instahyre/);
});

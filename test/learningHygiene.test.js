import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function freshDb(prefix) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    return directory;
}

test("portal field patterns refuse empty selector candidates and cleanup removes stale rows", async () => {
    const directory = freshDb("job-learn-hygiene-patterns-");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { cleanupStalePortalPatterns, findPortalFieldPattern, recordPortalFieldPatternOutcome, savePortalFieldPattern } =
        await import("../src/repositories/agentRepository.js");
    try {
        const db = getDb();

        assert.equal(savePortalFieldPattern({
            siteHost: "acme.rippling.com", portalFieldKey: "notice_period:text",
            fieldLabel: "Notice period", controlKind: "text", selectorCandidates: []
        }), null);
        assert.equal(savePortalFieldPattern({
            siteHost: "acme.rippling.com", portalFieldKey: "notice_period:text",
            fieldLabel: "Notice period", controlKind: "text", selectorCandidates: ["bad{selector", "  "]
        }), null);
        assert.equal(findPortalFieldPattern("acme.rippling.com", "notice_period:text"), null);

        const saved = savePortalFieldPattern({
            siteHost: "acme.rippling.com", portalFieldKey: "notice_period:text",
            fieldLabel: "Notice period", controlKind: "text",
            selectorCandidates: ['input[name="noticePeriod"]'], semanticKey: "NOTICE_PERIOD"
        });
        assert.deepEqual(JSON.parse(saved.selectorCandidatesJson), ['input[name="noticePeriod"]']);

        // Rows written by older builds still need a cleanup path.
        db.prepare(`INSERT INTO portal_field_patterns (id, user_id, site_host, portal_field_key, field_label, control_kind, selector_candidates_json, semantic_key)
            VALUES ('legacy-empty', 'local-user', 'acme.rippling.com', 'legacy_empty:text', 'Legacy', 'text', '[]', 'NOTICE_PERIOD')`).run();
        db.prepare(`INSERT INTO portal_field_patterns (id, user_id, site_host, portal_field_key, field_label, control_kind, selector_candidates_json, semantic_key, failure_count)
            VALUES ('legacy-custom', 'local-user', 'acme.rippling.com', 'legacy_custom:text', 'Anything else?', 'text', '["#x"]', 'CUSTOM_FIELD', 5)`).run();
        db.prepare(`INSERT INTO portal_field_patterns (id, user_id, site_host, portal_field_key, field_label, control_kind, selector_candidates_json, semantic_key, failure_count, success_count)
            VALUES ('legacy-custom-ok', 'local-user', 'acme.rippling.com', 'legacy_custom_ok:text', 'Anything else?', 'text', '["#y"]', 'CUSTOM_FIELD', 1, 9)`).run();

        const result = cleanupStalePortalPatterns({ minFailures: 3 });
        assert.equal(result.removedEmptySelectors, 1);
        assert.equal(result.removedCustomFieldNoise, 1);
        assert.equal(findPortalFieldPattern("acme.rippling.com", "legacy_empty:text"), null);
        assert.equal(findPortalFieldPattern("acme.rippling.com", "legacy_custom:text"), null);
        // A CUSTOM_FIELD row that mostly succeeds is real user knowledge, keep it.
        assert.ok(findPortalFieldPattern("acme.rippling.com", "legacy_custom_ok:text"));
        // Working patterns survive hygiene.
        recordPortalFieldPatternOutcome("acme.rippling.com", "notice_period:text", true);
        assert.ok(findPortalFieldPattern("acme.rippling.com", "notice_period:text"));
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("CUSTOM_FIELD and unlabeled failure clusters never become mapping proposals", async () => {
    const directory = freshDb("job-learn-hygiene-clusters-");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { recordFieldEvidence } = await import("../src/repositories/learningRepository.js");
    const { proposeMappingPatches, skippedMappingClusters } = await import("../src/services/learnProposer.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES ('job-h', 'Backend', '', 'https://acme.rippling.com/apply', 'test')").run();
        db.prepare("INSERT INTO applications (id, job_id, adapter) VALUES ('app-h', 'job-h', 'EXTENSION')").run();
        recordFieldEvidence("app-h", "https://acme.rippling.com/apply", [
            {
                id: "custom-1", label: "Anything else you want to share?", type: "textarea", controlKind: "textarea",
                semanticKey: "CUSTOM_FIELD", finalState: "FILL_FAILED", intendedAction: "FILL", filled: false,
                selectorCandidates: ['textarea[name="custom1"]']
            },
            {
                id: "unlabeled-1", label: "Unknown field", type: "text", controlKind: "text",
                finalState: "FILL_FAILED", intendedAction: "FILL", filled: false,
                selectorCandidates: ['input[name="unknown1"]']
            },
            {
                id: "notice", label: "Notice period", type: "text", controlKind: "text",
                semanticKey: "NOTICE_PERIOD", finalState: "FILL_FAILED", intendedAction: "FILL", filled: false,
                selectorCandidates: ['input[name="noticePeriod"]']
            }
        ], { portalKind: "rippling", extensionVersion: "1.13.7" });

        const proposals = proposeMappingPatches();
        assert.equal(proposals.some((proposal) => proposal.patch.semanticKey === "NOTICE_PERIOD"), true);
        assert.equal(proposals.some((proposal) => proposal.patch.semanticKey === "CUSTOM_FIELD"), false);
        assert.equal(proposals.some((proposal) => proposal.patch.fieldLabel === "Unknown field"), false);

        const skipped = skippedMappingClusters().map((cluster) => cluster.skipReason).sort();
        assert.deepEqual(skipped, ["NOISY_SEMANTIC_KEY", "UNLABELED_CLUSTER"]);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("proposals without a structural selector or with noisy keys can never promote", async () => {
    const directory = freshDb("job-learn-hygiene-promote-");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { recordFieldEvidence } = await import("../src/repositories/learningRepository.js");
    const { promoteMappingProposal, proposeMappingPatches, pruneNoisyMappingProposals, listMappingProposals } =
        await import("../src/services/learnProposer.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES ('job-p', 'Backend', '', 'https://acme.rippling.com/apply', 'test')").run();
        db.prepare("INSERT INTO applications (id, job_id, adapter) VALUES ('app-p', 'job-p', 'EXTENSION')").run();
        recordFieldEvidence("app-p", "https://acme.rippling.com/apply", [{
            id: "reason-for-leaving", label: "Reason for leaving", type: "text", controlKind: "text",
            semanticKey: "REASON_FOR_LEAVING", finalState: "FILL_FAILED", intendedAction: "FILL", filled: false
        }], { portalKind: "rippling", extensionVersion: "1.13.7" });

        const selectorless = proposeMappingPatches().find((proposal) => proposal.patch.semanticKey === "REASON_FOR_LEAVING");
        assert.deepEqual(selectorless.patch.selectorCandidates, []);
        assert.throws(() => promoteMappingProposal(selectorless.id), /no structural selector/i);

        db.prepare(`INSERT INTO mapping_proposals (id, portal_kind, site_host, control_kind, field_fingerprint, cluster_key, proposed_patch_json, form_a_gate, status, occurrence_count)
            VALUES ('noisy-1', 'rippling', 'acme.rippling.com', 'text', 'anything_else', 'rippling|text|anything_else', ?, 'SKIPPED', 'PROPOSED', 4)`)
            .run(JSON.stringify({ semanticKey: "CUSTOM_FIELD", selectorCandidates: ['textarea[name="custom1"]'] }));
        assert.throws(() => promoteMappingProposal("noisy-1"), /no reusable semantic key/i);

        // A noisy key can never teach anything, so it is retired. A cluster that
        // only lacks selectors stays open, because later evidence can supply them.
        assert.equal(pruneNoisyMappingProposals().rejected, 1);
        const byId = new Map(listMappingProposals().map((proposal) => [proposal.id, proposal.status]));
        assert.equal(byId.get("noisy-1"), "REJECTED");
        assert.equal(byId.get(selectorless.id), "PROPOSED");
        assert.throws(() => promoteMappingProposal(selectorless.id), /no structural selector/i);
        // A dismissed proposal stays dismissed even if the cluster keeps failing.
        assert.throws(() => promoteMappingProposal("noisy-1"), /dismissed/i);

        // A cluster that carries a real selector still promotes into a LOCAL_DRAFT pack.
        recordFieldEvidence("app-p", "https://acme.rippling.com/apply", [{
            id: "expected-ctc", label: "Expected CTC", type: "text", controlKind: "text", semanticKey: "EXPECTED_CTC",
            finalState: "FILL_FAILED", intendedAction: "FILL", filled: false,
            selectorCandidates: ['input[name="expectedCtc"]']
        }], { portalKind: "rippling", extensionVersion: "1.13.7" });
        const promotable = proposeMappingPatches().find((proposal) => proposal.patch.semanticKey === "EXPECTED_CTC");
        const promoted = promoteMappingProposal(promotable.id);
        assert.equal(promoted.mappingPack.stage, "LOCAL_DRAFT");
        assert.equal(promoted.mappingPack.pack.skipSelectors.includes('input[name="expectedCtc"]'), true);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

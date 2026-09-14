import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("career certification skips the same passing engine fingerprint on the same build", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-certification-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const {
        completeCertificationRun, nextCertificationBatch, shouldRunTarget, startCertificationRun, upsertCareerTestTarget
    } = await import("../src/services/certificationCampaign.js");
    try {
        getDb();
        const first = upsertCareerTestTarget({ companyName: "Cisco", careerUrl: "https://careers.cisco.com/global/en/apply?utm_source=test" });
        const duplicate = upsertCareerTestTarget({ companyName: "Cisco", careerUrl: "https://careers.cisco.com/global/en/apply?utm_source=other" });
        upsertCareerTestTarget({ companyName: "Acme", careerUrl: "https://www.linkedin.com/jobs/view/1", priority: 95 });
        upsertCareerTestTarget({ companyName: "Postman", careerUrl: "https://job-boards.greenhouse.io/postman/jobs/1", priority: 80 });
        assert.equal(first.id, duplicate.id);
        assert.equal(first.portal_kind, "phenom");
        const started = startCertificationRun({ targetId: first.id, personaId: "india-backend-mid", extensionVersion: "1.15.4", pageFingerprint: "phenom-v1" });
        assert.equal(started.skipped, false);
        completeCertificationRun(started.runId, { status: "LIVE_VERIFIED", detected: 12, filled: 8, review: 4 });
        const target = getDb().prepare("SELECT * FROM career_test_targets WHERE id = ?").get(first.id);
        assert.deepEqual(
            shouldRunTarget(target, { extensionVersion: "1.15.4", adapterVersion: started.adapterVersion, pageFingerprint: "phenom-v1" }),
            { run: false, reason: "already_verified_same_build_and_fingerprint", priorRunId: started.runId }
        );
        assert.equal(shouldRunTarget(target, { extensionVersion: "1.15.5", adapterVersion: started.adapterVersion, pageFingerprint: "phenom-v1" }).run, true);
        assert.equal(shouldRunTarget(target, { extensionVersion: "1.15.4", adapterVersion: started.adapterVersion, pageFingerprint: "phenom-v2" }).run, true);
        const portals = nextCertificationBatch({ limit: 3 }).map((item) => item.portal_kind);
        assert.equal(new Set(portals).size, 3);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("compensation and availability facts require approval, freshness, and no profile conflict", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-facts-"));
    process.env.DATABASE_PATH = path.join(directory, "facts.db");
    const { closeDb } = await import("../src/database/connection.js");
    const { candidateFactStatus, saveCandidateFact, saveWritingStyleProfile } = await import("../src/repositories/candidateFactRepository.js");
    try {
        assert.throws(() => saveCandidateFact({ semanticKey: "CURRENT_CTC", value: 12 }), /approval/i);
        saveCandidateFact({ semanticKey: "CURRENT_CTC", value: 12, candidateApproved: true, verifiedAt: "2026-08-01T00:00:00.000Z" });
        const fresh = candidateFactStatus("CURRENT_CTC", { currentCTC: 12, updatedAt: "2026-08-01T00:00:00.000Z" }, new Date("2026-08-20T00:00:00.000Z"));
        assert.equal(fresh.usable, true);
        const conflict = candidateFactStatus("CURRENT_CTC", { currentCTC: 14, updatedAt: "2026-08-20T00:00:00.000Z" }, new Date("2026-08-20T00:00:00.000Z"));
        assert.equal(conflict.usable, false);
        assert.equal(conflict.conflict, true);
        saveCandidateFact({ semanticKey: "NOTICE_PERIOD", value: 30, candidateApproved: true, verifiedAt: "2026-06-01T00:00:00.000Z" });
        assert.equal(candidateFactStatus("NOTICE_PERIOD", { noticePeriodDays: 30, updatedAt: "2026-06-01T00:00:00.000Z" }, new Date("2026-08-20T00:00:00.000Z")).stale, true);
        assert.throws(() => saveCandidateFact({ semanticKey: "START_DATE", value: "2026-09-01", candidateApproved: true }), /one application/i);
        assert.throws(() => saveWritingStyleProfile({ tone: "direct" }), /approval/i);
        const style = saveWritingStyleProfile({ tone: "direct", traits: ["concise", "concise"], candidateApproved: true });
        assert.equal(style.candidateApproved, 1);
        assert.deepEqual(JSON.parse(style.traitsJson), ["concise"]);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

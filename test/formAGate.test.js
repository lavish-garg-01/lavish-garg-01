import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("seeded Rippling DEFAULT pack PASSes Form A and Form B", async () => {
    const { formAGate } = await import("../src/services/formAGate.js");
    const result = formAGate(null, "rippling");
    assert.equal(result.status, "PASS");
    assert.equal(result.formAGate, "PASS");
    assert.equal(result.details.formA.ok, true);
    assert.equal(result.details.formB.ok, true);
    assert.equal(result.details.formA.resume.testId, "input-resume");
    assert.equal(result.details.formA.coverLetter.testId, "input-cover_letter");
    assert.notEqual(result.details.formA.resume.testId, result.details.formA.coverLetter.testId);
});

test("poison pack that drops input-resume FAILs Form A gate", async () => {
    const { formAGate } = await import("../src/services/formAGate.js");
    const poison = {
        portalKind: "rippling",
        fileFields: {
            resume: { testIds: [], labelPatterns: ["cover letter", "cv"] }
        }
    };
    const result = formAGate(poison);
    assert.equal(result.status, "FAIL");
    assert.match(result.reason, /RESUME_/);
});

test("poison pack that binds resume to cover-letter labels FAILs", async () => {
    const { formAGate } = await import("../src/services/formAGate.js");
    const poison = {
        portalKind: "rippling",
        overlays: { preferTestIdForUploads: false },
        fileFields: {
            resume: { testIds: [], labelPatterns: ["cover letter"] },
            coverLetter: { testIds: ["input-cover_letter"], labelPatterns: ["cover letter"] }
        }
    };
    const result = formAGate(poison);
    assert.equal(result.status, "FAIL");
    assert.ok(
        /RESUME_COVER_COLLISION|RESUME_BOUND_TO_COVER_TRAP|RESUME_UNRESOLVED|RESUME_TESTID_MISSING/.test(result.reason),
        result.reason
    );
});

test("every seeded ATS DEFAULT pack PASSes its own Form A and Form B", async () => {
    const { formAGate, formAPortalKinds, evaluateFormAGate } = await import("../src/services/formAGate.js");
    const kinds = formAPortalKinds();
    assert.ok(kinds.includes("greenhouse"));
    assert.ok(kinds.includes("workday"));
    assert.ok(kinds.includes("keka"));
    for (const kind of kinds) {
        const result = evaluateFormAGate(null, kind);
        assert.equal(result.status, "PASS", `${kind}: ${result.reason}`);
        assert.notEqual(result.details.formA.resume.testId, result.details.formA.coverLetter.testId, kind);
    }
    const all = formAGate();
    assert.equal(all.status, "PASS", all.reason);
    assert.equal(all.details.portals.greenhouse.status, "PASS");
});

test("Greenhouse poison pack that maps resume via CV FAILs Form B trap", async () => {
    const { formAGate } = await import("../src/services/formAGate.js");
    const result = formAGate({
        portalKind: "greenhouse",
        overlays: { preferTestIdForUploads: false },
        fileFields: {
            resume: { testIds: [], labelPatterns: ["cv"] },
            coverLetter: { testIds: [], labelPatterns: ["cover letter"] }
        }
    });
    assert.equal(result.status, "FAIL");
    assert.equal(result.details.portalKind, "greenhouse");
    assert.match(result.reason, /RESUME_/);
});

test("promoteMappingPack SHADOW→CANARY for Greenhouse is blocked when Form A FAILs", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-forma-gh-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { formAGate } = await import("../src/services/formAGate.js");
    const { promoteMappingPack, saveLocalDraftPack } = await import("../src/repositories/mappingPackRepository.js");
    try {
        getDb();
        const draft = saveLocalDraftPack({
            portalKind: "greenhouse",
            siteHost: "greenhouse",
            pack: {
                portalKind: "greenhouse",
                overlays: { preferTestIdForUploads: false },
                fileFields: { resume: { testIds: [], labelPatterns: ["cv"] } }
            }
        });
        const shadow = promoteMappingPack(draft.id, { gate: { formAGate: "PASS" } });
        assert.equal(shadow.stage, "SHADOW");
        const gate = formAGate({ ...shadow.pack, portalKind: "greenhouse" });
        assert.equal(gate.status, "FAIL");
        assert.throws(
            () => promoteMappingPack(shadow.id, { gate }),
            /Form A must PASS/
        );
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("promoteMappingPack SHADOW→CANARY throws when Form A gate is FAIL", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-forma-promote-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { promoteMappingPack, saveLocalDraftPack } = await import("../src/repositories/mappingPackRepository.js");
    try {
        getDb();
        const draft = saveLocalDraftPack({
            portalKind: "rippling",
            siteHost: "rippling",
            pack: {
                portalKind: "rippling",
                fileFields: {
                    resume: { testIds: [], labelPatterns: ["cover letter"] }
                }
            }
        });
        const shadow = promoteMappingPack(draft.id, { gate: { formAGate: "PASS" } });
        assert.equal(shadow.stage, "SHADOW");
        assert.throws(
            () => promoteMappingPack(shadow.id, { gate: { formAGate: "FAIL", status: "FAIL" } }),
            /Form A must PASS/
        );
        assert.throws(
            () => promoteMappingPack(shadow.id, { gate: { formAGate: "SKIPPED", status: "SKIPPED" } }),
            /Form A must PASS/
        );
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

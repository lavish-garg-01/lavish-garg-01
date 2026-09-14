import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("snapshots, adapter evidence, provenance, corrections, and outcomes stay redacted and scoped", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-architecture-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const {
        applicationOutcomeReport, capturePageSnapshot, completeAdapterRun, confirmApplicationOutcome,
        proposeFactCorrection, recordApplicationOutcome, recordFieldResolution
    } = await import("../src/repositories/applicationIntelligenceRepository.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES ('job-arch', 'Backend Engineer', '', 'https://acme.example/jobs/1', 'test')").run();
        db.prepare("INSERT INTO applications (id, job_id, adapter, status) VALUES ('app-arch', 'job-arch', 'EXTENSION', 'SUCCESS')").run();

        const fields = [
            { id: "email", label: "Email", type: "email", required: true, semanticKey: "EMAIL", filled: true, value: "candidate@example.com" },
            { id: "password", label: "Account password", type: "password", required: true, sensitive: true, filled: true, value: "must-never-persist" },
            { id: "notice", label: "Notice period", type: "select", options: ["30 days", "60 days"], visible: true }
        ];
        const first = capturePageSnapshot("app-arch", "https://acme.example/apply/step-1", fields, { adapterKind: "EXTENSION", adapterVersion: "workday-v3" });
        const repeated = capturePageSnapshot("app-arch", "https://acme.example/apply/step-1", fields, { adapterKind: "EXTENSION", adapterVersion: "workday-v3" });
        assert.equal(first.snapshotId, repeated.snapshotId, "same structure must deduplicate within an attempt");
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM application_page_snapshots").get().count, 1);
        const snapshotDump = JSON.stringify(db.prepare("SELECT * FROM application_field_snapshots").all());
        assert.equal(snapshotDump.includes("candidate@example.com"), false);
        assert.equal(snapshotDump.includes("must-never-persist"), false);
        completeAdapterRun(first.runId, { status: "NEEDS_REVIEW", filledCount: 1, reviewCount: 2 });
        assert.deepEqual(db.prepare("SELECT status, filled_count, review_count FROM adapter_runs WHERE id = ?").get(first.runId),
            { status: "NEEDS_REVIEW", filled_count: 1, review_count: 2 });

        recordFieldResolution("app-arch", "https://acme.example/apply/step-1", fields[0], {
            normalizedKey: "EMAIL", answer: "candidate@example.com", source: "PROFILE", confidence: 1, evidence: "Verified profile"
        }, "SAFE_FILL");
        recordFieldResolution("app-arch", "https://acme.example/apply/step-1", fields[1], {
            normalizedKey: "PASSWORD", answer: "must-never-persist", source: "USER", confidence: 1
        }, "MANUAL_ONLY");
        const resolutions = db.prepare("SELECT field_id, value_hash, policy_decision FROM field_resolutions ORDER BY field_id").all();
        assert.equal(resolutions[0].value_hash != null, true);
        assert.equal(resolutions[1].value_hash, null, "protected values must not even be hashed into provenance");

        const correction1 = proposeFactCorrection({ semanticKey: "NOTICE_PERIOD", factScope: "CANDIDATE_PROFILE", valueType: "INTEGER", previousValue: 60, proposedValue: 30 });
        const correction2 = proposeFactCorrection({ semanticKey: "NOTICE_PERIOD", factScope: "CANDIDATE_PROFILE", valueType: "INTEGER", previousValue: 60, proposedValue: 30 });
        assert.equal(correction1.status, "PROPOSED");
        assert.equal(correction2.observation_count, 2);
        assert.equal(db.prepare("SELECT proposed_value_hash FROM candidate_fact_correction_proposals").get().proposed_value_hash.includes("30"), false);

        recordApplicationOutcome({ applicationId: "app-arch", eventType: "SUBMITTED", evidenceSource: "BROWSER" });
        const proposal = recordApplicationOutcome({ applicationId: "app-arch", eventType: "INTERVIEW", evidenceSource: "EMAIL", confidence: 0.82 });
        let report = applicationOutcomeReport();
        assert.equal(report.coveragePercent, 100);
        assert.equal(report.events.find((event) => event.id === proposal.id).confirmation_status, "PROPOSED");
        confirmApplicationOutcome(proposal.id, true);
        report = applicationOutcomeReport();
        assert.equal(report.events.find((event) => event.id === proposal.id).confirmation_status, "CONFIRMED");
        assert.equal(report.events.some((event) => event.event_type === "REJECTED"), false, "unknown time must never become rejection");
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("Attention Center groups only compatible semantic key, type, scope, and options", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-attention-scope-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { listAttentionGroups, upsertAttentionItem } = await import("../src/repositories/attentionRepository.js");
    try {
        const db = getDb();
        for (const number of [1, 2, 3]) {
            db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES (?, 'Engineer', '', ?, 'test')").run(`job-scope-${number}`, `https://example.com/${number}`);
            db.prepare("INSERT INTO applications (id, job_id, adapter) VALUES (?, ?, 'EXTENSION')").run(`app-scope-${number}`, `job-scope-${number}`);
        }
        upsertAttentionItem("app-scope-1", { fieldId: "notice", type: "FACT_REQUIRED", title: "Notice", semanticKey: "NOTICE_PERIOD", answerScope: "CANDIDATE_PROFILE", options: ["30", "60"] });
        upsertAttentionItem("app-scope-2", { fieldId: "notice", type: "FACT_REQUIRED", title: "Notice", semanticKey: "NOTICE_PERIOD", answerScope: "APPLICATION_ONLY", options: ["30", "60"] });
        upsertAttentionItem("app-scope-3", { fieldId: "notice", type: "FACT_REQUIRED", title: "Notice", semanticKey: "NOTICE_PERIOD", answerScope: "CANDIDATE_PROFILE", options: ["Immediate", "30"] });
        const groups = listAttentionGroups();
        assert.equal(groups.length, 3);
        assert.equal(groups.every((group) => group.count === 1), true);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("outcome UI and extension integration expose confirmed evidence without enabling auto-submit", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const extensionRoutes = fs.readFileSync(path.join(root, "src/routes/extension.js"), "utf8");
    const copilotRoutes = fs.readFileSync(path.join(root, "src/routes/copilot.js"), "utf8");
    const outcomeView = fs.readFileSync(path.join(root, "src/views/outcomes.ejs"), "utf8");
    assert.match(extensionRoutes, /capturePageSnapshot/);
    assert.match(extensionRoutes, /recordFieldResolution/);
    assert.match(extensionRoutes, /eventType: "SUBMITTED"/);
    assert.match(copilotRoutes, /router\.get\("\/outcomes"/);
    assert.match(outcomeView, /known-outcome coverage/);
    assert.match(outcomeView, /Unknown is not treated as rejected/);
    assert.doesNotMatch(extensionRoutes, /allowRealSubmission:\s*true/);
});

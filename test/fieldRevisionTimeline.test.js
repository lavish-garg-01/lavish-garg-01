import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

test("durable edit timelines stay value-free, idempotent, and reclassify only in SHADOW", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-field-revisions-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { ensureApplicationAttempt } = await import("../src/repositories/learningRepository.js");
    const { buildFieldInteractionObservation } = await import("../src/contracts/fieldInteractionObservation.js");
    const { classifyFieldInteraction } = await import("../src/services/fieldLearningClassifier.js");
    const {
        classifyAttemptAtCheckpoint,
        fieldRevisionDiagnostics,
        recordCheckpointReceipt,
        recordEditSessionSnapshot,
        recordFieldRevision,
        recordNeutralObservation
    } = await import("../src/services/fieldRevisionService.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO candidate_profiles (user_id, name, email) VALUES ('local-user', 'Candidate', 'candidate@example.com')").run();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES ('job-revision', 'Engineer', '', 'https://example.com/job', 'test')").run();
        db.prepare("INSERT INTO applications (id, job_id, user_id, adapter) VALUES ('app-revision', 'job-revision', 'local-user', 'EXTENSION')").run();
        const attempt = ensureApplicationAttempt("app-revision", "https://example.com/apply");
        const identity = {
            schemaVersion: 1,
            runId: attempt.id,
            tabId: 7,
            frameId: 0,
            documentId: "document-01",
            documentLifecycle: "ACTIVE",
            pageGeneration: 1,
            formGeneration: 1,
            formGroupId: "application-0",
            logicalFieldFingerprint: HASH_A,
            fieldInstanceGeneration: 0
        };
        const revision = {
            schemaVersion: 1,
            revisionId: "revision:01",
            identity,
            operationId: "operation:01",
            editSessionId: "edit:01",
            sequence: 1,
            actor: "CANDIDATE",
            eventType: "EDIT_COMMITTED",
            beforeValueHash: HASH_A,
            intendedValueHash: HASH_A,
            afterValueHash: HASH_B,
            canonicalKey: "CURRENT_CITY",
            answerVersionId: null,
            representationVersionId: null,
            strategyVersionId: null,
            clientTimeMs: 1_788_070_000_000,
            valueFree: true
        };
        assert.deepEqual(recordFieldRevision("app-revision", revision), { revisionId: "revision:01", recorded: true, duplicate: false });
        assert.equal(recordFieldRevision("app-revision", revision).duplicate, true);

        const editSession = {
            schemaVersion: 1,
            editSessionId: "edit:01",
            identity,
            startedAtMs: 1_788_070_000_000,
            lastActivityAtMs: 1_788_070_001_000,
            endedAtMs: 1_788_070_001_100,
            status: "COMMITTED",
            firstRevisionSequence: 1,
            lastRevisionSequence: 1,
            initialValueHash: HASH_A,
            finalValueHash: HASH_B,
            interruptionReason: null
        };
        assert.equal(recordEditSessionSnapshot("app-revision", editSession).recorded, true);
        assert.equal(recordEditSessionSnapshot("app-revision", editSession).duplicate, true);

        const observation = buildFieldInteractionObservation({
            id: HASH_A,
            logicalFieldId: HASH_A,
            semanticKey: "CURRENT_CITY",
            fillOutcome: "USER_CORRECTED",
            finalState: "USER_EDITED",
            source: "USER_MANUAL_INPUT",
            beforeValueHash: HASH_A,
            intendedValueHash: HASH_A,
            finalValueHash: HASH_B,
            normalizedEquivalent: false,
            completedByUser: true,
            strategyAttempted: true,
            readback: "MATCH"
        }, {
            applicationId: "app-revision",
            attemptId: attempt.id,
            checkpoint: { type: "NONE", status: "NOT_OBSERVED" },
            clientTimeMs: 1_788_070_001_100
        });
        const initialClassification = classifyFieldInteraction(observation);
        assert.equal(initialClassification.answer.outcome, "UNKNOWN");
        assert.equal(recordNeutralObservation("app-revision", observation, initialClassification).observationRecorded, true);
        assert.equal(recordNeutralObservation("app-revision", observation, initialClassification).observationRecorded, false);

        const checkpoint = {
            schemaVersion: 1,
            checkpointId: "checkpoint:01",
            runId: attempt.id,
            applicationId: "app-revision",
            applicationContentRevisionId: null,
            type: "SUBMISSION",
            status: "VERIFIED",
            source: "EMPLOYER_RECEIPT",
            observedAtMs: 1_788_070_002_000,
            evidenceHash: HASH_B,
            valueFree: true
        };
        assert.equal(recordCheckpointReceipt("app-revision", checkpoint).recorded, true);
        assert.equal(recordCheckpointReceipt("app-revision", checkpoint).duplicate, true);
        assert.deepEqual(classifyAttemptAtCheckpoint("app-revision", checkpoint), { observations: 1, classificationsRecorded: 1 });
        assert.deepEqual(classifyAttemptAtCheckpoint("app-revision", checkpoint), { observations: 1, classificationsRecorded: 0 });

        const diagnostics = fieldRevisionDiagnostics("app-revision", attempt.id);
        assert.equal(diagnostics.revisions.length, 1);
        assert.equal(diagnostics.editSessions.length, 1);
        assert.equal(diagnostics.checkpoints.length, 1);
        assert.equal(diagnostics.observations.length, 1);
        assert.equal(diagnostics.classifications.length, 2);
        assert.equal(diagnostics.classifications.at(-1).answer.outcome, "CORRECTED");
        assert.equal(diagnostics.classifications.at(-1).mode, "SHADOW");

        const persisted = JSON.stringify(diagnostics);
        assert.equal(persisted.includes("Bengaluru"), false);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM candidate_answers").get().count, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM semantic_mapping_evidence").get().count, 0);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("extension captures stable edit lifecycle and checkpoint contracts without raw values", () => {
    const content = fs.readFileSync(path.resolve("extension/content.js"), "utf8");
    const background = fs.readFileSync(path.resolve("extension/background.js"), "utf8");
    const routes = fs.readFileSync(path.resolve("src/routes/extension.js"), "utf8");
    for (const marker of ["EDIT_STARTED", "EDIT_UPDATED", "EDIT_COMMITTED", "VALUE_REVERTED", "INTERRUPTED", "RECORD_FIELD_REVISION", "RECORD_EDIT_SESSION", "RECORD_CHECKPOINT_RECEIPT"]) {
        assert.match(`${content}\n${background}`, new RegExp(marker));
    }
    assert.match(content, /beforeValueHash/);
    assert.match(content, /intendedValueHash/);
    assert.match(content, /afterValueHash/);
    assert.match(routes, /recordNeutralObservation/);
    assert.match(routes, /classifyAttemptAtCheckpoint/);
    assert.doesNotMatch(content, /rawValue\s*:/);
});


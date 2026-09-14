import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const candidatePrivate = (kind, properties) => ({
    schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind, ...properties
});
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

test("Part 2B commits checkpoint-qualified answer learning as one immutable change set", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-answer-change-set-"));
    process.env.DATABASE_PATH = path.join(directory, "change-sets.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { ensureApplicationAttempt } = await import("../src/repositories/learningRepository.js");
    const { buildFieldInteractionObservation } = await import("../src/contracts/fieldInteractionObservation.js");
    const {
        classifyAttemptAtCheckpoint, recordCheckpointReceipt, recordNeutralObservation
    } = await import("../src/services/fieldRevisionService.js");
    const { ensureAnswerPolicyRegistry } = await import("../src/services/answerPolicyRegistry.js");
    const {
        candidateAnswerChangeSetHistory, commitCandidateAnswerChangeSet
    } = await import("../src/services/candidateAnswerChangeSetService.js");
    const { listCandidateAnswerVersions } = await import("../src/repositories/candidateAnswerVersionRepository.js");

    try {
        const db = getDb();
        ensureAnswerPolicyRegistry();
        db.prepare(`INSERT INTO candidate_profiles
            (user_id, name, email, reusable_answer_consent, preferred_locations, skills, target_roles, preferred_work_modes)
            VALUES ('local-user', 'Candidate', 'candidate@example.com', 1, '[]', '[]', '[]', '[]')`).run();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES ('job-change-set', 'Engineer', '', 'https://example.com/job', 'test')").run();
        db.prepare("INSERT INTO applications (id, job_id, user_id, adapter) VALUES ('app-change-set', 'job-change-set', 'local-user', 'EXTENSION')").run();
        const attempt = ensureApplicationAttempt("app-change-set", "https://example.com/apply");

        const observations = [
            { id: "observation-name", logical: "a".repeat(64), canonical: "FULL_NAME", raw: "Asha Sharma" },
            { id: "observation-company", logical: "b".repeat(64), canonical: "CURRENT_COMPANY", raw: "Acme Labs" }
        ];
        for (const item of observations) {
            const observation = buildFieldInteractionObservation({
                id: item.logical,
                logicalFieldId: item.logical,
                semanticKey: item.canonical,
                fillOutcome: "USER_CORRECTED",
                finalState: "USER_EDITED",
                source: "USER_MANUAL_INPUT",
                beforeValueHash: null,
                intendedValueHash: null,
                finalValueHash: hash(item.raw),
                normalizedEquivalent: null,
                completedByUser: true
            }, {
                applicationId: "app-change-set",
                attemptId: attempt.id,
                observationId: item.id,
                checkpoint: { type: "NONE", status: "NOT_OBSERVED" },
                clientTimeMs: Date.now()
            });
            recordNeutralObservation("app-change-set", observation);
        }

        const checkpoint = {
            schemaVersion: 1,
            checkpointId: "checkpoint:change-set",
            runId: attempt.id,
            applicationId: "app-change-set",
            applicationContentRevisionId: null,
            type: "SUBMISSION",
            status: "VERIFIED",
            source: "EMPLOYER_RECEIPT",
            observedAtMs: Date.now(),
            evidenceHash: "c".repeat(64),
            valueFree: true
        };
        recordCheckpointReceipt("app-change-set", checkpoint);
        assert.equal(classifyAttemptAtCheckpoint("app-change-set", checkpoint).classificationsRecorded, 2);

        const input = {
            applicationId: "app-change-set",
            runId: attempt.id,
            checkpointId: checkpoint.checkpointId,
            proposals: [
                {
                    observationId: "observation-name",
                    fieldLogicalId: "a".repeat(64),
                    canonicalKey: "FULL_NAME",
                    normalizedValue: candidatePrivate("STRING", { value: "Asha Sharma" }),
                    finalValueHash: hash("Asha Sharma"),
                    context: {}, scopeQualifiers: {}, expectedActiveVersionId: null,
                    reasonCodes: ["CANDIDATE_COMPLETED_FIELD"]
                },
                {
                    observationId: "observation-company",
                    fieldLogicalId: "b".repeat(64),
                    canonicalKey: "CURRENT_COMPANY",
                    normalizedValue: candidatePrivate("STRING", { value: "Acme Labs" }),
                    finalValueHash: hash("Acme Labs"),
                    context: {}, scopeQualifiers: {}, expectedActiveVersionId: null,
                    reasonCodes: []
                }
            ]
        };
        const committed = commitCandidateAnswerChangeSet({
            userId: "local-user", idempotencyKey: "change-set-submit-1", input
        });
        assert.equal(committed.status, "COMMITTED");
        assert.equal(committed.itemCount, 1, "only low-risk AUTO_VERSION facts commit at submission");
        assert.equal(committed.items[0].canonicalKey, "FULL_NAME");
        assert.equal(committed.items[0].presentationMode, "AUTO_QUIET");
        assert.deepEqual(committed.held, [{
            canonicalKey: "CURRENT_COMPANY",
            decision: "REVIEW_REQUIRED",
            reasonCodes: ["ONLY_LOW_RISK_AUTO_VERSION_ENABLED"]
        }]);
        assert.equal(listCandidateAnswerVersions("local-user", { canonicalKey: "FULL_NAME", includeInactive: false })[0]
            .normalizedValue.value, "Asha Sharma");
        assert.equal(listCandidateAnswerVersions("local-user", { canonicalKey: "CURRENT_COMPANY", includeInactive: false }).length, 0);
        assert.equal(candidateAnswerChangeSetHistory("local-user").length, 1);

        const replay = commitCandidateAnswerChangeSet({
            userId: "local-user", idempotencyKey: "change-set-submit-1", input
        });
        assert.equal(replay.id, committed.id);
        assert.equal(replay.idempotentReplay, true);
        assert.deepEqual(replay.held, committed.held, "idempotent replay must preserve held-item explanations");
        assert.throws(() => commitCandidateAnswerChangeSet({
            userId: "local-user",
            idempotencyKey: "change-set-submit-1",
            input: { ...input, proposals: [{ ...input.proposals[0], normalizedValue: candidatePrivate("STRING", { value: "Different" }) }] }
        }), /Idempotency key/i);

        const explicitCheckpoint = {
            ...checkpoint,
            checkpointId: "checkpoint:explicit-save",
            type: "EXPLICIT_SAVE",
            source: "CANDIDATE_GESTURE",
            observedAtMs: checkpoint.observedAtMs + 1,
            evidenceHash: "f".repeat(64)
        };
        recordCheckpointReceipt("app-change-set", explicitCheckpoint);
        classifyAttemptAtCheckpoint("app-change-set", explicitCheckpoint);
        const explicitlySaved = commitCandidateAnswerChangeSet({
            userId: "local-user", idempotencyKey: "change-set-explicit-1",
            input: {
                applicationId: "app-change-set", runId: attempt.id,
                checkpointId: explicitCheckpoint.checkpointId,
                proposals: [input.proposals[1]]
            }
        });
        assert.equal(explicitlySaved.itemCount, 1);
        assert.equal(explicitlySaved.items[0].canonicalKey, "CURRENT_COMPANY");
        assert.equal(explicitlySaved.items[0].presentationMode, "AUTO_PROMINENT");
        assert.equal(listCandidateAnswerVersions("local-user", { canonicalKey: "CURRENT_COMPANY", includeInactive: false })[0]
            .normalizedValue.value, "Acme Labs");

        const privateAudit = JSON.stringify({
            sets: db.prepare("SELECT * FROM candidate_answer_change_sets").all(),
            items: db.prepare("SELECT * FROM candidate_answer_change_set_items").all(),
            receipts: db.prepare("SELECT * FROM candidate_answer_change_set_receipts").all(),
            outbox: db.prepare("SELECT * FROM extension_backend_outbox WHERE event_type = 'CANDIDATE_ANSWER_CHANGE_SET_COMMITTED'").all()
        });
        assert.doesNotMatch(privateAudit, /Asha Sharma|Acme Labs|Different/,
            "change-set audit and outbox must contain hashes/ids, not candidate values");
        assert.throws(() => db.prepare("UPDATE candidate_answer_change_sets SET status = 'UNDONE' WHERE id = ?").run(committed.id),
            /immutable/);
        assert.throws(() => db.prepare("DELETE FROM candidate_answer_change_set_items WHERE change_set_id = ?").run(committed.id),
            /immutable/);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("Part 2B change-set failure rolls back every version, item, receipt and outbox row", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-answer-change-set-rollback-"));
    process.env.DATABASE_PATH = path.join(directory, "rollback.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { ensureApplicationAttempt } = await import("../src/repositories/learningRepository.js");
    const { buildFieldInteractionObservation } = await import("../src/contracts/fieldInteractionObservation.js");
    const { classifyAttemptAtCheckpoint, recordCheckpointReceipt, recordNeutralObservation } = await import("../src/services/fieldRevisionService.js");
    const { ensureAnswerPolicyRegistry } = await import("../src/services/answerPolicyRegistry.js");
    const { commitCandidateAnswerChangeSet } = await import("../src/services/candidateAnswerChangeSetService.js");
    try {
        const db = getDb();
        ensureAnswerPolicyRegistry();
        db.prepare(`INSERT INTO candidate_profiles
            (user_id, name, email, reusable_answer_consent, preferred_locations, skills, target_roles, preferred_work_modes)
            VALUES ('local-user', 'Candidate', 'candidate@example.com', 1, '[]', '[]', '[]', '[]')`).run();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES ('job-rollback', 'Engineer', '', 'https://example.com/job', 'test')").run();
        db.prepare("INSERT INTO applications (id, job_id, user_id, adapter) VALUES ('app-rollback', 'job-rollback', 'local-user', 'EXTENSION')").run();
        const attempt = ensureApplicationAttempt("app-rollback", "https://example.com/apply");
        const logical = "d".repeat(64);
        const observation = buildFieldInteractionObservation({
            id: logical, logicalFieldId: logical, semanticKey: "FULL_NAME",
            fillOutcome: "USER_CORRECTED", finalState: "USER_EDITED", source: "USER_MANUAL_INPUT",
            finalValueHash: hash("Rollback Candidate"), normalizedEquivalent: null, completedByUser: true
        }, { applicationId: "app-rollback", attemptId: attempt.id, observationId: "observation-rollback",
            checkpoint: { type: "NONE", status: "NOT_OBSERVED" }, clientTimeMs: Date.now() });
        recordNeutralObservation("app-rollback", observation);
        const checkpoint = {
            schemaVersion: 1, checkpointId: "checkpoint:rollback", runId: attempt.id,
            applicationId: "app-rollback", applicationContentRevisionId: null,
            type: "SUBMISSION", status: "VERIFIED", source: "EMPLOYER_RECEIPT",
            observedAtMs: Date.now(), evidenceHash: "e".repeat(64), valueFree: true
        };
        recordCheckpointReceipt("app-rollback", checkpoint);
        classifyAttemptAtCheckpoint("app-rollback", checkpoint);
        db.exec(`CREATE TRIGGER fail_change_set_item BEFORE INSERT ON candidate_answer_change_set_items
            BEGIN SELECT RAISE(ABORT, 'synthetic change-set item failure'); END;`);
        assert.throws(() => commitCandidateAnswerChangeSet({
            userId: "local-user", idempotencyKey: "rollback-change-set",
            input: {
                applicationId: "app-rollback", runId: attempt.id, checkpointId: checkpoint.checkpointId,
                proposals: [{ observationId: "observation-rollback", fieldLogicalId: logical,
                    canonicalKey: "FULL_NAME", normalizedValue: candidatePrivate("STRING", { value: "Rollback Candidate" }),
                    finalValueHash: hash("Rollback Candidate"), context: {}, scopeQualifiers: {},
                    expectedActiveVersionId: null, reasonCodes: [] }]
            }
        }), /synthetic change-set item failure/);
        for (const table of ["candidate_answer_change_sets", "candidate_answer_change_set_items",
            "candidate_answer_change_set_receipts", "candidate_answer_versions"]) {
            assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, `${table} must roll back`);
        }
        assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM extension_backend_outbox
            WHERE event_type = 'CANDIDATE_ANSWER_CHANGE_SET_COMMITTED'`).get().count, 0);
        db.exec("DROP TRIGGER fail_change_set_item");

        const abandoned = {
            ...checkpoint,
            checkpointId: "checkpoint:abandoned",
            status: "ABANDONED",
            source: "RECOVERY",
            observedAtMs: checkpoint.observedAtMs + 1,
            evidenceHash: "1".repeat(64)
        };
        recordCheckpointReceipt("app-rollback", abandoned);
        const proposal = {
            observationId: "observation-rollback", fieldLogicalId: logical,
            canonicalKey: "FULL_NAME", normalizedValue: candidatePrivate("STRING", { value: "Rollback Candidate" }),
            finalValueHash: hash("Rollback Candidate"), context: {}, scopeQualifiers: {},
            expectedActiveVersionId: null, reasonCodes: []
        };
        assert.throws(() => commitCandidateAnswerChangeSet({
            userId: "local-user", idempotencyKey: "abandoned-change-set",
            input: { applicationId: "app-rollback", runId: attempt.id,
                checkpointId: abandoned.checkpointId, proposals: [proposal] }
        }), /verified submission or explicit-save/i);

        db.prepare("UPDATE applications SET reusable_answer_decision = 'DECLINED' WHERE id = 'app-rollback'").run();
        assert.throws(() => commitCandidateAnswerChangeSet({
            userId: "local-user", idempotencyKey: "disabled-change-set",
            input: { applicationId: "app-rollback", runId: attempt.id,
                checkpointId: checkpoint.checkpointId, proposals: [proposal] }
        }), /learning is disabled/i);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM candidate_answer_versions").get().count, 0);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("unknown manual answers become candidate-answer evidence only at a verified final checkpoint", async () => {
    const { buildFieldInteractionObservation } = await import("../src/contracts/fieldInteractionObservation.js");
    const { classifyFieldInteraction } = await import("../src/services/fieldLearningClassifier.js");
    const observation = buildFieldInteractionObservation({
        id: "f".repeat(64), logicalFieldId: "f".repeat(64), semanticKey: "FULL_NAME",
        fillOutcome: "USER_CORRECTED", finalState: "USER_EDITED", source: "USER_MANUAL_INPUT",
        intendedValueHash: null, finalValueHash: hash("Candidate supplied"), normalizedEquivalent: null,
        completedByUser: true
    }, { applicationId: "application", attemptId: "attempt", observationId: "observation-new-answer",
        checkpoint: { type: "NONE", status: "NOT_OBSERVED" }, clientTimeMs: Date.now() });
    assert.equal(classifyFieldInteraction(observation).learningEligibility.candidateAnswer, false);
    const committed = classifyFieldInteraction({
        ...observation, checkpoint: { type: "SUBMISSION", status: "VERIFIED" }
    });
    assert.equal(committed.answer.outcome, "CORRECTED");
    assert.ok(committed.answer.reasonCodes.includes("USER_PROVIDED_PREVIOUSLY_UNKNOWN_ANSWER"));
    assert.equal(committed.learningEligibility.candidateAnswer, true);
});
